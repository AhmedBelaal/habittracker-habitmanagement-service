#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

aws_cli=aws
if ! command -v aws >/dev/null && [[ -x '/c/Program Files/Amazon/AWSCLIV2/aws.exe' ]]; then
  aws_cli='/c/Program Files/Amazon/AWSCLIV2/aws.exe'
fi
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test AWS_PAGER='' AWS_EC2_METADATA_DISABLED=true
unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN
awsl() { "$aws_cli" --endpoint-url http://127.0.0.1:4566 --region us-east-1 "$@"; }
compose=(docker compose -f compose.yaml)
if [[ ${HABITS_DEV_PORT:-0} == 1 ]]; then compose+=(-f compose.dev.yaml); fi

require_resource() {
  local missing=$1 result
  shift
  if result=$(awsl "$@" 2>&1); then return 0; fi
  if [[ $result == *"$missing"* ]]; then return 1; fi
  printf '%s\n' "$result" >&2
  exit 1
}

echo 'Starting Floci...'
"${compose[@]}" up -d floci
for attempt in {1..40}; do
  if awsl sts get-caller-identity >/dev/null 2>&1; then break; fi
  if [[ $attempt == 40 ]]; then echo 'Floci did not become ready.' >&2; exit 1; fi
  sleep 2
done

echo 'Provisioning Floci RDS and applying PostgreSQL migrations...'
node --env-file-if-exists=.env scripts/bootstrap-config.js rds
if ! require_resource DBInstanceNotFound rds describe-db-instances --db-instance-identifier habittracker; then
  awsl rds create-db-instance --cli-input-json file://.local/rds.json >/dev/null
fi
awsl rds wait db-instance-available --db-instance-identifier habittracker
port=$(awsl rds describe-db-instances --db-instance-identifier habittracker --query 'DBInstances[0].Endpoint.Port' --output text)
"${compose[@]}" build habits-service
# Git Bash otherwise converts the Linux path embedded in the bind-mount argument.
host_dir=$(pwd -P)
if command -v cygpath >/dev/null; then host_dir=$(cygpath -am "$host_dir"); fi
MSYS_NO_PATHCONV=1 "${compose[@]}" run --rm --no-deps \
  -v "$host_dir/.local/floci-db.json:/tmp/floci-db.json:ro" \
  habits-service node scripts/provision-db.js /tmp/floci-db.json "$port"

echo 'Setting up KMS, Secrets Manager and CloudWatch Logs...'
key_alias=alias/habittracker-habits
if ! require_resource NotFoundException kms describe-key --key-id "$key_alias"; then
  key_id=$(awsl kms create-key --description 'Habit Tracker Service A configuration' --query 'KeyMetadata.KeyId' --output text)
  awsl kms create-alias --alias-name "$key_alias" --target-key-id "$key_id"
fi
node --env-file-if-exists=.env scripts/bootstrap-config.js secret "$port"
secret_id=habittracker/habits-service
if ! require_resource ResourceNotFoundException secretsmanager describe-secret --secret-id "$secret_id"; then
  awsl secretsmanager create-secret --name "$secret_id" --kms-key-id "$key_alias" --secret-string file://.local/secret.json >/dev/null
else
  current=$(awsl secretsmanager get-secret-value --secret-id "$secret_id" --query 'SecretString' --output text)
  if [[ $current != "$(cat .local/secret.json)" ]]; then
    awsl secretsmanager put-secret-value --secret-id "$secret_id" --secret-string file://.local/secret.json >/dev/null
  fi
fi

group=/habits-service
if [[ $(MSYS_NO_PATHCONV=1 awsl logs describe-log-groups --log-group-name-prefix "$group" \
    --query "logGroups[?logGroupName=='$group'].logGroupName | [0]" --output text) != "$group" ]]; then
  MSYS_NO_PATHCONV=1 awsl logs create-log-group --log-group-name "$group"
fi
MSYS_NO_PATHCONV=1 awsl logs put-retention-policy --log-group-name "$group" --retention-in-days 7

echo 'Setting up the Service A HTTP 5xx alarm...'
metric_namespace=HabitTracker/ServiceA
metric_name=ServiceA5xx
MSYS_NO_PATHCONV=1 awsl logs put-metric-filter --log-group-name "$group" \
  --filter-name habits-service-5xx \
  --filter-pattern '{ $.event = "http_request" && $.status >= 500 && $.status < 600 }' \
  --metric-transformations "metricName=$metric_name,metricNamespace=$metric_namespace,metricValue=1,unit=Count"
awsl cloudwatch put-metric-alarm --alarm-name habits-service-5xx \
  --alarm-description 'Service A returned at least five HTTP 5xx responses in a five-minute period.' \
  --namespace "$metric_namespace" --metric-name "$metric_name" --statistic Sum --period 300 \
  --evaluation-periods 1 --threshold 5 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching

echo 'Recording the scoped EC2 runtime role in Floci IAM...'
role=habittracker-habits-runtime
if ! require_resource NoSuchEntity iam get-role --role-name "$role"; then
  awsl iam create-role --role-name "$role" --assume-role-policy-document file://infra/ec2-trust-policy.json >/dev/null
fi
secret_arn=$(awsl secretsmanager describe-secret --secret-id "$secret_id" --query ARN --output text)
key_arn=$(awsl kms describe-key --key-id "$key_alias" --query KeyMetadata.Arn --output text)
log_arn=$(MSYS_NO_PATHCONV=1 awsl logs describe-log-groups --log-group-name-prefix "$group" \
  --query "logGroups[?logGroupName=='$group'].arn | [0]" --output text)
node scripts/bootstrap-config.js iam "$secret_arn" "$key_arn" "$log_arn"
awsl iam put-role-policy --role-name "$role" --policy-name service-a-access --policy-document file://.local/iam-policy.json

"${compose[@]}" up -d --force-recreate --wait --wait-timeout 90 habits-service
echo 'Service A is ready.'

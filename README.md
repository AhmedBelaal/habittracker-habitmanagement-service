# Habit Tracker · Service A

Service A owns habit management for the Habit Tracker. The Express app follows routes → controllers → services → repositories, with PostgreSQL tables in the `habits` schema. The group gateway owns Cognito and forwards verified identity. Service B owns check-ins, streaks and challenge scoring. Service C owns the dashboard, calendar and Google Calendar reminders.

## Start Service A on Windows

Install Node.js 22 or later, Git Bash, Docker Desktop with Linux containers, and AWS CLI v2. Start Docker Desktop and run these commands from Git Bash in the repo.

```bash
npm ci
npm test
HABITS_DEV_PORT=1 bash infra/setup-aws.sh
npm run smoke
```

The setup uses AWS CLI against Floci at `127.0.0.1:4566`. It provisions an emulated RDS PostgreSQL instance, applies migrations, grants the app its own database role, and configures a KMS-backed Secrets Manager secret and CloudWatch Logs. It also records a scoped EC2 runtime role in Floci IAM. The local Compose container uses Floci's dummy credentials. Run the script again to reuse the existing resources and apply changes. [Floci RDS documentation](https://floci.io/floci/services/rds/)

`HABITS_DEV_PORT=1` publishes Service A to loopback for the smoke test. In the team stack, omit it and route requests through the gateway. The app runs at `http://habits-service:3001` on the `habittracker` Docker network. `/health` reports process liveness and `/ready` checks PostgreSQL and the migration table.

```bash
docker compose ps
MSYS_NO_PATHCONV=1 aws --endpoint-url http://127.0.0.1:4566 --region us-east-1 logs tail /habits-service --since 10m
docker compose down
```

For that AWS CLI log command, use the lab's Floci profile (`--profile floci`) or set the dummy `AWS_ACCESS_KEY_ID=test` and `AWS_SECRET_ACCESS_KEY=test` first. The setup script supplies dummy credentials itself. Generated local configuration lives in the ignored `.local/` directory. Keep it with the local database because it contains the passwords used on first setup.

For development with an existing PostgreSQL database, copy `.env.example` to `.env`, set the database URLs and `INTERNAL_TOKEN`, and run `npm run migrate` followed by `npm run dev`. Use a migration role for `DATABASE_URL_DIRECT` and grant the runtime role access to the `habits` schema and its tables. For team-managed AWS, the service also supports an AWS-provided role and `SERVICE_SECRET_ID`. Configure the database connection with your RDS CA and TLS settings, and grant the role `secretsmanager:GetSecretValue` on the service secret, `kms:Decrypt` on its key, and `logs:CreateLogStream` and `logs:PutLogEvents` for `/habits-service`.

## Public API through the gateway

The gateway forwards `X-Internal-Token`, `X-User-Id`, `X-User-Role`, `X-User-Timezone` and `X-Request-Id`. Strip client-supplied identity, internal token and service-key headers before forwarding. The gateway can also forward the verified profile's `X-User-Week-Starts-On` (`sunday` or `monday`). The service uses Sunday if the header is absent. Block `/internal/*` at the gateway.

| Routes | Behavior |
|---|---|
| `GET/POST /api/habits` | List paginated habits or create one. List supports status, type, category, all requested tags, name search and sorting. |
| `GET/PATCH/DELETE /api/habits/:id` | Read, edit or delete a habit owned by the caller. |
| `POST /api/habits/:id/{pause,resume,archive,unarchive}` | Change status. Optional pause `until` is a local date. |
| `GET /api/habits/tags` and `GET /api/categories` | Return tag counts for the caller and the fixed category catalog. |
| `GET /api/habits/due?date=YYYY-MM-DD` | Return `{data: Habit[]}` for today or one of the previous seven local dates. |
| `GET /api/habit-templates` and `POST /api/habit-templates/:id/adopt` | Browse or adopt a template. |
| `POST /api/admin/habit-templates` and `DELETE /api/admin/habit-templates/:id` | Admin-only template management. |

Create a habit with `{"type":"habit","name":"Read","category":"study","schedule":{"type":"daily"}}`. A challenge uses `"type":"challenge"` and `"challenge":{"deadline":"YYYY-MM-DD"}` with a deadline after the local start date. A one-day challenge created from a template starts and ends on the same date, using the contract's inclusive template duration formula.

IDs are UUID v4. Ownership comes from the trusted header and is enforced in PostgreSQL queries. Admins can manage templates but receive `403` for personal habits. Invalid requests use the contract's error envelope with a request ID. An owner receives `404` when the ID belongs to someone else.

## Connect the team services

Join the existing `habittracker` Docker network from the gateway, B, and C with the DNS names defined in the contract. Leave the service URLs unset to run A on its own. In `.env`, set `SERVICE_B_URL`, `SERVICE_C_URL`, and the credentials in the relevant integration guide before rerunning `infra/setup-aws.sh`. Service B uses `SERVICE_B_API=contract` by default. Set `SERVICE_B_API=legacy` for versions that use the old cache protocol.

- [Service B · Streaks integration](docs/service-b/README.md)
- [Service C · Time Management integration](docs/service-c/README.md)

Habit writes and integration jobs commit together. The worker retries network errors, timeouts, rate limits and upstream server errors. It logs other rejected deliveries with their request ID and waits for a new habit change before resending. A delete can be delivered more than once if a response is lost, so receivers must make deletes and reminder updates idempotent.

The contract's internal habit lists use `{data: Habit[]}` with `startDate` and `pausedPeriods` on each habit. A's internal stats endpoint counts stored habits by category for the requested UTC window (`30d` or `90d`) and reports the platform-wide count of challenges active today in their own time zones. For team deployment, the gateway owns Cognito and public routing, B owns scheduled streak calculation, and C owns Google OAuth.

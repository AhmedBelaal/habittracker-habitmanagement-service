CREATE TABLE habits.habits_templates (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('habit', 'challenge')),
  name text NOT NULL,
  description text,
  category text NOT NULL,
  tags text[] NOT NULL,
  schedule jsonb NOT NULL,
  suggested_reminder_time text,
  suggested_duration_days smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE habits.habits_habits (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('habit', 'challenge')),
  name text NOT NULL,
  description text,
  category text NOT NULL,
  schedule jsonb NOT NULL,
  reminder_time text,
  timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'archived')),
  inactive_periods jsonb NOT NULL DEFAULT '[]',
  paused_until date,
  start_date date NOT NULL,
  deadline date,
  template_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'challenge') = (deadline IS NOT NULL)),
  CHECK (deadline >= start_date),
  CHECK (status = 'paused' OR paused_until IS NULL)
);

CREATE INDEX habits_owner_created ON habits.habits_habits (user_id, created_at DESC, id);
CREATE INDEX habits_resume_due ON habits.habits_habits (paused_until) WHERE status = 'paused';

CREATE TABLE habits.habits_tags (
  habit_id uuid NOT NULL REFERENCES habits.habits_habits (id) ON DELETE CASCADE,
  tag text NOT NULL,
  position smallint NOT NULL,
  PRIMARY KEY (habit_id, tag)
);

CREATE TABLE habits.habits_outbox (
  target text NOT NULL CHECK (target IN ('streaks', 'time')),
  habit_id uuid NOT NULL,
  payload jsonb NOT NULL,
  request_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  failed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (target, habit_id)
);

CREATE INDEX habits_outbox_due ON habits.habits_outbox (next_attempt_at) WHERE NOT failed;

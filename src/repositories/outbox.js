async function enqueue(db, habitId, requestId, changes) {
  for (const { target, payload } of changes) {
    await db.query(`INSERT INTO habits.habits_outbox (target, habit_id, request_id, payload)
      VALUES ($1,$2,$3,$4) ON CONFLICT (target, habit_id) DO UPDATE
      SET request_id = EXCLUDED.request_id, payload = EXCLUDED.payload,
      attempts = 0, next_attempt_at = now(), failed = false`, [target, habitId, requestId, payload]);
  }
}

async function next(db, targets) {
  const { rows } = await db.query(`SELECT target, habit_id AS "habitId", request_id AS "requestId", payload, attempts
    FROM habits.habits_outbox WHERE target = ANY($1::text[]) AND NOT failed AND next_attempt_at <= now()
    ORDER BY next_attempt_at, target, habit_id LIMIT 1 FOR UPDATE SKIP LOCKED`, [targets]);
  return rows[0];
}

function done(db, job) {
  return db.query('DELETE FROM habits.habits_outbox WHERE target = $1 AND habit_id = $2', [job.target, job.habitId]);
}

function retry(db, job, failed) {
  const seconds = Math.min(2 ** job.attempts, 300);
  return db.query(`UPDATE habits.habits_outbox SET attempts = attempts + 1,
    failed = $3, next_attempt_at = now() + $4::integer * interval '1 second'
    WHERE target = $1 AND habit_id = $2`, [job.target, job.habitId, failed, seconds]);
}

module.exports = { enqueue, next, done, retry };

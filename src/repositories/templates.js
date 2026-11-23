const { paginated } = require('./habits');

const table = 'habits.habits_templates';
const fields = `h.id, h.type, h.name, h.description, h.category, h.tags, h.schedule,
  h.suggested_reminder_time AS "suggestedReminderTime", h.suggested_duration_days AS "suggestedDurationDays"`;

async function find(db, id) {
  const { rows } = await db.query(`SELECT ${fields} FROM ${table} h WHERE h.id = $1`, [id]);
  return rows[0];
}

async function insert(db, template) {
  const { rows } = await db.query(`INSERT INTO ${table} AS h
    (id, type, name, description, category, tags, schedule, suggested_reminder_time, suggested_duration_days)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${fields}`, [
    template.id, template.type, template.name, template.description, template.category, template.tags,
    template.schedule, template.suggestedReminderTime, template.suggestedDurationDays,
  ]);
  return rows[0];
}

function list(db, query) {
  return paginated(db, fields, table, `($1::text IS NULL OR h.category = $1) AND ($2::text IS NULL OR h.type = $2)
    AND ($3::text IS NULL OR strpos(lower(h.name), lower($3)) > 0)`,
  'h.created_at DESC, h.id', [query.category ?? null, query.type ?? null, query.q ?? null], query);
}

async function remove(db, id) {
  const result = await db.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
  return result.rowCount > 0;
}

module.exports = { find, insert, list, remove };

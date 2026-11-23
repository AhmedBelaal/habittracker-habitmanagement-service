const { transaction } = require('../db/pool');

const fields = `h.id, h.user_id AS "userId", h.type, h.name, h.description, h.category, h.schedule,
  h.reminder_time AS "reminderTime", h.timezone, h.status, h.paused_until AS "pausedUntil",
  h.inactive_periods AS "inactivePeriods", h.start_date AS "startDate", h.deadline,
  h.template_id AS "templateId", h.created_at AS "createdAt", h.updated_at AS "updatedAt",
  ARRAY(SELECT tag FROM habits.habits_tags WHERE habit_id = h.id ORDER BY position) AS tags`;
const table = 'habits.habits_habits';
const sortBy = { createdAt: 'h.created_at ASC', '-createdAt': 'h.created_at DESC', name: 'h.name ASC', '-name': 'h.name DESC' };

async function find(db, id, userId, lock = false) {
  const { rows } = await db.query(`SELECT ${fields} FROM ${table} h WHERE h.id = $1
    AND h.user_id = $2 ${lock ? 'FOR UPDATE OF h' : ''}`, [id, userId]);
  return rows[0];
}

async function findForLegacyService(db, id) {
  const { rows } = await db.query(`SELECT ${fields} FROM ${table} h WHERE h.id = $1`, [id]);
  return rows[0];
}

async function replaceTags(db, id, tags) {
  await db.query('DELETE FROM habits.habits_tags WHERE habit_id = $1', [id]);
  await db.query(`INSERT INTO habits.habits_tags (habit_id, tag, position)
    SELECT $1, tag, position FROM unnest($2::text[]) WITH ORDINALITY AS entry(tag, position)`, [id, tags]);
}

async function insert(db, habit) {
  await db.query(`INSERT INTO ${table} (id, user_id, type, name, description, category, schedule,
    reminder_time, timezone, status, start_date, deadline, template_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12)`, [
    habit.id, habit.userId, habit.type, habit.name, habit.description, habit.category, habit.schedule,
    habit.reminderTime, habit.timezone, habit.startDate, habit.deadline, habit.templateId,
  ]);
  await replaceTags(db, habit.id, habit.tags);
  return find(db, habit.id, habit.userId);
}

async function save(db, habit, tagsChanged = false) {
  await db.query(`UPDATE ${table} SET name = $3, description = $4, category = $5, schedule = $6,
    reminder_time = $7, timezone = $8, status = $9, paused_until = $10, inactive_periods = $11,
    deadline = $12, updated_at = now() WHERE id = $1 AND user_id = $2`, [
    habit.id, habit.userId, habit.name, habit.description, habit.category, habit.schedule, habit.reminderTime,
    habit.timezone, habit.status, habit.pausedUntil, JSON.stringify(habit.inactivePeriods), habit.deadline,
  ]);
  if (tagsChanged) await replaceTags(db, habit.id, habit.tags);
  return find(db, habit.id, habit.userId);
}

function remove(db, id, userId) {
  return db.query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2`, [id, userId]);
}

async function paginated(db, columns, tableName, where, order, values, { page, limit }) {
  const offset = (page - 1) * limit;
  const size = values.length;
  const { rows } = await db.query(`SELECT data, total FROM
    (SELECT count(*)::integer AS total FROM ${tableName} h WHERE ${where}) AS matches
    CROSS JOIN LATERAL (
      SELECT coalesce(jsonb_agg(to_jsonb(list) - 'position' ORDER BY list.position), '[]'::jsonb) AS data
      FROM (SELECT ${columns}, row_number() OVER (ORDER BY ${order}) AS position FROM ${tableName} h
        WHERE ${where} ORDER BY ${order} LIMIT $${size + 1} OFFSET $${size + 2}) AS list
    ) AS result`, [...values, limit, offset]);
  const { data, total } = rows[0];
  return { data, page, limit, total };
}

function list(db, userId, today, query) {
  const status = `CASE WHEN h.status = 'paused' AND h.paused_until <= $2::date THEN 'active' ELSE h.status END`;
  const where = `h.user_id = $1 AND ($3 = 'all' OR $3::text = (${status}) OR ($3 IS NULL AND h.status <> 'archived'))
    AND ($4::text IS NULL OR h.type = $4) AND ($5::text IS NULL OR h.category = $5)
    AND ($6::text IS NULL OR strpos(lower(h.name), lower($6)) > 0)
    AND ($7::text[] IS NULL OR ARRAY(SELECT tag FROM habits.habits_tags WHERE habit_id = h.id) @> $7)`;
  const values = [userId, today, query.status ?? null, query.type ?? null, query.category ?? null, query.q ?? null, query.tag ?? null];
  return paginated(db, fields, table, where, `${sortBy[query.sort]}, h.id`, values, query);
}

async function listForService(db, userId, { ids, includeArchived } = {}) {
  const { rows } = await db.query(`SELECT ${fields} FROM ${table} h WHERE h.user_id = $1
    AND ($2::uuid[] IS NULL OR h.id = ANY($2)) AND ($3::boolean OR h.status <> 'archived')
    ORDER BY h.created_at DESC, h.id`, [userId, ids ?? null, includeArchived ?? false]);
  return rows;
}

async function tagCounts(db, userId) {
  const { rows } = await db.query(`SELECT t.tag, count(*)::integer AS count FROM habits.habits_tags t
    JOIN ${table} h ON t.habit_id = h.id WHERE h.user_id = $1 GROUP BY t.tag ORDER BY t.tag`, [userId]);
  return rows;
}

async function stats(db, days) {
  const { rows } = await db.query(`SELECT category, count(*)::integer AS count FROM ${table}
    WHERE created_at >= date_trunc('day', now(), 'UTC') - ($1::int - 1) * interval '1 day'
    GROUP BY category ORDER BY category`, [days]);
  return rows;
}

async function expiredPauses(db) {
  const { rows } = await db.query(`SELECT ${fields} FROM ${table} h WHERE h.status = 'paused'
    AND h.paused_until <= timezone(h.timezone, now())::date ORDER BY h.paused_until, h.id
    LIMIT 25 FOR UPDATE OF h SKIP LOCKED`);
  return rows;
}

module.exports = {
  transaction, find, findForLegacyService, insert, save, remove, list, listForService, tagCounts, stats, expiredPauses, paginated,
};

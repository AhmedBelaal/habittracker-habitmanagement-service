const { randomUUID } = require('node:crypto');
const { readFileSync, existsSync } = require('node:fs');
const assert = require('node:assert/strict');

async function smoke() {
  const file = '.local/secret.json';
  const local = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const internalToken = process.env.INTERNAL_TOKEN || local.INTERNAL_TOKEN;
  if (!internalToken) throw new Error('Set INTERNAL_TOKEN or run the local Floci setup.');
  const legacyKey = process.env.LEGACY_INBOUND_KEY || local.LEGACY_INBOUND_KEY;
  const origin = process.env.SMOKE_URL || 'http://127.0.0.1:3001';
  const userId = randomUUID();
  const cleanup = [];
  const auth = { 'x-internal-token': internalToken, 'x-user-id': userId, 'x-user-role': 'user', 'x-user-timezone': 'Africa/Cairo' };

  async function call(method, path, expected, { headers = auth, body } = {}) {
    const response = await fetch(`${origin}${path}`, {
      method, headers: { ...headers, ...(body && { 'content-type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6_000),
    });
    const result = response.status === 204 ? undefined : await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${result?.error?.code ?? response.status}`);
    return result;
  }

  try {
    await call('GET', '/ready', 200, { headers: {} });
    await call('GET', '/api/habits', 401, { headers: {} });
    const created = await call('POST', '/api/habits', 201, {
      body: { type: 'habit', name: '  Smoke test read  ', category: 'study', tags: ['reading', 'reading', 'evening'], schedule: { type: 'daily' } },
    });
    const item = `/api/habits/${created.id}`;
    cleanup.push(item);
    assert.equal(created.name, 'Smoke test read');
    assert.deepEqual(created.tags, ['reading', 'evening']);
    const filtered = await call('GET', '/api/habits?tag=reading,evening&page=1&limit=2', 200);
    assert.deepEqual(filtered, { data: [created], page: 1, limit: 2, total: 1 });
    assert.deepEqual(await call('GET', '/api/habits?page=2&limit=2', 200), { data: [], page: 2, limit: 2, total: 1 });
    assert.equal((await call('GET', '/api/habits/tags', 200)).data.length, 2);
    assert.equal((await call('GET', '/api/habits/due', 200)).data[0].id, created.id);
    const internal = `/internal/habits/${created.id}`;
    assert.deepEqual(await call('GET', `${internal}?userId=${userId}`, 200), created);
    if (legacyKey) {
      const headers = { 'x-service-key': legacyKey };
      const mirror = await call('GET', internal, 200, { headers });
      assert.equal(mirror.title, created.name);
      assert.equal(mirror.habitType, 'daily');
      assert.equal((await call('GET', `/internal/users/${userId}/habits`, 200, { headers })).habits[0].habitId, created.id);
    }
    const stranger = { ...auth, 'x-user-id': randomUUID() };
    await call('GET', item, 404, { headers: stranger });
    await call('PATCH', item, 404, { headers: stranger, body: { name: 'Forbidden change' } });
    await call('DELETE', item, 404, { headers: stranger });
    const edited = await call('PATCH', item, 200, { body: { tags: ['reading'], description: 'Smoke test' } });
    assert.deepEqual(edited.tags, ['reading']);
    assert.equal((await call('POST', `${item}/pause`, 200)).status, 'paused');
    assert.deepEqual((await call('GET', '/api/habits/due', 200)).data, []);
    assert.equal((await call('POST', `${item}/resume`, 200)).status, 'active');
    assert.equal((await call('POST', `${item}/archive`, 200)).status, 'archived');
    assert.equal((await call('GET', '/api/habits', 200)).total, 0);
    assert.equal((await call('GET', '/api/habits?status=archived', 200)).total, 1);
    assert.equal((await call('POST', `${item}/unarchive`, 200)).status, 'active');

    const admin = { ...auth, 'x-user-role': 'admin' };
    await call('GET', '/api/habits', 403, { headers: admin });
    const template = await call('POST', '/api/admin/habit-templates', 201, {
      headers: admin, body: { type: 'challenge', name: 'One day', category: 'other', schedule: { type: 'daily' }, suggestedDurationDays: 1 },
    });
    try {
      const adopted = await call('POST', `/api/habit-templates/${template.id}/adopt`, 201);
      cleanup.push(`/api/habits/${adopted.id}`);
      assert.equal(adopted.templateId, template.id);
      assert.equal(adopted.challenge.startDate, adopted.challenge.deadline);
      await call('POST', `/api/habits/${adopted.id}/pause`, 409);
    } finally {
      await call('DELETE', `/api/admin/habit-templates/${template.id}`, 204, { headers: admin });
    }
    const stats = await call('GET', '/internal/stats?range=30d', 200);
    assert.ok(stats.habitsByCategory.every(row => Object.keys(row).sort().join(',') === 'category,count'));
  } finally {
    for (const item of cleanup) await call('DELETE', item, 204);
  }
  console.log('Service A smoke passed: PostgreSQL, CRUD, tags, pagination, ownership, status, templates and both internal read protocols.');
}

smoke().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

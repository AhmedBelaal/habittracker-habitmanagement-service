const { randomUUID } = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createIntegrations } = require('../src/integrations/services');
const { createHabitService } = require('../src/services/habits');
const repository = require('../src/repositories/habits');
const { todayIn, weekStart } = require('../src/domain/dates');
const { dueOn } = require('../src/domain/habits');

const userId = randomUUID();
const habitId = randomUUID();
const config = { internalToken: 'gateway-fixture', legacyInboundKey: 'legacy-fixture' };
const context = { userId, timezone: 'Africa/Cairo', requestId: 'test-123', weekStartsOn: 'sunday' };
const headers = {
  'x-internal-token': config.internalToken, 'x-user-id': userId, 'x-user-role': 'user',
  'x-user-timezone': context.timezone, 'x-request-id': context.requestId,
};
const weekHabit = {
  id: habitId, userId, name: 'Read', type: 'habit', status: 'active', inactivePeriods: [],
  schedule: { type: 'times_per_week', count: 2 }, startDate: '2026-11-21', deadline: null,
  createdAt: '2026-11-21T00:00:00Z', updatedAt: '2026-11-21T00:00:00Z',
};

afterEach(() => jest.restoreAllMocks());

test('uses calendar days in Cairo and keeps the deadline inclusive', () => {
  expect(todayIn('Africa/Cairo', new Date('2026-11-23T22:30:00Z'))).toBe('2026-11-24');
  expect(weekStart('2026-11-23', 'sunday')).toBe('2026-11-22');
  expect(weekStart('2026-11-23', 'monday')).toBe('2026-11-23');
  const habit = {
    ...weekHabit, schedule: { type: 'weekdays', days: ['mon', 'wed'] },
    deadline: '2026-11-25', inactivePeriods: [{ from: '2026-11-23', until: '2026-11-25' }],
  };
  expect(dueOn(habit, '2026-11-23')).toBe(false);
  expect(dueOn(habit, '2026-11-25')).toBe(true);
  expect(dueOn(habit, '2026-11-30')).toBe(false);
});

test('uses previous check-in days for weekly targets so a completed habit stays on that day’s checklist', async () => {
  jest.spyOn(repository, 'listForService').mockResolvedValue([weekHabit]);
  const checkInsForWeek = jest.fn().mockResolvedValue([
    { habitId, date: '2026-11-22' }, { habitId, date: '2026-11-23' }, { habitId, date: '2026-11-23' },
  ]);
  const habits = createHabitService({}, { checkInsForWeek }, () => new Date('2026-11-24T12:00:00Z'));
  await expect(habits.due(context, '2026-11-23')).resolves.toMatchObject({ data: [{ id: habitId }] });
  expect(checkInsForWeek).toHaveBeenLastCalledWith(context, '2026-11-22', '2026-11-22');
  await expect(habits.due(context, '2026-11-24')).resolves.toEqual({ data: [] });
  await expect(habits.due(context, '2026-11-16')).rejects.toMatchObject({ status: 400 });
});

test('gates public and internal endpoints and keeps the Service B fallback payload separate', async () => {
  const habits = {
    get: jest.fn().mockResolvedValue({ id: habitId }),
    legacyGet: jest.fn().mockResolvedValue({ userId, title: 'Read', habitType: 'daily' }),
    create: jest.fn(),
  };
  const app = createApp({ pool: {}, config, habits, templates: {}, log: () => {} });
  await request(app).get('/api/habits').set('x-user-id', userId).expect(401);
  await request(app).get('/api/habits').set({ ...headers, 'x-user-role': 'admin' }).expect(403);
  await request(app).get(`/internal/habits/${habitId}?userId=${userId}`).set(headers).expect(200, { id: habitId });
  await request(app).get(`/internal/habits/${habitId}?userId=${randomUUID()}`).set(headers).expect(400);
  await request(app).get(`/internal/habits/${habitId}`).set('x-service-key', config.legacyInboundKey)
    .expect(200, { userId, title: 'Read', habitType: 'daily' });
  await request(app).get(`/internal/habits/${habitId}/inactive-periods`).set('x-service-key', config.legacyInboundKey).expect(401);
  await request(app).post('/api/habits').set(headers).type('text').send('hello').expect(415);
  await request(app).post('/api/habits').set(headers).send({ name: 'a'.repeat(11_000) }).expect(413);
  const invalid = await request(app).post('/api/habits').set(headers).send({
    type: 'habit', name: 'Read', category: 'study', schedule: { type: 'daily' }, userId,
  }).expect(400);
  expect(invalid.body.error).toMatchObject({ code: 'VALIDATION_ERROR', requestId: context.requestId, details: [{ field: 'userId' }] });
  expect(habits.create).not.toHaveBeenCalled();
});

test('sends the exact README payload to Service B and the contract payload to Time', async () => {
  const fetchMock = jest.fn(async () => new Response(null, { status: 204 }));
  const integrations = createIntegrations({
    ...config, streaksProtocol: 'legacy', streaksUrl: 'http://streaks-service:3002', streaksKey: 'test-streaks-key',
    timeUrl: 'http://time-service:3003',
  }, fetchMock);
  const habit = { ...weekHabit, timezone: context.timezone, schedule: { type: 'weekdays', days: ['wed', 'sun'] }, reminderTime: '21:30' };
  const changes = integrations.changesFor(habit, false, false);
  await Promise.all(changes.map(change => integrations.deliver({ ...change, habitId, requestId: context.requestId })));
  const [legacy, time] = fetchMock.mock.calls;
  expect(legacy[0]).toBe(`http://streaks-service:3002/internal/habits/${habitId}`);
  expect(legacy[1].method).toBe('PUT');
  expect(legacy[1].headers['x-service-key']).toBe('test-streaks-key');
  expect(JSON.parse(legacy[1].body)).toEqual({
    userId, title: 'Read', habitType: 'weekly', scheduleDays: [0, 3],
    startDate: '2026-11-21', endDate: null, isArchived: false,
  });
  expect(time[0]).toBe('http://time-service:3003/internal/reminders');
  expect(time[1].headers['x-internal-token']).toBe(config.internalToken);
  expect(JSON.parse(time[1].body)).toEqual({ userId, habitId, action: 'upsert' });
});

test('uses the contract check-in list and delete endpoint with user scoping', async () => {
  const fetchMock = jest.fn()
    .mockResolvedValueOnce(Response.json({ data: [{ date: '2026-11-22', habitId }] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const integrations = createIntegrations({ ...config, streaksProtocol: 'contract', streaksUrl: 'http://streaks-service:3002' }, fetchMock);
  await expect(integrations.checkInsForWeek(context, '2026-11-22', '2026-11-22')).resolves.toEqual([{ habitId, date: '2026-11-22' }]);
  const [change] = integrations.changesFor({ ...weekHabit, timezone: context.timezone }, true, false);
  await expect(integrations.deliver({ ...change, habitId, requestId: context.requestId })).resolves.toBe(204);
  const [path, options] = fetchMock.mock.calls[1];
  expect(path).toBe(`http://streaks-service:3002/internal/habits/${habitId}?userId=${userId}`);
  expect(options.method).toBe('DELETE');
  expect(options.headers).toMatchObject({ 'x-user-id': userId, 'x-internal-token': config.internalToken });
});

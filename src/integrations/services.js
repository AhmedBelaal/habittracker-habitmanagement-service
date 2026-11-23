const { z } = require('zod');
const { legacyHabit } = require('../domain/habits');
const { unavailable } = require('../middleware/errors');

const checkIn = z.object({ habitId: z.string(), date: z.iso.date() });
const checkIns = z.array(checkIn);
const groupedCheckIns = z.record(z.iso.date(), z.array(z.string()));

function createIntegrations(config, fetchImpl = fetch) {
  const { streaksUrl, streaksKey, streaksProtocol, timeUrl, internalToken } = config;
  const legacy = streaksProtocol === 'legacy';

  function send(base, protocol, path, { context, method = 'GET', body }) {
    const headers = { 'x-request-id': context.requestId };
    if (protocol === 'legacy') {
      headers['x-service-key'] = streaksKey;
    } else {
      headers['x-internal-token'] = internalToken;
      headers['x-user-id'] = context.userId;
      headers['x-user-timezone'] = context.timezone;
    }
    if (body) headers['content-type'] = 'application/json';
    return fetchImpl(`${base}${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3_000), redirect: 'error',
    });
  }

  async function checkInsForWeek(context, from, to) {
    if (!streaksUrl) throw unavailable();
    try {
      const { userId } = context;
      const query = new URLSearchParams({ from, to });
      const path = legacy
        ? `/internal/users/${encodeURIComponent(userId)}/check-ins`
        : '/internal/checkins';
      if (!legacy) query.set('userId', userId);
      const response = await send(streaksUrl, streaksProtocol, `${path}?${query}`, { context });
      if (!response.ok) {
        await response.body?.cancel();
        throw unavailable();
      }
      const payload = await response.json();
      if (!legacy) return checkIns.parse(payload.data ?? payload);
      const dates = groupedCheckIns.parse(payload.checkInsByDate);
      return Object.entries(dates).flatMap(([date, habits]) => habits.map(habitId => ({ habitId, date })));
    } catch {
      throw unavailable();
    }
  }

  function changesFor(habit, deleted, hadReminder) {
    const changes = [];
    const context = { userId: habit.userId, timezone: habit.timezone };
    if (streaksUrl && (legacy || deleted)) {
      changes.push({
        target: 'streaks',
        payload: { ...context, deleted, body: deleted ? null : legacyHabit(habit) },
      });
    }
    if (timeUrl && (deleted || hadReminder || habit.reminderTime || habit.deadline)) {
      const action = !deleted && habit.status === 'active' && (habit.reminderTime || habit.deadline) ? 'upsert' : 'delete';
      changes.push({ target: 'time', payload: { ...context, action } });
    }
    return changes;
  }

  async function deliver({ target, habitId, requestId, payload }) {
    const { userId, timezone, deleted, body, action } = payload;
    const context = { userId, timezone, requestId };
    let response;
    if (target === 'time') {
      response = await send(timeUrl, 'contract', '/internal/reminders', {
        context, method: 'POST', body: { userId, habitId, action },
      });
    } else {
      const query = legacy ? '' : `?${new URLSearchParams({ userId })}`;
      const path = `/internal/habits/${encodeURIComponent(habitId)}${query}`;
      // The contract service pulls the habit from A. Only the README protocol accepts pushes.
      if (!legacy && !deleted) return 204;
      response = await send(streaksUrl, streaksProtocol, path, { context, method: deleted ? 'DELETE' : 'PUT', body });
    }
    await response.body?.cancel();
    return response.status;
  }

  const targets = [...(streaksUrl ? ['streaks'] : []), ...(timeUrl ? ['time'] : [])];
  return { checkInsForWeek, changesFor, deliver, targets };
}

module.exports = { createIntegrations };

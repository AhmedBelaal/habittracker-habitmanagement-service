const { randomUUID } = require('node:crypto');
const habits = require('../repositories/habits');
const templates = require('../repositories/templates');
const outbox = require('../repositories/outbox');
const { addDays, todayIn, weekStart } = require('../domain/dates');
const { challengeState, currentStatus, publicHabit, legacyHabit, dueOn } = require('../domain/habits');
const { AppError, invalid, notFound } = require('../middleware/errors');

const invalidState = () => new AppError(409, 'INVALID_STATE', 'This action is unavailable for the current habit status.');

function requireOpenChallenge(habit, today) {
  if (habit.type === 'challenge' && challengeState(habit, today) === 'ended') {
    throw new AppError(409, 'CHALLENGE_ENDED', 'The challenge deadline has passed.');
  }
}

function validateDeadline(startDate, deadline, allowSameDay = false) {
  if (!deadline || deadline < startDate || (deadline === startDate && !allowSameDay)) {
    throw invalid('challenge.deadline', 'Provide a deadline after the start date.');
  }
  if (Date.parse(deadline) - Date.parse(startDate) > 365 * 86_400_000) {
    throw invalid('challenge.deadline', 'The deadline must be within 365 days of the start date.');
  }
}

function setActive(habit, today) {
  const period = habit.inactivePeriods.at(-1);
  if (period && (!period.until || today < period.until)) period.until = today;
  habit.status = 'active';
  habit.pausedUntil = null;
}

function createHabitService(pool, integrations, now = () => new Date()) {
  const today = context => todayIn(context.timezone, now());

  async function enqueue(db, habit, requestId, { deleted = false, hadReminder = false } = {}) {
    await outbox.enqueue(db, habit.id, requestId, integrations.changesFor(habit, deleted, hadReminder));
  }

  async function create(db, context, body, localDate, templateId = null, allowSameDay = false) {
    const { type, name, category, description = null, tags = [], schedule, reminderTime = null, challenge } = body;
    if (type === 'habit' && challenge) throw invalid('challenge', 'Challenge details require type challenge.');
    const startDate = challenge?.startDate ?? localDate;
    const deadline = challenge?.deadline ?? null;
    if (startDate < localDate) throw invalid('challenge.startDate', 'The start date cannot be in the past.');
    if (type === 'challenge') validateDeadline(startDate, deadline, allowSameDay);
    const habit = await habits.insert(db, {
      id: randomUUID(), userId: context.userId, timezone: context.timezone,
      type, name, category, description, tags, schedule, reminderTime, startDate, deadline, templateId,
    });
    await enqueue(db, habit, context.requestId);
    return publicHabit(habit, localDate);
  }

  async function find(db, userId, id, lock = false) {
    const habit = await habits.find(db, id, userId, lock);
    if (!habit) throw notFound();
    return habit;
  }

  async function edit(context, id, body) {
    const localDate = today(context);
    return habits.transaction(pool, async db => {
      const habit = await find(db, context.userId, id, true);
      requireOpenChallenge(habit, localDate);
      const hadReminder = !!habit.reminderTime;
      const { challenge, ...fields } = body;
      if (challenge) {
        if (habit.type !== 'challenge' || challengeState(habit, localDate) !== 'active' || challenge.deadline <= habit.deadline) {
          throw invalid('challenge.deadline', 'Only active challenges can be extended to a later deadline.');
        }
        validateDeadline(habit.startDate, challenge.deadline);
        habit.deadline = challenge.deadline;
      }
      if (currentStatus(habit, localDate) !== habit.status) setActive(habit, localDate);
      const saved = await habits.save(db, { ...habit, ...fields, timezone: context.timezone }, body.tags !== undefined);
      await enqueue(db, saved, context.requestId, { hadReminder });
      return publicHabit(saved, localDate);
    });
  }

  async function transition(context, id, action, until) {
    const localDate = today(context);
    return habits.transaction(pool, async db => {
      const habit = await find(db, context.userId, id, true);
      if (action === 'pause' || action === 'unarchive') requireOpenChallenge(habit, localDate);
      if (currentStatus(habit, localDate) !== habit.status) setActive(habit, localDate);
      switch (action) {
        case 'pause':
          if (habit.status !== 'active' || habit.type === 'challenge') throw invalidState();
          if (until && until <= localDate) throw invalid('until', 'The resume date must be after today.');
          habit.status = 'paused';
          habit.pausedUntil = until ?? null;
          habit.inactivePeriods.push({ from: localDate, until: until ?? null });
          break;
        case 'resume':
          if (habit.status !== 'paused') throw invalidState();
          setActive(habit, localDate);
          break;
        case 'archive':
          if (habit.status === 'archived') throw invalidState();
          if (habit.status === 'paused') setActive(habit, localDate);
          habit.status = 'archived';
          habit.inactivePeriods.push({ from: localDate, until: null });
          break;
        case 'unarchive':
          if (habit.status !== 'archived') throw invalidState();
          setActive(habit, localDate);
          break;
      }
      habit.timezone = context.timezone;
      const saved = await habits.save(db, habit);
      await enqueue(db, saved, context.requestId);
      return publicHabit(saved, localDate);
    });
  }

  async function due(context, date = today(context)) {
    const localDate = today(context);
    if (date > localDate || date < addDays(localDate, -7)) throw invalid('date', 'Choose today or one of the previous seven days.');
    let candidates = (await habits.listForService(pool, context.userId)).filter(habit => dueOn(habit, date));
    const firstDay = weekStart(date, context.weekStartsOn);
    if (firstDay < date && candidates.some(habit => habit.schedule.type === 'times_per_week' && habit.startDate < date)) {
      const checkIns = await integrations.checkInsForWeek(context, firstDay, addDays(date, -1));
      const datesByHabit = new Map();
      for (const entry of checkIns) {
        if (entry.date < firstDay || entry.date >= date) continue;
        if (!datesByHabit.has(entry.habitId)) datesByHabit.set(entry.habitId, new Set());
        datesByHabit.get(entry.habitId).add(entry.date);
      }
      candidates = candidates.filter(habit => {
        if (habit.schedule.type !== 'times_per_week') return true;
        const eligibleDates = [...(datesByHabit.get(habit.id) ?? [])].filter(day => dueOn(habit, day));
        return eligibleDates.length < habit.schedule.count;
      });
    }
    return { data: candidates.map(habit => publicHabit(habit, localDate)) };
  }

  return {
    create: (context, body) => habits.transaction(pool, db => create(db, context, body, today(context))),
    async adopt(context, templateId, overrides) {
      const localDate = today(context);
      return habits.transaction(pool, async db => {
        const template = await templates.find(db, templateId);
        if (!template) throw notFound();
        const { startDate = localDate, ...fields } = overrides;
        const { type, name, description, category, tags, schedule, suggestedReminderTime, suggestedDurationDays } = template;
        if (type === 'habit' && overrides.startDate) throw invalid('startDate', 'Only challenges have a configurable start date.');
        const challenge = type === 'challenge' ? { startDate, deadline: addDays(startDate, suggestedDurationDays - 1) } : undefined;
        if (challenge && !/^\d{4}-\d{2}-\d{2}$/.test(challenge.deadline)) throw invalid('startDate', 'The template deadline exceeds year 9999.');
        return create(db, context, { type, name, description, category, tags, schedule, reminderTime: suggestedReminderTime, challenge, ...fields },
          localDate, templateId, suggestedDurationDays === 1);
      });
    },
    async list(context, query) {
      const localDate = today(context);
      const results = await habits.list(pool, context.userId, localDate, query);
      return { ...results, data: results.data.map(habit => publicHabit(habit, localDate)) };
    },
    async get(context, id) {
      return publicHabit(await find(pool, context.userId, id), today(context));
    },
    edit, transition, due,
    async remove(context, id) {
      await habits.transaction(pool, async db => {
        const habit = await find(db, context.userId, id, true);
        await habits.remove(db, id, context.userId);
        await enqueue(db, habit, context.requestId, { deleted: true });
      });
    },
    async tags(context) {
      return { data: await habits.tagCounts(pool, context.userId) };
    },
    async internalList(context, query) {
      const localDate = today(context);
      const rows = await habits.listForService(pool, context.userId, query);
      return { data: rows.map(habit => publicHabit(habit, localDate)) };
    },
    async legacyGet(id) {
      const habit = await habits.findForLegacyService(pool, id);
      if (!habit) throw notFound();
      return legacyHabit(habit);
    },
    async legacyList(userId) {
      const rows = await habits.listForService(pool, userId, { includeArchived: true });
      return { habits: rows.map(habit => ({ habitId: habit.id, ...legacyHabit(habit) })) };
    },
    async inactivePeriods(context, id) {
      const habit = await find(pool, context.userId, id);
      return { data: habit.inactivePeriods };
    },
    async stats(range) {
      return { range, habitsByCategory: await habits.stats(pool, Number.parseInt(range, 10)) };
    },
    async resumeExpired() {
      return habits.transaction(pool, async db => {
        const expired = await habits.expiredPauses(db);
        for (const habit of expired) {
          setActive(habit, habit.pausedUntil);
          const saved = await habits.save(db, habit);
          await enqueue(db, saved, randomUUID());
        }
      });
    },
  };
}

module.exports = { createHabitService };

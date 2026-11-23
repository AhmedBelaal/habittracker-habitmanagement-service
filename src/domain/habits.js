const { addDays, weekdayIndex, weekdays } = require('./dates');

const categories = ['health', 'fitness', 'study', 'mindfulness', 'productivity', 'finance', 'social', 'other'];

function challengeState(habit, today) {
  if (today < habit.startDate) return 'upcoming';
  return today > habit.deadline ? 'ended' : 'active';
}

function currentStatus(habit, today) {
  if (habit.status === 'paused' && habit.pausedUntil && habit.pausedUntil <= today) return 'active';
  return habit.status;
}

function publicHabit(habit, today) {
  const { id, type, name, description, category, tags, schedule, reminderTime, templateId, createdAt, updatedAt } = habit;
  const status = currentStatus(habit, today);
  return {
    id, type, name, description, category, tags, schedule, reminderTime, status,
    pausedUntil: status === 'paused' ? habit.pausedUntil : null,
    challenge: type === 'challenge' ? {
      startDate: habit.startDate, deadline: habit.deadline, state: challengeState(habit, today),
    } : null,
    templateId, createdAt: new Date(createdAt).toISOString(), updatedAt: new Date(updatedAt).toISOString(),
  };
}

// Internal routes only: the public Habit plus what other services need for history.
// startDate: the habit's first local day. pausedPeriods: paused/archived spans with an INCLUSIVE "to"
// (null while still inactive), as streaks-service reads them. Internally "until" is exclusive.
function internalHabit(habit, today) {
  return {
    ...publicHabit(habit, today),
    startDate: habit.startDate,
    pausedPeriods: habit.inactivePeriods
      .map(({ from, until }) => ({ from, to: until ? addDays(until, -1) : null }))
      .filter(({ from, to }) => to === null || to >= from),
  };
}

function legacyHabit(habit) {
  const { type, schedule } = habit;
  const habitType = type === 'challenge' ? 'challenge' : schedule.type === 'weekdays' ? 'weekly' : 'daily';
  return {
    userId: habit.userId,
    title: habit.name,
    habitType,
    scheduleDays: schedule.type === 'weekdays' ? schedule.days.map(day => weekdays.indexOf(day)).sort((a, b) => a - b) : [],
    startDate: habit.startDate,
    endDate: habit.deadline,
    isArchived: habit.status === 'archived',
  };
}

function dueOn(habit, date) {
  if (habit.status === 'archived' || date < habit.startDate || (habit.deadline && date > habit.deadline)) return false;
  if (habit.inactivePeriods.some(({ from, until }) => from <= date && (!until || date < until))) return false;
  return habit.schedule.type !== 'weekdays' || habit.schedule.days.includes(weekdays[weekdayIndex(date)]);
}

module.exports = { categories, challengeState, currentStatus, publicHabit, internalHabit, legacyHabit, dueOn };

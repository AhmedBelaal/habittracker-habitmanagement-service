const { weekdayIndex, weekdays } = require('./dates');

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

module.exports = { categories, challengeState, currentStatus, publicHabit, legacyHabit, dueOn };

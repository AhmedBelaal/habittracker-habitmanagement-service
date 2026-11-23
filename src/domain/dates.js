const DAY_MS = 86_400_000;

function addDays(date, days) {
  return new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);
}

function todayIn(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function validTimezone(value) {
  if (!value || !/^[a-z0-9_+\/-]{1,80}$/i.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayIndex = date => new Date(date).getUTCDay();

function weekStart(date, startsOn) {
  const offset = startsOn === 'monday' ? 1 : 0;
  return addDays(date, -((weekdayIndex(date) - offset + 7) % 7));
}

module.exports = { addDays, todayIn, validTimezone, weekdays, weekdayIndex, weekStart };

const { z } = require('zod');
const { categories } = require('../domain/habits');
const { weekdays } = require('../domain/dates');

const type = z.enum(['habit', 'challenge']);
const category = z.enum(categories);
const date = z.string().trim().pipe(z.iso.date()).refine(value => !value.startsWith('0000'), 'Use a date in years 0001–9999.');
const id = z.uuidv4();
const tag = z.string().trim().regex(/^[a-z0-9-]{1,30}$/, 'Use 1 to 30 lowercase letters, digits or hyphens.');
const name = z.string().trim().min(1).max(60);
const description = z.string().trim().max(300).transform(value => value || null).nullable().optional();
const time = z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional();
const tags = z.array(tag).max(10).transform(values => [...new Set(values)]).optional();
const schedule = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('daily') }),
  z.strictObject({
    type: z.literal('weekdays'),
    days: z.array(z.enum(weekdays)).min(1).max(7)
      .refine(days => new Set(days).size === days.length, 'Weekdays must be unique.'),
  }),
  z.strictObject({ type: z.literal('times_per_week'), count: z.number().int().min(1).max(6) }),
]);
const habitFields = { name, description, category, tags, schedule, reminderTime: time };
const createHabit = z.strictObject({
  type, ...habitFields, challenge: z.strictObject({ startDate: date.optional(), deadline: date }).optional(),
});
const editHabit = z.strictObject({
  ...habitFields, challenge: z.strictObject({ deadline: date }).optional(),
}).partial().refine(body => Object.keys(body).length > 0, 'Provide at least one field to update.');

const adopt = z.strictObject({ ...habitFields, startDate: date }).partial();
const createTemplate = z.strictObject({
  type, name, description, category, tags, schedule,
  suggestedReminderTime: time,
  suggestedDurationDays: z.number().int().min(1).max(365).nullable().optional(),
});

const asInteger = (min, max) => z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const listFields = {
  category: category.optional(), type: type.optional(), q: z.string().trim().min(1).max(60).optional(),
  page: asInteger(1, 2147483647).default(1), limit: asInteger(1, 100).default(20),
};
const listHabits = z.strictObject({
  ...listFields,
  status: z.enum(['active', 'paused', 'archived', 'all']).optional(),
  sort: z.enum(['createdAt', '-createdAt', 'name', '-name']).default('-createdAt'),
  tag: z.string().transform(value => value.split(',')).pipe(z.array(tag).min(1).max(10)).optional(),
});
const listTemplates = z.strictObject(listFields);
const internalUser = { userId: id };
const internalList = z.strictObject({
  ...internalUser,
  ids: z.string().transform(value => value.split(',')).pipe(z.array(id).min(1).max(1000)).optional(),
  includeArchived: z.enum(['true', 'false']).transform(value => value === 'true').default(false),
});
const due = z.strictObject({ date: date.optional() });
const internalDue = due.extend(internalUser);
const internalStats = z.strictObject({ range: z.enum(['30d', '90d']) });
const pause = z.strictObject({ until: date.optional() });
const empty = z.strictObject({});

module.exports = {
  id, createHabit, editHabit, adopt, createTemplate, listHabits, listTemplates,
  internalList, internalDue, internalStats, internalOne: z.strictObject(internalUser), due, pause, empty,
};

const { randomUUID } = require('node:crypto');
const templates = require('../repositories/templates');
const { categories } = require('../domain/habits');
const { invalid, notFound } = require('../middleware/errors');

function createTemplateService(pool) {
  return {
    categories() {
      return { data: categories.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })) };
    },
    list: query => templates.list(pool, query),
    create(body) {
      const { description = null, tags = [], suggestedReminderTime = null, suggestedDurationDays = null } = body;
      if ((body.type === 'challenge') !== (suggestedDurationDays !== null)) {
        throw invalid('suggestedDurationDays', 'Only challenge templates require a duration.');
      }
      return templates.insert(pool, { ...body, id: randomUUID(), description, tags, suggestedReminderTime, suggestedDurationDays });
    },
    async remove(id) {
      if (!await templates.remove(pool, id)) throw notFound();
    },
  };
}

module.exports = { createTemplateService };

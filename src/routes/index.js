const { Router } = require('express');
const { parse } = require('../middleware/errors');
const schemas = require('./schemas');

function query(schema) {
  return (req, res, next) => {
    req.input = parse(schema, req.query);
    next();
  };
}

function body(schema) {
  return (req, res, next) => {
    req.input = parse(schema, req.body ?? {});
    next();
  };
}

function createRoutes(auth, habit, template) {
  const router = Router({ caseSensitive: true, strict: true });
  const user = auth.roleIs('user');
  const admin = auth.roleIs('admin');
  router.param('id', (req, res, next, value) => {
    req.habitId = parse(schemas.id, value).toLowerCase();
    next();
  });
  router.param('userId', (req, res, next, value) => {
    req.params.userId = parse(schemas.id, value).toLowerCase();
    next();
  });

  router.use('/api/habits', user);
  router.use('/api/admin/habit-templates', admin);
  router.get('/api/habits', query(schemas.listHabits), habit.list);
  router.post('/api/habits', body(schemas.createHabit), habit.create);
  router.get('/api/habits/tags', habit.tags);
  router.get('/api/habits/due', query(schemas.due), habit.due);
  router.get('/api/habits/:id', habit.get);
  router.patch('/api/habits/:id', body(schemas.editHabit), habit.edit);
  router.delete('/api/habits/:id', habit.remove);
  router.post('/api/habits/:id/pause', body(schemas.pause), habit.transition('pause'));
  router.post('/api/habits/:id/resume', body(schemas.empty), habit.transition('resume'));
  router.post('/api/habits/:id/archive', body(schemas.empty), habit.transition('archive'));
  router.post('/api/habits/:id/unarchive', body(schemas.empty), habit.transition('unarchive'));

  router.get('/api/categories', template.categories);
  router.get('/api/habit-templates', query(schemas.listTemplates), template.list);
  router.post('/api/habit-templates/:id/adopt', user, body(schemas.adopt), habit.adopt);
  router.post('/api/admin/habit-templates', body(schemas.createTemplate), template.create);
  router.delete('/api/admin/habit-templates/:id', template.remove);

  router.get('/internal/stats', auth.internal, query(schemas.internalStats), habit.stats);
  router.get('/internal/habits', auth.internal, query(schemas.internalList), habit.internalList);
  router.get('/internal/habits/due', auth.internal, query(schemas.internalDue), habit.internalDue);
  router.get('/internal/habits/:id/inactive-periods', auth.internal, query(schemas.internalOne), habit.inactivePeriods);
  router.get('/internal/habits/:id', auth.habitById, (req, res, next) => {
    query(req.context.legacy ? schemas.empty : schemas.internalOne)(req, res, next);
  }, habit.internalGet);
  router.use('/internal/users', auth.legacy);
  router.get('/internal/users/:userId/habits', query(schemas.empty), habit.legacyList);
  return router;
}

module.exports = { createRoutes };

const { randomUUID } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { createAuth } = require('./middleware/auth');
const { AppError, errorHandler, notFound, unavailable } = require('./middleware/errors');
const { createRoutes } = require('./routes');
const { createHabitController } = require('./controllers/habits');
const { createTemplateController } = require('./controllers/templates');

function createApp({ pool, config, habits, templates, log }) {
  const app = express();
  const auth = createAuth(config);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(helmet({ strictTransportSecurity: false }));
  app.use((req, res, next) => {
    const forwarded = req.get('x-request-id');
    const requestId = forwarded && /^[a-z0-9_-]{1,100}$/i.test(forwarded) ? forwarded : randomUUID();
    const started = performance.now();
    req.context = { requestId };
    res.set('x-request-id', requestId);
    res.set('cache-control', 'no-store');
    res.on('finish', () => log({
      event: 'http_request', requestId, method: req.method,
      route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched', status: res.statusCode,
      ...(req.context.userId && { userId: req.context.userId }), elapsedMs: Math.round(performance.now() - started),
    }));
    next();
  });
  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (req, res) => {
    try {
      await pool.query('SELECT 1 FROM habits.schema_migrations LIMIT 1');
    } catch {
      throw unavailable();
    }
    res.json({ status: 'ready' });
  });
  app.use('/api', auth.fromGateway);
  app.use((req, res, next) => {
    const length = req.get('content-length');
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && (Number(length) > 0 || req.get('transfer-encoding')) && !req.is('application/json')) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
    }
    next();
  });
  app.use(express.json({ limit: 10 * 1024, strict: true }));
  app.use(createRoutes(auth, createHabitController(habits, auth), createTemplateController(templates)));
  app.use((req, res, next) => next(notFound()));
  app.use(errorHandler(log));
  return app;
}

module.exports = { createApp };

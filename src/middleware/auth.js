const { createHash, timingSafeEqual } = require('node:crypto');
const { validTimezone } = require('../domain/dates');
const { AppError, invalid } = require('./errors');
const { id } = require('../routes/schemas');

const digest = value => createHash('sha256').update(value).digest();
const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
const forbidden = () => new AppError(403, 'FORBIDDEN', 'This action is forbidden for your role.');

function matches(value, hash) {
  return value && hash && timingSafeEqual(digest(value), hash);
}

function setUserContext(req) {
  const user = id.safeParse(req.get('x-user-id'));
  if (!user.success) throw unauthenticated();
  const timezone = req.get('x-user-timezone') ?? 'UTC';
  if (!validTimezone(timezone)) throw invalid('x-user-timezone', 'Provide a valid IANA time zone.');
  const weekStartsOn = req.get('x-user-week-starts-on') ?? 'sunday';
  if (!['sunday', 'monday'].includes(weekStartsOn)) throw invalid('x-user-week-starts-on', 'Use sunday or monday.');
  Object.assign(req.context, { userId: user.data.toLowerCase(), timezone, weekStartsOn });
}

function createAuth({ internalToken, legacyInboundKey }) {
  const tokenHash = digest(internalToken);
  const legacyHash = legacyInboundKey ? digest(legacyInboundKey) : null;

  function internal(req, res, next) {
    if (!matches(req.get('x-internal-token'), tokenHash)) throw unauthenticated();
    next();
  }

  function fromGateway(req, res, next) {
    if (!matches(req.get('x-internal-token'), tokenHash)) throw unauthenticated();
    setUserContext(req);
    const role = req.get('x-user-role');
    if (!['user', 'admin'].includes(role)) throw forbidden();
    req.context.role = role;
    next();
  }

  const roleIs = role => (req, res, next) => {
    if (req.context.role !== role) throw forbidden();
    next();
  };

  function legacy(req, res, next) {
    if (!matches(req.get('x-service-key'), legacyHash)) throw unauthenticated();
    next();
  }

  function habitById(req, res, next) {
    if (req.get('x-internal-token') || Object.hasOwn(req.query, 'userId')) return internal(req, res, next);
    req.context.legacy = true;
    return legacy(req, res, next);
  }

  function forUser(req, queryUserId) {
    setUserContext(req);
    if (req.context.userId !== queryUserId.toLowerCase()) throw invalid('userId', 'Match the X-User-Id header.');
    return req.context;
  }

  return { fromGateway, roleIs, internal, legacy, habitById, forUser };
}

module.exports = { createAuth };

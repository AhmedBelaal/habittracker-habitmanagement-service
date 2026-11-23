class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const invalid = (field, issue) => new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', [{ field, issue }]);
const notFound = () => new AppError(404, 'NOT_FOUND', 'The requested resource was not found.');
const unavailable = () => new AppError(503, 'SERVICE_UNAVAILABLE', 'A required service is unavailable.');

function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const details = parsed.error.issues.flatMap(({ path, message, code, keys }) => {
    if (code === 'unrecognized_keys') {
      return keys.map(key => ({ field: [...path, key].join('.'), issue: 'Unknown field.' }));
    }
    return [{ field: path.join('.') || 'body', issue: message }];
  });
  throw new AppError(400, 'VALIDATION_ERROR', 'Some fields are invalid.', details);
}

function errorHandler(log) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    let failure = error;
    if (error.type === 'entity.too.large') {
      failure = new AppError(413, 'PAYLOAD_TOO_LARGE', 'The JSON body exceeds 10 KB.');
    } else if (error.type === 'entity.parse.failed' || error.type === 'request.size.invalid') {
      failure = invalid('body', 'A valid JSON object is required.');
    } else if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
      failure = new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json with UTF-8 encoding.');
    } else if (error instanceof URIError) {
      failure = invalid('path', 'The URL contains an invalid encoding.');
    } else if (!(error instanceof AppError)) {
      log({ event: 'request_error', requestId: req.context.requestId, errorCode: error.code || error.name });
      failure = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const { status, code, message, details } = failure;
    res.status(status).json({ error: { code, message, ...(details && { details }), requestId: req.context.requestId } });
  };
}

module.exports = { AppError, invalid, notFound, unavailable, parse, errorHandler };

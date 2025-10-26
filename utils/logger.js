const pino = require('pino');

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = pino({
  level,
  redact: {
    paths: ['req.headers.authorization', 'password', 'token'],
    remove: true
  }
});

module.exports = logger;

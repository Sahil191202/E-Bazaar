// src/config/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const env = require('./env');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

// Development: colorized, human-readable
const devFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message}${stack ? '\n' + stack : ''}${metaStr ? '\n' + metaStr : ''}`;
  })
);

// Production: structured JSON (parseable by Datadog, CloudWatch, etc.)
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  json()
);

const transports = [
  new winston.transports.Console({
    format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
    handleExceptions: true,
    handleRejections: true,
  }),
];

// File rotation in production (keeps 14 days, max 20MB per file)
if (env.NODE_ENV === 'production') {
  transports.push(
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxFiles: '14d',
      maxSize: '20m',
      format: prodFormat,
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
      format: prodFormat,
    })
  );
}

const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  transports,
  exitOnError: false,
});

module.exports = logger;
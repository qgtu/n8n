import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

const logFmt = printf(({ level, message, timestamp, ...meta }) => {
  const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} ${level}: ${message}${extras}`;
});

// Default: debug in development, info in production
const defaultLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || defaultLevel,
  format: combine(timestamp({ format: 'HH:mm:ss' }), logFmt),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFmt),
    }),
  ],
});

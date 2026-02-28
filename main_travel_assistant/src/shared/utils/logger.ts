import winston from 'winston';

const { combine, timestamp, printf, colorize } = winston.format;

// Structured log format
const customFormat = printf(({ level, message, timestamp, reqId, ...meta }) => {
  const reqStr = reqId ? `[reqId=${reqId}] ` : '';
  const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} ${level}: ${reqStr}${message} ${metaStr}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    customFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), customFormat),
    }),
    // Can append File transport for production later
  ],
});

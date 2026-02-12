/**
 * Production Logger
 *
 * Filters log output based on environment. In production, only warnings and errors
 * are logged. In development, all log levels are output.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL: LogLevel =
  process.env.NODE_ENV === 'production' ? 'warn' : 'debug';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

export const logger = {
  debug: (...args: unknown[]) =>
    shouldLog('debug') && console.log('[Lattice]', ...args),
  info: (...args: unknown[]) =>
    shouldLog('info') && console.info('[Lattice]', ...args),
  warn: (...args: unknown[]) =>
    shouldLog('warn') && console.warn('[Lattice]', ...args),
  error: (...args: unknown[]) =>
    shouldLog('error') && console.error('[Lattice]', ...args),
};

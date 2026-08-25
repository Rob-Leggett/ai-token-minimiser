import type { LogLevel } from './config.js';

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  info: 2,
  debug: 3,
};

export interface Logger {
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export function createLogger(level: LogLevel): Logger {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const at = (l: LogLevel) => threshold >= LEVELS[l];
  const ts = () => new Date().toISOString();
  return {
    error: (...a) => at('error') && console.error(`[${ts()}] ERROR`, ...a),
    info: (...a) => at('info') && console.error(`[${ts()}] INFO`, ...a),
    debug: (...a) => at('debug') && console.error(`[${ts()}] DEBUG`, ...a),
  };
}

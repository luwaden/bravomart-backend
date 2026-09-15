// A deliberately tiny logger. In a larger production system you'd reach for
// `pino` (structured JSON logs, shippable to a log aggregator) — but that's
// a whole extra concept to teach, and console.* piped through a timestamp
// prefix gets you 90% of the value with zero new dependencies. Swapping this
// out for pino later only means changing this one file: every other file
// calls `logger.info/warn/error`, never `console.*` directly.
type LogLevel = 'info' | 'warn' | 'error';

function write(level: LogLevel, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const suffix = meta !== undefined ? ` ${formatMeta(meta)}` : '';
  const line = `[${timestamp}] [${level.toUpperCase()}] ${message}${suffix}`;

  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function formatMeta(meta: unknown): string {
  if (meta instanceof Error) {
    return meta.stack ?? meta.message;
  }
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const logger = {
  info: (message: string, meta?: unknown): void => write('info', message, meta),
  warn: (message: string, meta?: unknown): void => write('warn', message, meta),
  error: (message: string, meta?: unknown): void => write('error', message, meta),
};

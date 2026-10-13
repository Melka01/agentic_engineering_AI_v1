/**
 * Minimal structured logger contract, signature-compatible with pino (and
 * therefore with Fastify's `app.log`): `logger.error({ ...fields }, 'message')`.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

/** JSON-lines logger writing to stderr. */
export function createJsonLogger(minLevel: LogLevel = 'info', write: (line: string) => void = defaultWrite): Logger {
  const emit = (level: LogLevel, fields: LogFields, message: string): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    write(JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields }));
  };
  return {
    debug: (f, m) => emit('debug', f, m),
    info: (f, m) => emit('info', f, m),
    warn: (f, m) => emit('warn', f, m),
    error: (f, m) => emit('error', f, m),
  };
}

function defaultWrite(line: string): void {
  process.stderr.write(`${line}\n`);
}

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

/** In-memory logger for tests and for attaching logs to diagnostics. */
export class MemoryLogger implements Logger {
  readonly entries: LogEntry[] = [];
  debug(fields: LogFields, message: string): void {
    this.entries.push({ level: 'debug', message, fields });
  }
  info(fields: LogFields, message: string): void {
    this.entries.push({ level: 'info', message, fields });
  }
  warn(fields: LogFields, message: string): void {
    this.entries.push({ level: 'warn', message, fields });
  }
  error(fields: LogFields, message: string): void {
    this.entries.push({ level: 'error', message, fields });
  }
  at(level: LogLevel): LogEntry[] {
    return this.entries.filter((e) => e.level === level);
  }
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

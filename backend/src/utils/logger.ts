export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const SILENT = () => process.env.NODE_ENV === 'test';

class Logger {
  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` | ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${level}] ${message}${metaStr}`;
  }

  debug(message: string, meta?: any) {
    if (SILENT()) return;
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`\x1b[34m${this.formatMessage(LogLevel.DEBUG, message, meta)}\x1b[0m`);
    }
  }

  info(message: string, meta?: any) {
    if (SILENT()) return;
    console.info(`\x1b[32m${this.formatMessage(LogLevel.INFO, message, meta)}\x1b[0m`);
  }

  warn(message: string, meta?: any) {
    if (SILENT()) return;
    console.warn(`\x1b[33m${this.formatMessage(LogLevel.WARN, message, meta)}\x1b[0m`);
  }

  error(message: string, meta?: any) {
    console.error(`\x1b[31m${this.formatMessage(LogLevel.ERROR, message, meta)}\x1b[0m`);
  }
}

export const logger = new Logger();

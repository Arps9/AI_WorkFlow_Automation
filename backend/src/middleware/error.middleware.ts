import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger';
import { env } from '../config/env.config';

export class AppError extends Error {
  constructor(message: string, public statusCode = 500, public isOperational = true) {
    super(message);
    Error.captureStackTrace(this, this.constructor);
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ success: false, error: { message: `Route not found: ${req.method} ${req.originalUrl}`, statusCode: 404 } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = Number(err?.statusCode || err?.status) || 500;
  let message = err?.message || 'Internal Server Error';

  if (err instanceof ZodError) {
    statusCode = 400;
    message = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  } else if (err?.name === 'CastError') {
    statusCode = 400;
    message = `Invalid id: ${err.value}`;
  } else if (err?.code === 11000) {
    statusCode = 409;
    message = 'Duplicate record';
  } else if (err?.type === 'entity.too.large') {
    statusCode = 413;
  } else if (/invalid_grant|Token has been expired or revoked/i.test(message)) {
    statusCode = 401;
    message = 'Google access expired or was revoked — reconnect Google on the Integrations page.';
  } else if (/insufficient.*(scope|permission)/i.test(message)) {
    statusCode = 403;
    message = 'Google permission missing — reconnect Google and approve all requested scopes.';
  }
  if (statusCode < 400 || statusCode > 599) statusCode = 500;

  (statusCode >= 500 ? logger.error : logger.warn).call(logger, `${req.method} ${req.originalUrl} → ${statusCode}: ${message}`, {
    stack: env.NODE_ENV === 'development' && statusCode >= 500 ? err?.stack : undefined,
  });

  res.status(statusCode).json({
    success: false,
    error: { message, statusCode, ...(env.NODE_ENV === 'development' && statusCode >= 500 ? { stack: err?.stack } : {}) },
  });
}

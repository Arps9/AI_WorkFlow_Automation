import { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wraps an async Express handler so thrown errors reach the global error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/** Truncates large objects before sending them to an LLM or storing them in logs. */
export function compact(value: any, maxChars = 4000): any {
  try {
    const str = JSON.stringify(value);
    if (!str || str.length <= maxChars) return value;
    return { truncated: true, preview: str.slice(0, maxChars) + '…' };
  } catch {
    return String(value).slice(0, maxChars);
  }
}

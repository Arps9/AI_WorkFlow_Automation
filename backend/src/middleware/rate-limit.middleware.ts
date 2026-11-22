import rateLimit from 'express-rate-limit';

const json = (message: string) => ({ success: false, error: { message, statusCode: 429 } });
const skip = () => process.env.NODE_ENV === 'test';

/** General API limit: 300 requests / 15 min per user (or IP when anonymous). */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?.id || req.ip || 'anon',
  message: json('Too many requests — please slow down.'),
  skip,
});

/** Brute-force protection for login/register: 20 attempts / 15 min per IP. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: json('Too many sign-in attempts — try again in 15 minutes.'),
  skip,
});

/** AI endpoints are costly: 40 requests / minute per user. */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).user?.id || req.ip || 'anon',
  message: json('AI rate limit reached — wait a minute.'),
  skip,
});

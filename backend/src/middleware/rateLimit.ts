/**
 * Rate Limiting Middleware
 * Fix for missing rate limiting on auth/sensitive routes
 *
 * Usage:
 *   import { authLimiter, apiLimiter, strictLimiter } from './middleware/rateLimit';
 *   router.post('/login', authLimiter, loginHandler);
 *   router.use('/api/', apiLimiter);
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { Request, Response } from 'express';

const rateLimitHandler = (_req: Request, res: Response): void => {
  res.status(429).json({
    error:   'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please try again later.',
    retryAfter: res.getHeader('Retry-After'),
  });
};

/** Auth endpoints: 10 attempts per 15 minutes */
export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
  skipSuccessfulRequests: false,
});

/** General API: 100 requests per minute */
export const apiLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});

/** Strict: password reset, email verify — 5 per hour */
export const strictLimiter: RateLimitRequestHandler = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         rateLimitHandler,
});
/**
 * Rate Limiting Middleware
 * 
 * Fixes:
 * - Issue #15: Weak rate limiting (only by IP)
 * - Issue #76: No rate limit on password reset
 * - Issue #82: Rate limiting per user
 * 
 * Implements multi-level rate limiting:
 * - Global (by IP)
 * - Per user (authenticated requests)
 * - Per endpoint (sensitive operations)
 */

import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';
import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/environment';
import Redis from 'ioredis';

const config = getConfig();

// Redis client for distributed rate limiting (optional)
let redis: Redis | null = null;
if (config.REDIS_URL) {
  redis = new Redis(config.REDIS_URL);
}

/**
 * Global rate limiter (IP-based)
 * Issue #15 fix - stricter limits
 */
export const globalRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS, // 15 minutes
  max: config.RATE_LIMIT_MAX_REQUESTS, // 100 requests per window
  message: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful requests in count (only count errors/failures)
  skip: (req: Request) => {
    return req.method === 'GET' && !req.path.includes('/admin');
  }
});

/**
 * Authentication rate limiter
 * Very strict limits for login/register endpoints
 */
export const authRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.AUTH_RATE_LIMIT_MAX, // 5 attempts
  message: {
    code: 'TOO_MANY_AUTH_ATTEMPTS',
    message: 'Too many authentication attempts. Please try again in 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Only count failed attempts
});

/**
 * Password reset rate limiter
 * Issue #76 fix - 3 resets per email per hour
 */
export const passwordResetRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: {
    code: 'TOO_MANY_RESET_REQUESTS',
    message: 'Too many password reset requests. Please try again in 1 hour.'
  },
  keyGenerator: (req: Request) => {
    // Rate limit by email address
    return req.body.email || req.ip || 'unknown';
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Per-user rate limiter (for authenticated requests)
 * Issue #82 fix
 */
const userRateLimiter = redis
  ? new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl_user',
      points: 200, // Number of requests
      duration: 900, // Per 15 minutes
      blockDuration: 300 // Block for 5 minutes if exceeded
    })
  : new RateLimiterMemory({
      points: 200,
      duration: 900,
      blockDuration: 300
    });

/**
 * Middleware: Rate limit per authenticated user
 */
export async function perUserRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Only apply to authenticated users
  if (!req.user?.userId) {
    return next();
  }

  const key = `user_${req.user.userId}`;

  try {
    await userRateLimiter.consume(key);
    next();
  } catch (error: any) {
    // Rate limit exceeded
    const retrySecs = Math.round(error.msBeforeNext / 1000) || 300;
    
    res.set('Retry-After', String(retrySecs));
    res.status(429).json({
      code: 'USER_RATE_LIMIT_EXCEEDED',
      message: `Too many requests. Please try again in ${retrySecs} seconds.`,
      retryAfter: retrySecs
    });
  }
}

/**
 * Sensitive operation rate limiter
 * For operations like changing email, deleting account, etc.
 */
const sensitiveOpLimiter = redis
  ? new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl_sensitive',
      points: 3, // Only 3 attempts
      duration: 3600, // Per hour
      blockDuration: 3600 // Block for 1 hour if exceeded
    })
  : new RateLimiterMemory({
      points: 3,
      duration: 3600,
      blockDuration: 3600
    });

/**
 * Middleware: Rate limit sensitive operations
 */
export async function sensitiveOperationRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const key = req.user?.userId 
    ? `user_${req.user.userId}_${req.path}` 
    : `ip_${req.ip}_${req.path}`;

  try {
    await sensitiveOpLimiter.consume(key);
    next();
  } catch (error: any) {
    const retrySecs = Math.round(error.msBeforeNext / 1000) || 3600;
    
    res.set('Retry-After', String(retrySecs));
    res.status(429).json({
      code: 'SENSITIVE_OP_RATE_LIMIT',
      message: `Too many sensitive operations. Please try again in ${Math.round(retrySecs / 60)} minutes.`,
      retryAfter: retrySecs
    });
  }
}

/**
 * API endpoint rate limiter
 * Different limits for different endpoint types
 */
export function createEndpointRateLimiter(config: {
  points: number;
  duration: number;
  endpointName: string;
}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const limiter = redis
    ? new RateLimiterRedis({
        storeClient: redis,
        keyPrefix: `rl_${config.endpointName}`,
        points: config.points,
        duration: config.duration
      })
    : new RateLimiterMemory({
        points: config.points,
        duration: config.duration
      });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.user?.userId 
      ? `user_${req.user.userId}` 
      : `ip_${req.ip}`;

    try {
      await limiter.consume(key);
      next();
    } catch (error: any) {
      const retrySecs = Math.round(error.msBeforeNext / 1000) || config.duration;
      
      res.set('Retry-After', String(retrySecs));
      res.status(429).json({
        code: 'ENDPOINT_RATE_LIMIT_EXCEEDED',
        message: `Too many requests to ${config.endpointName}. Please try again later.`,
        retryAfter: retrySecs
      });
    }
  };
}

/**
 * Cleanup function for graceful shutdown
 */
export async function closeRateLimiters(): Promise<void> {
  if (redis) {
    await redis.quit();
  }
}

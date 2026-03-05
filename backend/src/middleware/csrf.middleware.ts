/**
 * CSRF Protection Middleware
 * 
 * Fixes:
 * - Issue #79: No CSRF protection
 * 
 * Implements CSRF token validation for all state-changing requests
 */

import csrf from 'csurf';
import cookieParser from 'cookie-parser';
import { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/environment';

const config = getConfig();

/**
 * Cookie parser middleware (required for CSRF)
 */
export const cookieParserMiddleware = cookieParser(config.COOKIE_SECRET);

/**
 * CSRF protection middleware
 * 
 * Validates CSRF tokens on all POST, PUT, PATCH, DELETE requests
 */
export const csrfProtection = csrf({
  cookie: {
    httpOnly: true,
    secure: config.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'strict',
    maxAge: 3600000 // 1 hour
  }
});

/**
 * CSRF token provider endpoint
 * GET /csrf-token
 */
export function provideCsrfToken(req: Request, res: Response): void {
  res.json({
    csrfToken: req.csrfToken()
  });
}

/**
 * CSRF error handler
 * Provides user-friendly error messages for CSRF failures
 */
export function csrfErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err.code === 'EBADCSRFTOKEN') {
    res.status(403).json({
      code: 'INVALID_CSRF_TOKEN',
      message: 'Invalid or missing CSRF token. Please refresh the page and try again.'
    });
    return;
  }
  
  next(err);
}

/**
 * Conditional CSRF protection
 * Skip CSRF for specific routes (e.g., webhooks, API keys)
 */
export function conditionalCsrf(exemptPaths: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip CSRF for exempt paths
    if (exemptPaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    // Skip CSRF for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    
    // Apply CSRF protection
    csrfProtection(req, res, next);
  };
}

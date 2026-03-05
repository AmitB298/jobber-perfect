/**
 * Request Tracking & Validation Middleware
 * 
 * Fixes:
 * - Issue #27: No request ID tracking
 * - Issue #85: No content-type validation
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../utils/errors';

/**
 * Request ID middleware
 * Issue #27 fix - adds unique ID to every request for tracking
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  // Use existing request ID from header or generate new one
  const requestId = (req.headers['x-request-id'] as string) || uuidv4();
  
  // Attach to request object
  req.id = requestId;
  
  // Add to response headers for client tracking
  res.setHeader('X-Request-Id', requestId);
  
  next();
}

/**
 * Logging middleware with request ID
 * Logs all requests with their unique ID
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  // Log request
  console.log(`[${req.id}] ${req.method} ${req.path}`);
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'ERROR' : 'INFO';
    
    console.log(
      `[${req.id}] ${level} ${req.method} ${req.path} ${res.statusCode} ${duration}ms`
    );
  });
  
  next();
}

/**
 * Content-Type validation middleware
 * Issue #85 fix - validates Content-Type header for state-changing requests
 */
export function validateContentType(req: Request, res: Response, next: NextFunction): void {
  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  
  const contentType = req.headers['content-type'];
  
  // Require Content-Type header
  if (!contentType) {
    throw new AppError(
      415,
      'MISSING_CONTENT_TYPE',
      'Content-Type header is required for this request'
    );
  }
  
  // Validate Content-Type is application/json
  if (!contentType.includes('application/json')) {
    throw new AppError(
      415,
      'INVALID_CONTENT_TYPE',
      'Content-Type must be application/json'
    );
  }
  
  next();
}

/**
 * Security headers middleware
 * Adds various security headers to responses
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS filter in browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );
  
  next();
}

/**
 * Request size limit validation
 * Prevents large payloads from overwhelming the server
 */
export function validateRequestSize(maxSize: number = 10485760) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    
    if (contentLength > maxSize) {
      throw new AppError(
        413,
        'PAYLOAD_TOO_LARGE',
        `Request payload too large. Maximum size: ${maxSize} bytes`
      );
    }
    
    next();
  };
}

/**
 * Extend Express Request type to include id
 */
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

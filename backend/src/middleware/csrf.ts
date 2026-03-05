/**
 * CSRF Protection Middleware
 * Fix for Issue #7 from Analyze-JobberProject.ps1 findings
 *
 * Usage in index.ts / app.ts:
 *   import { csrfProtection, getCsrfToken } from './middleware/csrf';
 *   app.use(cookieParser(process.env.COOKIE_SECRET));
 *   app.use(csrfProtection);
 *   app.get('/api/csrf-token', getCsrfToken);  // Expose token to frontend
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_TOKEN_HEADER = 'x-csrf-token';
const CSRF_COOKIE_NAME  = '_csrf';
const CSRF_TOKEN_LENGTH = 32;
const TOKEN_TTL_MS      = 1000 * 60 * 60; // 1 hour

interface CsrfStore {
  token: string;
  expiresAt: number;
}

// In-memory store (replace with Redis for multi-instance deployments)
const tokenStore = new Map<string, CsrfStore>();

function generateToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

function cleanExpiredTokens(): void {
  const now = Date.now();
  tokenStore.forEach((v, k) => { if (v.expiresAt < now) tokenStore.delete(k); });
}

/**
 * Middleware: validates CSRF token on state-changing requests.
 * GET/HEAD/OPTIONS are exempt (safe methods per RFC 7231).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) { next(); return; }

  const sessionToken = (req.cookies as Record<string,string>)[CSRF_COOKIE_NAME];
  const headerToken  = req.get(CSRF_TOKEN_HEADER);

  if (!sessionToken || !headerToken) {
    res.status(403).json({ error: 'CSRF_TOKEN_MISSING', message: 'CSRF token required' });
    return;
  }

  const stored = tokenStore.get(sessionToken);
  if (!stored || stored.expiresAt < Date.now()) {
    tokenStore.delete(sessionToken!);
    res.status(403).json({ error: 'CSRF_TOKEN_EXPIRED', message: 'CSRF token expired' });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  const a = Buffer.from(headerToken,       'hex');
  const b = Buffer.from(stored.token,     'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(403).json({ error: 'CSRF_TOKEN_INVALID', message: 'Invalid CSRF token' });
    return;
  }

  next();
}

/**
 * Route handler: issues a CSRF token cookie + returns it in JSON.
 * Call GET /api/csrf-token before any state-changing request.
 */
export function getCsrfToken(req: Request, res: Response): void {
  cleanExpiredTokens();
  const token      = generateToken();
  const sessionKey = generateToken();

  tokenStore.set(sessionKey, { token, expiresAt: Date.now() + TOKEN_TTL_MS });

  res.cookie(CSRF_COOKIE_NAME, sessionKey, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge:   TOKEN_TTL_MS,
  });

  res.json({ csrfToken: token });
}
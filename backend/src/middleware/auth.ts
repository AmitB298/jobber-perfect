import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { query } from '../database/db';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        plan: string;
      };
    }
  }
}

/**
 * Middleware to verify JWT access token
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ message: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);

    // Verify token
    const payload = verifyAccessToken(token);

    // Check if user still exists and is active
    const result = await query(
      'SELECT id, email, plan, status FROM users WHERE id = $1',
      [payload.userId]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ message: 'User not found' });
      return;
    }

    const user = result.rows[0];

    if (user.status !== 'ACTIVE') {
      res.status(403).json({ message: 'Account suspended or blocked' });
      return;
    }

    // Attach user to request
    req.user = {
      userId: user.id,
      email: user.email,
      plan: user.plan
    };

    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};

/**
 * Middleware to check if user has valid trial or subscription
 */
export const checkTrialValid = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const result = await query(
      `SELECT plan, trial_end_date, subscription_end_date 
       FROM users WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const user = result.rows[0];

    // Check if paid user
    if (user.plan === 'PAID') {
      // Check subscription expiry
      if (user.subscription_end_date && new Date(user.subscription_end_date) < new Date()) {
        res.status(403).json({ message: 'Subscription expired' });
        return;
      }
      next();
      return;
    }

    // Check trial
    if (user.plan === 'TRIAL') {
      if (new Date(user.trial_end_date) < new Date()) {
        // Expire the trial
        await query(
          'UPDATE users SET plan = $1 WHERE id = $2',
          ['EXPIRED', req.user.userId]
        );
        res.status(403).json({ message: 'Trial expired. Please upgrade.' });
        return;
      }
      next();
      return;
    }

    // Plan is EXPIRED
    res.status(403).json({ message: 'Trial expired. Please upgrade.' });
  } catch (error) {
    console.error('Trial check error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * Middleware to require specific plan
 */
export const requirePlan = (requiredPlan: 'TRIAL' | 'PAID') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const result = await query(
      'SELECT plan FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const user = result.rows[0];

    if (requiredPlan === 'PAID' && user.plan !== 'PAID') {
      res.status(403).json({ message: 'This feature requires a paid subscription' });
      return;
    }

    next();
  };
};

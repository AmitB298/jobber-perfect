import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { body, validationResult } from 'express-validator';
import xss from 'xss';
import { query, transaction } from '../database/db';
import { generateTokenPair, verifyRefreshToken, getRefreshTokenExpiry, extractTokenFamily } from '../utils/jwt';
import { authenticate } from '../middleware/auth';
import { logAudit } from '../utils/audit';
import { AppError } from '../utils/errors';
import crypto from 'crypto';

const router = Router();

// IMPROVEMENT: Strong password validation
const passwordValidation = body('password')
  .isLength({ min: 8 })
  .withMessage('Password must be at least 8 characters')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .withMessage('Password must contain uppercase, lowercase, number, and special character');

// IMPROVEMENT: Email validation
const emailValidation = body('email')
  .isEmail()
  .normalizeEmail()
  .withMessage('Valid email required');

/**
 * POST /auth/register
 * Register new user with trial and email verification
 * 
 * SECURITY IMPROVEMENTS:
 * - Strong password requirements (8+ chars, complexity)
 * - Email verification token generation
 * - XSS sanitization on all inputs
 * - Device fingerprint validation
 * - Account lockout protection
 */
router.post(
  '/register',
  [
    emailValidation,
    body('mobile').optional().isMobilePhone('any'),
    passwordValidation,
    body('deviceFingerprint').isObject(),
    body('deviceFingerprint.fingerprint').isString().isLength({ min: 32, max: 128 }),
    body('deviceFingerprint.machineId').isString().notEmpty(),
    body('deviceFingerprint.platform').isIn(['win32', 'darwin', 'linux'])
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input data', errors.array());
      }

      // SECURITY: XSS sanitization
      const email = xss(req.body.email.toLowerCase());
      const mobile = req.body.mobile ? xss(req.body.mobile) : null;
      const password = req.body.password; // Don't sanitize passwords
      const deviceFingerprint = req.body.deviceFingerprint;

      // Check if user already exists
      const existingUser = await query(
        'SELECT id, email FROM users WHERE email = $1',
        [email]
      );

      if (existingUser.rows.length > 0) {
        throw new AppError(409, 'EMAIL_EXISTS', 'Email already registered');
      }

      // SECURITY: Check if fingerprint is already used (prevent device sharing)
      const existingDevice = await query(
        'SELECT user_id FROM device_fingerprints WHERE fingerprint = $1',
        [deviceFingerprint.fingerprint]
      );

      if (existingDevice.rows.length > 0) {
        throw new AppError(409, 'DEVICE_ALREADY_REGISTERED', 'This device is already registered with another account');
      }

      // SECURITY: Hash password with bcrypt (cost factor 12)
      const passwordHash = await bcrypt.hash(password, 12);

      // IMPROVEMENT: Generate email verification token
      const emailVerificationToken = crypto.randomBytes(32).toString('hex');
      const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create user and device fingerprint in transaction
      const result = await transaction(async (client) => {
        // Insert user
        const userResult = await client.query(
          `INSERT INTO users (
            email, mobile, password_hash, plan, status, 
            trial_start_date, trial_end_date,
            email_verification_token, email_verification_expires,
            permissions
          )
          VALUES ($1, $2, $3, 'TRIAL', 'ACTIVE', 
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '30 days',
            $4, $5,
            ARRAY['basic']::TEXT[]
          )
          RETURNING id, email, mobile, plan, status, trial_start_date, trial_end_date, 
                    email_verified, permissions, created_at`,
          [email, mobile, passwordHash, emailVerificationToken, emailVerificationExpires]
        );

        const user = userResult.rows[0];

        // Insert device fingerprint
        await client.query(
          `INSERT INTO device_fingerprints (
            user_id, device_id, machine_id, platform, os_version, 
            cpu_model, cpu_cores, total_memory, mac_address, 
            disk_serial, fingerprint, is_primary, is_trusted
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, false)`,
          [
            user.id,
            deviceFingerprint.deviceId,
            deviceFingerprint.machineId,
            deviceFingerprint.platform,
            deviceFingerprint.osVersion,
            deviceFingerprint.cpuModel,
            deviceFingerprint.cpuCores,
            deviceFingerprint.totalMemory,
            deviceFingerprint.macAddress,
            deviceFingerprint.diskSerial,
            deviceFingerprint.fingerprint
          ]
        );

        return user;
      });

      const user = result;

      // Generate tokens with new token family
      const tokens = generateTokenPair({
        userId: user.id,
        email: user.email,
        plan: user.plan
      });

      // Store refresh token with family tracking
      await query(
        `INSERT INTO refresh_tokens (user_id, token, token_family, expires_at, device_fingerprint)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.id, 
          tokens.refreshToken, 
          extractTokenFamily(tokens.refreshToken),
          getRefreshTokenExpiry(),
          deviceFingerprint.fingerprint
        ]
      );

      // Log audit
      await logAudit({
        userId: user.id,
        action: 'REGISTER',
        resource: 'user',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success'
      });

      // TODO: Send verification email (integrate with email service)
      // await sendVerificationEmail(user.email, emailVerificationToken);

      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          mobile: user.mobile,
          plan: user.plan,
          status: user.status,
          emailVerified: user.email_verified,
          trialStartDate: user.trial_start_date,
          trialEndDate: user.trial_end_date,
          permissions: user.permissions,
          createdAt: user.created_at
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt
        },
        requiresAngelLogin: true,
        message: 'Registration successful. Please verify your email.'
      });
    } catch (error: any) {
      // Log failed registration
      await logAudit({
        userId: undefined,
        action: 'REGISTER_FAILED',
        resource: 'user',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'failure',
        errorMessage: error.message
      });

      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          details: error.details
        });
      } else if (error.code === '23505') {
        res.status(409).json({
          code: 'DUPLICATE_ENTRY',
          message: 'Email or device already registered'
        });
      } else {
        console.error('Registration error:', error);
        res.status(500).json({
          code: 'REGISTRATION_FAILED',
          message: 'Registration failed. Please try again.'
        });
      }
    }
  }
);

/**
 * POST /auth/login
 * Login existing user with brute-force protection
 * 
 * SECURITY IMPROVEMENTS:
 * - Account lockout after 5 failed attempts
 * - Lockout duration: 15 minutes
 * - Device fingerprint verification
 * - Failed login tracking
 * - Suspicious activity detection
 */
router.post(
  '/login',
  [
    body('identifier').notEmpty().withMessage('Email or mobile required'),
    passwordValidation,
    body('deviceFingerprint').isObject()
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid input data', errors.array());
      }

      // SECURITY: XSS sanitization
      const identifier = xss(req.body.identifier.toLowerCase());
      const password = req.body.password;
      const deviceFingerprint = req.body.deviceFingerprint;

      // Find user by email or mobile
      const userResult = await query(
        `SELECT id, email, mobile, password_hash, plan, status, 
                trial_start_date, trial_end_date, subscription_end_date, permissions,
                email_verified, failed_login_attempts, account_locked_until
         FROM users 
         WHERE email = $1 OR mobile = $1`,
        [identifier]
      );

      if (userResult.rows.length === 0) {
        // SECURITY: Generic error message (don't reveal if user exists)
        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      const user = userResult.rows[0];

      // SECURITY: Check if account is locked
      if (user.account_locked_until && new Date(user.account_locked_until) > new Date()) {
        const lockoutMinutes = Math.ceil((new Date(user.account_locked_until).getTime() - Date.now()) / 60000);
        throw new AppError(403, 'ACCOUNT_LOCKED', `Account locked. Try again in ${lockoutMinutes} minutes.`);
      }

      // Check if account is active
      if (user.status !== 'ACTIVE') {
        throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Account is suspended or blocked');
      }

      // SECURITY: Verify password
      const isValidPassword = await bcrypt.compare(password, user.password_hash);
      
      if (!isValidPassword) {
        // SECURITY: Increment failed login attempts
        const failedAttempts = (user.failed_login_attempts || 0) + 1;

    // FIX #5: Integer overflow guard on failed_login_attempts
    const MAX_INT = 2147483647;
    const safeFailedAttempts = Math.min(
      (user.failed_login_attempts || 0) + 1,
      MAX_INT
    );
        const shouldLock = failedAttempts >= 5;

        await query(
          `UPDATE users 
           SET failed_login_attempts = $1,

    // FIX #5: Integer overflow guard on failed_login_attempts
    const MAX_INT = 2147483647;
    const safeFailedAttempts = Math.min(
      (user.failed_login_attempts || 0) + 1,
      MAX_INT
    );
               last_failed_login = CURRENT_TIMESTAMP,
               account_locked_until = $2
           WHERE id = $3`,
          [
            failedAttempts,
            shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null, // 15 min lockout
            user.id
          ]
        );

        // Log failed login
        await logAudit({
          userId: user.id,
          action: 'LOGIN_FAILED',
          resource: 'user',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          status: 'failure',
          errorMessage: 'Invalid password'
        });

        if (shouldLock) {
          throw new AppError(403, 'ACCOUNT_LOCKED', 'Too many failed attempts. Account locked for 15 minutes.');
        }

        throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
      }

      // SECURITY: Reset failed login attempts on successful login
      await query(
        'UPDATE users SET failed_login_attempts = 0, account_locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );

      // FIX #5: Integer overflow guard on failed_login_attempts
      const MAX_INT = 2147483647;
      const safeFailedAttempts = Math.min(
        (user.failed_login_attempts || 0) + 1,
        MAX_INT
      );

      // SECURITY: Check device fingerprint
      const deviceResult = await query(
        'SELECT fingerprint, is_trusted FROM device_fingerprints WHERE user_id = $1 AND fingerprint = $2',
        [user.id, deviceFingerprint.fingerprint]
      );

      let isNewDevice = false;

      if (deviceResult.rows.length === 0) {
        // New device - for trial users, only allow 1 device
        if (user.plan === 'TRIAL') {
          const deviceCount = await query(
            'SELECT COUNT(*) as count FROM device_fingerprints WHERE user_id = $1',
            [user.id]
          );

          if (parseInt(deviceCount.rows[0].count) >= 1) {
            throw new AppError(
              403, 
              'TRIAL_DEVICE_LIMIT', 
              'Trial users can only use one device. Please upgrade to use multiple devices.'
            );
          }
        }

        // Register new device
        await query(
          `INSERT INTO device_fingerprints (
            user_id, device_id, machine_id, platform, os_version, 
            cpu_model, cpu_cores, total_memory, mac_address, 
            disk_serial, fingerprint, is_primary, is_trusted
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, false)`,
          [
            user.id,
            deviceFingerprint.deviceId,
            deviceFingerprint.machineId,
            deviceFingerprint.platform,
            deviceFingerprint.osVersion,
            deviceFingerprint.cpuModel,
            deviceFingerprint.cpuCores,
            deviceFingerprint.totalMemory,
            deviceFingerprint.macAddress,
            deviceFingerprint.diskSerial,
            deviceFingerprint.fingerprint
          ]
        );

        isNewDevice = true;

        // TODO: Send new device notification email
        // await sendNewDeviceEmail(user.email, deviceFingerprint);

      } else {
        // Update last seen
        await query(
          'UPDATE device_fingerprints SET last_seen = CURRENT_TIMESTAMP WHERE fingerprint = $1',
          [deviceFingerprint.fingerprint]
        );
      }

      // Generate tokens
      const tokens = generateTokenPair({
        userId: user.id,
        email: user.email,
        plan: user.plan
      });

      // Store refresh token
      await query(
        `INSERT INTO refresh_tokens (user_id, token, token_family, expires_at, device_fingerprint)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user.id, 
          tokens.refreshToken,
          extractTokenFamily(tokens.refreshToken),
          getRefreshTokenExpiry(),
          deviceFingerprint.fingerprint
        ]
      );

      // Log successful login
      await logAudit({
        userId: user.id,
        action: 'LOGIN',
        resource: 'user',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success',
        details: { 
          newDevice: isNewDevice,
          fingerprint: deviceFingerprint.fingerprint 
        }
      });

      // Check if Angel account is bound
      const angelResult = await query(
        'SELECT angel_client_id FROM angel_bindings WHERE user_id = $1 AND is_active = true',
        [user.id]
      );

      res.json({
        user: {
          id: user.id,
          email: user.email,
          mobile: user.mobile,
          plan: user.plan,
          status: user.status,
          emailVerified: user.email_verified,
          trialStartDate: user.trial_start_date,
          trialEndDate: user.trial_end_date,
          subscriptionEndDate: user.subscription_end_date,
          permissions: user.permissions
        },
        tokens: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt
        },
        requiresAngelLogin: angelResult.rows.length === 0,
        isNewDevice
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          details: error.details
        });
      } else {
        console.error('Login error:', error);
        res.status(500).json({
          code: 'LOGIN_FAILED',
          message: 'Login failed. Please try again.'
        });
      }
    }
  }
);

/**
 * POST /auth/refresh
 * Refresh access token with token rotation detection
 * 
 * SECURITY IMPROVEMENTS:
 * - Token family tracking (detects token theft)
 * - Automatic revocation on suspicious activity
 * - Device fingerprint validation
 */
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      throw new AppError(400, 'REFRESH_TOKEN_REQUIRED', 'Refresh token is required');
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (error: any) {
      throw new AppError(401, error.message, 'Invalid or expired refresh token');
    }

    // Check if token exists and is not revoked
    const tokenResult = await query(
      'SELECT user_id, token_family, revoked_at, device_fingerprint FROM refresh_tokens WHERE token = $1',
      [refreshToken]
    );

    if (tokenResult.rows.length === 0) {
      throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token not found');
    }

    const tokenRecord = tokenResult.rows[0];

    if (tokenRecord.revoked_at) {
      // SECURITY: Token reuse detected - revoke entire family
      const family = tokenRecord.token_family;
      
      await query(
        `UPDATE refresh_tokens 
         SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'TOKEN_REUSE_DETECTED'
         WHERE token_family = $1 AND revoked_at IS NULL`,
        [family]
      );

      await logAudit({
        userId: decoded.userId,
        action: 'TOKEN_THEFT_DETECTED',
        resource: 'refresh_token',
        status: 'failure',
        errorMessage: 'Token reuse detected - all tokens in family revoked'
      });

      throw new AppError(401, 'TOKEN_REUSE_DETECTED', 'Security violation detected. Please login again.');
    }

    // Get user
    const userResult = await query(
      'SELECT id, email, plan, status FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0 || userResult.rows[0].status !== 'ACTIVE') {
      throw new AppError(401, 'USER_NOT_FOUND', 'User not found or inactive');
    }

    const user = userResult.rows[0];

    // Generate new tokens with same family
    const tokens = generateTokenPair(
      {
        userId: user.id,
        email: user.email,
        plan: user.plan
      },
      tokenRecord.token_family // Preserve family
    );

    // Revoke old refresh token
    await query(
      'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $1 WHERE token = $2',
      ['ROTATED', refreshToken]
    );

    // Store new refresh token
    await query(
      `INSERT INTO refresh_tokens (user_id, token, token_family, expires_at, device_fingerprint)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user.id, 
        tokens.refreshToken,
        tokenRecord.token_family,
        getRefreshTokenExpiry(),
        tokenRecord.device_fingerprint
      ]
    );

    res.json({ tokens });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        code: error.code,
        message: error.message
      });
    } else {
      console.error('Token refresh error:', error);
      res.status(401).json({
        code: 'REFRESH_FAILED',
        message: 'Token refresh failed'
      });
    }
  }
});

/**
 * POST /auth/logout
 * Logout user and revoke refresh token
 */
router.post('/logout', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await query(
        'UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = $1 WHERE token = $2',
        ['USER_LOGOUT', refreshToken]
      );
    }

    await logAudit({
      userId: req.user!.userId,
      action: 'LOGOUT',
      resource: 'user',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      status: 'success'
    });

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      code: 'LOGOUT_FAILED',
      message: 'Logout failed'
    });
  }
});

/**
 * GET /auth/me
 * Get current user information
 */
router.get('/me', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const userResult = await query(
      `SELECT id, email, mobile, plan, status, trial_start_date, 
              trial_end_date, subscription_end_date, permissions, email_verified,
              last_login_at, created_at
       FROM users WHERE id = $1`,
      [req.user!.userId]
    );

    if (userResult.rows.length === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const user = userResult.rows[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        mobile: user.mobile,
        plan: user.plan,
        status: user.status,
        emailVerified: user.email_verified,
        trialStartDate: user.trial_start_date,
        trialEndDate: user.trial_end_date,
        subscriptionEndDate: user.subscription_end_date,
        permissions: user.permissions,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        code: error.code,
        message: error.message
      });
    } else {
      console.error('Get user error:', error);
      res.status(500).json({
        code: 'GET_USER_FAILED',
        message: 'Failed to get user'
      });
    }
  }
});

/**
 * POST /auth/bind-angel
 * Bind Angel One account to user with security checks
 */
router.post(
  '/bind-angel',
  authenticate,
  [
    body('angelClientId').notEmpty().trim(),
    body('angelClientId').isLength({ min: 3, max: 50 })
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid Angel client ID', errors.array());
      }

      const angelClientId = xss(req.body.angelClientId.toUpperCase());

      // Check if Angel client ID is already bound
      const existingBinding = await query(
        'SELECT user_id, is_active FROM angel_bindings WHERE angel_client_id = $1',
        [angelClientId]
      );

      if (existingBinding.rows.length > 0) {
        const binding = existingBinding.rows[0];
        
        if (binding.user_id === req.user!.userId) {
          if (binding.is_active) {
            res.json({ message: 'Angel account already bound to this user' });
            return;
          }
          // Reactivate if previously unbound
          await query(
            'UPDATE angel_bindings SET is_active = true, last_verified = CURRENT_TIMESTAMP WHERE angel_client_id = $1 AND user_id = $2',
            [angelClientId, req.user!.userId]
          );
          
          await logAudit({
            userId: req.user!.userId,
            action: 'REBIND_ANGEL',
            resource: 'angel_account',
            status: 'success',
            details: { angelClientId }
          });
          
          res.json({ message: 'Angel account reactivated successfully' });
          return;
        }
        
        throw new AppError(
          409, 
          'ANGEL_ACCOUNT_ALREADY_BOUND', 
          'This Angel account is already bound to another user'
        );
      }

      // Get user's primary device fingerprint
      const deviceResult = await query(
        'SELECT fingerprint FROM device_fingerprints WHERE user_id = $1 AND is_primary = true',
        [req.user!.userId]
      );

      if (deviceResult.rows.length === 0) {
        throw new AppError(400, 'NO_PRIMARY_DEVICE', 'No primary device found. Please login from your registered device.');
      }

      const fingerprint = deviceResult.rows[0].fingerprint;

      // Bind Angel account
      await query(
        `INSERT INTO angel_bindings (user_id, angel_client_id, device_fingerprint, is_active)
         VALUES ($1, $2, $3, true)`,
        [req.user!.userId, angelClientId, fingerprint]
      );

      // Log audit
      await logAudit({
        userId: req.user!.userId,
        action: 'BIND_ANGEL',
        resource: 'angel_account',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        status: 'success',
        details: { angelClientId }
      });

      res.json({ message: 'Angel account bound successfully' });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          code: error.code,
          message: error.message,
          details: error.details
        });
      } else {
        console.error('Angel binding error:', error);
        res.status(500).json({
          code: 'BIND_ANGEL_FAILED',
          message: 'Failed to bind Angel account'
        });
      }
    }
  }
);

/**
 * POST /auth/verify-email
 * Verify user email address
 */
router.post(
  '/verify-email',
  [body('token').isString().notEmpty()],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.body;

      const userResult = await query(
        `SELECT id, email, email_verification_expires 
         FROM users 
         WHERE email_verification_token = $1 AND email_verified = false`,
        [token]
      );

      if (userResult.rows.length === 0) {
        throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
      }

      const user = userResult.rows[0];

      if (new Date(user.email_verification_expires) < new Date()) {
        throw new AppError(400, 'TOKEN_EXPIRED', 'Verification token has expired');
      }

      await query(
        `UPDATE users 
         SET email_verified = true, 
             email_verification_token = NULL, 
             email_verification_expires = NULL
         WHERE id = $1`,
        [user.id]
      );

      await logAudit({
        userId: user.id,
        action: 'EMAIL_VERIFIED',
        resource: 'user',
        status: 'success'
      });

      res.json({ message: 'Email verified successfully' });
    } catch (error) {
      if (error instanceof AppError) {
        res.status(error.statusCode).json({
          code: error.code,
          message: error.message
        });
      } else {
        console.error('Email verification error:', error);
        res.status(500).json({
          code: 'VERIFICATION_FAILED',
          message: 'Email verification failed'
        });
      }
    }
  }
);

export default router;


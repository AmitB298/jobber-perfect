/**
 * Custom Application Error
 * Provides consistent error handling across the application
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: any;
  public readonly isOperational: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: any,
    isOperational: boolean = true
  ) {
    super(message);
    
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
    
    // Set prototype explicitly for TypeScript
    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Convert error to JSON response format
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack })
    };
  }
}

/**
 * Common error codes
 */
export const ErrorCodes = {
  // Authentication
  AUTH_FAILED: 'AUTH_FAILED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  
  // Authorization
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  
  // Trial/Subscription
  TRIAL_EXPIRED: 'TRIAL_EXPIRED',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  TRIAL_DEVICE_LIMIT: 'TRIAL_DEVICE_LIMIT',
  
  // Security
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR'
} as const;

/**
 * Predefined error factories
 */
export const Errors = {
  authFailed: (message = 'Authentication failed') =>
    new AppError(401, ErrorCodes.AUTH_FAILED, message),
  
  unauthorized: (message = 'Unauthorized access') =>
    new AppError(401, ErrorCodes.UNAUTHORIZED, message),
  
  forbidden: (message = 'Access forbidden') =>
    new AppError(403, ErrorCodes.FORBIDDEN, message),
  
  notFound: (resource = 'Resource', message?: string) =>
    new AppError(404, ErrorCodes.NOT_FOUND, message || `${resource} not found`),
  
  validationError: (details: any) =>
    new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Validation failed', details),
  
  alreadyExists: (resource = 'Resource') =>
    new AppError(409, ErrorCodes.ALREADY_EXISTS, `${resource} already exists`),
  
  trialExpired: () =>
    new AppError(403, ErrorCodes.TRIAL_EXPIRED, 'Trial period has expired. Please upgrade to continue.'),
  
  accountLocked: (minutes?: number) =>
    new AppError(403, ErrorCodes.ACCOUNT_LOCKED, 
      minutes 
        ? `Account locked. Try again in ${minutes} minutes.`
        : 'Account is locked. Please contact support.'
    ),
  
  rateLimitExceeded: () =>
    new AppError(429, ErrorCodes.RATE_LIMIT_EXCEEDED, 'Too many requests. Please try again later.'),
  
  internalError: (message = 'Internal server error') =>
    new AppError(500, ErrorCodes.INTERNAL_ERROR, message, undefined, false),
  
  databaseError: (message = 'Database operation failed') =>
    new AppError(500, ErrorCodes.DATABASE_ERROR, message, undefined, false)
};

/**
 * Check if error is operational (expected) or programming error
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

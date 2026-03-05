/**
 * Application Constants
 * 
 * Fixes:
 * - Issue #21: Magic numbers throughout codebase
 * - Issue #30: Hardcoded strings (enums)
 * 
 * All magic numbers and string literals extracted to named constants
 */

/**
 * User Plan Types
 */
export enum UserPlan {
  TRIAL = 'TRIAL',
  PAID = 'PAID',
  EXPIRED = 'EXPIRED'
}

/**
 * User Status
 */
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  BLOCKED = 'BLOCKED',
  DELETED = 'DELETED'
}

/**
 * Audit Action Types
 */
export enum AuditAction {
  REGISTER = 'REGISTER',
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  REGISTER_FAILED = 'REGISTER_FAILED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  BIND_ANGEL = 'BIND_ANGEL',
  UNBIND_ANGEL = 'UNBIND_ANGEL',
  REBIND_ANGEL = 'REBIND_ANGEL',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  TOKEN_THEFT_DETECTED = 'TOKEN_THEFT_DETECTED',
  ACCOUNT_DELETED = 'ACCOUNT_DELETED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED'
}

/**
 * Time Constants (milliseconds)
 */
export const Time = {
  SECOND: 1000,
  MINUTE: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000
} as const;

/**
 * Security Constants
 */
export const Security = {
  // Password
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 128,
  PASSWORD_HASH_ROUNDS: 12, // bcrypt default
  
  // JWT
  MIN_SECRET_LENGTH: 32,
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  
  // Account Lockout
  MAX_FAILED_LOGIN_ATTEMPTS: 5,
  ACCOUNT_LOCKOUT_DURATION: 15 * Time.MINUTE,
  
  // Token Limits
  MAX_TOKENS_PER_USER: 10,
  MAX_FAILED_ATTEMPTS_INT: 2147483647, // PostgreSQL INTEGER max
  
  // Email Verification
  EMAIL_VERIFICATION_EXPIRY: 24 * Time.HOUR,
  PASSWORD_RESET_EXPIRY: 1 * Time.HOUR,
  
  // Device Limits
  MAX_DEVICES_TRIAL: 1,
  MAX_DEVICES_PAID: 5,
  
  // Session
  SESSION_MAX_AGE: 7 * Time.DAY,
  COOKIE_MAX_AGE: 7 * Time.DAY
} as const;

/**
 * Database Constants
 */
export const Database = {
  // Connection Pool
  POOL_MIN_CONNECTIONS: 2,
  POOL_MAX_CONNECTIONS: 20,
  CONNECTION_TIMEOUT: 2000,
  IDLE_TIMEOUT: 30000,
  STATEMENT_TIMEOUT: 30000,
  
  // Transaction
  DEFAULT_TRANSACTION_TIMEOUT: 5000,
  MAX_TRANSACTION_TIMEOUT: 30000,
  
  // Query Performance
  SLOW_QUERY_THRESHOLD: 1000, // 1 second
  
  // Cleanup
  AUDIT_LOG_RETENTION_DAYS: 90,
  REFRESH_TOKEN_CLEANUP_DAYS: 30
} as const;

/**
 * Rate Limiting Constants
 */
export const RateLimit = {
  // Global
  GLOBAL_WINDOW: 15 * Time.MINUTE,
  GLOBAL_MAX_REQUESTS: 100,
  
  // Authentication
  AUTH_WINDOW: 15 * Time.MINUTE,
  AUTH_MAX_ATTEMPTS: 5,
  
  // Password Reset
  RESET_WINDOW: 1 * Time.HOUR,
  RESET_MAX_ATTEMPTS: 3,
  
  // Per User
  USER_WINDOW: 15 * Time.MINUTE,
  USER_MAX_REQUESTS: 200,
  
  // Sensitive Operations
  SENSITIVE_WINDOW: 1 * Time.HOUR,
  SENSITIVE_MAX_ATTEMPTS: 3
} as const;

/**
 * Validation Constants
 */
export const Validation = {
  // Email
  MAX_EMAIL_LENGTH: 255,
  
  // Device Fingerprint
  MIN_FINGERPRINT_LENGTH: 32,
  MAX_FINGERPRINT_LENGTH: 128,
  
  // Angel Client ID
  MIN_ANGEL_ID_LENGTH: 6,
  MAX_ANGEL_ID_LENGTH: 10,
  
  // General
  MAX_STRING_LENGTH: 255,
  MAX_TEXT_LENGTH: 10000
} as const;

/**
 * HTTP Status Codes
 */
export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
} as const;

/**
 * Error Codes
 */
export const ErrorCode = {
  // Authentication
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  TRIAL_EXPIRED: 'TRIAL_EXPIRED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  
  // Authorization
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  FORBIDDEN: 'FORBIDDEN',
  
  // Validation
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_EMAIL: 'INVALID_EMAIL',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  
  // Resources
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  EMAIL_EXISTS: 'EMAIL_EXISTS',
  DEVICE_ALREADY_REGISTERED: 'DEVICE_ALREADY_REGISTERED',
  
  // Tokens
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  TOO_MANY_AUTH_ATTEMPTS: 'TOO_MANY_AUTH_ATTEMPTS',
  
  // Server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
} as const;

/**
 * Permissions
 */
export const Permission = {
  BASIC: 'basic',
  PREMIUM: 'premium',
  ADMIN: 'admin'
} as const;

/**
 * Trial Configuration
 */
export const Trial = {
  DURATION_DAYS: 30,
  WARNING_DAYS: [7, 3, 1], // Send warnings at these days remaining
  MAX_DEVICES: 1
} as const;

/**
 * Monitoring
 */
export const Monitoring = {
  METRICS_INTERVAL: 60 * Time.SECOND,
  POOL_WARNING_THRESHOLD: 0.8, // 80% pool capacity
  WAITING_CLIENTS_WARNING: 5,
  HEALTH_CHECK_TIMEOUT: 5 * Time.SECOND
} as const;

/**
 * Logging Levels
 */
export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

/**
 * Platforms
 */
export enum Platform {
  WINDOWS = 'win32',
  MACOS = 'darwin',
  LINUX = 'linux'
}

/**
 * Token Revocation Reasons
 */
export enum TokenRevocationReason {
  USER_LOGOUT = 'USER_LOGOUT',
  NEW_LOGIN = 'NEW_LOGIN',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PASSWORD_CHANGE = 'PASSWORD_CHANGE',
  TOKEN_REUSE_DETECTED = 'TOKEN_REUSE_DETECTED',
  MAX_TOKENS_EXCEEDED = 'MAX_TOKENS_EXCEEDED',
  ROTATED = 'ROTATED',
  ADMIN_REVOKE = 'ADMIN_REVOKE'
}

/**
 * Default values
 */
export const Defaults = {
  PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  REQUEST_TIMEOUT: 30 * Time.SECOND,
  GRACEFUL_SHUTDOWN_TIMEOUT: 30 * Time.SECOND
} as const;

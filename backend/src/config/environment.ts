/**
 * Environment Configuration & Validation
 * 
 * Fixes:
 * - Issue #3: Missing environment variable validation
 * - Issue #58: Missing .env.example
 * - Issue #59: No configuration validation
 * - Issue #33: Unvalidated environment assumptions
 * 
 * This module validates ALL required environment variables on startup
 * and fails fast with clear error messages if configuration is invalid.
 */

import crypto from 'crypto';

export interface EnvironmentConfig {
  // Server
  NODE_ENV: 'development' | 'staging' | 'production';
  PORT: number;
  HOST: string;
  
  // Database
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_POOL_MIN: number;
  DB_POOL_MAX: number;
  DB_CONNECTION_TIMEOUT: number;
  DB_IDLE_TIMEOUT: number;
  
  // Security - JWT
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRY: string;
  JWT_REFRESH_EXPIRY: string;
  
  // Security - Bcrypt
  BCRYPT_ROUNDS: number;
  
  // Security - General
  ENCRYPTION_KEY: string;
  COOKIE_SECRET: string;
  
  // CORS
  CORS_ORIGIN: string;
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  AUTH_RATE_LIMIT_MAX: number;
  
  // Email (optional for development)
  SMTP_HOST?: string;
  SMTP_PORT?: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  EMAIL_FROM?: string;
  
  // Monitoring (optional)
  SENTRY_DSN?: string;
  POSTHOG_API_KEY?: string;
  
  // Redis (optional)
  REDIS_URL?: string;
  
  // Logging
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Validation schema with strict rules
 */
const validationRules = {
  // Required in all environments
  required: {
    NODE_ENV: (val: string) => ['development', 'staging', 'production'].includes(val),
    PORT: (val: string) => !isNaN(parseInt(val)) && parseInt(val) > 0 && parseInt(val) < 65536,
    HOST: (val: string) => val.length > 0,
    
    DB_HOST: (val: string) => val.length > 0,
    DB_PORT: (val: string) => !isNaN(parseInt(val)) && parseInt(val) > 0,
    DB_NAME: (val: string) => val.length > 0,
    DB_USER: (val: string) => val.length > 0,
    DB_PASSWORD: (val: string) => val.length > 0,
    
    JWT_SECRET: (val: string) => val.length >= 32, // Issue #1 fix
    JWT_REFRESH_SECRET: (val: string) => val.length >= 32, // Issue #1 fix
    
    BCRYPT_ROUNDS: (val: string) => {
      const rounds = parseInt(val);
      return !isNaN(rounds) && rounds >= 10 && rounds <= 15; // Issue #80 fix
    },
    
    CORS_ORIGIN: (val: string) => val.length > 0,
    LOG_LEVEL: (val: string) => ['error', 'warn', 'info', 'debug'].includes(val),
  },
  
  // Required only in production
  requiredInProduction: {
    ENCRYPTION_KEY: (val: string) => val.length >= 32, // Issue #5 fix
    COOKIE_SECRET: (val: string) => val.length >= 32,
    SMTP_HOST: (val: string) => val.length > 0,
    SMTP_PORT: (val: string) => !isNaN(parseInt(val)),
    EMAIL_FROM: (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
  },
  
  // Optional with defaults
  optional: {
    DB_POOL_MIN: '2',
    DB_POOL_MAX: '20', // Issue #50 fix - configurable
    DB_CONNECTION_TIMEOUT: '2000',
    DB_IDLE_TIMEOUT: '30000',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    RATE_LIMIT_WINDOW_MS: '900000', // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: '100',
    AUTH_RATE_LIMIT_MAX: '5',
  },
};

/**
 * Validate and load environment configuration
 * 
 * Fails fast on startup if configuration is invalid
 */
export function loadAndValidateConfig(): EnvironmentConfig {
  const env = process.env;
  const nodeEnv = (env.NODE_ENV || 'development') as 'development' | 'staging' | 'production';
  
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  Object.entries(validationRules.required).forEach(([key, validator]) => {
    const value = env[key];
    
    if (!value) {
      errors.push(`CRITICAL: Required environment variable ${key} is not set`);
    } else if (!validator(value)) {
      errors.push(`CRITICAL: Environment variable ${key} has invalid value: ${value}`);
    }
  });

  // Check production-only requirements
  if (nodeEnv === 'production') {
    Object.entries(validationRules.requiredInProduction).forEach(([key, validator]) => {
      const value = env[key];
      
      if (!value) {
        errors.push(`CRITICAL (Production): Required environment variable ${key} is not set`);
      } else if (!validator(value)) {
        errors.push(`CRITICAL (Production): Environment variable ${key} has invalid value`);
      }
    });
  } else {
    // Warn about missing production variables in dev/staging
    Object.keys(validationRules.requiredInProduction).forEach((key) => {
      if (!env[key]) {
        warnings.push(`WARNING: Production variable ${key} not set (OK in ${nodeEnv})`);
      }
    });
  }

  // Special validation: JWT secrets must be different
  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push('CRITICAL: JWT_SECRET and JWT_REFRESH_SECRET must be different values');
  }

  // Special validation: Encryption key must be strong in production
  if (nodeEnv === 'production' && env.ENCRYPTION_KEY === 'your-encryption-key') {
    errors.push('CRITICAL: Default ENCRYPTION_KEY detected in production - this is a security vulnerability');
  }

  // If errors, fail startup
  if (errors.length > 0) {
    console.error('\n❌ CONFIGURATION ERRORS:\n');
    errors.forEach((err) => console.error(`  ${err}`));
    console.error('\n💡 Please check your .env file and fix the above errors.\n');
    process.exit(1);
  }

  // Show warnings
  if (warnings.length > 0 && nodeEnv !== 'production') {
    console.warn('\n⚠️  CONFIGURATION WARNINGS:\n');
    warnings.forEach((warn) => console.warn(`  ${warn}`));
    console.warn('');
  }

  // Build validated config object
  const config: EnvironmentConfig = {
    NODE_ENV: nodeEnv,
    PORT: parseInt(env.PORT!),
    HOST: env.HOST || '0.0.0.0',
    
    DB_HOST: env.DB_HOST!,
    DB_PORT: parseInt(env.DB_PORT!),
    DB_NAME: env.DB_NAME!,
    DB_USER: env.DB_USER!,
    DB_PASSWORD: env.DB_PASSWORD!,
    DB_POOL_MIN: parseInt(env.DB_POOL_MIN || validationRules.optional.DB_POOL_MIN),
    DB_POOL_MAX: parseInt(env.DB_POOL_MAX || validationRules.optional.DB_POOL_MAX),
    DB_CONNECTION_TIMEOUT: parseInt(env.DB_CONNECTION_TIMEOUT || validationRules.optional.DB_CONNECTION_TIMEOUT),
    DB_IDLE_TIMEOUT: parseInt(env.DB_IDLE_TIMEOUT || validationRules.optional.DB_IDLE_TIMEOUT),
    
    JWT_SECRET: env.JWT_SECRET!,
    JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET!,
    JWT_ACCESS_EXPIRY: env.JWT_ACCESS_EXPIRY || validationRules.optional.JWT_ACCESS_EXPIRY,
    JWT_REFRESH_EXPIRY: env.JWT_REFRESH_EXPIRY || validationRules.optional.JWT_REFRESH_EXPIRY,
    
    BCRYPT_ROUNDS: parseInt(env.BCRYPT_ROUNDS!),
    
    ENCRYPTION_KEY: env.ENCRYPTION_KEY || generateFallbackKey(nodeEnv),
    COOKIE_SECRET: env.COOKIE_SECRET || generateFallbackKey(nodeEnv),
    
    CORS_ORIGIN: env.CORS_ORIGIN!,
    
    RATE_LIMIT_WINDOW_MS: parseInt(env.RATE_LIMIT_WINDOW_MS || validationRules.optional.RATE_LIMIT_WINDOW_MS),
    RATE_LIMIT_MAX_REQUESTS: parseInt(env.RATE_LIMIT_MAX_REQUESTS || validationRules.optional.RATE_LIMIT_MAX_REQUESTS),
    AUTH_RATE_LIMIT_MAX: parseInt(env.AUTH_RATE_LIMIT_MAX || validationRules.optional.AUTH_RATE_LIMIT_MAX),
    
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT ? parseInt(env.SMTP_PORT) : undefined,
    SMTP_USER: env.SMTP_USER,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
    EMAIL_FROM: env.EMAIL_FROM,
    
    SENTRY_DSN: env.SENTRY_DSN,
    POSTHOG_API_KEY: env.POSTHOG_API_KEY,
    
    REDIS_URL: env.REDIS_URL,
    
    LOG_LEVEL: (env.LOG_LEVEL as any) || 'info',
  };

  // Log successful validation (non-sensitive info only)
  console.log('✅ Configuration validated successfully');
  console.log(`📊 Environment: ${config.NODE_ENV}`);
  console.log(`🌐 Server: ${config.HOST}:${config.PORT}`);
  console.log(`🗄️  Database: ${config.DB_NAME}@${config.DB_HOST}:${config.DB_PORT}`);
  console.log(`🔐 Security: JWT secrets validated, bcrypt rounds: ${config.BCRYPT_ROUNDS}`);
  console.log('');

  return config;
}

/**
 * Generate fallback encryption key (only for development)
 * Issue #5 fix - never use hardcoded key
 */
function generateFallbackKey(env: string): string {
  if (env === 'production') {
    // This should never happen due to validation above
    throw new Error('Cannot generate fallback key in production');
  }
  
  // Generate random key for development
  const key = crypto.randomBytes(32).toString('hex');
  console.warn(`⚠️  Generated random encryption key for ${env} environment`);
  console.warn('⚠️  This key will change on restart - use .env for persistence');
  
  return key;
}

/**
 * Redact sensitive configuration for logging
 * Issue #84 fix - never log sensitive data
 */
export function redactConfig(config: EnvironmentConfig): Record<string, any> {
  return {
    ...config,
    DB_PASSWORD: '***REDACTED***',
    JWT_SECRET: '***REDACTED***',
    JWT_REFRESH_SECRET: '***REDACTED***',
    ENCRYPTION_KEY: '***REDACTED***',
    COOKIE_SECRET: '***REDACTED***',
    SMTP_PASSWORD: '***REDACTED***',
    SENTRY_DSN: config.SENTRY_DSN ? '***REDACTED***' : undefined,
  };
}

/**
 * Export singleton config instance
 */
let configInstance: EnvironmentConfig | null = null;

export function getConfig(): EnvironmentConfig {
  if (!configInstance) {
    configInstance = loadAndValidateConfig();
  }
  return configInstance;
}

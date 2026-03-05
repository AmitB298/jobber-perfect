/**
 * Input Validation Utilities
 * 
 * Fixes:
 * - Issue #67: Device fingerprint validation
 * - Issue #20: Device fingerprint optional fields
 * - Issue #85: Content-Type validation
 */

import { AppError } from './errors';

/**
 * Device fingerprint validation schema
 */
export interface DeviceFingerprint {
  fingerprint: string;
  deviceId: string;
  machineId: string;
  platform: 'win32' | 'darwin' | 'linux';
  osVersion: string;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  macAddress: string;
  diskSerial: string;
}

/**
 * Validate device fingerprint structure and content
 * Issue #67 fix - prevents SQL injection via fingerprint
 */
export function validateDeviceFingerprint(fingerprint: any): boolean {
  if (!fingerprint || typeof fingerprint !== 'object') {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Device fingerprint must be an object');
  }

  // Required fields validation
  const requiredFields = [
    'fingerprint',
    'deviceId', 
    'machineId',
    'platform',
    'osVersion',
    'cpuModel',
    'cpuCores',
    'totalMemory',
    'macAddress',
    'diskSerial'
  ];

  for (const field of requiredFields) {
    if (!(field in fingerprint)) {
      throw new AppError(400, 'INVALID_FINGERPRINT', `Missing required field: ${field}`);
    }
  }

  // Type validation
  if (typeof fingerprint.fingerprint !== 'string' || fingerprint.fingerprint.length < 32 || fingerprint.fingerprint.length > 128) {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Fingerprint must be 32-128 characters');
  }

  if (typeof fingerprint.deviceId !== 'string' || fingerprint.deviceId.length < 1) {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Invalid deviceId');
  }

  if (typeof fingerprint.machineId !== 'string' || fingerprint.machineId.length < 1) {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Invalid machineId');
  }

  if (!['win32', 'darwin', 'linux'].includes(fingerprint.platform)) {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Invalid platform');
  }

  if (typeof fingerprint.cpuCores !== 'number' || fingerprint.cpuCores < 1 || fingerprint.cpuCores > 256) {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Invalid cpuCores');
  }

  if (typeof fingerprint.totalMemory !== 'number' || fingerprint.totalMemory < 1) {
    throw new AppError(400, 'INVALID_FINGERPRINT', 'Invalid totalMemory');
  }

  // Validate no SQL injection patterns
  const sqlPatterns = ['--', ';', '/*', '*/', 'xp_', 'sp_', 'DROP', 'DELETE', 'INSERT', 'UPDATE'];
  const stringFields = ['fingerprint', 'deviceId', 'machineId', 'osVersion', 'cpuModel', 'macAddress', 'diskSerial'];
  
  for (const field of stringFields) {
    const value = String(fingerprint[field]).toUpperCase();
    for (const pattern of sqlPatterns) {
      if (value.includes(pattern)) {
        throw new AppError(400, 'INVALID_FINGERPRINT', 'Invalid characters detected');
      }
    }
  }

  return true;
}

/**
 * Sanitize device fingerprint
 * Remove any potentially dangerous characters
 */
export function sanitizeDeviceFingerprint(fingerprint: any): DeviceFingerprint {
  validateDeviceFingerprint(fingerprint);

  return {
    fingerprint: String(fingerprint.fingerprint).trim(),
    deviceId: String(fingerprint.deviceId).trim(),
    machineId: String(fingerprint.machineId).trim(),
    platform: fingerprint.platform,
    osVersion: String(fingerprint.osVersion).trim().substring(0, 50),
    cpuModel: String(fingerprint.cpuModel).trim().substring(0, 100),
    cpuCores: Number(fingerprint.cpuCores),
    totalMemory: Number(fingerprint.totalMemory),
    macAddress: String(fingerprint.macAddress).trim().substring(0, 17),
    diskSerial: String(fingerprint.diskSerial).trim().substring(0, 50)
  };
}

/**
 * Validate email format (beyond express-validator)
 * Issue #93 fix - consistent email normalization
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  if (!emailRegex.test(email)) {
    throw new AppError(400, 'INVALID_EMAIL', 'Invalid email format');
  }

  // Check for common typos
  const commonDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
  const domain = email.split('@')[1]?.toLowerCase();
  
  // Warn about suspicious domains (optional - can be removed)
  const suspiciousDomains = ['tempmail.com', 'guerrillamail.com', '10minutemail.com'];
  if (suspiciousDomains.includes(domain)) {
    console.warn('Suspicious email domain detected:', domain);
  }

  return true;
}

/**
 * Normalize email consistently
 * Issue #93 fix
 */
export function normalizeEmail(email: string): string {
  let normalized = email.toLowerCase().trim();
  
  // Gmail specific: remove dots and plus-addressing
  if (normalized.includes('@gmail.com')) {
    const [local, domain] = normalized.split('@');
    const cleanLocal = local.split('+')[0].replace(/\./g, '');
    normalized = `${cleanLocal}@${domain}`;
  }
  
  return normalized;
}

/**
 * Validate password strength beyond basic regex
 */
export function validatePasswordStrength(password: string): { valid: boolean; score: number; feedback: string[] } {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;

  // Character variety
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[@$!%*?&]/.test(password)) score += 1;

  // Common patterns (reduce score)
  const commonPatterns = ['123456', 'password', 'qwerty', 'abc123'];
  if (commonPatterns.some(pattern => password.toLowerCase().includes(pattern))) {
    score -= 2;
    feedback.push('Avoid common patterns');
  }

  // Sequential characters
  if (/(.)\1{2,}/.test(password)) {
    score -= 1;
    feedback.push('Avoid repeated characters');
  }

  const valid = score >= 4;
  
  if (!valid) {
    if (password.length < 8) feedback.push('Use at least 8 characters');
    if (!/[a-z]/.test(password)) feedback.push('Include lowercase letters');
    if (!/[A-Z]/.test(password)) feedback.push('Include uppercase letters');
    if (!/\d/.test(password)) feedback.push('Include numbers');
    if (!/[@$!%*?&]/.test(password)) feedback.push('Include special characters');
  }

  return { valid, score, feedback };
}

/**
 * Validate URL for safe external opening
 * Issue #37 fix - prevents opening malicious URLs
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Whitelist allowed protocols
    const allowedProtocols = ['http:', 'https:'];
    if (!allowedProtocols.includes(parsed.protocol)) {
      throw new AppError(400, 'INVALID_URL', 'Invalid URL protocol');
    }

    // Blacklist dangerous domains
    const dangerousDomains = ['localhost', '127.0.0.1', '0.0.0.0'];
    if (dangerousDomains.some(domain => parsed.hostname.includes(domain))) {
      throw new AppError(400, 'INVALID_URL', 'URL not allowed');
    }

    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_URL', 'Malformed URL');
  }
}

/**
 * Validate redirect URL
 * Issue #71 fix - prevents open redirect
 */
export function validateRedirectUrl(url: string, allowedDomains: string[]): boolean {
  try {
    const parsed = new URL(url);
    
    // Check if domain is whitelisted
    const isAllowed = allowedDomains.some(domain => {
      return parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`);
    });

    if (!isAllowed) {
      throw new AppError(400, 'INVALID_REDIRECT', 'Redirect URL not allowed');
    }

    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'INVALID_REDIRECT', 'Invalid redirect URL');
  }
}

/**
 * Sanitize user agent string
 * Issue #87 fix - parse user agent for better logging
 */
export function parseUserAgent(userAgent: string | undefined): {
  browser?: string;
  os?: string;
  device?: string;
} {
  if (!userAgent) return {};

  const result: any = {};

  // Simple parsing (in production, use a library like ua-parser-js)
  if (userAgent.includes('Chrome')) result.browser = 'Chrome';
  else if (userAgent.includes('Firefox')) result.browser = 'Firefox';
  else if (userAgent.includes('Safari')) result.browser = 'Safari';
  else if (userAgent.includes('Edge')) result.browser = 'Edge';

  if (userAgent.includes('Windows')) result.os = 'Windows';
  else if (userAgent.includes('Mac')) result.os = 'macOS';
  else if (userAgent.includes('Linux')) result.os = 'Linux';
  else if (userAgent.includes('Android')) result.os = 'Android';
  else if (userAgent.includes('iOS')) result.os = 'iOS';

  if (userAgent.includes('Mobile')) result.device = 'Mobile';
  else if (userAgent.includes('Tablet')) result.device = 'Tablet';
  else result.device = 'Desktop';

  return result;
}

/**
 * Validate Angel One client ID format
 */
export function validateAngelClientId(clientId: string): boolean {
  // Angel One client IDs are typically alphanumeric, 6-10 characters
  const angelIdRegex = /^[A-Z0-9]{6,10}$/;
  
  if (!angelIdRegex.test(clientId)) {
    throw new AppError(400, 'INVALID_ANGEL_ID', 'Invalid Angel One client ID format');
  }

  return true;
}

/**
 * Issue #85 fix: Content-Type validation
 */
export function validateContentType(contentType: string | undefined, expected: string): boolean {
  if (!contentType) {
    throw new AppError(415, 'MISSING_CONTENT_TYPE', 'Content-Type header required');
  }

  if (!contentType.includes(expected)) {
    throw new AppError(415, 'INVALID_CONTENT_TYPE', `Expected ${expected}`);
  }

  return true;
}

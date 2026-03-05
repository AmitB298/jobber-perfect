import { machineIdSync } from 'node-machine-id';
import * as keytar from 'keytar';
import * as crypto from 'crypto';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DeviceFingerprint {
  deviceId: string;
  machineId: string;
  platform: string;
  osVersion: string;
  cpuModel: string;
  cpuCores: number;
  totalMemory: number;
  macAddress: string;
  diskSerial?: string;
  fingerprint: string; // Combined hash
}

export interface EncryptedData {
  iv: string;
  data: string;
  tag: string;
}

export class SecurityManager {
  private static instance: SecurityManager;
  private readonly SERVICE_NAME = 'JobberPro';
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  private encryptionKey: Buffer | null = null;

  private constructor() {
    this.initializeEncryptionKey();
  }

  static getInstance(): SecurityManager {
    if (!SecurityManager.instance) {
      SecurityManager.instance = new SecurityManager();
    }
    return SecurityManager.instance;
  }

  /**
   * Generate comprehensive device fingerprint
   */
  async generateDeviceFingerprint(): Promise<DeviceFingerprint> {
    const machineId = machineIdSync();
    const platform = os.platform();
    const osVersion = os.release();
    const cpus = os.cpus();
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;
    const totalMemory = os.totalmem();
    
    // Get primary MAC address
    const macAddress = await this.getPrimaryMacAddress();
    
    // Get disk serial (Windows only for now)
    let diskSerial: string | undefined;
    if (platform === 'win32') {
      diskSerial = await this.getWindowsDiskSerial();
    }

    // Generate unique device ID
    const deviceId = crypto.randomUUID();

    // Create fingerprint hash
    const fingerprintData = [
      machineId,
      platform,
      osVersion,
      cpuModel,
      cpuCores.toString(),
      macAddress,
      diskSerial || ''
    ].join('|');

    const fingerprint = crypto
      .createHash('sha256')
      .update(fingerprintData)
      .digest('hex');

    return {
      deviceId,
      machineId,
      platform,
      osVersion,
      cpuModel,
      cpuCores,
      totalMemory,
      macAddress,
      diskSerial,
      fingerprint
    };
  }

  /**
   * Get primary network interface MAC address
   */
  private async getPrimaryMacAddress(): Promise<string> {
    const networkInterfaces = os.networkInterfaces();
    
    // Find primary non-internal interface
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      if (!interfaces) continue;
      
      for (const iface of interfaces) {
        if (!iface.internal && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac;
        }
      }
    }
    
    return 'unknown';
  }

  /**
   * Get Windows disk serial number
   */
  private async getWindowsDiskSerial(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(
        'wmic diskdrive get serialnumber'
      );
      
      const lines = stdout.split('\n');
      const serial = lines[1]?.trim();
      
      return serial || undefined;
    } catch (error) {
      console.error('Failed to get disk serial:', error);
      return undefined;
    }
  }

  /**
   * Initialize encryption key from machine-specific data
   */
  private async initializeEncryptionKey(): Promise<void> {
    try {
      const machineId = machineIdSync();
      
      // Derive key from machine ID
      this.encryptionKey = crypto.scryptSync(
        machineId,
        'jobber-pro-salt',
        32
      );
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      // Fallback to random key (less secure)
      this.encryptionKey = crypto.randomBytes(32);
    }
  }

  /**
   * Encrypt sensitive data
   */
  encrypt(plaintext: string): EncryptedData {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      this.ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      iv
    ) as crypto.CipherGCM;

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      data: encrypted,
      tag: tag.toString('hex')
    };
  }

  /**
   * Decrypt sensitive data
   */
  decrypt(encryptedData: EncryptedData): string {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not initialized');
    }

    const decipher = crypto.createDecipheriv(
      this.ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      Buffer.from(encryptedData.iv, 'hex')
    ) as crypto.DecipherGCM;

    decipher.setAuthTag(Buffer.from(encryptedData.tag, 'hex'));

    let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Store credentials in OS keychain
   */
  async storeCredential(account: string, password: string): Promise<void> {
    try {
      await keytar.setPassword(this.SERVICE_NAME, account, password);
    } catch (error) {
      console.error('Failed to store credential:', error);
      throw new Error('Failed to store credential in system keychain');
    }
  }

  /**
   * Retrieve credentials from OS keychain
   */
  async getCredential(account: string): Promise<string | null> {
    try {
      return await keytar.getPassword(this.SERVICE_NAME, account);
    } catch (error) {
      console.error('Failed to retrieve credential:', error);
      return null;
    }
  }

  /**
   * Delete credentials from OS keychain
   */
  async deleteCredential(account: string): Promise<void> {
    try {
      await keytar.deletePassword(this.SERVICE_NAME, account);
    } catch (error) {
      console.error('Failed to delete credential:', error);
    }
  }

  /**
   * Validate app integrity (anti-tamper check)
   */
  async validateAppIntegrity(): Promise<boolean> {
    // In production, check code signature, hash manifests, etc.
    // For now, basic check
    try {
      const { app } = require('electron');
      const appPath = app.getAppPath();
      
      // Check if running from expected location
      if (appPath.includes('node_modules')) {
        console.warn('Running from development environment');
        return true; // Allow in dev
      }

      // Add more integrity checks here
      return true;
    } catch (error) {
      console.error('Integrity check failed:', error);
      return false;
    }
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hash sensitive data
   */
  hash(data: string): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

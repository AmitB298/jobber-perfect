/**
 * Test Setup
 * Configures test environment and utilities
 */

import { Pool } from 'pg';

// Test database configuration (Issue #48 fix)
const testDbConfig = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5432'),
  database: process.env.TEST_DB_NAME || 'jobber_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres'
};

export let testDb: Pool;

// Setup before all tests
beforeAll(async () => {
  // Create test database pool
  testDb = new Pool(testDbConfig);
  
  // Clear test database
  await testDb.query('DROP SCHEMA public CASCADE');
  await testDb.query('CREATE SCHEMA public');
  
  // Run migrations
  // In a real setup, you'd run your migration files here
  console.log('Test database initialized');
});

// Cleanup after all tests
afterAll(async () => {
  await testDb.end();
});

// Clear data between tests
afterEach(async () => {
  // Truncate all tables
  await testDb.query(`
    TRUNCATE TABLE 
      users, 
      refresh_tokens, 
      device_fingerprints, 
      angel_bindings, 
      audit_logs 
    CASCADE
  `);
});

/**
 * Test helper utilities
 */

export const TestHelpers = {
  /**
   * Create a test user
   */
  async createTestUser(overrides: any = {}) {
    const defaults = {
      email: `test-${Date.now()}@example.com`,
      password_hash: await require('bcrypt').hash('Test@123', 12),
      plan: 'TRIAL',
      status: 'ACTIVE',
      email_verified: true,
      permissions: ['basic']
    };
    
    const user = { ...defaults, ...overrides };
    
    const result = await testDb.query(
      `INSERT INTO users (email, password_hash, plan, status, email_verified, permissions)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user.email, user.password_hash, user.plan, user.status, user.email_verified, user.permissions]
    );
    
    return result.rows[0];
  },
  
  /**
   * Create a test device fingerprint
   */
  async createTestDevice(userId: string, overrides: any = {}) {
    const defaults = {
      fingerprint: require('crypto').randomBytes(32).toString('hex'),
      device_id: 'test-device',
      machine_id: 'test-machine',
      platform: 'linux',
      is_primary: true
    };
    
    const device = { ...defaults, ...overrides };
    
    const result = await testDb.query(
      `INSERT INTO device_fingerprints (
        user_id, fingerprint, device_id, machine_id, platform, is_primary
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [userId, device.fingerprint, device.device_id, device.machine_id, device.platform, device.is_primary]
    );
    
    return result.rows[0];
  }
};

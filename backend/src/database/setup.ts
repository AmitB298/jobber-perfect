import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const setupDatabase = async () => {
  console.log('🔧 Setting up database...\n');

  // Connect to PostgreSQL (without database name)
  const adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: 'postgres' // Connect to default database
  });

  try {
    const dbName = process.env.DB_NAME || 'jobber_pro';

    // Check if database exists
    const checkDb = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (checkDb.rows.length === 0) {
      console.log(`📊 Creating database: ${dbName}`);
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      console.log('✓ Database created\n');
    } else {
      console.log(`✓ Database already exists: ${dbName}\n`);
    }

    await adminPool.end();

    // Connect to the new database
    const dbPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: dbName,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres'
    });

    // Read and execute schema
    const schemaPath = path.join(__dirname, '../../database/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📋 Running database schema...');
    await dbPool.query(schema);
    console.log('✓ Schema applied successfully\n');

    // Verify tables created
    const tablesResult = await dbPool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('✓ Tables created:');
    tablesResult.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });

    await dbPool.end();

    console.log('\n✅ Database setup complete!\n');
    console.log('Next steps:');
    console.log('1. Run: npm run dev');
    console.log('2. Test: curl http://localhost:3000/health\n');

  } catch (error: any) {
    console.error('❌ Database setup failed:', error.message);
    process.exit(1);
  }
};

setupDatabase();

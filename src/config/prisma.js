const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../generated/prisma');
const logger = require('./logger');

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL environment variable');
}

// Pool sizing reuses the DB_POOL_* env vars that already existed in .env (previously
// unused scaffolding for a future direct-Postgres connection — see MIGRATION_TRACKER.md).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX, 10) || 20,
  min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT, 10) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT, 10) || 60000,
});

pool.on('error', (err) => {
  logger.error('Postgres pool error:', err);
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log: process.env.ENABLE_QUERY_LOGGING === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

module.exports = prisma;
module.exports.pool = pool;

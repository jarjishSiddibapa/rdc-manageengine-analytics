const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'manageengine_analytics';

// Connections are opened lazily, so the pool can be created before the database exists; initDb() creates it first.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: DB_NAME,
  waitForConnections: true,
  // The web screens, the background sync and the SR-history collector (4 workers) share these; 5 left interactive requests waiting.
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 10,
  queueLimit: 0,
  connectTimeout: 10000,
  maxIdle: 3,
  idleTimeout: 60000,
  dateStrings: true,
  enableKeepAlive: true,
  decimalNumbers: true,
  charset: 'utf8mb4',
});

module.exports = { pool, DB_NAME };

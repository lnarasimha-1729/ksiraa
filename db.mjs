import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: "utf8mb4",
  timezone: "Z",
  dateStrings: false
});

export async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS meta (
      \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
      \`value\` TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS products (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      size VARCHAR(60) NOT NULL,
      price INT NOT NULL,
      description VARCHAR(500) NOT NULL,
      sold_out TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS customers (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      phone VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(120) NOT NULL DEFAULT '',
      address VARCHAR(500) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      customer_id VARCHAR(64) NOT NULL,
      customer_name VARCHAR(120) NOT NULL,
      customer_phone VARCHAR(20) NOT NULL,
      address VARCHAR(500) NOT NULL,
      frequency VARCHAR(40) NOT NULL,
      delivery_time VARCHAR(40) NOT NULL,
      payment_method VARCHAR(40) NOT NULL,
      payment_status VARCHAR(80) NOT NULL,
      payment_url VARCHAR(500) NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL,
      items_json JSON NOT NULL,
      total INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_orders_customer (customer_id),
      INDEX idx_orders_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS notices (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      message VARCHAR(1000) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notices_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token VARCHAR(128) NOT NULL PRIMARY KEY,
      role VARCHAR(20) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      INDEX idx_sessions_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS otps (
      phone VARCHAR(20) NOT NULL PRIMARY KEY,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS admin (
      id INT NOT NULL PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      password_hash VARCHAR(255) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

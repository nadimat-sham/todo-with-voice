require("dotenv").config({ quiet: true });
const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Return DATE columns as plain
  // 'YYYY-MM-DD' strings instead of JS Dates, so they never shift a day
  // when serialized to JSON in a different timezone.
  dateStrings: ["DATE"],
});

module.exports = pool;

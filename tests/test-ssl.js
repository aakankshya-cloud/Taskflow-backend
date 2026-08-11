// test-ssl.js
const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    ca: fs.readFileSync(path.join(__dirname, '../certs/aiven-ca.pem')),
    rejectUnauthorized: true
  }
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Connection failed:', err.message);
    console.error('Code:', err.code);
    if (err.cause) console.error('Cause:', err.cause);
    process.exit(1);
  }
  console.log('✅ Connected successfully!');
  connection.query('SELECT 1 + 1 AS result', (err, results) => {
    if (err) console.error('Query error:', err.message);
    else console.log('Query result:', results);
    connection.end();
  });
});
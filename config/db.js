const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    ssl: process.env.DB_SSL === 'true'
        ? {
            ca: fs.readFileSync(path.join(__dirname, '../certs/aiven-ca.pem')),
            rejectUnauthorized: true
          }
        : undefined
});

module.exports = pool.promise();
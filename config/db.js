const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// The Aiven CA cert isn't a secret (it's public info from the Aiven
// dashboard), but it's still a file, and hosts like Render only deploy
// what's in your git repo — so a gitignored certs/aiven-ca.pem file
// simply doesn't exist on the server, and every DB query fails silently
// with a generic 500. Support reading the cert from an env var (set
// DB_CA_CERT to the full contents of the .pem file in your host's
// dashboard) as the primary path for deployment, falling back to the
// local file for local dev where reading a file on disk is easiest.
function loadCaCert() {
  if (process.env.DB_CA_CERT) {
    return process.env.DB_CA_CERT;
  }
  const localPath = path.join(__dirname, '../certs/aiven-ca.pem');
  if (fs.existsSync(localPath)) {
    return fs.readFileSync(localPath);
  }
  return undefined;
}

const sslConfig = process.env.DB_SSL === 'true'
  ? (() => {
      const ca = loadCaCert();
      if (!ca) {
        console.error(
          'DB_SSL=true but no CA certificate was found. Set DB_CA_CERT ' +
          '(full contents of the .pem file) as an environment variable, ' +
          'or make sure certs/aiven-ca.pem exists locally.'
        );
      }
      return { ca, rejectUnauthorized: true };
    })()
  : undefined;

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    ssl: sslConfig
});

module.exports = pool.promise();
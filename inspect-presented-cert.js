// inspect-presented-cert.js
const mysql = require('mysql2');
require('dotenv').config();

const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false // bypass validation just to inspect what's presented
  }
});

// Catch errors here so they don't crash as uncaught exceptions
connection.on('error', (err) => {
  console.error('❌ Connection error event:', err.message);
});

connection.connect((err) => {
  if (err) {
    console.error('❌ Connect callback error:', err.message);
  }
});

// Give the TLS handshake a moment to complete, then inspect the socket directly
setTimeout(() => {
  const stream = connection.stream;

  if (!stream || !stream.getPeerCertificate) {
    console.error('❌ Could not access TLS socket. connection.stream:', stream);
    process.exit(1);
  }

  const cert = stream.getPeerCertificate(true);

  if (!cert || Object.keys(cert).length === 0) {
    console.error('❌ No certificate available — handshake likely failed before cert exchange.');
    process.exit(1);
  }

  console.log('--- Certificate presented by server ---');
  console.log('Subject:', JSON.stringify(cert.subject));
  console.log('Issuer:', JSON.stringify(cert.issuer));
  console.log('Valid from:', cert.valid_from);
  console.log('Valid to:', cert.valid_to);

  let current = cert.issuerCertificate;
  let depth = 0;
  console.log('\n--- Issuer chain ---');
  while (current && depth < 5) {
    console.log(`[${depth}] Subject:`, JSON.stringify(current.subject));
    console.log(`[${depth}] Issuer:`, JSON.stringify(current.issuer));
    if (current.issuerCertificate === current) break;
    current = current.issuerCertificate;
    depth++;
  }

  process.exit(0);
}, 3000);
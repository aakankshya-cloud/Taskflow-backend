// inspect-cert.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const certPath = path.join(__dirname, 'certs/aiven-ca.pem');
const certContent = fs.readFileSync(certPath, 'utf8');

console.log('--- File info ---');
console.log('Path:', certPath);
console.log('Size (bytes):', certContent.length);
console.log('Starts with:', certContent.slice(0, 40));
console.log('Ends with:', certContent.slice(-40));

console.log('\n--- Parsed cert ---');
try {
  const cert = new crypto.X509Certificate(certContent);
  console.log('Subject:', cert.subject);
  console.log('Issuer:', cert.issuer);
  console.log('Valid from:', cert.validFrom);
  console.log('Valid to:', cert.validTo);
  console.log('Is CA:', cert.ca);
} catch (e) {
  console.error('Failed to parse certificate:', e.message);
}
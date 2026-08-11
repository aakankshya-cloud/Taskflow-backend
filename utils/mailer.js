
// utils/mailer.js
//
// Sends real email if SMTP_* env vars are set. Otherwise, falls back to
// logging the link to the console — so the forgot-password flow is fully
// testable locally/in a demo without needing a real mail provider set up.
// To send real emails: npm install nodemailer, then set SMTP_HOST,
// SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM in your .env.
//
// NOTE: this file previously lived (unused) in the frontend's src/utils/,
// which couldn't work — it depends on Node's `require`, `process.env`,
// and a Node-only SMTP client, none of which exist in a browser bundle.
// It belongs here, on the backend, where forgot-password is actually
// handled.

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  nodemailer = null;
}

function getTransport() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPasswordResetEmail(toEmail, resetUrl) {
  const transport = getTransport();

  if (!transport) {
    // Dev/demo fallback — makes the feature fully testable without SMTP.
    console.log('\n=== Password reset link (SMTP not configured) ===');
    console.log(`To: ${toEmail}`);
    console.log(`Link: ${resetUrl}`);
    console.log('===================================================\n');
    return;
  }

  await transport.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@taskflow.app',
    to: toEmail,
    subject: 'Reset your TaskFlow password',
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `<p>Someone requested a password reset for your TaskFlow account.</p>
           <p><a href="${resetUrl}">Click here to reset your password</a> (expires in 1 hour).</p>
           <p>If you didn't request this, you can safely ignore this email.</p>`,
  });
}

module.exports = { sendPasswordResetEmail };

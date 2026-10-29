const { pool } = require('../db/pool');

function clientIp(req) {
  // req.ip is the socket address unless TRUST_PROXY is set in .env (then the proxy's forwarded address).
  const ip = req?.ip || req?.socket?.remoteAddress || null;
  return ip ? ip.replace(/^::ffff:/, '').slice(0, 64) : null;
}

// Who did what, when. Never throws: a failed log line must not break the action it describes.
async function record(req, action, { target = null, detail = null, user = req?.user } = {}) {
  try {
    await pool.query(
      'INSERT INTO audit_log (user_id, user_email, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [user?.id ?? null, user?.email ?? null, action, target ? String(target).slice(0, 255) : null, detail ? String(detail).slice(0, 2000) : null, clientIp(req)],
    );
  } catch (error) {
    console.error('audit log failed:', error.message);
  }
}

module.exports = { record, clientIp };

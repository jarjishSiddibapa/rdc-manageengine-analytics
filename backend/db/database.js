const mysql = require('mysql2/promise');
const { pool, DB_NAME } = require('./pool');

// Adds an index only when no index of that name exists yet (checked in information_schema), so initDb can run any number of times.
async function ensureIndex(table, name, columns) {
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [DB_NAME, table, name],
  );
  if (n) return false;
  await pool.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` (${columns})`);
  return true;
}

// Creates the application's own database (never touches any other) and its tables.
// recoverRuns: mark a sync left "running" by a crash as failed. A second copy of the app started for testing passes false so it
// cannot mark the first copy's live run as failed.
async function initDb({ recoverRuns = true } = {}) {
  const bootstrap = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await bootstrap.end();

  const tail = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      me_id VARCHAR(40) NOT NULL PRIMARY KEY,
      display_id VARCHAR(40) NOT NULL,
      subject TEXT,
      status_name VARCHAR(120),
      status VARCHAR(30) NOT NULL,
      pending_party VARCHAR(20),
      technician VARCHAR(255),
      technician_email VARCHAR(255),
      requester VARCHAR(255),
      category VARCHAR(255),
      subcategory VARCHAR(255),
      priority VARCHAR(100),
      request_type VARCHAR(100),
      group_name VARCHAR(255),
      site VARCHAR(255),
      department VARCHAR(255),
      mode VARCHAR(100),
      created_at DATETIME NULL,
      assigned_at DATETIME NULL,
      completed_at DATETIME NULL,
      due_by DATETIME NULL,
      last_updated_at DATETIME NULL,
      in_scope TINYINT(1) NOT NULL DEFAULT 1,
      first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE INDEX uq_requests_display (display_id),
      INDEX idx_requests_scope (in_scope, status),
      INDEX idx_requests_created (created_at),
      INDEX idx_requests_technician (technician)
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS technicians (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      email VARCHAR(255) NULL,
      department VARCHAR(255) NULL,
      source VARCHAR(20) NOT NULL DEFAULT 'roster',
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      mode VARCHAR(10) NOT NULL DEFAULT 'quick',
      trigger_source VARCHAR(20) NOT NULL DEFAULT 'manual',
      started_by VARCHAR(255) NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'running',
      pages INT NOT NULL DEFAULT 0,
      scanned INT NOT NULL DEFAULT 0,
      fetched INT NOT NULL DEFAULT 0,
      inserted INT NOT NULL DEFAULT 0,
      updated INT NOT NULL DEFAULT 0,
      removed INT NOT NULL DEFAULT 0,
      message TEXT
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(190) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'viewer',
      active TINYINT(1) NOT NULL DEFAULT 1,
      must_change_password TINYINT(1) NOT NULL DEFAULT 0,
      last_login_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE INDEX uq_users_email (email)
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      ip VARCHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      INDEX idx_sessions_user (user_id),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${tail}
  `);

  // One row per reset link sent. Only the hash of the token is kept, so the table alone cannot be used to reset anyone's password.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash CHAR(64) NOT NULL PRIMARY KEY,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      ip VARCHAR(64) NULL,
      INDEX idx_resets_user (user_id, created_at),
      CONSTRAINT fk_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INT NULL,
      user_email VARCHAR(190) NULL,
      action VARCHAR(60) NOT NULL,
      target VARCHAR(255) NULL,
      detail TEXT NULL,
      ip VARCHAR(64) NULL,
      INDEX idx_audit_at (at),
      INDEX idx_audit_action (action)
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      k VARCHAR(60) NOT NULL PRIMARY KEY,
      v TEXT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ${tail}
  `);

  // What happened to each SR, read from ManageEngine's change log: one summary row per SR plus its timeline.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_history (
      me_id VARCHAR(40) NOT NULL PRIMARY KEY,
      fetched_at DATETIME NOT NULL,
      source_updated_at DATETIME NULL,
      events INT NOT NULL DEFAULT 0,
      assignments INT NOT NULL DEFAULT 0,
      reassignments INT NOT NULL DEFAULT 0,
      technicians_involved INT NOT NULL DEFAULT 0,
      tech_path TEXT NULL,
      first_assigned_at DATETIME NULL,
      first_assigned_by VARCHAR(255) NULL,
      last_assigned_at DATETIME NULL,
      first_response_at DATETIME NULL,
      first_response_assigned_at DATETIME NULL,
      tech_replies INT NOT NULL DEFAULT 0,
      requester_replies INT NOT NULL DEFAULT 0,
      last_activity_at DATETIME NULL,
      last_tech_reply_at DATETIME NULL,
      last_requester_reply_at DATETIME NULL,
      status_since DATETIME NULL,
      reopen_count INT NOT NULL DEFAULT 0,
      first_closed_at DATETIME NULL,
      closed_by VARCHAR(255) NULL,
      closure_code VARCHAR(120) NULL,
      fcr TINYINT(1) NULL,
      hold_all INT NULL,
      gap_all INT NULL,
      wait_all INT NULL,
      hold_asg INT NULL,
      gap_asg INT NULL,
      wait_asg INT NULL,
      worklog_count INT NOT NULL DEFAULT 0,
      worklog_minutes INT NOT NULL DEFAULT 0,
      notes_count INT NOT NULL DEFAULT 0,
      attachments INT NOT NULL DEFAULT 0,
      group_changes INT NOT NULL DEFAULT 0,
      priority_changes INT NOT NULL DEFAULT 0,
      category_changes INT NOT NULL DEFAULT 0,
      forwards INT NOT NULL DEFAULT 0,
      merged TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_history_fetched (fetched_at)
    ) ${tail}
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS request_events (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      me_id VARCHAR(40) NOT NULL,
      seq INT NOT NULL,
      at DATETIME NULL,
      kind VARCHAR(24) NOT NULL,
      actor VARCHAR(255) NULL,
      summary VARCHAR(600) NOT NULL,
      from_value VARCHAR(255) NULL,
      to_value VARCHAR(255) NULL,
      INDEX idx_events_request (me_id, seq),
      INDEX idx_events_kind (kind)
    ) ${tail}
  `);

  // One row per database backup (scheduled, catch-up or manual); the dump itself is a .sql file in backend/db-backup.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS backup_runs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      filename VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL,
      triggered_by VARCHAR(20) NOT NULL,
      started_by VARCHAR(190) NULL,
      size_bytes BIGINT NULL,
      message TEXT NULL,
      email_status VARCHAR(20) NULL,
      email_message TEXT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      INDEX idx_backup_started (started_at),
      INDEX idx_backup_file (filename)
    ) ${tail}
  `);

  // Indexes added after the first release (each only if missing; checked against the real queries with EXPLAIN).
  // "Which SRs still need their history collected" is polled by the Data & sync screen and reads in_scope + last_updated_at for every SR;
  // this makes that side of the join an index-only scan.
  await ensureIndex('requests', 'idx_requests_scope_updated', 'in_scope, last_updated_at');
  // The out-of-scope sweep after a deep sync filters on last_synced_at; changed-SR checks read last_updated_at.
  await ensureIndex('requests', 'idx_requests_synced', 'last_synced_at');
  await ensureIndex('requests', 'idx_requests_updated', 'last_updated_at');
  // The analytics cache fingerprint (COUNT / SUM / MAX over the whole table) is answered from this index alone (~90 ms -> ~60 ms).
  await ensureIndex('requests', 'idx_requests_fingerprint', 'in_scope, status, last_synced_at, last_updated_at');
  // Expired sign-ins are purged by expiry time.
  await ensureIndex('sessions', 'idx_sessions_expires', 'expires_at');

  // A run left "running" by a crash would block the next sync forever. But another copy of the app on this database may be running one
  // right now: each sync/history run holds a MySQL named lock (see history.acquireRunLock) for as long as it lives, so a "running" row is
  // only an orphan when nobody holds the matching lock.
  if (recoverRuns) {
    for (const [name, condition] of [['sync', "mode <> 'history'"], ['history', "mode = 'history'"]]) {
      const [[lock]] = await pool.query('SELECT IS_USED_LOCK(?) AS holder', [`${DB_NAME}:${name}`]);
      if (lock.holder) continue; // a live run elsewhere
      await pool.query(`UPDATE sync_runs SET status = 'failed', finished_at = NOW(), message = 'Interrupted by a restart' WHERE status = 'running' AND ${condition}`);
    }
  }
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
  if (recoverRuns) {
    const [[lock]] = await pool.query('SELECT IS_USED_LOCK(?) AS holder', [`${DB_NAME}:backup`]);
    if (!lock.holder) await pool.query("UPDATE backup_runs SET status = 'failed', finished_at = NOW(), message = 'Interrupted by a restart' WHERE status = 'running'");
  }
}

module.exports = { initDb };

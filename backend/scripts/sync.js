// Command-line sync: node scripts/sync.js [--deep]   (same as "Sync SRs" / "Deep Sync SRs" in the app)
// Only one sync can run at a time on the database: if the app (or another copy of this script) is syncing, this exits with a message.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { initDb } = require('../db/database');
const { pool } = require('../db/pool');
const { startSync, syncStatus } = require('../services/sync');

(async () => {
  await initDb();
  const run = await startSync({ mode: process.argv.includes('--deep') ? 'deep' : 'quick', trigger: 'manual', startedBy: 'command line' });
  if (run.external) {
    console.log(run.message);
    await pool.end();
    process.exit(1);
  }
  let last = '';
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    const status = await syncStatus();
    if (status.running && status.running.mode !== 'history') {
      if (status.running.message !== last) { last = status.running.message; console.log(last); }
      continue;
    }
    console.log(status.latest.message);
    process.exitCode = status.latest.status === 'success' ? 0 : 1;
    break;
  }
  await pool.end();
  process.exit(process.exitCode || 0);
})().catch(error => { console.error(error.message); process.exit(1); });

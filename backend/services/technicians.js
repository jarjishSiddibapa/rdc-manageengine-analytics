// Which technicians count as active. The list lives only in this app (ManageEngine is never told) and holds just the names marked
// inactive, so anyone new is active until someone says otherwise. The figures themselves are filtered in analytics.js.
const { pool } = require('../db/pool');
const analytics = require('./analytics');

const MAX_NAMES = 2000;

class TechnicianError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}

const list = () => analytics.technicianDirectory();

function nameList(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_NAMES || value.some(v => typeof v !== 'string')) throw new TechnicianError('Send technician names as a list');
  return value.map(v => v.trim()).filter(Boolean);
}

// Marks the names in `inactive` inactive and the names in `active` active, all or nothing. Only technicians the app knows can be
// marked inactive. Returns the names whose status really changed.
async function setStatus(body, by) {
  const toInactive = nameList(body?.inactive);
  const toActive = nameList(body?.active);
  if (!toInactive.length && !toActive.length) throw new TechnicianError('Choose at least one technician');
  const { technicians } = await list();
  const known = new Map(technicians.map(t => [t.name.toLowerCase(), t]));
  const pick = name => {
    const found = known.get(name.toLowerCase());
    if (!found) throw new TechnicianError(`No technician called "${name.slice(0, 80)}"`);
    return found;
  };
  const off = [...new Set(toInactive.map(pick))];
  const on = [...new Set(toActive.map(pick))];
  if (off.some(t => on.includes(t))) throw new TechnicianError('A technician cannot be both active and inactive');
  const deactivated = off.filter(t => t.active).map(t => t.name);
  const activated = on.filter(t => !t.active).map(t => t.name);

  if (deactivated.length || activated.length) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (deactivated.length) await connection.query('INSERT IGNORE INTO inactive_technicians (name, marked_by) VALUES ?', [deactivated.map(name => [name, by || null])]);
      if (activated.length) await connection.query('DELETE FROM inactive_technicians WHERE name IN (?)', [activated]);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
    analytics.refreshTechnicianStatus();
  }
  return { deactivated, activated };
}

module.exports = { list, setStatus, TechnicianError };

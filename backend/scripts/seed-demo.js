// Seeds a DEMO database with fictional service requests, technicians and sync history, so the screens can be
// explored (and screenshotted) without any ManageEngine connection or real data.
//
//   1. In backend/.env use a database whose name ends in "_demo" (e.g. DB_NAME=manageengine_analytics_demo)
//      and NO_BACKGROUND=1, then start the app once so it creates the tables and the first administrator.
//   2. cd backend && node scripts/seed-demo.js
//
// Every name, subject and number below is invented. The script refuses to run against any other database name.
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true })
const mysql = require('mysql2/promise')

const DB = process.env.DB_NAME || ''
if (!/_demo$/.test(DB)) {
  console.error(`Refusing to seed "${DB}": the database name must end in "_demo" so real data is never overwritten.`)
  process.exit(1)
}

let seed = 20261111
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
const pick = (a, w) => {
  if (!w) return a[Math.floor(rnd() * a.length)]
  let t = rnd() * w.reduce((x, y) => x + y, 0)
  for (let i = 0; i < a.length; i++) { t -= w[i]; if (t <= 0) return a[i] }
  return a[a.length - 1]
}
const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ')

const techs = [
  ['Aarav Mehta', 'Service Desk'], ['Diya Sharma', 'Service Desk'], ['Kabir Nair', 'Infrastructure'],
  ['Meera Iyer', 'Applications'], ['Rohan Kulkarni', 'Infrastructure'], ['Sana Qureshi', 'Service Desk'],
  ['Vikram Rao', 'Applications'], ['Tara Menon', 'Service Desk'],
]
const speed = { 'Aarav Mehta': 0.8, 'Diya Sharma': 0.7, 'Kabir Nair': 1.3, 'Meera Iyer': 1.1, 'Rohan Kulkarni': 1.6, 'Sana Qureshi': 0.9, 'Vikram Rao': 1.2, 'Tara Menon': 1.0 }
const requesters = ['Ishaan Verma', 'Anaya Patil', 'Dev Joshi', 'Kriti Bose', 'Neel Shah', 'Pooja Desai', 'Samar Khan', 'Riya Chopra', 'Yash Malhotra', 'Zoya Ansari', 'Arjun Pillai', 'Mansi Gupta']
const cats = [['Hardware', ['Laptop', 'Printer', 'Peripherals']], ['Software', ['Installation', 'Licence', 'Crash']], ['Network', ['VPN', 'Wi-Fi', 'Slow connection']], ['Access', ['New account', 'Password reset', 'Permissions']], ['Email', ['Mailbox full', 'Shared mailbox', 'Spam']]]
const subjects = {
  Hardware: ['Laptop will not boot', 'Printer offline on 2nd floor', 'Replace faulty keyboard', 'Docking station not detected'],
  Software: ['Install reporting add-in', 'Spreadsheet crashes on open', 'Licence expired for design tool', 'Update PDF reader'],
  Network: ['VPN disconnects every hour', 'Wi-Fi drops in meeting room', 'Slow file share access'],
  Access: ['New joiner account setup', 'Reset password for portal', 'Grant folder permissions'],
  Email: ['Mailbox almost full', 'Add user to shared mailbox', 'Too much spam reaching inbox'],
}
const groups = ['Service Desk', 'Infrastructure', 'Applications']
const sites = ['Head Office', 'North Site', 'South Site', 'Warehouse']
const depts = ['Finance', 'Operations', 'Sales', 'HR', 'Logistics']
const prios = ['Low', 'Medium', 'High', 'Urgent']

;(async () => {
  const db = await mysql.createConnection({ host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: DB, multipleStatements: true })
  await db.query('DELETE FROM request_events; DELETE FROM request_history; DELETE FROM requests; DELETE FROM technicians; DELETE FROM sync_runs; DELETE FROM backup_runs')
  const now = new Date()
  const start = new Date(now.getTime() - 190 * 864e5)
  const days = Math.round((now - start) / 864e5)
  await db.query('INSERT INTO technicians (name,email,department,source) VALUES ?', [techs.map(([n, d]) => [n, n.toLowerCase().replace(' ', '.') + '@demo.example', d, 'roster'])])

  const reqRows = [], histRows = [], evRows = []
  let n = 1000
  for (let d = 0; d < days; d++) {
    const day = new Date(start.getTime() + d * 864e5)
    const dow = day.getUTCDay()
    if (dow === 0) continue
    const count = dow === 6 ? 2 : Math.floor(3 + rnd() * 5 + (d / days) * 2)
    for (let i = 0; i < count; i++) {
      n++
      const [cat, subs] = pick(cats, [3, 3, 3, 4, 2])
      const sub = pick(subs)
      const t = pick(techs)[0] && pick(techs, [1.3, 1.2, 1, 1, 0.8, 1.2, 1, 1.1])
      const tech = t[0]
      const created = new Date(day.getTime() + (3 + rnd() * 9) * 3600e3)
      const assignMin = Math.round(4 + rnd() * rnd() * 160)
      const assigned = new Date(created.getTime() + assignMin * 60e3)
      const prio = pick(prios, [3, 6, 3, 1])
      const baseH = { Low: 30, Medium: 16, High: 8, Urgent: 4 }[prio]
      const resH = Math.max(0.3, baseH * speed[tech] * Math.exp((rnd() - 0.5) * 1.8))
      const ageH = (now - created) / 3600e3
      const closed = ageH > resH && rnd() < 0.93
      const completed = closed ? new Date(created.getTime() + resH * 3600e3) : null
      const status = closed ? 'Closed' : pick(['In Progress', 'Open', 'On Hold', 'Pending with User'], [4, 2, 2, 3])
      const pendingParty = closed ? null : (status === 'Pending with User' ? 'User' : 'Technician')
      const meId = String(900000000000 + n)
      const display = String(n)
      const subject = pick(subjects[cat])
      const reass = rnd() < 0.16 ? (rnd() < 0.3 ? 2 : 1) : 0
      const otherTechs = techs.filter(x => x[0] !== tech)
      const path = reass ? [pick(otherTechs)[0], ...(reass > 1 ? [pick(otherTechs)[0]] : []), tech] : [tech]
      const lastUpd = completed || new Date(Math.min(now.getTime(), created.getTime() + rnd() * ageH * 3600e3 * 0.6))
      reqRows.push([meId, display, subject, status, status, pendingParty, tech, tech.toLowerCase().replace(' ', '.') + '@demo.example', pick(requesters), cat, sub, prio, 'Service Request', pick(groups), pick(sites), pick(depts), pick(['Web Form', 'E-Mail', 'Phone Call'], [5, 3, 2]), fmt(created), fmt(assigned), completed ? fmt(completed) : null, null, fmt(lastUpd), 1])
      const replyMin = Math.round(assignMin + 6 + rnd() * 140 * speed[tech])
      const firstResp = new Date(created.getTime() + replyMin * 60e3)
      const holdMin = closed && status !== 'x' && rnd() < 0.18 ? Math.round(60 + rnd() * 900) : 0
      const waitMin = closed && rnd() < 0.3 ? Math.round(30 + rnd() * 600) : 0
      const reopens = closed && rnd() < 0.05 ? 1 : 0
      const techReplies = 1 + Math.floor(rnd() * 4), reqReplies = Math.floor(rnd() * 3)
      histRows.push([meId, fmt(now), fmt(lastUpd), 6 + techReplies + reqReplies, 1 + reass, reass, path.length, path.join(' > '), fmt(assigned), 'Service Desk Lead', fmt(assigned), fmt(firstResp), fmt(firstResp), techReplies, reqReplies, fmt(lastUpd), fmt(lastUpd), reqReplies ? fmt(lastUpd) : null, fmt(lastUpd), reopens, completed ? fmt(completed) : null, closed ? tech : null, closed ? pick(['Resolved', 'Fixed', 'Workaround provided'], [6, 3, 1]) : null, closed ? (reass === 0 && reopens === 0 && techReplies <= 2 ? 1 : 0) : null, closed ? holdMin : null, closed ? 0 : null, closed ? waitMin : null, closed ? holdMin : null, closed ? 0 : null, closed ? waitMin : null, rnd() < 0.4 ? 1 : 0, Math.round(rnd() * 90), Math.floor(rnd() * 3), rnd() < 0.15 ? 1 : 0, reass ? 1 : 0, rnd() < 0.08 ? 1 : 0, 0, 0, 0])
      let seq = 0
      const ev = (at, kind, actor, summary, from = null, to = null) => evRows.push([meId, ++seq, fmt(at), kind, actor, summary, from, to])
      ev(created, 'created', 'System', `Request raised by ${reqRows[reqRows.length - 1][8]}`)
      ev(assigned, 'assigned', 'Service Desk Lead', `Assigned to ${path[0]}`, null, path[0])
      for (let k = 1; k < path.length; k++) ev(new Date(assigned.getTime() + k * 40 * 60e3), 'reassigned', path[k - 1], `Reassigned from ${path[k - 1]} to ${path[k]}`, path[k - 1], path[k])
      ev(firstResp, 'reply', tech, 'Technician replied to the requester')
      if (holdMin) ev(new Date(firstResp.getTime() + 20 * 60e3), 'status', tech, 'Status changed to On Hold', 'In Progress', 'On Hold')
      if (completed) ev(completed, 'status', tech, 'Status changed to Closed', 'In Progress', 'Closed')
    }
  }
  const chunk = async (sql, rows) => { for (let i = 0; i < rows.length; i += 400) await db.query(sql, [rows.slice(i, i + 400)]) }
  await chunk('INSERT INTO requests (me_id,display_id,subject,status_name,status,pending_party,technician,technician_email,requester,category,subcategory,priority,request_type,group_name,site,department,mode,created_at,assigned_at,completed_at,due_by,last_updated_at,in_scope) VALUES ?', reqRows)
  await chunk('INSERT INTO request_history (me_id,fetched_at,source_updated_at,events,assignments,reassignments,technicians_involved,tech_path,first_assigned_at,first_assigned_by,last_assigned_at,first_response_at,first_response_assigned_at,tech_replies,requester_replies,last_activity_at,last_tech_reply_at,last_requester_reply_at,status_since,reopen_count,first_closed_at,closed_by,closure_code,fcr,hold_all,gap_all,wait_all,hold_asg,gap_asg,wait_asg,worklog_count,worklog_minutes,notes_count,attachments,group_changes,priority_changes,category_changes,forwards,merged) VALUES ?', histRows)
  await chunk('INSERT INTO request_events (me_id,seq,at,kind,actor,summary,from_value,to_value) VALUES ?', evRows)
  const runs = []
  for (let i = 0; i < 12; i++) {
    const t = new Date(now.getTime() - i * 30 * 60e3)
    runs.push(['quick', 'schedule', null, fmt(t), fmt(new Date(t.getTime() + 9e3)), 'success', 1, 40 + Math.floor(rnd() * 20), 3 + Math.floor(rnd() * 6), 3 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 3), 2 + Math.floor(rnd() * 4), 'Quick sync finished'])
  }
  runs.push(['deep', 'schedule', null, '2026-11-11 01:00:00', '2026-11-11 01:06:41', 'success', 12, reqRows.length, reqRows.length, 0, 14, 0, 'Deep sync finished'])
  await db.query('INSERT INTO sync_runs (mode,trigger_source,started_by,started_at,finished_at,status,pages,scanned,fetched,inserted,updated,removed,message) VALUES ?', [runs])
  console.log('seeded', reqRows.length, 'SRs', histRows.length, 'history', evRows.length, 'events')
  await db.end()
})().catch(e => { console.error(e); process.exit(1) })

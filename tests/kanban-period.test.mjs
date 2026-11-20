import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.PROSPECTOR_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'prospector-period-'));
const {db,run}=await import('../dashboard/db.mjs');
const {kanbanPeriodFromQuery,brazilDay,brazilMidnight,prospectingPeriodSnapshot}=await import('../dashboard/kanban-period.mjs');
const {kanbanSnapshot}=await import('../dashboard/kanban.mjs');
const clock=new Date('2026-11-20T18:00:00Z');
const query=(period,from,to)=>new URLSearchParams({period,...(from?{from}:{}),...(to?{to}:{})});
test('São Paulo timezone, inclusive calendar days, fixed windows',()=>{
 assert.equal(brazilDay(new Date('2026-11-20T02:59:59Z')),'2026-11-19');
 assert.equal(brazilDay(new Date('2026-11-20T03:00:00Z')),'2026-11-20');
 assert.equal(brazilMidnight('2026-11-20'),'2026-11-20T03:00:00.000Z');
 const today=kanbanPeriodFromQuery(query('today'),clock);
 assert.equal(today.startISO,'2026-11-20T03:00:00.000Z');
 assert.equal(today.endISO,'2026-11-21T03:00:00.000Z');
 assert.equal(kanbanPeriodFromQuery(query('7d'),clock).from,'2026-11-14');
 assert.equal(kanbanPeriodFromQuery(query('30d'),clock).from,'2026-10-22');
 assert.equal(kanbanPeriodFromQuery(query('custom','2026-11-11','2026-11-20'),clock).to,'2026-11-20');
});
test('invalid custom ranges rejected',()=>{
 for(const params of [query('nope'),query('custom','2026-11-21','2026-11-20'),query('custom','2026-02-30','2026-03-01'),query('custom','2020-01-01','2035-01-01'),query('custom','','')]){
  assert.throws(()=>kanbanPeriodFromQuery(params,clock));
 }
});
db.exec(`CREATE TABLE IF NOT EXISTS prospecting_batch_items(
 id TEXT PRIMARY KEY,batch_id TEXT,lead_id TEXT NOT NULL,phone TEXT NOT NULL,
 status TEXT NOT NULL,attempt_at TEXT,created_at TEXT NOT NULL)`);
function lead(id,phone,status='DISCOVERED'){
 const iso='2026-10-01T12:00:00Z';
 run('INSERT INTO leads(id,business,phone,stage,contact_permission,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?)',
 id,'Empresa '+id,phone,status,1,iso,iso);
}
function event(id,leadId,phone,status,at){
 run('INSERT INTO prospecting_batch_items(id,batch_id,lead_id,phone,status,attempt_at,created_at) VALUES(?,?,?,?,?,?,?)',
 id,'batch-test',leadId,phone,status,at,at);
}
lead('lead-today','5515999111101');
lead('lead-old','5515999111102');
lead('lead-week','5515999111103','CONVERSING');
lead('lead-queued','5515999111104');
lead('lead-uncertain','5515999111105');
lead('lead-yesterday','5515999111106');
lead('lead-tomorrow','5515999111107');
event('sent-today','lead-today','5515999111101','SENT','2026-11-20T11:00:00Z');
event('same-day-repeat','lead-today','5515999111101','SENT','2026-11-20T12:00:00Z');
event('sent-old','lead-old','5515999111102','SENT','2026-11-12T12:00:00Z');
event('sent-week','lead-week','5515999111103','SENT','2026-11-15T12:00:00Z');
event('queued-today','lead-queued','5515999111104','QUEUED','2026-11-20T10:00:00Z');
event('unknown-today','lead-uncertain','5515999111105','UNKNOWN','2026-11-20T10:30:00Z');
event('yesterday-before-midnight','lead-yesterday','5515999111106','SENT','2026-11-20T02:59:59Z');
event('tomorrow-after-midnight','lead-tomorrow','5515999111107','SENT','2026-11-21T03:00:00Z');
test('actual SENT outreach is counted once per lead, not queued or uncertain attempts',()=>{
 const today=kanbanPeriodFromQuery(query('today'),clock);
 const snap=prospectingPeriodSnapshot(today);
 assert.equal(snap.total,1);
 assert.deepEqual(snap.leadIds,['lead-today']);
 const board=kanbanSnapshot({period:today});
 assert.equal(board.prospections,1);
 assert.equal(board.counts.approaching,1);
 assert.equal(board.total,1);
 assert.deepEqual(board.columns.approaching.map(x=>x.id),['lead-today']);
});
test('week, month and custom filter the Kanban cards consistently',()=>{
 const week=kanbanSnapshot({period:kanbanPeriodFromQuery(query('7d'),clock)});
 assert.equal(week.prospections,3);
 assert.equal(week.total,3);
 assert.equal(week.counts.conversing,1);
 const custom=kanbanSnapshot({period:kanbanPeriodFromQuery(query('custom','2026-11-12','2026-11-12'),clock)});
 assert.equal(custom.prospections,1);
 assert.deepEqual(custom.columns.approaching.map(x=>x.id),['lead-old']);
 const month=kanbanSnapshot({period:kanbanPeriodFromQuery(query('30d'),clock)});
 assert.equal(month.prospections,4);
 const all=kanbanSnapshot({period:kanbanPeriodFromQuery(query('all'),clock)});
 assert.equal(all.prospections,5);
});

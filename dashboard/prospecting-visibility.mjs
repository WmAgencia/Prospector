// Permanent lead-impression ledger. A business becomes "previously shown"
// as soon as the list API returns it; future search sessions cannot show it again.
// Keeping the active browser session stable avoids an empty screen on refresh.
import {db,all,one,run,tx,now,id} from './db.mjs';
import {prospectingList} from './prospecting-search.mjs';
import {threeMonthsAfter} from './prospecting-recontact.mjs';

db.exec("CREATE TABLE IF NOT EXISTS prospecting_viewed_keys(key TEXT PRIMARY KEY,lead_id TEXT NOT NULL REFERENCES leads(id),session_id TEXT NOT NULL,shown_at TEXT NOT NULL)");
db.exec("CREATE INDEX IF NOT EXISTS idx_prospecting_viewed_lead ON prospecting_viewed_keys(lead_id)");

const clean=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export function businessKeys(record){
 const keys=[];
 const company=clean(record.business),city=clean(record.city);
 if(company&&city)keys.push('company:'+city+':'+company);
 if(record.phone){const p=String(record.phone).replace(/\D/g,'');if(p.length>=10)keys.push('phone:'+p);}
 if(record.instagram){const ig=clean(record.instagram);if(ig)keys.push('instagram:'+ig);}
 // The source can change its ID or contact information without bypassing
 // the registered city + company or phone fingerprints.
 keys.push('lead:'+record.id);
 return [...new Set(keys)];
}
export function listUnseenCompanies({session='',niche='',city='',status='uncontacted',limit=500}={}){
 // Existing automation and CRM use their own queries, not this screen ledger.
 const valid=/^[a-f0-9-]{36}$/i.test(session),sessionId=valid?session:id();
 const source=prospectingList({niche,city,status,limit:6000});
 const output=[],inPage=new Set();
 tx(()=>{
  for(const lead of source.results){
   if(output.length>=Math.min(500,Math.max(1,Number(limit)||500)))break;
   const keys=businessKeys(lead);
   if(keys.some(k=>inPage.has(k)))continue;
   const current=keys.map(k=>one('SELECT session_id,shown_at FROM prospecting_viewed_keys WHERE key=?',k)).filter(Boolean);
   const previous=current.filter(x=>x.session_id!==sessionId);
   if(previous.length){
    // Fresh opportunities are one-time only. Prior contacted companies may
    // return only three calendar months after the LATEST exposure.
    if(!lead.recontactEligible)continue;
    if(previous.some(x=>!threeMonthsAfter(x.shown_at)||Date.parse(threeMonthsAfter(x.shown_at))>Date.now()))continue;
   }
   // If two records of the same business exist, only one is shown in a session.
   keys.forEach(k=>inPage.add(k));
   const timestamp=now();
   for(const key of keys)run('INSERT INTO prospecting_viewed_keys(key,lead_id,session_id,shown_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET lead_id=excluded.lead_id,session_id=excluded.session_id,shown_at=excluded.shown_at WHERE prospecting_viewed_keys.session_id<>excluded.session_id',key,lead.id,sessionId,timestamp);
   output.push(lead);
  }
 });
 return {...source,results:output,returned:output.length,shownInThisSession:output.length,visibility:'FIRST_EXPOSURE_OR_THREE_MONTH_RECONTACT',
  note:'Primeira exposição única. Contatos sem resposta ou com desinteresse leve só retornam após três meses da última abordagem e da última exibição; recusas definitivas nunca retornam.'};
}

import crypto from 'node:crypto';
import {db,one,all,run,now,getSetting,setSetting,stage,addLead,phone,audit} from './db.mjs';
import {prospectingList} from './prospecting-search.mjs';
db.exec("CREATE TABLE IF NOT EXISTS groq_owner_approvals(code TEXT PRIMARY KEY,jid TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL)");
const props=(x)=>({type:'object',properties:x,additionalProperties:false});
export const agentTools=[
 {type:'function',function:{name:'system_status',description:'Consult Prospector operational status and counters',parameters:props({})}},
 {type:'function',function:{name:'list_prospects',description:'Find existing prospects filtered by niche and city. Returns up to 25.',parameters:props({niche:{type:'string'},city:{type:'string'},status:{type:'string',enum:['all','uncontacted','contacted']}})}},
 {type:'function',function:{name:'set_pause',description:'Pause or unpause workflows. Does not enable automatic messages.',parameters:{...props({paused:{type:'boolean'}}),required:['paused']}}},
 {type:'function',function:{name:'update_lead',description:'Edit existing lead stage or notes',parameters:{...props({lead_id:{type:'string'},stage:{type:'string',enum:['DISCOVERED','CONTACTED','REPLIED','INTERESTED','NO_INTEREST','CLOSED_WON']},notes:{type:'string'}}),required:['lead_id']}}},
 {type:'function',function:{name:'prepare_message',description:'Request confirmation before sending one message to a contact who messaged us before',parameters:{...props({phone:{type:'string'},text:{type:'string'}}),required:['phone','text']}}}
];
function approvedRecipient(number){
 const lead=one('SELECT id FROM leads WHERE phone=?',number);
 return lead&&!one('SELECT phone FROM suppressions WHERE phone=?',number)&&!!one("SELECT 1 FROM threads t JOIN messages m ON m.thread_id=t.id WHERE t.lead_id=? AND m.direction='in' LIMIT 1",lead.id);
}
export async function runAgentTool(name,a={}){
 if(name==='system_status')return {leads:one('SELECT count(*) n FROM leads')?.n||0,threads:one('SELECT count(*) n FROM threads')?.n||0,paused:getSetting('paused',true),autoSend:false};
 if(name==='list_prospects')return prospectingList({city:String(a.city||'').slice(0,80),niche:String(a.niche||'').slice(0,80),status:a.status||'uncontacted',limit:25});
 if(name==='set_pause'){if(typeof a.paused!=='boolean')throw Error('Boolean required');setSetting('paused',a.paused);audit('GROQ_OWNER_PAUSE',null,{paused:a.paused});return {paused:a.paused,autoSend:false};}
 if(name==='update_lead'){
  const lead=one('SELECT id FROM leads WHERE id=?',String(a.lead_id||''));if(!lead)throw Error('Lead not found');
  if(a.stage)stage(lead.id,a.stage,'GROQ_OWNER');
  if(a.notes!==undefined){if(typeof a.notes!=='string'||a.notes.length>800)throw Error('Invalid note');run('UPDATE leads SET notes=? WHERE id=?',a.notes,lead.id);}
  audit('GROQ_OWNER_LEAD_EDIT',lead.id,{stage:a.stage||null,note:typeof a.notes==='string'});
  return {updated:true,id:lead.id};
 }
 if(name==='prepare_message'){
  const number=phone(a.phone),body=String(a.text||'').trim();
  if(!number||body.length<1||body.length>1200)throw Error('Invalid phone/text');
  if(!approvedRecipient(number))throw Error('No inbound conversation or contact opted out');
  const code=String(crypto.randomInt(100000,999999));
  run('INSERT INTO groq_owner_approvals VALUES(?,?,?,?,?)',code,number+'@s.whatsapp.net',body,'PENDING',Date.now()+600000);
  audit('GROQ_OWNER_MESSAGE_PREPARED',null,{suffix:number.slice(-4)});
  return {requiresConfirmation:true,code,recipientSuffix:number.slice(-4),preview:body,instruction:'Reply CONFIRMAR '+code+' within 10 minutes'};
 }
 throw Error('Tool not available');
}
export function claimApproval(code){
 const pending=one("SELECT * FROM groq_owner_approvals WHERE code=? AND state='PENDING' AND expires>?",String(code),Date.now());
 if(!pending)return null;
 if(!approvedRecipient(pending.jid.split('@')[0]))return null;
 run("UPDATE groq_owner_approvals SET state='UNKNOWN' WHERE code=?",code);
 return pending;
}
export function markApproval(code){run("UPDATE groq_owner_approvals SET state='SENT' WHERE code=?",code);}

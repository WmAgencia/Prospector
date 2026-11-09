// Read-only preflight against exactly five REAL, previously approved CRM leads.
// This module never creates a batch, sends a request to the WhatsApp messages
// endpoint, changes consent, charges credits or mutates lead state.
import {all,getSetting} from './db.mjs';
import {documentedOptIn} from './outreach-queue.mjs';
import {recontactDecision} from './prospecting-recontact.mjs';
import {isExcludedTestContact} from './test-contact-exclusion.mjs';
import {insideApproachWindow} from './outreach-window.mjs';
import {greetingForProspect} from './prospecting-introduction.mjs';
import {APPROACH_CADENCE,chooseApproachInterval} from './approach-cadence.mjs';
import {dailyApproachBudget} from './daily-approach-limit.mjs';
import {waOperationalStatus} from './waakg-control.mjs';
import {managedSessions} from './waakg-session-registry.mjs';

export const FIVE_TEST_AT=new Date('2026-11-10T11:00:00.000Z');
const normalize=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const businessKey=lead=>lead.city&&lead.business?normalize(lead.city)+'|'+normalize(lead.business):'';
const spClock=date=>new Intl.DateTimeFormat('pt-BR',{
 timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',
 second:'2-digit',hourCycle:'h23'
}).format(date);

export async function runFiveApprovedPreflight({at=FIVE_TEST_AT,waStatus=waOperationalStatus}={}){
 const atDate=at instanceof Date?at:new Date(at);
 if(!Number.isFinite(atDate.getTime()))throw Error('Momento de simulação inválido');
 const before=new Date(atDate.getTime()-1000);
 const rows=all("SELECT id,name,business,city,phone,stage,contact_permission,created_at FROM leads WHERE phone IS NOT NULL AND contact_permission=1 AND stage IN ('DISCOVERED','NO_INTEREST') ORDER BY created_at DESC LIMIT 6000");
 const selected=[],phones=new Set(),businesses=new Set();
 let excluded=0;
 for(const lead of rows){
  if(selected.length===5)break;
  const key=businessKey(lead);
  if(isExcludedTestContact(lead.phone)||phones.has(lead.phone)||key&&businesses.has(key)||
    !documentedOptIn(lead.id)||!recontactDecision(lead,atDate.getTime()).eligible){
   excluded++;continue;
  }
  selected.push(lead);phones.add(lead.phone);if(key)businesses.add(key);
 }
 let currentMs=atDate.getTime(),precedingIntervalMs=90000;
 const planned=[];
 for(let i=0;i<selected.length;i++){
  const lead=selected[i];
  if(i>0)currentMs+=precedingIntervalMs;
  const sendingAt=new Date(currentMs);
  // This is the same greeting renderer and random-cadence function used by
  // production. A deterministic random choice makes the report reproducible.
  const nextIntervalMs=chooseApproachInterval(precedingIntervalMs,n=>(13+i*23)%n);
  const message=greetingForProspect(lead,sendingAt);
  planned.push({
   ordinal:i+1,
   recipientSuffix:lead.phone.slice(-4),
   eligible:documentedOptIn(lead.id)&&recontactDecision(lead,currentMs).eligible,
   insideWindow:insideApproachWindow(sendingAt),
   clock:spClock(sendingAt),
   sincePreviousSec:i?precedingIntervalMs/1000:0,
   messageGenerated:typeof message==='string'&&message.trim().length>=2&&message.length<=1000,
   nextIntervalSec:nextIntervalMs/1000
  });
  precedingIntervalMs=nextIntervalMs;
 }
 const online=await waStatus().catch(e=>({connected:false,approachReady:false,reason:String(e?.message||e).slice(0,80)}));
 const budget=dailyApproachBudget(atDate);
 const checks={
  fiveRealApprovedRecipients:planned.length===5,
  authorized:planned.every(x=>x.eligible),
  greetingReady:planned.every(x=>x.messageGenerated),
  cadenceValid:planned.every((x,i)=>i===0||(x.sincePreviousSec>=APPROACH_CADENCE.minSeconds&&x.sincePreviousSec<=APPROACH_CADENCE.maxSeconds)),
  beforeWindowBlocked:!insideApproachWindow(before),
  startWindowOpen:insideApproachWindow(atDate),
  everyPlannedTimeInWindow:planned.every(x=>x.insideWindow),
  notPaused:getSetting('paused',true)===false,
  automaticEnabled:getSetting('autonomous_outreach_enabled',false)===true,
  dailyQuotaAllowsFive:budget.remaining>=5,
  connectedSender:online.approachReady===true||online.connected===true,
  senderConfigured:managedSessions().length>=1
 };
 return {
  kind:'FIVE_APPROVED_CONTACTS_READ_ONLY',
  target:'2026-11-10 08:00 America/Sao_Paulo',
  selected:planned.length,examined:rows.length,skippedBeforeFive:excluded,
  checks,ready:Object.values(checks).every(Boolean),
  waConnected:checks.connectedSender,configuredSenders:managedSessions().length,
  dailyLimit:budget.limit,dailyRemaining:budget.remaining,cadence:APPROACH_CADENCE,
  planned,realMessagesSent:0,waSendEndpointCalled:false,contactsModified:0
 };
}

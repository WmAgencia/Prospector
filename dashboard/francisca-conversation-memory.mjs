// Tenant-scoped, persistent memory; stores only intent labels and conversation flags.
// The operational database is isolated per Prospector account.
import {db,one,all,run,now} from './db.mjs';
import {nextConversationState} from './francisca-conversation-state.mjs';
db.exec("CREATE TABLE IF NOT EXISTS francisca_conversation_memory(thread_id TEXT PRIMARY KEY,seen_rowid INTEGER NOT NULL DEFAULT 0,state_json TEXT NOT NULL,updated_at TEXT NOT NULL)");
export function recallConversationMemory(threadId){
 const key=String(threadId||'');if(!key)return nextConversationState();
 const previous=one('SELECT seen_rowid,state_json FROM francisca_conversation_memory WHERE thread_id=?',key);
 let state={};try{state=previous?.state_json?JSON.parse(previous.state_json):{};}catch{}
 let seen=Number(previous?.seen_rowid)||0;
 // Read only unprocessed messages; their contents are never stored in the summary.
 for(let i=0;i<20;i++){
  const batch=all('SELECT rowid AS message_rowid,direction,body FROM messages WHERE thread_id=? AND rowid>? ORDER BY rowid ASC LIMIT 200',key,seen);
  if(!batch.length)break;
  state=nextConversationState(state,batch);
  seen=Number(batch.at(-1).message_rowid)||seen;
  if(batch.length<200)break;
 }
 run("INSERT INTO francisca_conversation_memory(thread_id,seen_rowid,state_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET seen_rowid=excluded.seen_rowid,state_json=excluded.state_json,updated_at=excluded.updated_at",
  key,seen,JSON.stringify(state),now());
 return state;
}

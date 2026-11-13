// A demo-only reply restriction stored in the individual customer workspace.
// The shared Consecom workspace and ordinary clients are unaffected.
import {getSetting} from './db.mjs';
export const TW_DEMO_REPLY_GUARD_KEY='twco_demo_test_reply_guard_v1';
export function twDemoReplyAllowed({jid,sessionId}={}){
 const guard=getSetting(TW_DEMO_REPLY_GUARD_KEY,null);
 if(!guard?.enabled)return {allowed:true,restricted:false};
 const valid=process.env.PROSPECTOR_TENANT_ID&&
  process.env.PROSPECTOR_TENANT_INTERNAL!=='true'&&
  /^55\d{10,11}@s\.whatsapp\.net$/.test(String(jid||''))&&
  /^prospector-[0-9a-f-]{36}$/i.test(String(sessionId||''));
 return {allowed:Boolean(valid&&guard.senderJid===jid&&guard.sessionId===sessionId),
  restricted:true,reason:'DEMO_TEST_SENDER_ONLY'};
}

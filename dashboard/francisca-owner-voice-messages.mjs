// A single, verified owner's LIVE CALL may prepare and verbally approve one
// direct WhatsApp message. All state is confined to that call, not the model.
// No codes, owner WhatsApp confirmations, bulk outreach, retries or automation.
import {randomUUID} from 'node:crypto';
import {db,one,run,now,audit} from './db.mjs';
import {classifyContact,verifiedOwnerPhone} from './whatsapp-roles.mjs';
import {waRequest} from './waakg-control.mjs';

db.exec("CREATE TABLE IF NOT EXISTS francisca_voice_manual_sends(id TEXT PRIMARY KEY,jid TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");

const simple=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const phonePattern=/(?:\+?\d[\d()\s.-]{8,32}\d)/g;
const command=/\b(?:envi\w*|mand\w*|dispar\w*|encaminh\w*|escrev\w*|passa\w*)\b[\s\S]{0,100}\b(?:mensage\w*|recado|whatsapp|texto)\b|\b(?:mensage\w*|whatsapp|recado)\b[\s\S]{0,90}\b(?:para|pro|pra|ao|no numero|nesse numero)\b/i;
const clear=/^(?:nao|não|cancela|cancelar|deixa pra la|deixa para la|desiste|esquece|para|nao envia|não envia)[\s.,!]*$/i;
const approval=/^(?:sim[,!.\s]*(?:pode|manda|envia|envie)?(?:\s+enviar)?|pode\s+enviar(?:\s+sim)?|pode\s+mandar(?:\s+sim)?|pode\s+sim|pode\s+enviar\s+agora|envia(?:\s+agora)?|envie(?:\s+agora)?|manda(?:\s+agora)?|mande(?:\s+agora)?|autorizo(?:\s+o\s+envio)?|confirmo(?:\s+o\s+envio)?|confirmado|isso\s+mesmo[,!.\s]*(?:pode\s+enviar)?|t[aá]\s+autorizado)[.!?\s]*$/i;
function verified(actor){
 const role=classifyContact(actor||{});
 return role.role==='OWNER'&&role.authorized===true&&role.ownerTools===true&&
  actor?.jid===verifiedOwnerPhone()+'@s.whatsapp.net';
}
function phoneCandidate(heard){
 const found=[...String(heard||'').matchAll(phonePattern)]
  .map(match=>({match:match[0],start:match.index,digits:match[0].replace(/\D/g,'')}))
  .find(x=>x.digits.length>=10&&x.digits.length<=15);
 if(!found)return null;
 let value=found.digits;
 if(value.length===10||value.length===11)value='55'+value;
 if(!/^55\d{10,11}$/.test(value))return {invalid:true,raw:found.match};
 return {number:value,raw:found.match,start:found.start};
}
function stripBodyPrefix(input){
 return String(input||'').replace(/^\s*(?:a\s+mensagem(?:\s+que\s+eu\s+quero)?\s+(?:e|eh|é|seria)|o\s+texto\s+(?:e|eh|é|seria)|fala(?:ndo)?(?:\s+que)?|diz(?:endo)?(?:\s+que)?|escreve(?:ndo)?|com\s+(?:o\s+)?texto|com\s+(?:a\s+)?mensagem)\s*[:,-]?\s*/i,'')
  .replace(/^\s*(?:é\s+o\s+seguinte|o\s+seguinte)\s*[:,-]?\s*/i,'').trim();
}
function extractBody(heard,number){
 let text=String(heard||'');
 if(number?.raw)text=text.replace(number.raw,' ');
 const match=text.match(/\b(?:falando\s+(?:que\s+)?|dizendo\s+(?:que\s+)?|escrevendo\s+(?:que\s+)?|mensagem\s+é\s+|texto\s+é\s+|com\s+o\s+texto\s+|com\s+a\s+mensagem\s+)([\s\S]+)$/i);
 if(!match)return '';
 const body=stripBodyPrefix(match[1]).replace(/^\s*(?:é\s+que\s+|que\s+)/i,'').trim();
 return body.replace(/^[\s,:;-]+/,'').trim();
}
function antiBulk(heard){
 return /\b(?:todos\s+os|toda\s+a|varios\s+numeros|varias\s+pessoas|em\s+massa|disparo\s+em\s+massa|lista\s+de\s+transmissao|grupo\s+inteiro)\b/.test(simple(heard));
}
export function interpretVoiceSend(heard){
 const raw=String(heard||'').trim();
 if(!command.test(simple(raw)))return null;
 const candidate=phoneCandidate(raw);
 return {phone:candidate?.number||null,invalidPhone:Boolean(candidate?.invalid),
  text:extractBody(raw,candidate),bulk:antiBulk(raw)};
}
async function realSend({jid,sessionId,text}){
 const result=await waRequest('/api/messages/'+encodeURIComponent(sessionId)+'/'+encodeURIComponent(jid)+'/send',
  {method:'POST',data:{message:{text}}});
 return result.status===true;
}
export function newVoiceDirectMessageFlow({send=realSend}={}){
 let pending=null;
 const expires=()=>pending&&Date.now()>pending.expires;
 const preview=()=>{
  if(!pending?.phone||!pending?.text)return null;
  pending.stage='confirm';
  pending.expires=Date.now()+3*60_000;
  return 'A mensagem para o número terminado em '+pending.phone.slice(-4)+' é: "'+
   pending.text+'". Posso enviar?';
 };
 function supplyPhone(text){
  const found=phoneCandidate(text);
  if(found?.invalid)return 'Esse telefone está com a quantidade de dígitos incorreta. Pode informar o DDD e o número completo?';
  if(!found)return 'Qual é o número completo, com DDD, para enviar a mensagem?';
  pending.phone=found.number;
  pending.stage=pending.text?'confirm':'text';
  pending.expires=Date.now()+3*60_000;
  return pending.text?preview():'Perfeito. Qual é a mensagem que você quer enviar?';
 }
 async function approve(actor){
  if(!pending||pending.stage!=='confirm'||!pending.phone||!pending.text)
   return 'Ainda preciso conferir o destinatário e a mensagem antes de enviar.';
  const item=pending;
  pending=null; // Consume before any asynchronous work: no duplicate send on interruption.
  if(!verified(actor))return 'Não foi possível validar a autorização da ligação. Nenhuma mensagem foi enviada.';
  if(!/^55\d{10,11}$/.test(item.phone)||item.text.length>1200||item.text.length<1)
   return 'O telefone ou a mensagem está inválido. Nenhum envio foi realizado.';
  if(one('SELECT 1 FROM suppressions WHERE phone=?',item.phone))
   return 'Esse número está bloqueado para mensagens. Não enviei.';
  const recent=Number(one('SELECT COUNT(*) n FROM francisca_voice_manual_sends WHERE created_at>?',new Date(Date.now()-86400000).toISOString())?.n)||0;
  if(recent>=8)return 'Limite de oito envios avulsos por dia atingido. Não enviei.';
  const record=randomUUID(),target=item.phone+'@s.whatsapp.net';
  run('INSERT INTO francisca_voice_manual_sends VALUES(?,?,?,?,?,?)',record,target,item.text,'UNKNOWN',now(),now());
  audit('FRANCISCA_VOICE_DIRECT_ATTEMPT',null,{recipientSuffix:item.phone.slice(-4),source:'verified-owner-call'});
  try{
   const accepted=await send({jid:target,sessionId:actor.sessionId,text:item.text});
   if(!accepted)return 'O WhatsApp não confirmou o envio. Não vou tentar novamente automaticamente, para evitar duplicidade.';
   run("UPDATE francisca_voice_manual_sends SET state='ACCEPTED',updated_at=? WHERE id=?",now(),record);
   audit('FRANCISCA_VOICE_DIRECT_ACCEPTED',null,{recipientSuffix:item.phone.slice(-4),source:'verified-owner-call'});
   return 'O WhatsApp aceitou a mensagem para o número terminado em '+item.phone.slice(-4)+'. Confira a conversa para verificar a entrega.';
  }catch{
   return 'Não consegui confirmar o envio. Confira a conversa antes de pedir novamente; não vou repetir automaticamente.';
  }
 }
 return {
  async turn(heard,actor){
   const raw=String(heard||'').trim();
   if(!verified(actor)){pending=null;return null;}
   if(expires())pending=null;
   if(pending){
    if(clear.test(simple(raw))){pending=null;return 'Certo, cancelei o envio. Nenhuma mensagem foi enviada.';}
    const fresh=interpretVoiceSend(raw);
    if(fresh){
     if(fresh.bulk)return 'Consigo enviar uma mensagem individual, não um disparo em massa.';
     pending={phone:fresh.phone,text:fresh.text,stage:'',expires:Date.now()+3*60_000};
     if(fresh.invalidPhone||!fresh.phone)return supplyPhone(raw);
     if(!fresh.text){pending.stage='text';return 'Qual é a mensagem que você quer enviar?';}
     return preview();
    }
    if(pending.stage==='confirm'){
     if(approval.test(simple(raw)))return approve(actor);
     if(/\b(?:nao|não|altera|alterar|corrig|troca|muda|modifica|outro texto|outra mensagem)\b/.test(simple(raw))){
      const change=raw.match(/(?:para|por|seria|é|eh|seguinte)\s*[:,-]?\s*(.+)$/i);
      if(change&&change[1].length>1){
       pending.text=stripBodyPrefix(change[1]).slice(0,1200);
       return preview();
      }
      pending.stage='text';
      return 'Qual é o texto corrigido que você quer enviar?';
     }
     return 'Ainda não enviei. Quer autorizar exatamente essa mensagem? Diga "pode enviar" ou "cancela".';
    }
    if(pending.stage==='phone')return supplyPhone(raw);
    if(pending.stage==='text'){
     if(/^(?:nao sei|não sei|depois|mais tarde|ainda nao|ainda não)$/i.test(simple(raw)))
      return 'Certo, podemos definir o texto depois.';
     const text=stripBodyPrefix(raw);
     if(text.length<2)return 'Qual é a mensagem completa que você quer enviar?';
     if(text.length>1200)return 'A mensagem está longa demais para esse envio. Pode encurtar?';
     pending.text=text;
     return pending.phone?preview():supplyPhone(raw);
    }
   }
   const instruction=interpretVoiceSend(raw);
   if(!instruction)return null;
   if(instruction.bulk)return 'Consigo enviar uma mensagem individual, não um disparo em massa.';
   pending={phone:instruction.phone,text:instruction.text,stage:'',expires:Date.now()+3*60_000};
   if(instruction.invalidPhone||!instruction.phone){pending.stage='phone';return 'Qual é o telefone completo do destinatário, com DDD?';}
   if(!instruction.text){pending.stage='text';return 'Perfeito. Qual é a mensagem que você quer enviar?';}
   if(instruction.text.length>1200){pending.stage='text';return 'Pode informar um texto menor para essa mensagem?';}
   return preview();
  },
  end(){pending=null;},
  get state(){return pending?{stage:pending.stage,recipientSuffix:pending.phone?.slice(-4)||null}:null;}
 };
}

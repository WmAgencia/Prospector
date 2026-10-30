// A single, verified owner's LIVE CALL may prepare and verbally approve one
// direct WhatsApp message. All state is confined to that call, not the model.
// No codes, owner WhatsApp confirmations, bulk outreach, retries or automation.
import {randomUUID} from 'node:crypto';
import {db,one,run,now,audit} from './db.mjs';
import {classifyContact,verifiedOwnerPhone} from './whatsapp-roles.mjs';
import {waRequest} from './waakg-control.mjs';
import {deliverVoiceDirectMessage,checkDeliveryById} from './francisca-message-delivery.mjs';
import {parseSpokenBrazilPhone,readBackPhoneDigits} from './francisca-phone-speech.mjs';
import {recipientNameInVoice,findContactByName,contactChoiceFromSpeech} from './francisca-contact-names.mjs';

db.exec("CREATE TABLE IF NOT EXISTS francisca_voice_manual_sends(id TEXT PRIMARY KEY,jid TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
if(!db.prepare("PRAGMA table_info(francisca_voice_manual_sends)").all().some(x=>x.name==='provider_id'))
 db.exec("ALTER TABLE francisca_voice_manual_sends ADD COLUMN provider_id TEXT");

const simple=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const command=/\b(?:envi\w*|mand\w*|dispar\w*|encaminh\w*|escrev\w*|passa\w*)\b[\s\S]{0,100}\b(?:mensage\w*|recado|whatsapp|texto)\b|\b(?:mensage\w*|whatsapp|recado)\b[\s\S]{0,90}\b(?:para|pro|pra|ao|no numero|nesse numero)\b/i;
const clear=/^(?:nao|não|cancela|cancelar|deixa pra la|deixa para la|desiste|esquece|para|nao envia|não envia)[\s.,!]*$/i;
const approval=/^(?:sim[,!.\s]*(?:pode|manda|envia|envie)?(?:\s+enviar)?|pode\s+enviar(?:\s+sim)?|pode\s+mandar(?:\s+sim)?|pode\s+sim|pode\s+enviar\s+agora|envia(?:\s+agora)?|envie(?:\s+agora)?|manda(?:\s+agora)?|mande(?:\s+agora)?|autorizo(?:\s+o\s+envio)?|confirmo(?:\s+o\s+envio)?|confirmado|isso\s+mesmo[,!.\s]*(?:pode\s+enviar)?|t[aá]\s+autorizado)[.!?\s]*$/i;
function verified(actor){
 const role=classifyContact(actor||{});
 return role.role==='OWNER'&&role.authorized===true&&role.ownerTools===true&&
  actor?.jid===verifiedOwnerPhone()+'@s.whatsapp.net';
}
function phoneCandidate(heard){return parseSpokenBrazilPhone(heard);}
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
  contactName:candidate?null:recipientNameInVoice(raw),text:extractBody(raw,candidate),bulk:antiBulk(raw)};
}
async function realSend({jid,sessionId,text}){
 return deliverVoiceDirectMessage({jid,sessionId,text});
}
const askForDelivery=x=>/(?:ultim[ao]s?\s+mensage|ultim[ao]\s+envio|mensagem\s+(?:chegou|entregue|foi\s+entregue)|(?:verific\w*|chec\w*|confir\w*)\s+(?:a\s+)?(?:mensagem|entrega|envio)|nao\s+(?:chegou|recebeu|entregou)|nao\s+foi\s+entregue)/.test(simple(x));
export async function lastVoiceDirectDelivery(actor,{request=waRequest}={}){
 if(!verified(actor))return 'Não consegui verificar a identidade do proprietário nessa chamada.';
 const row=one('SELECT * FROM francisca_voice_manual_sends ORDER BY created_at DESC LIMIT 1');
 if(!row)return 'Não há mensagens individuais recentes registradas por esta função.';
 const suffix=String(row.jid||'').split('@')[0].slice(-4);
 if(row.state==='BLOCKED')return 'O último envio para o número terminado em '+suffix+' foi bloqueado antes da entrega.';
 let id=String(row.provider_id||'');
 if(!id){
  // Old calls did not persist provider IDs. Reconcile ONLY if a unique exact
  // outgoing message has the same body, JID and timestamp within 90 seconds.
  try{
   const history=await request('/api/chat/'+encodeURIComponent(actor.sessionId)+'/'+encodeURIComponent(row.jid));
   const messages=Array.isArray(history?.data)?history.data:[];
   const timestamp=Date.parse(row.created_at);
   const candidates=messages.filter(m=>m?.fromMe===true&&m?.remoteJid===row.jid&&
    m?.content===row.body&&m?.keyId&&
    Math.abs(Date.parse(m.timestamp)-timestamp)<90000);
   if(candidates.length===1)id=String(candidates[0].keyId);
  }catch{}
  if(id&&/^[-_A-Za-z0-9]{6,200}$/.test(id))
   run('UPDATE francisca_voice_manual_sends SET provider_id=? WHERE id=?',id,row.id);
 }
 if(!id)return 'O último pedido para o número terminado em '+suffix+
  ' não possui comprovante de entrega identificável. Confira a conversa; não vou enviar novamente automaticamente.';
 const result=await checkDeliveryById({jid:row.jid,sessionId:actor.sessionId,messageId:id},{request});
 if(result.proof){
  run('UPDATE francisca_voice_manual_sends SET state=?,updated_at=? WHERE id=?',result.status,now(),row.id);
  return 'Agora o WhatsApp confirma '+(result.status==='READ'?'que a mensagem foi lida':'a entrega da mensagem')+
   ' no número terminado em '+suffix+'.';
 }
 return 'Conferi a última mensagem para o número terminado em '+suffix+
  '. O estado informado pelo WhatsApp é '+result.status+
  ', mas ainda não há comprovante de entrega. Confira o chat antes de repetir.';
}
export function newVoiceDirectMessageFlow({send=realSend,deliveryLookup=lastVoiceDirectDelivery,lookupContact=findContactByName}={}){
 let pending=null;
 const expires=()=>pending&&Date.now()>pending.expires;
 const preview=()=>{
  if(!pending?.phone||!pending?.text)return null;
  pending.stage='confirm';
  pending.expires=Date.now()+3*60_000;
  return (pending.contactName?'Encontrei o contato '+pending.contactName+'. ':'')+
   'Confirma o telefone: '+readBackPhoneDigits(pending.phone)+'. A mensagem é: "'+
   pending.text+'". Está correto? Posso enviar?';
 };
 async function supplyPhone(text,actor,{nameHint=null}={}){
  const found=phoneCandidate(text);
  if(found?.invalid)return 'Ouvi '+found.digits.replace(/^55/,'')+'. Se for celular, parece faltar um dígito. Pode dizer novamente o DDD e cada dígito do número, sem pressa?';
  if(found?.number){
   pending.phone=found.number;pending.contactName=null;pending.choices=null;
   pending.stage=pending.text?'confirm':'text';pending.expires=Date.now()+3*60_000;
   return pending.text?preview():'Qual é a mensagem que você quer enviar?';
  }
  const name=nameHint||recipientNameInVoice(text,{standalone:true});
  if(!name)return 'Qual é o telefone completo com DDD ou o nome exato do contato salvo?';
  const lookup=await lookupContact(name,{sessionId:actor.sessionId});
  if(lookup.state==='MATCH'){
   pending.phone=lookup.number;pending.contactName=lookup.name;pending.choices=null;
   pending.stage=pending.text?'confirm':'text';pending.expires=Date.now()+3*60_000;
   return pending.text?preview():'Encontrei o contato '+lookup.name+
    ', com telefone de final '+lookup.number.slice(-4)+'. Qual mensagem quer enviar?';
  }
  pending.phone=null;pending.contactName=null;
  pending.expires=Date.now()+3*60_000;
  if(lookup.state==='AMBIGUOUS'){
   pending.choices=lookup.matches||[];
   pending.stage=pending.choices.length?'chooseContact':'phone';
   return pending.choices.length?'Encontrei mais de um contato com esse nome: '+
    pending.choices.map(x=>x.name+', final '+x.number.slice(-4)).join('; ')+
    '. Qual final você quer? Vou confirmar o telefone completo antes do envio.':
    'Há muitos contatos com esse nome. Diga o número completo com DDD, para evitar um destinatário errado.';
  }
  pending.choices=null;pending.stage='phone';
  return lookup.state==='UNAVAILABLE'?'Não consegui consultar os contatos do WhatsApp agora. Diga o número completo com DDD; não vou adivinhar.':
   'Não encontrei um contato sincronizado com esse nome exato. Pode repetir o nome salvo ou informar o telefone com DDD?';
 }
 async function approve(actor){
  if(!pending||pending.stage!=='confirm'||!pending.phone||!pending.text)
   return 'Ainda preciso conferir o destinatário e a mensagem antes de enviar.';
  const item=pending;
  pending=null; // Consume before any asynchronous work: no duplicate send on interruption.
  if(!verified(actor))return 'Não foi possível validar a autorização da ligação. Nenhuma mensagem foi enviada.';
  if(!/^55\d{10,11}$/.test(item.phone)||item.text.length>430||item.text.length<1)
   return 'O telefone ou a mensagem está inválido. Nenhum envio foi realizado.';
  if(one('SELECT 1 FROM suppressions WHERE phone=?',item.phone))
   return 'Esse número está bloqueado para mensagens. Não enviei.';
  const recent=Number(one('SELECT COUNT(*) n FROM francisca_voice_manual_sends WHERE created_at>?',new Date(Date.now()-86400000).toISOString())?.n)||0;
  if(recent>=8)return 'Limite de oito envios avulsos por dia atingido. Não enviei.';
  const record=randomUUID(),target=item.phone+'@s.whatsapp.net';
  run('INSERT INTO francisca_voice_manual_sends(id,jid,body,state,created_at,updated_at) VALUES(?,?,?,?,?,?)',
   record,target,item.text,'UNKNOWN',now(),now());
  audit('FRANCISCA_VOICE_DIRECT_ATTEMPT',null,{recipientSuffix:item.phone.slice(-4),source:'verified-owner-call'});
  try{
   const answer=await send({jid:target,sessionId:actor.sessionId,text:item.text});
   // A legacy test injected true/false; neither value proves delivery.
   const outcome=answer===true?{state:'ACCEPTED'}:answer===false?{state:'UNKNOWN'}:answer||{state:'UNKNOWN'};
   const status=String(outcome.state||'UNKNOWN').toUpperCase();
   const recognized=new Set(['BLOCKED','UNKNOWN','ACCEPTED','DELIVERED','READ']);
   const finalState=recognized.has(status)?status:'UNKNOWN';
   const pid=typeof outcome.providerId==='string'&&/^[-_A-Za-z0-9]{6,200}$/.test(outcome.providerId)?outcome.providerId:null;
   run('UPDATE francisca_voice_manual_sends SET state=?,provider_id=?,updated_at=? WHERE id=?',
    finalState,pid,now(),record);
   audit('FRANCISCA_VOICE_DIRECT_RESULT',null,{recipientSuffix:item.phone.slice(-4),
    state:finalState,hasProviderId:!!pid,source:'verified-owner-call'});
   if(finalState==='BLOCKED')return 'Não enviei. '+String(outcome.reason||'O destinatário não pôde ser validado.').slice(0,190);
   if(finalState==='DELIVERED'||finalState==='READ')
    return 'O WhatsApp confirmou '+(finalState==='READ'?'a leitura':'a entrega')+
     ' da mensagem no número terminado em '+item.phone.slice(-4)+'.';
   if(finalState==='ACCEPTED')
    return 'O WhatsApp aceitou a solicitação para o número terminado em '+
     item.phone.slice(-4)+', mas ainda NÃO confirmou a entrega da mensagem. Confira o chat antes de repetir.';
   return 'Não consegui confirmar se a mensagem chegou ao WhatsApp. Confira a conversa antes de qualquer nova tentativa; não vou repetir automaticamente.';
  }catch{
   return 'Não consegui confirmar o envio. Confira a conversa antes de pedir novamente; não vou repetir automaticamente.';
  }
 }
 return {
  async turn(heard,actor){
   const raw=String(heard||'').trim();
   if(!verified(actor)){pending=null;return null;}
   if(expires())pending=null;
   if(!pending&&askForDelivery(raw))return deliveryLookup(actor);
   if(pending){
    if(clear.test(simple(raw))){pending=null;return 'Certo, cancelei o envio. Nenhuma mensagem foi enviada.';}
    const fresh=interpretVoiceSend(raw);
    if(fresh){
     if(fresh.bulk)return 'Consigo enviar uma mensagem individual, não um disparo em massa.';
     pending={phone:fresh.phone,text:fresh.text,contactName:null,choices:null,stage:'',expires:Date.now()+3*60_000};
     if(fresh.invalidPhone||!fresh.phone)return supplyPhone(raw,actor,{nameHint:fresh.contactName});
     if(!fresh.text){pending.stage='text';return 'Qual é a mensagem que você quer enviar?';}
     return preview();
    }
    if(pending.stage==='confirm'){
     if(approval.test(simple(raw)))return approve(actor);
     if(/\b(?:numero|telefone|celular|ddd|contato|nome)\b/.test(simple(raw))){
      pending.stage='phone';pending.phone=null;pending.contactName=null;
      return supplyPhone(raw,actor);
     }
     if(/\b(?:nao|não|altera|alterar|corrig|troca|muda|modifica|outro texto|outra mensagem)\b/.test(simple(raw))){
      const change=raw.match(/(?:para|por|seria|é|eh|seguinte)\s*[:,-]?\s*(.+)$/i);
      if(change&&change[1].length>1){
       pending.text=stripBodyPrefix(change[1]).slice(0,430);
       return preview();
      }
      pending.stage='text';
      return 'Qual é o texto corrigido que você quer enviar?';
     }
     return 'Ainda não enviei. Quer autorizar exatamente essa mensagem? Diga "pode enviar" ou "cancela".';
    }
    if(pending.stage==='chooseContact'){
     const choice=contactChoiceFromSpeech(raw,pending.choices||[]);
     if(choice){
      pending.phone=choice.number;pending.contactName=choice.name;pending.choices=null;
      pending.stage=pending.text?'confirm':'text';
      return pending.text?preview():'Contato '+choice.name+', final '+choice.number.slice(-4)+'. Qual mensagem quer enviar?';
     }
     if(phoneCandidate(raw)?.number)return supplyPhone(raw,actor);
     return 'Diga o final de quatro dígitos de um dos contatos que encontrei, ou o número completo com DDD.';
    }
    if(pending.stage==='phone')return supplyPhone(raw,actor);
    if(pending.stage==='text'){
     if(/^(?:nao sei|não sei|depois|mais tarde|ainda nao|ainda não)$/i.test(simple(raw)))
      return 'Certo, podemos definir o texto depois.';
     const text=stripBodyPrefix(raw);
     if(text.length<2)return 'Qual é a mensagem completa que você quer enviar?';
     if(text.length>430)return 'A mensagem está longa demais para esse envio. Pode encurtar?';
     pending.text=text;
     return pending.phone?preview():supplyPhone(raw,actor);
    }
   }
   const instruction=interpretVoiceSend(raw);
   if(!instruction)return null;
   if(instruction.bulk)return 'Consigo enviar uma mensagem individual, não um disparo em massa.';
   pending={phone:instruction.phone,text:instruction.text,contactName:null,choices:null,stage:'',expires:Date.now()+3*60_000};
   if(instruction.invalidPhone||!instruction.phone){pending.stage='phone';return instruction.invalidPhone?'Esse número parece incompleto. Repita o DDD e os nove dígitos do celular, um de cada vez.':supplyPhone(raw,actor,{nameHint:instruction.contactName});}
   if(!instruction.text){pending.stage='text';return 'Perfeito. Qual é a mensagem que você quer enviar?';}
   if(instruction.text.length>430){pending.stage='text';return 'Pode informar um texto menor para essa mensagem?';}
   return preview();
  },
  end(){pending=null;},
  get state(){return pending?{stage:pending.stage,recipientSuffix:pending.phone?.slice(-4)||null}:null;}
 };
}

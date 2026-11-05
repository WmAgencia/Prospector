import crypto from 'node:crypto';
import {CREDIT_PACKAGES} from './credit-packages.mjs';

// Stripe Payment Links + webhook, without storing API keys or trusting a success URL.
// The payment link's client_reference_id contains only the random credit request UUID.
const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function paymentLinks(){
 try{
  const data=JSON.parse(process.env.STRIPE_PROSPECTOR_PAYMENT_LINKS||'{}');
  const out={};
  for(const pack of CREDIT_PACKAGES){
   const item=data[pack.id];
   if(typeof item?.url!=='string'||typeof item?.id!=='string'||!/^plink_[A-Za-z0-9]+$/.test(item.id))continue;
   let parsed;try{parsed=new URL(item.url);}catch{continue;}
   if(!['https://buy.stripe.com','https://checkout.stripe.com'].includes(parsed.origin))continue;
   out[pack.id]={id:item.id,url:parsed.toString()};
  }
  return out;
 }catch{return {};}
}
export const billingReady=()=>Boolean(process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET?.startsWith('whsec_')&&Object.keys(paymentLinks()).length===CREDIT_PACKAGES.length);
export function checkoutForRequest(request){
 if(!billingReady())return null;
 const link=paymentLinks()[request?.package_id];
 if(!link||!uuid.test(request?.id||''))return null;
 const url=new URL(link.url);
 url.searchParams.set('client_reference_id',request.id);
 return url.toString();
}
export function verifyStripeSignature(raw,header,secret,now=Date.now()){
 if(!Buffer.isBuffer(raw)||raw.length>256_000||typeof header!=='string'||!secret?.startsWith('whsec_'))return false;
 const entries=header.split(',').map(kv=>kv.trim().split('='));
 const timestamp=Number(entries.find(x=>x[0]==='t')?.[1]);
 if(!Number.isSafeInteger(timestamp)||Math.abs(now-timestamp*1000)>300_000)return false;
 const expected=crypto.createHmac('sha256',secret).update(String(timestamp)+'.').update(raw).digest();
 for(const value of entries.filter(x=>x[0]==='v1').map(x=>x[1])){
  if(!/^[a-f0-9]{64}$/i.test(value||''))continue;
  const got=Buffer.from(value,'hex');
  if(crypto.timingSafeEqual(expected,got))return true;
 }
 return false;
}
export async function handleStripeWebhook(req,res,{respond,ledger}){
 if(req.method!=='POST'){respond(res,405,{error:'Método não permitido'});return;}
 const secret=process.env.STRIPE_PROSPECTOR_WEBHOOK_SECRET;
 if(!billingReady()){respond(res,503,{error:'Faturamento automático ainda não está configurado'});return;}
 const chunks=[];let bytes=0;
 for await (const chunk of req){bytes+=chunk.length;if(bytes>256_000){respond(res,413,{error:'Evento grande demais'});return;}chunks.push(chunk);}
 const raw=Buffer.concat(chunks);
 if(!verifyStripeSignature(raw,req.headers['stripe-signature'],secret)){respond(res,400,{error:'Assinatura Stripe inválida'});return;}
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{respond(res,400,{error:'Evento inválido'});return;}
 if(!/^evt_[\w]+$/.test(String(event?.id||''))){respond(res,400,{error:'ID de evento inválido'});return;}
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)){
  respond(res,200,{received:true,ignored:true});return;
 }
 const session=event?.data?.object;
 if(session?.object!=='checkout.session'||session.livemode!==true||session.payment_status!=='paid'){
  respond(res,200,{received:true,ignored:true,reason:'not-paid'});return;
 }
 if(!/^cs_live_[\w]+$/.test(String(session?.id||''))||!uuid.test(String(session.client_reference_id||''))){
  respond(res,200,{received:true,ignored:true,reason:'not-prospector'});return;
 }
 const expectedLink=Object.entries(paymentLinks()).find(([,v])=>v.id===session.payment_link);
 if(!expectedLink){respond(res,200,{received:true,ignored:true,reason:'other-payment-link'});return;}
 if(session.currency!=='brl'||!Number.isSafeInteger(session.amount_total)||session.amount_total<100){
  respond(res,200,{received:true,ignored:true,reason:'invalid-amount'});return;
 }
 try{
  const result=ledger.confirmVerifiedPayment({
   requestId:session.client_reference_id,packageId:expectedLink[0],
   amountCents:session.amount_total,sessionId:session.id,eventId:event.id
  });
  respond(res,200,{received:true,confirmed:result.ok,duplicate:result.duplicate||false});
 }catch(error){
  // A retryable non-2xx response prevents the event from being acknowledged
  // when the database is locked or the recorded amount does not match.
  console.error('[prospector billing webhook]',String(error.message).slice(0,150));
  respond(res,503,{error:'Pagamento aguardando conciliação segura'});
 }
}

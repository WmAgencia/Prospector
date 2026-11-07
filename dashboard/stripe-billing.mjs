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

const EMBEDDED_PRICES={
 dia1:'price_1UZEp9Jj6d3ODR9EVnPSfkTW',
 dias3:'price_1UZEpPJj6d3ODR9E1cEI7aT8',
 dias7:'price_1UZEpUJj6d3ODR9EFVYlihpV',
 dias14:'price_1UZEpYJj6d3ODR9EbGOL7jem',
 dias30:'price_1UZEpeJj6d3ODR9EYHeH5XmY'
};
export function embeddedReady(){
 return billingReady()&&/^sk_live_/.test(process.env.STRIPE_SECRET_KEY||'')&&/^pk_live_/.test(process.env.STRIPE_PUBLISHABLE_KEY||'');
}
export async function embeddedCheckoutForRequest(request){
 if(!embeddedReady())return null;
 const pack=CREDIT_PACKAGES.find(p=>p.id===request?.package_id);
 const price=EMBEDDED_PRICES[pack?.id];
 if(!pack||!price||!uuid.test(request.id))throw Error('Pacote inválido');
 const base=(process.env.STRIPE_PROSPECTOR_RETURN_URL||'https://prospector.consecom.com.br').replace(/\/$/,'');
 if(!/^https:\/\//.test(base))throw Error('Domínio público inválido');
 const body=new URLSearchParams({
  mode:'payment',ui_mode:'embedded_page','line_items[0][price]':price,'line_items[0][quantity]':'1',
  'allowed_payment_method_types[0]':'card','allowed_payment_method_types[1]':'pix',
  locale:'pt-BR',
  'client_reference_id':request.id,'metadata[app]':'prospector','metadata[request_id]':request.id,'metadata[package_id]':pack.id,
  return_url:base+'/?pagamento=retorno&session_id={CHECKOUT_SESSION_ID}',
  'redirect_on_completion':'always'
 });
 const response=await fetch('https://api.stripe.com/v1/checkout/sessions',{
  method:'POST',headers:{Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':'prospector-embedded-'+request.id},
  body:body.toString(),signal:AbortSignal.timeout(12000)
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok||!/^cs_live_/.test(data.id||'')||!data.client_secret)throw Error('Não foi possível preparar o pagamento seguro.');
 return {clientSecret:data.client_secret,publishableKey:process.env.STRIPE_PUBLISHABLE_KEY};
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
 // The Consecom Stripe account also processes other businesses' checkouts.
 // Verify the signature, then ACK unrelated checkout events without retries.
 // Do not require every Prospector plan to be enabled merely to validate events.
 if(!secret?.startsWith('whsec_')){respond(res,503,{error:'Assinatura Stripe ainda não configurada'});return;}
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
 const embeddedPackage=(!session.payment_link&&session.metadata?.app==='prospector'&&session.metadata?.request_id===session.client_reference_id&&EMBEDDED_PRICES[session.metadata?.package_id])?session.metadata.package_id:null;
 const packageId=expectedLink?.[0]||embeddedPackage;
 if(!packageId){respond(res,200,{received:true,ignored:true,reason:'other-checkout'});return;}
 if(session.currency!=='brl'||!Number.isSafeInteger(session.amount_total)||session.amount_total<100){
  respond(res,200,{received:true,ignored:true,reason:'invalid-amount'});return;
 }
 try{
  const result=ledger.confirmVerifiedPayment({
   requestId:session.client_reference_id,packageId,
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

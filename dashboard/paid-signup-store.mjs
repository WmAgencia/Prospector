import crypto from 'node:crypto';
import {CREDIT_PACKAGES} from './credit-packages.mjs';

// No client record or trial is created when a paid checkout starts.
// Signed webhook confirmation authorizes an activation; activation issues credits atomically.
export function createPaidSignupStore({db,loginPhone}){
 db.exec(`CREATE TABLE IF NOT EXISTS paid_signup_orders(
  id TEXT PRIMARY KEY,package_id TEXT NOT NULL,credits INTEGER NOT NULL,price_cents INTEGER NOT NULL,
  stripe_session_id TEXT UNIQUE,stripe_event_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('PENDING','PAID','CLAIMED')),
  customer_email TEXT,created_at TEXT NOT NULL,paid_at TEXT,claimed_at TEXT,
  client_id TEXT REFERENCES clients(id)
 );
 CREATE INDEX IF NOT EXISTS idx_paid_signup_status ON paid_signup_orders(status,created_at);`);
 const uuid=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
 const session=/^cs_live_[\w]+$/;
 const getBySession=db.prepare('SELECT * FROM paid_signup_orders WHERE stripe_session_id=?');
 const getById=db.prepare('SELECT * FROM paid_signup_orders WHERE id=?');
 return {
  createPaidSignupOrder(packageId){
   const pack=CREDIT_PACKAGES.find(x=>x.id===String(packageId||''));
   if(!pack)throw Error('Selecione um plano pago válido');
   const id=crypto.randomUUID(),at=new Date().toISOString();
   db.prepare("INSERT INTO paid_signup_orders(id,package_id,credits,price_cents,status,created_at) VALUES(?,?,?,?,'PENDING',?)")
    .run(id,pack.id,pack.credits,pack.priceCents,at);
   return {id,package_id:pack.id,credits:pack.credits,price_cents:pack.priceCents};
  },
  attachPaidSignupSession(orderId,sessionId){
   if(!uuid.test(orderId||'')||!session.test(sessionId||''))throw Error('Sessão Stripe inválida');
   db.exec('BEGIN IMMEDIATE');
   try{
    const row=getById.get(orderId);
    if(!row||row.stripe_session_id&&row.stripe_session_id!==sessionId)throw Error('Pedido de contratação inválido');
    db.prepare('UPDATE paid_signup_orders SET stripe_session_id=? WHERE id=?').run(sessionId,orderId);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  paidSignupStatus(sessionId){
   if(!session.test(sessionId||''))return null;
   const row=getBySession.get(sessionId);
   if(!row)return null;
   return {status:row.status,packageId:row.package_id,credits:row.credits,priceCents:row.price_cents,
    email:row.status==='PENDING'?null:row.customer_email,alreadyActivated:row.status==='CLAIMED'};
  },
  confirmPaidSignupPayment({requestId,packageId,amountCents,sessionId,eventId,customerEmail}={}){
   const email=String(customerEmail||'').trim().toLowerCase();
   if(!uuid.test(requestId||'')||!session.test(sessionId||'')||!/^evt_[\w]+$/.test(eventId||'')
    ||!Number.isSafeInteger(amountCents)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200)
    throw Error('Compra ou e-mail do pagador inválido');
   db.exec('BEGIN IMMEDIATE');
   try{
    const row=getById.get(requestId);
    if(!row||row.package_id!==packageId||row.price_cents!==amountCents||
      row.stripe_session_id&&row.stripe_session_id!==sessionId)throw Error('Compra não corresponde ao pedido registrado');
    if(row.status==='PAID'||row.status==='CLAIMED'){
     db.exec('COMMIT');return {ok:true,duplicate:true,requestId};
    }
    if(row.status!=='PENDING')throw Error('Pedido inválido');
    const at=new Date().toISOString();
    const existing=db.prepare('SELECT * FROM clients WHERE lower(email)=?').get(email);
    if(existing&&existing.status==='active'&&existing.is_internal!==1&&existing.is_demo!==1&&existing.plan_id!=='unlimited'){
     // Existing paid/trial client: safely credit the existing account, never reset credentials.
     db.prepare("INSERT INTO credit_requests(id,client_id,package_id,credits,price_cents,status,request_key,created_at,updated_at) VALUES(?,?,?,?,?,'APPROVED',?,?,?)")
      .run(row.id,existing.id,row.package_id,row.credits,row.price_cents,row.id,row.created_at,at);
     db.prepare('INSERT INTO verified_payments VALUES(?,?,?,?,?,?,?)')
      .run(sessionId,row.id,existing.id,eventId,row.price_cents,row.credits,at);
     db.prepare('INSERT INTO credit_events VALUES(?,?,?,?,?,?)')
      .run(crypto.randomUUID(),existing.id,row.credits,'Plano pago Stripe confirmado','stripe-payment:'+row.id,at);
     db.prepare("UPDATE paid_signup_orders SET status='CLAIMED',stripe_session_id=?,stripe_event_id=?,customer_email=?,paid_at=?,claimed_at=?,client_id=? WHERE id=?")
      .run(sessionId,eventId,email,at,at,existing.id,row.id);
    }else{
     db.prepare("UPDATE paid_signup_orders SET status='PAID',stripe_session_id=?,stripe_event_id=?,customer_email=?,paid_at=? WHERE id=?")
      .run(sessionId,eventId,email,at,requestId);
    }
    db.exec('COMMIT');return {ok:true,duplicate:false,requestId};
   }catch(error){db.exec('ROLLBACK');throw error;}
  },
  activatePaidSignup({sessionId,name,password,phone='',privacyAcknowledged}={}){
   if(!session.test(sessionId||''))throw Error('Pagamento não identificado');
   name=String(name||'').normalize('NFC').trim().replace(/\s+/g,' ');
   password=String(password||'');
   if(privacyAcknowledged!==true||name.length<3||name.length>100||password.length<10||password.length>128)
    throw Error('Informe seu nome ou empresa, uma senha de 10 a 128 caracteres e aceite a política de privacidade');
   const normalizedPhone=phone?loginPhone(phone):null;
   if(phone&&!normalizedPhone)throw Error('Informe um celular válido com DDD');
   const salt=crypto.randomBytes(24).toString('hex'),passwordHash=crypto.scryptSync(password,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');
   try{
    const order=getBySession.get(sessionId);
    if(!order||order.status!=='PAID'||!order.customer_email)throw Error('Pagamento ainda não confirmado ou contratação já ativada');
    let client=db.prepare('SELECT * FROM clients WHERE lower(email)=?').get(order.customer_email);
    const existing=!!client;
    if(client&&client.status!=='active')throw Error('Existe uma conta suspensa com este e-mail. Contate o suporte');
    if(client&&(client.is_internal===1||client.is_demo===1||client.plan_id==='unlimited'))throw Error('Esta conta não aceita contratação de créditos');
    if(!client){
     const result=this.create({name,email:order.customer_email,phone:normalizedPhone,planId:'credits'});
     client=this.get(result.client.id);
     db.prepare('INSERT INTO client_passwords(client_id,email,salt,password_hash,privacy_version,created_at,phone) VALUES(?,?,?,?,?,?,?)')
      .run(client.id,client.email,salt,passwordHash,'paid-activation-v1',new Date().toISOString(),normalizedPhone);
    }
    const at=new Date().toISOString();
    db.prepare("INSERT INTO credit_requests(id,client_id,package_id,credits,price_cents,status,request_key,created_at,updated_at) VALUES(?,?,?,?,?,'APPROVED',?,?,?)")
     .run(order.id,client.id,order.package_id,order.credits,order.price_cents,order.id,order.created_at,at);
    db.prepare('INSERT INTO verified_payments VALUES(?,?,?,?,?,?,?)')
     .run(sessionId,order.id,client.id,order.stripe_event_id,order.price_cents,order.credits,at);
    db.prepare('INSERT INTO credit_events VALUES(?,?,?,?,?,?)')
     .run(crypto.randomUUID(),client.id,order.credits,'Plano pago Stripe confirmado','stripe-payment:'+order.id,at);
    db.prepare("UPDATE paid_signup_orders SET status='CLAIMED',client_id=?,claimed_at=? WHERE id=? AND status='PAID'")
     .run(client.id,at,order.id);
    db.exec('COMMIT');
    return {client:this.get(client.id),existing,credits:order.credits};
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
 };
}

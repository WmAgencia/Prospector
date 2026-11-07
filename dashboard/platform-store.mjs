import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {getCreditPackage,CREDIT_PACKAGES} from './credit-packages.mjs';
import {normalizeCpf,validCpf,legalName,trialCpfDigest,sealTrialCpf,unsealTrialCpf,TRIAL_FREE_CREDITS} from './trial-identity.mjs';
export function openPlatformStore(root){
 fs.mkdirSync(root,{recursive:true});
 const db=new DatabaseSync(path.join(root,'platform.sqlite'));
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',token_hash TEXT NOT NULL,secret TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS credit_events(id TEXT PRIMARY KEY,client_id TEXT NOT NULL REFERENCES clients(id),amount INTEGER NOT NULL,reason TEXT NOT NULL,reference TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(client_id,reference));
 CREATE TABLE IF NOT EXISTS credit_reservations(client_id TEXT NOT NULL,reference TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(client_id,reference));`);
 db.exec(`CREATE TABLE IF NOT EXISTS client_passwords(client_id TEXT PRIMARY KEY REFERENCES clients(id),email TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL,privacy_version TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const clientCols=db.prepare('PRAGMA table_info(clients)').all().map(x=>x.name);
 if(!clientCols.includes('is_internal'))db.exec('ALTER TABLE clients ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0');
 for(const [column,definition] of [['plan_id',"TEXT NOT NULL DEFAULT 'credits'"],['custom_credits','INTEGER'],['custom_price_cents','INTEGER'],['contact_phone','TEXT'],['cpf_last4','TEXT'],['cpf_digest','TEXT']])
  if(!clientCols.includes(column))db.exec('ALTER TABLE clients ADD COLUMN '+column+' '+definition);
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS only_one_internal_client ON clients(is_internal) WHERE is_internal=1');
 if(!db.prepare('PRAGMA table_info(client_passwords)').all().some(x=>x.name==='phone'))db.exec('ALTER TABLE client_passwords ADD COLUMN phone TEXT');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS unique_login_phone ON client_passwords(phone) WHERE phone IS NOT NULL');
 // Purchase requests never grant credit until the Master verifies payment.
 db.exec(`CREATE TABLE IF NOT EXISTS credit_requests(
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  package_id TEXT NOT NULL, credits INTEGER NOT NULL, price_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','DECLINED')),
  request_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(client_id,request_key)
 );
 CREATE INDEX IF NOT EXISTS idx_credit_requests_status ON credit_requests(status,created_at);
 CREATE TABLE IF NOT EXISTS verified_payments(
  stripe_session_id TEXT PRIMARY KEY,request_id TEXT NOT NULL UNIQUE REFERENCES credit_requests(id),
  client_id TEXT NOT NULL REFERENCES clients(id),stripe_event_id TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL,credits INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_verified_payments_date ON verified_payments(created_at);`);
 // Permanent, privacy-minimized anti-abuse ledger. A suspended/closed account
 // must never recover a free trial by signing up with new credentials.
 db.exec(`CREATE TABLE IF NOT EXISTS free_trial_claims(
  client_id TEXT PRIMARY KEY REFERENCES clients(id),
  cpf_digest TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  evidence_reference TEXT,
  verification_method TEXT,
  cpf_ciphertext TEXT
 );`);
 if(!db.prepare('PRAGMA table_info(free_trial_claims)').all().some(x=>x.name==='cpf_ciphertext'))db.exec('ALTER TABLE free_trial_claims ADD COLUMN cpf_ciphertext TEXT');
 const loginPhone=value=>{let x=String(value||'').replace(/\D/g,'');if(x.length===11)x='55'+x;return /^55\d{11}$/.test(x)?x:null;};
 const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
 const balance=id=>Number(db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM credit_events WHERE client_id=?').get(id).n);
 const pending=id=>Number(db.prepare("SELECT COUNT(*) AS n FROM credit_reservations WHERE client_id=? AND state='RESERVED'").get(id).n);
 const unlimited=r=>r&&(r.is_internal===1||r.plan_id==='unlimited');
 const trial=id=>db.prepare('SELECT status,created_at,reviewed_at FROM free_trial_claims WHERE client_id=?').get(id)||null;
 const publicClient=r=>r?{id:r.id,name:r.name,email:r.email,status:r.status,createdAt:r.created_at,unlimited:unlimited(r),internal:r.is_internal===1,
  trial:trial(r.id)?{status:trial(r.id).status,credits:TRIAL_FREE_CREDITS,verified:trial(r.id).status==='APPROVED',requestedAt:trial(r.id).created_at}:null,
  planId:r.is_internal===1?'unlimited':r.plan_id||'credits',customCredits:r.custom_credits||null,customPriceCents:r.custom_price_cents||null,
  phone:r.contact_phone||null,cpfMasked:r.cpf_last4?'***.***.*'+r.cpf_last4.slice(0,2)+'-'+r.cpf_last4.slice(2):null,
  balance:balance(r.id),reserved:unlimited(r)?0:pending(r.id),available:unlimited(r)?null:balance(r.id)-pending(r.id)}:null;
 const get=id=>db.prepare('SELECT * FROM clients WHERE id=?').get(id);
 function adjust(id,amount,reason,reference=crypto.randomUUID()){
  if(unlimited(get(id)))throw Error('Esta conta tem plano ilimitado e não precisa de recarga');
  if(!get(id)||!Number.isSafeInteger(amount)||!amount||Math.abs(amount)>10000000)throw Error('Ajuste de créditos inválido');
  db.exec('BEGIN IMMEDIATE');
  try{
   if(db.prepare('SELECT 1 FROM credit_events WHERE client_id=? AND reference=?').get(id,reference)){db.exec('COMMIT');return balance(id);}
   if(balance(id)+amount<pending(id))throw Error('Saldo insuficiente ou reservado em envios');
   db.prepare('INSERT INTO credit_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),id,amount,String(reason).slice(0,200),reference,new Date().toISOString());
   db.exec('COMMIT');return balance(id);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const selectRequest=db.prepare("SELECT r.id,r.client_id,r.package_id,r.credits,r.price_cents,r.status,r.created_at,r.updated_at,c.name AS client_name,c.email AS client_email FROM credit_requests r JOIN clients c ON c.id=r.client_id WHERE r.id=?");
 return {db,get,balance,adjust,publicClient,pending,
  primaryAccount(){const account=db.prepare('SELECT * FROM clients WHERE is_internal=1').get();return account?.status==='active'?account:null;},
  listCreditRequests(clientId=null){
   return clientId
    ?db.prepare("SELECT r.id,r.client_id,r.package_id,r.credits,r.price_cents,r.status,r.created_at,r.updated_at FROM credit_requests r WHERE r.client_id=? ORDER BY r.created_at DESC LIMIT 100").all(clientId)
    :db.prepare("SELECT r.id,r.client_id,r.package_id,r.credits,r.price_cents,r.status,r.created_at,r.updated_at,c.name AS client_name,c.email AS client_email FROM credit_requests r JOIN clients c ON c.id=r.client_id ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 250").all();
  },
  requestCredits(clientId,packageId,requestKey){
   const client=get(clientId),pack=getCreditPackage(packageId);
   if(!client||client.status!=='active'||unlimited(client))throw Error('Conta indisponível para recarga');
   if(!pack)throw Error('Pacote inválido');
   if(!/^[a-f0-9-]{36}$/i.test(String(requestKey||'')))throw Error('Identificador da solicitação inválido');
   db.exec('BEGIN IMMEDIATE');try{
    const existing=db.prepare('SELECT id FROM credit_requests WHERE client_id=? AND request_key=?').get(clientId,requestKey);
    if(existing){db.exec('COMMIT');return selectRequest.get(existing.id);}
    const pendingCount=db.prepare("SELECT COUNT(*) n FROM credit_requests WHERE client_id=? AND status='PENDING'").get(clientId).n;
    if(pendingCount>=3)throw Error('Você já possui três pedidos aguardando confirmação. Acompanhe-os no seu painel.');
    const id=crypto.randomUUID(),at=new Date().toISOString();
    db.prepare('INSERT INTO credit_requests(id,client_id,package_id,credits,price_cents,status,request_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,clientId,pack.id,pack.credits,pack.priceCents,'PENDING',requestKey,at,at);
    db.exec('COMMIT');return selectRequest.get(id);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  settleCreditRequest(requestId,{approved,confirmedPayment}={}){
   db.exec('BEGIN IMMEDIATE');try{
    const item=selectRequest.get(requestId);
    if(!item)throw Error('Pedido não encontrado');
    if(item.status!=='PENDING'){db.exec('COMMIT');return item;}
    if(approved===true){
     if(confirmedPayment!==true)throw Error('Confirme o pagamento antes de liberar créditos');
     if(get(item.client_id)?.status!=='active')throw Error('Cliente suspenso: reative antes de aprovar');
     db.prepare('INSERT OR IGNORE INTO credit_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),item.client_id,item.credits,
      'Recarga '+item.credits+' créditos · pagamento confirmado','credit-request:'+item.id,new Date().toISOString());
    }
    const status=approved===true?'APPROVED':'DECLINED';
    db.prepare('UPDATE credit_requests SET status=?,updated_at=? WHERE id=?').run(status,new Date().toISOString(),item.id);
    db.exec('COMMIT');return selectRequest.get(item.id);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  hasPassword(clientId){
   return !!db.prepare('SELECT 1 FROM client_passwords WHERE client_id=?').get(clientId);
  },
  setupPassword(clientId,password){
   const client=get(clientId),input=String(password||'');
   if(!client||client.status!=='active'||this.hasPassword(clientId))throw Error('Este convite já foi utilizado');
   if(input.length<10||input.length>128)throw Error('A senha deve ter de 10 a 128 caracteres');
   const salt=crypto.randomBytes(24).toString('hex'),hash=crypto.scryptSync(input,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');try{
    db.prepare('INSERT INTO client_passwords(client_id,email,salt,password_hash,privacy_version,created_at,phone) VALUES(?,?,?,?,?,?,?)')
     .run(clientId,client.email,salt,hash,'invite-activation',new Date().toISOString(),client.contact_phone||null);
    // Rotate the initial invite token so it cannot be reused.
    db.prepare('UPDATE clients SET token_hash=? WHERE id=?').run(crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),clientId);
    db.exec('COMMIT');return get(clientId);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  changeCredentials(clientId,{currentPassword,newEmail,newPassword}={}){
   const client=get(clientId);
   const row=db.prepare('SELECT * FROM client_passwords WHERE client_id=?').get(clientId);
   if(!client||!row||client.status!=='active')throw Error('Alteração indisponível para esta conta');
   const old=String(currentPassword||'');
   if(!old||old.length>128)throw Error('Confirme sua senha atual');
   const hash=crypto.scryptSync(old,row.salt,64);
   if(!crypto.timingSafeEqual(hash,Buffer.from(row.password_hash,'hex')))throw Error('Senha atual incorreta');
   const email=String(newEmail||row.email).trim().toLowerCase();
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200)throw Error('E-mail inválido');
   const next=String(newPassword||'');
   if(next&&(next.length<10||next.length>128))throw Error('A nova senha deve ter entre 10 e 128 caracteres');
   if(email===row.email&&!next)throw Error('Informe um novo e-mail ou nova senha');
   const salt=next?crypto.randomBytes(24).toString('hex'):row.salt;
   const digest=next?crypto.scryptSync(next,salt,64).toString('hex'):row.password_hash;
   db.exec('BEGIN IMMEDIATE');try{
    if(email!==row.email){
     if(db.prepare('SELECT 1 FROM clients WHERE lower(email)=? AND id<>?').get(email,clientId))throw Error('E-mail já cadastrado');
     db.prepare('UPDATE clients SET email=? WHERE id=?').run(email,clientId);
    }
    db.prepare('UPDATE client_passwords SET email=?,salt=?,password_hash=? WHERE client_id=?').run(email,salt,digest,clientId);
    // Logout every old password-session after changing credentials;
    // worker secret and WhatsApp webhook credentials remain unchanged.
    db.prepare('UPDATE clients SET token_hash=? WHERE id=?').run(crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),clientId);
    db.exec('COMMIT');return get(clientId);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  signup({name,email,password,phone,cpf,privacyAcknowledged}){
   name=legalName(name);
   if(!validCpf(cpf))throw Error('Informe um CPF válido para solicitar o teste gratuito');
   const secret=process.env.PROSPECTOR_CPF_HMAC_SECRET||process.env.ADMIN_SESSION_SECRET||'';
   const identityHash=trialCpfDigest(cpf,secret);
   const legacyHash=crypto.createHmac('sha256',secret).update(normalizeCpf(cpf)).digest('hex');
   email=String(email||'').trim().toLowerCase();password=String(password||'');
   if(privacyAcknowledged!==true||password.length<10||password.length>128)throw Error('Use uma senha de 10 a 128 caracteres e confirme a leitura sobre seus dados');
   const normalizedPhone=loginPhone(phone);if(!normalizedPhone)throw Error('Informe seu celular com DDD');
   const salt=crypto.randomBytes(24).toString('hex'),passwordHash=crypto.scryptSync(password,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');try{
    if(db.prepare('SELECT 1 FROM clients WHERE lower(email)=?').get(email)||
       db.prepare('SELECT 1 FROM client_passwords WHERE phone=?').get(normalizedPhone)||
       db.prepare('SELECT 1 FROM clients WHERE contact_phone=? OR cpf_digest=?').get(normalizedPhone,legacyHash)||
       db.prepare('SELECT 1 FROM free_trial_claims WHERE cpf_digest=? OR phone=? OR email=?').get(identityHash,normalizedPhone,email))
      throw Error('Não foi possível liberar outro teste para estes dados. Se já possui cadastro, entre ou fale com a Consecom.');
    const result=this.create({name,email,phone:normalizedPhone,cpf});
    const at=new Date().toISOString();
    db.prepare('INSERT INTO client_passwords(client_id,email,salt,password_hash,privacy_version,created_at,phone) VALUES(?,?,?,?,?,?,?)').run(result.client.id,email,salt,passwordHash,'2026-11-07-free-trial-pending',at,normalizedPhone);
    // Register the one-time claim atomically with signup. No money is charged and
    // NO credits are issued before a qualified name/CPF verification.
    db.prepare("INSERT INTO free_trial_claims(client_id,cpf_digest,phone,email,status,created_at,cpf_ciphertext) VALUES(?,?,?,?,'PENDING',?,?)")
     .run(result.client.id,identityHash,normalizedPhone,email,at,sealTrialCpf(cpf,secret));
    db.exec('COMMIT');return get(result.client.id);
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  pendingTrialIdentity(clientId){
   const item=db.prepare("SELECT status,cpf_ciphertext FROM free_trial_claims WHERE client_id=?").get(clientId);
   const client=get(clientId);
   if(!client||!item||item.status!=='PENDING'||!item.cpf_ciphertext)throw Error('Solicitação de verificação indisponível');
   const secret=process.env.PROSPECTOR_CPF_HMAC_SECRET||process.env.ADMIN_SESSION_SECRET||'';
   return {clientId,name:client.name,cpf:unsealTrialCpf(item.cpf_ciphertext,secret),phone:client.contact_phone,email:client.email,status:'PENDING'};
  },
  reviewFreeTrial(clientId,{approved=false,verifiedNameAndCpf=false,evidenceReference='',verificationMethod=''}={}){
   const ref=String(evidenceReference||'').trim(),method=String(verificationMethod||'').trim().toUpperCase();
   if(!ref||ref.length<12||ref.length>240)throw Error('Informe uma referência de conferência de identidade, sem armazenar o CPF completo');
   if(!['OFFICIAL_REGISTRY_MANUAL','TRUSTED_IDENTITY_PROVIDER'].includes(method))throw Error('Informe uma fonte verificável de comparação do nome com o CPF');
   if(approved&&verifiedNameAndCpf!==true)throw Error('Confirme a comparação efetiva do nome com o CPF em uma fonte confiável');
   db.exec('BEGIN IMMEDIATE');try{
    const row=db.prepare('SELECT * FROM free_trial_claims WHERE client_id=?').get(clientId);
    if(!row)throw Error('Este cliente não possui solicitação de teste gratuito');
    if(row.status!=='PENDING'){db.exec('COMMIT');return {status:row.status,credits:row.status==='APPROVED'?TRIAL_FREE_CREDITS:0,alreadyReviewed:true};}
    const current=get(clientId);
    if(!current||current.is_internal===1||current.status!=='active')throw Error('Conta indisponível');
    const status=approved?'APPROVED':'REJECTED',at=new Date().toISOString();
    db.prepare('UPDATE free_trial_claims SET status=?,reviewed_at=?,evidence_reference=?,verification_method=?,cpf_ciphertext=NULL WHERE client_id=? AND status=?')
     .run(status,at,ref,method,clientId,'PENDING');
    if(approved)db.prepare('INSERT OR IGNORE INTO credit_events(id,client_id,amount,reason,reference,created_at) VALUES(?,?,?,?,?,?)')
     .run(crypto.randomUUID(),clientId,TRIAL_FREE_CREDITS,'Teste grátis verificado: '+TRIAL_FREE_CREDITS+' abordagens','free-trial:'+clientId,at);
    db.exec('COMMIT');return {status,credits:approved?TRIAL_FREE_CREDITS:0,alreadyReviewed:false};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  signin({email,identifier,password}){
   email=String(identifier||email||'').trim().toLowerCase();password=String(password||'');if(password.length>128)return null;
   const row=db.prepare('SELECT * FROM client_passwords WHERE email=? OR phone=?').get(email,loginPhone(email));
   const candidate=crypto.scryptSync(password,row?.salt||'dummy-salt-for-unknown-account',64);
   if(!row||!crypto.timingSafeEqual(candidate,Buffer.from(row.password_hash,'hex')))return null;
   const client=get(row.client_id);return client?.status==='active'?client:null;
  },
  configurePrimary({name,email,phone,password}){
   email=String(email||'').trim().toLowerCase();const normalizedPhone=loginPhone(phone);
   if(!normalizedPhone||String(password||'').length<10||String(password).length>128)throw Error('Telefone ou senha inválidos');
   const salt=crypto.randomBytes(24).toString('hex'),passwordHash=crypto.scryptSync(password,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');try{
    let client=db.prepare('SELECT * FROM clients WHERE is_internal=1').get();
    if(client&&client.email!==email)throw Error('Já existe uma conta interna ilimitada');
    if(!client){const created=this.create({name,email});db.prepare('UPDATE clients SET is_internal=1 WHERE id=?').run(created.client.id);client=get(created.client.id);}
    db.prepare('INSERT INTO client_passwords(client_id,email,salt,password_hash,privacy_version,created_at,phone) VALUES(?,?,?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET email=excluded.email,salt=excluded.salt,password_hash=excluded.password_hash,phone=excluded.phone').run(client.id,email,salt,passwordHash,'owner-configured',new Date().toISOString(),normalizedPhone);
    db.exec('COMMIT');return publicClient(get(client.id));
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  recoverPrimaryCredentials({email,password}={}){
   // Only invoked through the separately authenticated legacy-administrator API.
   // Never creates/promotes a client or accepts a different owner email.
   const expected=String(email||'').trim().toLowerCase(),newPassword=String(password||'');
   if(!expected||newPassword.length<12||newPassword.length>128)throw Error('Informe o e-mail atual do Master e uma nova senha de pelo menos 12 caracteres');
   db.exec('BEGIN IMMEDIATE');try{
    const owner=db.prepare('SELECT id,email,status FROM clients WHERE is_internal=1').get();
    if(!owner||owner.status!=='active'||owner.email.trim().toLowerCase()!==expected)
     throw Error('Não foi possível verificar esta conta Master');
    const existing=db.prepare('SELECT 1 FROM client_passwords WHERE client_id=?').get(owner.id);
    if(!existing)throw Error('A conta Master não possui credenciais recuperáveis');
    const salt=crypto.randomBytes(24).toString('hex');
    const digest=crypto.scryptSync(newPassword,salt,64).toString('hex');
    db.prepare("UPDATE client_passwords SET salt=?,password_hash=?,privacy_version='owner-recovered' WHERE client_id=?").run(salt,digest,owner.id);
    // End all existing primary sessions. Legacy owner-auth remains independent.
    db.prepare('UPDATE clients SET token_hash=? WHERE id=?').run(crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),owner.id);
    db.exec('COMMIT');
    return {ok:true,updated:true};
   }catch(err){db.exec('ROLLBACK');throw err;}
  },
  releaseUncertain(id){
   if(get(id)?.status!=='suspended')throw Error('Suspenda a conta e confira as entregas antes de liberar reservas');
   return Number(db.prepare("UPDATE credit_reservations SET state='RELEASED' WHERE client_id=? AND state='RESERVED'").run(id).changes);
  },
  reserve(id,reference){
   db.exec('BEGIN IMMEDIATE');try{
    if(get(id)?.status!=='active')throw Error('Conta indisponível');
    if(unlimited(get(id))){db.exec('COMMIT');return true;}
    const existing=db.prepare('SELECT state FROM credit_reservations WHERE client_id=? AND reference=?').get(id,reference);
    if(existing&&existing.state!=='RELEASED'){db.exec('COMMIT');return false;}
    if(balance(id)-pending(id)<1){db.exec('COMMIT');return false;}
    db.prepare("INSERT INTO credit_reservations VALUES(?,?,?,?) ON CONFLICT(client_id,reference) DO UPDATE SET state='RESERVED'").run(id,reference,'RESERVED',new Date().toISOString());db.exec('COMMIT');return true;
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  settle(id,reference,accepted){
   if(unlimited(get(id)))return;
   db.exec('BEGIN IMMEDIATE');try{
    const r=db.prepare('SELECT state FROM credit_reservations WHERE client_id=? AND reference=?').get(id,reference);
    if(r?.state==='RESERVED'){
     if(accepted)db.prepare('INSERT OR IGNORE INTO credit_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),id,-1,'Abordagem aceita pelo canal',reference,new Date().toISOString());
     db.prepare('UPDATE credit_reservations SET state=? WHERE client_id=? AND reference=?').run(accepted?'CONSUMED':'RELEASED',id,reference);
    }db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  confirmVerifiedPayment({requestId,packageId,amountCents,sessionId,eventId}={}){
   if(!/^[a-f\d-]{36}$/i.test(requestId||'')||!/^cs_live_[\w]+$/.test(sessionId||'')||!/^evt_[\w]+$/.test(eventId||''))throw Error('Identificadores de pagamento inválidos');
   db.exec('BEGIN IMMEDIATE');
   try{
    const duplicate=db.prepare('SELECT * FROM verified_payments WHERE stripe_session_id=? OR request_id=? OR stripe_event_id=?').get(sessionId,requestId,eventId);
    if(duplicate){db.exec('COMMIT');return {ok:true,duplicate:true,requestId};}
    const item=selectRequest.get(requestId);
    if(!item||item.status!=='PENDING'||item.package_id!==packageId||item.price_cents!==amountCents||!get(item.client_id))throw Error('Valor ou pedido não confere');
    const at=new Date().toISOString();
    db.prepare('INSERT INTO verified_payments VALUES(?,?,?,?,?,?,?)').run(sessionId,item.id,item.client_id,eventId,amountCents,item.credits,at);
    db.prepare('INSERT OR IGNORE INTO credit_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),item.client_id,item.credits,'Créditos de pagamento Stripe confirmado','stripe-payment:'+item.id,at);
    db.prepare("UPDATE credit_requests SET status='APPROVED',updated_at=? WHERE id=?").run(at,item.id);
    db.exec('COMMIT');return {ok:true,duplicate:false,requestId:item.id};
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  list:()=>db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all().map(publicClient),
  create({name,email,phone='',cpf='',planId='credits',customCredits,customPriceCents}={}){
   name=String(name||'').trim();email=String(email||'').trim().toLowerCase();
   if(!name||name.length>100||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200)throw Error('Informe nome e e-mail válidos');
   if(db.prepare('SELECT 1 FROM clients WHERE lower(email)=?').get(email))throw Error('E-mail já cadastrado');
   if(!new Set(['credits','unlimited','custom',...CREDIT_PACKAGES.map(p=>p.id)]).has(planId))throw Error('Plano inválido');
   const digits=String(cpf||'').replace(/\D/g,'');
   if(digits){
    if(digits.length!==11||/^(\d)\1{10}$/.test(digits))throw Error('CPF inválido');
    for(const n of [9,10]){
     let sum=0;for(let i=0;i<n;i++)sum+=Number(digits[i])*(n+1-i);
     if(Number(digits[n])!==((sum*10)%11)%10)throw Error('CPF inválido');
    }
   }
   const normalizedPhone=phone?loginPhone(phone):null;
   if(phone&&!normalizedPhone)throw Error('Telefone inválido');
   const credits=planId==='custom'?Number(customCredits):null;
   const price=planId==='custom'?Number(customPriceCents):null;
   if(planId==='custom'&&(!Number.isSafeInteger(credits)||credits<1||credits>1000000||!Number.isSafeInteger(price)||price<0||price>100000000))throw Error('Informe créditos e preço válidos para o plano personalizado');
   const id=crypto.randomUUID(),token=crypto.randomBytes(36).toString('base64url');
   const key=process.env.PROSPECTOR_CPF_HMAC_SECRET||process.env.ADMIN_SESSION_SECRET||'';
   if(digits&&!key)throw Error('Configure uma chave privada antes de armazenar documentos');
   // Only a keyed digest and masked suffix are retained, never the full CPF.
   const cpfDigest=digits?crypto.createHmac('sha256',key).update(digits).digest('hex'):null;
   db.prepare('INSERT INTO clients(id,name,email,status,token_hash,secret,created_at,plan_id,custom_credits,custom_price_cents,contact_phone,cpf_last4,cpf_digest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,name,email,'active',hash(token),crypto.randomBytes(48).toString('base64url'),new Date().toISOString(),planId,credits,price,normalizedPhone,digits?digits.slice(-4):null,cpfDigest);
   return {client:publicClient(get(id)),token};
  },
  authenticate:token=>db.prepare("SELECT * FROM clients WHERE token_hash=? AND status='active'").get(hash(token)),
  status(id,status){if(!get(id)||!['active','suspended'].includes(status))throw Error('Cliente ou status inválido');if(get(id).is_internal===1&&status==='suspended')throw Error('Pause a operação pelo painel do cliente interno');db.prepare('UPDATE clients SET status=? WHERE id=?').run(status,id);return publicClient(get(id));},
  rotate(id){if(!get(id))throw Error('Cliente inválido');const token=crypto.randomBytes(36).toString('base64url');db.prepare('UPDATE clients SET token_hash=? WHERE id=?').run(hash(token),id);return token;},
  events:id=>db.prepare('SELECT id,amount,reason,created_at FROM credit_events WHERE client_id=? ORDER BY rowid DESC LIMIT 100').all(id)
 };
}

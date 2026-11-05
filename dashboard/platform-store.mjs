import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS only_one_internal_client ON clients(is_internal) WHERE is_internal=1');
 if(!db.prepare('PRAGMA table_info(client_passwords)').all().some(x=>x.name==='phone'))db.exec('ALTER TABLE client_passwords ADD COLUMN phone TEXT');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS unique_login_phone ON client_passwords(phone) WHERE phone IS NOT NULL');
 const loginPhone=value=>{let x=String(value||'').replace(/\D/g,'');if(x.length===11)x='55'+x;return /^55\d{11}$/.test(x)?x:null;};
 const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
 const balance=id=>Number(db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM credit_events WHERE client_id=?').get(id).n);
 const pending=id=>Number(db.prepare("SELECT COUNT(*) AS n FROM credit_reservations WHERE client_id=? AND state='RESERVED'").get(id).n);
 const publicClient=r=>r?{id:r.id,name:r.name,email:r.email,status:r.status,createdAt:r.created_at,unlimited:r.is_internal===1,balance:balance(r.id),reserved:pending(r.id),available:r.is_internal===1?null:balance(r.id)-pending(r.id)}:null;
 const get=id=>db.prepare('SELECT * FROM clients WHERE id=?').get(id);
 function adjust(id,amount,reason,reference=crypto.randomUUID()){
  if(get(id)?.is_internal===1)throw Error('A conta interna já possui uso ilimitado e não precisa de recarga');
  if(!get(id)||!Number.isSafeInteger(amount)||!amount||Math.abs(amount)>10000000)throw Error('Ajuste de créditos inválido');
  db.exec('BEGIN IMMEDIATE');
  try{
   if(db.prepare('SELECT 1 FROM credit_events WHERE client_id=? AND reference=?').get(id,reference)){db.exec('COMMIT');return balance(id);}
   if(balance(id)+amount<pending(id))throw Error('Saldo insuficiente ou reservado em envios');
   db.prepare('INSERT INTO credit_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),id,amount,String(reason).slice(0,200),reference,new Date().toISOString());
   db.exec('COMMIT');return balance(id);
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {db,get,balance,adjust,publicClient,pending,
  signup({name,email,password,phone,privacyAcknowledged}){
   email=String(email||'').trim().toLowerCase();password=String(password||'');
   if(privacyAcknowledged!==true||password.length<10||password.length>128)throw Error('Use uma senha de 10 a 128 caracteres e confirme a leitura sobre seus dados');
   const normalizedPhone=loginPhone(phone);if(!normalizedPhone)throw Error('Informe seu celular com DDD');
   const salt=crypto.randomBytes(24).toString('hex'),passwordHash=crypto.scryptSync(password,salt,64).toString('hex');
   db.exec('BEGIN IMMEDIATE');try{
    if(db.prepare('SELECT 1 FROM clients WHERE lower(email)=?').get(email))throw Error('Não foi possível criar esta conta. Se já possui cadastro, entre ou fale com a Consecom.');
    const result=this.create({name,email});
    db.prepare('INSERT INTO client_passwords(client_id,email,salt,password_hash,privacy_version,created_at,phone) VALUES(?,?,?,?,?,?,?)').run(result.client.id,email,salt,passwordHash,'2026-11-05',new Date().toISOString(),normalizedPhone);
    db.exec('COMMIT');return get(result.client.id);
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
  releaseUncertain(id){
   if(get(id)?.status!=='suspended')throw Error('Suspenda a conta e confira as entregas antes de liberar reservas');
   return Number(db.prepare("UPDATE credit_reservations SET state='RELEASED' WHERE client_id=? AND state='RESERVED'").run(id).changes);
  },
  reserve(id,reference){
   db.exec('BEGIN IMMEDIATE');try{
    if(get(id)?.status!=='active')throw Error('Conta indisponível');
    const existing=db.prepare('SELECT state FROM credit_reservations WHERE client_id=? AND reference=?').get(id,reference);
    if(existing&&existing.state!=='RELEASED'){db.exec('COMMIT');return false;}
    if(balance(id)-pending(id)<1){db.exec('COMMIT');return false;}
    db.prepare("INSERT INTO credit_reservations VALUES(?,?,?,?) ON CONFLICT(client_id,reference) DO UPDATE SET state='RESERVED'").run(id,reference,'RESERVED',new Date().toISOString());db.exec('COMMIT');return true;
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  settle(id,reference,accepted){
   db.exec('BEGIN IMMEDIATE');try{
    const r=db.prepare('SELECT state FROM credit_reservations WHERE client_id=? AND reference=?').get(id,reference);
    if(r?.state==='RESERVED'){
     if(accepted)db.prepare('INSERT OR IGNORE INTO credit_events VALUES(?,?,?,?,?,?)').run(crypto.randomUUID(),id,-1,'Abordagem aceita pelo canal',reference,new Date().toISOString());
     db.prepare('UPDATE credit_reservations SET state=? WHERE client_id=? AND reference=?').run(accepted?'CONSUMED':'RELEASED',id,reference);
    }db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  },
  list:()=>db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all().map(publicClient),
  create({name,email}){
   name=String(name||'').trim();email=String(email||'').trim();
   if(!name||name.length>100||!/^\S+@\S+\.\S+$/.test(email)||email.length>200)throw Error('Informe nome e e-mail válidos');
   const id=crypto.randomUUID(),token=crypto.randomBytes(36).toString('base64url');
   db.prepare('INSERT INTO clients(id,name,email,status,token_hash,secret,created_at) VALUES(?,?,?,?,?,?,?)').run(id,name,email,'active',hash(token),crypto.randomBytes(48).toString('base64url'),new Date().toISOString());
   return {client:publicClient(get(id)),token};
  },
  authenticate:token=>db.prepare("SELECT * FROM clients WHERE token_hash=? AND status='active'").get(hash(token)),
  status(id,status){if(!get(id)||!['active','suspended'].includes(status))throw Error('Cliente ou status inválido');if(get(id).is_internal===1&&status==='suspended')throw Error('Pause a operação pelo painel do cliente interno');db.prepare('UPDATE clients SET status=? WHERE id=?').run(status,id);return publicClient(get(id));},
  rotate(id){if(!get(id))throw Error('Cliente inválido');const token=crypto.randomBytes(36).toString('base64url');db.prepare('UPDATE clients SET token_hash=? WHERE id=?').run(hash(token),id);return token;},
  events:id=>db.prepare('SELECT id,amount,reason,created_at FROM credit_events WHERE client_id=? ORDER BY rowid DESC LIMIT 100').all(id)
 };
}

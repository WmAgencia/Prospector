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
 const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
 const balance=id=>Number(db.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM credit_events WHERE client_id=?').get(id).n);
 const pending=id=>Number(db.prepare("SELECT COUNT(*) AS n FROM credit_reservations WHERE client_id=? AND state='RESERVED'").get(id).n);
 const publicClient=r=>r?{id:r.id,name:r.name,email:r.email,status:r.status,createdAt:r.created_at,balance:balance(r.id),reserved:pending(r.id),available:balance(r.id)-pending(r.id)}:null;
 const get=id=>db.prepare('SELECT * FROM clients WHERE id=?').get(id);
 function adjust(id,amount,reason,reference=crypto.randomUUID()){
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
   db.prepare('INSERT INTO clients VALUES(?,?,?,?,?,?,?)').run(id,name,email,'active',hash(token),crypto.randomBytes(48).toString('base64url'),new Date().toISOString());
   return {client:publicClient(get(id)),token};
  },
  authenticate:token=>db.prepare("SELECT * FROM clients WHERE token_hash=? AND status='active'").get(hash(token)),
  status(id,status){if(!get(id)||!['active','suspended'].includes(status))throw Error('Cliente ou status inválido');db.prepare('UPDATE clients SET status=? WHERE id=?').run(status,id);return publicClient(get(id));},
  rotate(id){if(!get(id))throw Error('Cliente inválido');const token=crypto.randomBytes(36).toString('base64url');db.prepare('UPDATE clients SET token_hash=? WHERE id=?').run(hash(token),id);return token;},
  events:id=>db.prepare('SELECT id,amount,reason,created_at FROM credit_events WHERE client_id=? ORDER BY rowid DESC LIMIT 100').all(id)
 };
}

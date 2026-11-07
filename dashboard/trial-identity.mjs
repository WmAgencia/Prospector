import crypto from 'node:crypto';

// One natural person, one permanent trial claim, across CPF, mobile and email.
// CPF validation here checks only check digits. It DOES NOT prove identity
// or that the user-supplied name matches official government records.
export const normalizeCpf=value=>String(value||'').replace(/\D/g,'');
export function validCpf(value){
 const cpf=normalizeCpf(value);
 if(!/^\d{11}$/.test(cpf)||/^(\d)\1{10}$/.test(cpf))return false;
 for(const pos of [9,10]){
  let sum=0;for(let i=0;i<pos;i++)sum+=Number(cpf[i])*(pos+1-i);
  if(Number(cpf[pos])!==((sum*10)%11)%10)return false;
 }
 return true;
}
export function legalName(value){
 const name=String(value||'').normalize('NFC').trim().replace(/\s+/g,' ');
 if(name.length<5||name.length>100||name.split(' ').filter(Boolean).length<2||!/^[\p{L}][\p{L}\p{M} .'-]*$/u.test(name))throw Error('Informe o nome completo que consta no CPF');
 return name;
}
export function trialCpfDigest(value,secret){
 if(!validCpf(value))throw Error('CPF inválido');
 if(!secret||String(secret).length<24)throw Error('Validação de CPF indisponível. Contate o suporte.');
 return crypto.createHmac('sha256',String(secret)).update('trial-cpf-v1:'+normalizeCpf(value)).digest('hex');
}
export const TRIAL_FREE_CREDITS=100;

// Stored only until verification, never exposed to the browser except via
// explicit authenticated Master identity-review action. Derived AES-256 key
// is independent from the HMAC domain separator.
function aesKey(secret){
 if(!secret||String(secret).length<24)throw Error('Chave de identidade indisponível');
 return crypto.createHash('sha256').update('prospector-trial-cpf-aes-v1:'+secret).digest();
}
export function sealTrialCpf(cpf,secret){
 if(!validCpf(cpf))throw Error('CPF inválido');
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',aesKey(secret),nonce);
 const data=Buffer.concat([cipher.update(normalizeCpf(cpf),'utf8'),cipher.final()]);
 return Buffer.concat([nonce,cipher.getAuthTag(),data]).toString('base64url');
}
export function unsealTrialCpf(sealed,secret){
 const raw=Buffer.from(String(sealed||''),'base64url');
 if(raw.length<29)throw Error('Dados de verificação indisponíveis');
 const iv=raw.subarray(0,12),tag=raw.subarray(12,28),encrypted=raw.subarray(28);
 const decipher=crypto.createDecipheriv('aes-256-gcm',aesKey(secret),iv);
 decipher.setAuthTag(tag);
 const cpf=Buffer.concat([decipher.update(encrypted),decipher.final()]).toString('utf8');
 if(!validCpf(cpf))throw Error('Dados de verificação inválidos');
 return cpf;
}

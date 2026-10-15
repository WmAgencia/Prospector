// Regras puras para o ciclo de conexão WhatsApp; testáveis sem rede nem credenciais.
export function validVersion(v){return Array.isArray(v)&&v.length===3&&v.every(Number.isSafeInteger)&&v[0]===2&&v[1]>=2000&&v[2]>0;}
export function classifyDisconnect(code,loggedOutCode){
  return Number(code)===Number(loggedOutCode)?'LOGGED_OUT':'DISCONNECTED';
}
export function retryDelay(attempt){
 return Math.min(120000,15000*Math.pow(2,Math.max(0,Math.min(4,attempt-1))));
}
export async function currentWebVersion(B){
 if(typeof B.fetchLatestWaWebVersion!=='function')throw Error('Sua versão do Baileys não oferece consulta da versão atual do WhatsApp Web');
 const result=await B.fetchLatestWaWebVersion();
 if(result?.isLatest!==true||!validVersion(result.version))throw Error('Não foi possível confirmar a versão atual do WhatsApp Web. Conexão suspensa para evitar falha no pareamento.');
 return result.version;
}

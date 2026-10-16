// Bounded waits prevent a provider call from keeping the scheduler lock forever.
// A timeout is an UNKNOWN result, not proof of failure; never retry automatically.
export async function withDeadline(operation,ms,label='provider'){
 if(!Number.isInteger(ms)||ms<1||ms>120000)throw Error('Tempo limite inválido');
 let timeout;
 const timed=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error(label+' excedeu '+Math.round(ms/1000)+' segundos; envio requer revisão antes de qualquer reenvio')),ms);});
 try{return await Promise.race([Promise.resolve().then(operation),timed]);}
 finally{clearTimeout(timeout);}
}

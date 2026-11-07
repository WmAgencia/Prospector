import {billingReady} from './stripe-billing.mjs';
const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
export const businessDay=date=>{
 const parts=Object.fromEntries(formatter.formatToParts(new Date(date)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
};
export function masterAnalytics(ledger,now=new Date()){
 const db=ledger.db,clients=ledger.list().filter(x=>!x.demo),day=businessDay(now),month=day.slice(0,7);
 const verified=db.prepare('SELECT p.stripe_session_id,p.price_cents,p.credits,p.created_at,c.name AS client_name,c.id AS client_id FROM verified_payments p JOIN clients c ON c.id=p.client_id ORDER BY p.created_at DESC LIMIT 10000').all();
 const today=verified.filter(x=>businessDay(x.created_at)===day);
 const thisMonth=verified.filter(x=>businessDay(x.created_at).startsWith(month));
 const paidTotal=records=>records.reduce((sum,x)=>sum+x.price_cents,0);
 const active=clients.filter(x=>x.status==='active').length;
 const available=clients.filter(x=>!x.unlimited).reduce((sum,x)=>sum+Math.max(0,x.available||0),0);
 const reserved=clients.filter(x=>!x.unlimited).reduce((sum,x)=>sum+x.reserved,0);
 const requests=db.prepare("SELECT status, COUNT(*) count FROM credit_requests GROUP BY status").all();
 const statusCount=type=>Number(requests.find(x=>x.status===type)?.count||0);
 const creditUse=db.prepare("SELECT client_id,amount,created_at FROM credit_events WHERE amount<0 ORDER BY created_at DESC LIMIT 100000").all();
 const usedMonth=creditUse.filter(x=>businessDay(x.created_at).startsWith(month));
 const consumption=new Map();for(const e of usedMonth)consumption.set(e.client_id,(consumption.get(e.client_id)||0)-e.amount);
 const topClients=[...clients].filter(c=>!c.internal).sort((a,b)=>(consumption.get(b.id)||0)-(consumption.get(a.id)||0)).slice(0,6).map(c=>({id:c.id,name:c.name,creditsUsed:consumption.get(c.id)||0,available:c.available,planId:c.planId}));
 const dayAmount=new Map();for(const row of verified){const d=businessDay(row.created_at);dayAmount.set(d,(dayAmount.get(d)||0)+row.price_cents);}
 const trend=[];for(let d=13;d>=0;d--){const date=new Date(now.getTime()-d*86400000);const key=businessDay(date);trend.push({date:key,label:key.slice(8,10)+'/'+key.slice(5,7),amountCents:dayAmount.get(key)||0});}
 const plans={unlimited:0,custom:0,credits:0};
 for(const c of clients){if(c.unlimited)plans.unlimited++;else if(c.planId==='custom')plans.custom++;else plans.credits++;}
 return {
  asOf:now.toISOString(),today:day,month,
  billing:{configured:billingReady(),provider:'Stripe',verifiedOnly:true},
  revenue:{todayCents:paidTotal(today),monthCents:paidTotal(thisMonth),allTimeCents:paidTotal(verified),paymentsToday:today.length,paymentsMonth:thisMonth.length},
  clients:{total:clients.length,active,suspended:clients.length-active,newThisMonth:clients.filter(c=>businessDay(c.createdAt).startsWith(month)).length,plans},
  credits:{available,reserved,usedMonth:usedMonth.length,pendingRequests:statusCount('PENDING'),approvedRequests:statusCount('APPROVED')},
  trend,topClients,recentPayments:verified.slice(0,8).map(x=>({clientName:x.client_name,amountCents:x.price_cents,credits:x.credits,at:x.created_at}))
 };
}

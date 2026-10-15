// Auditoria opcional de sites públicos via API PageSpeed Insights.
import {one,run,id,now,audit} from './db.mjs';
export function safePublicWebsite(value){
 const u=new URL(String(value||''));
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.'))throw Error('Informe um domínio HTTP(S) público');
 const host=u.hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.local')||host.endsWith('.internal')||/^(127|10|0)\./.test(host)||/^192\.168\./.test(host))throw Error('Domínio privado não permitido');
 return u.toString();
}
export async function siteAudit(leadId){
 const lead=one('SELECT * FROM leads WHERE id=?',leadId);
 if(!lead)throw Error('Lead inexistente');
 if(!lead.website)throw Error('Identifique o site antes de avaliar sua qualidade');
 const website=safePublicWebsite(lead.website);
 const u=new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
 u.searchParams.set('url',website);u.searchParams.set('strategy','mobile');u.searchParams.set('locale','pt-BR');
 for(const category of ['performance','accessibility','best-practices','seo'])u.searchParams.append('category',category);
 if(process.env.PAGESPEED_API_KEY)u.searchParams.set('key',process.env.PAGESPEED_API_KEY);
 const r=await fetch(u,{signal:AbortSignal.timeout(45000),headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('PageSpeed Insights indisponível: HTTP '+r.status);
 const data=await r.json();
 const categories=data.lighthouseResult?.categories||{};
 const scores=Object.fromEntries(Object.entries({performance:'performance',accessibility:'accessibility',bestPractices:'best-practices',seo:'seo'}).map(([k,v])=>[k,Number.isFinite(categories[v]?.score)?Math.round(100*categories[v].score):null]));
 if(Object.values(scores).every(x=>x===null))throw Error('O provedor não forneceu métricas de análise');
 const item={leadId,website,at:now(),strategy:'mobile',scores,provider:'PAGESPEED_INSIGHTS'};
 audit('SITE_QUALITY_AUDIT',leadId,item);
 return item;
}

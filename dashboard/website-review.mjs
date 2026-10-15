// A negative search is not proof that no website exists; manual review is required.
export const SOURCES=['OPENSTREETMAP','BRAVE','GOOGLE','BING','REGISTRO_PUBLICO','DIRETORIO','REDES_SOCIAIS','CONTATO_DIRETO'];
export const STATUSES=['UNCERTAIN','NOT_FOUND_AFTER_CHECK','NO_WEBSITE','HAS_WEBSITE','SOCIAL_ONLY','LINK_AGGREGATOR_ONLY','BROKEN_WEBSITE'];
export function evidence(input,old){
 const status=String(input.website_status||old.website_status||'UNCERTAIN');
 if(!STATUSES.includes(status))throw Error('Status do site inválido');
 if(status===old.website_status)return null;
 const needsReview=status!=='UNCERTAIN';
 if(!needsReview)return null;
 const sources=[...new Set(String(input.site_review_sources||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean))];
 const note=String(input.site_review_note||'').trim().slice(0,800);
 if(sources.some(s=>!SOURCES.includes(s)))throw Error('Fonte de revisão inválida');
 if(input.site_reviewed!==true||note.length<20||sources.length<(status==='NO_WEBSITE'?2:1))throw Error('Informe as fontes consultadas, justificativa de 20+ caracteres e confirme a revisão humana');
 if(status==='HAS_WEBSITE'){
  try{const u=new URL(String(input.website??old.website??''));if(!['http:','https:'].includes(u.protocol)||!u.hostname.includes('.'))throw Error();}
  catch{throw Error('Site confirmado exige URL HTTP(S) válida');}
 }
 return {status,sources,note,confidence:status==='NO_WEBSITE'?'MODERADA':'REVISAO_HUMANA',checkedBy:'human',verifiedAt:new Date().toISOString()};
}

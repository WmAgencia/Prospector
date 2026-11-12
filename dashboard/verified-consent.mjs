// Quick approval without an individual receipt is not documented opt-in.
const channels=new Set(['PERSONAL_WHATSAPP','PHONE_CALL','OTHER']);
export function validIndividualConsent(detail={}){
 const x=detail&&typeof detail==='object'?detail:{};
 const t=Date.parse(String(x.consentAt||''));
 return x.permitted===true&&x.method==='manual_batch_curation'&&
  x.evidenceVerified!==false&&x.evidenceType!=='OPERATOR_ATTESTATION'&&
  String(x.evidence||'').trim().length>=3&&
  String(x.evidenceReference||'').trim().length>=3&&
  /^55\d{10,11}$/.test(String(x.sourcePhone||''))&&channels.has(String(x.channel||''))&&
  Number.isFinite(t)&&t<=Date.now()+300000&&t>=Date.now()-366*86400000;
}
// The SQL prefilter applies the *latest* consent record. Send-time verification
// applies validIndividualConsent(), preventing stale or revoked permissions.
export function individualConsentSql(alias='l'){
 if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(alias))throw Error('INVALID_SQL_ALIAS');
 const f=key=>"json_extract(a.detail,'$."+key+"')";
 return "EXISTS(SELECT 1 FROM audit a WHERE a.lead_id="+alias+".id"+
 " AND a.action='CONSENT_UPDATED'"+
 " AND a.rowid=(SELECT MAX(z.rowid) FROM audit z WHERE z.lead_id="+alias+".id AND z.action='CONSENT_UPDATED')"+
 " AND "+f('permitted')+"=1"+
 " AND "+f('method')+"='manual_batch_curation'"+
 " AND COALESCE("+f('evidenceVerified')+",1)<>0"+
 " AND COALESCE("+f('evidenceType')+",'')<>'OPERATOR_ATTESTATION'"+
 " AND LENGTH(TRIM(COALESCE("+f('evidence')+",'')))>=3"+
 " AND LENGTH(TRIM(COALESCE("+f('evidenceReference')+",'')))>=3"+
 " AND LENGTH(COALESCE("+f('sourcePhone')+",'')) IN (12,13)"+
 " AND "+f('channel')+" IN ('PERSONAL_WHATSAPP','PHONE_CALL','OTHER')"+
 " AND LENGTH(COALESCE("+f('consentAt')+",''))>10)";
}

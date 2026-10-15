// Official keyed directories. Research results are transient (not stored as leads).
// Provider terms and attribution must be reviewed before using results commercially.
const fields=['id','name','website','phone','address','uri','source'];
const limitText=(text,n)=>String(text||'').trim().slice(0,n);
let lastRequest=0;
export async function searchDirectory({provider,query,city}={}){
 const segment=limitText(query,95),place=limitText(city,60);
 if(segment.length<2||place.length<2)throw Error('Informe categoria e cidade');
 if(Date.now()-lastRequest<2500)throw Error('Aguarde alguns segundos entre consultas externas');
 const choice=String(provider||'');
 let response;
 lastRequest=Date.now();
 if(choice==='google_places'){
  const key=process.env.GOOGLE_PLACES_API_KEY;
  if(!key)throw Error('Configure GOOGLE_PLACES_API_KEY na Railway (Google Places API New; pode gerar cobrança).');
  response=await fetch('https://places.googleapis.com/v1/places:searchText',{
   method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.internationalPhoneNumber,places.googleMapsUri'},
   body:JSON.stringify({textQuery:segment+' em '+place+', Brasil',pageSize:20,languageCode:'pt-BR',regionCode:'BR'}),
   signal:AbortSignal.timeout(16000)});
  if(!response.ok)throw Error('Google Places HTTP '+response.status);
  const data=await response.json();
  const entries=(data.places||[]).slice(0,20).map(x=>({id:limitText(x.id,110),name:limitText(x.displayName?.text,120),website:limitText(x.websiteUri,450),phone:limitText(x.internationalPhoneNumber,40),address:limitText(x.formattedAddress,220),uri:limitText(x.googleMapsUri,450),source:'google_places'}));
  return {source:'google_places',results:entries,stored:false,note:'Resultados transitórios: confirme termos de uso, identidade e existência do site antes de registrar dados.'};
 }
 if(choice==='foursquare'){
  const key=process.env.FOURSQUARE_API_KEY;
  if(!key)throw Error('Configure FOURSQUARE_API_KEY na Railway.');
  const u=new URL('https://places-api.foursquare.com/places/search');
  u.searchParams.set('query',segment);u.searchParams.set('near',place+', SP, Brasil');u.searchParams.set('limit','20');
  response=await fetch(u,{headers:{'Authorization':'Bearer '+key,'X-Places-Api-Version':'2025-06-17','Accept':'application/json'},signal:AbortSignal.timeout(16000)});
  if(!response.ok)throw Error('Foursquare HTTP '+response.status);
  const data=await response.json();
  const entries=(data.results||[]).slice(0,20).map(x=>({id:limitText(x.fsq_place_id||x.fsq_id,100),name:limitText(x.name,120),website:limitText(x.website,450),phone:limitText(x.tel,40),address:limitText(x.location?.formatted_address,220),uri:limitText(x.link,450),source:'foursquare'}));
  return {source:'foursquare',results:entries,stored:false,note:'Resultados transitórios sujeitos à licença do provedor; falta de site não prova que inexiste.'};
 }
 throw Error('Fonte externa não reconhecida');
}

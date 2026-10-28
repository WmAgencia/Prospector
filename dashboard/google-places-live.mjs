// Live, uncached, authorized Google Places (New) Text Search.
// Places fields returned by Google are ephemeral; do not persist or bulk-export them.
const URL="https://places.googleapis.com/v1/places:searchText";
export function placesStatus(){return {provider:"Google Places API (New)",configured:Boolean(process.env.GOOGLE_MAPS_API_KEY),enabled:process.env.GOOGLE_PLACES_ENABLED==="true",mode:"live_only",disclaimer:"Pesquisa não garante cobertura integral nem WhatsApp válido; exige API oficial com faturamento habilitado."};}
export async function placesSearch(input={}){
 if(process.env.GOOGLE_PLACES_ENABLED!=="true"||!process.env.GOOGLE_MAPS_API_KEY)return {status:503,body:{error:"Google Places API não configurada",requires:"GOOGLE_MAPS_API_KEY e GOOGLE_PLACES_ENABLED=true"}};
 const query=String(input.query||"").trim();
 const city=String(input.city||"Sorocaba").trim();
 const token=String(input.pageToken||"");
 if(query.length<3||query.length>100||city.length<2||city.length>80||token.length>2000)return {status:400,body:{error:"Consulta ou paginação inválida"}};
 const textQuery=query+" em "+city+", Brasil";
 const body={textQuery,languageCode:"pt-BR",regionCode:"BR",pageSize:20};
 if(token)body.pageToken=token;
 try{
  const res=await fetch(URL,{method:"POST",headers:{"Content-Type":"application/json","X-Goog-Api-Key":process.env.GOOGLE_MAPS_API_KEY,"X-Goog-FieldMask":"places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.googleMapsUri,nextPageToken,searchUri"},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
  if(!res.ok)return {status:502,body:{error:"Google Places não respondeu normalmente",upstreamStatus:res.status}};
  const raw=await res.json();
  const places=(raw.places||[]).filter(x=>typeof x.id==="string").map(x=>({placeId:x.id,name:x.displayName?.text||"",address:x.formattedAddress||"",phone:x.nationalPhoneNumber||null,website:x.websiteUri||null,mapsUrl:x.googleMapsUri||null}));
  return {status:200,body:{source:"Google Places API (New)",cached:false,query:textQuery,results:places,nextPageToken:raw.nextPageToken||null,searchUrl:raw.searchUri||null,note:"Não representa todas as empresas da cidade. Dados de local exibidos temporariamente, não armazenados pelo Prospector."}};
 }catch(e){return {status:502,body:{error:e?.name==="TimeoutError"?"Google Places expirou":"Google Places indisponível"}};}
}

// Pure, conservative identity check for a Google Maps / OpenStreetMap place
// against the business premises returned by a public CNPJ data source.
// Missing/mismatched address data MUST fail closed and use the original listing.
export const normalizeField=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export const normalizeStreet=value=>normalizeField(value).replace(/^(?:rua|r|avenida|av|avda|travessa|tv|estrada|est|rodovia|rod|praca|pca|alameda|al)\s+/,'');
const digits=value=>String(value??'').replace(/\D/g,'');
export function providerAddress(data={}){
 return {
  street:String(data.logradouro||data.street||data.endereco?.logradouro||'').trim(),
  number:String(data.numero||data.number||data.endereco?.numero||'').trim(),
  district:String(data.bairro||data.district||'').trim(),
  postcode:digits(data.cep||data.postcode||data.endereco?.cep||''),
  city:String(data.municipio||data.nome_municipio||data.endereco?.municipio||'').trim(),
  state:String(data.uf||data.endereco?.uf||'').trim()
 };
}
function exactAddress(provided,actual){
 const s=normalizeStreet(provided.street),t=normalizeStreet(actual.street);
 const a=normalizeField(provided.number),b=normalizeField(actual.number);
 if(!s||!t||s!==t||!a||!b||a!==b)return false;
 const c=normalizeField(provided.city),d=normalizeField(actual.city);
 if(!c||!d||c!==d)return false;
 if(provided.state&&actual.state&&normalizeField(provided.state)!==normalizeField(actual.state))return false;
 const zip=digits(provided.postcode),actualZip=digits(actual.postcode);
 if(zip&&actualZip&&zip!==actualZip)return false;
 return true;
}
function matchUnstructured(source,actual){
 const raw=normalizeField(source.raw),street=normalizeStreet(actual.street);
 const n=normalizeField(actual.number);
 if(!raw||!street||!n||!actual.city)return false;
 // Street names must appear as contiguous words and the *immediately following*
 // house number must match. Do not treat a CEP somewhere in a listing as the number.
 const names=street.split(' ').filter(Boolean);
 if(!names.length)return false;
 const words=raw.split(' ');
 let streetEnd=-1;
 for(let i=0;i<=words.length-names.length;i++){
  if(names.every((w,j)=>words[i+j]===w)){streetEnd=i+names.length;break;}
 }
 if(streetEnd<0)return false;
 if(words[streetEnd]!==n)return false;
 if(!raw.includes(normalizeField(actual.city)))return false;
 if(source.city&&normalizeField(source.city)!==normalizeField(actual.city))return false;
 const uf=normalizeField(source.state);
 if(uf&&actual.state&&uf!==normalizeField(actual.state))return false;
 const z=digits(source.postcode);
 if(z&&actual.postcode&&z!==digits(actual.postcode))return false;
 return true;
}
export function isSameBusiness(lead,company,source){
 if(!company||!lead||!source)return false;
 const name=normalizeField(lead.business);
 if(!name||![company.company,company.fantasy].some(n=>normalizeField(n)===name))return false;
 if(!normalizeField(lead.city)||normalizeField(lead.city)!==normalizeField(company.city))return false;
 if(source.city&&normalizeField(source.city)!==normalizeField(company.city))return false;
 if(source.street&&source.number)return exactAddress(source,company.address);
 return matchUnstructured(source,company.address);
}

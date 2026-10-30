// Parse Brazilian telephone numbers SPOKEN in groups: "15, 98, 114, 25, 7",
// "quinze noventa e oito cento e quatorze vinte e cinco sete", or digits.
// Never fill in a missing digit; the caller must provide the exact full number.
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const units={zero:0,um:1,uma:1,hum:1,dois:2,duas:2,tres:3,treis:3,quatro:4,cinco:5,seis:6,meia:6,sete:7,oito:8,nove:9};
const teens={dez:10,onze:11,doze:12,treze:13,quatorze:14,catorze:14,quinze:15,dezesseis:16,dezasseis:16,dezessete:17,dezoito:18,dezenove:19};
const tens={vinte:20,trinta:30,quarenta:40,cinquenta:50,sessenta:60,setenta:70,oitenta:80,noventa:90};
const hundreds={cem:100,cento:100,duzentos:200,trezentos:300,quatrocentos:400,quinhentos:500,seiscentos:600,setecentos:700,oitocentos:800,novecentos:900};
const numericWord=w=>Object.hasOwn(units,w)||Object.hasOwn(teens,w)||Object.hasOwn(tens,w)||Object.hasOwn(hundreds,w);
const phoneWordStart='zero|um|uma|hum|dois|duas|tres|treis|quatro|cinco|seis|meia|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezasseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento';
function readGroup(words,index){
 const word=words[index]?.value;
 if(!word)return null;
 if(/^\d+$/.test(word))return {digits:word,count:1};
 if(Object.hasOwn(units,word))return {digits:String(units[word]),count:1};
 if(Object.hasOwn(teens,word))return {digits:String(teens[word]),count:1};
 let sum=0,j=index;
 if(Object.hasOwn(hundreds,word)){
  sum=hundreds[word];j++;
  if(words[j]?.value==='e'&&numericWord(words[j+1]?.value))j++;
 }
 const t=words[j]?.value;
 if(Object.hasOwn(teens,t)){sum+=teens[t];j++;}
 else if(Object.hasOwn(tens,t)){
  sum+=tens[t];j++;
  if(words[j]?.value==='e'&&Object.hasOwn(units,words[j+1]?.value)){
   sum+=units[words[j+1].value];j+=2;
  }
 }else if(Object.hasOwn(units,t)&&j!==index){sum+=units[t];j++;}
 if(j===index)return null;
 return {digits:String(sum),count:j-index};
}
export function parseSpokenBrazilPhone(raw){
 const original=String(raw||'').slice(0,650);
 const normalized=norm(original);
 // Prefer a named recipient; alternatively support "manda mensagem para 15...",
 // or the bare number in the following turn.
 let offset=0;
 const explicit=/\b(?:numero|telefone|celular|contato|ddd)\b(?:\s+(?:de\s+whatsapp|completo|e|eh|seria|da\s+pessoa|do\s+destinatario))*\s*[:=,-]?\s*/g;
 const keys=[...normalized.matchAll(explicit)];
 if(keys.length){
  const last=keys.at(-1);offset=last.index+last[0].length;
 }else{
  const prefix=new RegExp('\\b(?:para|pro|pra|ao)\\s+(?=(?:\\d+|'+phoneWordStart+')\\b)').exec(normalized);
  if(prefix)offset=prefix.index+prefix[0].length;
  else if(!new RegExp('^\\s*(?:\\+?\\d+|'+phoneWordStart+')\\b').test(normalized))return null;
 }
 const tail=normalized.slice(offset);
 const tokens=[...tail.matchAll(/\d+|[a-z]+|[,;.()\-+]/g)].map(m=>({value:m[0],start:offset+m.index,end:offset+m.index+m[0].length}));
 let index=0,digits='',end=offset;
 // Skip only leading punctuation; no natural-language filler permitted.
 while(tokens[index]&&/^[,;.()\-+]$/.test(tokens[index].value))index++;
 const start=tokens[index]?.start??offset;
 for(;index<tokens.length;){
  const current=tokens[index];
  if(/^[,;.()\-+]$/.test(current.value)){index++;continue;}
  const grp=readGroup(tokens,index);
  if(!grp)break;
  digits+=grp.digits;index+=grp.count;end=tokens[index-1].end;
  if(digits.length>15)break;
 }
 if(digits.length<1)return null;
 const local=digits.startsWith('55')&&digits.length>=12?digits.slice(2):digits;
 const normalizedPhone=local.length===10||local.length===11?'55'+local:null;
 const likelyTruncated=local.length===10&&local.slice(2).startsWith('9');
 const valid=!!normalizedPhone&&!likelyTruncated&&/^55\d{10,11}$/.test(normalizedPhone);
 return {raw:original.slice(start,end).trim(),digits:normalizedPhone||digits,number:valid?normalizedPhone:null,
  invalid:!valid,likelyTruncated,span:{start,end}};
}
const wordDigit=['zero','um','dois','três','quatro','cinco','seis','sete','oito','nove'];
export function readBackPhoneDigits(internationalNumber){
 const n=String(internationalNumber||'').replace(/\D/g,'');
 if(!/^55\d{10,11}$/.test(n))return '';
 const d=n.slice(2);
 return 'DDD '+d.slice(0,2).split('').map(x=>wordDigit[Number(x)]).join(', ')+
  ', número '+d.slice(2).split('').map(x=>wordDigit[Number(x)]).join(', ');
}
export function phoneNumberFromTranscript(text){return parseSpokenBrazilPhone(text)?.digits||null;}

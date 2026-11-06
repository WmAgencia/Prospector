// Conservative name extraction for commercial WhatsApp greetings.
// Never guess a person's name from the first word of a business name.
// This module has no DB/network dependencies and is shared by all greeting paths.
const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const clean=value=>String(value||'').replace(/[\r\n\t<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,130);
const businessWord=/\b(?:clinica|consultorio|hospital|odontologia|odonto|medicina|medica|medico|saude|estetica|dermatologia|fisioterapia|psicologia|psicologo|psicologa|laboratorio|equipe|atendimento|recepcao|empresa|comercio|comercial|loja|oficina|mecanica|autoeletrica|automotiva|restaurante|lanchonete|pizzaria|barbearia|salao|studio|estudio|instituto|centro|beleza|spa|beauty|sistema|solucoes|servicos|servico|industria|industriais|construcao|engenharia|marketing|agencia|contabilidade|imobiliaria|academia|escola|buffet|eventos|confeitaria|farmacia|veterinaria|papelaria|moda|fashion|boutique|assistencia|tecnologia|manutencao|ltda|eireli|epp|mei|equipe|suporte|vendas|whatsapp|oficial|profissional|especialista|administracao|contato|responsavel|gerencia|cliente)\b/u;
const disallowedFirst=/^(?:dr|dra|doutor|doutora|sr|sra|senhor|senhora|prof|professor|professora|contato|clinica|consultorio|empresa|equipe|studio|estudio|loja|oficina|centro|instituto|servicos|servico|atendimento|recepcao|administrador|responsavel|salao|barbearia|restaurante|profissional|whatsapp|pessoal|contabil|estetica|beauty|spa|teste|comercial|gestor|admin|sem|nome|nao|informado|null|undefined|usuario|cliente)$/u;
const titlePattern=/(?:^|[\s,|/—–-])(?:dra?\.?|doutor(?:a)?\.?|prof\.?|professor(?:a)?\.?|sr(?:a)?\.?)\s+([\p{L}][\p{L}\p{M}'’\-]{1,29})(?=$|[\s,|/—–-])/iu;
const validFirst=word=>{
 const w=clean(word),norm=normalize(w);
 return /^[\p{L}][\p{L}\p{M}'’-]{1,29}$/u.test(w)&&!disallowedFirst.test(norm)&&!businessWord.test(norm);
};
const capitalized=value=>value.charAt(0).toLocaleUpperCase('pt-BR')+value.slice(1).toLocaleLowerCase('pt-BR');

// A professional title explicitly identifies a person's name within a larger
// public business label (e.g. "Clínica Dra. Monique Bavia — Estética").
export function titledPersonFirstName(value){
 const text=clean(value);
 if(!text||/[0-9@]/.test(text))return '';
 const match=titlePattern.exec(text);
 return match&&validFirst(match[1])?capitalized(match[1]):'';
}
function explicitContactFirstName(value,business=''){
 const name=clean(value);
 if(!name||name.length>90||/[0-9@:/\\&#]/.test(name))return '';
 const titled=titledPersonFirstName(name);
 if(titled)return titled;
 // A contact field can contain a business label. Do not mistake it for a person.
 // Business names, departments, mixed advertisements and the business field
 // itself are never sufficiently reliable for name personalisation.
 const segment=name.split(/[|•—–]/)[0].trim();
 const norm=normalize(segment);
 if(!segment||norm===normalize(business)||businessWord.test(norm))return '';
 if(/[!?+$%()[\]{}]/.test(segment))return '';
 const tokens=segment.split(/\s+/).filter(Boolean);
 if(tokens.length>5||tokens.length===0)return '';
 if(tokens.some(w=>!(/^[\p{L}][\p{L}\p{M}'’-]{0,29}$/u.test(w))))return '';
 const first=tokens[0];
 return validFirst(first)?capitalized(first):'';
}
export function leadFirstName(lead={}){
 if(!lead||typeof lead!=='object')return '';
 // Dedicated person fields are more reliable than business names but remain
 // checked: an imported "Clínica" or "Equipe" is NOT a first name.
 for(const field of [lead.contact_name,lead.name]){
  const first=explicitContactFirstName(field,lead.business);
  if(first)return first;
 }
 // Without a known person, only an explicit professional title in the business
 // label is enough to infer the given name. No generic first-word fallback.
 return titledPersonFirstName(lead.business);
}

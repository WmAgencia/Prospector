// Public offers mirror the Prospector landing prices. Days indicate the maximum
// number of approaches at the operational ceiling of 250/day; NOT a subscription
// or an automatic time expiry. Unused prepaid credits remain until consumed.
export const CREDIT_PACKAGES=Object.freeze([
 Object.freeze({id:'dia1',name:'1 dia de capacidade',credits:250,priceCents:990,referenceDays:1}),
 Object.freeze({id:'dias3',name:'3 dias de capacidade',credits:750,priceCents:2590,referenceDays:3}),
 Object.freeze({id:'dias7',name:'7 dias de capacidade',credits:1750,priceCents:5990,referenceDays:7}),
 Object.freeze({id:'dias14',name:'14 dias de capacidade',credits:3500,priceCents:10990,referenceDays:14}),
 Object.freeze({id:'dias30',name:'30 dias de capacidade',credits:7500,priceCents:21990,referenceDays:30})
]);
// Keep old plan identifiers valid for historical requests; do not offer them to new buyers.
export const LEGACY_PACKAGES=Object.freeze([
 Object.freeze({id:'essencial',name:'Essencial legado',credits:50,priceCents:490}),
 Object.freeze({id:'padrao',name:'Padrão legado',credits:250,priceCents:990}),
 Object.freeze({id:'pro',name:'Pro legado',credits:1000,priceCents:3490}),
 Object.freeze({id:'agencia',name:'Agência legado',credits:5000,priceCents:14990})
]);
export const getCreditPackage=id=>[...CREDIT_PACKAGES,...LEGACY_PACKAGES].find(p=>p.id===String(id||''))||null;

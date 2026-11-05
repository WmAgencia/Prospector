// Catalog for manually confirmed pay-as-you-go credit packages.
// These prices are offers, not payment processing instructions.
export const CREDIT_PACKAGES=Object.freeze([
 Object.freeze({id:'essencial',name:'Essencial',credits:50,priceCents:490}),
 Object.freeze({id:'padrao',name:'Padrão',credits:250,priceCents:990}),
 Object.freeze({id:'pro',name:'Pro',credits:1000,priceCents:3490}),
 Object.freeze({id:'agencia',name:'Agência',credits:5000,priceCents:14990})
]);
export const getCreditPackage=id=>CREDIT_PACKAGES.find(p=>p.id===String(id||''))||null;

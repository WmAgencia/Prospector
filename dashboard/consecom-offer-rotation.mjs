// A/B assignment for the approved Consecom offer. Ordinal is persisted in the offer ledger.
// A lead receives exactly one channel; missing audio must not be silently converted to text.
export function offerVariantForOrdinal(ordinal){
 if(!Number.isSafeInteger(ordinal)||ordinal<0)throw TypeError('Invalid offer assignment ordinal');
 return ordinal%2===0?'AUDIO':'TEXT';
}

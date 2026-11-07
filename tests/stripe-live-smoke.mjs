import {randomUUID} from 'node:crypto';
import {embeddedReady,embeddedCheckoutForRequest} from '../dashboard/stripe-billing.mjs';
// One-time operator smoke test. Creates an unpaid Stripe Checkout Session,
// without a customer or payment method; never confirms or charges a payment.
if(!embeddedReady()){
 console.error('[stripe smoke] Embedded checkout is not configured');
 process.exitCode=1;
}else{
 try{
  const result=await embeddedCheckoutForRequest({id:randomUUID(),package_id:'dia1'});
  if(!result?.clientSecret||!result?.publishableKey)throw Error('Missing embedded session');
  console.log('[stripe smoke] Embedded checkout session created; no payment taken');
 }catch(error){
  console.error('[stripe smoke] Stripe rejected session creation: '+String(error?.message||'unknown').slice(0,150));
  process.exitCode=1;
 }
}

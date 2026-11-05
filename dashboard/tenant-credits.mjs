import path from 'node:path';
import {openPlatformStore} from './platform-store.mjs';
let store;
const ledger=()=>store||=openPlatformStore(path.resolve(process.env.PROSPECTOR_PLATFORM_DIR));
export function reserveApproachCredit(reference){return !process.env.PROSPECTOR_TENANT_ID||ledger().reserve(process.env.PROSPECTOR_TENANT_ID,reference);}
export function settleApproachCredit(reference,accepted){if(process.env.PROSPECTOR_TENANT_ID)ledger().settle(process.env.PROSPECTOR_TENANT_ID,reference,accepted);}
export function availableApproachCredits(){return process.env.PROSPECTOR_TENANT_ID?ledger().publicClient(ledger().get(process.env.PROSPECTOR_TENANT_ID)).available:null;}

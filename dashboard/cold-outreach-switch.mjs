// Railway's one explicit master switch for initiating Consecom cold outreach.
// This switch never bypasses consent, opt-outs, sender availability or retries.
// Other customer tenants retain their independent owner controls.
export function coldOutreachSwitchEnabled({
 flag=process.env.PROSPECTOR_COLD_FIRST_APPROACH,
 tenantId=process.env.PROSPECTOR_TENANT_ID,
 internal=process.env.PROSPECTOR_TENANT_INTERNAL
}={}){
 if(tenantId&&internal!=='true')return true;
 return flag==='true';
}
export const COLD_OUTREACH_DISABLED_REASON='COLD_FIRST_APPROACH_DISABLED';

// Consecom's autonomous campaign state is derived from the Railway master switch,
// not from an older panel toggle. Tenant accounts keep their independent settings.
export function autonomousOutreachOperationalEnabled(legacyEnabled=false){
 const internal=!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true';
 return internal?coldOutreachSwitchEnabled():legacyEnabled===true;
}

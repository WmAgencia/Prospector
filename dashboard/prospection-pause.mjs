export const ownerProspectionPaused=()=>process.env.PROSPECTOR_FORCE_OUTREACH_PAUSE==='true'&&(!process.env.PROSPECTOR_TENANT_ID||process.env.PROSPECTOR_TENANT_INTERNAL==='true');

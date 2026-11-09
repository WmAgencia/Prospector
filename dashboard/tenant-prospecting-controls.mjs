// Operational preferences belong to the authenticated client's own SQLite workspace.
// No project-level Railway variable is changed when a client uses these controls.
import {getSetting,setSetting,audit} from './db.mjs';

export const PROSPECTING_CONTROL_KEYS=Object.freeze([
 'paused',
 'autonomous_outreach_enabled',
 'cold_first_approach_enabled'
]);

export function prospectingControls(){
 return {
  paused:getSetting('paused',true)===true,
  autonomous_outreach_enabled:getSetting('autonomous_outreach_enabled',false)===true,
  cold_first_approach_enabled:getSetting('cold_first_approach_enabled',false)===true
 };
}

export function coldFirstApproachEnabled(){
 return prospectingControls().cold_first_approach_enabled;
}

export function saveProspectingControl(key,value){
 if(!PROSPECTING_CONTROL_KEYS.includes(key))throw Error('Controle de prospecção desconhecido');
 if(typeof value!=='boolean')throw Error('O controle deve ser verdadeiro ou falso');
 const previous=getSetting(key,key==='paused');
 setSetting(key,value);
 audit('TENANT_PROSPECTING_CONTROL_CHANGED',null,{
  control:key,previous:previous===true,enabled:value,
  tenantScope:process.env.PROSPECTOR_TENANT_ID?'CLIENT_WORKSPACE':'PRIMARY_WORKSPACE'
 });
 return prospectingControls();
}

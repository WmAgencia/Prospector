// Explicit QA contact exclusion, configured per deployment.
// No chat history is deleted, and no owner privileges are changed.
const digits=value=>String(value||'').replace(/\D/g,'');
export const excludedTestPhone=()=>{
 const number=digits(process.env.PROSPECTOR_TEST_CONTACT_PHONE);
 return /^55\d{10,11}$/.test(number)?number:'';
};
export function isExcludedTestContact(value){
 const excluded=excludedTestPhone();
 return !!excluded&&digits(value)===excluded;
}
export const excludedTestPhoneSql=alias=>{
 const number=excludedTestPhone();
 return number?" AND "+alias+".phone<>'"+number+"'":'';
};

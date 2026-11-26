// Persistent independent A/B assignment for each WhatsApp sender.
// Each greeting is assigned at most once, including across process restarts.
// A reserved attempt is counted even if delivery is uncertain: never retry it.
export const WESLEY_INTRO='Meu nome é Wesley, sou dono da agência Consecom. Eu tô entrando em contato porque queria fazer uma proposta pra vocês. Posso te mandar um áudio explicando a ideia?';
export const WESLEY_INTRO_B='Meu nome é Wesley, sou da Consecom. Eu estou entrando em contato porque estamos selecionando algumas empresas para fazer um trabalho com a gente, e eu queria fazer uma proposta pra vocês. Posso te mandar um áudio explicando a ideia?';
export function initIntroAB(db){
 db.exec("CREATE TABLE IF NOT EXISTS prospector_intro_ab(greeting_id TEXT PRIMARY KEY,session_id TEXT NOT NULL,variant TEXT NOT NULL CHECK(variant IN ('A','B')),message TEXT NOT NULL,assigned_at TEXT NOT NULL)");
 db.exec("CREATE INDEX IF NOT EXISTS idx_intro_ab_session ON prospector_intro_ab(session_id)");
}
export function reserveIntroAB(db,{greetingId,sessionId,enabled=true,at=new Date().toISOString()}){
 if(!greetingId||!sessionId)throw Error('Missing introduction identity');
 db.exec('BEGIN IMMEDIATE');
 try{
  let row=db.prepare('SELECT * FROM prospector_intro_ab WHERE greeting_id=?').get(greetingId);
  if(row&&row.session_id!==sessionId)throw Error('Introduction session mismatch');
  if(!row){
   const count=db.prepare('SELECT COUNT(*) n FROM prospector_intro_ab WHERE session_id=?').get(sessionId).n;
   const variant=enabled&&count%2===1?'B':'A';
   const message=variant==='B'?WESLEY_INTRO_B:WESLEY_INTRO;
   db.prepare('INSERT INTO prospector_intro_ab(greeting_id,session_id,variant,message,assigned_at) VALUES(?,?,?,?,?)').run(greetingId,sessionId,variant,message,at);
   row={session_id:sessionId,variant,message};
  }
  db.exec('COMMIT');return {variant:row.variant,message:row.message};
 }catch(e){db.exec('ROLLBACK');throw e;}
}

// Only explicit Japanese units are accepted. Never infer whether a bare number is seconds.
export function durationMinutes(text) {
  if(typeof text!=='string'||text.length>80)throw Error('invalid-duration');
  const s=text.normalize('NFKC').replace(/\s+/g,'');
  const m=/^(?:(\d+)時間)?(?:(\d+)分)?(?:(\d+)秒)?$/.exec(s);
  if(!m||!m.slice(1).some(Boolean))throw Error('invalid-duration');
  const seconds=Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0);
  if(seconds<=0||seconds>86400)throw Error('invalid-duration');
  return Math.ceil(seconds/60);
}
export class LocalImport {
  constructor({storage,key,now=Date.now}){Object.assign(this,{storage,key,now});}
  load(){try{return JSON.parse(this.storage.getItem(this.key)||'{}')}catch{return {}}}
  save(value){this.storage.setItem(this.key,JSON.stringify(value));}
  begin(scope){this.save({...this.load(),pending:{scope,at:this.now()}});}
  accept(text,scope,confirmed){
    const data=this.load(),p=data.pending,t=this.now();
    if(!confirmed)throw Error('confirmation-required');
    if(!p||JSON.stringify(p.scope)!==JSON.stringify(scope))throw Error('changed-context');
    if(t<p.at||t-p.at>300000)throw Error('expired-request');
    const minutes=durationMinutes(text);
    this.save({result:{scope,minutes,at:p.at,importedAt:t,source:'user_pasted_apple_estimate'}});
    return minutes;
  }
  read(scope){
    const r=this.load().result,t=this.now();
    if(!r||JSON.stringify(r.scope)!==JSON.stringify(scope)||t<r.at||t-r.at>300000)return null;
    if(!Number.isFinite(r.minutes)||r.minutes<=0||r.minutes>1440)return null;
    return r;
  }
  cancel(){this.save({});}
}

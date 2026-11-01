/* iPhoneだけで電車の時間を取る。ショートカット「逆算・交通時間」が Apple の「移動時間を取得（交通機関）」で
   時間を出してクリップボードに入れる → このアプリに戻って1回押すと取り込む。
   端末の中（localStorage）だけに置く。Mac・同期の棚・共有の要約には送らない。 */
import {durationMinutes} from './shortcut-duration.mjs';

export const FRESH_MS=30*60000, STALE_MS=12*3600000, PENDING_MS=5*60000, ORIGIN_KM=0.3;
export const SHORTCUT_NAME='逆算・交通時間';
export const CLIP_MARK='逆算：交通時間を待っています';
const km=(a,b)=>{const R=6371,r=Math.PI/180,dLa=(b.lat-a.lat)*r,dLo=(b.lng-a.lng)*r;
  const h=Math.sin(dLa/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dLo/2)**2;return 2*R*Math.asin(Math.sqrt(h))};
const pt=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180;
/* 同じ予定・同じ時刻・同じ行先・同じ手段のときだけ同じ「対象」 */
export function sameTarget(x,y){
  return !!x&&!!y&&x.eventId===y.eventId&&x.arriveAt===y.arriveAt&&x.mode===y.mode&&(x.addr||'')===(y.addr||'')
    &&Math.abs(x.destination.lat-y.destination.lat)<1e-6&&Math.abs(x.destination.lng-y.destination.lng)<1e-6;
}
/* ショートカットに渡す行き先の文字。どの形が「移動時間を取得」の目的地として通るかは実機で選ぶ */
export function destinationText(target,format,label){
  const {lat,lng}=target.destination;
  if(format==='latlng')return lat+','+lng;
  if(format==='addr')return target.addr||label||(lat+','+lng);
  return 'https://maps.apple.com/?ll='+lat+','+lng+(label?'&q='+encodeURIComponent(label):'');
}
/* 戻ってきた文字 → 分。「1時間23分」などの単位つきか、昔の返却形式（#gyakusanETA= / JSON）だけ受ける */
export function parseReturn(text,nonce){
  if(typeof text!=='string')throw Error('empty');
  const s=text.trim();
  if(!s||s===CLIP_MARK)throw Error('not-returned');
  if(s.startsWith('#gyakusanETA=')||s.startsWith('{')){
    let r;try{r=JSON.parse(s.startsWith('{')?s:decodeURIComponent(s.slice(13)))}catch{throw Error('invalid-return')}
    if(r.v!==1||r.nonce!==nonce)throw Error('unmatched-return');
    if(r.durationText!==undefined&&r.seconds!==undefined)throw Error('ambiguous-duration');
    if(r.durationText!==undefined)return durationMinutes(r.durationText);
    if(typeof r.seconds!=='number'||!Number.isFinite(r.seconds)||r.seconds<=0||r.seconds>86400)throw Error('invalid-duration');
    return Math.ceil(r.seconds/60);
  }
  return durationMinutes(s.split('\n')[0]);
}
export class DeviceRoutes{
  constructor({storage,key,now=Date.now,nonce=()=>crypto.randomUUID()}){Object.assign(this,{storage,key,now,nonce});}
  load(){try{const d=JSON.parse(this.storage.getItem(this.key)||'{}');return d&&typeof d==='object'?d:{}}catch{return {}}}
  save(d){this.storage.setItem(this.key,JSON.stringify(d));}
  begin(target,origin,{cleared=false}={}){
    if(!target||!target.eventId||!Number.isFinite(target.arriveAt)||!pt(target.destination))throw Error('invalid-target');
    if(!pt(origin))throw Error('invalid-origin');
    const d=this.load(),p={nonce:this.nonce(),at:this.now(),target:structuredClone(target),origin:{lat:origin.lat,lng:origin.lng},cleared};
    d.pending=p;this.save(d);return p;
  }
  pending(){const p=this.load().pending,t=this.now();return p&&t>=p.at&&t-p.at<=PENDING_MS?p:null}
  cancel(){const d=this.load();delete d.pending;this.save(d);}
  /* target は「いま」の予定から作り直したもの。準備したときと違えば拒否 */
  accept(text,target){
    const d=this.load(),p=d.pending,t=this.now();
    if(!p)throw Error('no-request');
    if(t<p.at||t-p.at>PENDING_MS){delete d.pending;this.save(d);throw Error('expired-request')}
    if(!sameTarget(p.target,target)){delete d.pending;this.save(d);throw Error('changed-context')}
    const minutes=parseReturn(text,p.nonce);
    if(minutes<1||minutes>1440)throw Error('invalid-duration');
    const results=d.results||{};
    results[p.target.eventId]={target:p.target,origin:p.origin,minutes,got:p.at,importedAt:t};
    for(const k of Object.keys(results))if(!(t-results[k].got<=STALE_MS))delete results[k];
    delete d.pending;d.results=results;this.save(d);
    return results[p.target.eventId];
  }
  /* from＝いま計算に使っている出発点。300m以上ずれていたら使わない。30分過ぎたら stale（12時間で捨てる） */
  read(target,from){
    const r=(this.load().results||{})[target&&target.eventId],t=this.now();
    if(!r||!sameTarget(r.target,target)||!pt(from)||!pt(r.origin))return null;
    if(!Number.isInteger(r.minutes)||r.minutes<1||r.minutes>1440)return null;
    const age=t-r.got;if(age< -60000||age>STALE_MS)return null;
    if(km(from,r.origin)>ORIGIN_KM)return null;
    return {min:r.minutes,got:r.got,stale:age>FRESH_MS};
  }
  last(eventId){return (this.load().results||{})[eventId]||null}
  clear(){this.save({});}
}

/* 設定の下の折り畳み。主画面のボタン（index.html）からも同じ DeviceRoutes を使う */
export function mountTransitPanel({host,accountIdentity,readTarget,targetFor,onReady,onChange=()=>{}}){
  const root=document.createElement('details');
  root.innerHTML='<summary>iPhoneの交通時間（この端末だけ）</summary>'
    +'<p class="tiny">約束カードの「📍 iPhoneで電車の時間を取る」→ ショートカット「'+SHORTCUT_NAME+'」が動く → このアプリに戻って「📋 取ってきた時間を入れる」。結果はこの端末の中だけ。Mac・共有の要約・ウィジェットには送りません。</p>'
    +'<label><input type="checkbox" data-enable> この端末の主カウントダウンに使う</label>'
    +'<p class="tiny" style="margin-top:8px">ショートカットに渡す行き先の形（目的地にならないときだけ変える）</p>'
    +'<select data-format><option value="maps">Appleマップのリンク</option><option value="latlng">緯度,経度</option><option value="addr">住所・名前の文字</option></select>'
    +'<p class="tiny" data-last style="margin-top:8px"></p>'
    +'<p class="tiny">戻っても取り込めないとき（Safariで開いた等）：ショートカットが出した時間をここに貼る</p>'
    +'<input data-duration placeholder="例：1時間23分" aria-label="Appleの移動時間"> '
    +'<button class="btn sec" data-import>取り込む</button> <button class="btn sec" data-clear>この端末の結果を消す</button>'
    +'<p data-message role="status" class="tiny"></p>';
  host.append(root);
  const q=s=>root.querySelector(s),msg=q('[data-message]');
  accountIdentity().then(id=>{
    const routes=new DeviceRoutes({storage:localStorage,key:'gyakusan.iphone-routes.v2:'+id});
    const enKey='gyakusan.iphone-enabled:'+id,fmKey='gyakusan.iphone-destfmt';
    const api={routes,
      enabled:()=>localStorage.getItem(enKey)==='true',
      format:()=>localStorage.getItem(fmKey)||'maps',
      /* 取り込むのは「📍を押した予定」。いまの一番上の予定が入れ替わっていても、その予定に戻す */
      paste:text=>{const p=routes.load().pending;if(!p)throw Error('no-request');return routes.accept(text,targetFor(p.target.eventId))},
      refresh};
    q('[data-enable]').checked=api.enabled();
    q('[data-format]').value=api.format();
    q('[data-enable]').onchange=()=>{localStorage.setItem(enKey,String(q('[data-enable]').checked));onChange()};
    q('[data-format]').onchange=()=>localStorage.setItem(fmKey,q('[data-format]').value);
    q('[data-import]').onclick=()=>{try{const r=api.paste(q('[data-duration]').value);q('[data-duration]').value='';
      msg.textContent='取り込みました：'+r.minutes+'分';onChange();refresh()}catch(e){msg.textContent='取り込めません：'+e.message}};
    q('[data-clear]').onclick=()=>{routes.clear();msg.textContent='消しました';onChange();refresh()};
    function refresh(){
      const tg=readTarget(),r=tg&&routes.last(tg.eventId);
      q('[data-last]').textContent=r?'いまの約束：iPhoneで取った '+r.minutes+'分（'+Math.max(0,Math.floor((Date.now()-r.got)/60000))+'分前）':'いまの約束：iPhoneの結果はまだありません';
    }
    root.addEventListener('toggle',()=>{if(root.open)refresh()});
    /* 昔の返却形式（URLの #gyakusanETA=）で戻ってきたとき */
    if(location.hash.startsWith('#gyakusanETA=')){
      const h=location.hash;try{history.replaceState(null,'',location.pathname+location.search)}catch{}
      try{const r=api.paste(h);msg.textContent='取り込みました：'+r.minutes+'分'}catch(e){root.open=true;q('[data-duration]').value=h;msg.textContent='取り込めません：'+e.message}
    }
    onReady(api);refresh();
  });
}

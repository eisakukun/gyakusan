/* iPhoneだけで取った電車の時間まわり。
   いまの主な道：ショートカット「逆算・自動取得」が同期の棚の iPhone 専用の置き場（iroutes）に置く → index.html が読む。
   DeviceRoutes / parseReturn は、端末の中だけに置く古い取り込み方（照合の決まりごとはテストつきで残す）。
   下の折り畳みは、オン／オフと、ショートカット・ウィジェット用のコピーだけ。 */
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
export function mountTransitPanel({host,accountIdentity,inextURL=()=>'',onReady,onChange=()=>{}}){
  const root=document.createElement('details');
  root.innerHTML='<summary>iPhoneの交通時間（この端末だけ）</summary>'
    +'<p class="tiny">ショートカット「逆算・自動取得」が、決めた時刻（と 📍 を押したとき）に、次の約束までの電車の時間をこのiPhoneで取って同期の棚のiPhone専用の置き場に置きます。Macの時間とは別なので上書きし合いません。</p>'
    +'<label><input type="checkbox" data-enable> この端末の主カウントダウンに使う</label>'
    +'<p class="tiny" style="margin-top:10px">ショートカットの最初の「URL」に貼るもの（同期の合言葉入り。人に渡さない）</p>'
    +'<button class="btn sec" data-inext>自動取得用のURLをコピー</button>'
    +'<p class="tiny" style="margin-top:10px">ホーム画面のウィジェット（Scriptable）を新しくするとき</p>'
    +'<button class="btn sec" data-widget>ウィジェット用のコードをコピー</button>'
    +'<p data-message role="status" class="tiny"></p>';
  host.append(root);
  const q=s=>root.querySelector(s),msg=q('[data-message]');
  accountIdentity().then(id=>{
    const routes=new DeviceRoutes({storage:localStorage,key:'gyakusan.iphone-routes.v2:'+id});
    const enKey='gyakusan.iphone-enabled:'+id;
    const api={routes,enabled:()=>localStorage.getItem(enKey)==='true'};
    q('[data-enable]').checked=api.enabled();
    q('[data-enable]').onchange=()=>{localStorage.setItem(enKey,String(q('[data-enable]').checked));onChange()};
    q('[data-inext]').onclick=async()=>{const u=inextURL();if(!u){msg.textContent='先に同期の合言葉を入れてください';return}
      try{await navigator.clipboard.writeText(u);msg.textContent='コピーしました。ショートカットの「URL」に貼ってください'}catch{msg.textContent='コピーできませんでした'}};
    /* iPhoneのSafariは「押した直後」でないとコピーできないので、読み込みを待つ形（ClipboardItem）で渡す */
    q('[data-widget]').onclick=async()=>{
      const code=()=>fetch('widget/'+encodeURIComponent('逆算・自由時間')+'.js?t='+Date.now(),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('fetch');return r.text()});
      try{
        if(window.ClipboardItem&&navigator.clipboard.write)
          await navigator.clipboard.write([new ClipboardItem({'text/plain':code().then(t=>new Blob([t],{type:'text/plain'}))})]);
        else await navigator.clipboard.writeText(await code());
        msg.textContent='コピーしました。Scriptableの「逆算・自由時間」を開いて、中身を全部消してから貼ってください';
      }catch{msg.textContent='コピーできませんでした（通信を確認）'}
    };
    onReady(api);
  });
}

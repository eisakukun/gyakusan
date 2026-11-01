// node test/widget-iroutes.test.cjs
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const src=fs.readFileSync(path.join(__dirname,'../widget/逆算・自由時間.js'),'utf8').split('// Runs only inside Scriptable.')[0];
const m={exports:{}};new Function('module',src)(m);const {calculate}=m.exports;
const now=Date.parse('2026-10-29T12:00:00+09:00'),at=now+3*3600000;
function fx(ir){return [{ok:true,updatedAt:now,iroutes:ir,summary:{v:1,genAt:now,buffer:10,items:[{id:'a',title:'F',at,hasPlace:true,lat:35.6595,lng:139.7005,mode:'train',
  toAnchor:57,leaveAt:at-67*60000,work:20,subs:[]}]}},{ok:true,updatedAt:now,state:{updatedAt:now,anchors:[{id:'a',at:new Date(at).toISOString(),subs:[]}],sleepH:7,sleepBufH:1}}];}
const r0={min:88,at,tlat:35.6595,tlng:139.7005,flat:35.68,flng:139.76,got:now-20*60000};
const run=r=>calculate(...fx(r?{routes:{a:r}}:null),now);
let n=0;const t=(name,f)=>{f();n++;console.log('PASS '+name)};
t('iroutes無しは従来どおり（57分）',()=>{const r=run(null);assert.equal(r.travel,57);assert.equal(r.iphoneRoute,null)});
t('iPhoneの88分を使う',()=>{const r=run(r0);assert.equal(r.travel,88);assert.equal(r.freeMinutes,180-20-88-10)});
t('予定時刻が違えば使わない',()=>assert.equal(run({...r0,at:at+60000}).travel,57));
t('行き先が違えば使わない',()=>assert.equal(run({...r0,tlat:35.7}).travel,57));
t('3時間より古ければ使わない',()=>assert.equal(run({...r0,got:now-181*60000}).travel,57));
t('壊れた値は使わない',()=>{for(const min of [0,NaN,'88',2000])assert.equal(run({...r0,min}).travel,57)});
t('寄り道があれば使わない',()=>{const p=fx({routes:{a:r0}});p[0].summary.items[0].via={lat:1,lng:1};assert.equal(calculate(...p,now).travel,57)});
console.log(n+' tests passed');

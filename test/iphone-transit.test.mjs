import test from 'node:test';import assert from 'node:assert/strict';
import {DeviceRoutes,parseReturn,destinationText,CLIP_MARK,FRESH_MS,STALE_MS,PENDING_MS} from '../iphone-transit.mjs';
const T0=1_800_000_000_000;
const tg=(x={})=>({eventId:'ev1',arriveAt:T0+5*3600e3,destination:{lat:35.6595,lng:139.7005},mode:'train',addr:'カスティル渋谷',...x});
const here={lat:35.70,lng:139.60};
function setup(){const m=new Map();let now=T0;const storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};
  const r=new DeviceRoutes({storage,key:'k',now:()=>now,nonce:()=>'n1'});return {r,storage,tick:ms=>{now+=ms},set:t=>{now=t}};}

test('1時間23分 → 83分、主表示用に読める',()=>{const {r,tick}=setup();r.begin(tg(),here,{cleared:true});tick(60e3);
  assert.equal(r.accept('1時間23分',tg()).minutes,83);const x=r.read(tg(),here);assert.equal(x.min,83);assert.equal(x.stale,false);});
test('単位の無い数字・英語・時刻表記は受けない（秒か分か推測しない）',()=>{for(const s of ['83','4980','1:23','1 hr 23 min','約1時間'])assert.throws(()=>parseReturn(s,'n1'),/invalid-duration/);});
test('分だけ・秒つきも受ける',()=>{assert.equal(parseReturn('45分','n'),45);assert.equal(parseReturn('1時間','n'),60);assert.equal(parseReturn('1時間2分30秒','n'),63);});
test('クリップボードがまだ「待っています」なら取り込まない',()=>{const {r}=setup();r.begin(tg(),here);assert.throws(()=>r.accept(CLIP_MARK,tg()),/not-returned/);});
test('5分過ぎ・時計の逆行は拒否',()=>{for(const d of [PENDING_MS+1,-1]){const {r,tick}=setup();r.begin(tg(),here);tick(d);assert.throws(()=>r.accept('1時間',tg()),/expired/);}});
test('予定の時刻・行先・手段・住所が変わったら拒否',()=>{for(const ch of [{arriveAt:T0+1},{destination:{lat:35.66,lng:139.7005}},{mode:'walk'},{addr:'別'},{eventId:'ev2'}]){
  const {r}=setup();r.begin(tg(),here);assert.throws(()=>r.accept('1時間',tg(ch)),/changed/);}});
test('予定が消えた（target null）も拒否',()=>{const {r}=setup();r.begin(tg(),here);assert.throws(()=>r.accept('1時間',null),/changed/);});
test('二重取り込みは2回目が拒否（一度きり）',()=>{const {r}=setup();r.begin(tg(),here);r.accept('1時間',tg());assert.throws(()=>r.accept('2時間',tg()),/no-request/);assert.equal(r.read(tg(),here).min,60);});
test('失敗した取り込みは前の有効値を上書きしない',()=>{const {r}=setup();r.begin(tg(),here);r.accept('1時間23分',tg());r.begin(tg(),here);assert.throws(()=>r.accept('83',tg()));assert.equal(r.read(tg(),here).min,83);});
test('別の予定の結果は使わない',()=>{const {r}=setup();r.begin(tg(),here);r.accept('1時間',tg());assert.equal(r.read(tg({eventId:'ev2'}),here),null);assert.equal(r.read(tg({arriveAt:T0+9}),here),null);});
test('出発点が300m超ずれたら使わない／近ければ使う',()=>{const {r}=setup();r.begin(tg(),here);r.accept('1時間',tg());
  assert.equal(r.read(tg(),{lat:here.lat+0.004,lng:here.lng}),null);assert.ok(r.read(tg(),{lat:here.lat+0.001,lng:here.lng}));});
test('30分でstale、12時間で消える',()=>{const {r,tick}=setup();r.begin(tg(),here);r.accept('1時間',tg());tick(FRESH_MS+1);assert.equal(r.read(tg(),here).stale,true);tick(STALE_MS);assert.equal(r.read(tg(),here),null);});
test('再読み込み（別インスタンス）でも保持',()=>{const {r,storage}=setup();r.begin(tg(),here);r.accept('1時間',tg());
  assert.equal(new DeviceRoutes({storage,key:'k',now:()=>T0+1000}).read(tg(),here).min,60);});
test('昔の返却形式 #gyakusanETA= は nonce 一致のときだけ',()=>{const enc=o=>'#gyakusanETA='+encodeURIComponent(JSON.stringify(o));
  assert.equal(parseReturn(enc({v:1,nonce:'n1',durationText:'1時間23分'}),'n1'),83);
  assert.throws(()=>parseReturn(enc({v:1,nonce:'x',durationText:'1時間'}),'n1'),/unmatched/);
  assert.throws(()=>parseReturn(enc({v:1,nonce:'n1',durationText:'1時間',seconds:3600}),'n1'),/ambiguous/);});
test('壊れた保存データでも落ちない',()=>{const {r,storage}=setup();storage.setItem('k','{壊れ');assert.equal(r.read(tg(),here),null);r.begin(tg(),here);assert.ok(r.pending());});
test('行き先の文字の3形式',()=>{assert.equal(destinationText(tg(),'latlng'),'35.6595,139.7005');assert.equal(destinationText(tg(),'addr'),'カスティル渋谷');
  assert.equal(destinationText(tg(),'maps','カスティル渋谷'),'https://maps.apple.com/?ll=35.6595,139.7005&q=%E3%82%AB%E3%82%B9%E3%83%86%E3%82%A3%E3%83%AB%E6%B8%8B%E8%B0%B7');});
test('GPSが無い・壊れた座標では準備しない',()=>{const {r}=setup();assert.throws(()=>r.begin(tg(),null),/origin/);assert.throws(()=>r.begin(tg(),{lat:NaN,lng:1}),/origin/);});

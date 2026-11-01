// Scriptable large Home Screen widget. Read-only existing GAS sync.
// v2 (2026-11-01): iPhoneのショートカットが自分で取った電車の時間（iroutes）があれば、それを最終移動に使う。
'use strict';
// Numeric times are Unix milliseconds. Date-only/local strings never enter this model.
const MINUTE = 60000, DAY = 86400000;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const minutes = n => finite(n) && n >= 0;
function nightsJST(from, to) {
  // Match the app's 05:00 boundary, explicitly in Japan even on a travelling phone.
  const shift = 4 * 3600000; // UTC +09 minus 05:00
  return Math.max(0, Math.floor((to + shift) / DAY) - Math.floor((from + shift) / DAY));
}
function hasPlace(s) { return !!((s.addr && String(s.addr).trim()) || s.travelMin != null || s.lat != null); }
function anchorTime(at) {
  if (finite(at)) return at;
  if (typeof at !== 'string') return NaN;
  // Web datetime-local values belong to the existing Japan schedule, not the phone's roaming timezone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(at)) return Date.parse(at+'+09:00');
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(at) ? Date.parse(at) : NaN;
}
function calculate(summaryResponse, stateResponse, now = Date.now()) {
  const fail = (status, detail) => ({status, detail, calculatedAt: now});
  if (!summaryResponse || !stateResponse || summaryResponse.ok !== true || stateResponse.ok !== true)
    return fail('invalid', '読み取りに失敗');
  const s = summaryResponse.summary, state = stateResponse.state;
  if (!s || !state || s.v !== 1 || !Array.isArray(s.items) || !Array.isArray(state.anchors))
    return fail('invalid', '同期データを確認してください');
  if (!finite(summaryResponse.updatedAt) || summaryResponse.updatedAt !== stateResponse.updatedAt ||
      state.updatedAt !== stateResponse.updatedAt)
    return fail('mismatch', '同期中です。もう一度更新');
  if (!finite(s.genAt) || s.genAt <= 0 || s.genAt > now + MINUTE || !finite(now))
    return fail('invalid', '端末時刻・同期時刻を確認');
  const age = now - s.genAt;
  if (age > 6 * 60 * MINUTE) return {...fail('expired', '6時間以上前の要約。逆算アプリで同期'), sourceAt:s.genAt};
  if (s.items.some(a => !a || !finite(a.at))) return fail('invalid', '予定時刻が不正');
  const future = s.items.filter(a => a.at > now).sort((a,b) => a.at-b.at);
  let a = future[0];
  if (!a) return {...fail('empty', '次の予定なし／逆算アプリで同期'), sourceAt:s.genAt};
  // A stale summary must never skip an earlier appointment that exists in state.
  const earlier = state.anchors.some(x => !x.soft && finite(anchorTime(x.at)) && anchorTime(x.at)>now && anchorTime(x.at)<a.at);
  if (earlier) return fail('mismatch', '予定の要約を更新してください');
  // iPhoneのショートカットが自分で取った電車の時間。同じ予定・時刻・行き先で、途中の寄り道が無く、3時間以内のときだけ
  const ir = summaryResponse.iroutes && summaryResponse.iroutes.routes && summaryResponse.iroutes.routes[a.id];
  const own = ir && !a.via && (a.mode || 'train') === 'train' && finite(ir.min) && ir.min >= 1 && ir.min <= 1440 &&
    finite(ir.at) && Math.abs(ir.at - a.at) <= 1000 && finite(a.lat) && finite(a.lng) &&
    Math.abs(ir.tlat - a.lat) <= 1e-4 && Math.abs(ir.tlng - a.lng) <= 1e-4 &&
    finite(ir.got) && now - ir.got >= -MINUTE && now - ir.got <= 3 * 60 * MINUTE ? ir : null;
  if (own) a = {...a, toAnchor: own.min};
  if (![a.work,a.toAnchor,s.buffer].every(minutes) || !Array.isArray(a.subs) ||
      a.subs.some(x => !x || !minutes(x.min))) return fail('invalid', '所要時間が不正');
  if (a.hasPlace && !own && (!finite(a.leaveAt) || Math.abs(a.leaveAt-(a.at-(a.toAnchor+s.buffer)*MINUTE))>2*MINUTE))
    return {...fail('route', '目的地への移動時間が不明'), sourceAt:s.genAt};
  const original = state.anchors.find(x => x.id === a.id);
  const active = original && (original.subs || []).filter(x => !x.done && x.on !== false);
  // Optional producer patch proves intermediate-route completeness. V1 is deliberately conservative.
  if (s.widgetV === 1) {
    if (a.routeUnknown !== false) return {...fail('route', '途中の移動時間が不明'), sourceAt:s.genAt};
  } else if (a.subs.length && (!active || active.length !== a.subs.length || active.some(x => hasPlace(x) && !minutes(x.travelMin)))) {
    return {...fail('route', '途中の移動を確認／手入力の移動分が必要'), sourceAt:s.genAt};
  }
  if (!minutes(state.sleepH) || !minutes(state.sleepBufH)) return fail('invalid', '睡眠設定を確認');
  // Keep the source snapshot's reserve across 05:00; elapsed time alone is not proof of sleep.
  const nights = nightsJST(s.genAt, a.at);
  const sleepHours = Math.max(7, state.sleepH);
  const sleep = nights * (sleepHours*60 + state.sleepBufH*60);
  const remaining = (a.at-now)/MINUTE;
  const free = remaining-a.work-a.toAnchor-s.buffer-sleep;
  return {status:'ok', title:String(a.title || '次の予定'), at:a.at, sourceAt:s.genAt,
    calculatedAt:now, stale:age>15*MINUTE, freeMinutes:free, work:a.work,
    travel:a.toAnchor, buffer:s.buffer, sleep, nights, sleepHours,
    sleepBuffer:state.sleepBufH*60, locationBased:!!a.hasPlace || !!a.subs.length,
    iphoneRoute: own ? {got: own.got} : null,
    sleepOverride:state.sleepOn===false || state.sleepH<7};
}
function duration(n) {
  const m = Math.max(0, Math.floor(Math.abs(n)));
  return `${Math.floor(m/60)}時間${String(m%60).padStart(2,'0')}分`;
}
if (typeof module !== 'undefined') module.exports = {calculate,nightsJST,duration};

// Runs only inside Scriptable. No key, endpoint, or personal schedule is bundled.
const CREDENTIAL = 'gyakusan.widget.existing-sync';
const fm = FileManager.local();
const cacheFile = fm.joinPath(fm.documentsDirectory(), 'gyakusan-widget-cache-v1.json');
async function setup() {
  const alert = new Alert();
  alert.title = '逆算の既存同期に接続';
  alert.message = '既存のGAS URLと同期キーを入力。読み取り専用です。保存するとこのiPhoneのScriptableが継続して予定を読めます。新しいキーは作りません。';
  alert.addTextField('https://script.google.com/macros/s/…/exec');
  alert.addSecureTextField('逆算の既存の同期キー');
  alert.addAction('このiPhoneに保存して接続'); alert.addCancelAction('キャンセル');
  if (await alert.presentAlert() < 0) return null;
  const endpoint=alert.textFieldValue(0).trim(), key=alert.textFieldValue(1).trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint) || !key)
    throw new Error('configuration');
  const credential={endpoint,key};
  Keychain.set(CREDENTIAL,JSON.stringify(credential));
  // Do not reuse another account/configuration's cached schedule.
  if(fm.fileExists(cacheFile)) fm.remove(cacheFile);
  return credential;
}
async function fetchPair(c) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.endpoint) || !c.key) throw new Error('configuration');
  async function read(op) {
    const r=new Request(c.endpoint+'?op='+op+'&have=0&key='+encodeURIComponent(c.key));
    r.timeoutInterval=12;
    const j=await r.loadJSON();
    if (!j || j.ok !== true) throw new Error('read');
    return j;
  }
  for(let retry=0;retry<2;retry++) {
    const [summary,state]=await Promise.all([read('summary'),read('get')]);
    if(summary.updatedAt===state.updatedAt && state.state && state.state.updatedAt===state.updatedAt)
      return {summary,state,fetchedAt:Date.now()};
  }
  throw new Error('mismatch');
}
function jst(t) {
  const d=new Date(t+9*3600000);
  return `${d.getUTCMonth()+1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}
async function main() {
  let pair=null,offline=false,credential=null,error='';
  try {
    if(config.runsInApp && args.widgetParameter==='reset') {
      if(Keychain.contains(CREDENTIAL)) Keychain.remove(CREDENTIAL);
      if(fm.fileExists(cacheFile)) fm.remove(cacheFile);
    }
    credential=Keychain.contains(CREDENTIAL)?JSON.parse(Keychain.get(CREDENTIAL)):null;
    if(!credential && config.runsInApp) credential=await setup();
    if(credential) {
      try {
        pair=await fetchPair(credential);
        // Cache only when the model validates the response shape. Route/empty are valid states.
        const checked=calculate(pair.summary,pair.state);
        if(['invalid','mismatch'].includes(checked.status)) throw new Error('data');
        fm.writeString(cacheFile,JSON.stringify(pair));
      } catch(e) {
        offline=true;
        if(fm.fileExists(cacheFile)) pair=JSON.parse(fm.readString(cacheFile));
        error='通信・認証失敗';
      }
    }
  } catch(e) { error='設定または保存データを確認'; }
  const now=Date.now();
  const result=pair?calculate(pair.summary,pair.state,now):{status:'setup',detail:error||'Scriptableで一度実行して接続'};
  const w=new ListWidget();
  w.setPadding(20,20,18,20);
  const gradient=new LinearGradient();
  gradient.colors=[new Color('142D36'),new Color('101923')]; gradient.locations=[0,1];
  w.backgroundGradient=gradient;
  w.url=URLScheme.forRunningScript();
  // A requested earliest refresh, never a guarantee or a real-time countdown.
  w.refreshAfterDate=new Date(now+15*60000);
  function line(text,size=12,color='A9BDC6',bold=false) {
    const t=w.addText(text); t.font=bold?Font.boldSystemFont(size):Font.systemFont(size);
    t.textColor=new Color(color); t.minimumScaleFactor=0.65; t.lineLimit=2; return t;
  }
  line('逆算  /  次の予定までの自由時間',13,'BBD2DB',true); w.addSpacer(8);
  if(result.status==='ok') {
    const negative=result.freeMinutes<0;
    line(negative?'自由時間なし':'自由時間の目安',12,'A9BDC6');
    line(negative?`${duration(Math.ceil(-result.freeMinutes))}不足`:duration(result.freeMinutes),36,negative?'FFA69C':'A9F1D5',true);
    w.addSpacer(10);
    line(`${jst(result.at)}  ${result.title}`,15,'F0F6F7',true);
    line(`作業・途中移動 ${duration(result.work)}  ／ 最終移動 ${duration(result.travel)}`,11);
    line(`到着余裕 ${duration(result.buffer)}  ／ 睡眠 ${result.nights}晩 × ${result.sleepHours}時間`,11);
    if(result.nights) line(`起床後余裕 ${duration(result.sleepBuffer)} × ${result.nights}晩を確保`,11);
    if(result.iphoneRoute) line(`移動はこのiPhoneでApple地図から取得（${Math.max(0,Math.floor((now-result.iphoneRoute.got)/60000))}分前）`,10,'A9F1D5');
    else if(result.locationBased) line('移動は同期元の場所基準。移動後は逆算で同期',10,'E5C88D');
    if(result.sleepOverride) line('睡眠OFF・7時間未満の設定は使わず7時間確保',10,'E5C88D');
    if(result.nights) line('睡眠は予約枠。実際に寝た時間は未計測',10);
  } else {
    line(result.status==='route'?'移動時間が不明':result.status==='expired'?'同期を更新':'自由時間 —',29,'E5C88D',true);
    w.addSpacer(10); line(result.detail,14,'F0F6F7');
  }
  w.addSpacer();
  line(offline?'オフライン／通信・認証失敗・保存データ':result.stale?'要約が15分以上前・古い情報':'読み取り専用',10,offline||result.stale?'E5C88D':'A9BDC6');
  if(result.sourceAt) line(`要約 ${jst(result.sourceAt)} JST`,10);
  line(`計算 ${jst(now)} JST ・タップで再取得`,10);
  line('表示値は更新時点。iOSが次の更新時刻を決定',9);
  Script.setWidget(w);
  if(config.runsInApp) await w.presentLarge();
  Script.complete();
}
await main();

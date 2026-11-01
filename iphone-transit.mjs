import {LocalImport} from './shortcut-duration.mjs';
import {ShortcutReturn} from './shortcut-return.mjs';
export function mountTransitPanel({readContext,accountIdentity,host,setResolver=()=>{},onChange=()=>{}}){
  const root=document.createElement('details');
  root.innerHTML='<summary>iPhoneの交通時間（試験・この端末だけ）</summary><p>主画面への反映は下のチェックで有効にします。Mac・共有要約・ウィジェットには送りません。Appleの「現在出発」の推定です。将来の到着時刻に合う便を保証しません。</p><label><input type="checkbox" data-enable>この端末の主カウントダウンに使う</label><p data-context></p><button data-start>この予定の結果を取り込む準備</button> <button data-launch disabled>設定済みショートカットを開く</button><p>元のホーム画面アプリへ戻り、表示された時間を入力してください。</p><input data-duration placeholder="例：1時間23分" aria-label="Appleの移動時間"><label><input type="checkbox" data-confirm>いま準備した出発点・行先の結果であることを確認</label><button data-import>この端末に取り込む</button><button data-clear>端末の結果を解除</button><p data-message role="status"></p><strong data-result style="font-size:1.7rem"></strong>';
  host.append(root);
  const q=s=>root.querySelector(s),msg=q('[data-message]');
  let store,bridge,identity='',launchURL='',generation=0;
  async function context(){
    const seq=++generation,id=await accountIdentity();
    if(seq!==generation)throw Error('context-changing');
    if(identity!==id){identity=id;launchURL='';q('[data-launch]').disabled=true;
      store=new LocalImport({storage:localStorage,key:'gyakusan.iphone-import.v1:'+id});
      bridge=new ShortcutReturn({storage:localStorage,deviceId:'this-browser',accountId:id});
      q('[data-enable]').checked=localStorage.getItem('gyakusan.iphone-enabled:'+id)==='true';
      const accountStore=store,accountId=id;
      setResolver(scope=>{
        if(identity!==accountId||localStorage.getItem('gyakusan.iphone-enabled:'+accountId)!=='true'||!navigator.onLine)return null;
        const r=accountStore.read(scope);
        return r?{min:r.minutes,km:null,source:'iphone_shortcuts',estimated:true,got:r.at}:null;
      });
    }
    const c=readContext();if(!c)throw Error('no-valid-route');return c;
  }
  async function refresh(){
    try{const c=await context(),r=store.read(c.scope);
      q('[data-context]').textContent=c.label;
      q('[data-result]').textContent=r&&!c.manual&&!c.unknown&&navigator.onLine
        ?'自由時間 約'+Math.floor((c.scope.arriveAt-Date.now())/60000-c.work-c.buffer-c.sleep-r.minutes)+'分（移動 '+r.minutes+'分）'
        : c.manual?'手入力の所要時間を優先します。':!navigator.onLine?'オフライン：所要時間は未確認':c.unknown?'途中の移動が不明：自由時間は未確定':'有効な端末内結果なし（5分で失効）';
    }catch{q('[data-result]').textContent='対象予定・出発点・行先を確認してください。';}
  }
  q('[data-enable]').onchange=async()=>{try{await context();localStorage.setItem('gyakusan.iphone-enabled:'+identity,String(q('[data-enable]').checked));onChange();}catch(e){msg.textContent=e.message;}};
  q('[data-start]').onclick=async()=>{try{const c=await context();if(c.manual)throw Error('manual-precedence');
    store.begin(c.scope);launchURL=bridge.begin(c.scope,location.href);q('[data-launch]').disabled=false;
    q('[data-confirm]').checked=false;q('[data-duration]').value='';
    msg.textContent='5分以内に、同じ出発点・行先の結果を入力してください。既存のショートカットでも取り込めます。';
  }catch(e){msg.textContent='準備できません：'+e.message;}};
  q('[data-launch]').onclick=async()=>{try{const c=await context();const p=store.load().pending;
    if(!p||JSON.stringify(p.scope)!==JSON.stringify(c.scope)||Date.now()-p.at>300000)throw Error('changed-context');
    if(launchURL)location.href=launchURL;
  }catch(e){msg.textContent='再度準備してください：'+e.message;}};
  q('[data-import]').onclick=async()=>{try{const c=await context();if(c.manual)throw Error('manual-precedence');
    const text=q('[data-duration]').value.trim();
    if(text.startsWith('{')||text.startsWith('#gyakusanETA=')){
      const result=bridge.accept(text,c.scope);
      store.accept(result.minutes+'分',c.scope,true);
    }else store.accept(text,c.scope,q('[data-confirm]').checked);
    bridge.cancel();
    launchURL='';q('[data-launch]').disabled=true;
    msg.textContent='Apple表示からの貼付推定（取り込み時刻 '+new Date().toLocaleTimeString()+ '）。自動検証・時刻表照合はしていません。';await refresh();onChange();
  }catch(e){msg.textContent='取り込めません：'+e.message;}};
  q('[data-clear]').onclick=()=>{if(store)store.cancel();if(bridge)bridge.cancel();launchURL='';q('[data-launch]').disabled=true;refresh();onChange();};
  async function receiveReturn(){
    if(!location.hash||!location.hash.startsWith('#gyakusanETA='))return;
    root.open=true;q('[data-duration]').value=location.hash;
    // Keep a usable copy even when Safari has a separate storage partition.
    msg.textContent='返却データを受信。元のアプリなら「取り込む」。別Safariならこの入力欄をコピーし、元のホーム画面アプリへ貼り付けてください。';
    try{history.replaceState(null,'',location.pathname+location.search);}catch{}
  }
  window.addEventListener('hashchange',receiveReturn);
  context().then(receiveReturn).catch(receiveReturn);
  root.addEventListener('toggle',()=>{if(root.open)refresh();});
  setInterval(()=>{if(root.open)refresh();},15000);
  window.addEventListener('online',()=>{refresh();onChange();});window.addEventListener('offline',()=>{refresh();onChange();});
  document.addEventListener('visibilitychange',()=>{if(root.open)refresh();});
}

import {durationMinutes} from './shortcut-duration.mjs';
// No network, permissions or location capture. Caller owns the user gesture.
export class ShortcutReturn {
  constructor({storage,deviceId,accountId,now=Date.now,nonce=()=>crypto.randomUUID()}){
    Object.assign(this,{storage,deviceId,accountId,now,nonce});
    this.key='gyakusan.shortcut.pending:'+encodeURIComponent(accountId)+':'+encodeURIComponent(deviceId);
  }
  begin(scope,returnURL){
    const url=new URL(returnURL);
    if(url.protocol!=='https:'||url.username||url.password)throw Error('invalid-return-url');
    url.search='';url.hash='';
    if(!scope?.eventId||!Number.isFinite(scope.arriveAt)||scope.arriveAt<=this.now()||!scope.origin||!scope.destination)throw Error('invalid-scope');
    for(const p of [scope.origin,scope.destination])if(!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180)throw Error('invalid-point');
    const pending={v:1,nonce:this.nonce(),deviceId:this.deviceId,accountId:this.accountId,createdAt:this.now(),scope:structuredClone(scope),returnURL:url.href};
    this.storage.setItem(this.key,JSON.stringify(pending));
    // Explicit fragment return avoids putting coordinates or results in HTTP query logs.
    const input={v:1,nonce:pending.nonce,origin:scope.origin,destination:scope.destination,originMapURL:"https://maps.apple.com/?ll="+scope.origin.lat+","+scope.origin.lng,destinationMapURL:"https://maps.apple.com/?ll="+scope.destination.lat+","+scope.destination.lng,returnURL:url.href};
    return 'shortcuts://run-shortcut?'+new URLSearchParams({name:'逆算・交通時間',input:'text',text:JSON.stringify(input)});
  }
  cancel(){this.storage.removeItem(this.key);}
  accept(fragment,currentScope){
    let pending,reply;
    try{pending=JSON.parse(this.storage.getItem(this.key)||'null');reply=JSON.parse(decodeURIComponent(fragment.replace(/^#gyakusanETA=/,'')));}catch{throw Error('invalid-return');}
    if(!pending||pending.accountId!==this.accountId||pending.deviceId!==this.deviceId||reply.nonce!==pending.nonce)throw Error('unmatched-return');
    if(this.now()<pending.createdAt||this.now()-pending.createdAt>5*60000){this.cancel();throw Error('expired-return');}
    if(JSON.stringify(currentScope)!==JSON.stringify(pending.scope)){this.cancel();throw Error('changed-context');}
    if(reply.durationText!==undefined){if(reply.seconds!==undefined)throw Error('ambiguous-duration');reply.seconds=durationMinutes(reply.durationText)*60;}
    if(reply.v!==1||typeof reply.seconds!=='number'||!Number.isFinite(reply.seconds)||reply.seconds<=0||reply.seconds>86400)throw Error('invalid-duration');
    this.cancel();
    return {scope:pending.scope,minutes:Math.ceil(reply.seconds/60),source:'apple_shortcuts_eta',verified:false,quality:'provider_estimate',fetchedAt:this.now(),requestedAt:pending.createdAt};
  }
}

'use strict';
const net=require('node:net'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(process.env.ENABLE_STRATUM_PROXY!=='true') { console.error('Proxy disabled');process.exit(1); }
const dir=process.env.DATA_DIR||path.join(__dirname,'..','data');
const host=process.env.UPSTREAM_HOST||'solo.ckpool.org';
const port=Number(process.env.UPSTREAM_PORT||4334),localPort=Number(process.env.STRATUM_PORT||3333);
const bindHost=process.env.STRATUM_BIND_HOST||'127.0.0.1';
const address='bc1q596uwd5cqnw00x9dkrrxzvxc6nvadj2vr3n376';
const MAX_LINE=16384,MAX_BUFFER=65536;
function getMiner(worker,pass){
 const match=/^SATURN\.([0-9a-f-]{36})$/i.exec(worker);
 if(!match||typeof pass!=='string')return null;
 let list;try{list=JSON.parse(fs.readFileSync(path.join(dir,'miners.json'),'utf8'));}catch{return null;}
 if(!Array.isArray(list))return null;
 const m=list.find(x=>x.id===match[1].toLowerCase());if(!m||!m.stratumTokenHash||!/^[0-9a-f]{64}$/i.test(m.stratumTokenHash))return null;
 const actual=crypto.createHash('sha256').update(pass).digest();
 const expected=Buffer.from(m.stratumTokenHash,'hex');
 return crypto.timingSafeEqual(actual,expected)?m:null;
}
const server=net.createServer(client=>{
 client.setTimeout(180000);const upstream=net.connect({host,port});upstream.setTimeout(180000);
 let clientBuf='',upstreamBuf='',authorized=false,worker=null,authorizationPending=false;
 const pending=new Map();
 function close(){client.destroy();upstream.destroy();}
 for(const s of [client,upstream]){s.on('timeout',close);s.on('error',close);}
 client.on('close',()=>upstream.destroy());upstream.on('close',()=>client.destroy());
 function send(socket,obj){if(!socket.destroyed)socket.write(JSON.stringify(obj)+'\n');}
 function handleClient(msg){
  if(!msg||typeof msg!=='object'||Array.isArray(msg))return close();
  if(msg.id!=null&&pending.has(JSON.stringify(msg.id)))return close();
  if(msg.method==='mining.authorize'){
   if(authorized||authorizationPending||!Array.isArray(msg.params)||msg.id==null)return close();
   const m=getMiner(msg.params[0],msg.params[1]);
   if(!m){send(client,{id:msg.id,result:false,error:[24,'Invalid worker credentials',null]});return;}
   worker=m.id;authorizationPending=true;
   msg.params=[address+'.'+m.id.replace(/-/g,'').slice(0,20),'x'];
   pending.set(JSON.stringify(msg.id),{kind:'authorize',worker:m.id});
  } else if(msg.method==='mining.submit'){
   if(!authorized||!worker){send(client,{id:msg.id,result:false,error:[24,'Authorize first',null]});return;}
   if(!Array.isArray(msg.params)||msg.params.length<5||msg.id==null)return close();
   msg.params[0]=address+'.'+worker.replace(/-/g,'').slice(0,20);
   pending.set(JSON.stringify(msg.id),{kind:'share',worker});
  } else if(msg.method==='mining.configure'||msg.method==='mining.subscribe'||msg.method==='mining.extranonce.subscribe'){
   // Relay negotiation; no local mining jobs are generated.
  } else if(typeof msg.method==='string'&&msg.method.startsWith('mining.')){
   // Do not forward unknown state-changing Stratum commands.
   send(client,{id:msg.id??null,result:null,error:[20,'Unsupported method',null]});return;
  } else {return close();}
  if(pending.size>1000)return close();
  send(upstream,msg);
 }
 client.on('data',data=>{
  clientBuf+=data.toString('utf8');if(clientBuf.length>MAX_BUFFER)return close();
  let idx;while((idx=clientBuf.indexOf('\n'))>=0){const line=clientBuf.slice(0,idx).trim();clientBuf=clientBuf.slice(idx+1);if(line.length>MAX_LINE)return close();if(!line)continue;
   let msg;try{msg=JSON.parse(line);}catch{return close();}handleClient(msg);
  }
 });
 upstream.on('data',data=>{
  upstreamBuf+=data.toString('utf8');if(upstreamBuf.length>MAX_BUFFER)return close();
  let idx;while((idx=upstreamBuf.indexOf('\n'))>=0){const line=upstreamBuf.slice(0,idx).trim();upstreamBuf=upstreamBuf.slice(idx+1);if(line.length>MAX_LINE)return close();if(!line)continue;
   let msg;try{msg=JSON.parse(line);}catch{return close();}
   const key=JSON.stringify(msg.id);
   if(pending.has(key)){
    const event=pending.get(key);pending.delete(key);
    if(event.kind==='authorize'){
     authorizationPending=false;authorized=msg.result===true;
     if(!authorized)worker=null;
     console.log(JSON.stringify({event:'upstream_authorization',worker:event.worker,accepted:authorized}));
    }else console.log(JSON.stringify({event:'upstream_share_response',worker:event.worker,accepted:msg.result===true}));
   }
   send(client,msg);
  }
 });
});
server.listen(localPort,bindHost,()=>console.log(`SATURN experimental relay ${bindHost}:${localPort} -> ${host}:${port}; payouts disabled`));

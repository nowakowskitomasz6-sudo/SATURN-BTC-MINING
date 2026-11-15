'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'), DIR=process.env.DATA_DIR||path.join(ROOT,'data'), FILE=path.join(DIR,'miners.json');
const ADDRESS='bc1q596uwd5cqnw00x9dkrrxzvxc6nvadj2vr3n376', ADMIN_KEY=process.env.SATURN_ADMIN_KEY||'';
let miners=[];try{miners=JSON.parse(fs.readFileSync(FILE,'utf8'));if(!Array.isArray(miners))throw Error('Invalid database');}catch(e){if(e.code!=='ENOENT')throw e;}
const limits=new Map();const addressPattern=/^(bc1[ac-hj-np-z02-9]{11,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/i;
function respond(res,status,obj){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
function publicMiner(m){return {id:m.id,name:m.name,device:m.device,hashrateTH:m.hashrateTH,registeredAt:m.registeredAt,connected:false};}
function persist(){fs.mkdirSync(DIR,{recursive:true});const tmp=FILE+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(miners,null,2),{mode:0o600});fs.renameSync(tmp,FILE);}
function readBody(req){return new Promise((resolve,reject)=>{let b='',size=0;req.on('data',c=>{size+=c.length;if(size>8192){reject(Error('Body too large'));req.destroy();return;}b+=c;});req.on('end',()=>{try{resolve(JSON.parse(b));}catch(e){reject(Error('Invalid JSON'));}});req.on('error',reject);});}
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const url=new URL(req.url,'http://localhost');const route=url.pathname;
 if(req.method==='GET'&&route==='/api/status')return respond(res,200,{project:'SATURN',network:'bitcoin-mainnet',mode:'registration-only',miningActive:false,saturnBtcAddress:ADDRESS,minerCount:miners.length,totalDeclaredHashrateTH:+miners.reduce((s,m)=>s+m.hashrateTH,0).toFixed(4),miners:miners.map(publicMiner),rewardPolicy:{finderPercent:97,projectPercent:3,automaticPayouts:false},message:'Moc zadeklarowana; niepotwierdzona przez pool.'});
 if(req.method==='POST'&&route==='/api/register'){
  const ip=req.socket.remoteAddress||'unknown',now=Date.now(),previous=(limits.get(ip)||[]).filter(t=>now-t<3600000);if(previous.length>=5)return respond(res,429,{error:'Limit 5 rejestracji na godzinę'});
  let data;try{data=await readBody(req);}catch(e){if(!res.destroyed)return respond(res,400,{error:'Niepoprawny JSON'});return;}
  const {name,device,hashrateTH,payoutAddress,consent}=data||{};
  if(consent!==true||typeof name!=='string'||name.trim().length<2||name.length>60||typeof device!=='string'||device.trim().length<2||device.length>100||typeof hashrateTH!=='number'||!Number.isFinite(hashrateTH)||hashrateTH<=0||hashrateTH>1e6||typeof payoutAddress!=='string'||!addressPattern.test(payoutAddress))return respond(res,400,{error:'Nieprawidłowe dane rejestracji'});
  const token=crypto.randomBytes(24).toString('hex');const m={id:crypto.randomUUID(),name:name.trim(),device:device.trim(),hashrateTH,payoutAddress,registeredAt:new Date().toISOString(),stratumTokenHash:crypto.createHash('sha256').update(token).digest('hex')};miners.push(m);
  try{persist();}catch(e){miners.pop();console.error('Save error:',e.message);return respond(res,503,{error:'Nie można zapisać danych'});}
  previous.push(now);limits.set(ip,previous);return respond(res,201,{message:'Zgłoszenie zapisane',miner:publicMiner(m),workerId:'SATURN.'+m.id,stratumPassword:token,notice:'Dane do przyszłego proxy Stratum; zachowaj hasło prywatnie. Kopanie nie jest jeszcze uruchomione.'});
 }
 if(req.method==='GET'&&route==='/api/admin/miners'){
  if(!ADMIN_KEY)return respond(res,503,{error:'Administrator nie skonfigurowany'});
  const a=Buffer.from(req.headers['x-admin-key']||''),b=Buffer.from(ADMIN_KEY);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return respond(res,401,{error:'Brak dostępu'});
  return respond(res,200,{miners});
 }
 if(req.method==='POST'&&['/api/share','/api/block-candidate','/api/payout'].includes(route))return respond(res,501,{error:'Funkcja niedostępna bez zweryfikowanej infrastruktury wydobywczej'});
 if(req.method==='GET'&&(route==='/'||route==='/index.html')){const html=fs.readFileSync(path.join(ROOT,'docs','index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html);}
 return respond(res,404,{error:'Nie znaleziono'});
});
server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('SATURN HTTP listening'));

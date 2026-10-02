const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const port=Number(process.env.POS_PORT||4318);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('ポート番号が不正です');
const origin=`http://127.0.0.1:${port}`;
const instance=crypto.createHash('sha256').update(path.resolve(__dirname).toLowerCase()).digest('hex');
const {Store}=require('./store');
const store=new Store(path.join(__dirname,'data','pos.json'));
const routes={master:body=>store.master(body.table,body.row),quote:body=>store.quote(body.mode,body.lines),transaction:body=>store.transact(body),draft:body=>store.draft(body),settings:body=>store.settings(body)};
const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
const server=http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
 if(req.headers.host!==`127.0.0.1:${port}`||(req.headers.origin&&req.headers.origin!==origin)){res.writeHead(403);return res.end();}
 try{
  const url=new URL(req.url,origin);
  if(req.method==='GET'&&url.pathname==='/api/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({app:'nyushukka-prototype',version:require('./package.json').version,instance}));}
  if(req.method==='GET'&&url.pathname==='/api/state'){res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(store.db));}
  if(req.method==='POST'&&url.pathname.startsWith('/api/')){
   if(!req.headers['content-type']?.startsWith('application/json'))throw Error('JSON形式が必要です');
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)throw Error('入力が大きすぎます');}
   const route=routes[url.pathname.slice(5)];if(!route)throw Error('不明な操作です');
   const result=route(JSON.parse(raw));res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(result));
  }
  if(req.method!=='GET'||!files[url.pathname]){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname,'public',files[url.pathname])));
 }catch(error){res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({error:error.message}));}
});
server.listen(port,'127.0.0.1',()=>console.log(`POS試作: ${origin}  終了はCtrl+C`));
server.on('error',error=>{console.error('起動できません: '+error.message);process.exitCode=1;});
module.exports={server,origin};

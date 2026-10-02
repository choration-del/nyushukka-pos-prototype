'use strict';
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const folder=__dirname;
const port=Number(process.env.POS_PORT||4318);
const url=`http://127.0.0.1:${port}`;
const logFile=path.join(folder,'startup-error.txt');
function fail(error){
 const message=`起動できませんでした。\n${error.message}\n\nZIPをすべて展開して「起動.bat」を開いてください。\n別の版が起動中の場合は、その黒いウィンドウを閉じてから再度起動してください。\nデータファイルは削除・初期化していません。\n`;
 console.error(message);
 try{fs.writeFileSync(logFile,`${new Date().toISOString()}\nNode ${process.version} ${process.arch}\n${message}\n${error.stack||''}`);}catch{}
 process.exitCode=1;
}
function openBrowser(){
 console.log(`ブラウザーで ${url} を開きます。終了はこのウィンドウでCtrl+Cです。`);
 if(process.argv.includes('--no-browser'))return;
 const child=spawn(process.env.ComSpec||'C:\\Windows\\System32\\cmd.exe',['/d','/c','start','',url],{windowsHide:true,stdio:'ignore'});
 child.on('error',()=>console.error(`ブラウザーを開けません。手動で ${url} を開いてください。`));
 child.on('exit',code=>{if(code)console.error(`ブラウザーを開けません。手動で ${url} を開いてください。`);});
}
function probe(){return new Promise(resolve=>{
 const request=http.get(`${url}/api/health`,response=>{
  let body='';response.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy();});
  response.on('end',()=>{try{resolve({occupied:true,health:JSON.parse(body)});}catch{resolve({occupied:true});}});
  response.on('error',()=>resolve({occupied:true}));
 });
 request.setTimeout(1500,()=>request.destroy());
 request.on('error',error=>resolve({occupied:error.code!=='ECONNREFUSED'}));
});}
async function main(){
 if(process.platform!=='win32')throw Error('配布版の起動はWindows用です');
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('ポート番号が不正です');
 if(Number(process.versions.node.split('.')[0])<20)throw Error('Node.js 20以上が必要です。runtimeフォルダーを含めて展開してください');
 for(const name of ['server.js','store.js','public/index.html'])if(!fs.existsSync(path.join(folder,name)))throw Error(`必要なファイルがありません: ${name}`);
 const status=await probe();
 if(status.occupied){
  const instance=crypto.createHash('sha256').update(path.resolve(folder).toLowerCase()).digest('hex');
  if(status.health?.app!=='nyushukka-prototype'||status.health.instance!==instance||status.health.version!==require('./package.json').version)throw Error('別のアプリ、別フォルダー、または旧版が起動用ポートを使用しています');
  console.log('このフォルダーのPOSはすでに起動しています。');openBrowser();return;
 }
 const {server}=require('./server');
 server.once('listening',openBrowser);
 server.once('error',fail);
}
main().catch(fail);

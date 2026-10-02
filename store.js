const fs = require('node:fs');
const path = require('node:path');
const MODES = ['販売','カード','商品券','掛売','割販','入金','出金','現金仕入','掛仕入','棚卸','予約・注文','破棄','移動入庫','移動出庫'];
const RECORD_MODES = ['販売','現金仕入','棚卸','入金','出金'];
const defaults = {operator:'',weather:'',temperature:'',shopNumber:'1',registerNumber:'1',mergeSame:true,promptSales:false,promptPurchase:true,promptMovement:true,cards:['カード1','カード2','カード3'],vouchers:['商品券1','商品券2','商品券3'],selectItems:[]};
function integer(value,label,min=0,max=100000000){
 if(value===null||value===undefined||value===''||typeof value==='boolean')throw Error(label+'を入力してください');
 const n=Number(value);
 if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(label+'が不正です');
 return n;
}
class Store {
 constructor(file){
  this.file=file;
  this.db=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{products:[],customers:[],suppliers:[],transactions:[],drafts:[],settings:{}};
  this.db.settings={...defaults,...this.db.settings};
  this.db.drafts ||= [];
 }
 save(next){
  fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const temporary=this.file+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(next,null,2));
  if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.bak');
  fs.renameSync(temporary,this.file);
  this.db=next;
 }
 master(table,input){
  if(!['products','customers','suppliers'].includes(table))throw Error('不明な登録先です');
  const row={...input};row.name=String(row.name||'').trim();
  if(!row.name)throw Error('名前を入力してください');
  if(row.name.length>300)throw Error('名前が長すぎます');
  if(table==='products'){
   row.barcode=String(row.barcode||'').trim();row.shortcut=String(row.shortcut||'').trim();
   if(!row.barcode&&(!row.shortcut||row.shortcut==='0'))throw Error('バーコードかショートカットキーを設定してください');
   row.salePrice=integer(row.salePrice,'販売価格');row.costPrice=integer(row.costPrice,'仕入価格');
   if(!['内税','外税','非課税'].includes(row.taxType)||![0,8,10].includes(Number(row.taxRate)))throw Error('税設定が不正です');
   row.taxRate=Number(row.taxRate);
   for(const key of ['barcode','shortcut']){
    if(row[key]&&row[key]!=='0'&&this.db.products.some(p=>p.id!==row.id&&p[key]===row[key]))throw Error((key==='barcode'?'バーコード':'ショートカットキー')+'が重複しています');
   }
   if(row.supplierId&&!this.db.suppliers.some(s=>s.id===Number(row.supplierId)))throw Error('仕入先が見つかりません');
  }
  if(table==='customers'&&row.cardId&&this.db.customers.some(c=>c.id!==row.id&&c.cardId===row.cardId))throw Error('カードIDが重複しています');
  const next=structuredClone(this.db);
  if(row.id){const i=next[table].findIndex(r=>r.id===row.id);if(i<0)throw Error('編集対象が見つかりません');next[table][i]=row;}
  else{row.id=Math.max(0,...next[table].map(r=>r.id))+1;next[table].push(row);}
  this.save(next);return row;
 }
 quote(mode,inputLines){
  if(!MODES.includes(mode))throw Error('モードが不正です');
  if(!Array.isArray(inputLines)||!inputLines.length||inputLines.length>500)throw Error('明細を入力してください（最大500行）');
  if(mode==='棚卸'&&new Set(inputLines.map(l=>Number(l.productId))).size!==inputLines.length)throw Error('棚卸に同じ商品の明細が重複しています');
  return inputLines.map(line=>{
   const p=this.db.products.find(r=>r.id===Number(line.productId));if(!p)throw Error('商品が見つかりません');
   const quantity=integer(line.quantity,'数量',mode==='棚卸'?0:1,100000),price=integer(line.price,'単価'),discount=integer(line.discount??0,'値引',0,price*quantity);
   const base=price*quantity-discount;
   const tax=p.taxType==='非課税'?0:p.taxType==='内税'?Math.floor(base*p.taxRate/(100+p.taxRate)):Math.floor(base*p.taxRate/100);
   const supplier=this.db.suppliers.find(s=>s.id===Number(p.supplierId));
   return {productId:p.id,name:p.name,barcode:p.barcode,quantity,price,discount,memo:String(line.memo||''),taxType:p.taxType,taxRate:p.taxRate,tax,amount:base+(p.taxType==='外税'?tax:0),costPrice:p.costPrice,supplierId:supplier?.id||null,supplierName:supplier?.name||'',shopNumber:String(p.storeNumber||'1')};
  });
 }
 requestId(input){if(typeof input.requestId!=='string'||!input.requestId||input.requestId.length>100)throw Error('記録IDが不正です');}
 customer(id){if(!id)return null;const c=this.db.customers.find(c=>c.id===Number(id));if(!c)throw Error('顧客が見つかりません');return {id:c.id,name:c.name,cardId:c.cardId};}
 transact(input){
  this.requestId(input);
  const previous=this.db.transactions.find(t=>t.requestId===input.requestId);if(previous)return previous;
  const mode=input.mode;if(!RECORD_MODES.includes(mode))throw Error('このモードの確定は未実装です');
  let lines=[],total=0;
  if(['入金','出金'].includes(mode)){
   total=integer(input.amount,'金額',1);
   if(!String(input.note||'').trim())throw Error('摘要を入力してください');
   if(mode==='入金'&&input.cashType==='顧客掛売入金')throw Error('顧客掛売入金の残高処理は未実装です');
  }else{
   lines=this.quote(mode,input.lines);
   if(mode==='現金仕入'&&lines.some(l=>!l.supplierId))throw Error('商品に仕入先を登録してください');
   if(mode==='棚卸'&&!this.db.transactions.some(t=>t.mode==='現金仕入'&&t.lines.some(l=>String(l.shopNumber||'1')===String(this.db.settings.shopNumber))))throw Error('この店舗の仕入履歴が見つかりません');
   total=mode==='棚卸'?0:lines.reduce((n,l)=>n+l.amount,0);
   if(!Number.isSafeInteger(total)||total>100000000)throw Error('合計金額が大きすぎます');
  }
  let tender=null;if(mode==='販売')tender=integer(input.tender,'預かり金額',total);
  const tx={id:this.db.transactions.length+1,requestId:input.requestId,date:new Date().toISOString(),mode,lines,total,tender,change:tender===null?null:tender-total,note:String(input.note||''),item:String(input.item||''),operator:this.db.settings.operator,shopNumber:this.db.settings.shopNumber,registerNumber:this.db.settings.registerNumber,customer:this.customer(input.customerId),provisional:true};
  const next=structuredClone(this.db);next.transactions.push(tx);this.save(next);return tx;
 }
 draft(input){
  this.requestId(input);
  if(!MODES.includes(input.mode)||RECORD_MODES.includes(input.mode))throw Error('このモードは仮伝票の対象ではありません');
  const previous=this.db.drafts.find(t=>t.requestId===input.requestId);if(previous)return previous;
  const lines=this.quote(input.mode,input.lines);
  const result={id:this.db.drafts.length+1,requestId:input.requestId,date:new Date().toISOString(),mode:input.mode,lines,customer:this.customer(input.customerId),note:String(input.note||''),provisional:true,kind:'draft',status:'観察用・未確定'};
  const next=structuredClone(this.db);next.drafts.push(result);this.save(next);return result;
 }
 settings(input){
  const next=structuredClone(this.db);
  for(const key of ['operator','weather','temperature'])if(key in input)next.settings[key]=String(input[key]||'').slice(0,100);
  for(const key of ['shopNumber','registerNumber'])if(key in input)next.settings[key]=String(integer(input[key],key==='shopNumber'?'店舗番号':'レジ番号',1,999999));
  for(const key of ['mergeSame','promptSales','promptPurchase','promptMovement'])if(key in input){if(typeof input[key]!=='boolean')throw Error('設定値が不正です');next.settings[key]=input[key];}
  for(const key of ['cards','vouchers','selectItems'])if(key in input){if(!Array.isArray(input[key])||input[key].length>10)throw Error('設定一覧が不正です');next.settings[key]=input[key].map(s=>String(s).trim().slice(0,100));}
  this.save(next);return next.settings;
 }
}
module.exports={Store,MODES,RECORD_MODES};

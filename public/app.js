'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yen = value => '¥' + Number(value).toLocaleString('ja-JP');
const modes = ['販売','カード','商品券','掛売','割販','入金','出金','現金仕入','掛仕入','棚卸','予約・注文','破棄','移動入庫','移動出庫'];
const recordedModes = ['販売','現金仕入','棚卸','入金','出金'];
let db, mode = '', screen = 'register', lines = [], selected = -1, quoted = [], lastTx = null;
let busy = false, pendingQuote = false, quoteVersion = 0, requestId = crypto.randomUUID(), customerId = null, dialogHandler = null;
let inputSaved = true, continuation = null;
let inputTask=Promise.resolve(),modeChanging=false;

async function api(route, body) {
 const response = await fetch('/api/' + route, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {});
 const data = await response.json();
 if (!response.ok) throw Error(data.error || '通信に失敗しました');
 return data;
}
function status(text) { $('status').textContent = text; }
function changed() { requestId = crypto.randomUUID(); inputSaved = false; }
function unimplemented(name) { status(name + 'は未実装です。業務データは変更しません。'); }
function field(label, name, value = '', type = 'text', readonly = false) {
 return `<label>${esc(label)}<input name="${name}" aria-label="${esc(label)}" type="${type}" value="${esc(value)}" ${readonly?'readonly':''} ${type==='number'?'min="0" step="1"':''}></label>`;
}
function select(label, name, options, value) {
 return `<label>${esc(label)}<select name="${name}" aria-label="${esc(label)}">${options.map(([v,t])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
}
function checkbox(label, name, checked) {
 return `<label><input type="checkbox" name="${name}" ${checked?'checked':''}>${esc(label)}</label>`;
}
function show(title, html, handler, ok = 'OK', className = '') {
 document.querySelectorAll('.menubar details').forEach(menu=>menu.open=false);
 if ($('dialog').open) $('dialog').close();
 dialogHandler = handler;
 $('dialog').className = className;
 $('dialogTitle').textContent = title;
 $('dialogBody').innerHTML = html;
 $('dialogError').textContent = '';
 $('ok').textContent = ok;
 $('ok').hidden = !handler;
 $('ok').disabled = false;
 $('cancel').disabled = false;
 $('dialog').showModal();
}
function close() { $('dialog').close(); if(screen==='register') $('key').focus(); }
function ask(text) {
 return new Promise(resolve => {
  const dialog = $('confirmation');
  $('confirmationText').textContent = text;
  const finish = answer => { dialog.close(); resolve(answer); };
  $('confirmationYes').onclick = () => finish(true);
  $('confirmationNo').onclick = () => finish(false);
  dialog.oncancel = event => { event.preventDefault(); finish(false); };
  dialog.showModal(); $('confirmationNo').focus();
 });
}
$('cancel').onclick = () => { if (!busy) close(); };
$('dialog').addEventListener('cancel', e => { if(busy || $('ok').disabled) e.preventDefault(); });
$('dialogForm').onsubmit = async event => {
 event.preventDefault();
 if(!dialogHandler || $('ok').disabled) return;
 const handler = dialogHandler;
 const data=new FormData($('dialogForm'));
 const controls=Array.from($('dialogForm').elements).map(control=>[control,control.disabled]);
 controls.forEach(([control])=>control.disabled=true);
 try { await handler(data); }
 catch(error) { $('dialogError').textContent = error.message; }
 finally { controls.forEach(([control,disabled])=>{if(control.isConnected)control.disabled=disabled;});$('ok').disabled=false;$('cancel').disabled=false; }
};
async function reload() {
 db = await api('state');
 $('operatorInput').value = db.settings.operator;
 $('weatherInput').value = db.settings.weather;
 $('temperatureInput').value = db.settings.temperature;
 $('voucher').textContent = '伝票番号：' + String(db.transactions.length + 1).padStart(4,'0');
 $('metadata').textContent = '店舗番号 ' + db.settings.shopNumber + ' ／ レジ番号 ' + db.settings.registerNumber + (customerId?' ／ 顧客：'+(db.customers.find(c=>c.id===customerId)?.name||''): '');
}
async function render() {
 const version = ++quoteVersion;
 const snapshot = structuredClone(lines);
 pendingQuote = true;
 let next = [];
 try { if(snapshot.length) next = await api('quote',{mode,lines:snapshot}); }
 catch(error) { if(version===quoteVersion){status(error.message);quoted=[];} return false; }
 finally { if(version===quoteVersion) pendingQuote = false; }
 if(version!==quoteVersion) return false;
 quoted = next;
 const rows = next.map((line,index)=>`<tr data-index="${index}" class="${selected===index?'selected':''}"><td>${index+1}</td><td>${line.productId}</td><td>${esc(line.name)}</td><td>${esc(line.memo)}</td><td>${yen(line.price)}</td><td>${line.taxType==='非課税'?'非課税':(line.taxType==='内税'?'内':'外')+line.taxRate}</td><td>${line.quantity}</td><td>${yen(line.amount)}</td></tr>`);
 for(let index=next.length;index<11;index++) rows.push('<tr aria-hidden="true">'+ '<td>&nbsp;</td>'.repeat(8) +'</tr>');
 $('lines').innerHTML = rows.join('');
 $('lines').querySelectorAll('[data-index]').forEach(row=>row.onclick=()=>{selected=Number(row.dataset.index);render();});
 $('subtotal').textContent = yen(next.reduce((n,l)=>n+l.price*l.quantity-l.discount,0));
 $('tax').textContent = yen(next.filter(l=>l.taxType==='内税').reduce((n,l)=>n+l.tax,0));
 $('total').textContent = mode==='棚卸'?'—':yen(next.reduce((n,l)=>n+l.amount,0));
 const active = next[selected];
 $('productName').textContent = active?.name || '';
 $('productPrice').textContent = active ? yen(active.price) : '';
 return true;
}
function reset() {
 lines = []; selected = -1; customerId = null; inputSaved = true;
 requestId = crypto.randomUUID(); $('key').value = ''; render();
}
function noteForMode() {
 if(mode==='販売') return '販売：税計算は仮仕様（明細ごとの切り捨て）';
 if(mode==='棚卸') return '棚卸：実数の試作記録 ／ 在庫残高・差異は更新しません';
 if(mode==='現金仕入') return '現金仕入：仕入価格で試作記録 ／ 現金残高は未処理';
 if(['入金','出金'].includes(mode)) return '入出金：試作記録 ／ 掛売残高・現金残高は未処理';
 return '仮伝票のみ保存できます ／ 売上・残高・在庫へ反映しません';
}
async function setMode(next) {
 if(busy || $('dialog').open || $('confirmation').open || modeChanging) return;
 modeChanging=true;
 await inputTask;
 modeChanging=false;
 if($('dialog').open)return;
 if(next===mode){changeScreen('register');return;}
 if(lines.length && !inputSaved && !await ask('計算が途中です。消去してよろしいですか？')) return;
 reset(); mode = next;
 $('mode').textContent = mode;
 $('tender').textContent = '—'; $('change').textContent = '—';
 $('modeNote').textContent = noteForMode();
 document.querySelectorAll('[data-mode]').forEach(button=>button.classList.toggle('active',button.dataset.mode===mode));
 changeScreen('register'); await render(); await reload();
 status(mode+'へ切り替えました');
 if(mode==='棚卸') prepareInventory();
 else if(mode==='入金') cashKind();
 else if(mode==='出金') cashForm();
}
function changeScreen(next) {
 if(busy) return;
 screen = next;
 document.querySelectorAll('.menubar details').forEach(menu=>menu.open=false);
 $('registerScreen').hidden = next!=='register';
 $('workspace').hidden = next==='register';
 if(next==='register') $('key').focus();
 else if(next==='history') history();
 else if(next==='settlement') settlement();
 else if(next==='management') management();
 else masters(next);
}
function quantityDialog(index, nextAction = null) {
 const line = lines[index]; if(!line) return status('明細を選択してください');
 show('個数修正',field('数量','quantity',line.quantity,'number'),async data=>{
  const raw = data.get('quantity'); const quantity = Number(raw);
  if(raw==='' || !Number.isSafeInteger(quantity) || quantity<(mode==='棚卸'?0:1) || quantity>100000) throw Error('数量が不正です');
  if(line.discount>line.price*quantity) throw Error('値引額が金額を超えます。先に値引を修正してください');
  line.quantity = quantity; changed(); close(); await render(); if(nextAction) nextAction();
 });
}
function editQuantity() { if(inputSaved&&lines.length)return status('記録済みの明細です。次の商品入力から新しい伝票を始めてください');quantityDialog(selected); }
async function addProduct(product) {
 if(busy) return;
 if(['入金','出金'].includes(mode)) return status('入出金は決定から金額を入力してください');
 $('key').value = '';
 if(inputSaved && lines.length) { lines=[];selected=-1; }
 if(mode==='棚卸') {
  const found = lines.findIndex(line=>line.productId===product.id);
  if(found>=0){selected=found;await render();quantityDialog(found);return;}
 }
 const price = ['現金仕入','掛仕入'].includes(mode) ? product.costPrice : product.salePrice;
 const found = db.settings.mergeSame && mode!=='棚卸' ? lines.findIndex(line=>line.productId===product.id&&line.price===price&&!line.discount) : -1;
 if(found>=0){
  if(lines[found].quantity>=100000) return status('数量の上限です');
  lines[found].quantity++; selected=found;
 } else { lines.push({productId:product.id,quantity:mode==='棚卸'?0:1,price,discount:0,memo:''});selected=lines.length-1; }
 changed(); await render();
 const prompt = mode==='棚卸' || (['現金仕入','掛仕入'].includes(mode)?db.settings.promptPurchase : ['移動入庫','移動出庫','破棄'].includes(mode)?db.settings.promptMovement : db.settings.promptSales);
 if(price===0&&mode!=='棚卸'&&!lines[selected].priceConfirmed)priceDialog(selected,prompt?()=>quantityDialog(selected):null);
 else if(prompt) quantityDialog(selected); else $('key').focus();
}
function priceDialog(index,nextAction=null){
 const line=lines[index];
 show('価格入力（試作）',field('価格','price',line.price,'number')+'<p class="hint">0円商品の金額入力を確認します。この入力画面の詳細は仮仕様です。</p>',async data=>{
  const raw=data.get('price'),value=Number(raw);
  if(raw===''||!Number.isSafeInteger(value)||value<0||value>100000000)throw Error('価格が不正です');
  line.price=value;line.priceConfirmed=true;changed();close();await render();if(nextAction)nextAction();
 });
}
function inputKey() {
 if(busy||$('dialog').open||modeChanging){status('処理中です。入力キーは残してあります。表示が更新されてから続けてください');return;}
 const key = $('key').value.trim(); if(!key) return;
 const product = db.products.find(p=>p.barcode===key) || db.products.find(p=>p.shortcut===key&&key!=='0');
 if(!product) return status('該当商品がありません。商品リストから新規登録してください');
 $('key').value='';
 const expectedMode=mode;
 inputTask=inputTask.then(async()=>{
  if(mode!==expectedMode||$('dialog').open){$('key').value=key;status('数量・価格入力を終えてから、残っている入力キーを再入力してください');return;}
  await addProduct(product);
 }).catch(error=>status(error.message));
}
function search() {
 show('商品検索',`<label>検索商品名（または商品名カナ）<input id="searchQuery" aria-label="検索商品名"></label><div class="list"><table class="data"><thead><tr><th>商品ID</th><th>商品名</th><th>商品名カナ</th><th>仕入価格</th><th>メモ</th><th></th></tr></thead><tbody id="searchResults"></tbody></table></div>`,null);
 const draw=()=>{
  const key=$('searchQuery').value.toLowerCase();
  $('searchResults').innerHTML=db.products.filter(p=>[p.name,p.kana,p.barcode].some(s=>String(s||'').toLowerCase().includes(key))).map(p=>`<tr><td>${p.id}</td><td>${esc(p.name)}</td><td>${esc(p.kana)}</td><td>${yen(p.costPrice)}</td><td>${esc(p.memo)}</td><td><button type="button" data-id="${p.id}">選択</button></td></tr>`).join('');
  $('searchResults').querySelectorAll('button').forEach(button=>button.onclick=()=>{const p=db.products.find(p=>p.id===Number(button.dataset.id));close();addProduct(p);});
 };
 $('searchQuery').oninput=draw;draw();
}
async function remove() {
 if(busy||!lines[selected]) return;
 if(inputSaved)return status('記録済みの明細です。全削除で表示だけを消去できます');
 if(!await ask('選択した明細を削除しますか？')) return;
 lines.splice(selected,1);selected=Math.min(selected,lines.length-1);changed();await render();
}
async function clearLines() {
 if(busy) return;
 if(lines.length&&!await ask('すべての入力明細を消去しますか？')) return;
 reset();await reload();
}
function countUp() {
 if(!lines[selected]||busy) return;
 if(inputSaved) return status('記録済みの明細です。次の商品入力から新しい伝票を始めてください');
 if(lines[selected].quantity<100000){lines[selected].quantity++;changed();render();}
}
function move(delta) { if(lines.length){selected=Math.max(0,Math.min(lines.length-1,selected+delta));render();} }
function discount() {
 if(inputSaved&&lines.length)return status('記録済みの明細です。次の商品入力から新しい伝票を始めてください');
 if(mode!=='販売')return status('値引は試作では販売モードのみです');
 const line=lines[selected];if(!line)return status('明細を選択してください');
 show('値引（仮：選択明細の合計から円単位で控除）',field('値引金額','discount',line.discount,'number'),data=>{
  const raw=data.get('discount'),value=Number(raw);
  if(raw===''||!Number.isSafeInteger(value)||value<0||value>line.price*line.quantity)throw Error('値引金額が不正です');
  line.discount=value;changed();close();render();
 });
}
async function commit(extra={},draft=false) {
 if(busy) return;
 busy=true;$('cancel').disabled=true;
 try {
  const result=await api(draft?'draft':'transaction',{mode,lines,requestId,customerId,...extra});
  if(!draft)lastTx=result;
  if(!draft&&mode==='現金仕入')inputSaved=true;
  else reset();
  await reload();await render();
  $('tender').textContent=result.tender==null?'—':yen(result.tender);
  $('change').textContent=result.change==null?'—':yen(result.change);
  status((draft?'仮伝票を保存しました。売上・残高・在庫には未反映です。':'データを記録しました。')+' 番号 '+result.id+'（試作）');
  close();
 } finally {busy=false;$('cancel').disabled=false;}
}
async function requireSupplier() {
 const missing=lines.map(l=>db.products.find(p=>p.id===l.productId)).find(p=>!db.suppliers.some(s=>s.id===Number(p.supplierId)));
 if(!missing)return false;
 show('仕入先の確認',`<p>商品に登録されている仕入先データが見つかりませんでした。</p><p>新規に登録する場合は「はい」、既存の中から選択する場合は「いいえ」を選択してください。</p><p>商品：${esc(missing.name)}</p><button type="button" id="newSupplier">はい（新規登録）</button><button type="button" id="existingSupplier">いいえ（既存から選択）</button>`,null);
 const link=async supplier=>{await api('master',{table:'products',row:{...missing,supplierId:String(supplier.id)}});await reload();status('商品の仕入先を登録しました。決定を押して続けてください');};
 $('newSupplier').onclick=()=>{close();masterEditor('suppliers',{},link);};
 $('existingSupplier').onclick=()=>{
  show('仕入先選択',select('仕入先','supplierId',db.suppliers.map(s=>[s.id,s.name]),''),async data=>{
   const supplier=db.suppliers.find(s=>s.id===Number(data.get('supplierId')));if(!supplier)throw Error('仕入先を登録・選択してください');
   await link(supplier);close();
  });
 };
 return true;
}
async function decide() {
 if(busy) return;
 await inputTask;
 if($('dialog').open)return;
 if(inputSaved&&lines.length) return status('この明細は記録済みです。次の商品入力から新しい伝票を始めてください');
 if(mode==='入金')return cashKind();
 if(mode==='出金')return cashForm();
 if(!lines.length)return status('商品を入力してください');
 const zeroPrice=lines.findIndex(line=>line.price===0&&!line.priceConfirmed);
 if(zeroPrice>=0&&mode!=='棚卸'){selected=zeroPrice;priceDialog(selected);return;}
 if(!await render())return;
 if(mode==='現金仕入'&&await requireSupplier())return;
 if(!recordedModes.includes(mode)){
  show(mode+'：仮伝票の保存',`<p class="hint">確定処理は未確認です。入力の観察用に保存し、売上・債権・現金・在庫には反映しません。</p><p>商品数 ${lines.length} 行</p>${field('操作メモ','note')}`,data=>commit({note:data.get('note')},true),'仮伝票を保存');return;
 }
 const total=quoted.reduce((n,l)=>n+l.amount,0);
 show(mode==='販売'?'お預かり金額を入力してください':mode+'の記録確認',`<p>${mode==='棚卸'?'実数の入力記録を保存します。在庫残高は変更しません。':'合計 '+yen(total)}</p>${mode==='販売'?field('預かり金額','tender',total,'number'):''}<p class="hint">操作テスト用の記録です。</p>`,data=>commit(mode==='販売'?{tender:data.get('tender')}:{}),'記録');
}
function cashKind() {
 show('入金の種類','<button type="button" id="normalCash">通常入金</button><button type="button" id="creditCash">顧客掛売入金（未実装）</button>',null);
 $('normalCash').onclick=()=>{close();cashForm();};
 $('creditCash').onclick=()=>{$('dialogError').textContent='顧客掛売入金の残高処理は未確認・未実装です。記録は行いません。';};
}
function cashForm() {
 const notes=db.transactions.filter(t=>t.mode===mode&&t.note).map(t=>t.note);
 show(mode,`<div class="fields">${field('金額(A)','amount',0,'number')}${field('項目(B)','item')}${select('摘要履歴(D)','noteHistory',[['',''],...Array.from(new Set(notes)).map(s=>[s,s])],'')}<label>摘要(E)<textarea name="note" aria-label="摘要"></textarea></label></div><p class="hint">通常入出金の仮記録。現金・掛売残高には反映しません。</p>`,data=>commit({amount:data.get('amount'),item:data.get('item'),note:data.get('note')}),'OK');
 $('dialogBody').querySelector('[name=noteHistory]').onchange=event=>{$('dialogBody').querySelector('[name=note]').value=event.target.value;};
}
function prepareInventory() {
 const shop=String(db.settings.shopNumber);
 if(!db.transactions.some(t=>t.mode==='現金仕入'&&t.lines.some(l=>String(l.shopNumber||'1')===shop))){
  show('棚卸の準備',`<p>店舗番号${esc(shop)}に属する商品の仕入履歴が見つかりませんでした。棚卸の前に「仕入」を使って商品を入荷してください。</p>`,null);return;
 }
 show('棚卸の準備','<p>全商品を表示して、実在庫数の入力準備をします。現在の在庫数を入力してください。</p><p class="hint">初期数は仮の0です。各商品の実数を確認してください。CSV取り込み・差異更新は未実装です。</p>',async()=>{
  lines=db.products.filter(p=>String(p.storeNumber||'1')===shop).map(p=>({productId:p.id,quantity:0,price:p.salePrice,discount:0,memo:''}));
  selected=lines.length?0:-1;changed();close();await render();
 },'はい');
}

function masterEditor(table,row={},afterSave=null) {
 let html='';
 if(table==='products'){
  html=field('商品名(A)','name',row.name)+field('商品名カナ[半角](B)','kana',row.kana)+`<div class="tax-fields">${radios('消費税','taxType',['外税','内税','非課税'],row.taxType||'内税')}${select('税率','taxRate',[[10,'10%'],[8,'8%'],[0,'0%']],row.taxRate??10)}</div>`+field('販売価格(F)','salePrice',row.salePrice??0,'number')+field('仕入価格(G)','costPrice',row.costPrice??0,'number')+`<div class="checks">${checkbox('値引・割引販売計算対象','discountTarget',row.discountTarget!=='0')}${checkbox('ポイント計算対象','pointTarget',row.pointTarget!=='0')}</div>`+field('在庫基準(J)','stockStandard',row.stockStandard??0,'number')+field('個数単位(K)','unit',row.unit)+field('メモ(L)','memo',row.memo)+field('バーコード(M)','barcode',row.barcode)+field('ショートカットキー(N)','shortcut',row.shortcut??0)+field('部門(P)','department',row.department)+select('仕入先(R)','supplierId',[['','[なし]'],...db.suppliers.map(s=>[s.id,s.name])],row.supplierId)+field('店舗番号(T)','storeNumber',row.storeNumber??db.settings.shopNumber,'number');
  for(let i=1;i<=5;i++)html+=field('備考'+i,'remark'+i,row['remark'+i]);
  html+=field('マクロファイル名(Z)','macro',row.macro)+field('商品画像名','image',row.image);
 } else if(table==='customers'){
  html=field('顧客分類(A)','category',row.category)+field('カードID(B)','cardId',row.cardId)+field('入会日(C)','joined',row.joined,'date')+field('有効期限(D)','expires',row.expires,'date')+field('顧客名(E)','name',row.name)+field('顧客名カナ(F)','kana',row.kana)+radios('性別','gender',['男性','女性'],row.gender)+field('誕生日(J)','birthday',row.birthday,'date')+contactFields(row)+field('備考1(O)','remark1',row.remark1)+field('備考2(P)','remark2',row.remark2)+field('値引率(Q)','discountRate',row.discountRate??0,'number')+`<div class="checks">${checkbox('ポイント計算対象','pointTarget',row.pointTarget!=='0')}</div>`;
 } else {
  html=field('仕入先名(K)','name',row.name)+field('仕入先名カナ(H)','kana',row.kana)+contactFields(row)+field('備考1(B)','remark1',row.remark1)+field('備考2(C)','remark2',row.remark2)+field('備考3(D)','remark3',row.remark3);
 }
 show((row.id?'項目変更：':'新規')+(table==='products'?'商品':table==='customers'?'顧客':'仕入先'),`<div class="fields">${html}</div><p class="hint">詳細条件・ポイント等は保存のみ。マクロは実行しません。</p>`,async data=>{
  const input=Object.fromEntries(data);
  for(const key of ['postal','phone','fax']){const values=[data.get(key+'0'),data.get(key+'1'),data.get(key+'2')].filter(v=>v!==null);if(values.length)input[key]=values.some(Boolean)?values.join('-'):'';for(let i=0;i<3;i++)delete input[key+i];}
  if('pointTarget' in row||table!=='suppliers')input.pointTarget=data.has('pointTarget')?'1':'0';
  if(table==='products')input.discountTarget=data.has('discountTarget')?'1':'0';
  if(row.id)input.id=row.id;
  if(!input.name?.trim())throw Error('名前を入力してください');
  if(table==='products'&&!input.barcode&&(!input.shortcut||input.shortcut==='0'))throw Error('バーコードかショートカットキーを設定してください');
  if(!await ask('この内容で登録・保存してよろしいですか？'))return;
  const saved=await api('master',{table,row:input});await reload();close();status('登録されました。');
  if(afterSave){await afterSave(saved);return;}
  if(screen!=='register')changeScreen(screen);else await render();
  if(table==='products'&&!row.id) registrationContinuation(saved);
 },'OK',table==='products'?'product-dialog':table==='customers'?'customer-dialog':'supplier-dialog');
}
function contactFields(row) {
 return parts('郵便番号','postal',row.postal,2)+field('住所','address',row.address)+field('Eメール','email',row.email)+parts('電話番号','phone',row.phone,3)+parts('FAX番号','fax',row.fax,3);
}
function registrationContinuation(saved) {
 show('登録されました。','<p>続けて入力する場合は「はい」、同名商品（別価格）を再び入力する場合は「いいえ」、終了は「キャンセル」を押してください。</p><button type="button" id="continueProduct">はい</button><button type="button" id="sameProduct">いいえ</button>',null);
 $('continueProduct').onclick=()=>{close();masterEditor('products');};
 $('sameProduct').onclick=()=>{close();const copy={...saved};delete copy.id;copy.barcode='';copy.shortcut='0';masterEditor('products',copy);};
}
function tableHTML(columns,rows,attributes='') {
 return `<table class="data"><thead><tr>${columns.map(c=>`<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody ${attributes}>${rows.map(row=>`<tr data-id="${esc(row.id)}">${columns.map(c=>`<td>${esc(typeof c[1]==='function'?c[1](row):row[c[1]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
const productColumns=[['商品ID','id'],['商品名','name'],['商品名カナ','kana'],['在庫基準','stockStandard'],['販売価格',p=>yen(p.salePrice)],['仕入価格',p=>yen(p.costPrice)],['個数単位','unit'],['値引・割引',p=>p.discountTarget==='0'?'対象外':'対象'],['ポイント',p=>p.pointTarget==='0'?'対象外':'対象'],['税金','taxType'],['税率','taxRate'],['メモ','memo'],['バーコード','barcode'],['ショートカットキー','shortcut'],['部門','department'],['仕入先',p=>db.suppliers.find(s=>s.id===Number(p.supplierId))?.name||''],['店舗番号','storeNumber'],...Array.from({length:5},(_,i)=>['備考'+(i+1),'remark'+(i+1)]),['マクロファイル名','macro'],['商品画像名','image']];
function masters(table) {
 const label=table==='products'?'商品リスト':table==='suppliers'?'仕入先リスト':'顧客管理';
 const name=table==='products'?'商品':table==='suppliers'?'仕入先':'顧客';
 const columns=table==='products'?productColumns:table==='suppliers'?[['仕入先ID','id'],['仕入先名','name'],['仕入先名カナ','kana'],['郵便番号','postal'],['住所','address'],['電話番号','phone'],['FAX番号','fax'],['Eメール','email'],['備考1','remark1'],['備考2','remark2'],['備考3','remark3']]:[['顧客ID','id'],['カードID','cardId'],['顧客名','name'],['顧客名カナ','kana'],['顧客分類','category'],['入会日','joined'],['有効期限','expires'],['住所','address'],['電話番号','phone'],['値引率','discountRate']];
 $('workspace').innerHTML=`<h1>${label}</h1><div class="workspace-controls"><fieldset><legend>検索条件（一部入力可）</legend><label>名前・カナ<input id="masterQuery" aria-label="名前・カナで検索"></label><label>${name}ID<input id="masterID" aria-label="${name}ID検索"></label></fieldset><div class="commands"><button id="executeMaster">実行(J)</button><button id="newMaster">新規${name}(N)</button><button id="editMaster">項目変更</button><button id="clearMaster">クリアー(C)</button><button id="saveMaster">保存(S)</button></div></div><div class="data-grid" id="masterGrid"></div>`;
 let chosen=null,filtered=[];
 const draw=()=>{
  const key=$('masterQuery').value.toLowerCase(),id=$('masterID').value.trim();
  filtered=db[table].filter(row=>(!id||String(row.id)===id)&&[row.name,row.kana].some(s=>String(s||'').toLowerCase().includes(key)));
  $('masterGrid').innerHTML=tableHTML(columns,filtered)||'';
  $('masterGrid').querySelectorAll('tbody tr').forEach(tr=>{tr.onclick=()=>{chosen=Number(tr.dataset.id);$('masterGrid').querySelectorAll('tr').forEach(r=>r.classList.toggle('selected',r===tr));};tr.ondblclick=()=>masterEditor(table,db[table].find(r=>r.id===Number(tr.dataset.id)));});
 };
 $('newMaster').onclick=()=>masterEditor(table);
 $('editMaster').onclick=()=>{const row=db[table].find(r=>r.id===chosen);if(row)masterEditor(table,row);else status('一覧から対象を選択してください');};
 $('executeMaster').onclick=draw;$('masterQuery').oninput=draw;$('masterID').oninput=draw;
 $('clearMaster').onclick=()=>{$('masterQuery').value='';$('masterID').value='';chosen=null;draw();};
 $('saveMaster').onclick=()=>download(label+'.json',filtered);draw();
}
function customerPicker() {
 show('顧客選択',select('顧客','customerId',[['','[なし]'],...db.customers.map(c=>[c.id,c.name])],customerId||'')+'<button type="button" id="newCustomer">新規顧客</button><p class="hint">顧客を伝票に記録します。値引率・ポイント・掛売残高は未適用です。</p>',async data=>{customerId=Number(data.get('customerId'))||null;changed();await reload();close();});
 $('newCustomer').onclick=()=>{close();masterEditor('customers',{},async customer=>{customerId=customer.id;changed();await reload();});};
}
function receipt(transaction=lastTx) {
 if(!transaction)return status('点検から記録を選択するか、販売を記録してください');
 show('レシート：試作記録',`<div class="receipt">${esc('【試作・実会計用ではありません】\n伝票番号 '+transaction.id+'  '+transaction.mode+'\n'+new Date(transaction.date).toLocaleString('ja-JP')+'\n'+transaction.lines.map(l=>`${l.name}  ${l.quantity} × ${yen(l.price)}  ${yen(l.amount)}`).join('\n')+'\n合計 '+yen(transaction.total)+'\n'+(transaction.tender==null?'':`預かり ${yen(transaction.tender)}\nお釣り ${yen(transaction.change)}\n`)+(transaction.note||''))}</div>`,null);
}
function history() {
 $('workspace').innerHTML=`<h1>点検</h1><div class="inspector"><aside class="filters"><label>伝票番号（番以降）<input id="filterID" type="number" min="0" value="0"></label><label>分類<select id="filterMode"><option value="">すべて</option>${modes.map(m=>`<option>${m}</option>`).join('')}</select></label><label>担当者<input id="filterOperator"></label><label>期間開始<input id="filterFrom" type="date"></label><label>期間終了<input id="filterTo" type="date"></label><button id="executeHistory">実行(J)</button><button id="clearHistory">クリアー(C)</button><button id="reprintReceipt">レシート再表示</button><button id="reprintInvoice">領収書再発行（未実装）</button><button id="journalSave">ジャーナル保存(S)</button><button id="hourly">時間別売上表（未実装）</button></aside><section class="inspect-detail"><p class="hint">試作記録のみ。精算番号・正式なジャーナル・旧ソフトとの集計照合は未実装です。</p><div id="historyGrid" class="data-grid"></div><div id="detailGrid" class="data-grid detail-grid"></div><div id="inspectTotals" class="inspect-totals"></div></section></div>`;
 let chosen=null,filtered=[];
 const detail=transaction=>{
  chosen=transaction;lastTx=transaction;
  $('detailGrid').innerHTML=tableHTML([['番号','id'],['商品ID','productId'],['商品名','name'],['バーコード','barcode'],['税','taxType'],['税率','taxRate'],['個数','quantity'],['単価',l=>yen(l.price)],['計',l=>yen(l.amount)]],transaction.lines.map((line,i)=>({...line,id:i+1})));
  $('inspectTotals').textContent=`値引 ${yen(transaction.lines.reduce((n,l)=>n+l.discount,0))}　合計 ${yen(transaction.total)}　預かり ${transaction.tender==null?'—':yen(transaction.tender)}　お釣り ${transaction.change==null?'—':yen(transaction.change)}`;
 };
 const draw=()=>{
  const id=Number($('filterID').value),m=$('filterMode').value,operator=$('filterOperator').value,from=$('filterFrom').value,to=$('filterTo').value;
  filtered=db.transactions.filter(t=>{const date=localDate(t.date);return t.id>=id&&(!m||t.mode===m)&&(!operator||t.operator.includes(operator))&&(!from||date>=from)&&(!to||date<=to);}).slice().reverse();
  $('historyGrid').innerHTML=tableHTML([['メインID','id'],['レジ番号',t=>t.registerNumber||'1'],['伝票番号','id'],['分類','mode'],['日付・時刻',t=>new Date(t.date).toLocaleString('ja-JP')],['担当者','operator'],['顧客名',t=>t.customer?.name||''],['仕入先',t=>Array.from(new Set(t.lines.map(l=>l.supplierName).filter(Boolean))).join(',')],['項目','item'],['摘要','note']],filtered);
  $('historyGrid').querySelectorAll('tbody tr').forEach(row=>row.onclick=()=>{detail(filtered.find(t=>t.id===Number(row.dataset.id)));$('historyGrid').querySelectorAll('tr').forEach(r=>r.classList.toggle('selected',r===row));});
  if(filtered.length)detail(filtered[0]);else{$('detailGrid').innerHTML='';$('inspectTotals').textContent='該当記録なし';chosen=null;}
 };
 $('executeHistory').onclick=draw;$('clearHistory').onclick=()=>{$('filterID').value=0;['filterMode','filterOperator','filterFrom','filterTo'].forEach(id=>$(id).value='');draw();};
 $('reprintReceipt').onclick=()=>receipt(chosen);$('reprintInvoice').onclick=()=>unimplemented('領収書');$('hourly').onclick=()=>unimplemented('時間別売上表');$('journalSave').onclick=()=>download('試作ジャーナル.json',filtered);draw();
}
function localDate(date) {const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function settlement() {
 const sales=db.transactions.filter(t=>t.mode==='販売'),cashIn=db.transactions.filter(t=>t.mode==='入金'),cashOut=db.transactions.filter(t=>t.mode==='出金');
 const sum=rows=>rows.reduce((n,t)=>n+t.total,0),count=sales.reduce((n,t)=>n+t.lines.reduce((q,l)=>q+l.quantity,0),0);
 const display=(label,value)=>field(label,'',value===undefined?'未確認':value,'text',true);
 $('workspace').innerHTML=`<h1>精算</h1><p class="hint">精算の項目と配置の確認用です。既存の試作記録の全期間合計だけを表示します。締め・現金在高・過不足の算定は行いません。</p><div class="settlement-controls"><button id="settlePreview">精算点検(T)</button><button id="settleCommit">精算確定(J)（未実装）</button><button id="settleHistory">精算履歴（未実装）</button><button id="settleClear">クリアー(C)</button></div><div class="settlement-cols"><section>${display('総売上（個数）',count)}${display('（金額）',yen(sum(sales)))}${display('純売上（件数）')}${display('（金額）')}${display('入金',yen(sum(cashIn)))}${display('出金',yen(sum(cashOut)))}${display('両替回数')}${display('現金在高')}${display('レジ在高')}${display('現金過不足')}</section><section>${display('内税（金額）',yen(sales.reduce((n,t)=>n+t.lines.filter(l=>l.taxType==='内税').reduce((q,l)=>q+l.tax,0),0)))}${display('内税（対象税込）')}${display('外税（金額）')}${display('外税（対象）')}${display('非課税（対象）')}${display('返品（件数）')}${display('返品（金額）')}${display('割引合計')}${display('値引合計',yen(sales.reduce((n,t)=>n+t.lines.reduce((q,l)=>q+l.discount,0),0)))}${display('メモ')}</section><section>${display('現金売上（件数）',sales.length)}${display('（金額）',yen(sum(sales)))}${display('掛け売上（件数）')}${display('（金額）')}${display('カード売上（件数）')}${display('（金額）')}${display('商品券売上（件数）')}${display('（金額）')}${display('課金額')}</section></div>`;
 $('settlePreview').onclick=settlement;$('settleCommit').onclick=()=>unimplemented('精算確定');$('settleHistory').onclick=()=>unimplemented('精算履歴');$('settleClear').onclick=()=>{document.querySelectorAll('.settlement-cols input').forEach(input=>input.value='');status('表示だけを消去しました。記録は変更していません');};
}
function management() {
 $('workspace').innerHTML=`<h1>商品管理</h1><div class="workspace-controls"><fieldset><legend>期間</legend><label>期間開始日<input id="manageFrom" type="date"></label><label>期間終了日<input id="manageTo" type="date"></label></fieldset><fieldset><legend>検索条件</legend><label>商品名<input id="manageName"></label><label>店舗番号<input id="manageShop" value="${esc(db.settings.shopNumber)}"></label></fieldset><div class="commands"><button id="executeManagement">実行(J)</button><button id="saveManagement">保存(S)</button></div></div><p class="hint">試作記録から期間販売数・仕入数・金額を表示。在庫残高・在庫差異・利益の旧計算仕様は未確認です。</p><div id="managementGrid" class="data-grid"></div>`;
 let rows=[];
 const draw=()=>{
  const from=$('manageFrom').value,to=$('manageTo').value,key=$('manageName').value,shop=$('manageShop').value;
  const tx=db.transactions.filter(t=>(!from||localDate(t.date)>=from)&&(!to||localDate(t.date)<=to));
  rows=db.products.filter(p=>p.name.includes(key)&&(!shop||String(p.storeNumber||'1')===shop)).map(p=>{
   const sale=tx.filter(t=>t.mode==='販売').flatMap(t=>t.lines.filter(l=>l.productId===p.id)),buy=tx.filter(t=>t.mode==='現金仕入').flatMap(t=>t.lines.filter(l=>l.productId===p.id));
   return {...p,saleCount:sale.reduce((n,l)=>n+l.quantity,0),buyCount:buy.reduce((n,l)=>n+l.quantity,0),buyAmount:buy.reduce((n,l)=>n+l.amount,0)};
  });
  $('managementGrid').innerHTML=tableHTML([['商品ID','id'],['商品名','name'],['前回棚卸日',()=> '未確認'],['現在実在庫',()=> '未確認'],['現在帳簿在庫',()=> '未確認'],['在庫差異',()=> '未確認'],['総実在庫額',()=> '未確認'],['期間販売数','saleCount'],['期間総利益',()=> '未確認'],['期間仕入数','buyCount'],['期間仕入額',p=>yen(p.buyAmount)],['粗利益率',()=> '未確認']],rows);
 };
 $('executeManagement').onclick=draw;$('saveManagement').onclick=()=>download('試作商品管理.json',rows);draw();
}
function settings() {
 show('各種設定','<div class="tabs" id="settingTabs"></div><div id="settingPanel"></div>',null,'OK','wide-dialog');
 const tabs=['一般','セキュリティー','データベース','計算','メイン画面','リスト・点検・精算','管理','印刷','バーコード','カスタマディスプレイ','キャッシュドロワ','気象情報自動取得','キーボード','カード・商品券','拡張セレクトアイテム'];
 $('settingTabs').innerHTML=tabs.map(t=>`<button type="button" data-tab="${t}">${t}</button>`).join('');
 const panel=tab=>{
  $('settingTabs').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
  const s=db.settings;
  if(tab==='一般')$('settingPanel').innerHTML=`<div class="fields">${field('店舗番号','shopNumber',s.shopNumber,'number')}${field('レジ番号','registerNumber',s.registerNumber,'number')}${field('担当者','operator',s.operator)}${field('天候','weather',s.weather)}${field('気温','temperature',s.temperature)}</div>`;
  else if(tab==='メイン画面')$('settingPanel').innerHTML=`<fieldset><legend>表示</legend>${checkbox('同商品ID、同単価商品を合計表示','mergeSame',s.mergeSame)}</fieldset><fieldset><legend>商品数個別入力業務</legend>${checkbox('販売','promptSales',s.promptSales)}${checkbox('仕入','promptPurchase',s.promptPurchase)}${checkbox('移動・破棄','promptMovement',s.promptMovement)}</fieldset><p class="hint">棚卸では必ず実数量を入力します。年齢・性別の客層調査はこの試作では無効です。</p>`;
  else if(tab==='カード・商品券')$('settingPanel').innerHTML=`<div class="fields">${Array.from({length:3},(_,i)=>field('カード '+(i+1),'card'+i,s.cards[i]||'')).join('')}${Array.from({length:3},(_,i)=>field('商品券 '+(i+1),'voucher'+i,s.vouchers[i]||'')).join('')}</div><p class="hint">名称保存のみ。決済や精算への反映は未実装です。</p>`;
  else if(tab==='拡張セレクトアイテム')$('settingPanel').innerHTML=`<div class="fields">${Array.from({length:10},(_,i)=>field(String(i+1),'select'+i,s.selectItems[i]||'')).join('')}</div><p class="hint">名称保存のみ。動作の割当は未実装です。</p>`;
  else if(tab==='計算')$('settingPanel').innerHTML='<p>画像で税端数「切り捨て」、税率10%・8%、内税方式の選択を確認しています。</p><p class="hint">現在は明細単位の切り捨てによる仮計算です。合算単位・仕入時の計算は未確認。設定を変更しても税計算を確定仕様にはしません。</p>';
  else if(tab==='キーボード')$('settingPanel').innerHTML='<p>販売F1、カードF2、商品券F3、掛売F4、割販F5、入金F6、出金F7、現金仕入F8、掛仕入F9、棚卸F10。個数修正Esc、削除End、値引Home、カウントアップInsert、全削除Delete、商品情報F12、顧客Pause、決定Enter。</p><p class="hint">割当変更、Ctrl単独、ハード機器のキー互換は未実装です。</p>';
  else $('settingPanel').innerHTML='<p class="hint">'+esc(tab)+'の設定処理は未実装です。原画像の項目を参照し、必要な値・機器・挙動を追加確認して実装します。</p>';
  dialogHandler=async data=>{
   const body=Object.fromEntries(data);
   if(tab==='メイン画面')for(const key of ['mergeSame','promptSales','promptPurchase','promptMovement'])body[key]=data.has(key);
   if(tab==='カード・商品券'){body.cards=Array.from({length:3},(_,i)=>data.get('card'+i));body.vouchers=Array.from({length:3},(_,i)=>data.get('voucher'+i));}
   if(tab==='拡張セレクトアイテム')body.selectItems=Array.from({length:10},(_,i)=>data.get('select'+i));
   await api('settings',body);await reload();close();status('設定を保存しました');
  };
  $('ok').hidden=!['一般','メイン画面','カード・商品券','拡張セレクトアイテム'].includes(tab);
 };
 $('settingTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>panel(b.dataset.tab));panel('一般');
}
function drafts() {
 show('仮伝票一覧（売上・残高・在庫に未反映）',`<div class="list">${tableHTML([['番号','id'],['日時',t=>new Date(t.date).toLocaleString('ja-JP')],['モード','mode'],['状態','status'],['操作メモ','note']],db.drafts.slice().reverse())}</div><p class="hint">クリックすると明細を確認できます。正式な取引への変換は未実装です。</p>`,null,'OK','wide-dialog');
 $('dialogBody').querySelectorAll('tbody tr').forEach(tr=>tr.onclick=()=>{const draft=db.drafts.find(d=>d.id===Number(tr.dataset.id));show('仮伝票 '+draft.id+'：'+draft.mode,`<p class="hint">観察用・未確定。売上や在庫へは反映しません。</p>${tableHTML([['商品名','name'],['数量','quantity'],['単価',l=>yen(l.price)]],draft.lines)}`,null);});
}
function download(name,data) {
 const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
 const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function backup(){download('POS試作バックアップ-'+localDate(new Date())+'.json',db);status('バックアップを保存しました。復元手順はREADMEを参照してください');}
function help(){show('試作の操作と制限','<p>入力キーにバーコード・ショートカットキーを入力してEnter。商品リストから登録・編集できます。</p><p>販売・現金仕入・棚卸・通常入出金は試作記録を保存します。その他のモードは入力した仮伝票だけを保存し、売上・残高・在庫へ反映しません。</p><p>精算確定、返品、機器連携、Excelの鯉数量統合は未実装です。</p><p>原画像の配置を参照していますが、未確認の処理は仮仕様のままです。</p>',null);}

const modeOrder=[0,1,3,5,8,9,12,'exchange',4,2,10,6,7,11,13,'clear'];
$('modes').innerHTML=modeOrder.map(index=>typeof index==='number'?`<button data-mode="${modes[index]}">${modes[index]}${index<10?'(F'+(index+1)+')':''}</button>`:`<button id="${index}">${index==='clear'?'全削除(Delete)':'両替（未実装）'}</button>`).join('');
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>setMode(button.dataset.mode).catch(e=>status(e.message)));
const actionList=[['↑(Up)',()=>move(-1)],['カウントアップ(Insert)',countUp],['個数修正(Esc)',editQuantity],['削除(End)',remove],['値引(Home)',discount],['↓(Down)',()=>move(1)],['セレクトアイテム（未実装）',()=>unimplemented('セレクトアイテム')],['決定(Enter)',decide]];
actionList.forEach(([label,fn])=>{const button=document.createElement('button');button.textContent=label;if(label.startsWith('決定'))button.className='decide';button.onclick=()=>{Promise.resolve(fn()).catch(e=>status(e.message));};$('actions').append(button);});
document.querySelectorAll('[data-screen]').forEach(button=>button.onclick=()=>changeScreen(button.dataset.screen));
document.querySelectorAll('[data-unimplemented]').forEach(button=>button.onclick=()=>unimplemented(button.dataset.unimplemented));
for(const id of ['settings','operatorSettings','operatorButton'])$(id).onclick=settings;
for(const id of ['search','productInfo'])$(id).onclick=search;
$('customerButton').onclick=customerPicker;$('memory').onclick=()=>unimplemented('メモリー');
$('receipt').onclick=()=>receipt();$('invoice').onclick=()=>unimplemented('領収書');
$('exchange').onclick=()=>unimplemented('両替');$('clear').onclick=clearLines;
$('drafts').onclick=drafts;$('help').onclick=help;$('backupTool').onclick=backup;
document.addEventListener('keydown',event=>{
 if($('dialog').open||$('confirmation').open||screen!=='register'||busy)return;
 if(event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
 const match=event.key.match(/^F([1-9]|10)$/);
 if(match){event.preventDefault();setMode(modes[Number(match[1])-1]);return;}
 if(event.key==='F12'){event.preventDefault();search();return;}
 if(event.key==='F11'){event.preventDefault();unimplemented('領収書');return;}
 if(event.key==='Pause'){event.preventDefault();customerPicker();return;}
 if(event.target===$('key')&&($('key').value||event.key==='Enter')){
  if(event.key==='Enter'){event.preventDefault();if($('key').value.trim())inputKey();else decide();}return;
 }
 if(event.target!==$('key')&&(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLTextAreaElement))return;
 const actions={Enter:decide,Escape:editQuantity,End:remove,Home:discount,Insert:countUp,ArrowUp:()=>move(-1),ArrowDown:()=>move(1),Delete:clearLines};
 if(actions[event.key]){event.preventDefault();Promise.resolve(actions[event.key]()).catch(e=>status(e.message));}
});
window.addEventListener('beforeunload',event=>{if((lines.length&&!inputSaved)||busy){event.preventDefault();event.returnValue='';}});
setInterval(()=>$('clock').textContent=new Date().toLocaleString('ja-JP'),1000);
reload().then(()=>setMode('販売')).catch(error=>status('接続に失敗しました：'+error.message));


function radios(label,name,options,value){return '<div class="radio-fields" role="group" aria-label="'+esc(label)+'"><span>'+esc(label)+'</span>'+options.map(option=>'<label><input type="radio" name="'+name+'" value="'+esc(option)+'" '+(option===value?'checked':'')+'>'+esc(option)+'</label>').join('')+'</div>';}
function parts(label,name,value,count){const values=String(value||'').split('-');return '<label>'+esc(label)+'<span class="contact-parts">'+Array.from({length:count},(_,i)=>'<input name="'+name+i+'" aria-label="'+esc(label)+' '+(i+1)+'" value="'+esc(values[i]||'')+'">').join('<span>−</span>')+'</span></label>';}

$('exitHelp').onclick=()=>show('終了','<p>ブラウザーを閉じ、起動時のウィンドウでCtrl+Cを押してください。入力途中の明細は未保存です。</p>',null);
$('version').onclick=()=>show('バージョン情報','<p>Nyushukka代替POS 試作 v0.2.2。原画像参照版。旧Nyushukkaそのものではありません。</p>',null);



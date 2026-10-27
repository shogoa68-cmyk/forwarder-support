// 御見積書 PDF：航路の行で、船会社（実運送人／船社直のキャリア）が目立つこと。
//   node scripts/design-tests/pdf-carrier-test.js
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const build=routes=>p.evaluate(async routes=>{
  const f=document.getElementById('z2-routes-data');
  const d=gatherAllData();d.fields['z2-routes-data']=JSON.stringify(routes);d.fields['qf-customer']='テスト商事';
  _applyQuoteData(d);if(typeof calcLiveUpdate==='function')calcLiveUpdate();
  await new Promise(r=>setTimeout(r,400));
  const html=buildQuoteDocHTML();
  const box=document.createElement('div');box.innerHTML=typeof html==='string'?html:(html&&html.html)||'';
  return {rows:[...box.querySelectorAll('.qd-srow')].filter(r=>/航路|Route/.test(r.querySelector('.qd-sk').textContent)).map(r=>({k:r.querySelector('.qd-sk').textContent,text:r.querySelector('.qd-sv').textContent,strong:[...r.querySelectorAll('.qd-carrier')].map(e=>e.textContent)}))};
 },routes);
 // 1) 代理店が船会社として立ち回る航路
 let r=await build([{pol:'TAIPEI',pod:'YOKOHAMA',carrier:'Evergreen Logistics Corp (Taipei)',carrierRole:'agent',actualCarrier:'Evergreen',enabled:true}]);
 ok('代理店 as 船会社：実運送人（Evergreen）だけが強調される',r.rows.length===1&&JSON.stringify(r.rows[0].strong)==='["Evergreen"]'&&/Evergreen Logistics Corp \(Taipei\) \[代理店\] as Evergreen/.test(r.rows[0].text.replace(/\s+/g,' ')),r);
 ok('表記（契約先・役割・as・航路）は従来どおり',/TAIPEI → YOKOHAMA/.test(r.rows[0].text),r);
 // 2) 船社直
 r=await build([{pol:'TAIPEI',pod:'YOKOHAMA',carrier:'ONE',service:'FP1',carrierRole:'direct',enabled:true}]);
 ok('船社直：キャリア名（ONE）が強調される',JSON.stringify(r.rows[0].strong)==='["ONE"]'&&/ONE \(FP1\) \[船社直\]/.test(r.rows[0].text),r);
 // 3) 代理店だが船会社が未入力
 r=await build([{pol:'TAIPEI',pod:'YOKOHAMA',carrier:'ABC Logistics',carrierRole:'agent',enabled:true}]);
 ok('代理店で船会社が分からないときは、強調しない',r.rows[0].strong.length===0,r);
 // 4) 役割の指定なし（キャリアのみ）
 r=await build([{pol:'TAIPEI',pod:'YOKOHAMA',carrier:'COSCO',enabled:true}]);
 ok('役割の指定なしのキャリアは船会社として強調される',JSON.stringify(r.rows[0].strong)==='["COSCO"]',r);
 // 5) 特殊文字は無害化
 r=await build([{pol:'A<b>',pod:'B',carrier:'X&Y <i>',carrierRole:'agent',actualCarrier:'Ever<script>green',enabled:true}]);
 ok('特殊文字（< & >）は HTML として解釈されない',r.rows[0].strong[0]==='Ever<script>green'&&/X&Y <i>/.test(r.rows[0].text),r);
};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:+process.env.W||1400,height:1000},locale:'ja-JP'});
 await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},process.env.MODE||'detail');
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.addStyleTag({content:'*{caret-color:transparent!important;} *,*::before,*::after{animation:none!important;transition:none!important;}'});
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1000);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 await p.evaluate(()=>{setTransport('fcl')});
 // 明細（架空）：サブコン3社・7行。通貨違い・単位違いを含む
 const rows=[['海上運賃','A海運','ocean',"40'GP/HQ",2,1200,300,'USD'],['BAF','A海運','surcharge','CNTR',2,80,20,'USD'],['THC','Bローカル','export-local',"20'GP",1,32000,5000,'JPY'],['ドキュメント費','Bローカル','export-local','B/L',1,8000,2000,'JPY'],['通関料','C通関','customs-export','shipment',1,12000,3000,'JPY'],['輸出者検査','C通関','customs-export','CBM',3.5,2500,500,'JPY'],['配送費','D運輸','domestic',"40'GP",1,45000,8000,'JPY']];
 for(let i=0;i<rows.length;i++){
  if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(80);}
  const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  const r=rows[i];
  await f('nm').fill(r[0]);await f('sv').fill(r[1]);await f('cat').selectOption(r[2],{force:true}).catch(()=>{});
  await f('un').fill(r[3]);await f('pq').fill(String(r[4]));
  await f('pc').selectOption(r[7],{force:true}).catch(()=>{});await f('bc').selectOption(r[7],{force:true}).catch(()=>{});
  await f('pp').fill(String(r[5]));await f('mk').fill(String(r[6]));await f('mk').blur();
 }
 await p.waitForTimeout(1500);
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());await p.waitForTimeout(300);
 await run(p);
 console.log('errors',JSON.stringify(errs));await b.close();srv.close();})();
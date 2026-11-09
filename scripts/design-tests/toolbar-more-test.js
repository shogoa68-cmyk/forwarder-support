// 見積入力の上部ツールバー：元に戻す・やり直す／メール取込／サブコン依頼メール／表示サイズ／表示モードを「⋯」へ集約。
//   node scripts/design-tests/toolbar-more-test.js           （現行）
//   THEME=1 node scripts/design-tests/toolbar-more-test.js   （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const run=async(label,mode,w)=>{
  const ctx=await b.newContext({viewport:{width:w||1400,height:900},locale:'ja-JP'});
  await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},mode);
  if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
  await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  const vis=await p.evaluate(()=>{const v=s=>{const e=document.querySelector(s);return !!e&&e.offsetParent!==null&&getComputedStyle(e).display!=='none';};return {undo:v('#btnQuoteUndo'),redo:v('#btnQuoteRedo'),mail:[...document.querySelectorAll('#saveToolbar .save-btn-import')].some(e=>e.offsetParent!==null),scale:v('#saveToolbar .tb-segrow-inline'),uim:v('#saveToolbar .uim-switch--tb'),more:v('#saveToolbar .tb-menu .save-btn-menu'),back:v('#qmDash')};});
  ok(label+'：赤枠の項目はツールバーから消え、「⋯」と「ダッシュボードに戻る」は残る',!vis.undo&&!vis.redo&&!vis.mail&&!vis.scale&&!vis.uim&&vis.more&&vis.back,vis);
  await p.click('#saveToolbar .tb-menu .save-btn-menu');await p.waitForTimeout(200);
  const m=await p.evaluate(()=>{const pn=document.getElementById('tbMenuMore');const vis=e=>e&&e.offsetParent!==null;const t=[...pn.querySelectorAll('.tb-mi-title')].filter(vis).map(e=>e.textContent.trim());const r=pn.getBoundingClientRect();return {titles:t,right:Math.round(r.right),w:innerWidth,undoDis:document.getElementById('btnQuoteUndoMenu').disabled};});
  ok(label+'：「⋯」の中に 7 項目（元に戻す・やり直す・メール取込・サブコン依頼メール・表示の大きさ・表示モード・使い方）',['元に戻す','やり直す','メール取込','サブコン依頼メール','表示の大きさ','表示モード','このタブの使い方・機能説明'].every(x=>m.titles.includes(x))&&m.right<=m.w,m);
  await p.screenshot({path:`${OUT}/toolbar-more-${label}.png`,clip:{x:0,y:0,width:w||1400,height:560}});
  // 動作：表示サイズ・表示モード・メール取込
  await p.click('#tbMenuMore .layout-scale-btn[data-scale="lg"]');await p.waitForTimeout(200);
  ok(label+'：メニューの「大」で表示サイズが変わる',await p.evaluate(()=>[...document.querySelectorAll('.layout-scale-btn[data-scale="lg"]')].every(b=>b.classList.contains('is-on')||b.classList.contains('active')||b.getAttribute('aria-pressed')==='true')||/lg/.test(document.documentElement.className+document.body.className+(document.getElementById('tab-quote-make')||{}).className)),null);
  await p.click('#tbMenuMore .uim-switch [data-uim="simple"]');await p.waitForTimeout(300);
  const sm=await p.evaluate(()=>({simple:document.documentElement.classList.contains('mode-simple'),on:[...document.querySelectorAll('#tbMenuMore .uim-switch button.is-on')].map(b=>b.dataset.uim)}));
  ok(label+'：メニューの「かんたん表示」で切り替わり、メニュー内の選択も追従する',sm.simple&&sm.on.join()==='simple',sm);
  await p.click('#tbMenuMore .uim-switch [data-uim="detail"]');await p.waitForTimeout(300);
  ok(label+'：「詳細表示」へ戻せる',await p.evaluate(()=>!document.documentElement.classList.contains('mode-simple')),null);
  if(!await p.evaluate(()=>document.querySelector('#saveToolbar .tb-menu').classList.contains('is-open')))await p.click('#saveToolbar .tb-menu .save-btn-menu');
  await p.click('#tbMenuMore [onclick*="openEmailImport"]');await p.waitForTimeout(400);
  ok(label+'：メニューの「メール取込」でモーダルが開く',await p.evaluate(()=>{const e=document.getElementById('emailImportModal')||document.querySelector('[id*="emailImport"]');return !!e&&getComputedStyle(e).display!=='none'&&e.offsetParent!==null||!!document.querySelector('.modal-overlay.open, .ei-overlay.open, #eiOverlay.open');}),null);
  await p.evaluate(()=>{document.querySelectorAll('.open').forEach(e=>{if(/modal|overlay/i.test(e.className+e.id))e.classList.remove('open');});});
  ok(label+'：JS エラーなし',errs.length===0,errs);
  await ctx.close();
 };
 await run('detail','detail');
 await run('simple','simple');
 await run('mobile','detail',390);
 // 元に戻す：入力 → メニューの「元に戻す」が使える
 {
  const ctx=await b.newContext({viewport:{width:1400,height:900},locale:'ja-JP'});
  if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
  await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  await p.evaluate(()=>{window.addRow();});await p.waitForTimeout(800);
  const n1=await p.evaluate(()=>document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])').length);
  const dis=await p.evaluate(()=>({u:document.getElementById('btnQuoteUndoMenu').disabled,orig:document.getElementById('btnQuoteUndo').disabled}));
  ok('操作のあとは、メニューの「元に戻す」が押せる（元のボタンと状態が一致）',dis.u===dis.orig&&!dis.u,dis);
  await p.click('#saveToolbar .tb-menu .save-btn-menu');await p.waitForTimeout(150);
  await p.click('#btnQuoteUndoMenu');await p.waitForTimeout(700);
  const n2=await p.evaluate(()=>document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])').length);
  const after=await p.evaluate(()=>({closed:!document.querySelector('#saveToolbar .tb-menu').classList.contains('is-open'),redo:!document.getElementById('btnQuoteRedoMenu').disabled}));
  ok('メニューから元に戻すと行が減り、メニューが閉じ、「やり直す」が押せるようになる',n2<n1&&after.closed&&after.redo,{n1,n2,after});
  await ctx.close();
 }
 await b.close();srv.close();
})();

// 左端のセクションナビ（管理番号〜費用テーブル）と、費用テーブルの縮小表示になった右パネル。
//   THEME=1 node scripts/design-tests/section-nav-test.js
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const nav=()=>p.evaluate(()=>{const n=document.getElementById('qSecNav');const bx=n.querySelector('.q-secnav-box');const r=bx.getBoundingClientRect();const cs=getComputedStyle(bx);const btns=[...n.querySelectorAll('.q-secnav-btn')];const tab=document.getElementById('tab-quote-make');const main=document.querySelector('#tab-quote-make .quote-workspace, #tab-quote-make .container');const mr=main?main.getBoundingClientRect():{left:0};return {shown:n.offsetParent!==null||cs.position==='fixed',pos:cs.position,left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),n:btns.length,labels:btns.map(b=>b.querySelector('em').textContent),filled:btns.filter(b=>b.classList.contains('is-filled')).map(b=>b.dataset.sec),cur:(btns.find(b=>b.classList.contains('is-current'))||{dataset:{}}).dataset.sec,mainLeft:Math.round(mr.left)};});
 await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(500);
 let n0=await nav();
 const covTop=await p.evaluate(()=>{const bs=[...document.querySelectorAll('#qSecNav .q-secnav-btn')];return bs.filter(b=>{const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !(e&&(e===b||b.contains(e)));}).map(b=>b.dataset.sec);});
 ok('ページの最上段でも、7 項目すべてが隠れずに押せる（ヘッダー・タブ・ツールバーの下に潜らない）',covTop.length===0,covTop);
 ok('左端にナビがある（7 項目）',n0.pos==='absolute'&&n0.left<=24&&n0.n===7&&n0.labels.join()==='管理番号,貿易条件,貨物情報,物量情報,作業範囲,リマーク,費用',n0);
 ok('本文はナビと重ならない（ナビの右端より右から始まる）',n0.mainLeft>=n0.right-2,n0);
 ok('費用テーブルに明細があるので「入力済み」の印が付く',n0.filled.includes('section-table'),n0);
 // クリックでそのセクションへ（畳まれていれば開く）
 await p.evaluate(()=>{document.getElementById('section-volume').classList.add('collapsed');});await p.waitForTimeout(200);
 const collapsedBefore=await p.evaluate(()=>document.getElementById('section-volume').classList.contains('collapsed'));
 await p.locator('#qSecNav [data-sec="section-volume"]').click();await p.waitForTimeout(700);
 const r1=await p.evaluate(()=>{const s=document.getElementById('section-volume');const r=s.getBoundingClientRect();return {top:Math.round(r.top),collapsed:s.classList.contains('collapsed')};});
 ok('押すと、畳まれたセクション（物量情報）が開いて、画面の上のほうに出る',collapsedBefore&&!r1.collapsed&&r1.top>=0&&r1.top<400,{collapsedBefore,r1});
 await p.locator('#qSecNav [data-sec="section-table"]').click();await p.waitForTimeout(800);
 const r2=await p.evaluate(()=>{const r=document.getElementById('section-table').getBoundingClientRect();return Math.round(r.top);});
 ok('「費用」を押すと、費用テーブルへ移る',r2>=0&&r2<400,r2);
 const n1=await nav();
 ok('いま見ているセクション（費用テーブル）が強調される',n1.cur==='section-table',n1);
 ok('スクロールすると、ナビは画面の上のほうに付いてくる（ツールバーの下）',n1.top>=60&&n1.top<260&&n1.left===n0.left,{n0,n1});
 const covered=await p.evaluate(()=>{const bs=[...document.querySelectorAll('#qSecNav .q-secnav-btn')];return bs.filter(b=>{const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !(e&&(e===b||b.contains(e)));}).map(b=>b.dataset.sec);});
 ok('スクロール中も、7 項目すべてが他の部品に隠れずに押せる',covered.length===0,covered);
 // 右パネル：費用テーブルの縮小表示に一本化
 const rp=await p.evaluate(()=>{const d=document.getElementById('qspSectionDigest');return {rows:[...d.querySelectorAll('.qsp-dig-row')].map(r=>r.querySelector('.qsp-dig-name').textContent.trim()),groups:d.querySelectorAll('.qsp-dig-subjump').length,tab:(document.getElementById('qspTabBtn-digest')||{}).textContent,rail:[...document.querySelectorAll('#qrcRail .qrc-rail-btn')].map(b=>b.title)};});
 ok('右パネルは費用テーブルの行とツリーだけ（管理番号〜全体リマークの要約は無い）',rp.rows.length===1&&/費用テーブル/.test(rp.rows[0])&&rp.groups>0,rp);
 ok('右パネルの名前が「費用テーブル」になっている',/費用テーブル/.test(rp.tab||'')&&rp.rail.some(t=>/費用テーブル/.test(t))&&!rp.rail.some(t=>t==='ジャンプ'),rp);
 // 狭い画面：上に付く横並び
 await p.setViewportSize({width:900,height:900});await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(500);
 const nn=await nav();
 ok('狭い画面（900px）では、固定をやめて、編集画面の上の横並びのリンクに切り替わる',nn.pos==='static'&&nn.n===7&&nn.right>600,nn);
 await p.screenshot({path:process.env.SHOT||'/tmp/nav.png'});
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
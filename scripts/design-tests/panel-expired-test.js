// 期間外（適用期間が過ぎた）サーチャージ・「見積書に出さない」行でも、Industry の「その他 ▾」パネルが開いて操作できること。
//   THEME=1 node scripts/design-tests/panel-expired-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p,OUT)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 // 行1（BAF）を期間外に（有効期間を過去に）
 await row(1).locator('.row-detail-btn').click();await p.waitForTimeout(200);
 await row(1).locator('[data-field="vf"]').fill('2020-01-01');await row(1).locator('[data-field="vt"]').fill('2020-01-31');
 await row(1).locator('[data-field="vt"]').dispatchEvent('change');await p.waitForTimeout(500);
 const st=await p.evaluate(()=>{const tr=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1];return {oor:tr.classList.contains('row-out-of-range'),open:tr.classList.contains('is-detail-open')}});
 console.log('state',JSON.stringify(st));
 await p.keyboard.press('Escape');await p.mouse.click(5,5);await p.waitForTimeout(200);
 // 開く→パネルの上でクリックできるか
 await row(1).locator('.row-detail-btn').click();await p.waitForTimeout(300);
 const info=await p.evaluate(()=>{
  const tr=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1];
  const pn=tr.querySelector('.row-detail-panel');const r=pn.getBoundingClientRect();
  const pts=[[r.left+r.width*0.3,r.top+r.height*0.5],[r.left+r.width*0.6,r.top+r.height*0.3],[r.left+200,r.bottom-12]];
  return {vis:r.height>0&&getComputedStyle(pn).display!=='none',h:r.height,hits:pts.map(([x,y])=>{const e=document.elementFromPoint(x,y);return !!(e&&pn.contains(e))})};
 });
 ok('期間外の行：パネルが開く',info.vis,info);
 ok('期間外の行：パネルが他の行の下に隠れない（中身にヒットする）',info.hits.every(Boolean),info);
 await p.screenshot({path:OUT+'/expired-panel.png',clip:await p.evaluate(()=>{const r=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1].getBoundingClientRect();return {x:0,y:Math.max(0,r.top-10),width:1000,height:440}})});
 // 操作できる：期間欄をクリアできる
 await row(1).locator('[data-field="vf"]').fill('');await row(1).locator('[data-field="vt"]').fill('');await row(1).locator('[data-field="vt"]').dispatchEvent('change');await p.waitForTimeout(400);
 ok('期間をクリアすると期間外が解除される',await p.evaluate(()=>!document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1].classList.contains('row-out-of-range')));
 // 「見積書に出さない」行
 await p.keyboard.press('Escape');await p.mouse.click(5,5);
 await row(3).locator('td.handle-cell .drag-handle').hover();await row(3).locator('.row-hidequote-btn').click();await p.waitForTimeout(300);await p.mouse.click(5,5);
 await row(3).locator('.row-detail-btn').click();await p.waitForTimeout(300);
 const info2=await p.evaluate(()=>{const tr=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[3];const pn=tr.querySelector('.row-detail-panel');pn.scrollIntoView({block:'center'});const r=pn.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width*0.3,r.top+r.height*0.5);return {hidden:tr.classList.contains('row-hidden-quote'),hit:!!(e&&pn.contains(e)),open:tr.classList.contains('is-detail-open'),rect:[r.left,r.top,r.width,r.height],cover:e&&(e.tagName+'.'+e.className)}});
 ok('「見積書に出さない」行でもパネルが操作できる',info2.hidden&&info2.hit,info2);
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
 await run(p,OUT);
 console.log('errors',JSON.stringify(errs));
 await b.close();srv.close();
})();

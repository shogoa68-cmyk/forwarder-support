// 売値ベースのオン／オフ（行の「売値ベース」ボタン）の確認。THEME=1 で Industry（「その他 ▾」パネル内のボタン）
//   THEME=1 node scripts/design-tests/sell-mode-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p,OUT)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+x));
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 const v=(i,f)=>row(i).locator(`[data-field="${f}"]`).inputValue();
 const ro=(i,f)=>row(i).locator(`[data-field="${f}"]`).evaluate(e=>e.readOnly);
 const click=i=>row(i).locator('.sell-mode-btn').evaluate(e=>e.click());
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 // 行0：仕入 1200／乗せ幅 300／売 1500（USD）
 ok('ボタンがある',await row(0).locator('.sell-mode-btn').count()===1);
 ok('通常：乗せ幅は編集可・売値は表示専用',!(await ro(0,'mk'))&&(await ro(0,'bp')));
 await click(0);await p.waitForTimeout(200);
 ok('ON：ppmode=sell',(await v(0,'ppmode'))==='sell');
 ok('ON：乗せ幅は表示専用・売値は編集可',(await ro(0,'mk'))&&!(await ro(0,'bp')));
 ok('ON：売値・乗せ幅は変わらない',(await v(0,'bp'))==='1500'&&(await v(0,'mk'))==='300',(await v(0,'bp'))+'/'+(await v(0,'mk')));
 await row(0).locator('[data-field="bp"]').fill('1700');await row(0).locator('[data-field="bp"]').dispatchEvent('input');await p.waitForTimeout(200);
 ok('売値1700 → 乗せ幅500（自動）',(await v(0,'mk'))==='500',await v(0,'mk'));
 ok('ボタンが ON 表示',await row(0).locator('.sell-mode-btn').evaluate(e=>e.classList.contains('is-on')));
 await click(0);await p.waitForTimeout(200);
 ok('OFF：ppmode が空',(await v(0,'ppmode'))==='');
 ok('OFF：売値1700のまま・乗せ幅500',(await v(0,'bp'))==='1700'&&(await v(0,'mk'))==='500',(await v(0,'bp'))+'/'+(await v(0,'mk')));
 ok('OFF：乗せ幅は編集可・売値は表示専用',!(await ro(0,'mk'))&&(await ro(0,'bp')));
 await row(0).locator('[data-field="mk"]').fill('100');await row(0).locator('[data-field="mk"]').dispatchEvent('input');await p.waitForTimeout(200);
 ok('通常に戻り 乗せ幅100 → 売値1300（仕入1200＋100）',(await v(0,'bp'))==='1300',await v(0,'bp'));
 // 仕入が空欄のまま OFF
 await click(1);await p.waitForTimeout(150);
 await row(1).locator('[data-field="pp"]').fill('');await row(1).locator('[data-field="pp"]').dispatchEvent('input');
 await row(1).locator('[data-field="bp"]').fill('900');await row(1).locator('[data-field="bp"]').dispatchEvent('input');await p.waitForTimeout(150);
 await click(1);await p.waitForTimeout(250);
 ok('仕入空欄でOFF：売値900が消えない（仕入0・乗せ幅900）',(await v(1,'bp'))==='900'&&(await v(1,'pp'))==='0'&&(await v(1,'mk'))==='900',[await v(1,'bp'),await v(1,'pp'),await v(1,'mk')].join('/'));
 // % モード中は ON にできない
 await row(2).locator('.pct-mode-btn').evaluate(e=>e.click());await p.waitForTimeout(200);
 await click(2);await p.waitForTimeout(200);
 ok('% モード中は売値ベースにならない',(await v(2,'ppmode'))==='pct',await v(2,'ppmode'));
 await row(2).locator('.pct-mode-btn').evaluate(e=>e.click());
 // 通貨違い（独立モード）は ON にできない
 await row(3).locator('[data-field="bc"]').selectOption('USD',{force:true});await p.waitForTimeout(300);
 await click(3);await p.waitForTimeout(200);
 ok('通貨違いの行は売値ベースにならない',(await v(3,'ppmode'))==='',await v(3,'ppmode'));
 // 保存→復元（ON の状態）
 await click(4);await p.waitForTimeout(200);
 const data=await p.evaluate(()=>JSON.stringify(gatherAllData()));
 await p.evaluate(()=>{document.getElementById('tableBody').innerHTML='';});
 await p.evaluate(d=>{_applyQuoteData(JSON.parse(d))},data);await p.waitForTimeout(800);
 ok('復元：売値ベースの行',await row(4).evaluate(e=>e.classList.contains('row-sell-mode')),'');
 ok('復元：ボタン ON 表示',await row(4).locator('.sell-mode-btn').evaluate(e=>e.classList.contains('is-on')));
 await click(4);await p.waitForTimeout(200);
 ok('復元後も OFF にできる',(await v(4,'ppmode'))===''&&!(await row(4).evaluate(e=>e.classList.contains('row-sell-mode'))));
 if(process.env.THEME){
  await row(5).locator('.row-detail-btn').click();await p.waitForTimeout(150);
  ok('Industry：パネル内にボタン',await row(5).locator('.row-detail-panel .sell-mode-btn').isVisible());
  await row(5).locator('.row-detail-panel .sell-mode-btn').click();await p.waitForTimeout(250);
  ok('Industry：バッジ1',(await row(5).locator('.used-badge').textContent())==='1');
  await p.screenshot({path:OUT+'/sell-panel.png',clip:await p.evaluate(()=>{const r=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[5].getBoundingClientRect();return {x:0,y:Math.max(0,r.top-10),width:1100,height:420}})});
 }
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

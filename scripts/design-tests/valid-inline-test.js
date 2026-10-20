// 有効期間（サーチャージ）を、「その他 ▾」を開かなくても行の中で見て直せること（Industry）。  THEME=1 node scripts/design-tests/valid-inline-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p,OUT)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 // サーチャージ行（行1）：開かずに有効期間を入力できる
 ok('サーチャージ行は有効期間が行の中にある（パネルを開かずに見える）',await row(1).locator('td.name-cell > .w-valid').isVisible());
 await row(1).locator('td.name-cell > .w-valid [data-field="vf"]').fill('2026-10-01');await row(1).locator('td.name-cell > .w-valid [data-field="vt"]').fill('2026-10-31');
 await row(1).locator('[data-field="vt"]').dispatchEvent('change');await p.waitForTimeout(400);
 ok('入力しても行の中に残る',await row(1).locator('td.name-cell > .w-valid').isVisible());
 ok('値が保存される',(await row(1).locator('[data-field="vf"]').inputValue())==='2026-10-01');
 ok('バッジに数えない（パネルの中身ではない）',(await row(1).locator('.used-badge').textContent())==='');
 await p.screenshot({path:OUT+'/valid-inline.png',clip:await p.evaluate(()=>{const r=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1].getBoundingClientRect();return {x:0,y:Math.max(0,r.top-10),width:560,height:190}})});
 // 過去の期間 → 期間外
 await row(1).locator('td.name-cell > .w-valid [data-field="vf"]').fill('2020-01-01');await row(1).locator('td.name-cell > .w-valid [data-field="vt"]').fill('2020-01-31');await row(1).locator('[data-field="vt"]').dispatchEvent('change');await p.waitForTimeout(400);
 ok('期間外の行：行の中の期間が赤',await row(1).evaluate(e=>e.classList.contains('row-out-of-range')));
 await p.screenshot({path:OUT+'/valid-inline-expired.png',clip:await p.evaluate(()=>{const r=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1].getBoundingClientRect();return {x:0,y:Math.max(0,r.top-10),width:560,height:190}})});
 // 通常の行（海上運賃）はパネルの中・3段のまま
 ok('通常の行は 3 段（120px）のまま・有効期間はパネル内',await row(0).evaluate(e=>Math.round(e.getBoundingClientRect().height)<=130)&&await row(0).locator('.row-detail-panel .w-valid').count()===1);
 // 通常の行で期間を入れると行の中へ移る／カテゴリをサーチャージにしても行の中
 await row(0).locator('.row-detail-btn').click();await p.waitForTimeout(150);
 await row(0).locator('.row-detail-panel [data-field="vf"]').fill('2026-10-05');await p.waitForTimeout(400);
 ok('期間を入れると行の中へ移る（バッジは 0）',await row(0).locator('td.name-cell > .w-valid').count()===1&&await row(0).evaluate(e=>e.classList.contains('has-valid-inline')));
 await row(0).locator('td.name-cell > .w-valid [data-field="vf"]').fill('');await row(0).locator('td.name-cell > .w-valid [data-field="vt"]').fill('');await row(0).locator('[data-field="vt"]').dispatchEvent('change');await p.waitForTimeout(400);
 ok('期間を消すとパネルへ戻る',await row(0).locator('.row-detail-panel .w-valid').count()===1&&!(await row(0).evaluate(e=>e.classList.contains('has-valid-inline'))));
 // 保存→復元
 await row(1).locator('td.name-cell > .w-valid [data-field="vf"]').fill('2026-10-01');await row(1).locator('[data-field="vf"]').dispatchEvent('change');
 const data=await p.evaluate(()=>JSON.stringify(gatherAllData()));
 await p.evaluate(()=>{document.getElementById('tableBody').innerHTML='';});
 await p.evaluate(d=>{_applyQuoteData(JSON.parse(d))},data);await p.waitForTimeout(800);
 ok('復元後も、期間のある行は行の中',await row(1).locator('td.name-cell > .w-valid').isVisible()&&(await row(1).locator('[data-field="vf"]').inputValue())==='2026-10-01');
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

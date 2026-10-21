// グレーアウトした行（見積書に出さない・期間外・入力完了・要調査）でも、つまみ列の操作ボタン（解除・複製・削除など）が押せること（Industry）。
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p,OUT)=>{
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 // グレーアウトの状態を作る
 const click=async(i,sel)=>{await row(i).locator('td.handle-cell .drag-handle').hover();await row(i).locator(sel).click();await p.waitForTimeout(250);await p.mouse.click(5,5);};
 await click(0,'.row-hidequote-btn');   // 見積書に出さない
 await click(2,'.row-done-btn');        // 入力完了
 await click(3,'.row-pending-btn');     // 要調査
 await row(1).locator('td.name-cell > .w-valid [data-field="vf"]').fill('2020-01-01');await row(1).locator('td.name-cell > .w-valid [data-field="vt"]').fill('2020-01-31');await row(1).locator('[data-field="vt"]').dispatchEvent('change');await p.waitForTimeout(400);   // 期間外
 const states=[[0,'見積書に出さない','row-hidden-quote'],[1,'期間外','row-out-of-range'],[2,'入力完了','row-input-done'],[3,'要調査','row-pending']];
 for(const [i,label,cls] of states){
  ok(label+'：状態が付いている',await row(i).evaluate((e,c)=>e.classList.contains(c),cls));
  await row(i).locator('td.handle-cell .drag-handle').hover();await p.waitForTimeout(250);
  const r=await row(i).evaluate(tr=>{const acts=tr.querySelector('.row-acts');const out={};['row-hidequote-btn','row-pending-btn','row-done-btn','row-add-btn','row-dup-btn','row-del-btn'].forEach(c=>{const b=acts.querySelector('.'+c);const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);out[c]=!!(e&&(e===b||b.contains(e)))});return out});
  ok(label+'：行の操作ボタン6つがすべて押せる（次の行に隠れない）',Object.values(r).every(Boolean),r);
 }
 // 実際に操作：非表示の解除・複製
 await row(0).locator('td.handle-cell .drag-handle').hover();await row(0).locator('.row-hidequote-btn').click({timeout:3000});await p.waitForTimeout(250);
 ok('非表示を解除できる',!(await row(0).evaluate(e=>e.classList.contains('row-hidden-quote'))));
 const n0=await p.locator(rows).count();
 await row(1).locator('td.handle-cell .drag-handle').hover();await row(1).locator('.row-dup-btn').click({timeout:3000});await p.waitForTimeout(400);
 ok('期間外の行を複製できる',(await p.locator(rows).count())===n0+1);
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

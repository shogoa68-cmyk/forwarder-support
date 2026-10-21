// つまみ列にホバーして出る操作メニューの「あそび」：外れても約0.6秒は消えない／メニューの上にいる間は消えない／離れて待てば消える（Industry。アニメーションを有効にして試す）。
//   THEME=1 node scripts/design-tests/acts-grace-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p,OUT)=>{
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 const vis=i=>row(i).evaluate(tr=>{const a=tr.querySelector('.row-acts');const cs=getComputedStyle(a);return {v:cs.visibility,o:+cs.opacity}});
 const shown=async i=>{const s=await vis(i);return s.v==='visible'&&s.o>0.5};
 await row(1).locator('td.handle-cell .drag-handle').hover();await p.waitForTimeout(300);
 ok('つまみに乗せると出る',await shown(1),await vis(1));
 // つまみから外れる（同じ行の品名へ）
 await row(1).locator('.w-name').hover();
 await p.waitForTimeout(250);
 ok('外れた直後（0.25秒）はまだ消えない',await shown(1),await vis(1));
 await p.waitForTimeout(1000);
 ok('外れて約1.3秒後には消える',!(await shown(1)),await vis(1));
 // 外れてすぐ戻る → 残る
 await row(1).locator('td.handle-cell .drag-handle').hover();await p.waitForTimeout(200);
 await row(1).locator('.w-name').hover();await p.waitForTimeout(250);
 await row(1).locator('td.handle-cell .drag-handle').hover();await p.waitForTimeout(900);
 ok('すぐ戻れば残る',await shown(1),await vis(1));
 // ボタンへ移る（つまみ→メニューのボタン）：消えずに押せる
 const btn=row(1).locator('.row-dup-btn');
 const bb=await btn.boundingBox();
 await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2,{steps:8});await p.waitForTimeout(1200);
 ok('メニューの上にいる間は消えない',await shown(1),await vis(1));
 const n0=await p.locator(rows).count();
 await btn.click();await p.waitForTimeout(400);
 ok('メニューのボタンが押せる（複製）',(await p.locator(rows).count())===n0+1);
 // つまみ→斜めに外れる（メニューに入らず）→ 少し待つと消える
 await p.mouse.move(600,20);await p.waitForTimeout(1300);
 ok('離れて待てば消える',!(await shown(1)),await vis(1));
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

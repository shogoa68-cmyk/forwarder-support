#!/usr/bin/env node
// 見積テーブル（明細表）の見た目の確認用画像を生成する（架空データ・実サーバーには接続しない）。
//   OUT=<dir> THEME=1 MODE=detail|simple node scripts/sample-table-shots.js
//   → <OUT>/t1-table.png（表全体）／t2-hover-handle.png（つまみ付近の操作）／t3-hover-price.png（行ホバーのフラグ群）
//     t4-hover-group.png（サブコン見出しのホバー）／t5-footer.png（全体合計）／t6-qty-unit.png（数量・単位）
// Playwright と Chromium が必要。
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||path.resolve(__dirname,'..','docs','design-handoff','requests','table');
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root=path.resolve(__dirname,'..');
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
 const wrap='#tableScrollWrap';
 await p.locator('#section-table').screenshot({path:OUT+'/t1-table.png'});
 const row=i=>p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(i);
 await row(1).locator('td.handle-cell .drag-handle').hover();await p.waitForTimeout(250);
 await p.screenshot({path:OUT+'/t2-hover-handle.png',clip:await p.evaluate(()=>{const r=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1].getBoundingClientRect();return {x:0,y:Math.max(0,r.top-30),width:1000,height:300}})});
 await row(2).locator('td.price-cell').hover();await p.waitForTimeout(250);
 await p.screenshot({path:OUT+'/t3-hover-price.png',clip:await p.evaluate(()=>{const r=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[2].getBoundingClientRect();return {x:500,y:Math.max(0,r.top-20),width:900,height:260}})});
 await p.locator('#tableBody tr.subcon-group-header').nth(1).hover();await p.waitForTimeout(250);
 await p.locator('#tableBody tr.subcon-group-header').nth(1).screenshot({path:OUT+'/t4-hover-group.png'});
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(0).locator('td.qty-cell').screenshot({path:OUT+'/t6-qty-unit.png'});
 await p.locator('tfoot tr.tot-row').first().scrollIntoViewIfNeeded();await p.waitForTimeout(200);
 await p.locator('#quoteTable tfoot').screenshot({path:OUT+'/t5-footer.png'});
 // 最終行のホバー（操作ボタンが切れないか）
 const last=row(rows.length-1);await last.scrollIntoViewIfNeeded();await last.locator('td.handle-cell .drag-handle').hover();await p.waitForTimeout(250);
 await p.screenshot({path:OUT+'/t7-hover-last.png'});
 console.log('errors',JSON.stringify(errs));
 await b.close();srv.close();
})();

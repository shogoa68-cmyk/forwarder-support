// 新規見積・クリアのとき、右レールの「申し送り」に別件の内容が残らないこと
//   THEME=1 node scripts/design-tests/chat-reset-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 // 別の案件の申し送り（右レールの「申し送り」）が表示されている状態を作る
 const seed=()=>p.evaluate(()=>{
  document.getElementById('qspChatList').innerHTML='<div class="cp-chat-item"><div class="cp-chat-body">別件の申し送り（YML: O/F USD120）</div></div>';
  document.getElementById('qspChatInput').value='書きかけの別件メモ';
  window.qspTab&&0;
  const pane=document.getElementById('qspPane-chat');document.querySelectorAll('.qsp-pane').forEach(e=>e.classList.remove('is-active'));pane.classList.add('is-active');
 });
 const state=()=>p.evaluate(()=>({items:document.querySelectorAll('#qspChatList .cp-chat-item').length,text:document.getElementById('qspChatList').textContent.trim().slice(0,40),input:document.getElementById('qspChatInput').value}));
 await seed();
 let s0=await state();ok('（準備）別件の申し送りが出ている',s0.items===1,s0);
 await p.evaluate(()=>qpNewQuote());await p.waitForTimeout(300);
 let s=await state();
 ok('新規見積を作成すると、別件の申し送りは消える',s.items===0&&!/別件/.test(s.text),s);
 ok('書きかけの申し送りメモも消える',s.input==='',s);
 await seed();
 await p.evaluate(()=>{window.confirm=()=>true;quoteModeNew()});await p.waitForTimeout(300);
 s=await state();ok('「新規」ボタンでも消える',s.items===0&&s.input==='',s);
 await seed();
 await p.evaluate(()=>{window.confirm=()=>true;quoteModeClear()});await p.waitForTimeout(300);
 s=await state();ok('「クリア」でも消える',s.items===0&&s.input==='',s);
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
 await run(p);
 console.log('errors',JSON.stringify(errs));await b.close();srv.close();})();
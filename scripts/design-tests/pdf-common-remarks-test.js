// 御見積書 PDF（FCL案／LCL案の併記）：リマーク類は案ごとに出さず、書類の最後に 1 回だけ。
//   node scripts/design-tests/pdf-common-remarks-test.js
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 // FCL案／LCL案の 2 パターンを作り、リマークを入れる
 await p.evaluate(()=>{
  setTransport('fcl');
  window.createFclLclPatterns&&window.createFclLclPatterns();
  const ta=document.getElementById('remarkTextarea');ta.value='【共通リマーク】ドレージ費用は時期が確定した時点でご案内致します';ta.dispatchEvent(new Event('input',{bubbles:true}));
  const sc=document.getElementById('qf-scope');if(sc){sc.value='業務範囲：港から倉庫まで';}
 });
 await p.waitForTimeout(500);
 const info=await p.evaluate(()=>{
  const views=window.getOutputPatternViews&&window.getOutputPatternViews();
  const html=buildQuoteDocHTML();
  const box=document.createElement('div');box.innerHTML=html;
  const secs=[...box.querySelectorAll('.qd-pat-section')];
  const cnt=(root,sel)=>root.querySelectorAll(sel).length;
  const tail=box.querySelector('.qd-common-remarks');
  return {views:views&&views.map(v=>v.name),secs:secs.length,
   remarkInSecs:secs.map(s=>cnt(s,'.qd-remark-block')),
   remarkTotal:cnt(box,'.qd-remark-block'),remarkText:(box.textContent.match(/【共通リマーク】/g)||[]).length,
   scopeTotal:cnt(box,'.qd-scope-block'),
   tailHas:!!tail&&/【共通リマーク】/.test(tail.textContent),
   tailAfterLast:!!tail&&secs.length>0&&(secs[secs.length-1].compareDocumentPosition(tail)&Node.DOCUMENT_POSITION_FOLLOWING)>0,
   lastChildIsTail:box.querySelector('.qd-page').lastElementChild===tail,
   itemsTables:cnt(box,'table.qd-items')};
 });
 ok('FCL案・LCL案の併記になっている（案が 2 つ）',info.views&&info.views.length===2&&info.secs===2,info);
 ok('各案のページにはリマーク類（業務範囲・全体リマーク・常時付記）が入らない',info.remarkInSecs.every(n=>n===0),info);
 ok('全体リマークの本文は、書類全体で 1 回だけ',info.remarkText===1&&info.scopeTotal===1,info);
 ok('リマークは、最後の案の後ろ（書類の末尾）に出る',info.tailHas&&info.tailAfterLast&&info.lastChildIsTail,info);
 // 併記でない（1 案）ときは、従来どおり末尾に出る
 const single=await p.evaluate(()=>{
  document.getElementById('qf-multi-out').value='0';
  const html=buildQuoteDocHTML();const box=document.createElement('div');box.innerHTML=html;
  return {blocks:box.querySelectorAll('.qd-remark-block').length,tail:!!box.querySelector('.qd-common-remarks'),text:(box.textContent.match(/【共通リマーク】/g)||[]).length};
 });
 ok('併記しない（1 案）ときは、従来どおり 1 回出る',single.text===1&&single.blocks>=1&&!single.tail,single);
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
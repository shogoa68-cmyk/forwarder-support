// 選択行の一括操作バーの固定（見積書に出さない・期間外・入力完了・要調査）でも、つまみ列の操作ボタン（解除・複製・削除など）が押せること（Industry）。
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root='/home/user/forwarder-support';
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
 // 行を選択すると出る一括操作のバー（.quote-cmdbar の文脈バー）が、スクロールしても画面の上に付いてくること。横スクロールも壊れていないこと
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type]) .row-select-chk').nth(1).check({force:true});await p.waitForTimeout(200);
 for(const y of [400,900,1500]){
  await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());await p.evaluate(y=>window.scrollBy(0,y),y);await p.waitForTimeout(250);
  const r=await p.evaluate(()=>{const c=document.getElementById('cmdbarContext').getBoundingClientRect();return{top:Math.round(c.top),bottom:Math.round(c.bottom),vh:innerHeight,hidden:document.getElementById('cmdbarContext').hidden}});
  ok('スクロール '+y+'px：選択行のバーが画面内に見えている',!r.hidden&&r.top>=0&&r.bottom<=r.vh,r);
 }
 const o=await p.evaluate(()=>{const w=document.getElementById('tableScrollWrap');return{pageOverflow:document.documentElement.scrollWidth>innerWidth+2,wrapScrolls:w.scrollWidth>w.clientWidth,wrapOv:getComputedStyle(w).overflowX}});
 ok('表の横スクロールは #tableScrollWrap が担う（狭い幅でも表が自分でスクロール）',o.wrapOv==='auto'&&(+(process.env.W||1400)>=1000||o.wrapScrolls),o);
 console.log('errors',JSON.stringify(errs));await b.close();srv.close();})();
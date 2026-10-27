// 数量パターン（FCL案／LCL案）：編集中のパターンを、表の操作バーに常時表示し、その場で切り替えられる。
//   THEME=1 node scripts/design-tests/qty-pattern-bar-test.js
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const bar=()=>p.evaluate(()=>{const b=document.getElementById('qtyPatternBar');const h=document.getElementById('hdQtyPat');const tab=document.getElementById('tab-quote-make');const r=b.getBoundingClientRect();return {hidden:b.hidden,shown:b.offsetParent!==null,chips:[...b.querySelectorAll('.qpat-chip')].map(c=>({t:c.textContent.trim(),on:c.classList.contains('is-active')})),hd:h&&!h.hidden?h.textContent:'',qpat:tab.dataset.qpat||'',need:(b.querySelector('.qpat-need')||{}).textContent||'',legend:!!b.querySelector('.qpat-legend'),top:Math.round(r.top)};});
 // パターンが 1 つ：出ない
 let b0=await bar();
 ok('数量パターンが 1 つだけのときは、切替バーを出さない',b0.hidden&&!b0.shown&&b0.hd===''&&b0.qpat==='',b0);
 // FCL案／LCL案を作る
 await p.evaluate(()=>{setTransport('fcl');window.createFclLclPatterns();});await p.waitForTimeout(600);
 let b1=await bar();
 ok('2 つ以上あると、バーにチップ（FCL案・LCL案）が出る',b1.shown&&b1.chips.length===2&&/FCL/.test(b1.chips[0].t)&&/LCL/.test(b1.chips[1].t),b1);
 const act=b1.chips.findIndex(c=>c.on);
 ok('編集中のパターンのチップが濃く（is-active）、表の列見出しにも名前が出る',act>=0&&b1.hd.length>0&&b1.chips[act].t.includes(b1.hd.replace(/\s/g,''))||b1.hd.length>0,b1);
 ok('表の色（data-qpat）が編集中のモードに合う',['fcl','lcl'].includes(b1.qpat),b1);
 // 切替
 const other=b1.chips.findIndex(c=>!c.on);
 await p.locator('#qtyPatternBar .qpat-chip').nth(other).click();await p.waitForTimeout(600);
 let b2=await bar();
 ok('チップを押すと、そのパターンに切り替わる（編集中の印・列見出し・色が変わる）',b2.chips[other].on&&!b2.chips[act].on&&b2.qpat!==b1.qpat&&b2.hd!==b1.hd,{b1,b2});
 // 要確認：「他のパターンには数量の記憶があるが、いまのパターンには無い」行を作る（1 行目の記憶を FCL 案から消す）
 await p.evaluate(()=>{const uid=document.querySelector('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="uid"]').value;delete _packingPatterns[0].qtyLinks[uid];switchPackingPattern(1);switchPackingPattern(0);});
 await p.waitForTimeout(600);
 let b4=await bar();
 ok('他のパターンにだけ数量がある行は、「要確認 N 行」として数が出る',/要確認\s*1/.test(b4.need),b4);
 await p.evaluate(()=>document.querySelector('#qtyPatternBar .qpat-need').click());await p.waitForTimeout(500);
 ok('「要確認」を押すと、その行へ飛ぶ（数量欄が画面内）',await p.evaluate(()=>{const e=document.querySelector('#tableBody .pq-pattern-needs-check');const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),null);
 // 入力すると要確認が消える
 await p.evaluate(()=>{const pq=document.querySelector('#tableBody .pq-pattern-needs-check');pq.value='5';pq.dispatchEvent(new Event('input',{bubbles:true}));});await p.waitForTimeout(400);
 ok('このパターンで数量を入れると、「要確認」が消える',!(await bar()).need,await bar());
 // スクロールしても見える（操作バーは sticky）
 await p.evaluate(()=>{document.getElementById('section-table').scrollIntoView();window.scrollBy(0,700);});await p.waitForTimeout(300);
 const st=await bar();
 ok('表までスクロールしても、バーは画面の上に付いている',st.shown&&st.top>=0&&st.top<200,st);
 await p.screenshot({path:process.env.SHOT||'/tmp/qp.png'});
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
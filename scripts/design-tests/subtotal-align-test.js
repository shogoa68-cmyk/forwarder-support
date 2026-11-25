// 小計バー（パターン小計・サブコン小計）：金額が右端に右揃え、ラベル・＋行追加は左。
//   THEME=1 node scripts/design-tests/subtotal-align-test.js
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 // A海運の 2 行に別々のパターンを付ける（パターン小計を出す）
 await p.evaluate(()=>{const f=(i,v)=>{const el=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="pt"]')[i];el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};f(0,'FCL 20');f(1,'FCL 40');});
 await p.evaluate(()=>window.editorV2Go&&window.editorV2Go(4));await p.waitForTimeout(900); // 新画面は費用（ステップ④）を開く
 const sel='#tableBody tr.subcon-group-subtotal, #tableBody tr.subcon-pattern-subtotal';
 const m=await p.evaluate(sel=>[...document.querySelectorAll(sel)].filter(tr=>tr.offsetParent).map(tr=>{const inner=tr.querySelector('.subcon-subtotal-inner');const ir=inner.getBoundingClientRect();const g=c=>{const e=inner.querySelector(c);const r=e.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top)}};const lab=g('.subcon-subtotal-label'),add=g('.subcon-subtotal-add-btn'),cost=g('.st-cost'),sell=g('.st-sell'),mar=g('.st-margin');const pad=parseFloat(getComputedStyle(inner).paddingRight);return {pt:tr.classList.contains('subcon-pattern-subtotal'),lab,add,cost,sell,mar,innerR:Math.round(ir.right),pad}}),sel);
 // 新画面（cost-a）ではサブコン小計は出さず（見出しに金額がある）、パターンが 2 つ以上のサブコンのパターン小計だけ出る
 const nGrp=await p.evaluate(()=>[...document.querySelectorAll('#tableBody tr.subcon-group-subtotal')].filter(t=>t.offsetParent).length);
 ok('パターン小計が複数出て、サブコン小計は出ない（新画面）',m.length>=2&&m.every(x=>x.pt)&&nGrp===0,[m.length,nGrp]);
 ok('金額（仕入合計→売値合計→粗利率）が右端に右揃えで並ぶ（粗利率の右端＝バーの右の余白の内側）',m.every(x=>Math.abs(x.mar.r-(x.innerR-x.pad))<=2&&x.cost.r<=x.sell.l+1&&x.sell.r<=x.mar.l+1),m.map(x=>[x.mar.r,x.innerR-x.pad]));
 ok('パターン小計とサブコン小計で、金額の位置が縦にそろう（各金額の左右端が全行で同じ）',['cost','sell','mar'].every(k=>new Set(m.map(x=>x[k].r)).size===1&&new Set(m.map(x=>x[k].l)).size===1),m.map(x=>[x.cost.l,x.sell.l,x.mar.l]));
 // 新画面（cost-a）ではパターン小計の「＋ 行追加」は出さない（幅 0）ので、ラベルが金額より左にあることだけ確かめる
 ok('ラベルは左側（金額より左）。＋行追加は出さない（新画面）',m.every(x=>x.lab.r<=x.cost.l&&(x.add.r-x.add.l)===0),m.map(x=>[x.lab.r,x.add.r,x.cost.l]));
 ok('同じバーの中は 1 行（金額とラベルの上端がそろう）',m.every(x=>Math.abs(x.cost.t-x.lab.t)<=12),m.map(x=>[x.cost.t,x.lab.t]));
 const bb=await p.locator('#tableBody tr.subcon-pattern-subtotal').first().boundingBox();
 await p.screenshot({path:process.env.SHOT||'/tmp/sub.png',clip:{x:0,y:Math.max(0,bb.y-30),width:1100,height:Math.min(300,1000-Math.max(0,bb.y-30))}});
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
  // 新画面（cost-a）は一部の欄が行の詳細に移り Playwright の fill が効かないため、値は evaluate で入れて input/change を発火する

  const S=(n,v)=>p.evaluate(([i,n,v])=>{const el=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[i].querySelector(`[data-field="${n}"]`);el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},[i,n,v]);
  const r=rows[i];
  await S('nm',r[0]);await S('sv',r[1]);await S('cat',r[2]);
  await S('un',r[3]);await S('pq',String(r[4]));
  await S('pc',r[7]);await S('bc',r[7]);
  await S('pp',String(r[5]));await S('mk',String(r[6]));
 }
 await p.waitForTimeout(1500);
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());await p.waitForTimeout(300);
 await run(p);
 console.log('errors',JSON.stringify(errs));await b.close();srv.close();})();
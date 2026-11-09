// 出力前の確認：お客様・ご担当者の取引ルール（厳守・要確認）が確認事項に出る（メモは出ない）。
//   node scripts/design-tests/rules-gate-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 // 取引ルール（架空）：crFor を差し替える（お客様全体の厳守・担当者別の要確認・メモ）
 await p.evaluate(()=>{
  window.crFor=(c,pn)=>({otherContact:0,list:[
   {level:'strict',body:'請求書は月末締め・翌月10日必着',contact:''},
   ...(String(pn||'').includes('幸崎')?[{level:'check',body:'見積はUSD建て併記',contact:'幸崎'}]:[]),
   {level:'memo',body:'メモは出力前に出さない',contact:''}]});
  document.getElementById('qf-customer').value='テスト商事株式会社';
  document.getElementById('qf-person').value='幸崎';
 });
 const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).first();
 await f('nm').fill('海上運賃');await f('sv').fill('A海運');await f('un').fill("40'GP");await f('pq').fill('1');await f('pp').fill('1000');await f('mk').fill('100');await f('mk').blur();
 await p.waitForTimeout(500);
 const items=async()=>p.evaluate(()=>{preOutputValidationGate('テスト',()=>{});return [...document.querySelectorAll('#pvWarnGuideList .pv-wg-item')].map(li=>li.textContent.replace(/\s+/g,' '));});
 let t=await items();
 ok('厳守のルールが確認事項に出る',t.some(x=>/⛔ 厳守.*請求書は月末締め/.test(x)),t);
 ok('担当者別の要確認ルールも出る（担当者名つき）',t.some(x=>/⚠️ 要確認.*幸崎 様のみ.*USD建て併記/.test(x)),t);
 ok('メモは出さない',!t.some(x=>/メモは出力前/.test(x)),t);
 await p.evaluate(()=>{document.getElementById('qf-person').value='山田';});
 t=await items();
 ok('担当者が違えば、その担当者のルールは出ない',!t.some(x=>/USD建て/.test(x))&&t.some(x=>/請求書は月末締め/.test(x)),t);
 ok('厳守は強調表示',await p.evaluate(()=>!!document.querySelector('#pvWarnGuideList .pv-wg-item-rule-strict')));
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
 await run(p);
 console.log('errors',JSON.stringify(errs));await b.close();srv.close();})();
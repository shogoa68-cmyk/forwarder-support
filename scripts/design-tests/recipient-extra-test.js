// 御見積書 PDF・画面プレビュー：ご担当者がお客様マスターの担当者と一致するとき、所属部署・課と役職を宛先に出す。
//   node scripts/design-tests/recipient-extra-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 await p.evaluate(()=>{
  // お客様マスター（架空）。担当者に所属部署・課と役職を持たせる
  const rec={field:'customer',value:'テスト商事株式会社',details:{contacts:[{name:'幸崎',dept:'海外営業部 第2課',title:'課長'},{name:'山田',dept:'',title:''}]}};
  window.mdGet=(f,v)=>f==='customer'&&v===rec.value?rec:null; window.mdGetCanon=window.mdGet;
  document.getElementById('qf-customer').value='テスト商事株式会社';
 });
 const doc=async person=>p.evaluate(x=>{document.getElementById('qf-person').value=x;const box=document.createElement('div');box.innerHTML=buildQuoteDocHTML();return box.textContent.replace(/\s+/g,' ');},person);
 let t=await doc('幸崎');
 ok('PDF：マスターの担当者を選ぶと部署・課と役職が宛先に出る',/テスト商事株式会社\s*海外営業部 第2課\s*課長 幸崎 様/.test(t),t.slice(0,300));
 t=await doc('幸崎 様');
 ok('PDF：敬称付きで入力しても一致する（様は重ならない）',/課長 幸崎 様/.test(t)&&!/様 様/.test(t),t.slice(0,300));
 t=await doc('山田');
 ok('PDF：部署・役職が未入力の担当者は従来どおり',/テスト商事株式会社\s*山田 様/.test(t)&&!/課長/.test(t),t.slice(0,300));
 t=await doc('マスターに無い人');
 ok('PDF：マスターにいない氏名は従来どおり',/テスト商事株式会社\s*マスターに無い人 様/.test(t)&&!/海外営業部/.test(t),t.slice(0,300));
 const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).first();
 await f('nm').fill('海上運賃');await f('sv').fill('A海運');await f('un').fill("40'GP");await f('pq').fill('1');await f('pp').fill('1000');await f('mk').fill('100');await f('mk').blur();
 await p.waitForTimeout(500);
 await p.evaluate(()=>{document.getElementById('qf-person').value='幸崎';openPreview();});await p.waitForTimeout(600);
 await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/このまま|スキップ|続行/.test(x.textContent)&&x.offsetParent);b&&b.click();});await p.waitForTimeout(600);
 const pv=await p.evaluate(()=>[...document.querySelectorAll('.pv-meta-item')].map(e=>e.textContent.replace(/\s+/g,' ')).join('|'));
 ok('プレビュー：担当に部署・課と役職が出る',/担当\s*海外営業部 第2課 課長 幸崎 様/.test(pv),pv);
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
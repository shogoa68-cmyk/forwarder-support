// 御見積書 PDF：為替の出典・参考値の注記は、幅の狭いレート表の下ではなく、下端に全幅の 1 行で出る。
//   node scripts/design-tests/fx-note-test.js           （現行）
//   THEME=1 node scripts/design-tests/fx-note-test.js   （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1300,height:900},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).first();
 await f('nm').fill('海上運賃');await f('sv').fill('A海運');await f('un').fill("40'GP");await f('pq').fill('1');await f('pp').fill('1000');await f('mk').fill('100');await f('mk').blur();
 await p.waitForTimeout(400);
 await p.evaluate(()=>{document.getElementById('qf-customer').value='株式会社サンプル';document.getElementById('qf-person').value='山田';});
 const measure=()=>p.evaluate(()=>{
  document.getElementById('fxmock')?.remove();
  const d=document.createElement('div');d.id='fxmock';d.style.cssText='position:fixed;left:0;top:0;width:794px;background:#fff;z-index:99999;padding:12px;';d.innerHTML=buildQuoteDocHTML();document.body.appendChild(d);
  const n=d.querySelector('.qd-fxnote'),rate=d.querySelector('.qd-rate'),foot=d.querySelector('.qd-foot');
  const lh=n?parseFloat(getComputedStyle(n).lineHeight)||0:0;
  return n?{text:n.textContent.replace(/\s+/g,' ').trim(),lines:Math.round(n.getBoundingClientRect().height/lh),width:Math.round(n.getBoundingClientRect().width),inRate:rate.contains(n),rateText:rate.textContent.replace(/\s+/g,' ').trim(),after:foot.nextElementSibling===n,rateW:Math.round(rate.getBoundingClientRect().width)}:null;});
 await p.evaluate(()=>{localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED,'2026-10-28T06:13:00Z');});
 let m=await measure();
 ok('為替の注記は、レート表の列ではなく、下端の全幅の行に出る（御見積書の最下部・フッターの直後）',m&&!m.inRate&&m.after&&m.width>600,m);
 ok('注記は 1 行に収まる（折り返さない）',m&&m.lines===1,m);
 ok('文面：「為替：open.er-api.com 中値（日時 取得）／参考値であり、実際の決済レート（TTS等）とは異なります。」＋作成日',m&&/^為替：open\.er-api\.com 中値（\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} 取得）／参考値であり、実際の決済レート（TTS等）とは異なります。\s*作成日：/.test(m.text),m);
 ok('レート表の列には、表だけが残る（長い説明文が入っていない）',m&&!/為替|出典|参考値/.test(m.rateText)&&m.rateW<=145,m);
 await p.screenshot({path:OUT+'/fx-note.png',clip:{x:0,y:0,width:820,height:Math.min(900,900)}});
 await p.evaluate(()=>{localStorage.removeItem(SharedStorage.KEYS.FX_LAST_FETCHED);});
 m=await measure();
 ok('為替を自動取得していないときも、同じ形（為替：手動設定値…／参考値であり…）の 1 行',m&&/^為替：手動設定値（自動取得未実行/.test(m.text)&&/参考値であり、実際の決済レート/.test(m.text)&&!m.inRate,m);
 await p.evaluate(()=>{localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED,'2026-10-28T06:13:00Z');});
 const pv=await p.evaluate(()=>getFxAuditMeta().fxLine);
 ok('画面プレビュー・Excel・コピー用の注記（getFxAuditMeta）も同じ文面',/^為替：open\.er-api\.com 中値/.test(pv)&&!/為替出典/.test(pv),pv);
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

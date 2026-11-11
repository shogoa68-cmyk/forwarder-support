// 見積入力の「⋯」「⚙」ポップアップが画面の外へ切れない／900px 以下で横に溢れない。
//   node scripts/design-tests/popup-bounds-test.js           （現行）
//   THEME=1 node scripts/design-tests/popup-bounds-test.js   （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));if(!c)process.exitCode=1;};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 for(const w of [1440,1100,900,680]){
  const ctx=await b.newContext({viewport:{width:w,height:800},locale:'ja-JP'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('fwd.uiMode','detail')}catch(e){}});
  await ctx.addInitScript(t=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:t,doc:t}))}catch(e){}},!!process.env.THEME);
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
  await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  const chk=sel=>p.evaluate(s=>{const e=document.querySelector(s);const r=e.getBoundingClientRect();const cy=(Math.max(r.top,0)+Math.min(r.bottom,innerHeight))/2;const h=document.elementFromPoint(Math.min(Math.max(r.left+r.width/2,0),innerWidth-1),cy);return {top:Math.round(r.top),bot:Math.round(r.bottom),el:h&&(h.tagName+'.'+String(h.className).slice(0,30)),l:Math.round(r.left),r:Math.round(r.right),vw:innerWidth,in:r.left>=-1&&r.right<=innerWidth+1,hit:!!(h&&h.closest(s))};},sel);
  await p.evaluate(()=>{document.getElementById('section-table').scrollIntoView();window.scrollBy(0,200)});await p.waitForTimeout(300);
  await p.evaluate(()=>{document.getElementById('cmdbarMore').open=true});await p.waitForTimeout(250);
  const m=await chk('.cmdbar-more-pop');ok(`${w}px：「⋯」のメニューが画面内に収まり押せる`,m.in&&m.hit,m);
  await p.evaluate(()=>{document.getElementById('cmdbarMore').open=false;document.getElementById('cmdbarGear').open=true});await p.waitForTimeout(250);
  const g=await chk('.cmdbar-gear-pop');ok(`${w}px：「⚙」のパネルが画面内に収まり押せる`,g.in&&g.hit,g);
  await p.evaluate(()=>{document.getElementById('cmdbarGear').open=false});
  if(w<=900){const x=await p.evaluate(()=>{const W=innerWidth;return [...document.querySelectorAll('#tab-quote-make .qrc-rail, #tab-quote-make .qrc-rail-btn')].filter(e=>e.getBoundingClientRect().right>W+1).length});ok(`${w}px：右パネルのボタン列が横に溢れない`,x===0,x);}
  ok(`${w}px：JS エラーなし`,errs.length===0,errs);
  await ctx.close();
 }
 await b.close();srv.close();
})();

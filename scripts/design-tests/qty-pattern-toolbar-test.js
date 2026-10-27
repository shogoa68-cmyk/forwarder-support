// 数量パターン（B列／C列／D列…）を上部ツールバーに置く／ツールバーを左端まで広げる。
//   node scripts/design-tests/qty-pattern-toolbar-test.js           （現行）
//   THEME=1 node scripts/design-tests/qty-pattern-toolbar-test.js   （Industry）
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
 const open=async(w)=>{
  const ctx=await b.newContext({viewport:{width:w,height:800},locale:'ja-JP'});
  if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
  await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  return {ctx,p,errs};
 };
 const mk=()=>{_packingPatterns[0].name="B列（20' or 40'DRY *1想定）";["C列（40'HC*1想定）","D列（40'HC*2想定）","復路の物量（売行状況で変動のため不明）"].forEach(n=>_packingPatterns.push({name:n,entries:[],qtyLinks:{},excludedUnits:[],hideLinks:{},groupExcludeLinks:{},routeLinks:{}}));switchPackingPattern(0);renderQtyPatternBar();};
 const geo=()=>({tbH:document.getElementById('saveToolbar').getBoundingClientRect().height,tbL:Math.round(document.getElementById('saveToolbar').getBoundingClientRect().left),navL:Math.round(document.querySelector('.cat-nav').getBoundingClientRect().left),tbR:Math.round(document.getElementById('saveToolbar').getBoundingClientRect().right),navR:Math.round(document.querySelector('.cat-nav').getBoundingClientRect().right)});
 {
  const {ctx,p,errs}=await open(1900);
  const g0=await p.evaluate(geo);
  ok('ツールバーが左端まで広がり、カテゴリの行と左右の端がそろう',Math.abs(g0.tbL-g0.navL)<=1&&Math.abs(g0.tbR-g0.navR)<=2,g0);
  await p.evaluate(mk);await p.waitForTimeout(500);
  const s=await p.evaluate(()=>{const bar=document.getElementById('qtyPatternBar');const tb=document.getElementById('saveToolbar');const chips=[...bar.querySelectorAll('.qpat-chip')];const rb=bar.getBoundingClientRect(),mb=tb.querySelector('.tb-menu').getBoundingClientRect(),dash=document.getElementById('qmDash').getBoundingClientRect();return {inTb:bar.parentElement===tb,hidden:bar.hidden,n:chips.length,names:chips.map(c=>c.querySelector('.qpat-name').textContent),left:Math.round(rb.left),right:Math.round(rb.right),menuL:Math.round(mb.left),dashR:Math.round(dash.right),tbH:Math.round(tb.getBoundingClientRect().height),legend:getComputedStyle(bar.querySelector('.qpat-legend')).display,titles:chips.map(c=>c.title)};});
  ok('パターンが 2 つ以上のとき、ツールバーの「⋯」の左に 4 つのチップが出る',s.inTb&&!s.hidden&&s.n===4&&s.right<=s.menuL&&s.left>=s.dashR,s);
  ok('チップのタイトルに、パターン名の全文が入っている（省略されても分かる）',/復路の物量（売行状況で変動のため不明）/.test(s.titles[3]),s.titles);
  ok('ツールバーの高さが変わらない（パターンが出ても）',Math.abs(s.tbH-Math.round(g0.tbH))<=1,{s0:g0.tbH,s:s.tbH});
  await p.locator('#qtyPatternBar .qpat-chip').nth(2).click();await p.waitForTimeout(500);
  const sw=await p.evaluate(()=>({idx:_packingActiveIdx,on:[...document.querySelectorAll('#qtyPatternBar .qpat-chip')].findIndex(c=>c.classList.contains('is-active')),hd:document.getElementById('hdQtyPat').textContent}));
  ok('ツールバーのチップを押すと、そのパターンに切り替わる（列見出しの名前も変わる）',sw.idx===2&&sw.on===2&&/D列/.test(sw.hd),sw);
  // 下の操作バーには、もうパターンのバーが無い
  ok('表の操作バーの中にはパターンのバーが残っていない（1 段減る）',await p.evaluate(()=>!document.querySelector('.quote-cmdbar #qtyPatternBar')),null);
  await p.evaluate(()=>{document.getElementById('section-table').scrollIntoView();window.scrollBy(0,300);});await p.waitForTimeout(400);
  const st=await p.evaluate(()=>{const r=document.getElementById('qtyPatternBar').getBoundingClientRect();const e=document.elementFromPoint(r.left+30,r.top+r.height/2);return {top:Math.round(r.top),hit:!!(e&&e.closest('#qtyPatternBar'))};});
  ok('スクロールしても、ツールバーのチップは画面の上にあり押せる',st.top>=0&&st.top<120&&st.hit,st);
  await p.screenshot({path:OUT+'/qpt-1900.png',clip:{x:0,y:0,width:1900,height:260}});
  ok('JS エラーなし（1900）',errs.length===0,errs);await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(1400);
  await p.evaluate(mk);await p.waitForTimeout(500);
  const s=await p.evaluate(()=>{const bar=document.getElementById('qtyPatternBar');const tb=document.getElementById('saveToolbar');return {inTb:bar.parentElement===tb,legend:getComputedStyle(bar.querySelector('.qpat-legend')).display,tbH:Math.round(tb.getBoundingClientRect().height),scrollable:bar.scrollWidth>=bar.clientWidth,pageX:document.documentElement.scrollWidth<=innerWidth+1};});
  ok('1400px：チップはツールバーに収まり（凡例は省く・横に溢れない）、高さも変わらない',s.inTb&&s.legend==='none'&&s.tbH<=60&&s.pageX,s);
  await p.screenshot({path:OUT+'/qpt-1400.png',clip:{x:0,y:0,width:1400,height:260}});
  ok('JS エラーなし（1400）',errs.length===0,errs);await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(390);
  await p.evaluate(mk);await p.waitForTimeout(500);
  const s=await p.evaluate(()=>{const bar=document.getElementById('qtyPatternBar');return {inCmd:!!bar.closest('.quote-cmdbar'),hidden:bar.hidden,n:bar.querySelectorAll('.qpat-chip').length};});
  ok('スマホ幅では、表の操作バーの先頭に残る',s.inCmd&&!s.hidden&&s.n===4,s);
  await p.setViewportSize({width:1400,height:800});await p.waitForTimeout(500);
  ok('広げ直すと、ツールバーへ移る',await p.evaluate(()=>document.getElementById('qtyPatternBar').parentElement===document.getElementById('saveToolbar')),null);
  ok('JS エラーなし（スマホ）',errs.length===0,errs);await ctx.close();
 }
 await b.close();srv.close();
})();

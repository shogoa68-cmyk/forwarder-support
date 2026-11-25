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
  // 新画面（editor-v2）：チップの行（#qtyPatternBar）は隠し、ツールバーに「数量：○○ ▾ N案」（#e2Pat）を出す
  const s=await p.evaluate(()=>{const tb=document.getElementById('saveToolbar');const pat=document.getElementById('e2Pat');const r=pat.getBoundingClientRect();const mb=tb.querySelector('.tb-menu').getBoundingClientRect();const dash=document.getElementById('qmDash').getBoundingClientRect();return {inTb:pat.parentElement===tb,hidden:pat.hidden,vis:r.width>0,txt:document.getElementById('e2PatBtn').textContent,left:Math.round(r.left),right:Math.round(r.right),menuL:Math.round(mb.left),dashR:Math.round(dash.right),tbH:Math.round(tb.getBoundingClientRect().height),barShown:document.getElementById('qtyPatternBar').getBoundingClientRect().width>0};});
  ok('パターンが 2 つ以上のとき、ツールバーに「数量：○○ ▾ 4案」が出る（元のチップ行は隠す）',s.inTb&&!s.hidden&&s.vis&&/4案/.test(s.txt)&&/B列/.test(s.txt)&&!s.barShown&&s.right<=s.menuL&&s.left>=s.dashR,s);
  await p.click('#e2PatBtn');await p.waitForTimeout(200);
  const mn=await p.evaluate(()=>[...document.querySelectorAll('#e2PatMenu button')].map(x=>x.textContent.trim()));
  ok('開くと 4 つの案が一覧に並び、パターン名の全文が入っている',mn.length===4&&/復路の物量（売行状況で変動のため不明）/.test(mn[3]),mn);
  ok('ツールバーの高さが変わらない（パターンが出ても）',Math.abs(s.tbH-Math.round(g0.tbH))<=1,{s0:g0.tbH,s:s.tbH});
  await p.locator('#e2PatMenu button').nth(2).click();await p.waitForTimeout(500);
  const sw=await p.evaluate(()=>({idx:_packingActiveIdx,btn:document.getElementById('e2PatBtn').textContent,qp:document.getElementById('tab-quote-make').dataset.qpat}));
  ok('一覧から案を選ぶと、そのパターンに切り替わる（ボタンの名前も変わり、表の色分け data-qpat が付く。1 段の行では列見出しの案名は無い）',sw.idx===2&&/D列/.test(sw.btn)&&!!sw.qp,sw);
  ok('表の操作バーの中にはパターンのバーが残っていない（1 段減る）',await p.evaluate(()=>!document.querySelector('.quote-cmdbar #qtyPatternBar')),null);
  await p.evaluate(()=>{window.editorV2Go&&window.editorV2Go(4);document.getElementById('section-table').scrollIntoView();window.scrollBy(0,300);});await p.waitForTimeout(400);
  const st=await p.evaluate(()=>{const r=document.getElementById('e2Pat').getBoundingClientRect();const e=document.elementFromPoint(r.left+30,r.top+r.height/2);return {top:Math.round(r.top),hit:!!(e&&e.closest('#e2Pat'))};});
  ok('スクロールしても、ツールバーの案の切替は画面の上にあり押せる',st.top>=0&&st.top<120&&st.hit,st);
  await p.screenshot({path:OUT+'/qpt-1900.png',clip:{x:0,y:0,width:1900,height:260}});
  ok('JS エラーなし（1900）',errs.length===0,errs);await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(1400);
  await p.evaluate(mk);await p.waitForTimeout(500);
  const s=await p.evaluate(()=>{const pat=document.getElementById('e2Pat');const tb=document.getElementById('saveToolbar');return {inTb:pat.parentElement===tb,vis:pat.getBoundingClientRect().width>0,tbH:Math.round(tb.getBoundingClientRect().height),pageX:document.documentElement.scrollWidth<=innerWidth+1};});
  ok('1400px：案の切替はツールバーに収まり（横に溢れない）、高さも変わらない',s.inTb&&s.vis&&s.tbH<=60&&s.pageX,s);
  await p.screenshot({path:OUT+'/qpt-1400.png',clip:{x:0,y:0,width:1400,height:260}});
  ok('JS エラーなし（1400）',errs.length===0,errs);await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(390);
  await p.evaluate(mk);await p.waitForTimeout(500);
  const s=await p.evaluate(()=>{const pat=document.getElementById('e2Pat');const r=pat.getBoundingClientRect();return {inTb:pat.parentElement===document.getElementById('saveToolbar'),vis:r.width>0&&r.right<=innerWidth+1,txt:document.getElementById('e2PatBtn').textContent};});
  ok('スマホ幅でも、上のバーに「数量：○○ ▾ 4案」が出て画面内に収まる',s.inTb&&s.vis&&/4案/.test(s.txt),s);
  await p.setViewportSize({width:1400,height:800});await p.waitForTimeout(500);
  ok('広げ直しても、ツールバーに残る',await p.evaluate(()=>{const e=document.getElementById('e2Pat');return e.parentElement===document.getElementById('saveToolbar')&&e.getBoundingClientRect().width>0}),null);
  ok('JS エラーなし（スマホ）',errs.length===0,errs);await ctx.close();
 }
 await b.close();srv.close();
})();

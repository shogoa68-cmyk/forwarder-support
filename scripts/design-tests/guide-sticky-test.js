// かんたん表示：上部の「手順の道しるべ（①条件 ②貨物 ③費用 ④出力）」がスクロールに付いてくる。
//   node scripts/design-tests/guide-sticky-test.js           （現行）
//   THEME=1 node scripts/design-tests/guide-sticky-test.js   （Industry）
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
 const open=async(w,mode)=>{
  const ctx=await b.newContext({viewport:{width:w,height:800},locale:'ja-JP'});
  await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},mode);
  if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
  await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  await p.evaluate(()=>{for(let i=0;i<8;i++)window.addRow();});await p.waitForTimeout(500);
  return {ctx,p,errs};
 };
 const geo=()=>({g:(()=>{const e=document.getElementById('qpGuide');const r=e.getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom),shown:e.offsetParent!==null,pos:getComputedStyle(e).position};})(),
   tb:(()=>{const r=document.getElementById('saveToolbar').getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom)};})(),
   cmd:(()=>{const r=document.querySelector('.quote-cmdbar').getBoundingClientRect();return {top:Math.round(r.top),bottom:Math.round(r.bottom)};})(),
   hint:(()=>{const h=document.getElementById('qpHint');return {shown:h.offsetParent!==null,text:h.textContent.length>0};})()});
 for(const w of [1400,1900]){
  const {ctx,p,errs}=await open(w,'simple');
  await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(300);
  const g0=await p.evaluate(geo);
  ok(`${w}px：かんたん表示では道しるべと案内文が出る`,g0.g.shown&&g0.hint.shown&&g0.hint.text,g0);
  await p.evaluate(()=>{document.getElementById('section-table').scrollIntoView();window.scrollBy(0,500);});await p.waitForTimeout(500);
  const g1=await p.evaluate(geo);
  ok(`${w}px：スクロールしても道しるべは上部ツールバーの下に付いてくる`,g1.g.pos==='sticky'&&g1.g.shown&&g1.g.top>=g1.tb.bottom-2&&g1.g.top<=g1.tb.bottom+6,g1);
  ok(`${w}px：下の操作バー（行追加など）は、道しるべと重ならない`,g1.cmd.top>=g1.g.bottom-1,g1);
  const hit=await p.evaluate(()=>{const bs=[...document.querySelectorAll('#qpGuide .qp-guide-step')];return bs.filter(b=>{const r=b.getBoundingClientRect();const e=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !(e&&(e===b||b.contains(e)));}).length;});
  ok(`${w}px：付いてきた道しるべの 4 つのボタンが、他に隠れず押せる`,hit===0,hit);
  await p.screenshot({path:`${OUT}/guide-sticky-${w}.png`,clip:{x:0,y:0,width:w,height:300}});
  await p.click('#qpGuide [data-gstep="1"]');await p.waitForTimeout(1200);
  const s1=await p.evaluate(()=>({sec:Math.round(document.getElementById('section-cond').getBoundingClientRect().top),gb:Math.round(document.getElementById('qpGuide').getBoundingClientRect().bottom)}));
  ok(`${w}px：付いてきた道しるべの「① 条件」を押すと、条件の見出しが道しるべの下に出る（隠れない）`,s1.sec>=s1.gb-2&&s1.sec<s1.gb+160,s1);
  ok(`${w}px：JS エラーなし`,errs.length===0,errs);
  await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(1400,'detail');
  await p.evaluate(()=>{document.getElementById('section-table').scrollIntoView();window.scrollBy(0,500);});await p.waitForTimeout(400);
  const d=await p.evaluate(geo);
  ok('詳細表示：道しるべも案内文も出ず、操作バーの位置は従来どおり（ツールバーの直下）',!d.g.shown&&!d.hint.shown&&Math.abs(d.cmd.top-d.tb.bottom)<=12,d);
  ok('JS エラーなし（詳細）',errs.length===0,errs);
  await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(390,'simple');
  await p.evaluate(()=>{document.getElementById('section-table').scrollIntoView();window.scrollBy(0,500);});await p.waitForTimeout(500);
  const m=await p.evaluate(geo);
  ok('スマホ幅：道しるべは画面の上に付き、操作バーと重ならない',m.g.shown&&m.g.top>=0&&m.g.top<130&&m.cmd.top>=m.g.bottom-1,m);
  await p.screenshot({path:`${OUT}/guide-sticky-390.png`});
  ok('JS エラーなし（スマホ）',errs.length===0,errs);
  await ctx.close();
 }
 await b.close();srv.close();
})();

// Ctrl+K コマンドパレット：背の低い画面（横向きのスマホ等）でも、一覧と下の案内が画面の中に収まる。
//   node scripts/design-tests/cmd-palette-short-test.js            （現行）
//   THEME=1 node scripts/design-tests/cmd-palette-short-test.js    （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${process.env.THEME?'industry':'classic'}`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 for(const [W,H] of [[844,390],[1400,900]]){
  const ctx=await b.newContext({viewport:{width:W,height:H},locale:'ja-JP'});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);
  await p.evaluate(()=>{const c=document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');switchCategory('quote-make',c)});await p.waitForTimeout(700);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  await p.keyboard.press('Control+k');await p.waitForTimeout(300);
  const r=await p.evaluate(()=>{const bx=document.getElementById('cmdPaletteBox').getBoundingClientRect();return {bottom:Math.round(bx.bottom),vh:innerHeight,open:document.getElementById('cmdPalette').classList.contains('open')}});
  ok(`${W}x${H} パレットが開き、下端が画面の中に収まる`,r.open&&r.bottom<=r.vh,r);
  await ctx.close();
 }
 await b.close();srv.close();
})();

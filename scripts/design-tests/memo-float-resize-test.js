// 付箋（案件名・社内メモ）を右下へドラッグしたあと、画面を小さくしても（スマホを横向きにする等）付箋が画面の中に戻る。
//   node scripts/design-tests/memo-float-resize-test.js            （現行）
//   THEME=1 node scripts/design-tests/memo-float-resize-test.js    （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${process.env.THEME?'industry':'classic'}`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:900},locale:'ja-JP'});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);
 await p.evaluate(()=>{const c=document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');switchCategory('quote-make',c)});await p.waitForTimeout(700);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 await p.evaluate(()=>toggleMemoFloat());await p.waitForTimeout(300);
 const hb=await (await p.$('#qfMemoFloatHead')).boundingBox();
 await p.mouse.move(hb.x+40,hb.y+10);await p.mouse.down();await p.mouse.move(1390,890,{steps:5});await p.mouse.up();await p.waitForTimeout(200);
 await p.setViewportSize({width:390,height:700});await p.waitForTimeout(400);
 const r=await p.evaluate(()=>{const q=document.getElementById('qfMemoFloat').getBoundingClientRect();return {l:q.left,t:q.top,r:q.right,b:q.bottom,vw:innerWidth,vh:innerHeight}});
 ok('画面を 1400→390 に縮めても、付箋が画面の中に収まる',r.l>=0&&r.t>=0&&r.r<=r.vw+1&&r.b<=r.vh+1,r);
 await b.close();srv.close();
})();

// 付箋（案件名・社内メモ）を開いたまま「プレビュー」を押しても、入力確認ガイドのボタンが付箋に隠れず押せる。
//   node scripts/design-tests/warn-guide-memo-test.js            （現行）
//   THEME=1 node scripts/design-tests/warn-guide-memo-test.js    （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${process.env.THEME?'industry':'classic'}`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 for(const W of [1400,390]){
  const ctx=await b.newContext({viewport:{width:W,height:900},locale:'ja-JP'});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);
  await p.evaluate(()=>{const c=document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');switchCategory('quote-make',c)});await p.waitForTimeout(700);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  await p.evaluate(()=>toggleMemoFloat());await p.waitForTimeout(300);
  await p.evaluate(()=>openPreview());await p.waitForTimeout(900);
  const r=await p.evaluate(()=>{const g=document.getElementById('pvWarnGuide');if(!g)return null;return [...g.querySelectorAll('button')].map(bt=>{const q=bt.getBoundingClientRect();const e=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return {t:bt.textContent.trim().slice(0,8),covered:!g.contains(e)}})});
  ok(`W=${W} 付箋を開いたままでも、入力確認ガイドの全ボタンが隠れずに押せる`,!!r&&r.length>=2&&r.every(x=>!x.covered),r);
  await ctx.close();
 }
 await b.close();srv.close();
})();

// 全タブの画面幅（.app）がそろっていること（見積タブとそれ以外で幅が変わらない）。
//   node scripts/design-tests/app-width-test.js           （現行）
//   THEME=1 node scripts/design-tests/app-width-test.js   （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 for(const w of [1280,1400,1700,1900,2560]){
  const ctx=await b.newContext({viewport:{width:w,height:900},locale:'ja-JP'});
  if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
  const res=[];
  for(const c of ['quote','stats','master','bookmark','cost','calendar','vessel','booking','docs','calc','ref']){
   await p.evaluate(c=>{const b=document.querySelector(`.cat-btn[onclick*="switchCategory('${c}'"]`);switchCategory(c,b);},c);await p.waitForTimeout(350);
   res.push(await p.evaluate(c=>{const a=document.querySelector('.app').getBoundingClientRect();const h=document.querySelector('.header').getBoundingClientRect();const n=document.querySelector('.cat-nav').getBoundingClientRect();return {c,app:Math.round(a.width),hdr:Math.round(h.width),nav:Math.round(n.width),sx:document.documentElement.scrollWidth>innerWidth+1};},c));
  }
  const same=res.every(r=>r.app===res[0].app&&r.hdr===res[0].hdr&&r.nav===res[0].nav);
  ok(`${w}px：全タブで、画面幅・ヘッダー・カテゴリの行の幅が同じ（${res[0].app}px）`,same,res);
  ok(`${w}px：横スクロールが出ない`,res.every(r=>!r.sx),res.filter(r=>r.sx));
  ok(`${w}px：JS エラーなし`,errs.length===0,errs);
  await ctx.close();
 }
 await b.close();srv.close();
})();

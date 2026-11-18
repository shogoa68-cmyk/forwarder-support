// サブコン見出しの「🔖 BOOKMARK」の吹き出し（.sv-bm-pop）：リンクが多くても画面内に収まって中でスクロールでき、Esc でも閉じる。
//   node scripts/design-tests/bm-pop-test.js            （現行）
//   THEME=1 node scripts/design-tests/bm-pop-test.js    （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${process.env.THEME?'industry':'classic'}`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 for(const [W,H] of [[1400,800],[390,700]]){
  const ctx=await b.newContext({viewport:{width:W,height:H},locale:'ja-JP'});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);
  await p.evaluate(()=>{
   const rows=[];for(let i=0;i<60;i++)rows.push({id:'b'+i,label:'リンク'+i,url:'https://example.com/'+i,carrier:'ONE',function:'',note:''});
   const q={select(){return q},in(){return q},or(){return Promise.resolve({data:rows,error:null})},eq(){return q},then(r){return Promise.resolve({data:[],error:null}).then(r)}};
   window.SupabaseClient={auth:{getSession:async()=>({data:{session:{user:{email:'a@b'}}}})},from(){return q}};
   const d=document.createElement('button');d.id='tbtn';d.textContent='x';d.style.cssText='position:fixed;top:300px;left:'+(innerWidth-60)+'px;z-index:5';document.body.appendChild(d);d.onclick=e=>bmShowForCarrier('ONE',e);
  });
  await p.click('#tbtn');await p.waitForTimeout(900);
  const r=await p.evaluate(()=>{const e=document.querySelector('.sv-bm-pop');if(!e)return null;const q=e.getBoundingClientRect();return {t:q.top,b:q.bottom,vh:innerHeight,scroll:e.scrollHeight>e.clientHeight}});
  ok(`W=${W} リンクが 60 件でも吹き出しは画面の高さに収まり、中でスクロールできる`,!!r&&r.t>=0&&r.b<=r.vh&&r.scroll,r);
  await p.keyboard.press('Escape');await p.waitForTimeout(200);
  ok(`W=${W} Esc で閉じる`,!(await p.evaluate(()=>document.querySelector('.sv-bm-pop'))),null);
  await ctx.close();
 }
 await b.close();srv.close();
})();

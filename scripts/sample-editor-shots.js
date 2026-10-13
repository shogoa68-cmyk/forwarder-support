#!/usr/bin/env node
// Design への確認用に、見積入力画面の「かんたん表示」の画像を生成する（架空データ・実サーバーには接続しない）。
//   node scripts/sample-editor-shots.js              かんたん表示 → <OUT>/01-top-empty.png ほか（OUT 既定：docs/design-handoff/requests/editor-simple）
//   MODE=detail / THEME=1 / W=390 H=844 / OUT=<dir> で切替。Playwright と Chromium が必要。
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||path.resolve(__dirname,'..','docs','design-handoff','requests','editor-simple');
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root=path.resolve(__dirname,'..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:+process.env.W||1400,height:+process.env.H||900},locale:'ja-JP'});
 await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},process.env.MODE||'simple');
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1000);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(1800);
 await p.screenshot({path:OUT+'/01-top-empty.png'});
 await p.fill('#qf-ref','10-261013-001');await p.fill('#qf-customer','サンプル商事株式会社');await p.fill('#qf-person','山田');
 await p.click('#dirBtns [data-dir="export"]');await p.evaluate(()=>setTransport('fcl'));
 await p.selectOption('#cond-incoterms',{label:'FOB（本船渡し）'});
 await p.fill('#z2Carrier','Maersk');await p.fill('#z2Pol','YOKOHAMA');await p.fill('#z2Pod','BANGKOK');await p.evaluate(()=>addRouteEntry());
 await p.waitForTimeout(1800);
 await p.screenshot({path:OUT+'/02-top-filled.png'});
 await p.evaluate(()=>document.getElementById('section-cargo').scrollIntoView());await p.waitForTimeout(400);
 await p.screenshot({path:OUT+'/03-cargo.png'});
 await p.evaluate(()=>document.getElementById('section-scope').scrollIntoView());await p.waitForTimeout(400);
 await p.screenshot({path:OUT+'/04-scope-remark.png'});
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());await p.waitForTimeout(400);
 await p.screenshot({path:OUT+'/05-table.png'});
 await p.evaluate(()=>window.scrollTo(0,0));await p.waitForTimeout(200);
 await p.click('#saveToolbar .tb-menu button.save-btn-menu');await p.waitForTimeout(300);
 await p.screenshot({path:OUT+'/06-toolbar-menu.png',clip:{x:700,y:140,width:700,height:420}});
 console.log('errors',JSON.stringify(errs));
 await b.close();srv.close();
})();

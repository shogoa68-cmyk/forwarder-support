// 用語の説明（Industry：右からのドロワー）の確認。  THEME=1 node scripts/design-tests/glossary-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:900},locale:'ja-JP'});
 await ctx.addInitScript(()=>{try{localStorage.setItem('fwd.uiMode','detail')}catch(e){}});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1000);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const ind=!!process.env.THEME;
 if(ind){
  await p.locator('button',{hasText:'用語の説明'}).first().click();await p.waitForTimeout(300);
  const vis=await p.locator('#glossaryDrawer').isVisible();ok('ドロワーが開く',vis);
  const n=await p.locator('#glossaryDrawer .gl-item').count();ok('用語が一覧に出る（20件以上）',n>=20,n);
  ok('検索欄に焦点',await p.evaluate(()=>document.activeElement&&document.activeElement.classList.contains('gl-search')));
  await p.fill('#glossaryDrawer .gl-search','R/T');await p.waitForTimeout(150);
  const t=await p.locator('#glossaryDrawer .gl-term').allTextContents();ok('検索：R/T で絞り込む',t.length>=1&&t.length<n&&t.some(x=>x.includes('R/T')),t);
  await p.fill('#glossaryDrawer .gl-search','');
  await p.click('#glossaryDrawer .gl-groups button[data-g="sur"]');await p.waitForTimeout(150);
  const t2=await p.locator('#glossaryDrawer .gl-term').allTextContents();ok('グループ：サーチャージ',t2.length===1&&t2[0].includes('BAF'),t2);
  await p.click('#glossaryDrawer .gl-groups button[data-g="doc"]');
  const t3=await p.locator('#glossaryDrawer .gl-term').allTextContents();ok('グループ：書類・申告',t3.some(x=>x.includes('VGM'))&&t3.some(x=>x.includes('D/O')),t3);
  await p.click('#glossaryDrawer .gl-groups button[data-g="all"]');
  await p.screenshot({path:OUT+'/glossary-drawer.png'});
  await p.keyboard.press('Escape');await p.waitForTimeout(150);
  ok('Esc で閉じる',!(await p.locator('#glossaryDrawer').isVisible()));
  await p.locator('button',{hasText:'用語の説明'}).first().click();await p.waitForTimeout(150);
  await p.click('#glossaryDrawer .gl-close');ok('✕ で閉じる',!(await p.locator('#glossaryDrawer').isVisible()));
 } else {
  await p.locator('button',{hasText:'用語の説明'}).first().click();await p.waitForTimeout(600);
  ok('現行：ドロワーは使わず、使い方の補足欄が開く',!(await p.locator('#glossaryDrawer').count())&&await p.evaluate(()=>document.getElementById('quoteTabHelp').open));
 }
 ok('JSエラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

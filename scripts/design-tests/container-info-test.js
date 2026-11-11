// コンテナのチップ：内寸・外寸・容積・最大重量は「ⓘ」にしまい、ホバー／焦点／押下で吹き出し表示。
//   node scripts/design-tests/container-info-test.js            （現行）
//   THEME=1 node scripts/design-tests/container-info-test.js    （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
let fails=0;const ok=(n,c,x)=>{if(!c)fails++;console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:+process.env.W||1400,height:900},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);
 await p.click('.cat-btn[aria-controls="tab-quote-make"]');await p.waitForTimeout(800);
 await p.evaluate(()=>{ if(typeof qpNewQuote==='function') qpNewQuote(); });await p.waitForTimeout(600);
 await p.evaluate(()=>{const s=document.getElementById('section-volume'); if(s&&s.classList.contains('is-collapsed')) toggleQuoteSection('section-volume'); s&&s.scrollIntoView({block:'center'});});await p.waitForTimeout(300);
 const st=await p.evaluate(()=>{const chips=[...document.querySelectorAll('.container-chip-grid .cc-chip[data-ctype]')];
  return {n:chips.length,withInfo:chips.filter(c=>c.querySelector('.cc-info')).length,
   oldDims:document.querySelectorAll('.cc-chip-dims').length,
   inlineText:chips.filter(c=>c.offsetParent&&/内\s*\d|外\s*\d/.test(c.innerText.replace(/\s+/g,' '))).length};});
 ok('寸法のある 10 チップに ⓘ がある（「未定」には出さない・旧・常時表示の寸法は無い）',st.n===11&&st.withInfo===10&&st.oldDims===0,st);
 ok('チップ上には寸法の文字が出ていない（ホバー前）',st.inlineText===0,st);
 const pop=async sel=>p.evaluate(s=>{const w=document.querySelector(s);const pp=w.querySelector('.cc-info-pop');const r=pp.getBoundingClientRect();return {shown:getComputedStyle(pp).display!=='none',text:pp.innerText.replace(/\s+/g,' '),l:Math.round(r.left),r:Math.round(r.right),vw:innerWidth};},sel);
 let v=await pop(`.cc-chip[data-ctype="20'GP"] .cc-info-wrap`);
 ok('ホバー前は吹き出しが閉じている',!v.shown,v);
 await p.hover(`.cc-chip[data-ctype="20'GP"] .cc-info`);await p.waitForTimeout(200);
 v=await pop(`.cc-chip[data-ctype="20'GP"] .cc-info-wrap`);
 ok('カーソルを乗せると、内寸・外寸・容積・最大重量が出る',v.shown&&/内寸 5\.89×2\.35×2\.39 m/.test(v.text)&&/外寸 6\.06×2\.44×2\.59 m/.test(v.text)&&/容積/.test(v.text)&&/最大重量/.test(v.text),v);
 ok('吹き出しは画面内に収まる',v.l>=0&&v.r<=v.vw,v);
 await p.screenshot({path:OUT+'/container-info-dry.png',clip:{x:0,y:0,width:+process.env.W||1400,height:900}});
 // 吹き出しの上へ移しても閉じない（将来リンクを押せるように）
 const pb=await p.evaluate(()=>{const r=document.querySelector(`.cc-chip[data-ctype="20'GP"] .cc-info-pop`).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
 await p.mouse.move(pb.x,pb.y);await p.waitForTimeout(150);
 v=await pop(`.cc-chip[data-ctype="20'GP"] .cc-info-wrap`);
 ok('吹き出しの上へ移しても閉じない',v.shown,v);
 await p.mouse.move(5,5);await p.waitForTimeout(150);
 v=await pop(`.cc-chip[data-ctype="20'GP"] .cc-info-wrap`);
 ok('離れると閉じる',!v.shown,v);
 // 本数の操作に影響しない
 await p.click(`.cc-chip[data-ctype="20'GP"] .cc-plus`);await p.click(`.cc-chip[data-ctype="20'GP"] .cc-plus`);
 const cnt=await p.inputValue(`.cc-chip[data-ctype="20'GP"] .cc-count`);
 ok('＋ボタンで本数が増える（ⓘの追加で壊れていない）',cnt==='2',cnt);
 // 押して開く（タッチ端末向け）・Esc／外側で閉じる
 await p.click(`.cc-chip[data-ctype="40'HQ"] .cc-info`);await p.mouse.move(5,5);await p.waitForTimeout(150);
 v=await pop(`.cc-chip[data-ctype="40'HQ"] .cc-info-wrap`);
 ok('ⓘを押すと開いたままになる（ホバーできない端末用）',v.shown&&/2\.69/.test(v.text),v);
 await p.keyboard.press('Escape');await p.waitForTimeout(100);
 v=await pop(`.cc-chip[data-ctype="40'HQ"] .cc-info-wrap`);
 ok('Esc で閉じる',!v.shown,v);
 // キーボード焦点
 await p.focus(`.cc-chip[data-ctype="45'HC"] .cc-info`);await p.waitForTimeout(100);
 v=await pop(`.cc-chip[data-ctype="45'HC"] .cc-info-wrap`);
 ok('キーボードで焦点を当てても出る',v.shown&&/13\.54/.test(v.text),v);
 // 特殊コンテナ
 await p.click('.cc-cat-tab[data-cat="special"]');await p.waitForTimeout(300);
 await p.hover(`.cc-chip[data-ctype="20'RF（冷凍）"] .cc-info`);await p.waitForTimeout(200);
 v=await pop(`.cc-chip[data-ctype="20'RF（冷凍）"] .cc-info-wrap`);
 ok('RF も出る',v.shown&&/5\.43×2\.28×2\.25/.test(v.text),v);
 await p.screenshot({path:OUT+'/container-info-rf.png',clip:{x:0,y:0,width:+process.env.W||1400,height:900}});
 await p.click('.cc-sub-tab[data-sub="otfr"]');await p.waitForTimeout(300);
 await p.hover(`.cc-chip[data-ctype="40'FR（フラットラック）"] .cc-info`);await p.waitForTimeout(200);
 v=await pop(`.cc-chip[data-ctype="40'FR（フラットラック）"] .cc-info-wrap`);
 ok('FR は「床面（高さ制限なし）」で出る・画面内に収まる',v.shown&&/床面/.test(v.text)&&v.r<=v.vw,v);
 await p.mouse.move(5,5);
 // 将来のリンク
 const lk=await p.evaluate(()=>{CONTAINER_GUIDE_LINKS["20'GP"]='https://example.com/guide/20gp';const c=document.querySelector(`.cc-chip[data-ctype="20'GP"]`);c.querySelector('.cc-info-wrap').remove();renderContainerChipDims();const a=c.querySelector('.cc-info-link');return a?{href:a.getAttribute('href'),t:a.textContent}:null;});
 ok('解説ページのリンクを登録すると「くわしく見る」が出る',lk&&lk.href==='https://example.com/guide/20gp',lk);
 // 保存形式（コンテナのデータ）が従来どおり
 const d=await p.evaluate(()=>document.getElementById('cond-container-data')&&document.getElementById('cond-container-data').value);
 ok('保存データは従来どおり（20\'GP 2 本）',/20'GP/.test(d||'')&&/2/.test(d||''),d);
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
 console.log(fails?`\nFAIL=${fails}`:'\nALL PASS');process.exit(fails?1:0);
})();

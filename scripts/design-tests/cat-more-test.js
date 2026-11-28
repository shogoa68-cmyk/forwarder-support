// カテゴリナビ（2026-11 再編）：上段は「💼 見積を作る」「📦 進行管理」（直接開く）＋ 2 つのまとまり（💬 情報共有／📂 その他）。各タブはまとまりのメニューの中（各項目に 1 行説明）。
//   node scripts/design-tests/cat-more-test.js            （現行）
//   THEME=1 node scripts/design-tests/cat-more-test.js    （Industry）
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
 const ctx=await b.newContext({viewport:{width:+process.env.W||1400,height:900},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);

 const GROUPS={catGrpShare:['tab-news','tab-share','tab-bookmark','tab-incoterms','tab-calendar'],catMore:['tab-stats','tab-master','tab-calc','tab-local-charges','tab-booking-tab','tab-bldo','tab-tracking','tab-cptest','tab-workfolder','tab-manual']};
 const t0=await p.evaluate(()=>[...document.querySelectorAll('.cat-nav > *')].filter(e=>e.offsetParent!==null).map(e=>e.textContent.replace(/\s+/g,' ').trim()));
 ok('上段は 見積を作る・進行管理・情報共有・その他 の 4 つだけ',t0.length===4&&/見積を作る/.test(t0[0])&&/進行管理/.test(t0[1])&&/情報共有/.test(t0[2])&&/その他/.test(t0[3]),t0);
 const mem=await p.evaluate(G=>Object.entries(G).map(([g,ids])=>{const pn=document.querySelector('#'+g+' .cat-more-panel');const got=[...pn.querySelectorAll('.cat-btn')].map(b=>b.getAttribute('aria-controls'));return JSON.stringify(got)===JSON.stringify(ids);}),GROUPS);
 ok('各まとまりの中身が決めたとおり（全タブがどこかに入っている）',mem.every(Boolean),mem);
 ok('どのタブのボタンも 1 つずつ（aria-controls の重複なし）',await p.evaluate(()=>{const a=[...document.querySelectorAll('.cat-nav .cat-btn[aria-controls^="tab-"]')].map(b=>b.getAttribute('aria-controls'));return a.length===new Set(a).size&&a.length===17;}),null);
 ok('「進行管理」もメニューに入れず上段の直接のボタン',await p.evaluate(()=>{const b=document.querySelector('.cat-btn[aria-controls="tab-ops"]');return b.parentElement.classList.contains('cat-nav')&&b.offsetParent!==null&&!document.getElementById('catGrpOps');}),null);
 ok('「見積を作る」はメニューに入れず上段の直接のボタン（最初から選択中）',await p.evaluate(()=>{const b=document.querySelector('.cat-btn[aria-controls="tab-quote-make"]');return b.parentElement.classList.contains('cat-nav')&&b.classList.contains('active')&&b.offsetParent!==null&&!document.getElementById('catMoreBtn').classList.contains('active');}),null);
 await p.evaluate(()=>switchCategory('stats',document.querySelector('.cat-btn[aria-controls="tab-stats"]')));await p.waitForTimeout(300);
 await p.click('.cat-nav > .cat-btn[aria-controls="tab-quote-make"]');await p.waitForTimeout(500);
 ok('「見積を作る」を押すとメニューを開かずに見積の画面になる',await p.evaluate(()=>document.getElementById('tab-quote-make').classList.contains('active')&&document.querySelectorAll('.cat-more-panel:not([hidden])').length===0&&!document.getElementById('catMoreBtn').classList.contains('active')),null);
 // 開いて選ぶ
 await p.click('#catGrpShareBtn');await p.waitForTimeout(200);
 const open=await p.evaluate(()=>{const pn=document.getElementById('catGrpSharePanel');const items=[...pn.querySelectorAll('.cat-btn')];const bad=items.filter(b=>{const q=b.getBoundingClientRect();const e=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return !(e&&(e===b||b.contains(e)));});return {hidden:pn.hidden,exp:document.getElementById('catGrpShareBtn').getAttribute('aria-expanded'),n:items.length,covered:bad.length};});
 ok('「情報共有」を押すと 5 項目が出る（隠れずに押せる）',!open.hidden&&open.exp==='true'&&open.n===5&&open.covered===0,open);
 await p.screenshot({path:OUT+'/cat-groups-open.png',clip:{x:0,y:0,width:1400,height:460}});
 await p.click('#catMoreBtn');await p.waitForTimeout(150);
 ok('別のまとまりを開くと、前のメニューは閉じる',await p.evaluate(()=>document.getElementById('catGrpSharePanel').hidden&&!document.getElementById('catMorePanel').hidden),null);
 await p.keyboard.press('Escape');await p.waitForTimeout(100);
 await p.click('#catGrpShareBtn');await p.waitForTimeout(150);
 await p.click('.cat-btn[aria-controls="tab-incoterms"]');await p.waitForTimeout(500);
 const s1=await p.evaluate(()=>({hidden:document.getElementById('catGrpSharePanel').hidden,label:document.querySelector('#catGrpShareBtn .cat-more-label').textContent,act:document.getElementById('catGrpShareBtn').classList.contains('active'),tab:document.getElementById('tab-incoterms').classList.contains('active'),q:false,qa:document.querySelector('.cat-nav > .cat-btn[aria-controls="tab-quote-make"]').classList.contains('active')}));
 ok('選ぶと閉じて画面が切り替わり、「情報共有」が選択中・下に「知識・参考」。見積の印は外れる',s1.hidden&&/知識・参考/.test(s1.label)&&s1.act&&s1.tab&&s1.qa===false,s1);
 await p.click('#catMoreBtn');await p.waitForTimeout(150);await p.mouse.click(700,600);await p.waitForTimeout(150);
 ok('外側を押すと閉じる',await p.evaluate(()=>document.getElementById('catMorePanel').hidden),null);
 await p.evaluate(()=>{switchCategory('calc',document.querySelector('.cat-btn[aria-controls="tab-calc"]'));});await p.waitForTimeout(300);
 ok('コードから switchCategory で切り替えても、まとまりの印が追従する',await p.evaluate(()=>document.getElementById('tab-calc').classList.contains('active')&&document.getElementById('catMoreBtn').classList.contains('active')&&/計算/.test(document.querySelector('#catMoreBtn .cat-more-label').textContent)&&!document.getElementById('catGrpShareBtn').classList.contains('active')),null);
 ok('メニューの全項目に 1 行説明（data-desc）があり、ボタンの文字には混ざらない',await p.evaluate(()=>{const bs=[...document.querySelectorAll('.cat-more-panel .cat-btn')];return bs.length===15&&bs.every(b=>b.dataset.desc&&!b.textContent.includes(b.dataset.desc));}),null);
 await p.evaluate(()=>{switchCategory('news',document.querySelector('.cat-btn[aria-controls="tab-news"]'));});await p.waitForTimeout(400);
 ok('「ニュースの投稿」の画面が開く（未ログインは案内）',await p.evaluate(()=>document.getElementById('tab-news').classList.contains('active')&&/ログイン/.test(document.getElementById('nfRoot').textContent)),null);
 await p.setViewportSize({width:390,height:800});await p.waitForTimeout(300);
 const fit=await p.evaluate(()=>{const n=document.querySelector('.cat-nav');return {sw:n.scrollWidth,cw:n.clientWidth};});
 ok('スマホ幅でも 4 つが横に収まる（横スクロールなし）',fit.sw<=fit.cw+1,fit);
 await p.click('#catMoreBtn');await p.waitForTimeout(200);
 const m=await p.evaluate(()=>{const pn=document.getElementById('catMorePanel');const r=pn.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),w:innerWidth,hidden:pn.hidden};});
 ok('スマホ幅でも、メニューが画面内に収まって開く',!m.hidden&&m.l>=0&&m.r<=m.w,m);
 await p.screenshot({path:OUT+'/cat-groups-mobile.png'});
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

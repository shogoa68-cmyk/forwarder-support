// カテゴリナビ（2026-11 整理）：作業系 5 つ（リンク集・見積を作る・計算・書類・通関・Booking/SI＝ティール）＋見る・管理系 2 つ（実績を見る・マスター管理＝グレー）＋「📂 その他」（調べる 3＋ほか 3＝6 カテゴリ・各項目に 1 行説明）。
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
 const top=()=>p.evaluate(()=>[...document.querySelectorAll('.cat-nav > .cat-btn, .cat-nav > .cat-more > .cat-btn')].filter(b=>b.offsetParent!==null).map(b=>b.textContent.replace(/\s+/g,' ').trim()));
 const t0=await top();
 ok('上段は リンク集・見積を作る・進行管理・情報共有・計算・書類・通関・Booking/SI・実績を見る・マスター管理・「その他」の順',t0.length===10&&/リンク集/.test(t0[0])&&/見積を作る/.test(t0[1])&&/進行管理/.test(t0[2])&&/情報共有/.test(t0[3])&&/計算/.test(t0[4])&&/書類/.test(t0[5])&&/Booking/.test(t0[6])&&/実績を見る/.test(t0[7])&&/マスター管理/.test(t0[8])&&/その他/.test(t0[9]),t0);
 const col=await p.evaluate(()=>[...document.querySelectorAll('.cat-nav > .cat-btn')].map(b=>({t:b.textContent.trim().slice(0,6),act:b.classList.contains('active'),bg:getComputedStyle(b).backgroundImage+getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color,bd:getComputedStyle(b).borderColor})));
 const work=col.filter(c=>!c.act&&/^(🔖|📦|💬|🧮|📄|📋)/.test(c.t));
 const adm=col.filter(c=>/^(📊|🗂)/.test(c.t));
 const actv=col.filter(c=>c.act);
 ok('作業系 6 つ（選択中を除く）は同じ色',work.length===6&&work.every(c=>c.bg===work[0].bg&&c.fg===work[0].fg&&c.bd===work[0].bd),col);
 ok('見る・管理系 2 つは同じ色で、作業系とは別の色',adm.length===2&&adm.every(c=>c.bg===adm[0].bg)&&adm[0].bg!==work[0].bg,col);
 ok('選択中（見積を作る）だけ濃い',actv.length===1&&/見積/.test(actv[0].t)&&actv[0].bg!==work[0].bg,col);
 ok('「その他」は別の色（地味なまま）',await p.evaluate(()=>{const o=getComputedStyle(document.getElementById('catMoreBtn'));return o.backgroundImage+o.backgroundColor;})!==work[0].bg,col);
 const vis=await p.evaluate(()=>['tab-local-charges','tab-calendar','tab-tracking','tab-incoterms','tab-workfolder','tab-cptest'].map(id=>{const b=document.querySelector(`.cat-btn[aria-controls="${id}"]`);return !!b&&b.offsetParent===null;}));
 ok('「その他」の 6 カテゴリのボタンは DOM に残り（情報は残る）、閉じている間は見えない',vis.every(Boolean),vis);
 await p.click('#catMoreBtn');await p.waitForTimeout(200);
 const open=await p.evaluate(()=>{const pn=document.getElementById('catMorePanel');const r=pn.getBoundingClientRect();const items=[...pn.querySelectorAll('.cat-btn')];const bad=items.filter(b=>{const q=b.getBoundingClientRect();const e=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return !(e&&(e===b||b.contains(e)));});return {hidden:pn.hidden,exp:document.getElementById('catMoreBtn').getAttribute('aria-expanded'),labels:items.map(b=>b.textContent.trim()),top:Math.round(r.top),covered:bad.length};});
 ok('開くと 6 項目（調べる 3＋ほか 3）が出る（隠れずに押せる）',!open.hidden&&open.exp==='true'&&open.labels.length===6&&/本船・航路/.test(open.labels[0])&&/サイバーポート/.test(open.labels[3])&&open.covered===0,open);
 await p.screenshot({path:OUT+'/cat-more-open.png',clip:{x:0,y:0,width:1400,height:420}});
 await p.click('.cat-btn[aria-controls="tab-incoterms"]');await p.waitForTimeout(500);
 const s1=await p.evaluate(()=>({hidden:document.getElementById('catMorePanel').hidden,label:document.querySelector('#catMoreBtn .cat-more-label').textContent,act:document.getElementById('catMoreBtn').classList.contains('active'),calc:document.getElementById('tab-incoterms').classList.contains('active'),sub:true,quoteAct:document.querySelector('.cat-btn[aria-controls="tab-quote-make"]').classList.contains('active')}));
 ok('選ぶと閉じて、画面が切り替わり、「その他」に選択中の名前が出る（強調）',s1.hidden&&/知識・参考/.test(s1.label)&&s1.act&&s1.calc&&s1.sub&&!s1.quoteAct,s1);
 await p.screenshot({path:OUT+'/cat-more-selected.png',clip:{x:0,y:0,width:1400,height:200}});
 await p.click('.cat-btn[aria-controls="tab-quote-make"]');await p.waitForTimeout(400);
 const s2=await p.evaluate(()=>({label:document.querySelector('#catMoreBtn .cat-more-label').textContent,act:document.getElementById('catMoreBtn').classList.contains('active')}));
 ok('ほかのカテゴリへ移ると、「その他」は元の表示に戻る',s2.label==='その他'&&!s2.act,s2);
 await p.click('#catMoreBtn');await p.waitForTimeout(150);await p.keyboard.press('Escape');await p.waitForTimeout(150);
 ok('Esc で閉じる',await p.evaluate(()=>document.getElementById('catMorePanel').hidden),null);
 await p.click('#catMoreBtn');await p.waitForTimeout(150);await p.mouse.click(700,500);await p.waitForTimeout(150);
 ok('外側を押すと閉じる',await p.evaluate(()=>document.getElementById('catMorePanel').hidden),null);
 // 既存コードからの切替（計算ボタンを探して switchCategory を呼ぶ経路）
 await p.evaluate(()=>{const c=document.querySelector('.cat-btn[aria-controls="tab-incoterms"]');switchCategory('ref',c);});await p.waitForTimeout(300);
 ok('コードから switchCategory で切り替えても「その他」が追従する',await p.evaluate(()=>/知識・参考/.test(document.querySelector('#catMoreBtn .cat-more-label').textContent)),null);
 ok('その他の項目に 1 行説明（data-desc）があり、ボタンの文字には混ざらない',await p.evaluate(()=>{const bs=[...document.querySelectorAll('#catMorePanel .cat-btn')];return bs.length===6&&bs.every(b=>b.dataset.desc&&!b.textContent.includes(b.dataset.desc))&&getComputedStyle(bs[0],'::after').content.length>3;}),null);
 await p.evaluate(()=>{switchCategory('calc',document.querySelector('.cat-btn[aria-controls="tab-calc"]'));});await p.waitForTimeout(300);
 ok('外に出した「計算」を押すと計算の画面になり、「その他」は元の表示のまま',await p.evaluate(()=>document.getElementById('tab-calc').classList.contains('active')&&document.querySelector('#catMoreBtn .cat-more-label').textContent==='その他'&&document.querySelector('.cat-btn[aria-controls="tab-calc"]').classList.contains('active')),null);
 // スマホ幅
 await p.setViewportSize({width:390,height:800});await p.waitForTimeout(300);
 await p.click('#catMoreBtn');await p.waitForTimeout(200);
 const m=await p.evaluate(()=>{const pn=document.getElementById('catMorePanel');const r=pn.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),w:innerWidth,hidden:pn.hidden,pos:getComputedStyle(pn).position};});
 ok('スマホ幅でも、メニューが画面内に収まって開く',!m.hidden&&m.l>=0&&m.r<=m.w&&m.pos==='fixed',m);
 await p.screenshot({path:OUT+'/cat-more-mobile.png'});
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

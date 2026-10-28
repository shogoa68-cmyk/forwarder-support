// カテゴリナビ：BOOKMARK・見積・統計・マスター管理の 4 つ（同じ色）＋「📂 その他」（諸チャージ含む 7 カテゴリ）。
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
 ok('上段は BOOKMARK・見積・統計・マスター管理・「その他」の順',t0.length===5&&/BOOKMARK/.test(t0[0])&&/見積/.test(t0[1])&&/統計/.test(t0[2])&&/マスター管理/.test(t0[3])&&/その他/.test(t0[4]),t0);
 const col=await p.evaluate(()=>[...document.querySelectorAll('.cat-nav > .cat-btn')].map(b=>({t:b.textContent.trim().slice(0,6),act:b.classList.contains('active'),bg:getComputedStyle(b).backgroundImage+getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color,bd:getComputedStyle(b).borderColor})));
 const idle=col.filter(c=>!c.act&&!/その他/.test(c.t));
 const actv=col.filter(c=>c.act);
 ok('4 つのカテゴリは同じ色（選択中の見積だけ濃い）',idle.length===3&&idle.every(c=>c.bg===idle[0].bg&&c.fg===idle[0].fg&&c.bd===idle[0].bd)&&actv.length===1&&actv[0].bg!==idle[0].bg,col);
 ok('「その他」は別の色（地味なまま）',await p.evaluate(()=>{const o=getComputedStyle(document.getElementById('catMoreBtn'));return o.backgroundImage+o.backgroundColor;})!==idle[0].bg,col);
 const vis=await p.evaluate(()=>['tab-local-charges','tab-calendar','tab-tracking','tab-booking-tab','tab-bldo','tab-calc','tab-incoterms'].map(id=>{const b=document.querySelector(`.cat-btn[aria-controls="${id}"]`);return !!b&&b.offsetParent===null;}));
 ok('7 カテゴリのボタンは DOM に残り（情報は残る）、閉じている間は見えない',vis.every(Boolean),vis);
 await p.click('#catMoreBtn');await p.waitForTimeout(200);
 const open=await p.evaluate(()=>{const pn=document.getElementById('catMorePanel');const r=pn.getBoundingClientRect();const items=[...pn.querySelectorAll('.cat-btn')];const bad=items.filter(b=>{const q=b.getBoundingClientRect();const e=document.elementFromPoint(q.left+q.width/2,q.top+q.height/2);return !(e&&(e===b||b.contains(e)));});return {hidden:pn.hidden,exp:document.getElementById('catMoreBtn').getAttribute('aria-expanded'),labels:items.map(b=>b.textContent.trim()),top:Math.round(r.top),covered:bad.length};});
 ok('開くと 7 項目（先頭が諸チャージ）が出る（隠れずに押せる）',!open.hidden&&open.exp==='true'&&open.labels.length===7&&/諸チャージ/.test(open.labels[0])&&open.covered===0,open);
 await p.screenshot({path:OUT+'/cat-more-open.png',clip:{x:0,y:0,width:1400,height:420}});
 await p.click('.cat-btn[aria-controls="tab-calc"]');await p.waitForTimeout(500);
 const s1=await p.evaluate(()=>({hidden:document.getElementById('catMorePanel').hidden,label:document.querySelector('#catMoreBtn .cat-more-label').textContent,act:document.getElementById('catMoreBtn').classList.contains('active'),calc:document.getElementById('tab-calc').classList.contains('active'),sub:!!document.querySelector('#sub-calc.active'),quoteAct:document.querySelector('.cat-btn[aria-controls="tab-quote-make"]').classList.contains('active')}));
 ok('選ぶと閉じて、画面が切り替わり、「その他」に選択中の名前が出る（強調）',s1.hidden&&/計算/.test(s1.label)&&s1.act&&s1.calc&&s1.sub&&!s1.quoteAct,s1);
 await p.screenshot({path:OUT+'/cat-more-selected.png',clip:{x:0,y:0,width:1400,height:200}});
 await p.click('.cat-btn[aria-controls="tab-quote-make"]');await p.waitForTimeout(400);
 const s2=await p.evaluate(()=>({label:document.querySelector('#catMoreBtn .cat-more-label').textContent,act:document.getElementById('catMoreBtn').classList.contains('active')}));
 ok('ほかのカテゴリへ移ると、「その他」は元の表示に戻る',s2.label==='その他'&&!s2.act,s2);
 await p.click('#catMoreBtn');await p.waitForTimeout(150);await p.keyboard.press('Escape');await p.waitForTimeout(150);
 ok('Esc で閉じる',await p.evaluate(()=>document.getElementById('catMorePanel').hidden),null);
 await p.click('#catMoreBtn');await p.waitForTimeout(150);await p.mouse.click(700,500);await p.waitForTimeout(150);
 ok('外側を押すと閉じる',await p.evaluate(()=>document.getElementById('catMorePanel').hidden),null);
 // 既存コードからの切替（計算ボタンを探して switchCategory を呼ぶ経路）
 await p.evaluate(()=>{const c=document.querySelector('.cat-btn[aria-controls="tab-calc"]');switchCategory('calc',c);});await p.waitForTimeout(300);
 ok('コードから switchCategory で切り替えても「その他」が追従する',await p.evaluate(()=>/計算/.test(document.querySelector('#catMoreBtn .cat-more-label').textContent)),null);
 // スマホ幅
 await p.setViewportSize({width:390,height:800});await p.waitForTimeout(300);
 await p.click('#catMoreBtn');await p.waitForTimeout(200);
 const m=await p.evaluate(()=>{const pn=document.getElementById('catMorePanel');const r=pn.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),w:innerWidth,hidden:pn.hidden,pos:getComputedStyle(pn).position};});
 ok('スマホ幅でも、メニューが画面内に収まって開く',!m.hidden&&m.l>=0&&m.r<=m.w&&m.pos==='fixed',m);
 await p.screenshot({path:OUT+'/cat-more-mobile.png'});
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

// 荷役条件（RO/RO・在来船の BTBT／FILO／LIFO／FIOS／FIOST）：別欄・説明・保存・御見積書。
//   node scripts/design-tests/handling-terms-test.js / THEME=1 …
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
 const ctx=await b.newContext({viewport:{width:1300,height:900},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).first();
 await f('nm').fill('海上運賃');await f('sv').fill('A海運');await f('un').fill("40'GP");await f('pq').fill('1');await f('pp').fill('1000');await f('mk').fill('100');await f('mk').blur();
 await p.waitForTimeout(400);
 await p.evaluate(()=>{document.getElementById('qf-customer').value='株式会社サンプル';document.getElementById('qf-person').value='山田';});

 const vis=()=>p.evaluate(()=>{const g=document.getElementById('handlingGroup');return !!g&&!g.hidden&&g.getClientRects().length>0&&getComputedStyle(g).display!=='none';});
 ok('新規作成の直後（輸送モード未選択）は、荷役条件の欄は画面に出ていない（hidden が display:flex に負けない）',await p.evaluate(()=>{const g=document.getElementById('handlingGroup');return !!g&&g.hidden&&getComputedStyle(g).display==='none'&&g.getClientRects().length===0;}));
 const hint=()=>p.evaluate(()=>{const h=document.getElementById('cond-handling-hint');return h&&getComputedStyle(h).display!=='none'?h.textContent.trim():'';});
 const setInco=v=>p.evaluate(v=>{const s=document.getElementById('cond-incoterms');const o=[...s.options].find(o=>o.value.startsWith(v));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));},v);
 await setInco('FOB');
 const opts=await p.evaluate(()=>[...document.querySelectorAll('#cond-handling option')].map(o=>o.value));
 ok('荷役条件の選択肢は 5 種（BTBT／FILO／LIFO／FIOS／FIOST）＋「なし」',opts.length===6&&['BTBT','FILO','LIFO','FIOS','FIOST'].every((c,i)=>opts[i+1].startsWith(c)),opts);
 ok('インコタームズの選択肢には混ぜていない（別の欄）',await p.evaluate(()=>![...document.querySelectorAll('#cond-incoterms option')].some(o=>/BTBT|FILO|LIFO|FIOS/.test(o.value))));
 ok('輸送モードが未選択のあいだは荷役条件の欄は出ない',!(await vis()));
 await p.evaluate(()=>setTransport('fcl'));await p.waitForTimeout(200);
 ok('FCL では出ない',!(await vis()));
 await p.evaluate(()=>setTransport('roro'));await p.waitForTimeout(250);
 ok('RO/RO を選ぶと「🚢 荷役条件」の欄が出る',await vis());
 await p.evaluate(()=>setTransport('conv'));await p.waitForTimeout(250);
 ok('在来船でも出る',await vis());
 await p.evaluate(()=>setTransport('roro'));await p.waitForTimeout(250);
 const hints={BTBT:/船社負担/,FILO:/荷主負担.*Free In.*船社負担.*Liner Out/,LIFO:/船社負担.*Liner In.*荷受人.*Free Out/,FIOS:/Stowed/,FIOST:/Trimmed/};
 for(const c of Object.keys(hints)){
  await p.evaluate(c=>{const s=document.getElementById('cond-handling');const o=[...s.options].find(o=>o.value.startsWith(c));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));},c);
  ok(c+'：選ぶと日本語の説明が 1 行出る',hints[c].test(await hint()),await hint());
 }
 await p.evaluate(()=>{const s=document.getElementById('cond-handling');s.value='FIO'+'S（Free In Out Stowed）';s.dispatchEvent(new Event('change',{bubbles:true}));});
 const c1=await p.evaluate(()=>getConditions());
 ok('getConditions().handling に入る（インコタームズ FOB と併記できる）',/^FIOS/.test(c1.handling)&&/^FOB/.test(c1.incoterms),c1);
 await p.evaluate(()=>setTransport('fcl'));await p.waitForTimeout(250);
 ok('値が入っていれば、FCL に変えても欄は隠さない（入力済みの値を気づかず隠さない）',await vis());
 // 御見積書
 const doc=en=>p.evaluate(en=>{localStorage.setItem('quoteDocLangEn_v1',en?'1':'0');localStorage.setItem('quoteDocIncoDiagram_v1','0');document.getElementById('fxmock')?.remove();const d=document.createElement('div');d.id='fxmock';d.innerHTML=buildQuoteDocHTML();document.body.appendChild(d);
   const rows=[...d.querySelectorAll('.qd-srow')].map(r=>({k:(r.querySelector('.qd-sk')||{}).textContent||'',v:(r.querySelector('.qd-sv')||{}).textContent.trim()}));d.remove();return rows;},en);
 let rows=await doc(false);let i=rows.findIndex(r=>/建値/.test(r.k));
 ok('御見積書（日本語）：建値の行の直下に「荷役条件」の行が出る',i>=0&&rows[i+1]&&rows[i+1].k==='荷役条件'&&/^FIOS（Free In Out Stowed）/.test(rows[i+1].v),rows.slice(0,6));
 rows=await doc(true);i=rows.findIndex(r=>/Incoterms/.test(r.k));
 ok('御見積書（英語）：「Handling Terms」と英語の括弧で出る',i>=0&&rows[i+1]&&rows[i+1].k==='Handling Terms'&&/^FIOS \(Free In Out Stowed\)$/.test(rows[i+1].v),rows.slice(0,6));
 await p.evaluate(()=>{localStorage.setItem('quoteDocLangEn_v1','0');localStorage.setItem('quoteDocIncoDiagram_v1','1');});
 rows=await p.evaluate(()=>{document.getElementById('fxmock')?.remove();const d=document.createElement('div');d.id='fxmock';d.innerHTML=buildQuoteDocHTML();document.body.appendChild(d);const r=[...d.querySelectorAll('.qd-srow')].map(r=>r.classList.contains('qd-srow-full')?'図解':((r.querySelector('.qd-sk')||{}).textContent||''));d.remove();return r;});
 i=rows.findIndex(r=>/建値/.test(r));
 ok('貿易条件の図解を ON にしても、建値 → 図解 → 荷役条件の順',rows[i+1]==='図解'&&rows[i+2]==='荷役条件',rows);
 await p.evaluate(()=>localStorage.setItem('quoteDocIncoDiagram_v1','0'));
 // 保存・復元（フォーム値として案件データに入る）
 const rt=await p.evaluate(()=>{const d=gatherAllData();const saved=d.fields['cond-handling'];const s=document.getElementById('cond-handling');s.value='';setTransport('fcl');_applyQuoteData(JSON.parse(JSON.stringify(d)));return {saved,after:document.getElementById('cond-handling').value,show:!document.getElementById('handlingGroup').hidden};});
 ok('案件データに保存され、読み込むと復元される（欄も出る）',/^FIOS/.test(rt.saved)&&/^FIOS/.test(rt.after)&&rt.show,rt);
 // 画面プレビュー・下請けメール
 const pv=await p.evaluate(()=>{const c=getConditions();return {mail:typeof buildSubconRequestMail==='function'?'fn':'none',h:c.handling};});
 ok('「なし」に戻すと御見積書に行が出ない',await p.evaluate(()=>{const s=document.getElementById('cond-handling');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('fxmock')?.remove();const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();const r=![...d.querySelectorAll('.qd-sk')].some(x=>/荷役条件|Handling/.test(x.textContent));return r;}));
 await p.evaluate(()=>{setTransport('roro');const s=document.getElementById('cond-handling');s.value='FILO（Free In, Liner Out）';s.dispatchEvent(new Event('change',{bubbles:true}));window.cfSync&&cfSync();document.getElementById('section-cond').scrollIntoView({block:'start'});window.scrollBy(0,-120);});await p.waitForTimeout(500);
 await p.screenshot({path:OUT+'/handling.png'});
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

// 行ごとの「適用する貿易条件」：選んだ貿易条件のときだけ、行が客先向けの出力・合計に含まれる。
//   THEME=1 node scripts/design-tests/incoterms-row-test.js
//   THEME=1 node scripts/design-tests/gray-rows-test.js
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const run=async(p)=>{
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 const total=()=>p.evaluate(()=>document.getElementById('tot-subtotal').textContent.replace(/[^0-9]/g,''));
 const setInco=async v=>{await p.evaluate(v=>{const s=document.getElementById('cond-incoterms');const o=[...s.options].find(o=>o.value.startsWith(v));s.value=o?o.value:v;s.dispatchEvent(new Event('change',{bubbles:true}));},v);await p.waitForTimeout(300);};
 const state=i=>row(i).evaluate(tr=>({out:tr.dataset.outRange||'',reason:tr.dataset.outReason||'',cls:tr.classList.contains('row-out-of-range'),ic:tr.querySelector('[data-field="ic"]').value}));
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 await setInco('EXW');
 const t0=await total();
 // 1 行目を「FOB・CIF のときだけ有効」にする（いまは EXW ＝ 合わない）
 const openMore=async i=>{if(!(await row(i).locator('.ic-mode-btn').isVisible())){await row(i).locator('.row-detail-btn').click();await p.waitForTimeout(250);}};
 await openMore(0);await row(0).locator('.ic-mode-btn').click();await p.waitForTimeout(250);
 ok('「貿易条件」ボタンで選択欄（チップ）が開く（11 件）',await row(0).evaluate(tr=>tr.classList.contains('row-ic-mode')&&tr.querySelectorAll('.ic-chip').length>=11),await row(0).evaluate(tr=>tr.querySelectorAll('.ic-chip').length));
 ok('何も選ばない間は、どの貿易条件でも有効（除外されない）',(await state(0)).out==='');
 await row(0).locator('.ic-chip[data-ic="FOB"]').click();await row(0).locator('.ic-chip[data-ic="CIF"]').click();await p.waitForTimeout(300);
 let s0=await state(0);
 ok('FOB・CIF を選ぶと値が入り（FOB,CIF）、EXW のいまは「貿易条件外」で除外される',s0.ic==='FOB,CIF'&&s0.out==='1'&&s0.reason==='incoterms'&&s0.cls,s0);
 const t1=await total();
 ok('除外された行は合計から外れる',+t1<+t0,{t0,t1});
 const pv=await p.evaluate(()=>{const d=collectAllRows();const r=d.filter(x=>x._type==='data');return {n:r.length,hide:r[0]._hideQuote,reason:r[0]._outReason,out:r[0]._outRange}});
 ok('プレビューのデータでも、客先向けには出ない（_hideQuote）・理由は貿易条件',pv.hide===true&&pv.reason==='incoterms',pv);
 await setInco('FOB');
 s0=await state(0);const t2=await total();
 ok('貿易条件を FOB に変えると、この行は有効に戻り、合計も戻る',s0.out===''&&t2===t0,{s0,t0,t2});
 await setInco('');
 ok('貿易条件が未設定のときは判定しない（有効）',(await state(0)).out==='');
 await setInco('DAP');
 ok('DAP（選んだ中に無い）では再び除外される',(await state(0)).reason==='incoterms');
 // 保存→復元
 const data=await p.evaluate(()=>gatherAllData());
 await p.evaluate(d=>{_applyQuoteData(d);calcLiveUpdate&&calcLiveUpdate();},data);await p.waitForTimeout(600);
 const back=await state(0);
 ok('保存して開き直しても、条件（FOB,CIF）と除外が復元される',back.ic==='FOB,CIF'&&back.reason==='incoterms',back);
 ok('復元した行の欄が開いていて、選択済みのチップが ON',await row(0).evaluate(tr=>tr.classList.contains('row-ic-mode')&&[...tr.querySelectorAll('.ic-chip.is-on')].map(b=>b.dataset.ic).join()==='FOB,CIF'),null);
 // 複製
 await row(0).locator('td.handle-cell .drag-handle').hover();await row(0).locator('.row-dup-btn').click({timeout:3000});await p.waitForTimeout(500);
 ok('行を複製すると、条件も引き継がれる',(await state(1)).ic==='FOB,CIF');
 // 解除
 await openMore(0);await row(0).locator('.ic-mode-btn').click();await p.waitForTimeout(300);
 const off=await state(0);
 ok('もう一度ボタンを押すと解除され（値が空）、有効に戻る',off.ic===''&&off.out==='',off);
};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:+process.env.W||1400,height:1000},locale:'ja-JP'});
 await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},process.env.MODE||'detail');
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.addStyleTag({content:'*{caret-color:transparent!important;} *,*::before,*::after{animation:none!important;transition:none!important;}'});
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1000);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 await p.evaluate(()=>{setTransport('fcl')});
 // 明細（架空）：サブコン3社・7行。通貨違い・単位違いを含む
 const rows=[['海上運賃','A海運','ocean',"40'GP/HQ",2,1200,300,'USD'],['BAF','A海運','surcharge','CNTR',2,80,20,'USD'],['THC','Bローカル','export-local',"20'GP",1,32000,5000,'JPY'],['ドキュメント費','Bローカル','export-local','B/L',1,8000,2000,'JPY'],['通関料','C通関','customs-export','shipment',1,12000,3000,'JPY'],['輸出者検査','C通関','customs-export','CBM',3.5,2500,500,'JPY'],['配送費','D運輸','domestic',"40'GP",1,45000,8000,'JPY']];
 for(let i=0;i<rows.length;i++){
  if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(80);}
  const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  const r=rows[i];
  await f('nm').fill(r[0]);await f('sv').fill(r[1]);await f('cat').selectOption(r[2],{force:true}).catch(()=>{});
  await f('un').fill(r[3]);await f('pq').fill(String(r[4]));
  await f('pc').selectOption(r[7],{force:true}).catch(()=>{});await f('bc').selectOption(r[7],{force:true}).catch(()=>{});
  await f('pp').fill(String(r[5]));await f('mk').fill(String(r[6]));await f('mk').blur();
 }
 await p.waitForTimeout(1500);
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());await p.waitForTimeout(300);
 await run(p);
 console.log('errors',JSON.stringify(errs));await b.close();srv.close();})();
// 行ごとの「表示条件」（if 構文）：数量の範囲・総個数・コンテナ本数・輸送モード・貿易条件が条件に合うときだけ、行が客先向けの出力・合計に含まれる。
//   node scripts/design-tests/row-cond-test.js            （THEME=1 で Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const out=[];
const run=async(p)=>{
 const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};
 const rows='#tableBody tr:not([data-virtual]):not([data-type])';const row=i=>p.locator(rows).nth(i);
 const total=()=>p.evaluate(()=>document.getElementById('tot-subtotal').textContent.replace(/[^0-9]/g,''));
 const state=i=>row(i).evaluate(tr=>({out:tr.dataset.outRange||'',reason:tr.dataset.outReason||'',cls:tr.classList.contains('row-out-of-range'),unk:tr.dataset.cnUnknown||'',cn:tr.querySelector('[data-field="cn"]').value,hint:(tr.querySelector('.cn-hint')||{}).textContent||''}));
 const openMore=async i=>{if(!(await row(i).locator('.cn-mode-btn').isVisible())){await row(i).locator('.row-detail-btn').click();await p.waitForTimeout(250);}};
 const setQty=async(i,v)=>{const f=row(i).locator('[data-field="pq"]');await f.fill(String(v));await f.blur();await p.waitForTimeout(450);};
 const setSel=async(i,cls,v)=>{await openMore(i);await row(i).locator('.cn-group .'+cls).selectOption(v,{force:true});await p.waitForTimeout(350);};
 const setNum=async(i,cls,v)=>{await openMore(i);await row(i).locator('.cn-group .'+cls).fill(String(v));await p.waitForTimeout(450);};
 const setSelect=async(id,v)=>{await p.evaluate(([id,v])=>{const s=document.getElementById(id);const o=[...s.options].find(o=>o.value.startsWith(v));s.value=o?o.value:v;s.dispatchEvent(new Event('change',{bubbles:true}));},[id,v]);await p.waitForTimeout(450);};
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 await setSelect('cond-incoterms','FOB');
 const t0=await total();

 // 1) 数量の範囲：20 以上 40 以下のときだけ有効（1 行目は数量 2）
 await openMore(0);await row(0).locator('.cn-mode-btn').click();await p.waitForTimeout(300);
 ok('「表示条件」ボタンで条件の入力欄（項目・値・比較）が開く',await row(0).evaluate(tr=>tr.classList.contains('row-cn-mode')&&!!tr.querySelector('.cn-key')&&!!tr.querySelector('.cn-op')&&!!tr.querySelector('.cn-a')),null);
 ok('条件の値が空のうちは、判定せず表示のまま（除外されず・注意が出る）',(await state(0)).out===''&&(await state(0)).unk==='1',await state(0));
 await setNum(0,'cn-a',20);await setNum(0,'cn-b',40);
 let s0=await state(0);
 ok('数量 2 は「20 以上 40 以下」に合わないので、表示条件外で除外される',s0.out==='1'&&s0.reason==='condition'&&s0.cls&&s0.unk==='',s0);
 ok('説明に「条件に合わないため、出力と合計から外れています」が出る',/条件に合わない/.test(s0.hint),s0.hint);
 const t1=await total();
 ok('除外された行は合計から外れる',+t1<+t0,{t0,t1});
 const pv=await p.evaluate(()=>{const r=collectAllRows().filter(x=>x._type==='data');return {hide:r[0]._hideQuote,reason:r[0]._outReason}});
 ok('プレビューのデータでも客先向けには出ない（理由は条件）',pv.hide===true&&pv.reason==='condition',pv);
 await setQty(0,30);
 s0=await state(0);const t2=await total();
 ok('数量を 30（範囲内）にすると有効に戻り、合計も増える',s0.out===''&&s0.reason===''&&+t2>+t1,{s0,t1,t2});
 await setQty(0,20);ok('境界：20 は含まれる（以上）',(await state(0)).out==='');
 await setQty(0,40);ok('境界：40 は含まれる（以下）',(await state(0)).out==='');
 await setQty(0,41);ok('41 は範囲外',(await state(0)).reason==='condition');
 await setQty(0,30);

 // 2) 比較：以上・未満
 await setSel(0,'cn-op','ge');
 ok('比較を「以上」にすると上限欄が消える',await row(0).evaluate(tr=>!tr.classList.contains('cn-between')),null);
 await setNum(0,'cn-a',50);
 ok('数量 30 は「50 以上」に合わない',(await state(0)).reason==='condition',await state(0));
 await setSel(0,'cn-op','lt');
 ok('「50 未満」なら 30 は合う',(await state(0)).out==='',await state(0));

 // 3) 総個数：物量が未入力のあいだは判定できない（表示のまま＋注意）
 await setSel(0,'cn-key','pcs');
 s0=await state(0);
 ok('項目を「総個数」に変えると、値は空に戻る（途中の条件は表示のまま）',s0.out===''&&JSON.parse(s0.cn).k==='pcs',s0);
 await setNum(0,'cn-a',10);await setNum(0,'cn-b',20);
 s0=await state(0);
 ok('総個数が未入力（物量なし）のときは判定できず、表示のままで注意が出る',s0.out===''&&s0.unk==='1'&&/判定できません/.test(s0.hint),s0);
 // 出力前の確認ガイドに載る
 await p.evaluate(()=>{window.preOutputValidationGate('プレビュー表示',()=>{});});await p.waitForTimeout(400);
 ok('出力前の確認ガイドに「表示条件を判定できない行」が出る',await p.evaluate(()=>/表示条件を判定できない行が 1 件/.test(document.body.textContent)),null);
 await p.keyboard.press('Escape');await p.evaluate(()=>{document.querySelectorAll('.warn-guide-overlay,#pvWarnOverlay,[id*="arn"][class*="open"]').forEach(e=>e.remove?.());});

 // 4) コンテナ本数（種別ごと）
 await p.evaluate(()=>window.setContainerChip("20'GP",2));await p.waitForTimeout(500);
 ok('項目に、いまの案件のコンテナ種別（20\'GP）が選べる',await row(0).evaluate(tr=>[...tr.querySelectorAll('.cn-key option')].some(o=>o.value==="cnt:20'GP")),null);
 await setSel(0,'cn-key',"cnt:20'GP");
 await setSel(0,'cn-op','ge');await setNum(0,'cn-a',3);
 ok('20\'GP が 2 本のとき「3 本以上」には合わない（除外）',(await state(0)).reason==='condition',await state(0));
 await p.evaluate(()=>window.setContainerChip("20'GP",3));await p.waitForTimeout(700);
 ok('本数を 3 に増やすと、自動で判定し直されて有効に戻る',(await state(0)).out==='',await state(0));
 await setSel(0,'cn-key','cnt');await setSel(0,'cn-op','eq');await setNum(0,'cn-a',3);
 ok('コンテナ本数（合計）＝3 に合う',(await state(0)).out==='',await state(0));

 // 5) 輸送モード（海上すべて）／貿易条件
 await setSel(0,'cn-key','mode');
 await setSel(0,'cn-a','海上*');
 await setSelect('cond-mode','海上（FCL）');
 ok('輸送モード＝海上（すべて）：海上（FCL）のときは有効',(await state(0)).out==='',await state(0));
 await setSelect('cond-mode','航空（AIR）');
 ok('航空（AIR）に変えると、自動で判定し直されて除外される',(await state(0)).reason==='condition',await state(0));
 await setSelect('cond-mode','海上（LCL）');
 ok('海上（LCL）に戻すと有効に戻る',(await state(0)).out==='',await state(0));
 await setSel(0,'cn-op','ne');
 ok('「海上（すべて）ではない」にすると、海上のときは除外',(await state(0)).reason==='condition',await state(0));
 await setSel(0,'cn-key','inco');await setSel(0,'cn-a','FOB');await setSel(0,'cn-op','ne');
 ok('貿易条件が FOB ではない：いま FOB なので除外',(await state(0)).reason==='condition',await state(0));
 await setSel(0,'cn-op','eq');
 ok('貿易条件が FOB である → 有効',(await state(0)).out==='',await state(0));
 await setSelect('cond-incoterms','CIF');
 ok('貿易条件を CIF に変えると、自動で判定し直されて除外される',(await state(0)).reason==='condition',await state(0));
 await setSelect('cond-incoterms','FOB');

 // 6) 保存→復元・複製・解除
 await setSel(0,'cn-key','qty');await setSel(0,'cn-op','between');await setNum(0,'cn-a',20);await setNum(0,'cn-b',40);await setQty(0,2);
 const before=await state(0);
 const data=await p.evaluate(()=>gatherAllData());
 const cells=data.rows.filter(r=>r._type==='data')[0].cells;
 ok('保存データ（行の cells の末尾）に条件が入る',/"k":"qty"/.test(String(cells[cells.length-1]))||cells.some(c=>/"k":"qty"/.test(String(c))),cells.slice(-3));
 await p.evaluate(d=>{_applyQuoteData(d);calcLiveUpdate&&calcLiveUpdate();},data);await p.waitForTimeout(700);
 const back=await state(0);
 ok('保存して開き直しても、条件と除外が復元される',back.cn===before.cn&&back.reason==='condition',back);
 ok('復元した行の入力欄に、値（20〜40）が入っている',await row(0).evaluate(tr=>tr.querySelector('.cn-a')?.value==='20'&&tr.querySelector('.cn-b')?.value==='40'),null);
 await row(0).locator('td.handle-cell .drag-handle').hover();await row(0).locator('.row-dup-btn').click({timeout:3000});await p.waitForTimeout(500);
 ok('行を複製すると、条件も引き継がれる',(await state(1)).cn===before.cn,await state(1));
 await openMore(0);await row(0).locator('.cn-mode-btn').click();await p.waitForTimeout(300);
 const off=await state(0);
 ok('もう一度ボタンを押すと解除され（値が空）、有効に戻る',off.cn===''&&off.out==='',off);
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
 const rows=[['海上運賃','A海運','ocean',"40'GP/HQ",2,1200,300,'USD'],['BAF','A海運','surcharge','CNTR',2,80,20,'USD'],['THC','Bローカル','export-local',"20'GP",1,32000,5000,'JPY'],['ドキュメント費','Bローカル','export-local','B/L',1,8000,2000,'JPY'],['通関料','C通関','customs-export','shipment',1,12000,3000,'JPY']];
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
 console.log('errors',JSON.stringify(errs));
 out.push(errs.length?'FAIL JS エラー':'PASS JS エラーなし');
 await b.close();srv.close();
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log('\nFAIL='+fails);process.exit(fails?1:0);})();

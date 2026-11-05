// 行ごとの「表示条件」（if 構文）：数量の範囲・総個数・コンテナ本数・輸送モード・貿易条件が条件に合うときだけ、行が客先向けの出力・合計に含まれる。
//   node scripts/design-tests/row-cond-test.js            （THEME=1 で Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const out=[];


const run=async(p)=>{
 const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};
 const wait=ms=>p.waitForTimeout(ms);
 const rowsSel='#tableBody tr:not([data-virtual]):not([data-type])';
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 // 行 0・1 は A海運（パターン FCL案／LCL案）、行 2 は Bローカル（パターンなし）
 const ids=await p.locator(rowsSel).evaluateAll(trs=>trs.map(t=>t.id.replace('row-','')));
 await p.evaluate(([a,b])=>{const set=(id,v)=>{const e=document.getElementById('pt-'+id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};set(a,'FCL案');set(b,'LCL案');window.renderSubconGroups&&window.renderSubconGroups();},[ids[0],ids[1]]);
 await wait(800);
 const hdr=l=>p.locator(`tr.subcon-group-header[data-sv-label="${l}"]`);
 const state=()=>p.evaluate(()=>{
   const q=s=>document.querySelector(s);
   const g=[...document.querySelectorAll('tr.subcon-group-header')].map(h=>({label:h.dataset.svLabel,key:h.dataset.svKey,alias:!!h.querySelector('.subcon-alias-input'),remark:!!h.querySelector('.subcon-remark-input'),toggle:!!h.querySelector('.subcon-remark-toggle')}));
   const sub=[...document.querySelectorAll('tr.subcon-group-subtotal,tr.subcon-pattern-subtotal')].map(t=>({cls:t.className,inputs:t.querySelectorAll('input[type=text]').length,notesBtn:!!t.querySelector('.st-notes-btn')}));
   const pt=[...document.querySelectorAll('tr.subcon-subgroup-header.is-pattern')].map(h=>({key:h.dataset.ptKey,sv:h.dataset.svKey,remark:!!h.querySelector('.subcon-remark-input')}));
   return {g,sub,pt};
 });
 let st=await state();
 const A=st.g.find(x=>x.label==='A海運'),B=st.g.find(x=>x.label==='Bローカル');
 ok('サブコンの見出しの行内に、客先表示名・リマークの入力欄と「見積書に表示」ボタンがある',A&&A.alias&&A.remark&&A.toggle&&B&&B.alias&&B.remark,st.g);
 ok('サブコン小計行・パターン小計行には、入力欄も「注記 ▾」ボタンも無い（見出しへ移した）',st.sub.length>0&&st.sub.every(x=>x.inputs===0&&!x.notesBtn),st.sub);
 const ptF=st.pt.find(x=>x.key==='FCL案'),ptL=st.pt.find(x=>x.key==='LCL案');
 ok('名前付きパターン（FCL案・LCL案）の見出しにパターンリマークの入力欄がある',ptF&&ptF.remark&&ptL&&ptL.remark,st.pt);
 ok('パターン名のないサブコン（Bローカルだけ）のパターン見出しには入力欄を出さない（従来も小計が出なかった）',st.pt.filter(x=>x.sv===B.key).every(x=>!x.remark),st.pt);

 // サブコンのリマーク：入力 → 保存先（マップ）に入る
 const remark=hdr('A海運').locator('.subcon-remark-input');
 await remark.fill('港湾諸費用は実費精算');await remark.blur();await wait(300);
 let rm=await p.evaluate(()=>window.getSubconRemarks());
 ok('見出しのリマークを入力すると、サブコン別リマークとして保持される（見積書に表示＝ON）',rm[A.key]&&rm[A.key].text==='港湾諸費用は実費精算'&&rm[A.key].show===true,rm);
 // 見積書に表示 → 非表示
 await hdr('A海運').locator('.subcon-remark-toggle').click();await wait(300);
 rm=await p.evaluate(()=>window.getSubconRemarks());
 ok('「見積書に表示」を押すと「🔒 非表示」になり、見積書には出さない設定になる',rm[A.key].show===false&&/非表示/.test(await hdr('A海運').locator('.subcon-remark-toggle').textContent()),rm);
 // 客先表示名
 const alias=hdr('A海運').locator('.subcon-alias-input');
 await alias.fill('海上輸送費 一式');await wait(300);
 ok('客先表示名を入力すると保持される',(await p.evaluate(()=>window.getSubconAliases()))[A.key]==='海上輸送費 一式',await p.evaluate(()=>window.getSubconAliases()));
 // 再描画しても入力と状態が残る
 await p.evaluate(()=>{window.renderSubconGroups&&window.renderSubconGroups();window.updateTotals&&window.updateTotals();});await wait(700);
 ok('再描画しても、リマーク・客先表示名・非表示の状態が見出しに残る',await p.evaluate(()=>{const h=document.querySelector('tr.subcon-group-header[data-sv-label="A海運"]');return h.querySelector('.subcon-remark-input').value==='港湾諸費用は実費精算'&&h.querySelector('.subcon-alias-input').value==='海上輸送費 一式'&&/非表示/.test(h.querySelector('.subcon-remark-toggle').textContent);}),null);
 // パターンのリマーク
 const prm=p.locator('tr.subcon-subgroup-header.is-pattern[data-pt-key="FCL案"] .subcon-remark-input');
 await prm.fill('FCL は CY 受け渡し');await prm.blur();await wait(300);
 rm=await p.evaluate(()=>window.getSubconRemarks());
 ok('パターン見出しのリマークは「サブコン||パターン」のキーで保持される',rm[A.key+'||FCL案']&&rm[A.key+'||FCL案'].text==='FCL は CY 受け渡し',rm);
 // 折りたたんでも見出しの注記は見える
 await hdr('A海運').locator('.subcon-group-toggle').click();await wait(400);
 ok('グループを折りたたんでも、見出しのリマーク欄は見えて入力できる',await hdr('A海運').locator('.subcon-remark-input').isVisible(),null);
 await hdr('A海運').locator('.subcon-group-toggle').click();await wait(300);
 // 見出しの行内に収まる（はみ出さない）
 const fit=await p.evaluate(()=>[...document.querySelectorAll('tr.subcon-group-header .subcon-group-header-inner,tr.subcon-subgroup-header.is-pattern .subcon-subgroup-inner')].map(i=>({sw:i.scrollWidth,cw:i.clientWidth})));
 ok('見出しの中身が見出しの幅からはみ出さない（足りなければ注記が折り返す）',fit.length>0&&fit.every(f=>f.sw<=f.cw+1),fit);
 // 御見積書（PDF）に、表示ONのリマークが出る（非表示のサブコンのリマークは出ない）
 const doc=await p.evaluate(()=>buildQuoteDocHTML());
 ok('御見積書には、表示ONのパターンリマークが出て、非表示のサブコンリマークは出ない',/FCL は CY 受け渡し/.test(doc)&&!/港湾諸費用は実費精算/.test(doc),null);
 // 保存して開き直す
 const data=await p.evaluate(()=>gatherAllData());
 await p.evaluate(d=>{_applyQuoteData(d);},data);await wait(900);
 ok('保存して開き直しても、見出しの注記が復元される',await p.evaluate(()=>{const h=document.querySelector('tr.subcon-group-header[data-sv-label="A海運"]');const p2=document.querySelector('tr.subcon-subgroup-header.is-pattern[data-pt-key="FCL案"] .subcon-remark-input');return !!h&&h.querySelector('.subcon-remark-input').value==='港湾諸費用は実費精算'&&h.querySelector('.subcon-alias-input').value==='海上輸送費 一式'&&!!p2&&p2.value==='FCL は CY 受け渡し';}),null);
 if(process.env.SHOT){await p.evaluate(()=>{const h=document.querySelector('tr.subcon-group-header');h&&h.scrollIntoView({block:'start'});window.scrollBy(0,-160);});await wait(300);await p.screenshot({path:process.env.SHOT});}
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


 const rows=[['海上運賃','A海運','ocean',"CNTR",2,1000,500,'JPY'],['THC','A海運','export-local',"20'GP",1,2000,1500,'JPY'],['ドキュメント費','Bローカル','export-local','B/L',1,3000,1000,'JPY']];
 for(let i=0;i<rows.length;i++){
  if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(80);}
  const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  const r=rows[i];
  await f('nm').fill(r[0]);await f('sv').fill(r[1]);await f('un').fill(r[3]);await f('pq').fill(String(r[4]));
  await f('pp').fill(String(r[5]));await f('mk').fill(String(r[6]));await f('mk').blur();
 }
 await p.waitForTimeout(1500);
 await run(p);
 console.log('errors',JSON.stringify(errs));
 out.push(errs.length?'FAIL JS エラー':'PASS JS エラーなし');
 await b.close();srv.close();
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log('\nFAIL='+fails);process.exit(fails?1:0);})();

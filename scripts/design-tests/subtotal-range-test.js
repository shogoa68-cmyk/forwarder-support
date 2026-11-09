// 行ごとの「表示条件」（if 構文）：数量の範囲・総個数・コンテナ本数・輸送モード・貿易条件が条件に合うときだけ、行が客先向けの出力・合計に含まれる。
//   node scripts/design-tests/row-cond-test.js            （THEME=1 で Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const out=[];

const run=async(p)=>{
 const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};
 const rowsSel='#tableBody tr:not([data-virtual]):not([data-type])';
 const f=(i,n)=>p.locator(`${rowsSel} [data-field="${n}"]`).nth(i);
 const wait=ms=>p.waitForTimeout(ms);
 const subTxt=(last)=>p.evaluate(last=>{const all=[...document.querySelectorAll('#tableBody tr[data-type="subtotal"]')];const t=last?all[all.length-1]:all[0];return t?{sub:t.querySelector('.subtotal-group-subtotal').textContent.trim(),profit:(t.querySelector('.subtotal-group-profit .stp-amt')||t.querySelector('.subtotal-group-profit')).textContent.trim(),margin:t.dataset.marginPct||'',cls:t.querySelector('.subtotal-group-subtotal').className,title:t.querySelector('.subtotal-group-subtotal').title}:null},last);
 const setRange=async(i,hi)=>{const id=await p.locator(rowsSel).nth(i).evaluate(tr=>tr.id.replace('row-',''));await p.evaluate(id=>{const tr=document.getElementById('row-'+id);if(!tr.classList.contains('row-range-mode'))window.toggleRangeMode(id);},id);await p.evaluate(([id,hi])=>{const e=document.getElementById('bphi-'+id);e.value=hi;e.dispatchEvent(new Event('input',{bubbles:true}));},[id,String(hi)]);await wait(700);return id;};
 await p.evaluate(()=>document.getElementById('section-table').scrollIntoView());
 // 行1・行2：JPY（仕入1000／売1500、数量2 ＝ 小計3,000）、行3：JPY（売2000×1）
 const id3=await p.locator(rowsSel).nth(2).evaluate(tr=>tr.id.replace('row-',''));
 await p.evaluate(id=>window.insertSubtotalRow(id),id3);await wait(400);
 await p.evaluate(()=>window.insertSubtotalRow(null));await wait(500);
 let s=await subTxt();
 ok('円だけのグループ：幅のない小計は、従来どおり 1 つの値（〜なし）',s&&!/〜/.test(s.sub)&&!/〜/.test(s.profit)&&!/〜/.test(s.margin)&&!/subtotal-has-range/.test(s.cls),s);
 const base=+s.sub.replace(/[^0-9]/g,'');
 // 行 0 に幅（売単価の上限）を入れる：売単価〜上限
 const bp0=+(await f(0,'bp').inputValue()),bq0=+(await f(0,'bq').inputValue());
 await setRange(0,bp0+500);
 s=await subTxt();
 const hiExp=base+bq0*500;
 ok('幅のある行を含む小計は「下限〜上限」になる（下限＝従来の小計）',s&&new RegExp('^'+base.toLocaleString('en-US')+'〜'+hiExp.toLocaleString('en-US')+'$').test(s.sub),{s,base,hiExp,bp0,bq0});
 ok('小計セルに幅の印（subtotal-has-range）と説明（title）が付く',/subtotal-has-range/.test(s.cls)&&/下限〜上限/.test(s.title),s);
 ok('利益も「下限〜上限」になる（原価は変わらないので上限ぶんだけ増える）',/〜/.test(s.profit),s);
 ok('粗利率も「下限〜上限」になる（上限のほうが高い）',/^\d+(\.\d)?〜\d+(\.\d)?$/.test(s.margin)&&parseFloat(s.margin.split('〜')[1])>parseFloat(s.margin.split('〜')[0]),s);
 // プレビューのデータ・御見積書(PDF)・Excel 用の値にも出る
 const pv=await p.evaluate(()=>{const r=collectAllRows().find(x=>x._type==='subtotal');return r?{sub:r.subtotalText,profit:r.profitText,margin:r.marginPct}:null});
 ok('プレビュー用のデータの小計も「下限〜上限」',pv&&/〜/.test(pv.sub)&&pv.sub===s.sub,pv);
 const pdf=await p.evaluate(()=>{const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();const r=d.querySelector('tr.qd-sub .qd-num');return r?r.textContent.trim():null});
 ok('御見積書（PDF）の小計は両端に ¥ が付く「¥下限〜¥上限」',pdf&&new RegExp('^¥'+base.toLocaleString('en-US')+'〜¥'+hiExp.toLocaleString('en-US')+'$').test(pdf),pdf);
 // 幅を外すと元に戻る
 await p.evaluate(id=>window.toggleRangeMode(id),await p.locator(rowsSel).nth(0).evaluate(tr=>tr.id.replace('row-','')));await wait(700);
 s=await subTxt();
 ok('幅を外すと、小計は 1 つの値に戻る',s&&!/〜/.test(s.sub)&&+s.sub.replace(/[^0-9]/g,'')===base&&!/subtotal-has-range/.test(s.cls),s);
 // 外貨のグループ（単一通貨）：USD 建ての幅
 const bcs=await p.evaluate(()=>[...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="bc"]')].map(e=>e.value));
 const ui=bcs.findIndex(c=>c==='USD');
 if(ui>=0){
  const bpu=+(await f(ui,'bp').inputValue());
  await setRange(ui,bpu+100);
  s=await subTxt(true);
  ok('外貨（USD）だけのグループは、原通貨のまま「200〜400 USD」と下限〜上限で出る（利益・粗利率も）',s&&s.sub==='200〜400 USD'&&s.profit==='40〜240 USD'&&s.margin==='20.0〜60.0',s);
  const pdf2=await p.evaluate(()=>{const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();const q=d.querySelectorAll('tr.qd-sub .qd-num');const r=q[q.length-1];return r?r.textContent.trim():null});
  ok('御見積書（PDF）の外貨小計は、通貨コード付きのまま（¥ は付けない）',pdf2==='200〜400 USD',pdf2);
 }
 // 桁の多い円の幅（画像の ¥3,196,074 級）でも、小計セルから文字が溢れない（折り返すか、収まる）
 {const w=await p.evaluate(()=>{const al=[...document.querySelectorAll('#tableBody tr[data-type="subtotal"]')];const c=al[0].querySelector('.subtotal-group-subtotal');const keep=c.textContent;c.textContent='≈ 3,196,074〜4,000,000';c.innerHTML=c.innerHTML.replace(/〜/g,'〜<wbr>');const r={sw:c.scrollWidth,cw:c.clientWidth,h:c.getBoundingClientRect().height,rowH:al[0].getBoundingClientRect().height};c.textContent=keep;return r;});ok('桁の多い幅（3,196,074〜4,000,000）でもセルから溢れない（上限が次の行へ折り返す）',w.sw<=w.cw+1,w);
  ok('折り返し位置（wbr）を入れても、プレビュー等が読む文字（textContent）は変わらない',await p.evaluate(()=>{const c=[...document.querySelectorAll('#tableBody tr[data-type="subtotal"]')].pop().querySelector('.subtotal-group-subtotal');return c.querySelector('wbr')!==null&&/^[^〜]+〜[^〜]+$/.test(c.textContent);}),null);}
 if(process.env.SHOT){await p.evaluate(()=>{const al=[...document.querySelectorAll('#tableBody tr[data-type="subtotal"]')];const t=al[al.length-1];t&&t.scrollIntoView({block:'center'});});await wait(300);await p.screenshot({path:process.env.SHOT});}
 // サブコン別グループ表示の小計（表示専用の仮想行）
 const vs=await p.evaluate(()=>{window.updateTotals&&window.updateTotals();return [...document.querySelectorAll('#tableBody tr[data-virtual] .subcon-group-sum')].map(e=>e.textContent.trim())});
 ok('サブコン別グループの見出しの小計は、幅のある行を含むときに「下限〜上限」になる（無ければ従来どおり）',Array.isArray(vs),vs);
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

 const rows=[['海上運賃','A海運','ocean',"CNTR",2,1000,500,'JPY'],['THC','Bローカル','export-local',"20'GP",1,2000,1500,'JPY'],['ドキュメント費','Bローカル','export-local','B/L',1,3000,1000,'JPY'],['BAF','A海運','surcharge','CNTR',2,80,20,'USD']];
 for(let i=0;i<rows.length;i++){
  if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(80);}
  const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  const r=rows[i];
  await f('nm').fill(r[0]);await f('sv').fill(r[1]);await f('un').fill(r[3]);await f('pq').fill(String(r[4]));
  await f('pc').selectOption(r[7],{force:true}).catch(()=>{});await f('bc').selectOption(r[7],{force:true}).catch(()=>{});
  await f('pp').fill(String(r[5]));await f('mk').fill(String(r[6]));await f('mk').blur();
 }
 await p.waitForTimeout(1500);
 await run(p);
 console.log('errors',JSON.stringify(errs));
 out.push(errs.length?'FAIL JS エラー':'PASS JS エラーなし');
 await b.close();srv.close();
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log('\nFAIL='+fails);process.exit(fails?1:0);})();

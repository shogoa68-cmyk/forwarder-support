const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
(async()=>{
 const root=require('path').resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:1000},locale:'ja-JP',hasTouch:true});
 await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},process.env.MODE||'detail');
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(8000);
 const sleep=ms=>p.waitForTimeout(ms);const res=[];const ok=(n,c,d)=>{res.push(c);console.log((c?'✅ ':'❌ ')+n+(c||!d?'':' → '+d));};
 await p.goto(URL,{waitUntil:'domcontentloaded'});await sleep(600);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await sleep(1000);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await sleep(400);
 const F=(i,n)=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
 const names=[['海上運賃','A社'],['THC','B社'],['通関','C社'],['配送','D社']];
 for(let i=0;i<names.length;i++){if(i>0){await p.evaluate(()=>window.addRow());await sleep(80);}await F(i,'nm').fill(names[i][0]);await F(i,'sv').fill(names[i][1]);await F(i,'pq').fill('1');await F(i,'pp').fill('1000');await F(i,'mk').fill('200');await F(i,'mk').blur();}
 await sleep(900);
 // 1 単位の title
 await F(0,'un').fill("40'GP/HQ");await sleep(200);
 ok('単位欄の title に全文が入る',await p.evaluate(()=>document.querySelector('#tableBody [data-field="un"]').title==="40'GP/HQ"));
 // 2 文言
 ok('文言：あえて¥0／必要時',await p.evaluate(()=>{const r=document.querySelector('#tableBody tr[id^="row-"]:not([data-virtual])');return r.querySelector('.zero-confirm-btn').textContent.trim()==='あえて¥0'&&r.querySelector('.cond-charge-btn').textContent.trim()==='必要時'&&!/都度/.test(r.querySelector('.cond-charge-btn').title)}));
 // 3 登録／詳細の位置
 ok('登録／詳細ボタンが品名セルの下（.master-actions）にある',await p.evaluate(()=>{const r=document.querySelector('#tableBody tr[id^="row-"]:not([data-virtual])');return !!r.querySelector('td.name-cell .master-actions .master-reg-btn')&&!!r.querySelector('td.name-cell .master-actions .master-detail-jump-btn')&&!r.querySelector('.row-mode-btns .master-reg-btn')&&r.querySelector('.master-reg-btn').textContent.trim()==='マスターに登録'}));
 await p.evaluate(()=>{window.__mr=[];window.registerRowToMaster=id=>window.__mr.push(id)});
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(0).hover();
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(0).locator('.master-reg-btn').click();
 ok('「マスターに登録」が従来の登録処理を呼ぶ',await p.evaluate(()=>window.__mr.length===1));
 // 4 見積書に出さない（アイコン＋ラベル）
 const hb=p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(1).locator('.row-hidequote-btn');
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(1).hover();
 await hb.evaluate(e=>e.click());await sleep(200);
 ok('見積書に出さない：ON→🚫＋「見積書に出す」',await p.evaluate(()=>{const b=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) .row-hidequote-btn')[1];return b.classList.contains('is-on')&&b.querySelector('.row-act-ico').textContent==='🚫'&&b.querySelector('.row-act-label').textContent==='見積書に出す'}));
 // 保存→復元でも状態が戻る
 const data=await p.evaluate(()=>JSON.parse(JSON.stringify(gatherAllData())));
 await p.evaluate(d=>_applyQuoteData(d),data);await sleep(600);
 ok('復元後も🚫＋ラベルが保たれる',await p.evaluate(()=>{const b=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) .row-hidequote-btn')[1];return b&&b.classList.contains('is-on')&&b.querySelector('.row-act-ico').textContent==='🚫'}));
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(1).hover();
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(1).locator('.row-hidequote-btn').evaluate(e=>e.click());await sleep(200);
 ok('もう一度でOFF→👁＋「見積書に出さない」',await p.evaluate(()=>{const b=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) .row-hidequote-btn')[1];return !b.classList.contains('is-on')&&b.querySelector('.row-act-ico').textContent==='👁'&&b.querySelector('.row-act-label').textContent==='見積書に出さない'}));
 // 5 あえて¥0 バッジ
 await F(2,'pp').fill('0');await F(2,'mk').fill('0');await F(2,'mk').blur();await sleep(400);
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(2).locator('.zero-confirm-btn').evaluate(e=>e.click());await sleep(400);
 ok('「あえて¥0」を押すと小計欄に「あえて¥0」と表示',await p.evaluate(()=>/あえて¥0/.test(document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="st"]')[2].textContent)));
 // 6 行の複製・追加・削除（ラベル付きボタン）
 const n0=await p.evaluate(()=>document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])').length);
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(0).hover();
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(0).locator('.row-dup-btn').evaluate(e=>e.click());await sleep(500);
 const n1=await p.evaluate(()=>document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])').length);
 await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(0).locator('.row-add-btn').evaluate(e=>e.click());await sleep(500);
 const n2=await p.evaluate(()=>document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])').length);
 ok('複製・直下に追加が動く（行数 +1 ずつ）',n1===n0+1&&n2===n1+1,[n0,n1,n2].join(','));

 // 7 操作ボタン（重ね表示）が画面・表の枠からはみ出さない
 const inside=()=>p.evaluate(()=>{const t=document.querySelector('#tableBody tr:hover')||null;const acts=[...document.querySelectorAll('#tableBody tr:hover td.handle-cell .row-acts')][0];if(!acts)return 'no-acts';const r=acts.getBoundingClientRect(),w=document.getElementById('tableScrollWrap').getBoundingClientRect();const lim=Math.min(w.bottom,innerHeight);return (r.bottom<=lim+1&&r.top>=Math.max(w.top,0)-1)?'inside':'clipped:'+Math.round(r.top)+'-'+Math.round(r.bottom)+' lim '+Math.round(lim)+' flip='+(!!document.querySelector('#tableBody tr.is-flip'))});
 const last=p.locator('#tableBody tr:not([data-virtual]):not([data-type])').last();await last.evaluate(e=>e.scrollIntoView({block:'end'}));await last.locator('td.handle-cell .drag-handle').hover();await sleep(300);
 let st=await inside();ok('最終行：操作ボタンが枠・画面からはみ出さない',st==='inside',st);
 const first=p.locator('#tableBody tr:not([data-virtual]):not([data-type])').first();await first.evaluate(e=>e.scrollIntoView({block:'start'}));await sleep(100);await first.locator('td.handle-cell .drag-handle').hover();await sleep(300);
 st=await inside();ok('先頭行：操作ボタンがはみ出さない',st==='inside',st);
 const mid=p.locator('#tableBody tr:not([data-virtual]):not([data-type])').nth(2);await mid.evaluate(e=>e.scrollIntoView({block:'center'}));await sleep(100);await mid.locator('td.handle-cell .drag-handle').hover();await sleep(300);
 st=await inside();ok('中ほどの行：操作ボタンがはみ出さない',st==='inside',st);
 // 8 タッチ
 await p.evaluate(()=>{const tr=document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1];tr.querySelector('.w-name').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}))});
 ok('タッチ：行をタップすると tr.is-active が付く',await p.evaluate(()=>document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[1].classList.contains('is-active')));
 // 9 合計行
 ok('合計：金額・粗利の要素が更新されている',await p.evaluate(()=>/\d/.test(document.getElementById('tot-subtotal').textContent)&&/\d/.test(document.getElementById('tot-cost').textContent)&&/\d/.test(document.getElementById('tot-profit').textContent)&&document.getElementById('tot-row-label').textContent.replace(/\s/g,'').length>0));
 // 10 キー移動
 await F(0,'pq').focus();await p.keyboard.press('ArrowDown');await sleep(150);
 ok('↓キーで次行の同じ欄へ移動',await p.evaluate(()=>document.activeElement&&document.activeElement.dataset.field==='pq'&&document.activeElement.closest('tr').id!==document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')[0].id));
 ok('JSエラーなし',errs.length===0,JSON.stringify(errs));
 console.log(res.every(Boolean)?'\nOK':'\nNG');await b.close();srv.close();
})();

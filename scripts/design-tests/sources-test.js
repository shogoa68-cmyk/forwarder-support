// 行ごとの「表示条件」（if 構文）：数量の範囲・総個数・コンテナ本数・輸送モード・貿易条件が条件に合うときだけ、行が客先向けの出力・合計に含まれる。
//   node scripts/design-tests/row-cond-test.js            （THEME=1 で Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const out=[];



const run=async(p)=>{
 const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};
 const wait=ms=>p.waitForTimeout(ms);
 const vis=sel=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const r=e.getBoundingClientRect();return !!(e.offsetParent||e.getClientRects().length)&&r.width>0&&r.height>0;},sel);
 const setStatus=async s=>{await p.evaluate(s=>window.setQuoteStatus(s),s);await wait(250);};
 // 「必要なときだけ開く」を開く
 await p.evaluate(()=>{document.getElementById('section-ref').scrollIntoView();const b=document.getElementById('ciMoreBtn'),body=document.getElementById('ciMoreBody');if(body.hidden)b.click();});await wait(400);

 // ===== 基幹システム REF#：受注のときだけ =====
 await setStatus('下書き中');
 ok('下書き中は、基幹システム REF# の欄を出さない',!(await vis('#qfCoreRefField')),null);
 await setStatus('提示済み');
 ok('提示済みでも出さない',!(await vis('#qfCoreRefField')),null);
 await setStatus('受注');
 ok('受注にすると、基幹システム REF# の欄が出る',await vis('#qfCoreRefField'),null);
 await p.fill('#qf-core-ref','EX2410-0123');await p.dispatchEvent('#qf-core-ref','change');await wait(300);
 await setStatus('改定中');
 ok('受注以外に戻しても、値が入っていれば出し続ける（入力済みの値を隠さない）',await vis('#qfCoreRefField'),null);
 // 値を消しても、入力中（フォーカスがある間）は欄が消えない
 await p.focus('#qf-core-ref');await p.fill('#qf-core-ref','');await wait(300);
 ok('受注以外で値を消しても、入力中は欄が消えない',await vis('#qfCoreRefField'),null);
 await p.evaluate(()=>document.getElementById('qf-core-ref').blur());await wait(400);
 ok('入力を終えて（空のまま）離れると、受注以外なら欄を隠す',!(await vis('#qfCoreRefField')),null);
 await setStatus('受注');
 ok('受注に戻すと、空でも欄が出る',await vis('#qfCoreRefField'),null);
 // 保存データを開き直したとき
 await p.fill('#qf-core-ref','AB-12');await p.dispatchEvent('#qf-core-ref','change');
 const dRef=await p.evaluate(()=>gatherAllData());
 await setStatus('下書き中');await p.evaluate(()=>{document.getElementById('qf-core-ref').value='';window.ciSync();});await wait(200);
 await p.evaluate(()=>document.activeElement&&document.activeElement.blur());
 await p.evaluate(d=>{d.fields['qf-status']='提示済み';_applyQuoteData(d);},JSON.parse(JSON.stringify(dRef)));await wait(700);
 ok('値のある案件（提示済み）を開くと、REF# の欄が出ていて値も復元される',await vis('#qfCoreRefField')&&(await p.inputValue('#qf-core-ref'))==='AB-12',null);
 await p.evaluate(d=>{d.fields['qf-status']='提示済み';d.fields['qf-core-ref']='';_applyQuoteData(d);},JSON.parse(JSON.stringify(dRef)));await wait(700);
 ok('値が無い提示済みの案件を開くと、欄は出ない',!(await vis('#qfCoreRefField')),null);
 await p.evaluate(d=>{d.fields['qf-status']='受注';d.fields['qf-core-ref']='';_applyQuoteData(d);},JSON.parse(JSON.stringify(dRef)));await wait(700);
 ok('受注の案件を開くと、値が無くても欄が出る',await vis('#qfCoreRefField'),null);

 // ===== 参照資料カード =====
 await p.evaluate(()=>{const ta=document.getElementById('qf-refurl');ta.value='';window.renderRefUrlLinks();window.ciSync();});await wait(300);
 ok('「参照資料」カードがあり、「＋ 資料を追加」ボタンがある',await vis('#qfSources .src-add-btn'),null);
 ok('以前の URL テキスト欄・添付のドロップ欄はカードに出ない（ダイアログへ移した）',!(await vis('#qf-refurl'))&&!(await vis('#qfSources #qfAttachDrop')),null);
 ok('資料が無いときは「資料はまだありません」',await p.evaluate(()=>!document.getElementById('qfSrcEmpty').hidden),null);

 // ===== 資料を追加ダイアログ =====
 await p.click('#srcAddBtn');await wait(400);
 ok('ダイアログが開く（URL 入力欄・「ファイルをアップロード」「ウェブサイト」・ドロップ領域・容量表示）',await p.evaluate(()=>{const m=document.getElementById('srcAddModal');return m.classList.contains('open')&&!!m.querySelector('#srcUrlInput')&&m.querySelectorAll('.src-pill').length===2&&!!m.querySelector('#qfAttachDrop')&&!!m.querySelector('#qfAttachMeter');}),null);
 ok('URL 入力欄にフォーカスが入っている',await p.evaluate(()=>document.activeElement&&document.activeElement.id==='srcUrlInput'),null);
 ok('未ログインでは、ファイルは添付できない旨の案内が出て、URL は追加できると分かる',await p.evaluate(()=>{const n=document.getElementById('srcAddNote');return !n.hidden&&/ログイン/.test(n.textContent)&&/URL/.test(n.textContent);}),await p.evaluate(()=>document.getElementById('srcAddNote').textContent));
 // 変更の通知（未保存の印・元に戻す履歴）が飛ぶか
 await p.evaluate(()=>{window.__refEv=0;document.getElementById('qf-refurl').addEventListener('input',()=>window.__refEv++);});
 // URL を追加（複数行・前後に文字つき）
 await p.fill('#srcUrlInput','レート表 https://example.com/rates/2026 と\nhttps://www.carrier.co.jp/tariff?id=7、 です');
 await p.keyboard.press('Shift+Enter');await wait(150);
 ok('Shift+Enter は追加せず改行になる（追加は Enter）',(await p.inputValue('#qf-refurl'))==='',await p.inputValue('#qf-refurl'));
 await p.focus('#srcUrlInput');await p.keyboard.press('Enter');await wait(400);
 const v1=await p.inputValue('#qf-refurl');
 ok('Enter で、貼った文の中の URL だけが取り出されて追加される（保存用の欄に改行区切り）',v1==='https://example.com/rates/2026\nhttps://www.carrier.co.jp/tariff?id=7',v1);
 ok('入力欄は空に戻り、「2 件の URL を追加しました」と出る',(await p.inputValue('#srcUrlInput'))===''&&/2 件/.test(await p.textContent('#srcUrlMsg')),await p.textContent('#srcUrlMsg'));
 ok('一覧に 2 件の URL が出る（クリックで別タブ・✕で外せる）',await p.evaluate(()=>{const it=[...document.querySelectorAll('#qfSrcUrls .src-url-item')];return it.length===2&&it.every(i=>i.querySelector('a[target=_blank][rel*=noopener]')&&i.querySelector('.src-url-del'));}),null);
 ok('一覧が空でなくなったので「資料はまだありません」は消える',await p.evaluate(()=>document.getElementById('qfSrcEmpty').hidden),null);
 ok('追加したことが変更として通知される（未保存の印・元に戻す履歴）',(await p.evaluate(()=>window.__refEv))>=1,await p.evaluate(()=>window.__refEv));
 ok('「必要なときだけ開く」の要約に URL が出る',/URL/.test(await p.textContent('#ciMoreSum')),await p.textContent('#ciMoreSum'));
 // 重複・不正
 await p.fill('#srcUrlInput','https://example.com/rates/2026');await p.keyboard.press('Enter');await wait(250);
 ok('同じ URL をもう一度入れると「追加済み」と出て、増えない',(await p.inputValue('#qf-refurl'))===v1&&/追加済み/.test(await p.textContent('#srcUrlMsg')),await p.textContent('#srcUrlMsg'));
 await p.fill('#srcUrlInput','これは URL ではありません');await p.click('#srcUrlGo');await wait(250);
 ok('URL でない文は追加されず、入力のしかたが案内される',(await p.inputValue('#qf-refurl'))===v1&&/http/.test(await p.textContent('#srcUrlMsg'))&&await p.evaluate(()=>document.getElementById('srcUrlMsg').classList.contains('is-err')),await p.textContent('#srcUrlMsg'));
 // 一部が重複
 await p.fill('#srcUrlInput','https://example.com/rates/2026 https://new.example.org/');await p.click('#srcUrlGo');await wait(300);
 ok('一部が追加済みなら、新しい分だけ足して「除きました」と出る',(await p.inputValue('#qf-refurl')).split('\n').length===3&&/除き/.test(await p.textContent('#srcUrlMsg')),await p.inputValue('#qf-refurl'));
 // ダイアログの見た目：画面に収まる
 const box=await p.evaluate(()=>{const r=document.getElementById('srcAddBox').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:innerWidth,h:innerHeight};});
 ok('ダイアログが画面の中に収まる',box.l>=0&&box.t>=0&&box.r<=box.w&&box.b<=box.h,box);
 if(process.env.SHOT){await p.screenshot({path:process.env.SHOT});}
 if(process.env.SHOT2){await p.keyboard.press('Escape');await wait(250);await p.evaluate(()=>{document.getElementById('qfSources').scrollIntoView({block:'center'});});await wait(300);await p.screenshot({path:process.env.SHOT2});await p.click('#srcAddBtn');await wait(300);}
 // Esc で閉じる
 await p.keyboard.press('Escape');await wait(300);
 ok('Esc でダイアログが閉じる',await p.evaluate(()=>!document.getElementById('srcAddModal').classList.contains('open')),null);
 ok('閉じたあとも一覧に 3 件の URL が残る',await p.evaluate(()=>document.querySelectorAll('#qfSrcUrls .src-url-item').length===3),null);
 // 外す
 await p.locator('#qfSrcUrls .src-url-item').nth(1).locator('.src-url-del').click();await wait(300);
 const v2=await p.inputValue('#qf-refurl');
 ok('✕ で 1 件だけ外れる（他の URL は残る）',v2==='https://example.com/rates/2026\nhttps://new.example.org/',v2);
 // 保存して開き直す
 const data=await p.evaluate(()=>gatherAllData());
 ok('案件データには従来どおり参照URLが入る（qf-refurl）',data.fields['qf-refurl']===v2,data.fields['qf-refurl']);
 await p.evaluate(()=>{document.getElementById('qf-refurl').value='';window.renderRefUrlLinks();});
 await p.evaluate(d=>{_applyQuoteData(d);},data);await wait(700);
 ok('案件を開き直すと、一覧に URL が復元される',await p.evaluate(()=>document.querySelectorAll('#qfSrcUrls .src-url-item').length===2),null);
 // 旧形式（文章の中に URL が混じっていた案件）
 await p.evaluate(d=>{d.fields['qf-refurl']='参照：https://old.example.com/a 、\nhttps://old.example.com/b （最新版）';_applyQuoteData(d);},JSON.parse(JSON.stringify(data)));await wait(700);
 ok('以前の入力（文章に URL が混じる）でも、URL が一覧に出る',await p.evaluate(()=>[...document.querySelectorAll('#qfSrcUrls .src-url-link')].map(a=>a.href).join('|')==='https://old.example.com/a|https://old.example.com/b'),await p.evaluate(()=>[...document.querySelectorAll('#qfSrcUrls .src-url-link')].map(a=>a.href)));
 // 全部外すと空の表示に戻る
 for(let i=0;i<2;i++){await p.locator('#qfSrcUrls .src-url-item').first().locator('.src-url-del').click();await wait(250);}
 ok('すべて外すと「資料はまだありません」に戻る',await p.evaluate(()=>!document.getElementById('qfSrcEmpty').hidden&&document.getElementById('qf-refurl').value.trim()===''),await p.inputValue('#qf-refurl'));
 // 「ウェブサイト（URL）」ボタンで入力欄へ
 await p.click('#srcAddBtn');await wait(250);await p.evaluate(()=>document.getElementById('srcUrlInput').blur());
 await p.locator('.src-pill').nth(1).click();await wait(150);
 ok('「ウェブサイト（URL）」を押すと URL 入力欄にフォーカスが戻る',await p.evaluate(()=>document.activeElement.id==='srcUrlInput'),null);
 // ダイアログの外側（暗い部分）で閉じる
 await p.mouse.click(8,8);await wait(300);
 ok('外側をクリックしても閉じる',await p.evaluate(()=>!document.getElementById('srcAddModal').classList.contains('open')),null);
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



 await p.waitForTimeout(500);
 await run(p);
 console.log('errors',JSON.stringify(errs));
 out.push(errs.length?'FAIL JS エラー':'PASS JS エラーなし');
 await b.close();srv.close();
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log('\nFAIL='+fails);process.exit(fails?1:0);})();

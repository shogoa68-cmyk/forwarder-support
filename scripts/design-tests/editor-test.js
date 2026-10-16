const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const root=require('path').resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:+process.env.W||1400,height:+process.env.H||900},locale:'ja-JP'});
 await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},process.env.MODE||'detail');
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1000);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(1800);

 const sleep=ms=>p.waitForTimeout(ms);const res=[];const ok=(n,c,d)=>{res.push(c);console.log((c?'✅ ':'❌ ')+n+(c||!d?'':' → '+d));};
 const vis=sel=>p.evaluate(s=>{const e=document.querySelector(s);return !!e&&e.offsetParent!==null},sel);
 // a. 既定（詳細）
 ok('詳細表示：道しるべ・必須バッジ・「詳細（任意）」は出ない',!(await vis('#qpGuide'))&&!(await vis('.tier-badge'))&&!(await vis('.tier-opt-toggle')));
 ok('詳細表示：メモ・出発地ゾーン・メール取込ボタンが従来どおり見える',(await vis('#qf-due'))&&(await vis('#zone1Card'))&&(await vis('#saveToolbar .toolbar-extra')));
 ok('詳細表示：作業範囲は畳まれていない',await p.evaluate(()=>!document.getElementById('section-scope').classList.contains('collapsed')));
 await p.evaluate(()=>setUiMode('simple'));await sleep(2200);
 // b. かんたん
 ok('かんたん：道しるべ・バッジ・「詳細（任意）」が出る',(await vis('#qpGuide'))&&(await vis('.tier-badge'))&&(await vis('#refBody .tier-opt-toggle')));
 ok('かんたん：任意の欄・上級ゾーンは隠れるが DOM には残る',await p.evaluate(()=>['qf-due','qf-core-ref','qf-received'].every(id=>document.getElementById(id)&&document.getElementById(id).offsetParent===null)&&document.getElementById('zone1Card')&&document.getElementById('zone1Card').offsetParent===null));
 ok('かんたん：必須3項目は見える',(await vis('#qf-ref'))&&(await vis('#qf-customer'))&&(await vis('#qf-person')));
 ok('かんたん：メール取込ボタンはツールバーから消える',!(await vis('#saveToolbar .save-btn-import')));
 ok('かんたん：作業範囲・全体リマークは畳まれる',await p.evaluate(()=>['section-scope','section-remark'].every(i=>document.getElementById(i).classList.contains('collapsed'))));
 // c. 隠した欄の値は保存・計算で読まれる
 await p.evaluate(()=>{const m=document.getElementById('qf-memo');m.value='隠したメモ';m.dispatchEvent(new Event('input',{bubbles:true}));const c=document.getElementById('qf-core-ref');c.value='CORE-1';});
 const dat=await p.evaluate(()=>gatherAllData().fields);
 ok('隠した欄の値が gatherAllData に含まれる',dat['qf-memo']==='隠したメモ'&&dat['qf-core-ref']==='CORE-1');
 // d. 「詳細（任意）」トグル
 await p.click('#refBody .tier-opt-toggle');await sleep(200);
 ok('「詳細（任意）」を開くと提出期限・基幹REF#が見える',(await vis('#qf-due'))&&(await vis('#qf-core-ref')));
 ok('開いた状態の表示（aria-expanded=true）',await p.evaluate(()=>document.querySelector('#refBody .tier-opt-toggle').getAttribute('aria-expanded')==='true'));
 await p.click('#refBody .tier-opt-toggle');await sleep(200);
 ok('もう一度押すと閉じる',!(await vis('#qf-due'))&&!(await vis('#qf-core-ref')));
 // e. 上級機能を使っている案件
 await p.evaluate(()=>toggleZone(1));await sleep(2200);
 ok('出発地ゾーンを使っている→自動で表示＋帯で知らせる',(await vis('#zone1Card'))&&await p.evaluate(()=>{const b=document.getElementById('uimAdvBar');return !b.hidden&&/出発地ゾーン/.test(b.textContent)}));
 await p.evaluate(()=>toggleZone(1));await sleep(2200);
 ok('使うのをやめると隠れ、帯も消える',!(await vis('#zone1Card'))&&await p.evaluate(()=>document.getElementById('uimAdvBar').hidden));
 await p.evaluate(()=>{addPackingPattern&&addPackingPattern()});await sleep(2200);
 ok('複数の荷姿パターン→パターン欄が自動表示',(await vis('#cdPatternTabs'))&&await p.evaluate(()=>/複数の荷姿パターン/.test(document.getElementById('uimAdvBarText').textContent)));
 await p.evaluate(()=>createFclLclPatterns());await sleep(2200);
 ok('FCL/LCL比較→右レールの「FCL/LCL」が自動表示',await p.evaluate(()=>{const b=document.querySelector('.qrc-rail-btn[data-mod="fcllcl"]');return b&&b.offsetParent!==null}));
 // f. 右レール
 ok('右レール：比較／ブク／類似などは隠れ、「その他」がある',await p.evaluate(()=>['compare','bookmark','similar','scenario','subcon','charges','pattern'].every(m=>document.querySelector('.qrc-rail-btn[data-mod="'+m+'"]').offsetParent===null)&&document.querySelector('.qrc-more-btn').offsetParent!==null));
 await p.click('.qrc-more-btn');await sleep(200);
 ok('「その他」で上級ツールが展開',await p.evaluate(()=>['compare','bookmark','similar'].every(m=>document.querySelector('.qrc-rail-btn[data-mod="'+m+'"]').offsetParent!==null)));
 // g. 危険品
 await p.evaluate(()=>{const hz=document.getElementById('cond-hazmat');const opt=[...hz.options].find(o=>o.value&&!/^なし/.test(o.value));hz.value=opt.value;hz.dispatchEvent(new Event('change',{bubbles:true}))});await sleep(2200);
 ok('危険品・特殊貨物が選択済み→「詳細（任意）」が閉じていても表示',await vis('[data-adv-key="hazmat"]'));
 // h. 任意セクション
 await p.click('#section-scope .section-toggle-head');await sleep(200);
 ok('作業範囲：見出しクリックで開く',(await vis('#qf-scope')));
 await p.fill('#qf-scope','輸出通関、海上スペース手配');await p.click('#section-scope .section-toggle-head');await sleep(900);
 ok('畳むと要約が出る',await p.evaluate(()=>/輸出通関/.test(document.getElementById('sumScope').textContent)&&document.getElementById('sumScope').offsetParent!==null));
 // i. ツールバー「⋯」
 await p.evaluate(()=>{window.__c=[];window.openEmailImport=()=>window.__c.push('mail');window.openSubconRequestMail=()=>window.__c.push('sub')});
 await p.click('#saveToolbar .tb-menu button.save-btn-menu');await p.locator('#tbMenuMore .tb-menu-item',{hasText:'メール取込'}).click();
 await p.click('#saveToolbar .tb-menu button.save-btn-menu');await p.locator('#tbMenuMore .tb-menu-item',{hasText:'サブコン依頼メール'}).click();
 ok('⋯メニューの項目が元と同じ処理を呼ぶ',JSON.stringify(await p.evaluate(()=>window.__c))==='["mail","sub"]');
 // j. 道しるべ
 await p.evaluate(()=>setUiMode('simple'));
 await p.fill('#qf-customer','テスト商事');await p.click('#dirBtns [data-dir="export"]');await p.evaluate(()=>setTransport('fcl'));await p.selectOption('#cond-incoterms',{label:'FOB（本船渡し）'});
 await p.fill('#z2Pol','YOKOHAMA');await p.fill('#z2Pod','BANGKOK');await p.evaluate(()=>addRouteEntry());await sleep(2000);
 const cur1=await p.evaluate(()=>document.querySelector('.qp-guide-step.is-current')?.dataset.gstep);
 await p.fill('#cond-cargo','自動車部品');await sleep(2000);
 const cur2=await p.evaluate(()=>document.querySelector('.qp-guide-step.is-current')?.dataset.gstep);
 ok('道しるべ：条件入力後は②→貨物入力後は③',cur1==='2'&&cur2==='3',cur1+','+cur2);
 ok('道しるべ：ヒント文が更新される',await p.evaluate(()=>/③/.test(document.getElementById('qpHint').textContent)));
 // k. 詳細へ戻す
 await p.evaluate(()=>setUiMode('detail'));await sleep(500);
 ok('詳細へ戻す：従来の画面（ゾーン・メモ・メール取込が見える／畳みなし／帯なし／道しるべなし）',(await vis('#zone1Card'))&&(await vis('#qf-due'))&&(await vis('#saveToolbar .save-btn-import'))&&!(await vis('#qpGuide'))&&await p.evaluate(()=>document.getElementById('uimAdvBar').hidden&&!document.getElementById('section-scope').classList.contains('collapsed')));
 ok('JSエラーなし',errs.length===0,JSON.stringify(errs));
 console.log(res.every(Boolean)?'\nOK':'\nNG');await b.close();srv.close();
})();

#!/usr/bin/env node
// Design への依頼用に、架空データ入りの「ログイン後ダッシュボード」の画像を生成する（実サーバーには接続しない）。
//   node scripts/sample-dashboard-shots.js            現行デザイン  → docs/design-handoff/requests/sample-dashboard-{top,full}.png
//   THEME=1 node scripts/sample-dashboard-shots.js    Industry 適用 → 〜-industry.png
//   MODE=simple node scripts/sample-dashboard-shots.js かんたん表示 → 〜-simple.png（THEME=1 と併用可）
//   OUT_DIR=<dir> で出力先を変更
// 偽の supabase（ログイン済み・架空の案件20件）を差し込んで描画する。Playwright と Chromium が必要。
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT_DIR||path.resolve(__dirname,'..','docs','design-handoff','requests');
const MODE=process.env.MODE||'';   // MODE=simple でかんたん表示（ファイル名に -simple が付く）
const SUF=(MODE==='simple'?'-simple':'')+(process.env.THEME?'-industry':'');
(async()=>{
 const root=require('path').resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 // ---- stage 1: 基になる見積データを実アプリで作る ----
 let ctx=await b.newContext({viewport:{width:1400,height:900},locale:'ja-JP'});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 let p=await ctx.newPage(); p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());
 await p.fill('#qf-ref','10-261012-001');await p.fill('#qf-customer','サンプル商事株式会社');await p.fill('#qf-person','山田');
 await p.click('#dirBtns [data-dir="export"]');await p.evaluate(()=>setTransport('fcl'));
 await p.selectOption('#cond-incoterms',{label:'FOB（本船渡し）'});
 await p.fill('#z2Carrier','Maersk');await p.fill('#z2Pol','YOKOHAMA');await p.fill('#z2Pod','BANGKOK');await p.evaluate(()=>addRouteEntry());
 const rows=[['海上運賃','A海運','ocean',120000,20000],['THC','Bローカル','export-local',30000,5000],['通関料','C通関','customs-export',8000,2000]];
 for(let i=0;i<rows.length;i++){
  if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(80);}
  const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  await f('nm').fill(rows[i][0]);await f('sv').fill(rows[i][1]);await f('cat').selectOption(rows[i][2]);
  await f('pq').fill('1');await f('pp').fill(String(rows[i][3]));await f('mk').fill(String(rows[i][4]));await f('mk').blur();
 }
 await p.waitForTimeout(500);
 const base=await p.evaluate(()=>JSON.parse(JSON.stringify(gatherAllData())));
 await ctx.close();
 // ---- ケース生成（架空データ） ----
 const now=Date.now(), H=3600e3, D=24*H;
 const spec=[
  ['サンプル商事株式会社','山田','提示済み','FOB（本船渡し）','fcl',[['YOKOHAMA','BANGKOK'],['SHIMIZU','BANGKOK']],['インド','東南アジア'],3,2],
  ['テスト物産株式会社','佐藤','下書き中','CIF（運賃保険料込み）','lcl',[['TOKYO','HONGKONG']],['香港'],18,5],
  ['ダミー貿易株式会社','鈴木','受注','EXW（工場渡し）','fcl',[['NAGOYA','PORT KLANG']],['マレーシア','車両'],40,26],
  ['見本産業株式会社','田中','ヨコヨコ提示','CFR（運賃込み）','fcl',[['YOKOHAMA','GENOA']],['イタリア'],6,30],
  ['サンプル商事株式会社','山田','情報待ち','DAP（仕向地持込渡し）','lcl',[['OSAKA','SHANGHAI']],['中国'],26,52],
  ['テスト物産株式会社','佐藤','失注','FOB（本船渡し）','fcl',[['KOBE','SINGAPORE']],['シンガポール'],9,70],
  ['ダミー貿易株式会社','鈴木','辞退','EXW（工場渡し）','lcl',[['NAGOYA','HOCHIMINH']],['ベトナム'],14,96],
  ['見本産業株式会社','田中','保留','CIF（運賃保険料込み）','fcl',[['YOKOHAMA','LONG BEACH']],['北米'],33,120],
 ];
 const svs=[['A海運','B運送','C通関'],['D物流','E倉庫','F通関'],['G海運','H通関'],['I海運','J通関','K作業']];
 const cases=[];
 for(let i=0;i<20;i++){
  const s=spec[i%spec.length];
  const d=JSON.parse(JSON.stringify(base));
  const ref=`10-2610${String(12-Math.floor(i/3)).padStart(2,'0')}-${String(i+1).padStart(3,'0')}`;
  d.fields['qf-ref']=ref;d.fields['qf-customer']=s[0];d.fields['qf-person']=s[1];d.fields['qf-status']=s[2];
  d.fields['qf-memo']=['シャインマスカット輸送の件','雑貨 FCL 見積依頼','中古機械 輸出','食品 LCL 混載','アパレル 往復案件'][i%5];
  d.fields['cond-incoterms']=s[3];
  d.fields['qf-received']=new Date(now-s[7]*D).toISOString().slice(0,10);
  d.fields['z2-routes-data']=JSON.stringify(s[5].map(r=>({pol:r[0],pod:r[1],via:'',carrier:'Maersk'})));
  const sv=svs[i%svs.length]; let k=0;
  (d.rows||[]).forEach(r=>{if(r&&r._type==='data'&&Array.isArray(r.cells)){r.cells[2]=sv[k%sv.length];k++;}});
  cases.push({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),name:ref,status:s[2],customer:s[0],person:s[1],owner_email:'sample@example.com',created_by:i%2?'sample@example.com':'member@example.com',updated_at:new Date(now-s[8]*H-i*3*H).toISOString(),incoterms:s[3],transport_mode:s[4],pol:s[5][0][0],pod:s[5][0][1],carrier:'Maersk',data:d,ref,tags:s[6],locked_by:null,locked_at:null,editors:[]});
 }
 const comments=[
  {id:'c1',preset_id:cases[0].id,body:'船会社からの回答待ちです。明日再確認します。',created_by:'member@example.com',created_at:new Date(now-5*H).toISOString()},
  {id:'c2',preset_id:cases[2].id,body:'受注ありがとうございます。ブッキング手配をお願いします。',created_by:'sample@example.com',created_at:new Date(now-28*H).toISOString()},
 ];
 const profiles=[{email:'sample@example.com',display_name:'サンプル太郎',avatar_color:'#5980a6',avatar_emoji:null},{email:'member@example.com',display_name:'メンバー花子',avatar_color:'#8a5035',avatar_emoji:null}];
 // ---- stage 2: 偽の supabase を差し込み、ログイン済みダッシュボードを描く ----
 ctx=await b.newContext({viewport:{width:1400,height:1000},locale:'ja-JP',deviceScaleFactor:1});
 await ctx.addInitScript(({cases,comments,profiles})=>{
  const tbl=t=>t==='quote_presets'?cases:t==='quote_comments'?comments:t==='user_profiles'?profiles:[];
  const mk=t=>{const st={t,one:false};const b=new Proxy({},{get(_,k){
    if(k==='then')return(res,rej)=>Promise.resolve({data:st.one?(tbl(t)[0]||null):tbl(t),error:null}).then(res,rej);
    if(k==='single'||k==='maybeSingle')return()=>{st.one=true;return b};
    return()=>b;}});return b;};
  const ch={on(){return ch},subscribe(cb){cb&&cb('SUBSCRIBED');return ch},track(){return Promise.resolve()},untrack(){return Promise.resolve()},presenceState(){return{}},unsubscribe(){return Promise.resolve()},send(){return Promise.resolve()}};
  const user={email:'sample@example.com',user_metadata:{full_name:'サンプル太郎'}};
  const client={from:mk,rpc:()=>Promise.resolve({data:null,error:null}),channel:()=>ch,removeChannel(){},storage:{from:()=>({upload:async()=>({}),remove:async()=>({}),createSignedUrl:async()=>({data:null})})},
   auth:{getSession:()=>Promise.resolve({data:{session:{user}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:()=>Promise.resolve({}),signInWithOAuth:()=>Promise.resolve({})}};
  window.supabase={createClient:()=>client};
 },{cases,comments,profiles});
  if(MODE){await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},MODE);}
  if(process.env.THEME){await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});}
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.addStyleTag({content:'*{caret-color:transparent!important;}'});
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(2500);

 const sleep=ms=>p.waitForTimeout(ms);
 const res=[];const ok=(n,c,d)=>{res.push(c);console.log((c?'✅ ':'❌ ')+n+(c||!d?'':' → '+d));};
 // 1. 既定は詳細（従来どおり）
 ok('既定は詳細表示（mode-simple なし）',!(await p.evaluate(()=>document.documentElement.classList.contains('mode-simple'))));
 ok('詳細表示では見出し・⋯が非表示',await p.evaluate(()=>{const h=document.querySelector('#qpdListWrap .cloud-card-headline');const m=document.querySelector('#qpdListWrap .cloud-menu');return getComputedStyle(h).display==='none'&&getComputedStyle(m).display==='none'}));
 // 2. 切替
 await p.click('#qpDashboard .uim-switch [data-uim="simple"]');await sleep(500);
 ok('かんたんに切替（クラス・保存）',await p.evaluate(()=>document.documentElement.classList.contains('mode-simple')&&localStorage.getItem('fwd.uiMode')==='simple'));
 ok('カードに「開く」・⋯が出る／旧ボタンは隠れる',await p.evaluate(()=>{const c=document.querySelector('#qpdListWrap .cloud-card');const vis=s=>{const e=c.querySelector(s);return e&&getComputedStyle(e).display!=='none'&&e.offsetParent!==null};return vis('.btn-preset-load')&&vis('.cloud-menu-btn')&&!vis('.btn-preset-pdf')&&!vis('.btn-preset-del')}));
 ok('見出し＝メモ1行目',await p.evaluate(()=>document.querySelector('#qpdListWrap .cloud-card-headline').textContent.trim()==='シャインマスカット輸送の件'));
 ok('申し送りは既定で畳み／件数バッジあり',await p.evaluate(()=>{const b=document.querySelector('#qpdListWrap .cloud-card-chat');return !b.classList.contains('ccc-open')&&b.querySelector('.ccc-panel').hasAttribute('hidden')&&/申し送り 1/.test(b.querySelector('.ccc-count').textContent)}));
 await p.locator('#qpdListWrap .ccc-toggle').first().click();await sleep(300);
 ok('申し送りバッジで開く',await p.evaluate(()=>{const b=document.querySelector('#qpdListWrap .cloud-card-chat');return b.classList.contains('ccc-open')&&!b.querySelector('.ccc-panel').hasAttribute('hidden')&&b.querySelector('.ccc-panel').offsetHeight>0}));
 // 3. ⋯メニュー
 await p.evaluate(()=>{window.__calls=[];['cloudPreviewPreset','cloudPdfPreset','cloudDuplicatePreset','cloudDeletePreset'].forEach(n=>{window[n]=(...a)=>window.__calls.push(n+':'+decodeURIComponent(a[0]).slice(-2))})});
 const btn=p.locator('#qpdListWrap .cloud-menu-btn').first();
 await btn.click();await sleep(200);
 ok('⋯で開き、最初の項目に焦点',await p.evaluate(()=>{const a=document.activeElement;return a&&a.classList.contains('cloud-menu-item')&&/プレビュー/.test(a.textContent)&&document.querySelector('.cloud-menu-btn[aria-expanded="true"]')!==null}));
 await p.keyboard.press('ArrowDown');await p.keyboard.press('ArrowDown');
 ok('↓キーで移動',await p.evaluate(()=>/コピー/.test(document.activeElement.textContent)));
 await p.keyboard.press('Escape');await sleep(200);
 ok('Escで閉じて⋯に焦点が戻る',await p.evaluate(()=>!document.querySelector('.cloud-menu-panel:not([hidden])')&&document.activeElement.classList.contains('cloud-menu-btn')));
 await btn.click();await sleep(150);await p.mouse.click(700,60);await sleep(200);
 ok('外側クリックで閉じる',await p.evaluate(()=>!document.querySelector('.cloud-menu-panel:not([hidden])')));
 for(const [label,fn] of [['プレビュー','cloudPreviewPreset'],['PDF を出力','cloudPdfPreset'],['コピーして新規作成','cloudDuplicatePreset'],['削除…','cloudDeletePreset']]){
   await btn.click();await sleep(150);await p.locator('.cloud-menu-panel:not([hidden]) .cloud-menu-item',{hasText:label}).click();await sleep(150);
 }
 const calls=await p.evaluate(()=>window.__calls);
 ok('4項目が従来と同じ関数を呼ぶ',JSON.stringify(calls.map(c=>c.split(':')[0]))===JSON.stringify(['cloudPreviewPreset','cloudPdfPreset','cloudDuplicatePreset','cloudDeletePreset']),JSON.stringify(calls));
 // 4. 詳しく絞り込む
 ok('詳細検索・タグ・ランキングは隠れている',await p.evaluate(()=>['#qpdAdvToggle','.qpd-tag-quickfilter','.qpd-side','#qpdLinkModeBtn'].every(s=>document.querySelector(s).offsetParent===null)));
 await p.click('#qpdMoreToggle');await sleep(200);
 ok('「詳しく絞り込む」で出る',await p.evaluate(()=>['#qpdAdvToggle','.qpd-tag-quickfilter','.qpd-side','#qpdLinkModeBtn'].every(s=>document.querySelector(s).offsetParent!==null)));
 // 5. リスト
 await p.click('#qpdViewList');await sleep(400);
 ok('リスト（かんたん）7列',await p.evaluate(()=>{const h=document.querySelector('.qpd-rows-head--simple');return !!h&&h.children.length===7&&getComputedStyle(h).gridTemplateColumns.split(' ').length===7}));
 await p.locator('#qpdListWrap .qpd-row-open-btn').first().evaluate(e=>{window.__opened=null;window.cloudLoadPreset=id=>{window.__opened=id}});
 await p.locator('#qpdListWrap .qpd-row-open-btn').first().click();
 ok('リストの「開く」が cloudLoadPreset を呼ぶ',await p.evaluate(()=>!!window.__opened));
 // 6. 詳細へ戻す
 await p.click('#qpdViewCard');await sleep(300);
 await p.click('#qpDashboard .uim-switch [data-uim="detail"]');await sleep(500);
 ok('詳細へ戻すとカードが従来どおり（旧ボタン表示・ ccc-open）',await p.evaluate(()=>{const c=document.querySelector('#qpdListWrap .cloud-card');const v=s=>{const e=c.querySelector(s);return e.offsetParent!==null};return v('.btn-preset-pdf')&&v('.btn-preset-del')&&c.querySelector('.cloud-card-chat').classList.contains('ccc-open')&&!document.documentElement.classList.contains('mode-simple')}));
 ok('JSエラーなし',errs.length===0,JSON.stringify(errs));
 console.log(res.every(Boolean)?'\nOK':'\nNG');
 await b.close();srv.close();
})();

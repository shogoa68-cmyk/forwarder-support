// 情報共有 › 📰 ニュースの投稿（js/news-feed.js）。偽の Supabase（master_news だけ）で、投稿→タイムライン→絞り込み→編集→削除、
// 未登録の名前の扱い、マスター詳細のニュース欄（mnFor）に同じ投稿が出ることを確かめる。
//   node scripts/design-tests/news-feed-test.js     （現行）
//   THEME=1 node scripts/design-tests/news-feed-test.js（Industry）   W=390 でスマホ幅
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
let fail=0;const ok=(n,c,x)=>{if(!c)fail++;console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));};
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
 // 偽のログイン・偽の master_news・偽のマスター
 await p.evaluate(()=>{
  const rows=[{id:'n0',field:'sv',name:'ABC運輸',kind:'move',news_date:'2026-10-02',title:'倉庫を移転',body:'新住所は大井',url:null,created_by:'tanaka@x.jp',created_at:'2026-10-02T00:00:00Z'}];
  window.__rows=rows;let seq=1;
  const q=(op,val)=>{const st={op,val,eq:null};const api={select(){return api},order(){return api},eq(k,v){st.eq=[k,v];return api},
   then(res,rej){try{let out={data:null,error:null};
    if(st.op==='select')out.data=rows.slice();
    else if(st.op==='insert'){const r=Object.assign({id:'n'+(seq++),created_at:new Date().toISOString()},st.val);rows.push(r);}
    else if(st.op==='update'){const r=rows.find(x=>x[st.eq[0]]===st.eq[1]);Object.assign(r,st.val);}
    else if(st.op==='delete'){const i=rows.findIndex(x=>x[st.eq[0]]===st.eq[1]);if(i>=0)rows.splice(i,1);}
    res(out);}catch(e){rej(e)}}};return api;};
  const tbl={select:()=>q('select'),insert:v=>q('insert',v),update:v=>q('update',v),delete:()=>q('delete')};
  window.cloudGetClient=()=>({from:()=>tbl});
  window.cloudCurrentUser=()=>({email:'me@x.jp'});
  window._nameFor=e=>({'me@x.jp':'自分','tanaka@x.jp':'田中'})[e]||e;
  const M={customer:['山田商事'],sv:['ABC運輸']};
  window.statsMasterState=(f,v)=>M[f].includes(v)?'master':'none';
  window.statsLoadMasterCache=async()=>{};
  window.__jump=null;window.statsJumpToMaster=(f,n,o)=>{window.__jump=[f,n,o];};
 });
 await p.evaluate(()=>switchCategory('news',document.querySelector('.cat-btn[aria-controls="tab-news"]')));await p.waitForTimeout(500);
 const s0=await p.evaluate(()=>({form:!!document.querySelector('#nfRoot .nf-form'),items:document.querySelectorAll('#nfRoot .nf-item').length,txt:document.querySelector('#nfRoot .nf-item').textContent,list:document.querySelector('.nf-f-name').getAttribute('list')}));
 ok('投稿フォームと、既存のニュース（タイムライン）が出る',s0.form&&s0.items===1&&/倉庫を移転/.test(s0.txt)&&/ABC運輸/.test(s0.txt)&&/田中/.test(s0.txt),s0);
 ok('名前の欄はお客様のマスター候補を引く（既定はお客様）',s0.list==='custSuggestions',s0);
 // 未登録の名前
 await p.fill('.nf-f-name','未登録社');await p.waitForTimeout(100);
 ok('マスターに無い名前は注意と「＋ マスター登録」が出る',await p.evaluate(()=>/未登録/.test(document.querySelector('.nf-name-hint').textContent)&&!!document.querySelector('[data-nf="reg"]')),null);
 await p.fill('.nf-f-title','テスト');await p.click('[data-nf="save"]');await p.waitForTimeout(300);
 ok('未登録の名前では投稿しない（保存されない）',await p.evaluate(()=>window.__rows.length===1),null);
 // 投稿
 await p.fill('.nf-f-name','山田商事');await p.waitForTimeout(100);
 ok('登録済みの名前なら注意は出ない',await p.evaluate(()=>document.querySelector('.nf-name-hint').textContent.trim()===''),null);
 await p.fill('.nf-f-date','2026-11-18');await p.selectOption('.nf-f-kind','contact');
 await p.fill('.nf-f-title','担当が佐藤さんに変更');await p.fill('.nf-f-body','前任の鈴木さんは異動');
 await p.click('[data-nf="save"]');await p.waitForTimeout(400);
 const s1=await p.evaluate(()=>({rows:window.__rows.length,last:window.__rows[window.__rows.length-1],first:document.querySelector('#nfRoot .nf-item').textContent,months:[...document.querySelectorAll('.nf-month')].map(e=>e.textContent),title:document.querySelector('.nf-f-title').value,mn:(window.mnFor('customer','山田商事')||[]).length}));
 ok('投稿すると master_news に お客様・山田商事・担当変更 で保存される',s1.rows===2&&s1.last.field==='customer'&&s1.last.name==='山田商事'&&s1.last.kind==='contact'&&s1.last.created_by==='me@x.jp',s1.last);
 ok('タイムラインの先頭に出て（新しい順）、月の見出しがつく',/担当が佐藤さんに変更/.test(s1.first)&&s1.months.length===2&&/2026年11月/.test(s1.months[0]),s1);
 ok('投稿後はフォームが空に戻る',s1.title==='',s1);
 ok('同じ投稿がマスター詳細のニュース（mnFor）にも出る＝マスターに紐づく',s1.mn===1,s1);
 // 絞り込み
 await p.click('.nf-chip[data-v="sv"]');await p.waitForTimeout(150);
 ok('「サブコン」で絞ると サブコンの 1 件だけ',await p.evaluate(()=>document.querySelectorAll('.nf-item').length===1&&/ABC運輸/.test(document.querySelector('.nf-item').textContent)),null);
 await p.click('.nf-chip[data-v="all"]');await p.waitForTimeout(100);
 await p.fill('.nf-q','鈴木');await p.waitForTimeout(150);
 ok('検索で本文の語に当たる 1 件だけ',await p.evaluate(()=>document.querySelectorAll('.nf-item').length===1&&document.activeElement.matches('.nf-q')),null);
 await p.fill('.nf-q','');await p.waitForTimeout(100);
 await p.selectOption('.nf-kind','move');await p.waitForTimeout(100);
 ok('種類で絞れる（事務所移転）',await p.evaluate(()=>document.querySelectorAll('.nf-item').length===1&&/倉庫を移転/.test(document.querySelector('.nf-item').textContent)),null);
 await p.selectOption('.nf-kind','all');await p.waitForTimeout(100);
 // 会社名を押すとマスター詳細へ
 await p.click('.nf-item .nf-target');await p.waitForTimeout(100);
 ok('会社名を押すとマスター詳細を開く',await p.evaluate(()=>JSON.stringify(window.__jump)===JSON.stringify(['customer','山田商事',true])),null);
 // 編集
 await p.click('.nf-item [data-nf="edit"]');await p.waitForTimeout(150);
 ok('編集では名前・種別は固定、見出しに今の値',await p.evaluate(()=>document.querySelector('.nf-f-name').disabled&&document.querySelector('.nf-f-title').value==='担当が佐藤さんに変更'),null);
 await p.fill('.nf-f-title','担当が佐藤さんに変更（11/18〜）');await p.click('[data-nf="save"]');await p.waitForTimeout(300);
 ok('更新できる',await p.evaluate(()=>window.__rows.find(r=>r.name==='山田商事').title==='担当が佐藤さんに変更（11/18〜）'&&/11\/18〜/.test(document.querySelector('.nf-item').textContent)),null);
 await p.screenshot({path:OUT+'/news-feed.png',fullPage:false});
 // 削除
 await p.click('.nf-item [data-nf="del"]');await p.waitForTimeout(300);
 const cf=await p.$('.confirm-overlay button.danger, .confirm-dialog .btn-danger, .confirm-dialog [data-ok], .confirm-ok');
 if(cf) await cf.click(); else await p.evaluate(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>/削除する/.test(b.textContent)&&b.offsetParent);if(bs.length)bs[bs.length-1].click();});
 await p.waitForTimeout(400);
 ok('削除できる（確認のあと）',await p.evaluate(()=>window.__rows.length===1&&document.querySelectorAll('.nf-item').length===1),null);
 // 情報共有の入口から
 await p.evaluate(()=>switchCategory('share',document.querySelector('.cat-btn[aria-controls="tab-share"]')));await p.waitForTimeout(200);
 await p.click('#tab-share .share-link >> nth=0');await p.waitForTimeout(400);
 ok('情報共有の入口の「ニュースの投稿」から開ける',await p.evaluate(()=>document.getElementById('tab-news').classList.contains('active')&&document.getElementById('catGrpShareBtn').classList.contains('active')),null);
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();process.exit(fail?1:0);
})();

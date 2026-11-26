// 情報共有 › 新着まとめ（js/share-feed.js）。偽の Supabase（お知らせ・ニュース・申し送り・顧客カルテ・取引ルール）で、
// 1 つの時系列にまとまる・種類／期間／言葉で絞る・新着の印・案件／マスターへ移る・表が無いときの案内 を確かめる。
//   node scripts/design-tests/share-feed-test.js（現行）／THEME=1（Industry）／W=390（スマホ幅）
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
 const setup=(opts)=>p.evaluate(o=>{
  const iso=d=>new Date(Date.now()-d*86400000).toISOString();
  const T={
   announcements:[{id:1,title:'年末年始の営業について',body:'12/29〜1/3 は休業',kind:'important',starts_at:iso(0.1),ends_at:null,created_by:'boss@x.jp'}],
   master_news:[{id:'n1',field:'sv',name:'ABC運輸',kind:'move',news_date:'2026-11-18',title:'倉庫を移転',body:'新住所は大井',created_by:'tanaka@x.jp',created_at:iso(2)}],
   quote_comments:[{id:7,preset_id:'p1',body:'お客様から回答待ち',created_by:'tanaka@x.jp',created_at:iso(0.2)},{id:8,preset_id:'p2',body:'古い申し送り',created_by:'me@x.jp',created_at:iso(60)}],
   quote_presets:[{id:'p1',name:'東京→上海 FCL',customer:'山田商事'},{id:'p2',name:'古い案件',customer:'鈴木物産'}],
   customer_cases:[{id:'k1',customer:'山田商事',kind:'delay',title:'本船遅延で配送やり直し',situation:'2日遅れ',improvement:'早めに連絡',status:'open',occurred_on:'2026-11-10',created_by:'me@x.jp',created_at:iso(5)}],
   customer_rules:[{id:'r1',customer:'山田商事',level:'strict',body:'請求書は月末締め',reason:'経理の指定',status:'active',created_by:'tanaka@x.jp',created_at:iso(10)}],
  };
  (o.missing||[]).forEach(t=>delete T[t]);
  window.__q=[];
  const q=(tb)=>{const st={tb,in:null};const api={select(){return api},order(){return api},limit(){return api},eq(){return api},in(k,v){st.in=[k,v];return api},
   then(res){window.__q.push(st.tb);if(!T[st.tb]){res({data:null,error:{message:'relation "'+st.tb+'" does not exist'}});return;}
    let d=T[st.tb].slice();if(st.in)d=d.filter(r=>st.in[1].includes(r[st.in[0]]));res({data:d,error:null});}};return api;};
  window.cloudGetClient=()=>({from:q});
  window.cloudCurrentUser=()=>({email:'me@x.jp'});
  window.cloudNameFor=e=>({'me@x.jp':'自分','tanaka@x.jp':'田中','boss@x.jp':'社長'})[e]||e;
  window.cloudGetAllRows=()=>[];
  window.__jump=null;window.statsJumpToMaster=(f,n,o)=>{window.__jump=[f,n,o];};
  window.__open=null;window.cloudLoadPreset=id=>{window.__open=id;};
 },opts||{});
 await setup();
 await p.evaluate(()=>{try{localStorage.setItem('shareFeedSeen_v1',String(Date.now()-86400000))}catch(e){}});
 await p.evaluate(()=>switchCategory('share',document.querySelector('.cat-btn[aria-controls="tab-share"]')));await p.waitForTimeout(700);
 const s0=await p.evaluate(()=>{const it=[...document.querySelectorAll('#sfRoot .sf-item')];return {n:it.length,types:it.map(e=>[...e.classList].find(c=>c.startsWith('sf-t-'))),first:it[0]&&it[0].textContent,days:[...document.querySelectorAll('.sf-day')].map(e=>e.textContent),newN:document.querySelectorAll('.sf-item.is-new').length,bar:(document.querySelector('.sf-newbar')||{}).textContent||''};});
 ok('5 種類の情報が 1 つの時系列に並ぶ（30 日より前の申し送りは出ない）',s0.n===5&&['sf-t-ann','sf-t-news','sf-t-comment','sf-t-case','sf-t-rule'].every(t=>s0.types.includes(t)),s0);
 ok('新しい順（いちばん上は今日のお知らせ）・日ごとの見出し',/年末年始/.test(s0.first)&&s0.days[0]==='今日',s0);
 ok('前回開いてからの、ほかの人の書き込みに「新着」（自分の書き込みは除く）',s0.newN===2&&/2 件/.test(s0.bar),s0);
 ok('申し送りには案件名・お客様が付く',await p.evaluate(()=>/東京→上海 FCL/.test(document.querySelector('.sf-t-comment').textContent)&&/山田商事/.test(document.querySelector('.sf-t-comment').textContent)),null);
 ok('厳守の取引ルール・重要なお知らせは目立つ色',await p.evaluate(()=>document.querySelector('.sf-t-rule').classList.contains('is-imp')&&document.querySelector('.sf-t-ann').classList.contains('is-imp')),null);
 await p.screenshot({path:OUT+'/share-feed.png'});
 // 絞り込み
 await p.click('.sf-chip[data-v="case"]');await p.waitForTimeout(100);
 ok('種類で絞ると顧客カルテだけ',await p.evaluate(()=>document.querySelectorAll('.sf-item').length===1&&!!document.querySelector('.sf-t-case')),null);
 await p.click('.sf-chip[data-v="all"]');await p.waitForTimeout(100);
 await p.selectOption('[data-sf="period"]','90');await p.waitForTimeout(100);
 ok('期間を 90 日にすると古い申し送りも出る',await p.evaluate(()=>document.querySelectorAll('.sf-item').length===6),null);
 await p.fill('.sf-q','山田商事');await p.waitForTimeout(150);
 ok('「山田商事」で探すと関係する 3 件',await p.evaluate(()=>document.querySelectorAll('.sf-item').length===3&&document.activeElement.matches('.sf-q')),null);
 await p.fill('.sf-q','');await p.waitForTimeout(100);
 // 移動
 await p.click('.sf-t-rule .sf-open');await p.waitForTimeout(150);
 const pk=await p.evaluate(()=>{const e=document.querySelector('.mpk-pop');return e?{name:e.querySelector('.mpk-name').textContent,sub:e.querySelector('.mpk-sub').textContent,n:e.querySelectorAll('.mpk-item').length,go:e.querySelector('.mpk-go').textContent}:null;});
 ok('会社名を押すと、その場で取引ルールの簡易表示（マスターへは飛ばない）',pk&&pk.name==='山田商事'&&/取引ルール/.test(pk.sub)&&pk.n>=1&&/取引ルール/.test(pk.go),pk);
 ok('簡易表示は本文を省略せず全文（行数で切らない）',await p.evaluate(()=>{const b=document.querySelector('.mpk-body');if(!b)return true;const cs=getComputedStyle(b);return cs.webkitLineClamp==='none'&&cs.overflow!=='hidden';}),null);
 ok('一覧の部分は窓の中でスクロールできる',await p.evaluate(()=>{const l=document.querySelector('.mpk-list');return !!l&&getComputedStyle(l).overflowY==='auto';}),null);
 await p.keyboard.press('Escape');await p.waitForTimeout(100);
 ok('Esc で閉じる',await p.evaluate(()=>!document.querySelector('.mpk-pop')),null);
 await p.click('.sf-t-news .sf-open');await p.waitForTimeout(150);
 ok('ニュースの会社名ではニュースの簡易表示（サブコン）',await p.evaluate(()=>{const e=document.querySelector('.mpk-pop');return !!e&&/サブコン/.test(e.textContent)&&/倉庫を移転/.test(e.textContent)&&/ニュース/.test(e.querySelector('.mpk-sub').textContent);}),null);
 await p.click('.mpk-go');await p.waitForTimeout(100);
 ok('［マスターの詳細で見る］でニュースのタブを指定して開く',await p.evaluate(()=>JSON.stringify(window.__jump)===JSON.stringify(['sv','ABC運輸','news'])&&!document.querySelector('.mpk-pop')),null);
 await p.click('.sf-t-rule .sf-open');await p.waitForTimeout(150);await p.click('.mpk-go');await p.waitForTimeout(100);
 ok('取引ルールからは取引ルールのタブを指定',await p.evaluate(()=>JSON.stringify(window.__jump)===JSON.stringify(['customer','山田商事','rules'])),null);
 await p.evaluate(()=>switchCategory('share',document.querySelector('.cat-btn[aria-controls="tab-share"]')));await p.waitForTimeout(300);
 await p.evaluate(()=>document.querySelector('.sf-t-comment .sf-open').click());await p.waitForTimeout(300);
 ok('申し送りから案件を開く（見積の画面へ移る）',await p.evaluate(()=>window.__open==='p1'&&document.getElementById('tab-quote-make').classList.contains('active')),null);
 // 読み直しの間隔
 const q1=await p.evaluate(()=>window.__q.length);
 await p.evaluate(()=>switchCategory('share',document.querySelector('.cat-btn[aria-controls="tab-share"]')));await p.waitForTimeout(400);
 ok('60 秒以内に開き直しても読み直さない（通信を増やさない）',await p.evaluate(n=>window.__q.length===n,q1),null);
 // 表が無いとき
 await setup({missing:['customer_cases','customer_rules']});
 await p.evaluate(()=>window.shareFeedReload());await p.waitForTimeout(500);
 const s2=await p.evaluate(()=>({n:document.querySelectorAll('.sf-item').length,note:(document.querySelector('.sf-note')||{}).textContent||''}));
 ok('表が無いもの（顧客カルテ・取引ルール）は飛ばして案内だけ出す',s2.n>=3&&/顧客カルテ/.test(s2.note)&&/取引ルール/.test(s2.note),s2);
 ok('「書き込む場所」の入口が残っている',await p.evaluate(()=>document.querySelectorAll('#sfRoot .sf-places .share-link').length===5),null);
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();process.exit(fail?1:0);
})();

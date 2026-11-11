// 御見積書（PDF）：「合計・税サマリを非表示（パターン比較用）」のとき、サブコン内に複数パターンがあれば、
// 案どうしを足した「サブコン小計」は出さない（パターンごとの小計は残す）。複数パターンでないサブコンの小計は従来どおり。
//   node scripts/design-tests/pdf-subcon-compare-test.js   （THEME=1 Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const out=[];
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:1000},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(8000);
 const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1000);
 await p.evaluate(()=>window.qpNewQuote());await p.waitForTimeout(600);
 await p.evaluate(()=>{setTransport('fcl')});
 // 行 0・1 は A海運（パターン FCL案／LCL案）、行 2・3 は B海運（パターンなし）、行 4 は C海運（パターン 1 つだけ）
 const rows=[['海上運賃FCL','A海運',2,1000,500],['海上運賃LCL','A海運',1,3000,1000],['ドキュメント費','Bローカル',1,3000,1000],['THC','Bローカル',1,2000,500],['通関','C通関',1,5000,500]];
 for(let i=0;i<rows.length;i++){
  if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(80);}
  const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).nth(i);
  const r=rows[i];
  await f('nm').fill(r[0]);await f('sv').fill(r[1]);await f('pq').fill(String(r[2]));await f('pp').fill(String(r[3]));await f('mk').fill(String(r[4]));await f('mk').blur();
 }
 const ids=await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').evaluateAll(trs=>trs.map(t=>t.id.replace('row-','')));
 await p.evaluate(([a,b,c])=>{const set=(id,v)=>{const e=document.getElementById('pt-'+id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};set(a,'FCL案');set(b,'LCL案');set(c,'一括');window.renderSubconGroups&&window.renderSubconGroups();},[ids[0],ids[1],ids[4]]);
 await p.waitForTimeout(1000);
 const doc=hide=>p.evaluate(h=>{try{localStorage.setItem('quoteDocHideTotal_v1',h?'1':'0')}catch(e){}const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();
   const t=s=>[...d.querySelectorAll(s)].map(e=>e.textContent.replace(/\s+/g,' ').trim());
   return {scSub:t('tr.qd-subcon-sub'),ptSub:t('tr.qd-pattern-sub'),heads:t('tr.qd-subcon-head'),total:!!d.querySelector('.qd-sum')};},hide);
 let a=await doc(false);
 ok('通常（合計を出す）：サブコン小計は 3 サブコンぶんとも出る',a.scSub.length===3&&/A海運/.test(a.scSub[0])&&/Bローカル/.test(a.scSub[1])&&/C通関/.test(a.scSub[2]),a);
 ok('通常：A海運の 2 パターンの小計行も出る',a.ptSub.length===2,a);
 a=await doc(true);
 ok('パターン比較用（合計・税サマリ非表示）：複数パターンのサブコン（A海運）の小計は出ない',!a.scSub.some(x=>/A海運/.test(x)),a);
 ok('パターン比較用：A海運のパターンごとの小計は残る（2 行）',a.ptSub.length===2,a);
 ok('パターン比較用：パターンの無いサブコン（Bローカル）・パターンが 1 つだけのサブコン（C通関）の小計は従来どおり出る',a.scSub.length===2&&/Bローカル/.test(a.scSub[0])&&/C通関/.test(a.scSub[1]),a);
 ok('パターン比較用：サブコンの見出しは 3 つとも残る',a.heads.length===3,a);
 ok('パターン比較用：合計・税サマリは出ない',a.total===false,a);
 a=await doc(false);
 ok('設定を戻すと、サブコン小計が元どおり出る',a.scSub.length===3&&a.total===true,a);
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log('\nFAIL='+fails);process.exit(fails?1:0);
})();

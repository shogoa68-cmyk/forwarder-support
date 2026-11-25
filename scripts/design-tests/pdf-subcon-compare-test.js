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
  const f=n=>{const set=(v)=>p.evaluate(([i,n,v])=>{const e=[...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="'+n+'"]')][i];if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},[i,n,String(v)]);return {fill:set,selectOption:set,blur:()=>Promise.resolve()};};
  const r=rows[i];
  await f('nm').fill(r[0]);await f('sv').fill(r[1]);await f('pq').fill(String(r[2]));await f('pp').fill(String(r[3]));await f('mk').fill(String(r[4]));await f('mk').blur();
 }
 const ids=await p.locator('#tableBody tr:not([data-virtual]):not([data-type])').evaluateAll(trs=>trs.map(t=>t.id.replace('row-','')));
 await p.evaluate(([a,b,c])=>{const set=(id,v)=>{const e=document.getElementById('pt-'+id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};set(a,'FCL案');set(b,'LCL案');set(c,'一括');window.renderSubconGroups&&window.renderSubconGroups();},[ids[0],ids[1],ids[4]]);
 await p.waitForTimeout(1000);
 // Design 41-F：サブコンの実名は既定で御見積書に出さない（客先表示名を入れたときだけ見出しに出す）
 const noAlias=await p.evaluate(()=>{const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();return {heads:d.querySelectorAll('tr.qd-subcon-head').length,txt:d.textContent};});
 ok('客先表示名なし：サブコン見出しは出ない・実名（A海運）も出ない',noAlias.heads===0&&!/A海運|Bローカル|C通関/.test(noAlias.txt),noAlias.heads);
 // サブコン名を出していない枠は、サブコン別の小計も出さない（パターンごとの小計・見出しは残る）
 const na=await p.evaluate(()=>{const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();const t=s=>[...d.querySelectorAll(s)].map(e=>e.textContent.replace(/\s+/g,' ').trim());return {scSub:t('tr.qd-subcon-sub'),ptSub:t('tr.qd-pattern-sub'),ptHead:t('tr.qd-pattern-head'),cat:t('tr.qd-cat-head'),items:d.querySelectorAll('td.qd-item').length};});
 ok('客先表示名なし：サブコン別の小計（↳ 小計）は 1 行も出ない',na.scSub.length===0,na);
 ok('客先表示名なし：明細 5 行はすべて出る',na.items===5,na);
 ok('客先表示名なし：A海運のパターン見出し・パターンごとの小計は残る',na.ptHead.some(x=>/FCL案/.test(x))&&na.ptSub.length>=2,na);
 ok('客先表示名なし：パターンが 1 つだけの枠（C通関「一括」）にもパターンの小計が出る（合計 3 行）',na.ptSub.length===3,na);
 ok('客先表示名なし：同じカテゴリの見出しが続けて重ならない',na.cat.every((c,i)=>i===0||c!==na.cat[i-1]),na.cat);
 // 1 社だけ客先表示名を入れると、その社だけ見出しと小計が出る
 await p.evaluate(()=>{const m=window.getSubconAliases();m[subconNormKey('Bローカル')]='B社';window.setSubconAliases(m);});
 const one=await p.evaluate(()=>{const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();const t=s=>[...d.querySelectorAll(s)].map(e=>e.textContent.replace(/\s+/g,' ').trim());return {scSub:t('tr.qd-subcon-sub'),heads:t('tr.qd-subcon-head')};});
 ok('1 社だけ客先表示名あり：その社だけ見出しと小計が出る',one.heads.length===1&&/B社/.test(one.heads[0])&&one.scSub.length===1&&/B社/.test(one.scSub[0]),one);
 await p.evaluate(()=>{const m=window.getSubconAliases();m[subconNormKey('C通関')]='C社';window.setSubconAliases(m);});
 const cn=await p.evaluate(()=>{const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();return d.querySelectorAll('tr.qd-pattern-sub').length;});
 ok('パターンが 1 つだけの社に客先表示名を入れると、パターンの小計は出さずサブコン小計だけ（同じ金額の小計が 2 行並ばない）',cn===2,cn);
 await p.evaluate(()=>{window.setSubconAliases({});});
 await p.evaluate(()=>{const m=window.getSubconAliases();['A海運','Bローカル','C通関'].forEach(n=>{m[subconNormKey(n)]=n;});window.setSubconAliases(m);});
 await p.waitForTimeout(300);
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
 // 小計の表示を選べる（PDF 出力設定「小計の表示」・案件ごとに保存）
 await p.evaluate(()=>window.openQuoteDoc());await p.waitForTimeout(500);
 ok('PDF 出力設定に「小計の表示」の選択欄がある（初期値＝おまかせ）',await p.evaluate(()=>{const s=document.getElementById('qdSubtotalMode');return !!s&&s.value==='auto'&&s.options.length===5&&s.offsetParent!==null;}));
 const pick=async v=>{await p.selectOption('#qdSubtotalMode',v);await p.waitForTimeout(250);return p.evaluate(()=>{const d=document.getElementById('qdPreview');const t=s=>[...d.querySelectorAll(s)].map(e=>e.textContent.replace(/\s+/g,' ').trim());return {scSub:t('tr.qd-subcon-sub'),ptSub:t('tr.qd-pattern-sub'),heads:t('tr.qd-subcon-head'),items:d.querySelectorAll('td.qd-item').length,f:document.getElementById('qf-subtotal-mode').value};});};
 a=await pick('all');
 ok('両方を出す：サブコン小計 3 行＋パターン小計 3 行（パターンが 1 つの C通関にも）',a.scSub.length===3&&a.ptSub.length===3&&a.f==='all',a);
 a=await pick('subcon');
 ok('サブコン小計だけ：サブコン小計 3 行・パターン小計 0 行',a.scSub.length===3&&a.ptSub.length===0&&a.f==='subcon',a);
 a=await pick('pattern');
 ok('パターン小計だけ：サブコン小計 0 行・パターン小計 3 行',a.scSub.length===0&&a.ptSub.length===3,a);
 a=await pick('none');
 ok('小計を出さない：どちらも 0 行・明細 5 行と見出しは残る',a.scSub.length===0&&a.ptSub.length===0&&a.items===5&&a.heads.length===3,a);
 await p.evaluate(()=>window.setSubconAliases({}));
 a=await pick('all');
 ok('名前を出していない枠でも「両方」ならサブコン小計（↳ 小計）が出る・実名は出ない',a.scSub.length===3&&a.scSub.every(x=>/^↳ (小計|Subtotal)/.test(x))&&!a.scSub.some(x=>/A海運|Bローカル|C通関/.test(x)),a);
 a=await pick('auto');
 ok('おまかせに戻すと従来どおり（名前なし：サブコン小計 0・パターン小計 3）・保存値は空',a.scSub.length===0&&a.ptSub.length===3&&a.f==='',a);
 await p.selectOption('#qdSubtotalMode','pattern');await p.waitForTimeout(200);
 await p.evaluate(()=>window.closeQuoteDoc());await p.waitForTimeout(200);
 ok('選んだ値は案件の保存データに入る',await p.evaluate(()=>{const d=window.gatherAllData();const f=d.fields||{};return f['qf-subtotal-mode']==='pattern';}));
 await p.evaluate(()=>window.openQuoteDoc());await p.waitForTimeout(400);
 ok('開き直しても選んだ値のまま',await p.evaluate(()=>document.getElementById('qdSubtotalMode').value)==='pattern');
 await p.evaluate(()=>window.closeQuoteDoc());
 await p.evaluate(()=>window.qpNewQuote());await p.waitForTimeout(500);
 ok('新しい見積ではおまかせに戻る',await p.evaluate(()=>document.getElementById('qf-subtotal-mode').value)==='');
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
 const fails=out.filter(l=>l.startsWith('FAIL')).length;console.log('\nFAIL='+fails);process.exit(fails?1:0);
})();

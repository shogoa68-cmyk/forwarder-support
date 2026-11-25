// 物量情報（荷姿・貨物明細）を「メール本文に貼り付けられるテキスト」としてコピー。
//   node scripts/design-tests/cargo-copy-test.js   （THEME=1 で Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>{console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));if(!c)process.exitCode=1;};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':f.endsWith('.html')?'text/html':'application/octet-stream'});r.end(fs.readFileSync(f));});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1300,height:900},locale:'ja-JP',permissions:['clipboard-read','clipboard-write']});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 // 新画面：コピーのボタンは荷姿の「⋯」メニュー（#sbPackMore）に集約されている。メニューの項目を押してコピーする
 const menuLabels=async()=>{await p.evaluate(()=>document.getElementById('sbPackMore').click());await p.waitForTimeout(150);const l=await p.evaluate(()=>[...document.querySelectorAll('.sb-menu .sb-mi')].map(b=>b.textContent.trim()));await p.evaluate(()=>{const m=document.querySelector('.sb-menu');if(m)document.getElementById('sbPackMore').click();});await p.waitForTimeout(100);return l;};
 const menuClick=async(re)=>{await p.evaluate(()=>document.getElementById('sbPackMore').click());await p.waitForTimeout(150);await p.evaluate(src=>{const r=new RegExp(src);[...document.querySelectorAll('.sb-menu .sb-mi')].find(b=>r.test(b.textContent)).click();},re.source);await p.waitForTimeout(250);};
 // 新画面：ステップ③（貨物・物量）へ移り、荷姿の詳細を開く
 await p.evaluate(()=>{if(window.editorV2Go)window.editorV2Go(3);});await p.waitForTimeout(400);
 await p.evaluate(()=>{const h=document.getElementById('sbPackHead');if(h&&h.getAttribute('aria-expanded')!=='true')h.click();});await p.waitForTimeout(300);
 // 荷姿を 2 行入れる
 await p.evaluate(()=>{document.querySelector('[onclick*="toggleQuoteSection(\'section-volume\')"]');const v=document.getElementById('volumeBody');if(v&&getComputedStyle(v).display==='none'){try{toggleQuoteSection('section-volume')}catch(e){}}});
 await p.evaluate(()=>{addPackingRow();addPackingRow();});await p.waitForTimeout(300);
 const rows=[{pkg:'カートン(Dry / Mesh)',qty:9,l:48,w:30,h:40,kg:9.6,stack:'可'},{pkg:'パレット',qty:2,l:120,w:80,h:100,kg:300,stack:'不可'}];
 await p.evaluate(rows=>{const tr=[...document.querySelectorAll('#cargoDetailBody tr')];rows.forEach((r,i)=>{const set=(sel,v)=>{const e=tr[i].querySelector(sel);if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
   const ins=[...tr[i].querySelectorAll('input')];set('.cd-pkg input',r.pkg);set('.cd-qty input',r.qty);const dims=[...tr[i].querySelectorAll('.cd-dim input')];[r.l,r.w,r.h].forEach((v,k)=>{dims[k].value=v;dims[k].dispatchEvent(new Event('input',{bubbles:true}));});set('.cd-kg input',r.kg);const st=tr[i].querySelector('.cd-stack select');if(st){st.value=r.stack;st.dispatchEvent(new Event('change',{bubbles:true}));}});},rows);
 await p.waitForTimeout(300);
 const labs1=await menuLabels();
 ok('荷姿の「⋯」メニューに「📋 テキストでコピー」がある（元のボタン #cdCopyBtn も残る）',labs1.some(l=>/テキストでコピー/.test(l))&&!!(await p.evaluate(()=>document.getElementById('cdCopyBtn'))),labs1);
 ok('パターンが 1 つのとき「全パターンをコピー」は出ない',!labs1.some(l=>/全パターンをコピー/.test(l)));
 await menuClick(/テキストでコピー/);
 let clip=await p.evaluate(()=>navigator.clipboard.readText());
 console.log(clip);
 ok('見出し「【物量情報】」で始まる',clip.startsWith('【物量情報】'),clip);
 ok('1 行目の荷姿：名前・個数・寸法・重量・容積・段積み可',clip.includes('・カートン(Dry / Mesh)　9個　48×30×40cm　9.6kg/個　0.518CBM　段積み可'),clip);
 ok('2 行目：段積み不可も出る',clip.includes('・パレット　2個　120×80×100cm　300kg/個　1.920CBM　段積み不可'),clip);
 ok('合計：個数・CBM・重量',clip.includes('合計：11個　2.438 CBM　686.4 kg')||/合計：11個　2\.438 CBM　686\.4 kg/.test(clip),clip);
 ok('パターン名は前置きしない（1 パターンのとき）',!clip.includes('■'),clip);
 ok('モード未選択のとき R/T・CW は出さない',!/R\/T|CW/.test(clip),clip);
 // LCL → R/T
 await p.evaluate(()=>{const s=document.getElementById('cond-mode');if(s){const o=[...s.options].find(o=>/LCL/.test(o.value));if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));}}});
 await menuClick(/テキストでコピー/);
 clip=await p.evaluate(()=>navigator.clipboard.readText());
 ok('海上 LCL のときは R/T を添える',/R\/T：2\.438/.test(clip)||/R\/T：\d/.test(clip),clip);
 await p.evaluate(()=>{const s=document.getElementById('cond-mode');if(s){const o=[...s.options].find(o=>/航空/.test(o.value));if(o){s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));}}});
 await menuClick(/テキストでコピー/);
 clip=await p.evaluate(()=>navigator.clipboard.readText());
 ok('航空のときは CW（課金重量）を添える',/CW（課金重量）：[\d,.]+ kg/.test(clip)&&!/R\/T/.test(clip),clip);
 // 複数パターン
 await p.evaluate(()=>{window.prompt=()=> 'B案';addPackingPattern();});await p.waitForTimeout(300);
 await p.evaluate(()=>{addPackingRow();const tr=document.querySelector('#cargoDetailBody tr');const set=(sel,v)=>{const e=tr.querySelector(sel);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};set('.cd-pkg input','木箱');set('.cd-qty input',1);const d=[...tr.querySelectorAll('.cd-dim input')];[100,100,100].forEach((v,k)=>{d[k].value=v;d[k].dispatchEvent(new Event('input',{bubbles:true}));});set('.cd-kg input',50);});await p.waitForTimeout(300);
 ok('パターンが 2 つ以上になると「全パターンをコピー」が出る',(await menuLabels()).some(l=>/全パターンをコピー/.test(l)));
 await menuClick(/テキストでコピー/);
 clip=await p.evaluate(()=>navigator.clipboard.readText());
 ok('複数パターンのときは「■パターン名」を付け、編集中のパターンだけをコピー',clip.includes('■B案')&&clip.includes('・木箱')&&!clip.includes('カートン'),clip);
 await menuClick(/全パターンをコピー/);
 clip=await p.evaluate(()=>navigator.clipboard.readText());
 ok('「全パターンをコピー」はすべてのパターンを順に並べる',clip.includes('■B案')&&clip.includes('・木箱')&&clip.includes('カートン')&&/■パターン1/.test(clip),clip);
 // サイズ不明
 await p.evaluate(()=>{const c=document.getElementById('cond-cargo-unknown');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));const n=document.getElementById('cond-cargo-unknown-note');n.value='20FT×1本相当';});
 await p.evaluate(()=>copyCargoText('active'));await p.waitForTimeout(250);
 clip=await p.evaluate(()=>navigator.clipboard.readText());
 ok('サイズ・重量が不明のときは（表の欄は隠れるため関数から）、その旨と補足だけ',clip.includes('サイズ・重量：不明（引き合い時点では未確定）　20FT×1本相当')&&!clip.includes('カートン'),clip);
 // 空
 await p.evaluate(()=>{const c=document.getElementById('cond-cargo-unknown');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));});
 const empty=await p.evaluate(()=>{window.__t=[];const o=window.quoteShowToast;window.quoteShowToast=(m,t)=>{window.__t.push(m)};const was=window.getCargoCopyText;window.getCargoCopyText=()=>'';copyCargoText('active');window.getCargoCopyText=was;window.quoteShowToast=o;return window.__t;});
 ok('コピーする内容が無いときは案内を出す',empty.length===1&&/コピーできる物量情報がありません/.test(empty[0]),empty);
 ok('JS エラーなし',!errs.length,errs);
 await b.close();srv.close();
})();

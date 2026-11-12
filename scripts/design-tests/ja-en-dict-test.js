// 英訳辞書（日本語の品名・リマークを辞書で英語に）：変換の規則・御見積書の英語出力・未訳の検出・辞書の登録画面・出力前の確認。
//   node scripts/design-tests/ja-en-dict-test.js / THEME=1 …
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(f)]||'application/octet-stream'});r.end(fs.readFileSync(f));});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1300,height:900},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 const T=s=>p.evaluate(s=>jeTranslateEx(s),s);
 // ---- 変換の規則 ----
 ok('辞書にある語は英語になる',(await T('海上運賃')).text==='Ocean Freight');
 ok('語句を組み合わせて訳せる（括弧・数字はそのまま）',(await T('輸入通関料（20GP）')).text==='Import Customs Clearance Fee(20GP)'||(await T('輸入通関料（20GP）')).text==='Import Customs Clearance Fee (20GP)',await T('輸入通関料（20GP）'));
 ok('・でつないだ語句も訳せる',(await T('書類作成料・D/O料')).text==='Documentation Fee/D/O Fee',await T('書類作成料・D/O料'));
 ok('辞書にない語が混じる文は、半端に混ぜず日本語のまま・未訳に控える',await p.evaluate(()=>{const r=jeTranslateEx('謎の費用');return r.text==='謎の費用'&&r.missing.join()==='謎の費用';}));
 ok('英数字だけの文は触らない',await p.evaluate(()=>{const r=jeTranslateEx('THC 20GP USD100');return r.text==='THC 20GP USD100'&&r.missing.length===0;}));
 const mixed=await p.evaluate(()=>jeTranslateEx('別途ご相談ください。\n謎の文章です。\n・実費精算となります。'));
 ok('複数行：訳せる行は英語・訳せない行は日本語のまま・箇条書きの印は残る',mixed.text==='Please consult us separately.\n謎の文章です。\n- To be charged at actual cost.'&&mixed.missing.join()==='謎の文章です',mixed);
 ok('文の末尾の句点は英語のピリオドになる',(await T('別途ご相談ください。')).text==='Please consult us separately.');
 // ---- 見積に入れて、御見積書の英語出力 ----
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).first();
 await f('nm').fill('海上運賃');await f('sv').fill('A海運');await f('un').fill("40'GP");await f('pq').fill('1');await f('pp').fill('1000');await f('mk').fill('100');await f('mk').blur();
 await p.waitForTimeout(400);
 await p.evaluate(()=>{document.getElementById('qf-customer').value='株式会社サンプル';document.getElementById('qf-person').value='山田';
   const r=document.getElementById('remarkTextarea');r.value='別途ご相談ください。\n謎の注意書きです。';r.dispatchEvent(new Event('input',{bubbles:true}));});
 const doc=en=>p.evaluate(en=>{localStorage.setItem('quoteDocLangEn_v1',en?'1':'0');localStorage.setItem('quoteDocIncoDiagram_v1','0');document.getElementById('fxmock')?.remove();const d=document.createElement('div');d.id='fxmock';d.innerHTML=buildQuoteDocHTML();document.body.appendChild(d);const t=d.textContent;d.remove();return t;},en);
 let t=await doc(false);
 ok('日本語出力は従来どおり（辞書は使わない）',t.includes('海上運賃')&&t.includes('謎の注意書きです。'));
 t=await doc(true);
 ok('英語出力：品名が辞書で英語になる',t.includes('Ocean Freight')&&!t.includes('海上運賃'),t.slice(0,300));
 ok('英語出力：リマークの訳せる文は英語・訳せない文は日本語のまま',t.includes('Please consult us separately.')&&t.includes('謎の注意書きです。'));
 const miss=await p.evaluate(()=>jeMissing());
 ok('訳せなかった文が未訳として控えられる',miss.join()==='謎の注意書きです',miss);
 // ---- 辞書の登録（ログインなし＝この端末）----
 await p.evaluate(()=>jeAdd('謎の注意書きです','This is a note.'));
 t=await doc(true);
 ok('辞書に登録すると、次の出力から英語になる',t.includes('This is a note.')&&!t.includes('謎の注意書き'),t.slice(-400));
 ok('登録はこの端末の localStorage にも残る',await p.evaluate(()=>JSON.parse(localStorage.getItem('jeDict_v1')||'[]').some(r=>r.en==='This is a note.')));
 ok('登録した辞書は内蔵より優先される',await p.evaluate(async()=>{await jeAdd('海上運賃','Sea Freight');const r=jeTranslateEx('海上運賃').text;await jeRemove('海上運賃');return r==='Sea Freight'&&jeTranslateEx('海上運賃').text==='Ocean Freight';}));
 // マスターの英語品名が最優先
 ok('品名マスターの「英語品名」があれば、辞書より優先される',await p.evaluate(()=>{const orig=window.mdGetCanon;window.mdGetCanon=(f,v)=>f==='nm'&&v==='海上運賃'?{details:{enName:'OCEAN F.'}}:null;localStorage.setItem('quoteDocLangEn_v1','1');const d=document.createElement('div');d.innerHTML=buildQuoteDocHTML();const r=d.textContent.includes('OCEAN F.');window.mdGetCanon=orig;return r;}));
 // ---- 出力前の確認・辞書の画面 ----
 await p.evaluate(()=>{jeRemove('謎の注意書きです');localStorage.setItem('quoteDocLangEn_v1','1');});
 const scan=await p.evaluate(()=>jeScanCurrent());
 ok('いまの見積の未訳を集められる（どこにあるかつき）',scan.length===1&&scan[0].ja==='謎の注意書きです'&&scan[0].where.includes('全体リマーク'),scan);
 await p.evaluate(()=>jeOpenDialog());await p.waitForTimeout(500);
 ok('英訳辞書の画面に、未訳の文と英語の入力欄が出る',await p.evaluate(()=>!!document.querySelector('#jeModal .je-en[data-ja="謎の注意書きです"]')));
 await p.fill('#jeModal .je-en[data-ja="謎の注意書きです"]','Please note.');await p.keyboard.press('Enter');await p.waitForTimeout(500);
 ok('画面から登録すると、未訳の一覧から消え、登録した辞書に載る',await p.evaluate(()=>!document.querySelector('#jeModal .je-en[data-ja="謎の注意書きです"]')&&document.querySelector('#jeModal').textContent.includes('Please note.')));
 await p.fill('#jeModal .je-new-ja','特別料金');await p.fill('#jeModal .je-new-en','Special Charge');await p.click('#jeModal [data-je="addnew"]');await p.waitForTimeout(400);
 ok('自由に語句を追加できる',await p.evaluate(()=>jeTranslateEx('特別料金').text==='Special Charge'));
 await p.click('#jeModal [data-je="del"][data-ja="特別料金"]');await p.waitForTimeout(400);
 ok('削除できる',await p.evaluate(()=>jeTranslateEx('特別料金').text==='特別料金'));
 await p.keyboard.press('Escape');await p.waitForTimeout(200);
 ok('Esc で閉じる',await p.evaluate(()=>!document.getElementById('jeModal')));
 // 出力前の確認ガイドに、未訳が出る（英語出力が ON のときだけ）
 await p.evaluate(async()=>{await jeRemove('謎の注意書きです');localStorage.setItem('quoteDocLangEn_v1','1');preOutputValidationGate('テスト',()=>{});});await p.waitForTimeout(300);
 ok('出力前の確認：英語出力で英語にできていない文があると知らせる',await p.evaluate(()=>/英語にできていない文が 1 件/.test((document.getElementById('pvWarnGuide')||{textContent:''}).textContent)),await p.evaluate(()=>(document.getElementById('pvWarnGuide')||{textContent:'(なし)'}).textContent.replace(/\s+/g,' ')));
 await p.evaluate(()=>{const g=document.getElementById('pvWarnGuide');g&&g.remove();localStorage.setItem('quoteDocLangEn_v1','0');preOutputValidationGate('テスト',()=>{});});await p.waitForTimeout(300);
 ok('出力前の確認：日本語出力のときは知らせない',await p.evaluate(()=>!/英語にできていない/.test((document.getElementById('pvWarnGuide')||{textContent:''}).textContent)));
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

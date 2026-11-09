// 行ごとの「表示条件」（if 構文）：数量の範囲・総個数・コンテナ本数・輸送モード・貿易条件が条件に合うときだけ、行が客先向けの出力・合計に含まれる。
//   node scripts/design-tests/row-cond-test.js            （THEME=1 で Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const out=[];




const run=async(p)=>{
 const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};
 const wait=ms=>p.waitForTimeout(ms);
 const parse=t=>p.evaluate(t=>window.parseQuoteEmail(t),t);
 const BASE="海上運賃 1 40'GP × 1,680 USD ＝ 1,680 USD ※Zero Freight\nTHC 1 40FT × 20,000 JPY ＝ 20,000 JPY\n";

 // ===== 解析（パーサー）=====
 let r=await parse(BASE);
 ok('行末の「※備考」は従来どおり明細の備考（リマーク候補にはしない）',r.entries.filter(e=>e._kind==='item')[0].note==='Zero Freight'&&r.remarks.length===0,r.remarks);
 r=await parse(BASE+"※ フリータイムは 3 日間です\n");
 ok('明細の直後の「※」行は、その明細のリマーク（候補）になる',r.remarks.length===1&&r.remarks[0].itemIdx===1&&r.remarks[0].text==='フリータイムは 3 日間です',r.remarks);
 r=await parse(BASE+"\n※ 運賃は変動する場合があります\n※ 有効期限は発行から14日間\n");
 ok('空行をはさんだ「※」行は、全体リマーク（itemIdx なし）',r.remarks.length===2&&r.remarks.every(x=>x.itemIdx===null),r.remarks);
 r=await parse(BASE+"\n【リマーク】\n・有効期限は発行から14日間です\nTHC：3日間のフリータイム含む\n・運賃は変動します\n\n【作業範囲】\n集荷から\n");
 ok('【リマーク】の下の行が候補になり、「品名：注記」はその明細に付く',r.remarks.length===3&&r.remarks[0].itemIdx===null&&r.remarks[1].itemIdx===1&&r.remarks[1].text==='3日間のフリータイム含む'&&r.remarks[2].itemIdx===null,r.remarks);
 ok('【作業範囲】以降はリマーク候補にしない（ブロックは次の見出しで終わる）',!r.remarks.some(x=>/集荷/.test(x.text)),r.remarks);
 r=await parse(BASE+"\n※ 海上運賃・サーチャージは外貨建て仕入・JPY建て請求のため、為替レートにより請求金額が変動します。\n※ 「〜」で幅を示した項目を含むため、合計も下限〜上限の幅で表示しています。\n※ 本物の注記\n");
 ok('本アプリが自動で付ける注記（為替・幅）は取り込まない',r.remarks.length===1&&r.remarks[0].text==='本物の注記',r.remarks);
 r=await parse(BASE+"\n【リマーク】\n・同じ注記\n・同じ注記\n");
 ok('同じ文の重複は 1 件にする',r.remarks.length===1,r.remarks);

 // ===== 確認画面 =====
 const TEXT=BASE+"\n【リマーク】\n・有効期限は発行から14日間です\nTHC：3日間のフリータイム含む\n・運賃は変動します\n";
 await p.evaluate(t=>{window.openEmailImport();document.getElementById('eiText').value=t;window.eiParse();},TEXT);await wait(400);
 const ui=await p.evaluate(()=>{const rs=[...document.querySelectorAll('#eiReviewWrap .ei-remarks tbody tr')].map(tr=>({on:tr.querySelector('.ei-rem-chk').checked,to:tr.querySelector('.ei-rem-to').value,toTxt:tr.querySelector('.ei-rem-to').selectedOptions[0].textContent,text:tr.querySelector('.ei-rem-text').value}));return {rs,opts:[...document.querySelector('#eiReviewWrap .ei-rem-to').options].map(o=>o.textContent)};});
 ok('確認画面に「リマーク候補」が 3 件並び、既定はすべてチェック済み',ui.rs.length===3&&ui.rs.every(x=>x.on),ui);
 ok('付ける先は、全体は「全体リマーク」、「THC：…」は THC の明細（2 番目）',ui.rs[0].to==='g'&&ui.rs[1].to==='1'&&/THC/.test(ui.rs[1].toTxt)&&ui.rs[2].to==='g',ui.rs);
 ok('付ける先の選択肢は「全体リマーク」と各明細',ui.opts.length===3&&/全体/.test(ui.opts[0])&&/海上運賃/.test(ui.opts[1]),ui.opts);
 if(process.env.SHOT){await p.screenshot({path:process.env.SHOT});}

 // ===== 現在の見積へ挿入 =====
 await p.evaluate(()=>{document.getElementById('remarkTextarea').value='既存の一文';});
 // 1 件目（有効期限）の付け先を、1 番目の明細（海上運賃）に変える／3 件目の文を直す
 await p.evaluate(()=>{const trs=document.querySelectorAll('#eiReviewWrap .ei-remarks tbody tr');trs[0].querySelector('.ei-rem-to').value='0';trs[2].querySelector('.ei-rem-text').value='運賃は船社の改定で変動します';});
 await p.evaluate(()=>window.eiInsertRows());await wait(900);
 const after=await p.evaluate(()=>({g:document.getElementById('remarkTextarea').value,notes:[...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="nt"]')].map(e=>e.value),names:[...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="nm"]')].map(e=>e.value)}));
 ok('全体リマークは「全体リマーク」欄へ追記される（既存の文は残る・直した文が入る）',after.g==='既存の一文\n運賃は船社の改定で変動します',after.g);
 const iO=after.names.indexOf('海上運賃'),iT=after.names.indexOf('THC');
 ok('明細に付けたリマークは、その明細の備考へ追記される（元の備考と「 / 」でつなぐ）',after.notes[iO]==='Zero Freight / 有効期限は発行から14日間です'&&after.notes[iT]==='3日間のフリータイム含む',{after});
 // 同じ文は重ねない
 await p.evaluate(t=>{window.openEmailImport();document.getElementById('eiText').value=t;window.eiParse();},"両方 1 式 × 100 JPY ＝ 100 JPY\n\n【リマーク】\n・運賃は船社の改定で変動します\n・新しい注記\n");await wait(300);
 await p.evaluate(()=>window.eiInsertRows());await wait(700);
 ok('すでに入っている同じ文は全体リマークに重ねず、新しい文だけ追記される',await p.evaluate(()=>document.getElementById('remarkTextarea').value==='既存の一文\n運賃は船社の改定で変動します\n新しい注記'),await p.evaluate(()=>document.getElementById('remarkTextarea').value));
 ok('入力の変更として通知される（全体リマークの文字数表示が更新される）',await p.evaluate(()=>/文字/.test(document.getElementById('remarkChar').textContent)&&!/^0文字/.test(document.getElementById('remarkChar').textContent)),await p.evaluate(()=>document.getElementById('remarkChar').textContent));

 // ===== 付け先の明細を外したとき =====
 await p.evaluate(t=>{window.openEmailImport();document.getElementById('eiText').value=t;window.eiParse();},TEXT);await wait(300);
 await p.evaluate(()=>{document.getElementById('remarkTextarea').value='';const chk=[...document.querySelectorAll('#eiReviewWrap .ei-table .ei-chk')];chk[1].checked=false;});   // THC の行を外す
 await p.evaluate(()=>window.eiInsertRows());await wait(700);
 ok('付け先の明細を外した場合、そのリマークは「品名：注記」として全体リマークへ回る',await p.evaluate(()=>/THC：3日間のフリータイム含む/.test(document.getElementById('remarkTextarea').value)),await p.evaluate(()=>document.getElementById('remarkTextarea').value));

 // ===== リマークだけ =====
 await p.evaluate(()=>{document.getElementById('remarkTextarea').value='';});
 await p.evaluate(()=>{window.openEmailImport();document.getElementById('eiText').value='【リマーク】\n・単独の注記 A\n・単独の注記 B\n';window.eiParse();});await wait(300);
 ok('明細が無くリマークだけの文でも、リマーク候補が出る',await p.evaluate(()=>document.querySelectorAll('#eiReviewWrap .ei-remarks tbody tr').length===2&&!document.getElementById('eiActions').hidden),null);
 await p.evaluate(()=>window.eiInsertRows());await wait(500);
 ok('リマークだけでも挿入できる（行は増えない）',await p.evaluate(()=>document.getElementById('remarkTextarea').value==='単独の注記 A\n単独の注記 B'),await p.evaluate(()=>document.getElementById('remarkTextarea').value));
 // チェックを外したリマークは入らない
 await p.evaluate(()=>{document.getElementById('remarkTextarea').value='';window.openEmailImport();document.getElementById('eiText').value='【リマーク】\n・入れる\n・入れない\n';window.eiParse();});await wait(300);
 await p.evaluate(()=>{document.querySelectorAll('#eiReviewWrap .ei-rem-chk')[1].checked=false;window.eiInsertRows();});await wait(500);
 ok('チェックを外したリマークは入らない',await p.evaluate(()=>document.getElementById('remarkTextarea').value==='入れる'),await p.evaluate(()=>document.getElementById('remarkTextarea').value));

 // ===== 新規案件として展開 =====
 await p.evaluate(t=>{window.openEmailImport();document.getElementById('eiText').value=t;window.eiParse();},TEXT);await wait(300);
 await p.evaluate(()=>window.eiApplyAsNew());await wait(1200);
 const nw=await p.evaluate(()=>({g:document.getElementById('remarkTextarea').value,notes:[...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="nt"]')].map(e=>e.value)}));
 ok('新規案件として展開しても、全体リマークと明細の備考が入る',nw.g==='有効期限は発行から14日間です\n運賃は変動します'&&nw.notes.includes('3日間のフリータイム含む'),nw);
 const saved=await p.evaluate(()=>gatherAllData());
 ok('保存データにも全体リマークが入る',/有効期限は発行から14日間です/.test(JSON.stringify(saved.fields)),Object.keys(saved.fields).filter(k=>/remark/i.test(k)));

 // ===== AI 整形用プロンプト =====
 const prompt=await p.evaluate(async()=>{let t='';Object.defineProperty(navigator,'clipboard',{value:{writeText:x=>{t=x;return Promise.resolve();}},configurable:true});window.eiCopyAiPrompt();await new Promise(r=>setTimeout(r,200));return t;});
 ok('AI 整形用プロンプトに「リマーク」の書き方（【リマーク】・「品名：注記」・行末の※）が入っている',/【リマーク】/.test(prompt)&&/品名：注記/.test(prompt)&&/### 5\. リマーク/.test(prompt)&&/### 8\. 任意/.test(prompt),prompt.slice(0,80));
 const sec5=(prompt.split('### 5. リマーク')[1]||'').split('### 6.')[0];
 const exText=(sec5.split('例：')[1]||'').trim();
 const pr=await parse(exText);
 ok('プロンプトの例そのものを解析すると、明細 2 件・リマーク 3 件（うち 1 件は THC の明細へ）になる',pr.entries.filter(e=>e._kind==='item').length===2&&pr.remarks.length===3&&pr.remarks.filter(x=>x.itemIdx===1).length===1&&pr.entries.filter(e=>e._kind==='item')[0].note==='Zero Freight',{n:pr.entries.length,r:pr.remarks});
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

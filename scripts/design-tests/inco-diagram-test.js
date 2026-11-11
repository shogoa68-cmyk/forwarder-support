// 貿易条件の図解（インコタームズ）：御見積書・画面プレビュー。
//   node scripts/design-tests/inco-diagram-test.js / THEME=1 …
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1300,height:900},locale:'ja-JP'});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 const f=n=>p.locator(`#tableBody tr:not([data-virtual]):not([data-type]) [data-field="${n}"]`).first();
 await f('nm').fill('海上運賃');await f('sv').fill('A海運');await f('un').fill("40'GP");await f('pq').fill('1');await f('pp').fill('1000');await f('mk').fill('100');await f('mk').blur();
 await p.waitForTimeout(400);
 await p.evaluate(()=>{document.getElementById('qf-customer').value='株式会社サンプル';document.getElementById('qf-person').value='山田';});
 const build=(code,ret,en,on)=>p.evaluate(async([code,ret,en,on])=>{
  localStorage.setItem('quoteDocIncoDiagram_v1',on?'1':'0');
  localStorage.setItem('quoteDocLangEn_v1',en?'1':'0');
  const sel=document.getElementById('cond-incoterms');
  const opt=[...sel.options].find(o=>o.value.startsWith(code));
  sel.value=opt?opt.value:sel.value;sel.dispatchEvent(new Event('change',{bubbles:true}));
  const r=document.getElementById('cond-incoterms-ret');
  if(r){const o2=ret&&[...r.options].find(o=>o.value.startsWith(ret));r.value=o2?o2.value:'設定なし';}
  document.getElementById('fxmock')?.remove();
  const d=document.createElement('div');d.id='fxmock';d.style.cssText='position:fixed;left:0;top:0;width:794px;background:#fff;z-index:99999;padding:12px;';d.innerHTML=buildQuoteDocHTML();document.body.appendChild(d);
  const all=[...d.querySelectorAll('.incd')];
  const g=x=>x?{code:x.dataset.incd,segs:[...x.querySelectorAll('.incd-seg')].map(s=>s.className.includes('is-seller')?'S'+s.style.gridColumn:'B'+s.style.gridColumn),risk:x.querySelector('.incd-riskwrap')?.style.left||null,ins:x.querySelector('.incd-ins')?.style.gridColumn||null,sea:!!x.querySelector('.incd-sea'),labels:[...x.querySelectorAll('.incd-st')].map(s=>s.textContent),legend:x.querySelector('.incd-legend').textContent.replace(/\s+/g,' ').trim(),w:Math.round(x.getBoundingClientRect().width),h:Math.round(x.getBoundingClientRect().height)}:null;
  const meta=d.querySelector('.qd-meta');
  const incoRow=[...d.querySelectorAll('.qd-srow')].find(r=>r.querySelector('.qd-sk')&&/建値|Incoterms/.test(r.querySelector('.qd-sk').textContent));
  const first=all[0];
  const full=first?first.closest('.qd-srow'):null;
  return {n:all.length,d:all.map(g),inMeta:!!(first&&meta&&meta.contains(first)),fullRow:!!(full&&full.classList.contains('qd-srow-full')),afterInco:!!(incoRow&&full&&(function(){let e=incoRow;while(e){e=e.nextElementSibling;if(e===full)return true;}return false;})()),note:d.querySelector('.incd-note')?.textContent||'',wFull:first?Math.round(first.getBoundingClientRect().width):0,metaW:meta?Math.round(meta.getBoundingClientRect().width):0};
 },[code,ret,en,on]);
 let m=await build('CIF','',false,false);
 ok('既定（OFF）では図解は出ない',m.n===0,m);
 m=await build('CIF','',false,true);
 ok('ON：CIF の図解が 1 つ・貿易条件の行の直下に全幅で出る',m.n===1&&m.d[0].code==='CIF'&&m.inMeta&&m.fullRow&&m.afterInco&&m.wFull>=m.metaW-30,m);
 ok('CIF：売主は 1〜6 工程・買主は 7〜10 工程',JSON.stringify(m.d[0].segs)===JSON.stringify(['S1 / 7','B7 / 11']),m.d[0].segs);
 ok('CIF：リスクの移転は 5 工程の終わり（50%）・保険は 3〜6 工程・海上専用の印あり',m.d[0].risk==='50%'&&m.d[0].ins==='3 / 7'&&m.d[0].sea,m.d[0]);
 ok('10 工程のラベルが並ぶ（検品・梱包…荷卸）',m.d[0].labels.length===10&&m.d[0].labels[0]==='検品・梱包'&&m.d[0].labels[9]==='荷卸',m.d[0].labels);
 ok('凡例：売主・買主・リスクの移転・保険',/売主.*買主.*リスクの移転.*保険/.test(m.d[0].legend),m.d[0].legend);
 ok('注記（Incoterms® 2020 の目安）が付く',/Incoterms® 2020/.test(m.note),m.note);
 await p.screenshot({path:OUT+'/inco-cif.png',clip:{x:0,y:0,width:820,height:520}});
 const exp={EXW:['S1 / 2','B2 / 11'],FCA:['S1 / 5','B5 / 11'],FAS:['S1 / 5','B5 / 11'],FOB:['S1 / 6','B6 / 11'],CFR:['S1 / 7','B7 / 11'],CPT:['S1 / 8','B8 / 11'],CIP:['S1 / 8','B8 / 11'],
   DAP:['S1 / 8','B8 / 9','S9 / 10','B10 / 11'],DPU:['S1 / 8','B8 / 9','S9 / 11'],DDP:['S1 / 10','B10 / 11']};
 const riskExp={EXW:'10%',FCA:'40%',FAS:'40%',FOB:'50%',CFR:'50%',CPT:'40%',CIP:'40%',DAP:'90%',DPU:'100%',DDP:'90%'};
 const seaExp={FAS:1,FOB:1,CFR:1};
 for(const c of Object.keys(exp)){const r=await build(c,'',false,true);const x=r.d[0]||{};
   ok(c+'：売主／買主の帯・リスクの位置・海上専用の印・保険（CIP のみ 3〜7）',JSON.stringify(x.segs)===JSON.stringify(exp[c])&&x.risk===riskExp[c]&&!!x.sea===!!seaExp[c]&&(c==='CIP'?x.ins==='3 / 8':!x.ins),x);}
 m=await build('CIF','',true,true);
 ok('英語出力：ラベルが英語（Seller／Buyer・Inspection / Packing）',m.d[0].labels[0]==='Inspection / Packing'&&/Seller.*Buyer.*Transfer of risk.*Insurance/.test(m.d[0].legend)&&/Indicative allocation/.test(m.note),m);
 m=await build('設定なし','',false,true);
 ok('貿易条件が未設定なら図解は出ない',m.n===0,m);
 await p.evaluate(()=>{window.setDirection&&setDirection('export_import');});await p.waitForTimeout(300);
 m=await build('FOB','CIF',false,true);
 ok('往復案件で往路 FOB・復路 CIF：図解が 2 つ（往路→復路の順）',m.n===2&&m.d[0].code==='FOB'&&m.d[1].code==='CIF',m);
 m=await build('FOB','FOB',false,true);
 ok('往復でも条件が同じなら 1 つだけ',m.n===1,m);
 await p.evaluate(()=>{window.setDirection&&setDirection('export');});await p.waitForTimeout(300);
 // 御見積書の設定パネル
 await p.evaluate(()=>{localStorage.setItem('quoteDocIncoDiagram_v1','0');});
 await p.evaluate(()=>{const s=document.getElementById('cond-incoterms');const o=[...s.options].find(o=>o.value.startsWith('CIF'));s.value=o.value;s.dispatchEvent(new Event('change',{bubbles:true}));});
 await p.evaluate(()=>{(window.openQuoteDoc||window.showQuoteDoc)&&(window.openQuoteDoc||window.showQuoteDoc)();});await p.waitForTimeout(700);
 const t1=await p.evaluate(()=>({has:!!document.getElementById('qdIncoDiagram'),chk:document.getElementById('qdIncoDiagram')?.checked,n:document.querySelectorAll('#qdPreview .incd').length}));
 ok('設定パネルに「貿易条件の図解」のスイッチ（既定 OFF・図解なし）',t1.has&&t1.chk===false&&t1.n===0,t1);
 await p.evaluate(()=>{const c=document.getElementById('qdIncoDiagram');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));});await p.waitForTimeout(400);
 const t2=await p.evaluate(()=>({n:document.querySelectorAll('#qdPreview .incd').length,saved:localStorage.getItem('quoteDocIncoDiagram_v1')}));
 ok('スイッチを入れると、プレビューに図解が出て、設定が保存される',t2.n===1&&t2.saved==='1',t2);
 await p.screenshot({path:OUT+'/inco-panel.png'});
 await p.evaluate(()=>{const c=document.getElementById('qdIncoDiagram');c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));});await p.waitForTimeout(300);
 const t3=await p.evaluate(()=>document.querySelectorAll('#qdPreview .incd').length);
 ok('切ると図解が消える',t3===0,t3);
 await p.evaluate(()=>{document.getElementById('fxmock')?.remove();document.getElementById('qdClose')?.click();});
 // 画面プレビュー
 await p.evaluate(()=>{openPreview();if(typeof pvWarnGuideSkip==='function'&&!document.querySelector('#previewOverlay.open'))pvWarnGuideSkip();});await p.waitForTimeout(700);
 const v1=await p.evaluate(()=>({tg:!!document.getElementById('pvIncoDiagram'),n:document.querySelectorAll('#pvCondBox .incd').length}));
 ok('画面プレビュー：切替チェックあり・OFF のときは図解なし',v1.tg&&v1.n===0,v1);
 await p.evaluate(()=>{const c=document.getElementById('pvIncoDiagram');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));});await p.waitForTimeout(700);
 const v2=await p.evaluate(()=>({n:document.querySelectorAll('#pvCondBox .incd').length,chk:document.getElementById('pvIncoDiagram')?.checked,saved:localStorage.getItem('quoteDocIncoDiagram_v1')}));
 ok('画面プレビュー：チェックで図解が出る（御見積書と同じ設定を共有）',v2.n===1&&v2.chk&&v2.saved==='1',v2);
 await p.screenshot({path:OUT+'/inco-preview.png'});
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
})();

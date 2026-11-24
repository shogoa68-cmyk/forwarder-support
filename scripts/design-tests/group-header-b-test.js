// サブコン見出し・パターン見出しの整理（Design 43・案B「1 段＋［⋯］」・新画面）
//   node scripts/design-tests/group-header-b-test.js        （既定 Industry／THEME=classic・quiet で他テーマ）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'../..');
const THEME=process.env.THEME||'';
const out=[];
const ok=(n,c,x)=>{const l=(c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x));out.push(l);console.log(l);};

(async()=>{
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});r.end(fs.readFileSync(f));});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const open=async(v2)=>{
  const ctx=await b.newContext({viewport:{width:1440,height:900},locale:'ja-JP'});
  await ctx.addInitScript(()=>{try{localStorage.setItem('fbFabHintDone_v1','1');}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();p._errs=[];p.on('pageerror',e=>p._errs.push(e.message));
  await p.goto(`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${v2?'v2':'v1'}${THEME?'&theme='+THEME:''}`);
  await p.waitForTimeout(800);
  await p.evaluate(()=>window.qpNewQuote());await p.waitForTimeout(600);
  const rows=[['海上運賃','A海運','FCL案',2,'USD',1200,100],['THC','A海運','FCL案',2,'JPY',45000,5000],['LCL運賃','A海運','LCL案',3,'USD',60,10],['通関料','B通関','',1,'JPY',11800,3000]];
  for(let i=0;i<rows.length;i++){ if(i>0){await p.evaluate(()=>window.addRow());await p.waitForTimeout(60);}
   await p.evaluate(([i,r])=>{const tr=[...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')][i];const f=(n,v)=>{const e=tr.querySelector(`[data-field="${n}"]`);if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};f('nm',r[0]);f('sv',r[1]);f('pt',r[2]);f('un','20GP');f('pq',r[3]);f('pc',r[4]);f('bc',r[4]);f('pp',r[5]);f('mk',r[6]);},[i,rows[i]]);}
  await p.evaluate(()=>window.renderSubconGroups&&window.renderSubconGroups());
  if(v2) await p.evaluate(()=>window.editorV2Go(4,true));
  await p.waitForTimeout(800);
  await p.evaluate(()=>{const h=document.querySelector('#tableBody tr.subcon-group-header');h&&h.scrollIntoView({block:'center'});});
  await p.waitForTimeout(200);
  return {p,ctx};
 };
 const H='#tableBody tr.subcon-group-header[data-sv-label="A海運"]';
 const vis=(p,sel)=>p.evaluate(s=>{const e=document.querySelector(s);if(!e)return false;const c=getComputedStyle(e);return c.display!=='none'&&c.visibility!=='hidden'&&!e.hidden&&e.getClientRects().length>0;},sel);

 /* ---------- 新画面 ---------- */
 {
  const {p,ctx}=await open(true);
  const hidden=await p.evaluate(h=>['.sv-hdr-dup','.subcon-group-excl','.subcon-group-sort-btn','.subcon-group-sum','.subcon-group-cm','.hdr-notes'].map(s=>{const e=document.querySelector(h+' '+s);return [s,e?getComputedStyle(e).display:'(なし)'];}),H);
  ok('見出しから外したもの（除外・カテゴリ順・元の金額・注記の欄）は隠れている',hidden.every(x=>x[1]==='none'),hidden);
  ok('［＋ 明細を追加］と［⋯］は出ている',await vis(p,H+' .subcon-group-add-btn')&&await vis(p,H+' .gb-more'));
  const m=await p.evaluate(h=>{const t=s=>(document.querySelector(h+' '+s)||{}).textContent||'';return {s:t('.gb-m-s .gb-v'),c:t('.gb-m-c .gb-v'),pc:t('.gb-m-p .gb-v'),os:t('.subcon-group-sum'),oc:t('.subcon-group-cm')};},H);
  ok('金額は 売 → 仕入 → 粗利（元の値と同じ）',m.s&&m.os.startsWith(m.s.replace('※',''))&&m.oc.includes(m.c)&&m.oc.includes(m.pc),m);
  const pos=await p.evaluate(h=>{const r=s=>{const e=document.querySelector(h+' '+s);return e?e.getBoundingClientRect():null;};return {lab:r('.subcon-group-label'),mon:r('.gb-money'),add:r('.subcon-group-add-btn'),more:r('.gb-more')};},H);
  ok('並び：名前 → 金額 → ［＋ 明細を追加］ → ［⋯］（1 段）',pos.lab.right<=pos.mon.left&&pos.mon.right<=pos.add.left+1&&pos.add.right<=pos.more.left+1&&Math.abs(pos.lab.top+pos.lab.height/2-(pos.more.top+pos.more.height/2))<8,pos);
  ok('注記が空のときは 📝 の印を出さない',!(await vis(p,H+' .gb-note-mark')));

  // ［⋯］メニュー
  await p.click(H+' .gb-more');await p.waitForTimeout(200);
  let items=await p.$$eval('#gbMenu .gb-mi',a=>a.map(x=>x.textContent.trim()));
  ok('［⋯］の中：複製・パターンを追加・注記を書く・カテゴリ順に並べる・見積書から外す（未登録のサブコンは取り込み・詳細を出さない）',items.length===5&&/複製/.test(items[0])&&/パターンを追加/.test(items[1])&&/注記を書く/.test(items[2])&&/カテゴリ順/.test(items[3])&&/見積書から外す/.test(items[4]),items);
  ok('［⋯］は aria-expanded=true',await p.$eval(H+' .gb-more',e=>e.getAttribute('aria-expanded'))==='true');
  await p.keyboard.press('Escape');await p.waitForTimeout(150);
  ok('Esc でメニューが閉じる',await p.$eval('#gbMenu',e=>e.hidden));
  await p.click(H+' .gb-more');await p.waitForTimeout(150);
  await p.mouse.click(30,880);await p.waitForTimeout(150);
  ok('外側を押すとメニューが閉じる',await p.$eval('#gbMenu',e=>e.hidden));

  // 注記を書く
  await p.click(H+' .gb-more');await p.waitForTimeout(150);
  await p.evaluate(()=>[...document.querySelectorAll('#gbMenu .gb-mi')].find(b=>/注記を書く/.test(b.textContent)).click());await p.waitForTimeout(200);
  ok('「注記を書く」で注記の段が開き、入力欄に焦点',await vis(p,H+' .hdr-notes')&&await p.evaluate(h=>document.activeElement===document.querySelector(h+' .subcon-remark-input'),H));
  const nr=await p.evaluate(h=>{const a=document.querySelector(h+' .hdr-notes').getBoundingClientRect(),m=document.querySelector(h+' .gb-money').getBoundingClientRect();return {nt:a.top,mb:m.bottom};},H);
  ok('注記の段は見出しの下（金額と重ならない）',nr.nt>=nr.mb-1,nr);
  await p.keyboard.type('12/20 カット確定');await p.waitForTimeout(200);
  const rm=await p.evaluate(()=>window.getSubconRemarks&&window.getSubconRemarks());
  ok('入力した注記はサブコン別リマークとして保持',JSON.stringify(rm||{}).includes('12/20 カット確定'),rm);
  await p.click(H+' .gb-notes-close');await p.waitForTimeout(200);
  ok('［✕ 閉じる］で段が閉じ、📝 の印が出る',!(await vis(p,H+' .hdr-notes'))&&await vis(p,H+' .gb-note-mark'));
  await p.click(H+' .gb-note-mark');await p.waitForTimeout(200);
  ok('📝 を押すと段が開く',await vis(p,H+' .hdr-notes'));
  await p.evaluate(()=>window.renderSubconGroups());await p.waitForTimeout(400);
  ok('描き直しても注記の段は開いたまま',await vis(p,H+' .hdr-notes'));
  await p.click(H+' .gb-note-mark');await p.waitForTimeout(150);

  // 見積書から外す／戻す
  await p.click(H+' .gb-more');await p.waitForTimeout(150);
  await p.evaluate(()=>[...document.querySelectorAll('#gbMenu .gb-mi')].find(b=>/見積書から外す/.test(b.textContent)).click());await p.waitForTimeout(400);
  ok('「見積書から外す」で除外中（札・［見積書に戻す］が出て、［＋ 明細を追加］と 📝 は隠れる）',await p.$eval(H,e=>e.classList.contains('is-excluded'))&&await vis(p,H+' .gb-ex-tag')&&await vis(p,H+' .gb-restore')&&!(await vis(p,H+' .subcon-group-add-btn'))&&!(await vis(p,H+' .gb-note-mark')));
  ok('除外中は名前に取り消し線',await p.$eval(H+' .subcon-group-label',e=>getComputedStyle(e).textDecorationLine.includes('line-through')));
  await p.click(H+' .gb-more');await p.waitForTimeout(150);
  items=await p.$$eval('#gbMenu .gb-mi',a=>a.map(x=>x.textContent.trim()));
  ok('除外中のメニューは「見積書に戻す」',items.some(x=>/見積書に戻す/.test(x)),items);
  await p.keyboard.press('Escape');
  await p.click(H+' .gb-restore');await p.waitForTimeout(400);
  ok('［見積書に戻す］で元に戻る',!(await p.$eval(H,e=>e.classList.contains('is-excluded'))));

  // パターン見出し
  const PT='#tableBody tr.subcon-subgroup-header.is-pattern[data-pt-key="FCL案"]';
  // 外すと自動で折りたたまれるので、開いてからパターン見出しを見る
  if(await p.$eval(H,e=>e.classList.contains('is-collapsed'))){await p.click(H+' .subcon-group-toggle');await p.waitForTimeout(300);}
  const pm=await p.evaluate(s=>{const h=document.querySelector(s);return h?(h.querySelector('.gb-m-s .gb-v')||{}).textContent:'';},PT);
  ok('パターン見出しにも 売 の金額が出る',/¥/.test(pm||''),pm);
  ok('パターン見出しの元のボタン（✎・📋・除外・カテゴリ順）は隠れ、［⋯］がある',await p.evaluate(s=>{const h=document.querySelector(s);return ['.subcon-subgroup-rename','.subcon-subgroup-dup','.subcon-subgroup-excl','.subcon-group-sort-btn'].every(c=>getComputedStyle(h.querySelector(c)).display==='none');},PT)&&await vis(p,PT+' .gb-more'));
  await p.click(PT+' .gb-more');await p.waitForTimeout(150);
  items=await p.$$eval('#gbMenu .gb-mi',a=>a.map(x=>x.textContent.trim()));
  ok('パターンの［⋯］：注記を書く・パターン名を変更・複製・カテゴリ順・見積書から外す',['注記','パターン名','複製','カテゴリ順','見積書から外す'].every(w=>items.some(x=>x.includes(w))),items);
  await p.keyboard.press('Escape');
  ok('ページのエラーなし',p._errs.length===0,p._errs);
  await ctx.close();
 }

 /* ---------- 旧画面 ---------- */
 {
  const {p,ctx}=await open(false);
  ok('旧画面は従来どおり（［⋯］は出ず、除外ボタンが出る）',!(await vis(p,H+' .gb-more'))&&await vis(p,H+' .subcon-group-excl'));
  const ov=await p.evaluate(h=>{const n=document.querySelector(h+' .hdr-notes'),c=document.querySelector(h+' .subcon-group-sum');if(!n||!c)return null;const a=n.getBoundingClientRect(),d=c.getBoundingClientRect();return {nr:a.right,cl:d.left};},H);
  ok('旧画面：注記の欄が金額に重ならない',!ov||ov.nr<=ov.cl+1,ov);
  ok('旧画面：ページのエラーなし',p._errs.length===0,p._errs);
  await ctx.close();
 }
 await b.close();srv.close();
 const f=out.filter(l=>l.startsWith('FAIL')).length;
 console.log(f?`\n${f} FAIL`:`\nALL PASS (${out.length})`);
 process.exit(f?1:0);
})();

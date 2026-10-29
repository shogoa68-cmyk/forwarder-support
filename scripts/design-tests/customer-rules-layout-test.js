// 見積入力「管理番号入力」：お客様の取引ルールの帯は、お客様名・ご担当者の下（メモの左横）の左カラムに収まる。
//   node scripts/design-tests/customer-rules-layout-test.js           （現行）
//   THEME=1 node scripts/design-tests/customer-rules-layout-test.js   （Industry）
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
 const open=async(w,mode)=>{
  const ctx=await b.newContext({viewport:{width:w,height:900},locale:'ja-JP'});
  await ctx.addInitScript(m=>{try{localStorage.setItem('fwd.uiMode',m)}catch(e){}},mode);
  if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
  await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(900);
  await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
  // 取引ルール（架空）と、クラウドにログイン済みの状態
  await p.evaluate(()=>{
   window.cloudGetClient=()=>({});window.cloudCurrentUser=()=>({email:'s@example.com'});
   window.crLoad=async()=>{};
   window.crFor=()=>({otherContact:0,list:[
    {id:'1',level:'strict',body:'作業料請求書の決済：銀行送金手数料当方負担',contact:'',reason:'決済を一度で済ませたい。税務処理の都合。',created_by:'a@example.com',created_at:'2026-10-29T00:00:00Z'},
    {id:'2',level:'check',body:'立替請求書の決済：銀行送金手数料先方負担',contact:'',created_by:'a@example.com',created_at:'2026-10-29T00:00:00Z'}]});
   document.getElementById('qf-customer').value='フォーキャンス株式会社';
   return window.crRefreshBanner();
  });
  await p.waitForTimeout(500);
  return {ctx,p,errs};
 };
 const geo=()=>{const R=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {l:Math.round(r.left),r:Math.round(r.right),t:Math.round(r.top+scrollY),b:Math.round(r.bottom+scrollY),shown:e.offsetParent!==null};};
  return {ban:R('#crBanner'),person:R('#qf-person'),cust:R('#qf-customer'),memo:R('.quote-field-memo'),recv:R('#qf-received'),host:document.getElementById('crBanner').parentElement.classList.contains('has-cr')};};
 for(const [w,mode] of [[1732,'simple'],[1400,'simple'],[1732,'detail'],[1400,'detail']]){
  const {ctx,p,errs}=await open(w,mode);
  const g=await p.evaluate(geo);
  ok(`${w}px・${mode}：取引ルールの帯が出ている`,g.ban&&g.ban.shown&&g.host,g);
  if(mode==='detail'){
   ok(`${w}px・detail：帯はお客様名・ご担当者の下にあり、左カラムに収まる（メモの左横）`,g.ban.t>=g.person.b-2&&g.ban.l<=g.cust.l+2&&g.ban.r<=g.memo.l+2&&g.ban.r>g.cust.l+200,g);
   ok(`${w}px・detail：帯の高さの範囲が、メモの高さの範囲の中に収まる（メモの下へはみ出さない）`,g.ban.t>=g.memo.t&&g.ban.b<=g.memo.b+2,g);
   ok(`${w}px・detail：帯の下に「依頼受信日」などが続く`,g.recv&&g.recv.t>=g.ban.b-4,g);
  } else {
   ok(`${w}px・simple：メモが隠れている間は、帯はご担当者の下に全幅で出る（右が空くので）`,!g.memo.shown&&g.ban.t>=g.person.b-2&&g.ban.r-g.ban.l>=(w>1500?1000:600),g);
   await p.evaluate(()=>{const h=document.querySelector('#refBody');h.classList.add('tier-opt-open');});await p.waitForTimeout(300);
   const g3=await p.evaluate(geo);
   ok(`${w}px・simple：「詳細（任意）」を開いてメモが出ると、帯は左カラム（メモの左横）に収まる`,g3.memo.shown&&g3.ban.t>=g3.person.b-2&&g3.ban.r<=g3.memo.l+2&&g3.ban.t>=g3.memo.t&&g3.ban.b<=g3.memo.b+2,g3);
  }
  await p.evaluate(()=>{window.scrollTo(0,0);});
  await p.screenshot({path:`${OUT}/cr-layout-${mode}-${w}.png`,clip:{x:0,y:Math.max(0,g.cust.t-120),width:Math.min(w,1732),height:520}});
  // お客様名を消すと帯が消え、メモの高さも元に戻る
  await p.evaluate(()=>{document.getElementById('qf-customer').value='';return window.crRefreshBanner();});await p.waitForTimeout(300);
  const g2=await p.evaluate(geo);
  ok(`${w}px・${mode}：お客様名が空なら、帯もメモの拡張も消える`,!g2.ban.shown&&!g2.host,g2);
  ok(`${w}px・${mode}：JS エラーなし`,errs.length===0,errs);
  await ctx.close();
 }
 {
  const {ctx,p,errs}=await open(390,'simple');
  const g=await p.evaluate(geo);
  ok('スマホ幅：帯は 1 列の中で、ご担当者の下に全幅で出る',g.ban.shown&&g.ban.t>=g.person.b-2&&g.ban.r-g.ban.l>300,g);
  ok('スマホ幅：JS エラーなし',errs.length===0,errs);
  await ctx.close();
 }
 await b.close();srv.close();
})();

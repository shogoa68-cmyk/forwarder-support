// 「その他」メニュー内タブの画面幅の崩れ（2026-11）の回帰試験：
//  ①諸チャージの上部ボタンが狭い画面で 1 文字幅に潰れない ②追跡／フリータイムの番号欄が大画面で伸びすぎない
//  ③ファイリングルールが狭い画面で横にはみ出さない ④「データなし」の薄い文字が読める濃さ
//   node scripts/design-tests/tools-responsive-test.js            （現行）
//   THEME=1 node scripts/design-tests/tools-responsive-test.js    （Industry）
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const open=async(w,cat,sub)=>{
  const ctx=await b.newContext({viewport:{width:w,height:900},locale:'ja-JP'});
  await ctx.addInitScript(t=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:t,doc:t}))}catch(e){}},!!process.env.THEME);
  await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
  const p=await ctx.newPage();p.setDefaultTimeout(8000);
  await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);
  await p.evaluate(([c,s])=>{switchCategory(c,document.querySelector('.cat-btn[aria-controls="tab-'+({cost:'local-charges',vessel:'tracking',booking:'booking-tab'}[c])+'"]'));const bt=[...document.querySelectorAll('#sub-'+c+' .tab-btn')].find(x=>(x.getAttribute('onclick')||'').includes("'"+s+"'"));if(bt){bt.hidden=false;switchTab(s,bt);}},[cat,sub]);
  await p.waitForTimeout(500);return {ctx,p};
 };
 // ① 諸チャージ 360px
 let {ctx,p}=await open(360,'cost','local-charges');
 const lc=await p.evaluate(()=>[...document.querySelectorAll('.lc-topbar-right > *')].filter(e=>e.offsetParent).map(e=>({t:e.textContent.trim().slice(0,8),w:Math.round(e.getBoundingClientRect().width),h:Math.round(e.getBoundingClientRect().height)})));
 ok('諸チャージ 360px：上部のボタンが潰れない（幅 60px 以上・高さ 50px 以下）',lc.length>=4&&lc.every(e=>e.w>=60&&e.h<=50),lc);
 ok('諸チャージ 360px：横にはみ出さない',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const ec=await p.evaluate(()=>{const e=document.querySelector('.lc-empty');return e?getComputedStyle(e).color:null});
 ok('「該当するチャージがありません」の文字色が濃い',!ec||+ec.match(/\d+/g)[0]<=130,ec);
 await ctx.close();
 // ② 追跡の番号欄 1920px
 ({ctx,p}=await open(1920,'vessel','tracking'));
 const w=await p.evaluate(()=>Math.round(document.getElementById('ql-number').getBoundingClientRect().width));
 ok('追跡：番号欄が 1920px でも 640px 以下',w>0&&w<=641,w);
 await ctx.close();
 // ③ ファイリングルール 360 / 600px
 for(const W of [360,600]){
  ({ctx,p}=await open(W,'booking','filing'));
  const sw=await p.evaluate(()=>document.documentElement.scrollWidth);
  ok(`ファイリングルール ${W}px：横にはみ出さない`,sw<=W+1,sw);
  await ctx.close();
 }
 await b.close();srv.close();
})();

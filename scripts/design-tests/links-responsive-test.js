// 画面幅の点検（第4弾・リンク系画面）の回帰テスト。
//   node scripts/design-tests/links-responsive-test.js      （3 テーマ × 幅 360／900／1440）
// ①作業フォルダ：長いファイル名が 2 行に折り返して隣の行と重ならない（1 行＋「…」）
// ②BOOKMARK：未確認の ✓ が背景とのコントラスト 3:1 以上
// ③不具合報告・サイバーポート：白文字のボタン／チップが 4.5:1 以上
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
let fails=0;
const ok=(n,c,x)=>{if(!c)fails++;console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 // コントラスト比（文字色と、背景を重ねた実際の色）
 const CR=`(sel)=>{const el=document.querySelector(sel);if(!el)return null;
  const parse=s=>{const m=s.match(/rgba?\\(([^)]+)\\)/);const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};};
  const lin=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};const L=c=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
  let bg={r:255,g:255,b:255};const layers=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c.a>0){layers.push(c);if(c.a>=1)break;}}
  for(let i=layers.length-1;i>=0;i--){const t=layers[i];bg={r:t.r*t.a+bg.r*(1-t.a),g:t.g*t.a+bg.g*(1-t.a),b:t.b*t.a+bg.b*(1-t.a)};}
  const fg=parse(getComputedStyle(el).color);const a=L(fg),c=L(bg);return (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05);}`;
 for(const theme of ['industry','classic','quiet']){
  for(const w of [360,900,1440]){
   const ctx=await b.newContext({viewport:{width:w,height:900},locale:'ja-JP'});
   await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
   const p=await ctx.newPage();p.setDefaultTimeout(15000);
   await p.goto(`${base}?theme=${theme}`,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
   const tag=`[${theme} ${w}px] `;
   // ① 作業フォルダ
   await p.evaluate(()=>window.switchCategory('workfolder'));await p.waitForTimeout(400);
   const wf=await p.evaluate(()=>{
     const host=document.getElementById('wfMain')||document.getElementById('tab-workfolder');
     host.innerHTML='<div class="wf-list">'+['長い名前_'.repeat(30)+'.pdf','短い.txt','Booking_Confirmation_MSKU1234567_SHANGHAI_TOKYO_FINAL_v2.xlsx'].map(n=>'<div class="wf-row"><span class="wf-name"><span class="wf-ico">📄</span><span style="min-width:0"><b>'+n+'</b></span></span><span>2026/11/18</span><span>PDF</span><span>1 MB</span></div>').join('')+'</div>';
     return [...host.querySelectorAll('.wf-row')].map(r=>({h:r.offsetHeight,sh:r.scrollHeight,nameH:r.querySelector('.wf-name').offsetHeight}));
   });
   ok(tag+'作業フォルダ：長い名前でも行の高さに収まる（折り返して重ならない）',wf.every(r=>r.sh<=r.h+1&&r.nameH<=r.h),wf);
   // ② BOOKMARK ✓
   await p.evaluate(()=>window.switchCategory('bookmark'));await p.waitForTimeout(300);
   const bm=await p.evaluate(`(()=>{const w=document.getElementById('bmListWrap');w.innerHTML='<div class="bm-tile"><div class="bm-fpills"><a class="bm-pill"><span class="bm-verify bm-verify-0">✓</span></a></div></div>';return (${CR})('.bm-verify-0');})()`);
   ok(tag+'BOOKMARK：未確認の ✓ のコントラスト 3:1 以上（'+(bm&&bm.toFixed(2))+'）',bm>=3,bm);
   // ③ 白文字ボタン
   if(theme==='industry'){
    await p.evaluate(()=>window.switchCategory('bugreports'));await p.waitForTimeout(300);
    const fb=await p.evaluate(`(()=>{const h=document.getElementById('fbrBanner');const b=document.createElement('button');b.className='fbr-btn fbr-btn-primary';b.id='tBtn';b.textContent='質問';document.getElementById('tab-bugreports').appendChild(b);const c=document.createElement('button');c.className='fbr-chip is-on';c.id='tChip';c.textContent='これから';document.getElementById('tab-bugreports').appendChild(c);return [(${CR})('#tBtn'),(${CR})('#tChip')];})()`);
    ok(tag+'不具合報告：主ボタン・選択中チップの白文字 4.5:1 以上（'+fb.map(x=>x.toFixed(2)).join('／')+'）',fb.every(x=>x>=4.5),fb);
   }
   await ctx.close();
  }
 }
 await b.close();srv.close();
 console.log(fails?`\n${fails} 件失敗`:'\n全部 OK');process.exit(fails?1:0);
})();

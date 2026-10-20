const { chromium } = (()=>{try{return (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})()}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
(async()=>{
 const root=require('path').resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const mkRow=(sv,nm,pp)=>{const c=Array(30).fill('');c[0]=false;c[1]='ocean';c[2]=sv;c[4]=nm;c[5]='1';c[6]='shipment';c[7]='1';c[8]='JPY';c[9]='JPY';c[10]=String(pp);c[11]=String(pp+1000);c[13]='1000';c[14]='';return {_type:'data',cells:c};};
 const rows=[mkRow('X社','運賃A',10000),{_type:'remark',text:'Aのリマーク',internal:false},
   mkRow('Y社','運賃B',20000),{_type:'remark',text:'Bのリマーク1',internal:false},{_type:'remark',text:'B社内メモ',internal:true},
   mkRow('X社','運賃C',30000),
   {_type:'subtotal',label:'小計'},{_type:'remark',text:'孤立リマーク',internal:false}];
 const cases=[{id:'00000000-0000-4000-8000-000000000001',name:'テスト案件',status:'draft',customer:'C',person:'P',owner_email:'s@example.com',created_by:'s@example.com',updated_at:new Date().toISOString(),data:{fields:{},rows,_rowFormat:'v3-mixed-rows'}}];
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:1000},locale:'ja-JP'});
 await ctx.addInitScript(({cases})=>{
  const tbl=t=>t==='quote_presets'?cases:[];
  const mk=t=>{const st={one:false};const bb=new Proxy({},{get(_,k){
    if(k==='then')return(res,rej)=>Promise.resolve({data:st.one?(tbl(t)[0]||null):tbl(t),error:null}).then(res,rej);
    if(k==='single'||k==='maybeSingle')return()=>{st.one=true;return bb};
    return()=>bb;}});return bb;};
  const ch={on(){return ch},subscribe(cb){cb&&cb('SUBSCRIBED');return ch},track(){return Promise.resolve()},untrack(){return Promise.resolve()},presenceState(){return{}},unsubscribe(){return Promise.resolve()},send(){return Promise.resolve()}};
  const user={email:'s@example.com',user_metadata:{full_name:'S'}};
  const client={from:mk,rpc:()=>Promise.resolve({data:null,error:null}),channel:()=>ch,removeChannel(){},storage:{from:()=>({})},auth:{getSession:()=>Promise.resolve({data:{session:{user}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:()=>Promise.resolve({}),signInWithOAuth:()=>Promise.resolve({})}};
  window.supabase={createClient:()=>client};
 },{cases});
 if(process.env.THEME) await ctx.addInitScript(()=>{try{localStorage.setItem('forwarderTheme_v1',JSON.stringify({site:true,doc:true}))}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(700);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1500);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(500);
 await p.evaluate(()=>{setTransport('fcl')});
 const ok=(n,c,x)=>console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+x));
 await p.evaluate(()=>cloudPreviewPreset(encodeURIComponent('00000000-0000-4000-8000-000000000001')));await p.waitForTimeout(800);
 const remRows=await p.locator('#cpTableBody .cp-remark-row').count();ok('プレビューにリマーク行が出る（3件）',remRows===3,remRows);
 ok('孤立リマーク（小計の後）は出さない',!(await p.locator('#cpTableBody').textContent()).includes('孤立'));
 ok('社内メモ表示',(await p.locator('#cpTableBody .cp-remark-row.is-internal').count())===1);
 ok('「リマークも追加」が見える',await p.locator('#cpRemarkOpt').isVisible());
 await p.screenshot({path:(process.env.OUT||require('os').tmpdir())+'/preview.png'});
 // 運賃A のチェックを外す（C と B だけ追加）
 await p.locator('#cpTableBody .cp-row').filter({hasText:'運賃A'}).locator('.cp-chk').uncheck();
 await p.evaluate(()=>cloudImportSelectedRows());await p.waitForTimeout(800);
 const res=await p.evaluate(()=>[...document.querySelectorAll('#tableBody tr')].filter(t=>!t.dataset.virtual).map(t=>t.dataset.type==='remark'?{t:'remark',text:t.querySelector('.remark-row-input').value,internal:t.dataset.internal==='1',parent:t.dataset.parentId||null,prev:t.previousElementSibling?.id}:{t:'data',id:t.id,nm:t.querySelector('[data-field=nm]')?.value}));
 console.log(JSON.stringify(res));
 // 新規見積に最初からある空行（品名なし）は appendQuoteRows が置き換えない仕様（#495 以来「末尾に追加」）なので比較から除く
 const data=res.filter(r=>r.t==='data'&&(r.nm||'').trim()),rem=res.filter(r=>r.t==='remark');
 ok('選択した2行だけ追加（B・C）',data.length===2&&data.map(d=>d.nm).sort().join()==='運賃B,運賃C',JSON.stringify(data));
 ok('Bのリマーク2件が追加され、社内メモの種別も保持',rem.length===2&&rem.some(r=>r.text==='B社内メモ'&&r.internal)&&rem.some(r=>r.text==='Bのリマーク1'&&!r.internal),JSON.stringify(rem));
 const bId=data.find(d=>d.nm==='運賃B').id.replace('row-','');
 ok('リマークが運賃Bの子として紐づく（parentId）',rem.every(r=>r.parent===bId),JSON.stringify(rem)+bId);
 // 並びがグループ化後も、リマークは運賃Bの直後
 const seq=res.map(r=>r.t==='data'?r.nm:r.text).join(' | ');console.log(seq);
 ok('運賃Bの直後にリマークが続く',/運賃B \| Bのリマーク1 \| B社内メモ/.test(seq),seq);
 // 2回目：リマークなしで追加
 await p.evaluate(()=>cloudPreviewPreset(encodeURIComponent('00000000-0000-4000-8000-000000000001')));await p.waitForTimeout(800);
 await p.locator('#cpIncludeRemarks').uncheck();
 await p.evaluate(()=>cloudImportSelectedRows());await p.waitForTimeout(800);
 const remN=await p.locator('#tableBody tr[data-type=remark]').count();
 ok('チェックを外すとリマークは追加されない（リマーク数は2のまま）',remN===2,remN);
 ok('JSエラーなし',errs.length===0,errs.join('|'));
 await p.screenshot({path:(process.env.OUT||require('os').tmpdir())+'/after.png'});
 await b.close();srv.close();
})();

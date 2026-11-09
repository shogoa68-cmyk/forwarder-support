// 📁 作業フォルダ：Supabase 保存領域版（backend='storage'）の画面テスト。
//   node scripts/design-tests/workfolder-storage-test.js
// 表・RPC・保存領域はページ内のモックに差し替える（本物には接続しない）。
// ＝ここで確かめるのは「画面の操作と、サーバー（SQL 関数・保存領域）へ渡す順番と内容」。
//   SQL 側の論理（容量・RLS・予約→確定）は scripts/sql-tests/work-folders-sql-test.sh で別に確かめている。
const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
const OUT=process.env.OUT||require('os').tmpdir()+'/design-tests-out';fs.mkdirSync(OUT,{recursive:true});
let fails=0;
const ok=(n,c,x)=>{if(!c)fails++;console.log((c?'PASS ':'FAIL ')+n+(c?'':' → '+JSON.stringify(x)));};
(async()=>{
 const root=path.resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:900},locale:'ja-JP',acceptDownloads:true});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 // 保存領域への直接アップロード（XHR POST）を受ける。ページ側のフラグ（__xhrFail）で失敗も作れる
 let xhrFail=false;const xhrLog=[];
 await ctx.route('**/storage/v1/object/work-folders/**',async r=>{
   const h={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,OPTIONS'};
   if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:h});return;}
   const hd=r.request().headers();xhrLog.push({url:r.request().url(),auth:hd['authorization'],upsert:hd['x-upsert'],ct:hd['content-type']||''});
   if(xhrFail){await r.fulfill({status:500,headers:{...h,'content-type':'application/json'},body:JSON.stringify({message:'boom'})});return;}
   await r.fulfill({status:200,headers:{...h,'content-type':'application/json'},body:JSON.stringify({Key:'work-folders/x'})});
 });
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);

 await p.evaluate(()=>{
   const rows=new Map();window.__calls=[];window.__me='me@example.com';window.__quota=50*1048576;window.__limit=50*1048576;
   const uuid=()=>crypto.randomUUID();
   const dup=(r)=>[...rows.values()].some(x=>x.id!==r.id&&!x.trashed_at&&x.owner_email===r.owner_email&&(x.parent_id||null)===(r.parent_id||null)&&x.name.toLowerCase()===r.name.toLowerCase());
   const used=()=>[...rows.values()].reduce((a,r)=>a+(r.kind==='file'?r.size:0),0);
   function builder(){
     const q={op:'select',f:[],payload:null};
     const api={select(){return api;},order(){return api;},range(){return api;},insert(p){q.op='insert';q.payload=p;return api;},update(p){q.op='update';q.payload=p;return api;},eq(k,v){q.f.push([k,v]);return api;},single(){return api;},
       then(res,rej){return Promise.resolve(exec()).then(res,rej);}};
     function exec(){
       if(q.op==='select')return{data:[...rows.values()],error:null};
       if(q.op==='insert'){const r=Object.assign({id:uuid(),owner_email:window.__me,size:0,mime:null,drive_file_id:null,storage_path:null,upload_state:'ready',trashed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()},q.payload);
         if(r.kind!=='folder')return{data:null,error:{message:'folder only'}};if(dup(r))return{data:null,error:{code:'23505',message:'dup'}};rows.set(r.id,r);return{data:r,error:null};}
       if(q.op==='update'){const id=q.f.find(x=>x[0]==='id')[1];const r=rows.get(id);const n=Object.assign({},r,q.payload,{updated_at:new Date().toISOString()});if(dup(n))return{data:null,error:{code:'23505',message:'dup'}};rows.set(id,n);return{data:n,error:null};}
     }
     return api;
   }
   const kids=(id)=>[...rows.values()].filter(x=>x.parent_id===id);
   const tree=(ids)=>{const out=[];(function walk(i){const n=rows.get(i);if(!n)return;out.push(n);kids(i).forEach(k=>walk(k.id));});ids.forEach(function w(i){const n=rows.get(i);if(!n)return;out.push(n);kids(i).forEach(k=>w(k.id));});return out;};
   const E=(m)=>({data:null,error:{message:m}});
   window.__rows=rows;
   window.cloudCurrentEmail=()=>window.__me;
   window.cloudGetClient=()=>({
     from:()=>builder(),
     rpc:async(name,a)=>{
       window.__calls.push(['rpc',name]);
       if(name==='wf_my_usage')return{data:[{used:used(),quota:window.__quota,file_limit:window.__limit,backend:'storage'}],error:null};
       if(name==='wf_storage_reserve'){
         if(a.p_size>window.__limit)return E('wf: 1 ファイルの上限は 50 MB です');
         if(used()+a.p_size>window.__quota)return E('wf: 容量の上限（50 MB）を超えます');
         const r={id:uuid(),owner_email:window.__me,parent_id:a.p_parent||null,kind:'file',name:a.p_name,size:a.p_size,mime:a.p_mime,drive_file_id:null,upload_state:'pending',trashed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
         r.storage_path='user-1/'+r.id;if(dup(r))return E('wf: 同じ名前のファイルがあります');rows.set(r.id,r);window.__lastReserve=a;return{data:r,error:null};}
       if(name==='wf_storage_finalize'){
         if(window.__finalizeError)return E('wf: '+window.__finalizeError);
         const r=rows.get(a.p_id);const n=Object.assign({},r,{upload_state:'ready',size:window.__realSize||r.size});rows.set(r.id,n);return{data:n,error:null};}
       if(name==='wf_storage_abort'){rows.delete(a.p_id);return{data:null,error:null};}
       if(name==='wf_my_tree')return{data:tree(a.p_ids).map(n=>({node_id:n.id,storage_path:n.storage_path})),error:null};
       if(name==='wf_my_delete'){tree(a.p_ids).map(n=>n.id).forEach(i=>rows.delete(i));return{data:a.p_ids.length,error:null};}
       return E('unknown rpc '+name);
     },
     storage:{from:(bucket)=>({
       download:async(p)=>{window.__calls.push(['storage.download',p]);const n=[...rows.values()].find(r=>r.storage_path===p);
         const body=n&&n.name.endsWith('.png')?Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)):new TextEncoder().encode('保存領域のテキスト\n'+(n?n.name:'?'));
         return{data:new Blob([body],{type:(n&&n.mime)||'application/octet-stream'}),error:null};},
       remove:async(paths)=>{window.__calls.push(['storage.remove',bucket,paths.join(',')]);return{data:[],error:null};}
     })},
     auth:{getSession:async()=>({data:{session:{access_token:'tok'}}}),onAuthStateChange(){}}
   });
   // Edge Function は、この版では呼ばれないはず（呼ばれたら記録）
   const rf=window.fetch.bind(window);
   window.fetch=async function(url,init){if(String(url).indexOf('/functions/v1/workfolder')>=0){window.__calls.push(['fn',JSON.parse(init.body).action]);return new Response('{}',{status:500});}return rf(url,init);};
 });

 const names=()=>p.evaluate(()=>[...document.querySelectorAll('#wfMain .wf-row .wf-name b')].map(e=>e.textContent));
 const calls=()=>p.evaluate(()=>window.__calls.map(c=>c.join(':')));
 const upload=async(files)=>{const fc=p.waitForEvent('filechooser');await p.click('[data-act="upload"]');await (await fc).setFiles(files);};

 await p.click('#catMoreBtn');await p.waitForTimeout(150);
 await p.click('.cat-btn[aria-controls="tab-workfolder"]');await p.waitForTimeout(900);
 const us=await p.evaluate(()=>document.querySelector('.wf-usage span').textContent);
 ok('置き場は storage。使用量は「0 B / 50.0 MB」で出る（DB の上限を読む）',/0 B \/ 50\.0 MB/.test(us),us);

 // ---- アップロード：予約 → 直接送信 → 確定 の順 ----
 await p.evaluate(()=>{window.__calls.length=0;});
 await upload([{name:'見積書.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 hello')},{name:'メモ.txt',mimeType:'text/plain',buffer:Buffer.from('memo')}]);
 await p.waitForFunction(()=>document.querySelectorAll('#wfMain .wf-row').length>=2,null,{timeout:8000});await p.waitForTimeout(400);
 ok('ファイルが一覧に入る',JSON.stringify((await names()).sort())===JSON.stringify(['メモ.txt','見積書.pdf'].sort()),await names());
 const seq=await calls();
 const iR=seq.indexOf('rpc:wf_storage_reserve'),iF=seq.indexOf('rpc:wf_storage_finalize');
 ok('サーバーへは「予約 → （保存領域へ直接送信）→ 確定」の順に呼ぶ',iR>=0&&iF>iR&&xhrLog.length===2,{seq,xhr:xhrLog.length});
 ok('Edge Function（Google ドライブ用）は呼ばない',!seq.some(c=>c.startsWith('fn:')),seq);
 ok('保存領域へは、ログイン中の本人の鍵つき・上書きなし（x-upsert:false）・予約した場所へ送る',xhrLog.every(x=>/^Bearer tok/.test(x.auth||'')&&x.upsert==='false'&&/\/storage\/v1\/object\/work-folders\/user-1\//.test(x.url)),xhrLog);
 ok('予約には名前・大きさ・種類が渡る',await p.evaluate(()=>{const a=window.__lastReserve;return a&&a.p_name&&a.p_size>0&&a.p_mime&&('p_parent' in a);}),await p.evaluate(()=>window.__lastReserve));
 ok('アップロード枠に完了が出る',await p.evaluate(()=>/2 \/ 2/.test(document.getElementById('wfUploads').textContent)),null);
 await p.screenshot({path:OUT+'/workfolder-storage-list.png'});

 // 同名は連番
 await upload([{name:'見積書.pdf',mimeType:'application/pdf',buffer:Buffer.from('again')}]);
 await p.waitForFunction(()=>document.querySelectorAll('#wfMain .wf-row').length>=3,null,{timeout:8000});await p.waitForTimeout(300);
 ok('同じ名前のファイルは「見積書 (2).pdf」になる',(await names()).includes('見積書 (2).pdf'),await names());

 // ---- 失敗の扱い ----
 await p.evaluate(()=>{window.__calls.length=0;window.__quota=1;});
 await upload([{name:'超過.bin',mimeType:'application/octet-stream',buffer:Buffer.from('xxxxxxxx')}]);
 await p.waitForTimeout(700);
 const e1=await p.evaluate(()=>document.getElementById('wfUploads').textContent);
 ok('容量を超える予約は断られ、理由が出て、送信も行も作られない',/容量の上限/.test(e1)&&!(await names()).includes('超過.bin')&&xhrLog.length===3&&!(await calls()).includes('rpc:wf_storage_finalize'),{e1,xhr:xhrLog.length});
 ok('サーバーのメッセージの「wf: 」は画面では外れる',!/wf:/.test(e1),e1);
 await p.evaluate(()=>{window.__quota=50*1048576;});

 await p.evaluate(()=>{window.__calls.length=0;});
 const bigPath=path.join(OUT,'大きい.zip');fs.writeFileSync(bigPath,Buffer.alloc(51*1048576,1));   // Playwright はメモリ上の 50MB 超を渡せないので実ファイルで
 const fcBig=p.waitForEvent('filechooser');await p.click('[data-act="upload"]');await (await fcBig).setFiles(bigPath);fs.unlinkSync(bigPath);
 await p.waitForTimeout(900);
 ok('1 ファイルの上限（50MB）超は、予約もせずその場で断る',/上限/.test(await p.evaluate(()=>document.getElementById('wfUploads').textContent))&&!(await calls()).includes('rpc:wf_storage_reserve'),await calls());

 await p.evaluate(()=>{window.__calls.length=0;window.__finalizeError='容量の上限（50 MB）を超えます';});
 await upload([{name:'確定失敗.txt',mimeType:'text/plain',buffer:Buffer.from('zzz')}]);
 await p.waitForTimeout(900);
 const sq=await calls();
 ok('確定で断られたら、保存領域のファイルを消し、そのあと予約の行を取り消す（この順）',sq.findIndex(c=>c.startsWith('storage.remove:'))>sq.indexOf('rpc:wf_storage_finalize')&&sq.indexOf('rpc:wf_storage_abort')>sq.findIndex(c=>c.startsWith('storage.remove:')),sq);
 ok('失敗したファイルは一覧に残らない',!(await names()).includes('確定失敗.txt')&&!(await p.evaluate(()=>[...__rows.values()].some(r=>r.name==='確定失敗.txt'))),await names());
 await p.evaluate(()=>{window.__finalizeError=null;window.__calls.length=0;});
 xhrFail=true;
 await upload([{name:'送信失敗.txt',mimeType:'text/plain',buffer:Buffer.from('zzz')}]);
 await p.waitForTimeout(900);
 const sq2=await calls();
 const e2=await p.evaluate(()=>document.getElementById('wfUploads').textContent);
 ok('保存領域への送信が失敗（500）したら、理由を出して予約を取り消す（確定はしない）',/500/.test(e2)&&sq2.includes('rpc:wf_storage_abort')&&!sq2.includes('rpc:wf_storage_finalize')&&!(await names()).includes('送信失敗.txt'),{e2,sq2});
 xhrFail=false;
 await p.click('[data-act="upclose"]');

 // ---- ダウンロード・プレビュー（保存領域から） ----
 await p.evaluate(()=>{window.__calls.length=0;window.__dlNames=[];const o=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__dlNames.push(this.download);return o.apply(this,arguments);};});
 await p.click('.wf-row:has-text("見積書.pdf")');
 const dl=p.waitForEvent('download');await p.click('[data-act="download"]');await dl;
 ok('ダウンロードは保存領域から取得し、元のファイル名で保存する',(await calls()).some(c=>/^storage\.download:user-1\//.test(c))&&await p.evaluate(()=>window.__dlNames.join()==='見積書.pdf'),await calls());
 await p.dblclick('.wf-row:has-text("メモ.txt")');await p.waitForTimeout(600);
 ok('テキストはダブルクリックでプレビューできる',await p.evaluate(()=>/保存領域のテキスト/.test(document.querySelector('.wf-pv pre')?.textContent||'')),null);
 await p.keyboard.press('Escape');await p.waitForTimeout(200);

 // ---- 未完了（pending）の行 ----
 await p.evaluate(()=>{const id=crypto.randomUUID();const row={id,owner_email:__me,parent_id:null,kind:'file',name:'途中.pdf',size:10,mime:'application/pdf',drive_file_id:null,storage_path:'user-1/'+id,upload_state:'pending',trashed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};__rows.set(id,row);window.__wf.S.nodes.set(id,row);window.__wf.render();});
 await p.waitForTimeout(200);
 ok('アップロード未完了の行には「⚠ 未完了」の印が出る',await p.evaluate(()=>/未完了/.test(document.querySelector('#wfMain .wf-row:has(.wf-pend)')?.textContent||'')),null);
 await p.evaluate(()=>{window.__calls.length=0;});
 await p.dblclick('.wf-row:has-text("途中.pdf")');await p.waitForTimeout(400);
 ok('未完了の行は開こうとしても、案内が出るだけで取得はしない',await p.evaluate(()=>/完了していない/.test(document.getElementById('toast-container')?.textContent||document.body.textContent))&&!(await calls()).some(c=>c.startsWith('storage.download')),await calls());
 await p.screenshot({path:OUT+'/workfolder-storage-pending.png'});

 // ---- ゴミ箱 → 完全削除（先に保存領域のファイル、あとで行） ----
 await p.click('.wf-row:has-text("メモ.txt")');await p.keyboard.press('Delete');await p.waitForTimeout(300);
 await p.click('.wf-row:has-text("途中.pdf")');await p.keyboard.press('Delete');await p.waitForTimeout(300);
 await p.click('[data-tree="trash"]');await p.waitForTimeout(250);
 await p.evaluate(()=>{window.__calls.length=0;});
 await p.click('.wf-row:has-text("メモ.txt")');await p.click('[data-act="purge"]');await p.waitForTimeout(250);
 await p.click('.confirm-dialog .btn-danger');await p.waitForTimeout(500);
 const pc=await calls();
 ok('完全削除は「中身の場所を調べる → 保存領域から削除 → 行を削除」の順',pc.indexOf('rpc:wf_my_tree')>=0&&pc.findIndex(c=>c.startsWith('storage.remove:'))>pc.indexOf('rpc:wf_my_tree')&&pc.indexOf('rpc:wf_my_delete')>pc.findIndex(c=>c.startsWith('storage.remove:')),pc);
 ok('完全削除した行は消え、ほかの項目は残る',await p.evaluate(()=>![...__rows.values()].some(r=>r.name==='メモ.txt')&&[...__rows.values()].some(r=>r.name==='見積書.pdf')),null);
 ok('Edge Function（Google ドライブ用）は一度も呼ばれていない',!(await calls()).some(c=>c.startsWith('fn:')),await calls());

 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
 console.log(fails?`\n${fails} 件 失敗`:'\nすべて成功');process.exit(fails?1:0);
})();

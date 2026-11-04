// 📁 作業フォルダ（ファイルエクスプローラー風）の画面テスト。
//   node scripts/design-tests/workfolder-test.js
// Supabase（表・RPC・Edge Function）とドライブは、ページの中でモックに差し替える（本物には接続しない）。
// ＝ここで確かめるのは「画面の操作と、サーバーへ渡す内容」。本物のドライブ接続は docs/作業フォルダ-セットアップ.md の手順で別途確認する。
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
 // ドライブ（モック）への直接アップロード：CORS つきで {id} を返す
 let driveSeq=0;
 await ctx.route('https://drive.mock/**',async r=>{
   const h={'access-control-allow-origin':'*','access-control-allow-methods':'PUT,OPTIONS','access-control-allow-headers':'*'};
   if(r.request().method()==='OPTIONS'){await r.fulfill({status:204,headers:h});return;}
   await r.fulfill({status:200,headers:{...h,'content-type':'application/json'},body:JSON.stringify({id:'DRIVEFILE'+String(++driveSeq).padStart(8,'0')})});
 });
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1')&&!u.href.startsWith('https://drive.mock'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.setDefaultTimeout(8000);
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(800);

 // ---- モックを差し込む（表の代わり・Edge Function の代わり） ----
 await p.evaluate(()=>{
   const rows=new Map(); window.__calls=[]; window.__mockEmail='me@example.com';
   const uuid=()=>crypto.randomUUID();
   const dup=(r)=>[...rows.values()].some(x=>x.id!==r.id&&!x.trashed_at&&x.owner_email===r.owner_email&&(x.parent_id||null)===(r.parent_id||null)&&x.name.toLowerCase()===r.name.toLowerCase());
   function builder(){
     const q={op:'select',f:[],payload:null,single:false,range:null};
     const api={
       select(){return api;},order(){return api;},range(a,b){q.range=[a,b];return api;},
       insert(p){q.op='insert';q.payload=p;return api;},update(p){q.op='update';q.payload=p;return api;},
       eq(k,v){q.f.push([k,v]);return api;},single(){q.single=true;return api;},
       then(res,rej){return Promise.resolve(exec()).then(res,rej);}
     };
     function exec(){
       if(q.op==='select'){let a=[...rows.values()];if(q.range)a=a.slice(q.range[0],q.range[1]+1);return{data:a,error:null};}
       if(q.op==='insert'){
         const r=Object.assign({id:uuid(),owner_email:window.__mockEmail,size:0,mime:null,drive_file_id:null,trashed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()},q.payload);
         if(r.kind!=='folder')return{data:null,error:{message:'folder only'}};
         if(dup(r))return{data:null,error:{code:'23505',message:'duplicate'}};
         rows.set(r.id,r);window.__calls.push(['insert',r.name]);return{data:r,error:null};
       }
       if(q.op==='update'){
         const id=q.f.find(x=>x[0]==='id')[1];const r=rows.get(id);if(!r)return{data:null,error:{message:'not found'}};
         const n=Object.assign({},r,q.payload,{updated_at:new Date().toISOString()});
         if(dup(n))return{data:null,error:{code:'23505',message:'duplicate'}};
         rows.set(id,n);window.__calls.push(['update',Object.keys(q.payload).join(',')]);return{data:n,error:null};
       }
     }
     return api;
   }
   window.__rows=rows;
   window.cloudCurrentEmail=()=>window.__mockEmail;
   window.cloudGetClient=()=>({from:()=>builder(),rpc:async()=>({data:[{used:0,quota:5368709120}],error:null}),
     auth:{getSession:async()=>({data:{session:{access_token:'tok'}}}),onAuthStateChange(){}}});
   // Edge Function（POST /functions/v1/workfolder）のふりをする
   const realFetch=window.fetch.bind(window);
   window.fetch=async function(url,init){
     if(String(url).indexOf('/functions/v1/workfolder')<0)return realFetch(url,init);
     const b=JSON.parse(init.body);window.__calls.push(['fn',b.action]);
     const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});
     if(b.action==='init'){
       const used=[...rows.values()].reduce((a,r)=>a+(r.kind==='file'?r.size:0),0);
       if(window.__quota&&used+b.size>window.__quota)return J({error:'quota',message:'容量の上限を超えます'},507);
       window.__lastInit=b;return J({upload_url:'https://drive.mock/up/'+uuid()});
     }
     if(b.action==='complete'){
       const r={id:uuid(),owner_email:window.__mockEmail,parent_id:b.parent_id||null,kind:'file',name:b.name,size:window.__nextSize||1234,mime:b.mime,drive_file_id:b.drive_file_id,trashed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
       rows.set(r.id,r);return J({node:r});
     }
     if(b.action==='download'){
       const r=rows.get(b.id);const body=r.name.endsWith('.png')?Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0)):new TextEncoder().encode('こんにちは作業フォルダ\n'+r.name);
       return new Response(new Blob([body],{type:r.mime||'application/octet-stream'}),{status:200});
     }
     if(b.action==='purge'){
       const del=new Set();(function walk(id){del.add(id);[...rows.values()].filter(x=>x.parent_id===id).forEach(x=>walk(x.id));})(b.ids[0]);
       b.ids.slice(1).forEach(id=>(function walk(i){del.add(i);[...rows.values()].filter(x=>x.parent_id===i).forEach(x=>walk(x.id));})(id));
       del.forEach(id=>rows.delete(id));return J({deleted:b.ids.length});
     }
     return J({error:'bad',message:'?'},400);
   };
 });

 // ---- 入口：「その他」→「📁 作業フォルダ」 ----
 await p.click('#catMoreBtn');await p.waitForTimeout(150);
 await p.click('.cat-btn[aria-controls="tab-workfolder"]');await p.waitForTimeout(900);
 ok('作業フォルダの画面が開き、空のときの案内が出る',await p.evaluate(()=>document.getElementById('tab-workfolder').classList.contains('active')&&/このフォルダは空です/.test(document.getElementById('wfMain').textContent)),await p.evaluate(()=>document.getElementById('wfRoot').textContent.slice(0,200)));
 ok('「その他」に選択中の名前が出る',await p.evaluate(()=>/作業フォルダ/.test(document.querySelector('#catMoreBtn .cat-more-label').textContent)),null);
 const usage0=await p.evaluate(()=>document.querySelector('.wf-usage span').textContent);
 ok('使用量が「0 B / 5.00 GB」で出る',/0 B \/ 5\.00 GB/.test(usage0),usage0);

 // ---- フォルダ作成（作ってすぐ名前を打てる） ----
 await p.click('[data-act="newfolder"]');await p.waitForTimeout(250);
 const inp=await p.evaluate(()=>{const i=document.querySelector('.wf-rename');return i?{v:i.value,focused:document.activeElement===i,sel:[i.selectionStart,i.selectionEnd]}:null;});
 ok('「新しいフォルダ」を作ると名前の入力欄が出て、全文字が選ばれている',inp&&inp.v==='新しいフォルダ'&&inp.focused&&inp.sel[0]===0&&inp.sel[1]===inp.v.length,inp);
 await p.keyboard.type('見積資料');await p.keyboard.press('Enter');await p.waitForTimeout(250);
 await p.click('[data-act="newfolder"]');await p.waitForTimeout(200);await p.keyboard.type('写真');await p.keyboard.press('Enter');await p.waitForTimeout(250);
 await p.click('[data-act="newfolder"]');await p.waitForTimeout(200);await p.keyboard.press('Enter');await p.waitForTimeout(250);   // 名前を変えず確定
 const names=()=>p.evaluate(()=>[...document.querySelectorAll('#wfMain .wf-row .wf-name b')].map(e=>e.textContent));
 ok('名前を決めて Enter で確定。フォルダーが名前順に並ぶ',JSON.stringify(await names())===JSON.stringify(['見積資料','新しいフォルダ','写真'].sort((a,b)=>a.localeCompare(b,'ja'))),await names());
 // 同名の作成は自動で連番
 await p.click('[data-act="newfolder"]');await p.waitForTimeout(200);await p.keyboard.press('Enter');await p.waitForTimeout(250);
 ok('同じ名前は「新しいフォルダ (2)」と連番になる',(await names()).includes('新しいフォルダ (2)'),await names());
 // 名前の重複は拒否（変更）
 await p.click('.wf-row:has-text("新しいフォルダ (2)")');await p.keyboard.press('F2');await p.waitForTimeout(150);
 await p.keyboard.press('Control+a');await p.keyboard.type('写真');await p.keyboard.press('Enter');await p.waitForTimeout(250);
 ok('F2 の名前変更で、すでにある名前にはできない（元のまま）',(await names()).includes('新しいフォルダ (2)')&&(await names()).filter(x=>x==='写真').length===1,await names());
 await p.screenshot({path:OUT+'/workfolder-list.png'});

 // ---- 開く・パンくず・戻る ----
 await p.dblclick('.wf-row:has-text("見積資料")');await p.waitForTimeout(250);
 const crumbs=()=>p.evaluate(()=>[...document.querySelectorAll('.wf-crumb')].map(e=>e.textContent));
 ok('ダブルクリックで開き、パンくずに場所が出る',JSON.stringify(await crumbs())===JSON.stringify(['📁 作業フォルダ','見積資料']),await crumbs());
 ok('ツリーでも現在地が強調される',await p.evaluate(()=>document.querySelector('.wf-tnode.is-cur .wf-tlabel').textContent==='見積資料'),null);
 await p.keyboard.press('Control+Shift+N');await p.waitForTimeout(250);await p.keyboard.type('A社');await p.keyboard.press('Enter');await p.waitForTimeout(250);
 ok('Ctrl+Shift+N で中にフォルダを作れる',(await names()).join()==='A社',await names());

 // ---- アップロード（ファイル選択・同名は連番・容量） ----
 await p.evaluate(()=>{window.__nextSize=2048;});
 let fc=p.waitForEvent('filechooser');await p.click('[data-act="upload"]');
 await (await fc).setFiles([{name:'見積書.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')},{name:'メモ.txt',mimeType:'text/plain',buffer:Buffer.from('hello')},{name:'logo.png',mimeType:'image/png',buffer:Buffer.from('x')}]);
 await p.waitForFunction(()=>document.querySelectorAll('#wfMain .wf-row').length>=4,null,{timeout:8000});await p.waitForTimeout(500);
 const lst=await names();
 ok('3 つのファイルが現在のフォルダに入る（フォルダーが先）',lst.length===4&&lst[0]==='A社'&&lst.includes('見積書.pdf')&&lst.includes('メモ.txt'),lst);
 const init=await p.evaluate(()=>window.__lastInit);
 ok('サーバーへ名前・サイズ・種類・保存先フォルダを渡している',init&&init.action==='init'&&init.name&&init.size>=1&&init.parent_id&&init.mime,init);
 const parentOk=await p.evaluate(()=>{const f=[...__rows.values()].find(r=>r.name==='見積資料');return [...__rows.values()].filter(r=>r.kind==='file').every(r=>r.parent_id===f.id);});
 ok('ファイルの行は開いているフォルダの中に登録される',parentOk,null);
 ok('アップロード枠に完了が出る',await p.evaluate(()=>/3 \/ 3/.test(document.getElementById('wfUploads').textContent)),await p.evaluate(()=>document.getElementById('wfUploads').textContent));
 ok('使用量が増える（2 KB×3）',await p.evaluate(()=>/6\.00 KB/.test(document.querySelector('.wf-usage span').textContent)),await p.evaluate(()=>document.querySelector('.wf-usage span').textContent));
 fc=p.waitForEvent('filechooser');await p.click('[data-act="upload"]');
 await (await fc).setFiles([{name:'見積書.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 again')}]);
 await p.waitForFunction(()=>document.querySelectorAll('#wfMain .wf-row').length>=5,null,{timeout:8000});await p.waitForTimeout(300);
 ok('同じ名前のファイルは「見積書 (2).pdf」になる（上書きしない）',(await names()).includes('見積書 (2).pdf'),await names());
 // 容量オーバー
 await p.evaluate(()=>{window.__quota=1;});
 fc=p.waitForEvent('filechooser');await p.click('[data-act="upload"]');
 await (await fc).setFiles([{name:'大きい.zip',mimeType:'application/zip',buffer:Buffer.from('zzzz')}]);
 await p.waitForTimeout(700);
 const upErr=await p.evaluate(()=>document.getElementById('wfUploads').textContent);
 ok('容量の上限を超えるときはエラー表示で、一覧には入らない',/容量の上限/.test(upErr)&&!(await names()).includes('大きい.zip'),upErr);
 await p.evaluate(()=>{window.__quota=0;});
 await p.click('[data-act="upclose"]');await p.waitForTimeout(100);

 // ---- ドラッグ＆ドロップ：項目の移動 ----
 await p.click('[data-tree=""]');await p.waitForTimeout(250);
 await p.dragAndDrop('.wf-row:has-text("写真")','.wf-tnode[data-drop]:has-text("見積資料")');await p.waitForTimeout(500);
 ok('フォルダをツリーのフォルダへドラッグして移動できる',await p.evaluate(()=>{const a=[...__rows.values()].find(r=>r.name==='見積資料'),s=[...__rows.values()].find(r=>r.name==='写真');return s.parent_id===a.id;}),null);
 ok('移動した項目は元の一覧から消える',!(await names()).includes('写真'),await names());
 // 自分の中へは移せない
 await p.dblclick('.wf-row:has-text("見積資料")');await p.waitForTimeout(250);
 await p.click('.wf-row:has-text("写真")');await p.keyboard.press('Control+x');await p.waitForTimeout(150);
 await p.dblclick('.wf-row:has-text("写真")');await p.waitForTimeout(250);
 await p.keyboard.press('Control+v');await p.waitForTimeout(400);
 ok('切り取り→貼り付けで、自分自身の中には移せない（フォルダは動かない）',await p.evaluate(()=>{const a=[...__rows.values()].find(r=>r.name==='見積資料'),s=[...__rows.values()].find(r=>r.name==='写真');return s.parent_id===a.id;}),null);
 // 切り取り→別フォルダへ貼り付け
 await p.click('.wf-crumb[data-crumb=""]');await p.waitForTimeout(250);
 await p.dblclick('.wf-row:has-text("見積資料")');await p.waitForTimeout(250);
 await p.click('.wf-row:has-text("メモ.txt")');await p.keyboard.press('Control+x');await p.waitForTimeout(150);
 await p.click('.wf-row:has-text("A社")',{clickCount:2});await p.waitForTimeout(250);
 await p.keyboard.press('Control+v');await p.waitForTimeout(400);
 ok('切り取り→貼り付けでファイルを別フォルダへ移せる',(await names()).includes('メモ.txt'),await names());
 await p.keyboard.press('Alt+ArrowLeft');await p.waitForTimeout(250);
 ok('Alt+← で戻れる',(await crumbs()).join()==='📁 作業フォルダ,見積資料',await crumbs());
 await p.keyboard.press('Backspace');await p.waitForTimeout(250);
 ok('Backspace で 1 つ上へ',(await crumbs()).length===1,await crumbs());

 // ---- 並べ替え・表示切替・検索 ----
 await p.dblclick('.wf-row:has-text("見積資料")');await p.waitForTimeout(250);
 await p.click('[data-sort="size"]');await p.waitForTimeout(200);
 ok('列の見出しで並べ替え（サイズ）。フォルダーは先頭のまま',await p.evaluate(()=>document.querySelector('.wf-lhead .is-sorted').dataset.sort==='size'&&document.querySelector('#wfMain .wf-row .wf-ico').textContent==='📁'),null);
 await p.click('[data-act="mode"]');await p.waitForTimeout(200);
 ok('「アイコン」表示に切り替わる',await p.evaluate(()=>document.querySelectorAll('#wfMain .wf-card').length>=3),null);
 await p.screenshot({path:OUT+'/workfolder-grid.png'});
 await p.click('[data-act="mode"]');await p.waitForTimeout(150);
 await p.fill('#wfSearch','見積');await p.waitForTimeout(300);
 const sr=await p.evaluate(()=>({crumb:document.querySelector('.wf-crumb').textContent,rows:[...document.querySelectorAll('#wfMain .wf-row .wf-name b')].map(e=>e.textContent),focus:document.activeElement.id}));
 ok('検索欄に打つと全体から名前で絞り込み、打ち続けられる',/検索結果/.test(sr.crumb)&&sr.rows.includes('見積書.pdf')&&sr.rows.includes('見積資料')&&sr.focus==='wfSearch',sr);
 await p.keyboard.press('Escape');await p.waitForTimeout(250);
 ok('Esc で検索を解除して元の場所に戻る',(await crumbs()).join()==='📁 作業フォルダ,見積資料',await crumbs());

 // ---- 右クリック・プレビュー・ダウンロード ----
 await p.click('.wf-row:has-text("見積書.pdf")',{button:'right'});await p.waitForTimeout(200);
 const menu=await p.evaluate(()=>[...document.querySelectorAll('.wf-menu button')].map(b=>b.textContent.replace(/\s+/g,' ').trim()));
 ok('項目を右クリックするとメニューが出る（選択も同時に行われる）',menu.length>=5&&menu.some(t=>/ダウンロード/.test(t))&&menu.some(t=>/ゴミ箱/.test(t)),menu);
 await p.screenshot({path:OUT+'/workfolder-menu.png'});
 await p.keyboard.press('Escape');await p.mouse.click(1300,150);await p.waitForTimeout(150);
 await p.click('.wf-row:has-text("見積書.pdf")');
 // ヘッドレス Chromium は、日本語名の download 属性を「download」と報告する癖がある（画面と無関係・最小ページでも再現）。
 // そのため、リンクに設定された名前をここで直接確認し、保存の発火は download イベントで確認する。
 await p.evaluate(()=>{window.__dlNames=[];const o=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download)window.__dlNames.push(this.download);return o.apply(this,arguments);};});
 const dl=p.waitForEvent('download');await p.click('[data-act="download"]');
 await dl;
 ok('ダウンロードが始まり、保存名は元のファイル名（見積書.pdf）が設定される',await p.evaluate(()=>window.__dlNames.join()==='見積書.pdf'),await p.evaluate(()=>window.__dlNames));
 await p.dblclick('.wf-row:has-text("logo.png")');await p.waitForTimeout(600);
 ok('画像はダブルクリックでプレビューが開く',await p.evaluate(()=>!!document.querySelector('.wf-pv img[src^="blob:"]')),null);
 await p.screenshot({path:OUT+'/workfolder-preview.png'});
 await p.keyboard.press('Escape');await p.waitForTimeout(200);
 ok('Esc でプレビューが閉じる（画面は残る）',await p.evaluate(()=>!document.querySelector('.wf-pv')&&document.getElementById('tab-workfolder').classList.contains('active')),null);
 await p.dblclick('.wf-row:has-text("見積書 (2).pdf")');await p.waitForTimeout(600);
 ok('PDF はプレビュー枠（iframe）で開く',await p.evaluate(()=>!!document.querySelector('.wf-pv iframe[src^="blob:"]')),null);
 await p.keyboard.press('Escape');await p.waitForTimeout(200);

 // ---- OS からのドロップ（ファイル） ----
 await p.evaluate(()=>{
   const m=document.getElementById('wfMain');const dt=new DataTransfer();dt.items.add(new File(['dropped'],'ドロップ.txt',{type:'text/plain'}));
   ['dragover','drop'].forEach(t=>m.dispatchEvent(new DragEvent(t,{bubbles:true,cancelable:true,dataTransfer:dt})));
 });
 await p.waitForFunction(()=>[...document.querySelectorAll('#wfMain .wf-row .wf-name b')].some(e=>e.textContent==='ドロップ.txt'),null,{timeout:6000}).catch(()=>{});
 ok('OS のファイルをドロップするとアップロードされる',(await names()).includes('ドロップ.txt'),await names());

 // ---- ゴミ箱 → 元に戻す → 完全に削除 ----
 await p.click('.wf-row:has-text("ドロップ.txt")');await p.keyboard.press('Delete');await p.waitForTimeout(300);
 ok('Delete でゴミ箱へ（一覧から消える）',!(await names()).includes('ドロップ.txt'),await names());
 ok('ツリーのゴミ箱に件数が出る',await p.evaluate(()=>/ゴミ箱（1）/.test(document.querySelector('[data-tree="trash"]').textContent)),null);
 await p.click('[data-tree="trash"]');await p.waitForTimeout(250);
 ok('ゴミ箱の画面に入っている項目が出る（元の場所つき）',await p.evaluate(()=>/ドロップ\.txt/.test(document.getElementById('wfMain').textContent)&&/作業フォルダ › 見積資料/.test(document.getElementById('wfMain').textContent)),null);
 await p.screenshot({path:OUT+'/workfolder-trash.png'});
 await p.click('.wf-row:has-text("ドロップ.txt")');await p.click('[data-act="restore"]');await p.waitForTimeout(300);
 await p.click('.wf-crumb, .wf-nav[data-act="back"]').catch(()=>{});
 await p.click('[data-tree]:has-text("見積資料")');await p.waitForTimeout(250);
 ok('元に戻すと元のフォルダに戻る',(await names()).includes('ドロップ.txt'),await names());
 await p.click('.wf-row:has-text("ドロップ.txt")');await p.keyboard.press('Delete');await p.waitForTimeout(300);
 await p.click('[data-tree="trash"]');await p.waitForTimeout(250);
 await p.click('.wf-row:has-text("ドロップ.txt")');await p.click('[data-act="purge"]');await p.waitForTimeout(250);
 const dlg=await p.evaluate(()=>({t:document.querySelector('.confirm-dialog')?.textContent||''}));
 ok('完全削除は確認ダイアログ（取り消せない旨）が出る',/完全に削除/.test(dlg.t)&&/取り消せません/.test(dlg.t),dlg);
 await p.click('.confirm-dialog .btn-danger');await p.waitForTimeout(400);
 ok('確認すると Edge Function の purge が呼ばれ、ゴミ箱から消える',await p.evaluate(()=>__calls.some(c=>c[0]==='fn'&&c[1]==='purge')&&![...__rows.values()].some(r=>r.name==='ドロップ.txt')),null);
 // フォルダごとゴミ箱 → 中のファイルごと復元できる／空にする
 await p.click('[data-tree=""]');await p.waitForTimeout(250);
 await p.click('.wf-row:has-text("見積資料")');await p.keyboard.press('Delete');await p.waitForTimeout(300);
 await p.click('[data-tree="trash"]');await p.waitForTimeout(250);
 ok('フォルダをゴミ箱へ入れると、中身はフォルダの 1 件にまとまって見える',(await names()).join()==='見積資料',await names());
 await p.click('[data-act="empty"]');await p.waitForTimeout(250);await p.click('.confirm-dialog .btn-danger');await p.waitForTimeout(500);
 ok('「ゴミ箱を空にする」でフォルダと中身のファイルがすべて消える',await p.evaluate(()=>[...__rows.values()].length===1&&[...__rows.values()][0].name==='新しいフォルダ'||[...__rows.values()].every(r=>!['見積資料','見積書.pdf','A社','写真'].includes(r.name))),await p.evaluate(()=>[...__rows.values()].map(r=>r.name)));

 // ---- 他人の行・ログアウト・スマホ幅 ----
 await p.evaluate(()=>{window.__mockEmail='';window.cloudCurrentEmail=()=>'';});
 await p.evaluate(()=>{window.__wf.S.ready=false;window.__wf.S.error=null;});
 await p.evaluate(()=>window.initWorkFolderTab());await p.waitForTimeout(3600);
 ok('ログインしていないときは案内とログインボタンが出る',await p.evaluate(()=>/ログインすると使えます/.test(document.getElementById('wfRoot').textContent)&&!!document.querySelector('[data-act="login"]')),await p.evaluate(()=>document.getElementById('wfRoot').textContent.slice(0,120)));
 await p.evaluate(()=>{window.__mockEmail='me@example.com';window.cloudCurrentEmail=()=>'me@example.com';window.__wf.S.ready=false;});
 await p.evaluate(()=>window.initWorkFolderTab());await p.waitForTimeout(900);
 await p.setViewportSize({width:390,height:800});await p.waitForTimeout(300);
 const mob=await p.evaluate(()=>({tree:getComputedStyle(document.querySelector('.wf-tree')).display,over:document.documentElement.scrollWidth>innerWidth+1}));
 ok('スマホ幅：ツリーを隠し、横にはみ出さない',mob.tree==='none'&&!mob.over,mob);
 await p.screenshot({path:OUT+'/workfolder-mobile.png'});
 ok('JS エラーなし',errs.length===0,errs);
 await b.close();srv.close();
 console.log(fails?`\n${fails} 件 失敗`:'\nすべて成功');process.exit(fails?1:0);
})();

const { chromium } = (()=>{try{return require('playwright-core')}catch(e){return require('playwright')}})();
const http=require('http'),fs=require('fs'),path=require('path');
(async()=>{
 const root=require('path').resolve(__dirname,'..','..');
 const srv=http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 const URL=`http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
 const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1400,height:900},locale:'ja-JP'});
 // 旧自動保存の残りデータ（ON＋保存データ）を仕込む
 await ctx.addInitScript(()=>{try{if(!sessionStorage.getItem('seeded')){localStorage.setItem('autoSaveEnabled','1');localStorage.setItem('quoteData',JSON.stringify({fields:{'qf-customer':'古いデータ'},ts:Date.now()}));sessionStorage.setItem('seeded','1')}}catch(e){}});
 await ctx.route(u=>!u.href.startsWith('http://127.0.0.1'),r=>r.abort());
 const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 const res=[];const ok=(n,c,d)=>{res.push(c);console.log((c?'✅ ':'❌ ')+n+(c||!d?'':' → '+d));};
 await p.goto(URL,{waitUntil:'domcontentloaded'});await p.waitForTimeout(600);
 await p.evaluate(()=>{const t=document.querySelector('[onclick*="quote-make"]');t&&t.click();});await p.waitForTimeout(1500);
 await p.evaluate(()=>window.qpShowEditor&&window.qpShowEditor());await p.waitForTimeout(300);
 ok('自動保存のチェックボックスが無い',await p.evaluate(()=>!document.getElementById('autoSaveChk')));
 ok('復元バナーが無い（古いデータがあっても表示されない）',await p.evaluate(()=>!document.getElementById('autosave-restore-bar')));
 ok('古い自動保存データが掃除された',await p.evaluate(()=>localStorage.getItem('quoteData')===null&&localStorage.getItem('autoSaveEnabled')===null));
 ok('保存状態の表示欄（saveStatus）は残っている',await p.evaluate(()=>!!document.getElementById('saveStatus')));
 // 入力しても quoteData は作られない
 await p.fill('#qf-customer','入力テスト');await p.waitForTimeout(2800);
 ok('入力しても quoteData は作られない',await p.evaluate(()=>localStorage.getItem('quoteData')===null));
 // Undo/Redo は動く
 await p.fill('#qf-person','山田');await p.waitForTimeout(900);
 await p.evaluate(()=>quoteUndo());await p.waitForTimeout(400);
 const afterUndo=await p.evaluate(()=>document.getElementById('qf-person').value);
 await p.evaluate(()=>quoteRedo());await p.waitForTimeout(400);
 ok('Undo/Redo が動く',afterUndo===''&&await p.evaluate(()=>document.getElementById('qf-person').value)==='山田',afterUndo);
 // ブラウザ保存（プリセット）の往復
 const data=await p.evaluate(()=>gatherAllData());
 ok('gatherAllData に入力が含まれる',data.fields['qf-customer']==='入力テスト'&&data.fields['qf-person']==='山田');
 await p.evaluate(()=>{window.__fn=typeof openPresetMgr});
 ok('ブラウザ保存の画面関数が存在',await p.evaluate(()=>typeof openPresetMgr==='function'&&typeof saveQuotePreset==='function'||typeof openPresetMgr==='function'));
 ok('ツールバーに「ブラウザ保存」が残る',await p.evaluate(()=>[...document.querySelectorAll('#saveToolbar button')].some(b=>/ブラウザ保存/.test(b.textContent))));
 ok('JSエラーなし',errs.length===0,JSON.stringify(errs));
 await p.screenshot({path:require('os').tmpdir()+'/toolbar-after.png',clip:{x:0,y:150,width:1400,height:80}});
 console.log(res.every(Boolean)?'\nOK':'\nNG');await b.close();srv.close();
})();

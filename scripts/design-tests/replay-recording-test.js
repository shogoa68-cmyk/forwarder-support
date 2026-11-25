// 見張り番の報告 → AI が読んで直す流れの部品の確認
//   ①手順の読み取り（scripts/lib/recording-steps.js）②fetch-feedback の絞り込み（--recordings／--report／--raw）
//   ③実際に見張り番で記録 → 本文を replay-recording.js で自動再生（手順が実行でき・値が入り・判定が出る）
//   node scripts/design-tests/replay-recording-test.js
// 注意：③は旧画面（?editor=v1）で試験する。新画面は①基本〜④費用がステップで分かれ、1 つの記録の中でお客様欄と明細欄を
//   続けて入力できないため（再生ツール側も --url で旧画面を指定する）。
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, execFile } = require('child_process');
const { parseReport } = require('../lib/recording-steps');

(async () => {
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const root = path.resolve(__dirname, '..', '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));

  // ① 手順の読み取り：記録の全種類
  const body = [
    '【起きたこと】（あ）', '', '【本当はこうなるはず】（い）', '',
    '【再現手順（自動記録）】',
    '1. [0:01・dashboard] 「💼 見積を作る」を押す',
    '2. [0:03・quote-make] 「例）○○商事 #qf-customer」に入力 → （文字 8 字）',
    '3. [0:05・quote-make] 「品名」に入力 → THC（明細2行目）',
    '4. [0:06・quote-make] 「仕入単価」に入力 → 数値 12,345.50（明細2行目）',
    '5. [0:07・quote-make] 「輸送モード #cond-mode」を選ぶ → 海上（FCL）',
    '6. [0:08・quote-make] 「課税」に入力 → ON（明細2行目）',
    '7. [0:09・quote-make] キー操作：Ctrl+Z',
    '8. [0:10・quote-make] 🔔 通知（warn）：⚠️ 入力が足りません',
    '9. [0:11・quote-make] ⚠ エラーが出た：TypeError: x is undefined',
    '10. [0:12・quote-make] 🚩 ここで不具合に気づいた',
    '11. [0:13・quote-make] （ページを再読み込みした）',
    '12. [0:14・quote-make] 「＋ 行を追加 #btnAddRow」を押す ×3',
    '', '【記録の開始時の画面の状態】画面=dashboard', '',
    '【記録中に出たエラー】', '- TypeError: x is undefined', '',
  ].join('\n');
  const r0 = parseReport(body);
  const kinds = r0.steps.map(s => s.kind).join(',');
  ok('12 手順を読み取る（種類の並びが正しい）', r0.steps.length === 12 && kinds === 'click,input,input,input,select,input,key,toast,error,mark,reload,click', kinds);
  ok('ラベルと id・行番号を分ける', r0.steps[1].id === 'qf-customer' && r0.steps[1].label === '例）○○商事' && r0.steps[2].row === 2 && r0.steps[2].label === '品名' && r0.steps[2].vkind === 'text' && r0.steps[2].value === 'THC', r0.steps.slice(0, 3));
  ok('値の種類（数値・文字数・ON）', r0.steps[3].vkind === 'number' && r0.steps[3].value === '12,345.50' && r0.steps[1].vkind === 'chars' && r0.steps[1].value === 8 && r0.steps[5].vkind === 'onoff' && r0.steps[5].value === true);
  ok('連打 ×3 と通知・エラーの中身', r0.steps[11].times === 3 && r0.steps[7].type === 'warn' && /入力が足りません/.test(r0.steps[7].msg) && /TypeError/.test(r0.steps[8].msg), r0.steps[11]);
  ok('節（起きたこと・エラー）も読める', /あ/.test(r0.sections['起きたこと']) && r0.errors.length === 1 && r0.hasRecording, r0.errors);
  ok('最後の注意書き（記録 …）はエラーに混ざらない', parseReport(body + '\n（記録 0:14・12手順。伏せています）').errors.length === 1);
  ok('処理の方法：書かれていない古い報告はバッチ・リアルタイムは realtime', r0.mode === 'batch' && parseReport('【処理の方法】⚡ リアルタイム（すぐ直す）\n' + body).mode === 'realtime');
  ok('【処理の方法】の行があっても手順は同じに読める', parseReport('【処理の方法】🕐 バッチ（まとめて直す）\n\n' + body).steps.length === 12);
  ok('見張り番の報告でない本文は手順なし', !parseReport('ただの報告').hasRecording && parseReport('ただの報告').steps.length === 0);

  // ② fetch-feedback（偽の RPC サーバー）
  const rows = [
    { report_no: 11, status: 'open', category: 'バグ報告', body: 'ふつうの報告', context: {} },
    { report_no: 12, status: 'open', category: 'バグ報告', body, context: { recording: { steps: 12, seconds: 14, marks: 1, errors: 1 } } },
    { report_no: 13, status: 'resolved', category: 'バグ報告', body, context: {} },
    { report_no: 14, status: 'open', category: 'バグ報告', body: '【処理の方法】⚡ リアルタイム（すぐ直す）\n\n' + body, context: { recording: { steps: 12, mode: 'realtime' } } },
    { report_no: 15, status: 'open', category: 'バグ報告', body: '【処理の方法】🕐 バッチ（まとめて直す）\n\n' + body, context: { recording: { steps: 12, mode: 'realtime' } } },
  ];
  const rpc = http.createServer((q, r) => { let b = ''; q.on('data', d => (b += d)); q.on('end', () => { r.writeHead(200, { 'Content-Type': 'application/json' }); r.end(JSON.stringify(rows)); }); });
  await new Promise(r => rpc.listen(0, '127.0.0.1', r));
  const env = Object.assign({}, process.env, { SUPABASE_URL: 'http://127.0.0.1:' + rpc.address().port, SUPABASE_ANON_KEY: 'k', FEEDBACK_EXPORT_TOKEN: 't' });
  // 偽サーバーは同じプロセスにいるので、子プロセスは非同期で呼ぶ（同期だとサーバーが応答できず固まる）
  const run = (args) => new Promise(res => execFile('node', [path.join(root, 'scripts', 'fetch-feedback.js')].concat(args), { env, encoding: 'utf8' }, (err, stdout, stderr) => res({ status: err ? (err.code || 1) : 0, stdout, stderr })));
  const a = (await run(['--recordings', '--status', 'open'])).stdout;
  ok('--recordings --status open：再現記録つきの未対応だけ（#11・#13 は出ない）', /#12/.test(a) && !/#11/.test(a) && !/#13/.test(a), a.slice(0, 300));
  const rt = (await run(['--recordings', '--mode', 'realtime'])).stdout;
  ok('--mode realtime：リアルタイムを選んだ報告だけ（本文の選び直しを優先）', /#14/.test(rt) && !/#15/.test(rt) && !/#12/.test(rt), rt.slice(0, 300));
  const bt = (await run(['--recordings', '--status', 'open', '--mode', 'batch'])).stdout;
  ok('--mode batch：バッチの報告（行の無い古い記録もバッチ扱い）', /#12/.test(bt) && /#15/.test(bt) && !/#14/.test(bt), bt.slice(0, 300));
  ok('一覧に処理の方法が出る', /処理の方法: ⚡ リアルタイム/.test(rt), rt);
  ok('一覧に「再現記録つき」の行が出る', /🔴 再現記録つき: 12手順/.test(a), a);
  const raw = (await run(['--report', '12', '--raw'])).stdout;
  ok('--report 12 --raw：本文だけ（そのまま再生に渡せる）', raw.startsWith('【起きたこと】') && raw.includes('【再現手順（自動記録）】') && !raw.includes('# 不具合報告'), raw.slice(0, 80));
  const miss = await run(['--report', '99']);
  ok('存在しない番号は分かりやすく失敗', miss.status === 1 && /見つかりません/.test(miss.stderr), miss.stderr);
  rpc.close();

  // ③ 実際に見張り番で記録 → 自動再生
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v1`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#fbQuickFab', { state: 'attached' });
  await p.evaluate(() => { window.qpNewQuote(); });                 // 記録の前に新しい見積を開いておく（再生側は --init で同じ状態にする）
  await p.waitForTimeout(500);
  await p.keyboard.press('Control+Shift+L');
  await p.fill('#qf-customer', '山田商事株式会社'); await p.keyboard.press('Tab');
  await p.fill('#tableBody tr[id^="row-"] [data-field="nm"]', 'THC'); await p.keyboard.press('Tab');
  await p.fill('#tableBody tr[id^="row-"] [data-field="pp"]', '12345.5'); await p.keyboard.press('Tab');
    await p.evaluate(() => { console.error('テスト用のエラー ABC'); });
  await p.keyboard.press('Control+Shift+L');
  await p.waitForSelector('#fbBrecMode');
  await p.click('#fbBrecMode [data-mode="batch"]');
  await p.waitForSelector('#fbOverlay.open');
  const recBody = await p.evaluate(() => document.getElementById('fbBody').value);
  const catLabel = await p.evaluate(() => { const o = document.querySelector('#tableBody tr[id^="row-"] [data-field="cat"]').options; return o[1] ? o[1].text : ''; });
  const f = path.join(tmp, 'report.txt');
  fs.writeFileSync(f, recBody);
  await b.close();
  // spawnSync は同じプロセスのサーバーを止めてしまうので、旧画面を配る静的サーバーは別プロセスで立てる
  const { spawn } = require('child_process');
  const srv2 = spawn('node', ['-e', `const http=require('http'),fs=require('fs'),path=require('path');const root=${JSON.stringify(root)};http.createServer((q,r)=>{const f=path.join(root,decodeURIComponent(q.url.split('?')[0]));if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end();return;}r.writeHead(200,{'Content-Type':f.endsWith('.css')?'text/css':f.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(r);}).listen(0,'127.0.0.1',function(){console.log(this.address().port)});`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port2 = await new Promise(res => srv2.stdout.once('data', d => res(String(d).trim())));
  const U1 = ['--url', `http://127.0.0.1:${port2}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v1`];

  const rp = spawnSync('node', [path.join(root, 'scripts', 'replay-recording.js'), '--file', f, ...U1, '--init', 'qpNewQuote()',
    '--eval', `(() => { const r = document.querySelector('#tableBody tr[id^="row-"]'); return { nm: r.querySelector('[data-field="nm"]').value, pp: r.querySelector('[data-field="pp"]').value, cust: document.getElementById('qf-customer').value.length }; })()`],
  { encoding: 'utf8', timeout: 90000 });
  const out = rp.stdout;
  ok('自動再生が最後まで実行できる（終了コード 0）', rp.status === 0, { status: rp.status, err: rp.stderr.slice(0, 300), out: out.slice(0, 600) });
  ok('手順がすべて実行できた', /手順：(\d+) 件中 \1 件を実行できた/.test(out) && !/❌/.test(out), out.slice(0, 700));
  ok('品名は残る・金額は 5 に置き換え・お客様名は文字数ぶんの x', /"nm":"THC"/.test(out) && /"pp":"55555\.5"/.test(out) && /"cust":8/.test(out), out.slice(-300));
  ok('記録されていたエラーを照合して、判定が出る（元の文字のまま・注意書きは混ざらない）', /記録との照合/.test(out) && /判定：再現できず/.test(out) && /テスト用のエラー ABC/.test(out) && !/（記録 \d+:\d\d/.test(out), out.slice(-500));
  const j = spawnSync('node', [path.join(root, 'scripts', 'replay-recording.js'), '--file', f, ...U1, '--init', 'qpNewQuote()', '--json'], { encoding: 'utf8', timeout: 90000 });
  let jj = null; try { jj = JSON.parse(j.stdout); } catch (e) {}
  ok('--json は機械で読める（手順・エラー・判定）', jj && Array.isArray(jj.steps) && jj.failedSteps === 0 && typeof jj.verdict === 'string', j.stdout.slice(0, 200));

  // 選択欄・ON/OFF・キー操作の再生（手書きの手順）
  const manual = ['【再現手順（自動記録）】',
    '1. [0:01・quote-make] 「品名」に入力 → THC（明細1行目）',
    '2. [0:02・quote-make] キー操作：Ctrl+Z',
    '3. [0:03・quote-make] 「カテゴリ」を選ぶ → ' + catLabel + '（明細1行目）',
    '4. [0:04・quote-make] 🚩 ここで不具合に気づいた', ''].join('\n');
  fs.writeFileSync(path.join(tmp, 'manual.txt'), manual);
  const rm = spawnSync('node', [path.join(root, 'scripts', 'replay-recording.js'), '--file', path.join(tmp, 'manual.txt'), ...U1, '--init', 'qpNewQuote()',
    '--eval', `document.querySelector('#tableBody tr[id^="row-"] [data-field="cat"]').selectedIndex`], { encoding: 'utf8', timeout: 90000 });
  ok('選択欄を選び直せる・キー操作・🚩も再生できる', rm.status === 0 && /最後の画面の確認[\s\S]*`1`/.test(rm.stdout) && /🚩/.test(rm.stdout) && /キー：Ctrl\+Z/.test(rm.stdout), { status: rm.status, out: rm.stdout.slice(0, 700), cat: catLabel });

  // 壊れた手順（存在しない id）→ 落ちずに ❌ として報告・終了コード 1
  const bad = body.replace('#qf-customer', '#no-such-field').split('【記録の開始時')[0] + '\n';
  fs.writeFileSync(path.join(tmp, 'bad.txt'), bad.replace(/^\d+\. \[0:0[0-9]・quote-make\] ⚠.*$/m, ''));
  const rb = spawnSync('node', [path.join(root, 'scripts', 'replay-recording.js'), '--file', path.join(tmp, 'bad.txt'), ...U1], { encoding: 'utf8', timeout: 90000 });
  ok('実行できない手順は ❌ で報告し、落ちない（終了コード 1）', rb.status === 1 && /❌/.test(rb.stdout) && /--init/.test(rb.stdout), { status: rb.status, out: rb.stdout.slice(0, 400), err: rb.stderr.slice(0, 200) });
  const rn = spawnSync('node', [path.join(root, 'scripts', 'replay-recording.js'), '--file', path.join(tmp, 'nothing.txt')], { encoding: 'utf8' });
  ok('ファイルが無い場合は使い方の誤りとして終了（コード 2 か例外でない）', rn.status !== 0, rn.status);

  srv.close(); srv2.kill();
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

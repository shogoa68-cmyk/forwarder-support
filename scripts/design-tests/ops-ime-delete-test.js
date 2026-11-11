// 操作まわりの回帰：①日本語入力の変換確定の Enter でコマンドパレット／タグ／一括設定が動かない
//   ②選択行の一括削除で、その行にぶら下がる子リマーク行も消え、グループ見出しが作り直される
//   node scripts/design-tests/ops-ime-delete-test.js          （THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const ok = (n, c, x) => console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x)));
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch(process.env.PW_EXE ? { executablePath: process.env.PW_EXE, args: ['--no-sandbox'] } : {});
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(500);

  // IME 変換中の keydown（isComposing:true）を送る
  const key = (sel, k, comp = true) => p.evaluate(([s, k, c]) => { const el = document.querySelector(s); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: k, isComposing: c, keyCode: c ? 229 : 13, bubbles: true, cancelable: true })); }, [sel, k, comp]);

  // ① コマンドパレット
  await p.evaluate(() => openCmdPalette()); await p.waitForTimeout(100);
  const rows0 = await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^=row-]').length);
  await p.fill('#cmdInput', '行を追加');
  await key('#cmdInput', 'Enter');
  ok('パレット：変換確定の Enter ではコマンドを実行しない', await p.evaluate(() => document.getElementById('cmdPalette').classList.contains('open')) && await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^=row-]').length) === rows0);
  await p.keyboard.press('Enter');
  ok('パレット：通常の Enter では実行される', await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^=row-]').length) === rows0 + 1);
  await p.evaluate(() => closeCmdPalette());

  // ② タグ入力
  await p.evaluate(() => { const i = document.getElementById('qfTagsInput'); i.value = 'きゅうぎょう'; });
  await key('#qfTagsInput', 'Enter');
  ok('タグ：変換確定の Enter ではタグを足さない', await p.evaluate(() => document.getElementById('qf-tags-data').value) === '[]');
  await key('#qfTagsInput', 'Enter', false);
  ok('タグ：通常の Enter では足される', (await p.evaluate(() => document.getElementById('qf-tags-data').value)).includes('きゅうぎょう'));

  // ③ 一括設定（サブコン）
  await p.evaluate(() => { addRow(); addRow(); });
  const id = await p.evaluate(() => document.querySelector('#tableBody tr[id^=row-]').id.replace('row-', ''));
  await p.evaluate(id => { document.querySelector(`#row-${id} .row-select-chk`).click(); }, id);
  await p.fill('#bulkSubconSet', 'ほげ');
  await key('#bulkSubconSet', 'Enter');
  ok('一括サブコン：変換確定の Enter では設定されない', await p.evaluate(id => document.getElementById('sv-' + id).value, id) === '');
  await p.evaluate(id => document.querySelector(`#row-${id} .row-select-chk`).click(), id);

  // ④ 一括削除で子リマーク行が残らない
  await p.evaluate(() => { document.querySelectorAll('.row-select-chk:checked').forEach(c => c.click()); });
  await p.evaluate(id => { insertRemarkRow(id); }, id);
  ok('前提：子リマーク行がある', await p.evaluate(id => !!document.querySelector(`#tableBody tr[data-parent-id="${id}"]`), id));
  await p.evaluate(id => document.querySelector(`#row-${id} .row-select-chk`).click(), id);
  await p.evaluate(() => deleteSelectedRows());
  ok('一括削除：親行にぶら下がるリマーク行も消える', await p.evaluate(id => !document.querySelector(`#tableBody tr[data-parent-id="${id}"]`) && !document.getElementById('row-' + id), id));
  // ⑤ 選択モード中に行の操作ボタンを押しても、その行の選択は切り替わらない
  await p.evaluate(() => { addRow(); addRow(); });
  const ids = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^=row-]:not([data-type])')].slice(-2).map(r => r.id));
  await p.evaluate(i => document.querySelector(`#${i[0]} .row-select-chk`).click(), ids);
  await p.evaluate(i => document.querySelector(`#${i[1]} .row-done-btn`).click(), ids);
  await p.evaluate(i => document.querySelector(`#${i[1]} .row-add-btn`).click(), ids);
  ok('選択モード：行のボタン（完了・追加）を押しても選択は変わらない', await p.evaluate(() => [...document.querySelectorAll('.row-select-chk:checked')].length) === 1);
  // ⑥ 元に戻す／やり直し：行の番号が振り直されても、続けて戻せる・やり直せる
  const ctx2 = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx2.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx2.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const q = await ctx2.newPage(); q.on('dialog', d => d.accept()); q.setDefaultTimeout(8000);
  await q.goto(URL, { waitUntil: 'domcontentloaded' }); await q.waitForTimeout(700);
  await q.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await q.waitForTimeout(900);
  await q.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await q.waitForTimeout(500);
  const names = () => q.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^=row-]:not([data-type])')].map(r => r.querySelector('[data-field=nm]').value).join(','));
  await q.evaluate(() => { addRow(); addRow(); });
  await q.fill('#nm-1', 'A'); await q.fill('#nm-2', 'B'); await q.fill('#nm-3', 'C'); await q.waitForTimeout(900);
  await q.evaluate(() => document.querySelector('#row-2 .row-dup-btn').click()); await q.waitForTimeout(900);   // A,B,B,C
  await q.evaluate(() => document.querySelector('#row-1 .row-del-btn').click()); await q.waitForTimeout(900);   // B,B,C（行番号が詰まる）
  await q.evaluate(() => document.activeElement && document.activeElement.blur());
  await q.keyboard.press('Control+z'); await q.waitForTimeout(500);
  ok('元に戻す 1 回目：削除が戻る', await names() === 'A,B,B,C', await names());
  await q.keyboard.press('Control+z'); await q.waitForTimeout(500);
  ok('元に戻す 2 回目：複製が戻る（何も起きない 1 回を挟まない）', await names() === 'A,B,C', await names());
  await q.keyboard.press('Control+y'); await q.waitForTimeout(500);
  ok('やり直し 1 回目：複製が再度入る', await names() === 'A,B,B,C', await names());
  await q.keyboard.press('Control+y'); await q.waitForTimeout(500);
  ok('やり直し 2 回目：削除が再度行われる（やり直しの履歴が消えない）', await names() === 'B,B,C', await names());
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
})();

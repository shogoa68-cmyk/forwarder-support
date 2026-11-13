// コンパクト表示（常に前面の小窓・Document Picture-in-Picture）の試験。
//   本物の PiP は自動操作できないため、requestWindow を「小さな別ウィンドウ（window.open）」に差し替えて、小窓の中身と
//   元の行への読み書きを確かめる。   node scripts/design-tests/pip-compact-test.js   （THEME=1 Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.removeItem('quotePipSize_v1'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);

  // 非対応のブラウザ：案内が出て、何も起きない
  await p.evaluate(() => { window.__toasts = []; window.quoteShowToast = m => window.__toasts.push(m); delete window.documentPictureInPicture; try { Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true }); } catch (e) {} });
  await p.evaluate(() => window.quotePipToggle()); await p.waitForTimeout(200);
  ok('未対応のブラウザでは、Chrome／Edge で使える旨の案内が出る', await p.evaluate(() => window.__toasts.some(t => /Chrome|Edge/.test(t))));

  // 入口のボタン
  ok('テーブル操作バーに「🪟 常に前面」ボタンがある', await p.evaluate(() => !!document.querySelector('.quote-cmdbar .cmdbar-pip-btn[data-pip-btn]')));
  ok('「⋯」メニューにも「常に前面」がある', await p.evaluate(() => !!document.querySelector('#tbMenuMore [data-pip-btn]')));

  // PiP を、別ウィンドウで代用
  await p.evaluate(() => {
    Object.defineProperty(window, 'documentPictureInPicture', { configurable: true, value: { requestWindow: async o => { const w = window.open('', '_blank', `width=${o.width},height=${o.height}`); w.document.open(); w.document.write('<!doctype html><html><head></head><body></body></html>'); w.document.close(); return w; } } });
  });
  const set = (id, f, v) => p.evaluate(([id, f, v]) => { const el = document.querySelector(`#tableBody tr#row-${id} [data-field="${f}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, f, v]);
  const rowIds = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].map(t => t.id.replace('row-', '')));
  const first = (await rowIds())[0];
  await set(first, 'nm', 'THC 20'); await set(first, 'sv', 'WAN HAI'); await set(first, 'un', "20'GP"); await set(first, 'pq', '1'); await set(first, 'pp', '36000');
  await p.waitForTimeout(300);
  const popupP = ctx.waitForEvent('page');
  await p.evaluate(() => window.quotePipToggle());
  const pop = await popupP; await pop.waitForLoadState().catch(() => {}); await pop.waitForTimeout(600);
  ok('小窓が開く', !!pop);
  const q = (f, a) => pop.evaluate(f, a);
  ok('小窓に明細が 1 行出る（品名・サブコン・数量・単位が元の行の値）', await q(() => { const r = document.querySelector('.row'); return !!r && r.querySelector('[data-bind="nm"]').value === 'THC 20' && r.querySelector('[data-bind="sv"]').value === 'WAN HAI' && r.querySelector('[data-bind="pq"]').value === '1' && r.querySelector('[data-bind="un"]').value === "20'GP" && r.querySelector('[data-bind="pp"]').value === '36000'; }));
  ok('ボタンは「表示中」になる', await p.evaluate(() => /表示中/.test(document.querySelector('.cmdbar-pip-btn').textContent) && document.querySelector('.cmdbar-pip-btn').classList.contains('is-on')));
  ok('合計（仕・売・粗利）が小窓の見出しに出る', await q(() => document.getElementById('pcSell').textContent.trim() !== '' && document.getElementById('pcCost').textContent.trim() !== ''));

  await pop.screenshot({ path: path.join(process.env.OUT || '/tmp', 'pip-compact.png') }).catch(() => {});
  // 小窓で入力 → 元の行へ
  await pop.fill('.row [data-bind="pp"]', '40000'); await pop.waitForTimeout(400);
  ok('小窓で仕入単価を打つと、元の行の欄に入る', await p.evaluate(id => document.querySelector(`#tableBody tr#row-${id} [data-field="pp"]`).value === '40000', first));
  ok('元の行の売単価・金額が再計算される（小窓の「単価」も更新）', await p.evaluate(id => { const v = document.querySelector(`#tableBody tr#row-${id} [data-field="bp"]`).value; return !!v && v !== '0'; }, first) && await q(() => /\d/.test(document.querySelector('[data-calc="bp"]').textContent)));
  await pop.fill('.row [data-bind="nm"]', 'SEAL'); await pop.fill('.row [data-bind="sv"]', 'KMTC'); await pop.waitForTimeout(300);
  ok('品名・サブコンも元の行へ入る', await p.evaluate(id => document.querySelector(`#tableBody tr#row-${id} [data-field="nm"]`).value === 'SEAL' && document.querySelector(`#tableBody tr#row-${id} [data-field="sv"]`).value === 'KMTC', first));

  // 元の画面で変えたら小窓へ
  await set(first, 'pq', '3'); await pop.waitForTimeout(1900);
  ok('元の画面で数量を変えると、小窓にも反映される', await q(() => document.querySelector('.row [data-bind="pq"]').value === '3'));

  // 行追加・削除
  await pop.click('#pcAdd'); await pop.waitForTimeout(700);
  ok('小窓の「＋ 行を追加」で行が増える（小窓・元の画面の両方）', (await rowIds()).length === 2 && await q(() => document.querySelectorAll('.row').length === 2));
  ok('増えた行の品名欄に焦点が移る', await q(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.bind === 'nm'));
  await pop.click('.row:nth-child(1) [data-act="add"]'); await pop.waitForTimeout(700);
  ok('行の「＋」で、その行の下に追加される（3 行）', (await rowIds()).length === 3 && await q(() => document.querySelectorAll('.row').length === 3));
  p.on('dialog', d => d.accept());
  await pop.click('.row:nth-child(3) [data-act="del"]'); await pop.waitForTimeout(900);
  ok('行の「🗑」で削除される（確認のあと 2 行）', (await rowIds()).length === 2 && await q(() => document.querySelectorAll('.row').length === 2));

  // ---- 入力の範囲（サブコン別／サブコン→パターン別）----
  {
    const ids = await rowIds();
    await set(ids[0], 'nm', 'THC'); await set(ids[0], 'sv', 'WAN HAI'); await set(ids[0], 'pt', 'FCL案'); await set(ids[0], 'pp', '100');
    await set(ids[1], 'nm', 'DOC'); await set(ids[1], 'sv', 'WAN HAI'); await set(ids[1], 'pt', 'LCL案'); await set(ids[1], 'pp', '200');
    await pop.click('#pcAdd'); await pop.waitForTimeout(600);
    const ids3 = await rowIds(); const id3 = ids3.find(i => !ids.includes(i));
    await set(id3, 'nm', 'CFS'); await set(id3, 'sv', 'KMTC'); await set(id3, 'pp', '300');
    await p.waitForTimeout(1800);
    const names = () => q(() => [...document.querySelectorAll('.row [data-bind="nm"]')].map(x => x.value));
    ok('範囲の選択欄に、すべて＋サブコン（WAN HAI・KMTC）が並ぶ', await q(() => { const o = [...document.querySelectorAll('#pcSv option')].map(x => x.textContent); return o[0] === 'すべてのサブコン' && o.includes('WAN HAI') && o.includes('KMTC'); }));
    ok('初期は「すべて」で全 3 行', (await names()).length === 3);
    // ① サブコン別
    await pop.selectOption('#pcSv', { label: 'WAN HAI' }); await pop.waitForTimeout(400);
    ok('① サブコン WAN HAI を選ぶと、その 2 行だけになる', JSON.stringify(await names()) === JSON.stringify(['THC', 'DOC']), await names());
    ok('範囲を選ぶと、サブコン欄は行から外れ、パターン欄が出る', await q(() => !document.querySelector('.row [data-bind="sv"]') && !!document.querySelector('.row [data-bind="pt"]') && !document.getElementById('pcPt').hidden));
    ok('パターンの選択肢は、そのサブコンのパターン（FCL案・LCL案）', await q(() => { const o = [...document.querySelectorAll('#pcPt option')].map(x => x.textContent); return o.includes('FCL案') && o.includes('LCL案') && !o.includes('KMTC'); }));
    ok('範囲の売合計が出る', await q(() => /この範囲の売合計/.test(document.getElementById('pcScopeSum').textContent)));
    await pop.screenshot({ path: path.join(process.env.OUT || '/tmp', 'pip-scope.png') }).catch(() => {});
    await pop.click('#pcAdd'); await pop.waitForTimeout(700);
    const nid = (await rowIds()).find(i => !ids3.includes(i));
    ok('① 範囲を選んで「＋ 行を追加」すると、そのサブコンの行として追加される', await p.evaluate(i => document.querySelector(`#tableBody tr#row-${i} [data-field="sv"]`).value === 'WAN HAI', nid) && (await names()).length === 3);
    // ② サブコン→パターン別
    await pop.selectOption('#pcPt', { label: 'FCL案' }); await pop.waitForTimeout(400);
    const n2 = await names();
    ok('② パターン FCL案 を選ぶと、そのパターンの行だけになる（THC と追加した行がパターンを引き継ぐ場合を含む）', n2.includes('THC') && !n2.includes('DOC') && !n2.includes('CFS'), n2);
    ok('パターンまで選ぶと、行にパターン欄は出ない', await q(() => !document.querySelector('.row [data-bind="pt"]')));
    const cntBefore = (await names()).length;
    await pop.click('#pcAdd'); await pop.waitForTimeout(700);
    const nid2 = (await rowIds()).find(i => ![...ids3, nid].includes(i));
    ok('② 範囲を選んで追加すると、サブコンとパターンの両方がその範囲になる', await p.evaluate(i => { const g = k => document.querySelector(`#tableBody tr#row-${i} [data-field="${k}"]`).value; return g('sv') === 'WAN HAI' && g('pt') === 'FCL案'; }, nid2) && (await names()).length === cntBefore + 1);
    // 戻す
    await pop.selectOption('#pcPt', { label: 'すべてのパターン' }); await pop.waitForTimeout(300);
    ok('パターンを「すべて」に戻すと、そのサブコンの行が全部出る', (await names()).includes('DOC'));
    await pop.selectOption('#pcSv', { label: 'KMTC' }); await pop.waitForTimeout(300);
    ok('別のサブコン（KMTC）に切り替えると、パターンの選択は「すべて」に戻り、KMTC の行だけ', JSON.stringify(await names()) === JSON.stringify(['CFS']), await names());
    await pop.selectOption('#pcSv', { label: 'すべてのサブコン' }); await pop.waitForTimeout(300);
    ok('「すべてのサブコン」に戻すと全行が出て、パターン欄も戻る', (await names()).length >= 5 && await q(() => !!document.querySelector('.row [data-bind="sv"]') && document.getElementById('pcPt').hidden));
  }
  // ---- 入力完了のボタン ----
  {
    const id0 = (await rowIds())[0];
    ok('各行に「入力完了」ボタンがあり、最初は未完了', await q(() => { const b = document.querySelector('.row [data-act="done"]'); return !!b && b.getAttribute('aria-pressed') === 'false' && !b.classList.contains('is-on'); }));
    await p.evaluate(() => { window.cloudCurrentUser = () => ({ email: 'taro@example.com' }); window.cloudNameFor = () => '山田太郎'; });
    await pop.click('.row:nth-child(1) [data-act="done"]'); await pop.waitForTimeout(500);
    ok('押すと、元の行が入力完了になる（日時・ユーザーも記録）', await p.evaluate(id => { const t = document.getElementById('row-' + id); return t.dataset.done === '1' && !!t.dataset.doneAt && t.dataset.doneBy === 'taro@example.com'; }, id0));
    ok('小窓のボタンが「完了済み」（緑）になり、吹き出しに日時・ユーザーが出る', await q(() => { const b = document.querySelector('.row [data-act="done"]'); return b.classList.contains('is-on') && /完了済み/.test(b.textContent) && /山田太郎/.test(b.title); }));
    ok('見出しの「完了 N」に数える', await q(() => /完了 1/.test(document.getElementById('pcCount').textContent)));
    await set(id0, 'pq', '4'); await p.waitForTimeout(100);
    // 元の画面で解除 → 小窓へ
    await p.evaluate(id => document.querySelector(`#tableBody tr#row-${id} .row-done-btn`).click(), id0); await pop.waitForTimeout(1900);
    ok('元の画面で完了を解除すると、小窓のボタンも未完了に戻る', await q(() => { const b = document.querySelector('.row [data-act="done"]'); return !b.classList.contains('is-on') && /✓ 完了$/.test(b.textContent); }));
    await pop.click('.row:nth-child(1) [data-act="done"]'); await pop.waitForTimeout(400);
    await pop.click('.row:nth-child(1) [data-act="done"]'); await pop.waitForTimeout(400);
    ok('もう一度押すと解除され、記録も消える', await p.evaluate(id => { const t = document.getElementById('row-' + id); return !t.dataset.done && !t.dataset.doneAt; }, id0));
  }
  // ---- 並び替え（▲▼）----
  {
    // 同じサブコン・パターンの行を 3 つ（A・B・C）用意する
    const idsNow = await rowIds();
    for (let k = idsNow.length; k < 3; k++) { await pop.click('#pcAdd'); await pop.waitForTimeout(500); }
    const three = (await rowIds()).slice(0, 3);
    for (const [i, id] of three.entries()) { await set(id, 'sv', 'ORD CO'); await set(id, 'pt', ''); await set(id, 'nm', 'ROW' + 'ABC'[i]); }
    await p.waitForTimeout(1800);
    await pop.selectOption('#pcSv', { label: 'ORD CO' }); await pop.waitForTimeout(400);
    const names = () => q(() => [...document.querySelectorAll('.row [data-bind="nm"]')].map(x => x.value));
    const mainOrder = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) [data-field="nm"]')].map(x => x.value).filter(v => /^ROW/.test(v)));
    ok('並び替えボタンがある。先頭の行の▲と末尾の行の▼は押せない', await q(() => { const rs = document.querySelectorAll('.row'); return rs[0].querySelector('[data-act="up"]').disabled && !rs[0].querySelector('[data-act="down"]').disabled && rs[rs.length - 1].querySelector('[data-act="down"]').disabled; }));
    await pop.click('.row:nth-child(1) [data-act="down"]'); await pop.waitForTimeout(700);
    ok('▼で 1 つ下へ動く（小窓）', JSON.stringify(await names()) === JSON.stringify(['ROWB', 'ROWA', 'ROWC']), await names());
    ok('元の画面の並びも変わる', JSON.stringify(await mainOrder()) === JSON.stringify(['ROWB', 'ROWA', 'ROWC']), await mainOrder());
    await pop.click('.row:nth-child(3) [data-act="up"]'); await pop.waitForTimeout(700);
    ok('▲で 1 つ上へ動く', JSON.stringify(await names()) === JSON.stringify(['ROWB', 'ROWC', 'ROWA']), await names());
    ok('動かした行のボタンに焦点が残り、続けて押せる', await q(() => document.activeElement && document.activeElement.dataset.act === 'up'));
    // グループをまたがない：別のサブコンの行とは入れ替わらない
    await pop.selectOption('#pcSv', { label: 'すべてのサブコン' }); await pop.waitForTimeout(400);
    const before = await mainOrder();
    await pop.click('.row[data-row] >> nth=0').catch(() => {});
    ok('サブコンが違う行どうしでは動かない（グループの端の▲▼は押せない）', await q(() => { const rs = [...document.querySelectorAll('.row')]; return rs.every(r => { const sv = r.querySelector('[data-bind="sv"]').value; const same = rs.filter(x => x.querySelector('[data-bind="sv"]').value === sv); return same.length > 1 || (r.querySelector('[data-act="up"]').disabled && r.querySelector('[data-act="down"]').disabled); }); }));
  }
  // ---- 課税 ----
  {
    const id0 = (await rowIds())[0];
    const txMain = () => p.evaluate(id => ({ c: document.querySelector(`#tableBody tr#row-${id} [data-field="tx"]`).checked, nm: document.querySelector(`#tableBody tr#row-${id} [data-field="nm"]`).value, u: document.getElementById('row-' + id).dataset.txUserSet || '' }), id0);
    ok('各行に「課税」のチェックがあり、元の行と同じ状態', await q(() => !!document.querySelector('.row [data-bind="tx"]')) && (await q(() => document.querySelector('.row [data-bind="tx"]').checked)) === (await txMain()).c);
    const was = (await txMain()).c;
    await pop.click('.row:nth-child(1) [data-bind="tx"]'); await pop.waitForTimeout(500);
    const m = await txMain();
    ok('小窓で課税をチェックすると、元の行も切り替わる（元の onchange が働き、手で操作した印が付く）', m.c === !was && m.u === '1', m);
    ok(was ? '課税を外すと品名の「*」が外れる' : '課税にすると品名の先頭に「*」が付く（小窓の品名にも反映）', was ? !/^\*/.test(m.nm) : /^\*/.test(m.nm) && await q(() => /^\*/.test(document.querySelector('.row [data-bind="nm"]').value)), m);
    await p.evaluate(([id, w]) => { const c = document.querySelector(`#tableBody tr#row-${id} [data-field="tx"]`); c.checked = w; c.dispatchEvent(new Event('change', { bubbles: true })); }, [id0, was]); await pop.waitForTimeout(1900);
    ok('元の画面で課税を戻すと、小窓のチェックも戻る', await q(w => document.querySelector('.row [data-bind="tx"]').checked === w, was));
  }
  // 閉じる
  await pop.click('#pcClose').catch(() => {}); await p.waitForTimeout(600);
  ok('閉じると、ボタンは元の表示に戻る', await p.evaluate(() => !/表示中/.test(document.querySelector('.cmdbar-pip-btn').textContent)));
  ok('閉じたあと、画面を操作してもエラーにならない', await (async () => { await set(first, 'pq', '5'); await p.waitForTimeout(1800); return errs.length === 0; })(), errs);
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

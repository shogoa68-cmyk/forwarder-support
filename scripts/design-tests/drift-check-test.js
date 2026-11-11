// ゆらぎチェック（js/drift-engine.js・js/drift-check.js）：判定の仕分け・自動登録（管理者のみ）・カードの操作・元に戻す・別物にする
// 使い方: node scripts/design-tests/drift-check-test.js   （THEME=1 で Industry）
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  NG  ' + n + (d ? '  → ' + d : '')); } };
(async () => {
  // --- エンジン単体（Node） ---
  const E = require(path.resolve(__dirname, '..', '..', 'フォワーダー支援', 'js', 'drift-engine.js'));
  ok('綴りの入れ替え（Maersk⇄Maesrk）は 1 文字違い', E.levenshtein('maerskline', 'maesrkline', 2) === 1);
  ok('数字だけ違う名前は別物（20GP／40GP）', E.similar('nm', '20gpコンテナ', '40gpコンテナ') === null);
  ok('法人格の種類が違う会社は別物', E.similar('customer', 'abc\x03株', 'abc\x03有') === null);
  ok('品名では「一部を含む」を似ているとしない', E.similar('nm', '海上運賃', '国際海上運賃') === null);

  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  p.on('dialog', d => d.accept());
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);

  // 疑似データ：実際の statsDriftInput（stats.js）に流し、マスター・別名は画面側の関数を差し替える
  const rows = [];
  const add = (customer, n) => { for (let i = 0; i < n; i++) rows.push({ id: customer + i + rows.length, customer, status: '下書き中', transport_mode: '海上輸送', updated_at: new Date().toISOString(), created_by: 'a@x', data: { fields: { 'qf-customer': customer }, rows: [] } }); };
  add('Maersk Line', 5); add('MAERSK LINE', 3); add('ＭＡＥＲＳＫ　ＬＩＮＥ', 1);   // 代表あり（自動）
  add('ABC運輸', 4); add('ＡＢＣ運輸', 2);                                         // 代表なし（要確認・代表を選ぶ）
  add('Hapag Lloyd', 6); add('Hapag Loyd', 1);                                      // 綴り違い（要確認・似ている）
  add('東洋商事', 3); add('東洋商事', 0);
  add('Alpha Co', 2); add('ALPHA CO', 2);                                           // 代表が 2 つ（人が判断）
  await p.evaluate(r => {
    window.cloudGetAllRows = () => r;
    window.cloudCurrentUser = () => ({ email: 'admin@x' });
    window._myRole = 'admin';
    window.statsAliasNeedsApproval = () => false;
    window.statsMastersReady = () => true;
    window.arGetExclusions = () => [];
    window.__groups = [{ field: 'customer', canonical: 'Maersk Line', aliases: [] }, { field: 'customer', canonical: 'Alpha Co', aliases: [] }, { field: 'customer', canonical: 'ALPHA CO', aliases: [] }];
    window.__calls = [];
    window.statsGetMasters = () => [];
    window.synGetGroups = f => window.__groups.filter(g => !f || g.field === f);
    window.synGetNormalizeMap = f => { const m = {}; window.__groups.filter(g => !f || g.field === f).forEach(g => (g.aliases || []).forEach(a => { m[a] = g.canonical; })); return m; };
    window.synAddAliasesMany = async (field, items) => { window.__calls.push(['many', field, JSON.stringify(items)]); items.forEach(it => { let g = window.__groups.find(x => x.field === field && x.canonical === it.canonical); if (!g) window.__groups.push(g = { field, canonical: it.canonical, aliases: [] }); g.aliases = [...new Set([...g.aliases, ...it.aliases])]; }); return { added: items.reduce((s, x) => s + x.aliases.length, 0), skipped: 0 }; };
    window.synRemoveAlias = async (field, alias, canonical) => { window.__calls.push(['remove', field, alias, canonical]); const g = window.__groups.find(x => x.field === field && x.canonical === canonical); if (g) g.aliases = g.aliases.filter(a => a !== alias); };
    window.synAddAlias = async (...a) => { window.__calls.push(['one', ...a]); };
    localStorage.removeItem('driftLog_v1'); localStorage.removeItem('driftLastRun_v1'); localStorage.removeItem('driftDismissed_v1');
    const d = document.createElement('div'); d.id = 'driftCard'; d.className = 'drift-card'; document.body.prepend(d);
  }, rows);

  // 1) 管理者：自動対応つきで実行
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  const calls = await p.evaluate(() => window.__calls);
  const many = calls.filter(c => c[0] === 'many');
  ok('代表（Maersk Line）がある読みの同じ表記を、別名として自動登録した', many.length === 1 && /MAERSK LINE/.test(many[0][2]) && /Maersk Line/.test(many[0][2]), JSON.stringify(calls));
  ok('代表の無いもの・似ているだけのものは自動登録しない', !/ABC|Hapag/.test(many[0] ? many[0][2] : ''));
  const res = await p.evaluate(() => window.driftDebug.res().customer);
  ok('登録後は、自動対応の候補が残らない', res.auto.length === 0, JSON.stringify(res.auto));
  ok('代表が決まっていない読み違いの表記（ABC運輸）は「代表を選ぶ」に出る', res.pick.some(x => x.variants.map(v => v.value).includes('ABC運輸')));
  ok('綴り違い（Hapag Lloyd／Loyd）が「似ている」に出る', res.near.some(n => /Hapag/.test(n.a + n.b)), JSON.stringify(res.near.map(n => [n.a, n.b])));
  ok('代表が 2 つある（Alpha Co／ALPHA CO）は人が判断に出る', res.human.some(h => h.kind === 'multi-master'));
  ok('実行日を記録した', await p.evaluate(() => !!localStorage.getItem('driftLastRun_v1')));

  // 2) カード
  await p.evaluate(() => window.driftRenderCard());
  const card = await p.evaluate(() => document.getElementById('driftCard').textContent);
  ok('カードに 3 つの区分が出る', /自動対応/.test(card) && /要確認/.test(card) && /人が判断/.test(card), card.slice(0, 200));
  ok('登録済みの別名が「元に戻す」つきで出る', await p.evaluate(() => [...document.querySelectorAll('#driftCard .drift-btn')].some(x => x.textContent === '元に戻す')));
  if (process.env.SHOT) { await p.evaluate(() => { document.querySelectorAll('#driftCard details').forEach(d => { d.open = true; }); }); await p.locator('#driftCard').screenshot({ path: process.env.SHOT }); }
  // 3) 代表を選ぶ
  await p.evaluate(() => { document.querySelectorAll('#driftCard details').forEach(d => { d.open = true; }); });
  await p.locator('#driftCard .drift-btn', { hasText: '「ABC運輸」を代表にする' }).first().click(); await p.waitForTimeout(400);
  const c2 = await p.evaluate(() => window.__calls.filter(c => c[0] === 'many'));
  ok('「ABC運輸を代表にする」で、ＡＢＣ運輸が別名として登録される', c2.length === 2 && /ＡＢＣ運輸/.test(c2[1][2]) && /"canonical":"ABC運輸"/.test(c2[1][2]), JSON.stringify(c2[1]));
  // 4) 別物にする
  await p.evaluate(() => { document.querySelectorAll('#driftCard details').forEach(d => { d.open = true; }); });
  const nearBefore = await p.evaluate(() => window.driftDebug.res().customer.near.length);
  await p.locator('#driftCard .drift-btn', { hasText: '≠ 別物' }).first().click(); await p.waitForTimeout(400);
  const nearAfter = await p.evaluate(() => window.driftDebug.res().customer.near.length);
  ok('「≠ 別物」にすると、その組は候補から消える', nearAfter === nearBefore - 1, nearBefore + ' → ' + nearAfter);
  // 5) 元に戻す → 同じ別名を自動で付け直さない
  await p.evaluate(() => { document.querySelectorAll('#driftCard details').forEach(d => { d.open = true; }); });
  await p.locator('#driftCard .drift-btn', { hasText: '元に戻す' }).first().click(); await p.waitForTimeout(400);
  ok('「元に戻す」で別名が外れる', await p.evaluate(() => window.__calls.some(c => c[0] === 'remove')));
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  const many2 = await p.evaluate(() => window.__calls.filter(c => c[0] === 'many').length);
  ok('元に戻した別名は、次の自動対応で付け直されない', many2 === 2, 'many=' + many2);

  // 6) メンバー（管理者でない）は自動登録しない
  await p.evaluate(() => { window._myRole = 'member'; window.__calls.length = 0; window.__groups = [{ field: 'customer', canonical: 'Maersk Line', aliases: [] }]; localStorage.removeItem('driftDismissed_v1'); });
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  ok('メンバーのときは自動登録しない（候補は出る）', await p.evaluate(() => window.__calls.length === 0 && window.driftDebug.res().customer.auto.length > 0));
  ok('ページエラーなし', errs.length === 0, JSON.stringify(errs));
  await b.close(); srv.close();
  console.log(`\n${pass} 項目 OK / ${fail} 件 NG`); process.exit(fail ? 1 : 0);
})();

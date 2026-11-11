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
    ['driftLog_v1', 'driftLastRun_v1', 'driftDismissed_v1', 'driftLog_v2'].forEach(k => localStorage.removeItem(k));
    // 共有の記録（drift_log）の疑似テーブル。window.__noTable = true で「SQL 未実行」を再現
    window.__driftStore = []; window.__noTable = false; window.__insFail = false;
    window.cloudGetClient = () => ({ from: t => {
      if (t !== 'drift_log') return { select: () => ({}) };
      const o = {};
      o.select = () => o; o.order = () => o; o.limit = () => Promise.resolve(window.__noTable ? { data: null, error: { message: 'relation "drift_log" does not exist' } } : { data: window.__driftStore.slice().sort((a, b) => new Date(a.at) - new Date(b.at)), error: null });
      o.insert = rows => Promise.resolve(window.__insFail ? { error: { message: 'denied' } } : (window.__driftStore.push(...rows.map(r => Object.assign({ id: 'id' + Math.random() }, r))), { error: null }));
      return o;
    } });
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
  const st1 = await p.evaluate(() => ({ shared: window.driftDebug.shared(), store: window.__driftStore.map(e => [e.kind, e.mode, e.by]), lastRun: window.driftDebug.derive().lastRun, due: window.driftDebug.due(), local: localStorage.getItem('driftLog_v2') }));
  ok('記録がチーム共有（drift_log）に書かれる（別名＝自動・実行記録）', st1.shared && st1.store.some(e => e[0] === 'alias' && e[1] === 'auto' && e[2] === 'admin@x') && st1.store.some(e => e[0] === 'run'), JSON.stringify(st1));
  ok('共有できているときは、この端末には記録を残さない', st1.local === null);
  ok('前回の実行日時が共有の記録から分かり、1 週間は次の自動チェックが走らない', st1.lastRun > 0 && st1.due === false);

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
  ok('「元に戻す」と「別物」も共有の記録に残る', await p.evaluate(() => window.__driftStore.some(e => e.kind === 'undo') && window.__driftStore.some(e => e.kind === 'dismiss')));

  // 別の管理者の端末：共有の記録に「元に戻した」があれば、こちらの端末でも自動で付け直さない
  await p.evaluate(() => { window.__calls.length = 0; window.__groups = [{ field: 'customer', canonical: 'Maersk Line', aliases: [] }]; window.__driftStore.length = 0; window.__driftStore.push({ at: new Date().toISOString(), kind: 'undo', field: 'customer', alias: 'MAERSK LINE', canonical: 'Maersk Line', by: 'other@x' }); });
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  const calls3 = await p.evaluate(() => window.__calls.filter(c => c[0] === 'many').map(c => c[2]));
  ok('他の管理者が元に戻した別名は、こちらの自動対応でも付け直さない（残りは登録される）', calls3.length === 1 && !/"MAERSK LINE"/.test(calls3[0]) && /ＭＡＥＲＳＫ/.test(calls3[0]), JSON.stringify(calls3));
  // 前回の実行が 10 日前なら、次の自動チェックの時期
  await p.evaluate(() => { window.__driftStore.forEach(e => { if (e.kind === 'run') e.at = new Date(Date.now() - 10 * 86400000).toISOString(); }); });
  await p.evaluate(() => window.driftDebug.loadLog());
  ok('前回の実行から 1 週間以上たてば、次の自動チェックの時期になる', await p.evaluate(() => window.driftDebug.due()));

  // 共有テーブルが無い（SQL 未実行）ときは、この端末に記録して動き続ける
  await p.evaluate(() => { window.__noTable = true; window.__calls.length = 0; window.__groups = [{ field: 'customer', canonical: 'Maersk Line', aliases: [] }]; });
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  const st2 = await p.evaluate(() => ({ shared: window.driftDebug.shared(), local: JSON.parse(localStorage.getItem('driftLog_v2') || '[]').map(e => e.kind) }));
  ok('共有テーブルが無いときは、この端末に記録して自動対応は動く', !st2.shared && st2.local.includes('alias') && st2.local.includes('run'), JSON.stringify(st2));
  // SQL を実行したら、この端末の記録は一度だけ共有へ移る（管理者）
  await p.evaluate(() => { window.__noTable = false; window.__driftStore.length = 0; });
  await p.evaluate(() => window.driftDebug.loadLog());
  const st3 = await p.evaluate(() => ({ shared: window.driftDebug.shared(), store: window.__driftStore.map(e => e.kind), local: localStorage.getItem('driftLog_v2') }));
  ok('共有できるようになると、この端末の記録が共有へ移り、端末側は消える', st3.shared && st3.store.includes('alias') && st3.store.includes('run') && st3.local === null, JSON.stringify(st3));
  // 共有に書けない（権限など）ときは、この端末に残す
  await p.evaluate(() => { window.__insFail = true; });
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  ok('共有に書けなかったときは、この端末に残して止まらない', await p.evaluate(() => (JSON.parse(localStorage.getItem('driftLog_v2') || '[]')).some(e => e.kind === 'run')));
  await p.evaluate(() => { window.__insFail = false; localStorage.removeItem('driftLog_v2'); });

  // 6) メンバー（管理者でない）は自動登録しない
  await p.evaluate(() => { window._myRole = 'member'; window.__calls.length = 0; window.__groups = [{ field: 'customer', canonical: 'Maersk Line', aliases: [] }]; localStorage.removeItem('driftDismissed_v1'); });
  await p.evaluate(() => window.driftDebug.run({ apply: true }));
  ok('メンバーのときは自動登録しない（候補は出る）', await p.evaluate(() => window.__calls.length === 0 && window.driftDebug.res().customer.auto.length > 0));
  ok('ページエラーなし', errs.length === 0, JSON.stringify(errs));
  await b.close(); srv.close();
  console.log(`\n${pass} 項目 OK / ${fail} 件 NG`); process.exit(fail ? 1 : 0);
})();

// ✅ 類似案件から行をインポートすると、引用元の「入力完了」の日時・ユーザーが「引用元の入力完了」として行に残る。
//   偽の Supabase（メモリ上）で、プレビューの日時タグ・インポート後の表示（入力完了マークは付けない）・保存と復元・自分で完了を押すと置き換わる・連鎖引用・行の高さ（Industry）を確かめる。
//   node scripts/design-tests/done-src-test.js           （THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };


  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    const cell = (sv, nm, pp, bp) => { const c = Array(34).fill(''); c[1] = 'other'; c[2] = sv; c[4] = nm; c[5] = '1'; c[6] = 'CNTR'; c[7] = '1'; c[8] = 'JPY'; c[9] = 'JPY'; c[10] = pp; c[11] = bp; return c; };
    const doneIso = '2026-10-05T05:30:00.000Z';
    const rows = [
      { _type: 'data', cells: cell('A社', 'THC', '10000', '12000'), done: true, doneAt: doneIso, doneBy: 'yamada@x.com' },
      { _type: 'data', cells: cell('A社', 'DOC FEE', '3000', '4000') },
      { _type: 'data', cells: cell('B社', 'CFS CHARGE', '2000', '2500'), srcDoneAt: '2026-09-01T01:00:00.000Z', srcDoneBy: 'suzuki@x.com', srcFrom: '元の元案件' },
    ];
    const mk = (id, rws) => ({ id, name: '案件' + id, status: '下書き中', customer: 'X社', created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-10T00:00:00Z', ref: 'R-' + id, data: { fields: {}, rows: rws, _rowFormat: 'v3-mixed-rows' } });
    const db = {
      quote_presets: [mk('SRC', rows), mk('EMPTY', [])],
      quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }, { email: 'yamada@x.com', role: 'member', member_no: 2 }],
      user_profiles: [{ email: 'yamada@x.com', display_name: '山田太郎' }, { email: 'suzuki@x.com', display_name: '鈴木花子' }], quote_comments: [],
      master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
    };
    window.__db = db;
    const qb = t => {
      const st = { filters: [] };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
        gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
        eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
        insert() { return api; }, upsert() { return api; }, update() { return api; }, delete() { return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        then(res, rej) {
          let data = (db[t] || []).filter(r => st.filters.every(f => f(r))).map(r => JSON.parse(JSON.stringify(r)));
          if (st.single) data = data[0] || null;
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return api;
    };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
    const client = {
      from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'admin' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {},
      auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
    };
    window.supabase = { createClient: () => client };
  });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.setDefaultTimeout(10000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);   // 編集画面を出す（最初の空行は取り込み前に消す）
  await p.evaluate(() => { document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').forEach(tr => tr.remove()); });

  const rowsInfo = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(tr => {
    const di = tr.querySelector('.st-doneinfo');
    return { nm: tr.querySelector('[data-field="nm"]').value, done: tr.dataset.done === '1', srcAt: tr.dataset.srcDoneAt || '', srcBy: tr.dataset.srcDoneBy || '', srcFrom: tr.dataset.srcFrom || '',
      info: di && !di.hidden ? di.textContent.trim() : '', infoSrc: !!(di && di.classList.contains('is-src')), h: Math.round(tr.getBoundingClientRect().height) };
  }));

  // 1) 類似案件のプレビュー：明細ごとの入力完了の日時・ユーザー
  await p.evaluate(() => window.cloudPreviewPreset('SRC')); await p.waitForTimeout(800);
  const tags = await p.evaluate(() => [...document.querySelectorAll('#cpTableBody .cp-row')].map(r => { const t = r.querySelector('.cp-done-tag'); return t ? { txt: t.textContent.trim(), src: t.classList.contains('is-src'), title: t.title } : null; }));
  ok('完了済みの明細に「✓ 日時 ユーザー名」（山田太郎）', tags[0] && /^✓ 10\/5 \d+:\d+ 山田太郎$/.test(tags[0].txt.replace(/^✓ \d{4}\//, '✓ ')) || (tags[0] && /✓ .*山田太郎/.test(tags[0].txt)), tags);
  ok('完了していない明細にはタグなし', tags[1] === null, tags);
  ok('引用元の記録だけを持つ明細は「📥」で区別（鈴木花子）', tags[2] && tags[2].src && /📥 .*鈴木花子/.test(tags[2].txt) && /元の元案件/.test(tags[2].title), tags[2]);

  // 2) 全行インポート
  await p.evaluate(() => window.cloudImportSelectedRows()); await p.waitForTimeout(800);
  let ri = await rowsInfo();
  ok('3 行入る', ri.length === 3, ri);
  ok('入力完了マーク自体は付かない（この案件では未確認）', ri.every(r => !r.done), ri);
  ok('完了済みだった行：引用元の日時・ユーザー・案件名を持つ', ri[0].srcAt && ri[0].srcBy === 'yamada@x.com' && ri[0].srcFrom === '案件SRC', ri[0]);
  ok('行の表示に「📥 日時 山田太郎」（引用元の色）', /^📥/.test(ri[0].info) && /山田太郎/.test(ri[0].info) && ri[0].infoSrc, ri[0]);
  ok('完了していなかった行には何も出ない', ri[1].info === '' && !ri[1].srcAt, ri[1]);
  ok('引用の引用は元の記録を引き継ぐ（鈴木花子・元の元案件）', ri[2].srcBy === 'suzuki@x.com' && ri[2].srcFrom === '元の元案件' && /鈴木花子/.test(ri[2].info), ri[2]);
  ok('行の高さは記録の有無で変わらない', ri[0].h > 0 && ri[0].h === ri[1].h, ri.map(r => r.h));

  // 3) 保存と復元
  const saved = await p.evaluate(() => { const d = gatherAllData(); return d.rows.filter(r => r._type === 'data').map(r => ({ done: !!r.done, srcDoneAt: r.srcDoneAt || '', srcDoneBy: r.srcDoneBy || '', srcFrom: r.srcFrom || '' })); });
  ok('保存データに srcDone* が入る（done は入らない）', saved[0].srcDoneAt && saved[0].srcDoneBy === 'yamada@x.com' && saved[0].srcFrom === '案件SRC' && !saved[0].done && !saved[1].srcDoneAt, saved);
  await p.evaluate(() => { const d = JSON.parse(JSON.stringify(gatherAllData())); _applyQuoteData(d); }); await p.waitForTimeout(800);
  ri = await rowsInfo();
  ok('保存・復元しても引用元の記録が残る', ri.length === 3 && ri[0].srcBy === 'yamada@x.com' && /山田太郎/.test(ri[0].info) && ri[2].srcBy === 'suzuki@x.com', ri);

  // 4) 自分で入力完了を押すと、自分の記録に置き換わる
  await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) .row-done-btn').click()); await p.waitForTimeout(500);
  ri = await rowsInfo();
  ok('完了を押すと引用元の記録は消え、自分の完了記録になる', ri[0].done && !ri[0].srcAt && !ri[0].infoSrc && ri[0].info !== '' && !/山田太郎/.test(ri[0].info), ri[0]);
  const saved2 = await p.evaluate(() => gatherAllData().rows.filter(r => r._type === 'data')[0]);
  ok('保存データも done/doneAt に切り替わり srcDone* は消える', saved2.done && saved2.doneAt && !saved2.srcDoneAt, saved2);
  await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual]) .row-done-btn').click()); await p.waitForTimeout(300);
  ri = await rowsInfo();
  ok('完了を解除しても引用元の記録は戻らない（確認済みとして扱った履歴は自分の記録のみ）', !ri[0].done && !ri[0].srcAt && ri[0].info === '', ri[0]);

  // 5) 引用元の記録を持つ行を含む案件を、さらにプレビュー
  await p.evaluate(() => { window.__db.quote_presets[1].data.rows = gatherAllData().rows; });
  await p.evaluate(() => window.cloudPreviewPreset('EMPTY')); await p.waitForTimeout(800);
  const tags2 = await p.evaluate(() => [...document.querySelectorAll('#cpTableBody .cp-row')].map(r => { const t = r.querySelector('.cp-done-tag'); return t ? t.textContent.trim() : null; }));
  ok('保存済みの案件のプレビューにも引用元の記録が出る（3 行目 📥 鈴木花子）', tags2[2] && /📥 .*鈴木花子/.test(tags2[2]), tags2);
  await p.evaluate(() => window.closeCloudPreview());

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

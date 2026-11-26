// ダッシュボードの画面幅による崩れの回帰テスト（第4弾）。偽の Supabase で案件を並べ、幅を変えて測る。
//   node scripts/design-tests/dash-responsive-test.js   （THEME=classic で現行・THEME=quiet で Quiet・既定は Industry）
//   確認：①絞り込みパネルが画面の右へはみ出さない ②リスト表示の右端ボタンが「更新」の日時に重ならない ③薄かった文字のコントラストが 4.5 以上
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } const t = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(f)] || 'text/html; charset=utf-8'; r.writeHead(200, { 'Content-Type': t }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME || 'industry';
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${th}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  for (const W of [1100, 1440]) {
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(({ th }) => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('forwarderTheme_v1', JSON.stringify(th === 'classic' ? { site: false, doc: false } : { site: true, doc: true })); } catch (e) {}
    const mk = (id, st, tags, extra) => Object.assign({ id, name: '案件' + id, status: st, customer: id === '2' ? '丸山物流 株式会社 とても長い名前のお客様ですよ' : 'X社', person: '山田', editors: [{ email: 'me@x.com', at: '2026-11-10T00:00:00Z', count: 2 }, { email: 'sub@x.com', at: '2026-11-09T00:00:00Z', count: 1 }], created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-10T00:00:00Z', ref: 'R-' + id, tags, data: { rows: [], fields: { 'qf-status': st, 'qf-customer': id === '2' ? '丸山物流 株式会社 とても長い名前のお客様ですよ' : 'X社', 'qf-person': '山田' } } }, extra || {});
    const T = n => Array.from({ length: n }, (_, i) => 'タグ' + String.fromCharCode(65 + i));
    const rows = [
      mk('1', '下書き中', ['インド', '緊急']), mk('2', '改定中', ['インド']), mk('3', '情報待ち', ['緊急']), mk('4', '提出済み', ['インド', '緊急', '大口']),
      mk('5', '受注', ['インド']), mk('6', '受注', []), mk('7', '失注', ['緊急']), mk('8', '保留', []), mk('9', 'ヨコヨコ提示', ['大口']),
      mk('10', '下書き中', T(12)), mk('11', '辞退', [], { pol: 'TOKYO' }),
      mk('12', '下書き中', [], { data: { rows: [], fields: { 'qf-status': '下書き中', 'qf-free-entries': JSON.stringify([{ id: 'e1', text: 'メモ', status: 'pending', at: '2026-11-01', by: 'me@x.com' }]) } } }),
    ];
    const db = { master_votes: [{ field: 'customer', value: 'X社', voter_email: 'me@x.com' }], master_details: [{ field: 'customer', value: 'X社', details: { dealType: '荷主（直接）' } }, { field: 'customer', value: '丸山物流 株式会社 とても長い名前のお客様ですよ', details: { dealType: '乙仲', via: '同業ABC' } }], quote_presets: rows, quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [], synonym_groups: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [] };
    const qb = t => { const st = { op: 'select', f: [] }; const api = { select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
      eq(k, v) { st.f.push(r => r[k] === v); return api; }, in(k, vs) { st.f.push(r => vs.includes(r[k])); return api; }, upsert() { return api; }, insert() { return api; }, update() { return api; }, delete() { return api; }, single() { return api; }, maybeSingle() { return api; },
      then(res, rej) { const data = (db[t] || []).filter(r => st.f.every(f => f(r))).map(r => Object.assign({}, r)); return Promise.resolve({ data, error: null }).then(res, rej); } }; return api; };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
    window.supabase = { createClient: () => ({ from: qb, rpc: n => Promise.resolve({ data: n === 'get_my_role' ? 'admin' : null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) }, auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } } }) };
  }, { th: th === "classic" ? "classic" : "x" });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1800);
  await p.evaluate(async () => { if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); if (window.cloudRerenderDash) window.cloudRerenderDash(); }); await p.waitForTimeout(600);
  const tag = '[' + W + 'px ' + th + '] ';
  // ① 右側の道具のパネルが画面の右へはみ出さない
  for (const [btn, pop, more] of [['#dtTagBtn', '#dtTagPop'], ['#dtFilterBtn', '#dtFilterPop', '#dtFilterMoreBtn'], ['#dtViewBtn', '#dtViewPop']]) {
    await p.click(btn); await p.waitForTimeout(250); if (more) { await p.click(more); await p.waitForTimeout(250); }
    const r = await p.evaluate(s => { const e = document.querySelector(s).getBoundingClientRect(); return { right: Math.round(e.right), left: Math.round(e.left), vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth }; }, pop);
    ok(tag + pop + ' が画面の中に収まり、横スクロールが出ない', r.right <= r.vw && r.left >= 0 && r.sw <= r.vw, r);
    await p.keyboard.press('Escape'); await p.waitForTimeout(150);
    if (await p.evaluate(s => !document.querySelector(s).hidden, pop)) await p.click(btn);
    await p.waitForTimeout(150);
  }
  // ② リスト表示：右端のボタンが「更新」の日時に重ならない
  await p.evaluate(() => { const b = document.getElementById('qpdViewList'); b && b.click(); }); await p.waitForTimeout(500);
  const ov = await p.evaluate(() => { const row = document.querySelector('#qpdListWrap .qpd-row'); if (!row) return null; const ts = row.querySelector('.qpd-row-ts').getBoundingClientRect(), a = row.querySelector('.qpd-row-acts').getBoundingClientRect(); return { tsRight: Math.round(ts.right), actsLeft: Math.round(a.left), tsW: Math.round(ts.width), tsScroll: row.querySelector('.qpd-row-ts').scrollWidth }; });
  ok(tag + 'リスト：日時の右端 ≦ ボタンの左端', !!ov && ov.tsRight <= ov.actsLeft + 1, ov);
  // ③ 文字のコントラスト（カード表示に戻して測る）
  await p.evaluate(() => { const b = document.getElementById('qpdViewCard'); b && b.click(); }); await p.waitForTimeout(500);
  const ratio = (fg, bg) => { const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; const L = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); const a = L(fg), b = L(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const cols = await p.evaluate(() => {
    const parse = s => (s.match(/[\d.]+/g) || []).map(Number);
    const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
    const q = s => { const e = document.querySelector(s); return e ? { fg: parse(getComputedStyle(e).color).slice(0, 3), bg: bgOf(e) } : null; };
    return { '申し送りの開閉': q('#qpdListWrap .ccc-toggle'), '▾': q('#qpdListWrap .ccc-caret'), '＋ タグ': q('#qpdListWrap .cloud-tag-add-btn'), '作業者': q('#qpdListWrap .cc3-who-l'), '案件名なし': q('#qpdListWrap .cc3-title.is-empty') };
  });
  for (const k of Object.keys(cols)) { const c = cols[k]; if (!c) { ok(tag + k + ' が見つかる', false, c); continue; } const r = ratio(c.fg, c.bg); ok(tag + k + ' のコントラスト ' + r.toFixed(2) + ' ≧ 4.5', r >= 4.5, { fg: c.fg, bg: c.bg }); }
  ok(tag + 'JS エラーなし', errs.length === 0, errs);
  await ctx.close();
  }
  console.log(fails ? 'NG' : 'OK'); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

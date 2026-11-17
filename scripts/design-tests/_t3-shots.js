// 見積入力の新画面（editor-v2）の確認
//   node scripts/design-tests/dash-top-test.js   （THEME=1 で Industry・THEME=classic で現行・W=390 でスマホ幅・OUT=<dir> で画像）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v2`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const W = +(process.env.W || 1400), mobile = W <= 600, th = process.env.THEME;
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP', hasTouch: mobile, isMobile: mobile });
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
  }, { th });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  if (mobile) {   // スマホ幅は固定バーが重なるため DOM から操作する
    p.click = (sel) => p.evaluate(x => { const e = document.querySelector(x); if (e) e.click(); }, sel);
    p.fill = (sel, v) => p.evaluate(([x, t]) => { const e = document.querySelector(x); e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
  }
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1800);
  await p.evaluate(async () => { if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); if (window.cloudRerenderDash) window.cloudRerenderDash(); }); await p.waitForTimeout(600);
  const vis = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; }, s);
  const shot = async n => { if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'dt-' + (th || 'industry') + (mobile ? '-sp' : '') + '-' + n + '.png') }); };
  const out = process.env.OUT;
  await p.evaluate(() => { try { window.cloudLoadPreset('1'); } catch (e) {} }); await p.waitForTimeout(2500);
  await p.evaluate(() => { const b = document.getElementById('qadMode'); b && b.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { for (let i = 0; i < 3; i++) { try { window.addRow(); } catch (e) {} } }); await p.waitForTimeout(800);
  await p.addStyleTag({ content: '#toast-container, .quote-toast, [id*="toast"] { display: none !important; }' });
  const O = process.env.OUT || '/tmp/shots3'; fs.mkdirSync(O, { recursive: true });
  const S = async n => { await p.waitForTimeout(350); await p.screenshot({ path: path.join(O, n + '.png'), clip: { x: 0, y: 0, width: W, height: Math.min(560, 900) } }); };
  const ev = f => p.evaluate(f);
  await ev(() => { const bn = document.getElementById('qmBanner'); bn.hidden = false; bn.textContent = '✏️ 編集中（あなたが作業中）'; const m = document.getElementById('qadMode'); m.textContent = '💾 保存'; });
  // 1 編集中・基本
  await ev(() => { const e = document.getElementById('qf-customer'); e.value = '丸山物流 株式会社'; e.dispatchEvent(new Event('input', { bubbles: true })); const n = document.getElementById('qf-case-name'); n.value = '横浜→ロサンゼルス FCL 見積'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await S('1-edit-step1');
  // 2 レールを開く
  await ev(() => document.querySelector('#e2Steps .e2-rail-toggle').click()); await S('2-rail-open');
  // 3 ステップ2（自動でしまう）
  await ev(() => document.querySelector('#e2Steps [data-e2s="2"]').click());
  await ev(() => { const s = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }; s('z2Pol', 'YOKOHAMA'); s('z2Pod', 'LOS ANGELES'); });
  await S('3-step2-route');
  // 4 パターン 3 つ・メニュー
  await ev(() => { try { addModePattern('fcl'); addModePattern('lcl'); addModePattern('air'); } catch (e) {} });
  await p.waitForTimeout(500); await ev(() => document.querySelector('#e2PatBtn') && document.querySelector('#e2PatBtn').click()); await S('4-pattern-menu');
  await ev(() => document.body.click());
  // 5 プレビュー ▾
  await ev(() => document.querySelector('#e2PvMore').click()); await S('5-preview-menu'); await ev(() => document.body.click());
  // 6 ⋯ メニュー
  await ev(() => document.querySelector('#saveToolbar .tb-menu > button, #saveToolbar [data-tb-menu] > button').click()); await S('6-more-menu'); await ev(() => document.body.click());
  // 7 状態の札のポップアップ
  await ev(() => document.querySelector('#e2State').click()); await S('7-state-pop'); await ev(() => document.body.click());
  // 8 長い題名
  await ev(() => { const n = document.getElementById('qf-case-name'); n.value = 'とても長い案件名の例：横浜発ロサンゼルス向け 精密機器 FCL 20GP×3 と LCL 混載の比較見積（再見積・条件変更あり）'; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await S('8-long-title');
  // 9 ステップ4 費用・!印
  await ev(() => document.querySelector('#e2Steps [data-e2s="4"]').click()); await ev(() => document.querySelector('#e2Steps [data-e2s="1"]').click());
  await ev(() => document.querySelector('#e2Steps .e2-rail-toggle').click()); await S('9-rail-open-marks');
  // 10 閲覧モード
  await ev(() => document.querySelector('#e2Steps .e2-rail-toggle').click());

  await ev(() => { const bn = document.getElementById('qmBanner'); bn.textContent = '🔒 閲覧モード — 編集するには「✏️ 編集」'; document.getElementById('qadMode').textContent = '✏️ 編集'; }); await S('10-view-mode');
  await b.close(); srv.close(); process.exit(0);
})();

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
  ok('新画面が有効（html.editor-v2）', await p.evaluate(() => document.documentElement.classList.contains('editor-v2')));
  ok('ステップ 5 つ', (await p.$$('#e2Steps [data-e2s]')).length === 5);
  ok('最初は①基本だけ表示', await vis('#section-ref') && !(await vis('#section-cond')) && !(await vis('#section-table')));
  ok('下の合計バーがある・旧い浮かぶ合計は出ない', await vis('#e2Total') && !(await vis('#totFloat')));
  ok('廃止した「表示サイズ 大中小」「作成者を指定して保存」は見えない', await p.evaluate(() => { const h = s => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none' || e.offsetParent === null; }; return h('.tb-scale-label') && h('.tb-segrow-inline') && h('#adminCreatorNew'); }));
  ok(mobile ? 'スマホ幅は旧来のドックのまま（ツールバーへ移さない）' : 'PDF／プレビュー／保存が上部ツールバーの中', await p.evaluate(m => !!document.querySelector('#saveToolbar #quoteActionDock') !== m, mobile));
  ok('左ナビ・右下ドックの旧位置は使わない', !(await vis('#qSecNav')));
  ok('その他の情報（日付・受信日・関連番号）は最初は畳まれ、お客様・担当者・案件名は見える', !(await vis('#qf-date')) && !(await vis('#qf-received')) && await vis('#qf-customer') && await vis('#qf-person') && await vis('#qf-case-name'));
  if (out) await p.screenshot({ path: path.join(out, 'e2-top.png') });
  await p.click('#e2MoreBtn'); await p.waitForTimeout(250);
  ok('［その他の情報］を開くと日付が出る', mobile || (await vis('#qf-date') && await vis('#qf-received')));
  await p.click('#e2MoreBtn'); await p.waitForTimeout(200);
  await p.fill('#qf-case-name', 'テスト案件ZZ'); await p.waitForTimeout(300);
  await p.fill('#qf-ref', '99-261116-001'); await p.waitForTimeout(300);
  ok('上部の題名は「案件番号 / 案件名」', /^99-261116-001 \/ テスト案件ZZ$/.test((await p.textContent('#e2tName')) || ''));
  ok('上部ツールバーに案件名と状態', (await p.textContent('#e2tName')).includes('テスト案件ZZ') && !!(await p.textContent('#e2tStatus')));
  if (out) await p.screenshot({ path: path.join(out, 'e2-step1.png') });
  await p.click('#e2Next'); await p.waitForTimeout(400);
  if (out) await p.screenshot({ path: path.join(out, 'e2-step2.png'), fullPage: true });
  if (out) { await p.click('#e2Next'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(out, 'e2-step3.png'), fullPage: true }); await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(300); }
  ok('②ルート：①と同じ左位置・幅（2 カラムの配置を引きずらない）', await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const a = r('section-cond'); const ref = document.getElementById('section-ref'); const cols = !!document.getElementById('qmCols'); const tab = document.getElementById('tab-quote-make'); const m = tab.querySelector('.quote-main').getBoundingClientRect(); return !cols && Math.abs(a.left - m.left) < 40 && a.width > m.width * 0.8; }));
  ok('［次へ］で②ルート', await vis('#section-cond') && !(await vis('#section-ref')));
  await p.evaluate(() => { const i = document.getElementById('cond-incoterms'); if (i && i.options.length > 1) { i.value = i.options[1].value; i.dispatchEvent(new Event('change', { bubbles: true })); } const a = document.getElementById('z2Pol'); a.value = 'TOKYO'; a.dispatchEvent(new Event('input', { bubbles: true })); const b = document.getElementById('z2Pod'); b.value = 'LOS ANGELES'; b.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(300);
  ok('②に条件のチップ要約（航路）', /TOKYO → LOS ANGELES/.test(await p.textContent('#e2Chips2')));
  await p.click('#e2Next'); await p.waitForTimeout(300);
  ok('③に要約の帯と、荷姿の詳細は畳まれている', await vis('#e2Chips3') && await vis('#e2PackBtn') && !(await vis('.cond-field--cargo-detail')));
  await p.click('#e2PackBtn'); await p.waitForTimeout(200);
  ok('③「詳細 ▾」で荷姿が開く', await vis('.cond-field--cargo-detail'));
  await p.click('#e2PackBtn'); await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(200);
  await p.click('#e2Steps [data-e2s="5"]'); await p.waitForTimeout(600);
  ok('⑤リマークは本文に直接出る（下の引き出しは出さない）', await p.evaluate(() => { const sec = document.getElementById('section-remark'); const sh = document.getElementById('rmSheet'); return !!sec.closest('.quote-main') && (!sh || getComputedStyle(sh).display === 'none'); }));
  ok('⑤リマーク：入力欄が見えて、上に何も重ならず押せる', await p.evaluate(() => { const t = document.getElementById('remarkTextarea'); if (!t) return false; const b = t.getBoundingClientRect(); if (b.width < 50 || b.height < 20) return false; const e = document.elementFromPoint(b.left + 20, b.top + 10); return !!e && e.id === 'remarkTextarea'; }));
  await p.fill('#remarkTextarea', 'テストのリマーク'); await p.waitForTimeout(200);
  ok('⑤リマークに入力でき、要約に反映される', (await p.evaluate(() => document.getElementById('remarkTextarea').value)) === 'テストのリマーク' && /リマークあり/.test(await p.textContent('#e2Steps [data-e2s="5"]')));
  await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(200);
  await p.click('#e2Steps [data-e2s="4"]'); await p.waitForTimeout(500);
  ok('④費用でテーブル', await vis('#section-table') && !(await vis('#section-cond')));
  ok('④費用の上に［すべて折りたたむ］［すべて展開］［＋ 行を追加］［📦 チャージ］', (await p.$$('#e2CostBar button')).length === 4 && await vis('#e2CostBar'));
  const nBefore = await p.evaluate(() => document.querySelectorAll('#tableBody tr:not([data-virtual])').length);
  await p.click('#e2CostBar [data-f="addRow"]'); await p.waitForTimeout(400);
  ok('操作バーの重複（チャージ）は隠れ、行パターンのボタンは操作バーから外れた（右レールから開く）', !(await vis('.quote-cmdbar .cmdbar-lc-btn')) && !(await vis('.quote-cmdbar .cmdbar-pattern-btn')));
  if (!mobile) { await p.evaluate(() => { const m = document.querySelector('[data-tb-menu="more"]'); m.classList.add('is-open'); }); await p.waitForTimeout(150);
    const mres = await p.evaluate(() => { const m = document.getElementById('tbMenuMore'); const items = [...m.children].filter(e => getComputedStyle(e).display !== 'none').sort((a, b) => (+getComputedStyle(a).order) - (+getComputedStyle(b).order)); const heads = items.filter(e => e.classList.contains('tb-menu-group')).map(e => getComputedStyle(e, '::after').content.replace(/"/g, '')); const first = !!(items[1] && items[1].textContent.includes('メール取込')); return { heads, first, items: items.map(e => e.textContent.trim().slice(0, 8) + ':' + getComputedStyle(e).order) }; });
    ok('「⋯」は「案件」「その他」の 2 区分で、案件が先', mres.heads.join(',') === '案件,その他' && mres.first, mres);
    await p.evaluate(() => document.querySelector('[data-tb-menu="more"]').classList.remove('is-open')); }
  ok('［＋ 行を追加］で行が 1 本増える', (await p.evaluate(() => document.querySelectorAll('#tableBody tr:not([data-virtual])').length)) > nBefore);
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.mouse.move(5, 5); await p.waitForTimeout(300);
  ok('明細：空のサブコン・パターン・有効期間は行を触るまで隠れる', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual])'); const hid = sel => { const e = tr.querySelector(sel); return !e || getComputedStyle(e).display === 'none'; }; return hid('.w-subcon') && hid('.w-pattern') && hid('.w-valid'); }));
  ok('明細：未設定のカテゴリ・課税は隠れる', await p.evaluate(() => { const r = document.querySelector('#tableBody tr:not([data-virtual])'); const c = r.querySelector('select.w-cat'), x = r.querySelector('.tax-cell input'); return getComputedStyle(c).display === 'none' && getComputedStyle(x).visibility === 'hidden'; }));
  if (mobile) { ok('スマホ幅：費用は一覧→編集シート（mobile-cost）。行のホバー系の確認は対象外', await p.evaluate(() => document.body.classList.contains('mc-on') || !!document.querySelector('#mcList'))); await b.close(); srv.close(); process.exit(fails ? 1 : 0); }
  await p.hover('#tableBody tr:not([data-virtual]) .w-name'); await p.waitForTimeout(250);
  ok('サブコン見出しに仕入・粗利％の欄がある（新画面で表示可）', await p.evaluate(() => !document.querySelector('#tableBody .subcon-group-header') || !!document.querySelector('#tableBody .subcon-group-header .subcon-group-cm')));
  ok('行に乗せると出る', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual])'); return getComputedStyle(tr.querySelector('.w-subcon')).display !== 'none'; }));
  if (out) await p.screenshot({ path: path.join(out, 'e2-step4.png') });
  await p.click('#e2Total [data-e2d="digest"]'); await p.waitForTimeout(500);
  const dr = () => p.evaluate(() => { const r = document.querySelector('.quote-right-col').getBoundingClientRect(); const act = document.querySelector('#qrcRail .is-on'); const d = document.getElementById('qrcDrawer'); const vis = [...document.querySelectorAll('#qrcBody > *')].filter(e => e.style.display !== 'none').map(e => e.id); return { open: r.left < innerWidth - 200 && r.width > 200, mod: act && act.dataset.mod, drawer: d && getComputedStyle(d).display !== 'none', vis }; });
  let d1 = await dr();
  ok('「費用の内訳」で右の引き出しが開き、費用のパネルが出る', d1.open && d1.mod === 'digest' && d1.drawer && d1.vis.includes('quoteSummaryPanel'), d1);
  await p.click('#e2Total [data-e2d="digest"]'); await p.waitForTimeout(400);
  ok('もう一度押すと閉じる', !(await dr()).open);
  await p.click('#e2Total [data-e2d="ref"]'); await p.waitForTimeout(500);
  d1 = await dr();
  ok('「参考」で右の引き出しが開く（類似見積）', d1.open && d1.mod === 'similar' && d1.vis.includes('sqPanel'), d1);
  await p.click('#e2Total [data-e2q]'); await p.waitForTimeout(500);
  d1 = await dr();
  ok('「数量登録」で「単位で数量を一括変更」が開く', d1.open && d1.mod === 'scenario' && d1.vis.includes('scPanel'), d1);
  if (out) await p.screenshot({ path: path.join(out, 'e2-drawer.png') });
  await p.evaluate(() => window.editorV2Set(false)); await p.waitForTimeout(500);
  ok('旧画面へ戻る：全セクションが出る・ドックは元の場所・ステップは消える', await vis('#section-ref') && await vis('#section-cond') && await vis('#section-table') && await p.evaluate(() => !document.querySelector('#saveToolbar #quoteActionDock')) && !(await vis('#e2Steps')) && !(await vis('#e2Total')));
  if (out) await p.screenshot({ path: path.join(out, 'e2-back-to-v1.png') });
  console.log(errs.length ? 'ERR ' + errs.slice(0, 3).join(' | ') : '');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

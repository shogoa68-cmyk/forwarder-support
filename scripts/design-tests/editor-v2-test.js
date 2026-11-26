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
  const W = +(process.env.W || 1300), mobile = W <= 600, th = process.env.THEME;
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
  await p.evaluate(() => { const b = document.getElementById('e2EditBtn') || document.getElementById('qadMode'); b && b.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => { for (let i = 0; i < 3; i++) { try { window.addRow(); } catch (e) {} } }); await p.waitForTimeout(800);
  ok('新画面が有効（html.editor-v2）', await p.evaluate(() => document.documentElement.classList.contains('editor-v2')));
  ok('ステップ 5 つ', (await p.$$('#e2Steps [data-e2s]')).length === 5);
  ok('最初は①基本だけ表示', await vis('#section-ref') && !(await vis('#section-cond')) && !(await vis('#section-table')));
  ok('下の合計バーがある・旧い浮かぶ合計は出ない', await vis('#e2Total') && !(await vis('#totFloat')));
  ok('廃止した「表示サイズ 大中小」「作成者を指定して保存」は見えない', await p.evaluate(() => { const h = s => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none' || e.offsetParent === null; }; return h('.tb-scale-label') && h('.tb-segrow-inline') && h('#adminCreatorNew'); }));
  ok(mobile ? 'スマホ幅は旧来のドックのまま（ツールバーへ移さない）' : 'PDF／プレビュー／保存が上部ツールバーの中', await p.evaluate(m => !!document.querySelector('#saveToolbar #quoteActionDock') !== m, mobile));
  ok('左ナビ・右下ドックの旧位置は使わない', !(await vis('#qSecNav')));
  ok('その他の情報（日付・受信日・関連番号）は最初は畳まれ、お客様・担当者・案件名は見える', !(await vis('#qf-date')) && !(await vis('#qf-received')) && await vis('#qf-customer') && await vis('#qf-person') && await vis('#qf-case-name'));
  // ===== Design 31・案T3：ツールバー 1 段（48px）＋左の開閉レール =====
  if (mobile) {
    ok('[T3スマホ] 上のバーに題名・⋯が 1 段目、状態札が 2 段目に出る', await p.evaluate(() => { const r = id => { const e = document.getElementById(id) || document.querySelector(id); return e ? e.getBoundingClientRect() : null; }; const t = r('e2tName'), m = r('#saveToolbar .tb-menu'), s = r('e2State'); return !!t && t.width > 40 && !!m && !!s && s.top > t.bottom - 4 && Math.abs(m.top - t.top) < 30; }));
    ok('[T3スマホ] 下に［PDF］［プレビュー］［保存］が固定（高さ 56px 前後）', await p.evaluate(() => { const d = document.getElementById('quoteActionDock').getBoundingClientRect(); return Math.abs(d.bottom - innerHeight) < 2 && d.height >= 54 && !document.getElementById('e2PvMore') && getComputedStyle(document.querySelector('#quoteActionDock .qad-pdf')).display !== 'none'; }));
  }
  if (!mobile) {
    const g = (sel, f) => p.evaluate(([s, fn]) => { const e = document.querySelector(s); return e ? new Function('e', 'return ' + fn)(e) : null; }, [sel, f]);
    ok('[T3] ツールバーの高さは 48px', (await g('#saveToolbar', 'Math.round(e.getBoundingClientRect().height)')) === 48, await g('#saveToolbar', 'e.getBoundingClientRect().height'));
    ok('[T3] 旧いステップのカード行はなく、レールはしまった状態（幅 56px）', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 56);
    ok('[T3] 見出しにステップ名と要約が出る', /1 基本/.test((await p.textContent('#e2Head')) || ''));
    ok('[T3] 作業状態の札は 1 つ（閲覧中／編集中）', /閲覧中|編集中/.test((await p.textContent('#e2State')) || '') && (await p.$$('#e2State')).length === 1);
    ok('[出力ボタン] ［PDF］は▾の中に隠さず、［PDF］［プレビュー］［保存］が別々に見える（元の onclick も残る）', await p.evaluate(() => { const d = document.querySelector('#quoteActionDock'), pdf = d.querySelector('.qad-pdf'), pv = d.querySelector('.qad-preview'), sv = d.querySelector('#qadMode'); const vis = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; return vis(pdf) && vis(pv) && vis(sv) && /quickQuotePdf/.test(pdf.getAttribute('onclick')) && !document.getElementById('e2PvMore'); }));
    ok('[出力ボタン] 閲覧中は［✏️ 編集を始める］が出て、［💾 保存］は押せない（保存はいつも「保存」）', await p.evaluate(() => { const eb = document.getElementById('e2EditBtn'), sv = document.getElementById('qadMode'), gh = document.getElementById('e2SaveGhost'); const view = sv.classList.contains('qad-edit'); if (!view) return true; return !!eb && !eb.hidden && /編集/.test(eb.textContent) && !!gh && !gh.hidden && gh.disabled && /保存/.test(gh.textContent); }));
    await p.keyboard.press('Escape'); await p.evaluate(() => document.body.click()); await p.waitForTimeout(100);
    ok('[T3] 数量パターンが 1 つ以下なら出ない', !(await vis('#e2Pat')));
    await p.click('#e2Steps .e2-rail-toggle'); await p.waitForTimeout(300);
    ok('[T3] ［»］で開くと幅 200px・暗幕・ステップ名が出る', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 200 && await vis('#e2Steps [data-e2s="2"] b') && await vis('#e2Scrim'));
    await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(400);
    ok('[T3] 開いて選ぶと切り替わり、自動でしまう', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 56 && await vis('#section-cond') && /2 ルート/.test((await p.textContent('#e2Head')) || ''));
    await p.click('#e2Steps [data-e2s="1"]'); await p.waitForTimeout(300);
    ok('[T3] しまったまま押しても開かない（切替だけ）', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 56 && await vis('#section-ref'));
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await p.keyboard.press('['); await p.waitForTimeout(250);
    ok('[T3] ［ キーで開閉できる', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 200);
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    ok('[T3] Esc で閉じる（暗幕も消える）', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 56 && !(await vis('#e2Scrim')));
    await p.keyboard.press('['); await p.waitForTimeout(250); await p.mouse.click(900, 500); await p.waitForTimeout(250);
    ok('[T3] 暗幕を押すと閉じる', (await g('#e2Steps', 'Math.round(e.getBoundingClientRect().width)')) === 56);
    ok('[T3] 選択中の印は番号／✓／!のまま（✓の黒丸にしない）', await p.evaluate(() => { const on = document.querySelector('#e2Steps button.is-on i'); return !!on && getComputedStyle(on).backgroundColor !== 'rgb(44, 69, 93)'; }));
    ok('[T3] 本文の左端はレールと重ならない', await p.evaluate(() => document.querySelector('#tab-quote-make .quote-workspace').getBoundingClientRect().left >= 56));
    // ロック中（他の人が編集中）：札が「🔒 ○○さんが編集中」・主ボタンが［🔒 閲覧のみ］（押せない）。外れたら元に戻る
    await p.evaluate(() => { document.getElementById('qmBanner').textContent = '🔒 閲覧モード — 編集するには「✏️ 編集」'; window.__qlb = window.quoteLockedByOther; window.quoteLockedByOther = () => ({ email: 't@x.com', name: '田中' }); document.getElementById('qf-case-name').dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(300);
    ok('[T3] ロック中：札が「🔒 田中さんが編集中」・［✏️ 編集を始める］は［🔒 閲覧のみ］で押せず、保存も押せない', await p.evaluate(() => { const b = document.getElementById('e2State'), m = document.getElementById('qadMode'), e = document.getElementById('e2EditBtn'), g = document.getElementById('e2SaveGhost'); return /田中さんが編集中/.test(b.textContent) && b.classList.contains('is-lock') && m.disabled && !!e && e.hidden && !!g && !g.hidden && g.disabled && /閲覧のみ/.test(g.textContent); }));
    await p.evaluate(() => { window.quoteLockedByOther = window.__qlb || (() => null); window.quoteLockedByOther = () => null; document.getElementById('qf-case-name').dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(300);
    ok('[T3] ロックが外れたら［✏️ 編集を始める］が押せるように戻る', await p.evaluate(() => { const e = document.getElementById('e2EditBtn'); return !!e && !e.disabled && /編集/.test(e.textContent); }));
    ok('[T3] 題名は 1 行（最大幅 380px）', await p.evaluate(() => { const b = document.getElementById('e2tName'); return b.getBoundingClientRect().width <= 381 && getComputedStyle(b).whiteSpace === 'nowrap'; }));
  }
  if (out) await p.screenshot({ path: path.join(out, 'e2-top.png') });
  // Design 46（案B）：日付は右の列の行（押すとその下に欄が開く）
  await p.evaluate(() => window.sbOpenRow('date')); await p.waitForTimeout(250);
  ok('右の列の「発行日」の行を開くと日付が出る', await vis('#qf-date'));
  await p.evaluate(() => window.sbOpenRow('')); await p.waitForTimeout(200);
  await p.fill('#qf-case-name', 'テスト案件ZZ'); await p.waitForTimeout(300);
  await p.fill('#qf-ref', '99-261116-001'); await p.waitForTimeout(300);
  ok('上部の題名は「案件番号 / 案件名」', /^99-261116-001 \/ テスト案件ZZ$/.test((await p.textContent('#e2tName')) || ''));
  ok('上部ツールバーに案件名と状態', (await p.textContent('#e2tName')).includes('テスト案件ZZ') && !!(await p.textContent('#e2tStatus')));
  if (out) await p.screenshot({ path: path.join(out, 'e2-step1.png') });
  await p.click('#e2Next'); await p.waitForTimeout(400);
  if (out) await p.screenshot({ path: path.join(out, 'e2-step2.png'), fullPage: true });
  if (out) { await p.click('#e2Next'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(out, 'e2-step3.png'), fullPage: true }); await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(300); }
  ok('②ルート：①と同じ左位置・幅（2 カラムの配置を引きずらない）', await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const a = r('section-cond'); const ref = document.getElementById('section-ref'); const cols = !!document.getElementById('qmCols'); const tab = document.getElementById('tab-quote-make'); const mm = tab.querySelector('.quote-main'); const m = mm.getBoundingClientRect(); const pr = parseFloat(getComputedStyle(mm).paddingRight) || 0; const w = m.width - pr; return !cols && Math.abs(a.left - m.left) < 40 && a.width >= Math.min(1000, w) * 0.9; }));
  ok('［次へ］で②ルート', await vis('#section-cond') && !(await vis('#section-ref')));
  await p.evaluate(() => { const i = document.getElementById('cond-incoterms'); if (i && i.options.length > 1) { i.value = i.options[1].value; i.dispatchEvent(new Event('change', { bubbles: true })); } const a = document.getElementById('z2Pol'); a.value = 'TOKYO'; a.dispatchEvent(new Event('input', { bubbles: true })); const b = document.getElementById('z2Pod'); b.value = 'LOS ANGELES'; b.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(300);
  ok('②の右の列に貿易条件が出る（要約の帯の代わり）', await p.evaluate(() => { const r = document.querySelector('#sbAside .sb-panel:not([hidden]) .sb-row[data-k="inco"] .sb-v'); return !!r && !/^なし$/.test(r.textContent); }));
  await p.click('#e2Next'); await p.waitForTimeout(300);
  await p.waitForTimeout(300);
  ok('③ 荷姿の詳細は畳まれていて、「荷姿・貨物明細 ▸ 開く」がある', await vis('#sbPackHead') && !(await vis('.cond-field--cargo-detail')));
  await p.evaluate(() => document.getElementById('sbPackHead').click()); await p.waitForTimeout(200);
  ok('③「▸ 開く」で荷姿が開く', await vis('.cond-field--cargo-detail'));
  await p.evaluate(() => document.getElementById('sbPackHead').click()); await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(200);
  await p.click('#e2Steps [data-e2s="5"]'); await p.waitForTimeout(600);
  ok('⑤リマークは本文に直接出る（下の引き出しにはリマークを入れず、「一時ファイル」のタブだけ）', await p.evaluate(() => { const sec = document.getElementById('section-remark'); const sh = document.getElementById('rmSheet'); const t = sh && sh.querySelector('.rms-tab[data-pane="remark"]'); return !!sec.closest('.quote-main') && !(sh && sh.contains(sec)) && (!t || getComputedStyle(t).display === 'none'); }));
  ok('⑤リマーク：入力欄が見えて、上に何も重ならず押せる', await p.evaluate(() => { const t = document.getElementById('remarkTextarea'); if (!t) return false; t.scrollIntoView({ block: 'center' }); const b = t.getBoundingClientRect(); if (b.width < 50 || b.height < 20) return false; const e = document.elementFromPoint(b.left + 20, b.top + 10); return !!e && e.id === 'remarkTextarea'; }));
  await p.fill('#remarkTextarea', 'テストのリマーク'); await p.waitForTimeout(200);
  ok('⑤リマークに入力でき、要約に反映される', (await p.evaluate(() => document.getElementById('remarkTextarea').value)) === 'テストのリマーク' && /リマークあり/.test(await p.textContent('#e2Steps [data-e2s="5"]')));
  await p.click('#e2Steps [data-e2s="2"]'); await p.waitForTimeout(200);
  await p.click('#e2Steps [data-e2s="4"]'); await p.waitForTimeout(500);
  ok('④費用でテーブル', await vis('#section-table') && !(await vis('#section-cond')));
  // Design 50（案A）：上の操作は 1 行（［＋ サブコンを追加］［📦 チャージから追加］…［⋯］）。すべて開く／閉じるは［⋯］の中
  ok('④費用の上の操作の行に［＋ サブコンを追加］［📦 チャージから追加］［⋯］', await vis('#tableWrap .quote-cmdbar [data-f="openAddSubconFrame"]') && await vis('#tableWrap .quote-cmdbar [data-f="lcOpenPicker"]') && await vis('#caMoreBtn'));
  const nBefore = await p.evaluate(() => document.querySelectorAll('#tableBody tr:not([data-virtual])').length);
  await p.evaluate(() => document.querySelector('#tableWrap .quote-cmdbar [data-f="openAddSubconFrame"]').click()); await p.waitForTimeout(200);
  await p.fill('#sfPop .sf-pop-in', '枠テスト運輸'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok('操作バーの重複（チャージ）は隠れ、行パターンのボタンは操作バーから外れた（右レールから開く）', !(await vis('.quote-cmdbar .cmdbar-lc-btn')) && !(await vis('.quote-cmdbar .cmdbar-pattern-btn')));
  if (!mobile) { await p.evaluate(() => { const m = document.querySelector('[data-tb-menu="more"]'); m.classList.add('is-open'); }); await p.waitForTimeout(150);
    const mres = await p.evaluate(() => { const m = document.getElementById('tbMenuMore'); const items = [...m.children].filter(e => getComputedStyle(e).display !== 'none').sort((a, b) => (+getComputedStyle(a).order) - (+getComputedStyle(b).order)); const heads = items.filter(e => e.classList.contains('tb-menu-group')).map(e => getComputedStyle(e, '::after').content.replace(/"/g, '')); const first = !!(items[0] && items[0].classList.contains('tb-menu-group') && items[1] && /取り込み|メール取込/.test(items[1].textContent)); return { heads, first, items: items.map(e => e.textContent.trim().slice(0, 8) + ':' + getComputedStyle(e).order) }; });
    ok('「⋯」は「案件」「その他」の 2 区分で、案件が先', mres.heads.join(',') === '案件,その他' && mres.first, mres);
    await p.evaluate(() => document.querySelector('[data-tb-menu="more"]').classList.remove('is-open')); }
  ok('［＋ サブコンを追加］で、そのサブコンの枠（行）ができる', await p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual]) [data-field="sv"]')].some(i => i.value === '枠テスト運輸')));
  await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.mouse.move(5, 5); await p.waitForTimeout(300);
  ok('明細：空のパターン・有効期間は行を触るまで隠れる（サブコンは枠をつくったので入っている）', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual])'); const hid = sel => { const e = tr.querySelector(sel); return !e || getComputedStyle(e).display === 'none'; }; return hid('.w-pattern') && hid('.w-valid'); }));
  // Design 50（案A）：カテゴリ・課税は「行の詳細」の中（閉じている間は見えない）
  ok('明細：カテゴリ・課税は行に出さない（行の詳細の中）', await p.evaluate(() => { const r = document.querySelector('#tableBody tr:not([data-virtual])'); const c = r.querySelector('select.w-cat'), x = r.querySelector('input[data-field="tx"]'); return !c.getClientRects().length && !x.getClientRects().length && !!c.closest('.row-detail-panel') && !!x.closest('.row-detail-panel'); }));
  if (mobile) {   // スマホ幅：数量登録で右の引き出しが画面内に開き、中身が出る
    await p.evaluate(() => document.querySelector('#e2Total [data-e2q]').click()); await p.waitForTimeout(500);
    const r = await p.evaluate(() => { const c = document.querySelector('.quote-right-col').getBoundingClientRect(); const sc = document.getElementById('scPanel'); return { l: c.left, w: c.width, vw: innerWidth, sc: !!sc && getComputedStyle(sc).display !== 'none', body: document.body.classList.contains('e2-drawer') }; });
    ok('スマホ幅：「数量登録」で引き出しが画面内に開く', r.body && r.l >= 0 && r.l + r.w <= r.vw + 1 && r.sc, r);
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'e2-drawer-sp.png') });
    await p.evaluate(() => document.querySelector('#e2Total [data-e2q]').click()); await p.waitForTimeout(300);
    ok('スマホ幅：もう一度押すと閉じる', !(await p.evaluate(() => document.body.classList.contains('e2-drawer'))));
  }
  if (mobile) { ok('スマホ幅：費用は一覧→編集シート（mobile-cost）。行のホバー系の確認は対象外', await p.evaluate(() => document.body.classList.contains('mc-on') || !!document.querySelector('#mcList'))); await b.close(); srv.close(); process.exit(fails ? 1 : 0); }
  await p.hover('#tableBody tr:not([data-virtual]) .w-name'); await p.waitForTimeout(250);
  ok('サブコン見出しに仕入・粗利％の欄がある（新画面で表示可）', await p.evaluate(() => !document.querySelector('#tableBody .subcon-group-header') || !!document.querySelector('#tableBody .subcon-group-header .subcon-group-cm')));
  ok('行に乗せると出る', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual])'); return getComputedStyle(tr.querySelector('.w-subcon')).display !== 'none'; }));
  if (out) await p.screenshot({ path: path.join(out, 'e2-step4.png') });
  const hz = () => p.evaluate(() => { const e = document.querySelector('.quote-right-col'), de = document.documentElement; return { disp: getComputedStyle(e).display, w: Math.round(e.getBoundingClientRect().width), sw: de.scrollWidth, cw: de.clientWidth, mainW: Math.round(document.querySelector('.quote-main').getBoundingClientRect().width) }; });
  const hClosed = await hz();
  ok('右の引き出しは閉じている間は本当に隠れ（display:none）、横スクロールもできない', hClosed.disp === 'none' && hClosed.w === 0 && hClosed.sw <= hClosed.cw, hClosed);
  await p.click('#e2Total [data-e2d="digest"]'); await p.waitForTimeout(500);
  const dr = () => p.evaluate(() => { const r = document.querySelector('.quote-right-col').getBoundingClientRect(); const act = document.querySelector('#qrcRail .is-on'); const d = document.getElementById('qrcDrawer'); const vis = [...document.querySelectorAll('#qrcBody > *')].filter(e => e.style.display !== 'none').map(e => e.id); return { open: r.left < innerWidth - 200 && r.width > 200, mod: act && act.dataset.mod, drawer: d && getComputedStyle(d).display !== 'none', vis }; });
  let d1 = await dr();
  ok('「費用の内訳」で右の引き出しが開き、費用のパネルが出る', d1.open && d1.mod === 'digest' && d1.drawer && d1.vis.includes('quoteSummaryPanel'), d1);
  const hOpen = await hz();
  ok('開いたとき：引き出しが出て、横スクロールはできない', hOpen.disp !== 'none' && hOpen.w > 300 && hOpen.sw <= hOpen.cw, { hOpen, hClosed });
  await p.click('#e2Total [data-e2d="digest"]'); await p.waitForTimeout(400);
  ok('もう一度押すと閉じる', !(await dr()).open);
  const hAfter = await hz();
  ok('閉じたあとも横スクロールは出ない・本文の幅は開く前に戻る', hAfter.disp === 'none' && hAfter.sw <= hAfter.cw && hAfter.mainW === hClosed.mainW, { hAfter, hClosed });
  await p.click('#e2Total [data-e2d="ref"]'); await p.waitForTimeout(500);
  d1 = await dr();
  ok('「参考」で右の引き出しが開く（類似見積）', d1.open && d1.mod === 'similar' && d1.vis.includes('sqPanel'), d1);
  await p.click('#e2Total [data-e2q]'); await p.waitForTimeout(500);
  d1 = await dr();
  ok('「数量登録」で「単位で数量を一括変更」が開く', d1.open && d1.mod === 'scenario' && d1.vis.includes('scPanel'), d1);
  if (out) await p.screenshot({ path: path.join(out, 'e2-drawer.png') });
  { // 右カラム 案A（Design 33）
    const rc = await p.evaluate(() => { const r = document.getElementById('qrcRail'); const main = [...r.children].filter(x => x.matches('.qrc-rail-btn:not(.qrc-more2-btn)')).map(x => x.dataset.mod); const more = [...document.querySelectorAll('#qrcRailMore .qrc-rail-btn')].map(x => x.dataset.mod); const b = document.querySelector('#e2Total [data-e2q]'); return { main, more, moreOpen: !document.getElementById('qrcRailMore').hidden, pressed: b.classList.contains('is-open'), lab: document.querySelector('[data-mod="scenario"] .qrc-rail-ico').textContent }; });
    ok('右レール：よく使う 5 つ＋その他（数量はその他の中・開いて見える）', rc.main.slice().sort().join() === 'charges,chat,digest,fin,subcon' && rc.more.includes('scenario') && rc.more.length === 6, rc);   // Design 49：［その他］は左のメニュー（常時は閉じる）・アイコンは SVG
    ok('「数量登録」は開いている間、押された見た目', rc.pressed, rc);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    { const st = await p.evaluate(() => ({ d: document.body.classList.contains('e2-drawer'), o: [...document.querySelectorAll('#e2Total .is-open')].map(x => x.textContent.trim().slice(0, 8)), act: document.activeElement && (document.activeElement.id || document.activeElement.tagName), ov: !!document.querySelector('.confirm-overlay, #previewOverlay.open, #fbOverlay.open, #mdDetailModal.open, .nq-overlay') })); ok('Esc で引き出しが閉じる（ボタンの押された見た目も戻る）', !st.d && st.o.length === 0, st); }
    await p.click('#e2Total [data-e2q]'); await p.waitForTimeout(300);
  }
  // 明細 1 行：使っていない「その他 ▾」は行に乗せるまで隠す
  if (!mobile) {
    await p.evaluate(() => { document.querySelector('[data-e2s="4"]').click(); window.addRow(); }); await p.waitForTimeout(400);
    await p.mouse.move(5, 5); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(200);
    const vis = await p.evaluate(() => { const r = document.querySelector('#tableBody tr:not([data-virtual])'); const bb = r && r.querySelector('.row-detail-btn'); window.__d = r && [r.matches(':hover'), r.matches(':focus-within'), bb && bb.matches(':has(.used-badge:not([data-n="0"]))'), bb && bb.getAttribute('aria-expanded'), document.documentElement.className]; const b = r && r.querySelector('.row-detail-btn'); return b ? getComputedStyle(b).visibility : 'none'; });
    ok('使っていない「その他 ▾」は行に乗せるまで隠れる', vis === 'hidden' || vis === 'none', [vis, await p.evaluate(() => window.__d)]);
  }
  if (!mobile) {   // サブコン見出しの注記入力は、空のあいだ見出しに乗せるまで隠す
    await p.mouse.move(5, 5); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await p.waitForTimeout(200);
    const hn = await p.evaluate(() => { const h = document.querySelector('#tableBody .subcon-group-header .hdr-notes'); return h ? getComputedStyle(h).display : 'none'; });
    ok('サブコン見出しの注記入力は、空のあいだ隠れる', hn === 'none', hn);
  }
  await p.evaluate(() => window.editorV2Set(false)); await p.waitForTimeout(500);
  ok('旧画面へ戻る：全セクションが出る・ドックは元の場所・ステップは消える', await vis('#section-ref') && await vis('#section-cond') && await vis('#section-table') && await p.evaluate(() => !document.querySelector('#saveToolbar #quoteActionDock')) && !(await vis('#e2Steps')) && !(await vis('#e2Total')));
  if (out) await p.screenshot({ path: path.join(out, 'e2-back-to-v1.png') });
  console.log(errs.length ? 'ERR ' + errs.slice(0, 3).join(' | ') : '');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

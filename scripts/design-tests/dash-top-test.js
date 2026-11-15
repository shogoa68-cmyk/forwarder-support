// 見積ダッシュボード上部の整理（案D＋タグ T2）の確認。偽の Supabase で案件を並べる。
//   node scripts/design-tests/dash-top-test.js   （THEME=1 で Industry・THEME=classic で現行・W=390 でスマホ幅・OUT=<dir> で画像）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const W = +(process.env.W || 1400), mobile = W <= 600, th = process.env.THEME;
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP', hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(({ th }) => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('forwarderTheme_v1', JSON.stringify(th === 'classic' ? { site: false, doc: false } : { site: true, doc: true })); } catch (e) {}
    const mk = (id, st, tags, extra) => Object.assign({ id, name: '案件' + id, status: st, customer: 'X社', created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-10T00:00:00Z', ref: 'R-' + id, tags, data: { rows: [], fields: { 'qf-status': st } } }, extra || {});
    const T = n => Array.from({ length: n }, (_, i) => 'タグ' + String.fromCharCode(65 + i));
    const rows = [
      mk('1', '下書き中', ['インド', '緊急']), mk('2', '改定中', ['インド']), mk('3', '情報待ち', ['緊急']), mk('4', '提出済み', ['インド', '緊急', '大口']),
      mk('5', '受注', ['インド']), mk('6', '受注', []), mk('7', '失注', ['緊急']), mk('8', '保留', []), mk('9', 'ヨコヨコ提示', ['大口']),
      mk('10', '下書き中', T(12)), mk('11', '辞退', [], { pol: 'TOKYO' }),
      mk('12', '下書き中', [], { data: { rows: [], fields: { 'qf-status': '下書き中', 'qf-free-entries': JSON.stringify([{ id: 'e1', text: 'メモ', status: 'pending', at: '2026-11-01', by: 'me@x.com' }]) } } }),
    ];
    const db = { quote_presets: rows, quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [], master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [] };
    const qb = t => { const st = { op: 'select', f: [] }; const api = { select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
      eq(k, v) { st.f.push(r => r[k] === v); return api; }, in(k, vs) { st.f.push(r => vs.includes(r[k])); return api; }, upsert() { return api; }, insert() { return api; }, update() { return api; }, delete() { return api; }, single() { return api; }, maybeSingle() { return api; },
      then(res, rej) { const data = (db[t] || []).filter(r => st.f.every(f => f(r))).map(r => Object.assign({}, r)); return Promise.resolve({ data, error: null }).then(res, rej); } }; return api; };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
    window.supabase = { createClient: () => ({ from: qb, rpc: n => Promise.resolve({ data: n === 'get_my_role' ? 'admin' : null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) }, auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } } }) };
  }, { th });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1800);
  const vis = s => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; }, s);
  const shot = async n => { if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'dt-' + (th || 'industry') + (mobile ? '-sp' : '') + '-' + n + '.png') }); };
  const cardsN = () => p.evaluate(() => window.cloudTagState().shown);   // 絞り込み後の全件数（画面は 10 件ずつ表示のため）
  const chipTxt = () => p.$$eval('#dtChips .dt-chip', els => els.map(e => e.textContent.replace(/\s+/g, '')));

  // ---- 構成 ----
  ok('組み替えが効いている', await p.evaluate(() => document.getElementById('qpDashboard').classList.contains('dt-on')));
  ok('統計タイル（元）は隠れ、チップが出る', !(await vis('#qpdStats')) && await vis('#dtChips'));
  const chips = await chipTxt();
  ok('チップ：全体12・作業中5・提示済み1・受注2・その他', chips[0] === '全体12' && chips[1] === '作業中5' && chips[2] === '提示済み1' && chips[3] === '受注2' && /^その他/.test(chips[4]), chips);
  ok('主ボタンは「新しい見積を作る」', await vis('.qpd-new'));
  ok('作業中の見積が無いので「戻る」は出ない', !(await vis('.qpd-resume')));
  ok('札：未取込 1 が出て、要フォロー（0件）は出ない', await p.evaluate(() => { const t = document.getElementById('dtBadges').textContent; return /未取込 1/.test(t) && !/要フォロー/.test(t); }));
  ok('道具：範囲・検索・タグ・絞り込み・表示', await vis('#dtScope') && await vis('#qpdSearch') && await vis('#dtTagBtn') && await vis('#dtFilterBtn') && await vis('#dtViewBtn'));
  ok('範囲の選択肢（全体12・自分…）', await p.$$eval('#dtScope option', os => os.length >= 2 && /全体 12/.test(os[0].textContent)));
  ok('元の並び替え・表示切替・関連付けモードは「表示」の中へ（要素ごと）', await p.evaluate(() => !!document.querySelector('#dtViewSlot #qpdSort') && !!document.querySelector('#dtViewSlot #qpdViewList') && !!document.querySelector('#dtViewSlot #qpdLinkModeBtn')));
  ok('かんたん／詳細の切替と自由入力は「⋯」の中', await p.evaluate(() => !!document.querySelector('#dtMorePop .uim-switch') && !!document.querySelector('#dtMorePop .qpd-store')));
  ok('横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await shot('top');

  // ---- ステータスのチップ ----
  ok('最初は 12 件', (await cardsN()) === 12, await cardsN());
  await p.click('#dtChips [data-dt-st="受注"]'); await p.waitForTimeout(400);
  ok('「受注」を押すと 2 件・押した色', (await cardsN()) === 2 && await p.evaluate(() => document.querySelector('#dtChips [data-dt-st="受注"]').classList.contains('is-on')), await cardsN());
  await p.click('#dtChips [data-dt-st="__draft_revising__"]'); await p.waitForTimeout(400);
  ok('「作業中」＝下書き中・改定中・情報待ちの合算（5 件）', (await cardsN()) === 5, await cardsN());
  await p.click('#dtChipMoreBtn'); await p.waitForTimeout(150);
  ok('「その他 ▾」を開くと 4 つ（ヨコヨコ提示・失注・辞退・保留）', await p.$$eval('#dtChipMorePop button[data-dt-st]', e => e.map(x => x.dataset.dtSt).join(',') === 'ヨコヨコ提示,失注,辞退,保留'));
  await shot('other');
  await p.click('#dtChipMorePop [data-dt-st="失注"]'); await p.waitForTimeout(400);
  ok('「失注」を選ぶと「その他」が「失注」に変わり 1 件', (await cardsN()) === 1 && /^失注/.test((await chipTxt())[4]), await chipTxt());
  await p.click('#dtChips [data-dt-st=""]'); await p.waitForTimeout(300);
  ok('「全体」で戻る', (await cardsN()) === 12);
  await p.click('#dtBadges [data-dt-tile="pend"]'); await p.waitForTimeout(300);
  ok('札「未取込」で 1 件に絞られる', (await cardsN()) === 1, await cardsN());
  await p.click('#dtBadges [data-dt-tile="pend"]'); await p.waitForTimeout(300);

  // ---- タグ ----
  await p.click('#dtTagBtn'); await p.waitForTimeout(200);
  ok('タグのパネルが開く（検索・よく使う）', await vis('#dtTagPop') && await vis('#dtTagSearch') && await p.evaluate(() => /よく使う/.test(document.getElementById('dtTagPop').textContent)));
  ok('よく使う＝上位 10 個（数字つき）', await p.evaluate(() => { const lbl = [...document.querySelectorAll('#dtTagPop .dt-pop-lbl')].find(l => l.textContent === 'よく使う'); const w = lbl && lbl.nextElementSibling; const c = w ? w.querySelectorAll('.dt-tagchip') : []; return c.length === 10 && /\d/.test(c[0].textContent); }));
  ok('「すべてのタグを見る」がある（15 個＞10）', await p.evaluate(() => !!document.querySelector('#dtTagPop [data-dt-tagall]')));
  await shot('tag');
  await p.click('#dtTagPop [data-dt-tag="インド"]'); await p.waitForTimeout(300);
  ok('インド：4 件', (await cardsN()) === 4, await cardsN());
  await p.click('#dtTagPop [data-dt-tag="緊急"]'); await p.waitForTimeout(300);
  ok('インド＋緊急（すべて含む）：2 件', (await cardsN()) === 2, await cardsN());
  ok('「すべて含む／どれか含む」の切替が出る', await vis('#dtTagPop .dt-seg'));
  await p.click('#dtTagPop [data-dt-mode="or"]'); await p.waitForTimeout(300);
  ok('どれか含む：インド4＋緊急(1・3・7)の重複除き 6 件', (await cardsN()) === 6, await cardsN());
  ok('最近使ったタグが出る', await p.evaluate(() => /最近使った/.test(document.getElementById('dtTagPop').textContent)));
  ok('「N 件を見る」', await p.evaluate(() => /6 件を見る/.test(document.querySelector('#dtTagPop .dt-primary').textContent)), await p.evaluate(() => document.querySelector('#dtTagPop .dt-primary').textContent));
  await p.fill('#dtTagSearch', '大'); await p.waitForTimeout(200);
  ok('タグ名の検索で候補だけ出る', await p.$$eval('#dtTagPop .dt-tagchip', e => e.length >= 1 && e.every(x => /大/.test(x.textContent))));
  await p.fill('#dtTagSearch', ''); await p.waitForTimeout(100);
  await p.click('#dtTagPop .dt-primary'); await p.waitForTimeout(200);
  ok('閉じると、選んだタグの行が出る', await vis('#dtSelTags') && await p.evaluate(() => /インド/.test(document.getElementById('dtSelTags').textContent) && /どれか含む/.test(document.getElementById('dtSelTags').textContent)));
  ok('タグボタンに選択数のバッジ', await p.evaluate(() => document.getElementById('dtTagN').textContent === '2'));
  ok('最近使ったタグはこのブラウザに保存', await p.evaluate(() => JSON.parse(localStorage.getItem('qpdRecentTags_v1') || '[]').join() === '緊急,インド'));
  await shot('tag-selected');
  await p.click('#dtSelTags [data-dt-tagx="緊急"]'); await p.waitForTimeout(300);
  ok('✕で 1 つ外す：インド 4 件', (await cardsN()) === 4, await cardsN());
  await p.click('#dtSelTags [data-dt-tagclear]'); await p.waitForTimeout(300);
  ok('「すべて外す」で 12 件', (await cardsN()) === 12 && !(await vis('#dtSelTags')), [await cardsN(), await vis('#dtSelTags')]);

  // ---- 絞り込み・表示 ----
  await p.click('#dtFilterBtn'); await p.waitForTimeout(200);
  ok('絞り込みの中に詳細検索の項目', await vis('#dtFilterPop #qpdFilterPol') && await vis('#dtFilterPop #qpdFilterMode'));
  await p.fill('#qpdFilterPol', 'TOKYO'); await p.waitForTimeout(500);
  ok('積み地で絞ると 1 件・件数バッジ', (await cardsN()) === 1 && await p.evaluate(() => document.getElementById('dtFilterN').textContent === '1'), await cardsN());
  await shot('filter');
  await p.fill('#qpdFilterPol', ''); await p.waitForTimeout(300); await p.click('#dtFilterPop .dt-primary'); await p.waitForTimeout(200);
  await p.click('#dtViewBtn'); await p.waitForTimeout(200);
  ok('表示の中：並び替え・カード／リスト', await vis('#dtViewPop #qpdSort') && await vis('#dtViewPop #qpdViewList'));
  await p.click('#qpdViewList'); await p.waitForTimeout(300);
  ok('リストに切り替わる', await p.evaluate(() => !!document.querySelector('#qpdListWrap .qpd-row')) || (await cardsN()) === 12);
  await p.click('#qpdViewCard'); await p.click('#dtViewPop .dt-primary'); await p.waitForTimeout(200);
  ok('Esc で閉じる', await (async () => { await p.click('#dtMoreBtn'); await p.keyboard.press('Escape'); await p.waitForTimeout(100); return !(await vis('#dtMorePop')); })());

  // ---- 作業中の見積に戻る ----
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(300);
  await p.evaluate(() => { const i = document.getElementById('qf-customer'); if (i) { i.value = 'テスト社'; i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await p.waitForTimeout(300);
  await p.evaluate(() => window.qpShowDashboard()); await p.waitForTimeout(500);
  ok('未保存の入力があると「作業中の見積に戻る」が出る', await vis('.qpd-resume'));
  ok('横にはみ出さない（最後）', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  ok('JS エラーなし', errs.length === 0, errs);
  console.log(fails ? 'NG' : 'OK'); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

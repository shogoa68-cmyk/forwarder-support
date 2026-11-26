// 全体リマークの「🎯 おすすめ」（段階 1 条件・段階 2 使った記録・段階 3 プリセット候補）の試験。
//   node scripts/design-tests/remark-suggest-test.js   （THEME=1 で Industry、EDITOR=v2 で新しい画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const out = [];
process.on('unhandledRejection', e => { console.log(out.join('\n')); console.log('ERROR ' + (e && e.message)); process.exit(1); });
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const v2 = process.env.EDITOR === 'v2';
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html` + (v2 ? '?editor=v2' : '');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(600);
  if (!v2) { await p.evaluate(() => window.rmsOpen && window.rmsOpen()); await p.waitForTimeout(400); }

  const W = ms => p.waitForTimeout(ms);
  const setSel = (id, v) => p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const setIn = (id, v) => p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const sug = () => p.$$eval('#presetBtns .preset-btn-suggest', els => els.map(e => e.textContent.replace(/[✎✕]/g, '').trim()));
  const tabsNow = () => p.$$eval('#remarkTabs .rm-tab', els => els.map(e => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), on: e.classList.contains('is-on') })));
  const clickBtn = label => p.evaluate(l => { const b = [...document.querySelectorAll('#presetBtns .preset-btn:not(.preset-btn-suggest)')].find(x => x.textContent.includes(l)); b && b.click(); return !!b; }, label);

  // ---- 段階 1：標準の定型文の条件 ----
  ok('条件が無い見積ではおすすめのタブを出さない', !(await tabsNow()).some(t => t.t.startsWith('🎯')), await tabsNow());
  ok('道具の行（選んだ文をプリセットに・候補を探す）がある', await p.evaluate(() => !!document.getElementById('rsMakeBtn') && !!document.getElementById('rsCandBtn')));
  await setSel('cond-mode', '海上（FCL）'); await W(700);
  let s = await sug();
  ok('FCL にすると「🌀 遅延の免責」がおすすめに出る', s.some(t => t.includes('遅延の免責')), s);
  let tb = await tabsNow();
  ok('おすすめのタブが先頭に出て選ばれる', tb[0] && tb[0].t.startsWith('🎯') && tb[0].on, tb);
  ok('標準の定型文は「定型文」のタブのまま', await p.evaluate(() => { const b = [...document.querySelectorAll('#presetBtns .preset-btn')].find(x => x.textContent.includes('有効期限')); return b && b.dataset.rt === 'preset'; }));
  await setSel('cond-hazmat', '危険品あり（クラス要確認）'); await W(700);
  s = await sug();
  ok('危険品にすると「☣️ 危険品」もおすすめに出る', s.some(t => t.includes('危険品')), s);
  ok('おすすめのボタンを押すと文が入る', await p.evaluate(() => { const b = [...document.querySelectorAll('#presetBtns .preset-btn-suggest')].find(x => x.textContent.includes('遅延')); b.click(); return document.getElementById('remarkTextarea').value.includes('当社の責に帰さない'); }));
  ok('元の「定型文」のボタンも押した状態になる', await p.evaluate(() => { const b = [...document.querySelectorAll('#presetBtns .preset-btn:not(.preset-btn-suggest)')].find(x => x.textContent.includes('遅延の免責')); return b && b.classList.contains('active'); }));
  await p.evaluate(() => { document.getElementById('remarkTextarea').value = ''; window.syncRemarkChips(); });

  // ---- 段階 1：個人のプリセットに条件（国＝インド） ----
  await p.evaluate(() => window.rpOpenWith({ text: 'インド向けは IEC コードをご提示ください。', label: '🇮🇳 IEC', cond: { cc: ['IN'] }, en: 'Please provide the IEC code for shipments to India.' }));
  await W(200);
  ok('プリセットの画面に条件の入力欄・英文の欄が出る', await p.evaluate(() => document.getElementById('remarkPresetModal').classList.contains('open') && !!document.getElementById('rsForm') && !!document.getElementById('rsEn')));
  ok('入れた条件（国）が欄に入る', await p.evaluate(() => /インド/.test(document.getElementById('rsIn_cc').value)), await p.evaluate(() => document.getElementById('rsIn_cc').value));
  ok('未ログインは個人に保存（チェック固定）', await p.evaluate(() => document.getElementById('rpFormPersonal').checked));
  await p.evaluate(() => document.querySelector('#remarkPresetModal .bm-btn-save').click()); await W(500);
  ok('個人のプリセットに条件・英文が入る', await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('quoteRemarkUserPresets_v1') || '[]'); const x = a.find(p => p.label === '🇮🇳 IEC'); return x && x.cond && x.cond.cc[0] === 'IN' && /IEC/.test(x.en); }));
  s = await sug(); ok('インドでない見積では出ない', !s.some(t => t.includes('IEC')), s);
  await setIn('z2PodCountry', 'インド'); await W(800);
  s = await sug(); ok('POD の国をインドにすると個人のプリセットがおすすめに出る', s.some(t => t.includes('IEC')), s);
  ok('条件つきのボタンに 🎯 と ✎ が付く', await p.evaluate(() => { const b = [...document.querySelectorAll('#presetBtns .preset-btn-user:not(.preset-btn-suggest)')].find(x => x.textContent.includes('IEC')); return b && !!b.querySelector('.preset-btn-cond') && !!b.querySelector('.preset-btn-edit'); }));
  ok('英語出力：個人のプリセットの英文を使う', await p.evaluate(() => window.translateRemarkToEn('インド向けは IEC コードをご提示ください。') === 'Please provide the IEC code for shipments to India.'));

  // 「この見積の条件を入れる」
  await p.evaluate(() => window.rpOpenWith({ text: 'x', label: 'x' })); await W(150);
  await p.evaluate(() => document.getElementById('rsClearCond').click());
  await p.evaluate(() => document.getElementById('rsFillNow').click()); await W(100);
  ok('「この見積の条件を入れる」で FCL・インド・危険品が入る', await p.evaluate(() => {
    const on = k => [...document.querySelectorAll('#rsForm .rs-row[data-k="' + k + '"] .rs-chip.is-on')].map(b => b.dataset.v);
    return on('mode').includes('fcl') && on('haz').includes('dg') && /インド/.test(document.getElementById('rsIn_cc').value) && /いまの見積に合います/.test(document.getElementById('rsSum').textContent);
  }));
  await p.evaluate(() => document.querySelector('#remarkPresetModal .bm-btn-cancel').click());

  // ✎ で直す
  await p.evaluate(() => { const b = [...document.querySelectorAll('#presetBtns .preset-btn-user:not(.preset-btn-suggest)')].find(x => x.textContent.includes('IEC')); b.querySelector('.preset-btn-edit').click(); }); await W(150);
  ok('✎ で直す画面が今の内容で開く', await p.evaluate(() => /直す/.test(document.getElementById('rpModalTitle').textContent) && document.getElementById('rpFormText').value.includes('IEC') && document.getElementById('rpDestRow').hidden));
  await p.evaluate(() => { document.getElementById('rpFormText').value = 'インド向けは IEC コードを必ずご提示ください。'; document.querySelector('#remarkPresetModal .bm-btn-save').click(); }); await W(400);
  ok('直した本文が保存される（条件はそのまま）', await p.evaluate(() => { const x = JSON.parse(localStorage.getItem('quoteRemarkUserPresets_v1')).find(p => p.label === '🇮🇳 IEC'); return /必ず/.test(x.text) && x.cond.cc[0] === 'IN'; }));

  // 選んだ文をプリセットにする
  await p.evaluate(() => { const ta = document.getElementById('remarkTextarea'); ta.value = '1行目の文です\nこの行をプリセットにしたい文です。'; ta.focus(); ta.setSelectionRange(ta.value.indexOf('この'), ta.value.length); document.getElementById('rsMakeBtn').click(); }); await W(150);
  ok('「選んだ文をプリセットにする」で本文と条件が入って開く', await p.evaluate(() => document.getElementById('rpFormText').value === 'この行をプリセットにしたい文です。' && [...document.querySelectorAll('#rsForm .rs-row[data-k="mode"] .rs-chip.is-on')].some(b => b.dataset.v === 'fcl')));
  await p.evaluate(() => { document.querySelector('#remarkPresetModal .bm-btn-cancel').click(); document.getElementById('remarkTextarea').value = ''; window.syncRemarkChips(); });

  // ---- 段階 2：使った記録（個人＝この端末） ----
  await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('quoteRemarkUserPresets_v1') || '[]'); a.push({ label: '📎 MSDS', text: '危険品は MSDS を事前にご提出ください。' }); localStorage.setItem('quoteRemarkUserPresets_v1', JSON.stringify(a)); window.renderRemarkPresets(); });
  s = await sug(); ok('条件の無いプリセットは最初はおすすめに出ない', !s.some(t => t.includes('MSDS')), s);
  for (let i = 0; i < 5; i++) { await clickBtn('📎 MSDS'); await W(60); }   // 入れる→外す… 入れるが 3 回
  await W(2600);
  s = await sug(); ok('似た条件で 3 回使うとおすすめに出る（回数つき）', s.some(t => t.includes('MSDS') && /3回/.test(t)), s);
  ok('記録に港の名前・本文は入れない', await p.evaluate(() => { const a = JSON.parse(localStorage.getItem('rsLocalUses_v1') || '[]'); const x = a[0] && a[0].x; return !!x && x.mode === 'fcl' && x.cc[0] === 'IN' && !('port' in x) && !JSON.stringify(a).includes('MSDS を'); }));
  await setSel('cond-mode', '航空（AIR）'); await setSel('cond-hazmat', 'なし（一般貨物）'); await setIn('z2PodCountry', ''); await W(800);
  s = await sug(); ok('条件が変わると（航空・国なし）記録のおすすめは消える', !s.some(t => t.includes('MSDS')), s);

  // ---- 段階 1・2：チーム共有（偽の Supabase） ----
  await p.evaluate(() => {
    const db = window.__db = { remark_presets: [{ id: 'p1', label: '✈️ 航空の注意', text: '航空貨物は重量・容積の大きい方で運賃を計算します。', use_count: 0, cargo_type: null, conditions: { mode: ['air'] }, en: null }], remark_preset_uses: [], remark_preset_verifications: [], user_profiles: [] };
    window.__noCond = false; window.__calls = [];
    const mk = table => {
      const st = { table, op: 'select', cols: '*', payload: null, eq: null };
      const api = {
        select(c) { if (st.op === 'select') st.cols = c || '*'; return api; },
        insert(v) { st.op = 'insert'; st.payload = v; return api; }, update(v) { st.op = 'update'; st.payload = v; return api; }, delete() { st.op = 'delete'; return api; },
        eq(k, v) { st.eq = [k, v]; return api; }, gte() { return api; }, order() { return api; }, limit() { return api; }, single() { st.single = true; return api; },
        then(res, rej) {
          window.__calls.push({ table, op: st.op, cols: st.cols, payload: st.payload });
          const bad = window.__noCond && table === 'remark_presets' && ((st.op === 'select' && /conditions/.test(st.cols)) || (st.payload && ('conditions' in st.payload || 'en' in st.payload)));
          if (bad) return Promise.resolve({ data: null, error: { message: 'column remark_presets.conditions does not exist' } }).then(res, rej);
          const t = db[table] || (db[table] = []);
          let data = null;
          if (st.op === 'select') data = t.slice();
          else if (st.op === 'insert') { const row = Object.assign({ id: 'n' + (t.length + 1) }, st.payload); t.push(row); data = st.single ? row : [row]; }
          else if (st.op === 'update') { t.filter(r => r[st.eq[0]] === st.eq[1]).forEach(r => Object.assign(r, st.payload)); }
          else if (st.op === 'delete') { db[table] = t.filter(r => r[st.eq[0]] !== st.eq[1]); }
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return api;
    };
    window.quoteCloudClient = () => ({ from: mk });
    window.quoteCloudUser = () => ({ email: 'tester@example.com' });
    return window.loadSharedRemarkPresets();
  });
  await W(800);
  s = await sug(); ok('共有プリセットの条件（航空）でおすすめに出る', s.some(t => t.includes('航空の注意')), s);
  await p.evaluate(() => { const b = [...document.querySelectorAll('#presetBtns .preset-btn-suggest')].find(x => x.textContent.includes('航空の注意')); b.click(); }); await W(300);
  const use = await p.evaluate(() => window.__db.remark_preset_uses[0]);
  ok('押すと使った記録を送る（キーと条件だけ）', !!use && use.preset_key === 's:p1' && use.ctx.mode === 'air' && !('used_by' in use), use);
  ok('使った回数（use_count）も増える', await p.evaluate(() => window.__db.remark_presets[0].use_count === 1));
  await p.evaluate(() => { document.getElementById('remarkTextarea').value = ''; window.syncRemarkChips(); });

  // 共有プリセットに条件つきで追加
  await p.evaluate(() => window.rpOpenWith({ text: 'ベトナム向けは原産地証明が必要な場合があります。', label: '🇻🇳 原産地', cond: { cc: ['VN'] } })); await W(150);
  ok('ログイン中は保存先を選べる（既定はチーム共有）', await p.evaluate(() => !document.getElementById('rpDestRow').hidden && !document.getElementById('rpFormPersonal').checked));
  await p.evaluate(() => document.querySelector('#remarkPresetModal .bm-btn-save').click()); await W(400);
  ok('共有プリセットに conditions が入る', await p.evaluate(() => { const r = window.__db.remark_presets.find(x => x.label === '🇻🇳 原産地'); return r && r.conditions && r.conditions.cc[0] === 'VN'; }));

  // SQL 未実行のとき
  await p.evaluate(() => { window.__noCond = true; return window.loadSharedRemarkPresets(); }); await W(300);
  ok('SQL 未実行でも共有プリセットは読める', await p.evaluate(() => window.rpCondColsState() === false && [...document.querySelectorAll('#presetBtns .preset-btn-shared, #presetBtns .preset-btn-promoted')].length >= 1));
  await p.evaluate(() => window.rpOpenWith({ text: 'テスト用の共有の文です。', label: '🧪 共有', cond: { mode: ['fcl'] } })); await W(150);
  ok('SQL 未実行の案内が出る', await p.evaluate(() => !document.getElementById('rsSqlNote').hidden));
  await p.evaluate(() => document.querySelector('#remarkPresetModal .bm-btn-save').click()); await W(500);
  ok('SQL 未実行なら条件を外して保存する（ラベル・本文は残る）', await p.evaluate(() => { const r = window.__db.remark_presets.find(x => x.label === '🧪 共有'); return !!r && !('conditions' in r); }));
  await p.evaluate(() => { window.__noCond = false; });

  // ---- 段階 3：過去のリマークから候補 ----
  await p.evaluate(() => {
    const mkRow = (i, remark) => ({ id: 'c' + i, data: { fields: { remarkTextarea: remark, 'cond-mode': '海上（FCL）', z2PodCountry: 'インド', 'cond-direction': 'export' } } });
    const rows = [
      mkRow(1, '・本船のスケジュールは変更になる場合があります。\n本見積もりの有効期限は発行日より30日間とします。'),
      mkRow(2, '本船のスケジュールは変更になる場合があります。\nフリータイムは7日間です。'),
      mkRow(3, '※本船のスケジュールは変更になる場合があります。\nフリータイムは14日間です。'),
      mkRow(4, 'フリータイムは10日間です。'),
      mkRow(5, '一度だけ書いた特別な文がここにあります。'),
    ];
    window.cloudGetAllRows = () => rows;
  });
  const cand = await p.evaluate(() => window.rsCollectCandidates());
  const t1 = cand.list.find(x => x.text.includes('本船のスケジュール'));
  ok('3 件以上の案件で書いた文が候補に出る（行頭の記号はそろえる）', !!t1 && t1.n === 3, cand.list);
  const t2 = cand.list.find(x => x.text.includes('フリータイム'));
  ok('数字だけ違う文はまとめる', !!t2 && t2.n === 3 && t2.variants === 3, t2);
  ok('プリセットにある文・1 件だけの文は出ない', !cand.list.some(x => /有効期限|一度だけ/.test(x.text)), cand.list.map(x => x.text));
  ok('条件の案（FCL・インド）を付ける', !!t1 && t1.cond && t1.cond.mode[0] === 'fcl' && t1.cond.cc[0] === 'IN', t1 && t1.cond);
  await p.evaluate(() => document.getElementById('rsCandBtn').click()); await W(500);
  ok('候補の画面が開いて一覧が出る', await p.evaluate(() => document.getElementById('rsCandModal').classList.contains('open') && document.querySelectorAll('#rsCandBody .rs-cand').length >= 2));
  await p.evaluate(() => { const li = [...document.querySelectorAll('#rsCandBody .rs-cand')].find(x => x.textContent.includes('フリータイム')); li.querySelector('[data-rs="skip"]').click(); }); await W(200);
  ok('「今後出さない」で一覧から消え、次に探しても出ない', await p.evaluate(async () => !document.querySelector('#rsCandBody').textContent.includes('フリータイム') && !(await window.rsCollectCandidates()).list.some(x => x.text.includes('フリータイム'))));
  await p.evaluate(() => { const li = [...document.querySelectorAll('#rsCandBody .rs-cand')].find(x => x.textContent.includes('本船のスケジュール')); li.querySelector('[data-rs="make"]').click(); }); await W(200);
  ok('「プリセットにする」で本文・条件の案が入った登録画面が開く', await p.evaluate(() => document.getElementById('remarkPresetModal').classList.contains('open') && !document.getElementById('rsCandModal').classList.contains('open') && /本船のスケジュール/.test(document.getElementById('rpFormText').value) && /インド/.test(document.getElementById('rsIn_cc').value)));
  await p.evaluate(() => document.querySelector('#remarkPresetModal .bm-btn-cancel').click());

  ok('ページのエラーなし', !errs.length, errs);
  console.log(out.join('\n')); console.log('FAIL=' + out.filter(x => x.startsWith('FAIL')).length + ' / ' + out.length);
  await b.close(); srv.close();
})();

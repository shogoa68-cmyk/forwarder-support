// プリセット比較（_extractPresetStats）の試験：保存データの cells を正しい位置で読み、
// 合計・カテゴリ別が見積テーブルの合計と一致するか。架空データ・外部接続なし。
//   node scripts/design-tests/preset-compare-test.js
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const num = s => parseFloat(String(s).replace(/[^\d.-]/g, '')) || 0;

  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);

  const firstId = () => p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));
  const fill = async (id, f, v) => { await p.fill(`#${f}-${id}`, String(v)); await p.dispatchEvent(`#${f}-${id}`, 'input'); };
  // 1 行目：仕入 2 × 10,000 ＋ 乗せ幅 3,000（売数量は仕入数量に連動）
  const setRows = async (rows) => {
    let id = await firstId();
    for (let i = 0; i < rows.length; i++) {
      if (i > 0) { id = await p.evaluate(() => { addRow(); const a = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'); return a[a.length - 1].id.replace('row-', ''); }); }
      const r = rows[i];
      await p.evaluate(([id, cat]) => { const s = document.getElementById('cat-' + id); if (s) { s.value = cat; s.dispatchEvent(new Event('change', { bubbles: true })); } }, [id, r.cat]);
      await p.fill('#nm-' + id, r.nm);
      await fill(id, 'pq', r.pq); await fill(id, 'pp', r.pp); await fill(id, 'mk', r.mk);
    }
    await p.waitForTimeout(300);
    return p.evaluate(() => ({
      data: gatherAllData(),
      sub: document.getElementById('tot-subtotal').textContent,
      cost: document.getElementById('tot-cost').textContent,
      cats: [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].map(tr => {
        const id = tr.id.replace('row-', '');
        return { cat: document.getElementById('cat-' + id).value, sub: tr.querySelector('td.subtotal-cell .st-main').textContent };
      }),
    }));
  };
  const cats = await p.evaluate(() => [...document.querySelectorAll('#tableBody select[id^="cat-"]')][0] ? [...document.querySelector('#tableBody select[id^="cat-"]').options].map(o => o.value).filter(Boolean) : []);
  const A = await setRows([
    { cat: cats[0], nm: 'Ocean Freight', pq: 2, pp: 10000, mk: 3000 },
    { cat: cats[1], nm: 'THC', pq: 1, pp: 25000, mk: 5000 },
  ]);
  // 実データの並び確認：ROW_CELL_FIELDS 順（[5]=pq,[7]=bq,[8]=pc,[9]=bc,[10]=pp,[11]=bp,[13]=mk）
  const c0 = A.data.rows.find(r => r._type === 'data').cells;
  ok('cells の並びが ROW_CELL_FIELDS 順', +c0[5] === 2 && +c0[7] === 2 && c0[8] === 'JPY' && c0[9] === 'JPY' && +c0[10] === 10000 && +c0[11] === 13000 && +c0[13] === 3000, c0.slice(0, 15));

  await p.evaluate(() => { const id = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'); [...id].slice(1).forEach(tr => delRow(tr.id.replace('row-', ''))); });
  await p.waitForTimeout(300);
  const B = await setRows([
    { cat: cats[0], nm: 'Ocean Freight', pq: 1, pp: 12000, mk: 2000 },
    { cat: cats[1], nm: 'THC', pq: 1, pp: 25000, mk: 8000 },
  ]);

  await p.evaluate(([a, b]) => localStorage.setItem(PRESET_KEY, JSON.stringify([{ name: 'A案', data: a }, { name: 'B案', data: b }])), [A.data, B.data]);
  await p.evaluate(() => openCompare()); await p.waitForTimeout(200);
  await p.evaluate(() => document.querySelectorAll('.cmp-chk').forEach(c => { c.checked = true; toggleCmpItem(c); }));
  await p.evaluate(() => runCompare()); await p.waitForTimeout(300);
  const tbl = await p.evaluate(() => [...document.querySelectorAll('#cmpResult tr')].map(tr => [...tr.children].map(td => td.textContent.trim())));
  const rowOf = label => tbl.find(r => r[0] && r[0].startsWith(label)) || [];
  const catLabels = await p.evaluate(() => Object.fromEntries(CATEGORIES.map(c => [c.value, getCatLabel(c.value)])));
  const getCatLabelText = v => catLabels[v];
  const sumByCat = (x, cat) => x.cats.filter(c => c.cat === cat).reduce((s, c) => s + num(c.sub), 0);

  ok('A案 売上合計＝テーブル合計', num(rowOf('売上合計')[1]) === num(A.sub), [rowOf('売上合計'), A.sub]);
  ok('B案 売上合計＝テーブル合計', num(rowOf('売上合計')[2]) === num(B.sub), [rowOf('売上合計'), B.sub]);
  ok('A案 原価合計＝テーブル合計', num(rowOf('原価合計')[1]) === num(A.cost), [rowOf('原価合計'), A.cost]);
  ok('B案 原価合計＝テーブル合計', num(rowOf('原価合計')[2]) === num(B.cost), [rowOf('原価合計'), B.cost]);
  // 行別表：カテゴリ見出し行の下に [空, 項目名, A, B, 差分] が並ぶ
  const cmpByCat = {}; let head = null;
  tbl.forEach(r => {
    if (r.length === 1 && !r[0].startsWith('■')) head = r[0];
    else if (head && r.length === 5 && r[0] === '') { const o = cmpByCat[head] = cmpByCat[head] || [0, 0]; o[0] += num(r[2]); o[1] += num(r[3]); }
  });
  for (const cat of [cats[0], cats[1]]) {
    const label = Object.keys(cmpByCat).find(k => k.includes(getCatLabelText(cat))) ;
    const v = cmpByCat[label] || [];
    ok(`カテゴリ「${cat}」A/B がテーブル小計と一致`, v[0] === sumByCat(A, cat) && v[1] === sumByCat(B, cat), [label, v, sumByCat(A, cat), sumByCat(B, cat)]);
  }
  ok('ページエラーなし', errs.length === 0, errs);

  console.log(out.join('\n'));
  await b.close(); srv.close();
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();

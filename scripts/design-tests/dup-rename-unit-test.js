// 明細を複製して品名だけ変えたとき、複製元の単位・備考が残らず、新しい品名の単位などに置き換わる試験。
//   node scripts/design-tests/dup-rename-unit-test.js   （THEME=1 Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  // 品名マスターの代わり：SEAL は単位 CNTR・備考あり、THC 20 は 20'GP、LOOSE は単位なし
  await p.evaluate(() => {
    const M = { 'SEAL': { defaultUnit: 'CNTR', defaultNote: 'シール代' }, 'THC 20': { defaultUnit: "20'GP" }, 'LOOSE': {} };
    window.mdGet = window.mdGetCanon = (f, v) => (f === 'nm' && M[String(v).toUpperCase()]) ? { details: M[String(v).toUpperCase()] } : null;
  });
  let _seen = new Set();
  const newest = async () => { const r = await rows(); const n = r.find(x => !_seen.has(x.id)); r.forEach(x => _seen.add(x.id)); return n; };
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].map(tr => { const g = k => tr.querySelector(`[data-field="${k}"]`)?.value || ''; return { id: tr.id.replace('row-', ''), nm: g('nm'), un: g('un'), nt: g('nt'), auto: tr.dataset.unAuto || '', inh: tr.dataset.unInherit || '' }; }));
  const setF = (id, f, v, ev = ['input', 'change']) => p.evaluate(([id, f, v, ev]) => { const el = document.querySelector(`#tableBody tr#row-${id} [data-field="${f}"]`); el.value = v; ev.forEach(e => el.dispatchEvent(new Event(e, { bubbles: true }))); }, [id, f, v, ev]);
  const first = (await rows())[0].id; await newest();
  // 品名 DOC FEE（マスターなし）・単位は手入力で 20'GP
  await setF(first, 'nm', 'DOC FEE'); await setF(first, 'un', "20'GP"); await setF(first, 'nt', '書類代');
  // 1) 複製 → 品名を SEAL に変える → 単位が CNTR に置き換わる
  await p.evaluate(id => window.duplicateRow(id), first); await p.waitForTimeout(400);
  let r = await rows(); const dup = r[1];
  ok('複製した行は、複製元の単位・備考をそのまま持つ', dup.un === "20'GP" && dup.nt === '書類代', dup);
  ok('複製した手入力の単位は「引き継ぎ」の印が付く', dup.inh === '1', dup);
  await setF(dup.id, 'nm', 'SEAL', ['change']); await p.waitForTimeout(300);
  r = await rows();
  ok('複製して品名を SEAL にすると、単位が CNTR に置き換わる（手で直さなくてよい）', r[1].un === 'CNTR', r[1]);
  ok('備考も、マスターの既定（シール代）に置き換わる', r[1].nt === 'シール代', r[1]);
  ok('複製元の行は変わらない', r[0].un === "20'GP" && r[0].nt === '書類代', r[0]);
  // 2) 単位を手で打った後は、品名を変えても上書きしない
  await setF(dup.id, 'un', 'BL'); await setF(dup.id, 'nm', 'THC 20', ['change']); await p.waitForTimeout(300);
  r = await rows();
  ok('単位を手で直したあとは、品名を変えても上書きしない', r[1].un === 'BL', r[1]);
  // 3) マスターに単位が無い品名では、複製元の単位をそのまま残す
  await p.evaluate(id => window.duplicateRow(id), first); await p.waitForTimeout(400);
  const dup2 = await newest();
  await setF(dup2.id, 'nm', 'LOOSE', ['change']); await p.waitForTimeout(300);
  r = await rows();
  const dd2 = r.find(x => x.id === dup2.id);
  ok('マスターに単位が無く、同じ品名の行も無ければ、複製元の単位が残る', dd2.un === "20'GP", dd2);
  // 4) この見積の同じ品名の行の単位を使う（マスターに無い品名）
  await setF(first, 'un', 'BL'); // DOC FEE の行の単位を BL に
  await p.evaluate(id => window.duplicateRow(id), first); await p.waitForTimeout(400);
  const dup3 = await newest();
  await setF(dup3.id, 'nm', 'XYZ'); await setF(dup3.id, 'un', 'PKG'); await setF(dup3.id, 'nm', 'DOC FEE', ['change']); await p.waitForTimeout(300);
  r = await rows();
  ok('単位を手で入れた行は、同じ品名の行があっても上書きしない', r.find(x => x.id === dup3.id).un === 'PKG', r);
  await p.evaluate(id => window.duplicateRow(id), first); await p.waitForTimeout(400);
  const dup4 = await newest();
  await setF(dup4.id, 'nm', 'THC 20'); await setF(dup4.id, 'un', ''); await p.waitForTimeout(100);
  await setF(dup4.id, 'nm', 'DOC FEE', ['change']); await p.waitForTimeout(300);
  r = await rows();
  ok('単位が空の行に、この見積の同じ品名（DOC FEE）の行の単位（BL）が入る', r.find(x => x.id === dup4.id).un === 'BL', r);
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

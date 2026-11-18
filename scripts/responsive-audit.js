#!/usr/bin/env node
/* 画面の幅を変えながら、表示崩れを機械的に拾う点検ツール（読み取りのみ・アプリは変更しない）
 *
 * 使い方（リポジトリの直下で実行）:
 *   node <このファイル> --tab stats --theme industry --widths 360,600,900,1100,1440,1920 [--shots 出力フォルダ] [--json]
 *
 *   --tab     タブ名（booking bookmark bugreports calc calendar cost cptest docs master quote ref stats vessel workfolder）
 *   --theme   industry | classic | quiet（既定 industry）
 *   --widths  カンマ区切りの幅（既定 360,600,900,1100,1440,1920）
 *   --height  画面の高さ（既定 900）
 *   --editor  tab=quote のとき、編集画面を開いて行を3つ足す
 *   --setup   ファイル名。読み込み後・点検前に、ページの中で実行する JS（疑似データの注入やパネルを開く操作など）
 *   --root    リポジトリのパス（既定は実行した場所）
 *   --shots   写真を保存するフォルダ（幅ごとに viewport と全体を撮る）
 *   --json    結果を JSON で出す
 *
 * 拾うもの:
 *   contrast  文字色と実際の背景色のコントラスト比が低い（< 4.5、大きい文字は < 3。< 2.5 は「ほぼ読めない」）
 *   overflow  画面（ビューポート）の外へはみ出す要素／ページが横に伸びる
 *   clipped   overflow:hidden で文字が切れている（… 省略は除く）
 *   wide      不自然に広い入力欄（数値・日付・選択は 520px 超、文字入力は画面の 8 割かつ 720px 超）
 *   squashed  文字が 1 文字幅に潰れて縦に伸びている
 */
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');

const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf('--' + k); return i < 0 ? d : (A[i + 1] && !A[i + 1].startsWith('--') ? A[i + 1] : true); };
const TAB = arg('tab', 'quote'), THEME = arg('theme', 'industry'), HEIGHT = +arg('height', 900);
const WIDTHS = String(arg('widths', '360,600,900,1100,1440,1920')).split(',').map(Number);
const ROOT = path.resolve(arg('root', process.cwd())), SHOTS = arg('shots', ''), AS_JSON = !!arg('json', false);
const SETUP = arg('setup', '') ? fs.readFileSync(arg('setup'), 'utf8') : '';

// ページの中で実行する点検（文字列にして evaluate へ渡す）
function audit() {
  const vw = document.documentElement.clientWidth, vh = innerHeight;
  const out = { vw, pageOverflowX: document.documentElement.scrollWidth - vw, contrast: [], overflow: [], clipped: [], wide: [], squashed: [] };
  const sig = el => {
    const one = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '');
    const p = []; let e = el;
    for (let i = 0; e && e !== document.body && i < 3; i++, e = e.parentElement) { p.unshift(one(e)); if (e.id) break; }
    return p.join(' > ');
  };
  const parse = s => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const effBg = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none') return null;           // 画像・グラデーションは判定しない
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const visible = el => { const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const hiddenAncestor = el => { for (let e = el; e; e = e.parentElement) { if (e.hidden || e.getAttribute('aria-hidden') === 'true' || e.inert) return true; } return false; };
  const clippedByAncestor = el => { for (let e = el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (['auto', 'scroll', 'hidden', 'clip'].includes(cs.overflowX)) return true; } return false; };

  const all = [...document.querySelectorAll('body *')].filter(e => !['SCRIPT', 'STYLE', 'OPTION', 'OPTGROUP', 'NOSCRIPT', 'SVG', 'PATH', 'BR'].includes(e.tagName.toUpperCase()));
  const cmap = new Map();
  for (const el of all) {
    if (!visible(el) || hiddenAncestor(el)) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();

    // 文字のコントラスト
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (own && !el.disabled && !el.closest('[disabled]') && cs.webkitTextFillColor !== 'transparent') {
      const fg = parse(cs.color), bg = effBg(el);
      if (fg && bg) {
        const o = opac(el), f = blend({ ...fg, a: fg.a * o }, bg);
        const L1 = lum(f), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const fs = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = fs >= 24 || (fs >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        if (ratio < need) {
          const k = sig(el) + '|' + cs.color + '|' + (bg.r | 0) + ',' + (bg.g | 0) + ',' + (bg.b | 0);
          const c = cmap.get(k) || { sel: sig(el), ratio: +ratio.toFixed(2), need, severity: ratio < 2.5 ? 'ほぼ読めない' : '低い', color: cs.color, bg: `rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})`, sample: own.slice(0, 30), n: 0 };
          c.n++; cmap.set(k, c);
        }
      }
    }

    // 画面の外へのはみ出し
    if ((r.right > vw + 1 || r.left < -1) && !clippedByAncestor(el) && cs.position !== 'fixed' && own) {
      out.overflow.push({ sel: sig(el), left: Math.round(r.left), right: Math.round(r.right), vw, sample: own.slice(0, 24) });
    }

    // 文字が切れている（… 省略は意図的なので除く）
    if (['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis' && own && el.clientWidth > 0) {
      out.clipped.push({ sel: sig(el), scrollW: el.scrollWidth, clientW: el.clientWidth, sample: own.slice(0, 24) });
    }

    // 不自然に広い入力欄
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) {
      const t = (el.type || '').toLowerCase();
      if (!['checkbox', 'radio', 'hidden', 'range', 'file', 'button', 'submit', 'color'].includes(t)) {
        const w = Math.round(r.width), narrowKind = ['number', 'date', 'time', 'datetime-local', 'month', 'tel'].includes(t) || el.tagName === 'SELECT';
        if ((narrowKind && w > 520) || (!narrowKind && el.tagName === 'INPUT' && w > 720 && w > vw * 0.8)) out.wide.push({ sel: sig(el), type: t || el.tagName.toLowerCase(), width: w, vw, hint: (el.placeholder || el.title || el.name || '').slice(0, 24) });
      }
    }

    // 1 文字幅に潰れた文字
    if (own.length >= 4 && r.width < parseFloat(cs.fontSize) * 2.2 && r.height > r.width * 2.5) out.squashed.push({ sel: sig(el), w: Math.round(r.width), h: Math.round(r.height), sample: own.slice(0, 16) });
  }
  out.contrast = [...cmap.values()].sort((a, b) => a.ratio - b.ratio);
  const dedupe = (arr, key) => { const m = new Map(); for (const x of arr) { const k = key(x); if (!m.has(k)) m.set(k, { ...x, n: 0 }); m.get(k).n++; } return [...m.values()]; };
  out.overflow = dedupe(out.overflow, x => x.sel).sort((a, b) => b.right - a.right);
  out.clipped = dedupe(out.clipped, x => x.sel);
  out.wide = dedupe(out.wide, x => x.sel + x.width);
  out.squashed = dedupe(out.squashed, x => x.sel);
  return out;
}

(async () => {
  const srv = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    const ext = path.extname(f), types = { '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
    r.writeHead(200, { 'Content-Type': types[ext] || 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${THEME}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const report = [];
  for (const w of WIDTHS) {
    const ctx = await b.newContext({ viewport: { width: w, height: HEIGHT }, locale: 'ja-JP' });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(10000);
    try {
      await p.goto(base, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
      await p.evaluate(t => { const b = document.querySelector(`[onclick*="switchCategory('${t}'"]`) || document.querySelector(`[onclick*="${t === 'quote' ? 'quote-make' : t}"]`); if (b) b.click(); else if (window.switchCategory) window.switchCategory(t); }, TAB);
      await p.waitForTimeout(900);
      if (TAB === 'quote' && arg('editor', false)) { await p.evaluate(() => { window.qpShowEditor && window.qpShowEditor(); for (let i = 0; i < 3; i++) window.addRow && window.addRow(); }); await p.waitForTimeout(700); }
      if (SETUP) { await p.evaluate(SETUP); await p.waitForTimeout(700); }
      const res = await p.evaluate(`(${audit.toString()})()`);
      res.width = w; res.errors = errs; report.push(res);
      if (SHOTS) {
        const base2 = path.join(SHOTS, `${TAB}-${THEME}-${w}`);
        await p.screenshot({ path: base2 + '-view.png' });
        await p.screenshot({ path: base2 + '-full.png', fullPage: true, clip: undefined }).catch(() => {});
      }
    } catch (e) { report.push({ width: w, fatal: String(e.message || e).slice(0, 200) }); }
    await ctx.close();
  }
  await b.close(); srv.close();
  if (AS_JSON) { console.log(JSON.stringify({ tab: TAB, theme: THEME, report }, null, 1)); return; }
  console.log(`== 点検 tab=${TAB} theme=${THEME} ==`);
  for (const r of report) {
    if (r.fatal) { console.log(`\n[${r.width}px] 点検できず: ${r.fatal}`); continue; }
    const bad = r.contrast.filter(c => c.severity === 'ほぼ読めない');
    console.log(`\n[${r.width}px] 横はみ出し:${r.pageOverflowX > 1 ? r.pageOverflowX + 'px あり' : 'なし'}  読めない文字:${bad.length}種  色が低い:${r.contrast.length - bad.length}種  外へ出る:${r.overflow.length}  文字切れ:${r.clipped.length}  広すぎる入力欄:${r.wide.length}  潰れ:${r.squashed.length}  JSエラー:${r.errors.length}`);
    const show = (t, arr, f) => arr.slice(0, 8).forEach(x => console.log(`   ${t} ${f(x)}`));
    show('🔴読めない', bad, c => `${c.sel}  比${c.ratio} 文字${c.color} 背景${c.bg} 「${c.sample}」×${c.n}`);
    show('🟡色が低い', r.contrast.filter(c => c.severity !== 'ほぼ読めない'), c => `${c.sel}  比${c.ratio}(要${c.need}) 「${c.sample}」×${c.n}`);
    show('➡️外へ', r.overflow, o => `${o.sel}  ${o.left}〜${o.right} / 画面${o.vw} 「${o.sample}」`);
    show('✂️切れ', r.clipped, o => `${o.sel}  中身${o.scrollW} > 枠${o.clientW} 「${o.sample}」`);
    show('↔️広い', r.wide, o => `${o.sel}  ${o.type} ${o.width}px / 画面${o.vw} ${o.hint}`);
    show('📏潰れ', r.squashed, o => `${o.sel}  ${o.w}×${o.h}px 「${o.sample}」`);
    if (r.errors.length) console.log('   JSエラー:', r.errors.slice(0, 2).join(' | '));
  }
})();

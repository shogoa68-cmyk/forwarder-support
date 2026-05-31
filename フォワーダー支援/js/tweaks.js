// ================================================================
//  Tweaks パネル（デザインの "感触" を変える表現的コントロール）
//  ・アクセント（配色の性格）／基調（和紙↔純白）／情報密度
//  ホストプロトコル準拠（__edit_mode_available / __activate_edit_mode /
//  __deactivate_edit_mode / __edit_mode_dismissed）。値は localStorage 永続化。
// ================================================================
(function () {
  'use strict';

  const LS_KEY = 'quoteTweaks_v1';

  // ---- アクセント配色（--accent / --accent-dk / --accent-lt を上書き） ----
  const ACCENTS = {
    sand:      { label: '砂',  swatch: '#6b5a42', vars: { '--accent': '#6b5a42', '--accent-dk': '#3d2e1e', '--accent-lt': '#f0e8d8' } },
    indigo:    { label: '藍',  swatch: '#3a5a8f', vars: { '--accent': '#3a5a8f', '--accent-dk': '#22395c', '--accent-lt': '#e7eef7' } },
    moss:      { label: '苔',  swatch: '#5a6e42', vars: { '--accent': '#5a6e42', '--accent-dk': '#39482a', '--accent-lt': '#ebf0e0' } },
    vermilion: { label: '朱',  swatch: '#b0553a', vars: { '--accent': '#b0553a', '--accent-dk': '#7a3622', '--accent-lt': '#f6e6df' } },
  };

  // ---- 基調（紙の質感）: 和紙＝温かみ / 純白＝クリーン（白基調） ----
  const BASES = {
    washi: { label: '和紙', vars: { '--bg': '#f2ede6', '--card-bg': '#faf7f2', '--border': '#d9cfc2', '--border-md': '#c4b49a', '--text': '#2d2418' } },
    white: { label: '純白', vars: { '--bg': '#eef1f5', '--card-bg': '#ffffff', '--border': '#dfe3ea', '--border-md': '#c6cdd8', '--text': '#1f2933' } },
  };

  const DENSITIES = { comfy: 'ゆったり', standard: '標準', compact: 'コンパクト' };

  const DEFAULTS = { accent: 'sand', base: 'washi', density: 'standard' };

  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); }
    catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function save(t) { try { localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch (_) {} }

  let tweaks = load();

  // ---- 適用 ----
  function apply() {
    const root = document.documentElement;
    const acc = ACCENTS[tweaks.accent] || ACCENTS.sand;
    const base = BASES[tweaks.base] || BASES.washi;
    Object.entries(acc.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    Object.entries(base.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    const b = document.body;
    if (!b) return;
    b.classList.remove('twk-base-washi', 'twk-base-white');
    b.classList.add('twk-base-' + tweaks.base);
    b.classList.remove('twk-density-comfy', 'twk-density-standard', 'twk-density-compact');
    b.classList.add('twk-density-' + tweaks.density);
  }

  // ---- 感触を変える追加スタイル（基調=純白 / 情報密度） ----
  const STYLE = `
    /* 純白基調：温かみのある面をクールな白/グレーへ寄せる */
    body.twk-base-white .header { background: var(--accent-dk); }
    body.twk-base-white #tab-quote-make table thead th,
    body.twk-base-white #tab-quote-make .qsp-section-head,
    body.twk-base-white #tab-quote-make .save-toolbar { background: #f1f4f8 !important; }
    body.twk-base-white #tab-quote-make .quote-summary-panel { background: #fbfcfd; }
    body.twk-base-white #tab-quote-make .qsp-header { background: #eef1f5; }
    body.twk-base-white .condition-section,
    body.twk-base-white #tab-quote-make .condition-section { box-shadow: 0 1px 3px rgba(30,40,60,.07); }
    body.twk-base-white #tab-quote-make .tot-row td,
    body.twk-base-white #tab-quote-make .subtotal-cell.tot-amt-cell { background: #eef3fb !important; }

    /* 情報密度：データツールの "詰まり具合" を再構成 */
    body.twk-density-compact  { --twk-fs: 13px; }
    body.twk-density-standard { --twk-fs: 14px; }
    body.twk-density-comfy    { --twk-fs: 15px; }
    body.twk-density-compact,
    body.twk-density-comfy { font-size: var(--twk-fs); }
    body.twk-density-compact #tab-quote-make table th,
    body.twk-density-compact #tab-quote-make table td { padding-top: 1px; padding-bottom: 1px; }
    body.twk-density-compact #tab-quote-make .condition-section { padding: 11px 14px; margin-bottom: 9px; }
    body.twk-density-comfy #tab-quote-make table th,
    body.twk-density-comfy #tab-quote-make table td { padding-top: 7px; padding-bottom: 7px; }
    body.twk-density-comfy #tab-quote-make .condition-section { padding: 24px 26px; margin-bottom: 20px; }
    body.twk-density-comfy #tab-quote-make .qsp-fin .qsp-currency-row,
    body.twk-density-comfy #tab-quote-make .qsp-fin .qsp-total-row,
    body.twk-density-comfy #tab-quote-make .qsp-fin .qsp-profit-row,
    body.twk-density-comfy #tab-quote-make .qsp-fin .qsp-tax-row { padding: 4px 0; }

    /* ---- パネル本体 ---- */
    .twk-panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      width: 256px; display: none; flex-direction: column;
      background: rgba(250,249,247,.82); color: #2d2418;
      -webkit-backdrop-filter: blur(22px) saturate(150%); backdrop-filter: blur(22px) saturate(150%);
      border: .5px solid rgba(255,255,255,.6); border-radius: 14px;
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 12px 40px rgba(40,30,20,.22);
      font: 12px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    .twk-panel.open { display: flex; }
    .twk-hd { display: flex; align-items: center; justify-content: space-between;
      padding: 11px 10px 11px 15px; cursor: move; user-select: none; }
    .twk-hd b { font-size: 12.5px; font-weight: 700; letter-spacing: .02em; }
    .twk-x { appearance: none; border: 0; background: transparent; color: rgba(45,36,24,.5);
      width: 24px; height: 24px; border-radius: 7px; cursor: pointer; font-size: 15px; line-height: 1; }
    .twk-x:hover { background: rgba(0,0,0,.06); color: #2d2418; }
    .twk-body { padding: 4px 15px 16px; display: flex; flex-direction: column; gap: 15px; }
    .twk-sect { font-size: 10px; font-weight: 700; letter-spacing: .06em;
      color: rgba(45,36,24,.5); margin-bottom: 7px; }
    .twk-sect small { font-weight: 400; letter-spacing: 0; }
    .twk-seg { display: flex; gap: 3px; padding: 3px; border-radius: 9px; background: rgba(0,0,0,.06); }
    .twk-seg button { flex: 1; appearance: none; border: 0; background: transparent; color: inherit;
      font: inherit; font-weight: 600; padding: 5px 4px; border-radius: 6px; cursor: pointer;
      line-height: 1.2; transition: background .12s, box-shadow .12s; }
    .twk-seg button:hover { background: rgba(255,255,255,.5); }
    .twk-seg button.on { background: rgba(255,255,255,.95); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
    .twk-sw { display: flex; gap: 8px; }
    .twk-sw button { flex: 1; appearance: none; border: 1.5px solid transparent; background: transparent;
      border-radius: 10px; cursor: pointer; padding: 5px 0 6px; display: flex; flex-direction: column;
      align-items: center; gap: 5px; transition: border-color .12s, background .12s; }
    .twk-sw button:hover { background: rgba(0,0,0,.04); }
    .twk-sw button.on { border-color: rgba(45,36,24,.55); background: rgba(255,255,255,.55); }
    .twk-sw .dot { width: 26px; height: 26px; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
    .twk-sw .nm { font-size: 11px; font-weight: 600; color: rgba(45,36,24,.75); }
    @media print { .twk-panel { display: none !important; } }
  `;

  // ---- パネル描画 ----
  let panelEl = null;
  function buildPanel() {
    const style = document.createElement('style');
    style.id = 'twk-style';
    style.textContent = STYLE;
    document.head.appendChild(style);

    const p = document.createElement('div');
    p.className = 'twk-panel';
    p.setAttribute('data-omelette-chrome', '');
    p.innerHTML = `
      <div class="twk-hd"><b>Tweaks</b><button class="twk-x" title="閉じる">✕</button></div>
      <div class="twk-body">
        <div class="twk-grp" data-grp="accent">
          <div class="twk-sect">アクセント <small>配色の性格</small></div>
          <div class="twk-sw">${Object.entries(ACCENTS).map(([k, v]) =>
            `<button data-v="${k}"><span class="dot" style="background:${v.swatch}"></span><span class="nm">${v.label}</span></button>`).join('')}</div>
        </div>
        <div class="twk-grp" data-grp="base">
          <div class="twk-sect">基調 <small>紙の質感</small></div>
          <div class="twk-seg">${Object.entries(BASES).map(([k, v]) =>
            `<button data-v="${k}">${v.label}</button>`).join('')}</div>
        </div>
        <div class="twk-grp" data-grp="density">
          <div class="twk-sect">情報密度</div>
          <div class="twk-seg">${Object.entries(DENSITIES).map(([k, v]) =>
            `<button data-v="${k}">${v}</button>`).join('')}</div>
        </div>
      </div>`;
    document.body.appendChild(p);
    panelEl = p;

    p.querySelector('.twk-x').addEventListener('click', dismiss);
    p.querySelectorAll('.twk-grp').forEach(grp => {
      const key = grp.getAttribute('data-grp');
      grp.querySelectorAll('button[data-v]').forEach(btn => {
        btn.addEventListener('click', () => {
          tweaks[key] = btn.getAttribute('data-v');
          save(tweaks);
          apply();
          syncUI();
        });
      });
    });
    makeDraggable(p, p.querySelector('.twk-hd'));
    syncUI();
  }

  function syncUI() {
    if (!panelEl) return;
    panelEl.querySelectorAll('.twk-grp').forEach(grp => {
      const key = grp.getAttribute('data-grp');
      grp.querySelectorAll('button[data-v]').forEach(btn =>
        btn.classList.toggle('on', btn.getAttribute('data-v') === tweaks[key]));
    });
  }

  function makeDraggable(panel, handle) {
    let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('twk-x')) return;
      drag = true; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!drag) return;
      panel.style.left = (ox + e.clientX - sx) + 'px';
      panel.style.top  = (oy + e.clientY - sy) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { drag = false; });
  }

  // ---- ホストプロトコル ----
  function open()    { panelEl && panelEl.classList.add('open'); }
  function close()   { panelEl && panelEl.classList.remove('open'); }
  function dismiss() { close(); try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (_) {} }

  window.addEventListener('message', e => {
    const t = e && e.data && e.data.type;
    if (t === '__activate_edit_mode') open();
    else if (t === '__deactivate_edit_mode') close();
  });

  function init() {
    apply();
    buildPanel();
    try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

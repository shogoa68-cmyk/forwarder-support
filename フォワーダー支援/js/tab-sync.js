/* =====================================================================
 * 複数のブラウザのタブで使う（2026-11）
 *  ① 見積の作業は 1 つのタブだけ（2 つ目のタブで見積を開こうとすると止めて、こちらへ移すかを聞く）
 *  ② ほかの画面（リンク集・実績・マスター管理など）は、いくつのタブでも開ける
 *     ・上段のメニューを Ctrl／⌘＋クリック・真ん中クリック・右クリック →「新しいタブで開く」
 *     ・画面ごとのアドレス（…/index.html#view=stats）。そのアドレスで開くと、その画面から始まる
 *  見積を開いているタブ（＝持ち主）は localStorage に印を書き、ほかのタブは BroadcastChannel で
 *  「まだ開いていますか？」と聞いて確かめる（裏にあるタブのタイマーは遅くなるため、時刻では判定しない）。
 * ===================================================================== */
(function () {
  'use strict';
  const KEY = 'fwd.quoteOwner_v1';
  const ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('fwd-quote-owner') : null;
  let owner = false;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const write = v => { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} };
  const val = id => { const e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };
  function caseName() {
    const ref = val('qf-ref'), nm = val('qf-case-name') || (val('qf-memo').split('\n')[0] || '').trim() || val('qf-customer');
    return [ref, nm].filter(Boolean).join(' / ') || '（名前のない見積）';
  }
  function claim() { owner = true; write({ id: ID, at: Date.now() }); }
  function release() { owner = false; const o = read(); if (o && o.id === ID) write(null); }
  window.addEventListener('pagehide', release);
  window.qtOwn = { claim, release, isOwner: () => owner, id: ID };

  // 持ち主のタブ：ほかのタブからの問い合わせに答える
  if (bc) bc.onmessage = ev => {
    const m = ev.data || {}; if (m.to && m.to !== ID) return;
    if (m.t === 'who' && owner) bc.postMessage({ t: 'here', to: m.from, from: ID, name: caseName(), dirty: !!(window.quoteIsDirty && window.quoteIsDirty()) });
    if (m.t === 'release' && owner) {
      if (window.quoteIsDirty && window.quoteIsDirty()) { bc.postMessage({ t: 'busy', to: m.from, from: ID }); return; }
      release();
      try { if (typeof window.quoteHandOff === 'function') window.quoteHandOff(); } catch (e) {}
      bc.postMessage({ t: 'released', to: m.from, from: ID });
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('🗂 見積は別のタブへ移しました（このタブでは、ほかの画面を見られます）', 'info', 6000);
    }
  };
  function ask(t, wait) {
    return new Promise(res => {
      if (!bc) { res(null); return; }
      const h = ev => { const m = ev.data || {}; if (m.to !== ID) return; if (t === 'who' && m.t === 'here' || t === 'release' && (m.t === 'released' || m.t === 'busy')) { bc.removeEventListener('message', h); clearTimeout(tm); res(m); } };
      bc.addEventListener('message', h);
      const tm = setTimeout(() => { bc.removeEventListener('message', h); res(null); }, wait);
      bc.postMessage({ t, from: ID });
    });
  }

  // 見積を開く前の確認（cloud.js の qpNewQuote／cloudLoadPreset の先頭から呼ぶ）。止めたら true
  let bypass = false;
  function guard(fn) {
    if (bypass || owner) return false;
    const o = read(); if (!o || o.id === ID) return false;
    ask('who', 700).then(r => {
      if (!r) { write(null); run(fn); return; }   // 印だけ残っていて、もう閉じていた
      openModal(r, fn);
    });
    return true;
  }
  function run(fn) { bypass = true; try { fn(); } finally { bypass = false; } }
  window.qtOwnGuard = guard;

  function openModal(info, fn) {
    closeModal();
    const ov = document.createElement('div'); ov.id = 'qtOwnModal'; ov.className = 'qto-ov';
    ov.innerHTML = '<div class="qto-box" role="dialog" aria-modal="true" aria-labelledby="qtoTtl">' +
      '<h3 id="qtoTtl">🗂 見積は別のタブで開いています</h3>' +
      '<p>同時に開ける見積は <b>1 つだけ</b>です。</p>' +
      '<p class="qto-case">開いている見積：<b></b></p>' +
      '<p class="qto-msg">そのタブに戻って作業を続けるか、見積をこのタブへ移せます。リンク集・実績などの画面は、このタブでも見られます。</p>' +
      '<p class="qto-err" hidden></p>' +
      '<div class="qto-btns"><button type="button" class="qto-cancel">やめる</button><button type="button" class="qto-move">このタブへ移す</button></div></div>';
    ov.querySelector('.qto-case b').textContent = info.name || '';
    if (info.dirty) { const e = ov.querySelector('.qto-err'); e.hidden = false; e.textContent = '⚠ あちらのタブに保存していない変更があります。移すには、先にあちらで保存してください。'; }
    document.body.appendChild(ov);
    const mv = ov.querySelector('.qto-move');
    ov.querySelector('.qto-cancel').onclick = closeModal;
    ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    mv.onclick = async () => {
      mv.disabled = true; mv.textContent = '移しています…';
      const r = await ask('release', 1500);
      if (r && r.t === 'busy') {
        const e = ov.querySelector('.qto-err'); e.hidden = false; e.textContent = '⚠ あちらのタブに保存していない変更があります。あちらで保存してから、もう一度押してください。';
        mv.disabled = false; mv.textContent = 'このタブへ移す'; return;
      }
      if (!r) write(null);   // 返事が無い＝もう閉じていた
      closeModal(); run(fn);
    };
    setTimeout(() => mv.focus(), 0);
  }
  function closeModal() { const m = document.getElementById('qtOwnModal'); if (m) m.remove(); }

  // ---------------- ② 画面ごとのアドレスと「新しいタブで開く」 ----------------
  const BASE_TITLE = document.title;
  const authHash = () => /access_token|refresh_token|error|code=|type=/.test(location.hash);
  const viewOf = el => { const a = el && el.getAttribute('aria-controls'); return a && a.indexOf('tab-') === 0 ? a.slice(4) : ''; };
  const urlFor = v => location.pathname + location.search + '#view=' + encodeURIComponent(v);
  function labelOf(v) {
    const b = document.querySelector('.cat-btn[aria-controls="tab-' + v + '"]');
    return b ? (b.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }
  function setView(v) {
    if (!v || authHash()) return;
    try { if (location.hash !== '#view=' + encodeURIComponent(v)) history.replaceState(history.state, '', urlFor(v)); } catch (e) {}
    const l = labelOf(v); document.title = l ? l.replace(/^[^\p{L}\p{N}]+/u, '') + ' – ' + BASE_TITLE : BASE_TITLE;
  }
  function wrapSwitch() {
    const o = window.switchTab; if (typeof o !== 'function' || o.__tabSync) return;
    const w = function (tabId) { const r = o.apply(this, arguments); setView(tabId); return r; };
    w.__tabSync = true; window.switchTab = w;
  }
  function openNew(v) { if (v) window.open(urlFor(v), '_blank', 'noopener'); }
  window.tabOpenNew = openNew;

  // Ctrl／⌘／Shift＋クリック・真ん中クリック
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.cat-btn[aria-controls]'); if (!b) return;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); openNew(viewOf(b));
  }, true);
  document.addEventListener('mousedown', e => { if (e.button === 1 && e.target.closest && e.target.closest('.cat-btn[aria-controls]')) e.preventDefault(); }, true);   // 自動スクロールを出さない
  document.addEventListener('auxclick', e => {
    const b = e.button === 1 && e.target.closest && e.target.closest('.cat-btn[aria-controls]'); if (!b) return;
    e.preventDefault(); openNew(viewOf(b));
  }, true);
  // 右クリック：小さなメニュー
  function closeCtx() { const m = document.getElementById('tabCtxMenu'); if (m) m.remove(); }
  document.addEventListener('contextmenu', e => {
    const b = e.target.closest && e.target.closest('.cat-btn[aria-controls]'); if (!b) return;
    const v = viewOf(b); if (!v) return;
    e.preventDefault(); closeCtx();
    const m = document.createElement('div'); m.id = 'tabCtxMenu'; m.className = 'tab-ctx'; m.setAttribute('role', 'menu');
    m.innerHTML = '<button type="button" role="menuitem" data-a="new">↗ 新しいタブで開く</button><button type="button" role="menuitem" data-a="here">このタブで開く</button>';
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(e.clientX, innerWidth - r.width - 8)) + 'px';
    m.style.top = Math.max(8, Math.min(e.clientY, innerHeight - r.height - 8)) + 'px';
    m.onclick = ev => { const a = ev.target.closest('[data-a]'); if (!a) return; closeCtx(); if (a.dataset.a === 'new') openNew(v); else b.click(); };
    setTimeout(() => m.querySelector('button').focus(), 0);
  }, true);
  document.addEventListener('mousedown', e => { if (!e.target.closest || !e.target.closest('#tabCtxMenu')) closeCtx(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });
  window.addEventListener('scroll', closeCtx, { passive: true });

  // アドレスの #view=… で開いたら、その画面から始める
  function routeInitial() {
    const m = /^#view=([^&]+)/.exec(location.hash); if (!m) return;
    const v = decodeURIComponent(m[1]);
    const b = document.querySelector('.cat-btn[aria-controls="tab-' + v + '"]');
    if (b) { b.click(); return; }
    // カテゴリの中の小タブ（計算の各ツールなど）
    const t = document.querySelector('.tab-btn[onclick*="switchTab(\'' + v + '\'"]');
    if (t) { const sub = t.closest('.sub-nav'); const cat = sub && sub.id.replace(/^sub-/, ''); const cb = cat && document.querySelector('.cat-btn[onclick*="switchCategory(\'' + cat + '\'"]'); if (cb) cb.click(); t.click(); }
  }
  // ボタンの吹き出しに使い方を足す（title が無いものだけ）
  function hintTitles() { document.querySelectorAll('.cat-btn[aria-controls]').forEach(b => { if (!b.title) b.title = 'Ctrl（Mac は ⌘）＋クリック・右クリックで新しいタブに開けます'; }); }
  function boot() { wrapSwitch(); hintTitles(); setTimeout(routeInitial, 0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

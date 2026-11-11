// ========== 見積もりテーブルの「合計」を画面下に固定表示（テーブルを見ているときだけ） ==========
// 明細が長いと、表の最下部の合計行が画面の外に出て、金額を確認するたびに下までスクロールが必要になる。
// 見積もりテーブルが画面に出ていて、本物の合計行が画面の下に隠れているときだけ、表と同じ幅の合計バーを画面下に重ねる。
//   ・表の合計行（tfoot）が見える／テーブルが画面に無い／ダッシュボード・他のタブのときは出さない
//   ・中身は表の合計行（#tot-row-label／#tot-subtotal／#tot-cost／#tot-profit／#tot-fx-note）の写し。
//     合計行が書き換わるたびに MutationObserver で追従する（row.js updateTotals は触らない）
//   ・#tableScrollWrap は横スクロール用の枠（overflow-x:auto）で、CSS の sticky だけでは画面下に固定できないため別要素にしている
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let bar = null, raf = 0;

  function ensure() {
    if (bar) return bar;
    const tab = $('tab-quote-make');
    if (!tab) return null;
    bar = document.createElement('div');
    bar.id = 'totFloat';
    bar.hidden = true;
    bar.setAttribute('aria-hidden', 'true');   // 画面の写し（読み上げは表の合計行で行う）
    bar.innerHTML =
      '<div class="tf-note"></div>' +
      '<div class="tf-label"></div>' +
      '<div class="tf-amts"><div class="tf-sell"><span class="tf-tag">売</span><b class="tf-sell-v"></b></div>' +
        '<div class="tf-cost"><span class="tf-tag">仕</span><span class="tf-cost-v"></span></div></div>' +
      '<div class="tf-profit"></div>';
    tab.appendChild(bar);
    return bar;
  }

  // 表の合計行の内容を写す
  function mirror() {
    if (!ensure()) return;
    const set = (sel, html) => { const el = bar.querySelector(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
    const wbr = h => String(h).replace(/〜(?!<wbr>)/g, '〜<wbr>');   // 幅（下限〜上限）は狭いバーでは「〜」の後ろで折り返せるように
    const note = ($('tot-fx-note') && $('tot-fx-note').innerHTML) || '';
    set('.tf-note', note);
    bar.classList.toggle('has-range', /幅/.test(note));   // 狭い表示では注記を隠すので、幅を含むことは小さな印で示す
    set('.tf-label', ($('tot-row-label') && $('tot-row-label').innerHTML) || '合　計');
    set('.tf-sell-v', wbr(($('tot-subtotal') && $('tot-subtotal').innerHTML) || '—'));
    set('.tf-cost-v', ($('tot-cost') && $('tot-cost').innerHTML) || '—');
    const p = $('tot-profit');
    set('.tf-profit', wbr((p && p.innerHTML) || '—'));
    const pc = bar.querySelector('.tf-profit');
    if (pc && p) { pc.classList.toggle('is-neg', p.classList.contains('profit-neg')); pc.classList.toggle('is-pos', p.classList.contains('profit-pos')); }
  }

  // 出す／出さないの判定と、表の幅への位置合わせ
  function place() {
    raf = 0;
    if (!ensure()) return;
    const tab = $('tab-quote-make'), wrap = $('tableScrollWrap'), table = $('quoteTable'), foot = table && table.tFoot;
    const inEditor = !!tab && tab.classList.contains('active') && !tab.classList.contains('qp-dash') && !document.body.classList.contains('qp-dash-active');
    let show = false;
    if (inEditor && wrap && table && foot) {
      // いま見えている範囲（visual viewport）。スマホでは、横に広い表のせいでレイアウトの幅が画面より広くなったり、
      // 拡大・縮小・横スクロールで見える範囲が動いたりするため、fixed の基準（レイアウトの範囲）ではなく見えている範囲に合わせる
      const vv = window.visualViewport;
      const vL = vv ? vv.offsetLeft : 0, vT = vv ? vv.offsetTop : 0;
      const vW = vv ? vv.width : (window.innerWidth || document.documentElement.clientWidth);
      const vH = vv ? vv.height : (window.innerHeight || document.documentElement.clientHeight);
      const layoutH = window.innerHeight || document.documentElement.clientHeight;   // fixed の基準（レイアウトの高さ）
      const visBottom = vT + vH;
      const t = table.getBoundingClientRect(), f = foot.getBoundingClientRect(), w = wrap.getBoundingClientRect();
      const hasTotal = ($('tot-subtotal') && $('tot-subtotal').textContent.trim() && $('tot-subtotal').textContent.trim() !== '—');
      const tableInView = t.top < visBottom - 160 && t.bottom > vT + 120;   // 表が画面にそれなりに出ている（＝表を見ている）
      const footHidden = f.bottom > visBottom;                              // 本物の合計行は画面の下に隠れている
      const L = Math.max(w.left, vL), R = Math.min(w.right, vL + vW);       // 表の幅を、見えている範囲に収める
      show = hasTotal && tableInView && footHidden && R - L > 0;
      if (show) {
        const width = Math.round(R - L);
        bar.style.left = Math.max(0, Math.round(L)) + 'px';
        bar.style.width = width + 'px';
        if (width < 720) bar.setAttribute('data-compact', ''); else bar.removeAttribute('data-compact');   // 狭いときは 2 段表示
        // 画面下に固定した見積アクションドック（PDF出力／プレビュー／保存）のボタンと重なるときは、その上に持ち上げる
        let bottom = Math.max(0, layoutH - visBottom);
        const dock = $('quoteActionDock');
        if (dock && getComputedStyle(dock).display !== 'none') {
          let minTop = Infinity;
          dock.querySelectorAll('.qad-btn').forEach(b => { const r = b.getBoundingClientRect(); if (r.width && r.right > L && r.left < R && r.bottom > visBottom - 140) minTop = Math.min(minTop, r.top); });
          if (isFinite(minTop)) bottom = Math.max(bottom, layoutH - minTop + 6);
        }
        const lift = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rms-bar')) || 0;   // 画面下の全体リマーク（引き出し）の取っ手の上へ（開いても追従しない）
        bottom = Math.max(bottom, lift);
        bar.style.bottom = Math.round(bottom) + 'px';
      }
    }
    if (bar.hidden === show) bar.hidden = !show;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  function init() {
    if (!ensure()) return;
    mirror(); place();
    // 表の合計行の書き換えに追従（金額・ラベル・注記・粗利の色）
    const mo = new MutationObserver(() => { mirror(); schedule(); });
    ['tot-fx-note', 'tot-row-label', 'tot-subtotal', 'tot-cost', 'tot-profit'].forEach(id => {
      const el = $(id); if (el) mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    // タブ・ダッシュボード⇄編集の切り替え（クラスの変化）に追従
    const tab = $('tab-quote-make');
    if (tab) new MutationObserver(schedule).observe(tab, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule, { passive: true });
    if (window.visualViewport) {   // スマホの拡大・縮小・アドレスバーの出入りで見える範囲が変わるとき
      window.visualViewport.addEventListener('resize', schedule);
      window.visualViewport.addEventListener('scroll', schedule);
    }
    // 行の増減・折りたたみで表の高さが変わるとき（スクロールを伴わない）にも判定し直す
    const body = $('tableBody');
    if (body) new MutationObserver(schedule).observe(body, { childList: true, subtree: false });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.totFloatRefresh = () => { mirror(); schedule(); };
})();

// ================================================================
//  📝 メモ：1行目をタイトルとして強調表示（約1.4倍・太字）
//  textarea は1行目だけ書式を変えられないため、元の textarea（#qf-memo / #qf-memo-pop /
//  #qf-memo-float-ta）は「値の保持役」として残して非表示にし、見た目だけを
//  「タイトル欄（1行目）＋本文欄（2行目以降）」の2段に差し替える。
//  元 textarea の value を差し替え（getter/setter フック）、input イベントも発火するため、
//  既存の自動保存・メモ同期（拡大／付箋）・データ読込の処理は変更なしで動く。
//  保存形式は従来どおり「1行目\n2行目以降」の単一文字列（ui.js の1行目タイトル利用と同じ）。
// ================================================================
(function () {
  'use strict';

  const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

  function enhance(orig, variant) {
    if (!orig || orig.dataset.memoTitle === '1') return;
    orig.dataset.memoTitle = '1';

    const wrap = document.createElement('div');
    wrap.className = 'qm-wrap qm-wrap--' + variant;
    const title = document.createElement('textarea');
    title.className = 'qm-title';
    title.rows = 1;
    title.placeholder = '1行目がメモのタイトルになります';
    title.setAttribute('aria-label', 'メモのタイトル（1行目）');
    const body = document.createElement('textarea');
    body.className = 'qm-body';
    body.placeholder = orig.placeholder || '';
    body.setAttribute('aria-label', 'メモ本文（2行目以降）');
    wrap.appendChild(title);
    wrap.appendChild(body);
    orig.insertAdjacentElement('afterend', wrap);
    orig.style.display = 'none';

    const fit = () => {
      if (!title.offsetParent) return;          // 非表示中は計測できない（表示時に ResizeObserver で再計測）
      title.style.height = 'auto';
      title.style.height = title.scrollHeight + 'px';
    };
    const split = v => {
      const i = String(v).indexOf('\n');
      return i < 0 ? [String(v), ''] : [String(v).slice(0, i), String(v).slice(i + 1)];
    };
    // 本文が空のときは末尾に余計な改行を付けない（従来の「1行だけのメモ」と同じ値にする）
    const composeValue = () => body.value === '' ? title.value : title.value + '\n' + body.value;

    const setStored = v => nativeValue.set.call(orig, v);
    const render = v => {
      const [t, b] = split(v);
      title.value = t; body.value = b;
      fit();
    };
    const emit = () => {
      setStored(composeValue());
      orig.dispatchEvent(new Event('input', { bubbles: true }));
    };

    // 元 textarea の value を横取り：外部コードの読み書き（読込・同期・取込）をUIへ反映する
    Object.defineProperty(orig, 'value', {
      configurable: true,
      get() { return nativeValue.get.call(orig); },
      set(v) { const s = v == null ? '' : String(v); setStored(s); render(s); },
    });
    orig.focus = () => { title.focus(); };

    title.addEventListener('input', () => {
      if (title.value.indexOf('\n') >= 0) {
        // 複数行の貼り付け：1行目はタイトルに残し、以降は本文の先頭へ送る
        const [t, rest] = split(title.value);
        title.value = t;
        body.value = rest + (body.value ? (rest ? '\n' : '') + body.value : '');
        body.focus();
        body.setSelectionRange(rest.length, rest.length);
      }
      fit(); emit();
    });
    title.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); body.focus(); body.setSelectionRange(0, 0); }
      else if (e.key === 'ArrowDown' && title.selectionStart === title.value.length) {
        e.preventDefault(); body.focus(); body.setSelectionRange(0, 0);
      }
    });
    body.addEventListener('input', emit);
    body.addEventListener('keydown', e => {
      if (e.isComposing) return;
      if (e.key === 'Backspace' && body.selectionStart === 0 && body.selectionEnd === 0) {
        // 本文の先頭で Backspace → 本文1行目をタイトル末尾へ連結（タイトル欄の改行を消す操作）
        e.preventDefault();
        const joinAt = title.value.length;
        const [first, rest] = split(body.value);
        title.value = title.value + first; body.value = rest;
        title.focus(); title.setSelectionRange(joinAt, joinAt);
        fit(); emit();
      } else if (e.key === 'ArrowUp' && body.selectionStart === 0 && body.selectionEnd === 0) {
        e.preventDefault(); title.focus(); title.setSelectionRange(title.value.length, title.value.length);
      }
    });

    if (window.ResizeObserver) new ResizeObserver(fit).observe(wrap);
    render(nativeValue.get.call(orig));
  }

  function init() {
    enhance(document.getElementById('qf-memo'), 'main');
    enhance(document.getElementById('qf-memo-pop'), 'pop');
    enhance(document.getElementById('qf-memo-float-ta'), 'float');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

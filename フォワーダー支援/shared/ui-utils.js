// ================================================================
//  shared/ui-utils.js — UI 共通ユーティリティ
//
//  API:
//    SharedUI.copyToClipboard(text)               : Promise<boolean>
//    SharedUI.showToast(msg, type, durationMs)    : void
//        type:  'info' | 'success' | 'warn' | 'error' （CSS で色分け）
//        既存 'clipboard-toast' 要素があればそれを使う（実務支援）。
//        無ければ動的に生成（見積支援も新フォーマットで動く）。
//
//  既存実装との互換性：
//    - 実務支援 app.js の showToast(msg) は 1 引数 → そのまま動く
//    - 見積支援 app-cargo.js の showToast(msg, type, 3000) も動く
// ================================================================

window.SharedUI = (function () {
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallback());
    }
    return Promise.resolve(fallback());

    function fallback() {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  function showToast(msg, type, durationMs) {
    const dur = durationMs || 3000;
    // 既存の clipboard-toast を優先（実務支援）
    let t = document.getElementById('clipboard-toast');
    if (!t) {
      t = document.getElementById('_shared-toast');
      if (!t) {
        t = document.createElement('div');
        t.id = '_shared-toast';
        t.className = 'shared-toast';
        t.style.cssText = [
          'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
          'background:#333', 'color:#fff', 'padding:10px 18px', 'border-radius:8px',
          'font-size:13px', 'box-shadow:0 4px 16px rgba(0,0,0,.2)',
          'z-index:9999', 'opacity:0', 'transition:opacity .2s',
          'pointer-events:none', 'max-width:90vw',
        ].join(';');
        document.body.appendChild(t);
      }
    }
    if (msg != null) t.textContent = msg;

    // 型別の色
    if (type === 'success') t.style.background = '#2f855a';
    else if (type === 'warn') t.style.background = '#b7791f';
    else if (type === 'error') t.style.background = '#c53030';
    else if (type === 'info') t.style.background = '#333';

    // 既存 .show クラスがあればそれを使う、無ければ opacity 直接
    if (t.classList.contains('show') || t.id === 'clipboard-toast') {
      t.classList.add('show');
    } else {
      t.style.opacity = '1';
    }
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.classList.remove('show');
      t.style.opacity = '0';
    }, dur);
  }

  return { copyToClipboard, showToast };
})();

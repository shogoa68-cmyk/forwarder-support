/* ui-confirm.js — 取り消しにくい操作の確認画面（標準の confirm() の代わり）
 *
 *   const ok = await uiConfirm({
 *     title:        '申請を却下しますか？',            // 1 行の見出し（何をするか）
 *     lines:        ['品名「AMS」の申請を却下します。', '…'],  // 何が起きるかを文で（段落ごとに 1 要素）
 *     irreversible: '却下した記録は取り消せません。',    // 取り消せない旨（赤字）。省略可
 *     okLabel:      '却下する',                        // 実行ボタンの文言（既定「実行」）
 *     danger:       true,                              // 実行ボタンを赤の塗りに（取り消しにくい操作）
 *   });
 *
 * 初期の焦点は「やめる」（誤って Enter を押しても実行されない）。Esc・外側クリックは「やめる」。
 * 見た目は css/style.css の .confirm-overlay／.confirm-dialog（Industry は Design の master-admin-industry.css が上書き）。
 */
(function () {
  'use strict';

  window.uiConfirm = function (opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const prev = document.activeElement;
      const ov = document.createElement('div');
      ov.className = 'confirm-overlay';
      const dlg = document.createElement('div');
      dlg.className = 'confirm-dialog';
      dlg.setAttribute('role', 'alertdialog');
      dlg.setAttribute('aria-modal', 'true');
      const h = document.createElement('h3');
      h.className = 'confirm-title';
      h.id = 'confirmTitle' + Date.now();
      h.textContent = opts.title || '実行しますか？';
      dlg.setAttribute('aria-labelledby', h.id);
      dlg.appendChild(h);
      const body = document.createElement('div');
      body.className = 'confirm-body';
      (opts.lines || []).forEach(t => { const p = document.createElement('p'); p.textContent = t; body.appendChild(p); });
      if (opts.irreversible) {
        const p = document.createElement('p');
        p.className = 'irreversible';
        p.textContent = opts.irreversible;
        body.appendChild(p);
      }
      dlg.appendChild(body);
      const act = document.createElement('div');
      act.className = 'confirm-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button'; cancel.className = 'btn-cancel'; cancel.textContent = opts.cancelLabel || 'やめる';
      const ok = document.createElement('button');
      ok.type = 'button'; ok.className = opts.danger ? 'btn-danger' : 'btn-primary'; ok.textContent = opts.okLabel || '実行';
      act.appendChild(cancel); act.appendChild(ok);
      dlg.appendChild(act);
      ov.appendChild(dlg);
      document.body.appendChild(ov);

      const done = v => {
        document.removeEventListener('keydown', onKey, true);
        ov.remove();
        try { prev && prev.focus && prev.focus(); } catch (e) {}
        resolve(v);
      };
      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        else if (e.key === 'Tab') {   // 焦点を 2 つのボタンの間に閉じ込める
          e.preventDefault();
          (document.activeElement === cancel ? ok : cancel).focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', () => done(false));
      ok.addEventListener('click', () => done(true));
      ov.addEventListener('pointerdown', e => { if (e.target === ov) done(false); });
      cancel.focus();
    });
  };
})();

/* feedback-annotate.js — スクリーンショットへの書き込みエディタ（フリーハンド・図形・矢印・文字）
 *
 *   FeedbackAnnotate.open(blob, ops) → Promise<null | { unchanged:true } | { blob, ops }>
 *     blob … 元の画像（書き込み前）。ops … 前回の書き込み（再編集用。無ければ空）
 *     null＝キャンセル／{unchanged:true}＝書き込みなしで完了／{blob,ops}＝書き込み済み画像(JPEG)と操作列
 *
 * 書き込みは「操作のリスト」として持ち、毎回 元画像＋操作を描き直す（取り消し・やり直しが何度でもでき、
 * 元画像は壊さない）。座標は元画像のピクセル単位なので、画面の拡大縮小に左右されない。
 * ペン・蛍光ペン・四角・丸・矢印・文字。マウス／タッチ／ペンに対応（Pointer Events）。
 */
(function () {
  'use strict';

  const COLORS = ['#e5484d', '#1f6feb', '#f5a623', '#1a1a1a', '#ffffff'];
  const TOOLS = [
    { id: 'pen',     label: '✏️ ペン',     title: 'フリーハンド' },
    { id: 'marker',  label: '🖍 蛍光ペン', title: '半透明のマーカー（強調したい所に）' },
    { id: 'rect',    label: '▭ 四角',      title: '四角で囲む' },
    { id: 'ellipse', label: '◯ 丸',        title: '丸で囲む' },
    { id: 'arrow',   label: '➚ 矢印',      title: '矢印で指す' },
    { id: 'text',    label: 'T 文字',      title: 'クリックした所に文字を入れる' },
  ];
  const WIDTHS = [{ id: 1, label: '細' }, { id: 2, label: '中' }, { id: 3, label: '太' }];

  function _loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした')); };
      img.src = url;
    });
  }

  // 1つの操作を描く。unit は「画像の大きさに応じた基準の太さ」（大きい画像でも細く見えないように）
  function drawOp(ctx, op, unit, fontScale) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = op.c; ctx.fillStyle = op.c;
    const lw = unit * (op.w || 2);
    if (op.t === 'pen' || op.t === 'marker') {
      if (op.t === 'marker') { ctx.globalAlpha = 0.35; ctx.lineWidth = lw * 5; } else { ctx.lineWidth = lw; }
      ctx.beginPath();
      const p = op.pts;
      if (p.length === 1) { ctx.arc(p[0][0], p[0][1], ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.stroke(); }
    } else if (op.t === 'rect') {
      ctx.lineWidth = lw;
      ctx.strokeRect(Math.min(op.x1, op.x2), Math.min(op.y1, op.y2), Math.abs(op.x2 - op.x1), Math.abs(op.y2 - op.y1));
    } else if (op.t === 'ellipse') {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.ellipse((op.x1 + op.x2) / 2, (op.y1 + op.y2) / 2, Math.abs(op.x2 - op.x1) / 2, Math.abs(op.y2 - op.y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (op.t === 'arrow') {
      ctx.lineWidth = lw;
      const dx = op.x2 - op.x1, dy = op.y2 - op.y1;
      const len = Math.hypot(dx, dy);
      if (len < 2) { ctx.restore(); return; }
      const head = Math.min(len * 0.5, lw * 5 + unit * 6);       // 矢じりの長さ
      const ang = Math.atan2(dy, dx);
      ctx.beginPath(); ctx.moveTo(op.x1, op.y1); ctx.lineTo(op.x2 - Math.cos(ang) * head * 0.6, op.y2 - Math.sin(ang) * head * 0.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(op.x2, op.y2);
      ctx.lineTo(op.x2 - head * Math.cos(ang - Math.PI / 7), op.y2 - head * Math.sin(ang - Math.PI / 7));
      ctx.lineTo(op.x2 - head * Math.cos(ang + Math.PI / 7), op.y2 - head * Math.sin(ang + Math.PI / 7));
      ctx.closePath(); ctx.fill();
    } else if (op.t === 'text') {
      const px = Math.max(14, (op.size === 3 ? 40 : op.size === 1 ? 20 : 28) * fontScale);
      ctx.font = '700 ' + px + 'px "Noto Sans JP","Hiragino Sans",Meiryo,sans-serif';
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(3, px / 6);
      ctx.strokeStyle = (op.c === '#ffffff') ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.92)';    // 縁取りで、どんな背景でも読める
      String(op.s).split('\n').forEach((line, i) => {
        ctx.strokeText(line, op.x, op.y + i * px * 1.25);
        ctx.fillText(line, op.x, op.y + i * px * 1.25);
      });
    }
    ctx.restore();
  }

  function open(srcBlob, initialOps) {
    return new Promise(async (resolve) => {
      let img;
      try { img = await _loadImage(srcBlob); } catch (e) { resolve(null); return; }
      const W = img.naturalWidth, H = img.naturalHeight;
      const unit = Math.max(1.5, W / 520);         // 太さの基準（1920px 幅で約 3.7px）
      const fontScale = Math.max(0.8, W / 900);

      let hist = [Array.isArray(initialOps) ? initialOps.slice() : []];   // 操作列のスナップショット（取り消し/やり直し用）
      let hi = 0;
      let tool = 'pen', color = COLORS[0], wid = 2;
      let cur = null;                              // 描きかけの操作
      let textEl = null;

      const ov = document.createElement('div');
      ov.className = 'fba-overlay';
      ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'スクリーンショットに書き込む');
      ov.innerHTML =
        '<div class="fba-bar">' +
          '<div class="fba-group fba-tools" role="radiogroup" aria-label="道具">' + TOOLS.map(t => '<button type="button" class="fba-btn fba-tool' + (t.id === tool ? ' is-on' : '') + '" data-tool="' + t.id + '" title="' + t.title + '">' + t.label + '</button>').join('') + '</div>' +
          '<div class="fba-group fba-colors" aria-label="色">' + COLORS.map((c, i) => '<button type="button" class="fba-swatch' + (i === 0 ? ' is-on' : '') + '" data-color="' + c + '" style="background:' + c + '" title="色" aria-label="色 ' + (i + 1) + '"></button>').join('') + '</div>' +
          '<div class="fba-group fba-widths" aria-label="太さ・文字の大きさ">' + WIDTHS.map(w => '<button type="button" class="fba-btn fba-w' + (w.id === wid ? ' is-on' : '') + '" data-w="' + w.id + '" title="太さ・文字の大きさ">' + w.label + '</button>').join('') + '</div>' +
          '<div class="fba-group"><button type="button" class="fba-btn" id="fbaUndo" title="取り消し（Ctrl+Z）">↶ 戻す</button><button type="button" class="fba-btn" id="fbaRedo" title="やり直し（Ctrl+Y）">↷ 進む</button><button type="button" class="fba-btn" id="fbaClear" title="書き込みをすべて消す（戻すで復活できます）">🗑 全消し</button></div>' +
          '<div class="fba-spacer"></div>' +
          '<div class="fba-group"><button type="button" class="fba-btn" id="fbaCancel">キャンセル</button><button type="button" class="fba-btn fba-done" id="fbaDone">✓ 完了</button></div>' +
        '</div>' +
        '<div class="fba-stage"><div class="fba-wrap" id="fbaWrap"><canvas id="fbaCanvas" width="' + W + '" height="' + H + '"></canvas></div></div>' +
        '<div class="fba-hint">ドラッグで書き込み／「T 文字」は書きたい所をクリックして入力（Enter で確定・Shift+Enter で改行）／Esc でキャンセル</div>';
      document.body.appendChild(ov);

      const canvas = ov.querySelector('#fbaCanvas');
      const wrap = ov.querySelector('#fbaWrap');
      const ctx = canvas.getContext('2d');
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      function ops() { return hist[hi]; }
      function commit(next) { hist = hist.slice(0, hi + 1); hist.push(next); hi = hist.length - 1; refreshBtns(); redraw(); }
      function refreshBtns() {
        ov.querySelector('#fbaUndo').disabled = hi === 0;
        ov.querySelector('#fbaRedo').disabled = hi === hist.length - 1;
        ov.querySelector('#fbaClear').disabled = ops().length === 0;
      }
      function redraw() {
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        ops().forEach(o => drawOp(ctx, o, unit, fontScale));
        if (cur) drawOp(ctx, cur, unit, fontScale);
      }
      function pos(e) {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
      }

      // ---- 文字入力 ----
      function endText(commitIt) {
        if (!textEl) return;
        const el = textEl; textEl = null;
        const val = el.value.replace(/\s+$/, '');
        const x = +el.dataset.x, y = +el.dataset.y;
        el.remove();
        if (commitIt && val) commit(ops().concat([{ t: 'text', c: color, size: wid, x, y, s: val }]));
      }
      function startText(p, e) {
        endText(true);
        const r = canvas.getBoundingClientRect();
        const scale = r.width / W;
        const px = Math.max(14, (wid === 3 ? 40 : wid === 1 ? 20 : 28) * fontScale);
        const el = document.createElement('textarea');
        el.className = 'fba-text-input';
        el.rows = 1; el.spellcheck = false;
        el.dataset.x = p[0]; el.dataset.y = p[1];
        el.style.left = (e.clientX - wrap.getBoundingClientRect().left) + 'px';
        el.style.top = (e.clientY - wrap.getBoundingClientRect().top) + 'px';
        el.style.fontSize = Math.max(12, px * scale) + 'px';
        el.style.color = color === '#ffffff' ? '#ffffff' : color;
        el.addEventListener('keydown', ev => {
          if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); endText(true); }
          else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endText(false); }
          el.rows = Math.min(8, el.value.split('\n').length);
        });
        el.addEventListener('blur', () => endText(true));
        wrap.appendChild(el);
        textEl = el;
        setTimeout(() => el.focus(), 0);
      }

      // ---- 描画 ----
      canvas.addEventListener('pointerdown', e => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        const p = pos(e);
        if (tool === 'text') { startText(p, e); return; }
        endText(true);
        canvas.setPointerCapture(e.pointerId);
        if (tool === 'pen' || tool === 'marker') cur = { t: tool, c: color, w: wid, pts: [p] };
        else cur = { t: tool, c: color, w: wid, x1: p[0], y1: p[1], x2: p[0], y2: p[1] };
        redraw();
      });
      canvas.addEventListener('pointermove', e => {
        if (!cur) return;
        const p = pos(e);
        if (cur.pts) { const l = cur.pts[cur.pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > unit * 0.4) cur.pts.push(p); }
        else { cur.x2 = p[0]; cur.y2 = p[1]; }
        redraw();
      });
      function finish() {
        if (!cur) return;
        const o = cur; cur = null;
        const tiny = o.pts ? false : (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < unit * 2);
        if (tiny) { redraw(); return; }                // ただのクリックで図形が出ないように
        commit(ops().concat([o]));
      }
      canvas.addEventListener('pointerup', finish);
      canvas.addEventListener('pointercancel', finish);

      // ---- ツールバー ----
      ov.addEventListener('click', e => {
        const t = e.target.closest('[data-tool]'); if (t) { endText(true); tool = t.dataset.tool; ov.querySelectorAll('.fba-tool').forEach(b => b.classList.toggle('is-on', b === t)); canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair'; return; }
        const c = e.target.closest('[data-color]'); if (c) { color = c.dataset.color; ov.querySelectorAll('.fba-swatch').forEach(b => b.classList.toggle('is-on', b === c)); return; }
        const w = e.target.closest('[data-w]'); if (w) { wid = +w.dataset.w; ov.querySelectorAll('.fba-w').forEach(b => b.classList.toggle('is-on', b === w)); return; }
      });
      canvas.style.cursor = 'crosshair';
      ov.querySelector('#fbaUndo').onclick = () => { endText(true); if (hi > 0) { hi--; refreshBtns(); redraw(); } };
      ov.querySelector('#fbaRedo').onclick = () => { if (hi < hist.length - 1) { hi++; refreshBtns(); redraw(); } };
      ov.querySelector('#fbaClear').onclick = () => { endText(false); if (ops().length) commit([]); };

      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        document.body.style.overflow = prevOverflow;
        ov.remove();
        resolve(result);
      }
      async function onCancel() {
        endText(false);
        if (hist.length > 1 && typeof window.uiConfirm === 'function') {
          const ok = await window.uiConfirm({ title: '書き込みを破棄しますか？', lines: ['このスクリーンショットへの書き込みはすべて失われます。'], okLabel: '破棄する', danger: true });
          if (!ok) return;
        }
        close(null);
      }
      function onDone() {
        endText(true);
        if (ops().length === 0) { close({ unchanged: true }); return; }
        redraw();
        canvas.toBlob(b => close(b ? { blob: b, ops: ops().slice() } : null), 'image/jpeg', 0.9);
      }
      ov.querySelector('#fbaCancel').onclick = onCancel;
      ov.querySelector('#fbaDone').onclick = onDone;

      // Esc は書き込み画面だけを閉じる（背面のフィードバックモーダルまで閉じない）。Ctrl+Z / Ctrl+Y も受ける
      function onKey(e) {
        const inText = textEl && document.activeElement === textEl;
        if (inText) return;     // 文字入力中は入力欄に任せる（Enter 確定・Esc でその文字だけ取消は入力欄側で処理）
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onCancel(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); e.stopImmediatePropagation(); ov.querySelector('#fbaUndo').click(); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); e.stopImmediatePropagation(); ov.querySelector('#fbaRedo').click(); }
      }
      document.addEventListener('keydown', onKey, true);

      refreshBtns();
      redraw();
      ov.querySelector('#fbaDone').focus();
    });
  }

  window.FeedbackAnnotate = { open: open, drawOp: drawOp };
})();

/* ===================================================================
 * 見積の診断カード（ルールベース・外部送信なし／2026-11）
 *
 * 見積入力の右パネル「💰 金額」の下に「🩺 見積の診断（目安）」を出す。
 * AI ではなく固定のルールで、いまの見積の気になる点を並べるだけ（数字はこの端末のデータだけで計算し、どこにも送らない）。
 *   ① 粗利率の水準（赤字／5% 未満＝低い／8〜12% ＝標準／15% 以上＝高め）
 *   ② 売単価の入れ忘れ・行ごとの赤字（行の数と品名）
 *   ③ 当て馬の疑い（引き合いの経路：新規・メール一括・金額のみ の組み合わせ）
 *   ④ 過去の実績（お客様別の受注率・同じ粗利率帯の受注率。stats.js の statsDiagHistory）
 *   ⑤ 外貨換算が含まれることの注意
 * 呼び出し：ui.js updateQuoteSummary の最後から window.qdgRender()。
 * 保存データは変更しない（読むだけ）。
 * =================================================================== */
(function () {
  'use strict';
  // 粗利率のしきい値（%）。業界の目安として 5%未満＝低い／8〜12%＝標準／15%以上＝高め
  const TH = { low: 5, stdLo: 8, stdHi: 12, high: 15 };
  const MIN_N_BAND = 10;      // 帯ごとの実績をはっきり言う最低件数
  const MIN_N_CUST = 3;       // お客様別の実績を出す最低件数
  const WARN_N_CUST = 5;      // 歩留まりの警告を出す最低件数

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const val = id => ($(id)?.value || '').trim();

  // 行ごとの確認（売単価の入れ忘れ・行ごとの赤字）。updateQuoteSummary と同じ「客先に出る行」だけを見る。
  function scanRows() {
    const missing = [], loss = [];
    document.querySelectorAll('#tableBody tr:not([data-type="subtotal"])').forEach(tr => {
      if (tr.dataset.virtual === '1' || tr.dataset.hideQuote === '1' || tr.dataset.outRange === '1' || tr.dataset.actual === '1' ||
          tr.dataset.profitShare === '1' || tr.dataset.cond === '1' || tr.dataset.refInfo === '1') return;
      const id = tr.id.replace('row-', '');
      const name = (document.getElementById('nm-' + id)?.value || '').trim();
      if (!name) return;
      const g = f => parseFloat(document.getElementById(f + '-' + id)?.value) || 0;
      const pc = document.getElementById('pc-' + id)?.value || 'JPY', bc = document.getElementById('bc-' + id)?.value || 'JPY';
      const cost = SharedCalc.jpyRound(toJPY(applyRowMin(g('pq') * g('pp'), id, 'cost'), pc));
      const bill = SharedCalc.jpyRound(toJPY(applyRowMin(g('bq') * g('bp'), id, 'sell'), bc));
      if (cost > 0 && bill === 0) { if (document.getElementById('zc-' + id)?.value !== '1') missing.push(name); }   // 「あえて¥0」にした行は除く
      else if (cost > 0 && bill > 0 && bill < cost) loss.push(name);
    });
    return { missing, loss };
  }

  const names = (a, n) => a.slice(0, n).map(s => '「' + esc(s) + '」').join('') + (a.length > n ? ' ほか' + (a.length - n) + '件' : '');
  const pct = (x, d) => (x == null ? '—' : x.toFixed(d == null ? 1 : d) + '%');

  function build() {
    const last = window._qspLast;
    if (!last || !last.count) return null;
    const items = [];          // {lv:'bad'|'warn'|'info'|'ok', t:html}
    const mk = last.mk;

    // ① 粗利率の水準
    if (last.bill > 0) {
      if (mk < 0) items.push({ lv: 'bad', t: `<b>赤字です</b>（粗利率 ${pct(mk)}）。売単価・為替・載せ幅をご確認ください。` });
      else if (mk < TH.low) items.push({ lv: 'warn', t: `粗利率 <b>${pct(mk)}</b> は低めです（目安 ${TH.low}% 未満）。トラブル・追加費用が出ると赤字になりやすい水準です。` });
      else if (mk >= TH.high) items.push({ lv: 'info', t: `粗利率 <b>${pct(mk)}</b> は高めです（目安 ${TH.high}% 以上）。競合が入る案件では価格で負けやすい水準です。` });
      else if (mk >= TH.stdLo && mk <= TH.stdHi) items.push({ lv: 'ok', t: `粗利率 <b>${pct(mk)}</b> は標準的な水準です（目安 ${TH.stdLo}〜${TH.stdHi}%）。` });
      else items.push({ lv: 'info', t: `粗利率 <b>${pct(mk)}</b>（目安：標準 ${TH.stdLo}〜${TH.stdHi}%）。` });
    } else {
      items.push({ lv: 'warn', t: '売単価がまだ入っていません。粗利率は売単価を入れると診断できます。' });
    }

    // ② 行ごとの確認
    const rows = scanRows();
    if (rows.missing.length) items.push({ lv: 'warn', t: `仕入はあるのに売単価が 0 の行が <b>${rows.missing.length} 件</b>：${names(rows.missing, 3)}（入れ忘れでなければ「あえて¥0」の設定を）` });
    if (rows.loss.length) items.push({ lv: 'warn', t: `行単位で赤字（売値が仕入を下回る）の行が <b>${rows.loss.length} 件</b>：${names(rows.loss, 3)}` });

    // ③ 当て馬の疑い（引き合いの経路）
    const kind = val('qf-inq-kind'), channel = val('qf-inq-channel'), spec = val('qf-inq-spec');
    const sig = [];
    if (spec.indexOf('金額のみ') >= 0) sig.push('金額のみの問い合わせ');
    if (channel.indexOf('一括') >= 0) sig.push('メールでの一括打診');
    if (kind.indexOf('新規') >= 0) sig.push('新規のお客様');
    if (sig.length >= 2) items.push({ lv: 'warn', t: `<b>当て馬（相見積もりの踏み台）の可能性</b>：${sig.join('・')}。手間をかけすぎず、競合の価格に引きずられないよう注意を。` });
    else if (sig.length === 1) items.push({ lv: 'info', t: `当て馬の兆候が 1 つあります（${sig[0]}）。条件の具体性（スケジュール・フリータイム等の指定）を確認すると見極めやすくなります。` });
    else if (!kind && !channel && !spec) items.push({ lv: 'hint', t: '「その他」の「引き合いの経路」を入れると、当て馬の目安も出せます。' });

    // ④ 過去の実績
    if (typeof window.statsDiagHistory === 'function') {
      let h = null;
      try {
        const dirV = val('cond-direction');
        h = window.statsDiagHistory({ customer: val('qf-customer'), mode: val('cond-mode'), dir: (dirV === 'export' || dirV === 'import') ? dirV : '', margin: last.bill > 0 ? mk : null });
      } catch (e) { h = null; }
      if (h) {
        const rate = window.statsDiagHistory ? (w, n) => (n ? Math.round(w / n * 100) : null) : null;
        const overall = rate(h.total.won, h.total.n);
        if (h.customer && h.customer.n >= MIN_N_CUST) {
          const r = rate(h.customer.won, h.customer.n);
          let t = `このお客様の過去の受注率は <b>${r}%</b>（提示後 ${h.customer.n} 件中 ${h.customer.won} 件受注）。`;
          let lv = 'info';
          if (h.customer.n >= WARN_N_CUST && overall != null && r < overall / 2) { lv = 'warn'; t += ` 全体（${overall}%）の半分未満で、歩留まりが低めです。`; }
          if (h.customer.avgWon != null) t += ` 受注した案件の粗利率は平均 ${pct(h.customer.avgWon)}。`;
          items.push({ lv, t });
        }
        if (h.band && h.band.n >= MIN_N_BAND) {
          const r = rate(h.band.won, h.band.n);
          items.push({ lv: 'info', t: `同じ粗利率帯（${esc(h.band.label)}）の過去の受注率は <b>${r}%</b>（${h.band.n} 件中 ${h.band.won} 件）${overall != null ? `。全体は ${overall}%` : ''}。` });
        }
      }
    }

    // ⑤ 外貨
    if (last.hasFx) items.push({ lv: 'hint', t: '外貨の行は参照レートでの換算（概算）です。為替が動くと粗利率も変わります。' });
    return items;
  }

  const DOT = { bad: '🔴', warn: '🟠', info: '🔵', ok: '🟢', hint: '⚪' };

  window.qdgRender = function () {
    const el = $('qspDiag'); if (!el) return;
    let items = null;
    try { items = build(); } catch (e) { items = null; console.warn('qdg', e); }
    if (!items) { el.innerHTML = ''; el.hidden = true; window._qdgCount = 0; return; }
    const attention = items.filter(i => i.lv === 'bad' || i.lv === 'warn').length;
    window._qdgCount = attention;
    el.hidden = false;
    el.innerHTML =
      `<div class="qdg-head"><span class="qdg-title">🩺 見積の診断（目安）</span>` +
      (attention ? `<span class="qdg-badge">要確認 ${attention}</span>` : '<span class="qdg-badge qdg-badge-ok">気になる点なし</span>') + '</div>' +
      '<ul class="qdg-list">' + items.map(i => `<li class="qdg-item qdg-${i.lv}"><span class="qdg-dot" aria-hidden="true">${DOT[i.lv]}</span><span class="qdg-text">${i.t}</span></li>`).join('') + '</ul>' +
      '<p class="qdg-note">固定のルール（粗利率 5%／8〜12%／15% など）と、この端末にある過去の案件から出した目安です。AI の判断ではなく、外部へは送信されません。</p>';
    if (typeof window.updateQspTabBadges === 'function') window.updateQspTabBadges();
  };
})();

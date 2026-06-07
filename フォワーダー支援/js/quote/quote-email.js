// ================================================================
//  見積をメール本文で返す（プレーン / リッチHTML）
//  ・サマリー（区間別小計＋小計/課税/消費税＋御見積額＋有効期限）
//  ・プレーン：項目名と金額を半角スペースで桁揃え
//  ・リッチ：メール向けに軽量化したシンプル罫線の表（クリップボードへ text/html）
//  依存（window 経由）：collectAllRows, getQuoteHeader, getConditions,
//                       getEffectiveTaxRate, toJPY, quoteShowToast
// ================================================================
(function () {
  'use strict';

  const ISSUER_KEY = 'quoteIssuer_v1';
  const ISSUER_DEFAULT = {
    company: 'JCT株式会社',
    address1: '東京都港区芝浦2-11-5',
    address2: '五十嵐ビルディング 3階',
    tel: '03-5765-7668',
    fax: '03-5765-7667',
    greeting: '毎度格別のお引き立てを賜り、厚く御礼申し上げます。\n下記の通り、御見積り申し上げます。\n何卒ご用命の程、宜しくお願い申し上げます。',
  };
  function loadIssuer() {
    try { return Object.assign({}, ISSUER_DEFAULT, JSON.parse(localStorage.getItem(ISSUER_KEY) || '{}')); }
    catch (e) { return Object.assign({}, ISSUER_DEFAULT); }
  }

  const yen   = n => '¥' + Math.round(n).toLocaleString('ja-JP');
  const toJPYx = (a, c) => (typeof toJPY === 'function' ? toJPY(a, c || 'JPY') : a);
  const escH  = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // 金額（通貨付き）：JPY は ¥1,234、それ以外は 1,234.00 USD
  const fmtAmt = (v, ccy) => (!ccy || ccy === 'JPY')
    ? '¥' + Math.round(v).toLocaleString('ja-JP')
    : Number(v).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' ' + ccy;
  // 数量（最大4桁小数・カンマ区切り）
  const fmtQty = v => Number(v || 0).toLocaleString('ja-JP', { maximumFractionDigits: 4 });

  // 表示幅（全角=2, 半角=1）。半角スペース桁揃え用。
  function dw(str) {
    let w = 0;
    for (const ch of String(str)) {
      const c = ch.codePointAt(0);
      // ASCII・半角記号・¥（\xA5）等は 1、それ以外（CJK/全角記号/全角数字）は 2
      w += (c <= 0xFF || (c >= 0xFF61 && c <= 0xFF9F)) ? 1 : 2;
    }
    return w;
  }
  // 敬称付与（簡易）
  function honorific(customer, person) {
    const c = (customer || '').trim();
    const p = (person || '').trim();
    let base = [c, p].filter(Boolean).join('　');
    if (!base) return '';
    if (/(様|さま|御中|殿|Mr\.|Ms\.|Mrs\.)\s*$/i.test(base)) return base;
    return base + ' 様';
  }

  // ====== 見積サマリの集計モデルを構築 ======
  function buildModel() {
    const rows = (typeof collectAllRows === 'function') ? collectAllRows() : [];
    const hdr  = (typeof getQuoteHeader === 'function') ? getQuoteHeader() : {};
    const cond = (typeof getConditions === 'function') ? getConditions() : {};
    const taxRate = (typeof getEffectiveTaxRate === 'function') ? getEffectiveTaxRate() : 0.10;
    const issuer = loadIssuer();

    let taxableSub = 0, exemptSub = 0, hasFx = false;
    const zones = [];
    let zoneSum = 0;
    const remarks = [];

    // 明細グループ（区間＝小計行で区切る）。小計行が無い場合は後段でカテゴリ別に再編成。
    const detailGroups = [];
    let curItems = [];
    const flushGroup = label => {
      if (curItems.length) { detailGroups.push({ label: label || '小計', items: curItems }); curItems = []; }
    };

    rows.forEach(r => {
      if (r._type === 'remark') { if (r.text && !r.internal) remarks.push(r.text); return; }
      if (r._type === 'subtotal') {
        zones.push({ label: r.label || '小計', jpy: zoneSum });
        zoneSum = 0;
        flushGroup(r.label || '小計');
        return;
      }
      if (r._type !== 'data') return;
      const qty = r.bq || 0, price = r.bp || 0;
      const sub = qty * price;
      const jpy = Math.ceil(toJPYx(sub, r.bc || 'JPY'));
      if (r.bc && r.bc !== 'JPY') hasFx = true;
      if (r.taxed) taxableSub += jpy; else exemptSub += jpy;
      zoneSum += jpy;
      // 明細行（名前か金額があるものだけ）
      if (r.name || sub) {
        curItems.push({
          name: r.name || '', qty, unit: r.un || '', ccy: r.bc || 'JPY',
          price, amount: sub, note: r.note || '', taxed: !!r.taxed, cat: r.cat || '',
        });
      }
    });
    // 末尾に小計行が無い残り（小計未設定の行群）は zone（サマリ）には含めない（全体合計に反映済み）。
    // 明細側のみ：小計グループが既にあれば「その他」、無ければカテゴリ別にグループ化（区間/カテゴリ切替）。
    if (curItems.length) {
      if (detailGroups.length) {
        detailGroups.push({ label: 'その他', items: curItems });
      } else {
        const byCat = {}, order = [];
        curItems.forEach(it => {
          const key = it.cat || '';
          if (!(key in byCat)) { byCat[key] = []; order.push(key); }
          byCat[key].push(it);
        });
        order.forEach(key => {
          const label = ((typeof getCatLabel === 'function' && getCatLabel(key)) || key || 'その他');
          detailGroups.push({ label, items: byCat[key] });
        });
      }
    }

    const tax = Math.floor(taxableSub * taxRate);
    const total = taxableSub + exemptSub + tax;

    // 注記の組み立て：先頭の「※」重複を除去。為替に言及するリマークがあれば自動FX注記は省く。
    const cleanRemarks = remarks
      .map(t => String(t || '').replace(/^[\s　]*※[\s　]*/, '').trim())
      .filter(Boolean);
    const remarkMentionsFx = cleanRemarks.some(t => /為替|外貨|USD|EUR|GBP|CNY|サーチャージ/.test(t));
    const notes = [];
    if (hasFx && !remarkMentionsFx) {
      notes.push('海上運賃・サーチャージは外貨建て仕入・JPY建て請求のため、為替レートにより請求金額が変動します。');
    }
    cleanRemarks.forEach(t => notes.push(t));

    // 件名（方向 / 輸送モード / POL→POD）
    const dirMap = { export: '輸出', import: '輸入' };
    const dir = dirMap[cond.direction] || '';
    const route = [cond.pol, cond.pod].filter(Boolean).join(' → ');
    const subjectParts = [];
    if (dir || cond.mode) subjectParts.push([dir, cond.mode].filter(Boolean).join(' '));
    if (route) subjectParts.push(route);
    const subject = subjectParts.join('　');

    return {
      to: honorific(hdr.customer, hdr.person),
      ref: hdr.ref, validUntil: hdr.validUntil,
      subject, zones, detailGroups, exemptSub, taxableSub, tax, total, taxRate, hasFx, notes, issuer,
    };
  }

  // ====== プレーンテキスト共通パーツ ======
  const PLAIN_W = 42; // 明細行の全体幅（半角換算）
  function _plainLine(label, amount) {
    const a = String(amount);
    const pad = Math.max(1, PLAIN_W - dw(label) - dw(a));
    return label + ' '.repeat(pad) + a;
  }
  function _plainHeaderLines(m) {
    const out = [];
    if (m.to) { out.push(m.to); out.push(''); }
    if (m.issuer.greeting) { out.push(m.issuer.greeting); out.push(''); }
    if (m.subject)    out.push('【件名】' + m.subject);
    if (m.ref)        out.push('【見積番号】' + m.ref);
    if (m.validUntil) out.push('【有効期限】' + m.validUntil);
    return out;
  }
  function _plainSummaryLines(m) {
    const rule = '─'.repeat(PLAIN_W / 2); // 全角罫線（dw=2）でおおよそ W 幅
    const out = [rule];
    m.zones.forEach(z => out.push(_plainLine('　' + z.label, yen(z.jpy))));
    if (m.zones.length) out.push(rule);
    out.push(_plainLine('　小計（免税分）', yen(m.exemptSub)));
    out.push(_plainLine('　課税対象小計', yen(m.taxableSub)));
    out.push(_plainLine('　消費税（' + Math.round(m.taxRate * 100) + '%）', yen(m.tax)));
    out.push(rule);
    out.push(_plainLine('　御見積額', yen(m.total)));
    out.push('═'.repeat(PLAIN_W / 2));
    return out;
  }
  function _plainFooterLines(m) {
    const out = [];
    if (m.notes.length) { out.push(''); m.notes.forEach(t => out.push('※ ' + t)); }
    out.push('');
    out.push('――――――――――');
    out.push(m.issuer.company || '');
    [m.issuer.address1, m.issuer.address2].filter(Boolean).forEach(a => out.push(a));
    const telfax = [m.issuer.tel && ('TEL: ' + m.issuer.tel), m.issuer.fax && ('FAX: ' + m.issuer.fax)].filter(Boolean).join('　/　');
    if (telfax) out.push(telfax);
    return out;
  }

  // ====== プレーンテキスト：サマリのみ ======
  function buildPlain(m) {
    return [].concat(_plainHeaderLines(m), _plainSummaryLines(m), _plainFooterLines(m)).join('\n');
  }

  // ====== プレーンテキスト：明細あり ======
  function buildPlainDetailLines(m) {
    const out = ['', '■ 明細'];
    m.detailGroups.forEach(g => {
      out.push('');
      out.push('《' + g.label + '》');
      g.items.forEach(it => {
        const taxMark  = it.taxed ? ' ［課税］' : '';
        const qtyUnit  = fmtQty(it.qty) + (it.unit ? ' ' + it.unit : '');
        out.push('  ・' + it.name + taxMark);
        out.push('      ' + qtyUnit + ' × ' + fmtAmt(it.price, it.ccy) + ' ＝ ' + fmtAmt(it.amount, it.ccy));
        if (it.note) out.push('      ※ ' + it.note);
      });
    });
    return out;
  }
  function buildPlainDetail(m) {
    return [].concat(
      _plainHeaderLines(m),
      buildPlainDetailLines(m),
      [''],
      _plainSummaryLines(m),
      _plainFooterLines(m)
    ).join('\n');
  }

  // ====== リッチ HTML 共通パーツ ======
  function _richHeaderHtml(m) {
    const meta = [];
    if (m.subject)    meta.push(`<div><b>件名：</b>${escH(m.subject)}</div>`);
    if (m.ref)        meta.push(`<div><b>見積番号：</b>${escH(m.ref)}</div>`);
    if (m.validUntil) meta.push(`<div><b>有効期限：</b>${escH(m.validUntil)}</div>`);
    return (m.to ? `<div>${escH(m.to)}</div><div style="height:8px;"></div>` : '')
      + (m.issuer.greeting ? `<div>${escH(m.issuer.greeting).replace(/\n/g, '<br>')}</div><div style="height:10px;"></div>` : '')
      + (meta.length ? `<div style="margin-bottom:8px;">${meta.join('')}</div>` : '');
  }
  function _richSummaryTableHtml(m) {
    const cell = 'padding:4px 10px;font-size:14px;';
    const lbl  = 'text-align:left;color:#333;';
    const amt  = 'text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;';
    const bb   = 'border-bottom:1px solid #d9d2c4;';
    const rowsHtml = [];
    m.zones.forEach(z => {
      rowsHtml.push(`<tr><td style="${cell}${lbl}${bb}">${escH(z.label)}</td><td style="${cell}${amt}${bb}">${yen(z.jpy)}</td></tr>`);
    });
    rowsHtml.push(`<tr><td style="${cell}${lbl}">小計（免税分）</td><td style="${cell}${amt}">${yen(m.exemptSub)}</td></tr>`);
    rowsHtml.push(`<tr><td style="${cell}${lbl}">課税対象小計</td><td style="${cell}${amt}">${yen(m.taxableSub)}</td></tr>`);
    rowsHtml.push(`<tr><td style="${cell}${lbl}${bb}">消費税（${Math.round(m.taxRate * 100)}%）</td><td style="${cell}${amt}${bb}">${yen(m.tax)}</td></tr>`);
    rowsHtml.push(`<tr><td style="${cell}${lbl}font-weight:700;border-top:2px solid #5a4a35;">御見積額</td><td style="${cell}${amt}font-weight:700;font-size:15px;border-top:2px solid #5a4a35;">${yen(m.total)}</td></tr>`);
    return `<table style="border-collapse:collapse;min-width:320px;margin:4px 0 10px;">${rowsHtml.join('')}</table>`;
  }
  function _richFooterHtml(m) {
    const notes = m.notes.map(t => '※ ' + t);
    const sig = [];
    if (m.issuer.company) sig.push(`<div style="font-weight:700;">${escH(m.issuer.company)}</div>`);
    [m.issuer.address1, m.issuer.address2].filter(Boolean).forEach(a => sig.push(`<div>${escH(a)}</div>`));
    const telfax = [m.issuer.tel && ('TEL: ' + m.issuer.tel), m.issuer.fax && ('FAX: ' + m.issuer.fax)].filter(Boolean).join('　/　');
    if (telfax) sig.push(`<div>${escH(telfax)}</div>`);
    return (notes.length ? `<div style="font-size:12px;color:#666;margin-bottom:10px;">${notes.map(escH).join('<br>')}</div>` : '')
      + `<div style="border-top:1px dashed #c9bfa8;padding-top:8px;font-size:13px;color:#444;">${sig.join('')}</div>`;
  }
  function _richWrap(inner) {
    return `<div style="font-family:'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif;font-size:14px;color:#222;line-height:1.7;">
${inner}
</div>`;
  }

  // ====== リッチ HTML：サマリのみ ======
  function buildRich(m) {
    return _richWrap(_richHeaderHtml(m) + '\n' + _richSummaryTableHtml(m) + '\n' + _richFooterHtml(m));
  }

  // ====== リッチ HTML：明細あり ======
  function _richDetailTableHtml(m) {
    const th   = 'padding:5px 8px;font-size:12px;background:#f2eee3;color:#5a4a35;border-bottom:2px solid #c9bfa8;';
    const cell = 'padding:4px 8px;font-size:13px;border-bottom:1px solid #ece7da;';
    const lblC = 'text-align:left;';
    const numC = 'text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;';
    const ctrC = 'text-align:center;';
    const hasNote = m.detailGroups.some(g => g.items.some(it => it.note));
    const cols = hasNote ? 6 : 5;

    const head = `<tr>`
      + `<th style="${th}${lblC}">項目名</th>`
      + `<th style="${th}${numC}">数量</th>`
      + `<th style="${th}${ctrC}">単位</th>`
      + `<th style="${th}${numC}">単価</th>`
      + `<th style="${th}${numC}">金額</th>`
      + (hasNote ? `<th style="${th}${lblC}">備考</th>` : '')
      + `</tr>`;

    const body = [];
    m.detailGroups.forEach(g => {
      body.push(`<tr><td colspan="${cols}" style="padding:6px 8px;font-size:12px;font-weight:700;background:#faf7ef;color:#5a4a35;border-bottom:1px solid #d9d2c4;">《${escH(g.label)}》</td></tr>`);
      g.items.forEach(it => {
        body.push(`<tr>`
          + `<td style="${cell}${lblC}">${it.taxed ? '<span style="color:#b03030;">*</span> ' : ''}${escH(it.name)}</td>`
          + `<td style="${cell}${numC}">${fmtQty(it.qty)}</td>`
          + `<td style="${cell}${ctrC}">${escH(it.unit)}</td>`
          + `<td style="${cell}${numC}">${fmtAmt(it.price, it.ccy)}</td>`
          + `<td style="${cell}${numC}">${fmtAmt(it.amount, it.ccy)}</td>`
          + (hasNote ? `<td style="${cell}${lblC}font-size:12px;color:#666;">${escH(it.note)}</td>` : '')
          + `</tr>`);
      });
    });
    const taxNote = m.detailGroups.some(g => g.items.some(it => it.taxed))
      ? `<div style="font-size:11px;color:#999;margin:2px 0 10px;">* は課税対象項目</div>` : '';
    return `<table style="border-collapse:collapse;width:100%;margin:4px 0 4px;">`
      + `<thead>${head}</thead><tbody>${body.join('')}</tbody></table>${taxNote}`;
  }
  function buildRichDetail(m) {
    return _richWrap(
      _richHeaderHtml(m) + '\n'
      + _richDetailTableHtml(m) + '\n'
      + _richSummaryTableHtml(m) + '\n'
      + _richFooterHtml(m)
    );
  }

  // ====== クリップボード ======
  function toast(msg, type) { if (window.quoteShowToast) quoteShowToast(msg, type || 'success'); }

  function copyPlainText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // フォールバック
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    return Promise.resolve();
  }

  async function copyRich(html, plain) {
    // 1) ClipboardItem（text/html + text/plain）
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        });
        await navigator.clipboard.write([item]);
        return true;
      } catch (e) { /* フォールバックへ */ }
    }
    // 2) contenteditable + execCommand('copy')
    const div = document.createElement('div');
    div.contentEditable = 'true';
    div.style.position = 'fixed'; div.style.left = '-9999px'; div.style.top = '0';
    div.innerHTML = html;
    document.body.appendChild(div);
    const range = document.createRange(); range.selectNodeContents(div);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    sel.removeAllRanges(); document.body.removeChild(div);
    return ok;
  }

  // ====== 公開 API（プレビューのボタンから呼ぶ） ======
  function copyQuoteEmailPlain() {
    const m = buildModel();
    if (!m.total && !m.zones.length) { toast('費用項目がありません。', 'warn'); return; }
    copyPlainText(buildPlain(m))
      .then(() => toast('メール本文（プレーン）をコピーしました'))
      .catch(() => toast('コピーに失敗しました。手動で選択してください。', 'error'));
  }
  async function copyQuoteEmailRich() {
    const m = buildModel();
    if (!m.total && !m.zones.length) { toast('費用項目がありません。', 'warn'); return; }
    const ok = await copyRich(buildRich(m), buildPlain(m));
    toast(ok ? 'メール本文（リッチテキスト）をコピーしました' : 'コピーに失敗しました。手動で選択してください。', ok ? 'success' : 'error');
  }
  // 明細あり版
  function copyQuoteEmailPlainDetail() {
    const m = buildModel();
    if (!m.total && !m.detailGroups.length) { toast('費用項目がありません。', 'warn'); return; }
    copyPlainText(buildPlainDetail(m))
      .then(() => toast('メール本文（明細・プレーン）をコピーしました'))
      .catch(() => toast('コピーに失敗しました。手動で選択してください。', 'error'));
  }
  async function copyQuoteEmailRichDetail() {
    const m = buildModel();
    if (!m.total && !m.detailGroups.length) { toast('費用項目がありません。', 'warn'); return; }
    const ok = await copyRich(buildRichDetail(m), buildPlainDetail(m));
    toast(ok ? 'メール本文（明細・リッチテキスト）をコピーしました' : 'コピーに失敗しました。手動で選択してください。', ok ? 'success' : 'error');
  }

  window.copyQuoteEmailPlain       = copyQuoteEmailPlain;
  window.copyQuoteEmailRich        = copyQuoteEmailRich;
  window.copyQuoteEmailPlainDetail = copyQuoteEmailPlainDetail;
  window.copyQuoteEmailRichDetail  = copyQuoteEmailRichDetail;
})();

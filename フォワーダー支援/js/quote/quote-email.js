// ================================================================
//  見積をメール本文（プレーンテキスト・明細付き）で返す
//  ・明細：カテゴリ／小計区間ごと、パターン別の小見出し付き
//         「項目名 | 通貨 | 単価 | 単位」のパイプ区切り
//  ・サマリー：区間別小計＋小計/課税/消費税＋御見積額＋有効期限
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
  // 金額の数値部分のみ（通貨は別列に出すため付けない）。JPY は整数、外貨は小数2桁
  const fmtNum = (v, ccy) => (!ccy || ccy === 'JPY')
    ? Math.round(v).toLocaleString('ja-JP')
    : Number(v).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    // 見積書非表示・適用期間外（いずれも _hideQuote）の明細は客先向けメール本文・合計から除外
    const rows = ((typeof collectAllRows === 'function') ? collectAllRows() : [])
      .filter(r => r._type !== 'data' || !r._hideQuote);
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
      const isActual = r._actual;   // 実費（金額未確定・合計除外・「実費」表示）
      const isCond   = r._cond;     // 都度請求（発生時のみ・金額は表示・合計に加算しない）
      const isRef    = r._ref;      // 参考情報（金額は表示・合計に加算しない）
      const qty = r.bq || 0, price = r.bp || 0;
      const sub = qty * price;
      const jpy = isActual ? 0 : Math.ceil(toJPYx(sub, r.bc || 'JPY'));
      if (!isActual && !isCond && !isRef) {
        if (r.bc && r.bc !== 'JPY') hasFx = true;
        if (r.taxed) taxableSub += jpy; else exemptSub += jpy;
        zoneSum += jpy;
      }
      // 明細行（名前か金額があるもの、または実費・都度・参考行）
      if (r.name || sub || isActual || isCond || isRef) {
        curItems.push({
          name: r.name || '', qty, unit: r.un || '', ccy: r.bc || 'JPY',
          price, amount: sub, note: r.note || '', taxed: !!r.taxed, cat: r.cat || '',
          pt: (r.pt || '').trim(),   // パターン（スポット/年間契約 等）。小見出しに使う
          actual: isActual, cond: isCond, ref: isRef, estimate: !!r._estimate,
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

    // 条件・リマーク欄（下部テキストエリア）を行単位で追加
    const globalRemarkRaw = (typeof getRemarkText === 'function') ? getRemarkText()
      : (document.getElementById('remarkTextarea')?.value || '');
    const globalRemarkLines = globalRemarkRaw
      .split('\n')
      .map(t => String(t).replace(/^[\s　]*※[\s　]*/, '').trim())
      .filter(Boolean);

    const remarkMentionsFx = [...cleanRemarks, ...globalRemarkLines]
      .some(t => /為替|外貨|USD|EUR|GBP|CNY|サーチャージ/.test(t));
    const notes = [];
    if (hasFx && !remarkMentionsFx) {
      notes.push('海上運賃・サーチャージは外貨建て仕入・JPY建て請求のため、為替レートにより請求金額が変動します。');
    }
    cleanRemarks.forEach(t => notes.push(t));
    globalRemarkLines.forEach(t => notes.push(t));

    // 件名（方向 / 輸送モード / POL→POD）
    const dirMap = { export: '輸出', import: '輸入' };
    const dir = dirMap[cond.direction] || '';
    const route = (cond.routes && cond.routes.length > 1)
      ? [cond.pol, cond.pod].filter(Boolean).join(' → ') + ` 他${cond.routes.length - 1}航路`
      : [cond.pol, cond.pod].filter(Boolean).join(' → ');
    const subjectParts = [];
    if (dir || cond.mode) subjectParts.push([dir, cond.mode].filter(Boolean).join(' '));
    if (route) subjectParts.push(route);
    const subject = subjectParts.join('　');

    // 物量情報（荷姿明細＋課金重量の目安）。未入力なら両方とも空・null のまま。
    const packing = (typeof window.getPackingDetailText === 'function') ? window.getPackingDetailText() : '';
    const billing = (typeof window.getCargoBillingLine === 'function') ? window.getCargoBillingLine(cond.mode) : null;
    // 前回提示分からの変更点（🔄 更新でスナップショットが取られている場合のみ）
    const revision = (typeof window.computeRevisionDiff === 'function') ? window.computeRevisionDiff() : null;

    return {
      to: honorific(hdr.customer, hdr.person),
      ref: hdr.ref, validUntil: hdr.validUntil,
      subject, zones, detailGroups, exemptSub, taxableSub, tax, total, taxRate, hasFx, notes, issuer,
      scope: (document.getElementById('qf-scope')?.value || '').trim(),
      packing, billing, revision,
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
    if (m.packing || m.billing) {
      out.push('【物量情報】' + [m.packing, m.billing && (m.billing.label + ' ' + m.billing.value)].filter(Boolean).join('　'));
    }
    return out;
  }
  // 前回提示分からの変更点（追加・削除・変更）。revision が無ければ空配列。
  function _plainRevisionLines(m) {
    const d = m.revision;
    if (!d) return [];
    const out = ['', '【前回提示分からの変更点】'];
    d.added.forEach(r => out.push('　＋ 追加：' + (r.nm || '（品名未設定）')));
    d.removed.forEach(r => out.push('　－ 削除：' + (r.nm || '（品名未設定）')));
    d.changed.forEach(c => {
      const parts = c.fields.map(f => f.label + '：' + (f.from || '—') + ' → ' + (f.to || '—')).join('／');
      out.push('　✎ 変更：' + (c.name || '（品名未設定）') + '（' + parts + '）');
    });
    if (d.totalFrom !== d.totalTo) out.push('　合計金額：¥' + d.totalFrom + ' → ¥' + d.totalTo);
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
    if (m.scope) { out.push(''); out.push('【作業範囲】'); m.scope.split('\n').forEach(t => out.push('　' + t)); }
    if (m.notes.length) { out.push(''); m.notes.forEach(t => out.push('※ ' + t)); }
    out.push('');
    out.push('――――――――――');
    out.push(m.issuer.company || '');
    [m.issuer.address1, m.issuer.address2].filter(Boolean).forEach(a => out.push(a));
    const telfax = [m.issuer.tel && ('TEL: ' + m.issuer.tel), m.issuer.fax && ('FAX: ' + m.issuer.fax)].filter(Boolean).join('　/　');
    if (telfax) out.push(telfax);
    return out;
  }

  // ====== プレーンテキスト：明細あり ======
  // グループ内の明細を「パターン」で区切って返す。
  // 見積テーブルと同じ並び（DOM 順）を保つため、連続する同一パターンをひと塊にする。
  // パターン未設定の行だけなら区切らない（従来どおり 1 塊）。
  function _splitByPattern(items) {
    const runs = [];
    items.forEach(it => {
      const pt = it.pt || '';
      const last = runs[runs.length - 1];
      if (last && last.pt === pt) last.items.push(it);
      else runs.push({ pt, items: [it] });
    });
    return runs;
  }

  // 明細行の表示名（課税マーク・発生時/参考の注記を付ける）
  function _itemLabel(it) {
    return (it.taxed ? '*' : '') + it.name
      + (it.cond ? '（発生時のみ）' : '')
      + (it.ref  ? '（参考）' : '');
  }

  // 明細行は「項目名 | 通貨 | 単価 | 単位」をパイプで区切って並べる。
  // 桁揃えにするとメールソフトがプロポーショナルフォントのとき崩れるため、
  // フォントに依存しない区切り文字を使う。数量・金額は出さず単価表として読ませる。
  function buildPlainDetailLines(m) {
    const out = ['', '■ 明細'];
    m.detailGroups.forEach(g => {
      out.push('');
      out.push('《' + g.label + '》');
      _splitByPattern(g.items).forEach(run => {
        if (run.pt) out.push(' 〔' + run.pt + '〕');
        run.items.forEach(it => {
          const ccy   = it.actual ? '' : (it.ccy || 'JPY');
          const price = it.actual ? '実費' : (it.estimate ? '約' : '') + fmtNum(it.price, it.ccy);
          out.push('  ' + [_itemLabel(it), ccy, price, it.unit].filter(Boolean).join(' | '));
          if (it.note) out.push('    ※' + it.note);
        });
      });
    });
    if (m.detailGroups.some(g => g.items.some(it => it.taxed))) {
      out.push('');
      out.push('  * は課税対象項目');
    }
    return out;
  }
  function buildPlainDetail(m) {
    return [].concat(
      _plainHeaderLines(m),
      _plainRevisionLines(m),
      buildPlainDetailLines(m),
      [''],
      _plainSummaryLines(m),
      _plainFooterLines(m)
    ).join('\n');
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

  // ====== 公開 API（プレビューのボタンから呼ぶ） ======
  function copyQuoteEmail() {
    const m = buildModel();
    if (!m.total && !m.detailGroups.length) { toast('費用項目がありません。', 'warn'); return; }
    copyPlainText(buildPlainDetail(m))
      .then(() => toast('メール本文をコピーしました'))
      .catch(() => toast('コピーに失敗しました。手動で選択してください。', 'error'));
  }

  window.copyQuoteEmail = copyQuoteEmail;
})();

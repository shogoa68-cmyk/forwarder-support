// ================================================================
//  ✉️ サブコン依頼メール作成
//  見積タブに入力済みの案件情報（getConditions）と、テーブル上で選んだサブコン
//  （sv）宛ての明細行から、定型の「見積・作業依頼メール」本文を組み立てる。
//  ・仕入単価・売単価・金額・社内メモ（備考）は一切載せない（先方へ出さない情報）
//  ・宛先メールは bmGetContact（キャリア/サブコン連絡先）に登録があれば自動入力
//  依存（window 経由）：collectAllRows, getConditions, getQuoteHeader,
//                       getPackingDetailText, subconNormKey, bmGetContact, quoteShowToast
// ================================================================
(function () {
  'use strict';

  const ISSUER_KEY = 'quoteIssuer_v1';
  const ISSUER_DEFAULT = { company: 'JCT株式会社', tel: '03-5765-7668', fax: '03-5765-7667' };
  function loadIssuer() {
    try { return Object.assign({}, ISSUER_DEFAULT, JSON.parse(localStorage.getItem(ISSUER_KEY) || '{}')); }
    catch (e) { return Object.assign({}, ISSUER_DEFAULT); }
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const toast = (m, t) => { if (window.quoteShowToast) window.quoteShowToast(m, t || 'success'); };
  const normKey = s => (typeof window.subconNormKey === 'function') ? window.subconNormKey(s) : String(s || '').trim().toLowerCase();

  // 現在の見積で使われているサブコン一覧（正規化キーで重複排除・表示は最初の綴り）
  function listSubcons() {
    const rows = (typeof collectAllRows === 'function') ? collectAllRows() : [];
    const seen = new Map();
    rows.forEach(r => {
      if (r._type !== 'data' || r._ps) return;
      const name = (r.sv || '').trim();
      if (!name) return;
      const k = normKey(name);
      if (!seen.has(k)) seen.set(k, { key: k, name, count: 0 });
      seen.get(k).count++;
    });
    return Array.from(seen.values());
  }

  // 指定サブコン宛ての依頼明細（品名・数量・単位のみ。価格・備考は含めない）
  function itemsFor(subconKey) {
    const rows = (typeof collectAllRows === 'function') ? collectAllRows() : [];
    return rows
      .filter(r => r._type === 'data' && !r._ps && normKey(r.sv) === subconKey && (r.name || '').trim())
      .map(r => {
        const qty = r.pq > 0 ? r.pq : (r.bq > 0 ? r.bq : 0);
        return {
          name: r.name.replace(/^\*\s?/, '').trim(),
          qty, unit: (r.un || '').trim(),
          cond: !!r._cond, pt: (r.pt || '').trim(),
        };
      });
  }

  const fmtQty = n => Number(n).toLocaleString('ja-JP', { maximumFractionDigits: 4 });

  // ====== 本文生成 ======
  // opts: { subcon, to(宛先表記), deadline, extra }
  function buildRequestMail(opts) {
    const cond = (typeof getConditions === 'function') ? getConditions() : {};
    const hdr  = (typeof getQuoteHeader === 'function') ? getQuoteHeader() : {};
    const issuer = loadIssuer();
    const items = itemsFor(normKey(opts.subcon));

    const dir = dirLabel(cond.direction);
    const routes = cond.routes || [];
    const legOf = r => [r.pol, r.via, r.pod].filter(Boolean).join(' → ');
    const route = routes.length ? legOf(routes[0]) + (routes.length > 1 ? ` 他${routes.length - 1}航路` : '')
                                : [cond.pol, cond.pod].filter(Boolean).join(' → ');
    const subject = '【' + ([dir, cond.mode].filter(Boolean).join(' ') || '案件') + '】'
      + (route ? route + '　' : '') + 'お見積り・作業のご依頼'
      + (hdr.ref ? `（${hdr.ref}）` : '');

    const L = [];
    L.push((opts.to || opts.subcon || '') + ' 御中');
    L.push('');
    L.push('いつもお世話になっております。' + (issuer.company || '') + 'です。');
    L.push('下記案件につきまして、お見積り（ご手配）をお願いできますでしょうか。');
    L.push('');
    if (hdr.ref)       L.push('【案件番号】' + hdr.ref);
    if (opts.deadline) L.push('【ご回答期限】' + opts.deadline);

    // ■ 案件概要
    const ov = [];
    const add = (arr, k, v) => { if (v) arr.push('　' + k + '：' + v); };
    add(ov, '輸送区分', [dir, cond.mode].filter(Boolean).join(' '));
    add(ov, '建値', cond.incoterms);
    if (routes.length) {
      (routeLegItems(cond.direction, routes, false) || routes.map((r, i) => ({ r, label: routes.length === 1 ? '航路' : `航路${i + 1}` }))).forEach(({ r, label }) => {
        const carrier = [r.carrier, r.service ? `(${r.service})` : ''].filter(Boolean).join(' ');
        const tt = r.tt ? `T/T: ${r.tt}` : '';
        add(ov, label, [carrier, legOf(r), tt].filter(Boolean).join('　'));
      });
    } else {
      add(ov, '積み地（POL）', cond.pol);
      add(ov, '揚げ地（POD）', cond.pod);
    }
    add(ov, dirFirstLeg(cond.direction) === 'export' ? '集荷地' : '発地', cond.origin);
    add(ov, '仕向地', cond.dest);
    add(ov, 'コンテナ', cond.container);
    if (ov.length) { L.push(''); L.push('■ 案件概要'); ov.forEach(x => L.push(x)); }

    // ■ 貨物情報
    const cg = [];
    add(cg, '貨物名', cond.cargo);
    add(cg, 'HSコード', cond.hsCode);
    const packing = (typeof window.getPackingDetailText === 'function') ? window.getPackingDetailText() : (cond.packing || '');
    if (packing) {
      const lines = String(packing).split('\n').filter(Boolean);
      cg.push('　荷姿：' + lines[0]);
      lines.slice(1).forEach(x => cg.push('　　　　' + x));
    }
    add(cg, '総重量', cond.weight);
    add(cg, '総容積', cond.volume);
    if (cond.hazmat && cond.hazmat !== 'なし（一般貨物）') add(cg, '特殊貨物区分', cond.hazmat);
    if (cg.length) { L.push(''); L.push('■ 貨物情報'); cg.forEach(x => L.push(x)); }

    // ■ ご依頼内容（価格は載せない）
    L.push('');
    L.push('■ ご依頼内容');
    if (items.length) {
      let lastPt = null;
      items.forEach(it => {
        if (it.pt && it.pt !== lastPt) { L.push(' 〔' + it.pt + '〕'); }
        lastPt = it.pt;
        const q = it.qty ? '　' + fmtQty(it.qty) + (it.unit ? ' ' + it.unit : '') : (it.unit ? '　' + it.unit : '');
        L.push('　・' + it.name + q + (it.cond ? '（発生時のみ）' : ''));
      });
    } else {
      L.push('　（この見積に、このサブコン宛ての明細行がありません）');
    }
    if (opts.extra && opts.extra.trim()) {
      L.push('');
      L.push('■ 補足・ご連絡事項');
      opts.extra.trim().split('\n').forEach(x => L.push('　' + x));
    }
    L.push('');
    L.push('お手数ですが、上記条件でのお見積り（レート・日程・条件等）をご回答いただけますと幸いです。');
    L.push('ご不明な点がございましたら、お気軽にご連絡ください。');
    L.push('何卒よろしくお願い申し上げます。');
    L.push('');
    L.push('――――――――――');
    L.push(issuer.company || '');
    const telfax = [issuer.tel && ('TEL: ' + issuer.tel), issuer.fax && ('FAX: ' + issuer.fax)].filter(Boolean).join('　/　');
    if (telfax) L.push(telfax);
    return { subject, body: L.join('\n') };
  }

  // ====== モーダル UI ======
  function ensureModal() {
    let m = document.getElementById('subconReqModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'subconReqModal';
    m.addEventListener('click', e => { if (e.target === m) closeSubconRequestMail(); });
    m.innerHTML = `
      <div id="subconReqBox">
        <div class="sr-head">
          <h3>✉️ サブコン依頼メール作成</h3>
          <button type="button" class="sr-close" id="srClose" title="閉じる">✕</button>
        </div>
        <p class="sr-desc">見積タブの案件情報と、選んだサブコン宛ての明細行から依頼文を作ります。<b>仕入単価・売単価・備考は載せません。</b>本文は下の欄で直接編集できます。</p>
        <div class="sr-fields">
          <label>サブコン<select id="srSubcon"></select></label>
          <label>宛先表記<input type="text" id="srTo" placeholder="例）〇〇物流株式会社 ご担当者"></label>
          <label>宛先メール<input type="text" id="srMail" placeholder="連絡先が登録済みなら自動入力"></label>
          <label>ご回答期限<input type="text" id="srDeadline" placeholder="例）10/8(水) 17:00"></label>
        </div>
        <label class="sr-extra">補足・ご連絡事項（任意）<textarea id="srExtra" rows="2" placeholder="例）ドレージ先は〇〇ターミナル／CYカットは10/15 を予定"></textarea></label>
        <div class="sr-sub-row"><span class="sr-k">件名</span><input type="text" id="srSubject"></div>
        <textarea id="srBody" rows="18"></textarea>
        <div class="sr-actions">
          <button type="button" class="sr-btn sr-btn-pri" id="srCopy">📋 件名＋本文をコピー</button>
          <button type="button" class="sr-btn" id="srMailto">✉️ メールソフトで開く</button>
          <button type="button" class="sr-btn sr-btn-ghost" id="srRegen" title="入力欄の変更を反映して本文を作り直します（本文の手編集は上書きされます）">🔄 本文を作り直す</button>
        </div>
      </div>`;
    (document.getElementById('tab-quote-make') || document.body).appendChild(m);
    m.querySelector('#srClose').addEventListener('click', closeSubconRequestMail);
    m.querySelector('#srCopy').addEventListener('click', copyMail);
    m.querySelector('#srMailto').addEventListener('click', openMailto);
    m.querySelector('#srRegen').addEventListener('click', regen);
    ['srTo', 'srDeadline', 'srExtra'].forEach(id => m.querySelector('#' + id).addEventListener('input', regen));
    m.querySelector('#srSubcon').addEventListener('change', () => { prefillContact(); regen(); });
    return m;
  }

  function v(id) { return (document.getElementById(id)?.value || '').trim(); }

  function prefillContact() {
    const name = document.getElementById('srSubcon')?.selectedOptions[0]?.dataset.name || '';
    const to = document.getElementById('srTo');
    const mail = document.getElementById('srMail');
    if (to) to.value = name;
    const c = (typeof window.bmGetContact === 'function') ? window.bmGetContact(name) : null;
    if (mail) mail.value = (c && c.email) || '';
  }

  function regen() {
    const sel = document.getElementById('srSubcon');
    const name = sel?.selectedOptions[0]?.dataset.name || '';
    const r = buildRequestMail({ subcon: name, to: v('srTo') || name, deadline: v('srDeadline'), extra: document.getElementById('srExtra')?.value || '' });
    document.getElementById('srSubject').value = r.subject;
    document.getElementById('srBody').value = r.body;
  }

  async function openSubconRequestMail() {
    const subs = listSubcons();
    if (!subs.length) { toast('見積テーブルにサブコンが設定された行がありません。先に各行の「サブコン」を入力してください。', 'warn'); return; }
    const m = ensureModal();
    const sel = m.querySelector('#srSubcon');
    const prev = sel.value;
    sel.innerHTML = subs.map(s => `<option value="${esc(s.key)}" data-name="${esc(s.name)}">${esc(s.name)}（${s.count}行）</option>`).join('');
    if (prev && subs.some(s => s.key === prev)) sel.value = prev;
    m.classList.add('open');
    if (typeof window.bmEnsureContactsLoaded === 'function') { try { await window.bmEnsureContactsLoaded(); } catch (e) {} }
    prefillContact();
    regen();
  }
  function closeSubconRequestMail() {
    document.getElementById('subconReqModal')?.classList.remove('open');
  }

  function copyMail() {
    const text = v('srSubject') + '\n\n' + (document.getElementById('srBody')?.value || '');
    const done = () => toast('依頼メール（件名＋本文）をコピーしました');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => toast('コピーに失敗しました。手動で選択してください。', 'error'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('コピーに失敗しました。', 'error'); }
      finally { document.body.removeChild(ta); }
    }
  }

  function openMailto() {
    const to = v('srMail');
    const url = 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@')
      + '?subject=' + encodeURIComponent(v('srSubject'))
      + '&body=' + encodeURIComponent(document.getElementById('srBody')?.value || '');
    if (url.length > 1900) toast('本文が長いためメールソフトで切れる場合があります。「コピー」の利用をおすすめします。', 'warn');
    window.location.href = url;
  }

  Object.assign(window, { openSubconRequestMail, closeSubconRequestMail, buildSubconRequestMail: buildRequestMail });
})();

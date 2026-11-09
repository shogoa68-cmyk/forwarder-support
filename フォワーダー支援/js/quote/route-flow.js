// 幹線輸送（Design 回答 2026-11）：POL／POD を必須にして縦の流れ（左のレールと点）で表示し、
// 経由地・キャリア・サービス名・T/T・役割・実運送人は「＋」の奥へ。入力欄・id・onclick・保存値は不変（表示だけ切替）。
// 値が入っている（読み込み・複数航路を含む）と自動で開く。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let sync = () => {}; let reset = () => {};
  function mkBtn(id, cls, text) { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = cls; b.textContent = text; b.setAttribute('aria-expanded', 'false'); return b; }
  function init() {
    const card = $('zone2Card'); if (!card || card.dataset.rfInit) return;
    const row = card.querySelector('.z2-pol-pod-row'), via = card.querySelector('.z2-via-port');
    const carrierRow = $('z2Carrier')?.closest('.z2-row'), svcRow = card.querySelector('.z2-service-row'), relay = $('z2RelayFields'), ttRow = card.querySelector('.z2-tt-row');
    if (!row || !via || !carrierRow || !svcRow || !relay || !ttRow) return;
    card.dataset.rfInit = '1';
    card.classList.add('rf-flow');
    // 経由地：「＋ 経由地」（POL と POD の間）
    const arrows = [...row.querySelectorAll(':scope > .z2-arrow')];
    const viaArrow = arrows[1] || null;   // 経由地の後ろの矢印
    // 経由地を出していないときは、POL と POD を縦のレールで直接つなぎ、その途中に小さな「＋ 経由地」を置く（POD の行の上端・レール上）
    const podPort = [...row.querySelectorAll(':scope > .z2-port')].pop();
    const viaBtn = mkBtn('z2ViaBtn', 'rf-opt rf-via-btn', '経由地を追加');
    viaBtn.title = '経由地（トランシップ港など）を追加します（任意）';
    if (podPort) podPort.insertBefore(viaBtn, podPort.firstChild); else row.insertBefore(viaBtn, via);
    // キャリア等：奥へ
    const wrap = document.createElement('div'); wrap.className = 'rf-carrier-opt'; wrap.id = 'z2CarrierOpt'; wrap.hidden = true;
    carrierRow.parentNode.insertBefore(wrap, carrierRow);
    const cBtn = mkBtn('z2CarrierOptBtn', 'rf-opt rf-carrier-btn', '＋ キャリア・サービス名・T/T（任意）');
    const cSum = document.createElement('span'); cSum.className = 'rf-chip'; cSum.hidden = true; cBtn.appendChild(cSum);
    wrap.parentNode.insertBefore(cBtn, wrap);
    // 並び：キャリア名 → （役割・実運送人＝オプション）→ サービス名と T/T を横並び → ＋ 航路
    const svcTt = document.createElement('div'); svcTt.className = 'rf-svc-tt';
    const addRow = document.createElement('div'); addRow.className = 'rf-route-add-row';
    wrap.appendChild(carrierRow); wrap.appendChild(relay); wrap.appendChild(svcTt); wrap.appendChild(addRow);
    svcTt.appendChild(svcRow); svcTt.appendChild(ttRow);
    const routeAdd = ttRow.querySelector('.z2-route-add'); if (routeAdd) addRow.appendChild(routeAdd);
    const rBtn = mkBtn('z2RelayBtn', 'rf-opt rf-relay-btn', '＋ 役割・実運送人（任意）');
    relay.parentNode.insertBefore(rBtn, relay);
    const st = { via: false, car: false, rel: false };
    const val = id => ($(id)?.value || '').trim();
    const hasRoutes = () => { try { const a = JSON.parse(val('z2-routes-data') || '[]'); return Array.isArray(a) && a.length > 0; } catch (e) { return false; } };

    sync = function () {
      const viaHas = !!(val('z2Via') || val('z2ViaCountry'));
      const relHas = !!(val('z2CarrierRole') || val('z2ActualCarrier'));
      const carHas = !!(val('z2Carrier') || val('z2Service') || val('z2Tt') || relHas) || hasRoutes();
      const viaOpen = viaHas || st.via, carOpen = carHas || st.car, relOpen = relHas || st.rel;
      via.classList.toggle('rf-hide', !viaOpen); if (viaArrow) viaArrow.classList.toggle('rf-hide', !viaOpen);
      row.classList.toggle('rf-via-off', !viaOpen);
      viaBtn.hidden = viaOpen; viaBtn.setAttribute('aria-expanded', viaOpen ? 'true' : 'false');
      wrap.hidden = !carOpen; cBtn.hidden = carOpen; cBtn.setAttribute('aria-expanded', carOpen ? 'true' : 'false');
      relay.classList.toggle('rf-hide', !relOpen); rBtn.hidden = relOpen || !carOpen;
      const parts = []; if (val('z2Carrier')) parts.push(val('z2Carrier')); if (val('z2Service')) parts.push(val('z2Service')); if (val('z2Tt')) parts.push('T/T ' + val('z2Tt'));
      cSum.hidden = !parts.length; cSum.textContent = parts.join(' / ');
    };
    reset = () => { st.via = st.car = st.rel = false; };
    viaBtn.addEventListener('click', () => { st.via = true; sync(); $('z2Via')?.focus(); });
    cBtn.addEventListener('click', () => { st.car = true; sync(); $('z2Carrier')?.focus(); });
    rBtn.addEventListener('click', () => { st.rel = true; sync(); $('z2CarrierRole')?.focus(); });
    card.addEventListener('input', () => setTimeout(sync, 0));
    card.addEventListener('change', () => setTimeout(sync, 0));
    card.addEventListener('click', () => setTimeout(sync, 0));   // 航路の追加・削除
    // 出発地側／到着地側：スイッチ化（案B）。要約チップ（場所・選んだピース）を見出しに出す
    const builder = $('zoneBuilder'); if (builder) builder.classList.add('rf-stack');
    [[1, '集荷地'], [3, '配送地']].forEach(([n, label]) => {
      const c = $('zone' + n + 'Card'), btn = $('zone' + n + 'Btn'); if (!c || !btn) return;
      btn.setAttribute('role', 'switch'); btn.setAttribute('aria-label', label + 'を使う');
      const chip = document.createElement('span'); chip.className = 'rf-end-sum'; chip.hidden = true;
      c.querySelector('.zone-card-title')?.after(chip);
      const upd = () => {
        const on = !c.classList.contains('zone-off');
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        const place = ($('z' + n + 'Place')?.value || '').trim();
        const pcs = [...c.querySelectorAll('.piece-item')].filter(l => l.querySelector('input:checked')).map(l => l.textContent.replace(/\s+/g, ' ').replace(/^[^\wぁ-んァ-ヶ一-龥]+/, '').trim());
        const t = [place, ...pcs].filter(Boolean).join('・');
        chip.hidden = !on || !t; chip.textContent = t;
      };
      new MutationObserver(upd).observe(c, { attributes: true, attributeFilter: ['class'] });
      ['input', 'change'].forEach(ev => c.addEventListener(ev, upd));
      window['rfEnd' + n] = upd; upd();
    });
    sync();
  }
  // 読み込み・新規作成のあとに呼ぶ：手で開いた状態をやめ、値のあるものだけ開く
  window.rfSync = () => { reset(); sync(); if (window.rfEnd1) window.rfEnd1(); if (window.rfEnd3) window.rfEnd3(); };
  window.rfOpenCarrier = () => { const b = $('z2CarrierOptBtn'); if (b && !b.hidden) b.click(); };
  window.rfOpenVia = () => { const b = $('z2ViaBtn'); if (b && !b.hidden) b.click(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();

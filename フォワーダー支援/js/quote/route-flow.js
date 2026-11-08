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
    const viaBtn = mkBtn('z2ViaBtn', 'rf-opt rf-via-btn', '＋ 経由地を追加（任意）');
    row.insertBefore(viaBtn, via);
    // キャリア等：奥へ
    const wrap = document.createElement('div'); wrap.className = 'rf-carrier-opt'; wrap.id = 'z2CarrierOpt'; wrap.hidden = true;
    carrierRow.parentNode.insertBefore(wrap, carrierRow);
    const cBtn = mkBtn('z2CarrierOptBtn', 'rf-opt rf-carrier-btn', '＋ キャリア・サービス名・T/T（任意）');
    const cSum = document.createElement('span'); cSum.className = 'rf-chip'; cSum.hidden = true; cBtn.appendChild(cSum);
    wrap.parentNode.insertBefore(cBtn, wrap);
    [carrierRow, svcRow, relay, ttRow].forEach(el => wrap.appendChild(el));
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
    sync();
  }
  // 読み込み・新規作成のあとに呼ぶ：手で開いた状態をやめ、値のあるものだけ開く
  window.rfSync = () => { reset(); sync(); };
  window.rfOpenCarrier = () => { const b = $('z2CarrierOptBtn'); if (b && !b.hidden) b.click(); };
  window.rfOpenVia = () => { const b = $('z2ViaBtn'); if (b && !b.hidden) b.click(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
})();

// ================================================================
//  Vanning3D：バンニング3Dビンパッキング計算 ＋ Three.js プレビュー
//  依存：Three.js（グローバル window.THREE。index.html で計算タブ用に
//        js/calculator.js より前に読み込む想定。未読み込み時は
//        mountPreview() が案内メッセージを出すだけで例外は投げない）
// ================================================================
(function () {
  'use strict';

  const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const EPS = 1e-6;
  const MAX_PIECES = 1500;       // これを超える個体数は上位（体積の大きい順）のみ実シミュレーション
  const TIME_BUDGET_MS = 3000;   // 計算に費やす実時間の上限（応答性を保証するための安全弁）
  const SUPPORT_RATIO = 0.8;     // 底面がこの割合以上支持されていれば配置可
  const PALETTE = [0x4f8ef7, 0xf76b4f, 0x4ff7a1, 0xf7d94f, 0xa14ff7, 0xf74fbe, 0x4fd0f7, 0x8cf74f];

  function colorForType(i) { return PALETTE[i % PALETTE.length]; }

  function rectOverlapArea(ax, ay, aw, ad, bx, by, bw, bd) {
    const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const oy = Math.min(ay + ad, by + bd) - Math.max(ay, by);
    return (ox > 0 && oy > 0) ? ox * oy : 0;
  }

  function boxesOverlap(x, y, z, w, d, h, b) {
    return x < b.x + b.w - EPS && x + w > b.x + EPS &&
           y < b.y + b.d - EPS && y + d > b.y + EPS &&
           z < b.z + b.h - EPS && z + h > b.z + EPS;
  }

  // ================================================================
  //  3Dビンパッキング（Extreme Point ヒューリスティック）
  //  cargoRows: [{ bl, bw, bh (cm), qty, rowNoStack }, ...]
  //  container: { l, w, h }（内寸cm）
  //  戻り値: { placed, overflowByType, uncimulatedByType,
  //            totalRequested, totalPlaced, usedVolume, containerVolume, utilization }
  // ================================================================
  function packContainer(cargoRows, container, opts) {
    opts = opts || {};
    const maxPieces = opts.maxPieces || MAX_PIECES;

    let totalRequested = 0;
    const allPieces = [];
    cargoRows.forEach((row, typeIndex) => {
      const qty = Math.max(1, parseInt(row.qty, 10) || 1);
      totalRequested += qty;
      const volume = row.bl * row.bw * row.bh;
      for (let i = 0; i < qty; i++) {
        allPieces.push({ typeIndex, l: row.bl, w: row.bw, h: row.bh, noStack: !!row.rowNoStack, volume });
      }
    });
    allPieces.sort((a, b) => b.volume - a.volume);

    const uncimulatedByType = {};
    let toSimulate = allPieces;
    if (allPieces.length > maxPieces) {
      toSimulate = allPieces.slice(0, maxPieces);
      allPieces.slice(maxPieces).forEach(p => {
        uncimulatedByType[p.typeIndex] = (uncimulatedByType[p.typeIndex] || 0) + 1;
      });
    }

    const placed = [];
    const overflowByType = {};
    const eps = [{ x: 0, y: 0, z: 0 }];
    const containerVolume = container.l * container.w * container.h;
    let usedVolume = 0;
    let budgetExhausted = false;
    const startTime = Date.now();

    function isSupported(x, y, z, w, d) {
      if (z <= EPS) return true;
      const footprint = w * d;
      let supported = 0;
      for (let i = 0; i < placed.length; i++) {
        const b = placed[i];
        if (Math.abs((b.z + b.h) - z) > EPS) continue;
        const ov = rectOverlapArea(x, y, w, d, b.x, b.y, b.w, b.d);
        if (ov > 0) {
          if (b.noStack) return false; // 段積み不可の箱の上には置けない
          supported += ov;
        }
      }
      return supported >= footprint * SUPPORT_RATIO - EPS;
    }

    for (let pi = 0; pi < toSimulate.length; pi++) {
      const piece = toSimulate[pi];
      if (budgetExhausted) {
        uncimulatedByType[piece.typeIndex] = (uncimulatedByType[piece.typeIndex] || 0) + 1;
        continue;
      }
      // 体積による事前枝刈り：残り空間より体積が大きければ探索するまでもなく積み残し確定
      if (piece.volume > containerVolume - usedVolume + EPS) {
        overflowByType[piece.typeIndex] = (overflowByType[piece.typeIndex] || 0) + 1;
        continue;
      }
      // 実行時間の安全弁（重なり判定の回数ではなく実時間で判断する。個体数が多い/
      // 配置が密集するほど1個体あたりの探索コストが増えるため、経過時間で打ち切る）
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        budgetExhausted = true;
        uncimulatedByType[piece.typeIndex] = (uncimulatedByType[piece.typeIndex] || 0) + 1;
        continue;
      }

      eps.sort((p1, p2) => (p1.z - p2.z) || (p1.y - p2.y) || (p1.x - p2.x));
      let placedBox = null;

      epLoop:
      for (let ei = 0; ei < eps.length; ei++) {
        const ep = eps[ei];
        if (piece.noStack && ep.z > EPS) continue; // 段積み不可の個体は床置きのみ
        for (let pp = 0; pp < PERMS.length; pp++) {
          const dims = [piece.l, piece.w, piece.h];
          const perm = PERMS[pp];
          const bw_ = dims[perm[0]], bd_ = dims[perm[1]], bh_ = dims[perm[2]];
          if (ep.x + bw_ > container.l + EPS) continue;
          if (ep.y + bd_ > container.w + EPS) continue;
          if (ep.z + bh_ > container.h + EPS) continue;

          let collide = false;
          for (let k = 0; k < placed.length; k++) {
            if (boxesOverlap(ep.x, ep.y, ep.z, bw_, bd_, bh_, placed[k])) { collide = true; break; }
          }
          if (collide) continue;
          if (!isSupported(ep.x, ep.y, ep.z, bw_, bd_)) continue;

          placedBox = { x: ep.x, y: ep.y, z: ep.z, w: bw_, d: bd_, h: bh_, noStack: piece.noStack, typeIndex: piece.typeIndex };
          break epLoop;
        }
      }

      if (placedBox) {
        placed.push(placedBox);
        usedVolume += placedBox.w * placedBox.d * placedBox.h;
        eps.push({ x: placedBox.x + placedBox.w, y: placedBox.y, z: placedBox.z });
        eps.push({ x: placedBox.x, y: placedBox.y + placedBox.d, z: placedBox.z });
        if (!placedBox.noStack) eps.push({ x: placedBox.x, y: placedBox.y, z: placedBox.z + placedBox.h });
      } else {
        overflowByType[piece.typeIndex] = (overflowByType[piece.typeIndex] || 0) + 1;
      }
    }

    return {
      placed, overflowByType, uncimulatedByType,
      totalRequested, totalPlaced: placed.length,
      usedVolume, containerVolume,
      utilization: containerVolume > 0 ? (usedVolume / containerVolume * 100) : 0,
    };
  }

  // ================================================================
  //  Three.js プレビュー描画
  // ================================================================
  function buildToolbarHtml(contDefs, initialKey) {
    const options = Object.keys(contDefs).map(k =>
      `<option value="${k}"${k === initialKey ? ' selected' : ''}>${contDefs[k].label}</option>`
    ).join('');
    return `<div class="van3d-toolbar">
      <label class="van3d-toolbar-label">コンテナ種別
        <select class="van3d-cont-select">${options}</select>
      </label>
      <div class="van3d-view-btns">
        <button type="button" class="van3d-view-btn" data-view="top">⬆ 上から</button>
        <button type="button" class="van3d-view-btn" data-view="front">➡ 正面から</button>
        <button type="button" class="van3d-view-btn" data-view="free">🔄 自由回転</button>
      </div>
    </div>`;
  }

  function buildLegendHtml(cargoRows) {
    return '<div class="van3d-legend">' + cargoRows.map((row, i) => {
      const dims = `${row.blInput}×${row.bwInput}×${row.bhInput}`;
      const hex = colorForType(i).toString(16).padStart(6, '0');
      return `<span class="van3d-legend-item"><span class="van3d-swatch" style="background:#${hex};"></span>品種${i + 1}（${dims}）</span>`;
    }).join('') + '</div>';
  }

  function mountPreview(hostSelector, cargoRows, contDefs, initialKey) {
    const hostEl = document.querySelector(hostSelector);
    if (!hostEl || !cargoRows.length) return;

    const hasThree = typeof window.THREE !== 'undefined';

    hostEl.innerHTML =
      buildToolbarHtml(contDefs, initialKey) +
      buildLegendHtml(cargoRows) +
      '<div class="van3d-wrap"><div class="van3d-canvas-host"></div></div>' +
      '<div class="van3d-stats"></div>';

    if (!hasThree) {
      hostEl.querySelector('.van3d-canvas-host').innerHTML =
        '<div class="van3d-offline-msg">⚠️ 3D表示ライブラリを読み込めませんでした（オフライン環境では3Dプレビューは表示できません）。上のコンテナ比較カードの数値はそのままご利用いただけます。</div>';
      return;
    }

    const canvasHost = hostEl.querySelector('.van3d-canvas-host');
    const statsEl = hostEl.querySelector('.van3d-stats');
    const selectEl = hostEl.querySelector('.van3d-cont-select');

    const state = {
      cache: {},
      scene: null, camera: null, renderer: null,
      azimuth: Math.PI * 0.25, elevation: Math.PI * 0.35, radius: 1,
      target: new THREE.Vector3(0, 0, 0),
      contKey: initialKey,
      pointers: new Map(),
      pinchStartDist: 0, pinchStartRadius: 0,
    };

    function getPackResult(key) {
      if (!state.cache[key]) state.cache[key] = packContainer(cargoRows, contDefs[key]);
      return state.cache[key];
    }

    function disposeScene() {
      if (state.renderer) {
        state.renderer.dispose();
        if (state.renderer.forceContextLoss) state.renderer.forceContextLoss();
        if (state.renderer.domElement && state.renderer.domElement.parentNode) {
          state.renderer.domElement.parentNode.removeChild(state.renderer.domElement);
        }
      }
      state.renderer = null; state.scene = null; state.camera = null;
    }

    function clampRadius(r) {
      const cont = contDefs[state.contKey];
      const maxDim = Math.max(cont.l, cont.w, cont.h);
      return Math.max(maxDim * 0.5, Math.min(maxDim * 6, r));
    }

    function updateCamera() {
      const cam = state.camera;
      if (!cam) return;
      const r = state.radius;
      const el = Math.max(0.08, Math.min(Math.PI - 0.08, state.elevation));
      const x = state.target.x + r * Math.sin(el) * Math.sin(state.azimuth);
      const y = state.target.y + r * Math.cos(el);
      const z = state.target.z + r * Math.sin(el) * Math.cos(state.azimuth);
      cam.position.set(x, y, z);
      cam.lookAt(state.target);
    }

    function render() {
      if (!state.renderer) return;
      updateCamera();
      state.renderer.render(state.scene, state.camera);
    }

    function resizeAndRender() {
      if (!state.renderer || !state.camera) return;
      const w = canvasHost.clientWidth || 300;
      const h = canvasHost.clientHeight || 300;
      state.renderer.setSize(w, h, false);
      state.camera.aspect = w / h;
      state.camera.updateProjectionMatrix();
      render();
    }

    function renderStats(packResult) {
      const overflowTotal = Object.values(packResult.overflowByType).reduce((a, b) => a + b, 0);
      const uncimulatedTotal = Object.values(packResult.uncimulatedByType).reduce((a, b) => a + b, 0);
      let html = `📦 配置 ${packResult.totalPlaced.toLocaleString()} / 全${packResult.totalRequested.toLocaleString()}個`
        + `　｜　体積利用率 ${packResult.utilization.toFixed(1)}%`;
      if (overflowTotal > 0) {
        html += `　｜　<span class="van3d-warn">⚠️ 積み残し ${overflowTotal.toLocaleString()}個（このコンテナには入りきりません）</span>`;
      }
      if (uncimulatedTotal > 0) {
        html += `　｜　<span class="van3d-note">※ 個数が多いため一部のみ3Dシミュレーション（残り${uncimulatedTotal.toLocaleString()}個は概算）</span>`;
      }
      statsEl.innerHTML = html;
    }

    function buildScene(contKey) {
      disposeScene();
      const cont = contDefs[contKey];
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf7f3ec);

      const contGeo = new THREE.BoxGeometry(cont.l, cont.h, cont.w);
      const contLines = new THREE.LineSegments(
        new THREE.EdgesGeometry(contGeo),
        new THREE.LineBasicMaterial({ color: 0x6b5a42 })
      );
      contLines.position.set(0, cont.h / 2, 0);
      scene.add(contLines);

      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(cont.l, cont.w),
        new THREE.MeshBasicMaterial({ color: 0xe8e0d4, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })
      );
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);

      const packResult = getPackResult(contKey);
      packResult.placed.forEach(b => {
        const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: colorForType(b.typeIndex), transparent: true, opacity: 0.82,
        }));
        mesh.position.set(b.x + b.w / 2 - cont.l / 2, b.z + b.h / 2, b.y + b.d / 2 - cont.w / 2);
        scene.add(mesh);
        const boxLines = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          new THREE.LineBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5 })
        );
        boxLines.position.copy(mesh.position);
        scene.add(boxLines);
      });

      const camera = new THREE.PerspectiveCamera(45, 1, 1, Math.max(cont.l, cont.w, cont.h) * 20);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      canvasHost.innerHTML = '';
      renderer.domElement.className = 'van3d-canvas';
      canvasHost.appendChild(renderer.domElement);

      state.scene = scene;
      state.camera = camera;
      state.renderer = renderer;
      state.target.set(0, cont.h / 2, 0);
      state.radius = Math.max(cont.l, cont.w, cont.h) * 1.7;

      resizeAndRender();
      renderStats(packResult);
    }

    // --- 操作：ドラッグ回転／ホイール・ピンチズーム ---
    canvasHost.addEventListener('pointerdown', e => {
      const el = state.renderer && state.renderer.domElement;
      if (!el) return;
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2) {
        const pts = Array.from(state.pointers.values());
        state.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        state.pinchStartRadius = state.radius;
      }
    });
    canvasHost.addEventListener('pointermove', e => {
      if (!state.pointers.has(e.pointerId)) return;
      const prev = state.pointers.get(e.pointerId);
      const cur = { x: e.clientX, y: e.clientY };
      if (state.pointers.size === 2) {
        state.pointers.set(e.pointerId, cur);
        const pts = Array.from(state.pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (state.pinchStartDist > 0) {
          state.radius = clampRadius(state.pinchStartRadius * (state.pinchStartDist / Math.max(dist, 1)));
          render();
        }
        return;
      }
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      state.pointers.set(e.pointerId, cur);
      state.azimuth -= dx * 0.01;
      state.elevation -= dy * 0.01;
      render();
    });
    function endPointer(e) {
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.pinchStartDist = 0;
    }
    canvasHost.addEventListener('pointerup', endPointer);
    canvasHost.addEventListener('pointercancel', endPointer);
    canvasHost.addEventListener('pointerleave', endPointer);
    canvasHost.addEventListener('wheel', e => {
      e.preventDefault();
      state.radius = clampRadius(state.radius * (1 + (e.deltaY > 0 ? 0.12 : -0.12)));
      render();
    }, { passive: false });

    hostEl.querySelectorAll('.van3d-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === 'top') { state.elevation = 0.15; }
        else if (view === 'front') { state.elevation = Math.PI / 2; state.azimuth = Math.PI / 2; }
        else { state.elevation = Math.PI * 0.35; state.azimuth = Math.PI * 0.25; }
        state.radius = clampRadius(Math.max(contDefs[state.contKey].l, contDefs[state.contKey].w, contDefs[state.contKey].h) * 1.7);
        render();
      });
    });

    selectEl.addEventListener('change', () => {
      state.contKey = selectEl.value;
      buildScene(state.contKey);
    });

    let resizeObs = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(() => resizeAndRender());
      resizeObs.observe(canvasHost);
    } else {
      window.addEventListener('resize', resizeAndRender);
    }

    // 「計算中」表示を先にペイントしてから重い処理へ
    canvasHost.innerHTML = '<div class="van3d-loading">⏳ 3D配置を計算中...</div>';
    setTimeout(() => { buildScene(state.contKey); }, 0);

    const entryEl = hostEl.closest('.calc-history-entry');
    if (entryEl) {
      entryEl._van3dCleanup = () => {
        disposeScene();
        if (resizeObs) resizeObs.disconnect();
        else window.removeEventListener('resize', resizeAndRender);
      };
    }
  }

  window.Vanning3D = { packContainer, mountPreview };
})();

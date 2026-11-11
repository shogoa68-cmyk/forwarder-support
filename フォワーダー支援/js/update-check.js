/* update-check.js — 古い版を開いたままの人に「更新してください」を自動で知らせる
 *
 *   ・仕組み：デプロイのたびに、公開 HTML が読み込む JS／CSS に版の印（?v=<コミットSHA 8 桁>）が付く
 *            （.github/workflows/deploy.yml）。この画面が読み込んだ版（js/app.js の ?v=）と、サーバーの最新の
 *            index.html の版を比べ、違えば画面上部に「新しいバージョンがあります」のバナーを出す。
 *   ・自動で再読み込みはしない（入力中の見積が消えるため）。「更新する」を押したときだけ読み直し、
 *     未保存の変更があるときは、保存／破棄／中止の確認を挟む（cloud.js の cloudConfirmLeaveUnsaved）。
 *   ・「あとで」を押すと、その版のあいだ（このタブを開いている間）は出さない。さらに新しい版が出たら、また出す。
 *   ・ローカル（python -m http.server）や file:// は版の印が無いので何もしない。
 *   ・確認の頻度：開いて 1 分後・15 分ごと（画面が見えているときだけ）・画面に戻ったとき（10 分以上あいていれば）。
 */
(function () {
  'use strict';

  const VER_RE = /js\/app\.js\?v=([0-9a-f]{6,40})/;
  const SKIP_KEY = 'updDismissed_v1';       // 「あとで」を押した版（sessionStorage）
  const FIRST_MS = 60 * 1000, EVERY_MS = 15 * 60 * 1000, FOCUS_MS = 10 * 60 * 1000;

  const cur = (function () {
    const s = document.querySelector('script[src*="js/app.js"]');
    const m = s && (s.getAttribute('src') || '').match(/[?&]v=([0-9a-f]{6,40})/);
    return m ? m[1] : null;
  })();
  if (!cur) return;                          // ローカル・未デプロイ：版が分からないので判定しない

  let _checkedAt = 0, _latest = null;

  const skipped = () => { try { return sessionStorage.getItem(SKIP_KEY); } catch (e) { return null; } };

  async function fetchLatest() {
    // 取得のたびにアドレスを変え、ブラウザ・配信側のキャッシュを避ける
    const url = new URL('index.html', document.baseURI);
    url.searchParams.set('_', String(Date.now()));
    const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return null;
    const m = (await res.text()).match(VER_RE);
    return m ? m[1] : null;
  }

  async function check() {
    _checkedAt = Date.now();
    let latest = null;
    try { latest = await fetchLatest(); } catch (e) { return; }     // オフライン等：何もしない
    if (!latest) return;
    _latest = latest;
    if (latest === cur) { hide(); return; }
    if (skipped() === latest) return;
    show(latest);
  }

  function bar() {
    let el = document.getElementById('updBar');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'updBar';
    el.className = 'upd-bar';
    el.hidden = true;
    el.setAttribute('role', 'status');
    const header = document.querySelector('.app > .header');
    if (header && header.parentNode) header.parentNode.insertBefore(el, header.nextSibling);
    else document.body.insertBefore(el, document.body.firstChild);
    el.addEventListener('click', onClick);
    return el;
  }
  function show(latest) {
    const el = bar();
    el.hidden = false;
    el.dataset.latest = latest;
    el.innerHTML =
      '<span class="upd-ic" aria-hidden="true">🔄</span>' +
      '<div class="upd-msg"><b>新しいバージョンがあります。</b>' +
        '<span>保存してから「更新する」を押してください。更新するまでは、古い画面のまま動きます。</span></div>' +
      '<div class="upd-btns">' +
        '<button type="button" class="upd-go" data-act="go">更新する</button>' +
        '<button type="button" class="upd-later" data-act="later">あとで</button>' +
      '</div>';
  }
  function hide() { const el = document.getElementById('updBar'); if (el) { el.hidden = true; el.innerHTML = ''; } }

  async function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'later') {
      try { sessionStorage.setItem(SKIP_KEY, (document.getElementById('updBar') || {}).dataset.latest || _latest || ''); } catch (err) {}
      hide();
      return;
    }
    if (b.dataset.act === 'go') {
      // 未保存の変更があるときは、保存／保存せずに進む／中止 を選んでもらう（入力中の見積を消さない）
      let ok = true;
      if (typeof window.cloudConfirmLeaveUnsaved === 'function') {
        try { ok = await window.cloudConfirmLeaveUnsaved('ページを更新する'); } catch (err) { ok = true; }
      }
      if (ok) location.reload();
    }
  }

  setTimeout(check, FIRST_MS);
  setInterval(() => { if (!document.hidden) check(); }, EVERY_MS);
  window.addEventListener('focus', () => { if (Date.now() - _checkedAt > FOCUS_MS) check(); });

  window.updCheckNow = check;                // 試験・手動確認用
  window.updCurrentVersion = () => cur;
})();

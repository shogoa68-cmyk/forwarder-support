// preview stub
function switchCategory(cat, btn){document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));if(btn)btn.classList.add('active');document.querySelectorAll('.sub-nav').forEach(s=>s.classList.remove('active'));const _sub=document.getElementById('sub-'+cat);if(_sub&&_sub.querySelector('.tab-btn'))_sub.classList.add('active');const f=document.querySelector('#sub-'+cat+' .tab-btn');if(f){f.click();}else if(cat==='quote'){switchTab('quote-make');}else if(cat==='bookmark'){switchTab('bookmark');}else if(cat==='stats'){switchTab('stats');}}
function switchTab(tabId, btn){document.querySelectorAll('.tab-content').forEach(el=>{el.classList.remove('active');el.setAttribute('aria-hidden','true');});document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));const _activeTab=document.getElementById('tab-'+tabId);_activeTab?.classList.add('active');_activeTab?.removeAttribute('aria-hidden');if(btn)btn.classList.add('active');if(tabId==='quote-make'&&typeof window.initQuoteTab==='function')window.initQuoteTab();if(tabId==='bookmark'&&typeof window.initBookmarkTab==='function')window.initBookmarkTab();if(tabId==='stats'&&typeof window.initStatsTab==='function')window.initStatsTab();if(tabId==='local-charges'&&typeof window.initLocalChargesTab==='function'){window.lcInitFormSelects?.();window.initLocalChargesTab();}}

// --nav-cat-h をカテゴリーナビの実際の高さに動的同期。
// CSS の固定値（56px/108px）はナビが折り返す中間幅で不正確になるため JS で上書きする。
(function(){
  function _syncNavH(){
    const nav=document.querySelector('.cat-nav');
    if(!nav)return;
    const mb=parseFloat(getComputedStyle(nav).marginBottom)||0;
    document.documentElement.style.setProperty('--nav-cat-h',(nav.offsetHeight+mb)+'px');
  }
  if(typeof ResizeObserver!=='undefined'){
    new ResizeObserver(_syncNavH).observe(document.querySelector('.cat-nav')||document.body);
  }
  window.addEventListener('resize',_syncNavH,{passive:true});
  document.addEventListener('DOMContentLoaded',_syncNavH);
  _syncNavH();
})();

document.addEventListener('DOMContentLoaded',()=>{if(document.getElementById('tab-quote-make')?.classList.contains('active')&&typeof window.initQuoteTab==='function')window.initQuoteTab();});
// 数値入力欄での矢印キーによる増減を無効化（誤操作防止）
document.addEventListener('keydown',function(e){if((e.key==='ArrowUp'||e.key==='ArrowDown')&&e.target&&e.target.matches&&e.target.matches('#tab-quote-make input[type="number"]')){e.preventDefault();}},true);

// ===== 見積もりタブへ戻るフローティングボタン =====
// 見積タブ(#tab-quote-make)以外を表示中だけ表示。switchTab を funnel として visibility を更新。
(function () {
  function updateBackToQuoteFab() {
    var fab = document.getElementById('backToQuoteFab');
    if (!fab) return;
    var onQuote = document.getElementById('tab-quote-make')?.classList.contains('active');
    fab.hidden = !!onQuote;
  }
  window.updateBackToQuoteFab = updateBackToQuoteFab;
  var _origSwitchTab = window.switchTab;
  if (typeof _origSwitchTab === 'function') {
    window.switchTab = function () {
      var r = _origSwitchTab.apply(this, arguments);
      try { updateBackToQuoteFab(); } catch (e) {}
      return r;
    };
  }
  document.addEventListener('DOMContentLoaded', updateBackToQuoteFab);
})();

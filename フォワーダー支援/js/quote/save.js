// ========== 保存・読み込み (app-save.js) ==========

  // ========== フィードバック（Supabase feedbacks テーブルに保存） ==========

  // ラジオの見た目を選択状態に応じて更新（イベント委譲）
  //
  // 注: save.js は index.html の #fbOverlay より前で読み込まれるため、
  // querySelectorAll で個別バインドする方式だとリスナー未アタッチになる。
  // document へのデリゲートに切り替えて DOM 構築タイミング非依存にする。
  document.addEventListener('change', function _fbRadioDelegated(e) {
    const target = e.target;
    if (!target || target.type !== 'radio') return;
    if (!target.closest('#fbForm .fb-radio')) return;
    const name = target.name;
    document.querySelectorAll(`#fbForm .fb-radio input[name="${name}"]`).forEach(i => {
      i.closest('.fb-radio').classList.toggle('checked', i.checked);
    });
  });
  function _fbClearForm() {
    const form = document.getElementById('fbForm');
    if (!form) return;
    form.reset();
    document.querySelectorAll('#fbForm .fb-radio').forEach(r => r.classList.remove('checked'));
  }

  let _fbExtraContext = null;

  function openFeedback(section) {
    const overlay = document.getElementById('fbOverlay');
    if (!overlay) return;
    const sec = section || '全体';
    document.getElementById('fbHeadTitle').textContent =
      sec === '全体' ? '💬 フィードバック（ページ全体）' : `💬 フィードバック（${sec}）`;
    _fbClearForm();
    _fbExtraContext = null;
    const secSel = document.getElementById('fbSection');
    if (secSel) {
      Array.from(secSel.options).filter(o => o.dataset.dynamic === '1').forEach(o => o.remove());
      const exists = Array.from(secSel.options).some(o => o.value === sec);
      if (!exists) {
        const opt = document.createElement('option');
        opt.value = sec;
        opt.textContent = sec;
        opt.dataset.dynamic = '1';
        secSel.appendChild(opt);
        _fbExtraContext = sec;
      }
      secSel.value = sec;
    }
    overlay.classList.add('open');
    setTimeout(() => document.getElementById('fbBody')?.focus(), 50);
  }
  function closeFeedback(e) {
    if (e && e.target.id !== 'fbOverlay') return;
    document.getElementById('fbOverlay').classList.remove('open');
    if (_fbCurrentTab !== 'send') switchFbTab('send');
  }
  async function submitFeedback(ev) {
    ev.preventDefault();
    const db = window.SupabaseClient;
    if (!db) {
      quoteShowToast('⚠️ データベース接続が初期化されていません', 'warn');
      return;
    }
    const submitBtn = document.getElementById('fbSubmitBtn');
    const category = document.querySelector('#fbForm input[name="fbCategory"]:checked')?.value || '';
    const section  = document.getElementById('fbSection').value;
    const body     = document.getElementById('fbBody').value.trim();
    if (!category || !section || !body) {
      quoteShowToast('⚠️ 必須項目を入力してください', 'warn');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中…';
    const bodyFinal = _fbExtraContext ? `【${_fbExtraContext}】\n${body}` : body;
    try {
      const { data: { session } } = await db.auth.getSession();
      const row = {
        category,
        section,
        body: bodyFinal,
        ...(session?.user?.id ? { user_id: session.user.id } : {}),
      };
      const { error } = await db.from('feedbacks').insert(row);
      if (error) throw error;
      quoteShowToast('✅ フィードバックを送信しました。ありがとうございます！', 'success', 5000);
      _fbClearForm();
      document.getElementById('fbOverlay').classList.remove('open');
    } catch (err) {
      const msg = err?.message || err?.error_description || JSON.stringify(err);
      quoteShowToast('⚠️ 送信エラー：' + msg, 'warn', 8000);
      console.error('Feedback submit error:', err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '送信';
    }
  }

  // ========== フィードバック受信一覧（チームメンバー向け管理UI） ==========

  const FB_STATUS_LABELS = { open: '未対応', resolved: '解決済み', wontfix: '対応しない' };
  const FB_CAT_ICONS     = { 'バグ報告': '🐛', '改善要望': '💡', '質問': '❓', 'その他': '📌' };

  let _fbCurrentTab  = 'send';
  let _fbAllRows     = [];   // キャッシュ（フィルタ用）

  function switchFbTab(tab) {
    _fbCurrentTab = tab;
    const sendPane = document.getElementById('fbSendPane');
    const listPane = document.getElementById('fbListPane');
    if (sendPane) sendPane.hidden = tab !== 'send';
    if (listPane) listPane.hidden = tab !== 'list';
    document.getElementById('fbTabSend')?.classList.toggle('active', tab === 'send');
    document.getElementById('fbTabList')?.classList.toggle('active', tab === 'list');
    if (tab === 'list') loadFbList();
  }

  async function loadFbList() {
    const content = document.getElementById('fbListContent');
    if (!content) return;
    content.innerHTML = '<p class="fb-list-loading">読み込み中…</p>';
    const db = window.SupabaseClient;
    if (!db) {
      content.innerHTML = '<p class="fb-list-empty">⚠️ DB接続が未初期化です</p>';
      return;
    }
    const { data, error } = await db
      .from('feedbacks')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) {
      content.innerHTML = '<p class="fb-list-empty">⚠️ 読み込みエラー：' + escHtml(error.message) + '</p>';
      return;
    }
    _fbAllRows = data || [];
    renderFbList(_fbAllRows);
  }

  function filterFbList() {
    const status = (document.getElementById('fbListFilter')?.value) || '';
    const rows = status ? _fbAllRows.filter(function(r) { return r.status === status; }) : _fbAllRows;
    renderFbList(rows);
  }

  function renderFbList(rows) {
    const content = document.getElementById('fbListContent');
    if (!content) return;
    if (!rows || rows.length === 0) {
      content.innerHTML = '<p class="fb-list-empty">フィードバックはありません</p>';
      return;
    }
    const html = rows.map(function(r) {
      const dt = new Date(r.created_at).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      const catIcon    = FB_CAT_ICONS[r.category] || '📌';
      const statusLabel = FB_STATUS_LABELS[r.status] || (r.status || '不明');
      const idAttr     = String(r.id).replace(/["'<>&]/g, '');
      const bodyEsc    = escHtml(r.body || '');
      const opts = Object.keys(FB_STATUS_LABELS).map(function(k) {
        return '<option value="' + k + '"' + (r.status === k ? ' selected' : '') + '>' + FB_STATUS_LABELS[k] + '</option>';
      }).join('');
      return '<div class="fb-list-item" data-id="' + idAttr + '">' +
        '<div class="fb-list-meta">' +
          '<span class="fb-list-cat">' + catIcon + ' ' + escHtml(r.category) + '</span>' +
          '<span class="fb-list-sec">📍 ' + escHtml(r.section) + '</span>' +
          '<span class="fb-list-dt">' + dt + '</span>' +
          '<span class="fb-status-badge fb-status-' + (r.status || 'open') + '">' + statusLabel + '</span>' +
        '</div>' +
        '<div class="fb-list-body">' + bodyEsc + '</div>' +
        '<div class="fb-list-actions">' +
          '<select class="fb-status-select" onchange="updateFbStatus(\'' + idAttr + '\', this.value)" title="ステータスを変更">' + opts + '</select>' +
        '</div>' +
      '</div>';
    }).join('');
    content.innerHTML = html;
  }

  async function updateFbStatus(id, status) {
    const db = window.SupabaseClient;
    if (!db) return;
    const { error } = await db.from('feedbacks').update({ status: status }).eq('id', id);
    if (error) {
      quoteShowToast('⚠️ 更新に失敗しました：' + error.message, 'warn');
      return;
    }
    quoteShowToast('✅ ステータスを更新しました', 'success', 2000);
    // キャッシュも更新
    const cached = _fbAllRows.find(function(r) { return r.id === id; });
    if (cached) cached.status = status;
    // バッジをその場で書き換え
    const item = document.querySelector('.fb-list-item[data-id="' + id + '"]');
    if (item) {
      const badge = item.querySelector('.fb-status-badge');
      if (badge) {
        badge.textContent = FB_STATUS_LABELS[status] || status;
        badge.className = 'fb-status-badge fb-status-' + status;
      }
    }
  }

  function refreshFbAdminTab(user) {
    const tabBtn = document.getElementById('fbTabList');
    if (!tabBtn) return;
    tabBtn.hidden = !user;
    if (!user && _fbCurrentTab === 'list') switchFbTab('send');
  }

  // 入力変化で自動保存をトリガー（Phase 2b：見積タブ内に限定）
  function initQuoteAutoSaveListeners() {
    const root = document.getElementById('tab-quote-make') || document;
    root.addEventListener('input',  scheduleAutoSave);
    root.addEventListener('change', scheduleAutoSave);
  }

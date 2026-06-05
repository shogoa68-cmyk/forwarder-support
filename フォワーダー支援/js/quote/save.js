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
      quoteShowToast('⚠️ 送信に失敗しました。時間をおいて再度お試しください', 'warn', 6000);
      console.error('Feedback submit error:', err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '送信';
    }
  }

  // 入力変化で自動保存をトリガー（Phase 2b：見積タブ内に限定）
  function initQuoteAutoSaveListeners() {
    const root = document.getElementById('tab-quote-make') || document;
    root.addEventListener('input',  scheduleAutoSave);
    root.addEventListener('change', scheduleAutoSave);
  }

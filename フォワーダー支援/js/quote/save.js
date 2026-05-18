// ========== 保存・読み込み (app-save.js) ==========

  // ========== フィードバック（独自モーダル → 裏でGoogle Form 送信） ==========
  // ↓↓↓ Googleフォーム作成後にここを書き換える ↓↓↓
  const FEEDBACK_FORM = {
    // フォームID（URL の /d/e/XXXXX/ 部分）
    formId: '1FAIpQLSfcUVKmty9XKosfI1YZG8IwkjX_NQOtMmz7J4FYbuituRTYKA',
    // 各フィールドの entry ID
    entries: {
      category: 'entry.565201258',   // ラジオ「カテゴリ」
      section:  'entry.449298040',   // プルダウン「該当セクション」
      body:     'entry.2023042562',  // 段落「内容」
    },
  };
  // ↑↑↑ ここまで書き換え ↑↑↑

  function _fbViewUrl() {
    return `https://docs.google.com/forms/d/e/${FEEDBACK_FORM.formId}/viewform`;
  }
  function _fbSubmitUrl() {
    return `https://docs.google.com/forms/d/e/${FEEDBACK_FORM.formId}/formResponse`;
  }
  function _fbEntriesConfigured() {
    // 必須項目(category, section, body)の entry ID が設定済みか
    const e = FEEDBACK_FORM.entries;
    return e.category && !e.category.startsWith('__')
        && e.section  && !e.section.startsWith('__')
        && e.body     && !e.body.startsWith('__');
  }
  function _fbBuildPrefilledUrl(section) {
    const sep = '?usp=pp_url';
    const e = FEEDBACK_FORM.entries;
    const parts = [];
    if (e.section && !e.section.startsWith('__') && section) {
      parts.push(`${e.section}=${encodeURIComponent(section)}`);
    }
    return _fbViewUrl() + sep + (parts.length ? '&' + parts.join('&') : '');
  }

  // ラジオの見た目を選択状態に応じて更新
  function _fbWireRadios() {
    document.querySelectorAll('#fbForm .fb-radio input[type="radio"]').forEach(input => {
      input.addEventListener('change', () => {
        const name = input.name;
        document.querySelectorAll(`#fbForm .fb-radio input[name="${name}"]`).forEach(i => {
          i.closest('.fb-radio').classList.toggle('checked', i.checked);
        });
      });
    });
  }
  function _fbClearForm() {
    const form = document.getElementById('fbForm');
    if (!form) return;
    form.reset();
    document.querySelectorAll('#fbForm .fb-radio').forEach(r => r.classList.remove('checked'));
  }

  // フォームに固定登録されていないセクション名（他タブから渡された場合）を
  // 一時保管しておき、送信時に本文先頭へ「【...】」プレフィックスとして付与する。
  // Google Form 側の select は固定選択肢のため、未登録値を直接送ると拒否される。
  let _fbExtraContext = null;

  function openFeedback(section) {
    const overlay = document.getElementById('fbOverlay');
    if (!overlay) return;
    const sec = section || '全体';
    document.getElementById('fbHeadTitle').textContent =
      sec === '全体' ? '💬 フィードバック（ページ全体）' : `💬 フィードバック（${sec}）`;
    // フォーム初期化
    _fbClearForm();
    _fbExtraContext = null;
    const secSel = document.getElementById('fbSection');
    if (secSel) {
      // 前回 openFeedback で追加した動的 option を一旦削除
      Array.from(secSel.options).filter(o => o.dataset.dynamic === '1').forEach(o => o.remove());
      const exists = Array.from(secSel.options).some(o => o.value === sec);
      if (!exists) {
        // 未登録セクション: 動的 option として追加・選択表示
        // ただし Google Form 側の dropdown は固定選択肢で未登録値を弾く可能性があるため、
        // 送信時の保険として本文先頭にも「【セクション名】」を残す
        const opt = document.createElement('option');
        opt.value = sec;
        opt.textContent = sec;
        opt.dataset.dynamic = '1';
        secSel.appendChild(opt);
        _fbExtraContext = sec;
      }
      secSel.value = sec;
    }
    // 設定状態
    const noUrl  = document.getElementById('fbNoUrlMsg');
    const submitBtn = document.getElementById('fbSubmitBtn');
    if (_fbEntriesConfigured()) {
      noUrl.classList.remove('show');
      submitBtn.disabled = false;
    } else {
      noUrl.classList.add('show');
      submitBtn.disabled = true;
    }
    // Googleフォームで開くリンク
    const openTab = document.getElementById('fbOpenTab');
    if (openTab) openTab.href = _fbBuildPrefilledUrl(sec);
    overlay.classList.add('open');
    // 内容欄にフォーカス
    setTimeout(() => document.getElementById('fbBody')?.focus(), 50);
  }
  function closeFeedback(e) {
    if (e && e.target.id !== 'fbOverlay') return;
    document.getElementById('fbOverlay').classList.remove('open');
  }
  async function submitFeedback(ev) {
    ev.preventDefault();
    if (!_fbEntriesConfigured()) {
      quoteShowToast('⚠️ entry IDが未設定のため送信できません', 'warn');
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
    // Google Formは CORS を許可していないので no-cors で投げて
    // レスポンス検証はできないが送信自体は通る
    const bodyWithContext = _fbExtraContext ? `【${_fbExtraContext}】\n${body}` : body;
    const fd = new FormData();
    fd.append(FEEDBACK_FORM.entries.category, category);
    fd.append(FEEDBACK_FORM.entries.section,  section);
    fd.append(FEEDBACK_FORM.entries.body,     bodyWithContext);
    try {
      await fetch(_fbSubmitUrl(), { method: 'POST', mode: 'no-cors', body: fd });
      quoteShowToast('✅ フィードバックを送信しました。ありがとうございます！', 'success', 5000);
      closeFeedback();
    } catch (err) {
      // no-cors では fetch 自体は通常成功扱いになるが念のため
      quoteShowToast('⚠️ 送信に失敗しました。「Googleフォームで開く」から直接ご記入ください', 'warn', 6000);
      console.error('Feedback submit error:', err);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '送信';
    }
  }
  // ラジオの選択状態見た目を初期化
  _fbWireRadios();

  // 入力変化で自動保存をトリガー（Phase 2b：見積タブ内に限定）
  function initQuoteAutoSaveListeners() {
    const root = document.getElementById('tab-quote-make') || document;
    root.addEventListener('input',  scheduleAutoSave);
    root.addEventListener('change', scheduleAutoSave);
  }

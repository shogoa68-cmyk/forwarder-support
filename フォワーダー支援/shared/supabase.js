/**
 * Supabase クライアント初期化 + 認証ヘルパー
 * window.SupabaseClient  — supabase-js クライアント本体
 * window.SupabaseAuth    — ログイン / ログアウト / セッション取得
 */
(function () {
  const SUPABASE_URL = 'https://uqofdnsolmrzxckmtpzv.supabase.co';
  const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxb2ZkbnNvbG1yenhja210cHp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzc1NjAsImV4cCI6MjA5NTkxMzU2MH0.' +
    'fsvP7oKvH3bsoepm8vPwFGXIJeNUg-zmNhz6TFd25E8';

  if (typeof supabase === 'undefined') {
    console.warn('[SupabaseClient] supabase-js が読み込まれていません。CDN を確認してください。');
    return;
  }

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  window.SupabaseClient = client;

  /* ---------- 認証ヘルパー ---------- */
  window.SupabaseAuth = {
    /** 現在のセッション（非同期） */
    getSession: () => client.auth.getSession(),

    /** GitHub OAuth でログイン（リダイレクト方式） */
    loginWithGitHub: () =>
      client.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: location.href },
      }),

    /** ログアウト */
    logout: () => client.auth.signOut(),

    /** セッション変化コールバック登録 */
    onAuthStateChange: (cb) => client.auth.onAuthStateChange(cb),
  };

  /* ---------- 認証状態変化 → UI 更新 ---------- */
  client.auth.onAuthStateChange((_event, session) => {
    _updateAuthUI(session);
  });

  /** ページロード時に既存セッションを確認して UI を初期化 */
  client.auth.getSession().then(({ data }) => {
    _updateAuthUI(data.session);
  });

  function _updateAuthUI(session) {
    const btn = document.getElementById('authBtn');
    const info = document.getElementById('authUserInfo');
    if (!btn) return;
    if (session?.user) {
      const name = session.user.user_metadata?.user_name
        || session.user.user_metadata?.full_name
        || session.user.email
        || 'ユーザー';
      if (info) info.textContent = name;
      btn.textContent = 'ログアウト';
      btn.onclick = () => window.SupabaseAuth.logout();
    } else {
      if (info) info.textContent = '';
      btn.textContent = 'GitHub でログイン';
      btn.onclick = () => window.SupabaseAuth.loginWithGitHub();
    }
  }
})();

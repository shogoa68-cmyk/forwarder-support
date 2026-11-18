// users.js umOnAuth：権限確認の通信中にログアウトしても、古い結果で管理者表示（_myRole・お知らせ）が復活しない（疑似 Supabase）
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../フォワーダー支援/js/quote/users.js'), 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<button id="hdrUserMgrBtn" hidden></button>');
  const r = await p.evaluate(async (src) => {
    let release; const gate = new Promise(res => { release = res; });
    window.annCalls = []; window.annOnAuth = u => window.annCalls.push(u ? 'user' : 'null');
    window.SupabaseClient = {
      rpc: async n => { if (n === 'get_my_role') { await gate; return { data: 'admin', error: null }; } return { data: 3, error: null }; },
      from: () => ({ upsert: async () => ({}) }),
    };
    (0, eval)(src);
    const pending = window.umOnAuth({ email: 'a@x.com' });   // 権限確認の途中…
    await window.umOnAuth(null);                              // ログアウト
    release(); await pending;
    return { role: window._myRole, no: window._myMemberNo, calls: window.annCalls, btnHidden: document.getElementById('hdrUserMgrBtn').hidden };
  }, src);
  const ok = r.role === null && r.no === null && r.calls.join() === 'null' && r.btnHidden;
  console.log(ok ? 'PASS' : 'FAIL ' + JSON.stringify(r));
  await b.close(); process.exit(ok ? 0 : 1);
})();

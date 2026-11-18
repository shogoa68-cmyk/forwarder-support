// users.js：メールに ' を含むメンバーでも、ロール変更・削除・発番IDのボタンが壊れない（実 Supabase には接続しない）
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../フォワーダー支援/js/quote/users.js'), 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent('<div id="umOverlay"></div><div id="umModal"></div><div id="umMemberList"></div><input id="umSearch"><select id="umRoleFilter"><option value=""></option></select>');
  await p.evaluate(() => {
    window.calls = [];
    const tbl = {
      allowed_emails: { select: () => Promise.resolve({ data: [{ email: "o'brien@x.com", role: 'member', member_no: 2 }, { email: 'me@x.com', role: 'admin', member_no: 1 }], error: null }),
        update: v => ({ eq: (k, e) => { window.calls.push(['update', e, JSON.stringify(v)]); return Promise.resolve({ error: null }); } }),
        delete: () => ({ eq: (k, e) => { window.calls.push(['delete', e]); return Promise.resolve({ error: null }); } }) },
      user_profiles: { select: () => Promise.resolve({ data: [], error: null }), upsert: () => Promise.resolve({}) },
    };
    window.SupabaseClient = { from: t => tbl[t], rpc: async n => ({ data: n === 'get_my_role' ? 'admin' : null, error: null }) };
    window.confirm = () => true; window.prompt = () => '7';
  });
  await p.addScriptTag({ content: src });
  await p.evaluate(async () => { await umOnAuth({ email: 'me@x.com' }); await openUserMgr(); });
  await p.waitForSelector('.um-card');
  await p.selectOption('.um-card:not(.is-self) select.um-role', 'viewer');
  await p.click('.um-card:not(.is-self) .um-memberno--edit');
  await p.waitForTimeout(100);
  await p.click('.um-card:not(.is-self) .um-del');
  await p.waitForTimeout(100);
  const calls = await p.evaluate(() => window.calls);
  const ok = calls.length === 3 && calls.every(c => c[1] === "o'brien@x.com") && errs.length === 0;
  console.log(ok ? 'PASS 3/3' : 'FAIL ' + JSON.stringify(calls) + errs.join('|'));
  await b.close(); process.exit(ok ? 0 : 1);
})();

// 署名つきのテスト通知を cp-webhook へ送る（サイバーポートの代わりに、自分で受け口を試す道具）。
// 使い方:  CP_WEBHOOK_SECRET=<秘密のトークン> node scripts/cp-tests/send-test-webhook.mjs https://<ref>.supabase.co/functions/v1/cp-webhook [hex|base64]
// 秘密のトークンは画面やチャットに貼らないこと（環境変数で渡す）。
import { createHmac } from 'node:crypto';
const [url, enc = 'hex'] = process.argv.slice(2);
const secret = process.env.CP_WEBHOOK_SECRET;
if (!url || !secret) { console.error('URL と環境変数 CP_WEBHOOK_SECRET が必要です'); process.exit(1); }
const body = JSON.stringify({
  notifyToPartner: 'TEST', postToUrl: url,
  notifyOperation: {
    historyId: 'TEST-' + Date.now(),
    operationType: { operationTypeCode: 'TEST', operationTypeName: 'テスト通知' },
    inTrade: { tradeNo: 'TEST_0001', tradeType: 'import', blNo: 'TESTBL0001' },
    operatedAt: new Date().toISOString(),
  },
});
const sig = createHmac('sha256', secret).update(body).digest(enc === 'base64' ? 'base64' : 'hex');
const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cyberport-signature-256': sig }, body });
console.log(res.status, await res.text());

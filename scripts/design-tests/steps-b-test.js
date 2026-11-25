// Design 46〜48 回答（案B）：見積入力（新画面）ステップ①②③⑤ の「左右 2 列」
//   node scripts/design-tests/steps-b-test.js   （THEME=classic で現行／W=390 でスマホ）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v2`;
  const W = +process.env.W || 1440, PHONE = W <= 600, CLASSIC = process.env.THEME === 'classic';
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, isMobile: PHONE, hasTouch: PHONE });
  await ctx.addInitScript(c => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('fwd.editorV2', '1'); localStorage.setItem('quoteRemarkSheetSeen_v1', '1'); if (c) localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} }, CLASSIC);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept());
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(900);
  const go = async n => { await p.evaluate(n => { window.editorV2Go(n, true); window.sbRefresh(); }, n); await p.waitForTimeout(250); };
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }, sel);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#sbAside .sb-panel:not([hidden]) .sb-row:not([hidden])')].map(r => r.querySelector('.sb-l').textContent + '=' + r.querySelector('.sb-v').textContent));
  const clickRow = k => p.evaluate(k => document.querySelector('#sbAside .sb-panel:not([hidden]) .sb-row[data-k="' + k + '"] .sb-rh').click(), k);
  const fill = (id, v) => p.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

  // ===== ① 基本 =====
  await go(1);
  ok('① 右の列「この案件の状況」が出る', await vis('#sbAside') && await p.evaluate(() => document.querySelector('#sbAside .sb-panel:not([hidden]) .sb-h').textContent === 'この案件の状況'));
  const r1 = await rows();
  ok('① 行：ステータス・依頼受信・発行日・有効期限・提出期限・関連番号・案件のファイル・タグ', ['ステータス', '依頼受信', '発行日', '有効期限', '提出期限', '関連番号', '案件のファイル', 'タグ・経路'].every(l => r1.some(x => x.startsWith(l + '='))), r1);
  ok('① ステータスの値は「下書き中」', r1.includes('ステータス=下書き中'), r1);
  ok('① 本文からステータスのボタン・小見出し・「その他の情報」の帯を外す', !(await vis('#section-ref .qf-status-btns')) && !(await vis('#section-ref .ci-head')) && !(await vis('#e2MoreBtn')));
  ok('① 本文の見出しは「1 基本」＋何をする場所かの 1 行', await p.evaluate(() => document.getElementById('sbSub').textContent === 'お客様と案件名を入れます'));
  await fill('qf-customer', '株式会社サンプル'); await fill('qf-person', '山田');
  if (!PHONE) {
    const cu = await p.evaluate(() => document.getElementById('qf-customer').getBoundingClientRect().top), pe = await p.evaluate(() => document.getElementById('qf-person').getBoundingClientRect().top);
    ok('① 左の列は 1 列（お客様の下にご担当者）', pe > cu + 20, { cu, pe });
    ok('① 2 列（右の列は本文の右・幅 280px）', await p.evaluate(() => { const a = document.getElementById('sbAside').getBoundingClientRect(), c = document.getElementById('qf-customer').getBoundingClientRect(); return a.left > c.right && Math.round(a.width) === 280; }));
  } else ok('① スマホ：右の列は左の下', await p.evaluate(() => document.getElementById('sbAside').getBoundingClientRect().top > document.getElementById('qf-ref').getBoundingClientRect().bottom));
  await clickRow('status'); await p.waitForTimeout(150);
  ok('① ステータスの行を押すと、その下にステータスのボタン（全部）が開く', await p.evaluate(() => { const b = document.querySelector('#sbAside .sb-row[data-k="status"] .sb-rb'); return !b.hidden && b.querySelectorAll('.qf-status-btn[data-status]').length >= 8 && [...b.querySelectorAll('.qf-status-btn[data-status]')].every(x => x.getBoundingClientRect().width > 0); }));
  await p.evaluate(() => document.querySelector('#sbAside .qf-status-btn[data-status="提示済み"]').click()); await p.waitForTimeout(200); await p.evaluate(() => window.sbRefresh());
  ok('① 行の中でステータスを変えると、値が「提示済み」になる', (await rows()).includes('ステータス=提示済み'));
  await clickRow('valid'); await p.waitForTimeout(150);
  ok('① ほかの行を押すと前の行は閉じ、有効期限の欄が開く', await p.evaluate(() => document.querySelector('#sbAside .sb-row[data-k="status"] .sb-rb').hidden && !document.querySelector('#sbAside .sb-row[data-k="valid"] .sb-rb').hidden && document.getElementById('qf-valid-until').getBoundingClientRect().width > 0));
  await clickRow('due'); await p.waitForTimeout(150);
  ok('① 提出期限の行で日付を入れられ、値に出る', await p.evaluate(() => { const i = document.getElementById('qf-due'); return i.getBoundingClientRect().width > 0; }));
  await fill('qf-due', '2026-11-25'); await p.evaluate(() => window.sbRefresh());
  ok('① 提出期限の値は「11/25」', (await rows()).includes('提出期限=11/25'));

  // ===== ② ルート =====
  await go(2);
  ok('② 右の列「この案の条件」', await p.evaluate(() => document.querySelector('#sbAside .sb-panel:not([hidden]) .sb-h').textContent === 'この案の条件'));
  await p.evaluate(() => { const s = document.getElementById('cond-incoterms'); s.value = [...s.options].find(o => /FOB/.test(o.value)).value; s.dispatchEvent(new Event('change', { bubbles: true })); window.setDirection && window.setDirection('export'); window.setTransport && window.setTransport('fcl'); });
  await p.waitForTimeout(500); await p.evaluate(() => window.sbRefresh());
  const r2 = await rows();
  ok('② 行：貿易条件 FOB・方向・モード・出発地側・到着地側・保険付保', r2.includes('貿易条件=FOB') && r2.some(x => /^方向=.*輸出/.test(x)) && r2.some(x => /^モード=.*FCL/.test(x)) && r2.includes('出発地側=使わない') && r2.includes('到着地側=使わない') && r2.includes('保険付保=なし'), r2);
  ok('② 使わない側（出発地・到着地）の帯は本文に出さない', !(await vis('#zone1Card')) && !(await vis('#zone3Card')));
  await clickRow('z1'); await p.waitForTimeout(300); await p.evaluate(() => window.sbRefresh());
  ok('② 出発地側のスイッチで ON になり、本文に集荷地の欄が出る', (await rows()).some(x => /^出発地側=使う/.test(x)) && await vis('#zone1Card'));
  await clickRow('z1'); await p.waitForTimeout(300); await p.evaluate(() => window.sbRefresh());
  ok('② もう一度押すと OFF に戻る', (await rows()).includes('出発地側=使わない'));
  ok('② 幹線輸送の枠の見出しを出さず、キャリアの欄に見出しがある', !(await vis('#zone2Card > .zone-card-header')) && await vis('#sbCarHead'));
  ok('② キャリアのリンクの札は本文に出さず、「🔗 リンク ▾」へ', !(await vis('#z2CarrierLinks')) && await vis('#sbCarLinks'));
  ok('②［＋ 航路］は「＋ 別の航路を登録（案を比べる）」', await p.evaluate(() => document.querySelector('#zone2Card .z2-route-add').textContent.trim() === '＋ 別の航路を登録（案を比べる）'));
  ok('② 「ゾーン構成から見積もり行を生成」は ② に出さず、④ の表の上へ', !(await vis('.zone-preset-section')) && await p.evaluate(() => { const z = document.querySelector('.zone-preset-section'); return !!z.closest('#section-table'); }));
  await clickRow('inco'); await p.waitForTimeout(250);
  ok('② 貿易条件の行を押すと、本文で選び直せる（インコタームズの選択が出る）', await vis('#cond-incoterms'));
  await p.evaluate(() => { const s = document.getElementById('cond-incoterms'); s.dispatchEvent(new Event('change', { bubbles: true })); });

  // ===== ③ 貨物・物量 =====
  await go(3); await p.waitForTimeout(300);
  ok('③ 右の列「貨物の区分・確認」：危険品・特殊・関税率・関連知識・この案', await p.evaluate(() => { const l = [...document.querySelectorAll('#sbAside .sb-panel:not([hidden]) .sb-row:not([hidden]) .sb-l')].map(x => x.textContent); return ['危険品・特殊', '関税率', '関連知識', 'この案'].every(x => l.includes(x)); }));
  ok('③ 貨物名・HS の横のボタン（危険品・関税率・関連知識）は本文に出さない', !(await vis('#cargoKindBtn')) && !(await vis('#cargoTaxBtn')) && !(await vis('#cargoLawBtn')));
  await clickRow('kind'); await p.waitForTimeout(200);
  ok('③ 危険品・特殊の行を押すと、区分の選択がその下に開く', await p.evaluate(() => { const s = document.getElementById('cargoKindSub'); return !!s.closest('#sbAside') && !s.hidden && s.getBoundingClientRect().height > 0; }));
  ok('③ FCL：コンテナが出て、荷姿は見出しの「▸ 開く」で開く（合計の 1 行つき）', await vis('[data-field-id="container-type"]') && await vis('#sbPackHead') && !(await vis('#section-volume .cargo-detail-table')) && await p.evaluate(() => /R\/T .* CW .* CBM/.test(document.getElementById('sbPackHead').textContent)));
  await p.evaluate(() => document.getElementById('sbPackHead').click()); await p.waitForTimeout(200);
  ok('③ 開くと、その場で荷姿の表が出る', await vis('#section-volume .cargo-detail-table'));
  ok('③［→見積］3 つはまとめて「→ 費用に数量を入れる ▾」、濃い色のボタンは［⋯］へ', !(await vis('.cd-reflect-btn')) && await vis('#sbReflect') && !(await vis('.van-jump-btn')) && await vis('#sbPackMore'));
  await p.evaluate(() => document.getElementById('sbReflect').click()); await p.waitForTimeout(150);
  ok('③「→ 費用に数量を入れる ▾」の中に R/T・CW・CBM', await p.evaluate(() => { const m = document.querySelector('.sb-menu'); return !!m && ['R/T', 'CW', 'CBM'].every(k => m.textContent.includes(k)); }));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('③ Esc でメニューが閉じる', !(await p.evaluate(() => !!document.querySelector('.sb-menu'))));
  await p.evaluate(() => document.getElementById('sbHeadMore').click()); await p.waitForTimeout(150);
  ok('③ 本文の見出しの［⋯］に「貨物・ルートの入力をクリア」（赤字）', await p.evaluate(() => { const b = [...document.querySelectorAll('.sb-menu .sb-mi')].find(x => /入力をクリア/.test(x.textContent)); return !!b && b.classList.contains('is-danger'); }));
  await p.keyboard.press('Escape');
  await p.evaluate(() => window.setTransport('lcl')); await p.waitForTimeout(1800); await p.evaluate(() => window.sbRefresh());
  ok('③ LCL：荷姿の表が先（開いた状態）・コンテナは出さない', await vis('#section-volume .cargo-detail-table') && !(await vis('[data-field-id="container-type"]')));
  await p.evaluate(() => window.setTransport('fcl')); await p.waitForTimeout(1800);

  // ===== ⑤ リマーク・出力 =====
  await go(5); await p.waitForTimeout(300);
  ok('⑤ 右の列「見積書に添えるもの」：作業範囲・品物別・常時付記・画像', await p.evaluate(() => { const l = [...document.querySelectorAll('#sbAside .sb-panel:not([hidden]) .sb-row:not([hidden]) .sb-l')].map(x => x.textContent); return ['作業範囲', '品物別', '常時付記', '画像'].every(x => l.includes(x)); }));
  await clickRow('scope'); await p.waitForTimeout(150);
  ok('⑤ 作業範囲（①から移した）は行の中で入力できる', await p.evaluate(() => !!document.getElementById('qf-scope').closest('#sbAside') && document.getElementById('qf-scope').getBoundingClientRect().height > 0));
  await fill('qf-scope', '輸出通関・海上輸送'); await p.evaluate(() => window.sbRefresh());
  ok('⑤ 作業範囲の値が行に出る', (await rows()).includes('作業範囲=輸出通関・海上輸送'));
  ok('⑤ 文章の欄は見出し「リマーク」の下・最初から見える', await vis('#sbRmHead') && await vis('#remarkTextarea') && await p.evaluate(() => document.getElementById('remarkTextarea').getBoundingClientRect().height >= 110));
  ok('⑤ 定型文のボタンは最初は出さない（［＋ 定型文を入れる ▾］の中）', !(await vis('#presetBtns')));
  await p.evaluate(() => document.getElementById('sbRmAdd').click()); await p.waitForTimeout(200);
  ok('⑤［＋ 定型文を入れる ▾］でパネルが開く（件数 0 のタブ・チーム人気は出さない）', await vis('#sbRmPanel') && await p.evaluate(() => [...document.querySelectorAll('#sbRmPanel .rm-tab')].filter(t => t.getBoundingClientRect().width > 0).every(t => !/チーム人気/.test(t.textContent) && !/\s0$/.test(t.textContent.trim()))));
  await p.evaluate(() => document.querySelector('#sbRmPanel #presetBtns .preset-btn.rt-on:not(.preset-btn-add)').click()); await p.waitForTimeout(300); await p.evaluate(() => window.sbRefresh());
  ok('⑤ 定型文を押すと文章に入り、欄の下にチップが出る', await p.evaluate(() => !!document.getElementById('remarkTextarea').value.trim() && document.querySelectorAll('#sbRmChips .sb-chip').length === 1));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok('⑤ Esc でパネルが閉じる', !(await vis('#sbRmPanel')));
  await p.evaluate(() => document.querySelector('#sbRmChips .sb-chip button').click()); await p.waitForTimeout(300); await p.evaluate(() => window.sbRefresh());
  ok('⑤ チップの ✕ で定型文が外れる', await p.evaluate(() => document.querySelectorAll('#sbRmChips .sb-chip').length === 0 && !document.getElementById('remarkTextarea').value.trim()));
  if (!PHONE) {
    ok('⑤ 「出力する」は右の列の下（PDF 出力が主・保存は出さない）', await p.evaluate(() => { const o = document.getElementById('e2Out'); return !!o.closest('#sbAside') && o.getBoundingClientRect().height > 0 && getComputedStyle(o.querySelector('.e2o-save')).display === 'none' && o.querySelector('.e2o-pdf').getBoundingClientRect().width > o.querySelector('.e2o-pv').getBoundingClientRect().width; }));
  } else ok('⑤ スマホ：「出力する」の枠は出さない（下の固定ボタンがある）', !(await vis('#e2Out')));
  ok('⑤［次へ］は出さない', !(await vis('#e2Next')));
  ok('横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await p.evaluate(() => document.documentElement.scrollWidth));

  // ===== 旧画面へ戻す =====
  await p.evaluate(() => window.editorV2Set(false)); await p.waitForTimeout(400);
  ok('旧画面へ戻すと、移した欄が元の場所へ戻る', await p.evaluate(() => !document.getElementById('sbAside') && !!document.getElementById('qf-scope').closest('#section-scope') && !!document.getElementById('qf-valid-until').closest('#section-ref') && !!document.getElementById('crBanner').closest('#section-ref') && !!document.getElementById('presetBtns').closest('#remarkBody') && !document.getElementById('presetBtns').closest('#sbRmPanel') && !!document.querySelector('.zone-preset-section').closest('#section-cond') && !!document.getElementById('cargoKindSub').closest('#section-cargo')));
  ok('旧画面：［＋ 航路］の文字が元に戻る', await p.evaluate(() => document.querySelector('#zone2Card .z2-route-add').textContent.trim() === '＋ 航路'));
  await p.evaluate(() => window.editorV2Set(true)); await p.waitForTimeout(400); await go(1);
  ok('新画面へ戻すと、また右の列が出る', await vis('#sbAside'));
  ok('JS エラーなし', !errs.length, errs);
  console.log('FAIL=' + fails);
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();

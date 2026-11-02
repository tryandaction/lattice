import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import os from 'node:os';
const repo = process.env.LATTICE_ACCEPTANCE_REPO || process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const output = process.env.LATTICE_ACCEPTANCE_OUTPUT || path.join(os.tmpdir(), 'lattice-cloud-account-acceptance');
await mkdir(output, { recursive: true });
const baseURL = new URL(process.env.LATTICE_ACCEPTANCE_URL || 'http://127.0.0.1:3217').origin;
const suite = process.env.LATTICE_ACCEPTANCE_SUITE || 'all';
assert.ok(['all', 'owner', 'viewer', 'github'].includes(suite), 'Unknown acceptance suite');
const githubAuthorizationDelayMs = Number(process.env.LATTICE_ACCEPTANCE_GITHUB_DELAY_MS || 0);
assert.ok(Number.isFinite(githubAuthorizationDelayMs) && githubAuthorizationDelayMs >= 0 && githubAuthorizationDelayMs <= 10000, 'Invalid synthetic authorization delay');
const browser = await chromium.launch({ headless: process.env.LATTICE_ACCEPTANCE_HEADLESS === '1' });
const results = [];
const viewerResults = [];
const githubResults = [];
const secretPassword = 'Fixture-password-123!';
const secretCode = '12345678';
const secretTeamKey = 'fixture-team-api-key-never-persist-5729';
const userId = '11111111-1111-4111-8111-111111111111';
const libraryId = '22222222-2222-4222-8222-222222222222';
const now = () => new Date().toISOString();
const member = { libraryId, userId, role: 'owner', status: 'active', displayName: '夹具用户', joinedAt: now() };
const library = { id: libraryId, name: '浏览器验收云库', slug: 'fixture-library', ownerId: userId, visibility: 'private', createdAt: now(), updatedAt: now() };
const invitedLibraryId = '33333333-3333-4333-8333-333333333333';
const pdfItemId = '44444444-4444-4444-8444-444444444444';
const invitedLibrary = { ...library, id: invitedLibraryId, name: '合成邀请协作库' };
const makePdf = async text => { const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica); const page = document.addPage([612, 792]); page.drawText(text, { x: 48, y: 700, size: 16, font }); page.drawText('Public synthetic browser fixture. No private data.', { x: 48, y: 665, size: 11, font }); return Buffer.from(await document.save()); };
const pdfCurrent = await makePdf('Lattice collaboration fixture v2');
const pdfPrevious = await makePdf('Lattice collaboration fixture v1');
const sha = data => createHash('sha256').update(data).digest('hex');
const pdfVersions = [
  { id: '55555555-5555-4555-8555-555555555551', itemId: pdfItemId, versionNumber: 1, blobId: 'fixture-pdf-v1', contentHash: sha(pdfPrevious), manifest: { mimeType: 'application/pdf' }, createdBy: 'fixture-reader', createdAt: '2026-10-29T10:00:00Z' },
  { id: '55555555-5555-4555-8555-555555555552', itemId: pdfItemId, versionNumber: 2, blobId: 'fixture-pdf-v2', contentHash: sha(pdfCurrent), manifest: { mimeType: 'application/pdf' }, createdBy: userId, createdAt: '2026-10-30T10:00:00Z' },
];
const pdfItem = { id: pdfItemId, libraryId: invitedLibraryId, title: 'collaboration-fixture.pdf', canonicalName: 'collaboration-fixture.pdf', kind: 'pdf', metadata: {}, currentVersionId: pdfVersions[1].id, contentHash: sha(pdfCurrent), status: 'active', createdBy: userId, createdAt: now(), updatedAt: now() };
const makePin = (id, authorId, x, y, comment) => ({ id, itemId: pdfItemId, versionId: pdfVersions[1].id, authorId, kind: 'area', target: { locatorType: 'pdf-page', locator: { page: 1 } }, geometry: { rects: [{ x1: x, y1: y, x2: x + .02, y2: y + .02 }] }, style: { type: 'area', color: '#FFC107' }, body: { comment }, status: 'active', revision: 1, createdAt: now(), updatedAt: now() });
const initialAnnotations = [makePin('fixture-owner-pin', userId, .35, .25, '我的原有批注'), makePin('fixture-member-pin', 'fixture-reader', .55, .3, '共同作者批注')];
function timeout(ms = 45000) { return { timeout: ms }; }
async function poll(check, message, ms = 10000) { const until = Date.now() + ms; while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 75)); } throw new Error(message); }
async function visible(locator) { return locator.isVisible().catch(() => false); }
async function runViewport(name, viewport) {
  const context = await browser.newContext({ viewport, isMobile: name === 'mobile', hasTouch: name === 'mobile', serviceWorkers: 'block' });
  const state = { signup: 'ok', token: 'ok', verify: 'expired', resend: 'ok', failLibraries: false, libraries: [], inviteJoined: false, pdf: structuredClone(pdfItem), versions: structuredClone(pdfVersions), annotations: structuredClone(initialAnnotations), failAnnotation: false, aiConfig: { enabled: false, maxRequestsPerDay: 100, monthlyBudgetUsdMicros: 1000000, maxOutputTokens: 1024, providers: [] }, aiWrites: [] };
  const requests = [], unexpectedExternal = [], pageErrors = [], consoleErrors = [], checks = [], screenshots = [];
  const count = suffix => requests.filter(request => request.path.endsWith(suffix)).length;
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL).host) socket.connectToServer();
    else { unexpectedExternal.push({ method: 'WEBSOCKET', path: url.pathname }); socket.close(); }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseURL) return route.continue();
    url.pathname = url.pathname.replace(/^\/functions\/v1\/shared-library-api(?=\/v1\/)/, '');
    const record = { method: request.method(), path: url.pathname };
    requests.push(record);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/signup')) {
        if (state.signup === 'network') return route.abort('internetdisconnected');
        if (state.signup !== 'ok') return json({ error_code: state.signup === 'duplicate' ? 'user_already_exists' : state.signup === 'limited' ? 'over_email_send_rate_limit' : 'unexpected_failure' }, state.signup === 'duplicate' ? 422 : state.signup === 'limited' ? 429 : 503);
        return json({ id: userId, email: 'member@example.com', confirmation_sent_at: now() });
      }
      if (url.pathname.endsWith('/resend')) return json(state.resend === 'ok' ? {} : { error_code: 'over_email_send_rate_limit' }, state.resend === 'ok' ? 200 : 429);
      if (url.pathname.endsWith('/recover') || url.pathname.endsWith('/logout')) return json({});
      if (url.pathname.endsWith('/verify') && state.verify !== 'ok') return json({ error_code: state.verify === 'expired' ? 'otp_expired' : state.verify === 'limited' ? 'over_request_rate_limit' : 'unexpected_failure' }, state.verify === 'expired' ? 403 : state.verify === 'limited' ? 429 : 503);
      if (url.pathname.endsWith('/token') && state.token !== 'ok') {
        if (state.token === 'network') return route.abort('internetdisconnected');
        return json({ error_code: state.token === 'unconfirmed' ? 'email_not_confirmed' : state.token === 'invalid' ? 'invalid_credentials' : state.token === 'limited' ? 'over_request_rate_limit' : 'unexpected_failure' }, state.token === 'limited' ? 429 : state.token === 'server' ? 503 : 400);
      }
      if (url.pathname.endsWith('/verify') || url.pathname.endsWith('/token')) return json({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600, user: { id: userId } });
    }
    if (url.pathname === '/v1/libraries') {
      if (state.failLibraries) return json({ error: { code: 'NETWORK_ERROR', message: '夹具云库暂不可用', retryable: true } }, 503);
      if (request.method() === 'POST') { state.libraries = [library]; return json({ data: library }); }
      return json({ data: state.libraries });
    }
    if (url.pathname === '/v1/invitations/accept') { state.inviteJoined = true; state.libraries.push(invitedLibrary); return json({ data: { libraryId: invitedLibraryId } }); }
    const requestLibrary = url.pathname.split('/libraries/')[1]?.split('/')[0] || libraryId;
    if (url.pathname.endsWith('/members/me')) return json({ data: { ...member, libraryId: requestLibrary } });
    if (url.pathname.endsWith('/members')) return json({ data: [{ ...member, libraryId: requestLibrary }, { ...member, libraryId: requestLibrary, userId: 'fixture-reader', role: 'viewer', displayName: '夹具只读成员' }] });
    if (url.pathname.endsWith('/invitations')) return json({ data: [] });
    if (url.pathname.endsWith('/changes')) return json({ data: { changes: requestLibrary === invitedLibraryId && url.searchParams.get('cursor') === '0' ? [{ sequence: '1', type: 'item', value: state.pdf }] : [], cursor: requestLibrary === invitedLibraryId ? '1' : '0', hasMore: false } });
    if (url.pathname === `/v1/items/${pdfItemId}`) return json({ data: state.pdf });
    if (url.pathname.endsWith('/versions') && request.method() === 'GET') return json({ data: state.versions });
    if (url.pathname.endsWith('/versions') && request.method() === 'POST') { const input = request.postDataJSON(); const version = { ...input, itemId: pdfItemId, versionNumber: state.versions.length + 1, createdBy: userId, createdAt: now() }; state.versions.push(version); state.pdf = { ...state.pdf, currentVersionId: version.id, contentHash: version.contentHash }; return json({ data: version }, 201); }
    if (url.pathname.includes('/blobs/') && url.pathname.endsWith('/content')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: url.pathname.includes('fixture-pdf-v1') ? pdfPrevious : pdfCurrent });
    if (url.pathname.endsWith('/blobs/find')) return json({ data: { blobId: state.versions.find(version => version.contentHash === url.searchParams.get('hash'))?.blobId } });
    if (url.pathname.endsWith('/annotations')) return json({ data: state.annotations });
    if (url.pathname.endsWith('/annotation-mutations')) { if (state.failAnnotation) return json({ error: { code: 'VALIDATION_FAILED', message: '夹具同步暂时失败，请重试', retryable: false } }, 422); const input = request.postDataJSON(); state.annotations = [...state.annotations.filter(annotation => annotation.id !== input.annotation.id), input.annotation]; return json({ data: input.annotation }); }
    if (url.pathname.endsWith('/ai/providers')) return json({ data: { enabled: state.aiConfig.enabled, providers: state.aiConfig.providers.map(provider => ({ id: provider.id, label: provider.label, models: provider.models, maxOutputTokens: provider.maxOutputTokens })) } });
    if (url.pathname.endsWith('/ai/config')) {
      if (request.method() === 'PUT') {
        const input = request.postDataJSON();
        state.aiWrites.push({ hasKey: Object.hasOwn(input.provider, 'apiKey'), correctFixtureKey: input.provider.apiKey === secretTeamKey });
        const { apiKey: discardedKey, ...provider } = input.provider; void discardedKey;
        state.aiConfig = { enabled: input.enabled, maxRequestsPerDay: input.maxRequestsPerDay, monthlyBudgetUsdMicros: input.monthlyBudgetUsdMicros, maxOutputTokens: input.maxOutputTokens, providers: [{ ...provider, apiKeyConfigured: true }] };
      }
      return json({ data: state.aiConfig });
    }
    if (url.pathname.endsWith('/activity')) return json({ data: { events: [], nextCursor: null, hasMore: false } });
    if (url.pathname.endsWith('/integrations/github/status')) return json({ data: { configured: true, connected: false, requiresReauth: false } });
    unexpectedExternal.push(record); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const activate = locator => name === 'mobile' ? locator.tap() : locator.click();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const dialog = page.getByRole('dialog', { name: '共享库管理' });
  const code = () => dialog.getByLabel('验证码', { exact: true });
  const screenshot = async label => { const file = `${name}-${label}.png`; await page.screenshot({ path: path.join(output, file), fullPage: false }); screenshots.push(file); };
  const check = (label, condition) => { assert.ok(condition, label); checks.push(label); console.log(`[${name}] PASS ${checks.length}: ${label}`); };
  const openCloud = async () => {
    if (await visible(dialog)) return;
    const management = page.getByRole('button', { name: '共享库管理', exact: true });
    if (await visible(management)) await activate(management); else await activate(page.getByRole('button', { name: '共享库', exact: true }).first());
    await dialog.waitFor(timeout());
  };
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.getByRole('button', { name: '共享库', exact: true }).first().waitFor(timeout(180000));
    await page.getByRole('button', { name: '跳过', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '跳过', exact: true }))) await activate(page.getByRole('button', { name: '跳过', exact: true }));
    await openCloud();
    check('页面身份与可见内容', (await page.title()).includes('Lattice') && await visible(dialog));
    await activate(dialog.getByRole('button', { name: '创建账号', exact: true }));
    await dialog.getByLabel('云库邮箱', { exact: true }).fill('member@example.com');
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await dialog.getByLabel('确认密码', { exact: true }).fill('Fixture-mismatch-123!');
    await activate(dialog.getByRole('button', { name: '注册云库', exact: true }));
    await dialog.getByRole('alert').filter({ hasText: '不一致' }).waitFor();
    check('确认密码不一致阻止注册请求', count('/signup') === 0);
    await screenshot('registration-mismatch');
    await dialog.getByLabel('确认密码', { exact: true }).fill(secretPassword);
    await activate(dialog.getByRole('button', { name: '注册云库', exact: true }));
    await code().waitFor();
    check('注册单次请求进入八位OTP步骤', count('/signup') === 1 && await code().getAttribute('maxlength') === '8');
    await code().fill(secretCode);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
    await page.evaluate(() => { window.__cloudLifecycleEvents = []; for (const event of ['blur', 'focus']) window.addEventListener(event, () => window.__cloudLifecycleEvents.push({ event, visibility: document.visibilityState })); document.addEventListener('visibilitychange', () => window.__cloudLifecycleEvents.push({ event: 'visibilitychange', visibility: document.visibilityState })); });
    const otherContext = await browser.newContext();
    await otherContext.route('**/*', route => route.abort('blockedbyclient'));
    const otherWindow = await otherContext.newPage();
    await otherWindow.setContent('<title>Fixture other window</title><p>Switch test</p>');
    await otherWindow.bringToFront(); await new Promise(resolve => setTimeout(resolve, 350)); await page.bringToFront();
    await otherContext.close();
    await page.evaluate(() => { const original = document.visibilityState; Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { configurable: true, value: original }); document.dispatchEvent(new Event('visibilitychange')); });
    const lifecycle = await page.evaluate(() => window.__cloudLifecycleEvents);
    check('窗口失焦与恢复实际发生', lifecycle.some(event => event.event === 'blur') && lifecycle.some(event => event.event === 'focus'));
    check('visibilitychange回归事件发生', lifecycle.some(event => event.event === 'visibilitychange' && event.visibility === 'hidden'));
    check('切窗返回OTP及邮箱不丢失且无重发', await code().inputValue() === secretCode && (await dialog.getByTestId('cloud-confirmation-email').innerText()) === 'member@example.com' && count('/signup') === 1 && count('/resend') === 0);
    if (name === 'mobile') await page.touchscreen.tap(2, 2); else await page.mouse.click(2, 2);
    check('未登录时背景点击保留注册界面', await visible(dialog) && await code().inputValue() === secretCode);
    await activate(dialog.getByRole('button', { name: '关闭共享库管理', exact: true }));
    check('关闭按钮隐藏对话框', !(await visible(dialog)));
    await openCloud();
    check('关闭再打开保留OTP输入', await code().inputValue() === secretCode);
    await screenshot('otp-window-and-reopen');
    const stored = await page.evaluate(() => JSON.stringify({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
    check('密码和OTP未写入浏览器存储', !stored.includes(secretPassword) && !stored.includes(secretCode));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('cloud-connection-panel').waitFor({ state: 'attached', ...timeout() });
    await openCloud(); await code().waitFor();
    check('刷新恢复OTP步骤和邮箱且不重复注册', await code().inputValue() === '' && (await dialog.getByTestId('cloud-confirmation-email').innerText()) === 'member@example.com' && count('/signup') === 1);
    await code().fill(secretCode);
    for (const mode of ['expired', 'limited', 'server']) {
      state.verify = mode; const previous = count('/verify');
      await activate(dialog.getByRole('button', { name: '验证并登录', exact: true }));
      await poll(async () => count('/verify') > previous && !(await code().isDisabled()), `OTP ${mode} response not reflected`);
      check(`OTP ${mode}错误保留可编辑输入`, await code().inputValue() === secretCode && await visible(dialog.getByRole('alert')));
    }
    const cooldown = dialog.getByRole('button', { name: /\d+ 秒后可重发/ });
    check('重发冷却期间禁用', await cooldown.isDisabled());
    await page.clock.setFixedTime(new Date(Date.now() + 61_000));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await dialog.getByRole('button', { name: '重新发送确认邮件', exact: true }).waitFor();
    state.resend = 'limited'; await activate(dialog.getByRole('button', { name: '重新发送确认邮件', exact: true }));
    await poll(async () => count('/resend') === 1 && !(await code().isDisabled()), 'failed resend incomplete');
    check('重发失败保留旧验证码', await code().inputValue() === secretCode);
    state.resend = 'ok'; await activate(dialog.getByRole('button', { name: '重新发送确认邮件', exact: true }));
    await poll(async () => count('/resend') === 2 && await code().inputValue() === '', 'successful resend incomplete');
    await cooldown.waitFor();
    check('重发成功清码并重新冷却', await cooldown.isDisabled());
    await screenshot('otp-resend');
    state.verify = 'ok'; state.failLibraries = true; await code().fill(secretCode);
    await activate(dialog.getByRole('button', { name: '验证并登录', exact: true }));
    await dialog.getByLabel('云库密码', { exact: true }).waitFor();
    await dialog.getByRole('alert').filter({ hasText: '邮箱已验证' }).waitFor();
    check('已消费OTP后的云连接失败转密码登录', !(await visible(code())) && await dialog.getByLabel('云库邮箱', { exact: true }).inputValue() === 'member@example.com');
    await screenshot('verified-cloud-failure-recovery');
    const verifiedRequests = count('/verify');
    const loginErrorCopy = { invalid: '检查邮箱和密码', limited: '登录请求较多', server: '账号服务暂不可用', network: '检查网络后重试' };
    for (const mode of ['invalid', 'limited', 'server', 'network']) {
      const previous = count('/token');
      state.token = mode; await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
      await activate(dialog.getByRole('button', { name: '登录云库', exact: true }));
      await poll(async () => count('/token') > previous && !(await dialog.getByLabel('云库密码', { exact: true }).isDisabled()) && await visible(dialog.getByRole('alert').filter({ hasText: loginErrorCopy[mode] })), `login ${mode} incomplete`);
      check(`登录 ${mode}错误可恢复`, await visible(dialog.getByLabel('云库密码', { exact: true })));
    }
    state.token = 'ok'; state.failLibraries = false;
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await activate(dialog.getByRole('button', { name: '登录云库', exact: true }));
    await dialog.getByRole('heading', { name: '还没有云端库', exact: true }).waitFor();
    check('密码登录恢复并显示首库创建加入GitHub入口', count('/verify') === verifiedRequests && await visible(dialog.getByRole('button', { name: '新建空库', exact: true })) && await visible(dialog.getByRole('button', { name: '加入邀请', exact: true })) && await visible(dialog.getByRole('button', { name: '从 GitHub 创建云库', exact: true })));
    await screenshot('first-library-entry');
    await activate(dialog.getByRole('button', { name: '加入邀请', exact: true }));
    await dialog.getByLabel('云库邀请链接或配置', { exact: true }).waitFor();
    check('首库加入邀请控件已接线', await visible(dialog.getByLabel('云库邀请链接或配置', { exact: true })));
    await activate(dialog.getByRole('button', { name: '新建空库', exact: true }));
    await dialog.getByLabel('新建名称', { exact: true }).fill(library.name);
    await activate(dialog.getByRole('button', { name: '创建', exact: true }));
    await poll(async () => count('/members/me') > 0 && await visible(dialog.getByRole('button', { name: '小组成员', exact: true })), 'library selection incomplete');
    check('新建首库经真实UI调用协议并选择', state.libraries.length === 1 && requests.some(request => request.path === '/v1/libraries' && request.method === 'POST'));
    await activate(dialog.getByRole('button', { name: '成员与共享', exact: true }));
    await dialog.getByTestId('member-management').waitFor();
    check('成员入口显示角色与管理员操作', (await dialog.getByTestId('member-row').count()) === 2 && await visible(dialog.getByTestId('member-invite-form')));
    await activate(dialog.getByRole('button', { name: '团队 AI', exact: true }));
    await dialog.getByRole('button', { name: '添加团队模型', exact: true }).waitFor();
    await activate(dialog.getByRole('button', { name: '添加团队模型', exact: true }));
    check('团队AI管理员配置入口可操作', await visible(dialog.getByLabel('团队 API Key', { exact: true })));
    await dialog.getByLabel('模型名称', { exact: true }).fill('合成团队模型');
    await dialog.getByLabel('兼容 API 地址', { exact: true }).fill('https://ai.fixture.invalid/v1');
    await dialog.getByLabel('模型 ID', { exact: true }).fill('fixture-model');
    await dialog.getByLabel('团队 API Key', { exact: true }).fill(secretTeamKey);
    await activate(dialog.getByRole('checkbox', { name: '启用本库团队 AI', exact: true }));
    await activate(dialog.getByRole('button', { name: '保存团队模型', exact: true }));
    await dialog.getByRole('status').filter({ hasText: '团队模型已保存' }).waitFor();
    check('团队AI配置经真实表单保存且仅写合成Key', state.aiWrites.length === 1 && state.aiWrites[0].correctFixtureKey && state.aiConfig.enabled && state.aiConfig.providers[0].apiKeyConfigured);
    await activate(dialog.getByRole('button', { name: '编辑 合成团队模型', exact: true }));
    check('重新编辑团队模型不回显密钥', await dialog.getByLabel('团队 API Key', { exact: true }).inputValue() === '');
    await dialog.getByLabel('模型名称', { exact: true }).fill('合成团队模型更新');
    await activate(dialog.getByRole('button', { name: '保存团队模型', exact: true }));
    await dialog.getByRole('button', { name: '编辑 合成团队模型更新', exact: true }).waitFor();
    const aiStored = await page.evaluate(() => JSON.stringify({ local: Object.fromEntries(Object.entries(localStorage)), session: Object.fromEntries(Object.entries(sessionStorage)) }));
    check('更新团队模型留空Key且浏览器存储无原Key', state.aiWrites.length === 2 && !state.aiWrites[1].hasKey && !aiStored.includes(secretTeamKey) && !(await dialog.innerHTML()).includes(secretTeamKey));
    await activate(dialog.getByRole('button', { name: 'GitHub 仓库', exact: true }));
    await dialog.getByRole('button', { name: '连接 GitHub', exact: true }).waitFor();
    check('GitHub入口请求产品用户授权', (await dialog.locator('input[type="password"]').count()) === 0);
    await activate(dialog.getByRole('button', { name: '协作记录', exact: true }));
    await dialog.getByTestId('cloud-activity-history').waitFor();
    await poll(async () => requests.some(request => request.path.endsWith('/activity')), 'activity entry did not request its feed');
    check('协作记录真实入口与加载协议', requests.some(request => request.path.endsWith('/activity')));
    await screenshot('collaboration-entry');
    const bounds = await dialog.boundingBox();
    check('对话框处于视口且无水平溢出', bounds && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width + 1 && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (!(await visible(dialog.getByLabel('云库邀请链接或配置', { exact: true })))) await activate(dialog.getByRole('button', { name: '加入其他云库', exact: true }));
    const invite = JSON.stringify({ name: '合成邀请云服务', apiUrl: 'https://api.example.com', supabaseUrl: 'https://project.supabase.co', publicKey: 'sb_publishable_fixture', libraryId: invitedLibraryId, inviteToken: 'fixture-invitation-token' });
    await dialog.getByLabel('云库邀请链接或配置', { exact: true }).fill(invite);
    await activate(dialog.getByRole('button', { name: '解析并连接', exact: true }));
    await dialog.getByLabel('云库邮箱', { exact: true }).waitFor();
    await dialog.getByLabel('云库邮箱', { exact: true }).fill('member@example.com');
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await activate(dialog.getByRole('button', { name: '登录云库', exact: true }));
    await poll(async () => state.inviteJoined && await visible(dialog.getByRole('button', { name: '小组成员', exact: true })), 'invite acceptance did not select shared library');
    check('产品邀请解析登录接收并选择协作库', state.inviteJoined && requests.some(request => request.path === '/v1/invitations/accept'));
    await activate(dialog.getByRole('button', { name: '关闭共享库管理', exact: true }));
    await page.getByRole('button', { name: '继续使用网页版', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '继续使用网页版', exact: true }))) await activate(page.getByRole('button', { name: '继续使用网页版', exact: true }));
    const pdfTreeNode = page.locator(`[data-source-node-id="${pdfItemId}"]`);
    if (name === 'mobile' && !(await visible(pdfTreeNode))) await activate(page.getByRole('button', { name: 'Open sidebar', exact: true }));
    await pdfTreeNode.waitFor(timeout()); await activate(pdfTreeNode);
    if (name === 'mobile' && await visible(page.getByRole('button', { name: 'Close sidebar', exact: true }))) await activate(page.getByRole('button', { name: 'Close sidebar', exact: true }));
    const pdfPane = page.locator('[data-testid^="pdf-pane-"]').first();
    await pdfPane.waitFor(timeout(90000));
    const pdfCanvas = pdfPane.locator('.react-pdf__Page canvas').first();
    await pdfCanvas.waitFor(timeout(90000));
    await poll(async () => await pdfCanvas.evaluate(canvas => canvas.width > 0 && canvas.height > 0), 'PDF canvas was not rendered');
    check('邀请库合成PDF通过文件树打开并渲染', await visible(pdfCanvas));
    const visibilitySummary = pdfPane.locator('summary').filter({ hasText: '批注显示' });
    await activate(visibilitySummary);
    const scope = pdfPane.getByRole('combobox', { name: '批注范围', exact: true });
    await scope.selectOption('others');
    await poll(async () => !(await visible(pdfPane.locator('[data-pdf-stored-annotation-id="fixture-owner-pin"]'))) && await visible(pdfPane.locator('[data-pdf-stored-annotation-id="fixture-member-pin"]')), 'author-only-others filter failed');
    check('共同作者批注存在且仅他人筛选隐藏自己', true);
    await scope.selectOption('all');
    await activate(pdfPane.getByRole('checkbox', { name: '夹具只读成员', exact: true }));
    await poll(async () => !(await visible(pdfPane.locator('[data-pdf-stored-annotation-id="fixture-member-pin"]'))) && await visible(pdfPane.locator('[data-pdf-stored-annotation-id="fixture-owner-pin"]')), 'per-member annotation filter failed');
    check('按成员筛选只改变当前PDF视图', state.annotations.length === 2);
    await activate(pdfPane.getByRole('checkbox', { name: '夹具只读成员', exact: true }));
    await activate(visibilitySummary);
    state.failAnnotation = true;
    if (name === 'mobile') {
      await activate(page.getByRole('button', { name: '更多操作', exact: true }));
      await activate(page.getByRole('menuitem', { name: '便签', exact: true }));
    }
    else {
      let noteButton = page.getByRole('button', { name: '便签', exact: true });
      if (!(await visible(noteButton))) { await activate(page.getByRole('button', { name: '更多操作', exact: true })); noteButton = page.getByRole('button', { name: '便签', exact: true }); }
      await activate(noteButton);
    }
    const canvasBounds = await pdfCanvas.boundingBox();
    assert.ok(canvasBounds, 'PDF canvas layout missing');
    const noteX = canvasBounds.x + canvasBounds.width * .65;
    const noteY = Math.min(canvasBounds.y + canvasBounds.height * .35, viewport.height - 100);
    if (name === 'mobile') await page.touchscreen.tap(noteX, noteY); else await page.mouse.click(noteX, noteY);
    await page.getByPlaceholder('输入笔记内容...', { exact: true }).waitFor();
    await page.getByPlaceholder('输入笔记内容...', { exact: true }).fill('浏览器新增共同批注');
    await activate(page.getByRole('button', { name: '保存', exact: true }));
    await poll(async () => requests.some(request => request.path.endsWith('/annotation-mutations')), 'PDF note did not invoke cloud mutation');
    await page.getByTestId('cloud-collaboration-toolbar').getByRole('button', { name: '同步待处理', exact: true }).waitFor();
    await activate(page.getByTestId('cloud-collaboration-toolbar').getByRole('button', { name: '同步待处理', exact: true }));
    await dialog.waitFor();
    await activate(dialog.locator('summary').filter({ hasText: '同步任务' }));
    await dialog.getByRole('button', { name: '重试同步', exact: true }).waitFor();
    check('共同批注失败保留本地内容并提供重试', await visible(dialog.getByText('夹具同步暂时失败，请重试', { exact: false }).first()));
    state.failAnnotation = false;
    await activate(dialog.getByRole('button', { name: '重试同步', exact: true }));
    await poll(async () => state.annotations.some(annotation => annotation.body.comment === '浏览器新增共同批注') && !(await visible(dialog.getByRole('button', { name: '重试同步', exact: true }))), 'PDF note retry did not finish');
    check('同步重试完成且保留作者归属', state.annotations.find(annotation => annotation.body.comment === '浏览器新增共同批注')?.authorId === userId);
    await activate(dialog.getByRole('button', { name: '关闭共享库管理', exact: true }));
    await screenshot('pdf-shared-annotations');
    await activate(page.getByTestId('cloud-collaboration-toolbar').getByRole('button', { name: '版本历史', exact: true }));
    const history = page.getByTestId('cloud-version-history');
    await history.waitFor();
    await activate(history.getByRole('button', { name: /^v1\s/ }));
    await history.getByText('此版本是二进制文件，可下载原文件查看。', { exact: true }).waitFor();
    check('历史版本显示作者并可读取真实PDF旧字节', requests.some(request => request.path.includes('fixture-pdf-v1/content')));
    await activate(history.getByRole('button', { name: '恢复此版本', exact: true }));
    await activate(history.getByRole('button', { name: '恢复为新版本', exact: true }));
    await poll(async () => state.versions.length === 3, 'restore did not create a new remote version');
    const restored = state.versions.at(-1);
    check('恢复历史创建新版本且保留原历史', restored.manifest.restoredFromVersionId === pdfVersions[0].id && restored.contentHash === sha(pdfPrevious) && state.versions[0].id === pdfVersions[0].id && state.versions[1].id === pdfVersions[1].id);
    await pdfCanvas.waitFor(timeout(90000));
    await poll(async () => await pdfCanvas.evaluate(canvas => canvas.width > 0 && canvas.height > 0), 'restored PDF did not finish rendering');
    check('恢复后的PDF重新渲染可读', await visible(pdfCanvas));
    await screenshot('pdf-version-restored');
    if (await visible(history)) await activate(history.getByRole('button', { name: '关闭历史', exact: true }));
    await activate(page.getByTestId('cloud-collaboration-toolbar').getByRole('button', { name: '共享与成员', exact: true }));
    await dialog.waitFor();
    await activate(dialog.getByRole('button', { name: '退出', exact: true }));
    await dialog.getByLabel('云库邮箱', { exact: true }).waitFor();
    check('登出回登录且会话清除', !(await visible(dialog.getByRole('button', { name: '退出', exact: true }))));
    state.token = 'unconfirmed';
    await dialog.getByLabel('云库邮箱', { exact: true }).fill('member@example.com');
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await activate(dialog.getByRole('button', { name: '登录云库', exact: true }));
    await code().waitFor();
    check('尚未确认账号登录进入验证码恢复', await visible(dialog.getByRole('alert').filter({ hasText: '邮箱尚未确认' })));
    await activate(dialog.getByRole('button', { name: '返回登录', exact: true }));
    await activate(dialog.getByRole('button', { name: '忘记密码？', exact: true }));
    await activate(dialog.getByRole('button', { name: '发送重置邮件', exact: true }));
    await dialog.getByRole('status').filter({ hasText: '重置邮件' }).waitFor();
    check('找回密码通过显式产品入口请求合成重置', count('/recover') === 1);
    await activate(dialog.getByRole('button', { name: '返回登录', exact: true }));
    await activate(dialog.getByRole('button', { name: '创建账号', exact: true }));
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await dialog.getByLabel('确认密码', { exact: true }).fill(secretPassword);
    const signupErrorCopy = { duplicate: '此邮箱已注册', limited: '注册请求较多', server: '注册邮件暂时无法发送', network: '检查网络后重试' };
    for (const mode of ['duplicate', 'limited', 'server', 'network']) {
      state.signup = mode; const previous = count('/signup');
      await activate(dialog.getByRole('button', { name: '注册云库', exact: true }));
      await dialog.getByRole('alert').filter({ hasText: signupErrorCopy[mode] }).waitFor();
      check(`注册 ${mode}错误明确且表单可纠正`, count('/signup') === previous + 1 && await dialog.getByLabel('云库邮箱', { exact: true }).inputValue() === 'member@example.com' && !(await dialog.getByLabel('云库密码', { exact: true }).isDisabled()) && !(await visible(code())));
    }
    check('无未捕获应用异常', pageErrors.length === 0);
    check('全部外部HTTP已拦截且无未建模请求', unexpectedExternal.length === 0);
    return { name, viewport, passed: true, annotationInput: name === 'mobile' ? 'touch: 更多操作 -> 便签 -> PDF tap' : 'visible product note tool', checks, lifecycle, requests, unexpectedExternal, pageErrors, consoleErrors, screenshots };
  } catch (error) {
    await screenshot('failure').catch(() => {});
    return { name, viewport, passed: false, error: error.stack || String(error), checks, requests, unexpectedExternal, pageErrors, consoleErrors, screenshots };
  } finally { await context.close(); }
}
async function runViewerProfile(name, viewport) {
  const mobile = name === 'mobile';
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const requests = [], deniedWrites = [], unexpectedExternal = [], pageErrors = [], checks = [], screenshots = [];
  const viewer = { ...member, libraryId: invitedLibraryId, role: 'viewer' };
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL).host) socket.connectToServer();
    else { unexpectedExternal.push({ method: 'WEBSOCKET', path: url.pathname }); socket.close(); }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseURL) return route.continue();
    url.pathname = url.pathname.replace(/^\/functions\/v1\/shared-library-api(?=\/v1\/)/, '');
    const record = { method: request.method(), path: url.pathname };
    requests.push(record);
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/auth/v1/token') return json({ access_token: 'fixture-viewer-access', refresh_token: 'fixture-viewer-refresh', expires_in: 3600, user: { id: userId } });
    if (url.pathname.startsWith('/v1/') && request.method() !== 'GET') {
      deniedWrites.push({ ...record, status: 403 });
      return json({ error: { code: 'FORBIDDEN', message: '只读成员不能写入', retryable: false } }, 403);
    }
    if (url.pathname === '/v1/libraries') return json({ data: [invitedLibrary] });
    if (url.pathname.endsWith('/members/me')) return json({ data: viewer });
    if (url.pathname.endsWith('/members')) return json({ data: [viewer, { ...member, libraryId: invitedLibraryId, userId: 'fixture-owner', displayName: '夹具拥有者' }] });
    if (url.pathname.endsWith('/changes')) return json({ data: { changes: url.searchParams.get('cursor') === '0' ? [{ sequence: '1', type: 'item', value: pdfItem }] : [], cursor: '1', hasMore: false } });
    if (url.pathname === `/v1/items/${pdfItemId}`) return json({ data: pdfItem });
    if (url.pathname.endsWith('/versions')) return json({ data: pdfVersions });
    if (url.pathname.includes('/blobs/') && url.pathname.endsWith('/content')) return route.fulfill({ status: 200, contentType: 'application/pdf', body: url.pathname.includes('fixture-pdf-v1') ? pdfPrevious : pdfCurrent });
    if (url.pathname.endsWith('/annotations')) return json({ data: initialAnnotations });
    if (url.pathname.endsWith('/ai/providers')) return json({ data: { enabled: false, providers: [] } });
    if (url.pathname.endsWith('/ai/config') || url.pathname.endsWith('/invitations')) { unexpectedExternal.push(record); return json({ error: { code: 'FORBIDDEN', message: '只读成员不能读取管理员设置', retryable: false } }, 403); }
    unexpectedExternal.push(record); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const activate = locator => mobile ? locator.tap() : locator.click();
  const dialog = page.getByRole('dialog', { name: '共享库管理' });
  const check = (label, condition) => { assert.ok(condition, label); checks.push(label); console.log(`[viewer-${name}] PASS ${checks.length}: ${label}`); };
  const screenshot = async label => { const file = `viewer-${name}-${label}.png`; await page.screenshot({ path: path.join(output, file), fullPage: false }); screenshots.push(file); };
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.getByRole('button', { name: '共享库', exact: true }).first().waitFor(timeout(180000));
    await page.getByRole('button', { name: '跳过', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '跳过', exact: true }))) await activate(page.getByRole('button', { name: '跳过', exact: true }));
    await activate(page.getByRole('button', { name: '共享库', exact: true }).first());
    await dialog.getByLabel('云库邮箱', { exact: true }).fill('viewer@example.com');
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await activate(dialog.getByRole('button', { name: '登录云库', exact: true }));
    await dialog.getByRole('button', { name: '小组成员', exact: true }).waitFor();
    check('独立只读身份通过产品登录并选择云库', requests.some(request => request.path.endsWith('/members/me')));
    await activate(dialog.getByRole('button', { name: '成员与共享', exact: true }));
    await dialog.getByTestId('member-management').waitFor();
    check('只读成员可查看成员与角色', (await dialog.getByTestId('member-row').count()) === 2);
    check('只读成员没有邀请或改角色入口', !(await visible(dialog.getByTestId('member-invite-form'))) && (await dialog.getByTestId('member-management').getByRole('combobox').count()) === 0 && !(await visible(dialog.getByRole('button', { name: '暂停访问', exact: true }))));
    await activate(dialog.getByRole('button', { name: '团队 AI', exact: true }));
    await dialog.getByRole('status').filter({ hasText: '管理员尚未配置团队 AI' }).waitFor();
    check('只读成员没有团队AI密钥管理入口', !(await visible(dialog.getByRole('button', { name: '添加团队模型', exact: true }))) && (await dialog.getByLabel('团队 API Key', { exact: true }).count()) === 0 && !requests.some(request => request.path.endsWith('/ai/config')));
    await activate(dialog.getByRole('button', { name: '关闭共享库管理', exact: true }));
    await page.getByRole('button', { name: '继续使用网页版', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '继续使用网页版', exact: true }))) await activate(page.getByRole('button', { name: '继续使用网页版', exact: true }));
    const pdfTreeNode = page.locator(`[data-source-node-id="${pdfItemId}"]`);
    if (mobile && !(await visible(pdfTreeNode))) await activate(page.getByRole('button', { name: 'Open sidebar', exact: true }));
    await pdfTreeNode.waitFor(timeout()); await activate(pdfTreeNode);
    if (mobile && await visible(page.getByRole('button', { name: 'Close sidebar', exact: true }))) await activate(page.getByRole('button', { name: 'Close sidebar', exact: true }));
    const pdfCanvas = page.locator('[data-testid^="pdf-pane-"]').first().locator('.react-pdf__Page canvas').first();
    await pdfCanvas.waitFor(timeout(90000));
    check('只读成员可阅读共享PDF', await visible(pdfCanvas));
    if (mobile) {
      await activate(page.getByRole('button', { name: '更多操作', exact: true }));
      await page.getByRole('menuitem', { name: '便签', exact: true }).waitFor();
      check('只读成员触屏便签菜单禁用', await page.getByRole('menuitem', { name: '便签', exact: true }).isDisabled());
      await page.touchscreen.tap(4, viewport.height - 5);
    }
    await activate(page.getByTestId('cloud-collaboration-toolbar').getByRole('button', { name: '版本历史', exact: true }));
    const history = page.getByTestId('cloud-version-history');
    await history.getByRole('button', { name: /^v1\s/ }).waitFor();
    await activate(history.getByRole('button', { name: /^v1\s/ }));
    await history.getByText('当前角色可查看历史，恢复需要编辑权限。', { exact: true }).waitFor();
    check('只读成员可查历史且无版本恢复入口', !(await visible(history.getByRole('button', { name: '恢复此版本', exact: true }))) && !(await visible(history.getByRole('button', { name: '恢复为新版本', exact: true }))));
    await screenshot('permissions');
    check('只读权限未发出任何写请求', deniedWrites.length === 0);
    check('只读场景无异常或未建模外部请求', pageErrors.length === 0 && unexpectedExternal.length === 0);
    return { name, viewport, role: 'viewer', passed: true, checks, requests, deniedWrites, pageErrors, unexpectedExternal, screenshots };
  } catch (error) {
    await screenshot('failure').catch(() => {});
    return { name, viewport, role: 'viewer', passed: false, error: error.stack || String(error), checks, requests, deniedWrites, pageErrors, unexpectedExternal, screenshots };
  } finally { await context.close(); }
}
async function runGitHubProfile(name, viewport) {
  const mobile = name === 'mobile';
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  const oauthState = 'public-fixture-oauth-state';
  const authorizationUrl = `https://github.com/login/oauth/authorize?client_id=fixture&state=${oauthState}`;
  const text = '# GitHub fixture\n\nImported from synthetic GitHub fixture.\n';
  const sourceHash = 'a'.repeat(40), contentHash = sha(Buffer.from(text));
  const repository = { id: 88, installationId: 77, owner: 'fixture', name: 'notes', fullName: 'fixture/notes', private: true, defaultBranch: 'main', permissions: { push: true, maintain: false, admin: false } };
  const state = { authorized: false, claimed: false, connection: null, returnTo: `${baseURL}/`, items: [], versions: [], sequence: 0, needsSectionRefresh: false };
  const requests = [], unexpectedExternal = [], pageErrors = [], checks = [], screenshots = [];
  const status = () => ({ configured: true, connected: state.authorized, requiresReauth: false, ...(state.authorized ? { login: 'fixture-github', githubUserId: 88 } : {}) });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(baseURL).host) socket.connectToServer();
    else { unexpectedExternal.push({ method: 'WEBSOCKET', path: url.pathname }); socket.close(); }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === baseURL) return route.continue();
    if (request.url() === authorizationUrl) {
      if (githubAuthorizationDelayMs > 0) await new Promise(resolve => setTimeout(resolve, githubAuthorizationDelayMs));
      state.authorized = true;
      const returned = new URL(state.returnTo); returned.searchParams.set('github_state', oauthState);
      return route.fulfill({ status: 302, headers: { location: returned.toString() }, body: '' });
    }
    url.pathname = url.pathname.replace(/^\/functions\/v1\/shared-library-api(?=\/v1\/)/, '');
    const record = { method: request.method(), path: url.pathname }; requests.push(record);
    const json = (data, statusCode = 200) => route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname === '/auth/v1/token') return json({ access_token: 'fixture-github-access', refresh_token: 'fixture-github-refresh', expires_in: 3600, user: { id: userId } });
    if (url.pathname === '/v1/libraries') return json({ data: [library] });
    if (url.pathname.endsWith('/members/me')) return json({ data: member });
    if (url.pathname.endsWith('/changes')) return json({ data: { changes: Number(url.searchParams.get('cursor') || '0') < state.sequence ? state.items.map(item => ({ sequence: String(state.sequence), type: 'item', value: item })) : [], cursor: String(state.sequence), hasMore: false } });
    if (url.pathname === '/v1/integrations/github/status') return json({ data: status() });
    if (url.pathname === '/v1/integrations/github/authorize') {
      const input = request.postDataJSON(); state.returnTo = input.returnTo;
      return json({ data: { authorizationUrl, redirectUri: `${baseURL}/`, expiresAt: new Date(Date.now() + 600_000).toISOString(), returnTo: state.returnTo, flow: 'server' } });
    }
    if (url.pathname === '/v1/integrations/github/claim') {
      const input = request.postDataJSON();
      assert.equal(input.state, oauthState);
      if (!state.authorized) return json({ data: { pending: true } });
      state.claimed = true; return json({ data: status() });
    }
    if (url.pathname === '/v1/integrations/github/repositories') return json({ data: [repository] });
    if (url.pathname === `/v1/libraries/${libraryId}/github`) {
      if (request.method() === 'POST') {
        const input = request.postDataJSON(); assert.equal(input.repositoryId, repository.id); assert.equal(input.installationId, repository.installationId);
        state.connection = { id: 'fixture-github-connection', libraryId, repositoryId: repository.id, installationId: repository.installationId, owner: repository.owner, name: repository.name, fullName: repository.fullName, branch: 'main', private: true, connectedAt: now(), lastSyncedAt: now(), stale: false };
      }
      return json({ data: state.connection });
    }
    if (url.pathname.endsWith('/github/tree')) return json({ data: { branch: 'main', sha: sourceHash, entries: [{ path: 'fixture-import.md', sha: sourceHash, size: Buffer.byteLength(text), type: 'blob' }] } });
    if (url.pathname.endsWith('/github/file')) return json({ data: { path: 'fixture-import.md', sha: sourceHash, content: Buffer.from(text).toString('base64'), encoding: 'base64', size: Buffer.byteLength(text), branch: 'main', repositoryId: repository.id } });
    if (url.pathname === `/v1/libraries/${libraryId}/items` && request.method() === 'POST') { const item = request.postDataJSON(); state.items.push(item); state.sequence++; return json({ data: item }, 201); }
    if (url.pathname.endsWith('/blobs/find')) { assert.equal(url.searchParams.get('hash'), contentHash); return json({ data: { blobId: 'github-fixture-blob' } }); }
    const itemMatch = url.pathname.match(/^\/v1\/items\/([^/]+)(?:\/(versions|index-text))?$/);
    if (itemMatch) {
      const id = itemMatch[1], suffix = itemMatch[2], item = state.items.find(candidate => candidate.id === id);
      assert.ok(item, 'GitHub import requested an unknown item');
      if (!suffix) return json({ data: item });
      if (suffix === 'index-text') return json({ data: {} });
      if (request.method() === 'POST') { const input = request.postDataJSON(); assert.equal(input.contentHash, contentHash); const version = { ...input, itemId: id, versionNumber: 1, createdBy: userId, createdAt: now() }; state.versions.push(version); item.currentVersionId = version.id; item.contentHash = version.contentHash; state.sequence++; return json({ data: version }, 201); }
      return json({ data: state.versions.filter(version => version.itemId === id) });
    }
    if (url.pathname.endsWith('/blobs/github-fixture-blob/content')) return route.fulfill({ status: 200, contentType: 'text/markdown', body: text });
    unexpectedExternal.push(record); return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  const activate = locator => mobile ? locator.tap() : locator.click();
  const dialog = page.getByRole('dialog', { name: '共享库管理' });
  const check = (label, condition) => { assert.ok(condition, label); checks.push(label); console.log(`[github-${name}] PASS ${checks.length}: ${label}`); };
  const screenshot = async label => { const file = `github-${name}-${label}.png`; await page.screenshot({ path: path.join(output, file), fullPage: false }); screenshots.push(file); };
  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.getByRole('button', { name: '共享库', exact: true }).first().waitFor(timeout(180000));
    await page.getByRole('button', { name: '跳过', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '跳过', exact: true }))) await activate(page.getByRole('button', { name: '跳过', exact: true }));
    await activate(page.getByRole('button', { name: '共享库', exact: true }).first());
    await dialog.getByLabel('云库邮箱', { exact: true }).fill('github-user@example.com');
    await dialog.getByLabel('云库密码', { exact: true }).fill(secretPassword);
    await activate(dialog.getByRole('button', { name: '登录云库', exact: true }));
    await dialog.getByRole('button', { name: '小组成员', exact: true }).waitFor();
    await activate(dialog.getByRole('button', { name: 'GitHub 仓库', exact: true }));
    await page.evaluate(() => { window.__githubBeforeAuthorization = true; });
    await activate(dialog.getByRole('button', { name: '连接 GitHub', exact: true }));
    await page.waitForFunction(() => window.__githubBeforeAuthorization !== true, null, timeout(60000));
    await poll(async () => state.authorized && state.claimed, 'synthetic OAuth callback was not claimed');
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('github_state'), null, timeout(60000));
    await page.getByRole('button', { name: '继续使用网页版', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '继续使用网页版', exact: true }))) await activate(page.getByRole('button', { name: '继续使用网页版', exact: true }));
    await dialog.waitFor(timeout());
    const cleaned = await page.evaluate(() => ({ url: location.href, attempt: sessionStorage.getItem('lattice-github-oauth-attempt-v1'), returned: sessionStorage.getItem('lattice-github-oauth-return-v1') }));
    check('GitHub授权跳转合成返回并清理回调状态', state.claimed && !new URL(cleaned.url).searchParams.has('github_state') && cleaned.attempt === null && cleaned.returned === null);
    const repositoriesButton = dialog.getByRole('button', { name: '选择授权仓库', exact: true });
    if (!(await visible(repositoriesButton))) {
      await activate(dialog.getByRole('button', { name: '成员与共享', exact: true }));
      await activate(dialog.getByRole('button', { name: 'GitHub 仓库', exact: true }));
      state.needsSectionRefresh = true;
    }
    await repositoriesButton.waitFor();
    check('授权返回显示产品用户的已连接GitHub身份', await visible(dialog.getByText('fixture-github', { exact: true })));
    await activate(repositoriesButton);
    await dialog.getByRole('combobox', { name: 'GitHub 授权仓库', exact: true }).selectOption(String(repository.id));
    await activate(dialog.getByRole('button', { name: '关联当前云库', exact: true }));
    await dialog.getByRole('button', { name: '浏览仓库文件', exact: true }).waitFor();
    check('授权仓库通过产品界面关联当前库', state.connection?.repositoryId === repository.id);
    await activate(dialog.getByRole('button', { name: '浏览仓库文件', exact: true }));
    await dialog.getByRole('combobox', { name: 'GitHub 仓库文件', exact: true }).selectOption('fixture-import.md');
    await activate(dialog.getByRole('button', { name: '导入所选文件', exact: true }));
    await dialog.getByRole('status').filter({ hasText: '文件已导入云库并同步' }).waitFor();
    check('GitHub合成文件经过真实云库队列导入同步', state.items.length === 1 && state.versions.length === 1 && state.items[0].metadata.github.sha === sourceHash && state.versions[0].contentHash === contentHash);
    await screenshot('imported');
    await activate(dialog.getByRole('button', { name: '关闭共享库管理', exact: true }));
    await page.getByRole('button', { name: '继续使用网页版', exact: true }).waitFor({ timeout: 2500 }).catch(() => {});
    if (await visible(page.getByRole('button', { name: '继续使用网页版', exact: true }))) await activate(page.getByRole('button', { name: '继续使用网页版', exact: true }));
    const node = page.locator(`[data-source-node-id="${state.items[0].id}"]`);
    if (mobile && !(await visible(node))) await activate(page.getByRole('button', { name: 'Open sidebar', exact: true }));
    await node.waitFor(timeout()); await activate(node);
    if (mobile && await visible(page.getByRole('button', { name: 'Close sidebar', exact: true }))) await activate(page.getByRole('button', { name: 'Close sidebar', exact: true }));
    await poll(async () => (await page.locator('body').innerText()).includes('Imported from synthetic GitHub fixture.'), 'imported Markdown content not visible');
    check('导入的Markdown可从文件树打开阅读', true);
    await screenshot('readable');
    check('GitHub场景无异常或未建模外部请求', pageErrors.length === 0 && unexpectedExternal.length === 0);
    return { name, viewport, passed: true, checks, needsSectionRefresh: state.needsSectionRefresh, requests, pageErrors, unexpectedExternal, screenshots };
  } catch (error) { await screenshot('failure').catch(() => {}); return { name, viewport, passed: false, error: error.stack || String(error), checks, needsSectionRefresh: state.needsSectionRefresh, requests, pageErrors, unexpectedExternal, screenshots }; }
  finally { await context.close(); }
}
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    if (suite === 'all' || suite === 'owner') results.push(await runViewport(name, viewport));
    if (suite === 'all' || suite === 'viewer') viewerResults.push(await runViewerProfile(name, viewport));
    if (suite === 'all' || suite === 'github') githubResults.push(await runGitHubProfile(name, viewport));
  }
} finally { await browser.close(); }
const summary = { baseURL, suite, githubAuthorizationDelayMs, browserPlugin: 'not available; Playwright fallback', networkPolicy: 'All non-local HTTP intercepted with synthetic auth/API responses or aborted', realOtpEmailSent: false, results, viewerResults, githubResults };
assert.ok(!JSON.stringify(summary).includes(secretPassword) && !JSON.stringify(summary).includes(secretCode) && !JSON.stringify(summary).includes(secretTeamKey), 'Acceptance report must never contain fixture passwords, OTPs, or API keys');
await writeFile(path.join(output, 'cloud-account-acceptance-result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
if ([...results, ...viewerResults, ...githubResults].some(result => !result.passed)) process.exitCode = 1;

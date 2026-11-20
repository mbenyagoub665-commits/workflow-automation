// Shared helpers for the suites: the runtime with a local test key, a small
// HTTP API the HTTP request step calls, and UI steps taken from real markup.
import http from 'node:http';
import os from 'node:os';
import { startRuntime, expect } from '/home/user/oss-new/control/runtime/index.mjs';

export { expect };
export const API_TOKEN = 'tok-local-test-only-7731';

export async function start() {
  return startRuntime({
    bindings: { CREDENTIALS_KEY: { type: 'text', value: 'local-test-key-not-a-real-secret-0000' } },
  });
}

/** A local API on a private (non-loopback) address. /orders needs the bearer token. */
export async function startApi() {
  let flakyCalls = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/orders') {
      if (req.headers.authorization !== `Bearer ${API_TOKEN}`) return send(401, { error: 'unauthorized' });
      return send(200, { orderId: url.searchParams.get('id'), customer: 'Northwind Traders', amount: 1250, authorized: true });
    }
    if (url.pathname === '/flaky') {
      flakyCalls += 1;
      return flakyCalls === 1 ? send(503, { error: 'busy' }) : send(200, { synced: true, attempt: flakyCalls });
    }
    send(404, { error: 'not found' });
  });
  await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
  const address = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal).address;
  return { base: `http://${address}:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

export async function newPage(runtime, role, options) {
  const context = await runtime.context(role, options);
  return context.newPage();
}

export async function toast(page, text) {
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: text }).first()).toBeVisible();
}

export async function createWorkflow(page, name) {
  await page.goto('/');
  await page.getByTestId('new-workflow').click();
  await page.getByTestId('name-input').fill(name);
  await Promise.all([page.waitForURL(/\/workflows\/[^/]+$/), page.getByTestId('name-submit').click()]);
  await expect(page.getByTestId('workflow-title')).toHaveText(name);
  return page.url().split('/workflows/')[1];
}

export async function selectStep(page, name) {
  await page.locator(`[data-testid="step-item"][data-name="${name}"]`).click();
  await expect(page.getByTestId('field-step-name')).toHaveValue(name);
}

export async function addStep(page, typeLabel, name) {
  await page.getByTestId('add-step-type').selectOption({ label: typeLabel });
  await page.getByTestId('add-step').click();
  if (name) await page.getByTestId('field-step-name').fill(name);
}

export async function save(page) {
  await Promise.all([toast(page, 'Saved'), page.getByTestId('save').click()]);
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
}

/** Clicks Run and waits for the toast that says how it ended. */
export async function run(page, expected = 'The run finished') {
  await Promise.all([toast(page, expected), page.getByTestId('run').click()]);
}

export async function openLatestRun(page) {
  await Promise.all([page.waitForURL(/\/runs\/[^/?]+$/), page.getByTestId('latest-run').click()]);
  return page.url().split('/runs/')[1];
}

export async function setTrigger(page, kind) {
  await selectStep(page, 'Start');
  await page.getByTestId('field-kind').selectOption(kind);
}

export async function createCredential(page, name, token) {
  await page.goto('/credentials');
  await page.getByTestId('new-credential').click();
  await page.getByTestId('field-credential-name').fill(name);
  await page.getByTestId('field-credential-kind').selectOption('bearer');
  await page.getByTestId('field-token').fill(token);
  await Promise.all([toast(page, 'Credential saved'), page.getByTestId('save-credential').click()]);
  await expect(page.locator(`[data-testid="credential-row"][data-name="${name}"]`)).toBeVisible();
}

export async function createTable(page, name, columns) {
  await page.goto('/tables');
  await page.getByTestId('new-table').click();
  await page.getByTestId('name-input').fill(name);
  for (let i = 0; i < columns.length; i++) {
    if (i > 0) await page.getByTestId('add-columns').click();
    await page.getByTestId(`columns-${i}-name`).fill(columns[i][0]);
    await page.getByTestId(`columns-${i}-type`).selectOption(columns[i][1]);
  }
  await Promise.all([page.waitForURL(/\/tables\/[^/]+$/), page.getByTestId('name-submit').click()]);
  await expect(page.getByTestId('table-title')).toHaveText(name);
  return page.url().split('/tables/')[1];
}

export async function addRow(page, values) {
  for (const [column, value] of Object.entries(values)) {
    const field = page.getByTestId(`new-${column}`);
    if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption(value);
    else await field.fill(value);
  }
  const rows = await page.getByTestId('data-row').count();
  await page.getByTestId('add-row').click();
  await expect(page.getByTestId('data-row')).toHaveCount(rows + 1);
}

/** Does `action` on the page and returns the server-function request it sent, to replay as someone else. */
export async function captureServerCall(page, action) {
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/_serverFn/') && r.method() === 'POST'),
    action(),
  ]);
  const headers = { ...request.headers() };
  for (const h of ['cookie', 'host', 'origin', 'referer', 'content-length']) delete headers[h];
  return { path: new URL(request.url()).pathname + new URL(request.url()).search, headers, body: request.postData() };
}

export async function replay(runtime, call, role, swap = []) {
  let body = call.body;
  for (const [from, to] of swap) body = body.split(from).join(to);
  const res = await runtime.fetch(call.path, { role, method: 'POST', headers: call.headers, body });
  const text = await res.text();
  // A server function answers a thrown error as a serialized Error.
  const refused = res.status >= 400 || text.includes('$TSR/Error');
  if (!refused) console.log('replay accepted', role, res.status, text.slice(0, 300));
  return { status: res.status, refused };
}

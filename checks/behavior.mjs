import {
  addRow, addStep, API_TOKEN, createCredential, createTable, createWorkflow, expect, newPage,
  openLatestRun, run, save, selectStep, setTrigger, start, startApi, toast,
} from './lib.mjs';

const runtime = await start();
const api = await startApi();
const log = (m) => console.log(`- ${m}`);
try {
  const page = await newPage(runtime, 'owner');

  // F004: a credential, its secret never shown again.
  await createCredential(page, 'Orders API', API_TOKEN);
  expect(await page.content()).not.toContain(API_TOKEN);
  log('credential saved');

  // F007: a typed table; a value of the wrong type is refused.
  const tableId = await createTable(page, 'Large orders', [['customer', 'text'], ['amount', 'number'], ['paid', 'boolean']]);
  await addRow(page, { customer: 'Contoso', amount: '480', paid: 'true' });
  await page.getByTestId('new-customer').fill('Fabrikam');
  await page.getByTestId('new-amount').fill('lots');
  await Promise.all([toast(page, 'takes a number'), page.getByTestId('add-row').click()]);
  await expect(page.getByTestId('data-row')).toHaveCount(1);
  await page.getByTestId('new-amount').fill('95');
  await page.getByTestId('add-row').click();
  await expect(page.getByTestId('data-row')).toHaveCount(2);
  await page.getByTestId('sort-amount').click();
  await expect(page.getByTestId('data-row').first()).toContainText('Fabrikam');
  await page.getByTestId('filter-column').selectOption({ label: 'customer' });
  await page.getByTestId('filter-text').fill('conto');
  await expect(page.getByTestId('data-row')).toHaveCount(1);
  await page.getByLabel('Edit row').click();
  await page.getByTestId('edit-amount').fill('520');
  await page.getByTestId('save-row').click();
  await expect(page.getByTestId('data-row').first()).toContainText('520');
  await page.getByTestId('add-column').click();
  await page.getByTestId('name-input').fill('due');
  await page.getByTestId('column-type').selectOption('date');
  await page.getByTestId('name-submit').click();
  await expect(page.getByTestId('sort-due')).toBeVisible();
  log('table rows typed, filtered, sorted, edited');

  // F001 + F003: a manual workflow: HTTP request with the credential, a condition with
  // two branches that rejoin into a Data table step, expressions throughout.
  const wfId = await createWorkflow(page, 'Large order follow-up');
  await addStep(page, 'HTTP request', 'Fetch order');
  await page.getByTestId('field-url').fill(`${api.base}/orders`);
  await page.getByTestId('add-query').click();
  await page.getByTestId('query-0-name').fill('id');
  await page.getByTestId('query-0-value').fill('SO-1042');
  await page.getByTestId('field-credential').selectOption({ label: 'Orders API' });
  await addStep(page, 'Condition', 'Is large');
  await page.getByTestId('field-left').fill('{{ $json.amount }}');
  await page.getByTestId('field-operator').selectOption('greaterThan');
  await page.getByTestId('field-right').fill('1000');
  await addStep(page, 'Set fields', 'Mark large');
  await page.getByTestId('add-operations').click();
  await page.getByTestId('operations-0-field').fill('tier');
  await page.getByTestId('operations-0-value').fill('large');
  await selectStep(page, 'Is large');
  await addStep(page, 'Set fields', 'Mark small');
  await page.getByTestId('add-operations').click();
  await page.getByTestId('operations-0-field').fill('tier');
  await page.getByTestId('operations-0-value').fill('small');
  await selectStep(page, 'Is large');
  await page.getByLabel('Disconnect Mark small').click();
  await page.getByTestId('connect-false').selectOption({ label: 'Mark small' });
  await selectStep(page, 'Mark large');
  await addStep(page, 'Data table', 'Record order');
  await page.getByTestId('field-table').selectOption(tableId);
  await page.getByTestId('add-values').click();
  await page.getByTestId('values-0-column').fill('customer');
  await page.getByTestId('values-0-value').fill('{{ $node["Fetch order"].json.customer }} ({{ $json.tier }})');
  await page.getByTestId('add-values').click();
  await page.getByTestId('values-1-column').fill('amount');
  await page.getByTestId('values-1-value').fill('{{ $json.amount }}');
  await selectStep(page, 'Mark small');
  await page.getByTestId('connect-main').selectOption({ label: 'Record order' });
  // Saving refuses an invalid graph: two steps with one name.
  await page.getByTestId('field-step-name').fill('Mark large');
  await expect(page.getByTestId('problems')).toContainText('Two steps are named "Mark large"');
  await page.getByTestId('field-step-name').fill('Mark small');
  await expect(page.getByTestId('problems')).toHaveCount(0);
  await save(page);
  await run(page);
  await selectStep(page, 'Fetch order');
  await expect(page.getByTestId('step-output')).toContainText('Northwind Traders');
  await expect(page.getByTestId('step-input')).toBeVisible();
  await selectStep(page, 'Record order');
  await expect(page.getByTestId('step-output')).toContainText('Northwind Traders (large)');
  expect(await page.content()).not.toContain(API_TOKEN);
  log('workflow with branches ran');

  // The step wrote the row.
  await page.goto(`/tables/${tableId}`);
  await expect(page.getByTestId('data-row').filter({ hasText: 'Northwind Traders (large)' })).toContainText('1250');

  // F001: list shows trigger, state and last run; rename, duplicate, delete.
  await page.goto('/');
  const row = page.locator('[data-testid="workflow-row"][data-name="Large order follow-up"]');
  await expect(row).toContainText('Manual');
  await expect(row).toContainText('Inactive');
  await expect(row.getByTestId('status')).toHaveAttribute('data-status', 'succeeded');
  await row.getByRole('button', { name: /Actions for/ }).click();
  await Promise.all([page.waitForURL(/\/workflows\//), page.getByRole('menuitem', { name: 'Duplicate' }).click()]);
  await expect(page.getByTestId('workflow-title')).toHaveText('Large order follow-up (copy)');
  await page.getByTestId('workflow-menu').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByTestId('name-input').fill('Scratch copy');
  await page.getByTestId('name-submit').click();
  await expect(page.getByTestId('workflow-title')).toHaveText('Scratch copy');
  await page.goto('/');
  await page.locator('[data-testid="workflow-row"][data-name="Scratch copy"]').getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await Promise.all([toast(page, 'Workflow deleted'), page.getByRole('button', { name: 'Delete' }).click()]);
  await expect(page.locator('[data-testid="workflow-row"][data-name="Scratch copy"]')).toHaveCount(0);
  log('rename, duplicate, delete');

  // F002 + F005: a failed run retried from the failed step.
  const syncId = await createWorkflow(page, 'Inventory sync');
  await addStep(page, 'HTTP request', 'Push stock');
  await page.getByTestId('field-url').fill(`${api.base}/flaky`);
  await save(page);
  await run(page, 'The run failed');
  const failedRun = await openLatestRun(page);
  await expect(page.getByTestId('run-error')).toContainText('status 503');
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith(failedRun)), page.getByTestId('retry-run').click()]);
  await expect(page.locator('[data-testid="run-step"][data-name="Start"]')).toContainText('From the earlier run');
  await expect(page.locator('[data-testid="run-step"][data-name="Push stock"]')).toHaveAttribute('data-status', 'succeeded');
  await expect(page.getByTestId('run-step-output').last()).toContainText('"synced": true');
  log('retry from failed step');

  // F002: schedule fires only while active, once per slot.
  await page.goto(`/workflows/${syncId}`);
  await setTrigger(page, 'schedule');
  await page.getByTestId('field-schedule-mode').selectOption('hours');
  await page.getByTestId('field-schedule-every').fill('12');
  await save(page);
  await runtime.scheduled('* * * * *');
  await page.goto(`/runs?workflowId=${syncId}`);
  await expect(page.getByTestId('run-row')).toHaveCount(2);
  await page.goto(`/workflows/${syncId}`);
  await Promise.all([toast(page, 'Activated'), page.getByTestId('active-switch').click()]);
  await runtime.scheduled('* * * * *');
  await runtime.scheduled('* * * * *');
  await page.goto(`/runs?workflowId=${syncId}`);
  await expect(page.getByTestId('run-row')).toHaveCount(3);
  await expect(page.getByTestId('run-row').first()).toContainText('Schedule');
  log('schedule');

  // F002 + F003: webhook trigger, with email and AI steps off on this Gateway.
  const hookId = await createWorkflow(page, 'Lead intake');
  await setTrigger(page, 'webhook');
  await page.getByTestId('field-webhook-respond').selectOption('lastStep');
  await addStep(page, 'Set fields', 'Shape lead');
  await page.getByTestId('add-operations').click();
  await page.getByTestId('operations-0-field').fill('email');
  await page.getByTestId('operations-0-value').fill('{{ $json.body.email }}');
  await page.getByTestId('add-operations').click();
  await page.getByTestId('operations-1-field').fill('source');
  await page.getByTestId('operations-1-value').fill('{{ $json.query.src }}');
  await page.getByTestId('add-operations').click();
  await page.getByTestId('operations-2-op').selectOption('remove');
  await page.getByTestId('operations-2-field').fill('headers');
  await addStep(page, 'Send email', 'Tell sales');
  await page.getByTestId('field-to').fill('sales@example.test');
  await page.getByTestId('field-subject').fill('New lead {{ $json.email }}');
  await page.getByTestId('field-on-error').selectOption('continue');
  await save(page);
  await selectStep(page, 'Start');
  const hookUrl = new URL(await page.getByTestId('webhook-url').inputValue());
  expect(hookUrl.hostname).toBe(runtime.hostname);
  const post = (path, body) => runtime.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post(`${hookUrl.pathname}?src=site`, { email: 'dana@example.test' })).status).toBe(404);
  await Promise.all([toast(page, 'Activated'), page.getByTestId('active-switch').click()]);
  const answer = await post(`${hookUrl.pathname}?src=site`, { email: 'dana@example.test' });
  expect(answer.status).toBe(200);
  const lead = await answer.json();
  expect(lead.email).toBe('dana@example.test');
  expect(lead.source).toBe('site');
  expect(lead.error).toContain("Email isn't set up");
  expect((await runtime.fetch(hookUrl.pathname)).status).toBe(404);
  const bad = await post(`${hookUrl.pathname}?src=site`, { name: 'no email' });
  expect(bad.status).toBe(500);
  const failed = await bad.json();
  await page.goto(`/runs/${failed.runId}`);
  await expect(page.getByTestId('run-error')).toContainText('Shape lead');
  await expect(page.getByTestId('run-error')).toContainText('"email"');
  // Regenerating invalidates the old URL.
  await page.goto(`/workflows/${hookId}`);
  await selectStep(page, 'Start');
  await Promise.all([toast(page, 'no longer works'), page.getByTestId('regenerate-webhook').click()]);
  await expect(page.getByTestId('webhook-url')).not.toHaveValue(hookUrl.href);
  const newHook = new URL(await page.getByTestId('webhook-url').inputValue());
  expect((await post(`${hookUrl.pathname}?src=site`, { email: 'x@example.test' })).status).toBe(404);
  // Immediate acknowledgement with the run id.
  await page.getByTestId('field-webhook-respond').selectOption('immediately');
  await save(page);
  const ack = await post(`${newHook.pathname}?src=ads`, { email: 'lee@example.test' });
  expect(ack.status).toBe(202);
  expect((await ack.json()).runId).toBeTruthy();
  // Form bodies and enough runs to page.
  for (let i = 0; i < 20; i++)
    await runtime.fetch(`${newHook.pathname}?src=form`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=lead${i}%40example.test` });
  log('webhook');

  // F005: lists across workflows, filtered and paginated.
  await page.goto('/runs');
  await expect(page.getByTestId('run-row')).toHaveCount(20);
  await expect(page.getByTestId('page-label')).toContainText('Page 1 of');
  await page.getByTestId('next-page').click();
  await expect(page.getByTestId('page-label')).toContainText('Page 2 of');
  await page.getByTestId('status-filter').selectOption('failed');
  await page.waitForURL(/status=failed/);
  await expect(page.locator('[data-testid="run-row"]:not([data-status="failed"])')).toHaveCount(0);
  await expect(page.locator('[data-testid="run-row"][data-status="failed"]').first()).toBeVisible();

  // F003 + F005: approval and wait pause a run; cancel and replay.
  const approvalId = await createWorkflow(page, 'Refund approval');
  await addStep(page, 'Approval', 'Manager sign-off');
  await page.getByTestId('field-message').fill('Refund order SO-1042 for $1,250');
  await addStep(page, 'Wait', 'Cool-off');
  await page.getByTestId('field-amount').fill('1');
  await page.getByTestId('field-unit').selectOption('seconds');
  await addStep(page, 'Set fields', 'Issue refund');
  await page.getByTestId('add-operations').click();
  await page.getByTestId('operations-0-field').fill('refunded');
  await page.getByTestId('operations-0-value').fill('yes');
  await selectStep(page, 'Manager sign-off');
  await addStep(page, 'Set fields', 'Close request');
  await selectStep(page, 'Manager sign-off');
  await page.getByLabel('Disconnect Close request').click();
  await page.getByTestId('connect-rejected').selectOption({ label: 'Close request' });
  await save(page);
  await run(page, 'The run is waiting');
  const approvalRun = await openLatestRun(page);
  await expect(page.getByTestId('approval')).toBeVisible();
  await Promise.all([toast(page, 'Approved'), page.getByTestId('approve').click()]);
  await expect(page.locator('[data-testid="run-step"][data-name="Cool-off"]')).toHaveAttribute('data-status', 'waiting');
  await new Promise((r) => setTimeout(r, 1200));
  await runtime.scheduled('* * * * *');
  await page.reload();
  await expect(page.locator('[data-testid="run-step"][data-name="Issue refund"]')).toHaveAttribute('data-status', 'succeeded');
  await expect(page.locator('[data-testid="run-step"][data-name="Close request"]')).toHaveCount(0);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith(approvalRun)), page.getByTestId('replay-run').click()]);
  await expect(page.getByTestId('approval')).toBeVisible();
  await Promise.all([toast(page, 'Run cancelled'), page.getByTestId('cancel-run').click()]);
  await expect(page.getByTestId('status').first()).toHaveAttribute('data-status', 'cancelled');
  log('approval, wait, replay, cancel');

  // F005: runs older than 30 days are deleted.
  const db = await runtime.database();
  await db.prepare('UPDATE executions SET started_at = ? WHERE id = ?').bind(Date.now() - 31 * 86400000, approvalRun).run();
  await runtime.scheduled('* * * * *');
  expect(await db.prepare('SELECT id FROM executions WHERE id = ?').bind(approvalRun).first()).toBeNull();

  // F006: versions, changes, read-only view, restore.
  await page.goto(`/workflows/${approvalId}/history`);
  await expect(page.getByTestId('version-row')).toHaveCount(2);
  await page.getByRole('link', { name: 'Version 2' }).click();
  await expect(page.getByTestId('change').filter({ hasText: 'Manager sign-off' })).toHaveAttribute('data-change', 'added');
  await expect(page.getByTestId('field-message')).toHaveAttribute('readonly', '');
  await page.goto(`/workflows/${approvalId}/versions/1`);
  await page.getByTestId('restore').click();
  await Promise.all([toast(page, 'Restored'), page.getByRole('button', { name: 'Restore' }).last().click()]);
  await expect(page.getByTestId('version-row')).toHaveCount(3);
  await expect(page.getByTestId('version-row').first()).toContainText('restored from version 1');
  await page.goto(`/workflows/${approvalId}`);
  await expect(page.getByTestId('step-item')).toHaveCount(1);
  log('versions');

  // F008: share with the team; the member works on it but can't delete it.
  await page.goto(`/workflows/${wfId}`);
  await page.getByTestId('workflow-menu').click();
  await Promise.all([toast(page, 'Shared with the team'), page.getByTestId('toggle-share').click()]);
  const member = await newPage(runtime, 'member');
  await member.goto('/');
  await expect(member.locator('[data-testid="workflow-row"][data-name="Large order follow-up"]')).toBeVisible();
  await expect(member.locator('[data-testid="workflow-row"][data-name="Lead intake"]')).toHaveCount(0);
  await member.goto(`/workflows/${wfId}`);
  await selectStep(member, 'Fetch order');
  await expect(member.getByTestId('field-credential').locator('option:checked')).toHaveText('Orders API');
  await run(member);
  await member.getByTestId('workflow-menu').click();
  await expect(member.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await member.keyboard.press('Escape');
  await runtime.assertBackLink(member);
  log('sharing');

  // Phone-sized smoke.
  const phone = await newPage(runtime, 'member', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto('/');
  await expect(phone.getByRole('heading', { name: 'Workflows' })).toBeVisible();
  await expect(phone.locator('[data-testid="workflow-row"][data-name="Large order follow-up"]')).toBeVisible();

  // The workflow's result on screen.
  await page.goto(`/runs?workflowId=${wfId}`);
  await Promise.all([page.waitForURL(/\/runs\/[^/?]+$/), page.getByTestId('run-row').first().getByRole('link').last().click()]);
  await expect(page.locator('[data-testid="run-step"][data-name="Fetch order"]')).toContainText('Northwind Traders');
  await runtime.screenshot(page);
  console.log('behavior: ok');
} finally {
  await api.close();
  await runtime.close();
}

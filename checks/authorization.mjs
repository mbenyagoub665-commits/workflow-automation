import {
  addRow, addStep, API_TOKEN, captureServerCall, createCredential, createTable, createWorkflow, expect,
  newPage, replay, run, save, setTrigger, start, toast,
} from './lib.mjs';

const runtime = await start();
const log = (m) => console.log(`- ${m}`);
try {
  // Anonymous and outsiders are refused on every private page; members get in.
  await runtime.assertPrivateAccess(['/', '/runs', '/tables', '/credentials']);

  // X001: the app serves no sign-in of its own.
  for (const path of ['/login', '/signin', '/signup', '/logout', '/register']) {
    const res = await runtime.fetch(path, { role: 'member' });
    expect(res.status).toBe(404);
  }

  const owner = await newPage(runtime, 'owner');
  const member = await newPage(runtime, 'member');

  // The member's private workflow: an admin (the org owner) sees it, nobody else is involved.
  const draftId = await createWorkflow(member, 'Expense draft');

  // The owner's private objects.
  await createCredential(owner, 'Payroll API', API_TOKEN);
  const credRename = await captureServerCall(owner, async () => {
    await owner.getByRole('button', { name: 'Edit' }).click();
    await owner.getByTestId('field-credential-name').fill('Payroll API key');
    await owner.getByTestId('save-credential').click();
  });
  await expect(owner.locator('[data-testid="credential-row"][data-name="Payroll API key"]')).toBeVisible();
  const tableId = await createTable(owner, 'Salaries', [['person', 'text'], ['amount', 'number']]);
  const rowCall = await captureServerCall(owner, () => addRow(owner, { person: 'Avery', amount: '5000' }));
  const privateId = await createWorkflow(owner, 'Payroll export');
  await addStep(owner, 'Set fields', 'Shape');
  await save(owner);
  await run(owner);
  const runCall = await captureServerCall(owner, () => owner.getByTestId('run').click());
  await toast(owner, 'The run finished');
  const renameCall = await captureServerCall(owner, async () => {
    await owner.getByTestId('workflow-menu').click();
    await owner.getByRole('menuitem', { name: 'Rename' }).click();
    await owner.getByTestId('name-input').fill('Payroll export (monthly)');
    await owner.getByTestId('name-submit').click();
  });
  await expect(owner.getByTestId('workflow-title')).toHaveText('Payroll export (monthly)');
  await owner.goto(`/runs?workflowId=${privateId}`);
  const runHref = await owner.getByTestId('run-row').first().getByRole('link').first().getAttribute('href');

  // An admin sees and manages every workflow.
  await owner.goto('/');
  await expect(owner.locator('[data-testid="workflow-row"][data-name="Expense draft"]')).toBeVisible();
  await owner.goto(`/workflows/${draftId}`);
  await owner.getByTestId('workflow-menu').click();
  await expect(owner.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  await owner.keyboard.press('Escape');
  log('admin sees all');

  // The member can't see or open the owner's private objects.
  await member.goto('/');
  await expect(member.getByTestId('workflow-row')).toHaveCount(1);
  await member.goto(`/workflows/${privateId}`);
  await expect(member.getByText("doesn't exist or isn't shared with you")).toBeVisible();
  await member.goto(runHref);
  await expect(member.getByText("doesn't exist or isn't shared with you")).toBeVisible();
  await member.goto(`/tables/${tableId}`);
  await expect(member.getByText("doesn't exist or isn't shared with you")).toBeVisible();
  await member.goto('/tables');
  await expect(member.getByTestId('table-row')).toHaveCount(0);
  await member.goto('/credentials');
  await expect(member.getByTestId('credential-row')).toHaveCount(0);
  log('private objects hidden');

  // ...nor change them, even by replaying the owner's own requests.
  expect((await replay(runtime, renameCall, 'member')).refused).toBe(true);
  expect((await replay(runtime, runCall, 'member')).refused).toBe(true);
  expect((await replay(runtime, rowCall, 'member')).refused).toBe(true);
  expect((await replay(runtime, credRename, 'member', [['Payroll API key', 'Hijacked']])).refused).toBe(true);
  expect((await replay(runtime, renameCall, 'outsider')).refused).toBe(true);
  await owner.goto(`/workflows/${privateId}`);
  await expect(owner.getByTestId('workflow-title')).toHaveText('Payroll export (monthly)');
  await owner.goto(`/runs?workflowId=${privateId}`);
  await expect(owner.getByTestId('run-row')).toHaveCount(2);
  await owner.goto(`/tables/${tableId}`);
  await expect(owner.getByTestId('data-row')).toHaveCount(1);
  await owner.goto('/credentials');
  await expect(owner.locator('[data-testid="credential-row"][data-name="Payroll API key"]')).toBeVisible();
  log('replays refused');

  // F008: shared items are open to the team; deleting and unsharing stay with the owner or an admin.
  await owner.goto(`/workflows/${privateId}`);
  await owner.getByTestId('workflow-menu').click();
  await Promise.all([toast(owner, 'Shared with the team'), owner.getByTestId('toggle-share').click()]);
  const unshareCall = await captureServerCall(owner, async () => {
    await owner.getByTestId('workflow-menu').click();
    await owner.getByTestId('toggle-share').click();
  });
  await toast(owner, 'Now private');
  await owner.getByTestId('workflow-menu').click();
  await Promise.all([toast(owner, 'Shared with the team'), owner.getByTestId('toggle-share').click()]);
  const throwawayId = await createWorkflow(owner, 'Throwaway');
  const deleteCall = await captureServerCall(owner, async () => {
    await owner.getByTestId('workflow-menu').click();
    await owner.getByRole('menuitem', { name: 'Delete' }).click();
    await owner.getByRole('button', { name: 'Delete' }).click();
  });
  await owner.waitForURL((u) => u.pathname === '/');
  expect((await replay(runtime, deleteCall, 'member', [[throwawayId, privateId]])).refused).toBe(true);
  expect((await replay(runtime, unshareCall, 'member')).refused).toBe(true);
  await member.goto(`/workflows/${privateId}`);
  await expect(member.getByTestId('workflow-title')).toHaveText('Payroll export (monthly)');
  await run(member);
  await member.getByTestId('workflow-menu').click();
  await expect(member.getByTestId('toggle-share')).toHaveCount(0);
  await member.keyboard.press('Escape');
  log('shared workflow');

  // F004: credentials are never shared; a member sees only the name on a shared workflow.
  await owner.goto(`/workflows/${privateId}`);
  await addStep(owner, 'HTTP request', 'Send payroll');
  await owner.getByTestId('field-url').fill('https://payroll.example.test/export');
  const credentialOption = owner.getByTestId('field-credential').locator('option', { hasText: 'Payroll API key' });
  await owner.getByTestId('field-credential').selectOption(await credentialOption.getAttribute('value'));
  await save(owner);
  await member.goto(`/workflows/${privateId}`);
  await member.locator('[data-testid="step-item"][data-name="Send payroll"]').click();
  await expect(member.getByTestId('field-credential').locator('option:checked')).toHaveText('Payroll API key');
  const memberHtml = await member.content();
  expect(memberHtml).not.toContain(API_TOKEN);
  // Pointing the owner's credential somewhere else is the owner's call alone.
  await member.getByTestId('field-url').fill('https://collector.example.test/grab');
  await Promise.all([toast(member, "Only the workflow's owner can change"), member.getByTestId('save').click()]);
  await member.goto(`/workflows/${privateId}`);
  await member.locator('[data-testid="step-item"][data-name="Send payroll"]').click();
  await expect(member.getByTestId('field-url')).toHaveValue('https://payroll.example.test/export');
  await member.goto('/credentials');
  await expect(member.getByTestId('credential-row')).toHaveCount(0);
  log('credentials');

  // F007 + F008: a shared table is editable by the team but only the owner deletes it.
  await owner.goto(`/tables/${tableId}`);
  await owner.getByTestId('table-menu').click();
  await Promise.all([toast(owner, 'Shared with the team'), owner.getByTestId('toggle-share').click()]);
  await member.goto(`/tables/${tableId}`);
  await addRow(member, { person: 'Blake', amount: '4200' });
  await member.getByTestId('table-menu').click();
  await expect(member.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
  await member.keyboard.press('Escape');

  // F002: public webhook route shows nothing for unknown, inactive or wrong-method calls.
  const hookId = await createWorkflow(owner, 'Signup hook');
  await setTrigger(owner, 'webhook');
  await save(owner);
  await owner.locator('[data-testid="step-item"][data-name="Start"]').click();
  const hook = new URL(await owner.getByTestId('webhook-url').inputValue()).pathname;
  for (const [path, init] of [
    ['/hook/not-a-real-token-but-long-enough', { method: 'POST' }],
    [hook, { method: 'POST' }],
  ]) {
    const res = await runtime.fetch(path, init);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('Signup hook');
  }
  await Promise.all([toast(owner, 'Activated'), owner.getByTestId('active-switch').click()]);
  expect((await runtime.fetch(hook, { method: 'GET' })).status).toBe(404);
  const ok = await runtime.fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(ok.status).toBe(202);
  expect(Object.keys(await ok.json()).sort()).toEqual(['runId', 'status']);
  // Anonymous callers reach nothing else.
  for (const path of ['/', `/workflows/${hookId}`, '/runs', '/credentials']) {
    expect((await runtime.fetch(path)).status).not.toBe(200);
    expect((await runtime.fetch(path, { role: 'outsider' })).status).not.toBe(200);
  }
  log('webhook route');
  console.log('authorization: ok');
} finally {
  await runtime.close();
}

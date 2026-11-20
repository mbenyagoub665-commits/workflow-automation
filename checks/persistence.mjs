import {
  addRow, addStep, API_TOKEN, createCredential, createTable, createWorkflow, expect, newPage,
  run, save, selectStep, start, startApi,
} from './lib.mjs';

const runtime = await start();
const api = await startApi();
try {
  let page = await newPage(runtime, 'owner');
  await createCredential(page, 'Warehouse API', API_TOKEN);
  const tableId = await createTable(page, 'Shipments', [['carrier', 'text'], ['boxes', 'number']]);
  await addRow(page, { carrier: 'Harbor Freight Lines', boxes: '12' });
  const wfId = await createWorkflow(page, 'Shipment check');
  await addStep(page, 'HTTP request', 'Look up order');
  await page.getByTestId('field-url').fill(`${api.base}/orders?id=SO-77`);
  await page.getByTestId('field-credential').selectOption({ label: 'Warehouse API' });
  await save(page);
  await run(page);

  await runtime.restart();

  page = await newPage(runtime, 'owner');
  await page.goto('/');
  await expect(page.locator('[data-testid="workflow-row"][data-name="Shipment check"]')).toBeVisible();
  await page.goto(`/workflows/${wfId}/history`);
  await expect(page.getByTestId('version-row')).toHaveCount(2);
  await page.goto(`/runs?workflowId=${wfId}`);
  await expect(page.getByTestId('run-row')).toHaveCount(1);
  await page.goto(`/tables/${tableId}`);
  await expect(page.getByTestId('data-row')).toContainText('Harbor Freight Lines');
  await page.goto('/credentials');
  await expect(page.locator('[data-testid="credential-row"][data-name="Warehouse API"]')).toBeVisible();
  // The stored credential still decrypts: the request is authorized after the restart.
  await page.goto(`/workflows/${wfId}`);
  await run(page);
  await selectStep(page, 'Look up order');
  await expect(page.getByTestId('step-output')).toContainText('"authorized": true');
  console.log('persistence: ok');
} finally {
  await api.close();
  await runtime.close();
}

import { test, expect, type Page } from '@playwright/test';
import { emptyConfig } from '@importforge/contracts';
import AxeBuilder from '@axe-core/playwright';
const origin = 'http://localhost:5173';
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good data starts here.' })).toBeVisible();
});
async function upload(page: Page, filename: string, content: string) {
  await page.getByRole('link', { name: 'New import', exact: true }).click();
  await page
    .getByLabel('Supplier CSV file')
    .setInputFiles({ name: filename, mimeType: 'text/csv', buffer: Buffer.from(content) });
  await page.getByRole('button', { name: 'Upload & inspect' }).click();
  await expect(
    page.getByRole('heading', { name: 'Give every column a destination.' }),
  ).toBeVisible();
  return page.url().split('/').pop()!;
}
async function manualMap(page: Page) {
  for (const [header, target] of [
    ['SKU', 'sku'],
    ['Name', 'name'],
    ['Price', 'price'],
  ])
    await page.getByLabel(`Map ${header}`, { exact: true }).selectOption(target);
  await page.getByLabel('Approved currency default').selectOption('PHP');
  await page.getByLabel('Approved category default').selectOption('Peripherals');
  await page.getByLabel('Approved unit default').selectOption('piece');
}
async function commit(page: Page) {
  await page.getByRole('button', { name: 'Commit import', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & commit' }).click();
  await expect(page.getByRole('heading', { name: 'Your catalog is up to date.' })).toBeVisible();
}
test('manual clean import creates, updates, receipt, trace and repeated commit', async ({
  page,
}) => {
  const sku = `E2E-${Date.now()}`;
  const id = await upload(
    page,
    'clean-e2e.csv',
    `SKU,Name,Price\n00042,Wireless Mouse,451.00\n${sku},Test Keyboard,1200.00`,
  );
  await manualMap(page);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole('button', { name: 'Save & validate' }).click();
  await expect(page.getByRole('heading', { name: 'Every record, accounted for.' })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  await commit(page);
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze())
      .violations,
  ).toEqual([]);
  const first = await page.request.post(`/api/imports/${id}/commit`, {
    headers: { origin },
    data: { revision: 1, idempotencyKey: `importforge:${id}:1` },
  });
  expect(first.status()).toBe(202);
  expect((await first.json()).receipt.counts.total).toBe(2);
  await page.getByRole('link', { name: 'View catalog', exact: true }).click();
  await page.getByLabel('Search catalog').fill(sku);
  await page.getByRole('link', { name: 'Test Keyboard Peripherals', exact: true }).click();
  await expect(page.getByText('clean-e2e.csv · Record 2')).toBeVisible();
});
test('messy source accepts reviewed suggestions and explicitly excludes blocking rows', async ({
  page,
}) => {
  await upload(
    page,
    'messy-e2e.csv',
    'Supplier Code,Item Description,Cost,Group,UOM\nE2E-MESSY,Mouse,"PHP 1,250.00",peripherals,pcs\nE2E-BAD,Bad product,$89.00,peripherals,pcs',
  );
  await page.getByRole('button', { name: 'Suggest mappings' }).click();
  await page.getByRole('button', { name: 'Accept suggestions' }).click();
  await page.getByLabel('Price number format').selectOption('comma-grouped');
  await page.getByLabel('Remove approved price prefix').selectOption('PHP');
  await page.getByLabel('Approved currency default').selectOption('PHP');
  await page.getByLabel('Category mappings', { exact: true }).fill('peripherals = Peripherals');
  await page.getByLabel('Unit mappings', { exact: true }).fill('pcs = piece');
  await page.getByRole('button', { name: 'Save & validate' }).click();
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled();
  await page
    .getByRole('row')
    .filter({ hasText: 'Bad product' })
    .getByRole('button', { name: 'Exclude record' })
    .click();
  await page.getByLabel('Reason for exclusion').fill('Currency must be clarified by supplier');
  await page.getByRole('button', { name: 'Exclude & revalidate' }).click();
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled();
  await commit(page);
  await expect(page.getByText('2 source records accounted for.')).toBeVisible();
});
test('stale preview is rejected after another import changes the product', async ({ page }) => {
  const currentCatalog = await (await page.request.get('/api/catalog?q=00042')).json();
  const concurrentPrice =
    currentCatalog.items.find((p: any) => p.sku === '00042' && p.supplier_id === 'sup-nova')
      .price === '499.00'
      ? '498.00'
      : '499.00';
  const id = await upload(page, 'stale-e2e.csv', 'SKU,Name,Price\n00042,Wireless Mouse,452.00');
  await manualMap(page);
  await page.getByRole('button', { name: 'Save & validate' }).click();
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled();
  const other = await page.request.post('/api/imports', {
    headers: { origin },
    multipart: {
      supplierId: 'sup-nova',
      file: {
        name: 'concurrent.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(`SKU,Name,Price\n00042,Wireless Mouse,${concurrentPrice}`),
      },
    },
  });
  const otherId = (await other.json()).id;
  await expect
    .poll(async () => (await (await page.request.get(`/api/imports/${otherId}`)).json()).status)
    .toBe('mapping');
  await page.request.post(`/api/imports/${otherId}/prepare`, {
    headers: { origin },
    data: {
      expectedRevision: 0,
      config: {
        ...emptyConfig,
        mappings: { SKU: 'sku', Name: 'name', Price: 'price' },
        defaults: { currency: 'PHP', category: 'Peripherals', unit: 'piece' },
      },
      exclusions: {},
    },
  });
  await expect
    .poll(async () => (await (await page.request.get(`/api/imports/${otherId}`)).json()).status)
    .toBe('review');
  await page.request.post(`/api/imports/${otherId}/commit`, {
    headers: { origin },
    data: { revision: 1, idempotencyKey: `other-${otherId}` },
  });
  await expect
    .poll(async () => (await (await page.request.get(`/api/imports/${otherId}`)).json()).status)
    .toBe('completed');
  await page.getByRole('button', { name: 'Commit import', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & commit' }).click();
  await expect(page.getByRole('alert')).toContainText('Catalog changed since review');
  expect((await (await page.request.get(`/api/imports/${id}`)).json()).status).toBe('failed');
});
test('mobile catalog and import overview do not overflow the document', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Good data starts here.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('link', { name: 'Catalog', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A catalog you can trust.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('a draft cannot overwrite a revision saved by another tab', async ({ page }) => {
  const id = await upload(page, 'two-tabs.csv', 'SKU,Name,Price\nE2E-TABS,Mouse,100.00');
  await manualMap(page);
  const response = await page.request.post(`/api/imports/${id}/prepare`, {
    headers: { origin },
    data: {
      expectedRevision: 0,
      config: {
        ...emptyConfig,
        mappings: { SKU: 'sku', Name: 'name', Price: 'price' },
        defaults: { currency: 'PHP', category: 'Peripherals', unit: 'piece' },
      },
      exclusions: {},
    },
  });
  expect(response.status()).toBe(202);
  await expect
    .poll(async () => (await (await page.request.get(`/api/imports/${id}`)).json()).status)
    .toBe('review');
  await page.getByRole('button', { name: 'Mapping & transformations' }).click();
  await page.getByRole('button', { name: 'Save & validate' }).click();
  await expect(page.getByRole('alert')).toContainText('Another tab changed this import');
});
test('saved mapping reuse and identical second upload produce unchanged records', async ({
  page,
}) => {
  const sku = `REPEAT-${Date.now()}`,
    csv = `SKU,Name,Price\n${sku},Repeatable item,120.00`;
  await upload(page, 'repeatable-first.csv', csv);
  await manualMap(page);
  await page.getByRole('button', { name: 'Save supplier mapping' }).click();
  await expect(page.getByRole('status')).toContainText('Supplier mapping saved');
  await page.getByRole('button', { name: 'Save & validate' }).click();
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled();
  await commit(page);
  await page.getByRole('link', { name: 'All imports' }).click();
  await upload(page, 'repeatable-second.csv', csv);
  const options = page.getByLabel('Reuse supplier mapping').locator('option');
  const value = await options.nth(1).getAttribute('value');
  await page.getByLabel('Reuse supplier mapping').selectOption(value!);
  await page.getByRole('button', { name: 'Save & validate' }).click();
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled();
  await expect(page.getByText('Matches the current catalog')).toBeVisible();
  await commit(page);
});

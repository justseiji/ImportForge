import 'dotenv/config';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir } from 'node:fs/promises';
test('desktop and mobile WCAG A/AA checks', async ({ page }) => {
  await page.goto('/');
  const login = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(login.violations).toEqual([]);
  await page.getByLabel('Password', { exact: true }).fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Good data starts here.' })).toBeVisible();
  for (const path of ['/imports', '/catalog', '/suppliers', '/settings']) {
    await page.goto(path);
    await page.getByRole('heading', { level: 1 }).waitFor();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(result.violations, `${path} accessibility`).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/imports');
  await page.getByRole('heading', { level: 1 }).waitFor();
  const mobile = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(mobile.violations).toEqual([]);
  await mkdir('docs/results/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/results/screenshots/imports-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/imports');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.screenshot({ path: 'docs/results/screenshots/imports-desktop.png', fullPage: true });
  await page.goto('/catalog');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.screenshot({ path: 'docs/results/screenshots/catalog-desktop.png', fullPage: true });
});

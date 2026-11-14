import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import type { AddressInfo } from 'node:net';

const prefix = '/-ardonia-cinematic/';
const dist = resolve('dist');
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
};
let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      if (!path.startsWith(prefix)) { response.writeHead(404).end('outside deployment base'); return; }
      const file = resolve(dist, decodeURIComponent(path.slice(prefix.length) || 'index.html'));
      if (!file.startsWith(dist + sep) || !(await stat(file)).isFile()) { response.writeHead(404).end('missing'); return; }
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
      response.end(body);
    } catch { response.writeHead(404).end('missing'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

test('built production manifest, pages and resources work under GitHub Pages repository path', async ({ page, request }) => {
  const manifestResponse = await request.get(`${origin}${prefix}manifest.json`);
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()['content-type']).toContain('application/json');
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe('Ardonia Cinematic');
  expect(manifest.manifest_version).toBe(1);
  expect(manifest.action.popover).toBe(`${prefix}index.html`);
  for (const resource of [manifest.icon, manifest.background_url, manifest.action.icon, manifest.action.popover]) {
    expect(resource).toMatch(/^\/-ardonia-cinematic\//);
    const response = await request.get(`${origin}${resource}`);
    expect(response.status(), resource).toBe(200);
    expect(response.headers()['content-type'], resource).toContain(resource.endsWith('.html') ? 'text/html' : 'image/svg+xml');
  }
  for (const name of ['index.html', 'background.html', 'presentation.html']) {
    const response = await request.get(`${origin}${prefix}${name}`);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('/src/');
    const urls = [...html.matchAll(/(?:src|href)="([^\"]+)"/g)].map(match => match[1]).filter(url => /\.(js|css)(?:\?|$)/.test(url));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      const resourceUrl = new URL(url, `${origin}${prefix}${name}`).href;
      expect(new URL(resourceUrl).pathname).toMatch(/^\/-ardonia-cinematic\//);
      const asset = await request.get(resourceUrl);
      expect(asset.status(), url).toBe(200);
      expect(asset.headers()['content-type'], url).toContain(url.includes('.css') ? 'text/css' : 'text/javascript');
      expect((await asset.text()).trimStart()).not.toMatch(/<!doctype|<html/i);
    }
  }
  expect((await request.get(`${origin}${prefix}assets/missing.js`)).status()).toBe(404);
  const failures: string[] = [];
  page.on('requestfailed', req => { if (req.url().startsWith(origin)) failures.push(req.url()); });
  page.on('response', res => { if (res.url().startsWith(origin) && res.status() >= 400) failures.push(`${res.status()} ${res.url()}`); });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${origin}${manifest.action.popover}`);
  await page.getByRole('button', { name: '+ Nova cinematic', exact: true }).click();
  await page.locator('#title').fill('Floresta dos Sussurros');
  await page.locator('#description').fill('O vento desaparece entre as árvores.');
  await page.locator('#image').fill(`${origin}${prefix}cena-floresta.svg`);
  await page.getByRole('button', { name: 'Salvar cinematic' }).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(page.locator('.card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Floresta dos Sussurros', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pré-visualizar', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Pré-visualização da cinematic' });
  await expect(preview.getByRole('heading', { name: 'Floresta dos Sussurros', exact: true })).toBeVisible();
  const image = preview.locator('.cinematic-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await preview.locator('.cinematic-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await preview.getByRole('button', { name: 'Fechar apresentação' }).click();
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

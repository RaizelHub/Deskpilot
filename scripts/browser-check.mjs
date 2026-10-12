import { chromium, expect } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// This harness is confined to a dedicated disposable PostgreSQL database.
// Create deskpilot_browser_test before running it; it never uses the application database.

const root = process.cwd();
const server = path.join(root, 'apps/server');
const password = randomBytes(24).toString('hex') + 'Ab1!';
const env = {
  ...process.env, APP_ENV: 'local', APP_URL: 'http://127.0.0.1:5174', FRONTEND_URL: 'http://127.0.0.1:5174',
  DB_CONNECTION: 'pgsql', DB_DATABASE: 'deskpilot_browser_test',
  SESSION_DRIVER: 'database', CACHE_STORE: 'database', QUEUE_CONNECTION: 'database',
  DESKPILOT_DEMO_PASSWORD: password,
};
assert.equal(env.DB_DATABASE, 'deskpilot_browser_test');
execFileSync('php', ['artisan', 'migrate:fresh', '--force'], { cwd: server, env, stdio: 'pipe' });
execFileSync('php', ['artisan', 'db:seed', '--class=DemoSeeder', '--force'], { cwd: server, env, stdio: 'pipe' });
const php = spawn('php', ['-S', '127.0.0.1:8001', '-t', 'public'], { cwd: server, env, windowsHide: true, stdio: 'ignore' });
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:8001' }, windowsHide: true, stdio: 'ignore' });
async function ready(url) {
  for (let i = 0; i < 40; i++) { try { const response = await fetch(url); if (response.ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error(`Preview did not become ready: ${url}`);
}
let browser;
try {
  await ready('http://127.0.0.1:8001/up');
  await ready('http://127.0.0.1:5174');
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 }, timezoneId: 'Asia/Taipei' });
  page.setDefaultTimeout(45000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('docs/screenshots', { recursive: true });
  await page.goto('http://127.0.0.1:5174');
  await page.getByLabel('Email address').fill('admin@example.test');
  await page.screenshot({ path: 'docs/screenshots/login.png', fullPage: true });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/dashboard.png', fullPage: true });
  await page.getByRole('link', { name: 'Departments', exact: true }).click();
  await page.getByRole('button', { name: 'Add department' }).click();
  await page.getByLabel('Department name').fill('Customer Success');
  await page.getByLabel('Description', { exact: true }).fill('Customer operations team');
  await page.getByRole('button', { name: 'Save department' }).click();
  await page.getByRole('button', { name: 'Edit Customer Success' }).waitFor();
  await page.getByRole('link', { name: 'People', exact: true }).click();
  await page.getByRole('button', { name: 'Add person' }).click();
  await page.getByLabel('Full name').fill('Maria Santos');
  await page.getByLabel('Email address').fill('maria@example.test');
  await page.getByLabel('Initial password').fill(password);
  await page.getByRole('dialog').getByLabel('Department', { exact: true }).selectOption({ label: 'Customer Success' });
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Edit Maria Santos' }).waitFor();
  await page.screenshot({ path: 'docs/screenshots/people.png', fullPage: true });
  await page.getByLabel('Search people').fill('Maria');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit Maria Santos' }).click();
  await page.getByLabel('Account enabled').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('table').getByText('Inactive', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Use dark mode' }).click();
  assert.equal(await page.locator('html').getAttribute('class'), 'dark');
  await page.screenshot({ path: 'docs/screenshots/people-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Use light mode' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/screenshots/mobile.png', fullPage: true });
  const overflow = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 2 && getComputedStyle(el).position !== 'fixed').map(el => ({ tag: el.tagName, class: el.className, right: Math.round(el.getBoundingClientRect().right) })).slice(0, 20) }));
  assert.equal(overflow.scroll <= overflow.width, true, JSON.stringify(overflow));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByLabel('Email address').fill('employee@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
  await page.goto('http://127.0.0.1:5174/users');
  await page.getByRole('heading', { name: 'Access restricted' }).waitFor();
  const response = await page.request.get('http://127.0.0.1:5174/api/v1/users');
  assert.equal(response.status(), 403);
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto('http://127.0.0.1:5174/tickets');
  await page.getByRole('button', {name:'Create ticket',exact:true}).click();
  await page.getByLabel('Subject',{exact:true}).fill('VPN disconnects when opening finance apps');
  await page.getByLabel('Description',{exact:true}).fill('The VPN connects but disconnects when I open the finance application. Started this morning.');
  await page.getByLabel('Category',{exact:true}).selectOption({label:'VPN'});
  await page.getByLabel('Priority',{exact:true}).selectOption('high');
  await page.getByLabel('Device name (optional)').fill('FIN-LAPTOP-014');
  await page.getByLabel('Tags (comma separated)').fill('vpn, finance');
  await page.getByRole('dialog').getByRole('button',{name:'Create ticket',exact:true}).click();
  await page.getByRole('heading',{name:'VPN disconnects when opening finance apps'}).waitFor();
  const ticketUrl=page.url();
  await page.getByLabel('Choose attachment').setInputFiles({name:'connection.txt',mimeType:'text/plain',buffer:Buffer.from('VPN connection refused on port 443.')});
  await page.getByRole('button',{name:'Upload attachment',exact:true}).click();
  await page.getByRole('link',{name:'connection.txt',exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign out'}).click();
  await page.getByLabel('Email address').fill('technician@example.test');
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:/Welcome back/}).waitFor();
  await page.goto(ticketUrl);
  await page.getByLabel('Assignee',{exact:true}).selectOption({label:'Technician'});
  await page.getByLabel('Status',{exact:true}).selectOption('in_progress');
  await page.getByRole('button',{name:'Save workflow'}).click();
  await expect(page.getByLabel('Status',{exact:true})).toHaveValue('in_progress');
  await page.getByLabel('Internal note — visible to support staff').check();
  await page.getByLabel('Internal note',{exact:true}).fill('Private: checking the gateway configuration.');
  await page.getByRole('button',{name:'Add internal note',exact:true}).click();
  await page.locator('.ticket-comment').getByText('Private: checking the gateway configuration.',{exact:true}).waitFor();
  await expect(page.getByLabel('Internal note',{exact:true})).toBeEnabled({timeout:30000});
  await page.getByLabel('Internal note — visible to support staff').uncheck();
  await page.getByLabel('Reply',{exact:true}).fill('I updated your VPN profile. Please try connecting again.');
  await page.getByRole('button',{name:'Send reply',exact:true}).click();
  await page.locator('.ticket-comment').getByText('I updated your VPN profile. Please try connecting again.',{exact:true}).waitFor();
  await expect(page.getByLabel('Reply',{exact:true})).toBeEnabled({timeout:30000});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'docs/screenshots/ticket-detail.png',fullPage:true});
  await page.getByLabel('Status',{exact:true}).selectOption('resolved');
  await page.getByLabel('Resolution notes',{exact:true}).fill('Updated VPN profile and verified connectivity.');
  await page.getByRole('button',{name:'Save workflow'}).click();
  await page.getByRole('heading',{name:'Resolution',exact:true}).waitFor();
  await page.goto('http://127.0.0.1:5174/tickets');
  await page.getByRole('link',{name:/VPN disconnects/}).waitFor();
  await page.screenshot({path:'docs/screenshots/tickets.png',fullPage:true});
  await page.getByRole('button',{name:'Sign out'}).click();
  await page.getByLabel('Email address').fill('employee@example.test');
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('heading',{name:/Welcome back/}).waitFor();
  await page.goto(ticketUrl);
  await page.locator('.ticket-comment').getByText('I updated your VPN profile. Please try connecting again.',{exact:true}).waitFor();
  await expect(page.getByText('Private: checking the gateway configuration.',{exact:true})).toHaveCount(0);
  const download=await page.request.get(new URL(await page.getByRole('link',{name:'connection.txt',exact:true}).getAttribute('href'),page.url()).href);
  assert.equal(download.status(),200);
  assert.equal(await download.text(),'VPN connection refused on port 443.');
  await page.getByLabel('Reason to reopen').fill('The connection dropped again after ten minutes.');
  await page.getByRole('button',{name:'Reopen ticket',exact:true}).click();
  await expect(page.getByRole('button',{name:'Reopen ticket',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'docs/screenshots/ticket-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.goto('http://127.0.0.1:5174/');
  await page.getByRole('heading',{name:/Welcome back/}).waitFor();
  await page.setViewportSize({width:1440,height:1024});
  await page.screenshot({path:'docs/screenshots/helpdesk-dashboard.png',fullPage:true});
  assert.deepEqual(errors, []);
  console.log('Helpdesk lifecycle, private notes, attachment download, reopening, responsive layout passed. Foundation workflows passed: login, department creation, user creation/search/deactivation, theme, mobile layout, logout, and employee authorization.');
} finally {
  await browser?.close();
  php.kill(); vite.kill();
}

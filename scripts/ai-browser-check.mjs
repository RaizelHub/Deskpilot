import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 45000 });
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
  ...process.env, APP_ENV: 'local', APP_URL: 'http://127.0.0.1:5175', FRONTEND_URL: 'http://127.0.0.1:5175',
  DB_CONNECTION: 'pgsql', DB_URL: '', DB_DATABASE: 'deskpilot_browser_test',
  SESSION_DRIVER: 'database', CACHE_STORE: 'database', QUEUE_CONNECTION: 'database',
  DESKPILOT_DEMO_PASSWORD: password, AI_ENABLED:'true', AI_PROVIDER:'groq', AI_MODEL:'openai/gpt-oss-20b', GROQ_API_KEY:'browser-fixture-not-a-real-key', GEMINI_API_KEY:'', DESKPILOT_AI_BROWSER_FIXTURE:'1',
};
assert.equal(env.DB_DATABASE, 'deskpilot_browser_test');
execFileSync('php', ['-r', "require 'vendor/autoload.php'; $app=require 'bootstrap/app.php'; $app->make(Illuminate\\Contracts\\Console\\Kernel::class)->bootstrap(); if(Illuminate\\Support\\Facades\\DB::connection()->getDatabaseName() !== 'deskpilot_browser_test') {fwrite(STDERR, 'Refusing non-test database'); exit(1);}"], {cwd:server,env,stdio:'pipe',windowsHide:true});
execFileSync('php', ['artisan', 'migrate:fresh', '--force'], { cwd: server, env, stdio: 'pipe' });
execFileSync('php', ['artisan', 'db:seed', '--class=DemoSeeder', '--force'], { cwd: server, env, stdio: 'pipe' });
const php = spawn('php', ['-S', '127.0.0.1:8002', '-t', 'public'], { cwd: server, env, windowsHide: true, stdio: 'ignore' });
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:8002' }, windowsHide: true, stdio: 'ignore' });
async function ready(url) {
  for (let i = 0; i < 40; i++) { try { const response = await fetch(url); if (response.ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error(`Preview did not become ready: ${url}`);
}



let browser;
try {
 await ready('http://127.0.0.1:5175');await ready('http://127.0.0.1:8002/up');browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function login(email){await page.goto('http://127.0.0.1:5175/login');await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();}
 async function request(url,method='GET',body){return page.evaluate(async({url,method,body})=>{const token=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')??'');const r=await fetch('/api/v1'+url,{method,headers:{'Accept':'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json().catch(()=>null)};},{url,method,body});}
 await login('admin@example.test');await page.getByRole('link',{name:'Knowledge base',exact:true}).click();await page.getByRole('button',{name:'Write article'}).click();await page.getByLabel('Article title',{exact:true}).fill('DNS troubleshooting guide');await page.getByLabel('Summary',{exact:true}).fill('Use approved diagnostics to investigate DNS resolution failures.');await page.getByLabel('Category',{exact:true}).selectOption({label:'Networking'});await page.getByLabel('Article content (Markdown)',{exact:true}).fill('## Check the connection\n\n1. Confirm which websites are affected.\n2. Run the approved DNS test.\n3. Compare with the gateway test.\n\n**Record the results** before making changes.');await page.getByLabel('Tags (comma separated)').fill('dns, network');await page.getByLabel('Publication status').selectOption('published');await page.getByRole('button',{name:'Save article',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('link',{name:'DNS troubleshooting guide',exact:true}).click();await expect(page.locator('.knowledge-body strong')).toHaveText('Record the results');const staffArticleId=page.url().split('/').pop();
 await page.getByRole('button',{name:'Edit article'}).click();await page.getByLabel('Summary',{exact:true}).fill('Read-only DNS checks for the support team.');await page.getByRole('button',{name:'Save article',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await expect(page.getByText('Read-only DNS checks for the support team.',{exact:true})).toBeVisible();await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/knowledge-article.png',fullPage:true});
 const categories=(await request('/knowledge-categories')).data.data;assert.equal((await request('/knowledge','POST',{title:'Employee connection checklist',summary:'Steps to include in your support request.',body:'## Describe the problem\n\nRecord the affected application, the error message and when the problem began.',category_id:categories[0].id,visibility:'everyone',status:'published',tags:['support']})).status,201);
 await page.goto('http://127.0.0.1:5175/knowledge');await page.getByLabel('Search knowledge',{exact:true}).fill('DNS');await expect(page.getByRole('link',{name:'DNS troubleshooting guide',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Employee connection checklist',exact:true})).toHaveCount(0);await page.getByLabel('Search knowledge',{exact:true}).fill('');await expect(page.getByRole('link',{name:'Employee connection checklist',exact:true})).toBeVisible();await page.screenshot({path:'docs/screenshots/knowledge-base.png',fullPage:true});
 const opts=await request('/ticket-options');const ticket=await request('/tickets','POST',{title:'DNS resolution fails in the browser',description:'Websites fail to load. password=sample-secret user@example.test',priority:'medium',category_id:opts.data.categories[0].id});assert.equal(ticket.status,201);const ticketId=ticket.data.data.id;
 await page.goto(`http://127.0.0.1:5175/tickets/${ticketId}`);await page.getByRole('button',{name:'Review context for AI',exact:true}).click();const preview=page.locator('.ai-context');await expect(preview).toContainText('DNS troubleshooting guide');await expect(preview).not.toContainText('sample-secret');await expect(preview).not.toContainText('user@example.test');await page.screenshot({path:'docs/screenshots/ai-context-preview.png',fullPage:true});await page.getByRole('button',{name:'Send reviewed context',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await expect(page.getByText('Queued — waiting for the analysis worker.',{exact:true})).toBeVisible();
 execFileSync('php',[path.join(root,'scripts/ai-browser-worker.php')],{cwd:server,env,stdio:'pipe',windowsHide:true});await expect(page.getByText('[Test fixture] The ticket reports DNS resolution failures.',{exact:true})).toBeVisible();await expect(page.locator('.ai-result').getByRole('link',{name:'DNS troubleshooting guide'})).toBeVisible();assert.equal((await request(`/tickets/${ticketId}`)).data.data.version,1);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/screenshots/ai-ticket-fixture.png',fullPage:true});await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/ai-ticket-dark-fixture.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/ai-ticket-mobile-fixture.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').waitFor();await login('employee@example.test');await page.getByRole('link',{name:'Knowledge base',exact:true}).click();await expect(page.getByRole('link',{name:'Employee connection checklist',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'DNS troubleshooting guide',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Write article'})).toHaveCount(0);assert.equal((await request(`/knowledge/${staffArticleId}`)).status,404);assert.equal((await request(`/tickets/${ticketId}/ai`)).status,403);assert.deepEqual(errors,[]);
 console.log('Phase 9 browser check passed: article create/edit/search/render, staff visibility, context review/redaction, real queue with test provider fixture, validated analysis and citations, unchanged ticket, responsive light/dark/mobile UI. No live provider request made.');
} finally {await browser?.close();php.kill();vite.kill();}

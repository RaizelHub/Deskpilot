import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 45000 });
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

// This harness is confined to a dedicated disposable PostgreSQL database.
// Create deskpilot_browser_test before running it; it never uses the application database.

const root = process.cwd();
const server = path.join(root, 'apps/server');
const password = randomBytes(24).toString('hex') + 'Ab1!';
const env = {
  ...process.env, APP_ENV: 'local', APP_URL: 'http://127.0.0.1:5175', FRONTEND_URL: 'http://127.0.0.1:5175',
  DB_CONNECTION: 'pgsql', DB_DATABASE: 'deskpilot_browser_test',
  SESSION_DRIVER: 'database', CACHE_STORE: 'database', QUEUE_CONNECTION: 'database',
  DESKPILOT_DEMO_PASSWORD: password, AGENT_ALLOW_LOOPBACK_HTTP:'true',
};
assert.equal(env.DB_DATABASE, 'deskpilot_browser_test');
execFileSync('php', ['artisan', 'migrate:fresh', '--force'], { cwd: server, env, stdio: 'pipe' });
execFileSync('php', ['artisan', 'db:seed', '--class=DemoSeeder', '--force'], { cwd: server, env, stdio: 'pipe' });
const php = spawn('php', ['-S', '127.0.0.1:8002', '-t', 'public'], { cwd: server, env, windowsHide: true, stdio: 'ignore' });
const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5175', '--strictPort'], { cwd: path.join(root, 'apps/web'), env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:8002' }, windowsHide: true, stdio: 'ignore' });
async function ready(url) {
  for (let i = 0; i < 40; i++) { try { const response = await fetch(url); if (response.ok) return; } catch {} await new Promise(resolve => setTimeout(resolve, 500)); }
  throw new Error(`Preview did not become ready: ${url}`);
}

const dataRoot=path.resolve(root,'.local-tools');
const dataDir=path.join(dataRoot,'agent-smoke-'+randomBytes(8).toString('hex'));
const dotnet=process.env.DOTNET_EXECUTABLE??path.join(root,'.local-tools/dotnet/dotnet.exe');
const agent=path.join(root,'apps/agent/src/DeskPilot.Agent.Service/bin/Release/net10.0-windows/DeskPilot.Agent.Service.dll');
const agentEnv={...process.env,DOTNET_ROOT:path.dirname(dotnet),DOTNET_CLI_TELEMETRY_OPTOUT:'1'};
let browser;
let worker;
try {
 await ready('http://127.0.0.1:8002/up');await ready('http://127.0.0.1:5175');
 browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL??'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},timezoneId:'Asia/Taipei'});page.setDefaultTimeout(45000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5175');await page.getByLabel('Email address').fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();
 await page.getByRole('link',{name:'Devices',exact:true}).click();await page.getByRole('button',{name:'Enroll device',exact:true}).click();await page.getByLabel('Device display name').fill('Windows validation workstation');await page.getByRole('button',{name:'Create enrollment grant',exact:true}).click();
 const token=await page.getByLabel('Enrollment grant (shown once)').inputValue();assert.equal(token.length,64);
 execFileSync(dotnet,[agent,'enroll','--server','http://127.0.0.1:8002','--allow-loopback-http','--data-dir',dataDir],{env:agentEnv,input:token+'\n',stdio:['pipe','pipe','pipe'],windowsHide:true,timeout:60000});
 execFileSync(dotnet,[agent,'run','--once','--data-dir',dataDir],{env:agentEnv,stdio:'pipe',windowsHide:true,timeout:90000});
 const local=JSON.parse(await readFile(path.join(dataDir,'status.json'),'utf8'));assert.equal(local.state,'connected');
 const response=await page.request.get(`http://127.0.0.1:5175/api/v1/devices/${local.device_id}`);assert.equal(response.status(),200);const device=(await response.json()).data;


 assert.equal(device.agent_version,'0.7.0');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 const customer=await browser.newPage({viewport:{width:1100,height:900}});
 await customer.goto('http://127.0.0.1:5175/login');await customer.getByLabel('Email address').fill('employee@example.test');await customer.getByLabel('Password',{exact:true}).fill(password);await customer.getByRole('button',{name:'Sign in',exact:true}).click();await customer.getByRole('heading',{name:/Welcome back/}).waitFor();
 const options=await (await customer.request.get('http://127.0.0.1:5175/api/v1/ticket-options')).json();
 const ticket=await customer.evaluate(async ({category})=>{const token=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('XSRF-TOKEN=')).split('=').slice(1).join('='));const r=await fetch('/api/v1/tickets',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json','X-XSRF-TOKEN':token},body:JSON.stringify({title:'Remote support browser verification',description:'Please check my connection.',priority:'medium',category_id:category,tags:[]})});if(!r.ok)throw new Error(await r.text());return (await r.json()).data;},{category:options.categories[0].id});
 worker=spawn(dotnet,[agent,'run','--data-dir',dataDir],{env:agentEnv,stdio:'ignore',windowsHide:true});
 await page.goto('http://127.0.0.1:5175/remote-support');await page.getByLabel('Online device').selectOption(local.device_id);await page.getByLabel('Customer ticket').selectOption(ticket.id);await page.getByLabel('Requested access').selectOption('control');await page.getByLabel('Reason for support').fill('Check the customer connection with permission.');await page.getByRole('button',{name:'Send approval request',exact:true}).click();await page.waitForURL(/support-requests\//);
 const requestId=page.url().split('/').pop();
 await expect.poll(async()=>JSON.parse(await readFile(path.join(dataDir,'status.json'),'utf8')).support_request_id,{timeout:60000}).toBe(requestId);
 await expect(page.getByText('Device agent received the notification.',{exact:true})).toBeVisible();
 await customer.goto(`http://127.0.0.1:5175/support-requests/${requestId}`);await expect(customer.getByRole('button',{name:'Approve view only',exact:true})).toBeVisible();
 await mkdir('docs/screenshots',{recursive:true});await expect(customer.locator('.badge')).toHaveText('waiting for user');await customer.screenshot({path:'docs/screenshots/remote-approval.png',fullPage:true});
 await customer.getByRole('button',{name:'Approve view only',exact:true}).click();await expect(customer.getByText('Approved: view only. Sharing has not started.',{exact:true})).toBeVisible();
 await expect(page.getByText('Approved: view only. Sharing has not started.',{exact:true})).toBeVisible();
 const detail=await (await page.request.get(`http://127.0.0.1:5175/api/v1/remote-sessions/${requestId}`)).json();assert.equal(detail.capabilities.live_connections,false);assert.equal(detail.data.approved_mode,'view');assert.ok(detail.data.events.some(e=>e.action==='agent_received'));assert.ok(detail.data.events.some(e=>e.action==='viewed'));assert.equal(detail.data.status,'approved');assert.equal(detail.data.consent_ip,undefined);
 await customer.getByRole('button',{name:'Withdraw authorization',exact:true}).click();await expect(customer.getByText('Support authorization withdrawn. No remote connection was started.',{exact:true}).first()).toBeVisible();
 await page.goto('http://127.0.0.1:5175/remote-support');await page.getByLabel('Online device').selectOption(local.device_id);await page.getByLabel('Customer ticket').selectOption(ticket.id);await page.getByLabel('Reason for support').fill('Retry support after customer withdrawal.');await page.getByRole('button',{name:'Send approval request',exact:true}).click();await page.waitForURL(/support-requests\//);const second=page.url().split('/').pop();assert.notEqual(second,requestId);
 await customer.goto(`http://127.0.0.1:5175/support-requests/${second}`);await customer.getByRole('button',{name:'Decline',exact:true}).click();await expect(customer.getByText('The customer declined remote support.',{exact:true}).first()).toBeVisible();
 await page.goto('http://127.0.0.1:5175/remote-support');await expect(page.getByText('Loading workspace…',{exact:true})).toHaveCount(0);await expect(page.getByText('declined',{exact:true})).toBeVisible();await page.screenshot({path:'docs/screenshots/remote-support.png',fullPage:true});await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/remote-support-dark.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/remote-support-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.setViewportSize({width:1440,height:1000});
 assert.equal((await customer.request.get('http://127.0.0.1:5175/api/v1/remote-sessions')).status(),403);
 await page.goto(`http://127.0.0.1:5175/devices/${local.device_id}`);await page.getByRole('button',{name:'Revoke device',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Phase 6 temporary validation complete');await page.getByRole('button',{name:'Confirm revocation',exact:true}).click();await page.getByText('Device identity revoked',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Phase 6 approval workflow passed: real Windows signed poll and status notification, customer approval with control-to-view downgrade, withdrawal, decline, audit, employee isolation and responsive UI. Native tray interaction and live RustDesk transport are not tested.');
}finally{
 worker?.kill();await browser?.close();php.kill();vite.kill();
 if(path.dirname(path.resolve(dataDir))!==dataRoot)throw new Error('Refusing cleanup outside agent test directory');
 await rm(dataDir,{recursive:true,force:true});
}

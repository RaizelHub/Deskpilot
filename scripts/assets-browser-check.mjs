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
 const softwareResponse=await page.request.get(`http://127.0.0.1:5175/api/v1/software-inventory?device_id=${local.device_id}`);assert.equal(softwareResponse.status(),200);const software=await softwareResponse.json();assert.ok(software.total>0,'Real Windows software inventory must contain applications');assert.ok(software.data.every(s=>s.device.id===local.device_id&&s.last_detected_at));assert.equal(software.data[0].source_key,undefined);
 await page.getByRole('link',{name:'Assets',exact:true}).click();await page.getByRole('button',{name:'Add asset',exact:true}).click();
 const tag='IT-VERIFY-001';await page.getByLabel('Asset tag',{exact:true}).fill(tag);await page.getByLabel('Asset name',{exact:true}).fill('Finance laptop');await page.getByLabel('Manufacturer',{exact:true}).fill('Validation manufacturer');await page.getByLabel('Model',{exact:true}).fill('Office laptop');await page.getByLabel('Serial number',{exact:true}).fill('ASSET-CHECK-001');await page.getByLabel('Location',{exact:true}).fill('Finance office');
 const today=new Date();const purchase=new Date(today);purchase.setUTCFullYear(purchase.getUTCFullYear()-1);const warranty=new Date(today);warranty.setUTCDate(warranty.getUTCDate()+14);
 await page.getByLabel('Purchase date',{exact:true}).fill(purchase.toISOString().slice(0,10));await page.getByLabel('Warranty expiration',{exact:true}).fill(warranty.toISOString().slice(0,10));
 await page.getByLabel('Find enrolled device',{exact:true}).fill('Windows validation');await expect(page.getByLabel('Asset tag',{exact:true})).toHaveValue(tag);await page.getByLabel('Linked device',{exact:true}).selectOption(local.device_id);await page.getByLabel('Asset notes',{exact:true}).fill('Phase 7 browser validation equipment.');await page.getByRole('button',{name:'Save asset',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('link',{name:tag,exact:true}).click();await page.getByRole('heading',{name:'Finance laptop',exact:true}).waitFor();await expect(page.locator('.asset-state.expiring')).toBeVisible();const assetId=page.url().split('/').pop();
 await page.getByRole('button',{name:'Assign asset',exact:true}).click();await page.getByLabel('Find employee',{exact:true}).fill('Employee');await page.getByLabel('Assign to',{exact:true}).selectOption({label:'Employee'});await page.getByLabel('Assignment notes',{exact:true}).fill('Issued for finance work.');await page.getByRole('button',{name:'Confirm assignment',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await expect(page.getByRole('button',{name:'Reassign asset',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Reassign asset',exact:true}).click();await page.getByLabel('Find employee',{exact:true}).fill('Technician');await page.getByLabel('Assign to',{exact:true}).selectOption({label:'Technician'});await page.getByLabel('Assignment notes',{exact:true}).fill('Transferred to IT for maintenance.');await page.getByRole('button',{name:'Confirm assignment',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Return asset',exact:true}).click();await page.getByLabel('Status after return',{exact:true}).selectOption('repair');await page.getByLabel('Assignment notes',{exact:true}).fill('Returned with keyboard damage.');await page.getByRole('button',{name:'Confirm return',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await expect(page.locator('.asset-state.repair')).toBeVisible();
 const history=await (await page.request.get(`http://127.0.0.1:5175/api/v1/assets/${assetId}/assignments`)).json();assert.equal(history.total,2);assert.ok(history.data.every(a=>a.returned_at));assert.equal(history.data[0].return_notes,'Returned with keyboard damage.');
 await mkdir('docs/screenshots',{recursive:true});await expect(page.getByText('Loading workspace…',{exact:true})).toHaveCount(0);await page.screenshot({path:'docs/screenshots/asset-detail.png',fullPage:true});
 await page.getByRole('button',{name:'Edit asset',exact:true}).click();await page.getByLabel('Asset status',{exact:true}).selectOption('available');await page.getByLabel('Location',{exact:true}).fill('IT storage');await page.getByRole('button',{name:'Save asset',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await expect(page.getByRole('button',{name:'Assign asset',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'View detected software',exact:false}).click();await page.getByRole('heading',{name:'Software inventory',exact:true}).waitFor();await expect(page.getByText('Loading workspace…',{exact:true})).toHaveCount(0);await expect(page.locator('tbody tr').first()).toBeVisible();await page.screenshot({path:'docs/screenshots/software-inventory.png',fullPage:true});
 const appName=software.data[0].name;await page.getByLabel('Search software',{exact:true}).fill(appName);await expect(page.locator('tbody tr').first()).toContainText(appName);
 await page.goto('http://127.0.0.1:5175/assets');await page.getByLabel('Search assets',{exact:true}).fill(tag);await page.getByLabel('Filter warranty',{exact:true}).selectOption('expiring');await expect(page.getByRole('link',{name:tag,exact:true})).toBeVisible();await expect(page.getByText('Loading workspace…',{exact:true})).toHaveCount(0);await page.screenshot({path:'docs/screenshots/assets.png',fullPage:true});await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/assets-dark.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/assets-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').fill('technician@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();await page.goto(`http://127.0.0.1:5175/assets/${assetId}`);await page.getByRole('heading',{name:'Finance laptop',exact:true}).waitFor();await expect(page.getByRole('button',{name:'Edit asset',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').fill('employee@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();assert.equal((await page.request.get('http://127.0.0.1:5175/api/v1/assets')).status(),403);assert.equal((await page.request.get('http://127.0.0.1:5175/api/v1/software-inventory')).status(),403);
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').fill('admin@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();await page.goto(`http://127.0.0.1:5175/devices/${local.device_id}`);await page.getByRole('button',{name:'Revoke device',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Phase 7 temporary validation complete');await page.getByRole('button',{name:'Confirm revocation',exact:true}).click();await page.getByText('Device identity revoked',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('Phase 7 passed: actual Windows software report, asset creation/linking, warranty filter, assignment, reassignment, return, preserved history, edit, software search, role boundaries and responsive light/dark UI.');
}finally{
 worker?.kill();await browser?.close();php.kill();vite.kill();
 if(path.dirname(path.resolve(dataDir))!==dataRoot)throw new Error('Refusing cleanup outside agent test directory');
 await rm(dataDir,{recursive:true,force:true});
}

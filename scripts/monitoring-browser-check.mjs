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
 const evaluate=()=>execFileSync('php',['artisan','monitoring:evaluate'],{cwd:server,env,stdio:'pipe',windowsHide:true,timeout:60000});
 evaluate();evaluate();
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.getByRole('link',{name:'Alerts',exact:true}).click();
 await page.getByRole('heading',{name:'Alerts & device health',exact:true}).waitFor();
 await page.getByRole('button',{name:'Edit storage usage',exact:true}).click();
 // A lower test-only threshold guarantees a storage alert using actual disk measurements.
 await page.getByLabel('Warning above (%)').fill('10');await page.getByLabel('Critical above (%)').fill('95');await page.getByRole('button',{name:'Save rule',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 // New rule thresholds qualify against a fresh inventory observation.
 execFileSync(dotnet,[agent,'run','--once','--data-dir',dataDir],{env:agentEnv,stdio:'pipe',windowsHide:true,timeout:90000});
 const monitoringDevice=(await (await page.request.get(`http://127.0.0.1:5175/api/v1/devices/${local.device_id}`)).json()).data;
 evaluate();evaluate();await page.getByRole('button',{name:'Refresh',exact:true}).click();
 const alertResponse=await page.request.get(`http://127.0.0.1:5175/api/v1/alerts?device_id=${local.device_id}&kind=disk`);assert.equal(alertResponse.status(),200);const diskAlerts=(await alertResponse.json()).data;assert.ok(diskAlerts.length>0);assert.ok(diskAlerts.every(a=>a.ticket&&a.occurrences===1));
 const incidentIds=diskAlerts.map(a=>a.ticket.id);
 const first=page.locator('.monitor-alert').first();await first.getByRole('button',{name:'Acknowledge',exact:true}).click();await expect(first.locator('.monitor-status.acknowledged')).toBeVisible();
 await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/monitoring.png',fullPage:true});await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/monitoring-dark.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/monitoring-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.setViewportSize({width:1440,height:1000});
 await first.getByRole('link',{name:/INC-/}).click();await expect(page.getByText(/Requested by DeskPilot monitoring/)).toBeVisible();await expect(page.getByText('Loading workspace…',{exact:true})).toHaveCount(0);await page.screenshot({path:'docs/screenshots/monitoring-incident.png',fullPage:true});
 // No worker is running. Wait for the real heartbeat deadline; no fabricated last_seen_at.
 const delay=Math.max(0,new Date(monitoringDevice.last_seen_at).getTime()+182000-Date.now());if(delay)await new Promise(resolve=>setTimeout(resolve,delay));evaluate();evaluate();
 const offline=await page.request.get(`http://127.0.0.1:5175/api/v1/alerts?device_id=${local.device_id}&kind=offline`);const offlineAlerts=(await offline.json()).data;assert.equal(offlineAlerts.length,1);assert.ok(offlineAlerts[0].ticket);
 execFileSync(dotnet,[agent,'run','--once','--data-dir',dataDir],{env:agentEnv,stdio:'pipe',windowsHide:true,timeout:90000});evaluate();
 const recovered=await page.request.get(`http://127.0.0.1:5175/api/v1/alerts?device_id=${local.device_id}&kind=offline&status=recovered`);const recoveredAlerts=(await recovered.json()).data;assert.equal(recoveredAlerts.length,1);assert.equal(recoveredAlerts[0].ticket.id,offlineAlerts[0].ticket.id);assert.equal(recoveredAlerts[0].ticket.status,'open');
 const repeat=await page.request.get(`http://127.0.0.1:5175/api/v1/alerts?device_id=${local.device_id}&kind=disk`);assert.deepEqual((await repeat.json()).data.map(a=>a.ticket.id).sort(),incidentIds.sort());
 await page.goto(`http://127.0.0.1:5175/devices/${local.device_id}`);await expect(page.getByRole('heading',{name:/Device health/})).toBeVisible();await page.getByRole('button',{name:'Revoke device',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Phase 5 temporary validation complete');await page.getByRole('button',{name:'Confirm revocation',exact:true}).click();await page.getByText('Device identity revoked',{exact:true}).waitFor();evaluate();
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').fill('employee@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();assert.equal((await page.request.get('http://127.0.0.1:5175/api/v1/alerts')).status(),403);
 assert.deepEqual(errors,[]);console.log('Phase 5 real Windows monitoring passed: actual disk alerts, deduplicated automatic incidents, acknowledgement, rule editor, actual offline deadline, fresh-heartbeat recovery, ticket retention, device health, revocation, employee isolation and responsive light/dark UI.');
}finally{
 worker?.kill();await browser?.close();php.kill();vite.kill();
 if(path.dirname(path.resolve(dataDir))!==dataRoot)throw new Error('Refusing cleanup outside agent test directory');
 await rm(dataDir,{recursive:true,force:true});
}

import { chromium, expect } from '@playwright/test';
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
 worker=spawn(dotnet,[agent,'run','--data-dir',dataDir],{env:agentEnv,stdio:'ignore',windowsHide:true});
 const firstReceipt=new Date(device.last_seen_at).getTime();let periodic=false;
 for(let i=0;i<50;i++){await new Promise(resolve=>setTimeout(resolve,2000));const check=await page.request.get(`http://127.0.0.1:5175/api/v1/devices/${local.device_id}`);const latest=(await check.json()).data;if(new Date(latest.last_seen_at).getTime()-firstReceipt>=60000){periodic=true;break;}}
 assert.equal(periodic,true,'Background worker must send a subsequent scheduled heartbeat');
 await new Promise(resolve=>{worker.once('exit',resolve);worker.kill();});worker=null;
 assert.equal(device.hostname,os.hostname());assert.equal(device.state,'online');assert.ok(device.hardware.os_name?.includes('Windows'));assert.ok(device.hardware.ram_total_bytes>0);assert.ok(device.hardware.cpu_name);assert.ok(device.disks.length>0);assert.ok(device.interfaces.length>0);assert.ok(device.cpu_percent>=0&&device.cpu_percent<=100);
 await page.getByRole('button',{name:'Done',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('link',{name:/Windows validation workstation/}).waitFor();await expect(page.locator('.metric').filter({hasText:'Online devices'}).locator('strong')).toHaveText('1',{timeout:15000});
 await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/devices.png',fullPage:true});
 await page.getByRole('link',{name:/Windows validation workstation/}).click();await page.getByRole('heading',{name:'Hardware & operating system',exact:true}).waitFor();await page.screenshot({path:'docs/screenshots/device-detail.png',fullPage:true});
 await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/device-dark.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/device-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Revoke device',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Temporary validation complete');await page.getByRole('button',{name:'Confirm revocation',exact:true}).click();await page.getByText('Device identity revoked',{exact:true}).waitFor();
 let rejected=false;try{execFileSync(dotnet,[agent,'run','--once','--data-dir',dataDir],{env:agentEnv,stdio:'pipe',windowsHide:true,timeout:60000});}catch(e){rejected=e.status===3;}assert.equal(rejected,true,'Revoked identity must be rejected by the real server');
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').fill('employee@example.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();assert.equal((await page.request.get('http://127.0.0.1:5175/api/v1/devices')).status(),403);
 assert.deepEqual(errors,[]);console.log('Real Windows agent passed: enrollment, DPAPI persistence, signed heartbeat, hardware/storage/network inventory, device UI, mobile layout, revocation and employee isolation.');
}finally{
 worker?.kill();await browser?.close();php.kill();vite.kill();
 if(path.dirname(path.resolve(dataDir))!==dataRoot)throw new Error('Refusing cleanup outside agent test directory');
 await rm(dataDir,{recursive:true,force:true});
}

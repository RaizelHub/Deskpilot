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

 assert.equal(device.agent_version,'0.7.0');
 await page.getByRole('button',{name:'Done',exact:true}).click();
 await page.goto(`http://127.0.0.1:5175/devices/${local.device_id}`);
 await page.getByRole('link',{name:'Run diagnostics',exact:true}).click();
 await page.getByRole('heading',{name:'Diagnostics',exact:true}).waitFor();
 await page.getByLabel('Reason for this check').fill('Validate read-only diagnostics on the enrolled Windows host');
 await page.getByRole('button',{name:'Run diagnostic',exact:true}).click();
 await page.getByRole('button',{name:'Cancel queued check',exact:true}).click();
 await expect(page.locator('.diagnostic-result .diagnostic-status').first()).toHaveText('cancelled');
 const commands=['network.ping_gateway','network.test_internet','network.test_dns','network.ip_configuration','network.dhcp_information','network.traceroute','system.check_disk'];
 for(const command of commands){
  await page.getByLabel('Diagnostic check',{exact:true}).selectOption(command);
  await page.getByRole('button',{name:'Run diagnostic',exact:true}).click();
  await expect(page.getByText('Check queued. Results will appear automatically.',{exact:true})).toBeVisible();
 }
 worker=spawn(dotnet,[agent,'run','--data-dir',dataDir],{env:agentEnv,stdio:'ignore',windowsHide:true});
 let results=[];
 for(let i=0;i<90;i++){
  await new Promise(resolve=>setTimeout(resolve,2000));
  const response=await page.request.get(`http://127.0.0.1:5175/api/v1/devices/${local.device_id}/diagnostics`);
  assert.equal(response.status(),200);results=(await response.json()).data.filter(r=>r.status!=='cancelled');
  if(results.length===7&&results.every(r=>['succeeded','failed','rejected','expired'].includes(r.status)))break;
 }
 assert.equal(results.length,7);
 for(const result of results){assert.ok(['succeeded','failed'].includes(result.status),`${result.command}: ${result.status} / ${result.summary}`);assert.ok(result.result?.length>0);assert.equal(result.attempts,1);}
 for(const command of ['network.ip_configuration','network.dhcp_information','system.check_disk'])assert.equal(results.find(r=>r.command===command).status,'succeeded');
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.locator('.diagnostic-run').filter({hasText:'Disk check'}).click();
 await expect(page.locator('.diagnostic-check').first()).toBeVisible();
 await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/diagnostics.png',fullPage:true});
 await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/diagnostics-dark.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/diagnostics-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log('Phase 4 Windows diagnostics: cancellation, seven allowlisted checks, signed dispatch/results, responsive light/dark UI.');
 console.log(results.map(r=>`${r.command}: ${r.status} (${r.result.length} measurements)`).join('\n'));
}finally{
 worker?.kill();await browser?.close();php.kill();vite.kill();
 if(path.dirname(path.resolve(dataDir))!==dataRoot)throw new Error('Refusing cleanup outside agent test directory');
 await rm(dataDir,{recursive:true,force:true});
}

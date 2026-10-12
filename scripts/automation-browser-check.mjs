import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 45000 });
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
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
  DESKPILOT_DEMO_PASSWORD: password, WEBHOOK_ALLOW_LOOPBACK_HTTP:'true',
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


let browser;let secret='';let responseStatus=400;const received=[];
const receiver=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const timestamp=req.headers['x-deskpilot-timestamp'];const expected='sha256='+createHmac('sha256',secret).update(timestamp+'.'+body).digest('hex');const actual=req.headers['x-deskpilot-signature']??'';const valid=actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected))&&Math.abs(Date.now()/1000-Number(timestamp))<300;if(valid)received.push({id:req.headers['x-deskpilot-delivery'],body:JSON.parse(body)});res.writeHead(valid?responseStatus:401);res.end();});
const work=()=>new Promise((resolve,reject)=>{const child=spawn('php',['artisan','queue:work','--once','--tries=1','--timeout=20'],{cwd:server,env,windowsHide:true,stdio:'pipe'});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(output)));});
function dispatch(){execFileSync('php',['artisan','automation:dispatch'],{cwd:server,env,stdio:'pipe',windowsHide:true});}
try{
 await new Promise(resolve=>receiver.listen(8099,'127.0.0.1',resolve));await ready('http://127.0.0.1:5175');await ready('http://127.0.0.1:8002/up');
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function login(email){await page.goto('http://127.0.0.1:5175/login');await page.getByLabel('Email address').fill(email);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:/Welcome back/}).waitFor();}
 async function request(url,method='GET',body){return page.evaluate(async({url,method,body})=>{const token=decodeURIComponent(document.cookie.split('; ').find(c=>c.startsWith('XSRF-TOKEN='))?.split('=').slice(1).join('=')??'');const r=await fetch('/api/v1'+url,{method,headers:{'Accept':'application/json','Content-Type':'application/json','X-XSRF-TOKEN':token},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json().catch(()=>null)};},{url,method,body});}
 await login('admin@example.test');await page.getByRole('link',{name:'Automation',exact:true}).click();await page.getByRole('button',{name:'Add webhook',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Local n8n receiver check');await page.getByLabel('Receiver URL',{exact:true}).fill('http://127.0.0.1:8099/deskpilot');await page.getByRole('button',{name:'Save webhook',exact:true}).click();secret=await page.getByLabel('Signing secret',{exact:true}).inputValue();assert.equal(secret.length,64);await page.getByRole('button',{name:'I have saved the secret'}).click();await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Enable webhook',{exact:false}).check();await page.getByRole('button',{name:'Save webhook',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 const queued=page.waitForResponse(r=>r.url().endsWith('/test')&&r.request().method()==='POST');await page.getByRole('button',{name:'Send test',exact:true}).click();assert.equal((await queued).status(),202);dispatch();await work();assert.equal(received.length,1);
 await page.reload();await page.getByRole('button',{name:'Inspect',exact:true}).first().click();await expect(page.getByText('webhook.test · failed',{exact:true})).toBeVisible();responseStatus=204;await page.getByRole('button',{name:'Retry with current receiver'}).click();await expect(page.getByText('webhook.test · pending',{exact:true})).toBeVisible();dispatch();await work();await expect(page.getByText('webhook.test · succeeded',{exact:true})).toBeVisible();assert.equal(received.length,2);assert.equal(received[0].id,received[1].id);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Add rule',exact:true}).click();await page.getByLabel('Rule name',{exact:true}).fill('New ticket acknowledgement');await page.getByLabel('Event',{exact:true}).selectOption('ticket.created');await page.getByLabel('Recipients',{exact:true}).selectOption('ticket_requester');await page.getByRole('button',{name:'Save rule',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 await expect(page.locator('tbody tr').first()).toContainText('succeeded');await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/automation.png',fullPage:true});await page.getByRole('button',{name:'Use dark mode'}).click();await page.screenshot({path:'docs/screenshots/automation-dark.png',fullPage:true});await page.getByRole('button',{name:'Use light mode'}).click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/automation-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Sign out'}).click();await page.getByLabel('Email address').waitFor();await login('employee@example.test');assert.equal((await request('/automation')).status,403);const options=await request('/ticket-options');const category=options.data.categories[0].id;const ticket=await request('/tickets','POST',{title:'Automation verification ticket',description:'Customer notification verification request.',priority:'high',category_id:category});assert.equal(ticket.status,201);await page.goto('http://127.0.0.1:5175/notifications');await expect(page.getByText('Ticket created',{exact:false}).first()).toBeVisible();await page.screenshot({path:'docs/screenshots/notifications.png',fullPage:true});await page.getByRole('button',{name:'Mark all as read'}).click();await expect(page.getByText('0 unread',{exact:true})).toBeVisible();dispatch();await work();assert.equal(received.length,3);assert.equal(received[2].body.event,'ticket.created');assert.equal(received[2].body.data.ticket_id,ticket.data.data.id);assert.deepEqual(errors,[]);
 console.log('Phase 8 browser check passed: create/enable webhook, real queued HTTP delivery, HMAC verification, terminal failure/manual retry with stable ID, rule creation, employee inbox/read-all, ticket event, admin boundary, desktop/dark/mobile layouts.');
}finally{await browser?.close();receiver.close();php.kill();vite.kill();}

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const vite=spawn(process.execPath,['../../node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5186','--strictPort'],{cwd:'apps/web',windowsHide:true,stdio:'ignore'});
let browser;
try {
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:5186')).ok)break;}catch{}await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));let signedIn=true;
 await page.route('**/api/v1/**',async route=>{
 const p=new URL(route.request().url()).pathname.replace('/api/v1','');
 const permissions=['dashboard.view','tickets.view','tickets.create','devices.view','remote.request','monitoring.view','assets.view','knowledge.view','automation.view','settings.manage','audit.view','users.view','departments.view','roles.view'];
 let body={data:[],unread_count:2};let status=200;
 if(p==='/auth/me'){body={user:{id:'fixture',name:'Morgan Ellis',email:'fixture@example.test',email_verified_at:'2026-10-13',roles:[{name:'Administrator'}],department:{name:'Client services'}},permissions};if(!signedIn){status=401;body={message:'Unauthenticated'};}}
 if(p==='/dashboard')body={tickets:{open:24,in_progress:8,overdue:2,resolved_today:12,critical:1,unassigned:4,average_resolution_minutes:38,volume:Array.from({length:7},(_,i)=>({date:`2026-10-${String(i+7).padStart(2,'0')}`,count:[4,8,6,12,7,5,9][i]})),recent:[]}};
 if(p==='/devices')body={data:Array.from({length:8},(_,i)=>({id:`fixture-${i}`,name:`Support workstation ${i+1}`,hostname:`DESK-${i+1}`,state:i===7?'offline':'online',agent_version:'0.7.0',cpu_percent:12+i*9,ram_available_bytes:4e9,hardware:{os_name:'Windows 11',ram_total_bytes:16e9},disks:[{total_bytes:512e9,free_bytes:(300-i*20)*1e9}],department:{name:'Client services'},last_seen_at:'2026-10-13T03:00:00Z'})),total:8,last_page:1};
 if(p==='/device-statistics')body={total:32,online:29,offline:2,pending:1};
 if(p==='/monitoring-statistics')body={active:3,critical:1,acknowledged:2,recovered_today:4,stale:false,evaluated_at:null};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 await mkdir('docs/screenshots',{recursive:true});
 await page.addInitScript(()=>localStorage.setItem('deskpilot-preferences',JSON.stringify({state:{dark:false,sidebarCollapsed:false},version:0})));await page.goto('http://127.0.0.1:5186');await page.getByRole('heading',{name:'Welcome back, Morgan'}).waitFor();
 assert.ok(await page.locator('.nav-group-list svg.lucide').count()>10);await page.getByRole('button',{name:'Operations',exact:true}).click();assert.equal(await page.getByRole('link',{name:'Assets',exact:true}).isVisible(),false);await page.getByRole('button',{name:'Operations',exact:true}).click();assert.equal(await page.getByRole('link',{name:'Assets',exact:true}).isVisible(),true);
 await page.screenshot({path:'docs/screenshots/redesign-desktop-fixture.png',fullPage:true});
 await page.getByRole('button',{name:'Compact navigation',exact:true}).click();assert.equal(await page.getByRole('link',{name:'Permissions',exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'Dark mode',exact:true}).click();await page.screenshot({path:'docs/screenshots/redesign-dark-fixture.png',fullPage:true});await page.getByRole('link',{name:'Devices',exact:true}).click();await page.getByText('Support workstation 1',{exact:true}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Device page overflow');await page.screenshot({path:'docs/screenshots/reference-devices-dark-fixture.png',fullPage:false});await page.getByRole('link',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Light mode',exact:true}).click();
 await page.getByRole('button',{name:'Search workspace'}).click();await page.getByPlaceholder('Type a command, search pages, or trigger actions…').fill('tickets');await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/redesign-mobile-fixture.png',fullPage:true}); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile overflow');
 await page.getByRole('button',{name:'Menu',exact:true}).click();assert.equal(await page.locator('.app-sidebar').evaluate(e=>Math.round(e.getBoundingClientRect().left)),0,'Drawer must be onscreen');await page.getByRole('button',{name:'Close',exact:true}).waitFor({state:'visible'});await page.screenshot({path:'docs/screenshots/redesign-mobile-navigation-fixture.png',fullPage:true});await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Menu',exact:true}).getAttribute('aria-expanded'),'false');await page.screenshot({path:'docs/screenshots/redesign-mobile-fixture.png',fullPage:true});
 signedIn=false;await page.goto('http://127.0.0.1:5186/login');await page.getByRole('heading',{name:'Sign in to DeskPilot'}).waitFor();await page.getByRole('button',{name:'Show password'}).click();assert.equal(await page.locator('#password').getAttribute('type'),'text');await page.screenshot({path:'docs/screenshots/redesign-login-mobile-fixture.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('UI fixture checks passed: desktop, compact navigation, themes, search, mobile overflow, Escape dismissal, password visibility.');
}finally{await browser?.close();vite.kill();}

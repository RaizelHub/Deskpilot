import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const workflow=JSON.parse(await readFile(new URL('../infrastructure/n8n/deskpilot-events.json',import.meta.url),'utf8'));
const code=workflow.nodes.find(n=>n.name==='Verify signature').parameters.jsCode;
const run=new (Object.getPrototypeOf(async function(){}).constructor)('require','$env','$input',code);
const secret=randomBytes(32).toString('hex');const raw=Buffer.from(JSON.stringify({id:randomUUID(),event:'ticket.created',data:{number:'INC-test'}}));const time=String(Math.floor(Date.now()/1000));
const headers={'x-deskpilot-timestamp':time,'x-deskpilot-signature':'sha256='+createHmac('sha256',secret).update(time+'.').update(raw).digest('hex'),'x-deskpilot-event':'ticket.created','x-deskpilot-delivery':randomUUID()};
async function check(h=headers,b=raw,s=secret){return (await run.call({helpers:{getBinaryDataBuffer:async()=>b}},createRequire(import.meta.url),{DESKPILOT_WEBHOOK_SECRET:s},{first:()=>({json:{headers:h}})}))[0].json;}
assert.equal((await check()).status,200);assert.equal((await check({...headers,'x-deskpilot-signature':'sha256='+'0'.repeat(64)})).status,401);assert.equal((await check(headers,Buffer.from(raw+' '))).status,401);assert.equal((await check({...headers,'x-deskpilot-timestamp':'1'})).status,401);assert.equal((await check({...headers,'x-deskpilot-event':'remote.started'})).status,401);await assert.rejects(()=>check(headers,raw,''));assert.equal(workflow.active,false);console.log('n8n verifier: valid signature, altered body, wrong signature, stale timestamp, event mismatch and absent configuration checked. Runtime import still requires a configured n8n instance.');

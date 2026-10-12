import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';

try { await access('.env'); console.log('Root .env already exists; preserving it.'); }
catch {
  const template = await readFile('.env.example', 'utf8');
  await writeFile('.env', template.replace('APP_KEY=', `APP_KEY=base64:${randomBytes(32).toString('base64')}`).replace('DB_PASSWORD=', `DB_PASSWORD=${randomBytes(32).toString('hex')}`), { flag: 'wx' });
  console.log('Created local .env with generated secrets. Values are not printed.');
}
try { await access('apps/server/.env'); }
catch {
  const rootEnv = await readFile('.env', 'utf8');
  const values = Object.fromEntries(rootEnv.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
  const template = await readFile('apps/server/.env.example', 'utf8');
  await writeFile('apps/server/.env', template.replace(/^APP_KEY=.*$/m, `APP_KEY=${values.APP_KEY}`).replace(/^DB_PASSWORD=.*$/m, `DB_PASSWORD=${values.DB_PASSWORD}`), { flag: 'wx' });
  console.log('Created server .env for native development. Existing files are never overwritten.');
}

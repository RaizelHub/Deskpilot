const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const document = {
  querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', value: '', showModal() {}, close() {}, focus() {}, classList: { toggle() {} } });
    return nodes.get(selector);
  },
  querySelectorAll: () => [],
  addEventListener() {},
};
let saved;
const context = vm.createContext({ document, localStorage: { getItem() { return null; }, setItem(key, value) { saved = JSON.parse(value); } } });
vm.runInContext(fs.readFileSync('dist/app.js', 'utf8'), context);
for (const page of ['Overview', 'Tickets', 'Devices', 'Remote support', 'Automations', 'Knowledge base', 'Reports']) {
  vm.runInContext(`page = ${JSON.stringify(page)}; shell()`, context);
  if (!nodes.get('#page').innerHTML.length) throw Error(page);
  console.log(`${page}: rendered`);
}
vm.runInContext('query="no-match";page="Tickets";renderPage()', context);
if (!nodes.get('#page').innerHTML.includes('No tickets match')) throw Error('Empty search state missing');
vm.runInContext('ticketDetail(1042)', context);
document.querySelector('#ticket-status').value = 'Resolved';
nodes.get('#save-status').onclick();
if (saved.find(t => t.id === 1042).status !== 'Resolved') throw Error('Status not persisted');
vm.runInContext('newTicket()', context);
if (!nodes.get('#dialog').innerHTML.includes('Create a ticket')) throw Error('Ticket form missing');
console.log('Search, ticket status persistence, and dialog smoke checks passed.');

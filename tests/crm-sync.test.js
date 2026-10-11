const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeLead, crmPayload, createCrmOutbox } = require('../crm-sync');
const endpoint = 'https://crm.verkoop.studio/api/public/inbound-lead';
const log = { info() {}, error() {} };
const input = { type: 'starterspakket', voornaam: 'Alex', naam: 'Example', email: 'ALEX@example.test', telefoon: '+32 400 00 00 00', doel: 'Kennismaken' };

for (const type of ['starterspakket', 'nieuwsbrief', 'boxing-lidmaatschap', 'boxing-nieuwsbrief']) {
  test(`maps ${type} to a distinct source in the CRM`, () => {
    const lead = normalizeLead({ ...input, type });
    const result = crmPayload(lead, 'submission-id', '2026-10-11T12:00:00Z');
    assert.equal(result.email, 'alex@example.test');
    assert.equal(result.phone, '+32400000000');
    assert.equal(result.company, 'Alex Example');
    assert.equal(result.contactType, 'person');
    assert.equal(result.submissionId, 'submission-id');
    assert.match(result.campaign, type.startsWith('boxing') ? /Boksen/ : /Fitness/);
    assert.match(result.notes, /Kennismaken/);
  });
}
test('newsletter and phone-only leads do not become one shared Healthfactor account', () => {
  assert.equal(crmPayload(normalizeLead({ type: 'nieuwsbrief', email: 'one@example.test' }), 'id', 'date').company, 'one@example.test');
  assert.equal(crmPayload(normalizeLead({ type: 'starterspakket', telefoon: '0400 12 34 56' }), 'id', 'date').company, '0400123456');
});
test('rejects invalid forms and oversized or malformed contact data', () => {
  for (const data of [{...input,type:'unknown'}, {...input,email:'invalid'}, {...input,email:{ value:'a' }}, {...input,email:'',telefoon:'abc'}, {...input,doel:'x'.repeat(3001)}]) assert.throws(() => normalizeLead(data));
});
test('keeps the intake secret on the server and refuses redirects to other destinations', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-crm-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => createCrmOutbox({directory,token:'secret',endpoint:'https://other.example/lead'}));
  let options;
  const box = createCrmOutbox({directory,token:'secret',endpoint,log,fetchImpl:async (url, o) => { assert.equal(url,endpoint); options=o; return Response.json({status:'created',leadId:'lead'}); }});
  box.enqueue(normalizeLead(input));
  await box.flush();
  assert.equal(options.headers['x-inbound-token'],'secret');
  assert.equal(options.redirect,'error');
  assert.equal(JSON.parse(options.body).token,undefined);
  assert.deepEqual(fs.readdirSync(directory),[]);
});
test('retries a persisted submission after restart with the same id and payload', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-crm-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time=100000; const attempts=[];
  const failed=createCrmOutbox({directory,token:'secret',endpoint,log,now:()=>time,fetchImpl:async (_,o) => {attempts.push(o.body); throw new Error('timeout');}});
  const id=failed.enqueue(normalizeLead(input));
  await Promise.all([failed.flush(),failed.flush()]);
  assert.equal(attempts.length,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,`${id}.json`))).attempts,1);
  time+=30001;
  const restarted=createCrmOutbox({directory,token:'secret',endpoint,log,now:()=>time,fetchImpl:async (_,o)=>{attempts.push(o.body);return Response.json({status:'created',leadId:'lead'});}});
  await restarted.flush();
  assert.equal(attempts[0],attempts[1]);
  assert.deepEqual(fs.readdirSync(directory),[]);
});
test('retains rejected submissions for inspection without retrying permanent payload errors', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-crm-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let calls=0;
  const box=createCrmOutbox({directory,token:'secret',endpoint,log,fetchImpl:async ()=>{calls++;return new Response('',{status:400});}});
  const id=box.enqueue(normalizeLead(input));
  await box.flush(); await box.flush();
  assert.equal(calls,1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,`${id}.json`))).failed,true);
});

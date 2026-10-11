const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('website forms still save leads and private server files cannot be downloaded', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hf-server-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT:'0', HEALTHFACTOR_DATA_DIR:directory, RAILWAY_VOLUME_MOUNT_PATH:'', RAILWAY_ENVIRONMENT_ID:'', RESEND_API_KEY:'', CRM_INBOUND_TOKEN:'', CRM_INBOUND_URL:'' },
    stdio:['ignore','pipe','pipe'],
  });
  t.after(() => { child.kill(); fs.rmSync(directory, {recursive:true,force:true}); });
  const port = await new Promise((resolve,reject) => {
    const timeout=setTimeout(()=>reject(new Error('server did not start')),10000);
    child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`server exited ${code}`));});
    child.stdout.on('data',chunk=>{const match=chunk.toString().match(/poort (\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  const base=`http://127.0.0.1:${port}`;
  for(const page of ['/', '/boxing.html']) assert.equal((await fetch(base+page)).status,200);
  for(const filename of ['/server.js','/crm-sync.js','/.env','/.git/config','/leads.csv','/crm-pending/test.json','/tests/server.test.js']) {
    assert.equal((await fetch(base+filename)).status,403,filename);
  }
  const response=await fetch(base+'/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'boxing-lidmaatschap',voornaam:'Synthetic',naam:'Test',email:'synthetic@example.test'})});
  assert.equal(response.status,200);
  assert.equal((await response.json()).ok,true);
  assert.match(fs.readFileSync(path.join(directory,'leads.csv'),'utf8'),/boxing-lidmaatschap/);
  const invalid=await fetch(base+'/api/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'unknown',email:'synthetic@example.test'})});
  assert.equal(invalid.status,400);
});

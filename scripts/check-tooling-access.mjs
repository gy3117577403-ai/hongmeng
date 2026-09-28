import assert from 'node:assert/strict';
const base=process.env.TOOLING_QA_BASE||'http://127.0.0.1:3150';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Local disposable runtime only');
const password=process.env.SEED_ADMIN_PASSWORD;
for(const [username,writable] of [['tooling-qa-read',false],['tooling-qa-collaborate',true]]){
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username,password})});
  assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
  const get=await fetch(base+'/api/terminal-tooling/inventory',{headers:{Cookie:cookie}});assert.equal(get.status,200);
  const page=await fetch(base+'/tooling-mobile',{headers:{Cookie:cookie}});assert.equal(page.status,200);assert.ok((await page.text()).includes('手机端子调模'));
  const cmd=await fetch(base+'/api/terminal-tooling/worklog',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({key:crypto.randomUUID(),action:'START',kind:'ASSIST',description:'',category:''})});
  assert.equal(cmd.status,writable?400:403);
  const inventory=await fetch(base+'/api/terminal-tooling/inventory',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({key:crypto.randomUUID(),action:'MOVE',units:[]})});
  assert.equal(inventory.status,writable?400:403);
  console.log(username+': mobile/read/write boundaries passed');
}
const anonymous=await fetch(base+'/api/terminal-tooling/worklog');
assert.equal(anonymous.status,401);
console.log('Anonymous access denied');

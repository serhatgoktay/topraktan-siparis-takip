import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('Gerçek Supabase test aracı hosted projeyi ağa çıkmadan reddeder',()=>{
 const dir=mkdtempSync(join(tmpdir(),'topraktan-guard-'));
 try{
  const file=join(dir,'status.json');writeFileSync(file,JSON.stringify({API_URL:'https://example.supabase.co',ANON_KEY:'test',SERVICE_ROLE_KEY:'test'}));
  const result=spawnSync(process.execPath,['scripts/check-real-supabase.mjs'],{encoding:'utf8',env:{...process.env,LOCAL_SUPABASE_STATUS_FILE:file}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Only a loopback Supabase endpoint/);assert.doesNotMatch(result.stdout,/PASS:/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

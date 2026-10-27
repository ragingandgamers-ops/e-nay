import test from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {passwordHash} from '../server/worker.mjs';
test('simultaneous password checks wait instead of rejecting every request after the first two',async()=>{
 const password='Fictional-concurrent-password!';
 const hashes=await Promise.all(Array.from({length:8},()=>passwordHash(password)));
 assert.equal(new Set(hashes).size,8);
 for(const encoded of hashes){const parts=encoded.split('$');assert.equal(parts.slice(0,4).join('$'),'scrypt$32768$8$3');assert.equal(parts[5],scryptSync(password,parts[4],64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex'));}
});

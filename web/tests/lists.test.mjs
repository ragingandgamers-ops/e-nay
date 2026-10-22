import test from 'node:test';
import assert from 'node:assert/strict';
import {pageItems,orderItems,searchText} from '../dist/lists.mjs';
test('pagination clamps pages after filtering and preserves source arrays',()=>{
 const records=Array.from({length:23},(_,i)=>({id:i}));
 assert.deepEqual(pageItems(records,2).items.map(r=>r.id),[10,11,12,13,14,15,16,17,18,19]);
 assert.equal(pageItems(records,99).page,3);assert.equal(pageItems(records,99).start,21);
 assert.equal(pageItems(records.slice(0,2),3).page,1);
 assert.deepEqual(pageItems([],3),{items:[],page:1,pages:1,total:0,start:0,end:0});
 assert.equal(records[0].id,0);assert.equal(records.length,23);
});
test('sorting is deterministic for duplicate names and undated records',()=>{
 const records=[{id:'M003',name:'Ana'},{id:'M002',name:'Ana',date:'2026-01-02'},{id:'M001',name:'Bea',date:'2026-01-01'}];
 assert.deepEqual(orderItems(records).map(r=>r.id),['M002','M003','M001']);
 assert.deepEqual(orderItems(records,'date-newest').map(r=>r.id),['M002','M001','M003']);
 assert.deepEqual(orderItems(records,'date-oldest').map(r=>r.id),['M001','M002','M003']);
 assert.deepEqual(orderItems([{id:'B'},{id:'A'}],'date-newest').map(r=>r.id),['A','B']);
 assert.equal(records[0].id,'M003');
});
test('search ignores accents and case without changing literal names',()=>{
 const name='José de la Peña';assert.ok(searchText(name).includes(searchText('JOSE')));assert.ok(searchText(name).includes('pena'));assert.equal(name,'José de la Peña');
});

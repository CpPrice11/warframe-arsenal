import test from 'node:test';
import assert from 'node:assert/strict';
import {arsenalStoragePrefix as prefix,readArsenal,writeArsenalFlag} from './public/arsenal-local.js';

function storage(){
  const values=new Map();
  return {get length(){return values.size;},key:i=>[...values.keys()][i]??null,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
test('anonymous local marks survive a new read and remain independent',()=>{
  const local=storage();
  local.setItem('warframe-language','uk');
  writeArsenalFlag(local,'kuva-bramma','mastered',true);
  assert.deepEqual(readArsenal(local)['kuva-bramma'],{owned:false,wanted:false,mastered:true});
  writeArsenalFlag(local,'kuva-bramma','owned',true);
  writeArsenalFlag(local,'kuva-bramma','owned',false);
  assert.equal(readArsenal(local)['kuva-bramma'].mastered,true);
  assert.equal(local.getItem('warframe-language'),'uk');
  assert.deepEqual(Object.keys(readArsenal(storage())),[]);
});
test('different tabs can write independent flags without replacing each other',()=>{
  const shared=storage();
  const tabA=readArsenal(shared),tabB=readArsenal(shared);
  assert.deepEqual(tabA,tabB);
  writeArsenalFlag(shared,'kuva-bramma','owned',true);
  writeArsenalFlag(shared,'kuva-bramma','wanted',true);
  writeArsenalFlag(shared,'coda-hema','mastered',true);
  writeArsenalFlag(shared,'kuva-bramma','owned',false);
  const refreshed=readArsenal(shared);
  assert.deepEqual(refreshed['kuva-bramma'],{owned:false,wanted:true,mastered:false});
  assert.equal(refreshed['coda-hema'].mastered,true);
});
test('invalid marks are rejected and unrelated keys are ignored',()=>{
  const local=storage();
  for(const args of [['../x','owned',true],['kuva-bramma','admin',true],['kuva-bramma','owned','true'],['x'.repeat(101),'owned',true]])assert.throws(()=>writeArsenalFlag(local,...args));
  local.setItem(prefix+'__proto__:owned','1');
  local.setItem(prefix+'kuva-bramma:admin','1');
  local.setItem(prefix+'kuva-bramma:owned:extra','1');
  writeArsenalFlag(local,'constructor','owned',true);
  assert.deepEqual(Object.keys(readArsenal(local)),['constructor']);
  assert.equal(Object.getPrototypeOf(readArsenal(local)),null);
});
test('damaged saved values are reported and left untouched',()=>{
  const local=storage(),key=prefix+'kuva-bramma:owned';
  local.setItem(key,'broken');
  assert.throws(()=>readArsenal(local),/arsenalStorageInvalid/);
  assert.equal(local.getItem(key),'broken');
});
test('blocked storage and quota failures propagate without reporting success',()=>{
  assert.throws(()=>readArsenal({get length(){throw Error('SecurityError');}}),/SecurityError/);
  const local=storage();
  writeArsenalFlag(local,'kuva-bramma','owned',true);
  const blocked={...local,setItem(){throw Error('QuotaExceededError');},removeItem(){throw Error('SecurityError');}};
  assert.throws(()=>writeArsenalFlag(blocked,'kuva-bramma','wanted',true),/QuotaExceeded/);
  assert.throws(()=>writeArsenalFlag(blocked,'kuva-bramma','owned',false),/SecurityError/);
  assert.deepEqual(readArsenal(local)['kuva-bramma'],{owned:true,wanted:false,mastered:false});
});

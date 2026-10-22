import test from 'node:test';
import assert from 'node:assert/strict';
import {arsenalStoragePrefix as prefix,readArsenal,writeArsenalFlag,createArsenalBackup,parseArsenalBackup,planArsenalImport,importArsenalBackup,arsenalBackupLimit} from './public/arsenal-local.js';

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

test('portable backup includes only marks and supports empty files and UTF-8 BOM',()=>{
  const local=storage();local.setItem('warframe-session','do-not-export');local.setItem('warframe-language','ru');
  writeArsenalFlag(local,'kuva-bramma','mastered',true);
  const backup=createArsenalBackup(readArsenal(local),new Date('2026-10-22T12:00:00Z'));
  assert.deepEqual(parseArsenalBackup('\uFEFF'+JSON.stringify(backup)),backup);
  assert.deepEqual(backup.weapons,[{id:'kuva-bramma',owned:false,wanted:false,mastered:true}]);
  assert.equal(JSON.stringify(backup).includes('do-not-export'),false);
  assert.deepEqual(createArsenalBackup({}).weapons,[]);
});
test('imports reject wrong formats, versions, oversized files, duplicates and unexpected fields',()=>{
  const valid=createArsenalBackup({'kuva-bramma':{owned:true,wanted:false,mastered:false}});
  for(const text of ['<html>','{}','null',JSON.stringify({...valid,format:'catalog'}),JSON.stringify({...valid,schemaVersion:2}),JSON.stringify({...valid,exportedAt:'bad'}),JSON.stringify({...valid,token:'secret'}),JSON.stringify({...valid,weapons:[...valid.weapons,...valid.weapons]}),JSON.stringify({...valid,weapons:[{...valid.weapons[0],owned:'true'}]}),JSON.stringify({...valid,weapons:[{...valid.weapons[0],url:'https://example.com'}]}),JSON.stringify({...valid,weapons:[{...valid.weapons[0],id:'../x'}]})])assert.throws(()=>parseArsenalBackup(text),/arsenalFileInvalid/);
  assert.throws(()=>parseArsenalBackup(' '.repeat(arsenalBackupLimit+1)),/arsenalFileTooLarge/);
  assert.throws(()=>parseArsenalBackup('ї'.repeat(arsenalBackupLimit/2+1)),/arsenalFileTooLarge/);
  assert.throws(()=>parseArsenalBackup(JSON.stringify({...valid,weapons:Array.from({length:1001},(_,i)=>({...valid.weapons[0],id:'weapon-'+i}))})),/arsenalFileInvalid/);
});
test('preview and import add independent flags without clearing existing or unrelated data',()=>{
  const local=storage();writeArsenalFlag(local,'kuva-bramma','wanted',true);writeArsenalFlag(local,'tenet-ferrox','owned',true);local.setItem('warframe-language','uk');
  const backup=createArsenalBackup({'kuva-bramma':{mastered:true},'unknown-weapon':{owned:true},'archived-weapon':{wanted:true}}),active=new Set(['kuva-bramma','tenet-ferrox']);
  assert.deepEqual(planArsenalImport(backup,readArsenal(local),active),{changes:[{id:'kuva-bramma',flags:['mastered']}],skipped:['archived-weapon','unknown-weapon']});
  assert.deepEqual(importArsenalBackup(local,backup,active),{applied:1,remaining:0});
  const marks=readArsenal(local);
  assert.deepEqual(marks['kuva-bramma'],{owned:false,wanted:true,mastered:true});
  assert.equal(marks['tenet-ferrox'].owned,true);assert.equal(marks['unknown-weapon'],undefined);assert.equal(local.getItem('warframe-language'),'uk');
  assert.deepEqual(importArsenalBackup(local,backup,active),{applied:0,remaining:0});
});
test('confirmation reads current marks again after another tab changes them',()=>{
  const local=storage(),backup=createArsenalBackup({'kuva-bramma':{owned:true,wanted:true}}),active=new Set(['kuva-bramma']);
  assert.equal(planArsenalImport(backup,readArsenal(local),active).changes[0].flags.length,2);
  writeArsenalFlag(local,'kuva-bramma','owned',true);writeArsenalFlag(local,'kuva-bramma','mastered',true);
  assert.deepEqual(importArsenalBackup(local,backup,active),{applied:1,remaining:0});
  assert.deepEqual(readArsenal(local)['kuva-bramma'],{owned:true,wanted:true,mastered:true});
});
test('quota interruption reports partial writes and retry adds only the remaining marks',()=>{
  const local=storage(),backup=createArsenalBackup({'kuva-bramma':{owned:true,wanted:true,mastered:true}}),active=new Set(['kuva-bramma']);
  let writes=0;const limited={get length(){return local.length;},key:local.key,getItem:local.getItem,setItem(key,value){if(++writes===2)throw Error('QuotaExceededError');local.setItem(key,value);},removeItem:local.removeItem};
  assert.deepEqual(importArsenalBackup(limited,backup,active),{applied:1,remaining:2});
  assert.deepEqual(readArsenal(local)['kuva-bramma'],{owned:true,wanted:false,mastered:false});
  assert.deepEqual(importArsenalBackup(local,backup,active),{applied:2,remaining:0});
});

export const arsenalFlags=['owned','wanted','mastered'];
export const arsenalStoragePrefix='warframe-personal-arsenal:v1:';
const validId=id=>typeof id==='string'&&id.length<=100&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);

export function readArsenal(storage){
  const marks=Object.create(null);
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);
    if(!key?.startsWith(arsenalStoragePrefix))continue;
    const [id,flag,...extra]=key.slice(arsenalStoragePrefix.length).split(':');
    if(!validId(id)||!arsenalFlags.includes(flag)||extra.length)continue;
    const value=storage.getItem(key);
    if(value===null)continue;
    if(value!=='1')throw Error('arsenalStorageInvalid');
    marks[id]??={owned:false,wanted:false,mastered:false};
    marks[id][flag]=true;
  }
  return marks;
}

export function writeArsenalFlag(storage,id,flag,checked){
  if(!validId(id)||!arsenalFlags.includes(flag)||typeof checked!=='boolean')throw Error('invalidMark');
  const key=arsenalStoragePrefix+id+':'+flag;
  if(checked)storage.setItem(key,'1');else storage.removeItem(key);
}

export const arsenalBackupLimit=512000;
export function createArsenalBackup(marks,now=new Date()){
  const weapons=Object.entries(marks).filter(([,row])=>arsenalFlags.some(flag=>row[flag])).map(([id,row])=>({id,...Object.fromEntries(arsenalFlags.map(flag=>[flag,Boolean(row[flag])]))})).sort((a,b)=>a.id.localeCompare(b.id));
  const backup={format:'warframe-personal-arsenal',schemaVersion:1,exportedAt:now.toISOString(),weapons};
  parseArsenalBackup(JSON.stringify(backup));
  return backup;
}
export function parseArsenalBackup(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>arsenalBackupLimit)throw Error('arsenalFileTooLarge');
  let data;try{data=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw Error('arsenalFileInvalid');}
  if(!data||data.format!=='warframe-personal-arsenal'||data.schemaVersion!==1||typeof data.exportedAt!=='string'||data.exportedAt.length>40||!Number.isFinite(Date.parse(data.exportedAt))||!Array.isArray(data.weapons)||data.weapons.length>1000||Object.keys(data).some(key=>!['format','schemaVersion','exportedAt','weapons'].includes(key)))throw Error('arsenalFileInvalid');
  const ids=new Set();
  for(const row of data.weapons){
    if(!row||!validId(row.id)||ids.has(row.id)||Object.keys(row).length!==4||arsenalFlags.some(flag=>typeof row[flag]!=='boolean'))throw Error('arsenalFileInvalid');
    ids.add(row.id);
  }
  return data;
}
export function planArsenalImport(backup,marks,activeIds){
  const changes=[],skipped=[];
  for(const row of backup.weapons){
    if(!arsenalFlags.some(flag=>row[flag]))continue;
    if(!activeIds.has(row.id)){skipped.push(row.id);continue;}
    const flags=arsenalFlags.filter(flag=>row[flag]&&!marks[row.id]?.[flag]);
    if(flags.length)changes.push({id:row.id,flags});
  }
  return {changes,skipped};
}
export function importArsenalBackup(storage,backup,activeIds){
  const {changes}=planArsenalImport(backup,readArsenal(storage),activeIds);
  const total=changes.reduce((sum,row)=>sum+row.flags.length,0);
  let applied=0;
  try{for(const {id,flags} of changes)for(const flag of flags){writeArsenalFlag(storage,id,flag,true);applied++;}}
  catch{return {applied,remaining:total-applied};}
  return {applied,remaining:0};
}

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

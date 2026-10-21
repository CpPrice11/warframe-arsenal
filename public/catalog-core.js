export const families=['Kuva','Tenet','Coda'];
export const types=['primary','secondary','melee','archgun'];
export const elements=['impact','heat','cold','electric','toxin','magnetic','radiation'];
export const textFields=['name_uk','name_en','reason_uk','reason_en','mechanic_uk','mechanic_en','obtain_uk','obtain_en','title_uk','title_en','body_uk','body_en','image_note'];
export function safeUrl(value,{image=false,build=false}={}) {
  if(!value) return true;
  if(typeof value!=='string'||value.length>2048) return false;
  if(image&&/^assets\/weapons\/[a-z0-9-]+\.png$/.test(value)) return true;
  try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&(!build||(u.hostname==='overframe.gg'&&/^\/build\/\d+\//.test(u.pathname)));}catch{return false;}
}
export function validateCatalog(data){
  if(!data||data.schemaVersion!==1||!Array.isArray(data.weapons)||!Array.isArray(data.progenitors)||!Array.isArray(data.tips)) throw Error('invalid_catalog');
  if(data.weapons.length>1000||data.progenitors.length>500||data.tips.length>500) throw Error('catalog_too_large');
  const ids=new Set();
  for(const [collection,kind] of [['weapons','weapon'],['progenitors','progenitor'],['tips',null]]){
    for(const record of data[collection]){
      if(!record||typeof record.id!=='string'||!/^[a-z0-9-]{1,100}$/.test(record.id)||ids.has(record.id)) throw Error('duplicate_or_invalid_id');
      ids.add(record.id);
      if(kind&&record.kind!==kind) throw Error('invalid_kind');
      if(record.archived!==undefined&&typeof record.archived!=='boolean') throw Error('invalid_archive');
      for(const key of textFields) if(record[key]!==undefined&&(typeof record[key]!=='string'||record[key].length>6000)) throw Error('invalid_text');
      if(collection==='tips'){if(!record.title_uk?.trim()||!record.body_uk?.trim()) throw Error('required');}
      else if(!record.name_uk?.trim()||!record.name_en?.trim()||record.name_uk.length>200||record.name_en.length>200) throw Error('required');
      if(collection==='weapons'&&(!families.includes(record.family)||!types.includes(record.type)||!elements.includes(record.recommended)||!elements.includes(record.alternative))) throw Error('invalid_classification');
      if(collection==='progenitors'&&!elements.includes(record.element)) throw Error('invalid_classification');
      if(!safeUrl(record.build_url,{build:true})||!safeUrl(record.source_url)||!safeUrl(record.url)||!safeUrl(record.image,{image:true})) throw Error('invalid_url');
      if(record.matrix!==undefined){if(!record.matrix||Array.isArray(record.matrix)||typeof record.matrix!=='object') throw Error('invalid_matrix');for(const [key,value]of Object.entries(record.matrix))if(!elements.includes(key)||typeof value!=='string'||value.length>1000)throw Error('invalid_matrix');}
    }
  }
  return data;
}
export function filterRecords(data,{section='all',search='',type='',element='',sort='original',lang='uk'}={}){
  const collection=section==='progenitors'?'progenitors':section==='guides'?'tips':'weapons';
  const needle=search.trim().toLocaleLowerCase(lang);
  let result=data[collection].filter(r=>!r.archived&&(collection!=='weapons'||section==='all'||section==='tools'||r.family===section)&&(!type||r.type===type)&&(!element||(r.recommended||r.element)===element)&&(!needle||[r.name_uk,r.name_en,r.title_uk,r.title_en,r.reason_uk,r.reason_en,r.mechanic_uk,r.mechanic_en,r.body_uk,r.body_en].filter(Boolean).join(' ').toLocaleLowerCase(lang).includes(needle)));
  if(sort==='name') result.sort((a,b)=>(a['name_'+lang]||a['title_'+lang]||a.name_en||a.title_uk).localeCompare(b['name_'+lang]||b['title_'+lang]||b.name_en||b.title_uk,lang));
  return result;
}
export function slug(name){return name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,85);}

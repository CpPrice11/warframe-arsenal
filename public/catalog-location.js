import {families,types,elements} from './catalog-core.js?v=20261022.3';

const defaults={section:'all',selected:'',search:'',type:'',element:'',sort:'original',view:'grid',tab:'overview',lang:'uk'};
const params={section:'section',selected:'item',search:'q',type:'type',element:'element',sort:'sort',view:'view',tab:'tab',lang:'lang'};
function normalize(value,language='uk'){
  const source=value&&typeof value==='object'?value:{};
  const result={...defaults,lang:['uk','en','ru'].includes(language)?language:'uk'};
  for(const [key,allowed]of Object.entries({section:['all',...families,'progenitors','guides'],type:['',...types],element:['',...elements],sort:['original','name'],view:['grid','list'],tab:['overview','matrix'],lang:['uk','en','ru']}))if(allowed.includes(source[key]))result[key]=source[key];
  if(typeof source.search==='string')result.search=source.search.slice(0,200);
  if(typeof source.selected==='string'&&/^[a-z0-9-]{1,100}$/.test(source.selected))result.selected=source.selected;
  if(result.section==='progenitors')result.type='';
  if(result.section==='guides'){result.type='';result.element='';result.selected='';}
  return result;
}
export function readCatalogLocation(search,saved={},language='uk'){
  const query=new URLSearchParams(search);
  return normalize(Object.values(params).some(key=>query.has(key))?Object.fromEntries(Object.entries(params).map(([key,param])=>[key,query.get(param)])):saved,language);
}
export function catalogLocationUrl(base,value){
  const route=normalize(value),url=new URL(base);
  url.search='';url.hash='';
  for(const [key,param]of Object.entries(params))if(route[key]!==defaults[key]||key==='lang')url.searchParams.set(param,route[key]);
  return url;
}

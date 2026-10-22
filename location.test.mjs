import test from 'node:test';
import assert from 'node:assert/strict';
import {readCatalogLocation,catalogLocationUrl} from './public/catalog-location.js';
import {readFile} from 'node:fs/promises';
import {bonusSource,filterRecords} from './public/catalog-core.js';

test('catalog links restore every public view setting and override saved preferences',()=>{
  const route={section:'Kuva',selected:'kuva-nukor',search:'Нюкор & Nukor',type:'secondary',element:'magnetic',sort:'name',view:'list',tab:'matrix',lang:'ru'};
  const link=catalogLocationUrl('https://cpprice11.github.io/warframe-arsenal/?private=ignore#login=secret',route);
  assert.equal(link.origin,'https://cpprice11.github.io');
  assert.equal(link.pathname,'/warframe-arsenal/');
  assert.equal(link.hash,'');assert.equal(link.searchParams.has('private'),false);
  assert.deepEqual(readCatalogLocation(link.search,{section:'Coda',view:'grid'},'en'),route);
  assert.deepEqual(readCatalogLocation('',route),route);
  assert.equal(readCatalogLocation('?item=kuva-nukor',{search:'incompatible',element:'toxin'}).search,'');
  assert.equal(readCatalogLocation('?item=kuva-nukor',{search:'incompatible',element:'toxin'}).element,'');
  assert.equal(readCatalogLocation('?item=kuva-nukor').view,'list');
  assert.equal(readCatalogLocation('',{view:'grid'}).view,'grid');
  const cards=catalogLocationUrl('https://example.com/arsenal/',{view:'grid'});
  assert.equal(cards.searchParams.get('view'),'grid');assert.equal(readCatalogLocation(cards.search).view,'grid');
});

test('URL and stored view inputs are bounded, allowlisted and never restore owner data',()=>{
  const result=readCatalogLocation('?section=tools&item=%3Cscript%3E&type=invalid&element=bad&view=table&sort=sql&tab=editor&lang=evil&q='+ 'a'.repeat(500));
  assert.equal(result.section,'all');assert.equal(result.selected,'');assert.equal(result.type,'');assert.equal(result.element,'');
  assert.equal(result.view,'list');assert.equal(result.sort,'original');assert.equal(result.tab,'overview');assert.equal(result.lang,'uk');assert.equal(result.search.length,200);
  assert.equal(readCatalogLocation('',null,'ru').lang,'ru');
  const link=catalogLocationUrl('https://example.com/arsenal/?token=secret#login=secret',{selected:'kuva-nukor',owner:true,token:'secret',lang:'uk'});
  assert.equal(link.search,'?item=kuva-nukor&lang=uk');assert.equal(link.hash,'');
  assert.equal(readCatalogLocation('?section=progenitors&type=primary').type,'');
  const guides=readCatalogLocation('?section=guides&type=primary&element=toxin&item=kuva-nukor');
  assert.equal(guides.selected,'');assert.equal(guides.type,'');assert.equal(guides.element,'');
});

test('weapon bonuses link to matching progenitors except for vendor acquisitions',async()=>{
  const catalog=JSON.parse(await readFile(new URL('./public/catalog.json',import.meta.url),'utf8'));
  const vendors=catalog.weapons.filter(r=>bonusSource(r)!=='progenitor');
  assert.equal(vendors.length,19);
  assert.equal(vendors.filter(r=>bonusSource(r)==='eleanor').length,14);
  assert.deepEqual(vendors.filter(r=>bonusSource(r)==='ergo').map(r=>r.id).sort(),['tenet-agendus','tenet-exec','tenet-ferrox','tenet-grigori','tenet-livia']);
  for(const weapon of catalog.weapons){
    assert.equal(bonusSource(weapon)==='progenitor',['Кувовий ліч','Сестра Парва'].includes(weapon.obtain_uk),weapon.id);
    if(bonusSource(weapon)!=='progenitor')continue;
    for(const element of [weapon.recommended,weapon.alternative])for(const lang of ['uk','en','ru']){
      const link=catalogLocationUrl('https://example.com/arsenal/?q=old&type=primary&item=kuva-bramma#login=secret',{section:'progenitors',element,lang,view:'list'});
      const route=readCatalogLocation(link.search);
      assert.equal(route.selected,'');assert.equal(route.search,'');assert.equal(route.type,'');assert.equal(route.tab,'overview');assert.equal(route.lang,lang);assert.equal(link.hash,'');
      const matches=filterRecords(catalog,route);
      assert.ok(matches.length>0,weapon.id+':'+element);
      assert.ok(matches.every(r=>r.kind==='progenitor'&&r.element===element));
    }
  }
  assert.equal(bonusSource(catalog.progenitors[0]),'');
});

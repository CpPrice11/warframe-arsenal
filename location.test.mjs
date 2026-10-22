import test from 'node:test';
import assert from 'node:assert/strict';
import {readCatalogLocation,catalogLocationUrl} from './public/catalog-location.js';

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
});

test('URL and stored view inputs are bounded, allowlisted and never restore owner data',()=>{
  const result=readCatalogLocation('?section=tools&item=%3Cscript%3E&type=invalid&element=bad&view=table&sort=sql&tab=editor&lang=evil&q='+ 'a'.repeat(500));
  assert.equal(result.section,'all');assert.equal(result.selected,'');assert.equal(result.type,'');assert.equal(result.element,'');
  assert.equal(result.view,'grid');assert.equal(result.sort,'original');assert.equal(result.tab,'overview');assert.equal(result.lang,'uk');assert.equal(result.search.length,200);
  assert.equal(readCatalogLocation('',null,'ru').lang,'ru');
  const link=catalogLocationUrl('https://example.com/arsenal/?token=secret#login=secret',{selected:'kuva-nukor',owner:true,token:'secret',lang:'uk'});
  assert.equal(link.search,'?item=kuva-nukor&lang=uk');assert.equal(link.hash,'');
  assert.equal(readCatalogLocation('?section=progenitors&type=primary').type,'');
  const guides=readCatalogLocation('?section=guides&type=primary&element=toxin&item=kuva-nukor');
  assert.equal(guides.selected,'');assert.equal(guides.type,'');assert.equal(guides.element,'');
});

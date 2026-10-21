import {readFile,writeFile} from 'node:fs/promises';
import {validateCatalog} from './public/catalog-core.js';
const data=validateCatalog(JSON.parse(await readFile(new URL('./public/catalog.json',import.meta.url),'utf8')));
// Split the import because a D1 SQL statement is limited to 100 KB.
const points=[...JSON.stringify(data)];
const statements=['-- Initial import only. Existing data is never overwritten.','CREATE TABLE _arsenal_seed_parts (seq INTEGER PRIMARY KEY, chunk TEXT NOT NULL);'];
for(let i=0;i<points.length;i+=20000)statements.push(`INSERT INTO _arsenal_seed_parts VALUES(${i},'${points.slice(i,i+20000).join('').replaceAll("'","''")}');`);
statements.push("INSERT OR IGNORE INTO catalog_store(id,document,version) SELECT 'main',group_concat(chunk,''),1 FROM (SELECT chunk FROM _arsenal_seed_parts ORDER BY seq);",'DROP TABLE _arsenal_seed_parts;');
await writeFile(new URL('./seed.sql',import.meta.url),statements.join('\n')+'\n');
console.log(`Seed ready: ${data.weapons.length} weapons / ${data.progenitors.length} progenitors / ${data.tips.length} notes`);

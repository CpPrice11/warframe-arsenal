import {readFile,writeFile} from 'node:fs/promises';
import {validateCatalog} from './public/catalog-core.js';
const data=validateCatalog(JSON.parse(await readFile(new URL('./public/catalog.json',import.meta.url),'utf8')));
const literal=JSON.stringify(data).replaceAll("'","''");
await writeFile(new URL('./seed.sql',import.meta.url),`-- Initial import only. Existing data is never overwritten.\nINSERT OR IGNORE INTO catalog_store(id,document,version) VALUES('main','${literal}',1);\n`);
console.log(`Seed ready: ${data.weapons.length} weapons / ${data.progenitors.length} progenitors / ${data.tips.length} notes`);

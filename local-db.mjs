import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function localDatabase(filename=':memory:'){
  const sqlite=new DatabaseSync(filename);
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const seed=JSON.parse(readFileSync(new URL('./public/catalog.json',import.meta.url),'utf8'));
  sqlite.prepare("INSERT OR IGNORE INTO catalog_store(id,document,version) VALUES('main',?,1)").run(JSON.stringify(seed));
  function prepare(sql){let values=[];return {bind(...args){values=args;return this;},first(){return sqlite.prepare(sql).get(...values)||null;},all(){return {results:sqlite.prepare(sql).all(...values)};},run(){return {meta:sqlite.prepare(sql).run(...values)};},_run(){return sqlite.prepare(sql).run(...values);}};}
  return {prepare,batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s._run());sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}},sqlite,close:()=>sqlite.close()};
}

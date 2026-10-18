import {DatabaseSync} from 'node:sqlite';
// SQLite adapter used by local development and isolated tests; production uses D1.
export function localDatabase(path=':memory:'){
 const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON');
 const wrap=(sql,values=[])=>({
  bind(...args){return wrap(sql,args);},
  async first(){return sqlite.prepare(sql).get(...values)??null;},
  async all(){return {results:sqlite.prepare(sql).all(...values)};},
  async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
  sql,values
 });
 return {
  prepare:sql=>wrap(sql),
  async exec(sql){sqlite.exec(sql);return {success:true};},
  async batch(statements){sqlite.exec('BEGIN');try{const results=statements.map(statement=>({success:true,meta:{changes:Number(sqlite.prepare(statement.sql).run(...statement.values).changes)}}));sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}},
  close(){sqlite.close();}
 };
}

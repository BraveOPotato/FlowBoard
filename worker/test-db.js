import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// SQLite-backed D1 adapter. Batch execution is synchronous and atomic, like D1.
export function createDatabase() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('./migrations/schema.sql', import.meta.url), 'utf8'));
  const statement = (query, args = []) => {
    const execute = () => {
      const s = sql.prepare(query);
      if (s.columns().length) return { results: s.all(...args), meta: { changes: 0 } };
      return { results: [], meta: { changes: s.run(...args).changes } };
    };
    return { query, bind: (...a) => statement(query, a), first: async () => execute().results[0] ?? null,
      all: async () => execute(), run: async () => execute(), execute };
  };
  const db = {
    beforeBatch: null,
    prepare: (query) => statement(query),
    batch: async (statements) => {
      if (db.beforeBatch) await db.beforeBatch(statements);
      sql.exec('BEGIN');
      try {
        const results = statements.map(s => s.execute());
        sql.exec('COMMIT');
        return results;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
  return { sql, env: { flowboard_db: db } };
}

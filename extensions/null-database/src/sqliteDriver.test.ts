import { test } from 'node:test';
import * as assert from 'node:assert';
import { SqliteSession } from './sqliteDriver';

// Helper: create an in-memory database with a known schema.
function makeTestDb(): SqliteSession {
  const sess = new SqliteSession(':memory:');
  sess.executeSql(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      score REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sess.executeSql(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  sess.executeSql(`CREATE INDEX idx_posts_user_id ON posts (user_id)`);
  sess.executeSql(`CREATE VIEW active_users AS SELECT * FROM users WHERE score > 50`);
  for (let i = 1; i <= 55; i++) {
    sess.executeSql(`INSERT INTO users (name, email, score) VALUES ('User ${i}', 'user${i}@example.com', ${i * 2})`);
  }
  sess.executeSql(`INSERT INTO posts (user_id, title) VALUES (1, 'Hello World'), (1, 'Second Post'), (2, 'Bob Post')`);
  return sess;
}

test('getDatabaseInfo returns correct counts', () => {
  const sess = makeTestDb();
  const info = sess.getDatabaseInfo();
  assert.strictEqual(info.fileName, ':memory:');
  assert.ok(info.sqliteVersion.match(/^\d+\.\d+/));
  assert.strictEqual(info.tableCount, 2);
  assert.strictEqual(info.viewCount, 1);
  sess.close();
});

test('listTablesAndViews lists tables and views separately', () => {
  const sess = makeTestDb();
  const items = sess.listTablesAndViews();
  const names = items.map(i => i.name);
  assert.ok(names.includes('users'));
  assert.ok(names.includes('posts'));
  assert.ok(names.includes('active_users'));
  const tableItems = items.filter(i => i.type === 'table');
  const viewItems = items.filter(i => i.type === 'view');
  assert.strictEqual(tableItems.length, 2);
  assert.strictEqual(viewItems.length, 1);
  const users = items.find(i => i.name === 'users')!;
  assert.strictEqual(users.rowCount, 55);
  sess.close();
});

test('getTableDetails returns columns with types and constraints', () => {
  const sess = makeTestDb();
  const details = sess.getTableDetails('users');
  assert.strictEqual(details.type, 'table');
  const col = details.columns.find(c => c.name === 'id')!;
  assert.strictEqual(col.primaryKey, true);
  const nameCol = details.columns.find(c => c.name === 'name')!;
  assert.strictEqual(nameCol.notNull, true);
  sess.close();
});

test('getTableDetails returns foreign keys and indexes for posts', () => {
  const sess = makeTestDb();
  const details = sess.getTableDetails('posts');
  assert.strictEqual(details.foreignKeys.length, 1);
  assert.strictEqual(details.foreignKeys[0].toTable, 'users');
  assert.strictEqual(details.foreignKeys[0].onDelete, 'CASCADE');
  const idx = details.indexes.find(i => i.name === 'idx_posts_user_id');
  assert.ok(idx, 'index not found');
  assert.deepStrictEqual(idx!.columns, ['user_id']);
  sess.close();
});

test('getTableDetails throws for unknown table', () => {
  const sess = makeTestDb();
  assert.throws(() => sess.getTableDetails('no_such_table'), /not found/);
  sess.close();
});

test('queryTableData respects pageSize and page', () => {
  const sess = makeTestDb();
  const page1 = sess.queryTableData({ table: 'users', page: 1, pageSize: 10 });
  assert.strictEqual(page1.rows.length, 10);
  assert.strictEqual(page1.totalRows, 55);
  assert.strictEqual(page1.totalPages, 6);
  assert.strictEqual(page1.page, 1);

  const page6 = sess.queryTableData({ table: 'users', page: 6, pageSize: 10 });
  assert.strictEqual(page6.rows.length, 5);
  sess.close();
});

test('queryTableData sorts correctly', () => {
  const sess = makeTestDb();
  const asc = sess.queryTableData({ table: 'users', page: 1, pageSize: 3, sortColumn: 'name', sortAsc: true });
  const desc = sess.queryTableData({ table: 'users', page: 1, pageSize: 3, sortColumn: 'name', sortAsc: false });
  const ascNames = asc.rows.map(r => r['name']);
  const descNames = desc.rows.map(r => r['name']);
  assert.notDeepStrictEqual(ascNames, descNames);
  sess.close();
});

test('queryTableData search filters rows', () => {
  const sess = makeTestDb();
  const result = sess.queryTableData({ table: 'users', page: 1, pageSize: 100, search: 'User 1' });
  // "User 1", "User 10", "User 11", ... all match
  assert.ok(result.totalRows >= 1);
  for (const row of result.rows) {
    const name = String(row['name'] ?? '');
    assert.ok(name.includes('1'), `name "${name}" should include "1"`);
  }
  sess.close();
});

test('executeSql SELECT returns rows and columns', () => {
  const sess = makeTestDb();
  const result = sess.executeSql('SELECT id, name FROM users WHERE id = 1');
  assert.strictEqual(result.type, 'select');
  assert.deepStrictEqual(result.columns, ['id', 'name']);
  assert.strictEqual(result.rows.length, 1);
  assert.strictEqual(result.rows[0]['name'], 'User 1');
  assert.ok(result.durationMs >= 0);
  sess.close();
});

test('executeSql INSERT returns changes info', () => {
  const sess = makeTestDb();
  const result = sess.executeSql(`INSERT INTO posts (user_id, title) VALUES (1, 'Test')`);
  assert.strictEqual(result.type, 'mutation');
  assert.strictEqual(result.changes, 1);
  sess.close();
});

test('executeSql DELETE returns changes count', () => {
  const sess = makeTestDb();
  const result = sess.executeSql('DELETE FROM posts WHERE user_id = 1');
  assert.strictEqual(result.type, 'mutation');
  assert.strictEqual(result.changes, 2); // Hello World + Second Post
  sess.close();
});

test('executeSql handles PRAGMA', () => {
  const sess = makeTestDb();
  const result = sess.executeSql('PRAGMA table_info(users)');
  assert.strictEqual(result.type, 'select');
  assert.ok(result.rows.length > 0);
  sess.close();
});

test('executeSql throws on invalid SQL', () => {
  const sess = makeTestDb();
  assert.throws(() => sess.executeSql('SELECT * FROM nonexistent_table'));
  sess.close();
});

test('view details accessible via getTableDetails', () => {
  const sess = makeTestDb();
  const details = sess.getTableDetails('active_users');
  assert.strictEqual(details.type, 'view');
  assert.ok(details.sql.includes('active_users'));
  sess.close();
});

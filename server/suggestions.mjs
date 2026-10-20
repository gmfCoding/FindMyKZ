/**
 * Public suggestions board storage.
 *
 * Anyone can read, post and vote without signing in. Votes are de-duplicated
 * per browser (the anonymous client id the site already sends as `X-Client`),
 * so each browser has at most one up- or down-vote per suggestion. Up and down
 * votes are counted separately.
 *
 * Tables
 *   suggestions       one row per suggestion
 *   suggestion_votes  one row per (suggestion, voter) with value 1 or -1
 */
import { db, transaction } from './db.mjs';

db.exec(`
  CREATE TABLE IF NOT EXISTS suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    action      TEXT,
    area        TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    client      TEXT,
    is_example  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suggestion_votes (
    suggestion_id  INTEGER NOT NULL REFERENCES suggestions (id) ON DELETE CASCADE,
    voter          TEXT NOT NULL,
    value          INTEGER NOT NULL CHECK (value IN (-1, 1)),
    updated_at     TEXT NOT NULL,
    PRIMARY KEY (suggestion_id, voter)
  );
`);

// The board used to have standard/advanced kinds; keep old rows, drop the column.
const columns = db.prepare('PRAGMA table_info(suggestions)').all();
if (columns.some((column) => column.name === 'kind')) db.exec('ALTER TABLE suggestions DROP COLUMN kind');

// "Example Suggestion" state. It can only be set directly in the database: the first time the
// column is added, every suggestion that already exists becomes an example. The API and the site
// never write it (new rows always get 0).
if (!db.prepare('PRAGMA table_info(suggestions)').all().some((column) => column.name === 'is_example')) {
  transaction(() => {
    db.exec('ALTER TABLE suggestions ADD COLUMN is_example INTEGER NOT NULL DEFAULT 0');
    db.exec('UPDATE suggestions SET is_example = 1');
  });
}

const MAX_LIST = 1000;

const SELECT = `
  SELECT
    s.id, s.action, s.area, s.name, s.title, s.body, s.created_at, s.is_example,
    COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0)  AS up,
    COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS down,
    COALESCE(MAX(CASE WHEN v.voter = :voter THEN v.value END), 0) AS my_vote
  FROM suggestions s
  LEFT JOIN suggestion_votes v ON v.suggestion_id = s.id
`;

function toSuggestion(row) {
  return {
    id: row.id,
    action: row.action,
    area: row.area,
    name: row.name,
    title: row.title,
    body: row.body,
    up: row.up,
    down: row.down,
    myVote: row.my_vote,
    createdAt: row.created_at,
    example: row.is_example === 1,
  };
}

/** Most liked first; fewer downvotes, then newest, break ties. */
export function listSuggestions(voter = '') {
  const rows = db
    .prepare(
      `${SELECT}
       GROUP BY s.id
       ORDER BY up DESC, down ASC, s.id DESC
       LIMIT ${MAX_LIST}`,
    )
    .all({ voter });
  return rows.map(toSuggestion);
}

export function getSuggestion(id, voter = '') {
  const row = db.prepare(`${SELECT} WHERE s.id = :id GROUP BY s.id`).get({ id, voter });
  return row ? toSuggestion(row) : null;
}

export function createSuggestion(input, voter) {
  const result = db
    .prepare(
      `INSERT INTO suggestions (action, area, name, title, body, client, created_at, is_example)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      input.action,
      input.area,
      input.name,
      input.title,
      input.body,
      voter || null,
      new Date().toISOString(),
    );
  return getSuggestion(Number(result.lastInsertRowid), voter);
}

/**
 * Set a voter's vote to 1, -1 or 0 (clear). Returns the updated suggestion, or
 * null when the suggestion does not exist.
 */
export function castVote(id, voter, value) {
  return transaction(() => {
    const exists = db.prepare('SELECT 1 FROM suggestions WHERE id = ?').get(id);
    if (!exists) return null;
    if (value === 0) {
      db.prepare('DELETE FROM suggestion_votes WHERE suggestion_id = ? AND voter = ?').run(id, voter);
    } else {
      db.prepare(
        `INSERT INTO suggestion_votes (suggestion_id, voter, value, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(suggestion_id, voter) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(id, voter, value, new Date().toISOString());
    }
    return getSuggestion(id, voter);
  });
}

export function suggestionCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM suggestions').get().n;
}

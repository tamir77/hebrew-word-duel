const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'words.sqlite');

function loadDictionary(databasePath = process.env.WORD_DATABASE_PATH || DEFAULT_DATABASE_PATH) {
  const database = new DatabaseSync(databasePath, { readOnly: true });

  try {
    const entries = database.prepare(`
      SELECT id, lemma, normalized
      FROM words
      WHERE part_of_speech = 'noun'
        AND grammatical_number = 'singular'
        AND is_proper = 0
      ORDER BY id
    `).all().map(({ id, lemma, normalized }) => ({ id: Number(id), lemma, normalized }));

    const metadata = Object.fromEntries(
      database.prepare('SELECT key, value FROM metadata').all().map(({ key, value }) => [key, value])
    );

    if (!entries.length) throw new Error(`Dictionary database is empty: ${databasePath}`);
    return { databasePath, entries, metadata };
  } finally {
    database.close();
  }
}

module.exports = { DEFAULT_DATABASE_PATH, loadDictionary };

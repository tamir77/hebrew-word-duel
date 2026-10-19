const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const FINAL_MAP = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

function normalize(value = '') {
  return String(value)
    .normalize('NFC')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^א-ת]/g, '')
    .split('')
    .map((letter) => FINAL_MAP[letter] || letter)
    .join('');
}

function readHif(filePath) {
  const text = new TextDecoder('iso-8859-8').decode(fs.readFileSync(filePath));
  const words = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line === '-------') continue;

    const separator = line.indexOf(' ');
    if (separator < 0) continue;

    const lemma = line.slice(0, separator);
    const tags = line.slice(separator + 1).split(',');
    const isStandaloneSingularNoun = tags.includes('ע')
      && tags.includes('יחיד')
      && !tags.includes('סמיכות')
      && !tags.some((tag) => tag.startsWith('של/'));

    if (isStandaloneSingularNoun) words.push(lemma);
  }

  return words;
}

const hspellDirectory = path.resolve(process.argv[2] || '');
const outputPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'words.sqlite'));
const sourceFiles = ['nouns.hif', 'shemp.hif'].map((name) => path.join(hspellDirectory, name));

if (!process.argv[2] || sourceFiles.some((filePath) => !fs.existsSync(filePath))) {
  console.error('Usage: node scripts/import-hspell.cjs /path/to/built/hspell [output.sqlite]');
  console.error('The Hspell directory must contain generated nouns.hif and shemp.hif files.');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const database = new DatabaseSync(outputPath);

try {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    DROP TABLE IF EXISTS words;
    DROP TABLE IF EXISTS metadata;
    CREATE TABLE words (
      id INTEGER PRIMARY KEY,
      lemma TEXT NOT NULL UNIQUE,
      normalized TEXT NOT NULL,
      part_of_speech TEXT NOT NULL,
      grammatical_number TEXT NOT NULL,
      is_proper INTEGER NOT NULL CHECK (is_proper IN (0, 1)),
      source TEXT NOT NULL,
      license TEXT NOT NULL,
      dictionary_version TEXT NOT NULL
    );
    CREATE INDEX words_normalized_idx ON words(normalized);
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const uniqueWords = [...new Set(sourceFiles.flatMap(readHif))].sort((a, b) => a.localeCompare(b, 'he'));
  const insertWord = database.prepare(`
    INSERT INTO words (
      lemma, normalized, part_of_speech, grammatical_number,
      is_proper, source, license, dictionary_version
    ) VALUES (?, ?, 'noun', 'singular', 0, 'Hspell', 'AGPL-3.0-only', '1.4')
  `);

  database.exec('BEGIN');
  for (const lemma of uniqueWords) insertWord.run(lemma, normalize(lemma));

  const normalizedCount = new Set(uniqueWords.map(normalize)).size;
  const insertMetadata = database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
  const metadata = {
    dictionary_version: 'hspell-1.4-local-1',
    source: 'Hspell 1.4',
    source_repository: 'https://github.com/ivrix/hspell',
    source_commit: 'f4c5f2e760e28bfb9df06e625dae84c98d655e8f',
    license: 'AGPL-3.0-only',
    source_noun_entries: '12929',
    imported_spellings: String(uniqueWords.length),
    normalized_keys: String(normalizedCount),
    filter: 'standalone common nouns in singular form from nouns.hif and shemp.hif'
  };

  for (const [key, value] of Object.entries(metadata)) insertMetadata.run(key, value);
  database.exec('COMMIT');
  database.exec('VACUUM');
  console.log(JSON.stringify({ outputPath, ...metadata }, null, 2));
} catch (error) {
  try { database.exec('ROLLBACK'); } catch {}
  throw error;
} finally {
  database.close();
}

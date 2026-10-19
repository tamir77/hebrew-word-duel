# Hebrew noun database

`words.sqlite` contains standalone singular noun spellings imported from Hspell 1.4.

- Source: https://github.com/ivrix/hspell
- Source commit: `f4c5f2e760e28bfb9df06e625dae84c98d655e8f`
- Source and generated word-list license: AGPL-3.0-only (`LICENSE-HSPELL.txt` and `COPYING-HSPELL-AGPL-3.0.txt`)
- Hspell 1.4 reported noun entries: 12,929
- Imported spellings: 12,655
- Unique keys after the game's final-letter and punctuation normalization: 12,625

The import keeps rows tagged by Hspell as nouns (`ע`) and emitted as standalone singular forms (`יחיד`). Construct and possessive forms are excluded. Entries that exist only in plural form do not produce a singular row and are therefore excluded.

To rebuild the database, build Hspell 1.4 so that `nouns.hif` and `shemp.hif` exist, then run:

```bash
node scripts/import-hspell.cjs /path/to/hspell
```

This is a mechanically filtered linguistic dataset, not a human-reviewed game dictionary. Rare, archaic, technical, offensive, or otherwise unsuitable words may still require an editorial exclusion list.

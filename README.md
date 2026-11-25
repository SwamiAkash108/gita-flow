# Gita Flow

Learn the Bhagavad Gita the way The Rhyme Game teaches freestyle rap.

A beat loops. Each bar carries one keyword from the verse's English translation
on its last slot. The ball bounces toward it and you rap the bar so you land on
that word, filling the rest of the bar yourself. You supply the rhymes (every
keyword card shows rhyme hints). You learn English vocabulary by using it, and
every verse's meaning goes in deeper because you rap about it.

- Chapter 2 (Sāṅkhya-yoga, 71 verses) included with keywords, contexts and rhymes.
- Fill ladder: All prompts → First only → Last only → Free flow.
- Rhyme schemes: off / AABB / ABAB / AAAA (the app pairs keywords with rhyming partners).
- Spaced review: verses come back after 1, 2, 4, 7, 15 days.
- Built-in metronome, or drop your own loops into `beats/` (see `beats/README.md`).
- No accounts, no tracking. Progress lives in your browser's localStorage.

## Run it

It's a static site. Any static host works.

### GitHub Pages

1. Push this folder to a repo.
2. Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<user>.github.io/<repo>/`, add to home screen on your phone.

Note: on a normal GitHub plan the Pages site is reachable by anyone who has the
URL, even from a private repo. Nothing private is stored here anyway.

## Data

`verses.json` holds chapters 2–18 metadata and chapter 2's verses: IAST pādas,
word-by-word meanings, translation, and per-verse English keywords with context,
Sanskrit links, "new word" flags and rhymes (CMU Pronouncing Dictionary +
frequency filter). More chapters drop into the same file.

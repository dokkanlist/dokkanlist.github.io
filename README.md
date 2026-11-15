# Dokkan Battle Checklist
This is the successor to my initial 2 projects:

- https://dokkanlr.github.io/
- https://dokkanfe.github.io/

This project combines both into a single page, with added functionality and the ability to freely switch between the 2 while on the same page.

***

## Disclaimers

Assets are taken from the mobile game 'Dragon Ball Z: Dokkan Battle'.

All rights reserved by &copy; BANDAI NAMCO Entertainment.

This is purely a fan-made project to serve as a progress checker for players.

***

## Development

The checklist data lives in `data/lr.json` and `data/dfe.json`. Nothing in
`js/scripts.js` needs editing to add a character.

Every tile is drawn in the browser from four stacked images: a type frame, the
character's raw 250 px game thumb, a rarity badge and a class + type badge. The
frames and badges are shared (`images/layers/`), so a new character only needs
its thumb.

### Adding a character

1. Save the raw game thumb (250 x 250 px PNG, the file the game calls
   `card_<id>_thumb.png`) as `images/lr/thumbs/<n>.png` or
   `images/dfe/thumbs/<n>.png`, where `<n>` is the next number in sequence.
2. Add a line for `<n>` to `data/lr.units.json` or `data/dfe.units.json`:

   ```
   "196": {"id": 1034591, "class": "super", "tx": -1, "ty": 1},
   ```

   - `id` is the game's card id (7 digits), kept for reference.
   - `class` is `super` or `extreme` and picks the class + type badge.
   - `tx` / `ty` place the thumb, in pixels of the original icon canvas.
     DFE units always use `6, -4`. LR units usually use `-1, 1`; nudge by a
     pixel or two if the art sits off-centre in its frame.
3. In the matching data file, bump `total` and add the id to the right entry
   under `types` (this picks the frame colour). Add it to `eza` / `eza2` if it
   has one.
4. For alt art, also save `<n>_alt.png` in the same thumbs folder, add
   `"alt": {"id": ..., "tx": ..., "ty": ...}` to the unit's line, and add the
   id to `altArt` in the data file.
5. Update `changelog` (type names in the text are colourised automatically).
6. Validate and stamp:

   ```
   node validate-data.js --stamp
   ```

`validate-data.js` checks that every id has exactly one type, that the type
ranges cover `1..total` with no gaps or duplicates, that every id has a thumb
file and a well formed units line, that alt-art entries have a matching
`_alt.png`, and that all the shared layer images are present. It exits non-zero
if anything is wrong. `--stamp` also refreshes the cache-busting build id in
`index.html`, so returning visitors get the new CSS/JS instead of a stale
cached copy - run it whenever you change `css/`, `js/`, or `data/`.

The finished icons in `images/lr/icons/` and `images/dfe/icons/` are the old
one-image-per-character versions. The site no longer loads them.

The same commands are available as npm scripts (nothing to install, there are
no dependencies):

```
npm run validate   # node validate-data.js
npm run stamp      # node validate-data.js --stamp
npm run check      # node validate-data.js --check-stamp (fails on a stale build id, writes nothing)
npm test           # unit tests for the range parser and the validator
npm run hooks      # switch on the pre-commit hook (once per clone)
```

### Automatic checks

- **Pre-commit hook** (`.githooks/pre-commit`): after `npm run hooks`, every
  `git commit` validates the data, refreshes the build id and adds
  `index.html` to the commit. A commit with invalid data is refused, so the
  stamp step can no longer be forgotten.
- **GitHub workflow** (`.github/workflows/validate.yml`): runs the tests and
  `--check-stamp` on every push and pull request. It only reports; GitHub Pages
  still deploys from `master` whatever the result.

`js/ranges.js` holds the one range-string parser used by both the site and the
validator. It only accepts whole numbers and `start-end` ranges, and refuses
ranges above 10,000 so a damaged save or import code cannot freeze the page.

### Running locally

The data files are loaded with `fetch()`, which browsers block on `file://`
URLs, so serve the folder over http:

```
python -m http.server 8765
```

Then open <http://localhost:8765>.

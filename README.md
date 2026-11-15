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

The checklist data is split in two per side:

- `data/lr.units.json` and `data/dfe.units.json` hold one line per unit: its
  game id, type, class, EZA state and thumb placement. The number of lines is
  the number of units; nothing else needs counting.
- `data/lr.json` and `data/dfe.json` hold the texts and the three things kept
  by hand: the `f2p` list (LR side only), the `altArt` list and the
  `changelog`.

Nothing in `js/scripts.js` needs editing to add a character.

Every tile is drawn in the browser from four stacked images: a type frame, the
character's raw 250 px game thumb, a rarity badge and a class + type badge. The
frames and badges are shared (`images/layers/`), so a new character only needs
its thumb.

### Updating when new units or EZAs are released

`tools/update-units.js` does the routine part. It compares the checklist with
dokkandb's card catalogue (Global server) and proposes the changes; nothing is
written to the site's files until you have looked at the proposal.

1. Check:

   ```
   npm run update
   ```

   This prints what it found and writes two files, both ignored by git:
   `tools/proposal.json` (the changes) and `tools/preview.html` (the new tiles,
   drawn with the site's own styles - open it in a browser).
2. Review. Edit `tools/proposal.json` if anything is wrong: fix a type, change
   a thumb offset, reword a changelog line, or delete an entry you do not
   want. New unit numbers must carry on from the last unit with no gaps.
3. Apply:

   ```
   npm run update:apply
   ```

   This copies the new thumbs into `images/<side>/thumbs/`, adds the unit
   lines, updates EZA states, replaces the changelog with the proposal's lines
   and runs the validator. If the validator objects, every file is put back.
4. Add any new free to play unit to `f2p` in `data/lr.json` (the script only
   hints at these), look at the page, then commit. Nothing is committed for you.

What the script decides, and how:

- **New units:** every LR, and every UR tagged Dokkan Festival, whose game id
  is not on the checklist yet. They are numbered on from your last unit in JP
  release order, as your existing numbers are.
- **Type and class:** from the card's `element`.
- **EZA and Super EZA:** from the card's `optimal_awakening_step`.
- **Changelog:** one line per new unit (`AGL Name`) and per EZA
  (`AGL Name EZA`, `AGL Name Super EZA`).
- **Left to you:** the `f2p` and `altArt` lists. Possible alt art and free to
  play units are only mentioned in the proposal's notes.

It keeps its requests small. One request asks dokkandb whether its data has
changed. If it has, one more reads dokkandb's short list of latest cards, and
the saved catalogue in `tools/.cache/` is reused when it already knows every
card on that list. The whole catalogue is downloaded only when a card it has
never seen is listed, or once the saved copy is over 30 days old. One thumb
per new unit comes from dokkaninfo.com. Requests go one at a time with a pause
between them.

Cards the script should never mention go in `tools/ignore-ids.json`. If a site refuses, the script stops and says so; it does not
try to get around it. `--offline` works from the saved copy and `--refresh`
checks against the whole catalogue again.

### A unit line

```
"196": {"id": 1034591, "type": "agl", "class": "super", "eza": 1, "tx": -1, "ty": 1},
```

- The key is your own unit number. Keys must run from 1 with no gaps.
- `id` is the game's card id (7 digits).
- `type` is `agl`, `teq`, `str`, `phy` or `int` and picks the frame colour.
- `class` is `super` or `extreme` and picks the class + type badge.
- `eza` is `1` for an EZA or `2` for a Super EZA. Leave it out for a unit with no EZA.
- `tx` / `ty` place the thumb, in pixels of the original icon canvas. DFE
  units always use `6, -4`. LR units usually use `-1, 1`; nudge by a pixel or
  two if the art sits off-centre in its frame.
- `alt` (only for units in `altArt`) is `{"id": ..., "tx": ..., "ty": ...}` for
  the alt art thumb.

### Adding a character by hand

The update script above normally does this. The manual steps are:

1. Save the raw game thumb (250 x 250 px PNG, the file the game calls
   `card_<id>_thumb.png`) as `images/lr/thumbs/<n>.png` or
   `images/dfe/thumbs/<n>.png`, where `<n>` is the next number in sequence.
2. Add a line for `<n>` to the end of `data/lr.units.json` or
   `data/dfe.units.json` (see "A unit line").
3. If it is free to play, add `<n>` to `f2p` in `data/lr.json`.
4. For alt art, also save `<n>_alt.png` in the same thumbs folder, add the
   `alt` entry to the unit's line, and add `<n>` to `altArt` in the data file.
5. Update `changelog` (type names in the text are colourised automatically).
6. Validate and stamp:

   ```
   node validate-data.js --stamp
   ```

An EZA or Super EZA is a one number edit: set `"eza": 1` or `"eza": 2` on the
unit's line.

`validate-data.js` checks that the unit numbers run from 1 with no gaps, that
every unit has a valid type, class and EZA state and a thumb file, that the
`f2p` and `altArt` lists only name units that exist, that alt-art entries have
a matching `_alt.png`, and that all the shared layer images are present. It
exits non-zero if anything is wrong. `--stamp` also refreshes the cache-busting
build id in `index.html`, so returning visitors get the new CSS/JS instead of a
stale cached copy - run it whenever you change `css/`, `js/`, or `data/`.

The finished icons in `images/lr/icons/` and `images/dfe/icons/` are the old
one-image-per-character versions. The site no longer loads them.

The same commands are available as npm scripts (nothing to install, there are
no dependencies):

```
npm run update        # node tools/update-units.js (check, write a proposal)
npm run update:apply  # node tools/update-units.js --apply
npm run validate   # node validate-data.js
npm run stamp      # node validate-data.js --stamp
npm run check      # node validate-data.js --check-stamp (fails on a stale build id, writes nothing)
npm test           # unit tests for the range parser, the validator and the update script
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

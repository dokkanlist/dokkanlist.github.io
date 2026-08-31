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

### Adding a character

1. Drop the icon in `images/lr/icons/` or `images/dfe/icons/`, named `<n>.webp`
   using the next number in sequence.
2. In the matching data file, bump `total` and add the id to the right entry
   under `types`. Add it to `eza` / `eza2` if it has one, and to `altArt` if you
   also added a `<n>_alt.webp`.
3. Update `changelog` (type names in the text are colourised automatically).
4. Validate and stamp:

   ```
   node validate-data.js --stamp
   ```

`validate-data.js` checks that every id has exactly one type, that the type
ranges cover `1..total` with no gaps or duplicates, that every listed id has an
icon file, and that alt-art entries have a matching `_alt.webp`. It exits
non-zero if anything is wrong. `--stamp` also refreshes the cache-busting build
id in `index.html`, so returning visitors get the new CSS/JS instead of a
stale cached copy — run it whenever you change `css/`, `js/`, or `data/`.

### Running locally

The data files are loaded with `fetch()`, which browsers block on `file://`
URLs, so serve the folder over http:

```
python -m http.server 8765
```

Then open <http://localhost:8765>.

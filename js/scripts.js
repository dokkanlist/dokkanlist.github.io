'use strict';

/* ============================================================
   Dokkan Battle Checklist
   ------------------------------------------------------------
   Character data lives in data/lr.units.json and data/dfe.units.json
   (one line per unit); data/lr.json and data/dfe.json hold the texts and
   the hand-kept lists. Nothing in this file needs editing to add a character.
   Run `node validate-data.js` after editing the data files.
   ============================================================ */

/* --- Constants ------------------------------------------- */

// The five types, in the order the counter and filters show them.
const TYPES = ['agl', 'teq', 'str', 'phy', 'int'];
// The two sides of the checklist and the data file behind each.
const MODE_IDS = ['lr', 'dfe'];
const MODE_SOURCES = { lr: 'data/lr.json', dfe: 'data/dfe.json' };

// Where the checklist is kept in the browser, and the layout version of it.
const STORAGE_KEY = 'dokkanChecklist';
const STORAGE_VERSION = 2;
// Unreadable saved data is copied to "<prefix><timestamp>" before anything can
// overwrite it. Only the newest few copies are kept.
const BACKUP_PREFIX = 'dokkanChecklist.backup.';
const BACKUP_KEEP = 3;

// The "Last Update" date comes from the newest commit on GitHub and is cached
// for six hours so the public API is not asked on every visit.
const COMMIT_CACHE_KEY = 'dokkanLastUpdate';
const COMMIT_CACHE_MS = 6 * 60 * 60 * 1000;
const COMMIT_API = 'https://api.github.com/repos/dokkanlist/dokkanlist.github.io/commits?per_page=1';

// Half of the side-switch flip: the content is swapped at the midpoint.
const FLIP_HALF_MS = 150;
// Delay before keyboard focus is moved into a window that has just opened.
const MODAL_FOCUS_MS = 50;
// How long a toast message stays up (must match "toast-fade" in css/style.css).
const TOAST_MS = 1650;

/* --- Layered tiles ---------------------------------------- */

// Every tile is drawn from four stacked images (type frame, raw thumb, rarity
// badge, class + type badge) rather than one finished icon per unit.

// Per-unit facts (game id, type, class, EZA state, thumb offset), keyed by the
// owner's unit numbers. These files also decide how many units there are.
const UNIT_SOURCES = { lr: 'data/lr.units.json', dfe: 'data/dfe.units.json' };

// Shared layer images, named as in the game files.
const LAYER_DIR = 'images/layers';
// The game numbers the five types in this order in its file names.
const GAME_TYPE_INDEX = { agl: 0, teq: 1, int: 2, str: 3, phy: 4 };
// First digit of a class + type badge file: 1 = Super, 2 = Extreme.
const GAME_CLASS_DIGIT = { super: 1, extreme: 2 };
// Rarity badge shown on each side of the checklist.
const RARITY_BADGE = { lr: 'cha_rare_lr.png', dfe: 'cha_rare_ur.png' };

/* --- Range helpers --------------------------------------- */

// parseRanges("1-3,7") -> [1,2,3,7] and formatRanges([1,2,3,7]) -> "1-3,7".
// Defined once in js/ranges.js (loaded before this file) and shared with
// validate-data.js, so the site and the validator can never drift apart.
const { parseRanges, formatRanges } = Ranges;

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Makes text safe to place inside innerHTML.
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/* --- Persistent state ------------------------------------ */

// The visitor's checklist: which side is showing, the alt art switch, and the
// selected and removed unit numbers on each side.
const store = {
  mode: 'lr',
  altArt: false,
  selected: { lr: new Set(), dfe: new Set() },
  hidden: { lr: new Set(), dfe: new Set() }
};

// The checklist as a plain object, ready for JSON (id lists become range strings).
function serialize() {
  const out = { v: STORAGE_VERSION, mode: store.mode, altArt: store.altArt };
  for (const mode of MODE_IDS) {
    out[mode] = {
      selected: formatRanges([...store.selected[mode]]),
      hidden: formatRanges([...store.hidden[mode]])
    };
  }
  return out;
}

// True if the payload is a checklist in the layout this script understands.
function isChecklist(payload) {
  return Boolean(payload) && typeof payload === 'object' && payload.v === STORAGE_VERSION;
}

// True if anything is selected or removed on either side.
function hasProgress() {
  return MODE_IDS.some(mode => store.selected[mode].size > 0 || store.hidden[mode].size > 0);
}

// Replaces the in-memory checklist with the payload. Returns false, and
// changes nothing, if the payload is not a checklist we understand.
function applyState(payload) {
  if (!isChecklist(payload)) return false;

  store.mode = MODE_IDS.includes(payload.mode) ? payload.mode : 'lr';
  store.altArt = payload.altArt === true;
  for (const mode of MODE_IDS) {
    const side = payload[mode] || {};
    store.selected[mode] = new Set(parseRanges(side.selected));
    store.hidden[mode] = new Set(parseRanges(side.hidden));
  }
  return true;
}

// Set once the visitor has been told that saving is failing, so the notice is
// shown a single time and not on every click.
let saveWarned = false;

// Writes the checklist to the browser. If the browser refuses (private
// browsing, storage full) the visitor is told once, on the page.
function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
  } catch (err) {
    console.error('Could not save the checklist:', err);
    if (!saveWarned) {
      saveWarned = true;
      showNotice('Your browser would not save the checklist (private browsing, or storage is full). ' +
        'Changes will be lost when this page closes. Use Export to keep a copy.');
    }
  }
}

// Keeps a copy of saved data this script could not read, under its own key,
// so the next save cannot destroy it. Only the newest BACKUP_KEEP copies are
// kept. Returns the key used, or null if the copy could not be written.
function backupRawStore(raw) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(BACKUP_PREFIX)) keys.push(key);
    }
    // The same bad data is found again on every reload until something is
    // saved over it; one copy of it is enough.
    const existing = keys.find(key => localStorage.getItem(key) === raw);
    if (existing) return existing;

    const stamp = key => Number(key.slice(BACKUP_PREFIX.length)) || 0;
    keys.sort((a, b) => stamp(a) - stamp(b));
    while (keys.length >= BACKUP_KEEP) localStorage.removeItem(keys.shift());

    const backupKey = BACKUP_PREFIX + Date.now();
    localStorage.setItem(backupKey, raw);
    return backupKey;
  } catch (err) {
    console.error('Could not back up the unreadable checklist:', err);
    return null;
  }
}

// One-time upgrade from the old one-key-per-icon layout.
function migrateLegacy() {
  const legacyKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (/^\d+b?$/.test(key)) legacyKeys.push(key);
  }

  const legacyMode = localStorage.getItem('dokkanMode');
  const legacyAlt = localStorage.getItem('dokkanAltArt');
  if (!legacyKeys.length && legacyMode === null && legacyAlt === null) return;

  for (const key of legacyKeys) {
    const mode = key.endsWith('b') ? 'dfe' : 'lr';
    const id = Number(key.replace(/b$/, ''));
    if (localStorage.getItem(key) === 'hidden') store.hidden[mode].add(id);
    else store.selected[mode].add(id);
  }
  if (MODE_IDS.includes(legacyMode)) store.mode = legacyMode;
  store.altArt = legacyAlt === 'true';

  for (const key of legacyKeys) localStorage.removeItem(key);
  localStorage.removeItem('dokkanMode');
  localStorage.removeItem('dokkanAltArt');
  saveStore();
  console.info(`Upgraded ${legacyKeys.length} saved icons to the new storage format.`);
}

// Reads the saved checklist at start-up. Saved data that cannot be read (damaged,
// or written by a newer version of the site) is backed up before a fresh
// checklist is started, and the visitor is told.
function loadStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('localStorage is unavailable, progress will not be saved:', err);
    return;
  }

  if (raw) {
    let understood = false;
    try {
      understood = applyState(JSON.parse(raw));
    } catch (err) {
      console.warn('Saved checklist was unreadable, starting fresh:', err);
    }
    if (understood) return;

    const backupKey = backupRawStore(raw);
    showNotice(backupKey
      ? `Your saved checklist could not be read, so a new one was started. The old data was kept in this browser as "${backupKey}".`
      : 'Your saved checklist could not be read, so a new one was started. The old data could not be backed up.');
  }
  migrateLegacy();
}

/* --- Character data -------------------------------------- */

// Loaded data per side (filled by loadModeData) and the build id from index.html.
const modeData = {};
let buildId = '';

// Turns one side's two files into the lookups the page uses.
//   raw    data/<mode>.json: texts, plus the lists kept by hand (f2p, altArt)
//   units  data/<mode>.units.json: one entry per unit number, holding its
//          type, class, EZA state (1 = EZA, 2 = Super EZA, absent for none) and
//          thumb placement
// The number of units is simply the number of entries in the units file.
function normaliseData(raw, units) {
  const typeOf = new Map();
  const eza = new Set();
  const eza2 = new Set();
  for (const [key, unit] of Object.entries(units)) {
    const id = Number(key);
    if (TYPES.includes(unit.type)) typeOf.set(id, unit.type);
    // A Super EZA is also an EZA, so it goes in both sets.
    if (unit.eza === 1 || unit.eza === 2) eza.add(id);
    if (unit.eza === 2) eza2.add(id);
  }
  return {
    label: raw.label,
    title: raw.title,
    favicon: raw.favicon,
    iconDir: raw.iconDir,
    total: Object.keys(units).length,
    changelog: Array.isArray(raw.changelog) ? raw.changelog : [],
    units,
    typeOf,
    eza,
    eza2,
    f2p: new Set(parseRanges(raw.f2p)),
    // Declaring an "f2p" key opts a mode into the F2P filter, so an empty list
    // still shows the bar while a mode that omits the key entirely hides it.
    hasF2p: typeof raw.f2p === 'string',
    altArt: new Set(Array.isArray(raw.altArt) ? raw.altArt : [])
  };
}

// Fetches and prepares one side's data file and units file, once per visit.
async function loadModeData(mode) {
  if (modeData[mode]) return modeData[mode];
  const url = MODE_SOURCES[mode] + (buildId ? `?v=${buildId}` : '');
  // no-cache = always revalidate with the server (a cheap 304 when unchanged).
  // The data files are the ones edited most often and are small, so this
  // means a data edit shows up on a plain refresh even if --stamp was skipped,
  // instead of the browser silently serving the previous list from cache.
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${MODE_SOURCES[mode]} responded ${response.status}`);
  const raw = await response.json();
  modeData[mode] = normaliseData(raw, await loadUnits(mode));
  return modeData[mode];
}

// Fetches data/<mode>.units.json: { "<n>": { id, type, class, eza?, tx, ty, alt? } }.
async function loadUnits(mode) {
  const url = UNIT_SOURCES[mode] + (buildId ? `?v=${buildId}` : '');
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${UNIT_SOURCES[mode]} responded ${response.status}`);
  return response.json();
}

/* --- Elements (assigned on DOMContentLoaded) ------------- */

// Page elements used throughout the script.
let grid, counter, changelogList, iconContainer, header, toggleButton;
let hideToggle, artPicker;

/* --- Rendering ------------------------------------------- */

// Creates one layer image for a tile. Layers are decorative (the tile
// itself is the checkbox), so they carry no alt text and ignore the pointer.
function createLayer(name, src) {
  const image = document.createElement('img');
  image.className = `layer layer-${name}`;
  image.alt = '';
  image.draggable = false;
  image.decoding = 'async';
  image.addEventListener('error', () => handleLayerError(image, name));
  image.addEventListener('load', () => handleLayerLoad(image, name));
  if (src) image.src = src;
  return image;
}

// Image addresses already reported as missing, so each is logged once.
const reportedMissing = new Set();

// A layer image failed to load. A missing thumb turns the tile into a plain
// numbered tile (see ".flair.missing" in css/style.css) that still works as a
// checkbox; any other missing layer is simply hidden so no broken-image mark
// shows.
function handleLayerError(image, name) {
  const address = image.getAttribute('src');
  if (!address) return;
  if (!reportedMissing.has(address)) {
    reportedMissing.add(address);
    console.warn(`Missing image: ${address}`);
  }
  image.style.visibility = 'hidden';
  if (name === 'thumb' && image.parentElement) image.parentElement.classList.add('missing');
}

// A layer image loaded: undo anything handleLayerError() did earlier (the alt
// art toggle can swap a missing thumb for one that exists).
function handleLayerLoad(image, name) {
  image.style.visibility = '';
  if (name === 'thumb' && image.parentElement) image.parentElement.classList.remove('missing');
}

// Fills a tile with its four stacked images, back to front:
// type frame, raw thumb, rarity badge, class + type badge. Sizes and positions
// of the shared layers come from CSS (see "Layered tiles" in css/style.css);
// only the thumb is placed per unit, by setThumbArt().
function buildLayers(flair, id, type) {
  const data = modeData[store.mode];
  const unit = data.units[id];
  const typeIndex = GAME_TYPE_INDEX[type];

  if (typeIndex !== undefined) {
    flair.appendChild(createLayer('frame', `${LAYER_DIR}/cha_base_0${typeIndex}_04.png`));
  }
  flair.appendChild(createLayer('thumb'));
  flair.appendChild(createLayer('rarity', `${LAYER_DIR}/${RARITY_BADGE[store.mode]}`));
  if (typeIndex !== undefined && unit && GAME_CLASS_DIGIT[unit.class]) {
    const code = `${GAME_CLASS_DIGIT[unit.class]}${typeIndex}`;
    flair.appendChild(createLayer('type', `${LAYER_DIR}/cha_type_icon_${code}.png`));
  }
  setThumbArt(flair, id);
}

// Sets (or swaps, for the art picker) the art shown on a tile: points the
// thumb at the normal or alt art file and applies that art's own offset. The
// offset is stored in pixels of the original icon canvas and handed to CSS as
// --tx / --ty, which converts it to a percentage.
function setThumbArt(flair, id) {
  const data = modeData[store.mode];
  const thumb = flair.querySelector('.layer-thumb');
  const unit = data.units[id];
  if (!thumb || !unit) return;

  const useAlt = store.altArt && data.altArt.has(id) && unit.alt;
  const placement = useAlt ? unit.alt : unit;
  thumb.src = `${data.iconDir}/thumbs/${id}${useAlt ? '_alt' : ''}.png`;
  thumb.style.setProperty('--tx', String(placement.tx));
  thumb.style.setProperty('--ty', String(placement.ty));
}

// Builds the whole grid for the current side, one tile per unit number.
function renderGrid() {
  const data = modeData[store.mode];
  const fragment = document.createDocumentFragment();

  for (let id = 1; id <= data.total; id++) {
    const flair = document.createElement('div');
    flair.className = 'flair';
    flair.dataset.id = String(id);
    flair.setAttribute('role', 'checkbox');
    flair.setAttribute('aria-checked', 'false');

    const type = data.typeOf.get(id);
    if (type) flair.classList.add('type-' + type);
    // Super or Extreme, for the class filter.
    const unitClass = data.units[id] && data.units[id].class;
    if (unitClass) flair.classList.add('class-' + unitClass);
    if (data.eza.has(id)) flair.classList.add('eza');
    if (data.eza2.has(id)) flair.classList.add('eza2', 'glow-pulse');
    if (data.f2p.has(id)) flair.classList.add('f2p');
    if (data.altArt.has(id)) flair.classList.add('has-alt');

    // The lightning strip goes in first so it sits behind the art.
    if (data.eza2.has(id) && type) {
      const overlay = document.createElement('div');
      overlay.className = `lightning-overlay lightning-${type}`;
      flair.appendChild(overlay);
    }

    buildLayers(flair, id, type);
    fragment.appendChild(flair);
  }

  grid.textContent = '';
  grid.appendChild(fragment);
  applyStoredState();
}

// Marks every tile as selected, removed or neither from the saved checklist,
// then re-applies the filters and the counter.
function applyStoredState() {
  const selected = store.selected[store.mode];
  const hidden = store.hidden[store.mode];

  for (const flair of grid.children) {
    const id = Number(flair.dataset.id);
    const isHidden = hidden.has(id);
    const isOn = !isHidden && selected.has(id);
    flair.classList.toggle('disabled', isHidden);
    flair.classList.toggle('selected', isOn);
    flair.setAttribute('aria-checked', String(isOn));
  }
  applyFilters();
}

// Fills the changelog box. Type names in the text (AGL, TEQ ...) are wrapped
// in a span so CSS can colour them.
function renderChangelog(data) {
  changelogList.textContent = '';
  for (const item of data.changelog) {
    const listItem = document.createElement('li');
    let html = escapeHtml(item);
    for (const word of TYPES.map(type => type.toUpperCase())) {
      html = html.replace(new RegExp(`\\b${word}\\b`, 'g'), `<span class="${word}">${word}</span>`);
    }
    listItem.innerHTML = html;
    changelogList.appendChild(listItem);
  }
}

// Shown in place of the grid when a data file cannot be fetched.
function showLoadError(err) {
  console.error('Could not load checklist data:', err);
  grid.innerHTML =
    '<p class="load-error">Could not load the checklist data. If you opened this file directly, ' +
    'serve it over http instead (for example <code>python -m http.server</code>) - browsers block ' +
    'data files on <code>file://</code> URLs.</p>';
}

/* --- Filters --------------------------------------------- */

// Independent axes; an icon must satisfy all of them to stay visible.
let ezaFilter = '';   // '' | 'eza' | 'eza2' | 'both' | 'none'
let typeFilter = '';  // '' | 'agl' | 'teq' | 'str' | 'phy' | 'int'
let f2pFilter = '';   // '' | 'f2p' - a lone on/off toggle
let classFilter = ''; // '' | 'super' | 'extreme'

// True if a tile passes all four filters as they are set now.
function matchesFilters(flair) {
  const isEza = flair.classList.contains('eza');
  const isEza2 = flair.classList.contains('eza2');

  switch (ezaFilter) {
    case 'eza':  if (!isEza || isEza2) return false; break;
    case 'eza2': if (!isEza2) return false; break;
    case 'both': if (!isEza && !isEza2) return false; break;
    case 'none': if (isEza || isEza2) return false; break;
  }

  if (f2pFilter === 'f2p' && !flair.classList.contains('f2p')) return false;
  if (typeFilter && !flair.classList.contains('type-' + typeFilter)) return false;
  if (classFilter && !flair.classList.contains('class-' + classFilter)) return false;
  return true;
}

// Shows or hides every tile according to the filters, then recounts.
function applyFilters() {
  // .disabled already carries display:none !important, so removed icons stay hidden.
  for (const flair of grid.children) {
    flair.style.display = matchesFilters(flair) ? '' : 'none';
  }
  updateCounter();
}

// True if a tile is on screen: not removed and not filtered out.
function isVisible(flair) {
  return !flair.classList.contains('disabled') && flair.style.display !== 'none';
}

// Each bar is a single-choice group over the same button markup, so they share
// one implementation. Each entry reads and writes its own filter variable, and
// an optional enabledFor() hides the bar for modes the filter does not apply to.
const FILTER_BARS = [
  { id: 'type-filter', read: () => typeFilter, write: value => { typeFilter = value; } },
  // Super / Extreme: no "All" button; clicking the lit one again clears it.
  { id: 'class-filter', read: () => classFilter, write: value => { classFilter = value; } },
  { id: 'eza-filter', read: () => ezaFilter, write: value => { ezaFilter = value; } },
  {
    id: 'f2p-filter',
    read: () => f2pFilter,
    write: value => { f2pFilter = value; },
    enabledFor: data => data.hasF2p
  }
];

// Called on every mode change so a bar that does not apply is both hidden and
// cleared - a hidden-but-active filter would silently empty the grid.
function syncFilterBarVisibility(data) {
  for (const bar of FILTER_BARS) {
    if (!bar.el || !bar.enabledFor) continue;
    const enabled = bar.enabledFor(data);
    bar.el.hidden = !enabled;
    if (!enabled) bar.write('');
  }
  syncFilterBars();
}

// Wires up the clicks on each filter bar.
function initFilterBars() {
  for (const bar of FILTER_BARS) {
    bar.el = document.getElementById(bar.id);
    bar.el.addEventListener('click', event => {
      const button = event.target.closest('button[data-value]');
      if (!button) return;
      // Clicking the active option again clears it, like the old toggles did.
      bar.write(button.dataset.value === bar.read() ? '' : button.dataset.value);
      syncFilterBars();
      applyFilters();
    });
  }
}

// Makes the highlighted button in each bar match its filter variable.
function syncFilterBars() {
  for (const bar of FILTER_BARS) {
    if (!bar.el) continue;
    const current = bar.read();
    for (const button of bar.el.querySelectorAll('button[data-value]')) {
      const active = button.dataset.value === current;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }
}

// Clears every filter and the "remove icons" switch (used on a side switch
// and after an import).
function resetFilterUi() {
  ezaFilter = '';
  typeFilter = '';
  f2pFilter = '';
  classFilter = '';
  hideToggle.checked = false;
  syncFilterBars();
}

/* --- Counter --------------------------------------------- */

// Rewrites the "Total - chosen/visible" line and the per-type breakdown,
// counting only the tiles currently on screen.
function updateCounter() {
  const data = modeData[store.mode];
  if (!data) return;

  const perType = {};
  for (const type of TYPES) perType[type] = { visible: 0, chosen: 0 };
  let visible = 0;
  let chosen = 0;

  for (const flair of grid.children) {
    if (!isVisible(flair)) continue;
    const isOn = flair.classList.contains('selected');
    visible++;
    if (isOn) chosen++;

    const type = data.typeOf.get(Number(flair.dataset.id));
    if (!type) continue;
    perType[type].visible++;
    if (isOn) perType[type].chosen++;
  }

  const breakdown = TYPES
    .filter(type => perType[type].visible > 0)
    .map(type => {
      const label = type.toUpperCase();
      return `<span class="${label}">${label} ${perType[type].chosen}/${perType[type].visible}</span>`;
    })
    .join('');

  counter.innerHTML =
    `<span class="cl">Total ${escapeHtml(data.label)} - </span>${chosen}/${visible}` +
    (breakdown ? `<span class="type-breakdown">${breakdown}</span>` : '');
}

/* --- Mode switching -------------------------------------- */

// Shows one side of the checklist: saves the choice, loads its data, then
// updates the title, favicon, switch button, filter bars, changelog and grid.
async function setMode(mode) {
  store.mode = mode;
  saveStore();

  document.body.classList.remove('lr', 'dfe');
  document.body.classList.add(mode);

  let data;
  try {
    data = await loadModeData(mode);
  } catch (err) {
    showLoadError(err);
    return;
  }

  document.title = data.title;
  document.getElementById('favicon').href = data.favicon;

  // The button shows the mode it will switch you to.
  const goingTo = mode === 'dfe' ? 'lr' : 'dfe';
  toggleButton.innerHTML = `<div class="${goingTo}_switch"></div>`;
  toggleButton.setAttribute('aria-label', goingTo === 'lr'
    ? 'Switch to the LR checklist'
    : 'Switch to the DFE checklist');

  syncArtPicker();
  syncFilterBarVisibility(data);
  renderChangelog(data);
  renderGrid();
}

// Wires up the side-switch button. The header and button flip, and the
// content is swapped at the midpoint. Visitors who ask their device for
// reduced motion get the swap without the flip.
function initModeToggle() {
  let switching = false;

  toggleButton.addEventListener('click', async () => {
    if (switching) return;
    switching = true;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resetFilterUi();
      await setMode(store.mode === 'dfe' ? 'lr' : 'dfe');
      switching = false;
      return;
    }

    toggleButton.classList.add('flip');
    header.classList.add('flip');
    iconContainer.classList.add('glitch-blur');

    // Swap the contents at the midpoint of the flip.
    setTimeout(async () => {
      resetFilterUi();
      await setMode(store.mode === 'dfe' ? 'lr' : 'dfe');

      toggleButton.classList.replace('flip', 'flip-back');
      header.classList.replace('flip', 'flip-back');
      iconContainer.classList.remove('glitch-blur');

      setTimeout(() => {
        toggleButton.classList.remove('flip-back');
        header.classList.remove('flip-back');
        switching = false;
      }, FLIP_HALF_MS);
    }, FLIP_HALF_MS);
  });
}

/* --- Icon interaction ------------------------------------ */

// One click handler for the whole grid: a click selects or deselects a tile,
// or removes it from the list while the "remove icons" switch is on.
function initGrid() {
  grid.addEventListener('click', event => {
    const flair = event.target.closest('.flair');
    if (!flair || flair.parentElement !== grid) return;

    const id = Number(flair.dataset.id);

    if (hideToggle.checked) {
      store.hidden[store.mode].add(id);
      store.selected[store.mode].delete(id);
      flair.classList.add('disabled');
      flair.classList.remove('selected');
      flair.setAttribute('aria-checked', 'false');
    } else {
      const isOn = !store.selected[store.mode].has(id);
      if (isOn) store.selected[store.mode].add(id);
      else store.selected[store.mode].delete(id);
      flair.classList.toggle('selected', isOn);
      flair.setAttribute('aria-checked', String(isOn));
    }

    saveStore();
    updateCounter();
  });
}

// Selects everything currently on screen, so an active filter is respected.
function selectVisible() {
  const selected = store.selected[store.mode];
  for (const flair of grid.children) {
    if (!isVisible(flair)) continue;
    selected.add(Number(flair.dataset.id));
    flair.classList.add('selected');
    flair.setAttribute('aria-checked', 'true');
  }
  saveStore();
  updateCounter();
}

// Clears every selection and removal on the side being shown.
function resetCurrentMode() {
  store.selected[store.mode].clear();
  store.hidden[store.mode].clear();
  saveStore();
  applyStoredState();
}

/* --- Removed icons --------------------------------------- */

// Opens the "Removed Icons" window listing every removed unit on this side.
function showRemoved() {
  const data = modeData[store.mode];
  const box = document.querySelector('.modal-content2');
  const hidden = [...store.hidden[store.mode]].sort((a, b) => a - b);

  box.textContent = '';
  hideToggle.checked = false;

  if (!hidden.length) {
    const message = document.createElement('p');
    message.className = 'modal-empty';
    message.textContent = 'No icons have been removed.';
    box.appendChild(message);
  }

  for (const id of hidden) {
    box.appendChild(createRemovedTile(id));
  }

  openModal('removed-modal');
}

// One entry in the removed-icons list: a small tile built from the same
// layers as the grid, labelled for screen readers.
function createRemovedTile(id) {
  const data = modeData[store.mode];
  const type = data.typeOf.get(id);
  const tile = document.createElement('div');
  tile.className = 'flair';
  if (type) tile.classList.add('type-' + type);
  tile.dataset.id = String(id);
  tile.setAttribute('role', 'img');
  tile.setAttribute('aria-label', `Icon ${id}`);
  buildLayers(tile, id, type);
  return tile;
}

// Clicking a tile in the removed list puts it back in the grid.
function initRemovedModal() {
  document.querySelector('.modal-content2').addEventListener('click', event => {
    const icon = event.target.closest('[data-id]');
    if (!icon) return;
    store.hidden[store.mode].delete(Number(icon.dataset.id));
    saveStore();
    icon.remove();
    applyStoredState();
  });
}

/* --- Stats ----------------------------------------------- */

// The groups in the Stats window, in order. Each test picks the units that
// belong to the group; colours come from css/style.css by data-key.
const STAT_SECTIONS = [
  {
    title: 'By type',
    rows: TYPES.map(type => ({ key: type, label: type.toUpperCase(), test: unit => unit.type === type }))
  },
  {
    title: 'By class',
    rows: [
      { key: 'super', label: 'Super', test: unit => unit.class === 'super' },
      { key: 'extreme', label: 'Extreme', test: unit => unit.class === 'extreme' }
    ]
  },
  {
    title: 'EZA',
    rows: [
      { key: 'eza', label: 'EZA', test: unit => unit.eza === 1 || unit.eza === 2 },
      { key: 'eza2', label: 'Super EZA', test: unit => unit.eza === 2 },
      { key: 'noeza', label: 'No EZA', test: unit => !unit.eza }
    ]
  },
  {
    title: 'Free to play',
    onlyIf: data => data.hasF2p,
    rows: [{ key: 'f2p', label: 'F2P', test: (unit, id, data) => data.f2p.has(id) }]
  }
];

// Fills and opens the Stats window for the side on screen: owned out of total
// overall and per group. Removed icons are left out of every total, the same
// as the counter at the top of the page. Filters are ignored on purpose, so
// the numbers describe the whole collection.
function showStats() {
  const data = modeData[store.mode];
  if (!data) return;
  const selected = store.selected[store.mode];
  const hidden = store.hidden[store.mode];

  // Owned / total for every unit that passes `test`.
  const count = test => {
    let have = 0;
    let total = 0;
    for (const [key, unit] of Object.entries(data.units)) {
      const id = Number(key);
      if (hidden.has(id) || !test(unit, id, data)) continue;
      total++;
      if (selected.has(id)) have++;
    }
    return { have, total };
  };

  const box = document.getElementById('stats-content');
  box.textContent = '';

  // The headline: one large bar for the whole side.
  const all = count(() => true);
  const head = document.createElement('div');
  head.className = 'stats-total';
  const line = document.createElement('div');
  line.className = 'stats-total-line';
  const name = document.createElement('span');
  name.textContent = 'All ' + data.label;
  const nums = document.createElement('span');
  const big = document.createElement('b');
  big.textContent = String(all.have);
  nums.append(big, ` / ${all.total}  ${percent(all)}%`);
  line.append(name, nums);
  head.append(line, statBar(all, 'all'));
  box.appendChild(head);

  // The groups, in a grid of sections.
  const grid = document.createElement('div');
  grid.className = 'stats-grid';
  for (const section of STAT_SECTIONS) {
    if (section.onlyIf && !section.onlyIf(data)) continue;
    const block = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = section.title;
    block.appendChild(title);
    for (const row of section.rows) block.appendChild(statRow(row, count(row.test)));
    grid.appendChild(block);
  }
  box.appendChild(grid);

  if (hidden.size) {
    const note = document.createElement('p');
    note.className = 'stats-note';
    note.textContent = `${hidden.size} removed icon(s) are left out of these numbers.`;
    box.appendChild(note);
  }

  openModal('stats-modal');
}

// Whole-number percentage of owned out of total (0 when the group is empty).
function percent(group) {
  return group.total ? Math.round(group.have / group.total * 100) : 0;
}

// A progress bar filled to the group's percentage, coloured by its key.
function statBar(group, key) {
  const bar = document.createElement('div');
  bar.className = 'stat-bar';
  bar.dataset.key = key;
  bar.setAttribute('role', 'presentation');
  const fill = document.createElement('span');
  fill.style.width = percent(group) + '%';
  bar.appendChild(fill);
  return bar;
}

// One labelled line in the Stats window: name, bar, "have/total pct%".
function statRow(row, group) {
  const line = document.createElement('div');
  line.className = 'stat-row';
  line.dataset.key = row.key;
  const name = document.createElement('span');
  name.className = 'stat-name';
  name.textContent = row.label;
  const nums = document.createElement('span');
  nums.className = 'stat-num';
  const pct = document.createElement('small');
  pct.textContent = percent(group) + '%';
  nums.append(`${group.have}/${group.total} `, pct);
  line.append(name, statBar(group, row.key), nums);
  return line;
}

/* --- Modals ---------------------------------------------- */

// The window that is open (or null), and the control that had keyboard focus
// when it opened, so focus can be handed back on close.
let activeModal = null;
let modalOpener = null;

// Shows a window and moves keyboard focus to its first field or button.
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modalOpener = document.activeElement;
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  modal.setAttribute('aria-hidden', 'false');
  activeModal = modal;

  // The window fades in through a CSS transition on visibility, and for the
  // first instant it still counts as hidden, when focus() is ignored. So the
  // focus is moved a moment later, if this window is still the open one.
  const first = modal.querySelector('input:not([type="file"]), button');
  if (first) {
    setTimeout(() => {
      if (activeModal === modal) first.focus();
    }, MODAL_FOCUS_MS);
  }
}

// Hides a window (the open one if none is given) and returns keyboard focus
// to the control that opened it.
function closeModal(modal) {
  const target = modal || activeModal;
  if (!target) return;
  target.style.visibility = 'hidden';
  target.style.opacity = '0';
  target.setAttribute('aria-hidden', 'true');
  // A half-typed import code should not linger for the next time.
  if (target.id === 'import-modal') document.getElementById('import-text').value = '';
  if (activeModal === target) activeModal = null;

  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
}

// Wires up the three ways to close a window: its close button, a click on
// the dimmed backdrop, and the Escape key.
function initModals() {
  for (const button of document.querySelectorAll('.modal .close-btn')) {
    button.addEventListener('click', () => closeModal(button.closest('.modal')));
  }
  document.addEventListener('click', event => {
    if (activeModal && event.target === activeModal) closeModal(activeModal);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeModal) closeModal(activeModal);
  });
}

// Timers of toasts still on screen, keyed by element, so a repeat click
// restarts the message instead of cutting it short.
const toastTimers = new Map();

// Briefly shows one of the small status messages ("Copied to clipboard!").
// The fade in and out is the "toast-fade" animation in css/style.css.
function toast(selector) {
  const element = document.querySelector(selector);
  if (!element) return;
  clearTimeout(toastTimers.get(element));
  element.classList.remove('toast-show');
  void element.offsetWidth; // restart the animation if it was mid-way
  element.classList.add('toast-show');
  toastTimers.set(element, setTimeout(() => element.classList.remove('toast-show'), TOAST_MS));
}

// Shows a message in the banner at the top of the page until it is dismissed.
// Used for things the visitor must not miss, such as saving not working.
function showNotice(message) {
  const banner = document.getElementById('notice');
  if (!banner) return;
  document.getElementById('notice-text').textContent = message;
  banner.hidden = false;
}

/* --- Image export ---------------------------------------- */

// Runs one capture of the icon grid. `method` is the html-to-image function
// to use ('toPng' or 'toBlob'); `extraOptions` are merged over
// CAPTURE_OPTIONS. Shared by the on-screen preview and the download so the two
// cannot drift apart. Tiles are made of real images, so nothing on the page
// needs patching before a capture.
function captureGrid(method, extraOptions) {
  return htmlToImage[method](iconContainer, Object.assign({}, CAPTURE_OPTIONS, extraOptions));
}

// html-to-image settings shared by every capture: three times screen
// resolution, no font embedding, and browser extension stylesheets skipped.
const CAPTURE_OPTIONS = {
  pixelRatio: 3,
  skipFonts: true,
  filter: node => !(node.tagName === 'LINK' && node.href && node.href.startsWith('moz-extension://'))
};

// If the export library did not load, says so inside the window and returns true.
function reportMissingLibrary(box) {
  if (typeof htmlToImage !== 'undefined') return false;
  box.textContent = '';
  const message = document.createElement('p');
  message.className = 'modal-empty';
  message.textContent = 'The image export library failed to load. Check your connection and reload the page.';
  box.appendChild(message);
  return true;
}

// "Generate Image": renders the grid to a picture and shows it in a window.
async function generateImage() {
  const box = document.querySelector('.modal-content');
  box.textContent = '';
  openModal('image-modal');
  if (reportMissingLibrary(box)) return;

  try {
    const dataUrl = await captureGrid('toPng', {
      skipAutoScale: false,
      style: { transform: 'scale(1)', transformOrigin: 'top left' }
    });
    const image = new Image();
    image.src = dataUrl;
    image.alt = 'Checklist export';
    image.style.width = iconContainer.offsetWidth + 'px';
    image.style.height = iconContainer.offsetHeight + 'px';
    box.appendChild(image);
  } catch (err) {
    console.error('Image generation failed:', err);
    box.textContent = 'Image generation failed. See the browser console for details.';
  }
}

// "Download Image": renders the grid again and saves it as checklist.png.
async function downloadImage() {
  if (typeof htmlToImage === 'undefined' || typeof window.saveAs !== 'function') {
    console.error('Image export libraries are not available.');
    return;
  }

  try {
    const blob = await captureGrid('toBlob');
    if (blob) window.saveAs(blob, 'checklist.png');
    else console.error('Image blob generation failed.');
  } catch (err) {
    console.error('Download failed:', err);
  }
}

/* --- Import / export ------------------------------------- */

// Opens the Export window with the checklist packed into a copyable code.
function openExport() {
  const field = document.getElementById('export-text');
  field.value = LZString.compressToEncodedURIComponent(JSON.stringify(serialize()));
  openModal('export-modal'); // also moves focus to this field
  field.select();
}

// "Copy": puts the export code on the clipboard and confirms with a toast.
async function copyExport() {
  const field = document.getElementById('export-text');
  field.select();
  try {
    await navigator.clipboard.writeText(field.value);
  } catch (err) {
    try {
      document.execCommand('copy');
    } catch (fallbackErr) {
      console.error('Could not copy to the clipboard:', err, fallbackErr);
      return;
    }
  }
  toast('#display-copied');
}

// "Download backup file": saves the whole checklist (both sides) as a small
// JSON file named with today's date.
function downloadBackup() {
  const content = JSON.stringify(Object.assign({ savedAt: new Date().toISOString() }, serialize()), null, 2);
  const blob = new Blob([content], { type: 'application/json' });
  const name = `dokkan-checklist-${new Date().toISOString().slice(0, 10)}.json`;

  if (typeof window.saveAs === 'function') {
    window.saveAs(blob, name);
    return;
  }
  // FileSaver did not load: fall back to a temporary download link.
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Replaces the checklist with an imported one, from a code or a backup file.
// The payload is checked before anything saved is touched, and the visitor
// must confirm if there is progress to lose.
async function importPayload(payload) {
  if (!isChecklist(payload)) {
    toast('#import-error');
    return;
  }
  if (hasProgress() && !confirm('Importing will replace your current checklist on BOTH sides. Continue?')) {
    return;
  }

  applyState(payload);
  saveStore();
  resetFilterUi();
  await setMode(store.mode);
  toast('#imported');
}

// "Import": decodes the pasted code and imports it.
function importSelection() {
  const code = document.getElementById('import-text').value.trim();
  let payload = null;
  try {
    payload = JSON.parse(LZString.decompressFromEncodedURIComponent(code) || 'null');
  } catch (err) {
    payload = null;
  }
  return importPayload(payload);
}

// "Load backup file": reads the chosen JSON file and imports it.
async function loadBackupFile(input) {
  const file = input.files && input.files[0];
  input.value = ''; // so choosing the same file again still fires "change"
  if (!file) return;

  let payload = null;
  try {
    payload = JSON.parse(await file.text());
  } catch (err) {
    payload = null;
  }
  await importPayload(payload);
}

/* --- Last update date ------------------------------------ */

// Fills in "Last Update: <date>" in the changelog box from the newest commit
// on GitHub (cached, see COMMIT_CACHE_MS). On failure the heading stays empty.
async function showLastUpdate() {
  const heading = document.querySelector('#changelog h3');
  if (!heading) return;

  const render = iso => {
    heading.textContent = 'Last Update: ' + new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  };

  try {
    const cached = JSON.parse(localStorage.getItem(COMMIT_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < COMMIT_CACHE_MS) {
      render(cached.date);
      return;
    }
  } catch (err) {
    /* cache unreadable - fall through and refetch */
  }

  try {
    const response = await fetch(COMMIT_API);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const commits = await response.json();
    const date = Array.isArray(commits) && commits[0] && commits[0].commit
      && commits[0].commit.committer && commits[0].commit.committer.date;
    if (!date) throw new Error('unexpected response shape');

    render(date);
    localStorage.setItem(COMMIT_CACHE_KEY, JSON.stringify({ date, at: Date.now() }));
  } catch (err) {
    console.warn('Could not fetch the last update date:', err);
  }
}

/* --- Alt art --------------------------------------------- */

// Lights the art picker button that matches the saved choice.
function syncArtPicker() {
  const current = store.altArt ? 'alt' : 'standard';
  for (const button of artPicker.querySelectorAll('button[data-value]')) {
    const active = button.dataset.value === current;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

// The art picker ("Standard" / "Alt"): saves the choice and swaps the thumb
// on every unit that has alt art. Clicking the lit button changes nothing.
function initArtPicker() {
  artPicker.addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button) return;
    const wantAlt = button.dataset.value === 'alt';
    if (wantAlt === store.altArt) return;

    store.altArt = wantAlt;
    saveStore();
    syncArtPicker();

    const data = modeData[store.mode];
    for (const flair of grid.children) {
      const id = Number(flair.dataset.id);
      if (data.altArt.has(id)) setThumbArt(flair, id);
    }
  });
}

/* --- Boot ------------------------------------------------ */

// Start-up: find the page elements, load the saved checklist, wire up every
// control, then draw the saved side.
document.addEventListener('DOMContentLoaded', async () => {
  grid = document.getElementById('special');
  counter = document.getElementById('counter');
  changelogList = document.getElementById('changelog-item');
  iconContainer = document.getElementById('icon-container');
  header = document.getElementById('header');
  toggleButton = document.getElementById('toggleButton');
  hideToggle = document.getElementById('hide-lr');
  artPicker = document.getElementById('art-picker');
  buildId = document.body.dataset.build || '';

  loadStore();
  initFilterBars();
  resetFilterUi();

  initModals();
  initGrid();
  initRemovedModal();
  initArtPicker();
  initModeToggle();

  document.getElementById('select-all').addEventListener('click', selectVisible);
  document.getElementById('select-none').addEventListener('click', () => {
    if (confirm("Are you sure you want to reset the page? (This won't affect the other side of the checklist)")) {
      resetCurrentMode();
    }
  });
  document.getElementById('list-hidden').addEventListener('click', showRemoved);
  document.getElementById('show-stats').addEventListener('click', showStats);
  document.getElementById('generate').addEventListener('click', generateImage);
  document.getElementById('image-download').addEventListener('click', downloadImage);
  document.getElementById('import').addEventListener('click', () => openModal('import-modal'));
  document.getElementById('import-btn').addEventListener('click', importSelection);
  document.getElementById('export').addEventListener('click', openExport);
  document.getElementById('copy-export').addEventListener('click', copyExport);
  document.getElementById('download-backup').addEventListener('click', downloadBackup);

  const backupInput = document.getElementById('backup-file');
  document.getElementById('load-backup').addEventListener('click', () => backupInput.click());
  backupInput.addEventListener('change', () => loadBackupFile(backupInput));
  document.getElementById('notice-close').addEventListener('click', () => {
    document.getElementById('notice').hidden = true;
  });

  const exportField = document.getElementById('export-text');
  exportField.addEventListener('click', () => exportField.select());

  document.getElementById('year').textContent = String(new Date().getFullYear());

  await setMode(store.mode);
  showLastUpdate();
});

'use strict';

/* ============================================================
   Dokkan Battle Checklist
   ------------------------------------------------------------
   Character data lives in data/lr.json and data/dfe.json.
   Nothing in this file needs editing to add a character.
   Run `node validate-data.js` after editing the data files.
   ============================================================ */

/* --- Constants ------------------------------------------- */

const TYPES = ['agl', 'teq', 'str', 'phy', 'int'];
const TYPE_WORDS = ['AGL', 'INT', 'STR', 'TEQ', 'PHY'];
const MODE_IDS = ['lr', 'dfe'];
const MODE_SOURCES = { lr: 'data/lr.json', dfe: 'data/dfe.json' };

const STORAGE_KEY = 'dokkanChecklist';
const STORAGE_VERSION = 2;

const COMMIT_CACHE_KEY = 'dokkanLastUpdate';
const COMMIT_CACHE_MS = 6 * 60 * 60 * 1000;
const COMMIT_API = 'https://api.github.com/repos/dokkanlist/dokkanlist.github.io/commits?per_page=1';

const FLIP_HALF_MS = 150;

/* --- Range helpers --------------------------------------- */

// "1-3,7,10-12" -> [1,2,3,7,10,11,12]
function parseRanges(rangeString) {
  const result = [];
  for (const part of String(rangeString || '').split(',')) {
    const token = part.trim();
    if (!token) continue;

    if (token.includes('-')) {
      const [start, end] = token.split('-').map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        console.warn(`Ignoring malformed range "${token}"`);
        continue;
      }
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      const value = Number(token);
      if (Number.isFinite(value)) result.push(value);
      else console.warn(`Ignoring malformed value "${token}"`);
    }
  }
  return result;
}

// [1,2,3,7,10,11,12] -> "1-3,7,10-12"
function formatRanges(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) end = sorted[++i];
    parts.push(start === end ? String(start) : `${start}-${end}`);
    i++;
  }
  return parts.join(',');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

/* --- Persistent state ------------------------------------ */

const store = {
  mode: 'lr',
  altArt: false,
  selected: { lr: new Set(), dfe: new Set() },
  hidden: { lr: new Set(), dfe: new Set() }
};

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

// Returns false if the payload is not a checklist we understand.
function applyState(payload) {
  if (!payload || typeof payload !== 'object' || payload.v !== STORAGE_VERSION) return false;

  store.mode = MODE_IDS.includes(payload.mode) ? payload.mode : 'lr';
  store.altArt = payload.altArt === true;
  for (const mode of MODE_IDS) {
    const side = payload[mode] || {};
    store.selected[mode] = new Set(parseRanges(side.selected));
    store.hidden[mode] = new Set(parseRanges(side.hidden));
  }
  return true;
}

function saveStore() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize()));
  } catch (err) {
    console.error('Could not save the checklist:', err);
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

function loadStore() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error('localStorage is unavailable, progress will not be saved:', err);
    return;
  }

  if (raw) {
    try {
      if (applyState(JSON.parse(raw))) return;
    } catch (err) {
      console.warn('Saved checklist was unreadable, starting fresh:', err);
    }
  }
  migrateLegacy();
}

/* --- Character data -------------------------------------- */

const modeData = {};
let buildId = '';

function normaliseData(raw) {
  const typeOf = new Map();
  for (const type of TYPES) {
    for (const id of parseRanges(raw.types && raw.types[type])) typeOf.set(id, type);
  }
  return {
    label: raw.label,
    title: raw.title,
    favicon: raw.favicon,
    iconDir: raw.iconDir,
    idSuffix: raw.idSuffix || '',
    total: Number(raw.total) || 0,
    changelog: Array.isArray(raw.changelog) ? raw.changelog : [],
    typeOf,
    eza: new Set(parseRanges(raw.eza)),
    eza2: new Set(parseRanges(raw.eza2)),
    f2p: new Set(parseRanges(raw.f2p)),
    // Declaring an "f2p" key opts a mode into the F2P filter, so an empty list
    // still shows the bar while a mode that omits the key entirely hides it.
    hasF2p: typeof raw.f2p === 'string',
    altArt: new Set(Array.isArray(raw.altArt) ? raw.altArt : [])
  };
}

async function loadModeData(mode) {
  if (modeData[mode]) return modeData[mode];
  const url = MODE_SOURCES[mode] + (buildId ? `?v=${buildId}` : '');
  // no-cache = always revalidate with the server (a cheap 304 when unchanged).
  // The data files are the ones edited most often and are only ~2KB, so this
  // means a data edit shows up on a plain refresh even if --stamp was skipped,
  // instead of the browser silently serving the previous list from cache.
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${MODE_SOURCES[mode]} responded ${response.status}`);
  modeData[mode] = normaliseData(await response.json());
  return modeData[mode];
}

/* --- Elements (assigned on DOMContentLoaded) ------------- */

let grid, counter, changelogList, iconContainer, header, toggleButton;
let hideToggle, altArtToggle;

/* --- Rendering ------------------------------------------- */

function setIconArt(flair, id) {
  const data = modeData[store.mode];
  const suffix = store.altArt && data.altArt.has(id) ? '_alt' : '';

  // Resolved to an absolute URL on purpose. A relative path would be read
  // against the document for background-image but against css/style.css for
  // --flair-bg (which ::after consumes), so no single relative path is correct
  // for both. Absolute also survives being served from a subdirectory.
  const href = new URL(`${data.iconDir}/icons/${id}${suffix}.webp`, document.baseURI).href;
  const url = `url("${href}")`;

  flair.style.backgroundImage = url;
  // Super EZA icons blank their own background and paint it through ::after.
  if (flair.classList.contains('glow-pulse')) flair.style.setProperty('--flair-bg', url);
}

function renderGrid() {
  const data = modeData[store.mode];
  const fragment = document.createDocumentFragment();

  for (let id = 1; id <= data.total; id++) {
    const flair = document.createElement('div');
    flair.className = 'flair';
    flair.id = id + data.idSuffix;
    flair.dataset.id = String(id);
    flair.setAttribute('role', 'checkbox');
    flair.setAttribute('aria-checked', 'false');

    const type = data.typeOf.get(id);
    if (type) flair.classList.add('type-' + type);
    if (data.eza.has(id)) flair.classList.add('eza');
    if (data.eza2.has(id)) flair.classList.add('eza2', 'glow-pulse');
    if (data.f2p.has(id)) flair.classList.add('f2p');
    if (data.altArt.has(id)) flair.classList.add('has-alt');

    setIconArt(flair, id);

    if (data.eza2.has(id) && type) {
      const overlay = document.createElement('div');
      overlay.className = `lightning-overlay lightning-${type}`;
      flair.appendChild(overlay);
    }
    fragment.appendChild(flair);
  }

  grid.textContent = '';
  grid.appendChild(fragment);
  applyStoredState();
}

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

function renderChangelog(data) {
  changelogList.textContent = '';
  for (const item of data.changelog) {
    const listItem = document.createElement('li');
    let html = escapeHtml(item);
    for (const word of TYPE_WORDS) {
      html = html.replace(new RegExp(`\\b${word}\\b`, 'g'), `<span class="${word}">${word}</span>`);
    }
    listItem.innerHTML = html;
    changelogList.appendChild(listItem);
  }
}

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
  return true;
}

function applyFilters() {
  // .disabled already carries display:none !important, so removed icons stay hidden.
  for (const flair of grid.children) {
    flair.style.display = matchesFilters(flair) ? '' : 'none';
  }
  updateCounter();
}

function isVisible(flair) {
  return !flair.classList.contains('disabled') && flair.style.display !== 'none';
}

// Each bar is a single-choice group over the same button markup, so they share
// one implementation. Each entry reads and writes its own filter variable, and
// an optional enabledFor() hides the bar for modes the filter does not apply to.
const FILTER_BARS = [
  { id: 'type-filter', read: () => typeFilter, write: value => { typeFilter = value; } },
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

function resetFilterUi() {
  ezaFilter = '';
  typeFilter = '';
  f2pFilter = '';
  hideToggle.checked = false;
  syncFilterBars();
}

/* --- Counter --------------------------------------------- */

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

  altArtToggle.checked = store.altArt;
  syncFilterBarVisibility(data);
  renderChangelog(data);
  renderGrid();
}

function initModeToggle() {
  let switching = false;

  toggleButton.addEventListener('click', () => {
    if (switching) return;
    switching = true;

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

function resetCurrentMode() {
  store.selected[store.mode].clear();
  store.hidden[store.mode].clear();
  saveStore();
  applyStoredState();
}

/* --- Removed icons --------------------------------------- */

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
    const icon = document.createElement('img');
    icon.className = 'flair';
    icon.dataset.id = String(id);
    icon.src = `${data.iconDir}/icons/${id}.webp`;
    icon.alt = `Icon ${id}`;
    box.appendChild(icon);
  }

  openModal('removed-modal');
}

function initRemovedModal() {
  document.querySelector('.modal-content2').addEventListener('click', event => {
    const icon = event.target.closest('img[data-id]');
    if (!icon) return;
    store.hidden[store.mode].delete(Number(icon.dataset.id));
    saveStore();
    icon.remove();
    applyStoredState();
  });
}

/* --- Modals ---------------------------------------------- */

let activeModal = null;

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  modal.setAttribute('aria-hidden', 'false');
  activeModal = modal;
}

function closeModal(modal) {
  const target = modal || activeModal;
  if (!target) return;
  target.style.visibility = 'hidden';
  target.style.opacity = '0';
  target.setAttribute('aria-hidden', 'true');
  document.getElementById('import-text').value = '';
  if (activeModal === target) activeModal = null;
}

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

function toast(selector) {
  $(selector).stop(true, true).fadeIn(150).delay(1200).fadeOut(300);
}

/* --- Image export ---------------------------------------- */

// html-to-image cannot render ::after with a var() background, so the icon art
// is temporarily re-added as a real <img> sitting above the lightning overlay.
function prepareForCapture() {
  for (const flair of document.querySelectorAll('.flair.glow-pulse')) {
    const background = flair.style.getPropertyValue('--flair-bg');
    const match = background && background.match(/url\(["']?(.+?)["']?\)/);
    if (!match) continue;

    const image = document.createElement('img');
    image.src = match[1];
    image.className = 'capture-icon-img';
    image.alt = '';
    flair.appendChild(image);
  }
  document.documentElement.classList.add('capturing');
}

function restoreAfterCapture() {
  for (const image of document.querySelectorAll('.capture-icon-img')) image.remove();
  document.documentElement.classList.remove('capturing');
}

const CAPTURE_OPTIONS = {
  pixelRatio: 3,
  skipFonts: true,
  filter: node => !(node.tagName === 'LINK' && node.href && node.href.startsWith('moz-extension://'))
};

function reportMissingLibrary(box) {
  if (typeof htmlToImage !== 'undefined') return false;
  box.textContent = '';
  const message = document.createElement('p');
  message.className = 'modal-empty';
  message.textContent = 'The image export library failed to load. Check your connection and reload the page.';
  box.appendChild(message);
  return true;
}

async function generateImage() {
  const box = document.querySelector('.modal-content');
  box.textContent = '';
  openModal('image-modal');
  if (reportMissingLibrary(box)) return;

  prepareForCapture();
  try {
    const dataUrl = await htmlToImage.toPng(iconContainer, Object.assign({}, CAPTURE_OPTIONS, {
      skipAutoScale: false,
      style: { transform: 'scale(1)', transformOrigin: 'top left' }
    }));
    const image = new Image();
    image.src = dataUrl;
    image.alt = 'Checklist export';
    image.style.width = iconContainer.offsetWidth + 'px';
    image.style.height = iconContainer.offsetHeight + 'px';
    box.appendChild(image);
  } catch (err) {
    console.error('Image generation failed:', err);
    box.textContent = 'Image generation failed. See the browser console for details.';
  } finally {
    restoreAfterCapture();
  }
}

async function downloadImage() {
  if (typeof htmlToImage === 'undefined' || typeof window.saveAs !== 'function') {
    console.error('Image export libraries are not available.');
    return;
  }

  prepareForCapture();
  try {
    const blob = await htmlToImage.toBlob(iconContainer, CAPTURE_OPTIONS);
    if (blob) window.saveAs(blob, 'checklist.png');
    else console.error('Image blob generation failed.');
  } catch (err) {
    console.error('Download failed:', err);
  } finally {
    restoreAfterCapture();
  }
}

/* --- Import / export ------------------------------------- */

function openExport() {
  const field = document.getElementById('export-text');
  field.value = LZString.compressToEncodedURIComponent(JSON.stringify(serialize()));
  openModal('export-modal');
  field.focus();
  field.select();
}

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

async function importSelection() {
  const code = document.getElementById('import-text').value.trim();

  // Decode and validate before touching anything already saved, so a bad code
  // leaves the existing checklist untouched.
  let payload = null;
  try {
    payload = JSON.parse(LZString.decompressFromEncodedURIComponent(code) || 'null');
  } catch (err) {
    payload = null;
  }

  if (!applyState(payload)) {
    toast('#import-error');
    return;
  }

  saveStore();
  resetFilterUi();
  await setMode(store.mode);
  toast('#imported');
}

/* --- Last update date ------------------------------------ */

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

function initAltArtToggle() {
  altArtToggle.addEventListener('change', () => {
    store.altArt = altArtToggle.checked;
    saveStore();

    const data = modeData[store.mode];
    for (const flair of grid.children) {
      const id = Number(flair.dataset.id);
      if (data.altArt.has(id)) setIconArt(flair, id);
    }
  });
}

/* --- Boot ------------------------------------------------ */

document.addEventListener('DOMContentLoaded', async () => {
  grid = document.getElementById('special');
  counter = document.getElementById('counter');
  changelogList = document.getElementById('changelog-item');
  iconContainer = document.getElementById('icon-container');
  header = document.getElementById('header');
  toggleButton = document.getElementById('toggleButton');
  hideToggle = document.getElementById('hide-lr');
  altArtToggle = document.getElementById('show-alt-art');
  buildId = document.body.dataset.build || '';

  loadStore();
  initFilterBars();
  resetFilterUi();

  initModals();
  initGrid();
  initRemovedModal();
  initAltArtToggle();
  initModeToggle();

  document.getElementById('select-all').addEventListener('click', selectVisible);
  document.getElementById('select-none').addEventListener('click', () => {
    if (confirm("Are you sure you want to reset the page? (This won't affect the other side of the checklist)")) {
      resetCurrentMode();
    }
  });
  document.getElementById('list-hidden').addEventListener('click', showRemoved);
  document.getElementById('generate').addEventListener('click', generateImage);
  document.getElementById('image-download').addEventListener('click', downloadImage);
  document.getElementById('import').addEventListener('click', () => openModal('import-modal'));
  document.getElementById('import-btn').addEventListener('click', importSelection);
  document.getElementById('export').addEventListener('click', openExport);
  document.getElementById('copy-export').addEventListener('click', copyExport);

  const exportField = document.getElementById('export-text');
  exportField.addEventListener('click', () => exportField.select());

  document.getElementById('year').textContent = String(new Date().getFullYear());

  await setMode(store.mode);
  showLastUpdate();
});

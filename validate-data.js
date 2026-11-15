#!/usr/bin/env node
'use strict';

/*
 * validate-data.js
 * ----------------
 * Checks data/lr.json and data/dfe.json, their units files and the layer
 * images against what is actually on disk.
 * Run it after editing a data file, before committing:
 *
 *   node validate-data.js                report problems
 *   node validate-data.js --stamp        also refresh the cache-busting build id
 *   node validate-data.js --check-stamp  also fail if index.html carries an old
 *                                        build id (writes nothing; used by CI)
 *
 * Paths are read relative to the folder the command is run from (the repo
 * root). Exits non-zero if anything is wrong, so it works as a pre-commit hook.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Ranges = require('./js/ranges.js');

const TYPES = ['agl', 'teq', 'str', 'phy', 'int'];
const DATA_FILES = ['data/lr.json', 'data/dfe.json'];

// Every key a data file may have. Anything else is treated as a typing slip.
const DATA_KEYS = ['mode', 'label', 'title', 'favicon', 'iconDir', 'idSuffix', 'total',
  'types', 'eza', 'eza2', 'f2p', 'altArt', 'changelog'];

// Files whose contents decide the cache-busting build id.
const HASHED_FILES = [
  'css/style.css',
  'css/flairs.css',
  'js/ranges.js',
  'js/scripts.js',
  'js/lz-string.js',
  'data/lr.json',
  'data/dfe.json',
  'data/lr.units.json',
  'data/dfe.units.json'
];

const errors = [];
const warnings = [];

// Records a problem that must be fixed (the run exits 1).
function error(scope, message) { errors.push(`${scope}: ${message}`); }
// Records something worth a look that does not fail the run.
function warn(scope, message) { warnings.push(`${scope}: ${message}`); }

// Parses a range string with the same code the site uses (js/ranges.js), and
// records every rejected token as a validation error against `scope` / `field`.
function parseRanges(rangeString, scope, field) {
  return Ranges.parseRanges(rangeString, {
    onError: message => error(scope, `${field}: ${message}`)
  });
}

// Shortens a long list of numbers for a message: the first few, then a count.
function summarise(numbers, limit = 12) {
  const shown = numbers.slice(0, limit).join(', ');
  return numbers.length > limit ? `${shown} ... (${numbers.length} total)` : shown;
}

// Parses one id list field (eza, eza2, f2p) and applies the rules they share:
// it must be a range string, no id may appear twice, and every id must be
// within 1..total. Returns the ids as a Set.
function checkIdList(scope, field, value, total) {
  if (typeof value !== 'string') {
    error(scope, `${field} must be a range string, e.g. "1-3, 7, 10-12"`);
    return new Set();
  }
  const seen = new Set();
  const repeated = new Set();
  for (const id of parseRanges(value, scope, field)) {
    if (seen.has(id)) repeated.add(id);
    seen.add(id);
  }
  if (repeated.size) {
    error(scope, `${field} lists ${summarise([...repeated].sort((a, b) => a - b))} more than once`);
  }
  const outside = [...seen].filter(id => id < 1 || id > total).sort((a, b) => a - b);
  if (outside.length) error(scope, `${field} lists ${summarise(outside)}, outside 1-${total}`);
  return seen;
}

// Shared layer images every tile is built from (original game file names).
// Frames are per type; class + type badges are per class and type; the rarity
// badge is one per side.
const LAYER_DIR = 'images/layers';
const LAYER_FILES = [
  ...[0, 1, 2, 3, 4].map(t => `cha_base_0${t}_04.png`),
  ...[1, 2].flatMap(c => [0, 1, 2, 3, 4].map(t => `cha_type_icon_${c}${t}.png`)),
  'cha_rare_lr.png',
  'cha_rare_ur.png'
];
const CLASSES = ['super', 'extreme'];
const UNIT_KEYS = ['id', 'class', 'tx', 'ty', 'alt'];
const ALT_KEYS = ['id', 'tx', 'ty'];
// Thumb offsets are small nudges in pixels; anything larger is a typing slip.
const MAX_OFFSET = 40;

// Checks that every shared layer image exists. Run once, not per side.
function checkLayers() {
  for (const name of LAYER_FILES) {
    if (!fs.existsSync(path.join(LAYER_DIR, name))) error('layers', `${LAYER_DIR}/${name} is missing`);
  }
}

// Checks one thumb placement object ({ id, tx, ty }) inside a units file.
// `seenIds` collects game ids so a duplicate anywhere in the file is caught.
function checkPlacement(scope, label, entry, seenIds) {
  if (!Number.isInteger(entry.id) || entry.id < 1000000 || entry.id > 9999999) {
    error(scope, `${label}: id must be a 7 digit game card id`);
  } else if (seenIds.has(entry.id)) {
    error(scope, `${label}: id ${entry.id} is already used by ${seenIds.get(entry.id)}`);
  } else {
    seenIds.set(entry.id, label);
  }
  for (const axis of ['tx', 'ty']) {
    if (!Number.isInteger(entry[axis]) || Math.abs(entry[axis]) > MAX_OFFSET) {
      error(scope, `${label}: ${axis} must be a whole number between -${MAX_OFFSET} and ${MAX_OFFSET}`);
    }
  }
}

// Checks the raw thumbs in <iconDir>/thumbs and the units sidecar
// (data/<side>.units.json) that the layered tiles are built from:
// one thumb and one units entry per id in 1..total, alt art in step with
// the altArt list, and every entry well formed.
function checkLayered(scope, file, iconDir, total, altArt) {
  // --- thumbs on disk ---
  const thumbDir = path.join(iconDir, 'thumbs');
  if (!fs.existsSync(thumbDir)) {
    error(scope, `${iconDir}/thumbs does not exist`);
  } else {
    const plain = new Set();
    const alt = new Set();
    for (const name of fs.readdirSync(thumbDir)) {
      const match = /^(\d+)(_alt)?\.png$/.exec(name);
      if (!match) { error(scope, `unexpected file ${iconDir}/thumbs/${name}`); continue; }
      (match[2] ? alt : plain).add(Number(match[1]));
    }
    const missing = [];
    for (let i = 1; i <= total; i++) if (!plain.has(i)) missing.push(i);
    if (missing.length) error(scope, `no thumb file for ${summarise(missing)}`);

    // total must be the highest numbered thumb, so a new thumb cannot be
    // added without also bumping total (and the other way round).
    const extra = [...plain].filter(i => i > total).sort((a, b) => a - b);
    if (extra.length) error(scope, `total is ${total} but ${iconDir}/thumbs also has ${summarise(extra)}`);

    for (const id of altArt) {
      if (!alt.has(id)) error(scope, `altArt lists ${id} but ${iconDir}/thumbs/${id}_alt.png is missing`);
    }
    const unlisted = [...alt].filter(id => !altArt.includes(id)).sort((a, b) => a - b);
    if (unlisted.length) warn(scope, `${summarise(unlisted)} have _alt.png thumbs but are not in altArt`);
  }

  // --- units sidecar ---
  const unitsFile = file.replace(/\.json$/, '.units.json');
  const unitsScope = path.basename(unitsFile);
  let units;
  try {
    units = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  } catch (err) {
    error(unitsScope, `could not be read as JSON - ${err.message}`);
    return;
  }
  if (!units || typeof units !== 'object' || Array.isArray(units)) {
    error(unitsScope, 'must be an object keyed by unit number');
    return;
  }

  const missingUnits = [];
  for (let i = 1; i <= total; i++) if (!(String(i) in units)) missingUnits.push(i);
  if (missingUnits.length) error(unitsScope, `no entry for ${summarise(missingUnits)}`);

  const seenIds = new Map();
  for (const [key, unit] of Object.entries(units)) {
    const label = `unit ${key}`;
    const number = Number(key);
    if (!/^\d+$/.test(key) || number < 1 || number > total) {
      error(unitsScope, `${label}: key is not a unit number in 1-${total}`);
      continue;
    }
    if (!unit || typeof unit !== 'object') { error(unitsScope, `${label}: must be an object`); continue; }

    for (const field of Object.keys(unit)) {
      if (!UNIT_KEYS.includes(field)) error(unitsScope, `${label}: unknown field "${field}"`);
    }
    if (!CLASSES.includes(unit.class)) {
      error(unitsScope, `${label}: class must be one of ${CLASSES.join(', ')}`);
    }
    checkPlacement(unitsScope, label, unit, seenIds);

    // Alt art placement must exist exactly when the unit is in altArt.
    const wantsAlt = altArt.includes(number);
    if (wantsAlt && !unit.alt) error(unitsScope, `${label}: is in altArt but has no "alt" entry`);
    if (!wantsAlt && unit.alt) error(unitsScope, `${label}: has an "alt" entry but is not in altArt`);
    if (unit.alt && typeof unit.alt === 'object') {
      for (const field of Object.keys(unit.alt)) {
        if (!ALT_KEYS.includes(field)) error(unitsScope, `${label} alt: unknown field "${field}"`);
      }
      checkPlacement(unitsScope, `${label} alt`, unit.alt, seenIds);
    }
  }
}

// Checks one data file (data/lr.json or data/dfe.json) and everything that
// hangs off it. Prints a one line summary and returns the parsed data, or null
// when the file is too broken to check further.
function checkMode(file) {
  const scope = path.basename(file);
  let data;

  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    error(scope, `could not be read as JSON - ${err.message}`);
    return null;
  }

  // --- top level shape ---
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    error(scope, 'must be a JSON object');
    return null;
  }
  for (const key of Object.keys(data)) {
    if (!DATA_KEYS.includes(key)) error(scope, `unknown field "${key}"`);
  }
  const stem = path.basename(file, '.json');
  if (data.mode !== stem) error(scope, `mode must be "${stem}" to match the file name`);
  if (data.idSuffix !== undefined && typeof data.idSuffix !== 'string') {
    error(scope, 'idSuffix must be a string');
  }

  const iconDir = data.iconDir;
  if (!iconDir || !fs.existsSync(iconDir)) {
    error(scope, `iconDir "${iconDir}" does not exist`);
    return null;
  }

  const total = data.total;
  if (!Number.isInteger(total) || total < 1) {
    error(scope, 'total must be a whole number of 1 or more');
    return null;
  }

  // --- every id has exactly one type ---
  if (!data.types || typeof data.types !== 'object' || Array.isArray(data.types)) {
    error(scope, 'types must be an object with the keys ' + TYPES.join(', '));
    return null;
  }
  for (const key of Object.keys(data.types)) {
    if (!TYPES.includes(key)) error(scope, `types has an unknown key "${key}"`);
  }
  const typeOf = new Map();
  for (const type of TYPES) {
    if (typeof data.types[type] !== 'string') {
      error(scope, `types.${type} must be a range string`);
      continue;
    }
    const ids = parseRanges(data.types[type], scope, `types.${type}`);
    for (const id of ids) {
      if (typeOf.has(id)) error(scope, `id ${id} is listed as both ${typeOf.get(id)} and ${type}`);
      else typeOf.set(id, type);
      if (id < 1 || id > total) error(scope, `types.${type} lists ${id}, outside 1-${total}`);
    }
  }

  const untyped = [];
  for (let i = 1; i <= total; i++) if (!typeOf.has(i)) untyped.push(i);
  if (untyped.length) error(scope, `no type assigned to ${summarise(untyped)}`);

  // --- EZA lists (eza includes the Super EZA ids, so eza2 must sit inside it) ---
  const eza = checkIdList(scope, 'eza', data.eza, total);
  const eza2 = checkIdList(scope, 'eza2', data.eza2, total);

  const superOnly = [...eza2].filter(id => !eza.has(id)).sort((a, b) => a - b);
  if (superOnly.length) {
    error(scope, `${summarise(superOnly)} are in eza2 but not in eza (a Super EZA must also be listed as an EZA)`);
  }

  // --- F2P (optional: only modes that declare the key take part) ---
  const f2pCount = data.f2p === undefined ? null : checkIdList(scope, 'f2p', data.f2p, total).size;

  // --- alt art ---
  if (data.altArt !== undefined && !Array.isArray(data.altArt)) {
    error(scope, 'altArt must be an array of unit numbers, e.g. [14, 18]');
  }
  const altArt = Array.isArray(data.altArt) ? data.altArt : [];
  const seenAlt = new Set();
  for (const id of altArt) {
    if (!Number.isInteger(id)) { error(scope, `altArt entry ${JSON.stringify(id)} is not a whole number`); continue; }
    if (seenAlt.has(id)) error(scope, `altArt lists ${id} more than once`);
    seenAlt.add(id);
    if (id < 1 || id > total) error(scope, `altArt lists ${id}, outside 1-${total}`);
  }

  // --- changelog ---
  if (!Array.isArray(data.changelog)) {
    error(scope, 'changelog must be an array of text lines');
  } else if (data.changelog.some(line => typeof line !== 'string' || !line.trim())) {
    error(scope, 'changelog lines must be non-empty text');
  }

  // --- raw thumbs (one per id, alt art in step with altArt) and the units file ---
  checkLayered(scope, file, iconDir, total, altArt);

  // --- required text fields ---
  for (const field of ['label', 'title', 'favicon', 'iconDir']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) error(scope, `missing "${field}"`);
  }
  if (data.favicon && !fs.existsSync(data.favicon)) {
    error(scope, `favicon "${data.favicon}" does not exist`);
  }

  const counts = TYPES.map(type => {
    const n = [...typeOf.values()].filter(t => t === type).length;
    return `${type.toUpperCase()} ${n}`;
  }).join('  ');

  const f2pNote = f2pCount === null ? '' : `   F2P ${String(f2pCount).padStart(3)}`;
  console.log(`${scope.padEnd(9)} total ${String(total).padStart(3)}   ` +
    `EZA ${String(eza.size).padStart(3)}   Super ${String(eza2.size).padStart(2)}${f2pNote}   ${counts}`);

  return data;
}

// Works out the build id: the first 8 hex characters of a SHA-256 over the
// hashed files. Line endings are normalised to LF first, so a Windows checkout
// (CRLF) and the CI checkout (LF) arrive at the same id. Returns null, after
// recording an error, when a hashed file is missing.
function computeBuildId() {
  const hash = crypto.createHash('sha256');
  for (const file of HASHED_FILES) {
    if (!fs.existsSync(file)) {
      error('stamp', `${file} is missing, cannot compute the build id`);
      return null;
    }
    hash.update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
  }
  return hash.digest('hex').slice(0, 8);
}

// --stamp: writes the current build id into every ?v= and data-build in
// index.html.
function stampBuildId() {
  const build = computeBuildId();
  if (!build) return;

  const indexPath = 'index.html';
  const before = fs.readFileSync(indexPath, 'utf8');
  const after = before
    .replace(/(\?v=)[^"']*/g, `$1${build}`)
    .replace(/(data-build=")[^"]*(")/, `$1${build}$2`);

  if (after === before) {
    console.log(`\nBuild id already up to date: ${build}`);
    return;
  }
  fs.writeFileSync(indexPath, after);
  console.log(`\nStamped build id ${build} into ${indexPath}`);
}

// --check-stamp: fails when index.html does not carry the current build id
// everywhere. Writes nothing.
function checkBuildId() {
  const build = computeBuildId();
  if (!build) return;

  const html = fs.readFileSync('index.html', 'utf8');
  const found = new Set();
  for (const match of html.matchAll(/\?v=([^"']*)/g)) found.add(match[1]);
  const body = /data-build="([^"]*)"/.exec(html);
  found.add(body ? body[1] : '(no data-build attribute)');

  const stale = [...found].filter(value => value !== build);
  if (stale.length) {
    error('stamp', `index.html carries build id ${stale.join(', ')} but the files hash to ${build} - run "node validate-data.js --stamp"`);
  } else {
    console.log(`\nBuild id is current: ${build}`);
  }
}

// --- run ---

console.log('Dokkan Checklist - data validation\n');

for (const file of DATA_FILES) {
  if (fs.existsSync(file)) checkMode(file);
  else error(path.basename(file), 'file not found');
}

checkLayers();

// Never stamp over a failed validation: the stamp is what publishes the data.
if (process.argv.includes('--stamp')) {
  if (errors.length) console.log('\nNot stamping: fix the errors below first.');
  else stampBuildId();
}
if (process.argv.includes('--check-stamp')) checkBuildId();

if (warnings.length) {
  console.log('\nWarnings:');
  for (const message of warnings) console.log(`  ! ${message}`);
}

if (errors.length) {
  console.log('\nErrors:');
  for (const message of errors) console.log(`  x ${message}`);
  console.log(`\n${errors.length} error(s). Nothing was published.`);
  process.exit(1);
}

console.log(`\nAll checks passed${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);

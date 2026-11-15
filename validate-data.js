#!/usr/bin/env node
'use strict';

/*
 * validate-data.js
 * ----------------
 * Checks the units files (data/lr.units.json, data/dfe.units.json: one line
 * per unit with its type, class and EZA state), the data files beside them
 * (texts, F2P and alt art lists, changelog), the raw thumbs and the shared
 * layer images against what is actually on disk.
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
// These are the texts and the lists kept by hand; everything per unit lives
// in the units file.
const DATA_KEYS = ['mode', 'label', 'title', 'favicon', 'iconDir',
  'f2p', 'altArt', 'changelog'];
// Keys that used to live in the data file. Named separately so that putting
// one back gets a clear message.
const MOVED_KEYS = ['total', 'types', 'eza', 'eza2'];

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
// A unit's "eza": 1 = EZA, 2 = Super EZA. Left out when it has no EZA.
const EZA_STATES = [1, 2];
const SUPER_EZA = 2;
const UNIT_KEYS = ['id', 'type', 'class', 'eza', 'tx', 'ty', 'alt'];
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

// Reads and checks a units file (data/<side>.units.json), the source of truth
// for which units exist and for each one's type, class and EZA state.
// The keys must be exactly "1" to "<count>" with none missing, because the
// unit numbers are the owner's own running count.
// Returns { total, units } or null when the file is too broken to use.
function checkUnits(unitsFile, altArt) {
  const scope = path.basename(unitsFile);
  let units;
  try {
    units = JSON.parse(fs.readFileSync(unitsFile, 'utf8'));
  } catch (err) {
    error(scope, `could not be read as JSON - ${err.message}`);
    return null;
  }
  if (!units || typeof units !== 'object' || Array.isArray(units)) {
    error(scope, 'must be an object keyed by unit number');
    return null;
  }

  const keys = Object.keys(units);
  const total = keys.length;
  if (total < 1) {
    error(scope, 'has no units');
    return null;
  }
  const badKeys = keys.filter(key => !/^[1-9]\d*$/.test(key) || Number(key) > total);
  if (badKeys.length) {
    error(scope, `has ${total} entries, so the keys must be 1 to ${total}; found ${badKeys.slice(0, 8).map(k => `"${k}"`).join(', ')}`);
  }
  const missing = [];
  for (let i = 1; i <= total; i++) if (!(String(i) in units)) missing.push(i);
  if (missing.length) error(scope, `no entry for ${summarise(missing)}`);

  const seenIds = new Map();
  for (const [key, unit] of Object.entries(units)) {
    const label = `unit ${key}`;
    if (!unit || typeof unit !== 'object' || Array.isArray(unit)) {
      error(scope, `${label}: must be an object`);
      continue;
    }
    for (const field of Object.keys(unit)) {
      if (!UNIT_KEYS.includes(field)) error(scope, `${label}: unknown field "${field}"`);
    }
    if (!TYPES.includes(unit.type)) error(scope, `${label}: type must be one of ${TYPES.join(', ')}`);
    if (!CLASSES.includes(unit.class)) error(scope, `${label}: class must be one of ${CLASSES.join(', ')}`);
    if (unit.eza !== undefined && !EZA_STATES.includes(unit.eza)) {
      error(scope, `${label}: eza must be 1 (EZA) or 2 (Super EZA), or left out for no EZA`);
    }
    checkPlacement(scope, label, unit, seenIds);

    // Alt art placement must exist exactly when the unit is in altArt.
    const wantsAlt = altArt.includes(Number(key));
    if (wantsAlt && !unit.alt) error(scope, `${label}: is in altArt but has no "alt" entry`);
    if (!wantsAlt && unit.alt) error(scope, `${label}: has an "alt" entry but is not in altArt`);
    if (unit.alt && typeof unit.alt === 'object') {
      for (const field of Object.keys(unit.alt)) {
        if (!ALT_KEYS.includes(field)) error(scope, `${label} alt: unknown field "${field}"`);
      }
      checkPlacement(scope, `${label} alt`, unit.alt, seenIds);
    }
  }
  return { total, units };
}

// Checks the raw thumbs in <iconDir>/thumbs: exactly one per unit number,
// nothing numbered past the last unit, and alt thumbs in step with altArt.
function checkThumbs(scope, iconDir, total, altArt) {
  const thumbDir = path.join(iconDir, 'thumbs');
  if (!fs.existsSync(thumbDir)) {
    error(scope, `${iconDir}/thumbs does not exist`);
    return;
  }
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

  // A thumb with no unit line means a unit was half added.
  const extra = [...plain].filter(i => i > total).sort((a, b) => a - b);
  if (extra.length) error(scope, `there are ${total} units but ${iconDir}/thumbs also has ${summarise(extra)}`);

  for (const id of altArt) {
    if (!alt.has(id)) error(scope, `altArt lists ${id} but ${iconDir}/thumbs/${id}_alt.png is missing`);
  }
  const unlisted = [...alt].filter(id => !altArt.includes(id)).sort((a, b) => a - b);
  if (unlisted.length) warn(scope, `${summarise(unlisted)} have _alt.png thumbs but are not in altArt`);
}

// Checks one side: its data file (data/lr.json or data/dfe.json), its units
// file and its thumbs. Prints a one line summary and returns the parsed data,
// or null when a file is too broken to check further.
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
    if (MOVED_KEYS.includes(key)) error(scope, `"${key}" no longer belongs here: it now comes from the units file`);
    else if (!DATA_KEYS.includes(key)) error(scope, `unknown field "${key}"`);
  }
  const stem = path.basename(file, '.json');
  if (data.mode !== stem) error(scope, `mode must be "${stem}" to match the file name`);

  const iconDir = data.iconDir;
  if (!iconDir || !fs.existsSync(iconDir)) {
    error(scope, `iconDir "${iconDir}" does not exist`);
    return null;
  }

  // --- alt art list (checked first: the units file is checked against it) ---
  if (data.altArt !== undefined && !Array.isArray(data.altArt)) {
    error(scope, 'altArt must be an array of unit numbers, e.g. [14, 18]');
  }
  const altArt = [];
  for (const id of Array.isArray(data.altArt) ? data.altArt : []) {
    if (!Number.isInteger(id)) { error(scope, `altArt entry ${JSON.stringify(id)} is not a whole number`); continue; }
    if (altArt.includes(id)) error(scope, `altArt lists ${id} more than once`);
    else altArt.push(id);
  }

  // --- units file: which units exist, and their type, class and EZA state ---
  const checked = checkUnits(file.replace(/\.json$/, '.units.json'), altArt);
  if (!checked) return null;
  const { total, units } = checked;

  const outside = altArt.filter(id => id < 1 || id > total);
  if (outside.length) error(scope, `altArt lists ${summarise(outside)}, outside 1-${total}`);

  // --- F2P (optional: only modes that declare the key take part) ---
  const f2pCount = data.f2p === undefined ? null : checkIdList(scope, 'f2p', data.f2p, total).size;

  // --- raw thumbs ---
  checkThumbs(scope, iconDir, total, altArt);

  // --- changelog ---
  if (!Array.isArray(data.changelog)) {
    error(scope, 'changelog must be an array of text lines');
  } else if (data.changelog.some(line => typeof line !== 'string' || !line.trim())) {
    error(scope, 'changelog lines must be non-empty text');
  }

  // --- required text fields ---
  for (const field of ['label', 'title', 'favicon', 'iconDir']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) error(scope, `missing "${field}"`);
  }
  if (data.favicon && !fs.existsSync(data.favicon)) {
    error(scope, `favicon "${data.favicon}" does not exist`);
  }

  // --- summary line ---
  const list = Object.values(units).filter(unit => unit && typeof unit === 'object');
  const counts = TYPES.map(type => `${type.toUpperCase()} ${list.filter(unit => unit.type === type).length}`).join('  ');
  const ezaCount = list.filter(unit => EZA_STATES.includes(unit.eza)).length;
  const superCount = list.filter(unit => unit.eza === SUPER_EZA).length;
  const f2pNote = f2pCount === null ? '' : `   F2P ${String(f2pCount).padStart(3)}`;
  console.log(`${scope.padEnd(9)} total ${String(total).padStart(3)}   ` +
    `EZA ${String(ezaCount).padStart(3)}   Super ${String(superCount).padStart(2)}${f2pNote}   ${counts}`);

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

#!/usr/bin/env node
'use strict';

/*
 * validate-data.js
 * ----------------
 * Checks data/lr.json and data/dfe.json against the icons actually on disk.
 * Run it after editing a data file, before committing:
 *
 *   node validate-data.js            report problems
 *   node validate-data.js --stamp    also refresh the cache-busting build id
 *
 * Exits non-zero if anything is wrong, so it works as a pre-commit hook.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TYPES = ['agl', 'teq', 'str', 'phy', 'int'];
const DATA_FILES = ['data/lr.json', 'data/dfe.json'];

// Files whose contents decide the cache-busting build id.
const HASHED_FILES = [
  'css/style.css',
  'css/flairs.css',
  'js/scripts.js',
  'js/lz-string.js',
  'data/lr.json',
  'data/dfe.json'
];

const errors = [];
const warnings = [];

function error(scope, message) { errors.push(`${scope}: ${message}`); }
function warn(scope, message) { warnings.push(`${scope}: ${message}`); }

// Keep this in step with parseRanges() in js/scripts.js.
function parseRanges(rangeString, scope, field) {
  const result = [];
  for (const part of String(rangeString || '').split(',')) {
    const token = part.trim();
    if (!token) continue;

    if (token.includes('-')) {
      const [start, end] = token.split('-').map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        error(scope, `${field} contains a malformed range "${token}"`);
        continue;
      }
      if (end < start) {
        error(scope, `${field} range "${token}" runs backwards`);
        continue;
      }
      for (let i = start; i <= end; i++) result.push(i);
    } else {
      const value = Number(token);
      if (Number.isFinite(value)) result.push(value);
      else error(scope, `${field} contains a malformed value "${token}"`);
    }
  }
  return result;
}

function listIcons(dir) {
  const plain = new Set();
  const alt = new Set();

  for (const file of fs.readdirSync(dir)) {
    let match = /^(\d+)\.webp$/.exec(file);
    if (match) { plain.add(Number(match[1])); continue; }
    match = /^(\d+)_alt\.webp$/.exec(file);
    if (match) alt.add(Number(match[1]));
  }
  return { plain, alt };
}

function summarise(numbers, limit = 12) {
  const shown = numbers.slice(0, limit).join(', ');
  return numbers.length > limit ? `${shown} … (${numbers.length} total)` : shown;
}

function checkMode(file) {
  const scope = path.basename(file);
  let data;

  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    error(scope, `could not be read as JSON — ${err.message}`);
    return null;
  }

  const iconDir = data.iconDir;
  if (!iconDir || !fs.existsSync(iconDir)) {
    error(scope, `iconDir "${iconDir}" does not exist`);
    return null;
  }

  const { plain, alt } = listIcons(path.join(iconDir, 'icons'));
  const highest = plain.size ? Math.max(...plain) : 0;
  const total = Number(data.total);

  // --- total matches the icons on disk ---
  if (total !== highest) {
    error(scope, `total is ${total} but the highest icon in ${iconDir}/icons is ${highest}`);
  }

  const missingFiles = [];
  for (let i = 1; i <= total; i++) if (!plain.has(i)) missingFiles.push(i);
  if (missingFiles.length) {
    error(scope, `no icon file for ${summarise(missingFiles)}`);
  }

  const extraFiles = [...plain].filter(i => i > total).sort((a, b) => a - b);
  if (extraFiles.length) {
    warn(scope, `icon files past total (${total}): ${summarise(extraFiles)}`);
  }

  // --- every id has exactly one type ---
  const typeOf = new Map();
  for (const type of TYPES) {
    const ids = parseRanges(data.types && data.types[type], scope, `types.${type}`);
    for (const id of ids) {
      if (typeOf.has(id)) error(scope, `id ${id} is listed as both ${typeOf.get(id)} and ${type}`);
      else typeOf.set(id, type);
      if (id < 1 || id > total) error(scope, `types.${type} lists ${id}, outside 1-${total}`);
    }
  }

  const untyped = [];
  for (let i = 1; i <= total; i++) if (!typeOf.has(i)) untyped.push(i);
  if (untyped.length) error(scope, `no type assigned to ${summarise(untyped)}`);

  // --- EZA ranges ---
  const eza = new Set(parseRanges(data.eza, scope, 'eza'));
  const eza2 = new Set(parseRanges(data.eza2, scope, 'eza2'));

  for (const [field, set] of [['eza', eza], ['eza2', eza2]]) {
    const outside = [...set].filter(id => id < 1 || id > total).sort((a, b) => a - b);
    if (outside.length) error(scope, `${field} lists ${summarise(outside)}, outside 1-${total}`);
  }

  const superOnly = [...eza2].filter(id => !eza.has(id)).sort((a, b) => a - b);
  if (superOnly.length) {
    warn(scope, `${summarise(superOnly)} are in eza2 but not eza — a Super EZA usually implies an EZA`);
  }

  // --- F2P (optional: only modes that declare the key take part) ---
  let f2pCount = null;
  if (data.f2p !== undefined) {
    if (typeof data.f2p !== 'string') {
      error(scope, 'f2p must be a range string, e.g. "1-3, 7, 10-12"');
    } else {
      const ids = parseRanges(data.f2p, scope, 'f2p');
      const seenF2p = new Set();
      for (const id of ids) {
        if (seenF2p.has(id)) error(scope, `f2p lists ${id} more than once`);
        seenF2p.add(id);
      }
      const outside = [...seenF2p].filter(id => id < 1 || id > total).sort((a, b) => a - b);
      if (outside.length) error(scope, `f2p lists ${summarise(outside)}, outside 1-${total}`);
      f2pCount = seenF2p.size;
    }
  }

  // --- alt art ---
  const altArt = Array.isArray(data.altArt) ? data.altArt : [];
  for (const id of altArt) {
    if (!alt.has(id)) error(scope, `altArt lists ${id} but ${iconDir}/icons/${id}_alt.webp is missing`);
    if (id < 1 || id > total) error(scope, `altArt lists ${id}, outside 1-${total}`);
  }
  const unlisted = [...alt].filter(id => !altArt.includes(id)).sort((a, b) => a - b);
  if (unlisted.length) {
    warn(scope, `${summarise(unlisted)} have _alt.webp files but are not in altArt`);
  }

  // --- required text fields ---
  for (const field of ['label', 'title', 'favicon', 'iconDir']) {
    if (!data[field]) error(scope, `missing "${field}"`);
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

function stampBuildId() {
  const hash = crypto.createHash('sha256');
  for (const file of HASHED_FILES) {
    if (!fs.existsSync(file)) {
      error('stamp', `${file} is missing, cannot compute the build id`);
      return;
    }
    hash.update(fs.readFileSync(file));
  }
  const build = hash.digest('hex').slice(0, 8);

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

// --- run ---

console.log('Dokkan Checklist - data validation\n');

for (const file of DATA_FILES) {
  if (fs.existsSync(file)) checkMode(file);
  else error(path.basename(file), 'file not found');
}

if (process.argv.includes('--stamp')) stampBuildId();

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

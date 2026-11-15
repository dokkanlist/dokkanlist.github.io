#!/usr/bin/env node
'use strict';

/*
 * update-units.js
 * ---------------
 * Finds new units and EZA changes on dokkandb and proposes the edits to the
 * checklist. Nothing in the site's files changes until you say so.
 *
 *   node tools/update-units.js            check, write a proposal to review
 *   node tools/update-units.js --apply    apply the proposal you reviewed
 *   node tools/update-units.js --refresh  download the catalogue even if unchanged
 *   node tools/update-units.js --offline  check using only the saved copy
 *
 * A check writes two files, both ignored by git:
 *   tools/proposal.json   what would change. Edit or delete entries freely.
 *   tools/preview.html    the new tiles as the site would draw them. Open it.
 *
 * --apply then copies the thumbs, edits data/<side>.units.json and the
 * changelog in data/<side>.json, and runs the validator. It never commits:
 * look at `git diff`, then commit yourself.
 *
 * What it reads from the internet (run from the repo root):
 *   dokkandb's JSON API     1 small request to see whether their data has
 *                           changed since the last check. Only if it has:
 *                           the Global card catalogue (2 requests, the same
 *                           ones their homepage makes), and the JP catalogue
 *                           (2 more) only when a new unit needs its release
 *                           order
 *   dokkaninfo.com          one thumb image per NEW unit
 * Requests go one at a time with a pause between them. The script does not
 * try to get around a refusal; if a site says no, it stops and tells you.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const diff = require('./lib/units-diff.js');

/* --- Settings --------------------------------------------- */

const SIDES = ['lr', 'dfe'];
const SIDE_LABEL = { lr: 'LR', dfe: 'DFE' };

// dokkandb's API: Global is the source of truth; JP only supplies the release
// order that the unit numbers follow.
const API = { global: 'https://api.dokkandb.com/api', jp: 'https://api.dokkandb.com/jp/api' };
const CHUNK_SIZE = 1000;
const MAX_CHUNKS = 6;
// Where a unit's raw 250 px thumb comes from. <id0> is the card id with its
// last digit set to 0.
const THUMB_URL = 'https://dokkaninfo.com/assets/global/en/character/thumb/card_<id0>_thumb/card_<id0>_thumb.png';
const THUMB_SIZE = 250;

// Pause between requests, and how the script names itself to the sites.
const DELAY_MS = 1000;
const USER_AGENT = 'checklist-update-script/1.0 (run by hand by the site owner)';

// Everything is read and written relative to the folder the command is run
// from (the repo root), like validate-data.js. Only the validator itself is
// found next to this script.
const TOOLS = 'tools';
const VALIDATOR = path.join(__dirname, '..', 'validate-data.js');
const CACHE = path.join(TOOLS, '.cache');
const THUMB_CACHE = path.join(CACHE, 'thumbs');
const PROPOSAL_FILE = path.join(TOOLS, 'proposal.json');
const PREVIEW_FILE = path.join(TOOLS, 'preview.html');
// Game ids the check should stay silent about (kept by hand, tracked in git).
const IGNORE_FILE = path.join(TOOLS, 'ignore-ids.json');
// The saved copy: dokkandb's version stamps at the last check, and the two
// catalogues as last downloaded.
const VERSION_FILE = path.join(CACHE, 'versions.json');
const CATALOGUE = { global: path.join(CACHE, 'catalogue-global.json'), jp: path.join(CACHE, 'catalogue-jp.json') };

/* --- Small helpers ---------------------------------------- */

// Waits a moment between requests.
function pause(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Prints a message and stops with a failure code.
function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// Reads a JSON file, or returns `fallback` when it does not exist.
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Writes text, creating the folder first.
function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

// Paths of one side's files.
function sidePaths(side) {
  return {
    data: path.join('data', `${side}.json`),
    units: path.join('data', `${side}.units.json`),
    thumbs: path.join('images', side, 'thumbs')
  };
}

// Reads both units files.
function readUnits() {
  const units = {};
  for (const side of SIDES) units[side] = readJson(sidePaths(side).units, null);
  for (const side of SIDES) if (!units[side]) fail(`${sidePaths(side).units} not found. Run this from the repo root.`);
  return units;
}

/* --- Fetching --------------------------------------------- */

// One polite GET. A refusal (for example a 403 from bot protection) stops the
// run with an explanation instead of being retried or worked around.
async function get(url, asText) {
  let response;
  try {
    response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: asText ? 'application/json' : '*/*' } });
  } catch (err) {
    fail(`Could not reach ${new URL(url).host}: ${err.message}\nCheck your connection, or use --offline to work from the saved copy.`);
  }
  if (!response.ok) {
    fail(`${new URL(url).host} answered ${response.status} for ${url}\n` +
      'The script does not try to get around a refusal. If this keeps happening, the site may not\n' +
      'allow scripted access any more; the catalogue can still be saved by hand into tools/.cache/.');
  }
  return asText ? response.text() : Buffer.from(await response.arrayBuffer());
}

// Fetches one JSON document.
async function getJson(url) {
  const text = await get(url, true);
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${url} did not return JSON (it may be a "checking your browser" page). The script stops here.`);
  }
}

// Downloads the whole card catalogue of one server, chunk by chunk.
async function fetchCatalogue(server) {
  const cards = [];
  for (let chunk = 1; chunk <= MAX_CHUNKS; chunk++) {
    await pause(DELAY_MS);
    const part = await getJson(`${API[server]}/cards-catalog-with-transformations?chunk=${chunk}&chunk_size=${CHUNK_SIZE}`);
    if (!Array.isArray(part)) fail(`Unexpected catalogue shape from the ${server} server (expected a list).`);
    if (!part.length) break;
    cards.push(...part);
    process.stdout.write(`  ${server} catalogue: ${cards.length} cards\r`);
  }
  console.log(`  ${server} catalogue: ${cards.length} cards`);
  if (cards.length < 500) fail(`The ${server} catalogue came back with only ${cards.length} cards, which cannot be right. Stopping.`);
  return cards;
}

// Returns the Global catalogue: the saved copy when dokkandb's data version
// has not changed since it was saved, otherwise a fresh download. This is the
// same catalogue the dokkandb homepage loads to draw its timeline, so it
// covers every new card and every EZA however large the batch.
async function loadGlobalCatalogue({ refresh, offline }) {
  const haveCopy = fs.existsSync(VERSION_FILE) && fs.existsSync(CATALOGUE.global);

  if (offline) {
    if (!haveCopy) fail('--offline needs a saved copy, and there is none yet. Run once without it.');
    console.log('Using the saved catalogue (offline).');
    return readJson(CATALOGUE.global);
  }

  console.log('Asking dokkandb whether its data has changed...');
  const versions = await getJson(`${API.global}/cache-versions`);
  const saved = readJson(VERSION_FILE, {});
  if (haveCopy && !refresh && saved.database === versions.database) {
    console.log(`  No change since the last check (data version ${versions.database}).`);
    return readJson(CATALOGUE.global);
  }

  console.log(`  Data version ${versions.database} (last checked: ${saved.database || 'never'}). Downloading the Global catalogue...`);
  const cards = await fetchCatalogue('global');
  writeText(CATALOGUE.global, JSON.stringify(cards));
  writeText(VERSION_FILE, JSON.stringify(versions, null, 2));
  return cards;
}

// Returns the JP catalogue, which is only used for the release order of new
// units. The saved copy is reused when it already lists every id in
// `neededIds`; otherwise it is downloaded (never when offline).
async function loadJpCatalogue(neededIds, offline) {
  const saved = readJson(CATALOGUE.jp, []);
  const have = new Set(saved.map(card => Number(card.id)));
  if (offline || neededIds.every(id => have.has(id))) return saved;

  console.log('  New unit found. Downloading the JP catalogue for its release order...');
  const cards = await fetchCatalogue('jp');
  writeText(CATALOGUE.jp, JSON.stringify(cards));
  return cards;
}

// Reads the width and height out of a PNG file's header, or null if the
// bytes are not a PNG.
function pngSize(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// Where a new unit's thumb is kept until the proposal is applied.
function cachedThumb(id) {
  return path.join(THUMB_CACHE, `${id}.png`);
}

// Makes sure the thumb of every new unit is saved locally. Returns a note
// for each one that could not be fetched; those can be saved by hand.
async function fetchThumbs(proposal, offline) {
  const notes = [];
  for (const side of SIDES) {
    for (const unit of proposal[side].newUnits) {
      const file = cachedThumb(unit.id);
      if (fs.existsSync(file)) continue;
      const byHand = `Save its 250 x 250 px thumb yourself as ${path.relative('.', file)} before applying.`;
      if (offline) { notes.push(`${SIDE_LABEL[side]} ${unit.number} "${unit.name}": no thumb saved yet. ${byHand}`); continue; }

      const id0 = Math.floor(unit.id / 10) * 10;
      await pause(DELAY_MS);
      let bytes = null;
      try {
        const response = await fetch(THUMB_URL.replace(/<id0>/g, String(id0)), { headers: { 'User-Agent': USER_AGENT } });
        if (response.ok) bytes = Buffer.from(await response.arrayBuffer());
      } catch (err) {
        bytes = null;
      }
      const size = bytes && pngSize(bytes);
      if (size && size.width === THUMB_SIZE && size.height === THUMB_SIZE) {
        writeText(file, bytes);
        console.log(`  Thumb saved for ${SIDE_LABEL[side]} ${unit.number} "${unit.name}"`);
      } else {
        notes.push(`${SIDE_LABEL[side]} ${unit.number} "${unit.name}": the thumb could not be downloaded. ${byHand}`);
      }
    }
  }
  return notes;
}

/* --- Preview page ----------------------------------------- */

// Escapes text for HTML.
function esc(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// HTML for one tile, built from the same layers and CSS as the site.
function tileHtml(side, unit, thumbSrc) {
  const typeIndex = { agl: 0, teq: 1, int: 2, str: 3, phy: 4 }[unit.type];
  const classDigit = unit.class === 'super' ? 1 : 2;
  const badge = side === 'lr' ? 'cha_rare_lr.png' : 'cha_rare_ur.png';
  const classes = ['flair', 'selected', `type-${unit.type}`];
  if (unit.eza === 1 || unit.eza === 2) classes.push('eza');
  if (unit.eza === 2) classes.push('eza2');
  return `<div class="${classes.join(' ')}">` +
    `<img class="layer layer-frame" alt="" src="../images/layers/cha_base_0${typeIndex}_04.png">` +
    `<img class="layer layer-thumb" alt="" src="${esc(thumbSrc)}" style="--tx:${unit.tx};--ty:${unit.ty}">` +
    `<img class="layer layer-rarity" alt="" src="../images/layers/${badge}">` +
    `<img class="layer layer-type" alt="" src="../images/layers/cha_type_icon_${classDigit}${typeIndex}.png">` +
    '</div>';
}

// Writes tools/preview.html: every proposed new unit and EZA change, drawn
// with the site's own stylesheets so it looks exactly as it will on the page.
function writePreview(proposal, units) {
  const sections = SIDES.map(side => {
    const part = proposal[side];
    const cards = [];
    for (const unit of part.newUnits) {
      const thumb = path.relative(TOOLS, cachedThumb(unit.id)).replace(/\\/g, '/');
      cards.push(`<div class="card">${tileHtml(side, unit, thumb)}<p><b>New: ${SIDE_LABEL[side]} ${unit.number}</b><br>` +
        `${esc(unit.name)}<br><i>${esc(unit.title)}</i><br>${unit.class} ${unit.type.toUpperCase()}, EZA: ${ezaWord(unit.eza)}<br>game id ${unit.id}</p></div>`);
    }
    for (const change of part.ezaChanges) {
      const unit = Object.assign({}, units[side][change.number], { eza: change.to });
      cards.push(`<div class="card">${tileHtml(side, unit, `../images/${side}/thumbs/${change.number}.png`)}` +
        `<p><b>${SIDE_LABEL[side]} ${change.number}</b><br>${esc(change.name)}<br>EZA: ${ezaWord(change.from)} -> ${ezaWord(change.to)}</p></div>`);
    }
    const changelog = part.changelog.length
      ? `<p class="log"><b>Changelog would become:</b><br>${part.changelog.map(esc).join('<br>')}</p>` : '';
    return `<section class="${side}"><h2>${SIDE_LABEL[side]} side</h2>` +
      (cards.length ? `<div class="cards">${cards.join('')}</div>${changelog}` : '<p>No changes.</p>') + '</section>';
  });
  const notes = proposal.notes.length
    ? `<section><h2>Notes</h2><ul>${proposal.notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul></section>` : '';

  writeText(PREVIEW_FILE, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Proposed checklist update</title>
<!-- Written by tools/update-units.js. Uses the site's own stylesheets so the tiles match the page. -->
<link rel="stylesheet" href="../css/style.css">
<link rel="stylesheet" href="../css/flairs.css">
<style>
  body { background: #101018; color: #eee; font: 14px/1.5 system-ui, sans-serif; text-align: left; padding: 16px; }
  h1 { font-size: 18px; } h2 { font-size: 15px; margin: 22px 0 8px; }
  .cards { display: flex; flex-wrap: wrap; gap: 14px; }
  .card { display: flex; gap: 14px; align-items: center; background: #23232e; border-radius: 6px; padding: 16px 18px; min-width: 300px; }
  .card p { margin: 0; font-size: 13px; }
  .card .flair { flex: none; cursor: default; margin: 14px 18px 14px 8px; }
  .log { background: #23232e; border-radius: 6px; padding: 10px 14px; display: inline-block; margin-top: 12px; }
  li { margin-bottom: 4px; }
</style>
</head>
<body>
<h1>Proposed checklist update</h1>
<p>Generated ${esc(proposal.generated)}. Nothing has been changed yet. Edit <code>tools/proposal.json</code> if anything is wrong, then run <code>node tools/update-units.js --apply</code>.</p>
${sections.join('\n')}
${notes}
</body>
</html>
`);
}

/* --- Check: build the proposal ---------------------------- */

// The EZA state number as a word, for reports: 0 none, 1 EZA, 2 Super EZA.
function ezaWord(state) {
  return diff.EZA_WORDS[state] || String(state);
}

// Prints the proposal as a short report.
function report(proposal) {
  for (const side of SIDES) {
    const part = proposal[side];
    console.log(`\n${SIDE_LABEL[side]} side`);
    if (!part.newUnits.length && !part.ezaChanges.length) console.log('  no changes');
    for (const unit of part.newUnits) {
      console.log(`  NEW  ${SIDE_LABEL[side]} ${unit.number}  ${unit.class} ${unit.type.toUpperCase()}  ${unit.name} - ${unit.title}  (game id ${unit.id}, EZA: ${ezaWord(unit.eza)})`);
    }
    for (const change of part.ezaChanges) {
      console.log(`  EZA  ${SIDE_LABEL[side]} ${change.number}  ${change.name}: ${ezaWord(change.from)} -> ${ezaWord(change.to)}`);
    }
  }
  if (proposal.notes.length) {
    console.log('\nNotes');
    for (const note of proposal.notes) console.log(`  - ${note}`);
  }
}

// The default action: compare, save the proposal and the preview, report.
async function check(options) {
  const units = readUnits();
  const globalCards = await loadGlobalCatalogue(options);
  const ignoreIds = readJson(IGNORE_FILE, { ids: [] }).ids || [];
  // First pass finds what is new; the JP catalogue is then only fetched if a
  // new unit needs its JP release date, and the proposal is built with it.
  const firstPass = diff.buildProposal({ units, globalCards, jpCards: [], ignoreIds });
  const newIds = SIDES.flatMap(side => firstPass[side].newUnits.map(unit => unit.id));
  const jpCards = newIds.length ? await loadJpCatalogue(newIds, options.offline) : [];
  const proposal = diff.buildProposal({ units, globalCards, jpCards, ignoreIds });
  proposal.generated = new Date().toISOString();

  if (diff.isEmpty(proposal)) {
    report(proposal);
    for (const file of [PROPOSAL_FILE, PREVIEW_FILE]) if (fs.existsSync(file)) fs.rmSync(file);
    console.log('\nThe checklist is up to date. Nothing to apply.');
    return;
  }

  proposal.notes.push(...await fetchThumbs(proposal, options.offline));
  // "generated" first, then how to use the file, so it reads top to bottom.
  const ordered = {
    generated: proposal.generated,
    howTo: 'Edit or delete entries, then run: node tools/update-units.js --apply. New unit numbers must carry on from the last unit with no gaps. eza is 0 for none, 1 for EZA, 2 for Super EZA. Changelog lines are yours to reword; an empty changelog list leaves that side\'s changelog alone.',
    lr: proposal.lr,
    dfe: proposal.dfe,
    notes: proposal.notes
  };
  writeText(PROPOSAL_FILE, JSON.stringify(ordered, null, 2) + '\n');
  writePreview(proposal, units);
  report(proposal);
  console.log(`\nProposal written to ${path.relative('.', PROPOSAL_FILE)}`);
  console.log(`Preview written to  ${path.relative('.', PREVIEW_FILE)} (open it in a browser)`);
  console.log('Nothing has been changed. When you are happy: node tools/update-units.js --apply');
}

/* --- Apply ------------------------------------------------ */

// True when git reports uncommitted edits to the data folder. Applying on top
// of those would mix two sets of changes in one diff.
function dataFolderIsDirty() {
  const result = spawnSync('git', ['status', '--porcelain', '--', 'data'], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.trim() !== '';
}

// --apply: writes the reviewed proposal into the site's files, then runs the
// validator. If the validator objects, every file is put back as it was.
function apply(options) {
  const proposal = readJson(PROPOSAL_FILE, null);
  if (!proposal) fail(`There is no ${path.relative('.', PROPOSAL_FILE)}. Run the check first: node tools/update-units.js`);

  const units = readUnits();
  const problems = diff.checkProposal(proposal, units);
  for (const side of SIDES) {
    for (const unit of (proposal[side] && proposal[side].newUnits) || []) {
      const source = cachedThumb(unit.id);
      const target = path.join(sidePaths(side).thumbs, `${unit.number}.png`);
      if (!fs.existsSync(source)) problems.push(`${SIDE_LABEL[side]} ${unit.number}: no thumb at ${path.relative('.', source)}`);
      if (fs.existsSync(target)) problems.push(`${SIDE_LABEL[side]} ${unit.number}: ${target} already exists and will not be overwritten`);
    }
  }
  if (problems.length) fail(`The proposal cannot be applied:\n${problems.map(p => `  x ${p}`).join('\n')}`);
  if (diff.isEmpty(proposal)) fail('The proposal has nothing in it to apply.');
  if (dataFolderIsDirty() && !options.force) {
    fail('The data folder has uncommitted changes. Commit or undo them first, so this update is a clean diff\n(or add --force to apply anyway).');
  }

  // Remember everything that is about to change, so it can be undone.
  const originals = new Map();
  const created = [];
  const remember = file => originals.set(file, fs.readFileSync(file));
  remember('index.html');

  for (const side of SIDES) {
    const part = proposal[side];
    const paths = sidePaths(side);
    if (!part.newUnits.length && !part.ezaChanges.length) continue;

    remember(paths.units);
    fs.writeFileSync(paths.units, diff.formatUnits(diff.applyToUnits(units[side], part)));

    for (const unit of part.newUnits) {
      const target = path.join(paths.thumbs, `${unit.number}.png`);
      fs.copyFileSync(cachedThumb(unit.id), target);
      created.push(target);
    }
    if (part.changelog.length) {
      remember(paths.data);
      fs.writeFileSync(paths.data, diff.replaceChangelog(fs.readFileSync(paths.data, 'utf8'), part.changelog));
    }
  }

  console.log('Files written. Running the validator...\n');
  const validator = spawnSync(process.execPath, [VALIDATOR, '--stamp'], { stdio: 'inherit' });
  if (validator.status !== 0) {
    for (const [file, content] of originals) fs.writeFileSync(file, content);
    for (const file of created) fs.rmSync(file);
    fail('The validator rejected the result, so every file was put back as it was. Fix the proposal and apply again.');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.renameSync(PROPOSAL_FILE, path.join(CACHE, `applied-${stamp}.json`));
  if (fs.existsSync(PREVIEW_FILE)) fs.rmSync(PREVIEW_FILE);

  console.log('\nApplied:');
  for (const side of SIDES) {
    const part = proposal[side];
    if (part.newUnits.length) console.log(`  ${SIDE_LABEL[side]}: added ${part.newUnits.map(u => u.number).join(', ')}`);
    if (part.ezaChanges.length) console.log(`  ${SIDE_LABEL[side]}: EZA state changed on ${part.ezaChanges.map(c => c.number).join(', ')}`);
  }
  console.log('\nNothing was committed. Check the page and `git diff`, update f2p or altArt if needed, then commit.');
}

/* --- Run -------------------------------------------------- */

const args = new Set(process.argv.slice(2));
const known = ['--apply', '--refresh', '--offline', '--force', '--help'];
const unknown = [...args].filter(arg => !known.includes(arg));

if (args.has('--help') || unknown.length) {
  if (unknown.length) console.error(`Unknown option: ${unknown.join(', ')}\n`);
  console.log('node tools/update-units.js            check dokkandb and write a proposal to review\n' +
    'node tools/update-units.js --apply    apply tools/proposal.json to the site\'s files\n' +
    'node tools/update-units.js --refresh  download the catalogue even if unchanged\n' +
    'node tools/update-units.js --offline  check using only the saved catalogue\n' +
    '                           --force    with --apply: allow uncommitted edits in data/');
  process.exit(unknown.length ? 1 : 0);
}

if (!fs.existsSync(path.join('data', 'lr.units.json'))) fail('Run this from the repo root: node tools/update-units.js');

const options = { refresh: args.has('--refresh'), offline: args.has('--offline'), force: args.has('--force') };
if (args.has('--apply')) apply(options);
else check(options).catch(err => fail(err.stack || String(err)));

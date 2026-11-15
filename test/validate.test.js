'use strict';

/*
 * Tests for validate-data.js. Each test builds a tiny, valid copy of the
 * repo layout in a temporary folder (3 units per side, empty image files),
 * breaks one thing, runs the real validator against it and checks that it
 * exits 1 with the expected message. Run with `npm test`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VALIDATOR = path.join(__dirname, '..', 'validate-data.js');

// Shared layer images the validator expects (names only; content is not read).
const LAYERS = [
  ...[0, 1, 2, 3, 4].map(t => `cha_base_0${t}_04.png`),
  ...[1, 2].flatMap(c => [0, 1, 2, 3, 4].map(t => `cha_type_icon_${c}${t}.png`)),
  'cha_rare_lr.png',
  'cha_rare_ur.png'
];

// Writes a file, creating its folders first.
function write(root, file, content) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// A valid data file for one side: the texts and the lists kept by hand.
// Unit 2 has alt art, unit 1 is free to play.
function sideData(mode) {
  return {
    mode,
    label: 'Units',
    title: 'Test checklist',
    favicon: 'icon.ico',
    iconDir: `images/${mode}`,
    f2p: '1',
    altArt: [2],
    changelog: ['First line']
  };
}

// A valid units file to go with sideData(): 3 units, one Super EZA, one EZA,
// one with neither. `base` keeps game ids unique between the two sides.
function sideUnits(base) {
  return {
    1: { id: base + 1, type: 'agl', class: 'super', eza: 2, tx: 0, ty: 0 },
    2: { id: base + 2, type: 'teq', class: 'extreme', eza: 1, tx: -1, ty: 1, alt: { id: base + 9, tx: 0, ty: 0 } },
    3: { id: base + 3, type: 'str', class: 'super', tx: 6, ty: -4 }
  };
}

// Builds a complete valid fixture and returns its folder. `change` may edit
// the data objects before they are written; `after` may touch files on disk.
function makeFixture(change, after) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkanlist-validate-'));
  const state = {
    lr: sideData('lr'),
    dfe: sideData('dfe'),
    lrUnits: sideUnits(1000000),
    dfeUnits: sideUnits(2000000)
  };
  if (change) change(state);

  write(root, 'data/lr.json', JSON.stringify(state.lr));
  write(root, 'data/dfe.json', JSON.stringify(state.dfe));
  write(root, 'data/lr.units.json', JSON.stringify(state.lrUnits));
  write(root, 'data/dfe.units.json', JSON.stringify(state.dfeUnits));
  write(root, 'icon.ico', '');
  for (const name of LAYERS) write(root, `images/layers/${name}`, '');
  for (const side of ['lr', 'dfe']) {
    for (const name of ['1.png', '2.png', '2_alt.png', '3.png']) write(root, `images/${side}/thumbs/${name}`, '');
  }
  for (const file of ['css/style.css', 'css/flairs.css', 'js/ranges.js', 'js/scripts.js', 'js/lz-string.js']) {
    write(root, file, `/* ${file} */\n`);
  }
  write(root, 'index.html', '<link href="css/style.css?v=old"><body data-build="old"></body>\n');

  if (after) after(root);
  return root;
}

// Runs the validator inside a fixture folder and returns its exit code and output.
function run(root, ...flags) {
  const result = spawnSync(process.execPath, [VALIDATOR, ...flags], { cwd: root, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
}

// Declares one "this breakage must be reported" test.
function rejects(name, expected, change, after) {
  test(`rejects ${name}`, t => {
    const root = makeFixture(change, after);
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { code, out } = run(root);
    assert.equal(code, 1, out);
    assert.match(out, expected);
  });
}

test('accepts a valid fixture', t => {
  const root = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { code, out } = run(root);
  assert.equal(code, 0, out);
  assert.match(out, /All checks passed/);
});

test('the summary line counts units, EZAs and types from the units file', t => {
  const root = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { out } = run(root);
  assert.match(out, /lr\.json\s+total\s+3\s+EZA\s+2\s+Super\s+1\s+F2P\s+1\s+AGL 1\s+TEQ 1\s+STR 1\s+PHY 0\s+INT 0/);
});

/* --- data file rules --------------------------------------- */

rejects('a mode that does not match the file name', /mode must be "lr"/, s => { s.lr.mode = 'dfe'; });
rejects('an unknown top level field', /unknown field "ezza"/, s => { s.lr.ezza = '1'; });
rejects('a total put back in the data file', /"total" no longer belongs here/, s => { s.lr.total = 3; });
rejects('type lists put back in the data file', /"types" no longer belongs here/, s => { s.lr.types = { agl: '1' }; });
rejects('an eza list put back in the data file', /"eza" no longer belongs here/, s => { s.lr.eza = '1'; });
rejects('a missing label', /missing "label"/, s => { delete s.lr.label; });
rejects('a favicon that is not on disk', /favicon "nope\.ico" does not exist/, s => { s.lr.favicon = 'nope.ico'; });
rejects('a malformed f2p range', /f2p: malformed value "1\.5"/, s => { s.lr.f2p = '1.5'; });
rejects('a backwards f2p range', /f2p: range "2-1" runs backwards/, s => { s.lr.f2p = '2-1'; });
rejects('an f2p id past the last unit', /f2p lists 9, outside 1-3/, s => { s.lr.f2p = '1, 9'; });
rejects('an f2p id listed twice', /f2p lists 1 more than once/, s => { s.lr.f2p = '1, 1'; });
rejects('an f2p that is not a range string', /f2p must be a range string/, s => { s.lr.f2p = [1]; });
rejects('altArt that is not an array', /altArt must be an array/, s => { s.lr.altArt = '2'; });
rejects('a repeated altArt id', /altArt lists 2 more than once/, s => { s.lr.altArt = [2, 2]; });
rejects('an altArt id past the last unit', /altArt lists 7, outside 1-3/, s => { s.lr.altArt = [2, 7]; });
rejects('a changelog with an empty line', /changelog lines must be non-empty/, s => { s.lr.changelog = ['ok', ' ']; });
rejects('a missing changelog', /changelog must be an array/, s => { delete s.lr.changelog; });

/* --- units file -------------------------------------------- */

rejects('a gap in the unit numbers', /has 2 entries, so the keys must be 1 to 2; found "3"/, s => { delete s.lrUnits[2]; s.lr.altArt = []; },
  root => fs.rmSync(path.join(root, 'images/lr/thumbs/2_alt.png')));
rejects('a unit key that is not a number', /keys must be 1 to 3; found "x"/, s => { s.lrUnits.x = s.lrUnits[3]; delete s.lrUnits[3]; });
rejects('a unit with no type', /unit 3: type must be one of agl, teq, str, phy, int/, s => { delete s.lrUnits[3].type; });
rejects('a misspelt type', /unit 1: type must be one of/, s => { s.lrUnits[1].type = 'fire'; });
rejects('a bad class', /unit 1: class must be one of super, extreme/, s => { s.lrUnits[1].class = 'hyper'; });
rejects('a bad eza value', /unit 1: eza must be 1 \(EZA\) or 2 \(Super EZA\)/, s => { s.lrUnits[1].eza = 3; });
rejects('an eza written as a word', /unit 1: eza must be 1 \(EZA\) or 2 \(Super EZA\)/, s => { s.lrUnits[1].eza = 'super'; });
rejects('a decimal thumb offset', /unit 1: tx must be a whole number/, s => { s.lrUnits[1].tx = 0.5; });
rejects('a duplicate game id', /id 1000001 is already used by unit 1/, s => { s.lrUnits[3].id = 1000001; });
rejects('an unknown units field', /unit 1: unknown field "name"/, s => { s.lrUnits[1].name = 'x'; });
rejects('alt art with no alt entry in the units file', /unit 2: is in altArt but has no "alt" entry/,
  s => { delete s.lrUnits[2].alt; });
rejects('an alt entry for a unit that is not in altArt', /unit 2: has an "alt" entry but is not in altArt/,
  s => { s.lr.altArt = []; });

/* --- thumbs and layers ------------------------------------- */

rejects('a missing thumb', /no thumb file for 3/, null,
  root => fs.rmSync(path.join(root, 'images/lr/thumbs/3.png')));
rejects('a thumb with no unit line', /there are 3 units but images\/lr\/thumbs also has 4/, null,
  root => write(root, 'images/lr/thumbs/4.png', ''));
rejects('an unexpected file among the thumbs', /unexpected file images\/lr\/thumbs\/notes\.txt/, null,
  root => write(root, 'images/lr/thumbs/notes.txt', ''));
rejects('alt art with no alt thumb', /altArt lists 2 but images\/lr\/thumbs\/2_alt\.png is missing/, null,
  root => fs.rmSync(path.join(root, 'images/lr/thumbs/2_alt.png')));
rejects('a missing layer image', /images\/layers\/cha_rare_ur\.png is missing/, null,
  root => fs.rmSync(path.join(root, 'images/layers/cha_rare_ur.png')));

/* --- build stamp ------------------------------------------- */

test('--check-stamp fails on a stale build id and writes nothing', t => {
  const root = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const { code, out } = run(root, '--check-stamp');
  assert.equal(code, 1, out);
  assert.match(out, /index\.html carries build id old/);
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), before);
});

test('--stamp writes the id and --check-stamp then passes', t => {
  const root = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(run(root, '--stamp').code, 0);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /\?v=[0-9a-f]{8}"/);
  assert.match(html, /data-build="[0-9a-f]{8}"/);
  const { code, out } = run(root, '--check-stamp');
  assert.equal(code, 0, out);
});

test('the build id ignores CRLF against LF line endings', t => {
  const root = makeFixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, '--stamp');
  const file = path.join(root, 'js/scripts.js');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n'));
  const { code, out } = run(root, '--check-stamp');
  assert.equal(code, 0, out);
});

test('--stamp refuses to stamp when validation fails', t => {
  const root = makeFixture(s => { s.lr.mode = 'dfe'; });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { code, out } = run(root, '--stamp');
  assert.equal(code, 1, out);
  assert.match(out, /Not stamping/);
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /\?v=old/);
});

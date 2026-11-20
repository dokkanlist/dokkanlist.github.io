'use strict';

/*
 * Tests for the update script: the pure logic in tools/lib/units-diff.js, and
 * tools/update-units.js itself run offline against a tiny throwaway copy of
 * the repo layout with a made-up catalogue. No test touches the internet.
 * Run with `npm test`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const diff = require('../tools/lib/units-diff.js');

const SCRIPT = path.join(__dirname, '..', 'tools', 'update-units.js');

/* --- Made-up data ------------------------------------------ */

// A catalogue record in the shape dokkandb returns.
function card(id, rarity, element, tag, step, name, date) {
  return { id, rarity, element, tag: String(tag), optimal_awakening_step: step, name, subname: `Title of ${name}`, open_at_card: date };
}

// Current units: 2 LRs and 2 DFEs.
function units() {
  return {
    lr: {
      1: { id: 1000011, type: 'agl', class: 'super', eza: 1, tx: -1, ty: 1 },
      2: { id: 1000021, type: 'teq', class: 'extreme', tx: -1, ty: 1 }
    },
    dfe: {
      1: { id: 2000011, type: 'str', class: 'super', eza: 1, tx: 6, ty: -4 },
      2: { id: 2000021, type: 'phy', class: 'extreme', tx: 6, ty: -4 }
    }
  };
}

// The Global catalogue: the four known units (LR 2 has gained an EZA, DFE 1
// has gone up to Super EZA), two new LRs, one new DFE, and cards that must be
// ignored (a plain UR, an SSR, an alt art record). "Later" is listed first and
// has the lower id, so the numbering has to come from the release dates.
function globalCards() {
  return [
    card(1000011, 5, 10, 0, 3, 'Known LR One', '2020-01-01'),
    card(1000021, 5, 21, 0, 3, 'Known LR Two', '2020-02-01'),
    card(2000011, 4, 13, 1, 8, 'Known DFE One', '2020-01-01'),
    card(2000021, 4, 24, 1, 0, 'Known DFE Two', '2020-02-01'),
    card(1000031, 5, 12, 4, 0, 'New LR  Later\n', '2024-07-01'),
    card(1000041, 5, 23, 0, 0, 'New LR Earlier', '2024-06-01'),
    card(2000031, 4, 14, 1, 0, 'New DFE', '2024-06-01'),
    card(3000011, 4, 10, 0, 7, 'Plain UR', '2024-06-01'),
    card(3000021, 3, 10, 1, 0, 'An SSR', '2024-06-01'),
    card(1000051, 5, 10, 11, 0, 'Alt Art LR', '2024-06-01')
  ];
}

// The first 24 bytes of a PNG of the given size: enough for the script's
// size check, which only reads the header.
function pngHeader(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/* --- Pure logic -------------------------------------------- */

test('decodeCard reads type, class and EZA state', () => {
  assert.deepEqual(
    diff.decodeCard(card(1, 5, 24, 0, 4, ' Some\nName ', '2024-01-01')),
    { id: 1, rarity: 5, tag: 0, type: 'phy', class: 'extreme', eza: 2, name: 'Some Name', title: 'Title of Some Name', released: '2024-01-01' }
  );
  assert.equal(diff.decodeCard(card(1, 4, 12, 1, 7, 'x', null)).eza, 1);
  assert.equal(diff.decodeCard(card(1, 4, 12, 1, 8, 'x', null)).eza, 2);
  assert.equal(diff.decodeCard(card(1, 5, 12, 0, 0, 'x', null)).eza, 0);
});

test('decodeCard returns null for anything it does not recognise', () => {
  const odd = diff.decodeCard(card(1, 5, 37, 0, 9, 'x', null));
  assert.equal(odd.type, null);
  assert.equal(odd.class, null);
  assert.equal(odd.eza, null);
});

test('sideOf puts every LR on the LR side and only festival URs on the DFE side', () => {
  const side = c => diff.sideOf(diff.decodeCard(c));
  assert.equal(side(card(1, 5, 10, 0, 0, 'x')), 'lr');
  assert.equal(side(card(1, 5, 10, 1, 0, 'x')), 'lr');
  assert.equal(side(card(1, 5, 10, 11, 0, 'x')), null);
  assert.equal(side(card(1, 4, 10, 1, 0, 'x')), 'dfe');
  assert.equal(side(card(1, 4, 10, 0, 0, 'x')), null);
  assert.equal(side(card(1, 3, 10, 1, 0, 'x')), null);
});

test('buildProposal numbers new units on from the last one, in release order', () => {
  const proposal = diff.buildProposal({ units: units(), globalCards: globalCards() });
  assert.deepEqual(proposal.lr.newUnits.map(u => [u.number, u.id, u.name, u.type, u.class, u.eza, u.tx, u.ty]), [
    [3, 1000041, 'New LR Earlier', 'str', 'extreme', 0, -1, 1],
    [4, 1000031, 'New LR Later', 'int', 'super', 0, -1, 1]
  ]);
  assert.deepEqual(proposal.dfe.newUnits.map(u => [u.number, u.id, u.type, u.class, u.tx, u.ty]), [
    [3, 2000031, 'phy', 'super', 6, -4]
  ]);
});

test('buildProposal numbers same-day units lower game id first and says so in the notes', () => {
  const cards = globalCards();
  cards.find(c => c.id === 1000031).open_at_card = '2024-06-01T09:00:00';
  cards.find(c => c.id === 1000041).open_at_card = '2024-06-01T09:00:00';
  const proposal = diff.buildProposal({ units: units(), globalCards: cards });
  assert.deepEqual(proposal.lr.newUnits.map(u => [u.number, u.id]), [[3, 1000031], [4, 1000041]]);
  assert.match(proposal.notes.join('\n'), /LR 3 "New LR Later", LR 4 "New LR Earlier" were released on the same day \(2024-06-01\)/);
  // One unit on a day of its own is not mentioned.
  assert.doesNotMatch(proposal.notes.join('\n'), /DFE 3 .*same day/);
});

test('buildProposal reports EZA changes and writes the changelog lines', () => {
  const proposal = diff.buildProposal({ units: units(), globalCards: globalCards() });
  assert.deepEqual(proposal.lr.ezaChanges, [{ number: 2, name: 'Known LR Two', type: 'teq', from: 0, to: 1 }]);
  assert.deepEqual(proposal.dfe.ezaChanges, [{ number: 1, name: 'Known DFE One', type: 'str', from: 1, to: 2 }]);
  assert.deepEqual(proposal.lr.changelog, ['STR New LR Earlier', 'INT New LR Later', 'TEQ Known LR Two EZA']);
  assert.deepEqual(proposal.dfe.changelog, ['PHY New DFE', 'STR Known DFE One Super EZA']);
});

test('buildProposal pre-ticks free to play LRs and notes alt art and type mismatches', () => {
  const cards = globalCards();
  cards[0].element = 11; // Known LR One is AGL here but TEQ in the catalogue
  const proposal = diff.buildProposal({ units: units(), globalCards: cards });
  const notes = proposal.notes.join('\n');
  // "Later" has catalogue tag 4 (free to play), "Earlier" has none; DFEs get no f2p field.
  assert.deepEqual(proposal.lr.newUnits.map(u => [u.number, u.f2p]), [[3, false], [4, true]]);
  assert.equal('f2p' in proposal.dfe.newUnits[0], false);
  assert.match(notes, /LR 4 "New LR Later" looks free to play \(catalogue tag 4\), so it is marked "f2p": true/);
  assert.match(notes, /Possible alt art: "Alt Art LR"/);
  assert.match(notes, /LR 1 "Known LR One" is AGL here but TEQ in the catalogue/);
  assert.equal(proposal.lr.newUnits.some(u => u.id === 1000051), false);
});

test('buildProposal stays silent about ignored ids', () => {
  const proposal = diff.buildProposal({ units: units(), globalCards: globalCards(), ignoreIds: [1000051, 1000031] });
  assert.doesNotMatch(proposal.notes.join('\n'), /Alt Art LR/);
  assert.deepEqual(proposal.lr.newUnits.map(u => u.id), [1000041]);
});

test('buildProposal is empty when the checklist already matches', () => {
  const cards = [
    card(1000011, 5, 10, 0, 3, 'a', '2020'), card(1000021, 5, 21, 0, 0, 'b', '2020'),
    card(2000011, 4, 13, 1, 7, 'c', '2020'), card(2000021, 4, 24, 1, 0, 'd', '2020')
  ];
  const proposal = diff.buildProposal({ units: units(), globalCards: cards });
  assert.equal(diff.isEmpty(proposal), true);
  assert.deepEqual(proposal.notes, []);
});

test('checkProposal accepts what buildProposal made and rejects bad edits', () => {
  const make = () => diff.buildProposal({ units: units(), globalCards: globalCards() });
  assert.deepEqual(diff.checkProposal(make(), units()), []);

  const gap = make(); gap.lr.newUnits[0].number = 9;
  assert.match(diff.checkProposal(gap, units()).join('\n'), /numbers must carry on from 2 with no gaps, so this one should be 3/);

  const dropped = make(); dropped.lr.newUnits.shift();
  assert.match(diff.checkProposal(dropped, units()).join('\n'), /should be 3/);

  const type = make(); type.lr.newUnits[0].type = 'fire';
  assert.match(diff.checkProposal(type, units()).join('\n'), /type must be one of/);

  const duplicate = make(); duplicate.lr.newUnits[0].id = 1000011;
  assert.match(diff.checkProposal(duplicate, units()).join('\n'), /game id 1000011 is already LR 1/);

  const ghost = make(); ghost.lr.ezaChanges[0].number = 77;
  assert.match(diff.checkProposal(ghost, units()).join('\n'), /there is no such unit/);
});

test('checkProposal explains broken entries instead of crashing', () => {
  const make = () => diff.buildProposal({ units: units(), globalCards: globalCards() });
  const problems = edit => diff.checkProposal(edit(make()), units()).join('\n');

  assert.match(problems(p => { p.lr.newUnits[0] = null; return p; }), /LR new unit in place 1: must be an entry like the others/);
  assert.match(problems(p => { p.dfe.ezaChanges[0] = 'x'; return p; }), /DFE EZA change in place 1: must be an entry like the others/);
  assert.match(problems(p => { p.lr.newUnits[0].number = '3'; return p; }), /"number" must be a whole number \(written without quotes\)/);
  assert.match(problems(p => { p.lr.ezaChanges.push({ number: 2, to: 0 }); return p; }), /unit 2 is listed twice/);
  assert.match(problems(p => { p.lr.newUnits[0].f2p = 'yes'; return p; }), /f2p must be true or false/);
  assert.match(problems(p => { p.dfe.newUnits[0].f2p = true; return p; }), /only the LR side has an f2p list/);
  assert.match(problems(() => null), /LR: the proposal must have newUnits/);
  assert.match(problems(() => []), /DFE: the proposal must have newUnits/);
});

test('applyToUnits and formatUnits produce one tidy line per unit', () => {
  const proposal = diff.buildProposal({ units: units(), globalCards: globalCards() });
  const text = diff.formatUnits(diff.applyToUnits(units().lr, proposal.lr));
  assert.equal(text,
    '{\n' +
    '  "1": {"id": 1000011, "type": "agl", "class": "super", "eza": 1, "tx": -1, "ty": 1},\n' +
    '  "2": {"id": 1000021, "type": "teq", "class": "extreme", "eza": 1, "tx": -1, "ty": 1},\n' +
    '  "3": {"id": 1000041, "type": "str", "class": "extreme", "tx": -1, "ty": 1},\n' +
    '  "4": {"id": 1000031, "type": "int", "class": "super", "tx": -1, "ty": 1}\n' +
    '}\n');
});

test('addToF2p merges numbers into the f2p list and leaves the rest alone', () => {
  const before = '{\n  "mode": "lr",\n\n  "f2p": "1-5,9,14-16,188",\n\n  "altArt": [14]\n}\n';
  assert.equal(diff.addToF2p(before, [197, 6]), '{\n  "mode": "lr",\n\n  "f2p": "1-6,9,14-16,188,197",\n\n  "altArt": [14]\n}\n');
  assert.equal(diff.addToF2p(before, [9]), before);
  assert.throws(() => diff.addToF2p('{ "mode": "dfe" }', [1]), /no "f2p" list/);
});

test('replaceChangelog swaps only the changelog list', () => {
  const before = '{\n  "mode": "lr",\n\n  "altArt": [14,18],\n\n  "changelog": [\n    "Old one",\n    "Old two"\n  ]\n}\n';
  assert.equal(diff.replaceChangelog(before, ['AGL "Quoted" name', 'Second']),
    '{\n  "mode": "lr",\n\n  "altArt": [14,18],\n\n  "changelog": [\n    "AGL \\"Quoted\\" name",\n    "Second"\n  ]\n}\n');
});

/* --- The script, offline, against a throwaway repo ---------- */

const LAYERS = [
  ...[0, 1, 2, 3, 4].map(t => `cha_base_0${t}_04.png`),
  ...[1, 2].flatMap(c => [0, 1, 2, 3, 4].map(t => `cha_type_icon_${c}${t}.png`)),
  'cha_rare_lr.png', 'cha_rare_ur.png'
];

// Writes a file, creating its folders first.
function write(root, file, content) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// Builds a valid two-units-per-side repo layout with a saved catalogue, so
// the script can run with --offline. Thumbs for the new units are already in
// the script's thumb folder, as if a previous check had downloaded them.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dokkanlist-update-'));
  const side = mode => Object.assign(
    { mode, label: 'Units', title: 'Test', favicon: 'icon.ico', iconDir: `images/${mode}` },
    mode === 'lr' ? { f2p: '1' } : {},
    { altArt: [], changelog: ['Old line'] }
  );
  write(root, 'data/lr.json', JSON.stringify(side('lr'), null, 2).replace('"altArt": []', '"altArt": []') + '\n');
  write(root, 'data/dfe.json', JSON.stringify(side('dfe'), null, 2) + '\n');
  write(root, 'data/lr.units.json', diff.formatUnits(units().lr));
  write(root, 'data/dfe.units.json', diff.formatUnits(units().dfe));
  write(root, 'icon.ico', '');
  for (const name of LAYERS) write(root, `images/layers/${name}`, '');
  for (const mode of ['lr', 'dfe']) for (const n of [1, 2]) write(root, `images/${mode}/thumbs/${n}.png`, '');
  for (const file of ['css/style.css', 'css/flairs.css', 'js/ranges.js', 'js/scripts.js', 'js/lz-string.js']) write(root, file, '/* x */\n');
  write(root, 'index.html', '<link href="css/style.css?v=old"><body data-build="old"></body>\n');

  write(root, 'tools/.cache/versions.json', JSON.stringify({ database: 'test' }));
  write(root, 'tools/.cache/catalogue-global.json', JSON.stringify(globalCards()));
  for (const id of [1000031, 1000041, 2000031]) write(root, `tools/.cache/thumbs/${id}.png`, pngHeader(250, 250));
  return root;
}

// Runs the update script inside a throwaway repo.
function run(root, ...flags) {
  const result = spawnSync(process.execPath, [SCRIPT, ...flags], { cwd: root, encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
}

test('a check writes a proposal and a preview and changes nothing else', t => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const unitsBefore = fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8');

  const { code, out } = run(root, '--offline');
  assert.equal(code, 0, out);
  assert.match(out, /NEW {2}LR 3 {2}extreme STR {2}New LR Earlier/);
  assert.match(out, /EZA {2}DFE 1 {2}Known DFE One: EZA -> Super EZA/);
  assert.match(out, /Nothing has been changed/);

  const proposal = JSON.parse(fs.readFileSync(path.join(root, 'tools/proposal.json'), 'utf8'));
  assert.equal(proposal.lr.newUnits.length, 2);
  assert.match(fs.readFileSync(path.join(root, 'tools/preview.html'), 'utf8'), /New: LR 3/);
  assert.equal(fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8'), unitsBefore);
  assert.equal(fs.existsSync(path.join(root, 'images/lr/thumbs/3.png')), false);
});

test('--apply writes units, thumbs and changelog, and the result validates', t => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, '--offline');

  // The owner rewords one changelog line before applying.
  const file = path.join(root, 'tools/proposal.json');
  const proposal = JSON.parse(fs.readFileSync(file, 'utf8'));
  proposal.lr.changelog[0] = 'STR Reworded by hand';
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2));

  const { code, out } = run(root, '--apply');
  assert.equal(code, 0, out);
  assert.match(out, /All checks passed/);
  assert.match(out, /LR: added 3, 4/);

  const lr = JSON.parse(fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8'));
  assert.deepEqual(Object.keys(lr), ['1', '2', '3', '4']);
  assert.equal(lr[2].eza, 1);
  assert.equal(lr[3].id, 1000041);
  const dfe = JSON.parse(fs.readFileSync(path.join(root, 'data/dfe.units.json'), 'utf8'));
  assert.equal(dfe[1].eza, 2);
  assert.deepEqual(fs.readFileSync(path.join(root, 'images/lr/thumbs/4.png')), pngHeader(250, 250));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'data/lr.json'), 'utf8')).changelog,
    ['STR Reworded by hand', 'INT New LR Later', 'TEQ Known LR Two EZA']);
  // LR 4 was pre-ticked as free to play, LR 3 was not.
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/lr.json'), 'utf8')).f2p, '1,4');
  assert.match(out, /LR: added 4 to f2p/);
  assert.equal(fs.existsSync(file), false);

  // Running the check again finds nothing left to do.
  const again = run(root, '--offline');
  assert.match(again.out, /The checklist is up to date/);
});

test('--apply refuses a proposal with a gap in the numbers and touches nothing', t => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, '--offline');
  const file = path.join(root, 'tools/proposal.json');
  const proposal = JSON.parse(fs.readFileSync(file, 'utf8'));
  proposal.lr.newUnits[1].number = 7;
  fs.writeFileSync(file, JSON.stringify(proposal));
  const before = fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8');

  const { code, out } = run(root, '--apply');
  assert.equal(code, 1, out);
  assert.match(out, /numbers must carry on from 2 with no gaps/);
  assert.equal(fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, 'images/lr/thumbs/3.png')), false);
});

test('--apply puts every file back when the validator rejects the result', t => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, '--offline');
  // Something unrelated is wrong with the repo, which only the validator sees.
  fs.rmSync(path.join(root, 'images/layers/cha_rare_ur.png'));
  const before = fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8');
  const dataBefore = fs.readFileSync(path.join(root, 'data/lr.json'), 'utf8');

  const { code, out } = run(root, '--apply');
  assert.equal(code, 1, out);
  assert.match(out, /every file was put back/);
  assert.equal(fs.readFileSync(path.join(root, 'data/lr.units.json'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(root, 'data/lr.json'), 'utf8'), dataBefore);
  assert.equal(fs.existsSync(path.join(root, 'images/lr/thumbs/3.png')), false);
  assert.equal(fs.existsSync(path.join(root, 'tools/proposal.json')), true);
});

// Runs a check in a fresh throwaway repo and returns its root and a helper
// that reads every site file, to show nothing changed.
function checkedRepo(t) {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, '--offline');
  const snapshot = () => ['data/lr.units.json', 'data/dfe.units.json', 'data/lr.json', 'data/dfe.json', 'index.html']
    .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n---\n') +
    ['lr', 'dfe'].map(mode => fs.readdirSync(path.join(root, `images/${mode}/thumbs`)).join(',')).join('|');
  return { root, snapshot };
}

test('--apply puts every file back when it fails part way, not only on a validator rejection', t => {
  const { root, snapshot } = checkedRepo(t);
  // The DFE data file has lost its changelog list, so applying fails after
  // the LR files and thumbs have already been written.
  const dataFile = path.join(root, 'data/dfe.json');
  fs.writeFileSync(dataFile, fs.readFileSync(dataFile, 'utf8').replace('"changelog"', '"notes"'));
  const before = snapshot();

  const { code, out } = run(root, '--apply');
  assert.equal(code, 1, out);
  assert.match(out, /Applying stopped part way \(no "changelog" list found in the data file\), so every file was put back/);
  assert.doesNotMatch(out, /\n\s+at /);
  assert.equal(snapshot(), before);
  assert.equal(fs.existsSync(path.join(root, 'tools/proposal.json')), true);
});

test('--apply leaves f2p alone when the owner unticks a unit', t => {
  const { root } = checkedRepo(t);
  const file = path.join(root, 'tools/proposal.json');
  const proposal = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(proposal.lr.newUnits[1].f2p, true);
  proposal.lr.newUnits[1].f2p = false;
  // A unit the catalogue gave no hint for can be ticked by hand too.
  proposal.lr.newUnits[0].f2p = true;
  fs.writeFileSync(file, JSON.stringify(proposal, null, 2));

  const { code, out } = run(root, '--apply');
  assert.equal(code, 0, out);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/lr.json'), 'utf8')).f2p, '1,3');
});

test('--apply refuses a saved thumb that is not a 250 x 250 PNG', t => {
  const { root, snapshot } = checkedRepo(t);
  write(root, 'tools/.cache/thumbs/1000041.png', pngHeader(1, 1));
  write(root, 'tools/.cache/thumbs/2000031.png', 'not an image');
  const before = snapshot();

  const { code, out } = run(root, '--apply');
  assert.equal(code, 1, out);
  assert.match(out, /LR 3: tools.\.cache.thumbs.1000041\.png is not a 250 x 250 px PNG/);
  assert.match(out, /DFE 3: tools.\.cache.thumbs.2000031\.png is not a 250 x 250 px PNG/);
  assert.equal(snapshot(), before);
});

test('--apply explains a proposal that is no longer valid JSON', t => {
  const { root, snapshot } = checkedRepo(t);
  const file = path.join(root, 'tools/proposal.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n}\s*$/, ',\n}\n'));
  const before = snapshot();

  const broken = run(root, '--apply');
  assert.equal(broken.code, 1, broken.out);
  assert.match(broken.out, /proposal\.json is not valid JSON any more, so nothing was changed/);
  assert.doesNotMatch(broken.out, /\n\s+at /);

  fs.writeFileSync(file, '');
  assert.match(run(root, '--apply').out, /proposal\.json is empty/);
  assert.equal(snapshot(), before);
});

test('--apply without a proposal explains what to do', t => {
  const root = makeRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { code, out } = run(root, '--apply');
  assert.equal(code, 1);
  assert.match(out, /Run the check first/);
});

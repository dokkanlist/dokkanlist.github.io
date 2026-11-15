'use strict';

/*
 * units-diff.js
 * -------------
 * The thinking part of tools/update-units.js, kept free of network and file
 * access so it can be unit tested (test/units-diff.test.js):
 *
 *   decodeCard()      one dokkandb catalogue record -> the facts the site needs
 *   mergeRecent()     folds the "latest cards" list into the saved catalogue
 *   sideOf()          which side of the checklist a card belongs on, if any
 *   buildProposal()   catalogue + current units files -> a proposal to review
 *   checkProposal()   is an (owner-edited) proposal safe to apply?
 *   applyToUnits()    proposal + units -> the new units object
 *   formatUnits()     units object -> the one-line-per-unit file text
 *   replaceChangelog() swaps the changelog array inside a data file's text
 */

const TYPES = ['agl', 'teq', 'str', 'phy', 'int'];
const CLASSES = ['super', 'extreme'];
// EZA state as stored in the units files: 0 = none (the field is left out),
// 1 = EZA, 2 = Super EZA.
const EZA_NONE = 0;
const EZA = 1;
const SUPER_EZA = 2;
const EZA_STATES = [EZA_NONE, EZA, SUPER_EZA];
const EZA_WORDS = ['none', 'EZA', 'Super EZA'];

// The game numbers the five types 0-4 in this order (units digit of "element").
const TYPE_BY_DIGIT = ['agl', 'teq', 'int', 'str', 'phy'];
// Tens digit of "element".
const CLASS_BY_DIGIT = { 1: 'super', 2: 'extreme' };
// "optimal_awakening_step" per rarity: which step means EZA and Super EZA.
const EZA_BY_STEP = { 5: { 0: EZA_NONE, 3: EZA, 4: SUPER_EZA }, 4: { 0: EZA_NONE, 7: EZA, 8: SUPER_EZA } };

const RARITY_LR = 5;
const RARITY_UR = 4;
// Catalogue "tag" values used here.
const TAG_DOKKAN_FESTIVAL = 1;
const TAG_ALT_ART = 11;
// Tags that usually mean a free to play unit: F2P, World Tournament,
// Ultimate Clash, Battle Road. Only ever used as a hint for the owner.
const F2P_TAGS = [4, 5, 6, 10];

// Thumb offset a new unit starts with on each side (see README, "A unit line").
const DEFAULT_OFFSET = { lr: { tx: -1, ty: 1 }, dfe: { tx: 6, ty: -4 } };

// Tidies a name from the catalogue: names can hold line breaks and stray spaces.
function cleanName(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

// Turns a release date from the catalogue into milliseconds. The API has been
// seen to use text dates; numbers (seconds or milliseconds) are accepted too.
// Unknown or missing dates sort last.
function toTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value == null ? '' : value));
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

// One catalogue record -> { id, rarity, tag, type, class, eza, name, title, released }.
// Anything that cannot be decoded comes back as null so the caller can flag it.
function decodeCard(card) {
  const element = Number(card.element);
  const rarity = Number(card.rarity);
  const steps = EZA_BY_STEP[rarity] || {};
  const step = Number(card.optimal_awakening_step) || 0;
  return {
    id: Number(card.id),
    rarity,
    tag: Number(card.tag),
    type: TYPE_BY_DIGIT[element % 10] || null,
    class: CLASS_BY_DIGIT[Math.floor(element / 10)] || null,
    eza: step in steps ? steps[step] : null,
    name: cleanName(card.name),
    title: cleanName(card.subname),
    released: card.open_at_card == null ? null : card.open_at_card
  };
}

// 'lr' for every LR (alt art records excluded), 'dfe' for a UR Dokkan
// Festival unit, null for everything else.
function sideOf(decoded) {
  if (decoded.rarity === RARITY_LR && decoded.tag !== TAG_ALT_ART) return 'lr';
  if (decoded.rarity === RARITY_UR && decoded.tag === TAG_DOKKAN_FESTIVAL) return 'dfe';
  return null;
}

// The changelog line for one change, in the style the owner writes by hand:
// "AGL Name", "AGL Name EZA", "AGL Name Super EZA".
function changelogLine(type, name, eza) {
  const suffix = eza === SUPER_EZA ? ' Super EZA' : eza === EZA ? ' EZA' : '';
  return `${String(type).toUpperCase()} ${name}${suffix}`;
}

// Compares the catalogue with the units files and describes what should change.
//   units        { lr: {...}, dfe: {...} }  the current units files
//   globalCards  raw catalogue records from the Global server (the source of truth)
//   jpCards      raw catalogue records from the JP server (release order only)
//   ignoreIds    game ids to stay silent about (tools/ignore-ids.json)
// Returns { lr: { newUnits, ezaChanges, changelog }, dfe: { ... }, notes: [...] }.
function buildProposal({ units, globalCards, jpCards, ignoreIds }) {
  const ignored = new Set(ignoreIds || []);
  const jpDate = new Map();
  for (const card of jpCards || []) jpDate.set(Number(card.id), card.open_at_card);

  const decoded = globalCards.map(decodeCard);
  const byId = new Map(decoded.map(card => [card.id, card]));

  // Every game id already on the checklist, on either side, alt art included.
  const known = new Set();
  for (const side of ['lr', 'dfe']) {
    for (const unit of Object.values(units[side])) {
      known.add(unit.id);
      if (unit.alt) known.add(unit.alt.id);
    }
  }

  const notes = [];
  const proposal = { lr: null, dfe: null, notes };

  for (const side of ['lr', 'dfe']) {
    const current = units[side];
    const count = Object.keys(current).length;

    // --- new units, numbered on from the last one in JP release order ---
    const fresh = decoded
      .filter(card => sideOf(card) === side && !known.has(card.id) && !ignored.has(card.id))
      .map(card => Object.assign({}, card, { order: toTime(jpDate.has(card.id) ? jpDate.get(card.id) : card.released) }))
      .sort((a, b) => a.order - b.order || a.id - b.id);

    const newUnits = [];
    fresh.forEach(card => {
      if (!card.type || !card.class || card.eza === null) {
        notes.push(`${side.toUpperCase()} new card ${card.id} "${card.name}" could not be decoded (type, class or EZA step unknown) and was left out. Add it by hand.`);
        return;
      }
      const number = count + newUnits.length + 1;
      const entry = {
        number,
        id: card.id,
        name: card.name,
        title: card.title,
        type: card.type,
        class: card.class,
        eza: card.eza,
        tx: DEFAULT_OFFSET[side].tx,
        ty: DEFAULT_OFFSET[side].ty,
        released: card.released
      };
      if (!jpDate.has(card.id)) entry.orderNote = 'No JP release date found; ordered by its Global date.';
      newUnits.push(entry);
      if (side === 'lr' && F2P_TAGS.includes(card.tag)) {
        notes.push(`LR ${number} "${card.name}" looks free to play (catalogue tag ${card.tag}). Add ${number} to f2p in data/lr.json if you agree.`);
      }
    });

    // --- EZA changes and sanity checks on the units already listed ---
    const ezaChanges = [];
    for (const [key, unit] of Object.entries(current)) {
      const card = byId.get(unit.id);
      const label = `${side.toUpperCase()} ${key}`;
      if (!card) {
        notes.push(`${label} (game id ${unit.id}) was not found in the Global catalogue.`);
        continue;
      }
      if (card.type && card.type !== unit.type) {
        notes.push(`${label} "${card.name}" is ${unit.type.toUpperCase()} here but ${card.type.toUpperCase()} in the catalogue. Not changed.`);
      }
      if (card.class && card.class !== unit.class) {
        notes.push(`${label} "${card.name}" is ${unit.class} here but ${card.class} in the catalogue. Not changed.`);
      }
      const have = unit.eza || EZA_NONE;
      if (card.eza !== null && card.eza !== have) {
        ezaChanges.push({ number: Number(key), name: card.name, type: unit.type, from: have, to: card.eza });
      }
    }
    ezaChanges.sort((a, b) => a.number - b.number);

    const changelog = [
      ...newUnits.map(unit => changelogLine(unit.type, unit.name, EZA_NONE)),
      ...ezaChanges.filter(change => change.to !== EZA_NONE).map(change => changelogLine(change.type, change.name, change.to))
    ];

    proposal[side] = { newUnits, ezaChanges, changelog };
  }

  // --- alt art records the checklist does not know about ---
  for (const card of decoded) {
    if (card.tag === TAG_ALT_ART && !known.has(card.id) && !ignored.has(card.id) && (card.rarity === RARITY_LR || card.rarity === RARITY_UR)) {
      notes.push(`Possible alt art: "${card.name}" (game id ${card.id}, ${card.rarity === RARITY_LR ? 'LR' : 'UR'}). Alt art is added by hand to an existing unit, see README.`);
    }
  }

  return proposal;
}

// Folds dokkandb's short "latest cards" list into the saved catalogue, so a
// routine check does not need the whole catalogue again.
//   cards   the saved Global catalogue
//   recent  the latest-cards list: records with at least id and
//           optimal_awakening_step
// Returns { cards, updated } with the EZA steps of the listed cards brought
// up to date, or null when the list names a card the saved catalogue has
// never seen (or is not a usable list): then the full catalogue is needed.
function mergeRecent(cards, recent) {
  if (!Array.isArray(recent) || !recent.length) return null;
  const position = new Map(cards.map((card, index) => [Number(card.id), index]));
  const next = cards.slice();
  let updated = 0;
  for (const item of recent) {
    const index = position.get(Number(item && item.id));
    if (index === undefined) return null;
    if (item.optimal_awakening_step === undefined) continue;
    if (Number(next[index].optimal_awakening_step) !== Number(item.optimal_awakening_step)) {
      next[index] = Object.assign({}, next[index], { optimal_awakening_step: item.optimal_awakening_step });
      updated++;
    }
  }
  return { cards: next, updated };
}

// True when a proposal contains nothing to apply.
function isEmpty(proposal) {
  return ['lr', 'dfe'].every(side => !proposal[side].newUnits.length && !proposal[side].ezaChanges.length);
}

// Checks a proposal (which the owner may have edited) against the current
// units files. Returns a list of problems; empty means it is safe to apply.
function checkProposal(proposal, units) {
  const problems = [];
  const known = new Map();
  for (const side of ['lr', 'dfe']) {
    for (const [key, unit] of Object.entries(units[side])) {
      known.set(unit.id, `${side.toUpperCase()} ${key}`);
      if (unit.alt) known.set(unit.alt.id, `${side.toUpperCase()} ${key} alt`);
    }
  }

  for (const side of ['lr', 'dfe']) {
    const part = proposal && proposal[side];
    const label = side.toUpperCase();
    if (!part || !Array.isArray(part.newUnits) || !Array.isArray(part.ezaChanges) || !Array.isArray(part.changelog)) {
      problems.push(`${label}: the proposal must have newUnits, ezaChanges and changelog lists`);
      continue;
    }
    const count = Object.keys(units[side]).length;

    part.newUnits.forEach((unit, index) => {
      const where = `${label} new unit ${unit.number}`;
      const expected = count + index + 1;
      if (unit.number !== expected) {
        problems.push(`${where}: numbers must carry on from ${count} with no gaps, so this one should be ${expected}`);
      }
      if (!Number.isInteger(unit.id) || unit.id < 1000000 || unit.id > 9999999) problems.push(`${where}: id must be a 7 digit game card id`);
      else if (known.has(unit.id)) problems.push(`${where}: game id ${unit.id} is already ${known.get(unit.id)}`);
      else known.set(unit.id, where);
      if (!TYPES.includes(unit.type)) problems.push(`${where}: type must be one of ${TYPES.join(', ')}`);
      if (!CLASSES.includes(unit.class)) problems.push(`${where}: class must be super or extreme`);
      if (!EZA_STATES.includes(unit.eza)) problems.push(`${where}: eza must be 0 (none), 1 (EZA) or 2 (Super EZA)`);
      for (const axis of ['tx', 'ty']) {
        if (!Number.isInteger(unit[axis])) problems.push(`${where}: ${axis} must be a whole number`);
      }
    });

    for (const change of part.ezaChanges) {
      const where = `${label} EZA change for unit ${change.number}`;
      if (!units[side][change.number]) problems.push(`${where}: there is no such unit`);
      if (!EZA_STATES.includes(change.to)) problems.push(`${where}: "to" must be 0 (none), 1 (EZA) or 2 (Super EZA)`);
    }

    if (part.changelog.some(line => typeof line !== 'string' || !line.trim())) {
      problems.push(`${label}: changelog lines must be non-empty text`);
    }
  }
  return problems;
}

// Builds one unit line's object in the file's field order.
function unitRecord({ id, type, class: unitClass, eza, tx, ty, alt }) {
  const record = { id, type, class: unitClass };
  if (eza) record.eza = eza;
  record.tx = tx;
  record.ty = ty;
  if (alt) record.alt = alt;
  return record;
}

// Returns a new units object for one side with the proposal applied.
// The input is not modified.
function applyToUnits(current, part) {
  const next = {};
  for (const [key, unit] of Object.entries(current)) next[key] = unitRecord(unit);
  for (const change of part.ezaChanges) {
    next[change.number] = unitRecord(Object.assign({}, next[change.number], { eza: change.to }));
  }
  for (const unit of part.newUnits) next[unit.number] = unitRecord(unit);
  return next;
}

// The units file as text: one unit per line, in number order, so the file
// stays easy to read and a change shows up as a one line diff.
function formatUnits(units) {
  const keys = Object.keys(units).map(Number).sort((a, b) => a - b);
  const lines = keys.map(key => {
    const json = JSON.stringify(units[key])
      .replace(/":/g, '": ')
      .replace(/,"/g, ', "');
    return `  "${key}": ${json}`;
  });
  return `{\n${lines.join(',\n')}\n}\n`;
}

// Swaps the "changelog" array inside a data file's text for new lines,
// leaving the rest of the hand-formatted file exactly as it was.
function replaceChangelog(text, lines) {
  const pattern = /("changelog":\s*\[)[\s\S]*?(\n?\s*\])/;
  if (!pattern.test(text)) throw new Error('no "changelog" list found in the data file');
  const body = lines.map(line => `\n    ${JSON.stringify(line)}`).join(',');
  return text.replace(pattern, (all, open) => `${open}${body}\n  ]`);
}

module.exports = {
  TYPES, DEFAULT_OFFSET, EZA_WORDS,
  cleanName, toTime, decodeCard, sideOf, changelogLine, mergeRecent,
  buildProposal, isEmpty, checkProposal, applyToUnits, formatUnits, replaceChangelog
};

'use strict';

/* ============================================================
   Range helpers
   ------------------------------------------------------------
   One implementation shared by the site (js/scripts.js, where it
   is exposed as the global `Ranges`) and by the Node validator
   (validate-data.js, where it is loaded with require()).

   A range string is a comma separated list of whole numbers and
   inclusive ranges, for example "1-3, 7, 10-12".
   ============================================================ */

(function (root, factory) {
  // Node: export the helpers. Browser: attach them to the global object.
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ranges = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Largest id a range may reach unless the caller passes its own `max`.
  // Without a ceiling, a damaged save or import code such as "1-999999999"
  // would loop a billion times and freeze the tab.
  const DEFAULT_MAX = 10000;

  // One token: a whole number, or two whole numbers joined by a hyphen.
  // Anything else (a leading hyphen, decimals, letters) is rejected.
  const TOKEN = /^(\d+)(?:\s*-\s*(\d+))?$/;

  // Default problem handler: report to the console and carry on.
  function warnInConsole(message) {
    console.warn(`Ignoring range entry: ${message}`);
  }

  // "1-3,7,10-12" -> [1,2,3,7,10,11,12]
  // Bad tokens are skipped and reported through options.onError(message).
  //   options.max      highest id allowed (default DEFAULT_MAX)
  //   options.onError  called once per rejected token (default: console.warn)
  function parseRanges(rangeString, options) {
    const max = options && Number.isInteger(options.max) ? options.max : DEFAULT_MAX;
    const onError = options && typeof options.onError === 'function' ? options.onError : warnInConsole;
    const result = [];

    for (const part of String(rangeString == null ? '' : rangeString).split(',')) {
      const token = part.trim();
      if (!token) continue;

      const match = TOKEN.exec(token);
      if (!match) {
        onError(`malformed value "${token}"`);
        continue;
      }

      const start = Number(match[1]);
      const end = match[2] === undefined ? start : Number(match[2]);
      if (end < start) {
        onError(`range "${token}" runs backwards`);
        continue;
      }
      if (end > max) {
        onError(`"${token}" goes past the limit of ${max}`);
        continue;
      }
      for (let i = start; i <= end; i++) result.push(i);
    }
    return result;
  }

  // [1,2,3,7,10,11,12] -> "1-3,7,10-12"
  // Duplicates are dropped and the output is sorted.
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

  return { parseRanges, formatRanges, DEFAULT_MAX };
});

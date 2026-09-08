#!/usr/bin/env node
// Adversarial cases for strip-comments.mjs.
//
// Every case here is a way a REGEX-based stripper corrupts real code. The point
// of the suite is not "does it remove comments" -- that part is easy -- it is
// "does it leave everything that is NOT a comment exactly alone".

import { stripJs, stripCss, stripHtml, tidy } from './strip-comments.mjs';

let pass = 0;
const failures = [];

function eq(name, got, want) {
  if (got === want) { pass++; return; }
  failures.push(`${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
}

// --- the `//` that is NOT a comment ------------------------------------------
eq('url in a string survives',
  stripJs(`const u = "https://x.dev/a"; // gone`),
  `const u = "https://x.dev/a"; `);

eq('url in single quotes survives',
  stripJs(`const u = 'http://a//b';`),
  `const u = 'http://a//b';`);

eq('escaped quote does not end the string',
  stripJs(`const s = "he said \\" // not a comment"; // gone`),
  `const s = "he said \\" // not a comment"; `);

// --- division must not be read as a regex ------------------------------------
eq('division after identifier',
  stripJs(`const r = a / b; // gone`),
  `const r = a / b; `);

eq('division after close paren',
  stripJs(`const r = (a + b) / 2 / c;`),
  `const r = (a + b) / 2 / c;`);

eq('division after number, then a comment',
  stripJs(`x = 4 / 2; /* gone */ y = 1;`),
  `x = 4 / 2;   y = 1;`);

// --- real regex literals must survive intact ---------------------------------
eq('regex containing a slash-slash',
  stripJs(`const re = /a\\/\\/b/g; // gone`),
  `const re = /a\\/\\/b/g; `);

eq('regex after return',
  stripJs(`function f() { return /x/.test(s); }`),
  `function f() { return /x/.test(s); }`);

eq('regex with a class containing a slash',
  stripJs(`s.split(/[/,]/);`),
  `s.split(/[/,]/);`);

// --- template literals --------------------------------------------------------
eq('template keeps its content verbatim',
  stripJs('const t = `a // b ${x} c`;'),
  'const t = `a // b ${x} c`;');

eq('comment INSIDE ${} is stripped',
  stripJs('const t = `${ x /* gone */ }`;'),
  'const t = `${ x   }`;');

eq('string inside ${} keeps its slashes',
  stripJs('const t = `${ f("//keep") }`;'),
  'const t = `${ f("//keep") }`;');

eq('nested template inside ${}',
  stripJs('const t = `${ `in ${y} ner` }`;'),
  'const t = `${ `in ${y} ner` }`;');

eq('backtick inside a string is not a template',
  stripJs('const s = "a ` b"; // gone'),
  'const s = "a ` b"; ');

// --- ASI / line structure -----------------------------------------------------
eq('multi-line block comment leaves a newline',
  stripJs(`const a = 1\n/* x\ny */\nconst b = 2`),
  `const a = 1\n\n\nconst b = 2`);

eq('same-line block comment leaves a space',
  stripJs(`const a = /* x */ 1;`),
  `const a =   1;`);

eq('hashbang is preserved',
  stripJs(`#!/usr/bin/env node\n// gone\nx();`),
  `#!/usr/bin/env node\n\nx();`);

eq('trailing comment with no newline',
  stripJs(`x(); // gone`),
  `x(); `);

// --- CSS ----------------------------------------------------------------------
eq('css comment goes, url() stays',
  stripCss(`a{background:url("//cdn/x.png")} /* gone */`),
  `a{background:url("//cdn/x.png")}  `);   // two spaces: the original + the comment placeholder

// --- HTML ---------------------------------------------------------------------
eq('html comment alone on a line takes the line',
  stripHtml(`<p>a</p>\n  <!-- gone -->\n<p>b</p>`),
  `<p>a</p>\n<p>b</p>`);

eq('inline html comment leaves the line',
  stripHtml(`<p>a</p><!-- gone --><p>b</p>`),
  `<p>a</p><p>b</p>`);

eq('conditional comment is markup, kept',
  stripHtml(`<!--[if IE]><i></i><![endif]-->`),
  `<!--[if IE]><i></i><![endif]-->`);

eq('script body is stripped as js',
  stripHtml(`<script>var a=1; // gone\n</script>`),
  `<script>var a=1; \n</script>`);

eq('json script body is left alone',
  stripHtml(`<script type="application/json">{"u":"//keep"}</script>`),
  `<script type="application/json">{"u":"//keep"}</script>`);

eq('style body is stripped as css',
  stripHtml(`<style>a{color:red} /* gone */</style>`),
  `<style>a{color:red}  </style>`);

// --- tidy ---------------------------------------------------------------------
eq('tidy collapses blank runs but keeps indentation',
  tidy(`a\n\n\n\n  b`),
  `a\n\n  b`);

// --- the real files must still PARSE -----------------------------------------
// A stripper that produces valid-looking text that no longer parses is the worst
// outcome available, so this is checked directly rather than assumed.
const roundTrip = stripJs(`
  const obj = { a: 1 /* x */, b: "//y", c: \`t \${ 1 / 2 } u\` };
  export function f(n) { return n / 2; } // tail
`);
try {
  // eslint-disable-next-line no-new-func
  new Function(roundTrip.replace(/export\s+/g, ''));
  pass++;
} catch (e) {
  failures.push(`round-trip output does not parse: ${e.message}`);
}

console.log(`\nstrip-comments: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);

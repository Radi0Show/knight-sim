#!/usr/bin/env node
// Strip comments from the files a BROWSER receives, and only those.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A REGEX
//
// This project's source is ~45% comments by line, on purpose: the GML citations,
// the `ORIGINAL BUG:` markers and the "this was tried and reverted" notes are the
// most valuable thing in `sim/`. They must NEVER be deleted from source. But they
// are also served verbatim to anyone who opens DevTools, and there they are just
// noise. So the split is: source keeps every comment, the SHIPPED COPY keeps none.
//
// A regex cannot do this safely. `//` appears inside string literals and URLs, and
// `/` is division far more often than it opens a regex. This is a character scanner
// with explicit states (code / line comment / block comment / three string kinds /
// regex literal), and template literals carry a brace-depth stack so `${...}` can
// nest strings and templates inside itself to any depth.
//
// The `/` ambiguity is resolved the way every JS lexer resolves it: a `/` starts a
// regex only when the previous significant token cannot END an expression. When the
// previous token is an identifier, number, string, or a closing `) ] }`, it is
// division. `return`, `typeof`, `case` and friends are expression-starters, so a `/`
// after them opens a regex.
//
// SAFETY POSTURE: when in doubt, KEEP THE COMMENT. A retained comment is cosmetic;
// a corrupted file is a broken site. Callers verify the result independently --
// every output must still parse, and knight-sim's byte-exact suites must stay green.

const KEYWORDS_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);

// A `/` after one of these can only be division, because they end an expression.
function prevTokenEndsExpression(tok) {
  if (!tok) return false;
  if (tok === ')' || tok === ']' || tok === '}') return true;
  if (tok === 'STRING' || tok === 'TEMPLATE' || tok === 'REGEX' || tok === 'NUM') return true;
  if (/^[A-Za-z_$][\w$]*$/.test(tok)) return !KEYWORDS_BEFORE_REGEX.has(tok);
  return false;
}

// Consume one string literal starting at `start` (src[start] is the quote).
function readString(src, start) {
  const quote = src[start];
  const n = src.length;
  let i = start + 1;
  let text = quote;
  while (i < n) {
    const c = src[i];
    if (c === '\\') { text += c + (src[i + 1] ?? ''); i += 2; continue; }
    text += c;
    i++;
    if (c === quote) break;
  }
  return { text, next: i };
}

// Consume one template literal starting at `start` (src[start] is a backtick).
// Comments inside ${...} ARE stripped, which is why this recurses into stripJs.
function readTemplate(src, start) {
  const n = src.length;
  let i = start + 1;
  let text = '`';
  while (i < n) {
    const c = src[i];
    if (c === '\\') { text += c + (src[i + 1] ?? ''); i += 2; continue; }
    if (c === '`') { text += '`'; i++; break; }
    if (c === '$' && src[i + 1] === '{') {
      // Find the matching close brace, respecting nested strings/templates.
      let j = i + 2;
      let depth = 1;
      while (j < n && depth > 0) {
        const d = src[j];
        if (d === '"' || d === "'") { const s = readString(src, j); j = s.next; continue; }
        if (d === '`') { const t = readTemplate(src, j); j = t.next; continue; }
        if (d === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j++; continue; }
        if (d === '/' && src[j + 1] === '*') {
          j += 2;
          while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++;
          j += 2;
          continue;
        }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        j++;
      }
      const inner = src.slice(i + 2, j - 1);
      text += '${' + stripJs(inner) + '}';
      i = j;
      continue;
    }
    text += c;
    i++;
  }
  return { text, next: i };
}

export function stripJs(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  let prevTok = null;

  // A hashbang is not a comment for our purposes -- removing it breaks execution.
  if (src.startsWith('#!')) {
    const nl = src.indexOf('\n');
    if (nl === -1) return src;
    out += src.slice(0, nl + 1);
    i = nl + 1;
  }

  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    // ---- comments -------------------------------------------------------
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;                                    // the newline itself survives
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      let sawNewline = false;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') sawNewline = true;
        i++;
      }
      i += 2;
      // A block comment spanning lines must leave a newline behind, or the code
      // on either side joins into one line and ASI can change what it means.
      out += sawNewline ? '\n' : ' ';
      continue;
    }

    // ---- strings --------------------------------------------------------
    if (c === '"' || c === "'") {
      const s = readString(src, i);
      out += s.text;
      i = s.next;
      prevTok = 'STRING';
      continue;
    }

    // ---- template literals ----------------------------------------------
    if (c === '`') {
      const t = readTemplate(src, i);
      out += t.text;
      i = t.next;
      prevTok = 'TEMPLATE';
      continue;
    }

    // ---- regex literal --------------------------------------------------
    if (c === '/' && !prevTokenEndsExpression(prevTok)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;                     // unterminated => not a regex
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { closed = true; break; }
        j++;
      }
      if (closed) {
        j++;
        while (j < n && /[gimsuyvd]/.test(src[j])) j++;
        out += src.slice(i, j);
        i = j;
        prevTok = 'REGEX';
        continue;
      }
      // Not a regex after all -- fall through and treat it as an operator.
    }

    // ---- ordinary code --------------------------------------------------
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { out += c; i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      out += word;
      prevTok = word;
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i;
      while (j < n && /[\w.]/.test(src[j])) j++;
      out += src.slice(i, j);
      prevTok = 'NUM';
      i = j;
      continue;
    }
    out += c;
    prevTok = c;
    i++;
  }
  return out;
}

export function stripCss(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      let nl = false;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') nl = true;
        i++;
      }
      i += 2;
      out += nl ? '\n' : ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      const s = readString(src, i);
      out += s.text;
      i = s.next;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// HTML: strip `<!-- -->`, and hand <script>/<style> bodies to the right stripper.
// A conditional comment (`<!--[if`) is markup, not a note, so it is left alone.
export function stripHtml(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      if (end === -1) break;                       // unterminated: drop the rest
      if (src.startsWith('<!--[if', i)) {
        out += src.slice(i, end + 3);
        i = end + 3;
        continue;
      }
      // If the comment was alone on its line, take the whole line with it.
      const lineStart = out.lastIndexOf('\n') + 1;
      const before = out.slice(lineStart);
      let k = end + 3;
      while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
      if (before.trim() === '' && src[k] === '\n') {
        out = out.slice(0, lineStart);
        i = k + 1;
      } else {
        i = end + 3;
      }
      continue;
    }
    const lower = src.slice(i, i + 8).toLowerCase();
    if (lower.startsWith('<script')) {
      const open = src.indexOf('>', i);
      const close = src.toLowerCase().indexOf('</script', open);
      if (open === -1 || close === -1) { out += src[i]; i++; continue; }
      const tag = src.slice(i, open + 1);
      const body = src.slice(open + 1, close);
      // JSON payloads are data, not code -- a `//` in one is content.
      const isJson = /type\s*=\s*["']?(application\/json|application\/ld\+json)/i.test(tag);
      out += tag + (isJson ? body : stripJs(body));
      i = close;
      continue;
    }
    if (lower.startsWith('<style')) {
      const open = src.indexOf('>', i);
      const close = src.toLowerCase().indexOf('</style', open);
      if (open === -1 || close === -1) { out += src[i]; i++; continue; }
      out += src.slice(i, open + 1) + stripCss(src.slice(open + 1, close));
      i = close;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

// Collapse the blank lines a stripped comment leaves behind, without touching
// indentation inside the code itself.
export function tidy(text) {
  return text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}

export function stripByExt(src, ext) {
  if (ext === '.js' || ext === '.mjs') return tidy(stripJs(src));
  if (ext === '.css') return tidy(stripCss(src));
  if (ext === '.html' || ext === '.htm') return tidy(stripHtml(src));
  return src;
}

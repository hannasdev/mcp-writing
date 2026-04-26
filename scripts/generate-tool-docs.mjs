#!/usr/bin/env node
/**
 * Generates docs/tools.md from tool definitions in index.js and tools/*.js.
 *
 * Run:  node scripts/generate-tool-docs.mjs
 *   or: npm run docs
 *
 * The output is the single source of truth for the tool reference.
 * Re-run after editing tool names, descriptions, or parameters.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = path.join(ROOT, 'docs', 'tools.md');

// Read index.js first (order matters: index.js tool order defines doc order)
// then append any tool modules from tools/ so extracted tools are included.
const toolModules = (() => {
  try {
    return readdirSync(path.join(ROOT, 'tools'))
      .filter(f => f.endsWith('.js'))
      .sort()
      .map(f => readFileSync(path.join(ROOT, 'tools', f), 'utf8'));
  } catch {
    return [];
  }
})();

const source = [readFileSync(path.join(ROOT, 'index.js'), 'utf8'), ...toolModules].join('\n');

function decodeEscape(src, i) {
  const esc = src[i];

  if (esc === undefined) {
    return { value: '', end: i };
  }

  switch (esc) {
    case 'n': return { value: '\n', end: i + 1 };
    case 'r': return { value: '\r', end: i + 1 };
    case 't': return { value: '\t', end: i + 1 };
    case 'b': return { value: '\b', end: i + 1 };
    case 'f': return { value: '\f', end: i + 1 };
    case 'v': return { value: '\v', end: i + 1 };
    case '0': return { value: '\0', end: i + 1 };
    case '\\': return { value: '\\', end: i + 1 };
    case '"': return { value: '"', end: i + 1 };
    case "'": return { value: "'", end: i + 1 };
    case '`': return { value: '`', end: i + 1 };
    case 'x': {
      const hex = src.slice(i + 1, i + 3);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) {
        return { value: String.fromCodePoint(Number.parseInt(hex, 16)), end: i + 3 };
      }
      return { value: 'x', end: i + 1 };
    }
    case 'u': {
      if (src[i + 1] === '{') {
        const close = src.indexOf('}', i + 2);
        const codePoint = close === -1 ? '' : src.slice(i + 2, close);
        if (/^[0-9a-fA-F]+$/.test(codePoint)) {
          return { value: String.fromCodePoint(Number.parseInt(codePoint, 16)), end: close + 1 };
        }
      } else {
        const hex = src.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          return { value: String.fromCodePoint(Number.parseInt(hex, 16)), end: i + 5 };
        }
      }
      return { value: 'u', end: i + 1 };
    }
    default:
      return { value: esc, end: i + 1 };
  }
}

function readQuotedLiteral(src, i, quote) {
  let str = '';

  while (i < src.length) {
    if (src[i] === '\\') {
      const decoded = decodeEscape(src, i + 1);
      str += decoded.value;
      i = decoded.end;
      continue;
    }
    if (src[i] === quote) {
      return { text: str, end: i + 1 };
    }
    str += src[i++];
  }

  return { text: str, end: i };
}

function readTemplateExpression(src, i) {
  const start = i;
  let depth = 1;

  while (i < src.length && depth > 0) {
    const ch = src[i];

    if (ch === '"' || ch === "'") {
      i = skipString(src, i + 1, ch);
      continue;
    }
    if (ch === '`') {
      i = skipString(src, i + 1, ch);
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    i++;
  }

  return { text: src.slice(start, i - 1).trim(), end: i };
}

function extractConstantValues(src) {
  const values = new Map();

  for (const match of src.matchAll(/const\s+(\w+)\s*=\s*parseInt\([^\n]*\?\?\s*"([^"]+)"[^\n]*\);/g)) {
    values.set(match[1], Number.parseInt(match[2], 10));
  }

  for (const match of src.matchAll(/const\s+(\w+)\s*=\s*process\.env\.\w+\s*\?\?\s*(["'`])([\s\S]*?)\2;/g)) {
    if (!values.has(match[1])) {
      values.set(match[1], match[3]);
    }
  }

  for (const match of src.matchAll(/const\s+(\w+)\s*=\s*(\d+|true|false);/g)) {
    if (!values.has(match[1])) {
      const raw = match[2];
      values.set(match[1], raw === 'true' ? true : raw === 'false' ? false : Number.parseInt(raw, 10));
    }
  }

  return values;
}

const constantValues = extractConstantValues(source);

// ---------------------------------------------------------------------------
// Step 1: Extract raw text of each s.tool(...) call
// ---------------------------------------------------------------------------

/**
 * Walk `src` from `start`, skipping over a quoted string (the opening quote
 * character at `src[start]` is already consumed — cursor is just inside it).
 * Returns the index just past the closing quote.
 */
function skipString(src, i, quote) {
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * Returns an array of raw block strings, one per s.tool() registration.
 * Each block covers from 's' of 's.tool(' to the matching ')'.
 */
function extractToolBlocks(src) {
  const blocks = [];
  const re = /\bs\.tool\(/g;
  let m;

  while ((m = re.exec(src)) !== null) {
    let depth = 0;
    let j = m.index + m[0].length - 1; // position of the opening '('

    while (j < src.length) {
      const ch = src[j];
      if      (ch === '(')                    depth++;
      else if (ch === ')')                    { depth--; if (depth === 0) break; }
      else if (ch === '"' || ch === "'")      { j = skipString(src, j + 1, ch) - 1; }
      else if (ch === '`')                    { j = skipString(src, j + 1, '`') - 1; }
      j++;
    }

    blocks.push(src.substring(m.index, j + 1));
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Step 2: Parse a tool block into { name, description, params }
// ---------------------------------------------------------------------------

/**
 * Extracts the first N string literal values from `src` (in order).
 */
function extractStringArgs(src, count) {
  const results = [];
  let i = 0;
  while (i < src.length && results.length < count) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const { text, end } = readQuotedLiteral(src, i + 1, ch);
      results.push(text);
      i = end;
    } else if (ch === '`') {
      const { text, end } = readTemplateLiteral(src, i + 1);
      results.push(text);
      i = end;
    } else {
      i++;
    }
  }
  return results;
}

/**
 * Finds the balanced {…} block that starts at or after `fromIndex` in `src`,
 * skipping strings and other brackets. Returns { text, end } or null.
 */
function extractBalancedBraces(src, fromIndex) {
  let i = fromIndex;
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length) return null;

  const start = i;
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if      (ch === '{')                    depth++;
    else if (ch === '}')                    { depth--; if (depth === 0) { i++; break; } }
    else if (ch === '"' || ch === "'")      { i = skipString(src, i + 1, ch) - 1; }
    else if (ch === '`')                    { i = skipString(src, i + 1, '`') - 1; }
    i++;
  }

  return { text: src.substring(start, i), end: i };
}

function readTemplateLiteral(src, i) {
  let str = '';
  while (i < src.length) {
    if (src[i] === "\\") {
      const decoded = decodeEscape(src, i + 1);
      str += decoded.value;
      i = decoded.end;
      continue;
    }
    if (src[i] === '$' && src[i + 1] === '{') {
      const { text, end } = readTemplateExpression(src, i + 2);
      const value = constantValues.get(text);
      str += value === undefined ? `\${${text}}` : String(value);
      i = end;
      continue;
    }
    if (src[i] === '`') return { text: str, end: i + 1 };
    str += src[i++];
  }
  return { text: str, end: i };
}

/**
 * Finds the position in `block` right after the 2nd string argument + comma.
 * Used to locate where the schema object begins.
 */
function posAfterTwoStringArgs(block) {
  // Skip "s.tool("
  let i = block.indexOf('s.tool(') + 7;
  let count = 0;
  while (i < block.length && count < 2) {
    const ch = block[i];
    if (ch === '"' || ch === "'") {
      i = skipString(block, i + 1, ch);
      count++;
    } else if (ch === '`') {
      const { end } = readTemplateLiteral(block, i + 1);
      i = end;
      count++;
    } else {
      i++;
    }
  }
  return i; // points to content after the description string
}

/**
 * Splits a schema text {…} at top-level commas (not inside nested brackets or
 * strings), yielding one string per top-level parameter declaration.
 * Multi-line z.object({…}) params are returned as a single string.
 */
function splitTopLevelParams(schemaText) {
  const sections = [];
  // Skip the outer { }
  const inner = schemaText.slice(1, schemaText.length - 1);

  let depth = 0;      // {} depth
  let pdepth = 0;     // () depth
  let adepth = 0;     // [] depth
  let sectionStart = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if      (ch === '"' || ch === "'") { i = skipString(inner, i + 1, ch) - 1; }
    else if (ch === '`')               { i = skipString(inner, i + 1, '`') - 1; }
    else if (ch === '{')  depth++;
    else if (ch === '}')  depth--;
    else if (ch === '(')  pdepth++;
    else if (ch === ')')  pdepth--;
    else if (ch === '[')  adepth++;
    else if (ch === ']')  adepth--;
    else if (ch === ',' && depth === 0 && pdepth === 0 && adepth === 0) {
      const text = inner.substring(sectionStart, i).trim();
      if (text) sections.push(text);
      sectionStart = i + 1;
    }
  }

  // Push whatever remains after the last comma
  const tail = inner.substring(sectionStart).trim();
  if (tail) sections.push(tail);

  return sections.filter(s => /^\w/.test(s)); // skip blank/whitespace chunks
}

/**
 * Derives a display type string from a Zod chain.
 * Works on the raw text of a single parameter declaration.
 */
function zodTypeString(text) {
  // Extract the base type: z.TYPE(
  const base = (text.match(/z\.(\w+)\(/) ?? [])[1] ?? 'unknown';

  if (base === 'number') {
    return /\.int\(\)/.test(text) ? 'integer' : 'number';
  }
  if (base === 'array') {
    const inner = (text.match(/z\.array\(\s*z\.(\w+)\(\)/) ?? [])[1];
    return inner ? `${inner}[]` : 'array';
  }
  if (base === 'object') return 'object';
  if (base === 'boolean') return 'boolean';
  if (base === 'string') return 'string';
  if (base === 'enum') {
    const vals = (text.match(/z\.enum\(\[([^\]]+)\]/) ?? [])[1];
    return vals ? `enum(${vals.replace(/\s+/g, '')})` : 'enum';
  }
  return base;
}

/**
 * Parses the parameters from a schema text block.
 * Returns [{name, type, optional, description}].
 */
function parseParams(schemaText) {
  if (!schemaText) return [];
  const trimmed = schemaText.trim();
  if (trimmed === '{}') return [];

  const sections = splitTopLevelParams(schemaText);
  const params = [];

  for (const section of sections) {
    const nameMatch = section.match(/^([\w_]+)\s*:/);
    if (!nameMatch) continue;

    const name        = nameMatch[1];
    const type        = zodTypeString(section);
    const optional    = /\.optional\(\)/.test(section);

    // .describe("...") may be on any line of the section.
    // Use the *last* .describe() in the section so that z.object({...}).describe("outer")
    // wins over any .describe() calls on inner fields.
    // Use readQuotedLiteral so JS escape sequences (\u2019 etc.) are decoded, not left raw.
    let description = '';
    const descRe = /\.describe\("/g;
    let descMatch;
    while ((descMatch = descRe.exec(section)) !== null) {
      const { text } = readQuotedLiteral(section, descMatch.index + descMatch[0].length, '"');
      description = text; // keep iterating to get the last one
    }

    params.push({ name, type, optional, description });
  }

  return params;
}

/**
 * Parse a single tool block into { name, description, params }.
 */
function parseTool(block) {
  const [name, description] = extractStringArgs(block, 2);
  if (!name) return null;

  const schemaStart = posAfterTwoStringArgs(block);
  const schema = extractBalancedBraces(block, schemaStart);
  const params = schema ? parseParams(schema.text) : [];

  return { name, description, params };
}

// ---------------------------------------------------------------------------
// Step 3: Generate markdown
// ---------------------------------------------------------------------------

/** Converts a tool name to the GitHub heading slug used by this document. */
function anchor(name) {
  return name.toLowerCase();
}

function generateMarkdown(tools) {
  const lines = [
    '# Tool Reference',
    '',
    '> Auto-generated from `index.js`.',
    '> Do not edit manually — run `npm run docs` to regenerate.',
    '',
    '## Tools',
    '',
    ...tools.map(t => `- [\`${t.name}\`](#${anchor(t.name)})`),
    '',
    '---',
    '',
  ];

  for (const tool of tools) {
    lines.push(`## ${tool.name}`);
    lines.push('');
    lines.push(tool.description);
    lines.push('');

    if (tool.params.length === 0) {
      lines.push('_No parameters._');
    } else {
      lines.push('| Parameter | Type | Required | Description |');
      lines.push('| --- | --- | :---: | --- |');
      for (const p of tool.params) {
        const req  = p.optional ? 'No' : 'Yes';
        const desc = p.description.replace(/\|/g, '\\|'); // escape pipes
        lines.push(`| \`${p.name}\` | \`${p.type}\` | ${req} | ${desc} |`);
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const blocks = extractToolBlocks(source);
const tools  = blocks.map(parseTool).filter(Boolean);

mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
const md = generateMarkdown(tools);
writeFileSync(OUT, md, 'utf8');

const paramCounts = tools.map(t => `  ${t.name}: ${t.params.length} param(s)`);
console.log(`Generated ${OUT}`);
console.log(`  ${tools.length} tools documented`);
console.log(paramCounts.join('\n'));

/**
 * Static verification that does not need node_modules.
 *
 * Covers the failure modes that a syntax check misses and that would otherwise
 * only show up at runtime, in front of a diner:
 *
 *   1. every t('...') key used in the app exists in the English locale
 *   2. the Arabic locale has exactly the same key set as the English one
 *   3. every local import ('@/...' or relative) resolves to a real file
 *   4. every Tailwind colour class refers to a shade that exists in the config
 *   5. every Supabase table and column referenced in code exists in the schema
 *   6. every .rpc() name exists as a function in the migrations
 *
 *   node scripts/verify.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SRC = join(ROOT, 'src');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

function walk(dir, exts) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

const files = walk(SRC, ['.ts', '.tsx']);
const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const sql = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n');

/* ===================================================== 1 & 2: locale keys = */

console.log('\n[1/6] translation keys');

function flatten(obj, prefix = '', out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

/** Parse a locale .ts file into an object without executing it, by stripping
 *  the TS wrapper and evaluating the remaining object literal. */
function loadLocale(path) {
  const text = readFileSync(path, 'utf8');
  // anchor on the declaration, not the first brace: ar.ts opens with an
  // `import type { Translations }` line
  const decl = text.search(/^const \w+(?::\s*\w+)?\s*=\s*\{/m);
  if (decl < 0) throw new Error(`no locale object found in ${path}`);
  const start = text.indexOf('{', decl);
  const end = text.lastIndexOf('};');
  const body = text.slice(start, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${body});`)();
}

const en = loadLocale(join(SRC, 'locales', 'en.ts'));
const ar = loadLocale(join(SRC, 'locales', 'ar.ts'));

const enKeys = flatten(en);
const arKeys = flatten(ar);

for (const k of enKeys) if (!arKeys.has(k)) fail(`ar locale is missing key: ${k}`);
for (const k of arKeys) if (!enKeys.has(k)) fail(`en locale is missing key: ${k}`);

console.log(`  en keys: ${enKeys.size}, ar keys: ${arKeys.size}`);

/**
 * Keys built at runtime from a variable, e.g. t(`status.${o.status}`), checked
 * against the values the variable can actually hold.
 *
 * Only lookups with NO fallback are listed. The RPC error-code lookups
 * (t(`cart.${err}`) and friends) are deliberately excluded: every one of those
 * call sites compares the result to the key and substitutes a generic message
 * when i18next echoes it back, so an unmapped server error degrades to
 * "something went wrong" rather than leaking a raw key to a diner.
 */
const DYNAMIC_PREFIXES = {
  // order status badges and their explanatory lines
  'status.': [
    'pending', 'confirmed', 'preparing', 'ready', 'served', 'paid', 'cancelled',
    'pendingHint', 'confirmedHint', 'preparingHint', 'readyHint', 'servedHint',
    'paidHint', 'cancelledHint',
  ],
  // service_request_type values, rendered on the waiter board
  'waiter.': ['waiter', 'bill', 'water', 'cleaning', 'cutlery'],
  // kitchen column headings
  'kitchen.': ['confirmed', 'preparing', 'ready'],
  // loyalty tiers
  'loyalty.': ['bronze', 'silver', 'gold'],
  // role descriptions in the staff screen
  'admin.rolePermissions.': ['restaurant_admin', 'manager', 'waiter', 'kitchen', 'cashier'],
  // subscription_status, camel-cased
  'superAdmin.status': ['Trialing', 'Active', 'PastDue', 'Suspended', 'Cancelled'],
};

for (const [prefix, suffixes] of Object.entries(DYNAMIC_PREFIXES)) {
  for (const s of suffixes) {
    const key = `${prefix}${s}`;
    if (!enKeys.has(key)) fail(`dynamic key not in locale: ${key}`);
  }
}

// static t('...') / t("...") calls
const seenKeys = new Set();
for (const [file, text] of sources) {
  if (file.includes('/locales/')) continue;
  for (const m of text.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)) {
    seenKeys.add(m[1]);
    if (!enKeys.has(m[1])) fail(`${relative(SRC, file)}: unknown key t('${m[1]}')`);
  }
}
console.log(`  static t() keys referenced: ${seenKeys.size}`);

/* ========================================================== 3: imports === */

console.log('\n[2/6] local imports');

let importCount = 0;
for (const [file, text] of sources) {
  for (const m of text.matchAll(/from\s+['"]((?:@\/|\.\.?\/)[^'"]+)['"]/g)) {
    const spec = m[1];
    importCount++;
    const base = spec.startsWith('@/')
      ? join(SRC, spec.slice(2))
      : resolve(dirname(file), spec);

    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ];

    if (!candidates.some((c) => existsSync(c) && statSync(c).isFile())) {
      fail(`${relative(SRC, file)}: cannot resolve import '${spec}'`);
    }
  }
}
console.log(`  local imports resolved: ${importCount}`);

/* ================================================= 4: tailwind colours === */

console.log('\n[3/6] tailwind colour shades');

const tw = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');

/** Pull the shade keys defined for each custom palette. */
function shadesOf(name) {
  const re = new RegExp(`${name}:\\s*\\{([^}]*)\\}`, 's');
  const block = tw.match(re);
  if (!block) return null;
  return new Set(Array.from(block[1].matchAll(/(\d+):/g), (m) => m[1]));
}

const PALETTES = { ink: shadesOf('ink'), brand: shadesOf('brand'), gold: shadesOf('gold') };
const UTILITIES = ['bg', 'text', 'border', 'ring', 'divide', 'from', 'to', 'via', 'fill', 'stroke', 'shadow', 'outline', 'decoration', 'accent', 'caret', 'placeholder'];

let shadeChecks = 0;
for (const [file, text] of sources) {
  for (const [palette, shades] of Object.entries(PALETTES)) {
    if (!shades) {
      fail(`tailwind.config.js: palette '${palette}' not found`);
      continue;
    }
    const re = new RegExp(`\\b(?:${UTILITIES.join('|')})-${palette}-(\\d+)`, 'g');
    for (const m of text.matchAll(re)) {
      shadeChecks++;
      if (!shades.has(m[1])) {
        fail(`${relative(SRC, file)}: ${palette}-${m[1]} is not a defined shade`);
      }
    }
  }
}
console.log(`  colour class references checked: ${shadeChecks}`);

/* ============================================ 5: tables and columns ====== */

console.log('\n[4/6] database tables');

/** table name -> Set of column names, parsed from the CREATE TABLE statements */
const schema = new Map();
for (const m of sql.matchAll(
  /create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/gi,
)) {
  const [, table, body] = m;
  const cols = new Set();
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('--')) continue;
    // skip table-level constraints
    if (/^(primary key|unique|constraint|check|foreign key)\b/i.test(t)) continue;
    const col = t.match(/^(\w+)\s/);
    if (col) cols.add(col[1]);
  }
  schema.set(table, cols);
}

console.log(`  tables in schema: ${schema.size}`);

const usedTables = new Set();
for (const [file, text] of sources) {
  for (const m of text.matchAll(/\.from\(\s*['"](\w+)['"]\s*\)/g)) {
    const table = m[1];
    usedTables.add(table);
    // storage buckets are not database tables
    if (text.includes(`.storage.from('${table}')`)) continue;
    if (!schema.has(table)) {
      fail(`${relative(SRC, file)}: .from('${table}') — no such table in migrations`);
    }
  }
}
console.log(`  tables referenced in code: ${usedTables.size}`);

// .eq('col', ...) / .order('col') against the table of the same chain
console.log('\n[5/6] column references');

let colChecks = 0;
for (const [file, text] of sources) {
  // Split each file on .from('table') so a chain is attributed to its own
  // query. Scanning forward by character count instead would bleed across the
  // sibling queries inside a Promise.all([...]) and blame one table for
  // another's columns.
  const parts = text.split(/\.from\(\s*['"](\w+)['"]\s*\)/);

  // parts = [before, table1, chain1, table2, chain2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const table = parts[i];
    const chain = parts[i + 1] ?? '';
    const cols = schema.get(table);
    if (!cols) continue;

    // a chain ends at the statement end; stop at the first blank line too
    const scope = chain.split(/;\s*\n|\n\s*\n/)[0];

    for (const c of scope.matchAll(
      /\.(?:eq|neq|gt|gte|lt|lte|is|in|like|ilike|order)\(\s*['"]([\w.]+)['"]/g,
    )) {
      const col = c[1];
      if (col.includes('.')) continue; // filter on an embedded resource
      colChecks++;
      if (!cols.has(col)) {
        fail(`${relative(SRC, file)}: ${table}.${col} is not a column`);
      }
    }

    // also validate the explicit column lists passed to .select('a,b,c')
    const sel = scope.match(/^\s*\.select\(\s*['"]([^'"]+)['"]/);
    if (sel && !sel[1].includes('*') && !sel[1].includes('(')) {
      for (const col of sel[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        colChecks++;
        if (!cols.has(col)) {
          fail(`${relative(SRC, file)}: ${table}.${col} in select() is not a column`);
        }
      }
    }
  }
}
console.log(`  column references checked: ${colChecks}`);

/* ================================================================ 6: rpc = */

console.log('\n[6/6] rpc functions');

const sqlFns = new Set(
  Array.from(
    sql.matchAll(/create or replace function public\.(\w+)/gi),
    (m) => m[1].toLowerCase(),
  ),
);

const usedRpc = new Set();
for (const [file, text] of sources) {
  for (const m of text.matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) {
    usedRpc.add(m[1]);
    if (!sqlFns.has(m[1].toLowerCase())) {
      fail(`${relative(SRC, file)}: .rpc('${m[1]}') — no such function in migrations`);
    }
  }
}
console.log(`  functions defined: ${sqlFns.size}, rpc calls referenced: ${usedRpc.size}`);

/* Check the parameter names each rpc call passes against the function signature */
let paramChecks = 0;
for (const [file, text] of sources) {
  for (const m of text.matchAll(/\.rpc\(\s*['"](\w+)['"]\s*,\s*\{([\s\S]{0,500}?)\}\s*\)/g)) {
    const [, fn, argBlock] = m;
    const sig = sql.match(
      new RegExp(`create or replace function public\\.${fn}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, 'i'),
    );
    if (!sig) continue;

    const declared = new Set(
      Array.from(sig[1].matchAll(/(p_\w+)\s/g), (x) => x[1]),
    );

    for (const a of argBlock.matchAll(/(?:^|[\s,{])(p_\w+)\s*:/g)) {
      paramChecks++;
      if (!declared.has(a[1])) {
        fail(`${relative(SRC, file)}: ${fn}() has no parameter ${a[1]}`);
      }
    }
  }
}
console.log(`  rpc parameter names checked: ${paramChecks}`);

/* ===================================================================== == */

console.log(
  failures === 0
    ? `\n✓ all static checks passed across ${files.length} source files\n`
    : `\n✗ ${failures} problem(s) found\n`,
);

process.exit(failures === 0 ? 0 : 1);

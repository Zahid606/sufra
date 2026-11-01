/**
 * Parse-checks every .ts / .tsx file in src/ and reports syntax diagnostics.
 *
 * This is a fallback for environments where `npm install` is unavailable, so
 * the real `tsc --noEmit` (which needs @types/react and friends) cannot run.
 * It catches syntax, JSX and generic-parsing errors, not type errors.
 *
 *   node scripts/syntaxcheck.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require_ = createRequire(import.meta.url);

function loadTypeScript() {
  try {
    return require_('typescript');
  } catch {
    // fall back to a globally installed copy
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require_(join(globalRoot, 'typescript'));
  }
}

const ts = loadTypeScript();
const SRC = new URL('../src', import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(SRC).sort();
let errors = 0;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // parseDiagnostics is internal but stable, and is the only way to read
  // syntax errors without constructing a full Program
  const diags = sf.parseDiagnostics ?? [];

  if (diags.length) {
    errors += diags.length;
    console.log(`\n✗ ${relative(SRC, file)}`);
    for (const d of diags) {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      console.log(`    ${line + 1}:${character + 1}  ${msg}`);
    }
  }
}

console.log(
  errors === 0
    ? `\n✓ ${files.length} files parsed with no syntax errors`
    : `\n✗ ${errors} syntax error(s) across ${files.length} files`,
);

process.exit(errors === 0 ? 0 : 1);

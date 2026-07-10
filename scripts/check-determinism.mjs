// Determinism guard (netplay): sim code must not use nondeterministic or
// engine-varying APIs. Runs as part of `npm run check`.
//
// Rules inside SIM FILES (entities/ai/combat/physics + GameplayScreen):
//   1. No Math.random / Date.now / performance.now — sim randomness comes from
//      the seeded streams in src/core/rng.ts; sim has no wall-clock.
//   2. No raw Math transcendentals (sin/cos/tan/atan2/asin/acos/exp/pow/hypot/
//      log*) — engines differ in the last ulps; use src/core/simmath.ts.
// A line may opt out with a `det-ok` comment ONLY when it provably feeds view/
// audio work (pose blending, particle placement, mesh rotation) — never state.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SIM_PATHS = [
  'src/entities',
  'src/ai',
  'src/combat',
  'src/physics',
  'src/screens/GameplayScreen.ts',
];

const BANNED = [
  { re: /\bMath\.random\s*\(/, why: 'Math.random in sim — use ctx.rng streams (core/rng.ts)' },
  { re: /\bDate\.now\s*\(/, why: 'Date.now in sim — sim has no wall-clock' },
  { re: /\bperformance\.now\s*\(/, why: 'performance.now in sim — sim has no wall-clock' },
  {
    re: /\bMath\.(sin|cos|tan|atan2|asin|acos|exp|pow|hypot|log2|log10|log1p|log|cbrt|expm1)\s*\(/,
    why: 'raw Math transcendental in sim — use core/simmath.ts (engine-varying ulps)',
  },
];

function* walk(path) {
  const st = statSync(path);
  if (st.isFile()) {
    if (path.endsWith('.ts')) yield path;
    return;
  }
  for (const name of readdirSync(path)) yield* walk(join(path, name));
}

const failures = [];
for (const simPath of SIM_PATHS) {
  for (const file of walk(join(ROOT, simPath))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.includes('det-ok')) continue;
      for (const { re, why } of BANNED) {
        if (re.test(line)) {
          failures.push(`${relative(ROOT, file)}:${i + 1}  ${why}\n    ${line.trim()}`);
        }
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`\nDeterminism guard FAILED (${failures.length}):\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error(
    'Fix: draw from ctx.rng / use core/simmath.ts — or, for provably view-only\n' +
      'lines, append a `// det-ok: view-only` comment.\n',
  );
  process.exit(1);
}
console.log('determinism guard: clean');

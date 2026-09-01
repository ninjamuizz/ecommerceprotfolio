// Ad-hoc runner for build-check.ts against the REAL repo (read/build only,
// never mutates source). Run with: node scripts/test-build-check.ts
import { runBuildCheck } from '../src/lib/build-check.ts';

const result = await runBuildCheck();
console.log(JSON.stringify({ ...result, rawOutput: undefined }, null, 2));
console.log('\n--- rawOutput tail (last 2000 chars) ---');
console.log(result.rawOutput.slice(-2000));

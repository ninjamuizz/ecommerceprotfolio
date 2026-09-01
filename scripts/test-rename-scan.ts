// Standalone smoke test for src/lib/rename-scan.ts — no build step required.
// Run with:  node scripts/test-rename-scan.ts
import { scanForRename } from '../src/lib/rename-scan.ts';

const result = scanForRename({
  oldName: 'American Strawberry',
  categorySlug: 'cane-sugar-syrups',
  slug: 'american-strawberry',
});

console.log(JSON.stringify(result, null, 2));
console.error(
  `\n--- summary --- filesScanned=${result.filesScanned} hits=${result.hits.length} slugRefs=${result.slugReferences.length}`,
);

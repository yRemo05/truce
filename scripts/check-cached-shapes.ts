/**
 * Parses every recorded Qloo response in .qloo-cache/ (local only, never
 * committed) with Truce's schemas, so a shape change in the live API shows
 * up as a failed parse here before it shows up in a negotiation.
 * Run after `npm run probe`: `npx tsx scripts/check-cached-shapes.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { insightsResponseSchema, searchResponseSchema, fromInsights, fromSearch } from '../src/qloo/schemas';

const root = '.qloo-cache';
let parsed = 0;
let failed = 0;
for (const dir of readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory())) {
  for (const file of readdirSync(join(root, dir)).filter((f) => f.endsWith('.json'))) {
    const { url, status, body } = JSON.parse(readFileSync(join(root, dir, file), 'utf8'));
    if (status !== 200) continue;
    const isSearch = url.startsWith('/search') || url.startsWith('/entities');
    const isEntityInsights = url.startsWith('/v2/insights') && !url.includes('urn%3Atag');
    if (!isSearch && !isEntityInsights) continue;
    const result = (isSearch ? searchResponseSchema : insightsResponseSchema).safeParse(body);
    if (!result.success) {
      failed++;
      console.log(`FAIL  ${dir}/${file}\n${result.error.message.slice(0, 600)}`);
      continue;
    }
    parsed++;
    const entities = isSearch
      ? (result.data as any).results.map(fromSearch)
      : (result.data as any).results.entities.map(fromInsights);
    const e = entities[0];
    if (e) console.log(`ok    ${dir}/${file}  ${e.kind}  ${e.name}  pop=${e.popularity?.toFixed(3)}  facts=${Object.keys(e.facts).join(',') || '-'}  drivers=${e.drivers?.length ?? '-'}`);
  }
}
console.log(`\n${parsed} parsed, ${failed} failed`);
process.exit(failed ? 1 : 0);

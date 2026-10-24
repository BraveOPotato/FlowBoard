// Offline only. Run npm run repair:board -- --help. Never uploads or changes inputs.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { repairExport } from '../src/services/repair.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run repair:board -- CURRENT.json REPAIRED.json [--baseline BEFORE.json] [--deleted-unless-restored] [--delete CARD_ID] [--keep CARD_ID]');
    console.log('Creates an importable snapshot and REPAIRED.report.json. Ambiguous cases require review; no live boards are changed.');
    console.log('--deleted-unless-restored explicitly treats deletes as effective until a later create/Undo; use only for known ticket-resurrection corruption.');
    return;
  }
  const [currentPath, outputPath, ...options] = args;
  if (!currentPath || !outputPath || currentPath.startsWith('--') || outputPath.startsWith('--')) throw new Error('Specify CURRENT.json and REPAIRED.json; use --help for options.');
  let baselinePath;
  let deletedUntilRestored = false;
  const decisions = {};
  for (let i = 0; i < options.length; i++) {
    const flag = options[i];
    if (flag === '--deleted-unless-restored') { deletedUntilRestored = true; continue; }
    const value = options[++i];
    if (!value || !['--baseline', '--delete', '--keep'].includes(flag)) throw new Error(`Invalid option: ${flag}`);
    if (flag === '--baseline') baselinePath = value;
    else {
      const decision = flag === '--delete' ? 'delete' : 'keep';
      if (Object.hasOwn(decisions, value) && decisions[value] !== decision) throw new Error(`Conflicting decisions for ${value}.`);
      Object.defineProperty(decisions, value, { value: decision, enumerable: true, configurable: true });
    }
  }
  const reportPath = outputPath.replace(/\.json$/i, '') + '.report.json';
  const inputs = [currentPath, ...(baselinePath ? [baselinePath] : [])];
  if (inputs.some(p => [resolve(outputPath), resolve(reportPath)].includes(resolve(p)))) throw new Error('Outputs must not replace an input.');
  for (const path of [outputPath, reportPath]) if (existsSync(path)) throw new Error(`Output already exists: ${path}. Choose a new filename.`);
  const sources = await Promise.all(inputs.map(async path => {
    const bytes = await readFile(path);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex'), data: JSON.parse(bytes.toString('utf8')) };
  }));
  const { data, report } = repairExport(sources[0].data, sources[1]?.data, decisions, { deletedUntilRestored });
  const output = JSON.stringify(data, null, 2) + '\n';
  const audit = { ...report, sources: sources.map(({ path, sha256 }) => ({ path, sha256 })),
    output: { path: outputPath, sha256: createHash('sha256').update(output).digest('hex') } };
  // Exclusive writes: never overwrite a source, an earlier repair, or somebody else's file.
  await writeFile(reportPath, JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
  await writeFile(outputPath, output, { flag: 'wx' });
  for (const board of report.summary) console.log(`${board.name}: ${board.currentCards} → ${board.repairedCards} cards; ${board.deletedCards} deleted, ${board.movedCards} column corrections, ${board.reviewItems} review items.`);
  console.log(`Repaired snapshot: ${outputPath}\nAudit report: ${reportPath}`);
  if (report.review.length) console.log('Review the flagged cases before using Settings → Advanced → Overwrite import.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

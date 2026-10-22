/**
 * batch/sync-pipeline-to-input.mjs — tops up batch-input.tsv from data/pipeline.md.
 *
 * batch-input.tsv is documented in batch/README.md as a file the user creates,
 * kept separate from pipeline.md on purpose — copying a row into batch-input.tsv
 * is not a "processed" event, so pipeline.md is never trimmed here. This script
 * closes the gap between the two lists.
 */
import { computeAdditions } from '../batch/sync-pipeline-to-input.mjs';
import { pass, fail } from './helpers.mjs';

console.log('\nsync-pipeline-to-input.mjs — batch-input.tsv top-up from pipeline.md');

const HEADER = 'id\turl\tsource\tnotes';

{
  const input = `${HEADER}\n1\thttps://a.example/1\tscan\tAcme - Role A\n`;
  const pipeline = [
    '# Pipeline',
    '- [ ] https://a.example/1 | Acme | Role A | Remote | posted: 2026-01-01',
    '- [ ] https://b.example/2 | Beta | Role B | Remote | posted: 2026-01-02',
  ].join('\n');
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 1 && additions[0].url === 'https://b.example/2' && additions[0].id === 2) {
    pass('a URL already in batch-input.tsv is not re-added; a genuinely new one is');
  } else {
    fail(`expected exactly one addition (id 2, b.example): got ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n5\thttps://x.example/5\tscan\tX - Role\n12\thttps://x.example/12\tscan\tX - Role2\n`;
  const pipeline = '- [ ] https://new.example/1 | New Co | Role | Remote | posted: 2026-01-01';
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 1 && additions[0].id === 13) {
    pass('new ids continue from the max existing id, not from the row count');
  } else {
    fail(`expected next id 13: got ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n`;
  const pipeline = [
    '- [ ] ~~https://dead.example/1 | Dead Co | Role | Remote | posted: 2026-01-01~~',
    '- [ ] https://live.example/2 | Live Co | Role | Remote | posted: 2026-01-01',
  ].join('\n');
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 1 && additions[0].url === 'https://live.example/2') {
    pass('an expired (strikethrough) pipeline entry is skipped, not added as a fresh offer');
  } else {
    fail(`expired entry leaked through: ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n`;
  const pipeline = [
    '- [ ] #-- | https://discarded.example/1 | skipped (dead link)',
    '- [ ] https://live.example/2 | Live Co | Role | Remote | posted: 2026-01-01',
  ].join('\n');
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 1 && additions[0].url === 'https://live.example/2') {
    pass('a pre-screen discard (#-- marker) is skipped, not added as a fresh offer');
  } else {
    fail(`discard entry leaked through: ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n`;
  const pipeline = [
    '- [ ] https://dup.example/1 | Co | Role A | Remote | posted: 2026-01-01',
    '- [ ] https://dup.example/1 | Co | Role A | Remote | posted: 2026-01-01',
  ].join('\n');
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 1) {
    pass('the same URL appearing twice within pipeline.md itself is only added once');
  } else {
    fail(`expected exactly one addition from a duplicated pipeline line: got ${additions.length}`);
  }
}

{
  const input = `${HEADER}\n1\thttps://a.example/1\tscan\tAcme - Role A\n`;
  const pipeline = '- [ ] https://a.example/1 | Acme | Role A | Remote | posted: 2026-01-01';
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 0) {
    pass('running against an already-synced pipeline.md adds nothing (idempotent)');
  } else {
    fail(`expected no additions on a fully-synced input: got ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n`;
  const pipeline = '- [ ] https://co.example/1 | Acme Co | Senior Data Scientist | NYC | posted: 2026-01-01';
  const { additions } = computeAdditions(pipeline, input);
  if (additions.length === 1 && additions[0].notes === 'Acme Co - Senior Data Scientist') {
    pass("notes column is built as '{company} - {role}', matching the existing batch-input.tsv convention");
  } else {
    fail(`notes format mismatch: ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n`;
  const { additions } = computeAdditions('', input);
  if (additions.length === 0) {
    pass('an empty pipeline.md (no checkbox lines) yields no additions, not a crash');
  } else {
    fail(`expected no additions from empty pipeline text: ${JSON.stringify(additions)}`);
  }
}

{
  const input = `${HEADER}\n1\thttps://a.example/1\tscan\tAcme - Role A\n`;
  const pipeline = '- [ ] https://b.example/2 | Beta | Role B';
  const { header, dataLines } = computeAdditions(pipeline, input);
  if (header === HEADER && dataLines.length === 1 && dataLines[0].includes('a.example/1')) {
    pass('the existing header and data rows are preserved unchanged, ready to be reassembled');
  } else {
    fail(`existing rows were not preserved correctly: header=${header} dataLines=${JSON.stringify(dataLines)}`);
  }
}

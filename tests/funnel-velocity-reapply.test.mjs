import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeVelocity, foldObservations, parseStatusLog } from '../funnel-velocity.mjs';
import { loadCanonicalStates } from '../tracker-utils.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STATES = loadCanonicalStates(join(ROOT, 'templates/states.yml'));
const velocityOf = (lines) => computeVelocity(
  foldObservations(parseStatusLog(lines.join('\n'), STATES).observations),
  '2026-10-22',
);

test('a re-application is measured from its own Applied date', () => {
  const lines = [];
  for (const [num, replyDay] of [[1, '03'], [2, '04'], [3, '05']]) {
    lines.push(
      `${num}\t2026-01-05\tEvaluated\tApplied\tset-status\t`,
      `${num}\t2026-01-20\tApplied\tRejected\tset-status\t`,
      `${num}\t2026-06-01\tRejected\tApplied\tset-status\t`,
      `${num}\t2026-06-${replyDay}\tApplied\tResponded\tset-status\t`,
    );
  }
  const velocity = velocityOf(lines);
  assert.equal(velocity.appliedToResponded.median, 3);
  assert.equal(velocity.appliedToRejected.median, 15);
});

test('a re-applied row with no reply yet counts as still waiting', () => {
  const velocity = velocityOf([
    '1\t2026-01-05\tEvaluated\tApplied\tset-status\t',
    '1\t2026-01-20\tApplied\tRejected\tset-status\t',
    '1\t2026-06-01\tRejected\tApplied\tset-status\t',
  ]);
  assert.equal(velocity.appliedToResponded.censored, 1);
});

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pass, fail } from './helpers.mjs';

function check(label, run) {
  try { run(); pass(label); } catch (error) { fail(`${label}: ${error.message}`); }
}

check('tailoring two same-company reports retains both application-specific CVs', () => {
  const root = mkdtempSync(join(tmpdir(), 'tailor-report-identity-'));
  try {
    mkdirSync(join(root, 'config'));
    mkdirSync(join(root, 'reports'));
    writeFileSync(join(root, 'config/profile.yml'), 'name: Jane Doe\n');
    writeFileSync(join(root, 'cv.md'), '# Jane Doe\nVerified experience.\n');
    const jd = join(root, 'jd.txt');
    writeFileSync(jd, 'A local test posting.');
    const stub = join(root, 'endpoint.cjs');
    writeFileSync(stub, `globalThis.fetch = async (url) => {
      if (String(url) !== 'http://127.0.0.1:7777/v1/chat/completions') throw new Error('Unexpected network request');
      return { ok: true, json: async () => ({ choices: [{ message: { content: process.env.TEST_TAILORED_HTML } }] }) };
    };`);
    const outputs = [];
    for (const number of ['001', '002']) {
      const report = join(root, 'reports', number + '-acme-2026-01-01.md');
      writeFileSync(report, '# Evaluation: Acme — Engineer\n\nTwo different requisitions.');
      const html = `<html><body>Verified CV for application ${number}</body></html>`;
      const result = spawnSync(process.execPath, ['--require', stub, 'openai-tailor.mjs', '--jd', jd, '--report', report, '--url', 'http://127.0.0.1:7777/v1', '--model', 'local-fixture'], {
        cwd: new URL('..', import.meta.url), encoding: 'utf8',
        env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: '', OPENAI_API_KEY: '', TEST_TAILORED_HTML: html },
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const path = result.stdout.match(/Tailored HTML saved: (.+)/)?.[1];
      assert.ok(path, result.stdout);
      outputs.push({ path, html, nextPdf: result.stdout.match(/node generate-pdf\.mjs .+ (output\/\S+\.pdf) --format/)?.[1] });
    }
    assert.notEqual(outputs[0].path, outputs[1].path, 'second report overwrote the first report CV');
    assert.notEqual(outputs[0].nextPdf, outputs[1].nextPdf, 'the suggested PDF outputs collide');
    assert.equal(readdirSync(join(root, 'output')).filter(name => name.endsWith('.html')).length, 2);
    for (const output of outputs) assert.equal(readFileSync(output.path, 'utf8'), output.html);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// doctor names why Chromium failed to launch instead of always saying "not
// installed". Only a missing binary is fixed by `npx playwright install
// chromium`; a binary that is present but cannot start (missing system
// libraries, a host that blocks the process) needs different advice, and the
// install command is a no-op there because the browser is already downloaded.
//
// The classifier is tested on the message shapes Playwright throws. doctor
// itself is driven with PLAYWRIGHT_BROWSERS_PATH pointing at a stub browser, so
// no real Chromium is launched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyChromiumLaunchError } from '../lib/chromium-launch-error.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DOCTOR = join(ROOT, 'doctor.mjs');
const NIXOS = existsSync('/etc/NIXOS');
// install-deps is apt-only, so doctor prescribes it only where apt is the
// package manager; elsewhere on Linux it names the distro's own.
const APT_ONLY_ELSEWHERE = process.platform === 'linux'
  && !(() => { try { return /^(?:ID|ID_LIKE)=.*\b(?:debian|ubuntu)\b/m.test(readFileSync('/etc/os-release', 'utf-8')); } catch { return false; } })();

test('a missing binary is classified as not installed', () => {
  const err = new Error("browserType.launch: Executable doesn't exist at /pw/chromium_headless_shell-1/chrome-headless-shell\n╔══╗\n║ npx playwright install ║");
  assert.deepEqual(classifyChromiumLaunchError(err), {
    kind: 'missing-executable',
    path: '/pw/chromium_headless_shell-1/chrome-headless-shell',
  });
});

test('a loader error in the browser logs is classified as missing libraries', () => {
  const err = new Error([
    'browserType.launch: Target page, context or browser has been closed',
    'Browser logs:',
    '',
    '<launching> /pw/chrome-headless-shell --disable-extensions --no-sandbox',
    '<launched> pid=7',
    '[pid=7][err] chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory',
    'Call log:',
    '  - [pid=7] <process did exit: exitCode=127, signal=null>',
  ].join('\n'));
  assert.deepEqual(classifyChromiumLaunchError(err), { kind: 'missing-libraries', libraries: ['libnss3.so'] });
});

test("Playwright's host-dependency box is classified as missing libraries, listing each one", () => {
  const err = new Error([
    'browserType.launch: ',
    '╔══════════════════════════════════════════════════════╗',
    '║ Host system is missing dependencies to run browsers. ║',
    '║ Missing libraries:                                   ║',
    '║     libgbm.so.1                                      ║',
    '║     libasound.so.2                                   ║',
    '╚══════════════════════════════════════════════════════╝',
  ].join('\n'));
  assert.deepEqual(classifyChromiumLaunchError(err), {
    kind: 'missing-libraries',
    libraries: ['libgbm.so.1', 'libasound.so.2'],
  });
});

test('any other failure keeps the browser stderr line, not the launch command line', () => {
  const err = new Error([
    'browserType.launch: Target page, context or browser has been closed',
    'Browser logs:',
    '<launching> /pw/chrome-headless-shell --no-sandbox',
    '<launched> pid=9',
    '[pid=9][err] [1021/101010.000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!',
    'Call log:',
  ].join('\n'));
  const cause = classifyChromiumLaunchError(err);
  assert.equal(cause.kind, 'launch-failed');
  assert.match(cause.detail, /No usable sandbox!/);
  assert.doesNotMatch(cause.detail, /--no-sandbox/);
});

test('a failure without browser logs falls back to the first line of the message', () => {
  const cause = classifyChromiumLaunchError(new Error('browserType.launch: Timeout 180000ms exceeded.\nCall log:\n  - <launching>'));
  assert.deepEqual(cause, { kind: 'launch-failed', detail: 'Timeout 180000ms exceeded.' });
});

// --- doctor end to end, against a stub browser ---------------------------------

// The headless-shell path Playwright launches under a given browsers dir, read
// from the "Executable doesn't exist" error it throws while that dir is empty.
function headlessShellPath(browsersDir) {
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { chromium } = await import('playwright');
    try { (await chromium.launch({ headless: true })).close(); } catch (e) { process.stdout.write(e.message); }
  `], { cwd: ROOT, encoding: 'utf-8', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir } });
  return probe.stdout.match(/Executable doesn't exist at (\S+)/)?.[1] ?? null;
}

function runDoctor(browsersDir) {
  const target = mkdtempSync(join(tmpdir(), 'co-doctor-chromium-target-'));
  try {
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: {} }));
    const run = spawnSync(process.execPath, [DOCTOR, '--target', target], {
      cwd: target,
      encoding: 'utf-8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersDir },
    });
    return run.stdout;
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
}

function chromiumLines(out) {
  const lines = out.split('\n');
  const i = lines.findIndex((line) => /Playwright chromium/.test(line));
  return i === -1 ? '' : lines.slice(i, i + 2).join('\n');
}

// A shell-script stub cannot stand in for the browser on Windows.
const posix = process.platform !== 'win32';

function withStubBrowser(stderrLine, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-chromium-'));
  try {
    const exe = headlessShellPath(dir);
    assert.ok(exe, 'could not learn the headless-shell path Playwright launches');
    mkdirSync(dirname(exe), { recursive: true });
    writeFileSync(exe, `#!/bin/sh\necho ${JSON.stringify(stderrLine)} >&2\nexit 127\n`);
    chmodSync(exe, 0o755);
    fn(chromiumLines(runDoctor(dir)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('doctor: no browser binary still reports not installed with the install command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'co-doctor-chromium-empty-'));
  try {
    const out = chromiumLines(runDoctor(dir));
    assert.match(out, /✗ Playwright chromium not installed/);
    if (!NIXOS) assert.match(out, /npx playwright install chromium/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('doctor: a binary that cannot load its libraries is not reported as not installed', { skip: !posix }, () => {
  withStubBrowser('chrome-headless-shell: error while loading shared libraries: libnss3.so: cannot open shared object file: No such file or directory', (out) => {
    assert.match(out, /✗ Playwright chromium is installed but cannot start: .*libnss3\.so/);
    assert.doesNotMatch(out, /not installed/);
    assert.doesNotMatch(out, /npx playwright install chromium/);
    if (APT_ONLY_ELSEWHERE) assert.match(out, /distribution's package manager/);
    else if (!NIXOS) assert.match(out, /npx playwright install-deps chromium/);
  });
});

test('doctor: any other launch failure shows the browser error and no install command', { skip: !posix }, () => {
  withStubBrowser('[1021/101010.000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox!', (out) => {
    assert.match(out, /✗ Playwright chromium is installed but failed to launch: .*No usable sandbox!/);
    assert.doesNotMatch(out, /not installed/);
    assert.doesNotMatch(out, /npx playwright install/);
  });
});

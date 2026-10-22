#!/usr/bin/env node
/**
 * sync-pipeline-to-input.mjs — top up batch-input.tsv from data/pipeline.md.
 *
 * batch/README.md documents batch-input.tsv as a file "you create" and warns
 * that it is a SEPARATE list from data/pipeline.md — copying rows
 * out of pipeline.md into batch-input.tsv is not itself a "processed" event,
 * so pipeline.md is never trimmed by this script (only reconcile-pipeline.mjs,
 * run by batch-runner.sh after a real evaluation, does that). Left unsynced,
 * a scan's new offers sit in pipeline.md invisible to every batch run.
 *
 * This script closes that gap. It is additive and idempotent: a second run
 * against an unchanged pipeline.md adds nothing.
 *
 * Skips the same two line shapes extractPipelineCompanyRole in scan.mjs
 * withholds a company/role pair for, so a dead or discarded entry cannot
 * seed a fresh-looking batch-input.tsv row:
 *   - expired entries (`~~…~~` strikethrough)
 *   - pre-screen discards (`#-- | {url} | skipped (...)`)
 *
 * Run: node batch/sync-pipeline-to-input.mjs [--dry-run]
 *      [--pipeline path] [--input path]
 */

import { readFileSync, writeFileSync, renameSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isMainModule } from '../lib/is-main-module.mjs';
import { getCareerOpsRoot } from '../path-resolver.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CAREER_OPS = getCareerOpsRoot();

const PIPELINE_CHECKBOX_STRICT_RE = /^- \[[ x]\]\s+/;
const PIPELINE_URL_RE = /https?:\/\/[^\s|]+/;

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    pipelinePath: join(CAREER_OPS, 'data/pipeline.md'),
    inputPath: join(CAREER_OPS, 'data/batch/batch-input.tsv'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') opts.dryRun = true;
    else if (argv[i] === '--pipeline') opts.pipelinePath = argv[++i];
    else if (argv[i] === '--input') opts.inputPath = argv[++i];
  }
  return opts;
}

/**
 * One pipeline.md checkbox line → { url, company, role } or null.
 * Mirrors extractPipelineUrl/extractPipelineCompanyRole in scan.mjs exactly,
 * duplicated rather than imported because those helpers are not exported and
 * this script's only dependency should be the stable line format, not
 * scan.mjs's internals.
 */
function parsePipelineLine(rawLine) {
  const line = rawLine.trim();
  if (!PIPELINE_CHECKBOX_STRICT_RE.test(line)) return null;
  const body = line.replace(PIPELINE_CHECKBOX_STRICT_RE, '');
  if (/~~.*~~/.test(body)) return null; // expired
  const cells = body.split('|').map((c) => c.trim());
  if (cells[0].startsWith('#--')) return null; // pre-screen discard
  const urlIndex = cells.findIndex((cell) => PIPELINE_URL_RE.test(cell));
  if (urlIndex === -1) return null;
  const urlMatch = cells[urlIndex].match(PIPELINE_URL_RE);
  if (!urlMatch) return null;
  const [company = '', role = ''] = cells.slice(urlIndex + 1);
  return { url: urlMatch[0], company: company.trim(), role: role.trim() };
}

export function computeAdditions(pipelineText, inputText) {
  const inputLines = inputText.split('\n').filter(Boolean);
  const header = inputLines[0] || 'id\turl\tsource\tnotes';
  const dataLines = inputLines.slice(1);

  const existingUrls = new Set();
  let maxId = 0;
  for (const line of dataLines) {
    const [id, url] = line.split('\t');
    if (url) existingUrls.add(url.trim());
    const n = Number(id);
    if (Number.isFinite(n) && n > maxId) maxId = n;
  }

  const additions = [];
  const seenThisRun = new Set();
  for (const rawLine of pipelineText.split('\n')) {
    const parsed = parsePipelineLine(rawLine);
    if (!parsed) continue;
    const { url, company, role } = parsed;
    if (existingUrls.has(url) || seenThisRun.has(url)) continue;
    seenThisRun.add(url);
    const notes = [company, role].filter(Boolean).join(' - ');
    additions.push({ id: ++maxId, url, source: 'scan', notes });
  }

  return { header, dataLines, additions };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.pipelinePath)) {
    console.error(`ERROR: ${opts.pipelinePath} not found.`);
    process.exit(1);
  }
  if (!existsSync(opts.inputPath)) {
    console.error(`ERROR: ${opts.inputPath} not found.`);
    process.exit(1);
  }

  const pipelineText = readFileSync(opts.pipelinePath, 'utf-8');
  const inputText = readFileSync(opts.inputPath, 'utf-8');
  const { header, dataLines, additions } = computeAdditions(pipelineText, inputText);

  console.log(`batch-input.tsv: ${dataLines.length} existing rows`);
  console.log(`pipeline.md: ${additions.length} new row(s) to add`);

  if (additions.length === 0) {
    console.log('Nothing to do — already in sync.');
    return;
  }

  if (opts.dryRun) {
    console.log('(dry run — no files written)');
    for (const a of additions.slice(0, 10)) {
      console.log(`  + ${a.id}\t${a.url}\t${a.source}\t${a.notes}`);
    }
    if (additions.length > 10) console.log(`  … ${additions.length - 10} more`);
    return;
  }

  const newLines = additions.map((a) => `${a.id}\t${a.url}\t${a.source}\t${a.notes}`);
  const out = [header, ...dataLines, ...newLines].join('\n') + '\n';
  const tmp = `${opts.inputPath}.tmp.${process.pid}`;
  writeFileSync(tmp, out);
  renameSync(tmp, opts.inputPath);
  console.log(`Added ${additions.length} row(s) to ${opts.inputPath} (ids ${additions[0].id}-${additions[additions.length - 1].id}).`);
}

// Main CLI execution guard (repo convention: lib/is-main-module.mjs, #3170)
if (isMainModule(import.meta.url) && process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
  console.log('Usage: node batch/sync-pipeline-to-input.mjs  (tops up data/batch/batch-input.tsv from data/pipeline.md; idempotent)');
} else if (isMainModule(import.meta.url)) {
  main();
}

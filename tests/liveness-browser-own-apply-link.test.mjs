// tests/liveness-browser-own-apply-link.test.mjs — checkUrlLiveness reads an
// Apply link to the posting's own page as an Apply control, even in the page
// chrome.
//
// The walk skips nav, header and footer, whose links are the site's own (Jobs,
// Careers, Sign in). Tech in Asia puts its only Apply control, "APPLY FOR JOB"
// -> /jobs/<id>/apply, in the page header, so every live posting read
// no_apply_control and `scan --verify` dropped it.
//
// The walk runs in the page, so this file launches Chromium and is skipped with
// a warning where it cannot launch. The page is served by a route registered
// after the liveness guard's, which makes it run first: nothing is resolved or
// fetched.
import { pass, fail, warn } from './helpers.mjs';
import { checkUrlLiveness, installLivenessRouteGuard, newLivenessPage } from '../liveness-browser.mjs';

console.log('\nliveness-browser — Apply link to the posting in the page chrome');

const ID = '85897690-ee8b-4d21-9914-1c11c9b17f21';
const OTHER_ID = '311c5fda-3700-48de-af8e-41a366f4e497';
const POSTING_URL = `https://www.example.com/jobs/${ID}`;
const POSTING = `<p>${'IT Governance. '.repeat(30)}</p>`;
const html = (body) => `<!doctype html><html><body>${body}</body></html>`;

let browser;
try {
  const { chromium } = await import('playwright');
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    warn(`own Apply link checks skipped: Chromium cannot launch (${e.message.split('\n')[0]})`);
  }
  if (browser) {
    const check = async (url, body, frames = {}) => {
      const page = await newLivenessPage(browser);
      try {
        await installLivenessRouteGuard(page);
        for (const [frameUrl, frameBody] of Object.entries({ [url]: body, ...frames })) {
          await page.route(frameUrl, (route) => route.fulfill({ contentType: 'text/html', body: html(frameBody) }));
        }
        return await checkUrlLiveness(page, url);
      } finally {
        await page.context().close();
      }
    };

    // The shape Tech in Asia ships: title, Save and Apply in the page header.
    const own = await check(POSTING_URL, [
      `<header class="page-header"><h1>IT Governance</h1><button>SAVE</button>`,
      `<a href="/jobs/${ID}/apply?pathname=%2Fauth&ref=jobs_application">APPLY FOR JOB</a></header>`,
      `<main>${POSTING}</main>`,
    ].join(''));
    if (own.result === 'active' && own.code === 'apply_control_visible') {
      pass('an Apply link to the posting\'s own page in the page header reads as an Apply control');
    } else {
      fail(`Apply link to the posting in the header: ${JSON.stringify(own)}`);
    }

    // The site's own links stay chrome: its jobs page, another posting, a sign-in
    // link carrying this posting only in its return address, the footer, and a
    // skip link back into this page. A link to this posting is still read only
    // where it is visible.
    const chrome = await check(POSTING_URL, [
      `<nav><a href="${POSTING_URL}#apply">Skip to apply</a></nav>`,
      '<header><a href="/jobs">Apply</a></header>',
      `<nav><a href="/jobs/${OTHER_ID}/apply">Apply</a></nav>`,
      `<header><a href="/login?returnUrl=%2Fjobs%2F${ID}">Sign in to apply</a></header>`,
      '<footer><a href="/careers/apply">Apply now</a></footer>',
      `<header aria-hidden="true"><a href="/jobs/${ID}/apply">Apply</a></header>`,
      `<main>${POSTING}</main>`,
    ].join(''));
    if (chrome.result === 'uncertain' && chrome.code === 'no_apply_control') {
      pass('Apply links in the chrome to the site, another posting, a sign-in page or this page itself, or hidden, are not Apply controls');
    } else {
      fail(`chrome links that are not the posting's own Apply: ${JSON.stringify(chrome)}`);
    }

    // The same inside a same-origin frame, which the walk reads too (iCIMS
    // renders the posting in one).
    const frameUrl = `https://www.example.com/jobs/${ID}/frame`;
    const framed = await check(POSTING_URL, `<main>${POSTING}</main><iframe src="${frameUrl}"></iframe>`, {
      [frameUrl]: `<header><a href="/jobs/${ID}/apply">Apply</a></header>`,
    });
    if (framed.result === 'active' && framed.code === 'apply_control_visible') {
      pass('an Apply link to the posting in a same-origin frame\'s header reads as an Apply control');
    } else {
      fail(`Apply link to the posting in a frame's header: ${JSON.stringify(framed)}`);
    }

    // With no id in the posting URL, nothing tells the posting's own link from
    // the site's, so the chrome is skipped as before.
    const noIdUrl = 'https://www.example.com/jobs/data-engineer';
    const noId = await check(noIdUrl, `<header><a href="/jobs/data-engineer/apply">Apply</a></header><main>${POSTING}</main>`);
    if (noId.result === 'uncertain' && noId.code === 'no_apply_control') {
      pass('without an id in the posting URL, an Apply link in the header stays chrome');
    } else {
      fail(`header Apply link on a posting URL without an id: ${JSON.stringify(noId)}`);
    }
  }
} catch (e) {
  fail(`own Apply link tests crashed: ${e.message}`);
} finally {
  await browser?.close();
}

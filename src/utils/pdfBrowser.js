// Shared headless-Chromium instance for server-side PDF rendering.
//
// Launching Chromium is expensive (~6s cold), so we launch ONCE and reuse the
// same browser across requests — each PDF render is then ~150ms. The instance is
// relaunched automatically if it ever disconnects (crash / OOM kill).

const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const logger = require('../config/logger');

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // /dev/shm is tiny in most containers; without this Chromium can crash on big
  // pages. Forcing it to use /tmp is the standard container-safe setting.
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--font-render-hinting=none',
];

let browserPromise = null;

function isAlive(browser) {
  if (!browser) return false;
  // puppeteer v22 exposes `connected`; older builds expose isConnected().
  if (typeof browser.connected === 'boolean') return browser.connected;
  if (typeof browser.isConnected === 'function') return browser.isConnected();
  return true;
}

/**
 * Get the shared browser, launching it on first use. Concurrent callers share the
 * same in-flight launch (browserPromise is assigned before the await).
 */
async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (isAlive(existing)) return existing;
    } catch {
      // Previous launch failed — fall through and retry a fresh launch.
    }
    browserPromise = null;
  }

  browserPromise = puppeteer
    .launch({ headless: 'new', args: LAUNCH_ARGS })
    .then((browser) => {
      logger.info('[pdf] Chromium launched for PDF rendering');
      browser.on('disconnected', () => {
        logger.warn('[pdf] Chromium disconnected — will relaunch on next request');
        browserPromise = null;
      });
      return browser;
    })
    .catch((err) => {
      // Reset so the next request retries instead of reusing a rejected promise.
      browserPromise = null;
      throw err;
    });

  return browserPromise;
}

/**
 * Render an HTML document to a PDF Buffer. Every call uses its own page (closed in
 * finally) so one request can't leak state into another.
 */
async function renderHtmlToPdf(html, pdfOptions = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // 'load' (not 'networkidle0') — networkidle can hang on data-only documents.
    await page.setContent(html, { waitUntil: 'load', timeout: 45000 });

    // Make sure every <img> is fully loaded AND DECODED before printing. Three
    // things made images intermittently missing from the PDF:
    //   1. CMS images with loading="lazy" never load in a print context (they're
    //      "below the fold") — we force them eager.
    //   2. An image can be complete() with naturalWidth>0 yet not decoded, so
    //      page.pdf() paints it blank — we await img.decode() to force the decode.
    //   3. A transient CDN hiccup fails one image — we retry it once.
    // Each wait is capped so a genuinely dead asset can't hang the whole render.
    await page.evaluate(async (perImageTimeoutMs) => {
      const waitOne = (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve(true);
          let settled = false;
          const finish = (ok) => {
            if (settled) return;
            settled = true;
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
            clearTimeout(timer);
            resolve(ok);
          };
          const onLoad = () => finish(true);
          const onError = () => finish(false);
          img.addEventListener('load', onLoad);
          img.addEventListener('error', onError);
          const timer = setTimeout(() => finish(false), perImageTimeoutMs);
        });

      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map(async (img) => {
          try { img.loading = 'eager'; img.decoding = 'sync'; } catch { /* readonly */ }

          let ok = await waitOne(img);

          // Retry once for a transient failure (skip data: URLs — they can't fail
          // transiently, and a cache-buster would just bloat them).
          if (!ok && img.src && !img.src.startsWith('data:')) {
            const sep = img.src.includes('?') ? '&' : '?';
            img.src = `${img.src}${sep}_pdfretry=${Date.now()}`;
            ok = await waitOne(img);
          }

          // Force decode so a loaded-but-undecoded image actually paints.
          if (ok && typeof img.decode === 'function') {
            try { await img.decode(); } catch { /* already painted or failed */ }
          }
        })
      );
    }, 15000);

    return await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      ...pdfOptions,
    });
  } finally {
    // Close the page even if rendering threw, so tabs don't accumulate.
    await page.close().catch(() => {});
  }
}

// Render options for a full-bleed banner page: no margins, no running header/
// footer, and preferCSSPageSize so the document's own `@page { size:A4; margin:0 }`
// wins. This is what keeps a cover/back banner edge-to-edge on a single page.
const FULL_BLEED_PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: false,
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
};

/** Concatenate several PDF buffers into one document, in order. */
async function mergePdfBuffers(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  const bytes = await out.save();
  return Buffer.from(bytes);
}

/**
 * Render a full exam PDF from the parts produced by buildExamPdfDocument:
 * an optional full-bleed cover banner, the content (with running header/footer),
 * and an optional full-bleed back banner. Parts are rendered separately (they
 * need different margins / header-footer settings) and merged into one file.
 */
async function renderExamPdf(built) {
  const { coverHtml, contentHtml, backHtml, contentRenderOptions } = built || {};
  const buffers = [];
  if (coverHtml) buffers.push(await renderHtmlToPdf(coverHtml, FULL_BLEED_PDF_OPTIONS));
  buffers.push(await renderHtmlToPdf(contentHtml, contentRenderOptions || {}));
  if (backHtml) buffers.push(await renderHtmlToPdf(backHtml, FULL_BLEED_PDF_OPTIONS));

  // Nothing to merge when there are no banners — return the single content buffer.
  return buffers.length === 1 ? buffers[0] : mergePdfBuffers(buffers);
}

/** Graceful shutdown hook (optional) — close the browser on process exit. */
async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* already gone */
  } finally {
    browserPromise = null;
  }
}

module.exports = { getBrowser, renderHtmlToPdf, renderExamPdf, mergePdfBuffers, closeBrowser };

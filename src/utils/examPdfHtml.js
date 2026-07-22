// Server-side question-paper HTML builder for PDF rendering via headless Chromium.
//
// Produces print-ready HTML that Chromium paginates natively (real vector text,
// selectable, sharp). The final PDF is assembled from up to three separately
// rendered parts and merged (see pdfBrowser.renderExamPdf):
//   1. Cover banner  — a full-bleed A4 page, NO running header/footer/margins.
//   2. Content       — info table + questions (+ answers), with a running header
//                      and a running footer strip (banner + page number).
//   3. Back banner   — a full-bleed A4 page, NO running header/footer/margins.
// Splitting the banners out is what keeps them edge-to-edge on a single page with
// no footer image bleeding onto them (a single Chromium render can only apply one
// margin + one running header/footer to every page).

const sharp = require('sharp');

// Read a banner image's natural pixel dimensions so the footer strip can be
// sized to its real aspect ratio instead of a fixed height. A fixed height
// forced every banner through object-fit:cover, which crops whatever doesn't
// match that one hardcoded ratio — usually the top/bottom of the source image.
// Returns null (caller falls back to a default) if the image can't be read.
async function getImageDimensions(urlOrDataUrl) {
  if (!urlOrDataUrl) return null;
  try {
    let buffer;
    if (urlOrDataUrl.startsWith('data:')) {
      const base64 = urlOrDataUrl.slice(urlOrDataUrl.indexOf(',') + 1);
      buffer = Buffer.from(base64, 'base64');
    } else {
      const res = await fetch(urlOrDataUrl);
      if (!res.ok) return null;
      buffer = Buffer.from(await res.arrayBuffer());
    }
    const { width, height } = await sharp(buffer).metadata();
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

// ── Plain-text escaping for non-rich fields (titles, section names) ───────────
function esc(value) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Rich HTML fields (question/option/explanation/passage/instructions) come from
// the CMS and are inserted as-is, exactly as the on-screen exam does. We only
// strip <script>/<style> to avoid them leaking into the print document.
//
// We ALSO neutralise any inline font sizing baked into the stored HTML. Content
// pasted from Word / Google Docs / other pages carries inline `font-size` (and
// legacy <font size>) declarations. Those inline values override the print
// stylesheet's per-class sizes (.answer-exp, .q-text, .passage-body, …), which
// is why some explanations rendered smaller than their neighbours. Stripping the
// inline sizes lets the PDF's own CSS govern the type scale so every explanation
// (and question/passage) is uniform regardless of how it was authored.
function stripInlineFontSize(html) {
  return html
    // Remove `font-size: …;` from any inline style attribute.
    .replace(/font-size\s*:\s*[^;"']*;?/gi, '')
    // Drop the legacy size attribute from <font> tags.
    .replace(/(<font\b[^>]*?)\s+size\s*=\s*(["'][^"']*["']|[^\s>]+)/gi, '$1')
    // Clean up any now-empty style attributes left behind.
    .replace(/\s+style\s*=\s*(["'])\s*\1/gi, '');
}

function rich(html) {
  if (!html) return '';
  return stripInlineFontSize(
    String(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  );
}

// ── Instructions (kept in sync with the frontend src/lib/examInstructions.ts) ──
function formatDuration(durationMinutes) {
  const mins = Number(durationMinutes);
  if (!Number.isFinite(mins) || mins <= 0) return '-';
  const hrs = Math.floor(mins / 60);
  const rem = Math.round(mins % 60);
  return [
    hrs ? `${hrs} Hour${hrs > 1 ? 's' : ''}` : '',
    rem ? `${rem} Minutes` : '',
  ].filter(Boolean).join(' ');
}

// Exam schedule is stored as a timestamptz; render it in IST so the printed date/
// time match what Indian candidates expect (and the reference paper).
function formatExamDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatExamTime(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
  }).toLowerCase();
}

function hasCustomInstructions(instructions) {
  if (!instructions) return false;
  const plain = String(instructions).replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
  return plain.length > 0;
}

function buildDefaultInstructions({ sectionCount, totalQuestions, durationMinutes, marksPerQuestion, negativeMarks }) {
  const lines = [];
  lines.push(`The test contains ${sectionCount} section${sectionCount === 1 ? '' : 's'} having ${totalQuestions} questions.`);
  lines.push('Each question has 4 options out of which only one is correct.');

  const duration = formatDuration(durationMinutes);
  if (duration !== '-') lines.push(`You have to finish the test in ${duration}.`);

  const hasNegative = Number.isFinite(Number(negativeMarks)) && Number(negativeMarks) > 0;
  if (Number.isFinite(Number(marksPerQuestion)) && Number(marksPerQuestion) > 0) {
    lines.push(
      hasNegative
        ? `You will be awarded ${marksPerQuestion} marks for each correct answer and ${negativeMarks} will be deducted for each wrong answer.`
        : `You will be awarded ${marksPerQuestion} marks for each correct answer. There is no negative marking.`
    );
  }
  if (hasNegative) lines.push('There is no negative marking for the questions that you have not attempted.');
  lines.push('You can write this test only once. Make sure that you complete the test before you submit the test and/or close the browser.');
  return lines;
}

// ── Content-document CSS ──────────────────────────────────────────────────────
// Font hierarchy is deliberate so the paper scans easily:
//   • questions + options: large, dark, bold-ish  (the thing you read)
//   • section headers:     large blue banner       (where a section starts)
//   • marks / explanations: small grey             (supporting detail)
function buildStyles() {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1a1a1a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .watermark {
      position: fixed; inset: 0; z-index: 0;
      display: flex; align-items: center; justify-content: center;
      pointer-events: none; overflow: hidden;
    }
    .watermark img { width: 60%; max-width: 430px; opacity: 0.07; transform: rotate(-28deg); }
    .content { position: relative; z-index: 1; }

    .page-break { page-break-before: always; }
    .break-after { page-break-after: always; }

    /* Brand mark at the top of the first content page (matches the reference). */
    .brand-head { margin: 0 0 14px; }
    .brand-head img { height: 34px; width: auto; display: block; }

    /* Exam-info table — bordered two-column key/value block. */
    .info-table { width: 100%; border-collapse: collapse; margin: 2px 0 18px; font-size: 11.5px; }
    .info-table td { border: 1px solid #c7ccd1; padding: 6px 10px; vertical-align: top; }
    .info-table td.label { width: 30%; font-weight: 700; background: #f4f6f9; white-space: nowrap; }
    .info-table td.value { color: #1a1a1a; }

    .instructions-heading { margin-top: 4px; font-size: 13px; font-weight: 700; }
    .instructions-list { margin: 6px 0 0; padding-left: 18px; line-height: 1.7; font-size: 11px; }
    .instructions-list li { margin-bottom: 2px; }
    .instructions-rich { margin-top: 6px; line-height: 1.7; font-size: 11px; }
    .instructions-rich ol, .instructions-rich ul { padding-left: 18px; }

    /* Section header — full-width blue banner so a new section is unmistakable. */
    .section-title {
      font-size: 13px; font-weight: 700; color: #1d4ed8;
      background: #eaf1fb; border: 1px solid #cdddf7; border-radius: 4px;
      padding: 8px 12px; margin: 16px 0 12px;
      page-break-after: avoid; break-after: avoid;
    }
    .passage {
      margin-bottom: 12px; padding: 8px 10px;
      border-left: 3px solid #cdddf7; background: #f8fafc;
    }
    .passage-title { font-weight: 700; font-size: 11px; margin-bottom: 3px; }
    .passage-body { font-size: 11px; line-height: 1.55; }

    /* Question block — clear separation, large bold prompt. */
    .q { margin-bottom: 15px; padding-bottom: 4px; page-break-inside: avoid; break-inside: avoid; }
    .q-head { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 6px; }
    .q-num { font-weight: 700; font-size: 12.5px; flex-shrink: 0; }
    .q-text { flex: 1; min-width: 0; line-height: 1.55; font-size: 12.5px; font-weight: 600; color: #111827; }
    .q-img { max-width: 220px; max-height: 150px; margin: 2px 0 8px 22px; border: 1px solid #e5e7eb; border-radius: 3px; display: block; }
    .opts { margin-left: 22px; }
    .opt { padding: 2px 0; margin-bottom: 2px; font-size: 12px; color: #1f2937; }
    .opt-label { margin-right: 5px; font-weight: 600; }
    .opt-img { max-width: 170px; max-height: 100px; margin: 3px 0 2px; border: 1px solid #e5e7eb; border-radius: 3px; display: block; }
    .marks { text-align: right; font-size: 9px; color: #9ca3af; margin-top: 2px; }

    .answers-heading {
      font-size: 16px; font-weight: 700; color: #1d4ed8; text-align: center;
      background: #eaf1fb; border: 1px solid #cdddf7; border-radius: 4px;
      padding: 8px 12px; margin-bottom: 14px;
      /* Keep the heading with the first answer instead of stranding it alone. */
      page-break-after: avoid; break-after: avoid;
    }
    /* NOTE: no break-inside:avoid on .answer. Explanations can be longer than a
       page; keeping the block atomic forced the whole answer onto the next page
       and left large blank gaps. Let long answers flow; keep only the label with
       its start. */
    .answer { margin-bottom: 12px; }
    .answer-key { font-size: 15px; font-weight: 700; color: #15803d; page-break-after: avoid; break-after: avoid; }
    .answer-exp-label { font-size: 10px; font-weight: 700; color: #6b7280; margin-top: 3px; page-break-after: avoid; break-after: avoid; }
    .answer-exp { font-size: 10.5px; line-height: 1.55; color: #374151; }

    /* Rich content images are height-capped so a big paste can't dominate a page. */
    .rich img { max-width: 100%; max-height: 420px; width: auto; height: auto; }
    .passage-body img { max-height: 260px; }
    /* Explanation images are often full worked-solution screenshots — the main
       content of the answer. Let them use the full column width (a 240px height
       cap shrank wide images to an illegible thumbnail). */
    .answer-exp img { max-width: 100%; max-height: 1500px; width: auto; height: auto; }
    .rich table { border-collapse: collapse; }
    .rich td, .rich th { border: 1px solid #d1d5db; padding: 3px 6px; }
    .rich p { margin: 0 0 4px; }
    /* Pasted headings must inherit their container's size (like the attempt page
       does) so an <h2> dropped into an explanation/question doesn't render at
       Chromium's default large size and break the uniform type scale. */
    .rich h1, .rich h2, .rich h3, .rich h4, .rich h5, .rich h6 {
      font-size: inherit; font-weight: 600; margin: 0 0 4px;
    }
  `;
}

// Wrap a body fragment in a full HTML document with a <base> so relative image
// URLs (watermark/brand logo, any relative question art) resolve.
function wrapDocument(body, baseUrl) {
  const baseTag = baseUrl ? `<base href="${esc(baseUrl)}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${baseTag}<style>${buildStyles()}</style></head><body>${body}</body></html>`;
}

// Full-bleed single-page document for a cover / back-cover banner. Rendered with
// margin:0 and displayHeaderFooter:false so the image fills the whole A4 page and
// nothing (page number, footer strip) prints over it.
function buildBannerDocument(bannerUrl, baseUrl) {
  const baseTag = baseUrl ? `<base href="${esc(baseUrl)}">` : '';
  return `<!doctype html><html><head><meta charset="utf-8">${baseTag}<style>
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; }
    .full-page { width: 210mm; height: 297mm; overflow: hidden; }
    .full-page img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
  </style></head><body><div class="full-page"><img src="${esc(bannerUrl)}" alt=""/></div></body></html>`;
}

// Order questions for printing so the paper reads correctly:
//   1. Group by section, in section_order (the raw fetch can interleave sections
//      when question_number restarts per section).
//   2. Within a section keep the authored order (question_order, then _number).
//   3. Pull every question sharing a comprehension passage together, so the
//      passage can be printed exactly once immediately before its questions.
// Without step 3, questions that share a passage but aren't adjacent in the fetch
// order print with the passage detached from — or repeated before — the wrong
// questions. Uses positional bookkeeping (never a question id) so nothing is
// dropped even if ids are missing/duplicated.
function orderQuestionsForPrint(questions, sections) {
  const list = Array.isArray(questions) ? questions : [];

  // Give every distinct section a UNIQUE rank so its questions always stay
  // contiguous (otherwise the section header re-emits on each question). Sections
  // are ordered by section_order, then by first appearance — the latter breaks
  // ties when section_order is missing OR duplicated (e.g. every section at 0),
  // which is exactly what made the header repeat.
  const sectionMeta = new Map(
    (sections || []).map((s, i) => [s.id, typeof s.section_order === 'number' ? s.section_order : Number.MAX_SAFE_INTEGER])
  );
  const firstSeen = new Map();
  list.forEach((q, i) => { if (!firstSeen.has(q.section_id)) firstSeen.set(q.section_id, i); });
  const distinctSids = [...firstSeen.keys()].sort((a, b) => {
    const oa = sectionMeta.has(a) ? sectionMeta.get(a) : Number.MAX_SAFE_INTEGER;
    const ob = sectionMeta.has(b) ? sectionMeta.get(b) : Number.MAX_SAFE_INTEGER;
    return (oa - ob) || (firstSeen.get(a) - firstSeen.get(b));
  });
  const sectionRank = new Map(distinctSids.map((sid, i) => [sid, i]));

  const rankSection = (q) => (sectionRank.has(q.section_id) ? sectionRank.get(q.section_id) : Number.MAX_SAFE_INTEGER);
  const rankQuestion = (q) => q.question_order ?? q.question_number ?? Number.MAX_SAFE_INTEGER;

  // Stable sort by [section rank, question order].
  const sorted = list
    .map((q, i) => ({ q, i }))
    .sort((a, b) =>
      (rankSection(a.q) - rankSection(b.q)) ||
      (rankQuestion(a.q) - rankQuestion(b.q)) ||
      (a.i - b.i)
    )
    .map((x) => x.q);

  // Group passage questions contiguously at the passage's first appearance.
  const ordered = [];
  const used = new Array(sorted.length).fill(false);
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const pid = sorted[i].passage_id || null;
    if (pid) {
      const sid = sorted[i].section_id;
      // Pull the passage's questions together, but only within the same section so
      // grouping never drags a later section's question forward.
      for (let j = i; j < sorted.length; j++) {
        if (!used[j] && (sorted[j].passage_id || null) === pid && sorted[j].section_id === sid) {
          ordered.push(sorted[j]);
          used[j] = true;
        }
      }
    } else {
      ordered.push(sorted[i]);
      used[i] = true;
    }
  }
  return ordered;
}

/**
 * Build the print documents plus the Puppeteer render options for the content.
 * Returns { coverHtml, contentHtml, backHtml, contentRenderOptions } — feed this
 * straight into pdfBrowser.renderExamPdf, which renders each part and merges them.
 *
 * options: {
 *   showAnswers, showExplanations, language ('en'|'hi'),
 *   showWatermark, showCoverPage, headerText, footerText,
 *   coverBanner, footerBanner, backCoverBanner   // data: URLs or absolute URLs
 * }
 */
async function buildExamPdfDocument(examData, options = {}) {
  const { exam, sections = [], questions = [] } = examData || {};
  const opts = {
    showAnswers: true,
    showExplanations: true,
    language: 'en',
    showWatermark: true,
    showCoverPage: true,
    headerText: '',
    footerText: '',
    coverBanner: null,
    footerBanner: null,
    backCoverBanner: null,
    // Absolute origin used to resolve relative image URLs (watermark/brand logo,
    // any relative question/option art). setContent's origin is about:blank, so
    // without a <base> relative src's would fail.
    baseUrl: 'https://bharatmock.com',
    // Watermark / brand image; relative by default so it resolves against baseUrl.
    watermarkUrl: '/logo.png',
    ...options,
  };
  const isHi = opts.language === 'hi';
  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  // ── CONTENT document body ───────────────────────────────────────────────────
  let body = '';

  if (opts.showWatermark && opts.watermarkUrl) {
    body += `<div class="watermark"><img src="${esc(opts.watermarkUrl)}" alt=""/></div>`;
  }

  body += `<div class="content">`;

  // Brand mark on the first content page. onerror hides it so a missing asset
  // leaves no broken-image placeholder.
  if (opts.watermarkUrl) {
    body += `<div class="brand-head"><img src="${esc(opts.watermarkUrl)}" alt="BharatMock" onerror="this.style.display='none'"/></div>`;
  }

  // ── Exam-info table + instructions ──────────────────────────────────────────
  if (opts.showCoverPage) {
    const rows = [];
    const dateStr = formatExamDate(exam?.exam_date || exam?.start_date);
    const timeStr = formatExamTime(exam?.exam_date || exam?.start_date);
    if (dateStr) rows.push(['Exam Date', dateStr]);
    if (timeStr) rows.push(['Exam Time', timeStr]);
    rows.push(['Exam Name', exam?.title || '-']);
    rows.push(['Duration', formatDuration(exam?.duration)]);
    rows.push(['Total Questions', exam?.total_questions ?? '-']);
    rows.push(['Total Marks', exam?.total_marks ?? '-']);

    body += `<table class="info-table"><tbody>${rows
      .map(([label, value]) => `<tr><td class="label">${esc(label)}</td><td class="value">${esc(value)}</td></tr>`)
      .join('')}</tbody></table>`;

    body += `<div class="instructions-heading">Instructions</div>`;
    if (hasCustomInstructions(exam?.instructions)) {
      body += `<div class="instructions-rich rich">${rich(exam.instructions)}</div>`;
    } else {
      const lines = buildDefaultInstructions({
        sectionCount: sections.length,
        totalQuestions: Number(exam?.total_questions) || 0,
        durationMinutes: Number(exam?.duration) || 0,
        marksPerQuestion: sections[0]?.marks_per_question ?? null,
        negativeMarks: exam?.negative_marking ? (exam?.negative_mark_value ?? null) : null,
      });
      body += `<ol class="instructions-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>`;
    }
  }

  // ── Question paper + collect answer entries ─────────────────────────────────
  // Print order groups sections and keeps each comprehension passage's questions
  // together (see orderQuestionsForPrint).
  const printQuestions = orderQuestionsForPrint(questions, sections);
  const answerEntries = [];
  let qNum = 1;
  let lastSectionId = null;
  let firstSection = true;
  const shownPassages = new Set();

  for (const q of printQuestions) {
    const qText = (isHi && q.text_hi) ? q.text_hi : (q.text || q.question_text || '');

    // Section header — every section starts on a fresh page. The first section
    // breaks too when a cover-info page precedes it; without a cover page it stays
    // on page 1 so the paper doesn't open with a blank page.
    if (q.section_id !== lastSectionId) {
      const sec = sectionMap.get(q.section_id);
      if (sec) {
        const name = (isHi && sec.name_hi) ? sec.name_hi : sec.name;
        const breakBefore = !firstSection || opts.showCoverPage;
        body += `<div class="section-title${breakBefore ? ' page-break' : ''}">${esc(name)}</div>`;
        firstSection = false;
      }
      // Advance even when the section is unknown, so a header isn't re-emitted for
      // every question of an orphaned/section-less group.
      lastSectionId = q.section_id;
    }

    // Comprehension passage — printed once, immediately before the first question
    // that references it (grouping guarantees the rest follow contiguously).
    const passageId = q.passage_id || null;
    if (passageId && q.passage && !shownPassages.has(passageId)) {
      const pContent = (isHi && q.passage.content_hi) ? q.passage.content_hi : q.passage.content;
      body += `<div class="passage">
          <div class="passage-title">${esc(q.passage.title || 'Comprehension')}</div>
          <div class="passage-body rich">${rich(pContent)}</div>
        </div>`;
      shownPassages.add(passageId);
    }

    // Keep an option if it has ANY content — text OR an image. Image-only options
    // (common in reasoning/figure questions) were being dropped by a text-only
    // filter, so their images never printed and the a/b/c/d lettering shifted.
    const sortedOpts = [...(q.options || [])]
      .sort((a, b) => (a.option_order ?? 0) - (b.option_order ?? 0))
      .filter((o) => o.option_text || o.text || o.option_text_hi || o.image_url);

    body += `<div class="q">`;
    body += `<div class="q-head"><span class="q-num">${qNum}.</span><div class="q-text rich">${rich(qText)}</div></div>`;
    if (q.image_url) body += `<img class="q-img" src="${esc(q.image_url)}" alt=""/>`;

    body += `<div class="opts">`;
    sortedOpts.forEach((o, i) => {
      const label = String.fromCharCode(97 + i);
      const oText = (isHi && o.option_text_hi) ? o.option_text_hi : (o.option_text || o.text || '');
      // Correct option is NOT highlighted inline — the reader should attempt the
      // paper first and check the answer key in the Answers section at the end.
      body += `<div class="opt"><span class="opt-label">${label}.</span><span class="rich">${rich(oText)}</span>`;
      if (o.image_url) body += `<img class="opt-img" src="${esc(o.image_url)}" alt=""/>`;
      body += `</div>`;
    });
    body += `</div>`;

    const marks = Number(q.marks);
    const neg = Number(q.negative_marks);
    if (Number.isFinite(marks) && marks > 0) {
      const scheme = Number.isFinite(neg) && neg > 0 ? `(+${marks}, -${neg})` : `(+${marks})`;
      body += `<div class="marks">${esc(scheme)}</div>`;
    }
    body += `</div>`;

    const correctIdx = sortedOpts.findIndex((o) => o.is_correct);
    const expRaw = (isHi && q.explanation_hi) ? q.explanation_hi : q.explanation;
    answerEntries.push({
      num: qNum,
      letter: correctIdx >= 0 ? String.fromCharCode(97 + correctIdx) : '',
      explanation: opts.showExplanations ? (expRaw || '') : '',
      // Some questions store the explanation figure in a dedicated field instead
      // of inline in the HTML — render it too, or it silently goes missing.
      explanationImage: opts.showExplanations ? (q.explanation_image_url || '') : '',
    });
    qNum++;
  }

  // ── Answers & explanations section (own page) ───────────────────────────────
  // The correct option is revealed only here (never beside the question), so the
  // paper can be attempted first. Shows the answer key when answers are enabled
  // and the detailed explanation when explanations are enabled.
  const answersToShow = answerEntries.filter(
    (a) => (opts.showAnswers && a.letter) || (opts.showExplanations && (a.explanation || a.explanationImage))
  );
  if ((opts.showAnswers || opts.showExplanations) && answersToShow.length > 0) {
    const heading = opts.showExplanations ? 'Answers &amp; Explanations' : 'Answers';
    body += `<section class="page-break">`;
    body += `<div class="answers-heading">${heading}</div>`;
    for (const entry of answersToShow) {
      body += `<div class="answer">`;
      body += opts.showAnswers && entry.letter
        ? `<div class="answer-key">${entry.num}. Answer: ${entry.letter.toUpperCase()}</div>`
        : `<div class="answer-key">${entry.num}.</div>`;
      if (opts.showExplanations && (entry.explanation || entry.explanationImage)) {
        body += `<div class="answer-exp-label">Explanation:</div>`;
        if (entry.explanation) body += `<div class="answer-exp rich">${rich(entry.explanation)}</div>`;
        if (entry.explanationImage) body += `<div class="answer-exp"><img src="${esc(entry.explanationImage)}" alt=""/></div>`;
      }
      body += `</div>`;
    }
    body += `</section>`;
  }

  body += `</div>`; // .content

  const contentHtml = wrapDocument(body, opts.baseUrl);
  const coverHtml = opts.coverBanner ? buildBannerDocument(opts.coverBanner, opts.baseUrl) : null;
  const backHtml = opts.backCoverBanner ? buildBannerDocument(opts.backCoverBanner, opts.baseUrl) : null;

  // ── Puppeteer render options for the CONTENT part: margins + running chrome ──
  const hasFooterBanner = !!opts.footerBanner;
  const headerLabel = opts.headerText ? esc(opts.headerText) : 'BharatMock';

  // Size the footer strip to the banner's OWN aspect ratio (full page width),
  // not a fixed height. A fixed height forced every banner through
  // object-fit:cover, which crops whatever part of the source image didn't
  // match that one hardcoded ratio — the actual cause of banners looking
  // cropped, independent of the page-edge inset issue below. Capped at 30% of
  // the page height so a very tall/narrow upload can't swallow the page.
  const A4_WIDTH_MM = 210;
  const A4_HEIGHT_MM = 297;
  let footerStripHMm = 24; // fallback used only if the banner can't be read
  if (hasFooterBanner) {
    const dims = await getImageDimensions(opts.footerBanner);
    if (dims) {
      footerStripHMm = Math.min(
        A4_WIDTH_MM * (dims.height / dims.width),
        A4_HEIGHT_MM * 0.3
      );
    }
  }
  // Space above the strip for the caption/page-number line (matches the
  // original 30mm box budget: 24mm strip + 6mm caption headroom).
  const footerCaptionSlackMm = 6;

  const margin = {
    top: '16mm',
    // Reserve room for the grey caption line + the footer banner strip. The
    // margin keeps page content from colliding with the running footer.
    bottom: hasFooterBanner ? `${footerStripHMm + footerCaptionSlackMm}mm` : '15mm',
    left: '12mm',
    right: '12mm',
  };

  const headerTemplate = `<div style="width:100%;font-size:8px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;padding:0 12mm;">${headerLabel}</div>`;

  const pageNum = `Page <span class="pageNumber"></span> of <span class="totalPages"></span>`;
  const caption = `Generated by Bharat Mock - www.bharatmock.com`;

  // Footer banner must sit FLUSH against the paper's bottom edge. Chromium leaves
  // a fixed inset at the bottom of the footer box (independent of margin/strip
  // size — verified by calibration at multiple margin.bottom values), so a strip
  // aligned to the box bottom stops short of the edge (a visible white gap). Pin
  // the strip with a negative bottom offset to push it past that inset to the
  // edge — but the offset must not exceed the inset itself, or the excess pushes
  // the image past the physical page edge and Chromium clips it there. Measured
  // empirically via rendered-PDF pixel inspection: the inset is ~5.16mm — -5mm
  // lands the strip flush with ~0.1mm to spare. object-fit:fill (not cover) is
  // safe here because the box height is now derived from the image's own aspect
  // ratio, so there is no overflow left for "cover" to crop.
  const footerTemplate = hasFooterBanner
    ? `<div style="position:relative;width:100%;height:100%;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;">
         <div style="position:absolute;top:0;left:0;right:0;text-align:center;font-size:7.5px;color:#9ca3af;line-height:1.4;">
           ${esc(opts.footerText || caption)}<br/>${pageNum}
         </div>
         <img src="${esc(opts.footerBanner)}" style="position:absolute;left:0;right:0;bottom:-5mm;width:100%;height:${footerStripHMm}mm;object-fit:fill;display:block;"/>
       </div>`
    : `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;text-align:center;font-size:7.5px;color:#9ca3af;line-height:1.4;padding:0 12mm;">
         ${esc(opts.footerText || caption)}<br/>${pageNum}
       </div>`;

  const contentRenderOptions = {
    margin,
    displayHeaderFooter: true,
    headerTemplate,
    footerTemplate,
  };

  return { coverHtml, contentHtml, backHtml, contentRenderOptions };
}

module.exports = { buildExamPdfDocument, formatDuration, buildDefaultInstructions, hasCustomInstructions };

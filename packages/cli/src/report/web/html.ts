export const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Causign · Local reports</title><link rel="stylesheet" href="/style.css"></head>
<body><a class="skip-link" href="#scenario-detail">Skip to report details</a>
<aside class="sidebar"><div class="brand"><span class="brand-mark" aria-hidden="true">C</span>Causign<span class="brand-tag">REPORTS</span></div>
<div class="workspace-label">LOCAL WORKSPACE</div><h2>Execution history</h2><p class="muted">Follow the evidence behind every result.</p>
<button id="refresh" class="secondary">↻ Refresh history</button><nav id="history" aria-label="Execution history"></nav>
<div class="sidebar-footer"><span class="local-dot" aria-hidden="true"></span>Local only · read-only<p>No agents run from this view.</p></div></aside>
<main><header><div><div class="eyebrow">AGENT TESTING / REPORTS</div><h1>Execution report</h1><p class="muted">See what failed, what changed, and why.</p></div><span class="local-pill">● LOCAL REPORT</span></header>
<div id="notice" role="status" aria-live="polite">Loading local reports…</div>
<section id="overview" aria-label="Execution summary"><div id="run-meta" class="muted"></div><div id="counts" class="counts"></div></section>
<div class="report-layout"><section class="scenarios panel" aria-labelledby="scenarios-heading"><div class="section-heading"><h2 id="scenarios-heading">Scenarios</h2><span id="scenario-count" class="muted"></span></div>
<label class="sr-only" for="search">Search scenario IDs</label><input id="search" type="search" placeholder="Search scenarios…">
<label class="sr-only" for="status-filter">Filter by status</label><select id="status-filter"><option value="">All statuses</option><option>FAIL</option><option>ERROR</option><option>INCOMPATIBLE</option><option>PASS</option><option>SKIP</option></select><nav id="scenario-list" aria-label="Scenarios"></nav></section>
<div class="detail-column"><section id="scenario-detail" class="panel" aria-label="Scenario details" tabindex="-1"><div class="empty"><span aria-hidden="true">◎</span><h2>Select a scenario</h2><p>Inspect its assertions and recorded evidence.</p></div></section>
<section class="panel timeline-panel" aria-labelledby="timeline-heading"><div class="section-heading"><h2 id="timeline-heading">Evidence timeline</h2><span id="trace-state" class="muted"></span></div><p class="muted">A request, authorization, execution, mock, and rejection are different facts.</p><div id="timeline"></div><div class="pagination"><button id="previous" class="secondary" disabled>← Previous</button><span id="page-label" class="muted"></span><button id="next" class="secondary" disabled>Next →</button></div></section></div></div>
<footer>Recorded verdicts come from Causign. Investigative guidance is based on available evidence.<br>Raw prompts and tool output may contain sensitive data; this report stays on your computer.</footer>
</main><script type="module" src="/client.js"></script></body></html>`;

import type {
  LoadedReport,
  ReportSummary,
  ScenarioDetails,
  AssertionExplanation,
} from "../types.js";
import { reportSessionToken } from "./session.js";
import { findEvidencePage, focusEvidence } from "./navigation.js";
type Detail = ScenarioDetails & {
  explanations: AssertionExplanation[];
  timeline: { page: number; totalPages: number; totalEvents: number };
};
const element = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const notice = element("notice");
let token = "";
try {
  token = reportSessionToken(
    location.hash,
    sessionStorage.getItem("causign-report-token"),
  );
  if (token) sessionStorage.setItem("causign-report-token", token);
} catch {
  token = reportSessionToken(location.hash, null);
}
history.replaceState(null, "", location.pathname);
let reports: ReportSummary[] = [];
let currentId = "";
let report: LoadedReport | undefined;
let selected = -1;
let page = 0;
let detail: Detail | undefined;
let generation = 0;
function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
}
function badge(status: string) {
  return node("span", status, `badge ${status}`);
}
function text(value: unknown) {
  const encoded =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, null, 2) ?? "Unavailable");
  return encoded.length > 50000
    ? `${encoded.slice(0, 50000)}\n[display truncated]`
    : encoded;
}
function warning(message: string) {
  return node("p", message, "warning");
}
function error(error: unknown) {
  notice.textContent = `Report unavailable: ${error instanceof Error ? error.message : String(error)}`;
}
async function api<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      token = "";
      try {
        sessionStorage.removeItem("causign-report-token");
      } catch {
        /* Storage can be unavailable. */
      }
    }
    throw new Error(value.error ?? "Request failed.");
  }
  return value as T;
}
function displayHistory() {
  const target = element("history");
  target.replaceChildren();
  for (const r of reports) {
    const button = node("button", undefined, "history-button");
    button.setAttribute("aria-current", String(r.id === currentId));
    button.append(
      node("strong", r.timestamp ?? r.label),
      node(
        "small",
        r.error
          ? "Report loading error"
          : `${r.counts.FAIL} failed · ${r.counts.ERROR} errors · ${r.counts.PASS} passed`,
      ),
    );
    button.addEventListener("click", () => {
      void chooseReport(r.id).catch(error);
    });
    target.append(button);
  }
}
function clearDetails(message: string) {
  detail = undefined;
  page = 0;
  element("scenario-detail").replaceChildren(node("p", message, "muted"));
  element("timeline").replaceChildren();
  element("trace-state").textContent = "NO SCENARIO SELECTED";
  element("page-label").textContent = "No events";
  element<HTMLButtonElement>("previous").disabled = true;
  element<HTMLButtonElement>("next").disabled = true;
}
async function refresh() {
  const revision = ++generation;
  const data = await api<{
    reports: ReportSummary[];
    warnings: string[];
    selectedReportId?: string;
  }>("/api/history");
  if (revision !== generation) return;
  reports = data.reports;
  notice.textContent = data.warnings.join(" ");
  displayHistory();
  if (!reports.length) {
    currentId = "";
    report = undefined;
    selected = -1;
    clearDetails("No executions yet. Run causign run, then refresh history.");
    element("run-meta").textContent =
      "No executions yet. Run causign run in this project, then refresh history.";
    element("counts").replaceChildren();
    element("scenario-list").replaceChildren();
    element("scenario-count").textContent = "0 visible";
    return;
  }
  const id = reports.some((r) => r.id === currentId)
    ? currentId
    : (reports.find((r) => r.id === data.selectedReportId)?.id ??
      reports.find((r) => !r.error)?.id ??
      reports[0].id);
  await chooseReport(id);
}
async function chooseReport(id: string) {
  const revision = ++generation;
  currentId = id;
  selected = -1;
  report = undefined;
  displayHistory();
  element("scenario-list").replaceChildren();
  clearDetails("Loading execution…");
  try {
    const value = await api<LoadedReport>(`/api/reports/${id}`);
    if (revision !== generation) return;
    report = value;
    const summary = reports.find((r) => r.id === id)!;
    element("run-meta").textContent =
      `Artifact timestamp: ${summary.timestamp ?? "unavailable"} · Exit code: ${value.suite.exitCode}${value.suite.interrupted ? " · INTERRUPTED" : ""}`;
    const counts = element("counts");
    counts.replaceChildren();
    for (const status of [
      "PASS",
      "FAIL",
      "ERROR",
      "INCOMPATIBLE",
      "SKIP",
    ] as const) {
      const card = node("div", undefined, `count-card ${status}`);
      card.append(
        node("span", status),
        node("strong", String(summary.counts[status])),
      );
      counts.append(card);
    }
    displayScenarios();
    const first = filtered()[0];
    if (first) await chooseScenario(first.index);
    else
      clearDetails(
        "No matching scenarios. Adjust the search or status filter.",
      );
  } catch (e) {
    if (revision !== generation) return;
    clearDetails("This report could not be loaded.");
    element("scenario-detail").append(
      warning(e instanceof Error ? e.message : String(e)),
    );
    element("counts").replaceChildren();
    element("run-meta").textContent = "This report could not be loaded.";
    error(e);
  }
}
function filtered() {
  const search = element<HTMLInputElement>("search").value.toLowerCase();
  const status = element<HTMLSelectElement>("status-filter").value;
  const rank: Record<string, number> = {
    FAIL: 0,
    ERROR: 1,
    INCOMPATIBLE: 2,
    PASS: 3,
    SKIP: 4,
  };
  return (report?.suite.results ?? [])
    .map((result, index) => ({ result, index }))
    .filter(
      ({ result }) =>
        (!status || result.status === status) &&
        result.scenarioId.toLowerCase().includes(search),
    )
    .sort(
      (a, b) =>
        rank[a.result.status] - rank[b.result.status] || a.index - b.index,
    );
}
function displayScenarios() {
  const list = element("scenario-list");
  list.replaceChildren();
  const items = filtered();
  element("scenario-count").textContent = `${items.length} visible`;
  for (const { result, index } of items) {
    const button = node("button", undefined, "scenario-button");
    button.setAttribute("aria-current", String(index === selected));
    button.append(node("strong", result.scenarioId), badge(result.status));
    if (result.executionDurationMs !== undefined)
      button.append(
        node(
          "small",
          ` · ${result.executionDurationMs.toFixed(1)} ms`,
          "muted",
        ),
      );
    button.addEventListener("click", () => {
      void chooseScenario(index).catch(error);
    });
    list.append(button);
  }
  if (!items.length) list.append(node("p", "No matching scenarios.", "muted"));
}
async function chooseScenario(
  index: number,
  newPage = 0,
  focusSequence?: number,
) {
  const revision = ++generation;
  selected = index;
  clearDetails("Loading scenario…");
  page = newPage;
  displayScenarios();
  try {
    const value = await api<Detail>(
      `/api/reports/${currentId}/scenarios/${index}?page=${newPage}`,
    );
    if (revision !== generation) return;
    detail = value;
    renderDetail();
    renderTimeline();
    if (focusSequence !== undefined) {
      const event = element(`event-${focusSequence}`);
      if (event) {
        event.classList.add("highlighted");
        focusEvidence(
          event,
          window.innerHeight,
          window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        );
      }
    }
  } catch (e) {
    if (revision !== generation) return;
    clearDetails("This scenario could not be loaded.");
    element("scenario-detail").append(
      warning(e instanceof Error ? e.message : String(e)),
    );
    error(e);
  }
}
function valueBox(label: string, value: unknown) {
  const box = node("div", undefined, "value-box");
  box.append(node("div", label, "value-label"), node("pre", text(value)));
  return box;
}
function renderDetail() {
  if (!detail) return;
  const d = detail;
  const target = element("scenario-detail");
  target.replaceChildren();
  const title = node("div", undefined, "section-heading");
  title.append(node("h2", d.result.scenarioId), badge(d.result.status));
  target.append(title);
  for (const message of d.warnings) target.append(warning(message));
  if (d.result.missingCapabilities?.length)
    target.append(
      warning(
        `Missing capabilities: ${d.result.missingCapabilities.join(", ")}. This scenario could not be evaluated.`,
      ),
    );
  if (report?.suite.interrupted)
    target.append(
      warning(
        "Execution was interrupted. Only recorded evidence is available.",
      ),
    );
  d.result.assertions.forEach((assertion, i) => {
    const explanation = d.explanations[i];
    const section = node("article", undefined, "assertion");
    const heading = node("div", undefined, "assertion-header");
    heading.append(badge(assertion.status), node("h3", assertion.id));
    section.append(heading, node("p", explanation.reason, "reason"));
    const pair = node("div", undefined, "comparison");
    pair.append(
      valueBox("EXPECTED", explanation.expected),
      valueBox("OBSERVED", explanation.observed),
    );
    section.append(pair);
    const guidance = node("div", undefined, "guidance");
    guidance.append(
      node("strong", "INVESTIGATIVE GUIDANCE"),
      node("p", explanation.guidance),
    );
    section.append(guidance);
    for (const difference of explanation.differences) {
      const diff = node("div", undefined, "diff");
      diff.append(
        node("div", `${difference.path} · ${difference.kind}`, "diff-path"),
      );
      if (Object.hasOwn(difference, "expected"))
        diff.append(node("pre", `− ${text(difference.expected)}`, "removed"));
      if (Object.hasOwn(difference, "observed"))
        diff.append(node("pre", `+ ${text(difference.observed)}`, "added"));
      section.append(diff);
    }
    if (explanation.truncated)
      section.append(warning("Difference list truncated at 1,000 paths."));
    const links = node("div", undefined, "evidence");
    for (const link of explanation.evidence) {
      const reference = link.reference;
      if (reference.kind === "message") {
        const button = node(
          "button",
          `${link.available ? "↗" : "Unavailable:"} ${reference.messageId}`,
        );
        button.disabled = !link.available;
        button.addEventListener("click", () => {
          void jumpToEvidence(reference.messageId, link.sequence!).catch(error);
        });
        links.append(button);
      } else {
        const raw = node("details");
        raw.append(
          node(
            "summary",
            reference.kind === "metric"
              ? `Recorded metric: ${reference.metric}`
              : `Evaluator: ${reference.evaluatorId}`,
          ),
          node("pre", text(reference)),
        );
        links.append(raw);
      }
    }
    section.append(links);
    target.append(section);
  });
  if (!d.result.assertions.length)
    target.append(node("p", "No assertion results were recorded.", "muted"));
  const diagnostics = [
    ...(report?.suite.diagnostics ?? []),
    ...d.result.diagnostics,
    ...(d.trace?.diagnostics ?? []),
  ];
  for (const diagnostic of diagnostics) {
    const block = node("details");
    block.append(
      node("summary", `${diagnostic.kind}: ${diagnostic.message}`),
      node("pre", text(diagnostic)),
    );
    target.append(block);
  }
}
async function jumpToEvidence(messageId: string, sequence: number) {
  if (!detail) return;
  const id = currentId,
    index = selected,
    revision = generation;
  const isCurrent = () =>
    generation === revision && currentId === id && selected === index;
  const found = await findEvidencePage(
    messageId,
    page,
    detail,
    (p) => api<Detail>(`/api/reports/${id}/scenarios/${index}?page=${p}`),
    isCurrent,
  );
  if (!isCurrent()) return;
  if (found === page) {
    document
      .querySelectorAll(".event.highlighted")
      .forEach((event) => event.classList.remove("highlighted"));
    const event = element(`event-${sequence}`);
    if (event) {
      event.classList.add("highlighted");
      focusEvidence(
        event,
        window.innerHeight,
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    }
  } else if (found !== null) await chooseScenario(index, found, sequence);
  else notice.textContent = "Referenced event is unavailable in this trace.";
}
function renderTimeline() {
  const target = element("timeline");
  target.replaceChildren();
  if (!detail) return;
  const trace = detail.trace;
  element("trace-state").textContent = trace
    ? `${trace.completeness.toUpperCase()} · ${detail.timeline.totalEvents} events`
    : "UNAVAILABLE";
  if (!trace)
    target.append(
      node("p", "No valid trace is available for this scenario.", "muted"),
    );
  else {
    if (trace.completeness === "incomplete")
      target.append(
        warning("Incomplete trace. Missing events do not prove non-execution."),
      );
    if (trace.terminal)
      target.append(
        node(
          "p",
          `${trace.terminal.type} · terminal source: ${trace.terminal.source}`,
          "muted",
        ),
      );
    for (const e of trace.events) {
      const event = node("article", undefined, "event");
      event.id = `event-${e.receiveSequence}`;
      const heading = node("div", undefined, "event-heading");
      heading.append(
        node("span", `#${e.receiveSequence}`, "muted"),
        node("strong", e.message.type),
      );
      event.append(
        heading,
        node(
          "small",
          `${e.source ?? "adapter"} · ${e.message.id}${"operationId" in e.message ? ` · operation ${e.message.operationId}` : ""}`,
        ),
      );
      const raw = node("details");
      raw.append(
        node("summary", "View recorded payload"),
        node("pre", text(e.message)),
      );
      event.append(raw);
      target.append(event);
    }
  }
  const pages = detail.timeline.totalPages;
  element("page-label").textContent = pages
    ? `Page ${page + 1} of ${pages}`
    : "No events";
  element<HTMLButtonElement>("previous").disabled = page === 0;
  element<HTMLButtonElement>("next").disabled = page + 1 >= pages;
}
element("refresh").addEventListener("click", () => {
  void refresh().catch(error);
});
function applyFilters() {
  const items = filtered();
  if (items.some((item) => item.index === selected)) {
    displayScenarios();
    return;
  }
  generation++;
  selected = -1;
  clearDetails("No matching scenarios. Adjust the search or status filter.");
  displayScenarios();
  if (items[0]) void chooseScenario(items[0].index).catch(error);
}
for (const id of ["search", "status-filter"])
  element(id).addEventListener(
    id === "search" ? "input" : "change",
    applyFilters,
  );
element("previous").addEventListener("click", () => {
  void chooseScenario(selected, page - 1).catch(error);
});
element("next").addEventListener("click", () => {
  void chooseScenario(selected, page + 1).catch(error);
});
void refresh().catch(error);

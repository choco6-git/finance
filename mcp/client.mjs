// Thin HTTP client for the finance app's /api/reports endpoints.
// Kept separate from the MCP wiring so it can be unit-tested or reused by a CLI.

export const TERMINAL = ["completed", "failed", "cancelled"];

export class FinanceApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createClient({
  baseUrl = "http://localhost:3000",
  valyuToken,
  fetchImpl = fetch,
  requestTimeoutMs = 60_000,
} = {}) {
  const root = baseUrl.replace(/\/+$/, "");

  async function call(method, path, body) {
    let res;
    try {
      res = await fetchImpl(root + path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (e) {
      throw new FinanceApiError(
        `Cannot reach finance app at ${root} (${e?.cause?.code ?? e?.name ?? e}). Is the server running?`,
        0,
      );
    }
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new FinanceApiError(`Non-JSON response from ${path} (HTTP ${res.status})`, res.status);
    }
    if (!res.ok || data?.error) {
      const msg = data?.message || data?.error || `HTTP ${res.status}`;
      throw new FinanceApiError(`${path}: ${msg}`, res.status);
    }
    return data;
  }

  const tokenBody = valyuToken ? { valyuAccessToken: valyuToken } : {};
  const tokenQuery = valyuToken ? `?valyuAccessToken=${encodeURIComponent(valyuToken)}` : "";

  return {
    async startResearch({ query, mode, workflowSlug, workflowParams, title, tools }) {
      const body = { mode, title, tools, ...tokenBody };
      if (workflowSlug) {
        body.workflow_slug = workflowSlug;
        body.workflow_params = workflowParams ?? {};
      } else {
        body.query = query;
      }
      const data = await call("POST", "/api/reports", body);
      return data.report;
    },

    async getResearch(id) {
      const data = await call("GET", `/api/reports/${encodeURIComponent(id)}${tokenQuery}`);
      return data.report;
    },

    async cancelResearch(id) {
      const data = await call("POST", `/api/reports/${encodeURIComponent(id)}/cancel`, tokenBody);
      return data.report;
    },

    async listResearch() {
      const data = await call("POST", "/api/reports/history", tokenBody);
      if (data.authExpired) throw new FinanceApiError("Valyu auth required or expired", 401);
      if (data.syncError) throw new FinanceApiError(data.syncError, 502);
      return data.reports ?? [];
    },

    async listWorkflows(vertical) {
      const qs = vertical ? `?vertical=${encodeURIComponent(vertical)}` : "";
      const data = await call("GET", `/api/workflows${qs}`);
      return data.workflows ?? [];
    },

    /** Poll until the task is terminal or `waitSeconds` elapses. */
    async waitForResearch(id, { waitSeconds = 0, pollSeconds = 10, sleep = defaultSleep } = {}) {
      const deadline = Date.now() + waitSeconds * 1000;
      let report = await this.getResearch(id);
      while (!TERMINAL.includes(report.status) && Date.now() < deadline) {
        await sleep(Math.min(pollSeconds * 1000, Math.max(0, deadline - Date.now())));
        report = await this.getResearch(id);
      }
      return report;
    },
  };
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shape a report for an LLM: drop bulky fields, cap output length. */
export function summarizeReport(report, { maxChars = 40_000, includeSources = false } = {}) {
  const out = {
    id: report.id,
    status: report.status,
    title: report.title,
    mode: report.mode,
    query: report.query ?? undefined,
    created_at: report.created_at ?? undefined,
    completed_at: report.completed_at ?? undefined,
    error_message: report.error_message ?? undefined,
    pdf_url: report.pdf_url ?? undefined,
    deliverables: report.deliverables?.map((d) => ({ type: d.type, title: d.title, url: d.url })),
    images: report.images?.map((i) => ({ title: i.title, url: i.imageUrl })),
    source_count: Array.isArray(report.sources) ? report.sources.length : undefined,
  };
  if (includeSources && Array.isArray(report.sources)) out.sources = report.sources;
  if (report.output) {
    out.output_truncated = report.output.length > maxChars;
    out.output = out.output_truncated
      ? report.output.slice(0, maxChars) + `\n\n[...truncated ${report.output.length - maxChars} chars; call again with a larger max_chars]`
      : report.output;
  }
  if (!TERMINAL.includes(report.status)) {
    out.hint = "Still running. Call finance_get_research again with wait_seconds to keep waiting.";
  }
  return JSON.parse(JSON.stringify(out)); // strip undefined
}

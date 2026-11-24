import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, summarizeReport, FinanceApiError } from "./client.mjs";

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const { status = 200, json } = handler(url, init, calls.length);
    return { ok: status < 400, status, text: async () => JSON.stringify(json) };
  };
  return { impl, calls };
}

test("startResearch sends freeform query with tools", async () => {
  const f = fakeFetch(() => ({ json: { report: { id: "t1", status: "queued" } } }));
  const c = createClient({ baseUrl: "http://x/", fetchImpl: f.impl });
  const r = await c.startResearch({ query: "NVDA thesis", mode: "fast", tools: { charts: true } });
  assert.equal(r.id, "t1");
  assert.equal(f.calls[0].url, "http://x/api/reports");
  assert.deepEqual(f.calls[0].body, { query: "NVDA thesis", mode: "fast", tools: { charts: true } });
});

test("startResearch with workflow omits query and passes token", async () => {
  const f = fakeFetch(() => ({ json: { report: { id: "t2" } } }));
  const c = createClient({ fetchImpl: f.impl, valyuToken: "tok" });
  await c.startResearch({ workflowSlug: "ic-memo", workflowParams: { company: "Stripe" }, mode: "standard" });
  const b = f.calls[0].body;
  assert.equal(b.query, undefined);
  assert.equal(b.workflow_slug, "ic-memo");
  assert.deepEqual(b.workflow_params, { company: "Stripe" });
  assert.equal(b.valyuAccessToken, "tok");
});

test("API error surfaces message and status", async () => {
  const f = fakeFetch(() => ({ status: 401, json: { error: "AUTH_REQUIRED", message: "Sign in with Valyu" } }));
  const c = createClient({ fetchImpl: f.impl });
  await assert.rejects(c.getResearch("t1"), (e) => e instanceof FinanceApiError && e.status === 401 && /Sign in/.test(e.message));
});

test("unreachable server gives actionable error", async () => {
  const c = createClient({ fetchImpl: async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); } });
  await assert.rejects(c.getResearch("t1"), /Cannot reach finance app.*ECONNREFUSED/);
});

test("waitForResearch polls until terminal", async () => {
  const seq = ["running", "running", "completed"];
  const f = fakeFetch((_u, _i, n) => ({ json: { report: { id: "t1", status: seq[n - 1] } } }));
  const c = createClient({ fetchImpl: f.impl });
  const r = await c.waitForResearch("t1", { waitSeconds: 60, sleep: async () => {} });
  assert.equal(r.status, "completed");
  assert.equal(f.calls.length, 3);
});

test("waitForResearch with 0 wait does a single fetch", async () => {
  const f = fakeFetch(() => ({ json: { report: { id: "t1", status: "running" } } }));
  const c = createClient({ fetchImpl: f.impl });
  const r = await c.waitForResearch("t1");
  assert.equal(r.status, "running");
  assert.equal(f.calls.length, 1);
});

test("summarizeReport truncates output and hides sources by default", () => {
  const s = summarizeReport(
    { id: "t1", status: "completed", output: "x".repeat(2000), sources: [1, 2, 3], deliverables: null },
    { maxChars: 1000 },
  );
  assert.equal(s.output_truncated, true);
  assert.match(s.output, /truncated 1000 chars/);
  assert.equal(s.source_count, 3);
  assert.equal(s.sources, undefined);
  assert.equal(s.hint, undefined);
});

test("summarizeReport adds hint while running", () => {
  assert.match(summarizeReport({ id: "t1", status: "running" }).hint, /wait_seconds/);
});

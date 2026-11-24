#!/usr/bin/env node
// stdio MCP server for the finance app's deep research API.
//
// Env:
//   FINANCE_BASE_URL     finance app URL (default http://localhost:3000)
//   FINANCE_VALYU_TOKEN  Valyu OAuth access token; only needed when the app runs
//                        with NEXT_PUBLIC_APP_MODE=valyu (self-hosted mode needs none)
//
// stdout carries the MCP protocol, so log only to stderr.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient, summarizeReport } from "./client.mjs";

const client = createClient({
  baseUrl: process.env.FINANCE_BASE_URL || "http://localhost:3000",
  valyuToken: process.env.FINANCE_VALYU_TOKEN || undefined,
});

const server = new McpServer({ name: "finance", version: "0.1.0" });

const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });
const guard = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (e) {
    return fail(e);
  }
};

const maxCharsArg = z
  .number().int().min(1000).max(500_000).default(40_000)
  .describe("Max characters of report markdown to return");

server.registerTool(
  "finance_start_research",
  {
    title: "Start financial deep research",
    description:
      "Launch an asynchronous deep-research task (cited financial analysis from filings, market data, news, etc.). " +
      "Returns a task id immediately; results take minutes (fast ~2-5m, standard ~5-15m, heavy longer). " +
      "Use finance_get_research with wait_seconds to fetch the result. Each run costs Valyu API credits. " +
      "Provide either `query` (freeform) or `workflow_slug` + `workflow_params` (see finance_list_workflows).",
    inputSchema: {
      query: z.string().min(3).optional().describe("Freeform research question, e.g. 'NVDA long thesis vs sector peers'"),
      mode: z.enum(["fast", "standard", "heavy"]).default("standard").describe("Depth/cost tradeoff"),
      workflow_slug: z.string().optional().describe("Run a predefined workflow instead of a freeform query"),
      workflow_params: z.record(z.string(), z.unknown()).optional().describe("Parameters for the workflow"),
      title: z.string().optional(),
      charts: z.boolean().default(true).describe("Allow chart generation"),
      code_execution: z.boolean().default(false).describe("Allow code execution for quantitative analysis"),
    },
  },
  guard(async (a) => {
    if (!a.query && !a.workflow_slug) throw new Error("Provide `query` or `workflow_slug`.");
    const report = await client.startResearch({
      query: a.query,
      mode: a.mode,
      workflowSlug: a.workflow_slug,
      workflowParams: a.workflow_params,
      title: a.title,
      tools: a.workflow_slug ? undefined : { charts: a.charts, codeExecution: a.code_execution },
    });
    return { id: report.id, status: report.status, title: report.title, mode: report.mode };
  }),
);

server.registerTool(
  "finance_get_research",
  {
    title: "Get research status/result",
    description:
      "Get a research task's status and, once completed, its markdown report, PDF link and deliverables. " +
      "Set wait_seconds to block until it finishes (polls every 10s) or the wait elapses.",
    inputSchema: {
      id: z.string().min(1).describe("Task id from finance_start_research or finance_list_research"),
      wait_seconds: z.number().int().min(0).max(600).default(0),
      max_chars: maxCharsArg,
      include_sources: z.boolean().default(false).describe("Include the full source list (can be large)"),
    },
  },
  guard(async (a) => {
    const report = await client.waitForResearch(a.id, { waitSeconds: a.wait_seconds });
    return summarizeReport(report, { maxChars: a.max_chars, includeSources: a.include_sources });
  }),
);

server.registerTool(
  "finance_cancel_research",
  {
    title: "Cancel research",
    description: "Cancel a running research task.",
    inputSchema: { id: z.string().min(1) },
  },
  guard(async ({ id }) => {
    const r = await client.cancelResearch(id);
    return { id: r.id, status: r.status };
  }),
);

server.registerTool(
  "finance_list_research",
  {
    title: "List past research",
    description: "List previous research tasks (newest first) with id, title, status and date.",
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20),
      status: z.enum(["queued", "running", "completed", "failed", "cancelled"]).optional(),
    },
  },
  guard(async ({ limit, status }) => {
    const reports = await client.listResearch();
    return reports
      .filter((r) => !status || r.status === status)
      .slice(0, limit)
      .map((r) => ({ id: r.id, title: r.title, status: r.status, query: r.query ?? undefined, created_at: r.created_at }));
  }),
);

server.registerTool(
  "finance_list_workflows",
  {
    title: "List research workflows",
    description:
      "List predefined financial research workflows (investment banking, PE/VC, hedge funds, sales/GTM) " +
      "with their slugs and required parameters, for use with finance_start_research.",
    inputSchema: {
      vertical: z.string().optional().describe("Filter by vertical id"),
    },
  },
  guard(async ({ vertical }) => client.listWorkflows(vertical)),
);

await server.connect(new StdioServerTransport());
console.error(`[finance-mcp] ready (base ${process.env.FINANCE_BASE_URL || "http://localhost:3000"})`);

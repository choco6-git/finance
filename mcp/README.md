# finance-mcp

stdio MCP server that exposes this app's deep research API to AI agents
(Claude Code, Claude Desktop, Codex, and agents launched by OpenAlice).

It is a thin client over the running Next.js app (`/api/reports`, `/api/workflows`),
so the app must be running (`./finance.sh start`).

## Tools

| Tool | What it does |
|---|---|
| `finance_start_research` | Launch a research task from a freeform `query` or a `workflow_slug` + `workflow_params`. Returns a task id right away. |
| `finance_get_research` | Status and result (markdown, PDF link, deliverables). `wait_seconds` (max 600) blocks until the task finishes. |
| `finance_cancel_research` | Cancel a running task. |
| `finance_list_research` | Past tasks, newest first. |
| `finance_list_workflows` | Predefined workflows and their variables (the variable `key`s become `workflow_params`). |

Research runs asynchronously and takes minutes. Each run spends Valyu API credits.

## Setup

```bash
cd mcp && pnpm install --ignore-workspace
```

| Env | Default | Notes |
|---|---|---|
| `FINANCE_BASE_URL` | `http://localhost:3000` | URL of the running app |
| `FINANCE_VALYU_TOKEN` | — | Needed only when the app runs with `NEXT_PUBLIC_APP_MODE=valyu`. Self-hosted mode uses the server's `VALYU_API_KEY`. |

### Claude Code (also used by OpenAlice workspaces running Claude Code)

```bash
claude mcp add --scope user finance -- node /path/to/finance/mcp/server.mjs
```

### Claude Desktop / generic `mcpServers` JSON

```json
{
  "mcpServers": {
    "finance": {
      "command": "node",
      "args": ["/path/to/finance/mcp/server.mjs"],
      "env": { "FINANCE_BASE_URL": "http://localhost:3000" }
    }
  }
}
```

## Security

In self-hosted mode the app's research API has no auth: anyone who can reach
port 3000 can spend your Valyu credits. Keep it on localhost or a trusted
network (LAN/Tailscale).

## Tests

```bash
cd mcp && node --test
```

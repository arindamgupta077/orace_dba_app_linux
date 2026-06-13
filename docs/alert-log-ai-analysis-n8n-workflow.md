# Alert Log AI Analysis — n8n Workflow

This document describes the n8n workflow for the `analyze_alert_log` action, which accepts Oracle alert log text from the DBA Portal and returns an AI-generated Root Cause Analysis (RCA).

---

## How It Is Triggered

The user runs either:

- **Check Alert by Time Range** (Section 2) — queries `v$diag_alert_ext` and displays rows in a table
- **Check Alert Log — Last N Lines** (Section 3) — fetches raw alert log lines via PowerShell

After results appear, the user clicks **Analyze with AI**. The app collects the displayed log text and sends it to n8n via the standard webhook.

---

## Payload Contract

```json
POST NEXT_PUBLIC_DBA_WEBHOOK_URL
{
  "action": "analyze_alert_log",
  "db": "ORCL",
  "params": {
    "alert_log_text": "<full alert log text as a plain string>"
  },
  "requested_by": "ARINDAM",
  "user_id": 1,
  "environment": "PROD",
  "os": "Windows",
  "db_type": "Standalone"
}
```

`params.alert_log_text` is the raw text the user is looking at:

- **From Section 2 (time range):** rows formatted as `[YYYY-MM-DDTHH:MM:SS.sssZ] <message_text>`, one per line.
- **From Section 3 (last N lines):** the raw PowerShell `Get-Content -Tail N` output.

The text can be up to several hundred KB for large time windows. Truncate or summarize in n8n before sending to the LLM if the model has a context limit.

---

## n8n Workflow Shape

### Node Order

```
Webhook  →  Validate Action  →  Prepare Prompt  →  AI/LLM Node  →  Format Response  →  Respond to Webhook
```

### 1. Webhook Node

- **Method:** POST
- **Path:** same as `NEXT_PUBLIC_DBA_WEBHOOK_URL`
- **Authentication:** check `X-DBA-Token` header if token auth is enabled

### 2. Validate Action (Code Node)

```js
const body = $json.body ?? $json;
if (body.action !== "analyze_alert_log") {
  throw new Error("Unexpected action: " + body.action);
}

const alertLogText = (body.params?.alert_log_text ?? "").trim();
if (!alertLogText) {
  throw new Error("params.alert_log_text is required and must not be empty.");
}

// Optional: truncate to ~12 000 chars to stay within LLM context limits
const MAX_CHARS = 12000;
const truncated = alertLogText.length > MAX_CHARS
  ? alertLogText.slice(0, MAX_CHARS) + "\n\n[...truncated — showing first " + MAX_CHARS + " characters]"
  : alertLogText;

return [{ json: { ...body, _alert_log_text: truncated } }];
```

### 3. Prepare Prompt (Code Node)

Build the system and user prompts for the LLM.

```js
const body = $("Validate Action").first().json;
const db   = body.db ?? "UNKNOWN";
const logText = body._alert_log_text;

const systemPrompt = `You are an expert Oracle Database Administrator performing a Root Cause Analysis (RCA) of Oracle alert log output. Your response MUST use the following formatting rules exactly:

FORMATTING RULES:
- Use GitHub-Flavored Markdown throughout.
- Start with a level-2 heading: ## 🧠 AI Root Cause Analysis — Oracle Alert Log
- Use emojis to signal severity inline:
    🔴 for CRITICAL issues  🟠 for WARNING  🟢 for OK/healthy  🔵 for INFO/notes
- Present the issue summary as a Markdown table with columns: # | Issue | Severity | Impact
- For each identified issue use a level-2 heading prefixed with the severity emoji.
- Under each issue include three subsections in bold: **Root Cause**, **Impact**, **Recommended Actions**
- Recommended Actions must be a numbered list (not bullets).
- Where relevant, include Oracle-specific commands in inline code (e.g. \`ALTER SYSTEM FLUSH SHARED_POOL;\`) or fenced code blocks.
- If there is data that benefits from tabular layout (e.g. redo log groups, action plan), present it as a Markdown table.
- End with a ## ✅ Action Plan table with columns: Priority | Action | Effort | Risk
- Use a blockquote (>) for any important advisory or correlation note, prefixed with 🔵.
- Separate major sections with a horizontal rule (---).
- Keep the tone professional and concise. Avoid filler text.

Focus only on actual issues visible in the log. If the log contains no errors, respond with a 🟢 healthy summary and a brief confirmation.`;

const userPrompt = `Analyze the following Oracle alert log from database **${db}** and produce the RCA report:\n\n\`\`\`\n${logText}\n\`\`\``;

return [{ json: { system_prompt: systemPrompt, user_prompt: userPrompt, db, requested_by: body.requested_by } }];
```

### 4. AI / LLM Node

Use any supported LLM provider (OpenAI, Azure OpenAI, Anthropic, Ollama, etc.).

**OpenAI Chat Model recommended settings:**

| Setting | Value |
|---------|-------|
| Model | `gpt-4o` or `gpt-4o-mini` |
| System Message | `{{ $json.system_prompt }}` |
| User Message | `{{ $json.user_prompt }}` |
| Max Tokens | 2000 |
| Temperature | 0.2 |

**If using Azure OpenAI:** set `Deployment Name` to your deployed model (e.g. `gpt-4o`), and configure the Azure OpenAI credentials in n8n.

**If using Ollama (local):** use the Ollama node with model `llama3` or `mistral`. Adjust `Max Tokens` based on model capacity.

The output from the LLM node is available as:
- OpenAI: `$json.message.content`
- Azure OpenAI: `$json.choices[0].message.content`
- Ollama: `$json.response`

### 5. Format Response (Code Node)

```js
// Read LLM output — adjust the key based on your LLM provider
const llmOutput =
  $json.message?.content          // OpenAI Chat Model node
  ?? $json.choices?.[0]?.message?.content  // raw OpenAI API
  ?? $json.response               // Ollama
  ?? $json.content                // Anthropic
  ?? $json.text
  ?? "No AI analysis returned.";

const prevNode = $("Prepare Prompt").first().json;
const db       = prevNode.db ?? "UNKNOWN";
const reqBy    = prevNode.requested_by ?? "system";

return [
  {
    json: {
      status: "success",
      request_id: `N8N-${Date.now()}`,
      action: "analyze_alert_log",
      db,
      db_status: "unknown",
      ai_summary: llmOutput,
      findings: [],
      recommendations: [],
      raw_data: {
        rows: []
      },
      raw_output: llmOutput
    }
  }
];
```

> The app reads `ai_summary` first, then falls back to `raw_output`. Populate at least one of them.

### 6. Respond to Webhook Node

- **Respond With:** Last Node
- **Response Code:** 200
- **Response Body:** JSON from Format Response node

---

## Response Format

```json
{
  "status": "success",
  "request_id": "N8N-1749657600000",
  "action": "analyze_alert_log",
  "db": "ORCL",
  "db_status": "unknown",
  "ai_summary": "## AI Root Cause Analysis — Oracle Alert Log\n\n### Summary\n...",
  "findings": [],
  "recommendations": [],
  "raw_data": {
    "rows": []
  },
  "raw_output": "## AI Root Cause Analysis — Oracle Alert Log\n\n..."
}
```

The app renders `ai_summary` inside the **AI Root Cause Analysis** panel that appears below the result table/terminal in Sections 2 and 3.

---

## Enriched Response (Optional)

You can optionally populate `findings` and `recommendations` from an additional Code node that parses the LLM output:

```js
// Parse LLM text to extract structured findings (optional enrichment)
const llmText = $("Format Response").first().json.ai_summary;

const findings = [];
const recommendations = [];

// Detect ORA-XXXXX patterns and create a finding per unique code
const oraCodes = [...new Set([...llmText.matchAll(/ORA-\d{4,5}/g)].map((m) => m[0]))];
for (const code of oraCodes) {
  findings.push({
    title: `${code} detected in alert log`,
    detail: `The error ${code} was found in the alert log text. See AI analysis for root cause details.`,
    severity: code.startsWith("ORA-006") ? "critical" : "warning"
  });
}

return [{ json: { ...$("Format Response").first().json, findings, recommendations } }];
```

---

## Error Handling

If the LLM call fails or times out, return an error envelope:

```js
return [
  {
    json: {
      status: "error",
      request_id: `N8N-${Date.now()}`,
      action: "analyze_alert_log",
      db: $("Validate Action").first().json.db ?? "UNKNOWN",
      db_status: "unknown",
      ai_summary: "AI analysis failed. Please try again or check n8n logs.",
      findings: [],
      recommendations: [],
      raw_data: { rows: [] },
      raw_output: ""
    }
  }
];
```

The app will surface `ai_summary` in the error state of the AI panel.

---

## Security Notes

- The alert log text can contain sensitive hostnames, schema names, and internal Oracle parameters. Ensure the LLM provider is approved for your environment.
- If using a cloud LLM, consider redacting hostnames and IP addresses in the Prepare Prompt node before sending.
- Add `X-DBA-Token` header validation in the webhook node to prevent unauthenticated submissions.

---

## Switch Node Integration

If your n8n workflow uses a Switch node to route by `action`, add a branch for `analyze_alert_log`:

```
Switch (action)
├── check_alert_by_time  →  Oracle DB node (v$diag_alert_ext query)
├── check_alert_by_lines →  Execute Command node (PowerShell Get-Content)
└── analyze_alert_log    →  Validate Action → Prepare Prompt → LLM → Format Response
```

---

## App Files Changed

- `components/action/alert-log-page.tsx` — Analyze with AI button + `AiAnalysisPanel` in Sections 2 & 3
- `services/api.ts` — `analyzeAlertLog()` function
- `lib/action-catalog.ts` — `analyze_alert_log` action definition
- `types/dba.ts` — `analyze_alert_log` added to `DbaAction` union
- `services/mock-data.ts` — mock RCA response for `analyze_alert_log`
- `docs/alert-log-ai-analysis-n8n-workflow.md` — this file

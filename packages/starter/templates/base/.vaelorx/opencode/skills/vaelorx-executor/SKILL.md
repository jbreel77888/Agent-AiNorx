---
name: vaelorx-executor
description: How to reach third-party systems from a VaelorX session via the Executor — one interface to every configured integration (Pipedream, MCP, OpenAPI, GraphQL, HTTP), exposed as the `vaelorx-executor` MCP server's tools (connectors, discover, describe, call). Load whenever the user asks the agent to DO something in an external app/API (send an email, create a Stripe charge, post to Slack, query an internal API, call any SaaS), asks "what integrations/connectors/tools do I have", asks to add/configure a connector. The agent must use the Executor's MCP tools rather than hand-rolling API calls with raw tokens.
---

<skill name="vaelorx-executor">

<overview>
The **Executor** is the one way an agent reaches outside systems. Instead of
juggling per-app SDKs and raw tokens, you use the **`vaelorx-executor` MCP
server**, auto-loaded into every session. It talks to the VaelorX **Executor
Gateway**, which holds the credentials, checks what you're allowed to use, runs
the call, and audits it.

It exposes a small, stable set of MCP tools — not one tool per integration — so
you **progressively discover** what you need instead of drowning in a giant
catalog:

- **`connectors`** — what this session can use (provider, status, tool count)
- **`discover`** — intent search across every usable tool
- **`describe`** — one tool's full input schema + risk
- **`call`** — run a tool
- **`add_connector` / `remove_connector`** — declare or remove connectors
- **`connect` / `request_secret`** — mint a short-lived human setup link for
  OAuth/API-key credentials without exposing secrets to the sandbox

**You never see a third-party secret.** The gateway resolves it server-side.
The sandbox only carries `$KORTIX_EXECUTOR_TOKEN`, which makes every call act
**as the user who launched the session** — so you can only use connectors
that user has been granted.

**IMPORTANT: Do NOT use `kortix` CLI commands.** All connector operations
go through the `vaelorx-executor` MCP tools. The `kortix` CLI is a legacy
tool that does not work in session mode.
</overview>

<when-to-load>
Load this skill when the user wants to:
- Act in an external app/API — "send an email", "create a charge", "post to
  Slack", "create a GitHub issue", "query our internal API".
- See what's available — "what integrations / connectors / tools do I have?"
- Add or configure a connector.

If the task is purely local (editing files, running tests) you don't need this.
</when-to-load>

<usage>
Use the `vaelorx-executor` MCP tools. All return JSON.

**Loop: `discover` → `describe` → `call`.** Always `describe` an unfamiliar tool
to learn its input schema before you `call` it.

1. **See what this session can use** — call `connectors` (no args). Returns each
   connector's slug, provider, status, and tool count.
2. **Find a tool by intent** — call `discover` with
   `{ "query": "send a slack message" }` (optionally `"limit"`). Returns the
   best-matching tool paths with their risk + description.
3. **Inspect a tool before calling it** — call `describe` with
   `{ "tool": "gmail.get_emails" }`. Returns the full input JSON schema.
4. **Run it** — call `call` with
   `{ "connector": "gmail", "action": "get_emails", "args": { "max": 10 } }`.
   The gateway attaches the credential, enforces sharing + policy, runs it, and
   audits it.
</usage>

<rules>
- **Use the Executor's MCP tools — do not hand-roll** HTTP calls to third-party
  APIs with raw tokens. There are no raw third-party tokens in the sandbox by
  design.
- **Do NOT use `kortix` CLI commands** — they do not work in session mode.
  Use only the `vaelorx-executor` MCP tools.
- If `connectors` is empty or a tool is missing, the connector isn't configured.
  Use `add_connector` and then `connect` to surface a setup link to the human.
- A `call` result of `ok: false` with `denied` (`not_shared` / `needs_auth`)
  means exactly that — surface it. For `needs_auth`, mint the appropriate setup
  link (`connect` for Pipedream OAuth, `request_secret` for API keys) instead of
  asking the user to paste credentials into chat.
- Tools carry a **risk** (read / write / destructive). Be deliberate with
  `write`/`destructive` calls; confirm intent with the user for irreversible ones.
</rules>

<adding-connectors>
Connectors are managed through the `vaelorx-executor` MCP tools or the
VaelorX web dashboard at `/connectors`. 

**One-click setup (no dashboard hunting).** In a session, use the MCP tools:

```jsonc
// Add the connector via add_connector tool
{ "slug": "github", "provider": "pipedream", "app": "github" }
// Then call `connect` with { "slug": "github" } and surface the returned URL.
```

That's the whole setup for a new integration: add → connect (click the link). The
connected app's tools are then reachable via the `call` tool.
</adding-connectors>

</skill>

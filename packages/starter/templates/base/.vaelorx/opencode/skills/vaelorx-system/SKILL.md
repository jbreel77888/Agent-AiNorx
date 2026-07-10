---
name: vaelorx-system
description: "Canonical reference for a VaelorX session: the session sandbox model, the vaelorx.toml manifest, the OpenCode runtime (agents, skills, commands, tools, plugins, MCP servers, permissions, models), and how to work within a session. Load whenever the user asks how VaelorX works, about `vaelorx.toml`, anything under `.vaelorx/opencode/`, or to author/edit any OpenCode primitive."
---

<skill name="vaelorx-system">

<overview>
A **VaelorX session** is an isolated sandbox VM with a `/workspace` directory.
The session has a `vaelorx.toml` manifest and an OpenCode config directory
at `.vaelorx/opencode/`.

The session has two configuration surfaces with strict ownership:

- **VaelorX config** — `vaelorx.toml` at the workspace root. The platform reads this.
- **OpenCode config** — `.vaelorx/opencode/` (`opencode.jsonc`, agents, skills, commands, tools, plugins). OpenCode reads this; the platform never touches it.

The default agent runtime inside every session is **OpenCode**. The same `.vaelorx/opencode/` config dir drives the session.
</overview>

<when-to-load>
Load this skill when the user asks:
- "How does VaelorX work?" / "What is `vaelorx.toml`?"
- "How do I add/edit an agent/skill/command/tool/plugin?"
- "What's in `.vaelorx/opencode/`?"
- "How do sessions work?"
</when-to-load>

<session-model>
A VaelorX session is:
- One conversation → one ephemeral sandbox VM → one `/workspace`
- The sandbox runs OpenCode as the agent runtime
- The sandbox has the `vaelorx-executor` MCP server (for connectors)
- The sandbox has custom tools (web_search, scrape_webpage, image_search, memory, show)
- Sessions are isolated — no access to other sessions
- Environment variables are injected by the platform (KORTIX_API_URL, KORTIX_EXECUTOR_TOKEN, etc.)
</session-model>

<vaelorx-toml>
The `vaelorx.toml` file at the workspace root is the project manifest.

```toml
vaelorx_version = 1

[project]
name = "default"
description = "A VaelorX session."

[env]
required = []
optional = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]

[opencode]
config_dir = ".vaelorx/opencode"

[[agents]]
name = "vaelorx"
model = "deepseek-v4-flash-free"
```

Key sections:
- `[project]` — name, description
- `[env]` — which env vars are required/optional
- `[opencode]` — where the OpenCode config lives
- `[[agents]]` — agent definitions
</vaelorx-toml>

<opencode-config>
OpenCode config lives in `.vaelorx/opencode/`:

| Path | Purpose |
|------|---------|
| `opencode.jsonc` | Main config (default_agent, permission, plugins) |
| `agents/` | Agent definition files (`.md` with frontmatter) |
| `skills/` | Skill definitions (`<name>/SKILL.md`) |
| `commands/` | Slash command definitions |
| `tools/` | Custom tool implementations (`.ts` files) |
| `plugins/` | Plugin implementations |
| `package.json` | Dependencies for custom tools |

**Agents** are defined as Markdown files with YAML frontmatter:
```markdown
---
description: Agent description
mode: primary
permission:
  "*": allow
---
Agent system prompt here...
```

**Skills** are loaded on-demand by the agent. Each skill is a folder with `SKILL.md`.
</opencode-config>

<connectors>
Connectors are managed through the `vaelorx-executor` MCP server and the
VaelorX web dashboard. **Do NOT use `kortix` CLI** — it is a legacy tool
that does not work in session mode.

To use connectors:
1. Browse and connect apps at `$KORTIX_FRONTEND_URL/connectors`
2. Use the `vaelorx-executor` MCP tools (connectors, discover, describe, call)
3. See the `vaelorx-executor` skill for detailed usage
</connectors>

<environment>
Key environment variables in the sandbox:
- `KORTIX_API_URL` — the VaelorX API endpoint
- `KORTIX_EXECUTOR_TOKEN` — token for executor gateway auth
- `KORTIX_FRONTEND_URL` — the browsable dashboard URL
- `KORTIX_DEFAULT_MODEL` — the LLM model to use
- `KORTIX_LLM_API_KEY` — LLM provider API key
- `KORTIX_LLM_BASE_URL` — LLM provider base URL
- `KORTIX_SESSION_ID` — current session ID
- `KORTIX_WORKSPACE` — workspace path (usually `/workspace`)
</environment>

</skill>

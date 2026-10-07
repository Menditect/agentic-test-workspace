# Gemini / Antigravity Workspace Directives

You are operating within the Menditect Agent Workspace Template. 
Please refer to `AGENTS.md` for core rules and available skills.

When working with Mendix, remember:
1. Always prefer using the provided `./mxcli` wrappers (or StudioPro MCP if available) over raw file searching.
2. Read the skills in the `skills/` folder to understand MTA test execution and analysis flows.
3. The SQLite catalog (`.mxcli/catalog.db`) powers code search and callers/callees. Rebuild via `./mxcli -c "REFRESH CATALOG SOURCE FORCE;"` (or `REFRESH CATALOG FULL FORCE;` for fast structural mode). Note: On large projects, compiling full MDL source definitions can take multiple minutes or up to 1 hour.

## Skills & Tools Immutability & Customization Rule (PAT-113, ANTI-62)
- Official MTA skills in `skills/` and linter tooling (`tools/mta-lint.mjs`) are managed upstream and completely replaced/overwritten during updates (`npm run update` or `npm run update:skills`).
- **NEVER make inline modifications** to official MTA skills in `skills/` or `tools/mta-lint.mjs` in consumer workspaces (`ANTI-62`). Any inline edits will be erased on update.
- **Custom Skills:** Custom organization or domain skills must always be added as separate, new skill folders alongside the MTA skills.
- **Custom Linter Overrides (`tools/mta-lint.custom.mjs`):** If a local bug fix, custom check, or false-positive bypass is required:
  1. Copy `tools/mta-lint.mjs` to `tools/mta-lint.custom.mjs`.
  2. Apply changes strictly to `tools/mta-lint.custom.mjs`.
  3. The linter runner (`tools/run-linter.mjs` used by `npm run lint:*`) automatically detects and executes `tools/mta-lint.custom.mjs`.
- **Upstream Feedback & Contribution Protocol:** Whenever a bug, false positive, or required customization is encountered in skills or linters, the AI must proactively offer:
  1. To create a branch and submit a GitHub Pull Request against `https://github.com/Menditect/agentic-test-workspace` (for linters/tools) or `https://github.com/Menditect/agentic-test-skills` (for skills).
  2. OR output a structured bug report email template addressed to `support@menditect.com` containing the problem description, reproducible scenario, proposed code diff, and acceptance criteria.

## Repository Architecture & Upstream SSOT
- **Skills Build Repository (`mta-ai-assistant`)**: The internal engineering repository meant for building MTA skills (work occurs on `development`). It is NOT the public contract source.
- **Official Public Skills Repository (`agentic-test-skills`)**: The official public repository (`https://github.com/Menditect/agentic-test-skills`) where MTA skills, contracts (`mta_config.schema.json`), and patterns are published.
- **Public Reference Rule**: In `agentic-test-workspace`, you MUST ALWAYS refer to files, contracts, schemas, and skills from the public `agentic-test-skills` repository. NEVER refer to `mta-ai-assistant` in public documentation, contracts, schemas, release notes, or commit messages.
- **Template Release Version**: Governed exclusively by the user when publishing. Applies ONLY to `package.json`, `RELEASES.md`, `releases/`, and git tags.
- **mta_config Contract Version**: SSOT is `agentic-test-skills` (`references/mta_config.schema.json`). NEVER bump or modify `mta_config` version when releasing `agentic-test-workspace`. It must strictly match `agentic-test-skills`.

## Cloned Repository Immutability Rule (Tools Isolation)
- When running `npm run setup` (or updating/syncing), `agentic-test-workspace` acts purely as an external tools engine.
- NEVER write, modify, or generate files (such as `mta_config.json`, `.env`, modified agent directives, or workspace artifacts) inside the cloned `agentic-test-workspace/` directory when configured for an external or parent workspace (`workspaceDir !== toolsRootDir`).
- All workspace configuration, secrets, agent directives, skills, runners, and execution plans MUST be written exclusively to `workspaceDir` (e.g. parent workspace or Mendix project directory).
- The `agentic-test-workspace` git worktree must remain 100% clean so that upstream git pulls (`git pull origin main`) never encounter merge conflicts, local dirty state, or leaked environment secrets.

## Upstream Skills & Tools Update Protocol
- When asked to update `skills` or `mxcli` (or check for updates):
  1. Inspect local vs remote versions across all skills (`AGENTS.md` orchestrator and individual `SKILL.md` domain skills) and `mxcli` (e.g. via `node scripts/sync-upstream.js --check` or `npm run update:check`).
  2. Present the detailed comparison table to the user showing which specific skills have updates and which are already up-to-date.
  3. Prompt the user for explicit confirmation before applying any updates.

## Git Workflow & Branching Strategy
- **`development` Branch (Default Working Branch)**: All active development, feature additions, bug fixes, and day-to-day commits MUST occur on the `development` branch.
- **`main` Branch (Release-Only Branch)**: The `main` branch is strictly reserved for official releases. Never commit directly to `main`.
- **Release Publication Protocol**:
  1. Prepare the release on `development` (`npm run release`).
  2. Commit and push changes to `origin/development`.
  3. Merge `development` into `main` and push to `origin/main` (`git checkout main && git pull origin main && git merge development --no-edit && git push origin main`).
  4. GitHub Actions automatically creates the git tag and publishes the official GitHub Release with release notes from `releases/v<version>.md`.
  5. **CRITICAL POST-RELEASE RULE**: ALWAYS immediately switch back to `development` after publishing a release (`git checkout development`). Never remain on or continue working from `main`.

# Menditect Architecture Setup
- **CRITICAL OPERATIONAL COMMAND:** Always execute tasks using the core rules defined in `skills/AGENTS.md`.
- **ENVIRONMENT SSOT:** All environment configuration (Application name, MTA Base URL, Default App Instance, and ApplicationInstanceToken) must be dynamically loaded from `mta_config.json`.
- **NATIVE MCP TOOL EXECUTION MANDATE:** You MUST ALWAYS use native IDE MCP tools (`mta`, `mta_plugin`, `execute-testcase`, `call_mcp_tool`) for all Menditect MTA cloud authoring and test execution tasks. Never create, generate, or execute ad-hoc Node/shell runner scripts (e.g. `build-*.js`, `run-*.js`, CLI bridges) or manual HTTP/curl calls to interact with MTA.
- **MCP SUBPROCESS PROTECTION & TOKEN ROTATION:** NEVER execute terminal commands (`Stop-Process`, `taskkill`, `kill`) against running MCP server/proxy processes (`mta-proxy.js`, `node.exe`, or custom proxies). Terminating stdio child processes causes AI IDEs (Antigravity, Cursor, Claude Desktop, VS Code) to permanently disable MCP servers for the active session. The built-in proxy reloads `.env` dynamically on every request with zero restart needed. If using a static or custom proxy that returns HTTP 401, prompt the user to update their credentials and use their IDE's "Restart MCP Server" / "Reload Window" UI action.


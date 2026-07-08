# Changelog

All notable changes to this dev container template are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions are tracked as annotated git tags (`vMAJOR.MINOR.PATCH`):

- **MAJOR**: breaking changes to the container contract (base image/OS bump,
  user rename, mount layout, removed tooling) that require you to rebuild and
  possibly re-authenticate or migrate volumes.
- **MINOR**: backwards-compatible additions (new tool, new firewall allowlist
  entry, new opt-in setting).
- **PATCH**: fixes and docs that don't change behavior for existing users.

## [1.0.0] - 2026-07-07

### Added
- Initial hardened dev container, currently provisioned with Node.js and pnpm.
- Base: own `Dockerfile` `FROM node:26.4.0-bookworm`; non-root user renamed to
  `dc-user`; pnpm installed via npm (Node 26 dropped corepack).
- Pinned tool versions for reproducible builds: `pnpm@11.10.0`,
  `@anthropic-ai/claude-code@2.1.202`, `@openai/codex@0.142.5` (Node via the
  `FROM` tag). Upgrade by editing the version and rebuilding without cache.
- Egress allowlist firewall (`initialize-firewall.sh`, iptables + ipset,
  default-DROP) re-applied on every container start.
- pnpm supply-chain hardening: blocked build scripts, `minimum-release-age`
  24h, store-integrity verification, and a zsh wrapper defaulting
  `pnpm install`/`i` to `--frozen-lockfile`.
- Persistence via named volumes shared across all projects (`~/.claude`,
  `~/.codex`, `~/.config/gh`, shell history, pnpm store): log in to the AI CLIs
  and `gh` once, unified history. Trade-off: a compromised package in any project
  can read the shared tokens. The egress firewall is the primary exfiltration
  defense; scope your `gh` PAT minimally.
- AI CLIs (Claude Code + Codex) with a switchable auth mode via `DC_AI_MODE`:
  `personal` (your own subscriptions, default) or `gateway` (a corporate AI
  gateway whose base URL is supplied via `DC_AI_GATEWAY_URL`, with Claude via
  Bedrock and Codex via `/v1`).
- Tooling: git, GitHub CLI, ripgrep/fd/bat/jq/fzf, zsh + oh-my-zsh.
- VS Code extensions: ESLint, Prettier (format-on-save), Code Spell Checker.
- Cross-platform support (macOS, Windows, Linux): `.gitattributes` forces LF line
  endings so the container's shell scripts run on Windows checkouts, plus README
  notes for WSL2, PowerShell command equivalents, and the platform-dependent VM
  boundary in the threat model.
- README **FAQ** section covering enabling/running, updating, volumes & tokens,
  connecting to host services, disk/image sizing, and cross-platform usage.

[1.0.0]: https://github.com/narkhedegs/development-container/releases/tag/v1.0.0

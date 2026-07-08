#!/usr/bin/env bash
# post-create.sh. This runs ONCE after the container is assigned. It configures
# pnpm hardening, the AI CLIs, and zsh. Secrets come from the environment
# (forwarded via remoteEnv) and are never committed.
set -euo pipefail

echo "[post-create] configuring pnpm..."
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
export PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"
pnpm config set store-dir "${PNPM_HOME}" --global

# Supply-chain hardening: block build/postinstall scripts, refuse packages
# younger than 24h, and verify the store before running.
pnpm config set dangerously-allow-all-builds false --global
pnpm config set minimum-release-age 1440 --global
pnpm config set verify-deps-before-run true --global
pnpm config set verify-store-integrity true --global
# frozen-lockfile can't be a global config key (it's install-scoped) and CI=true
# would leak into other tools, so a zsh wrapper (below) adds it to bare
# `pnpm install`/`i` only.

# DC_AI_MODE: "personal" (default) uses your own subscriptions. No provider
# config is written; you log in interactively. "gateway" routes both CLIs through
# a corporate gateway (Claude via Bedrock, Codex via /v1) at DC_AI_GATEWAY_URL,
# with tokens from ANTHROPIC_AUTH_TOKEN / CODEX_OPENAI_API_KEY.
AI_MODE="${DC_AI_MODE:-personal}"
echo "[post-create] AI mode: ${AI_MODE}"
mkdir -p "${HOME}/.claude" "${HOME}/.codex"

if [ "${AI_MODE}" = "gateway" ]; then
  GATEWAY_URL="${DC_AI_GATEWAY_URL:-}"
  if [ -z "${GATEWAY_URL}" ]; then
    echo "[post-create] ERROR: DC_AI_MODE=gateway but DC_AI_GATEWAY_URL is not set." >&2
    echo "[post-create]        Set it on the host, e.g. export DC_AI_GATEWAY_URL=https://ai-gateway.example.com" >&2
    exit 1
  fi
  GATEWAY_URL="${GATEWAY_URL%/}"

  echo "[post-create] configuring Claude Code (gateway/Bedrock)..."
  cat > "${HOME}/.claude/settings.json" <<SETTINGS
{
  "env": {
    "CLAUDE_CODE_USE_BEDROCK": "true",
    "ANTHROPIC_BEDROCK_BASE_URL": "${GATEWAY_URL}/bedrock",
    "CLAUDE_CODE_SKIP_BEDROCK_AUTH": "true",
    "ANTHROPIC_AUTH_TOKEN": "${ANTHROPIC_AUTH_TOKEN:-}",
    "AWS_REGION": "global",
    "DISABLE_PROMPT_CACHING": "false"
  }
}
SETTINGS
  [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ] && \
    echo "[post-create] WARN: ANTHROPIC_AUTH_TOKEN not set on host. Claude Code auth will be blank."

  echo "[post-create] configuring Codex (gateway)..."
  cat > "${HOME}/.codex/config.toml" <<CONFIG
model_provider = "ai-gateway"

[model_providers.ai-gateway]
name = "Corporate AI Gateway"
base_url = "${GATEWAY_URL}/v1"
wire_api = "responses"
env_key = "CODEX_OPENAI_API_KEY"

[features]
apps = false
CONFIG
  [ -f "${HOME}/.codex/auth.json" ] || echo '{}' > "${HOME}/.codex/auth.json"
  [ -z "${CODEX_OPENAI_API_KEY:-}" ] && \
    echo "[post-create] WARN: CODEX_OPENAI_API_KEY not set on host. Codex auth will be blank."
else
  # Personal mode: move aside any gateway config left in the volume from a prior
  # run so that it does not override the interactive subscription login.
  echo "[post-create] personal mode. Log in with: claude   (then)   codex login"
  if grep -q "CLAUDE_CODE_USE_BEDROCK" "${HOME}/.claude/settings.json" 2>/dev/null; then
    mv "${HOME}/.claude/settings.json" "${HOME}/.claude/settings.json.gateway.bak"
    echo "[post-create] moved gateway Claude settings aside -> settings.json.gateway.bak"
  fi
  if grep -q "model_providers.ai-gateway" "${HOME}/.codex/config.toml" 2>/dev/null; then
    mv "${HOME}/.codex/config.toml" "${HOME}/.codex/config.toml.gateway.bak"
    echo "[post-create] moved gateway Codex config aside -> config.toml.gateway.bak"
  fi
fi

echo "[post-create] configuring zsh..."
ZSHRC="${HOME}/.zshrc"
touch "${ZSHRC}"
if ! grep -q "# --- dc ---" "${ZSHRC}"; then
  cat >> "${ZSHRC}" <<'ZRC'

# --- dc ---
export HISTFILE=/commandhistory/.zsh_history
export HISTSIZE=100000
export SAVEHIST=100000
setopt SHARE_HISTORY INC_APPEND_HISTORY HIST_IGNORE_DUPS

alias cat='bat --paging=never'
alias ls='ls --color=auto'
# fzf shell integration. `--zsh` needs fzf >= 0.48; older builds (e.g. Debian
# bookworm's 0.38) don't have it. Capture fzf's own stderr and only apply if it
# produced output, so old versions stay silent instead of printing "unknown option".
if command -v fzf >/dev/null; then
  __fzf_init="$(fzf --zsh 2>/dev/null)" && [ -n "${__fzf_init}" ] && eval "${__fzf_init}"
  unset __fzf_init
fi

export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
export PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"

# Make bare `pnpm install`/`i` default to --frozen-lockfile; other subcommands
# pass through untouched.
pnpm() {
  if [[ "$1" == "install" || "$1" == "i" ]] && [[ "$*" != *"--frozen-lockfile"* ]] && [[ "$*" != *"--no-frozen-lockfile"* ]]; then
    command pnpm "$@" --frozen-lockfile
  else
    command pnpm "$@"
  fi
}
# --- /dc ---
ZRC
fi

echo "[post-create] done. Firewall applies on container start (postStart)."

#!/usr/bin/env bash
# initialize-firewall.sh: default-drop outbound egress with an explicit
# allowlist. This is the primary defense against a malicious npm package
# exfiltrating secrets. Runs at every container start (postStartCommand) via
# sudo; needs the NET_ADMIN and NET_RAW caps. To allow another host, add it to
# ALLOWED_DOMAINS or ALLOWED_CIDRS and re-run: sudo /usr/local/bin/initialize-firewall.sh
set -euo pipefail
IFS=$'\n\t'

echo "[firewall] applying egress allowlist..."

ALLOWED_DOMAINS=(
  # npm registry
  "registry.npmjs.org"
  # GitHub: git, API, releases/raw, code downloads
  "github.com"
  "api.github.com"
  "codeload.github.com"
  "objects.githubusercontent.com"
  "raw.githubusercontent.com"
  "ghcr.io"
  "pkg-containers.githubusercontent.com"
  # VS Code marketplace (server-side extension install)
  "marketplace.visualstudio.com"
  "vscode.download.prss.microsoft.com"
  # Claude Code installer + Anthropic (api + subscription OAuth login)
  "downloads.claude.ai"
  "api.anthropic.com"
  "claude.ai"
  "console.anthropic.com"
  "statsig.anthropic.com"
  # OpenAI / Codex
  "api.openai.com"
  "auth.openai.com"
  "chatgpt.com"
)

# Gateway mode: allowlist the host from the gateway URL, passed as $1 (or via
# DC_AI_GATEWAY_URL). Strip scheme, path, and port to get the hostname.
GATEWAY_URL="${1:-${DC_AI_GATEWAY_URL:-}}"
if [ -n "${GATEWAY_URL}" ]; then
  gw_host="${GATEWAY_URL#*://}"
  gw_host="${gw_host%%/*}"
  gw_host="${gw_host%%:*}"
  [ -n "${gw_host}" ] && ALLOWED_DOMAINS+=("${gw_host}")
fi

ALLOWED_CIDRS=()

iptables -F
iptables -X 2>/dev/null || true
ipset destroy allowed-egress 2>/dev/null || true
ipset create allowed-egress hash:net

iptables -A INPUT  -i lo -j ACCEPT
iptables -A OUTPUT -o lo -j ACCEPT

iptables -A INPUT  -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# DNS to the container's own resolver(s) only, so the allowlist can resolve.
while read -r ns; do
  [ -n "${ns}" ] || continue
  iptables -A OUTPUT -p udp --dport 53 -d "${ns}" -j ACCEPT
  iptables -A OUTPUT -p tcp --dport 53 -d "${ns}" -j ACCEPT
done < <(grep -E '^nameserver' /etc/resolv.conf | awk '{print $2}')

# Docker host / local networks (VS Code server, port forwarding, credential proxy).
iptables -A OUTPUT -d 10.0.0.0/8     -j ACCEPT
iptables -A OUTPUT -d 172.16.0.0/12  -j ACCEPT
iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT

for domain in "${ALLOWED_DOMAINS[@]}"; do
  ips="$(dig +short A "${domain}" | grep -E '^[0-9.]+$' || true)"
  if [ -z "${ips}" ]; then
    echo "[firewall] WARN: could not resolve ${domain} (skipping)"
    continue
  fi
  while read -r ip; do
    [ -n "${ip}" ] && ipset add allowed-egress "${ip}" 2>/dev/null || true
  done <<< "${ips}"
  echo "[firewall]   allowed ${domain}"
done

for cidr in "${ALLOWED_CIDRS[@]:-}"; do
  [ -n "${cidr}" ] && ipset add allowed-egress "${cidr}" 2>/dev/null || true
done

iptables -A OUTPUT -m set --match-set allowed-egress dst -j ACCEPT

iptables -P INPUT   DROP
iptables -P FORWARD DROP
iptables -P OUTPUT  DROP

echo "[firewall] egress allowlist active."

# Self-test: an allowed host must be reachable, a disallowed one blocked.
if curl -fsS --max-time 5 https://api.github.com/zen >/dev/null 2>&1; then
  echo "[firewall] OK: github reachable"
else
  echo "[firewall] WARN: github not reachable (check allowlist/DNS)"
fi
if curl -fsS --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "[firewall] WARN: example.com reachable; egress NOT locked down!"
else
  echo "[firewall] OK: disallowed egress blocked"
fi

FROM node:26.4.0-bookworm

ARG OLD_USER=node
ARG USERNAME=dc-user

# The base image ships a non-root `node` user (UID 1000); rename it (user, group,
# home) rather than adding a second UID-1000 user.
RUN set -eux; \
    usermod  -l "${USERNAME}" "${OLD_USER}"; \
    groupmod -n "${USERNAME}" "${OLD_USER}"; \
    usermod  -d "/home/${USERNAME}" -m "${USERNAME}"; \
    ln -s "/home/${USERNAME}" /home/node

# sudo + iptables/ipset/iproute2/dnsutils drive the egress firewall; the rest are
# TLS trust and modern shell tooling.
RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        sudo \
        iptables \
        ipset \
        iproute2 \
        dnsutils \
        ca-certificates \
        ripgrep \
        fd-find \
        bat \
        jq \
        fzf \
        less \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Debian ships these under different binary names.
RUN ln -sf "$(command -v fdfind)" /usr/local/bin/fd \
    && ln -sf "$(command -v batcat)" /usr/local/bin/bat

# Passwordless sudo so postStart can program the firewall (see no-new-privileges
# note in devcontainer.json).
RUN echo "${USERNAME} ALL=(root) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}" \
    && chmod 0440 "/etc/sudoers.d/${USERNAME}"

# Node 26 dropped corepack, so install pnpm via npm. AI CLIs are installed here
# (as root) too. Doing it at container-create time as the non-root user fails
# EACCES against the root-owned global prefix.
# All versions are pinned for reproducibility. Bump them here, then rebuild
# WITHOUT cache (this layer is cached, so a plain rebuild keeps the old versions).
RUN npm install -g \
        pnpm@11.10.0 \
        @anthropic-ai/claude-code@2.1.202 \
        @openai/codex@0.142.5

USER ${USERNAME}

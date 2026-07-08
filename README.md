# Development Container

A hardened, reusable [VS Code Dev Container](https://code.visualstudio.com/docs/devcontainers/containers)
for use as a full-time development environment, with a strong focus on
isolating malicious dependencies from your host machine. It is currently
provisioned with Node.js and pnpm.

This repository is a **GitHub template**. Click **"Use this template"** to start
a new project with this environment already in place. It is versioned using
[semantic versioning](#versioning).

The internal short name for this environment is **dc**, and it is used
throughout for the container name, the volume names, and the environment
variables.

---

## Threat Model

The goal is that hostile code pulled in as a dependency, whether that is a
malicious `postinstall` script or exploit code that runs during development or
testing, cannot do any of the following:

- read secrets or source code from anywhere on your host machine,
- send data out to an arbitrary server, or
- escape the container and reach the host.

On macOS and Windows, Docker Desktop runs every container inside a lightweight
Linux Virtual Machine, so there is a Virtual Machine boundary between the
container and your host Operating System. On native Linux there is no such
Virtual Machine, because the container shares the host kernel directly, which
means a container escape reaches the host immediately. In either case, this
environment avoids punching holes back through that boundary, and it layers
several additional defenses on top:

| Layer | Defense |
|---|---|
| **No host Docker socket** | Docker is not exposed inside the container, which closes the single biggest escape route. |
| **Isolated workspace** | Your code lives in a Docker **named volume** (created through *Clone Repository in Container Volume*), so no paths on the host are bind-mounted into the container. |
| **Egress allowlist** | `initialize-firewall.sh` installs a default-drop iptables policy, so only an explicit allowlist of destinations (the npm registry, GitHub, the VS Code marketplace, Anthropic and OpenAI, and your AI gateway) can be reached. |
| **Non-root user** | All day-to-day work runs as the unprivileged user `dc-user`. |
| **Git authentication** | VS Code forwards a credential helper and an SSH agent, so no private keys are ever written to the container disk. |
| **pnpm hardening** | Build and `postinstall` scripts are blocked by default, packages must be at least twenty-four hours old before they can be installed, the package store is integrity-checked, and `pnpm install` defaults to `--frozen-lockfile`. |
| **Shared credential volumes** | The Claude Code, Codex, GitHub CLI, and shell-history volumes use fixed names and are shared across all projects, so you sign in only once. The trade-off is that a compromised package in any one project can read these tokens; the egress allowlist described above is what prevents those tokens from being sent anywhere. Scope your GitHub Personal Access Token narrowly to limit the blast radius. |

> This is a hardened container, not a bulletproof sandbox. A kernel zero-day
> could still escape it. For genuinely untrusted code, use a disposable Virtual
> Machine.

---

## What's Inside

- **Node.js 26.4.0**, baked into the image, together with a pinned version of
  **pnpm**.
- The **zsh** shell with oh-my-zsh, and shell history that persists across
  rebuilds.
- Command-line tools: **git**, the **GitHub CLI** (`gh`), the modern search and
  file utilities **ripgrep**, **fd**, **bat**, **jq**, and **fzf**, plus
  **Claude Code** and **Codex**.
- VS Code extensions: ESLint, Prettier (configured to format on save), and Code
  Spell Checker.
- A default-drop **egress firewall** that is re-applied every time the container
  starts.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (tested with
  version 29).
- [VS Code](https://code.visualstudio.com/) together with the **Dev Containers**
  extension.

This environment works on macOS, Windows, and Linux, because the container
itself is always Linux regardless of the host. A few platform-specific notes
apply:

- **Windows:** enable Docker Desktop's **WSL2 backend**, and keep the repository
  on the WSL2 filesystem (for example, a path such as `\\wsl$\...` or a directory
  inside your WSL distribution) so that filesystem performance is acceptable. The
  host-side commands in this document are written for the bash and zsh shells;
  where the PowerShell equivalent differs, it is called out explicitly.
- **macOS and Windows:** containers run inside Docker Desktop's lightweight Linux
  Virtual Machine, and that Virtual Machine boundary is part of the isolation
  model (see the [Threat Model](#threat-model) section above).
- **Linux:** the container runs natively, with no Virtual Machine in between. The
  firewall and the non-root user still apply, but because there is no Virtual
  Machine boundary, a container escape reaches the host kernel directly. For
  genuinely untrusted code, run this on a disposable host.

---

## Getting Started

### Using It for a New Project (This Repository Is a GitHub Template)

1. On this repository's GitHub page, click **"Use this template", then "Create a
   new repository."** Your new repository will already contain the `.devcontainer`
   folder.
2. In VS Code, open the command palette (`Cmd+Shift+P`) and run **Dev Containers:
   Clone Repository in Container Volume…**, then point it at your new repository.

Because the workspace is a named volume, VS Code clones the repository into an
isolated volume and builds the container. The Claude Code, Codex, GitHub CLI,
shell-history, and pnpm-store volumes are shared across all projects through
fixed names, so you sign in to the AI CLIs and the GitHub CLI only once, and
dependency installations stay fast.

> **Alternative (bind mount):** to try the environment against a folder that
> already exists on disk, open that folder and run **Dev Containers: Reopen in
> Container**. This bind-mounts only that one folder, which provides slightly
> less isolation than the named-volume approach.

### Adding It to an Existing Project

Copy the `.devcontainer` folder (and, optionally, the `CHANGELOG.md` file) into
your project, commit it, and then use *Clone Repository in Container Volume* as
described above.

---

## AI CLI Authentication Modes

Claude Code and Codex support two authentication modes, selected by the
`DC_AI_MODE` environment variable in the host shell that launches VS Code. If
the variable is not set, the mode defaults to `personal`.

### `personal`: Your Own Subscriptions (the Default)

This mode uses your personal Claude Code and OpenAI or ChatGPT subscriptions. No
provider configuration is written, and you sign in interactively once per
project. Your credentials persist in the Claude Code and Codex volumes across
rebuilds:

```sh
# Nothing needs to be exported. Just launch VS Code, open a terminal inside the
# container, and then run:
claude          # follow the browser sign-in prompt for your Claude subscription
codex login     # follow the ChatGPT sign-in prompt
```

### `gateway`: A Corporate AI Gateway

This mode routes both CLIs through a corporate gateway (Claude through Amazon
Bedrock, and Codex through its `/v1` endpoint). Gateway mode is not the default,
so you must enable it deliberately. It requires four values: the mode itself,
your gateway base URL, and the two authentication tokens. The gateway URL is not
hardcoded; you supply your own.

Choose whichever of the following approaches fits how you work.

#### Option A: Enable It for All of Your Projects (Recommended)

Add the following four lines to your `~/.zshrc` file once, and thereafter always
launch VS Code by typing `code` in a terminal:

```sh
export DC_AI_MODE=gateway
export DC_AI_GATEWAY_URL=https://ai-gateway.example.com   # your gateway base URL
export ANTHROPIC_AUTH_TOKEN=...   # the gateway token for Claude Code
export CODEX_OPENAI_API_KEY=...   # the gateway token for Codex
```

```sh
code /path/to/your/project
```

Every project you open will then use the gateway automatically.

> **Windows (PowerShell):** set the same four variables persistently, and then
> relaunch so that new terminals inherit them:
>
> ```powershell
> setx DC_AI_MODE gateway
> setx DC_AI_GATEWAY_URL https://ai-gateway.example.com
> setx ANTHROPIC_AUTH_TOKEN ...
> setx CODEX_OPENAI_API_KEY ...
> # Open a NEW terminal, because setx only affects new sessions, and then run:
> code C:\path\to\your\project
> ```
>
> If you are using WSL2 (which is recommended on Windows), use the bash or zsh
> form shown above inside your WSL shell instead.

#### Option B: Just Once, Without Editing Any Files

Set the variables inline on the launch command. They disappear as soon as you
close the terminal:

```sh
DC_AI_MODE=gateway DC_AI_GATEWAY_URL=https://ai-gateway.example.com \
ANTHROPIC_AUTH_TOKEN=... CODEX_OPENAI_API_KEY=... \
code /path/to/your/project
```

#### Option C: Pin a Single Project to Gateway Mode

Hardcode the values that are not secret into that project's
`.devcontainer/devcontainer.json` file, so that the project always uses gateway
mode regardless of how the host is set up. With this approach you only need the
two tokens on the host (through Option A or Option B, restricted to the tokens):

```jsonc
"remoteEnv": {
  "DC_AI_MODE": "gateway",
  "DC_AI_GATEWAY_URL": "https://ai-gateway.example.com",
  "ANTHROPIC_AUTH_TOKEN": "${localEnv:ANTHROPIC_AUTH_TOKEN}",
  "CODEX_OPENAI_API_KEY": "${localEnv:CODEX_OPENAI_API_KEY}"
}
```

> **Never** place the tokens in `devcontainer.json`, because that file can be
> committed and shared. Only the mode and the gateway URL are safe to hardcode
> there.

#### Three Things That Commonly Trip People Up

1. **The token must be a host environment variable, not a file.** A normal,
   non-container installation of Claude Code stores the gateway token inside the
   `~/.claude/settings.json` file on your host machine. This container does not
   read that file; instead it forwards a host environment variable (through
   `${localEnv:ANTHROPIC_AUTH_TOKEN}`). Therefore, even if Claude Code works on
   your host, you must also run `export ANTHROPIC_AUTH_TOKEN=...` in your shell
   (as in Option A). Otherwise the token arrives empty and Claude Code fails with
   a generic "API Error", because the gateway responds with an HTTP 401. Copy the
   same token value out of your host `~/.claude/settings.json` file and into the
   `export` statement.
2. **Launch VS Code by typing `code` in a terminal, not from the desktop
   launcher (the Dock or Spotlight on macOS).** The `${localEnv:...}` forwarding
   can only see variables from the shell that launched VS Code, and an
   application started from the desktop launcher does not inherit them. Option C
   avoids this problem for the mode and the URL, but the tokens still come from
   the host.
3. **Set the variables before the container is built.** The configuration is
   written once, at creation time. If you set the variables after the container
   already exists, run **Dev Containers: Rebuild Container** so that it picks them
   up.

To verify that everything worked, open a terminal inside the container and run:

```sh
echo "mode: $DC_AI_MODE"                             # should print: gateway
echo "token present: ${ANTHROPIC_AUTH_TOKEN:+yes}"   # should print: yes
cat ~/.claude/settings.json                          # should show CLAUDE_CODE_USE_BEDROCK and your gateway URL
```

If the mode is `gateway` but "token present" is blank, then the host environment
variable was not set (see the first item above). Correct it on the host and then
rebuild the container.

#### What Happens Under the Hood

The `post-create.sh` script writes `~/.claude/settings.json` and
`~/.codex/config.toml`, both pointed at the value of `DC_AI_GATEWAY_URL` (with
`/bedrock` and `/v1` appended respectively). The firewall automatically adds the
gateway host to its allowlist. The tokens are forwarded through `remoteEnv` and
are never committed. The `NODE_USE_SYSTEM_CA=1` variable is set so that Node.js
trusts the Operating System's Certificate Authority store, which the gateway may
rely on. If `DC_AI_MODE` is set to `gateway` but `DC_AI_GATEWAY_URL` is not
set, container creation fails loudly rather than silently falling back to another
mode.

> When you switch a project from `gateway` back to `personal`, the gateway
> configuration is moved aside to a `*.gateway.bak` file (because it persists in
> the volume), so that it does not override your subscription sign-in. This
> switch takes effect on rebuild.

---

## Accessing Your Development Server From the Host

When you run `pnpm dev`, VS Code automatically detects the listening port and
forwards it to your host machine, so that visiting `http://localhost:<port>` in
your host browser reaches the application. You do not need any `forwardPorts`
configuration or a Docker `-p` publish, because VS Code proxies the port over its
existing connection to the container, and the egress firewall does not interfere
(it only filters outbound internet traffic).

> **A common pitfall:** the development server must bind to `0.0.0.0` rather than
> `127.0.0.1`, or the forwarding will silently fail. The relevant flags are:
>
> - Vite: `pnpm dev --host` (or `server.host: true`)
> - Next.js: `next dev -H 0.0.0.0`
> - Express or plain Node.js: `app.listen(3000, '0.0.0.0')`
>
> This applies only when launching through VS Code Dev Containers. A bare
> `docker run` would instead require `-p <port>:<port>` in addition to the
> `0.0.0.0` bind.

### Debugging the Application in a Browser

To let a tool such as Claude Code inspect or drive the application, run a
headless browser (Playwright or Puppeteer) inside the container, pointed at your
in-container `localhost:<port>`, ideally through a Chrome DevTools or Playwright
integration server. Keeping the browser inside the container keeps everything
within the isolation boundary. Note that installing Playwright's copy of Chromium
downloads from domains that are not in the firewall allowlist, so you must first
add `cdn.playwright.dev` and `playwright.download.prss.microsoft.com` to
`initialize-firewall.sh` (or install the Debian package with `apt-get install
chromium` and allowlist the Debian mirror). Connecting outward to a Chrome
instance running on the host is possible, but it is brittle and it exposes your
host browser session, so it is discouraged.

---

## Updating the Container

Editing files under `.devcontainer` has no effect on a container that is already
running, because the container was built from that configuration and does not
watch it for changes. To apply changes, you must rebuild: open the command
palette (`Cmd+Shift+P`) and run **Dev Containers: Rebuild Container**.

This is also how a running project picks up a change to the AI mode (for example,
switching to `gateway`): set the host environment variables, and then rebuild.

| Command | What It Does | When to Use It |
|---|---|---|
| **Rebuild Container** | Reuses Docker's build cache | For most changes, such as edits to `devcontainer.json`, adding a Feature, or switching modes |
| **Rebuild Container Without Cache** | Rebuilds every layer from scratch | For Dockerfile changes that the cache would otherwise miss, such as new system packages installed through `apt-get` or the global `npm install` line |

Because a rebuild creates a fresh container, the scripts that run once per
container (`on-create.sh` and `post-create.sh`) run again. This is why a rebuild
re-reads `DC_AI_MODE` and rewrites the AI configuration. Dockerfile changes
are baked into the new image, and the firewall is re-applied on every start
regardless.

### Updating Tool Versions (Node.js, pnpm, Claude Code, and Codex)

All four of these are pinned in the `Dockerfile` for reproducibility, so
upgrading any of them follows the same deliberate procedure:

1. Edit the version in `.devcontainer/Dockerfile`:
   - For **Node.js**, change the `FROM node:26.4.0-bookworm` tag on the first
     line.
   - For **pnpm, Claude Code, and Codex**, change the pinned versions in the
     `npm install -g pnpm@… @anthropic-ai/claude-code@… @openai/codex@…` line.
2. Run **Rebuild Container Without Cache**, because these tools live in cached
   layers and an ordinary rebuild would keep the old versions.
3. Commit the change (and update `CHANGELOG.md` if you are cutting a template
   release).

To find the latest published versions when Node.js and npm are not installed on
your host machine, query the npm registry directly:

```sh
curl -fsS https://registry.npmjs.org/pnpm/latest                        | jq -r .version
curl -fsS https://registry.npmjs.org/@anthropic-ai%2fclaude-code/latest | jq -r .version
curl -fsS https://registry.npmjs.org/@openai%2fcodex/latest             | jq -r .version
```

### Do I Need to Clean Up Images, Containers, or Volumes?

Usually not. A rebuild replaces the image and the container for you, and your
named volumes survive it. This is deliberate, and it is what preserves your
sign-ins, your shell history, and the pnpm cache. A mode switch is likewise
handled without a wipe, because switching from `gateway` to `personal` moves the
old configuration aside to a `*.gateway.bak` file. You only need to clean up in
the specific situations described below.

> The `docker` commands below are identical on every Operating System, including
> Windows PowerShell, because the `--filter name=dc-` prefix filter is handled by
> Docker itself.

If you want a completely clean slate (forgetting your sign-ins and clearing the
caches), stop the container and then run:

```sh
docker volume ls --filter name=dc-        # list the shared dc volumes
docker volume rm dc-claude dc-codex       # remove the ones you want to reset
```

To reclaim disk space taken up by old builds:

```sh
docker image prune       # remove dangling images
docker builder prune     # remove the old build cache
```

To remove everything associated with a project and start completely fresh, close
the VS Code window and then run:

```sh
docker ps -a | grep <project>         # find the container
docker rm -f <container-id>
docker volume ls --filter name=dc-    # find the associated volumes
docker volume rm <each-volume>
```

Then reopen the project with **Clone Repository in Container Volume**.

---

## Persistence and Where the Volumes Live

Named volumes survive rebuilds. On macOS and Windows they live inside the Docker
Desktop Linux Virtual Machine (on its virtual disk, for example the `Docker.raw`
file) rather than as folders you can browse in Finder or File Explorer, which is
precisely why they are isolated from your host filesystem. You can manage them
with `docker volume ls --filter name=dc-`, and you can inspect their contents through
**Dev Containers: Explore a Volume in a Dev Container…**.

All of the volumes use fixed names (`dc-claude`, `dc-codex`, `dc-gh`,
`dc-history`, and `dc-pnpm-store`) and are shared across every project built
from this template:

| Volume | Scope |
|---|---|
| The Claude Code, Codex, GitHub CLI, and shell-history directories | **Shared**. Sign in once, with a single unified history |
| The pnpm content-addressable store (`~/.local/share/pnpm`) | **Shared** across all projects |

> **Security trade-off:** because these volumes are shared, a malicious package
> in any one project can read the shared Claude Code, Codex, and GitHub CLI
> tokens. The egress firewall is what prevents that package from sending the
> tokens anywhere; in addition, scope your GitHub Personal Access Token to the
> minimum set of repositories it needs.

---

## Common Tasks

To allow another domain through the firewall, add it to the `ALLOWED_DOMAINS`
array in `.devcontainer/initialize-firewall.sh`, and then re-apply the firewall
from inside the container:

```sh
sudo /usr/local/bin/initialize-firewall.sh
```

To allow a particular package's build script to run (an explicit opt-in), add the
package to the `onlyBuiltDependencies` array in that project's `package.json`
file and reinstall.

To bypass the frozen-lockfile default for a single installation:

```sh
pnpm install --no-frozen-lockfile
```

---

## Frequently Asked Questions

### Enabling and Running

**Do I need to set `DC_AI_MODE=gateway` explicitly?**
Yes. The default mode is `personal`. See the section on
[AI CLI Authentication Modes](#ai-cli-authentication-modes) for the three ways to
enable gateway mode.

**I am getting a generic "API Error" from Claude Code in gateway mode.**
This is almost always caused by an empty token. Inside the container, run
`echo "token present: ${ANTHROPIC_AUTH_TOKEN:+yes}"`; if the result is blank, the
host environment variable was not set. Remember that a normal installation of
Claude Code stores the token inside the `~/.claude/settings.json` file, whereas
this container instead forwards a host environment variable. You must therefore
run `export ANTHROPIC_AUTH_TOKEN=...` on the host (copying the same value from
that settings file), and then rebuild the container.

**I launched VS Code from the desktop launcher and the host environment variables
did not reach the container.**
An application launched from the desktop launcher inherits the Operating System's
launch-service environment, not your shell's environment. Quit VS Code
completely, and then launch it by typing `code` in a terminal where the variables
are set. Alternatively, register the variables with the Operating System by
running `launchctl setenv NAME value` on macOS (though this does not survive a
reboot). Then rebuild the container.

### Updating

**How do I update a running container after editing `.devcontainer`?**
Editing does nothing until you rebuild the container through the command palette
(`Cmd+Shift+P`). Use **Rebuild Container Without Cache** for Dockerfile changes,
such as system packages or the global `npm install` line. See
[Updating the Container](#updating-the-container).

**How do I update the versions of Node.js, pnpm, Claude Code, or Codex?**
All of these are pinned in the `Dockerfile`. Edit the version, run **Rebuild
Container Without Cache**, and commit the change. See
[Updating Tool Versions](#updating-tool-versions-nodejs-pnpm-claude-code-and-codex).

**How do I update an existing project to the latest template configuration?**
Copy the template's `.devcontainer` folder (and the `.gitattributes` file) into
the project, commit the change, push it, and then run **Rebuild Container Without
Cache**. You can fetch the files from inside the container, because GitHub is on
the firewall allowlist and you can therefore run `git clone`; however, the
rebuild itself must be triggered from VS Code on the host, because a container
cannot rebuild itself. If you had previously customized the project's
`.devcontainer` folder, review and merge the differences rather than copying over
them blindly, and be aware that the shared-volume behavior means you will sign in
once after the update.

### Volumes and Persistence

**What happens to the named volumes when I rebuild?**
They survive. A rebuild replaces the image and the container, but it never
touches the volumes, so you keep your sign-ins, your history, and the pnpm cache.
The `post-create.sh` script runs again and operates on the contents that persist
in those volumes.

**Are the volumes isolated per project, or shared?**
All of them (`dc-claude`, `dc-codex`, `dc-gh`, `dc-history`, and
`dc-pnpm-store`) are shared across projects through fixed names, so that you
sign in only once. See [Persistence and Where the Volumes Live](#persistence-and-where-the-volumes-live)
for the associated security trade-off.

**Does each project get a separate GitHub CLI token?**
No. GitHub CLI tokens authenticate as your GitHub account and are account-wide in
scope, regardless of which project created them. A named volume only controls
which containers are able to read the token file; it does not limit what a stolen
token can do once it has been read. To genuinely reduce the blast radius, create
a fine-grained Personal Access Token scoped to the minimum set of repositories it
needs.

**Where do the named volumes physically live?**
They live inside the Docker Desktop Linux Virtual Machine, on its virtual disk,
rather than as folders you can browse in Finder or File Explorer, which is
exactly why they are isolated from your host.

**A volume name contains a long hash (for example, `…02hrr…`) but I cannot find
its container.**
That hash is the value of `${devcontainerId}`, which is derived from the
container's `devcontainer.*` labels. If no container carries those labels, then
the volume is orphaned, which usually happens after deleting and recreating the
container or after renaming the project folder. You can confirm this by running
`docker ps -a --filter volume=<name>`; if the result is empty, the volume is safe
to remove with `docker volume rm`.

**What is the "VS Code Container" volume that VS Code asks me to name when I
clone?**
That is the workspace volume, and it holds the source code of your cloned
repository. A single volume can hold several repositories as subfolders (this is
what the VS Code hint "store several cloned repositories" refers to), but for this
template's isolation goals you should give each project a unique volume name.
Sharing one workspace volume across repositories would allow a malicious package
in one repository to read the source code of every other repository in that
volume.

### Connecting to Services

**How do I connect to a PostgreSQL database that is running on my host machine?**
Use the hostname `host.docker.internal` rather than `localhost` (which, from
inside the container, refers to the container itself). For example:
`postgresql://user:password@host.docker.internal:5432/database`. The firewall
already allows the host network range.

**How do I stop a development container?**
Closing the VS Code window detaches from the container, but Docker Desktop keeps
it running. To actually stop it, run `docker stop <id>` or use the Stop button in
Docker Desktop. Stopping is harmless, because the volumes persist and the firewall
is re-applied the next time the container starts.

### Disk Usage and Images

**Will each project build a multi-gigabyte image of its own?**
No, provided the projects share the same `.devcontainer` configuration. Docker
shares base layers across images, so a second project that uses the same
configuration reuses the roughly 1.6-gigabyte Node.js base layer and adds only a
few megabytes. The image size only grows meaningfully when the configurations
differ. To judge the real cost, run `docker system df -v` and read the **UNIQUE
SIZE** column (which is what you would actually reclaim), rather than the SIZE
column (which double-counts shared layers).

**I want to avoid rebuilding a container for every project.**
Keep all such projects on the same `.devcontainer` configuration. The image is
then built once, and every project reuses the cached layers, so each build is
fast and adds almost no additional disk usage, while each project remains fully
isolated in its own workspace volume. You do not need to share a single container
across repositories, which would sacrifice workspace isolation in exchange for a
negligible saving in disk space.

**How do I reclaim disk space?**
The commands `docker builder prune` (which removes the old build cache) and
`docker image prune` (which removes dangling layers) are safe, because they never
touch running containers or tagged images. For larger savings, remove the
`vsc-<project>-<hash>` image belonging to a project you are genuinely finished
with, using `docker image rm <id>`.

### Cross-Platform Use and Versioning

**Does this work on Windows and Linux?**
Yes. The container is always Linux regardless of the host. The `.gitattributes`
file forces Unix line endings so that the shell scripts run correctly even on
Windows checkouts. Windows requires Docker Desktop's WSL2 backend; see the
[Prerequisites](#prerequisites) section for the platform-specific notes.

**When I create a repository from this template, are the README, CHANGELOG, and
.gitattributes files copied?**
Yes. GitHub's "Use this template" feature copies the entire default branch. Keep
the `.gitattributes` file, because the new project benefits from it, and delete
or replace the template's `README.md` and `CHANGELOG.md` files with the new
project's own.

**Where is the release version managed?**
Releases are managed through annotated git tags (`vMAJOR.MINOR.PATCH`) together
with `CHANGELOG.md`. GitHub Releases are optional. See the
[Versioning](#versioning) section.

---

## Files

| File | Purpose |
|---|---|
| `.devcontainer/devcontainer.json` | The main configuration: image build, Features, mounts, environment, lifecycle, and editor settings. |
| `.devcontainer/Dockerfile` | Builds `FROM node:26.4.0-bookworm`, adds the firewall and shell tooling, and renames the built-in user to `dc-user`. |
| `.devcontainer/on-create.sh` | Runs once: installs the firewall script and the AI CLIs, and corrects volume ownership. |
| `.devcontainer/post-create.sh` | Runs once: applies pnpm hardening, writes the AI configuration (according to `DC_AI_MODE`), and sets up zsh. |
| `.devcontainer/initialize-firewall.sh` | Applies the egress allowlist; re-applied on every container start. |
| `.gitattributes` | Forces Unix line endings so that the scripts run on Windows, macOS, and Linux checkouts. |
| `CHANGELOG.md` | The versioned history of the template. |

---

## Versioning

This template follows [Semantic Versioning](https://semver.org/). Releases are
annotated git tags (`vMAJOR.MINOR.PATCH`) with accompanying notes in
`CHANGELOG.md`:

- **MAJOR**: breaking changes to the container contract (such as a change of
  base image or Operating System, a rename of the user, a change to the mount
  layout, or removed tooling).
- **MINOR**: backwards-compatible additions, such as a new tool, a new firewall
  allowlist entry, or a new opt-in setting.
- **PATCH**: bug fixes and documentation changes.

A project created from this template receives a snapshot of the template as it
existed at the moment of creation. There is no automatic link back to the
upstream template once a repository has been generated from it, so you must pull
any later improvements manually.

To cut a release, update `CHANGELOG.md` and then create and push an annotated
tag:

```sh
git tag -a v1.0.0 -m "v1.0.0"
git push origin v1.0.0
```

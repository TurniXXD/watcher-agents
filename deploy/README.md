# VPS deployment

Production deployment uses GitHub Actions, GitHub Container Registry (GHCR), Tailscale, OpenSSH, Docker Compose, and a server-managed runtime configuration. The `deploy-vps` workflow runs after `watcher-ci` succeeds on `main`; it can also be started manually from the Actions page.

GitHub publishes one immutable Watcher image. The VPS runs that image with separate commands and environment files for `stocks-bot`, `publications-bot`, `news-bot`, `mu-clubs-monitor`, `briefing-bot`, and the one-shot `migrate` service. Ollama remains outside this Compose stack.

## Security model

- The VPS does not need a public SSH port. `DEPLOY_HOST` should be its Tailscale IP or MagicDNS hostname.
- Every GitHub runner joins the tailnet as an ephemeral `tag:ci` node and is removed after the job.
- Tailnet policy should allow `tag:ci` to reach only the Watcher server on TCP port 22.
- The workflow uses normal OpenSSH over the Tailscale network. The server still needs `sshd`, an authorized deployment key, and a verified `known_hosts` entry.
- GitHub stores deployment transport credentials only. Bot tokens, database credentials, allowlisted Telegram IDs, Ollama settings, and the SEC user agent stay only in mode-`0600` files on the VPS.
- GitHub's production environment can require approval before its secrets are released to a job.

## VPS prerequisites

Install and configure:

- Docker Engine and the Docker Compose v2 plugin.
- Tailscale, connected to the same tailnet as the GitHub Actions OAuth client.
- OpenSSH server listening on the Tailscale interface or otherwise reachable through the tailnet.
- `gzip`, used for pre-deployment PostgreSQL backups.

Create a dedicated deployment user that can run Docker without an interactive sudo prompt. Then create the deployment directory once:

```bash
sudo install -d -m 750 -o deploy -g deploy /opt/watcher
```

Copy or clone this repository into `/opt/watcher` for the first installation. Subsequent workflows upload the exact production Compose file and deployment script from the release commit.

## Tailscale configuration

1. Give the VPS a stable Tailscale identity, preferably a tag such as `tag:watcher-server`.
2. Define ownership for `tag:ci` and grant it only the access needed to reach the VPS SSH port.
3. In the Tailscale admin console, open **Trust credentials**, create an OAuth client, and grant:
   - **Devices > Core > Write**
   - **Keys > Auth Keys > Write**
   - Tag restriction: `tag:ci`
4. Copy the client ID and secret immediately. Store them as `TS_OAUTH_CLIENT_ID` and `TS_OAUTH_SECRET` in the GitHub `production` environment.

The mergeable policy fragment is in `tailscale-policy.example.hujson`. Its intended permission is:

```text
source:      tag:ci
destination: tag:watcher-server
protocol:    TCP
port:        22
```

Do not grant `tag:ci` broad tailnet access. Tailscale documents the current GitHub Actions and policy setup at <https://tailscale.com/docs/integrations/github/github-action>.

## SSH key and host verification

Generate a dedicated key pair on a trusted administrator machine:

```bash
ssh-keygen -t ed25519 -f watcher-github-deploy -C watcher-github-actions
```

Append `watcher-github-deploy.pub` to `/home/deploy/.ssh/authorized_keys` on the VPS. Store the complete private key as the GitHub secret `DEPLOY_SSH_KEY`.

Generate a known-hosts entry through the Tailscale address and verify its fingerprint through a separate trusted channel before storing it:

```bash
ssh-keyscan -H -p 22 watcher-vps.tailnet-name.ts.net
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Store the verified `ssh-keyscan` line as `DEPLOY_KNOWN_HOSTS`. Do not use `StrictHostKeyChecking=no` or generate the entry inside the deployment workflow.

## GHCR pull credential

The workflow publishes the image with its scoped `GITHUB_TOKEN`. The VPS needs a credential for pulling a private image:

1. Create a GitHub personal access token with `read:packages` access to this repository's Watcher package.
2. If the organization enforces SSO, authorize the token for the organization.
3. Store the account or organization name as `GHCR_USERNAME` and the token as `GHCR_TOKEN` in the `production` environment.

For a public container package, anonymous pulls may work, but keeping an explicit read-only credential makes private/public visibility changes safe.

## GitHub production environment

Create an environment named `production` under **Repository Settings > Environments**. Configure required reviewers and restrict deployments to `main` if desired.

Copy the example inventories to temporary files, replace every placeholder, and upload the secrets with GitHub CLI:

```bash
cp deploy/github-secrets.production.example /tmp/watcher-production-secrets.env
$EDITOR /tmp/watcher-production-secrets.env
# Remove the DEPLOY_SSH_KEY placeholder line before this bulk upload.
gh secret set --env production --env-file /tmp/watcher-production-secrets.env
gh secret set DEPLOY_SSH_KEY --env production < watcher-github-deploy
rm -f /tmp/watcher-production-secrets.env
```

Add these non-sensitive environment variables in the GitHub UI:

| Variable          | Example                                   |
| ----------------- | ----------------------------------------- |
| `DEPLOY_PATH`     | `/opt/watcher`                            |
| `DEPLOY_ENV_FILE` | `/opt/watcher/deploy/runtime/compose.env` |
| `TS_TAG`          | `tag:ci`                                  |

Add these environment secrets:

| Secret               | Purpose                                  |
| -------------------- | ---------------------------------------- |
| `DEPLOY_HOST`        | VPS Tailscale IP or MagicDNS hostname    |
| `DEPLOY_USER`        | Dedicated SSH user                       |
| `DEPLOY_SSH_KEY`     | Dedicated multiline private key          |
| `DEPLOY_KNOWN_HOSTS` | Verified host-key line for `DEPLOY_HOST` |
| `DEPLOY_PORT`        | SSH port; defaults to `22`               |
| `GHCR_USERNAME`      | Account used for server-side image pulls |
| `GHCR_TOKEN`         | Token with `read:packages`               |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID                |
| `TS_OAUTH_SECRET`    | Tailscale OAuth client secret            |

The ready-to-copy names also live in `github-variables.production.example` and `github-secrets.production.example`.

## Server runtime configuration

Runtime credentials are intentionally not uploaded by GitHub Actions. Create these files on the VPS:

| Server file                           | Purpose                            |
| ------------------------------------- | ---------------------------------- |
| `deploy/runtime/compose.env`          | Non-secret Compose project options |
| `deploy/runtime/postgres.env`         | PostgreSQL initialization values   |
| `deploy/runtime/migrate.env`          | Prisma migration database URL      |
| `deploy/runtime/stocks-bot.env`       | Stocks bot runtime and credentials |
| `deploy/runtime/publications-bot.env` | Publications bot runtime values    |
| `deploy/runtime/news-bot.env`         | Czech and Global news bot values   |
| `deploy/runtime/mu-clubs-monitor.env` | MU Clubs API and polling settings  |
| `deploy/runtime/briefing-bot.env`     | Morning briefing bot credentials   |

You can copy the readable examples from `deploy/presets`, or render all files from environment variables:

```bash
cd /opt/watcher
umask 077
cp deploy/presets/compose.env.example deploy/runtime/compose.env
cp deploy/presets/postgres.env.example deploy/runtime/postgres.env
cp deploy/presets/migrate.env.example deploy/runtime/migrate.env
cp deploy/presets/stocks-bot.env.example deploy/runtime/stocks-bot.env
cp deploy/presets/publications-bot.env.example deploy/runtime/publications-bot.env
cp deploy/presets/news-bot.env.example deploy/runtime/news-bot.env
cp deploy/presets/mu-clubs-monitor.env.example deploy/runtime/mu-clubs-monitor.env
cp deploy/presets/briefing-bot.env.example deploy/runtime/briefing-bot.env
chmod 600 deploy/runtime/*.env
```

Alternatively, export the inputs documented in `ENVIRONMENT.md` and run:

```bash
./deploy/render-env.sh
```

Use a long random PostgreSQL password and URL-encode it in `DATABASE_URL`. Both bot env files and `migrate.env` must use the same database credentials. Never commit the populated `deploy/runtime` directory.

## Remote database access

Compose publishes PostgreSQL only on VPS loopback at `127.0.0.1:5433`. To connect from an administration workstation, open an authenticated tunnel over the VPS Tailscale connection:

```bash
ssh -N -L 5433:127.0.0.1:5433 deploy@watcher-vps
```

While the tunnel is open, connect the database client to `127.0.0.1:5433` with the credentials stored in `deploy/runtime/postgres.env`. Replace the example SSH user and host with the operator account and VPS Tailscale address or MagicDNS name. Do not bind PostgreSQL to `0.0.0.0` or open TCP port `5433` in the public firewall.

## First deployment

Before enabling automatic deployment:

1. Confirm the VPS can reach Ollama at the configured `OLLAMA_URL`.
2. Apply the conservative Ollama systemd settings documented in the root README (`OLLAMA_NUM_PARALLEL=1`, one loaded model, and a small queue), then verify them with `systemctl show ollama` and `ollama ps`.
3. Confirm the deployment user can run `docker compose version` without sudo.
4. Confirm all runtime env files exist, and install the accepted Piper voices with `PIPER_ACCEPT_VOICE_LICENSES=true ./deploy/download-piper-voices.sh`. The deploy script normalizes `deploy/runtime` to mode `0700` and the files inside it to mode `0600` before validation.
   Runtime files must encode a literal `$` as `$$`; `deploy/render-env.sh` does this automatically. If older runtime files caused Compose interpolation warnings, rotate any affected database password and update every rendered `DATABASE_URL` together before deploying again.
5. Push the completed application to `main` and wait for `watcher-ci` to pass.
6. Approve the `production` environment deployment if approval protection is enabled.

The workflow then:

1. Builds the shared image and publishes both commit-SHA and `latest` tags to GHCR.
2. Joins the tailnet as an ephemeral `tag:ci` node and pings `DEPLOY_HOST`.
3. Uses verified OpenSSH to upload the release's Compose definition and deployment script.
4. Pulls the exact commit-SHA image.
5. Starts the pinned PostgreSQL 16 image with pgvector and waits for readiness.
6. Creates a compressed pre-deployment database backup when the database already exists; a running database is backed up before its container image can be replaced.
7. Applies committed Prisma migrations and verifies that the `vector` extension is installed.
8. Starts all bots plus the MU Clubs producer and waits for their health checks.
9. Restores the prior image tag if the new containers fail health checks.

Migrations must remain backward-compatible with the previous application image because container rollback does not reverse a database migration.

## Operations

Inspect status:

```bash
cd /opt/watcher
docker compose \
  --env-file deploy/runtime/compose.env \
  --env-file .release.env \
  -f docker-compose.production.yml \
  ps
```

Inspect logs:

```bash
docker compose \
  --env-file deploy/runtime/compose.env \
  --env-file .release.env \
  -f docker-compose.production.yml \
  logs --tail 200 stocks-bot publications-bot news-bot mu-clubs-monitor briefing-bot
```

Backups are stored in `/opt/watcher/backups` and retained for 14 days by default. Override `BACKUP_RETENTION_DAYS` only when invoking `deploy/deploy.sh` manually.

To redeploy an older application version, run `deploy-vps` manually from a branch or tag containing that commit. Confirm its database compatibility first.

## Troubleshooting

- **Tailscale ping fails:** verify the OAuth client includes the auth-key/device write permissions, owns `tag:ci`, and the tailnet policy allows `tag:ci` to reach the server.
- **SSH host verification fails:** regenerate the line only after verifying that the VPS host-key fingerprint changed for a legitimate reason.
- **GHCR pull is denied:** confirm `GHCR_TOKEN` has `read:packages`, organization SSO authorization, and access to the package.
- **Runtime file rejected:** confirm the deployment user owns `/opt/watcher/deploy/runtime`, then run `chmod 700 /opt/watcher/deploy/runtime && chmod 600 /opt/watcher/deploy/runtime/*.env`.
- **Missing runtime value:** add the reported key to the reported file. For example, if `news-bot.env` is missing `NEWS_TELEGRAM_TOKEN`, add a distinct BotFather token to `/opt/watcher/deploy/runtime/news-bot.env`, run `chmod 600 /opt/watcher/deploy/runtime/news-bot.env`, and redeploy.
- **Ollama is unreachable:** ensure Ollama listens on an address reachable from Docker and keep `OLLAMA_URL=http://host.docker.internal:11434`; production Compose provides the Linux host-gateway mapping.
- **A rollout fails:** the workflow prints Compose status plus migration and bot logs. Also inspect `/opt/watcher/backups` before attempting database recovery.

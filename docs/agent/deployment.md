# Production Deployment Contract

Read this file completely before changing `Dockerfile`, Compose files, deployment scripts, runtime environment rendering, migrations, production workflows, healthchecks, maintenance monitoring, or rollback behavior.

- Keep `.github/workflows/deploy-vps.yml`, `docker-compose.production.yml`, and `deploy/deploy.sh` aligned.
- Production publishes one shared Watcher image tagged with the exact commit SHA. Never replace immutable release tags with `latest` in deployment state.
- GitHub stores only SSH, GHCR, and Tailscale transport credentials. Application runtime secrets remain in mode-`0600` files under `deploy/runtime` on the VPS and are never committed or uploaded by CI.
- Tailscale CI access uses an ephemeral tagged identity with least-privilege access to the Watcher VPS SSH port.
- Preserve pre-deployment PostgreSQL backups, migration-before-rollout ordering, serialized production deploys, health checks, failure logs, and application-image rollback.
- Database migrations remain compatible with the previous application image because image rollback does not reverse an applied migration.
- PostgreSQL stays private to the Compose network, uses a named volume, and gates application startup on database health and migrations.
- Run containers as non-root where practical, use `no-new-privileges`, keep runtime images minimal, bound logs, and expose only required network paths.
- For any new runnable bot, also follow the complete runtime and Compose checklist in `docs/agent/telegram-bot-contract.md` when it has a Telegram surface.

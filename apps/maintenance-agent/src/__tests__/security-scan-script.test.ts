import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const script = resolve('deploy/security-scan.sh');
const ingestScript = resolve('deploy/ingest-security-report.sh');

describe('least-privilege Trivy scan script', () => {
  it('scans read-only dependencies and an immutable remote image without a Docker socket', async () => {
    const root = await mkdtemp(join(tmpdir(), 'watcher-security-scan-'));
    const bin = join(root, 'bin');
    const output = join(root, 'output');
    const state = join(root, 'state');
    const cache = join(root, 'cache');
    const dockerConfig = join(root, 'docker-config.json');
    await Promise.all([mkdir(bin), mkdir(output), mkdir(state), mkdir(cache)]);
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(dockerConfig, '{}\n', { mode: 0o600 });
    await writeFile(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
for ((i=1; i<=$#; i++)); do
  if [[ "\${!i}" == '--output' ]]; then
    j=$((i+1))
    target="\${!j}"
    printf '{"SchemaVersion":2,"Results":[]}' > "$FAKE_OUTPUT_DIR/$(basename "$target")"
  fi
done
`,
      { mode: 0o755 },
    );
    const environment = {
      ...process.env,
      PATH: `${bin}:${process.env['PATH'] ?? ''}`,
      WATCHER_ROOT: root,
      SECURITY_SCAN_OUTPUT_DIR: output,
      SECURITY_SCAN_STATE_DIR: state,
      TRIVY_CACHE_DIR: cache,
      SECURITY_SCAN_DOCKER_CONFIG: dockerConfig,
      SECURITY_SCAN_IMAGE:
        'ghcr.io/acme/watcher@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      SECURITY_SCAN_MIN_INTERVAL_MINUTES: '360',
      FAKE_DOCKER_LOG: join(root, 'docker.log'),
      FAKE_OUTPUT_DIR: output,
    };

    await exec('bash', [script], { env: environment });

    const log = await readFile(join(root, 'docker.log'), 'utf8');
    const calls = log.trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain(`${root}:/workspace:ro`);
    expect(calls[0]!.indexOf(`${root}:/workspace:ro`)).toBeLessThan(
      calls[0]!.indexOf(
        'aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c',
      ),
    );
    expect(log).toContain(`--user ${process.getuid!()}:${process.getgid!()}`);
    expect(log).toContain(`${cache}:/cache`);
    expect(log).toContain('--cache-dir /cache');
    expect(log).toContain('-e DOCKER_CONFIG=/docker-config');
    expect(log).toContain(`${dockerConfig}:/docker-config/config.json:ro`);
    expect(log).not.toContain('/root/.docker/config.json');
    expect(calls[0]).toContain('fs --scanners vuln,misconfig');
    expect(calls[1]).toContain('--image-src remote');
    expect(calls[1]).toContain(environment.SECURITY_SCAN_IMAGE);
    expect(log).not.toContain('/var/run/docker.sock');
    expect(log).toContain(
      'aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c',
    );

    await exec(
      'bash',
      [
        script,
        '--mark-ingested',
        'dependencies',
        (await readFile(join(output, 'dependencies.scan-key'), 'utf8')).trim(),
      ],
      { env: environment },
    );
    await exec(
      'bash',
      [
        script,
        '--mark-ingested',
        'image',
        (await readFile(join(output, 'image.scan-key'), 'utf8')).trim(),
      ],
      { env: environment },
    );

    await exec('bash', [script], { env: environment });
    expect(
      (await readFile(join(root, 'docker.log'), 'utf8')).trim().split('\n'),
    ).toHaveLength(2);

    await writeFile(
      join(root, 'pnpm-lock.yaml'),
      'lockfileVersion: 9\nchanged: true\n',
    );
    await exec('bash', [script], { env: environment });
    expect(
      (await readFile(join(root, 'docker.log'), 'utf8')).trim().split('\n'),
    ).toHaveLength(3);
  }, 20_000);

  it('rejects mutable image references before invoking Trivy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'watcher-security-scan-'));
    await Promise.all([
      mkdir(join(root, 'output')),
      mkdir(join(root, 'state')),
      mkdir(join(root, 'cache')),
    ]);
    await expect(
      exec('bash', [script], {
        env: {
          ...process.env,
          WATCHER_ROOT: root,
          SECURITY_SCAN_OUTPUT_DIR: join(root, 'output'),
          SECURITY_SCAN_STATE_DIR: join(root, 'state'),
          TRIVY_CACHE_DIR: join(root, 'cache'),
          SECURITY_SCAN_IMAGE: 'ghcr.io/acme/watcher:latest',
        },
      }),
    ).rejects.toThrow('@sha256:');
  });

  it('submits a report through the loopback API without printing the runtime token', async () => {
    const root = await mkdtemp(join(tmpdir(), 'watcher-security-ingest-'));
    const bin = join(root, 'bin');
    const runtime = join(root, 'runtime');
    await Promise.all([mkdir(bin), mkdir(runtime)]);
    const report = join(root, 'report.json');
    await writeFile(report, '{"SchemaVersion":2,"Results":[]}');
    await writeFile(
      join(runtime, 'maintenance-agent.env'),
      "MAINTENANCE_API_TOKEN='0123456789abcdef'\n",
      { mode: 0o600 },
    );
    await writeFile(
      join(bin, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" > "$FAKE_CURL_ARGS"
cat > "$FAKE_CURL_CONFIG"
printf '{"accepted":true}'
`,
      { mode: 0o755 },
    );

    const result = await exec(
      'bash',
      [ingestScript, 'watcher', 'dependencies', 'sha256:lock', report],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          MAINTENANCE_RUNTIME_ENV_FILE: join(runtime, 'maintenance-agent.env'),
          FAKE_CURL_ARGS: join(root, 'curl.args'),
          FAKE_CURL_CONFIG: join(root, 'curl.config'),
        },
      },
    );

    expect(result.stdout).toBe('{"accepted":true}');
    expect(result.stdout).not.toContain('0123456789abcdef');
    expect(await readFile(join(root, 'curl.args'), 'utf8')).toContain(
      `--data-binary @${report}`,
    );
    expect(await readFile(join(root, 'curl.config'), 'utf8')).toContain(
      'Authorization: Bearer 0123456789abcdef',
    );
  });

  it('attempts the image scan when the dependency scan fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'watcher-security-isolation-'));
    const bin = join(root, 'bin');
    const output = join(root, 'output');
    const state = join(root, 'state');
    const cache = join(root, 'cache');
    await Promise.all([mkdir(bin), mkdir(output), mkdir(state), mkdir(cache)]);
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(
      join(bin, 'docker'),
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [[ " $* " == *' fs '* ]]; then exit 9; fi
printf '{"SchemaVersion":2,"Results":[]}' > "$FAKE_OUTPUT_DIR/image.json"
`,
      { mode: 0o755 },
    );

    await expect(
      exec('bash', [script], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env['PATH'] ?? ''}`,
          WATCHER_ROOT: root,
          SECURITY_SCAN_OUTPUT_DIR: output,
          SECURITY_SCAN_STATE_DIR: state,
          TRIVY_CACHE_DIR: cache,
          SECURITY_SCAN_IMAGE:
            'ghcr.io/acme/watcher@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          FAKE_DOCKER_LOG: join(root, 'docker.log'),
          FAKE_OUTPUT_DIR: output,
        },
      }),
    ).rejects.toBeDefined();
    const calls = (await readFile(join(root, 'docker.log'), 'utf8'))
      .trim()
      .split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(' image ');
  }, 20_000);
});

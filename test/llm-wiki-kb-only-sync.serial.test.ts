// llwiki-sevanbrain-upgrade T020: kb-only sync e2e (PRD §6ʼ.1 ACL 铁律).
//
// Hermetic CLI-level test (pattern: apply-migrations-pglite-spawn.serial.test.ts):
// seed config.json directly, init --migrate-only, register a git-backed fixture
// source, sync with --include "kb/**", then assert NO non-kb/ slug landed in the
// brain. raw/ must be physically absent (stronger than any retrieval-time filter).

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(import.meta.dir, '..');
const FIXTURE = join(import.meta.dir, 'fixtures/llm-wiki-mini');

async function runCli(
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(['bun', 'run', `${REPO}/src/cli.ts`, ...args], {
    cwd: REPO,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const killer = setTimeout(() => {
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(killer);
  }
}

function gitSeed(dir: string): void {
  // sync is git-to-brain (git diff LAST..HEAD) — fixture copy must be a committed repo.
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'seed'],
    { cwd: dir },
  );
}

describe('llm-wiki kb-only sync (§6ʼ.1)', () => {
  test(
    'sync --include "kb/**" imports only kb/ pages; raw/work/_meta physically absent',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'gbrain-kbonly-home-'));
      const repo = mkdtempSync(join(tmpdir(), 'gbrain-kbonly-repo-'));
      try {
        cpSync(FIXTURE, repo, { recursive: true });
        gitSeed(repo);
        mkdirSync(join(home, '.gbrain'), { recursive: true });
        writeFileSync(
          join(home, '.gbrain', 'config.json'),
          JSON.stringify({
            engine: 'pglite',
            database_path: join(home, '.gbrain', 'brain.pglite'),
            embedding_dimensions: 768,
          }) + '\n',
        );
        const env = { HOME: home, GBRAIN_HOME: home };

        const init = await runCli(['init', '--migrate-only'], env, 120_000);
        expect(init.exitCode).toBe(0);

        const add = await runCli(['sources', 'add', 'mini', '--path', repo], env, 30_000);
        expect(add.exitCode).toBe(0);

        // --include is the flag under test (T030 wires it through to SyncableOptions).
        const sync = await runCli(
          ['sync', '--source', 'mini', '--include', 'kb/**', '--no-pull', '--no-embed'],
          env,
          120_000,
        );
        expect(sync.exitCode).toBe(0);

        const list = await runCli(
          ['list', '--limit', '100'],
          { ...env, GBRAIN_SOURCE: 'mini' },
          30_000,
        );
        expect(list.exitCode).toBe(0);
        // kb/ pages present
        expect(list.stdout).toContain('kb/demo/entities/acme');
        expect(list.stdout).toContain('kb/demo/solutions/pay');
        // non-kb content physically absent from the brain
        for (const bad of ['secret', 'draft', 'note']) {
          expect(list.stdout).not.toContain(bad);
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
    300_000,
  );
});

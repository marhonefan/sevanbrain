// llwiki-sevanbrain-upgrade T080: pack frontmatter_links → typed edge wiring (PRD §8.2).
//
// Fixture: kb/demo/entities/acme.md declares related_concepts:[kb/demo/solutions/pay]
// and body wikilink [[kb/demo/solutions/pay]]; kb/demo/solutions/pay.md declares
// supersedes:[kb/demo/entities/acme]. With schema_pack=llm-wiki active, a sync
// (with extract) must derive:
//   - mentions   acme → pay   (body wikilink, claimed-native baseline; P0 found
//                              0 links on the real wiki — this is the control probe)
//   - related_to acme → pay   (frontmatter via pack declaration — the wiring under test)
//   - supersedes pay  → acme

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
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'seed'],
    { cwd: dir },
  );
}

describe('llm-wiki frontmatter_links wiring (PRD §8.2)', () => {
  test(
    'sync derives mentions (control) + related_to + supersedes typed edges',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'gbrain-fmlinks-home-'));
      const repo = mkdtempSync(join(tmpdir(), 'gbrain-fmlinks-repo-'));
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
            schema_pack: 'llm-wiki',
          }) + '\n',
        );
        const env = { HOME: home, GBRAIN_HOME: home };

        expect((await runCli(['init', '--migrate-only'], env, 120_000)).exitCode).toBe(0);
        expect((await runCli(['sources', 'add', 'mini', '--path', repo], env, 30_000)).exitCode).toBe(0);
        const sync = await runCli(
          ['sync', '--source', 'mini', '--include', 'kb/**', '--no-pull', '--no-embed'],
          env,
          120_000,
        );
        expect(sync.exitCode).toBe(0);

        // sync defers link extraction (pages land "un-extracted"); run it explicitly.
        const extract = await runCli(
          ['extract', '--stale'],
          { ...env, GBRAIN_SOURCE: 'mini' },
          120_000,
        );
        expect(extract.exitCode).toBe(0);

        const links = await runCli(
          ['call', 'get_links', JSON.stringify({ slug: 'kb/demo/entities/acme' })],
          { ...env, GBRAIN_SOURCE: 'mini' },
          30_000,
        );
        expect(links.exitCode).toBe(0);
        const acmeLinks = links.stdout;
        // control probe: body [[kb/demo/solutions/pay]] → mentions edge
        expect(acmeLinks).toContain('kb/demo/solutions/pay');
        expect(acmeLinks).toContain('mentions');
        // wiring under test: frontmatter related_concepts → related_to
        expect(acmeLinks).toContain('related_to');

        const payLinks = await runCli(
          ['call', 'get_links', JSON.stringify({ slug: 'kb/demo/solutions/pay' })],
          { ...env, GBRAIN_SOURCE: 'mini' },
          30_000,
        );
        expect(payLinks.exitCode).toBe(0);
        // wiring under test: frontmatter supersedes → supersedes edge
        expect(payLinks.stdout).toContain('supersedes');
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(repo, { recursive: true, force: true });
      }
    },
    300_000,
  );
});

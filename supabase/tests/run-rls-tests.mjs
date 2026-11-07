// Runs the RLS policy tests (supabase/tests/rls_policies.sql) against the local
// Supabase Postgres container. Fails (non-zero exit) if any SQL assertion raises.
//
// Requires: `supabase start` running locally, Docker available. This is a DATABASE
// test (it exercises Postgres RLS), separate from the client `node --test` suite.
//
// Usage: npm run db:test
import { spawnSync, execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sqlFiles = ['rls_policies.sql', 'import_rpc.sql'];

// Resolve a docker binary even when it isn't on PATH (per-user Docker Desktop installs).
function findDocker() {
  const candidates = [
    'docker',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'resources', 'bin', 'docker.exe'),
    'C:/Program Files/Docker/Docker/resources/bin/docker.exe',
    '/usr/local/bin/docker',
    '/usr/bin/docker',
  ];
  for (const c of candidates) {
    try {
      const probe = c === 'docker' ? 'docker' : c;
      execSync(`"${probe}" --version`, { stdio: 'ignore', shell: true });
      return probe;
    } catch { /* try next */ }
  }
  throw new Error('docker not found. Is Docker Desktop installed and running?');
}

const docker = findDocker();

// Find the running Supabase DB container (name ends with _db_<project>).
let container;
try {
  const names = execSync(`"${docker}" ps --format "{{.Names}}"`, { encoding: 'utf8' });
  container = names.split(/\r?\n/).find((n) => /supabase_db_/.test(n));
} catch (e) {
  console.error('Could not list Docker containers:', e.message);
  process.exit(1);
}
if (!container) {
  console.error('No running Supabase DB container found. Run `supabase start` first.');
  process.exit(1);
}

let totalPasses = 0;
for (const file of sqlFiles) {
  const sqlPath = join(here, file);
  if (!existsSync(sqlPath)) { console.error('Missing test file:', sqlPath); process.exit(1); }
  console.log(`Running ${file} against ${container} ...`);
  const res = spawnSync(
    docker,
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    { input: readFileSync(sqlPath), encoding: 'utf8' }
  );
  const out = (res.stdout || '') + (res.stderr || '');
  process.stdout.write(out);
  const passes = (out.match(/PASS /g) || []).length;
  if (/FAIL /.test(out) || res.status !== 0) {
    console.error(`\nDB TESTS FAILED in ${file} (${passes} passed before failure).`);
    process.exit(1);
  }
  totalPasses += passes;
}
console.log(`\nAll ${totalPasses} database (RLS + import) tests passed.`);

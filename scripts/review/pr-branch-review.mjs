import { execSync } from "node:child_process";

function run(command) {
  execSync(command, { stdio: "inherit" });
}

function read(command) {
  return execSync(command, { stdio: "pipe" }).toString().trim();
}

function fail(message) {
  console.error(`\n[review:branch] ${message}`);
  process.exit(1);
}

function tryRead(command) {
  try {
    return read(command);
  } catch {
    return null;
  }
}

function resolveBaseRef() {
  const fromArg = process.argv[2];
  const fromEnv = process.env.REVIEW_BASE_REF;
  const candidates = [fromArg, fromEnv, "origin/main", "main", "master"].filter(
    Boolean,
  );

  for (const candidate of candidates) {
    const ok = tryRead(`git rev-parse --verify "${candidate}"`);
    if (ok) {
      return candidate;
    }
  }

  fail(
    "Unable to resolve base ref. Provide one via `npm run review:branch -- <base-ref>` or REVIEW_BASE_REF.",
  );
}

function listChangedFiles(range) {
  const output = read(`git diff --name-only --diff-filter=ACMR ${range}`);
  if (!output) {
    return [];
  }
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasPrefix(files, prefix) {
  return files.some((file) => file.startsWith(prefix));
}

function main() {
  console.log("--- Tracehound Branch Review Gate ---");

  const baseRef = resolveBaseRef();
  const mergeBase = read(`git merge-base HEAD "${baseRef}"`);
  const range = `${mergeBase}..HEAD`;
  const commitCount = Number(read(`git rev-list --count ${range}`));
  const changedFiles = listChangedFiles(range);

  console.log(`Base ref      : ${baseRef}`);
  console.log(`Merge base    : ${mergeBase}`);
  console.log(`Commits in PR : ${commitCount}`);
  console.log(`Changed files : ${changedFiles.length}`);

  if (changedFiles.length === 0) {
    console.log(
      "\n[review:branch] No changes detected against base. Nothing to review.",
    );
    return;
  }

  const touchedCore = hasPrefix(changedFiles, "packages/core/");
  const touchedCli = hasPrefix(changedFiles, "packages/cli/");
  const touchedExpress = hasPrefix(changedFiles, "packages/express/");
  const touchedFastify = hasPrefix(changedFiles, "packages/fastify/");

  // 2) Hygiene checks across full changed branch range
  run(`git diff --check ${range}`);
  run("pnpm lint");

  // 3) Package-level test gates for all touched areas
  if (touchedCore) {
    run("pnpm --filter @tracehound/core test");
  }
  if (touchedCli) {
    run("pnpm --filter @tracehound/cli test");
  }
  if (touchedExpress) {
    run("pnpm --filter @tracehound/express test");
  }
  if (touchedFastify) {
    run("pnpm --filter @tracehound/fastify test");
  }

  // 4) Branch-wide coverage check to mirror Codecov behavior
  run("pnpm test:coverage");

  console.log("\n[review:branch] PASSED");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  fail(`unexpected failure: ${message}`);
}

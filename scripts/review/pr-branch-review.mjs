import { execFileSync, execSync } from "node:child_process";

const SAFE_REF_PATTERN = /^[\w./-]+$/;

function run(command) {
  execSync(command, { stdio: "inherit" });
}

function gitRead(args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();
}

function tryGitRead(args) {
  try {
    return gitRead(args);
  } catch {
    return null;
  }
}

function gitRun(args) {
  execFileSync("git", args, { stdio: "inherit" });
}

function fail(message) {
  console.error(`\n[review:branch] ${message}`);
  process.exit(1);
}

function isSafeRef(candidate) {
  return SAFE_REF_PATTERN.test(candidate);
}

function resolveBaseRef() {
  const fromArg = process.argv[2];
  const fromEnv = process.env.REVIEW_BASE_REF;
  const candidates = [fromArg, fromEnv, "origin/main", "main", "master"].filter(
    (value) => typeof value === "string" && value.length > 0,
  );

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.trim();
    if (!isSafeRef(candidate)) {
      continue;
    }

    const ok = tryGitRead(["rev-parse", "--verify", candidate]);
    if (ok) {
      return candidate;
    }
  }

  fail(
    "Unable to resolve base ref. Provide one via `npm run review:branch -- <base-ref>` or REVIEW_BASE_REF.",
  );
}

function listChangedFiles(range) {
  const output = gitRead(["diff", "--name-only", "--diff-filter=ACMR", range]);
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
  const mergeBase = gitRead(["merge-base", "HEAD", baseRef]);
  const range = `${mergeBase}..HEAD`;
  const commitCount = Number(gitRead(["rev-list", "--count", range]));
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
  gitRun(["diff", "--check", range]);
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

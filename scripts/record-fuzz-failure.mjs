#!/usr/bin/env node

// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function parseArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const initMode = process.argv.includes("--init");
const recordPath = parseArg("--record");
if (!initMode && !recordPath) {
  throw new Error(
    "Usage: node scripts/record-fuzz-failure.mjs --init OR --record <failure.json>",
  );
}

const safeRecordPath = recordPath ? resolve(recordPath) : null;
if (
  safeRecordPath &&
  !safeRecordPath.startsWith(resolve("security/artifacts"))
) {
  throw new Error(
    "Path traversal blocked: Record path must be within security/artifacts/",
  );
}

const record = initMode
  ? null
  : JSON.parse(readFileSync(safeRecordPath, "utf8"));

const required = [
  "id",
  "invariantId",
  "class",
  "seed",
  "inputFingerprint",
  "minimizedPayloadPath",
  "replayCommand",
  "replayResult",
  "severity",
  "status",
];

if (record) {
  for (const field of required) {
    if (!(field in record)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

const now = new Date().toISOString();

const dbPath = resolve("security/artifacts/generated/fuzz-failures.json");
mkdirSync(dirname(dbPath), { recursive: true });
const db = existsSync(dbPath)
  ? JSON.parse(readFileSync(dbPath, "utf8"))
  : { updatedAt: now, records: [] };

const nextDb = record
  ? {
      updatedAt: now,
      records: [
        ...db.records.filter((entry) => entry.id !== record.id),
        { ...record, updatedAt: now },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    }
  : {
      updatedAt: now,
      records: db.records,
    };

writeFileSync(dbPath, `${JSON.stringify(nextDb, null, 2)}\n`);

function writeFailureLog() {
  const open = nextDb.records.filter((entry) => entry.status !== "resolved");
  const header = [
    "# Fuzz Failure Log",
    "",
    `Updated: ${now}`,
    "",
    "| ID | Invariant | Class | Severity | Status | Replay Result |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  const rows = open.length
    ? open.map(
        (entry) =>
          `| ${entry.id} | ${entry.invariantId} | ${entry.class} | ${entry.severity} | ${entry.status} | ${entry.replayResult} |`,
      )
    : ["| none | - | - | - | resolved | none |"];

  writeFileSync(
    resolve("security/artifacts/fuzz-failure-log.md"),
    `${header.concat(rows).join("\n")}\n`,
  );
}

function writeMinimizationLog() {
  const lines = [
    "# Fuzz Minimization Log",
    "",
    `Updated: ${now}`,
    "",
    "| ID | Fingerprint | Minimized Payload |",
    "| --- | --- | --- |",
  ];

  const rows = nextDb.records.map(
    (entry) =>
      `| ${entry.id} | ${entry.inputFingerprint} | ${entry.minimizedPayloadPath} |`,
  );

  writeFileSync(
    resolve("security/artifacts/fuzz-minimization-log.md"),
    `${lines.concat(rows.length ? rows : ["| none | - | - |"]).join("\n")}\n`,
  );
}

function writeRegressionSeeds() {
  const relevant = nextDb.records.filter(
    (entry) => entry.status === "open" || entry.status === "regression",
  );
  const lines = [
    "# Fuzz Regression Seeds",
    "",
    `Updated: ${now}`,
    "",
    "Seed source of truth: `security/corpus/manifest.json` + tracked lifecycle records.",
    "",
    "| ID | Class | Replay Command |",
    "| --- | --- | --- |",
  ];

  const rows = relevant.map(
    (entry) => `| ${entry.id} | ${entry.class} | \`${entry.replayCommand}\` |`,
  );
  writeFileSync(
    resolve("security/artifacts/fuzz-regression-seeds.md"),
    `${lines.concat(rows.length ? rows : ["| none | - | - |"]).join("\n")}\n`,
  );
}

writeFailureLog();
writeMinimizationLog();
writeRegressionSeeds();

console.log(
  record
    ? `Recorded fuzz failure lifecycle entry: ${record.id}`
    : "Initialized fuzz failure lifecycle artifacts",
);

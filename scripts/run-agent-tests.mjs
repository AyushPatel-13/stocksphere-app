#!/usr/bin/env node
// Discovers *.test.ts files under lib/agent and app/api/agent, then runs
// them via `tsx --test <files...>`.
//
// Why this exists: `tsx --test <directory>` fails with
// ERR_UNSUPPORTED_DIR_IMPORT (Node doesn't resolve a bare directory as a
// module), and shell-based discovery (`**` globs, `$(find ...)`) either
// doesn't recurse by default (bash) or doesn't exist at all (Windows
// cmd.exe). Walking the filesystem in plain Node avoids both problems and
// behaves the same on Windows, macOS, and Linux.

import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const TEST_ROOTS = ["lib/agent", "app/api/agent"];

function findTestFiles(dir) {
  const found = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      found.push(...findTestFiles(fullPath));
    } else if (stats.isFile() && entry.endsWith(".test.ts")) {
      found.push(fullPath);
    }
  }

  return found;
}

const testFiles = TEST_ROOTS.flatMap((root) => findTestFiles(root));

if (testFiles.length === 0) {
  console.error(`No *.test.ts files found under: ${TEST_ROOTS.join(", ")}`);
  process.exit(1);
}

console.log(`Running ${testFiles.length} test file(s):`);
for (const file of testFiles) {
  console.log(`  ${file}`);
}

// Spawn `node <resolved tsx CLI script> --test <files...>` directly instead
// of going through `npx`/`npx.cmd`. On Windows, spawnSync-ing a .cmd shim
// (without shell: true) throws EINVAL; shell: true works but re-introduces
// shell-quoting concerns. Resolving tsx's own CLI entry point and running
// it with the current Node binary (process.execPath) is a plain executable
// spawn — no shell, no shim — and behaves identically on every platform.
const require = createRequire(import.meta.url);
const tsxCliPath = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");

const result = spawnSync(process.execPath, [tsxCliPath, "--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);

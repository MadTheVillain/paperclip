#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { buildReleasePackagePlan } from "./release-package-map.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function normalizePath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function usage() {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/bootstrap-npm-package.mjs <package-name-or-dir> [--publish] [--skip-build]",
      "",
      "Examples:",
      "  node scripts/bootstrap-npm-package.mjs @paperclipai/adapter-acpx-local",
      "  node scripts/bootstrap-npm-package.mjs packages/adapters/acpx-local --publish",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const flags = new Set();
  let selector = null;

  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }

    if (arg === "--publish" || arg === "--skip-build") {
      flags.add(arg);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return { help: true, selector: null, publish: false, skipBuild: false };
    }

    if (arg.startsWith("--")) {
      throw new Error(`unknown option: ${arg}`);
    }

    if (selector) {
      throw new Error("expected exactly one package selector");
    }

    selector = arg;
  }

  return {
    help: false,
    selector,
    publish: flags.has("--publish"),
    skipBuild: flags.has("--skip-build"),
  };
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function runChecked(command, args, options = {}) {
  const result = runCommand(command, args, options);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
  }
}

function ensureNpmAuth() {
  const result = runCommand("npm", ["whoami"]);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  if (result.status === 0) {
    return;
  }

  const output = `${stdout}\n${stderr}`.trim();
  if (/\bE401\b|401 Unauthorized/i.test(output)) {
    throw new Error(
      [
        "npm auth check failed.",
        "Run `npm login` or `npm adduser` on this maintainer machine with an npm account that can publish to the @paperclipai scope, then rerun with --publish.",
        "Do not use this auth flow in CI; it is only for the one-time human bootstrap publish.",
      ].join(" "),
    );
  }

  throw new Error("npm whoami failed");
}

function inspectNpmPackage(packageName) {
  const result = runCommand("npm", ["view", packageName, "version", "--json"]);

  if (result.status === 0) {
    const version = JSON.parse((result.stdout ?? "").trim());
    return { exists: true, version };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (/\bE404\b|404 Not Found|could not be found/i.test(output)) {
    return { exists: false };
  }

  process.stderr.write(output ? `${output}\n` : "");
  throw new Error(`failed to query npm for ${packageName}`);
}

function resolveTargetPackage(selector, packages = buildReleasePackagePlan()) {
  const normalizedSelector = normalizePath(selector);
  const matches = packages.filter(
    (pkg) => pkg.name === selector || normalizePath(pkg.dir) === normalizedSelector,
  );

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(`package selector is ambiguous: ${selector}`);
  }

  throw new Error(
    `unknown package selector: ${selector}\nKnown packages:\n- ${packages.map((pkg) => `${pkg.name} (${pkg.dir})`).join("\n- ")}`,
  );
}

function printNextSteps(pkg) {
  process.stdout.write(
    [
      "",
      "Publish succeeded. Next:",
      `1. Open https://www.npmjs.com/package/${pkg.name}`,
      "2. Go to Settings -> Trusted publishing",
      "3. Add repository paperclipai/paperclip",
      "4. Set workflow filename to release.yml",
      "5. Optionally enable Settings -> Publishing access -> Require two-factor authentication and disallow tokens",
      "",
    ].join("\n"),
  );
}

function main(argv) {
  const { help, selector, publish, skipBuild } = parseArgs(argv);

  if (help) {
    usage();
    return;
  }

  if (!selector) {
    usage();
    throw new Error("missing package selector");
  }

  const pkg = resolveTargetPackage(selector);
  process.stdout.write(`Selected ${pkg.name} (${pkg.dir})\n`);

  const npmState = inspectNpmPackage(pkg.name);
  if (npmState.exists) {
    throw new Error(`${pkg.name} already exists on npm at version ${npmState.version}; bootstrap is only for first publish`);
  }

  process.stdout.write(`${pkg.name} is not on npm yet; continuing with bootstrap flow.\n`);

  if (publish) {
    process.stdout.write("Checking npm auth with npm whoami...\n");
    ensureNpmAuth();
  }

  if (!skipBuild && typeof pkg.pkg?.scripts?.build === "string") {
    process.stdout.write(`Building ${pkg.name}...\n`);
    runChecked("pnpm", ["--filter", pkg.name, "build"]);
  }

  process.stdout.write(`Previewing publish payload for ${pkg.name}...\n`);
  runChecked("npm", ["pack", "--dry-run"], { cwd: join(repoRoot, pkg.dir) });

  if (!publish) {
    process.stdout.write(
      [
        "",
        `Dry run complete. To perform the first publish from an authenticated maintainer machine, run:`,
        `node scripts/bootstrap-npm-package.mjs ${pkg.name} --publish`,
        "",
      ].join("\n"),
    );
    return;
  }

  process.stdout.write(`Publishing ${pkg.name}...\n`);
  runChecked("npm", ["publish", "--access", "public"], { cwd: join(repoRoot, pkg.dir) });
  printNextSteps(pkg);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

export {
  ensureNpmAuth,
  inspectNpmPackage,
  parseArgs,
  resolveTargetPackage,
};

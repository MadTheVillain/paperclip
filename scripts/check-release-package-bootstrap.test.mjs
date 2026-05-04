import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNpmViewFailure,
  collectReleasePackagesForChangedPaths,
} from "./check-release-package-bootstrap.mjs";

test("manifest changes force validation of all release-enabled packages", () => {
  const releasePackages = [
    { dir: "packages/a", name: "@paperclipai/a", publishFromCi: true },
    { dir: "packages/b", name: "@paperclipai/b", publishFromCi: true },
    { dir: "packages/c", name: "@paperclipai/c", publishFromCi: false },
  ];

  const changedPackages = collectReleasePackagesForChangedPaths(
    ["scripts/release-package-manifest.json"],
    releasePackages,
  );

  assert.deepEqual(
    changedPackages.map((pkg) => pkg.name),
    ["@paperclipai/a", "@paperclipai/b"],
  );
});

test("package-specific changes only validate affected release-enabled packages", () => {
  const releasePackages = [
    { dir: "packages/a", name: "@paperclipai/a", publishFromCi: true },
    { dir: "packages/b", name: "@paperclipai/b", publishFromCi: true },
  ];

  const changedPackages = collectReleasePackagesForChangedPaths(
    ["packages/b/package.json", "README.md"],
    releasePackages,
  );

  assert.deepEqual(
    changedPackages.map((pkg) => pkg.name),
    ["@paperclipai/b"],
  );
});

test("npm E404 failures are treated as missing packages", () => {
  assert.equal(classifyNpmViewFailure("npm error code E404"), "missing");
  assert.equal(classifyNpmViewFailure("404 Not Found"), "missing");
});

test("non-404 npm failures are treated as registry errors", () => {
  assert.equal(classifyNpmViewFailure("npm error code EAI_AGAIN"), "registry_error");
  assert.equal(classifyNpmViewFailure("npm error code E429"), "registry_error");
});

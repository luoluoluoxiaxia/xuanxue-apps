#!/usr/bin/env node
// Optional maintenance task, separate from the dependency-free Web release.
// Run: node scripts/vendor/readium/build.mjs
import { createHash } from "node:crypto";
import { mkdtemp, readFile, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const vendor = fileURLToPath(new URL("../../../web/public/vendor/", import.meta.url));
const stem = "readium-decorator-1.2.5";
const scratch = await mkdtemp(join(tmpdir(), "xuanxue-readium-vendor-"));
const digest = value => createHash("sha256").update(value).digest("hex");
try {
  for (const name of ["package.json", "package-lock.json"]) await copyFile(join(here, name), join(scratch, name));
  const installed = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: scratch, stdio: "inherit" });
  if (installed.status !== 0) throw new Error("Pinned Readium build dependencies could not be installed");
  const { build } = await import(pathToFileURL(join(scratch, "node_modules/esbuild/lib/main.js")));
  const notice = "Readium decorator 1.2.5; generated browser ES module with esbuild 0.28.2. " +
    "See readium-decorator-1.2.5.NOTICE.txt, LICENSE.txt and THIRD-PARTY-LICENSES.txt.";
  const result = await build({
    stdin: { contents: await readFile(join(here, "entry.mjs"), "utf8"), resolveDir: scratch, sourcefile: "readium-vendor-entry.mjs" },
    bundle: true, format: "esm", platform: "browser", target: ["es2022"], minify: true, write: false,
    metafile: true, legalComments: "inline", define: { "process.env.NODE_ENV": '"production"' },
    banner: { js: `/*! ${notice} */` },
  });
  if (result.outputFiles.length !== 1) throw new Error("Readium must remain one self-contained JavaScript asset");
  const output = result.outputFiles[0].contents;
  const inputs = Object.values(result.metafile.outputs).flatMap(value => Object.entries(value.inputs)
    .filter(([, stats]) => stats.bytesInOutput > 0).map(([name]) => name));
  const retainedPackages = [...new Set(inputs.filter(name => name.includes("node_modules/"))
    .map(name => name.split("node_modules/").at(-1).split("/").slice(0, name.split("node_modules/").at(-1).startsWith("@") ? 2 : 1).join("/")))].sort();
  const lock = JSON.parse(await readFile(join(scratch, "package-lock.json"), "utf8"));
  const packages = retainedPackages.map(name => {
    const item = lock.packages[`node_modules/${name}`];
    if (!item?.version || !item.integrity) throw new Error(`No locked source integrity for ${name}`);
    return { name, version: item.version, integrity: item.integrity, tarball: item.resolved, license: item.license };
  });
  const license = await readFile(join(scratch, "node_modules/@readium/decorator/LICENSE"), "utf8");
  const thirdParty = [
    "Bundled Readium source includes the following third-party components.\n",
    "=== Hypothesis anchoring ===\nSource: https://github.com/hypothesis/client/tree/529a0f8e2242d07736d751715974a4356c0a69f1/src/annotator/anchoring\n",
    await readFile(join(here, "LICENSE-hypothesis.txt"), "utf8"),
    "\n=== approx-string-match ===\nSource: https://github.com/robertknight/approx-string-match\n",
    await readFile(join(scratch, "node_modules/@readium/navigator-html-injectables/src/vendor/approx-string-match/LICENSE"), "utf8"),
    "\n=== text-fragments-polyfill 6.7.0 ===\nCopyright 2020 Google LLC\nSource: https://github.com/GoogleChromeLabs/text-fragments-polyfill\nReadium ports and trims the original source; this generated asset is minified and tree-shaken.\n",
    await readFile(join(scratch, "node_modules/@readium/helpers/src/vendor/text-fragments-polyfill/LICENSE"), "utf8"),
  ].join("\n");
  const attribution = [
    "Readium decorator browser asset\nCopyright (c) 2022, Readium Foundation\n",
    "Official project: https://github.com/readium/ts-toolkit\nPublic API: https://github.com/readium/ts-toolkit/tree/develop/decorator\n",
    "The npm dependencies and their integrity hashes are fixed in scripts/vendor/readium/package-lock.json.\n" +
      "This asset bundles only the public HTML decoration/Locator APIs. It does not replace book content or collect account data.\n",
    "Generated with esbuild 0.28.2: ES modules, browser platform, ES2022 target, minified, tree-shaken, production environment.\n" +
      "Source changes consist of this combined browser distribution and its banner; the upstream sources are not edited.\n",
    "Bundled Readium packages:\n" + packages.map(item => `${item.name} ${item.version} (${item.license || "BSD-3-Clause"})`).join("\n") + "\n",
    "Included third-party code: Hypothesis anchoring (BSD-2-Clause, with annotator MIT terms), " +
      "approx-string-match (MIT), and Google's text-fragments-polyfill (Apache-2.0).\n" +
      "Their complete license texts accompany this file. The Readium BSD-3-Clause license is in LICENSE.txt.\n",
    "esbuild is an MIT-licensed build tool and is not a runtime dependency in the distributed Web asset.\n" +
      "To rebuild: node scripts/vendor/readium/build.mjs\n",
  ].join("\n");
  await writeFile(join(vendor, `${stem}.js`), output);
  await writeFile(join(vendor, `${stem}.LICENSE.txt`), license);
  await writeFile(join(vendor, `${stem}.THIRD-PARTY-LICENSES.txt`), thirdParty);
  await writeFile(join(vendor, `${stem}.NOTICE.txt`), attribution);
  const provenance = {
    format: "pinned-browser-vendor-v1", project: "https://github.com/readium/ts-toolkit", asset: `${stem}.js`,
    compiler: { name: "esbuild", version: "0.28.2", target: "es2022", format: "esm", platform: "browser", minified: true, production: true },
    packages, package_lock_sha256: digest(await readFile(join(here, "package-lock.json"))),
    entry_sha256: digest(await readFile(join(here, "entry.mjs"))),
    bytes: output.length, gzip_bytes: gzipSync(output).length, sha256: digest(output),
    license_files: ["LICENSE.txt", "THIRD-PARTY-LICENSES.txt", "NOTICE.txt"].map(suffix => `${stem}.${suffix}`),
  };
  await writeFile(join(vendor, `${stem}.PROVENANCE.json`), JSON.stringify(provenance, null, 2) + "\n");
  console.log(`Readium vendor: ${output.length} bytes; SHA-256 ${provenance.sha256}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}

#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, "web", "public");

function fail(message) {
  console.error(`web check failed: ${message}`);
  process.exit(1);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${relative(root, path)}`);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const required = [
  "index.html",
  "app.js",
  "app-bootstrap.js",
  "account.js",
  "chat-render.js",
  "community.js",
  "personal-home.js",
  "credit-ledger.js",
  "share-card.js",
  "style.css",
  "chat.css",
  "community.css",
  "account.css",
  "personal-home.css",
  "credit-ledger.css",
  "forecast-view.html",
  "forecast.css",
  "robots.txt",
  "sitemap.xml",
  "modules/core.js",
  "modules/chat-copy.js",
  "modules/chart-domain.js",
  "modules/dayun-mechanics.js",
  "modules/location-picker.js",
  "modules/modal-manager.js",
  "modules/home-community.js",
  "modules/profile-workspace.js",
  "modules/chat-workspace.js",
  "assets/xuanshu-favicon.svg",
  "vendor/echarts-6.1.0.min.js",
  "vendor/echarts-6.1.0.LICENSE.txt",
  "vendor/echarts-6.1.0.NOTICE.txt",
  "vendor/licenses/LICENSE-d3",
  "vendor/licenses/LICENSE-administrative-divisions-of-china",
  "vendor/qrcode-generator-2.0.4.mjs",
  "vendor/qrcode-generator-2.0.4.LICENSE.txt",
  "maps/china-geojson-1.0.4.json",
  "maps/china-map-geojson-1.0.4.LICENSE.txt",
];

for (const name of required) {
  const path = join(publicDir, name);
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`missing ${name}`);
}

const files = walk(publicDir);
for (const path of files.filter(path => /\.(?:js|mjs)$/.test(path))) {
  const result = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
  if (result.status !== 0) fail(`syntax check failed: ${relative(root, path)}`);
}

const html = readFileSync(join(publicDir, "index.html"), "utf8");
for (const hiddenEntry of [
  'data-hero-nav="detailed"',
  "data-open-detailed",
]) {
  if (html.includes(hiddenEntry)) fail(`hidden detailed-reading entry is public: ${hiddenEntry}`);
}
if (!html.includes("const detailedEntry = false;")) {
  fail("hidden detailed-reading direct entry is enabled");
}
const scriptSources = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
const expectedOrder = [
  "chat-render.js",
  "regions.js",
  "account.js",
  "share-card.js",
  "personal-home.js",
  "credit-ledger.js",
  "modules/core.js",
  "modules/chat-copy.js",
  "modules/chart-domain.js",
  "modules/dayun-mechanics.js",
  "modules/location-picker.js",
  "modules/modal-manager.js",
  "modules/home-community.js",
  "app.js",
  "modules/profile-workspace.js",
  "modules/chat-workspace.js",
  "app-bootstrap.js",
  "community.js",
];
let previous = -1;
for (const source of expectedOrder) {
  const index = scriptSources.findIndex(value => value.split("?", 1)[0] === source);
  if (index < 0) fail(`index.html does not load ${source}`);
  if (index <= previous) fail(`index.html loads ${source} out of order`);
  previous = index;
}

for (const source of scriptSources) {
  if (/^(?:https?:)?\/\//.test(source)) continue;
  const path = join(publicDir, source.split("?", 1)[0].replace(/^\//, ""));
  if (!existsSync(path)) fail(`index.html references missing script ${source}`);
}

const core = readFileSync(join(publicDir, "modules", "core.js"), "utf8");
if (!core.includes('location?.protocol === "https:" ? "; Secure" : ""')) {
  fail("resume cookies must be Secure on HTTPS");
}

const app = readFileSync(join(publicDir, "app.js"), "utf8");
if (!app.includes("const DETAILED_PUBLIC_ENTRY_ENABLED = false;")) {
  fail("hidden detailed-reading app entry is enabled");
}
if (!app.includes('"X-Xuanshu-Interaction": "same-origin-v1"')) {
  fail("feedback submissions must carry same-origin interaction proof");
}
const dayunMechanics = readFileSync(join(publicDir, "modules", "dayun-mechanics.js"), "utf8");
for (const field of [
  "branch_hidden_stems",
  "day_master_stage",
  "na_yin",
  "pillar_xun_kong",
  "in_natal_xun_kong",
  "shensha",
  "relations_to_natal",
  "relations_to_natal_endpoints",
]) {
  if (!dayunMechanics.includes(field)) fail(`advanced DaYun mechanics missing ${field}`);
}
if (!app.includes("DayunMechanics.markup(step,")) {
  fail("advanced DaYun mechanics are not connected to the selected step");
}
for (const marker of [
  'data-dayun-mechanics-level="relations"',
  'data-dayun-mechanics-level="endpoints"',
  "relationsOpen",
  "endpointsOpen",
]) {
  if (!dayunMechanics.includes(marker) && !app.includes(marker)) {
    fail(`advanced DaYun mechanics hierarchy missing ${marker}`);
  }
}

const account = readFileSync(join(publicDir, "account.js"), "utf8");
for (const requiredAuthBoundary of [
  "验证邮箱后创建账户，注册即赠送积分",
  "{ email, password, code }",
  "忘记或重设密码",
  'endpoint = isRegister ? "register" : isPasswordReset ? "password/reset" : "login"',
]) {
  if (!account.includes(requiredAuthBoundary)) {
    fail(`account registration boundary missing ${requiredAuthBoundary}`);
  }
}
for (const retiredInviteMarker of ["领取邀请码", "invite_code", "/api/auth/invite-code"]) {
  if (account.includes(retiredInviteMarker)) {
    fail(`account registration still exposes retired invite marker ${retiredInviteMarker}`);
  }
}

const community = readFileSync(join(publicDir, "community.js"), "utf8");
if ((community.match(/"X-Xuanshu-Interaction": "same-origin-v1"/g) || []).length !== 5) {
  fail("community likes, views, follows, and resolutions must carry same-origin interaction proof");
}

const forecast = readFileSync(join(publicDir, "forecast-view.html"), "utf8");
for (const forbidden of [
  "sessionStorage.setItem",
  'localStorage.setItem("xz_forecast_cred"',
]) {
  if (forecast.includes(forbidden)) fail(`forecast page persists a report password: ${forbidden}`);
}
if (!forecast.includes('localStorage.removeItem("xz_forecast_cred")')) {
  fail("forecast page does not remove legacy stored credentials");
}

console.log(`web check complete: ${files.length} static files verified`);

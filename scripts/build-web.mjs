#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, "web", "public");
const nextDir = join(publicDir, "next");

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

const read = name => readFileSync(join(publicDir, name), "utf8");
const isExternal = reference => /^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith("data:");
const localPath = reference => reference.split(/[?#]/, 1)[0].replace(/^\//, "");

const required = [
  "index.html",
  "chat-render.js",
  "regions.js",
  "share-card.js",
  "next/app.js",
  "next/next.css",
  "next/next-reading.css",
  "next/next-personal.css",
  "next/next-chart.css",
  "next/next-knowledge.css",
  // 岁运全书旧报告页（后端路由 /forecast/view/<id>）仍直接引用下面这些资源。
  "style.css",
  "forecast-view.html",
  "forecast.css",
  "robots.txt",
  "sitemap.xml",
  "assets/xuanshu-favicon.svg",
  "vendor/echarts-6.1.0.min.js",
  "vendor/echarts-6.1.0.LICENSE.txt",
  "vendor/echarts-6.1.0.NOTICE.txt",
  "vendor/licenses/LICENSE-d3",
  "vendor/licenses/LICENSE-administrative-divisions-of-china",
  "vendor/qrcode-generator-2.0.4.mjs",
  "vendor/qrcode-generator-2.0.4.LICENSE.txt",
  "vendor/readium-decorator-1.2.5.js",
  "vendor/readium-decorator-1.2.5.LICENSE.txt",
  "vendor/readium-decorator-1.2.5.THIRD-PARTY-LICENSES.txt",
  "vendor/readium-decorator-1.2.5.NOTICE.txt",
  "vendor/readium-decorator-1.2.5.PROVENANCE.json",
  "maps/china-geojson-1.0.4.json",
  "maps/china-map-geojson-1.0.4.LICENSE.txt",
];

for (const name of required) {
  const path = join(publicDir, name);
  if (!existsSync(path) || !lstatSync(path).isFile()) fail(`missing ${name}`);
}

// 旧版首页（经典版）和它的换肤层已经移除；合并旧分支时不要把它们带回来。
for (const retired of [
  "next.html",
  "app.js",
  "app-bootstrap.js",
  "personal-home.js",
  "personal-home.css",
  "credit-ledger.js",
  "credit-ledger.css",
  "profile-library.css",
  "chat.css",
  "ui-next.css",
  "modules",
]) {
  if (existsSync(join(publicDir, retired))) fail(`retired classic home file is back: ${retired}`);
}

const files = walk(publicDir);
for (const path of files.filter(path => /\.(?:js|mjs)$/.test(path))) {
  const result = spawnSync(process.execPath, ["--check", path], { stdio: "inherit" });
  if (result.status !== 0) fail(`syntax check failed: ${relative(root, path)}`);
}

// index.html：前端入口，同时是搜索引擎收录的规范页面。
const html = read("index.html");
const entry = /<script type="module" src="next\/app\.js\?v=([a-z0-9-]+)"><\/script>/.exec(html);
if (!entry) fail("index.html must load next/app.js as a versioned module");
const version = entry[1];
for (const sheet of ["next/next.css", "next/next-reading.css", "next/next-personal.css", "next/next-chart.css"]) {
  if (!html.includes(`href="${sheet}?v=${version}"`)) fail(`index.html must load ${sheet} with version ${version}`);
}
if (!/<script src="chat-render\.js\?v=[^"]+"><\/script>/.test(html)) fail("index.html must load the shared answer renderer");
if (!html.includes('localStorage.getItem("xz-next-theme")')) fail("index.html must choose the color scheme before first paint");
if (!/<title>[^<]+<\/title>/.test(html)) fail("index.html must have a title");
for (const seo of [
  '<meta name="description" content="',
  '<meta name="robots" content="index,follow',
  '<link rel="canonical" href="https://xx.zsien.tech/">',
  '<meta property="og:title" content="',
  '<script type="application/ld+json">',
]) {
  if (!html.includes(seo)) fail(`index.html lost search metadata: ${seo}`);
}
if (/noindex/i.test(html)) fail("index.html must stay indexable");
try {
  JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
} catch (error) {
  fail(`index.html structured data is not valid JSON: ${error.message}`);
}
const references = [
  ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]),
  ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(match => match[1]),
].filter(reference => !isExternal(reference));
for (const reference of references) {
  if (!existsSync(join(publicDir, localPath(reference)))) fail(`index.html references missing file ${reference}`);
}

// next/：零构建原生 ES 模块。所有相对导入必须带同一个版本号并指向存在的文件，
// 否则同一模块可能被浏览器加载两份、状态分裂，或者整页因为缺模块而打不开。
const nextModules = walk(nextDir).filter(path => path.endsWith(".js"));
for (const path of nextModules) {
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/(?:import|export)\s[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    if (!match[1].endsWith(`.js?v=${version}`)) fail(`${relative(root, path)} imports ${match[1]} without ?v=${version}`);
  }
  for (const match of text.matchAll(/import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    if (!match[1].endsWith(`?v=${version}`)) fail(`${relative(root, path)} dynamically imports ${match[1]} without ?v=${version}`);
  }
  for (const match of text.matchAll(/(?:from\s+|import\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
    if (!existsSync(join(dirname(path), localPath(match[1])))) fail(`${relative(root, path)} imports missing module ${match[1]}`);
  }
}
const nextSource = nextModules.map(path => readFileSync(path, "utf8")).join("\n");
const nextFile = name => readFileSync(join(nextDir, name), "utf8");
for (const forbidden of [
  "cost_budget_usd_per_credit",
  "estimated_margin_percent",
  "/api/auth/invite-code",
  "invite_code",
  "领取邀请码",
  "session_token",
]) {
  if (nextSource.includes(forbidden)) fail(`next/ must not use ${forbidden}`);
}
for (const marker of ['"X-XuanShu-CSRF"', '"X-Xuanshu-Interaction"', '"same-origin-v1"']) {
  if (!nextSource.includes(marker)) fail(`next/ lost request header ${marker}`);
}
// 会话只由服务端的 HttpOnly Cookie 承担，前端不写 Cookie。
if (/document\.cookie\s*=/.test(nextSource)) fail("next/ must not write cookies");

// 原生 replaceChildren / append 等会把 null、undefined、布尔值写成「null」「false」文字（曾在线上的
// 「关注进展」按钮上出现）。顶层参数不能是可能落成这些值的条件表达式；这种情况用 lib/dom.js 的 fill()。
function withoutNesting(text) {
  let out = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}
function splitTopLevel(text, open = 0) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  let i = open;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += text[++i] || "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return { parts: parts.map(part => part.trim()).filter(Boolean), end: i };
}
// 拆掉包住整个表达式的多余括号，例如 ((ready && node))。
function unwrap(text) {
  let value = text.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    let depth = 0;
    let quote = "";
    let closesAt = -1;
    for (let i = 0; i < value.length && closesAt < 0; i++) {
      const ch = value[i];
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
      else if ("([{".includes(ch)) depth++;
      else if (")]}".includes(ch) && --depth === 0) closesAt = i;
    }
    if (closesAt !== value.length - 1) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}
function mayBeBlank(argument) {
  // 括起来的 (null) / (false) 视同 null / false，免得和其余嵌套内容一起被略过。
  const top = withoutNesting(unwrap(argument).replace(/\(\s*(null|undefined|false)\s*\)/g, "$1"));
  const ternary = /\?(?![.?])/.exec(top.replace(/\?\?/g, "  "));
  if (ternary) return /\?\s*(?:null|undefined|false)\s*:/.test(top) || /:\s*(?:null|undefined|false)\s*$/.test(top);
  return /&&|\|\|\s*(?:null|undefined|false)\s*$|\?\?\s*(?:null|undefined)\s*$/.test(top);
}
for (const path of nextModules) {
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/\.(?:replaceChildren|append|prepend|before|after|replaceWith)\(/g)) {
    const { parts } = splitTopLevel(text, match.index + match[0].length);
    for (const part of parts) {
      let risky = false;
      if (part.startsWith("...[")) {
        // 展开的数组字面量：末尾有 .filter(Boolean) 就安全，否则逐项检查。
        if (!/\]\s*\.filter\(Boolean\)\s*$/.test(part)) risky = splitTopLevel(part, 4).parts.some(mayBeBlank);
      } else if (!part.startsWith("...")) {
        risky = mayBeBlank(part);
      }
      if (risky) {
        const line = text.slice(0, match.index).split("\n").length;
        fail(`${relative(root, path)}:${line} passes a value that may be null/false to a native DOM insert; use fill() from lib/dom.js`);
      }
    }
  }
}

// 点赞、浏览、关注、采纳、请 AI 解读与反馈都要带同域互动证明。
for (const [file, call] of [
  ["views/feed.js", /\/like`/],
  ["views/post.js", /\/ai-answer`/],
  ["views/post.js", /\$\{path\}\/view`/],
  ["views/post.js", /\$\{path\}\/follow`/],
  ["views/post.js", /\$\{path\}\/resolve`/],
  ["views/feedback.js", /"\/api\/feedback"/],
]) {
  const text = nextFile(file);
  const match = call.exec(text);
  if (!match) fail(`next/${file} no longer sends ${call}`);
  if (!/interaction:\s*true/.test(text.slice(match.index, match.index + 600))) {
    fail(`next/${file} must send ${call} with same-origin interaction proof`);
  }
}

// 进阶大运：字段与两层折叠（作用关系 / 逐柱落点）要接到当前选中的大运上。
const chartBazi = nextFile("ui/chart-bazi.js");
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
  if (!chartBazi.includes(field)) fail(`advanced DaYun mechanics missing ${field}`);
}
for (const marker of [
  'data-dayun-mechanics-level="relations"',
  'data-dayun-mechanics-level="endpoints"',
  "relationsOpen",
  "endpointsOpen",
]) {
  if (!chartBazi.includes(marker)) fail(`advanced DaYun mechanics hierarchy missing ${marker}`);
}
if ((chartBazi.match(/mechanicsBlock\(step,/g) || []).length < 2) {
  fail("advanced DaYun mechanics are not connected to the selected step");
}

// 登录与注册：邮箱验证码注册、验证码或密码登录、重设密码；邀请码已下线（见上方禁用词）。
const auth = nextFile("views/auth.js");
for (const marker of ['"/api/auth/code"', "code: code.value", '"password/reset"', "`/api/auth/${endpoint}`"]) {
  if (!auth.includes(marker)) fail(`next/views/auth.js registration boundary missing ${marker}`);
}

// 岁运全书旧报告页：不得在浏览器里保存访问密码。
const forecast = read("forecast-view.html");
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

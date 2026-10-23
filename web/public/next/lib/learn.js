// 「看懂这张盘」：把排盘输入放进本机草稿，讲解页拿它向后端要一页讲解。
// 出生信息不进 URL；键名沿用 xz-next-draft: 前缀，退出登录时随私人草稿一起清掉。
import { h } from "./dom.js?v=n39";
import { icon } from "./icons.js?v=n39";
import { local } from "./store.js?v=n39";
import { localDateTimeISO } from "./ids.js?v=n39";

const inputKey = system => `xz-next-draft:learn:${system}`;

const BAZI_FIELDS = [
  "system", "input_mode", "year", "month", "day", "hour", "minute", "calendar", "is_leap_month", "gender",
  "location", "longitude", "tz_offset", "timezone", "use_true_solar", "day_boundary",
  "manual_birth_year", "year_pillar", "month_pillar", "day_pillar", "hour_pillar",
];

export function learnHref(system) {
  return `#/learn/${system === "liuyao" ? "liuyao" : "bazi"}`;
}

export function saveLearnInput(system, input) {
  local.setJson(inputKey(system), input);
}

export function loadLearnInput(system) {
  const value = local.json(inputKey(system));
  return value && typeof value === "object" ? value : null;
}

// 排盘结果下方的一行入口；点下去时才写入本机，免得只是看盘也留下出生信息。
export function learnEntry(system, getInput) {
  return h("a", {
    class: "learn-entry", href: learnHref(system),
    onClick: () => saveLearnInput(system, getInput()),
  }, icon("book", "icon-sm"), system === "liuyao" ? "这一卦怎么看" : "这张盘怎么看", icon("chevronRight", "icon-sm"));
}

// 八字只带排盘需要的字段，称呼、可见性等与学习无关的不存。
export function baziLearnInput(input = {}) {
  const out = { system: "bazi" };
  BAZI_FIELDS.forEach(key => { if (input[key] !== undefined && input[key] !== null && input[key] !== "") out[key] = input[key]; });
  return out;
}

// 六爻从排盘结果还原卦面：阳动 9、阳静 7、阴动 6、阴静 8，起卦时间取排盘记下的时间。
export function liuyaoLearnInput(payload, input = {}) {
  const yaos = (Array.isArray(payload?.yaos) ? payload.yaos : [])
    .slice().sort((a, b) => Number(a.pos) - Number(b.pos))
    .map(yao => (yao.yin_yang === "阳" ? (yao.moving ? 9 : 7) : (yao.moving ? 6 : 8)));
  const solar = String(payload?.cast_time?.solar || "").replace(" ", "T");
  const out = { system: "liuyao", method: "manual", yaos, question: payload?.question || input.question || "" };
  if (solar) out.as_of = solar;
  ["location", "longitude", "timezone"].forEach(key => { if (input[key]) out[key] = input[key]; });
  return out;
}

// 练习用的随机盘：八字随机出生时间，六爻按三枚铜钱的概率摇六爻。
export function sampleLearnInput(system) {
  const pick = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  if (system === "liuyao") {
    const coin = () => (Math.random() < 0.5 ? 3 : 2);
    return {
      system: "liuyao", method: "manual", question: "",
      yaos: Array.from({ length: 6 }, () => coin() + coin() + coin()),
      as_of: localDateTimeISO(),
    };
  }
  return {
    system: "bazi", input_mode: "birth_time", calendar: "solar",
    year: pick(1960, 2008), month: pick(1, 12), day: pick(1, 28), hour: pick(0, 23), minute: pick(0, 59),
    gender: Math.random() < 0.5 ? "男" : "女", location: "北京",
  };
}

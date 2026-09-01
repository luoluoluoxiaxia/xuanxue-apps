(function (global) {
  "use strict";

  const LIUYAO_FOLLOWUP_BANKS = [
    ["这一卦先看应期还是行动？", "我现在该主动还是该等？"],
    ["这件事最怕卡在哪里？", "如果要成，需要补哪一步？"],
    ["接下来一周我先做什么？", "后面什么时候适合再看？"],
  ];
  const DEFAULT_Q = {
    divination: "请围绕我刚才所问之事详断此卦，并说明用神、世应、动爻和应期倾向。",
    topic: { 本命: "请用普通话说明这张命盘的底色、优势、压力点，以及哪些地方需要谨慎理解。",
      当下: "请说明今年的主线、容易发生变化的地方，以及工作、财务、感情上分别要注意什么。",
      事业: "请说明我的事业方向、适合的工作类型，以及当前阶段的重点。",
      感情: "请说明我的感情特点、相处中要注意的地方，以及当前阶段的提示。",
      财运: "请说明我的财运结构（正财/偏财），以及今年理财上要注意什么。",
      健康: "请说明我五行结构上需要注意的身体方面，以及当前阶段的提示。",
      主线: "请把命盘底色、当前阶段、今年和后续节奏串成一条容易理解的长期主线。" },
  };
  const BAZI_STARTER_QUESTIONS = [
    { label: "命盘整体", question: DEFAULT_Q.topic.本命 },
    { label: "当下运势", question: DEFAULT_Q.topic.当下 },
    { label: "事业工作", question: DEFAULT_Q.topic.事业 },
    { label: "感情关系", question: DEFAULT_Q.topic.感情 },
    { label: "财运收入", question: DEFAULT_Q.topic.财运 },
    { label: "健康节奏", question: DEFAULT_Q.topic.健康 },
    { label: "人生方向", question: DEFAULT_Q.topic.主线 },
  ];
  const BAZI_FOLLOWUP_BANKS = {
    本命: [
      ["先看我的事业方向？", "我今年最该抓哪件事？"],
      ["我的优势具体适合怎么用？", "哪类事最容易消耗我？"],
      ["如果事业上只改一件事，先改什么？", "接下来三个月怎么落地？"],
    ],
    当下: [
      ["今年事业上先稳还是先动？", "今年财务上要注意什么？"],
      ["哪些月份更适合推进大事？", "今年最该避开的坑是什么？"],
      ["接下来三个月先做什么？", "当下该主动争取还是先等？"],
    ],
    事业: [
      ["我更适合哪类岗位？", "今年适合换工作吗？"],
      ["事业上该往管理还是专业走？", "怎么和强势领导相处？"],
      ["下次工作机会来时怎么判断？", "事业上目前最该补哪项能力？"],
    ],
    感情: [
      ["我适合怎样的相处模式？", "今年感情要主动还是慢一点？"],
      ["正缘更像什么类型？", "这段关系最该注意什么？"],
      ["接下来三个月感情怎么做？", "我在关系里先改哪一点？"],
    ],
    财运: [
      ["今年钱主要从哪里来？", "财务上该先求稳还是求机会？"],
      ["财运上适合副业还是主业加薪？", "哪类投资要谨慎？"],
      ["接下来三个月怎么守财？", "我最容易漏财在哪里？"],
    ],
    健康: [
      ["最近累主要该注意什么？", "我适合什么运动节奏？"],
      ["作息和情绪哪个更要先管？", "今年健康上避开什么？"],
      ["健康上接下来三个月怎么养？", "需要重点留意哪个身体部位？"],
    ],
    主线: [
      ["未来三五年先抓什么？", "我这一阶段主线最该避开什么？"],
      ["我的长期优势怎么用？", "哪一步大运最适合发力？"],
      ["未来一年先做什么铺垫？", "如果只选一个方向该选什么？"],
    ],
  };
  const BAZI_FOLLOWUP_FALLBACKS = [
    "这件事我下一步该怎么做？",
    "这部分最需要避开什么？",
    "能不能再说得具体一点？",
    "接下来三个月要注意什么？",
  ];
  const WAITING_LINES = {
    intent: [
      "正在确认你问的对象和时间范围。",
      "正在判断这次需要用到哪些命盘信息。",
      "正在把问题和当前阶段对齐。",
    ],
    analysis: [
      "正在看命局、大运和当前年份。",
      "正在梳理月令、通根与十神关系。",
      "正在把命盘事实串成一条判断。",
    ],
    logic: [
      "正在核对前后判断是否一致。",
      "正在复核喜忌和运年引动。",
      "正在检查结论有没有超出命盘依据。",
    ],
    checking: [
      "正在核对命盘事实与结论。",
      "正在整理成一段直接的回答。",
      "正在收束重点，避免前后矛盾。",
    ],
    final: [
      "正在发送整理后的回复。",
      "马上就好，正在输出完整回答。",
    ],
    combining: [
      "六爻判断完成，正在生成结论。",
      "正在核对结论、条件和行动。",
    ],
    default: [
      "后台正在处理，没有卡住。",
      "正在整理这次问题需要的命盘信息。",
      "正在核对结论和依据。",
    ],
  };
  const LIUYAO_WAITING_LINES = {
    intent: [
      "正在确认所问之事和时间范围。",
      "正在确定本卦的取用与问题边界。",
    ],
    analysis: [
      "正在看世应、用神、动静与旺衰。",
      "正在梳理六亲、六神和日月作用。",
      "正在把卦象和所问之事对上。",
    ],
    logic: [
      "正在核对生克、合冲与卦意是否一致。",
      "正在检查主判断和反证。",
    ],
    checking: [
      "正在把主判断、变化条件和时间范围对齐。",
      "正在检查前后断语是否一致。",
    ],
    final: [
      "正在整理成一段直接的回答。",
      "马上就好，正在输出完整回答。",
    ],
    default: [
      "后台正在处理，没有卡住。",
      "正在核对卦象与所问之事。",
    ],
  };

  function createFollowups({ getSystem, getThread }) {
    function normalizeFollowupText(text) {
      return (text || "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
    }

    function questionAlreadyCovered(question, asked) {
      const q = normalizeFollowupText(question);
      if (!q) return true;
      return asked.some(item => item === q || (q.length >= 8 && item.includes(q)) || (item.length >= 8 && q.includes(item)));
    }

    function askedQuestionNorms(key, msg = {}) {
      const asked = (getThread(key) || [])
        .filter(item => item.kind === "user" && item.text)
        .map(item => normalizeFollowupText(item.text))
        .filter(Boolean);
      const raw = normalizeFollowupText(msg.rawQuestion || "");
      if (raw) asked.push(raw);
      return asked;
    }

    function followupKeyFromText(text) {
      if (/(工作|事业|职业|岗位|换工|领导|创业|上班|跳槽|升职|学业|考试)/.test(text)) return "事业";
      if (/(财|钱|投资|破财|存|工资|理财|副业|收入)/.test(text)) return "财运";
      if (/(感情|对象|桃花|结婚|恋|正缘|关系|婚)/.test(text)) return "感情";
      if (/(健康|身体|累|睡|运动|提不起|生病|作息)/.test(text)) return "健康";
      if (/(主线|一生|这辈子|未来|三五年|长期|短板|方向)/.test(text)) return "主线";
      if (/(今年|流年|运势|当前|当下|大运|这步|十年|月份|本月|三个月)/.test(text)) return "当下";
      return "";
    }

    function followupKeyForMessage(key, msg = {}) {
      const direct = followupKeyFromText(`${msg.rawQuestion || ""} ${msg.rawTopic || ""}`);
      if (direct) return direct;
      if (msg.rawTopic && BAZI_FOLLOWUP_BANKS[msg.rawTopic]) return msg.rawTopic;
      const scenarioKey = {
        natal: "本命",
        liu_nian: "当下",
        da_yun: "当下",
        liu_yue: "当下",
        lifeline: "主线",
      }[msg.rawScenario || ""];
      if (scenarioKey) return scenarioKey;
      const bodyKey = followupKeyFromText(msg.body || "");
      if (bodyKey) return bodyKey;
      return BAZI_FOLLOWUP_BANKS[key] ? key : "本命";
    }

    function pushFollowupCandidates(candidates, groups, stage) {
      if (!groups || !groups.length) return;
      for (let offset = 0; offset < groups.length; offset += 1) {
        const group = groups[(stage + offset) % groups.length] || [];
        group.forEach(item => candidates.push(item));
      }
    }

    function turnStageForFollowups(key, msg = {}) {
      const threadTurns = (getThread(key) || []).filter(item => item.kind === "user").length;
      const userTurns = Math.max(threadTurns, msg.rawQuestion ? 1 : 0);
      return Math.min(2, Math.max(0, userTurns - 1));
    }

    function suggestedLiuYaoFollowups(key, msg = {}) {
      const asked = askedQuestionNorms(key, msg);
      const stage = turnStageForFollowups(key, msg);
      const candidates = [];
      pushFollowupCandidates(candidates, LIUYAO_FOLLOWUP_BANKS, stage);
      const picked = [];
      candidates.forEach(q => {
        const normalized = normalizeFollowupText(q);
        if (picked.length >= 2 || !normalized) return;
        if (picked.some(item => normalizeFollowupText(item) === normalized)) return;
        if (questionAlreadyCovered(q, asked)) return;
        picked.push(q);
      });
      return picked;
    }

    function suggestedFollowups(key, msg = {}) {
      const isLiuyaoMsg = msg.rawScenario ? msg.rawScenario === "divination" : getSystem() === "liuyao";
      if (isLiuyaoMsg) return suggestedLiuYaoFollowups(key, msg);
      const baseKey = followupKeyForMessage(key, msg);
      const stage = turnStageForFollowups(key, msg);
      const asked = askedQuestionNorms(key, msg);
      const candidates = [];
      pushFollowupCandidates(candidates, BAZI_FOLLOWUP_BANKS[baseKey], stage);
      if (baseKey !== key) pushFollowupCandidates(candidates, BAZI_FOLLOWUP_BANKS[key], stage);
      BAZI_FOLLOWUP_FALLBACKS.forEach(item => candidates.push(item));

      const picked = [];
      candidates.forEach(q => {
        const normalized = normalizeFollowupText(q);
        if (picked.length >= 2 || !normalized) return;
        if (picked.some(item => normalizeFollowupText(item) === normalized)) return;
        if (questionAlreadyCovered(q, asked)) return;
        picked.push(q);
      });
      return picked;
    }


    return Object.freeze({ suggestedFollowups });
  }

  global.XuanxueChatCopy = Object.freeze({
    BAZI_FOLLOWUP_BANKS,
    BAZI_FOLLOWUP_FALLBACKS,
    BAZI_STARTER_QUESTIONS,
    DEFAULT_Q,
    LIUYAO_FOLLOWUP_BANKS,
    LIUYAO_WAITING_LINES,
    WAITING_LINES,
    createFollowups,
  });
})(window);

(function (global) {
  "use strict";

  function create({ escapeHtml }) {
    const esc = escapeHtml;

    function endpointDetail(endpoint) {
      const relations = [endpoint?.stem_relation, endpoint?.branch_relation, endpoint?.compound]
        .filter(value => value && !String(value).startsWith("无固定"));
      const actions = [endpoint?.stem_element_action, endpoint?.branch_element_action].filter(Boolean);
      return {
        pair: [endpoint?.a, endpoint?.b].filter(Boolean).join(" ↔ ") || "关系落点",
        relations: relations.join(" · ") || "同柱引动",
        actions: actions.join(" · "),
      };
    }

    function markup(step, { relationsOpen = true, endpointsOpen = false } = {}) {
      if (!step) return "";
      const hidden = Array.isArray(step.branch_hidden_stems) ? step.branch_hidden_stems : [];
      const hiddenMarkup = hidden.length
        ? hidden.map(item => `<span class="dayun-hidden-stem"><b>${esc(item.stem || "—")}</b><em>${esc([item.ten_god, item.qi].filter(Boolean).join(" · ") || "—")}</em></span>`).join("")
        : '<span class="dayun-mechanic-empty">无</span>';
      const shensha = Array.isArray(step.shensha) ? step.shensha.filter(Boolean) : [];
      const relations = Array.isArray(step.relations_to_natal) ? step.relations_to_natal.filter(Boolean) : [];
      const endpoints = Array.isArray(step.relations_to_natal_endpoints)
        ? step.relations_to_natal_endpoints.map(endpointDetail)
        : [];
      const shenshaMarkup = (shensha.length ? shensha : ["无"])
        .map(item => `<span class="rel-chip">${esc(item)}</span>`).join("");
      const relationMarkup = (relations.length ? relations : ["无固定合冲刑害"])
        .map(item => `<span class="rel-chip">${esc(item)}</span>`).join("");
      const endpointMarkup = endpoints.length
        ? endpoints.map(item => `<div class="dayun-endpoint">
            <span>${esc(item.pair)}</span><b>${esc(item.relations)}</b>${item.actions ? `<em>${esc(item.actions)}</em>` : ""}
          </div>`).join("")
        : '<div class="dayun-endpoint empty"><span>暂无明确落点</span></div>';
      const range = [step.age_range ? `${step.age_range}岁` : "", step.year_range || ""].filter(Boolean).join(" · ");

      return `<section class="dayun-mechanics" aria-label="${esc(step.ganzhi || "所选")}大运机械事实">
        <div class="dayun-mechanics-head">
          <div><span>所选大运 · 机械事实</span><strong>${esc(step.ganzhi || "—")}<i>${esc(range)}</i></strong></div>
          <em>排盘确定性结果 · 非 AI 判断</em>
        </div>
        <div class="dayun-mechanics-tier-title"><span>运柱基础</span><em>直接查看</em></div>
        <div class="dayun-mechanics-grid">
          <div class="dayun-mechanic hidden-stems"><span>地支藏干</span><div>${hiddenMarkup}</div></div>
          <div class="dayun-mechanic"><span>日主十二长生</span><b>${esc(step.day_master_stage || "—")}</b></div>
          <div class="dayun-mechanic"><span>纳音</span><b>${esc(step.na_yin || "—")}</b></div>
          <div class="dayun-mechanic"><span>本柱旬空</span><b>${esc(step.pillar_xun_kong || "—")}</b></div>
          <div class="dayun-mechanic"><span>落本命日旬空</span><b>${step.in_natal_xun_kong ? "是" : "否"}</b></div>
        </div>
        <details class="dayun-mechanics-level" data-dayun-mechanics-level="relations"${relationsOpen ? " open" : ""}>
          <summary><span>作用关系</span><em>${shensha.length} 神煞 · ${relations.length} 关系</em></summary>
          <div class="dayun-mechanics-level-body">
            <div class="dayun-mechanics-group"><span>神煞</span><div class="rel-chips">${shenshaMarkup}</div></div>
            <div class="dayun-mechanics-group"><span>与原局</span><div class="rel-chips">${relationMarkup}</div></div>
          </div>
        </details>
        <details class="dayun-mechanics-level" data-dayun-mechanics-level="endpoints"${endpointsOpen ? " open" : ""}>
          <summary><span>逐柱落点</span><em>${endpoints.length ? `${endpoints.length} 处` : "暂无"}</em></summary>
          <div class="dayun-mechanics-level-body">
            <div class="dayun-mechanics-group endpoints"><span>关系落点</span><div class="dayun-endpoints">${endpointMarkup}</div></div>
          </div>
        </details>
      </section>`;
    }

    return Object.freeze({ markup });
  }

  global.XuanxueDayunMechanics = Object.freeze({ create });
})(window);

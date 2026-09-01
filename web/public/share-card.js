(() => {
  "use strict";

  const CARD_WIDTH = 1080;
  const MIN_CARD_HEIGHT = 1440;
  const MAX_CARD_HEIGHT = 3600;
  const CONTENT_LEFT = 88;
  const CONTENT_WIDTH = CARD_WIDTH - CONTENT_LEFT * 2;
  const ANSWER_MAX_HEIGHT = 1760;
  const ANSWER_MAX_CHARS = 900;
  const FOOTER_HEIGHT = 260;
  const FONT_SANS = '"Noto Sans SC","PingFang SC","Microsoft YaHei","Segoe UI",sans-serif';
  const COLORS = {
    background: "#fbfbfa",
    text: "#171719",
    body: "#3f3f44",
    muted: "#86868d",
    line: "#dedee1",
    footer: "#f4f4f5",
    accent: "#ff2442",
    white: "#ffffff",
  };

  const postCache = new Map();
  const SHARE_OVERLAY_ID = "share-card";
  let qrModulePromise = null;
  let dialog = null;
  let activeRequest = 0;
  let activeShare = null;
  let objectUrl = "";

  function isWechatBrowser() {
    return /MicroMessenger/i.test(navigator.userAgent);
  }

  function isTouchFirstDevice() {
    const coarsePointer = typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    return coarsePointer || navigator.maxTouchPoints > 0 ||
      /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isWechatBrowser();
  }

  function canShareImageFile(file) {
    if (!file || typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
      return false;
    }
    try {
      return navigator.canShare({ files: [file] });
    } catch (_) {
      return false;
    }
  }

  function canonicalFor(slug) {
    return location.origin + "/gua/" + encodeURIComponent(slug) + "?ref=post_card";
  }

  function safeTitle(value) {
    return String(value || "玄枢六爻卦帖").trim() || "玄枢六爻卦帖";
  }

  function filenameFor(slug) {
    const clean = String(slug || "liuyao").replace(/[^a-zA-Z0-9_-]+/g, "-");
    return "玄枢卦帖-" + clean + ".png";
  }

  function setFont(ctx, size, weight) {
    ctx.font = String(weight || 400) + " " + size + "px " + FONT_SANS;
    ctx.textBaseline = "top";
  }

  function stripInlineMarkdown(value) {
    return String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/\x60([^\x60]+)\x60/g, "$1")
      .replace(/\\([\\*_[\]{}()#+\-.!>])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function answerBlocks(markdown) {
    const blocks = [];
    const paragraph = [];
    let inFence = false;

    const flushParagraph = () => {
      const text = stripInlineMarkdown(paragraph.join(" "));
      paragraph.length = 0;
      if (text) blocks.push({ type: "paragraph", text: text });
    };

    String(markdown || "").replace(/\r\n?/g, "\n").split("\n").forEach(rawLine => {
      const line = rawLine.trim();
      if (/^\x60{3}/.test(line)) {
        flushParagraph();
        inFence = !inFence;
        return;
      }
      if (!line) {
        flushParagraph();
        return;
      }
      if (/^([-*_])(?:\s*\1){2,}$/.test(line)) {
        flushParagraph();
        return;
      }
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) {
        flushParagraph();
        blocks.push({ type: "heading", text: stripInlineMarkdown(heading[1]) });
        return;
      }
      const quote = line.match(/^>\s*(.+)$/);
      if (quote) {
        flushParagraph();
        blocks.push({ type: "quote", text: stripInlineMarkdown(quote[1]) });
        return;
      }
      const bullet = line.match(/^[-+*]\s+(.+)$/);
      if (bullet) {
        flushParagraph();
        blocks.push({ type: "bullet", text: "• " + stripInlineMarkdown(bullet[1]) });
        return;
      }
      const numbered = line.match(/^(\d+)[.)、]\s*(.+)$/);
      if (numbered) {
        flushParagraph();
        blocks.push({
          type: "heading",
          text: numbered[1] + ". " + stripInlineMarkdown(numbered[2]),
        });
        return;
      }
      if (inFence) {
        flushParagraph();
        blocks.push({ type: "code", text: stripInlineMarkdown(line) });
        return;
      }
      paragraph.push(line);
    });
    flushParagraph();
    return blocks.length ? blocks : [{ type: "paragraph", text: "完整解答请扫码查看。" }];
  }

  function cutAtSentence(value, limit) {
    const chars = Array.from(String(value || ""));
    if (chars.length <= limit) return chars.join("");
    const minimum = Math.min(24, Math.floor(limit * 0.35));
    for (let index = limit - 1; index >= minimum; index -= 1) {
      if (/[。！？；.!?]/u.test(chars[index])) {
        return chars.slice(0, index + 1).join("").trim();
      }
    }
    return limit >= 36 ? chars.slice(0, limit).join("").trim() + "…" : "";
  }

  function shareAnswerBlocks(markdown) {
    const blocks = answerBlocks(markdown);
    const totalChars = blocks.reduce((sum, block) => sum + Array.from(block.text).length, 0);
    const target = Math.min(ANSWER_MAX_CHARS, Math.max(1, Math.ceil(totalChars / 2)));
    const selected = [];
    let remaining = target;

    for (const block of blocks) {
      if (remaining <= 0) break;
      const length = Array.from(block.text).length;
      if (length <= remaining) {
        selected.push(block);
        remaining -= length;
        continue;
      }
      const text = cutAtSentence(block.text, remaining);
      if (text) selected.push({ type: block.type, text: text });
      remaining = 0;
    }
    if (selected.length) return selected;
    const fallback = blocks[0];
    const chars = Array.from(fallback.text);
    return [{
      type: fallback.type,
      text: chars.slice(0, target).join("") + (chars.length > target ? "…" : ""),
    }];
  }

  function textTokens(value) {
    return String(value || "").match(/[A-Za-z0-9][A-Za-z0-9_./:@%+?=&-]*|\s+|./gu) || [];
  }

  function wrapText(ctx, value, maxWidth) {
    const lines = [];
    let current = "";
    textTokens(value).forEach(token => {
      const next = current + token;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current.trimEnd());
        current = token.trimStart();
      } else {
        current = next;
      }
    });
    if (current.trim()) lines.push(current.trimEnd());
    return lines.length ? lines : [""];
  }

  function ellipsize(ctx, value, maxWidth) {
    let chars = Array.from(String(value || "").replace(/[，。；、,.!?！？\s]*$/u, ""));
    while (chars.length && ctx.measureText(chars.join("") + "…").width > maxWidth) chars.pop();
    return chars.join("") + "…";
  }

  function clampWrappedLines(ctx, value, maxWidth, maxLines) {
    const lines = wrapText(ctx, value, maxWidth);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(ctx, kept[maxLines - 1], maxWidth);
    return kept;
  }

  function blockStyle(type) {
    if (type === "heading") {
      return { size: 42, weight: 700, lineHeight: 64, gap: 22, color: COLORS.text, indent: 0 };
    }
    if (type === "quote") {
      return { size: 38, weight: 500, lineHeight: 62, gap: 22, color: COLORS.body, indent: 30 };
    }
    if (type === "bullet") {
      return { size: 38, weight: 450, lineHeight: 62, gap: 12, color: COLORS.body, indent: 6 };
    }
    if (type === "code") {
      return { size: 33, weight: 450, lineHeight: 54, gap: 16, color: COLORS.muted, indent: 0 };
    }
    return { size: 39, weight: 400, lineHeight: 66, gap: 26, color: COLORS.body, indent: 0 };
  }

  function layoutAnswer(ctx, markdown) {
    const laidOut = [];
    let used = 0;
    let clippedByHeight = false;

    for (const block of shareAnswerBlocks(markdown)) {
      const style = blockStyle(block.type);
      setFont(ctx, style.size, style.weight);
      const lines = wrapText(ctx, block.text, CONTENT_WIDTH - style.indent);
      const available = ANSWER_MAX_HEIGHT - used - style.gap;
      const capacity = Math.max(0, Math.floor(available / style.lineHeight));
      if (!capacity) {
        clippedByHeight = true;
        break;
      }
      const visible = lines.slice(0, capacity);
      if (visible.length < lines.length) {
        visible[visible.length - 1] = ellipsize(ctx, visible[visible.length - 1], CONTENT_WIDTH - style.indent);
        clippedByHeight = true;
      }
      const height = visible.length * style.lineHeight + style.gap;
      laidOut.push(Object.assign({}, block, style, { lines: visible, height: height }));
      used += height;
      if (clippedByHeight) break;
    }
    return { blocks: laidOut, height: used + 62 };
  }

  function drawTextLines(ctx, lines, x, y, lineHeight) {
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawSeal(ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = COLORS.accent;
    roundedRect(ctx, x, y, size, size, Math.round(size * 0.22));
    ctx.fill();
    ctx.fillStyle = COLORS.white;
    ctx.textAlign = "center";
    setFont(ctx, Math.round(size * 0.6), 700);
    ctx.fillText("玄", x + size / 2, y + size * 0.16);
    ctx.textAlign = "left";
    ctx.restore();
  }

  function drawGuaLine(ctx, x, y, width, yin, moving) {
    const thickness = 10;
    const gap = 24;
    ctx.fillStyle = moving ? COLORS.accent : COLORS.text;
    if (yin) {
      const segment = (width - gap) / 2;
      roundedRect(ctx, x, y, segment, thickness, thickness / 2);
      ctx.fill();
      roundedRect(ctx, x + segment + gap, y, segment, thickness, thickness / 2);
      ctx.fill();
    } else {
      roundedRect(ctx, x, y, width, thickness, thickness / 2);
      ctx.fill();
    }
  }

  function drawGuaFigure(ctx, x, y, label, name, lines, changed) {
    ctx.fillStyle = COLORS.muted;
    setFont(ctx, 26, 450);
    ctx.fillText(label, x, y);
    ctx.fillStyle = COLORS.text;
    setFont(ctx, 34, 650);
    ctx.fillText(name || (changed ? "变卦" : "本卦"), x, y + 41);
    const top = y + 96;
    (Array.isArray(lines) ? lines.slice(0, 6) : []).forEach((line, index) => {
      drawGuaLine(
        ctx,
        x,
        top + index * 29,
        170,
        changed ? !!line.changed_yin : !!line.yin,
        !changed && !!line.moving
      );
    });
  }

  function oracleHeight(oracle) {
    return Array.isArray(oracle && oracle.lines) && oracle.lines.length ? 382 : 210;
  }

  function drawOracle(ctx, oracle, y) {
    const data = oracle || {};
    ctx.fillStyle = COLORS.muted;
    setFont(ctx, 28, 600);
    ctx.fillText("卦象", CONTENT_LEFT, y);
    y += 56;

    ctx.fillStyle = COLORS.text;
    setFont(ctx, 40, 650);
    const name = data.has_changed
      ? (data.ben_name || "本卦") + "  →  " + (data.bian_name || "变卦")
      : (data.ben_name || "本卦");
    ctx.fillText(name, CONTENT_LEFT, y);

    ctx.fillStyle = COLORS.muted;
    setFont(ctx, 28, 450);
    const facts = [
      data.moving_label,
      data.month_jian ? "月建 " + data.month_jian : "",
      data.day_chen ? "日辰 " + data.day_chen : "",
    ].filter(Boolean).join(" · ");
    if (facts) ctx.fillText(facts, CONTENT_LEFT, y + 62);

    if (!Array.isArray(data.lines) || !data.lines.length) return;
    const figureTop = y + 116;
    drawGuaFigure(ctx, CONTENT_LEFT + 62, figureTop, "本卦", data.ben_name, data.lines, false);
    if (data.has_changed) {
      ctx.fillStyle = COLORS.muted;
      setFont(ctx, 48, 350);
      ctx.fillText("→", CONTENT_LEFT + 409, figureTop + 126);
      drawGuaFigure(ctx, CONTENT_LEFT + 548, figureTop, "变卦", data.bian_name, data.lines, true);
    } else {
      ctx.fillStyle = COLORS.muted;
      setFont(ctx, 30, 450);
      ctx.fillText("六爻安静", CONTENT_LEFT + 408, figureTop + 130);
    }
  }

  async function loadQrModule() {
    if (!qrModulePromise) qrModulePromise = import("/vendor/qrcode-generator-2.0.4.mjs");
    return qrModulePromise;
  }

  async function drawQr(ctx, value, x, y, size) {
    const module = await loadQrModule();
    const qr = module.qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const modules = qr.getModuleCount();
    const quiet = 4;
    const cell = Math.max(1, Math.floor(size / (modules + quiet * 2)));
    const actual = cell * (modules + quiet * 2);
    const left = x + Math.floor((size - actual) / 2);
    const top = y + Math.floor((size - actual) / 2);

    ctx.fillStyle = COLORS.white;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = COLORS.text;
    for (let row = 0; row < modules; row += 1) {
      for (let column = 0; column < modules; column += 1) {
        if (qr.isDark(row, column)) {
          ctx.fillRect(
            left + (column + quiet) * cell,
            top + (row + quiet) * cell,
            cell,
            cell
          );
        }
      }
    }
  }

  async function drawFooter(ctx, slug, height, shareUrl) {
    const y = height - FOOTER_HEIGHT;
    ctx.fillStyle = COLORS.footer;
    ctx.fillRect(0, y, CARD_WIDTH, FOOTER_HEIGHT);
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(0, y, CARD_WIDTH, 1);

    await drawQr(ctx, shareUrl || canonicalFor(slug), CONTENT_LEFT, y + 35, 166);
    ctx.fillStyle = COLORS.text;
    setFont(ctx, 31, 550);
    ctx.fillText("长按识别二维码", CONTENT_LEFT + 202, y + 56);
    ctx.fillStyle = COLORS.body;
    setFont(ctx, 29, 400);
    ctx.fillText("查看剩余解答", CONTENT_LEFT + 202, y + 105);

    drawSeal(ctx, 788, y + 66, 46);
    ctx.fillStyle = COLORS.text;
    setFont(ctx, 48, 700);
    ctx.fillText("玄枢", 852, y + 62);

    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "center";
    setFont(ctx, 23, 400);
    ctx.fillText("AI 解读与传统术数内容仅供研究和娱乐参考", CARD_WIDTH / 2, y + 218);
    ctx.textAlign = "left";
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("图片导出失败，请稍后再试"));
      }, "image/png");
    });
  }

  async function render(post, options) {
    const settings = options || {};
    const slug = String(settings.slug || (post && post.slug) || "").trim();
    if (!slug) throw new Error("缺少卦帖标识");
    const shareUrl = String(settings.shareUrl || canonicalFor(slug));
    if (document.fonts && document.fonts.ready) await document.fonts.ready.catch(() => {});

    const measureCanvas = document.createElement("canvas");
    measureCanvas.width = CARD_WIDTH;
    const measure = measureCanvas.getContext("2d");
    if (!measure) throw new Error("当前浏览器不支持生成图片");

    const question = safeTitle((post && (post.question || post.title)) || "");
    setFont(measure, 58, 720);
    const questionLines = clampWrappedLines(measure, question, CONTENT_WIDTH, 5);
    const questionHeight = questionLines.length * 82;
    const answerLayout = layoutAnswer(measure, (post && post.answer) || "");
    const guaHeight = oracleHeight(post && post.oracle);
    const contentHeight = 86 + questionHeight + 76 + 92 + 50 +
      answerLayout.height + 86 + guaHeight + 60;
    const height = Math.max(
      MIN_CARD_HEIGHT,
      Math.min(MAX_CARD_HEIGHT, Math.ceil(contentHeight + FOOTER_HEIGHT))
    );

    const canvas = document.createElement("canvas");
    canvas.width = CARD_WIDTH;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持生成图片");
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, CARD_WIDTH, height);

    let y = 86;
    ctx.fillStyle = COLORS.text;
    setFont(ctx, 58, 720);
    y = drawTextLines(ctx, questionLines, CONTENT_LEFT, y, 82);

    y += 26;
    drawSeal(ctx, CONTENT_LEFT, y, 42);
    ctx.fillStyle = COLORS.muted;
    setFont(ctx, 27, 450);
    ctx.fillText("玄枢 · 六爻卦帖 · AI 生成解读", CONTENT_LEFT + 62, y + 7);

    y += 104;
    ctx.fillStyle = COLORS.accent;
    setFont(ctx, 29, 650);
    ctx.fillText("解答节选", CONTENT_LEFT, y);
    y += 58;

    answerLayout.blocks.forEach(block => {
      ctx.fillStyle = block.color;
      setFont(ctx, block.size, block.weight);
      if (block.type === "quote") {
        ctx.fillStyle = COLORS.line;
        ctx.fillRect(CONTENT_LEFT, y + 3, 4, Math.max(40, block.lines.length * block.lineHeight - 12));
        ctx.fillStyle = block.color;
      }
      drawTextLines(ctx, block.lines, CONTENT_LEFT + block.indent, y, block.lineHeight);
      y += block.height;
    });

    ctx.fillStyle = COLORS.accent;
    setFont(ctx, 28, 550);
    ctx.fillText("剩余解答请扫码查看 ↓", CONTENT_LEFT, y + 2);
    y += 62;

    y += 30;
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(CONTENT_LEFT, y, CONTENT_WIDTH, 1);
    y += 62;
    drawOracle(ctx, (post && post.oracle) || {}, y);

    await drawFooter(ctx, slug, height, shareUrl);
    const blob = await canvasBlob(canvas);
    return {
      blob: blob,
      canvas: canvas,
      width: CARD_WIDTH,
      height: height,
      title: question,
      slug: slug,
      url: shareUrl,
      filename: filenameFor(slug),
    };
  }

  function closeDialogNow() {
    if (dialog?.open) dialog.close();
  }

  function closeDialog() {
    if (window.XuanOverlayHistory) return window.XuanOverlayHistory.requestClose(SHARE_OVERLAY_ID);
    closeDialogNow();
    return Promise.resolve(true);
  }

  function ensureDialog() {
    if (dialog && dialog.isConnected) return dialog;
    const template = document.createElement("template");
    template.innerHTML = [
      '<dialog class="share-card-dialog" data-share-card-dialog aria-labelledby="share-card-title">',
      '  <button type="button" class="share-card-close" data-share-card-close aria-label="关闭分享图预览">×</button>',
      '  <header class="share-card-head">',
      '    <span>分享长图</span>',
      '    <h2 id="share-card-title">生成分享图</h2>',
      '    <p data-share-card-instruction>分享或长按保存。</p>',
      "  </header>",
      '  <div class="share-card-stage">',
      '    <div class="share-card-loading" data-share-card-loading><i aria-hidden="true"></i><b>生成中…</b></div>',
      '    <div class="share-card-error" data-share-card-error hidden><b>生成失败</b><p data-share-card-error-message>请重试。</p></div>',
      '    <img data-share-card-image hidden alt="玄枢六爻卦帖分享长图">',
      "  </div>",
      '  <footer class="share-card-actions">',
      '    <span data-share-card-hint>图片包含公开问题、部分 AI 解答与卦象。</span>',
      "    <div>",
      '      <button type="button" class="secondary-action" data-share-card-copy disabled>复制标题+链接</button>',
      '      <a class="secondary-action" data-share-card-save aria-disabled="true">下载原图</a>',
      '      <button type="button" class="primary-action button-reset" data-share-card-native disabled>分享图片</button>',
      "    </div>",
      "  </footer>",
      "</dialog>",
    ].join("");

    dialog = template.content.firstElementChild;
    document.body.append(dialog);

    dialog.querySelector("[data-share-card-close]").addEventListener("click", closeDialog);
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom;
      if (outside) closeDialog();
    });
    dialog.addEventListener("cancel", event => {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("close", () => {
      document.body.classList.remove("share-card-open");
    });
    dialog.querySelector("[data-share-card-copy]").addEventListener("click", copyActiveLink);
    dialog.querySelector("[data-share-card-save]").addEventListener("click", () => {
      if (activeShare) void track(activeShare.slug, "image_save", activeShare.sourceRef);
    });
    dialog.querySelector("[data-share-card-native]").addEventListener("click", shareActiveImage);
    dialog.querySelector("[data-share-card-image]").addEventListener("contextmenu", () => {
      if (activeShare) void track(activeShare.slug, "image_longpress", activeShare.sourceRef);
    });
    window.XuanOverlayHistory?.register(SHARE_OVERLAY_ID, {
      isOpen: () => !!dialog?.open,
      open: openNow,
      close: closeDialogNow,
    });
    return dialog;
  }

  function setDialogState(state, message) {
    const host = ensureDialog();
    const loading = host.querySelector("[data-share-card-loading]");
    const error = host.querySelector("[data-share-card-error]");
    const image = host.querySelector("[data-share-card-image]");
    loading.hidden = state !== "loading";
    error.hidden = state !== "error";
    image.hidden = state !== "ready";
    if (message) host.querySelector("[data-share-card-error-message]").textContent = message;
  }

  async function loadPost(slug) {
    if (postCache.has(slug)) return postCache.get(slug);
    const request = fetch("/api/community/liuyao/posts/" + encodeURIComponent(slug), {
      headers: { Accept: "application/json" },
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || "卦帖加载失败，请稍后再试");
      return data;
    }).catch(error => {
      postCache.delete(slug);
      throw error;
    });
    postCache.set(slug, request);
    return request;
  }

  async function track(slug, channel, ref) {
    try {
      await fetch("/api/community/share-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, channel: channel, ref: ref || "" }),
        keepalive: true,
      });
    } catch (_) {}
  }

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = text;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      return copied;
    }
  }

  async function copyActiveLink() {
    if (!activeShare) return;
    const copied = await writeClipboard(activeShare.title + "\n" + activeShare.url);
    const hint = dialog.querySelector("[data-share-card-hint]");
    hint.textContent = copied ? "标题和链接已复制。" : "复制失败，请打开卦帖后手动复制。";
    if (copied) await track(activeShare.slug, "copy", activeShare.sourceRef);
  }

  function showLongPressGuide(message) {
    const image = dialog.querySelector("[data-share-card-image]");
    const stage = dialog.querySelector(".share-card-stage");
    const hint = dialog.querySelector("[data-share-card-hint]");
    hint.textContent = message || "请长按上方图片，选择“保存图片”或“发送给朋友”。";
    stage.scrollTo({ top: 0, behavior: "smooth" });
    image.classList.remove("share-card-image-guided");
    requestAnimationFrame(() => image.classList.add("share-card-image-guided"));
    window.setTimeout(() => image.classList.remove("share-card-image-guided"), 1100);
  }

  function configureShareActions() {
    if (!activeShare) return;
    const touchFirst = isTouchFirstDevice();
    const wechat = isWechatBrowser();
    const canNativeShare = activeShare.canNativeShare && !wechat;
    const copy = dialog.querySelector("[data-share-card-copy]");
    const save = dialog.querySelector("[data-share-card-save]");
    const native = dialog.querySelector("[data-share-card-native]");
    const hint = dialog.querySelector("[data-share-card-hint]");
    const instruction = dialog.querySelector("[data-share-card-instruction]");

    dialog.dataset.touchFirst = touchFirst ? "true" : "false";
    dialog.dataset.shareMode = wechat ? "wechat" : "default";
    copy.style.removeProperty("grid-column");
    save.hidden = touchFirst;
    native.hidden = !canNativeShare && !touchFirst;
    native.disabled = false;

    if (wechat) {
      save.hidden = true;
      native.hidden = true;
      native.disabled = true;
      copy.style.gridColumn = "1 / -1";
      instruction.textContent = "微信内请用默认浏览器打开。";
      hint.textContent = "打开后分享或下载原图。";
      return;
    }
    if (canNativeShare) {
      native.textContent = "分享图片";
      native.dataset.mode = "native";
      instruction.textContent = "发送或保存。";
      hint.textContent = touchFirst
        ? "手机不会自动下载。使用系统分享。"
        : "使用系统分享，或下载原图。";
      return;
    }
    if (touchFirst) {
      native.textContent = "长按上图保存";
      native.dataset.mode = "longpress";
      instruction.textContent = "长按图片保存。";
      hint.textContent = "长按后选择保存或分享。";
      return;
    }
    native.dataset.mode = "unavailable";
    instruction.textContent = "电脑端可下载原图，再发送到需要的平台。";
    hint.textContent = "图片包含公开问题、部分 AI 解答与卦象。";
  }

  async function shareActiveImage() {
    if (!activeShare) return;
    if (!activeShare.canNativeShare) {
      showLongPressGuide();
      return;
    }
    const file = activeShare.file;
    const payload = {
      files: [file],
      title: activeShare.title,
    };
    const hint = dialog.querySelector("[data-share-card-hint]");
    try {
      await navigator.share(payload);
      await track(activeShare.slug, "image_native", activeShare.sourceRef);
      hint.textContent = "已打开系统分享；可发送给好友或选择系统存图功能。";
    } catch (error) {
      if (error && error.name === "AbortError") return;
      activeShare.canNativeShare = false;
      configureShareActions();
      if (isTouchFirstDevice()) {
        showLongPressGuide("系统分享没有打开，请长按上方图片保存或发送。");
      } else {
        hint.textContent = "系统分享没有打开，请使用“下载原图”。";
      }
    }
  }

  async function openNow(options) {
    const settings = options || {};
    const slug = String(settings.slug || (settings.post && settings.post.slug) || "").trim();
    if (!slug) return;

    const host = ensureDialog();
    const requestId = ++activeRequest;
    activeShare = null;
    setDialogState("loading");
    const copy = host.querySelector("[data-share-card-copy]");
    const save = host.querySelector("[data-share-card-save]");
    const native = host.querySelector("[data-share-card-native]");
    const touchFirst = isTouchFirstDevice();
    const wechat = isWechatBrowser();
    host.dataset.touchFirst = touchFirst ? "true" : "false";
    host.dataset.shareMode = wechat ? "wechat" : "default";
    copy.disabled = true;
    copy.style.removeProperty("grid-column");
    native.disabled = true;
    native.hidden = wechat;
    native.textContent = "分享图片";
    native.dataset.mode = "native";
    save.hidden = touchFirst;
    save.removeAttribute("href");
    save.setAttribute("aria-disabled", "true");
    host.querySelector(".share-card-stage").scrollTop = 0;
    host.querySelector("[data-share-card-instruction]").textContent = wechat
      ? "微信内请用默认浏览器打开。"
      : "分享或长按保存。";
    host.querySelector("[data-share-card-hint]").textContent = wechat
      ? "点右上角“…”并选择“在默认浏览器中打开”。"
      : touchFirst
        ? "不支持分享时长按图片。"
        : "图片包含公开问题、部分 AI 解答与卦象。";

    if (!host.open) host.showModal();
    document.body.classList.add("share-card-open");
    requestAnimationFrame(() => host.querySelector("[data-share-card-close]").focus());

    try {
      const target = settings.shareUrl
        ? { url: String(settings.shareUrl), attributed: !!settings.attributed }
        : (await window.XuanxueAccount?.shareTarget(slug)) || { url: canonicalFor(slug), attributed: false };
      const supplied = settings.post;
      const post = supplied && supplied.answer && supplied.oracle ? supplied : await loadPost(slug);
      const result = await render(post, { slug: slug, shareUrl: target.url });
      if (requestId !== activeRequest || !host.open) return;

      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(result.blob);
      let file = null;
      if (typeof File === "function") {
        try {
          file = new File([result.blob], result.filename, { type: "image/png" });
        } catch (_) {}
      }
      activeShare = Object.assign({}, result, {
        file: file,
        canNativeShare: canShareImageFile(file),
        sourceRef: String(settings.ref || new URLSearchParams(location.search).get("ref") || ""),
        attributed: !!target.attributed,
      });

      const image = host.querySelector("[data-share-card-image]");
      image.src = objectUrl;
      image.alt = result.title + "的分享长图";
      save.href = objectUrl;
      save.download = result.filename;
      save.removeAttribute("aria-disabled");
      copy.disabled = false;
      setDialogState("ready");
      configureShareActions();
      host.querySelector(".share-card-stage").scrollTop = 0;
      if (activeShare.attributed) {
        host.querySelector("[data-share-card-hint]").textContent = "图片二维码与复制链接已记录你的邀请归因。";
      }
      await track(slug, "image_preview", activeShare.sourceRef);
    } catch (error) {
      if (requestId !== activeRequest || !host.open) return;
      activeShare = {
        title: safeTitle(settings.title),
        url: String(settings.shareUrl || canonicalFor(slug)),
        slug: slug,
        sourceRef: String(settings.ref || ""),
      };
      copy.disabled = false;
      setDialogState("error", (error && error.message) || "请稍后再试。");
    }
  }

  async function open(options) {
    const settings = options || {};
    const slug = String(settings.slug || (settings.post && settings.post.slug) || "").trim();
    if (!slug) return undefined;
    ensureDialog();
    if (window.XuanOverlayHistory) {
      const payload = {
        slug,
        title: String(settings.title || ""),
        ref: String(settings.ref || ""),
        shareUrl: String(settings.shareUrl || ""),
        attributed: !!settings.attributed,
      };
      return window.XuanOverlayHistory.open(SHARE_OVERLAY_ID, payload, settings);
    }
    return openNow(settings);
  }

  window.XuanxueShareCard = Object.freeze({ open: open, render: render });
})();

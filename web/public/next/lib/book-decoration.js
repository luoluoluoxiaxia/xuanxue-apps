// Readium renders marks; the account API and canonical source anchors remain
// independent. The vendor file is a pinned, self-contained browser ES module.
import { DirectCommsChannel, Decorator, DecorationController, DecorationStyleType,
  Locator, LocatorLocations, LocatorText } from "../../vendor/readium-decorator-1.2.5.js?v=n15";

const TINTS = Object.freeze({ yellow: "#FFD54F", green: "#81C784", blue: "#90CAF9", pink: "#F48FB1" });
let instanceSequence = 0;

export function createBookDecorator(content, { onActivate } = {}) {
  const instance = ++instanceSequence;
  const group = `xz-book-marks-${instance}`;
  const focusGroup = `xz-book-focus-${instance}`;
  const nodes = new Map();
  let nodeSequence = 0, backend = null, disposed = false, failed = false;
  let marks = [], focused = null;

  function selector(element) {
    if (!nodes.has(element)) {
      const value = `${instance}-${++nodeSequence}`;
      element.setAttribute("data-book-decoration-node", value); nodes.set(element, value);
    }
    return `[data-book-decoration-node="${nodes.get(element)}"]`;
  }
  function point(node, offset) {
    if (node?.nodeType !== 3 || !node.parentElement || !content.contains(node) ||
        !Number.isInteger(offset) || offset < 0 || offset > node.length) return null;
    const parent = node.parentElement;
    const textNodes = [...parent.childNodes].filter(child => child.nodeType === 3);
    return { cssSelector: selector(parent), textNodeIndex: textNodes.indexOf(node), charOffset: offset };
  }
  function decoration({ item, range }, focus = false) {
    if (!item || !range || range.collapsed || range.toString() !== item.quote) return null;
    const start = point(range.startContainer, range.startOffset);
    const end = point(range.endContainer, range.endOffset);
    if (!start || !end) return null;
    const element = range.startContainer.parentElement.closest("p, h3, pre");
    if (!element || !content.contains(element) || !element.contains(range.endContainer)) return null;
    // DOM Range offsets are UTF-16; the caller has already validated the API's
    // Unicode code-point offsets and text version before producing this range.
    const locator = new Locator({
      href: `book-mark/${encodeURIComponent(item.id)}`,
      type: "text/html",
      locations: new LocatorLocations({ otherLocations: new Map([
        ["cssSelector", selector(element)], ["domRange", { start, end }],
      ]) }),
      text: new LocatorText({ highlight: item.quote }),
    });
    return { id: String(item.id), locator,
      style: { type: focus ? DecorationStyleType.HighlightUnderline : DecorationStyleType.Highlight,
        tint: TINTS[item.color] || TINTS.yellow }, extras: { annotationId: String(item.id) } };
  }
  function unmount() {
    if (!backend) return;
    // Unmount clears this renderer's CSS highlights/overlays synchronously.
    // Queued messages cannot redraw private marks after an account transition.
    backend.decorator.unmount(window, backend.channel.frame);
    backend.controller?.destroy(); backend.channel.frame.destroy(); backend = null;
  }
  function mount() {
    if (disposed || failed) return null;
    if (backend) return backend;
    try {
      const channel = new DirectCommsChannel(), decorator = new Decorator();
      if (!decorator.mount(window, channel.frame)) { channel.frame.destroy(); failed = true; return null; }
      backend = { channel, decorator, controller: null };
      const controller = new DecorationController(channel.host);
      backend.controller = controller;
      controller.addDecorationResizeTarget(".book-reading-content");
      controller.registerDecorationObserver(group, {
        onDecorationActivated(event) {
          if (disposed || !backend || !window.getSelection()?.isCollapsed) return false;
          const mark = marks.find(entry => String(entry.item.id) === event.decoration.extras?.annotationId);
          if (!mark || !content.contains(mark.range.startContainer)) return false;
          onActivate?.(mark.item, event); return true;
        },
      });
      return backend;
    } catch {
      unmount(); failed = true; return null;
    }
  }
  function render() {
    const renderer = mount();
    if (!renderer) return false;
    renderer.controller.applyDecorations(marks.map(mark => decoration(mark)).filter(Boolean), group);
    renderer.controller.applyDecorations(focused ? [decoration(focused, true)].filter(Boolean) : [], focusGroup);
    return true;
  }
  function clear() {
    marks = []; focused = null; unmount();
    for (const [element, value] of nodes) {
      if (element.getAttribute("data-book-decoration-node") === value) element.removeAttribute("data-book-decoration-node");
    }
    nodes.clear();
  }
  function destroy() { clear(); disposed = true; }
  return {
    get available() { return !disposed && !failed && typeof window.ResizeObserver === "function"; },
    paint(entries = []) { marks = entries.slice(); return render(); },
    focus(entry) {
      focused = entry || null; render();
      return entry?.range && entry.range.toString() === entry.item?.quote
        ? entry.range.getBoundingClientRect() : null;
    },
    clearFocus() { focused = null; if (backend) backend.controller.applyDecorations([], focusGroup); },
    // Re-mount after mode/font/layout changes, including CSS-only changes which
    // do not resize the document. Existing canonical Range objects stay valid.
    refresh() { if (disposed || failed) return false; unmount(); return marks.length || focused ? render() : true; },
    clear, destroy,
  };
}

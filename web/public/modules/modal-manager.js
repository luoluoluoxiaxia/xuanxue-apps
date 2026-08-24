(function (global) {
  "use strict";

  function create({ select, selectAll, isDesktopLayout, closeHandlerFor }) {
    const $ = select;
    const $$ = selectAll;

    const MODAL_FOCUSABLE_SELECTOR = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled]):not([type=hidden])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");
    const modalOpeners = new WeakMap();
    let modalStack = [];
    let modalScrollPosition = null;
    let modalRestoreFrame = null;
    let pendingModalRestore = null;
    const APP_MODAL_OVERLAY_PREFIX = "app-modal:";

    function openModalMasks() {
      return $$(".modal-mask").filter(mask => !mask.hidden);
    }

    function availableModalFocusTarget(element) {
      return element instanceof HTMLElement && element.isConnected && !element.closest("[hidden]") && !element.hasAttribute("disabled");
    }

    function modalFocusableElements(mask) {
      if (!mask) return [];
      return $$(MODAL_FOCUSABLE_SELECTOR, mask).filter(element => (
        availableModalFocusTarget(element) && window.getComputedStyle(element).visibility !== "hidden"
      ));
    }

    function focusModalMask(mask, preferred = null) {
      if (!mask || mask.hidden) return;
      const requested = typeof preferred === "string" ? $(preferred, mask) : preferred;
      let target = availableModalFocusTarget(requested) ? requested : modalFocusableElements(mask)[0];
      if (!target) {
        target = $("[role=dialog]", mask);
        if (target && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      }
      if (!availableModalFocusTarget(target)) return;
      window.requestAnimationFrame(() => {
        if (!mask.hidden && target.isConnected) target.focus({ preventScroll: true });
      });
    }

    function topModalMask() {
      modalStack = modalStack.filter(mask => mask.isConnected && !mask.hidden);
      if (modalStack.length) return modalStack[modalStack.length - 1];
      const open = openModalMasks();
      return open.length ? open[open.length - 1] : null;
    }

    function syncModalLayers() {
      $$(".modal-mask").forEach(mask => mask.style.removeProperty("z-index"));
      if (modalStack.length < 2) return;
      modalStack.forEach((mask, index) => { mask.style.zIndex = String(84 + index); });
    }

    function syncModalState() {
      const hasOpenModal = openModalMasks().length > 0;
      const root = document.documentElement;
      const body = document.body;
      if (hasOpenModal && !modalScrollPosition) {
        modalScrollPosition = { left: window.scrollX, top: window.scrollY };
        root.style.setProperty("--modal-scroll-y", `${modalScrollPosition.top}px`);
        root.classList.add("modal-open");
        body.classList.add("modal-open");
        return;
      }
      if (!hasOpenModal && modalScrollPosition) {
        const restore = modalScrollPosition;
        modalScrollPosition = null;
        root.classList.remove("modal-open");
        body.classList.remove("modal-open");
        root.style.removeProperty("--modal-scroll-y");
        window.scrollTo(restore.left, restore.top);
      }
    }

    function showModalMaskNow(mask, focusTarget = null) {
      if (!mask) return;
      if (modalRestoreFrame !== null) {
        window.cancelAnimationFrame(modalRestoreFrame);
        modalRestoreFrame = null;
      }
      if (mask.hidden) {
        const active = document.activeElement;
        const opener = availableModalFocusTarget(active) ? active : pendingModalRestore;
        modalOpeners.set(mask, availableModalFocusTarget(opener) ? opener : null);
        modalStack = modalStack.filter(item => item !== mask);
        modalStack.push(mask);
      }
      pendingModalRestore = null;
      mask.hidden = false;
      syncModalLayers();
      syncModalState();
      focusModalMask(mask, focusTarget);
    }

    function hideModalMaskNow(mask) {
      if (!mask || mask.hidden) return;
      const opener = modalOpeners.get(mask);
      mask.hidden = true;
      modalOpeners.delete(mask);
      modalStack = modalStack.filter(item => item !== mask);
      syncModalLayers();
      syncModalState();
      pendingModalRestore = availableModalFocusTarget(opener) ? opener : null;
      if (modalRestoreFrame !== null) window.cancelAnimationFrame(modalRestoreFrame);
      modalRestoreFrame = window.requestAnimationFrame(() => {
        modalRestoreFrame = null;
        const remaining = topModalMask();
        const restore = pendingModalRestore;
        pendingModalRestore = null;
        if (availableModalFocusTarget(restore) && (!remaining || remaining.contains(restore))) {
          restore.focus({ preventScroll: true });
        } else if (remaining) {
          focusModalMask(remaining);
        }
      });
    }

    function modalOverlayId(mask) {
      return mask?.id ? `${APP_MODAL_OVERLAY_PREFIX}${mask.id}` : "";
    }

    function registerModalOverlay(mask) {
      const overlay = window.XuanOverlayHistory;
      const id = modalOverlayId(mask);
      if (!overlay || !id || mask.dataset.overlayHistoryRegistered === "true") return id;
      mask.dataset.overlayHistoryRegistered = "true";
      overlay.register(id, {
        isOpen: () => !mask.hidden,
        open: options => showModalMaskNow(mask, options?.focusTarget || null),
        close: () => hideModalMaskNow(mask),
      });
      return id;
    }

    function showModalMask(mask, focusTarget = null) {
      if (!mask) return undefined;
      const overlay = window.XuanOverlayHistory;
      const id = registerModalOverlay(mask);
      if (overlay && id) return overlay.open(id, {}, { focusTarget });
      return showModalMaskNow(mask, focusTarget);
    }

    function hideModalMask(mask, afterClose = null) {
      if (!mask) return Promise.resolve(false);
      const overlay = window.XuanOverlayHistory;
      const id = registerModalOverlay(mask);
      if (overlay && id) return overlay.requestClose(id, afterClose);
      hideModalMaskNow(mask);
      return Promise.resolve(typeof afterClose === "function" ? afterClose() : true);
    }

    function trapModalFocus(event) {
      if (event.key !== "Tab") return false;
      const mask = topModalMask();
      if (!mask) return false;
      const focusable = modalFocusableElements(mask);
      if (!focusable.length) {
        event.preventDefault();
        focusModalMask(mask);
        return true;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !mask.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !mask.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
      return true;
    }

    function trapChartDrawerFocus(event) {
      if (event.key !== "Tab" || isDesktopLayout() || !document.body.classList.contains("chart-open")) return false;
      const drawer = $("#chart-rail");
      const focusable = modalFocusableElements(drawer);
      if (!focusable.length) {
        event.preventDefault();
        $("#chart-rail-close")?.focus({ preventScroll: true });
        return true;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
      return true;
    }

    function closeTopModal() {
      const mask = topModalMask();
      if (!mask) return false;
      const close = closeHandlerFor(mask.id);
      (close || (() => hideModalMask(mask)))();
      return true;
    }

    return Object.freeze({
      availableModalFocusTarget,
      closeTopModal,
      hideModalMask,
      showModalMask,
      trapChartDrawerFocus,
      trapModalFocus,
    });
  }

  global.XuanxueModalManager = Object.freeze({ create });
})(window);

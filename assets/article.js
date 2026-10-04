(() => {
  "use strict";

  const selector = document.querySelector(".reading-level");
  const tabs = selector ? Array.from(selector.querySelectorAll("[data-article-level]")) : [];
  const panels = tabs.map(tab => document.getElementById(`article-${tab.dataset.articleLevel}`));
  const mathRoot = document.querySelector("[data-math-root]") || document.querySelector("main");

  function updateEquationScrolling() {
    if (!mathRoot) return;
    mathRoot.querySelectorAll(".katex-display").forEach(equation => {
      if (equation.closest("[hidden]")) return;
      const overflows = equation.scrollWidth > equation.clientWidth + 1;
      if (overflows) {
        equation.setAttribute("tabindex", "0");
        equation.setAttribute("role", "region");
        equation.setAttribute("aria-label", "Scrollable equation");
      } else {
        equation.removeAttribute("tabindex");
        equation.removeAttribute("role");
        equation.removeAttribute("aria-label");
      }
    });
  }

  function selectLevel(level, { focus = false, updateUrl = false } = {}) {
    const selected = tabs.find(tab => tab.dataset.articleLevel === level);
    if (!selected) return;

    tabs.forEach((tab, index) => {
      const active = tab === selected;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      panels[index].hidden = !active;
    });
    selector.dataset.activeLevel = level;
    if (focus) selected.focus();
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.hash = level;
      window.history.replaceState(null, "", url);
    }
    window.requestAnimationFrame(updateEquationScrolling);
  }

  function levelFromHash() {
    let hash;
    try {
      hash = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return null;
    }
    if (hash === "basic" || hash === "advanced") return hash;
    const target = document.getElementById(hash);
    const panel = target && target.closest(".article-panel");
    return panel ? panel.id.replace(/^article-/, "") : null;
  }

  if (tabs.length === 2 && panels.every(Boolean)) {
    selector.setAttribute("role", "tablist");
    if (!selector.hasAttribute("aria-label")) selector.setAttribute("aria-label", "Article reading level");
    tabs.forEach((tab, index) => {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", panels[index].id);
      panels[index].setAttribute("role", "tabpanel");
      panels[index].setAttribute("aria-labelledby", tab.id);
      panels[index].tabIndex = 0;
      tab.addEventListener("click", () => selectLevel(tab.dataset.articleLevel, { updateUrl: true }));
      tab.addEventListener("keydown", event => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        if (next === undefined) return;
        event.preventDefault();
        selectLevel(tabs[next].dataset.articleLevel, { focus: true, updateUrl: true });
      });
    });
    selector.classList.add("is-enhanced");
    selectLevel(levelFromHash() || "basic");
    window.addEventListener("hashchange", () => {
      const level = levelFromHash();
      if (level) selectLevel(level);
    });
  }

  if (mathRoot && typeof window.renderMathInElement === "function") {
    window.renderMathInElement(mathRoot, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false }
      ],
      output: "htmlAndMathml",
      throwOnError: false,
      trust: false
    });
    window.requestAnimationFrame(updateEquationScrolling);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateEquationScrolling);
    window.addEventListener("resize", updateEquationScrolling, { passive: true });
  }
})();

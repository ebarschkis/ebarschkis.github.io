(() => {
  "use strict";

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

// Element picker — injected on demand by the service worker
import { MSG } from "../shared/constants";

// Prevent double-injection
if (!(window as any).__ftcPickerActive) {
  (window as any).__ftcPickerActive = true;
  initPicker();
}

function initPicker(): void {
  let hoveredEl: Element | null = null;
  let tooltip: HTMLDivElement | null = null;
  let active = true;

  // Scan for smart candidates
  const candidates = findCandidates();
  if (candidates.length > 0) {
    chrome.runtime.sendMessage({
      type: MSG.CANDIDATES_RESULT,
      candidates,
    });
  }

  // Activate hover mode
  document.body.classList.add("ftc-picker-active");
  createTooltip();

  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("mouseout", onMouseOut, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("ftc-cancel-picker", cancel);

  function createTooltip(): void {
    tooltip = document.createElement("div");
    tooltip.className = "ftc-picker-tooltip";
    tooltip.style.display = "none";
    document.body.appendChild(tooltip);
  }

  function onMouseOver(e: MouseEvent): void {
    if (!active) return;
    const el = e.target as Element;
    if (el === tooltip) return;
    if (hoveredEl) hoveredEl.classList.remove("ftc-picker-hover");
    hoveredEl = el;
    el.classList.add("ftc-picker-hover");

    if (tooltip) {
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent || "").trim().slice(0, 40);
      tooltip.textContent = `<${tag}> ${text}`;
      tooltip.style.display = "block";
    }
  }

  function onMouseOut(e: MouseEvent): void {
    if (!active) return;
    const el = e.target as Element;
    el.classList.remove("ftc-picker-hover");
    if (hoveredEl === el) hoveredEl = null;
    if (tooltip) tooltip.style.display = "none";
  }

  function onClick(e: MouseEvent): void {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const el = e.target as Element;
    const selector = generateSelector(el);
    const currentValue = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || "";

    chrome.runtime.sendMessage({
      type: MSG.ELEMENT_SELECTED,
      selector,
      currentValue: currentValue.slice(0, 500),
      url: window.location.href,
      pageTitle: document.title,
    });

    cleanup();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  function cancel(): void {
    cleanup();
    chrome.runtime.sendMessage({ type: MSG.CANCEL_PICKER });
  }

  function cleanup(): void {
    active = false;
    (window as any).__ftcPickerActive = false;
    document.body.classList.remove("ftc-picker-active");
    if (hoveredEl) hoveredEl.classList.remove("ftc-picker-hover");
    if (tooltip) tooltip.remove();
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("mouseout", onMouseOut, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("ftc-cancel-picker", cancel);

    // Remove any remaining hover highlights
    document.querySelectorAll(".ftc-picker-hover").forEach((el) => {
      el.classList.remove("ftc-picker-hover");
    });
  }

  // Track mouse for tooltip positioning
  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (tooltip && tooltip.style.display !== "none") {
      tooltip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 320)}px`;
      tooltip.style.top = `${Math.min(e.clientY + 12, window.innerHeight - 30)}px`;
    }
  }, true);
}

// ──────────────────────────────────────────────────────────────────
// Smart candidate detection
// ──────────────────────────────────────────────────────────────────

interface Candidate {
  selector: string;
  text: string;
  score: number;
}

function findCandidates(): Candidate[] {
  const scored = new Map<Element, number>();

  const priceRegex = /[$\u20AC\u00A3][\d,]+\.?\d*/;
  const currencyRegex = /\d+(\.\d+)?\s*(USD|EUR|GBP|CAD|AUD)/i;
  const stockRegex = /(in\s+stock|out\s+of\s+stock|only\s+\d+\s+left|available|unavailable)/i;
  const classRegex = /(price|cost|amount|stock|availability|qty|quantity|count|total)/i;
  const dataAttrRegex = /(price|stock|inventory)/i;
  const idRegex = /(price|stock|inventory|quantity)/i;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const text = node.textContent?.trim();
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode;
    const text = textNode.textContent?.trim() || "";
    let el = textNode.parentElement;
    if (!el) continue;

    // Walk up to a meaningful element (skip spans inside divs etc.)
    while (el && el !== document.body && el.children.length <= 1) {
      el = el.parentElement;
    }
    if (!el || el === document.body) {
      el = textNode.parentElement;
      if (!el) continue;
    }

    let score = scored.get(el) || 0;

    if (priceRegex.test(text) || currencyRegex.test(text)) score += 3;
    if (stockRegex.test(text)) score += 2;

    const classList = el.className || "";
    if (classRegex.test(classList)) score += 2;

    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith("data-") && dataAttrRegex.test(attr.name)) {
        score += 2;
        break;
      }
    }

    if (el.id && idRegex.test(el.id)) score += 1;

    // Prefer shallower elements
    let depth = 0;
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      depth++;
      parent = parent.parentElement;
    }
    score -= Math.floor(depth / 5);

    if (score > (scored.get(el) || 0)) {
      scored.set(el, score);
    }
  }

  const results: Candidate[] = [];
  for (const [el, score] of scored) {
    if (score < 2) continue;
    const text = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || "";
    if (!text || text.length > 200) continue;
    const selector = generateSelector(el);
    results.push({ selector, text: text.slice(0, 100), score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 5);
}

// ──────────────────────────────────────────────────────────────────
// Selector generation
// ──────────────────────────────────────────────────────────────────

function generateSelector(el: Element): string {
  // 1. Unique id
  if (el.id && isUniqueSelector(`#${CSS.escape(el.id)}`)) {
    return `#${CSS.escape(el.id)}`;
  }

  // 2. Unique data attribute
  for (const attr of ["data-testid", "data-id", "data-cy"]) {
    const val = el.getAttribute(attr);
    if (val) {
      const sel = `[${attr}="${CSS.escape(val)}"]`;
      if (isUniqueSelector(sel)) return sel;
    }
  }

  // 3. Unique tag + class combination (max 3 classes)
  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).filter((c) => !c.startsWith("ftc-")).slice(0, 3);
  if (classes.length > 0) {
    const classSel = classes.map((c) => `.${CSS.escape(c)}`).join("");
    const sel = `${tag}${classSel}`;
    if (isUniqueSelector(sel)) return sel;
  }

  // 4. Child of parent with id
  const parentWithId = findAncestorWithId(el);
  if (parentWithId) {
    const parentSel = `#${CSS.escape(parentWithId.id)}`;
    const childSel = buildChildSelector(el, parentWithId);
    const sel = `${parentSel} > ${childSel}`;
    if (sel.length <= 120 && isUniqueSelector(sel)) return sel;

    // Try descendant instead of child
    const descSel = `${parentSel} ${childSel}`;
    if (descSel.length <= 120 && isUniqueSelector(descSel)) return descSel;
  }

  // 5. Positional path from nearest ancestor with id, or from body
  const anchor = parentWithId || document.body;
  const path = buildPath(el, anchor);
  if (path.length <= 120) return path;

  // 6. Trim long selectors
  return trimSelector(el);
}

function isUniqueSelector(sel: string): boolean {
  try {
    return document.querySelectorAll(sel).length === 1;
  } catch {
    return false;
  }
}

function findAncestorWithId(el: Element): Element | null {
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    if (parent.id) return parent;
    parent = parent.parentElement;
  }
  return null;
}

function buildChildSelector(el: Element, _parent: Element): string {
  const tag = el.tagName.toLowerCase();
  const siblings = el.parentElement
    ? Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName)
    : [];
  if (siblings.length === 1) return tag;
  const idx = siblings.indexOf(el) + 1;
  return `${tag}:nth-of-type(${idx})`;
}

function buildPath(el: Element, anchor: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== anchor) {
    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (!parentEl) break;

    const currentTag = current.tagName;
    const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === currentTag);
    if (siblings.length === 1) {
      parts.unshift(tag);
    } else {
      const idx = siblings.indexOf(current) + 1;
      parts.unshift(`${tag}:nth-of-type(${idx})`);
    }
    current = parentEl;
  }

  const anchorSel = anchor === document.body ? "body" : `#${CSS.escape(anchor.id)}`;
  return `${anchorSel} > ${parts.join(" > ")}`;
}

function trimSelector(el: Element): string {
  // Last resort: try tag + nth-of-type from parent
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const idx = siblings.indexOf(el) + 1;
    const parentTag = parent.tagName.toLowerCase();

    // Try parent class + child
    if (parent.className) {
      const parentClasses = Array.from(parent.classList).slice(0, 2);
      const parentSel = `${parentTag}${parentClasses.map((c) => `.${CSS.escape(c)}`).join("")}`;
      const sel = `${parentSel} > ${tag}:nth-of-type(${idx})`;
      if (sel.length <= 120 && isUniqueSelector(sel)) return sel;
    }

    // Fallback: just nth-of-type
    const sel = `${tag}:nth-of-type(${idx})`;
    if (isUniqueSelector(sel)) return sel;
  }

  // Absolute fallback
  return buildPath(el, document.body).slice(0, 120);
}

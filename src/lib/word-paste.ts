import { MAX_RICH_BYTES, safeRichHref } from "./rich-text";

/** Parse in an inert document and rebuild an allowlisted semantic tree. Never insert clipboard HTML directly. */
export function cleanPastedHtml(html: string): string {
  if (html.length > MAX_RICH_BYTES) throw new Error("Daxil edilən mətn çox böyükdür.");
  const source = new DOMParser().parseFromString(html, "text/html");
  const output = document.implementation.createHTMLDocument("");
  const blocked = new Set([
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "IMG",
    "SVG",
    "MATH",
    "LINK",
    "META",
    "BASE",
    "INPUT",
    "FORM",
    "BUTTON",
    "VIDEO",
    "AUDIO",
    "TEMPLATE",
  ]);
  let nodes = 0;
  function children(parent: Node, target: Node, depth: number) {
    let stack: { list: HTMLElement; item: HTMLElement | null; kind: string; id: string }[] = [];
    for (const child of Array.from(parent.childNodes)) {
      if (++nodes > 50_000 || depth > 24) throw new Error("Mətnin quruluşu çox mürəkkəbdir.");
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(output.createTextNode(child.textContent ?? ""));
        continue;
      }
      if (!(child instanceof Element) || blocked.has(child.tagName.toUpperCase())) continue;
      const el = child as HTMLElement;
      const tag = el.tagName.toUpperCase();
      const style = el.getAttribute("style") ?? "";
      const wordList =
        tag === "P" && (/mso-list\s*:/iu.test(style) || /MsoListParagraph/iu.test(el.className));
      if (wordList) {
        const level = Math.min(8, Number(style.match(/level(\d+)/iu)?.[1] ?? 1));
        const marker = Array.from(el.querySelectorAll("span")).find((span) =>
          /mso-list\s*:\s*ignore/iu.test(span.getAttribute("style") ?? ""),
        );
        const markerText =
          marker?.textContent?.trim() ??
          el.textContent?.match(/^\s*(\d+[.)]|[a-zA-Z][.)]|[•·▪◦\uF0B7])\s+/u)?.[1] ??
          "";
        const kind = /^(?:\(?\d+|\(?[a-zA-Z])[.)]/u.test(markerText) ? "ol" : "ul";
        const id =
          style.match(/mso-list\s*:\s*([^;]+)/iu)?.[1]?.replace(/level\d+/iu, "") ?? "list";
        marker?.remove();
        if (!marker && markerText) {
          const walker = source.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          const first = walker.nextNode();
          if (first)
            first.textContent = (first.textContent ?? "").replace(
              /^\s*(?:\d+[.)]|[a-zA-Z][.)]|[•·▪◦\uF0B7])\s+/u,
              "",
            );
        }
        const wanted = Math.min(level, stack.length + 1);
        stack = stack.slice(0, wanted);
        if (stack[wanted - 1] && (stack[wanted - 1]!.kind !== kind || stack[wanted - 1]!.id !== id))
          stack = stack.slice(0, wanted - 1);
        while (stack.length < wanted) {
          const list = output.createElement(kind);
          const start = Number(markerText.match(/^\(?([0-9]+)/u)?.[1] ?? 1);
          if (kind === "ol" && start > 1) list.setAttribute("start", String(start));
          (stack.at(-1)?.item ?? target).appendChild(list);
          stack.push({ list, item: null, kind, id });
        }
        const item = output.createElement("li");
        const p = output.createElement("p");
        children(el, p, depth + 1);
        item.appendChild(p);
        stack.at(-1)!.list.appendChild(item);
        stack.at(-1)!.item = item;
        continue;
      }
      // Whitespace between Word paragraphs must not end a list; actual blocks do.
      if (["P", "DIV", "H1", "H2", "H3", "UL", "OL", "BLOCKQUOTE", "TABLE"].includes(tag))
        stack = [];
      const heading =
        /(?:MsoHeading|Heading)([123])/iu.exec(el.className)?.[1] ??
        style.match(/mso-outline-level\s*:\s*([123])/iu)?.[1];
      let semantic = heading ? `h${heading}` : tag.toLowerCase();
      if (["h4", "h5", "h6"].includes(semantic)) semantic = "h3";
      if (["div", "td", "th"].includes(semantic)) semantic = "p";
      const allowed = [
        "p",
        "h1",
        "h2",
        "h3",
        "ul",
        "ol",
        "li",
        "blockquote",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "a",
        "br",
      ].includes(semantic);
      let destination: Node = target;
      if (allowed) {
        const next = output.createElement(semantic);
        if (semantic === "a") {
          const href = safeRichHref(el.getAttribute("href"));
          if (href) next.setAttribute("href", href);
          else {
            children(el, target, depth + 1);
            continue;
          }
        }
        if (semantic === "ol") {
          const start = Number(el.getAttribute("start") ?? 1);
          if (Number.isInteger(start) && start > 0 && start <= 1_000_000)
            next.setAttribute("start", String(start));
        }
        target.appendChild(next);
        destination = next;
      }
      const weight = el.style.fontWeight;
      const wrappers = [
        ...(weight === "bold" || Number(weight) >= 600 ? ["strong"] : []),
        ...(el.style.fontStyle === "italic" ? ["em"] : []),
        ...(/underline/iu.test(el.style.textDecoration) ? ["u"] : []),
      ];
      for (const wrapper of wrappers) {
        const next = output.createElement(wrapper);
        destination.appendChild(next);
        destination = next;
      }
      children(el, destination, depth + 1);
    }
  }
  children(source.body, output.body, 0);
  return output.body.innerHTML;
}

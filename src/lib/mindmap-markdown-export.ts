const properties = [
  "display",
  "visibility",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "float",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "color",
  "text-align",
  "text-decoration",
  "white-space",
  "word-break",
  "overflow-wrap",
  "vertical-align",
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "padding",
  "margin",
  "border",
  "border-radius",
  "background",
  "box-shadow",
  "box-sizing",
  "overflow",
  "opacity",
  "transform",
  "transform-origin",
  "gap",
  "flex",
  "flex-direction",
  "align-items",
  "justify-content",
  "grid-template-columns",
  "grid-column",
  "grid-row",
  "border-collapse",
  "border-spacing",
  "list-style",
  "fill",
  "stroke",
  "stroke-width",
  "clip",
  "clip-path",
  "mask-image",
  "letter-spacing",
  "text-indent",
];
let fontCss = "";
const fontCache = new Map<string, string>();
function includesCharacters(range: string, characters: number[]) {
  if (!range) return true;
  return range.split(",").some((item) => {
    const match = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(item);
    if (!match) return false;
    const low = parseInt(match[1]!.replaceAll("?", "0"), 16);
    const high = parseInt(match[2] || match[1]!.replaceAll("?", "f"), 16);
    return characters.some(
      (character) => character >= low && character <= high,
    );
  });
}
/** Inline formula fonts so SVG/PNG work without a website stylesheet. */
export async function prepareMarkdownExport(canvas: HTMLElement) {
  const characters = [
    ...new Set(
      [...(canvas.textContent || "")].map((character) =>
        character.codePointAt(0)!,
      ),
    ),
  ];
  const families = new Set(
    [...canvas.querySelectorAll(".map-node-markdown *")].map((element) =>
      getComputedStyle(element)
        .fontFamily.replaceAll('"', "")
        .split(",")[0]!
        .trim(),
    ),
  );
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of [...document.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules])
        if (
          rule instanceof CSSFontFaceRule &&
          families.has(rule.style.fontFamily.replaceAll('"', ""))
        )
          rules.push(rule);
    } catch {
      /* Cross-origin sheets cannot be inspected. */
    }
  }
  fontCss = (
    await Promise.all(
      rules
        .filter((rule) =>
          includesCharacters(
            rule.style.getPropertyValue("unicode-range"),
            characters,
          ),
        )
        .map(async (rule) => {
          const url = [
            ...rule.style
              .getPropertyValue("src")
              .matchAll(/url\(["']?([^)'"\s]+)["']?\)/g),
          ]
            .map((match) => match[1]!)
            .find((value) => value.includes(".woff2"));
          if (!url) return "";
          let data = fontCache.get(url);
          if (!data) {
            const response = await fetch(new URL(url, document.baseURI));
            if (!response.ok) throw new Error("公式字体加载失败，请重试导出");
            data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              response
                .blob()
                .then((blob) => reader.readAsDataURL(blob), reject);
            });
            fontCache.set(url, data);
          }
          return `@font-face{font-family:${rule.style.fontFamily};font-style:${rule.style.fontStyle};font-weight:${rule.style.fontWeight};unicode-range:${rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF"};src:url("${data}") format("woff2")}`;
        }),
    )
  ).join("\n");
}
export function styleMarkdownExport(svg: SVGElement, canvas: HTMLElement) {
  let fontsAdded = false;
  const originals = new Map(
    [
      ...canvas.querySelectorAll<HTMLElement>(".smm-node .map-node-markdown"),
    ].map((root) => [root.dataset.mapNode, root]),
  );
  for (const clone of svg.querySelectorAll<HTMLElement>(".map-node-markdown")) {
    const original = originals.get(clone.dataset.mapNode);
    if (!original) continue;
    const sources = [original, ...original.querySelectorAll<HTMLElement>("*")];
    const targets = [clone, ...clone.querySelectorAll<HTMLElement>("*")];
    sources.forEach((source, index) => {
      const style = getComputedStyle(source),
        target = targets[index];
      if (!target?.style) return;
      for (const property of properties)
        target.style.setProperty(property, style.getPropertyValue(property));
    });
    // Embedding fonts inside XHTML keeps SVG foreignObject rendering portable.
    if (!fontsAdded) {
      const style = document.createElement("style");
      style.textContent = fontCss;
      clone.appendChild(style);
      fontsAdded = true;
    }
  }
}

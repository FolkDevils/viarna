/**
 * Getting bytes out of the browser: file downloads and clipboard writes.
 *
 * The clipboard path is the fiddly bit and the reason this is its own module:
 * a design tool only accepts a vector *paste* when the clipboard advertises the
 * right MIME types, and browsers disagree about which they'll take. We offer
 * several representations at once and let the browser pick.
 */

/** Trigger a browser download for any blob. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ext = (name: string, e: string) => (name.endsWith(`.${e}`) ? name : `${name}.${e}`);

export function downloadText(filename: string, text: string, mime: string): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

export const downloadSVG = (filename: string, svg: string): void =>
  downloadText(ext(filename, "svg"), svg, "image/svg+xml");

export const downloadJSON = (filename: string, json: string): void =>
  downloadText(ext(filename, "json"), json, "application/json");

/**
 * Copy SVG as rich clipboard content so a design tool receives a real vector
 * asset rather than a wall of XML. Chromium takes `image/svg+xml` directly,
 * some WebKit builds need `text/html`, and `text/plain` is what a code editor
 * pastes. Falls back progressively rather than failing outright.
 */
export async function copySvg(svg: string): Promise<boolean> {
  const inline = svg.replace(/^<\?xml[^>]*>\s*/i, "");
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const plain = new Blob([svg], { type: "text/plain" });
      const html = new Blob([`<div>${inline}</div>`], { type: "text/html" });
      const vector = new Blob([svg], { type: "image/svg+xml" });
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/svg+xml": vector, "text/html": html, "text/plain": plain }),
        ]);
        return true;
      } catch {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": html, "text/plain": plain }),
        ]);
        return true;
      }
    }
    await navigator.clipboard.writeText(svg);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(svg);
      return true;
    } catch {
      return false;
    }
  }
}

/** Copy plain text (used for the `.viarna.json` document). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Filename-safe slug. */
export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "viarna";

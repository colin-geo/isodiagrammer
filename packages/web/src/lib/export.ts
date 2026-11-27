/** Export helpers: clean SVG and PNG rasterisation in the browser. */
import { svgSize } from "./panzoom.ts";

/** Strip editor-only attributes (hit-test ids) from the preview SVG. */
export function cleanSvg(svg: string): string {
  return svg.replace(/ data-id="[^"]*"/g, "");
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function svgToPng(svg: string, scale = 2): Promise<Blob> {
  const { w, h } = svgSize(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is not available");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "My Diagram.yaml" → "My Diagram" */
export const baseName = (name: string) => name.replace(/\.(iso\.)?ya?ml$/i, "") || "diagram";

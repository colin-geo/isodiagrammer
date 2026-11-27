/** Node icon provider: files relative to the diagram, https: URLs and data: URIs. */
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { type IconProvider, imageIcon, mimeForPath } from "@isodiagrammer/core";

export function nodeIconProvider(baseDir: string): IconProvider {
  return {
    async load(src) {
      if (src.startsWith("data:")) return imageIcon(src);
      if (/^https?:\/\//.test(src)) {
        const res = await fetch(src);
        if (!res.ok) return undefined;
        const mime = res.headers.get("content-type")?.split(";")[0] ?? mimeForPath(src);
        if (!mime?.startsWith("image/")) return undefined;
        const bytes = Buffer.from(await res.arrayBuffer());
        return imageIcon(`data:${mime};base64,${bytes.toString("base64")}`);
      }
      const mime = mimeForPath(src);
      if (!mime) return undefined;
      const path = isAbsolute(src) ? src : resolve(baseDir, src);
      try {
        const bytes = await readFile(path);
        return imageIcon(`data:${mime};base64,${bytes.toString("base64")}`);
      } catch {
        return undefined;
      }
    },
  };
}

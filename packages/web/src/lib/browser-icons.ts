/** Browser icon provider: data: URIs, and http(s)/relative URLs fetched and inlined. */
import { type IconProvider, imageIcon, mimeForPath } from "@isodiagrammer/core";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function browserIconProvider(base: string): IconProvider {
  const cache = new Map<string, Promise<ReturnType<typeof imageIcon> | undefined>>();
  const load = async (src: string) => {
    if (src.startsWith("data:")) return imageIcon(src);
    const res = await fetch(new URL(src, base));
    if (!res.ok) return undefined;
    const mime = res.headers.get("content-type")?.split(";")[0] ?? mimeForPath(src);
    if (!mime?.startsWith("image/")) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return imageIcon(`data:${mime};base64,${toBase64(bytes)}`);
  };
  return {
    load(src) {
      let p = cache.get(src);
      if (!p) {
        p = load(src).catch(() => undefined);
        cache.set(src, p);
      }
      return p;
    },
  };
}

/** The repository's examples/ folder, bundled as starter documents. */
const files = import.meta.glob("../../../../examples/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const EXAMPLES: { name: string; text: string }[] = Object.entries(files)
  .map(([path, text]) => ({ name: path.split("/").pop() as string, text }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const STARTER = EXAMPLES.find((e) => e.name === "checkout-platform.yaml") ?? EXAMPLES[0];

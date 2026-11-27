import { expect, type Locator, type Page, test } from "@playwright/test";

const DOC = `version: 1
# Drag-and-drop test document
settings:
  grid: { style: simple }
groups:
  left: { at: [0, 0], size: [8, 8] }
  right: { at: [12, 0], size: [8, 8] }   # drop target
resources:
  a: { in: left, at: [3, 3] }   # keep this comment
  b: { in: right, at: [1, 1] }
`;

const COS30 = Math.cos(Math.PI / 6);
const S = 32; // px per cell edge at 100 %, from the engine

async function editorText(page: Page): Promise<string> {
  return page
    .locator(".cm-content")
    .evaluate((el) => [...el.querySelectorAll(".cm-line")].map((l) => l.textContent).join("\n"));
}

async function setDoc(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

async function zoom(page: Page): Promise<number> {
  return Number.parseInt((await page.getByTestId("zoom-level").textContent()) ?? "100", 10) / 100;
}

/** Screen offset for a world-grid move of (dx, dy) cells at rotation 0. */
async function cells(page: Page, dx: number, dy: number) {
  const k = await zoom(page);
  return { x: (dx - dy) * COS30 * S * k, y: (dx + dy) * 0.5 * S * k };
}

async function centre(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not visible");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const solid = (page: Page, id: string) => page.locator(`.preview g.resource[data-id="${id}"]`);

async function drag(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
  opts: { hold?: () => Promise<void> } = {},
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several steps so the pointer passes the drag threshold and the ghost updates.
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 4 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 4 });
  await opts.hold?.();
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await setDoc(page, DOC);
  await expect(solid(page, "b")).toBeVisible();
  await page.getByRole("button", { name: "Fit" }).click();
});

test("dragging writes at: back into the YAML, keeping comments; undo and redo work from the preview", async ({
  page,
}) => {
  await drag(page, await centre(solid(page, "a")), await cells(page, 2, 1));
  await expect
    .poll(() => editorText(page))
    .toContain("a: { in: left, at: [5, 4] }   # keep this comment");
  expect(await editorText(page)).toContain("# Drag-and-drop test document");
  await expect(page.getByTestId("selection")).toContainText("pinned at [5, 4]");

  await page.keyboard.press("ControlOrMeta+z"); // the preview has focus after the drag
  await expect.poll(() => editorText(page)).toBe(DOC);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => editorText(page)).toContain("at: [5, 4]");
});

test("dropping into another group reparents", async ({ page }) => {
  const a = await centre(solid(page, "a"));
  await drag(page, a, await cells(page, 12, 0), {
    hold: async () => {
      await expect(page.getByRole("status").filter({ hasText: "Move into “right”" })).toBeVisible();
    },
  });
  await expect
    .poll(() => editorText(page))
    .toContain("a: { in: right, at: [3, 3] }   # keep this comment");
});

test("an invalid drop shows why and changes nothing", async ({ page }) => {
  await drag(page, await centre(solid(page, "a")), await cells(page, 10, -2), {
    hold: async () => {
      await expect(page.getByText('Can\'t drop here: Overlaps "b"')).toBeVisible();
      await expect(page.locator(".overlay .ghost.invalid")).toBeVisible();
    },
  });
  await page.waitForTimeout(300);
  expect(await editorText(page)).toBe(DOC);
});

test("Alt-drag keeps the node in its group", async ({ page }) => {
  await page.keyboard.down("Alt");
  await drag(page, await centre(solid(page, "a")), await cells(page, 1, 0));
  await page.keyboard.up("Alt");
  await expect.poll(() => editorText(page)).toContain("a: { in: left, at: [4, 3] }");
});

test("selection syncs both ways", async ({ page }) => {
  // Preview → editor: clicking a node moves the editor cursor to its entry.
  await solid(page, "a").click();
  await expect(page.locator(".cm-activeLine")).toContainText("a: { in: left");
  await expect(page.locator('.preview g.selected[data-id="a"]').first()).toBeAttached();

  // Editor → preview.
  await page.locator(".cm-line", { hasText: "b: { in: right" }).click();
  await expect(page.locator('.preview g.selected[data-id="b"]').first()).toBeAttached();
  await expect(page.getByTestId("selection")).toContainText("b");
});

test("arrow keys nudge the selection; Unpin removes at", async ({ page }) => {
  await solid(page, "a").click();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => editorText(page)).toContain("a: { in: left, at: [4, 3] }");
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => editorText(page)).toContain("a: { in: left, at: [4, 4] }");

  await page.getByRole("button", { name: "Unpin" }).click();
  await expect.poll(() => editorText(page)).toContain("a: { in: left }   # keep this comment");
});

test("a selected group can be resized from its corner handle", async ({ page }) => {
  await page.locator('.preview g.group[data-id="right"] text').click();
  const handle = page.locator(".overlay .resize-handle");
  await expect(handle).toBeVisible();
  await drag(page, await centre(handle), await cells(page, 2, 3));
  await expect
    .poll(() => editorText(page))
    .toContain("right: { at: [12, 0], size: [10, 11] }   # drop target");
});

test("dragging the background still pans", async ({ page }) => {
  const before = await centre(solid(page, "a"));
  const box = await page.locator(".preview").boundingBox();
  if (!box) throw new Error("no preview");
  await drag(page, { x: box.x + 20, y: box.y + 20 }, { x: 60, y: 40 });
  const after = await centre(solid(page, "a"));
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(await editorText(page)).toBe(DOC);
});

test("Pin all writes at: for every auto-placed node, as one undo step", async ({ page }) => {
  const auto = `version: 1
resources:
  a: {}   # auto
  b: { at: [9, 9] }
links: [a -> b]
`;
  await setDoc(page, auto);
  const pinAll = page.getByRole("button", { name: "Pin all" });
  await expect(pinAll).toBeEnabled();
  await pinAll.click();
  await expect.poll(() => editorText(page)).toMatch(/a: \{ at: \[\d+, \d+\] \} {3}# auto/);
  await expect(pinAll).toBeDisabled(); // nothing left to pin
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => editorText(page)).toBe(auto);
});

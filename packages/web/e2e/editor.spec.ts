import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.locator(".cm-content");
const preview = (page: Page) => page.locator(".preview .content > svg:not(.overlay)");

/** Replace the editor's whole document by typing (exercises the real input path). */
async function setDoc(page: Page, text: string) {
  await editor(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(preview(page)).toBeVisible();
});

test("starts with the starter diagram rendered", async ({ page }) => {
  await expect(page.getByTestId("doc-name")).toHaveText("checkout-platform.yaml");
  await expect(page.locator('.preview [data-id="web"]').first()).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("No problems");
});

test("typing updates the preview", async ({ page }) => {
  await setDoc(
    page,
    "version: 1\nresources:\n  alpha: { type: database }\n  beta: { type: queue }\nlinks:\n  - alpha -> beta\n",
  );
  await expect(page.locator('.preview [data-id="beta"]').first()).toBeVisible();
  await expect(page.locator('.preview [data-id="web"]')).toHaveCount(0);
});

test("errors show inline and in the problems list; clicking jumps to the source", async ({
  page,
}) => {
  await setDoc(page, "version: 1\nresources:\n  web: { type: server, colour: red }\n");
  const problem = page.getByRole("list", { name: "Problems" }).getByRole("button").first();
  await expect(problem).toContainText('Unknown key "colour"');
  await expect(problem).toContainText("E_UNKNOWN_KEY · 3:24");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
  // The last valid render stays visible, marked as stale.
  await expect(page.getByText("Showing the last valid render")).toBeVisible();

  await problem.click();
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected).toBe("colour");
});

test("schema-driven autocomplete suggests keys and built-in types", async ({ page }) => {
  await setDoc(page, "version: 1\nresources:\n  web: { ty");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("type");

  await setDoc(page, "version: 1\nresources:\n  web:\n    type: data");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".cm-tooltip-autocomplete")).toContainText("database");
});

test("hovering a key shows its documentation", async ({ page }) => {
  await setDoc(page, "version: 1\nresources:\n  web:\n    at: [1, 2]\n");
  // Hover the lower line second: a tooltip can cover the line above it.
  await page.locator(".cm-line", { hasText: "web:" }).getByText("web").hover();
  await expect(page.locator(".cm-tooltip-hover")).toContainText("A resource");
  await page.mouse.move(0, 0);
  await page.locator(".cm-line", { hasText: "at: [1, 2]" }).getByText("at").first().hover();
  await expect(page.locator(".cm-tooltip-hover")).toContainText("Pinned position");
});

test("export SVG downloads a clean SVG", async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export SVG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("checkout-platform.svg");
  const body = await (await download.createReadStream()).toArray();
  const svg = Buffer.concat(body).toString("utf8");
  expect(svg).toMatch(/^<svg /);
  expect(svg).not.toContain("data-id");
});

test("export PNG downloads a PNG", async ({ page }) => {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export PNG" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("checkout-platform.png");
  const bytes = Buffer.concat(await (await download.createReadStream()).toArray());
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  expect(bytes.length).toBeGreaterThan(10_000);
});

test("work is autosaved across reloads", async ({ page }) => {
  await setDoc(page, "version: 1\nresources:\n  persisted: {}\n");
  await expect(page.locator('.preview [data-id="persisted"]').first()).toBeVisible();
  await page.waitForTimeout(600); // autosave debounce
  await page.reload();
  await expect(page.locator('.preview [data-id="persisted"]').first()).toBeVisible();
  await expect(page.getByTestId("doc-name")).toContainText("checkout-platform.yaml");
});

test("examples menu loads an example", async ({ page }) => {
  await page.getByLabel("Load an example").selectOption("showcase.yaml");
  await expect(page.getByTestId("doc-name")).toHaveText("showcase.yaml");
  await expect(page.locator('.preview [data-id="jobs"]').first()).toBeVisible();
});

test("zoom controls and fit", async ({ page }) => {
  const level = page.getByTestId("zoom-level");
  const before = await level.textContent();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(level).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "Fit" }).click();
  await expect(level).toHaveText(before ?? "");
});

test("help panel is generated from the engine catalogue", async ({ page }) => {
  await page.getByRole("button", { name: "Help" }).click();
  const help = page.getByRole("complementary", { name: "Quick reference" });
  await expect(help).toContainText("loadbalancer");
  await expect(help).toContainText("Built-in glyphs");
});

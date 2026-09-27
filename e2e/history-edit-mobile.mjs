import assert from "node:assert/strict";
import { join } from "node:path";

export async function checkMobileHistoryEdit(page, artifacts, width) {
  await page.locator("strong").filter({ hasText: "E2E markdown" }).waitFor();
  const userMessage = page.locator("[data-entry-id='user']");
  const buttons = ["Copy", "Edit from here", "New session"];
  for (const name of buttons) {
    const button = userMessage.getByRole("button", { name, exact: true });
    await button.waitFor({ state: "attached" });
    const { opacity, pointerEvents, height, width: targetWidth } = await button.evaluate((element) => ({
      opacity: getComputedStyle(element.parentElement).opacity,
      pointerEvents: getComputedStyle(element).pointerEvents,
      height: element.getBoundingClientRect().height,
      width: element.getBoundingClientRect().width,
    }));
    assert.equal(opacity, "1", `${width}px ${name} must be visible without hover`);
    assert.equal(pointerEvents, "auto", `${width}px ${name} must accept touch`);
    assert.ok(height >= 44 && targetWidth >= 44, `${width}px ${name} must have a 44×44px touch target`);
  }
  const edit = userMessage.getByRole("button", { name: "Edit from here", exact: true });
  const previousUrl = page.url();
  const sessionId = new URL(previousUrl).searchParams.get("session");
  assert.ok(sessionId);
  const sessionUrl = new URL(`/api/sessions/${encodeURIComponent(sessionId)}`, previousUrl).toString();
  const entryIds = async () => (await (await page.request.get(sessionUrl)).json()).context.entryIds;
  const previousEntries = await entryIds();
  assert.ok(Array.isArray(previousEntries) && previousEntries.includes("user"));
  await edit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(artifacts, `history-edit-mobile-${width}.png`) });
  const rect = await edit.boundingBox();
  assert.ok(rect, "Edit from here must be in the viewport");
  await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  await cancel.waitFor();
  await page.screenshot({ path: join(artifacts, `history-edit-open-${width}.png`) });
  await cancel.tap();
  await cancel.waitFor({ state: "hidden" });
  assert.equal(page.url(), previousUrl, "Cancelling the edit must not navigate");
  assert.deepEqual(await entryIds(), previousEntries, "Cancelling the edit must not create a branch");
  console.log(`PASS: ${width}px mobile history actions and touch edit/cancel`);
}

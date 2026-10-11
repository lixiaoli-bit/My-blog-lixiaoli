import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { reviewMarkdown } from "./mindmap-markdown-review.mjs";
const output = path.resolve("outputs/mindmap-markdown"),
  base = "http://127.0.0.1:43227";
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  extraHTTPHeaders: { Origin: base },
});
const page = await context.newPage(),
  cases = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.stack));
try {
  await context.request.post(`${base}/api/admin-auth/login`, {
    data: { password: "mindmap-review-local" },
  });
  await context.addCookies(
    (await context.cookies()).map((cookie) => ({ ...cookie, secure: false })),
  );
  await reviewMarkdown({
    context,
    page,
    base,
    output,
    source: { domain: "article", targetId: "map-review" },
    sourcePage: await context.newPage(),
    record: (label) => {
      cases.push(label);
      console.log("PASS", label);
    },
  });
  if (errors.length) throw Error(errors.join("\n"));
} catch (error) {
  errors.push(error.stack);
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(
    path.join(output, "browser.json"),
    JSON.stringify({ cases, errors }, null, 2),
  );
  await browser.close();
}

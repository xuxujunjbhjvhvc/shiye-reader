import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const output = path.resolve(process.env.SHIYE_PACKAGE_ROOT || "release/拾页");
const evidence = path.resolve(".test-results");
await mkdir(evidence, { recursive: true });
const child = spawn(path.join(output, "拾页.exe"), ["--debug"], {
  cwd: output,
  windowsHide: true,
  env: {
    ...process.env,
    SHIYE_PROFILE: path.resolve(
      ".test-results/native-profiles",
      String(Date.now()),
    ),
  },
});
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  assert.ok(browser, "WebView2 调试端口未启动");
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.waitForEvent("page"));
  await page.waitForURL("https://shiye.local/**", { timeout: 20000 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("#import").waitFor({ timeout: 20000 });
  const fixture = path.resolve("test/fixtures/把时间留给阅读.epub");
  await page.locator("#files").setInputFiles(fixture);
  await page.waitForFunction(
    () => document.querySelectorAll(".book-card").length === 1,
    {},
    { timeout: 20000 },
  );
  await page
    .getByRole("button", { name: "阅读 把时间留给阅读", exact: true })
    .click();
  await page.locator("#loading").waitFor({ state: "detached", timeout: 20000 });
  assert.equal(await page.locator(".reading-error").count(), 0);
  assert.ok((await page.locator("iframe").count()) > 0);
  await page.locator("#next").click();
  await page.waitForTimeout(500);
  await page.locator("#mode-scroll").click();
  await page.waitForFunction(
    () => !document.getElementById("mode-scroll").disabled,
  );
  await page.waitForFunction(() => {
    const el = document.querySelector(".epub-container");
    return el && el.scrollHeight > el.clientHeight;
  });
  await page.locator("#mode-paginated").click();
  await page.waitForFunction(
    () => !document.getElementById("mode-paginated").disabled,
  );
  await page.locator("#back").click();
  await page.locator(".continue-card").waitFor();
  await page.reload();
  await page.locator(".book-card").waitFor();
  assert.equal(await page.locator(".book-card").count(), 1);
  await page
    .locator("#files")
    .setInputFiles(path.resolve("test/fixtures/日常的诗意.pdf"));
  await page.waitForFunction(
    () => document.querySelectorAll(".book-card").length === 2,
    {},
    { timeout: 20000 },
  );
  await page
    .getByRole("button", { name: "阅读 日常的诗意", exact: true })
    .click();
  await page.locator("#loading").waitFor({ state: "detached", timeout: 20000 });
  assert.equal(await page.locator(".pdf-page canvas").count(), 1);
  assert.ok((await page.locator(".textLayer span").count()) > 0);
  await page.locator("#mode-scroll").click();
  await page.waitForFunction(
    () => !document.getElementById("mode-scroll").disabled,
  );
  assert.equal(await page.locator(".document-page").count(), 3);
  await page.locator("#mode-paginated").click();
  await page.waitForFunction(
    () => !document.getElementById("mode-paginated").disabled,
  );
  await page.locator("#back").click();
  await page.screenshot({ path: path.join(evidence, "native.png") });
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(evidence, "native.json"),
    JSON.stringify(
      {
        nativeStartup: true,
        virtualHost: true,
        epubRead: true,
        pdfRead: true,
        readingModeSwitch: true,
        progressPersistence: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("PASS 原生 EXE 启动、离线虚拟主机、EPUB 阅读、重载持久化");
} finally {
  if (browser) await browser.close();
  child.kill();
}

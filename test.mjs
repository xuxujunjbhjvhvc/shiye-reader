import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const fixtures = path.resolve(root, "test/fixtures");
const evidence = path.resolve(root, ".test-results");
await mkdir(evidence, { recursive: true });
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
};
const appRoot = path.resolve(
  process.env.SHIYE_APP_ROOT || path.join(root, "dist"),
);
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const target = path.resolve(
      appRoot,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    if (!target.startsWith(appRoot + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await readFile(target);
    res.setHeader(
      "Content-Type",
      mime[path.extname(target)] || "application/octet-stream",
    );
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 880 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
const logs = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") logs.push(message.text());
});
page.on("dialog", (dialog) => dialog.dismiss());
const checks = [];
async function check(name, action) {
  await action();
  checks.push(name);
  console.log("PASS", name);
}
const open = async (title) => {
  await page
    .getByRole("button", { name: `阅读 ${title}`, exact: true })
    .click();
  await page.locator("#loading").waitFor({ state: "detached", timeout: 30000 });
  await assert.equal(await page.locator(".reading-error").count(), 0);
};
const back = async () => {
  await page.locator("#back").click();
  await page.locator(".library-heading h1").waitFor();
};
const mode = async (value) => {
  const control = page.locator("#mode-" + value);
  if ((await control.getAttribute("aria-pressed")) !== "true")
    await control.click();
  await page.waitForFunction(
    (id) => !document.getElementById(id).disabled,
    "mode-" + value,
  );
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await check("首次启动显示空书库", async () => {
    await page.getByText("从喜欢的第一本书开始").waitFor();
  });
  await check("批量导入 EPUB PDF TXT Markdown FB2 CBZ 及旧编码", async () => {
    await page
      .locator("#files")
      .setInputFiles(
        [
          "把时间留给阅读.epub",
          "日常的诗意.pdf",
          "安静的阅读.txt",
          "阅读笔记.md",
          "山间来信.fb2",
          "四季画册.cbz",
          "旧编码.txt",
        ].map((name) => path.join(fixtures, name)),
      );
    await page.waitForFunction(
      () => document.querySelectorAll(".book-card").length === 7,
      {},
      { timeout: 60000 },
    );
  });
  await check("重复导入按文件内容去重", async () => {
    await page
      .locator("#files")
      .setInputFiles(path.join(fixtures, "把时间留给阅读.epub"));
    await page.getByText("已导入 0 本，已存在 1 本", { exact: true }).waitFor();
    assert.equal(await page.locator(".book-card").count(), 7);
  });
  await check("书库搜索和列表视图", async () => {
    await page.locator("#library-search").fill("诗意");
    assert.equal(await page.locator(".book-card").count(), 1);
    await page.locator("#library-search").fill("");
    await page.locator("#list").click();
    await page.locator(".book-list").waitFor();
    await page.locator("#grid").click();
  });
  await check("EPUB 正文、翻页、目录、书签及书内搜索", async () => {
    await open("把时间留给阅读");
    await page.waitForFunction(() =>
      [...document.querySelectorAll("iframe")].some((frame) =>
        frame.contentDocument?.body.textContent.includes("午后的光"),
      ),
    );
    await page.locator("#next").click();
    await page.waitForTimeout(500);
    await page.locator("#bookmark").click();
    await page.getByText("已添加书签", { exact: true }).waitFor();
    await page.locator("#contents").click();
    assert.equal(await page.locator("[data-toc]").count(), 3);
    await page.locator('[data-toc="1"]').click();
    await page.waitForTimeout(400);
    await page.locator("#search-reader").click();
    await page.locator("#book-query").fill("午后的光");
    await page.locator(".search-submit").click();
    await page.locator("[data-result]").first().waitFor();
    await page.locator("[data-result]").first().click();
    await page.locator("#appearance").click();
    await page.locator('[data-theme="night"]').click();
    assert.equal(
      await page.locator("html").getAttribute("data-theme"),
      "night",
    );
    await page.locator('[data-theme="paper"]').click();
    await page.locator("#font-size").fill("24");
    await page.locator("#close-panel").click();
    await page.screenshot({ path: path.join(evidence, "epub.png") });
    await back();
  });
  await check("PDF 渲染、可选文字、翻页和搜索", async () => {
    await open("日常的诗意");
    assert.equal(await page.locator(".pdf-page canvas").count(), 1);
    assert.ok((await page.locator(".textLayer span").count()) > 0);
    await page.locator("#next").click();
    await page.getByText("2 / 3 页", { exact: true }).waitFor();
    await page.locator("#search-reader").click();
    await page.locator("#book-query").fill("quiet");
    await page.locator(".search-submit").click();
    await page.locator("[data-result]").first().waitFor();
    assert.equal(await page.locator("[data-result]").count(), 3);
    await page.locator("#contents").click();
    assert.equal(await page.locator("[data-toc]").count(), 3);
    await page.locator('[data-toc="2"]').click();
    await page.getByText("3 / 3 页", { exact: true }).waitFor();
    await back();
  });
  await check("TXT 章节、滚动进度和书签恢复", async () => {
    await open("安静的阅读");
    await mode("scroll");
    await page.locator("#contents").click();
    assert.ok((await page.locator("[data-toc]").count()) >= 8);
    await page.locator('[data-toc="4"]').click();
    await page.waitForTimeout(700);
    await page.locator("#close-panel").click();
    await page.locator("#bookmark").click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(evidence, "reading.png") });
    await back();
    await open("安静的阅读");
    assert.ok(
      (await page.locator("#reading-stage").evaluate((el) => el.scrollTop)) > 0,
    );
    await back();
  });
  await check("GB18030 自动识别", async () => {
    await open("旧编码");
    assert.ok(
      (await page.locator(".text-book").textContent()).includes(
        "这是一本 GB18030 编码的书",
      ),
    );
    await back();
  });
  await check("Markdown 排版", async () => {
    await open("阅读笔记");
    assert.equal(
      await page.locator(".text-book strong").textContent(),
      "保持好奇",
    );
    await back();
  });
  await check("FB2 正文与元数据", async () => {
    await open("山间来信");
    assert.ok(
      (await page.locator(".text-book").textContent()).includes("见字如面"),
    );
    await back();
  });
  await check("CBZ 图片解包和翻页", async () => {
    await open("四季画册");
    await mode("paginated");
    await page.locator(".comic-page").waitFor();
    assert.ok(
      await page
        .locator(".comic-page")
        .evaluate((img) => img.complete && img.naturalWidth > 0),
    );
    await page.locator("#next").click();
    await page.getByText("2 / 3 页", { exact: true }).waitFor();
    await back();
  });
  await check("书单和收藏", async () => {
    await page.locator("#new-collection").click();
    await page.locator("#collection-name").fill("慢读时光");
    await page.locator("#collection-form button").click();
    await page
      .locator(".book-card")
      .filter({
        has: page.getByRole("button", { name: "阅读 安静的阅读", exact: true }),
      })
      .locator("[data-menu]")
      .click();
    await page.locator("#favorite").check();
    await page.locator("#collection").selectOption({ label: "慢读时光" });
    await page.locator("#save-book").click();
    await page.locator('[data-filter="favorites"]').click();
    assert.equal(await page.locator(".book-card").count(), 1);
    await page.locator('[data-filter="all"]').click();
  });
  await check("重启后保留书库与阅读记录", async () => {
    await page.reload();
    await page.locator(".book-card").first().waitFor();
    assert.equal(await page.locator(".book-card").count(), 7);
    await page.locator(".continue-card").waitFor();
  });
  await check("导出备份并恢复", async () => {
    await page.locator("#settings").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#backup").click();
    const download = await downloadPromise;
    const backup = path.join(evidence, "backup.zip");
    await download.saveAs(backup);
    assert.ok((await stat(backup)).size > 5000);
    await page.locator("#close-dialog").click();
    await page.locator("#restore").setInputFiles(backup);
    await page.getByText("已恢复 7 本书及阅读记录", { exact: true }).waitFor();
    assert.equal(await page.locator(".book-card").count(), 7);
  });
  await page.screenshot({ path: path.join(evidence, "library.png") });
  await check("深色外观与小窗口适配", async () => {
    await page.locator("#theme-toggle").click();
    await page.screenshot({ path: path.join(evidence, "night.png") });
    await page.setViewportSize({ width: 780, height: 600 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("#theme-toggle").click();
  });
  await check("TXT 左右留白翻页、滚动切换和模式记忆", async () => {
    await page.setViewportSize({ width: 1280, height: 880 });
    await open("安静的阅读");
    await mode("paginated");
    const before = await page.locator("#page-label").textContent();
    const stage = await page.locator("#reader-canvas").boundingBox();
    await page.mouse.click(
      stage.x + stage.width - 25,
      stage.y + stage.height / 2,
    );
    await page.waitForTimeout(150);
    assert.notEqual(await page.locator("#page-label").textContent(), before);
    const fraction = Number(await page.locator("#progress").inputValue());
    await mode("scroll");
    assert.equal(await page.locator("#next").isVisible(), false);
    assert.ok(
      await page
        .locator("#reading-stage")
        .evaluate((el) => el.scrollHeight > el.clientHeight),
    );
    await page.locator("#reading-stage").evaluate((el) => {
      el.scrollTop = el.scrollHeight * 0.55;
    });
    await page.waitForTimeout(100);
    const scrollProgress = Number(await page.locator("#progress").inputValue());
    await mode("paginated");
    assert.ok(
      Math.abs(
        Number(await page.locator("#progress").inputValue()) - scrollProgress,
      ) < 3,
    );
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    await page.mouse.move(
      stage.x + stage.width - 25,
      stage.y + stage.height / 2,
    );
    await page.screenshot({ path: path.join(evidence, "pagination.png") });
    await back();
    await page.reload();
    await page.locator(".book-card").first().waitFor();
    await open("安静的阅读");
    assert.equal(
      await page.locator("#mode-paginated").getAttribute("aria-pressed"),
      "true",
    );
    assert.ok(Number(await page.locator("#progress").inputValue()) > fraction);
    await back();
  });
  await check("PDF 连续滚动、定位与翻页切换", async () => {
    await open("日常的诗意");
    await mode("scroll");
    assert.equal(await page.locator(".document-page").count(), 3);
    await page.locator("#reading-stage").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(100);
    await page.locator("#reading-stage").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.getByText("3 / 3 页", { exact: true }).waitFor();
    await mode("paginated");
    assert.equal(await page.locator(".pdf-page").count(), 1);
    assert.equal(await page.locator("#page-label").textContent(), "3 / 3 页");
    await page.locator("#prev").click();
    await page.getByText("2 / 3 页", { exact: true }).waitFor();
    await back();
  });
  await check("EPUB 连续滚动及左右留白翻页", async () => {
    await open("把时间留给阅读");
    await mode("scroll");
    await page.waitForFunction(() => {
      const el = document.querySelector(".epub-container");
      return el && el.scrollHeight > el.clientHeight;
    });
    await page.locator(".epub-container").evaluate((el) => {
      el.scrollTop += 400;
    });
    await page.waitForTimeout(500);
    await mode("paginated");
    await page.waitForTimeout(500);
    await page.locator("#progress").fill("0");
    await page.waitForTimeout(500);
    const before = Number(await page.locator("#progress").inputValue());
    const stage = await page.locator("#reader-canvas").boundingBox();
    await page.mouse.click(
      stage.x + stage.width - 25,
      stage.y + stage.height / 2,
    );
    await page.waitForTimeout(600);
    assert.ok(Number(await page.locator("#progress").inputValue()) > before);
    await back();
  });
  await check("漫画连续滚动与页面定位", async () => {
    await open("四季画册");
    await mode("scroll");
    assert.equal(await page.locator(".document-page").count(), 3);
    await page.locator("#reading-stage").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.getByText("3 / 3 页", { exact: true }).waitFor();
    await mode("paginated");
    await page.locator(".comic-page").waitFor();
    assert.equal(await page.locator("#page-label").textContent(), "3 / 3 页");
    await back();
  });
  await check("损坏 EPUB 导入后可继续操作", async () => {
    await page
      .locator("#files")
      .setInputFiles({
        name: "损坏.epub",
        mimeType: "application/epub+zip",
        buffer: Buffer.from("invalid archive"),
      });
    await page.getByRole("heading", { name: "部分书籍导入失败" }).waitFor();
    await page.locator("#close-dialog").click();
    assert.equal(await page.locator(".book-card").count(), 7);
    await page
      .locator("#files")
      .setInputFiles(path.join(fixtures, "安静的阅读.txt"));
    await page.getByText("已导入 0 本，已存在 1 本", { exact: true }).waitFor();
  });
  await check("无未处理的脚本错误", async () => assert.deepEqual(errors, []));
  await writeFile(
    path.join(evidence, "results.json"),
    JSON.stringify({ checks, errors, logs }, null, 2),
  );
} catch (error) {
  await page.screenshot({ path: path.join(evidence, "failure.png") });
  await writeFile(
    path.join(evidence, "failure.json"),
    JSON.stringify(
      {
        checks,
        errors,
        logs,
        error: error.stack,
        body: await page.locator("body").innerText(),
      },
      null,
      2,
    ),
  );
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}

import {
  createIcons,
  BookOpen,
  Library,
  Clock3,
  Heart,
  CircleCheck,
  Plus,
  Folder,
  HardDrive,
  Settings2,
  Search,
  SunMoon,
  Grid2x2,
  List,
  ArrowRight,
  Ellipsis,
  Leaf,
  X,
  Download,
  Upload,
  ChevronLeft,
  PanelLeft,
  Bookmark,
  Type,
  Maximize,
  ChevronRight,
  FileWarning,
} from "lucide";
import ePub from "epubjs";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { storage } from "./storage";
import "./style.css";
import "pdfjs-dist/web/pdf_viewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const icons = {
  BookOpen,
  Library,
  Clock3,
  Heart,
  CircleCheck,
  Plus,
  Folder,
  HardDrive,
  Settings2,
  Search,
  SunMoon,
  Grid2x2,
  List,
  ArrowRight,
  Ellipsis,
  Leaf,
  X,
  Download,
  Upload,
  ChevronLeft,
  PanelLeft,
  Bookmark,
  Type,
  Maximize,
  ChevronRight,
  FileWarning,
};
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [
  ...parent.querySelectorAll(selector),
];
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
const icon = (name, size = 20) =>
  `<i data-lucide="${name}" style="width:${size}px;height:${size}px" aria-hidden="true"></i>`;
const button = (name, title, id, extra = "") =>
  `<button class="icon-button ${extra}" id="${id}" aria-label="${title}" title="${title}">${icon(name)}</button>`;
const supported = ["epub", "pdf", "txt", "md", "markdown", "fb2", "cbz"];
const defaults = {
  theme: "paper",
  font: "serif",
  size: 21,
  line: 1.9,
  width: 760,
  mode: "paginated",
  sort: "recent",
  view: "grid",
};
let prefs = { ...defaults, ...(await storage.setting("preferences")) };
let collections = (await storage.setting("collections")) || [];
let books = await storage.books();
let filter = "all";
let query = "";
let reader = null;
let importing = false;
let activePanel = "";
let toastTimer;
let saveTimer;

function refreshIcons() {
  createIcons({ icons, attrs: { "stroke-width": 1.65 } });
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3800);
}
function applyTheme() {
  document.documentElement.dataset.theme = prefs.theme;
}
async function savePreferences() {
  await storage.saveSetting("preferences", prefs);
}
function savePosition() {
  if (!reader) return Promise.resolve();
  reader.book.lastRead = Date.now();
  return storage
    .saveBook(reader.book)
    .catch((error) => toast(`保存失败 · ${error.message}`));
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savePosition, 250);
}

function cover(book, large = false) {
  const hue = parseInt(book.id.slice(0, 4), 16) % 360 || 30;
  if (book.cover)
    return `<div class="cover ${large ? "large" : ""}"><img src="${escape(book.cover)}" alt="${escape(book.title)}的封面" loading="lazy"><span class="book-spine"></span></div>`;
  return `<div class="cover generated ${large ? "large" : ""}" style="--hue:${hue}"><span class="cover-rule"></span><span class="cover-title">${escape(book.title)}</span><span class="cover-author">${escape(book.author || "私人藏书")}</span><span class="cover-flower">✳</span><span class="cover-edition">${escape(book.format.toUpperCase())}</span><span class="book-spine"></span></div>`;
}
function filteredBooks() {
  let result = books.filter((book) => {
    const matches = `${book.title} ${book.author} ${book.filename}`
      .toLowerCase()
      .includes(query.toLowerCase());
    const inFilter =
      filter === "all" ||
      (filter === "recent" && book.lastRead) ||
      (filter === "favorites" && book.favorite) ||
      (filter === "finished" && book.finished) ||
      book.collection === filter;
    return matches && inFilter;
  });
  const compare = {
    recent: (a, b) => (b.lastRead || b.added) - (a.lastRead || a.added),
    title: (a, b) => a.title.localeCompare(b.title, "zh-CN"),
    added: (a, b) => b.added - a.added,
    author: (a, b) => (a.author || "").localeCompare(b.author || "", "zh-CN"),
  };
  return result.sort(compare[prefs.sort] || compare.recent);
}
function libraryTitle() {
  return (
    {
      all: "所有书籍",
      recent: "最近阅读",
      favorites: "我的收藏",
      finished: "已读完",
    }[filter] ||
    collections.find((item) => item.id === filter)?.name ||
    "所有书籍"
  );
}
function renderLibrary() {
  applyTheme();
  $("#app").innerHTML =
    `<div class="library-shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">${icon("book-open", 25)}</span><span>拾页<small>SHIYE READER</small></span></div><button class="import-button" id="import">${icon("plus", 18)} 导入书籍<span>Ctrl O</span></button><div class="nav-caption">书库</div><nav>${[
      ["all", "library", "所有书籍"],
      ["recent", "clock-3", "最近阅读"],
      ["favorites", "heart", "我的收藏"],
      ["finished", "circle-check", "已读完"],
    ]
      .map(
        ([id, name, label]) =>
          `<button data-filter="${id}" class="nav-item ${filter === id ? "active" : ""}">${icon(name, 19)}${label}<span>${books.filter((book) => id === "all" || (id === "recent" && book.lastRead) || (id === "favorites" && book.favorite) || (id === "finished" && book.finished)).length}</span></button>`,
      )
      .join(
        "",
      )}</nav><div class="nav-caption collection-heading">书单${button("plus", "新建书单", "new-collection")}</div><nav>${collections.map((item) => `<button class="nav-item ${filter === item.id ? "active" : ""}" data-filter="${item.id}">${icon("folder", 19)}<span class="collection-name">${escape(item.name)}</span><span>${books.filter((book) => book.collection === item.id).length}</span></button>`).join("")}</nav><div class="sidebar-bottom"><div class="local-note">${icon("hard-drive", 15)} 本地书库 · 离线阅读</div><button class="nav-item" id="settings">${icon("settings-2", 19)}偏好与备份</button></div></aside><main class="library-main"><header class="library-toolbar"><span class="breadcrumb">我的书库 <span>/</span> ${escape(libraryTitle())}</span><label class="search-box">${icon("search", 17)}<input id="library-search" placeholder="搜索书名、作者" aria-label="搜索书库" value="${escape(query)}"><kbd>Ctrl K</kbd></label>${button("sun-moon", "切换阅读主题", "theme-toggle")}</header><div class="library-content" id="library-content"></div></main></div>`;
  $("#import").onclick = () => $("#files").click();
  $$(".nav-item[data-filter]").forEach(
    (el) =>
      (el.onclick = () => {
        filter = el.dataset.filter;
        renderLibrary();
      }),
  );
  $("#library-search").oninput = (event) => {
    query = event.target.value;
    renderBooks();
  };
  $("#new-collection").onclick = createCollection;
  $("#settings").onclick = settingsDialog;
  $("#theme-toggle").onclick = async () => {
    prefs.theme = prefs.theme === "night" ? "paper" : "night";
    applyTheme();
    await savePreferences();
  };
  renderBooks();
}
function renderBooks() {
  const result = filteredBooks();
  const recent =
    !query &&
    filter === "all" &&
    books
      .filter((book) => book.lastRead && !book.finished)
      .sort((a, b) => b.lastRead - a.lastRead)[0];
  $("#library-content").innerHTML =
    `<div class="library-heading"><div><h1>${escape(libraryTitle())}</h1><p>${books.length ? `共 ${result.length} 本书` : "把喜欢的书，放在触手可及的地方。"}</p></div><div class="view-controls"><select id="sort" aria-label="书籍排序"><option value="recent">最近阅读</option><option value="added">最近添加</option><option value="title">按书名</option><option value="author">按作者</option></select><div class="segmented">${button("grid-2x2", "封面视图", "grid", prefs.view === "grid" ? "selected" : "")}${button("list", "列表视图", "list", prefs.view === "list" ? "selected" : "")}</div></div></div>${recent ? `<section class="continue-card"><div class="continue-cover">${cover(recent)}</div><div><span class="eyebrow">继续阅读</span><h2>${escape(recent.title)}</h2><p>${escape(recent.author || "私人藏书")}<span class="dot">·</span>已读 ${Math.round(recent.progress || 0)}%</p><button class="primary" id="continue">继续阅读 ${icon("arrow-right", 16)}</button></div><div class="continue-art" aria-hidden="true"><span></span><span></span><span></span></div></section>` : ""}<div class="section-heading"><h2>${query ? "搜索结果" : recent ? "书架" : "我的书架"}</h2><span>${result.length} 本书</span></div>${result.length ? `<div class="book-grid ${prefs.view === "list" ? "book-list" : ""}">${result.map((book) => `<article class="book-card" data-book="${book.id}"><button class="book-open" data-open="${book.id}" aria-label="阅读 ${escape(book.title)}">${cover(book)}<span class="cover-hover">${icon("book-open", 22)} 开始阅读</span></button><div class="book-info"><button class="book-title" data-open="${book.id}" title="${escape(book.title)}">${escape(book.title)}</button><div class="book-author">${escape(book.author || "未知作者")}</div><div class="book-meta"><span>${escape(book.format.toUpperCase())}</span><span>${book.finished ? "已读完" : book.lastRead ? `${Math.round(book.progress || 0)}%` : "未读"}</span>${book.favorite ? icon("heart", 12) : ""}</div><div class="progress-track"><span style="width:${Math.min(100, book.progress || 0)}%"></span></div></div><button class="book-menu icon-button" data-menu="${book.id}" aria-label="管理 ${escape(book.title)}">${icon("ellipsis", 20)}</button></article>`).join("")}</div>` : `<div class="empty-library"><div class="empty-illustration">${icon("book-open", 64)}</div><h2>${query ? "还没有找到这本书" : filter === "all" ? "从喜欢的第一本书开始" : "这里还有空位"}</h2><p>${query ? "换个书名或作者试试。" : "拖入书籍，或点击下方按钮导入。"}</p>${!query ? '<button class="primary" id="empty-import">选择本地书籍</button><span class="format-note">EPUB · PDF · TXT · Markdown · FB2 · CBZ</span>' : ""}</div>`}`;
  $("#sort").value = prefs.sort;
  $("#sort").onchange = async (event) => {
    prefs.sort = event.target.value;
    await savePreferences();
    renderBooks();
  };
  ["grid", "list"].forEach(
    (view) =>
      ($("#" + view).onclick = async () => {
        prefs.view = view;
        await savePreferences();
        renderBooks();
      }),
  );
  $$("[data-open]").forEach(
    (el) => (el.onclick = () => openBook(el.dataset.open)),
  );
  $$("[data-menu]").forEach(
    (el) => (el.onclick = () => bookDialog(el.dataset.menu)),
  );
  if ($("#continue")) $("#continue").onclick = () => openBook(recent.id);
  if ($("#empty-import"))
    $("#empty-import").onclick = () => $("#files").click();
  refreshIcons();
}

function dialog(title, content, setup) {
  const el = document.createElement("dialog");
  el.innerHTML = `<div class="dialog-heading"><h2>${escape(title)}</h2>${button("x", "关闭", "close-dialog")}</div>${content}`;
  document.body.append(el);
  $("#close-dialog", el).onclick = () => el.close();
  el.onclick = (event) => {
    if (event.target === el) el.close();
  };
  el.onclose = () => el.remove();
  el.showModal();
  refreshIcons();
  setup?.(el);
  return el;
}
function createCollection() {
  dialog(
    "新建书单",
    '<form id="collection-form"><label class="field-label" for="collection-name">书单名称</label><input class="text-field" id="collection-name" required maxlength="40" placeholder="例如，睡前读物"><button class="primary dialog-action">创建书单</button></form>',
    (el) => {
      $("form", el).onsubmit = async (event) => {
        event.preventDefault();
        const name = $("#collection-name", el).value.trim();
        if (!name) return;
        collections.push({ id: crypto.randomUUID(), name });
        await storage.saveSetting("collections", collections);
        el.close();
        renderLibrary();
      };
    },
  );
}
function bookDialog(id) {
  const book = books.find((item) => item.id === id);
  dialog(
    "管理书籍",
    `<div class="book-dialog-summary">${cover(book)}<div><h3>${escape(book.title)}</h3><p>${escape(book.author || "未知作者")}</p><small>${escape(book.filename)} · ${(book.size / 1048576).toFixed(1)} MB</small></div></div><label class="field-label" for="edit-title">书名</label><input id="edit-title" class="text-field" maxlength="300" value="${escape(book.title)}"><label class="field-label" for="edit-author">作者</label><input id="edit-author" class="text-field" maxlength="300" value="${escape(book.author)}"><label class="field-label" for="collection">所属书单</label><select id="collection" class="text-field"><option value="">未分类</option>${collections.map((item) => `<option value="${item.id}">${escape(item.name)}</option>`).join("")}</select><div class="check-row"><label><input id="favorite" type="checkbox" ${book.favorite ? "checked" : ""}> 收藏</label><label><input id="finished" type="checkbox" ${book.finished ? "checked" : ""}> 已读完</label></div><div class="dialog-buttons"><button class="danger" id="delete-book">移出书库</button><button class="secondary" id="export-book">导出原书</button><button class="primary" id="save-book">保存</button></div>`,
    (el) => {
      $("#collection", el).value = book.collection || "";
      $("#save-book", el).onclick = async () => {
        book.title = $("#edit-title", el).value.trim() || book.title;
        book.author = $("#edit-author", el).value.trim();
        book.favorite = $("#favorite", el).checked;
        book.finished = $("#finished", el).checked;
        book.collection = $("#collection", el).value;
        await storage.saveBook(book);
        el.close();
        renderLibrary();
      };
      $("#export-book", el).onclick = async () =>
        download(await storage.file(id), book.filename);
      $("#delete-book", el).onclick = () => {
        el.close();
        dialog(
          "移出书库",
          `<p>将《${escape(book.title)}》及其阅读记录从书库移除？</p><div class="dialog-buttons"><button class="secondary" id="cancel">取消</button><button class="danger" id="confirm">确认移除</button></div>`,
          (confirm) => {
            $("#cancel", confirm).onclick = () => confirm.close();
            $("#confirm", confirm).onclick = async () => {
              await storage.remove(id);
              books = books.filter((item) => item.id !== id);
              confirm.close();
              renderLibrary();
            };
          },
        );
      };
    },
  );
}
function settingsDialog() {
  dialog(
    "偏好与备份",
    `<div class="settings-section"><h3>阅读外观</h3>${themeOptions()}<p>外观设置同时应用于书库和阅读页面。</p></div><div class="settings-section"><h3>书库备份</h3><p>将原书、书单、书签和阅读进度一起导出为 ZIP 文件。</p><div class="dialog-buttons"><button class="secondary" id="backup">${icon("download", 16)} 导出备份</button><button class="secondary" id="restore-backup">${icon("upload", 16)} 恢复备份</button></div><small>恢复时按书籍 ID 合并，同一本书使用备份中的记录。</small></div>${collections.length ? `<div class="settings-section"><h3>管理书单</h3>${collections.map((item) => `<div class="manage-collection"><span>${escape(item.name)}</span><button class="text-button" data-remove-collection="${item.id}">删除书单</button></div>`).join("")}</div>` : ""}<div class="settings-section about"><span class="brand-mark">${icon("book-open", 24)}</span><div><h3>拾页 1.1</h3><p>为专注阅读而做。Windows 本地阅读器。</p><small>快捷键 · Ctrl O 导入 · Ctrl K 搜索 · F11 全屏<br>阅读时 ← → 翻页 · Ctrl F 书内搜索 · Esc 返回</small></div></div>`,
    (el) => {
      bindThemes(el);
      $("#backup", el).onclick = () => backupLibrary();
      $("#restore-backup", el).onclick = () => $("#restore").click();
      $$("[data-remove-collection]", el).forEach(
        (button) =>
          (button.onclick = async () => {
            const id = button.dataset.removeCollection;
            collections = collections.filter((item) => item.id !== id);
            await storage.saveSetting("collections", collections);
            for (const book of books.filter((item) => item.collection === id)) {
              book.collection = "";
              await storage.saveBook(book);
            }
            el.close();
            renderLibrary();
            settingsDialog();
          }),
      );
    },
  );
}
function download(data, name) {
  const url = URL.createObjectURL(
    data instanceof Blob ? data : new Blob([data]),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function backupLibrary() {
  if (importing) {
    toast("请等待书籍导入完成");
    return;
  }
  try {
    toast("正在整理书库备份…");
    await savePosition();
    const zip = new JSZip();
    const snapshot = books.map((book) => ({ ...book }));
    zip.file(
      "library.json",
      JSON.stringify({
        version: 1,
        books: snapshot,
        preferences: prefs,
        collections,
      }),
    );
    for (const book of snapshot)
      zip.file(`books/${book.id}`, await storage.file(book.id));
    download(
      await zip.generateAsync({ type: "blob", compression: "STORE" }),
      `拾页备份-${new Date().toISOString().slice(0, 10)}.zip`,
    );
    toast("备份已生成");
  } catch (error) {
    toast(`备份失败 · ${error.message}`);
  }
}
async function restoreLibrary(file) {
  if (importing || reader) {
    toast("请先回到书库，并等待导入完成");
    return;
  }
  importing = true;
  try {
    const zip = await JSZip.loadAsync(file);
    const metadata = zip.file("library.json");
    if (!metadata) throw new Error("请选择拾页导出的备份");
    const data = JSON.parse(await metadata.async("string"));
    if (
      data.version !== 1 ||
      !Array.isArray(data.books) ||
      !Array.isArray(data.collections)
    )
      throw new Error("备份格式不兼容");
    const files = [];
    for (const book of data.books) {
      if (
        !/^[a-f0-9]{64}$/.test(book.id) ||
        !supported.includes(book.format) ||
        typeof book.title !== "string" ||
        !Array.isArray(book.bookmarks)
      )
        throw new Error("书籍记录不完整");
      const entry = zip.file(`books/${book.id}`);
      if (!entry) throw new Error(`缺少书籍 ${book.title}`);
      const blob = await entry.async("blob");
      if ((await digest(await blob.arrayBuffer())) !== book.id)
        throw new Error(`书籍校验失败 ${book.title}`);
      if (
        book.cover &&
        !/^data:image\/(png|jpeg|webp|gif);base64,/.test(book.cover)
      )
        book.cover = "";
      files.push(blob);
    }
    const mergedCollections = [
      ...new Map(
        [...collections, ...data.collections]
          .filter(
            (item) =>
              typeof item.id === "string" && typeof item.name === "string",
          )
          .map((item) => [item.id, item]),
      ).values(),
    ];
    await storage.restore(data.books, files, {
      collections: mergedCollections,
    });
    collections = mergedCollections;
    books = await storage.books();
    renderLibrary();
    toast(`已恢复 ${data.books.length} 本书及阅读记录`);
  } catch (error) {
    toast(`恢复失败 · ${error.message}`);
  } finally {
    importing = false;
  }
}

async function digest(data) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
function decodeText(data) {
  const bytes = new Uint8Array(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}
async function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const file = new FileReader();
    file.onload = () => resolve(file.result);
    file.onerror = () => reject(file.error);
    file.readAsDataURL(blob);
  });
}
async function importFiles(files) {
  if (importing) {
    toast("正在导入，请稍候");
    return;
  }
  if (reader) {
    toast("请先返回书库再导入");
    return;
  }
  importing = true;
  let count = 0;
  let duplicates = 0;
  const failures = [];
  for (const file of files) {
    const format = file.name.split(".").pop().toLowerCase();
    if (!supported.includes(format)) {
      failures.push(`${file.name}：格式暂未支持`);
      continue;
    }
    if (file.size > 512 * 1048576) {
      failures.push(`${file.name}：单本上限 512 MB`);
      continue;
    }
    toast(`正在导入 ${file.name}`);
    try {
      const buffer = await file.arrayBuffer();
      const id = await digest(buffer);
      if (books.some((book) => book.id === id)) {
        duplicates++;
        continue;
      }
      const book = {
        id,
        title: file.name.replace(/\.[^.]+$/, ""),
        author: "",
        filename: file.name,
        format,
        size: file.size,
        added: Date.now(),
        progress: 0,
        lastRead: 0,
        bookmarks: [],
        favorite: false,
        finished: false,
        collection: "",
      };
      if (format === "epub") {
        const epub = ePub();
        try {
          await epub.open(buffer.slice(0));
          await Promise.all([epub.ready, epub.opened]);
          const metadata = await epub.loaded.metadata;
          book.title = metadata.title || book.title;
          book.author = metadata.creator || "";
          const coverUrl = await epub.coverUrl();
          if (coverUrl) {
            const coverBlob = await (await fetch(coverUrl)).blob();
            if (
              coverBlob.size < 4 * 1048576 &&
              coverBlob.type.startsWith("image/")
            )
              book.cover = await dataUrl(coverBlob);
          }
        } finally {
          epub.destroy();
        }
      } else if (format === "pdf") {
        const task = pdfjs.getDocument({
          data: buffer.slice(0),
          isEvalSupported: false,
          cMapUrl: "./cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "./standard_fonts/",
        });
        task.onPassword = (update, reason) => {
          dialog(
            "PDF 需要密码",
            `<form><input class="text-field" id="import-password" type="password" required placeholder="${reason === 2 ? "密码有误，请重试" : "输入文档密码"}" aria-label="PDF 密码"><button class="primary dialog-action">继续导入</button></form>`,
            (el) => {
              let submitted = false;
              $("form", el).onsubmit = (event) => {
                event.preventDefault();
                submitted = true;
                update($("#import-password", el).value);
                el.close();
              };
              el.addEventListener("close", () => {
                if (!submitted) task.destroy();
              });
            },
          );
        };
        try {
          const pdf = await task.promise;
          book.pages = pdf.numPages;
          const metadata = await pdf.getMetadata();
          if (metadata.info.Title?.trim()) book.title = metadata.info.Title;
          book.author = metadata.info.Author || "";
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 0.45 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({
            canvasContext: canvas.getContext("2d"),
            viewport,
          }).promise;
          book.cover = canvas.toDataURL("image/jpeg", 0.75);
        } finally {
          await task.destroy();
        }
      } else if (format === "cbz") {
        const archive = await JSZip.loadAsync(buffer);
        const pages = Object.values(archive.files)
          .filter(
            (entry) =>
              !entry.dir && /\.(png|jpe?g|webp|gif)$/i.test(entry.name),
          )
          .sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true }),
          );
        if (!pages.length) throw new Error("压缩包内没有可阅读的图片");
        book.pages = pages.length;
        const blob = await pages[0].async("blob");
        book.cover = await thumbnail(blob);
      } else if (format === "fb2") {
        const xml = new DOMParser().parseFromString(
          decodeText(buffer),
          "application/xml",
        );
        if (xml.querySelector("parsererror"))
          throw new Error("FB2 文件格式损坏");
        book.title =
          xml.querySelector("title-info > book-title")?.textContent ||
          book.title;
        book.author = [...xml.querySelectorAll("title-info > author")]
          .map((author) =>
            [...author.children].map((item) => item.textContent).join(" "),
          )
          .join(" / ");
      }
      await storage.importBook(
        book,
        new Blob([buffer], { type: file.type || "application/octet-stream" }),
      );
      books.push(book);
      count++;
    } catch (error) {
      failures.push(`${file.name}：${error.message}`);
    }
  }
  importing = false;
  renderLibrary();
  toast(
    `已导入 ${count} 本${duplicates ? `，已存在 ${duplicates} 本` : ""}${failures.length ? `，失败 ${failures.length} 本` : ""}`,
  );
  if (failures.length)
    dialog(
      "部分书籍导入失败",
      `<div class="import-errors">${failures.map((message) => `<p>${escape(message)}</p>`).join("")}</div>`,
    );
}
async function thumbnail(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = (240 * bitmap.height) / bitmap.width;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.75);
}

function readerShell(book) {
  $("#app").innerHTML =
    `<div class="reader-shell"><header class="reader-toolbar"><div class="reader-left">${button("chevron-left", "返回书库（Esc）", "back")}<span class="toolbar-divider"></span>${button("panel-left", "目录与书签", "contents")}<div class="reader-title"><strong>${escape(book.title)}</strong><small>${escape(book.author || book.format.toUpperCase())}</small></div></div><div class="reader-actions"><div class="reading-mode-switch" role="group" aria-label="阅读模式"><button id="mode-paginated" aria-pressed="false">翻页</button><button id="mode-scroll" aria-pressed="false">滚动</button></div>${button("search", "书内搜索（Ctrl F）", "search-reader")}${button("bookmark", "添加书签", "bookmark")}${button("type", "阅读外观", "appearance")}${button("maximize", "全屏（F11）", "fullscreen")}</div></header><div class="reader-body"><aside id="reader-panel" class="reader-panel" hidden></aside><div class="reader-canvas" id="reader-canvas"><main class="reading-stage" id="reading-stage"><div id="book-viewport"></div><div class="loading" id="loading"><span class="spinner"></span>正在打开书籍…</div></main><button class="page-turn-zone page-turn-left" id="prev" aria-label="上一页" title="点击左侧留白翻到上一页">${icon("chevron-left", 25)}</button><button class="page-turn-zone page-turn-right" id="next" aria-label="下一页" title="点击右侧留白翻到下一页">${icon("chevron-right", 25)}</button></div></div><footer class="reader-footer"><div class="reading-progress"><span id="chapter-label">阅读中</span><input id="progress" type="range" min="0" max="100" step="0.1" value="${book.progress || 0}" aria-label="阅读进度"><span id="page-label">${Math.round(book.progress || 0)}%</span></div></footer></div>`;
  $("#back").onclick = closeReader;
  $("#contents").onclick = () => togglePanel("contents");
  $("#search-reader").onclick = () => togglePanel("search");
  $("#appearance").onclick = () => togglePanel("appearance");
  $("#bookmark").onclick = addBookmark;
  $("#fullscreen").onclick = toggleFullscreen;
  $("#prev").onclick = () => turnPage(-1);
  $("#next").onclick = () => turnPage(1);
  $("#mode-paginated").onclick = () => setReadingMode("paginated");
  $("#mode-scroll").onclick = () => setReadingMode("scroll");
  syncReadingMode();
  $("#progress").onchange = (event) => seek(Number(event.target.value) / 100);
  refreshIcons();
  applyReadingStyle();
}
async function openBook(id) {
  if (importing) {
    toast("请等待导入完成");
    return;
  }
  if (reader) return;
  const book = books.find((item) => item.id === id);
  if (!book) return;
  const session = {
    book,
    type: book.format,
    token: crypto.randomUUID(),
    toc: [],
    urls: [],
    page: 1,
    busy: false,
  };
  reader = session;
  activePanel = "";
  readerShell(book);
  try {
    const data = await storage.file(id);
    if (!data) throw new Error("本地书籍文件缺失，请重新导入");
    if (reader !== session) return;
    if (book.format === "epub") await openEpub(data, session);
    else if (book.format === "pdf") await openPdf(data, session);
    else if (book.format === "cbz") await openComic(data, session);
    else await openText(data, session);
    if (reader !== session) return;
    $("#loading")?.remove();
    session.ready = true;
    syncReadingMode();
    book.lastRead = Date.now();
    await savePosition();
  } catch (error) {
    if (reader !== session) return;
    $("#loading")?.remove();
    $("#book-viewport").innerHTML =
      `<div class="reading-error">${icon("file-warning", 40)}<h2>这本书暂时无法打开</h2><p>${escape(error.message)}</p><button class="primary" id="error-back">返回书库</button></div>`;
    $("#error-back").onclick = closeReader;
    refreshIcons();
  }
}
function applyReadingStyle() {
  applyTheme();
  const stage = $("#reading-stage");
  if (!stage) return;
  stage.style.setProperty("--reading-size", `${prefs.size}px`);
  stage.style.setProperty("--reading-line", prefs.line);
  stage.style.setProperty("--reading-width", `${prefs.width}px`);
  if (reader?.textReady) queueTextLayout();
  stage.style.setProperty(
    "--reading-font",
    prefs.font === "sans"
      ? '"Microsoft YaHei", "Segoe UI", sans-serif'
      : '"Georgia", "Source Han Serif SC", "SimSun", serif',
  );
  if (reader?.rendition) {
    const colors = themeColors();
    reader.rendition.themes.default({
      body: {
        color: `${colors.text} !important`,
        background: "transparent !important",
        "font-family":
          prefs.font === "sans"
            ? '"Microsoft YaHei", sans-serif !important'
            : 'Georgia, "SimSun", serif !important',
        "font-size": `${prefs.size}px !important`,
        "line-height": `${prefs.line} !important`,
        padding: "12px 30px !important",
      },
      p: { "line-height": `${prefs.line} !important` },
      img: { "max-width": "100% !important", height: "auto !important" },
    });
  }
}
function themeColors() {
  return (
    {
      paper: { text: "#373a35", bg: "#faf8f3" },
      light: { text: "#292b2a", bg: "#fff" },
      sepia: { text: "#534736", bg: "#f1e5cf" },
      night: { text: "#c9c9c2", bg: "#202322" },
    }[prefs.theme] || { text: "#373a35", bg: "#faf8f3" }
  );
}
async function closeReader() {
  const current = reader;
  if (!current) return;
  clearTimeout(saveTimer);
  await savePosition();
  reader = null;
  activePanel = "";
  current.observer?.disconnect();
  $$(".document-page img").forEach((image) => URL.revokeObjectURL(image.src));
  current.epub?.destroy();
  await current.pdf?.destroy();
  current.urls.forEach((url) => URL.revokeObjectURL(url));
  renderLibrary();
}
function updateProgress(progress, label, chapter = "") {
  if (!reader) return;
  reader.book.progress = Math.max(0, Math.min(100, progress || 0));
  $("#progress").value = reader.book.progress;
  $("#page-label").textContent =
    label || `${Math.round(reader.book.progress)}%`;
  $("#chapter-label").textContent = chapter || reader.book.title;
  $("#bookmark").classList.toggle(
    "selected",
    reader.book.bookmarks.some(
      (item) =>
        JSON.stringify(item.position) === JSON.stringify(reader.book.position),
    ),
  );
  scheduleSave();
}
async function openEpub(data, session) {
  session.epub = ePub();
  session.epub.spine.hooks.content.register((doc) => {
    doc
      .querySelectorAll("script,iframe,object,embed,form")
      .forEach((el) => el.remove());
    doc.querySelectorAll("*").forEach((el) =>
      [...el.attributes].forEach((attr) => {
        if (
          /^on/i.test(attr.name) ||
          (/^(href|src)$/i.test(attr.name) && /^javascript:/i.test(attr.value))
        )
          el.removeAttribute(attr.name);
      }),
    );
  });
  await session.epub.open(await data.arrayBuffer());
  await session.epub.ready;
  if (reader !== session) {
    session.epub.destroy();
    return;
  }
  session.rendition = session.epub.renderTo("book-viewport", {
    width: "100%",
    height: "100%",
    spread: "none",
    manager: "continuous",
    flow: prefs.mode === "scroll" ? "scrolled-continuous" : "paginated",
    allowScriptedContent: false,
  });
  applyReadingStyle();
  session.rendition.on("relocated", (location) => {
    if (reader !== session) return;
    session.book.position = location.start.cfi;
    const item = session.epub.spine.get(location.start.index);
    const chapter = session.toc.find(
      (entry) => entry.href?.split("#")[0] === item?.href,
    );
    const percentage = session.epub.locations.length()
      ? session.epub.locations.percentageFromCfi(location.start.cfi) * 100
      : ((location.start.index +
          (location.start.displayed.page - 1) /
            location.start.displayed.total) /
          session.epub.spine.length) *
        100;
    updateProgress(
      location.atEnd ? 100 : percentage,
      `${Math.round(location.atEnd ? 100 : percentage)}%`,
      chapter?.label,
    );
  });
  session.rendition.on("keyup", (event) => handleKeys(event));
  session.rendition.on("click", (event) => {
    const link = event.target.closest?.("a");
    if (link && /^https?:/.test(link.href)) {
      event.preventDefault();
      window.open(link.href, "_blank", "noopener");
    }
  });
  const navigation = await session.epub.loaded.navigation;
  session.toc = flattenToc(navigation.toc);
  await session.rendition.display(session.book.position || undefined);
  session.epub.locations
    .generate(1800)
    .then(() => {
      if (reader === session) {
        session.locationsReady = true;
        const location = session.rendition.currentLocation();
        if (location?.start)
          updateProgress(
            session.epub.locations.percentageFromCfi(location.start.cfi) * 100,
          );
      }
    })
    .catch(() => {});
}
function flattenToc(entries, depth = 0) {
  return entries.flatMap((entry) => [
    { label: entry.label.trim(), href: entry.href, depth },
    ...flattenToc(entry.subitems || [], depth + 1),
  ]);
}
async function openPdf(data, session) {
  const task = pdfjs.getDocument({
    data: await data.arrayBuffer(),
    isEvalSupported: false,
    cMapUrl: "./cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "./standard_fonts/",
  });
  task.onPassword = (update, reason) => {
    dialog(
      "PDF 需要密码",
      `<form><input class="text-field" id="pdf-password" type="password" required placeholder="${reason === 2 ? "密码有误，请重试" : "输入文档密码"}" aria-label="PDF 密码"><button class="primary dialog-action">打开文档</button></form>`,
      (el) => {
        let submitted = false;
        $("form", el).onsubmit = (event) => {
          event.preventDefault();
          submitted = true;
          update($("#pdf-password", el).value);
          el.close();
        };
        el.addEventListener("close", () => {
          if (!submitted) {
            task.destroy();
            closeReader();
          }
        });
      },
    );
  };
  session.pdf = await task.promise;
  if (reader !== session) {
    session.pdf.destroy();
    return;
  }
  session.page = Math.min(
    session.pdf.numPages,
    Math.max(1, Number(session.book.position) || 1),
  );
  session.zoom = 1;
  const outline = await session.pdf.getOutline();
  const collect = (entries, depth = 0) =>
    entries.flatMap((item) => [
      { label: item.title, dest: item.dest, depth },
      ...collect(item.items || [], depth + 1),
    ]);
  session.toc = outline ? collect(outline) : [];
  await renderPdfPage();
}
async function createPdfPage(session, number) {
  const page = await session.pdf.getPage(number);
  if (reader !== session) return null;
  const unit = page.getViewport({ scale: 1 });
  const available = $("#reading-stage").clientWidth - 200;
  const scale = Math.min(available / unit.width, 1.6) * (session.zoom || 1);
  const viewport = page.getViewport({ scale });
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-page";
  wrapper.style.width = `${viewport.width}px`;
  wrapper.style.height = `${viewport.height}px`;
  wrapper.style.setProperty("--scale-factor", scale);
  const canvas = document.createElement("canvas");
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * ratio);
  canvas.height = Math.floor(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  wrapper.append(canvas);
  const layer = document.createElement("div");
  layer.className = "textLayer";
  wrapper.append(layer);
  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
  }).promise;
  if (reader !== session) return null;
  await new pdfjs.TextLayer({
    textContentSource: await page.getTextContent(),
    container: layer,
    viewport,
  }).render();
  return wrapper;
}
async function renderPdfPage() {
  const session = reader;
  if (!session?.pdf || session.busy) return;
  if (prefs.mode === "scroll") {
    if (!session.scrollLayout) await renderDocumentScroll(session);
    else scrollToDocumentPage(session.page);
    return;
  }
  session.busy = true;
  try {
    const wrapper = await createPdfPage(session, session.page);
    if (reader !== session || !wrapper) return;
    $("#book-viewport").replaceChildren(wrapper);
    $("#book-viewport").className = "pdf-viewport";
    $("#reading-stage").scrollTop = 0;
    session.book.position = session.page;
    updateDocumentProgress();
  } finally {
    session.busy = false;
  }
}
function updateDocumentProgress() {
  const session = reader;
  const count = session.pdf?.numPages || session.images?.length || 1;
  session.book.position = session.page;
  updateProgress((session.page / count) * 100, `${session.page} / ${count} 页`);
  $("#prev").disabled = session.page === 1;
  $("#next").disabled = session.page === count;
}
async function renderDocumentScroll(session) {
  session.observer?.disconnect();
  $$(".document-page img").forEach((image) => URL.revokeObjectURL(image.src));
  session.layoutVersion = (session.layoutVersion || 0) + 1;
  const version = session.layoutVersion;
  const count = session.pdf?.numPages || session.images.length;
  const stage = $("#reading-stage");
  const viewport = $("#book-viewport");
  stage.onscroll = null;
  viewport.className = "document-scroll";
  viewport.replaceChildren();
  let ratio = 1.414;
  if (session.pdf) {
    const first = await session.pdf.getPage(1);
    const size = first.getViewport({ scale: 1 });
    ratio = size.height / size.width;
  }
  if (reader !== session) return;
  const width = Math.min(stage.clientWidth - 200, 950) * (session.zoom || 1);
  session.pageElements = Array.from({ length: count }, (_, index) => {
    const placeholder = document.createElement("div");
    placeholder.className = "document-page";
    placeholder.dataset.page = index + 1;
    placeholder.style.width = `${width}px`;
    placeholder.style.height = `${width * ratio}px`;
    placeholder.setAttribute("aria-label", `第 ${index + 1} 页`);
    viewport.append(placeholder);
    return placeholder;
  });
  session.scrollLayout = true;
  async function loadPage(element) {
    if (element.loading) return element.loading;
    if (element.childElementCount) return;
    element.loading = (async () => {
      try {
        let content;
        if (session.pdf) {
          content = await createPdfPage(session, Number(element.dataset.page));
        } else {
          const blob =
            await session.images[Number(element.dataset.page) - 1].async(
              "blob",
            );
          if (reader !== session || version !== session.layoutVersion) return;
          content = document.createElement("img");
          content.className = "comic-page";
          content.alt = element.getAttribute("aria-label");
          content.src = URL.createObjectURL(blob);
          await content.decode();
          if (reader !== session || version !== session.layoutVersion) {
            URL.revokeObjectURL(content.src);
            return;
          }
        }
        if (!content || reader !== session || version !== session.layoutVersion)
          return;
        element.replaceChildren(content);
        const contentWidth = session.pdf
          ? parseFloat(content.style.width)
          : width;
        const height = session.pdf
          ? parseFloat(content.style.height)
          : (width * content.naturalHeight) / content.naturalWidth;
        element.style.width = `${contentWidth}px`;
        element.style.height = `${height}px`;
      } catch (error) {
        if (reader === session && version === session.layoutVersion) {
          element.textContent = `页面加载失败 · ${error.message}`;
        }
      } finally {
        element.loading = null;
      }
    })();
    return element.loading;
  }
  session.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target;
        if (entry.isIntersecting) loadPage(element);
        else if (!element.loading) {
          const image = $("img", element);
          if (image) URL.revokeObjectURL(image.src);
          element.replaceChildren();
        }
      }
    },
    { root: stage, rootMargin: "1000px 0px" },
  );
  session.pageElements.forEach((element) => session.observer.observe(element));
  await loadPage(session.pageElements[session.page - 1]);
  if (reader !== session || version !== session.layoutVersion) return;
  scrollToDocumentPage(session.page);
  stage.onscroll = () => {
    if (session.scrollFrame) return;
    session.scrollFrame = requestAnimationFrame(() => {
      session.scrollFrame = null;
      if (
        reader !== session ||
        prefs.mode !== "scroll" ||
        version !== session.layoutVersion
      )
        return;
      const offset =
        stage.scrollTop + stage.clientHeight * 0.2 - viewport.offsetTop;
      let low = 0;
      let high = count - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const element = session.pageElements[middle];
        if (element.offsetTop + element.offsetHeight < offset) low = middle + 1;
        else high = middle;
      }
      session.page = low + 1;
      updateDocumentProgress();
    });
  };
}
function scrollToDocumentPage(page) {
  const session = reader;
  const element = session.pageElements?.[page - 1];
  if (!element) return;
  const stage = $("#reading-stage");
  stage.scrollTop = element.offsetTop + $("#book-viewport").offsetTop;
  updateDocumentProgress();
}
async function openComic(data, session) {
  session.zip = await JSZip.loadAsync(data);
  session.images = Object.values(session.zip.files)
    .filter(
      (entry) => !entry.dir && /\.(png|jpe?g|webp|gif)$/i.test(entry.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  session.page = Math.min(
    session.images.length,
    Math.max(1, Number(session.book.position) || 1),
  );
  session.toc = session.images.map((entry, index) => ({
    label: `第 ${index + 1} 页 · ${entry.name.split("/").pop()}`,
    page: index + 1,
    depth: 0,
  }));
  await renderComicPage();
}
async function renderComicPage() {
  const session = reader;
  if (!session?.images || session.busy) return;
  if (prefs.mode === "scroll") {
    if (!session.scrollLayout) await renderDocumentScroll(session);
    else scrollToDocumentPage(session.page);
    return;
  }
  session.busy = true;
  try {
    session.urls.forEach((url) => URL.revokeObjectURL(url));
    session.urls = [];
    const url = URL.createObjectURL(
      await session.images[session.page - 1].async("blob"),
    );
    session.urls.push(url);
    if (reader !== session) {
      URL.revokeObjectURL(url);
      return;
    }
    $("#book-viewport").className = "comic-viewport";
    $("#book-viewport").innerHTML =
      `<img class="comic-page" src="${url}" alt="第 ${session.page} 页">`;
    $("#reading-stage").scrollTop = 0;
    session.book.position = session.page;
    updateDocumentProgress();
  } finally {
    session.busy = false;
  }
}
async function openText(data, session) {
  const text = decodeText(await data.arrayBuffer());
  if (reader !== session) return;
  let html;
  if (["md", "markdown"].includes(session.type))
    html = DOMPurify.sanitize(marked.parse(text));
  else if (session.type === "fb2") {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("FB2 文件格式损坏");
    function convert(node) {
      if (node.nodeType === 3) return escape(node.textContent);
      const name = node.localName;
      const tags = {
        section: "section",
        title: "h2",
        subtitle: "h3",
        p: "p",
        emphasis: "em",
        strong: "strong",
        epigraph: "blockquote",
        cite: "blockquote",
        "empty-line": "br",
        poem: "blockquote",
        v: "p",
        stanza: "section",
      };
      if (name === "image") {
        const id = (
          node.getAttribute("l:href") ||
          node.getAttribute("xlink:href") ||
          node.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
          ""
        ).replace(/^#/, "");
        const binary = [...xml.querySelectorAll("binary")].find(
          (item) => item.getAttribute("id") === id,
        );
        const mime = binary?.getAttribute("content-type") || "";
        if (binary && /^image\/(png|jpeg|gif|webp)$/.test(mime))
          return `<img src="data:${mime};base64,${binary.textContent.replace(/\s/g, "")}" alt="书中插图">`;
        return "";
      }
      const content = [...node.childNodes].map(convert).join("");
      return tags[name] ? `<${tags[name]}>${content}</${tags[name]}>` : content;
    }
    html = [...xml.querySelectorAll("FictionBook > body")]
      .map(convert)
      .join("");
  } else {
    html = text
      .split(/\r?\n/)
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "";
        return /^(第[零一二三四五六七八九十百千万\d]+[章节卷部篇回]|chapter\s+\w+|序[言章]?\s*$|前言\s*$|后记\s*$)/i.test(
          trimmed,
        ) && trimmed.length < 70
          ? `<h2>${escape(trimmed)}</h2>`
          : `<p>${escape(trimmed)}</p>`;
      })
      .join("");
  }
  $("#book-viewport").className = "text-viewport";
  $("#book-viewport").innerHTML =
    `<article class="text-book"><h1>${escape(session.book.title)}</h1>${html}</article>`;
  $$(".text-book img").forEach((img) => {
    if (!/^data:image\//.test(img.getAttribute("src") || "")) img.remove();
  });
  $$(".text-book a").forEach((a) => {
    a.target = "_blank";
    a.rel = "noopener";
  });
  session.toc = $$(".text-book h1,.text-book h2,.text-book h3").map(
    (el, index) => {
      el.id = `heading-${index}`;
      return {
        label: el.textContent,
        href: el.id,
        depth: el.tagName === "H3" ? 1 : 0,
      };
    },
  );
  session.textReady = true;
  layoutText(Number(session.book.position) || 0);
}
function syncReadingMode() {
  if (!reader) return;
  $("#reader-canvas").dataset.mode = prefs.mode;
  for (const mode of ["paginated", "scroll"]) {
    const control = $("#mode-" + mode);
    control.setAttribute("aria-pressed", String(mode === prefs.mode));
    control.disabled = !reader.ready || Boolean(reader.switching);
  }
}
async function setReadingMode(mode) {
  const session = reader;
  if (!session?.ready || session.switching || mode === prefs.mode) return;
  if (session.busy) {
    toast("页面加载中，请稍候");
    return;
  }
  session.switching = true;
  session.layoutVersion = (session.layoutVersion || 0) + 1;
  const position = session.book.position;
  prefs.mode = mode;
  syncReadingMode();
  try {
    session.observer?.disconnect();
    $$(".document-page img").forEach((image) => URL.revokeObjectURL(image.src));
    $("#reading-stage").onscroll = null;
    if (session.rendition) {
      session.rendition.flow(
        mode === "scroll" ? "scrolled-continuous" : "paginated",
      );
      await session.rendition.display(position);
    } else if (session.pdf) {
      session.scrollLayout = false;
      await renderPdfPage();
    } else if (session.images) {
      session.scrollLayout = false;
      await renderComicPage();
    } else {
      layoutText(Number(position) || 0);
    }
    await savePreferences();
    await savePosition();
  } catch (error) {
    toast(`切换阅读模式失败 · ${error.message}`);
  } finally {
    if (reader === session) {
      session.switching = false;
      syncReadingMode();
    }
  }
}
function queueTextLayout() {
  const session = reader;
  if (!session?.textReady || session.layoutFrame) return;
  const position = Number(session.book.position) || 0;
  session.layoutFrame = requestAnimationFrame(() => {
    session.layoutFrame = null;
    if (reader === session) layoutText(position);
  });
}
function layoutText(position) {
  const session = reader;
  if (!session?.textReady) return;
  const stage = $("#reading-stage");
  const viewport = $("#book-viewport");
  const article = $(".text-book");
  stage.onscroll = null;
  viewport.onscroll = null;
  if (prefs.mode === "paginated") {
    stage.scrollTop = 0;
    article.style.columnWidth = `${viewport.clientWidth - 80}px`;
    session.textPages = Math.max(
      1,
      Math.ceil((article.scrollWidth - 1) / viewport.clientWidth),
    );
    session.textPage = Math.round(position * (session.textPages - 1));
    viewport.scrollLeft = session.textPage * viewport.clientWidth;
    updateProgress(
      session.textPages > 1
        ? (session.textPage / (session.textPages - 1)) * 100
        : 0,
      `${session.textPage + 1} / ${session.textPages} 页`,
    );
    session.book.position =
      session.textPages > 1 ? session.textPage / (session.textPages - 1) : 0;
    $("#prev").disabled = session.textPage === 0;
    $("#next").disabled = session.textPage === session.textPages - 1;
  } else {
    article.style.columnWidth = "auto";
    viewport.scrollLeft = 0;
    stage.scrollTop =
      position * Math.max(0, stage.scrollHeight - stage.clientHeight);
    stage.onscroll = updateTextProgress;
    updateTextProgress();
  }
}
function updateTextProgress() {
  if (!reader?.textReady || prefs.mode !== "scroll") return;
  const stage = $("#reading-stage");
  const maximum = stage.scrollHeight - stage.clientHeight;
  const fraction = maximum > 0 ? stage.scrollTop / maximum : 0;
  reader.book.position = fraction;
  updateProgress(fraction * 100, `${Math.round(fraction * 100)}%`);
}
function goToTextPage(page) {
  if (!reader?.textReady) return;
  reader.textPage = Math.max(0, Math.min(reader.textPages - 1, page));
  const viewport = $("#book-viewport");
  viewport.scrollLeft = reader.textPage * viewport.clientWidth;
  reader.book.position =
    reader.textPages > 1 ? reader.textPage / (reader.textPages - 1) : 0;
  updateProgress(
    reader.book.position * 100,
    `${reader.textPage + 1} / ${reader.textPages} 页`,
  );
  $("#prev").disabled = reader.textPage === 0;
  $("#next").disabled = reader.textPage === reader.textPages - 1;
}
function revealTextElement(element) {
  if (prefs.mode === "scroll") {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const viewport = $("#book-viewport");
  const offset =
    element.getBoundingClientRect().left -
    viewport.getBoundingClientRect().left +
    viewport.scrollLeft;
  goToTextPage(Math.floor(offset / viewport.clientWidth));
}
async function turnPage(direction) {
  const session = reader;
  if (!session) return;
  try {
    if (session.rendition)
      await (direction > 0
        ? session.rendition.next()
        : session.rendition.prev());
    else if (session.pdf) {
      if (session.busy) return;
      session.page = Math.max(
        1,
        Math.min(session.pdf.numPages, session.page + direction),
      );
      await renderPdfPage();
    } else if (session.images) {
      if (session.busy) return;
      session.page = Math.max(
        1,
        Math.min(session.images.length, session.page + direction),
      );
      await renderComicPage();
    } else if (prefs.mode === "paginated")
      goToTextPage(session.textPage + direction);
    else
      $("#reading-stage").scrollBy({
        top: direction * $("#reading-stage").clientHeight * 0.85,
        behavior: "smooth",
      });
  } catch (error) {
    toast(`翻页失败 · ${error.message}`);
  }
}
async function seek(fraction) {
  if (!reader) return;
  if (reader.rendition) {
    if (reader.locationsReady)
      await reader.rendition.display(
        reader.epub.locations.cfiFromPercentage(Math.min(0.999, fraction)),
      );
    else {
      const index = Math.min(
        reader.epub.spine.length - 1,
        Math.floor(fraction * reader.epub.spine.length),
      );
      await reader.rendition.display(reader.epub.spine.get(index).href);
    }
  } else if (reader.pdf) {
    if (reader.busy) return;
    reader.page = Math.max(1, Math.ceil(fraction * reader.pdf.numPages));
    await renderPdfPage();
  } else if (reader.images) {
    if (reader.busy) return;
    reader.page = Math.max(1, Math.ceil(fraction * reader.images.length));
    await renderComicPage();
  } else if (prefs.mode === "paginated")
    goToTextPage(Math.round(fraction * (reader.textPages - 1)));
  else {
    const stage = $("#reading-stage");
    stage.scrollTop = fraction * (stage.scrollHeight - stage.clientHeight);
  }
}
function themeOptions() {
  return `<div class="theme-options">${[
    ["light", "纯白"],
    ["paper", "纸白"],
    ["sepia", "暖黄"],
    ["night", "深夜"],
  ]
    .map(
      ([id, label]) =>
        `<button data-theme="${id}" class="theme-swatch ${prefs.theme === id ? "active" : ""}"><span></span>${label}</button>`,
    )
    .join("")}</div>`;
}
function bindThemes(parent) {
  $$("[data-theme]", parent).forEach(
    (el) =>
      (el.onclick = async () => {
        prefs.theme = el.dataset.theme;
        applyReadingStyle();
        applyTheme();
        await savePreferences();
        $$("[data-theme]", parent).forEach((item) =>
          item.classList.toggle("active", item.dataset.theme === prefs.theme),
        );
      }),
  );
}
function togglePanel(panel) {
  if (!reader) return;
  activePanel = activePanel === panel ? "" : panel;
  const container = $("#reader-panel");
  container.hidden = !activePanel;
  if (!activePanel) {
    reader.rendition?.resize();
    return;
  }
  const heading = {
    contents: "目录与书签",
    search: "书内搜索",
    appearance: "阅读外观",
  }[panel];
  container.innerHTML = `<div class="panel-heading"><h3>${heading}</h3>${button("x", "关闭面板", "close-panel")}</div><div id="panel-content"></div>`;
  $("#close-panel").onclick = () => togglePanel(activePanel);
  const body = $("#panel-content");
  if (panel === "contents") {
    body.innerHTML = `<div class="panel-tabs"><button class="active" id="toc-tab">目录</button><button id="marks-tab">书签 <span>${reader.book.bookmarks.length}</span></button></div><div id="toc-items"></div>`;
    const showToc = () => {
      $("#toc-items").innerHTML = reader.toc.length
        ? reader.toc
            .map(
              (item, index) =>
                `<button class="toc-item" data-toc="${index}" style="padding-left:${16 + item.depth * 14}px">${escape(item.label)}</button>`,
            )
            .join("")
        : '<p class="panel-empty">这本书没有内置目录。你可以通过阅读进度跳转。</p>';
      $$("[data-toc]").forEach(
        (el) =>
          (el.onclick = () => navigateToc(reader.toc[Number(el.dataset.toc)])),
      );
    };
    $("#toc-tab").onclick = () => {
      $("#toc-tab").classList.add("active");
      $("#marks-tab").classList.remove("active");
      showToc();
    };
    $("#marks-tab").onclick = () => {
      $("#marks-tab").classList.add("active");
      $("#toc-tab").classList.remove("active");
      renderBookmarks();
    };
    showToc();
  } else if (panel === "search") {
    body.innerHTML = `<form id="search-form"><label class="search-box panel-search">${icon("search", 16)}<input id="book-query" placeholder="输入关键词，按回车" aria-label="书内搜索关键词"></label><button class="primary search-submit">搜索全书</button></form><div id="search-results"><p class="panel-empty">${reader.images ? "漫画为图片格式，可使用目录跳转页面。" : "搜索正文，点击结果跳转。"}</p></div>`;
    $("#search-form").onsubmit = (event) => {
      event.preventDefault();
      searchBook($("#book-query").value.trim());
    };
    $("#book-query").focus();
  } else {
    body.innerHTML = `<div class="appearance-section"><label>页面主题</label>${themeOptions()}</div>${reader.pdf ? `<div class="appearance-section"><label for="pdf-zoom">PDF 缩放 <span id="zoom-value">${Math.round((reader.zoom || 1) * 100)}%</span></label><input id="pdf-zoom" type="range" min="0.5" max="2.5" step="0.1" value="${reader.zoom || 1}"><p>文字与页面保留原书排版。滚动可查看放大后的页面。</p></div>` : !reader.images ? `<div class="appearance-section"><label for="font-family">字体</label><select class="text-field" id="font-family"><option value="serif">宋体 / 衬线</option><option value="sans">雅黑 / 无衬线</option></select></div><div class="appearance-section"><label for="font-size">字号 <span id="size-value">${prefs.size}px</span></label><input id="font-size" type="range" min="14" max="36" step="1" value="${prefs.size}"></div><div class="appearance-section"><label for="line-height">行间距 <span id="line-value">${prefs.line}</span></label><input id="line-height" type="range" min="1.3" max="2.5" step="0.1" value="${prefs.line}"></div><div class="appearance-section"><label for="text-width">正文宽度</label><input id="text-width" type="range" min="500" max="1100" step="50" value="${prefs.width}"></div>` : '<p class="panel-empty">漫画按页面比例显示。</p>'}<button class="secondary full-width" id="mark-finished">${reader.book.finished ? "设为正在阅读" : "标记为已读完"}</button>`;
    bindThemes(body);
    if ($("#font-family")) {
      $("#font-family").value = prefs.font;
      $("#font-family").onchange = async (event) => {
        prefs.font = event.target.value;
        applyReadingStyle();
        await savePreferences();
      };
      [
        ["font-size", "size", "size-value"],
        ["line-height", "line", "line-value"],
        ["text-width", "width", null],
      ].forEach(
        ([id, key, label]) =>
          ($("#" + id).oninput = async (event) => {
            prefs[key] = Number(event.target.value);
            if (label)
              $("#" + label).textContent =
                event.target.value + (key === "size" ? "px" : "");
            applyReadingStyle();
            await savePreferences();
          }),
      );
    }
    if ($("#pdf-zoom"))
      $("#pdf-zoom").onchange = async (event) => {
        reader.zoom = Number(event.target.value);
        reader.scrollLayout = false;
        $("#zoom-value").textContent = `${Math.round(reader.zoom * 100)}%`;
        await renderPdfPage();
      };
    $("#mark-finished").onclick = async () => {
      reader.book.finished = !reader.book.finished;
      await savePosition();
      $("#mark-finished").textContent = reader.book.finished
        ? "设为正在阅读"
        : "标记为已读完";
      toast(reader.book.finished ? "已标记为读完" : "已设为正在阅读");
    };
  }
  refreshIcons();
  reader.rendition?.resize();
}
async function navigateToc(item) {
  try {
    if (reader.rendition) await reader.rendition.display(item.href);
    else if (reader.pdf) {
      let dest =
        typeof item.dest === "string"
          ? await reader.pdf.getDestination(item.dest)
          : item.dest;
      if (!dest) return;
      reader.page =
        typeof dest[0] === "number"
          ? dest[0] + 1
          : (await reader.pdf.getPageIndex(dest[0])) + 1;
      await renderPdfPage();
    } else if (reader.images) {
      reader.page = item.page;
      await renderComicPage();
    } else {
      const element = document.getElementById(item.href);
      if (element) revealTextElement(element);
    }
  } catch (error) {
    toast(`跳转失败 · ${error.message}`);
  }
}
async function addBookmark() {
  if (!reader || reader.book.position == null) {
    toast("页面加载后即可添加书签");
    return;
  }
  const marks = reader.book.bookmarks;
  const index = marks.findIndex(
    (item) =>
      JSON.stringify(item.position) === JSON.stringify(reader.book.position),
  );
  if (index >= 0) {
    marks.splice(index, 1);
    toast("已移除当前书签");
  } else {
    marks.push({
      id: crypto.randomUUID(),
      position: reader.book.position,
      label: $("#chapter-label").textContent,
      progress: reader.book.progress,
      added: Date.now(),
    });
    toast("已添加书签");
  }
  $("#bookmark").classList.toggle("selected", index < 0);
  await savePosition();
  if (activePanel === "contents") {
    activePanel = "";
    togglePanel("contents");
    $("#marks-tab").click();
  }
}
function renderBookmarks() {
  $("#toc-items").innerHTML = reader.book.bookmarks.length
    ? reader.book.bookmarks
        .map(
          (mark) =>
            `<div class="bookmark-row"><button class="toc-item" data-mark="${mark.id}">${icon("bookmark", 15)}<span>${escape(mark.label)}<small>${Math.round(mark.progress)}% · ${new Date(mark.added).toLocaleDateString("zh-CN")}</small></span></button><button class="icon-button" data-delete-mark="${mark.id}" aria-label="删除书签">${icon("x", 14)}</button></div>`,
        )
        .join("")
    : '<p class="panel-empty">读到喜欢的地方，点击顶部书签按钮。</p>';
  $$("[data-mark]").forEach(
    (el) =>
      (el.onclick = () =>
        jumpPosition(
          reader.book.bookmarks.find((mark) => mark.id === el.dataset.mark)
            .position,
        )),
  );
  $$("[data-delete-mark]").forEach(
    (el) =>
      (el.onclick = async () => {
        reader.book.bookmarks = reader.book.bookmarks.filter(
          (mark) => mark.id !== el.dataset.deleteMark,
        );
        await savePosition();
        renderBookmarks();
      }),
  );
  refreshIcons();
}
async function jumpPosition(position) {
  if (reader.rendition) await reader.rendition.display(position);
  else if (reader.pdf) {
    reader.page = Number(position);
    await renderPdfPage();
  } else if (reader.images) {
    reader.page = Number(position);
    await renderComicPage();
  } else await seek(Number(position));
}
async function searchBook(term) {
  if (!term || !reader) return;
  const session = reader;
  const token = crypto.randomUUID();
  session.searchToken = token;
  const results = [];
  $("#search-results").innerHTML = '<p class="panel-empty">正在搜索全书…</p>';
  try {
    if (session.pdf) {
      for (let index = 1; index <= session.pdf.numPages; index++) {
        if (
          reader !== session ||
          session.searchToken !== token ||
          activePanel !== "search"
        )
          return;
        const page = await session.pdf.getPage(index);
        const text = (await page.getTextContent()).items
          .map((item) => item.str)
          .join(" ");
        const match = text.toLowerCase().indexOf(term.toLowerCase());
        if (match >= 0)
          results.push({
            label: `第 ${index} 页`,
            excerpt: text.slice(
              Math.max(0, match - 35),
              match + term.length + 75,
            ),
            position: index,
          });
        if (results.length >= 100) break;
      }
    } else if (session.epub) {
      for (const section of session.epub.spine.spineItems) {
        if (
          reader !== session ||
          session.searchToken !== token ||
          activePanel !== "search"
        )
          return;
        await section.load(session.epub.load.bind(session.epub));
        const matches = section.find(term);
        matches.forEach((match) =>
          results.push({
            label: "正文匹配",
            excerpt: match.excerpt,
            position: match.cfi,
          }),
        );
        if (results.length >= 100) break;
      }
    } else if (!session.images) {
      $$(
        ".text-book p,.text-book h1,.text-book h2,.text-book h3,.text-book li",
      ).forEach((el, index) => {
        const text = el.textContent;
        const match = text.toLowerCase().indexOf(term.toLowerCase());
        if (match < 0 || results.length >= 100) return;
        el.dataset.searchTarget = index;
        results.push({
          label: "正文匹配",
          excerpt: text.slice(
            Math.max(0, match - 35),
            match + term.length + 75,
          ),
          element: el,
        });
      });
    }
    if (
      reader !== session ||
      session.searchToken !== token ||
      activePanel !== "search"
    )
      return;
    const limited = results.slice(0, 100);
    $("#search-results").innerHTML =
      `<p class="search-count">${results.length >= 100 ? "前 100 条" : `${limited.length} 条`}匹配结果</p>${limited.map((item, index) => `<button class="search-result" data-result="${index}"><small>${item.label}</small><span>${escape(item.excerpt)}</span></button>`).join("")}${!limited.length ? '<p class="panel-empty">没有找到匹配文字。</p>' : ""}`;
    $$("[data-result]").forEach(
      (el) =>
        (el.onclick = async () => {
          const item = limited[Number(el.dataset.result)];
          if (item.element) {
            revealTextElement(item.element);
            item.element.classList.add("search-highlight");
            setTimeout(
              () => item.element.classList.remove("search-highlight"),
              2200,
            );
          } else await jumpPosition(item.position);
        }),
    );
  } catch (error) {
    if ($("#search-results"))
      $("#search-results").innerHTML =
        `<p class="panel-empty">${escape(error.message)}</p>`;
  }
}
async function toggleFullscreen() {
  if (window.chrome?.webview) {
    window.chrome.webview.postMessage({ type: "fullscreen" });
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
}
function handleKeys(event) {
  if (
    document.querySelector("dialog[open]") ||
    event.target?.matches?.("input,textarea,select,[contenteditable]")
  )
    return;
  if (event.ctrlKey && event.key.toLowerCase() === "o") {
    event.preventDefault();
    if (!reader) $("#files").click();
  }
  if (event.ctrlKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!reader) $("#library-search")?.focus();
  }
  if (event.key === "F11") {
    event.preventDefault();
    toggleFullscreen();
  }
  if (!reader) return;
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    turnPage(1);
  }
  if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    turnPage(-1);
  }
  if (event.ctrlKey && event.key.toLowerCase() === "f") {
    event.preventDefault();
    if (activePanel === "search") $("#book-query").focus();
    else togglePanel("search");
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (activePanel) togglePanel(activePanel);
    else closeReader();
  }
}
document.addEventListener("keydown", handleKeys);
$("#files").onchange = async (event) => {
  await importFiles([...event.target.files]);
  event.target.value = "";
};
$("#restore").onchange = async (event) => {
  if (event.target.files[0]) await restoreLibrary(event.target.files[0]);
  event.target.value = "";
};
let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  if (event.dataTransfer.types.includes("Files")) {
    event.preventDefault();
    dragDepth++;
    document.body.classList.add("dragging");
  }
});
document.addEventListener("dragleave", () => {
  dragDepth--;
  if (dragDepth <= 0) document.body.classList.remove("dragging");
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dragging");
  if (event.dataTransfer.files.length)
    importFiles([...event.dataTransfer.files]);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && reader) savePosition();
});
window.addEventListener("pagehide", () => {
  if (reader) savePosition();
});
window.chrome?.webview?.addEventListener("message", async (event) => {
  if (event.data?.type === "closing") {
    clearTimeout(saveTimer);
    await savePosition();
    window.chrome.webview.postMessage({ type: "flushed" });
  }
});
window.addEventListener("resize", () => {
  if (reader?.textReady) queueTextLayout();
  if (reader?.pdf && !reader.busy) {
    reader.scrollLayout = false;
    renderPdfPage();
  }
  if (reader?.images && !reader.busy) {
    reader.scrollLayout = false;
    renderComicPage();
  }
});
window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  toast(event.reason?.message || "操作未能完成，请重试");
});
renderLibrary();

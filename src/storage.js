const connection = new Promise((resolve, reject) => {
  const request = indexedDB.open("shiye-library", 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore("books", { keyPath: "id" });
    request.result.createObjectStore("files");
    request.result.createObjectStore("settings");
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function transaction(stores, mode, action) {
  const db = await connection;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    try {
      result = action(tx);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () =>
      resolve(result instanceof IDBRequest ? result.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存已中止"));
  });
}

export const storage = {
  books: () =>
    transaction(["books"], "readonly", (tx) =>
      tx.objectStore("books").getAll(),
    ),
  file: (id) =>
    transaction(["files"], "readonly", (tx) => tx.objectStore("files").get(id)),
  setting: (key) =>
    transaction(["settings"], "readonly", (tx) =>
      tx.objectStore("settings").get(key),
    ),
  saveSetting: (key, value) =>
    transaction(["settings"], "readwrite", (tx) => {
      tx.objectStore("settings").put(value, key);
    }),
  saveBook: (book) =>
    transaction(["books"], "readwrite", (tx) => {
      tx.objectStore("books").put(book);
    }),
  importBook: (book, data) =>
    transaction(["books", "files"], "readwrite", (tx) => {
      tx.objectStore("books").put(book);
      tx.objectStore("files").put(data, book.id);
    }),
  remove: (id) =>
    transaction(["books", "files"], "readwrite", (tx) => {
      tx.objectStore("books").delete(id);
      tx.objectStore("files").delete(id);
    }),
  restore: (books, files, settings) =>
    transaction(["books", "files", "settings"], "readwrite", (tx) => {
      books.forEach((book, index) => {
        tx.objectStore("books").put(book);
        tx.objectStore("files").put(files[index], book.id);
      });
      Object.entries(settings).forEach(([key, value]) =>
        tx.objectStore("settings").put(value, key),
      );
    }),
};

// moves-db.js
// Saves recorded moves inside the user's browser (IndexedDB), so they stay
// there after a refresh. No server or account needed.
//
//   import { saveMove, listMoves, getMove, deleteMove } from "./moves-db.js";

const DB_NAME = "dance-studio";
const STORE = "moves";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export const saveMove = (move) => run("readwrite", (store) => store.put(move));
export const getMove = (id) => run("readonly", (store) => store.get(id));
export const deleteMove = (id) => run("readwrite", (store) => store.delete(id));

// Newest first
export async function listMoves() {
  const all = await run("readonly", (store) => store.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

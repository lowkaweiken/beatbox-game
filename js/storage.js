const DB_NAME = 'beatbox-calibration';
const DB_VERSION = 1;
const STORE = 'calibration';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveCentroids(centroids) {
  const data = {};
  for (const [cls, arr] of Object.entries(centroids)) data[cls] = Array.from(arr);
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(data, 'centroids');
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function loadCentroids() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get('centroids');
    req.onsuccess = e => {
      const raw = e.target.result;
      if (!raw) { resolve(null); return; }
      const out = {};
      for (const [cls, arr] of Object.entries(raw)) out[cls] = new Float32Array(arr);
      resolve(out);
    };
    req.onerror = e => reject(e.target.error);
  });
}

export async function clearAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

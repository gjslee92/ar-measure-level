// IndexedDB 측정 기록 저장소 (기기 내부 저장, 외부 전송 없음)
const DB_NAME = 'arlevel-db';
const DB_VER = 1;
const STORE = 'records';

let dbPromise = null;

export class StorageError extends Error {
  constructor(message, cause) { super(message); this.cause = cause; this.name = 'StorageError'; }
}

function describe(err) {
  const name = err && (err.name || (err.target && err.target.error && err.target.error.name));
  if (name === 'QuotaExceededError') return '저장 공간이 부족합니다. 사진이 포함된 기록을 일부 삭제하거나 기기 저장 공간을 확보해 주세요.';
  if (name === 'InvalidStateError' || name === 'SecurityError') return '이 브라우저(또는 시크릿 모드)에서는 기기 내 저장소를 사용할 수 없습니다.';
  return '기기 내 저장소에 접근하지 못했습니다. 브라우저 설정에서 사이트 데이터 저장을 허용해 주세요.';
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new StorageError('이 브라우저는 IndexedDB를 지원하지 않아 기록을 저장할 수 없습니다.'));
      return;
    }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(new StorageError(describe(e), e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        st.createIndex('createdAt', 'createdAt');
        st.createIndex('type', 'type');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError(describe(req.error), req.error));
    req.onblocked = () => reject(new StorageError('다른 탭에서 앱이 열려 있어 저장소를 열 수 없습니다. 다른 탭을 닫아 주세요.'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(STORE, mode); } catch (e) { reject(new StorageError(describe(e), e)); return; }
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store, r => { result = r; })).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(new StorageError(describe(t.error), t.error));
    t.onabort = () => reject(new StorageError(describe(t.error), t.error));
  }));
}

export function addRecord(rec) {
  const data = { ...rec, createdAt: rec.createdAt || Date.now() };
  return tx('readwrite', (store, done) => {
    const r = store.add(data);
    r.onsuccess = () => done(r.result);
  });
}

export function updateRecord(rec) {
  return tx('readwrite', (store, done) => {
    const r = store.put(rec);
    r.onsuccess = () => done(r.result);
  });
}

export function getRecord(id) {
  return tx('readonly', (store, done) => {
    const r = store.get(id);
    r.onsuccess = () => done(r.result || null);
  });
}

export function getAllRecords() {
  return tx('readonly', (store, done) => {
    const r = store.getAll();
    r.onsuccess = () => done((r.result || []).sort((a, b) => b.createdAt - a.createdAt));
  });
}

export function deleteRecord(id) {
  return tx('readwrite', (store, done) => {
    const r = store.delete(id);
    r.onsuccess = () => done(true);
  });
}

export function clearRecords() {
  return tx('readwrite', (store, done) => {
    const r = store.clear();
    r.onsuccess = () => done(true);
  });
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) { /* 무시 */ }
  return null;
}

export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* 무시 */ }
  return false;
}

export type DraftSyncState =
  | "LOCAL_ONLY"
  | "SYNC_PENDING"
  | "SYNCING"
  | "SYNCED"
  | "SYNC_FAILED"
  | "CONFLICT";

export type OfflineDraft<T> = {
  key: string;
  userId: string;
  factoryId: string;
  department: string;
  productionDate: string;
  shift: string;
  payload: T;
  state: DraftSyncState;
  updatedAt: string;
  serverUpdatedAt: string | null;
};

const DATABASE_NAME = "sugar-factory-offline";
const STORE_NAME = "daily-operation-drafts";
const VERSION = 1;

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("by-user", "userId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage could not be opened."));
  });
}

function completeTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction was aborted."));
  });
}

export function dailyDraftKey(userId: string, productionDate: string, shift: string) {
  return `${userId}:bilagi-badagandi:${productionDate}:${shift}`;
}

export async function saveOfflineDraft<T>(draft: OfflineDraft<T>) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).put(draft);
  await completeTransaction(transaction);
  database.close();
  return draft;
}

export async function getOfflineDraft<T>(key: string): Promise<OfflineDraft<T> | null> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).get(key);
  const result = await new Promise<OfflineDraft<T> | undefined>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as OfflineDraft<T> | undefined);
    request.onerror = () => reject(request.error ?? new Error("Offline draft could not be read."));
  });
  await completeTransaction(transaction);
  database.close();
  return result ?? null;
}

export async function listOfflineDrafts<T>(userId: string): Promise<Array<OfflineDraft<T>>> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const request = transaction.objectStore(STORE_NAME).index("by-user").getAll(userId);
  const result = await new Promise<Array<OfflineDraft<T>>>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result ?? []) as Array<OfflineDraft<T>>);
    request.onerror = () => reject(request.error ?? new Error("Offline drafts could not be listed."));
  });
  await completeTransaction(transaction);
  database.close();
  return result.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function deleteOfflineDraft(key: string) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  transaction.objectStore(STORE_NAME).delete(key);
  await completeTransaction(transaction);
  database.close();
}
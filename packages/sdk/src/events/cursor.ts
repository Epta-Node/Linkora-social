declare const process: undefined | { cwd?: () => string };

export interface CursorStore {
  /**
   * Get the current cursor.
   *
   * @returns A promise that resolves to the cursor string, or undefined if none exists.
   *
   * @example
   * ```ts
   * const cursor = await store.get();
   * console.log("Current cursor:", cursor);
   * ```
   */
  get(): Promise<string | undefined>;
  /**
   * Set a new cursor.
   *
   * @param cursor The new cursor string (e.g., pagingToken).
   * @returns A promise that resolves when the cursor is saved.
   *
   * @example
   * ```ts
   * await store.set("123456789-1");
   * console.log("Cursor updated");
   * ```
   */
  set(cursor: string): Promise<void>;
  /**
   * Clear the stored cursor.
   *
   * @returns A promise that resolves when the cursor is cleared.
   *
   * @example
   * ```ts
   * await store.clear();
   * console.log("Cursor cleared");
   * ```
   */
  clear(): Promise<void>;
}

export class MemoryCursorStore implements CursorStore {
  private cursor?: string;

  constructor(initialCursor?: string) {
    this.cursor = initialCursor;
  }

  async get(): Promise<string | undefined> {
    return this.cursor;
  }

  async set(cursor: string): Promise<void> {
    this.cursor = cursor;
  }

  async clear(): Promise<void> {
    this.cursor = undefined;
  }
}

export class LocalStorageCursorStore implements CursorStore {
  constructor(private key = "linkora:lastEventCursor") {}

  async get(): Promise<string | undefined> {
    const localStorage = getLocalStorage();
    return localStorage?.getItem(this.key) ?? undefined;
  }

  async set(cursor: string): Promise<void> {
    const localStorage = getLocalStorage();
    if (!localStorage) return;
    localStorage.setItem(this.key, cursor);
  }

  async clear(): Promise<void> {
    const localStorage = getLocalStorage();
    localStorage?.removeItem(this.key);
  }
}

export interface SecureStoreAdapter {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export class SecureStoreCursorStore implements CursorStore {
  constructor(
    private readonly secureStore: SecureStoreAdapter,
    private readonly key = "linkora:lastEventCursor"
  ) {}

  async get(): Promise<string | undefined> {
    return (await this.secureStore.getItemAsync(this.key)) ?? undefined;
  }

  async set(cursor: string): Promise<void> {
    await this.secureStore.setItemAsync(this.key, cursor);
  }

  async clear(): Promise<void> {
    await this.secureStore.deleteItemAsync(this.key);
  }
}

export class FileCursorStore implements CursorStore {
  constructor(private path = defaultCursorPath()) {}

  async get(): Promise<string | undefined> {
    const fs = getFs();
    if (!fs) return undefined;

    try {
      const cursor = await fs.promises.readFile(this.path, "utf8");
      return cursor.trim() || undefined;
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return undefined;
      throw err;
    }
  }

  async set(cursor: string): Promise<void> {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return;

    await fs.promises.mkdir(path.dirname(this.path), { recursive: true });
    await fs.promises.writeFile(this.path, cursor, "utf8");
  }

  async clear(): Promise<void> {
    const fs = getFs();
    if (!fs) return;

    try {
      await fs.promises.unlink(this.path);
    } catch (err) {
      if (isNodeError(err) && err.code === "ENOENT") return;
      throw err;
    }
  }
}

/**
 * Create an appropriate default CursorStore based on the environment.
 * Uses LocalStorage in browsers, SecureStore in React Native/Expo,
 * File-based storage in Node.js, and falls back to Memory storage.
 *
 * @param keyOrPath Optional key or file path for the storage.
 * @returns A platform-appropriate CursorStore implementation.
 *
 * @example
 * ```ts
 * const store = createDefaultCursorStore();
 * await store.set("12345-1");
 * ```
 */
export function createDefaultCursorStore(keyOrPath?: string): CursorStore {
  if (getLocalStorage()) return new LocalStorageCursorStore(keyOrPath);
  const secureStore = getSecureStore();
  if (secureStore) return new SecureStoreCursorStore(secureStore, keyOrPath);
  if (getFs() && getPath()) return new FileCursorStore(keyOrPath);
  return new MemoryCursorStore();
}

function getLocalStorage():
  | {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
      removeItem(key: string): void;
    }
  | undefined {
  const storage = (
    globalThis as {
      localStorage?: {
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
      };
    }
  ).localStorage;
  return storage;
}

function getFs():
  | {
      promises: {
        readFile(path: string, encoding: "utf8"): Promise<string>;
        writeFile(path: string, data: string, encoding: "utf8"): Promise<void>;
        mkdir(path: string, options: { recursive: boolean }): Promise<void>;
        unlink(path: string): Promise<void>;
      };
    }
  | undefined {
  const requireFn = getRequire();
  if (!requireFn) return undefined;
  try {
    return requireFn("fs") as ReturnType<typeof getFs>;
  } catch (_err) {
    return undefined;
  }
}

function getSecureStore(): SecureStoreAdapter | undefined {
  const maybeGlobal = globalThis as {
    ExpoSecureStore?: SecureStoreAdapter;
    SecureStore?: SecureStoreAdapter;
  };

  return maybeGlobal.ExpoSecureStore ?? maybeGlobal.SecureStore;
}

function getPath():
  | { dirname(path: string): string; join(...parts: string[]): string }
  | undefined {
  const requireFn = getRequire();
  if (!requireFn) return undefined;
  try {
    return requireFn("path") as ReturnType<typeof getPath>;
  } catch (_err) {
    return undefined;
  }
}

function getRequire(): ((moduleName: string) => unknown) | undefined {
  try {
    return (0, eval)("typeof require === 'function' ? require : undefined") as
      | ((moduleName: string) => unknown)
      | undefined;
  } catch (_err) {
    return undefined;
  }
}

function defaultCursorPath(): string {
  const path = getPath();
  const cwd = typeof process !== "undefined" && process.cwd ? process.cwd() : ".";
  return path ? path.join(cwd, ".linkora-event-cursor") : ".linkora-event-cursor";
}

function isNodeError(err: unknown): err is { code: string } {
  return Boolean(err && typeof err === "object" && "code" in err);
}

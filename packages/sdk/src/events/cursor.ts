declare const require: undefined | ((moduleName: string) => unknown);
declare const process: undefined | { cwd?: () => string };

export interface CursorStore {
  get(): Promise<string | undefined>;
  set(cursor: string): Promise<void>;
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

export function createDefaultCursorStore(keyOrPath?: string): CursorStore {
  if (getLocalStorage()) return new LocalStorageCursorStore(keyOrPath);
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
  if (typeof require !== "function") return undefined;
  try {
    return require("fs") as ReturnType<typeof getFs>;
  } catch (_err) {
    return undefined;
  }
}

function getPath():
  | { dirname(path: string): string; join(...parts: string[]): string }
  | undefined {
  if (typeof require !== "function") return undefined;
  try {
    return require("path") as ReturnType<typeof getPath>;
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

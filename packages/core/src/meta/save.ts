// Versioned saves (docs/GDD.md §9, skill save-systems): every persistent file carries `version`, loads through a
// chain of migrations v → v+1, is validated, and falls back to its `.bak` copy when the main file is corrupt.
// Pure: the storage is injected (localStorage in the browser, userData files in the desktop app).

export interface KeyStore {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

export interface SaveSchema<T> {
  key: string;
  version: number;
  /** migrations[v] turns a version-v object into a version-(v+1) object */
  migrations: Record<number, (s: any) => any>;
  /** a fresh default value */
  fresh(): T;
  /** shape check after migrating; false = reject the file */
  valid(s: any): boolean;
}

/** Parse + migrate + validate one raw file. null when it is missing, corrupt, invalid or from a newer build. */
export function parseSave<T>(schema: SaveSchema<T>, raw: string | null): T | null {
  if (!raw) return null;
  try {
    let s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    let v = typeof s.version === 'number' ? s.version : 0;
    if (v > schema.version) return null;
    while (v < schema.version) {
      const m = schema.migrations[v];
      if (!m) return null;
      s = m(s);
      v++;
      s.version = v;
    }
    return schema.valid(s) ? (s as T) : null;
  } catch {
    return null;
  }
}

/** Load: main file, else its backup, else a fresh value. `from` tells which one was used. */
export function loadSave<T>(schema: SaveSchema<T>, store: KeyStore): { data: T; from: 'main' | 'bak' | 'fresh' } {
  const main = parseSave(schema, store.read(schema.key));
  if (main) return { data: main, from: 'main' };
  const bak = parseSave(schema, store.read(schema.key + '.bak'));
  if (bak) return { data: bak, from: 'bak' };
  return { data: schema.fresh(), from: 'fresh' };
}

/** Save: the previous good file becomes the backup, then the new one is written (stores write atomically). */
export function writeSave<T>(schema: SaveSchema<T>, store: KeyStore, data: T): string {
  const prev = store.read(schema.key);
  if (prev && parseSave(schema, prev)) store.write(schema.key + '.bak', prev);
  const json = JSON.stringify({ ...data, version: schema.version });
  store.write(schema.key, json);
  return json;
}

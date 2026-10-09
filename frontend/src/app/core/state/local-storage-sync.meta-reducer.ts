import { Action, ActionReducer, INIT, MetaReducer } from '@ngrx/store';

export const STORAGE_KEY_PREFIX = 'playlens.v2.';
export const LEGACY_STORAGE_PREFIXES = ['artlens.', 'playlens.v1.'];

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function readSlice<T>(key: string): T | undefined {
  try {
    const raw = safeStorage()?.getItem(STORAGE_KEY_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function purgeLegacyKeys(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && LEGACY_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        stale.push(key);
      }
    }
    stale.forEach((key) => storage.removeItem(key));
  } catch {
  }
}

function writeSlice(key: string, value: unknown): void {
  try {
    safeStorage()?.setItem(STORAGE_KEY_PREFIX + key, JSON.stringify(value));
  } catch {
  }
}

export function localStorageSync<S extends object>(keys: (keyof S & string)[]): MetaReducer<S> {
  return (reducer: ActionReducer<S>) => {
    return (state: S | undefined, action: Action): S => {
      const next = reducer(state, action);

      if (action.type === INIT) {
        purgeLegacyKeys();
        const hydrated = { ...next } as Record<string, unknown>;
        for (const key of keys) {
          const saved = readSlice<Record<string, unknown>>(key);
          if (saved && typeof saved === 'object') {
            hydrated[key] = { ...(next[key] as object), ...saved };
          }
        }
        return hydrated as S;
      }

      for (const key of keys) {
        if (!state || state[key] !== next[key]) {
          writeSlice(key, next[key]);
        }
      }
      return next;
    };
  };
}

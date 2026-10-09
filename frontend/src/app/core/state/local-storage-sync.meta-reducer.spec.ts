import { INIT } from '@ngrx/store';
import { STORAGE_KEY_PREFIX, localStorageSync, purgeLegacyKeys } from './local-storage-sync.meta-reducer';

describe('localStorageSync', () => {
  beforeEach(() => localStorage.clear());

  it('drops data persisted by previous versions (painting annotations)', () => {
    localStorage.setItem('artlens.v1.annotations', '{"idsByArtwork":{"1":["a"]}}');
    localStorage.setItem('unrelated', 'keep');
    purgeLegacyKeys();
    expect(localStorage.getItem('artlens.v1.annotations')).toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('rehydrates only the current versioned keys on init', () => {
    localStorage.setItem('artlens.v1.annotations', '{"old":true}');
    localStorage.setItem(`${STORAGE_KEY_PREFIX}annotations`, '{"idsByGame":{"steam:1":["a"]}}');
    const root = (s: { annotations: object } | undefined) => s ?? { annotations: { idsByGame: {} } };
    const reducer = localStorageSync<{ annotations: object }>(['annotations'])(root as never);
    const state = reducer(undefined, { type: INIT });
    expect(state.annotations).toEqual({ idsByGame: { 'steam:1': ['a'] } });
    expect(localStorage.getItem('artlens.v1.annotations')).toBeNull();
  });
});

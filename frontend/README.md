# PlayLens: frontend

An Angular 22 app for searching PC game deals from the [CheapShark API](https://apidocs.cheapshark.com/) as you type.
You can open any game and draw polygons on top of its key art (sharp images from the Steam CDN). The polygons are
kept in NgRx and saved to `localStorage`, so they are still there after a reload.

## Run

```bash
npm install
npm start            # ng serve -> http://localhost:4200
npm run build        # production build -> dist/frontend
npm test             # vitest unit tests (use `npm run test:ci` to force --watch=false)
```

Node 24 / npm 12. The app needs no backend and no API key: CheapShark sends `Access-Control-Allow-Origin: *` and
exposes the `X-Total-Page-Count` header to browsers.

> CheapShark rejects requests without a descriptive `User-Agent` (e.g. bare `curl`). Browsers always send one, so
> the app is fine; for manual checks use `curl -A 'Mozilla/5.0 …'`.

## Data source

| What | Where |
|---|---|
| Search | `GET https://www.cheapshark.com/api/1.0/deals?title=<q>&exact=0&sortBy=Reviews&pageSize=60&pageNumber=<0-based>` |
| Total pages | `X-Total-Page-Count` response header = **index of the last page** (0-based), so pages = header + 1 (0 results also reports `0`). Read with `observe: 'response'`. |
| List thumbnail | `https://cdn.cloudflare.steamstatic.com/steam/apps/{steamAppID}/header.jpg` (460×215) → CheapShark `thumb` |
| Dialog image | `…/steam/apps/{steamAppID}/library_hero.jpg` (1920×620) → `header.jpg` → CheapShark `thumb` |

- One row = one *deal* (a game in one store). The same game appears once per store, so rows are mapped to `Game`s
  and **deduped by a stable id** (`steam:<appid>`, or `cs:<cheapSharkGameID>` for non-Steam games), keeping the
  best deal (lowest price, then biggest discount). The service maps every row; dedupe happens in one place, the
  search reducer, with `@ngrx/entity` adapter operations (see "Где используется @ngrx/entity").
- `sortBy=Reviews` puts popular games first and keeps page boundaries stable between requests (the default
  "Deal Rating" order shifts as prices change).
- Title matching is a case-insensitive substring match, so partial words work while typing ("witc" → The Witcher),
  and nonsense returns `[]`. That is what makes "store only meaningful queries" work without query-syntax tricks.
- All image URL builders live in one pure util, `core/api/steam-images.ts` (shared contract with the backend).

## Features

| Area | What it does |
|---|---|
| Typeahead search | No search button. Every keystroke dispatches `Search/Query Changed`, and an effect runs the pipeline. |
| Results | `cdk-virtual-scroll-viewport` with fixed 96px rows: Steam header thumbnail, title, sale price / normal price / savings badge, Metacritic score, Steam rating, release year. Batches of 60 deals load via a CDK `DataSource` (`GamesDataSource`) when the range the viewport needs gets within 10 rows of the end. |
| Query history | Only *meaningful* queries are stored (see below), using `@ngrx/entity` and persisted to localStorage. |
| Suggestions | A `mat-autocomplete` dropdown (with keyboard navigation) suggests past queries. Matching is word by word and the matched word prefixes are highlighted. When the input is empty, recent searches appear as chips. |
| Game dialog | A Material Dialog shows price, savings, Metacritic, Steam rating, a "View deal" link and the Steam library hero with a `<canvas>` overlay. |
| Polygons | Draw, select, drag, rotate, delete and clear. Each polygon is an `@ngrx/entity` entity keyed by `id` and indexed by `gameId` (`steam:<appid>` / `cs:<gameID>`). They are saved to localStorage and drawn again when you reopen the dialog. |

### Polygon editor (canvas, no drawing libs)

- **Draw mode:** click to add vertices. Close the polygon by clicking the first vertex (it highlights), double-clicking, or pressing **Enter**. **Backspace** removes the last vertex and **Esc** cancels. A dashed rubber-band line follows the pointer, and the fill is semi-transparent.
- **Select mode:** click a polygon to select it. The hit test uses ray-casting point-in-polygon and picks the top-most polygon.
  - **Drag** the polygon to move it. The move is clamped so the polygon stays inside the image.
  - **Rotate** it around its area centroid in any of these ways:
    - drag the round handle above it (hold Shift to snap to 15°)
    - use the mouse wheel (5° per step, or 15° with Shift)
    - use the toolbar buttons (±15°)
  - **Delete** or **Backspace** removes the selected polygon. "Clear all" removes every polygon for the game.
- **Shortcuts:** **D** switches to draw mode and **S** to select mode. **Esc** works in stages: first it cancels the draft or drag, then it clears the selection, and only then does it close the dialog.
- **Resolution independence:** points are stored **normalized (0..1)** relative to the image.
  - A `ResizeObserver` tracks the rendered image size, and points are converted to pixels only when drawing. Polygons therefore keep their position and proportions at any window or dialog size.
  - The canvas backing store is `cssSize × devicePixelRatio` with `setTransform(dpr…)`, which keeps lines crisp. A DPR change (for example, moving the window to another screen) triggers a redraw.
  - Rotation happens in aspect-correct pixel space, so non-square images don't shear the polygon.
- Drags show a live local preview and are committed to the store once, on `pointerup`, instead of on every mouse move.

## How the optimizations work

### Typeahead (`features/search/store/search.effects.ts`)
```
Query Changed -> normalize (case/whitespace) -> debounceTime(300)
  -> filter(empty || >= 2 alphanumeric chars) -> distinctUntilChanged()
  -> switchMap(api.search)  // cancels the previous in-flight request
```
- Empty input clears the results. A single character is ignored and the previous list stays visible.
- The reducer also drops stale responses whose `query` is not the active one.
- Effect tests use fake timers to cover debounce, filtering, distinctUntilChanged and the switchMap cancellation.

### No caching (business requirement)
- **Search results and HTTP responses are not cached anywhere.** There is no cache interceptor, no response store,
  no in-flight request sharing, and the reducer never reuses results: every `Search Started` empties the entity
  collection, so a repeated query (e.g. `star` → `portal` → `star`) always goes to CheapShark again.
- CheapShark answers with `Cache-Control: max-age=300`, so the request is sent with the fetch option
  `cache: 'no-store'` (`CheapSharkApiService`); otherwise the *browser* would answer a repeated query from its HTTP
  cache. (Caching on CheapShark's side / its CDN is outside the app's control.)
- What remains is only **memoization**, not data caching: NgRx `createSelector` keeps the last result of each
  selector for the last input (inherent to NgRx); `computed` signals do the same. Parameterised selector factories
  (`selectQuerySuggestions`, `selectPolygonsForGame`) build a new selector per call and are called once per
  component instance; there is no hand-made registry of selector instances.
- Request volume is kept low by: `debounceTime(300)`, the min-length filter, `distinctUntilChanged`, `switchMap`
  cancellation, and the infinite-scroll guards (`exhaustMap`, loading flag, one request per page).

### HTTP interceptors (`core/http`)
The interceptors run in this order: `loadingInterceptor` → `errorInterceptor`.
- **errorInterceptor**
  - Retries GETs up to 2 times with exponential backoff, only on transient errors (network/0, 429, 5xx):
    300 ms → 600 ms, and for **429 (rate limit)** 1.5 s → 3 s, or the server's `Retry-After` (capped at 10 s).
  - Then maps every failure to a plain, serializable `AppHttpError` for the store; a 429 becomes
    "The game deals service is rate-limiting us — wait a few seconds, then try again."
- **loadingInterceptor:** a signal-based pending-request counter that drives the global progress bar. It uses `finalize`, so cancelled requests decrement it too.

### Rendering
- Every component is `OnPush`, and the app runs **zoneless** (the Angular 22 default).
- State is read with `store.selectSignal`, and the components use signals throughout: `input()`, `output()`, `model()`, `computed`, `viewChild`.
- `cdkVirtualFor` iterates a `DataSource` with `trackBy: trackById` (CDK's `templateCacheSize` option for recycled row templates is left at 40). `@for` blocks use `track`.
- Thumbnails use `loading="lazy"` and `decoding="async"`. `ImgFallbackDirective` walks the candidate URLs on
  `error` (e.g. Steam `header.jpg` 404s for some newer apps → CheapShark thumb). The directive compares the
  candidate list by content, so a fresh array per change detection doesn't restart it. A neutral icon sits behind
  the image as placeholder.
- **Images are never shown blurred.** There is no low-res stand-in: the dialog shows a neutral shimmer skeleton
  while loading, then the full image (or the next candidate, with a small note when it's the store capsule).
- Canvas redraws are coalesced into one `requestAnimationFrame`.

### Infinite scroll (`features/search/games.data-source.ts`)
- Standard CDK mechanism: `GamesDataSource extends DataSource<Game>`, used as
  `*cdkVirtualFor="let game of dataSource; trackBy: trackById"` inside `cdk-virtual-scroll-viewport [itemSize]="96"`.
- `connect(collectionViewer)`:
  - returns `store.select(selectAllGames)` (the entity collection, API order) as the data stream;
  - subscribes to `collectionViewer.viewChange` (the `ListRange` the viewport needs) combined with the paging
    state (`selectPaging`). If `range.end >= loadedCount - 10` and more pages exist, it dispatches
    `Search/Next Page Requested`.
- The decision is keyed by the **page number** (`searchId|lastLoadedPage + 1`; `searchId` grows on every search, so repeating the same text starts a new key space) with `distinctUntilChanged`:
  - a page made only of duplicate games leaves the list length unchanged but advances `lastLoadedPage`, so the
    current range is re-evaluated after every completed page (no scroll needed) and loading never stalls;
  - a failed page keeps the same key, so it is not retried in a loop; the footer offers a Retry button;
  - the same page is never requested twice.
- The dispatch is scheduled with `observeOn(asapScheduler)`: the paging state changes synchronously inside
  `Page Loaded`, while the effect's `exhaustMap` inner has emitted but not completed yet; a synchronous trigger
  would be dropped there. (Covered by an integration test with the real store + effects.)
- `disconnect()` unsubscribes. One data source per results list; the list is re-created for every search (the
  loading state replaces it) and also scrolls to the top when the query changes.
- **Effect** (`nextPage$`): acts only when `status === success`, no page is loading and more pages exist;
  `exhaustMap` drops extra triggers; `takeUntil` cancels the page when a new search starts.
- **Reducer guards:** a page is accepted only if it equals `lastLoadedPage + 1` for the current query.
- `totalPages` comes from the `X-Total-Page-Count` header (see above). CheapShark reports pages, not hits, so the
  UI shows "N games · M deals · page x of y".

## Где используется @ngrx/entity
| Slice | Adapter | File | Notes |
|---|---|---|---|
| `search` (results) | `gamesAdapter = createEntityAdapter<Game>({ selectId: g => g.id, sortComparer: false })` | `src/app/features/search/store/search.reducer.ts` | `SearchState extends EntityState<Game>` + paging metadata (`query`, `status`, `lastLoadedPage`, `totalPages`, `loadingPage`, `error`, `pageError`, `dealCount`). New search → `removeAll`; every page → `addMany` for unknown ids (insertion order = API order) and `upsertMany` only for ids whose new deal is better (lower `salePrice`, then bigger discount) — position unchanged. Selectors from `gamesAdapter.getSelectors()` exposed via `createFeature` `extraSelectors`: `selectAllGames`, `selectGameEntities`, `selectGameCount`. |
| `queryHistory` | `createEntityAdapter<QueryHistoryEntry>` (sorted by recency) | `src/app/features/search/store/query-history.reducer.ts` | id = normalised query text; persisted. |
| `annotations` | `polygonAdapter = createEntityAdapter<Polygon>` (sorted by `createdAt`) | `src/app/features/annotations/store/annotations.reducer.ts` | plus `idsByGame` index; persisted. |

### Meaningful query history (`features/search/store/query-history.reducer.ts`)
- A query is recorded only after a **successful first page with at least one game**. `resultCount` is exact for single-page results and an upper-bound estimate (`pages × 60`) otherwise.
- **Dedupe:** the entity id is the normalized text (lower-case, trimmed, collapsed whitespace). A repeated search increments `hits` and updates `lastUsed`.
- **Typing intermediates are collapsed.** When "van gogh" is recorded, stored prefixes such as "van" or "van g" are removed if they were used once within the last 20 s.
- **Backspacing does not add entries.** A prefix of a query recorded in the last 10 s is not stored.
- The history is capped at 200 entries, and the least recently used are evicted. The adapter sorts by recency.

### Suggestions with word breakdown (`query-history.selectors.ts`)
- `selectQueryWordIndex` is a memoized `Map<word, Set<queryId>>` built by tokenizing every stored query. It is rebuilt only when the history changes.
- `selectSuggestionSources` (entities + list + word index) changes only when the history changes. The search box
  computes suggestions with `computed(() => rankSuggestions(typedText(), 8, history()))` — no selector is created
  per keystroke.
- `selectQuerySuggestions(input, limit)` is a plain parameterised selector factory (no instance registry), used
  once per component instance for a fixed input (the "recent searches" chips).
- **Ranking:** each typed word is treated as a prefix of any stored word (so "wat" finds "claude monet water lilies"). The score combines:
  - word coverage (`matched words / typed words`)
  - a bonus when the stored query starts with the input
  - log-scaled hits
  - recency decay
- The exact current query is left out. The selector returns highlight segments that the dropdown renders.

## Project structure
```
src/app
├── core
│   ├── api/            game models, CheapShark query builder + mapping/dedupe (pure),
│   │                   Steam image URL builders (pure), CheapSharkApiService
│   ├── http/           error+retry / loading interceptors
│   └── state/          localStorage sync meta-reducer (versioned keys, legacy keys dropped)
├── shared/             ImgFallbackDirective, game formatting helpers (price, rating tones)
└── features
    ├── search
    │   ├── games.data-source.ts  CDK DataSource: entity list + infinite scroll via viewChange
    │   ├── store/      search feature (createFeature), query-history entity feature,
    │   │               actions (createActionGroup), effects, suggestion selectors
    │   └── components/ search-page, search-box (autocomplete), results-list (virtual scroll)
    └── annotations
        ├── geometry/   pure geometry: centroid, rotate, point-in-polygon, normalize...
        ├── store/      polygons entity feature + per-game selector factory
        └── components/ game-dialog (facts + toolbar), polygon-editor (canvas)
```

## Store
- `search`: transient. `EntityState<Game>` (results) plus the input, the active query, status, the pagination cursor and errors.
- `queryHistory`: `EntityState<QueryHistoryEntry>`, persisted.
- `annotations`: `EntityState<Polygon>` plus an `idsByGame` index, persisted.
- **Persistence:** keys are prefixed `playlens.v2.`. On `@ngrx/store/init` the meta-reducer first deletes keys of
  older versions (`artlens.*` painting annotations, `playlens.v1.*`) — the migration strategy is "drop" — then
  rehydrates. After that, it writes a slice only when its reference changes. Failures such as disabled storage or a full quota are ignored safely.
- Runtime checks (immutability and serializability) are on. Store DevTools are enabled.

## Tests
86 vitest specs in 14 files:
- CheapShark query builder (sanitising, 0-based paging, `X-Total-Page-Count` parsing incl. fallbacks)
- game mapping (stable ids, zero-as-unknown, best-deal comparison)
- `CheapSharkApiService` with `HttpTestingController` (strict `+` encoding, header → total pages, `cache: 'no-store'`)
- Steam image URL builders and fallback candidates
- error interceptor (backoff, 429 + `Retry-After`, friendly message after retries)
- `ImgFallbackDirective` (incl. same-content arrays), game formatting helpers, localStorage legacy-key purge
- search reducer on `@ngrx/entity` (API order, in-page and cross-page dedupe keeping the cheaper deal in place,
  duplicates-only pages keep the same `ids`/`entities` references, every search starts empty)
- `GamesDataSource` with a fake `CollectionViewer` (`Subject<ListRange>`) and `MockStore`: dispatches near the end,
  not while loading / without more pages, no duplicate dispatch for the same page, no loop after a failed page,
  continues after a duplicates-only page; plus an integration test with the real store + `SearchEffects`
- typeahead + next-page effects (incl. a repeated query is requested again), query history, suggestion
  selectors, geometry, annotations reducer

## Known limitations
- Some Steam apps (mostly newer ones, e.g. app 1651600) have no `header.jpg`/`library_hero.jpg` on the legacy
  `cdn.cloudflare.steamstatic.com/steam/apps/{id}/…` path (404; Steam moved them to hashed `store_item_assets`
  URLs). Those fall back to CheapShark's `thumb`, which can be small (e.g. 231×87). It is shown at its natural size,
  never upscaled or blurred, with a note in the dialog.
- Non-Steam games only have CheapShark's `thumb` (size varies by store).
- Polygons are normalised to the image that was displayed. If a game's preferred image becomes (un)available
  later, a different fallback image with another aspect ratio may be shown and old polygons won't line up.
- CheapShark has no relevance ranking or hit count; results are ordered by Steam reviews and the result count is
  shown in pages/deals. Deal data changes over time, so a game can move between pages (handled by the dedupe).
- "No caching" covers the app and the browser HTTP cache (`no-store`). CheapShark/Cloudflare may still serve a
  server-side cached response (`php-cache`, CDN headers); the app cannot control that.
- Without caching, every return to a previous query costs a request; CheapShark rate-limits per IP, which the
  429 backoff handles but the user may see the friendly rate-limit message on very fast query switching.
- Individual vertices can't be edited after a polygon is closed (only the whole polygon can be moved or rotated).
  There is no undo/redo.

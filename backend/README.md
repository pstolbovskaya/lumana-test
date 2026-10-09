# Backend: Service A, Service B and the report service

This is a NestJS 11 monorepo with two services and a shared library. A Go gRPC report
service sits next to them in [`report-service/`](report-service/README.md).

- **Service A** (`apps/service-a`, port 3001) downloads the Steam games catalog from
  [SteamSpy](https://steamspy.com/api.php) (`request=all`, 1000 games per page, rate limited
  to one request per minute) into JSON and XLSX files. It also ingests JSON or XLSX files
  into MongoDB (`games` collection) and serves a search API with cursor pagination. It
  records every API call in RedisTimeSeries and publishes each one as an event to Service B.
- **Service B** (`apps/service-b`, port 3002) receives those events over the NestJS Redis
  transporter and stores them in MongoDB. It has endpoints to query logs and get
  statistics. It builds PDF reports from the time-series data by calling the Go report
  service over gRPC.
- **libs/common** holds the shared code: the Mongo and Redis modules (official drivers),
  the TimeSeries wrapper, event contracts, the tracking interceptor, the exception filter,
  cursor pagination, env validation, health checks and the bootstrap code.

## Architecture

```
                        ┌──────────────────────────── docker compose ─────────────────────────────┐
                        │                                                                          │
  HTTP :3001            │  ┌───────────────────────┐   fetch (1 page / 60 s, retries, sequential)    │
 ─────────────────────────▶│      Service A        │──────────────────────────────▶ steamspy.com   │
  /games /datasets      │  │ ApiTrackingInterceptor│                                                │
                        │  │  (global)             │──stream──▶ /app/data/exports/*.json|*.xlsx     │
                        │  └───┬───────────┬───────┘            (volume service-a-data)             │
                        │      │ bulkWrite │ TS.ADD events:service-a:<action>:<2xx|4xx|5xx>         │
                        │      │ find      │        ON_DUPLICATE SUM, RETENTION, LABELS             │
                        │      ▼           ▼                                                         │
                        │  ┌────────┐   ┌──────────────────────────┐                                 │
                        │  │ MongoDB│   │ Redis Stack              │                                 │
                        │  │ service_a.games                       │                                 │
                        │  │ service_b.event_logs   ◀───┐  │ RedisTimeSeries + pub/sub channel       │
                        │  └────────┘   │  "api.event"  │          │                                 │
                        │      ▲        └──────┬────────┴──────────┘                                 │
                        │      │ upsert by id  │ @EventPattern('api.event')   (emit from A)          │
  HTTP :3002            │  ┌───┴───────────────▼───┐   TS.MRANGE FILTER service=service-a           │
 ─────────────────────────▶│      Service B        │             metric=requests AGGREGATION SUM    │
  /logs /reports        │  └───────────┬───────────┘                                                 │
                        │              │ gRPC report.ReportService/GenerateReport                    │
                        │              ▼                                                             │
                        │  ┌───────────────────────┐                                                 │
                        │  │ report-service (Go)   │──▶ PDF bytes ──▶ B streams application/pdf      │
                        │  │ :50051 (internal)     │                                                 │
                        │  └───────────────────────┘                                                 │
                        └──────────────────────────────────────────────────────────────────────────┘
```

### Repository layout

```
backend/
├── apps/
│   ├── service-a/src
│   │   ├── games/         repository (indexes, keyset search, idempotent bulk upsert), normaliser, DTOs
│   │   ├── datasets/      SteamSpy client + rate limiter, fetch jobs, streaming writers, JSON/XLSX parsers, ingest
│   │   └── config/        env schema (class-validator)
│   └── service-b/src
│       ├── logs/          @EventPattern consumer, repository (keyset query, $facet stats), DTOs
│       └── reports/       report window/buckets, gRPC client, PDF endpoint
├── libs/common/src
│   ├── mongo/             MongoModule.forRootAsync: MongoClient + Db providers, closes on shutdown
│   ├── redis/             RedisModule.forRootAsync: node-redis client, closes on shutdown
│   ├── timeseries/        TimeSeriesService (TS.ADD / TS.MRANGE), key and label builders
│   ├── events/            ApiEvent contract + runtime guard, channel name, DI tokens
│   ├── http/              ApiTrackingModule/Interceptor, ApiEventPublisher, request-id, exception filter
│   ├── pagination/        cursor encode/decode, keyset filter builder, query DTOs
│   ├── health/            /health (Mongo + Redis ping) and /health/live
│   ├── config/            BaseEnv + createEnvValidator
│   └── bootstrap/         createHttpApp(): logger, ValidationPipe, filter, Swagger, shutdown hooks
├── proto/report.proto     shared gRPC contract
└── report-service/        Go PDF renderer (separate README)
```

## Running

### Everything in Docker

```bash
# from the repository root
docker compose up -d --build
# Service A: http://localhost:3001/docs   Service B: http://localhost:3002/docs
docker compose down        # add -v to drop the Mongo, Redis and data volumes
```

Compose starts `mongo:7`, `redis/redis-stack-server` (which includes RedisTimeSeries),
`report-service`, `service-a` and `service-b`. Each one has a healthcheck, and the services
wait for `mongo` and `redis` to be healthy. Fetched files go to the `service-a-data` volume.
You can override `MAX_UPLOAD_MB`, `FETCH_DEFAULT_PAGES`, `STEAMSPY_MIN_INTERVAL_MS` and
`STEAMSPY_BASE_URL` from the shell.

### Running the services on the host

```bash
docker compose up -d mongo redis report-service   # report-service is only needed for PDFs
cd backend
npm ci
npm run build                 # builds both apps (webpack)
npm test                      # unit tests (jest)
npm run start:prod:a          # or: npm run start:dev:a
npm run start:prod:b          # needs REPORT_GRPC_URL=localhost:50051 and the port published, or skip PDFs
```

The defaults point to `localhost` for Mongo and Redis. Every variable is validated at
startup, and a bad value stops the service with a list of the problems.

| Variable | Service | Default |
|---|---|---|
| `PORT` | A, B | 3001 / 3002 |
| `MONGO_URI`, `MONGO_DB` | A, B | `mongodb://localhost:27017`, `service_a` / `service_b` |
| `REDIS_URL` | A, B | `redis://localhost:6379` |
| `TS_RETENTION_MS` | A, B | 7 days |
| `LOG_LEVEL` (`error`…`verbose`), `LOG_FORMAT` (`text`/`json`) | A, B | `log`, `text` |
| `DATA_DIR` | A | `./data` |
| `STEAMSPY_BASE_URL` | A | `https://steamspy.com/api.php` |
| `STEAMSPY_MIN_INTERVAL_MS` | A | 60000 (SteamSpy's limit for `request=all`; lower only against a mock) |
| `STEAMSPY_TIMEOUT_MS` | A | 30000 |
| `FETCH_USER_AGENT` | A | `lumana-test-service-a/1.0 (SteamSpy catalog importer; max 1 req/min)` |
| `FETCH_DEFAULT_PAGES`, `FETCH_MAX_PAGES`, `FETCH_MAX_RETRIES` | A | 3, 200, 4 |
| `MAX_UPLOAD_MB`, `INGEST_BATCH_SIZE` | A | 100, 1000 |
| `REPORT_GRPC_URL`, `REPORT_PROTO_PATH`, `REPORT_TIMEOUT_MS`, `REPORT_SOURCE_SERVICE` | B | `localhost:50051`, `proto/report.proto`, 30000, `service-a` |

## Endpoints

Swagger UI is at `/docs` on both services, and the OpenAPI JSON is at `/docs-json`.

### Service A (`:3001`)

| Method | Path | Description |
|---|---|---|
| POST | `/datasets/fetch` | Body `{ pages?, startPage?, format?: json\|xlsx\|both, fileName?, wait? }`. Downloads N SteamSpy pages (1000 games each, 0-based from `startPage`) into `DATA_DIR/exports`, one request per minute. Returns `202` with the job; with `wait=true` it blocks and returns `200` and the result. `409` if a running job already writes the same `fileName`. |
| GET | `/datasets/jobs`, `/datasets/jobs/:id` | Job status and progress: `pagesTotal`, `pagesDone`, `pagesFailed`, `records`, `currentPage`, `nextRequestAt`, `estimatedCompletionAt`, `retries`, `lastError`, `endOfCatalog`; when finished, `result` (files, records, failed pages). |
| DELETE | `/datasets/jobs/:id` | Cancels a running job (aborts the wait/request, discards its partial files). `409` if it is not running. |
| GET | `/datasets/files`, `/datasets/files/:fileName` | Lists or downloads exported files. |
| POST | `/datasets/ingest` | Body `{ fileName }`. Ingests an exported file by name, without uploading it. |
| POST | `/datasets/upload` | Multipart field `file` (.json or .xlsx). The upload is written to disk and then parsed as a stream. |
| GET | `/games` | Search. `q` (full text over name/developer/publisher), `developer`, `publisher` (exact, case-insensitive), `minPriceCents`/`maxPriceCents`, `freeOnly`, `minReviewScore` (0–100), `minOwners` (lower bound of the owners range), `sortBy=_id\|appid\|name\|ccu\|positive\|reviewScore\|priceCents`, `order` (default `desc` for ccu/positive/reviewScore, else `asc`), `limit` (≤200), `cursor`. Returns `{ items, nextCursor, limit }`. |
| GET | `/games/:appid` | Gets one game by its Steam app id. |
| GET | `/health`, `/health/live` | Readiness (Mongo and Redis ping) and liveness. Not tracked. |

Ingest returns a summary: `totalRows`, `validRows`, `invalidRows`, `duplicateRows`,
`inserted`, `updated`, `unchanged`, `failedWrites`, `batches`, and `errors[]` with the row
number, id and every validation message (the first 100 are kept, the rest are counted).
If the file can't be parsed, the response is `422`. Rows read before the failure are still
written, and the partial summary is in `details.summary`. A file over the size limit gets
`413`, and an unsupported file type gets `400`.

### Service B (`:3002`)

| Method | Path | Description |
|---|---|---|
| GET | `/logs` | Filters: `from`, `to` (ISO-8601 or epoch ms), `type`, `service`, `action`, `method`, `statusCode`. Plus `limit`, `cursor` and `order` (by timestamp, default `desc`). |
| GET | `/logs/stats` | Same filters. Returns totals, error count, average latency, and breakdowns per action (count, errors, avg, p95, max latency), per status code, per service and per type. |
| GET | `/logs/:id` | One event. |
| GET | `/reports/pdf?from=&to=&bucketMs=&title=` | PDF report (`application/pdf`). Defaults: the last hour, with a bucket size chosen automatically for about 60 buckets. |
| GET | `/reports/data?…` | The same input that is sent to the report service, as JSON. Useful for debugging and for frontend charts. |

### Example session

```bash
# 3 pages = 3000 games, ~2 minutes (page 0 immediately, then one page per minute)
curl -X POST localhost:3001/datasets/fetch -H 'content-type: application/json' \
     -d '{"pages":3,"format":"both","fileName":"games-sample"}'          # 202 {id, progress...}
curl localhost:3001/datasets/jobs/<id>     # poll: progress.pagesDone, nextRequestAt, estimatedCompletionAt
curl -X POST localhost:3001/datasets/ingest -H 'content-type: application/json' -d '{"fileName":"games-sample.json"}'
curl -o games-sample.xlsx localhost:3001/datasets/files/games-sample.xlsx
curl -F file=@games-sample.xlsx localhost:3001/datasets/upload       # same data -> all "unchanged"
curl 'localhost:3001/games?q=strike&minReviewScore=80&sortBy=ccu&limit=5'
curl 'localhost:3001/games?developer=valve&sortBy=positive&limit=5&cursor=<nextCursor>'
curl 'localhost:3001/games?freeOnly=true&minOwners=1000000&sortBy=reviewScore'
curl localhost:3001/games/730
curl 'localhost:3002/logs?service=service-a&statusCode=400'
curl 'localhost:3002/logs/stats?from=2026-10-07T00:00:00Z'
curl -o report.pdf 'localhost:3002/reports/pdf?bucketMs=60000'
docker compose exec redis redis-cli TS.MRANGE - + WITHLABELS AGGREGATION sum 60000 FILTER service=service-a
```

## Design decisions

**Official drivers only.** `MongoModule` and `RedisModule` are small dynamic modules
around `mongodb` and `redis` (node-redis, which has typed `ts.*` commands). Repositories
take `Db` through `@InjectDb()`. Both clients close in `onApplicationShutdown`, and
`enableShutdownHooks()` is on, so a SIGTERM from Docker drains the service cleanly. The
NestJS Redis *transporter* uses `ioredis` internally. That package is required only by
`@nestjs/microservices`, and our own code never uses it.

**Data source and rate limiting.** SteamSpy's `GET api.php?request=all&page=N` (0-based)
returns an object keyed by appid with up to 1000 games per page and needs no key, but it
allows **one `request=all` call per 60 seconds**. The client therefore:
- sends every attempt, retries included, through one process-wide `RateLimiter`. The
  limiter hands out request slots in call order, at least `STEAMSPY_MIN_INTERVAL_MS` apart
  (60 s by default). Two jobs running at once share it, so SteamSpy never sees more than
  one request per interval from this service. The effective concurrency towards the
  source is 1;
- fetches pages strictly one after another and stops at the first empty page (`{}` marks
  the end of the catalog, reported as `progress.endOfCatalog`);
- retries `429`, `408`, `5xx`, network errors, timeouts (`STEAMSPY_TIMEOUT_MS`) and
  malformed bodies (HTML error pages, `{error: …}`) up to `FETCH_MAX_RETRIES` times. The wait
  is the larger of the regular interval, capped exponential backoff with full jitter
  (5 s base, 5 min cap) and `Retry-After`. Other `4xx` codes fail the page right away;
- sends a descriptive `User-Agent` (`FETCH_USER_AGENT`).

A page that still fails after its retries is listed in `failedPages` and the job moves on.
After 3 failed pages in a row the job stops. If no page succeeded at all, the job fails.
The job status shows `pagesDone`, `currentPage`, `nextRequestAt` (when the limiter allows
the next request) and `estimatedCompletionAt` (rough: next slot + remaining pages ×
interval), as well as `retries` and `lastError`. `DELETE /datasets/jobs/:id` cancels a job
through an `AbortSignal`, which interrupts the limiter wait or the request in flight.
With 60 s spacing, N pages take about N−1 minutes, so `wait=true` only makes sense for
one or two pages. Use the 202 job and poll it instead.

**Bounded memory and safe files.** Each row is projected to the SteamSpy columns (`appid,
name, developer, publisher, score_rank, positive, negative, userscore, owners,
average_forever, average_2weeks, median_forever, median_2weeks, price, initialprice,
discount, ccu`) and written to a `JsonArrayWriter`, which streams a JSON array and waits
for `drain`, and/or to an ExcelJS `WorkbookWriter` (sheet `games`) that commits each row.
Exports keep the raw SteamSpy values, so a file is an exact snapshot of the source;
normalisation happens at ingest. Memory use is about one page. Writers write to a
**unique** temp file `<name>.<uuid>.part` and rename it only on success. Starting a job
whose `fileName` is already being written by a running job is rejected with `409`. When a
job finishes it publishes a `job.completed`/`job.failed` event, so Service B logs it too.

**Robust ingest.** The parsers are async generators. JSON goes through `stream-json`
(a top-level array, or a `{ data: [...] }` wrapper, detected by peeking at the first byte).
XLSX goes through ExcelJS's streaming `WorkbookReader`, with row 1 as the header; rich text,
formula results and dates are flattened. Uploads go to disk through multer with a hard
`fileSize` limit and are never held in memory. Each row is validated and normalised by a
pure function (`normalizeGame`) that reports every problem at once:
- `appid` must be a positive integer, `name` must not be empty, and `owners` must parse as
  `"a .. b"` with a ≤ b (thousands separators allowed; a single number is accepted);
- counters (`positive`, `negative`, playtimes, `ccu`) must be finite non-negative integers.
  When missing they default to 0, SteamSpy's own "no data" value. `discount` must be in
  0–100. A missing `price`/`initialprice` stays `null` (unknown, not free);
- spreadsheet strings are converted to numbers, and the normalised camelCase names
  (`priceCents`, `averagePlaytime`, …) are accepted as aliases.

The stored document has `appid, name, developer, publisher, positive, negative,
reviewScore` (positive/(positive+negative) in %, one decimal, `null` without reviews),
`ownersMin, ownersMax, averagePlaytime, medianPlaytime` (minutes), `priceCents,
initialPriceCents, discountPercent, ccu`, plus `headerImageUrl`/`heroImageUrl`
(`https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg` and
`…/library_hero.jpg`), and the lower-cased `developerKey`/`publisherKey` used for
filtering. Valid rows are batched (1000 by default) and de-duplicated by `appid` inside
the batch (the last row wins). Each batch is written with `bulkWrite({ ordered: false })`,
so one bad document doesn't block the rest. The write is an **upsert keyed by `appid`**,
which has a unique index. It uses a pipeline update with a content hash, so re-ingesting
the same data is a real no-op: you get `unchanged` instead of `updated`, and `updatedAt`
stays the same.

**Search and pagination.** Search uses keyset (seek) pagination on `(sortField, _id)`.
`skip` is never used, so a deep page costs the same as the first one. The cursor is opaque
base64url JSON `{s, o, v, id}`. A cursor issued for a different sort or order is rejected
with `400`. MongoDB puts `null` first when sorting ascending, so the keyset predicate
handles a block of null sort values explicitly: games without reviews (`reviewScore:
null`) or without a price are neither skipped nor repeated. A unit test simulates the
ordering and checks this. Sorts: `_id`, `appid`, `name`, `ccu`, `positive`,
`reviewScore`, `priceCents`, each ascending or descending. Relevance (`$meta:
textScore`) ordering is not offered, because the text score is not a stored field and so
it can't be used in a keyset cursor. Indexes are generated from the list of sorts
(`gameIndexes()`), so a new sort can't ship without its index; a unit test checks this
for every sort in both directions:
- `uniq_appid`, and a weighted text index (name 10 > developer 4 > publisher 2);
- `{sortField: 1, _id: 1}` for every sort. One index serves both directions by scanning
  backwards. (The old artworks API offered `sortBy=artworkId` without a `{artworkId,_id}`
  index, which led to an in-memory sort; that gap is closed now.)
- `{developerKey|publisherKey: 1, sortField: 1, _id: 1}` for every sort (equality → sort,
  the ESR rule), so a developer or publisher filter combined with any sort is still
  served in index order.

Range filters (price, `minReviewScore`, `minOwners`) and `freeOnly` are applied as residual
predicates while walking the sort index. That trades some extra key reads for never
sorting in memory. For very selective ranges, the planner may pick a different index.
Two details keep the plans index-ordered:
- Without `q`, the query is **hinted** to the matching `(equality?, sortField, _id)`
  index (`sortIndexHint()`). Without the hint, the profiler showed the planner sometimes
  answering one branch of the keyset `$or` from `{developerKey,_id}`, followed by an
  in-memory SORT.
- For the unique `appid` sort, the cursor predicate is a plain range (`appid > v`). The
  generic `(v, _id)` form made the planner pick `uniq_appid` for the equality branch,
  which also caused a SORT.

Checked against the 3000-game SteamSpy sample with the Mongo profiler on, walking every
sort in both directions page by page (limit 7) under 8 filter combinations (none,
developer, publisher, price + score + owners ranges, freeOnly, developer + score, `q`,
`q` + developer). Every walk returned each matching document exactly once and in order.
Of 9590 non-text queries, **0** had a SORT stage or a COLLSCAN. An unfiltered page read
at most 9 index keys and 16 documents for 8 results. Text queries (`q`) use the text index
and always sort their matches in memory (see trade-offs).

**Tracking every API call.** `ApiTrackingModule` registers a global interceptor. It records
on the response's `finish`/`close` event, so the status code is the real final one,
including codes set by the exception filter, `@HttpCode` or aborted requests (`499`). Each
call produces two things:
1. `TS.ADD events:<service>:<action>:<statusClass> <ts> 1 RETENTION <ms> ON_DUPLICATE SUM
   LABELS metric requests service … action … status …`. There is one series per status
   class because RedisTimeSeries labels can't change after a key is created.
   `ON_DUPLICATE SUM` makes two hits in the same millisecond add up instead of being
   rejected.
2. `emit('api.event', ApiEvent)` through the Redis transporter. The event carries `id`
   (a **server-generated UUID**, see below), `type`, `service`, `action`, `method`,
   the route template as `path` (low cardinality), `statusCode`, `durationMs`, `timestamp`
   and `metadata`. The metadata includes the query, params, user agent and error message,
   and handlers can add business data with `addEventMetadata()`, such as an ingest summary
   or a job id. The request id (`x-request-id`, client-supplied or generated) is kept as
   `metadata.requestId` for correlation. It is deliberately **not** the event id: the
   header is client-controlled, and Service B dedupes on the event id, so a client that
   reused a request id would otherwise have its later events silently dropped.

An action is named by `@TrackAction('games.search')`, or derived as
`<controller>.<handler>`. `@SkipTracking()` excludes health probes. Telemetry failures are
logged and never change the API response. Service B uses the same interceptor with
`emitEvents: false`, so its own metrics show up as `events:service-b:*`.

**Event consumption.** Service B is a hybrid app (HTTP plus a Redis microservice). It
checks each payload with a runtime type guard, because data crossing a process boundary is
untrusted. Storage is idempotent: an upsert on `_id = event.id` with `$setOnInsert`, so a
redelivered event is a no-op. Indexes: `{timestamp,_id}`, and `{type|service|action|
statusCode, timestamp, _id}`. Stats use a single `$facet` aggregation, with
`$percentile` for p95 (this needs MongoDB 7 or later).

**Reports.** B resolves the window (to = now, from = to − 1 h by default, and a "nice"
bucket that gives about 60 buckets). It rejects windows that are inverted, longer than
366 days, or have more than 2000 buckets. It runs `TS.MRANGE … WITHLABELS ALIGN from
AGGREGATION SUM bucket FILTER service=service-a metric=requests` and the per-action count
from Mongo in parallel. It fills empty buckets with zero, so a quiet period shows as a dip
in the chart rather than a line drawn straight across it, and caps the request at 100
series (the rest are folded into "Other"). Then it calls `ReportService/GenerateReport` with a
deadline. gRPC errors are mapped to HTTP codes: `UNAVAILABLE` → 503,
`DEADLINE_EXCEEDED` → 504, `INVALID_ARGUMENT` → 400, anything else → 502.

**Cross-cutting.** Every service has env validation that stops startup on bad values, a
global `ValidationPipe` (whitelist, forbid unknown fields, transform), a uniform error
format `{statusCode, error, message, path, requestId, timestamp, details?}`, request-id
propagation, a Nest `ConsoleLogger` (JSON output in Docker), and multi-stage Docker images
that run as the non-root `node` user and include only production dependencies.

### Trade-offs and possible next steps

- **Redis pub/sub delivers at most once.** If Service B is down, events published in that
  time are lost; the RedisTimeSeries counters are not affected. That is the trade-off of
  the required Nest Redis transporter. A Redis Streams consumer group, or an outbox in
  Service A, would give at-least-once delivery, and B's idempotent upsert is already
  ready for that.
- Fetch jobs live in memory, so a restart forgets job status. The files themselves are
  kept on the volume. A Mongo-backed job collection would fix this.
- `$text` search combined with any sort sorts the text matches in memory (a `TEXT_MATCH`
  followed by `SORT`). A text index can't supply a different sort order. That is fine for
  the text-match set of a ~100k-game catalog; Atlas Search or a dedicated search engine
  would scale better. Without `q`, every sort is index-ordered.
- A full catalog download is about 90+ pages, which takes about 1.5 hours at SteamSpy's
  rate limit. Jobs can be resumed by hand with `startPage`, but there is no automatic
  resume after a restart.
- SteamSpy's `request=all` currently returns `0` for every playtime field
  (`average_forever`, `median_forever`, and the 2-week values): 0 of the 3000 sampled rows
  had a non-zero value. `averagePlaytime`/`medianPlaytime` are stored as given. Real
  values would need the per-app `request=appdetails` call, at a much higher request cost.
- SteamSpy returns HTML-escaped text (`EA Canada &amp; EA Romania`). The normaliser
  decodes entities once, so the JSON and XLSX paths store identical documents. Before this
  was fixed, re-uploading the XLSX export "updated" 3 of 3000 rows.
- `minOwners` compares against the lower bound of SteamSpy's owners bucket
  (`ownersMin >= minOwners`), because SteamSpy only publishes ranges.
- Uploads are parsed synchronously in the request. Very large files would be better as an
  upload followed by an asynchronous ingest job, like the fetch job.

## Tests

`npm test` runs 132 unit tests in 14 suites:
- cursor encode/decode/validation, and the keyset filter including null handling, with an
  exhaustive pagination simulation
- TS key and label building, and normalising `TS.MRANGE` replies (Map or object)
- the event contract guard, action-name derivation, and the tracking interceptor: a reused
  `x-request-id` still produces distinct server-generated event ids, and the request id
  is kept in `metadata.requestId`
- abortable `sleep`, backoff, time parsing and Redis URL parsing
- the `RateLimiter`, using Jest fake timers: never early, spacing for queued callers,
  `defer()` for backoff and `Retry-After` (including while a caller is waiting), abort
  frees the queue, interval 0
- the SteamSpy client, with a mocked `fetch` and fake timers: URL and `User-Agent`;
  retries of 429/503 spaced by max(interval, `Retry-After`); no retry on 404; giving up
  after `FETCH_MAX_RETRIES`; non-JSON bodies; cancellation; `parseAllPage` and
  `parseRetryAfter`
- the fetch job: sequential pages, stopping at the first empty page, JSON and XLSX output,
  `startPage`, failed pages, stopping after 3 consecutive failures, `409` for a duplicate
  running `fileName`, cancellation discarding temp files
- the game normaliser: a real SteamSpy row, owners-range parsing (valid and invalid),
  HTML-entity decoding, image URLs, coercion, defaults, and collecting every error of a
  bad row
- `buildGameFilter`, the keyset predicate, index hints, and a check that every sort, in
  both directions and behind every equality filter, has a matching index
- the JSON parsers (array, `{data}`, malformed input, BOM), an XLSX write → read round trip,
  and cell flattening
- the ingest pipeline (batching, de-duplication by `appid`, write errors, error cap,
  partial failure)
- the report window, bucket choice, zero-filling and series capping

# Lumana test assignment

| Part | Path | Stack |
|---|---|---|
| Frontend | [`frontend/`](frontend/README.md) | Angular 22, NgRx (store/effects/entity), Angular Material/CDK, Canvas |
| Service A & B | [`backend/`](backend/README.md) | NestJS 11 monorepo, MongoDB & Redis official drivers, RedisTimeSeries, Redis transport, Swagger |
| Report service (bonus) | [`backend/report-service/`](backend/report-service/README.md) | Go 1.25, gRPC, fpdf |
| gRPC contract | [`backend/proto/report.proto`](backend/proto/report.proto) | proto3 |

```
Angular SPA ──► cheapshark.com (typeahead search) + Steam CDN (images by appid)

            HTTP                 Redis pub/sub events            gRPC
 client ──► Service A :3001 ───────────────────────► Service B :3002 ───► report-service :50051 (Go, PDF)
              │  │                                    │   │
              │  └─ TS.ADD ──► Redis Stack (TimeSeries) ◄─┘ TS.MRANGE
              ├──► MongoDB (games)                    └──► MongoDB (logs)
              └──► steamspy.com (request=all, 1 page / 60 s)
```

## Run

```bash
# backend: mongo, redis-stack, service-a, service-b, report-service
docker compose up -d --build
# Swagger: http://localhost:3001/docs  http://localhost:3002/docs

# frontend
cd frontend && npm install && npm start   # http://localhost:4200
```

## Smoke test

```bash
# SteamSpy allows one request=all call per minute: 3 pages (3000 games) take ~2 minutes.
curl -X POST localhost:3001/datasets/fetch -H 'content-type: application/json' -d '{"pages":3,"format":"both","fileName":"smoke"}'
curl localhost:3001/datasets/jobs/<id>      # poll until "status":"completed" (progress.pagesDone, nextRequestAt)
curl -X POST localhost:3001/datasets/ingest -H 'content-type: application/json' -d '{"fileName":"smoke.json"}'
curl -o smoke.xlsx localhost:3001/datasets/files/smoke.xlsx && curl -F file=@smoke.xlsx localhost:3001/datasets/upload
curl "localhost:3001/games?q=strike&sortBy=ccu&limit=5"      # follow nextCursor
curl "localhost:3001/games?developer=valve&minReviewScore=80&sortBy=positive"
curl localhost:3001/games/730
curl "localhost:3002/logs?limit=5"; curl localhost:3002/logs/stats
curl -o report.pdf localhost:3002/reports/pdf
```

# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS build
WORKDIR /src
ENV CGO_ENABLED=0 GOFLAGS=-buildvcs=false

ARG GRPC_HEALTH_PROBE_VERSION=v0.4.40
RUN --mount=type=cache,target=/root/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    GOBIN=/out go install github.com/grpc-ecosystem/grpc-health-probe@${GRPC_HEALTH_PROBE_VERSION} \
    && mv /out/grpc-health-probe /out/grpc_health_probe

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/root/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/root/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/report-service ./cmd/server \
    && go build -trimpath -ldflags="-s -w" -o /out/sampleclient ./cmd/sampleclient

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/report-service /report-service
COPY --from=build /out/sampleclient /sampleclient
COPY --from=build /out/grpc_health_probe /grpc_health_probe
ENV GRPC_PORT=50051
EXPOSE 50051
USER nonroot:nonroot
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD ["/grpc_health_probe", "-addr=127.0.0.1:50051", "-connect-timeout=2s", "-rpc-timeout=2s"]
ENTRYPOINT ["/report-service"]

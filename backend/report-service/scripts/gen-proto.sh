#!/usr/bin/env bash
set -euo pipefail
SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$(cd "$SERVICE_DIR/.." && pwd)"
GO_IMAGE="${GO_IMAGE:-golang:1.25}"

docker run --rm \
  -u "$(id -u):$(id -g)" -e HOME=/tmp -e GOCACHE=/tmp/gocache -e GOPATH=/tmp/gopath \
  -v "$BACKEND_DIR":/work -w /work/report-service \
  "$GO_IMAGE" bash -euc '
    PROTOC_VERSION=29.3
    PROTOC_GEN_GO_VERSION=v1.36.6
    PROTOC_GEN_GO_GRPC_VERSION=v1.5.1
    curl -sSL -o /tmp/protoc.zip "https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-linux-x86_64.zip"
    python3 -m zipfile -e /tmp/protoc.zip /tmp/protoc
    chmod +x /tmp/protoc/bin/protoc
    go install google.golang.org/protobuf/cmd/protoc-gen-go@${PROTOC_GEN_GO_VERSION}
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@${PROTOC_GEN_GO_GRPC_VERSION}
    export PATH="/tmp/gopath/bin:/tmp/protoc/bin:$PATH"
    rm -f gen/reportpb/*.pb.go
    protoc -I /work/proto -I /tmp/protoc/include \
      --go_out=gen/reportpb --go_opt=paths=source_relative \
      --go-grpc_out=gen/reportpb --go-grpc_opt=paths=source_relative \
      /work/proto/report.proto
    ls -l gen/reportpb
  '

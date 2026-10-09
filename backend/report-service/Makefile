GO_IMAGE ?= golang:1.25
IMAGE    ?= lumana/report-service:dev
NETWORK  ?= report-sample-net
DOCKER_GO = docker run --rm -u $$(id -u):$$(id -g) -e HOME=/tmp -e GOCACHE=/tmp/.cache/go-build \
            -e GOMODCACHE=/tmp/.cache/gomod -e GOFLAGS=-buildvcs=false \
            -v $(CURDIR)/.cache:/tmp/.cache -v $(CURDIR):/src -w /src $(GO_IMAGE)

.PHONY: proto tidy fmt vet test build docker sample clean

proto:
	./scripts/gen-proto.sh

tidy:
	@mkdir -p .cache && $(DOCKER_GO) go mod tidy

fmt:
	@mkdir -p .cache && $(DOCKER_GO) gofmt -w cmd internal

vet:
	@mkdir -p .cache && $(DOCKER_GO) go vet ./...

test:
	@mkdir -p .cache && $(DOCKER_GO) go test -race ./...

build:
	@mkdir -p .cache && $(DOCKER_GO) sh -c 'go build -o bin/report-service ./cmd/server && go build -o bin/sampleclient ./cmd/sampleclient'

docker:
	docker build -t $(IMAGE) .

sample: docker
	-docker network create $(NETWORK) >/dev/null 2>&1
	-docker rm -f report-sample >/dev/null 2>&1
	docker run -d --name report-sample --network $(NETWORK) $(IMAGE) >/dev/null
	sleep 1
	docker run --rm --network $(NETWORK) -u $$(id -u):$$(id -g) -v $(CURDIR)/docs:/out --entrypoint /sampleclient $(IMAGE) \
		-addr report-sample:50051 -out /out/sample-report.pdf
	docker run --rm --network $(NETWORK) -u $$(id -u):$$(id -g) -v $(CURDIR)/docs:/out --entrypoint /sampleclient $(IMAGE) \
		-addr report-sample:50051 -out /out/sample-report-empty.pdf -empty
	docker rm -f report-sample >/dev/null

clean:
	-chmod -R u+w .cache 2>/dev/null; rm -rf bin .cache

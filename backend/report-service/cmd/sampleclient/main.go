package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"github.com/lumana-test/report-service/gen/reportpb"
)

func main() {
	addr := flag.String("addr", "localhost:50051", "report service address")
	out := flag.String("out", "sample.pdf", "output file")
	empty := flag.Bool("empty", false, "send a request without any data")
	hours := flag.Int("hours", 24, "report period length in hours")
	nSeries := flag.Int("series", 3, "number of series (1-12)")
	end := flag.String("end", "2026-10-06T00:00:00Z", "period end (RFC3339); empty = now")
	flag.Parse()

	req := buildRequest(*hours, *nSeries, *end, *empty)

	conn, err := grpc.NewClient(*addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	start := time.Now()
	resp, err := reportpb.NewReportServiceClient(conn).GenerateReport(ctx, req)
	if err != nil {
		log.Fatalf("GenerateReport: %v", err)
	}
	if err := os.WriteFile(*out, resp.GetPdf(), 0o644); err != nil {
		log.Fatalf("write: %v", err)
	}
	fmt.Printf("wrote %s (%d bytes, server filename %q) in %s\n", *out, len(resp.GetPdf()), resp.GetFilename(), time.Since(start).Round(time.Millisecond))
}

var actions = []struct{ key, label string }{
	{"events:service-a:search", "Search requests"},
	{"events:service-a:view", "Item views"},
	{"events:service-a:click", "Clicks"},
	{"events:service-a:login", "Logins"},
	{"events:service-a:checkout", "Checkouts"},
	{"events:service-a:upload", "File uploads"},
	{"events:service-a:share", "Shares"},
	{"events:service-a:comment", "Comments"},
	{"events:service-a:export", "Exports"},
	{"events:service-a:delete", "Deletions"},
	{"events:service-a:logout", "Logouts"},
	{"events:service-a:error", "Errors"},
}

func buildRequest(hours, nSeries int, endStr string, empty bool) *reportpb.GenerateReportRequest {
	end := time.Now().UTC().Truncate(time.Hour)
	if endStr != "" {
		t, err := time.Parse(time.RFC3339, endStr)
		if err != nil {
			log.Fatalf("bad -end: %v", err)
		}
		end = t
	}
	from := end.Add(-time.Duration(hours) * time.Hour)
	bucket := time.Hour
	if hours <= 6 {
		bucket = 5 * time.Minute
	} else if hours > 24*7 {
		bucket = 6 * time.Hour
	}
	req := &reportpb.GenerateReportRequest{
		Title:    "Service A — User Activity",
		FromMs:   from.UnixMilli(),
		ToMs:     end.UnixMilli(),
		BucketMs: bucket.Milliseconds(),
	}
	if empty {
		return req
	}
	nSeries = max(1, min(nSeries, len(actions)))
	rng := rand.New(rand.NewSource(42))
	for i := 0; i < nSeries; i++ {
		a := actions[i]
		base := 120.0 / float64(i+1)
		s := &reportpb.Series{
			Key:    a.key,
			Label:  a.label,
			Labels: map[string]string{"service": "service-a", "action": a.key[len("events:service-a:"):]},
		}
		for t := from; t.Before(end); t = t.Add(bucket) {
			h := float64(t.Hour()) + float64(t.Minute())/60
			daily := 0.55 + 0.45*math.Sin((h-9)/24*2*math.Pi)
			v := math.Round(base*daily*(0.85+0.3*rng.Float64())) * float64(bucket/time.Hour+1)
			if v < 0 {
				v = 0
			}
			s.Points = append(s.Points, &reportpb.DataPoint{TimestampMs: t.UnixMilli(), Value: v})
		}
		req.Series = append(req.Series, s)
	}
	for _, s := range req.Series {
		var total float64
		for _, p := range s.Points {
			total += p.Value
		}
		req.LogSummary = append(req.LogSummary, &reportpb.LogSummary{Type: s.Labels["action"], Count: int64(total)})
	}
	if nSeries < 9 {
		req.LogSummary = append(req.LogSummary,
			&reportpb.LogSummary{Type: "export", Count: 112},
			&reportpb.LogSummary{Type: "error", Count: 37},
		)
	}
	return req
}

package server

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"math"
	"net"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	"github.com/lumana-test/report-service/gen/reportpb"
	"github.com/lumana-test/report-service/internal/report"
)

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func validReq() *reportpb.GenerateReportRequest {
	from := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	return &reportpb.GenerateReportRequest{
		Title:    "Test",
		FromMs:   from.UnixMilli(),
		ToMs:     from.Add(time.Hour).UnixMilli(),
		BucketMs: time.Minute.Milliseconds(),
		Series: []*reportpb.Series{{
			Key:    "events:a:search",
			Label:  "Search",
			Points: []*reportpb.DataPoint{{TimestampMs: from.UnixMilli(), Value: 3}},
		}},
		LogSummary: []*reportpb.LogSummary{{Type: "search", Count: 3}},
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(r *reportpb.GenerateReportRequest)
		errHas string
	}{
		{"valid", func(r *reportpb.GenerateReportRequest) {}, ""},
		{"empty data is valid", func(r *reportpb.GenerateReportRequest) { r.Series, r.LogSummary = nil, nil }, ""},
		{"zero bucket is valid", func(r *reportpb.GenerateReportRequest) { r.BucketMs = 0 }, ""},
		{"missing from", func(r *reportpb.GenerateReportRequest) { r.FromMs = 0 }, "from_ms"},
		{"to before from", func(r *reportpb.GenerateReportRequest) { r.ToMs = r.FromMs - 1 }, "to_ms"},
		{"to equals from", func(r *reportpb.GenerateReportRequest) { r.ToMs = r.FromMs }, "to_ms"},
		{"period too long", func(r *reportpb.GenerateReportRequest) { r.ToMs = r.FromMs + (400 * 24 * time.Hour).Milliseconds() }, "period"},
		{"negative bucket", func(r *reportpb.GenerateReportRequest) { r.BucketMs = -1 }, "bucket_ms"},
		{"bucket larger than period", func(r *reportpb.GenerateReportRequest) { r.BucketMs = r.ToMs - r.FromMs + 1 }, "bucket_ms"},
		{"title too long", func(r *reportpb.GenerateReportRequest) { r.Title = strings.Repeat("x", MaxTitleLen+1) }, "title"},
		{"invalid utf8 title", func(r *reportpb.GenerateReportRequest) { r.Title = "\xff" }, "UTF-8"},
		{"series without key or label", func(r *reportpb.GenerateReportRequest) { r.Series[0].Key, r.Series[0].Label = "", " " }, "key or label"},
		{"NaN value", func(r *reportpb.GenerateReportRequest) { r.Series[0].Points[0].Value = math.NaN() }, "finite"},
		{"Inf value", func(r *reportpb.GenerateReportRequest) { r.Series[0].Points[0].Value = math.Inf(1) }, "finite"},
		{"bad timestamp", func(r *reportpb.GenerateReportRequest) { r.Series[0].Points[0].TimestampMs = -5 }, "timestamp_ms"},
		{"negative count", func(r *reportpb.GenerateReportRequest) { r.LogSummary[0].Count = -1 }, "count"},
		{"too many series", func(r *reportpb.GenerateReportRequest) {
			r.Series = make([]*reportpb.Series, MaxSeries+1)
			for i := range r.Series {
				r.Series[i] = &reportpb.Series{Key: "k"}
			}
		}, "too many series"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := validReq()
			c.mutate(r)
			err := Validate(r)
			if c.errHas == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.errHas) {
				t.Fatalf("error = %v, want containing %q", err, c.errHas)
			}
		})
	}
	if Validate(nil) == nil {
		t.Fatal("nil request should be invalid")
	}
}

func TestGenerateReport_InvalidArgument(t *testing.T) {
	called := false
	s := New(quiet, WithBuilder(func(report.Input) ([]byte, error) { called = true; return nil, nil }))
	r := validReq()
	r.ToMs = r.FromMs
	_, err := s.GenerateReport(context.Background(), r)
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument (err=%v)", status.Code(err), err)
	}
	if called {
		t.Fatal("builder must not be called for invalid requests")
	}
}

func TestGenerateReport_BuilderErrorIsInternal(t *testing.T) {
	s := New(quiet, WithBuilder(func(report.Input) ([]byte, error) { return nil, errors.New("boom") }))
	_, err := s.GenerateReport(context.Background(), validReq())
	if status.Code(err) != codes.Internal {
		t.Fatalf("code = %v, want Internal", status.Code(err))
	}
}

func TestGenerateReport_PassesConvertedInput(t *testing.T) {
	var got report.Input
	s := New(quiet, WithBuilder(func(in report.Input) ([]byte, error) { got = in; return []byte("%PDF-fake"), nil }))
	resp, err := s.GenerateReport(context.Background(), validReq())
	if err != nil {
		t.Fatal(err)
	}
	if got.Bucket != time.Minute || len(got.Series) != 1 || got.Series[0].Points[0].Value != 3 || got.LogSummary[0].Count != 3 {
		t.Fatalf("unexpected input: %+v", got)
	}
	if resp.GetFilename() != "report_20261005T0000Z_20261005T0100Z.pdf" {
		t.Fatalf("filename = %q", resp.GetFilename())
	}
}

func TestGRPCEndToEnd(t *testing.T) {
	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer(grpc.ChainUnaryInterceptor(RecoveryInterceptor(quiet), LoggingInterceptor(quiet)))
	reportpb.RegisterReportServiceServer(srv, New(quiet))
	go func() { _ = srv.Serve(lis) }()
	defer srv.Stop()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) { return lis.DialContext(ctx) }),
		grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := reportpb.NewReportServiceClient(conn)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	resp, err := client.GenerateReport(ctx, validReq())
	if err != nil {
		t.Fatalf("GenerateReport: %v", err)
	}
	if !bytes.HasPrefix(resp.GetPdf(), []byte("%PDF-")) {
		t.Fatal("response is not a PDF")
	}

	bad := validReq()
	bad.FromMs = 0
	if _, err := client.GenerateReport(ctx, bad); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", status.Code(err))
	}
}

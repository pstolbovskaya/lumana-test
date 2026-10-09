package server

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/lumana-test/report-service/gen/reportpb"
	"github.com/lumana-test/report-service/internal/report"
)

const (
	MaxTitleLen        = 200
	MaxSeries          = 100
	MaxPointsPerSeries = 50_000
	MaxTotalPoints     = 200_000
	MaxLogTypes        = 1_000
	MaxPeriod          = 366 * 24 * time.Hour
)

type BuildFunc func(report.Input) ([]byte, error)

type ReportServer struct {
	reportpb.UnimplementedReportServiceServer
	log      *slog.Logger
	build    BuildFunc
	location *time.Location
	now      func() time.Time
}

type Option func(*ReportServer)

func WithLocation(loc *time.Location) Option { return func(s *ReportServer) { s.location = loc } }

func WithBuilder(f BuildFunc) Option { return func(s *ReportServer) { s.build = f } }

func New(log *slog.Logger, opts ...Option) *ReportServer {
	s := &ReportServer{log: log, build: report.Build, location: time.UTC, now: time.Now}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *ReportServer) GenerateReport(ctx context.Context, req *reportpb.GenerateReportRequest) (*reportpb.GenerateReportResponse, error) {
	if err := Validate(req); err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}

	in := ToInput(req)
	in.Location = s.location
	in.GeneratedAt = s.now()

	start := time.Now()
	pdf, err := s.build(in)
	if err != nil {
		s.log.ErrorContext(ctx, "report generation failed", "err", err)
		return nil, status.Error(codes.Internal, "failed to generate report")
	}
	filename := report.Filename(in)
	s.log.InfoContext(ctx, "report generated",
		"filename", filename,
		"series", len(req.GetSeries()),
		"log_types", len(req.GetLogSummary()),
		"bytes", len(pdf),
		"render_ms", time.Since(start).Milliseconds(),
	)
	return &reportpb.GenerateReportResponse{Pdf: pdf, Filename: filename}, nil
}

func Validate(req *reportpb.GenerateReportRequest) error {
	if req == nil {
		return fmt.Errorf("request is required")
	}
	if !utf8.ValidString(req.GetTitle()) {
		return fmt.Errorf("title must be valid UTF-8")
	}
	if n := utf8.RuneCountInString(req.GetTitle()); n > MaxTitleLen {
		return fmt.Errorf("title is too long (%d > %d characters)", n, MaxTitleLen)
	}
	from, to := req.GetFromMs(), req.GetToMs()
	if from <= 0 {
		return fmt.Errorf("from_ms must be a positive unix timestamp in milliseconds")
	}
	if to <= from {
		return fmt.Errorf("to_ms must be greater than from_ms")
	}
	if time.Duration(to-from)*time.Millisecond > MaxPeriod {
		return fmt.Errorf("period is too long (max %d days)", int(MaxPeriod.Hours()/24))
	}
	if req.GetBucketMs() < 0 {
		return fmt.Errorf("bucket_ms must not be negative")
	}
	if req.GetBucketMs() > to-from {
		return fmt.Errorf("bucket_ms must not exceed the period length")
	}
	if n := len(req.GetSeries()); n > MaxSeries {
		return fmt.Errorf("too many series (%d > %d)", n, MaxSeries)
	}
	total := 0
	for i, s := range req.GetSeries() {
		if s == nil {
			return fmt.Errorf("series[%d] is null", i)
		}
		if strings.TrimSpace(s.GetKey()) == "" && strings.TrimSpace(s.GetLabel()) == "" {
			return fmt.Errorf("series[%d]: key or label is required", i)
		}
		if n := len(s.GetPoints()); n > MaxPointsPerSeries {
			return fmt.Errorf("series[%d]: too many points (%d > %d)", i, n, MaxPointsPerSeries)
		}
		total += len(s.GetPoints())
		for j, p := range s.GetPoints() {
			if p == nil {
				return fmt.Errorf("series[%d].points[%d] is null", i, j)
			}
			if math.IsNaN(p.GetValue()) || math.IsInf(p.GetValue(), 0) {
				return fmt.Errorf("series[%d].points[%d]: value must be a finite number", i, j)
			}
			if p.GetTimestampMs() <= 0 {
				return fmt.Errorf("series[%d].points[%d]: timestamp_ms must be positive", i, j)
			}
		}
	}
	if total > MaxTotalPoints {
		return fmt.Errorf("too many data points in total (%d > %d)", total, MaxTotalPoints)
	}
	if n := len(req.GetLogSummary()); n > MaxLogTypes {
		return fmt.Errorf("too many log_summary entries (%d > %d)", n, MaxLogTypes)
	}
	for i, l := range req.GetLogSummary() {
		if l == nil {
			return fmt.Errorf("log_summary[%d] is null", i)
		}
		if l.GetCount() < 0 {
			return fmt.Errorf("log_summary[%d]: count must not be negative", i)
		}
	}
	return nil
}

func ToInput(req *reportpb.GenerateReportRequest) report.Input {
	in := report.Input{
		Title:  strings.TrimSpace(req.GetTitle()),
		From:   time.UnixMilli(req.GetFromMs()).UTC(),
		To:     time.UnixMilli(req.GetToMs()).UTC(),
		Bucket: time.Duration(req.GetBucketMs()) * time.Millisecond,
	}
	for _, s := range req.GetSeries() {
		rs := report.Series{Key: s.GetKey(), Label: s.GetLabel(), Labels: s.GetLabels()}
		rs.Points = make([]report.Point, 0, len(s.GetPoints()))
		for _, p := range s.GetPoints() {
			rs.Points = append(rs.Points, report.Point{TimestampMs: p.GetTimestampMs(), Value: p.GetValue()})
		}
		in.Series = append(in.Series, rs)
	}
	for _, l := range req.GetLogSummary() {
		in.LogSummary = append(in.LogSummary, report.LogCount{Type: l.GetType(), Count: l.GetCount()})
	}
	return in
}

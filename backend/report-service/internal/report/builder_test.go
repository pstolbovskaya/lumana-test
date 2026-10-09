package report

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
	"time"
)

var (
	testFrom = time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	testTo   = testFrom.Add(24 * time.Hour)
	testGen  = time.Date(2026, 10, 6, 8, 30, 0, 0, time.UTC)
)

func sampleInput(nSeries, nTypes int) Input {
	in := Input{
		Title:       "Service A — activity",
		From:        testFrom,
		To:          testTo,
		Bucket:      time.Hour,
		GeneratedAt: testGen,
	}
	for i := 0; i < nSeries; i++ {
		s := Series{Key: fmt.Sprintf("events:service-a:action%d", i), Label: fmt.Sprintf("Action %d", i)}
		for h := 23; h >= 0; h-- {
			s.Points = append(s.Points, Point{TimestampMs: testFrom.Add(time.Duration(h) * time.Hour).UnixMilli(), Value: float64((h*7+i*3)%40 + i)})
		}
		in.Series = append(in.Series, s)
	}
	for i := 0; i < nTypes; i++ {
		in.LogSummary = append(in.LogSummary, LogCount{Type: fmt.Sprintf("type-%02d", i), Count: int64(100 - i)})
	}
	return in
}

func assertPDF(t *testing.T, b []byte) {
	t.Helper()
	if len(b) < 1000 {
		t.Fatalf("pdf too small: %d bytes", len(b))
	}
	if !bytes.HasPrefix(b, []byte("%PDF-")) {
		t.Fatalf("output does not start with %%PDF-: %q", b[:8])
	}
	if !bytes.Contains(b[len(b)-64:], []byte("%%EOF")) {
		t.Fatalf("output does not end with %%%%EOF")
	}
}

func TestBuild_WithData(t *testing.T) {
	b, err := Build(sampleInput(3, 5))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	assertPDF(t, b)
}

func TestBuild_EmptyData(t *testing.T) {
	b, err := Build(Input{From: testFrom, To: testTo, Bucket: time.Hour, GeneratedAt: testGen})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	assertPDF(t, b)
}

func TestBuild_SeriesWithoutPoints(t *testing.T) {
	in := Input{From: testFrom, To: testTo, Series: []Series{{Key: "k"}}, LogSummary: []LogCount{{Type: "x", Count: 0}}}
	b, err := Build(in)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	assertPDF(t, b)
}

func TestBuild_ManySeriesAndTypesPaginates(t *testing.T) {
	small, err := Build(sampleInput(1, 1))
	if err != nil {
		t.Fatal(err)
	}
	big, err := Build(sampleInput(20, 60))
	if err != nil {
		t.Fatal(err)
	}
	assertPDF(t, big)
	if pages(small) < 1 || pages(small) > 2 {
		t.Fatalf("small report: expected 1-2 pages, got %d", pages(small))
	}
	if pages(big) <= pages(small) {
		t.Fatalf("big report should paginate: %d pages vs %d", pages(big), pages(small))
	}
}

func TestBuild_SinglePointAndNonLatinText(t *testing.T) {
	in := Input{
		Title: "Отчёт — 报告",
		From:  testFrom, To: testTo,
		Series: []Series{{Key: "k", Label: "Ünïcödé", Points: []Point{{TimestampMs: testFrom.Add(time.Hour).UnixMilli(), Value: 5}}}},
	}
	b, err := Build(in)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	assertPDF(t, b)
}

func pages(b []byte) int {
	return strings.Count(string(b), "/Type /Page\n") + strings.Count(string(b), "/Type /Page ")
}

func TestSummarize(t *testing.T) {
	in := normalize(Input{
		From: testFrom, To: testTo, Bucket: 6 * time.Hour,
		Series: []Series{
			{Key: "a", Points: []Point{{1, 2}, {2, 10}, {3, 4}}},
			{Key: "b", Label: "B", Points: []Point{{1, 1}, {5, 3}}},
		},
		LogSummary: []LogCount{{"x", 5}, {"y", 7}},
	})
	s := Summarize(in)
	if s.TotalEvents != 20 {
		t.Errorf("TotalEvents = %v, want 20", s.TotalEvents)
	}
	if s.Peak != 10 || s.PeakSeries != "a" || s.PeakAt.UnixMilli() != 2 {
		t.Errorf("peak = %v %q %v", s.Peak, s.PeakSeries, s.PeakAt.UnixMilli())
	}
	if s.LogTotal != 12 {
		t.Errorf("LogTotal = %d", s.LogTotal)
	}
	if got := s.Series[0].AvgPer; got != 4 {
		t.Errorf("AvgPer = %v, want 4", got)
	}
	if s.Series[1].Name != "B" {
		t.Errorf("Name = %q", s.Series[1].Name)
	}
	if !s.HasData {
		t.Error("HasData = false")
	}
}

func TestAssignColorsFoldsExtraSeries(t *testing.T) {
	stats := make([]SeriesStats, 10)
	for i := range stats {
		stats[i].Total = float64(i)
	}
	assignColors(stats)
	folded := 0
	for _, s := range stats {
		if s.ColorIdx < 0 {
			folded++
		}
	}
	if folded != 3 {
		t.Fatalf("folded = %d, want 3", folded)
	}
	if stats[0].ColorIdx != -1 || stats[9].ColorIdx < 0 {
		t.Fatalf("smallest series should fold, largest should keep a colour: %+v", stats)
	}
}

func TestHumanDurationAndFilename(t *testing.T) {
	cases := map[time.Duration]string{
		0: "raw", 30 * time.Second: "30 s", 5 * time.Minute: "5 min",
		time.Hour: "1 h", 24 * time.Hour: "1 day", 48 * time.Hour: "2 days", 1500 * time.Millisecond: "1500 ms",
	}
	for d, want := range cases {
		if got := HumanDuration(d); got != want {
			t.Errorf("HumanDuration(%v) = %q, want %q", d, got, want)
		}
	}
	if got := Filename(Input{From: testFrom, To: testTo}); got != "report_20261005T0000Z_20261006T0000Z.pdf" {
		t.Errorf("Filename = %q", got)
	}
}

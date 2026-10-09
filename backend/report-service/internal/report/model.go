package report

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

type Point struct {
	TimestampMs int64
	Value       float64
}

type Series struct {
	Key    string
	Label  string
	Labels map[string]string
	Points []Point
}

func (s Series) DisplayName() string {
	if l := strings.TrimSpace(s.Label); l != "" {
		return l
	}
	if s.Key != "" {
		return s.Key
	}
	return "(unnamed series)"
}

type LogCount struct {
	Type  string
	Count int64
}

type Input struct {
	Title       string
	From, To    time.Time
	Bucket      time.Duration
	Series      []Series
	LogSummary  []LogCount
	GeneratedAt time.Time
	Location    *time.Location
}

type SeriesStats struct {
	Name     string
	Key      string
	Points   int
	Total    float64
	AvgPer   float64
	Peak     float64
	PeakAt   time.Time
	HasPeak  bool
	ColorIdx int
}

type Summary struct {
	Series      []SeriesStats
	TotalEvents float64
	LogTotal    int64
	Peak        float64
	PeakAt      time.Time
	PeakSeries  string
	HasPeak     bool
	HasData     bool
}

func Summarize(in Input) Summary {
	var sum Summary
	buckets := 0.0
	if in.Bucket > 0 && in.To.After(in.From) {
		buckets = math.Ceil(float64(in.To.Sub(in.From)) / float64(in.Bucket))
	}
	for _, s := range in.Series {
		st := SeriesStats{Name: s.DisplayName(), Key: s.Key, Points: len(s.Points)}
		for _, p := range s.Points {
			st.Total += p.Value
			if !st.HasPeak || p.Value > st.Peak {
				st.Peak, st.PeakAt, st.HasPeak = p.Value, time.UnixMilli(p.TimestampMs), true
			}
		}
		switch {
		case buckets > 0:
			st.AvgPer = st.Total / buckets
		case st.Points > 0:
			st.AvgPer = st.Total / float64(st.Points)
		}
		sum.TotalEvents += st.Total
		if st.HasPeak && (!sum.HasPeak || st.Peak > sum.Peak) {
			sum.Peak, sum.PeakAt, sum.PeakSeries, sum.HasPeak = st.Peak, st.PeakAt, st.Name, true
		}
		if st.Points > 0 {
			sum.HasData = true
		}
		sum.Series = append(sum.Series, st)
	}
	for _, l := range in.LogSummary {
		sum.LogTotal += l.Count
		if l.Count > 0 {
			sum.HasData = true
		}
	}
	return sum
}

func normalize(in Input) Input {
	if strings.TrimSpace(in.Title) == "" {
		in.Title = "Activity Report"
	}
	if in.Location == nil {
		in.Location = time.UTC
	}
	if in.GeneratedAt.IsZero() {
		in.GeneratedAt = time.Now()
	}
	series := make([]Series, len(in.Series))
	for i, s := range in.Series {
		pts := append([]Point(nil), s.Points...)
		sort.SliceStable(pts, func(a, b int) bool { return pts[a].TimestampMs < pts[b].TimestampMs })
		s.Points = pts
		series[i] = s
	}
	in.Series = series
	return in
}

func Filename(in Input) string {
	const layout = "20060102T1504Z"
	return fmt.Sprintf("report_%s_%s.pdf", in.From.UTC().Format(layout), in.To.UTC().Format(layout))
}

func HumanDuration(d time.Duration) string {
	switch {
	case d <= 0:
		return "raw"
	case d%(24*time.Hour) == 0:
		n := int64(d / (24 * time.Hour))
		return plural(n, "day")
	case d%time.Hour == 0:
		return fmt.Sprintf("%d h", int64(d/time.Hour))
	case d%time.Minute == 0:
		return fmt.Sprintf("%d min", int64(d/time.Minute))
	case d%time.Second == 0:
		return fmt.Sprintf("%d s", int64(d/time.Second))
	default:
		return fmt.Sprintf("%d ms", d.Milliseconds())
	}
}

func plural(n int64, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return fmt.Sprintf("%d %ss", n, unit)
}

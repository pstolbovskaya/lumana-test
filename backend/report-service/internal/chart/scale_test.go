package chart

import (
	"reflect"
	"testing"
	"time"
)

func TestNiceTicks(t *testing.T) {
	got := NiceTicks(0, 97, 6)
	want := []float64{0, 20, 40, 60, 80, 100}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("NiceTicks(0,97) = %v, want %v", got, want)
	}
	if got := NiceTicks(0, 0, 6); len(got) < 2 || got[0] != 0 || got[len(got)-1] < 1 {
		t.Fatalf("NiceTicks(0,0) = %v", got)
	}
	if got := NiceTicks(5, 5, 6); got[0] > 0 || got[len(got)-1] < 5 {
		t.Fatalf("NiceTicks(5,5) = %v", got)
	}
}

func TestTimeTicks(t *testing.T) {
	from := time.Date(2026, 10, 5, 0, 30, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	ticks, step := TimeTicks(from, to, 7, time.UTC)
	if step != 6*time.Hour {
		t.Fatalf("step = %v, want 6h", step)
	}
	if ticks[0] != time.Date(2026, 10, 5, 6, 0, 0, 0, time.UTC) {
		t.Fatalf("first tick = %v", ticks[0])
	}
	if len(ticks) > 7 {
		t.Fatalf("too many ticks: %d", len(ticks))
	}
	if l := TimeLayout(step, to.Sub(from)); l != "Jan 02 15:04" {
		t.Fatalf("layout = %q", l)
	}
}

func TestFormatting(t *testing.T) {
	cases := []struct {
		f    func(float64) string
		in   float64
		want string
	}{
		{FormatInt, 1234567, "1,234,567"},
		{FormatInt, -1000, "-1,000"},
		{FormatCompact, 12500, "12.5k"},
		{FormatCompact, 2_000_000, "2M"},
		{FormatCompact, 0.25, "0.25"},
		{FormatNumber, 1234.5, "1,234.5"},
		{FormatNumber, 3, "3"},
		{FormatNumber, 2.999, "3"},
	}
	for _, c := range cases {
		if got := c.f(c.in); got != c.want {
			t.Errorf("format(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFormatTicks(t *testing.T) {
	got := FormatTicks([]float64{0, 5000, 10000, 15000})
	want := []string{"0", "5k", "10k", "15k"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("FormatTicks = %v, want %v", got, want)
	}
	got = FormatTicks([]float64{0, 2.5, 5})
	if !reflect.DeepEqual(got, []string{"0", "2.5", "5"}) {
		t.Fatalf("FormatTicks small = %v", got)
	}
}

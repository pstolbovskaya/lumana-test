package chart

import (
	"math"
	"time"
)

func NiceTicks(lo, hi float64, maxTicks int) []float64 {
	if maxTicks < 2 {
		maxTicks = 2
	}
	if math.IsNaN(lo) || math.IsNaN(hi) || math.IsInf(lo, 0) || math.IsInf(hi, 0) {
		return []float64{0, 1}
	}
	if hi < lo {
		lo, hi = hi, lo
	}
	if hi == lo {
		if hi == 0 {
			hi = 1
		} else {
			lo, hi = math.Min(0, lo), math.Max(0, hi)
			if lo == hi {
				hi = lo + 1
			}
		}
	}
	step := niceNum((hi-lo)/float64(maxTicks-1), true)
	start := math.Floor(lo/step) * step
	end := math.Ceil(hi/step) * step
	ticks := make([]float64, 0, maxTicks+2)
	for v := start; v <= end+step*0.5; v += step {
		r := math.Round(v/step) * step
		if math.Abs(r) < step*1e-9 {
			r = 0
		}
		ticks = append(ticks, r)
	}
	return ticks
}

func niceNum(x float64, round bool) float64 {
	if x <= 0 {
		return 1
	}
	exp := math.Floor(math.Log10(x))
	f := x / math.Pow(10, exp)
	var nf float64
	if round {
		switch {
		case f < 1.5:
			nf = 1
		case f < 2.25:
			nf = 2
		case f < 3.5:
			nf = 2.5
		case f < 7.5:
			nf = 5
		default:
			nf = 10
		}
	} else {
		switch {
		case f <= 1:
			nf = 1
		case f <= 2:
			nf = 2
		case f <= 5:
			nf = 5
		default:
			nf = 10
		}
	}
	return nf * math.Pow(10, exp)
}

var timeSteps = []time.Duration{
	time.Second, 5 * time.Second, 15 * time.Second, 30 * time.Second,
	time.Minute, 5 * time.Minute, 10 * time.Minute, 15 * time.Minute, 30 * time.Minute,
	time.Hour, 2 * time.Hour, 3 * time.Hour, 6 * time.Hour, 12 * time.Hour,
	24 * time.Hour, 2 * 24 * time.Hour, 7 * 24 * time.Hour, 14 * 24 * time.Hour,
	30 * 24 * time.Hour, 90 * 24 * time.Hour, 180 * 24 * time.Hour, 365 * 24 * time.Hour,
}

func TimeTicks(from, to time.Time, maxTicks int, loc *time.Location) ([]time.Time, time.Duration) {
	if maxTicks < 2 {
		maxTicks = 2
	}
	span := to.Sub(from)
	if span <= 0 {
		return []time.Time{from}, time.Second
	}
	step := timeSteps[len(timeSteps)-1]
	for _, s := range timeSteps {
		if span/s <= time.Duration(maxTicks-1) {
			step = s
			break
		}
	}
	first := alignUp(from.In(loc), step)
	var ticks []time.Time
	for t := first; !t.After(to); t = t.Add(step) {
		ticks = append(ticks, t)
		if len(ticks) > maxTicks*2 {
			break
		}
	}
	return ticks, step
}

func alignUp(t time.Time, step time.Duration) time.Time {
	if step >= 24*time.Hour {
		d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
		if d.Before(t) {
			d = d.AddDate(0, 0, 1)
		}
		return d
	}
	_, offset := t.Zone()
	shift := time.Duration(offset) * time.Second
	local := t.Add(shift)
	aligned := local.Truncate(step)
	if aligned.Before(local) {
		aligned = aligned.Add(step)
	}
	return aligned.Add(-shift)
}

func TimeLayout(step, span time.Duration) string {
	switch {
	case step < time.Minute:
		return "15:04:05"
	case step >= 24*time.Hour:
		return "Jan 02"
	case span >= 24*time.Hour:
		return "Jan 02 15:04"
	default:
		return "15:04"
	}
}

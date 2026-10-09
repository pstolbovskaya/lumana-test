package chart

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
)

type RGB struct{ R, G, B int }

var Palette = []RGB{
	{0x2a, 0x78, 0xd6},
	{0xeb, 0x68, 0x34},
	{0x1b, 0xaf, 0x7a},
	{0xed, 0xa1, 0x00},
	{0xe8, 0x7b, 0xa4},
	{0x00, 0x83, 0x00},
	{0x4a, 0x3a, 0xa7},
	{0xe3, 0x49, 0x48},
}

var OtherColor = RGB{0x8a, 0x89, 0x84}

var (
	InkPrimary   = RGB{0x1f, 0x23, 0x2b}
	InkSecondary = RGB{0x52, 0x51, 0x4e}
	InkMuted     = RGB{0x8a, 0x89, 0x84}
	GridColor    = RGB{0xe4, 0xe4, 0xe0}
	AxisColor    = RGB{0xb5, 0xb4, 0xae}
)

type Point struct {
	T time.Time
	V float64
}

type Series struct {
	Label  string
	Color  RGB
	Points []Point
}

type Box struct{ X, Y, W, H float64 }

type TextFunc func(string) string

type LineChartOptions struct {
	From, To time.Time
	Location *time.Location
	YLabel   string
	XLabel   string
	Text     TextFunc
}

func setDraw(pdf *fpdf.Fpdf, c RGB) { pdf.SetDrawColor(c.R, c.G, c.B) }
func setFill(pdf *fpdf.Fpdf, c RGB) { pdf.SetFillColor(c.R, c.G, c.B) }
func setText(pdf *fpdf.Fpdf, c RGB) { pdf.SetTextColor(c.R, c.G, c.B) }

func textFn(f TextFunc) TextFunc {
	if f == nil {
		return func(s string) string { return s }
	}
	return f
}

func DrawLineChart(pdf *fpdf.Fpdf, box Box, series []Series, opt LineChartOptions) {
	tr := textFn(opt.Text)
	loc := opt.Location
	if loc == nil {
		loc = time.UTC
	}

	const legendRowH = 5.0
	const legendIndent = 22.0
	type legendItem struct {
		label string
		color RGB
		w     float64
	}
	var rows [][]legendItem
	if len(series) > 0 {
		pdf.SetFont("Helvetica", "", 8)
		var row []legendItem
		rowW := 0.0
		for _, s := range series {
			label := Truncate(pdf, tr(s.Label), 70)
			w := 7 + pdf.GetStringWidth(label) + 6
			if rowW+w > box.W-legendIndent && len(row) > 0 {
				rows = append(rows, row)
				row, rowW = nil, 0
			}
			row = append(row, legendItem{label, s.Color, w})
			rowW += w
		}
		rows = append(rows, row)
	}
	legendH := float64(len(rows)) * legendRowH
	if legendH > 0 {
		legendH += 2
	}

	minV, maxV := math.Inf(1), math.Inf(-1)
	for _, s := range series {
		for _, p := range s.Points {
			minV = math.Min(minV, p.V)
			maxV = math.Max(maxV, p.V)
		}
	}
	if math.IsInf(minV, 1) {
		minV, maxV = 0, 1
	}
	if minV > 0 {
		minV = 0
	}
	yTicks := NiceTicks(minV, maxV, 6)
	yLo, yHi := yTicks[0], yTicks[len(yTicks)-1]

	pdf.SetFont("Helvetica", "", 7.5)
	yLabels := FormatTicks(yTicks)
	yLabelW := 0.0
	for _, l := range yLabels {
		yLabelW = math.Max(yLabelW, pdf.GetStringWidth(l))
	}
	left := box.X + yLabelW + 3
	if opt.YLabel != "" {
		left += 5
	}
	right := box.X + box.W - 2
	top := box.Y + 2
	xAxisH := 7.0
	if opt.XLabel != "" {
		xAxisH += 4.5
	}
	bottom := box.Y + box.H - legendH - xAxisH
	plotW, plotH := right-left, bottom-top

	fromU, toU := float64(opt.From.UnixMilli()), float64(opt.To.UnixMilli())
	if toU <= fromU {
		toU = fromU + 1
	}
	xOf := func(t time.Time) float64 {
		return left + (float64(t.UnixMilli())-fromU)/(toU-fromU)*plotW
	}
	yOf := func(v float64) float64 {
		return bottom - (v-yLo)/(yHi-yLo)*plotH
	}

	pdf.SetLineWidth(0.15)
	for i, t := range yTicks {
		y := yOf(t)
		setDraw(pdf, GridColor)
		pdf.Line(left, y, right, y)
		setText(pdf, InkSecondary)
		lbl := yLabels[i]
		pdf.Text(left-2-pdf.GetStringWidth(lbl), y+1.1, lbl)
	}

	ticks, step := TimeTicks(opt.From, opt.To, 7, loc)
	layout := TimeLayout(step, opt.To.Sub(opt.From))
	setDraw(pdf, AxisColor)
	lastLabelRight := math.Inf(-1)
	for _, t := range ticks {
		x := xOf(t)
		if x < left-0.01 || x > right+0.01 {
			continue
		}
		pdf.Line(x, bottom, x, bottom+1.2)
		lbl := t.In(loc).Format(layout)
		w := pdf.GetStringWidth(lbl)
		lx := math.Max(box.X, math.Min(x-w/2, right-w))
		if lx < lastLabelRight+2 {
			continue
		}
		setText(pdf, InkSecondary)
		pdf.Text(lx, bottom+4.5, lbl)
		lastLabelRight = lx + w
	}

	pdf.SetLineWidth(0.25)
	setDraw(pdf, AxisColor)
	pdf.Line(left, bottom, right, bottom)
	pdf.Line(left, top, left, bottom)

	pdf.SetFont("Helvetica", "", 7.5)
	setText(pdf, InkMuted)
	if opt.XLabel != "" {
		lbl := tr(opt.XLabel)
		pdf.Text(left+plotW/2-pdf.GetStringWidth(lbl)/2, bottom+10, lbl)
	}
	if opt.YLabel != "" {
		lbl := tr(opt.YLabel)
		cx, cy := box.X+2.5, top+plotH/2+pdf.GetStringWidth(lbl)/2
		pdf.TransformBegin()
		pdf.TransformRotate(90, cx, cy)
		pdf.Text(cx, cy, lbl)
		pdf.TransformEnd()
	}

	pdf.ClipRect(left, top-1, plotW, plotH+1.5, false)
	pdf.SetLineCapStyle("round")
	pdf.SetLineJoinStyle("round")
	for _, s := range series {
		if len(s.Points) == 0 {
			continue
		}
		setDraw(pdf, s.Color)
		setFill(pdf, s.Color)
		pdf.SetLineWidth(0.55)
		if len(s.Points) > 1 {
			pdf.MoveTo(xOf(s.Points[0].T), yOf(s.Points[0].V))
			for _, p := range s.Points[1:] {
				pdf.LineTo(xOf(p.T), yOf(p.V))
			}
			pdf.DrawPath("D")
		}
		if len(s.Points) == 1 || float64(len(s.Points)) <= plotW/4 {
			for _, p := range s.Points {
				pdf.SetDrawColor(255, 255, 255)
				pdf.SetLineWidth(0.25)
				pdf.Circle(xOf(p.T), yOf(p.V), 0.75, "FD")
			}
		}
	}
	pdf.ClipEnd()
	pdf.SetLineCapStyle("butt")
	pdf.SetLineJoinStyle("miter")

	if len(rows) > 0 {
		pdf.SetFont("Helvetica", "", 8)
		y := box.Y + box.H - legendH + 2
		for _, row := range rows {
			x := left
			for _, it := range row {
				setDraw(pdf, it.color)
				pdf.SetLineWidth(0.9)
				pdf.Line(x, y+2.2, x+5, y+2.2)
				setText(pdf, InkPrimary)
				pdf.Text(x+7, y+3.2, it.label)
				x += it.w
			}
			y += legendRowH
		}
	}
	pdf.SetLineWidth(0.2)
}

type Bar struct {
	Label string
	Value float64
}

type BarChartOptions struct {
	Color   RGB
	Text    TextFunc
	MaxBars int
}

func BarChartHeight(n int) float64 {
	return float64(n)*barRowH + 8
}

const barRowH = 7.0

func DrawBarChart(pdf *fpdf.Fpdf, box Box, bars []Bar, opt BarChartOptions) {
	tr := textFn(opt.Text)
	if len(bars) == 0 {
		return
	}
	maxV := 0.0
	for _, b := range bars {
		maxV = math.Max(maxV, b.Value)
	}
	ticks := NiceTicks(0, maxV, 6)
	hi := ticks[len(ticks)-1]

	pdf.SetFont("Helvetica", "", 8)
	labelW := 0.0
	for _, b := range bars {
		labelW = math.Max(labelW, pdf.GetStringWidth(tr(b.Label)))
	}
	labelW = math.Min(labelW, box.W*0.32)
	left := box.X + labelW + 3
	valueW := 16.0
	right := box.X + box.W - valueW
	plotW := right - left
	top := box.Y
	bottom := box.Y + float64(len(bars))*barRowH

	pdf.SetLineWidth(0.15)
	pdf.SetFont("Helvetica", "", 7.5)
	tickLabels := FormatTicks(ticks)
	for i, t := range ticks {
		x := left + t/hi*plotW
		setDraw(pdf, GridColor)
		pdf.Line(x, top, x, bottom)
		lbl := tickLabels[i]
		setText(pdf, InkSecondary)
		pdf.Text(x-pdf.GetStringWidth(lbl)/2, bottom+4.5, lbl)
	}

	for i, b := range bars {
		y := top + float64(i)*barRowH
		barH := barRowH - 2.4
		w := 0.0
		if hi > 0 {
			w = b.Value / hi * plotW
		}
		pdf.SetFont("Helvetica", "", 8)
		setText(pdf, InkPrimary)
		lbl := Truncate(pdf, tr(b.Label), labelW)
		pdf.Text(left-2-pdf.GetStringWidth(lbl), y+barRowH/2+1.2, lbl)
		if w > 0 {
			setFill(pdf, opt.Color)
			r := math.Min(1.0, w/2)
			pdf.RoundedRectExt(left, y+1.2, w, barH, 0, r, r, 0, "F")
		}
		setText(pdf, InkSecondary)
		pdf.Text(left+w+1.5, y+barRowH/2+1.2, FormatInt(b.Value))
	}
	setDraw(pdf, AxisColor)
	pdf.SetLineWidth(0.25)
	pdf.Line(left, top, left, bottom)
	pdf.SetLineWidth(0.2)
}

func Truncate(pdf *fpdf.Fpdf, s string, maxW float64) string {
	if pdf.GetStringWidth(s) <= maxW {
		return s
	}
	b := []byte(s)
	for len(b) > 1 {
		b = b[:len(b)-1]
		if pdf.GetStringWidth(string(b)+"...") <= maxW {
			break
		}
	}
	return strings.TrimRight(string(b), " ") + "..."
}

func FormatTicks(ticks []float64) []string {
	maxAbs := 0.0
	for _, t := range ticks {
		maxAbs = math.Max(maxAbs, math.Abs(t))
	}
	div, suffix := 1.0, ""
	switch {
	case maxAbs >= 1e9:
		div, suffix = 1e9, "B"
	case maxAbs >= 1e6:
		div, suffix = 1e6, "M"
	case maxAbs >= 1e4:
		div, suffix = 1e3, "k"
	}
	out := make([]string, len(ticks))
	for i, t := range ticks {
		switch {
		case t == 0:
			out[i] = "0"
		case suffix == "":
			out[i] = FormatCompact(t)
		default:
			out[i] = trimZeros(strconv.FormatFloat(t/div, 'f', 2, 64)) + suffix
		}
	}
	return out
}

func FormatCompact(v float64) string {
	a := math.Abs(v)
	switch {
	case a >= 1e9:
		return trimZeros(fmt.Sprintf("%.1f", v/1e9)) + "B"
	case a >= 1e6:
		return trimZeros(fmt.Sprintf("%.1f", v/1e6)) + "M"
	case a >= 1e4:
		return trimZeros(fmt.Sprintf("%.1f", v/1e3)) + "k"
	case a == math.Trunc(a):
		return FormatInt(v)
	default:
		return trimZeros(fmt.Sprintf("%.2f", v))
	}
}

func trimZeros(s string) string {
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	return s
}

func FormatInt(v float64) string {
	n := int64(math.Round(v))
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(c)
	}
	if neg {
		return "-" + b.String()
	}
	return b.String()
}

func FormatNumber(v float64) string {
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return FormatInt(v)
	}
	ip := math.Trunc(v)
	frac := math.Abs(v - ip)
	fs := trimZeros(strconv.FormatFloat(frac, 'f', 2, 64))
	if fs == "1" {
		return FormatInt(math.Round(v))
	}
	prefix := FormatInt(ip)
	if v < 0 && ip == 0 {
		prefix = "-0"
	}
	return prefix + strings.TrimPrefix(fs, "0")
}

func SortBarsDesc(bars []Bar) {
	sort.SliceStable(bars, func(i, j int) bool {
		if bars[i].Value != bars[j].Value {
			return bars[i].Value > bars[j].Value
		}
		return bars[i].Label < bars[j].Label
	})
}

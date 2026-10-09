package report

import (
	"bytes"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"

	"github.com/lumana-test/report-service/internal/chart"
)

const (
	pageW    = 210.0
	pageH    = 297.0
	margin   = 15.0
	contentW = pageW - 2*margin
	footerY  = pageH - 12
	maxY     = pageH - 20
)

const maxChartSeries = 8

var (
	brand      = chart.RGB{R: 0x1f, G: 0x2a, B: 0x44}
	brandLight = chart.RGB{R: 0xc9, G: 0xd3, B: 0xe6}
	accent     = chart.Palette[0]
	panel      = chart.RGB{R: 0xf5, G: 0xf6, B: 0xf8}
	rowAlt     = chart.RGB{R: 0xf7, G: 0xf8, B: 0xfa}
	border     = chart.RGB{R: 0xdf, G: 0xe2, B: 0xe8}
)

const appName = "Lumana Report Service"

type builder struct {
	pdf *fpdf.Fpdf
	tr  func(string) string
	in  Input
	sum Summary
}

func Build(raw Input) ([]byte, error) {
	in := normalize(raw)
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(margin, margin, margin)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetTitle(in.Title, true)
	pdf.SetAuthor(appName, true)
	pdf.SetCreator(appName, true)
	pdf.SetSubject("Activity report", true)
	pdf.SetCreationDate(in.GeneratedAt)
	pdf.SetModificationDate(in.GeneratedAt)
	pdf.AliasNbPages("{nb}")

	b := &builder{pdf: pdf, tr: pdf.UnicodeTranslatorFromDescriptor(""), in: in}
	b.sum = Summarize(in)
	assignColors(b.sum.Series)

	pdf.SetHeaderFuncMode(b.header, false)
	pdf.SetFooterFunc(b.footer)

	pdf.AddPage()
	b.overview()
	b.seriesTable()
	b.lineChart()
	b.logSection()

	if err := pdf.Error(); err != nil {
		return nil, fmt.Errorf("render pdf: %w", err)
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("write pdf: %w", err)
	}
	return buf.Bytes(), nil
}

func assignColors(stats []SeriesStats) {
	idx := make([]int, len(stats))
	for i := range idx {
		idx[i] = i
	}
	limit := len(stats)
	if limit > maxChartSeries {
		limit = maxChartSeries - 1
		sort.SliceStable(idx, func(a, b int) bool { return stats[idx[a]].Total > stats[idx[b]].Total })
	}
	keep := map[int]bool{}
	for _, i := range idx[:limit] {
		keep[i] = true
	}
	slot := 0
	for i := range stats {
		if keep[i] {
			stats[i].ColorIdx = slot
			slot++
		} else {
			stats[i].ColorIdx = -1
		}
	}
}

func (b *builder) fill(c chart.RGB)  { b.pdf.SetFillColor(c.R, c.G, c.B) }
func (b *builder) draw(c chart.RGB)  { b.pdf.SetDrawColor(c.R, c.G, c.B) }
func (b *builder) color(c chart.RGB) { b.pdf.SetTextColor(c.R, c.G, c.B) }

func (b *builder) fmtTime(t time.Time, layout string) string {
	return t.In(b.in.Location).Format(layout)
}

func (b *builder) tzName() string {
	name, _ := b.in.GeneratedAt.In(b.in.Location).Zone()
	return name
}

func (b *builder) ensure(h float64) {
	if b.pdf.GetY()+h > maxY {
		b.pdf.AddPage()
	}
}

func (b *builder) section(title, subtitle string, minBody float64) {
	b.ensure(14 + minBody)
	pdf := b.pdf
	y := pdf.GetY() + 4
	b.fill(accent)
	pdf.Rect(margin, y, 1.2, 6, "F")
	pdf.SetFont("Helvetica", "B", 12.5)
	b.color(chart.InkPrimary)
	pdf.Text(margin+4, y+4.8, b.tr(title))
	if subtitle != "" {
		tw := pdf.GetStringWidth(b.tr(title))
		pdf.SetFont("Helvetica", "", 8.5)
		b.color(chart.InkMuted)
		pdf.Text(margin+4+tw+3, y+4.8, b.tr(subtitle))
	}
	pdf.SetY(y + 10)
}

func (b *builder) emptyState(msg string, h float64) {
	pdf := b.pdf
	y := pdf.GetY()
	b.fill(panel)
	b.draw(border)
	pdf.SetLineWidth(0.2)
	pdf.SetDashPattern([]float64{1, 1}, 0)
	pdf.RoundedRect(margin, y, contentW, h, 2, "1234", "FD")
	pdf.SetDashPattern([]float64{}, 0)
	pdf.SetFont("Helvetica", "B", 10)
	b.color(chart.InkSecondary)
	t := b.tr(msg)
	pdf.Text(margin+contentW/2-pdf.GetStringWidth(t)/2, y+h/2+0.5, t)
	pdf.SetFont("Helvetica", "", 8)
	b.color(chart.InkMuted)
	sub := b.tr("Nothing was recorded between " + b.periodText())
	pdf.Text(margin+contentW/2-pdf.GetStringWidth(sub)/2, y+h/2+5, sub)
	pdf.SetY(y + h + 2)
}

func (b *builder) periodText() string {
	const l = "02 Jan 2006 15:04"
	return fmt.Sprintf("%s and %s %s", b.fmtTime(b.in.From, l), b.fmtTime(b.in.To, l), b.tzName())
}

func (b *builder) header() {
	pdf := b.pdf
	if pdf.PageNo() == 1 {
		b.titleBand()
		return
	}
	pdf.SetFont("Helvetica", "B", 9)
	b.color(chart.InkPrimary)
	pdf.Text(margin, 11, chart.Truncate(pdf, b.tr(b.in.Title), contentW*0.6))
	pdf.SetFont("Helvetica", "", 8)
	b.color(chart.InkMuted)
	p := b.tr(b.shortPeriod())
	pdf.Text(pageW-margin-pdf.GetStringWidth(p), 11, p)
	b.draw(border)
	pdf.SetLineWidth(0.2)
	pdf.Line(margin, 14, pageW-margin, 14)
	pdf.SetY(18)
}

func (b *builder) shortPeriod() string {
	const l = "02 Jan 2006 15:04"
	return fmt.Sprintf("%s – %s %s", b.fmtTime(b.in.From, l), b.fmtTime(b.in.To, l), b.tzName())
}

func (b *builder) titleBand() {
	pdf := b.pdf
	const bandH = 34.0
	b.fill(brand)
	pdf.Rect(0, 0, pageW, bandH, "F")
	b.fill(accent)
	pdf.Rect(0, bandH, pageW, 1.2, "F")

	pdf.SetFont("Helvetica", "B", 7.5)
	b.color(brandLight)
	pdf.Text(margin, 11, b.tr(strings.ToUpper("Activity report")))

	pdf.SetFont("Helvetica", "B", 19)
	pdf.SetTextColor(255, 255, 255)
	pdf.Text(margin, 20.5, chart.Truncate(pdf, b.tr(b.in.Title), contentW-55))

	pdf.SetFont("Helvetica", "", 9)
	b.color(brandLight)
	pdf.Text(margin, 28, b.tr(b.shortPeriod()))

	pdf.SetFont("Helvetica", "", 7.5)
	lbl := b.tr("Generated")
	pdf.Text(pageW-margin-pdf.GetStringWidth(lbl), 11, lbl)
	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetTextColor(255, 255, 255)
	ts := b.tr(b.fmtTime(b.in.GeneratedAt, "02 Jan 2006 15:04") + " " + b.tzName())
	pdf.Text(pageW-margin-pdf.GetStringWidth(ts), 16, ts)
	pdf.SetY(bandH + 6)
}

func (b *builder) footer() {
	pdf := b.pdf
	b.draw(border)
	pdf.SetLineWidth(0.2)
	pdf.Line(margin, footerY-4, pageW-margin, footerY-4)
	pdf.SetFont("Helvetica", "", 7.5)
	b.color(chart.InkMuted)
	left := b.tr(fmt.Sprintf("%s  ·  Generated %s %s", appName,
		b.fmtTime(b.in.GeneratedAt, "2006-01-02 15:04:05"), b.tzName()))
	pdf.Text(margin, footerY, left)
	right := fmt.Sprintf("Page %d of {nb}", pdf.PageNo())
	w := pdf.GetStringWidth(fmt.Sprintf("Page %d of %d", pdf.PageNo(), 10))
	pdf.Text(pageW-margin-w, footerY, right)
}

func (b *builder) overview() {
	pdf := b.pdf
	s := b.sum

	type kpi struct{ label, value, note string }
	peakVal, peakNote := "–", "no data"
	if s.HasPeak {
		peakVal = chart.FormatNumber(s.Peak)
		peakNote = fmt.Sprintf("%s · %s", b.fmtTime(s.PeakAt, "02 Jan 15:04"), s.PeakSeries)
	}
	logNote := "no events by type"
	if len(b.in.LogSummary) > 0 {
		logNote = fmt.Sprintf("%s events in total", chart.FormatInt(float64(s.LogTotal)))
	}
	pointCount := 0
	for _, st := range s.Series {
		pointCount += st.Points
	}
	kpis := []kpi{
		{"Total events", chart.FormatNumber(s.TotalEvents), "sum of all series"},
		{"Peak per bucket", peakVal, peakNote},
		{"Series", chart.FormatInt(float64(len(b.in.Series))), fmt.Sprintf("%s data points", chart.FormatInt(float64(pointCount)))},
		{"Event types", chart.FormatInt(float64(len(b.in.LogSummary))), logNote},
	}

	b.section("Overview", "", 40)
	y := pdf.GetY()

	b.fill(panel)
	pdf.RoundedRect(margin, y, contentW, 11, 1.5, "1234", "F")
	const l = "02 Jan 2006 15:04"
	cells := [][2]string{
		{"From", b.fmtTime(b.in.From, l)},
		{"To", b.fmtTime(b.in.To, l)},
		{"Duration", humanSpan(b.in.To.Sub(b.in.From))},
		{"Bucket", HumanDuration(b.in.Bucket)},
		{"Time zone", b.tzName()},
	}
	cw := contentW / float64(len(cells))
	for i, c := range cells {
		x := margin + 4 + float64(i)*cw
		pdf.SetFont("Helvetica", "", 6.5)
		b.color(chart.InkMuted)
		pdf.Text(x, y+4.3, b.tr(strings.ToUpper(c[0])))
		pdf.SetFont("Helvetica", "B", 8.5)
		b.color(chart.InkPrimary)
		pdf.Text(x, y+8.6, b.tr(c[1]))
	}
	y += 15

	const gap = 4.0
	const cardH = 24.0
	w := (contentW - gap*float64(len(kpis)-1)) / float64(len(kpis))
	for i, k := range kpis {
		x := margin + float64(i)*(w+gap)
		pdf.SetFillColor(255, 255, 255)
		b.draw(border)
		pdf.SetLineWidth(0.25)
		pdf.RoundedRect(x, y, w, cardH, 2, "1234", "FD")
		b.fill(accent)
		pdf.Rect(x+4, y+4, 6, 0.8, "F")
		pdf.SetFont("Helvetica", "", 7.5)
		b.color(chart.InkSecondary)
		pdf.Text(x+4, y+9, b.tr(k.label))
		pdf.SetFont("Helvetica", "B", 16)
		b.color(chart.InkPrimary)
		pdf.Text(x+4, y+16.5, chart.Truncate(pdf, b.tr(k.value), w-8))
		pdf.SetFont("Helvetica", "", 6.8)
		b.color(chart.InkMuted)
		pdf.Text(x+4, y+21, chart.Truncate(pdf, b.tr(k.note), w-8))
	}
	pdf.SetY(y + cardH + 4)
}

func humanSpan(d time.Duration) string {
	if d <= 0 {
		return "–"
	}
	days := d / (24 * time.Hour)
	d -= days * 24 * time.Hour
	hours := d / time.Hour
	d -= hours * time.Hour
	mins := d / time.Minute
	var parts []string
	if days > 0 {
		parts = append(parts, fmt.Sprintf("%dd", days))
	}
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if mins > 0 && days == 0 {
		parts = append(parts, fmt.Sprintf("%dm", mins))
	}
	if len(parts) == 0 {
		return fmt.Sprintf("%ds", int(d/time.Second))
	}
	return strings.Join(parts, " ")
}

type column struct {
	title string
	width float64
	align string
}

type rowPainter func(row, col int, x, y float64) float64

func (b *builder) table(cols []column, rows [][]string, paint rowPainter) {
	pdf := b.pdf
	const headH, rowH = 7.5, 6.8
	drawHead := func() {
		y := pdf.GetY()
		b.fill(brand)
		pdf.Rect(margin, y, contentW, headH, "F")
		pdf.SetFont("Helvetica", "B", 7.8)
		pdf.SetTextColor(255, 255, 255)
		x := margin
		for _, c := range cols {
			w := c.width * contentW
			b.cellText(x, y, w, headH, c.title, c.align)
			x += w
		}
		pdf.SetY(y + headH)
	}
	drawHead()
	for i, r := range rows {
		if pdf.GetY()+rowH > maxY {
			pdf.AddPage()
			drawHead()
		}
		y := pdf.GetY()
		if i%2 == 1 {
			b.fill(rowAlt)
			pdf.Rect(margin, y, contentW, rowH, "F")
		}
		pdf.SetFont("Helvetica", "", 8)
		b.color(chart.InkPrimary)
		x := margin
		for j, c := range cols {
			w := c.width * contentW
			off := 0.0
			if paint != nil {
				off = paint(i, j, x, y)
			}
			b.cellText(x+off, y, w-off, rowH, r[j], c.align)
			x += w
		}
		b.draw(border)
		pdf.SetLineWidth(0.15)
		pdf.Line(margin, y+rowH, margin+contentW, y+rowH)
		pdf.SetY(y + rowH)
	}
}

func (b *builder) cellText(x, y, w, h float64, s, align string) {
	pdf := b.pdf
	const pad = 2.5
	t := chart.Truncate(pdf, b.tr(s), w-2*pad)
	tx := x + pad
	if align == "R" {
		tx = x + w - pad - pdf.GetStringWidth(t)
	}
	pdf.Text(tx, y+h/2+1.1, t)
}

func (b *builder) seriesTable() {
	b.section("Series summary", fmt.Sprintf("per series, bucket %s", HumanDuration(b.in.Bucket)), 20)
	if len(b.sum.Series) == 0 || !anyPoints(b.sum.Series) {
		b.emptyState("No data for period", 22)
		return
	}
	cols := []column{
		{"Series", 0.34, "L"},
		{"Points", 0.09, "R"},
		{"Total", 0.14, "R"},
		{"Avg / bucket", 0.13, "R"},
		{"Peak", 0.12, "R"},
		{"Peak at", 0.18, "R"},
	}
	rows := make([][]string, 0, len(b.sum.Series)+1)
	for _, st := range b.sum.Series {
		peak, at := "–", "–"
		if st.HasPeak {
			peak = chart.FormatNumber(st.Peak)
			at = b.fmtTime(st.PeakAt, "02 Jan 15:04")
		}
		rows = append(rows, []string{st.Name, chart.FormatInt(float64(st.Points)),
			chart.FormatNumber(st.Total), chart.FormatNumber(round2(st.AvgPer)), peak, at})
	}
	stats := b.sum.Series
	b.table(cols, rows, func(row, col int, x, y float64) float64 {
		if col != 0 {
			return 0
		}
		c := chart.OtherColor
		if stats[row].ColorIdx >= 0 {
			c = chart.Palette[stats[row].ColorIdx]
		}
		b.fill(c)
		b.pdf.RoundedRect(x+2.5, y+2.4, 2.2, 2.2, 0.5, "1234", "F")
		return 4
	})
	pdf := b.pdf
	y := pdf.GetY()
	pdf.SetFont("Helvetica", "B", 8)
	b.color(chart.InkPrimary)
	b.cellText(margin, y, contentW*0.34, 7, "Total", "L")
	b.cellText(margin+contentW*0.43, y, contentW*0.14, 7, chart.FormatNumber(b.sum.TotalEvents), "R")
	b.draw(chart.AxisColor)
	pdf.SetLineWidth(0.3)
	pdf.Line(margin, y+7, margin+contentW, y+7)
	pdf.SetY(y + 9)
}

func anyPoints(stats []SeriesStats) bool {
	for _, s := range stats {
		if s.Points > 0 {
			return true
		}
	}
	return false
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5*sign(v))) / 100
}

func sign(v float64) float64 {
	if v < 0 {
		return -1
	}
	return 1
}

func (b *builder) lineChart() {
	const chartH = 92.0
	sub := fmt.Sprintf("events per %s bucket, %s", HumanDuration(b.in.Bucket), b.tzName())
	if b.in.Bucket <= 0 {
		sub = "raw values, " + b.tzName()
	}
	b.section("Activity over time", sub, chartH)
	if !anyPoints(b.sum.Series) {
		b.emptyState("No data for period", 30)
		return
	}

	var lines []chart.Series
	other := map[int64]float64{}
	folded := 0
	for i, s := range b.in.Series {
		st := b.sum.Series[i]
		if st.ColorIdx < 0 {
			folded++
			for _, p := range s.Points {
				other[p.TimestampMs] += p.Value
			}
			continue
		}
		lines = append(lines, chart.Series{Label: st.Name, Color: chart.Palette[st.ColorIdx], Points: toChartPoints(s.Points)})
	}
	if folded > 0 {
		ts := make([]int64, 0, len(other))
		for t := range other {
			ts = append(ts, t)
		}
		sort.Slice(ts, func(i, j int) bool { return ts[i] < ts[j] })
		pts := make([]chart.Point, len(ts))
		for i, t := range ts {
			pts[i] = chart.Point{T: time.UnixMilli(t), V: other[t]}
		}
		lines = append(lines, chart.Series{Label: fmt.Sprintf("Other (%d series)", folded), Color: chart.OtherColor, Points: pts})
	}

	y := b.pdf.GetY()
	chart.DrawLineChart(b.pdf, chart.Box{X: margin, Y: y, W: contentW, H: chartH}, lines, chart.LineChartOptions{
		From:     b.in.From,
		To:       b.in.To,
		Location: b.in.Location,
		YLabel:   "Events per bucket",
		XLabel:   fmt.Sprintf("Time (%s)", b.tzName()),
		Text:     b.tr,
	})
	b.pdf.SetY(y + chartH + 2)
}

func toChartPoints(pts []Point) []chart.Point {
	out := make([]chart.Point, len(pts))
	for i, p := range pts {
		out[i] = chart.Point{T: time.UnixMilli(p.TimestampMs), V: p.Value}
	}
	return out
}

func (b *builder) logSection() {
	const maxBars = 15
	bars := make([]chart.Bar, 0, len(b.in.LogSummary))
	var total int64
	for _, l := range b.in.LogSummary {
		name := strings.TrimSpace(l.Type)
		if name == "" {
			name = "(unknown)"
		}
		bars = append(bars, chart.Bar{Label: name, Value: float64(l.Count)})
		total += l.Count
	}
	chart.SortBarsDesc(bars)

	shown := bars
	if len(shown) > maxBars {
		rest := 0.0
		for _, x := range shown[maxBars-1:] {
			rest += x.Value
		}
		shown = append(append([]chart.Bar(nil), shown[:maxBars-1]...),
			chart.Bar{Label: fmt.Sprintf("Other (%d types)", len(bars)-maxBars+1), Value: rest})
	}
	h := chart.BarChartHeight(len(shown))
	b.section("Events by type", "from the log summary", h)
	if total == 0 {
		b.emptyState("No data for period", 22)
		return
	}
	y := b.pdf.GetY()
	chart.DrawBarChart(b.pdf, chart.Box{X: margin, Y: y, W: contentW, H: h}, shown, chart.BarChartOptions{Color: accent, Text: b.tr})
	b.pdf.SetY(y + h + 4)

	b.ensure(7.5 + 6.8*2)
	rows := make([][]string, len(bars))
	for i, x := range bars {
		share := 0.0
		if total > 0 {
			share = x.Value / float64(total) * 100
		}
		rows[i] = []string{fmt.Sprintf("%d", i+1), x.Label, chart.FormatInt(x.Value), fmt.Sprintf("%.1f%%", share)}
	}
	b.table([]column{
		{"#", 0.07, "R"},
		{"Event type", 0.53, "L"},
		{"Count", 0.2, "R"},
		{"Share", 0.2, "R"},
	}, rows, nil)
	pdf := b.pdf
	y = pdf.GetY()
	pdf.SetFont("Helvetica", "B", 8)
	b.color(chart.InkPrimary)
	b.cellText(margin+contentW*0.07, y, contentW*0.53, 7, "Total", "L")
	b.cellText(margin+contentW*0.6, y, contentW*0.2, 7, chart.FormatInt(float64(total)), "R")
	b.cellText(margin+contentW*0.8, y, contentW*0.2, 7, "100.0%", "R")
	b.draw(chart.AxisColor)
	pdf.SetLineWidth(0.3)
	pdf.Line(margin, y+7, margin+contentW, y+7)
	pdf.SetY(y + 9)
}

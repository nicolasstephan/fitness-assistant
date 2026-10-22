// Minimal SVG charts: line (time series), stacked columns, horizontal bars.
// Colors come from CSS custom properties (see .health in style.css), so light/dark mode just works.

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD = { top: 12, right: 44, bottom: 24, left: 36 };

function svgEl(tag, attrs = {}, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.appendChild(el);
  return el;
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

const DAY = 86400000;
const fmtDate = (t, opts) => new Date(t).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });

function timeTicks(t0, t1, width) {
  const span = (t1 - t0) / DAY;
  const maxTicks = Math.max(2, Math.floor(width / 70));
  const ticks = [];
  if (span > 70) {
    // month starts
    const d = new Date(t0);
    let m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    while (m <= t1) {
      ticks.push(m);
      const md = new Date(m);
      m = Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 1);
    }
    const every = Math.ceil(ticks.length / maxTicks);
    return { ticks: ticks.filter((_, i) => i % every === 0), fmt: (t) => fmtDate(t, { month: "short" }) };
  }
  const stepDays = [1, 2, 7, 14].find((s) => span / s <= maxTicks) ?? 14;
  for (let t = t0; t <= t1; t += stepDays * DAY) ticks.push(t);
  return { ticks, fmt: (t) => fmtDate(t, { day: "numeric", month: "short" }) };
}

/**
 * Least-squares linear trend over points [{ t, v }] (nulls ignored). Null if fewer than 3 points.
 * tStat = slope / its standard error; |tStat| < 2 means the slope is not distinguishable from noise.
 */
export function linearTrend(points) {
  const ps = points.filter((p) => p.v != null);
  if (ps.length < 3) return null;
  const n = ps.length;
  const mt = ps.reduce((a, p) => a + p.t, 0) / n;
  const mv = ps.reduce((a, p) => a + p.v, 0) / n;
  let num = 0, den = 0;
  for (const p of ps) {
    num += (p.t - mt) * (p.v - mv);
    den += (p.t - mt) ** 2;
  }
  const slope = den ? num / den : 0;
  const at = (t) => mv + slope * (t - mt);
  const ssRes = ps.reduce((a, p) => a + (p.v - at(p.t)) ** 2, 0);
  const se = den ? Math.sqrt(ssRes / (n - 2) / den) : 0;
  const tStat = se ? slope / se : 0;
  const t0 = ps[0].t, t1 = ps.at(-1).t;
  return { at, t0, t1, n, delta: at(t1) - at(t0), tStat };
}

/** One trend or several (e.g. one per device), each drawn over its own time span. */
const trendList = (trend) => [].concat(trend ?? []).filter(Boolean);

function drawTrends(svg, trend, x, y) {
  for (const tr of trendList(trend)) {
    svgEl("line", { x1: x(tr.t0), y1: y(tr.at(tr.t0)), x2: x(tr.t1), y2: y(tr.at(tr.t1)), class: "trend" }, svg);
  }
}

/** Labeled vertical lines [{ t, label }], e.g. where the data switches from WHOOP to Polar. */
function drawMarks(svg, marks, x, width, height) {
  for (const m of marks ?? []) {
    const px = x(m.t);
    if (px < PAD.left || px > width - PAD.right) continue;
    svgEl("line", { x1: px, x2: px, y1: PAD.top, y2: height - PAD.bottom, class: "mark" }, svg);
    // label on the side with more room
    const right = px < width - PAD.right - 40;
    // at the bottom of the plot: the top holds the "No data" label of a gap that often ends here
    svgEl("text", { x: px + (right ? 4 : -4), y: height - PAD.bottom - 5, class: "mark-label", "text-anchor": right ? "start" : "end" }, svg).textContent = m.label;
  }
}

/** Shared hover tooltip for a chart container. Content is built with textContent only. */
function tooltip(container) {
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.hidden = true;
  container.appendChild(tip);
  return {
    show(x, y, title, rows) {
      tip.replaceChildren();
      const h = document.createElement("div");
      h.className = "chart-tip-title";
      h.textContent = title;
      tip.appendChild(h);
      for (const { value, label, color } of rows) {
        const row = document.createElement("div");
        row.className = "chart-tip-row";
        if (color) {
          const key = document.createElement("i");
          key.style.background = color;
          row.appendChild(key);
        }
        const b = document.createElement("strong");
        b.textContent = value;
        row.appendChild(b);
        if (label) row.appendChild(document.createTextNode(` ${label}`));
        tip.appendChild(row);
      }
      tip.hidden = false;
      // right of the pointer, flipped to the left near the edge
      let left = x + 12;
      if (left + tip.offsetWidth > container.clientWidth) left = x - tip.offsetWidth - 12;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight / 2)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function frame(container, height) {
  container.replaceChildren();
  container.classList.add("chart");
  const width = container.clientWidth || 320;
  const svg = svgEl("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" }, container);
  return { svg, width, height, tip: tooltip(container) };
}

/** Shaded "No data" bands for gaps [{ t0, t1 }], clamped to the plot. Drawn behind the data. */
function drawGaps(svg, gaps, x, width, height) {
  for (const g of gaps ?? []) {
    const x0 = Math.max(PAD.left, x(g.t0)), x1 = Math.min(width - PAD.right, x(g.t1));
    if (x1 - x0 < 1) continue;
    svgEl("rect", { x: x0, y: PAD.top, width: x1 - x0, height: height - PAD.top - PAD.bottom, class: "gap" }, svg);
    // label at the top of the band: in the middle it collided with the end label of the line
    if (x1 - x0 >= 56) {
      svgEl("text", { x: (x0 + x1) / 2, y: PAD.top + 14, class: "gap-label", "text-anchor": "middle" }, svg).textContent = "No data";
    }
  }
}

function noData(container) {
  container.replaceChildren();
  container.textContent = "No data in this period.";
}

function yAxis(svg, ticks, y, x0, x1, fmt) {
  for (const v of ticks) {
    svgEl("line", { x1: x0, x2: x1, y1: y(v), y2: y(v), class: "grid" }, svg);
    svgEl("text", { x: x0 - 6, y: y(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, svg).textContent = fmt(v);
  }
}

/**
 * Time series line. points: [{ t (UTC ms), v (number|null) }]; gaps where v is null.
 * opts: { color, format, unit, describe(t),
 *         ticks (fixed y ticks), tickFormat,
 *         smooth: { points, label } - rolling average drawn bold; `points` then render faint,
 *         baseLabel - tooltip label for `points`, trend (from linearTrend) - straight line }
 */
export function lineChart(container, points, opts) {
  const { svg, width, height, tip } = frame(container, opts.height ?? 180);
  const smooth = opts.smooth?.points ?? null;
  const all = smooth ? [...points, ...smooth] : points;
  const vals = all.map((p) => p.v).filter((v) => v != null);
  if (!vals.length) return noData(container);
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const ticks = opts.ticks ?? niceTicks(Math.min(...vals), Math.max(...vals));
  const [lo, hi] = [ticks[0], ticks.at(-1)];
  const x = (t) => PAD.left + ((t - t0) / (t1 - t0 || 1)) * (width - PAD.left - PAD.right);
  const y = (v) => PAD.top + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * (height - PAD.top - PAD.bottom);
  const fmt = opts.format ?? ((v) => `${Math.round(v)}`);

  yAxis(svg, ticks, y, PAD.left, width - PAD.right, opts.tickFormat ?? fmt);
  drawGaps(svg, opts.gaps, x, width, height);
  drawMarks(svg, opts.marks, x, width, height);
  const tt = timeTicks(t0, t1, width - PAD.left - PAD.right);
  for (const t of tt.ticks) {
    svgEl("text", { x: x(t), y: height - 6, class: "tick", "text-anchor": "middle" }, svg).textContent = tt.fmt(t);
  }

  const pathOf = (ps) => {
    let d = "";
    let pen = false;
    for (const p of ps) {
      if (p.v == null) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  svgEl("path", { d: pathOf(points), class: smooth ? "line faint" : "line", stroke: opts.color }, svg);
  drawTrends(svg, opts.trend, x, y);
  if (smooth) svgEl("path", { d: pathOf(smooth), class: "line", stroke: opts.color }, svg);

  const main = smooth ?? points;
  const last = [...main].reverse().find((p) => p.v != null);
  if (last) {
    svgEl("circle", { cx: x(last.t), cy: y(last.v), r: 4, fill: opts.color, class: "dot" }, svg);
    svgEl("text", { x: x(last.t) + 8, y: y(last.v), class: "end-label", "dominant-baseline": "middle" }, svg).textContent = fmt(last.v);
  }

  // crosshair snaps to the nearest base point; the readout lists every series at that x
  const nearest = (ps, px) => {
    let best = null;
    for (const p of ps) if (p.v != null && (!best || Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px))) best = p;
    return best;
  };
  const unit = opts.unit ? ` ${opts.unit}` : "";
  const cross = svgEl("line", { y1: PAD.top, y2: height - PAD.bottom, class: "crosshair", visibility: "hidden" }, svg);
  const hoverDot = svgEl("circle", { r: 4, fill: opts.color, class: "dot", visibility: "hidden" }, svg);
  const hit = svgEl("rect", { x: PAD.left, y: 0, width: width - PAD.left - PAD.right, height, fill: "transparent" }, svg);
  const move = (e) => {
    const px = e.clientX - svg.getBoundingClientRect().left;
    const best = nearest(points, px) ?? nearest(main, px);
    if (!best) return;
    const s = smooth ? nearest(smooth, x(best.t)) : null;
    cross.setAttribute("x1", x(best.t));
    cross.setAttribute("x2", x(best.t));
    cross.setAttribute("visibility", "visible");
    hoverDot.setAttribute("cx", x(best.t));
    hoverDot.setAttribute("cy", y((s ?? best).v));
    hoverDot.setAttribute("visibility", "visible");
    const rows = [];
    if (s) rows.push({ value: `${fmt(s.v)}${unit}`, label: opts.smooth.label, color: opts.color });
    rows.push({ value: `${fmt(best.v)}${unit}`, label: smooth ? opts.baseLabel : "", color: smooth ? null : opts.color });
    const tr = trendList(opts.trend).find((x) => best.t >= x.t0 && best.t <= x.t1);
    if (tr) rows.push({ value: `${fmt(tr.at(best.t))}${unit}`, label: tr.source ? `trend (${tr.source})` : "trend" });
    tip.show(x(best.t), y((s ?? best).v), opts.describe(best.t), rows);
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    hoverDot.setAttribute("visibility", "hidden");
    tip.hide();
  });
}

/**
 * Stacked columns. rows: [{ t, values: [..] }], series: [{ name, color }] bottom-up.
 * opts: { format, unit, describe(t), smooth: [{ t, v }] rolling average of the total, trend (from linearTrend) }
 */
export function stackedColumns(container, rows, series, opts) {
  const { svg, width, height, tip } = frame(container, opts.height ?? 200);
  const totals = rows.map((r) => r.values.reduce((a, b) => a + (b ?? 0), 0));
  if (!totals.some((v) => v > 0)) return noData(container);
  const ticks = niceTicks(0, Math.max(...totals));
  const hi = ticks.at(-1);
  const plotW = width - PAD.left - PAD.right;
  const band = plotW / rows.length;
  const barW = Math.min(24, Math.max(2, band - 2)); // 2px surface gap between neighbors
  const y = (v) => PAD.top + (1 - v / hi) * (height - PAD.top - PAD.bottom);
  const fmt = opts.format ?? ((v) => `${v}`);

  yAxis(svg, ticks, y, PAD.left, width - PAD.right, fmt);
  const t0 = rows[0].t, t1 = rows.at(-1).t;
  const xCenter = (i) => PAD.left + band * (i + 0.5);
  // gaps in time -> pixels across the column bands
  const xBand = (t) => PAD.left + band / 2 + ((t - t0) / (t1 - t0 || 1)) * (band * (rows.length - 1));
  drawGaps(svg, opts.gaps, xBand, width, height);
  drawMarks(svg, opts.marks, xBand, width, height);
  const tt = timeTicks(t0, t1, plotW);
  for (const t of tt.ticks) {
    const i = Math.round(((t - t0) / (t1 - t0 || 1)) * (rows.length - 1));
    svgEl("text", { x: xCenter(i), y: height - 6, class: "tick", "text-anchor": "middle" }, svg).textContent = tt.fmt(t);
  }

  rows.forEach((row, i) => {
    const g = svgEl("g", { class: "col" }, svg);
    let acc = 0;
    const topIdx = row.values.reduce((top, v, k) => (v > 0 ? k : top), -1);
    row.values.forEach((v, k) => {
      if (!v) return;
      const yTop = y(acc + v);
      const h = y(acc) - yTop - (k === topIdx ? 0 : 2); // 2px gap between segments
      acc += v;
      if (h <= 0) return;
      const x0 = xCenter(i) - barW / 2;
      const r = k === topIdx ? Math.min(4, barW / 2, h) : 0; // rounded data-end, square elsewhere
      const path = r
        ? `M${x0},${yTop + h}V${yTop + r}Q${x0},${yTop} ${x0 + r},${yTop}H${x0 + barW - r}Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r}V${yTop + h}Z`
        : `M${x0},${yTop + (k === topIdx ? 0 : 2)}h${barW}v${h}h${-barW}Z`;
      svgEl("path", { d: path, fill: series[k].color }, g);
    });
    // hit target: the whole band, full height
    const hit = svgEl("rect", { x: PAD.left + band * i, y: PAD.top, width: band, height: height - PAD.top - PAD.bottom, fill: "transparent" }, g);
    const show = () => {
      g.classList.add("hover");
      tip.show(xCenter(i), y(totals[i]), opts.describe(row.t), [
        { value: `${fmt(totals[i])} ${opts.unit ?? ""}`.trim(), label: "total" },
        ...series.map((s, k) => ({ value: fmt(row.values[k] ?? 0), label: s.name, color: s.color })).reverse(),
      ]);
    };
    hit.addEventListener("pointerenter", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", () => {
      g.classList.remove("hover");
      tip.hide();
    });
  });

  // rolling average and trend of the column totals, mapped onto the column centers
  if (trendList(opts.trend).length || opts.smooth) {
    const span = t1 - t0 || 1;
    const xT = (t) => xCenter(0) + ((t - t0) / span) * (xCenter(rows.length - 1) - xCenter(0));
    const overlay = svgEl("g", { "pointer-events": "none" }, svg);
    if (opts.smooth) {
      let d = "";
      let pen = false;
      for (const p of opts.smooth) {
        if (p.v == null || p.t < t0) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${xT(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
        pen = true;
      }
      svgEl("path", { d, class: "line overlay" }, overlay);
    }
    drawTrends(overlay, opts.trend, xT, y);
  }
}

/** Horizontal bars. rows: [{ label, value }]; value label at the bar tip. */
export function hBars(container, rows, opts) {
  container.replaceChildren();
  container.classList.add("chart", "hbars");
  const max = Math.max(...rows.map((r) => r.value), 1);
  const fmt = opts.format ?? ((v) => `${v}`);
  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "hbar-row";
    const label = document.createElement("span");
    label.className = "hbar-label";
    label.textContent = r.label;
    const track = document.createElement("span");
    track.className = "hbar-track";
    const bar = document.createElement("span");
    bar.className = "hbar";
    bar.style.width = `${(r.value / max) * 100}%`;
    bar.style.background = opts.color;
    track.appendChild(bar);
    const val = document.createElement("span");
    val.className = "hbar-value";
    val.textContent = fmt(r.value);
    row.append(label, track, val);
    container.appendChild(row);
  }
}

/** Table twin of a chart: columns [{ label, get(row), num? }]. */
export function dataTable(container, columns, rows) {
  container.replaceChildren();
  const table = document.createElement("table");
  table.className = "data-table";
  const head = table.createTHead().insertRow();
  for (const c of columns) {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.num) th.className = "num";
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (const r of rows) {
    const tr = body.insertRow();
    for (const c of columns) {
      const td = tr.insertCell();
      td.textContent = c.get(r) ?? "–";
      if (c.num) td.className = "num";
    }
  }
  container.appendChild(table);
}

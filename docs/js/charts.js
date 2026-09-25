// Chart renderers: cumulative line, daily bars, status donut, per-token fill price.
// Instantiate once via initCharts(deps); deps = { $, fmt, _L, SUCCESS }.
export function initCharts(deps) {
  var $ = deps.$, fmt = deps.fmt, _L = deps._L, SUCCESS = deps.SUCCESS;

  var tip = $("chartTip");
  function showTip(ev, html) {
    tip.innerHTML = html;
    tip.classList.add("show");
    var tx = ev.clientX + 14, ty = ev.clientY - 14;
    if (tx + 180 > window.innerWidth) tx = ev.clientX - 180;
    if (ty < 8) ty = ev.clientY + 18;
    tip.style.left = tx + "px"; tip.style.top = ty + "px";
  }
  function hideTip() { tip.classList.remove("show"); }

  function gridLines(W, H, padL, padR, padT, padB, max, steps, suffix, decimals) {
    var g = "";
    for (var i = 0; i <= steps; i++) {
      var v = (max / steps) * i, yy = padT + (H - padT - padB) * (1 - v / max);
      g += '<line x1="' + padL + '" y1="' + yy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + yy.toFixed(1) + '" class="chart-grid"/>';
      g += '<text x="' + (padL - 4) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end" class="chart-label">' + fmt(v, decimals == null ? 2 : decimals) + (suffix || '') + '</text>';
    }
    return '<g stroke="var(--glass-brd)" stroke-dasharray="4 4">' + g + '</g>';
  }

  function renderChart(points) {
    var host = $("chartHost");
    if (!points.length) { host.innerHTML = '<div class="empty-state fade-in"><div class="empty-icon">📊</div><p class="empty-title">No completed runs yet</p><p class="empty-desc">The agent runs daily via GitHub Actions. Check back after the next cron trigger to see deployment data here.</p></div>'; return; }
    var W = 920, H = 220, padL = 54, padR = 12, padT = 16, padB = 28;
    var max = Math.ceil(points[points.length - 1].cum * 1.15) || 1, n = points.length;
    function x(i) { return padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR) / (n - 1))); }
    function y(v) { return padT + (H - padT - padB) * (1 - v / max); }
    var grid = gridLines(W, H, padL, padR, padT, padB, max, 4, '', 2);
    var line = "", area = "M" + x(0) + " " + (H - padB), len = 0, px0 = x(0), py0 = y(points[0].cum);
    for (var i = 0; i < n; i++) {
      var px = x(i), py = y(points[i].cum);
      if (i) len += Math.hypot(px - px0, py - py0);
      px0 = px; py0 = py;
      line += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1) + " ";
      area += " L" + px.toFixed(1) + " " + py.toFixed(1);
    }
    area += " L" + x(n - 1) + " " + (H - padB) + " Z";
    var dots = "", zones = "", labels = "";
    for (var j = 0; j < n; j++) {
      var cx = x(j), cy = y(points[j].cum);
      dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4" fill="#a78bfa" stroke="#060912" stroke-width="1.5"/>';
      zones += '<rect x="' + (cx - (W/n/2)).toFixed(1) + '" y="' + padT + '" width="' + (W/n).toFixed(1) + '" height="' + (H - padT - padB) + '" fill="transparent" data-tip="cum" data-i="' + j + '"/>';
      if (n <= 14 || j % Math.ceil(n / 10) === 0) labels += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="chart-label">' + (points[j].date || '').slice(5) + '</text>';
    }
    host.innerHTML =
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5cf6" stop-opacity="0.4"/><stop offset="1" stop-color="#8a5cf6" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="lg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2f86e6"/><stop offset="1" stop-color="#a78bfa"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#ag)"/>' +
      '<path class="line" style="--len:' + (len + 4).toFixed(0) + '" d="' + line + '" fill="none" stroke="url(#lg)" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + zones + '</svg>';
    host.querySelector("svg").addEventListener("mousemove", function (ev) {
      var r = this.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      var closest = 0, minD = Infinity;
      for (var k = 0; k < n; k++) { var d = Math.abs(x(k) - sx); if (d < minD) { minD = d; closest = k; } }
      var p = points[closest];
      showTip(ev, '<div class="tt-label">' + (p.date || 'Run ' + (closest + 1)) + '</div><div class="tt-val">' + fmt(p.cum, 4) + ' USDC</div><div class="tt-sub">Cumulative total</div>');
    });
    host.querySelector("svg").addEventListener("mouseleave", hideTip);
  }

  // ---------- daily DCA bar chart ----------
  function renderDailyChart(history) {
    var host = $("dailyChartHost");
    // Aggregate by calendar day (the section is "DCA amount by day"): summing
    // per-date avoids drawing one bar per execution, which — with hundreds of
    // runs in a ~392px-wide plot — overlaps the semi-transparent gradient bars
    // into a jagged moiré rather than clean daily columns.
    var byDate = {}, daily = [];
    history.forEach(function (e) {
      if (!SUCCESS[e.status]) return;
      var amt = parseFloat(e.clampedAmountUsdc || "0") || 0;
      if (amt <= 0) return;
      var d = byDate[e.date];
      if (!d) { d = byDate[e.date] = { date: e.date, amt: 0, runs: 0, allSuccess: true }; daily.push(d); }
      d.amt += amt;
      d.runs++;
      if (e.status !== "success") d.allSuccess = false;
    });
    daily.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (!daily.length) {
      host.innerHTML = '<div class="empty-state fade-in"><div class="empty-icon">📅</div><p class="empty-title">No daily data yet</p><p class="empty-desc">DCA amounts will appear as bars after successful runs.</p></div>';
      $("dailySub").textContent = "No data";
      return;
    }
    $("dailySub").textContent = (_L().lrDailySub || "{n} execution(s) · avg {a} USDC").replace("{n}", daily.length).replace("{a}", fmt(daily.reduce(function (s, d) { return s + d.amt; }, 0) / daily.length, 4));
    var W = 440, H = 170, padL = 40, padR = 8, padT = 12, padB = 26;
    var max = Math.ceil(Math.max.apply(null, daily.map(function (d) { return d.amt; })) * 1.2) || 1;
    // Bar width is capped to the column spacing (never a fixed floor above it),
    // so bars stay separated no matter how many days are plotted.
    var n = daily.length, gap = (W - padL - padR) / n, bw = Math.max(2, Math.min(32, gap * 0.7));
    var grid = gridLines(W, H, padL, padR, padT, padB, max, 3, '', 2);
    var bars = "", labels = "";
    for (var i = 0; i < n; i++) {
      var cx = padL + gap * i + gap / 2;
      var bh = (H - padT - padB) * (daily[i].amt / max);
      var by = H - padB - bh;
      var color = daily[i].allSuccess ? "url(#db1)" : "url(#db2)";
      bars += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="' + color + '" opacity="0.85"/>';
      if (n <= 10 || i % Math.ceil(n / 8) === 0) labels += '<text x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="chart-label">' + daily[i].date.slice(5) + '</text>';
    }
    host.innerHTML =
      '<svg class="daily-chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="db1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#34d399" stop-opacity="0.3"/></linearGradient>' +
      '<linearGradient id="db2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60a5fa"/><stop offset="1" stop-color="#60a5fa" stop-opacity="0.3"/></linearGradient></defs>' +
      grid + bars + labels + '</svg>';
    host.querySelector("svg").addEventListener("mousemove", function (ev) {
      var r = this.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      var closest = 0, minD = Infinity;
      for (var k = 0; k < n; k++) { var cx2 = padL + gap * k + gap / 2; var d = Math.abs(cx2 - sx); if (d < minD) { minD = d; closest = k; } }
      var dd = daily[closest];
      showTip(ev, '<div class="tt-label">' + dd.date + '</div><div class="tt-val">' + fmt(dd.amt, 4) + ' USDC</div><div class="tt-sub">' + (_L().lrDayRuns || "{n} run(s)").replace("{n}", dd.runs) + '</div>');
    });
    host.querySelector("svg").addEventListener("mouseleave", hideTip);
  }

  // ---------- status donut chart ----------
  function renderDonut(history) {
    var host = $("donutHost");
    if (!history.length) {
      host.innerHTML = '<div class="empty-state fade-in"><div class="empty-icon">🎯</div><p class="empty-title">No runs yet</p><p class="empty-desc">Run distribution will appear after the first agent execution.</p></div>';
      $("donutSub").textContent = "No data";
      return;
    }
    var counts = { success: 0, dry_run: 0, simulated: 0, skipped: 0, error: 0 };
    history.forEach(function (e) {
      if (e.status === "success") counts.success++;
      else if (e.status === "dry_run") counts.dry_run++;
      else if (e.status === "simulated") counts.simulated++;
      else if (e.status && e.status.indexOf("skip") === 0) counts.skipped++;
      else counts.error++;
    });
    var total = history.length;
    $("donutSub").textContent = (_L().lrDonutSub || "{n} total run(s)").replace("{n}", total);
    var slices = [
      { label: (_L().dlSuccess||"Success"), count: counts.success, color: "#34d399" },
      { label: (_L().dlDry||"Dry run"), count: counts.dry_run, color: "#60a5fa" },
      { label: (_L().dlSimulated||"Simulated"), count: counts.simulated, color: "#22d3ee" },
      { label: (_L().dlSkipped||"Skipped"), count: counts.skipped, color: "#fbbf24" },
      { label: (_L().dlError||"Error"), count: counts.error, color: "#fb7185" },
    ].filter(function (s) { return s.count > 0; });
    var R = 80, r = 50, cx = 120, cy = 100, paths = "", angle = -90;
    slices.forEach(function (s) {
      var sweep = (s.count / total) * 360;
      var a1 = angle * Math.PI / 180, a2 = (angle + sweep) * Math.PI / 180;
      var large = sweep > 180 ? 1 : 0;
      var x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      var x2 = cx + R * Math.cos(a2), y2 = cy + R * Math.sin(a2);
      var ix1 = cx + r * Math.cos(a1), iy1 = cy + r * Math.sin(a1);
      var ix2 = cx + r * Math.cos(a2), iy2 = cy + r * Math.sin(a2);
      paths += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' L' + ix2.toFixed(1) + ' ' + iy2.toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + large + ' 0 ' + ix1.toFixed(1) + ' ' + iy1.toFixed(1) + ' Z" fill="' + s.color + '" opacity="0.85" style="transition:opacity .15s;cursor:pointer;" onmouseenter="this.style.opacity=1" onmouseleave="this.style.opacity=0.85"/>';
      angle += sweep;
    });
    var centerText = '<text x="' + cx + '" y="' + (cy - 4) + '" text-anchor="middle" fill="var(--text)" font-family="Sora" font-size="22" font-weight="800">' + total + '</text>' +
      '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" fill="var(--muted)" font-size="11">' + (_L().dlRuns||"runs") + '</text>';
    host.innerHTML =
      '<svg class="donut-chart" viewBox="0 0 240 200">' + paths + centerText + '</svg>' +
      '<div class="donut-legend">' + slices.map(function (s) {
        return '<span><span class="dl-dot" style="background:' + s.color + ';"></span><span class="dl-count">' + s.count + '</span> ' + s.label + ' (' + Math.round(s.count / total * 100) + '%)</span>';
      }).join("") + '</div>';
  }

  var _fillsByToken = null;
  var _fillTok = null;
  function renderPriceChart(history) {
    var card = $("priceChartCard");
    var byTok = {};
    history.forEach(function (e) {
      if (!SUCCESS[e.status]) return;
      var usdcIn = parseFloat(e.clampedAmountUsdc || "0") || 0;
      var out = parseFloat(e.amountOut || "0") || 0;
      if (!(usdcIn > 0 && out > 0)) return;
      var tok = e.tokenOut || "cirBTC";
      (byTok[tok] = byTok[tok] || []).push({ date: e.date, price: usdcIn / out, usdcIn: usdcIn, out: out });
    });
    var toks = Object.keys(byTok).sort();
    if (!toks.length) { card.style.display = "none"; return; }
    card.style.display = "";
    _fillsByToken = byTok;
    // Keep the user's tab choice while it still has data; else default to the
    // token with the most recent fill.
    if (!_fillTok || !byTok[_fillTok]) {
      var lastTok = toks[0], lastDate = "";
      toks.forEach(function (t) { var d = byTok[t][byTok[t].length - 1].date || ""; if (d >= lastDate) { lastDate = d; lastTok = t; } });
      _fillTok = lastTok;
    }
    var tabs = $("priceChartTabs");
    if (tabs) {
      tabs.innerHTML = toks.length > 1 ? toks.map(function (t) {
        var on = t === _fillTok;
        return '<button class="btn ghost" data-ftok="' + t + '" style="padding:4px 12px;font-size:12px;' + (on ? 'border-color:var(--violet);color:var(--violet);' : '') + '">' + t + '</button>';
      }).join("") : "";
      Array.prototype.slice.call(tabs.querySelectorAll("[data-ftok]")).forEach(function (b) {
        b.addEventListener("click", function () { _fillTok = this.getAttribute("data-ftok"); drawFillChart(); });
      });
    }
    drawFillChart();
  }
  function drawFillChart() {
    var host = $("priceChartHost");
    var swaps = (_fillsByToken && _fillsByToken[_fillTok]) || [];
    if (!swaps.length) return;
    var tok = _fillTok;
    var outDp = tok === "cirBTC" ? 8 : 6;
    var title = $("priceChartTitle");
    if (title) title.textContent = "USDC → " + tok + " " + (_L().lrFillWord||"fill price");
    var latest = swaps[swaps.length - 1];
    var prev = swaps.length > 1 ? swaps[swaps.length - 2] : latest;
    var change = prev.price > 0 ? ((latest.price - prev.price) / prev.price * 100) : 0;
    var changeStr = (change >= 0 ? "+" : "") + change.toFixed(2) + "%";
    var changeColor = change >= 0 ? "var(--green)" : "var(--red)";
    $("priceSub").innerHTML = (_L().lrLatest || "Latest:") + " <b>" + fmt(latest.price, 4) + " USDC/" + tok + "</b> <span style='color:" + changeColor + ";font-weight:700;'>" + changeStr + "</span> · " + swaps.length + " " + (_L().lrFills || "fill(s)");

    var W = 920, H = 220, padL = 54, padR = 12, padT = 16, padB = 28;
    var prices = swaps.map(function (s) { return s.price; });
    var max = Math.max.apply(null, prices) * 1.12 || 1;
    var min = Math.min.apply(null, prices) * 0.88 || 0;
    var range = max - min || 1;
    var n = prices.length;
    function x(i) { return padL + (n === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR) / (n - 1))); }
    function y(v) { return padT + (H - padT - padB) * (1 - (v - min) / range); }
    var grid = "";
    for (var gi = 0; gi <= 4; gi++) {
      var gv = min + (range / 4) * gi, gy = y(gv);
      grid += '<line x1="' + padL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + gy.toFixed(1) + '" stroke="var(--glass-brd)" stroke-dasharray="4 4"/>';
      grid += '<text x="' + (padL - 4) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end" class="chart-label">' + fmt(gv, 2) + '</text>';
    }
    var line = "", area = "M" + x(0) + " " + (H - padB), len = 0, px0 = x(0), py0 = y(prices[0]);
    for (var i = 0; i < n; i++) {
      var px = x(i), py = y(prices[i]);
      if (i) len += Math.hypot(px - px0, py - py0);
      px0 = px; py0 = py;
      line += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1) + " ";
      area += " L" + px.toFixed(1) + " " + py.toFixed(1);
    }
    area += " L" + x(n - 1) + " " + (H - padB) + " Z";
    var dots = "", labels = "";
    for (var j = 0; j < n; j++) {
      dots += '<circle cx="' + x(j).toFixed(1) + '" cy="' + y(prices[j]).toFixed(1) + '" r="4.5" fill="#f59e0b" stroke="var(--bg)" stroke-width="2"/>';
      if (n <= 14 || j % Math.ceil(n / 10) === 0) labels += '<text x="' + x(j).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" class="chart-label">' + swaps[j].date.slice(5) + '</text>';
    }
    host.innerHTML =
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f59e0b" stop-opacity="0.3"/><stop offset="1" stop-color="#f59e0b" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="pl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#fb923c"/></linearGradient></defs>' +
      grid + '<path d="' + area + '" fill="url(#pg)"/>' +
      '<path class="line" style="--len:' + (len + 4).toFixed(0) + '" d="' + line + '" fill="none" stroke="url(#pl)" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots + labels + '</svg>';
    host.querySelector("svg").addEventListener("mousemove", function (ev) {
      var r = this.getBoundingClientRect(), sx = (ev.clientX - r.left) / r.width * W;
      var closest = 0, minD = Infinity;
      for (var k = 0; k < n; k++) { var d = Math.abs(x(k) - sx); if (d < minD) { minD = d; closest = k; } }
      var s = swaps[closest];
      showTip(ev, '<div class="tt-label">' + s.date + '</div><div class="tt-val">' + fmt(s.price, 4) + ' USDC/' + tok + '</div><div class="tt-sub">' + fmt(s.usdcIn, 4) + ' → ' + fmt(s.out, outDp) + ' ' + tok + '</div>');
    });
    host.querySelector("svg").addEventListener("mouseleave", hideTip);
  }

  return {
    renderChart: renderChart,
    renderDailyChart: renderDailyChart,
    renderDonut: renderDonut,
    renderPriceChart: renderPriceChart,
  };
}

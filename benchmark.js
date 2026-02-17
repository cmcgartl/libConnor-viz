// CsMalloc Benchmark Dashboard — auto-loading version
(function() {
    'use strict';

    const COLORS = {
        mm: '#388bfd',
        libc: '#f0883e',
        bg: '#0d1117',
        grid: '#21262d',
        text: '#8b949e',
        utilBar: '#3fb950'
    };

    let lastData = null;

    function drawBarChart(canvas, data) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const W = rect.width - 32;
        const H = 300;

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(dpr, dpr);

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);

        const { labels, series, colors, yLabel } = data;
        const n = labels.length;
        const numSeries = series.length;
        const maxVal = Math.max(1, ...series.flat()) * 1.15;

        const LEFT = 60;
        const RIGHT = 16;
        const TOP = 16;
        const BOTTOM = 60;
        const plotW = W - LEFT - RIGHT;
        const plotH = H - TOP - BOTTOM;

        // Y axis grid
        const yTicks = 5;
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= yTicks; i++) {
            const val = (maxVal / yTicks) * i;
            const y = TOP + plotH - (i / yTicks) * plotH;
            ctx.strokeStyle = COLORS.grid;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(LEFT, y);
            ctx.lineTo(LEFT + plotW, y);
            ctx.stroke();
            ctx.fillStyle = COLORS.text;
            ctx.fillText(formatNum(val), LEFT - 6, y);
        }

        // Y label
        ctx.save();
        ctx.translate(12, TOP + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillStyle = COLORS.text;
        ctx.font = '11px monospace';
        ctx.fillText(yLabel || '', 0, 0);
        ctx.restore();

        // Bars
        const groupW = plotW / n;
        const barW = Math.min(groupW * 0.35, 30);
        const gap = barW * 0.3;

        for (let g = 0; g < n; g++) {
            const gx = LEFT + g * groupW + groupW / 2;

            for (let s = 0; s < numSeries; s++) {
                const val = series[s][g];
                const barH = (val / maxVal) * plotH;
                const x = gx + (s - numSeries / 2) * (barW + gap);

                ctx.fillStyle = colors[s];
                ctx.fillRect(x, TOP + plotH - barH, barW, barH);

                // Value on top
                if (barH > 20) {
                    ctx.fillStyle = '#fff';
                    ctx.font = '9px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText(formatNum(val), x + barW / 2, TOP + plotH - barH - 4);
                }
            }

            // X label
            ctx.fillStyle = COLORS.text;
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.save();
            ctx.translate(gx, TOP + plotH + 8);
            ctx.rotate(-Math.PI / 4);
            ctx.fillText(labels[g], 0, 0);
            ctx.restore();
        }

        // Legend
        const legendX = LEFT + 8;
        const legendY = TOP + 8;
        for (let s = 0; s < numSeries; s++) {
            ctx.fillStyle = colors[s];
            ctx.fillRect(legendX + s * 80, legendY, 12, 12);
            ctx.fillStyle = COLORS.text;
            ctx.font = '11px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(s === 0 ? 'mm' : 'libc', legendX + s * 80 + 16, legendY + 10);
        }
    }

    function drawUtilChart(canvas, data) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const W = rect.width - 32;
        const H = 300;

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(dpr, dpr);

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);

        const { labels, values } = data;
        const n = labels.length;

        const LEFT = 50;
        const RIGHT = 16;
        const TOP = 16;
        const BOTTOM = 60;
        const plotW = W - LEFT - RIGHT;
        const plotH = H - TOP - BOTTOM;

        // Y axis grid (0-100%)
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        for (let i = 0; i <= 5; i++) {
            const pct = i * 20;
            const y = TOP + plotH - (pct / 100) * plotH;
            ctx.strokeStyle = COLORS.grid;
            ctx.lineWidth = 0.5;
            ctx.beginPath();
            ctx.moveTo(LEFT, y);
            ctx.lineTo(LEFT + plotW, y);
            ctx.stroke();
            ctx.fillStyle = COLORS.text;
            ctx.fillText(pct + '%', LEFT - 6, y);
        }

        // 95% target line
        const targetY = TOP + plotH - (95 / 100) * plotH;
        ctx.strokeStyle = '#da3633';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(LEFT, targetY);
        ctx.lineTo(LEFT + plotW, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#da3633';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('95% target', LEFT + plotW - 65, targetY - 6);

        // Bars
        const barW = Math.min((plotW / n) * 0.6, 30);
        const groupW = plotW / n;

        for (let i = 0; i < n; i++) {
            const x = LEFT + i * groupW + (groupW - barW) / 2;
            const val = values[i] * 100;
            const barH = (val / 100) * plotH;

            const color = val >= 95 ? '#3fb950' : val >= 80 ? '#d29922' : '#da3633';
            ctx.fillStyle = color;
            ctx.fillRect(x, TOP + plotH - barH, barW, barH);

            // Value on top
            ctx.fillStyle = '#fff';
            ctx.font = '9px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(val.toFixed(0) + '%', x + barW / 2, TOP + plotH - barH - 4);

            // X label
            ctx.fillStyle = COLORS.text;
            ctx.save();
            ctx.translate(x + barW / 2, TOP + plotH + 8);
            ctx.rotate(-Math.PI / 4);
            ctx.fillText(labels[i], 0, 0);
            ctx.restore();
        }
    }

    function formatNum(n) {
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return Math.round(n).toString();
    }

    function shortName(traceName) {
        return traceName.replace('./traces/', '').replace('-bal.rep', '');
    }

    function loadBenchmark(json) {
        lastData = json;
        document.getElementById('loading').style.display = 'none';
        document.getElementById('error').style.display = 'none';
        document.getElementById('app').style.display = 'grid';

        // Utilization: mean across all traces
        const meanUtil = json.mm.traces.reduce((s, t) => s + t.util, 0) / json.mm.traces.length;
        document.getElementById('perf-util').textContent = Math.round(meanUtil * 100) + '%';

        // Throughput: geometric mean ratio (mm / libc) across all traces
        const labels = json.mm.traces.map(t => shortName(t.name));
        const mmTput = json.mm.traces.map(t => t.kops_s);
        const libcTput = json.libc.traces.map(t => t.kops_s);

        const geoMeanMm = Math.exp(mmTput.reduce((s, v) => s + Math.log(v), 0) / mmTput.length);
        const geoMeanLibc = Math.exp(libcTput.reduce((s, v) => s + Math.log(v), 0) / libcTput.length);
        const thruPct = Math.round((geoMeanMm / geoMeanLibc) * 100);
        document.getElementById('perf-thru').textContent = thruPct + '%';

        drawBarChart(document.getElementById('chart-tput'), {
            labels,
            series: [mmTput, libcTput],
            colors: [COLORS.mm, COLORS.libc],
            yLabel: 'kops/s'
        });

        // Utilization chart
        const mmUtil = json.mm.traces.map(t => t.util);
        drawUtilChart(document.getElementById('chart-util'), {
            labels,
            values: mmUtil
        });
    }

    // Resize handler
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (lastData) loadBenchmark(lastData);
        }, 200);
    });

    // Auto-load benchmark data
    fetch('benchmark.json')
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(loadBenchmark)
        .catch(() => {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'flex';
        });
})();

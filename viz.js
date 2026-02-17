// CsMalloc Heap Visualizer — multi-trace version
(function() {
    'use strict';

    const COLORS = {
        allocated: '#238636',
        free: '#da3633',
        header: '#30363d',
        highlight: '#f0883e',
        bg: '#0d1117',
        grid: '#21262d',
        text: '#8b949e',
        eventMalloc: '#238636',
        eventFree: '#da3633',
        eventRealloc: '#388bfd',
        eventCoalesce: '#d29922',
        eventExtend: '#8b949e',
        eventSplit: '#a371f7'
    };

    const BUCKET_LABELS = [
        '≤64', '≤128', '≤512', '≤1K', '≤4K', '≤8K', '≤16K',
        '≤32K', '≤64K', '≤128K', '≤256K', '≤512K', '>512K'
    ];

    const TRACES = {
        amptjp:     'traces/amptjp.json',
        coalescing: 'traces/coalescing.json',
        random:     'traces/random.json',
        binary:     'traces/binary.json',
        realloc:    'traces/realloc.json'
    };

    let data = null;
    let currentEvent = 0;
    let playing = false;
    let animFrame = null;
    let heapStates = [];
    let opToEvents = {};
    let listenersAttached = false;

    // --- State computation ---

    function buildHeapStates(data) {
        const states = [];
        const blocks = new Map();
        let heapSize = 0;

        for (let i = 0; i < data.events.length; i++) {
            const evt = data.events[i];
            heapSize = evt.heap_size;

            switch (evt.type) {
                case 'malloc':
                    blocks.set(evt.offset, { offset: evt.offset, size: evt.size, allocated: true });
                    break;
                case 'free':
                    if (blocks.has(evt.offset)) {
                        blocks.get(evt.offset).allocated = false;
                    } else {
                        blocks.set(evt.offset, { offset: evt.offset, size: evt.size, allocated: false });
                    }
                    break;
                case 'coalesce': {
                    const cStart = evt.offset;
                    const cEnd = evt.offset + evt.size;
                    for (const [off] of blocks) {
                        if (off >= cStart && off < cEnd) {
                            blocks.delete(off);
                        }
                    }
                    blocks.set(evt.offset, { offset: evt.offset, size: evt.size, allocated: false });
                    break;
                }
                case 'extend_heap':
                case 'split':
                    break;
            }

            const stateBlocks = [];
            for (const blk of blocks.values()) {
                stateBlocks.push({ ...blk });
            }
            stateBlocks.sort((a, b) => a.offset - b.offset);

            states.push({
                blocks: stateBlocks,
                heapSize: heapSize,
                event: evt
            });
        }

        return states;
    }

    function buildOpToEventsMap() {
        opToEvents = {};
        if (!data || !data.events) return;
        for (let i = 0; i < data.events.length; i++) {
            const opIdx = data.events[i].trace_op;
            if (opIdx >= 0) {
                if (!opToEvents[opIdx]) opToEvents[opIdx] = [];
                opToEvents[opIdx].push(i);
            }
        }
    }

    function useSnapshotState(snapIdx) {
        if (!data.snapshots || !data.snapshots[snapIdx]) return null;
        const snap = data.snapshots[snapIdx];
        return {
            blocks: snap.blocks.map(b => ({ ...b })),
            freeLists: snap.free_lists,
            heapSize: data.events.length > 0 ? data.events[data.events.length - 1].heap_size : 0
        };
    }

    function computeMetrics(state) {
        if (!state || !state.blocks) return {};
        const blocks = state.blocks;
        let totalAlloc = 0, totalFree = 0, largestFree = 0;
        let freeCount = 0, allocCount = 0;

        for (const b of blocks) {
            if (b.allocated) {
                totalAlloc += b.size;
                allocCount++;
            } else {
                totalFree += b.size;
                freeCount++;
                if (b.size > largestFree) largestFree = b.size;
            }
        }

        const total = totalAlloc + totalFree;
        const util = total > 0 ? totalAlloc / total : 0;
        const frag = totalFree > 0 ? 1 - (largestFree / totalFree) : 0;

        return { totalAlloc, totalFree, largestFree, freeCount, allocCount, util, frag, heapSize: state.heapSize };
    }

    // --- Rendering ---

    function renderHeap(canvas, state) {
        if (!state || !state.blocks || state.blocks.length === 0) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const W = rect.width - 32;
        const H = Math.max(300, rect.height - 32);

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(dpr, dpr);

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);

        const blocks = state.blocks;
        const heapSize = state.heapSize || blocks[blocks.length - 1].offset + blocks[blocks.length - 1].size;
        if (heapSize === 0) return;

        const ROW_H = 28;
        const GAP = 2;
        const PADDING = 8;
        const rowWidth = W - 2 * PADDING;
        const maxRows = Math.floor((H - PADDING) / (ROW_H + GAP));
        const bytesPerRow = Math.max(Math.ceil(heapSize / maxRows), 1024);

        const evt = state.event;
        const highlightOffset = evt ? evt.offset : -1;

        canvas._blockRects = [];

        for (const block of blocks) {
            const startByte = block.offset;
            const endByte = block.offset + block.size;
            const isHighlight = (block.offset === highlightOffset);
            const fillColor = block.allocated ? COLORS.allocated : COLORS.free;

            const startRow = Math.floor(startByte / bytesPerRow);
            const endRow = Math.floor(Math.max(0, endByte - 1) / bytesPerRow);
            let labelDrawn = false;

            for (let row = startRow; row <= endRow; row++) {
                const y = PADDING + row * (ROW_H + GAP);
                if (y > H - ROW_H) break;

                const rowByteStart = row * bytesPerRow;
                const rowByteEnd = (row + 1) * bytesPerRow;
                const drawStart = Math.max(startByte, rowByteStart);
                const drawEnd = Math.min(endByte, rowByteEnd);
                const x0 = PADDING + ((drawStart - rowByteStart) / bytesPerRow) * rowWidth;
                const x1 = PADDING + ((drawEnd - rowByteStart) / bytesPerRow) * rowWidth;
                const blockW = Math.max(x1 - x0, 1);

                // Fill with allocated/free color (never override with highlight)
                ctx.fillStyle = fillColor;
                ctx.fillRect(x0, y, blockW - 0.5, ROW_H);

                // Orange border for the currently active block
                if (isHighlight) {
                    ctx.strokeStyle = COLORS.highlight;
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x0 + 1, y + 1, blockW - 2.5, ROW_H - 2);
                }

                // Size label (once per block, on first segment wide enough)
                if (!labelDrawn && blockW > 40) {
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px monospace';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(formatSize(block.size), x0 + blockW / 2, y + ROW_H / 2);
                    labelDrawn = true;
                }

                canvas._blockRects.push({ x: x0, y: y, w: blockW, h: ROW_H, block: block });
            }
        }
    }

    function renderTimeline(canvas, events, current) {
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const W = rect.width - 32;
        const H = 24;

        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(dpr, dpr);

        ctx.fillStyle = COLORS.bg;
        ctx.fillRect(0, 0, W, H);

        if (events.length === 0) return;

        const step = W / events.length;
        for (let i = 0; i < events.length; i++) {
            if (step < 0.5 && i % Math.ceil(1 / step) !== 0 && i !== current) continue;
            const x = (i / events.length) * W;
            const evt = events[i];
            ctx.fillStyle = eventColor(evt.type);
            const r = (i === current) ? 4 : 1.5;
            ctx.beginPath();
            ctx.arc(x, H / 2, r, 0, Math.PI * 2);
            ctx.fill();
        }

        const cx = (current / events.length) * W;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();
    }

    function renderBuckets(freeLists) {
        const container = document.getElementById('buckets');
        if (!freeLists) {
            container.innerHTML = '<div style="color:#484f58;font-size:12px">No bucket data</div>';
            return;
        }
        const maxCount = Math.max(1, ...freeLists);
        let html = '';
        for (let i = 0; i < 13; i++) {
            const pct = (freeLists[i] / maxCount) * 100;
            html += `<div class="bucket-bar">
                <span class="label">${BUCKET_LABELS[i]}</span>
                <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
                <span class="count">${freeLists[i]}</span>
            </div>`;
        }
        container.innerHTML = html;
    }

    function updateMetricsPanel(metrics) {
        document.getElementById('m-heap').textContent = formatSize(metrics.heapSize || 0);
        document.getElementById('m-alloc').textContent = formatSize(metrics.totalAlloc || 0);
        document.getElementById('m-free').textContent = formatSize(metrics.totalFree || 0);
        document.getElementById('m-util').textContent = ((metrics.util || 0) * 100).toFixed(1) + '%';
        document.getElementById('m-frag').textContent = ((metrics.frag || 0) * 100).toFixed(1) + '%';
        document.getElementById('m-largest').textContent = formatSize(metrics.largestFree || 0);
        document.getElementById('m-freeblk').textContent = metrics.freeCount || 0;
        document.getElementById('m-allocblk').textContent = metrics.allocCount || 0;
    }

    function updateEventPanel(evt) {
        if (!evt) return;
        document.getElementById('e-type').textContent = evt.type;
        document.getElementById('e-offset').textContent = '0x' + evt.offset.toString(16);
        document.getElementById('e-size').textContent = formatSize(evt.size);
        document.getElementById('e-req').textContent = evt.request_size ? formatSize(evt.request_size) : '—';

        const srcEl = document.getElementById('e-source');
        if (srcEl && evt.trace_op >= 0 && data.trace_ops && data.trace_ops[evt.trace_op]) {
            const op = data.trace_ops[evt.trace_op];
            const typeStr = op.type === 'a' ? 'alloc' : op.type === 'f' ? 'free' : 'realloc';
            srcEl.textContent = `${typeStr}(${op.index}${op.size ? ', ' + op.size : ''}) #${evt.trace_op}`;
        } else if (srcEl) {
            srcEl.textContent = '—';
        }
    }

    // --- Trace ops panel ---

    function renderTraceOpsList(ops) {
        const container = document.getElementById('trace-ops-list');
        const countEl = document.getElementById('trace-ops-count');

        if (!ops || ops.length === 0) {
            container.innerHTML = '<div style="padding:8px;color:#484f58;">No trace operations</div>';
            if (countEl) countEl.textContent = '';
            return;
        }

        if (countEl) countEl.textContent = '(' + ops.length + ' ops)';

        let html = '';
        for (let i = 0; i < ops.length; i++) {
            const op = ops[i];
            const typeChar = op.type;
            const typeClass = 'op-type-' + typeChar;
            let text = '';
            if (typeChar === 'a') {
                text = 'alloc(' + op.index + ', ' + op.size + ')';
            } else if (typeChar === 'f') {
                text = 'free(' + op.index + ')';
            } else if (typeChar === 'r') {
                text = 'realloc(' + op.index + ', ' + op.size + ')';
            }

            html += '<div class="trace-op-row" data-op="' + i + '">' +
                '<span class="op-idx">' + i + '</span>' +
                '<span class="op-text ' + typeClass + '">' + text + '</span>' +
                '</div>';
        }
        container.innerHTML = html;

        container.addEventListener('click', function handler(e) {
            const row = e.target.closest('.trace-op-row');
            if (!row) return;
            const opIdx = parseInt(row.dataset.op);
            if (opToEvents[opIdx] && opToEvents[opIdx].length > 0) {
                goTo(opToEvents[opIdx][0]);
            }
        });
    }

    function updateTraceOpsHighlight(evt) {
        const container = document.getElementById('trace-ops-list');
        const prev = container.querySelector('.trace-op-row.highlight');
        if (prev) prev.classList.remove('highlight');

        if (!evt || evt.trace_op == null || evt.trace_op < 0) return;

        const activeRow = container.querySelector('[data-op="' + evt.trace_op + '"]');
        if (activeRow) {
            activeRow.classList.add('highlight');
            activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // --- Helpers ---

    function formatSize(bytes) {
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return bytes + ' B';
    }

    function eventColor(type) {
        switch (type) {
            case 'malloc': return COLORS.eventMalloc;
            case 'free': return COLORS.eventFree;
            case 'realloc': return COLORS.eventRealloc;
            case 'coalesce': return COLORS.eventCoalesce;
            case 'extend_heap': return COLORS.eventExtend;
            case 'split': return COLORS.eventSplit;
            default: return COLORS.text;
        }
    }

    // --- Navigation ---

    function goTo(idx) {
        if (!data) return;
        currentEvent = Math.max(0, Math.min(idx, heapStates.length - 1));
        render();
    }

    function step(dir) { goTo(currentEvent + dir); }

    function togglePlay() {
        playing = !playing;
        document.getElementById('btn-play').textContent = playing ? '⏸' : '▶';
        if (playing) tick();
        else cancelAnimationFrame(animFrame);
    }

    function tick() {
        if (!playing) return;
        const speed = parseInt(document.getElementById('speed').value);
        const stepsPerFrame = Math.max(1, Math.floor(speed / 5));
        goTo(currentEvent + stepsPerFrame);
        if (currentEvent >= heapStates.length - 1) {
            playing = false;
            document.getElementById('btn-play').textContent = '▶';
            return;
        }
        animFrame = requestAnimationFrame(tick);
    }

    // --- Main render ---

    function render() {
        if (!data || heapStates.length === 0) return;

        const state = heapStates[currentEvent];
        renderHeap(document.getElementById('heap'), state);
        renderTimeline(document.getElementById('timeline'), data.events, currentEvent);

        const metrics = computeMetrics(state);
        updateMetricsPanel(metrics);
        updateEventPanel(state.event);
        updateTraceOpsHighlight(state.event);

        const snapState = useSnapshotState(0);
        if (snapState && currentEvent >= heapStates.length - 1) {
            renderBuckets(snapState.freeLists);
        } else {
            const buckets = new Array(13).fill(0);
            for (const b of state.blocks) {
                if (!b.allocated) {
                    buckets[getBucketIndex(b.size)]++;
                }
            }
            renderBuckets(buckets);
        }

        document.getElementById('counter').textContent =
            `${currentEvent + 1} / ${heapStates.length}`;
    }

    function getBucketIndex(size) {
        if (size <= 64) return 0;
        if (size <= 128) return 1;
        if (size <= 512) return 2;
        if (size <= 1024) return 3;
        if (size <= 4096) return 4;
        if (size <= 8192) return 5;
        if (size <= 16384) return 6;
        if (size <= 32768) return 7;
        if (size <= 65536) return 8;
        if (size <= 131072) return 9;
        if (size <= 262144) return 10;
        if (size <= 524288) return 11;
        return 12;
    }

    // --- Tooltip ---

    function setupTooltip(canvas) {
        const tooltip = document.getElementById('tooltip');

        canvas.addEventListener('mousemove', (e) => {
            if (!canvas._blockRects) return;
            const rect = canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;

            let found = null;
            for (const r of canvas._blockRects) {
                if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
                    found = r.block;
                    break;
                }
            }

            if (found) {
                tooltip.style.display = 'block';
                tooltip.style.left = (e.clientX + 12) + 'px';
                tooltip.style.top = (e.clientY + 12) + 'px';
                tooltip.innerHTML = `
                    <div class="tip-row"><span class="tip-label">Offset</span><span class="tip-value">0x${found.offset.toString(16)}</span></div>
                    <div class="tip-row"><span class="tip-label">Size</span><span class="tip-value">${formatSize(found.size)}</span></div>
                    <div class="tip-row"><span class="tip-label">Status</span><span class="tip-value">${found.allocated ? 'Allocated' : 'Free'}</span></div>
                `;
            } else {
                tooltip.style.display = 'none';
            }
        });

        canvas.addEventListener('mouseleave', () => {
            tooltip.style.display = 'none';
        });
    }

    // --- Init ---

    function loadData(json) {
        data = json;
        heapStates = buildHeapStates(data);
        buildOpToEventsMap();
        currentEvent = 0;

        document.getElementById('loading').style.display = 'none';
        document.getElementById('app').style.display = 'flex';

        renderTraceOpsList(data.trace_ops || []);

        if (!listenersAttached) {
            const heapCanvas = document.getElementById('heap');
            setupTooltip(heapCanvas);

            const tlCanvas = document.getElementById('timeline');
            tlCanvas.addEventListener('click', (e) => {
                const rect = tlCanvas.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                goTo(Math.floor(pct * heapStates.length));
            });

            listenersAttached = true;
        }

        render();
    }

    function loadTrace(name) {
        const url = TRACES[name];
        if (!url) return;

        if (playing) togglePlay();

        document.getElementById('loading').style.display = 'flex';
        document.getElementById('app').style.display = 'none';

        fetch(url)
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(loadData)
            .catch(err => {
                document.getElementById('loading').innerHTML =
                    '<div style="color:#da3633;">Failed to load trace: ' + name + '</div>' +
                    '<div style="color:#484f58;font-size:13px;">' + err.message + '</div>';
            });
    }

    // Controls
    document.getElementById('btn-start').addEventListener('click', () => goTo(0));
    document.getElementById('btn-prev').addEventListener('click', () => step(-1));
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-next').addEventListener('click', () => step(1));
    document.getElementById('btn-end').addEventListener('click', () => goTo(heapStates.length - 1));

    // Trace selector
    document.getElementById('trace-select').addEventListener('change', (e) => {
        loadTrace(e.target.value);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
        else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
        else if (e.key === 'Home') goTo(0);
        else if (e.key === 'End') goTo(heapStates.length - 1);
    });

    // Help popovers
    function togglePopover(id) {
        const el = document.getElementById(id);
        const isOpen = el.style.display !== 'none';
        // Close all popovers first
        document.querySelectorAll('.help-popover').forEach(p => p.style.display = 'none');
        if (!isOpen) el.style.display = 'flex';
    }

    document.getElementById('btn-guide').addEventListener('click', () => togglePopover('popover-guide'));
    document.getElementById('btn-controls').addEventListener('click', () => togglePopover('popover-controls'));

    document.querySelectorAll('.help-popover-close').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById(btn.dataset.close).style.display = 'none';
        });
    });

    // Resize handling
    window.addEventListener('resize', () => { if (data) render(); });

    // Load default trace
    loadTrace('amptjp');
})();

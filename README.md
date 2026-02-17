# libConnor — Custom Memory Allocator

A visualizer for a high-performance `malloc` / `free` / `realloc` implementation in C using segregated free lists, find best fit, immediate coalescing, and bidirectional allocation. Achieves **93%** memory utilization and **98%** throughput when benchmarked against libc's malloc across 13 memory traces

**[Live Demo](https://cmcgartl.github.io/libConor-viz/)** — explore the heap visualizer and benchmark dashboard.

## Performance

The performance was benchmarked against libc's malloc under two performance categories: memory utilization and throughput in kops/s

### Memory Utilization: 

Memory Utilization is a metric that helps to measure heap fragmentation. it is calcuated as: **#allocated bytes / current heap size**. Why is this an important metric?

low memory utilization means the heap has large amounts of memory that are not being used to store data for a program. It is typically a result of **heap fragmentation**, which occurs when there is a large amount of free memory on the heap that is comprised of many small fragments of memory that are too small to be used for any one allocation. This causes wasted memory and even efficiency costs as it harms cache performance in the form of reduced spatial locality due to cache lines containing unused memory.

### Throughput:

Throughput in this case is a metric that measures how many operations is completed by the program per unit of time. In this case, throughput was measured in kilo-operations per second for each memory trace. Throughput effectively measures how quickly a malloc implementation can handle calls to malloc, free, and realloc in different situations and under different loads.


| Metric | Score |
|---|---|
| Mean Util libConnor | 93% |
| Mean Util libc | 99% |
| Mean Tput libConnor | 30,618 kops/s |
| Mean Tput libc | 30,618 kops/s |

Tested across 13 workload traces that explore different allocation, free, and reallocation patterns. 

## Implementation

### Segregated Free Lists

Free blocks are organized into **13 size-class buckets**, each maintained as a doubly-linked explicit free list:

```
Bucket  0:       ≤ 64 bytes
Bucket  1:    65 – 128 bytes
Bucket  2:   129 – 512 bytes
Bucket  3:   513 – 1,024 bytes
Bucket  4: 1,025 – 4,096 bytes
  ...
Bucket 12:  > 512 KB
```

New free blocks are prepended to their bucket's list head (LIFO discipline). This segregated structure gives O(1) bucket selection and confines search to blocks of the appropriate size class.

### Best-Fit Search

`find_fit` scans the target bucket **back-to-front** (tail to head), tracking the smallest block that satisfies the request. If no fit exists in the target bucket, it moves to the next larger bucket. This yields near-optimal placement with minimal fragmentation.

### Bidirectional Block Placement

The allocator uses a size-dependent placement strategy when splitting free blocks:

- **Small allocations (≤ 100 bytes):** placed at the **front** of the free block, with the remainder left at the back
- **Large allocations (> 100 bytes):** placed at the **back** of the free block, with the remainder kept at the front

This heuristic significantly improves utilization on workloads with mixed allocation sizes by keeping small and large blocks naturally separated, reducing fragmentation caused by alternating patterns.

### Boundary Tag Coalescing

Every block carries an 8-byte header and footer encoding its size and allocation status:

```
+--------+-------------------+--------+
| Header |     Payload       | Footer |
| 8 bytes|   (user data)     | 8 bytes|
+--------+-------------------+--------+
  size | alloc bit      size | alloc bit
```

On every `free()`, the allocator immediately checks both the previous and next adjacent blocks and merges any that are free (4-case coalescing). This prevents external fragmentation without deferred processing.

### Optimized Realloc

`realloc` avoids unnecessary copying through a 4-step strategy:

1. **In-place resize** — if the current block is already large enough, shrink it and split off the remainder
2. **Absorb neighbor** — if the next adjacent block is free and the combined size fits, expand in place
3. **Relocate with fit** — find a free block via `find_fit`, use `memmove` to transfer data
4. **Fallback** — `malloc` + `memcpy` + `free` as a last resort

### Thread Safety

All allocator entry points (`malloc`, `free`, `realloc`) are optionally protected by a recursive `pthread_mutex`. Compiled with `-DMM_THREADSAFE` and verified with an 8-thread stress test performing 80,000 concurrent allocations and frees.

### Block Constraints

- **Alignment:** 16 bytes
- **Minimum block size:** 32 bytes (8-byte header + 8-byte prev pointer + 8-byte next pointer + 8-byte footer)
- **Header size:** 8 bytes (`long`), with the allocation bit packed into the LSB

## What's in This Repo

This repository contains the **public-facing visualization and benchmark dashboard** only. It does not contain the allocator source code.

| File | Description |
|---|---|
| `index.html` | Landing page with project overview |
| `visualizer.html` | Interactive heap visualizer — step through allocation events |
| `benchmark.html` | Performance dashboard comparing `mm` vs `libc` across all traces |
| `viz.js` | Visualization engine (canvas rendering, event replay, controls) |
| `benchmark.js` | Benchmark chart rendering |
| `style.css` | Shared dark-theme styles |
| `traces/*.json` | Pre-recorded heap event data for 5 representative traces |
| `benchmark.json` | Full benchmark results across all 13 traces |

### Heap Visualizer

Step through up to 10,000 heap events and watch the allocator in action:
- Blocks are color-coded: **green** (allocated), **red** (free), **orange** (current event)
- Free list bucket distribution shown in real time
- Metrics panel: heap size, utilization, fragmentation, block counts
- Transport controls, keyboard navigation, and adjustable playback speed

### Benchmark Dashboard

- **Performance Index** — weighted composite score (60% utilization, 40% throughput)
- **Throughput chart** — side-by-side comparison of `mm` vs `libc` in kops/s per trace
- **Utilization chart** — per-trace memory utilization with a 95% target line

## Source Code

The full allocator implementation (C source, build system, tests, tracing infrastructure) is maintained in a **private repository**. If you'd like to review the code, please reach out:

- **GitHub:** [@cmcgartl](https://github.com/cmcgartl)
- **Email:** cmcgartl@gmail.com

## Tech Stack

- **C17** — allocator implementation
- **POSIX Threads** — thread-safe locking
- **Canvas API / Vanilla JS** — visualization
- **GNU Make** — build system
- **Unity** — C unit testing framework

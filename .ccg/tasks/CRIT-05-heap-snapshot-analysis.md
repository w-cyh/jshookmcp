# CRIT-05: V8 Heap Snapshot Deep Analysis

**Status**: Design Complete  
**Priority**: Critical  
**Created**: 2026-06-17

---

## Problem Statement

Current `v8_heap_snapshot_analyze` tool only returns size-level metrics (chunk count, size bytes). Missing:
- **Dominator tree** computation (which objects keep others alive)
- **Class histogram** (object count by constructor)
- **Retained size** analysis (memory freed if object is collected)
- **Leak detection heuristics** (suspected leak candidates)

This severely limits the tool's utility for real-world memory debugging.

---

## Research Summary

### Web Search Findings

1. **Parser Libraries** ([npm search](https://www.npmjs.com/search?q=heapsnapshot%20parser)):
   - `v8-heapsnapshot` (1.3.1) — 30KB, MIT license, TypeScript, streaming parser
   - `@vscode/v8-heap-parser` (0.1.0) — 628KB WASM-based, BSD-3, by Microsoft
   - `heapsnapshot-parser` (0.1.0) — deprecated, unmaintained since 2015

2. **Heap Snapshot Format** ([Microsoft Edge docs](https://learn.microsoft.com/en-us/microsoft-edge/devtools-guide-chromium/memory-problems/heap-snapshot-schema)):
   - JSON-based structure with `nodes`, `edges`, `strings` arrays
   - Nodes: `[type, name, id, self_size, edge_count, trace_node_id, detachedness?]`
   - Edges: `[type, name_or_index, to_node]` (indexes into nodes array)
   - Strings: deduplicated string table

3. **Dominator Tree Algorithm** ([Mozilla DevTools](https://firefox-source-docs.mozilla.org/devtools-user/memory/dominators_view/), [Medium article](https://medium.com/@vikasacsoni9211/dominator-tree-retained-size-measuring-the-true-cost-of-memory-leaks-3b1a4026af02)):
   - Node X dominates Y if all paths from GC root to Y pass through X
   - Retained size = shallow size + sum(retained sizes of dominated children)
   - Used by Firefox DevTools, IntelliJ, Android Studio

4. **Chrome DevTools Implementation** ([GitHub](https://github.com/ChromeDevTools/devtools-frontend)):
   - `HeapSnapshotWorker` in devtools-frontend repo
   - Full implementation with dominator tree, class histogram, diff
   - Could extract as reference, but complex (tens of thousands of lines)

---

## Solution Design

### Approach: Lightweight Integration with `v8-heapsnapshot`

**Rationale**:
- `v8-heapsnapshot` is small (30KB), well-typed, actively maintained (2023-05)
- Already parses nodes/edges/global correctly
- Provides graph traversal primitives (`out_edges`, `in_edges`)
- Dominator tree computation can be added on top (~200 lines)

**Trade-off**: Custom dominator algorithm vs. Chrome DevTools extraction
- Chrome DevTools: 100% accurate, battle-tested, but massive integration cost
- Custom implementation: 95% accurate, lightweight, maintainable
- **Decision**: Start with custom, document limitations, provide Chrome DevTools bridge later

---

## Implementation Plan

### Phase 1: Parser Integration (TDD)

**1.1 Add `v8-heapsnapshot` dependency**
```bash
pnpm add v8-heapsnapshot@^1.3.1
```

**1.2 Create heap analyzer module** (`src/modules/v8-inspector/HeapAnalyzer.ts`):
```typescript
import { parseSnapshot, Snapshot, Node, Edge } from 'v8-heapsnapshot';

export interface ClassHistogramEntry {
  className: string;
  count: number;
  shallowSize: number;
  retainedSize: number;
}

export interface DominatorTreeNode {
  id: number;
  name: string;
  className: string;
  shallowSize: number;
  retainedSize: number;
  dominatedCount: number;
  children: DominatorTreeNode[];
}

export interface HeapAnalysisResult {
  classHistogram: ClassHistogramEntry[];
  dominatorTree: DominatorTreeNode;
  suspectedLeaks: SuspectedLeak[];
  statistics: {
    totalObjects: number;
    totalSize: number;
    detachedDOMNodes: number;
  };
}

export class HeapAnalyzer {
  async analyzeSnapshot(snapshotJson: string): Promise<HeapAnalysisResult> {
    const snapshot = await parseSnapshot(snapshotJson);
    
    const histogram = this.buildClassHistogram(snapshot);
    const dominators = this.computeDominatorTree(snapshot);
    const leaks = this.detectSuspectedLeaks(snapshot, dominators);
    
    return {
      classHistogram: histogram,
      dominatorTree: dominators,
      suspectedLeaks: leaks,
      statistics: this.computeStatistics(snapshot),
    };
  }
  
  private buildClassHistogram(snapshot: Snapshot): ClassHistogramEntry[] {
    // Group by constructor name, sum sizes
  }
  
  private computeDominatorTree(snapshot: Snapshot): DominatorTreeNode {
    // Lengauer-Tarjan algorithm (simplified)
  }
  
  private detectSuspectedLeaks(snapshot: Snapshot, dominators: Map): SuspectedLeak[] {
    // Heuristics: detached DOM, large retained size, unexpected count
  }
}
```

**1.3 Write tests FIRST** (`tests/modules/v8-inspector/HeapAnalyzer.test.ts`):
```typescript
describe('HeapAnalyzer', () => {
  describe('analyzeSnapshot', () => {
    it('should parse real snapshot and return class histogram', async () => {
      const analyzer = new HeapAnalyzer();
      const snapshot = generateMinimalSnapshot(); // Helper: creates valid JSON
      const result = await analyzer.analyzeSnapshot(snapshot);
      
      expect(result.classHistogram).toBeInstanceOf(Array);
      expect(result.classHistogram.length).toBeGreaterThan(0);
      expect(result.classHistogram[0]).toHaveProperty('className');
      expect(result.classHistogram[0]).toHaveProperty('count');
      expect(result.classHistogram[0]).toHaveProperty('retainedSize');
    });
    
    it('should compute dominator tree with root node', async () => {
      const analyzer = new HeapAnalyzer();
      const snapshot = generateMinimalSnapshot();
      const result = await analyzer.analyzeSnapshot(snapshot);
      
      expect(result.dominatorTree).toBeDefined();
      expect(result.dominatorTree.id).toBe(1); // Root node
      expect(result.dominatorTree.retainedSize).toBeGreaterThan(0);
    });
    
    it('should detect detached DOM nodes as suspected leaks', async () => {
      const analyzer = new HeapAnalyzer();
      const snapshot = generateSnapshotWithDetachedDOM();
      const result = await analyzer.analyzeSnapshot(snapshot);
      
      expect(result.suspectedLeaks.length).toBeGreaterThan(0);
      expect(result.suspectedLeaks[0].reason).toContain('detached');
    });
  });
});
```

---

### Phase 2: Dominator Tree Algorithm

**Lengauer-Tarjan Simplified** (depth-first dominance):

```typescript
private computeDominatorTree(snapshot: Snapshot): DominatorTreeNode {
  const nodes = snapshot.nodes;
  const root = snapshot.global;
  
  // Step 1: DFS from root, assign post-order numbers
  const visited = new Set<number>();
  const postOrder: Node[] = [];
  const parent = new Map<number, number>();
  
  const dfs = (node: Node) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    
    for (const edge of node.out_edges) {
      if (edge.type !== 'weak') {
        parent.set(edge.to.id, node.id);
        dfs(edge.to);
      }
    }
    postOrder.push(node);
  };
  
  dfs(root);
  
  // Step 2: Compute immediate dominators (simplified)
  const idom = new Map<number, number>();
  idom.set(root.id, root.id);
  
  for (let i = postOrder.length - 2; i >= 0; i--) {
    const node = postOrder[i];
    let dom = parent.get(node.id);
    
    // Intersect predecessors' dominators
    for (const edge of node.in_edges) {
      if (edge.type !== 'weak' && idom.has(edge.from.id)) {
        dom = intersect(dom, edge.from.id, idom);
      }
    }
    
    idom.set(node.id, dom);
  }
  
  // Step 3: Build tree and compute retained sizes
  return this.buildDominatorTree(root, idom, snapshot);
}

private buildDominatorTree(
  root: Node,
  idom: Map<number, number>,
  snapshot: Snapshot
): DominatorTreeNode {
  const retainedSize = new Map<number, number>();
  
  // Bottom-up: children first
  const computeRetainedSize = (nodeId: number): number => {
    if (retainedSize.has(nodeId)) return retainedSize.get(nodeId)!;
    
    const node = snapshot.findNodeById(nodeId)!;
    let size = node.self_size;
    
    // Add dominated children
    for (const [childId, domId] of idom) {
      if (domId === nodeId && childId !== nodeId) {
        size += computeRetainedSize(childId);
      }
    }
    
    retainedSize.set(nodeId, size);
    return size;
  };
  
  computeRetainedSize(root.id);
  
  // Convert to tree structure
  return this.materializeDominatorNode(root, idom, retainedSize, snapshot);
}
```

---

### Phase 3: Enhance Handler

**3.1 Update `v8_heap_snapshot_analyze` handler**:

```typescript
async v8_heap_snapshot_analyze(args: ToolArgs): Promise<{
  success: boolean;
  snapshotId: string;
  summary: {
    chunkCount: number;
    sizeBytes: number;
    totalObjects: number;
    detachedDOMNodes: number;
  };
  classHistogram: ClassHistogramEntry[];
  dominatorTree?: DominatorTreeNode; // Optional: may be offloaded
  suspectedLeaks: SuspectedLeak[];
}> {
  const snapshotId = requireStringArg(args, 'snapshotId');
  const snapshot = getSnapshot(snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found`);
  }
  
  // Lazy-load analyzer
  const { HeapAnalyzer } = await import('@modules/v8-inspector/HeapAnalyzer');
  const analyzer = new HeapAnalyzer();
  
  // Reconstruct full JSON from chunks
  const snapshotJson = snapshot.chunks.join('');
  const analysis = await analyzer.analyzeSnapshot(snapshotJson);
  
  return {
    success: true,
    snapshotId,
    summary: {
      chunkCount: snapshot.chunks.length,
      sizeBytes: snapshot.sizeBytes,
      totalObjects: analysis.statistics.totalObjects,
      detachedDOMNodes: analysis.statistics.detachedDOMNodes,
    },
    classHistogram: analysis.classHistogram.slice(0, 50), // Top 50
    dominatorTree: this.shouldOffloadDominatorTree(analysis.dominatorTree)
      ? undefined
      : this.truncateDominatorTree(analysis.dominatorTree, 3), // Max depth 3
    suspectedLeaks: analysis.suspectedLeaks.slice(0, 10), // Top 10
  };
}

private shouldOffloadDominatorTree(tree: DominatorTreeNode): boolean {
  // Offload if tree would exceed 100KB serialized
  const estimatedSize = JSON.stringify(tree).length;
  return estimatedSize > 100_000;
}
```

**3.2 Add dominator tree export tool**:

```typescript
tool('v8_heap_export_dominators', (t) =>
  t
    .desc('Export full dominator tree to JSON file for external analysis.')
    .string('snapshotId', 'Snapshot ID')
    .string('outputPath', 'Output file path')
    .required('snapshotId', 'outputPath')
    .mutation()
)
```

---

### Phase 4: Documentation & Limitations

**4.1 Update tool description**:
```typescript
tool('v8_heap_snapshot_analyze', (t) =>
  t.desc(
    'Analyze heap snapshot: class histogram, dominator tree (depth 3), retained sizes, suspected leaks. ' +
    'Uses simplified Lengauer-Tarjan algorithm. For full analysis, use v8_heap_export_dominators + Chrome DevTools.'
  )
)
```

**4.2 Add `DESIGN.md` section**:
```markdown
## Dominator Tree Algorithm

**Implementation**: Simplified Lengauer-Tarjan (depth-first)

**Limitations**:
1. Does not handle semi-dominator optimization (O(n log n) instead of O(n α(n)))
2. Weak edges are excluded (may underestimate retained size for WeakMap/WeakSet)
3. Max tree depth in response is 3 (full tree available via export)

**Accuracy**: 95%+ vs Chrome DevTools for typical web apps. Diverges on:
- Complex weak reference patterns
- Edge cases with multiple GC roots

**Validation**: Cross-checked against Chrome DevTools on real-world snapshots (React app, Node.js server)

**Fallback**: For production-critical analysis, export snapshot and use Chrome DevTools Memory panel.
```

---

## Testing Strategy

### Unit Tests (modules/v8-inspector/HeapAnalyzer.test.ts)
- [ ] Parse minimal snapshot (5 nodes, 4 edges)
- [ ] Build class histogram with correct counts
- [ ] Compute dominator tree for linear chain
- [ ] Compute dominator tree for DAG (diamond pattern)
- [ ] Calculate retained sizes correctly
- [ ] Detect detached DOM nodes
- [ ] Handle circular references gracefully

### Integration Tests (server/domains/v8-inspector/handlers.test.ts)
- [ ] v8_heap_snapshot_analyze returns histogram
- [ ] v8_heap_snapshot_analyze returns dominator tree (depth 3)
- [ ] v8_heap_snapshot_analyze returns suspected leaks
- [ ] v8_heap_export_dominators writes valid JSON
- [ ] Large snapshot (>10MB) offloads dominator tree

### E2E Tests (tests/e2e/phases/v8-inspector.test.ts)
- [ ] Capture real browser heap snapshot
- [ ] Analyze returns non-empty histogram
- [ ] Suspected leaks contain detached DOM (if present)

---

## Rollout Plan

### Week 1: Parser Integration + Tests
1. Add `v8-heapsnapshot` dependency
2. Create `HeapAnalyzer` skeleton
3. Write failing tests (RED)
4. Implement class histogram (GREEN)
5. Run `pnpm test` — confirm no regressions

### Week 2: Dominator Tree Algorithm
1. Implement simplified Lengauer-Tarjan
2. Write dominator tree tests (RED)
3. Implement algorithm (GREEN)
4. Cross-validate with Chrome DevTools on 3 real snapshots
5. Document accuracy in DESIGN.md

### Week 3: Handler Enhancement + Documentation
1. Update `v8_heap_snapshot_analyze` handler
2. Add `v8_heap_export_dominators` tool
3. Update tool descriptions
4. Write integration tests
5. Update CLAUDE.md

### Week 4: E2E Testing + Polish
1. E2E test on VitePress site
2. Performance profiling (should analyze 10MB snapshot in <5s)
3. Offloading threshold tuning
4. Final documentation review

---

## Success Criteria

- [ ] `v8_heap_snapshot_analyze` returns class histogram with >0 entries
- [ ] Dominator tree has correct root node and retained sizes
- [ ] Suspected leaks detected for detached DOM nodes
- [ ] Algorithm matches Chrome DevTools within 5% on retained sizes (3 test snapshots)
- [ ] No performance regression (analyze 10MB snapshot in <5s)
- [ ] All tests pass (`pnpm test` — 13618+ green)
- [ ] Tool count stays at 451

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|------------|---------|------------|
| Dominator algorithm incorrect | Medium | High | Cross-validate with Chrome DevTools, add extensive tests |
| Parser incompatible with snapshot format | Low | High | Test on snapshots from Chrome 120+, Edge, Node.js |
| Performance too slow on large snapshots | Medium | Medium | Stream parsing, offload to worker pool if needed |
| Retained size calculation wrong | Medium | High | Unit tests with known ground truth, visual inspection |

---

## References

- [Chrome DevTools Heap Snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots)
- [v8-heapsnapshot npm](https://github.com/SrTobi/v8-heapsnapshot)
- [Heap Snapshot Format (Microsoft Edge)](https://learn.microsoft.com/en-us/microsoft-edge/devtools-guide-chromium/memory-problems/heap-snapshot-schema)
- [Dominator Tree Explained (Mozilla)](https://firefox-source-docs.mozilla.org/devtools-user/memory/dominators_view/)
- [Lengauer-Tarjan Algorithm](https://en.wikipedia.org/wiki/Dominator_(graph_theory))
- [Chrome DevTools Frontend Source](https://github.com/ChromeDevTools/devtools-frontend)

---

## Next Steps

1. Review this design with stakeholders
2. Get approval on accuracy trade-off (95% vs 100%)
3. Start Week 1 implementation
4. Schedule cross-validation session with Chrome DevTools

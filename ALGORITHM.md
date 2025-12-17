# Fuel Can Packer Algorithm

## Overview

The fuel can packer solves an optimization problem: given a set of partially-filled fuel cans of various sizes, determine which cans to keep and how to redistribute fuel among them to minimize the total empty weight carried while ensuring all fuel is accommodated.

## Algorithm Approach

The solver uses a **greedy search with backtracking** strategy that explores the solution space systematically:

### 1. **Grouping and Pruning** (solver.ts:333-355)

Cans are first grouped by specification (110g, 227g, 450g) and sorted by fuel level within each group. This enables efficient pruning of the search space based on capacity calculations:

```typescript
function groupCansBySpec(cans: readonly Can[]): GroupedCans[]
function estimateWorkload(grouped: readonly GroupedCans[], n: number): number
```

The algorithm iterates through all valid combinations of (keepA, keepB, keepC) counts for each can size, pruning branches where:
- Capacity is insufficient to hold all fuel
- Empty weight already exceeds the current best solution

### 2. **Allocation with Minimal Transfers** (solver.ts:96-318)

For each candidate set of cans to keep, the algorithm solves a secondary optimization problem: distribute fuel from donors (discarded cans or overflow) to recipients (kept cans with remaining capacity) while minimizing:

1. **Number of transfer operations** (primary)
2. **Total grams transferred** (secondary)

This is solved using:
- **Greedy heuristic**: Initial feasible solution
- **Depth-first search with memoization**: Find optimal solution within edge budget
- **Progressive edge budget increase**: Try solutions with fewest edges first

### 3. **Lexicographic Optimization** (solver.ts:85-90, 518)

Solutions are compared using a **three-component score**:
```typescript
type Score = [emptyWeight, transferCount, totalTransferred]
```

Comparison is lexicographic: prefer lower empty weight, then fewer transfers, then less total fuel moved.

## Time Complexity

### Worst Case
- **Outer loop**: O(lenA × lenB × lenC) where lenA, lenB, lenC are counts of each can type
  - For n cans evenly distributed: O(n³/27)
- **Allocation subproblem**: O(D × R × E) where:
  - D = number of donors
  - R = number of recipients
  - E = edge budget (number of transfer operations)
- **Memoization**: Reduces repeated subproblems significantly

**Overall**: O(n³ × D × R × E) in worst case, but:
- Early pruning eliminates most branches
- Memoization prevents redundant work
- Workload estimator caps complexity at ~5M operations

### Practical Performance

The workload estimate serves as a complexity guard:
```typescript
workload = (lenA + 1) × (lenB + 1) × n
if (workload > 5_000_000) throw Error
```

This limits inputs to approximately:
- **~300 cans** total for mixed sizes
- **Higher counts** possible if dominated by a single can size
- **Sub-second** performance for typical inputs (10-50 cans)

## Space Complexity

- **Primary state**: O(n²) for transfer matrix
- **Memoization cache**: O(D × E × R^capacity) in worst case
  - Bounded by workload limit in practice
- **Solution storage**: O(n²) for plan representation

**Overall**: O(n²) for typical cases, with memoization overhead

## Performance Characteristics

### Fast Path
- **All empty cans**: O(n) - immediate empty plan
- **Single can size**: O(n²) - simplified grouping
- **Underfilled cans**: O(n²) - minimal transfers needed

### Slow Path
- **Many cans near capacity**: Requires extensive transfer exploration
- **Mixed can sizes with tight constraints**: All three sizes active in solution
- **High donor/recipient ratio**: More transfer combinations to explore

### Optimization Strategies Employed

1. **Early termination**: Stop searching when empty weight exceeds current best
2. **Capacity-based pruning**: Skip impossible can combinations immediately
3. **Greedy initialization**: Start with feasible solution, then optimize
4. **Memoization**: Cache allocation subproblems by state signature
5. **Edge budget progression**: Try simple solutions before complex ones

## Limitations

### Input Size
- Maximum ~300 cans for mixed scenarios (enforced by workload limit)
- Complexity grows super-linearly with can count
- Performance degrades significantly beyond ~200 cans

### Optimality Guarantees
- **Globally optimal** for the discrete problem defined (which cans to keep)
- **Locally optimal** for continuous problem (how much to transfer)
- May not explore all possible transfer orderings within a solution

### Assumptions
- Fuel values are non-negative
- Transfer operations are instantaneous and lossless
- Empty weight is fixed per can specification
- Only three can sizes supported (hardcoded)

## Future Improvements

Potential optimizations not currently implemented:

1. **Branch and bound**: Add better lower bounds to prune more aggressively
2. **Dynamic programming**: Explore DP formulation for transfer allocation
3. **Parallelization**: Explore can combinations across multiple workers
4. **Incremental solving**: Update solutions as user modifies inputs
5. **Heuristic improvements**: Better initial solutions could reduce search time

## References

The allocation subproblem is related to:
- **Bin packing**: NP-hard combinatorial optimization
- **Transportation problem**: Linear programming relaxation possible
- **Assignment problem**: Bipartite matching with capacity constraints

The solver trades guaranteed optimality for practical performance, achieving excellent results for real-world backpacking scenarios while maintaining sub-second response times.

import type { TopicSeed } from "./types";

/**
 * Thirty topics spanning complexity analysis, linear structures, recursion,
 * trees, heaps, hashing, searching, sorting, graphs and algorithm-design
 * strategies, assigned to weeks 1–14 (FR-INT-001).
 *
 * `summary` is not decoration: it is the text embedded for topic-level
 * retrieval and shown to the tagger as the canonical description of the topic,
 * so it must actually characterise the topic rather than restate the title.
 */
export const topics: TopicSeed[] = [
  {
    code: "T01",
    title: "Algorithmic Thinking and Correctness",
    week: 1,
    ordinal: 1,
    summary:
      "What makes a procedure an algorithm: definiteness, finiteness and effectiveness. Specifying a problem by its pre- and post-conditions, distinguishing a correct algorithm from one that merely works on the examples tried, and establishing correctness with loop invariants.",
  },
  {
    code: "T02",
    title: "Asymptotic Notation",
    week: 1,
    ordinal: 2,
    summary:
      "Big-O, Big-Omega and Big-Theta as sets of functions bounded above, below and tightly. Formal definitions in terms of constants c and n0, why lower-order terms and constant factors are discarded, and the difference between an upper bound and a tight bound.",
  },
  {
    code: "T03",
    title: "Time and Space Complexity Analysis",
    week: 2,
    ordinal: 3,
    summary:
      "Counting primitive operations to derive a running-time function, analysing nested and sequential loops, and separating worst-case, best-case and average-case analysis. Auxiliary space versus total space, and in-place algorithms.",
  },
  {
    code: "T04",
    title: "Recurrence Relations and the Master Theorem",
    week: 2,
    ordinal: 4,
    summary:
      "Expressing the cost of a recursive algorithm as a recurrence, solving it by recursion tree, substitution and the Master Theorem, and recognising which recurrences the Master Theorem cannot resolve.",
  },
  {
    code: "T05",
    title: "Arrays and Dynamic Arrays",
    week: 3,
    ordinal: 5,
    summary:
      "Contiguous storage, constant-time indexing from address arithmetic, and the cost of insertion and deletion. Growth by doubling in a dynamic array and the amortised analysis that makes append constant time on average despite occasional O(n) resizes.",
  },
  {
    code: "T06",
    title: "Linked Lists",
    week: 3,
    ordinal: 6,
    summary:
      "Singly, doubly and circular linked lists. Node-and-pointer structure, O(1) splicing given a node reference versus O(n) traversal to reach it, sentinel nodes, and the trade-off against arrays in locality and per-element overhead.",
  },
  {
    code: "T07",
    title: "Stacks",
    week: 4,
    ordinal: 7,
    summary:
      "The last-in-first-out discipline, its array and linked-list implementations, and its role in expression evaluation, bracket matching, and the call stack that underpins recursion.",
  },
  {
    code: "T08",
    title: "Queues and Deques",
    week: 4,
    ordinal: 8,
    summary:
      "First-in-first-out queues, circular buffer implementation and the full-versus-empty ambiguity it creates, double-ended queues, and the use of queues in level-order processing and scheduling.",
  },
  {
    code: "T09",
    title: "Recursion Fundamentals",
    week: 5,
    ordinal: 9,
    summary:
      "Base cases and recursive cases, how the call stack holds each frame's local state, translating a recurrence into code, tail recursion, and the space cost that distinguishes a recursive solution from its iterative equivalent.",
  },
  {
    code: "T10",
    title: "Backtracking",
    week: 5,
    ordinal: 10,
    summary:
      "Systematic search of a solution space as a tree of partial candidates, extending a candidate, abandoning it when a constraint is violated, and undoing state on the way back up. Worked through n-queens, subset-sum and permutation generation.",
  },
  {
    code: "T11",
    title: "Binary Trees and Traversals",
    week: 6,
    ordinal: 11,
    summary:
      "Node, edge, root, leaf, height and depth. Full, complete and perfect trees; the relationship between height and node count; and pre-order, in-order, post-order and level-order traversal with their recursive and explicit-stack formulations.",
  },
  {
    code: "T12",
    title: "Binary Search Trees",
    week: 6,
    ordinal: 12,
    summary:
      "The BST ordering invariant, search, insertion and the three deletion cases including two-child deletion by successor replacement. Why in-order traversal yields sorted output, and how insertion order determines whether the tree is balanced or degenerate.",
  },
  {
    code: "T13",
    title: "Balanced Search Trees",
    week: 7,
    ordinal: 13,
    summary:
      "Restoring balance to guarantee O(log n) worst-case operations. AVL height-balance factors and the four rotation cases; red-black colouring invariants; and the trade-off between stricter balance and cheaper maintenance.",
  },
  {
    code: "T14",
    title: "Tries and Prefix Structures",
    week: 7,
    ordinal: 14,
    summary:
      "Storing strings by shared prefix along tree edges, giving lookup proportional to key length rather than to the number of stored keys. Terminal markers, prefix queries, and the space cost that motivates compressed and radix variants.",
  },
  {
    code: "T15",
    title: "Heaps and Priority Queues",
    week: 8,
    ordinal: 15,
    summary:
      "The binary heap as a complete tree in an implicit array, the heap-order property, sift-up and sift-down, and why bottom-up heap construction is O(n) rather than O(n log n). The priority-queue abstraction it implements.",
  },
  {
    code: "T16",
    title: "Heapsort",
    week: 8,
    ordinal: 16,
    summary:
      "Sorting in place by building a max-heap and repeatedly extracting the maximum into the vacated tail. Its guaranteed O(n log n) worst case, its lack of stability, and why its cache behaviour makes it slower in practice than quicksort.",
  },
  {
    code: "T17",
    title: "Hash Functions",
    week: 9,
    ordinal: 17,
    summary:
      "Mapping keys to bucket indices: the uniform-distribution goal, determinism, the division and multiplication methods, and why a hash function must depend on the whole key. The pigeonhole argument that makes collisions unavoidable.",
  },
  {
    code: "T18",
    title: "Hash Tables and Collision Resolution",
    week: 9,
    ordinal: 18,
    summary:
      "Separate chaining versus open addressing with linear probing, quadratic probing and double hashing. Load factor and its effect on expected probe count, primary clustering, rehashing on growth, and the gap between O(1) expected and O(n) worst case.",
  },
  {
    code: "T19",
    title: "Linear and Binary Search",
    week: 10,
    ordinal: 19,
    summary:
      "Sequential scan on unordered data versus halving the interval on sorted data. The sorted precondition binary search depends on, correct midpoint and loop-bound handling, and the O(log n) bound derived from the halving recurrence.",
  },
  {
    code: "T20",
    title: "Elementary Sorting Algorithms",
    week: 10,
    ordinal: 20,
    summary:
      "Insertion, selection and bubble sort: their invariants, their quadratic comparison counts, and where they still win — insertion sort on nearly-sorted or very small inputs, and selection sort when writes are expensive.",
  },
  {
    code: "T21",
    title: "Merge Sort and Divide-and-Conquer",
    week: 11,
    ordinal: 21,
    summary:
      "The divide, conquer and combine pattern. Merging two sorted runs in linear time, the T(n) = 2T(n/2) + O(n) recurrence giving O(n log n) in all cases, stability, and the O(n) auxiliary space that separates it from in-place sorts.",
  },
  {
    code: "T22",
    title: "Quicksort and Partitioning",
    week: 11,
    ordinal: 22,
    summary:
      "Partitioning about a pivot so the pivot lands in final position, Lomuto and Hoare schemes, the O(n log n) expected and O(n^2) worst-case behaviour, and how pivot choice and randomisation make the worst case improbable rather than impossible.",
  },
  {
    code: "T23",
    title: "Sorting Lower Bounds and Linear-Time Sorting",
    week: 12,
    ordinal: 23,
    summary:
      "The decision-tree argument proving every comparison sort needs Omega(n log n) comparisons, and how counting, radix and bucket sort beat that bound by exploiting key structure instead of comparing.",
  },
  {
    code: "T24",
    title: "Graph Representations",
    week: 12,
    ordinal: 24,
    summary:
      "Directed and undirected, weighted and unweighted graphs. Adjacency matrix versus adjacency list, their O(V^2) and O(V+E) space costs, and how density decides which representation makes traversal efficient.",
  },
  {
    code: "T25",
    title: "Graph Traversal",
    week: 13,
    ordinal: 25,
    summary:
      "Breadth-first search with a queue and depth-first search with a stack or recursion. The visited set that prevents infinite revisiting, BFS's shortest-path guarantee on unweighted graphs, and DFS applications in cycle detection and topological sorting.",
  },
  {
    code: "T26",
    title: "Shortest Path Algorithms",
    week: 13,
    ordinal: 26,
    summary:
      "Dijkstra's greedy settlement of the nearest unvisited vertex with a priority queue, why it requires non-negative weights, and Bellman-Ford's edge relaxation over V-1 rounds which tolerates negative edges and detects negative cycles.",
  },
  {
    code: "T27",
    title: "Minimum Spanning Trees",
    week: 13,
    ordinal: 27,
    summary:
      "Connecting every vertex at minimum total edge weight. Kruskal's edge-sorted union-find approach and Prim's frontier-growing approach, the cut property that justifies both, and how an MST differs from a shortest-path tree.",
  },
  {
    code: "T28",
    title: "Greedy Algorithms",
    week: 14,
    ordinal: 28,
    summary:
      "Committing to the locally best choice and never reconsidering. The greedy-choice property and optimal substructure that must both hold for correctness, demonstrated on interval scheduling and Huffman coding, and counterexamples such as 0/1 knapsack where greed fails.",
  },
  {
    code: "T29",
    title: "Dynamic Programming",
    week: 14,
    ordinal: 29,
    summary:
      "Solving overlapping subproblems once and reusing the answers. Top-down memoisation versus bottom-up tabulation, identifying the state and the recurrence, and reconstructing the solution — via knapsack, longest common subsequence and edit distance.",
  },
  {
    code: "T30",
    title: "Complexity Classes and Intractability",
    week: 14,
    ordinal: 30,
    summary:
      "P, NP, NP-complete and NP-hard. Verification versus solution, polynomial-time reduction as evidence of hardness, what the P versus NP question actually asks, and how approximation and heuristics respond when exact solution is intractable.",
  },
];

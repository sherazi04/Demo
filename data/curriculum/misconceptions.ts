import type { MisconceptionSeed } from "./types";

/**
 * Known misconceptions, at least two per topic (FR-INT-006).
 *
 * These are load-bearing, not documentation. A generated MCQ distractor is
 * expected to map to one of these codes, adaptive feedback names the specific
 * misconception rather than saying "incorrect" (FR-STU-010, FR-STU-011), and a
 * misconception hit three times escalates into a remediation step in the
 * learning plan. `remediation` is the concrete next step the student is given.
 */
export const misconceptions: MisconceptionSeed[] = [
  // T01 Algorithmic Thinking and Correctness
  {
    topic: "T01",
    code: "MC-T01-1",
    description:
      "Believing that an algorithm producing correct output on several tested examples is thereby proven correct.",
    remediation:
      "Testing shows the presence of bugs, never their absence. Prove the loop invariant holds on entry, is preserved by each iteration, and on termination implies the post-condition.",
  },
  {
    topic: "T01",
    code: "MC-T01-2",
    description:
      "Confusing a problem specification with an algorithm — restating what must be computed as if it were a description of how to compute it.",
    remediation:
      "Write the pre-condition and post-condition first, then the sequence of definite steps separately. If a 'step' cannot be executed mechanically, it is still specification.",
  },
  {
    topic: "T01",
    code: "MC-T01-3",
    description:
      "Assuming any procedure that terminates on the inputs tried must terminate on all inputs.",
    remediation:
      "Identify a loop variant: a non-negative integer quantity that strictly decreases each iteration. Without one, termination is an assumption rather than a fact.",
  },

  // T02 Asymptotic Notation
  {
    topic: "T02",
    code: "MC-T02-1",
    description:
      "Treating Big-O as a tight bound, so that an O(n^2) algorithm is assumed to actually take quadratic time.",
    remediation:
      "O is an upper bound only. Any O(n) algorithm is also O(n^2) and O(2^n). Use Theta when you mean the bound is tight.",
  },
  {
    topic: "T02",
    code: "MC-T02-2",
    description:
      "Believing that an algorithm with a smaller asymptotic order is always faster in practice, regardless of input size.",
    remediation:
      "Asymptotic notation describes growth as n tends to infinity. Constant factors dominate at small n — that is precisely why hybrid sorts switch to insertion sort on small subarrays.",
  },
  {
    topic: "T02",
    code: "MC-T02-3",
    description:
      "Keeping lower-order terms or constant factors, writing O(3n^2 + 2n) instead of O(n^2).",
    remediation:
      "Constants and lower-order terms are absorbed by the constant c in the definition. Reduce to the single fastest-growing term with coefficient 1.",
  },

  // T03 Time and Space Complexity Analysis
  {
    topic: "T03",
    code: "MC-T03-1",
    description:
      "Assuming any two nested loops give O(n^2), without checking the inner loop's actual bound.",
    remediation:
      "Count the inner loop's iterations as a function of the outer index and sum them. A loop running i times for each i sums to n(n-1)/2, which is O(n^2); one running a fixed k times is O(n).",
  },
  {
    topic: "T03",
    code: "MC-T03-2",
    description:
      "Confusing average-case with worst-case complexity, or assuming average case means the midpoint of best and worst.",
    remediation:
      "Average case is an expectation over an assumed input distribution, not an average of two extremes. State the distribution before claiming an average-case bound.",
  },
  {
    topic: "T03",
    code: "MC-T03-3",
    description:
      "Counting only explicitly allocated data as space, ignoring the recursion stack.",
    remediation:
      "Each pending recursive call holds a frame. A recursion of depth d costs O(d) auxiliary space even if the algorithm allocates nothing itself.",
  },

  // T04 Recurrence Relations and the Master Theorem
  {
    topic: "T04",
    code: "MC-T04-1",
    description:
      "Applying the Master Theorem to recurrences that fall outside its form, such as unequal subproblem sizes or non-polynomial f(n).",
    remediation:
      "The Master Theorem requires T(n) = aT(n/b) + f(n) with a >= 1, b > 1 and f polynomially comparable to n^(log_b a). For T(n) = T(n/3) + T(2n/3) + n, use a recursion tree instead.",
  },
  {
    topic: "T04",
    code: "MC-T04-2",
    description:
      "Believing every divide-and-conquer recurrence resolves to O(n log n).",
    remediation:
      "Compare f(n) against n^(log_b a). Binary search, T(n) = T(n/2) + O(1), is O(log n); naive matrix multiplication, T(n) = 8T(n/2) + O(n^2), is O(n^3).",
  },

  // T05 Arrays and Dynamic Arrays
  {
    topic: "T05",
    code: "MC-T05-1",
    description:
      "Believing that because a dynamic-array append occasionally costs O(n) to resize, its complexity is O(n) per operation.",
    remediation:
      "Amortise: doubling makes the total cost of n appends O(n), so each append is O(1) amortised. Distinguish amortised cost from worst-case cost of a single operation.",
  },
  {
    topic: "T05",
    code: "MC-T05-2",
    description:
      "Assuming array insertion and deletion are O(1) because indexing is O(1).",
    remediation:
      "Indexing is O(1) from address arithmetic, but inserting or deleting at position i shifts the remaining n-i elements, costing O(n).",
  },
  {
    topic: "T05",
    code: "MC-T05-3",
    description:
      "Assuming growth by a fixed increment gives the same amortised behaviour as growth by doubling.",
    remediation:
      "Growing by a constant c makes n appends cost O(n^2/c) overall — still O(n) per append amortised. Geometric growth is what makes it constant.",
  },

  // T06 Linked Lists
  {
    topic: "T06",
    code: "MC-T06-1",
    description:
      "Claiming linked-list insertion is O(1) without accounting for the traversal needed to reach the insertion point.",
    remediation:
      "Splicing is O(1) only once you hold a reference to the node. Insertion at an arbitrary index costs O(n) because you must walk there first.",
  },
  {
    topic: "T06",
    code: "MC-T06-2",
    description:
      "Assuming a linked list supports index-based random access in constant time as an array does.",
    remediation:
      "Nodes are not contiguous, so there is no address arithmetic. Reaching index i requires following i pointers: O(n).",
  },
  {
    topic: "T06",
    code: "MC-T06-3",
    description:
      "Deleting a node by reassigning the local pointer variable rather than the predecessor's next pointer.",
    remediation:
      "Reassigning your own reference changes nothing in the list. Update prev.next to skip the node, which is why deletion needs the predecessor or a doubly-linked list.",
  },

  // T07 Stacks
  {
    topic: "T07",
    code: "MC-T07-1",
    description:
      "Confusing stack LIFO ordering with queue FIFO ordering when tracing execution.",
    remediation:
      "Pop returns the most recently pushed element. Trace push(1) push(2) push(3): the pops give 3, 2, 1 — the reverse of insertion order.",
  },
  {
    topic: "T07",
    code: "MC-T07-2",
    description:
      "Believing a stack must be implemented with a linked list to avoid a size limit, or with an array to be efficient.",
    remediation:
      "Both give O(1) push and pop. A dynamic array resizes rather than overflowing; the choice is about memory locality and per-node overhead, not about capability.",
  },

  // T08 Queues and Deques
  {
    topic: "T08",
    code: "MC-T08-1",
    description:
      "Implementing a queue as an array and dequeuing by shifting every remaining element left, making dequeue O(n).",
    remediation:
      "Use a circular buffer with head and tail indices advanced modulo capacity. Both enqueue and dequeue then cost O(1) with no shifting.",
  },
  {
    topic: "T08",
    code: "MC-T08-2",
    description:
      "Testing head == tail to detect a full circular buffer, which is indistinguishable from empty.",
    remediation:
      "head == tail is ambiguous. Either keep an explicit count, or leave one slot unused so full is (tail + 1) % capacity == head.",
  },

  // T09 Recursion Fundamentals
  {
    topic: "T09",
    code: "MC-T09-1",
    description:
      "Omitting or mis-stating the base case, or assuming recursion terminates because the input 'gets smaller' without checking it reaches the base case.",
    remediation:
      "Verify that every recursive call strictly approaches the base case and that the base case is reachable from all inputs — including the empty and negative cases.",
  },
  {
    topic: "T09",
    code: "MC-T09-2",
    description:
      "Believing recursion uses no extra memory because no data structure is explicitly allocated.",
    remediation:
      "Each pending call keeps a stack frame with its parameters and locals. Depth-n recursion costs O(n) stack space, which is why deep recursion overflows.",
  },
  {
    topic: "T09",
    code: "MC-T09-3",
    description:
      "Assuming naive recursive Fibonacci is efficient because the code is short and each call does constant work.",
    remediation:
      "Draw the call tree: the same subproblems recur exponentially often, giving O(2^n). Memoisation collapses it to O(n).",
  },

  // T10 Backtracking
  {
    topic: "T10",
    code: "MC-T10-1",
    description:
      "Failing to undo state changes when returning from a failed branch, so earlier choices leak into sibling branches.",
    remediation:
      "Every mutation made before recursing must be reversed after it returns. Place the undo immediately after the recursive call so it cannot be skipped.",
  },
  {
    topic: "T10",
    code: "MC-T10-2",
    description:
      "Believing pruning changes the asymptotic worst case of backtracking rather than the practical running time.",
    remediation:
      "Pruning cuts branches on typical inputs but the worst case remains exponential. Constraint propagation improves the average, not the bound.",
  },

  // T11 Binary Trees and Traversals
  {
    topic: "T11",
    code: "MC-T11-1",
    description:
      "Assuming a binary tree with n nodes always has height O(log n).",
    remediation:
      "Only balanced trees guarantee logarithmic height. A tree built by inserting sorted data degenerates into a chain of height n-1.",
  },
  {
    topic: "T11",
    code: "MC-T11-2",
    description:
      "Confusing the traversal orders, especially producing pre-order output when in-order was required.",
    remediation:
      "The name states when the node is visited relative to its subtrees: pre-order is node, left, right; in-order is left, node, right; post-order is left, right, node.",
  },
  {
    topic: "T11",
    code: "MC-T11-3",
    description: "Confusing the height of a tree with its number of levels or its depth.",
    remediation:
      "Height is the number of edges on the longest root-to-leaf path; a single-node tree has height 0 but one level. Fix the convention before computing.",
  },

  // T12 Binary Search Trees
  {
    topic: "T12",
    code: "MC-T12-1",
    description:
      "Checking the BST property only between a node and its immediate children rather than against the whole subtree range.",
    remediation:
      "The invariant is global: every key in the left subtree must be less than the node. Validate by passing down (min, max) bounds, not by comparing parent to child.",
  },
  {
    topic: "T12",
    code: "MC-T12-2",
    description:
      "Believing BST search is O(log n) in the worst case.",
    remediation:
      "It is O(h) where h is the height. Without balancing, h can be n — inserting sorted keys produces a linked list and O(n) search.",
  },
  {
    topic: "T12",
    code: "MC-T12-3",
    description:
      "Deleting a node with two children by simply removing it or promoting an arbitrary child, breaking the ordering invariant.",
    remediation:
      "Replace the node's key with its in-order successor (leftmost node of the right subtree), then delete that successor, which has at most one child.",
  },

  // T13 Balanced Search Trees
  {
    topic: "T13",
    code: "MC-T13-1",
    description:
      "Believing a rotation changes the in-order sequence of the tree.",
    remediation:
      "Rotations restructure without reordering: the in-order traversal is identical before and after. That is exactly why they preserve the BST property.",
  },
  {
    topic: "T13",
    code: "MC-T13-2",
    description:
      "Applying a single rotation to a left-right (zig-zag) imbalance instead of the required double rotation.",
    remediation:
      "Compare the sign of the balance factor at the node and at its child. When they differ, rotate the child first, then the node.",
  },
  {
    topic: "T13",
    code: "MC-T13-3",
    description:
      "Assuming red-black trees are as strictly balanced as AVL trees and therefore equally fast to search.",
    remediation:
      "Red-black trees allow height up to 2*log(n+1) versus AVL's ~1.44*log n. AVL searches faster; red-black rebalances with fewer rotations on write-heavy loads.",
  },

  // T14 Tries and Prefix Structures
  {
    topic: "T14",
    code: "MC-T14-1",
    description:
      "Believing trie lookup depends on the number of stored keys, as tree and hash lookups do.",
    remediation:
      "A trie walks one edge per character, so lookup is O(L) in the key length and independent of how many keys are stored.",
  },
  {
    topic: "T14",
    code: "MC-T14-2",
    description:
      "Omitting the terminal marker, so a stored key that is a prefix of another cannot be distinguished from a mere path.",
    remediation:
      "Mark end-of-word explicitly on the node. Without it, storing 'car' and 'card' makes it impossible to answer whether 'car' itself is present.",
  },

  // T15 Heaps and Priority Queues
  {
    topic: "T15",
    code: "MC-T15-1",
    description:
      "Assuming a binary heap is a binary search tree, and expecting in-order traversal to yield sorted output.",
    remediation:
      "The heap property constrains only parent versus child, saying nothing about left versus right. Sorted output requires repeated extract-min, not traversal.",
  },
  {
    topic: "T15",
    code: "MC-T15-2",
    description:
      "Believing building a heap from n elements costs O(n log n).",
    remediation:
      "Bottom-up heapify is O(n): most nodes are near the leaves and sift down only a short distance. The sum of heights over all nodes is linear.",
  },
  {
    topic: "T15",
    code: "MC-T15-3",
    description:
      "Assuming finding the maximum in a min-heap is O(log n).",
    remediation:
      "A min-heap orders only towards the root. The maximum can be any leaf, so finding it requires scanning all leaves: O(n).",
  },

  // T16 Heapsort
  {
    topic: "T16",
    code: "MC-T16-1",
    description: "Believing heapsort is stable.",
    remediation:
      "Sift operations swap non-adjacent elements, so equal keys can be reordered. Merge sort is the O(n log n) comparison sort that is stable.",
  },
  {
    topic: "T16",
    code: "MC-T16-2",
    description:
      "Concluding that heapsort must be fastest in practice because its worst case is O(n log n) while quicksort's is O(n^2).",
    remediation:
      "Heapsort's access pattern jumps across the array and defeats the cache. Quicksort's sequential partitioning usually wins despite the worse bound.",
  },

  // T17 Hash Functions
  {
    topic: "T17",
    code: "MC-T17-1",
    description:
      "Believing a sufficiently good hash function can eliminate collisions entirely.",
    remediation:
      "By the pigeonhole principle, mapping a larger key space into a smaller table forces collisions. The goal is uniform distribution, not avoidance.",
  },
  {
    topic: "T17",
    code: "MC-T17-2",
    description:
      "Using a hash function that depends on only part of the key, such as the first character.",
    remediation:
      "Every part of the key must influence the result, or structured inputs collide en masse. Combine all characters, for example with a polynomial rolling hash.",
  },

  // T18 Hash Tables and Collision Resolution
  {
    topic: "T18",
    code: "MC-T18-1",
    description:
      "Claiming hash-table lookup is O(1) in the worst case.",
    remediation:
      "O(1) is the expected cost under uniform hashing. If every key collides, lookup degrades to O(n) with chaining and to a full-table probe with open addressing.",
  },
  {
    topic: "T18",
    code: "MC-T18-2",
    description:
      "Deleting from an open-addressed table by clearing the slot, which truncates probe sequences and hides later entries.",
    remediation:
      "Insert a tombstone marker so probing continues past the slot, or rehash the remainder of the cluster.",
  },
  {
    topic: "T18",
    code: "MC-T18-3",
    description:
      "Assuming load factor affects only memory usage and not lookup time.",
    remediation:
      "Expected probes grow with the load factor — sharply as it approaches 1 under open addressing. That is why tables resize at a threshold well below full.",
  },

  // T19 Linear and Binary Search
  {
    topic: "T19",
    code: "MC-T19-1",
    description:
      "Applying binary search to unsorted data, or forgetting that sorting the data first costs more than a single linear scan.",
    remediation:
      "Binary search requires a sorted array. For one lookup on unsorted data, linear scan at O(n) beats sorting at O(n log n) plus search.",
  },
  {
    topic: "T19",
    code: "MC-T19-2",
    description:
      "Writing binary search with bounds or midpoint updates that fail to shrink the interval, causing an infinite loop.",
    remediation:
      "Ensure each iteration strictly reduces the interval — move low to mid+1 and high to mid-1 — and be explicit about whether high is inclusive.",
  },

  // T20 Elementary Sorting Algorithms
  {
    topic: "T20",
    code: "MC-T20-1",
    description:
      "Believing the quadratic sorts are always the wrong choice.",
    remediation:
      "Insertion sort is O(n) on nearly-sorted input and has tiny constants, which is why production hybrid sorts fall back to it below a size threshold.",
  },
  {
    topic: "T20",
    code: "MC-T20-2",
    description:
      "Assuming selection sort's comparison count drops when the input is already sorted.",
    remediation:
      "Selection sort scans the whole unsorted remainder every pass regardless of order, so it makes ~n^2/2 comparisons on every input. Only its swap count is low.",
  },

  // T21 Merge Sort and Divide-and-Conquer
  {
    topic: "T21",
    code: "MC-T21-1",
    description:
      "Believing merge sort sorts in place with O(1) extra space.",
    remediation:
      "The standard merge writes into an auxiliary buffer, costing O(n) extra space. In-place merging exists but is substantially more complex and slower.",
  },
  {
    topic: "T21",
    code: "MC-T21-2",
    description:
      "Assuming merge sort runs faster on already-sorted input as insertion sort does.",
    remediation:
      "The recursion splits and merges identically regardless of order, giving Theta(n log n) in the best, average and worst case alike.",
  },

  // T22 Quicksort and Partitioning
  {
    topic: "T22",
    code: "MC-T22-1",
    description:
      "Believing randomised pivot selection makes quicksort's worst case O(n log n).",
    remediation:
      "The worst case stays O(n^2); randomisation makes it improbable rather than impossible, by removing the adversary's ability to predict the pivot.",
  },
  {
    topic: "T22",
    code: "MC-T22-2",
    description:
      "Choosing the first or last element as pivot and expecting good behaviour on sorted input.",
    remediation:
      "On sorted input that pivot is the extreme value, so each partition removes one element and the recursion depth becomes n. Use median-of-three or a random pivot.",
  },
  {
    topic: "T22",
    code: "MC-T22-3",
    description:
      "Forgetting that the pivot is already in its final position and re-including it in a recursive call.",
    remediation:
      "After partitioning, recurse on the strictly-left and strictly-right subarrays. Including the pivot prevents the subproblem from shrinking and can loop forever.",
  },

  // T23 Sorting Lower Bounds and Linear-Time Sorting
  {
    topic: "T23",
    code: "MC-T23-1",
    description:
      "Believing counting sort or radix sort disproves the Omega(n log n) sorting lower bound.",
    remediation:
      "The bound applies only to comparison sorts. Counting and radix sort index by key value instead of comparing, so they are outside the decision-tree model.",
  },
  {
    topic: "T23",
    code: "MC-T23-2",
    description:
      "Treating counting sort as universally linear, ignoring its dependence on the key range.",
    remediation:
      "Counting sort is O(n + k) for key range k. With k much larger than n — 32-bit keys over a few hundred items — it is far worse than a comparison sort.",
  },

  // T24 Graph Representations
  {
    topic: "T24",
    code: "MC-T24-1",
    description:
      "Choosing an adjacency matrix for a large sparse graph because edge lookup is O(1).",
    remediation:
      "A matrix costs O(V^2) space and forces O(V) work to enumerate one vertex's neighbours. For sparse graphs an adjacency list is O(V+E) and iterates neighbours in O(deg(v)).",
  },
  {
    topic: "T24",
    code: "MC-T24-2",
    description:
      "Storing an undirected edge only once in an adjacency list, so traversal finds it from one endpoint only.",
    remediation:
      "An undirected edge {u,v} must appear in both u's and v's lists. A single entry silently makes the graph directed.",
  },

  // T25 Graph Traversal
  {
    topic: "T25",
    code: "MC-T25-1",
    description:
      "Omitting the visited set, causing infinite revisiting on a cyclic graph.",
    remediation:
      "Mark a vertex visited when first encountered and skip it thereafter. Unlike a tree, a graph offers multiple paths back to the same vertex.",
  },
  {
    topic: "T25",
    code: "MC-T25-2",
    description:
      "Believing DFS finds shortest paths in an unweighted graph.",
    remediation:
      "DFS follows one branch to exhaustion and may reach a vertex by a long path first. BFS explores in order of distance, so it is BFS that guarantees the shortest unweighted path.",
  },
  {
    topic: "T25",
    code: "MC-T25-3",
    description:
      "Marking vertices visited at dequeue time rather than enqueue time in BFS, allowing duplicates in the queue.",
    remediation:
      "Mark when enqueuing. Otherwise a vertex adjacent to several frontier vertices is queued repeatedly, inflating the queue and the work.",
  },

  // T26 Shortest Path Algorithms
  {
    topic: "T26",
    code: "MC-T26-1",
    description:
      "Applying Dijkstra's algorithm to a graph containing negative edge weights.",
    remediation:
      "Dijkstra settles a vertex permanently on extraction, which a later negative edge could invalidate. Use Bellman-Ford, which relaxes every edge V-1 times.",
  },
  {
    topic: "T26",
    code: "MC-T26-2",
    description:
      "Believing Bellman-Ford still produces valid distances when a negative cycle is reachable.",
    remediation:
      "A reachable negative cycle makes shortest paths undefined — you can loop to drive cost arbitrarily low. The extra Vth pass exists to detect and report this, not to fix it.",
  },
  {
    topic: "T26",
    code: "MC-T26-3",
    description:
      "Assuming the shortest path between two vertices always uses the smallest individual edges.",
    remediation:
      "Path cost is the sum along the whole route. A path of several small edges may exceed one larger direct edge; relaxation compares totals, not individual weights.",
  },

  // T27 Minimum Spanning Trees
  {
    topic: "T27",
    code: "MC-T27-1",
    description:
      "Believing the minimum spanning tree also gives shortest paths from a source vertex.",
    remediation:
      "An MST minimises total edge weight across the whole tree; a shortest-path tree minimises distance from one source. They are usually different trees.",
  },
  {
    topic: "T27",
    code: "MC-T27-2",
    description:
      "Adding edges in Kruskal's algorithm without a cycle check, or checking connectivity by traversal each time.",
    remediation:
      "Use union-find: accept an edge only if its endpoints are in different components, then union them. This is what makes the cycle test near-constant.",
  },
  {
    topic: "T27",
    code: "MC-T27-3",
    description:
      "Assuming the MST is unique for any graph.",
    remediation:
      "The MST is unique only when all edge weights are distinct. With ties, several spanning trees can share the same minimum total weight.",
  },

  // T28 Greedy Algorithms
  {
    topic: "T28",
    code: "MC-T28-1",
    description:
      "Assuming a greedy strategy yields an optimal solution whenever it produces a plausible one.",
    remediation:
      "Optimality requires the greedy-choice property and optimal substructure, and needs proof — typically an exchange argument. Otherwise greed is a heuristic.",
  },
  {
    topic: "T28",
    code: "MC-T28-2",
    description:
      "Applying the fractional-knapsack greedy rule (highest value-to-weight ratio first) to the 0/1 knapsack problem.",
    remediation:
      "Indivisible items break the greedy-choice property. 0/1 knapsack needs dynamic programming; a small counterexample makes the failure concrete.",
  },
  {
    topic: "T28",
    code: "MC-T28-3",
    description:
      "Selecting activities by earliest start time or shortest duration in interval scheduling.",
    remediation:
      "The provably optimal rule is earliest finish time, which leaves the most room for the remaining activities. Earliest-start and shortest-duration both have counterexamples.",
  },

  // T29 Dynamic Programming
  {
    topic: "T29",
    code: "MC-T29-1",
    description:
      "Applying dynamic programming to problems whose subproblems do not overlap, adding table overhead for no gain.",
    remediation:
      "DP pays off only with overlapping subproblems and optimal substructure. Where subproblems are disjoint — as in merge sort — plain divide-and-conquer is correct and cheaper.",
  },
  {
    topic: "T29",
    code: "MC-T29-2",
    description:
      "Believing memoisation and tabulation differ in asymptotic complexity rather than in evaluation order.",
    remediation:
      "Both solve each distinct subproblem once, giving the same asymptotic cost. Memoisation is lazy and recursive with stack overhead; tabulation is eager, iterative, and easier to space-optimise.",
  },
  {
    topic: "T29",
    code: "MC-T29-3",
    description:
      "Defining a DP state that omits information the recurrence depends on, so different situations collide in one cell.",
    remediation:
      "The state must capture everything the remaining decisions need. In 0/1 knapsack that is (item index, remaining capacity) — dropping capacity makes the recurrence wrong, not merely slow.",
  },

  // T30 Complexity Classes and Intractability
  {
    topic: "T30",
    code: "MC-T30-1",
    description:
      "Reading NP as 'non-polynomial' and concluding NP problems cannot be solved in polynomial time.",
    remediation:
      "NP is nondeterministic polynomial time: solutions are verifiable in polynomial time. P is a subset of NP, so every problem in P is also in NP.",
  },
  {
    topic: "T30",
    code: "MC-T30-2",
    description:
      "Treating NP-hard and NP-complete as synonyms.",
    remediation:
      "NP-complete means NP-hard and in NP. NP-hard problems need not be in NP at all — the halting problem is NP-hard but undecidable.",
  },
  {
    topic: "T30",
    code: "MC-T30-3",
    description:
      "Concluding that an NP-complete problem is hopeless for every instance encountered in practice.",
    remediation:
      "Hardness is a worst-case statement. Approximation algorithms, fixed-parameter methods and heuristics solve large real instances routinely.",
  },
];

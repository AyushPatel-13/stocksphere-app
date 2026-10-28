import type { PostView } from "./types";

/**
 * A top-level post's comments as a tree. The API returns a thread flat and
 * oldest first (one query, no N+1); this nests it by parentId without ever
 * dropping a comment:
 *   - a comment whose parent isn't in the list (hidden by a moderator, or not
 *     loaded) hangs under an "unavailable" placeholder for that parent, at
 *     the top level, so it keeps its context;
 *   - repeats (an optimistic insert followed by a reload, overlapping pages)
 *     are merged by id, the later copy winning;
 *   - malformed links that would loop are cut and the comment is shown at the
 *     top level rather than lost.
 * Siblings stay oldest first, as replies always were.
 */

export type ThreadNode = {
  id: string;
  /** Null for a parent that isn't available. */
  post: PostView | null;
  depth: number;
  children: ThreadNode[];
};

function byTime(a: ThreadNode, b: ThreadNode): number {
  const at = a.post?.createdAt ?? "";
  const bt = b.post?.createdAt ?? "";
  return at < bt ? -1 : at > bt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Merge comment lists by id, the later copy winning. */
export function mergeComments(...lists: PostView[][]): PostView[] {
  const byId = new Map<string, PostView>();
  for (const list of lists) for (const post of list) byId.set(post.id, post);
  return [...byId.values()];
}

export function buildThread(comments: PostView[], rootId: string): ThreadNode[] {
  const nodes = new Map<string, ThreadNode>();
  for (const post of mergeComments(comments)) {
    if (post.id === rootId) continue;
    // A comment from another thread doesn't belong here (the server never sends one).
    if (post.rootId && post.rootId !== rootId) continue;
    nodes.set(post.id, { id: post.id, post, depth: 0, children: [] });
  }

  const parentOf = new Map<string, string>();
  const top: ThreadNode[] = [];
  const placeholders = new Map<string, ThreadNode>();

  for (const node of nodes.values()) {
    const parentId = node.post!.parentId;
    if (!parentId || parentId === rootId) {
      top.push(node);
      continue;
    }
    let parent = nodes.get(parentId);
    if (!parent) {
      parent = placeholders.get(parentId);
      if (!parent) {
        parent = { id: parentId, post: null, depth: 0, children: [] };
        placeholders.set(parentId, parent);
        top.push(parent);
      }
    }
    parent.children.push(node);
    parentOf.set(node.id, parentId);
  }

  // Walk from the top, setting depths. Whatever the walk can't reach is in a
  // loop: lift it to the top level (cutting its link) and walk again.
  const seen = new Set<string>();
  const walk = (start: ThreadNode) => {
    const stack: ThreadNode[] = [start];
    start.depth = 0;
    while (stack.length) {
      const node = stack.pop()!;
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      node.children = node.children.filter((child) => !seen.has(child.id)).sort(byTime);
      for (const child of node.children) {
        child.depth = node.depth + 1;
        stack.push(child);
      }
    }
  };
  for (const node of top) walk(node);
  for (const node of [...nodes.values()].sort(byTime)) {
    if (seen.has(node.id)) continue;
    const parent = nodes.get(parentOf.get(node.id) ?? "");
    if (parent) parent.children = parent.children.filter((child) => child.id !== node.id);
    top.push(node);
    walk(node);
  }

  return top.sort(byTime);
}

/** Comments under a node, at any depth (what a collapsed thread hides). */
export function descendantCount(node: ThreadNode): number {
  let count = 0;
  const stack = [...node.children];
  while (stack.length) {
    const next = stack.pop()!;
    if (next.post) count++;
    stack.push(...next.children);
  }
  return count;
}

/** The ids from the top of the thread down to `id` (inclusive), or [] when it isn't there. */
export function pathTo(tree: ThreadNode[], id: string): string[] {
  const stack: { node: ThreadNode; path: string[] }[] = tree.map((node) => ({ node, path: [node.id] }));
  while (stack.length) {
    const { node, path } = stack.pop()!;
    if (node.id === id) return path;
    for (const child of node.children) stack.push({ node: child, path: [...path, child.id] });
  }
  return [];
}

/** Indentation stops here on deep threads; deeper replies say whom they answer instead. */
export const MAX_INDENT = 5;

export type ReplySort = "top" | "new" | "old";

export const REPLY_SORTS: { id: ReplySort; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
  { id: "old", label: "Oldest" },
];

const scoreOfNode = (node: ThreadNode) => (node.post ? (node.post.upCount ?? 0) - (node.post.downCount ?? 0) : 0);

/**
 * The same tree with siblings re-ordered at every level: Top (score, then
 * oldest first, so a thread without votes reads as it always did), New
 * (newest first) or Oldest. Nothing is moved between parents, nothing is
 * dropped, and the input isn't changed.
 */
export function sortThread(nodes: ThreadNode[], sort: ReplySort): ThreadNode[] {
  const compare =
    sort === "top"
      ? (a: ThreadNode, b: ThreadNode) => scoreOfNode(b) - scoreOfNode(a) || byTime(a, b)
      : sort === "new"
        ? (a: ThreadNode, b: ThreadNode) => byTime(b, a)
        : byTime;
  const visit = (list: ThreadNode[]): ThreadNode[] => [...list].sort(compare).map((node) => ({ ...node, children: visit(node.children) }));
  return visit(nodes);
}

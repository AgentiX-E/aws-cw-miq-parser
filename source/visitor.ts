// Enhanced AST Visitor with NodePath API.
//
// Implements a Babel-inspired visitor pattern where each visited node
// receives a NodePath that provides:
//   - parent reference and child key
//   - skip() to skip subtree traversal
//   - stop() to abort entire traversal
//   - replaceWith(node) to replace the current node in its parent
//   - remove() to remove the current node from its parent
//
// This enables AST mutation during traversal for query transformation tools.

import type {
  ParsedQuery,
  SelectClause,
  FromClause,
  NamespaceFrom,
  SchemaFrom,
  WhereClause,
  WhereCondition,
  GroupByClause,
  GroupByItem,
  OrderByClause,
  LimitClause,
} from './types.js';

// ---- NodePath ----

/** Union of all AST node types for the path's node reference. */
export type AstNode =
  | ParsedQuery
  | SelectClause
  | FromClause
  | NamespaceFrom
  | SchemaFrom
  | WhereClause
  | WhereCondition
  | GroupByClause
  | GroupByItem
  | OrderByClause
  | LimitClause;

/**
 * A path object wrapping an AST node with context: parent, key in parent,
 * and control flags for traversal.
 */
export class NodePath<T extends AstNode = AstNode> {
  /** The current AST node. */
  node: T;
  /** Parent NodePath, or null for the root. */
  parent: NodePath | null;
  /** Key in the parent object (property name for objects, index for arrays). */
  parentKey: string | number | null;
  /** Whether this node is in an array parent (e.g., conditions, items). */
  listKey: string | null;
  /** Whether traversal should skip children of this node. */
  private _skip: boolean = false;
  /** Whether traversal should stop entirely. */
  private _stopped: boolean = false;

  constructor(
    node: T,
    parent: NodePath | null = null,
    parentKey: string | number | null = null,
    listKey: string | null = null,
  ) {
    this.node = node;
    this.parent = parent;
    this.parentKey = parentKey;
    this.listKey = listKey;
  }

  /** Skip traversing the children of this node. */
  skip(): void {
    this._skip = true;
  }

  /** Stop all traversal immediately. */
  stop(): void {
    this._stopped = true;
    // Propagate stop to root so top-level traversal checks catch it
    if (this.parent) this.parent.stop();
  }

  /** Whether skip() was called on this path. */
  get shouldSkip(): boolean {
    return this._skip;
  }

  /** Whether stop() was called on this or any ancestor path. */
  get shouldStop(): boolean {
    if (this._stopped) return true;
    return this.parent?.shouldStop ?? false;
  }

  /**
   * Replace the current node in its parent with a new node.
   * Only works when parent and parentKey/listKey are set.
   */
  replaceWith(newNode: AstNode): void {
    if (!this.parent) return;

    if (this.listKey && this.parentKey != null) {
      const arr = (this.parent.node as any)[this.listKey];
      if (Array.isArray(arr)) {
        arr[this.parentKey as number] = newNode;
      }
    } else if (this.parentKey != null) {
      (this.parent.node as any)[this.parentKey] = newNode;
    }
    this.node = newNode as T;
  }

  /**
   * Remove the current node from its parent.
   * For array children, removes by index. For optional children, deletes the property.
   */
  remove(): void {
    if (!this.parent) return;

    if (this.listKey && typeof this.parentKey === 'number') {
      const arr = (this.parent.node as any)[this.listKey];
      if (Array.isArray(arr)) {
        arr.splice(this.parentKey, 1);
      }
    } else if (this.parentKey != null) {
      delete (this.parent.node as any)[this.parentKey];
    }
  }

  /** Get the human-readable node type. */
  get type(): string {
    return (this.node as any).type ?? 'unknown';
  }
}

// ---- Enhanced Visitor Interface ----

/**
 * Enhanced visitor interface receiving NodePath instead of raw node.
 * Each method receives a NodePath that provides parent context and mutation API.
 */
export interface PathVisitor {
  visitQuery?(path: NodePath<ParsedQuery>): void;
  visitSelectClause?(path: NodePath<SelectClause>): void;
  visitFromClause?(path: NodePath<FromClause>): void;
  visitNamespaceFrom?(path: NodePath<NamespaceFrom>): void;
  visitSchemaFrom?(path: NodePath<SchemaFrom>): void;
  visitWhereClause?(path: NodePath<WhereClause>): void;
  visitWhereCondition?(path: NodePath<WhereCondition>, index: number): void;
  visitGroupByClause?(path: NodePath<GroupByClause>): void;
  visitGroupByItem?(path: NodePath<GroupByItem>): void;
  visitOrderByClause?(path: NodePath<OrderByClause>): void;
  visitLimitClause?(path: NodePath<LimitClause>): void;
}

// ---- Traversal with Path ----

/**
 * Traverse a ParsedQuery AST with the enhanced visitor, providing NodePath
 * context for parent navigation and mutation operations.
 *
 * @example
 * ```ts
 * traverseWithPath(query, {
 *   visitLimitClause(path) {
 *     if (path.node.value > 100) {
 *       path.replaceWith({ type: 'LimitClause', value: 100, location: path.node.location });
 *     }
 *   },
 * });
 * ```
 */
export function traverseWithPath(query: ParsedQuery, visitor: PathVisitor): void {
  const rootPath = new NodePath(query);

  visitNode(rootPath, visitor);

  if (rootPath.shouldStop) return;

  // SELECT
  if (!rootPath.shouldSkip) {
    const selectPath = new NodePath(query.select, rootPath, 'select');
    visitor.visitSelectClause?.(selectPath);
  }

  // FROM
  if (!rootPath.shouldSkip && !rootPath.shouldStop) {
    const fromPath = new NodePath(query.from, rootPath, 'from');
    visitor.visitFromClause?.(fromPath);
    if (!fromPath.shouldSkip && !fromPath.shouldStop) {
      if (query.from.type === 'NamespaceFrom') {
        visitor.visitNamespaceFrom?.(fromPath as NodePath<NamespaceFrom>);
      } else {
        visitor.visitSchemaFrom?.(fromPath as NodePath<SchemaFrom>);
      }
    }
  }

  // WHERE
  if (query.where && !rootPath.shouldSkip && !rootPath.shouldStop) {
    const wherePath = new NodePath(query.where, rootPath, 'where', null);
    visitor.visitWhereClause?.(wherePath);
    if (!wherePath.shouldSkip && !wherePath.shouldStop) {
      for (let i = 0; i < query.where.conditions.length; i++) {
        if (wherePath.shouldStop) break;
        const condPath = new NodePath(query.where.conditions[i]!, wherePath, i, 'conditions');
        visitor.visitWhereCondition?.(condPath, i);
        if (condPath.shouldStop) break;
      }
    }
  }

  // GROUP BY
  if (query.groupBy && !rootPath.shouldSkip && !rootPath.shouldStop) {
    const gbPath = new NodePath(query.groupBy, rootPath, 'groupBy', null);
    visitor.visitGroupByClause?.(gbPath);
    if (!gbPath.shouldSkip && !gbPath.shouldStop) {
      for (let i = 0; i < query.groupBy.items.length; i++) {
        if (gbPath.shouldStop) break;
        const itemPath = new NodePath(query.groupBy.items[i]!, gbPath, i, 'items');
        visitor.visitGroupByItem?.(itemPath);
        if (itemPath.shouldStop) break;
      }
    }
  }

  // ORDER BY
  if (query.orderBy && !rootPath.shouldSkip && !rootPath.shouldStop) {
    const obPath = new NodePath(query.orderBy, rootPath, 'orderBy');
    visitor.visitOrderByClause?.(obPath);
  }

  // LIMIT
  if (query.limit && !rootPath.shouldSkip && !rootPath.shouldStop) {
    const limPath = new NodePath(query.limit, rootPath, 'limit');
    visitor.visitLimitClause?.(limPath);
  }
}

function visitNode(path: NodePath, visitor: PathVisitor): void {
  if (path.node.type === 'MetricsInsightsQuery') {
    visitor.visitQuery?.(path as NodePath<ParsedQuery>);
  }
}

// Re-export the legacy simple visitor type under its original name
// Note: QueryVisitor was originally defined in this module and re-exported.
// We maintain backward compatibility without re-importing from types.
export type QueryVisitor = {
  visitQuery?(node: ParsedQuery): void;
  visitSelectClause?(node: SelectClause): void;
  visitFromClause?(node: FromClause): void;
  visitNamespaceFrom?(node: NamespaceFrom): void;
  visitSchemaFrom?(node: SchemaFrom): void;
  visitWhereClause?(node: WhereClause): void;
  visitWhereCondition?(node: WhereCondition, index: number): void;
  visitGroupByClause?(node: GroupByClause): void;
  visitGroupByItem?(node: GroupByItem): void;
  visitOrderByClause?(node: OrderByClause): void;
  visitLimitClause?(node: LimitClause): void;
};

/**
 * Backward-compatible alias for the simple traversal API.
 * Prefer `traverseWithPath` for new code that needs mutation support.
 *
 * @deprecated Use `traverseWithPath` for enhanced functionality (NodePath, skip, stop, replaceWith, remove).
 */
export function traverse(query: ParsedQuery, visitor: QueryVisitor): void {
  // Adapt the legacy visitor to use the new path-based traversal
  traverseWithPath(query, {
    visitQuery: visitor.visitQuery
      ? (p) => visitor.visitQuery!(p.node as ParsedQuery)
      : undefined,
    visitSelectClause: visitor.visitSelectClause
      ? (p) => visitor.visitSelectClause!(p.node as SelectClause)
      : undefined,
    visitFromClause: visitor.visitFromClause
      ? (p) => visitor.visitFromClause!(p.node as FromClause)
      : undefined,
    visitNamespaceFrom: visitor.visitNamespaceFrom
      ? (p) => visitor.visitNamespaceFrom!(p.node as NamespaceFrom)
      : undefined,
    visitSchemaFrom: visitor.visitSchemaFrom
      ? (p) => visitor.visitSchemaFrom!(p.node as SchemaFrom)
      : undefined,
    visitWhereClause: visitor.visitWhereClause
      ? (p) => visitor.visitWhereClause!(p.node as WhereClause)
      : undefined,
    visitWhereCondition: visitor.visitWhereCondition
      ? (p, i) => visitor.visitWhereCondition!(p.node as WhereCondition, i)
      : undefined,
    visitGroupByClause: visitor.visitGroupByClause
      ? (p) => visitor.visitGroupByClause!(p.node as GroupByClause)
      : undefined,
    visitGroupByItem: visitor.visitGroupByItem
      ? (p) => visitor.visitGroupByItem!(p.node as GroupByItem)
      : undefined,
    visitOrderByClause: visitor.visitOrderByClause
      ? (p) => visitor.visitOrderByClause!(p.node as OrderByClause)
      : undefined,
    visitLimitClause: visitor.visitLimitClause
      ? (p) => visitor.visitLimitClause!(p.node as LimitClause)
      : undefined,
  });
}

// AST Visitor for traversing the ParsedQuery tree.
//
// Implements a simple visitor pattern where consumers provide optional
// callbacks for each node type they wish to visit.

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

/**
 * Visitor interface with optional callbacks for each AST node type.
 * Implement only the methods you need — unimplemented methods are silently skipped.
 */
export interface QueryVisitor {
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
}

/**
 * Traverse a ParsedQuery AST with a visitor, calling the appropriate
 * callback for each node encountered.
 *
 * @example
 * ```ts
 * const namespaces: string[] = [];
 * traverse(query, {
 *   visitSchemaFrom(node) { namespaces.push(node.namespace); },
 * });
 * ```
 */
export function traverse(query: ParsedQuery, visitor: QueryVisitor): void {
  visitor.visitQuery?.(query);

  // SELECT
  visitor.visitSelectClause?.(query.select);

  // FROM
  visitor.visitFromClause?.(query.from);
  if (query.from.type === 'NamespaceFrom') {
    visitor.visitNamespaceFrom?.(query.from);
  } else {
    visitor.visitSchemaFrom?.(query.from);
  }

  // WHERE
  if (query.where) {
    visitor.visitWhereClause?.(query.where);
    query.where.conditions.forEach((cond, i) => {
      visitor.visitWhereCondition?.(cond, i);
    });
  }

  // GROUP BY
  if (query.groupBy) {
    visitor.visitGroupByClause?.(query.groupBy);
    query.groupBy.items.forEach((item) => {
      visitor.visitGroupByItem?.(item);
    });
  }

  // ORDER BY
  if (query.orderBy) {
    visitor.visitOrderByClause?.(query.orderBy);
  }

  // LIMIT
  if (query.limit) {
    visitor.visitLimitClause?.(query.limit);
  }
}

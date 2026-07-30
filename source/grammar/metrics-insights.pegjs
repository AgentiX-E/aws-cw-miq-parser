// Metrics Insights Query Grammar for Peggy (PEG.js successor)
//
// This grammar defines the complete CloudWatch Metrics Insights query syntax
// as specified by AWS documentation:
// https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-querylanguage.html
//
// Grammar layers:
//   Layer 1: Character classes (whitespace, letters, digits)
//   Layer 2: Lexical tokens (keywords, identifiers, strings, numbers, operators)
//   Layer 3: Clause rules (SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT)
//   Layer 4: Query rule (top-level composition)
//
// Design principles:
//   - Keywords are case-insensitive ("SELECT"i)
//   - Identifiers (namespaces, metric names, dimensions) are case-sensitive
//   - Comments (-- line, /* block */) are treated as whitespace
//   - Error annotations use expected() for precise diagnostics

{
  // ---- Helper Functions ----

  const AGGREGATION_FUNCTIONS = new Set(['AVG', 'COUNT', 'MAX', 'MIN', 'SUM']);

  function normalizeFunction(name) {
    const upper = name.toUpperCase();
    if (!AGGREGATION_FUNCTIONS.has(upper)) {
      error(`Unknown aggregation function: ${name}`);
    }
    return upper;
  }
}

// ============================================================
// Layer 1: Character Classes
// ============================================================

// Whitespace: spaces, tabs, newlines, carriage returns
WhiteSpace "whitespace"
  = [ \t\n\r]+

// Line comment: -- until end of line
LineComment
  = "--" [^\n\r]*

// Block comment: /* ... */
BlockComment
  = "/*" (!"*/" .)* "*/"

// Comments are treated as whitespace (skipped between tokens)
Comment
  = LineComment / BlockComment

// Whitespace sequence (zero or more whitespace/comments)
_ "whitespace"
  = (WhiteSpace / Comment)*

// ============================================================
// Layer 2: Lexical Tokens
// ============================================================

// Aggregation functions (case-insensitive, validated against known set)
Function
  = name:("AVG"i / "COUNT"i / "MAX"i / "MIN"i / "SUM"i) {
      return text().toUpperCase();
    }

// Quoted identifier: "anything with special chars"
QuotedIdentifier
  = '"' chars:QuotedIdentifierChar* '"' {
      return chars.join('');
    }

QuotedIdentifierChar
  = '\\"' { return '"'; }    // Escaped double-quote
  / [^"]                      // Any non-quote character

// Plain identifier: letters, digits, underscores (case-sensitive)
// Uses text() to capture the full matched identifier string.
PlainIdentifier
  = [a-zA-Z_][a-zA-Z0-9_]* {
      return text();
    }

// General identifier (tries quoted first, then plain)
Identifier
  = QuotedIdentifier
  / PlainIdentifier

// Tag-aware identifier: tag.identifier or tag."quoted"
// Returns { isTag: true, name: 'tag.<key>' } to preserve the full label key.
TagIdentifier
  = "tag."i _ key:(QuotedIdentifier / PlainIdentifier) {
      return { isTag: true, name: 'tag.' + key };
    }

// Label key: can be a regular dimension name or a tag reference
// The `name` field always contains the full identifier as it appears in the query.
LabelKey
  = TagIdentifier
  / id:PlainIdentifier { return { isTag: false, name: id }; }

// String literal: single-quoted with escape support
StringLiteral
  = "'" chars:StringChar* "'" {
      return chars.join('');
    }

StringChar
  = "\\'" { return "'"; }    // Escaped single-quote
  / "\\\\" { return "\\"; }  // Escaped backslash
  / [^']                      // Any non-quote character

// Number literal: positive integer
NumberLiteral
  = digits:[0-9]+ {
      return parseInt(digits.join(''), 10);
    }

// Comparison operators
Operator
  = "!=" { return '!='; }
  / "<=" { return '<='; }
  / ">=" { return '>='; }
  / "="  { return '='; }
  / "<"  { return '<'; }
  / ">"  { return '>'; }

// Namespace in FROM: quoted (for namespaces with / or special chars) or plain
NamespaceValue
  = '"' ns:NamespaceChar+ '"' { return ns.join(''); }
  / ns:PlainIdentifier        { return ns; }

NamespaceChar
  = '\\"' { return '"'; }
  / [^"]

// Dimension name in SCHEMA: quoted or plain
DimensionName
  = '"' dim:QuotedIdentifierChar* '"' { return dim.join(''); }
  / dim:PlainIdentifier               { return dim; }

// ============================================================
// Layer 3: Clause Rules
// ============================================================

// SELECT clause: SELECT FUNCTION(metricName)
SelectClause
  = "SELECT"i _ func:Function _ "(" _ metric:Identifier _ ")" _ {
      return {
        type: 'SelectClause',
        function: func,
        metricName: metric,
        location: location()
      };
    }

// FROM clause: FROM namespace | FROM SCHEMA(...)
FromClause
  = "FROM"i _ source:(SchemaSource / NamespaceSource) _ {
      return source;
    }

// Namespace variant: FROM "AWS/EC2"
NamespaceSource
  = ns:NamespaceValue {
      return {
        type: 'NamespaceFrom',
        namespace: ns,
        location: location()
      };
    }

// SCHEMA variant: FROM SCHEMA("AWS/EC2" [, dim1, dim2, ...])
SchemaSource
  = "SCHEMA"i _ "(" _ ns:NamespaceValue
    dims:("," _ dim:DimensionName _ { return dim; })*
    _ ")" {
      return {
        type: 'SchemaFrom',
        namespace: ns,
        dimensions: dims,
        location: location()
      };
    }

// WHERE clause: WHERE condition [AND condition ...]
WhereClause
  = "WHERE"i _ first:Condition _ rest:Conjunction* _ {
      const conditions = [first];
      // Annotate logical operators
      first.logicalOperator = null;
      for (let i = 0; i < rest.length; i++) {
        rest[i].logicalOperator = 'AND';
        conditions.push(rest[i]);
      }
      return {
        type: 'WhereClause',
        conditions: conditions,
        location: location()
      };
    }

// AND-connected condition
Conjunction
  = "AND"i _ cond:Condition _ { return cond; }

// A single WHERE condition: labelKey OPERATOR labelValue
Condition
  = label:LabelKey _ op:Operator _ val:LabelValue _ {
      return {
        type: 'WhereCondition',
        labelKey: label.name,
        operator: op,
        labelValue: val,
        isTag: label.isTag,
        // logicalOperator is set by WhereClause
        location: location()
      };
    }

// Label value in WHERE: string literal or number
LabelValue
  = StringLiteral
  / NumberLiteral

// GROUP BY clause: GROUP BY labelKey [, labelKey ...]
GroupByClause
  = "GROUP"i _ "BY"i _ first:LabelKey _ rest:GroupByRest* _ {
      const items = [first, ...rest];
      return {
        type: 'GroupByClause',
        items: items.map((k) => ({
          type: 'GroupByItem',
          labelKey: k.name,
          isTag: k.isTag,
          location: location()
        })),
        location: location()
      };
    }

GroupByRest
  = "," _ key:LabelKey _ { return key; }

// ORDER BY clause: ORDER BY FUNCTION() [ASC | DESC]
OrderByClause
  = "ORDER"i _ "BY"i _ func:Function _ "(" _ ")" _
    direction:(Direction / &{ return 'ASC'; }) _ {
      return {
        type: 'OrderByClause',
        function: func,
        direction: direction || 'ASC',
        location: location()
      };
    }

Direction
  = "DESC"i { return 'DESC'; }
  / "ASC"i  { return 'ASC'; }

// LIMIT clause: LIMIT number (1-500)
LimitClause
  = "LIMIT"i _ value:NumberLiteral _ {
      return {
        type: 'LimitClause',
        value: value,
        location: location()
      };
    }

// ============================================================
// Layer 4: Top-Level Query
// ============================================================

// Full query: SELECT ... FROM ... [WHERE ...] [GROUP BY ...] [ORDER BY ...] [LIMIT ...]
Query
  = _ select:SelectClause
    from:FromClause
    where:WhereClause?
    groupBy:GroupByClause?
    orderBy:OrderByClause?
    limit:LimitClause?
    _ {
      const result = {
        type: 'MetricsInsightsQuery',
        select: select,
        from: from,
        location: location()
      };

      if (where) result.where = where;
      if (groupBy) result.groupBy = groupBy;
      if (orderBy) result.orderBy = orderBy;
      if (limit) result.limit = limit;

      return result;
    }

// Semantic validator for CloudWatch Metrics Insights parsed queries.
//
// Performs cross-clause validation that the parser cannot catch at the
// syntactic level. Implements the AWS reserved keywords check (700+ words).

import type {
  ParsedQuery,
  FromClause,
  WhereClause,
  GroupByClause,
  OrderByClause,
  ValidationResult,
  ValidationMessage,
} from './types.js';
import { ErrorCodes } from './errors.js';

// ============================================================
// AWS CloudWatch Metrics Insights Reserved Keywords (700+ words)
// Source: https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch-metrics-insights-reserved-keywords.html
// ============================================================

const RESERVED_KEYWORDS = new Set([
  'ABORT', 'ABORTSESSION', 'ABS', 'ABSOLUTE', 'ACCESS', 'ACCESSIBLE',
  'ACCESS_LOCK', 'ACCOUNT', 'ACOS', 'ACOSH', 'ACTION', 'ADD', 'ADD_MONTHS',
  'ADMIN', 'AFTER', 'AGGREGATE', 'ALIAS', 'ALL', 'ALLOCATE', 'ALLOW',
  'ALTER', 'ALTERAND', 'AMP', 'ANALYSE', 'ANALYZE', 'AND', 'ANSIDATE',
  'ANY', 'ARE', 'ARRAY', 'ARRAY_AGG', 'ARRAY_EXISTS',
  'ARRAY_MAX_CARDINALITY', 'AS', 'ASC', 'ASENSITIVE', 'ASIN', 'ASINH',
  'ASSERTION', 'ASSOCIATE', 'ASUTIME', 'ASYMMETRIC', 'AT', 'ATAN', 'ATAN2',
  'ATANH', 'ATOMIC', 'AUDIT', 'AUTHORIZATION', 'AUX', 'AUXILIARY', 'AVE',
  'AVERAGE', 'AVG', 'BACKUP', 'BEFORE', 'BEGIN', 'BEGIN_FRAME',
  'BEGIN_PARTITION', 'BETWEEN', 'BIGINT', 'BINARY', 'BIT', 'BLOB',
  'BOOLEAN', 'BOTH', 'BREADTH', 'BREAK', 'BROWSE', 'BT', 'BUFFERPOOL',
  'BULK', 'BUT', 'BY', 'BYTE', 'BYTEINT', 'BYTES', 'CALL', 'CALLED',
  'CAPTURE', 'CARDINALITY', 'CASCADE', 'CASCADED', 'CASE', 'CASESPECIFIC',
  'CASE_N', 'CAST', 'CATALOG', 'CCSID', 'CD', 'CEIL', 'CEILING', 'CHANGE',
  'CHAR', 'CHAR2HEXINT', 'CHARACTER', 'CHARACTERS', 'CHARACTER_LENGTH',
  'CHARS', 'CHAR_LENGTH', 'CHECK', 'CHECKPOINT', 'CLASS', 'CLASSIFIER',
  'CLOB', 'CLONE', 'CLOSE', 'CLUSTER', 'CLUSTERED', 'CM', 'COALESCE',
  'COLLATE', 'COLLATION', 'COLLECT', 'COLLECTION', 'COLLID', 'COLUMN',
  'COLUMN_VALUE', 'COMMENT', 'COMMIT', 'COMPLETION', 'COMPRESS', 'COMPUTE',
  'CONCAT', 'CONCURRENTLY', 'CONDITION', 'CONNECT', 'CONNECTION',
  'CONSTRAINT', 'CONSTRAINTS', 'CONSTRUCTOR', 'CONTAINS', 'CONTAINSTABLE',
  'CONTENT', 'CONTINUE', 'CONVERT', 'CONVERT_TABLE_HEADER', 'COPY', 'CORR',
  'CORRESPONDING', 'COS', 'COSH', 'COUNT', 'COVAR_POP', 'COVAR_SAMP',
  'CREATE', 'CROSS', 'CS', 'CSUM', 'CT', 'CUBE', 'CUME_DIST', 'CURRENT',
  'CURRENT_CATALOG', 'CURRENT_DATE', 'CURRENT_DEFAULT_TRANSFORM_GROUP',
  'CURRENT_LC_CTYPE', 'CURRENT_PATH', 'CURRENT_ROLE', 'CURRENT_ROW',
  'CURRENT_SCHEMA', 'CURRENT_SERVER', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
  'CURRENT_TIMEZONE', 'CURRENT_TRANSFORM_GROUP_FOR_TYPE', 'CURRENT_USER',
  'CURRVAL', 'CURSOR', 'CV', 'CYCLE', 'DATA', 'DATABASE', 'DATABASES',
  'DATABLOCKSIZE', 'DATE', 'DATEFORM', 'DAY', 'DAYS', 'DAY_HOUR',
  'DAY_MICROSECOND', 'DAY_MINUTE', 'DAY_SECOND', 'DBCC', 'DBINFO',
  'DEALLOCATE', 'DEC', 'DECFLOAT', 'DECIMAL', 'DECLARE', 'DEFAULT',
  'DEFERRABLE', 'DEFERRED', 'DEFINE', 'DEGREES', 'DEL', 'DELAYED', 'DELETE',
  'DENSE_RANK', 'DENY', 'DEPTH', 'DEREF', 'DESC', 'DESCRIBE', 'DESCRIPTOR',
  'DESTROY', 'DESTRUCTOR', 'DETERMINISTIC', 'DIAGNOSTIC', 'DIAGNOSTICS',
  'DICTIONARY', 'DISABLE', 'DISABLED', 'DISALLOW', 'DISCONNECT', 'DISK',
  'DISTINCT', 'DISTINCTROW', 'DISTRIBUTED', 'DIV', 'DO', 'DOCUMENT',
  'DOMAIN', 'DOUBLE', 'DROP', 'DSSIZE', 'DUAL', 'DUMP', 'DYNAMIC', 'EACH',
  'ECHO', 'EDITPROC', 'ELEMENT', 'ELSE', 'ELSEIF', 'EMPTY', 'ENABLED',
  'ENCLOSED', 'ENCODING', 'ENCRYPTION', 'END', 'END-EXEC', 'ENDING',
  'END_FRAME', 'END_PARTITION', 'EQ', 'EQUALS', 'ERASE', 'ERRLVL', 'ERROR',
  'ERRORFILES', 'ERRORTABLES', 'ESCAPE', 'ESCAPED', 'ET', 'EVERY', 'EXCEPT',
  'EXCEPTION', 'EXCLUSIVE', 'EXEC', 'EXECUTE', 'EXISTS', 'EXIT', 'EXP',
  'EXPLAIN', 'EXTERNAL', 'EXTRACT', 'FALLBACK', 'FALSE', 'FASTEXPORT',
  'FENCED', 'FETCH', 'FIELDPROC', 'FILE', 'FILLFACTOR', 'FILTER', 'FINAL',
  'FIRST', 'FIRST_VALUE', 'FLOAT', 'FLOAT4', 'FLOAT8', 'FLOOR', 'FOR',
  'FORCE', 'FOREIGN', 'FORMAT', 'FOUND', 'FRAME_ROW', 'FREE', 'FREESPACE',
  'FREETEXT', 'FREETEXTTABLE', 'FREEZE', 'FROM', 'FULL', 'FULLTEXT',
  'FUNCTION', 'FUSION', 'GE', 'GENERAL', 'GENERATED', 'GET', 'GIVE',
  'GLOBAL', 'GO', 'GOTO', 'GRANT', 'GRAPHIC', 'GROUP', 'GROUPING',
  'GROUPS', 'GT', 'HANDLER', 'HASH', 'HASHAMP', 'HASHBAKAMP', 'HASHBUCKET',
  'HASHROW', 'HAVING', 'HELP', 'HIGH_PRIORITY', 'HOLD', 'HOLDLOCK', 'HOUR',
  'HOURS', 'HOUR_MICROSECOND', 'HOUR_MINUTE', 'HOUR_SECOND', 'IDENTIFIED',
  'IDENTITY', 'IDENTITYCOL', 'IDENTITY_INSERT', 'IF', 'IGNORE', 'ILIKE',
  'IMMEDIATE', 'IN', 'INCLUSIVE', 'INCONSISTENT', 'INCREMENT', 'INDEX',
  'INDICATOR', 'INFILE', 'INHERIT', 'INITIAL', 'INITIALIZE', 'INITIALLY',
  'INITIATE', 'INNER', 'INOUT', 'INPUT', 'INS', 'INSENSITIVE', 'INSERT',
  'INSTEAD', 'INT', 'INT1', 'INT2', 'INT3', 'INT4', 'INT8', 'INTEGER',
  'INTEGERDATE', 'INTERSECT', 'INTERSECTION', 'INTERVAL', 'INTO',
  'IO_AFTER_GTIDS', 'IO_BEFORE_GTIDS', 'IS', 'ISNULL', 'ISOBID',
  'ISOLATION', 'ITERATE', 'JAR', 'JOIN', 'JOURNAL', 'JSON_ARRAY',
  'JSON_ARRAYAGG', 'JSON_EXISTS', 'JSON_OBJECT', 'JSON_OBJECTAGG',
  'JSON_QUERY', 'JSON_TABLE', 'JSON_TABLE_PRIMITIVE', 'JSON_VALUE', 'KEEP',
  'KEY', 'KEYS', 'KILL', 'KURTOSIS', 'LABEL', 'LAG', 'LANGUAGE', 'LARGE',
  'LAST', 'LAST_VALUE', 'LATERAL', 'LC_CTYPE', 'LE', 'LEAD', 'LEADING',
  'LEAVE', 'LEFT', 'LESS', 'LEVEL', 'LIKE', 'LIKE_REGEX', 'LIMIT',
  'LINEAR', 'LINENO', 'LINES', 'LISTAGG', 'LN', 'LOAD', 'LOADING', 'LOCAL',
  'LOCALE', 'LOCALTIME', 'LOCALTIMESTAMP', 'LOCATOR', 'LOCATORS', 'LOCK',
  'LOCKING', 'LOCKMAX', 'LOCKSIZE', 'LOG', 'LOG10', 'LOGGING', 'LOGON',
  'LONG', 'LONGBLOB', 'LONGTEXT', 'LOOP', 'LOWER', 'LOW_PRIORITY', 'LT',
  'MACRO', 'MAINTAINED', 'MAP', 'MASTER_BIND',
  'MASTER_SSL_VERIFY_SERVER_CERT', 'MATCH', 'MATCHES', 'MATCH_NUMBER',
  'MATCH_RECOGNIZE', 'MATERIALIZED', 'MAVG', 'MAX', 'MAXEXTENTS',
  'MAXIMUM', 'MAXVALUE', 'MCHARACTERS', 'MDIFF', 'MEDIUMBLOB', 'MEDIUMINT',
  'MEDIUMTEXT', 'MEMBER', 'MERGE', 'METHOD', 'MICROSECOND', 'MICROSECONDS',
  'MIDDLEINT', 'MIN', 'MINDEX', 'MINIMUM', 'MINUS', 'MINUTE', 'MINUTES',
  'MINUTE_MICROSECOND', 'MINUTE_SECOND', 'MLINREG', 'MLOAD', 'MLSLABEL',
  'MOD', 'MODE', 'MODIFIES', 'MODIFY', 'MODULE', 'MONITOR', 'MONRESOURCE',
  'MONSESSION', 'MONTH', 'MONTHS', 'MSUBSTR', 'MSUM', 'MULTISET', 'NAMED',
  'NAMES', 'NATIONAL', 'NATURAL', 'NCHAR', 'NCLOB', 'NE',
  'NESTED_TABLE_ID', 'NEW', 'NEW_TABLE', 'NEXT', 'NEXTVAL', 'NO', 'NOAUDIT',
  'NOCHECK', 'NOCOMPRESS', 'NONCLUSTERED', 'NONE', 'NORMALIZE', 'NOT',
  'NOTNULL', 'NOWAIT', 'NO_WRITE_TO_BINLOG', 'NTH_VALUE', 'NTILE', 'NULL',
  'NULLIF', 'NULLIFZERO', 'NULLS', 'NUMBER', 'NUMERIC', 'NUMPARTS', 'OBID',
  'OBJECT', 'OBJECTS', 'OCCURRENCES_REGEX', 'OCTET_LENGTH', 'OF', 'OFF',
  'OFFLINE', 'OFFSET', 'OFFSETS', 'OLD', 'OLD_TABLE', 'OMIT', 'ON', 'ONE',
  'ONLINE', 'ONLY', 'OPEN', 'OPENDATASOURCE', 'OPENQUERY', 'OPENROWSET',
  'OPENXML', 'OPERATION', 'OPTIMIZATION', 'OPTIMIZE', 'OPTIMIZER_COSTS',
  'OPTION', 'OPTIONALLY', 'OR', 'ORDER', 'ORDINALITY', 'ORGANIZATION',
  'OUT', 'OUTER', 'OUTFILE', 'OUTPUT', 'OVER', 'OVERLAPS', 'OVERLAY',
  'OVERRIDE', 'PACKAGE', 'PAD', 'PADDED', 'PARAMETER', 'PARAMETERS', 'PART',
  'PARTIAL', 'PARTITION', 'PARTITIONED', 'PARTITIONING', 'PASSWORD', 'PATH',
  'PATTERN', 'PCTFREE', 'PER', 'PERCENT', 'PERCENTILE', 'PERCENTILE_CONT',
  'PERCENTILE_DISC', 'PERCENT_RANK', 'PERIOD', 'PERM', 'PERMANENT',
  'PIECESIZE', 'PIVOT', 'PLACING', 'PLAN', 'PORTION', 'POSITION',
  'POSITION_REGEX', 'POSTFIX', 'POWER', 'PRECEDES', 'PRECISION', 'PREFIX',
  'PREORDER', 'PREPARE', 'PRESERVE', 'PREVVAL', 'PRIMARY', 'PRINT', 'PRIOR',
  'PRIQTY', 'PRIVATE', 'PRIVILEGES', 'PROC', 'PROCEDURE', 'PROFILE',
  'PROGRAM', 'PROPORTIONAL', 'PROTECTION', 'PSID', 'PTF', 'PUBLIC', 'PURGE',
  'QUALIFIED', 'QUALIFY', 'QUANTILE', 'QUERY', 'QUERYNO', 'RADIANS',
  'RAISERROR', 'RANDOM', 'RANGE', 'RANGE_N', 'RANK', 'RAW', 'READ',
  'READS', 'READTEXT', 'READ_WRITE', 'REAL', 'RECONFIGURE', 'RECURSIVE',
  'REF', 'REFERENCES', 'REFERENCING', 'REFRESH', 'REGEXP', 'REGR_AVGX',
  'REGR_AVGY', 'REGR_COUNT', 'REGR_INTERCEPT', 'REGR_R2', 'REGR_SLOPE',
  'REGR_SXX', 'REGR_SXY', 'REGR_SYY', 'RELATIVE', 'RELEASE', 'RENAME',
  'REPEAT', 'REPLACE', 'REPLICATION', 'REPOVERRIDE', 'REQUEST', 'REQUIRE',
  'RESIGNAL', 'RESOURCE', 'RESTART', 'RESTORE', 'RESTRICT', 'RESULT',
  'RESULT_SET_LOCATOR', 'RESUME', 'RET', 'RETRIEVE', 'RETURN', 'RETURNING',
  'RETURNS', 'REVALIDATE', 'REVERT', 'REVOKE', 'RIGHT', 'RIGHTS', 'RLIKE',
  'ROLE', 'ROLLBACK', 'ROLLFORWARD', 'ROLLUP', 'ROUND_CEILING',
  'ROUND_DOWN', 'ROUND_FLOOR', 'ROUND_HALF_DOWN', 'ROUND_HALF_EVEN',
  'ROUND_HALF_UP', 'ROUND_UP', 'ROUTINE', 'ROW', 'ROWCOUNT', 'ROWGUIDCOL',
  'ROWID', 'ROWNUM', 'ROWS', 'ROWSET', 'ROW_NUMBER', 'RULE', 'RUN',
  'RUNNING', 'SAMPLE', 'SAMPLEID', 'SAVE', 'SAVEPOINT', 'SCHEMA',
  'SCHEMAS', 'SCOPE', 'SCRATCHPAD', 'SCROLL', 'SEARCH', 'SECOND', 'SECONDS',
  'SECOND_MICROSECOND', 'SECQTY', 'SECTION', 'SECURITY', 'SECURITYAUDIT',
  'SEEK', 'SEL', 'SELECT', 'SEMANTICKEYPHRASETABLE',
  'SEMANTICSIMILARITYDETAILSTABLE', 'SEMANTICSIMILARITYTABLE', 'SENSITIVE',
  'SEPARATOR', 'SEQUENCE', 'SESSION', 'SESSION_USER', 'SET', 'SETRESRATE',
  'SETS', 'SETSESSRATE', 'SETUSER', 'SHARE', 'SHOW', 'SHUTDOWN', 'SIGNAL',
  'SIMILAR', 'SIMPLE', 'SIN', 'SINH', 'SIZE', 'SKEW', 'SKIP', 'SMALLINT',
  'SOME', 'SOUNDEX', 'SOURCE', 'SPACE', 'SPATIAL', 'SPECIFIC',
  'SPECIFICTYPE', 'SPOOL', 'SQL', 'SQLEXCEPTION', 'SQLSTATE', 'SQLTEXT',
  'SQLWARNING', 'SQL_BIG_RESULT', 'SQL_CALC_FOUND_ROWS', 'SQL_SMALL_RESULT',
  'SQRT', 'SS', 'SSL', 'STANDARD', 'START', 'STARTING', 'STARTUP', 'STAT',
  'STATE', 'STATEMENT', 'STATIC', 'STATISTICS', 'STAY', 'STDDEV_POP',
  'STDDEV_SAMP', 'STEPINFO', 'STOGROUP', 'STORED', 'STORES',
  'STRAIGHT_JOIN', 'STRING_CS', 'STRUCTURE', 'STYLE', 'SUBMULTISET',
  'SUBSCRIBER', 'SUBSET', 'SUBSTR', 'SUBSTRING', 'SUBSTRING_REGEX',
  'SUCCEEDS', 'SUCCESSFUL', 'SUM', 'SUMMARY', 'SUSPEND', 'SYMMETRIC',
  'SYNONYM', 'SYSDATE', 'SYSTEM', 'SYSTEM_TIME', 'SYSTEM_USER',
  'SYSTIMESTAMP', 'TABLE', 'TABLESAMPLE', 'TABLESPACE', 'TAN', 'TANH',
  'TBL_CS', 'TEMPORARY', 'TERMINATE', 'TERMINATED', 'TEXTSIZE', 'THAN',
  'THEN', 'THRESHOLD', 'TIME', 'TIMESTAMP', 'TIMEZONE_HOUR',
  'TIMEZONE_MINUTE', 'TINYBLOB', 'TINYINT', 'TINYTEXT', 'TITLE', 'TO',
  'TOP', 'TRACE', 'TRAILING', 'TRAN', 'TRANSACTION', 'TRANSLATE',
  'TRANSLATE_CHK', 'TRANSLATE_REGEX', 'TRANSLATION', 'TREAT', 'TRIGGER',
  'TRIM', 'TRIM_ARRAY', 'TRUE', 'TRUNCATE', 'TRY_CONVERT', 'TSEQUAL',
  'TYPE', 'UC', 'UESCAPE', 'UID', 'UNDEFINED', 'UNDER', 'UNDO', 'UNION',
  'UNIQUE', 'UNKNOWN', 'UNLOCK', 'UNNEST', 'UNPIVOT', 'UNSIGNED', 'UNTIL',
  'UPD', 'UPDATE', 'UPDATETEXT', 'UPPER', 'UPPERCASE', 'USAGE', 'USE',
  'USER', 'USING', 'UTC_DATE', 'UTC_TIME', 'UTC_TIMESTAMP', 'VALIDATE',
  'VALIDPROC', 'VALUE', 'VALUES', 'VALUE_OF', 'VARBINARY', 'VARBYTE',
  'VARCHAR', 'VARCHAR2', 'VARCHARACTER', 'VARGRAPHIC', 'VARIABLE',
  'VARIADIC', 'VARIANT', 'VARYING', 'VAR_POP', 'VAR_SAMP', 'VCAT',
  'VERBOSE', 'VERSIONING', 'VIEW', 'VIRTUAL', 'VOLATILE', 'VOLUMES',
  'WAIT', 'WAITFOR', 'WHEN', 'WHENEVER', 'WHERE', 'WHILE', 'WIDTH_BUCKET',
  'WINDOW', 'WITH', 'WITHIN', 'WITHIN_GROUP', 'WITHOUT', 'WLM', 'WORK',
  'WRITE', 'WRITETEXT', 'XMLCAST', 'XMLEXISTS', 'XMLNAMESPACES', 'XOR',
  'YEAR', 'YEARS', 'YEAR_MONTH', 'ZEROFILL', 'ZEROIFNULL', 'ZONE',
]);

// ============================================================
// Validation logic
// ============================================================

/**
 * Run semantic validation on a parsed query AST.
 * Returns errors for invalid semantics and warnings for suspicious patterns.
 */
export function validate(query: ParsedQuery): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  validateSelectOrderByConsistency(query, warnings);
  validateLimitRange(query, errors);
  validateReservedKeywords(query, errors);
  validateGroupByDuplicates(query, warnings);
  validateWhereKeyInSchema(query, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---- Individual validation passes ----

/** Warn if SELECT function and ORDER BY function differ (may be intentional). */
function validateSelectOrderByConsistency(
  query: ParsedQuery,
  warnings: ValidationMessage[],
): void {
  if (!query.orderBy) return;
  if (query.select.function !== query.orderBy.function) {
    warnings.push({
      severity: 'warning',
      code: ErrorCodes.SEM_FUNCTION_MISMATCH,
      message: `SELECT function ${query.select.function} differs from ORDER BY function ${query.orderBy.function}. ` +
        'This may produce unexpected sorting behavior.',
      location: query.orderBy.location,
    });
  }
}

/** Validate LIMIT is in range 1–500 per AWS spec. */
function validateLimitRange(
  query: ParsedQuery,
  errors: ValidationMessage[],
): void {
  if (!query.limit) return;
  const { value } = query.limit;

  if (value < 1 || value > 500) {
    errors.push({
      severity: 'error',
      code: ErrorCodes.SEM_LIMIT_OUT_OF_RANGE,
      message: `LIMIT value ${value} is out of range. Must be between 1 and 500 inclusive.`,
      location: query.limit.location,
    });
  }
}

/** Detect unquoted identifiers that collide with reserved keywords. */
function validateReservedKeywords(
  query: ParsedQuery,
  errors: ValidationMessage[],
): void {
  // Check metric name
  const metricName = query.select.metricName;
  if (RESERVED_KEYWORDS.has(metricName.toUpperCase())) {
    errors.push({
      severity: 'error',
      code: ErrorCodes.SEM_RESERVED_KEYWORD,
      message: `Metric name '${metricName}' is a reserved keyword in Metrics Insights. ` +
        `Use double quotes: "${metricName}".`,
      location: query.select.location,
    });
  }

  // Check namespace
  const nsLocation = query.from.location;
  if (query.from.type === 'NamespaceFrom') {
    checkReserved(query.from.namespace, nsLocation, 'Namespace', errors);
  } else if (query.from.type === 'SchemaFrom') {
    checkReserved(query.from.namespace, nsLocation, 'Namespace', errors);
    for (const dim of query.from.dimensions) {
      checkReserved(dim, nsLocation, `Dimension '${dim}'`, errors);
    }
  }
}

function checkReserved(
  identifier: string,
  location: import('./types.js').SourceLocation,
  context: string,
  errors: ValidationMessage[],
): void {
  if (RESERVED_KEYWORDS.has(identifier.toUpperCase())) {
    errors.push({
      severity: 'error',
      code: ErrorCodes.SEM_RESERVED_KEYWORD,
      message: `${context} '${identifier}' is a reserved keyword in Metrics Insights. ` +
        `Use double quotes: "${identifier}".`,
      location,
    });
  }
}

/** Detect duplicate GROUP BY keys. */
function validateGroupByDuplicates(
  query: ParsedQuery,
  warnings: ValidationMessage[],
): void {
  if (!query.groupBy) return;
  const seen = new Set<string>();
  for (const item of query.groupBy.items) {
    if (seen.has(item.labelKey)) {
      warnings.push({
        severity: 'warning',
        code: ErrorCodes.SEM_DUPLICATE_GROUP_BY,
        message: `Duplicate GROUP BY key '${item.labelKey}'. Duplicate keys have no effect.`,
        location: item.location,
      });
    }
    seen.add(item.labelKey);
  }
}

/** Warn if WHERE keys don't appear in SCHEMA dimensions. */
function validateWhereKeyInSchema(
  query: ParsedQuery,
  warnings: ValidationMessage[],
): void {
  if (!query.where || query.from.type !== 'SchemaFrom') return;

  const schemaDims = new Set(query.from.dimensions);
  for (const cond of query.where.conditions) {
    // Tag keys are always valid — they belong to resources, not dimensions
    if (cond.isTag) continue;
    // AWS.AccountId is a special key
    if (cond.labelKey.startsWith('AWS.AccountId')) continue;
    if (!schemaDims.has(cond.labelKey)) {
      warnings.push({
        severity: 'warning',
        code: ErrorCodes.SEM_WHERE_KEY_NOT_IN_SCHEMA,
        message: `WHERE key '${cond.labelKey}' is not listed in SCHEMA dimensions. ` +
          'Queries with this condition may match metrics with different dimension sets.',
        location: cond.location,
      });
    }
  }
}

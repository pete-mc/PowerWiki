import { getClient } from "azure-devops-extension-api";
import {
  FieldType,
  QueryExpand,
  QueryType,
  WorkItemErrorPolicy,
  WorkItemTrackingRestClient,
  type WorkItem,
  type WorkItemFieldReference,
  type WorkItemLink
} from "azure-devops-extension-api/WorkItemTracking";

export interface QueryTableColumn {
  readonly name: string;
  readonly referenceName: string;
}

export interface QueryTableRow {
  readonly id: number;
  readonly values: ReadonlyMap<string, string>;
  /** Nested rows, present only for hierarchical (tree) query results. */
  readonly children?: readonly QueryTableRow[];
}

export interface QueryTableResult {
  readonly columns: readonly QueryTableColumn[];
  readonly name?: string;
  readonly rows: readonly QueryTableRow[];
  /**
   * Reference names of columns whose values are rich HTML (e.g. Description,
   * Acceptance Criteria, History) and should be rendered as markup, not text.
   */
  readonly htmlColumns?: ReadonlySet<string>;
  /** True when `rows` is a hierarchy of parent/child work items to render as a tree. */
  readonly isTree?: boolean;
}

interface MutableTreeRow {
  readonly id: number;
  readonly values: ReadonlyMap<string, string>;
  readonly children: MutableTreeRow[];
}

export interface WorkItemBadgeDetails {
  readonly id: number;
  readonly state?: string;
  readonly title?: string;
  readonly type?: string;
}

const DEFAULT_COLUMNS: readonly QueryTableColumn[] = [
  { name: "ID", referenceName: "System.Id" },
  { name: "Work Item Type", referenceName: "System.WorkItemType" },
  { name: "Title", referenceName: "System.Title" },
  { name: "State", referenceName: "System.State" },
  { name: "Assigned To", referenceName: "System.AssignedTo" }
];

const BADGE_FIELDS = [
  "System.WorkItemType",
  "System.Title",
  "System.State"
];

const QUERY_TOP = 200;

export class AzureDevOpsWorkItemClient {
  private readonly client = getClient(WorkItemTrackingRestClient);
  private fieldTypesPromise?: Promise<ReadonlyMap<string, FieldType>>;

  public constructor(private readonly projectName: string) {}

  public async getWorkItemBadgeDetails(id: number): Promise<WorkItemBadgeDetails> {
    const workItem = await this.client.getWorkItem(id, this.projectName, BADGE_FIELDS);

    return {
      id,
      state: fieldValue(workItem, "System.State"),
      title: fieldValue(workItem, "System.Title"),
      type: fieldValue(workItem, "System.WorkItemType")
    };
  }

  public async getQueryTable(queryId: string): Promise<QueryTableResult> {
    const [queryDefinition, queryResult] = await Promise.all([
      this.client.getQuery(this.projectName, queryId, QueryExpand.All).catch(() => undefined),
      this.client.queryById(queryId, this.projectName, undefined, true, QUERY_TOP)
    ]);
    const columns = normalizeColumns(queryResult.columns.length > 0 ? queryResult.columns : queryDefinition?.columns);
    const htmlColumns = await this.resolveHtmlColumns(columns);

    // Tree queries return parent/child links in workItemRelations; flat queries
    // return a plain workItems list. OneHop still renders as a flat table.
    const relations = queryResult.workItemRelations ?? [];
    const isTree = queryResult.queryType === QueryType.Tree && relations.length > 0;

    const ids = isTree
      ? relationTargetIds(relations)
      : queryResult.workItems?.length > 0
        ? queryResult.workItems.map((workItem) => workItem.id)
        : queryRelationIds(relations);

    if (ids.length === 0) {
      return {
        columns,
        htmlColumns,
        name: queryDefinition?.name,
        rows: []
      };
    }

    const workItems = await this.client.getWorkItems(
      ids,
      this.projectName,
      columns.map((column) => column.referenceName),
      undefined,
      undefined,
      WorkItemErrorPolicy.Omit
    );
    const workItemsById = new Map(workItems.map((workItem) => [workItem.id, workItem]));
    const rowsById = new Map(
      [...workItemsById.values()].map((workItem) => [workItem.id, toQueryTableRow(workItem, columns)])
    );

    const rows = isTree
      ? buildTreeRows(relations, rowsById)
      : ids
          .map((id) => rowsById.get(id))
          .filter((row): row is QueryTableRow => Boolean(row));

    return {
      columns,
      htmlColumns,
      isTree,
      name: queryDefinition?.name,
      rows
    };
  }

  /** Reference names of the query's columns that hold rich HTML content. */
  private async resolveHtmlColumns(
    columns: readonly QueryTableColumn[]
  ): Promise<ReadonlySet<string>> {
    const fieldTypes = await this.getFieldTypes();
    const htmlColumns = new Set<string>();

    for (const column of columns) {
      const type = fieldTypes.get(column.referenceName);
      if (type === FieldType.Html || type === FieldType.History) {
        htmlColumns.add(column.referenceName);
      }
    }

    return htmlColumns;
  }

  /** Loads (once) a map of field reference name to its data type. */
  private getFieldTypes(): Promise<ReadonlyMap<string, FieldType>> {
    if (!this.fieldTypesPromise) {
      this.fieldTypesPromise = this.client
        .getFields(this.projectName)
        .then((fields) => new Map(fields.map((field) => [field.referenceName, field.type])))
        // Field metadata is best-effort: without it, values fall back to plain text.
        .catch(() => new Map<string, FieldType>());
    }

    return this.fieldTypesPromise;
  }
}

/** Distinct target ids from tree relations, in the query's pre-order sequence. */
function relationTargetIds(relations: readonly WorkItemLink[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();

  for (const relation of relations) {
    const id = relation.target?.id;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

/**
 * Rebuilds the parent/child hierarchy from a tree query's relations. Each link's
 * `source` is the parent (null for roots) and `target` the child; the relations
 * arrive in pre-order, so a parent is always seen before its children.
 */
function buildTreeRows(
  relations: readonly WorkItemLink[],
  rowsById: ReadonlyMap<number, QueryTableRow>
): QueryTableRow[] {
  const nodesById = new Map<number, MutableTreeRow>();
  const roots: MutableTreeRow[] = [];

  const ensureNode = (id: number): MutableTreeRow | undefined => {
    const existing = nodesById.get(id);
    if (existing) {
      return existing;
    }
    const base = rowsById.get(id);
    if (!base) {
      return undefined;
    }
    const node: MutableTreeRow = { id: base.id, values: base.values, children: [] };
    nodesById.set(id, node);
    return node;
  };

  for (const relation of relations) {
    const targetId = relation.target?.id;
    if (!targetId) {
      continue;
    }
    const node = ensureNode(targetId);
    if (!node) {
      continue;
    }

    const parent = relation.source?.id ? ensureNode(relation.source.id) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function queryRelationIds(relations: readonly { source?: { id: number }; target?: { id: number } }[] | undefined): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();

  for (const relation of relations ?? []) {
    for (const id of [relation.source?.id, relation.target?.id]) {
      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

function normalizeColumns(columns: readonly WorkItemFieldReference[] | undefined): readonly QueryTableColumn[] {
  const source = columns && columns.length > 0
    ? columns.map((column) => ({ name: column.name, referenceName: column.referenceName }))
    : DEFAULT_COLUMNS;
  const normalized: QueryTableColumn[] = [];
  const seen = new Set<string>();

  for (const column of source) {
    if (seen.has(column.referenceName)) {
      continue;
    }

    seen.add(column.referenceName);
    normalized.push(column);
  }

  if (!seen.has("System.Id")) {
    normalized.unshift(DEFAULT_COLUMNS[0]);
  }

  return normalized;
}

function toQueryTableRow(workItem: WorkItem, columns: readonly QueryTableColumn[]): QueryTableRow {
  const values = new Map<string, string>();

  for (const column of columns) {
    values.set(column.referenceName, fieldValue(workItem, column.referenceName) ?? "");
  }

  return { id: workItem.id, values };
}

function fieldValue(workItem: WorkItem, referenceName: string): string | undefined {
  if (referenceName === "System.Id") {
    return String(workItem.id);
  }

  return formatFieldValue(workItem.fields?.[referenceName]);
}

function formatFieldValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (typeof value === "object" && "displayName" in value) {
    const displayName = (value as { displayName?: unknown }).displayName;
    return typeof displayName === "string" ? displayName : undefined;
  }

  return String(value);
}

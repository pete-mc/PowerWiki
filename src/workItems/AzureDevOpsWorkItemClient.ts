import { getClient } from "azure-devops-extension-api";
import {
  QueryExpand,
  WorkItemErrorPolicy,
  WorkItemTrackingRestClient,
  type WorkItem,
  type WorkItemFieldReference
} from "azure-devops-extension-api/WorkItemTracking";

export interface QueryTableColumn {
  readonly name: string;
  readonly referenceName: string;
}

export interface QueryTableRow {
  readonly id: number;
  readonly values: ReadonlyMap<string, string>;
}

export interface QueryTableResult {
  readonly columns: readonly QueryTableColumn[];
  readonly name?: string;
  readonly rows: readonly QueryTableRow[];
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
    const ids = queryResult.workItems?.length > 0
      ? queryResult.workItems.map((workItem) => workItem.id)
      : queryRelationIds(queryResult.workItemRelations);

    if (ids.length === 0) {
      return {
        columns,
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
    const rows = ids
      .map((id) => workItemsById.get(id))
      .filter((workItem): workItem is WorkItem => Boolean(workItem))
      .map((workItem) => toQueryTableRow(workItem, columns));

    return {
      columns,
      name: queryDefinition?.name,
      rows
    };
  }
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

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
   * Acceptance Criteria, History). Their markup is flattened to plain text.
   */
  readonly htmlColumns?: ReadonlySet<string>;
  /** True when `rows` is a hierarchy of parent/child work items to render as a tree. */
  readonly isTree?: boolean;
  /** Inline SVG markup for each work item type name, shown before the title. */
  readonly icons?: ReadonlyMap<string, string>;
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
  private typeIconsPromise?: Promise<ReadonlyMap<string, { icon: string; color: string }>>;
  private readonly iconSvgCache = new Map<string, Promise<string | undefined>>();

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

    // Always fetch the work item type so the title can show its icon, even when
    // the type isn't one of the query's visible columns.
    const fields = [...new Set([...columns.map((column) => column.referenceName), "System.WorkItemType"])];
    const workItems = await this.client.getWorkItems(
      ids,
      this.projectName,
      fields,
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

    const typeNames = new Set(
      workItems
        .map((workItem) => fieldValue(workItem, "System.WorkItemType"))
        .filter((type): type is string => Boolean(type))
    );
    const icons = await this.resolveTypeIcons(typeNames);

    return {
      columns,
      htmlColumns,
      icons,
      isTree,
      name: queryDefinition?.name,
      rows
    };
  }

  /** Inline SVG icon markup keyed by work item type name, best-effort. */
  private async resolveTypeIcons(typeNames: ReadonlySet<string>): Promise<ReadonlyMap<string, string>> {
    if (typeNames.size === 0) {
      return new Map();
    }

    const definitions = await this.getTypeIconDefinitions();
    const icons = new Map<string, string>();

    await Promise.all(
      [...typeNames].map(async (typeName) => {
        const definition = definitions.get(typeName);
        if (!definition) {
          return;
        }
        const svg = await this.getIconSvg(definition.icon, definition.color);
        if (svg) {
          icons.set(typeName, svg);
        }
      })
    );

    return icons;
  }

  /** Loads (once) each work item type's icon id and color. */
  private getTypeIconDefinitions(): Promise<ReadonlyMap<string, { icon: string; color: string }>> {
    if (!this.typeIconsPromise) {
      this.typeIconsPromise = this.client
        .getWorkItemTypes(this.projectName)
        .then(
          (types) =>
            new Map(
              types
                .filter((type) => type.icon?.id)
                .map((type) => [type.name, { icon: type.icon.id, color: normalizeIconColor(type.color) }])
            )
        )
        // Icons are decorative: without type metadata the title just has no icon.
        .catch(() => new Map<string, { icon: string; color: string }>());
    }

    return this.typeIconsPromise;
  }

  /** Fetches (once per icon+color) the inline SVG for a work item type icon. */
  private getIconSvg(icon: string, color: string): Promise<string | undefined> {
    const key = `${icon}|${color}`;
    let svg = this.iconSvgCache.get(key);
    if (!svg) {
      svg = this.client
        .getWorkItemIconSvg(icon, color)
        .then((value: unknown) => decodeSvg(value))
        .catch(() => undefined);
      this.iconSvgCache.set(key, svg);
    }
    return svg;
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

  // Keep the type available for the title icon even when it isn't a column.
  if (!values.has("System.WorkItemType")) {
    const type = fieldValue(workItem, "System.WorkItemType");
    if (type) {
      values.set("System.WorkItemType", type);
    }
  }

  return { id: workItem.id, values };
}

/** Azure DevOps returns colors as "RRGGBB" or "#RRGGBB"; the icon API wants no "#". */
function normalizeIconColor(color: string | undefined): string {
  return (color ?? "").replace(/^#/, "");
}

/**
 * The icon endpoint is served as image/svg+xml, which the REST client returns as
 * an ArrayBuffer; decode it (or pass through a string) to the raw SVG markup.
 */
function decodeSvg(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new TextDecoder().decode(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(value as ArrayBufferView);
  }
  return undefined;
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

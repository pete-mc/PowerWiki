// The linked-pages provider for the work item form surface.
//
// Everything here goes through `IWorkItemFormService`, the host service for the
// work item currently on screen. That matters for permissions: the service acts
// on the open form as the signed-in user, so reading and adding links never
// touches the extension's own REST token. PowerWiki therefore needs no
// `vso.work_write` scope for this, and shipping it costs installed
// organisations no administrator re-authorisation.
//
// Adding and removing deliberately leave the form dirty instead of calling
// `save()`. A link added or dropped by accident is then undone the way every
// other work item change is — by discarding it — rather than being committed
// the instant it is clicked.

import * as SDK from "azure-devops-extension-sdk";
import {
  WorkItemTrackingServiceIds,
  type IWorkItemFormService,
} from "azure-devops-extension-api/WorkItemTracking";

import type { LinkedPagesProvider, LinkedWikiPage } from "./WikiHost";
import {
  alreadyLinked,
  linkedWikiPagesFrom,
  wikiPageRelation,
  wikiPageRelationsFor,
} from "./workItemWikiLinks";

export class WorkItemFormLinkedPages implements LinkedPagesProvider {
  private readonly projectId: string;

  public constructor(projectId: string) {
    this.projectId = projectId;
  }

  public async list(): Promise<readonly LinkedWikiPage[]> {
    const service = await formService();
    return linkedWikiPagesFrom(await service.getWorkItemRelations());
  }

  public async add(page: { readonly wikiId: string; readonly path: string }): Promise<void> {
    const service = await formService();

    // Azure DevOps rejects a duplicate relation outright, which would surface as
    // a raw API error; say something useful instead.
    if (alreadyLinked(await service.getWorkItemRelations(), page.path)) {
      throw new Error("That page is already linked to this work item.");
    }

    await service.addWorkItemRelations([
      wikiPageRelation({ projectId: this.projectId, wikiId: page.wikiId, path: page.path })
    ]);
  }

  public async remove(page: { readonly path: string }): Promise<void> {
    const service = await formService();

    // Read the relations back and remove the objects the service itself
    // reported. `removeWorkItemRelations` matches what it is handed against the
    // form's own list, and a relation rebuilt from the path would differ in any
    // attribute the service had added — so removal would silently do nothing.
    const relations = wikiPageRelationsFor(await service.getWorkItemRelations(), page.path);
    if (relations.length === 0) {
      // Already gone: someone removed it on the Links tab, or two rails are
      // open on the same item. Saying so beats a no-op that looks like a bug.
      throw new Error("That page is no longer linked to this work item.");
    }

    await service.removeWorkItemRelations(relations);
  }
}

function formService(): Promise<IWorkItemFormService> {
  return SDK.getService<IWorkItemFormService>(WorkItemTrackingServiceIds.WorkItemFormService);
}

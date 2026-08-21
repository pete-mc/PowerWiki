// Resolves the identity GUIDs used by `@<guid>` wiki mentions to display names.
//
// This deliberately goes through the host's identity service contribution
// (`ms.vss-features.identity-service`, the same service the Azure DevOps people
// picker uses) rather than the Identities/Graph REST APIs. The host runs the
// lookup in the parent frame under the signed-in user's own session, so mentions
// resolve without PowerWiki requesting the `vso.identity` or `vso.graph` scopes
// — adding a scope would park the extension in "Pending review" until an org
// admin re-approved it.

import * as SDK from "azure-devops-extension-sdk";

const IDENTITY_SERVICE_ID = "ms.vss-features.identity-service";

export interface MentionIdentity {
  readonly id: string;
  readonly displayName: string;
  /** Sign-in address / mail, when the host returns one. */
  readonly uniqueName?: string;
}

/**
 * The runtime shape of an identity-picker entity. The SDK's IIdentity type only
 * declares the four routing fields; the host also returns the display fields
 * below, which are what we actually need.
 */
interface HostIdentity {
  readonly displayName?: string;
  readonly entityId?: string;
  readonly localId?: string;
  readonly mail?: string;
  readonly signInAddress?: string;
}

interface HostIdentityService {
  searchIdentitiesAsync(
    query: string,
    identityTypes?: string[],
    operationScopes?: string[],
    queryTypeHint?: string,
    options?: unknown
  ): Promise<HostIdentity[]>;
}

/**
 * Trims the scope Azure DevOps prefixes onto group names — a team comes back as
 * `[project]\Team Name`. People have no prefix, so this only affects groups, and
 * "@Team Name" is what a reader expects to see in a sentence.
 */
export function normalizeIdentityName(displayName: string | undefined): string {
  return (displayName ?? "").replace(/^\[[^\]]*\]\\/, "").trim();
}

export class AzureDevOpsIdentityClient {
  private servicePromise: Promise<HostIdentityService | undefined> | undefined;

  /**
   * Looks up one mention identity. Rejects when the name can't be resolved, so
   * callers can cache the failure and leave the mention in its fallback state.
   */
  public async getMentionIdentity(id: string): Promise<MentionIdentity> {
    // The signed-in user is already in the SDK context, so self-mentions resolve
    // even if the host service is unreachable.
    const currentUser = this.getCurrentUser();
    if (currentUser && currentUser.id?.toLowerCase() === id.toLowerCase() && currentUser.displayName) {
      return { id, displayName: currentUser.displayName };
    }

    const service = await this.getService();
    if (!service) {
      throw new Error("The Azure DevOps identity service is unavailable.");
    }

    // "uid" tells the picker the query is an identity id rather than a name, and
    // the "ims"/"source" scopes cover both Azure DevOps-local and directory
    // identities. Groups are included so team mentions resolve too.
    const matches = await service.searchIdentitiesAsync(id, ["user", "group"], ["ims", "source"], "uid");
    const match = matches?.[0];
    const displayName = normalizeIdentityName(match?.displayName);
    if (!displayName) {
      throw new Error(`No identity found for ${id}.`);
    }

    return {
      id,
      displayName,
      uniqueName: match?.signInAddress ?? match?.mail
    };
  }

  /**
   * People and teams whose name starts with (or contains) `query`.
   *
   * Same service and same call as `getMentionIdentity`, minus the "uid" hint —
   * that hint is what tells the picker the query is an identity id rather than a
   * name, so omitting it is the whole difference between resolving a mention and
   * searching for one.
   *
   * Groups are included so teams can be mentioned, which is what the built-in
   * wiki offers. `normalizeIdentityName` strips the `[project]\` prefix Azure
   * DevOps puts on group names, so a team reads as "@Team Name" in a sentence.
   */
  public async searchIdentities(query: string): Promise<readonly MentionIdentity[]> {
    const term = query.trim();
    if (!term) {
      return [];
    }

    const service = await this.getService();
    if (!service) {
      throw new Error("The Azure DevOps identity service is unavailable.");
    }

    const matches = await service.searchIdentitiesAsync(term, ["user", "group"], ["ims", "source"]);
    const identities: MentionIdentity[] = [];
    for (const match of matches ?? []) {
      // The mention format stores an id, so a match without one cannot be
      // written and is dropped rather than offered and found to do nothing.
      const id = match.localId ?? match.entityId;
      const displayName = normalizeIdentityName(match.displayName);
      if (!id || !displayName) {
        continue;
      }
      identities.push({ id, displayName, uniqueName: match.signInAddress ?? match.mail });
    }
    return identities;
  }

  private getCurrentUser(): { id?: string; displayName?: string } | undefined {
    try {
      return SDK.getUser();
    } catch {
      // Rendering outside a fully initialized host (tests, exports).
      return undefined;
    }
  }

  private getService(): Promise<HostIdentityService | undefined> {
    // Cached because getService round-trips to the host frame; a page full of
    // mentions should negotiate the service once.
    this.servicePromise ??= SDK.getService<HostIdentityService>(IDENTITY_SERVICE_ID).catch(() => undefined);
    return this.servicePromise;
  }
}

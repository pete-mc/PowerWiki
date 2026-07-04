// Follow / unfollow a wiki page via Azure DevOps notification subscriptions —
// the same artifact-subscription contract the built-in wiki's Follow button
// uses (captured from its network traffic):
//
//   state:    POST  _apis/notification/SubscriptionQuery
//   follow:   POST  _apis/notification/Subscriptions
//   unfollow: DELETE _apis/notification/Subscriptions/{id}
//
// The artifact id is "{projectId}/{wikiId}/{pageId}" with artifactType
// "WikiPageId". Requires the vso.notification_write scope.

import { getClient } from "azure-devops-extension-api/Common";
import { NotificationRestClient } from "azure-devops-extension-api/Notification";

export interface WikiPageFollowTarget {
  readonly projectId: string;
  readonly wikiId: string;
  readonly pageId: number;
  readonly userId: string;
}

interface SubscriptionSummary {
  readonly id: string;
}

class NotificationJsonClient extends NotificationRestClient {
  public querySubscriptionsRaw(body: unknown): Promise<SubscriptionSummary[]> {
    return this.beginRequest<SubscriptionSummary[]>({
      apiVersion: "7.1-preview.1",
      method: "POST",
      routeTemplate: "_apis/notification/SubscriptionQuery",
      body,
    });
  }

  public createSubscriptionRaw(body: unknown): Promise<SubscriptionSummary> {
    return this.beginRequest<SubscriptionSummary>({
      apiVersion: "7.1-preview.1",
      method: "POST",
      routeTemplate: "_apis/notification/Subscriptions",
      body,
    });
  }

  public deleteSubscriptionRaw(subscriptionId: string): Promise<void> {
    return this.beginRequest<void>({
      apiVersion: "7.1-preview.1",
      method: "DELETE",
      routeTemplate: "_apis/notification/Subscriptions/{subscriptionId}",
      routeValues: { subscriptionId },
    });
  }
}

function artifactFilter(target: WikiPageFollowTarget) {
  return {
    artifactId: `${target.projectId}/${target.wikiId}/${target.pageId}`,
    artifactType: "WikiPageId",
    type: "Artifact",
  };
}

export class WikiFollowClient {
  private readonly client = getClient(NotificationJsonClient);

  /** Returns the follow subscription's id when the user follows the page. */
  public async getFollowSubscription(target: WikiPageFollowTarget): Promise<string | undefined> {
    const subscriptions = await this.client.querySubscriptionsRaw({
      conditions: [{ filter: artifactFilter(target), subscriberId: target.userId }],
      queryFlags: 0,
    });
    return subscriptions[0]?.id;
  }

  /** Follows the page; returns the created subscription id. */
  public async follow(target: WikiPageFollowTarget): Promise<string> {
    const created = await this.client.createSubscriptionRaw({
      description: "",
      filter: artifactFilter(target),
      statusMessage: "",
      subscriber: target.userId,
      url: "",
    });
    return created.id;
  }

  public async unfollow(subscriptionId: string): Promise<void> {
    await this.client.deleteSubscriptionRaw(subscriptionId);
  }
}

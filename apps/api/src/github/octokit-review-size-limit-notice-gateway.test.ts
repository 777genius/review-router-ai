import { describe, expect, it } from "vitest";
import { OctokitReviewSizeLimitNoticeGateway } from "./octokit-review-size-limit-notice-gateway.js";
import {
  renderReviewSizeLimitNotice,
  reviewSizeLimitNoticeMarker,
} from "../review-size-limit-notice.js";

const bot = "reviewrouter-app[bot]";
const notice = {
  githubInstallationId: "789",
  repositoryFullName: "acme/app",
  pullRequestNumber: 1192,
  headSha: "63927aec".padEnd(40, "0"),
  changedLines: 1_912_457,
  maxChangedLines: 250_000,
};

describe("OctokitReviewSizeLimitNoticeGateway", () => {
  it("posts one plain notice with the real numbers and the setting name", async () => {
    const github = new FakeComments();

    await gateway(github).publish(notice);

    expect(github.writes).toEqual(["POST"]);
    const body = github.comments[0]!.body;
    expect(body).toContain("1,912,457 lines");
    expect(body).toContain("the limit is 250,000");
    expect(body).toContain("`REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES`");
    expect(body).not.toContain("REVIEW_ROUTER_MAX_CHANGED_LINES`");
    expect(body).toContain("Checked commit `63927aec0000`");
    expect(body.endsWith(reviewSizeLimitNoticeMarker)).toBe(true);
  });

  it("rewrites its own newest notice, even past the first 100 comments", async () => {
    const github = new FakeComments();
    const older = github.add(bot, `old\n${reviewSizeLimitNoticeMarker}`);
    for (let index = 0; index < 150; index += 1) {
      github.add("someone-else", `comment ${index}`);
    }
    github.add("someone-else", `quoted\n${reviewSizeLimitNoticeMarker}`);
    const newest = github.add(bot, `stale\n${reviewSizeLimitNoticeMarker}`);

    await gateway(github).publish(notice);

    expect(github.writes).toEqual([`PATCH ${newest}`]);
    expect(github.byId(newest).body).toBe(renderReviewSizeLimitNotice(notice));
    expect(github.byId(older).body).toBe(`old\n${reviewSizeLimitNoticeMarker}`);
  });

  it("does not write again when the notice is already current", async () => {
    const github = new FakeComments();
    github.add(bot, renderReviewSizeLimitNotice(notice));

    await gateway(github).publish(notice);

    expect(github.writes).toEqual([]);
  });
});

function gateway(github: FakeComments) {
  return new OctokitReviewSizeLimitNoticeGateway({
    app: {
      octokit: {
        async request(route: string) {
          if (route !== "GET /app") throw new Error(`unexpected ${route}`);
          return { data: { slug: "ReviewRouter-App" } };
        },
      },
      getInstallationOctokit: (installationId: number) => {
        expect(installationId).toBe(789);
        return github;
      },
    },
  });
}

class FakeComments {
  readonly comments: { id: number; body: string; user: { login: string } }[] =
    [];
  readonly writes: string[] = [];
  private nextId = 1;

  add(login: string, body: string): number {
    const id = this.nextId++;
    this.comments.push({ id, body, user: { login } });
    return id;
  }

  byId(id: number) {
    return this.comments.find((comment) => comment.id === id)!;
  }

  async request(route: string, parameters: Record<string, unknown> = {}) {
    expect(parameters).toMatchObject({ owner: "acme", repo: "app" });
    switch (route) {
      case "GET /repos/{owner}/{repo}/issues/{issue_number}/comments": {
        expect(parameters.issue_number).toBe(1192);
        const start = ((parameters.page as number) - 1) * 100;
        return {
          data: structuredClone(this.comments.slice(start, start + 100)),
        };
      }
      case "POST /repos/{owner}/{repo}/issues/{issue_number}/comments":
        this.writes.push("POST");
        this.add(bot, parameters.body as string);
        return { data: {} };
      case "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}": {
        const id = parameters.comment_id as number;
        this.writes.push(`PATCH ${id}`);
        this.byId(id).body = parameters.body as string;
        return { data: {} };
      }
      default:
        throw new Error(`unexpected ${route}`);
    }
  }
}

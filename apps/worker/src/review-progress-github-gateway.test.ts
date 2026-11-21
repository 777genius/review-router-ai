import { describe, expect, it, vi } from "vitest";
import { publicationRetryPlan } from "./review-progress-publication-retry-policy";
import {
  ReviewProgressGitHubError,
  ReviewProgressGitHubGateway,
  createReviewProgressMarker,
  formatReviewProgressComment,
  type ReviewProgressGitHubRequester,
} from "./review-progress-github-gateway";

const head = "a".repeat(40);
const marker = createReviewProgressMarker("review-42");

describe("ReviewProgressGitHubGateway", () => {
  it("formats exactly one stable marker", () => {
    expect(
      formatReviewProgressComment(`working\n${marker}\n${marker}`, marker),
    ).toBe(`working\n\n${marker}`);
  });

  it("patches the existing marked comment", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 8,
      operation: "updated",
      duplicateCommentIds: [],
    });
    expect(fixture.calls).toContainEqual({
      route: "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
      parameters: expect.objectContaining({
        comment_id: 8,
        body: `working\n\n${marker}`,
      }),
    });
  });

  it("creates a comment when the marker does not exist", async () => {
    const fixture = githubFixture([]);

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 100,
      operation: "created",
      duplicateCommentIds: [],
    });
    expect(fixture.calls.at(-1)).toEqual({
      route: "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      parameters: expect.objectContaining({
        issue_number: 42,
        body: `working\n\n${marker}`,
      }),
    });
  });

  it("reconciles a foreign POST reply", async () => {
    const fixture = githubFixture([]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (!route.startsWith("POST ")) return response;
      return {
        ...response,
        data: {
          ...(response.data as Record<string, unknown>),
          issue_url: "https://api.github.com/repos/acme/rocket/issues/43",
        },
      };
    };

    await expect(gateway(request).upsert(input())).resolves.toEqual({
      commentId: 100,
      operation: "reconciled",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toHaveLength(1);
  });

  it("reconciles a timed-out POST when the marked comment appeared", async () => {
    const fixture = githubFixture([], { throwAfterPost: true });

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 100,
      operation: "reconciled",
      duplicateCommentIds: [],
    });
    expect(
      fixture.calls.filter(({ route }) => route.startsWith("GET ")),
    ).toHaveLength(6);
  });

  it("does not confirm a landed POST when the head changes during the final scan", async () => {
    const fixture = githubFixture([], { throwAfterPost: true });
    const pullRoute = "GET /repos/{owner}/{repo}/pulls/{pull_number}";
    let pullReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route !== pullRoute) return response;
      pullReads += 1;
      if (pullReads !== 4) return response;
      return {
        ...response,
        data: {
          ...(response.data as Record<string, unknown>),
          head: { sha: "b".repeat(40) },
        },
      };
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { mutationMayHaveLanded: true, retryable: true },
    });
    expect(pullReads).toBe(4);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    ]);
  });

  it("does not confirm a possibly landed POST after the pull head changes", async () => {
    const fixture = githubFixture([], { throwAfterPost: true });
    let pullReads = 0;
    const pullRoute = "GET /repos/{owner}/{repo}/pulls/{pull_number}";
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route !== pullRoute) return response;
      pullReads += 1;
      if (pullReads !== 3) return response;
      return {
        ...response,
        data: {
          ...(response.data as Record<string, unknown>),
          head: { sha: "b".repeat(40) },
        },
      };
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { mutationMayHaveLanded: true, retryable: true },
    });
    expect(pullReads).toBe(3);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    ]);
  });

  it("reconciles a PATCH with no response comment", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      return route.startsWith("PATCH ")
        ? { ...response, data: null }
        : response;
    };

    await expect(gateway(request).upsert(input())).resolves.toEqual({
      commentId: 8,
      operation: "reconciled",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toHaveLength(1);
  });

  it("reconciles a timed-out PATCH when the marked comment was updated", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }], {
      throwAfterPatch: true,
    });

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 8,
      operation: "reconciled",
      duplicateCommentIds: [],
    });
  });

  it("rejects a failed PATCH when only a duplicate has the desired body", async () => {
    const fixture = githubFixture(
      [
        { id: 4, body: `old\n${marker}` },
        { id: 7, body: formatReviewProgressComment("working", marker) },
      ],
      { throwBeforePatch: true },
    );

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 4 }),
      }),
    ]);
  });

  it("patches only the canonical comment and defers every duplicate", async () => {
    const fixture = githubFixture(
      [
        { id: 9, body: `later\n${marker}` },
        { id: 4, body: `first\n${marker}` },
        { id: 7, body: `middle\n${marker}` },
      ],
      { deleteFailureId: 9 },
    );

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 4,
      operation: "updated",
      duplicateCommentIds: [7, 9],
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 4 }),
      }),
    ]);
  });

  it("deletes exactly one duplicate when the canonical body is already desired", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([
      { id: 4, body: desired },
      { id: 7, body: `duplicate one\n${marker}` },
      { id: 9, body: `duplicate two\n${marker}` },
    ]);

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 4,
      operation: "duplicate_deleted",
      duplicateCommentIds: [9],
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 7 }),
      }),
    ]);
  });

  it("rechecks the PR head before deleting a duplicate", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture(
      [
        { id: 4, body: desired },
        { id: 7, body: `duplicate\n${marker}` },
      ],
      { staleHeadAfterFirstRead: true },
    );

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "stale_head",
      metadata: { retryable: false },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("performs no mutation when the canonical body is desired and unique", async () => {
    const fixture = githubFixture([
      { id: 4, body: formatReviewProgressComment("working", marker) },
    ]);

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 4,
      operation: "unchanged",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("does not clean up duplicates while reconciling an ambiguous PATCH", async () => {
    const fixture = githubFixture(
      [
        { id: 4, body: `old\n${marker}` },
        { id: 7, body: `duplicate\n${marker}` },
      ],
      { throwAfterPatch: true },
    );

    await expect(gateway(fixture.request).upsert(input())).resolves.toEqual({
      commentId: 4,
      operation: "reconciled",
      duplicateCommentIds: [7],
    });
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("ignores a spoofed marker from another user", async () => {
    const fixture = githubFixture([
      { id: 3, body: `spoof\n${marker}`, authorLogin: "mallory" },
    ]);

    await expect(
      gateway(fixture.request).upsert(input()),
    ).resolves.toMatchObject({
      commentId: 100,
      operation: "created",
    });
    expect(
      fixture.calls.some(
        ({ route, parameters }) =>
          route.startsWith("PATCH ") && parameters.comment_id === 3,
      ),
    ).toBe(false);
    expect(fixture.calls.some(({ route }) => route.startsWith("DELETE "))).toBe(
      false,
    );
  });

  it("discovers a marked comment on page two without creating another", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        body: "unrelated",
        user: { login: "review-router[bot]" },
      })),
      [
        {
          id: 701,
          body: desired,
          user: { login: "review-router[bot]" },
        },
      ],
    ];
    const calls: Array<{
      route: string;
      parameters: Readonly<Record<string, unknown>>;
    }> = [];
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters = {},
    ) => {
      calls.push({ route, parameters });
      if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}") {
        return {
          data: {
            state: "open",
            head: { sha: head },
            base: { repo: { full_name: "acme/rocket" } },
          },
        };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        return { data: pages[Number(parameters.page) - 1] ?? [] };
      }
      throw new Error(`unexpected_route:${route}`);
    };

    await expect(
      gateway(request, { maxCommentPages: 2 }).upsert(input()),
    ).resolves.toEqual({
      commentId: 701,
      operation: "unchanged",
      duplicateCommentIds: [],
    });
    expect(
      calls
        .filter(
          ({ route }) =>
            route ===
            "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        )
        .map(({ parameters }) => parameters.page),
    ).toEqual([1, 2, 1]);
    expect(mutations(calls)).toEqual([]);
  });

  it("continues past a first-only Link to find a marked second page", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [firstPage, [{ id: 701, body: desired }]],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="first"',
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
      ],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).resolves.toEqual({
      commentId: 701,
      operation: "unchanged",
      duplicateCommentIds: [],
    });
    expect(
      fixture.calls
        .filter(
          ({ route }) =>
            route ===
            "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
        )
        .map(({ parameters }) => parameters.page),
    ).toEqual([1, 2, 1]);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("does not trust a foreign issue's last-page Link before POST", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [firstPage],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/43/comments?page=1&per_page=100>; rel="last"',
      ],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("accepts GitHub's verified numeric repository pagination Link", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([], {
      pagedComments: [full, [{ id: 701, body: desired }]],
      pageLinks: [
        '<https://api.github.com/repositories/1300192/issues/42/comments?page=2&per_page=100>; rel="next"',
      ],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).resolves.toMatchObject({ commentId: 701, operation: "unchanged" });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("rejects another numeric repository's pagination Link", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [full],
      pageLinks: [
        '<https://api.github.com/repositories/1300193/issues/42/comments?page=1&per_page=100>; rel="last"',
      ],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("continues after a full previous-only page to find the marker", async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([], {
      pagedComments: [full, full, [{ id: 701, body: desired }]],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
      ],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 3 }).upsert(input()),
    ).resolves.toMatchObject({ commentId: 701, operation: "unchanged" });
    expect(
      fixture.calls
        .filter(({ route }) =>
          route.includes("/issues/{issue_number}/comments"),
        )
        .map(({ parameters }) => parameters.page),
    ).toEqual([1, 2, 3, 1, 2]);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers a capped full page despite a backward Link", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const lastPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 101,
      body: index === 0 ? desired : "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [firstPage, lastPage],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
      ],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    const commentListRoute =
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
    const pageNumbers = fixture.calls
      .filter(({ route }) => route === commentListRoute)
      .map(({ parameters }) => parameters.page);
    expect(pageNumbers).toEqual([1, 2]);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers deletion-shifted full final pages before POST", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    // Comment 101 was the only marked comment, but deleting an earlier row
    // before the second GET moves it into the skipped offset.
    const secondPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 102,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [firstPage, secondPage],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
      ],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers a short final page when an earlier deletion shifts the offset", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const secondPage = Array.from({ length: 99 }, (_, index) => ({
      id: index + 102,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [firstPage, secondPage],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
      ],
    });
    let firstPageReads = 0;
    const route = "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
    const request: ReviewProgressGitHubRequester = async (path, parameters) => {
      const response = await fixture.request(path, parameters);
      if (path === route && parameters?.page === 1) {
        firstPageReads += 1;
        if (firstPageReads === 2) {
          return {
            ...response,
            data: [
              ...(response.data as unknown[]).slice(1),
              {
                id: 101,
                body: `hidden\n${marker}`,
                user: { login: "review-router[bot]" },
              },
            ],
          };
        }
      }
      return response;
    };

    await expect(
      gateway(request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(firstPageReads).toBe(2);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("blocks known-ID fallback on offset drift", async () => {
    const known = { id: 101, body: `old\n${marker}` };
    const duplicate = { id: 102, body: `duplicate\n${marker}` };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([known, duplicate], {
      pagedComments: [firstPage, [duplicate]],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
      ],
    });
    const listRoute =
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
    let firstPageReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route === listRoute && parameters?.page === 1) {
        firstPageReads += 1;
        if (firstPageReads === 2) {
          return {
            ...response,
            data: [
              ...(response.data as unknown[]).slice(1),
              { ...known, user: { login: "review-router[bot]" } },
            ],
          };
        }
      }
      return response;
    };

    await expect(
      gateway(request, { maxCommentPages: 2 }).upsert({
        ...input(),
        knownCommentId: 101,
      }),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      message: "github_issue_comments_offset_changed",
      metadata: { retryable: true },
    });
    expect(firstPageReads).toBe(2);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("rejects PATCH reconciliation after offset drift", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }], {
      throwAfterPatch: true,
    });
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const listRoute =
      "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
    let listReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route !== listRoute) return response;
      listReads += 1;
      if (listReads === 2 || listReads === 4) {
        return {
          data:
            listReads === 2
              ? firstPage
              : [...firstPage.slice(1), { id: 101, body: "new" }],
          headers: {
            link: '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
          },
        };
      }
      if (listReads === 3) {
        return {
          data: [
            {
              id: 102,
              body: `duplicate\n${marker}`,
              user: { login: "review-router[bot]" },
            },
          ],
          headers: {
            link: '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"',
          },
        };
      }
      return response;
    };

    await expect(
      gateway(request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      message: "github_issue_comments_offset_changed",
      metadata: { mutationMayHaveLanded: true, retryable: true },
    });
    expect(listReads).toBe(4);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("rejects known-ID fallback for an untrusted Link", async () => {
    const known = { id: 101, body: `old\n${marker}` };
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([known], {
      pagedComments: [firstPage],
      pageLinks: [
        '<https://api.github.com/repos/other/repo/issues/42/comments?page=2&per_page=100>; rel="next"',
      ],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 101,
      }),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("checks the final page from a last-only Link before duplicate cleanup", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const canonical = { id: 4, body: desired };
    const duplicate = { id: 7, body: `duplicate\n${marker}` };
    const last =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="last"';
    const fixture = githubFixture([canonical, duplicate], {
      pagedComments: [[canonical], [duplicate]],
      pageLinks: [last, last],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).resolves.toEqual({
      commentId: 4,
      operation: "duplicate_deleted",
      duplicateCommentIds: [],
    });
    expect(
      fixture.calls
        .filter(({ route }) =>
          route.includes("/issues/{issue_number}/comments"),
        )
        .map(({ parameters }) => parameters.page),
    ).toEqual([1, 2, 1]);
    expect(mutations(fixture.calls)).toHaveLength(1);
  });

  it("retains an earlier last-page hint when middle pages only link backward", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const canonical = { id: 4, body: desired };
    const duplicate = { id: 7, body: `duplicate\n${marker}` };
    const last =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=3&per_page=100>; rel="last"';
    const previous =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="prev"';
    const fixture = githubFixture([canonical, duplicate], {
      pagedComments: [[canonical], [], [duplicate]],
      pageLinks: [last, previous, previous],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 3 }).upsert(input()),
    ).resolves.toEqual({
      commentId: 4,
      operation: "duplicate_deleted",
      duplicateCommentIds: [],
    });
    expect(
      fixture.calls
        .filter(({ route }) =>
          route.includes("/issues/{issue_number}/comments"),
        )
        .map(({ parameters }) => parameters.page),
    ).toEqual([1, 2, 3, 1, 2]);
    expect(mutations(fixture.calls)).toHaveLength(1);
  });

  it("defers an unclassifiable marked comment instead of hiding a duplicate", async () => {
    const fixture = githubFixture([]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route.includes("/issues/{issue_number}/comments")) {
        return {
          data: [
            {
              id: 7,
              body: `unclassified\n${marker}`,
            },
          ],
        };
      }
      return response;
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers null comment rows before creating a duplicate", async () => {
    const fixture = githubFixture([]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        return { data: [null] };
      }
      return response;
    };
    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers an expected-bot comment whose body cannot be read", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([{ id: 8, body: desired }]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route.includes("/issues/{issue_number}/comments")) {
        return {
          data: [
            { id: 8, body: desired, user: { login: "review-router[bot]" } },
            { id: 9, user: { login: "review-router[bot]" } },
          ],
        };
      }
      return response;
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers when an unknown comment has no readable body or author", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([{ id: 8, body: desired }]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route.includes("/issues/{issue_number}/comments")) {
        return {
          data: [
            { id: 8, body: desired, user: { login: "review-router[bot]" } },
            { id: 9 },
          ],
        };
      }
      return response;
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("ignores unreadable bodies from verified foreign authors", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([{ id: 8, body: desired }]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      const response = await fixture.request(route, parameters);
      if (route.includes("/issues/{issue_number}/comments")) {
        return {
          data: [
            { id: 8, body: desired, user: { login: "review-router[bot]" } },
            { id: 9, user: { login: "other[bot]" } },
          ],
        };
      }
      return response;
    };

    await expect(gateway(request).upsert(input())).resolves.toMatchObject({
      commentId: 8,
      operation: "unchanged",
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("keeps the cap fail-closed when a full final page links onward", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [fullPage],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next"',
      ],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("does not trust unparseable pagination links on a full final page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture([], {
      pagedComments: [fullPage],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next',
      ],
    });
    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert(input()),
    ).rejects.toMatchObject({ kind: "pagination_inconclusive" });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("defers a marked final page with a malformed Link target", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([{ id: 19, body: desired }], {
      pagedComments: [[{ id: 19, body: desired }]],
      pageLinks: ['<not a URL>; rel="prev"'],
    });
    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("refuses untrusted pagination links before duplicate deletion", async () => {
    const canonical = {
      id: 19,
      body: formatReviewProgressComment("working", marker),
    };
    const duplicate = { id: 20, body: `duplicate\n${marker}` };
    for (const href of [
      "javascript:alert(1)",
      "blob:https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100",
      "data:text/plain,abc",
      "ftp://api.github.com/comments?page=2&per_page=100",
      "http://api.github.com/comments?page=2&per_page=100",
      "https://untrusted.example/comments?page=2&per_page=100",
      "//untrusted.example/comments?page=2&per_page=100",
    ]) {
      const fixture = githubFixture([canonical, duplicate], {
        pagedComments: [[canonical, duplicate]],
        pageLinks: [`<${href}>; rel="prev"`],
      });
      await expect(
        gateway(fixture.request).upsert(input()),
      ).rejects.toMatchObject({
        kind: "pagination_inconclusive",
        metadata: { retryable: true },
      });
      expect(mutations(fixture.calls)).toEqual([]);
    }
  });

  it("defers contradictory last-page links before mutating comments", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const canonical = { id: 19, body: desired };
    const conflict =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="last", ' +
      "<https://api.github.com/repos/acme/rocket/issues/42/comments?page=3&per_page=100>; rel=last";
    const fixture = githubFixture([canonical], {
      pagedComments: [[canonical]],
      pageLinks: [conflict],
    });
    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("does not mutate when next contradicts the advertised final page", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const invalid =
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next", ' +
      '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=1&per_page=100>; rel="last"';
    const fixture = githubFixture([{ id: 19, body: desired }], {
      pagedComments: [[{ id: 19, body: desired }]],
      pageLinks: [invalid],
    });
    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("rejects malformed Link on a short page", async () => {
    const markedComment = {
      id: 19,
      body: formatReviewProgressComment("working", marker),
    };
    const fixture = githubFixture([], {
      pagedComments: [[markedComment]],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next',
      ],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("rejects invalid first-page Link before scanning page two", async () => {
    const marked = { id: 19, body: `old\n${marker}` };
    const fixture = githubFixture([], {
      pagedComments: [[marked], []],
      pageLinks: [
        '<https://api.github.com/repos/acme/rocket/issues/42/comments?page=2&per_page=100>; rel="next',
      ],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
    const commentReads = fixture.calls.filter(({ route }) =>
      route.includes("/issues/{issue_number}/comments"),
    );
    expect(commentReads).toHaveLength(1);
  });
  it("rejects empty Link on a short page", async () => {
    const markedComment = {
      id: 19,
      body: formatReviewProgressComment("working", marker),
    };
    const fixture = githubFixture([], {
      pagedComments: [[markedComment]],
      pageLinks: [""],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("refuses to POST when the bounded scan is inconclusive", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture(fullPage);

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert(input()),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(fixture.calls.some(({ route }) => route.startsWith("POST "))).toBe(
      false,
    );
  });

  it("rechecks pages before capped known-ID recovery", async () => {
    const firstPage = fullUnrelatedPage();
    const secondPage = firstPage.map((row) => ({ ...row, id: row.id + 100 }));
    const fixture = githubFixture([{ id: 900, body: `old\n${marker}` }], {
      pagedComments: [firstPage, secondPage],
    });

    await expect(
      gateway(fixture.request, { maxCommentPages: 2 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).resolves.toMatchObject({ commentId: 900, operation: "updated" });
    const pageReads = fixture.calls
      .filter(({ route }) => route.includes("/issues/{issue_number}/comments"))
      .map(({ parameters }) => parameters.page);
    expect(pageReads).toEqual([1, 2, 1]);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("blocks capped recovery after an earlier deletion", async () => {
    const firstPage = fullUnrelatedPage();
    const secondPage = firstPage.map((row) => ({ ...row, id: row.id + 100 }));
    const fixture = githubFixture([{ id: 900, body: `old\n${marker}` }], {
      pagedComments: [firstPage, secondPage],
    });
    const route = "GET /repos/{owner}/{repo}/issues/{issue_number}/comments";
    let firstPageReads = 0;
    const request: ReviewProgressGitHubRequester = async (path, parameters) => {
      const response = await fixture.request(path, parameters);
      if (path !== route || parameters?.page !== 1) return response;
      firstPageReads += 1;
      if (firstPageReads !== 2) return response;
      return {
        ...response,
        data: [
          ...(response.data as unknown[]).slice(1),
          { id: 101, body: "shifted", user: { login: "other" } },
        ],
      };
    };

    await expect(
      gateway(request, { maxCommentPages: 2 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      message: "github_issue_comments_offset_changed",
    });
    expect(firstPageReads).toBe(2);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("recovers the persisted known comment id before relying on the bounded scan", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture(
      [...fullPage, { id: 900, body: `known\n${marker}` }],
      { listedComments: fullPage },
    );

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).resolves.toMatchObject({ commentId: 900, operation: "updated" });
    expect(
      fixture.calls.some(
        ({ route, parameters }) =>
          route === "GET /repos/{owner}/{repo}/issues/comments/{comment_id}" &&
          parameters.comment_id === 900,
      ),
    ).toBe(true);
    expect(fixture.calls.some(({ route }) => route.startsWith("POST "))).toBe(
      false,
    );
  });

  it("keeps an unchanged known comment on a busy PR without deleting unseen duplicates", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture(
      [
        ...fullPage,
        { id: 900, body: formatReviewProgressComment("working", marker) },
        { id: 901, body: `hidden duplicate\n${marker}` },
      ],
      { listedComments: fullPage },
    );

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).resolves.toEqual({
      commentId: 900,
      operation: "unchanged",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("keeps a busy-PR scan inconclusive when the known comment is gone", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture(fullPage, { listedComments: fullPage });

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).rejects.toMatchObject({
      kind: "pagination_inconclusive",
      metadata: { retryable: true },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("confirms a landed busy-PR PATCH through the known comment", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture(
      [...fullPage, { id: 900, body: `known\n${marker}` }],
      { listedComments: fullPage, throwAfterPatch: true },
    );

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).resolves.toEqual({
      commentId: 900,
      operation: "reconciled",
      duplicateCommentIds: [],
    });
  });

  it("does not reconcile a busy-PR PATCH after the head changes during known-ID lookup", async () => {
    const fullPage = fullUnrelatedPage();
    const fixture = githubFixture(
      [...fullPage, { id: 900, body: `known\n${marker}` }],
      { listedComments: fullPage, throwAfterPatch: true },
    );
    const knownRoute = "GET /repos/{owner}/{repo}/issues/comments/{comment_id}";
    const pullRoute = "GET /repos/{owner}/{repo}/pulls/{pull_number}";
    let patchFailed = false;
    let observedAfterPatch = false;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      try {
        const response = await fixture.request(route, parameters);
        if (patchFailed && route === knownRoute) observedAfterPatch = true;
        if (!observedAfterPatch || route !== pullRoute) return response;
        return {
          ...response,
          data: {
            ...(response.data as Record<string, unknown>),
            head: { sha: "b".repeat(40) },
          },
        };
      } catch (error) {
        if (route.startsWith("PATCH ")) patchFailed = true;
        throw error;
      }
    };

    await expect(
      gateway(request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { mutationMayHaveLanded: true, retryable: true },
    });
    expect(observedAfterPatch).toBe(true);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("keeps a short ambiguous retry for an unconfirmed busy-PR PATCH", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      body: "unrelated",
    }));
    const fixture = githubFixture(
      [...fullPage, { id: 900, body: `known\n${marker}` }],
      { listedComments: fullPage, throwBeforePatch: true },
    );

    await expect(
      gateway(fixture.request, { maxCommentPages: 1 }).upsert({
        ...input(),
        knownCommentId: 900,
      }),
    ).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { retryable: true, mutationMayHaveLanded: true },
    });
  });

  it("does not treat a definite PATCH 422 as a possibly landed write", async () => {
    const fixture = githubFixture([{ id: 9, body: `old\n${marker}` }]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) throw { status: 422 };
      return fixture.request(route, parameters);
    };

    const error = await gateway(request)
      .upsert(input())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { status: 422, retryable: true },
    });
    expect(
      (error as ReviewProgressGitHubError).metadata.mutationMayHaveLanded,
    ).toBeUndefined();
  });

  it("prioritizes a verified known comment over an earlier match", async () => {
    const fixture = githubFixture([
      { id: 4, body: `older\n${marker}` },
      { id: 9, body: `known\n${marker}` },
    ]);

    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 9 }),
    ).resolves.toEqual({
      commentId: 9,
      operation: "updated",
      duplicateCommentIds: [4],
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 9 }),
      }),
    ]);
  });

  it("recovers an owned known comment omitted by a shifted page scan", async () => {
    const known = { id: 9, body: `known\n${marker}` };
    const duplicate = { id: 4, body: `older\n${marker}` };
    const fixture = githubFixture([known, duplicate], {
      listedComments: [duplicate],
    });

    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 9 }),
    ).resolves.toEqual({
      commentId: 9,
      operation: "updated",
      duplicateCommentIds: [4],
    });
    expect(
      fixture.calls.filter(
        ({ route }) =>
          route === "GET /repos/{owner}/{repo}/issues/comments/{comment_id}",
      ),
    ).toHaveLength(1);
    expect(
      mutations(fixture.calls).map(({ route, parameters }) => ({
        route,
        comment_id: parameters.comment_id,
      })),
    ).toEqual([
      {
        route: "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        comment_id: 9,
      },
    ]);
  });

  it("recreates progress after a known comment was deleted", async () => {
    const fixture = githubFixture([], { listedComments: [] });
    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 900 }),
    ).resolves.toEqual({
      commentId: 100,
      operation: "created",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    ]);
  });

  it("updates the scanned canonical when a known ID was deleted", async () => {
    const canonical = { id: 4, body: `older\n${marker}` };
    const listedComments = [canonical];
    const fixture = githubFixture(listedComments, { listedComments });
    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 900 }),
    ).resolves.toEqual({
      commentId: 4,
      operation: "updated",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("ignores foreign known ID when target has a canonical", async () => {
    const foreign = { id: 900, body: `foreign\n${marker}` };
    const target = { id: 4, body: `target\n${marker}` };
    const fixture = githubFixture([foreign, target], {
      listedComments: [target],
      commentIssueUrls: {
        900: "https://api.github.com/repos/foreign/repo/issues/99",
      },
    });

    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 900 }),
    ).resolves.toEqual({
      commentId: 4,
      operation: "updated",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 4 }),
      }),
    ]);
  });

  it("creates on target PR when known ID is foreign", async () => {
    const foreign = { id: 900, body: `foreign\n${marker}` };
    const fixture = githubFixture([foreign], {
      listedComments: [],
      commentIssueUrls: {
        900: "https://api.github.com/repos/foreign/repo/issues/99",
      },
    });

    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 900 }),
    ).resolves.toEqual({
      commentId: 100,
      operation: "created",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
        parameters: expect.objectContaining({ issue_number: 42 }),
      }),
    ]);
  });

  it("keeps the verified known comment when deleting an earlier duplicate", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([
      { id: 4, body: `older\n${marker}` },
      { id: 9, body: desired },
    ]);

    await expect(
      gateway(fixture.request).upsert({ ...input(), knownCommentId: 9 }),
    ).resolves.toEqual({
      commentId: 9,
      operation: "duplicate_deleted",
      duplicateCommentIds: [],
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 4 }),
      }),
    ]);
    await expect(
      fixture.request(
        "GET /repos/{owner}/{repo}/issues/comments/{comment_id}",
        { comment_id: 9 },
      ),
    ).resolves.toMatchObject({ data: { id: 9, body: desired } });
  });

  it("does not continue duplicate cleanup after an ambiguous DELETE", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture(
      [
        { id: 4, body: desired },
        { id: 7, body: `duplicate one\n${marker}` },
        { id: 9, body: `duplicate two\n${marker}` },
      ],
      { deleteFailureId: 7 },
    );

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { retryable: true, mutationMayHaveLanded: true },
    });
    expect(mutations(fixture.calls)).toEqual([
      expect.objectContaining({
        route: "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}",
        parameters: expect.objectContaining({ comment_id: 7 }),
      }),
    ]);
  });

  it("counts a definite 429 rejection of a duplicate DELETE", async () => {
    const desired = formatReviewProgressComment("working", marker);
    const fixture = githubFixture([
      { id: 4, body: desired },
      { id: 7, body: `duplicate\n${marker}` },
    ]);
    let deleteAttempts = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("DELETE ")) {
        deleteAttempts += 1;
        throw { status: 429, response: { headers: { "retry-after": "60" } } };
      }
      return fixture.request(route, parameters);
    };
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
    expect(caught).toMatchObject({
      kind: "rate_limited",
      metadata: {
        status: 429,
        retryable: true,
        retryNotBefore: new Date("2026-08-12T12:01:00.000Z"),
        retryAt: new Date("2026-08-12T12:01:00.250Z"),
      },
    });
    expect(
      (caught as ReviewProgressGitHubError).metadata.mutationMayHaveLanded,
    ).toBeUndefined();
    expect(deleteAttempts).toBe(1);
  });

  it("rechecks the PR head before patching a changed canonical comment", async () => {
    const fixture = githubFixture([{ id: 4, body: `old\n${marker}` }], {
      staleHeadAfterFirstRead: true,
    });

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "stale_head",
      metadata: { retryable: false },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("rechecks the PR head after discovery and before mutation", async () => {
    const fixture = githubFixture([], { staleHeadAfterFirstRead: true });

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "stale_head",
    });
    expect(fixture.calls.some(({ route }) => route.startsWith("POST "))).toBe(
      false,
    );
  });

  it("rejects a stale head before listing or mutating comments", async () => {
    const fixture = githubFixture([], { currentHead: "b".repeat(40) });

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "stale_head",
      metadata: { retryable: false },
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it("rejects a closed PR before listing or mutating comments", async () => {
    const fixture = githubFixture([], { currentState: "closed" });

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "stale_head",
      message: "github_pull_request_not_open",
      metadata: { retryable: false },
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it("rejects repository mismatch before reading or mutating comments", async () => {
    const fixture = githubFixture([], { repositoryFullName: "acme/other" });

    await expect(
      gateway(fixture.request).upsert(input()),
    ).rejects.toMatchObject({
      kind: "repository_mismatch",
      message: "github_pull_request_repository_mismatch",
      metadata: { retryable: false },
    });
    expect(fixture.calls).toHaveLength(1);
  });

  it.each([
    "GET /repos/{owner}/{repo}/pulls/{pull_number}",
    "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
  ])("retries statusless transport errors during %s", async (failedRoute) => {
    const fixture = githubFixture([]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route === failedRoute) throw new Error("ECONNRESET");
      return fixture.request(route, parameters);
    };
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({
      kind: "github_unavailable",
      metadata: {
        retryable: true,
        retryAt: new Date(now.getTime() + 1_250),
      },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("keeps definite comment-list 404 failures non-retryable", async () => {
    const fixture = githubFixture([]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        throw { status: 404 };
      }
      return fixture.request(route, parameters);
    };
    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "github_request_failed",
      metadata: { status: 404, retryable: false },
    });
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("classifies revoked GitHub App access as terminal", async () => {
    const request: ReviewProgressGitHubRequester = vi.fn(async () => {
      throw { status: 403, response: { headers: {} } };
    });

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "revoked_app",
      metadata: { status: 403, retryable: false },
    });
  });

  it("classifies a body-only secondary rate limit as retryable for at least one minute", async () => {
    const request: ReviewProgressGitHubRequester = vi.fn(async () => {
      throw {
        status: 403,
        response: {
          headers: {},
          data: {
            message:
              "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
            documentation_url:
              "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api#about-secondary-rate-limits",
          },
        },
      };
    });
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((value: unknown) => value);

    expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
    expect(caught).toMatchObject({
      kind: "rate_limited",
      metadata: {
        status: 403,
        retryable: true,
        retryNotBefore: new Date("2026-08-12T12:01:00.000Z"),
      },
    });
    expect(
      (caught as ReviewProgressGitHubError).metadata.retryAt!.getTime(),
    ).toBeGreaterThanOrEqual(now.getTime() + 60_000);
  });

  it.each([
    {
      name: "Retry-After",
      error: { status: 429, response: { headers: { "retry-after": "10" } } },
      boundary: "2026-08-12T12:00:10.000Z",
    },
    {
      name: "x-ratelimit-reset",
      error: {
        status: 403,
        response: {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(
              Date.parse("2026-08-12T12:00:20.000Z") / 1_000,
            ),
          },
        },
      },
      boundary: "2026-08-12T12:00:20.000Z",
    },
  ])(
    "classifies rate limits from $name with jitter-safe metadata",
    async ({ error, boundary }) => {
      const request: ReviewProgressGitHubRequester = vi.fn(async () => {
        throw error;
      });
      const operation = gateway(request, {
        now: () => new Date("2026-08-12T12:00:00.000Z"),
        random: () => 0,
      }).upsert(input());

      const caught = await operation.catch((value: unknown) => value);
      expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
      expect(caught).toMatchObject({
        kind: "rate_limited",
        metadata: { retryable: true, retryNotBefore: new Date(boundary) },
      });
      expect(
        (caught as ReviewProgressGitHubError).metadata.retryAt!.getTime(),
      ).toBeGreaterThanOrEqual(Date.parse(boundary));
    },
  );

  it("classifies GitHub 5xx as retryable without sleeping", async () => {
    const request: ReviewProgressGitHubRequester = vi.fn(async () => {
      throw { status: 503, headers: { "retry-after": "2" } };
    });
    const caught = await gateway(request, {
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      random: () => 1,
    })
      .upsert(input())
      .catch((value: unknown) => value);

    expect(caught).toMatchObject({
      kind: "github_unavailable",
      metadata: {
        status: 503,
        retryable: true,
        retryNotBefore: new Date("2026-08-12T12:00:02.000Z"),
      },
    });
  });

  it("uses fallback retry timing for headerless 5xx", async () => {
    const request: ReviewProgressGitHubRequester = vi.fn(async () => {
      throw { status: 502 };
    });
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);

    expect(caught).toMatchObject({
      kind: "github_unavailable",
      metadata: {
        status: 502,
        retryable: true,
        retryNotBefore: new Date("2026-08-12T12:00:01.000Z"),
        retryAt: new Date("2026-08-12T12:00:01.250Z"),
      },
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps non-rate-limited 404 failures terminal", async () => {
    const request: ReviewProgressGitHubRequester = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "github_request_failed",
      metadata: { status: 404, retryable: false },
    });
    expect(request).toHaveBeenCalledOnce();
  });

  it("preserves rate_limited after an ambiguous PATCH and a throttled rescan", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }], {
      throwAfterPatch: true,
    });
    let commentReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads === 2) {
          throw {
            status: 403,
            response: { headers: { "retry-after": "60" } },
          };
        }
      }
      return fixture.request(route, parameters);
    };
    const caught = await gateway(request, {
      maxCommentPages: 1,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
    expect(caught).toMatchObject({
      kind: "rate_limited",
      metadata: { retryable: true },
      cause: {
        mutationError: expect.any(Error),
        observationError: expect.objectContaining({ kind: "rate_limited" }),
      },
    });
    const metadata = (caught as ReviewProgressGitHubError).metadata;
    expect(metadata).toMatchObject({
      status: 403,
      retryNotBefore: new Date("2026-08-12T12:01:00.000Z"),
    });
    expect(metadata.retryAt!.getTime()).toBeGreaterThanOrEqual(
      Date.parse("2026-08-12T12:01:00.000Z"),
    );
    expect(commentReads).toBe(2);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("confirms an ambiguous PATCH through its comment when the rescan is capped", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }], {
      throwAfterPatch: true,
    });
    let commentReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads === 2) return { data: fullUnrelatedPage() };
      }
      return fixture.request(route, parameters);
    };

    await expect(
      gateway(request, { maxCommentPages: 1 }).upsert(input()),
    ).resolves.toEqual({
      commentId: 8,
      operation: "reconciled",
      duplicateCommentIds: [],
    });
    expect(commentReads).toBe(2);
    expect(mutations(fixture.calls).map(({ route }) => route)).toEqual([
      "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    ]);
  });

  it("keeps PATCH 429 cooldown after reconciliation GET 502", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    let commentReads = 0;
    let patchAttempts = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) {
        patchAttempts += 1;
        throw { status: 429, response: { headers: { "retry-after": "60" } } };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads === 2) throw { status: 502 };
      }
      return fixture.request(route, parameters);
    };
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
    expect(caught).toMatchObject({
      kind: "rate_limited",
      metadata: {
        status: 429,
        retryable: true,
        retryNotBefore: new Date("2026-08-12T12:01:00.000Z"),
        retryAt: new Date("2026-08-12T12:01:00.250Z"),
      },
    });
    const cause = (caught as ReviewProgressGitHubError).cause as {
      mutationError: unknown;
      observationError: unknown;
    };
    expect(cause.mutationError).toMatchObject({ status: 429 });
    expect(cause.observationError).toBeInstanceOf(ReviewProgressGitHubError);
    expect(cause.observationError).toHaveProperty("kind", "github_unavailable");
    expect(cause.observationError).toHaveProperty("metadata.status", 502);
    expect(publicationRetryPlan(caught, () => now, 1_000)).toMatchObject({
      safeCode: "review_progress_rate_limited",
      retryAt: new Date("2026-08-12T12:01:00.250Z"),
      installationCooldownUntil: new Date("2026-08-12T12:01:00.250Z"),
    });
    expect(patchAttempts).toBe(1);
    expect(commentReads).toBe(2);
  });

  it.each([
    {
      getStatus: 502,
      getRetryAfter: "7200",
      expected: "2026-08-12T14:00:00",
      expectedCooldown: "2026-08-12T12:01:00",
    },
    {
      getStatus: 403,
      getRetryAfter: "10800",
      expected: "2026-08-12T15:00:00",
      expectedCooldown: "2026-08-12T15:00:00",
    },
  ])(
    "keeps the later GET $getStatus retry boundary after PATCH 429",
    async ({ getStatus, getRetryAfter, expected, expectedCooldown }) => {
      const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
      let commentReads = 0;
      let patchAttempts = 0;
      const request: ReviewProgressGitHubRequester = async (
        route,
        parameters,
      ) => {
        if (route.startsWith("PATCH ")) {
          patchAttempts += 1;
          throw { status: 429, response: { headers: { "retry-after": "60" } } };
        }
        if (
          route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
        ) {
          commentReads += 1;
          if (commentReads === 2) {
            throw {
              status: getStatus,
              response: { headers: { "retry-after": getRetryAfter } },
            };
          }
        }
        return fixture.request(route, parameters);
      };
      const now = new Date("2026-08-12T12:00:00.000Z");
      const caught = await gateway(request, {
        now: () => now,
        random: () => 0,
      })
        .upsert(input())
        .catch((error: unknown) => error);
      const retryNotBefore = new Date(`${expected}.000Z`);
      const retryAt = new Date(`${expected}.250Z`);

      expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
      expect(caught).toMatchObject({
        kind: "rate_limited",
        metadata: { retryNotBefore, retryAt },
      });
      expect(publicationRetryPlan(caught, () => now, 1_000)).toMatchObject({
        safeCode: "review_progress_rate_limited",
        retryAt,
        installationCooldownUntil: new Date(`${expectedCooldown}.250Z`),
      });
      expect(patchAttempts).toBe(1);
      expect(commentReads).toBe(2);
    },
  );

  it("does not extend installation cooldown for a long PATCH 503 outage", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    let commentReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) {
        throw { status: 503, response: { headers: { "retry-after": "7200" } } };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads === 2) {
          throw { status: 429, response: { headers: { "retry-after": "60" } } };
        }
      }
      return fixture.request(route, parameters);
    };
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);
    const workerRetryAt = new Date("2026-08-12T14:00:00.250Z");
    const cooldownUntil = new Date("2026-08-12T12:01:00.250Z");

    expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
    expect(caught).toMatchObject({
      kind: "rate_limited",
      metadata: {
        retryAt: workerRetryAt,
        retryNotBefore: new Date("2026-08-12T14:00:00.000Z"),
        installationCooldownUntil: cooldownUntil,
      },
    });
    expect(publicationRetryPlan(caught, () => now, 1_000)).toMatchObject({
      safeCode: "review_progress_rate_limited",
      retryAt: workerRetryAt,
      installationCooldownUntil: cooldownUntil,
    });
    expect(commentReads).toBe(2);
  });

  it.each(["rate_limited"] as const)(
    "preserves PATCH 429 cooldown after a %s reconciliation failure",
    async (kind) => {
      const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
      let commentReads = 0;
      let patchAttempts = 0;
      const request: ReviewProgressGitHubRequester = async (
        route,
        parameters,
      ) => {
        if (route.startsWith("PATCH ")) {
          patchAttempts += 1;
          throw {
            status: 429,
            response: { headers: { "retry-after": "7200" } },
          };
        }
        if (
          route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
        ) {
          commentReads += 1;
          if (commentReads === 2) {
            throw {
              status: 403,
              response: { headers: { "retry-after": "60" } },
            };
          }
        }
        return fixture.request(route, parameters);
      };
      const now = new Date("2026-08-12T12:00:00.000Z");
      const caught = await gateway(request, {
        maxCommentPages: 1,
        now: () => now,
        random: () => 0,
      })
        .upsert(input())
        .catch((error: unknown) => error);
      const cooldown = new Date("2026-08-12T14:00:00.250Z");

      expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
      expect(caught).toMatchObject({
        kind,
        metadata: { retryable: true, installationCooldownUntil: cooldown },
      });
      const cause = (caught as ReviewProgressGitHubError).cause as {
        mutationError: unknown;
        observationError: unknown;
      };
      expect(cause.mutationError).toMatchObject({ status: 429 });
      expect(cause.observationError).toBeInstanceOf(ReviewProgressGitHubError);
      expect(cause.observationError).toHaveProperty("kind", kind);
      expect(publicationRetryPlan(caught, () => now, 1_000)).toMatchObject({
        safeCode: `review_progress_${kind}`,
        retryAt: cooldown,
        installationCooldownUntil: cooldown,
      });
      expect(commentReads).toBe(2);
      expect(patchAttempts).toBe(1);
    },
  );

  it("preserves PATCH 429 cooldown when a capped rescan cannot confirm it", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    let commentReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) {
        throw { status: 429, response: { headers: { "retry-after": "7200" } } };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads === 2) return { data: fullUnrelatedPage() };
      }
      return fixture.request(route, parameters);
    };
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      maxCommentPages: 1,
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);
    const cooldown = new Date("2026-08-12T14:00:00.250Z");

    expect(caught).toMatchObject({
      kind: "rate_limited",
      metadata: { retryable: true, status: 429 },
    });
    expect(publicationRetryPlan(caught, () => now, 1_000)).toMatchObject({
      safeCode: "review_progress_rate_limited",
      retryAt: cooldown,
      installationCooldownUntil: cooldown,
    });
    expect(commentReads).toBe(2);
  });

  it("skips GET after definitive PATCH 403", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    let commentReads = 0;
    const patchAttempts: unknown[] = [];
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) {
        patchAttempts.push(parameters?.comment_id);
        throw { status: 403 };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads > 1) throw { status: 502 };
      }
      return fixture.request(route, parameters);
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "revoked_app",
      metadata: { status: 403, retryable: false },
    });
    expect(commentReads).toBe(1);
    expect(patchAttempts).toEqual([8]);
    expect(mutations(fixture.calls)).toEqual([]);
  });

  it("keeps ambiguous PATCH failures retryable", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) throw { status: 404 };
      return fixture.request(route, parameters);
    };

    await expect(gateway(request).upsert(input())).rejects.toMatchObject({
      kind: "ambiguous_mutation",
      metadata: { status: 404, retryable: true },
    });
  });

  it("preserves outage retry bounds after an ambiguous PATCH and failed GET", async () => {
    const fixture = githubFixture([{ id: 8, body: `old\n${marker}` }]);
    let commentReads = 0;
    const request: ReviewProgressGitHubRequester = async (
      route,
      parameters,
    ) => {
      if (route.startsWith("PATCH ")) {
        throw { status: 503, response: { headers: { "retry-after": "7200" } } };
      }
      if (
        route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments"
      ) {
        commentReads += 1;
        if (commentReads === 2) {
          throw { status: 502, response: { headers: { "retry-after": "60" } } };
        }
      }
      return fixture.request(route, parameters);
    };
    const now = new Date("2026-08-12T12:00:00.000Z");
    const caught = await gateway(request, {
      now: () => now,
      random: () => 0,
    })
      .upsert(input())
      .catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(ReviewProgressGitHubError);
    expect(caught).toMatchObject({
      kind: "ambiguous_mutation",
      metadata: {
        retryAt: new Date("2026-08-12T14:00:00.250Z"),
        retryNotBefore: new Date("2026-08-12T14:00:00.000Z"),
      },
    });
    expect(publicationRetryPlan(caught, () => now, 1_000)).toMatchObject({
      safeCode: "review_progress_ambiguous_mutation",
      retryAt: new Date("2026-08-12T14:00:00.250Z"),
    });
    expect(commentReads).toBe(2);
  });
});

function input() {
  return {
    owner: "acme",
    repo: "rocket",
    pullNumber: 42,
    expectedHeadSha: head,
    expectedBotLogin: "review-router[bot]",
    marker,
    body: "working",
  } as const;
}

function gateway(
  request: ReviewProgressGitHubRequester,
  options: ConstructorParameters<typeof ReviewProgressGitHubGateway>[1] = {},
) {
  return new ReviewProgressGitHubGateway(request, options);
}

function githubFixture(
  initialComments: Array<{ id: number; body: string; authorLogin?: string }>,
  options: {
    readonly currentHead?: string;
    readonly currentState?: string;
    readonly repositoryFullName?: string;
    readonly throwAfterPost?: boolean;
    readonly throwBeforePatch?: boolean;
    readonly throwAfterPatch?: boolean;
    readonly deleteFailureId?: number;
    readonly commentIssueUrls?: Readonly<Record<number, string>>;
    readonly listedComments?: Array<{
      id: number;
      body: string;
      authorLogin?: string;
    }>;
    readonly pagedComments?: readonly (readonly {
      id: number;
      body: string;
      authorLogin?: string;
    }[])[];
    readonly pageLinks?: readonly (string | undefined)[];
    readonly staleHeadAfterFirstRead?: boolean;
  } = {},
) {
  const comments = initialComments.map(toStoredComment);
  let pullReads = 0;
  const calls: Array<{
    route: string;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];
  const request: ReviewProgressGitHubRequester = async (
    route,
    parameters = {},
  ) => {
    calls.push({ route, parameters });
    if (route === "GET /repos/{owner}/{repo}/pulls/{pull_number}") {
      pullReads += 1;
      return {
        data: {
          state: options.currentState ?? "open",
          head: {
            sha:
              options.staleHeadAfterFirstRead && pullReads > 1
                ? "b".repeat(40)
                : (options.currentHead ?? head),
          },
          base: {
            repo: {
              id: 1300192,
              full_name: options.repositoryFullName ?? "acme/rocket",
            },
          },
        },
      };
    }
    if (route === "GET /repos/{owner}/{repo}/issues/{issue_number}/comments") {
      const pageIndex = Number(parameters.page) - 1;
      const visible = options.pagedComments
        ? (options.pagedComments[pageIndex] ?? []).map(toStoredComment)
        : (options.listedComments?.map(toStoredComment) ?? comments);
      return {
        data: visible.map(toResponseComment),
        ...(options.pageLinks
          ? { headers: { link: options.pageLinks[pageIndex] } }
          : {}),
      };
    }
    if (route === "GET /repos/{owner}/{repo}/issues/comments/{comment_id}") {
      const comment = comments.find(({ id }) => id === parameters.comment_id);
      if (!comment) throw { status: 404 };
      return {
        data: {
          ...toResponseComment(comment),
          issue_url:
            options.commentIssueUrls?.[comment.id] ??
            "https://api.github.com/repos/acme/rocket/issues/42",
        },
      };
    }
    if (route === "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}") {
      const comment = comments.find(({ id }) => id === parameters.comment_id)!;
      if (options.throwBeforePatch) throw new Error("pre_write_failure");
      comment.body = parameters.body as string;
      if (options.throwAfterPatch) throw new Error("socket_closed_after_write");
      return { data: toResponseComment(comment) };
    }
    if (route === "POST /repos/{owner}/{repo}/issues/{issue_number}/comments") {
      const created = {
        id: 100,
        body: parameters.body as string,
        authorLogin: "review-router[bot]",
      };
      comments.push(created);
      if (options.throwAfterPost) throw new Error("socket_closed_after_write");
      return { data: toResponseComment(created) };
    }
    if (route === "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}") {
      if (parameters.comment_id === options.deleteFailureId)
        throw new Error("delete_failed");
      const index = comments.findIndex(
        ({ id }) => id === parameters.comment_id,
      );
      if (index >= 0) comments.splice(index, 1);
      return { data: undefined };
    }
    throw new Error(`unexpected_route:${route}`);
  };
  return { request, calls };
}

function fullUnrelatedPage() {
  return Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    body: "unrelated",
    user: { login: "other" },
  }));
}

function toStoredComment(comment: {
  id: number;
  body: string;
  authorLogin?: string;
}) {
  return {
    id: comment.id,
    body: comment.body,
    authorLogin: comment.authorLogin ?? "review-router[bot]",
  };
}

function toResponseComment(comment: {
  id: number;
  body: string;
  authorLogin: string;
}) {
  return {
    id: comment.id,
    body: comment.body,
    user: { login: comment.authorLogin },
    issue_url: "https://api.github.com/repos/acme/rocket/issues/42",
  };
}

function mutations(
  calls: Array<{
    route: string;
    parameters: Readonly<Record<string, unknown>>;
  }>,
) {
  return calls.filter(({ route }) => /^(?:POST|PATCH|DELETE) /u.test(route));
}

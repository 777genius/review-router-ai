/** Complete GraphQL timestamp observation for an unedited published comment. */
export function publishedReviewCommentTimestamps(createdAt: string) {
  return {
    createdAt,
    publishedAt: createdAt,
    updatedAt: createdAt,
    lastEditedAt: null,
  };
}

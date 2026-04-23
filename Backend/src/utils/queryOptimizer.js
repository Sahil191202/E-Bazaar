/**
 * Lean query helper — always use .lean() for read-only queries.
 * Mongoose documents are ~2x heavier than plain objects.
 */
export const leanQuery = (query) => query.lean();

/**
 * Select only the fields you need.
 * Never return password, refreshTokens, fcmTokens in list queries.
 */
export const safeUserSelect = '-password -refreshTokens -fcmTokens -__v';
export const safeProductSelect = '-__v';

/**
 * Build a MongoDB text search query with score projection.
 */
export const buildTextSearch = (searchTerm) => ({
  filter:     { $text: { $search: searchTerm } },
  projection: { score: { $meta: 'textScore' } },
  sort:       { score: { $meta: 'textScore' } },
});

/**
 * Cursor-based pagination (faster than skip/limit for large datasets).
 * Use when page > 10 or dataset > 100k documents.
 */
export const cursorPaginate = async (Model, filter, { cursor, limit = 20, sort = { _id: -1 } }) => {
  const query = { ...filter };

  if (cursor) {
    const direction = Object.values(sort)[0] === -1 ? '$lt' : '$gt';
    query._id = { [direction]: cursor };
  }

  const items = await Model.find(query)
    .sort(sort)
    .limit(limit + 1) // Fetch one extra to detect hasNextPage
    .lean();

  const hasNextPage = items.length > limit;
  if (hasNextPage) items.pop();

  const nextCursor = hasNextPage ? items[items.length - 1]._id : null;

  return { items, hasNextPage, nextCursor };
};

/**
 * Batch fetch by IDs — avoids N+1 queries.
 * Use in aggregations where you need related data.
 */
export const batchFetchById = async (Model, ids, selectFields = '') => {
  const docs = await Model.find({ _id: { $in: ids } })
    .select(selectFields)
    .lean();

  return Object.fromEntries(docs.map((d) => [d._id.toString(), d]));
};
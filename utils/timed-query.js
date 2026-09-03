import { query, update } from 'mu';

/**
 * Executes a SELECT query, logging its duration when LOG_LEVEL is 'debug'.
 *
 * @param {string} queryString the SPARQL query
 * @returns {Promise<object>} the raw SPARQL JSON result
 */
export async function timedQuery(queryString) {
  if (process.env.LOG_LEVEL != 'debug') {
    return query(queryString);
  }

  const start = performance.now();
  const result = await query(queryString);
  console.log(
    `[query] took ${(performance.now() - start).toFixed(2)}ms to execute`
  );
  return result;
}

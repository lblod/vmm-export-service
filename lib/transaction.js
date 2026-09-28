import { sparqlEscapeString, sparqlEscapeUri } from 'mu';
import { timedQuery } from '../utils/timed-query.js';

const ACTIE_WORK_TYPE = 'http://lblod.data.gift/vocabularies/vmm/Actie';
const ONTVANGST = 'Ontvangst';
const UITGAVE = 'Uitgave';

const PREFIXES = `
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX eli: <http://data.europa.eu/eli/ontology#>
    PREFIX schema: <http://schema.org/>
    PREFIX elod: <http://linkedeconomy.org/ontology#>
`;

/**
 * The pattern matching the transacties of one actie, identified by its
 * dct:identifier. Shared by the count and the page query.
 */
function transactieScope(actieId) {
  return `
      ?actie a eli:Work ;
             eli:work_type ${sparqlEscapeUri(ACTIE_WORK_TYPE)} ;
             dct:identifier ${sparqlEscapeString(actieId)} .

      ?transactie a schema:MoneyTransfer ;
                  schema:result ?actie .
  `;
}

/**
 * Counts the transacties of one actie.
 *
 * @param {string} actieId the actie's dct:identifier
 * @returns {Promise<number>}
 */
export async function countTransacties(actieId) {
  const result = await timedQuery(`
    ${PREFIXES}

    SELECT (COUNT(DISTINCT ?transactie) AS ?count)
    WHERE {
      ${transactieScope(actieId)}
    }
  `);

  return parseInt(result.results.bindings[0].count.value);
}

/**
 * Fetches one page of transacties for an actie.
 *
 * @param {string} actieId the actie's dct:identifier
 * @param {{page: number, size: number}} paging
 * @returns {Promise<Array<object>>}
 */
export async function getTransacties(actieId, { page, size }) {
  const offset = page * size;

  const result = await timedQuery(`
    ${PREFIXES}

    SELECT DISTINCT ?transactie ?transactieId ?transactieSoort ?transactieBedrag
                    ?transactieBoekjaar ?transactieRapportjaar
    WHERE {
      {
        SELECT DISTINCT ?transactie
        WHERE {
          ${transactieScope(actieId)}
        }
        ORDER BY ?transactie
        LIMIT ${size}
        OFFSET ${offset}
      }

      OPTIONAL {
        ?transactie dct:identifier ?transactieId .
      }
      OPTIONAL {
        ?transactie schema:additionalType ?transactieSoort .
      }
      OPTIONAL {
        ?transactie schema:amount ?transactieBedrag .
      }
      OPTIONAL {
        ?transactie elod:financialYear ?transactieBoekjaar .
      }
      OPTIONAL {
        ?transactie dct:created ?transactieRapportjaar .
      }
    }
    ORDER BY ?transactie
  `);

  const byUri = new Map();

  for (const binding of result.results.bindings) {
    const uri = binding.transactie.value;
    if (byUri.has(uri)) {
      continue;
    }

    byUri.set(uri, {
      uri,
      id: binding.transactieId?.value,
      soort: binding.transactieSoort?.value,
      bedrag: binding.transactieBedrag?.value,
      boekjaar: binding.transactieBoekjaar?.value,
      rapportjaar: binding.transactieRapportjaar?.value,
    });
  }

  return [...byUri.values()];
}

/**
 * Counts and totals the transacties of each of the given acties, keyed by
 * actie uri.
 * Used by /export, which reports a count and a link rather than the
 * transacties themselves: a single actie can carry thousands.
 *
 * @param {Array<string>} actieUris
 * @returns {Promise<Object<string, number>>}
 */
export async function getTransactieCounts(actieUris) {
  const countsByActie = {};
  if (actieUris.length === 0) {
    return countsByActie;
  }

  const values = actieUris.map(sparqlEscapeUri).join('\n        ');

  const result = await timedQuery(`
    ${PREFIXES}

    SELECT ?actie ?soort
           (COUNT(DISTINCT ?transactie) AS ?count)
           (SUM(?bedrag) AS ?totaal)
    WHERE {
      VALUES ?actie {
        ${values}
      }

      ?transactie a schema:MoneyTransfer ;
                  schema:result ?actie .

      OPTIONAL {
        ?transactie schema:additionalType ?soort .
      }
      OPTIONAL {
        ?transactie schema:amount ?bedrag .
      }
    }
    GROUP BY ?actie ?soort
  `);

  for (const binding of result.results.bindings) {
    const actie = binding.actie.value;
    const totals = (countsByActie[actie] ??= {
      count: 0,
      totaleOntvangsten: 0,
      totaleUitgaven: 0,
    });

    totals.count += parseInt(binding.count.value);

    const totaal = Number(binding.totaal?.value ?? 0);
    if (binding.soort?.value === ONTVANGST) {
      totals.totaleOntvangsten += totaal;
    } else if (binding.soort?.value === UITGAVE) {
      totals.totaleUitgaven += totaal;
    }
  }

  return countsByActie;
}

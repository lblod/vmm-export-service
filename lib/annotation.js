import { sparqlEscapeDateTime, sparqlEscapeUri } from 'mu';
import { timedQuery } from '../utils/timed-query.js';

const NO_MATCH = "http://mu.semte.ch/vocabularies/ext/no-match-found";
const APPROVE = "http://mu.semte.ch/vocabularies/ext/annotation-review#approve";
const REJECT = "http://mu.semte.ch/vocabularies/ext/annotation-review#reject";
const ACTIE_WORK_TYPE = "http://lblod.data.gift/vocabularies/vmm/Actie";

// Going up from the actie is many-to-one: an actie belongs to exactly one
// actieplan, which belongs to exactly one beleidsdoelstelling, which belongs
// to exactly one strategischeDoelstelling.
const ACTIEPLAN_WORK_TYPE =
  "http://lblod.data.gift/vocabularies/vmm/Actieplan";
const BELEIDSDOELSTELLING_WORK_TYPE =
  "http://lblod.data.gift/vocabularies/vmm/Beleidsdoelstelling";
const STRATEGISCHE_DOELSTELLING_WORK_TYPE =
  "http://lblod.data.gift/vocabularies/vmm/StrategischeDoelstelling";
const AANLEVERING_TYPE =
  "http://lblod.data.gift/vocabularies/vmm/Aanlevering";

/**
 * The pattern selecting the annotations in scope of the export.
 * Shared by the count and the page
 * query so the two can never drift apart.
 *
 * Annotations whose body is the "no match found" concept are excluded.
 *
 * @param {object} filters since, minApproved, minRejected and minCorrections
 * @returns {string} a SPARQL group graph pattern
 */
function annotationScope({
  since = null,
  minApproved = 0,
  minRejected = 0,
  minCorrections = 0,
} = {}) {
  const sinceFilter = since
    ? `FILTER (?created >= ${sparqlEscapeDateTime(since)})`
    : '';

  return `
      ?annotation a oa:Annotation ;
                  mu:uuid ?annotationId ;
                  oa:hasBody ?annotationBody .

      MINUS {
        ?annotation oa:hasBody ${sparqlEscapeUri(NO_MATCH)} .
      }

      ?annotationTask a prov:Activity, tasks:Task ;
                      dct:created ?created ;
                      prov:generated ?annotation .

      ?annotation oa:hasTarget ?actieExpression .

      ?actie eli:is_realized_by ?actieExpression ;
             a eli:Work ;
             eli:work_type ${sparqlEscapeUri(ACTIE_WORK_TYPE)} ;
             dct:identifier ?actieId ;
             eli:passed_by ?bestuur .

      ${sinceFilter}

      ${verdictMinimum('approved', 'review:approve', minApproved)}

      ${verdictMinimum('rejected', 'review:reject', minRejected)}

      ${correctionMinimum(minCorrections)}
  `;
}

/**
 * A pattern restricting ?annotation to those with at least `minimum` reviews
 * carrying the given verdict. Empty when no minimum is asked for.
 */
function verdictMinimum(name, verdict, minimum) {
  if (!minimum) {
    return '';
  }

  const review = `?${name}Review`;
  const count = `?${name}Count`;

  return `{
        SELECT ?annotation (COUNT(DISTINCT ${review}) AS ${count})
        WHERE {
          ${review} a ext:ReviewAnnotation .
          ${review} oa:hasTarget ?annotation .
          ${review} oa:hasBody ${verdict} .
        }
        GROUP BY ?annotation
      }

      FILTER (${count} >= ${Number.parseInt(minimum)})`;
}

/**
 * A pattern restricting ?annotation to those replaced by at least `minimum`
 * corrections. Empty when no minimum is asked for.
 */
function correctionMinimum(minimum) {
  if (!minimum) {
    return '';
  }

  return `{
        SELECT ?annotation (COUNT(DISTINCT ?minCorrection) AS ?correctionCount)
        WHERE {
          ?minCorrectionReview a ext:ReviewAnnotation ;
                               oa:hasTarget ?annotation ;
                               prov:influenced ?minCorrection .

          ?minCorrection a ext:CorrectionAnnotation ;
                         dct:replaces ?annotation .
        }
        GROUP BY ?annotation
      }

      FILTER (?correctionCount >= ${Number.parseInt(minimum)})`;
}

/**
 * Reads one complex work level off a binding.
 */
function complexWork(binding, name) {
  if (!binding[name]) {
    return undefined;
  }

  return {
    uri: binding[name].value,
    id: binding[`${name}Id`].value,
    code: binding[`${name}Code`]?.value,
    korteOmschrijving: binding[`${name}KorteOmschrijving`]?.value,
    langeOmschrijving: binding[`${name}LangeOmschrijving`]?.value,
    commentaar: binding[`${name}Commentaar`]?.value,
    evaluatie: binding[`${name}Evaluatie`]?.value,
  };
}

/**
 * Counts the annotations in scope of the export.
 *
 * @param {object} filters since, minApproved, minRejected and minCorrections
 * @returns {Promise<number>} the total number of matching annotations
 */
export async function countAnnotations(filters = {}) {
  const result = await timedQuery(`
    PREFIX oa: <http://www.w3.org/ns/oa#>
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX dct: <http://purl.org/dc/terms/>
    PREFIX prov: <http://www.w3.org/ns/prov#>
    PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
    PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
    PREFIX tasks: <http://redpencil.data.gift/vocabularies/tasks/>
    PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
    PREFIX review: <http://mu.semte.ch/vocabularies/ext/annotation-review#>
    PREFIX eli: <http://data.europa.eu/eli/ontology#>
    PREFIX epvoc: <https://data.europarl.europa.eu/def/epvoc#>

    SELECT (COUNT(DISTINCT ?annotation) AS ?count)
    WHERE {
      ${annotationScope(filters)}
    }
  `);

  return parseInt(result.results.bindings[0].count.value);
}

/**
 * Fetches a single page of annotations to export.
 *
 * @param {object} filters since, minApproved, minRejected and minCorrections
 * @param {{page: number, size: number}} paging zero-based page number and
 *                                              number of annotations per page
 * @returns {Promise<Array<object>>} the annotations on that page
 */
 export async function getAnnotations(filters = {}, { page, size }) {
   const offset = page * size;

   const result = await timedQuery(`
     PREFIX oa: <http://www.w3.org/ns/oa#>
     PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
     PREFIX dct: <http://purl.org/dc/terms/>
     PREFIX prov: <http://www.w3.org/ns/prov#>
     PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
     PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
     PREFIX tasks: <http://redpencil.data.gift/vocabularies/tasks/>
     PREFIX nif: <http://persistence.uni-leipzig.org/nlp2rdf/ontologies/nif-core#>
     PREFIX ext: <http://mu.semte.ch/vocabularies/ext/>
     PREFIX review: <http://mu.semte.ch/vocabularies/ext/annotation-review#>
     PREFIX eli: <http://data.europa.eu/eli/ontology#>
     PREFIX epvoc: <https://data.europarl.europa.eu/def/epvoc#>
     PREFIX schema: <https://schema.org/>
     PREFIX org: <http://www.w3.org/ns/org#>

     SELECT DISTINCT ?annotation ?annotationId ?created ?modified ?agent ?agentName ?score
                     ?annotationBody ?annotationBodyId ?annotationBodyNotation ?annotationBodyLabel
                     ?reviewAnnotation ?reviewBody
                     ?correction ?correctionCreated ?correctionTaskCreated ?correctionScore
                     ?correctionBody ?correctionBodyId ?correctionBodyNotation ?correctionBodyLabel
                     ?actie ?actieId ?actieCode ?actieExterneRapporteringscode
                     ?actieKorteOmschrijving ?actieLangeOmschrijving
                     ?actieCommentaar ?actieEvaluatie
                     ?actieplan ?actieplanId ?actieplanCode
                     ?actieplanKorteOmschrijving ?actieplanLangeOmschrijving
                     ?actieplanCommentaar ?actieplanEvaluatie
                     ?beleidsdoelstelling ?beleidsdoelstellingId ?beleidsdoelstellingCode
                     ?beleidsdoelstellingKorteOmschrijving ?beleidsdoelstellingLangeOmschrijving
                     ?beleidsdoelstellingCommentaar ?beleidsdoelstellingEvaluatie
                     ?strategischeDoelstelling ?strategischeDoelstellingId ?strategischeDoelstellingCode
                     ?strategischeDoelstellingKorteOmschrijving ?strategischeDoelstellingLangeOmschrijving
                     ?strategischeDoelstellingCommentaar ?strategischeDoelstellingEvaluatie
                     ?bestuur ?bestuurId ?bestuurLabel ?bestuurTypeLabel
                     ?aanlevering ?aanleveringId ?aanleveringDatePublished
     WHERE {
       {
         SELECT DISTINCT ?annotation ?annotationId ?annotationTask ?created ?annotationBody ?actie ?actieId ?actieExpression
         WHERE {
           ${annotationScope(filters)}
         }
         ORDER BY ?created ?annotation
         LIMIT ${size}
         OFFSET ${offset}
       }

       OPTIONAL {
          ?actieExpression eli:description ?actieKorteOmschrijving
       }
       OPTIONAL {
          ?actieExpression epvoc:expressionContent ?actieLangeOmschrijving .
       }
       OPTIONAL {
         ?actieExpression schema:code ?actieCode .
       }
       OPTIONAL {
         ?actieExpression schema:reportNumber ?actieExterneRapporteringscode .
       }
       OPTIONAL {
         ?actieExpression schema:comment ?actieCommentaar .
       }
       OPTIONAL {
         ?actieExpression schema:review ?actieEvaluatie .
       }

       OPTIONAL {
         ?actieplan a eli:ComplexWork ;
                    eli:work_type ${sparqlEscapeUri(ACTIEPLAN_WORK_TYPE)} ;
                    dct:identifier ?actieplanId ;
                    eli:has_member ?actie ;
                    eli:is_realized_by ?actieplanExpression .

         OPTIONAL {
           ?actieplanExpression eli:description ?actieplanKorteOmschrijving .
         }
         OPTIONAL {
           ?actieplanExpression epvoc:expressionContent ?actieplanLangeOmschrijving .
         }
         OPTIONAL {
           ?actieplanExpression schema:code ?actieplanCode .
         }
         OPTIONAL {
           ?actieplanExpression schema:comment ?actieplanCommentaar .
         }
         OPTIONAL {
           ?actieplanExpression schema:review ?actieplanEvaluatie .
         }

         OPTIONAL {
           ?beleidsdoelstelling a eli:ComplexWork ;
                                eli:work_type ${sparqlEscapeUri(BELEIDSDOELSTELLING_WORK_TYPE)} ;
                                dct:identifier ?beleidsdoelstellingId ;
                                eli:has_member ?actieplan ;
                                eli:is_realized_by ?beleidsdoelstellingExpression .

           OPTIONAL {
             ?beleidsdoelstellingExpression eli:description ?beleidsdoelstellingKorteOmschrijving .
           }
           OPTIONAL {
             ?beleidsdoelstellingExpression epvoc:expressionContent ?beleidsdoelstellingLangeOmschrijving .
           }
           OPTIONAL {
             ?beleidsdoelstellingExpression schema:code ?beleidsdoelstellingCode .
           }
           OPTIONAL {
             ?beleidsdoelstellingExpression schema:comment ?beleidsdoelstellingCommentaar .
           }
           OPTIONAL {
             ?beleidsdoelstellingExpression schema:review ?beleidsdoelstellingEvaluatie .
           }

           OPTIONAL {
             ?strategischeDoelstelling a eli:ComplexWork ;
                                       eli:work_type ${sparqlEscapeUri(STRATEGISCHE_DOELSTELLING_WORK_TYPE)} ;
                                       dct:identifier ?strategischeDoelstellingId ;
                                       eli:has_member ?beleidsdoelstelling ;
                                       eli:is_realized_by ?strategischeDoelstellingExpression .

             OPTIONAL {
               ?strategischeDoelstellingExpression eli:description ?strategischeDoelstellingKorteOmschrijving .
             }
             OPTIONAL {
               ?strategischeDoelstellingExpression epvoc:expressionContent ?strategischeDoelstellingLangeOmschrijving .
             }
             OPTIONAL {
               ?strategischeDoelstellingExpression schema:code ?strategischeDoelstellingCode .
             }
             OPTIONAL {
               ?strategischeDoelstellingExpression schema:comment ?strategischeDoelstellingCommentaar .
             }
             OPTIONAL {
               ?strategischeDoelstellingExpression schema:review ?strategischeDoelstellingEvaluatie .
             }
           }
         }
       }

       ?actie eli:passed_by ?bestuur .

       OPTIONAL {
         ?bestuur dct:identifier ?bestuurId .
       }
       OPTIONAL {
         ?bestuur skos:prefLabel ?bestuurLabel .
       }
       OPTIONAL {
         ?bestuur org:classification ?bestuurClassification .
         ?bestuurClassification skos:prefLabel ?bestuurTypeLabel .
       }

       OPTIONAL {
         ?aanlevering a ${sparqlEscapeUri(AANLEVERING_TYPE)} ;
                      dct:hasPart ?actie .
          OPTIONAL {
            ?aanlevering dct:identifier ?aanleveringId ;
                         schema:datePublished ?aanleveringDatePublished .
         }
       }

       ?annotationBody a skos:Concept ;
                  mu:uuid ?annotationBodyId .

       OPTIONAL {
         ?annotationBody skos:notation ?annotationBodyNotation .
       }
       OPTIONAL {
         ?annotationBody skos:prefLabel ?annotationBodyLabel .
       }

       OPTIONAL {
         ?annotation nif:confidence ?score .
       }

       OPTIONAL {
         ?annotation dct:modified ?modified .
       }

       OPTIONAL {
         ?annotationTask prov:wasAssociatedWith ?agent .
         OPTIONAL {
           ?agent skos:prefLabel ?agentName .
         }
       }

       OPTIONAL {
         ?reviewAnnotation a ext:ReviewAnnotation ;
                           oa:hasTarget ?annotation .

         OPTIONAL {
           ?reviewAnnotation oa:hasBody ?reviewBody .
           FILTER (?reviewBody IN (review:approve, review:reject))
         }

         OPTIONAL {
           ?reviewAnnotation prov:influenced ?correction .

           ?correction a ext:CorrectionAnnotation ;
                       dct:replaces ?annotation ;
                       oa:hasBody ?correctionBody .

           ?correctionBody a skos:Concept ;
                           mu:uuid ?correctionBodyId .

           OPTIONAL {
             ?correctionBody skos:notation ?correctionBodyNotation .
           }
           OPTIONAL {
             ?correctionBody skos:prefLabel ?correctionBodyLabel .
           }
           OPTIONAL {
             ?correction nif:confidence ?correctionScore .
           }
           OPTIONAL {
             ?correction dct:created ?correctionCreated .
           }
           OPTIONAL {
             ?correctionTask a prov:Activity, tasks:Task ;
                             dct:created ?correctionTaskCreated ;
                             prov:generated ?correction .
           }
         }
       }
     }
     ORDER BY ?created ?annotation ?bestuur ?reviewAnnotation ?correction
   `);

   const byUri = new Map();
   const seenReviews = new Set();
   const besturenByAnnotation = new Map();
   const correctionsByUri = new Map();

   for (const binding of result.results.bindings) {
     const uri = binding.annotation.value;

     if (!byUri.has(uri)) {
       byUri.set(uri, {
         uri,
         id: binding.annotationId.value,
         created: binding.created?.value,
         modified: binding.modified?.value,
         agent: binding.agent?.value,
         agentName: binding.agentName?.value,
         score: binding.score?.value,
        actie: binding.actie
          ? {
              uri: binding.actie.value,
              id: binding.actieId.value,
              code: binding.actieCode?.value,
              externeRapporteringscode:
                binding.actieExterneRapporteringscode?.value,
              korteOmschrijving: binding.actieKorteOmschrijving?.value,
              langeOmschrijving: binding.actieLangeOmschrijving?.value,
              commentaar: binding.actieCommentaar?.value,
              evaluatie: binding.actieEvaluatie?.value,
            }
          : undefined,
        actieplan: complexWork(binding, 'actieplan'),
        beleidsdoelstelling: complexWork(binding, 'beleidsdoelstelling'),
        strategischeDoelstelling: complexWork(
          binding,
          'strategischeDoelstelling'
        ),
        bestuur: [],
        aanlevering: binding.aanlevering
          ? {
              uri: binding.aanlevering.value,
              id: binding.aanleveringId.value,
              datePublished: binding.aanleveringDatePublished?.value,
            }
          : undefined,
         annotationBody: binding.annotationBody
           ? {
               uri: binding.annotationBody.value,
               id: binding.annotationBodyId.value,
               notation: binding.annotationBodyNotation?.value,
             }
           : undefined,
         reviews: { rejected: 0, approved: 0, corrections: [] },
       });
     }

     const annotation = byUri.get(uri);

     preferLabel(annotation.annotationBody, 'label', binding.annotationBodyLabel);
     // An actie can be passed by more than one bestuur, typically the gemeente
     // and the OCMW, so these accumulate.
     const bestuurUri = binding.bestuur?.value;
     if (bestuurUri) {
       let besturen = besturenByAnnotation.get(uri);
       if (!besturen) {
         besturen = new Map();
         besturenByAnnotation.set(uri, besturen);
       }

       let bestuur = besturen.get(bestuurUri);
       if (!bestuur) {
         bestuur = { uri: bestuurUri, id: binding.bestuurId?.value };
         besturen.set(bestuurUri, bestuur);
         annotation.bestuur.push(bestuur);
       }

       preferLabel(bestuur, 'typeLabel', binding.bestuurTypeLabel);
       preferLabel(bestuur, 'grondgebied', binding.bestuurLabel);
     }

     const reviewUri = binding.reviewAnnotation?.value;
     if (reviewUri && !seenReviews.has(reviewUri)) {
       seenReviews.add(reviewUri);

       if (binding.reviewBody?.value === APPROVE) {
         annotation.reviews.approved++;
       } else if (binding.reviewBody?.value === REJECT) {
         annotation.reviews.rejected++;
       }
     }

     const correctionUri = binding.correction?.value;
     if (correctionUri) {
       if (!correctionsByUri.has(correctionUri)) {
         const correction = {
           uri: correctionUri,
           score: binding.correctionScore?.value,
           created:
             binding.correctionCreated?.value ??
             binding.correctionTaskCreated?.value,
           annotationBody: {
             uri: binding.correctionBody.value,
             id: binding.correctionBodyId.value,
             notation: binding.correctionBodyNotation?.value,
           },
         };

         correctionsByUri.set(correctionUri, correction);
         annotation.reviews.corrections.push(correction);
       }

       preferLabel(
         correctionsByUri.get(correctionUri).annotationBody,
         'label',
         binding.correctionBodyLabel
       );
     }
   }

   return [...byUri.values()];
 }

// Concepts can carry the same prefLabel more than once, e.g. once plain and
// once language tagged
const labelRanks = new WeakMap();

/**
 * Keeps the best available prefLabel in `field` on `target`: Dutch first, then
 * untagged, then anything else.
 */
function preferLabel(target, field, term) {
  if (!target || !term) {
    return;
  }

  const language = term['xml:lang'] ?? '';
  const rank = language.toLowerCase().startsWith('nl') ? 0 : language ? 2 : 1;

  let ranks = labelRanks.get(target);
  if (!ranks) {
    ranks = new Map();
    labelRanks.set(target, ranks);
  }

  const current = ranks.get(field);

  if (
    current === undefined ||
    rank < current ||
    (rank === current && term.value < target[field])
  ) {
    ranks.set(field, rank);
    target[field] = term.value;
  }
}

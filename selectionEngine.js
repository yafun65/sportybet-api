/* =========================================================
   SPORTYBET SELECTION ENGINE
   LIGHTWEIGHT QUALITY OPTIMIZER
========================================================= */


/* =========================
   NORMALIZE
========================= */

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


/* =========================
   ALLOWED COMPETITIONS
========================= */

const ALLOWED_COMPETITIONS = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
  "UEFA Europa League",
  "UEFA Conference League",
  "UEFA Nations League"
];


function isAllowedCompetition(name) {
  const value = normalize(name);

  return ALLOWED_COMPETITIONS.some(
    competition =>
      normalize(competition) === value
  );
}


/* =========================
   EVENT INFORMATION
========================= */

function getEventInfo(item) {
  const event = item?.event || {};

  const competition =
    event.competition ||
    event.sport?.category?.tournament?.name ||
    event.tournament?.name ||
    "";

  const category =
    event.category ||
    event.sport?.category?.name ||
    "";

  return {
    eventId:
      event.eventId || "",

    gameId:
      event.gameId || "",

    homeTeam:
      event.homeTeamName || "",

    awayTeam:
      event.awayTeamName || "",

    startTime:
      event.startTime ??
      event.estimateStartTime ??
      0,

    competition,

    category
  };
}


/* =========================
   EXTRACT CANDIDATES
========================= */

function extractCandidates(items) {

  const candidates = [];

  for (const item of items) {

    const event =
      getEventInfo(item);

    if (
      !event.eventId ||
      !event.homeTeam ||
      !event.awayTeam
    ) {
      continue;
    }

    if (
      !isAllowedCompetition(
        event.competition
      )
    ) {
      continue;
    }

    const markets =
      Array.isArray(item.markets)
        ? item.markets
        : [];

    for (const market of markets) {

      const marketId =
        String(
          market?.marketId ??
          market?.id ??
          ""
        );

      const marketName =
        market?.market ||
        market?.name ||
        market?.desc ||
        "";

      const specifier =
        market?.specifier ??
        null;

      const outcomes =
        Array.isArray(
          market?.outcomes
        )
          ? market.outcomes
          : [];

      for (const outcome of outcomes) {

        const odds =
          Number(
            outcome?.odds ??
            outcome?.price
          );

        if (
          !Number.isFinite(odds) ||
          odds <= 1
        ) {
          continue;
        }

        const probability =
          Number(
            outcome?.probability
          );

        const active =
          outcome?.isActive !== false &&
          outcome?.isActive !== 0;

        if (!active) {
          continue;
        }

        const outcomeId =
          String(
            outcome?.outcomeId ??
            outcome?.id ??
            ""
          );

        const pick =
          outcome?.pick ||
          outcome?.desc ||
          outcome?.name ||
          "";

        candidates.push({

          eventId:
            event.eventId,

          gameId:
            event.gameId,

          match:
            `${event.homeTeam} vs ${event.awayTeam}`,

          homeTeam:
            event.homeTeam,

          awayTeam:
            event.awayTeam,

          startTime:
            event.startTime,

          competition:
            event.competition,

          category:
            event.category,

          marketId,

          market:
            marketName,

          specifier,

          outcomeId,

          pick,

          odds,

          probability:
            Number.isFinite(probability)
              ? probability
              : null
        });
      }
    }
  }

  return candidates;
}


/* =========================
   PROBABILITY
========================= */

function getImpliedProbability(selection) {

  if (
    Number.isFinite(
      selection?.probability
    ) &&
    selection.probability > 0 &&
    selection.probability <= 1
  ) {
    return selection.probability;
  }

  const odds =
    Number(selection?.odds);

  if (
    !Number.isFinite(odds) ||
    odds <= 1
  ) {
    return 0;
  }

  return 1 / odds;
}


/* =========================
   MARKET FAMILY
========================= */

function marketFamily(selection) {

  const market =
    normalize(
      selection.market
    );

  if (
    market.includes(
      "double chance"
    )
  ) {
    return "double-chance";
  }

  if (
    market.includes(
      "over/under"
    )
  ) {
    return "over-under";
  }

  if (
    market.includes(
      "draw no bet"
    )
  ) {
    return "draw-no-bet";
  }

  if (
    market.includes(
      "gg/ng"
    )
  ) {
    return "gg-ng";
  }

  if (
    market.includes(
      "asian handicap"
    )
  ) {
    return "asian-handicap";
  }

  if (
    market.includes(
      "corners"
    )
  ) {
    return "corners";
  }

  return market || "other";
}


/* =========================
   EVENT KEY
========================= */

function eventKey(selection) {

  return (
    selection.eventId ||
    selection.gameId ||
    selection.match
  );
}


/* =========================
   MARKET ADJUSTMENT
========================= */

function getMarketAdjustment(selection) {

  const market =
    normalize(selection.market);

  let adjustment = 0;

  if (
    market.includes(
      "double chance"
    )
  ) {
    adjustment += 2;
  }

  if (
    market.includes(
      "draw no bet"
    )
  ) {
    adjustment += 2;
  }

  if (
    market.includes(
      "over/under"
    )
  ) {
    adjustment += 1;
  }

  if (
    market.includes(
      "asian handicap"
    )
  ) {
    adjustment += 1;
  }

  if (
    market.includes(
      "gg/ng"
    )
  ) {
    adjustment += 1;
  }

  if (
    market.includes(
      "corners"
    )
  ) {
    adjustment += 1;
  }

  return adjustment;
}


/* =========================
   ODDS QUALITY
========================= */

function getOddsQuality(selection) {

  const odds =
    Number(selection.odds);

  if (!Number.isFinite(odds)) {
    return -20;
  }

  if (odds < 1.17) {
    return -8;
  }

  if (odds < 1.20) {
    return -5;
  }

  if (odds < 1.25) {
    return -3;
  }

  if (
    odds >= 1.30 &&
    odds <= 2.50
  ) {
    return 4;
  }

  if (
    odds > 2.50 &&
    odds <= 3.50
  ) {
    return -1;
  }

  return 0;
}


/* =========================
   STRENGTH SCORE
========================= */

function scoreSelection(selection) {

  const probability =
    getImpliedProbability(
      selection
    );

  let score =
    probability * 100;

  score +=
    getMarketAdjustment(
      selection
    );

  score +=
    getOddsQuality(
      selection
    );

  const odds =
    Number(selection.odds);

  if (odds >= 4) {
    score -= 10;
  }

  if (odds >= 6) {
    score -= 15;
  }

  return Math.max(
    1,
    Math.min(
      95,
      Math.round(score)
    )
  );
}


/* =========================
   RISK
========================= */

function getRisk(score) {

  if (score >= 82) {
    return "Lower";
  }

  if (score >= 70) {
    return "Moderate";
  }

  return "Higher";
}


/* =========================
   FILTER
========================= */

function filterCandidates(
  candidates,
  options
) {

  return candidates.filter(
    selection => {

      const odds =
        Number(selection.odds);

      const probability =
        getImpliedProbability(
          selection
        );

      const score =
        scoreSelection(
          selection
        );

      const market =
        normalize(
          selection.market
        );

      if (
        odds < options.minOdds ||
        odds > options.maxOdds
      ) {
        return false;
      }

      if (
        probability <
        options.minProbability
      ) {
        return false;
      }

      if (
        score <
        options.minStrength
      ) {
        return false;
      }

      if (
        market.includes(
          "correct score"
        )
      ) {
        return false;
      }

      if (
        market.includes(
          "half time/full time"
        )
      ) {
        return false;
      }

      return true;
    }
  );
}


/* =========================
   CANDIDATE QUALITY
========================= */

function candidateQuality(selection) {

  const strength =
    scoreSelection(
      selection
    );

  const odds =
    Number(selection.odds);

  let quality =
    strength;

  if (
    odds >= 1.30 &&
    odds <= 2.50
  ) {
    quality += 5;
  }

  if (odds < 1.20) {
    quality -= 8;
  }

  if (odds < 1.17) {
    quality -= 5;
  }

  return quality;
}


/* =========================
   PREPARE POOL
========================= */

function prepareCandidates(
  candidates
) {

  /*
   * Sort by quality.
   */

  const sorted =
    [...candidates].sort(
      (a, b) =>
        candidateQuality(b) -
        candidateQuality(a)
    );


  /*
   * Keep a manageable pool.
   *
   * This is deliberately much smaller
   * than the previous 900+ candidate
   * beam-search pool.
   */

  const MAX_POOL =
    300;


  const pool = [];

  const eventCounts =
    new Map();


  for (
    const candidate of sorted
  ) {

    if (
      pool.length >=
      MAX_POOL
    ) {
      break;
    }

    const key =
      eventKey(candidate);

    const count =
      eventCounts.get(key) ||
      0;

    if (count >= 3) {
      continue;
    }

    pool.push(candidate);

    eventCounts.set(
      key,
      count + 1
    );
  }


  /*
   * Add some higher-odds selections
   * so 50x and 100x remain possible.
   */

  const higherOdds =
    [...candidates]
      .filter(
        selection =>
          Number(selection.odds) >= 1.50
      )
      .sort(
        (a, b) =>
          candidateQuality(b) -
          candidateQuality(a)
      )
      .slice(0, 150);


  const combined = [
    ...pool,
    ...higherOdds
  ];


  /*
   * Remove exact duplicates.
   */

  const unique =
    new Map();


  for (
    const candidate
    of combined
  ) {

    const key =
      [
        candidate.eventId,
        candidate.marketId,
        candidate.specifier || "",
        candidate.outcomeId
      ].join("|");

    if (
      !unique.has(key)
    ) {
      unique.set(
        key,
        candidate
      );
    }
  }


  return [
    ...unique.values()
  ];
}


/* =========================
   COMBINATION QUALITY
========================= */

function combinationQuality(
  state,
  target
) {

  if (
    !state.selections.length
  ) {
    return 999999;
  }


  const ratio =
    state.totalOdds /
    target;


  const distance =
    Math.abs(
      Math.log(ratio)
    );


  const averageStrength =
    state.selections.reduce(
      (sum, selection) =>
        sum +
        scoreSelection(selection),
      0
    ) /
    state.selections.length;


  const lowOddsCount =
    state.selections.filter(
      selection =>
        Number(selection.odds) <
        1.20
    ).length;


  const weakCount =
    state.selections.filter(
      selection =>
        scoreSelection(selection) <
        70
    ).length;


  /*
   * We still want target accuracy,
   * but quality matters more now.
   */

  return (
    distance * 200 -
    averageStrength * 1.10 +
    lowOddsCount * 2 +
    weakCount * 2 +
    Math.max(
      0,
      state.selections.length - 8
    ) * 0.50
  );
}


/* =========================
   BUILD COMBINATION
========================= */

function buildCombination(
  candidates,
  target,
  maxSelections = 15
) {

  if (
    !candidates.length ||
    !Number.isFinite(target) ||
    target <= 1
  ) {
    return null;
  }


  const pool =
    prepareCandidates(
      candidates
    );


  /*
   * Maximum allowed odds.
   */

  const upperTarget =
    target * 1.05;


  /*
   * Instead of an expensive beam search,
   * maintain only the best combinations
   * after each level.
   */

  const STATE_LIMIT =
    120;


  const maxLegs =
    Math.min(
      maxSelections,
      15
    );


  let states = [
    {
      totalOdds: 1,
      selections: [],
      usedEvents: new Set(),
      marketCounts: new Map()
    }
  ];


  let bestState =
    null;


  for (
    let depth = 0;
    depth < maxLegs;
    depth++
  ) {

    const next = [];


    for (
      const state of states
    ) {

      for (
        const candidate of pool
      ) {

        const key =
          eventKey(candidate);


        if (
          state.usedEvents.has(key)
        ) {
          continue;
        }


        const family =
          marketFamily(
            candidate
          );


        const familyCount =
          state.marketCounts.get(
            family
          ) || 0;


        if (
          familyCount >= 4
        ) {
          continue;
        }


        const odds =
          Number(candidate.odds);


        const total =
          state.totalOdds *
          odds;


        if (
          !Number.isFinite(total) ||
          total > upperTarget
        ) {
          continue;
        }


        const usedEvents =
          new Set(
            state.usedEvents
          );

        usedEvents.add(key);


        const marketCounts =
          new Map(
            state.marketCounts
          );

        marketCounts.set(
          family,
          familyCount + 1
        );


        const newState = {

          totalOdds:
            total,

          selections: [
            ...state.selections,
            candidate
          ],

          usedEvents,

          marketCounts
        };


        next.push(
          newState
        );


        /*
         * Track the best result.
         */

        if (
          !bestState ||
          combinationQuality(
            newState,
            target
          ) <
          combinationQuality(
            bestState,
            target
          )
        ) {

          bestState =
            newState;
        }

      }
    }


    if (
      !next.length
    ) {
      break;
    }


    /*
     * Sort all generated states
     * and keep only the best ones.
     */

    next.sort(
      (a, b) =>
        combinationQuality(
          a,
          target
        ) -
        combinationQuality(
          b,
          target
        )
    );


    /*
     * Remove states with almost
     * identical odds totals.
     */

    const selected = [];

    const buckets =
      new Set();


    for (
      const state of next
    ) {

      const bucket =
        Math.round(
          state.totalOdds * 100
        ) / 100;


      const signature =
        `${state.selections.length}|${bucket}`;


      if (
        buckets.has(signature)
      ) {
        continue;
      }


      buckets.add(signature);

      selected.push(state);


      if (
        selected.length >=
        STATE_LIMIT
      ) {
        break;
      }
    }


    states =
      selected;


    /*
     * If we have an excellent target
     * match with reasonable strength,
     * stop.
     */

    if (
      bestState
    ) {

      const difference =
        Math.abs(
          bestState.totalOdds -
          target
        );


      const averageStrength =
        bestState.selections.reduce(
          (sum, selection) =>
            sum +
            scoreSelection(selection),
          0
        ) /
        bestState.selections.length;


      if (
        difference <=
          target * 0.005 &&
        averageStrength >=
          70
      ) {
        break;
      }
    }
  }


  if (
    !bestState ||
    !bestState.selections.length
  ) {
    return null;
  }


  /*
   * Finalize output.
   */

  const selections =
    bestState.selections.map(
      selection => {

        const strength =
          scoreSelection(
            selection
          );

        const bookmakerProbability =
          getImpliedProbability(
            selection
          );


        return {

          ...selection,

          bookmakerProbability:
            Number(
              (
                bookmakerProbability *
                100
              ).toFixed(2)
            ),

          impliedProbability:
            Number(
              (
                bookmakerProbability *
                100
              ).toFixed(2)
            ),

          strengthScore:
            strength,

          risk:
            getRisk(
              strength
            )
        };
      }
    );


  const averageStrength =
    selections.reduce(
      (sum, selection) =>
        sum +
        selection.strengthScore,
      0
    ) /
    selections.length;


  const lowOddsSelections =
    selections.filter(
      selection =>
        Number(selection.odds) <
        1.20
    ).length;


  return {

    totalOdds:
      Number(
        bestState.totalOdds.toFixed(2)
      ),

    targetOdds:
      Number(
        target.toFixed(2)
      ),

    difference:
      Number(
        (
          bestState.totalOdds -
          target
        ).toFixed(2)
      ),

    selectionCount:
      selections.length,

    averageStrength:
      Number(
        averageStrength.toFixed(2)
      ),

    lowOddsSelections,

    selections
  };
}


/* =========================
   SORT CANDIDATES
========================= */

function sortCandidates(
  candidates
) {

  return [...candidates].sort(
    (a, b) =>
      candidateQuality(b) -
      candidateQuality(a)
  );
}


/* =========================
   MAIN ENGINE
========================= */

export function runSelectionEngine(
  items,
  target,
  options = {}
) {

  const settings = {

    minOdds:
      options.minOdds ??
      1.15,

    maxOdds:
      options.maxOdds ??
      3.5,

    minProbability:
      options.minProbability ??
      0.55,

    minStrength:
      options.minStrength ??
      60,

    maxSelections:
      options.maxSelections ??
      15
  };


  const numericTarget =
    Number(target);


  const candidates =
    extractCandidates(
      items
    );


  const filtered =
    filterCandidates(
      candidates,
      settings
    );


  const combination =
    buildCombination(
      filtered,
      numericTarget,
      settings.maxSelections
    );


  const topCandidates =
    sortCandidates(
      filtered
    )
      .slice(0, 20)
      .map(
        selection => {

          const strength =
            scoreSelection(
              selection
            );

          const probability =
            getImpliedProbability(
              selection
            );


          return {

            ...selection,

            bookmakerProbability:
              Number(
                (
                  probability *
                  100
                ).toFixed(2)
              ),

            impliedProbability:
              Number(
                (
                  probability *
                  100
                ).toFixed(2)
              ),

            strengthScore:
              strength,

            risk:
              getRisk(
                strength
              )
          };
        }
      );


  return {

    success:
      Boolean(
        combination
      ),

    candidatesFound:
      candidates.length,

    candidatesAfterFiltering:
      filtered.length,

    targetOdds:
      numericTarget,

    combination,

    topCandidates
  };
}

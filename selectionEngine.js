/* =========================================================
   SPORTYBET SELECTION ENGINE
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


        const probability =
          Number(
            outcome?.probability
          );


        const active =
          outcome?.isActive !== false &&
          outcome?.isActive !== 0;


        if (
          !active ||
          !Number.isFinite(odds) ||
          odds <= 1
        ) {
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
   BOOKMAKER PROBABILITY
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
   MARKET ADJUSTMENT
========================= */

function getMarketAdjustment(selection) {

  const market =
    normalize(selection.market);


  let adjustment = 0;


  if (
    market.includes("double chance")
  ) {
    adjustment += 4;
  }


  if (
    market.includes("draw no bet")
  ) {
    adjustment += 3;
  }


  if (
    market.includes("over/under")
  ) {
    adjustment += 2;
  }


  if (
    market.includes("asian handicap")
  ) {
    adjustment += 2;
  }


  if (
    market.includes("gg/ng")
  ) {
    adjustment += 1;
  }


  if (
    market.includes("corners")
  ) {
    adjustment += 2;
  }


  if (
    market.includes("correct score")
  ) {
    adjustment -= 25;
  }


  if (
    market.includes(
      "half time/full time"
    )
  ) {
    adjustment -= 15;
  }


  return adjustment;
}


/* =========================
   SELECTION STRENGTH
========================= */

function scoreSelection(selection) {

  const probability =
    getImpliedProbability(
      selection
    );


  let score =
    probability * 100;


  const odds =
    Number(selection.odds);


  /*
   * Reward a useful middle
   * odds range without allowing
   * it to dominate probability.
   */

  if (
    odds >= 1.25 &&
    odds <= 2.50
  ) {
    score += 3;
  }


  score +=
    getMarketAdjustment(
      selection
    );


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
   FILTER CANDIDATES
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
   PREPARE CANDIDATES
========================= */

function prepareCandidates(
  candidates
) {

  /*
   * Keep only the strongest candidate
   * selections from each event/market
   * area so the optimizer doesn't have
   * to process thousands of near-identical
   * options.
   */

  const sorted =
    [...candidates].sort(
      (a, b) => {

        const scoreDifference =
          scoreSelection(b) -
          scoreSelection(a);


        if (
          scoreDifference !== 0
        ) {
          return scoreDifference;
        }


        return (
          Number(b.odds) -
          Number(a.odds)
        );

      }
    );


  /*
   * Maximum number of candidates
   * entering the beam search.
   */

  const MAX_POOL =
    700;


  const pool = [];


  /*
   * Limit repeated event entries.
   */

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


    if (count >= 5) {
      continue;
    }


    pool.push(candidate);


    eventCounts.set(
      key,
      count + 1
    );

  }


  /*
   * Add a small amount of odds
   * diversity so the optimizer can
   * actually reach larger targets.
   */

  const oddsSorted =
    [...candidates]
      .sort(
        (a, b) =>
          Number(b.odds) -
          Number(a.odds)
      )
      .slice(0, 150);


  const combined = [
    ...pool,
    ...oddsSorted
  ];


  /*
   * Remove duplicate selections.
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
   STATE QUALITY
========================= */

function stateQuality(
  state,
  target
) {

  const ratio =
    state.totalOdds /
    target;


  /*
   * Log distance gives a balanced
   * measure for both high and low
   * totals.
   */

  const distance =
    Math.abs(
      Math.log(
        ratio
      )
    );


  /*
   * Average selection strength.
   */

  const averageStrength =
    state.selections.length
      ? state.selections.reduce(
          (sum, selection) =>
            sum +
            scoreSelection(
              selection
            ),
          0
        ) /
        state.selections.length
      : 0;


  /*
   * Small penalty for excessive
   * numbers of selections.
   */

  const legPenalty =
    Math.max(
      0,
      state.selections.length - 10
    ) * 0.015;


  /*
   * Lower score is better.
   */

  return (
    distance * 100 -
    averageStrength * 0.035 +
    legPenalty
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
   * Don't allow combinations to
   * overshoot excessively.
   */

  const hardUpperTarget =
    target * 1.05;


  /*
   * Beam size controls speed.
   */

  const BEAM_SIZE =
    350;


  /*
   * Maximum selections allowed.
   */

  const maxLegs =
    Math.min(
      maxSelections,
      15
    );


  /*
   * Start with an empty state.
   */

  let beam = [
    {
      totalOdds: 1,
      selections: [],
      usedEvents: new Set(),
      marketCounts: new Map()
    }
  ];


  let bestState = null;


  /*
   * Search level by level.
   */

  for (
    let depth = 0;
    depth < maxLegs;
    depth++
  ) {

    const nextStates = [];


    for (
      const state of beam
    ) {

      for (
        const candidate
        of pool
      ) {

        const key =
          eventKey(candidate);


        /*
         * Never use the same event twice.
         */

        if (
          state.usedEvents.has(
            key
          )
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


        /*
         * Maximum 4 selections from
         * the same market family.
         */

        if (
          familyCount >= 4
        ) {
          continue;
        }


        const odds =
          Number(
            candidate.odds
          );


        const newTotal =
          state.totalOdds *
          odds;


        if (
          !Number.isFinite(
            newTotal
          )
        ) {
          continue;
        }


        if (
          newTotal >
          hardUpperTarget
        ) {
          continue;
        }


        /*
         * Don't keep adding selections
         * after the target has already
         * been reached.
         */

        if (
          state.totalOdds >=
          target
        ) {
          continue;
        }


        const usedEvents =
          new Set(
            state.usedEvents
          );


        usedEvents.add(
          key
        );


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
            newTotal,

          selections: [
            ...state.selections,
            candidate
          ],

          usedEvents,

          marketCounts

        };


        /*
         * If this state is closer to
         * the target, remember it.
         */

        if (
          !bestState ||
          stateQuality(
            newState,
            target
          ) <
          stateQuality(
            bestState,
            target
          )
        ) {

          bestState =
            newState;

        }


        nextStates.push(
          newState
        );

      }

    }


    if (
      !nextStates.length
    ) {
      break;
    }


    /*
     * Remove near-identical states.
     */

    const stateMap =
      new Map();


    for (
      const state
      of nextStates
    ) {

      /*
       * Bucket total odds to prevent
       * hundreds of virtually identical
       * states.
       */

      const bucket =
        Math.round(
          state.totalOdds *
          100
        ) / 100;


      const signature =
        [
          state.selections.length,
          bucket
        ].join("|");


      const existing =
        stateMap.get(
          signature
        );


      if (
        !existing ||
        stateQuality(
          state,
          target
        ) <
        stateQuality(
          existing,
          target
        )
      ) {

        stateMap.set(
          signature,
          state
        );

      }

    }


    /*
     * Keep the best states.
     */

    beam =
      [...stateMap.values()]
        .sort(
          (a, b) =>
            stateQuality(
              a,
              target
            ) -
            stateQuality(
              b,
              target
            )
        )
        .slice(
          0,
          BEAM_SIZE
        );


    /*
     * If we have a very close result,
     * stop searching.
     */

    if (
      bestState &&
      Math.abs(
        bestState.totalOdds -
        target
      ) <=
      target * 0.01
    ) {
      break;
    }

  }


  if (
    !bestState ||
    !bestState.selections.length
  ) {
    return null;
  }


  /*
   * Finalize selections.
   */

  const selections =
    bestState.selections.map(
      selection => {

        const strength =
          scoreSelection(
            selection
          );


        return {

          ...selection,

          impliedProbability:
            Number(
              (
                getImpliedProbability(
                  selection
                ) * 100
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


  const totalOdds =
    bestState.totalOdds;


  return {

    totalOdds:
      Number(
        totalOdds.toFixed(2)
      ),

    targetOdds:
      Number(
        target.toFixed(2)
      ),

    difference:
      Number(
        (
          totalOdds -
          target
        ).toFixed(2)
      ),

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
    (a, b) => {

      const scoreDifference =
        scoreSelection(b) -
        scoreSelection(a);


      if (
        scoreDifference !== 0
      ) {
        return scoreDifference;
      }


      return (
        Number(b.odds) -
        Number(a.odds)
      );

    }
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


          return {

            ...selection,

            impliedProbability:
              Number(
                (
                  getImpliedProbability(
                    selection
                  ) * 100
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

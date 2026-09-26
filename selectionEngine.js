/* =========================================================
   SPORTYBET SELECTION ENGINE
   STRATEGY-AWARE LIGHTWEIGHT QUALITY OPTIMIZER
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

  const event =
    item?.event || {};

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

function getOddsQuality(
  selection,
  strategy = "balanced"
) {

  const odds =
    Number(selection.odds);

  if (!Number.isFinite(odds)) {
    return -20;
  }


  /*
   * Conservative mode:
   *
   * Do NOT penalize low odds.
   *
   * The whole purpose of this strategy
   * is to allow smaller individual odds.
   */

  if (
    strategy === "conservative"
  ) {

    if (odds <= 1.20) {
      return 3;
    }

    return -20;
  }


  /*
   * Aggressive mode:
   *
   * Give more room to higher odds.
   */

  if (
    strategy === "aggressive"
  ) {

    if (
      odds >= 1.50 &&
      odds <= 3.50
    ) {
      return 5;
    }

    if (
      odds > 3.50 &&
      odds <= 5.00
    ) {
      return 3;
    }

    if (odds < 1.30) {
      return -4;
    }

    return 0;
  }


  /*
   * Balanced mode.
   */

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

function scoreSelection(
  selection,
  strategy = "balanced"
) {

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
      selection,
      strategy
    );

  const odds =
    Number(selection.odds);


  /*
   * Only apply large odds penalties
   * outside conservative mode.
   */

  if (
    strategy !== "conservative"
  ) {

    if (odds >= 4) {
      score -= 10;
    }

    if (odds >= 6) {
      score -= 15;
    }
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
          selection,
          options.strategy
        );

      const market =
        normalize(
          selection.market
        );


      /*
       * HARD ODDS LIMIT
       *
       * This guarantees that a strategy
       * can never silently exceed its
       * configured maximum odds.
       */

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


      /*
       * Avoid very high-variance markets.
       */

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

function candidateQuality(
  selection,
  strategy = "balanced"
) {

  const strength =
    scoreSelection(
      selection,
      strategy
    );

  const odds =
    Number(selection.odds);

  let quality =
    strength;


  /*
   * Balanced prefers useful
   * middle-range odds.
   */

  if (
    strategy === "balanced" &&
    odds >= 1.30 &&
    odds <= 2.50
  ) {
    quality += 5;
  }


  /*
   * Conservative prefers the
   * lower-odds range.
   */

  if (
    strategy === "conservative"
  ) {

    if (
      odds >= 1.10 &&
      odds <= 1.20
    ) {
      quality += 4;
    }

    /*
     * Slight preference for odds
     * closer to 1.20, because this
     * reduces the number of legs
     * needed to build the target.
     */

    if (
      odds >= 1.15 &&
      odds <= 1.20
    ) {
      quality += 3;
    }
  }


  /*
   * Aggressive prefers higher odds.
   */

  if (
    strategy === "aggressive"
  ) {

    if (
      odds >= 1.50 &&
      odds <= 3.50
    ) {
      quality += 5;
    }

    if (
      odds > 3.50
    ) {
      quality += 2;
    }
  }


  return quality;
}


/* =========================
   PREPARE POOL
========================= */

function prepareCandidates(
  candidates,
  strategy = "balanced"
) {

  const sorted =
    [...candidates].sort(
      (a, b) =>
        candidateQuality(
          b,
          strategy
        ) -
        candidateQuality(
          a,
          strategy
        )
    );


  /*
   * Conservative may need many
   * different events.
   *
   * Keep a larger pool.
   */

  const MAX_POOL =
    strategy === "conservative"
      ? 500
      : 300;


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


    if (
      count >= 3
    ) {
      continue;
    }


    pool.push(candidate);

    eventCounts.set(
      key,
      count + 1
    );
  }


  /*
   * Higher-odds candidates are useful
   * for balanced/aggressive strategies.
   *
   * Conservative does not need them
   * because its max odds are already
   * capped at 1.20.
   */

  let higherOdds = [];


  if (
    strategy !== "conservative"
  ) {

    higherOdds =
      [...candidates]
        .filter(
          selection =>
            Number(selection.odds) >=
            1.50
        )
        .sort(
          (a, b) =>
            candidateQuality(
              b,
              strategy
            ) -
            candidateQuality(
              a,
              strategy
            )
        )
        .slice(0, 150);
  }


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
  target,
  strategy = "balanced"
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
        scoreSelection(
          selection,
          strategy
        ),
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
        scoreSelection(
          selection,
          strategy
        ) < 70
    ).length;


  let penalty =
    0;


  /*
   * Conservative:
   *
   * Do not punish the engine for
   * needing many selections.
   */

  if (
    strategy === "conservative"
  ) {

    penalty =
      weakCount * 1.5;

  } else {

    /*
     * Balanced/aggressive:
     * modest penalty for long tickets.
     */

    penalty =
      weakCount * 2 +
      Math.max(
        0,
        state.selections.length - 8
      ) * 0.50;
  }


  /*
   * Conservative should strongly
   * prioritize reaching the target
   * while staying inside its odds cap.
   */

  if (
    strategy === "conservative"
  ) {

    return (
      distance * 200 -
      averageStrength * 1.05 +
      penalty
    );
  }


  return (
    distance * 200 -
    averageStrength * 1.10 +
    lowOddsCount * 2 +
    penalty
  );
}


/* =========================
   BUILD COMBINATION
========================= */

function buildCombination(
  candidates,
  target,
  options = {}
) {

  if (
    !candidates.length ||
    !Number.isFinite(target) ||
    target <= 1
  ) {
    return null;
  }


  const strategy =
    options.strategy ||
    "balanced";


  const maxSelections =
    Number(
      options.maxSelections ??
      15
    );


  const pool =
    prepareCandidates(
      candidates,
      strategy
    );


  /*
   * Allow a very small overshoot.
   */

  const upperTarget =
    target * 1.05;


  /*
   * Lightweight state limit.
   */

  const STATE_LIMIT =
    strategy === "conservative"
      ? 150
      : 120;


  /*
   * IMPORTANT:
   *
   * There is NO artificial 15-leg
   * ceiling anymore.
   *
   * The strategy's maxSelections
   * is now the actual limit.
   */

  const maxLegs =
    Math.max(
      1,
      Math.floor(
        maxSelections
      )
    );


  let states = [

    {
      totalOdds: 1,

      selections: [],

      usedEvents:
        new Set(),

      marketCounts:
        new Map()
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


        /*
         * One selection per match.
         */

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


        /*
         * Prevent one market family
         * from dominating the ticket.
         */

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
         * Track best state.
         */

        if (
          !bestState ||
          combinationQuality(
            newState,
            target,
            strategy
          ) <
          combinationQuality(
            bestState,
            target,
            strategy
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
     * Sort generated states.
     */

    next.sort(
      (a, b) =>
        combinationQuality(
          a,
          target,
          strategy
        ) -
        combinationQuality(
          b,
          target,
          strategy
        )
    );


    /*
     * Keep only the best state
     * for each odds bucket + depth.
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
     * Stop when we have a very close
     * target with adequate strength.
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
            scoreSelection(
              selection,
              strategy
            ),
          0
        ) /
        bestState.selections.length;


      if (
        difference <=
          target * 0.005 &&
        averageStrength >=
          (
            strategy === "aggressive"
              ? 65
              : 68
          )
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
   * IMPORTANT:
   *
   * Never return a combination
   * above the configured max odds.
   *
   * Candidate filtering already guarantees
   * this, but this extra check protects
   * against future changes.
   */

  const invalidSelection =
    bestState.selections.some(
      selection =>
        Number(selection.odds) <
          Number(options.minOdds) ||
        Number(selection.odds) >
          Number(options.maxOdds)
    );


  if (
    invalidSelection
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
            selection,
            strategy
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
  candidates,
  strategy = "balanced"
) {

  return [...candidates].sort(
    (a, b) =>
      candidateQuality(
        b,
        strategy
      ) -
      candidateQuality(
        a,
        strategy
      )
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

    strategy:
      options.strategy ??
      "balanced",

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


  /*
   * Normalize strategy.
   */

  const validStrategies = [
    "conservative",
    "balanced",
    "aggressive",
    "custom"
  ];


  if (
    !validStrategies.includes(
      settings.strategy
    )
  ) {
    settings.strategy =
      "balanced";
  }


  /*
   * Ensure numeric limits.
   */

  settings.minOdds =
    Number(settings.minOdds);

  settings.maxOdds =
    Number(settings.maxOdds);

  settings.minProbability =
    Number(settings.minProbability);

  settings.minStrength =
    Number(settings.minStrength);

  settings.maxSelections =
    Number(settings.maxSelections);


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
      settings
    );


  const topCandidates =
    sortCandidates(
      filtered,
      settings.strategy
    )
      .slice(0, 20)
      .map(
        selection => {

          const strength =
            scoreSelection(
              selection,
              settings.strategy
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

    strategy:
      settings.strategy,

    strategyConfig: {

      minOdds:
        settings.minOdds,

      maxOdds:
        settings.maxOdds,

      maxSelections:
        settings.maxSelections

    },

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

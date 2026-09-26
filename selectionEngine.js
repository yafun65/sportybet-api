/*
 * ============================================
 * SPORTYBET SELECTION ENGINE
 * STRATEGY-AWARE VERSION
 * ============================================
 */

const ENGINE_VERSION = "STRATEGY_ENGINE_V3";


/*
 * ============================================
 * HELPERS
 * ============================================
 */

function toNumber(value, fallback = 0) {

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;

}


function clamp(value, min, max) {

  return Math.max(
    min,
    Math.min(max, value)
  );

}


/*
 * ============================================
 * STRATEGY CONFIG
 * ============================================
 */

function getStrategyConfig(strategy) {

  switch (strategy) {

    case "conservative":

      return {
        minOdds: 1.01,
        maxOdds: 1.20,
        minProbability: 0.55,
        minStrength: 60,
        maxSelections: 50
      };


    case "balanced":

      return {
        minOdds: 1.15,
        maxOdds: 3.50,
        minProbability: 0.55,
        minStrength: 60,
        maxSelections: 15
      };


    case "aggressive":

      return {
        minOdds: 1.50,
        maxOdds: 5.00,
        minProbability: 0.45,
        minStrength: 45,
        maxSelections: 15
      };


    default:

      return {
        minOdds: 1.01,
        maxOdds: 3.50,
        minProbability: 0.55,
        minStrength: 60,
        maxSelections: 30
      };

  }

}


/*
 * ============================================
 * ODDS QUALITY
 * ============================================
 */

function getOddsQuality(
  selection,
  strategy
) {

  const odds =
    toNumber(selection.odds);


  if (strategy === "conservative") {

    if (odds >= 1.01 && odds <= 1.10) {
      return 100;
    }

    if (odds <= 1.15) {
      return 96;
    }

    if (odds <= 1.20) {
      return 92;
    }

    return -100;

  }


  if (strategy === "aggressive") {

    if (odds >= 1.50 && odds <= 2.00) {
      return 100;
    }

    if (odds <= 2.50) {
      return 94;
    }

    if (odds <= 3.50) {
      return 88;
    }

    if (odds <= 5.00) {
      return 80;
    }

    return -100;

  }


  /*
   * BALANCED
   */

  if (odds >= 1.30 && odds <= 1.80) {
    return 100;
  }

  if (odds < 1.30) {
    return 88;
  }

  if (odds <= 2.20) {
    return 92;
  }

  if (odds <= 3.50) {
    return 80;
  }

  return -100;

}


/*
 * ============================================
 * SELECTION SCORE
 * ============================================
 */

function scoreSelection(
  selection,
  strategy
) {

  const probability =
    clamp(
      toNumber(selection.probability),
      0,
      1
    );


  const strength =
    clamp(
      toNumber(selection.strengthScore),
      0,
      100
    );


  const oddsQuality =
    getOddsQuality(
      selection,
      strategy
    );


  if (oddsQuality < 0) {
    return -9999;
  }


  /*
   * Probability contributes strongly.
   */

  const probabilityScore =
    probability * 100;


  /*
   * Strength contributes strongly.
   */

  const strengthScore =
    strength;


  /*
   * Combined quality.
   */

  return (
    probabilityScore * 0.45 +
    strengthScore * 0.35 +
    oddsQuality * 0.20
  );

}


/*
 * ============================================
 * EXTRACT CANDIDATES
 * ============================================
 */

function extractCandidates(items) {

  const candidates = [];


  for (
    const item
    of Array.isArray(items)
      ? items
      : []
  ) {

    if (
      !item ||
      !item.event
    ) {
      continue;
    }


    const event =
      item.event;


    const markets =
      Array.isArray(item.markets)
        ? item.markets
        : [];


    for (
      const market
      of markets
    ) {

      const outcomes =
        Array.isArray(
          market.outcomes
        )
          ? market.outcomes
          : [];


      for (
        const outcome
        of outcomes
      ) {

        if (
          !outcome ||
          outcome.isActive === false
        ) {
          continue;
        }


        const odds =
          toNumber(
            outcome.odds
          );


        const probability =
          toNumber(
            outcome.probability
          );


        if (
          odds < 1.01 ||
          probability <= 0
        ) {
          continue;
        }


        const marketName =
          String(
            market.market ||
            market.name ||
            market.desc ||
            ""
          );


        /*
         * Exclude markets that are generally
         * too volatile for this optimizer.
         */

        const lowerMarket =
          marketName.toLowerCase();


        if (
          lowerMarket.includes(
            "correct score"
          ) ||
          lowerMarket.includes(
            "half time/full time"
          )
        ) {
          continue;
        }


        /*
         * Strength based primarily on bookmaker
         * supplied probability.
         */

        let strengthScore =
          Math.round(
            probability * 100
          );


        /*
         * Give a small quality adjustment
         * for odds.
         */

        if (odds >= 1.30) {
          strengthScore += 2;
        }


        if (odds >= 1.50) {
          strengthScore += 2;
        }


        strengthScore =
          clamp(
            strengthScore,
            0,
            100
          );


        candidates.push({

          eventId:
            String(
              event.eventId ||
              event.id ||
              ""
            ),

          gameId:
            String(
              event.gameId ||
              ""
            ),

          match:
            `${event.homeTeamName || ""} vs ${event.awayTeamName || ""}`,

          homeTeam:
            event.homeTeamName ||
            "",

          awayTeam:
            event.awayTeamName ||
            "",

          startTime:
            event.startTime ??
            null,

          competition:
            event.competition ||
            "",

          category:
            event.category ||
            "",

          marketId:
            String(
              market.marketId ||
              market.id ||
              ""
            ),

          market:
            marketName,

          specifier:
            market.specifier ??
            null,

          outcomeId:
            String(
              outcome.outcomeId ||
              outcome.id ||
              ""
            ),

          pick:
            outcome.pick ||
            outcome.desc ||
            "",

          odds,

          probability,

          bookmakerProbability:
            Number(
              (
                probability * 100
              ).toFixed(2)
            ),

          impliedProbability:
            Number(
              (
                probability * 100
              ).toFixed(2)
            ),

          strengthScore,

          risk:
            strengthScore >= 80
              ? "Lower"
              : strengthScore >= 65
                ? "Moderate"
                : "Higher"

        });

      }

    }

  }


  return candidates;

}


/*
 * ============================================
 * FILTER CANDIDATES
 * ============================================
 */

function filterCandidates(
  candidates,
  options
) {

  return candidates.filter(
    selection => {

      const odds =
        toNumber(
          selection.odds
        );


      const probability =
        toNumber(
          selection.probability
        );


      const strength =
        toNumber(
          selection.strengthScore
        );


      /*
       * HARD ODDS LIMIT.
       *
       * This is the most important rule.
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
        strength <
        options.minStrength
      ) {

        return false;

      }


      return true;

    }
  );

}


/*
 * ============================================
 * PREPARE CANDIDATES
 * ============================================
 */

function prepareCandidates(
  candidates,
  strategy
) {

  const scored =
    candidates
      .map(selection => ({

        ...selection,

        quality:
          scoreSelection(
            selection,
            strategy
          )

      }))
      .filter(
        selection =>
          selection.quality > 0
      );


  /*
   * Sort strongest first.
   */

  scored.sort(
    (a, b) =>
      b.quality -
      a.quality
  );


  /*
   * Keep the search lightweight.
   */

  const limit =
    strategy === "conservative"
      ? 600
      : 450;


  return scored.slice(
    0,
    limit
  );

}


/*
 * ============================================
 * COMBINATION QUALITY
 * ============================================
 */

function combinationQuality(
  state,
  target,
  strategy
) {

  if (
    !state ||
    !Array.isArray(
      state.selections
    )
  ) {

    return -Infinity;

  }


  const totalOdds =
    state.totalOdds;


  const difference =
    Math.abs(
      Math.log(
        totalOdds /
        target
      )
    );


  const averageQuality =
    state.selections.length
      ? state.selections.reduce(
          (
            sum,
            selection
          ) =>
            sum +
            selection.quality,
          0
        ) /
        state.selections.length
      : 0;


  let score =
    averageQuality -
    difference * 150;


  /*
   * Conservative deliberately does NOT
   * punish long tickets.
   *
   * The strategy determines the number
   * of selections required.
   */

  if (
    strategy !== "conservative"
  ) {

    if (
      state.selections.length > 12
    ) {

      score -=
        (
          state.selections.length -
          12
        ) * 2;

    }

  }


  return score;

}


/*
 * ============================================
 * BUILD COMBINATION
 * ============================================
 */

function buildCombination(
  candidates,
  target,
  options
) {

  const strategy =
    options.strategy ||
    "balanced";


  const maxLegs =
    Math.max(
      1,
      Math.floor(
        options.maxSelections
      )
    );


  const upperTarget =
    target * 1.05;


  /*
   * Keep beam small enough for Render.
   */

  const beamSize =
    strategy === "conservative"
      ? 180
      : 140;


  /*
   * Initial state.
   */

  let states = [
    {
      totalOdds: 1,
      selections: [],
      eventIds: new Set(),
      marketCounts: new Map()
    }
  ];


  /*
   * Process candidates.
   */

  for (
    const candidate
    of candidates
  ) {

    const nextStates =
      [];


    for (
      const state
      of states
    ) {

      /*
       * Never use the same event twice.
       */

      if (
        state.eventIds.has(
          candidate.eventId
        )
      ) {

        continue;

      }


      /*
       * Maximum four selections
       * from the same market family.
       */

      const marketKey =
        String(
          candidate.marketId ||
          candidate.market ||
          ""
        );


      const marketCount =
        state.marketCounts.get(
          marketKey
        ) || 0;


      if (
        marketCount >= 4
      ) {

        continue;

      }


      /*
       * Calculate new total.
       */

      const newTotal =
        state.totalOdds *
        candidate.odds;


      /*
       * Never go too far above target.
       */

      if (
        newTotal >
        upperTarget
      ) {

        continue;

      }


      /*
       * Add candidate.
       */

      const newSelections =
        [
          ...state.selections,
          candidate
        ];


      if (
        newSelections.length >
        maxLegs
      ) {

        continue;

      }


      const newEventIds =
        new Set(
          state.eventIds
        );


      newEventIds.add(
        candidate.eventId
      );


      const newMarketCounts =
        new Map(
          state.marketCounts
        );


      newMarketCounts.set(
        marketKey,
        marketCount + 1
      );


      nextStates.push({

        totalOdds:
          newTotal,

        selections:
          newSelections,

        eventIds:
          newEventIds,

        marketCounts:
          newMarketCounts

      });

    }


    /*
     * Keep previous states too.
     */

    nextStates.push(
      ...states
    );


    /*
     * Score states.
     */

    nextStates.sort(
      (a, b) =>
        combinationQuality(
          b,
          target,
          strategy
        ) -
        combinationQuality(
          a,
          target,
          strategy
        )
    );


    /*
     * Remove duplicate totals.
     */

    const unique =
      [];

    const seen =
      new Set();


    for (
      const state
      of nextStates
    ) {

      const bucket =
        (
          Math.round(
            state.totalOdds *
            100
          ) / 100
        ).toFixed(2);


      const key =
        `${bucket}:${state.selections.length}`;


      if (
        seen.has(key)
      ) {

        continue;

      }


      seen.add(key);

      unique.push(
        state
      );


      if (
        unique.length >=
        beamSize
      ) {

        break;

      }

    }


    states =
      unique;


    /*
     * Exact-enough result.
     */

    const exact =
      states.find(
        state =>
          state.totalOdds >=
            target &&
          Math.abs(
            state.totalOdds -
            target
          ) <=
            Math.max(
              0.01,
              target * 0.01
            )
      );


    if (
      exact
    ) {

      return exact;

    }

  }


  /*
   * Choose the best final state
   * that actually reaches the target.
   */

  const validStates =
    states.filter(
      state =>
        state.totalOdds >=
          target &&
        state.selections.length <=
          maxLegs
    );


  if (
    !validStates.length
  ) {

    return null;

  }


  validStates.sort(
    (a, b) =>
      combinationQuality(
        b,
        target,
        strategy
      ) -
      combinationQuality(
        a,
        target,
        strategy
      )
  );


  return validStates[0];

}


/*
 * ============================================
 * PUBLIC ENGINE
 * ============================================
 */

export function runSelectionEngine(
  items,
  target,
  options = {}
) {

  const strategy =
    String(
      options.strategy ||
      "balanced"
    )
      .trim()
      .toLowerCase();


  const defaults =
    getStrategyConfig(
      strategy
    );


  const minOdds =
    toNumber(
      options.minOdds,
      defaults.minOdds
    );


  const maxOdds =
    toNumber(
      options.maxOdds,
      defaults.maxOdds
    );


  const minProbability =
    toNumber(
      options.minProbability,
      defaults.minProbability
    );


  const minStrength =
    toNumber(
      options.minStrength,
      defaults.minStrength
    );


  const maxSelections =
    Math.floor(
      toNumber(
        options.maxSelections,
        defaults.maxSelections
      )
    );


  /*
   * ==========================================
   * HARD SAFETY VALIDATION
   * ==========================================
   */

  if (
    strategy === "conservative" &&
    maxOdds > 1.20
  ) {

    return {

      success: false,

      error:
        "Conservative strategy cannot use odds above 1.20.",

      engineVersion:
        ENGINE_VERSION,

      strategy,

      strategyConfig: {

        minOdds,

        maxOdds: 1.20,

        minProbability,

        minStrength,

        maxSelections

      }

    };

  }


  if (
    minOdds >= maxOdds
  ) {

    return {

      success: false,

      error:
        "Invalid odds range.",

      engineVersion:
        ENGINE_VERSION,

      strategy

    };

  }


  const candidates =
    extractCandidates(
      items
    );


  const filtered =
    filterCandidates(
      candidates,
      {

        minOdds,

        maxOdds,

        minProbability,

        minStrength

      }
    );


  const prepared =
    prepareCandidates(
      filtered,
      strategy
    );


  /*
   * Build combination.
   */

  const combination =
    buildCombination(
      prepared,
      target,
      {

        strategy,

        minOdds,

        maxOdds,

        maxSelections

      }
    );


  /*
   * No valid combination.
   */

  if (
    !combination
  ) {

    return {

      success: false,

      engineVersion:
        ENGINE_VERSION,

      strategy,

      strategyConfig: {

        minOdds,

        maxOdds,

        minProbability,

        minStrength,

        maxSelections

      },

      candidatesFound:
        candidates.length,

      candidatesAfterFiltering:
        filtered.length,

      targetOdds:
        target,

      error:
        `Unable to reach ${target}x within the ${strategy} strategy constraints. Try a higher target, another strategy, or adjust the custom odds range.`

    };

  }


  /*
   * ==========================================
   * FINAL HARD VALIDATION
   * ==========================================
   */

  const invalidSelection =
    combination.selections.find(
      selection => {

        const odds =
          toNumber(
            selection.odds
          );

        return (
          odds < minOdds ||
          odds > maxOdds
        );

      }
    );


  if (
    invalidSelection
  ) {

    return {

      success: false,

      engineVersion:
        ENGINE_VERSION,

      strategy,

      error:
        "Engine validation failed: combination contains an odds value outside the requested strategy range."

    };

  }


  /*
   * Calculate statistics.
   */

  const totalOdds =
    Number(
      combination.totalOdds.toFixed(2)
    );


  const difference =
    Number(
      Math.abs(
        totalOdds -
        target
      ).toFixed(2)
    );


  const averageStrength =
    combination.selections.length
      ? Number(
          (
            combination.selections.reduce(
              (
                sum,
                selection
              ) =>
                sum +
                selection.strengthScore,
              0
            ) /
            combination.selections.length
          ).toFixed(2)
        )
      : 0;


  const lowOddsSelections =
    combination.selections.filter(
      selection =>
        selection.odds < 1.20
    ).length;


  /*
   * Return clean combination.
   */

  const cleanSelections =
    combination.selections.map(
      selection => ({

        eventId:
          selection.eventId,

        gameId:
          selection.gameId,

        match:
          selection.match,

        homeTeam:
          selection.homeTeam,

        awayTeam:
          selection.awayTeam,

        startTime:
          selection.startTime,

        competition:
          selection.competition,

        category:
          selection.category,

        marketId:
          selection.marketId,

        market:
          selection.market,

        specifier:
          selection.specifier,

        outcomeId:
          selection.outcomeId,

        pick:
          selection.pick,

        odds:
          selection.odds,

        probability:
          selection.probability,

        bookmakerProbability:
          selection.bookmakerProbability,

        impliedProbability:
          selection.impliedProbability,

        strengthScore:
          selection.strengthScore,

        risk:
          selection.risk

      })
    );


  return {

    success: true,

    engineVersion:
      ENGINE_VERSION,

    strategy,

    strategyConfig: {

      minOdds,

      maxOdds,

      minProbability,

      minStrength,

      maxSelections

    },

    candidatesFound:
      candidates.length,

    candidatesAfterFiltering:
      filtered.length,

    targetOdds:
      target,

    combination: {

      totalOdds,

      targetOdds:
        target,

      difference,

      selectionCount:
        cleanSelections.length,

      averageStrength,

      lowOddsSelections,

      selections:
        cleanSelections

    }

  };

}

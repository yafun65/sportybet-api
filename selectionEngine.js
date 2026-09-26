/* =========================================================
   SPORTYBET SELECTION ENGINE
   QUALITY + TARGET OPTIMIZER
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

  /*
   * These adjustments are deliberately
   * modest. Probability remains the
   * main component of the score.
   */

  if (
    market.includes("double chance")
  ) {
    adjustment += 2;
  }

  if (
    market.includes("draw no bet")
  ) {
    adjustment += 2;
  }

  if (
    market.includes("over/under")
  ) {
    adjustment += 1;
  }

  if (
    market.includes("asian handicap")
  ) {
    adjustment += 1;
  }

  if (
    market.includes("gg/ng")
  ) {
    adjustment += 1;
  }

  if (
    market.includes("corners")
  ) {
    adjustment += 1;
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
   ODDS QUALITY ADJUSTMENT
========================= */

function getOddsQualityAdjustment(
  selection
) {

  const odds =
    Number(selection.odds);

  if (!Number.isFinite(odds)) {
    return -20;
  }

  /*
   * Very low odds are useful sometimes,
   * but we don't want the optimizer to
   * fill the ticket with 1.15 selections.
   */

  if (odds < 1.17) {
    return -7;
  }

  if (odds < 1.20) {
    return -5;
  }

  if (odds < 1.25) {
    return -3;
  }

  /*
   * Practical middle range.
   */

  if (
    odds >= 1.30 &&
    odds <= 2.50
  ) {
    return 2;
  }

  /*
   * Still usable, but slightly less
   * attractive than the middle range.
   */

  if (
    odds > 2.50 &&
    odds <= 3.50
  ) {
    return -2;
  }

  return 0;
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

  score +=
    getMarketAdjustment(
      selection
    );

  score +=
    getOddsQualityAdjustment(
      selection
    );

  const odds =
    Number(selection.odds);

  /*
   * Extra penalty for very high odds.
   */

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
   CANDIDATE QUALITY
========================= */

function candidateQuality(
  selection
) {

  const strength =
    scoreSelection(
      selection
    );

  const odds =
    Number(selection.odds);

  let quality =
    strength;

  /*
   * Encourage useful odds.
   */

  if (
    odds >= 1.30 &&
    odds <= 2.50
  ) {
    quality += 4;
  }

  /*
   * Discourage excessive dependence
   * on very low odds.
   */

  if (odds < 1.20) {
    quality -= 6;
  }

  if (odds < 1.17) {
    quality -= 4;
  }

  return quality;
}


/* =========================
   PREPARE CANDIDATES
========================= */

function prepareCandidates(
  candidates
) {

  /*
   * Rank by quality rather than simply
   * bookmaker probability.
   */

  const sorted =
    [...candidates].sort(
      (a, b) => {

        const qualityDifference =
          candidateQuality(b) -
          candidateQuality(a);

        if (
          qualityDifference !== 0
        ) {
          return qualityDifference;
        }

        return (
          Number(b.odds) -
          Number(a.odds)
        );

      }
    );


  /*
   * Larger pool gives the optimizer
   * enough options for high targets.
   */

  const MAX_POOL =
    900;


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

    /*
     * Keep several different markets
     * from an event, but don't let one
     * event dominate the pool.
     */

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
   * Add odds diversity.
   *
   * This is particularly important
   * for 50x and 100x targets.
   */

  const oddsSorted =
    [...candidates]
      .sort(
        (a, b) =>
          Number(b.odds) -
          Number(a.odds)
      )
      .slice(0, 250);


  /*
   * Also deliberately collect candidates
   * from useful odds bands.
   */

  const oddsBands = [];

  for (
    const candidate of candidates
  ) {

    const odds =
      Number(candidate.odds);

    if (
      (odds >= 1.20 && odds < 1.35) ||
      (odds >= 1.35 && odds < 1.60) ||
      (odds >= 1.60 && odds < 2.00) ||
      (odds >= 2.00 && odds <= 3.50)
    ) {
      oddsBands.push(candidate);
    }
  }


  const bandSorted =
    [...oddsBands]
      .sort(
        (a, b) =>
          candidateQuality(b) -
          candidateQuality(a)
      )
      .slice(0, 400);


  const combined = [
    ...pool,
    ...oddsSorted,
    ...bandSorted
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

  if (
    !state ||
    !state.selections.length
  ) {
    return 999999;
  }


  /*
   * Target distance.
   *
   * Log distance works well across
   * both 10x and 100x targets.
   */

  const ratio =
    state.totalOdds /
    target;


  const distance =
    Math.abs(
      Math.log(
        ratio
      )
    );


  /*
   * Average strength.
   */

  const averageStrength =
    state.selections.reduce(
      (sum, selection) =>
        sum +
        scoreSelection(
          selection
        ),
      0
    ) /
    state.selections.length;


  /*
   * Average candidate quality.
   */

  const averageQuality =
    state.selections.reduce(
      (sum, selection) =>
        sum +
        candidateQuality(
          selection
        ),
      0
    ) /
    state.selections.length;


  /*
   * Count very-low-odds selections.
   */

  const lowOddsCount =
    state.selections.filter(
      selection =>
        Number(selection.odds) <
        1.20
    ).length;


  /*
   * Count weaker selections.
   */

  const weakCount =
    state.selections.filter(
      selection =>
        scoreSelection(
          selection
        ) < 70
    ).length;


  /*
   * Leg penalty.
   *
   * We don't want 15 legs if a
   * cleaner 8-leg combination can
   * reach the target.
   */

  const legPenalty =
    Math.max(
      0,
      state.selections.length - 8
    ) * 0.20;


  /*
   * Strong penalties for relying
   * heavily on low-quality legs.
   */

  const lowOddsPenalty =
    lowOddsCount * 0.80;

  const weakPenalty =
    weakCount * 0.65;


  /*
   * IMPORTANT:
   *
   * Target accuracy remains important,
   * but selection quality now has a much
   * stronger influence than before.
   */

  return (
    distance * 180 -
    averageStrength * 0.80 -
    averageQuality * 0.35 +
    legPenalty +
    lowOddsPenalty +
    weakPenalty
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
   * Maximum allowed overshoot.
   */

  const hardUpperTarget =
    target * 1.05;


  /*
   * Beam search size.
   */

  const BEAM_SIZE =
    450;


  /*
   * Maximum number of legs.
   */

  const maxLegs =
    Math.min(
      maxSelections,
      15
    );


  /*
   * Start with empty state.
   */

  let beam = [
    {
      totalOdds: 1,
      selections: [],
      usedEvents: new Set(),
      marketCounts: new Map()
    }
  ];


  let bestState =
    null;


  /*
   * Search progressively.
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
         * One selection per event.
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
         * Maximum four selections
         * from the same market family.
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


        /*
         * Never exceed the hard limit.
         */

        if (
          newTotal >
          hardUpperTarget
        ) {
          continue;
        }


        /*
         * Don't add legs after target
         * has already been reached.
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
         * Remember the best state found.
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
     * Compress similar states.
     *
     * Two states with the same number
     * of legs and almost identical odds
     * don't both need to survive.
     */

    const stateMap =
      new Map();


    for (
      const state
      of nextStates
    ) {

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
     * If the target is extremely close
     * AND the combination is reasonably
     * strong, stop early.
     */

    if (
      bestState
    ) {

      const targetDifference =
        Math.abs(
          bestState.totalOdds -
          target
        );

      const averageStrength =
        bestState.selections.reduce(
          (sum, selection) =>
            sum +
            scoreSelection(
              selection
            ),
          0
        ) /
        bestState.selections.length;


      if (
        targetDifference <=
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
   * Final selection output.
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

          /*
           * This is SportyBet's supplied
           * probability where available.
           */

          bookmakerProbability:
            Number(
              (
                getImpliedProbability(
                  selection
                ) * 100
              ).toFixed(2)
            ),

          /*
           * Keep the original field too
           * for compatibility.
           */

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
    (a, b) => {

      const qualityDifference =
        candidateQuality(b) -
        candidateQuality(a);


      if (
        qualityDifference !== 0
      ) {
        return qualityDifference;
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

            bookmakerProbability:
              Number(
                (
                  getImpliedProbability(
                    selection
                  ) * 100
                ).toFixed(2)
              ),

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

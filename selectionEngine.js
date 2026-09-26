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
      event.startTime ||
      event.estimateStartTime ||
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

    const event = getEventInfo(item);

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
          market.marketId ||
          market.id ||
          ""
        );

      const marketName =
        market.market ||
        market.name ||
        market.desc ||
        "";

      const specifier =
        market.specifier ||
        null;

      const outcomes =
        Array.isArray(market.outcomes)
          ? market.outcomes
          : [];

      for (const outcome of outcomes) {

        const odds =
          Number(outcome.odds);

        const probability =
          Number(
            outcome.probability
          );

        const active =
          outcome.isActive !== false &&
          outcome.isActive !== 0;

        if (
          !active ||
          !Number.isFinite(odds) ||
          odds <= 1
        ) {
          continue;
        }

        const outcomeId =
          String(
            outcome.outcomeId ||
            outcome.id ||
            ""
          );

        const pick =
          outcome.pick ||
          outcome.desc ||
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
   IMPLIED PROBABILITY
========================= */

function getImpliedProbability(selection) {

  if (
    Number.isFinite(
      selection.probability
    ) &&
    selection.probability > 0 &&
    selection.probability <= 1
  ) {
    return selection.probability;
  }

  const odds =
    Number(selection.odds);

  if (
    !Number.isFinite(odds) ||
    odds <= 1
  ) {
    return 0;
  }

  return 1 / odds;
}


/* =========================
   MARKET BONUS
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

  /*
   * Probability is converted
   * to a 0-100 scale.
   */
  let score =
    probability * 100;


  /*
   * Small reward for useful
   * odds range.
   */
  const odds =
    Number(selection.odds);


  if (
    odds >= 1.25 &&
    odds <= 2.50
  ) {
    score += 3;
  }


  /*
   * Market adjustment.
   */
  score +=
    getMarketAdjustment(
      selection
    );


  /*
   * Penalize very high odds.
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
   SORT
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
    market.includes("double chance")
  ) {
    return "double-chance";
  }

  if (
    market.includes("over/under")
  ) {
    return "over-under";
  }

  if (
    market.includes("draw no bet")
  ) {
    return "draw-no-bet";
  }

  if (
    market.includes("gg/ng")
  ) {
    return "gg-ng";
  }

  if (
    market.includes("asian handicap")
  ) {
    return "asian-handicap";
  }

  if (
    market.includes("corners")
  ) {
    return "corners";
  }

  return market || "other";
}


/* =========================
   COMBINATION OPTIMIZER
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


  const sorted =
    sortCandidates(
      candidates
    );


  const usedEvents =
    new Set();


  const marketCounts =
    new Map();


  const selections = [];


  let totalOdds = 1;


  /*
   * We don't want the algorithm
   * to simply select 15 identical
   * 1.15 Double Chance picks.
   */
  const MAX_SAME_MARKET =
    Math.max(
      3,
      Math.ceil(
        maxSelections * 0.35
      )
    );


  /*
   * Dynamic upper limit.
   */
  const upperTarget =
    target * 1.08;


  for (
    const candidate of sorted
  ) {

    if (
      selections.length >=
      maxSelections
    ) {
      break;
    }


    const key =
      eventKey(candidate);


    if (
      usedEvents.has(key)
    ) {
      continue;
    }


    const family =
      marketFamily(
        candidate
      );


    const familyCount =
      marketCounts.get(
        family
      ) || 0;


    if (
      familyCount >=
      MAX_SAME_MARKET
    ) {
      continue;
    }


    const newTotal =
      totalOdds *
      Number(candidate.odds);


    if (
      newTotal >
      upperTarget
    ) {
      continue;
    }


    usedEvents.add(key);


    const strength =
      scoreSelection(
        candidate
      );


    selections.push({

      ...candidate,

      impliedProbability:
        Number(
          (
            getImpliedProbability(
              candidate
            ) * 100
          ).toFixed(2)
        ),

      strengthScore:
        strength,

      risk:
        getRisk(
          strength
        )

    });


    totalOdds =
      newTotal;


    marketCounts.set(
      family,
      familyCount + 1
    );


    /*
     * Stop when we reach
     * 80% of the requested target.
     */
    if (
      totalOdds >=
      target * 0.8
    ) {
      break;
    }
  }


  if (
    !selections.length
  ) {
    return null;
  }


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
          totalOdds - target
        ).toFixed(2)
      ),

    selections

  };
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
      .map(selection => {

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
      });


  return {

    success:
      Boolean(combination),

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

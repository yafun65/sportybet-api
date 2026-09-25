// =====================================================
// SELECTION ENGINE
// =====================================================

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

// =====================================================
// HELPERS
// =====================================================

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isAllowedCompetition(name) {
  return ALLOWED_COMPETITIONS.some(
    competition =>
      normalize(competition) === normalize(name)
  );
}

// =====================================================
// IMPLIED PROBABILITY
// =====================================================

function impliedProbability(odds) {
  const value = Number(odds);

  if (!Number.isFinite(value) || value <= 1) {
    return 0;
  }

  return 1 / value;
}

// =====================================================
// BASE ODDS SCORE
// =====================================================

function oddsScore(odds) {
  const probability =
    impliedProbability(odds);

  return Math.max(
    0,
    Math.min(
      100,
      probability * 100
    )
  );
}

// =====================================================
// MARKET PREFERENCE
// =====================================================

function marketTypeScore(marketName) {
  const market =
    normalize(marketName);

  if (
    market === "double chance"
  ) {
    return 10;
  }

  if (
    market.includes("over/under")
  ) {
    return 8;
  }

  if (
    market.includes("draw no bet")
  ) {
    return 8;
  }

  if (
    market.includes("corners")
  ) {
    return 7;
  }

  if (
    market.includes("gg/ng")
  ) {
    return 6;
  }

  if (
    market.includes("asian handicap")
  ) {
    return 5;
  }

  if (
    market.includes("1x2 - 2up")
  ) {
    return 5;
  }

  if (
    market.includes("handicap")
  ) {
    return 4;
  }

  if (
    market === "1x2"
  ) {
    return 3;
  }

  return 0;
}

// =====================================================
// MARKET COMPLEXITY
// =====================================================

function complexityPenalty(marketName) {
  const market =
    normalize(marketName);

  if (
    market.includes("correct score")
  ) {
    return 35;
  }

  if (
    market.includes("half time/full time")
  ) {
    return 20;
  }

  if (
    market.includes("correct")
  ) {
    return 30;
  }

  return 0;
}

// =====================================================
// SCORE ONE SELECTION
// =====================================================

function scoreSelection(selection) {
  const odds =
    Number(selection.odds);

  if (
    !Number.isFinite(odds) ||
    odds <= 1
  ) {
    return null;
  }

  const probability =
    impliedProbability(odds);

  let score =
    oddsScore(odds);

  score += marketTypeScore(
    selection.market
  );

  score -= complexityPenalty(
    selection.market
  );

  // Higher odds = generally higher uncertainty.
  if (odds >= 5) {
    score -= 20;
  } else if (odds >= 3) {
    score -= 10;
  }

  // Extremely short odds contribute little
  // toward target odds.
  if (odds <= 1.15) {
    score -= 3;
  }

  score = Math.round(
    Math.max(
      1,
      Math.min(95, score)
    )
  );

  let risk = "High";

  if (score >= 75) {
    risk = "Lower";
  } else if (score >= 60) {
    risk = "Moderate";
  }

  return {
    ...selection,

    impliedProbability:
      Number(
        (
          probability * 100
        ).toFixed(2)
      ),

    confidenceScore:
      score,

    risk
  };
}

// =====================================================
// EVENT KEY
// =====================================================

function eventKey(selection) {
  return String(
    selection.eventId ||
    `${selection.homeTeam}-${selection.awayTeam}`
  );
}

// =====================================================
// EXTRACT CANDIDATES
// =====================================================
//
// IMPORTANT:
// This accepts the exact structure produced by
// your current cleanEventMarkets() function.
//
// =====================================================

function extractCandidates(data) {
  const matches =
    Array.isArray(data)
      ? data
      : Array.isArray(data?.matches)
        ? data.matches
        : [];

  const candidates = [];

  for (const item of matches) {

    // -------------------------------------------------
    // Your cleanEventMarkets() structure:
    //
    // {
    //   event: {
    //     eventId,
    //     gameId,
    //     homeTeamName,
    //     awayTeamName,
    //     startTime,
    //     tournament,
    //     category
    //   },
    //   markets: [...]
    // }
    // -------------------------------------------------

    const matchEvent =
      item?.event || item;

    const competition =
      matchEvent?.tournament ||
      item?.competition ||
      "";

    if (
      !isAllowedCompetition(
        competition
      )
    ) {
      continue;
    }

    const eventId =
      matchEvent?.eventId ||
      item?.eventId ||
      null;

    const gameId =
      matchEvent?.gameId ||
      item?.gameId ||
      null;

    const homeTeam =
      matchEvent?.homeTeamName ||
      item?.homeTeam ||
      null;

    const awayTeam =
      matchEvent?.awayTeamName ||
      item?.awayTeam ||
      null;

    const match =
      item?.match ||
      (
        homeTeam &&
        awayTeam
          ? `${homeTeam} vs ${awayTeam}`
          : "Unknown match"
      );

    const startTime =
      matchEvent?.startTime ||
      item?.startTime ||
      null;

    const category =
      matchEvent?.category ||
      item?.category ||
      null;

    const markets =
      Array.isArray(item?.markets)
        ? item.markets
        : [];

    for (const market of markets) {

      const outcomes =
        Array.isArray(
          market?.outcomes
        )
          ? market.outcomes
          : [];

      for (const outcome of outcomes) {

        if (
          outcome?.isActive === false
        ) {
          continue;
        }

        const scored =
          scoreSelection({
            eventId,
            gameId,

            match,

            homeTeam,
            awayTeam,

            startTime,

            competition,
            category,

            marketId:
              market?.marketId ||
              null,

            market:
              market?.market ||
              "Unknown market",

            specifier:
              market?.specifier ||
              null,

            outcomeId:
              outcome?.outcomeId ||
              null,

            pick:
              outcome?.pick ||
              "Unknown pick",

            odds:
              outcome?.odds
          });

        if (scored) {
          candidates.push(scored);
        }
      }
    }
  }

  return candidates;
}

// =====================================================
// FILTER CANDIDATES
// =====================================================

function filterCandidates(
  candidates,
  options = {}
) {
  const {
    minOdds = 1.15,
    maxOdds = 3.5,
    minConfidence = 55
  } = options;

  return candidates.filter(
    candidate => {

      const odds =
        Number(candidate.odds);

      if (
        odds < minOdds ||
        odds > maxOdds
      ) {
        return false;
      }

      if (
        candidate.confidenceScore <
        minConfidence
      ) {
        return false;
      }

      const market =
        normalize(
          candidate.market
        );

      // Exclude complex markets
      // from the first version.
      if (
        market.includes(
          "correct score"
        ) ||
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

// =====================================================
// SORT
// =====================================================

function sortCandidates(
  candidates
) {
  return [...candidates].sort(
    (a, b) => {

      // Confidence first
      if (
        b.confidenceScore !==
        a.confidenceScore
      ) {
        return (
          b.confidenceScore -
          a.confidenceScore
        );
      }

      // Then slightly prefer
      // useful odds.
      return (
        Number(b.odds) -
        Number(a.odds)
      );
    }
  );
}

// =====================================================
// BUILD TARGET COMBINATION
// =====================================================

function buildCombination(
  candidates,
  targetOdds,
  options = {}
) {
  const {
    tolerance = 0.20,
    maxSelections = 15
  } = options;

  const target =
    Number(targetOdds);

  if (
    !Number.isFinite(target) ||
    target <= 1
  ) {
    throw new Error(
      "Target odds must be greater than 1."
    );
  }

  const sorted =
    sortCandidates(
      candidates
    );

  let best = null;

  function search(
    index,
    selected,
    totalOdds,
    usedEvents
  ) {

    if (
      selected.length >
      maxSelections
    ) {
      return;
    }

    const distance =
      Math.abs(
        Math.log(totalOdds) -
        Math.log(target)
      );

    /*
      Prefer combinations that are:
      1. close to target
      2. higher average confidence
    */

    const averageConfidence =
      selected.length > 0
        ? selected.reduce(
            (sum, item) =>
              sum +
              item.confidenceScore,
            0
          ) /
          selected.length
        : 0;

    if (
      !best ||
      distance <
        best.distance ||
      (
        Math.abs(
          distance -
          best.distance
        ) < 0.0001 &&
        averageConfidence >
          best.averageConfidence
      )
    ) {
      best = {
        selections: [
          ...selected
        ],

        totalOdds,

        distance,

        averageConfidence
      };
    }

    if (
      totalOdds >=
      target *
        (1 + tolerance)
    ) {
      return;
    }

    for (
      let i = index;
      i < sorted.length;
      i++
    ) {

      const candidate =
        sorted[i];

      const key =
        eventKey(candidate);

      // One selection per match.
      if (
        usedEvents.has(key)
      ) {
        continue;
      }

      const nextOdds =
        totalOdds *
        Number(candidate.odds);

      if (
        nextOdds >
        target *
          (1 + tolerance)
      ) {
        continue;
      }

      usedEvents.add(key);

      selected.push(
        candidate
      );

      search(
        i + 1,
        selected,
        nextOdds,
        usedEvents
      );

      selected.pop();

      usedEvents.delete(key);
    }
  }

  search(
    0,
    [],
    1,
    new Set()
  );

  if (
    !best ||
    best.selections.length === 0
  ) {
    return null;
  }

  return {
    selections:
      best.selections,

    totalOdds:
      Number(
        best.totalOdds.toFixed(2)
      ),

    targetOdds:
      target,

    difference:
      Number(
        (
          best.totalOdds -
          target
        ).toFixed(2)
      ),

    averageConfidence:
      Number(
        best.averageConfidence.toFixed(
          1
        )
      )
  };
}

// =====================================================
// MAIN ENGINE
// =====================================================

function runSelectionEngine(
  data,
  targetOdds,
  options = {}
) {
  const allCandidates =
    extractCandidates(data);

  const filtered =
    filterCandidates(
      allCandidates,
      options
    );

  const combination =
    buildCombination(
      filtered,
      targetOdds,
      options
    );

  return {
    success:
      Boolean(combination),

    targetOdds:
      Number(targetOdds),

    candidatesFound:
      allCandidates.length,

    candidatesAfterFiltering:
      filtered.length,

    combination,

    topCandidates:
      sortCandidates(
        filtered
      ).slice(0, 100)
  };
}

// =====================================================
// EXPORT
// =====================================================

export {
  runSelectionEngine,
  extractCandidates,
  scoreSelection,
  filterCandidates,
  buildCombination
};

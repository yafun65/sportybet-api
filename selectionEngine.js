// selectionEngine.js

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

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isAllowedCompetition(competition) {
  return ALLOWED_COMPETITIONS.some(
    item => normalize(item) === normalize(competition)
  );
}

/*
  Convert decimal odds into implied probability.

  Example:
  1.50 odds = 66.67%
  2.00 odds = 50%
*/
function impliedProbability(odds) {
  const value = Number(odds);

  if (!Number.isFinite(value) || value <= 1) {
    return 0;
  }

  return 1 / value;
}

/*
  Base score from odds.

  Lower odds generally imply a higher market probability.
  This is NOT the same thing as true probability.
*/
function oddsScore(odds) {
  const probability = impliedProbability(odds);

  return Math.max(
    0,
    Math.min(100, probability * 100)
  );
}

/*
  Give different market types different treatment.

  We prefer simpler markets for the first engine.
*/
function marketTypeScore(marketName) {
  const market = normalize(marketName);

  if (market === "double chance") {
    return 10;
  }

  if (market.includes("over/under")) {
    return 8;
  }

  if (market.includes("gg/ng")) {
    return 6;
  }

  if (market.includes("1x2 - 2up")) {
    return 5;
  }

  if (market === "1x2") {
    return 3;
  }

  if (market.includes("draw no bet")) {
    return 7;
  }

  if (market.includes("asian handicap")) {
    return 5;
  }

  if (market.includes("handicap")) {
    return 4;
  }

  if (market.includes("corners")) {
    return 7;
  }

  return 0;
}

/*
  Penalize markets that are inherently more difficult
  for the first version of the engine.
*/
function complexityPenalty(marketName) {
  const market = normalize(marketName);

  if (market.includes("correct score")) {
    return 35;
  }

  if (market.includes("half time/full time")) {
    return 20;
  }

  if (market.includes("correct")) {
    return 30;
  }

  return 0;
}

/*
  Score an individual selection.
*/
function scoreSelection(selection) {
  const odds = Number(selection.odds);

  if (!Number.isFinite(odds) || odds <= 1) {
    return null;
  }

  const probability = impliedProbability(odds);

  let score = oddsScore(odds);

  score += marketTypeScore(selection.market);
  score -= complexityPenalty(selection.market);

  /*
    Odds above 5.00 are treated as high-risk candidates.
  */
  if (odds >= 5) {
    score -= 20;
  } else if (odds >= 3) {
    score -= 10;
  }

  /*
    Very short odds can contribute little to a target,
    but they are generally easier to combine.
  */
  if (odds <= 1.15) {
    score -= 3;
  }

  score = Math.round(
    Math.max(1, Math.min(95, score))
  );

  let risk = "High";

  if (score >= 75) {
    risk = "Lower";
  } else if (score >= 60) {
    risk = "Moderate";
  }

  return {
    ...selection,
    impliedProbability: Number(
      (probability * 100).toFixed(2)
    ),
    confidenceScore: score,
    risk
  };
}

/*
  Generate a unique key for an event.
*/
function eventKey(selection) {
  return String(
    selection.eventId ||
    `${selection.homeTeam}-${selection.awayTeam}`
  );
}

/*
  Check whether two selections conflict.

  We normally allow only ONE selection per match.
*/
function conflicts(existing, candidate) {
  return existing.some(
    item => eventKey(item) === eventKey(candidate)
  );
}

/*
  Flatten / normalize the /available-markets response.
*/
function extractCandidates(data) {
  const matches = Array.isArray(data)
    ? data
    : Array.isArray(data?.matches)
      ? data.matches
      : [];

  const candidates = [];

  for (const match of matches) {
    if (
      !isAllowedCompetition(match.competition)
    ) {
      continue;
    }

    const markets = Array.isArray(match.markets)
      ? match.markets
      : [];

    for (const market of markets) {
      const outcomes = Array.isArray(
        market.outcomes
      )
        ? market.outcomes
        : [];

      for (const outcome of outcomes) {
        const candidate = scoreSelection({
          eventId: match.eventId,
          gameId: match.gameId,

          match: match.match,

          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,

          startTime: match.startTime,

          competition: match.competition,
          category: match.category,

          marketId: market.marketId,
          market: market.market,
          specifier: market.specifier,

          outcomeId: outcome.outcomeId,
          pick: outcome.pick,
          odds: outcome.odds
        });

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }
  }

  return candidates;
}

/*
  Remove unsuitable candidates.
*/
function filterCandidates(
  candidates,
  options = {}
) {
  const {
    minOdds = 1.15,
    maxOdds = 3.5,
    minConfidence = 55
  } = options;

  return candidates.filter(candidate => {
    const odds = Number(candidate.odds);

    if (odds < minOdds) {
      return false;
    }

    if (odds > maxOdds) {
      return false;
    }

    if (
      candidate.confidenceScore <
      minConfidence
    ) {
      return false;
    }

    /*
      Correct score and HT/FT are excluded
      from the initial optimizer.
    */
    const market = normalize(candidate.market);

    if (
      market.includes("correct score") ||
      market.includes("half time/full time")
    ) {
      return false;
    }

    return true;
  });
}

/*
  Sort candidates by confidence.
*/
function sortCandidates(candidates) {
  return [...candidates].sort(
    (a, b) =>
      b.confidenceScore -
      a.confidenceScore
  );
}

/*
  Find a combination close to the requested
  target odds.

  We use a bounded search instead of generating
  millions of combinations.
*/
function buildCombination(
  candidates,
  targetOdds,
  options = {}
) {
  const {
    tolerance = 0.15,
    maxSelections = 15
  } = options;

  const target = Number(targetOdds);

  if (
    !Number.isFinite(target) ||
    target <= 1
  ) {
    throw new Error(
      "Target odds must be greater than 1."
    );
  }

  const sorted = sortCandidates(candidates);

  let best = null;

  function search(
    index,
    selected,
    totalOdds,
    usedEvents
  ) {
    if (selected.length > maxSelections) {
      return;
    }

    /*
      Compare current combination to target.
    */
    const distance =
      Math.abs(
        Math.log(totalOdds) -
        Math.log(target)
      );

    if (
      !best ||
      distance < best.distance
    ) {
      best = {
        selections: [...selected],
        totalOdds,
        distance
      };
    }

    if (totalOdds >= target * (1 + tolerance)) {
      return;
    }

    for (
      let i = index;
      i < sorted.length;
      i++
    ) {
      const candidate = sorted[i];

      const key = eventKey(candidate);

      /*
        Only one selection per match.
      */
      if (usedEvents.has(key)) {
        continue;
      }

      const nextOdds =
        totalOdds *
        Number(candidate.odds);

      /*
        Don't explore combinations that
        massively exceed the target.
      */
      if (
        nextOdds >
        target * (1 + tolerance)
      ) {
        continue;
      }

      usedEvents.add(key);

      selected.push(candidate);

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

  if (!best || best.selections.length === 0) {
    return null;
  }

  return {
    selections: best.selections,
    totalOdds: Number(
      best.totalOdds.toFixed(2)
    ),
    targetOdds: target,
    difference: Number(
      (
        best.totalOdds - target
      ).toFixed(2)
    )
  };
}

/*
  Main engine.
*/
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
    success: Boolean(combination),

    targetOdds: Number(targetOdds),

    candidatesFound:
      allCandidates.length,

    candidatesAfterFiltering:
      filtered.length,

    combination,

    candidates: sortCandidates(
      filtered
    ).slice(0, 100)
  };
}

export {
  runSelectionEngine,
  extractCandidates,
  scoreSelection,
  filterCandidates,
  buildCombination
};

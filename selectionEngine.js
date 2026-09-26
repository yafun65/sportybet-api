function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

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

function getEventInfo(item) {
  const event = item?.event || {};

  return {
    eventId: event.eventId || "",
    gameId: event.gameId || "",
    homeTeam:
      event.homeTeamName || "",
    awayTeam:
      event.awayTeamName || "",
    startTime:
      event.startTime || 0,
    competition:
      event.competition || "",
    category:
      event.category || ""
  };
}

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

    const markets = Array.isArray(item.markets)
      ? item.markets
      : [];

    for (const market of markets) {
      const marketId =
        String(market.marketId || "");

      const marketName =
        market.market || "";

      const outcomes =
        Array.isArray(market.outcomes)
          ? market.outcomes
          : [];

      for (const outcome of outcomes) {
        const odds =
          Number(outcome.odds);

        if (
          !outcome.isActive ||
          !Number.isFinite(odds) ||
          odds <= 1
        ) {
          continue;
        }

        candidates.push({
          eventId: event.eventId,
          gameId: event.gameId,

          match:
            `${event.homeTeam} vs ${event.awayTeam}`,

          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,

          startTime:
            event.startTime,

          competition:
            event.competition,

          category:
            event.category,

          marketId,
          market: marketName,

          specifier:
            market.specifier || null,

          outcomeId:
            String(
              outcome.outcomeId || ""
            ),

          pick:
            outcome.pick || "",

          odds
        });
      }
    }
  }

  return candidates;
}

function scoreSelection(selection) {
  const odds = Number(selection.odds);

  if (!Number.isFinite(odds)) {
    return 0;
  }

  let score =
    (1 / odds) * 100;

  const market =
    normalize(selection.market);

  if (
    market.includes("double chance")
  ) {
    score += 10;
  }

  if (
    market.includes("over/under")
  ) {
    score += 8;
  }

  if (
    market.includes("draw no bet")
  ) {
    score += 8;
  }

  if (
    market.includes("gg/ng")
  ) {
    score += 6;
  }

  if (
    market.includes("asian handicap")
  ) {
    score += 5;
  }

  if (
    market.includes("1x2 - 2up")
  ) {
    score += 5;
  }

  if (
    market.includes("correct score")
  ) {
    score -= 35;
  }

  if (
    market.includes("half time/full time")
  ) {
    score -= 20;
  }

  if (odds >= 5) {
    score -= 20;
  } else if (odds >= 3) {
    score -= 10;
  }

  return Math.max(
    1,
    Math.min(95, score)
  );
}

function getRisk(score) {
  if (score >= 75) {
    return "Lower";
  }

  if (score >= 60) {
    return "Moderate";
  }

  return "High";
}

function filterCandidates(
  candidates,
  options
) {
  return candidates.filter(
    selection => {
      const odds =
        Number(selection.odds);

      const score =
        scoreSelection(selection);

      const market =
        normalize(selection.market);

      if (
        odds < options.minOdds ||
        odds > options.maxOdds
      ) {
        return false;
      }

      if (
        score < options.minConfidence
      ) {
        return false;
      }

      if (
        market.includes("correct score") ||
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

function sortCandidates(candidates) {
  return [...candidates].sort(
    (a, b) =>
      scoreSelection(b) -
      scoreSelection(a)
  );
}

function eventKey(selection) {
  return (
    selection.eventId ||
    selection.gameId ||
    selection.match
  );
}

function buildCombination(
  candidates,
  target,
  maxSelections = 15
) {
  if (!candidates.length) {
    return null;
  }

  const sorted =
    sortCandidates(candidates);

  const usedEvents =
    new Set();

  const selections = [];

  let totalOdds = 1;

  for (const candidate of sorted) {
    if (
      selections.length >=
      maxSelections
    ) {
      break;
    }

    const key =
      eventKey(candidate);

    if (usedEvents.has(key)) {
      continue;
    }

    const newTotal =
      totalOdds *
      Number(candidate.odds);

    if (
      newTotal >
      target * 1.2
    ) {
      continue;
    }

    usedEvents.add(key);

    selections.push({
      ...candidate,
      confidence:
        Math.round(
          scoreSelection(candidate)
        ),
      risk:
        getRisk(
          scoreSelection(candidate)
        )
    });

    totalOdds = newTotal;

    if (
      totalOdds >= target * 0.8
    ) {
      break;
    }
  }

  if (!selections.length) {
    return null;
  }

  return {
    totalOdds:
      Number(totalOdds.toFixed(2)),

    selections
  };
}

export function runSelectionEngine(
  items,
  target,
  options = {}
) {
  const settings = {
    minOdds:
      options.minOdds ?? 1.15,

    maxOdds:
      options.maxOdds ?? 3.5,

    minConfidence:
      options.minConfidence ?? 55,

    maxSelections:
      options.maxSelections ?? 15
  };

  const candidates =
    extractCandidates(items);

  const filtered =
    filterCandidates(
      candidates,
      settings
    );

  const combination =
    buildCombination(
      filtered,
      target,
      settings.maxSelections
    );

  return {
    success:
      Boolean(combination),

    candidatesFound:
      candidates.length,

    candidatesAfterFiltering:
      filtered.length,

    combination,

    topCandidates:
      sortCandidates(filtered)
        .slice(0, 20)
        .map(selection => ({
          ...selection,
          confidence:
            Math.round(
              scoreSelection(selection)
            ),
          risk:
            getRisk(
              scoreSelection(selection)
            )
        }))
  };
}

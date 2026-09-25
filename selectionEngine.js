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


/* =========================
   HELPERS
========================= */

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}


function isAllowedCompetition(name) {
  const value = normalize(name);

  return ALLOWED_COMPETITIONS.some(
    competition =>
      normalize(competition) === value
  );
}


function impliedProbability(odds) {
  if (!odds || odds <= 1) {
    return 0;
  }

  return 1 / odds;
}


/* =========================
   MARKET SCORING
========================= */

function marketTypeScore(marketName) {
  const market = normalize(marketName);

  if (market.includes("double chance")) {
    return 10;
  }

  if (
    market.includes("over/under") ||
    market.includes("over under")
  ) {
    return 8;
  }

  if (
    market.includes("draw no bet")
  ) {
    return 8;
  }

  if (
    market.includes("corner")
  ) {
    return 7;
  }

  if (
    market.includes("gg/ng") ||
    market.includes("both teams")
  ) {
    return 6;
  }

  if (
    market.includes("asian handicap")
  ) {
    return 5;
  }

  if (
    market.includes("2up")
  ) {
    return 5;
  }

  if (
    market.includes("handicap")
  ) {
    return 4;
  }

  if (
    market.includes("1x2")
  ) {
    return 3;
  }

  return 0;
}


function complexityPenalty(marketName) {
  const market = normalize(marketName);

  if (
    market.includes("correct score")
  ) {
    return 35;
  }

  if (
    market.includes("half time/full time") ||
    market.includes("half time / full time")
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


/* =========================
   CONFIDENCE SCORE
========================= */

function scoreSelection({
  odds,
  market
}) {

  const probability =
    impliedProbability(odds);

  let score =
    probability * 100;


  score +=
    marketTypeScore(market);


  score -=
    complexityPenalty(market);


  if (odds >= 5) {
    score -= 20;
  } else if (odds >= 3) {
    score -= 10;
  }


  if (odds <= 1.15) {
    score -= 3;
  }


  score =
    Math.max(
      1,
      Math.min(95, score)
    );


  let risk = "High";

  if (score >= 75) {
    risk = "Lower";
  } else if (score >= 60) {
    risk = "Moderate";
  }


  return {
    confidence:
      Number(score.toFixed(2)),

    risk
  };
}


/* =========================
   EVENT KEY
========================= */

function eventKey(item) {

  const event =
    item.event || item;

  return String(
    event.eventId ||
    event.id ||
    event.gameId ||
    `${event.homeTeamName || event.homeTeam || ""}-${event.awayTeamName || event.awayTeam || ""}`
  );
}


/* =========================
   GET EVENT INFORMATION
========================= */

function getEventInfo(item) {

  const event =
    item.event || item;


  const homeTeam =
    event.homeTeamName ||
    event.homeTeam ||
    event.homeTeam?.name ||
    event.home?.name ||
    "";


  const awayTeam =
    event.awayTeamName ||
    event.awayTeam ||
    event.awayTeam?.name ||
    event.away?.name ||
    "";


  const competition =
    event.competition ||
    event.tournamentName ||
    event.tournament?.name ||
    event.tournament?.tournamentName ||
    "";


  return {
    event,
    homeTeam,
    awayTeam,
    competition
  };
}


/* =========================
   EXTRACT CANDIDATES
========================= */

function extractCandidates(events) {

  const candidates = [];


  if (!Array.isArray(events)) {
    return candidates;
  }


  for (const item of events) {

    const {
      event,
      homeTeam,
      awayTeam,
      competition
    } = getEventInfo(item);


    /*
      Some SportyBet responses store the
      tournament object inside event.
    */

    const actualCompetition =
      competition ||
      item?.tournament?.name ||
      item?.tournament?.tournamentName ||
      "";


    /*
      If competition is available, respect
      the allowed competition list.
    */

    if (
      actualCompetition &&
      !isAllowedCompetition(
        actualCompetition
      )
    ) {
      continue;
    }


    const markets =
      Array.isArray(item.markets)
        ? item.markets
        : Array.isArray(event.markets)
          ? event.markets
          : [];


    for (const market of markets) {

      const marketName =
        market.market ||
        market.name ||
        "";


      const marketId =
        String(
          market.marketId ||
          market.id ||
          ""
        );


      /*
        Ignore markets that are not useful
        for the initial engine.
      */

      if (
        normalize(marketName)
          .includes("correct score") ||
        normalize(marketName)
          .includes("half time/full time")
      ) {
        continue;
      }


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

        const odds =
          Number(
            outcome.odds ||
            outcome.price ||
            0
          );


        if (
          !Number.isFinite(odds) ||
          odds <= 1
        ) {
          continue;
        }


        const pick =
          outcome.pick ||
          outcome.name ||
          "";


        if (!pick) {
          continue;
        }


        const {
          confidence,
          risk
        } =
          scoreSelection({
            odds,
            market:
              marketName
          });


        candidates.push({

          eventId:
            event.eventId ||
            event.id ||
            "",

          gameId:
            event.gameId ||
            "",

          match:
            homeTeam && awayTeam
              ? `${homeTeam} vs ${awayTeam}`
              : "Unknown Match",

          homeTeam,

          awayTeam,

          competition:
            actualCompetition,

          startTime:
            event.startTime ||
            event.start_time ||
            null,

          marketId,

          market:
            marketName,

          specifier:
            market.specifier ||
            null,

          outcomeId:
            String(
              outcome.outcomeId ||
              outcome.id ||
              ""
            ),

          pick,

          odds,

          confidence,

          risk

        });

      }

    }

  }


  return candidates;
}


/* =========================
   FILTER
========================= */

function filterCandidates(
  candidates,
  options
) {

  const {
    minOdds = 1.15,
    maxOdds = 3.5,
    minConfidence = 55
  } = options;


  return candidates.filter(
    candidate => {

      if (
        candidate.odds <
        minOdds
      ) {
        return false;
      }


      if (
        candidate.odds >
        maxOdds
      ) {
        return false;
      }


      if (
        candidate.confidence <
        minConfidence
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

  return [
    ...candidates
  ].sort(
    (a, b) =>
      b.confidence -
      a.confidence
  );
}


/* =========================
   BUILD COMBINATION
========================= */

function buildCombination(
  candidates,
  target,
  options
) {

  const {
    tolerance = 0.20,
    maxSelections = 15
  } = options;


  if (!candidates.length) {
    return null;
  }


  /*
    Keep only the strongest candidate
    from each match.
  */

  const bestByEvent =
    new Map();


  for (
    const candidate
    of candidates
  ) {

    const key =
      eventKey(candidate);


    const existing =
      bestByEvent.get(key);


    if (
      !existing ||
      candidate.confidence >
        existing.confidence
    ) {

      bestByEvent.set(
        key,
        candidate
      );

    }

  }


  const pool =
    sortCandidates(
      Array.from(
        bestByEvent.values()
      )
    );


  let bestCombination = null;

  let bestDifference =
    Infinity;


  /*
    Greedy search.

    We add strong selections while
    moving toward the requested target.
  */

  for (
    const startCandidate
    of pool
  ) {

    const combination = [
      startCandidate
    ];


    let totalOdds =
      startCandidate.odds;


    const usedEvents =
      new Set([
        eventKey(
          startCandidate
        )
      ]);


    for (
      const candidate
      of pool
    ) {

      if (
        combination.length >=
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


      const newTotal =
        totalOdds *
        candidate.odds;


      /*
        Do not allow the combination
        to overshoot excessively.
      */

      if (
        newTotal >
        target * (1 + tolerance)
      ) {
        continue;
      }


      combination.push(
        candidate
      );


      usedEvents.add(key);

      totalOdds =
        newTotal;


      if (
        totalOdds >=
        target
      ) {
        break;
      }

    }


    const difference =
      Math.abs(
        totalOdds - target
      );


    if (
      difference <
      bestDifference
    ) {

      bestDifference =
        difference;


      bestCombination = {

        selections:
          combination,

        totalOdds:
          Number(
            totalOdds.toFixed(2)
          ),

        difference:
          Number(
            difference.toFixed(2)
          ),

        averageConfidence:
          Number(
            (
              combination.reduce(
                (sum, item) =>
                  sum +
                  item.confidence,
                0
              ) /
              combination.length
            ).toFixed(2)
          )

      };

    }

  }


  return bestCombination;
}


/* =========================
   MAIN ENGINE
========================= */

function runSelectionEngine(
  events,
  target,
  options = {}
) {

  const candidates =
    extractCandidates(
      events
    );


  const filtered =
    filterCandidates(
      candidates,
      options
    );


  const sorted =
    sortCandidates(
      filtered
    );


  const combination =
    buildCombination(
      sorted,
      target,
      options
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
      sorted.slice(0, 20)

  };

}


/* =========================
   EXPORT
========================= */

export {
  runSelectionEngine
};

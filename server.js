import express from "express";
import { runSelectionEngine } from "./selectionEngine.js";

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;

const SPORTYBET_BASE = "https://www.sportybet.com";

const SPORTYBET_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "Current-Country": "NG",
  "Current-Language": "en",
  Origin: "https://www.sportybet.com",
  Referer: "https://www.sportybet.com/ng/",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36"
};

const MAX_EVENT_SEARCH_PAGES = 10;
const SELECTION_CACHE_TTL_MS = 30 * 1000;

const selectionCache = new Map();

const MARKET_IDS =
  "1,18,10,29,11,26,36,14,16,45,47,60,60100";

const ALLOWED_COMPETITIONS = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
  "UEFA Europa League",
  "UEFA Europa Conference League",
  "Champions League",
  "Europa League",
  "Europa Conference League",
  "Nations League"
];

/*
 * =========================================================
 * CORS
 * =========================================================
 */

app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );

  next();
});

/*
 * =========================================================
 * HELPERS
 * =========================================================
 */

function text(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value);
}

function isAllowedCompetition(name) {
  const value = text(name)
    .trim()
    .toLowerCase();

  if (!value) {
    return false;
  }

  return ALLOWED_COMPETITIONS.some(
    allowed => {
      const a =
        allowed.toLowerCase();

      return (
        value === a ||
        value.includes(a) ||
        a.includes(value)
      );
    }
  );
}

/*
 * =========================================================
 * SPORTYBET UPCOMING EVENTS
 * =========================================================
 */

async function fetchUpcomingEventsPage(
  page = 1,
  corners = false
) {
  const url =
    `${SPORTYBET_BASE}` +
    `/api/ng/factsCenter/pcUpcomingEvents` +
    `?sportId=sr:sport:1` +
    `&marketId=${MARKET_IDS}` +
    `&pageSize=100` +
    `&pageNum=${page}` +
    `&todayGames=false` +
    `&timeline=720` +
    `&_t=${Date.now()}`;

  console.log(
    "SportyBet URL:",
    url
  );

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: SPORTYBET_HEADERS
      }
    );

  const raw =
    await response.text();

  console.log(
    "SportyBet status:",
    response.status,
    "response length:",
    raw.length
  );

  if (!response.ok) {
    console.log(
      "SportyBet error body:",
      raw.slice(0, 2000)
    );

    throw new Error(
      `SportyBet HTTP ${response.status}`
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "SportyBet returned invalid JSON."
    );
  }

  return data;
}

/*
 * =========================================================
 * EXTRACT TOURNAMENTS
 * =========================================================
 */

function getTournaments(data) {
  return Array.isArray(
    data?.data?.tournaments
  )
    ? data.data.tournaments
    : [];
}

/*
 * =========================================================
 * CLEAN EVENT MARKETS
 * =========================================================
 */

function cleanEventMarkets(event) {
  if (!event) {
    return null;
  }

  const markets =
    Array.isArray(event.markets)
      ? event.markets
      : [];

  const cleanedMarkets = [];

  for (
    const market of markets
  ) {
    if (!market) {
      continue;
    }

    const outcomes =
      Array.isArray(
        market.outcomes
      )
        ? market.outcomes
        : [];

    const cleanedOutcomes = [];

    for (
      const outcome of outcomes
    ) {
      if (!outcome) {
        continue;
      }

      /*
       * SportyBet uses:
       * isActive: 1 = active
       * isActive: 0 = inactive
       */

      if (
        Number(outcome.isActive) === 0
      ) {
        continue;
      }

      const odds =
        Number(outcome.odds);

      const probability =
        Number(outcome.probability);

      if (
        !Number.isFinite(odds) ||
        odds < 1.01
      ) {
        continue;
      }

      if (
        !Number.isFinite(probability) ||
        probability <= 0
      ) {
        continue;
      }

      cleanedOutcomes.push({
        outcomeId:
          String(
            outcome.id || ""
          ),

        pick:
          outcome.desc || "",

        odds,

        probability,

        isActive: true
      });
    }

    if (
      !cleanedOutcomes.length
    ) {
      continue;
    }

    cleanedMarkets.push({
      marketId:
        String(
          market.id || ""
        ),

      market:
        market.desc ||
        market.name ||
        "",

      name:
        market.name ||
        market.desc ||
        "",

      specifier:
        market.specifier ??
        null,

      outcomes:
        cleanedOutcomes
    });
  }

  if (
    !cleanedMarkets.length
  ) {
    return null;
  }

  return {
    eventId:
      String(
        event.eventId || ""
      ),

    gameId:
      String(
        event.gameId || ""
      ),

    homeTeamName:
      event.homeTeamName || "",

    awayTeamName:
      event.awayTeamName || "",

    startTime:
      event.estimateStartTime ??
      null,

    competition:
      event.sport?.category?.tournament?.name ||
      "",

    category:
      event.sport?.category?.name ||
      "",

    markets:
      cleanedMarkets
  };
}

/*
 * =========================================================
 * ROOT
 * =========================================================
 */

app.get(
  "/",
  (req, res) => {
    res.json({
      status: "online",

      service:
        "SportyBet Slip Optimizer API",

      features: [
        "booking-loader",
        "event-markets",
        "multi-page-event-search",
        "selection-engine"
      ]
    });
  }
);

/*
 * =========================================================
 * DEBUG SPORTYBET
 * =========================================================
 */

app.get(
  "/debug-sportybet",
  async (req, res) => {
    try {
      const data =
        await fetchUpcomingEventsPage(
          1,
          false
        );

      return res.json({
        success: true,
        data
      });

    } catch (error) {
      console.error(
        "Debug SportyBet error:",
        error
      );

      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

/*
 * =========================================================
 * BOOKING
 * =========================================================
 */

app.get(
  "/booking/:code",
  async (req, res) => {
    const code =
      text(req.params.code)
        .trim()
        .toUpperCase();

    if (
      !/^[A-Z0-9]{4,20}$/.test(code)
    ) {
      return res.status(400).json({
        error:
          "Invalid SportyBet booking code."
      });
    }

    const url =
      `${SPORTYBET_BASE}` +
      `/api/ng/orders/share/` +
      `${encodeURIComponent(code)}`;

    try {
      const response =
        await fetch(
          url,
          {
            method: "GET",
            headers: SPORTYBET_HEADERS
          }
        );

      const raw =
        await response.text();

      if (!response.ok) {
        return res.status(502).json({
          error:
            `SportyBet returned HTTP ${response.status}.`
        });
      }

      let data;

      try {
        data =
          JSON.parse(raw);
      } catch {
        return res.status(502).json({
          error:
            "SportyBet returned a non-JSON response."
        });
      }

      const booking =
        data?.data;

      if (!booking) {
        return res.status(404).json({
          error:
            "No booking data was returned."
        });
      }

      const outcomes =
        Array.isArray(
          booking.outcomes
        )
          ? booking.outcomes
          : [];

      const selections =
        outcomes.map(
          item => ({
            event:
              item.homeTeamName &&
              item.awayTeamName
                ? `${item.homeTeamName} vs ${item.awayTeamName}`
                : item.eventName ||
                  "Unknown match",

            market:
              item.marketDesc ||
              item.marketName ||
              "Unknown market",

            pick:
              item.selectedOutcome ||
              item.selectedOutcomeName ||
              item.outcomeName ||
              item.outcome ||
              "Unknown pick",

            odds:
              item.odds !== undefined
                ? Number(item.odds)
                : null
          })
        );

      return res.json({
        shareCode:
          booking.shareCode ||
          code,

        shareURL:
          booking.shareURL ||
          null,

        deadline:
          booking.deadline ||
          null,

        selections
      });

    } catch (error) {
      console.error(
        "Booking error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to connect to SportyBet."
      });
    }
  }
);

/*
 * =========================================================
 * EVENT MARKETS
 * =========================================================
 */

app.get(
  "/event-markets/:eventId",
  async (req, res) => {
    const eventId =
      text(req.params.eventId)
        .trim();

    if (!eventId) {
      return res.status(400).json({
        error:
          "Event ID is required."
      });
    }

    try {
      const url =
        `${SPORTYBET_BASE}` +
        `/api/ng/factsCenter/eventMarkets` +
        `?eventId=${encodeURIComponent(eventId)}`;

      const response =
        await fetch(
          url,
          {
            method: "GET",
            headers: SPORTYBET_HEADERS
          }
        );

      const raw =
        await response.text();

      if (!response.ok) {
        return res.status(502).json({
          error:
            `SportyBet returned HTTP ${response.status}.`
        });
      }

      let data;

      try {
        data =
          JSON.parse(raw);
      } catch {
        return res.status(502).json({
          error:
            "SportyBet returned invalid JSON."
        });
      }

      return res.json(data);

    } catch (error) {
      console.error(
        "Event markets error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to fetch event markets."
      });
    }
  }
);

/*
 * =========================================================
 * MULTI-EVENT MARKET LOOKUP
 * =========================================================
 */

app.get(
  "/event-markets",
  async (req, res) => {
    const eventIds =
      text(req.query.eventIds)
        .split(",")
        .map(
          x => x.trim()
        )
        .filter(Boolean);

    if (!eventIds.length) {
      return res.status(400).json({
        error:
          "Please provide valid event IDs."
      });
    }

    const results = [];

    for (
      const eventId of eventIds
    ) {
      try {
        const url =
          `${SPORTYBET_BASE}` +
          `/api/ng/factsCenter/eventMarkets` +
          `?eventId=${encodeURIComponent(eventId)}`;

        const response =
          await fetch(
            url,
            {
              method: "GET",
              headers: SPORTYBET_HEADERS
            }
          );

        const raw =
          await response.text();

        let data = null;

        try {
          data =
            JSON.parse(raw);
        } catch {}

        results.push({
          eventId,
          success:
            response.ok,
          data
        });

      } catch (error) {
        results.push({
          eventId,
          success: false,
          error:
            error.message
        });
      }
    }

    return res.json({
      success: true,
      count:
        results.length,
      results
    });
  }
);

/*
 * =========================================================
 * AVAILABLE MARKETS
 * =========================================================
 */

app.get(
  "/available-markets",
  async (req, res) => {
    try {
      const data =
        await fetchUpcomingEventsPage(
          1,
          false
        );

      const tournaments =
        getTournaments(data);

      const markets = [];

      for (
        const tournament of tournaments
      ) {
        const competition =
          text(
            tournament?.name ||
            ""
          );

        if (
          !isAllowedCompetition(
            competition
          )
        ) {
          continue;
        }

        const events =
          Array.isArray(
            tournament?.events
          )
            ? tournament.events
            : [];

        for (
          const event of events
        ) {
          const cleaned =
            cleanEventMarkets(
              event
            );

          if (!cleaned) {
            continue;
          }

          for (
            const market
            of cleaned.markets
          ) {
            markets.push({
              eventId:
                cleaned.eventId,

              match:
                `${cleaned.homeTeamName} vs ${cleaned.awayTeamName}`,

              competition:
                cleaned.competition,

              marketId:
                market.marketId,

              market:
                market.market
            });
          }
        }
      }

      return res.json({
        success: true,
        count:
          markets.length,
        markets
      });

    } catch (error) {
      console.error(
        "Available markets error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          "Unable to fetch markets."
      });
    }
  }
);

/*
 * =========================================================
 * SELECTION ENGINE
 * =========================================================
 */

app.get(
  "/selection-engine",
  async (req, res) => {
    try {
      const target =
        Number(
          req.query.target || 100
        );

      if (
        !Number.isFinite(target) ||
        target <= 1
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Target odds must be greater than 1."
        });
      }

      const requestedStrategy =
        text(
          req.query.strategy ||
          "balanced"
        )
          .trim()
          .toLowerCase();

      const validStrategies = [
        "conservative",
        "balanced",
        "aggressive",
        "custom"
      ];

      if (
        !validStrategies.includes(
          requestedStrategy
        )
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Invalid strategy. Use conservative, balanced, aggressive, or custom."
        });
      }

      let strategy =
        requestedStrategy;

      let strategyConfig;

      if (
        strategy ===
        "conservative"
      ) {
        strategyConfig = {
          minOdds: 1.01,
          maxOdds: 1.20,
          minProbability: 0.55,
          minStrength: 60,
          maxSelections: 50
        };

      } else if (
        strategy ===
        "balanced"
      ) {
        strategyConfig = {
          minOdds: 1.15,
          maxOdds: 3.50,
          minProbability: 0.55,
          minStrength: 60,
          maxSelections: 15
        };

      } else if (
        strategy ===
        "aggressive"
      ) {
        strategyConfig = {
          minOdds: 1.50,
          maxOdds: 5.00,
          minProbability: 0.45,
          minStrength: 45,
          maxSelections: 15
        };

      } else {
        const customMin =
          Number(
            req.query.minOdds ||
            1.01
          );

        const customMax =
          Number(
            req.query.maxOdds ||
            3.50
          );

        const customMaxSelections =
          Number(
            req.query.maxSelections ||
            30
          );

        if (
          !Number.isFinite(customMin) ||
          !Number.isFinite(customMax) ||
          !Number.isFinite(
            customMaxSelections
          ) ||
          customMin < 1.01 ||
          customMax <= customMin ||
          customMaxSelections < 1
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid custom strategy parameters."
          });
        }

        strategyConfig = {
          minOdds:
            customMin,

          maxOdds:
            customMax,

          minProbability:
            0.55,

          minStrength:
            60,

          maxSelections:
            Math.floor(
              customMaxSelections
            )
        };
      }

      const includeCandidates =
        text(
          req.query.includeCandidates ||
          ""
        )
          .toLowerCase() ===
        "true";

      const cacheKey = [
        target,
        strategy,
        strategyConfig.minOdds,
        strategyConfig.maxOdds,
        strategyConfig.maxSelections,
        includeCandidates
      ].join(":");

      const cached =
        selectionCache.get(
          cacheKey
        );

      if (
        cached &&
        Date.now() -
          cached.timestamp <
          SELECTION_CACHE_TTL_MS
      ) {
        return res.json({
          ...cached.data,
          cached: true
        });
      }

      /*
       * Fetch pages
       */

      const pageNumbers =
        Array.from(
          {
            length:
              MAX_EVENT_SEARCH_PAGES
          },
          (_, index) =>
            index + 1
        );

      const pageData =
        await Promise.all(
          pageNumbers.map(
            pageNum =>
              fetchUpcomingEventsPage(
                pageNum,
                false
              ).catch(
                error => {
                  console.error(
                    `Selection page ${pageNum} failed:`,
                    error.message
                  );

                  return null;
                }
              )
          )
        );

      const pageResults = [];

      for (
        const data of pageData
      ) {
        if (!data) {
          continue;
        }

        const tournaments =
          getTournaments(data);

        for (
          const tournament
          of tournaments
        ) {
          const competition =
            text(
              tournament?.name ||
              ""
            );

          if (
            !isAllowedCompetition(
              competition
            )
          ) {
            continue;
          }

          const events =
            Array.isArray(
              tournament?.events
            )
              ? tournament.events
              : [];

          for (
            const event of events
          ) {
            const cleaned =
              cleanEventMarkets(
                event
              );

            if (cleaned) {
              pageResults.push(
                cleaned
              );
            }
          }
        }
      }

      console.log(
        "Selection engine events:",
        pageResults.length
      );

      const engine =
        runSelectionEngine(
          pageResults,
          target,
          {
            strategy,

            minOdds:
              strategyConfig.minOdds,

            maxOdds:
              strategyConfig.maxOdds,

            minProbability:
              strategyConfig.minProbability,

            minStrength:
              strategyConfig.minStrength,

            maxSelections:
              strategyConfig.maxSelections,

            includeCandidates
          }
        );

      const response = {
        success:
          engine.success,

        generatedAt:
          new Date().toISOString(),

        strategy,

        strategyConfig: {
          minOdds:
            strategyConfig.minOdds,

          maxOdds:
            strategyConfig.maxOdds,

          maxSelections:
            strategyConfig.maxSelections
        },

        competitions:
          ALLOWED_COMPETITIONS,

        targetOdds:
          target,

        ...engine
      };

      selectionCache.set(
        cacheKey,
        {
          timestamp:
            Date.now(),

          data:
            response
        }
      );

      return res.json({
        ...response,
        cached: false
      });

    } catch (error) {
      console.error(
        "Selection engine error:",
        error
      );

      return res.status(500).json({
        success: false,
        error:
          error.message ||
          "Selection engine failed."
      });
    }
  }
);

/*
 * =========================================================
 * CREATE BOOKING
 * =========================================================
 */

app.post(
  "/create-booking",
  async (req, res) => {
    try {
      const selections =
        Array.isArray(
          req.body?.selections
        )
          ? req.body.selections
          : [];

      if (
        !selections.length
      ) {
        return res.status(400).json({
          success: false,
          error:
            "Selections are required."
        });
      }

      return res.json({
        success: false,
        error:
          "Booking creation requires a valid SportyBet booking session."
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        error:
          error.message
      });
    }
  }
);

/*
 * =========================================================
 * START SERVER
 * =========================================================
 */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `SportyBet API running on port ${PORT}`
    );
  }
);

import {
  runSelectionEngine
} from "./selectionEngine.js";

import express from "express";

const app = express();

app.use(express.json());

/* =========================
   CORS
========================= */

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});


/* =========================
   CONFIG
========================= */

const PORT = process.env.PORT || 10000;

const SPORTYBET_BASE = "https://www.sportybet.com";
const SPORTYBET_REGION = "ng";

const MARKET_IDS =
  "1,18,10,29,11,26,36,14,16,45,47,60,60100";

const CORNER_MARKET_IDS =
  "900300,166";

const PAGE_SIZE = 100;

const MAX_EVENT_SEARCH_PAGES = 10;

const CACHE_TTL_MS = 30000;


/*
  Selection Engine cache.

  Keeps generated results for 60 seconds
  so repeated requests do not repeatedly
  scan SportyBet.
*/

const SELECTION_CACHE_TTL_MS =
  60 * 1000;

const selectionCache = new Map();


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


function normalizeCompetitionName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}


function isAllowedCompetition(name) {
  const normalized =
    normalizeCompetitionName(name);

  return ALLOWED_COMPETITIONS.some(
    competition =>
      normalizeCompetitionName(competition) ===
      normalized
  );
}


/* =========================
   SPORTYBET HEADERS
========================= */

function sportyBetHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Current-Country": "NG"
  };
}


/* =========================
   CACHE
========================= */

const pageCache = new Map();


/* =========================
   FETCH NORMAL SPORTYBET PAGE
========================= */

async function fetchUpcomingEventsPage(
  pageNum,
  forceRefresh = false
) {
  const cacheKey = `normal-${pageNum}`;

  const cached = pageCache.get(cacheKey);

  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const timestamp = Date.now();

  const url =
    `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}` +
    `/factsCenter/pcUpcomingEvents` +
    `?sportId=sr%3Asport%3A1` +
    `&marketId=${MARKET_IDS}` +
    `&pageSize=${PAGE_SIZE}` +
    `&pageNum=${pageNum}` +
    `&todayGames=false` +
    `&timeline=720` +
    `&timestamp=${timestamp}`;

  const response = await fetch(url, {
    method: "GET",
    headers: sportyBetHeaders()
  });

  if (!response.ok) {
    throw new Error(
      `SportyBet request failed: ${response.status}`
    );
  }

  const data = await response.json();

  pageCache.set(cacheKey, {
    timestamp: Date.now(),
    data
  });

  return data;
}


/* =========================
   FETCH CORNER PAGE
========================= */

async function fetchCornerEventsPage(
  pageNum,
  forceRefresh = false
) {
  const cacheKey = `corner-${pageNum}`;

  const cached = pageCache.get(cacheKey);

  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const timestamp = Date.now();

  const url =
    `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}` +
    `/factsCenter/pcUpcomingEvents` +
    `?sportId=sr%3Asport%3A1` +
    `&marketId=${CORNER_MARKET_IDS}` +
    `&pageSize=${PAGE_SIZE}` +
    `&pageNum=${pageNum}` +
    `&todayGames=false` +
    `&timeline=720` +
    `&timestamp=${timestamp}`;

  const response = await fetch(url, {
    method: "GET",
    headers: sportyBetHeaders()
  });

  if (!response.ok) {
    throw new Error(
      `SportyBet corner request failed: ${response.status}`
    );
  }

  const data = await response.json();

  pageCache.set(cacheKey, {
    timestamp: Date.now(),
    data
  });

  return data;
}


/* =========================
   TOURNAMENT HELPERS
========================= */

function getTournaments(data) {
  return data?.data?.tournaments || [];
}


function findEventInData(
  data,
  eventId
) {
  const tournaments =
    getTournaments(data);

  for (const tournament of tournaments) {
    const events =
      Array.isArray(tournament.events)
        ? tournament.events
        : [];

    for (const event of events) {
      if (
        String(event?.id || "") ===
        String(eventId)
      ) {
        return {
          event,
          tournament
        };
      }
    }
  }

  return null;
}


/* =========================
   FIND EVENT ACROSS PAGES
========================= */

async function findEventAcrossPages(
  eventId
) {
  for (
    let pageNum = 1;
    pageNum <= MAX_EVENT_SEARCH_PAGES;
    pageNum++
  ) {
    const data =
      await fetchUpcomingEventsPage(
        pageNum,
        false
      );

    const found =
      findEventInData(
        data,
        eventId
      );

    if (found) {
      return found;
    }
  }

  return null;
}


/* =========================
   FIND MULTIPLE EVENTS
========================= */

async function findEventsAcrossPages(
  eventIds
) {
  const wanted =
    new Set(
      eventIds.map(String)
    );

  const found = [];

  for (
    let pageNum = 1;
    pageNum <= MAX_EVENT_SEARCH_PAGES;
    pageNum++
  ) {
    const data =
      await fetchUpcomingEventsPage(
        pageNum,
        false
      );

    const tournaments =
      getTournaments(data);

    for (const tournament of tournaments) {
      const events =
        Array.isArray(tournament.events)
          ? tournament.events
          : [];

      for (const event of events) {
        const id =
          String(event?.id || "");

        if (wanted.has(id)) {
          found.push({
            event,
            tournament
          });
        }
      }
    }

    if (found.length >= wanted.size) {
      break;
    }
  }

  return found;
}

/* =========================
   CLEAN EVENT MARKETS
========================= */

function cleanEventMarkets(found) {
  if (!found || !found.event) {
    return null;
  }

  const event = found.event;
  const tournament = found.tournament || {};

  /* -------------------------
     TEAM NAMES
  ------------------------- */

  const homeTeamName =
    event?.homeTeamName ||
    event?.homeTeam?.name ||
    event?.competitors?.[0]?.name ||
    "";

  const awayTeamName =
    event?.awayTeamName ||
    event?.awayTeam?.name ||
    event?.competitors?.[1]?.name ||
    "";


  /* -------------------------
     EVENT IDs
  ------------------------- */

  const eventId =
    event?.eventId ||
    event?.id ||
    "";

  const gameId =
    event?.gameId ||
    "";


  /* -------------------------
     START TIME
  ------------------------- */

  const startTime =
    event?.estimateStartTime ??
    event?.startTime ??
    event?.start_time ??
    null;


  /* -------------------------
     COMPETITION
  ------------------------- */

  const competition =
    event?.sport?.category?.tournament?.name ||
    tournament?.name ||
    tournament?.tournamentName ||
    "";


  /* -------------------------
     CATEGORY
  ------------------------- */

  const category =
    event?.sport?.category?.name ||
    tournament?.category?.name ||
    tournament?.categoryName ||
    "";


  /* -------------------------
     MARKETS
  ------------------------- */

  const markets =
    Array.isArray(event?.markets)
      ? event.markets
      : [];


  const cleanedMarkets =
    markets.map(market => {

      const outcomes =
        Array.isArray(market?.outcomes)
          ? market.outcomes
          : [];


      return {

        /* Market ID */

        marketId:
          String(
            market?.id ??
            market?.marketId ??
            ""
          ),


        /* Market name */

        market:
          market?.name ||
          market?.desc ||
          market?.market ||
          "",


        /* Market specifier */

        specifier:
          market?.specifier ??
          null,


        /* Outcomes */

        outcomes:
          outcomes.map(outcome => {

            const odds =
              Number(
                outcome?.odds ??
                outcome?.price ??
                0
              );


            const probabilityValue =
              Number(
                outcome?.probability
              );


            return {

              /* Outcome ID */

              outcomeId:
                String(
                  outcome?.id ??
                  outcome?.outcomeId ??
                  ""
                ),


              /* Selection name */

              pick:
                outcome?.desc ||
                outcome?.pick ||
                outcome?.name ||
                "",


              /* Odds */

              odds:
                Number.isFinite(odds)
                  ? odds
                  : 0,


              /* SportyBet probability */

              probability:
                Number.isFinite(
                  probabilityValue
                )
                  ? probabilityValue
                  : null,


              /* Active status */

              isActive:
                outcome?.isActive !== 0 &&
                outcome?.isActive !== false

            };

          })

      };

    });


  /* -------------------------
     FINAL CLEAN OBJECT
  ------------------------- */

  return {

    event: {

      eventId,

      gameId,

      homeTeamName,

      awayTeamName,

      startTime,

      competition,

      tournament,

      category

    },

    markets:
      cleanedMarkets

  };
}

    
      

/* =========================
   HEALTH
========================= */

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "SportyBet Slip Optimizer API",

    features: [
      "booking-loader",
      "event-markets",
      "booking-generator",
      "multi-page-event-search",
      "selection-engine"
    ]
  });
});


/* =========================================================
   FAST SELECTION ENGINE
========================================================= */

app.get(
  "/selection-engine",
  async (req, res) => {

    try {

      const target =
        Number(
          req.query.target || 100
        );


      /* -------------------------
         Validate target
      ------------------------- */

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


      /* -------------------------
         Check selection cache
      ------------------------- */

      const cacheKey =
        String(target);

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


      /* -------------------------
         Fetch pages IN PARALLEL
      ------------------------- */

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
              ).catch(error => {

                console.error(
                  `Selection page ${pageNum} failed:`,
                  error.message
                );

                return null;

              })
          )
        );


      /* -------------------------
         Collect allowed events
      ------------------------- */

      const pageResults = [];


      for (const data of pageData) {

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
            tournament?.name ||
            tournament?.tournamentName ||
            "";


          if (
            !isAllowedCompetition(
              competition
            )
          ) {
            continue;
          }


          const events =
            Array.isArray(
              tournament.events
            )
              ? tournament.events
              : [];


          for (
            const event
            of events
          ) {

            const cleaned =
              cleanEventMarkets({
                event,
                tournament
              });


            if (cleaned) {
              pageResults.push(
                cleaned
              );
            }

          }

        }

      }


      /* -------------------------
         Run selection engine
      ------------------------- */

      const engine =
        runSelectionEngine(
          pageResults,
          target,
          {
            minOdds: 1.15,
            maxOdds: 3.5,
            minConfidence: 55,
            tolerance: 0.20,
            maxSelections: 15
          }
        );


      /* -------------------------
         Final response
      ------------------------- */

      const response = {

        success: true,

        generatedAt:
          new Date().toISOString(),

        competitions:
          ALLOWED_COMPETITIONS,

        targetOdds:
          target,

        ...engine

      };


      /* -------------------------
         Save to cache
      ------------------------- */

      selectionCache.set(
        cacheKey,
        {
          timestamp:
            Date.now(),

          data:
            response
        }
      );


      res.json({
        ...response,
        cached: false
      });


    } catch (error) {

      console.error(
        "Selection engine error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Selection engine failed."

      });

    }

  }
);


/* =========================================================
   AVAILABLE MARKETS
========================================================= */

app.get(
  "/available-markets",
  async (req, res) => {

    try {

      const matches = [];

      let pagesChecked = 0;

      let totalSportyBetEvents = 0;


      for (
        let pageNum = 1;
        pageNum <= MAX_EVENT_SEARCH_PAGES;
        pageNum++
      ) {

        const data =
          await fetchUpcomingEventsPage(
            pageNum,
            false
          );

        pagesChecked++;


        const tournaments =
          getTournaments(data);


        for (
          const tournament
          of tournaments
        ) {

          const competition =
            tournament?.name ||
            tournament?.tournamentName ||
            "";


          if (
            !isAllowedCompetition(
              competition
            )
          ) {
            continue;
          }


          const events =
            Array.isArray(
              tournament.events
            )
              ? tournament.events
              : [];


          for (
            const event
            of events
          ) {

            totalSportyBetEvents++;


            const cleaned =
              cleanEventMarkets({
                event,
                tournament
              });


            if (!cleaned) {
              continue;
            }


            matches.push({
              eventId:
                cleaned.event.eventId,

              gameId:
                cleaned.event.gameId,

              match:
                `${cleaned.event.homeTeamName} vs ${cleaned.event.awayTeamName}`,

              homeTeam:
                cleaned.event.homeTeamName,

              awayTeam:
                cleaned.event.awayTeamName,

              startTime:
                cleaned.event.startTime,

              competition,

              category:
                cleaned.event.category,

              markets:
                cleaned.markets
            });

          }

        }

      }


      res.json({

        success: true,

        competitions:
          ALLOWED_COMPETITIONS,

        count:
          matches.length,

        pagesChecked,

        totalSportyBetEvents,

        matches

      });


    } catch (error) {

      console.error(
        "Available markets error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Failed to load available markets."

      });

    }

  }
);


/* =========================================================
   BOOKING LOADER
========================================================= */

app.get(
  "/booking/:code",
  async (req, res) => {

    try {

      const code =
        String(
          req.params.code || ""
        ).trim();


      if (!code) {
        return res.status(400).json({
          success: false,
          error:
            "Booking code is required."
        });
      }


      const url =
        `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}/` +
        `share/${encodeURIComponent(code)}`;


      const response =
        await fetch(url, {
          headers:
            sportyBetHeaders()
        });


      if (!response.ok) {
        throw new Error(
          `SportyBet booking request failed: ${response.status}`
        );
      }


      const data =
        await response.json();


      res.json(data);


    } catch (error) {

      console.error(
        "Booking loader error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Booking loading failed."

      });

    }

  }
);


/* =========================================================
   EVENT MARKETS
========================================================= */

app.get(
  "/event-markets/:eventId",
  async (req, res) => {

    try {

      const eventId =
        req.params.eventId;


      const found =
        await findEventAcrossPages(
          eventId
        );


      if (!found) {

        return res.status(404).json({

          success: false,

          error:
            "Event not found."

        });

      }


      const cleaned =
        cleanEventMarkets(
          found
        );


      res.json({

        success: true,

        ...cleaned

      });


    } catch (error) {

      console.error(
        "Event markets error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Failed to load event markets."

      });

    }

  }
);


/* =========================================================
   MULTIPLE EVENT MARKETS
========================================================= */

app.get(
  "/event-markets",
  async (req, res) => {

    try {

      const raw =
        String(
          req.query.eventIds || ""
        );


      const eventIds =
        raw
          .split(",")
          .map(x => x.trim())
          .filter(Boolean);


      if (!eventIds.length) {

        return res.status(400).json({

          success: false,

          error:
            "eventIds query parameter is required."

        });

      }


      const found =
        await findEventsAcrossPages(
          eventIds
        );


      const events =
        found
          .map(
            cleanEventMarkets
          )
          .filter(Boolean);


      res.json({

        success: true,

        requested:
          eventIds.length,

        found:
          events.length,

        events

      });


    } catch (error) {

      console.error(
        "Multiple event markets error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Failed to load event markets."

      });

    }

  }
);


/* =========================================================
   CREATE BOOKING
========================================================= */

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


      if (!selections.length) {

        return res.status(400).json({

          success: false,

          error:
            "Selections are required."

        });

      }


      /*
        SportyBet booking endpoint.
      */

      const url =
        `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}` +
        `/ticket/booking`;


      const response =
        await fetch(url, {

          method: "POST",

          headers:
            sportyBetHeaders(),

          body:
            JSON.stringify({
              selections
            })

        });


      const data =
        await response.json();


      res.status(
        response.ok ? 200 : response.status
      ).json(data);


    } catch (error) {

      console.error(
        "Create booking error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Booking creation failed."

      });

    }

  }
);


/* =========================================================
   CORNER MARKETS
========================================================= */

app.get(
  "/corner-markets",
  async (req, res) => {

    try {

      const results = [];

      let pagesChecked = 0;

      let totalSportyBetEvents = 0;


      for (
        let pageNum = 1;
        pageNum <= MAX_EVENT_SEARCH_PAGES;
        pageNum++
      ) {

        const data =
          await fetchCornerEventsPage(
            pageNum,
            false
          );


        pagesChecked++;


        const tournaments =
          getTournaments(data);


        for (
          const tournament
          of tournaments
        ) {

          const competition =
            tournament?.name ||
            tournament?.tournamentName ||
            "";


          if (
            !isAllowedCompetition(
              competition
            )
          ) {
            continue;
          }


          const events =
            Array.isArray(
              tournament.events
            )
              ? tournament.events
              : [];


          for (
            const event
            of events
          ) {

            totalSportyBetEvents++;


            const cleaned =
              cleanEventMarkets({
                event,
                tournament
              });


            if (!cleaned) {
              continue;
            }


            for (
              const market
              of cleaned.markets
            ) {

              if (
                !CORNER_MARKET_IDS
                  .split(",")
                  .includes(
                    String(
                      market.marketId
                    )
                  )
              ) {
                continue;
              }


              for (
                const outcome
                of market.outcomes
              ) {

                results.push({

                  eventId:
                    cleaned.event.eventId,

                  gameId:
                    cleaned.event.gameId,

                  match:
                    `${cleaned.event.homeTeamName} vs ${cleaned.event.awayTeamName}`,

                  homeTeam:
                    cleaned.event.homeTeamName,

                  awayTeam:
                    cleaned.event.awayTeamName,

                  startTime:
                    cleaned.event.startTime,

                  competition,

                  category:
                    cleaned.event.category,

                  marketId:
                    market.marketId,

                  market:
                    market.market,

                  specifier:
                    market.specifier,

                  outcomeId:
                    outcome.outcomeId,

                  pick:
                    outcome.pick,

                  odds:
                    outcome.odds

                });

              }

            }

          }

        }

      }


      res.json({

        success: true,

        cornerMarketIds:
          CORNER_MARKET_IDS
            .split(","),

        count:
          results.length,

        pagesChecked,

        totalSportyBetEvents,

        markets:
          results

      });


    } catch (error) {

      console.error(
        "Corner markets error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Failed to load corner markets."

      });

    }

  }
);


/* =========================================================
   CORNER MARKET TEST
========================================================= */

app.get(
  "/corner-market-test",
  async (req, res) => {

    try {

      const data =
        await fetchCornerEventsPage(
          1,
          false
        );


      const tournaments =
        getTournaments(data);


      const results = [];


      for (
        const tournament
        of tournaments
      ) {

        const events =
          Array.isArray(
            tournament.events
          )
            ? tournament.events
            : [];


        for (
          const event
          of events
        ) {

          const cleaned =
            cleanEventMarkets({
              event,
              tournament
            });


          if (!cleaned) {
            continue;
          }


          const cornerMarkets =
            cleaned.markets.filter(
              market =>
                CORNER_MARKET_IDS
                  .split(",")
                  .includes(
                    String(
                      market.marketId
                    )
                  )
            );


          if (
            cornerMarkets.length
          ) {

            results.push({

              eventId:
                cleaned.event.eventId,

              gameId:
                cleaned.event.gameId,

              match:
                `${cleaned.event.homeTeamName} vs ${cleaned.event.awayTeamName}`,

              competition:
                tournament?.name || "",

              markets:
                cornerMarkets

            });

          }


          if (
            results.length >= 5
          ) {
            break;
          }

        }


        if (
          results.length >= 5
        ) {
          break;
        }

      }


      res.json({

        success: true,

        requestedMarketIds:
          CORNER_MARKET_IDS
            .split(","),

        totalEvents:
          data?.data?.total ||
          null,

        eventsOnPage:
          results.length,

        marketsReturned:
          results

      });


    } catch (error) {

      console.error(
        "Corner test error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Corner market test failed."

      });

    }

  }
);


/* =========================================================
   ALL MARKETS
========================================================= */

app.get(
  "/all-markets",
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
        const tournament
        of tournaments
      ) {

        const competition =
          tournament?.name ||
          tournament?.tournamentName ||
          "";


        if (
          !isAllowedCompetition(
            competition
          )
        ) {
          continue;
        }


        const events =
          Array.isArray(
            tournament.events
          )
            ? tournament.events
            : [];


        for (
          const event
          of events
        ) {

          const cleaned =
            cleanEventMarkets({
              event,
              tournament
            });


          if (!cleaned) {
            continue;
          }


          markets.push(
            ...cleaned.markets.map(
              market => ({

                eventId:
                  cleaned.event.eventId,

                match:
                  `${cleaned.event.homeTeamName} vs ${cleaned.event.awayTeamName}`,

                competition,

                ...market

              })
            )
          );

        }

      }


      res.json({

        success: true,

        count:
          markets.length,

        markets

      });


    } catch (error) {

      console.error(
        "All markets error:",
        error
      );


      res.status(500).json({

        success: false,

        error:
          error.message ||
          "Failed to load all markets."

      });

    }

  }
);


/* =========================================================
   START SERVER
========================================================= */
app.get("/selection-debug", async (req, res) => {
  try {
    const data = await fetchUpcomingEventsPage(1, false);

    const tournaments = getTournaments(data);

    const result = [];

    for (const tournament of tournaments) {
      const competition =
        tournament?.name ||
        tournament?.tournamentName ||
        "";

      if (!isAllowedCompetition(competition)) {
        continue;
      }

      const events = Array.isArray(tournament.events)
        ? tournament.events
        : [];

      for (const event of events.slice(0, 3)) {
        result.push({
          competition,
          eventKeys: Object.keys(event || {}),
          eventSample: event,
          marketsType: Array.isArray(event?.markets)
            ? "array"
            : typeof event?.markets,
          marketsCount: Array.isArray(event?.markets)
            ? event.markets.length
            : 0,
          firstMarket:
            Array.isArray(event?.markets) &&
            event.markets.length
              ? event.markets[0]
              : null
        });
      }

      if (result.length >= 3) {
        break;
      }
    }

    res.json({
      success: true,
      tournamentsFound: tournaments.length,
      matchingEvents: result.length,
      data: result
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
app.listen(
  PORT,
  () => {

    console.log(
      `SportyBet API running on port ${PORT}`
    );

  }
);

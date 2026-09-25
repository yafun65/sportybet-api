import express from "express";

const app = express();

// =====================================================
// CORS
// =====================================================

app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "https://sportybet-slip-optimizer.vercel.app"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json());

// =====================================================
// CONFIG
// =====================================================

const PORT = process.env.PORT || 10000;

const SPORTYBET_BASE = "https://www.sportybet.com";
const SPORTYBET_REGION = "ng";

// Current verified SportyBet market IDs.
// DO NOT guess or add IDs here.
const MARKET_IDS =
  "1,18,10,29,11,26,36,14,16,45,47,60,60100";

const PAGE_SIZE = 100;

const MAX_EVENT_SEARCH_PAGES = 10;

const CACHE_TTL_MS = 30000;

const pageCache = new Map();

// =====================================================
// SPORTYBET HEADERS
// =====================================================

function sportyBetHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Current-Country": "NG"
  };
}

// =====================================================
// BUILD SPORTYBET UPCOMING EVENTS URL
// =====================================================

function buildUpcomingEventsUrl(pageNum = 1) {
  const params = new URLSearchParams({
    sportId: "sr:sport:1",
    marketId: MARKET_IDS,
    pageSize: String(PAGE_SIZE),
    pageNum: String(pageNum),
    todayGames: "false",
    timeline: "720",
    _t: String(Date.now())
  });

  return (
    `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}` +
    `/factsCenter/pcUpcomingEvents?${params.toString()}`
  );
}

// =====================================================
// FETCH ONE UPCOMING EVENTS PAGE
// =====================================================

async function fetchUpcomingEventsPage(
  pageNum = 1,
  forceRefresh = false
) {
  const cached = pageCache.get(pageNum);

  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const url =
    buildUpcomingEventsUrl(pageNum);

  console.log(
    `Fetching SportyBet upcoming page ${pageNum}...`
  );

  const response = await fetch(url, {
    method: "GET",
    headers: sportyBetHeaders()
  });

  const raw = await response.text();

  console.log(
    `SportyBet upcoming page ${pageNum} status:`,
    response.status
  );

  if (!response.ok) {
    throw new Error(
      `SportyBet returned HTTP ${response.status} for page ${pageNum}.`
    );
  }

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `SportyBet returned invalid JSON for page ${pageNum}.`
    );
  }

  pageCache.set(pageNum, {
    data,
    timestamp: Date.now()
  });

  return data;
}

// =====================================================
// BACKWARD-COMPATIBLE FETCH
// =====================================================

async function fetchUpcomingEvents() {
  return fetchUpcomingEventsPage(1);
}

// =====================================================
// EXTRACT TOURNAMENTS
// =====================================================

function getTournaments(data) {
  return Array.isArray(data?.data?.tournaments)
    ? data.data.tournaments
    : [];
}

// =====================================================
// FIND EVENT IN ONE RESPONSE
// =====================================================

function findEventInData(data, eventId) {
  const tournaments =
    getTournaments(data);

  for (const tournament of tournaments) {
    const events =
      Array.isArray(tournament?.events)
        ? tournament.events
        : [];

    const found = events.find(
      event =>
        String(event?.eventId || "") ===
        String(eventId)
    );

    if (found) {
      return {
        event: found,
        tournament
      };
    }
  }

  return null;
}

// =====================================================
// SEARCH ONE EVENT ACROSS PAGES
// =====================================================

async function findEventAcrossPages(eventId) {
  const firstPage =
    await fetchUpcomingEventsPage(1);

  let found =
    findEventInData(
      firstPage,
      eventId
    );

  if (found) {
    return {
      ...found,
      foundOnPage: 1,
      pagesChecked: 1
    };
  }

  const totalNum =
    Number(
      firstPage?.data?.totalNum || 0
    );

  const calculatedPages =
    totalNum > 0
      ? Math.ceil(
          totalNum / PAGE_SIZE
        )
      : MAX_EVENT_SEARCH_PAGES;

  const pagesToCheck =
    Math.min(
      calculatedPages,
      MAX_EVENT_SEARCH_PAGES
    );

  for (
    let page = 2;
    page <= pagesToCheck;
    page++
  ) {
    const data =
      await fetchUpcomingEventsPage(page);

    found =
      findEventInData(
        data,
        eventId
      );

    if (found) {
      return {
        ...found,
        foundOnPage: page,
        pagesChecked: page
      };
    }
  }

  return {
    found: null,
    foundOnPage: null,
    pagesChecked: pagesToCheck
  };
}

// =====================================================
// SEARCH MANY EVENTS ACROSS PAGES
// =====================================================

async function findEventsAcrossPages(eventIds) {
  const wanted =
    new Set(
      eventIds.map(String)
    );

  const foundMap =
    new Map();

  const firstPage =
    await fetchUpcomingEventsPage(1);

  let pageData =
    firstPage;

  const totalNum =
    Number(
      firstPage?.data?.totalNum || 0
    );

  const calculatedPages =
    totalNum > 0
      ? Math.ceil(
          totalNum / PAGE_SIZE
        )
      : MAX_EVENT_SEARCH_PAGES;

  const pagesToCheck =
    Math.min(
      calculatedPages,
      MAX_EVENT_SEARCH_PAGES
    );

  for (
    let page = 1;
    page <= pagesToCheck;
    page++
  ) {
    if (page > 1) {
      pageData =
        await fetchUpcomingEventsPage(page);
    }

    const tournaments =
      getTournaments(pageData);

    for (const tournament of tournaments) {
      const events =
        Array.isArray(tournament?.events)
          ? tournament.events
          : [];

      for (const event of events) {
        const id =
          String(event?.eventId || "");

        if (
          wanted.has(id) &&
          !foundMap.has(id)
        ) {
          foundMap.set(id, {
            event,
            tournament,
            foundOnPage: page
          });
        }
      }
    }

    if (
      foundMap.size === wanted.size
    ) {
      break;
    }
  }

  return {
    foundMap,
    pagesChecked: pagesToCheck,
    totalNum
  };
}

// =====================================================
// CLEAN EVENT + MARKETS
// =====================================================

function cleanEventMarkets(found) {
  if (!found?.event) {
    return null;
  }

  const event =
    found.event;

  const tournament =
    found.tournament;

  const rawMarkets =
    Array.isArray(event.markets)
      ? event.markets
      : [];

  const markets = [];

  for (const market of rawMarkets) {
    const rawOutcomes =
      Array.isArray(market?.outcomes)
        ? market.outcomes
        : [];

    const outcomes = [];

    for (const outcome of rawOutcomes) {
      if (outcome?.isActive === false) {
        continue;
      }

      const odds =
        outcome?.odds !== undefined &&
        outcome?.odds !== null
          ? Number(outcome.odds)
          : null;

      outcomes.push({
        outcomeId:
          outcome?.id !== undefined &&
          outcome?.id !== null
            ? String(outcome.id)
            : null,

        pick:
          outcome?.desc ||
          outcome?.pick ||
          "Unknown pick",

        odds,

        isActive:
          outcome?.isActive !== false
      });
    }

    if (outcomes.length === 0) {
      continue;
    }

    markets.push({
      marketId:
        market?.id !== undefined &&
        market?.id !== null
          ? String(market.id)
          : null,

      market:
        market?.desc ||
        market?.market ||
        "Unknown market",

      specifier:
        market?.specifier !== undefined &&
        market?.specifier !== null
          ? String(market.specifier)
          : null,

      status:
        market?.status ||
        null,

      outcomes
    });
  }

  return {
    event: {
      eventId:
        event?.eventId || null,

      gameId:
        event?.gameId || null,

      homeTeamName:
        event?.homeTeamName || null,

      awayTeamName:
        event?.awayTeamName || null,

      startTime:
        event?.estimateStartTime ||
        event?.startTime ||
        null,

      matchStatus:
        event?.matchStatus ||
        null,

      tournament:
        tournament?.name ||
        null,

      category:
        tournament?.categoryName ||
        null
    },

    markets,

    marketCount:
      markets.length
  };
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    status: "online",

    service:
      "SportyBet Slip Optimizer API",

    features: [
      "booking-loader",
      "event-markets",
      "booking-generator",
      "multi-page-event-search",
      "market-diagnostic",
      "corner-market-scanner"
    ]
  });
});

// =====================================================
// LOAD EXISTING SPORTYBET BOOKING
// =====================================================

app.get("/booking/:code", async (req, res) => {
  const code =
    String(req.params.code || "")
      .trim()
      .toUpperCase();

  if (!/^[A-Z0-9]{4,20}$/.test(code)) {
    return res.status(400).json({
      error:
        "Invalid SportyBet booking code."
    });
  }

  const url =
    `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}` +
    `/orders/share/${encodeURIComponent(code)}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: sportyBetHeaders()
    });

    const raw =
      await response.text();

    console.log(
      "SportyBet booking status:",
      response.status
    );

    if (!response.ok) {
      return res.status(502).json({
        error:
          `SportyBet returned HTTP ${response.status}.`
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
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

    const events =
      Array.isArray(booking.outcomes)
        ? booking.outcomes
        : [];

    const selections = [];

    for (const event of events) {
      const markets =
        Array.isArray(event?.markets)
          ? event.markets
          : [];

      for (const market of markets) {
        const marketOutcomes =
          Array.isArray(market?.outcomes)
            ? market.outcomes
            : [];

        for (const outcome of marketOutcomes) {
          selections.push({
            event:
              event.homeTeamName &&
              event.awayTeamName
                ? `${event.homeTeamName} vs ${event.awayTeamName}`
                : "Unknown match",

            market:
              market.desc ||
              "Unknown market",

            pick:
              outcome.desc ||
              "Unknown pick",

            odds:
              outcome.odds !== undefined
                ? Number(outcome.odds)
                : null,

            eventId:
              event.eventId ||
              null,

            gameId:
              event.gameId ||
              null,

            marketId:
              market.id ||
              null,

            specifier:
              market.specifier ||
              null,

            outcomeId:
              outcome.id ||
              null,

            startTime:
              event.estimateStartTime ||
              event.startTime ||
              null
          });
        }
      }
    }

    if (selections.length === 0) {
      return res.status(404).json({
        error:
          "The booking was found, but no readable selections were found."
      });
    }

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
});

// =====================================================
// GET MARKETS FOR ONE EVENT
// =====================================================

app.get(
  "/event-markets/:eventId",
  async (req, res) => {
    const eventId =
      String(req.params.eventId || "")
        .trim();

    if (!/^sr:match:\d+$/.test(eventId)) {
      return res.status(400).json({
        error:
          "Invalid SportyBet event ID."
      });
    }

    try {
      const result =
        await findEventAcrossPages(
          eventId
        );

      if (!result?.event) {
        return res.status(404).json({
          success: false,

          error:
            "The event was not found in SportyBet's current upcoming markets.",

          eventId,

          pagesChecked:
            result?.pagesChecked || 0
        });
      }

      const cleaned =
        cleanEventMarkets({
          event:
            result.event,
          tournament:
            result.tournament
        });

      if (!cleaned) {
        return res.status(404).json({
          success: false,

          error:
            "SportyBet returned the event, but no usable market data was found.",

          eventId,

          foundOnPage:
            result.foundOnPage
        });
      }

      return res.json({
        success: true,

        ...cleaned,

        diagnostics: {
          foundOnPage:
            result.foundOnPage,

          pagesChecked:
            result.pagesChecked
        }
      });

    } catch (error) {
      console.error(
        "Event markets error:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          "Unable to retrieve SportyBet event markets.",

        details:
          error?.message || null,

        eventId
      });
    }
  }
);

// =====================================================
// GET MARKETS FOR MULTIPLE EVENTS
// =====================================================

app.get(
  "/event-markets",
  async (req, res) => {
    const rawIds =
      String(
        req.query.eventIds || ""
      );

    const eventIds =
      rawIds
        .split(",")
        .map(id => id.trim())
        .filter(
          id =>
            /^sr:match:\d+$/.test(id)
        )
        .slice(0, 20);

    if (eventIds.length === 0) {
      return res.status(400).json({
        error:
          "Please provide valid event IDs."
      });
    }

    try {
      const {
        foundMap,
        pagesChecked,
        totalNum
      } =
        await findEventsAcrossPages(
          eventIds
        );

      const results = [];

      for (const eventId of eventIds) {
        const found =
          foundMap.get(eventId);

        if (!found) {
          results.push({
            eventId,

            success: false,

            error:
              "Event not found in the SportyBet upcoming-event pages searched.",

            pagesChecked
          });

          continue;
        }

        const cleaned =
          cleanEventMarkets(found);

        if (!cleaned) {
          results.push({
            eventId,

            success: false,

            error:
              "Event found, but no usable market data was returned.",

            foundOnPage:
              found.foundOnPage
          });

          continue;
        }

        results.push({
          eventId,

          success: true,

          event:
            cleaned.event,

          markets:
            cleaned.markets,

          marketCount:
            cleaned.marketCount,

          foundOnPage:
            found.foundOnPage
        });
      }

      return res.json({
        success: true,

        count:
          results.length,

        results,

        diagnostics: {
          requestedEvents:
            eventIds.length,

          successfulEvents:
            results.filter(
              item => item.success
            ).length,

          failedEvents:
            results.filter(
              item => !item.success
            ).length,

          pagesChecked,

          totalSportyBetEvents:
            totalNum
        }
      });

    } catch (error) {
      console.error(
        "Batch markets error:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          "Unable to retrieve SportyBet event markets.",

        details:
          error?.message || null
      });
    }
  }
);

// =====================================================
// CREATE SPORTYBET BOOKING CODE
// =====================================================

app.post(
  "/create-booking",
  async (req, res) => {
    const selections =
      req.body?.selections;

    if (
      !Array.isArray(selections) ||
      selections.length === 0 ||
      selections.length > 100
    ) {
      return res.status(400).json({
        error:
          "Invalid selections."
      });
    }

    const sportBetSelections = [];

    for (const selection of selections) {
      if (
        !selection.eventId ||
        !selection.marketId ||
        !selection.outcomeId
      ) {
        return res.status(400).json({
          error:
            `Missing SportyBet IDs for ${
              selection.event ||
              "unknown event"
            }.`
        });
      }

      const item = {
        eventId:
          String(selection.eventId),

        marketId:
          String(selection.marketId),

        outcomeId:
          String(selection.outcomeId)
      };

      if (
        selection.specifier !== undefined &&
        selection.specifier !== null &&
        String(selection.specifier).trim() !== ""
      ) {
        item.specifier =
          String(selection.specifier);
      }

      sportBetSelections.push(item);
    }

    try {
      const response =
        await fetch(
          `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}/orders/share`,
          {
            method: "POST",

            headers:
              sportyBetHeaders(),

            body:
              JSON.stringify({
                selections:
                  sportBetSelections
              })
          }
        );

      const raw =
        await response.text();

      console.log(
        "SportyBet booking status:",
        response.status
      );

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        return res.status(502).json({
          error:
            "SportyBet returned a non-JSON booking response."
        });
      }

      if (!response.ok) {
        return res.status(502).json({
          error:
            data?.message ||
            data?.error ||
            `SportyBet returned HTTP ${response.status}.`
        });
      }

      const result =
        data?.data ||
        data?.result ||
        data;

      const shareCode =
        result?.shareCode ||
        result?.share_code ||
        null;

      const shareURL =
        result?.shareURL ||
        result?.shareUrl ||
        result?.share_url ||
        null;

      if (!shareCode) {
        return res.status(502).json({
          error:
            "SportyBet responded, but no booking code was returned."
        });
      }

      return res.status(200).json({
        success: true,

        shareCode,

        shareURL
      });

    } catch (error) {
      console.error(
        "Create booking error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to create the SportyBet booking."
      });
    }
  }
);

// =====================================================
// CORNER MARKET SCANNER
// =====================================================
//
// IMPORTANT:
// This scans the markets that SportyBet actually sends
// through our currently verified MARKET_IDS.
// It does NOT guess market IDs.
//
// Once we identify the correct SportyBet corner market
// request, this endpoint can immediately become the
// Corner Agent data source.
// =====================================================

app.get(
  "/corner-markets",
  async (req, res) => {
    try {
      const firstPage =
        await fetchUpcomingEventsPage(1);

      const totalNum =
        Number(
          firstPage?.data?.totalNum || 0
        );

      const calculatedPages =
        totalNum > 0
          ? Math.ceil(
              totalNum / PAGE_SIZE
            )
          : MAX_EVENT_SEARCH_PAGES;

      const pagesToCheck =
        Math.min(
          calculatedPages,
          MAX_EVENT_SEARCH_PAGES
        );

      const cornerMarkets = [];

      for (
        let page = 1;
        page <= pagesToCheck;
        page++
      ) {
        const data =
          page === 1
            ? firstPage
            : await fetchUpcomingEventsPage(page);

        const tournaments =
          getTournaments(data);

        for (const tournament of tournaments) {
          const events =
            Array.isArray(tournament?.events)
              ? tournament.events
              : [];

          for (const event of events) {
            const markets =
              Array.isArray(event?.markets)
                ? event.markets
                : [];

            for (const market of markets) {
              const marketName =
                String(
                  market?.desc ||
                  market?.market ||
                  ""
                );

              if (
                !marketName
                  .toLowerCase()
                  .includes("corner")
              ) {
                continue;
              }

              const outcomes =
                Array.isArray(market?.outcomes)
                  ? market.outcomes
                  : [];

              for (const outcome of outcomes) {
                if (
                  outcome?.isActive === false
                ) {
                  continue;
                }

                cornerMarkets.push({
                  eventId:
                    event?.eventId || null,

                  gameId:
                    event?.gameId || null,

                  match:
                    event?.homeTeamName &&
                    event?.awayTeamName
                      ? `${event.homeTeamName} vs ${event.awayTeamName}`
                      : "Unknown match",

                  homeTeam:
                    event?.homeTeamName || null,

                  awayTeam:
                    event?.awayTeamName || null,

                  startTime:
                    event?.estimateStartTime ||
                    event?.startTime ||
                    null,

                  competition:
                    tournament?.name || null,

                  category:
                    tournament?.categoryName || null,

                  marketId:
                    market?.id !== undefined &&
                    market?.id !== null
                      ? String(market.id)
                      : null,

                  market:
                    marketName,

                  specifier:
                    market?.specifier !== undefined &&
                    market?.specifier !== null
                      ? String(market.specifier)
                      : null,

                  outcomeId:
                    outcome?.id !== undefined &&
                    outcome?.id !== null
                      ? String(outcome.id)
                      : null,

                  pick:
                    outcome?.desc ||
                    outcome?.pick ||
                    "Unknown pick",

                  odds:
                    outcome?.odds !== undefined &&
                    outcome?.odds !== null
                      ? Number(outcome.odds)
                      : null
                });
              }
            }
          }
        }
      }

      return res.json({
        success: true,

        message:
          "Corner market scan completed.",

        count:
          cornerMarkets.length,

        pagesChecked:
          pagesToCheck,

        totalSportyBetEvents:
          totalNum,

        markets:
          cornerMarkets
      });

    } catch (error) {
      console.error(
        "Corner market scanner error:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          "Unable to retrieve corner markets.",

        details:
          error?.message || null
      });
    }
  }
);

// =====================================================
// MARKET DIAGNOSTIC
// =====================================================

app.get(
  "/all-markets",
  async (req, res) => {
    try {
      const firstPage =
        await fetchUpcomingEventsPage(1);

      const marketsFound =
        new Map();

      const tournaments =
        getTournaments(firstPage);

      for (const tournament of tournaments) {
        const events =
          Array.isArray(tournament?.events)
            ? tournament.events
            : [];

        for (const event of events) {
          const markets =
            Array.isArray(event?.markets)
              ? event.markets
              : [];

          for (const market of markets) {
            const id =
              market?.id !== undefined &&
              market?.id !== null
                ? String(market.id)
                : null;

            const name =
              market?.desc ||
              market?.market ||
              "Unknown market";

            if (id) {
              marketsFound.set(
                id,
                name
              );
            }
          }
        }
      }

      return res.json({
        success: true,

        marketCount:
          marketsFound.size,

        markets:
          Array.from(
            marketsFound,
            ([id, name]) => ({
              marketId: id,
              market: name
            })
          )
      });

    } catch (error) {
      console.error(
        "All markets diagnostic error:",
        error
      );

      return res.status(500).json({
        success: false,

        error:
          error?.message ||
          "Unable to inspect markets."
      });
    }
  }
);

// =====================================================
// START SERVER
// =====================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `SportyBet API running on port ${PORT}`
    );
  }
);

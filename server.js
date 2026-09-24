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

const MARKET_IDS =
  "1,18,10,29,11,26,36,14,16,45,47,60,60100";

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

function buildUpcomingEventsUrl() {
  const params = new URLSearchParams({
    sportId: "sr:sport:1",
    marketId: MARKET_IDS,
    pageSize: "100",
    pageNum: "1",
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
// FETCH SPORTYBET UPCOMING EVENTS
// =====================================================

async function fetchUpcomingEvents() {
  const url = buildUpcomingEventsUrl();

  const response = await fetch(url, {
    method: "GET",
    headers: sportyBetHeaders()
  });

  const raw = await response.text();

  console.log(
    "SportyBet upcoming events status:",
    response.status
  );

  if (!response.ok) {
    throw new Error(
      `SportyBet returned HTTP ${response.status}`
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

// =====================================================
// FIND EVENT INSIDE SPORTYBET RESPONSE
// =====================================================

function findEventInData(data, eventId) {
  const tournaments =
    Array.isArray(data?.data?.tournaments)
      ? data.data.tournaments
      : [];

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
// CLEAN EVENT + MARKETS
// =====================================================

function cleanEventMarkets(found) {
  if (!found?.event) {
    return null;
  }

  const event = found.event;
  const tournament = found.tournament;

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
      "booking-generator"
    ]
  });
});

// =====================================================
// LOAD EXISTING SPORTYBET BOOKING CODE
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

    const raw = await response.text();

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

    const booking = data?.data;

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
      String(req.params.eventId || "").trim();

    if (!/^sr:match:\d+$/.test(eventId)) {
      return res.status(400).json({
        error:
          "Invalid SportyBet event ID."
      });
    }

    try {
      const data =
        await fetchUpcomingEvents();

      const found =
        findEventInData(
          data,
          eventId
        );

      if (!found) {
        return res.status(404).json({
          error:
            "The event was not found in SportyBet's current upcoming markets.",

          eventId
        });
      }

      const cleaned =
        cleanEventMarkets(found);

      if (!cleaned) {
        return res.status(404).json({
          error:
            "SportyBet returned the event, but no usable market data was found.",

          eventId
        });
      }

      console.log(
        `Markets found for ${eventId}:`,
        cleaned.marketCount
      );

      return res.json(cleaned);

    } catch (error) {
      console.error(
        "Event markets error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to retrieve SportyBet event markets.",

        details:
          error?.message || null
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
      /*
       * IMPORTANT:
       * Fetch SportyBet's upcoming events ONCE.
       *
       * The previous version fetched the same large
       * SportyBet response separately for every event.
       *
       * We now search one response for all requested
       * event IDs. This is faster and more consistent.
       */

      const data =
        await fetchUpcomingEvents();

      const results = [];

      for (const eventId of eventIds) {
        const found =
          findEventInData(
            data,
            eventId
          );

        if (!found) {
          results.push({
            eventId,
            success: false,
            error:
              "Event not found."
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
              "Event found, but no usable market data was returned."
          });

          continue;
        }

        results.push({
          eventId,
          success: true,
          event: cleaned.event,
          markets: cleaned.markets,
          marketCount: cleaned.marketCount
        });
      }

      console.log(
        "Requested events:",
        eventIds.length
      );

      console.log(
        "Successful market responses:",
        results.filter(
          item => item.success
        ).length
      );

      console.log(
        "Events with usable markets:",
        results.filter(
          item =>
            item.success &&
            Array.isArray(item.markets) &&
            item.markets.length > 0
        ).length
      );

      return res.json({
        success: true,

        count:
          results.length,

        results
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

      console.log(
        "SportyBet booking response:",
        raw
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

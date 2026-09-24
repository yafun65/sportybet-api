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

const PORT =
  process.env.PORT || 10000;

const SPORTYBET_BASE =
  "https://www.sportybet.com";

const SPORTYBET_REGION =
  "ng";


// =====================================================
// SPORTYBET HEADERS
// =====================================================

function sportyBetHeaders() {

  return {

    "Accept":
      "application/json",

    "Content-Type":
      "application/json",

    "Current-Country":
      "NG"

  };

}


// =====================================================
// HOME / HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {

  res.json({

    status:
      "online",

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

app.get(
  "/booking/:code",
  async (req, res) => {

    const code =
      String(
        req.params.code || ""
      )
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
      `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}/orders/share/${encodeURIComponent(code)}`;

    try {

      const response =
        await fetch(
          url,
          {

            method:
              "GET",

            headers:
              sportyBetHeaders()

          }
        );

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

      const events =
        Array.isArray(
          booking.outcomes
        )
          ? booking.outcomes
          : [];

      const selections = [];

      for (
        const event
        of events
      ) {

        const markets =
          Array.isArray(
            event.markets
          )
            ? event.markets
            : [];

        for (
          const market
          of markets
        ) {

          const marketOutcomes =
            Array.isArray(
              market.outcomes
            )
              ? market.outcomes
              : [];

          for (
            const outcome
            of marketOutcomes
          ) {

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

      if (
        selections.length === 0
      ) {

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

  }
);


// =====================================================
// GET AVAILABLE MARKETS FOR ONE EVENT
// =====================================================
//
// This endpoint retrieves the real SportyBet markets
// and outcomes for a specific football event.
//
// The AI can later use these real selections instead
// of inventing markets such as Over 1.5.
//
// =====================================================

app.get(
  "/event-markets/:eventId",
  async (req, res) => {

    const eventId =
      String(
        req.params.eventId || ""
      ).trim();

    if (
      !/^sr:match:\d+$/.test(eventId)
    ) {

      return res.status(400).json({

        error:
          "Invalid SportyBet event ID."

      });

    }

    try {

      /*
       * SportyBet's upcoming-events endpoint
       * returns fixtures together with their markets.
       *
       * We request football and a broad collection
       * of common markets.
       */

      const params =
        new URLSearchParams({

          sportId:
            "sr:sport:1",

          marketId:
            "1,18,10,29,11,26,36,14,16,45,47,60,60100",

          pageSize:
            "100",

          pageNum:
            "1",

          todayGames:
            "false",

          timeline:
            "720",

          _t:
            String(Date.now())

        });

      const url =
        `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}/factsCenter/pcUpcomingEvents?${params.toString()}`;

      const response =
        await fetch(
          url,
          {

            method:
              "GET",

            headers:
              sportyBetHeaders()

          }
        );

      const raw =
        await response.text();

      console.log(
        "SportyBet event markets status:",
        response.status
      );

      if (!response.ok) {

        return res.status(502).json({

          error:
            `SportyBet markets request returned HTTP ${response.status}.`

        });

      }

      let data;

      try {

        data =
          JSON.parse(raw);

      } catch {

        return res.status(502).json({

          error:
            "SportyBet returned a non-JSON markets response."

        });

      }

      /*
       * SportyBet normally returns:
       *
       * data.tournaments[]
       *   └── events[]
       *       └── markets[]
       *           └── outcomes[]
       */

      const tournaments =
        Array.isArray(
          data?.data?.tournaments
        )
          ? data.data.tournaments
          : [];

      let foundEvent =
        null;

      let tournamentInfo =
        null;

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

        const match =
          events.find(
            event =>
              String(
                event.eventId
              ) === eventId
          );

        if (match) {

          foundEvent =
            match;

          tournamentInfo =
            tournament;

          break;

        }

      }

      if (!foundEvent) {

        return res.status(404).json({

          error:
            "The event was not found in SportyBet's current upcoming markets."

        });

      }

      const markets = [];

      const rawMarkets =
        Array.isArray(
          foundEvent.markets
        )
          ? foundEvent.markets
          : [];

      for (
        const market
        of rawMarkets
      ) {

        const outcomes =
          Array.isArray(
            market.outcomes
          )
            ? market.outcomes
            : [];

        const cleanOutcomes = [];

        for (
          const outcome
          of outcomes
        ) {

          /*
           * Ignore suspended/inactive outcomes
           * when SportyBet explicitly marks them inactive.
           */

          if (
            outcome.isActive === false
          ) {
            continue;
          }

          cleanOutcomes.push({

            outcomeId:
              outcome.id ||
              null,

            pick:
              outcome.desc ||
              "Unknown pick",

            odds:
              outcome.odds !== undefined
                ? Number(outcome.odds)
                : null,

            isActive:
              outcome.isActive !== false

          });

        }

        if (
          cleanOutcomes.length === 0
        ) {
          continue;
        }

        markets.push({

          marketId:
            market.id ||
            null,

          market:
            market.desc ||
            "Unknown market",

          specifier:
            market.specifier ||
            null,

          status:
            market.status ||
            null,

          outcomes:
            cleanOutcomes

        });

      }

      return res.json({

        event: {

          eventId:
            foundEvent.eventId ||
            eventId,

          gameId:
            foundEvent.gameId ||
            null,

          homeTeamName:
            foundEvent.homeTeamName ||
            null,

          awayTeamName:
            foundEvent.awayTeamName ||
            null,

          startTime:
            foundEvent.estimateStartTime ||
            null,

          matchStatus:
            foundEvent.matchStatus ||
            null,

          tournament:
            tournamentInfo?.name ||
            null,

          category:
            tournamentInfo?.categoryName ||
            null

        },

        markets,

        marketCount:
          markets.length

      });

    } catch (error) {

      console.error(
        "Event markets error:",
        error
      );

      return res.status(500).json({

        error:
          "Unable to retrieve SportyBet event markets."

      });

    }

  }
);


// =====================================================
// GET MARKETS FOR MULTIPLE EVENTS
// =====================================================
//
// This is useful for the optimizer.
//
// Example:
//
// GET /event-markets?eventIds=sr:match:123,sr:match:456
//
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
        .map(
          id =>
            id.trim()
        )
        .filter(
          id =>
            /^sr:match:\d+$/.test(id)
        );

    if (
      eventIds.length === 0
    ) {

      return res.status(400).json({

        error:
          "Please provide valid event IDs."

      });

    }

    /*
     * Protect the API from very large requests.
     */

    const limitedIds =
      eventIds.slice(0, 20);

    const results = [];

    for (
      const eventId
      of limitedIds
    ) {

      try {

        const params =
          new URLSearchParams({

            sportId:
              "sr:sport:1",

            marketId:
              "1,18,10,29,11,26,36,14,16,45,47,60,60100",

            pageSize:
              "100",

            pageNum:
              "1",

            todayGames:
              "false",

            timeline:
              "720",

            _t:
              String(Date.now())

          });

        const url =
          `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}/factsCenter/pcUpcomingEvents?${params.toString()}`;

        const response =
          await fetch(
            url,
            {

              method:
                "GET",

              headers:
                sportyBetHeaders()

            }
          );

        const raw =
          await response.text();

        if (!response.ok) {

          results.push({

            eventId,

            success:
              false,

            error:
              `SportyBet returned HTTP ${response.status}.`

          });

          continue;

        }

        let data;

        try {

          data =
            JSON.parse(raw);

        } catch {

          results.push({

            eventId,

            success:
              false,

            error:
              "SportyBet returned invalid JSON."

          });

          continue;

        }

        const tournaments =
          Array.isArray(
            data?.data?.tournaments
          )
            ? data.data.tournaments
            : [];

        let foundEvent =
          null;

        let tournamentInfo =
          null;

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

          const match =
            events.find(
              event =>
                String(
                  event.eventId
                ) === eventId
            );

          if (match) {

            foundEvent =
              match;

            tournamentInfo =
              tournament;

            break;

          }

        }

        if (!foundEvent) {

          results.push({

            eventId,

            success:
              false,

            error:
              "Event not found."

          });

          continue;

        }

        const markets = [];

        const rawMarkets =
          Array.isArray(
            foundEvent.markets
          )
            ? foundEvent.markets
            : [];

        for (
          const market
          of rawMarkets
        ) {

          const rawOutcomes =
            Array.isArray(
              market.outcomes
            )
              ? market.outcomes
              : [];

          const outcomes = [];

          for (
            const outcome
            of rawOutcomes
          ) {

            if (
              outcome.isActive === false
            ) {
              continue;
            }

            outcomes.push({

              outcomeId:
                outcome.id ||
                null,

              pick:
                outcome.desc ||
                "Unknown pick",

              odds:
                outcome.odds !== undefined
                  ? Number(outcome.odds)
                  : null

            });

          }

          if (
            outcomes.length > 0
          ) {

            markets.push({

              marketId:
                market.id ||
                null,

              market:
                market.desc ||
                "Unknown market",

              specifier:
                market.specifier ||
                null,

              outcomes

            });

          }

        }

        results.push({

          eventId,

          success:
            true,

          event: {

            eventId:
              foundEvent.eventId,

            gameId:
              foundEvent.gameId ||
              null,

            homeTeamName:
              foundEvent.homeTeamName ||
              null,

            awayTeamName:
              foundEvent.awayTeamName ||
              null,

            startTime:
              foundEvent.estimateStartTime ||
              null,

            matchStatus:
              foundEvent.matchStatus ||
              null,

            tournament:
              tournamentInfo?.name ||
              null

          },

          markets

        });

      } catch (error) {

        console.error(
          `Markets error for ${eventId}:`,
          error
        );

        results.push({

          eventId,

          success:
            false,

          error:
            "Unable to retrieve event markets."

        });

      }

    }

    return res.json({

      success:
        true,

      count:
        results.length,

      results

    });

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

    for (
      const selection
      of selections
    ) {

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
          String(
            selection.eventId
          ),

        marketId:
          String(
            selection.marketId
          ),

        outcomeId:
          String(
            selection.outcomeId
          )

      };

      if (
        selection.specifier
      ) {

        item.specifier =
          String(
            selection.specifier
          );

      }

      sportBetSelections.push(
        item
      );

    }


    try {

      const response =
        await fetch(
          `${SPORTYBET_BASE}/api/${SPORTYBET_REGION}/orders/share`,
          {

            method:
              "POST",

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

        data =
          JSON.parse(raw);

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

        success:
          true,

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

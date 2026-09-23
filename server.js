import express from "express";

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;

const SPORTYBET_BASE = "https://www.sportybet.com";


// =====================================================
// HOME / HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "SportyBet Slip Optimizer API"
  });
});


// =====================================================
// LOAD EXISTING SPORTYBET BOOKING CODE
// =====================================================

app.get("/booking/:code", async (req, res) => {

  const code = String(req.params.code || "")
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9]{4,20}$/.test(code)) {
    return res.status(400).json({
      error: "Invalid SportyBet booking code."
    });
  }

  const url =
    `${SPORTYBET_BASE}/api/ng/orders/share/${encodeURIComponent(code)}`;

  try {

    const response = await fetch(url, {
      method: "GET",

      headers: {
        "Accept": "application/json",
        "Current-Country": "NG"
      }
    });

    const raw = await response.text();

    console.log(
      "SportyBet status:",
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
        Array.isArray(event.markets)
          ? event.markets
          : [];

      for (const market of markets) {

        const marketOutcomes =
          Array.isArray(market.outcomes)
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
// CREATE SPORTYBET BOOKING CODE
// =====================================================

app.post("/create-booking", async (req, res) => {

  const selections = req.body?.selections;

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


  // ---------------------------------------------------
  // Validate SportyBet IDs
  // ---------------------------------------------------

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
            selection.event || "unknown event"
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

    if (selection.specifier) {

      item.specifier =
        String(selection.specifier);

    }

    sportBetSelections.push(item);
  }


  // ---------------------------------------------------
  // Send booking request to SportyBet
  // ---------------------------------------------------

  try {

    const response = await fetch(
      `${SPORTYBET_BASE}/api/ng/orders/share`,
      {

        method: "POST",

        headers: {

          "Accept":
            "application/json",

          "Content-Type":
            "application/json",

          "Current-Country":
            "NG"

        },

        body: JSON.stringify({

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

});


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

import express from "express";

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 10000;

const SPORTYBET_BASE =
  "https://www.sportybet.com";

app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "SportyBet Slip Optimizer API"
  });
});

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

    console.log(
      "Response length:",
      raw.length
    );

    if (!response.ok) {
      return res.status(502).json({
        error: `SportyBet returned HTTP ${response.status}.`
      });
    }

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({
        error: "SportyBet returned a non-JSON response."
      });
    }

    const booking = data?.data;

    if (!booking) {
      return res.status(404).json({
        error: "No booking data was returned."
      });
    }

    const outcomes = Array.isArray(booking.outcomes)
      ? booking.outcomes
      : [];

    const selections = outcomes.map((item) => ({
      event:
        item.homeTeamName && item.awayTeamName
          ? `${item.homeTeamName} vs ${item.awayTeamName}`
          : item.eventName || "Unknown match",

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
    }));

    return res.json({
      shareCode:
        booking.shareCode || code,

      shareURL:
        booking.shareURL || null,

      deadline:
        booking.deadline || null,

      selections
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Unable to connect to SportyBet."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `SportyBet API running on port ${PORT}`
  );
});

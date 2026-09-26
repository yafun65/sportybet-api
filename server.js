import express from "express";
import cors from "cors";
import axios from "axios";

// Import your existing selection engine baseline
// Ensure selectionEngine.js exports runSelectionEngine
import { runSelectionEngine } from "./selectionEngine.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Base configuration for SportyBet Nigeria
const SPORTYBET_API_BASE = "https://www.sportybet.com/api/ng";
const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9"
};

// Middleware
app.use(cors());
app.use(express.json());

// In-memory Caches
const selectionCache = new Map();
const SELECTION_CACHE_TTL_MS = 60 * 1000; // 1 minute
const MAX_EVENT_SEARCH_PAGES = 5;

// Competitions of interest
const ALLOWED_COMPETITIONS = [
  "Premier League",
  "LaLiga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
  "UEFA Europa League",
  "UEFA Europa Conference League"
];

// Helper: Competition filtering
function isAllowedCompetition(competitionName) {
  if (!competitionName) return false;
  return ALLOWED_COMPETITIONS.some((comp) =>
    competitionName.toLowerCase().includes(comp.toLowerCase())
  );
}

// Helper: Normalize SportyBet Tournament structures
function getTournaments(data) {
  if (!data) return [];
  if (Array.isArray(data.tournaments)) return data.tournaments;
  if (Array.isArray(data.data?.tournaments)) return data.data.tournaments;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

// Helper: Clean raw event and market data
function cleanEventMarkets({ event, tournament }) {
  if (!event || !event.eventId) return null;

  return {
    eventId: event.eventId,
    gameId: event.gameId,
    homeTeamName: event.homeTeamName,
    awayTeamName: event.awayTeamName,
    estimateStartTime: event.estimateStartTime,
    tournamentName: tournament?.name || tournament?.tournamentName || "Unknown",
    markets: Array.isArray(event.markets) ? event.markets : []
  };
}

// Helper: Fetch upcoming event pages directly from SportyBet
async function fetchUpcomingEventsPage(pageNum = 1) {
  const url = `${SPORTYBET_API_BASE}/factsCenter/pcUpcomingEvents`;
  const params = {
    sportId: "sr:sport:soccer",
    pageNo: pageNum,
    pageSize: 30
  };

  const response = await axios.get(url, {
    params,
    headers: DEFAULT_HEADERS,
    timeout: 8000
  });

  return response.data;
}

/*
 * ============================================================
 * 1. HEALTH CHECK ROUTE
 * ============================================================
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "sportybet-api"
  });
});

/*
 * ============================================================
 * 2. BOOKING LOOKUP: /booking/:code
 * ============================================================
 */
app.get("/booking/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const url = `${SPORTYBET_API_BASE}/orders/share/${code}`;

    const response = await axios.get(url, {
      headers: DEFAULT_HEADERS,
      timeout: 8000
    });

    res.json({
      success: true,
      bookingCode: code,
      data: response.data
    });
  } catch (error) {
    console.error(`Booking code retrieval failed (${req.params.code}):`, error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || "Failed to load booking code."
    });
  }
});

/*
 * ============================================================
 * 3. EVENT MARKETS: /event-markets/:eventId OR /event-markets
 * ============================================================
 */
app.get("/event-markets/:eventId?", async (req, res) => {
  try {
    const eventId = req.params.eventId || req.query.eventId;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: "Missing required parameter: eventId"
      });
    }

    const url = `${SPORTYBET_API_BASE}/factsCenter/event`;
    const response = await axios.get(url, {
      params: { eventId },
      headers: DEFAULT_HEADERS,
      timeout: 8000
    });

    res.json({
      success: true,
      eventId,
      data: response.data
    });
  } catch (error) {
    console.error("Event markets retrieval failed:", error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || "Failed to retrieve event markets."
    });
  }
});

/*
 * ============================================================
 * 4. CORNERS SCANNER ROUTE: /corners
 * ============================================================
 */
app.get("/corners", async (req, res) => {
  try {
    const pageData = await fetchUpcomingEventsPage(1);
    const tournaments = getTournaments(pageData);
    const cornerMarkets = [];

    for (const tournament of tournaments) {
      const competition = tournament?.name || tournament?.tournamentName || "";
      if (!isAllowedCompetition(competition)) continue;

      const events = Array.isArray(tournament.events) ? tournament.events : [];
      for (const event of events) {
        const markets = Array.isArray(event.markets) ? event.markets : [];
        const corners = markets.filter(
          (m) =>
            m.desc?.toLowerCase().includes("corner") ||
            m.name?.toLowerCase().includes("corner")
        );

        if (corners.length > 0) {
          cornerMarkets.push({
            eventId: event.eventId,
            match: `${event.homeTeamName} vs ${event.awayTeamName}`,
            tournament: competition,
            markets: corners
          });
        }
      }
    }

    res.json({
      success: true,
      count: cornerMarkets.length,
      data: cornerMarkets
    });
  } catch (error) {
    console.error("Corner scanning error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message || "Corner scanning failed."
    });
  }
});

/*
 * ============================================================
 * 5. SELECTION ENGINE: /selection-engine
 * ============================================================
 */
app.get("/selection-engine", async (req, res) => {
  try {
    const target = Number(req.query.target || 100);

    if (!Number.isFinite(target) || target <= 1) {
      return res.status(400).json({
        success: false,
        error: "Target odds must be greater than 1."
      });
    }

    /*
     * STRATEGY SETUP
     */
    const requestedStrategy = String(req.query.strategy || "balanced")
      .trim()
      .toLowerCase();

    const validStrategies = ["conservative", "balanced", "aggressive", "custom"];

    if (!validStrategies.includes(requestedStrategy)) {
      return res.status(400).json({
        success: false,
        error: "Invalid strategy. Use conservative, balanced, aggressive, or custom."
      });
    }

    let strategy = requestedStrategy;
    let strategyConfig;

    if (strategy === "conservative") {
      strategyConfig = {
        minOdds: 1.01,
        maxOdds: 1.2,
        minProbability: 0.55,
        minStrength: 60,
        maxSelections: 50
      };
    } else if (strategy === "balanced") {
      strategyConfig = {
        minOdds: 1.15,
        maxOdds: 3.5,
        minProbability: 0.55,
        minStrength: 60,
        maxSelections: 15
      };
    } else if (strategy === "aggressive") {
      strategyConfig = {
        minOdds: 1.5,
        maxOdds: 5.0,
        minProbability: 0.45,
        minStrength: 45,
        maxSelections: 15
      };
    } else {
      const customMin = Number(req.query.minOdds || 1.01);
      const customMax = Number(req.query.maxOdds || 3.5);
      const customMaxSelections = Number(req.query.maxSelections || 30);

      if (
        !Number.isFinite(customMin) ||
        !Number.isFinite(customMax) ||
        !Number.isFinite(customMaxSelections) ||
        customMin < 1.01 ||
        customMax <= customMin ||
        customMaxSelections < 1
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid custom strategy parameters."
        });
      }

      strategyConfig = {
        minOdds: customMin,
        maxOdds: customMax,
        minProbability: 0.55,
        minStrength: 60,
        maxSelections: Math.floor(customMaxSelections)
      };
    }

    /*
     * CACHE CHECK
     */
    const cacheKey = [
      target,
      strategy,
      strategyConfig.minOdds,
      strategyConfig.maxOdds,
      strategyConfig.maxSelections
    ].join(":");

    const cached = selectionCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < SELECTION_CACHE_TTL_MS) {
      return res.json({
        ...cached.data,
        cached: true
      });
    }

    /*
     * FETCH SPORTYBET DATA
     */
    const pageNumbers = Array.from(
      { length: MAX_EVENT_SEARCH_PAGES },
      (_, index) => index + 1
    );

    const pageData = await Promise.all(
      pageNumbers.map((pageNum) =>
        fetchUpcomingEventsPage(pageNum).catch((error) => {
          console.error(`Selection page ${pageNum} failed:`, error.message);
          return null;
        })
      )
    );

    /*
     * BUILD TOURNAMENT & EVENT LIST
     */
    const pageResults = [];

    for (const data of pageData) {
      if (!data) continue;

      const tournaments = getTournaments(data);

      for (const tournament of tournaments) {
        const competition = tournament?.name || tournament?.tournamentName || "";

        if (!isAllowedCompetition(competition)) {
          continue;
        }

        const events = Array.isArray(tournament.events) ? tournament.events : [];

        for (const event of events) {
          const cleaned = cleanEventMarkets({ event, tournament });
          if (cleaned) {
            pageResults.push(cleaned);
          }
        }
      }
    }

    /*
     * RUN ENGINE
     */
    const engine = runSelectionEngine(pageResults, target, {
      strategy,
      minOdds: strategyConfig.minOdds,
      maxOdds: strategyConfig.maxOdds,
      minProbability: strategyConfig.minProbability,
      minStrength: strategyConfig.minStrength,
      maxSelections: strategyConfig.maxSelections,
      tolerance: 0.2
    });

    /*
     * RESPONSE & WRITE CACHE
     */
    const response = {
      success: engine.success,
      generatedAt: new Date().toISOString(),
      strategy,
      strategyConfig: {
        minOdds: strategyConfig.minOdds,
        maxOdds: strategyConfig.maxOdds,
        maxSelections: strategyConfig.maxSelections
      },
      competitions: ALLOWED_COMPETITIONS,
      targetOdds: target,
      ...engine
    };

    selectionCache.set(cacheKey, {
      timestamp: Date.now(),
      data: response
    });

    res.json({
      ...response,
      cached: false
    });
  } catch (error) {
    console.error("Selection engine error:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Selection engine failed."
    });
  }
});

/*
 * ============================================================
 * 6. CREATE BOOKING: /create-booking
 * ============================================================
 */
app.post("/create-booking", async (req, res) => {
  try {
    const { selections } = req.body;

    if (!Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Payload requires an array of selections."
      });
    }

    const url = `${SPORTYBET_API_BASE}/orders/share`;
    const response = await axios.post(
      url,
      { selections },
      {
        headers: {
          ...DEFAULT_HEADERS,
          "Content-Type": "application/json"
        },
        timeout: 8000
      }
    );

    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error("Booking generation failed:", error.message);
    res.status(error.response?.status || 500).json({
      success: false,
      error: error.message || "Failed to generate booking code."
    });
  }
});

/*
 * ============================================================
 * SERVER STARTUP
 * ============================================================
 */
app.listen(PORT, () => {
  console.log(`Server initialized successfully on port ${PORT}`);
});

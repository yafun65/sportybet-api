app.get("/selection-engine", async (req, res) => {

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


    /*
     * =========================
     * STRATEGY
     * =========================
     */

    const requestedStrategy =
      String(
        req.query.strategy ||
        "balanced"
      ).trim().toLowerCase();


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


    /*
     * =========================
     * CONSERVATIVE
     * =========================
     *
     * HARD MAXIMUM = 1.20
     */

    if (
      strategy === "conservative"
    ) {

      strategyConfig = {

        minOdds: 1.01,

        maxOdds: 1.20,

        minProbability: 0.55,

        minStrength: 60,

        maxSelections: 50

      };

    }


    /*
     * =========================
     * BALANCED
     * =========================
     */

    else if (
      strategy === "balanced"
    ) {

      strategyConfig = {

        minOdds: 1.15,

        maxOdds: 3.50,

        minProbability: 0.55,

        minStrength: 60,

        maxSelections: 15

      };

    }


    /*
     * =========================
     * AGGRESSIVE
     * =========================
     */

    else if (
      strategy === "aggressive"
    ) {

      strategyConfig = {

        minOdds: 1.50,

        maxOdds: 5.00,

        minProbability: 0.45,

        minStrength: 45,

        maxSelections: 15

      };

    }


    /*
     * =========================
     * CUSTOM
     * =========================
     */

    else {

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
        !Number.isFinite(customMaxSelections) ||
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


    /*
     * =========================
     * CACHE
     * =========================
     *
     * IMPORTANT:
     * Different strategies must
     * never share the same cache.
     */

    const cacheKey = [

      target,

      strategy,

      strategyConfig.minOdds,

      strategyConfig.maxOdds,

      strategyConfig.maxSelections

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
     * =========================
     * FETCH SPORTYBET DATA
     * =========================
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


    /*
     * =========================
     * BUILD PAGE RESULTS
     * =========================
     */

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
          const event of events
        ) {

          const cleaned =
            cleanEventMarkets({

              event,

              tournament

            });


          if (
            cleaned
          ) {

            pageResults.push(
              cleaned
            );

          }

        }

      }

    }


    /*
     * =========================
     * RUN ENGINE
     * =========================
     */

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

          tolerance: 0.20

        }
      );


    /*
     * =========================
     * RESPONSE
     * =========================
     */

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

});

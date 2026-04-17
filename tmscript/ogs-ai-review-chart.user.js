// ==UserScript==
// @name         OGS AI Review Move Quality Chart
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a horizontal move quality chart to OGS game pages showing each move as a black/white stone in its quality row
// @author       You
// @match        https://online-go.com/game/*
// @match        https://online-go.com/review/*
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    // ==================== Constants ====================
    const CATEGORIES = ["Excellent", "Great", "Good", "Inaccuracy", "Mistake", "Blunder"];

    const SCORE_THRESHOLDS = {
        Excellent: 0.2,
        Great: 0.6,
        Good: 1.2,
        Inaccuracy: 4.0,
        Mistake: 10.0,
    };

    const CATEGORY_COLORS = {
        Excellent: "#2E86AB",
        Great: "#3DA35D",
        Good: "#6AB04C",
        Inaccuracy: "#E8A838",
        Mistake: "#E87D3E",
        Blunder: "#D64545",
    };

    // Granular score-loss buckets for the quantitative panel.
    // Each entry: { label, min (inclusive), max (exclusive) }
    // 0.0–3.0 in steps of 0.2, 3.0–10.0 in steps of 0.5, 10.0–15.0 in steps of 1.0, 15+ catch-all
    function buildScoreBuckets() {
        const buckets = [];
        // 0.0 to 3.0 by 0.2
        for (let v = 0; v < 3.0 - 0.001; v = Math.round((v + 0.2) * 10) / 10) {
            const next = Math.round((v + 0.2) * 10) / 10;
            buckets.push({ label: v.toFixed(1), min: v, max: next });
        }
        // 3.0 to 10.0 by 0.5
        for (let v = 3.0; v < 10.0 - 0.001; v = Math.round((v + 0.5) * 10) / 10) {
            const next = Math.round((v + 0.5) * 10) / 10;
            buckets.push({ label: v.toFixed(1), min: v, max: next });
        }
        // 10.0 to 15.0 by 1.0
        for (let v = 10.0; v < 15.0 - 0.001; v = Math.round((v + 1.0) * 10) / 10) {
            const next = Math.round((v + 1.0) * 10) / 10;
            buckets.push({ label: v.toFixed(1), min: v, max: next });
        }
        // 15+ catch-all
        buckets.push({ label: "15+", min: 15.0, max: Infinity });
        return buckets;
    }
    const SCORE_BUCKETS = buildScoreBuckets();

    const STONE_RADIUS = 7;
    const STONE_SPACING = 18;
    const QUANT_ROW_HEIGHT = 14;
    const QUANT_STONE_R = 5;
    const LABEL_WIDTH = 80;
    const MOVE_NUM_HEIGHT = 16;
    const PADDING = { top: 8, right: 15, bottom: 8, left: 10 };

    // ==================== API Helpers ====================

    function getGameId() {
        const match = window.location.pathname.match(/\/game\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }

    async function fetchJSON(url) {
        const resp = await fetch(url, { credentials: "same-origin" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
        return resp.json();
    }

    async function getGameData(gameId) {
        return fetchJSON(`/api/v1/games/${gameId}`);
    }

    async function isGameFinished(gameId) {
        try {
            const gameData = await getGameData(gameId);
            // Check both top-level and nested gamedata for phase
            const phase = gameData.gamedata?.phase ?? gameData.phase;
            if (phase === "finished") return true;
            // ended is a non-empty datetime string only for completed games
            if (typeof gameData.ended === "string" && gameData.ended.length > 0) return true;
            // outcome is non-empty (e.g. "Resignation") only for completed games
            if (typeof gameData.outcome === "string" && gameData.outcome.length > 0) return true;
            return false;
        } catch (e) {
            console.warn("[AI Quality Chart] Could not check game status:", e);
            return false;
        }
    }

    // ==================== React Fiber Data Reading ====================

    // OGS has already received AI review data via websocket and rendered the
    // SummaryTable component. We read the categorization directly from its
    // React props instead of re-implementing the websocket protocol.
    function getCategorizationFromReactFiber() {
        const table = document.querySelector(".ai-summary-table");
        if (!table) return null;

        const fiberKey = Object.keys(table).find(
            (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
        );
        if (!fiberKey) return null;

        let fiber = table[fiberKey];
        for (let i = 0; i < 30 && fiber; i++) {
            const props = fiber.memoizedProps || fiber.pendingProps;
            if (props && props.categorization && props.categorization.categorized_moves) {
                return props.categorization;
            }
            fiber = fiber.return;
        }
        return null;
    }

    function buildMovesFromCategorization(categorization) {
        const result = [];
        const { categorized_moves, score_loss_list } = categorization;
        if (!categorized_moves) return result;

        // Build a lookup map: "player-moveNum" → scoreLoss
        const scoreLossMap = new Map();
        for (const player of ["black", "white"]) {
            for (const { move, scoreLoss } of (score_loss_list?.[player] || [])) {
                scoreLossMap.set(`${player}-${move}`, scoreLoss);
            }
        }

        for (const player of ["black", "white"]) {
            for (const category of CATEGORIES) {
                const moveNums = categorized_moves[player]?.[category] || [];
                for (const moveNum of moveNums) {
                    const scoreLoss = scoreLossMap.get(`${player}-${moveNum}`) ?? null;
                    result.push({ move: moveNum, player, category, scoreLoss });
                }
            }
        }

        result.sort((a, b) => a.move - b.move);
        return result;
    }

    // ==================== Chart Rendering ====================

    function scoreLossColor(scoreLoss) {
        if (scoreLoss == null) return "#888888";
        if (scoreLoss < SCORE_THRESHOLDS.Excellent)  return CATEGORY_COLORS.Excellent;
        if (scoreLoss < SCORE_THRESHOLDS.Great)      return CATEGORY_COLORS.Great;
        if (scoreLoss < SCORE_THRESHOLDS.Good)       return CATEGORY_COLORS.Good;
        if (scoreLoss < SCORE_THRESHOLDS.Inaccuracy) return CATEGORY_COLORS.Inaccuracy;
        if (scoreLoss < SCORE_THRESHOLDS.Mistake)    return CATEGORY_COLORS.Mistake;
        return CATEGORY_COLORS.Blunder;
    }

    function createChart(categorizedMoves) {
        if (categorizedMoves.length === 0) return null;

        const totalMoves = categorizedMoves.length;
        const stoneAreaWidth = PADDING.left + totalMoves * STONE_SPACING + PADDING.right;
        const totalWidth = LABEL_WIDTH + stoneAreaWidth;
        const quantHeight = SCORE_BUCKETS.length * QUANT_ROW_HEIGHT;
        const totalHeight = PADDING.top + MOVE_NUM_HEIGHT + quantHeight + PADDING.bottom;

        const quantStartY = PADDING.top + MOVE_NUM_HEIGHT;
        const stonesX = LABEL_WIDTH + PADDING.left;

        const container = document.createElement("div");
        container.id = "ogs-ai-quality-chart";
        container.style.cssText = `
            margin: 8px 0;
            padding: 0;
            overflow-x: auto;
            overflow-y: visible;
            background: var(--bg-color, #1a1a1a);
            border-radius: 6px;
            border: 1px solid rgba(255,255,255,0.1);
            width: 100%;
        `;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("width", totalWidth);
        svg.setAttribute("height", totalHeight);
        svg.style.display = "block";
        svg.style.minWidth = totalWidth + "px";

        // ── Move number header ──
        categorizedMoves.forEach((moveData, i) => {
            if (moveData.move % 5 !== 0 && moveData.move !== 1) return;
            const cx = stonesX + i * STONE_SPACING + STONE_SPACING / 2;
            const lbl = createSVGElement("text", {
                x: cx,
                y: PADDING.top + MOVE_NUM_HEIGHT - 2,
                fill: "rgba(255,255,255,0.45)",
                "font-size": "9px",
                "font-family": "monospace",
                "text-anchor": "middle",
                "dominant-baseline": "auto",
            });
            lbl.textContent = String(moveData.move);
            svg.appendChild(lbl);
        });

        // ── Score bucket rows ──
        SCORE_BUCKETS.forEach((bucket, rowIndex) => {
            const rowY = quantStartY + rowIndex * QUANT_ROW_HEIGHT;

            if (rowIndex % 2 === 0) {
                svg.appendChild(createSVGElement("rect", {
                    x: 0, y: rowY, width: totalWidth, height: QUANT_ROW_HEIGHT,
                    fill: "rgba(255,255,255,0.025)",
                }));
            }

            // Show label every other row to avoid crowding
            if (rowIndex % 2 === 0 || bucket.label === "15+") {
                const lbl = createSVGElement("text", {
                    x: LABEL_WIDTH - 6,
                    y: rowY + QUANT_ROW_HEIGHT / 2 + 1,
                    fill: scoreLossColor(bucket.min),
                    "font-size": "9px",
                    "font-family": "monospace",
                    "font-weight": "600",
                    "text-anchor": "end",
                    "dominant-baseline": "middle",
                    opacity: 0.85,
                });
                lbl.textContent = bucket.label;
                svg.appendChild(lbl);
            }

            // Color sidebar bar
            svg.appendChild(createSVGElement("rect", {
                x: LABEL_WIDTH - 3, y: rowY + 1,
                width: 3, height: QUANT_ROW_HEIGHT - 2,
                rx: 1, fill: scoreLossColor(bucket.min), opacity: 0.5,
            }));
        });

        // ── Stones: category color fill, player-colored border ──
        categorizedMoves.forEach((moveData, i) => {
            if (moveData.scoreLoss == null) return;
            const bucketIndex = SCORE_BUCKETS.findIndex(
                (b) => moveData.scoreLoss >= b.min && moveData.scoreLoss < b.max,
            );
            if (bucketIndex === -1) return;

            const cx = stonesX + i * STONE_SPACING + STONE_SPACING / 2;
            const cy = quantStartY + bucketIndex * QUANT_ROW_HEIGHT + QUANT_ROW_HEIGHT / 2;
            const isBlack = moveData.player === "black";

            // Drop shadow
            svg.appendChild(createSVGElement("circle", {
                cx: cx + 0.5, cy: cy + 0.5, r: QUANT_STONE_R,
                fill: "rgba(0,0,0,0.35)",
            }));

            // Player-colored fill; category-colored border
            svg.appendChild(createSVGElement("circle", {
                cx, cy, r: QUANT_STONE_R,
                fill: isBlack ? "#000000" : "#ffffff",
                stroke: CATEGORY_COLORS[moveData.category],
                "stroke-width": 1.5,
            }));

            // Invisible hit target: tooltip + click-to-navigate
            const hit = createSVGElement("circle", {
                cx, cy, r: QUANT_STONE_R + 2,
                fill: "transparent", cursor: "pointer",
            });
            const titleEl = document.createElementNS("http://www.w3.org/2000/svg", "title");
            titleEl.textContent = `Move ${moveData.move} (${moveData.player}): ${moveData.category} (${moveData.scoreLoss.toFixed(2)} pts)`;
            hit.appendChild(titleEl);
            hit.addEventListener("click", () => navigateToMove(moveData.move));
            svg.appendChild(hit);
        });

        container.appendChild(svg);
        return container;
    }

    function createSVGElement(tag, attrs) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        for (const [k, v] of Object.entries(attrs)) {
            el.setAttribute(k, String(v));
        }
        return el;
    }

    function navigateToMove(moveNumber) {
        // Try to use OGS's internal goban navigation
        // Method 1: Find the goban instance on the page via React fiber
        try {
            const gobanEl = document.querySelector(".Goban");
            if (gobanEl) {
                // Walk React fiber to find goban controller
                const key = Object.keys(gobanEl).find(
                    (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
                );
                if (key) {
                    let fiber = gobanEl[key];
                    for (let i = 0; i < 20 && fiber; i++) {
                        const props = fiber.memoizedProps || fiber.pendingProps;
                        if (props?.goban?.showMove) {
                            props.goban.showMove(moveNumber);
                            return;
                        }
                        if (props?.goban_controller?.gotoMove) {
                            props.goban_controller.gotoMove(moveNumber);
                            return;
                        }
                        fiber = fiber.return;
                    }
                }
            }
        } catch (e) {
            console.log("[AI Quality Chart] Could not navigate via React fiber:", e);
        }

        // Method 2: Simulate keyboard navigation (right/left arrow)
        // This is a fallback - less precise but works
    }

    // ==================== Insertion into Page ====================

    function findInsertionPoint() {
        // Best: insert right before the AIReview panel (OGS must have rendered it first)
        const aiReview = document.querySelector(".AIReview");
        if (aiReview) return { element: aiReview, position: "before" };

        // Good: the right sidebar column that holds the AI review
        const rightCol = document.querySelector(".right-col");
        if (rightCol) return { element: rightCol, position: "prepend" };

        // Good: the center column which also holds AIReview in some layouts
        const centerCol = document.querySelector(".center-col");
        if (centerCol) return { element: centerCol, position: "prepend" };

        // Fallback: action bar
        const actionBar = document.querySelector(".action-bar");
        if (actionBar) return { element: actionBar, position: "before" };

        return null;
    }

    function insertChart(chartEl) {
        // Remove any existing chart
        const existing = document.getElementById("ogs-ai-quality-chart");
        if (existing) existing.remove();

        const insertion = findInsertionPoint();
        if (!insertion) {
            console.warn("[AI Quality Chart] Could not find insertion point");
            return;
        }

        const { element, position } = insertion;
        if (position === "before") {
            element.parentNode.insertBefore(chartEl, element);
        } else if (position === "after") {
            element.parentNode.insertBefore(chartEl, element.nextSibling);
        } else if (position === "prepend") {
            element.insertBefore(chartEl, element.firstChild);
        }
    }

    // ==================== Main ====================

    let lastGameId = null;
    let finishedGameIds = new Set();
    let retryCount = 0;
    const MAX_RETRIES = 40;
    const RETRY_INTERVAL = 2000;

    async function main() {
        const gameId = getGameId();
        if (!gameId) return;

        // Don't re-run for the same game if chart already exists
        if (gameId === lastGameId && document.getElementById("ogs-ai-quality-chart")) {
            return;
        }

        // Check if game is finished (cached so we only call the API once per game)
        if (!finishedGameIds.has(gameId)) {
            const finished = await isGameFinished(gameId);
            if (!finished) {
                console.log(`[AI Quality Chart] Game ${gameId} not finished, skipping`);
                return;
            }
            finishedGameIds.add(gameId);
        }

        lastGameId = gameId;

        // Read the categorization directly from OGS's already-rendered SummaryTable.
        // The AI review data arrives via websocket; OGS has already done the work.
        // We just read the React props from the .ai-summary-table element.
        const categorization = getCategorizationFromReactFiber();
        if (!categorization) {
            console.log(`[AI Quality Chart] .ai-summary-table not ready yet (attempt ${retryCount + 1})`);
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                setTimeout(main, RETRY_INTERVAL);
            } else {
                console.warn("[AI Quality Chart] Gave up after max retries");
            }
            return;
        }

        retryCount = 0;

        const categorizedMoves = buildMovesFromCategorization(categorization);
        console.log(`[AI Quality Chart] Got ${categorizedMoves.length} categorized moves from React fiber`);

        if (categorizedMoves.length === 0) {
            console.log("[AI Quality Chart] No moves to display");
            return;
        }

        const insertion = findInsertionPoint();
        if (!insertion) {
            console.log("[AI Quality Chart] Insertion point not in DOM yet, retrying...");
            if (retryCount < MAX_RETRIES) {
                retryCount++;
                setTimeout(main, RETRY_INTERVAL);
            }
            return;
        }

        const chartEl = createChart(categorizedMoves);
        if (chartEl) {
            insertChart(chartEl);
            console.log("[AI Quality Chart] Chart inserted successfully");
        }
    }

    // Wait for the page to be loaded, then try to insert the chart
    // Use a MutationObserver to detect when the game page content loads
    function waitForGamePage() {
        // Initial attempt after a delay
        setTimeout(main, 3000);

        // Also watch for SPA navigation changes
        let lastUrl = location.href;
        let reinserting = false;

        const observer = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastGameId = null;
                retryCount = 0;
                setTimeout(main, 3000);
                return;
            }

            // Re-insert if our chart got removed (React re-renders), but debounce
            if (lastGameId && !document.getElementById("ogs-ai-quality-chart") && !reinserting) {
                reinserting = true;
                setTimeout(() => {
                    reinserting = false;
                    if (!document.getElementById("ogs-ai-quality-chart")) {
                        main();
                    }
                }, 2000);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", waitForGamePage);
    } else {
        waitForGamePage();
    }
})();

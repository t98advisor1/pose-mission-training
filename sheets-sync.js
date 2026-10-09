/**
 * Codex follow-up sync 32, based on the preserved Gemini 19 / Codex 24 / 31 assembly.
 * One canonical full-body track accepts seven grades; API mission keys stay stable.
 * TOP10 disclosure reuses the same received leaderboard. Earlier snapshots remain unchanged.
 */
(function() {
    let SHEETS_WEB_APP_URL = "https://script.google.com/macros/s/AKfycby23Qk5rnf8slPA-KyMxCNAZjeU_NHkK4UQEVgCI0vNEd1sLHrOyxV_f1Zl2TNqRnnN/exec";

    const VALID_MISSIONS = [
        "큰 V",
        "머리 위 하트",
        "한손 브이",
        "엄지척",
        "꽃받침",
        "슈퍼히어로",
        "가벼운 댑"
    ];
    const BODY_GRADES = [100, 200, 300, 400, 500, 600, 700];
    const BODY_MISSIONS = BODY_GRADES.map(score => `전신 보너스 ${score}`);
    const displayMission = mission => mission === "꽃받침" ? "양손 꽃피우기" : mission;
    const BODY_KEY = "__full_body_bonus__";
    const isBodyMission = mission => BODY_MISSIONS.includes(mission);
    const isValidMission = mission => VALID_MISSIONS.includes(mission) || isBodyMission(mission);
    const canonicalMissionKey = mission => isBodyMission(mission) ? BODY_KEY : mission;
    const sameMissionTrack = (first, second) => canonicalMissionKey(first) === canonicalMissionKey(second);
    const bodyGrade = mission => isBodyMission(mission) ? Number(mission.slice("전신 보너스 ".length)) : 0;
    const bodyMissionForScore = score => score > 0 ? `전신 보너스 ${score}` : null;
    const emptyScores = () => ({ baseScore: 0, bonusScore: 0, eventBonusScore: 0, bodyBonusScore: 0, totalScore: 0 });

    // Legacy receipts have only base/bonus/total. They represent event bonus only.
    function normalizeScores(value) {
        if (!value || typeof value !== "object") return null;
        const hasBody = Object.prototype.hasOwnProperty.call(value, "bodyBonusScore");
        const hasEvent = Object.prototype.hasOwnProperty.call(value, "eventBonusScore");
        const baseScore = value.baseScore;
        const bonusScore = value.bonusScore;
        const bodyBonusScore = hasBody ? value.bodyBonusScore : 0;
        const eventBonusScore = hasEvent ? value.eventBonusScore : bonusScore;
        const totalScore = value.totalScore;
        const numbers = [baseScore, bonusScore, eventBonusScore, bodyBonusScore, totalScore];
        if (!numbers.every(number => typeof number === "number" && Number.isFinite(number) && Number.isInteger(number))) return null;
        if (baseScore < 0 || baseScore > 700 || baseScore % 100 !== 0) return null;
        if (eventBonusScore < 0 || eventBonusScore > 210 || eventBonusScore % 10 !== 0 || eventBonusScore > baseScore / 100 * 30) return null;
        if (bodyBonusScore !== 0 && !BODY_GRADES.includes(bodyBonusScore)) return null;
        if (bodyBonusScore > 0 && (!hasEvent || baseScore !== 700)) return null;
        if (bonusScore < 0 || bonusScore > 910 || bonusScore !== eventBonusScore + bodyBonusScore) return null;
        if (totalScore < 0 || totalScore > 1610 || totalScore !== baseScore + bonusScore) return null;
        return { baseScore, bonusScore, eventBonusScore, bodyBonusScore, totalScore };
    }

    function addCompletedMission(mission) {
        if (!isValidMission(mission)) return;
        if (isBodyMission(mission)) {
            BODY_MISSIONS.forEach(name => currentCompletedMissions.delete(name));
        }
        currentCompletedMissions.add(mission);
    }

    function hasCompletedTrack(mission) {
        return Array.from(currentCompletedMissions).some(name => sameMissionTrack(name, mission));
    }

    function validateReceipt(receipt, challengeId, mission) {
        if (!receipt || receipt.status !== "success" || receipt.challengeId !== challengeId || receipt.saved !== true || !Array.isArray(receipt.completedMissions)) return null;
        const scores = normalizeScores(receipt);
        if (!scores) return null;
        const completedBody = receipt.completedMissions.filter(isBodyMission);
        if (scores.bodyBonusScore > 0) {
            const actualMission = bodyMissionForScore(scores.bodyBonusScore);
            if (completedBody.length !== 1 || completedBody[0] !== actualMission || !VALID_MISSIONS.every(name => receipt.completedMissions.includes(name))) return null;
        } else if (completedBody.length) {
            return null;
        }
        if (isBodyMission(mission)) {
            if (!isBodyMission(receipt.mission) || scores.bodyBonusScore <= 0) return null;
            // Query grade may differ from the first-written server grade.
            return scores;
        }
        if (receipt.mission !== mission || !receipt.completedMissions.includes(mission)) return null;
        return scores;
    }

    const STORAGE_KEY = "POSE_GAME_SYNC_STATE_V2";
    const LEADERBOARD_DELAY_MS = 5000;
    const JSONP_TIMEOUT_MS = 8000;
    const QUEUE_RETRY_INTERVAL_MS = 4000;

    // 현재 세션 상태
    let currentChallengeId = null;
    let currentNickname = null;
    let syncQueue = []; // [{ challengeId, nickname, mission }]
    let currentCompletedMissions = new Set();
    let currentConfirmedScores = emptyScores();
    let currentScreen = "start"; // "start" | "game" | "result"
    let isProcessingQueue = false;

    // 랭킹 폴링 상태
    let leaderboardTimer = null;
    let leaderboardGeneration = 0;
    let activeLeaderboardCleanup = null;
    let isFetchingLeaderboard = false;
    let lastSuccessfulRankTime = null;
    let cachedLeaderboardData = null;
    let topTenOpen = false;

    // UUID v4 생성
    function generateUUID() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // 서버와 동일한 FNV-1a 32bit 보너스 해시 계산기
    function calculatePredictedBonus(challengeId, mission) {
        if (!challengeId || !mission) return 0;
        const key = challengeId.trim().toLowerCase() + "|" + mission;
        let h = 2166136261;
        for (let i = 0; i < key.length; i++) {
            const code = key.charCodeAt(i);
            h = Math.imul(h ^ code, 16777619) >>> 0;
        }
        return (h % 4 === 0) ? (10 * ((h >>> 2) % 3 + 1)) : 0;
    }

    // localStorage 저장
    function saveStorageState() {
        try {
            const data = {
                challengeId: currentChallengeId,
                nickname: currentNickname,
                queue: syncQueue,
                completedMissions: Array.from(currentCompletedMissions),
                confirmedScores: currentConfirmedScores
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn("localStorage 저장 실패:", e);
        }
    }

    // Restore V2 without deleting distinct old challenges; dedupe body grades as one track.
    function loadStorageState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                currentChallengeId = typeof parsed.challengeId === "string" ? parsed.challengeId : null;
                currentNickname = typeof parsed.nickname === "string" ? parsed.nickname : null;
                if (Array.isArray(parsed.queue)) {
                    const restoredKeys = new Set();
                    syncQueue = parsed.queue.filter(item => {
                        if (!item || typeof item.challengeId !== "string" || typeof item.nickname !== "string" || !isValidMission(item.mission)) return false;
                        const key = `${item.challengeId}|${canonicalMissionKey(item.mission)}`;
                        if (restoredKeys.has(key)) return false;
                        restoredKeys.add(key);
                        return true;
                    }).map(item => ({ challengeId: item.challengeId, nickname: item.nickname, mission: item.mission }));
                }
                currentCompletedMissions = new Set();
                if (Array.isArray(parsed.completedMissions)) {
                    parsed.completedMissions.forEach(mission => {
                        if (isValidMission(mission) && !hasCompletedTrack(mission)) addCompletedMission(mission);
                    });
                }
                if (currentChallengeId && Array.isArray(syncQueue)) {
                    syncQueue.forEach(item => {
                        if (item.challengeId === currentChallengeId && !hasCompletedTrack(item.mission)) {
                            addCompletedMission(item.mission);
                        }
                    });
                }
                currentConfirmedScores = normalizeScores(parsed.confirmedScores) || emptyScores();
                if (currentConfirmedScores.bodyBonusScore > 0) addCompletedMission(bodyMissionForScore(currentConfirmedScores.bodyBonusScore));
            }
        } catch (e) {
            console.warn("localStorage 복구 실패:", e);
        }
    }

    // 랭킹 대시보드 위젯 생성
    function injectUI() {
        if (document.getElementById("sync-dashboard-container")) return;

        const container = document.createElement("div");
        container.id = "sync-dashboard-container";
        container.style.cssText = `
            width: 100%;
            background: #ffffff;
            border-radius: 1rem;
            padding: 10px 12px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            border: 1px solid #ffedd5;
            font-size: 0.85rem;
            box-sizing: border-box;
        `;

        const syncStatusDiv = document.createElement("div");
        syncStatusDiv.id = "sync-status-text";
        syncStatusDiv.style.cssText = "color: #ea580c; font-weight: bold; margin-bottom: 6px; text-align: center;";
        syncStatusDiv.textContent = "점수 서버 연결 대기 중";
        container.appendChild(syncStatusDiv);

        const rankingHeader = document.createElement("div");
        rankingHeader.style.cssText = "display: flex; justify-content: space-between; color: #7c2d12; font-weight: bold; border-bottom: 1px solid #fed7aa; padding-bottom: 4px; margin-bottom: 4px;";

        const rankTitle = document.createElement("span");
        rankTitle.textContent = "🏆 실시간 명예의 전당 (Top 5)";
        const rankUpdated = document.createElement("span");
        rankUpdated.id = "rank-updated-text";
        rankUpdated.style.cssText = "font-size: 0.75rem; color: #9a3412; font-weight: normal;";
        rankUpdated.textContent = "-";

        rankingHeader.appendChild(rankTitle);
        rankingHeader.appendChild(rankUpdated);
        container.appendChild(rankingHeader);

        const listContainer = document.createElement("div");
        listContainer.id = "ranking-list-box";
        listContainer.style.cssText = "display: flex; flex-direction: column; gap: 3px; max-height: 120px; overflow-y: auto;";
        container.appendChild(listContainer);

        const topTenButton = document.createElement("button");
        topTenButton.id = "ranking-top10-button";
        topTenButton.type = "button";
        topTenButton.textContent = "TOP10 보기";
        topTenButton.setAttribute("aria-expanded", "false");
        topTenButton.setAttribute("aria-controls", "ranking-top10-panel");
        topTenButton.style.cssText = "width: 100%; min-height: 44px; margin-top: 8px; border: 1px solid #c2410c; border-radius: 10px; background: #fff7ed; color: #7c2d12; font: inherit; font-weight: bold; cursor: pointer;";
        topTenButton.addEventListener("click", () => {
            if (topTenOpen) closeTopTen();
            else openTopTen();
        });
        container.appendChild(topTenButton);

        const topTenPanel = document.createElement("section");
        topTenPanel.id = "ranking-top10-panel";
        topTenPanel.hidden = true;
        topTenPanel.setAttribute("role", "region");
        topTenPanel.setAttribute("aria-labelledby", "ranking-top10-title");
        topTenPanel.style.cssText = "margin-top: 10px; padding: 12px; border: 1px solid #fed7aa; border-radius: 12px; background: #fffbeb; color: #374151; font-size: 1rem;";
        const topTenHeader = document.createElement("div");
        topTenHeader.style.cssText = "display: flex; align-items: center; justify-content: space-between; gap: 8px;";
        const topTenTitle = document.createElement("h3");
        topTenTitle.id = "ranking-top10-title";
        topTenTitle.textContent = "🏆 명예의 전당 TOP10";
        topTenTitle.style.cssText = "margin: 0; font-size: 1rem; color: #7c2d12;";
        const topTenClose = document.createElement("button");
        topTenClose.id = "ranking-top10-close";
        topTenClose.type = "button";
        topTenClose.textContent = "닫기";
        topTenClose.setAttribute("aria-label", "TOP10 닫기");
        topTenClose.style.cssText = "min-height: 44px; min-width: 52px; padding: 6px 10px; border: 1px solid #9a3412; border-radius: 8px; background: #ffffff; color: #7c2d12; font: inherit; cursor: pointer;";
        topTenClose.addEventListener("click", () => closeTopTen());
        topTenHeader.appendChild(topTenTitle);
        topTenHeader.appendChild(topTenClose);
        topTenPanel.appendChild(topTenHeader);
        const topTenSummary = document.createElement("p");
        topTenSummary.id = "ranking-top10-summary";
        topTenSummary.setAttribute("role", "status");
        topTenSummary.setAttribute("aria-live", "polite");
        topTenSummary.style.cssText = "margin: 8px 0; font-size: 0.85rem; line-height: 1.5; color: #7c2d12;";
        topTenPanel.appendChild(topTenSummary);
        const topTenList = document.createElement("div");
        topTenList.id = "ranking-top10-list";
        topTenList.style.cssText = "display: flex; flex-direction: column; gap: 6px; max-height: min(55vh, 400px); overflow-y: auto;";
        topTenPanel.appendChild(topTenList);
        container.appendChild(topTenPanel);

        const mountHome = document.getElementById("leaderboard-home");
        if (mountHome) {
            mountHome.appendChild(container);
        } else {
            document.body.appendChild(container);
        }
        renderTopTenUI();
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && topTenOpen && topTenPanel.contains(document.activeElement)) {
                event.preventDefault();
                closeTopTen();
            }
        });
    }

    function openTopTen() {
        if (currentScreen === "game") return;
        const panel = document.getElementById("ranking-top10-panel");
        const button = document.getElementById("ranking-top10-button");
        if (!panel || !button) return;
        topTenOpen = true;
        panel.hidden = false;
        button.setAttribute("aria-expanded", "true");
        renderTopTenUI();
        document.getElementById("ranking-top10-close").focus();
    }

    function closeTopTen(restoreFocus = true) {
        const wasOpen = topTenOpen;
        topTenOpen = false;
        const panel = document.getElementById("ranking-top10-panel");
        const button = document.getElementById("ranking-top10-button");
        if (panel) panel.hidden = true;
        if (button) button.setAttribute("aria-expanded", "false");
        if (wasOpen && restoreFocus && button && currentScreen !== "game" && !document.hidden) button.focus();
        else if (wasOpen && panel && panel.contains(document.activeElement)) document.activeElement.blur();
    }

    function renderTopTenUI() {
        const list = document.getElementById("ranking-top10-list");
        const summary = document.getElementById("ranking-top10-summary");
        if (!list || !summary) return;
        const rows = leaderboardRows(cachedLeaderboardData);
        if (cachedLeaderboardData === null) {
            summary.textContent = "랭킹을 불러오는 중입니다.";
            list.textContent = "";
            return;
        }
        summary.textContent = rows.length < 10
            ? `현재 ${rows.length}명의 기록이 있습니다. 등록된 참가자만 표시합니다.`
            : "상위 10명의 기록을 표시합니다.";
        renderLeaderboardRows(list, rows, 10, true);
    }

    // 화면 전환에 따른 랭킹 위젯 이동
    function mountLeaderboard(screenName) {
        const dashboard = document.getElementById("sync-dashboard-container");
        if (!dashboard) return;
        dashboard.hidden = screenName === "game";
        if (screenName === "game") closeTopTen(false);

        const mountHome = document.getElementById("leaderboard-home");
        const mountResult = document.getElementById("leaderboard-result");

        if (screenName === "start" || screenName === "game") {
            if (mountHome && !mountHome.contains(dashboard)) {
                mountHome.appendChild(dashboard);
            }
        } else if (screenName === "result") {
            if (mountResult && !mountResult.contains(dashboard)) {
                mountResult.appendChild(dashboard);
            }
        }
    }

    // 상태 안내 메시지 동기화
    function updateSyncStatusUI(detailMsg = null, isSuccess = false) {
        const syncStatusText = document.getElementById("sync-status-text");
        const gameSyncStatus = document.getElementById("game-sync-status");
        const gameSaveStatus = document.getElementById("game-save-status");
        const resultSyncStatus = document.getElementById("result-sync-status");

        let statusText = detailMsg || "";

        if (!statusText) {
            if (!SHEETS_WEB_APP_URL) {
                statusText = "웹앱 URL 설정 대기 중 (전송 보류)";
            } else {
                const currentPending = syncQueue.filter(item => item.challengeId === currentChallengeId).length;
                const pastPending = syncQueue.length - currentPending;

                if (currentPending === 0 && pastPending === 0) {
                    if (currentConfirmedScores.baseScore === 0) {
                        statusText = "아직 도전 기록이 없습니다.";
                    } else {
                        statusText = "모든 점수가 서버에 안전하게 기록되었습니다!";
                    }
                } else {
                    statusText = `저장 대기: 현재 도전 ${currentPending}건`;
                    if (pastPending > 0) {
                        statusText += ` (이전 기록 ${pastPending}건 보류 중)`;
                    }
                }
            }
        }

        const color = isSuccess ? "#16a34a" : (!SHEETS_WEB_APP_URL ? "#9ca3af" : "#ea580c");

        if (syncStatusText) {
            syncStatusText.textContent = statusText;
            syncStatusText.style.color = color;
        }
        if (gameSyncStatus) {
            gameSyncStatus.textContent = statusText;
            gameSyncStatus.style.color = color;
        }
        if (gameSaveStatus) {
            gameSaveStatus.textContent = statusText;
            gameSaveStatus.style.color = color;
        }
        if (resultSyncStatus) {
            resultSyncStatus.textContent = statusText;
            resultSyncStatus.style.color = color;
        }
    }

    // 랭킹 UI 렌더링
    function renderLeaderboardUI(leaderboard, updatedAt) {
        const listBox = document.getElementById("ranking-list-box");
        const updatedElem = document.getElementById("rank-updated-text");
        if (!listBox) return;

        if (updatedElem && updatedAt) {
            updatedElem.textContent = new Date(updatedAt).toLocaleString("ko-KR", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            });
        }

        renderLeaderboardRows(listBox, leaderboardRows(leaderboard), 5);
        renderTopTenUI();
    }

    function leaderboardRows(leaderboard) {
        return Array.isArray(leaderboard)
            ? leaderboard.filter(item => item && typeof item === "object").slice(0, 10)
            : [];
    }

    function renderLeaderboardRows(listBox, leaderboard, limit, expanded = false) {
        listBox.textContent = "";
        if (leaderboard.length === 0) {
            const emptyItem = document.createElement("div");
            emptyItem.style.cssText = "color: #9ca3af; text-align: center; padding: 4px 0;";
            emptyItem.textContent = "아직 등록된 랭킹 기록이 없습니다.";
            listBox.appendChild(emptyItem);
            return;
        }

        leaderboard.slice(0, limit).forEach((item, index) => {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; border-radius: 4px; background: #fff7ed;";
            if (expanded) row.style.cssText += " padding: 8px 6px; gap: 8px;";

            const leftBox = document.createElement("div");
            leftBox.style.cssText = "display: flex; gap: 8px; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const rankBadge = document.createElement("span");
            rankBadge.style.cssText = "font-weight: bold; min-width: 2.5em; color: #ea580c;";
            rankBadge.textContent = `${Number.isInteger(item.rank) && item.rank > 0 ? item.rank : index + 1}위`;

            const nameElem = document.createElement("span");
            nameElem.style.cssText = "color: #374151; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
            nameElem.textContent = String(item.nickname || "익명");

            leftBox.appendChild(rankBadge);
            leftBox.appendChild(nameElem);

            const scoreBadge = document.createElement("span");
            scoreBadge.style.cssText = "font-weight: bold; color: #c2410c; white-space: nowrap;";
            scoreBadge.textContent = `${Number.isFinite(item.score) ? item.score : 0}점`;

            row.appendChild(leftBox);
            row.appendChild(scoreBadge);
            listBox.appendChild(row);
        });
    }

    // 안전한 JSONP 요청
    function executeJSONP(urlParams, onCleanupRegister = null) {
        return new Promise((resolve, reject) => {
            if (!SHEETS_WEB_APP_URL) {
                return reject(new Error("URL_NOT_CONFIGURED"));
            }

            const callbackName = "cb_pose_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now();
            const script = document.createElement("script");
            let timeoutId = null;
            let isSettled = false;

            const cleanupAborted = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
                window[callbackName] = () => {};
                setTimeout(() => {
                    delete window[callbackName];
                }, 60000);
            };

            const cleanupSuccess = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                if (script.parentNode) {
                    script.parentNode.removeChild(script);
                }
                delete window[callbackName];
            };

            if (typeof onCleanupRegister === "function") {
                onCleanupRegister(() => {
                    if (isSettled) return;
                    isSettled = true;
                    cleanupAborted();
                    reject(new DOMException("JSONP request canceled", "AbortError"));
                });
            }

            timeoutId = setTimeout(() => {
                if (isSettled) return;
                isSettled = true;
                cleanupAborted();
                reject(new Error("JSONP_TIMEOUT"));
            }, JSONP_TIMEOUT_MS);

            window[callbackName] = (data) => {
                if (isSettled) return;
                isSettled = true;
                cleanupSuccess();
                resolve(data);
            };

            script.onerror = () => {
                if (isSettled) return;
                isSettled = true;
                cleanupAborted();
                reject(new Error("JSONP_LOAD_ERROR"));
            };

            const delim = SHEETS_WEB_APP_URL.includes("?") ? "&" : "?";
            script.src = `${SHEETS_WEB_APP_URL}${delim}${urlParams}&callback=${callbackName}`;
            document.head.appendChild(script);
        });
    }

    // 랭킹 폴링 단계
    async function fetchLeaderboardStep() {
        if (!SHEETS_WEB_APP_URL || document.hidden || currentScreen === "game" || isFetchingLeaderboard) {
            return;
        }

        const thisGen = leaderboardGeneration;
        isFetchingLeaderboard = true;

        try {
            const data = await executeJSONP("action=leaderboard", (cleanupFn) => {
                if (thisGen === leaderboardGeneration) {
                    activeLeaderboardCleanup = cleanupFn;
                }
            });

            if (thisGen !== leaderboardGeneration) {
                return;
            }

            activeLeaderboardCleanup = null;

            if (document.hidden || currentScreen === "game") {
                return;
            }

            if (data && data.status === "success" && Array.isArray(data.leaderboard)) {
                cachedLeaderboardData = data.leaderboard;
                lastSuccessfulRankTime = data.updatedAt || new Date().toISOString();
                renderLeaderboardUI(cachedLeaderboardData, lastSuccessfulRankTime);
            }
        } catch (err) {
            if (thisGen !== leaderboardGeneration) {
                return;
            }

            activeLeaderboardCleanup = null;

            if (document.hidden || currentScreen === "game") {
                return;
            }

            if (cachedLeaderboardData) {
                renderLeaderboardUI(cachedLeaderboardData, lastSuccessfulRankTime);
            }
        } finally {
            if (thisGen === leaderboardGeneration) {
                isFetchingLeaderboard = false;
                activeLeaderboardCleanup = null;
                if (!document.hidden && currentScreen !== "game" && SHEETS_WEB_APP_URL) {
                    leaderboardTimer = setTimeout(fetchLeaderboardStep, LEADERBOARD_DELAY_MS);
                }
            }
        }
    }

    function stopLeaderboard() {
        leaderboardGeneration++;
        if (leaderboardTimer) {
            clearTimeout(leaderboardTimer);
            leaderboardTimer = null;
        }
        if (activeLeaderboardCleanup) {
            activeLeaderboardCleanup();
            activeLeaderboardCleanup = null;
        }
        isFetchingLeaderboard = false;
    }

    function resumeLeaderboard() {
        stopLeaderboard();
        if (!document.hidden && currentScreen !== "game" && SHEETS_WEB_APP_URL) {
            fetchLeaderboardStep();
        }
    }

    // 탭 가시성 감지
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopLeaderboard();
        } else {
            if (currentScreen !== "game") {
                resumeLeaderboard();
            }
            processQueue();
        }
    });

    // POST 및 JSONP 이중 영수증 정밀 검증 큐 처리
    async function processQueue() {
        if (isProcessingQueue || syncQueue.length === 0 || !SHEETS_WEB_APP_URL) {
            updateSyncStatusUI();
            return;
        }
        isProcessingQueue = true;

        const targetItem = syncQueue[0];
        const targetChallengeId = targetItem.challengeId;
        const targetMission = targetItem.mission;
        const targetNickname = targetItem.nickname;

        updateSyncStatusUI(`'${displayMission(targetMission)}' 저장 확인 중...`);

        try {
            // 순수 3필드 JSON 발송
            const postBody = JSON.stringify({
                challengeId: targetChallengeId,
                nickname: targetNickname,
                mission: targetMission
            });

            await fetch(SHEETS_WEB_APP_URL, {
                method: "POST",
                mode: "no-cors",
                headers: { "Content-Type": "text/plain" },
                body: postBody
            });

            // JSONP action=check 검증
            const query = `action=check&challengeId=${encodeURIComponent(targetChallengeId)}&mission=${encodeURIComponent(targetMission)}`;
            const checkRes = await executeJSONP(query);

            const confirmedScores = validateReceipt(checkRes, targetChallengeId, targetMission);

            if (confirmedScores) {
                // Remove only the captured challenge/track. All seven body grades are one track.
                syncQueue = syncQueue.filter(item => !(item.challengeId === targetChallengeId && sameMissionTrack(item.mission, targetMission)));

                // 현재 도전의 영수증인 경우에만 점수 갱신 및 커스텀 이벤트 발송
                if (targetChallengeId === currentChallengeId) {
                    if (confirmedScores.baseScore >= currentConfirmedScores.baseScore &&
                        confirmedScores.eventBonusScore >= currentConfirmedScores.eventBonusScore &&
                        confirmedScores.bodyBonusScore >= currentConfirmedScores.bodyBonusScore) {
                        currentConfirmedScores = confirmedScores;
                    }
                    checkRes.completedMissions.filter(mission => VALID_MISSIONS.includes(mission)).forEach(addCompletedMission);
                    if (currentConfirmedScores.bodyBonusScore > 0) addCompletedMission(bodyMissionForScore(currentConfirmedScores.bodyBonusScore));
                    saveStorageState();

                    window.dispatchEvent(new CustomEvent("pose-sheet-saved", {
                        detail: {
                            challengeId: currentChallengeId,
                            baseScore: currentConfirmedScores.baseScore,
                            bonusScore: currentConfirmedScores.bonusScore,
                            eventBonusScore: currentConfirmedScores.eventBonusScore,
                            bodyBonusScore: currentConfirmedScores.bodyBonusScore,
                            totalScore: currentConfirmedScores.totalScore
                        }
                    }));
                } else {
                    saveStorageState();
                }

                const savedLabel = isBodyMission(targetMission) ? `전신 보너스 ${confirmedScores.bodyBonusScore}점` : `${displayMission(targetMission)} (+100점)`;
                updateSyncStatusUI(`'${savedLabel}' 시트 저장 완료!`, true);

                if (currentScreen !== "game") {
                    stopLeaderboard();
                    resumeLeaderboard();
                }

                isProcessingQueue = false;
                if (syncQueue.length > 0) {
                    processQueue();
                } else {
                    updateSyncStatusUI();
                }
            } else {
                throw new Error("SERVER_RECEIPT_NOT_CONFIRMED_OR_INVALID_SCORES");
            }
        } catch (err) {
            const currentPending = syncQueue.filter(item => item.challengeId === currentChallengeId).length;
            const pastPending = syncQueue.length - currentPending;
            let errMsg = `'${displayMission(targetMission)}' 동기화 보류 (대기 중)`;
            if (pastPending > 0) {
                errMsg += ` [이전 ${pastPending}건]`;
            }
            updateSyncStatusUI(errMsg);

            // 저장 실패 시에도 현재 도전 완료 집합(currentCompletedMissions)은 그대로 보존됨
            saveStorageState();

            isProcessingQueue = false;
            if (SHEETS_WEB_APP_URL && !document.hidden) {
                setTimeout(processQueue, QUEUE_RETRY_INTERVAL_MS);
            }
        }
    }

    // window.PoseSheet 전역 API 노출
    window.PoseSheet = {
        begin: function(rawNickname) {
            const nickname = String(rawNickname || "").trim();

            if (!nickname) {
                throw new Error("닉네임을 입력해 주세요.");
            }
            if (nickname.length > 12) {
                throw new Error("닉네임은 최대 12자까지 가능합니다.");
            }
            const formulaChars = ["=", "+", "-", "@", "\t", "\r"];
            if (formulaChars.includes(nickname.charAt(0))) {
                throw new Error("닉네임 첫 글자로 수식 기호(=, +, -, @)를 사용할 수 없습니다.");
            }

            // 새 세션 생성 (미저장 syncQueue는 절대 삭제하지 않고 유지)
            currentChallengeId = generateUUID();
            currentNickname = nickname;
            currentCompletedMissions = new Set();
            currentConfirmedScores = emptyScores();
            saveStorageState();

            injectUI();
            updateSyncStatusUI("새 게임이 시작되었습니다. 포즈에 도전하세요!");

            if (currentScreen !== "game") {
                resumeLeaderboard();
            }

            if (syncQueue.length > 0 && SHEETS_WEB_APP_URL) {
                processQueue();
            }

            return {
                challengeId: currentChallengeId,
                nickname: currentNickname
            };
        },

        complete: function(missionName) {
            if (!currentChallengeId || !currentNickname) {
                console.error("PoseSheet.begin이 먼저 호출되어야 합니다.");
                return { bonus: 0 };
            }

            const mission = String(missionName || "").trim();
            if (!isValidMission(mission)) {
                console.error("유효하지 않은 미션 이름입니다:", mission);
                return { bonus: 0 };
            }

            // 현재 도전에서 이미 완료 처리된 미션인 경우 보너스 0 반환 및 재전송 차단 (큐 제거 이후라도 유지)
            if (hasCompletedTrack(mission)) {
                return { bonus: 0 };
            }
            if (isBodyMission(mission) && currentConfirmedScores.baseScore !== 700 && !VALID_MISSIONS.every(name => currentCompletedMissions.has(name))) {
                console.error("전신 보너스는 기본 7개 미션을 모두 마친 뒤에만 보낼 수 있습니다.");
                return { bonus: 0 };
            }
            addCompletedMission(mission);

            const bonusVal = isBodyMission(mission) ? bodyGrade(mission) : calculatePredictedBonus(currentChallengeId, mission);

            // 중복 큐 진입 방지 후 3필드 추가
            const alreadyInQueue = syncQueue.some(
                item => item.challengeId === currentChallengeId && sameMissionTrack(item.mission, mission)
            );
            if (!alreadyInQueue) {
                syncQueue.push({
                    challengeId: currentChallengeId,
                    nickname: currentNickname,
                    mission: mission
                });
            }

            saveStorageState();
            updateSyncStatusUI();

            if (SHEETS_WEB_APP_URL) {
                processQueue();
            }

            return { bonus: bonusVal };
        },

        setScreen: function(screenName) {
            if (!["start", "game", "result"].includes(screenName)) return;
            currentScreen = screenName;

            mountLeaderboard(currentScreen);

            if (currentScreen === "game") {
                stopLeaderboard();
            } else {
                resumeLeaderboard();
            }
        },

        getState: function() {
            const pendingCount = syncQueue.filter(item => item.challengeId === currentChallengeId).length;
            return {
                challengeId: currentChallengeId,
                pending: pendingCount,
                baseScore: currentConfirmedScores.baseScore,
                bonusScore: currentConfirmedScores.bonusScore,
                eventBonusScore: currentConfirmedScores.eventBonusScore,
                bodyBonusScore: currentConfirmedScores.bodyBonusScore,
                totalScore: currentConfirmedScores.totalScore
            };
        },

        setWebAppUrl: function(url) {
            SHEETS_WEB_APP_URL = String(url || "").trim();
            updateSyncStatusUI();
            if (SHEETS_WEB_APP_URL) {
                if (currentScreen !== "game") {
                    resumeLeaderboard();
                }
                if (syncQueue.length > 0) {
                    processQueue();
                }
            } else {
                stopLeaderboard();
            }
        }
    };

    // 초기화
    document.addEventListener("DOMContentLoaded", () => {
        loadStorageState();
        injectUI();
        mountLeaderboard("start");
        updateSyncStatusUI();

        if (SHEETS_WEB_APP_URL) {
            if (syncQueue.length > 0) {
                processQueue();
            }
            if (currentScreen !== "game") {
                resumeLeaderboard();
            }
        }
    });
})();

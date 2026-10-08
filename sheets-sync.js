/**
 * sheets-sync.js - 선생님 포즈 게임 구글 시트 연동 및 랭킹 모듈
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

    const STORAGE_KEY = "POSE_GAME_SYNC_STATE_V2";
    const LEADERBOARD_DELAY_MS = 5000;
    const JSONP_TIMEOUT_MS = 8000;
    const QUEUE_RETRY_INTERVAL_MS = 4000;

    let currentChallengeId = null;
    let currentNickname = null;
    let syncQueue = []; // [{ challengeId, nickname, mission }]
    let isProcessingQueue = false;

    let leaderboardTimer = null;
    let leaderboardGeneration = 0;
    let activeLeaderboardCleanup = null;
    let isFetchingLeaderboard = false;
    let lastSuccessfulRankTime = null;
    let cachedLeaderboardData = null;

    function generateUUID() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function saveStorageState() {
        try {
            const data = {
                challengeId: currentChallengeId,
                nickname: currentNickname,
                queue: syncQueue
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn("localStorage 저장 실패:", e);
        }
    }

    function loadStorageState() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
                currentChallengeId = parsed.challengeId || null;
                currentNickname = parsed.nickname || null;
                if (Array.isArray(parsed.queue)) {
                    syncQueue = parsed.queue;
                }
            }
        } catch (e) {
            console.warn("localStorage 복구 실패:", e);
        }
    }

    function injectUI() {
        const statusBanner = document.getElementById("status-banner");
        if (!statusBanner || document.getElementById("sync-dashboard-container")) return;

        const container = document.createElement("div");
        container.id = "sync-dashboard-container";
        container.style.cssText = `
            width: 100%;
            max-width: 380px;
            background: #ffffff;
            border-radius: 1rem;
            padding: 10px 12px;
            margin-top: 8px;
            margin-bottom: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            border: 1px solid #ffedd5;
            font-size: 0.85rem;
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

        statusBanner.parentNode.insertBefore(container, statusBanner.nextSibling);
    }

    function updateSyncStatusUI(detailMsg = null, isSuccess = false) {
        const elem = document.getElementById("sync-status-text");
        if (!elem) return;

        if (!SHEETS_WEB_APP_URL) {
            elem.textContent = "웹앱 URL 설정 대기 중 (전송 보류)";
            elem.style.color = "#9ca3af";
            return;
        }

        const currentPending = syncQueue.filter(item => item.challengeId === currentChallengeId).length;
        const pastPending = syncQueue.length - currentPending;

        let statusText = detailMsg || "";
        if (!statusText) {
            if (currentPending === 0 && pastPending === 0) {
                statusText = "모든 점수가 서버에 안전하게 기록되었습니다.";
            } else {
                statusText = `저장 대기: 현재 도전 ${currentPending}건`;
                if (pastPending > 0) {
                    statusText += ` (이전 기록 ${pastPending}건 보류 중)`;
                }
            }
        }

        elem.textContent = statusText;
        elem.style.color = isSuccess ? "#16a34a" : "#ea580c";
    }

    function renderLeaderboardUI(leaderboard, updatedAt) {
        const listBox = document.getElementById("ranking-list-box");
        const updatedElem = document.getElementById("rank-updated-text");
        if (!listBox) return;

        if (updatedElem && updatedAt) {
            updatedElem.textContent = new Date(updatedAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        }

        listBox.textContent = "";

        if (!leaderboard || leaderboard.length === 0) {
            const emptyItem = document.createElement("div");
            emptyItem.style.cssText = "color: #9ca3af; text-align: center; padding: 4px 0;";
            emptyItem.textContent = "아직 등록된 랭킹 기록이 없습니다.";
            listBox.appendChild(emptyItem);
            return;
        }

        leaderboard.slice(0, 5).forEach((item) => {
            const row = document.createElement("div");
            row.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 2px 4px; border-radius: 4px; background: #fff7ed;";

            const leftBox = document.createElement("div");
            leftBox.style.cssText = "display: flex; gap: 8px; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";

            const rankBadge = document.createElement("span");
            rankBadge.style.cssText = "font-weight: bold; width: 22px; color: #ea580c;";
            rankBadge.textContent = `${item.rank}위`;

            const nameElem = document.createElement("span");
            nameElem.style.cssText = "color: #374151; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
            nameElem.textContent = item.nickname || "익명";

            leftBox.appendChild(rankBadge);
            leftBox.appendChild(nameElem);

            const scoreBadge = document.createElement("span");
            scoreBadge.style.cssText = "font-weight: bold; color: #c2410c;";
            scoreBadge.textContent = `${item.score || 0}점`;

            row.appendChild(leftBox);
            row.appendChild(scoreBadge);
            listBox.appendChild(row);
        });
    }

    function executeJSONP(urlParams, onCleanupRegister = null) {
        return new Promise((resolve, reject) => {
            if (!SHEETS_WEB_APP_URL) {
                return reject(new Error("URL_NOT_CONFIGURED"));
            }
    
            const callbackName = "cb_pose_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now();
            const script = document.createElement("script");
            let timeoutId = null;
            let isSettled = false;
    
            // 타임아웃 또는 외부 취소 시: 콜백을 no-op으로 치환하여 늦은 호출 시 ReferenceError 방지 (60초 후 삭제)
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
    
            // 정상 완료 시: 리소스 즉시 해제
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

    async function fetchLeaderboardStep() {
        if (!SHEETS_WEB_APP_URL || document.hidden || isFetchingLeaderboard) return;
    
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
    
            if (document.hidden) {
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
    
            if (document.hidden) {
                return;
            }
    
            if (cachedLeaderboardData) {
                renderLeaderboardUI(cachedLeaderboardData, lastSuccessfulRankTime);
            }
        } finally {
            if (thisGen === leaderboardGeneration) {
                isFetchingLeaderboard = false;
                activeLeaderboardCleanup = null;
                if (!document.hidden && SHEETS_WEB_APP_URL) {
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
        if (!document.hidden && SHEETS_WEB_APP_URL) {
            fetchLeaderboardStep();
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            stopLeaderboard();
        } else {
            resumeLeaderboard();
            processQueue();
        }
    });

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

        updateSyncStatusUI(`'${targetMission}' 저장 확인 중...`);

        try {
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

            const query = `action=check&challengeId=${encodeURIComponent(targetChallengeId)}&mission=${encodeURIComponent(targetMission)}`;
            const checkRes = await executeJSONP(query);

            const isSaved = checkRes &&
                checkRes.status === "success" &&
                checkRes.challengeId === targetChallengeId &&
                checkRes.mission === targetMission &&
                checkRes.saved === true &&
                Array.isArray(checkRes.completedMissions) &&
                checkRes.completedMissions.includes(targetMission);

            if (isSaved) {
                const removeIndex = syncQueue.findIndex(
                    item => item.challengeId === targetChallengeId && item.mission === targetMission
                );
                if (removeIndex !== -1) {
                    syncQueue.splice(removeIndex, 1);
                    saveStorageState();
                }

                updateSyncStatusUI(`'${targetMission}' 시트 저장 완료! (+100점)`, true);

                stopLeaderboard();
                resumeLeaderboard();

                isProcessingQueue = false;
                if (syncQueue.length > 0) {
                    processQueue();
                } else {
                    updateSyncStatusUI();
                }
            } else {
                throw new Error("SERVER_RECEIPT_NOT_CONFIRMED");
            }
        } catch (err) {
            const currentPending = syncQueue.filter(item => item.challengeId === currentChallengeId).length;
            const pastPending = syncQueue.length - currentPending;
            let errMsg = `'${targetMission}' 동기화 보류 (대기 중)`;
            if (pastPending > 0) {
                errMsg += ` [이전 ${pastPending}건]`;
            }
            updateSyncStatusUI(errMsg);

            isProcessingQueue = false;
            if (SHEETS_WEB_APP_URL && !document.hidden) {
                setTimeout(processQueue, QUEUE_RETRY_INTERVAL_MS);
            }
        }
    }

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

            currentChallengeId = generateUUID();
            currentNickname = nickname;
            saveStorageState();

            injectUI();
            updateSyncStatusUI("새 게임이 시작되었습니다. 포즈에 도전하세요!");
            resumeLeaderboard();

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
                return;
            }

            const mission = String(missionName || "").trim();
            if (!VALID_MISSIONS.includes(mission)) {
                console.error("유효하지 않은 미션 이름입니다:", mission);
                return;
            }

            const alreadyInQueue = syncQueue.some(
                item => item.challengeId === currentChallengeId && item.mission === mission
            );
            if (alreadyInQueue) return;

            syncQueue.push({
                challengeId: currentChallengeId,
                nickname: currentNickname,
                mission: mission
            });

            saveStorageState();
            updateSyncStatusUI();

            if (SHEETS_WEB_APP_URL) {
                processQueue();
            }
        },

        setWebAppUrl: function(url) {
            SHEETS_WEB_APP_URL = String(url || "").trim();
            updateSyncStatusUI();
            if (SHEETS_WEB_APP_URL) {
                resumeLeaderboard();
                if (syncQueue.length > 0) {
                    processQueue();
                }
            } else {
                stopLeaderboard();
            }
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        loadStorageState();
        injectUI();
        updateSyncStatusUI();

        if (SHEETS_WEB_APP_URL) {
            if (syncQueue.length > 0) {
                processQueue();
            }
            resumeLeaderboard();
        }
    });
})();
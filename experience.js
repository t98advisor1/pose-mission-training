/**
 * experience.js - 휴대폰 최적화 풀스크린 포즈 게임 엔진 (최종 수정본)
 * 1) 카메라/모델 비동기 대기 중 종료 시 startBtn 잠금 즉시 해제 및 세대 충돌 방지
 * 2) 사용자 수동 일시정지(userPaused)와 탭 비활성화 플로우 분리
 * 3) 하체 스켈레톤 라인 추가 및 AR 장식(딸기 코/모자) 토글 기능 연동
 * 4) active 진입 시 RAF 유효성 검사 및 보너스 토스트 즉시 초기화
 */
(function() {
    // 7개 포즈 메타데이터
    const POSE_INFO = {
        big_v: { emoji: "🙆‍♂️", desc: "두 팔을 머리 위로 펴서 시원하게 V자를 만드세요!" },
        heart: { emoji: "🫶", desc: "두 팔을 둥글게 구부려 머리 위에서 하트를 만드세요!" },
        victory: { emoji: "✌️", desc: "손가락으로 예쁜 브이(Victory)를 카메라에 비춰주세요!" },
        thumb_up: { emoji: "👍", desc: "엄지를 번쩍 들어 최고를 표현하세요!" },
        flower: { emoji: "🌻", desc: "양손을 쫙 펴고 얼굴 양옆에 귀여운 꽃받침을 하세요!" },
        hero: { emoji: "🦸‍♂️", desc: "한 손은 하늘 높이 뻗고, 반대 손은 듬직하게 허리에 얹으세요!" },
        dab: { emoji: "🕺", desc: "한 팔을 대각선으로 뻗고, 얼굴은 반대 팔꿈치에 살짝 묻으세요!" }
    };

    // 생명주기 및 세대 관리 변수
    let gameGeneration = 0;
    let missionGeneration = 0;
    let phase = "waiting"; // "waiting" | "preview" | "active" | "success" | "paused" | "result"
    let userPaused = false; // 사용자 수동 pause 구분 플래그

    let bonusScore = 0;
    let currentSession = null;
    let previewTimer = null;
    let successTransitionTimer = null;
    let bonusToastTimer = null;
    let isDecorEnabled = true; // 딸기 코 & 모자 표시 토글 상태 (새 게임에도 유지)

    // 캔버스 크기 및 Letterbox 캐싱
    const overlayCanvas = document.getElementById("pose-overlay");
    const ctx = overlayCanvas ? overlayCanvas.getContext("2d") : null;
    let letterbox = { offsetX: 0, offsetY: 0, drawWidth: 0, drawHeight: 0 };
    let lastStageW = 0;
    let lastStageH = 0;
    let lastVideoW = 0;
    let lastVideoH = 0;
    let lastDpr = 0;

    // DOM 요소 캐시
    const startScreen = document.getElementById("start-screen");
    const gameScreen = document.getElementById("game-screen");
    const resultScreen = document.getElementById("result-screen");
    const visionStage = document.getElementById("vision-stage");

    const nicknameInput = document.getElementById("nickname-input");
    const startBtn = document.getElementById("start-btn");
    const retryBtn = document.getElementById("retry-btn");
    const playerTag = document.getElementById("player-tag");
    const stepBadge = document.getElementById("step-badge");
    const scoreText = document.getElementById("score-text");
    const bonusScoreText = document.getElementById("bonus-score-text");
    const poseTitle = document.getElementById("pose-title");
    const poseDesc = document.getElementById("pose-desc");
    const poseImg = document.getElementById("pose-img");

    const previewOverlay = document.getElementById("preview-overlay");
    const previewCaption = document.getElementById("preview-caption");
    const statusBanner = document.getElementById("status-banner");
    const bonusToast = document.getElementById("bonus-toast");
    const progressFill = document.getElementById("progress-fill");
    const holdText = document.getElementById("hold-text");

    const pauseResumeBtn = document.getElementById("pause-resume-btn");
    const replayPhotoBtn = document.getElementById("replay-photo-btn");
    const exitGameBtn = document.getElementById("exit-game-btn");
    const decorToggleBtn = document.getElementById("decor-toggle");

    const gameSyncStatus = document.getElementById("game-sync-status");
    const resultSyncStatus = document.getElementById("result-sync-status");
    const resultUserSummary = document.getElementById("result-user-summary");
    const resultBaseScore = document.getElementById("result-base-score");
    const resultBonusScore = document.getElementById("result-bonus-score");
    const resultTotalScore = document.getElementById("result-total-score");

    // 화면 전환 제어
    function setAppScreen(targetScreenName) {
        startScreen.classList.remove("active");
        gameScreen.classList.remove("active");
        resultScreen.classList.remove("active");

        if (targetScreenName === "start") {
            startScreen.classList.add("active");
        } else if (targetScreenName === "game") {
            gameScreen.classList.add("active");
        } else if (targetScreenName === "result") {
            resultScreen.classList.add("active");
        }

        if (window.PoseSheet && typeof window.PoseSheet.setScreen === "function") {
            window.PoseSheet.setScreen(targetScreenName);
        }
    }

    // 캔버스 버퍼 리사이즈 및 Letterbox 좌표 계산
    function updateCanvasSizeAndLetterbox() {
        if (!overlayCanvas || !visionStage || !webcam) return;

        const stageRect = visionStage.getBoundingClientRect();
        const stageW = Math.round(stageRect.width);
        const stageH = Math.round(stageRect.height);
        if (stageW === 0 || stageH === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const videoW = webcam.videoWidth || 640;
        const videoH = webcam.videoHeight || 480;

        if (stageW !== lastStageW || stageH !== lastStageH ||
            videoW !== lastVideoW || videoH !== lastVideoH || dpr !== lastDpr) {

            lastStageW = stageW;
            lastStageH = stageH;
            lastVideoW = videoW;
            lastVideoH = videoH;
            lastDpr = dpr;

            overlayCanvas.width = stageW * dpr;
            overlayCanvas.height = stageH * dpr;
            overlayCanvas.style.width = stageW + "px";
            overlayCanvas.style.height = stageH + "px";

            if (ctx) {
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.scale(dpr, dpr);
            }

            const stageAspect = stageW / stageH;
            const videoAspect = videoW / videoH;

            let drawW, drawH, offX, offY;
            if (stageAspect > videoAspect) {
                drawH = stageH;
                drawW = stageH * videoAspect;
                offX = (stageW - drawW) / 2;
                offY = 0;
            } else {
                drawW = stageW;
                drawH = stageW / videoAspect;
                offX = 0;
                offY = (stageH - drawH) / 2;
            }

            letterbox = { offsetX: offX, offsetY: offY, drawWidth: drawW, drawHeight: drawH };
        }
    }

    window.addEventListener("resize", () => {
        lastStageW = 0;
        updateCanvasSizeAndLetterbox();
    });

    function normToCanvas(pt) {
        return {
            x: letterbox.offsetX + pt.x * letterbox.drawWidth,
            y: letterbox.offsetY + pt.y * letterbox.drawHeight
        };
    }

    function clearOverlayCanvas() {
        if (ctx && overlayCanvas) {
            ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
    }

    function clearBonusToast() {
        if (bonusToast) {
            bonusToast.classList.remove("pop");
        }
        if (bonusToastTimer) {
            clearTimeout(bonusToastTimer);
            bonusToastTimer = null;
        }
    }

    // AR 장식 렌더링: 딸기 코 🍓 & 파티 꼬깔모자
    function drawFaceDecorations(landmarks) {
        if (!isDecorEnabled || !ctx || !landmarks || landmarks.length < 9) return;

        const nose = landmarks[0];
        const leftEye = landmarks[2];
        const rightEye = landmarks[5];
        const leftEar = landmarks[7];
        const rightEar = landmarks[8];

        if (!isValidPoint(nose)) return;

        const hasEyes = isValidPoint(leftEye) && isValidPoint(rightEye);
        const hasEars = isValidPoint(leftEar) && isValidPoint(rightEar);
        if (!hasEyes && !hasEars) return;

        const nosePt = normToCanvas(nose);
        let p1, p2, rawDist;

        if (hasEyes) {
            p1 = normToCanvas(leftEye);
            p2 = normToCanvas(rightEye);
            rawDist = Math.hypot(p1.x - p2.x, p1.y - p2.y) * 2.2;
        } else {
            p1 = normToCanvas(leftEar);
            p2 = normToCanvas(rightEar);
            rawDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        }

        const leftPoint = (p1.x <= p2.x) ? p1 : p2;
        const rightPoint = (p1.x <= p2.x) ? p2 : p1;
        const angle = Math.atan2(rightPoint.y - leftPoint.y, rightPoint.x - leftPoint.x);
        const faceWidth = Math.max(35, Math.min(220, rawDist));

        ctx.save();

        // 1. 딸기 코
        ctx.save();
        ctx.translate(nosePt.x, nosePt.y);
        ctx.rotate(angle);
        ctx.font = `${Math.round(faceWidth * 0.42)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("🍓", 0, 0);
        ctx.restore();

        // 2. 꼬깔모자
        ctx.save();
        ctx.translate(nosePt.x, nosePt.y);
        ctx.rotate(angle);

        const hatBaseOffset = -faceWidth * 0.95;
        const hatW = faceWidth * 0.75;
        const hatH = faceWidth * 1.25;

        ctx.beginPath();
        ctx.moveTo(0, hatBaseOffset - hatH);
        ctx.lineTo(-hatW / 2, hatBaseOffset);
        ctx.quadraticCurveTo(0, hatBaseOffset + hatW * 0.15, hatW / 2, hatBaseOffset);
        ctx.closePath();

        const grad = ctx.createLinearGradient(-hatW / 2, hatBaseOffset, hatW / 2, hatBaseOffset - hatH);
        grad.addColorStop(0, "#f43f5e");
        grad.addColorStop(0.5, "#fbbf24");
        grad.addColorStop(1, "#38bdf8");
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();

        const dots = [
            { x: 0, y: hatBaseOffset - hatH * 0.65, r: hatW * 0.08, color: "#ffffff" },
            { x: -hatW * 0.18, y: hatBaseOffset - hatH * 0.35, r: hatW * 0.09, color: "#22c55e" },
            { x: hatW * 0.18, y: hatBaseOffset - hatH * 0.35, r: hatW * 0.09, color: "#a855f7" },
            { x: 0, y: hatBaseOffset - hatH * 0.18, r: hatW * 0.1, color: "#ffffff" }
        ];

        dots.forEach(d => {
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
            ctx.fillStyle = d.color;
            ctx.fill();
        });

        ctx.beginPath();
        ctx.arc(0, hatBaseOffset - hatH, hatW * 0.15, 0, Math.PI * 2);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#f59e0b";
        ctx.stroke();

        ctx.restore();
        ctx.restore();
    }

    // 관절 스켈레톤 라인 (상체 및 하체 연결선 추가)
    function drawSkeleton(landmarks, isMatched) {
        if (!ctx || !landmarks) return;

        const CONNECTIONS = [
            [11, 12], [11, 13], [13, 15],
            [12, 14], [14, 16],
            [11, 23], [12, 24], [23, 24],
            [23, 25], [25, 27], [24, 26], [26, 28] // 하체 라인
        ];

        ctx.save();
        ctx.lineWidth = 4;
        ctx.strokeStyle = isMatched ? "#22c55e" : "#38bdf8";
        ctx.fillStyle = isMatched ? "#4ade80" : "#0284c7";

        CONNECTIONS.forEach(([i, j]) => {
            const p1 = landmarks[i];
            const p2 = landmarks[j];
            if (isValidPoint(p1) && isValidPoint(p2)) {
                const c1 = normToCanvas(p1);
                const c2 = normToCanvas(p2);
                ctx.beginPath();
                ctx.moveTo(c1.x, c1.y);
                ctx.lineTo(c2.x, c2.y);
                ctx.stroke();
            }
        });

        [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach(idx => {
            const pt = landmarks[idx];
            if (isValidPoint(pt)) {
                const c = normToCanvas(pt);
                ctx.beginPath();
                ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = "#ffffff";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        });

        ctx.restore();
    }

    window.resetHoldTimer = function(reasonMsg = null) {
        accumulatedHoldMs = 0;
        lastFrameTimestamp = null;
        if (progressFill) progressFill.style.width = "0%";
        if (holdText) holdText.innerText = "0.0s";
        if (reasonMsg && phase === "active" && !clearedPoses[currentPoseIndex]) {
            if (statusBanner) {
                statusBanner.className = "vision-hud-banner";
                statusBanner.innerText = `[인식중] ${reasonMsg}`;
            }
        }
    };

    function getNextIncompletePoseIndex() {
        for (let i = 0; i < poses.length; i++) {
            if (!clearedPoses[i]) return i;
        }
        return -1;
    }

    window.handleAppDeactivation = function() {
        missionGeneration++;
        phase = "paused";

        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        if (successTransitionTimer) {
            clearTimeout(successTransitionTimer);
            successTransitionTimer = null;
        }
        clearBonusToast();

        if (previewOverlay) previewOverlay.classList.remove("active");
        clearOverlayCanvas();

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        window.resetHoldTimer("화면을 벗어나 일시정지되었습니다.");
    };

    const nativeStopCamera = window.stopCamera;
    window.stopCamera = function() {
        missionGeneration++;
        phase = "paused";

        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }
        if (successTransitionTimer) {
            clearTimeout(successTransitionTimer);
            successTransitionTimer = null;
        }
        clearBonusToast();

        if (previewOverlay) previewOverlay.classList.remove("active");
        clearOverlayCanvas();

        if (typeof nativeStopCamera === "function") {
            nativeStopCamera();
        }
    };

    // 1초 사진 예고 및 active 전환
    function triggerPosePreview(poseIdx) {
        const thisGameGen = gameGeneration;
        const thisMissionGen = ++missionGeneration;

        if (previewTimer) {
            clearTimeout(previewTimer);
            previewTimer = null;
        }

        phase = "preview";
        window.resetHoldTimer();
        clearOverlayCanvas();

        const currentPose = poses[poseIdx];
        const poseMeta = POSE_INFO[currentPose.id] || { emoji: "✨", desc: "" };

        if (stepBadge) stepBadge.innerText = `${poseIdx + 1} / ${poses.length}`;
        if (poseTitle) poseTitle.innerText = `${currentPose.name} ${poseMeta.emoji}`;
        if (poseDesc) poseDesc.innerText = poseMeta.desc;
        if (statusBanner) {
            statusBanner.className = "vision-hud-banner";
            statusBanner.innerText = "포즈 사진을 확인하세요!";
        }

        if (previewCaption) previewCaption.innerText = `다음 포즈: ${currentPose.name} ${poseMeta.emoji}`;
        if (previewOverlay) previewOverlay.classList.add("active");

        let isHandled = false;
        const onImageReady = () => {
            if (isHandled) return;
            isHandled = true;

            if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration || document.hidden) {
                return;
            }

            previewTimer = setTimeout(() => {
                if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration ||
                    document.hidden || !localStream || !webcam || webcam.paused) {
                    return;
                }
                if (previewOverlay) previewOverlay.classList.remove("active");
                phase = "active";
                window.resetHoldTimer();
                lastFrameTimestamp = null;
                if (statusBanner) {
                    statusBanner.className = "vision-hud-banner";
                    statusBanner.innerText = `[인식중] 2초간 ${currentPose.name} 자세를 유지하세요!`;
                }

                // active 전환 시점에 RAF 루프가 중단되어 있다면 즉시 시작
                if (!animationFrameId) {
                    animationFrameId = requestAnimationFrame(window.predictWebcam);
                }
            }, 1000);
        };

        poseImg.onload = null;
        poseImg.onerror = null;
        poseImg.onload = onImageReady;
        poseImg.onerror = () => {
            console.warn("포즈 이미지 로드 실패:", currentPose.src);
            if (statusBanner) {
                statusBanner.className = "vision-hud-banner";
                statusBanner.innerText = "포즈 예시를 불러오지 못해 바로 진행합니다.";
            }
            onImageReady();
        };

        poseImg.src = currentPose.src;

        if (poseImg.complete && poseImg.naturalWidth > 0) {
            onImageReady();
        }
    }

    window.renderPoseView = function(index) {
        currentPoseIndex = index;
        triggerPosePreview(currentPoseIndex);
    };

    function showBonusToast(bonusVal) {
        if (!bonusToast) return;
        clearBonusToast();
        bonusToast.innerText = `✨ 깜짝 보너스 +${bonusVal}점! ✨`;
        bonusToast.classList.add("pop");
        bonusToastTimer = setTimeout(() => {
            bonusToast.classList.remove("pop");
            bonusToastTimer = null;
        }, 800);
    }

    // 실시간 비전 추론 루프
    window.predictWebcam = async function() {
        animationFrameId = null;

        if (document.hidden || !localStream || !webcam || webcam.paused || webcam.ended || !gameScreen.classList.contains("active")) {
            clearOverlayCanvas();
            return;
        }

        if (phase === "paused") {
            clearOverlayCanvas();
            return;
        }

        const now = performance.now();

        if (lastFrameTimestamp !== null) {
            const gap = now - lastFrameTimestamp;
            if (gap > MAX_DELTA_TOLERANCE_MS) {
                window.resetHoldTimer("프레임 지연으로 유지가 초기화되었습니다.");
            }
        }

        if (webcam.currentTime !== lastVideoTime && poseLandmarker) {
            lastVideoTime = webcam.currentTime;
            updateCanvasSizeAndLetterbox();
            clearOverlayCanvas();

            const currentMission = poses[currentPoseIndex];
            let isMatched = false;
            let poseResults = null;
            let gestureResults = null;

            try {
                poseResults = poseLandmarker.detectForVideo(webcam, now);
                const hasPose = poseResults.landmarks && poseResults.landmarks.length > 0;
                const userLandmarks = hasPose ? poseResults.landmarks[0] : null;

                if (!userLandmarks) {
                    clearOverlayCanvas();
                    window.resetHoldTimer("사람이 감지되지 않습니다.");
                } else {
                    drawFaceDecorations(userLandmarks);

                    if (currentMission.type === "gesture" || currentMission.type === "hybrid") {
                        if (gestureRecognizer) {
                            gestureResults = gestureRecognizer.recognizeForVideo(webcam, now);
                        }
                    }

                    if (phase === "active") {
                        if (currentMission.type === "pose") {
                            isMatched = checkPoseMatches(currentMission.id, userLandmarks, null);
                        } else if (currentMission.type === "gesture") {
                            isMatched = checkGestureMatches(currentMission.gesture, gestureResults);
                        } else if (currentMission.type === "hybrid") {
                            isMatched = checkPoseMatches(currentMission.id, userLandmarks, gestureResults);
                        }

                        drawSkeleton(userLandmarks, isMatched);

                        if (isMatched) {
                            if (lastFrameTimestamp !== null) {
                                const delta = now - lastFrameTimestamp;
                                if (delta > 0 && delta <= MAX_DELTA_TOLERANCE_MS) {
                                    accumulatedHoldMs += delta;
                                }
                            }
                            lastFrameTimestamp = now;

                            const ratio = Math.min(accumulatedHoldMs / REQUIRED_HOLD_MS, 1.0);
                            if (progressFill) progressFill.style.width = `${(ratio * 100).toFixed(0)}%`;
                            if (holdText) holdText.innerText = `${(accumulatedHoldMs / 1000).toFixed(1)}s`;

                            if (statusBanner) {
                                statusBanner.className = "vision-hud-banner success";
                                statusBanner.innerText = `[자세맞음] 완벽해요! 유지하세요! (${(accumulatedHoldMs / 1000).toFixed(1)}s)`;
                            }

                            if (accumulatedHoldMs >= REQUIRED_HOLD_MS) {
                                phase = "success";
                                accumulatedHoldMs = 0;
                                lastFrameTimestamp = null;

                                if (!clearedPoses[currentPoseIndex]) {
                                    clearedPoses[currentPoseIndex] = true;
                                    totalScore += 100;
                                    if (scoreText) scoreText.innerText = `${totalScore}점`;

                                    let bonusVal = 0;
                                    if (window.PoseSheet && typeof window.PoseSheet.complete === "function") {
                                        const res = window.PoseSheet.complete(currentMission.name);
                                        if (res && typeof res.bonus === "number") {
                                            bonusVal = res.bonus;
                                        }
                                    }
                                    bonusScore += bonusVal;
                                    if (bonusScoreText) bonusScoreText.innerText = `+${bonusScore}`;
                                    if (bonusVal > 0) {
                                        showBonusToast(bonusVal);
                                    }

                                    updateSyncStatusDisplay();

                                    if (statusBanner) {
                                        statusBanner.className = "vision-hud-banner success";
                                        statusBanner.innerText = `🎉 '${currentMission.name}' 성공! (+100점)`;
                                    }

                                    const thisGameGen = gameGeneration;
                                    const thisMissionGen = missionGeneration;

                                    successTransitionTimer = setTimeout(() => {
                                        if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration) return;

                                        const nextIdx = getNextIncompletePoseIndex();
                                        if (nextIdx !== -1) {
                                            window.renderPoseView(nextIdx);
                                        } else {
                                            phase = "result";
                                            window.stopCamera();
                                            showResultScreen();
                                        }
                                    }, 800);
                                }
                            }
                        } else {
                            if (accumulatedHoldMs > 0) {
                                window.resetHoldTimer("자세가 흐트러졌습니다. 다시 유지해 주세요!");
                            } else {
                                lastFrameTimestamp = null;
                                if (statusBanner) {
                                    statusBanner.className = "vision-hud-banner";
                                    statusBanner.innerText = `[인식중] 2초간 ${currentMission.name} 자세를 유지하세요!`;
                                }
                            }
                        }
                    } else {
                        drawSkeleton(userLandmarks, false);
                    }
                }
            } catch (inferErr) {
                console.error("추론 처리 오류:", inferErr);
                clearOverlayCanvas();
                window.resetHoldTimer("인식 오류로 유지가 초기화되었습니다.");
            }
        }

        if (!document.hidden && localStream && webcam && !webcam.paused && gameScreen.classList.contains("active") && phase !== "paused") {
            if (!animationFrameId) {
                animationFrameId = requestAnimationFrame(window.predictWebcam);
            }
        }
    };

    function showResultScreen() {
        setAppScreen("result");
        const nickname = (currentSession && currentSession.nickname) ? currentSession.nickname : "선생님";
        if (resultUserSummary) resultUserSummary.innerText = `${nickname} 선생님, 7개 미션을 완벽히 완료했습니다!`;
        if (resultBaseScore) resultBaseScore.innerText = `${totalScore}점`;
        if (resultBonusScore) resultBonusScore.innerText = `+${bonusScore}점`;
        if (resultTotalScore) resultTotalScore.innerText = `${totalScore + bonusScore}점`;

        updateSyncStatusDisplay();
    }

    // ① 점수 수치 갱신만 처리하는 updateSyncStatusDisplay 함수
    function updateSyncStatusDisplay() {
        if (window.PoseSheet && typeof window.PoseSheet.getState === "function") {
            const state = window.PoseSheet.getState();
            if (state) {
                const pendingCount = state.pending || 0;

                if (pendingCount === 0 && state.challengeId && currentSession && state.challengeId === currentSession.challengeId) {
                    if (typeof state.baseScore === "number") totalScore = state.baseScore;
                    if (typeof state.bonusScore === "number") bonusScore = state.bonusScore;

                    if (scoreText) scoreText.innerText = `${totalScore}점`;
                    if (bonusScoreText) bonusScoreText.innerText = `+${bonusScore}`;
                    if (resultBaseScore) resultBaseScore.innerText = `${totalScore}점`;
                    if (resultBonusScore) resultBonusScore.innerText = `+${bonusScore}점`;
                    if (resultTotalScore) resultTotalScore.innerText = `${totalScore + bonusScore}점`;
                }
            }
        }
    }

    window.addEventListener("pose-sheet-saved", (evt) => {
        if (evt.detail && currentSession && evt.detail.challengeId === currentSession.challengeId) {
            updateSyncStatusDisplay();
        }
    });

    // 시작 버튼 핸들러
    startBtn.addEventListener("click", async () => {
        if (startBtn.disabled) return;
        startBtn.disabled = true;

        const capturedGameGen = ++gameGeneration;
        window.stopCamera();

        const rawNickname = nicknameInput.value.trim();

        if (!window.PoseSheet || typeof window.PoseSheet.begin !== "function") {
            alert("점수 연동 모듈(PoseSheet)이 로드되지 않았습니다. 잠시 후 다시 시도해 주세요.");
            startBtn.disabled = false;
            return;
        }

        try {
            currentSession = window.PoseSheet.begin(rawNickname);
        } catch (validationErr) {
            alert(validationErr.message);
            nicknameInput.focus();
            startBtn.disabled = false;
            return;
        }

        userPaused = false;
        clearedPoses = new Array(poses.length).fill(false);
        totalScore = 0;
        bonusScore = 0;
        if (scoreText) scoreText.innerText = "0점";
        if (bonusScoreText) bonusScoreText.innerText = "+0";
        if (playerTag) playerTag.innerText = `도전자: ${currentSession.nickname}`;

        setAppScreen("game");
        phase = "waiting";
        const capturedMissionGen = missionGeneration;
        if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";
        updateSyncStatusDisplay();

        if (typeof window.startCamera === "function") {
            await window.startCamera();
        }

        // 비동기 대기 후 세대 검증: 이전 세대 요청은 UI를 변경하지 않고 조기 종료
        if (capturedGameGen !== gameGeneration || capturedMissionGen !== missionGeneration || document.hidden) {
            return;
        }

        // 현재 세대인데 카메라가 정상 기동되지 않은 경우 잠금 해제 및 안내
        if (!gameScreen.classList.contains("active") || document.hidden || !localStream || !webcam || webcam.paused) {
            phase = "paused";
            startBtn.disabled = false;
            if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 게임 시작";
            return;
        }

        startBtn.disabled = false;
        window.renderPoseView(0);
    });

    // 재도전 버튼
    retryBtn.addEventListener("click", () => {
        gameGeneration++;
        startBtn.disabled = false;
        window.stopCamera();
        setAppScreen("start");
    });

    // 일시정지 / 재개 버튼
    // ② pauseResumeBtn 클릭 이벤트 리스너 등록
    pauseResumeBtn.addEventListener("click", async () => {
        if (phase === "paused") {
            userPaused = false;
            phase = "waiting";
            if (pauseResumeBtn) pauseResumeBtn.innerText = "카메라 켜는 중...";

            const thisGameGen = gameGeneration;
            const thisMissionGen = ++missionGeneration;

            if (!localStream && typeof window.startCamera === "function") {
                await window.startCamera();
            }

            // 세대 변경 시 이전 비동기 작업은 UI를 전혀 건드리지 않고 즉시 종료
            if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration) {
                return;
            }

            // 탭이 숨겨진 상태면 UI 수정 없이 종료
            if (document.hidden) {
                return;
            }

            // 현재 세대인데 카메라가 준비되지 않았거나 재생 중이 아닐 때만 계속하기 안내
            if (!gameScreen.classList.contains("active") || !localStream || !webcam || webcam.paused) {
                phase = "paused";
                if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 계속하기";
                return;
            }

            if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";
            const nextIdx = getNextIncompletePoseIndex();
            if (nextIdx !== -1) {
                window.renderPoseView(nextIdx);
            } else {
                phase = "result";
                window.stopCamera();
                showResultScreen();
            }
        } else {
            // active, preview, waiting(카메라 준비 중) 상태에서 클릭 시 즉시 정지 및 취소
            userPaused = true;
            window.stopCamera();
            phase = "paused";
            if (pauseResumeBtn) pauseResumeBtn.innerText = "▶️ 계속하기";
            window.resetHoldTimer("게임이 일시정지되었습니다.");
            if (statusBanner) statusBanner.innerText = "일시정지 상태입니다.";
        }
    });

    // 사진 다시보기 (active 상태에서만 허용)
    replayPhotoBtn.addEventListener("click", () => {
        if (phase === "active") {
            triggerPosePreview(currentPoseIndex);
        }
    });

    // 게임 종료 버튼
    exitGameBtn.addEventListener("click", () => {
        if (confirm("정말 게임을 종료하고 시작 화면으로 돌아갈까요?")) {
            gameGeneration++;
            startBtn.disabled = false;
            window.stopCamera();
            setAppScreen("start");
        }
    });

    // 딸기/모자 장식 토글 버튼 핸들러
    // ③ decorToggleBtn 클릭 이벤트 리스너 등록
    if (decorToggleBtn) {
        decorToggleBtn.addEventListener("click", () => {
            isDecorEnabled = !isDecorEnabled;
            decorToggleBtn.setAttribute("aria-pressed", String(isDecorEnabled));
            decorToggleBtn.innerText = isDecorEnabled ? "🍓 장식 ON" : "🍓 장식 OFF";
            if (!isDecorEnabled) {
                clearOverlayCanvas();
            }
        });
    }

    // 탭 복귀 시 안전 재개 (사용자 수동 pause 상태 제외)
    document.addEventListener("visibilitychange", async () => {
        if (!document.hidden && gameScreen.classList.contains("active") && currentSession) {
            if (userPaused) {
                return; // 사용자가 직접 멈춘 경우 자동으로 카메라를 켜지 않음
            }

            const thisGameGen = gameGeneration;
            const thisMissionGen = missionGeneration;

            if (!localStream && typeof window.startCamera === "function") {
                phase = "waiting";
                await window.startCamera();
            }

            if (thisGameGen !== gameGeneration || thisMissionGen !== missionGeneration || userPaused || !gameScreen.classList.contains("active") ||
                document.hidden || !localStream || !webcam || webcam.paused) {
                return;
            }

            if (pauseResumeBtn) pauseResumeBtn.innerText = "⏸️ 일시정지";

            const nextIdx = getNextIncompletePoseIndex();
            if (nextIdx !== -1) {
                window.renderPoseView(nextIdx);
            } else {
                phase = "result";
                window.stopCamera();
                showResultScreen();
            }
        }
    });

    setAppScreen("start");
})();

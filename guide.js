/** Codex follow-up33: 직접 넘기는 첫 안내와 큰 사진. 카메라 연습은 PosePractice에 위임. */
(function () {
    const dialog = document.getElementById('guide-dialog');
    const page = document.getElementById('guide-page');
    const body = document.getElementById('guide-body');
    const previous = document.getElementById('guide-prev');
    const next = document.getElementById('guide-next');
    const position = document.getElementById('guide-position');
    const dots = document.getElementById('guide-dots');
    const practice = document.getElementById('guide-practice-btn');
    const opener = document.getElementById('guide-open-btn');
    const gallery = document.querySelector('.pose-thumbnail-strip');
    const photos = Array.from(gallery.querySelectorAll('img'));
    const basePoses = poses.filter(p => p.id !== 'body_bonus');
    const seenKey = 'pose-mission-guide-seen-v33';
    let currentPage = 0;
    let galleryIndex = 0;
    let returnFocus = opener;
    let touchStart = null;
    const pages = [
        {emoji:'🤪',title:'가족과 함께, 찰칵!',text:'사진 속 자세를 따라 하며 몸을 신나게 펼쳐 보세요. 사용법을 넘겨 보고, 점수 부담 없이 먼저 연습할 수 있어요.',action:'다음 버튼이나 화면을 옆으로 밀어서 넘겨요.'},
        {emoji:'📷',title:'내 몸이 잘 보이게',text:'휴대폰을 안정된 곳에 세우고 카메라 사용을 허용해 주세요. 밝은 곳에서 손끝과 발끝이 잘리지 않도록 자리를 맞춰요.',action:'팔다리를 펼칠 자리를 확보하고, 불편하면 무리하지 마세요.'},
        {emoji:'⏱️',title:'초록색으로 2초!',text:'몸을 찾으면 파란 선, 목표 자세가 맞으면 초록 선이 보여요. 실전에서는 초록 자세를 연속 2초 유지하면 100점을 받고 다음 포즈로 자동 이동해요.',action:'자세가 풀리면 다시 맞추고 2초를 채워요. 일시정지·사진 다시보기도 사용할 수 있어요.'},
        {id:'big_v',emoji:'🙌',title:'큰 V',text:'두 팔을 머리 위로 쭉 펴서 커다란 V를 만들어요. 두 손을 넓게 벌리고 카메라에 보여 주세요.',action:'두 손과 팔꿈치가 화면 안에 보이도록 2초!'},
        {id:'heart',emoji:'🫶',title:'머리 위 하트',text:'두 팔을 구부려 머리 위에서 하트를 만들어요. 양손을 가까이 모으고 팔꿈치는 둥글게 벌려요.',action:'손과 머리가 잘리지 않게, 하트로 2초!'},
        {id:'victory',emoji:'✌️',title:'한손 브이',text:'한 손의 검지와 중지만 펴서 브이를 만들어요. 손이 얼굴에 가리지 않게 카메라 쪽으로 보여 주세요.',action:'손가락 모양을 또렷하게 보여 주며 2초!'},
        {id:'thumb_up',emoji:'👍',title:'엄지척',text:'다른 손가락은 접고 엄지만 위로 올려요. 엄지 모양이 잘 보이도록 손을 카메라 쪽으로 보여 주세요.',action:'손을 너무 가까이 대지 말고, 엄지척으로 2초!'},
        {id:'flower',emoji:'🌸',title:'양손 꽃피우기',text:'두 손바닥과 손가락을 활짝 펴서 얼굴 양옆에 꽃처럼 놓아요. 사진처럼 손목을 어깨보다 조금 위로 올려 주세요.',action:'손이 얼굴을 가리지 않게 양쪽 손바닥을 보여 주며 2초!'},
        {id:'hero',emoji:'🦸',title:'슈퍼히어로',text:'한 손은 허리에, 다른 팔은 대각선 위로 쭉 뻗어요. 어느 쪽 팔을 올려도 좋아요.',action:'허리에 둔 손도 잘 보이게, 영웅 자세로 2초!'},
        {id:'dab',emoji:'🕺',title:'가벼운 댑',text:'한 팔은 옆 위로 길게 뻗고, 다른 팔은 얼굴 앞에서 접어요. 사진처럼 두 팔을 서로 다르게 만들어 주세요.',action:'목을 무리하게 숙이지 말고, 가벼운 댑으로 2초!'},
        {id:'body_bonus',emoji:'⭐',title:'전신 보너스!',text:'일곱 포즈 뒤에는 몸 전체가 보이게 팔과 다리를 넓혀 2초 유지해요. 보이는 몸 관절과 펼친 크기에 따라 100·200·300·400·500·600·700점 중 한 번의 보너스를 받아요.',action:'가장 많은 관절로 파이프를 구성하면 받을 수 있는 보너스 점수!! 2초 동안 유지한 가장 낮은 등급으로 확정돼요.'},
        {emoji:'🔒',title:'별명으로 함께하는 랭킹',text:'카메라 영상·사진·신체 좌표는 저장하거나 전송하지 않아요. 실전의 별명과 성공 결과만 기록하며, TOP10 보기에서 닉네임별 최고 기록을 볼 수 있어요.',action:'10명보다 적으면 등록된 인원만 표시해요. 경과 시간은 화면에만 표시돼요.'},
        {emoji:'🎉',title:'먼저 연습해 볼까요?',text:'전체 화면 연습에서는 원하는 포즈를 골라 여러 번 익힐 수 있어요. 연습 결과는 저장하지 않으며, 준비되면 앱으로 돌아가 닉네임을 넣고 실전에 도전해요.',action:'연습 중에도 안내 보기·일시정지·장식 켜고 끄기·연습 마치기를 사용할 수 있어요.'}
    ];
    function textElement(tag, text, className) {
        const element = document.createElement(tag);
        element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function renderPage() {
        const entry = pages[currentPage];
        page.className = entry.id && entry.id !== 'body_bonus' ? 'guide-page pose-guide-page' : 'guide-page';
        page.replaceChildren(textElement('div',entry.emoji,'guide-emoji'),textElement('h2',entry.title));
        if (entry.id && entry.id !== 'body_bonus') {
            const pose = basePoses.find(p => p.id === entry.id);
            const pair = document.createElement('div');
            pair.className = 'guide-photo-pair';
            [[pose.src,`${entry.title} 예시 사진`,'포즈 예시 사진'],[`hints/${entry.id}.svg`,`${entry.title} 관절 연결선 힌트`,'관절 연결선 힌트']].forEach(([src,alt,caption]) => {
                const figure = document.createElement('figure');
                const img = document.createElement('img');
                img.src = src; img.alt = alt; img.decoding = 'async';
                figure.append(img,textElement('figcaption',caption)); pair.append(figure);
            });
            page.append(pair);
        }
        page.append(textElement('p',entry.text),textElement('p',entry.action,'guide-success'));
        position.textContent = `${currentPage + 1} / ${pages.length}`;
        previous.disabled = currentPage === 0;
        next.disabled = currentPage === pages.length - 1;
        Array.from(dots.children).forEach((button,index) => {
            if(index === currentPage) button.setAttribute('aria-current','step');
            else button.removeAttribute('aria-current');
        });
        practice.textContent = entry.id ? `📷 ${entry.title} 전체 화면 연습` : '📷 전체 화면으로 미리 연습하기';
        body.scrollTop = 0;
    }
    function openGuide(index = 0) {
        const active = document.activeElement;
        returnFocus = active && active !== document.body && active.getClientRects().length && !active.closest('#game-screen') ? active : opener;
        currentPage = Math.max(0,Math.min(pages.length - 1,index));
        renderPage();
        if (!dialog.open) dialog.showModal();
    }
    function movePage(delta) {
        currentPage = Math.max(0,Math.min(pages.length - 1,currentPage + delta));
        renderPage();
    }
    pages.forEach((entry,index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('aria-label',`${index + 1}장 ${entry.title}`);
        button.addEventListener('click',() => { currentPage = index; renderPage(); });
        dots.append(button);
    });
    opener.addEventListener('click',() => openGuide());
    document.getElementById('guide-close-btn').addEventListener('click',() => dialog.close());
    previous.addEventListener('click',() => movePage(-1));
    next.addEventListener('click',() => movePage(1));
    dialog.addEventListener('keydown',event => {
        if(event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault(); movePage(event.key === 'ArrowRight' ? 1 : -1);
        }
    });
    body.addEventListener('touchstart',event => {
        const touch = event.changedTouches[0]; touchStart = {x:touch.clientX,y:touch.clientY};
    },{passive:true});
    body.addEventListener('touchend',event => {
        if(!touchStart) return;
        const touch = event.changedTouches[0], dx = touch.clientX - touchStart.x, dy = touch.clientY - touchStart.y;
        touchStart = null;
        if(Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) movePage(dx < 0 ? 1 : -1);
    },{passive:true});
    dialog.addEventListener('close',() => {
        try { localStorage.setItem(seenKey,'1'); } catch (_) {}
        if(returnFocus && returnFocus.isConnected) returnFocus.focus();
    });
    async function startPractice(poseId) {
        if (!window.PosePractice) { alert('연습 화면을 준비하지 못했어요. 새로고침 후 다시 눌러 주세요.'); return; }
        if (dialog.open) dialog.close();
        practice.disabled = true;
        try { await window.PosePractice.start(poseId); }
        finally { practice.disabled = false; }
    }
    practice.addEventListener('click',() => startPractice(pages[currentPage].id || basePoses[galleryIndex].id));
    document.getElementById('practice-home-btn').addEventListener('click',() => startPractice(basePoses[galleryIndex].id));
    document.getElementById('practice-guide-btn').addEventListener('click',() => {
        const id = document.getElementById('practice-pose-select').value;
        window.PosePractice.stop();
        openGuide(pages.findIndex(p => p.id === id));
    });
    function renderGallery() {
        document.getElementById('gallery-position').textContent = `${galleryIndex + 1} / ${photos.length} · ${basePoses[galleryIndex].name}`;
        document.getElementById('gallery-prev').disabled = galleryIndex === 0;
        document.getElementById('gallery-next').disabled = galleryIndex === photos.length - 1;
    }
    function moveGallery(delta) {
        galleryIndex = Math.max(0,Math.min(photos.length - 1,galleryIndex + delta));
        gallery.scrollTo({left:photos[galleryIndex].offsetLeft - photos[0].offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
        renderGallery();
    }
    gallery.addEventListener('scroll',() => {
        let distance = Infinity;
        photos.forEach((photo,index) => {
            const candidate = Math.abs(photo.offsetLeft - photos[0].offsetLeft - gallery.scrollLeft);
            if(candidate < distance) { distance = candidate; galleryIndex = index; }
        });
        renderGallery();
    },{passive:true});
    document.getElementById('gallery-prev').addEventListener('click',() => moveGallery(-1));
    document.getElementById('gallery-next').addEventListener('click',() => moveGallery(1));
    renderGallery(); renderPage();
    let seen = false;
    try { seen = localStorage.getItem(seenKey) === '1'; } catch (_) {}
    if (!seen) openGuide();
})();

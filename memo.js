(() => {
  const supabaseUrl = 'https://hpnfvtaygpojfavycqpf.supabase.co';
  const supabaseKey = 'sb_publishable_7nWwipaRdah9aF54ityvQA_or4dp8Wj';

  const MEMO_MAXLEN = 100;
  const NICK_MAXLEN = 8;
  const nicknamePattern = /^[a-zA-Z0-9가-힣 _-]{1,16}$/;
  const xssPattern = /<|>|script|onerror|img|iframe|svg|onload|javascript:/gi;

  function roundPos(v) {
    return Math.round(v * 100) / 100;
  }

  // 크리스마스 컬러 팔레트
  const christmasColors = [
    { bg: 'rgba(255, 242, 215, 0.95)', border: 'rgba(218, 36, 66, 0.8)', chip: '#e63946', accent: '#ff6b6b' }, // 빨강
    { bg: 'rgba(255, 227, 200, 0.95)', border: 'rgba(230, 57, 70, 0.85)', chip: '#dc143c', accent: '#ff4757' }, // 진한 빨강
    { bg: 'rgba(255, 250, 240, 0.95)', border: 'rgba(45, 80, 22, 0.8)', chip: '#2d5016', accent: '#0f8a3c' }, // 초록
    { bg: 'rgba(240, 255, 240, 0.95)', border: 'rgba(34, 139, 34, 0.8)', chip: '#228b22', accent: '#32cd32' }, // 밝은 초록
    { bg: 'rgba(255, 248, 230, 0.95)', border: 'rgba(184, 134, 11, 0.7)', chip: '#daa520', accent: '#e6c547' }, // 금색 (부드러운 톤)
    { bg: 'rgba(255, 245, 238, 0.95)', border: 'rgba(255, 165, 0, 0.8)', chip: '#ffa500', accent: '#ffb84d' }, // 오렌지
    { bg: 'rgba(240, 248, 255, 0.95)', border: 'rgba(30, 58, 138, 0.8)', chip: '#1e3a8a', accent: '#3b82f6' }, // 파랑
    { bg: 'rgba(255, 250, 250, 0.95)', border: 'rgba(192, 192, 192, 0.8)', chip: '#4a5568', accent: '#718096' }, // 은색 (어두운 회색 칩으로 대비 강화)
  ];

  // 메모 ID 기반 일관된 색상 선택
  function getMemoColor(memoId) {
    if (!memoId) return christmasColors[0];
    const hash = memoId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return christmasColors[hash % christmasColors.length];
  }

  // 메모 ID 기반 일관된 회전/스케일 (sticky note 느낌)
  function getMemoTransform(memoId) {
    if (!memoId) return { rotate: 0, scale: 1 };
    const hash = memoId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const rotate = (hash % 11) - 5; // -5도 ~ +5도
    const scale = 0.92 + ((hash % 9) / 100); // 0.92 ~ 1.00
    return { rotate, scale };
  }

  const memoLayer = document.getElementById('memo-layer');
  const memoModal = document.getElementById('memo-modal');
  const confirmModal = document.getElementById('confirm-modal');
  const memoForm = document.getElementById('memo-form');
  const authorInput = document.getElementById('memo-author');
  const contentInput = document.getElementById('memo-content');
  const modalTitle = document.getElementById('memo-modal-title');

  // 입력 길이 제한 및 안내
  if(authorInput) authorInput.setAttribute('maxlength', String(NICK_MAXLEN));
  if(contentInput) contentInput.setAttribute('maxlength', String(MEMO_MAXLEN));
  // 길이 경고 UI
  let warnSpan = document.createElement('div');
  warnSpan.style.cssText='font-size:12px;color:#dc143c;padding:3px 2px;display:none';
  authorInput && authorInput.parentNode && authorInput.parentNode.appendChild(warnSpan);
  let memoWarnSpan = document.createElement('div');
  memoWarnSpan.style.cssText='font-size:12px;color:#dc143c;padding:3px 2px;display:none';
  contentInput && contentInput.parentNode && contentInput.parentNode.appendChild(memoWarnSpan);

  const confirmOkBtn = confirmModal?.querySelector('[data-action="ok-confirm"]');
  const confirmCancelBtn = confirmModal?.querySelector('[data-action="cancel-confirm"]');
  const confirmCloseBtn = confirmModal?.querySelector('[data-action="close-confirm"]');
  const modalCloseBtn = memoModal?.querySelector('[data-action="close"]');
  const modalCancelBtn = memoModal?.querySelector('[data-action="cancel"]');

  let supabaseClient = null;
  let memoState = [];
  let currentMode = 'create';
  let currentMemo = null;
  let pendingPosition = { x: 0, y: 0 };
  let confirmResolver = null;

  init();

  function init() {
    if (!window.supabase || !supabaseUrl || !supabaseKey) {
      console.warn('Supabase 초기화 실패: 라이브러리 또는 키 누락');
      return;
    }
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
    bindGlobalEvents();
    loadMemos();
    subscribeMemos(); // 실시간 구독 시작
  }

  function subscribeMemos() {
    supabaseClient
      .channel('public:memos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, (payload) => {
        if (payload.eventType === 'INSERT') {
            const newMemo = payload.new;
            if (!memoState.find(m => m.id === newMemo.id)) {
                memoState.push(newMemo);
                addMemoEl(newMemo);
            }
        } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new;
            const idx = memoState.findIndex(m => m.id === updated.id);
            if (idx > -1) {
                memoState[idx] = updated;
                updateMemoEl(updated);
            }
        } else if (payload.eventType === 'DELETE') {
            const delId = payload.old.id;
            memoState = memoState.filter(m => m.id !== delId);
            const el = memoLayer.querySelector(`.memo[data-id="${delId}"]`);
            if (el) {
                el.style.transform = 'scale(0)';
                el.style.opacity = '0';
                setTimeout(() => el.remove(), 400);
            }
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
           console.log('Realtime connected!');
        }
      });
  }

  function bindGlobalEvents() {
    // 배경 클릭 시 작성 버튼 표시 (기존 더블클릭 로직 대체)
    document.addEventListener('click', (e) => {
      // 메모나 모달 내부, 스피커 버튼, 툴팁 클릭은 무시
      if (e.target.closest('.memo') || 
          e.target.closest('.modal') || 
          e.target.closest('.create-btn-tooltip') ||
          e.target.closest('#audio-toggle') ||
          e.target.id === 'audio-toggle') return;
      
      showCreateTooltip(e.clientX, e.clientY);
    });

    memoForm?.addEventListener('submit', handleSubmit);
    modalCloseBtn?.addEventListener('click', closeMemoModal);
    modalCancelBtn?.addEventListener('click', closeMemoModal);
    
    // 키보드 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideCreateTooltip();
        if (isConfirmOpen()) closeConfirmModal();
        else if (isModalOpen()) closeMemoModal();
      }
    });
  }

  // 작성 툴팁 관련 변수 및 함수
  let createTooltip = null;
  
  function showCreateTooltip(x, y) {
    if (!createTooltip) {
      createTooltip = document.createElement('div');
      createTooltip.className = 'create-btn-tooltip';
      createTooltip.innerHTML = `
        <span class="tooltip-text">메모 작성</span>
        <button class="tooltip-close" aria-label="닫기">✕</button>
      `;
      document.body.appendChild(createTooltip);
      
      // 메모 작성 버튼 클릭
      const textSpan = createTooltip.querySelector('.tooltip-text');
      textSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        openMemoModal('create', null, { x, y });
        hideCreateTooltip();
      });
      
      // 닫기 버튼 클릭
      const closeBtn = createTooltip.querySelector('.tooltip-close');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideCreateTooltip();
      });
    }
    
    // 위치 보정 (화면 벗어남 방지)
    const w = 140; // 닫기 버튼 포함 너비
    const h = 40;
    let finalX = Math.min(x, window.innerWidth - w);
    let finalY = Math.min(y, window.innerHeight - h);
    
    createTooltip.style.left = `${finalX}px`;
    createTooltip.style.top = `${finalY}px`;
    createTooltip.classList.remove('hidden');
    createTooltip.style.animation = 'none';
    createTooltip.offsetHeight; /* trigger reflow */
    createTooltip.style.animation = 'popTooltip 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
  }

  function hideCreateTooltip() {
    if (createTooltip) createTooltip.classList.add('hidden');
  }

  async function loadMemos() {
    // 전체 메모 개수 확인
    const { count, error: countError } = await supabaseClient
      .from('memos')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      console.error('메모 개수 확인 실패', countError.message);
      return;
    }

    const totalCount = count || 0;
    const batchSize = 30;
    memoState = [];

    // 5개씩 순차적으로 불러오기
    for (let offset = 0; offset < totalCount; offset += batchSize) {
      const { data, error } = await supabaseClient
        .from('memos')
        .select('*')
        .order('created_at', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) {
        console.error('메모 불러오기 실패', error.message);
        continue;
      }

      if (data && data.length > 0) {
        memoState.push(...data);
        // 각 배치마다 렌더링 (점진적 표시)
        renderMemos();
        // 다음 배치 로드 전 약간의 딜레이 (너무 빠르면 부하)
        if (offset + batchSize < totalCount) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
  }

  function renderMemos() {
    memoLayer.innerHTML = '';
    memoState.forEach((memo) => {
      addMemoEl(memo);
    });
  }

  // 메모 위치를 화면 경계 내로 보정하는 함수
  function constrainMemoPosition(el, xPercent, yPercent) {
    const layerRect = memoLayer.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    
    // 메모의 실제 크기를 %로 변환
    const memoWidthPercent = (elRect.width / layerRect.width) * 100;
    const memoHeightPercent = (elRect.height / layerRect.height) * 100;
    
    // 경계 체크 및 보정
    let xx = Math.max(0, Math.min(xPercent, 100 - memoWidthPercent));
    let yy = Math.max(0, Math.min(yPercent, 100 - memoHeightPercent));
    
    return { x: roundPos(xx), y: roundPos(yy) };
  }

  function addMemoEl(memo) {
      const el = document.createElement('div');
      el.className = 'memo';
      // 좌표 % 값 강제 보정 (이전 데이터 px 값이면 중앙, 소수점 2자리)
      let xx = Number(memo.pos_x);
      let yy = Number(memo.pos_y);
      if (isNaN(xx) || xx < 1 || xx > 99) xx = 50;
      if (isNaN(yy) || yy < 1 || yy > 99) yy = 45;
      xx = roundPos(xx);
      yy = roundPos(yy);
      el.style.left = `calc(${xx}% )`;
      el.style.top = `calc(${yy}% )`;
      el.dataset.id = memo.id;

      // 크리스마스 컬러 적용 (CSS 변수로 제어)
      const colors = getMemoColor(memo.id);
      const transform = getMemoTransform(memo.id);
      
      el.style.setProperty('--memo-bg', colors.bg);
      el.style.setProperty('--memo-border', colors.border);
      el.style.setProperty('--memo-chip', colors.chip);
      el.style.setProperty('--memo-accent', colors.accent);

      el.style.transform = `rotate(${transform.rotate}deg) scale(${transform.scale})`;
      el.style.transformOrigin = 'center center';
      el.dataset.colorTheme = JSON.stringify(colors);

      el.innerHTML = `
        <div class="memo-header">
            <span class="memo-chip">🎄 ${escapeHtml(memo.author || '익명')}</span>
            <span class="memo-date">${formatDateTime(memo.created_at)}</span>
        </div>
        <div class="memo-content">${escapeHtml(memo.content)}</div>
      `;

      attachMemoEvents(el, memo);
      memoLayer.appendChild(el);
      
      // DOM에 추가된 후 실제 크기를 측정하여 경계 보정
      setTimeout(() => {
        const constrained = constrainMemoPosition(el, xx, yy);
        el.style.left = `calc(${constrained.x}% )`;
        el.style.top = `calc(${constrained.y}% )`;
      }, 0);
  }

  function updateMemoEl(memo) {
    const el = memoLayer.querySelector(`.memo[data-id="${memo.id}"]`);
    if (!el) return;
    
    // 내용/작성자 업데이트
    const chip = el.querySelector('.memo-chip');
    const contentDiv = el.querySelector('.memo-content');
    if (chip) chip.innerHTML = `🎄 ${escapeHtml(memo.author || '익명')}`;
    if (contentDiv) contentDiv.innerHTML = escapeHtml(memo.content);

    // 위치 업데이트 (transition에 의해 부드럽게 이동)
    // 단, 내가 드래그 중인 요소는 업데이트 건너뛰거나 드래그 끝난 후 반영해야 튐 방지
    if (el.classList.contains('dragging')) return; 

    let xx = Number(memo.pos_x);
    let yy = Number(memo.pos_y);
    if (isNaN(xx) || xx < 1 || xx > 99) xx = 50;
    if (isNaN(yy) || yy < 1 || yy > 99) yy = 45;
    // 경계 보정 적용
    const constrained = constrainMemoPosition(el, xx, yy);
    el.style.left = `calc(${constrained.x}% )`;
    el.style.top = `calc(${constrained.y}% )`;
  }


  function attachMemoEvents(el, memo) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    el.addEventListener('pointerdown', (e) => {
      // 툴팁 숨기기
      hideCreateTooltip();
      dragging = true;
      el.classList.add('dragging');
      // 원래 transform 저장 (회전/스케일 유지)
      const originalTransform = el.style.transform;
      el.dataset.originalTransform = originalTransform || '';
      // 드래그 중에는 원래 transform에 scale(1.05) 추가
      const match = originalTransform.match(/rotate\(([^)]+)\)\s+scale\(([^)]+)\)/);
      if (match) {
        el.style.transform = `rotate(${match[1]}) scale(${parseFloat(match[2]) * 1.05})`;
      } else {
        el.style.transform = originalTransform ? `${originalTransform} scale(1.05)` : 'scale(1.05)';
      }
      const layerRect = memoLayer.getBoundingClientRect();
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      el.setPointerCapture(e.pointerId);
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const layerRect = memoLayer.getBoundingClientRect();
      let xP = ((e.clientX - layerRect.left - offsetX) / layerRect.width) * 100;
      let yP = ((e.clientY - layerRect.top - offsetY) / layerRect.height) * 100;
      // 경계 보정 적용
      const constrained = constrainMemoPosition(el, xP, yP);
      el.style.left = `calc(${constrained.x}% )`;
      el.style.top = `calc(${constrained.y}% )`;
    });

    el.addEventListener('pointerup', async (e) => {
      if (!dragging) return;
      // 툴팁 숨기기 (드래그 끝났을 때 툴팁 뜨는거 방지)
      setTimeout(() => hideCreateTooltip(), 10); 
      dragging = false;
      el.classList.remove('dragging');
      // 원래 transform 복원
      const originalTransform = el.dataset.originalTransform || '';
      el.style.transform = originalTransform;
      el.releasePointerCapture(e.pointerId);
      const layerRect = memoLayer.getBoundingClientRect();
      let xP = ((e.clientX - layerRect.left - offsetX) / layerRect.width) * 100;
      let yP = ((e.clientY - layerRect.top - offsetY) / layerRect.height) * 100;
      // 경계 보정 적용
      const constrained = constrainMemoPosition(el, xP, yP);
      el.style.left = `calc(${constrained.x}% )`;
      el.style.top = `calc(${constrained.y}% )`;
      await updateMemoPosition(memo.id, constrained.x, constrained.y);
    });

    // 더블클릭 이벤트 제거 (수정 불가)
    /*
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.memo-btn')) return;
      e.stopPropagation();
      openMemoModal('edit', memo);
    });
    */

    el.querySelectorAll('.memo-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        // 수정 버튼 동작 제거
        /* if (action === 'edit') {
          openMemoModal('edit', memo);
        } else */
        if (action === 'delete') {
          openConfirm(async () => {
            await deleteMemo(memo.id);
          });
        }
      });
    });
  }

  function openMemoModal(mode, memo = null, position = { x: 0, y: 0 }) {
    currentMode = mode;
    currentMemo = memo;
    pendingPosition = position;

    modalTitle.textContent = mode === 'create' ? '메모 작성' : '메모 수정';
    authorInput.value = memo?.author || '';
    contentInput.value = memo?.content || '';

    memoModal.classList.remove('hidden');
    memoModal.setAttribute('aria-hidden', 'false');
    setTimeout(() => authorInput.focus(), 0);
  }

  function closeMemoModal() {
    memoModal.classList.add('hidden');
    memoModal.setAttribute('aria-hidden', 'true');
    memoForm?.reset();
    currentMemo = null;
  }

  function openConfirm(onConfirm) {
    confirmResolver = async (ok) => {
      if (ok && typeof onConfirm === 'function') {
        await onConfirm();
      }
    };
    confirmModal.classList.remove('hidden');
    confirmModal.setAttribute('aria-hidden', 'false');
  }

  function closeConfirmModal() {
    confirmModal.classList.add('hidden');
    confirmModal.setAttribute('aria-hidden', 'true');
    confirmResolver = null;
  }

  function isModalOpen() {
    return memoModal && !memoModal.classList.contains('hidden');
  }

  function isConfirmOpen() {
    return confirmModal && !confirmModal.classList.contains('hidden');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const author = (authorInput.value || '').trim() || '익명';
    const content = (contentInput.value || '').trim();

    warnSpan.style.display = 'none';
    memoWarnSpan.style.display = 'none';
    let err = '';
    if (!content || xssPattern.test(content)) {
      err = '내용을 입력하세요 (공백/특수코드 불가)';
      memoWarnSpan.innerText = err; memoWarnSpan.style.display = 'block';
      contentInput.focus();
      return;
    }
    if (content.length > MEMO_MAXLEN) {
      err = `메모는 최대 ${MEMO_MAXLEN}자까지 작성가능`; memoWarnSpan.innerText = err; memoWarnSpan.style.display = 'block';
      contentInput.focus();
      return;
    }
    if (author.length > NICK_MAXLEN || xssPattern.test(author) || (author !== '익명' && !nicknamePattern.test(author))) {
      err = '닉네임은 1~16자 이내 한글/영문/숫자/공백/_/- 만 가능'; warnSpan.innerText = err; warnSpan.style.display = 'block';
      authorInput.focus();
      return;
    }
    // 위치 px → % 변환 (소수점 2자리)
    let layerRect = memoLayer.getBoundingClientRect();
    let xP = roundPos(Math.min(Math.max(((pendingPosition.x - layerRect.left ) / layerRect.width) * 100, 1), 99));
    let yP = roundPos(Math.min(Math.max(((pendingPosition.y - layerRect.top ) / layerRect.height) * 100, 1), 99));
    if (currentMode === 'create') {
      await createMemo(content, author, { x: xP, y: yP });
    }
    // 수정 모드 로직 삭제
    closeMemoModal();
  }

  async function createMemo(content, author, position) {
    const { data, error } = await supabaseClient
      .from('memos')
      .insert({ content, author, pos_x: roundPos(position.x), pos_y: roundPos(position.y) })
      .select()
      .single();

    if (error) {
      console.error('메모 생성 실패', error.message);
      return;
    }
    // INSERT 이벤트가 오므로 여기서 직접 추가할 필요 없음(중복 방지)
    // 하지만 빠른 반응성을 위해 낙관적 업데이트를 하거나, 
    // 리얼타임 구독으로 들어올 때 id 중복체크로 막으면 됨.
    // 여기서는 구독이 처리하도록 하고, push는 제거하거나,
    // Realtime 딜레이를 못참겠으면 유지하되 id체크 필수.
    // 심플하게: 그냥 리턴하고 Realtime에 맡김

  }

  /* async function updateMemo(id, content, author) {
    // 내용 수정 기능 제거됨
  } */

  async function updateMemoPosition(id, x, y) {
    // %좌표 저장 (소수점 2자리)
    const { error } = await supabaseClient
      .from('memos')
      .update({ pos_x: roundPos(x), pos_y: roundPos(y) })
      .eq('id', id);
    if (error) {
      console.error('메모 위치 저장 실패', error.message);
      return;
    }
    // Realtime 처리

  }

  // 수정/삭제 완전 제거

  function formatDateTime(dateStr) {
    const d = new Date(dateStr);
    const pad = (v) => String(v).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${yy}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function escapeHtml(str) {
    return (str || '').replace(/[&<>"']/g, (m) => {
      switch (m) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
        default: return m;
      }
    });
  }
})();


// logic.js (v=20260126_SMOOTH_SAFE_INPUT_FULL)
// - Open cells ONLY on left click / tap
// - RMB drag pans on PC (ONLY after first click). RMB never opens cells.
// - Mobile: hold-to-pan then drag (ONLY after first click). Pinch zoom smooth.
// - Wheel zoom smooth.
// - Intro: no pan/zoom; board is truly centered + fully visible via translate+scale.
// - Hard mode: 150 mines.
// NOTE: This expects HTML structure:
// <div id="game-container"><div id="board-wrap"><div id="board"></div></div></div>

(() => {
  // ===== Telegram Mini App =====
  if (window.Telegram?.WebApp) {
    try { Telegram.WebApp.ready(); Telegram.WebApp.expand(); } catch (_) {}
  }

  // ===== Constants =====
  const ROWS = 32;
  const COLS = 18;
  const NUM_MINES = 150;

  const DIR8 = [
    [-1,-1], [-1,0], [-1,1],
    [ 0,-1],         [ 0,1],
    [ 1,-1], [ 1,0], [ 1,1],
  ];

  // ===== State =====
  let board = [];
  let revealedCount = 0;

  let mode = "reveal"; // reveal | flag
  let minesExist = false;
  let safeZoneLocked = false;
  let gameOver = false;

  let hasStarted = false;

  // ===== Camera / Zoom =====
  let zoom = 1;
  let zoomTarget = 1;
  let zoomAnimRAF = 0;
  const ZOOM_MIN = 0.6;
  const ZOOM_MAX = 3.00;

  // gesture state
  let pointers = new Map(); // pointerId -> {x,y}
  let pinch = null;         // {startDist, startZoom}
  let suppressTapUntil = 0;

  // panning
  let panState = null;      // {id,startX,startY,startLeft,startTop,moved,panEnabled}
  let holdTimer = 0;
  const HOLD_TO_PAN_MS = 160; // mobile "hold to pan"
  const MOVE_THRESH_PX = 10;

  // ===== DOM =====
  const boardEl = document.getElementById("board");
  const bombEl = document.getElementById("bomb-count");
  const toggleBtn = document.getElementById("toggle-mode");
  const restartBtn = document.getElementById("restart-btn");
  const gameContainer = document.getElementById("game-container");
  const hudEl = document.getElementById("hud");

  if (!boardEl || !bombEl || !toggleBtn || !restartBtn || !gameContainer || !hudEl) {
    console.error("Missing required DOM elements (#board, #bomb-count, #toggle-mode, #restart-btn, #game-container, #hud).");
    return;
  }

  // Stop context menu everywhere (RMB is pan)
  document.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });

  // ===== Utils =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => Date.now();

  function inBounds(r,c){ return r>=0 && r<ROWS && c>=0 && c<COLS; }

  function forEachNeighbor(r,c,fn){
    for (const [dr,dc] of DIR8){
      const nr=r+dr, nc=c+dc;
      if (inBounds(nr,nc)) fn(nr,nc);
    }
  }

  // ===== HUD spacer (CSS var --hudSpace) =====
  function syncHudSpace(){
    const h = Math.ceil(hudEl.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--hudSpace", `${h}px`);
  }

  function syncHudSpaceBurst(){
    syncHudSpace();
    requestAnimationFrame(syncHudSpace);
    setTimeout(syncHudSpace, 60);
    setTimeout(syncHudSpace, 220);
  }

  if (window.ResizeObserver) {
    new ResizeObserver(syncHudSpaceBurst).observe(hudEl);
  }

  window.addEventListener("resize", () => { syncHudSpaceBurst(); if (!hasStarted) fitIntro(); });
  window.addEventListener("orientationchange", () => { syncHudSpaceBurst(); if (!hasStarted) fitIntro(); });
  if (window.Telegram?.WebApp?.onEvent){
    Telegram.WebApp.onEvent("viewportChanged", () => { syncHudSpaceBurst(); if (!hasStarted) fitIntro(); });
  }

  // ===== Smooth zoom animator =====
  function startZoomAnimator(){
    if (zoomAnimRAF) return;
    const step = () => {
      const diff = zoomTarget - zoom;
      if (Math.abs(diff) < 0.0005) {
        zoom = zoomTarget;
        boardEl.style.transform = `scale(${zoom.toFixed(4)})`;
        zoomAnimRAF = 0;
        return;
      }
      zoom += diff * 0.18; // smoothing strength
      boardEl.style.transform = `scale(${zoom.toFixed(4)})`;
      zoomAnimRAF = requestAnimationFrame(step);
    };
    zoomAnimRAF = requestAnimationFrame(step);
  }

  // ===== Game =====
  function createEmptyBoard(){
    board = Array.from({length: ROWS}, () =>
      Array.from({length: COLS}, () => ({ mine:false, revealed:false, flagged:false, value:0 }))
    );
    revealedCount = 0;
    minesExist = false;
    safeZoneLocked = false;
    gameOver = false;
    hasStarted = false;

    // reset camera state
    pointers.clear();
    pinch = null;
    panState = null;
    suppressTapUntil = 0;
    clearHoldTimer();

    zoom = 1;
    zoomTarget = 1;
    if (zoomAnimRAF) { cancelAnimationFrame(zoomAnimRAF); zoomAnimRAF = 0; }
  }

  function placeMinesAnywhere(){
    let placed = 0;
    while (placed < NUM_MINES){
      const r = (Math.random()*ROWS)|0;
      const c = (Math.random()*COLS)|0;
      if (board[r][c].mine) continue;
      board[r][c].mine = true;
      placed++;
    }
  }

  function ensureMinefieldExists(){
    if (!minesExist){
      minesExist = true;
      placeMinesAnywhere();
    }
  }

  function enforceSafeZone(sr, sc){
    const safe = new Set();
    for (let r=sr-1;r<=sr+1;r++){
      for (let c=sc-1;c<=sc+1;c++){
        if (inBounds(r,c)) safe.add(`${r},${c}`);
      }
    }

    const toMove = [];
    for (const key of safe){
      const [r,c] = key.split(",").map(Number);
      if (board[r][c].mine) toMove.push([r,c]);
    }

    for (const [r,c] of toMove) board[r][c].mine = false;

    let moved = 0;
    while (moved < toMove.length){
      const r = (Math.random()*ROWS)|0;
      const c = (Math.random()*COLS)|0;
      if (safe.has(`${r},${c}`)) continue;
      if (board[r][c].mine) continue;
      board[r][c].mine = true;
      moved++;
    }
  }

  function calcValues(){
    for (let r=0;r<ROWS;r++){
      for (let c=0;c<COLS;c++){
        const cell = board[r][c];
        if (cell.mine) { cell.value = 0; continue; }
        let v = 0;
        forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].mine) v++; });
        cell.value = v;
      }
    }
  }

  function countFlags(){
    let f=0;
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (board[r][c].flagged) f++;
    return f;
  }

  function updateBombHud(){
    bombEl.textContent = `Bombs: ${NUM_MINES - countFlags()}`;
  }

  // ===== Responsive cell sizing =====
  function syncCellSizeToScreen(){
    const margin = 20;
    const w = Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0, 360);
    let cell = Math.floor((w - margin) / COLS);
    if (!Number.isFinite(cell) || cell < 14) cell = 14;
    if (cell > 32) cell = 32;
    document.documentElement.style.setProperty("--cell", `${cell}px`);
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, ${cell}px)`;
  }

  // ===== Intro lock/unlock =====
  function lockIntro(){
    gameContainer.classList.add("intro-lock");
    gameContainer.classList.remove("pan-ready");
    gameContainer.classList.remove("grabbing");
    boardEl.classList.add("intro-fit");
  }

  function unlockIntro(){
    gameContainer.classList.remove("intro-lock");
    gameContainer.classList.add("pan-ready");
    boardEl.classList.remove("intro-fit");

    // switch to normal mode: pure scale only
    boardEl.style.transform = `scale(${zoom.toFixed(4)})`;
  }

  // ===== True centered intro (translate + scale) =====
  function fitIntro(){
    requestAnimationFrame(() => {
      // measure unscaled board
      const boardW = boardEl.scrollWidth;
      const boardH = boardEl.scrollHeight;

      // available viewport for board inside container
      const viewW = gameContainer.clientWidth - 20;
      const viewH = gameContainer.clientHeight - 20;

      let z = Math.min(viewW / boardW, viewH / boardH);
      z *= 0.78; // extra zoom-out
      z = clamp(z, 0.06, 1);

      // compute translate to center VISUALLY
      const tx = Math.max(0, (viewW - boardW * z) / 2);
      const ty = Math.max(0, (viewH - boardH * z) / 2);

      // IMPORTANT: In intro, we do translate+scale on the board itself
      boardEl.style.transform = `translate(${tx}px, ${ty}px) scale(${z.toFixed(4)})`;

      // deterministic scroll (Telegram sometimes starts at weird offsets)
      gameContainer.scrollLeft = 0;
      gameContainer.scrollTop = 0;

      lockIntro();
    });
  }

  // ===== DOM build =====
  function buildFieldDOM(){
    syncHudSpaceBurst();
    syncCellSizeToScreen();

    boardEl.innerHTML = "";
    boardEl.style.gridTemplateColumns = `repeat(${COLS}, var(--cell))`;

    const frag = document.createDocumentFragment();
    for (let r=0;r<ROWS;r++){
      for (let c=0;c<COLS;c++){
        const el = document.createElement("div");
        el.className = "cell";
        el.dataset.r = String(r);
        el.dataset.c = String(c);
        frag.appendChild(el);
      }
    }
    boardEl.appendChild(frag);

    // reset camera scroll
    gameContainer.scrollLeft = 0;
    gameContainer.scrollTop = 0;

    // reset board zoom
    zoom = 1;
    zoomTarget = 1;

    hasStarted = false;
    fitIntro();

    // Telegram late layout: re-fit a couple times
    setTimeout(() => { if (!hasStarted) fitIntro(); }, 160);
    setTimeout(() => { if (!hasStarted) fitIntro(); }, 380);
  }

  // ===== Render =====
  function renderCell(el, r, c){
    const cell = board[r][c];
    el.classList.remove("revealed","flagged");
    el.textContent = "";

    if (cell.revealed){
      el.classList.add("revealed");
      el.textContent = cell.mine ? "💣" : (cell.value || "");
    } else if (cell.flagged){
      el.classList.add("flagged");
      el.textContent = "🚩";
    }
  }

  function renderAll(){
    const cells = boardEl.querySelectorAll(".cell");
    let i = 0;
    for (let r=0;r<ROWS;r++){
      for (let c=0;c<COLS;c++){
        renderCell(cells[i++], r, c);
      }
    }
    updateBombHud();
  }

  function revealAllMines(){
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (board[r][c].mine) board[r][c].revealed = true;
  }

  function lose(){
    gameOver = true;
    revealAllMines();
    renderAll();
    setTimeout(()=>alert("Game Over!"), 10);
  }

  function winCheck(){
    if (revealedCount === ROWS*COLS - NUM_MINES){
      gameOver = true;
      renderAll();
      setTimeout(()=>alert("You Win!"), 10);
    }
  }

  // ===== Actions =====
  function toggleFlag(r,c){
    const cell = board[r][c];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
  }

  function floodReveal(sr, sc){
    const stack = [[sr, sc]];
    while (stack.length){
      const [r,c] = stack.pop();
      if (!inBounds(r,c)) continue;

      const cell = board[r][c];
      if (cell.revealed || cell.flagged || cell.mine) continue;

      cell.revealed = true;
      revealedCount++;

      if (cell.value === 0){
        forEachNeighbor(r,c,(nr,nc)=>{
          const n = board[nr][nc];
          if (!n.revealed && !n.flagged) stack.push([nr,nc]);
        });
      }
    }
  }

  function reveal(r,c){
    const cell = board[r][c];
    if (cell.revealed || cell.flagged) return;

    ensureMinefieldExists();

    if (!safeZoneLocked){
      safeZoneLocked = true;
      enforceSafeZone(r,c);
      calcValues();
    }

    if (cell.mine){
      cell.revealed = true;
      lose();
      return;
    }

    if (cell.value === 0) floodReveal(r,c);
    else { cell.revealed = true; revealedCount++; }

    winCheck();
  }

  // quick helpers
  function flaggedNeighbors(r,c){
    let f=0;
    forEachNeighbor(r,c,(nr,nc)=>{ if (board[nr][nc].flagged) f++; });
    return f;
  }

  function hiddenUnflaggedNeighbors(r,c){
    const out = [];
    forEachNeighbor(r,c,(nr,nc)=>{
      const n = board[nr][nc];
      if (!n.revealed && !n.flagged) out.push([nr,nc]);
    });
    return out;
  }

  function chordReveal(r,c){
    const cell = board[r][c];
    if (!cell.revealed || cell.value <= 0) return;
    if (flaggedNeighbors(r,c) !== cell.value) return;

    const targets = hiddenUnflaggedNeighbors(r,c);
    for (const [nr,nc] of targets){
      const n = board[nr][nc];
      if (n.mine){
        n.revealed = true;
        lose();
        return;
      }
      if (n.value === 0) floodReveal(nr,nc);
      else if (!n.revealed){ n.revealed = true; revealedCount++; }
      if (gameOver) return;
    }
    winCheck();
  }

  function smartQuickAction(r, c){
    const cell = board[r][c];
    if (!cell.revealed) return false;

    const flagged = flaggedNeighbors(r, c);
    const hiddenUnflagged = hiddenUnflaggedNeighbors(r, c);

    if (cell.value > 0){
      const need = cell.value - flagged;

      if (need > 0 && need === hiddenUnflagged.length){
        for (const [nr, nc] of hiddenUnflagged) board[nr][nc].flagged = true;
        return true;
      }

      if (flagged === cell.value){
        chordReveal(r, c);
        return true;
      }
    }

    if (cell.value === 0 && hiddenUnflagged.length > 0){
      for (const [nr, nc] of hiddenUnflagged){
        reveal(nr, nc);
        if (gameOver) return true;
      }
      return true;
    }

    return false;
  }

  // ===== Zoom with anchor =====
  function setZoomTargetAnchored(newZoom, clientX, clientY){
    newZoom = clamp(newZoom, ZOOM_MIN, ZOOM_MAX);

    const rect = gameContainer.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const boardRect = boardEl.getBoundingClientRect();
    const offsetX = boardRect.left - rect.left + gameContainer.scrollLeft;
    const offsetY = boardRect.top - rect.top + gameContainer.scrollTop;

    // content point under cursor BEFORE changing zoom
    const contentX = (gameContainer.scrollLeft + x - offsetX) / zoom;
    const contentY = (gameContainer.scrollTop + y - offsetY) / zoom;


    zoomTarget = newZoom;
    startZoomAnimator();

    // move scroll based on target (feels anchored)
    gameContainer.scrollLeft = contentX * zoomTarget + offsetX - x;
    gameContainer.scrollTop  = contentY * zoomTarget + offsetY - y;

  }

  function clearHoldTimer(){
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
  }

  // ===== Input rules =====
  // BEFORE first click: no pan/zoom, only left click/tap opens
  // AFTER first click:
  //   - left click/tap opens
  //   - RMB drag pans (PC)
  //   - hold+drag pans (mobile)
  //   - wheel zoom / pinch zoom smooth

  function isLeftMouseOpen(e){
    return e.pointerType === "mouse" ? (e.button === 0) : true;
  }
  function isRightMousePan(e){
    return e.pointerType === "mouse" && e.button === 2;
  }

  // Wheel zoom (PC)
  gameContainer.addEventListener("wheel", (e) => {
    if (!hasStarted) return;
    e.preventDefault();

    const factor = Math.exp(-e.deltaY * 0.0012); // smooth
    const next = clamp(zoomTarget * factor, ZOOM_MIN, ZOOM_MAX);

    setZoomTargetAnchored(next, e.clientX, e.clientY);
    suppressTapUntil = now() + 260;
  }, { passive: false });

  // Pointer input on container (handles panning + pinch + taps)
  gameContainer.addEventListener("pointerdown", (e) => {
    if (gameOver) return;

    // Intro: ignore movement/pinch/pan setup
    if (!hasStarted) {
      pointers.clear();
      pinch = null;
      panState = null;
      clearHoldTimer();
      return;
    }

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch start
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      pinch = { startDist: Math.hypot(dx, dy), startZoom: zoomTarget };
      suppressTapUntil = now() + 300;
      clearHoldTimer();
      return;
    }

    // PC RMB pan
    if (isRightMousePan(e)) {
      panState = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: gameContainer.scrollLeft,
        startTop: gameContainer.scrollTop,
        moved: false,
        panEnabled: true
      };
      gameContainer.classList.add("grabbing");
      suppressTapUntil = now() + 300;
      try { gameContainer.setPointerCapture(e.pointerId); } catch(_) {}
      return;
    }

    // Mobile hold-to-pan
    if (e.pointerType !== "mouse") {
      panState = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: gameContainer.scrollLeft,
        startTop: gameContainer.scrollTop,
        moved: false,
        panEnabled: false
      };

      clearHoldTimer();
      holdTimer = setTimeout(() => {
        if (panState && panState.id === e.pointerId) {
          panState.panEnabled = true;
          suppressTapUntil = now() + 350;
        }
      }, HOLD_TO_PAN_MS);

      try { gameContainer.setPointerCapture(e.pointerId); } catch(_) {}
    }
  }, true);

  gameContainer.addEventListener("pointermove", (e) => {
    if (!hasStarted) return;
    if (!pointers.has(e.pointerId)) return;

    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Pinch zoom (smooth target)
    if (pointers.size === 2 && pinch) {
      e.preventDefault();
      const pts = [...pointers.values()];
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;

      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);

      const factor = dist / (pinch.startDist || dist);
      setZoomTargetAnchored(pinch.startZoom * factor, cx, cy);

      suppressTapUntil = now() + 350;
      clearHoldTimer();
      return;
    }

    // Pan
    if (panState && panState.id === e.pointerId) {
      const dx = e.clientX - panState.startX;
      const dy = e.clientY - panState.startY;

      if (!panState.moved && (dx*dx + dy*dy) > (MOVE_THRESH_PX*MOVE_THRESH_PX)) {
        panState.moved = true;
      }

      if (panState.panEnabled) {
        e.preventDefault();
        gameContainer.scrollLeft = panState.startLeft - dx;
        gameContainer.scrollTop  = panState.startTop  - dy;
        suppressTapUntil = now() + 300;
      }
    }
  }, { passive: false, capture: true });

  gameContainer.addEventListener("pointerup", (e) => {
    clearHoldTimer();

    // Intro: ONLY open on left click/tap
    if (!hasStarted) {
      if (isLeftMouseOpen(e)) {
        const target = document.elementFromPoint(e.clientX, e.clientY);
        const cellDiv = target?.closest?.(".cell");
        if (cellDiv) handleCellOpen(cellDiv, e.clientX, e.clientY);
      }
      return;
    }

    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;

    // End pan
    if (panState && panState.id === e.pointerId) {
      if (e.pointerType === "mouse") gameContainer.classList.remove("grabbing");
      const moved = panState.moved;
      const panEnabled = panState.panEnabled;
      panState = null;

      // if we panned or enabled pan -> no tap
      if (panEnabled || moved) return;
    }

    // suppress taps after any gesture
    if (now() < suppressTapUntil) return;

    // open cell ONLY on left click/tap
    if (isLeftMouseOpen(e)) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const cellDiv = target?.closest?.(".cell");
      if (cellDiv) handleCellOpen(cellDiv, e.clientX, e.clientY);
    }
  }, true);

  gameContainer.addEventListener("pointercancel", () => {
    clearHoldTimer();
    pointers.clear();
    pinch = null;
    panState = null;
    gameContainer.classList.remove("grabbing");
  }, true);

  // ===== The ONLY function that opens cells =====
  function handleCellOpen(cellDiv, clientX, clientY){
    if (gameOver) return;

    const r = parseInt(cellDiv.dataset.r, 10);
    const c = parseInt(cellDiv.dataset.c, 10);
    const cell = board[r][c];

    ensureMinefieldExists();

    // revealed -> quick action
    if (cell.revealed) {
      if (smartQuickAction(r, c)) renderAll();
      return;
    }

    // flag mode (still left click/tap)
    if (mode === "flag") {
      toggleFlag(r, c);
      renderAll();
      return;
    }

    // First click: smooth transition from intro centered transform -> normal zoom
    if (!hasStarted) {
      hasStarted = true;
      suppressTapUntil = now() + 500;

      // choose initial zoom after intro
      zoom = 1.18;
      zoomTarget = zoom;

      // nice small “pop” (keeps your intro aesthetic)
      boardEl.classList.add("intro-fit");
      boardEl.style.transition = "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)";

      // animate towards slightly bigger (still centered)
      const computed = getComputedStyle(boardEl).transform;
      // We don't parse matrix (avoid TG quirks). Just wait and switch.
      setTimeout(() => {
        // switch to normal mode
        unlockIntro();

        // set zoom immediately, then smooth animate target too
        boardEl.style.transition = "transform 120ms linear";
        boardEl.style.transform = `scale(${zoom.toFixed(4)})`;

        // center clicked cell
        try {
          cellDiv.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        } catch(_) {}

        // ensure anchor zoom is stable at click point
        setZoomTargetAnchored(zoom, clientX, clientY);
      }, 230);
    }

    reveal(r, c);
    renderAll();
  }

  // ===== UI =====
  function updateModeText(){
    toggleBtn.textContent = (mode === "reveal") ? "Switch to Flag Mode" : "Switch to Reveal Mode";
  }

  toggleBtn.addEventListener("click", () => {
    mode = (mode === "reveal") ? "flag" : "reveal";
    updateModeText();
  });

  restartBtn.addEventListener("click", () => {
    // hard reset
    createEmptyBoard();
    buildFieldDOM();
    renderAll();
    updateModeText();
  });

  // ===== INIT =====
  syncHudSpaceBurst();
  createEmptyBoard();
  buildFieldDOM();
  renderAll();
  updateModeText();
})();

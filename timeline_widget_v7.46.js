/*!
 * TD Rallies GPS (TD7) — Timeline Widget v7.46
 *
 * PURPOSE
 * Distance-based rally planning: SG and route progress, individual car dots,
 * scanner position, start delays and gap times. The host Schedule owns the
 * floating/docked card; project data remains in TD_RALLIES.
 *
 * DEVELOPMENT HISTORY (major milestones; not every experimental build)
 *
 * Pre-v7.00: Single-route simulation introduced schedule-based timing,
 *   moving cars, a distance scanner, start delays and SG separation.
 * v7.00–7.06: Two-route comparison; independent route car counts/visibility;
 *   scanner extent and route-specific waypoint offset corrections.
 * v7.07–7.10: Entrant Based Simulation using Admin SG/route allocations;
 *   individual entrant dots; manual car counts disabled in entrant mode.
 * v7.11–7.15: Arrival/departure (A/D) timings at relevant waypoints and AT;
 *   same-distance instruction/AT handling; remember entrant mode and scanner
 *   position across widget close/reopen during the session.
 * v7.16–7.24: Two-route and start-delay refinements; corrected Route 2
 *   start-delay application by v7.24.
 * v7.25–7.32: Graphic readability: lane and control-label positions, A/D and
 *   gap text, removed redundant SG-speed summary; v7.32 enlarged entrant dots.
 * v7.33: Entrant dots aligned with their route lines; separated R1 SG, Route,
 *   and R2 SG gap labels.
 * v7.34: SG-centre spacing 76px -> 90px; gap-label group moved down 6px.
 * v7.35–7.39: A/D positioning refinements. Experimental shared-coordinate
 *   v7.36–7.37 caused a regression in SG display; reverted to proven v7.35
 *   drawing logic before finalising the A/D layout in v7.39.
 * v7.40: Tuned entrant-mode A/D text into clearer pairs; preserved normal
 *   mode, car dots, lane geometry and timing calculations.
 * v7.41: R1/R2 SG Time Gap labels shown only for positive gaps below Admin's
 *   starting interval; zero/negative gaps always shown (negative in red).
 *   Route Time Gap display and timing calculations unchanged.
 * v7.42: Open Controls show L (last-car arrival) below A (first arrival),
 *   using existing entrant/route/SG car-timing information in both modes.
 * v7.43: Added this development-history header only; no functional changes.
 * v7.44: Entrant simulation builds shared SG/Rally-No departure order from
 *   day start, exact interval and Timeline delays; scanner clock stays
 *   consistent with normal mode; Admin Apply Delays is irrelevant.
 * v7.45: Two-route normal mode accumulates SG start delays consistently.
 * v7.46: Restore all SG Time Gap labels, regardless of positive gap size;
 *   negative and zero gaps retain existing display and colours.
 *
 * MAINTENANCE NOTES
 * - Do not merge TD3 and TD7 implementations without reviewing differences.
 * - SG lane spacing and text baselines are distinct; preserve approved layout.
 * - Do not alter SG detection to compensate for display offsets.
 * - Keep timing calculations separate from presentation-only changes.
 */
(function (global) {
  'use strict';
  const TLW_VERSION = '7.46';

  const _instances = new WeakMap();
  // View-state cache, backed by sessionStorage to survive Schedule page reloads.
  const _memFocus = new Map();
  const _memStartDelays = new Map();
  const _memEditedStartDelays = new Set();
  // Two-route comparison shares a single planning car count per SG.
  // Retain legacy R1/R2 persisted keys for compatibility, populated equally in comparison mode.
  // Current lane model: shared time-to-distance solver for Route 1 and Route 2.
  // AT rows add onward timing per SG; A/D labels are staggered for readability without moving lane geometry.
  const _memApplyStartDelays = new Map();
  // Retain entrant-mode selection across widget re-mounts.
  const _memEntrantMode = new Map();

  // UI-only session state. Never writes the TD_RALLIES project store.
  // Scoping by rally/day/route keeps the single-route view independent.
  const _sessionPrefix = 'TD7_TIMELINE_VIEW_v1|';
  function _sessionRead_(key){
    try {
      const raw = global.sessionStorage.getItem(_sessionPrefix + key);
      return raw == null ? null : JSON.parse(raw);
    } catch (_e) { return null; }
  }
  function _sessionWrite_(key, value){
    try { global.sessionStorage.setItem(_sessionPrefix + key, JSON.stringify(value)); } catch (_e) {}
  }

  let _styleInjected = false;

  function injectStylesOnce() {
    if (_styleInjected) return;
    _styleInjected = true;

    const css = `
/* Timeline Widget (scoped under .tlw-root) */
.tlw-root{ --bg:#f9fafb; --panel:#f5f5f7; --border:#d3d7df; --text:#111827; --accent:#2563eb; color:var(--text); font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.tlw-root *{ box-sizing:border-box; }
.tlw-widget-title{ font-size:15px; line-height:1.2; margin:0 0 8px; font-weight:600; color:#111827; }
.tlw-row{ display:flex; gap:12px; align-items:stretch; }
.tlw-panel{ background:var(--panel); border-radius:10px; border:1px solid var(--border); padding:10px 12px; }
.tlw-panel h2{ font-size:14px; margin:0 0 6px; }
.tlw-panel small{ font-size:11px; color:#6b7280; }
.tlw-panel-controls{ width:220px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; }
.tlw-panel-timeline{ flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; }

.tlw-delay-table{ width:100%; border-collapse:collapse; table-layout:fixed; }
.tlw-delay-table th,.tlw-delay-table td{ padding:4px 4px; text-align:left; white-space:nowrap; font-size:12px; }
.tlw-delay-table th{ font-weight:600; border-bottom:1px solid #e5e7eb; background:#f3f4f6; }
.tlw-delay-table th:nth-child(1), .tlw-delay-table td:nth-child(1){ width:68px; }
.tlw-delay-table td:first-child{ font-weight:600; }
.tlw-delay-table th:nth-child(2), .tlw-delay-table td:nth-child(2){ width:72px; }
.tlw-delay-table th:nth-child(3), .tlw-delay-table td:nth-child(3){ width:48px; text-align:center; padding-left:2px; padding-right:2px; }
.tlw-delay-table.tlw-route2-cars th,.tlw-delay-table.tlw-route2-cars td{ text-align:center; }
.tlw-delay-table.tlw-route2-cars th:nth-child(1), .tlw-delay-table.tlw-route2-cars td:nth-child(1){ width:72px; }
.tlw-delay-table.tlw-route2-cars th:nth-child(2), .tlw-delay-table.tlw-route2-cars td:nth-child(2){ width:58px; }
.tlw-delay-table.tlw-route2-cars th:nth-child(3), .tlw-delay-table.tlw-route2-cars td:nth-child(3){ width:58px; }

.tlw-num{ text-align:center; } /* keep spinners */
.tlw-delay-input, .tlw-cars-input{ width:44px; padding:2px 4px; font-size:12px; text-align:center; display:block; margin:0 auto; box-sizing:border-box; }

.tlw-focus{ line-height:1.4; margin-top:6px; padding:6px 8px; border-radius:8px; border:1px solid var(--border); background:#fff; min-height:34px; white-space:normal; font-size:11px; color:#111; font-weight:500; }
.tlw-summary{ font-size:11px; color:#374151; white-space:pre-line; }
.tlw-viewport{ position:relative; border-radius:10px; border:1px solid var(--border); background:#fff; overflow:hidden; padding:8px; }
.tlw-inner{ width:100%; min-width:100%; }
/* Float default enlarged; saved inline width from Schedule remains authoritative. */
body.timeline-float-open .timeline-dock:has(.tlw-root){ width:min(1200px, calc(100vw - 24px)); }
.tlw-svg{ display:block; }
.tlw-legend{ display:none; } /* hidden per v0.81 */
.tlw-scanner{ margin-top:8px; display:flex; flex-direction:column; gap:4px; }
.tlw-scanner-label{ font-size:11px; color:#4b5563; }
.tlw-range{ width:100%; }

.tlw-nav-btn{
  position:absolute; bottom:12px;
  width:32px; height:32px; border-radius:999px;
  border:1px solid #9ca3af;
  background:rgba(255,255,255,0.96);
  display:flex; align-items:center; justify-content:center;
  font-size:18px; line-height:1; cursor:pointer;
  box-shadow:0 1px 3px rgba(15,23,42,0.15);
  user-select:none;
}
.tlw-nav-btn:hover{ box-shadow:0 2px 6px rgba(15,23,42,0.25); }
.tlw-nav-btn:active{ transform:translateY(1px); }
.tlw-nav-btn.left{ left:50%; margin-left:-56px; }
.tlw-nav-btn.right{ left:50%; margin-left:24px; }

.tlw-focus-select{
  width:100%; font-size:12px;
  box-sizing:border-box;
  min-height:28px; height:28px; line-height:20px;
  padding:3px 8px;
}
.tlw-delay-section.tlw-delay-locked .tlw-delay-input{ opacity:.55; filter:grayscale(1); background:#f3f4f6; color:#6b7280; cursor:not-allowed; }
.tlw-delay-section.tlw-delay-locked .tlw-delay-input:disabled{ cursor:not-allowed; }
.tlw-delay-section.tlw-delay-locked .tlw-cars-input{ opacity:1; filter:none; background:#fff; color:#111827; cursor:text; }
.tlw-root .tlw-cars-input:disabled{ color:#9ca3af !important; -webkit-text-fill-color:#9ca3af; opacity:1; background:#f3f4f6 !important; border-color:#d1d5db; cursor:not-allowed; }
.tlw-delay-lock-note{ display:none; margin:6px 0; padding:6px 8px; border:1px solid #d1d5db; border-radius:8px; background:#f3f4f6; color:#6b7280; font-size:11px; line-height:1.3; }
.tlw-delay-section.tlw-delay-locked .tlw-delay-lock-note{ display:block; }
`;
    const st = document.createElement('style');
    st.id = 'timeline-widget-styles';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function makeTemplate(prefix) {
    // Note: IDs are prefixed to avoid collisions when multiple instances exist.
    const id = (s) => `${prefix}${s}`;
    return `
<div class="tlw-root" data-tlw-root="1">
  <div class="tlw-row">
    <div class="tlw-panel tlw-panel-controls">
      <div class="tlw-delay-section">
      <h2>Start delays</h2>
      <small>Adjust start delay per group (minutes). Blocks move along the road.</small>

      <div style="margin-top:6px; font-size:11px;">
        <label style="display:flex; align-items:center; gap:4px;">
          <input id="${id('elasticToggle')}" type="checkbox" checked>
          Apply start delays
        </label>
      </div>

      <table class="tlw-delay-table">
        <thead><tr><th>Group</th><th>Delay (min)</th><th>Cars</th></tr></thead>
        <tbody id="${id('delayTableBody')}"></tbody>
      </table>
      <div style="margin-top:8px; font-size:11px;">
        <label style="display:flex; align-items:center; gap:4px;">
          <input id="${id('showCarsToggle')}" type="checkbox" checked>
          Entrant based simulation
        </label>
      </div>
      </div>

      <h2 style="margin-top:10px;">Focus row</h2>
      <small>Select a row to centre the scanner on that point.</small>

      <div style="margin-top:4px;">
        <select id="${id('focusRowSelect')}" class="tlw-focus-select"></select>
      </div>

      <div class="tlw-focus" id="${id('focusInstruction')}" style="margin-top:6px;"></div>
      <div class="tlw-summary" id="${id('rowSummary')}" style="margin-top:8px;"></div>
      <div class="tlw-summary" id="${id('gapSummary')}" style="margin-top:4px;"></div>
    </div>

    <div class="tlw-panel tlw-panel-timeline">
      <h2>Distance lanes (30 km window) <small id="${id('laneStyleNote')}" style="font-size:11px; font-weight:500; color:inherit; margin-left:8px;">— Route 1 is shown in stronger text; Route 2 in lighter text.</small></h2>


      <div class="tlw-viewport">
        <div class="tlw-inner">
          <svg id="${id('timelineSvg')}" class="tlw-svg" width="800" height="280"></svg>
        </div>
        <div id="${id('timelinePrevBtn')}" class="tlw-nav-btn left" title="Previous waypoint" aria-label="Previous waypoint">◀</div>
        <div id="${id('timelineNextBtn')}" class="tlw-nav-btn right" title="Next waypoint" aria-label="Next waypoint">▶</div>
      </div>

      <div id="${id('legend')}" class="tlw-legend"></div>

      <div class="tlw-scanner">
        <div id="${id('scannerLabel')}" class="tlw-scanner-label">Route scanner – initialising…</div>
        <input id="${id('routeScanner')}" class="tlw-range" type="range">

        <div id="${id('timeOffsetLabel')}" class="tlw-scanner-label" style="margin-top:6px; text-align:center;">
          Time offset around this row (–20 to +20 min): 0.0 min
        </div>
        <input id="${id('timeOffsetSlider')}" type="range" min="-20" max="20" step="0.5" value="0"
               style="width:220px; margin:4px auto 0 auto; display:block;">
      </div>
    </div>
  </div>
</div>`;
  }

  function updateHostTitle(containerEl) {
    const wanted = 'Timeline - Routes 1 and 2 - Slower groups starting first';
    try {
      const scope = containerEl.closest('.modal, .dialog, .timeline-widget-wrap, .tlw-host, section, article, main') || containerEl.parentElement || document;
      const heads = Array.from(scope.querySelectorAll('h1,h2,h3'));
      const old = heads.find(h => (h.textContent || '').trim() === 'Timeline - Slower groups starting first');
      if (old) old.textContent = wanted;
    } catch (_e) {}
  }

  function createInstance(containerEl, opts) {
    injectStylesOnce();

    const prefix = `tlw_${Math.random().toString(36).slice(2)}_`;
    updateHostTitle(containerEl);
    containerEl.innerHTML = makeTemplate(prefix);

    const root = containerEl.querySelector('[data-tlw-root="1"]');

    const rallyId = (opts && opts.rallyId) ? String(opts.rallyId) : '';
    const dayKey  = (opts && opts.dayKey != null) ? String(opts.dayKey) : '1';
    // v1.33 — route-aware store read. Prefer live Schedule route selector, then opts.
    function resolveRouteKey(){
      try{
        if (global && typeof global.getScheduleRouteKey_ === 'function') {
          const n = Number(global.getScheduleRouteKey_());
          if (n === 2) return '2';
        }
      }catch(_){}
      try{
        const lbl = global.document && global.document.getElementById('routePillLabel');
        const txt = lbl ? String(lbl.textContent || '') : '';
        if (/\b2\b/.test(txt)) return '2';
      }catch(_){}
      try{
        const checked = global.document && global.document.querySelector('#routePillMenu .daydd-item[aria-checked="true"]');
        const idx = checked && checked.dataset ? Number(checked.dataset.routeIndex) : NaN;
        if (idx === 1) return '2';
      }catch(_){}
      const raw = opts && (opts.routeKey != null ? opts.routeKey : (opts.routeNo != null ? opts.routeNo : opts.route));
      const n = Number(raw || 1);
      return String(n === 2 ? 2 : 1);
    }
    let routeKey = resolveRouteKey();
    function isDelayLocked(){ return false; }
    function isRoute2CompareMode(){ return String(routeKey || '1') === '2'; }
    function applyDelayLockUi(){
      try{
        const panel = root && root.querySelector('.tlw-delay-section');
        if (!panel) return;
        panel.classList.toggle('tlw-delay-locked', isDelayLocked());
        panel.title = isDelayLocked() ? 'Start delays editable on Route 1 only' : '';
      }catch(_e){}
    }

    // Day start clock (host-owned). Admin stores HH:MM:SS; widget displays A/D as dayStart + elapsed.
    let _dayStartStr = (opts && (opts.dayStart || opts.startTime)) ? String(opts.dayStart || opts.startTime) : '00:00:00';
    let _dayStartMin = 0; // computed after parseTime is available

    const q = (id) => root.querySelector('#' + prefix + id);
    let _booting = true;

    const memKey = String((opts && opts.rallyId) || rallyId || 'demo') + '|' + String((opts && opts.dayKey) || dayKey || '1') + '|R' + String(routeKey || '1');
    const _memGet = ()=> {
      if (_memFocus.has(memKey)) return _memFocus.get(memKey);
      const saved = _sessionRead_('focus|' + memKey);
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        _memFocus.set(memKey, saved);
        return saved;
      }
      return null;
    };
    const _memSet = (st)=> {
      try{ _memFocus.set(memKey, st); }catch(_e){}
      _sessionWrite_('focus|' + memKey, st);
    };

    // Temporary view state survives a Schedule page change within this tab.
    // Use the combined Focus Row list in two-route mode, not active-route hostRows.
    function persistMemFocus(){
      try{
        const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : hostRows;
        if (!rows.length) return; // Do not overwrite a prior position during an empty initial mount.
        const st = _memGet() || {};
        const idx = (focusSelect && !focusSelect.disabled)
          ? clampInt(focusSelect.value, 0, rows.length-1) : (st.focusIdx ?? 0);
        const scanner = q('routeScanner');
        const sc = scanner ? parseFloat(scanner.value) : scannerPosKm;
        st.focusIdx = idx;
        const row = rows[idx];
        if (row && Number.isFinite(Number(row.distKm))) st.focusKm = Number(row.distKm);
        if (Number.isFinite(sc)) st.scannerPosKm = sc;
        if (Number.isFinite(windowCenterKm)) st.windowCenterKm = windowCenterKm;
        if (Number.isFinite(timeOffsetMin)) st.timeOffsetMin = timeOffsetMin;
        _memSet(st);
      }catch(_e){}
    }

    function restoreMemFocus(){
      const st = _memGet();
      if (!st) return;
      try{
        const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : hostRows;
        if (focusSelect && !focusSelect.disabled && rows.length){
          let idx = clampInt(st.focusIdx, 0, rows.length-1);
          if (Number.isFinite(st.focusKm) && Math.abs(Number(rows[idx].distKm) - st.focusKm) > 1e-6){
            const found = rows.findIndex(r => Math.abs(Number(r.distKm)-st.focusKm) < 1e-6);
            if (found >= 0) idx = found;
          }
          focusSelect.value = String(idx);
          // setupScanner must not jump back to the focus position on first repaint.
          _lastFocusIdxForWindow = idx;
        }
      }catch(_e){}
      try{
        if (Number.isFinite(st.scannerPosKm)) scannerPosKm = st.scannerPosKm;
        if (Number.isFinite(st.windowCenterKm)) windowCenterKm = st.windowCenterKm;
        if (Number.isFinite(st.timeOffsetMin)){
          timeOffsetMin = st.timeOffsetMin;
          const slider = q('timeOffsetSlider');
          if (slider) slider.value = String(timeOffsetMin);
          const label = q('timeOffsetLabel');
          if (label) label.textContent = `Time offset around this row (–20 to +20 min): ${timeOffsetMin.toFixed(1)} min`;
        }
      }catch(_e){}
    }



    const ALL_GROUPS = ['SG1', 'SG2', 'SG3', 'SG4'];

    const startDelayMemKey = String((opts && opts.rallyId) || rallyId || 'demo') + '|' + String((opts && opts.dayKey) || dayKey || '1');
    const applyStartDelayMemKey = startDelayMemKey + '|route=' + String(routeKey || '1');
    function rememberApplyStartDelays_(v){
      try{ _memApplyStartDelays.set(applyStartDelayMemKey, !!v); }catch(_e){}
    }
    function recallApplyStartDelays_(){
      try{
        if (_memApplyStartDelays.has(applyStartDelayMemKey)) return !!_memApplyStartDelays.get(applyStartDelayMemKey);
      }catch(_e){}
      return true;
    }
    function rememberStartDelay_(g, v){
      try{
        const n = Number(v);
        if (!Number.isFinite(n)) return;
        const map = _memStartDelays.get(startDelayMemKey) || {};
        map[g] = Math.max(0, Math.min(999, Math.round(n)));
        _memStartDelays.set(startDelayMemKey, map);
      }catch(_e){}
    }
    function recallStartDelay_(g){
      try{
        const map = _memStartDelays.get(startDelayMemKey);
        const n = map ? Number(map[g]) : NaN;
        return Number.isFinite(n) ? Math.max(0, Math.min(999, Math.round(n))) : null;
      }catch(_e){ return null; }
    }

    // Enabled lanes (host-controlled). SG1 + SG2 are always present; SG3/SG4 are optional.
    let _enabled = { SG3: true, SG4: true };
    function getEnabledGroups(){
      const out = ['SG1','SG2'];
      if (_enabled.SG3) out.push('SG3');
      if (_enabled.SG4) out.push('SG4');
      return out;
    }

    // Renderer colours — keyed by SG name
    // NOTE: Train dots (cars) use strokeCol + white surround; keep that logic unchanged.
    const groupStroke = { SG1:'#6d28d9', SG2:'#c58a00', SG3:'#3b82f6', SG4:'#58b879' };
    const groupStrokeOpacity = { SG1:0.75, SG2:1, SG3:1, SG4:1 };
    const groupFill   = { SG1:'#7c3aed', SG2:'#fff8cc', SG3:'#eaf2ff', SG4:'#eaf9ee' };
    const groupFillOpacity   = { SG1:0.15, SG2:1, SG3:1, SG4:1 };

    // Widget-owned controls/state
    const groupMeta = {
      SG1:{ delayMin:0, cars:5, intervalMin:1, allocCars:null },
      SG2:{ delayMin:0, cars:5, intervalMin:1, allocCars:null },
      SG3:{ delayMin:0, cars:5, intervalMin:1, allocCars:null },
      SG4:{ delayMin:0, cars:5, intervalMin:1, allocCars:null }
    };
    ALL_GROUPS.forEach(g=>{
      groupMeta[g].carsR1 = groupMeta[g].cars;
      groupMeta[g].carsR2 = groupMeta[g].cars;
    });


    // ---- Persist (DISABLED) ----
    // v1.16: The widget is READ-ONLY with respect to TD_RALLIES.
    // The host page (Schedule) is the single writer. The widget may still update its in-memory UI state.
    function schedulePersistStartDelays(){
      /* no-op (host-owned persistence) */
    }
    function persistStartDelaysNow(){
      /* no-op (host-owned persistence) */
    }

    // ---- TD_RALLIES (read-only) wiring ----
    function safeJsonParse(str){
      try { return JSON.parse(str); } catch(e){ return null; }
    }
    function readTdRallies(){
      const raw = localStorage.getItem('TD_RALLIES');
      if (!raw) return null;
      return safeJsonParse(raw);
    }
    function resolveRallyObj(td){
      if (!td || !td.rallies) return null;
      if (rallyId && td.rallies[rallyId]) return td.rallies[rallyId];
      const keys = Object.keys(td.rallies);
      if (keys.length === 1) return td.rallies[keys[0]];
      return null;
    }

    function resolveRallyEntry(td){
      if (!td || !td.rallies) return null;
      if (rallyId && td.rallies[rallyId]) return { id: rallyId, rally: td.rallies[rallyId] };
      const keys = Object.keys(td.rallies);
      if (keys.length === 1) return { id: keys[0], rally: td.rallies[keys[0]] };
      return null;
    }

    function _sgStoreKey_(g){
      const n = String(g || '').replace(/[^0-9]/g, '') || '1';
      return 'sg' + n;
    }
    function _ensureDayTimeline_(rally){
      if (!rally) return null;
      rally.schedule = rally.schedule || {};
      rally.schedule.days = rally.schedule.days || {};
      const dk = String(dayKey || '1');
      const dkNum = String(parseInt(dk, 10));
      const dayObj = rally.schedule.days[dk] || rally.schedule.days[dkNum] || (rally.schedule.days[dk] = {});
      dayObj.timeline = dayObj.timeline || {};
      return dayObj.timeline;
    }
    function persistRouteCarsToStore_(changedRouteNo, changedGroup){
      try{
        const raw = localStorage.getItem('TD_RALLIES');
        if (!raw) return;
        const td = safeJsonParse(raw);
        const entry = resolveRallyEntry(td);
        if (!entry || !entry.rally) return;
        const dayTimeline = _ensureDayTimeline_(entry.rally);
        if (!dayTimeline) return;
        dayTimeline.carsEstimate = dayTimeline.carsEstimate || {};
        dayTimeline.carsEstimateR2 = dayTimeline.carsEstimateR2 || {};
        ALL_GROUPS.forEach(g=>{
          const k = _sgStoreKey_(g);
          const meta = groupMeta[g] || {};
          const shared = clampInt(meta.carsR1 ?? meta.cars ?? 0, 0, 99);
          dayTimeline.carsEstimate[k] = shared;
          dayTimeline.carsEstimateR2[k] = isRoute2CompareMode() ? shared : clampInt(meta.carsR2 ?? meta.cars ?? 0, 0, 99);
        });
        entry.rally.timeline = entry.rally.timeline || {};
        entry.rally.timeline.days = entry.rally.timeline.days || {};
        entry.rally.timeline.days[String(dayKey || '1')] = entry.rally.timeline.days[String(dayKey || '1')] || {};
        entry.rally.timeline.days[String(dayKey || '1')].carsEstimate = Object.assign({}, dayTimeline.carsEstimate);
        entry.rally.timeline.days[String(dayKey || '1')].carsEstimateR2 = Object.assign({}, dayTimeline.carsEstimateR2);
        localStorage.setItem('TD_RALLIES', JSON.stringify(td));
        try{ window.dispatchEvent(new CustomEvent('td:rallies-updated', { detail:{ source:'timeline-widget', kind:'carsEstimate', route:String(changedRouteNo||''), group:String(changedGroup||'') } })); }catch(_e){}
      }catch(_e){}
    }
    function clampSpeed6_120(v){
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return Math.max(6, Math.min(120, Math.round(n)));
    }
    function applyExternalFromStorage(){
      try{ routeKey = resolveRouteKey(); }catch(_e){}
      try{ applyDelayLockUi(); }catch(_e){}
      const td = readTdRallies();
      const rally = resolveRallyObj(td);
      if (!rally) return;

      // A) Entrants -> allocCars (group label allocation ONLY; does NOT touch Cars inputs)
      const entrants = rally.timeline && rally.timeline.entrants;
      if (entrants) {
        const map = { '1':'SG1', '2':'SG2', '3':'SG3', '4':'SG4' };
        Object.keys(map).forEach(k=>{
          const v = Number(entrants[k]);
          if (Number.isFinite(v) && v >= 0) {
            groupMeta[map[k]].allocCars = Math.max(0, Math.min(99, Math.round(v)));
          }
        });
      }

      // A2) Timeline inputs (Delay/Cars) -> groupMeta (drives the UI table)
      const tl = rally.timeline || {};
      const dayTl = (tl.days && tl.days[dayKey]) ? tl.days[dayKey] : null;

      // Authoritative start-delay source is timeline.days[dayKey].delaysMin
      // with keys sg1/sg2/sg3/sg4. Route 2 reads these values read-only.
      function _pickSgVal_(src, k, g){
        if (!src || typeof src !== 'object') return null;
        if (src[k] != null) return src[k];
        if (src[g] != null) return src[g];
        const low = String(g).toLowerCase();
        if (src[low] != null) return src[low];
        if (src['sg' + k] != null) return src['sg' + k];
        return null;
      }
      function _resolveDelaySrc_(){
        const candidates = [];
        if (isRoute2CompareMode()) {
          candidates.push(
            dayTl && dayTl.delaysMin
          );
        }
        candidates.push(
          dayTl && dayTl.delaysMin,
          dayTl && dayTl.startDelays,
          tl && tl.delaysMin,
          tl && tl.startDelays,
          tl && tl.delays,
          tl && tl.delay,
          tl && tl.delayMin,
          tl && tl.startDelayMin
        );
        for (const src of candidates) {
          if (src && typeof src === 'object') return src;
        }
        return null;
      }
      const delaySrc = _resolveDelaySrc_();
      const schedDayForTimeline = rally.schedule && rally.schedule.days && rally.schedule.days[dayKey] ? rally.schedule.days[dayKey] : null;
      const schedDayTl = (schedDayForTimeline && schedDayForTimeline.timeline) ? schedDayForTimeline.timeline : null;
      const carsSrcR1 = (schedDayTl && (schedDayTl.carsEstimate || schedDayTl.cars || schedDayTl.carCounts || schedDayTl.carsByGroup))
        || (dayTl && (dayTl.carsEstimate || dayTl.cars || dayTl.carCounts || dayTl.carsByGroup))
        || (tl && (tl.carsEstimate || tl.cars || tl.carCounts || tl.carsByGroup))
        || null;
      const carsSrcR2 = (schedDayTl && (schedDayTl.carsEstimateR2 || schedDayTl.carsR2 || schedDayTl.route2CarsEstimate || schedDayTl.route2Cars))
        || (dayTl && (dayTl.carsEstimateR2 || dayTl.carsR2 || dayTl.route2CarsEstimate || dayTl.route2Cars))
        || (tl && (tl.carsEstimateR2 || tl.carsR2 || tl.route2CarsEstimate || tl.route2Cars))
        || null;
      const carsSrc  = carsSrcR1;

      // Always run SG mapping so Route 2 can display in-memory Route 1
      // delays even when timeline.days[dayKey] is not found in the store shape.
      const map = { '1':'SG1', '2':'SG2', '3':'SG3', '4':'SG4' };
      Object.keys(map).forEach(k=>{
        const g = map[k];
        let rawDelay = _pickSgVal_(delaySrc, k, g);
        if (_memEditedStartDelays.has(startDelayMemKey)) {
          const edited = recallStartDelay_(g);
          if (edited != null) rawDelay = edited;
        }
        if (rawDelay != null) {
          const d = Number(rawDelay);
          if (Number.isFinite(d) && d >= 0) {
            groupMeta[g].delayMin = Math.max(0, Math.min(999, Math.round(d)));
            rememberStartDelay_(g, groupMeta[g].delayMin);
          }
        }
        const rawCars = _pickSgVal_(carsSrc, k, g);
        if (rawCars != null) {
          const c = Number(rawCars);
          if (Number.isFinite(c) && c >= 0) {
            const cv = Math.max(0, Math.min(99, Math.round(c)));
            groupMeta[g].cars = cv;
            groupMeta[g].carsR1 = cv;
            if (!Number.isFinite(Number(groupMeta[g].carsR2))) groupMeta[g].carsR2 = cv;
          }
        }
        const rawCarsR2 = _pickSgVal_(carsSrcR2, k, g);
        if (rawCarsR2 != null) {
          const c2 = Number(rawCarsR2);
          if (Number.isFinite(c2) && c2 >= 0) {
            groupMeta[g].carsR2 = Math.max(0, Math.min(99, Math.round(c2)));
          }
        }
        // Comparison mode uses Route 1's planning Cars setting for BOTH routes.
        // Ignore any older separate Route 2 count; it no longer represents entrants.
        if (isRoute2CompareMode()) groupMeta[g].carsR2 = groupMeta[g].carsR1;
      });

      // v0.90 ensure widget-owned UI always refreshes after applying external state
      try{ buildDelayCarsRows(); }catch(e){}// B) Shared SG max speeds -> display only (labels). Timing uses schedule snapshot row speeds.

      // C) Schedule rows -> hostRows (route-aware from v1.32; fallback to old day.rows)
      const schedDay = rally.schedule && rally.schedule.days && rally.schedule.days[dayKey] ? rally.schedule.days[dayKey] : null;
      const schedRoute = schedDay && schedDay.routes && schedDay.routes[routeKey] ? schedDay.routes[routeKey] : null;
      const schedSrc = schedRoute || schedDay;
      const sched = schedSrc && schedSrc.rows;
      if (Array.isArray(sched)) {
        hostRows = sched.map(r => ({
  id: r.id,
  rowNo: r.rowNo,
  type: r.type,
  dist: Number(r.dist),
  distKm: Number(r.dist),
  label: (r.label != null ? r.label : r.type),
  instruction: r.instr || '',
  instr: r.instr || '',
  // per-row speeds for timing engine: prefer rowSpeedsById, else per-row sgSpeeds
  speeds: (function(){
    const byId = schedSrc && schedSrc.rowSpeedsById;
    const src = (byId && r.id && byId[r.id]) ? byId[r.id] : (r.sgSpeeds || r.speeds || null);
    if (!src) return null;
    // normalise to SG keys
    return {
      SG1: (src.SG1!=null?src.SG1:src['1']),
      SG2: (src.SG2!=null?src.SG2:src['2']),
      SG3: (src.SG3!=null?src.SG3:src['3']),
      SG4: (src.SG4!=null?src.SG4:src['4'])
    };
  })(),
  // added time seconds (one-leg only): allow atSec, or atSecBySg with numeric keys
  atSec: (r.atSec != null ? Number(r.atSec) : null),
  atSecBySg: (r.atSecBySg || null),
  atLabel: (r.atLabel != null ? String(r.atLabel) : '')
}));
        hostRows = sanitizeRowsByDist_(hostRows);
        buildFocusSelect();
        updateFocusSummary();
        if(!_booting){ renderTimeline(); }
      }

      const speeds = rally.shared && rally.shared.sg && rally.shared.sg.speeds;
      if (speeds) {
        const map = { '1':'SG1', '2':'SG2', '3':'SG3', '4':'SG4' };
        Object.keys(map).forEach(k=>{
          const clamped = clampSpeed6_120(speeds[k]);
          if (clamped != null) displaySpeedByGroup[map[k]] = clamped;
        });
      }
      try{ syncIntervalFromAdmin(); }catch(e){}
    }
    // ----


    let hostRows = []; // schedule snapshot from host
    let focusRows = []; // Route 2 compare uses a combined R1/R2 instruction focus list
    let hasAnyTimes = false; // true if any row carries real times

    // DOM
    const delayTableBody = q('delayTableBody');
    const focusSelect    = q('focusRowSelect');
    const focusInstr     = q('focusInstruction');
    const rowSummary     = q('rowSummary');
    const gapSummary     = q('gapSummary');
    const svg            = q('timelineSvg');
    const btnPrev        = q('timelinePrevBtn');
    const btnNext        = q('timelineNextBtn');

    // --- Utilities ---
    function clampInt(n, lo, hi){
      n = Number.isFinite(+n) ? Math.trunc(+n) : lo;
      if (n < lo) n = lo;
      if (n > hi) n = hi;
      return n;
    }
function sanitizeRowsByDist_(rows){
  // Ensure distKm is numeric + non-decreasing to avoid NaN/negative SVG positions.
  // Strategy: invalid dist -> previous valid (or 0 for first); enforce monotonic non-decreasing.
  if (!Array.isArray(rows)) return [];
  let last = 0;
  return rows.map((r, i)=>{
    const out = r || {};
    let d = Number(out.distKm);
    if (!Number.isFinite(d)) d = Number(out.dist);
    if (!Number.isFinite(d)) d = last;
    if (!Number.isFinite(d)) d = 0;
    if (i === 0 && d < 0) d = 0;
    if (d < last) d = last;
    out.distKm = d;
    out.dist = d;
    last = d;
    return out;
  });
}

function _markerRowsForRoute_(routeNo){
  // In Route 2 comparison view, read Route 1/2 rows for top marker rows.
  try{
    const rn = String(Number(routeNo) === 2 ? 2 : 1);
    // v7.02: comparison must not favour the currently active Schedule.
    // Read and calculate both route profiles identically from the saved day.
    // Single-route mode continues using the host snapshot unchanged.
    const td = readTdRallies();
    const rally = resolveRallyObj(td);
    const schedDay = rally && rally.schedule && rally.schedule.days && rally.schedule.days[dayKey] ? rally.schedule.days[dayKey] : null;
    const src = schedDay && schedDay.routes && schedDay.routes[rn] ? schedDay.routes[rn] : null;
    const rows = src && Array.isArray(src.rows) ? src.rows : [];
    const mapped = sanitizeRowsByDist_(rows.map(r => ({
      id: r.id,
      routePointId: r.routePointId,
      rowNo: r.rowNo,
      idx: r.idx,
      type: r.type,
      dist: Number(r.dist),
      distKm: Number(r.dist),
      label: (r.label != null ? r.label : r.type),
      instruction: r.instr || r.instruction || '',
      instr: r.instr || r.instruction || '',
      times: r.times || {},
      speeds: (function(){
        const byId = src && src.rowSpeedsById;
        const raw = (byId && r.id && byId[r.id]) ? byId[r.id] : (r.sgSpeeds || r.speeds || null);
        if (!raw) return null;
        return {
          SG1: (raw.SG1!=null?raw.SG1:raw['1']),
          SG2: (raw.SG2!=null?raw.SG2:raw['2']),
          SG3: (raw.SG3!=null?raw.SG3:raw['3']),
          SG4: (raw.SG4!=null?raw.SG4:raw['4'])
        };
      })(),
      atSec: r.atSec,
      atSecBySg: r.atSecBySg,
      atLabel: (r.atLabel != null ? String(r.atLabel) : '')
    })));
    // v7.02: Either route can contain partial/stale row.times (even just
    // the START zero), which is not evidence of a complete timing curve.
    // Build each SG's curve independently from this route's saved speeds.
    // Both comparison routes use the same reconstruction. The single-route
    // Timeline path remains untouched.
    try{ _computeTimesForRowsArray_(mapped); }catch(_e){}
    return mapped.length ? mapped : (String(routeKey || '1') === rn ? hostRows : []);
  }catch(_e){ return []; }
}

function _isInstructionFocusRow_(r){
  if (!r) return false;
  const d = Number.isFinite(Number(r.distKm)) ? Number(r.distKm) : Number(r.dist);
  return Number.isFinite(d);
}

function _buildCombinedFocusRows_(){
  // In Route 2 comparison, focus steps through all instruction rows from both routes, sorted by distance.
  if (!isRoute2CompareMode()) {
    focusRows = Array.isArray(hostRows) ? hostRows : [];
    return focusRows;
  }
  const r1 = _markerRowsForRoute_(1).filter(_isInstructionFocusRow_).map((r, i)=>Object.assign({}, r, { _focusRoute:'1', _sourceIndex:i }));
  const r2 = _markerRowsForRoute_(2).filter(_isInstructionFocusRow_).map((r, i)=>Object.assign({}, r, { _focusRoute:'2', _sourceIndex:i }));
  const all = r1.concat(r2).filter(r => Number.isFinite(Number(r.distKm)) || Number.isFinite(Number(r.dist)));
  all.sort((a,b)=>{
    const da = Number.isFinite(Number(a.distKm)) ? Number(a.distKm) : Number(a.dist);
    const db = Number.isFinite(Number(b.distKm)) ? Number(b.distKm) : Number(b.dist);
    if (Math.abs(da-db) > 1e-9) return da-db;
    return String(a._focusRoute||'1').localeCompare(String(b._focusRoute||'1'));
  });

  const merged = [];
  all.forEach(r=>{
    const d = Number.isFinite(Number(r.distKm)) ? Number(r.distKm) : Number(r.dist);
    const last = merged[merged.length-1];
    // v1.57: do not merge unrelated route rows just because they share a distance.
    // Merge only when the focused waypoint identity also matches; otherwise keep
    // adjacent same-distance entries route-owned so arrival labels can be filtered.
    const thisKey = `${String(r.type||'').toUpperCase()}|${String(displayLabel(r)||'').trim().toUpperCase()}`;
    const lastKey = last ? String(last._focusMergeKey || '') : '';
    if (last && Math.abs(Number(last.distKm)-d) < 1e-6 && lastKey === thisKey){
      last._routes = last._routes || [];
      last._routes.push(r);
      const parts = last._routes.map(x => `R${x._focusRoute} ${displayLabel(x)}`.trim()).filter(Boolean);
      last.label = parts.join(' / ');
      last.instr = last._routes.map(x => String(x.instr || x.instruction || '').trim()).filter(Boolean).join(' | ');
      last.instruction = last.instr;
    } else {
      const copy = Object.assign({}, r, { dist:d, distKm:d, _routes:[r], _focusMergeKey:thisKey });
      copy.label = `R${r._focusRoute} ${displayLabel(r)}`.trim();
      merged.push(copy);
    }
  });
  focusRows = merged;
  return focusRows;
}

function _getHostIndexForFocus_(){
  // Keep the calculation lane on the active route. If the focused waypoint is not on the active route, use the nearest existing active-route row only as a render anchor.
  const rows = Array.isArray(hostRows) ? hostRows : [];
  if (!rows.length) return 0;
  const f = getFocusRow();
  if (!f) return getFocusIdx();
  const active = String(routeKey || '1');
  const owned = Array.isArray(f._routes) ? f._routes.find(r => String(r._focusRoute) === active) : (String(f._focusRoute||active) === active ? f : null);
  if (owned && owned.id != null) {
    const byId = rows.findIndex(r => r && r.id === owned.id);
    if (byId >= 0) return byId;
  }
  const fd = Number(f.distKm);
  if (Number.isFinite(fd)) {
    let best = 0, bestDelta = Infinity;
    rows.forEach((r,i)=>{
      const d = Math.abs(Number(r.distKm) - fd);
      if (Number.isFinite(d) && d < bestDelta){ bestDelta = d; best = i; }
    });
    return best;
  }
  return getFocusIdx();
}

function syncIntervalFromAdmin(){
  // Admin-owned "incMin" (minutes between cars) -> applies to all groups for spacing.
  // Widget is read-only; this only updates in-memory intervalMin used for rendering car gaps.
  const td = readTdRallies();
  const rally = resolveRallyObj(td);
  if (!rally) return;
  const days = rally.admin && rally.admin.days;
  if (!days) return;
  const dkNum = String(parseInt(dayKey, 10));
  const dayObj = days[dayKey] || days[dkNum];
  const inc = Number(dayObj && dayObj.incMin);
  if (!Number.isFinite(inc)) return;
  const v = Math.max(0.01, Math.min(99, inc));
  ALL_GROUPS.forEach(g=>{ groupMeta[g].intervalMin = v; });
}

    function displayType(type){
      const t = (type != null) ? String(type).trim() : '';
      if (!t) return '';
      if (t === 'INSTRUCTION') return 'INST';
      return t;
    }

    function displayLabel(row){
      const r = row || {};
      const label = String(r.label || '').trim();
      if (label) return label;
      return displayType(r.type) || String(r.type || '').trim();
    }
    function getRowLabel(r){
      const km = (typeof r.dist === 'number') ? r.dist.toFixed(1) : '—';
      const rn = (r && (r.rowNo != null)) ? r.rowNo : (r && (r.idx != null) ? r.idx : '');
      const typeTxt = displayLabel(r) || '—';

      const instrFull = (r && r.instr != null) ? String(r.instr).trim() : '';
      let snippet = '';
      if (instrFull){
        const words = instrFull.split(/\s+/).filter(Boolean);
        snippet = words.slice(0, 5).join(' ');
        if (words.length > 5) snippet += '…';
      }

      return `${rn} - ${km} - ${typeTxt}${snippet ? ' - ' + snippet : ''}`.trim();
    }
    function parseTime(str){
      const s = String(str || '').trim();
      const parts = s.split(':').map(n => Number(n));
      const hh = Number.isFinite(parts[0]) ? parts[0] : 0;
      const mm = Number.isFinite(parts[1]) ? parts[1] : 0;
      const ss = Number.isFinite(parts[2]) ? parts[2] : 0;
      return (hh * 60) + mm + (ss / 60);
    }
    function formatTime(totalMinutes){
      let totalSec = Math.round((Number(totalMinutes) || 0) * 60);
      if (!Number.isFinite(totalSec)) totalSec = 0;
      if (totalSec < 0) totalSec = 0;
      const hh = Math.floor(totalSec / 3600);
      const rem = totalSec % 3600;
      const mm = Math.floor(rem / 60);
      const ss = rem % 60;
      return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
    }

    function setDayStartClock(str){
      _dayStartStr = String(str || '').trim() || '00:00:00';
      _dayStartMin = parseTime(_dayStartStr);
      renderTimeline();
      updateFocusSummary();
    }

    function formatClock(elapsedMinutes){
      return formatTime(_dayStartMin + (Number(elapsedMinutes) || 0));
    }

    // Initialize day start clock now that parseTime exists
    _dayStartMin = parseTime(_dayStartStr);

    // --- Delay / Cars table ---
    function buildDelayCarsRows(){
      // Instruction-only mode: if we have no timing data, keep UI but disable time-dependent controls.
      if (!delayTableBody) return;
      delayTableBody.innerHTML = '';
      const delayLocked = isDelayLocked();
      const route2Compare = isRoute2CompareMode();
      try{ applyDelayLockUi(); }catch(_e){}

      try{
        const table = delayTableBody.closest('table');
        if (table) table.classList.toggle('tlw-route2-cars', route2Compare);
        const headRow = table ? table.querySelector('thead tr') : null;
        if (headRow) {
          headRow.innerHTML = '<th>Group</th><th>Delay (min)</th><th>Cars</th>';
        }
      }catch(_e){}

      getEnabledGroups().forEach(g => {
        const tr = document.createElement('tr');
        tr.dataset.sg = g;
        tr.title = g;

        {
          const tdG = document.createElement('td');
          tdG.style.fontWeight = '600';
          tdG.style.fontSize = '12px';
          tdG.textContent = g + (Number.isFinite(groupMeta[g].allocCars) ? ` - ${groupMeta[g].allocCars}` : '');
          tr.appendChild(tdG);
        }

        const tdD = document.createElement('td');
        const inpD = document.createElement('input');
        inpD.className = 'tlw-num tlw-delay-input';
        inpD.type = 'number';
        inpD.min = '0';
        inpD.max = '999';
        inpD.step = '1';
        inpD.value = String(groupMeta[g].delayMin ?? 0);
        if (delayLocked) inpD.disabled = true;
        const onDelay = () => {
          groupMeta[g].delayMin = clampInt(inpD.value, 0, 999);
          rememberStartDelay_(g, groupMeta[g].delayMin);
          _memEditedStartDelays.add(startDelayMemKey);
          try{ global.dispatchEvent(new CustomEvent('td:timeline-delay-change', {detail:{key:startDelayMemKey, group:g, value:groupMeta[g].delayMin}})); }catch(_e){}
          inpD.value = String(groupMeta[g].delayMin);
          renderTimeline();
          updateFocusSummary();
        };
        inpD.addEventListener('input', onDelay);
        // v1.16: persistence is host-owned (no widget writes)
        // inpD.addEventListener('blur', schedulePersistStartDelays);
        tdD.appendChild(inpD);
        tr.appendChild(tdD);

        const tdC = document.createElement('td');
        const inpC = document.createElement('input');
        inpC.className = 'tlw-num tlw-cars-input';
        inpC.disabled = entrantMode;
        inpC.title = entrantMode ? 'Cars are taken from Admin in entrant-based simulation' : '';
        inpC.type = 'number';
        inpC.min = '0';
        inpC.max = '99';
        inpC.step = '1';
        // In comparison mode one planning count produces the same number
        // of independently positioned dots on Route 1 and Route 2.
        if (route2Compare) groupMeta[g].carsR2 = groupMeta[g].carsR1;
        inpC.value = String(route2Compare ? groupMeta[g].carsR1 : groupMeta[g].cars ?? 5);
        const onCars = () => {
          const value = clampInt(inpC.value, 0, 99);
          groupMeta[g].cars = value;
          groupMeta[g].carsR1 = value;
          groupMeta[g].carsR2 = value;
          inpC.value = String(value);
          persistRouteCarsToStore_(1, g);
          renderTimeline();
          updateFocusSummary();
        };
        inpC.addEventListener('input', onCars);
        tdC.appendChild(inpC);
        tr.appendChild(tdC);

        delayTableBody.appendChild(tr);
      });
    }

    // --- Focus list + summary ---
    function buildFocusSelect(){
      if (!focusSelect) return;
      focusSelect.innerHTML = '';

      const rows = _buildCombinedFocusRows_();
      if (!rows.length){
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '— no schedule loaded —';
        focusSelect.appendChild(opt);
        focusSelect.disabled = true;
        if (focusInstr) focusInstr.textContent = '';
        if (rowSummary) rowSummary.textContent = '';
        if (gapSummary) gapSummary.textContent = '';
        return;
      }

      focusSelect.disabled = false;
      rows.forEach((r, i)=>{
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = getRowLabel(r);
        focusSelect.appendChild(opt);
      });
      focusSelect.value = '0';
    }

    function updateFocusSummary(){
      const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : _buildCombinedFocusRows_();
      if (!rows.length || !focusSelect || focusSelect.disabled) return;
      const idx = clampInt(focusSelect.value, 0, rows.length-1);
      const row = rows[idx] || {};
      if (focusInstr) {
        const dt = displayLabel(row);
        const instr = (row.instr != null) ? String(row.instr).trim() : '';
        if (dt) {
          focusInstr.textContent = instr ? `${dt} ${instr}` : dt;
        } else {
          focusInstr.textContent = instr;
        }
      }
      if (!rowSummary) return;

      const km = (typeof row.dist === 'number') ? row.dist.toFixed(1) : '—';
      const lines = [];
      lines.push(`Selected point – ${km} km`);
      lines.push(`ETAs at selected point`);
      getEnabledGroups().forEach(g=>{
        const t = row.times && row.times[g] ? row.times[g] : '—';
        const d = groupMeta[g].delayMin ? ` (+${groupMeta[g].delayMin}m)` : '';
        lines.push(`${g}: ${t}${d}`);
      });
      rowSummary.textContent = lines.join('\n');
    }

    // --- Renderer core (from v0.81, adapted to scoped DOM) ---
    const speedKmhByGroup = { SG1: 90, SG2: 80, SG3: 70, SG4: 60 };
    // Display-only max speed per group (from Admin stub / TD_RALLIES); does NOT drive timing maths
    const displaySpeedByGroup = { SG1: 90, SG2: 80, SG3: 70, SG4: 60 };

    function updateLaneNote(){
      const el = q('laneNote');
      if (!el) return;
      const parts = getEnabledGroups().map(g=>{
        const sp = displaySpeedByGroup[g];
        return (Number.isFinite(sp) && sp>0) ? `${g} (${sp})` : g;
      });
      el.textContent = parts.join(', ');
    }



    let elasticEnabled = recallApplyStartDelays_();
    let showCars = true;
    const entrantModeKey = String(rallyId || 'demo') + '|' + String(dayKey) + '|R' + String(routeKey);
    const rememberedEntrantMode = _memEntrantMode.has(entrantModeKey)
      ? _memEntrantMode.get(entrantModeKey)
      : _sessionRead_('entrant|' + entrantModeKey);
    let entrantMode = rememberedEntrantMode === true;
    let timeOffsetMin = 0;

    let groupStats = {};

    let windowCenterKm = NaN;
    let scannerPosKm = NaN;
    let _lastFocusIdxForWindow = null;
    const windowWidthKm = 30;
    const scannerConfig = { enabled: false, min: 0, max: 0 };

    let _rendererWired = false;

    function getFocusIdx(){
      const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : _buildCombinedFocusRows_();
      if (!rows.length) return 0;
      if (!focusSelect || focusSelect.disabled) return 0;
      return clampInt(focusSelect.value, 0, rows.length - 1);
    }
    function getFocusRow(){
      const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : _buildCombinedFocusRows_();
      if (!rows.length) return null;
      let i = getFocusIdx();
      if (!Number.isFinite(i)) i = 0;
      i = Math.max(0, Math.min(rows.length - 1, i));
      return rows[i] || rows[0] || null;
    }
    function _getFocusedRouteRow_(routeNo){
      const rn = String(Number(routeNo) === 2 ? 2 : 1);
      const f = getFocusRow();
      if (!f) return null;
      if (Array.isArray(f._routes)) {
        return f._routes.find(r => String(r && r._focusRoute) === rn) || null;
      }
      return String(f._focusRoute || routeKey || '1') === rn ? f : null;
    }

    // v7.14: A/D display must resolve the route's event at the selected distance,
    // not just the particular Focus Row chosen by the navigation arrow.
    // Focus Row dropdown and the scanner's single-stop behaviour stay unchanged.
    function _getFocusedRouteTimingRow_(routeNo){
      const focus = getFocusRow();
      if (!focus) return null;
      const targetKm = Number(focus.distKm);
      if (!Number.isFinite(targetKm)) return _getFocusedRouteRow_(routeNo);
      const rn = String(Number(routeNo) === 2 ? 2 : 1);
      const entries = Array.isArray(focusRows) ? focusRows : _buildCombinedFocusRows_();
      let matching = null;
      for (const item of entries){
        if (Math.abs(Number(item.distKm) - targetKm) >= 1e-6) continue;
        const owned = Array.isArray(item._routes) ? item._routes : [item];
        for (const r of owned){
          if (String(r._focusRoute || routeKey || '1') !== rn) continue;
          if (!matching) matching = r;
          if (String(r.type || '').toUpperCase() === 'ADDED_TIME') return r;
        }
      }
      return matching;
    }

    function _speedFromRowForGroup_(row, group){
      if (!row || !row.speeds) return null;
      const v = Number(row.speeds[group]);
      return Number.isFinite(v) && v > 0 ? v : null;
    }

    function getSpeedForGroupAtFocusRoute(group, routeNo){
      // v1.52: display-only SG labels are route-owned. If the focused waypoint
      // does not belong to that route, that route does not show/update a speed.
      const owned = _getFocusedRouteRow_(routeNo);
      if (!owned) return null;
      const rowSpeed = _speedFromRowForGroup_(owned, group);
      if (rowSpeed != null) return rowSpeed;
      const displaySpeed = Number(displaySpeedByGroup[group]);
      return Number.isFinite(displaySpeed) && displaySpeed > 0 ? displaySpeed : null;
    }

    function _comparisonStartDelayMap_(routeNo){
      // v7.05: Independent route start sequences, linked SGs within each route.
      // The slowest occupied group starts at the common time reference.
      // Later groups follow the full preceding train and its existing SG delay.
      const order = getEnabledGroups().slice().reverse();
      const out = {};
      let cursor = 0;
      order.forEach(g=>{
        const cars = _carsForRouteGroup_(routeNo, g);
        if (cars <= 0) return;
        // Carry each SG delay into the next group's start, as entrant mode does.
        if (elasticEnabled) cursor += clampInt(groupMeta[g]?.delayMin ?? 0, 0, 999);
        out[g] = cursor;
        cursor += cars * _routeLaneIntervalMin_(routeNo, g);
      });
      return out;
    }

    function _startDelayByGroupForDisplay_(routeNo){
      if (isRoute2CompareMode()) return _comparisonStartDelayMap_(routeNo);
      const enabledOrder = getEnabledGroups().slice().reverse().filter(g => _carsForRouteGroup_(routeNo, g) > 0);
      const out = {};
      let cursor = 0;
      enabledOrder.forEach(g=>{
        out[g] = cursor;
        cursor += _groupReleaseSpanMin_(routeNo, g);
      });
      if (elasticEnabled) enabledOrder.forEach(g=>{ out[g] += clampInt(groupMeta[g]?.delayMin ?? 0, 0, 999); });
      return out;
    }

    function getArrivalMinForFocusRoute(group, routeNo){
      // Resolve the route's own event at a shared distance (Added Time preferred).
      const owned = _getFocusedRouteTimingRow_(routeNo);
      if (!owned || !owned.times) return null;
      const raw = owned.times[group];
      if (raw == null || String(raw).trim() === '') return null;
      const base = parseTime(raw);
      if (!Number.isFinite(base)) return null;
      const delays = _startDelayByGroupForDisplay_(routeNo);
      return base + (delays[group] || 0) + _routeLaneOffsetMin_(routeNo, group);
    }

    function getSpeedForGroupAtFocus(group){
      const fallback = speedKmhByGroup[group] || 60;
      // Existing lane engine remains active-route based for this bake.
      const rows = Array.isArray(hostRows) ? hostRows : [];
      const row = rows.length ? rows[_getHostIndexForFocus_()] : null;
      const rowSpeed = _speedFromRowForGroup_(row, group);
      return rowSpeed != null ? rowSpeed : fallback;
    }

    function computeGroupStats(){
      groupStats = {};
      getEnabledGroups().forEach(g => {
        const speedKmh = getSpeedForGroupAtFocus(g);
        let vKmPerMin = speedKmh / 60;
        if (!Number.isFinite(vKmPerMin) || vKmPerMin <= 0) vKmPerMin = 1;

        const meta = groupMeta[g] || {};
        const cars = meta.cars ?? 5;
        const intervalMin = meta.intervalMin || 1;

        let lengthKm = Math.max(0, (cars - 1)) * intervalMin * vKmPerMin;
        if (!Number.isFinite(lengthKm) || lengthKm < 0) lengthKm = 0;

        groupStats[g] = { avgKmPerMin: vKmPerMin, trainLengthKm: lengthKm, cars, intervalMin };
      });
    }


// --- Schedule timing engine (dist + per-row speeds + one-leg ADDED_TIME) ---
function _getAddedSecForRow(row, sg){
  if (!row) return 0;
  // Prefer per-SG if present, else fall back to single atSec applied to all groups.
  if (row.atSecBySg) {
    const key = (sg === 'SG1') ? '1' : (sg === 'SG2') ? '2' : (sg === 'SG3') ? '3' : '4';
    const v = row.atSecBySg[key];
    const n = Number(v);
    if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  }
  const n = Number(row.atSec);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function _getSpeedForRow(row, sg){
  if (!row || !row.speeds) return null;
  const v = Number(row.speeds[sg]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function _computeTimesForRowsArray_(rows){
  // v7.01: independent route/SG elapsed-time reconstruction for comparison.
  // Do not require optional SGs to have speeds before calculating other SGs.
  if (!Array.isArray(rows) || !rows.length) return false;
  for (let i=0; i<rows.length; i++){
    const d = Number(rows[i].distKm);
    if (!Number.isFinite(d)) return false;
    if (i && d < Number(rows[i-1].distKm) - 1e-9) return false;
  }
  let computed = false;
  for (const sg of ['SG1','SG2','SG3','SG4']){
    // Validate a complete speed profile before overwriting any of this SG's
    // stored times. A missing speed must not prevent the other SGs calculating.
    let valid = true;
    for (let i=0; i<rows.length-1; i++){
      if (_getSpeedForRow(rows[i], sg) == null){ valid = false; break; }
    }
    if (!valid) continue;
    let seconds = 0;
    rows[0].times = rows[0].times || {};
    rows[0].times[sg] = '00:00:00';
    for (let i=1; i<rows.length; i++){
      const prev = rows[i-1], cur = rows[i];
      const dd = Number(cur.distKm) - Number(prev.distKm);
      const sp = _getSpeedForRow(prev, sg);
      const legSec = (dd / sp) * 3600;
      const addSec = (String(prev.type||'') === 'ADDED_TIME') ? _getAddedSecForRow(prev, sg) : 0;
      seconds = Math.max(0, seconds + Math.max(0, legSec) + addSec);
      cur.times = cur.times || {};
      cur.times[sg] = formatTime(seconds / 60);
    }
    computed = true;
  }
  return computed;
}

function _computeRowTimesFromInputs(){
  // Computes row.times[SGn] for all rows using:
  // time[i] = time[i-1] + legTime(prevRowSpeed, dist[i]-dist[i-1]) + (addedTimeOnPrevRow)
  // Added time applies ONE-LEG ONLY (from AddedTime row to next row).
  // START_STC rows are ignored for timeline timing (treated as markers only).
  const rows = Array.isArray(hostRows) ? hostRows : [];
  if (rows.length === 0) { hasAnyTimes = false; return; }

  const sgs = ['SG1','SG2','SG3','SG4'];

  // Validate distances & monotonicity
  for (let i=0;i<rows.length;i++){
    const d = Number(rows[i].distKm);
    if (!Number.isFinite(d)) { hasAnyTimes = false; return; }
    if (i>0 && d < Number(rows[i-1].distKm) - 1e-9) { hasAnyTimes = false; return; }
  }

  // We need a usable speed on row 0 for each SG (departure speed).
  const speed0Ok = sgs.every(sg => _getSpeedForRow(rows[0], sg) != null);
  if (!speed0Ok) { hasAnyTimes = false; return; }

  // running seconds per SG
  const tSec = { SG1:0, SG2:0, SG3:0, SG4:0 };

  // init row 0
  rows[0].times = rows[0].times || {};
  sgs.forEach(sg => { rows[0].times[sg] = '00:00:00'; });

  for (let i=1;i<rows.length;i++){
    const prev = rows[i-1];
    const cur  = rows[i];

    const d0 = Number(prev.distKm);
    const d1 = Number(cur.distKm);
    const dd = d1 - d0;

    cur.times = cur.times || {};

    sgs.forEach(sg=>{
      const sp = _getSpeedForRow(prev, sg);
      if (sp == null || sp <= 0) { hasAnyTimes = false; return; }

      // leg seconds from prev->cur using prev speed
      const legSec = (dd / sp) * 3600;

      // one-leg added time from prev row if it is ADDED_TIME
      const addSec = (String(prev.type||'') === 'ADDED_TIME') ? _getAddedSecForRow(prev, sg) : 0;

      tSec[sg] = Math.max(0, tSec[sg] + Math.max(0, legSec) + addSec);
      cur.times[sg] = formatTime(tSec[sg] / 60);
    });
  }

  hasAnyTimes = true;
}
// ---

    function _routeIndexForFocus_(routeNo, rows){
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) return 0;
      const owned = _getFocusedRouteRow_(routeNo);
      if (owned){
        const si = Number(owned._sourceIndex);
        if (Number.isInteger(si) && si >= 0 && si < rows.length) return si;
        if (owned.id != null){
          const byId = rows.findIndex(r => r && r.id === owned.id);
          if (byId >= 0) return byId;
        }
      }
      const f = getFocusRow();
      const fd = f ? Number(f.distKm) : NaN;
      if (Number.isFinite(fd)){
        let best = 0, bestDelta = Infinity;
        rows.forEach((r,i)=>{
          const d = Math.abs(Number(r && r.distKm) - fd);
          if (Number.isFinite(d) && d < bestDelta){ bestDelta = d; best = i; }
        });
        return best;
      }
      return 0;
    }

    // v1.87 — In two-route comparison mode, route assignment/order comes from
    // Admin entrants rather than an assumed R1/R2 alternating pattern.
    function _adminStartPlanForGroup_(g){
      try{
        const sg = Number(String(g||'').replace(/\D+/g,''));
        if(!(sg>=1 && sg<=4)) return null;
        const raw = global.localStorage ? global.localStorage.getItem('TD_RALLIES') : null;
        const td = raw ? JSON.parse(raw) : null;
        if(!td || !td.rallies) return null;
        const rid = String(rallyId || (td.global && td.global.activeRallyId) || (td.global && td.global.lastRallyId) || Object.keys(td.rallies||{})[0] || '');
        const rally = rid && td.rallies[rid] ? td.rallies[rid] : null;
        const entries = rally && rally.admin && Array.isArray(rally.admin.entries) ? rally.admin.entries : null;
        if(!entries || !entries.length) return null;
        const rows = [];
        for(const e of entries){
          if(!e) continue;
          const esg = Number(e.speedGroup ?? e.sgIdx ?? e.sg ?? e.speed_group);
          if(esg !== sg) continue;
          const route = Number(e.route);
          if(route !== 1 && route !== 2) continue;
          const startRaw = e.startTime ?? e.time ?? e.start ?? '';
          const startMin = parseTime(String(startRaw||''));
          if(!Number.isFinite(startMin)) continue;
          const order = Number(e.index ?? e.rallyNo ?? e.no ?? rows.length+1);
          rows.push({ route, startMin, order:Number.isFinite(order)?order:rows.length+1 });
        }
        if(!rows.length) return null;
        rows.sort((a,b)=> (a.startMin-b.startMin) || (a.order-b.order));
        const groupFirst = rows[0].startMin;
        const byRoute = {1:[],2:[]};
        rows.forEach(r=>byRoute[r.route].push(r.startMin));
        return { groupFirst, byRoute };
      }catch(_e){ return null; }
    }

    function _actualGroupStartMin_(g){
      const plan = _adminStartPlanForGroup_(g);
      return plan && Number.isFinite(plan.groupFirst) ? plan.groupFirst : null;
    }

    function _actualRouteOffsetMin_(routeNo, g){
      const plan = _adminStartPlanForGroup_(g);
      if(!plan) return null;
      const arr = plan.byRoute[Number(routeNo)===2 ? 2 : 1] || [];
      if(!arr.length || !Number.isFinite(plan.groupFirst)) return null;
      return Math.max(0, arr[0] - plan.groupFirst);
    }

    function _actualRouteIntervalMin_(routeNo, g){
      const plan = _adminStartPlanForGroup_(g);
      if(!plan) return null;
      const arr = plan.byRoute[Number(routeNo)===2 ? 2 : 1] || [];
      if(arr.length < 2) return null;
      const span = arr[arr.length-1] - arr[0];
      const avg = span / (arr.length-1);
      return Number.isFinite(avg) && avg >= 0 ? avg : null;
    }

    // v7.44: Simulation is independent of Admin's Apply Start Delays switch.
    // One start queue across both routes: slowest SG first, then Rally Number.
    // Route assignment determines travel path, never the departure interval.
    function _entrantStartPlan_(){
      const td = readTdRallies();
      const rally = resolveRallyObj(td);
      const admin = rally && rally.admin;
      if (!admin) return [];
      const day = admin.days && (admin.days[String(dayKey)] || admin.days[String(parseInt(dayKey,10))]);
      const interval = Number(day && (day.incMin ?? day.increment));
      const intervalMin = Number.isFinite(interval) && interval > 0 ? interval : Number(groupMeta.SG1?.intervalMin);
      if (!Number.isFinite(intervalMin) || intervalMin <= 0) return [];
      const startRaw = String(day && (day.start ?? day.startTime) || _dayStartStr || '');
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(startRaw)) return [];
      const baseStartMin = parseTime(startRaw);
      // The day-specific Admin list contains the current SG/route allocation,
      // but its startTime field is deliberately ignored here.
      const dayRecords = admin.controls && admin.controls.days &&
        (admin.controls.days[String(dayKey)] || admin.controls.days[String(parseInt(dayKey,10))]);
      const preferred = Array.isArray(admin.entries) && admin.entries.length ? admin.entries
        : (dayRecords && Array.isArray(dayRecords.entries) ? dayRecords.entries : []);
      const seen = new Set();
      const entries = [];
      for (const e of preferred){
        if (!e) continue;
        const rallyNo = Number(e.rallyNo ?? e.no);
        const sg = Number(e.sgIdx ?? e.speedGroup ?? e.sg);
        const route = Number(e.route || 1);
        if (!Number.isInteger(rallyNo) || rallyNo < 1 || seen.has(rallyNo)) continue;
        if (!(sg >= 1 && sg <= 4) || (route !== 1 && route !== 2)) continue;
        seen.add(rallyNo);
        entries.push({ rallyNo, group:'SG'+sg, route });
      }
      const orderedGroups = getEnabledGroups().slice().reverse();
      entries.sort((a,b)=> orderedGroups.indexOf(a.group)-orderedGroups.indexOf(b.group) || a.rallyNo-b.rallyNo);
      const entrants = [];
      let cursor = baseStartMin;
      let lastGroup = null;
      for (const e of entries){
        if (e.group !== lastGroup){
          if (elasticEnabled) cursor += clampInt(groupMeta[e.group]?.delayMin ?? 0, 0, 999);
          lastGroup = e.group;
        }
        entrants.push({...e, rallyNo:String(e.rallyNo), startMin:cursor});
        cursor += intervalMin;
      }
      return entrants;
    }

    function _entrantArrivalRef_(rows, entrants, routeNo, rowIndex){
      if(!rows || !rows.length || !entrants.length) return NaN;
      const row = rows[Math.max(0,Math.min(rows.length-1,rowIndex))];
      if(!row || !row.times) return NaN;
      const origin = Math.min(...entrants.map(e=>e.startMin));
      const arrivals = entrants.filter(e=>e.route===routeNo).map(e=>{
        const t = row.times[e.group];
        return t ? parseTime(t) + e.startMin-origin : NaN;
      }).filter(Number.isFinite);
      return arrivals.length ? Math.min(...arrivals) : NaN;
    }

    function _entrantDots_(rows, entrants, routeNo, group, clockMin){
      if(!rows || !rows.length || !entrants.length || !Number.isFinite(clockMin)) return [];
      const origin = Math.min(...entrants.map(e=>e.startMin));
      const total = Number(rows[rows.length-1].distKm) || 0;
      return entrants.filter(e=>e.route===routeNo && e.group===group).map(e=>{
        const elapsed = clockMin-(e.startMin-origin);
        const state = _frontStateAtTime_(rows,group,elapsed,0,routeNo);
        return { ...e, km:Math.max(0,Math.min(total,Number(state.frontKm)||0)) };
      });
    }

    function _carsForRouteGroup_(routeNo, g){
      const meta = groupMeta[g] || {};
      if (Number(routeNo) === 1 && Number.isFinite(Number(meta.carsR1))) return clampInt(meta.carsR1, 0, 99);
      if (Number(routeNo) === 2 && Number.isFinite(Number(meta.carsR2))) return clampInt(meta.carsR2, 0, 99);
      return clampInt(meta.cars ?? 0, 0, 99);
    }

    function _routeLaneIntervalMin_(routeNo, g){
      // Planning comparison uses equal per-car intervals on both routes.
      return Math.max(0, Number(groupMeta[g]?.intervalMin ?? 1) || 1);
    }

    function _groupReleaseSpanMin_(routeNo, g){
      const base = Math.max(0, Number(groupMeta[g]?.intervalMin ?? 1) || 1);
      // Equal comparison trains are alternatives, not two sets of actual entrants.
      return _carsForRouteGroup_(routeNo, g) * base;
    }

    function _routeLaneOffsetMin_(routeNo, g){
      // The routes start together per SG; no Admin entrant allocation offset.
      return 0;
    }

    function _computeGroupStatsForRowsAtIndex_(rows, rowIndex, routeNo){
      const statsOut = {};
      rows = Array.isArray(rows) ? rows : [];
      const row = rows.length ? rows[Math.max(0, Math.min(rows.length - 1, rowIndex || 0))] : null;
      getEnabledGroups().forEach(g => {
        let speedKmh = _getSpeedForRow(row, g);
        if (speedKmh == null) speedKmh = speedKmhByGroup[g] || 60;
        let vKmPerMin = speedKmh / 60;
        if (!Number.isFinite(vKmPerMin) || vKmPerMin <= 0) vKmPerMin = 1;
        const meta = groupMeta[g] || {};
        const cars = _carsForRouteGroup_(routeNo, g);
        const intervalMin = _routeLaneIntervalMin_(routeNo, g);
        let lengthKm = Math.max(0, (cars - 1)) * intervalMin * vKmPerMin;
        if (!Number.isFinite(lengthKm) || lengthKm < 0) lengthKm = 0;
        statsOut[g] = { avgKmPerMin: vKmPerMin, trainLengthKm: lengthKm, cars, intervalMin };
      });
      return statsOut;
    }


    function _frontStateAtTime_(rows, sg, scanMin, startDelayMin, routeNo){
      // Convert scan time -> distance by walking route row-time windows.
      // AT rows add SG-specific onward delay; during that row-time window the
      // front remains at the AT distance until the following segment begins.
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) return { frontKm:0, speedKmh:(speedKmhByGroup[sg]||60), timeMin:scanMin, segmentIndex:0 };
      const firstD = Number(rows[0].distKm);
      const lastD = Number(rows[rows.length - 1].distKm);
      const startDelay = Number(startDelayMin) || 0;
      const absAt = (r) => {
        const raw = r && r.times ? r.times[sg] : null;
        const base = parseTime(raw);
        return Number.isFinite(base) ? base + startDelay : NaN;
      };
      const distAt = (r, fallback) => {
        const d = Number(r && r.distKm);
        return Number.isFinite(d) ? d : fallback;
      };
      const speedAt = (r) => {
        const sp = _getSpeedForRow(r, sg);
        return (sp != null && sp > 0) ? sp : (speedKmhByGroup[sg] || 60);
      };

      if (!Number.isFinite(scanMin)) scanMin = absAt(rows[0]);
      const firstAbs = absAt(rows[0]);
      if (!Number.isFinite(firstAbs)) return { frontKm:Number.isFinite(firstD)?firstD:0, speedKmh:speedAt(rows[0]), timeMin:scanMin, segmentIndex:0 };
      if (scanMin <= firstAbs) return { frontKm:Number.isFinite(firstD)?firstD:0, speedKmh:speedAt(rows[0]), timeMin:scanMin, segmentIndex:0 };

      for (let i=0; i<rows.length-1; i++){
        const cur = rows[i];
        const next = rows[i+1];
        const arriveCur = absAt(cur);
        const arriveNext = absAt(next);
        if (!Number.isFinite(arriveCur) || !Number.isFinite(arriveNext)) continue;
        const holdSec = (String(cur.type||'') === 'ADDED_TIME') ? _getAddedSecForRow(cur, sg) : 0;
        const departCur = arriveCur + (holdSec / 60);
        const d0 = distAt(cur, 0);
        const d1 = distAt(next, d0);
        const sp = speedAt(cur);

        if (scanMin < departCur - 1e-9){
          return { frontKm:d0, speedKmh:sp, timeMin:scanMin, segmentIndex:i, holding:true };
        }
        if (scanMin <= arriveNext + 1e-9){
          const travelMin = Math.max(0, arriveNext - departCur);
          const ratio = travelMin > 1e-9 ? Math.max(0, Math.min(1, (scanMin - departCur) / travelMin)) : 1;
          return { frontKm:d0 + ((d1 - d0) * ratio), speedKmh:sp, timeMin:scanMin, segmentIndex:i, holding:false };
        }
      }
      return { frontKm:Number.isFinite(lastD)?lastD:0, speedKmh:speedAt(rows[rows.length-1]), timeMin:scanMin, segmentIndex:rows.length-1 };
    }

    // v1.90: Each car follows the same SG route-time curve, shifted by its
    // actual departure interval. Do not approximate the group length using
    // the leading car's instantaneous speed.
    function _individualCarDistances_(rows, sg, scanMin, startDelayMin, routeNo, cars, intervalMin, totalDistKm){
      const out = [];
      const count = clampInt(cars, 0, 99);
      for (let i=0; i<count; i++){
        const state = _frontStateAtTime_(rows, sg, scanMin - i * intervalMin, startDelayMin, routeNo);
        const km = Number(state.frontKm);
        if (Number.isFinite(km)) out.push(Math.max(0, Math.min(totalDistKm, km)));
      }
      return out;
    }

    function _laneStartDelayMap_(routeNo){
      if (isRoute2CompareMode()) return _comparisonStartDelayMap_(routeNo);
      const enabledOrder = getEnabledGroups().slice().reverse().filter(g => _carsForRouteGroup_(routeNo, g) > 0);
      const out = {};
      let cursor = 0;
      enabledOrder.forEach(g=>{
        out[g] = cursor;
        cursor += _groupReleaseSpanMin_(routeNo, g);
      });
      if(elasticEnabled) enabledOrder.forEach(g=>{ out[g] += clampInt(groupMeta[g]?.delayMin ?? 0, 0, 999); });
      return out;
    }

    function _rowsHaveAnyTimes_(rows){
      return Array.isArray(rows) && rows.some(r => r && r.times && Object.values(r.times).some(v => String(v||'').trim() !== ''));
    }

    function _computePositionsForRowsAtIndex_(rows, rowIndex, statsByGroup, routeNo, sharedRefMin){
      rows = Array.isArray(rows) ? rows : [];
      if (!rows.length) return { row:null, positions:[], totalDistKm:0, viewMinKm:0, viewMaxKm:windowWidthKm, statsByGroup:statsByGroup||{} };
      rowIndex = Math.max(0, Math.min(rows.length - 1, Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : 0));
      const row = rows[rowIndex];
      const totalDistKm = rows[rows.length - 1].distKm;
      const hasTimesHere = _rowsHaveAnyTimes_(rows);
      if (!hasTimesHere){
        const dist = Number.isFinite(row.distKm) ? row.distKm : 0;
        const total = Number.isFinite(totalDistKm) ? totalDistKm : dist;
        const positions = getEnabledGroups().map(g => {
          const len = (statsByGroup[g] && Number.isFinite(statsByGroup[g].trainLengthKm)) ? statsByGroup[g].trainLengthKm : 0;
          const startKm = Math.max(0, dist - len);
          return { group: g, timeMin: 0, frontKm: dist, startKm, endKm: dist };
        });
        return { row, positions, totalDistKm: total, viewMinKm: 0, viewMaxKm: Math.max(windowWidthKm, total), statsByGroup:statsByGroup||{} };
      }
      const startDelayByGroup = _laneStartDelayMap_(routeNo);
      const absTimes = getEnabledGroups().map(g => ({
        group: g,
        absMin: parseTime((row.times||{})[g]) + (startDelayByGroup[g] || 0) + _routeLaneOffsetMin_(routeNo, g)
      }));
      const finiteAbs = absTimes.filter(t => _carsForRouteGroup_(routeNo, t.group) > 0).map(t=>t.absMin).filter(Number.isFinite);
      // v1.78: labels keep each lane's true focus-arrival time, but X position
      // is rendered at the shared reference time (the first lane arriving at
      // the focused waypoint), then each lane independently back/forward-walks
      // through its own route segments.
      const fallbackRef = Number.isFinite(Number(sharedRefMin)) ? Number(sharedRefMin) : (finiteAbs.length ? Math.min.apply(null, finiteAbs) : 0);
      const positions = getEnabledGroups().map(g => {
        const startDelay = (startDelayByGroup[g] || 0) + _routeLaneOffsetMin_(routeNo, g);
        const abs = absTimes.find(x => x.group === g);
        const scanMin = fallbackRef + timeOffsetMin;
        const state = _frontStateAtTime_(rows, g, scanMin, startDelay, routeNo);
        let frontKm = state.frontKm;
        if (!Number.isFinite(frontKm)) frontKm = row.distKm;
        if (frontKm < 0) frontKm = 0;
        if (frontKm > totalDistKm) frontKm = totalDistKm;
        const stats = statsByGroup[g] || { avgKmPerMin:1, trainLengthKm:0, cars:_carsForRouteGroup_(routeNo,g), intervalMin:_routeLaneIntervalMin_(routeNo,g) };
        const localV = Math.max(0.0001, (Number(state.speedKmh) || 60) / 60);
        stats.avgKmPerMin = localV;
        stats.trainLengthKm = Math.max(0, ((stats.cars || 0) - 1) * (stats.intervalMin || 1) * localV);
        const carKm = _individualCarDistances_(rows, g, scanMin, startDelay, routeNo,
          _carsForRouteGroup_(routeNo, g), _routeLaneIntervalMin_(routeNo, g), totalDistKm);
        const startKm = carKm.length ? Math.min(...carKm) : frontKm;
        return { group: g, timeMin: (abs && Number.isFinite(abs.absMin)) ? abs.absMin : scanMin,
          frontKm, startKm, endKm: frontKm, carKm, holding:!!state.holding };
      });
      let centreKm = windowCenterKm;
      if (!Number.isFinite(centreKm)) centreKm = row.distKm;
      const half = windowWidthKm / 2;
      let viewMinKm = centreKm - half;
      let viewMaxKm = centreKm + half;
      const total = rows[rows.length - 1].distKm;
      if (total <= windowWidthKm){ viewMinKm = 0; viewMaxKm = total; }
      else if (viewMinKm < 0){ viewMinKm = 0; viewMaxKm = windowWidthKm; }
      else if (viewMaxKm > total){ viewMaxKm = total; viewMinKm = total - windowWidthKm; }
      return { row, positions, totalDistKm, viewMinKm, viewMaxKm, statsByGroup:statsByGroup||{} };
    }

    function computePositionsForRow(rowIndex){
      const rows = hostRows;
      const row = rows[rowIndex];
      const totalDistKm = rows[rows.length - 1].distKm;
      if (!hasAnyTimes){
        const dist = Number.isFinite(row.distKm) ? row.distKm : 0;
        const total = Number.isFinite(totalDistKm) ? totalDistKm : dist;
        const positions = getEnabledGroups().map(g => {
          const len = (groupStats[g] && Number.isFinite(groupStats[g].trainLengthKm)) ? groupStats[g].trainLengthKm : 0;
          const startKm = Math.max(0, dist - len);
          return { group: g, timeMin: 0, frontKm: dist, startKm, endKm: dist };
        });
        const centreKm = dist;
        const half = windowWidthKm / 2;
        let viewMinKm = centreKm - half;
        let viewMaxKm = centreKm + half;
        if (total <= windowWidthKm){
          viewMinKm = 0;
          viewMaxKm = total;
        } else {
          if (viewMinKm < 0){
            viewMinKm = 0;
            viewMaxKm = windowWidthKm;
          } else if (viewMaxKm > total){
            viewMaxKm = total;
            viewMinKm = total - windowWidthKm;
          }
        }
        return { row, positions, totalDistKm: total, viewMinKm, viewMaxKm };
      }
      const startDelayByGroup = _laneStartDelayMap_(1);
      const absTimes = getEnabledGroups().map(g => ({
        group: g,
        absMin: parseTime((row.times||{})[g]) + (startDelayByGroup[g] || 0)
      }));

      // v1.78: labels keep each lane's true selected-row arrival time, but X
      // position is rendered at the first-arriving lane reference time. Each
      // lane then back/forward-walks independently through its own segments.
      const finiteAbs = absTimes.map(t => t.absMin).filter(Number.isFinite);
      const fallbackRef = finiteAbs.length ? Math.min.apply(null, finiteAbs) : 0;

      const positions = getEnabledGroups().map(g => {
        const abs = absTimes.find(x => x.group === g);
        const scanMin = fallbackRef + timeOffsetMin;
        const state = _frontStateAtTime_(rows, g, scanMin, startDelayByGroup[g] || 0, 1);
        let frontKm = state.frontKm;
        if (!Number.isFinite(frontKm)) frontKm = row.distKm;
        if (frontKm < 0) frontKm = 0;
        if (frontKm > totalDistKm) frontKm = totalDistKm;

        const stats = groupStats[g] || { avgKmPerMin: 1, trainLengthKm: 0, cars:(groupMeta[g]?.cars || 0), intervalMin:(groupMeta[g]?.intervalMin || 1) };
        const localV = Math.max(0.0001, (Number(state.speedKmh) || 60) / 60);
        stats.avgKmPerMin = localV;
        stats.trainLengthKm = Math.max(0, ((stats.cars || 0) - 1) * (stats.intervalMin || 1) * localV);
        const carKm = _individualCarDistances_(rows, g, scanMin, startDelayByGroup[g] || 0, 1,
          _carsForRouteGroup_(1, g), _routeLaneIntervalMin_(1, g), totalDistKm);
        const startKm = carKm.length ? Math.min(...carKm) : frontKm;

        return { group: g, timeMin: (abs && Number.isFinite(abs.absMin)) ? abs.absMin : scanMin,
          frontKm, startKm, endKm: frontKm, carKm, holding: !!state.holding };
      });

      const last = rows[rows.length - 1];
      const total = last.distKm;

      let centreKm = windowCenterKm;
      if (!Number.isFinite(centreKm)) centreKm = row.distKm;

      const half = windowWidthKm / 2;
      let viewMinKm = centreKm - half;
      let viewMaxKm = centreKm + half;

      if (total <= windowWidthKm){
        viewMinKm = 0;
        viewMaxKm = total;
      } else {
        if (viewMinKm < 0){
          viewMinKm = 0;
          viewMaxKm = windowWidthKm;
        } else if (viewMaxKm > total){
          viewMaxKm = total;
          viewMinKm = total - windowWidthKm;
        }
      }

      return { row, positions, totalDistKm, viewMinKm, viewMaxKm };

    }

    function updateSummaries(positions, row){
      if (!row || !positions || !positions.length){
        if (rowSummary) rowSummary.textContent = '';
        if (gapSummary) gapSummary.textContent = '';
        return;
      }

      const byTime = [...positions].sort((a,b) => a.timeMin - b.timeMin);
      const lines = [];
      for (let i = 0; i < byTime.length; i += 2) {
        const left = byTime[i];
        const right = byTime[i + 1];
        if (right) {
          lines.push(`${left.group}: ${formatClock(left.timeMin)}    ${right.group}: ${formatClock(right.timeMin)}`);
        } else {
          lines.push(`${left.group}: ${formatClock(left.timeMin)}`);
        }
      }
      if (rowSummary){
        rowSummary.innerHTML = `Selected point – ${row.dist.toFixed(1)} km\nETAs at selected point\n${lines.join('\n')}`;
      }
      if (gapSummary) gapSummary.textContent = '';
    }

    function _comparisonTotalDistanceKm_(){
      const lastKm = rows => {
        const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
        const km = last ? Number(last.distKm) : 0;
        return Number.isFinite(km) ? Math.max(0, km) : 0;
      };
      const activeKm = lastKm(hostRows);
      if (!isRoute2CompareMode()) return activeKm;
      return Math.max(activeKm, lastKm(_markerRowsForRoute_(1)), lastKm(_markerRowsForRoute_(2)));
    }

    function setupScanner(){
      const scanner = q('routeScanner');
      const label = q('scannerLabel');
      const rows = Array.isArray(hostRows) ? hostRows : [];

      if (!scanner || !label) return;

      if (!rows.length){
        scanner.disabled = true;
        scannerConfig.enabled = false;
        windowCenterKm = 0;
        label.textContent = 'Route scanner – no schedule loaded yet.';
        return;
      }

      // Comparison scanner must reach the finish of whichever route is longer.
      const total = _comparisonTotalDistanceKm_();

      if (total <= windowWidthKm){
        // Keep scanner alive even for short stages so panning/focus linkage still feels responsive.
        scanner.disabled = false;
        scannerConfig.enabled = true;
        scannerConfig.minCenterKm = 0;
        scannerConfig.maxCenterKm = total;
        windowCenterKm = total / 2;
        label.textContent = `Route scanner – stage is ${total.toFixed(1)} km (shorter than 30 km), full route is shown.`;
        // continue to configure scanner range below
      }

      const half = windowWidthKm / 2;
      if (total > windowWidthKm) {
        scannerConfig.minCenterKm = half;
        scannerConfig.maxCenterKm = total - half;
        scannerConfig.enabled = true;
      }

      scanner.disabled = false;
      scanner.min = 0;
      scanner.max = total;
      scanner.step = 0.1;

      const focusRow = getFocusRow() || rows[0];
      const focusIdx = getFocusIdx();

      if (_lastFocusIdxForWindow !== focusIdx) {
        _lastFocusIdxForWindow = focusIdx;
        scannerPosKm = (focusRow && Number.isFinite(focusRow.distKm)) ? focusRow.distKm : 0;
      } else {
        if (!Number.isFinite(scannerPosKm)) scannerPosKm = (Number.isFinite(windowCenterKm) ? windowCenterKm : 0);
      }

      if (!Number.isFinite(windowCenterKm)) windowCenterKm = scannerPosKm;
      windowCenterKm = Math.min(Math.max(scannerPosKm, scannerConfig.minCenterKm), scannerConfig.maxCenterKm);

      scanner.value = String(scannerPosKm);
      label.textContent = `Route scanner – position: ${scannerPosKm.toFixed(1)} km (centre ${windowCenterKm.toFixed(1)} of ${total.toFixed(1)} km)`;

      if (!scanner._tlWired) {
        scanner._tlWired = true;
        scanner.addEventListener('input', () => {
          if (!scannerConfig.enabled) return;
          const v = parseFloat(scanner.value);
          if (!Number.isFinite(v)) return;
          scannerPosKm = v;
          windowCenterKm = Math.min(Math.max(v, scannerConfig.minCenterKm), scannerConfig.maxCenterKm);
          label.textContent = `Route scanner – position: ${scannerPosKm.toFixed(1)} km (centre ${windowCenterKm.toFixed(1)} of ${total.toFixed(1)} km)`;
          renderTimeline();
          persistMemFocus();
        });
      }
    }

    function wireRendererControlsOnce(){
      if (_rendererWired) return;
      _rendererWired = true;

      try{ applyDelayLockUi(); }catch(_e){}
      const show = q('showCarsToggle');
      if (show) {
        show.checked = entrantMode;
        showCars = true;
        show.addEventListener('change', ()=>{
          entrantMode = !!show.checked;
          _memEntrantMode.set(entrantModeKey, entrantMode);
          _sessionWrite_('entrant|' + entrantModeKey, entrantMode);
          buildDelayCarsRows();
          renderTimeline();
        });
      }

      const elastic = q('elasticToggle');
      if (elastic) {
        elastic.checked = !!elasticEnabled;
        elastic.addEventListener('change', ()=>{
          elasticEnabled = !!elastic.checked;
          rememberApplyStartDelays_(elasticEnabled);
          renderTimeline();
          updateFocusSummary();
        });
      }

      const slider = q('timeOffsetSlider');
      const label = q('timeOffsetLabel');
      if (slider && label) {
        const upd = ()=>{ label.textContent = `Time offset around this row (–20 to +20 min): ${timeOffsetMin.toFixed(1)} min`; };
        timeOffsetMin = parseFloat(slider.value) || 0;
        try{ slider.value = String(Math.max(-20, Math.min(20, Number(timeOffsetMin)||0))); }catch(_e){}
        upd();
        slider.addEventListener('input', ()=>{ timeOffsetMin = parseFloat(slider.value) || 0; upd(); renderTimeline(); persistMemFocus(); });
      }

      // Resize handler scoped per instance
      const onResize = () => renderTimeline();
      window.addEventListener('resize', onResize);
      instance._cleanup.push(() => window.removeEventListener('resize', onResize));
    }

    function renderTimeline(){
      wireRendererControlsOnce();
      try{ syncIntervalFromAdmin(); }catch(e){}
      updateLaneNote();
      computeGroupStats();
      setupScanner();
      // If host did not provide times, compute them from dist+speeds+added-time.
      if (!hasAnyTimes) { try { _computeRowTimesFromInputs(); } catch(e){} }
      // v1.54: refresh combined focus rows after computed times are written to
      // hostRows, otherwise the focus-owned copies still carry empty times.
      try { _buildCombinedFocusRows_(); } catch(e){}

      while (svg.firstChild) svg.removeChild(svg.firstChild);

      const rows = Array.isArray(hostRows) ? hostRows : [];
      let rowIndex = _getHostIndexForFocus_();

      if (!rows.length){
        if (focusInstr) focusInstr.textContent = '';
        if (rowSummary) rowSummary.textContent = '';
        if (gapSummary) gapSummary.textContent = '';
        return;
      }
      if (!Number.isFinite(rowIndex)) rowIndex = 0;
      rowIndex = Math.max(0, Math.min(rows.length - 1, rowIndex));

      const liveEntrants = entrantMode ? _entrantStartPlan_() : [];
      let entrantClockMin = NaN;
      let entrantRowsR1 = null, entrantRowsR2 = null;
      let calc = null;
      let calcR1 = null, calcR2 = null;
      if (isRoute2CompareMode()) {
        const r1RowsForCalc = _markerRowsForRoute_(1);
        const r2RowsForCalc = _markerRowsForRoute_(2);
        const r1IdxForCalc = _routeIndexForFocus_(1, r1RowsForCalc);
        const r2IdxForCalc = _routeIndexForFocus_(2, r2RowsForCalc);
        const statsR1 = _computeGroupStatsForRowsAtIndex_(r1RowsForCalc, r1IdxForCalc, 1);
        const statsR2 = _computeGroupStatsForRowsAtIndex_(r2RowsForCalc, r2IdxForCalc, 2);
        calcR1 = _computePositionsForRowsAtIndex_(r1RowsForCalc, r1IdxForCalc, statsR1, 1);
        calcR2 = _computePositionsForRowsAtIndex_(r2RowsForCalc, r2IdxForCalc, statsR2, 2);
        // v7.06: The selected waypoint owns the shared comparison clock.
        // A route-specific waypoint uses its own route's arrival times;
        // a coincident/common waypoint uses Route 1 as the stable reference.
        // Do not select the earliest arrival across BOTH routes: that can
        // hold back the other route after the first route finishes.
        const focus = getFocusRow();
        const ownedRoutes = focus && Array.isArray(focus._routes)
          ? focus._routes.map(r => String(r && r._focusRoute)) : [];
        const referenceRoute = ownedRoutes.length === 1 && ownedRoutes[0] === '2' ? 2 : 1;
        const referenceCalc = referenceRoute === 2 ? calcR2 : calcR1;
        const referenceTimes = referenceCalc && Array.isArray(referenceCalc.positions)
          ? referenceCalc.positions.filter(p => _carsForRouteGroup_(referenceRoute, p.group) > 0)
              .map(p => p.timeMin).filter(Number.isFinite) : [];
        const sharedRouteRefMin = referenceTimes.length ? Math.min.apply(null, referenceTimes) : NaN;
        if (Number.isFinite(sharedRouteRefMin)) {
          calcR1 = _computePositionsForRowsAtIndex_(r1RowsForCalc, r1IdxForCalc, statsR1, 1, sharedRouteRefMin);
          calcR2 = _computePositionsForRowsAtIndex_(r2RowsForCalc, r2IdxForCalc, statsR2, 2, sharedRouteRefMin);
        }
        if (entrantMode && liveEntrants.length){
          const refRows = referenceRoute === 2 ? r2RowsForCalc : r1RowsForCalc;
          const refIdx = referenceRoute === 2 ? r2IdxForCalc : r1IdxForCalc;
          entrantClockMin = Number.isFinite(sharedRouteRefMin) ? sharedRouteRefMin : _entrantArrivalRef_(refRows, liveEntrants, referenceRoute, refIdx);
          if (!Number.isFinite(entrantClockMin)) {
            const fallbackRows = referenceRoute === 2 ? r1RowsForCalc : r2RowsForCalc;
            const fallbackIdx = referenceRoute === 2 ? r1IdxForCalc : r2IdxForCalc;
            entrantClockMin = _entrantArrivalRef_(fallbackRows, liveEntrants, referenceRoute === 2 ? 1 : 2, fallbackIdx);
          }
        }
        entrantRowsR1 = r1RowsForCalc;
        entrantRowsR2 = r2RowsForCalc;
        calc = (String(routeKey || '1') === '2' ? calcR2 : calcR1) || calcR1 || calcR2;
        if (calc) { calc._r1 = calcR1; calc._r2 = calcR2; }
      } else {
        calc = computePositionsForRow(rowIndex);
        if (entrantMode && liveEntrants.length){
          entrantRowsR1 = rows;
          entrantClockMin = Math.min(...(calc.positions || []).map(p=>p.timeMin).filter(Number.isFinite));
          if (!Number.isFinite(entrantClockMin)) entrantClockMin = _entrantArrivalRef_(rows, liveEntrants, 1, rowIndex);
        }
      }
      const positions = calc.positions;
      let viewMinKm = calc.viewMinKm, viewMaxKm = calc.viewMaxKm;
      if (isRoute2CompareMode()) {
        const total = _comparisonTotalDistanceKm_();
        if (total <= windowWidthKm) {
          viewMinKm = 0;
          viewMaxKm = Math.max(total, 1);
        } else {
          const centre = Number.isFinite(windowCenterKm) ? windowCenterKm : 0;
          viewMinKm = Math.max(0, Math.min(centre - windowWidthKm / 2, total - windowWidthKm));
          viewMaxKm = viewMinKm + windowWidthKm;
        }
      }
      const focusRowForDisplay = getFocusRow();
      const row = focusRowForDisplay || calc.row;

      const viewport = root.querySelector('.tlw-viewport');
      let viewportWidth = viewport ? viewport.clientWidth : 800;
      if (viewportWidth < 400) viewportWidth = 400;

      const innerPadding = 16;
      const drawingWidth = Math.max(500, viewportWidth - innerPadding);

      const leftMargin = 70;
      const rightMargin = 70;
      const laneSpacing = 90;
      const topMargin = 54; // v7.27: raise entire plot; retain room for staggered control headings

      const kmSpan = Math.max(1, viewMaxKm - viewMinKm);
      const pxPerKm = (drawingWidth - leftMargin - rightMargin) / kmSpan;

      const width = drawingWidth;
      const height = topMargin + laneSpacing * getEnabledGroups().length + 54;

      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

      const NS = 'http://www.w3.org/2000/svg';
      const laneY = gIndex => topMargin + 30 + laneSpacing * gIndex;
      const distToX = d => leftMargin + (d - viewMinKm) * pxPerKm;

      function line(x1,y1,x2,y2,opts={}){
        const el = document.createElementNS(NS,'line');
        el.setAttribute('x1', x1);
        el.setAttribute('y1', y1);
        el.setAttribute('x2', x2);
        el.setAttribute('y2', y2);
        if (opts.stroke) el.setAttribute('stroke', opts.stroke);
        if (opts.strokeWidth) el.setAttribute('stroke-width', opts.strokeWidth);
        if (opts.dash) el.setAttribute('stroke-dasharray', opts.dash);
        svg.appendChild(el);
        return el;
      }
      function text(x,y,txt,opts={}){
        const el = document.createElementNS(NS,'text');
        el.setAttribute('x', x);
        el.setAttribute('y', y);
        el.textContent = txt;
        el.setAttribute('font-size', opts.size || 10);
        el.setAttribute('fill', opts.fill || '#374151');
        if (opts.weight) el.setAttribute('font-weight', opts.weight);
        if (opts.anchor) el.setAttribute('text-anchor', opts.anchor);
        svg.appendChild(el);
        return el;
      }
      function rect(x,y,w,h,opts={}){
        const el = document.createElementNS(NS,'rect');
        el.setAttribute('x', x);
        el.setAttribute('y', y);
        el.setAttribute('width', w);
        el.setAttribute('height', h);
        el.setAttribute('rx', opts.rx || 8);
        if (opts.fill) el.setAttribute('fill', opts.fill);
        if (opts.fillOpacity != null) el.setAttribute('fill-opacity', opts.fillOpacity);
        if (opts.stroke) el.setAttribute('stroke', opts.stroke);
        if (opts.strokeWidth) el.setAttribute('stroke-width', opts.strokeWidth);
        if (opts.strokeOpacity != null) el.setAttribute('stroke-opacity', opts.strokeOpacity);
        svg.appendChild(el);
        return el;
      }
      function circle(x,y,r,opts={}){
        const el = document.createElementNS(NS,'circle');
        el.setAttribute('cx', x);
        el.setAttribute('cy', y);
        el.setAttribute('r', r);
        if (opts.fill) el.setAttribute('fill', opts.fill);
        if (opts.stroke) el.setAttribute('stroke', opts.stroke);
        if (opts.strokeWidth) el.setAttribute('stroke-width', opts.strokeWidth);
        svg.appendChild(el);
        return el;
      }

      const gridTop = topMargin - 12;
      const gridBottom = height - 50;

      const firstTick = Math.ceil(viewMinKm / 5) * 5;
      for (let d = firstTick; d <= viewMaxKm + 0.001; d += 5){
        const x = distToX(d);
        line(x, gridTop, x, gridBottom, { stroke:'#e5e7eb', strokeWidth:1 });
        text(x, gridBottom + 14, d.toFixed(0) + ' km', { anchor:'middle', size:9, fill:'#6b7280' });
      }
      text(width - 10, gridBottom + 28, 'Distance along route (km)', { anchor:'end', size:10, fill:'#6b7280' });

      const route2CompareRender = isRoute2CompareMode();
      getEnabledGroups().forEach((g, i) => {
        const y = laneY(i);
        if (route2CompareRender) {
          const totalH = 40, r1H = 14, gapH = 8, r2H = 10;
          const yR1 = y - totalH/2 + r1H/2;
          const yR2 = y + totalH/2 - r2H/2;
          line(distToX(viewMinKm), yR1, distToX(viewMaxKm), yR1, { stroke:'#e5e7eb', strokeWidth:1 });
          line(distToX(viewMinKm), yR2, distToX(viewMaxKm), yR2, { stroke:'#eef2f7', strokeWidth:1 });

          const speedR1 = getSpeedForGroupAtFocusRoute(g, 1);
          const speedR2 = getSpeedForGroupAtFocusRoute(g, 2);
          const txtR1 = Number.isFinite(speedR1) && speedR1 > 0 ? `${g} · ${Math.round(speedR1)}` : g;
          const txtR2 = Number.isFinite(speedR2) && speedR2 > 0 ? `${g} · ${Math.round(speedR2)}` : g;

          // Compact left SG hierarchy aligned to the split Route 1 / Route 2 lanes.
          text(12, yR1 + 3, txtR1, { size:9, fill:'#111827', weight:'600' });
          text(12, yR2 + 3, txtR2, { size:9, fill:'#4b5563', weight:'400' });
        } else {
          line(distToX(viewMinKm), y, distToX(viewMaxKm), y, { stroke:'#e5e7eb', strokeWidth:1 });
          const speed = getSpeedForGroupAtFocus(g);
          const speedTxt = (Number.isFinite(speed) && speed > 0) ? String(Math.round(speed)) : '';
          const label = speedTxt ? `${g} · ${speedTxt}` : g;
          text(12, y + 3, label, { size:12, fill:'#111827', weight:'600' });
        }
      });

      function markerStyleForRow(r){
        const type = String((r && r.type) || '').toUpperCase();
        const name = String((r && (r.label || r.waypoint || r.instruction || r.type)) || '').trim();
        let stroke = '#9ca3af', strokeWidth = 1, dash = '3 3', textFill = '#374151';

        // Type-first classification (label is fallback only when type is missing/unknown)
        if (type === 'MARSHAL' || (!type && /Marshal/i.test(name))){
          stroke = '#dc2626'; strokeWidth = 1.5; dash = '4 4'; textFill = '#b91c1c';
        } else if (type === 'STC' || /STC/.test(type) || (!type && /STC/i.test(name))){
          stroke = '#6b7280'; strokeWidth = 2; dash = '4 4'; textFill = '#374151';
        } else if (type === 'ADDED_TIME' || (!type && /ADDED\s*TIME|Added\s*Time|\bAT\b/i.test(name))){
          stroke = '#f59e0b'; strokeWidth = 2.5; dash = '4 4'; textFill = '#f59e0b';
        } else if (type === 'OPEN' || /OPEN\s*CONTROL/.test(type) || /OPEN.*CONTROL/.test(type) || type === 'OC' || /OPEN\s*CONTROL|\bOC\b/i.test(name)){
          stroke = '#059669'; strokeWidth = 2; dash = '4 4'; textFill = '#047857';
        } else if (type === 'START_STC' || type === 'START STC' || type === 'SSTC' || /START\s*STC|\bSSTC\b/i.test(name)){
          stroke = '#2563eb'; strokeWidth = 2; dash = '4 4'; textFill = '#1d4ed8';
        }
        return { stroke, strokeWidth, dash, textFill };
      }

      // Graphic only: one visible marker per distance, with Added Time above Instruction.
      // Do not alter focusRows or the Schedule's original waypoint records.
      function graphicMarkerRows_(markerRows){
        const byDistance = new Map();
        (Array.isArray(markerRows) ? markerRows : []).forEach(r => {
          const d = Number(r && (r.distKm != null ? r.distKm : r.dist));
          if (!Number.isFinite(d)) return;
          const key = d.toFixed(6);
          const priority = String(r.type || '').toUpperCase() === 'ADDED_TIME' ? 100
            : String(r.type || '').toUpperCase() === 'INSTRUCTION' ? 0 : 50;
          const old = byDistance.get(key);
          if (!old || priority > old.priority) byDistance.set(key, { row:r, priority });
        });
        return Array.from(byDistance.values()).map(v => v.row);
      }

      const usedMarkerLabels = [[], []];
      function drawTopMarkersForRows(markerRows, labelY, visual){
        const opacity = visual && visual.opacity != null ? visual.opacity : 1;
        const fontSize = visual && visual.size ? visual.size : 9;
        const fontWeight = visual && visual.weight ? visual.weight : null;
        const tickTop = visual && visual.tickTop != null ? visual.tickTop : (labelY + 4);
        const tickBottom = visual && visual.tickBottom != null ? visual.tickBottom : (labelY + 10);
        const labelBand = visual && visual.band === 2 ? 1 : 0;
        graphicMarkerRows_(markerRows).forEach(r => {
          if (r.dist < viewMinKm - 0.001 || r.dist > viewMaxKm + 0.001) return;
          const x = distToX(r.dist);
          const style = markerStyleForRow(r);
          const tick = line(x, tickTop, x, tickBottom, { stroke:style.stroke, strokeWidth:style.strokeWidth, dash:style.dash || undefined });
          if (tick && opacity !== 1) tick.setAttribute('opacity', opacity);
          const t = String((r && r.type) || '').toUpperCase();
          const markText = String((r && (r.label || r.waypoint || r.instruction || '')) || '');
          const isATrow = (t === 'ADDED_TIME') || /ADDED\s*TIME|\bAT\b/i.test(markText);
          const isStc = (t === 'STC') || /\bSTC\b/i.test(markText);
          const isMarshal = (t === 'MARSHAL') || /\bMARSHAL\b/i.test(markText);
          const isOC = (t === 'OPEN' || /OPEN\s*CONTROL/.test(t) || /OPEN.*CONTROL/.test(t) || (t === 'OC') || /OPEN\s*CONTROL|\bOC\b/i.test(markText));
          const isStartStc = (t === 'START_STC') || (t === 'START STC') || (t === 'SSTC') || /START\s*STC|\bSSTC\b/i.test(markText);
          if (isATrow || isStc || isMarshal || isOC || isStartStc){
            const atTxt = (r && r.atLabel != null) ? String(r.atLabel).trim() : '';
            const lbl = isATrow ? (atTxt ? ('AT ' + atTxt) : 'AT') : (displayLabel(r) || (isOC ? 'OC' : (isStartStc ? 'SSTC' : r.label)));
            // Stagger close control headings within each route's label band.
            // The tick retains its exact Schedule distance.
            const approxW = Math.max(18, lbl.length * fontSize * 0.58);
            let placedY = labelY;
            for (let tier = 0; tier < 3; tier++) {
              const candidateY = labelY - tier * 8;
              if (!usedMarkerLabels[labelBand].some(v => v.y === candidateY && Math.abs(v.x - x) < (v.w + approxW)/2 + 5)) {
                placedY = candidateY; break;
              }
              placedY = candidateY;
            }
            usedMarkerLabels[labelBand].push({x, y:placedY, w:approxW});
            const tx = text(x, placedY, lbl, { anchor:'middle', size:fontSize, fill:style.textFill, weight:fontWeight });
            if (tx && opacity !== 1) tx.setAttribute('opacity', opacity);
          }
        });
      }

      const markerLineTop = isRoute2CompareMode() ? (gridTop + 28) : (gridTop + 2);
      if (isRoute2CompareMode()){
        // v1.49: two-row label band. Labels stay above marker lines; Route 1 is more prominent.
        const markerTickTop = gridTop - 1;
        const markerTickBottom = gridTop + 5;
        drawTopMarkersForRows(_markerRowsForRoute_(1), gridTop - 23, { band:1, opacity:1, size:10, weight:'700', tickTop:markerTickTop, tickBottom:markerTickBottom });
        drawTopMarkersForRows(_markerRowsForRoute_(2), gridTop - 7, { band:2, opacity:0.78, size:9, weight:'500', tickTop:markerTickTop, tickBottom:markerTickBottom });
      } else {
        drawTopMarkersForRows(rows, gridTop - 15, { opacity:1 });
      }

      const xRow = distToX(row.dist);
      // Focus marker line: follow the row's waypoint type style (no blanket orange override)
      const coincidentAT = (isRoute2CompareMode()
        ? _markerRowsForRoute_(1).concat(_markerRowsForRoute_(2)) : rows)
        .find(r => String((r && r.type) || '').toUpperCase() === 'ADDED_TIME'
          && Math.abs(Number(r.dist) - Number(row.dist)) < 1e-6);
      const fStyle = markerStyleForRow(coincidentAT || row);
      line(xRow, markerLineTop, xRow, gridBottom, { stroke:fStyle.stroke, strokeWidth:Math.max(2.5, fStyle.strokeWidth), dash:fStyle.dash || undefined });

      const laneIndexMap = {};
      getEnabledGroups().forEach((g, i) => { laneIndexMap[g] = i; });

      const blockHeight = 24;
      function drawTrainBlock(pos, yCenter, blockH, carsOverride, visual){
        const stats = (visual && visual.statsByGroup && visual.statsByGroup[pos.group]) || groupStats[pos.group] || {};
        const cars = clampInt((carsOverride != null ? carsOverride : stats.cars), 0, 99);
        if (cars === 0) return;
        const yTop = yCenter - blockH / 2;
        const visStartKm = Math.max(pos.startKm, viewMinKm);
        const visEndKm = Math.max(visStartKm, Math.min(pos.frontKm, viewMaxKm));

        const xStart = distToX(visStartKm);
        const xEnd = distToX(Math.min(pos.frontKm, viewMaxKm));
        const widthPx = Math.max(8, (visEndKm - visStartKm) * pxPerKm);

        const strokeCol = (groupStroke[pos.group] || '#0f172a');
        const fillCol = (groupFill[pos.group] || strokeCol);
        const fillOpBase = (groupFillOpacity && groupFillOpacity[pos.group] != null) ? groupFillOpacity[pos.group] : 1;
        const strokeOpBase = (groupStrokeOpacity && groupStrokeOpacity[pos.group] != null) ? groupStrokeOpacity[pos.group] : 1;
        const fillOp = fillOpBase * (visual && visual.opacity != null ? visual.opacity : 1);
        const strokeOp = strokeOpBase * (visual && visual.opacity != null ? visual.opacity : 1);
        rect(xStart, yTop, widthPx, blockH, { fill:fillCol, fillOpacity:fillOp, stroke:strokeCol, strokeWidth:0.4, strokeOpacity:strokeOp });

        const dotR = (visual && visual.dotR) || 4;
        if (showCars && cars && cars > 1) {
          const carPositions = Array.isArray(pos.carKm) ? pos.carKm : [];
          for (const carKm of carPositions) {
            if (carKm < viewMinKm - 1e-3 || carKm > viewMaxKm + 1e-3) continue;
            circle(distToX(carKm), yCenter, dotR,
              { fill:strokeCol, stroke:'white', strokeWidth:Math.max(1.3, dotR/2) });
          }
        }
        circle(xEnd, yCenter, dotR, { fill:'white', stroke:strokeCol, strokeWidth:Math.max(1.3, dotR/2) });
      }

      if (entrantMode) {
        const clock = entrantClockMin + timeOffsetMin;
        getEnabledGroups().forEach(g=>{
          const yCenter = laneY(laneIndexMap[g] ?? 0);
          // Match the actual route-line Y positions defined by the lane grid.
          // Route 1: y - 13; Route 2: y + 15.
          const routeDefs = route2CompareRender
            ? [{n:1, y:yCenter-13, rows:entrantRowsR1, opacity:1},
               {n:2, y:yCenter+15, rows:entrantRowsR2, opacity:0.72}]
            : [{n:1,y:yCenter,rows:entrantRowsR1,opacity:1}];
          routeDefs.forEach(def=>{
            const dots = _entrantDots_(def.rows,liveEntrants,def.n,g,clock);
            dots.forEach(dot=>{
              if(dot.km < viewMinKm-1e-3 || dot.km > viewMaxKm+1e-3) return;
              const c = circle(distToX(dot.km),def.y,def.n===1?5.8:5.1,
                {fill:groupStroke[g] || '#111827',stroke:'white',strokeWidth:1.5,fillOpacity:def.opacity});
              const title = document.createElementNS(NS,'title');
              title.textContent = `Car ${dot.rallyNo} · ${g} · Route ${def.n} · ${formatTime(dot.startMin)}`;
              c.appendChild(title);
            });
          });
        });
      } else if (route2CompareRender) {
        const positionsR1 = (calcR1 && Array.isArray(calcR1.positions)) ? calcR1.positions : [];
        const positionsR2 = (calcR2 && Array.isArray(calcR2.positions)) ? calcR2.positions : [];
        getEnabledGroups().forEach(g => {
          const laneIndex = laneIndexMap[g] ?? 0;
          const yCenter = laneY(laneIndex);
          const totalH = 40, r1H = 14, r2H = 10;
          const yR1 = yCenter - totalH/2 + r1H/2;
          const yR2 = yCenter + totalH/2 - r2H/2;
          const gm = groupMeta[g] || {};
          const posR1 = positionsR1.find(p => p && p.group === g);
          const posR2 = positionsR2.find(p => p && p.group === g);
          if (posR1 && _carsForRouteGroup_(1, g) > 0) drawTrainBlock(posR1, yR1, r1H, gm.carsR1, { opacity:1, dotR:3.5, statsByGroup:(calcR1 && calcR1.statsByGroup) });
          if (posR2 && _carsForRouteGroup_(2, g) > 0) drawTrainBlock(posR2, yR2, r2H, gm.carsR2, { opacity:0.72, dotR:3, statsByGroup:(calcR2 && calcR2.statsByGroup) });
        });
      } else {
        positions.forEach(pos => {
          const laneIndex = laneIndexMap[pos.group] ?? 0;
          const yCenter = laneY(laneIndex);
          drawTrainBlock(pos, yCenter, blockHeight, null, { opacity:1, dotR:4 });
        });
      }

      const etaX = xRow + 8;
      // OC last-car time uses the same entrant starts / normal lane interval
      // as the simulated dots. Route and SG are always kept separate.
      const isOpenControlRow = r => {
        const t = String(r && r.type || '').toUpperCase();
        const label = String(r && r.label || '');
        return t === 'OPEN' || t === 'OC' || /OPEN\s*CONTROL/.test(t)
          || /OPEN.*CONTROL/.test(t) || /OPEN\s*CONTROL|\bOC\b/i.test(label);
      };
      if (entrantMode) {
        // v7.12: A/D is route-owned even in entrant mode.  Each A belongs to
        // the earliest actual entrant on that route/SG, keeping missing
        // alternate-route entrants as real gaps rather than renumbering dots.
        // D at an Added Time row applies that route/SG's allowance to its A.
        getEnabledGroups().forEach(g => {
          const laneIndex = laneIndexMap[g] ?? 0;
          const yCenter = laneY(laneIndex);
          const totalH = 40, r1H = 14, r2H = 10;
          const laneDefs = route2CompareRender
            ? [{route:1, y:yCenter-totalH/2+r1H/2},
               {route:2, y:yCenter+totalH/2-r2H/2}]
            : [{route:1, y:yCenter}];
          laneDefs.forEach(({route:rn, y}) => {
            const focusedRow = route2CompareRender ? _getFocusedRouteTimingRow_(rn) : rows[rowIndex];
            if (!focusedRow || !focusedRow.times) return;
            const rawElapsed = focusedRow.times[g];
            if (rawElapsed == null || String(rawElapsed).trim() === '') return;
            const elapsed = parseTime(rawElapsed);
            if (!Number.isFinite(elapsed)) return;
            const routeEntrants = liveEntrants.filter(e => e.route === rn && e.group === g);
            if (!routeEntrants.length) return;
            const arrivals = routeEntrants.map(e => e.startMin + elapsed);
            const firstArrival = Math.min(...arrivals);
            const lastArrival = Math.max(...arrivals);
            const isOC = isOpenControlRow(focusedRow);
            const isAT = String(focusedRow.type || focusedRow.label || '').toUpperCase() === 'ADDED_TIME';
            // Two route lanes are 28px apart. Keep each 11px A/D pair snugly
            // above/below its own route line without colliding with the next pair.
            const yA = route2CompareRender ? y + 5 : (isAT ? y - 2 : y + 6);
            const yD = route2CompareRender ? y + 18 : y + 12;
            text(etaX, yA, 'A ' + formatTime(firstArrival),
              {size:11, fill:rn === 1 ? '#111827' : '#4b5563', weight:'500', anchor:'start'});
            if (isOC) {
              text(etaX, yD, 'L ' + formatTime(lastArrival),
                {size:11, fill:rn === 1 ? '#111827' : '#4b5563', weight:'500', anchor:'start'});
            }
            if (isAT) {
              const departure = firstArrival + ((_getAddedSecForRow(focusedRow,g) || 0)/60);
              text(etaX, yD, 'D ' + formatTime(departure),
                {size:11, fill:rn === 1 ? '#111827' : '#4b5563', weight:'500', anchor:'start'});
            }
          });
        });
      } else if (route2CompareRender) {
        // v1.54: route-owned arrival labels, aligned to the split lane centres.
        getEnabledGroups().forEach(g => {
          const laneIndex = laneIndexMap[g] ?? 0;
          const yCenter = laneY(laneIndex);
          const totalH = 40, r1H = 14, r2H = 10;
          const yR1 = yCenter - totalH/2 + r1H/2;
          const yR2 = yCenter + totalH/2 - r2H/2;
          const arrR1 = getArrivalMinForFocusRoute(g, 1);
          const arrR2 = getArrivalMinForFocusRoute(g, 2);
          const rowR1 = _getFocusedRouteTimingRow_(1);
          const rowR2 = _getFocusedRouteTimingRow_(2);
          const isOCR1 = isOpenControlRow(rowR1);
          const isOCR2 = isOpenControlRow(rowR2);
          const isATR1 = rowR1 && (String(rowR1.type || rowR1.label || '').toUpperCase() === 'ADDED_TIME');
          const isATR2 = rowR2 && (String(rowR2.type || rowR2.label || '').toUpperCase() === 'ADDED_TIME');
          if (arrR1 != null && _carsForRouteGroup_(1, g) > 0) {
            if (isATR1) {
              const depR1 = arrR1 + ((_getAddedSecForRow(rowR1, g) || 0) / 60);
              text(etaX, yR1 - 10, 'A ' + formatClock(arrR1), { size:11, fill:'#111827', weight:'500', anchor:'start' });
              text(etaX, yR1 + 4, 'D ' + formatClock(depR1), { size:11, fill:'#111827', weight:'500', anchor:'start' });
            } else if (isOCR1) {
              const lastR1 = arrR1 + (Math.max(0, _carsForRouteGroup_(1,g)-1) * _routeLaneIntervalMin_(1,g));
              text(etaX, yR1 - 10, 'A ' + formatClock(arrR1), { size:11, fill:'#111827', weight:'500', anchor:'start' });
              text(etaX, yR1 + 4, 'L ' + formatClock(lastR1), { size:11, fill:'#111827', weight:'500', anchor:'start' });
            } else {
              text(etaX, yR1 + 4, 'A ' + formatClock(arrR1), { size:11, fill:'#111827', weight:'500', anchor:'start' });
            }
          }
          if (arrR2 != null && _carsForRouteGroup_(2, g) > 0) {
            if (isATR2) {
              const depR2 = arrR2 + ((_getAddedSecForRow(rowR2, g) || 0) / 60);
              text(etaX, yR2 - 10, 'A ' + formatClock(arrR2), { size:11, fill:'#4b5563', weight:'500', anchor:'start' });
              text(etaX, yR2 + 4, 'D ' + formatClock(depR2), { size:11, fill:'#4b5563', weight:'500', anchor:'start' });
            } else if (isOCR2) {
              const lastR2 = arrR2 + (Math.max(0, _carsForRouteGroup_(2,g)-1) * _routeLaneIntervalMin_(2,g));
              text(etaX, yR2 - 10, 'A ' + formatClock(arrR2), { size:11, fill:'#4b5563', weight:'500', anchor:'start' });
              text(etaX, yR2 + 4, 'L ' + formatClock(lastR2), { size:11, fill:'#4b5563', weight:'500', anchor:'start' });
            } else {
              text(etaX, yR2 + 3, 'A ' + formatClock(arrR2), { size:11, fill:'#4b5563', weight:'500', anchor:'start' });
            }
          }
        });
      } else {
        const isAT = (String(row.type || row.label || '').toUpperCase() === 'ADDED_TIME');
        const isOC = isOpenControlRow(row);
        positions.forEach(pos => {
          const laneIndex = laneIndexMap[pos.group] ?? 0;
          const yCenter = laneY(laneIndex);

          const arrMin = pos.timeMin;
          let depMin = arrMin;
          if (isAT) {
            const addSec = _getAddedSecForRow(row, pos.group) || 0;
            depMin = arrMin + (addSec / 60);
          }

          if (isAT) {
            text(etaX, yCenter - 2, 'A ' + formatClock(arrMin), { size:10, fill:'#111827', weight:'500', anchor:'start' });
            text(etaX, yCenter + 12, 'D ' + formatClock(depMin), { size:10, fill:'#111827', weight:'500', anchor:'start' });
          } else if (isOC) {
            const count = clampInt(groupMeta[pos.group]?.cars ?? 0, 0, 99);
            const lastMin = arrMin + Math.max(0, count-1) * (groupMeta[pos.group]?.intervalMin || 1);
            text(etaX, yCenter - 2, 'A ' + formatClock(arrMin), { size:10, fill:'#111827', weight:'500', anchor:'start' });
            text(etaX, yCenter + 12, 'L ' + formatClock(lastMin), { size:10, fill:'#111827', weight:'500', anchor:'start' });
          } else {
            text(etaX, yCenter + 6, 'A ' + formatClock(arrMin), { size:10, fill:'#111827', weight:'500', anchor:'start' });
          }
        });
      }

      // v1.89 — Read-only separation at the focused waypoint.  The first-car
      // arrival values already include cumulative car starts, optional start
      // delays, per-SG speeds and Added Time. Do not add delays twice.
      // Visual order is fast-to-slow (SG1 above SG4); start order is reversed.
      function drawGroupGaps_(routeNo, posArray, caption){
        const groups = getEnabledGroups();
        for (let i = 0; i < groups.length - 1; i++){
          const following = groups[i];     // first car of later-starting group
          const preceding = groups[i + 1]; // last car of earlier-starting group
          const followingCars = _carsForRouteGroup_(routeNo, following);
          const precedingCars = _carsForRouteGroup_(routeNo, preceding);
          const actualFollowing = entrantMode ? liveEntrants.filter(e=>e.route===routeNo && e.group===following) : [];
          const actualPreceding = entrantMode ? liveEntrants.filter(e=>e.route===routeNo && e.group===preceding) : [];
          if (entrantMode ? (!actualFollowing.length || !actualPreceding.length) : (followingCars < 1 || precedingCars < 1)) continue;
          let firstFollowing, firstPreceding;
          if (route2CompareRender){
            firstFollowing = getArrivalMinForFocusRoute(following, routeNo);
            firstPreceding = getArrivalMinForFocusRoute(preceding, routeNo);
          } else {
            const pf = (posArray || []).find(p=>p && p.group === following);
            const pp = (posArray || []).find(p=>p && p.group === preceding);
            firstFollowing = pf && pf.timeMin;
            firstPreceding = pp && pp.timeMin;
          }
          if (!Number.isFinite(firstFollowing) || !Number.isFinite(firstPreceding)) continue;
          let lastPreceding;
          if(entrantMode){
            const ownRows = routeNo === 2 ? entrantRowsR2 : entrantRowsR1;
            const ownIdx = _routeIndexForFocus_(routeNo, ownRows || []);
            const focusOwn = ownRows && ownRows[ownIdx];
            if(!focusOwn || !focusOwn.times) continue;
            const origin = Math.min(...liveEntrants.map(e=>e.startMin));
            const followingElapsed = parseTime(focusOwn.times[following]);
            const precedingElapsed = parseTime(focusOwn.times[preceding]);
            firstFollowing = Math.min(...actualFollowing.map(e=>e.startMin-origin+followingElapsed));
            lastPreceding = Math.max(...actualPreceding.map(e=>e.startMin-origin+precedingElapsed));
          }else{
            const intervalMin = _routeLaneIntervalMin_(routeNo, preceding);
            lastPreceding = firstPreceding + (precedingCars - 1) * intervalMin;
          }
          const gapSec = Math.round((firstFollowing - lastPreceding) * 60);
          const absSec = Math.abs(gapSec);
          const mm = String(Math.floor(absSec / 60)).padStart(2,'0');
          const ss = String(absSec % 60).padStart(2,'0');
          const signed = (gapSec < 0 ? '-' : '') + mm + ':' + ss;
          const yMid = (laneY(i) + laneY(i+1)) / 2;
          // Three non-overlapping lines: R1 SG gap, combined Route gap, R2 SG gap.
          const y = route2CompareRender ? yMid + (routeNo === 1 ? -10 : 22) : yMid + 4;
          text(xRow - 8, y, (caption || 'Gap ') + signed, {
            size: route2CompareRender ? 11 : 10,
            fill: gapSec <= 0 ? '#dc2626' : '#111827',
            weight:'600', anchor:'end'
          });
        }
      }
      if (route2CompareRender){
        drawGroupGaps_(1, calcR1 && calcR1.positions, 'R1 SG Time Gap ');
        drawGroupGaps_(2, calcR2 && calcR2.positions, 'R2 SG Time Gap ');
      } else {
        drawGroupGaps_(1, positions, 'Time Gap ');
      }

      // v7.22: Route Time Gap compares Schedule rows by distance and row type.
      // It is a Schedule comparison; no Mapping identity is required.
      if (entrantMode && route2CompareRender && liveEntrants.length) {
        const focus = getFocusRow();
        const ownFocus = Array.isArray(focus && focus._routes) ? focus._routes : (focus ? [focus] : []);
        const commonKey = r => {
          if (!r) return '';
          const type = String(r.type || '').toUpperCase().replace(/[\s_-]+/g, ' ').trim();
          const dist = Number(r.distKm != null ? r.distKm : r.dist);
          if (!type || !Number.isFinite(dist)) return '';
          // Schedule distances are expressed to 0.001 km (one metre).
          return type + '|' + dist.toFixed(3);
        };
        const focusedKey = ownFocus.map(commonKey).find(Boolean);
        if (focusedKey) {
          const r1Control = (entrantRowsR1 || []).find(r => commonKey(r) === focusedKey);
          const r2Control = (entrantRowsR2 || []).find(r => commonKey(r) === focusedKey);
          if (r1Control && r2Control && r1Control.times && r2Control.times) {
            const controls = {1:r1Control, 2:r2Control};
            const groups = getEnabledGroups();
            for (let i = 0; i < groups.length - 1; i++) {
              const following = groups[i], preceding = groups[i+1];
              const followers = liveEntrants.filter(e => e.group === following);
              const predecessors = liveEntrants.filter(e => e.group === preceding);
              if (!followers.length || !predecessors.length) continue;
              // If the two groups are exclusively on one route, the existing
              // route-specific gap already conveys the same information.
              const routesUsed = new Set(followers.concat(predecessors).map(e=>e.route));
              if (routesUsed.size < 2) continue;
              const arrival = e => {
                const raw = controls[e.route]?.times?.[e.group];
                return raw != null && String(raw).trim() !== ''
                  ? e.startMin + parseTime(raw) : NaN;
              };
              const first = followers.map(arrival);
              const last = predecessors.map(arrival);
              if (!first.every(Number.isFinite) || !last.every(Number.isFinite)) continue;
              const gapSec = Math.round((Math.min(...first) - Math.max(...last)) * 60);
              const absolute = Math.abs(gapSec);
              const signed = (gapSec < 0 ? '-' : '') +
                String(Math.floor(absolute / 60)).padStart(2,'0') + ':' +
                String(absolute % 60).padStart(2,'0');
              const y = (laneY(i) + laneY(i+1))/2 + 6;
              text(xRow - 8, y, 'Route Time Gap ' + signed, {
                size:11, fill:gapSec <= 0 ? '#dc2626' : '#111827',
                weight:'600', anchor:'end'
              });
            }
          }
        }
      }

      updateSummaries(positions, row);
    }

    // --- Event wiring ---
    const instance = {
      rallyId: opts && opts.rallyId ? String(opts.rallyId) : '',
      mode: (opts && opts.mode) ? opts.mode : 'embed',
      root,
      _cleanup: [],
      // Host can update day start clock at runtime (HH:MM or HH:MM:SS)
      setStartTime(startStr){ setDayStartClock(startStr); },
      setDayStart(startStr){ setDayStartClock(startStr); },
      // Restore day-specific saved delays atomically, without user-input cascade.
      restoreSavedDelays(delays){
        if (!delays || typeof delays !== 'object') return;
        ALL_GROUPS.forEach(g => {
          const k = g.toLowerCase();
          const raw = delays[k] ?? delays[g];
          if (raw == null) return;
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          const edited = _memEditedStartDelays.has(startDelayMemKey) ? recallStartDelay_(g) : null;
          groupMeta[g].delayMin = edited != null ? edited : clampInt(n, 0, 999);
          rememberStartDelay_(g, groupMeta[g].delayMin);
        });
        buildDelayCarsRows();
        updateFocusSummary();
        renderTimeline();
      },
      setScheduleSnapshot(snapshot) {
        // v1.25: preserve focus/scanner state across live updates
        if (hostRows.length) { try{ persistMemFocus(); }catch(_e){} }
        if (!Array.isArray(snapshot)) snapshot = [];
        hostRows = snapshot.map((r, i)=>({
          idx: (r.rowNo ?? r.idx ?? (i+1)),
          distKm: (typeof r.dist === 'number') ? r.dist : (typeof r.dist === 'string' ? parseFloat(r.dist) : null),
          type: r.type ?? '',
          label: r.label ?? r.waypoint ?? r.type ?? '',
          instruction: r.instruction ?? r.instr ?? '',
          times: r.times ?? {},
          speeds: r.speeds ?? null,
          atLabel: (r.atLabel != null ? String(r.atLabel) : '')
        }));
        hostRows = sanitizeRowsByDist_(hostRows);
        hasAnyTimes = hostRows.some(rr => rr && rr.times && Object.values(rr.times).some(v => String(v||'').trim() !== ''));
        buildFocusSelect();
        try{ restoreMemFocus(); }catch(_e){}
        try{ const elastic = q('elasticToggle'); if (elastic) elastic.checked = !!elasticEnabled; }catch(_e){}
        updateFocusSummary();
        renderTimeline();
        try{ persistMemFocus(); }catch(_e){}
      },
      setEnabledGroups(flags){
        // flags: { SG3: boolean, SG4: boolean }
        if (!flags || typeof flags !== 'object') return;
        _enabled.SG3 = !!flags.SG3;
        _enabled.SG4 = !!flags.SG4;
        updateLaneNote();
        buildDelayCarsRows();
        updateFocusSummary();
        renderTimeline();
      },
      setAllocatedCars(map){
        if (!map || typeof map !== 'object') return;
        ALL_GROUPS.forEach(g=>{
          const v = map[g];
          if (v === null || v === undefined) return;
          groupMeta[g].allocCars = clampInt(v, 0, 99);
        });
        buildDelayCarsRows();
      },
      render() { renderTimeline(); },
      unmount() {
        persistMemFocus();
        // run cleanup handlers
        try { instance._cleanup.forEach(fn => { try { fn(); } catch(_){} }); } catch(_){}
        instance._cleanup = [];
        containerEl.innerHTML = '';
        _instances.delete(containerEl);
      }
    };

    // Focus events
    function resetTimeOffsetToZero(){
      timeOffsetMin = 0;
      const slider = q('timeOffsetSlider');
      const label  = q('timeOffsetLabel');
      try{ if (slider) slider.value = '0'; }catch(_e){}
      if (label) label.textContent = `Time offset around this row (–20 to +20 min): ${timeOffsetMin.toFixed(1)} min`;
    }

    if (focusSelect){
      const onChange = ()=>{ resetTimeOffsetToZero(); updateFocusSummary(); renderTimeline(); persistMemFocus(); };
      focusSelect.addEventListener('change', onChange);
      instance._cleanup.push(()=>focusSelect.removeEventListener('change', onChange));
    }
    // Navigation arrows move once per distinct distance. Focus dropdown remains row-by-row.
    function nextGraphicFocusIndex_(direction){
      const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : _buildCombinedFocusRows_();
      if (!rows.length) return 0;
      const idx = clampInt(focusSelect.value, 0, rows.length - 1);
      const currentKm = Number(rows[idx] && rows[idx].distKm);
      let target = idx + direction;
      while (target >= 0 && target < rows.length && Math.abs(Number(rows[target].distKm) - currentKm) < 1e-6) target += direction;
      if (target < 0 || target >= rows.length) return idx;
      const targetKm = Number(rows[target].distKm);
      // v7.19: Make the selection at this distance independent of arrow direction.
      // Added Time wins over Instruction; Route 1 wins over Route 2 when both
      // have an Added Time at the same distance (stable comparison-time reference).
      let first = target;
      while (first > 0 && Math.abs(Number(rows[first - 1].distKm) - targetKm) < 1e-6) first--;
      let last = target;
      while (last + 1 < rows.length && Math.abs(Number(rows[last + 1].distKm) - targetKm) < 1e-6) last++;
      let preferred = first;
      let bestPriority = -1;
      for (let i = first; i <= last; i++){
        const group = Array.isArray(rows[i]._routes) ? rows[i]._routes : [rows[i]];
        const hasAT = group.some(r => String(r.type || '').toUpperCase() === 'ADDED_TIME');
        const hasR1 = group.some(r => String(r._focusRoute || '1') === '1');
        const priority = (hasAT ? 2 : 0) + (hasR1 ? 1 : 0);
        if (priority > bestPriority){ bestPriority = priority; preferred = i; }
      }
      return preferred;
    }

if (btnPrev){
      const onPrev = ()=>{
        const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : _buildCombinedFocusRows_();
        if (!rows.length || !focusSelect || focusSelect.disabled) return;
        const idx = clampInt(focusSelect.value, 0, rows.length-1);
        const nextIdx = nextGraphicFocusIndex_(-1);
        focusSelect.value = String(nextIdx);
        resetTimeOffsetToZero();
        updateFocusSummary();
        renderTimeline();
        persistMemFocus();
      };
      btnPrev.addEventListener('click', onPrev);
      instance._cleanup.push(()=>btnPrev.removeEventListener('click', onPrev));
    }
    if (btnNext){
      const onNext = ()=>{
        const rows = Array.isArray(focusRows) && focusRows.length ? focusRows : _buildCombinedFocusRows_();
        if (!rows.length || !focusSelect || focusSelect.disabled) return;
        const idx = clampInt(focusSelect.value, 0, rows.length-1);
        const nextIdx = nextGraphicFocusIndex_(1);
        focusSelect.value = String(nextIdx);
        resetTimeOffsetToZero();
        updateFocusSummary();
        renderTimeline();
        persistMemFocus();
      };
      btnNext.addEventListener('click', onNext);
      instance._cleanup.push(()=>btnNext.removeEventListener('click', onNext));
    }

    // Synchronise a day-specific delay edit between simultaneously mounted route views.
    const onSharedDelay = (event)=>{
      const d = event && event.detail;
      if (!d || d.key !== startDelayMemKey || !groupMeta[d.group]) return;
      const n = clampInt(d.value, 0, 999);
      if (groupMeta[d.group].delayMin === n) return;
      groupMeta[d.group].delayMin = n;
      const inp = delayTableBody && delayTableBody.querySelector('tr[data-sg="'+d.group+'"] .tlw-delay-input');
      if (inp) inp.value = String(n);
      renderTimeline(); updateFocusSummary();
    };
    global.addEventListener('td:timeline-delay-change', onSharedDelay);
    instance._cleanup.push(()=>global.removeEventListener('td:timeline-delay-change', onSharedDelay));

    // Initial paint
    applyExternalFromStorage();
    buildDelayCarsRows();
    buildFocusSelect();
    restoreMemFocus();
    _booting = false;
    updateFocusSummary();
    renderTimeline();
    persistMemFocus();
return instance;
  }

  const Timeline = {
    mount(containerEl, opts) {
      if (!containerEl) throw new Error('Timeline.mount: containerEl is required');
      // If already mounted, unmount first (idempotent)
      const existing = _instances.get(containerEl);
      if (existing && typeof existing.unmount === 'function') existing.unmount();

      const inst = createInstance(containerEl, opts || {});
      _instances.set(containerEl, inst);
      return inst;
    },
    unmount(containerEl) {
      const inst = _instances.get(containerEl);
      if (inst && typeof inst.unmount === 'function') inst.unmount();
    }
  };

  global.Timeline = Timeline;
})(window);
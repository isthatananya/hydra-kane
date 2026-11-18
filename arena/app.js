/* Hydra Arena — spectator view. One reducer renders both live (SSE) and replay (timed) runs. */
(() => {
  "use strict";

  const PHASES = ["BUILD", "BASELINE", "CHAOS", "REFEREE", "HEAL", "VERIFY", "DEPLOY"];
  const STATIC = Boolean(window.HYDRA_STATIC);
  const $ = (id) => document.getElementById(id);

  const api = {
    config: () => (STATIC ? Promise.resolve({ mode: "replay", focusRun: null, static: true }) : getJson("/api/config")),
    runs: () => getJson(STATIC ? "data/runs.json" : "/api/runs"),
    run: (id) => getJson(STATIC ? `data/runs/${id}/run.json` : `/api/runs/${id}`),
    events: (id) => getJson(STATIC ? `data/runs/${id}/events.json` : `/api/runs/${id}/events`),
    file: (id, rel) => (rel ? (STATIC ? `data/runs/${id}/files/${rel}` : `/files/${id}/${rel}`) : null),
  };

  async function getJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  const fmtMs = (ms) => {
    if (ms === null || ms === undefined) return "—";
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  };
  const fmtPct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);
  const fmtNum = (x) => (x === null || x === undefined ? "—" : Math.round(x).toLocaleString());

  // ── State ────────────────────────────────────────────────────────────────
  let state = fresh();
  let selectedTile = null;
  let currentRun = null;
  let source = null; // { stop() }
  let mode = "replay";

  function fresh() {
    return {
      phase: null,
      phaseState: Object.fromEntries(PHASES.map((p) => [p, "idle"])),
      tiles: [],
      kane: [],
      bug: null,
      chaosDiff: "",
      verdict: null,
      lastDiff: null,
      status: null,
      reason: null,
      ground: {},
      events: [],
      t: 0,
      builder: {},
    };
  }

  function setPhase(s, name) {
    if (!PHASES.includes(name)) return;
    const idx = PHASES.indexOf(name);
    for (let i = 0; i < idx; i++) if (s.phaseState[PHASES[i]] === "active" || s.phaseState[PHASES[i]] === "idle") s.phaseState[PHASES[i]] = s.phaseState[PHASES[i]] === "idle" ? "skip" : "done";
    // HEAL/VERIFY loop: going back to HEAL re-activates it.
    for (let i = idx + 1; i < PHASES.length; i++) if (s.phaseState[PHASES[i]] === "active") s.phaseState[PHASES[i]] = "idle";
    s.phaseState[name] = "active";
    s.phase = name;
  }

  function reduce(s, ev) {
    s.events.push(ev);
    s.t = ev.t;
    switch (ev.type) {
      case "phase":
        setPhase(s, ev.phase);
        break;
      case "kane_end": {
        s.kane.push(ev);
        const passed = ev.verdict === "passed";
        const failed = ev.verdict === "failed";
        const kind = ev.label.startsWith("baseline") ? "baseline" : ev.label === "referee" ? "referee" : ev.spec === "holdout" ? "holdout" : ev.spec === "generated" ? "spec-agent" : "verify";
        s.tiles.push({
          id: `k${ev.seq}`,
          kind: kind === "referee" ? "Kane referee" : `Kane ${kind}`,
          main: passed ? "PASS" : failed ? "FAIL" : "INFRA",
          sub: `exit ${ev.exitCode ?? "—"} · ${fmtMs(ev.durationMs)}`,
          cls: passed ? (kind === "referee" ? "warn" : "pass") : failed ? "fail" : "warn",
          kane: ev,
        });
        if (failed && kind !== "baseline") selectedTile = `k${ev.seq}`;
        else if (!selectedTile || state.tiles.length === 0) selectedTile = `k${ev.seq}`;
        break;
      }
      case "kane_infra":
        break;
      case "chaos_applied":
        s.bug = ev.bug;
        s.chaosDiff = ev.diff || "";
        s.tiles.push({ id: `c${ev.seq}`, kind: "Chaos", main: ev.bug ? ev.bug.id : "bug", sub: ev.bug ? ev.bug.bugClass : "", cls: "info" });
        break;
      case "verdict":
        s.verdict = ev.verdict;
        if (ev.verdict === "MISS") s.phaseState.REFEREE = "bad";
        break;
      case "builder_end":
        s.builder[ev.round] = ev;
        break;
      case "diff":
        s.lastDiff = ev;
        s.tiles.push({
          id: `d${ev.seq}`,
          kind: `Patch #${ev.round}`,
          main: `${ev.files.length} file${ev.files.length === 1 ? "" : "s"}`,
          sub: tokenLabel(s.builder[ev.round]),
          cls: ev.files.length ? "info" : "warn",
          diff: ev,
        });
        break;
      case "anticheat":
        s.tiles.push({ id: `a${ev.seq}`, kind: "Anti-cheat", main: ev.kind === "spec-tamper" ? "SPEC TAMPER" : "REVERTED", sub: (ev.files || []).map((f) => f.split(/[\\/]/).pop()).join(", "), cls: "fail" });
        break;
      case "build_end":
        if (!ev.ok) s.tiles.push({ id: `b${ev.seq}`, kind: "Build", main: "BROKEN", sub: ev.tag, cls: "fail" });
        break;
      case "gate":
        if (ev.decision === "reject") s.tiles.push({ id: `g${ev.seq}`, kind: "Deploy gate", main: "REJECTED", sub: (ev.reasons || [])[0] || "", cls: "fail" });
        break;
      case "deploy":
        s.phaseState.DEPLOY = "done";
        s.tiles.push({ id: `p${ev.seq}`, kind: "Deploy", main: "SHIPPED", sub: "gate: 2× fresh pass + holdout", cls: "pass" });
        break;
      case "ground_truth":
        s.ground[ev.phase] = ev;
        break;
      case "spec_agent":
        s.tiles.push({ id: `s${ev.seq}`, kind: "Spec agent", main: ev.caught ? "NEW FLOW" : "NO CATCH", sub: ev.caught ? "catches the miss" : ev.reason || "", cls: ev.caught ? "info" : "warn" });
        break;
      case "run_end":
        s.status = ev.status;
        s.reason = ev.reason;
        for (const p of PHASES) if (s.phaseState[p] === "active") s.phaseState[p] = ev.status === "healed" ? "done" : "bad";
        if (ev.status === "healed") s.phaseState.DEPLOY = "done";
        break;
    }
    return s;
  }

  function tokenLabel(b) {
    if (!b) return "";
    const tok = b.tokens ? `${fmtNum(b.tokens.total)} tok` : "tokens n/a";
    return `${tok} · ${fmtMs(b.durationMs)}`;
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function render() {
    const s = state;
    const phases = $("phases");
    phases.replaceChildren(...PHASES.map((p) => el("li", { class: s.phaseState[p] === "idle" ? "" : s.phaseState[p] }, p)));

    const statusText = $("status-text");
    statusText.replaceChildren();
    if (s.status) {
      const label = { healed: "HEALED & DEPLOYED", miss: "MISS LOGGED", aborted: "ABORTED", rejected: "REJECTED BY GATE", "invalid-baseline": "INVALID BASELINE", "infra-error": "INFRA ERROR", "budget-exceeded": "BUDGET EXCEEDED", error: "ERROR" }[s.status] || s.status.toUpperCase();
      statusText.append(el("strong", { text: label }), " — ", s.reason || "");
    } else if (s.phase) {
      statusText.append(el("strong", { text: s.phase }), s.bug && s.phase !== "BUILD" && s.phase !== "BASELINE" ? ` · bug ${s.bug.id}` : "");
    } else statusText.textContent = "Waiting for a run…";

    const tiles = $("tiles");
    tiles.replaceChildren();
    s.tiles.forEach((t, i) => {
      if (i > 0) tiles.append(el("span", { class: "arrow", "aria-hidden": "true" }, "→"));
      const clickable = Boolean(t.kane || t.diff);
      tiles.append(
        el(
          clickable ? "button" : "div",
          {
            class: `tile ${t.cls}${clickable ? " clickable" : ""}${selectedTile === t.id ? " selected" : ""}`,
            role: "listitem",
            type: clickable ? "button" : null,
            onclick: clickable ? () => { selectedTile = t.id; render(); } : null,
          },
          el("span", { class: "t-kind", text: t.kind }),
          el("span", { class: "t-main", text: t.main }),
          t.sub ? el("span", { class: "t-sub", text: t.sub }) : null,
        ),
      );
    });

    renderKane();
    renderDiff();
    renderChaos();
    renderTimeline();
    $("clock").textContent = s.events.length ? `t+${fmtMs(s.t)}` : "";
  }

  function selectedKane() {
    const sel = state.tiles.find((t) => t.id === selectedTile && t.kane);
    if (sel) return sel.kane;
    const fails = state.kane.filter((k) => k.verdict === "failed");
    return fails[fails.length - 1] || state.kane[state.kane.length - 1] || null;
  }

  let lastVideo = null;
  function renderKane() {
    const k = selectedKane();
    const pill = $("kane-verdict");
    const video = $("kane-video");
    const empty = $("video-empty");
    const dl = $("kane-details");
    const shots = $("shots");
    dl.replaceChildren();
    shots.replaceChildren();
    if (!k) {
      pill.textContent = "—";
      pill.className = "pill";
      return;
    }
    pill.textContent = k.verdict === "passed" ? "PASS · exit 0" : k.verdict === "failed" ? "FAIL · exit 1" : `INFRA · ${k.verdict}`;
    pill.className = `pill ${k.verdict === "passed" ? "pass" : k.verdict === "failed" ? "fail" : "warn"}`;
    const src = api.file(currentRun, k.video);
    if (src !== lastVideo) {
      lastVideo = src;
      if (src) {
        video.src = src;
        empty.hidden = true;
      } else {
        video.removeAttribute("src");
        video.load();
        empty.hidden = false;
        empty.textContent = "No video recorded for this Kane run";
      }
    }
    const row = (label, value) => dl.append(el("dt", { text: label }), el("dd", {}, value));
    row("Run", `${k.label} (${k.spec})${k.attempt ? `, retry ${k.attempt}` : ""}`);
    if (k.summary) row("Summary", k.summary);
    if (k.failingStep) row("Failing step", `${k.failingStep.index !== null ? `#${k.failingStep.index} ` : ""}${k.failingStep.description || ""}${k.failingStep.reason ? ` — ${k.failingStep.reason}` : ""}`);
    if (k.infraReason) row("Infra", k.infraReason);
    if (k.testUrl) row("ShareLink", el("a", { href: k.testUrl, target: "_blank", rel: "noopener noreferrer", text: "Open in Kane dashboard ↗" }));
    row("Duration", fmtMs(k.durationMs));
    if (k.credits !== null && k.credits !== undefined) row("Credits", String(k.credits));
    row("Fresh run", k.fresh ? "yes (no cached replay)" : "no");
    for (const shot of (k.screenshots || []).slice(-6)) {
      const href = api.file(currentRun, shot);
      shots.append(el("a", { href, target: "_blank", rel: "noopener" }, el("img", { src: href, alt: `Kane screenshot ${shot.split("/").pop()}`, loading: "lazy" })));
    }
  }

  function renderPatch(target, patch) {
    target.replaceChildren();
    if (!patch) {
      target.append(el("span", { class: "muted", text: "No changes." }));
      return;
    }
    for (const line of patch.split("\n")) {
      let cls = null;
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("Index:") || line.startsWith("=====")) cls = "file";
      else if (line.startsWith("@@")) cls = "hunk";
      else if (line.startsWith("+")) cls = "add";
      else if (line.startsWith("-")) cls = "del";
      if (cls === "file" && line.startsWith("=====")) continue;
      target.append(cls ? el("span", { class: cls, text: line }) : document.createTextNode(line + "\n"));
    }
  }

  function renderDiff() {
    const sel = state.tiles.find((t) => t.id === selectedTile && t.diff);
    const d = sel ? sel.diff : state.lastDiff;
    const meta = $("diff-meta");
    if (!d) {
      $("diff").replaceChildren(el("span", { class: "muted", text: "No patch yet." }));
      meta.textContent = "";
      return;
    }
    renderPatch($("diff"), d.patch);
    const b = state.builder[d.round];
    meta.textContent = `round ${d.round} · ${d.files.join(", ") || "no files"}${b ? ` · ${tokenLabel(b)}` : ""}${d.reverted && d.reverted.length ? ` · reverted: ${d.reverted.join(", ")}` : ""}`;
  }

  function renderChaos() {
    const b = state.bug;
    $("chaos-class").textContent = b ? b.bugClass : "—";
    $("chaos-class").className = `pill${b ? " warn" : ""}`;
    $("chaos-desc").textContent = b ? `${b.title}: ${b.description} (source: ${b.source}; Kane hypothesis: ${b.kaneHypothesis})` : "No bug injected yet.";
    renderPatch($("chaos-diff"), state.chaosDiff);

    const gt = $("gt");
    gt.replaceChildren();
    const phases = ["baseline", "chaos", "final"].filter((p) => state.ground[p]);
    if (!phases.length) {
      gt.append(el("p", { class: "muted small", text: "No ground-truth results yet." }));
      return;
    }
    const checks = ["main", "holdout", "invalid-email", "double-click"];
    gt.append(el("div", { class: "gt-row" }, el("span", { class: "h", text: "check" }), ...["baseline", "chaos", "final"].map((p) => el("span", { class: "h", text: p }))));
    for (const c of checks) {
      const cells = ["baseline", "chaos", "final"].map((p) => {
        const g = state.ground[p];
        if (!g || !g.available) return el("span", { class: "gt-cell", text: g ? "n/a" : "—" });
        const r = (g.results || []).find((x) => x.check === c);
        if (!r) return el("span", { class: "gt-cell", text: "—" });
        return el("span", { class: `gt-cell ${r.passed ? "pass" : "fail"}`, title: r.failure || "pass", text: r.passed ? "pass" : "FAIL" });
      });
      gt.append(el("div", { class: "gt-row" }, el("span", { text: c }), ...cells));
    }
  }

  function describe(ev) {
    switch (ev.type) {
      case "run_start": return `run ${ev.runId} · seed ${ev.seed} · builder ${ev.builder}`;
      case "phase": return `${ev.phase}${ev.round ? ` (round ${ev.round})` : ""}`;
      case "kane_start": return `${ev.label} → ${ev.spec}${ev.attempt ? ` (retry ${ev.attempt})` : ""}`;
      case "kane_end": return `${ev.label}: ${ev.verdict} (exit ${ev.exitCode ?? "—"})${ev.summary ? ` — ${ev.summary}` : ""}`;
      case "kane_infra": return `${ev.label}: infra ${ev.verdict} — ${ev.reason || ""} (not sent to builder)`;
      case "chaos_applied": return `injected ${ev.bug?.id} [${ev.bug?.bugClass}]`;
      case "verdict": return ev.verdict === "CATCH" ? "CATCH — Kane exit 1, evidence becomes the heal prompt" : "MISS — Kane passed with the bug present";
      case "heal_start": return `round ${ev.round}: prompt built from Kane ${ev.flow} evidence`;
      case "builder_end": return `builder exit ${ev.exitCode}${ev.timedOut ? " (timeout)" : ""} · ${tokenLabel(ev)}`;
      case "diff": return `patch: ${ev.files.join(", ") || "none"}${ev.reverted?.length ? ` · reverted ${ev.reverted.join(", ")}` : ""}`;
      case "anticheat": return `ANTI-CHEAT ${ev.kind}: ${(ev.files || []).join(", ")}`;
      case "build_start": return `build ${ev.tag}`;
      case "build_end": return `build ${ev.tag}: ${ev.ok ? "ok" : "FAILED"} (${fmtMs(ev.durationMs)})`;
      case "ground_truth": return `ground truth ${ev.phase}: ${ev.available ? (ev.failing.length ? `failing ${ev.failing.join(", ")}` : "all pass") : "unavailable"}`;
      case "round_end": return `round ${ev.round}: ${ev.outcome}`;
      case "gate": return `gate ${ev.decision}: ${(ev.reasons || []).join("; ")}`;
      case "deploy": return `deployed → ${ev.dir}`;
      case "spec_agent": return `spec agent: ${ev.caught ? "new flow catches the bug" : `no catch${ev.reason ? ` (${ev.reason})` : ""}`}`;
      case "mutator": return `mutator attempt ${ev.attempt}: ${ev.ok ? "valid bug" : ev.reason}`;
      case "run_end": return `${ev.status}: ${ev.reason || ""}`;
      default: return ev.type;
    }
  }

  function renderTimeline() {
    const list = $("timeline");
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.replaceChildren(
      ...state.events.map((ev) =>
        el("li", {}, el("span", { class: "t", text: `+${fmtMs(ev.t)}` }), el("span", { class: "k", text: ev.type }), el("span", { class: "m", text: describe(ev) })),
      ),
    );
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  function renderStats(stats) {
    const box = $("stats");
    const stat = (v, l) => el("div", { class: "stat" }, el("div", { class: "v", text: v }), el("div", { class: "l", text: l }));
    box.replaceChildren(
      stat(fmtPct(stats.detectionRate), `detection rate (${stats.catches}/${stats.bugsInjected})`),
      stat(String(stats.misses), "MISS count"),
      stat(String(stats.healed), "healed & deployed"),
      stat(stats.avgRoundsToGreen === null ? "—" : stats.avgRoundsToGreen.toFixed(1), "avg rounds to green"),
      stat(fmtMs(stats.avgTimeToHealMs), "avg time to heal"),
      stat(fmtNum(stats.avgTokensPerHeal), "tokens per heal"),
      stat(fmtPct(stats.holdoutFailRate), "holdout fail rate"),
      stat(String(stats.falseGreens), "false greens (oracle)"),
      stat(String(stats.runs), "runs recorded"),
    );
    const hm = $("heatmap");
    hm.replaceChildren(el("div", { class: "hm-row" }, el("span", { class: "h", text: "class" }), el("span", { class: "h", text: "caught" }), el("span", { class: "h", text: "missed" }), el("span", { class: "h", text: "healed" })));
    const classes = Object.entries(stats.byClass || {});
    if (!classes.length) hm.append(el("p", { class: "muted small", text: "No bugs injected yet." }));
    for (const [cls, v] of classes) {
      const cell = (n, color) => {
        const a = v.injected ? n / v.injected : 0;
        return el("span", { class: "hm-cell", style: `background: color-mix(in srgb, ${color} ${Math.round(a * 70)}%, var(--panel-2))`, text: `${n}/${v.injected}` });
      };
      hm.append(el("div", { class: "hm-row" }, el("span", { text: cls }), cell(v.caught, "var(--pass)"), cell(v.missed, "var(--fail)"), cell(v.healed, "var(--info)")));
    }
  }

  // ── Data sources ─────────────────────────────────────────────────────────
  function stopSource() {
    if (source) source.stop();
    source = null;
  }

  function playLive(runId) {
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    let scheduled = false;
    es.onmessage = (msg) => {
      reduce(state, JSON.parse(msg.data));
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; render(); });
      }
    };
    es.addEventListener("done", () => { es.close(); refreshStats(); });
    es.onerror = () => { /* EventSource reconnects automatically; the server resends from the start */ };
    // On reconnect the server replays everything: reset so events are not double-counted.
    es.onopen = () => { state = fresh(); selectedTile = null; };
    source = { stop: () => es.close() };
  }

  function playReplay(events) {
    let i = 0;
    let timer = null;
    let paused = false;
    const speedSel = $("speed");
    const step = () => {
      if (paused) return;
      if (i >= events.length) { render(); refreshStats(); return; }
      reduce(state, events[i]);
      render();
      i++;
      const speed = Number(speedSel.value);
      if (i < events.length) {
        const gap = speed === 0 ? 0 : Math.min(2500, Math.max(60, (events[i].t - events[i - 1].t) / speed));
        timer = setTimeout(step, gap);
      } else refreshStats();
    };
    const btn = $("btn-play");
    btn.textContent = "❚❚";
    btn.setAttribute("aria-label", "Pause replay");
    btn.onclick = () => {
      paused = !paused;
      btn.textContent = paused ? "▶" : "❚❚";
      btn.setAttribute("aria-label", paused ? "Play replay" : "Pause replay");
      if (!paused) step();
    };
    $("btn-restart").onclick = () => select(currentRun, true);
    step();
    source = { stop: () => clearTimeout(timer) };
  }

  async function select(runId, forceReplay = false) {
    stopSource();
    state = fresh();
    selectedTile = null;
    lastVideo = null;
    currentRun = runId;
    render();
    if (!runId) return;
    const url = new URL(location.href);
    url.searchParams.set("run", runId);
    history.replaceState(null, "", url);
    const run = await api.run(runId);
    const live = !STATIC && mode === "live" && run.status === "running" && !forceReplay;
    $("mode-badge").textContent = live ? "LIVE" : "REPLAY";
    $("mode-badge").className = `badge ${live ? "live" : "replay"}`;
    $("replay-controls").hidden = live;
    if (live) playLive(runId);
    else playReplay(await api.events(runId));
  }

  async function refreshStats() {
    try {
      const data = await api.runs();
      renderStats(data.stats);
      return data;
    } catch (err) {
      console.error(err);
      return null;
    }
  }

  async function boot() {
    const cfg = await api.config();
    mode = cfg.mode;
    const data = await refreshStats();
    const runs = data ? data.runs : [];
    const sel = $("run-select");
    sel.replaceChildren(
      ...runs.map((r) =>
        el("option", { value: r.runId, text: `${r.status === "running" ? "● " : ""}seed ${r.seed} · ${r.bug ? r.bug.id : "—"} · ${r.builder} · ${r.status}` }),
      ),
    );
    if (!runs.length) sel.append(el("option", { value: "", text: "No runs recorded yet — start one with: hydra run" }));
    sel.onchange = () => select(sel.value);
    const wanted = new URL(location.href).searchParams.get("run") || cfg.focusRun || (runs.find((r) => r.status === "running") || runs[0] || {}).runId;
    if (wanted && runs.some((r) => r.runId === wanted)) {
      sel.value = wanted;
      await select(wanted);
    }
    // In live mode, pick up new runs as they start.
    if (!STATIC && mode === "live") {
      setInterval(async () => {
        const fresh = await refreshStats();
        if (!fresh) return;
        const known = new Set([...sel.options].map((o) => o.value));
        const newest = fresh.runs.find((r) => r.status === "running" && !known.has(r.runId));
        if (newest) {
          sel.prepend(el("option", { value: newest.runId, text: `● seed ${newest.seed} · ${newest.bug ? newest.bug.id : "—"} · ${newest.builder} · running` }));
          sel.value = newest.runId;
          select(newest.runId);
        }
      }, 3000);
    }
  }

  boot().catch((err) => {
    $("status-text").textContent = `Arena failed to load: ${err.message}`;
  });
})();

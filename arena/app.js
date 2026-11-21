/* Hydra Arena: a match report per run. One reducer renders live (SSE) runs and replays alike. */
(() => {
  "use strict";

  const PHASES = ["BUILD", "BASELINE", "CHAOS", "REFEREE", "HEAL", "VERIFY", "DEPLOY"];
  const STATIC = Boolean(window.HYDRA_STATIC);
  const $ = (id) => document.getElementById(id);
  const vertical = window.matchMedia("(max-width: 720px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : String(c));
    return node;
  }

  // ── Icons (Lucide paths, MIT) and state marks ────────────────────────────
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  function icon(name) {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.75");
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name];
    return s;
  }
  // One mark per state: circle = pass, cross = fail, triangle = tamper, diamond = deploy, square = patch.
  const MARKS = {
    pass: '<circle cx="12" cy="12" r="7" fill="currentColor"/>',
    fail: '<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>',
    tamper: '<path d="M12 3 22 20H2Z" fill="currentColor"/>',
    deploy: '<path d="M12 2 22 12 12 22 2 12Z" fill="currentColor"/>',
    patch: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
    reject: '<path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>',
    dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
  };
  function mark(kind) {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = MARKS[kind] || MARKS.dot;
    return s;
  }

  // ── Formatting ───────────────────────────────────────────────────────────
  const fmtDur = (ms) => {
    if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  };
  const fmtAt = (ms) => `+${fmtDur(ms)}`;
  const fmtNum = (x) => (x === null || x === undefined ? "—" : Math.round(x).toLocaleString("en-US"));
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const BUILDER_NAMES = { claude: "Claude Code", opencode: "opencode", cheater: "The cheater builder", hardcoder: "The hardcoder builder" };
  const builderName = (b) => BUILDER_NAMES[b] || b;
  const bugLabel = (bug) => (bug ? `${bug.id}${bug.surface && bug.surface !== bug.id ? ` (${bug.surface})` : ""}` : "—");

  /** Kane's summaries end with `evidence:` lines: what it saw, which its prose can misattribute. */
  function evidenceLines(summary) {
    return (summary || "").split("\n").filter((l) => /^\s*evidence:/i.test(l)).map((l) => l.replace(/^\s*evidence:\s*/i, "").replace(/^[a-z_]+:\s*/i, ""));
  }
  function firstSentence(s, max = 140) {
    const line = (s || "").split("\n")[0] || "";
    const m = /^(.+?[.!?])(\s|$)/.exec(line);
    const out = m ? m[1] : line;
    return out.length > max ? `${out.slice(0, max).replace(/\s+\S*$/, "")} …` : out;
  }
  function diffCounts(patch) {
    let add = 0, del = 0;
    for (const l of (patch || "").split("\n")) {
      if (l.startsWith("+++") || l.startsWith("---")) continue;
      if (l.startsWith("+")) add++;
      else if (l.startsWith("-")) del++;
    }
    return { add, del };
  }

  // ── State and reducer ────────────────────────────────────────────────────
  function fresh() {
    return {
      phase: null, phases: [], kane: [], bug: null, chaosDiff: "", verdict: null, diffs: [], anticheat: [],
      gates: [], deploy: null, status: null, reason: null, ground: {}, builder: {}, specAgent: null, t: 0, count: 0,
    };
  }

  function kindOf(ev) {
    return ev.label.startsWith("baseline") ? "baseline" : ev.label === "referee" ? "referee" : ev.spec === "holdout" ? "holdout" : ev.spec === "generated" ? "spec-agent" : "verify";
  }

  function reduce(s, ev) {
    s.t = ev.t;
    s.count++;
    switch (ev.type) {
      case "phase":
        if (PHASES.includes(ev.phase)) {
          s.phase = ev.phase;
          s.phases.push({ phase: ev.phase, t: ev.t, round: ev.round || null });
        }
        break;
      case "kane_end": s.kane.push({ ...ev, kind: kindOf(ev) }); break;
      case "chaos_applied": s.bug = ev.bug; s.chaosDiff = ev.diff || ""; break;
      case "verdict": s.verdict = ev.verdict; break;
      case "builder_end": s.builder[ev.round] = ev; break;
      case "diff": s.diffs.push(ev); break;
      case "anticheat": s.anticheat.push(ev); break;
      case "gate": s.gates.push(ev); break;
      case "deploy": s.deploy = ev; break;
      case "ground_truth": s.ground[ev.phase] = ev; break;
      case "spec_agent": s.specAgent = ev; break;
      case "run_end": s.status = ev.status; s.reason = ev.reason; break;
    }
    return s;
  }

  // ── Page state ───────────────────────────────────────────────────────────
  let state = fresh();
  let run = null; // run.json
  let runsIndex = { runs: [], stats: null };
  let currentRun = null;
  let mode = "replay";
  let live = false;
  let selected = null; // moment id, or kane-<seq> / diff-<seq>
  let userSelected = false;
  let proofPick = null; // seq of the Kane run shown inside "the proof"
  let captions = {};
  let videoByLabel = {};
  const seenMoments = new Set();
  let lastStatus = null;
  let source = null;

  const player = { events: [], idx: 0, playing: false, timer: null, speed: 4 };

  // ── Key moments: the single source of outcome logic ─────────────────────
  function deriveMoments(s) {
    const out = [];
    const referee = s.kane.find((k) => k.kind === "referee");
    const tamper = s.anticheat.find((a) => a.kind === "spec-tamper");
    const reject = s.gates.find((g) => g.decision === "reject");
    const fix = [...s.diffs].reverse().find((d) => d.files && d.files.length);
    const miss = s.verdict === "MISS" || (referee && referee.verdict === "passed" && s.bug);

    if (referee && referee.verdict === "failed") {
      out.push({
        id: "catch", label: "The catch", word: "FAIL", tone: "catch", mark: "fail",
        meta: `Kane referee · exit 1 · ${fmtDur(referee.durationMs)}`,
        detail: evidenceLines(referee.summary)[0] || firstSentence(referee.summary),
        subject: { type: "kane", ev: referee }, t: referee.t, seq: referee.seq,
      });
    } else if (referee && miss) {
      const failing = (s.ground.chaos && s.ground.chaos.failing) || [];
      out.push({
        id: "miss", label: "The miss", word: "PASS", tone: "catch", mark: "pass",
        meta: `Kane referee · exit 0 · ${fmtDur(referee.durationMs)}`,
        detail: `Kane passed with the bug present.${failing.length ? ` The oracle failed: ${failing.join(", ")}.` : ""}`,
        subject: { type: "kane", ev: referee, miss: true }, t: referee.t, seq: referee.seq,
      });
    }

    if (tamper) {
      const files = (tamper.files || []).join(", ");
      out.push({
        id: "cheat", label: "The cheat", word: "SPEC TAMPER", tone: "cheat", mark: "tamper",
        meta: `round ${tamper.round || 1} · no code changed`,
        detail: `${files} modified by the builder (hash mismatch).`,
        subject: { type: "cheat", ev: tamper, gate: reject }, t: tamper.t, seq: tamper.seq,
      });
    } else if (fix) {
      const c = diffCounts(fix.patch);
      out.push({
        id: "fix", label: s.deploy ? "The fix" : "The patch", word: `Patch #${fix.round}`, tone: "ink", mark: "patch",
        meta: `${plural(fix.files.length, "file")} · +${c.add} −${c.del}`,
        detail: fix.files.join(", "),
        subject: { type: "diff", ev: fix }, t: fix.t, seq: fix.seq,
      });
    }

    if (s.deploy) {
      const after = s.kane.filter((k) => fix && k.t > fix.t && k.verdict === "passed");
      const holdout = after.find((k) => k.kind === "holdout");
      out.push({
        id: "proof", label: "The proof", word: `PASS ×${after.length}`, tone: "heal", mark: "deploy",
        meta: `${after.filter((k) => k.kind === "verify").length} fresh verify${holdout ? " + holdout" : ""} · deployed`,
        detail: "Fresh Kane runs on the patched app, then the deploy gate.",
        subject: { type: "proof", runs: after, deploy: s.deploy }, t: s.deploy.t, seq: s.deploy.seq,
      });
    } else if (reject) {
      const holdoutFail = [...s.kane].reverse().find((k) => k.kind === "holdout" && k.verdict === "failed");
      out.push({
        id: "gate", label: "The gate", word: "REJECTED", tone: "cheat", mark: "reject",
        meta: tamper ? "spec restored · nothing deployed" : holdoutFail ? "holdout failed · nothing deployed" : "nothing deployed",
        detail: tamper ? "The deploy gate refused the round and put the original spec back." : (reject.reasons || [])[0] || "",
        subject: { type: "gate", ev: reject, kane: tamper ? null : holdoutFail, tamper }, t: reject.t, seq: reject.seq,
      });
    } else if (miss && s.status) {
      const g = s.ground.chaos;
      const failed = g ? (g.results || []).filter((r) => !r.passed) : [];
      out.push({
        id: "cost", label: "The cost", word: "WOULD SHIP", tone: "catch", mark: "fail",
        meta: "no heal, nothing flagged",
        detail: failed.length ? failed.map((r) => r.failure).join("; ") : "The bug stays in the app.",
        subject: { type: "cost" }, t: g ? g.t : state.t, seq: g ? g.seq : null,
      });
    }
    return out;
  }

  function outcomeCopy(s, moments) {
    const bug = s.bug ? `${s.bug.id}` : "hidden";
    const name = run ? builderName(run.builder) : "The builder";
    const rounds = run ? run.rounds.length : 0;
    if (!s.status) {
      return { word: live ? "In play" : "In play", cls: "inplay", sentence: s.phase ? `Phase: ${s.phase.toLowerCase()}.${s.bug && !["BUILD", "BASELINE"].includes(s.phase) ? ` A ${bug} bug is hidden in the app.` : ""}` : "Waiting for the first event." };
    }
    const tamper = moments.some((m) => m.id === "cheat");
    switch (s.status) {
      case "healed": {
        const fresh = s.kane.filter((k) => k.kind === "verify" && k.verdict === "passed" && moments.find((m) => m.id === "fix") && k.t > moments.find((m) => m.id === "fix").t).length;
        const r = run && run.metrics && run.metrics.roundsToGreen ? run.metrics.roundsToGreen : rounds;
        return { word: "Healed", cls: "healed", sentence: `Kane caught a ${bug} bug. ${name} patched it in ${plural(r, "round")}. Deployed after ${fresh} fresh passes and the holdout.` };
      }
      case "rejected":
        return tamper
          ? { word: "Rejected", cls: "rejected", sentence: `Kane caught a ${bug} bug. The builder edited a Kane spec instead of the code. The gate rejected the round.` }
          : { word: "Rejected", cls: "rejected", sentence: `Kane caught a ${bug} bug. The gate rejected the round: ${s.reason || "see the evidence"}.` };
      case "miss":
        return { word: "Missed", cls: "miss", sentence: `Kane passed the run, but the oracle found the ${bug} bug. The bug would have shipped.` };
      case "aborted": {
        const holdoutFail = moments.find((m) => m.id === "gate" && m.subject.kane);
        if (holdoutFail) return { word: "Aborted", cls: "aborted", sentence: `Kane caught a ${bug} bug. The patch passed the visible spec twice but failed the hidden holdout, so nothing deployed. The run stopped after ${plural(rounds, "round")}.` };
        return { word: "Aborted", cls: "aborted", sentence: `The run stopped at ${(s.phase || "start").toLowerCase()}: ${s.reason || "no reason recorded"}.` };
      }
      default:
        return { word: s.status.replace(/-/g, " "), cls: "aborted", sentence: s.reason || "" };
    }
  }

  // ── Rendering ────────────────────────────────────────────────────────────
  function render() {
    const moments = deriveMoments(state);
    if (!userSelected || !selected) selected = defaultSelection(moments);
    renderHero(moments);
    renderTrack(moments);
    renderMoments(moments);
    renderEvidence(moments);
    renderChaos();
    renderLog();
    announce(moments);
    syncHash();
  }

  function defaultSelection(moments) {
    if (!moments.length) return state.kane.length ? `kane-${state.kane[state.kane.length - 1].seq}` : null;
    return player.playing ? moments[moments.length - 1].id : moments[0].id;
  }

  function renderHero(moments) {
    const copy = outcomeCopy(state, moments);
    const word = $("verdict-word");
    word.textContent = copy.word;
    word.className = `verdict-word ${copy.cls}`;
    if (state.status && lastStatus === null && player.playing && !reducedMotion.matches) {
      word.classList.add("reveal");
    }
    lastStatus = state.status;
    $("hero-label").textContent = state.status ? "Result" : live ? "Live" : player.playing ? "Replaying" : "Paused";
    $("hero-watch").hidden = player.playing || live;
    $("hero-watch").textContent = state.status ? "Watch it unfold" : "Watch from the start";
    $("verdict-sentence").textContent = copy.sentence;
    if (run) {
      const parts = [`seed ${run.seed}`, `builder ${run.builder}`, `${state.bug ? `bug ${bugLabel(run.bug || state.bug)}` : "bug not hidden yet"}`];
      if (state.status) parts.push(fmtDur(run.durationMs), plural(run.rounds.length, "round"));
      $("matchup").textContent = parts.join(" · ");
    }
    const facts = $("facts");
    facts.replaceChildren();
    if (state.status && run) {
      const m = run.metrics || {};
      const rows = state.status === "healed"
        ? [["Time to heal", fmtDur(m.timeToHealMs)], ["Rounds", String(m.roundsToGreen ?? run.rounds.length)], ["Tokens", m.tokensTotal ? fmtNum(m.tokensTotal) : "n/a"]]
        : [["Duration", fmtDur(run.durationMs)], ["Heal rounds", String(run.rounds.length)], ["Kane runs", String(m.kaneRuns ?? state.kane.length)]];
      for (const [k, v] of rows) facts.append(el("div", {}, el("dt", { text: k }), el("dd", { text: v })));
    }
  }

  function totalMs() {
    const last = player.events[player.events.length - 1];
    return Math.max(1, (run && run.status !== "running" && run.durationMs) || (last ? last.t : 1), last ? last.t : 1);
  }
  const pos = (t) => `${Math.min(100, Math.max(0, (t / totalMs()) * 100))}%`;

  function renderTrack(moments) {
    const total = totalMs();
    const vert = vertical.matches;
    const axis = vert ? "top" : "left";
    const p = pos(state.t);
    $("rail-played").style[vert ? "height" : "width"] = p;
    $("rail-played").style[vert ? "width" : "height"] = "";
    const ph = $("playhead");
    ph.style.left = vert ? "" : p;
    ph.style.top = vert ? p : "";

    const rail = $("rail");
    const sec = Math.round(state.t / 1000);
    rail.setAttribute("aria-valuemax", String(Math.round(total / 1000)));
    rail.setAttribute("aria-valuenow", String(sec));
    rail.setAttribute("aria-valuetext", `${state.phase ? `${state.phase.toLowerCase()} phase, ` : ""}${fmtDur(state.t)} of ${fmtDur(total)}`);
    $("clock").textContent = `${fmtAt(state.t)} / ${fmtDur(total)}`;

    // Phase ticks: first occurrence of each phase, at its real start time, pushed apart so labels never overlap.
    const ticks = $("phase-ticks");
    ticks.replaceChildren();
    const firsts = [];
    for (const ph2 of allPhases()) if (!firsts.some((f) => f.phase === ph2.phase)) firsts.push(ph2);
    const size = vert ? ($("track").clientHeight || 420) : ($("track").clientWidth || 1000);
    const minGap = vert ? 26 : 84;
    let prev = -Infinity;
    const placed = firsts.map((f) => {
      let px = (f.t / total) * size;
      px = Math.max(px, prev + minGap);
      prev = px;
      return { ...f, px };
    });
    const overflow = placed.length ? placed[placed.length - 1].px - (size - (vert ? 10 : 70)) : 0;
    if (overflow > 0) {
      let next = Infinity;
      for (let i = placed.length - 1; i >= 0; i--) {
        placed[i].px = Math.min(placed[i].px - (i === placed.length - 1 ? overflow : 0), next - minGap);
        next = placed[i].px;
      }
    }
    for (const f of placed) {
      const reached = f.t <= state.t && state.count > 0;
      ticks.append(el("li", { class: state.phase === f.phase && !state.status ? "current" : reached ? "" : "future", style: `${axis}: ${Math.max(0, f.px)}px` }, f.phase.toLowerCase()));
    }

    // Marks: Kane runs, the patch, the cheat, the gate, the deploy. Only the key moments are big and coloured.
    const marks = $("marks");
    marks.replaceChildren();
    const key = new Map(moments.map((m) => [m.seq, m]));
    const items = [];
    for (const k of state.kane) items.push({ seq: k.seq, t: k.t, kind: k.verdict === "passed" ? "pass" : k.verdict === "failed" ? "fail" : "dot", label: `Kane ${k.label}: ${k.verdict === "passed" ? "PASS" : k.verdict === "failed" ? "FAIL" : k.verdict}`, select: `kane-${k.seq}` });
    for (const d of state.diffs) if (d.files.length) items.push({ seq: d.seq, t: d.t, kind: "patch", label: `Patch #${d.round}: ${d.files.join(", ")}`, select: `diff-${d.seq}` });
    for (const a of state.anticheat) items.push({ seq: a.seq, t: a.t, kind: "tamper", label: `Anti-cheat: ${a.kind}` });
    for (const g of state.gates) if (g.decision === "reject") items.push({ seq: g.seq, t: g.t, kind: "reject", label: "Deploy gate: rejected" });
    if (state.deploy) items.push({ seq: state.deploy.seq, t: state.deploy.t, kind: "deploy", label: "Deployed" });
    items.sort((a, b) => a.t - b.t);
    for (const it of items) it.px = (it.t / total) * size;

    // Key moments that land close together (a cheat is caught within a second) are spread apart
    // on the line and share one label, so marks and labels never sit on top of each other.
    const gap = vert ? 30 : 34;
    const near = vert ? 30 : 96;
    const keyed = items.filter((it) => key.has(it.seq));
    const groups = [];
    for (const it of keyed) {
      const g = groups[groups.length - 1];
      if (g && it.px - g[g.length - 1].px < near) g.push(it);
      else groups.push([it]);
    }
    const labels = [];
    for (const g of groups) {
      const center = Math.min(size - (g.length - 1) * gap / 2 - 12, Math.max((g.length - 1) * gap / 2 + 12, g.reduce((a, it) => a + it.px, 0) / g.length));
      g.forEach((it, i) => { it.px = center + (i - (g.length - 1) / 2) * gap; });
      const last = key.get(g[g.length - 1].seq);
      labels.push({ px: center, tone: last.tone, text: g.map((it) => key.get(it.seq).label.replace(/^The /, "")).join(" · ") });
    }

    for (const it of items) {
      const m = key.get(it.seq);
      const tone = m ? m.tone : "";
      const target = m ? m.id : it.select;
      const btn = el("button", {
        type: "button",
        class: `mark-btn${m ? " big" : ""} ${tone}`,
        "aria-label": `${it.label} at ${fmtAt(it.t)}${m ? ` (${m.label.toLowerCase()})` : ""}`,
        "aria-pressed": target ? String(selected === target) : null,
        disabled: target ? null : true,
        onclick: target ? () => select(target, true) : null,
      }, mark(it.kind));
      marks.append(el("li", { style: `${axis}: ${it.px}px`, class: m ? "key" : "" }, btn));
    }
    for (const l of labels) {
      marks.append(el("li", { class: `label-li${l.px > size - 90 ? " end" : l.px < 90 ? " start" : ""}`, style: `${axis}: ${l.px}px`, "aria-hidden": "true" }, el("span", { class: `mark-label ${l.tone}`, text: l.text })));
    }
  }

  function allPhases() {
    // Phases from the whole run, so the track is laid out from the start, not only up to the playhead.
    const out = [];
    for (const ev of player.events) if (ev.type === "phase" && PHASES.includes(ev.phase)) out.push({ phase: ev.phase, t: ev.t });
    return out;
  }

  function renderMoments(moments) {
    const list = $("moments");
    list.className = `moments${moments.length === 2 ? " two" : ""}`;
    list.replaceChildren();
    if (!moments.length) {
      list.append(el("li", { class: "empty" }, state.kane.length ? "No key moment yet. The first one is Kane's referee verdict, after the bug is hidden." : "No key moment yet. Kane runs two clean baselines first."));
      return;
    }
    for (const m of moments) {
      const isNew = !seenMoments.has(m.id);
      seenMoments.add(m.id);
      const li = el("li", { class: `moment${isNew && player.playing ? " enter" : ""}` },
        el("button", { type: "button", class: "moment-btn", "aria-pressed": String(selected === m.id), onclick: () => { select(m.id, true); $("evidence").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth" }); } },
          el("span", { class: "label", text: m.label }),
          el("span", { class: `moment-word ${m.tone}` }, mark(m.mark), m.word),
          el("span", { class: "moment-meta", text: m.meta }),
          el("span", { class: "moment-detail", text: m.detail }),
          el("span", { class: "moment-foot" }, el("span", { class: "see", text: "See evidence" })),
        ),
        el("button", { type: "button", class: "icon-btn copy-link", "aria-label": `Copy link to ${m.label.toLowerCase()}`, onclick: () => copyLink(m.id) }, icon("link")),
      );
      list.append(li);
    }
  }

  async function copyLink(id) {
    const url = new URL(location.href);
    url.hash = `moment=${id}`;
    try {
      await navigator.clipboard.writeText(url.toString());
      say("Link copied");
    } catch {
      say(url.toString());
    }
  }

  // ── Evidence ─────────────────────────────────────────────────────────────
  function subjectFor(moments) {
    const m = moments.find((x) => x.id === selected);
    if (m) return { title: m.label, subject: m.subject };
    if (selected && selected.startsWith("kane-")) {
      const k = state.kane.find((x) => `kane-${x.seq}` === selected);
      if (k) return { title: `Kane ${k.label}`, subject: { type: "kane", ev: k } };
    }
    if (selected && selected.startsWith("diff-")) {
      const d = state.diffs.find((x) => `diff-${x.seq}` === selected);
      if (d) return { title: `Patch #${d.round}`, subject: { type: "diff", ev: d } };
    }
    return null;
  }

  function renderEvidence(moments) {
    const main = $("ev-main");
    const side = $("ev-side");
    const pick = subjectFor(moments);
    main.replaceChildren();
    side.replaceChildren();
    if (!pick) {
      $("evidence-sub").textContent = "";
      main.append(el("p", { class: "empty" }, "Nothing to show yet. Evidence appears when Kane finishes its first run."));
      side.hidden = true;
      return;
    }
    side.hidden = false;
    const sub = pick.subject;
    $("evidence-sub").textContent = pick.title;
    switch (sub.type) {
      case "kane": kaneEvidence(main, side, sub.ev, sub.miss ? missNote() : null); break;
      case "diff": diffEvidence(main, side, sub.ev); break;
      case "cheat": cheatEvidence(main, side, sub); break;
      case "gate": gateEvidence(main, side, sub); break;
      case "proof": proofEvidence(main, side, sub); break;
      case "cost": costEvidence(main, side); break;
    }
  }

  function missNote() {
    const g = state.ground.chaos;
    const failed = g ? (g.results || []).filter((r) => !r.passed) : [];
    if (!failed.length) return null;
    return el("div", { class: "ev-block" }, el("p", { class: "label", text: "What the oracle saw" }), ...failed.map((r) => el("p", { class: "quote catch", text: `${r.check}: ${r.failure}` })));
  }

  function kaneTitle(k) {
    const word = k.verdict === "passed" ? "PASS" : k.verdict === "failed" ? "FAIL" : k.verdict;
    const tone = k.verdict === "passed" ? (k.kind === "baseline" ? "" : "heal") : k.verdict === "failed" ? "catch" : "cheat";
    return el("h3", { class: "ev-title" }, el("span", { class: "kane-name", text: "Kane" }), `${k.label} · spec ${k.spec}`, el("span", { class: `word ${tone}`, text: word }));
  }

  function summaryBlock(k) {
    const lines = (k.summary || "").split("\n").filter(Boolean);
    if (!lines.length) return null;
    const body = el("div", { class: "summary clamp" }, ...lines.map((l) => (/^\s*evidence:/i.test(l) ? el("p", { class: "evidence-line", text: l.trim() }) : el("p", { text: l }))));
    const wrap = el("div", { class: "ev-block" }, body);
    if (lines.join(" ").length > 220 || lines.length > 3) {
      const btn = el("button", { type: "button", class: "link-btn show-more", "aria-expanded": "false", text: "Show full summary" });
      btn.onclick = () => {
        const open = body.classList.toggle("clamp") === false;
        btn.setAttribute("aria-expanded", String(open));
        btn.textContent = open ? "Show less" : "Show full summary";
      };
      wrap.append(btn);
    }
    return wrap;
  }

  function mediaBlocks(k) {
    const out = [];
    const src = api.file(currentRun, k.video || videoByLabel[k.label]);
    if (src) {
      out.push(el("div", { class: "ev-block" },
        el("video", { class: "video", src: `${src}#t=2.3`, poster: api.file(currentRun, (k.screenshots || []).slice(-6)[0]), controls: true, muted: true, playsinline: true, preload: "none", "aria-label": `Kane ${k.label} run, stitched from its step screenshots` }),
        el("p", { class: "video-note", text: "Kane records no video. This one is stitched from its step screenshots, each captioned with Kane's own step note." }),
      ));
    }
    const shots = (k.screenshots || []).slice(-6);
    if (shots.length) {
      const strip = el("ul", { class: "filmstrip", "aria-label": "Kane screenshots" });
      shots.forEach((shot, i) => {
        const cap = captions[shot] || `Kane ${k.label}, screenshot ${i + 1}`;
        // The caption is the button's name, so the thumbnail itself is decorative.
        strip.append(el("li", {}, el("button", { type: "button", onclick: () => openLightbox(shots, i, k) },
          el("img", { src: api.file(currentRun, shot), alt: "", loading: "lazy" }),
          el("span", { class: "cap", text: cap }),
        )));
      });
      out.push(el("div", { class: "ev-block" }, el("p", { class: "label", text: `Last ${shots.length} screenshots` }), strip));
    }
    return out;
  }

  function kaneSide(side, k) {
    const dl = el("dl", { class: "kv" });
    const row = (a, b) => dl.append(el("dt", {}, a), el("dd", {}, b));
    row("Verdict", `${k.verdict === "passed" ? "PASS" : k.verdict === "failed" ? "FAIL" : k.verdict} · exit ${k.exitCode ?? "—"}`);
    row("Spec", k.spec === "holdout" ? "holdout (hidden from the builder)" : k.spec);
    row("Duration", fmtDur(k.durationMs));
    if (k.credits !== null && k.credits !== undefined) row(el("button", { type: "button", class: "term", "data-term": "credits", text: "Kane credits" }), String(Math.round(k.credits * 10) / 10));
    row("Run", k.fresh ? "Fresh Kane run (not a cached replay)" : "Cached replay");
    if (k.failingStep) row("Failing step", `${k.failingStep.index !== null && k.failingStep.index !== undefined ? `#${k.failingStep.index} ` : ""}${k.failingStep.description || ""}${k.failingStep.reason ? `: ${k.failingStep.reason}` : ""}`);
    if (k.infraReason) row("Infra", k.infraReason);
    row("At", fmtAt(k.t));
    if (k.testUrl) row(el("button", { type: "button", class: "term", "data-term": "sharelink", text: "ShareLink" }), el("a", { class: "ext", href: k.testUrl, target: "_blank", rel: "noopener noreferrer" }, "Open in Kane's dashboard", icon("external")));
    side.append(el("p", { class: "label", text: "Kane run" }), dl);
  }

  function kaneEvidence(main, side, k, extra) {
    main.append(kaneTitle(k));
    const s = summaryBlock(k);
    if (s) main.append(s);
    if (extra) main.append(extra);
    main.append(...mediaBlocks(k));
    kaneSide(side, k);
  }

  function diffView(patch, files) {
    const pre = el("pre", { class: "diff", tabindex: "0", "aria-label": `Patch diff for ${files || "the app"}` });
    if (!patch || !patch.trim()) {
      pre.append(el("span", { class: "ln" }, el("span", { class: "no" }), el("span", { class: "no" }), el("span", { class: "sign" }), el("span", { class: "code", text: "No diff yet." })));
      return pre;
    }
    let oldN = 0, newN = 0;
    for (const line of patch.replace(/\n+$/, "").split("\n")) {
      if (line.startsWith("=====") || line.startsWith("Index:")) continue;
      let cls = "", a = "", b = "", sign = "", code = line;
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      if (line.startsWith("+++") || line.startsWith("---")) cls = "file";
      else if (hunk) { cls = "hunk"; oldN = Number(hunk[1]); newN = Number(hunk[2]); }
      else if (line.startsWith("+")) { cls = "add"; sign = "+"; code = line.slice(1); b = String(newN++); }
      else if (line.startsWith("-")) { cls = "del"; sign = "−"; code = line.slice(1); a = String(oldN++); }
      else if (line.length || oldN) { code = line.slice(1); a = String(oldN++); b = String(newN++); }
      if (cls === "file" || cls === "hunk") pre.append(el("span", { class: `ln ${cls}` }, el("span", { class: "no" }), el("span", { class: "no" }), el("span", { class: "sign" }), el("span", { class: "code", text: line })));
      else pre.append(el("span", { class: `ln ${cls}` }, el("span", { class: "no", text: a }), el("span", { class: "no", text: b }), el("span", { class: "sign", text: sign }), el("span", { class: "code", text: code || " " })));
    }
    return pre;
  }

  function diffEvidence(main, side, d) {
    main.append(el("h3", { class: "ev-title" }, `Builder patch, round ${d.round}`), diffView(d.patch, d.files.join(", ")));
    const b = state.builder[d.round] || {};
    const c = diffCounts(d.patch);
    const dl = el("dl", { class: "kv" });
    const row = (k, v) => dl.append(el("dt", { text: k }), el("dd", {}, v));
    row("Files changed", d.files.join(", ") || "none");
    row("Lines", `+${c.add} −${c.del}`);
    row("Builder", run ? builderName(run.builder) : "—");
    row("Tokens", b.tokens ? fmtNum(b.tokens.total) : "not reported");
    row("Builder time", fmtDur(b.durationMs));
    if (d.reverted && d.reverted.length) row("Reverted", d.reverted.join(", "));
    row("Prompt", "Kane's evidence only. No diff, no bug name.");
    side.append(el("p", { class: "label", text: "Patch" }), dl);
  }

  function gateChecks(side, checks) {
    const ul = el("ul", { class: "check-list" });
    for (const [tone, kind, text] of checks) ul.append(el("li", {}, el("span", { class: tone }, mark(kind)), el("span", { text })));
    side.append(el("p", { class: "label", text: "What the deploy gate checked" }), ul);
  }

  function cheatEvidence(main, side, sub) {
    const files = (sub.ev.files || []).join(", ");
    main.append(
      el("h3", { class: "ev-title" }, el("span", { class: "word cheat", text: "Spec tamper" }), `round ${sub.ev.round || 1}`),
      el("p", { class: "measure", text: "No patch shipped. Instead of fixing the app, the builder changed the Kane spec that was failing." }),
      el("div", { class: "ev-block" }, el("p", { class: "label", text: "File changed" }), el("p", { class: "quote", text: files })),
    );
    if (sub.gate) main.append(el("div", { class: "ev-block" }, el("p", { class: "label", text: "Gate message" }), ...(sub.gate.reasons || []).map((r) => el("p", { class: "quote", text: r }))));
    gateChecks(side, [
      ["catch", "fail", `Spec hashes: ${files} changed. Restored.`],
      ["muted", "dot", "Source allowlist: not reached"],
      ["muted", "dot", "Two fresh Kane passes: not reached"],
      ["muted", "dot", "Hidden holdout: not reached"],
      ["cheat", "reject", "Decision: rejected, nothing deployed"],
    ]);
  }

  function gateEvidence(main, side, sub) {
    if (sub.tamper) return cheatEvidence(main, side, { ev: sub.tamper, gate: sub.ev });
    main.append(el("h3", { class: "ev-title" }, el("span", { class: "word cheat", text: "Rejected" }), "by the deploy gate"));
    main.append(el("div", { class: "ev-block" }, el("p", { class: "label", text: "Gate message" }), ...(sub.ev.reasons || []).map((r) => el("p", { class: "quote", text: r }))));
    if (sub.kane) {
      main.append(el("div", { class: "ev-block" }, kaneTitle(sub.kane)));
      const s = summaryBlock(sub.kane);
      if (s) main.append(s);
      main.append(...mediaBlocks(sub.kane));
    }
    const before = state.kane.filter((k) => k.kind === "verify" && k.t < sub.ev.t);
    gateChecks(side, [
      ...before.map((k) => [k.verdict === "passed" ? "heal" : "catch", k.verdict === "passed" ? "pass" : "fail", `Kane ${k.label} (visible spec): ${k.verdict === "passed" ? "PASS" : "FAIL"}`]),
      sub.kane ? ["catch", "fail", `Kane ${sub.kane.label} (hidden holdout): FAIL`] : ["muted", "dot", "Hidden holdout"],
      ["cheat", "reject", "Decision: rejected, nothing deployed"],
    ]);
    if (sub.kane) kaneSide(side, sub.kane);
  }

  function proofEvidence(main, side, sub) {
    const runs = sub.runs;
    const pickK = runs.find((k) => k.seq === proofPick) || runs.find((k) => k.kind === "holdout") || runs[runs.length - 1];
    const list = el("ol", { class: "runs-list", "aria-label": "Kane runs after the patch" });
    for (const k of runs) {
      list.append(el("li", {}, el("button", { type: "button", "aria-pressed": String(pickK && k.seq === pickK.seq), onclick: () => { proofPick = k.seq; render(); } },
        el("span", { class: "word heal" }, mark("pass")),
        el("span", {}, `Kane ${k.label}`, el("span", { class: "ink-2", text: ` · ${k.kind === "holdout" ? "hidden holdout" : "visible spec"}` })),
        el("span", { class: "mono ink-2", text: `PASS · ${fmtDur(k.durationMs)}` }),
      )));
    }
    list.append(el("li", {}, el("button", { type: "button", disabled: true },
      el("span", { class: "word heal" }, mark("deploy")), el("span", { text: "Deployed" }), el("span", { class: "mono ink-2", text: fmtAt(sub.deploy.t) }))));
    main.append(el("h3", { class: "ev-title" }, el("span", { class: "word heal", text: "Deployed" }), "after the gate"), list);
    if (pickK) {
      main.append(el("div", { class: "ev-block" }, kaneTitle(pickK)));
      const s = summaryBlock(pickK);
      if (s) main.append(s);
      main.append(...mediaBlocks(pickK));
    }
    gateChecks(side, [
      ...runs.map((k) => ["heal", "pass", `Kane ${k.label} (${k.kind === "holdout" ? "hidden holdout" : "visible spec"}): PASS`]),
      ["heal", "pass", "Specs unchanged since the run started"],
      ["heal", "pass", "Source unchanged since verify"],
      ["heal", "deploy", "Decision: deployed"],
    ]);
    if (pickK) kaneSide(side, pickK);
  }

  function costEvidence(main, side) {
    const b = state.bug;
    main.append(el("h3", { class: "ev-title" }, el("span", { class: "word catch", text: "Would ship" }), "with the bug"));
    if (b) main.append(el("p", { class: "measure", text: `${b.title}: ${b.description}` }));
    const n = missNote();
    if (n) main.append(n);
    main.append(el("div", { class: "ev-block" }, el("p", { class: "label", text: "Injected diff" }), diffView(state.chaosDiff, "the injected bug")));
    const dl = el("dl", { class: "kv" });
    const row = (k, v) => dl.append(el("dt", { text: k }), el("dd", {}, v));
    row("Outcome", "Miss logged");
    row("Builder", "Never asked to heal: Kane gave it nothing to fix");
    row("Why", "The bug sits off the path Kane's spec walks");
    if (state.specAgent) row("Spec agent", state.specAgent.caught ? "Wrote a new Kane flow that catches it" : `No catch${state.specAgent.reason ? `: ${state.specAgent.reason}` : ""}`);
    side.append(el("p", { class: "label", text: "Miss" }), dl);
  }

  // ── Chaos and ground truth ───────────────────────────────────────────────
  function renderChaos() {
    const b = state.bug || (run && run.bug && state.status ? run.bug : null);
    $("bug-name").textContent = b ? (b.surface && b.surface !== b.bugClass ? `${b.surface} · ${b.id}` : `${b.bugClass} · ${b.id}`) : "Not hidden yet";
    $("bug-desc").textContent = b ? `${b.description}${b.kaneHypothesis ? ` Expected Kane result before the run: ${b.kaneHypothesis}.` : ""}` : "Chaos hides one bug after two clean baseline passes.";
    const pre = $("chaos-diff");
    pre.replaceChildren(diffView(state.chaosDiff, "the injected bug"));
    const inner = pre.firstChild;
    if (inner) { pre.replaceChildren(...inner.childNodes); }

    const table = $("gt");
    table.replaceChildren();
    const cols = ["baseline", "chaos", "final"];
    table.append(el("caption", { class: "sr", text: "Oracle check results by phase" }));
    table.append(el("thead", {}, el("tr", {}, el("th", { scope: "col", text: "Check" }), ...cols.map((c) => el("th", { scope: "col", text: c[0].toUpperCase() + c.slice(1) })))));
    const body = el("tbody");
    for (const c of ["main", "holdout", "invalid-email", "double-click"]) {
      body.append(el("tr", {}, el("th", { scope: "row", text: c }), ...cols.map((p) => {
        const g = state.ground[p];
        if (!g) return el("td", { class: "dim", text: "— not run" });
        if (!g.available) return el("td", { class: "dim", text: "— unavailable" });
        const r = (g.results || []).find((x) => x.check === c);
        if (!r) return el("td", { class: "dim", text: "— not run" });
        return r.passed ? el("td", { text: "✓ pass" }) : el("td", { class: "fail", title: r.failure || "" }, "✗ FAIL", el("span", { class: "sr", text: `: ${r.failure || ""}` }));
      })));
    }
    table.append(body);
  }

  // ── Event log ────────────────────────────────────────────────────────────
  const LOG_GROUPS = {
    phase: ["phase", "run_start", "run_end"],
    kane: ["kane_start", "kane_end", "kane_infra", "verdict"],
    builder: ["heal_start", "builder_end", "diff", "build_start", "build_end", "round_end"],
    gate: ["gate", "anticheat", "deploy"],
    "ground truth": ["ground_truth", "chaos_applied", "spec_agent", "mutator"],
  };
  const logOn = new Set(Object.keys(LOG_GROUPS));
  const expanded = new Set();
  let logRendered = -1;

  function describe(ev) {
    switch (ev.type) {
      case "run_start": return `run ${ev.runId} · seed ${ev.seed} · builder ${ev.builder}`;
      case "phase": return `${ev.phase}${ev.round ? ` (round ${ev.round})` : ""}`;
      case "kane_start": return `${ev.label} → spec ${ev.spec}${ev.attempt ? ` (retry ${ev.attempt})` : ""}`;
      case "kane_end": return `${ev.label}: ${ev.verdict} (exit ${ev.exitCode ?? "—"})${ev.summary ? `. ${ev.summary}` : ""}`;
      case "kane_infra": return `${ev.label}: infra ${ev.verdict}. ${ev.reason || ""} (not sent to the builder)`;
      case "chaos_applied": return `bug hidden: ${ev.bug?.id} [${ev.bug?.bugClass}]`;
      case "verdict": return ev.verdict === "CATCH" ? "CATCH: Kane exit 1, its evidence becomes the heal prompt" : "MISS: Kane passed with the bug present";
      case "heal_start": return `round ${ev.round}: prompt built from Kane's ${ev.flow} evidence`;
      case "builder_end": return `builder exit ${ev.exitCode}${ev.timedOut ? " (timeout)" : ""} · ${ev.tokens ? `${fmtNum(ev.tokens.total)} tokens` : "tokens not reported"} · ${fmtDur(ev.durationMs)}`;
      case "diff": return `patch: ${ev.files.join(", ") || "no files"}${ev.reverted?.length ? ` · reverted ${ev.reverted.join(", ")}` : ""}`;
      case "anticheat": return `anti-cheat ${ev.kind}: ${(ev.files || []).join(", ")}`;
      case "build_start": return `build ${ev.tag}`;
      case "build_end": return `build ${ev.tag}: ${ev.ok ? "ok" : "FAILED"} (${fmtDur(ev.durationMs)})`;
      case "ground_truth": return `oracle ${ev.phase}: ${ev.available ? (ev.failing.length ? `failing ${ev.failing.join(", ")}` : "all pass") : "unavailable"}`;
      case "round_end": return `round ${ev.round}: ${ev.outcome}`;
      case "gate": return `gate ${ev.decision}: ${(ev.reasons || []).join("; ")}`;
      case "deploy": return "deployed";
      case "spec_agent": return `spec agent: ${ev.caught ? "a new flow catches the bug" : `no catch${ev.reason ? ` (${ev.reason})` : ""}`}`;
      case "mutator": return `mutator attempt ${ev.attempt}: ${ev.ok ? "valid bug" : ev.reason}`;
      case "run_end": return `${ev.status}: ${ev.reason || ""}`;
      default: return ev.type;
    }
  }
  const groupOf = (type) => Object.keys(LOG_GROUPS).find((g) => LOG_GROUPS[g].includes(type)) || "phase";

  function renderLogChips() {
    const chips = $("log-chips");
    chips.replaceChildren(...Object.keys(LOG_GROUPS).map((g) => el("button", {
      type: "button", "aria-pressed": String(logOn.has(g)), text: g,
      onclick: () => { logOn.has(g) ? logOn.delete(g) : logOn.add(g); renderLogChips(); logRendered = -1; renderLog(); },
    })));
  }

  function renderLog() {
    const evs = player.events;
    $("log-count").textContent = `· ${plural(evs.length, "event")}`;
    const details = $("log");
    if (!details.open && logRendered !== -1) return;
    const list = $("log-list");
    const current = player.idx - 1;
    if (logRendered !== evs.length) {
      list.replaceChildren(...evs.map((ev, i) => {
        if (!logOn.has(groupOf(ev.type))) return null;
        const text = describe(ev);
        const open = expanded.has(i);
        return el("li", { "data-i": String(i) },
          el("button", { type: "button", class: "t", "aria-label": `Seek to ${fmtAt(ev.t)}`, text: fmtAt(ev.t), onclick: () => seekIndex(i + 1) }),
          el("span", { class: "k", text: ev.type }),
          el("button", { type: "button", class: "txt", "aria-expanded": String(open), text, onclick: (e) => {
            const btn = e.currentTarget;
            const now = btn.getAttribute("aria-expanded") !== "true";
            btn.setAttribute("aria-expanded", String(now));
            now ? expanded.add(i) : expanded.delete(i);
          } }),
        );
      }).filter(Boolean));
      logRendered = evs.length;
    }
    for (const li of list.children) {
      const i = Number(li.dataset.i);
      li.classList.toggle("future", i > current);
      if (i === current) li.setAttribute("aria-current", "true");
      else li.removeAttribute("aria-current");
    }
  }

  // ── Across all runs ──────────────────────────────────────────────────────
  function renderAcross() {
    const { runs, stats, calibration } = runsIndex;
    if (!stats) return;
    $("across-h").textContent = `Across ${plural(runs.length, "run")}`;
    const by = (st) => runs.filter((r) => r.status === st).length;
    const parts = [`Kane caught ${stats.catches} of ${plural(stats.bugsInjected, "hidden bug")}${stats.misses ? ` and missed ${stats.misses}` : ""}.`];
    const tail = [];
    if (by("healed")) tail.push(`${plural(by("healed"), "run")} healed and deployed`);
    if (by("rejected")) tail.push(`${by("rejected")} rejected by the gate`);
    if (by("aborted")) tail.push(`${by("aborted")} aborted`);
    if (tail.length) parts.push(`${tail.join(", ")}.`.replace(/^./, (c) => c.toUpperCase()));
    $("across-lead").textContent = parts.join(" ");
    $("across-cal").textContent = calibration
      ? `Separately, every bug in the chaos library was run once against Kane's main spec: Kane caught ${calibration.caught} of ${calibration.total}. The misses are bugs off the path the spec walks.`
      : "";

    const dl = $("across-dl");
    dl.replaceChildren();
    const row = (k, v) => dl.append(el("dt", {}, k), el("dd", { text: v }));
    row("Average rounds to green", stats.avgRoundsToGreen === null ? "—" : stats.avgRoundsToGreen.toFixed(1));
    row("Average time to heal", fmtDur(stats.avgTimeToHealMs));
    row("Tokens per heal", fmtNum(stats.avgTokensPerHeal));
    const holdoutRuns = runs.filter((r) => r.holdoutFailures > 0).length;
    row(el("button", { type: "button", class: "term", "data-term": "holdout", text: "Holdout failures" }), plural(holdoutRuns, "run"));
    row(el("button", { type: "button", class: "term", "data-term": "false-green", text: "False greens" }), String(stats.falseGreens));

    const table = $("across-table");
    table.replaceChildren(el("caption", { class: "sr", text: "Bugs by class across all runs" }));
    table.append(el("thead", {}, el("tr", {}, ...["Bug class", "Injected", "Caught", "Missed", "Healed"].map((h) => el("th", { scope: "col", text: h })))));
    const body = el("tbody");
    const thisClass = run && run.bug ? run.bug.bugClass : null;
    for (const [cls, v] of Object.entries(stats.byClass || {})) {
      body.append(el("tr", {},
        el("th", { scope: "row" }, cls, cls === thisClass ? el("span", { class: "this-run", text: "this run" }) : null),
        el("td", { text: String(v.injected) }), el("td", { text: String(v.caught) }),
        el("td", { class: v.missed ? "fail" : "", text: String(v.missed) }), el("td", { text: String(v.healed) }),
      ));
    }
    table.append(body);
  }

  // ── Announcements ────────────────────────────────────────────────────────
  let lastSaid = "";
  function say(msg) {
    if (msg && msg !== lastSaid) {
      lastSaid = msg;
      $("live-region").textContent = msg;
    }
  }
  let lastPhaseSaid = null;
  let lastMomentCount = 0;
  function announce(moments) {
    if (state.status && lastPhaseSaid !== "END") {
      lastPhaseSaid = "END";
      say(`${$("verdict-word").textContent}. ${$("verdict-sentence").textContent}`);
    } else if (!state.status && state.phase && state.phase !== lastPhaseSaid && player.playing) {
      lastPhaseSaid = state.phase;
      say(`Phase: ${state.phase.toLowerCase()}`);
    }
    if (moments.length > lastMomentCount && player.playing) say(`${moments[moments.length - 1].label}: ${moments[moments.length - 1].word}`);
    lastMomentCount = moments.length;
  }

  // ── Selection and deep links ─────────────────────────────────────────────
  function select(id, byUser) {
    selected = id;
    if (byUser) userSelected = true;
    proofPick = null;
    render();
  }
  function syncHash() {
    if (!currentRun) return;
    const url = new URL(location.href);
    url.searchParams.set("run", currentRun);
    url.hash = selected && userSelected ? `moment=${selected}` : "";
    if (url.toString() !== location.href) history.replaceState(null, "", url);
  }

  // ── Replay engine ────────────────────────────────────────────────────────
  function applyUntil(n) {
    n = Math.max(0, Math.min(player.events.length, n));
    if (n < player.idx) {
      state = fresh();
      player.idx = 0;
    }
    while (player.idx < n) reduce(state, player.events[player.idx++]);
  }
  function seekIndex(n) {
    const was = player.playing;
    pause();
    applyUntil(n);
    render();
    if (was && player.idx < player.events.length) play();
  }
  function seekTime(ms) {
    let n = 0;
    while (n < player.events.length && player.events[n].t <= ms) n++;
    seekIndex(n);
  }
  function skipToEnd() {
    pause();
    applyUntil(player.events.length);
    render();
  }
  function stepTimer() {
    if (!player.playing) return;
    if (player.idx >= player.events.length) { pause(); render(); return; }
    reduce(state, player.events[player.idx++]);
    render();
    if (player.idx >= player.events.length) { pause(); render(); return; }
    const gap = Math.min(2500, Math.max(60, (player.events[player.idx].t - player.events[player.idx - 1].t) / player.speed));
    player.timer = setTimeout(stepTimer, gap);
  }
  function play() {
    if (live) return;
    if (player.idx >= player.events.length) { applyUntil(0); seenMoments.clear(); lastStatus = null; lastPhaseSaid = null; }
    player.playing = true;
    userSelected = false;
    updatePlayButton();
    stepTimer();
  }
  function pause() {
    player.playing = false;
    clearTimeout(player.timer);
    updatePlayButton();
  }
  function replayFromStart() {
    pause();
    state = fresh();
    player.idx = 0;
    seenMoments.clear();
    lastStatus = null;
    lastPhaseSaid = null;
    userSelected = false;
    selected = null;
    render();
    play();
  }
  function setSpeed(v) {
    player.speed = v;
    for (const b of document.querySelectorAll(".speed button")) b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === v));
  }
  function updatePlayButton() {
    const b = $("btn-play");
    b.replaceChildren(icon(player.playing ? "pause" : "play"));
    b.setAttribute("aria-label", player.playing ? "Pause replay" : "Play replay");
    const hw = $("hero-watch"); if (hw) hw.hidden = player.playing || live;
    const r = $("btn-replay");
    r.replaceChildren(icon("rotate"), "Replay this run");
  }
  function stepEvent(dir) { seekIndex(player.idx + dir); }
  function stepMoment(dir) {
    const ms = deriveMomentsAt(player.events.length).filter((m) => m.seq !== null);
    const now = state.t;
    const target = dir > 0 ? ms.find((m) => m.t > now) : [...ms].reverse().find((m) => m.t < now);
    if (target) {
      seekTime(target.t);
      select(target.id, true);
    }
  }
  function deriveMomentsAt(n) {
    const s = fresh();
    for (let i = 0; i < n; i++) reduce(s, player.events[i]);
    return deriveMoments(s);
  }

  // Scrubbing on the rail: click or drag.
  function railToTime(e) {
    const r = $("rail").getBoundingClientRect();
    const f = vertical.matches ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    return Math.max(0, Math.min(1, f)) * totalMs();
  }
  function bindRail() {
    const rail = $("rail");
    let dragging = false;
    rail.addEventListener("pointerdown", (e) => {
      if (live) return;
      dragging = true;
      rail.setPointerCapture(e.pointerId);
      pause();
      seekTime(railToTime(e));
    });
    rail.addEventListener("pointermove", (e) => { if (dragging) seekTime(railToTime(e)); });
    rail.addEventListener("pointerup", () => { dragging = false; });
    rail.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); e.shiftKey ? stepMoment(1) : stepEvent(1); }
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); e.shiftKey ? stepMoment(-1) : stepEvent(-1); }
    });
  }

  function bindKeys() {
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || t.closest("dialog[open]") || t.closest("#run-list"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey || live) return;
      const onButton = t && t.closest("button, a, summary");
      switch (e.key) {
        case " ":
          if (onButton) return;
          e.preventDefault();
          player.playing ? pause() : play();
          break;
        case "ArrowRight": e.preventDefault(); e.shiftKey ? stepMoment(1) : stepEvent(1); break;
        case "ArrowLeft": e.preventDefault(); e.shiftKey ? stepMoment(-1) : stepEvent(-1); break;
        case "Home": e.preventDefault(); seekIndex(0); break;
        case "End": e.preventDefault(); skipToEnd(); break;
        case "1": setSpeed(1); break;
        case "2": setSpeed(4); break;
        case "3": setSpeed(16); break;
        case "?": openDialog("keys"); break;
      }
    });
  }

  // ── Dialogs: glossary, lightbox, shortcuts ───────────────────────────────
  function openDialog(id, term) {
    const d = $(id);
    if (!d.open) d.showModal();
    if (term) {
      const dt = document.getElementById(`g-${term}`);
      if (dt) {
        dt.scrollIntoView({ block: "center" });
        dt.classList.add("flash");
        setTimeout(() => dt.classList.remove("flash"), 1600);
      }
    }
  }
  function bindDialogs() {
    for (const d of document.querySelectorAll("dialog")) {
      for (const c of d.querySelectorAll("[data-close]")) {
        c.replaceChildren(icon("x"));
        c.addEventListener("click", () => d.close());
      }
      d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    }
    $("help-btn").addEventListener("click", () => openDialog("glossary"));
    $("foot-glossary").addEventListener("click", () => openDialog("glossary"));
    $("btn-keys").replaceChildren(icon("keyboard"));
    $("btn-keys").addEventListener("click", () => openDialog("keys"));
    document.addEventListener("click", (e) => {
      const term = e.target.closest && e.target.closest(".term");
      if (term) openDialog("glossary", term.dataset.term);
    });
    $("lb-prev").addEventListener("click", () => lightboxStep(-1));
    $("lb-next").addEventListener("click", () => lightboxStep(1));
    $("lightbox").addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") lightboxStep(-1);
      if (e.key === "ArrowRight") lightboxStep(1);
    });
  }
  const lb = { shots: [], i: 0, k: null };
  function openLightbox(shots, i, k) {
    lb.shots = shots; lb.i = i; lb.k = k;
    showLightbox();
    openDialog("lightbox");
  }
  function lightboxStep(d) {
    lb.i = (lb.i + d + lb.shots.length) % lb.shots.length;
    showLightbox();
  }
  function showLightbox() {
    const shot = lb.shots[lb.i];
    const cap = captions[shot] || `Kane ${lb.k.label}, screenshot ${lb.i + 1}`;
    $("lb-img").src = api.file(currentRun, shot);
    $("lb-img").alt = cap;
    $("lb-caption").textContent = cap;
    $("lb-count").textContent = `Kane ${lb.k.label} · ${lb.i + 1} of ${lb.shots.length}`;
  }

  // ── Theme ────────────────────────────────────────────────────────────────
  function currentTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function paintThemeButton() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    const b = $("theme-btn");
    b.replaceChildren(icon(next === "light" ? "sun" : "moon"));
    b.setAttribute("aria-label", `Switch to ${next} theme`);
  }
  function bindTheme() {
    paintThemeButton();
    $("theme-btn").addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("hydra-theme", next); } catch { /* private mode */ }
      paintThemeButton();
    });
  }

  // ── Run picker ───────────────────────────────────────────────────────────
  const OUTCOME = { healed: ["Healed", "deploy", "heal"], rejected: ["Rejected", "tamper", "cheat"], miss: ["Missed", "fail", "catch"], aborted: ["Aborted", "reject", ""], running: ["Live", "dot", "catch"] };
  function runText(r) { return `seed ${r.seed} · ${r.bug ? r.bug.id : "no bug"} · ${r.builder}`; }
  function renderPicker() {
    const list = $("run-list");
    list.replaceChildren(...runsIndex.runs.map((r, i) => {
      const [word, mk, tone] = OUTCOME[r.status] || [r.status, "dot", ""];
      const li = el("li", { role: "option", id: `opt-${i}`, "aria-selected": String(r.runId === currentRun), "data-run": r.runId },
        el("span", { class: `word ${tone}` }, mark(mk)),
        el("span", { text: runText(r) }),
        el("span", { class: `opt-out word ${tone}`, text: word }),
      );
      li.addEventListener("click", () => { closePicker(); chooseRun(r.runId); });
      return li;
    }));
    const cur = runsIndex.runs.find((r) => r.runId === currentRun);
    const btn = $("run-btn");
    btn.replaceChildren(el("span", { id: "run-btn-text", text: cur ? `${runText(cur)} · ${(OUTCOME[cur.status] || [cur.status])[0].toLowerCase()}` : "Choose a run" }), icon("chevron"));
    btn.setAttribute("aria-label", cur ? `Run: ${runText(cur)}, ${cur.status}. Choose another run` : "Choose a run");
  }
  let activeOpt = 0;
  function openPicker() {
    const list = $("run-list");
    list.hidden = false;
    $("run-btn").setAttribute("aria-expanded", "true");
    activeOpt = Math.max(0, runsIndex.runs.findIndex((r) => r.runId === currentRun));
    paintActive();
    list.focus();
  }
  function closePicker(focusBtn) {
    $("run-list").hidden = true;
    $("run-btn").setAttribute("aria-expanded", "false");
    if (focusBtn) $("run-btn").focus();
  }
  function paintActive() {
    const list = $("run-list");
    [...list.children].forEach((li, i) => li.classList.toggle("active", i === activeOpt));
    list.setAttribute("aria-activedescendant", `opt-${activeOpt}`);
    const li = list.children[activeOpt];
    if (li) li.scrollIntoView({ block: "nearest" });
  }
  function bindPicker() {
    $("run-btn").addEventListener("click", () => ($("run-list").hidden ? openPicker() : closePicker()));
    $("run-list").addEventListener("keydown", (e) => {
      const n = runsIndex.runs.length;
      if (e.key === "ArrowDown") { e.preventDefault(); activeOpt = (activeOpt + 1) % n; paintActive(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeOpt = (activeOpt - 1 + n) % n; paintActive(); }
      else if (e.key === "Home") { e.preventDefault(); activeOpt = 0; paintActive(); }
      else if (e.key === "End") { e.preventDefault(); activeOpt = n - 1; paintActive(); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const r = runsIndex.runs[activeOpt]; closePicker(true); if (r) chooseRun(r.runId); }
      else if (e.key === "Escape" || e.key === "Tab") closePicker(e.key === "Escape");
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".picker")) closePicker(); });
  }

  // ── Data sources ─────────────────────────────────────────────────────────
  function stopSource() {
    if (source) source.stop();
    source = null;
    pause();
  }

  function playLive(runId) {
    const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`);
    let scheduled = false;
    es.onmessage = (msg) => {
      const ev = JSON.parse(msg.data);
      player.events.push(ev);
      reduce(state, ev);
      player.idx = player.events.length;
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; render(); });
      }
    };
    es.addEventListener("done", async () => {
      es.close();
      live = false;
      setMode();
      await refreshRuns();
      run = await api.run(runId).catch(() => run);
      render();
    });
    es.onerror = () => { /* EventSource reconnects; the server resends everything from the start */ };
    es.onopen = () => { state = fresh(); player.events = []; player.idx = 0; };
    source = { stop: () => es.close() };
  }

  function setMode() {
    $("mode").textContent = live ? "Live" : "Replay";
    $("mode").className = `mode${live ? " live" : ""}`;
    $("controls").classList.toggle("live", live);
  }

  function chooseRun(runId, opts = { autoplay: true }) {
    const url = new URL(location.href);
    url.searchParams.set("run", runId);
    url.searchParams.delete("t");
    url.hash = "";
    history.pushState(null, "", url);
    load(runId, opts);
  }

  // ── Landing: what Hydra is, and the runs to pick from ───────────────────
  const STORY = {
    healed: (r) => `Kane caught the ${r.bug ? r.bug.id : ""} bug. The builder fixed it from Kane's evidence alone, and the fix shipped.`,
    rejected: () => "Kane caught the bug. The builder edited Kane's test instead of fixing the code. The gate caught that too.",
    miss: (r) => `Kane's test passed with the ${r.bug ? r.bug.id : ""} bug still in the app. An honest miss.`,
    aborted: (r) => r.holdoutFailures ? "The fix fooled Kane's visible test twice, then failed the hidden one. Nothing shipped." : "The run stopped before a fix shipped.",
    running: () => "Happening right now.",
  };
  function showHome() {
    stopSource();
    currentRun = null;
    $("home").hidden = false;
    $("report").hidden = true;
    document.title = "Hydra Arena";
    const runs = runsIndex.runs || [];
    $("home-count").textContent = runs.length ? plural(runs.length, "recorded run") : "";
    const cards = $("run-cards");
    if (!runs.length) {
      cards.replaceChildren(el("li", { class: "empty" }, "No runs yet. Start one with: hydra run"));
    } else {
      cards.replaceChildren(...runs.map((r) => {
        const [word, mk, tone] = OUTCOME[r.status] || [r.status, "dot", ""];
        return el("li", {}, el("button", { type: "button", class: "run-card", onclick: () => chooseRun(r.runId) },
          el("span", { class: `rc-word ${tone || "muted"}` }, mark(mk), word),
          el("span", { class: "rc-story", text: (STORY[r.status] || (() => ""))(r) }),
          el("span", { class: "rc-meta", text: `${builderName(r.builder)} · ${r.bug ? r.bug.id : "no bug"} · seed ${r.seed} · ${fmtDur(r.durationMs)}` }),
          el("span", { class: "rc-go", text: "Watch the run" }),
        ));
      }));
    }
    renderPicker();
    window.scrollTo(0, 0);
  }

  async function load(runId, opts) {
    stopSource();
    state = fresh();
    run = null;
    player.events = [];
    player.idx = 0;
    selected = null;
    userSelected = false;
    proofPick = null;
    seenMoments.clear();
    lastStatus = null;
    lastPhaseSaid = null;
    lastMomentCount = 0;
    logRendered = -1;
    expanded.clear();
    currentRun = runId;
    $("home").hidden = true;
    $("report").hidden = false;
    window.scrollTo(0, 0);
    renderPicker();
    if (!runId) { render(); return; }
    run = await api.run(runId);
    captions = run.captions || {};
    videoByLabel = {};
    const ks = [...(run.baseline || []), ...(run.referee ? [run.referee.kane] : []), ...(run.rounds || []).flatMap((h) => h.verify || [])];
    for (const k of ks) if (k && k.video) videoByLabel[k.label] = k.video;
    live = !STATIC && mode === "live" && run.status === "running" && !opts.forceReplay;
    setMode();
    renderAcross();
    if (live) {
      playLive(runId);
      render();
      return;
    }
    player.events = await api.events(runId);
    if (opts.moment) { selected = opts.moment; userSelected = true; }
    if (opts.autoplay) {
      applyUntil(0);
      render();
      play();
    } else if (opts.t !== undefined && opts.t !== null && !Number.isNaN(opts.t)) {
      applyUntil(0);
      seekTime(opts.t * 1000);
    } else {
      skipToEnd(); // a finished run opens finished: the answer first
    }
    if (opts.moment) {
      requestAnimationFrame(() => $("evidence").scrollIntoView({ block: "start" }));
    }
  }

  async function refreshRuns() {
    try {
      runsIndex = await api.runs();
      renderAcross();
      renderPicker();
    } catch (err) {
      console.error(err);
    }
  }

  async function boot() {
    bindDialogs();
    bindTheme();
    bindPicker();
    bindRail();
    bindKeys();
    renderLogChips();
    updatePlayButton();
    for (const b of document.querySelectorAll(".speed button")) b.addEventListener("click", () => setSpeed(Number(b.dataset.speed)));
    $("btn-play").addEventListener("click", () => (player.playing ? pause() : play()));
    $("btn-replay").addEventListener("click", replayFromStart);
    $("hero-watch").addEventListener("click", replayFromStart);
    $("btn-end").addEventListener("click", skipToEnd);
    $("log").addEventListener("toggle", () => { logRendered = -1; renderLog(); });
    vertical.addEventListener("change", () => render());
    let resizeTimer = null;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => render(), 120); });

    const cfg = await api.config();
    mode = cfg.mode;
    await refreshRuns();
    const url = new URL(location.href);
    const runs = runsIndex.runs || [];
    const wanted = url.searchParams.get("run") || cfg.focusRun || (runs.find((r) => r.status === "running") || {}).runId;
    const moment = /moment=([\w-]+)/.exec(location.hash);
    const t = url.searchParams.get("t");
    if (wanted && runs.some((r) => r.runId === wanted)) {
      await load(wanted, { moment: moment ? moment[1] : null, t: t !== null ? Number(t) : null });
    } else {
      showHome();
    }
    window.addEventListener("popstate", () => {
      const id = new URL(location.href).searchParams.get("run");
      if (id && runsIndex.runs.some((r) => r.runId === id)) load(id, {});
      else showHome();
    });

    if (!STATIC && mode === "live") {
      setInterval(async () => {
        const before = new Set(runsIndex.runs.map((r) => r.runId));
        await refreshRuns();
        const newest = runsIndex.runs.find((r) => r.status === "running" && !before.has(r.runId));
        if (newest) chooseRun(newest.runId);
      }, 3000);
    }
  }

  boot().catch((err) => {
    console.error(err);
    $("verdict-word").textContent = "Error";
    $("verdict-sentence").textContent = `The arena failed to load: ${err.message}`;
  });
})();

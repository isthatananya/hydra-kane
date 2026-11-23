/* Leaderboard: coding agents ranked from recorded runs, and Kane's catch map from the chaos calibration. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const dur = (ms) => (ms === null || ms === undefined ? "—" : `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}s`);
  const num = (x) => (x === null || x === undefined ? "—" : Math.round(x).toLocaleString("en-US"));
  const avg = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  const NAMES = {
    claude: ["Claude Code", "Anthropic's coding agent"],
    opencode: ["opencode", "open-source agent, free default model"],
    cheater: ["Cheater", "built to cheat: edits Kane's test"],
    hardcoder: ["Hardcoder", "built to cheat: hardcodes the expected totals"],
  };

  async function load() {
    for (const u of ["data/runs.json", "/api/runs"]) {
      try { const r = await fetch(u, { cache: "no-store" }); if (r.ok) return r.json(); } catch { /* next */ }
    }
    throw new Error("no run data");
  }

  function builders(runs) {
    const by = {};
    for (const r of runs) {
      if (r.status === "running" || r.status === "miss") continue; // a miss never reaches the builder
      (by[r.builder] = by[r.builder] || []).push(r);
    }
    const rows = Object.entries(by).map(([b, rs]) => {
      const healed = rs.filter((r) => r.status === "healed");
      const caught = rs.filter((r) => r.specTamper || r.holdoutFailures > 0 || r.status === "rejected");
      return {
        b, rs, healed, caught,
        rate: healed.length / rs.length,
        rounds: avg(healed.map((r) => r.metrics.roundsToGreen)),
        time: avg(healed.map((r) => r.metrics.timeToHealMs)),
        tokens: avg(healed.map((r) => r.metrics.tokensTotal)),
        credits: avg(rs.map((r) => r.metrics.kaneCredits)),
      };
    });
    rows.sort((x, y) => y.rate - x.rate || (x.time ?? Infinity) - (y.time ?? Infinity) || (x.tokens ?? Infinity) - (y.tokens ?? Infinity));

    const t = $("builders");
    t.replaceChildren(el("caption", { class: "sr", text: "Coding agents ranked by heal rate" }));
    t.append(el("thead", {}, el("tr", {}, ...["#", "Agent", "Runs", "Healed and shipped", "Caught cheating", "Rounds to green", "Time to heal", "Tokens per heal", "Kane credits per run"].map((h) => el("th", { scope: "col", text: h })))));
    const body = el("tbody");
    rows.forEach((r, i) => {
      const [name, sub] = NAMES[r.b] || [r.b, ""];
      const cheat = r.caught.length > 0;
      body.append(el("tr", { class: cheat ? "cheat-row" : "" },
        el("td", { class: "rank", text: cheat ? "✕" : String(i + 1) }),
        el("th", { scope: "row" }, el("span", { class: "agent" }, name), el("span", { class: "agent-sub", text: sub })),
        el("td", { text: String(r.rs.length) }),
        el("td", { class: r.healed.length ? "heal-cell" : "", text: `${r.healed.length} of ${r.rs.length}` }),
        el("td", { class: cheat ? "cheat-cell" : "", text: cheat ? `${r.caught.length} of ${r.rs.length}` : "0" }),
        el("td", { text: r.rounds === null ? "—" : r.rounds.toFixed(1) }),
        el("td", { text: dur(r.time) }),
        el("td", { text: num(r.tokens) }),
        el("td", { text: num(r.credits) }),
      ));
    });
    t.append(body);
    $("builders-note").textContent = `${runs.length} recorded runs · small sample, every run replayable`;
  }

  function catchMap(cal) {
    if (!cal) { $("kane-lead").textContent = "Run `hydra chaos calibrate` to measure Kane against the whole bug library."; return; }
    const pct = Math.round((cal.caught / cal.total) * 100);
    $("kane-note").textContent = cal.calibratedWith ? `measured with ${cal.calibratedWith}` : "";
    $("kane-lead").textContent = `Kane caught ${cal.caught} of ${cal.total} bugs (${pct}%) with one plain-English checkout test. Every miss is a bug off the path that test walks.`;
    const groups = [["caught", "Caught"], ["missed", "Missed"]];
    $("catch-map").replaceChildren(...groups.map(([key, label]) => {
      const rows = cal.rows.filter((r) => (key === "caught" ? r.kane === "caught" : r.kane !== "caught"));
      return el("div", { class: `catch-col ${key}` },
        el("p", { class: `label catch-head ${key}`, text: `${label} · ${rows.length}` }),
        el("ul", { class: "catch-list" }, ...rows.map((r) => el("li", {},
          el("span", { class: "bug-title", text: r.title }),
          el("span", { class: "bug-meta mono", text: `${r.surface} · ${r.bugClass}` }),
          key === "missed" ? el("span", { class: "bug-why", text: r.why }) : null,
        ))),
      );
    }));
  }

  load().then((d) => { builders(d.runs || []); catchMap(d.calibration); }).catch((e) => {
    $("builders-note").textContent = `Could not load the runs: ${e.message}`;
  });
})();

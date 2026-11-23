/* "Find the bug before Kane": three live shops, one hidden chaos bug each, scored against Kane's recorded verdicts. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  // Each shop is the target app with one chaos bug applied (scripts/build-playground.mjs).
  // `run` is a recorded Hydra run on the same bug: Kane's verdict and time come from it.
  const ROUNDS = [
    { slot: "a", url: "https://hydra-shop-a.vercel.app/", bug: "stale-cart", run: "20261119-140125-s12-claude" },
    { slot: "b", url: "https://hydra-shop-b.vercel.app/", bug: "validation-bypass", run: "20261119-013112-s14-claude" },
    { slot: "c", url: "https://hydra-shop-c.vercel.app/", bug: "wrong-total", run: "20261119-003757-s7-claude" },
  ];

  // The same eight choices every round, so a guess is a real guess. Each is a bug in Hydra's chaos library.
  const OPTIONS = [
    ["wrong-total", "Shipping is charged per item instead of once per order"],
    ["stale-cart", "Removing an item doesn't take it out of the cart"],
    ["validation-bypass", "Payment goes through with an invalid email"],
    ["coupon-ignored", "The coupon says it applied, but the total ignores it"],
    ["dead-pay-button", "The Pay button does nothing"],
    ["off-by-one-qty", "The + button changes the wrong item's quantity"],
    ["currency-format", "Prices are formatted wrong (like $58.0)"],
    ["confirmation-amount", "The confirmation shows the wrong amount charged"],
  ];

  const TASK = [
    'Add "Trail Mug", "Canvas Tote" and "Field Notebook" to the cart.',
    'Remove "Field Notebook". The cart should list only the mug and the tote.',
    'Click + once for "Trail Mug". Quantities: mug 2, tote 1. Subtotal $60.00.',
    'Apply the coupon SAVE10. Discount -$6.00, shipping $4.00, total $58.00.',
    "Pay with any name, an email and card 4242 4242 4242 4242.",
    'The confirmation should say "Charged $58.00".',
  ];

  const WHY_MISSED = {
    "validation-bypass": "Kane's instructions only ever type a valid email, so it never tried the case that breaks. Hydra logged this as a miss instead of hiding it.",
  };

  const KEY = "hydra-play-v1";
  const saved = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ } };

  let current = null;
  let startedAt = null;
  let tick = null;
  const kaneCache = {};

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const say = (m) => { $("live-region").textContent = m; };

  async function kaneFor(round) {
    if (kaneCache[round.run]) return kaneCache[round.run];
    const urls = [`data/runs/${round.run}/run.json`, `/api/runs/${round.run}`];
    for (const u of urls) {
      try {
        const res = await fetch(u, { cache: "no-store" });
        if (res.ok) {
          const r = await res.json();
          const k = r.referee && r.referee.kane;
          kaneCache[round.run] = k ? { verdict: k.verdict, ms: k.durationMs, summary: k.summary || "", testUrl: k.testUrl } : null;
          return kaneCache[round.run];
        }
      } catch { /* try the next source */ }
    }
    return null;
  }

  function renderTabs() {
    const tabs = $("round-tabs");
    tabs.replaceChildren(...ROUNDS.map((r) => {
      const res = saved[r.slot];
      const status = res ? (res.correct ? " · found" : " · missed") : "";
      return el("button", {
        type: "button", role: "tab", id: `tab-${r.slot}`, "aria-controls": "round",
        "aria-selected": String(current && current.slot === r.slot),
        class: `round-tab${res ? (res.correct ? " won" : " lost") : ""}`,
        onclick: () => choose(r.slot),
      }, `Shop ${r.slot.toUpperCase()}`, el("span", { class: "ink-2", text: status }));
    }));
    const done = ROUNDS.filter((r) => saved[r.slot]);
    const won = done.filter((r) => saved[r.slot].correct).length;
    $("score").textContent = done.length ? `You found ${won} of ${done.length}` : "3 shops, 1 bug each";
  }

  function choose(slot) {
    stopClock();
    current = ROUNDS.find((r) => r.slot === slot) || ROUNDS[0];
    const url = new URL(location.href);
    url.hash = `shop-${current.slot}`;
    history.replaceState(null, "", url);
    $("shop").src = current.url;
    $("shop-url").textContent = current.url.replace(/^https:\/\//, "").replace(/\/$/, "");
    $("shop-open").href = current.url;
    $("round").setAttribute("aria-labelledby", `tab-${current.slot}`);
    $("timer").textContent = "0:00";
    $("start").hidden = false;
    $("start").textContent = "Start the clock";
    $("guess").hidden = true;
    $("guess").reset();
    $("reveal").hidden = true;
    renderTabs();
    if (saved[current.slot]) showReveal(saved[current.slot], false);
  }

  function startClock() {
    startedAt = Date.now();
    $("start").hidden = true;
    $("guess").hidden = false;
    $("reveal").hidden = true;
    tick = setInterval(() => { $("timer").textContent = fmt(Date.now() - startedAt); }, 250);
    say("Clock started. Find the bug, then pick what's broken.");
  }
  function stopClock() {
    clearInterval(tick);
    tick = null;
  }

  async function submit(e) {
    e.preventDefault();
    const pick = new FormData($("guess")).get("pick");
    if (!pick) { say("Pick one answer first."); return; }
    stopClock();
    const ms = Date.now() - startedAt;
    const result = { pick, correct: pick === current.bug, ms };
    saved[current.slot] = result;
    save();
    $("guess").hidden = true;
    renderTabs();
    showReveal(result, true);
  }

  async function showReveal(result, fresh) {
    const r = current;
    const box = $("reveal");
    box.hidden = false;
    box.replaceChildren(el("p", { class: "ink-2", text: "Checking Kane's record…" }));
    const k = await kaneFor(r);
    const right = OPTIONS.find(([id]) => id === r.bug)[1];
    const kaneCaught = k && k.verdict === "failed";
    const youWon = result.correct && (!kaneCaught || result.ms < k.ms);

    const headline = result.correct
      ? (kaneCaught ? (result.ms < k.ms ? "You beat Kane" : "Kane was faster") : "You caught what Kane missed")
      : "Not this one";
    const tone = result.correct ? (youWon ? "heal" : "kane") : "catch";

    const evidence = k ? (k.summary.split("\n").find((l) => /^\s*evidence:/i.test(l)) || k.summary.split("\n")[0] || "").replace(/^\s*evidence:\s*[a-z_]+:\s*/i, "").replace(/^\s*evidence:\s*/i, "") : "";
    box.replaceChildren(...[
      el("p", { class: `reveal-word ${tone}`, text: headline }),
      el("p", {}, result.correct ? "Right: " : "The bug was: ", el("strong", { text: right }), "."),
      el("dl", { class: "versus" },
        el("div", {}, el("dt", { text: "You" }), el("dd", { text: result.correct ? fmt(result.ms) : "wrong answer" })),
        el("div", {}, el("dt", {}, el("span", { class: "kane-word", text: "Kane" })), el("dd", { text: k ? (kaneCaught ? fmt(k.ms) : "missed it") : "—" })),
      ),
      kaneCaught && evidence ? el("p", { class: "quote", text: `Kane: “${evidence.slice(0, 220)}${evidence.length > 220 ? "…" : ""}”` }) : null,
      !kaneCaught && WHY_MISSED[r.bug] ? el("p", { class: "ink-2", text: WHY_MISSED[r.bug] }) : null,
      el("div", { class: "reveal-actions" },
        el("a", { class: "watch-btn", href: `./?run=${r.run}#moment=${kaneCaught ? "catch" : "miss"}` }, kaneCaught ? "Watch Kane catch it, then the fix" : "See Kane's miss"),
        el("a", {
          class: "link-btn", target: "_blank", rel: "noopener noreferrer",
          href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(result, k, kaneCaught))}&url=${encodeURIComponent(location.href.split("#")[0])}`,
        }, "Share your result"),
        el("button", { type: "button", class: "link-btn", onclick: () => { delete saved[r.slot]; save(); choose(r.slot); } }, "Try again"),
      ),
    ].filter(Boolean));
    if (fresh) say(`${headline}. The bug was: ${right}.`);
  }

  function shareText(result, k, kaneCaught) {
    const slot = `Shop ${current.slot.toUpperCase()}`;
    if (!result.correct) return `I tried to find the hidden bug in Hydra's ${slot} before Kane CLI did. The bug won.`;
    if (!kaneCaught) return `I found the hidden bug in Hydra's ${slot} in ${fmt(result.ms)}. Kane CLI missed it.`;
    return result.ms < k.ms
      ? `I found the hidden bug in Hydra's ${slot} in ${fmt(result.ms)}. Kane CLI took ${fmt(k.ms)}.`
      : `Kane CLI found the hidden bug in Hydra's ${slot} in ${fmt(k.ms)}. I took ${fmt(result.ms)}.`;
  }

  function boot() {
    $("task-steps").replaceChildren(...TASK.map((t) => el("li", { text: t })));
    $("options").replaceChildren(...OPTIONS.map(([id, text], i) => el("label", { class: "option" },
      el("input", { type: "radio", name: "pick", value: id, required: i === 0 }),
      el("span", { text }),
    )));
    $("start").addEventListener("click", startClock);
    $("guess").addEventListener("submit", submit);
    const m = /shop-([abc])/.exec(location.hash);
    choose(m ? m[1] : (ROUNDS.find((r) => !saved[r.slot]) || ROUNDS[0]).slot);
    // Prefetch Kane's records so the reveal is instant.
    for (const r of ROUNDS) kaneFor(r);
  }
  boot();
})();

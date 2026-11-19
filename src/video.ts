/// <reference lib="dom" />
/**
 * `hydra video`: Kane 0.10.4 records no local video, so render one per Kane run from its own
 * evidence: every step's (annotated) screenshot in order, captioned with Kane's step summary
 * and status, opened by a title card and closed by the verdict. Rendered to WebM by headless
 * Chrome (canvas + MediaRecorder) through playwright-core, so it needs no ffmpeg.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { chromium } from "playwright-core";
import { listRuns, type KaneRef, type RunRecord } from "./ledger.js";
import { ensureDir, relPosix, removeTree, walkFiles, writeJsonAtomic } from "./util/fs.js";
import { log } from "./util/log.js";

type Frame =
  | { kind: "card"; title: string; subtitle: string; tone: "info" | "pass" | "fail"; ms: number }
  | { kind: "step"; image: string; caption: string; status: string; index: number; total: number; ms: number };

const STEP_MS = 1100;
const CARD_MS = 2200;

/** Kane's steps for one run, in order: one image per step (annotated when Kane drew one). */
function collectSteps(runDir: string, k: KaneRef): Array<{ image: string; summary: string; status: string; ordinal: number }> {
  const root = join(runDir, k.evidenceDir);
  if (!existsSync(root)) return [];
  const steps: Array<{ image: string; summary: string; status: string; ordinal: number }> = [];
  for (const rel of walkFiles(root)) {
    if (basename(rel) !== "step.json") continue;
    const dir = join(root, dirname(rel));
    let meta: Record<string, unknown> = {};
    try {
      meta = JSON.parse(readFileSync(join(dir, "step.json"), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    const image = ["annotated.png", "screenshot.jpg", "screenshot.png"].map((n) => join(dir, n)).find((p) => existsSync(p));
    if (!image) continue;
    const ordinal = typeof meta.ordinal === "number" ? meta.ordinal : Number(/^(\d+)/.exec(basename(dir))?.[1] ?? 0);
    steps.push({
      image,
      summary: typeof meta.summary === "string" ? meta.summary : String(meta.kind ?? "step"),
      status: typeof meta.status === "string" ? meta.status : "",
      ordinal,
    });
  }
  return steps.sort((a, b) => a.ordinal - b.ordinal);
}

function framesFor(run: RunRecord, runDir: string, k: KaneRef): Frame[] {
  const steps = collectSteps(runDir, k);
  if (!steps.length) return [];
  const verdict = k.verdict === "passed" ? "PASS · exit 0" : k.verdict === "failed" ? "FAIL · exit 1" : `INFRA · ${k.verdict}`;
  const tone = k.verdict === "passed" ? "pass" : k.verdict === "failed" ? "fail" : "info";
  const bug = run.bug ? `${run.bug.id} injected (hidden from the builder)` : "unmodified app";
  return [
    { kind: "card", title: `Kane · ${k.label}`, subtitle: `seed ${run.seed} · builder ${run.builder} · ${bug}`, tone: "info", ms: CARD_MS },
    ...steps.map((s, i): Frame => ({ kind: "step", image: s.image, caption: s.summary, status: s.status, index: i + 1, total: steps.length, ms: STEP_MS })),
    { kind: "card", title: verdict, subtitle: (k.summary ?? "").split("\n")[0]!.slice(0, 220), tone, ms: CARD_MS + 800 },
  ];
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Draw the frames onto a canvas in headless Chrome and record it with MediaRecorder. */
async function renderWebm(frames: Frame[], outFile: string, browser: import("playwright-core").Browser): Promise<number> {
  const payload = frames.map((f) =>
    f.kind === "step" ? { ...f, image: `data:${MIME[extname(f.image).toLowerCase()] ?? "image/png"};base64,${readFileSync(f.image).toString("base64")}` } : f,
  );
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><canvas id=c width=1280 height=800></canvas>");
    const b64 = await page.evaluate(async (frames) => {
      const W = 1280, H = 800, BAR = 112;
      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const images = await Promise.all(
        frames.map((f) =>
          f.kind === "step"
            ? new Promise<HTMLImageElement>((res, rej) => {
                const img = new Image();
                img.onload = () => res(img);
                img.onerror = rej;
                img.src = f.image;
              })
            : Promise.resolve(null),
        ),
      );
      const wrap = (text: string, max: number, x: number, y: number, lh: number, lines: number) => {
        const words = text.split(/\s+/);
        let line = "";
        let n = 0;
        for (const w of words) {
          const test = line ? `${line} ${w}` : w;
          if (ctx.measureText(test).width > max && line) {
            ctx.fillText(n === lines - 1 ? `${line}…` : line, x, y + n * lh);
            if (++n >= lines) return;
            line = w;
          } else line = test;
        }
        if (line) ctx.fillText(line, x, y + n * lh);
      };
      const tones: Record<string, string> = { info: "#7aa2f7", pass: "#3fb950", fail: "#f85149" };
      const draw = (i: number) => {
        const f = frames[i]!;
        ctx.fillStyle = "#0d1117";
        ctx.fillRect(0, 0, W, H);
        if (f.kind === "card") {
          ctx.fillStyle = tones[f.tone]!;
          ctx.fillRect(0, 0, W, 10);
          ctx.font = "bold 64px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(f.title, W / 2, H / 2 - 30);
          ctx.fillStyle = "#c9d1d9";
          ctx.font = "28px system-ui, sans-serif";
          wrap(f.subtitle, W - 200, W / 2, H / 2 + 40, 38, 4);
          ctx.textAlign = "left";
          return;
        }
        const img = images[i]!;
        const scale = Math.min(W / img.width, (H - BAR) / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (W - w) / 2, (H - BAR - h) / 2, w, h);
        ctx.fillStyle = "#161b22";
        ctx.fillRect(0, H - BAR, W, BAR);
        const ok = /pass/i.test(f.status), bad = /fail|error/i.test(f.status);
        ctx.fillStyle = ok ? tones.pass! : bad ? tones.fail! : "#8b949e";
        ctx.fillRect(0, H - BAR, 8, BAR);
        ctx.font = "bold 22px system-ui, sans-serif";
        ctx.fillText(`step ${f.index}/${f.total} · ${f.status || "…"}`, 28, H - BAR + 36);
        ctx.fillStyle = "#e6edf3";
        ctx.font = "24px system-ui, sans-serif";
        wrap(f.caption, W - 60, 28, H - BAR + 72, 30, 2);
      };
      const stream = canvas.captureStream(30);
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m))!;
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 700_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      draw(0);
      rec.start(250);
      for (let i = 0; i < frames.length; i++) {
        const until = performance.now() + frames[i]!.ms;
        // Redraw on a timer so the stream keeps emitting frames even when headless throttles rAF.
        while (performance.now() < until) {
          draw(i);
          await new Promise((r) => setTimeout(r, 40));
        }
      }
      rec.stop();
      await done;
      const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, payload);
    const bytes = Buffer.from(b64, "base64");
    ensureDir(dirname(outFile));
    writeFileSync(outFile, bytes);
    return bytes.length;
  } finally {
    await page.close();
  }
}

/** Kane runs worth a video: the referee (the catch or the miss), then the last round's first main verify and holdout. */
function pickKanes(run: RunRecord): KaneRef[] {
  const out: KaneRef[] = [];
  if (run.referee) out.push(run.referee.kane);
  // From the last round: the first fresh main pass (or failure) and the hidden holdout.
  const last = run.rounds[run.rounds.length - 1];
  if (last) {
    const main = last.verify.find((v) => v.spec !== "holdout");
    const holdout = last.verify.find((v) => v.spec === "holdout");
    for (const v of [main, holdout]) if (v) out.push(v);
  }
  return out;
}

export async function makeVideos(stateDir: string, runIds: string[], opts: { force?: boolean } = {}): Promise<{ videos: number; bytes: number }> {
  const runs = listRuns(stateDir).filter((r) => runIds.includes(r.runId));
  const missing = runIds.filter((id) => !runs.some((r) => r.runId === id));
  if (missing.length) throw new Error(`Unknown run(s): ${missing.join(", ")}`);
  const browser = await chromium.launch({ channel: "chrome", headless: true, executablePath: process.env.HYDRA_CHROME_PATH || undefined });
  let videos = 0, bytes = 0;
  try {
    for (const run of runs) {
      const runDir = join(stateDir, "runs", run.runId);
      let changed = false;
      if (opts.force) {
        // Start clean: forget every rendered video so ones no longer selected are not published.
        const all = [...run.baseline, ...(run.referee ? [run.referee.kane] : []), ...run.rounds.flatMap((h) => h.verify)];
        for (const k of all) if (k.video?.startsWith("videos/")) k.video = null;
        removeTree(join(runDir, "videos"));
        changed = true;
      }
      for (const k of pickKanes(run)) {
        if (k.video && !opts.force && existsSync(join(runDir, k.video))) continue;
        const frames = framesFor(run, runDir, k);
        if (!frames.length) {
          log.warn(`${run.runId} ${k.label}: no step screenshots, skipped`);
          continue;
        }
        const out = join(runDir, "videos", `${k.label}.webm`);
        const size = await renderWebm(frames, out, browser);
        k.video = relPosix(runDir, out);
        changed = true;
        videos++;
        bytes += size;
        log.ok(`${run.runId} ${k.label}: ${frames.length - 2} steps → ${k.video} (${Math.round(size / 1024)} KB)`);
      }
      if (changed) writeJsonAtomic(join(runDir, "run.json"), run);
    }
  } finally {
    await browser.close();
  }
  return { videos, bytes };
}

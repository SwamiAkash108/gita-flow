/* Gita Flow — freestyle trainer for Bhagavad Gita verses.
   Vanilla JS, no build. State in localStorage. Audio via Web Audio API
   with a lookahead scheduler synced to audioContext.currentTime. */
"use strict";

/* ---------------- store ---------------- */
const LS_KEY = "gitaFlow.v1";
const store = {
  load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
    catch (e) { return {}; }
  },
  save(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); },
};
let S = Object.assign({ verses: {}, settings: { bpm: 84, fill: "all", scheme: "off", beat: "metronome", flowLang: "en", flowFill: "all", flowScheme: "off" } }, store.load());
S.settings = Object.assign({ bpm: 84, fill: "all", scheme: "off", beat: "metronome", flowLang: "en", flowFill: "all", flowScheme: "off" }, S.settings);
const persist = () => store.save(S);
const todayNum = () => Math.floor(Date.now() / 86400000);
const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 15 }; // days until due, by new level

/* ---------------- data ---------------- */
let DATA = null, VERSES = [], BY_ID = {}, BEATS = { beats: [] }, WORDS = { en: [], it: [] }, WORDIDX = { en: {}, it: {} };
async function loadData() {
  const [v, b, w] = await Promise.all([
    fetch("verses.json").then(r => r.json()),
    fetch("beats/manifest.json").then(r => r.json()).catch(() => ({ beats: [] })),
    fetch("words.json").then(r => r.json()).catch(() => ({ en: [], it: [] })),
  ]);
  DATA = v; VERSES = v.verses;
  VERSES.forEach(x => BY_ID[x.id] = x);
  BEATS = b || { beats: [] };
  WORDS = w || { en: [], it: [] };
  for (const lg of ["en", "it"]) (WORDS[lg] || []).forEach(e => WORDIDX[lg][e[0]] = e[1]);
}

/* ---------------- utils ---------------- */
const $ = sel => document.querySelector(sel);
const app = $("#app");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let toastT = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400);
}
function prog(id) { return S.verses[id] || { level: 0, due: 0, plays: 0 }; }
function verseStatus(id) { const p = prog(id); return p.level; }
function dueList() {
  const t = todayNum();
  return VERSES.filter(v => { const p = prog(v.id); return p.level >= 1 && p.level < 5 && p.due <= t; });
}
function nextUnplayed(fromId) {
  const i = fromId ? VERSES.findIndex(v => v.id === fromId) : -1;
  for (let k = 1; k <= VERSES.length; k++) {
    const v = VERSES[(i + k) % VERSES.length];
    if (verseStatus(v.id) === 0) return v;
  }
  return null;
}

/* ---------------- audio engine ---------------- */
const AE = {
  ctx: null, playing: false, timer: null,
  bpm: 84, startTime: 0, nextBeat: 0, beatIdx: 0,
  musicBuf: null, musicSrc: null, pattern: null,

  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.clickGain = this.ctx.createGain(); this.clickGain.gain.value = 1;
      this.clickGain.connect(this.master);
    }
  },
  async loadMusic(file) {
    const res = await fetch("beats/" + file);
    const buf = await res.arrayBuffer();
    this.musicBuf = await this.ctx.decodeAudioData(buf);
  },
  click(time, accent) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.value = accent ? 1320 : 880;
    g.gain.setValueAtTime(accent ? 0.9 : 0.5, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
    o.connect(g); g.connect(this.clickGain);
    o.start(time); o.stop(time + 0.05);
  },
  async start() {
    this.ensure();
    await this.ctx.resume(); // iOS: must complete before reading currentTime
    const spb = 60 / this.bpm;
    const t0 = this.ctx.currentTime + 0.1;
    this.playing = true;
    this.beatIdx = 0;
    this.startTime = t0;
    this.nextBeat = t0;
    this.clickGain.gain.cancelScheduledValues(0);
    this.clickGain.gain.setValueAtTime(1, t0);
    if (this.musicBuf) {
      // clicks only during the 4-beat count-in, then the loop takes over
      this.clickGain.gain.setValueAtTime(0, t0 + 4 * spb);
      const src = this.ctx.createBufferSource();
      src.buffer = this.musicBuf; src.loop = true;
      src.connect(this.master); src.start(t0 + 4 * spb); // music bar 1 = content bar 1
      this.musicSrc = src;
    }
    this.timer = setInterval(() => this.scheduler(), 25);
  },
  scheduler() {
    const spb = 60 / this.bpm;
    while (this.nextBeat < this.ctx.currentTime + 0.25) {
      const gb = this.beatIdx - 4;              // content beat index; negative = count-in
      if (gb < 0 || !this.pattern && !this.musicBuf) this.click(this.nextBeat, this.beatIdx % 4 === 0);
      if (this.pattern && gb >= 0) {
        const p = gb % 16;
        for (const e of this.pattern.events)
          if (Math.floor(e.t) === p) Drums.play(e, this.nextBeat + (e.t - p) * spb, this);
      }
      this.beatIdx++; this.nextBeat += spb;
    }
  },
  pos() {
    // timeline: one 4-beat count-in, then content bars 1..4 cycling
    // -> {bar: 0 = count-in / 1..4 = content, beat: 0..3, frac: 0..1 through bar, total: beats}
    if (!this.playing || !this.ctx) return null;
    const spb = 60 / this.bpm;
    const el = this.ctx.currentTime - this.startTime;
    if (el < 0) return { bar: 0, beat: 0, frac: 0, total: 0 };
    const total = el / spb;
    const beat = Math.floor(total) % 4;
    const frac = (total % 4) / 4;
    if (total < 4) return { bar: 0, beat: Math.floor(total), frac, total };
    const bar = (Math.floor((total - 4) / 4) % 4) + 1;
    return { bar, beat, frac, total };
  },
  stop() {
    this.playing = false;
    clearInterval(this.timer);
    if (this.ctx) {
      this.clickGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.clickGain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
    if (this.musicSrc) { try { this.musicSrc.stop(); } catch (e) {} this.musicSrc = null; }
  },
};

/* ---------------- built-in drum machine (live-synthesized beats) ---------------- */
const Drums = {
  _noise: null,
  noise(ctx) {
    if (!this._noise) {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this._noise = b;
    }
    return this._noise;
  },
  _noiseHit(ctx, out, t, hpFreq, dur, gain) {
    const s = ctx.createBufferSource(); s.buffer = this.noise(ctx);
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hpFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t); s.stop(t + dur + 0.02);
  },
  _tone(ctx, out, t, f0, f1, pitchT, dur, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + pitchT);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  },
  play(e, t, AE) {
    const ctx = AE.ctx, out = AE.master, v = e.vel == null ? 1 : e.vel;
    const spb = 60 / AE.bpm;
    if (e.type === "kick") {
      this._tone(ctx, out, t, 150, 45, 0.055, 0.24, 0.95 * v);
      this._noiseHit(ctx, out, t, 4000, 0.018, 0.22 * v);
    } else if (e.type === "snare") {
      this._noiseHit(ctx, out, t, 1800, 0.09, 0.7 * v);
      this._tone(ctx, out, t, 190, 190, 0, 0.06, 0.38 * v);
    } else if (e.type === "hat") {
      this._noiseHit(ctx, out, t, 7500, 0.018, 0.24 * v);
    } else if (e.type === "ohat") {
      this._noiseHit(ctx, out, t, 7000, 0.22, 0.28 * v);
    } else if (e.type === "sub") {
      const o = ctx.createOscillator(), g = ctx.createGain(), dur = (e.d || 1.3) * spb;
      o.frequency.value = e.f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55 * v, t + 0.01);
      g.gain.setValueAtTime(0.55 * v, t + Math.max(0.02, dur - 0.09));
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
    }
  },
};

function buildPattern(kind) {
  const ev = [];
  const add = (t, type, extra) => ev.push(Object.assign({ t, type }, extra));
  for (let b = 0; b < 4; b++) {
    const B = b * 4;
    if (kind === "boombap76") {
      add(B, "kick"); add(B + 1.5, "kick");
      if (b % 2 === 1) add(B + 2.75, "kick");
      add(B + 1, "snare"); add(B + 3, "snare");
      for (let k = 0; k < 8; k++) add(B + k / 2 + (k % 2 ? 0.06 : 0), "hat", { vel: k % 2 ? 0.7 : 1 });
      add(B, "sub", { f: [55, 55, 43.65, 49][b], d: 1.4 });
    } else if (kind === "trap88") {
      add(B, "kick"); add(B + 2.5, "kick");
      add(B + 2, "snare");
      for (let k = 0; k < 16; k++) add(B + k / 4, "hat", { vel: k % 4 === 0 ? 1 : 0.55 });
      add(B + 3.5, "ohat");
      add(B, "sub", { f: [73.42, 58.27, 87.31, 65.41][b], d: 3.6 });
    } else if (kind === "lofi70") {
      add(B, "kick"); add(B + 2, "kick");
      add(B + 1, "snare", { vel: 0.85 }); add(B + 3, "snare", { vel: 0.85 });
      for (let k = 0; k < 8; k++) add(B + k / 2 + (k % 2 ? 0.07 : 0), "hat", { vel: k % 2 ? 0.5 : 0.8 });
      if (b % 2 === 0) add(B + 3.5, "ohat", { vel: 0.5 });
      add(B, "sub", { f: [65.41, 55, 43.65, 49][b], d: 1.6 });
    } else if (kind === "stepper82") {
      add(B, "kick"); add(B + 1.75, "kick");
      if (b === 3) add(B + 2.5, "kick");
      add(B + 1, "snare"); add(B + 3, "snare");
      for (let k = 0; k < 8; k++) add(B + k / 2 + (k % 2 ? 0.06 : 0), "hat", { vel: k % 2 ? 0.6 : 0.95 });
      add(B, "sub", { f: [73.42, 73.42, 58.27, 65.41][b], d: 1.2 });
    } else if (kind === "mantra92") {
      add(B, "kick"); add(B + 2.5, "kick");
      if (b % 2 === 1) add(B + 3.75, "kick");
      add(B + 2, "snare");
      for (let k = 0; k < 16; k++) add(B + k / 4, "hat", { vel: k % 4 === 0 ? 1 : 0.5 });
      if (b === 3) { add(B + 3.5, "hat", { vel: 0.7 }); add(B + 3.75, "hat", { vel: 0.8 }); }
      add(B + 3.5, "ohat", { vel: 0.6 });
      add(B, "sub", { f: [55, 49, 43.65, 41.2][b], d: 3.6 });
    } else if (kind === "drill142") {
      add(B, "kick"); add(B + 2.5, "kick");
      if (b % 2 === 1) add(B + 1.75, "kick");
      add(B + 2, "snare");
      [0, 0.5, 1, 1.75, 2, 2.5, 3, 3.75].forEach((h, k) => add(B + h, "hat", { vel: k % 2 ? 0.55 : 0.95 }));
      add(B, "sub", { f: [65.41, 65.41, 51.91, 58.27][b], d: 2.2 });
    } else { // step100
      add(B, "kick"); add(B + 1.5, "kick"); add(B + 2.75, "kick");
      add(B + 1, "snare"); add(B + 3, "snare");
      const steps = b === 3 ? 16 : 8;
      for (let k = 0; k < steps; k++) add(B + k / (b === 3 ? 4 : 2), "hat", { vel: k % 2 ? 0.65 : 1 });
      add(B, "sub", { f: [41.2, 41.2, 65.41, 73.42][b], d: 1.3 });
    }
  }
  return { events: ev.sort((a, b2) => a.t - b2.t) };
}
const PATTERNS = {
  boombap76: buildPattern("boombap76"),
  trap88: buildPattern("trap88"),
  step100: buildPattern("step100"),
  lofi70: buildPattern("lofi70"),
  stepper82: buildPattern("stepper82"),
  mantra92: buildPattern("mantra92"),
  drill142: buildPattern("drill142"),
};

/* ---------------- router ---------------- */
let T = null; // trainer state
function route() {
  AE.stop(); T = null;
  const h = location.hash || "#/";
  if (h.startsWith("#/verse/")) renderTrainer(decodeURIComponent(h.slice(8)));
  else if (h.startsWith("#/flow")) renderFlow();
  else if (h.startsWith("#/review")) renderReview();
  else if (h.startsWith("#/progress")) renderProgress();
  else renderHome();
}
window.addEventListener("hashchange", route);
window.addEventListener("resize", () => { if (T) measureSlots(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (T) measureSlots(); });

/* ---------------- home ---------------- */
function renderHome() {
  const due = dueList();
  const played = VERSES.filter(v => verseStatus(v.id) >= 1).length;
  const mastered = VERSES.filter(v => verseStatus(v.id) >= 5).length;
  const next = nextUnplayed(null) || (due[0] || VERSES[0]);
  const ch = DATA.chapters["2"];
  const pct = Math.round(100 * played / VERSES.length);
  app.innerHTML = `
  <header class="top">
    <div class="wordmark">Gita Flow</div>
    <div class="wordsub">Bhagavad Gītā · freestyle the verses</div>
  </header>
  <div class="view">
    <div class="eyebrow sec">Today</div>
    <div class="card review">
      <div><b>${due.length ? due.length + " verses due" : "All clear"}</b>
      <span>${due.length ? "spaced review keeps them alive" : "nothing due, learn something new"}</span></div>
      <button class="btn" data-act="review" ${due.length ? "" : "disabled style='opacity:.4'"}>Start review</button>
    </div>
    <div class="eyebrow sec">Continue</div>
    <div class="card cont">
      <div class="row"><b>Chapter 2 · ${esc(ch.name)}</b><span class="nextv">next ${esc(next.id)}</span></div>
      <div class="sub">${esc(ch.subtitle)}</div>
      <div class="bar-track"><i style="width:${pct}%"></i></div>
      <div class="bar-lbl"><span>${played} of ${VERSES.length} verses started</span><span>${mastered} mastered</span></div>
    </div>
    <div class="eyebrow sec">Chapters</div>
    ${Object.entries(DATA.chapters).map(([n, c]) => n === "2" ? `
      <button class="card ch on" data-act="open" data-id="${esc(next.id)}" style="width:100%;text-align:left">
        <span class="num">2</span>
        <span class="nm"><b>${esc(c.name)}</b><span>${esc(c.subtitle)} · ${VERSES.length} verses</span></span>
        <span class="r">${pct}%</span>
      </button>` : `
      <div class="card ch dim">
        <span class="num">${esc(n)}</span>
        <span class="nm"><b>${esc(c.name)}</b><span>${esc(c.subtitle)}</span></span>
        <span class="r">soon</span>
      </div>`).join("")}
  </div>
  ${nav("learn")}`;
}

/* ---------------- progress ---------------- */
function renderProgress() {
  const counts = [0, 0, 0, 0, 0, 0];
  let plays = 0;
  VERSES.forEach(v => { const p = prog(v.id); counts[p.level] = (counts[p.level] || 0) + 1; plays += p.plays || 0; });
  app.innerHTML = `
  <header class="top"><div class="wordmark">Progress</div><div class="wordsub">Chapter 2 · Sāṅkhya-yoga</div></header>
  <div class="view">
    <div class="eyebrow sec">Mastery</div>
    <div class="pgrid">
      <div class="pcell"><b>${counts[0]}</b><span>new</span></div>
      ${[1, 2, 3, 4, 5].map(l => `<div class="pcell"><b>${counts[l]}</b><span>level ${l}</span></div>`).join("")}
    </div>
    <div class="eyebrow sec">Practice</div>
    <div class="pgrid">
      <div class="pcell"><b>${plays}</b><span>rounds</span></div>
      <div class="pcell"><b>${dueList().length}</b><span>due today</span></div>
      <div class="pcell"><b>${counts[5]}</b><span>mastered</span></div>
    </div>
    <button class="danger" data-act="reset">Reset all progress</button>
  </div>
  ${nav("progress")}`;
}

function nav(act) {
  return `<nav>
    <button data-act="home" class="${act === "learn" ? "act" : ""}">Learn</button>
    <button data-act="flow" class="${act === "flow" ? "act" : ""}">Flow</button>
    <button data-act="review" class="${act === "review" ? "act" : ""}">Review</button>
    <button data-act="progress" class="${act === "progress" ? "act" : ""}">Progress</button>
  </nav>`;
}

/* ---------------- trainer ---------------- */
function landingWords(v) {
  // 4 landing words, one per bar, from verse keywords (translation order).
  const kw = (v.keywords || []).slice(0, 4);
  while (kw.length < 4) kw.push({ word: "—", rhymes: [] });
  const scheme = S.settings.scheme;
  const out = kw.map(k => ({ word: k.word, base: k }));
  const useRhyme = (i, ofIdx) => {
    const rs = kw[ofIdx].rhymes || [];
    if (rs.length) out[i] = { word: rs[0], base: kw[ofIdx], rhymeOf: kw[ofIdx].word };
  };
  if (scheme === "AABB") { useRhyme(1, 0); useRhyme(3, 2); }
  else if (scheme === "ABAB") { useRhyme(2, 0); useRhyme(3, 1); }
  else if (scheme === "AAAA") {
    const rs = (kw[0].rhymes || []);
    [1, 2, 3].forEach(i => { if (rs[i - 1]) out[i] = { word: rs[i - 1], base: kw[0], rhymeOf: kw[0].word }; });
  }
  return out;
}

function renderTrainer(id, reviewQueue) {
  const v = BY_ID[id]; if (!v) { location.hash = "#/"; return; }
  const p = prog(id);
  const land = landingWords(v);
  const fill = S.settings.fill;
  const showKey = bar =>
    fill === "all" ? true :
    fill === "first" ? bar === 0 :
    fill === "last" ? bar === 3 : false;

  T = { v, land, peeks: 0, reviewQueue: reviewQueue || null, raf: null, sel: null, taps: [] };

  const kwSet = (v.keywords || []).map(k => k.word);
  const enHtml = esc(v.translation).replace(/\b([a-z][a-z'-]*)\b/gi, m =>
    kwSet.includes(m.toLowerCase()) ? `<b>${m}</b>` : m);

  app.innerHTML = `
  <div class="view">
    <div class="tbar">
      <button class="back" data-act="home">‹</button>
      <div class="t">
        <div class="eyebrow">Chapter 2 · ${esc(DATA.chapters["2"].name)}${T.reviewQueue ? " · review" : ""}</div>
        <h1>${esc(v.id)} · freestyle</h1>
      </div>
      <div class="lvl">${[1, 2, 3, 4, 5].map(l => `<i class="${p.level >= l ? "on" : ""}"></i>`).join("")}</div>
    </div>

    <div class="verse">
      <div class="sa">${esc(v.padas.slice(0, 2).join(" "))} …</div>
      <div class="en">${enHtml}</div>
    </div>

    <div class="beat">
      <div class="dots">${[0, 1, 2, 3].map(() => "<i></i>").join("")}</div>
      <div class="bpm">
        <button class="pill" data-act="bpm-" >−</button>
        <span class="pill" id="bpmval">${S.settings.bpm} BPM</span>
        <button class="pill" data-act="bpm+">+</button>
        <button class="pill tap" data-act="tap">TAP</button>
      </div>
    </div>

    <div class="bars">
      ${land.map((L, b) => `
        <div class="barlbl" id="barlbl${b}">BAR ${b + 1}${b === 0 ? " · land on the gold word" : ""}</div>
        <div class="bar" id="bar${b}">
          <div class="slots">
            ${[0, 1, 2].map(s => `<div class="s" id="s${b}_${s}"></div>`).join("")}
            <button class="s key ${showKey(b) ? "" : "blank"} ${L.rhymeOf ? "rhy" : ""}" data-act="${showKey(b) ? "word" : "peek"}" data-bar="${b}" id="key${b}">
              ${showKey(b) ? esc(L.word) : ""}
            </button>
          </div>
          <div class="ball" id="ball${b}"></div>
        </div>`).join("")}
    </div>

    <div class="modes" id="fillmodes">
      ${[["all", "All prompts"], ["first", "First only"], ["last", "Last only"], ["free", "Free flow"]]
        .map(([k, l]) => `<button data-act="fill" data-v="${k}" class="${fill === k ? "act" : ""}">${l}</button>`).join("")}
    </div>
    <div class="modes">
      ${[["off", "Rhymes off"], ["AABB", "AABB"], ["ABAB", "ABAB"], ["AAAA", "AAAA"]]
        .map(([k, l]) => `<button data-act="scheme" data-v="${k}" class="${S.settings.scheme === k ? "act" : ""}">${l}</button>`).join("")}
    </div>

    <div class="word" id="wordcard"><span class="empty">tap a word for meaning + rhymes</span></div>

    <div class="bank">
      <div class="eyebrow">Word bank · this verse</div>
      <div class="ws">
        ${(v.keywords || []).map(k =>
          `<button class="w ${k.new ? "new" : ""} ${land.slice(0, 4).some(L => L.base === k) ? "landing" : ""}"
            data-act="bankword" data-w="${esc(k.word)}">${esc(k.word)}</button>`).join("")}
      </div>
    </div>

    <div class="controls">
      <button class="tog" data-act="loop">Loop <b id="loopstate">on</b></button>
      <button class="play" id="playbtn" data-act="play">▶</button>
      <button class="tog" data-act="endless">Endless <b id="endlessstate">off</b></button>
    </div>
    <button class="done" data-act="complete">✓ Round complete, level up</button>
  </div>`;

  T.loop = true; T.endless = false; T.taps = [];
  if (BEATS.beats.length) addBeatPicker();
  measureSlots();
  startRaf();
}

function addBeatPicker() {
  const sel = document.createElement("select");
  sel.className = "beatsel";
  sel.innerHTML = `<option value="metronome">metronome</option>` +
    BEATS.beats.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join("");
  sel.onchange = async () => {
    const wasPlaying = AE.playing; AE.stop(); $("#playbtn").textContent = "▶";
    AE.musicBuf = null; AE.pattern = null;
    if (sel.value === "metronome") {
      setBpm(S.settings.bpm);
    } else {
      const b = BEATS.beats[+sel.value];
      if (b.synth) {
        AE.pattern = PATTERNS[b.synth]; setBpm(b.bpm || S.settings.bpm); toast(b.name);
      } else {
        try { await AE.loadMusic(b.file); setBpm(b.bpm || S.settings.bpm); toast(b.name + " loaded"); }
        catch (e) { toast("could not load beat"); }
      }
    }
    if (wasPlaying) startPlay();
  };
  $(".beat").appendChild(sel);
}

/* ---------- trainer playback ---------- */
function setBpm(b) {
  S.settings.bpm = Math.min(140, Math.max(50, Math.round(b)));
  AE.bpm = S.settings.bpm;
  persist();
  const el = $("#bpmval"); if (el) el.textContent = S.settings.bpm + " BPM";
}
function startPlay() {
  AE.bpm = S.settings.bpm;
  AE.start();
  $("#playbtn").textContent = "❚❚";
}
function stopPlay() {
  AE.stop();
  const b = $("#playbtn"); if (b) b.textContent = "▶";
}
function measureSlots() {
  if (!T) return;
  T.centers = []; T.ballY = []; T.slotEls = [];
  for (let b = 0; b < 4; b++) {
    const els = [$("#s" + b + "_0"), $("#s" + b + "_1"), $("#s" + b + "_2"), $("#key" + b)];
    if (els.some(e => !e)) continue;
    T.slotEls[b] = els;
    T.centers[b] = els.map(e => e.offsetLeft + e.offsetWidth / 2);
    T.ballY[b] = els[0].offsetTop - 12; // ball rests on the top edge of the slot row
  }
}

const RAF = { id: 0, gen: 0 };
function startRaf() {
  const gen = ++RAF.gen;
  cancelAnimationFrame(RAF.id);
  let lastBar = -1;
  const step = () => {
    if (!T || gen !== RAF.gen) return;
    const pos = AE.pos();
    if (pos && AE.playing) {
      const contentBar = pos.bar - 1;            // -1 during the one-time count-in
      // beat dots
      document.querySelectorAll(".dots i").forEach((d, i) => {
        d.className = i < pos.beat ? "on" : i === pos.beat ? (pos.bar >= 1 ? "on" : "next") : "";
      });
      // bar switch: in flow mode, refresh the bar that just finished
      if (contentBar !== lastBar) {
        if (T.flow && lastBar >= 0) refreshFlowBar(lastBar);
        lastBar = contentBar;
      }
      // bars + bouncing ball + slot pulses
      for (let b = 0; b < 4; b++) {
        const bar = $("#bar" + b), ball = $("#ball" + b), key = $("#key" + b);
        if (!bar) continue;
        const active = b === contentBar;
        bar.classList.toggle("now", !!active);
        const lbl = $("#barlbl" + b);
        if (lbl) lbl.classList.toggle("now", !!active);
        if (ball) {
          if (!active) { ball.classList.remove("on"); }
          else {
            ball.classList.add("on");
            const cs = (T.centers || [])[b];
            if (cs) {
              const beatF = pos.frac * 4;
              const bi = Math.min(3, Math.floor(beatF));
              const f = beatF - bi;
              const x0 = cs[bi], x1 = bi < 3 ? cs[bi + 1] : cs[3] + (cs[3] - cs[2] || 60);
              const hop = (bi === 3 ? 30 : 17) * 4 * f * (1 - f);
              const sq = f < 0.15 ? 1 - 0.4 * (1 - f / 0.15) : 1;
              ball.style.left = x + "px";
              ball.style.top = (T.ballY[b] || 0) + "px";
              ball.style.transform = `translateX(-50%) translateY(${-hop}px) scaleY(${sq.toFixed(3)})`;
            }
          }
        }
        // current slot pulse
        if (T.slotEls && T.slotEls[b])
          T.slotEls[b].forEach((el, i) => el.classList.toggle("cur", !!active && i === pos.beat));
        if (key) {
          const hit = !!active && pos.beat === 3;
          if (hit && !key.classList.contains("hit")) {
            key.classList.add("hit"); key.classList.remove("pop"); void key.offsetWidth; key.classList.add("pop");
          } else if (!hit) key.classList.remove("hit");
        }
      }
      // sequence end (count-in 4 beats + 4 content bars) when not looping
      if (!T.flow && pos.total >= 20 && !T.loop) {
        if (T.endless) { advanceVerse(); return; }
        stopPlay();
      }
    }
    RAF.id = requestAnimationFrame(step);
  };
  step();
}

function advanceVerse() {
  stopPlay();
  let next;
  if (T.reviewQueue) {
    T.reviewIdx = (T.reviewIdx || 0) + 1;
    next = T.reviewQueue[T.reviewIdx];
    if (!next) { toast("review done · nice work"); location.hash = "#/"; return; }
  } else {
    const i = VERSES.findIndex(v => v.id === T.v.id);
    next = VERSES[(i + 1) % VERSES.length];
  }
  renderTrainer(next.id, T.reviewQueue || undefined);
  startPlay();
}

function completeRound() {
  const id = T.v.id, p = prog(id);
  p.plays = (p.plays || 0) + 1;
  if (T.peeks <= 2) {
    p.level = Math.min(5, (p.level || 0) + 1);
    p.due = todayNum() + INTERVALS[p.level];
    toast(`${id} → level ${p.level} · back in ${INTERVALS[p.level]}d`);
  } else {
    p.due = todayNum() + 1;
    toast(`${id} · ${T.peeks} peeks, back tomorrow`);
  }
  S.verses[id] = p; persist();
  if (T.endless) { advanceVerse(); }
  else renderTrainer(id, T.reviewQueue || undefined);
}

function showWord(k, rhymeOf) {
  if (!k) return;
  const wc = $("#wordcard"); if (!wc) return;
  wc.innerHTML = `
    <b>${esc(k.word)}</b>${k.new ? '<span class="newtag">new</span>' : ""}
    ${k.sanskrit ? ` <span class="sk">· ${esc(k.sanskrit)}</span>` : ""}
    ${rhymeOf ? ` <span class="sk">· rhyme of “${esc(rhymeOf)}”</span>` : ""}
    <div class="gl">${esc(k.context || "")}</div>
    <div class="rh"><b>rhymes:</b> ${(k.rhymes && k.rhymes.length) ? k.rhymes.map(esc).join(" · ") : "hard word, no easy rhymes, slant it"}</div>`;
}

/* ---------------- flow: freestyle trainer (EN / IT) ---------------- */
function flowRhymeOf(b) {
  const s = S.settings.flowScheme, g = i => (T.flowBars[i] || ["", "", "", ""])[3];
  if (s === "AABB") return b === 1 ? g(0) : b === 3 ? g(2) : null;
  if (s === "ABAB") return b === 2 ? g(0) : b === 3 ? g(1) : null;
  if (s === "AAAA") return b > 0 ? g(0) : null;
  return null;
}
function flowShown() {
  const out = new Set();
  (T.flowBars || []).forEach(bar => bar.forEach(w => w && out.add(w)));
  return out;
}
function pickFlowWord(lang, rhymeOf) {
  const shown = flowShown(), L = WORDS[lang] || [];
  if (!L.length) return "…";
  if (rhymeOf) {
    const all = WORDIDX[lang][rhymeOf] || [];
    const fresh = all.filter(r => !shown.has(r));
    const pool = fresh.length ? fresh : all;
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  for (let n = 0; n < 40; n++) {
    const e = L[Math.floor(Math.random() * L.length)];
    if (e && !shown.has(e[0])) return e[0];
  }
  return L[Math.floor(Math.random() * L.length)][0];
}
function flowFillBar(b) {
  const fill = S.settings.flowFill;
  const idxs = fill === "all" ? [0, 1, 2, 3] : fill === "first" ? [0] : fill === "last" ? [3] : [];
  const words = ["", "", "", ""];
  idxs.forEach(i => { words[i] = pickFlowWord(S.settings.flowLang, i === 3 ? flowRhymeOf(b) : null); });
  T.flowBars[b] = words;
}
function refreshFlowBar(b) {
  flowFillBar(b);
  T.flowBars[b].forEach((w, i) => {
    const el = i === 3 ? $("#key" + b) : $("#s" + b + "_" + i);
    if (!el) return;
    el.textContent = w;
    el.classList.toggle("blank", !w);
    el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap");
  });
}
function showFlowWord(b, i) {
  const w = (T.flowBars[b] || [])[i];
  if (!w) return;
  T.sel = [b, i];
  const rs = WORDIDX[S.settings.flowLang][w] || [];
  $("#wordcard").innerHTML = `
    <b>${esc(w)}</b>
    <div class="rh"><b>rhymes:</b> ${rs.length ? "" : "slant it, no easy rhymes"}</div>
    <div class="chips">${rs.map(r => `<button data-act="frhy" data-bar="${b}" data-slot="${i}" data-w="${esc(r)}">${esc(r)}</button>`).join("")}</div>
    <div class="gl">tap a rhyme to swap it in</div>`;
}
function renderFlow() {
  const lang = S.settings.flowLang, fill = S.settings.flowFill, scheme = S.settings.flowScheme;
  T = { flow: true, flowBars: [], taps: [], raf: null, sel: null };
  for (let b = 0; b < 4; b++) flowFillBar(b);
  app.innerHTML = `
  <div class="view">
    <div class="tbar">
      <button class="back" data-act="home">‹</button>
      <div class="t">
        <div class="eyebrow">Flow · ${lang === "it" ? "freestyle italiano" : "english freestyle"}</div>
        <h1>flow trainer</h1>
      </div>
      <div class="lang">
        <button data-act="flang" data-v="en" class="${lang === "en" ? "act" : ""}">EN</button>
        <button data-act="flang" data-v="it" class="${lang === "it" ? "act" : ""}">IT</button>
      </div>
    </div>
    <div class="beat">
      <div class="dots">${[0, 1, 2, 3].map(() => "<i></i>").join("")}</div>
      <div class="bpm">
        <button class="pill" data-act="bpm-">−</button>
        <span class="pill" id="bpmval">${S.settings.bpm} BPM</span>
        <button class="pill" data-act="bpm+">+</button>
        <button class="pill tap" data-act="tap">TAP</button>
      </div>
    </div>
    <div class="bars">
      ${T.flowBars.map((words, b) => `
        <div class="barlbl" id="barlbl${b}">BAR ${b + 1}${b === 0 ? " · bounce on every word" : ""}</div>
        <div class="bar" id="bar${b}">
          <div class="slots">
            ${words.map((w, i) => i === 3
              ? `<button class="s key fw ${w ? "" : "blank"}" data-act="fslot" data-bar="${b}" data-slot="3" id="key${b}">${esc(w)}</button>`
              : `<button class="s fw ${w ? "" : "blank"}" data-act="fslot" data-bar="${b}" data-slot="${i}" id="s${b}_${i}">${esc(w)}</button>`).join("")}
          </div>
          <div class="ball" id="ball${b}"></div>
        </div>`).join("")}
    </div>
    <div class="modes">
      ${[["all", "All words"], ["first", "First only"], ["last", "Last only"], ["free", "No words"]]
        .map(([k, l]) => `<button data-act="ffill" data-v="${k}" class="${fill === k ? "act" : ""}">${l}</button>`).join("")}
    </div>
    <div class="modes">
      ${[["off", "Rhymes off"], ["AABB", "AABB"], ["ABAB", "ABAB"], ["AAAA", "AAAA"]]
        .map(([k, l]) => `<button data-act="fscheme" data-v="${k}" class="${scheme === k ? "act" : ""}">${l}</button>`).join("")}
    </div>
    <div class="word" id="wordcard"><span class="empty">tap a word for rhymes · fresh words every bar</span></div>
    <div class="controls">
      <span class="toghint">words change as the ball passes</span>
      <button class="play" id="playbtn" data-act="play">▶</button>
      <span class="toghint">${(WORDS[lang] || []).length} words · ${lang.toUpperCase()}</span>
    </div>
  </div>
  ${nav("flow")}`;
  if (BEATS.beats.length) addBeatPicker();
  measureSlots();
  startRaf();
}

/* ---------------- review ---------------- */
function renderReview() {
  const due = dueList();
  if (!due.length) { toast("nothing due today"); location.hash = "#/"; return; }
  renderTrainer(due[0].id, due);
  T.reviewQueue = due; T.reviewIdx = 0;
}

/* ---------------- events ---------------- */
app.addEventListener("click", e => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;
  if (act === "home") location.hash = "#/";
  else if (act === "progress") location.hash = "#/progress";
  else if (act === "review") location.hash = "#/review";
  else if (act === "flow") location.hash = "#/flow";
  else if (act === "open") location.hash = "#/verse/" + encodeURIComponent(t.dataset.id);
  else if (act === "reset") {
    if (confirm("Reset all progress?")) { S.verses = {}; persist(); renderProgress(); }
  }
  else if (!T) { /* trainer-only actions below need T */ }
  else if (act === "play") { AE.playing ? stopPlay() : startPlay(); }
  else if (act === "bpm-") setBpm(S.settings.bpm - 2);
  else if (act === "bpm+") setBpm(S.settings.bpm + 2);
  else if (act === "tap") {
    const now = performance.now();
    T.taps.push(now); if (T.taps.length > 5) T.taps.shift();
    if (T.taps.length >= 3) {
      const ds = T.taps.slice(1).map((x, i) => x - T.taps[i]);
      const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
      setBpm(60000 / avg); toast("tempo set by tap");
    }
  }
  else if (act === "fill") { S.settings.fill = t.dataset.v; persist(); renderTrainer(T.v.id, T.reviewQueue || undefined); }
  else if (act === "scheme") { S.settings.scheme = t.dataset.v; persist(); renderTrainer(T.v.id, T.reviewQueue || undefined); }
  else if (act === "loop") { T.loop = !T.loop; $("#loopstate").textContent = T.loop ? "on" : "off"; }
  else if (act === "endless") { T.endless = !T.endless; $("#endlessstate").textContent = T.endless ? "on" : "off"; }
  else if (act === "complete") completeRound();
  else if (act === "peek") {
    const b = +t.dataset.bar, L = T.land[b];
    if (L && !t.textContent.trim()) {
      t.textContent = L.word; t.classList.add("reveal");
      T.peeks++;
      setTimeout(() => { t.textContent = ""; t.classList.remove("reveal"); }, 1400);
    }
  }
  else if (act === "word") {
    const b = +t.dataset.bar, L = T.land[b];
    if (L) showWord(L.base, L.rhymeOf);
  }
  else if (act === "bankword") {
    const k = (T.v.keywords || []).find(x => x.word === t.dataset.w);
    showWord(k);
  }
  else if (act === "flang") { S.settings.flowLang = t.dataset.v; persist(); renderFlow(); }
  else if (act === "ffill") { S.settings.flowFill = t.dataset.v; persist(); renderFlow(); }
  else if (act === "fscheme") { S.settings.flowScheme = t.dataset.v; persist(); renderFlow(); }
  else if (act === "fslot") showFlowWord(+t.dataset.bar, +t.dataset.slot);
  else if (act === "frhy") {
    const b = +t.dataset.bar, i = +t.dataset.slot;
    T.flowBars[b][i] = t.dataset.w;
    const el = i === 3 ? $("#key" + b) : $("#s" + b + "_" + i);
    el.textContent = t.dataset.w;
    el.classList.remove("swap"); void el.offsetWidth; el.classList.add("swap");
    showFlowWord(b, i);
  }
});

/* ---------------- boot ---------------- */
loadData().then(route).catch(e => {
  app.innerHTML = `<div class="view"><div class="card">Could not load verses.json (${esc(e.message)})</div></div>`;
});

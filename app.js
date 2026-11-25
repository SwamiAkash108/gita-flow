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
let S = Object.assign({ verses: {}, settings: { bpm: 84, fill: "all", scheme: "off", beat: "metronome" } }, store.load());
S.settings = Object.assign({ bpm: 84, fill: "all", scheme: "off", beat: "metronome" }, S.settings);
const persist = () => store.save(S);
const todayNum = () => Math.floor(Date.now() / 86400000);
const INTERVALS = { 1: 1, 2: 2, 3: 4, 4: 7, 5: 15 }; // days until due, by new level

/* ---------------- data ---------------- */
let DATA = null, VERSES = [], BY_ID = {}, BEATS = { beats: [] };
async function loadData() {
  const [v, b] = await Promise.all([
    fetch("verses.json").then(r => r.json()),
    fetch("beats/manifest.json").then(r => r.json()).catch(() => ({ beats: [] })),
  ]);
  DATA = v; VERSES = v.verses;
  VERSES.forEach(x => BY_ID[x.id] = x);
  BEATS = b || { beats: [] };
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
  musicBuf: null, musicSrc: null,

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
      this.click(this.nextBeat, this.beatIdx % 4 === 0);
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

/* ---------------- router ---------------- */
let T = null; // trainer state
function route() {
  AE.stop(); T = null;
  const h = location.hash || "#/";
  if (h.startsWith("#/verse/")) renderTrainer(decodeURIComponent(h.slice(8)));
  else if (h.startsWith("#/review")) renderReview();
  else if (h.startsWith("#/progress")) renderProgress();
  else renderHome();
}
window.addEventListener("hashchange", route);

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

  T = { v, land, peeks: 0, reviewQueue: reviewQueue || null, raf: null, sel: null };

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
        <div class="barlbl">BAR ${b + 1}${b === 0 ? " · land on the gold word" : ""}</div>
        <div class="bar" id="bar${b}">
          <div class="balltrack"><div class="ball" id="ball${b}"></div></div>
          <div class="slots">
            ${[0, 1, 2].map(() => `<div class="s"></div>`).join("")}
            <button class="s key ${showKey(b) ? "" : "blank"} ${L.rhymeOf ? "rhy" : ""}" data-act="${showKey(b) ? "word" : "peek"}" data-bar="${b}" id="key${b}">
              ${showKey(b) ? esc(L.word) : ""}
            </button>
          </div>
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
  startRaf();
}

function addBeatPicker() {
  const sel = document.createElement("select");
  sel.className = "beatsel";
  sel.innerHTML = `<option value="metronome">metronome</option>` +
    BEATS.beats.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join("");
  sel.onchange = async () => {
    const wasPlaying = AE.playing; AE.stop(); $("#playbtn").textContent = "▶";
    if (sel.value === "metronome") {
      AE.musicBuf = null; setBpm(S.settings.bpm);
    } else {
      const b = BEATS.beats[+sel.value];
      try { await AE.loadMusic(b.file); setBpm(b.bpm || S.settings.bpm); toast(b.name + " loaded"); }
      catch (e) { toast("could not load beat"); AE.musicBuf = null; }
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
function startRaf() {
  cancelAnimationFrame(T && T.raf);
  const step = () => {
    if (!T) return;
    const pos = AE.pos();
    if (pos && AE.playing) {
      const contentBar = pos.bar - 1;            // -1 during the one-time count-in
      // beat dots
      document.querySelectorAll(".dots i").forEach((d, i) => {
        d.className = i < pos.beat ? "on" : i === pos.beat ? (pos.bar >= 1 ? "on" : "next") : "";
      });
      // bars + ball
      for (let b = 0; b < 4; b++) {
        const bar = $("#bar" + b), ball = $("#ball" + b), key = $("#key" + b);
        if (!bar) continue;
        const active = b === contentBar;
        bar.classList.toggle("now", !!active);
        if (ball) {
          ball.classList.toggle("on", !!active);
          if (active) ball.style.left = (pos.frac * 100) + "%";
        }
        if (key) key.classList.toggle("hit", !!active && pos.beat === 3);
      }
      // sequence end (count-in 4 beats + 4 content bars) when not looping
      if (pos.total >= 20 && !T.loop) {
        if (T.endless) { advanceVerse(); return; }
        stopPlay();
      }
    }
    T.raf = requestAnimationFrame(step);
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
});

/* ---------------- boot ---------------- */
loadData().then(route).catch(e => {
  app.innerHTML = `<div class="view"><div class="card">Could not load verses.json (${esc(e.message)})</div></div>`;
});

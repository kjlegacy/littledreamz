import { useState, useEffect } from "react";

// ─── Wake window data by WEEK (research-based) ───────────────────────────────
// [minWW_h, maxWW_h, napsPerDay, avgNapMin, lastWWExtraMins]
const WW = {
    1: [0.75, 1.0, 5, 45, 0], 2: [0.75, 1.0, 5, 45, 0], 3: [0.75, 1.0, 5, 45, 0], 4: [0.75, 1.0, 5, 45, 0],
    5: [1.0, 1.25, 5, 50, 5], 6: [1.0, 1.25, 5, 50, 5], 7: [1.0, 1.5, 5, 55, 5], 8: [1.0, 1.5, 5, 55, 5],
    9: [1.25, 1.5, 5, 60, 10], 10: [1.25, 1.75, 4, 60, 10], 11: [1.25, 1.75, 4, 65, 10], 12: [1.5, 1.75, 4, 65, 10],
    13: [1.5, 2.0, 4, 70, 15], 14: [1.5, 2.0, 4, 70, 15], 15: [1.75, 2.0, 4, 75, 15], 16: [1.75, 2.0, 4, 75, 15],
    17: [1.75, 2.25, 4, 80, 20], 18: [1.75, 2.25, 4, 80, 20], 19: [2.0, 2.25, 3, 90, 20], 20: [2.0, 2.5, 3, 90, 20],
    21: [2.0, 2.5, 3, 95, 25], 22: [2.0, 2.5, 3, 95, 25], 23: [2.25, 2.5, 3, 100, 25], 24: [2.25, 2.75, 3, 100, 25],
    25: [2.25, 2.75, 3, 100, 30], 26: [2.5, 3.0, 3, 110, 30], 27: [2.5, 3.0, 3, 110, 30], 28: [2.5, 3.0, 3, 115, 30],
    29: [2.75, 3.0, 3, 115, 30], 30: [2.75, 3.25, 3, 120, 35], 31: [2.75, 3.25, 3, 120, 35], 32: [3.0, 3.5, 3, 120, 35],
    33: [3.0, 3.5, 3, 120, 35], 34: [3.0, 3.5, 3, 120, 35], 35: [3.0, 3.5, 3, 120, 35], 36: [3.0, 3.5, 3, 120, 35],
    37: [3.0, 3.75, 2, 120, 40], 38: [3.0, 3.75, 2, 120, 40], 39: [3.25, 3.75, 2, 120, 40], 40: [3.25, 4.0, 2, 120, 40],
    41: [3.25, 4.0, 2, 120, 40], 42: [3.5, 4.0, 2, 120, 40], 43: [3.5, 4.0, 2, 120, 45], 44: [3.5, 4.0, 2, 120, 45],
    45: [3.5, 4.25, 2, 120, 45], 46: [3.75, 4.25, 2, 120, 45], 47: [3.75, 4.5, 2, 120, 45], 48: [3.75, 4.5, 2, 120, 50],
    49: [4.0, 4.5, 2, 120, 50], 50: [4.0, 4.75, 2, 120, 50], 51: [4.0, 4.75, 2, 120, 50], 52: [4.0, 5.0, 2, 120, 50],
};

function getWW(week) { return WW[Math.min(52, Math.max(1, Math.round(week)))] || WW[21]; }

function addMins(d, m) { return new Date(new Date(d).getTime() + m * 60000); }
function diffMins(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }
function fmt(d) { if (!d) return "--:--"; return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDur(m) { if (m == null || m < 0) return "--"; const h = Math.floor(m / 60), r = m % 60; return h > 0 ? `${h}h ${r}m` : `${r}m`; }
function toInput(d) { const x = new Date(d); return x.toTimeString().slice(0, 5); }
function fromInput(s) { const [h, m] = s.split(":").map(Number), d = new Date(); d.setHours(h, m, 0, 0); return d; }

function buildSchedule(wake, weeks, recentEvents = []) {
    const [mn, mx, naps, avgNap, lxtra] = getWW(weeks);
    const avg = (mn + mx) / 2;
    let adj = 0;
    const last = recentEvents[recentEvents.length - 1];
    if (last?.duration < 45) adj = -0.15;
    else if (last?.duration > 90) adj = 0.1;
    const ww = Math.round(Math.max(mn, avg + adj) * 60);
    const lww = ww + lxtra;
    const schedule = [];
    let cur = new Date(wake);
    for (let i = 0; i < naps; i++) {
        const isLast = i === naps - 1;
        const start = addMins(cur, isLast ? lww : ww);
        const dur = i === 0 ? Math.round(avgNap * 1.1) : isLast ? Math.round(avgNap * 0.8) : avgNap;
        const end = addMins(start, dur);
        schedule.push({ index: i + 1, start, end, dur, isLast, ww: isLast ? lww : ww });
        cur = end;
    }
    const bedtime = addMins(schedule[schedule.length - 1].end, lww);
    return { schedule, bedtime, ww, lww, mn, mx };
}

const STORE_KEY = "babynap_v3";
async function load() { try { const r = await window.storage.get(STORE_KEY); return r ? JSON.parse(r.value) : { history: [], settings: { weeks: 21, wake: "07:00" } }; } catch { return { history: [], settings: { weeks: 21, wake: "07:00" } }; } }
async function save(d) { try { await window.storage.set(STORE_KEY, JSON.stringify(d)); } catch { } }

// ── Stars bg ─────────────────────────────────────────────────────────────────
function Stars() {
    const s = Array.from({ length: 30 }, (_, i) => ({ x: (i * 43 + 11) % 100, y: (i * 59 + 7) % 100, r: .5 + (i % 4) * .4, d: (i * .37) % 3.5 }));
    return <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: .28 }}>
        {s.map((p, i) => <circle key={i} cx={`${p.x}%`} cy={`${p.y}%`} r={p.r} fill="white" style={{ animation: `tw ${2 + p.d}s ease-in-out infinite`, animationDelay: `${p.d}s` }} />)}
    </svg>;
}

// ── Modal for manual entry / edit ────────────────────────────────────────────
function EntryModal({ existing, onSave, onClose }) {
    const [st, setSt] = useState(existing?.start ? toInput(existing.start) : toInput(new Date()));
    const [en, setEn] = useState(existing?.end ? toInput(existing.end) : "");
    const [hasEnd, setHasEnd] = useState(!!existing?.end);
    const dur = hasEnd && en && st ? diffMins(fromInput(st), fromInput(en)) : null;
    function doSave() {
        const start = fromInput(st), end = hasEnd && en ? fromInput(en) : null;
        if (end && end <= start) { alert("Wake time must be after sleep time."); return; }
        onSave({ start, end, duration: end ? diffMins(start, end) : null, manual: true });
    }
    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s ease" }}>
            <div style={{ width: "100%", maxWidth: 430, background: "#160f35", borderRadius: "22px 22px 0 0", padding: "24px 22px 42px", border: "1px solid rgba(139,92,246,.35)", animation: "slideUp .25s ease" }}>
                <div style={{ width: 36, height: 3, background: "rgba(255,255,255,.15)", borderRadius: 2, margin: "0 auto 22px" }} />
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "#e2e8f0", marginBottom: 4 }}>
                    {existing ? "Edit Entry" : "Add Manual Entry"}
                </div>
                <div style={{ color: "#475569", fontSize: 12, marginBottom: 20 }}>Enter the actual time(s) you forgot to tap</div>

                <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 7 }}>Baby fell asleep at</div>
                <input type="time" value={st} onChange={e => setSt(e.target.value)} style={INP} />

                <div style={{ margin: "14px 0 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setHasEnd(!hasEnd)} style={{
                        background: hasEnd ? "rgba(139,92,246,.25)" : "rgba(255,255,255,.05)",
                        border: hasEnd ? "1px solid rgba(139,92,246,.4)" : "1px solid rgba(255,255,255,.1)",
                        borderRadius: 9, padding: "6px 14px", color: hasEnd ? "#c4b5fd" : "#64748b",
                        fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: hasEnd ? 700 : 400
                    }}>{hasEnd ? "✓ Baby woke up at…" : "+ Add wake-up time"}</button>
                </div>

                {hasEnd && <>
                    <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", marginBottom: 7 }}>Baby woke up at</div>
                    <input type="time" value={en} onChange={e => setEn(e.target.value)} style={INP} />
                </>}

                {dur !== null && dur > 0 && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(139,92,246,.1)", border: "1px solid rgba(139,92,246,.2)", borderRadius: 10, color: "#a78bfa", fontSize: 13 }}>
                        Duration: <strong>{fmtDur(dur)}</strong>
                        {dur < 45 && <span style={{ color: "#f59e0b", marginLeft: 8, fontSize: 11 }}>Short nap – next WW will adjust</span>}
                        {dur >= 45 && <span style={{ color: "#4ade80", marginLeft: 8, fontSize: 11 }}>✓ Full sleep cycle</span>}
                    </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                    <button onClick={onClose} style={{ flex: 1, padding: "13px", borderRadius: 13, border: "1px solid rgba(255,255,255,.09)", background: "rgba(255,255,255,.04)", color: "#64748b", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                    <button onClick={doSave} style={{ flex: 2, padding: "13px", borderRadius: 13, border: "none", background: "linear-gradient(135deg,#7c3aed,#4f46e5)", color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 4px 18px rgba(124,58,237,.4)" }}>Save Entry</button>
                </div>
            </div>
        </div>
    );
}

const INP = { width: "100%", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 12, padding: "13px 16px", color: "#e2e8f0", fontSize: 16, outline: "none", fontFamily: "inherit" };

// ── Week slider ───────────────────────────────────────────────────────────────
function WeekSlider({ value, onChange }) {
    const months = (value / 4.33).toFixed(1);
    return <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
            <div><span style={{ fontSize: 30, fontWeight: 800, color: "#c4b5fd" }}>{value}</span><span style={{ color: "#475569", fontSize: 13, marginLeft: 5 }}>weeks</span></div>
            <div style={{ background: "rgba(139,92,246,.15)", border: "1px solid rgba(139,92,246,.25)", borderRadius: 10, padding: "5px 13px", color: "#a78bfa", fontSize: 13, fontWeight: 600 }}>≈ {months} months</div>
        </div>
        <input type="range" min={1} max={52} value={value} onChange={e => onChange(+e.target.value)}
            style={{ width: "100%", accentColor: "#7c3aed", height: 6, cursor: "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
            {["1w", "13w", "26w", "39w", "52w"].map(l => <span key={l} style={{ color: "#334155", fontSize: 11 }}>{l}</span>)}
        </div>
    </div>;
}

// ── Nap row ───────────────────────────────────────────────────────────────────
function NapRow({ nap, now, isActive, actual }) {
    const pct = isActive ? Math.min(100, Math.max(0, ((now - new Date(nap.start)) / (new Date(nap.end) - new Date(nap.start))) * 100)) : 0;
    return <div style={{ position: "relative", overflow: "hidden", background: isActive ? "rgba(139,92,246,.13)" : "rgba(255,255,255,.04)", border: isActive ? "1px solid rgba(139,92,246,.38)" : "1px solid rgba(255,255,255,.07)", borderRadius: 15, padding: "13px 15px", marginBottom: 9, transition: "all .3s" }}>
        {isActive && <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,rgba(139,92,246,.2),transparent)", transition: "width 10s linear", borderRadius: 15, pointerEvents: "none" }} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: isActive ? "rgba(139,92,246,.35)" : "rgba(255,255,255,.07)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: isActive ? "#c4b5fd" : "#64748b" }}>{nap.index}</div>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
                        Nap {nap.index}{nap.isLast ? " · Last" : ""}
                        {isActive && <span style={{ marginLeft: 8, fontSize: 10, color: "#a78bfa", background: "rgba(139,92,246,.2)", padding: "2px 7px", borderRadius: 20 }}>● Now</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 1 }}>{fmt(nap.start)} → {fmt(nap.end)} <span style={{ color: "#334155" }}>· WW {fmtDur(nap.ww)}</span></div>
                </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? "#a78bfa" : "#475569" }}>~{fmtDur(nap.dur)}</div>
                {actual?.duration && <div style={{ fontSize: 11, color: "#22d3ee", marginTop: 1 }}>actual {fmtDur(actual.duration)}</div>}
            </div>
        </div>
    </div>;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
    const [weeks, setWeeks] = useState(21);
    const [wakeStr, setWakeStr] = useState("07:00");
    const [wakeTime, setWakeTime] = useState(() => { const d = new Date(); d.setHours(7, 0, 0, 0); return d; });
    const [sched, setSched] = useState(null);
    const [now, setNow] = useState(new Date());
    const [sleeping, setSleeping] = useState(false);
    const [sleepStart, setSleepStart] = useState(null);
    const [events, setEvents] = useState([]);
    const [history, setHistory] = useState([]);
    const [tab, setTab] = useState("today");
    const [modal, setModal] = useState(false);
    const [editIdx, setEditIdx] = useState(null);
    const [ready, setReady] = useState(false);

    useEffect(() => { load().then(d => { if (d.history) setHistory(d.history); if (d.settings) { setWeeks(d.settings.weeks || 21); setWakeStr(d.settings.wake || "07:00"); setWakeTime(fromInput(d.settings.wake || "07:00")); } setReady(true); }); }, []);
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(id); }, []);
    useEffect(() => { setSched(buildSchedule(wakeTime, weeks, events)); }, [wakeTime, weeks, events]);

    async function persistAll(evts, wks = weeks, wk = wakeStr) {
        const today = new Date().toDateString();
        const entry = { date: today, sleepEvents: evts, napsCompleted: evts.length };
        const rest = history.filter(e => e.date !== today);
        const newH = [...rest, entry];
        setHistory(newH);
        await save({ history: newH, settings: { weeks: wks, wake: wk } });
    }

    function handleTap() {
        if (!sleeping) { setSleepStart(new Date()); setSleeping(true); }
        else {
            const end = new Date(), dur = diffMins(sleepStart, end);
            const evts = [...events, { start: sleepStart, end, duration: dur }].sort((a, b) => new Date(a.start) - new Date(b.start));
            setEvents(evts); setSleeping(false); setSleepStart(null); persistAll(evts);
        }
    }

    function saveModal(ev) {
        let evts;
        if (editIdx !== null) { evts = events.map((e, i) => i === editIdx ? ev : e); }
        else { evts = [...events, ev]; }
        evts = evts.sort((a, b) => new Date(a.start) - new Date(b.start));
        setEvents(evts); setModal(false); setEditIdx(null); persistAll(evts);
    }

    function delEvent(i) {
        const evts = events.filter((_, idx) => idx !== i);
        setEvents(evts); persistAll(evts);
    }

    async function changeWeeks(w) { setWeeks(w); await save({ history, settings: { weeks: w, wake: wakeStr } }); }
    async function changeWake(s) { setWakeStr(s); setWakeTime(fromInput(s)); await save({ history, settings: { weeks, wake: s } }); }

    const activeNap = sched?.schedule.find(n => now >= new Date(n.start) && now <= new Date(n.end));
    const nextNap = sched?.schedule.find(n => now < new Date(n.start));
    const minsTo = nextNap ? diffMins(now, new Date(nextNap.start)) : null;
    const [mn, mx] = getWW(weeks);

    let tip = "";
    if (sleeping && sleepStart) { const el = diffMins(sleepStart, now); tip = el > 45 ? "🌙 Over 45 min — full sleep cycle!" : el > 30 ? "💤 Approaching one sleep cycle…" : "😴 Baby is sleeping. Shh!"; }
    else if (minsTo !== null) { tip = minsTo <= 15 ? "⏰ Wind-down now — nap in ~15 min!" : minsTo <= 30 ? "🌿 Dim lights soon — nap in ~30 min." : `🕐 Next nap in ${fmtDur(minsTo)}.`; }
    else if (!nextNap && sched) { tip = `🌙 All naps done! Bedtime around ${fmt(sched.bedtime)}.`; }

    const TABS = [["today", "Today"], ["history", "History"], ["settings", "Settings"]];

    return (
        <div style={{ minHeight: "100vh", background: "linear-gradient(155deg,#080516 0%,#120d2c 50%,#0a1525 100%)", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "#e2e8f0", position: "relative", overflow: "hidden" }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes tw{0%,100%{opacity:.12}50%{opacity:.85}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(36px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.45)}60%{box-shadow:0 0 0 14px rgba(124,58,237,0)}}
        @keyframes ring{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.65);opacity:0}}
        input[type=range]{-webkit-appearance:none;height:6px;border-radius:3px;background:rgba(139,92,246,.25);}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;background:#7c3aed;border-radius:50%;cursor:pointer;box-shadow:0 0 8px rgba(124,58,237,.5);}
      `}</style>
            <Stars />
            <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(124,58,237,.14) 0%,transparent 70%)", pointerEvents: "none" }} />

            {modal && <EntryModal existing={editIdx !== null ? events[editIdx] : null} onSave={saveModal} onClose={() => { setModal(false); setEditIdx(null); }} />}

            <div style={{ maxWidth: 430, margin: "0 auto", padding: "0 16px 60px", position: "relative" }}>

                {/* Header */}
                <div style={{ paddingTop: 42, paddingBottom: 18, animation: "slideUp .5s ease" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                            <img src="logo.png" style={{ width: 42, height: 42, animation: "float 4s ease-in-out infinite", filter: "drop-shadow(0 0 12px rgba(167,139,250,0.3))" }} />
                            <div>
                                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 23, fontWeight: 700, background: "linear-gradient(125deg,#e2e8f0,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>Little Dreamz</div>
                                <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>Week {weeks} · WW {mn}–{mx}h</div>
                            </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ color: "#334155", fontSize: 10, letterSpacing: ".06em" }}>NOW</div>
                            <div style={{ color: "#c4b5fd", fontSize: 15, fontWeight: 700 }}>{fmt(now)}</div>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 3, background: "rgba(255,255,255,.04)", borderRadius: 14, padding: 4, marginBottom: 20, border: "1px solid rgba(255,255,255,.07)" }}>
                    {TABS.map(([k, l]) => (
                        <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "none", background: tab === k ? "rgba(124,58,237,.32)" : "transparent", color: tab === k ? "#c4b5fd" : "#475569", fontWeight: tab === k ? 700 : 400, fontSize: 13, cursor: "pointer", transition: "all .2s", boxShadow: tab === k ? "0 2px 10px rgba(124,58,237,.25)" : "none", fontFamily: "inherit" }}>{l}</button>
                    ))}
                </div>

                {/* TODAY */}
                {tab === "today" && <div style={{ animation: "slideUp .3s ease" }}>
                    {tip && <div style={{ background: "rgba(139,92,246,.1)", border: "1px solid rgba(139,92,246,.22)", borderRadius: 13, padding: "11px 15px", marginBottom: 16, fontSize: 13, color: "#c4b5fd", lineHeight: 1.5 }}>{tip}</div>}

                    {/* Tap button */}
                    <div style={{ display: "flex", alignItems: "center", gap: 15, marginBottom: 18, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 18, padding: "16px 18px" }}>
                        <div style={{ position: "relative", flexShrink: 0 }}>
                            {sleeping && <>
                                <div style={{ position: "absolute", inset: -7, borderRadius: "50%", border: "2px solid rgba(139,92,246,.5)", animation: "ring 1.7s ease-out infinite" }} />
                                <div style={{ position: "absolute", inset: -7, borderRadius: "50%", border: "2px solid rgba(139,92,246,.3)", animation: "ring 1.7s ease-out infinite", animationDelay: ".45s" }} />
                            </>}
                            <button onClick={handleTap} style={{ width: 70, height: 70, borderRadius: "50%", border: "none", cursor: "pointer", background: sleeping ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "linear-gradient(135deg,#1e293b,#334155)", boxShadow: sleeping ? "0 0 28px rgba(124,58,237,.5)" : "0 4px 14px rgba(0,0,0,.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, animation: sleeping ? "pulse 2s ease-in-out infinite" : "none", transition: "all .3s", fontFamily: "inherit" }}>
                                <span style={{ fontSize: 20 }}>{sleeping ? "🌙" : "☀️"}</span>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", color: sleeping ? "#e2e8f0" : "#64748b" }}>{sleeping ? "AWAKE" : "ASLEEP"}</span>
                            </button>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 3 }}>{sleeping ? "Baby is sleeping" : "Tap when baby sleeps"}</div>
                            <div style={{ fontSize: 12, color: "#475569" }}>{sleeping ? `Since ${fmt(sleepStart)} · ${fmtDur(diffMins(sleepStart, now))} elapsed` : "Or add a missed entry below"}</div>
                        </div>
                    </div>

                    {/* Manual entry button */}
                    <button onClick={() => { setEditIdx(null); setModal(true); }} style={{ width: "100%", padding: "11px", borderRadius: 12, border: "1px dashed rgba(139,92,246,.33)", background: "rgba(139,92,246,.06)", color: "#7c3aed", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 20, fontFamily: "inherit" }}>
                        + Add forgotten / missed entry
                    </button>

                    {/* Logged events */}
                    {events.length > 0 && <>
                        <div style={SL}>Logged Today ({events.length})</div>
                        {events.map((ev, i) => (
                            <div key={i} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: "11px 14px", marginBottom: 7, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div style={{ fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>Nap {i + 1}{ev.manual ? " ✏️" : ""}</div>
                                    <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{fmt(ev.start)}{ev.end ? ` → ${fmt(ev.end)}` : " → ongoing?"}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                    {ev.duration != null && <span style={{ fontSize: 13, fontWeight: 700, color: ev.duration >= 45 ? "#a78bfa" : "#f59e0b" }}>{fmtDur(ev.duration)}</span>}
                                    <button onClick={() => { setEditIdx(i); setModal(true); }} style={IB}>✏️</button>
                                    <button onClick={() => delEvent(i)} style={IB}>🗑</button>
                                </div>
                            </div>
                        ))}
                    </>}

                    {/* Schedule */}
                    {sched && <>
                        <div style={{ ...SL, marginTop: events.length ? 16 : 0 }}>Predicted Schedule</div>
                        {sched.schedule.map(n => <NapRow key={n.index} nap={n} now={now} isActive={activeNap?.index === n.index} actual={events[n.index - 1]} />)}
                        <div style={{ background: "rgba(251,191,36,.07)", border: "1px solid rgba(251,191,36,.18)", borderRadius: 15, padding: "13px 15px", marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 20 }}>🌙</span>
                                <div>
                                    <div style={{ color: "#fbbf24", fontSize: 14, fontWeight: 700 }}>Bedtime</div>
                                    <div style={{ color: "#78716c", fontSize: 12 }}>Last WW: {fmtDur(sched.lww)}</div>
                                </div>
                            </div>
                            <div style={{ color: "#fbbf24", fontSize: 20, fontWeight: 700 }}>{fmt(sched.bedtime)}</div>
                        </div>
                    </>}
                </div>}

                {/* HISTORY */}
                {tab === "history" && <div style={{ animation: "slideUp .3s ease" }}>
                    <div style={SL}>Past Sessions</div>
                    {!ready && <div style={{ color: "#334155", fontSize: 13 }}>Loading…</div>}
                    {ready && history.length === 0 && <div style={{ textAlign: "center", padding: "48px 20px", color: "#334155" }}><div style={{ fontSize: 34, marginBottom: 10 }}>📋</div><div style={{ fontSize: 14 }}>No history yet. Start on the Today tab!</div></div>}
                    {history.slice().reverse().map((e, i) => (
                        <div key={i} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 13, padding: "13px 15px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{new Date(e.date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>
                                <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{e.napsCompleted} naps · {(e.sleepEvents || []).map(x => fmtDur(x.duration)).join(", ") || "no durations"}</div>
                            </div>
                            <button onClick={async () => { const u = history.filter(x => x.date !== e.date); setHistory(u); await save({ history: u, settings: { weeks, wake: wakeStr } }); }} style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 8, color: "#f87171", fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
                        </div>
                    ))}
                    {history.length > 0 && <div style={{ background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.2)", borderRadius: 15, padding: 18, marginTop: 8 }}>
                        <div style={{ color: "#c4b5fd", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📊 Stats</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            {[
                                ["Days tracked", history.length],
                                ["Avg naps/day", (history.reduce((s, e) => s + (e.napsCompleted || 0), 0) / history.length).toFixed(1)],
                                ["Total naps", history.reduce((s, e) => s + (e.napsCompleted || 0), 0)],
                                ["Avg nap", (() => { const evs = history.flatMap(e => e.sleepEvents || []).filter(x => x.duration > 0); return evs.length ? fmtDur(Math.round(evs.reduce((s, x) => s + x.duration, 0) / evs.length)) : "--"; })()],
                            ].map(([l, v]) => (
                                <div key={l} style={{ background: "rgba(255,255,255,.04)", borderRadius: 10, padding: "11px 13px" }}>
                                    <div style={{ color: "#c4b5fd", fontSize: 18, fontWeight: 700 }}>{v}</div>
                                    <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{l}</div>
                                </div>
                            ))}
                        </div>
                    </div>}
                </div>}

                {/* SETTINGS */}
                {tab === "settings" && <div style={{ animation: "slideUp .3s ease" }}>
                    <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 17, padding: 20, marginBottom: 16 }}>
                        <div style={SL}>Baby's Age in Weeks</div>
                        <WeekSlider value={weeks} onChange={changeWeeks} />
                    </div>
                    <div style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 17, padding: 20, marginBottom: 16 }}>
                        <div style={SL}>Morning Wake Time</div>
                        <input type="time" value={wakeStr} onChange={e => changeWake(e.target.value)} style={INP} />
                    </div>
                    <div style={{ background: "rgba(139,92,246,.08)", border: "1px solid rgba(139,92,246,.2)", borderRadius: 17, padding: 20 }}>
                        <div style={{ color: "#c4b5fd", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Week {weeks} — What to expect</div>
                        {(() => {
                            const [mn, mx, naps, dur, lx] = getWW(weeks); return (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                                    {[["Wake window", `${mn}–${mx}h`], ["Naps/day", naps], ["Avg nap", fmtDur(dur)], ["Last WW", fmtDur(Math.round((mn + mx) / 2 * 60) + lx)]].map(([l, v]) => (
                                        <div key={l} style={{ background: "rgba(255,255,255,.05)", borderRadius: 11, padding: "11px 13px" }}>
                                            <div style={{ color: "#c4b5fd", fontSize: 17, fontWeight: 700 }}>{v}</div>
                                            <div style={{ color: "#475569", fontSize: 11, marginTop: 2 }}>{l}</div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        <div style={{ padding: "10px 13px", background: "rgba(255,255,255,.03)", borderRadius: 10, color: "#475569", fontSize: 12, lineHeight: 1.6 }}>
                            {weeks <= 8 && "Newborn stage: very short wake windows. Follow sleepy cues closely."}
                            {weeks > 8 && weeks <= 16 && "Early infancy: wake windows growing fast. Watch for cues around 1.5h."}
                            {weeks > 16 && weeks <= 24 && "4–6 month range: consolidating to 3 naps. 4-month regression is real!"}
                            {weeks > 24 && weeks <= 36 && "6–8 months: longer wake windows, naps getting more predictable."}
                            {weeks > 36 && "8–12 months: most babies on 2 naps. Nap transitions coming up."}
                        </div>
                    </div>
                </div>}

            </div>
        </div>
    );
}

const SL = { color: "#475569", fontSize: 11, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", marginBottom: 11, display: "block" };
const IB = { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13 };
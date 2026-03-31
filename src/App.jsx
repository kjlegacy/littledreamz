import { useState, useEffect, useRef } from "react";
import { storage } from "./storage";

// ─── Constants based on new logic ───────────────────────────────────────────
const MIN_WW = 90;
const MAX_WW = 160;
const LEARNING_RATE = 0.2;

function baseWakeWindow(ageWeeks) {
    const base = 100; // starting point ~1h40
    const growth = 2.5; // minutes per week
    return base + (ageWeeks - 16) * growth;
}

function classifyNap(duration) {
    if (duration < 40) return "short";
    if (duration < 90) return "normal";
    return "long";
}

function adjustByNap(base, napType) {
    if (napType === "short") return base - 10;
    if (napType === "long") return base + 10;
    return base;
}

// Data table for napsPerDay, avgNapMin, lastWWExtraMins
const WW = {
    1: [5, 45, 0], 2: [5, 45, 0], 3: [5, 45, 0], 4: [5, 45, 0],
    5: [5, 50, 5], 6: [5, 50, 5], 7: [5, 55, 5], 8: [5, 55, 5],
    9: [5, 60, 10], 10: [4, 60, 10], 11: [4, 65, 10], 12: [4, 65, 10],
    13: [4, 70, 15], 14: [4, 70, 15], 15: [4, 75, 15], 16: [4, 75, 15],
    17: [4, 80, 20], 18: [4, 80, 20], 19: [3, 90, 20], 20: [3, 90, 20],
    21: [3, 95, 25], 22: [3, 95, 25], 23: [3, 100, 25], 24: [3, 100, 25],
    25: [3, 100, 30], 26: [3, 110, 30], 27: [3, 110, 30], 28: [3, 115, 30],
    29: [3, 115, 30], 30: [3, 120, 35], 31: [3, 120, 35], 32: [3, 120, 35],
    33: [3, 120, 35], 34: [3, 120, 35], 35: [3, 120, 35], 36: [3, 120, 35],
    37: [2, 120, 40], 38: [2, 120, 40], 39: [2, 120, 40], 40: [2, 120, 40],
    41: [2, 120, 40], 42: [2, 120, 40], 43: [2, 120, 45], 44: [2, 120, 45],
    45: [2, 120, 45], 46: [2, 120, 45], 47: [2, 120, 45], 48: [2, 120, 50],
    49: [2, 120, 50], 50: [2, 120, 50], 51: [2, 120, 50], 52: [2, 120, 50],
};

function getWWInfo(week) { return WW[Math.min(52, Math.max(1, Math.round(week)))] || WW[21]; }


function getConfidence(history = []) {
    if (history.length < 3) return "low";
    const last5 = history.slice(-5);
    const avgError = last5.reduce((s, e) => s + Math.abs(e), 0) / last5.length;
    if (avgError < 10) return "high";
    return "medium";
}

function addMins(d, m) { return new Date(new Date(d).getTime() + m * 60000); }
function diffMins(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }
function fmt(d) { if (!d) return "--:--"; return new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function fmtDur(m) { if (m == null) return "--"; const abs = Math.abs(Math.round(m)), h = Math.floor(abs / 60), r = abs % 60; const res = h > 0 ? `${h}h ${r}m` : `${r}m`; return m < 0 ? `-${res}` : res; }
function fmtHMS(start, end) {
    if (!start || !end) return "00:00";
    const diff = Math.max(0, Math.floor((end - start) / 1000));
    const h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s` : `${m}m ${pad(s)}s`;
}
function toInput(d) { const x = new Date(d); return x.toTimeString().slice(0, 5); }
function fromInput(s) { const [h, m] = s.split(":").map(Number), d = new Date(); d.setHours(h, m, 0, 0); return d; }

function buildSchedule(wake, weeks, recentEvents = [], useStretch = true, learner = { offset: 0, history: [] }) {
    const [napsPerDay, avgNap, lxtra] = getWWInfo(weeks);
    const schedule = [];
    let cur = new Date(wake);

    for (let i = 0; i < napsPerDay; i++) {
        const isLast = i === napsPerDay - 1;

        // 1. Calculate sleep accumulated before this nap point
        const totalSleepSoFar = recentEvents
            .slice(0, i)
            .reduce((s, e) => s + (e.duration || 0), 0);

        // 2. Base from age
        let base = baseWakeWindow(weeks);

        // 3. Adjust by previous nap type
        const prevActual = recentEvents[i - 1];
        let lastNapDur = prevActual ? prevActual.duration : 90;
        const napType = classifyNap(lastNapDur);
        let wakeWindow = adjustByNap(base, napType);

        // 4. Fatigue adjustments
        if (lastNapDur < 40) wakeWindow -= 10;
        if (totalSleepSoFar < 120 && i > 0) wakeWindow -= 5;

        // 5. Self-learning adjustment
        wakeWindow += (learner.offset || 0);

        if (isLast && useStretch) wakeWindow += lxtra;

        // Limits
        wakeWindow = Math.max(MIN_WW, Math.min(wakeWindow, MAX_WW + (isLast && useStretch ? lxtra : 0)));

        const start = addMins(cur, wakeWindow);
        let dur = avgNap;
        if (i === 0) dur *= 1.1;
        else if (isLast && napsPerDay > 1) dur *= 0.8;

        const finalDur = Math.round(dur);
        const end = addMins(start, finalDur);

        schedule.push({
            index: i + 1,
            start,
            end,
            dur: finalDur,
            isLast,
            ww: Math.round(wakeWindow),
            nap_mode: (recentEvents.length === i && i === 2) ? "short" : "normal"
        });

        // Move cursor for next nap prediction
        const actualThisNap = recentEvents[i];
        if (actualThisNap && actualThisNap.end) {
            cur = new Date(actualThisNap.end);
        } else {
            cur = end;
        }
    }

    const lastNap = schedule[schedule.length - 1];
    const bedtimeWW = Math.max(MIN_WW, Math.min(baseWakeWindow(weeks) + (useStretch ? lxtra : 0), MAX_WW + (useStretch ? lxtra : 0)));
    const bedtime = addMins(lastNap.end, bedtimeWW);

    return {
        schedule,
        bedtime,
        lww: bedtimeWW,
        confidence: getConfidence(learner.history)
    };
}

const STORE_KEY = "babynap_v3";
function load() {
    try {
        const r = storage.get(STORE_KEY);
        return r ? JSON.parse(r) : { history: [], settings: { weeks: 21, wake: "07:00", dueDate: "", useStretch: true, learner: { offset: 0, history: [] } } };
    } catch (e) {
        console.error("Storage load error:", e);
        return { history: [], settings: { weeks: 21, wake: "07:00", dueDate: "", useStretch: true, learner: { offset: 0, history: [] } } };
    }
}
const calcWeeks = (dDate) => {
    if (!dDate) return null;
    const diff = new Date() - new Date(dDate);
    return Math.max(1, Math.floor(diff / (7 * 24 * 60 * 60 * 1000)));
};
function save(d) {
    try {
        storage.set(STORE_KEY, JSON.stringify(d));
    } catch (e) {
        console.error("Storage save error:", e);
    }
}

function Logo({ size = 42 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: "var(--logo-glow)" }}>
            <defs>
                <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                    <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
                </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="45" fill="url(#moonGlow)" />
            <path d="M75 50C75 66.5685 61.5685 80 45 80C28.4315 80 15 66.5685 15 50C15 33.4315 28.4315 20 45 20C47.7607 20 50.4144 20.3732 52.934 21.0718C44.7891 24.5126 39 32.5843 39 42C39 54.1503 48.8497 64 61 64C66.1953 64 70.9328 62.1932 74.6596 59.1834C74.881 56.242 75 53.218 75 50Z" fill="#FDE047" />
            <g transform="translate(42, 38) rotate(-10)">
                <path d="M0 8C0 3.58172 3.58172 0 8 0H12C16.4183 0 20 3.58172 20 8V18C20 22.4183 16.4183 26 12 26H8C3.58172 26 0 22.4183 0 18V8Z" fill="#e2e8f0" />
                <circle cx="10" cy="-2" r="7" fill="#fecaca" />
                <path d="M7 -2C7 -2 8 -4 10 -4C12 -4 13 -2 13 -2" stroke="#475569" strokeWidth="0.8" strokeLinecap="round" />
            </g>
            <circle cx="80" cy="25" r="1.5" fill="white">
                <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="85" cy="45" r="1" fill="white">
                <animate attributeName="opacity" values="1;0.2;1" dur="2.5s" repeatCount="indefinite" />
            </circle>
        </svg>
    );
}

const STARS_DATA = Array.from({ length: 50 }, (_, i) => ({
    x: (i * 127 + 11) % 100,
    y: (i * 153 + 7) % 100,
    r: .4 + (i % 4) * .35,
    d: (i * .37) % 3.5,
    z: 0.4 + (i % 6) * 0.4 // Parallax depth factor
}));

function Stars() {
    const svgRef = useRef(null);
    const state = useRef({ curX: 0, curY: 0, tgtX: 0, tgtY: 0, curS: 0, tgtS: 0 });

    useEffect(() => {
        const handleMove = (e) => {
            state.current.tgtX = (e.clientX / window.innerWidth - 0.5) * 45;
            state.current.tgtY = (e.clientY / window.innerHeight - 0.5) * 45;
        };
        const handleScroll = () => {
            state.current.tgtS = window.scrollY;
        };

        let frame;
        const loop = () => {
            const s = state.current;
            s.curX += (s.tgtX - s.curX) * 0.08;
            s.curY += (s.tgtY - s.curY) * 0.08;
            s.curS += (s.tgtS - s.curS) * 0.08;

            if (svgRef.current) {
                svgRef.current.style.setProperty("--sx", `${s.curX}px`);
                svgRef.current.style.setProperty("--sy", `${s.curY}px`);
                svgRef.current.style.setProperty("--ss", `${s.curS}px`);
            }
            frame = requestAnimationFrame(loop);
        };

        window.addEventListener("mousemove", handleMove);
        window.addEventListener("scroll", handleScroll);
        frame = requestAnimationFrame(loop);

        return () => {
            window.removeEventListener("mousemove", handleMove);
            window.removeEventListener("scroll", handleScroll);
            cancelAnimationFrame(frame);
        };
    }, []);

    return (
        <svg ref={svgRef} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", opacity: "var(--star-opacity)", zIndex: 0, willChange: "transform" }}>
            {STARS_DATA.map((p, i) => (
                <circle
                    key={i}
                    cx={`${p.x}%`}
                    cy={`${p.y}%`}
                    r={p.r}
                    fill="var(--star-color)"
                    style={{
                        transform: `translate3d(calc(var(--sx) * ${p.z * 0.15}), calc((var(--sy) * 0.15 - var(--ss) * 0.18) * ${p.z}), 0)`,
                        animation: `tw ${2.5 + p.d}s ease-in-out infinite`,
                        animationDelay: `${p.d}s`,
                        transition: "none",
                        willChange: "transform"
                    }}
                />
            ))}
        </svg>
    );
}

const INP = { width: "100%", background: "var(--glass-input-bg)", border: "1px solid var(--glass-border-strong)", borderRadius: 12, padding: "13px 16px", color: "var(--text-primary)", fontSize: 16, outline: "none", fontFamily: "inherit", backdropFilter: "blur(8px)" };

const CBTN_STYLE = { background: "var(--glass-bg-hover)", border: "1px solid var(--glass-border)", color: "var(--text-primary)", borderRadius: 10, width: 34, height: 34, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" };
const DAYBTN_STYLE = { border: "none", color: "var(--text-primary)", borderRadius: 10, height: 36, cursor: "pointer", fontSize: 13, fontFamily: "inherit", transition: "all 0.2s" };
const LBTN_STYLE = { background: "none", border: "none", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "5px 10px" };

function GlassCalendar({ value, onChange, onClose }) {
    const today = new Date();
    const [viewDate, setViewDate] = useState(value ? new Date(value) : new Date());

    const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();

    const changeMonth = (delta) => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + delta, 1));

    const select = (d) => {
        const sel = new Date(Date.UTC(viewDate.getFullYear(), viewDate.getMonth(), d));
        onChange(sel.toISOString().split('T')[0]);
        onClose();
    };

    const days = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth(viewDate.getFullYear(), viewDate.getMonth()); i++) days.push(i);

    return (
        <div style={{ background: "var(--modal-bg-light)", backdropFilter: "blur(20px)", border: "1px solid var(--accent-glass-border-strong)", borderRadius: 24, padding: "20px", width: 300, color: "var(--text-primary)", boxShadow: "0 25px 60px rgba(0,0,0,0.7)", zIndex: 1000, animation: "slideUp .3s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 17, fontFamily: "'Playfair Display', serif", color: "var(--accent-lighter)" }}>{viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
                <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => changeMonth(-1)} style={CBTN_STYLE}>‹</button>
                    <button onClick={() => changeMonth(1)} style={CBTN_STYLE}>›</button>
                </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, textAlign: "center", fontSize: 10, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {days.map((d, i) => {
                    const isToday = d && today.getDate() === d && today.getMonth() === viewDate.getMonth() && today.getFullYear() === viewDate.getFullYear();
                    const isSelect = d && value && new Date(value).getUTCDate() === d && new Date(value).getUTCMonth() === viewDate.getMonth() && new Date(value).getUTCFullYear() === viewDate.getFullYear();
                    return d ? (
                        <button key={i} onClick={() => select(d)} style={{
                            ...DAYBTN_STYLE,
                            background: isSelect ? "linear-gradient(135deg, #7c3aed, #4f46e5)" : isToday ? "rgba(124, 58, 237, 0.15)" : "transparent",
                            color: isSelect ? "white" : isToday ? "var(--accent-lighter)" : "var(--text-primary)",
                            fontWeight: isSelect || isToday ? 700 : 400,
                            border: isSelect ? "none" : isToday ? "1px solid rgba(139, 92, 246, 0.4)" : "none"
                        }}>{d}</button>
                    ) : <div key={i} />;
                })}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, paddingTop: 15, borderTop: "1px solid var(--separator)" }}>
                <button onClick={() => { onChange(""); onClose(); }} style={LBTN_STYLE}>Clear</button>
                <button onClick={() => { onChange(today.toISOString().split('T')[0]); onClose(); }} style={LBTN_STYLE}>Today</button>
            </div>
        </div>
    );
}

function GlassyDatePicker({ value, onChange, label }) {
    const [open, setOpen] = useState(false);
    const ref = useRef();

    useEffect(() => {
        const out = (e) => { if (open && ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", out);
        return () => document.removeEventListener("mousedown", out);
    }, [open]);

    return (
        <div style={{ position: "relative" }} ref={ref}>
            <div style={SL}>{label}</div>
            <div
                onClick={() => setOpen(!open)}
                style={{ ...INP, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}
            >
                <span style={{ color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : "Select date..."}</span>
                <span style={{ fontSize: 18, filter: "drop-shadow(0 0 5px rgba(124,58,237,0.5))" }}>📅</span>
            </div>
            {open && (
                <div
                    onClick={() => setOpen(false)}
                    style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", backdropFilter: "blur(4px)", zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s ease" }}>
                    <div onClick={e => e.stopPropagation()}>
                        <GlassCalendar value={value} onChange={onChange} onClose={() => setOpen(false)} />
                    </div>
                </div>
            )}
        </div>
    );
}

function TimeSelectModal({ value, onChange, onClose, label }) {
    const [h, setH] = useState(value ? parseInt(value.split(':')[0]) : new Date().getHours());
    const [m, setM] = useState(value ? parseInt(value.split(':')[1]) : new Date().getMinutes());
    const hRef = useRef(), mRef = useRef();
    const now = new Date();
    const curH = now.getHours(), curM = now.getMinutes();

    useEffect(() => {
        setTimeout(() => {
            const activeH = hRef.current?.querySelector(`[data-active="true"]`);
            const activeM = mRef.current?.querySelector(`[data-active="true"]`);
            if (activeH) activeH.scrollIntoView({ block: 'center', behavior: 'instant' });
            if (activeM) activeM.scrollIntoView({ block: 'center', behavior: 'instant' });
        }, 50);
    }, []);

    const doDone = () => {
        const pad = (v) => String(v).padStart(2, '0');
        onChange(`${pad(h)}:${pad(m)}`);
        onClose();
    };

    return (
        <div
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", backdropFilter: "blur(4px)", zIndex: 1400, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s ease" }}>
            <div onClick={e => e.stopPropagation()}>
                <div style={{ background: "var(--modal-bg)", backdropFilter: "blur(24px)", border: "1px solid var(--accent-glass-border-strong)", borderRadius: 24, padding: "24px", width: 280, color: "var(--text-primary)", boxShadow: "0 25px 60px rgba(0,0,0,0.8)", animation: "slideUp .3s ease" }}>
                    <div style={{ textAlign: "center", fontSize: 18, fontWeight: 700, marginBottom: 20, fontFamily: "'Playfair Display', serif", color: "var(--accent-lighter)" }}>{label}</div>
                    <div style={{ display: "flex", gap: 15, height: 220 }}>
                        <div ref={hRef} className="custom-scroll" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
                            {Array.from({ length: 24 }, (_, i) => (
                                <button key={i} data-active={h === i} onClick={() => setH(i)} disabled={i > curH} style={{ ...DAYBTN_STYLE, width: "100%", background: h === i ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "transparent", color: h === i ? "white" : "var(--text-primary)", fontWeight: h === i ? 700 : 400, marginBottom: 4, height: 42, fontSize: 16, opacity: i > curH ? 0.2 : 1, cursor: i > curH ? "not-allowed" : "pointer" }}>{String(i).padStart(2, '0')}</button>
                            ))}
                        </div>
                        <div ref={mRef} className="custom-scroll" style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
                            {Array.from({ length: 60 }, (_, i) => {
                                const isFutureM = h > curH || (h === curH && i > curM);
                                return <button key={i} data-active={m === i} onClick={() => setM(i)} disabled={isFutureM} style={{ ...DAYBTN_STYLE, width: "100%", background: m === i ? "linear-gradient(135deg,#7c3aed,#4f46e5)" : "transparent", color: m === i ? "white" : "var(--text-primary)", fontWeight: m === i ? 700 : 400, marginBottom: 4, height: 42, fontSize: 16, opacity: isFutureM ? 0.2 : 1, cursor: isFutureM ? "not-allowed" : "pointer" }}>{String(i).padStart(2, '0')}</button>
                            })}
                        </div>
                    </div>
                    <button onClick={doDone} style={{ ...LBTN_STYLE, width: "100%", marginTop: 20, background: "var(--accent-glass-bg-strong)", borderRadius: 12, padding: "12px", fontSize: 15 }}>Done</button>
                </div>
            </div>
        </div>
    );
}

function GlassyTimePicker({ value, onChange, label }) {
    const [open, setOpen] = useState(false);
    const ref = useRef();

    useEffect(() => {
        const out = (e) => { if (open && ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener("mousedown", out);
        return () => document.removeEventListener("mousedown", out);
    }, [open]);

    return (
        <div style={{ position: "relative", width: "100%" }} ref={ref}>
            <div style={SL}>{label}</div>
            <div
                onClick={() => setOpen(!open)}
                style={{ ...INP, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}
            >
                <span style={{ color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{value || "00:00"}</span>
                <span style={{ fontSize: 18, filter: "drop-shadow(0 0 5px rgba(124,58,237,0.5))" }}>🕒</span>
            </div>
            {open && <TimeSelectModal value={value} onChange={onChange} onClose={() => setOpen(false)} label={label} />}
        </div>
    );
}

// ── Modal for manual entry / edit ────────────────────────────────────────────
function EntryModal({ existing, onSave, onClose }) {
    const [st, setSt] = useState(existing?.start ? toInput(existing.start) : toInput(new Date()));
    const [en, setEn] = useState(existing?.end ? toInput(existing.end) : "");
    const [hasEnd, setHasEnd] = useState(!!existing?.end);
    const [err, setErr] = useState("");
    const [closing, setClosing] = useState(false);
    const dur = hasEnd && en && st ? diffMins(fromInput(st), fromInput(en)) : null;

    function handleClose() {
        setClosing(true);
        setTimeout(onClose, 250);
    }

    function doSave() {
        const start = fromInput(st), end = hasEnd && en ? fromInput(en) : null;
        if (end && end <= start) {
            setErr("Whoops! Wake time must be after sleep time.");
            return;
        }
        onSave({ start, end, duration: end ? diffMins(start, end) : null, manual: true });
    }
    return (
        <div
            onClick={handleClose}
            style={{ position: "fixed", inset: 0, background: "var(--overlay-bg-light)", zIndex: 1200, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: closing ? "fadeOutAnim .25s ease forwards" : "fadeIn .2s ease" }}>
            <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: "100%", maxWidth: 430, background: "var(--sheet-bg)", borderRadius: "22px 22px 0 0", padding: "24px 22px 42px", border: "1px solid var(--accent-glass-border-strong)", animation: closing ? "slideDownAnim .25s ease forwards" : "slideUp .25s ease" }}>
                <div style={{ width: 36, height: 3, background: "var(--grab-bar)", borderRadius: 2, margin: "0 auto 22px" }} />
                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 19, color: "var(--text-primary)", marginBottom: 4 }}>
                    {existing ? "Edit Entry" : "Add Manual Entry"}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 20 }}>Enter the actual time(s) you forgot to tap</div>

                <GlassyTimePicker label="Baby fell asleep at" value={st} onChange={setSt} />

                <div style={{ margin: "5px 0 15px", display: "flex", alignItems: "center", gap: 8 }}>
                    <button onClick={() => setHasEnd(!hasEnd)} style={{
                        background: hasEnd ? "var(--accent-glass-bg-strong)" : "var(--glass-bg)",
                        border: hasEnd ? "1px solid var(--accent-glass-border-strong)" : "1px solid var(--glass-border)",
                        borderRadius: 9, padding: "6px 14px", color: hasEnd ? "var(--accent-lighter)" : "var(--text-faint)",
                        fontSize: 12, cursor: "pointer", fontFamily: "inherit", fontWeight: hasEnd ? 700 : 400
                    }}>{hasEnd ? "✓ Baby woke up at…" : "+ Add wake-up time"}</button>
                </div>

                {hasEnd && (
                    <GlassyTimePicker label="Baby woke up at" value={en} onChange={setEn} />
                )}

                {err && (
                    <div style={{ marginTop: 15, padding: "10px 14px", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, color: "#f87171", fontSize: 13, animation: "shake .4s ease" }}>
                        ⚠️ {err}
                    </div>
                )}

                {dur !== null && dur > 0 && !err && (
                    <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--accent-glass-bg)", border: "1px solid var(--accent-glass-border)", borderRadius: 10, color: "var(--accent-light)", fontSize: 13 }}>
                        Duration: <strong>{fmtDur(dur)}</strong>
                        {dur < 45 && <span style={{ color: "#f59e0b", marginLeft: 8, fontSize: 11 }}>Short nap – next WW will adjust</span>}
                        {dur >= 45 && <span style={{ color: "#4ade80", marginLeft: 8, fontSize: 11 }}>✓ Full sleep cycle</span>}
                    </div>
                )}

                <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
                    <button onClick={handleClose} style={{ flex: 1, padding: "13px", borderRadius: 13, border: "1px solid var(--glass-border)", background: "var(--glass-bg)", color: "var(--text-faint)", fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                    <button onClick={doSave} style={{ flex: 2, padding: "13px", borderRadius: 13, border: "none", background: "var(--accent-gradient)", color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: "var(--btn-save-shadow)" }}>Save Entry</button>
                </div>
            </div>
        </div>
    );
}

function ConfidenceModal({ level, onClose }) {
    const desc = {
        high: "Our AI is very confident! Your baby's recent naps have been remarkably consistent with our predictions (average error < 10m).",
        medium: "Developing a pattern. The predictions are usually within 10-20 minutes of actual events as we refine the learning offset.",
        low: "Still learning! We need a few more nap logs to accurately dial in the personal offset for your baby's unique rhythm."
    };
    return (
        <div
            onClick={onClose}
            style={{ position: "fixed", inset: 0, background: "var(--overlay-bg)", backdropFilter: "blur(6px)", zIndex: 1500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s ease" }}>
            <div onClick={e => e.stopPropagation()} style={{ background: "var(--modal-bg)", backdropFilter: "blur(24px)", border: "1px solid var(--accent-glass-border-strong)", borderRadius: 24, padding: "28px", width: 300, color: "var(--text-primary)", boxShadow: "0 25px 60px rgba(0,0,0,0.9)", animation: "slideUp .3s ease", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 15 }}>{level === "high" ? "🌟" : level === "medium" ? "📈" : "🏗️"}</div>
                <div style={{ fontWeight: 800, fontSize: 18, fontFamily: "'Playfair Display', serif", color: "var(--accent-lighter)", marginBottom: 12, textTransform: "capitalize" }}>{level} Confidence</div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 20 }}>{desc[level]}</div>
                <button onClick={onClose} style={{ ...LBTN_STYLE, width: "100%", background: "var(--accent-glass-bg-strong)", borderRadius: 12, padding: "12px", fontSize: 15 }}>Close</button>
            </div>
        </div>
    );
}

// ── Week slider ───────────────────────────────────────────────────────────────
function WeekSlider({ value, onChange }) {
    const months = (value / 4.33).toFixed(1);
    return <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 12 }}>
            <div><span style={{ fontSize: 30, fontWeight: 800, color: "var(--accent-lighter)" }}>{value}</span><span style={{ color: "var(--text-muted)", fontSize: 13, marginLeft: 5 }}>weeks</span></div>
            <div style={{ background: "var(--pill-bg)", border: "1px solid var(--pill-border)", borderRadius: 10, padding: "5px 13px", color: "var(--accent-light)", fontSize: 13, fontWeight: 600 }}>≈ {months} months</div>
        </div>
        <input type="range" min={1} max={52} value={value} onChange={e => onChange(+e.target.value)}
            style={{ width: "100%", accentColor: "#7c3aed", height: 6, cursor: "pointer" }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
            {["1w", "13w", "26w", "39w", "52w"].map(l => <span key={l} style={{ color: "var(--text-dim)", fontSize: 11 }}>{l}</span>)}
        </div>
    </div>;
}

// ── Nap row ───────────────────────────────────────────────────────────────────
function NapRow({ nap, now, isActive, actual }) {
    const pct = isActive ? Math.min(100, Math.max(0, ((now - new Date(nap.start)) / (new Date(nap.end) - new Date(nap.start))) * 100)) : 0;
    return <div style={{ position: "relative", overflow: "hidden", background: isActive ? "var(--accent-glass-bg-active)" : "var(--glass-bg)", border: isActive ? "1px solid var(--accent-glass-border-active)" : "1px solid var(--glass-border)", borderRadius: 15, padding: "13px 15px", marginBottom: 9, transition: "all .3s" }}>
        {isActive && <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${pct}%`, background: "linear-gradient(90deg,rgba(139,92,246,.2),transparent)", transition: "width 10s linear", borderRadius: 15, pointerEvents: "none" }} />}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: isActive ? "var(--accent-glass-bg-strong)" : "var(--glass-bg-hover)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: isActive ? "var(--accent-lighter)" : "var(--text-faint)" }}>{nap.index}</div>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
                        Nap {nap.index}{nap.isLast ? " · Last" : ""}
                        {isActive && <span style={{ marginLeft: 8, fontSize: 10, color: "var(--accent-light)", background: "var(--accent-glass-bg)", padding: "2px 7px", borderRadius: 20 }}>● Now</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 1 }}>{fmt(nap.start)} → {fmt(nap.end)} <span style={{ color: "var(--text-dim)" }}>· WW {fmtDur(nap.ww)}</span></div>
                </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? "var(--accent-light)" : "var(--text-muted)" }}>~{fmtDur(nap.dur)}</div>
                {actual?.duration && <div style={{ fontSize: 11, color: "#22d3ee", marginTop: 1 }}>actual {fmtDur(actual.duration)}</div>}
            </div>
        </div>
    </div>;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
    const [weeks, setWeeks] = useState(21);
    const [dueDate, setDueDate] = useState("");
    const [useStretch, setUseStretch] = useState(true);
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
    const [deletingId, setDeletingId] = useState(null);
    const [learner, setLearner] = useState({ offset: 0, history: [] });
    const [showConf, setShowConf] = useState(false);
    const [ready, setReady] = useState(false);
    const [isEditingStart, setIsEditingStart] = useState(false);
    const [theme, setTheme] = useState(() => storage.get('ld_theme') || 'dark');

    useEffect(() => {
        const d = load();
        if (d.history) {
            setHistory(d.history);
            const today = new Date().toDateString();
            const todayEntry = d.history.find(e => e.date === today);
            if (todayEntry) setEvents(todayEntry.sleepEvents || []);
        }
        if (d.settings) {
            setWeeks(d.settings.weeks || 21);
            setWakeStr(d.settings.wake || "07:00");
            setWakeTime(fromInput(d.settings.wake || "07:00"));
            setDueDate(d.settings.dueDate || "");
            setUseStretch(d.settings.useStretch !== false);
            setLearner(d.settings.learner || { offset: 0, history: [] });
            if (d.settings.dueDate) {
                const w = calcWeeks(d.settings.dueDate);
                if (w) setWeeks(w);
            }
        }
        if (d.activeSleep) {
            setSleeping(d.activeSleep.sleeping);
            if (d.activeSleep.sleepStart) setSleepStart(new Date(d.activeSleep.sleepStart));
        }
        setReady(true);
    }, []);
    useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
    useEffect(() => { setSched(buildSchedule(wakeTime, weeks, events, useStretch, learner)); }, [wakeTime, weeks, events, useStretch, learner]);
    useEffect(() => { document.documentElement.setAttribute('data-theme', theme); storage.set('ld_theme', theme); }, [theme]);

    function persistAll(evts, wks = weeks, wk = wakeStr, activePayload = null, dDate = dueDate, str = useStretch, lrner = learner) {
        const today = new Date().toDateString();
        const entry = { date: today, sleepEvents: evts, napsCompleted: evts.length };
        const rest = history.filter(e => e.date !== today);
        const newH = [...rest, entry];
        setHistory(newH);
        save({
            history: newH,
            settings: { weeks: wks, wake: wk, dueDate: dDate, useStretch: str, learner: lrner },
            activeSleep: activePayload || { sleeping, sleepStart }
        });
    }

    function updateLearner(actualTime, predictedTime) {
        const error = (actualTime - predictedTime) / 60000; // in minutes
        const newOffset = learner.offset + error * LEARNING_RATE;
        const newHistory = [...learner.history, error];
        const newLearner = { offset: newOffset, history: newHistory };
        setLearner(newLearner);
        return newLearner;
    }

    function changeActiveStart(newTimeStr) {
        if (!sleepStart) return;
        const [h, m] = newTimeStr.split(":").map(Number);
        const next = new Date(sleepStart);
        next.setHours(h, m, 0, 0);
        setSleepStart(next);
        save({
            history,
            settings: { weeks, wake: wakeStr, dueDate, useStretch, learner },
            activeSleep: { sleeping: true, sleepStart: next }
        });
        setIsEditingStart(false);
    }

    function handleTap() {
        if (!sleeping) {
            const start = new Date();
            setSleepStart(start);
            setSleeping(true);
            save({ history, settings: { weeks, wake: wakeStr, dueDate, useStretch }, activeSleep: { sleeping: true, sleepStart: start } });
        }
        else {
            const end = new Date(), dur = diffMins(sleepStart, end);
            const evts = [...events, { id: Date.now(), start: sleepStart, end, duration: dur }].sort((a, b) => new Date(a.start) - new Date(b.start));

            // Learning update
            const currentNapIndex = events.length;
            const pred = sched?.schedule[currentNapIndex];
            let newL = learner;
            if (pred) {
                newL = updateLearner(sleepStart, pred.start);
            }

            setEvents(evts); setSleeping(false); setSleepStart(null);
            persistAll(evts, weeks, wakeStr, { sleeping: false, sleepStart: null }, dueDate, useStretch, newL);
        }
    }

    function saveModal(ev) {
        let evts;
        if (editIdx !== null) { evts = events.map((e, i) => i === editIdx ? { ...ev, id: e.id || Date.now() } : e); }
        else { evts = [...events, { ...ev, id: Date.now() }]; }
        evts = evts.sort((a, b) => new Date(a.start) - new Date(b.start));

        // Manual entries don't trigger learning update for now to avoid mess
        setEvents(evts); setModal(false); setEditIdx(null); persistAll(evts);
    }

    function delEvent(i) {
        const id = events[i].id;
        setDeletingId(id);
        setTimeout(() => {
            const evts = events.filter((e) => e.id !== id);
            setEvents(evts);
            persistAll(evts);
            setDeletingId(null);
        }, 300);
    }

    function delHistory(date) {
        setDeletingId(date);
        setTimeout(() => {
            const u = history.filter(x => x.date !== date);
            setHistory(u);
            save({ history: u, settings: { weeks, wake: wakeStr, dueDate, useStretch }, activeSleep: { sleeping, sleepStart } });
            setDeletingId(null);
        }, 300);
    }

    function changeWeeks(w) { setWeeks(w); save({ history, settings: { weeks: w, wake: wakeStr, dueDate, useStretch }, activeSleep: { sleeping, sleepStart } }); }
    function changeWake(s) { setWakeStr(s); setWakeTime(fromInput(s)); save({ history, settings: { weeks, wake: s, dueDate, useStretch }, activeSleep: { sleeping, sleepStart } }); }
    function changeDueDate(d) {
        setDueDate(d);
        const w = calcWeeks(d);
        if (w) setWeeks(w);
        save({ history, settings: { weeks: w || weeks, wake: wakeStr, dueDate: d, useStretch }, activeSleep: { sleeping, sleepStart } });
    }
    function changeStretch(s) {
        setUseStretch(s);
        save({ history, settings: { weeks, wake: wakeStr, dueDate, useStretch: s }, activeSleep: { sleeping, sleepStart } });
    }

    function exportData() {
        const data = { history, settings: { weeks, wake: wakeStr, dueDate, useStretch } };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `little_dreamz_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    const activeNap = sched?.schedule.find(n => now >= new Date(n.start) && now <= new Date(n.end));
    const nextNap = sched?.schedule.find(n => now < new Date(n.start));
    const minsTo = nextNap ? diffMins(now, new Date(nextNap.start)) : null;
    const baseWWVal = baseWakeWindow(weeks);
    const isBedtime = !nextNap && sched;

    let tip = "";
    if (sleeping && sleepStart) { const el = diffMins(sleepStart, now); tip = el > 45 ? "🌙 Over 45 min — full sleep cycle!" : el > 30 ? "💤 Approaching one sleep cycle…" : "😴 Baby is sleeping. Shh!"; }
    else if (minsTo !== null && nextNap) {
        const nt = fmt(nextNap.start);
        tip = minsTo <= 15 ? `⏰ Wind-down — nap in ~15m (at ${nt})!` : minsTo <= 30 ? `🌿 Dim lights — nap in ~30m (at ${nt}).` : `🕐 Next nap in ${fmtDur(minsTo)} (at ${nt}).`;
    }
    else if (!nextNap && sched) { tip = `🌙 All naps done! Bedtime around ${fmt(sched.bedtime)}.`; }

    const TABS = [["today", "Today"], ["history", "History"], ["settings", "Settings"], ["logic", "Guide"]];

    return (
        <div style={{ minHeight: "100vh", background: "var(--bg-gradient)", fontFamily: "'DM Sans','Segoe UI',sans-serif", color: "var(--text-primary)", position: "relative", overflow: "hidden", transition: "background 0.4s ease" }}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        @keyframes tw{0%,100%{opacity:.12}50%{opacity:.85}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(36px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.45)}60%{box-shadow:0 0 0 14px rgba(124,58,237,0)}}
        @keyframes ring{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.65);opacity:0}}
        @keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
        @keyframes slideDownAnim{from{transform:translateY(0);opacity:1}to{transform:translateY(100%);opacity:0}}
        @keyframes fadeOut{0%{opacity:1;transform:translateX(0);max-height:200px;margin-bottom:7px;padding-top:11px;padding-bottom:11px;border-width:1px}100%{opacity:0;transform:translateX(30px);max-height:0;margin-bottom:0;padding-top:0;padding-bottom:0;border-width:0}}
        @keyframes fadeOutAnim{from{opacity:1}to{opacity:0}}
        .custom-scroll::-webkit-scrollbar { display: none; }
        input[type=range]{-webkit-appearance:none;height:6px;border-radius:3px;background:rgba(139,92,246,.25);}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:20px;height:20px;background:#7c3aed;border-radius:50%;cursor:pointer;box-shadow:0 0 8px rgba(124,58,237,.5);}
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button {-webkit-appearance:none;margin:0;}
        input[type=number]{-moz-appearance:textfield;}
      `}</style>
            <Stars />
            <div style={{ position: "absolute", top: -80, right: -80, width: 320, height: 320, borderRadius: "50%", background: "var(--orb-bg)", pointerEvents: "none" }} />

            {modal && <EntryModal existing={editIdx !== null ? events[editIdx] : null} onSave={saveModal} onClose={() => { setModal(false); setEditIdx(null); }} />}
            {showConf && <ConfidenceModal level={sched?.confidence || "low"} onClose={() => setShowConf(false)} />}
            {isEditingStart && sleeping && (
                <TimeSelectModal
                    label="Correct Start Time"
                    value={toInput(sleepStart)}
                    onChange={changeActiveStart}
                    onClose={() => setIsEditingStart(false)}
                />
            )}

            <div style={{ maxWidth: 430, margin: "0 auto", padding: "0 16px 60px", position: "relative" }}>

                {/* Header */}
                <div style={{ paddingTop: 42, paddingBottom: 18, animation: "slideUp .5s ease" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                            <div style={{ animation: "float 4s ease-in-out infinite" }}>
                                <Logo size={42} />
                            </div>
                            <div>
                                <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 23, fontWeight: 700, background: "var(--title-gradient)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1.1 }}>Little Dreamz</div>
                                <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>Week {weeks} · Base {fmtDur(baseWWVal - 10)} – {fmtDur(baseWWVal + 10)}</div>
                            </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ color: "var(--text-dim)", fontSize: 10, letterSpacing: ".06em" }}>NOW</div>
                            <div style={{ color: "var(--accent-lighter)", fontSize: 15, fontWeight: 700 }}>{fmt(now)}</div>
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div style={{ display: "flex", gap: 3, background: "var(--glass-bg)", borderRadius: 14, padding: 4, marginBottom: 20, border: "1px solid var(--glass-border)" }}>
                    {TABS.map(([k, l]) => (
                        <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "none", background: tab === k ? "var(--accent-tab-bg)" : "transparent", color: tab === k ? "var(--accent-lighter)" : "var(--text-muted)", fontWeight: tab === k ? 700 : 400, fontSize: 13, cursor: "pointer", transition: "all .2s", boxShadow: tab === k ? "var(--accent-tab-shadow)" : "none", fontFamily: "inherit" }}>{l}</button>
                    ))}
                </div>

                {/* TODAY */}
                {tab === "today" && <div style={{ animation: "slideUp .3s ease" }}>
                    {tip && <div style={{ background: "var(--accent-glass-bg)", border: "1px solid var(--accent-glass-border)", borderRadius: 13, padding: "11px 15px", marginBottom: 16, fontSize: 13, color: "var(--accent-lighter)", lineHeight: 1.5 }}>
                        {tip}
                        {sched?.confidence && <span onClick={() => setShowConf(true)} style={{ cursor: "pointer", marginLeft: 8, fontSize: 10, background: `var(--conf-${sched.confidence}-bg)`, color: `var(--conf-${sched.confidence}-text)`, padding: "2px 6px", borderRadius: 4, textTransform: "uppercase", fontWeight: 700, whiteSpace: "nowrap", display: "inline-block" }}>{sched.confidence} Confidence</span>}
                    </div>}

                    {/* Tap button */}
                    <div style={{ display: "flex", alignItems: "center", gap: 15, marginBottom: 18, background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 18, padding: "16px 18px" }}>
                        <div style={{ position: "relative", flexShrink: 0 }}>
                            {sleeping && <>
                                <div style={{ position: "absolute", inset: -7, borderRadius: "50%", border: "2px solid var(--ring-color-1)", animation: "ring 1.7s ease-out infinite", pointerEvents: "none" }} />
                                <div style={{ position: "absolute", inset: -7, borderRadius: "50%", border: "2px solid var(--ring-color-2)", animation: "ring 1.7s ease-out infinite", animationDelay: ".45s", pointerEvents: "none" }} />
                            </>}
                            <button onClick={handleTap} style={{ width: 70, height: 70, borderRadius: "50%", border: "none", cursor: "pointer", background: sleeping ? "var(--accent-gradient)" : "var(--btn-off-bg)", boxShadow: sleeping ? "0 0 28px var(--accent-glow)" : "var(--btn-off-shadow)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, animation: sleeping ? "pulse 2s ease-in-out infinite" : "none", transition: "all .3s", fontFamily: "inherit" }}>
                                <span style={{ fontSize: 20 }}>{sleeping ? "🌙" : "☀️"}</span>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", color: sleeping ? "#e2e8f0" : "var(--text-faint)" }}>{sleeping ? "AWAKE" : "ASLEEP"}</span>
                            </button>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 3 }}>{sleeping ? "Baby is sleeping" : "Tap when baby sleeps"}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                                {sleeping ? (
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                        Since
                                        <span
                                            onClick={() => setIsEditingStart(true)}
                                            style={{
                                                color: "var(--accent-lighter)",
                                                textDecoration: "none",
                                                cursor: "pointer",
                                                background: "var(--accent-glass-bg)",
                                                padding: "1px 5px",
                                                borderRadius: 4,
                                                fontWeight: 600
                                            }}
                                        >
                                            {fmt(sleepStart)}
                                        </span>
                                        · {fmtHMS(sleepStart, now)} elapsed
                                    </span>
                                ) : "Or add a missed entry below"}
                            </div>
                        </div>
                    </div>

                    {/* Manual entry button */}
                    <button onClick={() => { setEditIdx(null); setModal(true); }} style={{ width: "100%", padding: "11px", borderRadius: 12, border: "1px dashed var(--dashed-border)", background: "var(--dashed-bg)", color: "var(--accent)", fontSize: 13, fontWeight: 600, cursor: "pointer", marginBottom: 20, fontFamily: "inherit" }}>
                        + Add forgotten / missed entry
                    </button>

                    {events.length > 0 && <>
                        <div style={SL}>Logged Today ({events.length})</div>
                        {events.map((ev, i) => (
                            <div key={ev.id || i} style={{
                                background: "var(--glass-bg)",
                                border: "1px solid var(--glass-border)",
                                borderRadius: 12,
                                padding: "11px 14px",
                                marginBottom: 7,
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                animation: ev.id === deletingId ? "fadeOut 0.35s forwards" : "slideUp 0.3s ease-out",
                                pointerEvents: ev.id === deletingId ? "none" : "auto",
                                overflow: "hidden"
                            }}>
                                <div>
                                    <div style={{ fontSize: 13, color: "var(--text-secondary)", fontWeight: 600 }}>Nap {i + 1}{ev.manual ? " ✏️" : ""}</div>
                                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{fmt(ev.start)}{ev.end ? ` → ${fmt(ev.end)}` : " → ongoing?"}</div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                    {ev.duration != null && <span style={{ fontSize: 13, fontWeight: 700, color: ev.duration >= 45 ? "var(--accent-light)" : "var(--color-warning)" }}>{fmtDur(ev.duration)}</span>}
                                    <button onClick={() => { setEditIdx(i); setModal(true); }} style={IB}>✏️</button>
                                    <button onClick={() => delEvent(i)} style={DEL_BTN}>✕</button>
                                </div>
                            </div>
                        ))}
                    </>}

                    {/* Schedule */}
                    {sched && <>
                        <div style={{ ...SL, marginTop: events.length ? 16 : 0 }}>Predicted Schedule</div>
                        {sched.schedule.map(n => <NapRow key={n.index} nap={n} now={now} isActive={activeNap?.index === n.index} actual={events[n.index - 1]} />)}
                        <div style={{ background: "var(--bedtime-bg)", border: "1px solid var(--bedtime-border)", borderRadius: 15, padding: "13px 15px", marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 20 }}>🌙</span>
                                <div>
                                    <div style={{ color: "var(--bedtime-color)", fontSize: 14, fontWeight: 700 }}>Bedtime</div>
                                    <div style={{ color: "var(--bedtime-muted)", fontSize: 12 }}>Last WW: {fmtDur(sched.lww)}</div>
                                </div>
                            </div>
                            <div style={{ color: "var(--bedtime-color)", fontSize: 20, fontWeight: 700 }}>{fmt(sched.bedtime)}</div>
                        </div>
                    </>}
                </div>}

                {/* HISTORY */}
                {tab === "history" && <div style={{ animation: "slideUp .3s ease" }}>
                    <div style={{ background: "var(--accent-glass-bg)", border: "1px solid var(--accent-glass-border)", borderRadius: 19, padding: "20px", marginBottom: 20 }}>
                        <div style={{ color: "var(--accent-lighter)", fontSize: 13, fontWeight: 700, marginBottom: 15, display: "flex", alignItems: "center", gap: 8 }}>
                            <span>🧠</span> Prime AI with Past Patterns
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 15 }}>
                            {(() => {
                                const base = baseWakeWindow(weeks);
                                const [naps, dur] = getWWInfo(weeks);

                                // Internal local state for this "Prime" form
                                if (!window._hForm) window._hForm = { ww: base, dur: dur, naps: naps };
                                const f = window._hForm;

                                const wwErr = Math.abs(f.ww - base) > 25;
                                const durErr = Math.abs(f.dur - dur) > 30;

                                return <>
                                    <div style={{ background: "var(--glass-bg-hover)", borderRadius: 12, padding: "12px", border: wwErr ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid transparent" }}>
                                        <div style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", marginBottom: 6 }}>Actual Avg WW</div>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                                            <input type="number" defaultValue={Math.floor(f.ww / 60)} onChange={e => { window._hForm.ww = (parseInt(e.target.value) || 0) * 60 + (window._hForm.ww % 60); setNow(new Date()); }} style={{ background: "none", border: "none", borderBottom: `1px solid ${wwErr ? "rgba(248,113,113,0.3)" : "var(--accent-glass-border)"}`, color: wwErr ? "#f87171" : "var(--accent-lighter)", fontSize: 20, fontWeight: 800, width: 35, outline: "none", textAlign: "center", paddingBottom: 2 }} />
                                            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700, marginRight: 8 }}>h</span>
                                            <input type="number" defaultValue={f.ww % 60} onChange={e => { window._hForm.ww = (Math.floor(window._hForm.ww / 60) * 60) + (parseInt(e.target.value) || 0); setNow(new Date()); }} style={{ background: "none", border: "none", borderBottom: `1px solid ${wwErr ? "rgba(248,113,113,0.3)" : "var(--accent-glass-border)"}`, color: wwErr ? "#f87171" : "var(--accent-lighter)", fontSize: 20, fontWeight: 800, width: 45, outline: "none", textAlign: "center", paddingBottom: 2 }} />
                                            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>m</span>
                                        </div>
                                        {wwErr && <div style={{ fontSize: 9, color: "#f87171", marginTop: 4 }}>⚠️ High deviation from {base}m</div>}
                                    </div>
                                    <div style={{ background: "var(--glass-bg-hover)", borderRadius: 12, padding: "12px", border: durErr ? "1px solid rgba(239, 68, 68, 0.4)" : "1px solid transparent" }}>
                                        <div style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", marginBottom: 6 }}>Actual Avg Nap</div>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
                                            <input type="number" defaultValue={Math.floor(f.dur / 60)} onChange={e => { window._hForm.dur = (parseInt(e.target.value) || 0) * 60 + (window._hForm.dur % 60); setNow(new Date()); }} style={{ background: "none", border: "none", borderBottom: `1px solid ${durErr ? "rgba(248,113,113,0.3)" : "var(--accent-glass-border)"}`, color: durErr ? "#f87171" : "var(--accent-lighter)", fontSize: 20, fontWeight: 800, width: 35, outline: "none", textAlign: "center", paddingBottom: 2 }} />
                                            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700, marginRight: 8 }}>h</span>
                                            <input type="number" defaultValue={f.dur % 60} onChange={e => { window._hForm.dur = (Math.floor(window._hForm.dur / 60) * 60) + (parseInt(e.target.value) || 0); setNow(new Date()); }} style={{ background: "none", border: "none", borderBottom: `1px solid ${durErr ? "rgba(248,113,113,0.3)" : "var(--accent-glass-border)"}`, color: durErr ? "#f87171" : "var(--accent-lighter)", fontSize: 20, fontWeight: 800, width: 45, outline: "none", textAlign: "center", paddingBottom: 2 }} />
                                            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 700 }}>m</span>
                                        </div>
                                    </div>
                                    <div style={{ background: "var(--glass-bg-hover)", borderRadius: 12, padding: "12px" }}>
                                        <div style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", marginBottom: 4 }}>Naps/Day</div>
                                        <input type="number" defaultValue={f.naps} onChange={e => { window._hForm.naps = parseInt(e.target.value) || naps; setNow(new Date()); }} style={{ background: "none", border: "none", borderBottom: "1px solid var(--accent-glass-border)", color: "var(--accent-lighter)", fontSize: 20, fontWeight: 800, width: "100%", outline: "none", paddingBottom: 2 }} />
                                    </div>
                                    <button
                                        onClick={() => {
                                            const error = window._hForm.ww - base;
                                            const newL = { offset: learner.offset + (error * 0.3), history: [...learner.history, error, error] };
                                            setLearner(newL);
                                            const fakeEntry = { date: `sim-${Date.now()}`, sleepEvents: Array.from({ length: window._hForm.naps }).map((_, i) => ({ id: i, start: new Date(), end: new Date(), duration: window._hForm.dur })), napsCompleted: window._hForm.naps, simulated: true };
                                            setHistory(h => [fakeEntry, ...h]);
                                            save({ history: [fakeEntry, ...history], settings: { weeks, wake: wakeStr, learner: newL } });
                                            window._hForm = null;
                                        }}
                                        style={{ background: "#7c3aed", border: "none", borderRadius: 12, color: "white", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                                        Prime AI
                                    </button>
                                </>;
                            })()}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, fontStyle: "italic" }}>Priming helps the AI reach 'High Confidence' faster by learning your existing routine.</div>
                    </div>

                    <div style={SL}>Past Sessions</div>
                    {!ready && <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Loading…</div>}
                    {ready && history.length === 0 && <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-dim)" }}><div style={{ fontSize: 34, marginBottom: 10 }}>📋</div><div style={{ fontSize: 14 }}>No history yet. Start on the Today tab!</div></div>}
                    {history.slice().reverse().map((e, i) => (
                        <div key={e.date || i} style={{
                            background: "var(--glass-bg)",
                            border: "1px solid var(--glass-border)",
                            borderRadius: 13,
                            padding: "13px 15px",
                            marginBottom: 8,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            animation: (e.date === deletingId) ? "fadeOut 0.35s forwards" : "slideUp 0.3s ease-out",
                            pointerEvents: (e.date === deletingId) ? "none" : "auto",
                            overflow: "hidden"
                        }}>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--history-text)" }}>
                                    {e.simulated ? "🤖 Simulated Pattern" : new Date(e.date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
                                </div>
                                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{e.napsCompleted} naps · {(e.sleepEvents || []).map(x => fmtDur(x.duration)).join(", ") || "no durations"}</div>
                            </div>
                            <button onClick={() => delHistory(e.date)} style={DEL_BTN}>✕</button>
                        </div>
                    ))}
                    {history.length > 0 && <div style={{ background: "var(--accent-glass-bg)", border: "1px solid var(--accent-glass-border)", borderRadius: 15, padding: 18, marginTop: 8 }}>
                        <div style={{ color: "var(--accent-lighter)", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📊 Stats</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                            {[
                                ["Days tracked", history.length],
                                ["Avg naps/day", (history.reduce((s, e) => s + (e.napsCompleted || 0), 0) / history.length).toFixed(1)],
                                ["Total naps", history.reduce((s, e) => s + (e.napsCompleted || 0), 0)],
                                ["Avg nap", (() => { const evs = history.flatMap(e => e.sleepEvents || []).filter(x => x.duration > 0); return evs.length ? fmtDur(Math.round(evs.reduce((s, x) => s + x.duration, 0) / evs.length)) : "--"; })()],
                            ].map(([l, v]) => (
                                <div key={l} style={{ background: "var(--glass-bg)", borderRadius: 10, padding: "11px 13px" }}>
                                    <div style={{ color: "var(--accent-lighter)", fontSize: 18, fontWeight: 700 }}>{v}</div>
                                    <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{l}</div>
                                </div>
                            ))}
                        </div>
                    </div>}
                </div>}

                {/* SETTINGS */}
                {tab === "settings" && <div style={{ animation: "slideUp .3s ease" }}>
                    <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 17, padding: 20, marginBottom: 16 }}>
                        <GlassyDatePicker label="Baby's Due Date (Optional)" value={dueDate} onChange={changeDueDate} />
                        <div style={SL}>Current Age in Weeks</div>
                        <WeekSlider value={weeks} onChange={changeWeeks} />
                        {dueDate && <div style={{ marginTop: 10, color: "var(--text-faint)", fontSize: 12 }}>Automatically calculates "Adjusted Age". You can still manually override.</div>}
                    </div>

                    <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 17, padding: 20, marginBottom: 16 }}>
                        <div style={SL}>Evening Stretch</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontSize: 13, color: "var(--text-primary)" }}>Add extra time before bedtime?</div>
                            <button onClick={() => changeStretch(!useStretch)} style={{
                                background: useStretch ? "var(--accent)" : "var(--glass-bg-hover)",
                                border: "none", borderRadius: 20, padding: "6px 16px", color: "white", fontWeight: 700, fontSize: 11, cursor: "pointer", transition: "all .3s"
                            }}>{useStretch ? "ON" : "OFF"}</button>
                        </div>
                        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 11 }}>Recommended to build sleep pressure, but may cause overtiredness in some babies.</div>
                    </div>
                    <GlassyTimePicker label="Morning Wake Time" value={wakeStr} onChange={changeWake} />

                    <div style={{ marginBottom: 16 }}>
                        <button onClick={exportData} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "1px solid var(--accent-glass-border-strong)", background: "var(--accent-glass-bg)", color: "var(--accent-lighter)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", transition: "all .3s" }}>
                            📤 Export Data to JSON
                        </button>
                    </div>
                    <div style={{ background: "var(--accent-glass-bg)", border: "1px solid var(--accent-glass-border)", borderRadius: 17, padding: 20, marginBottom: 16 }}>
                        <div style={{ color: "var(--accent-lighter)", fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Week {weeks} — What to expect</div>
                        {(() => {
                            const [naps, dur, lx] = getWWInfo(weeks);
                            const base = baseWakeWindow(weeks);
                            return (
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                                    {[["Base Range", `${fmtDur(base - 10)} – ${fmtDur(base + 10)}`], ["Naps/day", naps], ["Avg Nap", `${fmtDur(dur - 15)} – ${fmtDur(dur + 15)}`], ["Learned Offset", learner.offset > 0 ? `+${fmtDur(learner.offset)}` : fmtDur(learner.offset)]].map(([l, v]) => (
                                        <div key={l} style={{ background: "var(--glass-bg-hover)", borderRadius: 11, padding: "11px 13px" }}>
                                            <div style={{ color: "var(--accent-lighter)", fontSize: 17, fontWeight: 700 }}>{v}</div>
                                            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>{l}</div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                        <div style={{ padding: "10px 13px", background: "var(--glass-bg)", borderRadius: 10, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
                            {weeks <= 8 && "Newborn stage: very short wake windows. Follow sleepy cues closely."}
                            {weeks > 8 && weeks <= 16 && "Early infancy: wake windows growing fast. Watch for cues around 1.5h."}
                            {weeks > 16 && weeks <= 24 && "4–6 month range: consolidating to 3 naps. 4-month regression is real!"}
                            {weeks > 24 && weeks <= 36 && "6–8 months: longer wake windows, naps getting more predictable."}
                            {weeks > 36 && "8–12 months: most babies on 2 naps. Nap transitions coming up."}
                        </div>
                    </div>

                    {/* Theme Toggle */}
                    <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 17, padding: 20 }}>
                        <div style={SL}>Appearance</div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{ fontSize: 20 }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
                                <div>
                                    <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{theme === 'dark' ? 'Night Mode' : 'Day Mode'}</div>
                                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{theme === 'dark' ? 'Dark purple with stars' : 'Sunny sky with clouds'}</div>
                                </div>
                            </div>
                            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} style={{
                                width: 52, height: 28, borderRadius: 14, border: "none", cursor: "pointer",
                                background: theme === 'light' ? 'var(--accent-gradient)' : 'var(--glass-bg-hover)',
                                position: "relative", transition: "all .3s",
                                boxShadow: theme === 'light' ? 'var(--btn-save-shadow)' : 'none'
                            }}>
                                <div style={{
                                    width: 22, height: 22, borderRadius: "50%", background: "white",
                                    position: "absolute", top: 3,
                                    left: theme === 'light' ? 27 : 3,
                                    transition: "left .3s ease",
                                    boxShadow: "0 1px 3px rgba(0,0,0,.2)"
                                }} />
                            </button>
                        </div>
                    </div>
                </div>}

                {tab === "logic" && <div style={{ animation: "slideUp .3s ease" }}>
                    <div style={{ ...SL, marginBottom: 15 }}>Sleep Reference Chart</div>

                    <div style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 18, padding: "16px 1px", marginBottom: 20, overflowX: "auto" }} className="custom-scroll">
                        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
                            <thead>
                                <tr style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                                    {["Age", "Naps", "WW", "Total Nap", "Night"].map(h => (
                                        <th key={h} style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 700, textAlign: "left", padding: "0 15px 10px", textTransform: "uppercase", letterSpacing: ".1em" }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {[
                                    ["0-3m", "4-5", "1h-1.5h", "4-6h", "10-12h"],
                                    ["4-6m", "3-4", "1.5h-2.5h", "3-4h", "11-12h"],
                                    ["7-9m", "2-3", "2h-3h", "2.5h-3.5h", "11-12h"],
                                    ["10-12m", "2", "3h-4h", "2h-3h", "11-12h"],
                                    ["13-18m", "1-2", "4h-6h", "1.5h-2h", "11-12h"]
                                ].map((row, idx) => (
                                    <tr key={idx} style={{ borderBottom: idx === 4 ? "none" : "1px solid rgba(255,255,255,.03)" }}>
                                        {row.map((cell, i) => (
                                            <td key={i} style={{ padding: "12px 15px", fontSize: 12, color: i === 0 ? "var(--accent-lighter)" : "var(--text-primary)", fontWeight: i === 0 ? 700 : 400 }}>{cell}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ ...SL, marginBottom: 18 }}>The Little Dreamz Blueprint</div>

                    {[
                        { title: "☀️ Awake Windows", icon: "🕒", desc: "Wake windows are the 'sweet spot' for your baby. Ours start at 1h 40m (at 16 weeks) and grow by 2.5 min each week. The final window before bedtime is 'stretched' by an extra 30-45m to build sleep pressure for the night." },
                        { title: "💤 Nap Durations", icon: "😴", desc: "We predict naps based on your baby's age. To protect night sleep, the last nap of the day (the bridge nap) is automatically predicted to be 20% shorter than the others." },
                        { title: "🧠 Self-Learning AI", icon: "🧠", desc: "The app calculates a personal 'Offset' for your baby by comparing our predictions to your actual logs. If your baby consistently needs more or less time, the AI learns and adjusts the entire future schedule." },
                        { title: "⚡ Overtiredness Guard", icon: "🛡️", desc: "Short naps (<40m) mean your baby isn't fully rested. When you log one, the AI will instantly reduce your next wake window by up to 20 minutes to prevent overtiredness." }
                    ].map(card => (
                        <div key={card.title} style={{ background: "var(--glass-bg)", border: "1px solid var(--glass-border)", borderRadius: 18, padding: 20, marginBottom: 15, backdropFilter: "blur(10px)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                                <div style={{ fontSize: 24, background: "var(--accent-glass-bg-strong)", width: 42, height: 42, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{card.icon}</div>
                                <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>{card.title}</div>
                            </div>
                            <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>{card.desc}</div>
                        </div>
                    ))}

                    <div style={{ textAlign: "center", padding: "20px 0", color: "var(--text-muted)", fontSize: 11 }}>
                        Version 3.2.0 · Little Dreamz designed by Alina J.
                    </div>
                </div>}

            </div>
        </div>
    );
}

const SL = { color: "var(--text-muted)", fontSize: 11, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase", marginBottom: 11, display: "block" };
const IB = { background: "var(--glass-bg-hover)", border: "1px solid var(--glass-border)", borderRadius: 8, padding: "5px 8px", cursor: "pointer", fontSize: 13, transition: "transform 0.2s" };
const DEL_BTN = { ...IB, color: "#f87171", background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.15)", fontWeight: 700 };

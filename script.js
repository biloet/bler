(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  $("#year").textContent = new Date().getFullYear();

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- Modals ----------
  function openModal(id) {
    const m = document.getElementById(id);
    m.hidden = false;
    document.body.style.overflow = "hidden";
    const focusable = m.querySelector("input, .wallet");
    if (focusable) setTimeout(() => focusable.focus(), 50);
  }
  function closeModals() {
    $$(".modal").forEach((m) => (m.hidden = true));
    document.body.style.overflow = "";
  }
  $$("[data-open-wallet]").forEach((b) => b.addEventListener("click", () => openModal("walletModal")));
  $$("[data-open-launch]").forEach((b) => b.addEventListener("click", () => openModal("launchModal")));
  $$("[data-close]").forEach((b) => b.addEventListener("click", closeModals));
  document.addEventListener("keydown", (e) => e.key === "Escape" && closeModals());

  $$(".wallet").forEach((w) =>
    w.addEventListener("click", () => {
      closeModals();
      toast(`${w.dataset.wallet} — wallet integration coming soon`);
    })
  );

  $("#launchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    let ticker = String(data.get("ticker")).trim().toUpperCase();
    if (!ticker.startsWith("$")) ticker = "$" + ticker;
    closeModals();
    e.target.reset();
    toast(`${ticker} ready to launch on ${data.get("chain")} 🚀`);
  });

  $$(".btn-buy, .btn-sell").forEach((b) =>
    b.addEventListener("click", () => openModal("walletModal"))
  );

  // ---------- Hero chart (live-ish random walk) ----------
  const W = 600, H = 200, N = 60;
  let series = [];
  let v = 40;
  for (let i = 0; i < N; i++) {
    v += (Math.random() - 0.38) * 6;
    v = Math.max(8, Math.min(95, v));
    series.push(v);
  }
  let mcap = 84219;

  function pathFor(data) {
    const min = Math.min(...data) - 5, max = Math.max(...data) + 5;
    const pts = data.map((d, i) => [
      (i / (data.length - 1)) * W,
      H - ((d - min) / (max - min)) * (H - 20) - 10,
    ]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return { line: d, area: `${d} L${W},${H} L0,${H} Z` };
  }

  function renderChart() {
    const { line, area } = pathFor(series);
    $("#chartLine").setAttribute("d", line);
    $("#chartArea").setAttribute("d", area);
  }
  renderChart();

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) {
    setInterval(() => {
      const last = series[series.length - 1];
      const next = Math.max(8, Math.min(95, last + (Math.random() - 0.42) * 6));
      series = [...series.slice(1), next];
      renderChart();

      mcap = Math.max(1000, Math.round(mcap * (1 + (next - last) / 400)));
      $("#mcap").textContent = "$" + mcap.toLocaleString("en-US");
      const pct = ((next - series[0]) / (series[0] + 50)) * 100;
      const ch = $("#change");
      ch.textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
      ch.className = "change " + (pct >= 0 ? "up" : "down");
    }, 1400);
  }

  // ---------- Profiles ----------
  const COLORS = [
    ["#ff8a00", "#e52e71"], ["#00c6ff", "#0072ff"], ["#7f00ff", "#e100ff"],
    ["#11998e", "#38ef7d"], ["#f7971e", "#ffd200"], ["#ee0979", "#ff6a00"],
    ["#8e2de2", "#4a00e0"], ["#00b09b", "#96c93d"], ["#fc466b", "#3f5efb"],
  ];
  const PROFILES = [
    { name: "Satoshi Vibes", handle: "satvibes", mcap: 412300, change: 34.2, age: 9 },
    { name: "Degen Dina", handle: "degendina", mcap: 238910, change: 12.8, age: 3 },
    { name: "Moon Marco", handle: "moonmarco", mcap: 189200, change: -4.1, age: 14 },
    { name: "Alpha Ayu", handle: "alphaayu", mcap: 156780, change: 22.5, age: 1 },
    { name: "Chart Chad", handle: "chartchad", mcap: 98340, change: 8.9, age: 6 },
    { name: "Nina Onchain", handle: "ninaonchain", mcap: 77110, change: -2.3, age: 2 },
    { name: "Budi Builds", handle: "budibuilds", mcap: 64520, change: 41.7, age: 0.5 },
    { name: "Pixel Putri", handle: "pixelputri", mcap: 51200, change: 5.4, age: 4 },
    { name: "Rizky Rekt", handle: "rizkyrekt", mcap: 33980, change: -11.6, age: 7 },
  ].map((p, i) => ({ ...p, colors: COLORS[i % COLORS.length], spark: makeSpark(p.change) }));

  function makeSpark(change) {
    const pts = [];
    let y = 50;
    for (let i = 0; i < 16; i++) {
      y += (Math.random() - 0.5) * 18 - change / 20;
      y = Math.max(4, Math.min(96, y));
      pts.push(y);
    }
    return pts;
  }

  const fmtUsd = (n) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n}`;

  function renderProfiles(sort = "trending") {
    const list = [...PROFILES].sort((a, b) =>
      sort === "new" ? a.age - b.age : sort === "mcap" ? b.mcap - a.mcap : b.change - a.change
    );
    $("#profiles").innerHTML = list
      .map((p) => {
        const up = p.change >= 0;
        const pts = p.spark.map((y, i) => `${(i / 15) * 64},${(y / 100) * 28}`).join(" ");
        return `
        <div class="p-card card" data-handle="${p.handle}">
          <div class="avatar" style="background:linear-gradient(135deg,${p.colors[0]},${p.colors[1]})">${p.name[0]}</div>
          <div class="p-info">
            <div class="p-name">${p.name}</div>
            <div class="p-handle">@${p.handle} · $${p.handle.slice(0, 5).toUpperCase()}</div>
          </div>
          <svg class="p-spark" viewBox="0 0 64 28" preserveAspectRatio="none">
            <polyline points="${pts}" fill="none" stroke="${up ? "#3ee08f" : "#ff5a5f"}" stroke-width="1.6" stroke-linejoin="round"/>
          </svg>
          <div class="p-right">
            <div class="p-mcap">${fmtUsd(p.mcap)}</div>
            <div class="change ${up ? "up" : "down"}">${up ? "+" : ""}${p.change.toFixed(1)}%</div>
          </div>
        </div>`;
      })
      .join("");
  }
  renderProfiles();

  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      renderProfiles(t.dataset.sort);
    })
  );

  $("#profiles").addEventListener("click", (e) => {
    const card = e.target.closest(".p-card");
    if (card) toast(`Opening @${card.dataset.handle}…`);
  });

  // ---------- Marquee ----------
  const items = PROFILES.map((p, i) => {
    const buy = i % 3 !== 1;
    const amt = (Math.random() * 2 + 0.05).toFixed(2);
    return `<span class="m-item"><span class="m-dot" style="background:linear-gradient(135deg,${p.colors[0]},${p.colors[1]})"></span>
      <b>@${p.handle}</b> ${buy ? '<span class="up">bought</span>' : '<span class="down">sold</span>'} ${amt} ${i % 2 ? "ETH" : "SOL"}</span>`;
  }).join("");
  $("#marquee").innerHTML = items + items;

  // ---------- Bottom nav active state ----------
  const sections = ["home", "explore", "how"].map((id) => document.getElementById(id));
  const navItems = $$(".bottom-nav a.bn-item");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        navItems.forEach((a) =>
          a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id)
        );
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  sections.forEach((s) => s && io.observe(s));

  // ---------- Reveal on scroll ----------
  const revealEls = $$(".section-head, .num, .step, .feature, .faq details, .cta, .p-card");
  revealEls.forEach((el) => el.classList.add("reveal"));
  const ro = new IntersectionObserver(
    (entries) =>
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          ro.unobserve(en.target);
        }
      }),
    { threshold: 0.12 }
  );
  revealEls.forEach((el) => ro.observe(el));
})();

// ================= Cinematic effects =================
(() => {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;

  // Intro: only play once per session
  const intro = document.getElementById("intro");
  try {
    if (sessionStorage.getItem("bler-intro")) {
      intro.classList.add("skip");
      document.documentElement.style.setProperty("--intro-skip", "1");
      document.querySelectorAll(".hero > .pill, .hero-sub, .hero-ctas, .mockup-stage, .hero-title .word")
        .forEach((el) => (el.style.animationDelay = "0s"));
    }
    sessionStorage.setItem("bler-intro", "1");
  } catch (_) {}

  // Starfield
  const canvas = document.getElementById("stars");
  const ctx = canvas.getContext("2d");
  let stars = [], w, h, dpr;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    const count = Math.round((innerWidth * innerHeight) / 9000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      z: Math.random() * 0.8 + 0.2,
      t: Math.random() * Math.PI * 2,
    }));
  }
  let scrollY = 0;
  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.t += 0.02 * s.z;
      const y = (s.y - scrollY * s.z * 0.3 * dpr) % h;
      const a = 0.25 + Math.sin(s.t) * 0.25 + s.z * 0.4;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, y < 0 ? y + h : y, s.z * 1.1 * dpr, 0, Math.PI * 2);
      ctx.fill();
      if (!reduced) s.x += 0.04 * s.z * dpr;
      if (s.x > w) s.x = 0;
    }
    if (!reduced) requestAnimationFrame(draw);
  }
  resize();
  draw();
  addEventListener("resize", resize);
  addEventListener("scroll", () => {
    scrollY = window.scrollY;
    if (reduced) draw();
  }, { passive: true });

  // Cursor glow + card spotlight
  const glow = document.getElementById("cursorGlow");
  if (fine && !reduced) {
    addEventListener("pointermove", (e) => {
      glow.classList.add("on");
      glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    });
  }
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest(".card, .mockup-body");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });

  // 3D tilt on mockup (mouse) + scroll-driven tilt (all)
  const stage = document.getElementById("stage");
  const mockup = document.getElementById("mockup");
  let mx = 0, my = 0, scrollTilt = 12;
  function applyTilt() {
    mockup.style.transform = `rotateX(${scrollTilt + my * -6}deg) rotateY(${mx * 8}deg)`;
  }
  if (!reduced) {
    const onScroll = () => {
      const r = stage.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight * 0.8)));
      scrollTilt = 18 * (1 - p);
      applyTilt();
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (fine) {
      stage.addEventListener("pointermove", (e) => {
        const r = stage.getBoundingClientRect();
        mx = (e.clientX - r.left) / r.width - 0.5;
        my = (e.clientY - r.top) / r.height - 0.5;
        applyTilt();
      });
      stage.addEventListener("pointerleave", () => { mx = my = 0; applyTilt(); });
    }
  }

  // Count-up numbers
  const fmt = (n, el) => {
    const dec = +(el.dataset.decimals || 0);
    let s;
    if ("compact" in el.dataset) {
      s = n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0);
    } else {
      s = dec ? n.toFixed(dec) : Math.round(n).toLocaleString("en-US");
    }
    return (el.dataset.prefix || "") + s + (el.dataset.suffix || "");
  };
  const counters = document.querySelectorAll("[data-count]");
  const co = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      const el = en.target, target = +el.dataset.count;
      co.unobserve(el);
      if (reduced) return (el.textContent = fmt(target, el));
      const t0 = performance.now(), dur = 1800;
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = fmt(target * (1 - Math.pow(1 - k, 4)), el);
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.4 });
  counters.forEach((c) => co.observe(c));
})();

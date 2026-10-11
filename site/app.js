/* Fronteira dos LLMs — lê data/scorecard.json + data/meta.json (gerados por tools/export_site.py).
   Uma tela por análise (menu lateral, #hash e teclas 1-9); em notebook nada rola: tabelas paginam. */
"use strict";

/* métricas gerais; as de aplicação (app_<id>) entram em buildMetrics() a partir de meta.applications */
const METRICS = {
  aa_intelligence_index: { label: "AA Intelligence Index", short: "AA Index", digits: 1 },
  eci: { label: "Epoch Capabilities Index", short: "ECI", digits: 1 },
  arena_elo: { label: "Arena Elo (texto)", short: "Arena Elo", digits: 0 },
};
/* benchmarks mostrados na tabela quando a métrica escolhida é geral */
const CORE_BENCHMARKS = ["gpqa_diamond", "hle", "swe_bench_verified", "terminal_bench", "frontiermath_t1_3", "simpleqa_verified", "arc_agi_2"];
const BATCH_STATUS = {
  official: { icon: "✓", label: "Oficial" },
  estimated: { icon: "≈", label: "Estimado" },
  unavailable: { icon: "–", label: "Indisponível" },
};
const VIEWS = ["geral", "aplicacoes", "aplicabilidade", "ranking", "batch", "evolucao", "modelos", "metodo", "fontes"];
const MAX_HIGHLIGHT = 3;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const FIXED_LAYOUT = window.matchMedia("(min-width: 960px) and (min-height: 560px)");
const MONITOR = window.matchMedia("(min-width: 1280px) and (min-height: 860px)"); // mesma faixa do styles.css

const state = {
  view: "geral", mode: "standard", metric: "aa_intelligence_index", weights: "all", since: "all", query: "",
  highlight: [], // [{ org, slot }] — a cor segue o laboratório enquanto ele estiver destacado
  sort: { key: "score", dir: -1 }, cols: "prices", heatPage: 0, tablePage: 0, methodApp: null,
};
let DATA = { models: [], meta: null };
const charts = {};

/* ---------- formatação ---------- */
const nf = (d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtScore = (v, metric = state.metric) => (v == null ? "—" : nf(METRICS[metric].digits).format(v));
function fmtUsd(v) {
  if (v == null) return "—";
  return "US$ " + nf(v < 0.1 ? 3 : 2).format(v);
}
const fmtPct = (v) => (v == null ? "—" : nf(0).format(v) + "%");
/* preço sem o prefixo, para colunas cujo cabeçalho já diz a unidade */
const fmtPrice = (v) => (v == null ? "—" : nf(v < 0.1 ? 3 : 2).format(v));
const isNarrow = () => window.innerWidth < 640;
const fmtTick = (v) => (isNarrow() ? "" : "US$ ") + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
function fmtDate(iso, opts = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", opts);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
/* nota bruta de um benchmark: % nos testes, pontos no Elo, índice com uma casa */
function fmtBench(col, v) {
  if (v == null) return "—";
  const b = DATA.meta.benchmarks[col];
  if (b?.source === "lmarena") return nf(0).format(v);
  if (b?.source === "epoch" && col !== "eci") return nf(0).format(v * 100) + "%";
  return nf(1).format(v);
}

/* ---------- dados derivados ---------- */
const priceOf = (m, mode = state.mode) => (mode === "batch" ? m.blended_batch_usd_1m : m.blended_usd_1m);
const scoreOf = (m, metric = state.metric) => m[metric];
const appOf = (metric = state.metric) => METRICS[metric]?.app;
const appKeys = () => Object.keys(METRICS).filter((k) => METRICS[k].app);
/* como a métrica aparece no meio de uma frase: "índice de programação", "AA Index" */
const metricPhrase = (metric = state.metric) =>
  (METRICS[metric].app ? `índice de ${METRICS[metric].app.label.toLowerCase()}` : METRICS[metric].short);

function buildMetrics() {
  for (const app of DATA.meta.applications ?? []) {
    METRICS[`app_${app.id}`] = { label: `${app.label} (índice 0 a 100)`, short: app.label, digits: 0, app };
  }
  const groups = [["Geral", Object.keys(METRICS).filter((k) => !METRICS[k].app)], ["Por aplicação", appKeys()]];
  document.getElementById("metric-select").replaceChildren(...groups.filter(([, keys]) => keys.length).map(([label, keys]) => {
    const g = document.createElement("optgroup"); g.label = label;
    for (const k of keys) {
      const o = el("option", null, METRICS[k].app ? METRICS[k].short : METRICS[k].label); o.value = k; g.append(o);
    }
    return g;
  }));
}

function filtered() {
  const q = fold(state.query.trim());
  const cutoff = state.since === "all" ? null : Date.now() - Number(state.since) * 864e5;
  return DATA.models.filter((m) => {
    if (state.weights === "open" && m.open_weights !== true) return false;
    if (state.weights === "closed" && m.open_weights !== false) return false;
    if (cutoff && (!m.release_date || new Date(m.release_date).getTime() < cutoff)) return false;
    if (q && !fold(m.display_name).includes(q) && !fold(m.organization).includes(q) && !fold(m.model_id).includes(q)) return false;
    return true;
  });
}

/** Fronteira de Pareto: nenhum outro modelo é ao mesmo tempo mais barato (ou igual) e mais capaz (ou igual). */
function paretoFront(models, mode = state.mode, metric = state.metric) {
  const pts = models
    .filter((m) => scoreOf(m, metric) != null && priceOf(m, mode) > 0)
    .sort((a, b) => priceOf(a, mode) - priceOf(b, mode) || scoreOf(b, metric) - scoreOf(a, metric));
  const front = [];
  let best = -Infinity;
  for (const m of pts) {
    if (scoreOf(m, metric) > best) { front.push(m); best = scoreOf(m, metric); }
  }
  return front;
}

/** Melhor custo-benefício: na fronteira, com pelo menos 80% da nota do líder, a maior nota por dólar. */
function bestValue(models, metric, mode = state.mode, excludeLeader = false) {
  const ranked = models.filter((m) => scoreOf(m, metric) != null).sort((a, b) => scoreOf(b, metric) - scoreOf(a, metric));
  const leader = ranked[0];
  if (!leader) return { leader: null, value: null };
  const floor = scoreOf(leader, metric) * 0.8;
  const value = paretoFront(models, mode, metric)
    .filter((m) => scoreOf(m, metric) >= floor && !(excludeLeader && m === leader))
    .sort((a, b) => scoreOf(b, metric) / priceOf(b, mode) - scoreOf(a, metric) / priceOf(a, mode))[0] ?? null;
  return { leader, value };
}

function slotColor(slot) { return css(`--hl-${slot}`); }
function highlightOf(m) { return state.highlight.find((h) => h.org === m.organization); }
function markColor(m) { const h = highlightOf(m); return h ? slotColor(h.slot) : css("--mark"); }

/* ---------- layout: quantas linhas cabem e paginação ---------- */
/** Linhas que cabem no contêiner (altura disponível − cabeçalho). Fora do notebook, um tamanho fixo. */
function rowsThatFit(wrap, rowHeight, fallback = 20) {
  if (!FIXED_LAYOUT.matches) return fallback;
  const head = wrap.querySelector("thead")?.offsetHeight ?? 0;
  return Math.max(3, Math.floor((wrap.clientHeight - head - 8) / rowHeight));
}
/** Altura real de uma linha já desenhada (inclui borda e espaçamento), para corrigir a estimativa. */
function measuredRow(wrap, fallback) {
  const rows = wrap.querySelectorAll("tbody tr");
  if (rows.length < 2) return fallback;
  return (rows[rows.length - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top) / rows.length;
}
const overflows = (wrap) => wrap.scrollHeight > wrap.clientHeight + 1;
function renderPager(id, page, size, total, onPage) {
  const box = document.getElementById(id);
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) { box.replaceChildren(el("span", null, `${total} ${total === 1 ? "modelo" : "modelos"}`)); return; }
  const prev = el("button", null, "‹ Anteriores"); prev.type = "button"; prev.disabled = page === 0;
  const next = el("button", null, "Próximos ›"); next.type = "button"; next.disabled = page >= pages - 1;
  prev.addEventListener("click", () => onPage(page - 1));
  next.addEventListener("click", () => onPage(page + 1));
  const info = el("span", null, `${page * size + 1}–${Math.min(total, (page + 1) * size)} de ${total}`);
  box.replaceChildren(prev, info, next);
}
const rowHeight = () => parseFloat(css("--row")) || 34;
const heatRow = () => (parseFloat(css("--heat-row")) || 30) + 2; // + 2px de espaço (border-spacing)

/* ---------- visão geral: a frase da semana (snapshot inteiro, preço padrão, métrica principal) ---------- */
function renderHero() {
  const meta = DATA.meta;
  const metric = meta.primary_metric in METRICS ? meta.primary_metric : "aa_intelligence_index";
  const { leader, value } = bestValue(DATA.models, metric, "standard", true);
  document.getElementById("hero-leader").textContent = `${leader.display_name} lidera a semana.`;
  const second = document.getElementById("hero-value");
  second.textContent = "";
  if (value && priceOf(leader, "standard")) {
    const pct = Math.round((scoreOf(value, metric) / scoreOf(leader, metric)) * 100);
    const ratio = priceOf(leader, "standard") / priceOf(value, "standard");
    const cheaper = ratio >= 1.95 ? `custando ${nf(0).format(ratio)} vezes menos` : `custando ${nf(0).format((1 - 1 / ratio) * 100)}% menos`;
    second.textContent = `${value.display_name} entrega ${pct}% da capacidade do líder ${cheaper}, pelo ${METRICS[metric].label}.`;
  }
  const discounts = DATA.models.filter((m) => m.batch_status === "official").map((m) => m.batch_discount_pct).sort((a, b) => a - b);
  const median = discounts.length ? discounts[Math.floor(discounts.length / 2)] : null;
  const facts = [
    ["modelos comparados", nf(0).format(DATA.models.length)],
    ["com preço de API", nf(0).format(DATA.models.filter((m) => m.blended_usd_1m != null).length)],
    ["de desconto típico no batch", fmtPct(median)],
    ["fontes de dados", nf(0).format(meta.sources.length)],
  ];
  document.getElementById("hero-facts").replaceChildren(...facts.map(([k, v]) => {
    const div = el("div"); div.append(el("dt", null, k), el("dd", null, v)); return div;
  }));
  document.getElementById("snapshot-label").textContent = `Dados de ${fmtDate(meta.snapshot_date, { day: "numeric", month: "long", year: "numeric" })}.`;
}

/* ---------- elementos comuns dos gráficos ---------- */
const chartFont = () => (MONITOR.matches ? 13 : 12); // px dos rótulos e eixos; os tooltips seguem o CSS
function baseOption() {
  return {
    animation: !REDUCED_MOTION,
    textStyle: { fontFamily: css("--font"), color: css("--ink-2") },
    tooltip: {
      backgroundColor: css("--surface"), borderColor: css("--axis"), borderWidth: 1, padding: [10, 12],
      textStyle: { color: css("--ink") }, extraCssText: "box-shadow: 0 6px 24px rgba(0,0,0,.14); border-radius: 10px;",
      confine: true,
    },
  };
}
function axisStyle(extra = {}) {
  return {
    axisLine: { lineStyle: { color: css("--axis") } },
    axisTick: { show: false },
    axisLabel: { color: css("--muted"), fontSize: chartFont() },
    splitLine: { lineStyle: { color: css("--hairline"), type: "solid", width: 1 } },
    nameTextStyle: { color: css("--ink-2"), fontSize: chartFont() },
    ...extra,
  };
}
function yMetricAxis() {
  return axisStyle({ type: "value", scale: true, name: METRICS[state.metric].label, nameLocation: "end", nameGap: 12,
    nameTextStyle: { color: css("--ink-2"), fontSize: chartFont(), align: "left" } });
}
function tooltipModel(m) {
  const rows = [
    [METRICS[state.metric].short, fmtScore(scoreOf(m))],
    ["Padrão (blended)", fmtUsd(m.blended_usd_1m)],
    ["Batch (blended)", m.blended_batch_usd_1m == null ? "—" : `${fmtUsd(m.blended_batch_usd_1m)} · ${BATCH_STATUS[m.batch_status]?.label.toLowerCase() ?? ""}`],
    ["Entrada / saída", m.input_usd_1m == null ? "—" : `${fmtUsd(m.input_usd_1m)} / ${fmtUsd(m.output_usd_1m)}`],
  ];
  const app = appOf();
  if (app) {
    // detalhe do índice: a nota bruta de cada benchmark da aplicação que o modelo tem
    const have = app.benchmarks.filter((c) => m[c] != null);
    rows.push(["Cobertura", `${have.length} de ${app.benchmarks.length} benchmarks`]);
    for (const c of have) rows.push([DATA.meta.benchmarks[c].label, fmtBench(c, m[c])]);
  }
  return `<div class="tt"><div class="tt-title">${esc(m.display_name)}</div>` +
    `<div class="tt-sub">${esc(m.organization ?? "Organização desconhecida")}${m.release_date ? " · " + esc(fmtDate(m.release_date)) : ""}</div>` +
    rows.map(([k, v]) => `<div class="tt-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("") + "</div>";
}
function setLegend(id, items) {
  document.getElementById(id).replaceChildren(...items.map(({ kind, color, label }) => {
    const span = el("span");
    const key = el("i", kind === "line" ? "key-line" : kind === "ring" ? "key-ring" : "key-dot");
    if (color) key.style.background = color;
    span.append(key, document.createTextNode(label));
    return span;
  }));
}
function highlightLegendItems() {
  return [...state.highlight].sort((a, b) => a.slot - b.slot).map((h) => ({ kind: "dot", color: slotColor(h.slot), label: h.org }));
}
/** Inicia o gráfico na primeira vez que a tela aparece e ajusta ao tamanho atual do contêiner. */
function chart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "svg" });
  else charts[id].resize();
  return charts[id];
}
/* camada de toque invisível: alvo de 22px em cada ponto, maior que a marca */
function hitLayer(points) {
  return {
    type: "scatter", name: "hit", data: points, symbolSize: 22, z: 10,
    itemStyle: { color: "rgba(0,0,0,0)" }, emphasis: { disabled: true },
    tooltip: { formatter: (p) => tooltipModel(p.data.m) },
  };
}
function modelLabel(target, m, extra) {
  if (!m) { target.textContent = "—"; target.classList.add("dim"); return; }
  const h = highlightOf(m);
  if (h) { const dot = el("i", "hl-dot"); dot.style.background = slotColor(h.slot); target.append(dot); }
  target.append(el("span", "model-name", m.display_name));
  if (extra) target.append(el("span", "model-org", extra));
  target.title = `${m.display_name}${m.organization ? ", " + m.organization : ""}`;
}

/* ---------- tela 1: capacidade × preço ---------- */
function renderFrontier(models) {
  const pts = models.filter((m) => scoreOf(m) != null && priceOf(m) > 0);
  const front = paretoFront(pts);
  const frontSet = new Set(front);
  const missing = models.filter((m) => scoreOf(m) != null && !(priceOf(m) > 0)).length;
  const priceWord = state.mode === "batch" ? "batch" : "padrão";
  document.getElementById("frontier-note").textContent =
    `${pts.length} modelos com ${metricPhrase()} e preço ${priceWord}` + (missing ? `; ${missing} sem esse preço ficam de fora.` : ".");

  const surface = css("--surface");
  const point = (m) => ({ value: [priceOf(m), scoreOf(m)], m });
  const series = [{
    type: "scatter", name: "Outros modelos", silent: true, symbolSize: 7,
    data: pts.filter((m) => !frontSet.has(m) && !highlightOf(m)).map(point), itemStyle: { color: css("--mark"), opacity: 0.6 },
  }];
  for (const h of state.highlight) {
    series.push({
      type: "scatter", name: h.org, silent: true, symbolSize: 10,
      data: pts.filter((m) => m.organization === h.org && !frontSet.has(m)).map(point),
      itemStyle: { color: slotColor(h.slot), borderColor: surface, borderWidth: 2 },
    });
  }
  series.push({
    type: "line", name: "Fronteira", silent: true, step: "end", z: 5,
    // o líder (último ponto) leva o rótulo acima, para não ser escondido pelo vizinho
    data: front.map((m, i) => (i === front.length - 1 ? { ...point(m), label: { position: "top" } } : point(m))),
    lineStyle: { color: css("--frontier"), width: 2 }, symbol: "circle", symbolSize: 10,
    itemStyle: { color: (p) => (highlightOf(p.data.m) ? markColor(p.data.m) : css("--frontier")), borderColor: surface, borderWidth: 2 },
    label: {
      show: true, position: "left", distance: 8, color: css("--ink"), fontSize: chartFont(), fontWeight: 600,
      // no celular só o líder ganha rótulo; os demais estão no tooltip e na tela de orçamento
      formatter: (p) => (!isNarrow() || p.dataIndex === front.length - 1 ? p.data.m.display_name : ""),
    },
    labelLayout: { hideOverlap: true },
  });
  series.push(hitLayer(pts.map(point)));

  setLegend("frontier-legend", [
    { kind: "line", label: "Fronteira de Pareto (melhor modelo para cada preço)" },
    ...highlightLegendItems(),
    { kind: "dot", color: css("--mark"), label: "Demais modelos" },
  ]);
  chart("chart-frontier").setOption({
    ...baseOption(),
    grid: { left: 56, right: 36, top: 36, bottom: 56 },
    xAxis: axisStyle({
      type: "log", logBase: 10, name: `Preço ${priceWord} blended (US$ por 1M tokens, escala log)`, nameLocation: "middle", nameGap: 32,
      axisLabel: { color: css("--muted"), fontSize: chartFont(), formatter: fmtTick, hideOverlap: true },
    }),
    yAxis: yMetricAxis(),
    series,
  }, true);
}

/* ---------- tela 2: melhor modelo por aplicação ---------- */
function selectMetric(metric, view) {
  state.metric = metric;
  document.getElementById("metric-select").value = metric;
  state.sort = { key: "score", dir: -1 };
  state.heatPage = 0; state.tablePage = 0;
  if (view && view !== state.view) location.hash = view;
  else renderView();
}
function renderApps(models) {
  const table = document.getElementById("apps-table");
  table.classList.remove("compact");
  document.querySelector("#apps-table tbody").replaceChildren(...appKeys().map((k) => {
    const app = METRICS[k].app;
    const { leader, value } = bestValue(models, k);
    const tr = el("tr");
    if (k === state.metric) tr.className = "active";
    const th = el("th"); th.scope = "row";
    const b = el("button", "app-pick"); b.type = "button";
    b.setAttribute("aria-pressed", String(k === state.metric));
    b.append(el("span", "model-name", app.label), el("span", "line2", app.description));
    b.title = `Ver ranking e orçamento de ${app.label.toLowerCase()}`;
    b.addEventListener("click", () => selectMetric(k, "ranking"));
    th.append(b);
    const tdLeader = el("td");
    modelLabel(tdLeader, leader, leader ? `${fmtScore(scoreOf(leader, k), k)} pts, ${fmtUsd(priceOf(leader))}` : "");
    const tdValue = el("td");
    modelLabel(tdValue, value, value ? `${fmtScore(scoreOf(value, k), k)} pts, ${fmtUsd(priceOf(value))}` : "");
    const tdN = el("td", "num", nf(0).format(models.filter((m) => m[k] != null).length));
    tr.append(th, tdLeader, tdValue, tdN);
    return tr;
  }));
  // sem espaço para a descrição de cada aplicação: some a segunda linha (fica no title do botão)
  const wrap = table.parentElement;
  if (FIXED_LAYOUT.matches && table.offsetHeight > wrap.clientHeight) table.classList.add("compact");
}

/* ---------- tela 3: aplicabilidade (tabela com cor sequencial, valores sempre visíveis) ---------- */
const HEAT_MIN = 50;
function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
}
function heatColor(v) {
  const t = Math.min(1, Math.max(0, (v - HEAT_MIN) / (100 - HEAT_MIN)));
  const [r, g, b] = mix(css("--seq-lo").slice(1), css("--seq-hi").slice(1), t);
  // texto branco ou escuro, o que tiver mais contraste WCAG com o fundo
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const useDark = (L + 0.05) / (0.0105 + 0.05) > 1.05 / (L + 0.05);
  return { bg: `rgb(${r}, ${g}, ${b})`, ink: useDark ? "#0f1a24" : "#ffffff" };
}
function renderHeat(models) {
  const keys = appKeys();
  const meanApps = (m) => { const v = keys.map((k) => m[k]).filter((x) => x != null); return v.reduce((a, b) => a + b, 0) / v.length; };
  const rank = (m) => scoreOf(m) ?? -Infinity;
  const rows = models.filter((m) => keys.some((k) => m[k] != null)).sort((a, b) => rank(b) - rank(a) || meanApps(b) - meanApps(a));
  document.getElementById("heat-note").textContent =
    `Ordenado pelo ${metricPhrase()}. Clique numa aplicação para ordenar por ela; o traço indica benchmarks insuficientes.`;

  const head = el("tr");
  const corner = el("th", null, "Modelo"); corner.scope = "col";
  head.append(corner);
  for (const k of keys) {
    const th = el("th"); th.scope = "col";
    if (k === state.metric) th.setAttribute("aria-sort", "descending");
    const b = el("button", null, METRICS[k].short); b.type = "button"; b.title = `Ordenar por ${METRICS[k].short}`;
    b.addEventListener("click", () => selectMetric(k));
    th.append(b); head.append(th);
  }
  document.querySelector("#heat-table thead").replaceChildren(head);

  const bar = el("i", "heat-bar");
  bar.style.background = `linear-gradient(90deg, ${css("--seq-lo")}, ${css("--seq-hi")})`;
  document.getElementById("heat-legend").replaceChildren(el("span", null, `${HEAT_MIN} ou menos`), bar, el("span", null, "100 (líder)"));
  // tudo que ocupa altura vem antes da medição; a paginação definitiva tem a mesma altura da provisória
  renderPager("heat-pager", 0, 1, rows.length, () => {});
  const wrap = document.getElementById("heat-wrap");
  let size = rowsThatFit(wrap, heatRow(), 25);
  drawHeatRows(rows, keys, size);
  if (FIXED_LAYOUT.matches && overflows(wrap)) { size = rowsThatFit(wrap, measuredRow(wrap, heatRow()), 25); drawHeatRows(rows, keys, size); }
  renderPager("heat-pager", state.heatPage, size, rows.length, (p) => { state.heatPage = p; renderView(); });
}
function drawHeatRows(rows, keys, size) {
  state.heatPage = Math.min(state.heatPage, Math.max(0, Math.ceil(rows.length / size) - 1));
  const page = rows.slice(state.heatPage * size, (state.heatPage + 1) * size);
  document.querySelector("#heat-table tbody").replaceChildren(...page.map((m) => {
    const tr = el("tr");
    const th = el("th"); th.scope = "row";
    modelLabel(th, m, m.organization ?? "");
    tr.append(th);
    for (const k of keys) {
      const app = METRICS[k].app;
      const n = m[`${k}_n`] ?? 0;
      const td = el("td");
      if (m[k] == null) {
        td.textContent = "–"; td.className = "empty";
        td.title = `${app.label}: ${n} de ${app.benchmarks.length} benchmarks, insuficiente para o índice`;
      } else {
        const c = heatColor(m[k]);
        td.style.background = c.bg; td.style.color = c.ink;
        td.textContent = fmtScore(m[k], k);
        td.title = `${app.label}: ${fmtScore(m[k], k)} pontos com ${n} de ${app.benchmarks.length} benchmarks`;
      }
      tr.append(td);
    }
    return tr;
  }));
}

/* ---------- tela 4: ranking e orçamento ---------- */
function renderRanking(models) {
  const top = models.filter((m) => scoreOf(m) != null).sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 15).reverse();
  const app = appOf();
  document.getElementById("ranking-title").textContent = app ? `Os 15 melhores em ${app.label.toLowerCase()}` : "Os 15 mais capazes";
  document.getElementById("ranking-note").textContent = app
    ? `Índice 0 a 100: média de até ${app.benchmarks.length} benchmarks, cada um relativo ao líder.`
    : `Pelo ${METRICS[state.metric].label}, com a melhor variante de esforço.`;
  chart("chart-ranking").setOption({
    ...baseOption(),
    grid: { left: 8, right: 52, top: 8, bottom: 8, containLabel: true },
    // barras sempre a partir do zero: o comprimento é o valor
    xAxis: axisStyle({ type: "value", min: 0, axisLabel: { show: false }, splitLine: { show: false } }),
    yAxis: { type: "category", data: top.map((m) => m.display_name), axisTick: { show: false },
      axisLine: { lineStyle: { color: css("--axis") } }, axisLabel: { color: css("--ink"), fontSize: chartFont() } },
    tooltip: { ...baseOption().tooltip, trigger: "item", formatter: (p) => tooltipModel(top[p.dataIndex]) },
    series: [{
      type: "bar", barMaxWidth: MONITOR.matches ? 26 : 18, barCategoryGap: "35%",
      data: top.map((m) => ({ value: scoreOf(m), itemStyle: { color: highlightOf(m) ? markColor(m) : css("--ink-2"), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: css("--ink-2"), fontSize: chartFont(), formatter: (p) => fmtScore(p.value) },
    }],
  }, true);
}
function renderBudget(models) {
  const front = paretoFront(models);
  const table = document.getElementById("budget-table");
  table.style.removeProperty("--row"); // mede com a altura padrão; o esticamento do desenho anterior não conta
  const body = document.querySelector("#budget-table tbody");
  const note = document.getElementById("budget-note");
  note.textContent = "Os modelos da fronteira, do mais barato ao mais caro: nenhum outro é melhor sem custar mais.";
  if (!front.length) {
    const tr = el("tr"); const td = el("td", null, "Nenhum modelo com capacidade e preço nos filtros atuais. Amplie os filtros.");
    td.colSpan = 4; tr.append(td); body.replaceChildren(tr); return;
  }
  const leaderScore = Math.max(...front.map((m) => scoreOf(m)));
  const wrap = document.getElementById("budget-wrap");
  const draw = (size) => {
    // sem espaço para todos: ficam os mais capazes (o fim da fronteira)
    const shown = front.slice(Math.max(0, front.length - size));
    body.replaceChildren(...shown.map((m) => {
      const tr = el("tr");
      const name = el("td"); modelLabel(name, m, m.organization ?? "");
      tr.append(el("td", null, fmtUsd(priceOf(m))), name, el("td", "num", fmtScore(scoreOf(m))),
        el("td", "num", fmtPct((scoreOf(m) / leaderScore) * 100)));
      return tr;
    }));
    return shown.length;
  };
  const base = note.textContent;
  const setNote = (n) => { note.textContent = n < front.length ? `${base} As ${front.length - n} opções mais baratas estão em Todos os modelos.` : base; };
  // a nota muda de tamanho conforme o que cabe: ajusta antes de medir e confirma depois
  let size = rowsThatFit(wrap, rowHeight(), front.length);
  setNote(Math.min(size, front.length));
  size = rowsThatFit(wrap, rowHeight(), front.length);
  let shown = draw(size);
  if (FIXED_LAYOUT.matches && overflows(wrap)) shown = draw(rowsThatFit(wrap, measuredRow(wrap, rowHeight()), front.length));
  setNote(shown);
  // monitor: sobrando altura, as linhas crescem até 1,6× para ocupar o painel
  if (MONITOR.matches) {
    const fit = (wrap.clientHeight - table.tHead.offsetHeight - 8) / shown;
    if (fit > rowHeight()) table.style.setProperty("--row", `${Math.floor(Math.min(fit, rowHeight() * 1.6))}px`);
  }
}

/* ---------- tela 5: padrão × batch ---------- */
function renderBatch(models) {
  const rows = models
    .filter((m) => scoreOf(m) != null && m.blended_usd_1m > 0 && m.blended_batch_usd_1m > 0)
    .sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 15).reverse();
  const ink = css("--frontier"), surface = css("--surface");
  const dot = MONITOR.matches ? 12 : 10;
  setLegend("batch-legend", [
    { kind: "dot", color: css("--mark"), label: "Preço padrão" },
    { kind: "dot", color: ink, label: "Batch oficial" },
    { kind: "ring", label: "Batch estimado pelo desconto documentado" },
  ]);
  chart("chart-batch").setOption({
    ...baseOption(),
    grid: { left: 8, right: 32, top: 8, bottom: 44, containLabel: true },
    tooltip: {
      ...baseOption().tooltip, trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: css("--wash") } },
      formatter: (ps) => {
        const m = rows[ps[0].dataIndex];
        const save = m.blended_usd_1m - m.blended_batch_usd_1m;
        return `<div class="tt"><div class="tt-title">${esc(m.display_name)}</div><div class="tt-sub">${esc(m.organization ?? "")}</div>` +
          `<div class="tt-row"><span>Padrão</span><b>${esc(fmtUsd(m.blended_usd_1m))}</b></div>` +
          `<div class="tt-row"><span>Batch (${esc(BATCH_STATUS[m.batch_status].label.toLowerCase())})</span><b>${esc(fmtUsd(m.blended_batch_usd_1m))}</b></div>` +
          `<div class="tt-row"><span>Economia</span><b>${esc(fmtUsd(save))} (${esc(fmtPct(m.batch_discount_pct))})</b></div></div>`;
      },
    },
    xAxis: axisStyle({ type: "log", logBase: 10, name: "Preço blended (US$ por 1M tokens, escala log)", nameLocation: "middle", nameGap: 28,
      min: (v) => v.min / 1.5, max: (v) => v.max * 1.5, // folga para o ponto não encostar na borda
      axisLabel: { color: css("--muted"), fontSize: chartFont(), formatter: fmtTick, showMinLabel: false, showMaxLabel: false } }),
    yAxis: { type: "category", data: rows.map((m) => m.display_name), axisTick: { show: false },
      axisLine: { show: false }, axisLabel: { color: css("--ink"), fontSize: chartFont() } },
    series: [
      { // conector entre os dois preços
        type: "custom", silent: true, data: rows.map((m, i) => [m.blended_batch_usd_1m, m.blended_usd_1m, i]),
        renderItem: (params, api) => {
          const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), api.value(2)]);
          return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: css("--axis"), lineWidth: 2 } };
        },
        encode: { x: [0, 1], y: 2 }, z: 1,
      },
      { type: "scatter", name: "Padrão", symbolSize: dot, z: 2,
        data: rows.map((m, i) => [m.blended_usd_1m, i]), itemStyle: { color: css("--mark"), borderColor: surface, borderWidth: 2 } },
      { type: "scatter", name: "Batch", symbolSize: dot, z: 3,
        data: rows.map((m, i) => ({ value: [m.blended_batch_usd_1m, i],
          itemStyle: m.batch_status === "official" ? { color: ink, borderColor: surface, borderWidth: 2 } : { color: surface, borderColor: ink, borderWidth: 2 } })) },
    ],
  }, true);
}

/* ---------- tela 6: evolução ---------- */
function renderTimeline(models) {
  const pts = models.filter((m) => scoreOf(m) != null && m.release_date).sort((a, b) => a.release_date.localeCompare(b.release_date));
  const record = [];
  let best = -Infinity;
  for (const m of pts) if (scoreOf(m) > best) { best = scoreOf(m); record.push(m); }
  const surface = css("--surface");
  const point = (m) => ({ value: [m.release_date, scoreOf(m)], m });
  const series = [{
    type: "scatter", name: "Modelos", silent: true, symbolSize: 7,
    data: pts.filter((m) => !highlightOf(m)).map(point), itemStyle: { color: css("--mark"), opacity: 0.6 },
  }];
  for (const h of state.highlight) {
    series.push({ type: "scatter", name: h.org, silent: true, symbolSize: 10,
      data: pts.filter((m) => m.organization === h.org).map(point),
      itemStyle: { color: slotColor(h.slot), borderColor: surface, borderWidth: 2 } });
  }
  if (record.length) {
    const last = record[record.length - 1];
    const today = new Date().toISOString().slice(0, 10);
    series.push({
      type: "line", name: "Recorde", silent: true, step: "end", symbol: "none", z: 5,
      data: [...record.map(point), { value: [today > last.release_date ? today : last.release_date, scoreOf(last)], m: last }],
      lineStyle: { color: css("--frontier"), width: 2 },
      endLabel: { show: !isNarrow(), color: css("--ink"), fontSize: chartFont(), fontWeight: 600, formatter: () => last.display_name, distance: 6 },
    });
  }
  series.push(hitLayer(pts.map(point)));
  setLegend("timeline-legend", [
    { kind: "line", label: "Melhor resultado até a data" },
    ...highlightLegendItems(),
    { kind: "dot", color: css("--mark"), label: "Demais modelos" },
  ]);
  chart("chart-timeline").setOption({
    ...baseOption(),
    grid: { left: 56, right: isNarrow() ? 20 : 140, top: 32, bottom: 32 },
    xAxis: axisStyle({ type: "time", splitLine: { show: false },
      axisLabel: { color: css("--muted"), fontSize: chartFont(), formatter: (v) => new Date(v).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }) } }),
    yAxis: yMetricAxis(),
    series,
  }, true);
}

/* ---------- tela 7: todos os modelos ---------- */
function columns() {
  const name = { key: "name", label: "Modelo", get: (m) => m.display_name, render: (td, m) => modelLabel(td, m, m.organization ?? "") };
  const score = { key: "score", label: METRICS[state.metric].short, num: true, get: (m) => scoreOf(m), fmt: (v) => fmtScore(v) };
  if (state.cols === "apps") {
    return [name, score, ...appKeys().filter((k) => k !== state.metric)
      .map((k) => ({ key: k, label: METRICS[k].short, num: true, get: (m) => m[k], fmt: (v) => fmtScore(v, k) }))];
  }
  if (state.cols === "bench") {
    return [name, score, ...(appOf()?.benchmarks ?? CORE_BENCHMARKS)
      .map((key) => ({ key, label: DATA.meta.benchmarks[key].label, num: true, get: (m) => m[key], fmt: (v) => fmtBench(key, v) }))];
  }
  return [
    name,
    { key: "release", label: "Lançamento", num: true, get: (m) => m.release_date,
      fmt: (v) => fmtDate(v, { day: "2-digit", month: "2-digit", year: "numeric" }) },
    score,
    ...Object.keys(METRICS).filter((k) => k !== state.metric && !METRICS[k].app)
      .map((k) => ({ key: k, label: METRICS[k].short, num: true, get: (m) => m[k], fmt: (v) => fmtScore(v, k), dim: true })),
    { key: "in", label: "Entrada", num: true, get: (m) => m.input_usd_1m, fmt: fmtPrice },
    { key: "out", label: "Saída", num: true, get: (m) => m.output_usd_1m, fmt: fmtPrice },
    { key: "bin", label: "Batch entrada", num: true, get: (m) => m.batch_input_usd_1m, fmt: fmtPrice },
    { key: "bout", label: "Batch saída", num: true, get: (m) => m.batch_output_usd_1m, fmt: fmtPrice },
    { key: "disc", label: "Desconto", num: true, get: (m) => m.batch_discount_pct, fmt: fmtPct },
    { key: "status", label: "Batch", get: (m) => m.batch_status, render: renderStatusCell },
    { key: "value", label: "Capacidade por US$", num: true,
      get: (m) => (scoreOf(m) != null && priceOf(m) > 0 ? scoreOf(m) / priceOf(m) : null), fmt: (v) => (v == null ? "—" : nf(1).format(v)) },
  ];
}
function renderStatusCell(td, m) {
  const s = BATCH_STATUS[m.batch_status];
  if (!s) { td.textContent = "—"; td.className = "dim"; return; }
  const wrap = el("span", "status");
  const icon = el("span", "status-icon", s.icon); icon.setAttribute("aria-hidden", "true");
  wrap.append(icon, document.createTextNode(s.label));
  td.append(wrap);
}
function renderTable(models) {
  const cols = columns();
  const col = cols.find((c) => c.key === state.sort.key) ?? cols.find((c) => c.key === "score");
  const rows = [...models].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb) * state.sort.dir;
  });

  const tr = el("tr");
  for (const c of cols) {
    const th = el("th", `col-${c.key}${c.num ? " num" : ""}`); th.scope = "col";
    if (c.key === col.key) th.setAttribute("aria-sort", state.sort.dir > 0 ? "ascending" : "descending");
    const b = el("button", null, c.label + (c.key === col.key ? (state.sort.dir > 0 ? " ↑" : " ↓") : "")); b.type = "button";
    b.addEventListener("click", () => {
      state.sort = { key: c.key, dir: c.key === col.key ? -state.sort.dir : (c.num ? -1 : 1) };
      state.tablePage = 0;
      renderView();
    });
    th.append(b); tr.append(th);
  }
  document.querySelector("#models-table thead").replaceChildren(tr);

  const what = state.cols === "apps" ? "índices por aplicação" : state.cols === "bench"
    ? (appOf() ? `benchmarks de ${appOf().label.toLowerCase()}` : "benchmarks principais") : "preços em US$ por 1 milhão de tokens";
  document.getElementById("table-note").textContent = `Ordenado pela coluna marcada com seta; clique num cabeçalho para mudar. Mostrando ${what}.`;
  // a paginação definitiva tem a mesma altura da provisória: medir só depois de tudo que ocupa espaço
  renderPager("table-pager", 0, 1, rows.length, () => {});
  const wrap = document.getElementById("models-wrap");
  const draw = (size) => {
    state.tablePage = Math.min(state.tablePage, Math.max(0, Math.ceil(rows.length / size) - 1));
    const visible = rows.slice(state.tablePage * size, (state.tablePage + 1) * size);
    document.querySelector("#models-table tbody").replaceChildren(...visible.map((m) => {
      const row = el("tr");
      for (const c of cols) {
        const td = el("td");
        if (c.render) c.render(td, m);
        else { td.textContent = c.fmt(c.get(m)); td.className = [c.num ? "num" : "", c.dim ? "dim" : ""].join(" ").trim(); }
        row.append(td);
      }
      return row;
    }));
  };
  let size = rowsThatFit(wrap, rowHeight(), 25);
  draw(size);
  if (FIXED_LAYOUT.matches && overflows(wrap)) { size = rowsThatFit(wrap, measuredRow(wrap, rowHeight()), 25); draw(size); }
renderPager("table-pager", state.tablePage, size, rows.length, (p) => { state.tablePage = p; renderView(); });
}

/* ---------- tela 8: como cada aplicação é medida ---------- */
const SOURCE_NAME = { epoch: "Epoch AI", lmarena: "LMArena", artificial_analysis: "Artificial Analysis" };
function renderMethod() {
  const apps = DATA.meta.applications ?? [];
  if (!state.methodApp) state.methodApp = appOf()?.id ?? apps[0]?.id;
  document.getElementById("app-list").replaceChildren(...apps.map((app) => {
    const li = el("li");
    const b = el("button"); b.type = "button"; b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(app.id === state.methodApp));
    b.append(el("span", null, app.label), el("span", "count", `${app.benchmarks.length}`));
    b.title = `${app.benchmarks.length} benchmarks`;
    b.addEventListener("click", () => { state.methodApp = app.id; renderMethod(); });
    li.append(b);
    return li;
  }));
  const app = apps.find((a) => a.id === state.methodApp);
  const detail = document.getElementById("app-detail");
  if (!app) { detail.replaceChildren(); return; }
  const ul = el("ul", "bench-rows");
  for (const col of app.benchmarks) {
    const b = DATA.meta.benchmarks[col];
    const kind = b.source === "lmarena" ? "preferência de pessoas" : "teste";
    const li = el("li");
    li.title = `${b.label}: ${b.description}`;
    const head = el("span", "head");
    head.append(el("strong", null, b.label), el("span", "meta", `${SOURCE_NAME[b.source] ?? b.source}, ${kind}, ${b.models} modelos`));
    li.append(head, el("span", "what", b.description));
    ul.append(li);
  }
  const rule = app.min_objective === 0
    ? "Índice com pelo menos 2 destes benchmarks."
    : "Índice com pelo menos 2 destes benchmarks, um deles teste objetivo.";
  detail.replaceChildren(el("h3", null, app.label), el("p", null, `${app.description} ${app.models} modelos com índice. ${rule}`), ul);
}

/* ---------- tela 9: fontes ---------- */
function renderSources() {
  document.getElementById("sources-list").replaceChildren(...DATA.meta.sources.map((s) => {
    const li = el("li");
    const a = el("a", null, s.name); a.href = s.url; a.rel = "noopener";
    li.append(a, el("span", "what", `${s.provides}. Licença: ${s.license}.`));
    return li;
  }));
}

/* ---------- filtros e destaques ---------- */
function renderChips() {
  const box = document.getElementById("highlight-chips");
  box.replaceChildren(...[...state.highlight].sort((a, b) => a.slot - b.slot).map((h) => {
    const b = el("button", "chip"); b.type = "button";
    b.setAttribute("aria-label", `Remover destaque de ${h.org}`);
    const sw = el("i", "swatch"); sw.style.background = slotColor(h.slot);
    const x = el("span", "x", "×"); x.setAttribute("aria-hidden", "true");
    b.append(sw, document.createTextNode(h.org), x);
    b.addEventListener("click", () => { state.highlight = state.highlight.filter((o) => o !== h); renderView(); });
    return b;
  }));
  const select = document.getElementById("highlight-select");
  select.disabled = state.highlight.length >= MAX_HIGHLIGHT;
  select.options[0].textContent = select.disabled ? "Limite de 3 atingido" : "Escolha até 3";
}
function fillOrgSelect() {
  const counts = new Map();
  for (const m of DATA.models) if (m.organization) counts.set(m.organization, (counts.get(m.organization) ?? 0) + 1);
  const select = document.getElementById("highlight-select");
  for (const [org, n] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const o = el("option", null, `${org} (${n})`); o.value = org; select.append(o);
  }
}
function bindFilters() {
  const form = document.getElementById("filters");
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "highlight") {
      if (t.value && !state.highlight.some((h) => h.org === t.value) && state.highlight.length < MAX_HIGHLIGHT) {
        const used = new Set(state.highlight.map((h) => h.slot));
        state.highlight.push({ org: t.value, slot: [1, 2, 3].find((s) => !used.has(s)) });
      }
      t.value = "";
    } else if (t.name === "metric") {
      selectMetric(t.value);
      return;
    } else if (t.name in state) {
      state[t.name] = t.value;
    }
    state.heatPage = 0; state.tablePage = 0;
    renderView();
  });
  let timer;
  form.query.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = e.target.value; state.heatPage = 0; state.tablePage = 0; renderView(); }, 150);
  });
  document.getElementById("col-set").addEventListener("change", (e) => { state.cols = e.target.value; state.tablePage = 0; renderView(); });
}

/* ---------- navegação entre telas ---------- */
function go(view) {
  state.view = VIEWS.includes(view) ? view : "geral";
  for (const sec of document.querySelectorAll(".view")) sec.hidden = sec.dataset.view !== state.view;
  for (const a of document.querySelectorAll("#nav a")) {
    if (a.dataset.view === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  renderView();
}
function bindNavigation() {
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length) location.hash = VIEWS[n - 1];
  });
}

/* ---------- tema ---------- */
const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "Tema: automático", light: "Tema: claro", dark: "Tema: escuro" };
function bindTheme() {
  const btn = document.getElementById("theme-toggle");
  let current = document.documentElement.dataset.theme || "auto";
  btn.textContent = THEME_LABEL[current];
  btn.addEventListener("click", () => {
    current = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    if (current === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = current;
    try { current === "auto" ? localStorage.removeItem("theme") : localStorage.setItem("theme", current); } catch (e) { /* sem storage */ }
    btn.textContent = THEME_LABEL[current];
    renderView();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderView);
}

/** Desenha só a tela visível; as outras são desenhadas quando o usuário chega nelas. */
function renderView() {
  const models = filtered();
  renderChips();
  switch (state.view) {
    case "geral": renderFrontier(models); break;
    case "aplicacoes": renderApps(models); break;
    case "aplicabilidade": renderHeat(models); break;
    case "ranking": renderRanking(models); renderBudget(models); break;
    case "batch": renderBatch(models); break;
    case "evolucao": renderTimeline(models); break;
    case "modelos": renderTable(models); break;
    case "metodo": renderMethod(); break;
    default: break;
  }
}

async function main() {
  try {
    const [score, meta] = await Promise.all(["data/scorecard.json", "data/meta.json"].map(async (u) => {
      const r = await fetch(u, { cache: "no-cache" });
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r.json();
    }));
    DATA = { models: score.models, meta };
  } catch (err) {
    const box = document.getElementById("load-error");
    box.textContent = `Não foi possível carregar os dados (${err.message}). Recarregue a página; se persistir, o pipeline semanal pode ter falhado.`;
    box.hidden = false;
    return;
  }
  // a fonte da web muda a altura dos textos; o ECharts mede o contêiner só no primeiro desenho
  await document.fonts.ready;
  buildMetrics();
  state.metric = DATA.meta.primary_metric in METRICS ? DATA.meta.primary_metric : "eci";
  document.getElementById("metric-select").value = state.metric;
  fillOrgSelect();
  renderHero();
  renderSources();
  bindFilters();
  bindTheme();
  bindNavigation();
  go(location.hash.slice(1));
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderView, 150); // linhas por página e rótulos dependem do tamanho
  });
}

main();

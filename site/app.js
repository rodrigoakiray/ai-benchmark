/* Fronteira dos LLMs — lê data/scorecard.json + data/meta.json (gerados por tools/export_site.py). */
"use strict";

const METRICS = {
  aa_intelligence_index: { label: "AA Intelligence Index", short: "AA Index", digits: 1 },
  eci: { label: "Epoch Capabilities Index", short: "ECI", digits: 1 },
  arena_elo: { label: "Arena Elo (texto)", short: "Arena Elo", digits: 0 },
};
const BATCH_STATUS = {
  official: { icon: "✓", label: "Oficial" },
  estimated: { icon: "≈", label: "Estimado" },
  unavailable: { icon: "–", label: "Indisponível" },
};
const MAX_HIGHLIGHT = 3;
const TABLE_PAGE = 60;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  mode: "standard", metric: "aa_intelligence_index", weights: "all", since: "all", query: "",
  highlight: [], // [{ org, slot }] — a cor segue o laboratório enquanto ele estiver destacado
  sort: { key: "score", dir: -1 }, showBench: false, showAll: false,
};
let DATA = { models: [], meta: null };
const charts = {};

/* ---------- formatação ---------- */
const nf = (d) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtScore = (v, metric = state.metric) => (v == null ? "—" : nf(METRICS[metric].digits).format(v));
function fmtUsd(v) {
  if (v == null) return "—";
  const d = v < 0.1 ? 3 : 2;
  return "US$ " + nf(d).format(v);
}
const fmtPct = (v) => (v == null ? "—" : nf(0).format(v) + "%");
/* preço sem o prefixo, para colunas cujo cabeçalho já diz a unidade */
const fmtPrice = (v) => (v == null ? "—" : nf(v < 0.1 ? 3 : 2).format(v));
const fmtTick = (v) => (isNarrow() ? "" : "US$ ") + new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v);
/* em telas estreitas os gráficos mostram menos rótulos */
const isNarrow = () => window.innerWidth < 640;
function fmtDate(iso, opts = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", opts);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/* ---------- dados derivados ---------- */
const priceOf = (m, mode = state.mode) => (mode === "batch" ? m.blended_batch_usd_1m : m.blended_usd_1m);
const scoreOf = (m, metric = state.metric) => m[metric];

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

function slotColor(slot) { return css(`--hl-${slot}`); }
function highlightOf(m) { return state.highlight.find((h) => h.org === m.organization); }
function markColor(m) { const h = highlightOf(m); return h ? slotColor(h.slot) : css("--mark"); }

/* ---------- hero (snapshot inteiro, preço padrão, métrica principal) ---------- */
function renderHero() {
  const meta = DATA.meta;
  const metric = meta.primary_metric in METRICS ? meta.primary_metric : "aa_intelligence_index";
  const ranked = DATA.models.filter((m) => scoreOf(m, metric) != null).sort((a, b) => scoreOf(b, metric) - scoreOf(a, metric));
  const leader = ranked[0];
  const front = paretoFront(DATA.models, "standard", metric);
  const floor = scoreOf(leader, metric) * 0.8;
  const value = front
    .filter((m) => m !== leader && scoreOf(m, metric) >= floor)
    .sort((a, b) => scoreOf(b, metric) / priceOf(b, "standard") - scoreOf(a, metric) / priceOf(a, "standard"))[0];

  document.getElementById("hero-leader").textContent = `${leader.display_name} lidera a semana.`;
  const second = document.getElementById("hero-value");
  if (value && priceOf(leader, "standard")) {
    const pct = Math.round((scoreOf(value, metric) / scoreOf(leader, metric)) * 100);
    const ratio = priceOf(leader, "standard") / priceOf(value, "standard");
    const cheaper = ratio >= 1.95 ? `custando ${nf(0).format(ratio)} vezes menos` : `custando ${nf(0).format((1 - 1 / ratio) * 100)}% menos`;
    second.textContent = `${value.display_name} entrega ${pct}% da capacidade do líder ${cheaper}.`;
  } else {
    second.textContent = "";
  }

  const withPrice = DATA.models.filter((m) => m.blended_usd_1m != null).length;
  document.getElementById("hero-sub").textContent =
    `Dados de ${fmtDate(meta.snapshot_date, { day: "numeric", month: "long", year: "numeric" })}: ` +
    `${DATA.models.length} modelos de ${meta.sources.length} fontes, comparados pelo ${METRICS[metric].label} ` +
    `e pelo preço por 1 milhão de tokens.`;

  const discounts = DATA.models.filter((m) => m.batch_status === "official").map((m) => m.batch_discount_pct).sort((a, b) => a - b);
  const median = discounts.length ? discounts[Math.floor(discounts.length / 2)] : null;
  const facts = [
    ["Modelos comparados", nf(0).format(DATA.models.length)],
    ["Com preço de API", nf(0).format(withPrice)],
    ["Desconto típico do batch", fmtPct(median)],
    ["Na fronteira de preço", nf(0).format(front.length)],
  ];
  const dl = document.getElementById("hero-facts");
  dl.replaceChildren(...facts.map(([k, v]) => {
    const div = document.createElement("div");
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    div.append(dt, dd);
    return div;
  }));
  document.getElementById("snapshot-label").textContent = `Dados de ${fmtDate(meta.snapshot_date)}`;
}

/* ---------- elementos comuns dos gráficos ---------- */
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
    axisLabel: { color: css("--muted"), fontSize: 12 },
    splitLine: { lineStyle: { color: css("--hairline"), type: "solid", width: 1 } },
    nameTextStyle: { color: css("--ink-2"), fontSize: 12 },
    ...extra,
  };
}
function tooltipModel(m) {
  const rows = [
    [METRICS[state.metric].short, fmtScore(scoreOf(m))],
    ["Padrão (blended)", fmtUsd(m.blended_usd_1m)],
    ["Batch (blended)", m.blended_batch_usd_1m == null ? "—" : `${fmtUsd(m.blended_batch_usd_1m)} · ${BATCH_STATUS[m.batch_status]?.label.toLowerCase() ?? ""}`],
    ["Entrada / saída", m.input_usd_1m == null ? "—" : `${fmtUsd(m.input_usd_1m)} / ${fmtUsd(m.output_usd_1m)}`],
  ];
  return `<div class="tt"><div class="tt-title">${esc(m.display_name)}</div>` +
    `<div class="tt-sub">${esc(m.organization ?? "Organização desconhecida")}${m.release_date ? " · " + esc(fmtDate(m.release_date)) : ""}</div>` +
    rows.map(([k, v]) => `<div class="tt-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("") + "</div>";
}
function setLegend(id, items) {
  const el = document.getElementById(id);
  el.replaceChildren(...items.map(({ kind, color, label }) => {
    const span = document.createElement("span");
    const key = document.createElement("i");
    key.className = kind === "line" ? "key-line" : kind === "ring" ? "key-ring" : "key-dot";
    if (kind === "dot") key.style.background = color;
    if (kind === "line" && color) key.style.background = color;
    span.append(key, document.createTextNode(label));
    return span;
  }));
}
function highlightLegendItems() {
  return [...state.highlight].sort((a, b) => a.slot - b.slot).map((h) => ({ kind: "dot", color: slotColor(h.slot), label: h.org }));
}
function chart(id) {
  if (!charts[id]) charts[id] = echarts.init(document.getElementById(id), null, { renderer: "svg" });
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

/* ---------- 1. capacidade × preço ---------- */
function renderFrontier(models) {
  const pts = models.filter((m) => scoreOf(m) != null && priceOf(m) > 0);
  const front = paretoFront(pts);
  const frontSet = new Set(front);
  const missing = models.filter((m) => scoreOf(m) != null && !(priceOf(m) > 0)).length;
  const priceWord = state.mode === "batch" ? "batch" : "padrão";
  document.getElementById("frontier-note").textContent =
    `${pts.length} modelos com ${METRICS[state.metric].short} e preço ${priceWord}` +
    (missing ? `; ${missing} sem esse preço ficam de fora.` : ".");

  const surface = css("--surface");
  const point = (m) => ({ value: [priceOf(m), scoreOf(m)], m });
  const others = pts.filter((m) => !frontSet.has(m) && !highlightOf(m));
  const series = [{
    type: "scatter", name: "Outros modelos", silent: true, data: others.map(point), symbolSize: 7,
    itemStyle: { color: css("--mark"), opacity: 0.6 },
  }];
  for (const h of state.highlight) {
    series.push({
      type: "scatter", name: h.org, silent: true, symbolSize: 10,
      data: pts.filter((m) => m.organization === h.org && !frontSet.has(m)).map(point),
      itemStyle: { color: slotColor(h.slot), borderColor: surface, borderWidth: 2 },
    });
  }
  series.push({
    type: "line", name: "Fronteira", silent: true, step: "end", data: front.map(point), z: 5,
    lineStyle: { color: css("--frontier"), width: 2 }, symbol: "circle", symbolSize: 10,
    itemStyle: { color: (p) => markColor(p.data.m) === css("--mark") ? css("--frontier") : markColor(p.data.m), borderColor: surface, borderWidth: 2 },
    label: {
      show: true, position: "left", distance: 8, color: css("--ink"), fontSize: 12, fontWeight: 600,
      // no celular só o líder ganha rótulo; os demais ficam na tabela do orçamento e no tooltip
      formatter: (p) => (!isNarrow() || p.dataIndex === front.length - 1 ? p.data.m.display_name : ""),
    },
    labelLayout: { hideOverlap: true },
  });
  series.push(hitLayer(pts.map(point)));

  chart("chart-frontier").setOption({
    ...baseOption(),
    grid: { left: 56, right: 36, top: 44, bottom: 64 },
    xAxis: axisStyle({
      type: "log", logBase: 10, name: `Preço ${priceWord} blended (US$ por 1M tokens, escala log)`, nameLocation: "middle", nameGap: 36,
      axisLabel: { color: css("--muted"), fontSize: 12, formatter: fmtTick, hideOverlap: true },
    }),
    yAxis: axisStyle({ type: "value", scale: true, name: METRICS[state.metric].label, nameLocation: "end", nameGap: 14 }),
    series,
  }, true);

  setLegend("frontier-legend", [
    { kind: "line", label: "Fronteira de Pareto" },
    ...highlightLegendItems(),
    { kind: "dot", color: css("--mark"), label: "Demais modelos" },
  ]);
  return front;
}

/* ---------- 2. ranking de capacidade ---------- */
function renderRanking(models) {
  const top = models.filter((m) => scoreOf(m) != null).sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 15).reverse();
  document.getElementById("ranking-note").textContent = `Pelo ${METRICS[state.metric].label}, com a melhor variante de esforço.`;
  chart("chart-ranking").setOption({
    ...baseOption(),
    grid: { left: 8, right: 56, top: 8, bottom: 24, containLabel: true },
    // barras sempre a partir do zero: o comprimento é o valor
    xAxis: axisStyle({ type: "value", min: 0, axisLabel: { show: false }, splitLine: { show: false } }),
    yAxis: { type: "category", data: top.map((m) => m.display_name), axisTick: { show: false },
      axisLine: { lineStyle: { color: css("--axis") } }, axisLabel: { color: css("--ink"), fontSize: 12.5 } },
    tooltip: { ...baseOption().tooltip, trigger: "item", formatter: (p) => tooltipModel(top[p.dataIndex]) },
    series: [{
      type: "bar", barMaxWidth: 18, barCategoryGap: "35%",
      data: top.map((m) => ({ value: scoreOf(m), itemStyle: { color: markColor(m) === css("--mark") ? css("--ink-2") : markColor(m), borderRadius: [0, 4, 4, 0] } })),
      label: { show: true, position: "right", color: css("--ink-2"), fontSize: 12, formatter: (p) => fmtScore(p.value) },
    }],
  }, true);
}

/* ---------- 3. melhor modelo por orçamento (tabela da fronteira) ---------- */
function renderBudget(front) {
  const body = document.querySelector("#budget-table tbody");
  if (!front.length) {
    const tr = document.createElement("tr"); const td = document.createElement("td");
    td.colSpan = 4; td.textContent = "Nenhum modelo com capacidade e preço nos filtros atuais. Amplie os filtros.";
    tr.append(td); body.replaceChildren(tr); return;
  }
  const leaderScore = Math.max(...front.map((m) => scoreOf(m)));
  body.replaceChildren(...front.map((m) => {
    const tr = document.createElement("tr");
    const price = document.createElement("td"); price.textContent = fmtUsd(priceOf(m));
    const name = document.createElement("td");
    const h = highlightOf(m);
    if (h) { const dot = document.createElement("i"); dot.className = "hl-dot"; dot.style.background = slotColor(h.slot); name.append(dot); }
    const strong = document.createElement("span"); strong.className = "model-name"; strong.textContent = m.display_name;
    const org = document.createElement("span"); org.className = "model-org"; org.textContent = m.organization ?? "";
    name.append(strong, org);
    const score = document.createElement("td"); score.className = "num"; score.textContent = fmtScore(scoreOf(m));
    const pct = document.createElement("td"); pct.className = "num"; pct.textContent = fmtPct((scoreOf(m) / leaderScore) * 100);
    tr.append(price, name, score, pct);
    return tr;
  }));
}

/* ---------- 4. padrão × batch ---------- */
function renderBatch(models) {
  const rows = models
    .filter((m) => scoreOf(m) != null && m.blended_usd_1m > 0 && m.blended_batch_usd_1m > 0)
    .sort((a, b) => scoreOf(b) - scoreOf(a)).slice(0, 15).reverse();
  const ink = css("--frontier"), surface = css("--surface");
  chart("chart-batch").setOption({
    ...baseOption(),
    grid: { left: 8, right: 32, top: 8, bottom: 48, containLabel: true },
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
    xAxis: axisStyle({ type: "log", logBase: 10, name: "Preço blended (US$ por 1M tokens, escala log)", nameLocation: "middle", nameGap: 30,
      min: (v) => v.min / 1.5, max: (v) => v.max * 1.5, // folga para o ponto não encostar na borda
      axisLabel: { color: css("--muted"), fontSize: 12, formatter: fmtTick, showMinLabel: false, showMaxLabel: false } }),
    yAxis: { type: "category", data: rows.map((m) => m.display_name), axisTick: { show: false },
      axisLine: { show: false }, axisLabel: { color: css("--ink"), fontSize: 12.5 } },
    series: [
      { // conector entre os dois preços
        type: "custom", silent: true, data: rows.map((m, i) => [m.blended_batch_usd_1m, m.blended_usd_1m, i]),
        renderItem: (params, api) => {
          const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), api.value(2)]);
          return { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: css("--axis"), lineWidth: 2 } };
        },
        encode: { x: [0, 1], y: 2 }, z: 1,
      },
      { type: "scatter", name: "Padrão", symbolSize: 10, z: 2,
        data: rows.map((m, i) => [m.blended_usd_1m, i]), itemStyle: { color: css("--mark"), borderColor: surface, borderWidth: 2 } },
      { type: "scatter", name: "Batch", symbolSize: 10, z: 3,
        data: rows.map((m, i) => ({ value: [m.blended_batch_usd_1m, i],
          itemStyle: m.batch_status === "official" ? { color: ink, borderColor: surface, borderWidth: 2 } : { color: surface, borderColor: ink, borderWidth: 2 } })) },
    ],
  }, true);
  setLegend("batch-legend", [
    { kind: "dot", color: css("--mark"), label: "Preço padrão" },
    { kind: "dot", color: ink, label: "Batch oficial" },
    { kind: "ring", label: "Batch estimado pelo desconto documentado" },
  ]);
}

/* ---------- 5. linha do tempo ---------- */
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
      endLabel: { show: !isNarrow(), color: css("--ink"), fontSize: 12, fontWeight: 600, formatter: () => last.display_name, distance: 6 },
    });
  }
  series.push(hitLayer(pts.map(point)));
  chart("chart-timeline").setOption({
    ...baseOption(),
    grid: { left: 56, right: isNarrow() ? 20 : 140, top: 28, bottom: 40 },
    xAxis: axisStyle({ type: "time", splitLine: { show: false },
      axisLabel: { color: css("--muted"), fontSize: 12, formatter: (v) => new Date(v).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }) } }),
    yAxis: axisStyle({ type: "value", scale: true, name: METRICS[state.metric].label, nameLocation: "end", nameGap: 14 }),
    series,
  }, true);
  setLegend("timeline-legend", [
    { kind: "line", label: "Melhor resultado até a data" },
    ...highlightLegendItems(),
    { kind: "dot", color: css("--mark"), label: "Demais modelos" },
  ]);
}

/* ---------- 6. tabela completa ---------- */
function columns() {
  const cols = [
    { key: "name", label: "Modelo", get: (m) => m.display_name, render: renderNameCell },
    { key: "release", label: "Lançamento", num: true, get: (m) => m.release_date,
      fmt: (v) => fmtDate(v, { day: "2-digit", month: "2-digit", year: "numeric" }) },
    { key: "score", label: METRICS[state.metric].short, num: true, get: (m) => scoreOf(m), fmt: (v) => fmtScore(v) },
    ...Object.keys(METRICS).filter((k) => k !== state.metric)
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
  if (state.showBench) {
    for (const [key, label] of Object.entries(DATA.meta.benchmarks)) {
      if (key in METRICS) continue;
      cols.push({ key, label, num: true, get: (m) => m[key], fmt: (v) => (v == null ? "—" : nf(0).format(v * 100) + "%"), dim: true });
    }
  }
  return cols;
}
function renderNameCell(td, m) {
  const h = highlightOf(m);
  if (h) { const dot = document.createElement("i"); dot.className = "hl-dot"; dot.style.background = slotColor(h.slot); td.append(dot); }
  const name = document.createElement("span"); name.className = "model-name"; name.textContent = m.display_name;
  const org = document.createElement("span"); org.className = "model-org";
  org.textContent = [m.organization, m.open_weights === true ? "pesos abertos" : null].filter(Boolean).join(", ");
  td.append(name, org);
}
function renderStatusCell(td, m) {
  const s = BATCH_STATUS[m.batch_status];
  if (!s) { td.textContent = "—"; td.className = "dim"; return; }
  const wrap = document.createElement("span"); wrap.className = "status";
  const icon = document.createElement("span"); icon.className = "status-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = s.icon;
  wrap.append(icon, document.createTextNode(s.label));
  td.append(wrap);
}
function renderTable(models) {
  const cols = columns();
  const col = cols.find((c) => c.key === state.sort.key) ?? cols[2];
  const rows = [...models].sort((a, b) => {
    const va = col.get(a), vb = col.get(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === "string" ? va.localeCompare(vb, "pt-BR") : va - vb) * state.sort.dir;
  });
  const visible = state.showAll ? rows : rows.slice(0, TABLE_PAGE);

  const tr = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th"); th.scope = "col"; if (c.num) th.className = "num";
    if (c.key === col.key) th.setAttribute("aria-sort", state.sort.dir > 0 ? "ascending" : "descending");
    const b = document.createElement("button"); b.type = "button";
    b.textContent = c.label + (c.key === col.key ? (state.sort.dir > 0 ? " ↑" : " ↓") : "");
    b.addEventListener("click", () => {
      state.sort = { key: c.key, dir: c.key === col.key ? -state.sort.dir : (c.num ? -1 : 1) };
      renderTable(filtered());
    });
    th.append(b); tr.append(th);
  }
  document.querySelector("#models-table thead").replaceChildren(tr);
  document.querySelector("#models-table tbody").replaceChildren(...visible.map((m) => {
    const row = document.createElement("tr");
    for (const c of cols) {
      const td = document.createElement("td");
      if (c.render) c.render(td, m);
      else { td.textContent = c.fmt(c.get(m)); td.className = [c.num ? "num" : "", c.dim ? "dim" : ""].join(" ").trim(); }
      row.append(td);
    }
    return row;
  }));
  document.getElementById("table-note").textContent =
    `${rows.length} modelos nos filtros atuais. Preços em US$ por 1 milhão de tokens; capacidade por US$ usa o preço ${state.mode === "batch" ? "batch" : "padrão"} blended.`;
  const more = document.getElementById("show-all");
  more.hidden = rows.length <= TABLE_PAGE;
  more.textContent = state.showAll ? "Mostrar só os primeiros" : `Mostrar todos os ${rows.length} modelos`;
}

/* ---------- filtros ---------- */
function renderChips() {
  const box = document.getElementById("highlight-chips");
  box.replaceChildren(...[...state.highlight].sort((a, b) => a.slot - b.slot).map((h) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "chip";
    b.setAttribute("aria-label", `Remover destaque de ${h.org}`);
    const sw = document.createElement("i"); sw.className = "swatch"; sw.style.background = slotColor(h.slot);
    const x = document.createElement("span"); x.className = "x"; x.setAttribute("aria-hidden", "true"); x.textContent = "×";
    b.append(sw, document.createTextNode(h.org), x);
    b.addEventListener("click", () => { state.highlight = state.highlight.filter((o) => o !== h); renderAll(); });
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
  const orgs = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [org, n] of orgs) {
    const o = document.createElement("option"); o.value = org; o.textContent = `${org} (${n})`; select.append(o);
  }
}
function bindFilters() {
  const form = document.getElementById("filters");
  form.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "highlight") {
      if (t.value && !state.highlight.some((h) => h.org === t.value) && state.highlight.length < MAX_HIGHLIGHT) {
        const used = new Set(state.highlight.map((h) => h.slot));
        const slot = [1, 2, 3].find((s) => !used.has(s));
        state.highlight.push({ org: t.value, slot });
      }
      t.value = "";
    } else if (t.name in state) {
      state[t.name] = t.value;
    }
    state.showAll = false;
    renderAll();
  });
  let timer;
  form.query.addEventListener("input", (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = e.target.value; state.showAll = false; renderAll(); }, 150);
  });
  document.getElementById("toggle-bench").addEventListener("change", (e) => { state.showBench = e.target.checked; renderTable(filtered()); });
  document.getElementById("show-all").addEventListener("click", () => { state.showAll = !state.showAll; renderTable(filtered()); });
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
    renderAll();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
}

/* ---------- rodapé ---------- */
function renderSources() {
  document.getElementById("sources-list").replaceChildren(...DATA.meta.sources.map((s) => {
    const li = document.createElement("li");
    const a = document.createElement("a"); a.href = s.url; a.textContent = s.name; a.rel = "noopener";
    const what = document.createElement("span"); what.className = "what"; what.textContent = `${s.provides}. Licença: ${s.license}.`;
    li.append(a, what);
    return li;
  }));
}

function renderAll() {
  const models = filtered();
  renderChips();
  const front = renderFrontier(models);
  renderRanking(models);
  renderBudget(front);
  renderBatch(models);
  renderTimeline(models);
  renderTable(models);
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
  if (!(DATA.meta.primary_metric in METRICS)) state.metric = "eci";
  else state.metric = DATA.meta.primary_metric;
  document.querySelector('select[name="metric"]').value = state.metric;
  fillOrgSelect();
  renderHero();
  renderSources();
  bindFilters();
  bindTheme();
  renderAll();
  let resizeTimer;
  window.addEventListener("resize", () => {
    Object.values(charts).forEach((c) => c.resize());
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 200); // rótulos dependem da largura
  });
}

main();

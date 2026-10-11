# Dashboard no iPhone — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** as 9 análises do dashboard cabendo, uma por tela e sem rolagem vertical, no iPhone em pé.

**Architecture:** mesma página e mesmo código. Uma faixa de CSS (`max-width: 599.98px` e `min-height: 480px`) liga a
barra do topo, a gaveta do menu, o painel de filtros e o layout de cada tela; `app.js` ganha um `matchMedia` igual
(`PHONE`) e a faixa entra em `FIXED_LAYOUT`, então as tabelas calculam as linhas que cabem como no notebook.

**Tech Stack:** HTML/CSS/JS estáticos em `site/`, ECharts 5.6 (CDN), Playwright (só no smoke test, no scratchpad).

**Spec:** `docs/superpowers/specs/2026-10-11-dashboard-iphone-design.md`

## Global Constraints
- Faixa celular: `(max-width: 599.98px) and (min-height: 480px)`; celular baixo (SE): a mesma com `(max-height: 600px)`.
- Notebook (≥ 960×560) e monitor (≥ 1280×860) não mudam: capturas do PC idênticas byte a byte antes × depois.
- Mesmas 9 análises; nada muda em dados, pipeline ou `site/data/`.
- No celular: campos com 16 px de texto; alvos ≥ 44 px na barra, gaveta, painel e abas; ≥ 36 px na paginação.
- Notas das telas: até 3 linhas (2 no SE), com reticências.
- Código no estilo do arquivo: comentários curtos em português, mesma densidade, sem abstrações além das listadas.
- Sem commits durante a execução (o usuário decide no fim); nunca `git add -A`; `python tools/check_secrets.py` antes
  de qualquer commit.
- Pré-visualizar sempre a partir de uma cópia de `site/` no scratchpad (o Google Drive corta o JSON de 2 MB).
- `<SP>` = diretório temporário fora do repositório (o scratchpad da sessão do agente).

## Estrutura de arquivos
| Arquivo | Papel nesta mudança |
|---|---|
| `site/index.html` | barra do topo, cabeçalho e chips do painel de filtros, fundo escurecido, abas e `data-pane` |
| `site/styles.css` | regra base que esconde os elementos do celular; bloco da faixa celular; bloco do celular baixo |
| `site/app.js` | `PHONE`, `FIXED_LAYOUT`, navegação (título, ‹ ›, gesto), gaveta e painel, contador, chips, abas, rótulos curtos, paginação dos benchmarks, ajustes dos gráficos em tela estreita |
| `<SP>/smoke/smoke.mjs` | smoke test (descartável, fora do repo) |

---

### Task 1: smoke test (o teste que falha primeiro)

**Files:**
- Create: `<SP>/smoke/smoke.mjs`, `<SP>/smoke/package.json` (via `npm init -y`)
- Create: `<SP>/baseline-1440/` (cópia de `site/` antes da mudança do iPhone, já com o ajuste de 1440)

**Interfaces:**
- Produces: `node smoke.mjs <site> [--baseline <site-antes>] [--out <pasta>] [--views a,b] [--profiles a,b]`;
  imprime a tabela passa/falha e sai com código 1 se algo falhar. Perfis: `iphone-se`, `iphone-14`, `iphone-15`,
  `iphone-pro-max`, `iphone-17-pro-max`, `pc-1440`, `pc-1366`.

- [ ] **Step 1: instalar o Playwright no scratchpad**

```bash
cd "<SP>" && mkdir -p smoke && cd smoke && npm init -y >/dev/null && npm i playwright@1 && npx playwright install webkit chromium
```
Expected: download do WebKit e do Chromium concluído, sem erro.

- [ ] **Step 2: copiar o baseline (só depois de o ajuste de 1440 terminar)**

```bash
rm -rf "<SP>/baseline-1440" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/baseline-1440"
```

- [ ] **Step 3: escrever `<SP>/smoke/smoke.mjs`**

```js
// Smoke test do dashboard: iPhone (WebKit com emulação de celular) × PC (Chromium). Descartável.
// Uso: node smoke.mjs <site> [--baseline <site-antes>] [--out <pasta>] [--views a,b] [--profiles a,b] [--dark]
import { chromium, webkit } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const SITE = path.resolve(argv[0]);
const BASELINE = opt("--baseline") && path.resolve(opt("--baseline"));
const OUT = path.resolve(opt("--out", "out"));
const ALL_VIEWS = ["geral", "aplicacoes", "aplicabilidade", "ranking", "batch", "evolucao", "modelos", "metodo", "fontes"];
const VIEWS = opt("--views") ? opt("--views").split(",") : ALL_VIEWS;
const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const PROFILES = [
  { id: "iphone-se", engine: webkit, phone: true, viewport: { width: 375, height: 548 }, dpr: 2 },
  { id: "iphone-14", engine: webkit, phone: true, viewport: { width: 390, height: 664 }, dpr: 3 },
  { id: "iphone-15", engine: webkit, phone: true, viewport: { width: 393, height: 659 }, dpr: 3 },
  { id: "iphone-pro-max", engine: webkit, phone: true, viewport: { width: 430, height: 739 }, dpr: 3 },
  { id: "iphone-17-pro-max", engine: webkit, phone: true, viewport: { width: 440, height: 760 }, dpr: 3 },
  { id: "pc-1440", engine: chromium, phone: false, viewport: { width: 1440, height: 930 }, dpr: 1 },
  { id: "pc-1366", engine: chromium, phone: false, viewport: { width: 1366, height: 657 }, dpr: 1 },
].filter((p) => !opt("--profiles") || opt("--profiles").split(",").includes(p.id));

function serve(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    fs.readFile(path.join(root, p), (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": types[path.extname(p)] ?? "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/* roda dentro da página: devolve problemas (falhas) e avisos da tela visível */
function check(phone) {
  const describe = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + [...e.classList].map((c) => "." + c).join("");
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
  const vw = innerWidth, vh = innerHeight, doc = document.documentElement;
  const view = document.querySelector(".view:not([hidden])");
  const problems = [];
  if (doc.scrollHeight > vh + 1) problems.push(`rolagem vertical: ${doc.scrollHeight} > ${vh}`);
  if (doc.scrollWidth > vw + 1) problems.push(`estouro lateral: ${doc.scrollWidth} > ${vw}`);
  // fora da tela (a tabela de modelos e a fileira de aplicações rolam para o lado de propósito)
  for (const e of view.querySelectorAll("*")) {
    if (!visible(e) || e.closest("#models-wrap, #app-list, svg")) continue; // o SVG dos gráficos é checado à parte
    const r = e.getBoundingClientRect();
    if (r.bottom > vh + 1 || r.right > vw + 1 || r.left < -1) {
      problems.push(`fora da tela: ${describe(e)} em ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      break;
    }
  }
  for (const e of view.querySelectorAll(".table-wrap, .chart, .app-detail, .about, .pane, .hero, .master-detail")) {
    if (visible(e) && e.scrollHeight > e.clientHeight + 1) problems.push(`cortado: ${describe(e)} ${e.scrollHeight} > ${e.clientHeight}`);
  }
  for (const c of view.querySelectorAll(".chart")) {
    if (!visible(c)) continue;
    const marks = c.querySelectorAll("svg path, svg circle, svg rect").length;
    if (c.clientHeight < 150 || marks < 10) problems.push(`gráfico vazio ou baixo: #${c.id} ${c.clientWidth}×${c.clientHeight}, ${marks} marcas`);
  }
  let minFont = Infinity, minWhere = "";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const e = n.parentElement;
    if (!n.textContent.trim() || !e || !visible(e) || !(view.contains(e) || e.closest(".phone-bar"))) continue;
    const size = parseFloat(getComputedStyle(e).fontSize);
    if (size < minFont) { minFont = size; minWhere = describe(e); }
  }
  if (minFont < 11) problems.push(`fonte de ${minFont}px em ${minWhere}`);
  if (phone) {
    const sized = (sel, min) => {
      for (const t of document.querySelectorAll(sel)) {
        if (!visible(t)) continue;
        const r = t.getBoundingClientRect();
        if (Math.min(r.width, r.height) < min - 0.5) problems.push(`alvo pequeno: ${describe(t)} ${Math.round(r.width)}×${Math.round(r.height)} (< ${min})`);
      }
    };
    sized(".phone-bar button, .view:not([hidden]) .pane-tabs button, .view:not([hidden]) .small-seg span", 44);
    sized(".view:not([hidden]) .pager button", 36);
  }
  const cut = [...view.querySelectorAll("*")].filter((e) => visible(e) && getComputedStyle(e).textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth + 1);
  return { problems, cut: cut.length, cutExamples: cut.slice(0, 3).map((e) => e.textContent.trim().slice(0, 40)), minFont };
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

async function openContext(profile) {
  const browser = await profile.engine.launch();
  const context = await browser.newContext({
    viewport: profile.viewport, deviceScaleFactor: profile.dpr, reducedMotion: "reduce",
    colorScheme: argv.includes("--dark") ? "dark" : "light",
    ...(profile.phone ? { isMobile: true, hasTouch: true, userAgent: IOS_UA } : {}),
  });
  return { browser, context };
}

/* captura e checa as telas de um perfil num site; devolve { results, shots } */
async function runProfile(profile, site, tag) {
  const { browser, context } = await openContext(profile);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${site}/#${VIEWS[0]}`);
  await settle(page);
  const results = {}, shots = {};
  for (const view of VIEWS) {
    await page.evaluate((v) => { location.hash = v; }, view);
    await page.waitForTimeout(500);
    results[view] = await page.evaluate(check, profile.phone);
    const file = path.join(OUT, `${tag}-${profile.id}-${ALL_VIEWS.indexOf(view) + 1}-${view}.png`);
    await page.screenshot({ path: file });
    shots[view] = file;
  }
  await browser.close();
  return { results, shots, errors };
}

/* interações no iPhone; devolve a lista de falhas */
async function interactions(profile, site) {
  const { browser, context } = await openContext(profile);
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  const fails = [];
  const step = async (name, fn) => { try { if (!(await fn())) fails.push(name); } catch (e) { fails.push(`${name} (${e.message.split("\n")[0]})`); } };
  const swipe = (dx) => page.evaluate((dx) => {
    const area = document.querySelector(".views"), r = area.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = (type, cx) => {
      const ev = new Event(type, { bubbles: true }), touch = { clientX: cx, clientY: y };
      Object.defineProperty(ev, "touches", { value: type === "touchend" ? [] : [touch] });
      Object.defineProperty(ev, "changedTouches", { value: [touch] });
      area.dispatchEvent(ev);
    };
    fire("touchstart", x); fire("touchend", x + dx);
  }, dx);
  const hash = () => page.evaluate(() => location.hash);
  const opened = (cls) => page.evaluate((c) => document.documentElement.classList.contains(c), cls);
  await page.goto(`${site}/#geral`);
  await settle(page);
  await step("abrir o menu", async () => { await page.tap("#menu-btn"); await page.waitForTimeout(350);
    return page.evaluate(() => document.querySelector(".sidebar").getBoundingClientRect().left >= -1); });
  await step("navegar pelo menu e fechá-lo", async () => { await page.tap('#nav a[data-view="batch"]'); await page.waitForTimeout(400);
    return (await hash()) === "#batch" && !(await opened("menu-open")); });
  await step("abrir os filtros", async () => { await page.tap("#filters-btn"); await page.waitForTimeout(350);
    return page.evaluate(() => document.querySelector(".filters").getBoundingClientRect().top < innerHeight - 100); });
  await step("trocar para Batch e ver o contador 1", async () => { await page.tap(".filters .segmented label:nth-of-type(2) span"); await page.waitForTimeout(250);
    return page.evaluate(() => { const b = document.getElementById("filters-badge"); return !b.hidden && b.textContent === "1"; }); });
  await step("fechar os filtros com Pronto", async () => { await page.tap("#filters-done"); await page.waitForTimeout(350); return !(await opened("filters-open")); });
  await step("› avança", async () => { await page.tap("#next-view"); await page.waitForTimeout(300); return (await hash()) === "#evolucao"; });
  await step("‹ volta", async () => { await page.tap("#prev-view"); await page.waitForTimeout(300); return (await hash()) === "#batch"; });
  await step("deslizar troca de análise", async () => { await swipe(-120); await page.waitForTimeout(300); return (await hash()) === "#evolucao"; });
  await step("tocar num ponto mostra o tooltip", async () => {
    await page.evaluate(() => { location.hash = "geral"; }); await page.waitForTimeout(500);
    const pt = await page.evaluate(() => {
      const box = document.getElementById("chart-frontier"), c = echarts.getInstanceByDom(box), o = c.getOption();
      const s = o.series.findIndex((x) => x.name === "Fronteira"), d = o.series[s].data.at(-1);
      const [x, y] = c.convertToPixel({ seriesIndex: s }, d.value), r = box.getBoundingClientRect();
      return { x: r.left + x, y: r.top + y };
    });
    await page.touchscreen.tap(pt.x, pt.y); await page.waitForTimeout(400);
    return page.evaluate(() => [...document.querySelectorAll(".tt")].some((t) => t.getBoundingClientRect().width > 0));
  });
  await step("aba Orçamento", async () => {
    await page.evaluate(() => { location.hash = "ranking"; }); await page.waitForTimeout(500);
    await page.tap('.pane-tabs button[data-target="budget"]'); await page.waitForTimeout(300);
    return page.evaluate(() => document.getElementById("budget-table").getBoundingClientRect().height > 100
      && document.getElementById("chart-ranking").getBoundingClientRect().height === 0);
  });
  await step("aba Como ler", async () => {
    await page.evaluate(() => { location.hash = "fontes"; }); await page.waitForTimeout(400);
    await page.tap('.pane-tabs button[data-target="method"]'); await page.waitForTimeout(300);
    return page.evaluate(() => document.querySelector(".method").getBoundingClientRect().height > 50
      && document.getElementById("sources-list").getBoundingClientRect().height === 0);
  });
  await step("tabela de modelos rola para o lado com o nome fixo", async () => {
    await page.evaluate(() => { location.hash = "modelos"; }); await page.waitForTimeout(500);
    return page.evaluate(() => { const w = document.getElementById("models-wrap"); w.scrollLeft = 300;
      const th = w.querySelector("thead th"); return w.scrollLeft > 0 && Math.abs(th.getBoundingClientRect().left - w.getBoundingClientRect().left) < 2; });
  });
  await step("benchmarks paginados em Programação", async () => {
    await page.evaluate(() => { location.hash = "metodo"; }); await page.waitForTimeout(500);
    await page.tap('#app-list button:has-text("Programação")'); await page.waitForTimeout(300);
    return page.evaluate(() => { const d = document.getElementById("app-detail"); return d.scrollHeight <= d.clientHeight + 1; });
  });
  await browser.close();
  return fails;
}

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(SITE), site = `http://127.0.0.1:${server.address().port}`;
const baseServer = BASELINE && (await serve(BASELINE)), baseSite = baseServer && `http://127.0.0.1:${baseServer.address().port}`;
let failed = false;
const rows = [], details = [], sheet = {};
for (const profile of PROFILES) {
  const { results, shots, errors } = await runProfile(profile, site, "depois");
  sheet[profile.id] = shots;
  rows.push(`| ${profile.id} | ` + VIEWS.map((v) => (results[v].problems.length ? `✗ ${results[v].problems.length}` : "✓")).join(" | ") + " |");
  for (const v of VIEWS) {
    for (const p of results[v].problems) details.push(`- ${profile.id} / ${v}: ${p}`);
    if (results[v].cut) details.push(`  (aviso) ${profile.id} / ${v}: ${results[v].cut} textos com reticências, ex.: ${results[v].cutExamples.join(" · ")}`);
  }
  if (errors.length) details.push(`- ${profile.id}: erros no console: ${errors.slice(0, 3).join(" | ")}`);
  failed ||= errors.length > 0 || VIEWS.some((v) => results[v].problems.length);
  if (!profile.phone && baseSite) {
    const before = await runProfile(profile, baseSite, "antes");
    const diff = VIEWS.filter((v) => !fs.readFileSync(shots[v]).equals(fs.readFileSync(before.shots[v])));
    details.push(`- ${profile.id}: antes × depois ${diff.length ? "DIFERENTES em " + diff.join(", ") : "idênticos nas " + VIEWS.length + " telas"}`);
    failed ||= diff.length > 0;
  }
}
for (const profile of PROFILES.filter((p) => ["iphone-15", "iphone-se"].includes(p.id))) {
  const fails = await interactions(profile, site);
  details.push(`- interações ${profile.id}: ${fails.length ? "FALHAS: " + fails.join("; ") : "todas ok"}`);
  failed ||= fails.length > 0;
}
// folha de contato: cada tela numa linha, iPhones ao lado do PC
const cols = Object.keys(sheet);
fs.writeFileSync(path.join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Smoke test</title>
<style>body{font:14px system-ui;margin:16px;background:#eee}table{border-spacing:12px}td{vertical-align:top}img{height:620px;border:1px solid #999;background:#fff}</style>
<table><tr><th></th>${cols.map((c) => `<th>${c}</th>`).join("")}</tr>${VIEWS.map((v) => `<tr><th>${v}</th>${cols.map((c) => `<td><img src="${path.basename(sheet[c][v])}"></td>`).join("")}</tr>`).join("")}</table>`);
console.log(`| perfil | ${VIEWS.join(" | ")} |\n|---|${VIEWS.map(() => "---").join("|")}|\n${rows.join("\n")}\n\n${details.join("\n")}\n\nfolha de contato: ${path.join(OUT, "index.html")}`);
server.close(); baseServer?.close();
process.exit(failed ? 1 : 0);
```

- [ ] **Step 4: rodar contra o site atual e ver falhar no iPhone**

```bash
cd "<SP>/smoke" && node smoke.mjs "<SP>/baseline-1440" --out "<SP>/smoke/out-antes"
```
Expected: código 1. Perfis `iphone-*` com `rolagem vertical` e `fora da tela` em todas as telas e as interações
falhando (os botões ainda não existem). Perfis `pc-*` com ✓ nas 9 telas.

- [ ] **Step 5: checkpoint** — anotar a tabela de saída (é o "antes" do relatório final). Sem commit.

---

### Task 2: estrutura do celular (barra, gaveta, painel, gesto, contador)

**Files:**
- Modify: `site/index.html` (sidebar, workspace, form, fim do body)
- Modify: `site/styles.css` (regra base nova; bloco da faixa celular no fim do arquivo)
- Modify: `site/app.js` (constantes, `primaryMetric`, `renderChips`, `go`, `bindNavigation`, gaveta/painel, `main`)

**Interfaces:**
- Produces: `PHONE` (MediaQueryList); `step(delta)`; `closeSheets()`; `openSheet(cls, button, focusTarget)`;
  `activeFilters()`; `primaryMetric()`; ids `menu-btn`, `phone-title`, `prev-view`, `next-view`, `filters-btn`,
  `filters-badge`, `filters-done`, `highlight-chips-sheet`, `scrim`, `sidebar`; classes `menu-open` e `filters-open`
  no `<html>`.

- [ ] **Step 1: HTML.** Em `site/index.html`, trocar `<aside class="sidebar">` por `<aside class="sidebar" id="sidebar">`.
Logo depois de `<div class="workspace">`, inserir:

```html
    <header class="phone-bar">
      <button type="button" class="menu-btn" id="menu-btn" aria-controls="sidebar" aria-expanded="false">
        <span class="burger" aria-hidden="true"></span><span id="phone-title">Visão geral</span>
      </button>
      <button type="button" class="step" id="prev-view" aria-label="Análise anterior">‹</button>
      <button type="button" class="step" id="next-view" aria-label="Próxima análise">›</button>
      <button type="button" class="filters-btn" id="filters-btn" aria-controls="filters" aria-expanded="false">
        <span class="pill">Filtros<span class="badge" id="filters-badge" hidden></span></span>
      </button>
    </header>
```

Como primeiro filho do `<form class="filters" ...>`:

```html
      <div class="sheet-head"><strong>Filtros</strong><button type="button" id="filters-done">Pronto</button></div>
```

Como último filho do form (depois do campo "Buscar modelo"):

```html
      <div class="chips" id="highlight-chips-sheet" aria-live="polite"></div>
```

Depois do `</div>` que fecha `.shell` (antes de `#load-error`):

```html
<div class="scrim" id="scrim" hidden></div>
```

- [ ] **Step 2: CSS base.** Em `site/styles.css`, logo depois da regra `.fill { min-height: 0; }`, inserir:

```css
/* só no celular: barra do topo, cabeçalho e chips do painel de filtros, abas e fundo escurecido */
.phone-bar, .sheet-head, #highlight-chips-sheet, .pane-tabs, .scrim { display: none; }
```

- [ ] **Step 3: CSS da faixa celular.** No fim de `site/styles.css`, acrescentar:

```css
/* =========================================================================
   iPhone em pé (até 599 px de largura): uma análise por tela, sem rolagem.
   Barra no topo; o menu vira gaveta e os filtros, um painel que sobe de baixo.
   ========================================================================= */
@media (max-width: 599.98px) and (min-height: 480px) {
  html, body { height: 100%; overflow: hidden; overscroll-behavior: none; }
  .shell { height: 100dvh; }
  .workspace { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100dvh; }
  .views { min-height: 0; padding: 10px 12px 12px; }
  .view { height: 100%; min-height: 0; gap: 8px; }
  .fill { flex: 1 1 0; }
  .chart.fill, .two-up .chart.fill { height: auto; } /* desfaz a altura fixa do layout que rola */

  /* barra do topo: menu com o nome da análise, anterior/próxima e filtros */
  .phone-bar { display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 6px 0 2px; border-bottom: 1px solid var(--hairline); }
  .phone-bar button { font: inherit; color: var(--ink); background: none; border: 0; min-height: 44px; cursor: pointer; }
  .menu-btn { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 0 10px; font-size: 1.05rem; font-weight: 700; text-align: left; }
  #phone-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .burger, .burger::before, .burger::after { display: block; width: 18px; height: 2px; border-radius: 1px; background: currentColor; }
  .burger { position: relative; flex: none; }
  .burger::before, .burger::after { content: ""; position: absolute; left: 0; }
  .burger::before { top: -6px; }
  .burger::after { top: 6px; }
  .phone-bar .step { width: 44px; font-size: 1.7rem; line-height: 1; }
  .phone-bar .step:disabled { opacity: 0.3; cursor: default; }
  .phone-bar .filters-btn { padding: 0 2px 0 6px; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; border: 1px solid var(--axis); border-radius: 999px; font-size: 0.9rem; }
  .badge { min-width: 20px; padding: 1px 6px; border-radius: 999px; background: var(--ink); color: var(--surface); font-size: 0.75rem; font-weight: 700; text-align: center; }

  /* menu: gaveta que entra pela esquerda */
  .sidebar {
    position: fixed; inset: 0 auto 0 0; z-index: 30; width: min(320px, 86vw); height: 100dvh; overflow-y: auto;
    gap: 18px; padding: 18px 14px; border: 0; background: var(--page); box-shadow: 8px 0 30px rgba(0, 0, 0, 0.18);
    transform: translateX(-105%); visibility: hidden; transition: transform 0.2s ease, visibility 0.2s;
  }
  .menu-open .sidebar { transform: none; visibility: visible; }
  .nav { flex-direction: column; overflow: visible; }
  .nav a { padding: 12px; font-size: 1rem; }
  .side-foot { flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 10px; margin-top: auto; }
  #highlight-chips { display: none; } /* no celular os destaques ficam no painel de filtros */
  button.ghost { min-height: 44px; }

  /* filtros: painel que sobe de baixo */
  .filters {
    position: fixed; inset: auto 0 0 0; z-index: 30; max-height: 85dvh; overflow-y: auto;
    flex-direction: column; flex-wrap: nowrap; align-items: stretch; gap: 12px;
    padding: 0 16px 20px; border: 0; border-radius: 16px 16px 0 0; box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
    transform: translateY(105%); visibility: hidden; transition: transform 0.22s ease, visibility 0.22s;
  }
  .filters-open .filters { transform: none; visibility: visible; }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 1; padding: 6px 0 2px; background: var(--page); }
  .sheet-head strong { font-size: 1.05rem; }
  .sheet-head button { font: inherit; font-weight: 700; color: var(--ink); background: none; border: 0; min-height: 44px; padding: 0 2px 0 16px; cursor: pointer; }
  .field { font-size: 0.8rem; }
  .field.grow { flex: none; }
  .field select { max-width: none; }
  .filters select, .filters input[type="search"] { font-size: 16px; min-height: 44px; } /* abaixo de 16 px o iOS dá zoom ao focar */
  .filters .segmented label { flex: 1 1 0; }
  .filters .segmented span { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; font-size: 16px; }
  #highlight-chips-sheet:not(:empty) { display: flex; flex-direction: row; flex-wrap: wrap; }
  .chip { min-height: 36px; }
  .scrim:not([hidden]) { display: block; position: fixed; inset: 0; z-index: 20; background: rgba(8, 12, 16, 0.45); }
}
```

- [ ] **Step 4: JS — constantes e estado.** Em `site/app.js`, trocar a linha do `FIXED_LAYOUT` e acrescentar `PHONE`:

```js
// sem rolagem: notebook/monitor e iPhone em pé (as mesmas faixas do styles.css)
const FIXED_LAYOUT = window.matchMedia("(min-width: 960px) and (min-height: 560px), (max-width: 599.98px) and (min-height: 480px)");
const MONITOR = window.matchMedia("(min-width: 1280px) and (min-height: 860px)"); // mesma faixa do styles.css
const PHONE = window.matchMedia("(max-width: 599.98px) and (min-height: 480px)"); // iPhone em pé
```

Logo depois de `const appKeys = ...`, acrescentar:

```js
const primaryMetric = () => (DATA.meta.primary_metric in METRICS ? DATA.meta.primary_metric : "eci");
```

Em `main()`, trocar `state.metric = DATA.meta.primary_metric in METRICS ? DATA.meta.primary_metric : "eci";` por
`state.metric = primaryMetric();`.

- [ ] **Step 5: JS — chips nos dois contêineres e contador.** Substituir `renderChips` inteira por:

```js
/** Filtros fora do padrão, para o contador do botão no celular. */
function activeFilters() {
  return [state.mode !== "standard", state.metric !== primaryMetric(), state.weights !== "all", state.since !== "all", state.query.trim() !== ""]
    .filter(Boolean).length + state.highlight.length;
}
function renderChips() {
  const hl = [...state.highlight].sort((a, b) => a.slot - b.slot);
  // um conjunto por contêiner: menu lateral (desktop) e painel de filtros (celular)
  for (const box of document.querySelectorAll(".chips")) {
    box.replaceChildren(...hl.map((h) => {
      const b = el("button", "chip"); b.type = "button";
      b.setAttribute("aria-label", `Remover destaque de ${h.org}`);
      const sw = el("i", "swatch"); sw.style.background = slotColor(h.slot);
      const x = el("span", "x", "×"); x.setAttribute("aria-hidden", "true");
      b.append(sw, document.createTextNode(h.org), x);
      b.addEventListener("click", () => { state.highlight = state.highlight.filter((o) => o !== h); renderView(); });
      return b;
    }));
  }
  const select = document.getElementById("highlight-select");
  select.disabled = state.highlight.length >= MAX_HIGHLIGHT;
  select.options[0].textContent = select.disabled ? "Limite de 3 atingido" : "Escolha até 3";
  const n = activeFilters();
  const badge = document.getElementById("filters-badge");
  badge.textContent = n; badge.hidden = n === 0;
  document.getElementById("filters-btn").setAttribute("aria-label", n ? `Filtros, ${n} ativos` : "Filtros");
}
```

- [ ] **Step 6: JS — navegação.** Substituir `go` e `bindNavigation` por:

```js
function go(view) {
  state.view = VIEWS.includes(view) ? view : "geral";
  for (const sec of document.querySelectorAll(".view")) sec.hidden = sec.dataset.view !== state.view;
  for (const a of document.querySelectorAll("#nav a")) {
    if (a.dataset.view === state.view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  // celular: nome da análise na barra; anterior/próxima param nas pontas
  const i = VIEWS.indexOf(state.view);
  document.getElementById("phone-title").textContent = document.querySelector(`#nav a[data-view="${state.view}"]`).textContent;
  document.getElementById("prev-view").disabled = i === 0;
  document.getElementById("next-view").disabled = i === VIEWS.length - 1;
  renderView();
}
function step(delta) {
  const i = VIEWS.indexOf(state.view) + delta;
  if (i >= 0 && i < VIEWS.length) location.hash = VIEWS[i];
}
function bindNavigation() {
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    const n = Number(e.key);
    if (n >= 1 && n <= VIEWS.length) location.hash = VIEWS[n - 1];
  });
  document.getElementById("prev-view").addEventListener("click", () => step(-1));
  document.getElementById("next-view").addEventListener("click", () => step(1));
  // celular: deslizar o dedo para o lado troca de análise, exceto onde a tela rola para o lado
  const area = document.querySelector(".views");
  let start = null;
  area.addEventListener("touchstart", (e) => {
    const scroller = e.target.closest?.(".table-wrap, .app-list");
    const t = e.touches[0];
    start = PHONE.matches && e.touches.length === 1 && !(scroller && scroller.scrollWidth > scroller.clientWidth)
      ? { x: t.clientX, y: t.clientY, at: e.timeStamp } : null;
  }, { passive: true });
  area.addEventListener("touchend", (e) => {
    if (!start) return;
    const t = e.changedTouches[0], dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) >= 60 && Math.abs(dx) > 2 * Math.abs(dy) && e.timeStamp - start.at < 700) step(dx < 0 ? 1 : -1);
    start = null;
  }, { passive: true });
}
```

- [ ] **Step 7: JS — gaveta e painel.** Logo antes do bloco `/* ---------- tema ---------- */`, inserir:

```js
/* ---------- celular: gaveta do menu e painel de filtros ---------- */
let sheetOpener = null;
function closeSheets() {
  const root = document.documentElement;
  if (!root.classList.contains("menu-open") && !root.classList.contains("filters-open")) return;
  root.classList.remove("menu-open", "filters-open");
  document.getElementById("scrim").hidden = true;
  for (const id of ["menu-btn", "filters-btn"]) document.getElementById(id).setAttribute("aria-expanded", "false");
  sheetOpener?.focus();
  sheetOpener = null;
}
function openSheet(cls, button, focusTarget) {
  closeSheets();
  document.documentElement.classList.add(cls);
  document.getElementById("scrim").hidden = false;
  button.setAttribute("aria-expanded", "true");
  sheetOpener = button;
  focusTarget?.focus();
}
function bindSheets() {
  const menuBtn = document.getElementById("menu-btn"), filtersBtn = document.getElementById("filters-btn");
  menuBtn.addEventListener("click", () => openSheet("menu-open", menuBtn, document.querySelector("#nav a[aria-current]")));
  filtersBtn.addEventListener("click", () => openSheet("filters-open", filtersBtn, document.getElementById("filters-done")));
  document.getElementById("filters-done").addEventListener("click", closeSheets);
  document.getElementById("scrim").addEventListener("click", closeSheets);
  document.getElementById("sidebar").addEventListener("click", (e) => { if (e.target.closest("a[href^='#']")) closeSheets(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });
  PHONE.addEventListener("change", closeSheets); // girou o celular ou mudou a janela: nada fica aberto por cima
}
```

Em `main()`, logo depois de `bindNavigation();`, acrescentar `bindSheets();`.

- [ ] **Step 8: checar sintaxe e rodar o smoke das interações**

```bash
node --check "G:/Meu Drive/sandbox/bench-ai-model/site/app.js"
rm -rf "<SP>/preview-iphone" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/preview-iphone"
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --profiles iphone-15,pc-1440 --baseline "<SP>/baseline-1440" --out "<SP>/smoke/out"
```
Expected: interações de menu, filtros (contador 1), ‹ › e gesto ok em `iphone-15`; abas, tooltip, tabela e
benchmarks ainda podem falhar (próximas tasks). `pc-1440`: "antes × depois idênticos nas 9 telas". Olhar
`depois-iphone-15-1-geral.png`: barra do topo visível, sem menu nem filtros ocupando a tela.

- [ ] **Step 9: checkpoint** — sem commit.

---

### Task 3: telas de gráfico (Visão geral, Padrão ou batch, Evolução)

**Files:**
- Modify: `site/styles.css` (bloco da faixa celular)
- Modify: `site/app.js` (`renderFrontier`, `renderBatch`, `renderTimeline`)

**Interfaces:**
- Consumes: `isNarrow()` (já existe, < 640 px), `chartFont()` (do ajuste de 1440).

- [ ] **Step 1: CSS.** Dentro do bloco da faixa celular, antes do `}` final, acrescentar:

```css
  /* cabeçalho de cada tela e notas (até 3 linhas) */
  .view-head { gap: 2px; }
  .view h2 { font-size: 1.15rem; }
  .note { font-size: 0.8rem; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .legend { gap: 2px 14px; font-size: 0.75rem; }
  .chart { border-radius: 10px; }

  /* visão geral: frase da semana e os 4 números em grade 2 × 2 */
  .hero { gap: 8px; padding-bottom: 8px; }
  .hero h1 { font-size: 1.35rem; }
  .hero .hero-second { font-size: 0.68em; }
  .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
  .facts div { gap: 6px; }
  .facts dd { font-size: 1.05rem; }
  .facts dt { font-size: 0.75rem; line-height: 1.2; }
```

- [ ] **Step 2: JS — dispersão.** Em `renderFrontier`, trocar o item da legenda e o `grid`/`xAxis`:

```js
  setLegend("frontier-legend", [
    { kind: "line", label: isNarrow() ? "Fronteira de Pareto" : "Fronteira de Pareto (melhor modelo para cada preço)" },
    ...highlightLegendItems(),
    { kind: "dot", color: css("--mark"), label: "Demais modelos" },
  ]);
  chart("chart-frontier").setOption({
    ...baseOption(),
    grid: isNarrow() ? { left: 40, right: 14, top: 30, bottom: 44 } : { left: 56, right: 36, top: 36, bottom: 56 },
    xAxis: axisStyle({
      type: "log", logBase: 10, nameLocation: "middle", nameGap: isNarrow() ? 26 : 32,
      name: isNarrow() ? `Preço ${priceWord} (US$/1M tokens, log)` : `Preço ${priceWord} blended (US$ por 1M tokens, escala log)`,
      axisLabel: { color: css("--muted"), fontSize: chartFont(), formatter: fmtTick, hideOverlap: true },
    }),
    yAxis: yMetricAxis(),
    series,
  }, true);
```

- [ ] **Step 3: JS — batch.** Em `renderBatch`, trocar o terceiro item da legenda, o `grid` e o início do `xAxis`:

```js
    { kind: "ring", label: isNarrow() ? "Batch estimado" : "Batch estimado pelo desconto documentado" },
```
```js
    grid: { left: 8, right: isNarrow() ? 16 : 32, top: 8, bottom: isNarrow() ? 40 : 44, containLabel: true },
```
```js
    xAxis: axisStyle({ type: "log", logBase: 10, nameLocation: "middle", nameGap: isNarrow() ? 24 : 28,
      name: isNarrow() ? "Preço blended (US$/1M tokens, log)" : "Preço blended (US$ por 1M tokens, escala log)",
```
(o resto do `xAxis` — `min`, `max`, `axisLabel` — fica igual).

- [ ] **Step 4: JS — evolução.** Em `renderTimeline`, trocar `grid` e o `axisLabel` do `xAxis`:

```js
    grid: { left: isNarrow() ? 40 : 56, right: isNarrow() ? 16 : 140, top: 32, bottom: 32 },
    xAxis: axisStyle({ type: "time", splitLine: { show: false },
      axisLabel: { color: css("--muted"), fontSize: chartFont(), hideOverlap: isNarrow(),
        formatter: (v) => new Date(v).toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }) } }),
```

- [ ] **Step 5: rodar**

```bash
node --check "G:/Meu Drive/sandbox/bench-ai-model/site/app.js"
rm -rf "<SP>/preview-iphone" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/preview-iphone"
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --views geral,batch,evolucao --profiles iphone-15,iphone-pro-max,pc-1440,pc-1366 --baseline "<SP>/baseline-1440" --out "<SP>/smoke/out"
```
Expected: ✓ nas 3 telas nos iPhones (sem rolagem, nada fora da tela, gráfico ≥ 150 px de altura, fonte ≥ 11 px);
PCs idênticos. Abrir as 3 capturas do `iphone-15` e conferir rótulos e eixos legíveis.

- [ ] **Step 6: checkpoint** — sem commit.

---

### Task 4: telas de tabela (Melhor por aplicação, Aplicabilidade, Todos os modelos, orçamento)

**Files:**
- Modify: `site/styles.css` (bloco da faixa celular)
- Modify: `site/app.js` (`renderPager`, `renderHeat`)

**Interfaces:**
- Consumes: `PHONE`; `heatRow()` lê `--heat-row` + 2 (a faixa celular usa `border-spacing: 1px 2px`, então o + 2 continua certo).

- [ ] **Step 1: CSS.** Dentro do bloco da faixa celular, acrescentar:

```css
  /* tabelas: texto um pouco menor; paginação com botões de 36 px */
  :root { --heat-row: 22px; }
  table { font-size: 0.8rem; }
  th, td { padding: 0 6px; }
  .model-org { font-size: 0.72rem; }
  .pager { gap: 6px; }
  .pager button { min-width: 36px; min-height: 36px; font-size: 1.1rem; line-height: 1; }

  /* melhor por aplicação: 3 colunas, nota e preço embaixo do modelo; as linhas dividem a altura */
  .apps { height: 100%; }
  .apps th:nth-child(1) { width: 28%; }
  .apps th:nth-child(2), .apps th:nth-child(3) { width: 36%; }
  .apps th:nth-child(4), .apps td:nth-child(4) { display: none; }
  .apps tbody th, .apps tbody td { padding: 5px 6px; line-height: 1.25; }
  .apps tbody th { white-space: normal; }
  .apps .line2 { display: none; }
  .apps td .model-org { display: block; margin-left: 0; overflow: hidden; text-overflow: ellipsis; }
  .apps.compact .model-org { display: none; }

  /* aplicabilidade: as 11 colunas na largura, cabeçalho vertical com a primeira palavra */
  .heat { min-width: 0; border-spacing: 1px 2px; }
  .heat thead th { padding: 4px 0; font-size: 0.7rem; }
  .heat thead th:first-child { width: 32%; }
  .heat thead th button { width: auto; writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
  .heat tbody th { padding: 0 4px 0 0; font-size: 0.75rem; }
  .heat tbody th .model-org { display: none; }
  .heat td { padding: 0; font-size: 0.72rem; border-radius: 3px; }
  .heat-legend { gap: 6px; font-size: 0.72rem; }
  .heat-bar { width: 64px; }

  /* todos os modelos: nome fixo à esquerda, as outras colunas rolam para o lado */
  .models { min-width: 860px; }
  .models thead th:first-child { width: 128px; }
  .models .col-release { width: 84px; } .models .col-status { width: 104px; } .models .col-value { width: 80px; }
  .models th:first-child, .models td:first-child { position: sticky; left: 0; z-index: 1; background: var(--surface); box-shadow: 1px 0 0 var(--hairline); }
  .models td:first-child .model-org { display: none; }
  .small-seg span { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; }

  /* orçamento */
  .budget th:nth-child(1) { width: 72px; } .budget th:nth-child(3) { width: 72px; } .budget th:nth-child(4) { width: 58px; }
```

- [ ] **Step 2: JS — paginação compacta.** Em `renderPager`, trocar as duas linhas que criam `prev` e `next` por:

```js
  // no celular só as setas (rótulo no aria-label)
  const prev = el("button", null, PHONE.matches ? "‹" : "‹ Anteriores"); prev.type = "button"; prev.disabled = page === 0;
  const next = el("button", null, PHONE.matches ? "›" : "Próximos ›"); next.type = "button"; next.disabled = page >= pages - 1;
  if (PHONE.matches) { prev.setAttribute("aria-label", "Anteriores"); next.setAttribute("aria-label", "Próximos"); }
```

- [ ] **Step 3: JS — mapa de calor.** Em `renderHeat`, trocar a linha do botão do cabeçalho e a da legenda:

```js
    const b = el("button", null, PHONE.matches ? METRICS[k].short.split(" ")[0] : METRICS[k].short); b.type = "button"; b.title = `Ordenar por ${METRICS[k].short}`;
```
```js
  document.getElementById("heat-legend").replaceChildren(el("span", null, PHONE.matches ? `≤ ${HEAT_MIN}` : `${HEAT_MIN} ou menos`), bar,
    el("span", null, PHONE.matches ? "100" : "100 (líder)"));
```

- [ ] **Step 4: rodar**

```bash
node --check "G:/Meu Drive/sandbox/bench-ai-model/site/app.js"
rm -rf "<SP>/preview-iphone" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/preview-iphone"
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --views aplicacoes,aplicabilidade,modelos --profiles iphone-se,iphone-15,iphone-pro-max,pc-1440,pc-1366 --baseline "<SP>/baseline-1440" --out "<SP>/smoke/out"
```
Expected: ✓ nas 3 telas nos iPhones (a tabela de modelos só rola dentro de `#models-wrap`); interação "tabela de
modelos rola para o lado com o nome fixo" ok; PCs idênticos. Conferir nas capturas: 11 aplicações visíveis no
`iphone-15`; números do mapa de calor inteiros (sem "10…"); cabeçalhos verticais legíveis.

- [ ] **Step 5: checkpoint** — sem commit.

---

### Task 5: abas de Ranking/Orçamento e Fontes/Como ler

**Files:**
- Modify: `site/index.html` (`#view-ranking`, `#view-fontes`)
- Modify: `site/styles.css` (bloco da faixa celular)
- Modify: `site/app.js` (`state`, `applyPanes`, `bindPaneTabs`, `renderView`, `main`)

**Interfaces:**
- Produces: `state.pane = { ranking: "ranking" | "budget", fontes: "sources" | "method" }`; abas com
  `data-target`; painéis com `data-pane`; seção recebe `data-show`.

- [ ] **Step 1: HTML.** Em `#view-ranking`, antes de `<div class="two-up fill">`:

```html
        <div class="pane-tabs" role="tablist" aria-label="Ranking ou orçamento">
          <button type="button" role="tab" data-target="ranking" aria-selected="true">Ranking</button>
          <button type="button" role="tab" data-target="budget" aria-selected="false">Orçamento</button>
        </div>
```
e os dois `<div class="pane">` passam a `<div class="pane" data-pane="ranking">` e `<div class="pane" data-pane="budget">`.

Em `#view-fontes`, antes de `<div class="about fill">`:

```html
        <div class="pane-tabs" role="tablist" aria-label="Fontes ou como ler">
          <button type="button" role="tab" data-target="sources" aria-selected="true">Fontes</button>
          <button type="button" role="tab" data-target="method" aria-selected="false">Como ler</button>
        </div>
```
e as duas `<section>` internas ganham `data-pane="sources"` e `data-pane="method"`.

- [ ] **Step 2: CSS.** Dentro do bloco da faixa celular:

```css
  /* ranking/orçamento e fontes/como ler: abas, uma de cada vez */
  .pane-tabs { display: flex; flex: none; border: 1px solid var(--axis); border-radius: 10px; overflow: hidden; }
  .pane-tabs button { flex: 1 1 0; min-height: 44px; font: inherit; font-size: 0.95rem; color: var(--ink); background: var(--surface); border: 0; cursor: pointer; }
  .pane-tabs button + button { border-left: 1px solid var(--axis); }
  .pane-tabs button[aria-selected="true"] { background: var(--ink); color: var(--surface); font-weight: 600; }
  #view-ranking[data-show="ranking"] [data-pane="budget"], #view-ranking[data-show="budget"] [data-pane="ranking"],
  #view-fontes[data-show="sources"] [data-pane="method"], #view-fontes[data-show="method"] [data-pane="sources"] { display: none; }
  .two-up { grid-template-rows: minmax(0, 1fr); }
  .about h2 { font-size: 1.1rem; margin-bottom: 6px; }
  .sources { gap: 8px; margin-bottom: 10px; }
  .sources li { font-size: 0.9rem; }
  .method { font-size: 0.85rem; }
  .method dt { margin-top: 6px; }
```

- [ ] **Step 3: JS.** Em `state`, acrescentar `pane: { ranking: "ranking", fontes: "sources" },` à última linha do
objeto. Logo antes de `renderView`, inserir:

```js
/* ---------- celular: Ranking | Orçamento e Fontes | Como ler, uma aba de cada vez ---------- */
function applyPanes() {
  for (const tabs of document.querySelectorAll(".pane-tabs")) {
    const sec = tabs.closest(".view");
    sec.dataset.show = state.pane[sec.dataset.view];
    for (const b of tabs.querySelectorAll("button")) b.setAttribute("aria-selected", String(b.dataset.target === sec.dataset.show));
  }
}
function bindPaneTabs() {
  for (const tabs of document.querySelectorAll(".pane-tabs")) {
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-target]");
      if (!b) return;
      state.pane[tabs.closest(".view").dataset.view] = b.dataset.target;
      renderView();
    });
  }
}
```

Em `renderView`, chamar `applyPanes();` logo depois de `renderChips();` e trocar o `case "ranking"` por:

```js
    case "ranking":
      // no celular só a aba visível é desenhada (gráfico escondido não tem tamanho)
      if (!PHONE.matches || state.pane.ranking === "ranking") renderRanking(models);
      if (!PHONE.matches || state.pane.ranking === "budget") renderBudget(models);
      break;
```

Em `main()`, depois de `bindSheets();`, acrescentar `bindPaneTabs();`.

- [ ] **Step 4: rodar**

```bash
node --check "G:/Meu Drive/sandbox/bench-ai-model/site/app.js"
rm -rf "<SP>/preview-iphone" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/preview-iphone"
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --views ranking,fontes --profiles iphone-se,iphone-15,pc-1440,pc-1366 --baseline "<SP>/baseline-1440" --out "<SP>/smoke/out"
```
Expected: ✓ nas 2 telas; interações "aba Orçamento" e "aba Como ler" ok; PCs idênticos.

- [ ] **Step 5: checkpoint** — sem commit.

---

### Task 6: Como é medido (fileira de aplicações e benchmarks paginados)

**Files:**
- Modify: `site/styles.css` (bloco da faixa celular)
- Modify: `site/app.js` (`state`, `renderMethod`)

**Interfaces:**
- Consumes: `renderPager(id, page, size, total, onPage)`, `PHONE`.
- Produces: `state.benchPage`; `#bench-pager` (só no celular).

- [ ] **Step 1: CSS.** Dentro do bloco da faixa celular:

```css
  /* como é medido: aplicações numa fileira que rola para o lado; benchmarks paginados */
  .master-detail { grid-template-rows: auto minmax(0, 1fr); gap: 8px; }
  .app-list { flex-direction: row; gap: 6px; overflow-x: auto; scrollbar-width: none; }
  .app-list::-webkit-scrollbar { display: none; }
  .app-list li { flex: none; }
  .app-list button { align-items: center; min-height: 36px; padding: 0 12px; border: 1px solid var(--axis); border-radius: 999px; font-size: 0.85rem; white-space: nowrap; }
  .app-detail { display: flex; flex-direction: column; min-height: 0; padding: 10px 12px; }
  .app-detail h3 { font-size: 1rem; }
  .app-detail > p { margin: 2px 0 6px; font-size: 0.8rem; }
  .app-detail .pager { margin-bottom: 4px; }
  .bench-rows li { padding: 5px 0; font-size: 0.8rem; }
  .bench-rows .what { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
```

- [ ] **Step 2: JS.** Em `state`, acrescentar `benchPage: 0,`. Em `renderMethod`: no clique do botão de aplicação,
trocar `state.methodApp = app.id; renderMethod();` por `state.methodApp = app.id; state.benchPage = 0; renderMethod();`.
Substituir o trecho que começa em `const ul = el("ul", "bench-rows");` até o fim da função por:

```js
  const items = app.benchmarks.map((col) => {
    const b = DATA.meta.benchmarks[col];
    const kind = b.source === "lmarena" ? "preferência de pessoas" : "teste";
    const li = el("li");
    li.title = `${b.label}: ${b.description}`;
    const head = el("span", "head");
    head.append(el("strong", null, b.label), el("span", "meta", `${SOURCE_NAME[b.source] ?? b.source}, ${kind}, ${b.models} modelos`));
    li.append(head, el("span", "what", b.description));
    return li;
  });
  const rule = app.min_objective === 0
    ? "Índice com pelo menos 2 destes benchmarks."
    : "Índice com pelo menos 2 destes benchmarks, um deles teste objetivo.";
  const ul = el("ul", "bench-rows");
  ul.append(...items);
  const pager = el("div", "pager"); pager.id = "bench-pager";
  detail.replaceChildren(el("h3", null, app.label), el("p", null, `${app.description} ${app.models} modelos com índice. ${rule}`),
    ...(PHONE.matches ? [pager] : []), ul);
  if (PHONE.matches) document.querySelector('#app-list [aria-selected="true"]').scrollIntoView({ block: "nearest", inline: "nearest" });
  // celular: os benchmarks que não cabem viram páginas, todas do tamanho da maior
  if (!PHONE.matches || detail.scrollHeight <= detail.clientHeight + 1) return;
  renderPager("bench-pager", 0, 1, 2, () => {}); // provisória, com a mesma altura da definitiva
  const tallest = Math.max(...items.map((li) => li.offsetHeight));
  const size = Math.max(1, Math.floor((detail.clientHeight - (detail.scrollHeight - ul.offsetHeight)) / tallest));
  if (size >= items.length) { pager.remove(); return; }
  state.benchPage = Math.min(state.benchPage, Math.ceil(items.length / size) - 1);
  ul.replaceChildren(...items.slice(state.benchPage * size, (state.benchPage + 1) * size));
  renderPager("bench-pager", state.benchPage, size, items.length, (p) => { state.benchPage = p; renderMethod(); });
}
```

- [ ] **Step 3: rodar**

```bash
node --check "G:/Meu Drive/sandbox/bench-ai-model/site/app.js"
rm -rf "<SP>/preview-iphone" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/preview-iphone"
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --views metodo --profiles iphone-se,iphone-15,pc-1440,pc-1366 --baseline "<SP>/baseline-1440" --out "<SP>/smoke/out"
```
Expected: ✓ em `metodo`; interação "benchmarks paginados em Programação" ok; PCs idênticos.

- [ ] **Step 4: checkpoint** — sem commit.

---

### Task 7: celular baixo (SE), smoke test completo e relatório

**Files:**
- Modify: `site/styles.css` (bloco do celular baixo no fim do arquivo)

- [ ] **Step 1: CSS do celular baixo.** No fim de `site/styles.css`:

```css
/* iPhone baixo (SE, ~375 × 548 úteis): um pouco mais compacto */
@media (max-width: 599.98px) and (min-height: 480px) and (max-height: 600px) {
  .phone-bar { height: 44px; }
  .views { padding: 8px 10px 10px; }
  .view { gap: 6px; }
  .note { -webkit-line-clamp: 2; }
  .hero h1 { font-size: 1.2rem; }
  .facts dd { font-size: 0.95rem; }
  .method { font-size: 0.8rem; }
  .method dt { margin-top: 4px; }
}
```

- [ ] **Step 2: smoke test completo**

```bash
node --check "G:/Meu Drive/sandbox/bench-ai-model/site/app.js"
rm -rf "<SP>/preview-iphone" && cp -r "G:/Meu Drive/sandbox/bench-ai-model/site" "<SP>/preview-iphone"
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --baseline "<SP>/baseline-1440" --out "<SP>/smoke/out-final"
```
Expected: código 0. ✓ nas 9 telas × 7 perfis; "interações iphone-15: todas ok" e "interações iphone-se: todas ok";
`pc-1440` e `pc-1366` "idênticos nas 9 telas". Se algo falhar: corrigir no CSS/JS da faixa celular (nunca fora dela)
e rodar de novo.

- [ ] **Step 3: revisão visual.** Abrir `<SP>/smoke/out-final/index.html` no navegador (Playwright MCP), percorrer
as 9 linhas e comparar iPhone × PC: texto nítido e legível, nada encostado ou sobreposto, gráficos com rótulos
inteiros, mapa de calor com números inteiros, abas e barra alinhadas. Ajustar o que destoar e repetir o Step 2.

- [ ] **Step 4: tema escuro.**

```bash
cd "<SP>/smoke" && node smoke.mjs "<SP>/preview-iphone" --dark --profiles iphone-15,pc-1440 --out "<SP>/smoke/out-dark"
```
Expected: ✓ nas 9 telas. Olhar as capturas: contraste da barra, das abas, do mapa de calor e dos gráficos.

- [ ] **Step 5: relatório ao usuário** — tabela passa/falha, números antes × depois (altura das telas, larguras das
tabelas), avisos (reticências), caminho da folha de contato, o que não dá para verificar sem um iPhone de verdade
(barra do Safari, em especial a flutuante do iOS 26, gestos reais) e a oferta de abrir no aparelho pela rede local.
Sem commit: propor os commits (ajuste de 1440; iPhone; docs) e esperar o pedido.

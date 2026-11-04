// Built-in diagrams the coach can show in the conversation. Each is drawn from the
// source materials (Definitions Library, Tools Intro, Synthesis). Colours come from CSS
// variables so they work in light and dark mode.

const W = 560;
const ink = "var(--ink)", muted = "var(--muted)", line = "var(--line)", brand = "var(--brand)", soft = "var(--brand-soft)", accent = "var(--accent)", panel = "var(--panel)";
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const svg = (h, title, body) =>
  `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(title)}" class="visual" font-family="system-ui,-apple-system,sans-serif">` +
  `<text x="16" y="24" font-size="15" font-weight="600" fill="${ink}">${esc(title)}</text>${body}</svg>`;
const box = (x, y, w, h, on) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${on ? soft : panel}" stroke="${on ? accent : line}" stroke-width="${on ? 2 : 1.25}"/>`;
const t = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.size || 12.5}" font-weight="${o.bold ? 600 : 400}" fill="${o.fill || ink}" text-anchor="${o.anchor || "middle"}">${esc(s)}</text>`;
// Wrapped text: splits into lines of about max characters, centred on y.
const tw = (x, y, s, o = {}, max = 24) => {
  const lines = [];
  for (const w of String(s).split(" ")) { const l = lines.at(-1); if (l && (l + " " + w).length <= max) lines[lines.length - 1] = l + " " + w; else lines.push(w); }
  const lh = (o.size || 12.5) + 3, y0 = y - ((lines.length - 1) * lh) / 2;
  return lines.map((l, i) => t(x, y0 + i * lh, l, o)).join("");
};
const arrow = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${muted}"/></marker></defs>`;

const VISUALS = {
  cycle: {
    title: "The five-step PHM cycle (WHO): a loop, not a project",
    draw(highlight) {
      const cx = 280, cy = 190, r = 120;
      const steps = ["1. Define the population", "2. Assess and segment", "3. Risk and impactibility", "4. Tailored services", "5. Evaluate and improve"];
      const qs = ["Who are we responsible for?", "What do people need?", "Who is at risk? Can we help?", "What support fits?", "Did it work, for whom?"];
      const rx = 185;
      let body = arrow + `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${r}" fill="none" stroke="${line}" stroke-width="1.5" stroke-dasharray="4 5"/>`;
      body += t(cx, cy - 4, "Everyone in a", { fill: muted }) + t(cx, cy + 14, "defined community", { fill: muted });
      steps.forEach((s, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5, x = cx + rx * Math.cos(a), y = cy + r * Math.sin(a), on = highlight === i + 1;
        body += box(x - 88, y - 24, 176, 48, on) + t(x, y - 4, s, { bold: true }) + t(x, y + 13, qs[i], { size: 11, fill: muted });
      });
      return svg(340, this.title, body + t(cx, 334, "Step 1 comes first: the whole population, so no one is left out.", { size: 11.5, fill: muted }));
    },
  },
  quintuple: {
    title: "The Quintuple Aim: five aims, pursued together",
    draw(highlight) {
      const cx = 280, cy = 185, r = 112;
      const aims = ["Population health outcomes", "Experience of care", "Care team well-being", "Cost of care", "Health equity"];
      let body = `<circle cx="${cx}" cy="${cy}" r="46" fill="${soft}" stroke="${accent}" stroke-width="2"/>` + t(cx, cy - 2, "Target:", { size: 12, fill: muted }) + t(cx, cy + 15, "Everyone", { bold: true, size: 14 });
      aims.forEach((s, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5, x = cx + 170 * Math.cos(a), y = cy + r * Math.sin(a), on = highlight === i + 1;
        body += `<line x1="${cx + 46 * Math.cos(a)}" y1="${cy + 46 * Math.sin(a)}" x2="${x - 60 * Math.cos(a)}" y2="${y - 18 * Math.sin(a)}" stroke="${line}"/>`;
        body += box(x - 90, y - 18, 180, 36, on) + t(x, y + 4, s, { bold: on });
      });
      return svg(330, this.title, body + t(cx, 322, "Rule: don't improve one aim by seriously harming another.", { size: 11.5, fill: muted }));
    },
  },
  groups: {
    title: "One person, many groups",
    draw() {
      const c = [[220, 160, "Older adults"], [340, 160, "Heart disease"], [280, 250, "Language barrier"]];
      let body = c.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="92" fill="${soft}" fill-opacity="0.45" stroke="${accent}" stroke-width="1.5"/>`).join("");
      body += t(150, 62, c[0][2], { bold: true }) + t(410, 62, c[1][2], { bold: true }) + t(280, 358, c[2][2], { bold: true });
      body += `<circle cx="280" cy="192" r="9" fill="${brand}"/>` + t(280, 216, "one person", { size: 11.5, bold: true });
      return svg(400, this.title, body + t(280, 388, "If each group plans its own program, three teams plan for the same person.", { size: 11.5, fill: muted }));
    },
  },
  pyramid: {
    title: "Risk-stratified care (Kaiser pyramid)",
    draw(highlight) {
      const tiers = [["Complex needs", "Case management", "~5%"], ["High risk", "Disease or care management", "~15%"], ["Most people", "Self-care support, prevention", "~70-80%"]];
      let body = "";
      tiers.forEach(([n, s, p], i) => {
        const y = 48 + i * 82, half = 110 + i * 80, on = highlight === 3 - i;
        body += `<path d="M${280 - half} ${y + 78}L${280 - half + 60} ${y}H${280 + half - 60}L${280 + half} ${y + 78}Z" fill="${on ? soft : panel}" stroke="${on ? accent : line}" stroke-width="${on ? 2 : 1.25}"/>`;
        body += t(280, y + 36, `${n} (${p})`, { bold: true }) + t(280, y + 54, s, { size: 11, fill: muted });
      });
      return svg(310, this.title, body + t(280, 304, "Everyone gets a foundation of support; more need means more support.", { size: 11.5, fill: muted }));
    },
  },
  domains: {
    title: "Six domains that make PHM work (Leiden)",
    draw(highlight) {
      const d = ["Accountable regional organization", "Cross-domain business model", "Integrated data infrastructure", "Co-designing workforce and community", "Population health data analytics", "Emergent implementation strategy"];
      let body = `<circle cx="280" cy="190" r="46" fill="${soft}" stroke="${accent}"/>` + t(280, 186, "The five-step", { size: 11.5 }) + t(280, 202, "PHM cycle", { size: 11.5 });
      d.forEach((s, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 3, x = 280 + 150 * Math.cos(a), y = 190 + 118 * Math.sin(a), on = highlight === i + 1;
        const [l1, l2] = s.length > 24 ? [s.slice(0, s.lastIndexOf(" ", 24)), s.slice(s.lastIndexOf(" ", 24) + 1)] : [s, ""];
        body += box(x - 98, y - 22, 196, 44, on) + t(x, y + (l2 ? -3 : 4), l1, { size: 11.5, bold: on }) + (l2 ? t(x, y + 12, l2, { size: 11.5, bold: on }) : "");
      });
      return svg(372, this.title, body + t(280, 364, "Ontario has no single accountable regional organization yet; the other five can move now.", { size: 11.5, fill: muted }));
    },
  },
  california: {
    title: "California's PHM framework (a worked example)",
    draw(highlight) {
      const cols = [["Gathering member", "information", "screening, records, encounters"], ["Understanding", "risk", "stratify, segment, tier"], ["Providing services", "and supports", "basic PHM for everyone, more for some"]];
      let body = arrow;
      cols.forEach(([a, b, c], i) => {
        const x = 24 + i * 180, on = highlight === i + 1;
        body += box(x, 48, 160, 110, on) + t(x + 80, 82, a, { bold: true }) + t(x + 80, 99, b, { bold: true }) + tw(x + 80, 132, c, { size: 10.5, fill: muted }, 22);
        if (i < 2) body += `<line x1="${x + 162}" y1="103" x2="${x + 178}" y2="103" stroke="${muted}" marker-end="url(#ah)"/>`;
      });
      body += box(24, 172, 520, 34, false) + t(284, 194, "Local planning and PHM strategy, with public health and community", { size: 11.5 });
      return svg(240, this.title, body + t(284, 232, "In Canada everyone is effectively a member: our names are already on a provincial list.", { size: 11.5, fill: muted }));
    },
  },
  distinction: {
    title: "Public health, population health and PHM",
    draw(highlight) {
      const cols = [["Public health", "Whole community", "Programs and policy for all", "e.g. a food program open to everyone"], ["Population health", "A defined group", "How healthy are we; who's doing worse?", "e.g. food insecurity is high in one area"], ["PHM", "Each person, by name", "Who needs help; how do we reach them?", "e.g. people there are contacted and connected"]];
      let body = arrow;
      cols.forEach(([h, a, b, c], i) => {
        const x = 16 + i * 180, on = highlight === i + 1 || (highlight === undefined && i === 2);
        body += box(x, 44, 168, 150, on) + t(x + 84, 70, h, { bold: true, size: 13.5 }) + t(x + 84, 90, a, { size: 11.5, fill: muted }) + tw(x + 84, 122, b, { size: 11 }, 24) + tw(x + 84, 166, c, { size: 10.5, fill: muted }, 26);
        if (i < 2) body += `<line x1="${x + 170}" y1="114" x2="${x + 178}" y2="114" stroke="${muted}" marker-end="url(#ah)"/>`;
      });
      return svg(226, this.title, body + t(280, 216, "Population health is WHAT we want to improve; PHM is HOW we organize to do it.", { size: 11.5, fill: muted }));
    },
  },
};

export const VISUAL_IDS = Object.keys(VISUALS);
/** Returns SVG markup for a visual id (optionally highlighting one part), or "" if unknown. */
export function renderVisual(id, highlight) {
  const v = VISUALS[id];
  return v ? v.draw(Number.isFinite(highlight) && highlight > 0 ? highlight : undefined) : "";
}

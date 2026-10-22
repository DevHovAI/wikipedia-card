/*
 * Wikipedia Card – shows a random Wikipedia article (image, title, first paragraphs)
 * and switches to a new one at a configurable interval.
 *
 * The browser fetches the article directly from Wikipedia (CORS is allowed), no sensor needed:
 * first a few random titles via api.php, then the REST summary per title (image, short
 * description, page type). The text itself comes from the plain-text extract of api.php,
 * because the summary drops parentheses such as life dates "(* 1900; † 1980)".
 * With several languages ("en, de") one is picked at random for each article.
 */

const VERSION = "1.0.0";

const DEFAULTS = {
  language: "en",
  interval: 5,
  only_with_image: true,
  show_image: true,
  image_height: 200,
  paragraphs: 1,
  max_lines: 0,
  show_description: true,
  show_attribution: true,
};

const LABELS = {
  language: "Language(s)",
  interval: "New article every … minutes",
  only_with_image: "Only articles with an image",
  show_image: "Show image",
  image_height: "Image height",
  paragraphs: "Paragraphs",
  max_lines: "Limit text to … lines",
  show_description: "Show short description",
  show_attribution: "Show source line",
};

const MAX_TRIES = 8;
const RETRY_MS = 60 * 1000;
const MAX_PARAGRAPHS = 20;
const LINE_HEIGHT = 1.45;

// From these sections on there is only reference material left.
const STOP_SECTIONS =
  /^(references|external links|see also|further reading|notes|bibliography|sources|literatur|weblinks|einzelnachweise|anmerkungen|siehe auch|quellen)$/i;

// Split the plain-text extract into paragraphs; a heading belongs to the first paragraph of its section.
function splitParagraphs(text) {
  const out = [];
  let heading = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^=+\s*(.*?)\s*=+$/);
    if (h) {
      if (STOP_SECTIONS.test(h[1])) break;
      heading = h[1];
      continue;
    }
    // Skip template leftovers such as "i2i3i6" and single words.
    if (line.split(/\s+/).length < 5) continue;
    // Empty parentheses remain where the pronunciation was removed.
    // The German calendar template glues "jul."/"greg." to the date ("21. Märzjul.").
    const clean = line
      .replace(/\(\s*[;,]?\s*\)\s?/g, "")
      .replace(/(?<=[^\s(])(jul|greg)\./g, "")
      .replace(/\s+([,.;:])/g, "$1");
    out.push({ heading, text: clean });
    heading = null;
    if (out.length >= MAX_PARAGRAPHS) break;
  }
  return out;
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Wikimedia serves thumbnails only in fixed widths; 960 px is enough for wide cards.
function imageUrl(page) {
  const orig = page.originalimage;
  const thumb = page.thumbnail;
  if (!thumb) return null;
  if (orig && orig.width <= 960) return orig.source;
  return thumb.source.replace(/\/\d+px-/, "/960px-");
}

class WikipediaCard extends HTMLElement {
  static getStubConfig() {
    return {};
  }

  static getConfigForm() {
    const num = (min, max, step, extra = {}) => ({ number: { min, max, step, mode: "box", ...extra } });
    return {
      schema: [
        {
          type: "grid",
          name: "",
          schema: [
            { name: "interval", selector: num(1, 1440, 1, { unit_of_measurement: "min" }) },
            { name: "language", selector: { text: {} } },
          ],
        },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "show_image", selector: { boolean: {} } },
            { name: "only_with_image", selector: { boolean: {} } },
          ],
        },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "paragraphs", selector: num(1, MAX_PARAGRAPHS, 1) },
            { name: "max_lines", selector: num(0, 80, 1) },
          ],
        },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "image_height", selector: num(60, 600, 10, { unit_of_measurement: "px" }) },
            { name: "show_description", selector: { boolean: {} } },
          ],
        },
        { name: "show_attribution", selector: { boolean: {} } },
      ],
      computeLabel: (s) => LABELS[s.name],
      computeHelper: (s) =>
        ({
          paragraphs: "From the second one on, text continues into the following sections, with headings",
          max_lines: "0 = no limit",
          language: "Wikipedia language code, e.g. en – several separated by commas (en, de) are mixed at random",
        })[s.name],
    };
  }

  setConfig(config) {
    const old = this._config;
    this._config = { ...DEFAULTS, ...config };
    if (!this.shadowRoot) return;
    // A different language or image requirement needs a new article right away.
    if (old && (old.language !== this._config.language || old.only_with_image !== this._config.only_with_image)) {
      this._next();
    } else {
      this._show();
      this._schedule();
    }
  }

  set hass(hass) {
    this._hass = hass;
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 3, rows: "auto" };
  }

  connectedCallback() {
    if (!this.shadowRoot) this._render();
    if (!this._page) this._next();
    else this._schedule();
  }

  disconnectedCallback() {
    clearTimeout(this._timer);
  }

  _schedule(ms) {
    clearTimeout(this._timer);
    if (!this.isConnected) return;
    const minutes = Math.max(1, Number(this._config.interval) || DEFAULTS.interval);
    this._timer = setTimeout(() => this._next(), ms ?? minutes * 60 * 1000);
  }

  _pickBase() {
    const langs = String(this._config.language || "")
      .toLowerCase()
      .split(/[\s,;]+/)
      .filter((l) => /^[a-z][a-z-]*$/.test(l));
    const lang = langs.length ? langs[Math.floor(Math.random() * langs.length)] : DEFAULTS.language;
    return `https://${lang}.wikipedia.org`;
  }

  async _json(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
    return res.json();
  }

  async _paragraphs(base, title) {
    const params = new URLSearchParams({
      action: "query",
      prop: "extracts",
      explaintext: "1",
      exsectionformat: "wiki",
      redirects: "1",
      titles: title,
      format: "json",
      formatversion: "2",
      origin: "*",
    });
    const data = await this._json(`${base}/w/api.php?${params}`);
    return splitParagraphs(data.query.pages[0]?.extract);
  }

  async _randomTitles(base) {
    const params = new URLSearchParams({
      action: "query",
      list: "random",
      rnnamespace: "0",
      rnlimit: String(MAX_TRIES),
      format: "json",
      formatversion: "2",
      origin: "*",
    });
    const data = await this._json(`${base}/w/api.php?${params}`);
    return data.query.random.map((r) => r.title);
  }

  async _next() {
    try {
      let page;
      const base = this._pickBase();
      for (const title of await this._randomTitles(base)) {
        const slug = encodeURIComponent(title.replace(/ /g, "_"));
        const p = await this._json(`${base}/api/rest_v1/page/summary/${slug}?redirect=false`);
        const usable = p.type === "standard" && (p.extract || "").length > 40;
        if (!usable) continue;
        page = p;
        if (!this._config.only_with_image || imageUrl(p)) break;
      }
      if (!page) throw new Error("no suitable article found");
      try {
        page.paragraphs = await this._paragraphs(base, page.title);
      } catch (e) {
        page.paragraphs = [];
      }
      // Without the plain text, fall back to the summary (which lacks parentheses).
      if (!page.paragraphs.length) page.paragraphs = [{ heading: null, text: page.extract }];
      this._page = page;
      this._error = null;
      this._show();
      this._schedule();
    } catch (e) {
      // Keep the current article and try again soon.
      this._error = `Wikipedia not reachable (${e.message})`;
      if (!this._page) this._show();
      this._schedule(RETRY_MS);
    }
  }

  _render() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ha-card { overflow: hidden; }
        img {
          display: block; width: 100%; object-fit: cover;
          background: var(--secondary-background-color, #000);
        }
        .body { padding: 12px 16px 14px; }
        h2 {
          margin: 0; font-size: 1.25em; font-weight: 600; line-height: 1.25;
          color: var(--primary-text-color);
        }
        .desc { margin-top: 2px; font-size: 0.85em; color: var(--secondary-text-color); }
        .text { margin-top: 8px; line-height: ${LINE_HEIGHT}; color: var(--primary-text-color); }
        .text.clamped {
          overflow: hidden;
          -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - ${LINE_HEIGHT}em), transparent);
          mask-image: linear-gradient(to bottom, #000 calc(100% - ${LINE_HEIGHT}em), transparent);
        }
        p { margin: 0 0 ${LINE_HEIGHT}em; }
        p:last-child { margin-bottom: 0; }
        h3 {
          margin: 0; font-size: 0.95em; font-weight: 600; line-height: ${LINE_HEIGHT};
          color: var(--secondary-text-color);
        }
        .source { margin-top: 10px; font-size: 0.75em; color: var(--secondary-text-color); opacity: 0.8; }
        .status { padding: 16px; color: var(--secondary-text-color); }
      </style>
      <ha-card><div class="content"></div></ha-card>`;
    this._contentEl = root.querySelector(".content");
  }

  _show() {
    if (!this._contentEl) return;
    const c = this._config;
    const p = this._page;
    if (!p) {
      this._contentEl.innerHTML = `<div class="status">${esc(this._error || "Loading Wikipedia article …")}</div>`;
      return;
    }
    const img = c.show_image ? imageUrl(p) : null;
    const lines = Number(c.max_lines) || 0;
    const count = Math.max(1, Number(c.paragraphs) || 1);
    const text = p.paragraphs
      .slice(0, count)
      .map((a) => `${a.heading ? `<h3>${esc(a.heading)}</h3>` : ""}<p>${esc(a.text)}</p>`)
      .join("");
    // Limit in whole lines; the last visible line fades out.
    const clamp = lines > 0 ? ` class="text clamped" style="max-height:${lines * LINE_HEIGHT}em"` : ` class="text"`;
    const lang = p.lang || "";
    this._contentEl.innerHTML = `
      ${img ? `<img src="${esc(img)}" alt="" style="height:${Number(c.image_height) || 200}px">` : ""}
      <div class="body">
        <h2>${esc(p.title)}</h2>
        ${c.show_description && p.description ? `<div class="desc">${esc(p.description)}</div>` : ""}
        <div${clamp}>${text}</div>
        ${c.show_attribution ? `<div class="source">Wikipedia${lang ? ` (${esc(lang)})` : ""} · CC BY-SA 4.0</div>` : ""}
      </div>`;
    // Fade only when something is actually cut off.
    requestAnimationFrame(() => {
      const el = this._contentEl.querySelector(".text.clamped");
      if (el && el.scrollHeight <= el.clientHeight + 1) el.classList.remove("clamped");
    });
  }
}

customElements.define("wikipedia-card", WikipediaCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "wikipedia-card",
  name: "Wikipedia Random Article",
  description: "A random Wikipedia article with image and first paragraphs, switching automatically",
  preview: false,
});
console.info(`%c WIKIPEDIA-CARD %c ${VERSION} `, "background:#b5813f;color:#000", "");

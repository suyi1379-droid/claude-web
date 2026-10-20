/* Chat-image halftone / pixelation.
   Inspired by Folia's Nomand "halftone-dots" effect: dot size, tonal levels,
   original colours, inverted luminance and an ink colour. Folia drives a
   Paper shader; this is a small Canvas port so Claude Web can stay build-free.

   Only `.mes_img` inside `#chat` is touched. Avatars, icons and backgrounds
   are deliberately left alone. The original src is kept per image and restored
   when the effect is switched off or the extension is destroyed. */

const DEFAULTS = Object.freeze({ dot: 4, levels: 4, ink: "#1f1f1e" });
const MAX_SIDE = 1400;
const CACHE_LIMIT = 8;

export function installImagePixelate({ win = window, doc = document } = {}) {
  if (win.__claudeImagePixelate) return win.__claudeImagePixelate;

  const read = key => {
    try { return win.localStorage.getItem("claude-web:" + key); } catch { return null; }
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const readNumber = (key, fallback, min, max) => {
    const raw = read(key);
    if (raw == null || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(Math.round(value), min, max) : fallback;
  };

  const currentInk = () => {
    const stored = read("pixelInk");
    if (/^#[0-9a-f]{6}$/i.test(stored || "")) return stored;
    // "默认墨色" follows the theme's ink, so day uses dark ink and night light ink.
    const themed = win.getComputedStyle(doc.documentElement).getPropertyValue("--cl-ink").trim();
    return /^#[0-9a-f]{6}$/i.test(themed) ? themed : DEFAULTS.ink;
  };

  const settings = () => {
    const css = win.getComputedStyle(doc.documentElement);
    const dark = css.getPropertyValue("--cl-color-scheme").trim() === "dark";
    return {
      enabled: read("pixelate") === "on",
      dot: readNumber("pixelDot", DEFAULTS.dot, 2, 12),
      levels: readNumber("pixelLevels", DEFAULTS.levels, 2, 8),
      color: read("pixelColor") === "on",
      invert: read("pixelInvert") === "on",
      ink: currentInk(),
      // Like Folia's colorBack: light paper gets dark ink, dark paper gets light ink.
      paper: css.getPropertyValue("--cw-surface-page").trim() || (dark ? "#1f1f1e" : "#fbfbfa"),
      dark,
    };
  };

  let destroyed = false;
  let observer = null;
  let queueTimer = 0;
  const queue = new Set();
  const states = new WeakMap();   // img -> { original, processed }
  const cache = new Map();

  /**
   * Draw an image as a grid of ink dots. `target` is reused for the settings
   * preview; chat images get a fresh canvas. Dark cells produce large dots,
   * light cells produce none, which is the usual halftone reading.
   */
  function render(source, sourceWidth, sourceHeight, config, target) {
    const scale = Math.min(1, MAX_SIDE / Math.max(1, sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const sample = doc.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const sampleContext = sample.getContext("2d", { willReadFrequently: true });
    sampleContext.imageSmoothingEnabled = true;
    sampleContext.drawImage(source, 0, 0, width, height);

    let pixels;
    try {
      pixels = sampleContext.getImageData(0, 0, width, height).data;
    } catch {
      // Cross-origin images taint the canvas. Leave those untouched.
      return null;
    }

    const output = target || doc.createElement("canvas");
    output.width = width;
    output.height = height;
    const context = output.getContext("2d");
    context.fillStyle = config.paper;
    context.fillRect(0, 0, width, height);

    const dot = Math.max(2, Math.round(config.dot * scale));
    const stepY = Math.max(2, dot * 0.866);
    const levels = Math.max(2, config.levels);
    const steps = levels - 1;
    const ink = config.ink;
    const rows = Math.ceil(height / stepY);

    for (let row = 0; row < rows; row += 1) {
      const cy = row * stepY + stepY / 2;
      const offset = row % 2 ? dot / 2 : 0;
      const top = Math.max(0, Math.floor(cy - stepY / 2));
      const bottom = Math.min(height, Math.ceil(cy + stepY / 2));

      for (let cx = offset + dot / 2; cx < width; cx += dot) {
        const left = Math.max(0, Math.floor(cx - dot / 2));
        const right = Math.min(width, Math.ceil(cx + dot / 2));
        let r = 0, g = 0, b = 0, alpha = 0, count = 0;

        for (let yy = top; yy < bottom; yy += 1) {
          const pixelRow = yy * width;
          for (let xx = left; xx < right; xx += 1) {
            const index = (pixelRow + xx) * 4;
            const a = pixels[index + 3] / 255;
            r += pixels[index] * a;
            g += pixels[index + 1] * a;
            b += pixels[index + 2] * a;
            alpha += a;
            count += 1;
          }
        }

        const coverage = count ? alpha / count : 0;
        if (coverage <= 0.02) continue;

        const red = r / alpha;
        const green = g / alpha;
        const blue = b / alpha;
        const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        // Ink amount is theme-aware: dark ink on light paper, light ink on dark paper.
        let amount = config.dark ? luminance : 1 - luminance;
        if (config.invert) amount = 1 - amount;
        const step = Math.round(amount * steps) / steps;
        const radius = (dot / 2) * step;
        if (radius < 0.45) continue;

        context.beginPath();
        context.arc(cx, cy, Math.min(dot / 2, radius), 0, Math.PI * 2);
        context.fillStyle = config.color
          ? `rgba(${Math.round(red)},${Math.round(green)},${Math.round(blue)},${coverage})`
          : ink;
        context.fill();
      }
    }

    return output;
  }

  function keyFor(source, config) {
    return [source, config.dot, config.levels, config.color ? 1 : 0, config.invert ? 1 : 0, config.ink, config.paper, config.dark ? 1 : 0].join("|");
  }

  function isChatImage(node) {
    return node instanceof win.HTMLImageElement
      && node.classList.contains("mes_img")
      && Boolean(node.closest("#chat"));
  }

  function restore(image) {
    const state = states.get(image);
    if (!state) return;
    if (image.getAttribute("src") !== state.original) image.setAttribute("src", state.original);
    image.classList.remove("cw-pixelated");
    delete image.dataset.cwPixelated;
    states.delete(image);
  }

  function processImage(image) {
    if (destroyed || !isChatImage(image)) return;

    const config = settings();
    if (!config.enabled) {
      restore(image);
      return;
    }

    const source = image.currentSrc || image.src;
    if (!source || source.startsWith("data:image/svg") || /\.gif(?:$|\?)/i.test(source)) return;

    const state = states.get(image);
    if (state && state.processed === source) return;
    if (state) restore(image);

    if (!image.complete || !image.naturalWidth) {
      if (!image.dataset.cwPixelWait) {
        image.dataset.cwPixelWait = "1";
        const ready = () => {
          delete image.dataset.cwPixelWait;
          if (!destroyed) schedule(image);
        };
        image.addEventListener("load", ready, { once: true });
        image.addEventListener("error", () => { delete image.dataset.cwPixelWait; }, { once: true });
      }
      return;
    }

    const key = keyFor(source, config);
    let processed = cache.get(key);
    if (!processed) {
      let output = null;
      try {
        output = render(image, image.naturalWidth, image.naturalHeight, config);
      } catch {
        output = null;
      }
      if (!output) return;
      processed = output.toDataURL("image/png");
      cache.set(key, processed);
      if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    }

    states.set(image, { original: source, processed });
    image.src = processed;
    image.classList.add("cw-pixelated");
    image.dataset.cwPixelated = "1";
  }

  function schedule(image) {
    if (destroyed || !isChatImage(image)) return;
    queue.add(image);
    if (queueTimer) return;
    // A tiny delay batches the images of a freshly rendered chat and keeps the
    // main thread free while the message DOM is still settling.
    queueTimer = win.setTimeout(() => {
      queueTimer = 0;
      const batch = [...queue];
      queue.clear();
      for (const item of batch) processImage(item);
    }, 40);
  }

  function scan() {
    if (destroyed) return;
    doc.querySelectorAll("#chat .mes_img").forEach(schedule);
  }

  function refresh() {
    if (destroyed) return;
    cache.clear();
    doc.querySelectorAll("#chat .mes_img").forEach(restore);
    if (settings().enabled) scan();
  }

  /** Small sample for the settings panel: a gradient plus two shapes. */
  function preview(canvas) {
    if (!canvas) return;
    const config = settings();
    const width = 240;
    const height = 120;
    const sample = doc.createElement("canvas");
    sample.width = width;
    sample.height = height;
    const context = sample.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, "#171614");
    gradient.addColorStop(0.45, "#d97757");
    gradient.addColorStop(1, "#fbfbfa");
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#1f1f1e";
    context.beginPath();
    context.arc(180, 60, 34, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fbfbfa";
    context.beginPath();
    context.arc(60, 60, 28, 0, Math.PI * 2);
    context.fill();
    render(sample, width, height, config, canvas);
  }

  function start() {
    if (destroyed) return;
    scan();
    observer = new win.MutationObserver(records => {
      for (const record of records) {
        if (record.type === "attributes" && isChatImage(record.target)) {
          const image = record.target;
          if (image.classList.contains("cw-pixelated") && image.src.startsWith("data:image/png")) continue;
          schedule(image);
          continue;
        }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (isChatImage(node)) schedule(node);
          node.querySelectorAll?.("#chat .mes_img").forEach(schedule);
        }
      }
    });
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  const api = {
    refresh,
    preview,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      observer = null;
      win.clearTimeout(queueTimer);
      queueTimer = 0;
      queue.clear();
      doc.querySelectorAll("#chat .mes_img").forEach(restore);
      cache.clear();
      if (win.__claudeImagePixelate === api) delete win.__claudeImagePixelate;
    },
  };

  win.__claudeImagePixelate = api;
  return api;
}

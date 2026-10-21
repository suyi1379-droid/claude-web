/* Chat-image dithering / pixelation.
   Port of Folia's Nomand ImageDithering effect: 8x8 Bayer pixel blocks, a
   configurable number of color steps, original colours, inverted luminance and
   a dark-paper / light-ink palette. Folia drives a Paper shader; this is a
   small Canvas port so Claude Web can stay build-free.

   Only `.mes_img` inside `#chat` and the selected `#bg1` background are
   touched. Avatars, icons and extension UI are left alone. The original src is
   kept per image and restored when the effect is switched off or the extension
   is destroyed. */

const DEFAULTS = Object.freeze({ dot: 3, levels: 4, ink: "#f8f8f6" });
const MAX_SIDE = 2560;
const CACHE_LIMIT = 6;
// Folia's ImageDithering "8x8" Bayer matrix.
const BAYER8 = [
  [ 0, 32, 8, 40, 2, 34, 10, 42 ],
  [ 48, 16, 56, 24, 50, 18, 58, 26 ],
  [ 12, 44, 4, 36, 14, 46, 6, 38 ],
  [ 60, 28, 52, 20, 62, 30, 54, 22 ],
  [ 3, 35, 11, 43, 1, 33, 9, 41 ],
  [ 51, 19, 59, 27, 49, 17, 57, 25 ],
  [ 15, 47, 7, 39, 13, 45, 5, 37 ],
  [ 63, 31, 55, 23, 61, 29, 53, 21 ],
];

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

  const currentInk = darkPaper => {
    const stored = read("pixelInk");
    if (/^#[0-9a-f]{6}$/i.test(stored || "")) return stored;
    // The Folia reference is a dark print: dark paper, light ink. Turning the
    // dark-paper switch off falls back to the theme's ink on the theme surface.
    if (darkPaper) return "#f8f8f6";
    const themed = win.getComputedStyle(doc.documentElement).getPropertyValue("--cl-ink").trim();
    return /^#[0-9a-f]{6}$/i.test(themed) ? themed : "#1f1f1e";
  };

  const settings = () => {
    const css = win.getComputedStyle(doc.documentElement);
    const darkPaper = read("pixelDarkPaper") !== "off";
    return {
      enabled: read("pixelate") === "on",
      // Background processing defaults on; an explicit "off" disables it.
      background: read("pixelBackground") !== "off",
      dot: readNumber("pixelDot", DEFAULTS.dot, 1, 16),
      levels: readNumber("pixelLevels", DEFAULTS.levels, 2, 32),
      color: read("pixelColor") === "on",
      invert: read("pixelInvert") === "on",
      brightness: readNumber("pixelBrightness", 0, -100, 100),
      darkPaper,
      paper: darkPaper ? "#1f1f1e" : (css.getPropertyValue("--cw-surface-page").trim() || "#fbfbfa"),
      ink: currentInk(darkPaper),
    };
  };

  const parseHex = value => {
    const match = /^#([0-9a-f]{6})$/i.exec(String(value || "").trim());
    if (!match) return null;
    const number = parseInt(match[1], 16);
    return [ number >> 16 & 255, number >> 8 & 255, number & 255 ];
  };

  let destroyed = false;
  let observer = null;
  let queueTimer = 0;
  const queue = new Set();
  const states = new WeakMap();   // img -> { original, processed }
  const cache = new Map();
  const backgroundImages = new Map();
  let backgroundState = null;
  let backgroundElement = null;
  let backgroundObserver = null;
  let backgroundTimer = 0;
  let backgroundToken = 0;
  let backgroundResize = null;

  /**
   * Folia-style ordered dithering. Each `dot`-pixel block samples the source,
   * applies the 8x8 Bayer threshold and the selected colour steps, then fills
   * the block with the palette (or the cell colour). The output is opaque:
   * dark areas take the paper colour, bright areas the ink colour.
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
    const block = Math.max(1, Math.round(config.dot * scale));
    const steps = Math.max(1, Math.max(2, config.levels) - 1);
    const paper = parseHex(config.paper) || [ 251, 251, 250 ];
    const ink = parseHex(config.ink) || [ 248, 248, 246 ];
    const rows = Math.ceil(height / block);
    const cols = Math.ceil(width / block);

    for (let row = 0; row < rows; row += 1) {
      const y0 = row * block;
      const y1 = Math.min(height, y0 + block);
      for (let col = 0; col < cols; col += 1) {
        const x0 = col * block;
        const x1 = Math.min(width, x0 + block);
        let r = 0, g = 0, b = 0, alpha = 0, count = 0;

        for (let y = y0; y < y1; y += 1) {
          const pixelRow = y * width;
          for (let x = x0; x < x1; x += 1) {
            const index = (pixelRow + x) * 4;
            const a = pixels[index + 3] / 255;
            r += pixels[index] * a;
            g += pixels[index + 1] * a;
            b += pixels[index + 2] * a;
            alpha += a;
            count += 1;
          }
        }

        const coverage = count ? alpha / count : 0;
        const red = alpha > 0 ? r / alpha : 0;
        const green = alpha > 0 ? g / alpha : 0;
        const blue = alpha > 0 ? b / alpha : 0;
        let lum = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
        if (config.invert) lum = 1 - lum;
        if (config.brightness) lum = Math.min(1, Math.max(0, lum + config.brightness / 200));

        const bayer = (BAYER8[row & 7][col & 7] + 0.5) / 64;
        const tone = Math.min(1, Math.max(0, lum + (bayer - 0.5) / steps));
        const quant = Math.round(tone * steps) / steps;
        // Dark paper: bright cells become ink. Light paper: bright cells stay paper.
        const amount = (config.darkPaper ? quant : 1 - quant) * coverage;

        const rOut = config.color ? paper[0] + (red - paper[0]) * amount : paper[0] + (ink[0] - paper[0]) * amount;
        const gOut = config.color ? paper[1] + (green - paper[1]) * amount : paper[1] + (ink[1] - paper[1]) * amount;
        const bOut = config.color ? paper[2] + (blue - paper[2]) * amount : paper[2] + (ink[2] - paper[2]) * amount;
        context.fillStyle = `rgb(${Math.round(rOut)},${Math.round(gOut)},${Math.round(bOut)})`;
        context.fillRect(x0, y0, block, block);
      }
    }

    return output;
  }

  function keyFor(source, config, displayWidth = 0) {
    return [source, config.dot, config.levels, config.color ? 1 : 0, config.invert ? 1 : 0, config.brightness, config.ink, config.paper, config.darkPaper ? 1 : 0, displayWidth].join("|");
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

    const displayWidth = image.clientWidth || image.naturalWidth || 1;
    const dot = Math.max(1, Math.min(64, config.dot * image.naturalWidth / displayWidth));
    const key = keyFor(source, config, displayWidth);
    let processed = cache.get(key);
    if (!processed) {
      let output = null;
      try {
        output = render(image, image.naturalWidth, image.naturalHeight, { ...config, dot });
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

  function backgroundValue(element) {
    if (!element) return "";
    const inline = element.style.backgroundImage;
    if (inline && inline !== "none") return inline;
    return win.getComputedStyle(element).backgroundImage || "";
  }

  function backgroundUrl(value) {
    const match = value.match(/url\((?:"|')?([^"')]+)(?:"|')?\)/);
    if (!match) return null;
    try { return new win.URL(match[1].trim(), doc.baseURI).href; } catch { return null; }
  }

  function findBackground() {
    const candidates = [ "bg1", "bg_custom", "bg_animation" ]
      .map(id => doc.getElementById(id))
      .filter(Boolean);
    const next = candidates.find(element => backgroundUrl(backgroundValue(element))) || candidates[0] || null;
    if (next !== backgroundElement) {
      backgroundObserver?.disconnect();
      backgroundObserver = null;
      backgroundElement = next;
      if (backgroundElement) {
        backgroundObserver = new win.MutationObserver(() => scheduleBackground());
        backgroundObserver.observe(backgroundElement, { attributes: true, attributeFilter: [ "style", "class" ] });
      }
    }
    return backgroundElement;
  }

  function isProcessedBackground(value) {
    return Boolean(backgroundState?.processed && value.includes(backgroundState.processed));
  }

  function restoreBackground() {
    backgroundToken += 1;
    const state = backgroundState;
    backgroundState = null;
    if (!state?.element?.isConnected) return;
    const current = state.element.style.backgroundImage || "";
    // Leave a background the user picked while we were working alone.
    if (current && !current.includes(state.processed)) return;
    if (state.originalInline) state.element.style.backgroundImage = state.originalInline;
    else state.element.style.removeProperty("background-image");
  }

  function loadBackgroundImage(url) {
    if (backgroundImages.has(url)) return Promise.resolve(backgroundImages.get(url));
    return new Promise(resolve => {
      const image = new win.Image();
      image.onload = () => {
        backgroundImages.set(url, image);
        if (backgroundImages.size > 4) backgroundImages.delete(backgroundImages.keys().next().value);
        resolve(image);
      };
      image.onerror = () => resolve(null);
      image.src = url;
    });
  }

  async function processBackground() {
    if (destroyed) return;
    const config = settings();
    const element = findBackground();
    if (!element || !config.enabled || !config.background) {
      restoreBackground();
      return;
    }

    const value = backgroundValue(element);
    if (!value || value === "none" || isProcessedBackground(value)) return;
    const url = backgroundUrl(value);
    if (!url || /\.gif(?:$|\?)/i.test(url)) return;
    // Same URL selected again: the inline value is the original again, so fall
    // through and re-apply instead of assuming the previous process is current.
    if (backgroundState) restoreBackground();

    const token = ++backgroundToken;
    const source = await loadBackgroundImage(url);
    if (destroyed || token !== backgroundToken || !source?.naturalWidth || !element.isConnected) return;
    // The user may have selected another background while this one was decoding.
    if (backgroundUrl(backgroundValue(element)) !== url) return;

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, win.devicePixelRatio || 1);
    const displayWidth = Math.max(1, Math.round(rect.width * dpr));
    const displayHeight = Math.max(1, Math.round(rect.height * dpr));
    const prepared = doc.createElement("canvas");
    prepared.width = displayWidth;
    prepared.height = displayHeight;
    const preparedContext = prepared.getContext("2d");
    const cover = Math.max(displayWidth / source.naturalWidth, displayHeight / source.naturalHeight);
    const drawWidth = source.naturalWidth * cover;
    const drawHeight = source.naturalHeight * cover;
    const position = win.getComputedStyle(element).backgroundPosition || "0% 0%";
    const parts = position.split(/\s+/);
    const percentage = value => {
      if (value === "center") return 0.5;
      if (value === "right" || value === "bottom") return 1;
      const number = parseFloat(value);
      return Number.isFinite(number) ? number / 100 : 0;
    };
    preparedContext.drawImage(
      source,
      (displayWidth - drawWidth) * percentage(parts[0]),
      (displayHeight - drawHeight) * percentage(parts[1] || "0%"),
      drawWidth,
      drawHeight,
    );

    let output = null;
    try {
      // One dither block per `dot` CSS pixels; dpr keeps the pattern crisp on retina.
      output = render(prepared, displayWidth, displayHeight, { ...config, dot: Math.max(1, Math.round(config.dot * dpr)) });
    } catch {
      output = null;
    }
    if (!output || destroyed || token !== backgroundToken) return;

    const dataUrl = output.toDataURL("image/png");
    const originalInline = element.style.backgroundImage || "";
    const nextValue = value.replace(/url\((?:"|')?[^"')]+(?:"|')?\)/, `url("${dataUrl}")`);
    backgroundState = { element, source: url, originalInline, processed: dataUrl };
    element.style.backgroundImage = nextValue;
  }

  function scheduleBackground(delay = 120) {
    if (destroyed) return;
    win.clearTimeout(backgroundTimer);
    backgroundTimer = win.setTimeout(() => {
      backgroundTimer = 0;
      void processBackground();
    }, delay);
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
    const config = settings();
    if (!config.enabled) {
      restoreBackground();
      return;
    }
    scan();
    // Drop the previous processed background first; otherwise processBackground
    // sees its own data URL and thinks the new settings are already applied.
    restoreBackground();
    if (config.background) scheduleBackground(0);
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
    findBackground();
    if (settings().enabled && settings().background) scheduleBackground(0);


    let lastWidth = win.innerWidth;
    backgroundResize = () => {
      if (win.innerWidth === lastWidth) return;
      lastWidth = win.innerWidth;
      scheduleBackground(300);
    };
    win.addEventListener("resize", backgroundResize);

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
          if (node.id === "bg1" || node.id === "bg_custom" || node.id === "bg_animation" || node.querySelector?.("#bg1,#bg_custom,#bg_animation")) {
            findBackground();
            scheduleBackground();
          }
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
      restoreBackground();
      backgroundObserver?.disconnect();
      backgroundObserver = null;
      win.clearTimeout(backgroundTimer);
      backgroundTimer = 0;
      if (backgroundResize) {
        win.removeEventListener("resize", backgroundResize);
        backgroundResize = null;
      }
      backgroundImages.clear();
      if (win.__claudeImagePixelate === api) delete win.__claudeImagePixelate;
    },
  };

  win.__claudeImagePixelate = api;
  return api;
}

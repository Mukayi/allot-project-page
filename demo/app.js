/* A static viewer for paired, measured outputs. Video time and denoising step
   are deliberately separate; the latter is a model execution schedule. */
(() => {
  'use strict';
  const data = window.ALLOT_DEMO_DATA;
  const $ = id => document.getElementById(id);
  const siteRoot = new URL('../', document.baseURI);
  const resolveMediaPath = path => new URL(path, siteRoot).href;
  if (!data?.settings?.length) {
    $('loading').textContent = 'The demo data could not be loaded. Serve this folder with a local HTTP server.';
    return;
  }
  const arms = ['dense', 'default', 'allot'];
  const videos = Object.fromEntries(arms.map(arm => [arm, $(`video-${arm}`)]));
  const labels = { dense: 'Dense reference', default: 'Default', allot: '+ ALLOT' };
  const pairs = { 'default-allot': ['default', 'allot'], 'dense-allot': ['dense', 'allot'], 'dense-default': ['dense', 'default'] };
  const state = { setting: null, sample: null, pair: 'default-allot', ready: false,
    playing: false, frame: 0, token: 0, seekToken: 0, details: false,
    focus: [0.5, 0.5], dragging: false, step: 0, hover: null, heatRect: null,
    heatReveal: 1, heatToken: 0, barKey: null, barValues: null, barToken: 0,
    wipeHinted: false, wipeTouched: false, stageSeen: false };
  const clamp = (number, low, high) => Math.min(high, Math.max(low, number));
  const fixed = (number, digits = 2) => Number(number).toFixed(digits);
  const pad = number => String(number).padStart(2, '0');
  const signed = number => `${number >= 0 ? '+' : '−'}${fixed(Math.abs(number))}`;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const easeOut = t => 1 - Math.pow(1 - t, 4);

  function tweenText(el, to, format, duration = 650) {
    const from = Number(el.dataset.value);
    el.dataset.value = to;
    if (reduceMotion || !Number.isFinite(from)) { el.textContent = format(to); return; }
    const id = (el.tweenId = (el.tweenId || 0) + 1);
    let start = null;
    const step = now => {
      if (el.tweenId !== id) return;
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / duration);
      el.textContent = format(from + (to - from) * easeOut(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function placeThumb() {
    const group = document.querySelector('.segmented');
    const thumb = group?.querySelector('.seg-thumb');
    const active = group?.querySelector('[aria-pressed="true"]');
    if (!thumb || !active) return;
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.top = `${active.offsetTop}px`;
    thumb.style.bottom = 'auto';
    thumb.style.width = `${active.offsetWidth}px`;
    thumb.style.height = `${active.offsetHeight}px`;
    group.classList.add('has-thumb');
  }

  function setRangeFill(input) {
    const amount = 100 * (Number(input.value) - Number(input.min || 0)) / (Number(input.max || 100) - Number(input.min || 0));
    input.style.setProperty('--fill', `${amount}%`);
  }

  function updateTransport() {
    $('play').innerHTML = state.playing ? 'Ⅱ <span>Pause</span>' : '▶ <span>Play</span>';
    $('play').setAttribute('aria-label', state.playing ? 'Pause all videos' : 'Play all videos together');
    $('play').disabled = !state.ready;
    $('previous-frame').disabled = !state.ready;
    $('next-frame').disabled = !state.ready;
    $('timeline').disabled = !state.ready;
    $('timeline').value = state.frame;
    $('frame-label').textContent = `${pad(state.frame + 1)} / ${state.sample?.video.frames || 81}`;
    setRangeFill($('timeline'));
  }

  function pause() {
    state.playing = false;
    arms.forEach(arm => videos[arm].pause());
    updateTransport();
  }

  function waitForMedia(video) {
    return new Promise((resolve, reject) => {
      if (video.readyState >= 2) return resolve();
      let timer;
      const clean = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', done);
        video.removeEventListener('error', fail);
      };
      const done = () => { clean(); resolve(); };
      const fail = () => { clean(); reject(new Error('A video could not be loaded. Check that the media folder is available.')); };
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', fail, { once: true });
      timer = setTimeout(() => { clean(); reject(new Error('Video loading timed out. Reload the page or choose another prompt.')); }, 25000);
    });
  }

  function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.00001 && video.readyState >= 2) return resolve();
      let timer;
      const clean = () => { clearTimeout(timer); video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
      const done = () => { clean(); resolve(); };
      const fail = () => { clean(); reject(new Error('This video frame could not be read.')); };
      video.addEventListener('seeked', done, { once: true });
      video.addEventListener('error', fail, { once: true });
      timer = setTimeout(() => { clean(); reject(new Error('Frame seeking timed out. Try another frame or prompt.')); }, 8000);
      video.currentTime = time;
    });
  }

  function showError(error) {
    $('loading').hidden = true;
    $('video-error').textContent = error.message;
    $('video-error').hidden = false;
    pause();
  }

  async function seek(frame) {
    if (!state.ready) return;
    pause();
    const generation = ++state.seekToken;
    const token = state.token;
    state.frame = clamp(Math.round(frame), 0, state.sample.video.frames - 1);
    updateTransport();
    // A tiny positive offset selects the requested frame at its timestamp,
    // avoiding rounding just below a frame boundary in a media decoder.
    const time = state.frame / state.sample.video.fps + 0.00001;
    try {
      await Promise.all(arms.map(arm => seekVideo(videos[arm], time)));
      if (generation !== state.seekToken || token !== state.token) return;
      drawDetails();
    } catch (error) {
      if (generation === state.seekToken && token === state.token) showError(error);
    }
  }

  async function togglePlayback() {
    if (!state.ready) return;
    if (state.playing) return pause();
    const token = state.token;
    if (state.frame >= state.sample.video.frames - 1) await seek(0);
    if (token !== state.token || !state.ready) return;
    state.playing = true;
    updateTransport();
    try {
      await Promise.all(arms.map(arm => videos[arm].play()));
      if (token !== state.token) return;
    } catch (error) {
      if (token === state.token) showError(new Error('Playback could not start. Try the Play button again.'));
    }
  }

  function setPair(pair) {
    state.pair = pair;
    const [left, right] = pairs[pair];
    arms.forEach(arm => {
      const video = videos[arm];
      // A video moving from the revealed side to the base must lose its old
      // inline crop; otherwise the base also crops away the opposite half.
      video.style.clipPath = 'none';
      video.style.webkitClipPath = 'none';
      video.className = arm === left ? 'reveal' : arm === right ? 'base' : '';
    });
    $('left-label').textContent = labels[left];
    $('right-label').textContent = labels[right];
    $('wipe-left').textContent = labels[left];
    $('wipe-right').textContent = labels[right];
    document.querySelectorAll('[data-pair]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pair === pair)));
    placeThumb();
    setWipe(Number($('wipe').value));
  }

  function setWipe(amount) {
    const value = clamp(amount, 0, 100);
    $('wipe').value = value;
    const [left] = pairs[state.pair];
    const crop = `inset(0 ${100 - value}% 0 0)`;
    videos[left].style.clipPath = crop;
    videos[left].style.webkitClipPath = crop;
    $('split-line').style.left = `${value}%`;
  }

  function updateFacts() {
    const setting = state.setting, sample = state.sample;
    $('comparison-heading').textContent = `${setting.strategy} · ${setting.resolution}`;
    $('sample-prompt').textContent = `“${sample.prompt}”`;
    tweenText($('default-psnr'), sample.psnr.default, value => `${fixed(value)} dB`);
    tweenText($('allot-psnr'), sample.psnr.allot, value => `${fixed(value)} dB`);
    tweenText($('clip-gain'), sample.psnr.allot - sample.psnr.default, value => `${signed(value)} dB`);
    $('wallclock').textContent = `${fixed(setting.times.default, 1)} → ${fixed(setting.times.allot, 1)} s`;
    $('selection-note').textContent = sample.id === setting.featured ? 'Featured: nearest the median paired PSNR gain.' : `Prompt ${pad(sample.id + 1)} of 32 · same prompt and seed in all three results.`;
    $('table-setting').textContent = `${setting.strategy} · ${setting.resolution}`;
    $('dense-count').textContent = setting.density.flat().filter(value => value >= 0.999999).length.toLocaleString();
    $('experiment-details').textContent = `${setting.model} · ${setting.resolution} · 81 frames · 50 denoising steps · seed 0. ${setting.citation}. Mean paired PSNR gain across the 32 prompts: ${signed(setting.meanGain)} dB; median: ${signed(setting.medianGain)} dB. The time card uses measured wall-clock times for the configuration, rather than individual generation logs. Changing the prompt reuses the same ALLOT density table. Videos are prerecorded; the page does not run inference.`;
    $('stage').style.aspectRatio = `${sample.video.width} / ${sample.video.height}`;
    $('timeline').max = sample.video.frames - 1;
    updateTransport();
  }

  async function chooseSample(id) {
    pause();
    const token = ++state.token;
    ++state.seekToken;
    state.ready = false;
    state.frame = 0;
    state.sample = state.setting.samples.find(sample => sample.id === Number(id));
    state.focus = [...state.sample.focus];
    $('sample-select').value = state.sample.id;
    $('loading').hidden = false;
    $('video-error').hidden = true;
    updateFacts();
    setPair(state.pair);
    drawDensity();
    for (const arm of arms) {
      const video = videos[arm];
      video.src = resolveMediaPath(state.sample.media[arm]);
      video.poster = resolveMediaPath(state.sample.posters[arm]);
      video.preload = 'auto';
      video.playbackRate = Number($('speed').value);
      video.load();
    }
    try {
      await Promise.all(arms.map(arm => waitForMedia(videos[arm])));
      if (token !== state.token) return;
      state.ready = true;
      $('loading').hidden = true;
      updateTransport();
      drawDetails();
      hintWipe();
    } catch (error) {
      if (token === state.token) showError(error);
    }
  }

  async function chooseSetting(id) {
    state.setting = data.settings.find(setting => setting.id === id);
    state.hover = null;
    $('sample-select').replaceChildren();
    for (const sample of state.setting.samples) {
      const option = document.createElement('option');
      option.value = sample.id;
      option.textContent = `${pad(sample.id + 1)} · ${sample.prompt}`;
      $('sample-select').append(option);
    }
    document.querySelectorAll('[data-setting]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.setting === id)));
    const loading = chooseSample(state.setting.featured);
    if ($('allocation-details').open) animateHeat();
    await loading;
  }

  function drawDetails() {
    if (!state.details || !state.ready) return;
    const { width, height } = state.sample.video;
    const cropW = width / 4, cropH = height / 4;
    const x = clamp(state.focus[0] * width - cropW / 2, 0, width - cropW);
    const y = clamp(state.focus[1] * height - cropH / 2, 0, height - cropH);
    $('focus-box').style.left = `${100 * x / width}%`;
    $('focus-box').style.top = `${100 * y / height}%`;
    for (const arm of arms) {
      const canvas = $(`detail-${arm}`);
      const expectedHeight = Math.round(560 * height / width);
      if (canvas.height !== expectedHeight) canvas.height = expectedHeight;
      if (videos[arm].readyState >= 2) canvas.getContext('2d').drawImage(videos[arm], x, y, cropW, cropH, 0, 0, canvas.width, canvas.height);
    }
  }

  function setFocus(event) {
    const rect = $('stage').getBoundingClientRect();
    state.focus = [clamp((event.clientX - rect.left) / rect.width, 0, 1), clamp((event.clientY - rect.top) / rect.height, 0, 1)];
    drawDetails();
  }

  function densityColor(value) {
    const progress = clamp((value - 0.05) / 0.95, 0, 1);
    const low = [227, 238, 231], high = [37, 89, 66];
    return `rgb(${low.map((v, i) => Math.round(v + (high[i] - v) * progress)).join(',')})`;
  }

  function drawDensity() {
    if (!state.setting) return;
    const canvas = $('heatmap');
    const displayWidth = canvas.getBoundingClientRect().width || 550;
    const displayHeight = displayWidth * 590 / 1100;
    const ratio = window.devicePixelRatio || 1;
    const expectedWidth = Math.round(displayWidth * ratio), expectedHeight = Math.round(displayHeight * ratio);
    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) { canvas.width = expectedWidth; canvas.height = expectedHeight; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    const rect = { x: 29, y: 7, width: displayWidth - 39, height: displayHeight - 42 };
    state.heatRect = rect;
    const cellW = rect.width / 50, cellH = rect.height / 30;
    for (let step = 0; step < 50; step++) {
      const shown = clamp(state.heatReveal * 50 - step, 0, 1);
      if (!shown) continue;
      ctx.globalAlpha = shown;
      for (let layer = 0; layer < 30; layer++) {
        ctx.fillStyle = densityColor(state.setting.density[step][layer]);
        ctx.fillRect(rect.x + step * cellW, rect.y + layer * cellH, cellW + 0.25, cellH + 0.25);
      }
    }
    ctx.globalAlpha = 1;
    // An outer dark border and inner white border keep the active column
    // visible on both sparse and dense cells.
    ctx.strokeStyle = '#123725'; ctx.lineWidth = 2.5;
    ctx.strokeRect(rect.x + state.step * cellW, rect.y, cellW, rect.height);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
    ctx.strokeRect(rect.x + state.step * cellW + 1.2, rect.y + 1.2, Math.max(1, cellW - 2.4), rect.height - 2.4);
    ctx.fillStyle = '#123725';
    ctx.fillRect(rect.x + state.step * cellW - 1, 0, cellW + 2, 4);
    ctx.fillStyle = '#6b776d'; ctx.font = '9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const layer of [0, 10, 20, 29]) ctx.fillText(String(layer), rect.x - 7, rect.y + (layer + 0.5) * cellH);
    ctx.textAlign = 'center';
    for (const step of [0, 25, 49]) ctx.fillText(String(step), rect.x + (step + 0.5) * cellW, rect.y + rect.height + 13);
    ctx.fillText('Denoising step', rect.x + rect.width / 2, rect.y + rect.height + 29);
    if (state.hover) {
      const { step, layer } = state.hover;
      ctx.strokeStyle = '#131f17'; ctx.lineWidth = 1.2;
      ctx.strokeRect(rect.x + step * cellW, rect.y + layer * cellH, cellW, cellH);
      $('cell-reading').textContent = `Step ${pad(step)} · Layer ${pad(layer)} · ${fixed(state.setting.density[step][layer] * 100, 1)}%`;
    } else {
      $('cell-reading').textContent = `Step ${pad(state.step)} · Layer 00 · ${fixed(state.setting.density[state.step][0] * 100, 1)}%`;
    }
    $('step-label').textContent = pad(state.step);
    const average = state.setting.density[state.step].reduce((a, b) => a + b, 0) / 30;
    $('step-density').textContent = `Mean density ${fixed(average * 100, 1)}%`;
    drawStepDensities();
  }

  function animateHeat() {
    const id = ++state.heatToken;
    if (reduceMotion || !$('allocation-details').open) { state.heatReveal = 1; drawDensity(); return; }
    let start = null;
    const frame = now => {
      if (id !== state.heatToken) return;
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / 1000);
      state.heatReveal = easeOut(p);
      drawDensity();
      if (p < 1) requestAnimationFrame(frame);
    };
    state.heatReveal = 0;
    requestAnimationFrame(frame);
  }

  function drawStepDensities() {
    const target = state.setting.density[state.step];
    const key = `${state.setting.id}:${state.step}`;
    if (state.barKey !== key) {
      state.barKey = key;
      const from = state.barValues;
      const id = ++state.barToken;
      if (reduceMotion || !from) state.barValues = target.slice();
      else {
        let start = null;
        const frame = now => {
          if (id !== state.barToken) return;
          if (start === null) start = now;
          const p = Math.min(1, (now - start) / 280);
          state.barValues = from.map((value, layer) => value + (target[layer] - value) * easeOut(p));
          paintStepBars(state.barValues);
          if (p < 1) requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }
    }
    paintStepBars(state.barValues);
    $('active-step-heading').textContent = `Step ${pad(state.step)} · density of each layer`;
    $('active-step-range').textContent = `Range ${fixed(Math.min(...target) * 100, 1)}–${fixed(Math.max(...target) * 100, 1)}%`;
  }

  function paintStepBars(values) {
    const canvas = $('step-density-bars');
    const width = canvas.getBoundingClientRect().width || 550;
    const height = Math.max(105, width * 210 / 1100);
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio), pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth; canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const plot = { x: 33, y: 8, width: width - 42, height: height - 33 };
    const cellWidth = plot.width / 30;
    ctx.font = '9px Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const density of [0, 0.5, 1]) {
      const y = plot.y + plot.height * (1 - density);
      ctx.fillStyle = '#e2e7df'; ctx.fillRect(plot.x, y, plot.width, 0.7);
      ctx.fillStyle = '#6b776d'; ctx.fillText(`${density * 100}%`, plot.x - 6, y);
    }
    values.forEach((density, layer) => {
      const x = plot.x + layer * cellWidth + 1;
      ctx.fillStyle = '#eef2eb';
      ctx.fillRect(x, plot.y, Math.max(1, cellWidth - 2), plot.height);
      ctx.fillStyle = densityColor(density);
      ctx.fillRect(x, plot.y + plot.height * (1 - density), Math.max(1, cellWidth - 2), Math.max(1, plot.height * density));
    });
    ctx.fillStyle = '#6b776d'; ctx.textAlign = 'center';
    for (const layer of [0, 5, 10, 15, 20, 25, 29]) {
      ctx.fillText(String(layer), plot.x + (layer + 0.5) * cellWidth, plot.y + plot.height + 12);
    }
  }

  function hintWipe() {
    if (state.wipeHinted || state.wipeTouched || reduceMotion || !state.ready || !state.stageSeen) return;
    state.wipeHinted = true;
    const keys = [[0, 50], [0.35, 36], [0.7, 62], [1, 50]];
    let start = null;
    const frame = now => {
      if (state.wipeTouched) return;
      if (start === null) start = now + 350;
      const t = clamp((now - start) / 1800, 0, 1);
      const i = keys.findIndex(([at]) => at >= t);
      const [t0, v0] = keys[Math.max(0, i - 1)], [t1, v1] = keys[Math.max(0, i)];
      const local = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      const eased = local < 0.5 ? 2 * local * local : 1 - Math.pow(-2 * local + 2, 2) / 2;
      setWipe(v0 + (v1 - v0) * eased);
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function inspectCell(event) {
    const bounds = $('heatmap').getBoundingClientRect(), grid = state.heatRect;
    if (!grid) return;
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    if (x < grid.x || y < grid.y || x >= grid.x + grid.width || y >= grid.y + grid.height) state.hover = null;
    else state.hover = { step: Math.floor((x - grid.x) / grid.width * 50), layer: Math.floor((y - grid.y) / grid.height * 30) };
    drawDensity();
  }

  document.querySelectorAll('[data-results]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-results]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.results === button.dataset.results)));
    document.querySelectorAll('[data-result-panel]').forEach(panel => { panel.hidden = panel.dataset.resultPanel !== button.dataset.results; });
  }));
  $('copy-citation').addEventListener('click', async () => {
    const button = $('copy-citation');
    const text = $('bibtex').textContent;
    try {
      if (window.navigator?.clipboard?.writeText) await window.navigator.clipboard.writeText(text);
      else {
        const field = document.createElement('textarea');
        field.value = text; field.style.position = 'fixed'; field.style.left = '-9999px';
        document.body.append(field); field.select();
        const copied = document.execCommand('copy'); field.remove();
        if (!copied) throw new Error('Copy unavailable');
      }
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = 'Copy citation'; }, 2000);
    } catch (error) {
      button.textContent = 'Select the citation to copy';
      $('bibtex').focus();
    }
  });

  $('play').addEventListener('click', togglePlayback);
  $('previous-frame').addEventListener('click', () => seek(state.frame - 1));
  $('next-frame').addEventListener('click', () => seek(state.frame + 1));
  $('timeline').addEventListener('input', event => seek(Number(event.target.value)));
  $('sample-select').addEventListener('change', event => chooseSample(event.target.value));
  $('featured').addEventListener('click', () => chooseSample(state.setting.featured));
  $('wipe').addEventListener('input', event => { state.wipeTouched = true; setWipe(Number(event.target.value)); });
  $('speed').addEventListener('change', event => arms.forEach(arm => { videos[arm].playbackRate = Number(event.target.value); }));
  $('detail-toggle').addEventListener('click', () => {
    state.details = !state.details;
    $('detail-toggle').setAttribute('aria-expanded', String(state.details));
    $('detail-panel').hidden = !state.details;
    $('focus-box').hidden = !state.details;
    drawDetails();
  });
  document.querySelectorAll('[data-pair]').forEach(button => button.addEventListener('click', () => setPair(button.dataset.pair)));
  $('stage').addEventListener('pointermove', event => {
    if (state.dragging) {
      const rect = $('stage').getBoundingClientRect();
      setWipe(100 * (event.clientX - rect.left) / rect.width);
    } else if (state.details) setFocus(event);
  });
  $('stage').addEventListener('pointerdown', event => { if (state.details && !state.dragging) setFocus(event); });
  const handle = $('split-line').querySelector('span');
  handle.addEventListener('pointerdown', event => {
    state.dragging = true; state.wipeTouched = true;
    $('stage').classList.add('dragging');
    $('stage').setPointerCapture(event.pointerId); event.preventDefault();
  });
  const endDrag = () => { state.dragging = false; $('stage').classList.remove('dragging'); };
  $('stage').addEventListener('pointerup', endDrag);
  $('stage').addEventListener('pointercancel', endDrag);
  $('heatmap').addEventListener('pointermove', inspectCell);
  $('heatmap').addEventListener('pointerdown', event => {
    inspectCell(event);
    if (state.hover) {
      state.step = state.hover.step;
      $('denoising-step').value = state.step;
      drawDensity();
    }
  });
  $('heatmap').addEventListener('pointerleave', () => { state.hover = null; drawDensity(); });
  $('denoising-step').addEventListener('input', event => { state.step = Number(event.target.value); state.hover = null; drawDensity(); });
  $('allocation-details').addEventListener('toggle', () => { if ($('allocation-details').open) animateHeat(); else drawDensity(); });
  window.addEventListener('resize', () => { drawDensity(); drawDetails(); placeThumb(); });
  document.fonts?.ready?.then(placeThumb);
  document.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    else if (event.code === 'ArrowLeft') { event.preventDefault(); seek(state.frame - 1); }
    else if (event.code === 'ArrowRight') { event.preventDefault(); seek(state.frame + 1); }
  });
  videos.allot.addEventListener('ended', () => { pause(); seek(state.sample.video.frames - 1); });

  function tick() {
    if (state.playing && state.ready) {
      const time = videos.allot.currentTime;
      const frame = clamp(Math.floor(time * state.sample.video.fps), 0, state.sample.video.frames - 1);
      // The ALLOT stream is the master even when it is hidden. Correct drift
      // larger than half a frame; explicit frame seeking waits for all streams.
      for (const arm of ['dense', 'default']) {
        if (!videos[arm].seeking && Math.abs(videos[arm].currentTime - time) > 0.5 / state.sample.video.fps) videos[arm].currentTime = time;
      }
      if (frame !== state.frame) { state.frame = frame; updateTransport(); drawDetails(); }
    }
    requestAnimationFrame(tick);
  }

  for (const setting of data.settings) {
    const featured = setting.samples.find(sample => sample.id === setting.featured);
    const button = document.createElement('button');
    button.className = 'setting-tab'; button.dataset.setting = setting.id;
    button.setAttribute('aria-pressed', 'false');
    const image = document.createElement('img'); image.src = resolveMediaPath(featured.posters.allot); image.alt = ''; image.loading = 'lazy';
    const text = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `${setting.strategy} · ${setting.resolution}`;
    const subtitle = document.createElement('small'); subtitle.textContent = `${setting.model} · 32 paired prompts`;
    text.append(title, subtitle);
    const arrow = document.createElement('span'); arrow.className = 'tab-arrow'; arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
    button.append(image, text, arrow);
    button.addEventListener('click', () => chooseSetting(setting.id));
    $('setting-tabs').append(button);
  }
  const revealTargets = Array.from(document.querySelectorAll('.rise'));
  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        revealObserver.unobserve(el);
        el.classList.add('in');
        const settle = () => el.classList.remove('rise', 'in');
        el.addEventListener('transitionend', event => { if (event.target === el && event.propertyName === 'opacity') settle(); });
        setTimeout(settle, 2000);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    revealTargets.forEach(el => revealObserver.observe(el));
    const stageObserver = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      stageObserver.disconnect();
      state.stageSeen = true;
      hintWipe();
    }, { threshold: 0.6 });
    stageObserver.observe($('stage'));
  } else {
    revealTargets.forEach(el => el.classList.remove('rise'));
    state.stageSeen = true;
  }

  chooseSetting(data.settings[0].id);
  requestAnimationFrame(tick);
})();

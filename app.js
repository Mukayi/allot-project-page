(() => {
  const videos = Array.from(document.querySelectorAll('.video-pair video'));
  const toggle = document.querySelector('#comparison-toggle');
  const progress = document.querySelector('#comparison-progress');
  const bibtex = document.querySelector('#bibtex');
  const copyButton = document.querySelector('#copy-citation');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DRIFT_THRESHOLD_SECONDS = 0.08;

  const tween = (el, to, format, duration = 1400) => {
    if (reduceMotion) {
      el.textContent = format(to);
      return;
    }
    let start = null;
    const ease = t => 1 - Math.pow(1 - t, 4);
    const step = now => {
      if (start === null) start = now;
      const p = Math.min(1, (now - start) / duration);
      el.textContent = format(to * ease(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const runCounts = root => {
    root.querySelectorAll('[data-count]').forEach(el => {
      const digits = Number(el.dataset.dec || 0);
      const prefix = el.dataset.prefix || '';
      tween(el, Number(el.dataset.count), v => prefix + v.toFixed(digits));
    });
  };

  const settle = el => {
    const done = () => el.classList.remove('rise', 'in');
    el.addEventListener('transitionend', event => {
      if (event.target === el && event.propertyName === 'opacity') done();
    });
    window.setTimeout(done, 2000);
  };

  const revealTargets = Array.from(document.querySelectorAll('.rise'));
  if ('IntersectionObserver' in window && !reduceMotion) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        revealObserver.unobserve(el);
        el.classList.add('in');
        runCounts(el);
        settle(el);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealTargets.forEach(el => revealObserver.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.remove('rise'));
  }

  if (videos.length >= 2 && toggle) {
    const [leader, follower] = videos;
    let restarting = false;

    const isPlaying = () => videos.some(video => !video.paused && !video.ended);

    const updateToggle = () => {
      const playing = isPlaying();
      toggle.setAttribute('aria-pressed', playing ? 'true' : 'false');
      toggle.textContent = playing ? 'Pause comparison' : 'Play comparison';
    };

    const alignFollower = () => {
      if (Math.abs(leader.currentTime - follower.currentTime) > DRIFT_THRESHOLD_SECONDS) {
        try {
          follower.currentTime = leader.currentTime;
        } catch (_) {
          // Ignore seek errors before media metadata is ready.
        }
      }
    };

    const playBoth = async () => {
      if (leader.ended || follower.ended) {
        leader.currentTime = 0;
        follower.currentTime = 0;
      } else {
        alignFollower();
      }
      try {
        await Promise.all(videos.map(video => video.play()));
      } catch (_) {
        videos.forEach(video => video.pause());
      }
      updateToggle();
    };

    const pauseBoth = () => {
      videos.forEach(video => video.pause());
      alignFollower();
      updateToggle();
    };

    const restartBoth = async () => {
      if (restarting) {
        return;
      }
      restarting = true;
      videos.forEach(video => {
        video.pause();
        video.currentTime = 0;
      });
      try {
        await Promise.all(videos.map(video => video.play()));
      } catch (_) {
        videos.forEach(video => video.pause());
      }
      restarting = false;
      updateToggle();
    };

    toggle.addEventListener('click', () => {
      if (isPlaying()) {
        pauseBoth();
      } else {
        playBoth();
      }
    });

    leader.addEventListener('timeupdate', alignFollower);
    leader.addEventListener('seeking', alignFollower);
    videos.forEach(video => {
      video.addEventListener('play', updateToggle);
      video.addEventListener('pause', updateToggle);
      video.addEventListener('ended', restartBoth);
      video.addEventListener('click', () => toggle.click());
    });

    updateToggle();

    if (progress) {
      const bar = progress.querySelector('span');
      const fraction = () => (leader.duration > 0 ? Math.min(1, leader.currentTime / leader.duration) : 0);
      const paint = () => {
        const value = fraction();
        bar.style.transform = `scaleX(${value})`;
        progress.setAttribute('aria-valuenow', String(Math.round(value * 100)));
      };
      const loop = () => {
        paint();
        if (isPlaying()) requestAnimationFrame(loop);
      };
      const seekTo = value => {
        if (!(leader.duration > 0)) return;
        const time = Math.min(1, Math.max(0, value)) * leader.duration;
        videos.forEach(video => {
          try {
            video.currentTime = time;
          } catch (_) {
            // Ignore seek errors before media metadata is ready.
          }
        });
        paint();
      };
      leader.addEventListener('play', () => requestAnimationFrame(loop));
      ['seeked', 'timeupdate', 'loadedmetadata'].forEach(name => leader.addEventListener(name, paint));
      progress.addEventListener('click', event => {
        const rect = progress.getBoundingClientRect();
        seekTo((event.clientX - rect.left) / rect.width);
      });
      progress.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          seekTo(fraction() + (event.key === 'ArrowRight' ? 0.05 : -0.05));
        }
      });
    }
  }

  const initMethodViz = () => {
    const viz = document.querySelector('#method-viz');
    if (viz) {
      const svg = viz.querySelector('.vz');
      const caption = viz.querySelector('.viz-cap');
      const stepButtons = Array.from(viz.querySelectorAll('.viz-step'));
      const playButton = viz.querySelector('.viz-play');
      const setting = window.ALLOT_DEMO_DATA?.settings?.find(item => item.id === 'xattention-480');
      const STEPS = 50, LAYERS = 30;
      const grid = { x: 50, y: 34, w: 11, h: 8 };
      const panel = 650;

      const densityColor = value => {
        const t = Math.min(1, Math.max(0, (value - 0.05) / 0.95));
        const low = [227, 238, 231], high = [37, 89, 66];
        return `rgb(${low.map((v, i) => Math.round(v + (high[i] - v) * t)).join(',')})`;
      };
      const v = (n, delay = 0) => ` data-v="${n}"${delay ? ` style="--d:${delay}ms"` : ''}`;

      const cells = [];
      for (let step = 0; step < STEPS; step++) {
        for (let layer = 0; layer < LAYERS; layer++) {
          const value = setting ? setting.density[step][layer] : null;
          const color = value === null ? 'var(--surface-strong)' : densityColor(value);
          cells.push(`<rect class="cell" x="${grid.x + step * grid.w}" y="${grid.y + layer * grid.h}" width="${grid.w - 1}" height="${grid.h - 1}" style="--c:${color};--d1:${step * 22 + layer * 3}ms;--d3:${step * 16}ms"/>`);
        }
      }
      const gridRight = grid.x + STEPS * grid.w, gridBottom = grid.y + LAYERS * grid.h;
      const axes = `
        <text x="${grid.x}" y="22" class="vb">Layer × denoising-step cells (50 × 30)</text>
        <text x="${grid.x - 8}" y="${grid.y + 7}" text-anchor="end">0</text>
        <text x="${grid.x - 8}" y="${gridBottom}" text-anchor="end">29</text>
        <text transform="translate(${grid.x - 30} ${grid.y + 120}) rotate(-90)" text-anchor="middle">Layer</text>
        ${[0, 25, 49].map(step => `<text x="${grid.x + (step + 0.5) * grid.w}" y="${gridBottom + 16}" text-anchor="middle">${step}</text>`).join('')}
        <text x="${(grid.x + gridRight) / 2}" y="${gridBottom + 32}" text-anchor="middle">Denoising step →</text>`;

      const plotBox = `<path class="vax" d="M${panel + 10} 70 V210 H${panel + 220}"/>`;
      const stepOne = `<g${v(1)}>
          <rect class="probe probe-sweep" x="${grid.x - 0.5}" y="${grid.y - 3}" width="${grid.w}" height="${LAYERS * grid.h + 6}"/>
          <text x="${panel}" y="46" class="vt">Cell probing</text>
          ${plotBox}
          <text transform="translate(${panel} 140) rotate(-90)" text-anchor="middle">one-step error</text>
          <text x="${panel + 115}" y="226" text-anchor="middle">density →</text>
          <text x="${panel}" y="254">Sparsify one cell at candidate densities</text>
          <text x="${panel}" y="270">on a few probing videos.</text>
        </g>
        <path${v(1, 150)} class="curve" stroke="var(--accent)" d="M${panel + 16} 78 C ${panel + 60} 170, ${panel + 120} 196, ${panel + 214} 202"/>
        <path${v(1, 450)} class="curve" stroke="#6f9a83" d="M${panel + 16} 132 C ${panel + 70} 184, ${panel + 130} 198, ${panel + 214} 204"/>
        <path${v(1, 750)} class="curve" stroke="#b8c9bb" d="M${panel + 16} 170 C ${panel + 80} 194, ${panel + 140} 202, ${panel + 214} 206"/>
        <text${v(1, 1100)} x="${panel + 52}" y="96" class="vb">sensitive cell</text>
        <text${v(1, 1300)} x="${panel + 20}" y="199">robust cell</text>`;

      const points = [[0.06, 0.1], [0.16, 0.2], [0.27, 0.24], [0.38, 0.41], [0.5, 0.47], [0.6, 0.63], [0.72, 0.68], [0.84, 0.86], [0.94, 0.9]];
      const px = t => panel + 16 + t * 196, py = t => 204 - t * 126;
      const stepTwo = `<g${v(2)}>
          <text x="${panel}" y="46" class="vt">Trajectory calibration</text>
          ${plotBox}
          <text transform="translate(${panel} 140) rotate(-90)" text-anchor="middle">final-video error</text>
          <text x="${panel + 115}" y="226" text-anchor="middle">predicted from probes →</text>
          <text x="${panel}" y="254">Sparsify short step windows, measure the</text>
          <text x="${panel}" y="270">final video, calibrate the propagation.</text>
          <path class="flow" d="M${gridRight + 4} ${grid.y + 120} H${panel - 8}"/>
        </g>
        ${[0, 1, 2, 3, 4].map(k => `<rect${v(2, k * 140)} class="window" x="${grid.x + k * 10 * grid.w - 1}" y="${grid.y - 5}" width="${5 * grid.w + 1}" height="${LAYERS * grid.h + 9}"/>`).join('')}
        ${points.map(([a, b], i) => `<circle${v(2, 500 + i * 90)} class="pt" cx="${px(a)}" cy="${py(b)}" r="3.4"/>`).join('')}
        <path${v(2, 1400)} class="fit" d="M${px(0)} ${py(0.02)} L${px(1)} ${py(0.98)}"/>`;

      const ratio = setting ? setting.times.allot / setting.times.default : 1;
      const denseCells = setting ? setting.density.flat().filter(value => value >= 0.999999).length : null;
      const stepThree = `<g${v(3)}>
          <text x="${panel}" y="46" class="vt">Budgeted allocation</text>
          <rect x="${panel + 10}" y="66" width="210" height="8" fill="url(#density-ramp)"/>
          <text x="${panel + 10}" y="90">5%</text>
          <text x="${panel + 220}" y="90" text-anchor="end">100% · dense</text>
          <text x="${panel + 10}" y="122">Wall-clock time per video (A800)</text>
          <rect class="bar-track" x="${panel + 10}" y="130" width="210" height="14"/>
          <rect class="bar-fill" x="${panel + 10}" y="130" width="${(210 * ratio).toFixed(1)}" height="14"/>
          <line class="bar-mark" x1="${panel + 220}" y1="125" x2="${panel + 220}" y2="149"/>
          ${setting ? `<text x="${panel + 10}" y="162" class="vb">ALLOT ${setting.times.allot.toFixed(1)} s</text>
          <text x="${panel + 220}" y="162" text-anchor="end">Default ${setting.times.default.toFixed(1)} s</text>` : ''}
          ${denseCells !== null ? `<text x="${panel + 10}" y="196">${denseCells.toLocaleString('en-US')} of 1,500 cells stay dense</text>` : ''}
          <text x="${panel}" y="254">One table, solved once and reused</text>
          <text x="${panel}" y="270">for every prompt at inference.</text>
        </g>`;

      svg.innerHTML = `<defs><linearGradient id="density-ramp"><stop offset="0" stop-color="#e3eee7"/><stop offset="1" stop-color="#255942"/></linearGradient></defs>
        <g>${cells.join('')}</g>${axes}${stepOne}${stepTwo}${stepThree}`;

      const CAPTIONS = [
        '<strong>Cell probing.</strong> Each layer–step pair is a cell. ALLOT sparsifies one cell at a time across candidate densities and records the one-step output error on a few probing videos. Schematic illustration.',
        '<strong>Trajectory calibration.</strong> Sparsifying short windows of denoising steps and measuring final-video error calibrates how single-step perturbations propagate to the generated video. Schematic illustration.',
        `<strong>Budgeted allocation.</strong> Calibrated sensitivities and measured sparse-kernel latency yield one density table under the latency budget. ${setting ? 'Shown: the solved table for Wan2.1-1.3B with XAttention at 480p; darker cells keep more attention blocks.' : ''}`,
      ];
      const DURATIONS = [4400, 4400, 5600];
      let current = 0, timer = null, interacted = false, completed = false;

      const show = n => {
        current = n;
        svg.dataset.step = String(n);
        svg.querySelectorAll('[data-v]').forEach(el => el.classList.toggle('on', el.dataset.v === String(n)));
        stepButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.n) === n)));
        caption.innerHTML = CAPTIONS[n - 1];
      };
      const go = n => {
        svg.dataset.step = '';
        svg.querySelectorAll('[data-v].on').forEach(el => el.classList.remove('on'));
        requestAnimationFrame(() => requestAnimationFrame(() => show(n)));
      };
      const stop = () => {
        window.clearTimeout(timer);
        timer = null;
        playButton.textContent = '▶';
        playButton.setAttribute('aria-label', 'Play the method walkthrough');
      };
      const play = () => {
        playButton.textContent = '❚❚';
        playButton.setAttribute('aria-label', 'Pause the method walkthrough');
        const tick = n => {
          go(n);
          timer = window.setTimeout(() => {
            if (n < 3) {
              tick(n + 1);
            } else {
              completed = true;
              stop();
            }
          }, DURATIONS[n - 1]);
        };
        tick(current >= 3 || current === 0 ? 1 : current);
      };

      stepButtons.forEach(button => button.addEventListener('click', () => {
        interacted = true;
        stop();
        go(Number(button.dataset.n));
      }));
      playButton.addEventListener('click', () => {
        interacted = true;
        if (timer) stop();
        else play();
      });

      if (reduceMotion || !('IntersectionObserver' in window)) {
        show(3);
      } else {
        caption.innerHTML = CAPTIONS[0];
        new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting && !interacted && !completed && !timer) play();
            else if (!entry.isIntersecting && timer) stop();
          });
        }, { threshold: 0.4 }).observe(viz);
      }
    }
  };

  if (window.ALLOT_DEMO_DATA || document.readyState === 'complete') {
    initMethodViz();
  } else {
    document.addEventListener('DOMContentLoaded', initMethodViz, { once: true });
  }

  const copyWithFallback = text => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
    return copied;
  };

  if (bibtex && copyButton) {
    const defaultLabel = copyButton.textContent;
    let resetTimer = null;

    copyButton.addEventListener('click', async () => {
      const text = bibtex.textContent.trim();
      let success = false;

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          success = true;
        } catch (_) {
          success = copyWithFallback(text);
        }
      } else {
        success = copyWithFallback(text);
      }

      copyButton.textContent = success ? 'Copied' : 'Copy failed';
      if (resetTimer) {
        window.clearTimeout(resetTimer);
      }
      resetTimer = window.setTimeout(() => {
        copyButton.textContent = defaultLabel;
      }, 1800);
    });
  }
})();

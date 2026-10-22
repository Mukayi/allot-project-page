(() => {
  const videos = Array.from(document.querySelectorAll('.video-pair video'));
  const toggle = document.querySelector('#comparison-toggle');
  const bibtex = document.querySelector('#bibtex');
  const copyButton = document.querySelector('#copy-citation');

  const DRIFT_THRESHOLD_SECONDS = 0.08;

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

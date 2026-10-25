const STANDARD_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
const RESET_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1.0001, viewport-fit=cover';

export function setupViewportFix(): void {
  if (typeof window === 'undefined') return;

  const getMeta = () => document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;

  const checkAndReset = () => {
    const vv = window.visualViewport;
    if (vv && Math.abs(vv.scale - 1) > 0.01) {
      const meta = getMeta();
      if (meta) {
        meta.setAttribute('content', RESET_VIEWPORT);
        setTimeout(() => {
          meta.setAttribute('content', STANDARD_VIEWPORT);
          window.scrollTo(0, 0);
        }, 50);
      } else {
        window.scrollTo(0, 0);
      }
    }
  };

  const scheduleReset = () => {
    setTimeout(checkAndReset, 150);
    setTimeout(checkAndReset, 500);
  };

  window.addEventListener('orientationchange', scheduleReset, { passive: true });
  window.addEventListener('resize', scheduleReset, { passive: true });

  if (window.location.search.includes('debug=1')) {
    initDebugPanel();
  }
}

function initDebugPanel(): void {
  const panel = document.createElement('div');
  panel.id = 'safari-debug-panel';
  panel.style.cssText =
    'position:fixed;bottom:4px;left:4px;z-index:999999;background:rgba(0,0,0,0.85);color:#00ff88;' +
    'font-family:monospace;font-size:10px;line-height:1.25;padding:4px 6px;border-radius:4px;' +
    'pointer-events:none;max-width:calc(100% - 8px);word-break:break-all;box-shadow:0 2px 6px rgba(0,0,0,0.5);';
  document.body.appendChild(panel);

  const update = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sw = document.documentElement.scrollWidth;
    const vv = window.visualViewport;
    const scale = vv ? vv.scale.toFixed(2) : '1';
    const vvW = vv ? Math.round(vv.width) : w;

    const overflowing: string[] = [];
    const all = document.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      if (el === panel) continue;
      const rect = el.getBoundingClientRect();
      if (rect.right > w + 1 && rect.width > 0) {
        const tag = el.tagName.toLowerCase();
        const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        overflowing.push(`${tag}${cls}`);
        if (overflowing.length >= 3) break;
      }
    }

    panel.innerHTML = `W:${w} H:${h} sW:${sw}<br/>vvS:${scale} vvW:${vvW}<br/>ovf:${overflowing.length ? overflowing.join(', ') : 'none'}`;
  };

  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(update, 200), { passive: true });
  update();
}

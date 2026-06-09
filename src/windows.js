'use strict';

// Returns true for small auth/login popups. Uses window size and disposition
// signals only (not domain allowlists) so federated IdPs work without maintaining
// a domain list.
function isPopupWindow(features, disposition) {
  if (disposition === 'new-popup') return true;
  if (typeof features === 'string' && features.includes('popup')) return true;
  const w = parseInt((/width=(\d+)/i.exec(features || '') || [])[1], 10);
  const h = parseInt((/height=(\d+)/i.exec(features || '') || [])[1], 10);
  if (!isNaN(w) && !isNaN(h) && w < 800 && h < 800) return true;
  return false;
}

// Initial RDP window size from the monitor work area (excludes panels/taskbar).
function getRdpWindowDimensions(workArea) {
  const width = Math.max(800, Math.min(workArea.width, 3840));
  const height = Math.max(600, Math.min(workArea.height, 2160));
  return { width, height };
}

// Build JS injected into the RDP renderer so the AVD web client re-negotiates
// session resolution when the Electron window changes size or enters fullscreen.
function buildRendererResizeNotifyScript(contentWidth, contentHeight) {
  const w = Math.max(0, Math.round(Number(contentWidth) || 0));
  const h = Math.max(0, Math.round(Number(contentHeight) || 0));
  return `
    (function() {
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('orientationchange'));
      if (window.visualViewport) {
        window.visualViewport.dispatchEvent(new Event('resize'));
      }
      var detail = { width: ${w}, height: ${h}, dpr: window.devicePixelRatio || 1 };
      window.dispatchEvent(new CustomEvent('rdp-host-resize', { detail: detail }));
    })();
  `;
}

module.exports = {
  isPopupWindow,
  getRdpWindowDimensions,
  buildRendererResizeNotifyScript
};

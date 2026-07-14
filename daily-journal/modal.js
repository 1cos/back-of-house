/* ============================================================
   Daily Operations Journal v0.2
   modal.js — modal and bottom-sheet management
   ============================================================ */

let _onEscCbs = [];

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  // Focus first focusable element
  requestAnimationFrame(() => {
    const focusable = el.querySelector('input:not([type=hidden]), select, textarea, button:not(.modal-close)');
    focusable?.focus();
  });
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

export function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
}

export function toast(msg, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  t.setAttribute('role', 'status');
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

export function initGlobalKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });
  // Click outside overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
}

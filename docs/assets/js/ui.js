/* =========================================================================
   TA Resident Registry — small UI helpers (toast, header render, sign-out)
   Kept intentionally tiny — the whole app is 3 pages.
   ========================================================================= */
(function () {
  function ensureToastWrap() {
    let wrap = document.querySelector('.trr-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'trr-toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function toast(msg, kind) {
    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'trr-toast' + (kind ? ' trr-toast-' + kind : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  function renderHeader(rootSelector) {
    const root = document.querySelector(rootSelector || '[data-trr-header]');
    if (!root) return;
    const API = window.TRR && window.TRR.API;
    const signedIn = API && API.isSignedIn();
    const email = signedIn ? API.currentEmail() : '';
    const role = signedIn ? API.currentRole() : '';
    root.innerHTML = `
      <header class="trr-header">
        <a class="trr-brand" href="./index.html" aria-label="Resident Registry home">
          <span class="trr-brand-logo" aria-hidden="true"><i class="fas fa-home"></i></span>
          <span>
            <div class="trr-brand-title">Resident Registry</div>
            <div class="trr-brand-sub">The Address · Tower Apartments</div>
          </span>
        </a>
        <div class="trr-header-actions">
          ${signedIn ? `
            <span class="trr-who" title="${email}">${email} · <span class="trr-chip trr-chip-info">${role}</span></span>
            <button type="button" class="trr-btn trr-btn-ghost" data-trr-signout>
              <i class="fas fa-sign-out-alt"></i> Sign out
            </button>
          ` : `
            <a class="trr-btn trr-btn-primary" href="./signin.html">
              <i class="fas fa-sign-in-alt"></i> Sign in
            </a>
          `}
        </div>
      </header>
    `;
    const btn = root.querySelector('[data-trr-signout]');
    if (btn) btn.addEventListener('click', () => {
      if (!confirm('Sign out of the Resident Registry?')) return;
      API.signOut();
      window.location.href = './index.html';
    });
  }

  function renderFooter(rootSelector) {
    const root = document.querySelector(rootSelector || '[data-trr-footer]');
    if (!root) return;
    root.innerHTML = `
      <footer class="trr-footer">
        <p>© The Address Management Committee · <a href="./privacy.html">Privacy notice</a></p>
      </footer>
    `;
  }

  function requireAuth(role) {
    const API = window.TRR && window.TRR.API;
    if (!API || !API.isSignedIn()) {
      window.location.href = './signin.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
      return false;
    }
    if (role) {
      const chain = ['UNKNOWN', 'RESIDENT', 'COMMITTEE', 'ADMIN'];
      const need = chain.indexOf(role);
      const have = chain.indexOf(API.currentRole());
      if (need === -1 || have < need) {
        toast('You do not have permission to view this page.', 'err');
        setTimeout(() => { window.location.href = './index.html'; }, 1500);
        return false;
      }
    }
    return true;
  }

  window.TRR = window.TRR || {};
  window.TRR.UI = { toast, renderHeader, renderFooter, requireAuth };
})();

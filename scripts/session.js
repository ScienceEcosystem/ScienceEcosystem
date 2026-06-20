// scripts/session.js

// ── CSRF token auto-attach ───────────────────────────────────────────────────
// Reads the non-httpOnly "csrf_token" cookie (set by server/index.js on every
// visit) and attaches it as X-CSRF-Token on every same-origin state-changing
// fetch. Patching window.fetch here means every script that already calls
// fetch(...) gets this for free — no call-site changes needed anywhere else.
// Runs first/synchronously so it's in place before any user-triggered request.
(function patchFetchForCsrf(){
  if (typeof window === "undefined" || !window.fetch || window.fetch.__csrfPatched) return;
  function getCookie(name){
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  const originalFetch = window.fetch.bind(window);
  const patched = function(input, init){
    init = init || {};
    const method = String(init.method || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      let url = null;
      try { url = new URL(typeof input === "string" ? input : input.url, location.origin); } catch (_e) {}
      if (url && url.origin === location.origin) {
        const token = getCookie("csrf_token");
        if (token) {
          const headers = new Headers(init.headers || (input && input.headers) || {});
          headers.set("X-CSRF-Token", token);
          init = Object.assign({}, init, { headers });
        }
      }
    }
    return originalFetch(input, init);
  };
  patched.__csrfPatched = true;
  window.fetch = patched;
})();

(function ensureCanonical(){
  try {
    var path = location.pathname || "/";
    path = path.replace(/index\.html?$/i, "");
    if (!path.startsWith("/")) path = "/" + path;
    if (path === "") path = "/";
    var href = location.origin + path;
    var link = document.querySelector('link[rel="canonical"]');
    if (link) {
      link.href = href;
    } else {
      link = document.createElement("link");
      link.rel = "canonical";
      link.href = href;
      document.head.appendChild(link);
    }
  } catch (_e) {}
})();

(function ensureFavicon(){
  try {
    var existing = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
    var href = "/assets/logos_se/logo.png";
    if (existing) {
      existing.rel = "icon";
      existing.href = href;
    } else {
      var link = document.createElement("link");
      link.rel = "icon";
      link.href = href;
      document.head.appendChild(link);
    }
  } catch(_e){}
})();

async function checkSession() {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error("Session check failed");
    return await res.json();
  } catch (e) {
    if (e && e.message !== "Session check failed") {
      console.warn("Session check error:", e);
    }
    return null;
  }
}

globalThis.SE_SESSION_PROMISE = (async function(){
  const me = await checkSession();
  globalThis.SE_SESSION = me || null;
  globalThis.SE_SESSION_READY = true;
  return globalThis.SE_SESSION;
})();

(async function () {
  // Finds elements if present on the page
  const loginBtn  = document.getElementById("orcidLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileLink = document.getElementById("profileLink"); // optional <a> to profile

  try {
    const me = await globalThis.SE_SESSION_PROMISE;
    if (!me) throw new Error("not signed in");

    // Toggle nav: show Profile + Library + Logout, hide Login
    if (loginBtn)  loginBtn.style.display = "none";
    if (profileLink) {
      profileLink.style.display = "inline-flex";
      profileLink.href = "user-profile.html";
      profileLink.textContent = me.name ? me.name : "My Profile";
      profileLink.setAttribute("title", `Logged in as ${me.orcid}`);
    }

    // Insert Library link once, before the logout button
    if (!document.getElementById("libraryNavLink")) {
      const libLink = document.createElement("a");
      libLink.id = "libraryNavLink";
      libLink.className = "nav-link";
      libLink.href = "library.html";
      libLink.textContent = "Library";
      const navRight = document.querySelector(".nav-right");
      if (navRight && logoutBtn) navRight.insertBefore(libLink, logoutBtn);
      else if (navRight) navRight.appendChild(libLink);
    }

    if (logoutBtn) {
      logoutBtn.style.display = "inline-flex";
      logoutBtn.onclick = async () => {
        await fetch("/auth/logout", { method: "POST", credentials: "include" });
        location.reload();
      };
    }
  } catch {
    // Not signed in: show Login, hide Profile/Logout
    if (loginBtn)  loginBtn.style.display = "inline-flex";
    if (profileLink) profileLink.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
  }
})();

// In-app back/forward navigation for the installed PWA — when running in
// standalone mode there's no browser chrome, so add our own history controls
// to the nav bar (mirrors the browser's back/forward arrows).
(function addAppNavHistory() {
  try {
    var isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (!isStandalone) return;
    var logo = document.querySelector(".app-nav .logo");
    if (!logo || logo.querySelector(".app-nav-history")) return;

    var wrap = document.createElement("div");
    wrap.className = "app-nav-history";
    wrap.innerHTML =
      '<button type="button" aria-label="Go back">&larr;</button>' +
      '<button type="button" aria-label="Go forward">&rarr;</button>';

    var buttons = wrap.querySelectorAll("button");
    buttons[0].addEventListener("click", function () { history.back(); });
    buttons[1].addEventListener("click", function () { history.forward(); });

    logo.insertBefore(wrap, logo.firstChild);
  } catch (_e) {}
})();

// PWA Service Worker Registration
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/service-worker.js", { scope: "/" })
      .then(function (reg) {
        console.log("[PWA] Service worker registered, scope:", reg.scope);

        // Check for updates every time the page loads
        reg.addEventListener("updatefound", function () {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", function () {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New version available — optionally show a toast
              console.log("[PWA] New version available. Refresh to update.");
              // Uncomment to show a banner:
              // showUpdateBanner();
            }
          });
        });
      })
      .catch(function (err) {
        console.warn("[PWA] Service worker registration failed:", err);
      });
  });
}

// Optional: "Install app" prompt handler
// Saves the beforeinstallprompt event so you can trigger it with a button
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", function (e) {
  e.preventDefault();
  deferredInstallPrompt = e;
});

window.addEventListener("appinstalled", function () {
  deferredInstallPrompt = null;
  const installBtn = document.getElementById("installAppBtn");
  if (installBtn) {
    installBtn.textContent = "App Installed";
    installBtn.disabled = true;
  }
  console.log("[PWA] App installed successfully");
});

// Call this function from an "Install App" button click
window.installPWA = function () {
  if (!deferredInstallPrompt) {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || "");
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (isStandalone) {
      alert("ScienceEcosystem is already installed on this device.");
      return;
    }
    if (isIOS) {
      alert('To install ScienceEcosystem on iPhone or iPad, tap Share and then choose "Add to Home Screen".');
      return;
    }
    alert("Install is not available in this browser yet. If supported, the prompt will appear after the site becomes installable.");
    return;
  }
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(function (result) {
    console.log("[PWA] Install choice:", result.outcome);
    deferredInstallPrompt = null;
  });
};

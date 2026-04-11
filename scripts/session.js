// scripts/session.js
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

    // Toggle nav: show Profile + Logout, hide Login
    if (loginBtn)  loginBtn.style.display = "none";
    if (profileLink) {
      profileLink.style.display = "inline-flex";
      profileLink.href = "user-profile.html";
      profileLink.textContent = me.name ? me.name : "My Profile";
      profileLink.setAttribute("title", `Logged in as ${me.orcid}`);
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
  // Show your install button if you have one
  const installBtn = document.getElementById("installAppBtn");
  if (installBtn) installBtn.style.display = "inline-flex";
});

window.addEventListener("appinstalled", function () {
  deferredInstallPrompt = null;
  const installBtn = document.getElementById("installAppBtn");
  if (installBtn) installBtn.style.display = "none";
  console.log("[PWA] App installed successfully");
});

// Call this function from an "Install App" button click
window.installPWA = function () {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(function (result) {
    console.log("[PWA] Install choice:", result.outcome);
    deferredInstallPrompt = null;
  });
};

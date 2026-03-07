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

(async function () {
  // Finds elements if present on the page
  const loginBtn  = document.getElementById("orcidLoginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const profileLink = document.getElementById("profileLink"); // optional <a> to profile

  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (!res.ok) throw new Error("not signed in");
    const me = await res.json();

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

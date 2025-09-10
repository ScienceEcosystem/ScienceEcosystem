// scripts/session.js
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

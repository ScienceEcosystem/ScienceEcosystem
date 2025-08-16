// Placeholder database / local storage for saved papers
const libraryKey = "userLibrary";

// Simulate ORCID login (replace with real OAuth flow)
async function orcidLogin() {
    // Normally redirect to ORCID OAuth, then get access token
    // Here we simulate a logged-in user for demo
    return {
        orcid: "0000-0001-2345-6789",
        name: "Dr. Jane Doe",
        affiliation: "University of Science",
        works: [] // could populate with ORCID works API later
    };
}

async function loadUserProfile() {
    const userMain = document.getElementById("userMain");
    const userSidebar = document.getElementById("userSidebar");

    const user = await orcidLogin();

    // Display basic profile info
    userMain.innerHTML = `
        <h1>${user.name}</h1>
        <p><strong>ORCID ID:</strong> <a href="https://orcid.org/${user.orcid}" target="_blank">${user.orcid}</a></p>
        <p><strong>Affiliation:</strong> ${user.affiliation}</p>
        <section>
          <h2>My Library</h2>
          <ul id="userLibraryList"></ul>
        </section>
        <section>
          <h2>My Topics</h2>
          <p id="userTopics">No topics yet.</p>
        </section>
        <section>
          <h2>Analytics</h2>
          <p id="userAnalytics">No analytics available yet.</p>
        </section>
    `;

    // Sidebar: quick stats and actions
    const library = JSON.parse(localStorage.getItem(libraryKey)) || [];
    userSidebar.innerHTML = `
        <h3>Library Stats</h3>
        <p><strong>Total Papers Saved:</strong> ${library.length}</p>
        <button onclick="clearLibrary()">Clear Library</button>
    `;

    renderLibrary(library);
}

// Render library list
function renderLibrary(library) {
    const list = document.getElementById("userLibraryList");
    if (!list) return;
    list.innerHTML = library.length
        ? library.map(paper => `<li>${paper.title} <a href="paper.html?id=${encodeURIComponent(paper.id)}">[View]</a></li>`).join("")
        : "<li>No papers saved yet.</li>";
}

// Add paper to user library
function savePaper(paper) {
    const library = JSON.parse(localStorage.getItem(libraryKey)) || [];
    if (!library.find(p => p.id === paper.id)) {
        library.push(paper);
        localStorage.setItem(libraryKey, JSON.stringify(library));
        renderLibrary(library);
        alert(`Saved "${paper.title}" to your library`);
    } else {
        alert("Paper already in library");
    }
}

// Clear library
function clearLibrary() {
    localStorage.removeItem(libraryKey);
    renderLibrary([]);
}

document.getElementById("orcidLoginBtn").addEventListener("click", async () => {
    await loadUserProfile();
});

// Load profile immediately if already "logged in"
window.addEventListener("DOMContentLoaded", loadUserProfile);

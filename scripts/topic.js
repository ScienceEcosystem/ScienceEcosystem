const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("topicMain");
const sidebar = document.getElementById("topicSidebar");

const getWikipediaExtractHTML = async (title) => {
  try {
    const response = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
    if (!response.ok) throw new Error("Wikipedia fetch failed");
    const data = await response.json();
    return {
      html: data.extract_html,
      url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`
    };
  } catch (error) {
    console.warn("Wikipedia summary not available:", error);
    return { html: null, url: null };
  }
};

async function loadTopic() {
  const id = getParam("id");
  if (!id) {
    main.innerHTML = "<p>Missing topic ID.</p>";
    return;
  }

  try {
    const topic = await (await fetch(`https://api.openalex.org/concepts/${id}`)).json();

    // ✅ Update document title
    document.title = `${topic.display_name} | Topic | ScienceEcosystem`;

    // ✅ Fetch Wikipedia summary
    const { html: wikiHTML, url: wikiURL } = await getWikipediaExtractHTML(topic.display_name);

    // ✅ Main content (Wikipedia-like layout)
    main.innerHTML = `
      <article>
        <header style="border-bottom:1px solid #ccc; margin-bottom:1rem;">
          <h1>${topic.display_name}</h1>
        </header>
        <section class="wiki-extract" style="margin-bottom:1rem; line-height:1.6;">
          ${wikiHTML || `<p><strong>Description:</strong> ${topic.description || "No description available."}</p>`}
        </section>
        ${wikiURL ? `<p style="font-size:0.9em; color:gray;">Source: <a href="${wikiURL}" target="_blank" rel="noopener noreferrer">Wikipedia</a></p>` : ""}
        <p><a href="${topic.id}" target="_blank" rel="noopener noreferrer">View on OpenAlex</a></p>
      </article>
    `;

    // ✅ Fix relative Wikipedia links
    document.querySelectorAll(".wiki-extract a").forEach(link => {
      const href = link.getAttribute("href");
      if (href?.startsWith("/wiki/")) {
        link.href = "https://en.wikipedia.org" + href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });

    // ✅ Load top cited works
    const worksResp = await fetch(`https://api.openalex.org/works?filter=concepts.id:${id}&sort=cited_by_count:desc&per_page=10`);
    const works = (await worksResp.json()).results || [];

    document.getElementById("workList").innerHTML = works.map(w => {
      const authors = w.authorships?.map(a =>
        a.author.id
          ? `<a href="profile.html?id=${encodeURIComponent(a.author.id)}" style="color:#0d9488;">${a.author.display_name}</a>`
          : a.author.display_name
      ).join(", ") || "Unknown authors";

      const year = w.publication_year || "N/A";
      const link = `paper.html?id=${w.id.split("/").pop()}`;

      return `
        <li style="margin-bottom: 1rem;">
          <p style="font-weight:bold;"><a href="${link}" style="color:#2563eb;">${w.title}</a></p>
          <p>${authors} — ${year}</p>
        </li>`;
    }).join("");

    // ✅ Sidebar details
    sidebar.innerHTML = `
      <section style="margin-bottom:2rem;">
        <h3>OpenAlex ID</h3>
        <p>${topic.id}</p>
      </section>
      <section style="margin-bottom:2rem;">
        <h3>Works Count</h3>
        <p>${topic.works_count.toLocaleString()}</p>
      </section>
      <section style="margin-bottom:2rem;">
        <h3>Level</h3>
        <p>${topic.level}</p>
      </section>
      <section style="margin-bottom:2rem;">
        <h3>Top Ancestor</h3>
        <p>${topic.ancestors?.[0]?.display_name || "N/A"}</p>
      </section>
    `;

  } catch (err) {
    console.error(err);
    main.innerHTML = "<p>Error loading topic data.</p>";
  }
}

loadTopic();

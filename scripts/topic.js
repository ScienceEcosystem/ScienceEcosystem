const getParam = (name) => new URLSearchParams(location.search).get(name);
const main = document.getElementById("topicMain");
const sidebar = document.getElementById("topicSidebar");

async function loadTopic() {
  const id = getParam("id");
  if (!id) {
    main.innerHTML = "<p>Missing topic ID.</p>";
    return;
  }

  try {
    const topic = await (await fetch(`https://api.openalex.org/concepts/${id}`)).json();

    main.innerHTML = `
      <section style="margin-bottom:2rem;">
        <h1>${topic.display_name}</h1>
        <p><strong>Description:</strong> ${topic.description || "No description available."}</p>
        <p><a href="${topic.id}" target="_blank">View on OpenAlex</a></p>
      </section>
      <section>
        <h2>Top Works in this Topic</h2>
        <ul id="workList">Loading...</ul>
      </section>
    `;

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

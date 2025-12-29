// scripts/funders.js
(function(){
  const funders = [
    { id:"nih-r01", name:"NIH R01", discipline:"Life/Health", type:"research", career:"mid", budget:"500k-1m", region:"US", openScience:"strong", summary:"Investigator-initiated research in health/biomedical sciences.", strengths:["Established mechanism","Supports multi-year research"], bestFor:"Mid-career PI with solid preliminary data.", avoidIf:"Pilot/seed projects." , link:"https://grants.nih.gov/grants/funding/r01.htm" },
    { id:"nsf-career", name:"NSF CAREER", discipline:"STEM", type:"research", career:"early", budget:"500k-1m", region:"US", openScience:"encouraged", summary:"Early-career award integrating research and education.", strengths:["Prestige","Education component"], bestFor:"Early-career faculty with research + teaching plan.", avoidIf:"Late-career or without teaching plan.", link:"https://www.nsf.gov/career" },
    { id:"erc-starting", name:"ERC Starting Grant", discipline:"Any", type:"research", career:"early", budget:"over1m", region:"EU", openScience:"strong", summary:"Frontier research grants for early-career investigators.", strengths:["High budget","Prestige","Open science plan"], bestFor:"Ambitious early projects with originality.", avoidIf:"Incremental or late-career.", link:"https://erc.europa.eu" },
    { id:"erc-consolidator", name:"ERC Consolidator Grant", discipline:"Any", type:"research", career:"mid", budget:"over1m", region:"EU", openScience:"strong", summary:"Supports mid-career researchers to consolidate teams.", strengths:["High budget","Prestige"], bestFor:"Independent labs with strong track record.", avoidIf:"Very early-career.", link:"https://erc.europa.eu" },
    { id:"wellcome-early", name:"Wellcome Early-Career Award", discipline:"Life/Health", type:"research", career:"early", budget:"500k-1m", region:"Global", openScience:"strong", summary:"Supports early researchers leading their first projects.", strengths:["Global eligibility","Open science focus"], bestFor:"Early PIs with health-related questions.", avoidIf:"Senior investigators.", link:"https://wellcome.org/grant-funding" },
    { id:"wellcome-discovery", name:"Wellcome Discovery Award", discipline:"Life/Health", type:"research", career:"mid", budget:"over1m", region:"Global", openScience:"strong", summary:"Large-scale health research funding.", strengths:["Large budgets","OS requirements"], bestFor:"Mature teams tackling major health challenges.", avoidIf:"Pilot scope.", link:"https://wellcome.org/grant-funding" },
    { id:"horizon-pf", name:"Horizon Europe Postdoctoral Fellowships", discipline:"Any", type:"training", career:"early", budget:"100k-500k", region:"EU", openScience:"strong", summary:"Mobility + training for postdocs with open science plans.", strengths:["Mobility","Career development"], bestFor:"Postdocs seeking EU mobility + OS training.", avoidIf:"Non-mobile candidates.", link:"https://marie-sklodowska-curie-actions.ec.europa.eu" },
    { id:"horizon-eic", name:"Horizon EIC Pathfinder", discipline:"DeepTech", type:"pilot", career:"mid", budget:"over1m", region:"EU", openScience:"encouraged", summary:"High-risk, high-gain tech innovation pilots.", strengths:["Innovation focus","Consortia"], bestFor:"Cross-disciplinary deep tech pilots.", avoidIf:"Single-lab narrow studies.", link:"https://eic.ec.europa.eu" },
    { id:"gates-grand", name:"Gates Grand Challenges", discipline:"Global Health", type:"pilot", career:"any", budget:"under100k", region:"Global", openScience:"encouraged", summary:"Seed funding for bold ideas in global health.", strengths:["Fast seed","Global"], bestFor:"Early proof-of-concept in global health.", avoidIf:"Large-scale trials.", link:"https://gcgh.grandchallenges.org" },
    { id:"sloan", name:"Sloan Research Fellowship", discipline:"STEM", type:"research", career:"early", budget:"100k-500k", region:"US/Canada", openScience:"encouraged", summary:"Supports early-career faculty in STEM.", strengths:["Prestige","Flexible use"], bestFor:"Early faculty with strong publication record.", avoidIf:"Outside US/Canada.", link:"https://sloan.org/fellowships" },
    { id:"chan-zuckerberg", name:"CZI Essential Open Source Software", discipline:"Data/Tools", type:"infrastructure", career:"any", budget:"100k-500k", region:"Global", openScience:"strong", summary:"Supports critical open-source research software.", strengths:["OS focus","Maintainer support"], bestFor:"Core research software maintainers.", avoidIf:"Closed-source tools.", link:"https://chanzuckerberg.com/rfa/essential-open-source-software-for-science/" },
    { id:"arnold-venture", name:"Arnold Ventures Evidence-Based Policy", discipline:"Social/Policy", type:"research", career:"any", budget:"500k-1m", region:"US", openScience:"encouraged", summary:"Funds policy evaluations and evidence-based interventions.", strengths:["Policy impact"], bestFor:"Policy evaluations with rigorous methods.", avoidIf:"Non-policy topics.", link:"https://www.arnoldventures.org" },
    { id:"wellcome-data", name:"Wellcome Open Research/Data Reuse", discipline:"Any", type:"infrastructure", career:"any", budget:"100k-500k", region:"Global", openScience:"strong", summary:"Supports data reuse platforms and curation.", strengths:["Data focus","OS alignment"], bestFor:"Data platforms and curation projects.", avoidIf:"Non-data projects.", link:"https://wellcome.org" },
    { id:"nih-k99", name:"NIH K99/R00", discipline:"Life/Health", type:"training", career:"early", budget:"500k-1m", region:"US", openScience:"encouraged", summary:"Pathway to independence award for postdocs.", strengths:["Transition to PI","Training"], bestFor:"Postdocs moving to independence.", avoidIf:"Senior investigators.", link:"https://researchtraining.nih.gov" },
  ];

  const state = { defaultCount: 6 };

  function normalize(text){ return (text||"").toLowerCase(); }

  function scoreFunder(f, text, filters){
    let score = 0; const reasons=[];
    const lower = normalize(text);
    if (filters.discipline && (f.discipline==="Any" || f.discipline===filters.discipline)) { score+=4; reasons.push("Discipline match"); }
    if (!filters.discipline && lower.includes(f.discipline.toLowerCase())) { score+=2; reasons.push("Mentions discipline"); }
    if (filters.type && f.type===filters.type) { score+=3; reasons.push("Project type match"); }
    if (filters.career && (f.career===filters.career || f.career==="any")) { score+=3; reasons.push("Career stage fit"); }
    if (filters.region && (f.region==="Global" || f.region===filters.region)) { score+=3; reasons.push("Region/eligibility fit"); }
    if (filters.budget && f.budget===filters.budget) { score+=3; reasons.push("Budget band match"); }
    if (filters.os && f.openScience===filters.os) { score+=2; reasons.push("Open science fit"); }
    if (lower.includes("open") && f.openScience!=="none") { score+=1; reasons.push("Supports open science"); }
    if (lower.includes("training") && f.type==="training") { score+=2; reasons.push("Training friendly"); }
    return { score, reasons };
  }

  function renderRecommendations(problemText, filters){
    const container = document.getElementById("funderRecommendations");
    if (!container) return;
    const scored = funders.map(f=>{
      const {score,reasons} = scoreFunder(f, problemText, filters);
      return { funder:f, score, reasons };
    }).sort((a,b)=>b.score-a.score);
    const meaningful = problemText.trim() ? scored.filter(x=>x.score>0) : scored;
    const picks = (meaningful.length ? meaningful : scored).slice(0, state.defaultCount);
    if (!picks.length){ container.innerHTML = '<p class="muted">Add a sentence about your project to see suggestions.</p>'; return; }
    container.innerHTML = "";
    picks.forEach(({funder, reasons})=>{
      const reasonText = reasons.length ? `Why: ${Array.from(new Set(reasons)).slice(0,4).join(", ")}.` : "Why: Broadly suitable default.";
      const verify = ["Eligibility", "Budget", "Deadline", "OS policy"].map(t=>`<span class=\"badge\">${t}</span>`).join("");
      const chips = [
        `<span class="badge">${funder.region}</span>`,
        `<span class="badge">${funder.type}</span>`,
        `<span class="badge">Budget: ${funder.budget}</span>`,
        `<span class="badge">${funder.career} stage</span>`,
        `<span class="badge">${funder.openScience==="strong"?"OS strong":funder.openScience==="encouraged"?"OS encouraged":"OS not specified"}</span>`
      ].join("");
      container.insertAdjacentHTML("beforeend", `
        <article class="rec-card">
          <div class="rec-head">
            <div>
              <h3>${funder.name}</h3>
              <p class="muted small">${funder.discipline} · ${funder.region}</p>
            </div>
            <div class="pill-row">${chips}</div>
          </div>
          <p class="rec-summary">${funder.summary}</p>
          <p class="rec-why">${reasonText}</p>
          <p class="tool-strengths">Best for: ${funder.bestFor}</p>
          <p class="tool-strengths muted small">Avoid if: ${funder.avoidIf}</p>
          <div class="chip-row" style="margin-top:.5rem;">${verify}</div>
          <div class="rec-actions">
            <a class="btn btn-secondary" href="${funder.link}" target="_blank" rel="noopener">Visit program</a>
          </div>
        </article>
      `);
    });
  }

  function renderFunderGrid(list){
    const grid = document.getElementById("funderGrid");
    if (!grid) return;
    grid.innerHTML = "";
    if (!list.length){ grid.innerHTML = '<p class="muted">No funders match those filters yet.</p>'; return; }
    list.forEach(f=>{
      grid.insertAdjacentHTML("beforeend", `
        <article class="tool-card">
          <div class="tool-meta">
            <h3>${f.name}</h3>
            <div class="pill-row">
              <span class="badge">${f.region}</span>
              <span class="badge">${f.discipline}</span>
              <span class="badge">${f.type}</span>
              <span class="badge">Budget: ${f.budget}</span>
              <span class="badge">${f.career} stage</span>
            </div>
          </div>
          <p class="rec-summary">${f.summary}</p>
          <p class="tool-strengths">Best for: ${f.bestFor}</p>
          <p class="tool-strengths muted small">Avoid if: ${f.avoidIf}</p>
          <div class="tool-footer">
            <span class="alt-note">Open science: ${f.openScience}</span>
            <a href="${f.link}" target="_blank" rel="noopener">Visit</a>
          </div>
        </article>
      `);
    });
  }

  function getFilters(){
    return {
      region: document.getElementById("regionFilter")?.value || "",
      discipline: document.getElementById("disciplineFilter")?.value || "",
      type: document.getElementById("typeFilter")?.value || "",
      career: document.getElementById("careerFilter")?.value || "",
      budget: document.getElementById("budgetFilter")?.value || "",
      os: document.getElementById("osFilter")?.value || "",
    };
  }

  function applyFilters(problemText){
    const filters = getFilters();
    const filtered = funders.filter(f=>{
      const regionOk = !filters.region || f.region==="Global" || f.region===filters.region;
      const discOk = !filters.discipline || f.discipline==="Any" || f.discipline===filters.discipline;
      const typeOk = !filters.type || f.type===filters.type;
      const careerOk = !filters.career || f.career==="any" || f.career===filters.career;
      const budgetOk = !filters.budget || f.budget===filters.budget;
      const osOk = !filters.os || f.openScience===filters.os;
      return regionOk && discOk && typeOk && careerOk && budgetOk && osOk;
    });
    renderRecommendations(problemText, filters);
    renderFunderGrid(filtered);
  }

  function populateSelect(id, values){
    const sel = document.getElementById(id);
    if (!sel) return;
    values.forEach(v=>{
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v || "Any";
      sel.appendChild(opt);
    });
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    populateSelect("regionFilter", Array.from(new Set(funders.map(f=>f.region))).filter(Boolean));
    populateSelect("disciplineFilter", Array.from(new Set(funders.map(f=>f.discipline))).filter(Boolean).sort());

    const input = document.getElementById("funderProblem");
    const btn = document.getElementById("findFundersBtn");

    renderFunderGrid(funders);

    btn?.addEventListener("click", ()=>applyFilters(input?.value||""));
    input?.addEventListener("input", ()=>applyFilters(input.value));
    input?.addEventListener("keydown",(e)=>{ if(e.key==="Enter" && (e.metaKey||e.ctrlKey)) applyFilters(input.value); });

    ["regionFilter","disciplineFilter","typeFilter","careerFilter","budgetFilter","osFilter"].forEach(id=>{
      document.getElementById(id)?.addEventListener("change", ()=>applyFilters(input?.value||""));
    });
  });
})();

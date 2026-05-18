const NAV_CONFIG = {
  logo: { text: "ACC", sub: "Agent Cost Control" },
  sections: [
    {
      label: "Overview",
      items: [
        {
          icon: "≡",
          label: "Dashboard",
          href: "dashboard.html",
          id: "dashboard",
        },
      ],
    },
    {
      label: "Manage",
      items: [
        { icon: "○", label: "Agents", href: "agents.html", id: "agents" },
        { icon: "□", label: "Budgets", href: "budgets.html", id: "budgets" },
        {
          icon: "△",
          label: "Alerts",
          href: "alerts.html",
          id: "alerts",
          badge: "3",
        },
      ],
    },
  ],
  footer: { org: "Acme Corp", plan: "Team Plan · 6 agents" },
};

function renderSidebar(activeId) {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  let html = `
    <div class="sidebar-logo">
      <h1><span class="logo-icon">${NAV_CONFIG.logo.text}</span> ${NAV_CONFIG.logo.sub}</h1>
    </div>
    <nav class="sidebar-nav">`;

  NAV_CONFIG.sections.forEach((section) => {
    html += `<div class="nav-section"><div class="nav-section-label">${section.label}</div>`;
    section.items.forEach((item) => {
      const isActive = item.id === activeId;
      html += `<a href="${item.href}" class="nav-item${isActive ? " active" : ""}">
        <span class="nav-icon">${item.icon}</span>
        ${item.label}
        ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}
      </a>`;
    });
    html += "</div>";
  });

  html += `</nav>
    <div class="sidebar-footer">
      <div class="org-name">${NAV_CONFIG.footer.org}</div>
      <div class="org-plan">${NAV_CONFIG.footer.plan}</div>
    </div>`;

  sidebar.innerHTML = html;
  return sidebar;
}

function initNav(activeId) {
  const layout = document.querySelector(".app-layout");
  if (layout) {
    layout.prepend(renderSidebar(activeId));
  }
}

const NAV_CONFIG = {
  logo: { icon: "$", text: "tokenclaw" },
  sections: [
    {
      label: "Monitor",
      items: [
        {
          icon: "≡",
          label: "Overview",
          href: "dashboard.html",
          id: "dashboard",
        },
        {
          icon: "△",
          label: "Alerts",
          href: "alerts.html",
          id: "alerts",
          badge: "2",
        },
      ],
    },
  ],
  footer: { line1: "Local only", line2: "No data leaves your machine" },
};

function renderSidebar(activeId) {
  const sidebar = document.createElement("aside");
  sidebar.className = "sidebar";

  let html = '<div class="sidebar-logo">';
  html +=
    '<h1><span class="logo-icon">' +
    NAV_CONFIG.logo.icon +
    "</span> " +
    NAV_CONFIG.logo.text +
    "</h1>";
  html += "</div>";
  html += '<nav class="sidebar-nav">';

  NAV_CONFIG.sections.forEach(function (section) {
    html +=
      '<div class="nav-section"><div class="nav-section-label">' +
      section.label +
      "</div>";
    section.items.forEach(function (item) {
      var isActive = item.id === activeId;
      html +=
        '<a href="' +
        item.href +
        '" class="nav-item' +
        (isActive ? " active" : "") +
        '">';
      html += '<span class="nav-icon">' + item.icon + "</span>";
      html += item.label;
      if (item.badge)
        html += '<span class="nav-badge">' + item.badge + "</span>";
      html += "</a>";
    });
    html += "</div>";
  });

  html += "</nav>";
  html += '<div class="sidebar-footer">';
  html += '<div class="org-name">' + NAV_CONFIG.footer.line1 + "</div>";
  html += '<div class="org-plan">' + NAV_CONFIG.footer.line2 + "</div>";
  html += "</div>";

  sidebar.innerHTML = html;
  return sidebar;
}

function initNav(activeId) {
  var layout = document.querySelector(".app-layout");
  if (layout) layout.prepend(renderSidebar(activeId));
}

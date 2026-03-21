// Utility to debounce or delay functions
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}


let popup = null;
let rankings = {};

async function fetchRankings() {
  try {
    const url = chrome.runtime.getURL('qs_rankings.json');
    const response = await fetch(url);
    rankings = await response.json();
    console.log("QS Rankings loaded:", Object.keys(rankings).length, "entries");
  } catch (e) {
    console.error("Failed to load QS Rankings:", e);
  }
}

fetchRankings();

function createPopup() {
  if (popup) return popup;
  popup = document.createElement("div");
  popup.id = "univ-map-popup";
  popup.style.display = "none";
  document.body.appendChild(popup);
  return popup;
}

function normalizeName(name) {
  let normalized = name.toLowerCase();
  
  // Replace common acronyms/expansions
  normalized = normalized.replace(/state university of new york/g, "suny");
  
  return normalized
    .replace(/\b(at|of|the|and)\b/g, "") // Remove stop words
    .replace(/&/g, "") // Remove ampersand
    .replace(/[^a-z0-9]/g, ""); // Keep only alphanumeric
}

// Returns a single rank string or an object/array of ranks
function getRankings(name) {
  if (!name) return null;
  const target = normalizeName(name);
  
  // Special Case: University of California
  // If the target is just "universityofcalifornia" (or similar short form), we return all UC campuses.
  if (target === "universityofcalifornia" || name === "University of California") {
    const ucCampuses = {};
    for (const [key, rank] of Object.entries(rankings)) {
      if (key.includes("University of California")) {
        // Extract campus name for display, e.g. "University of California, Berkeley (UCB)" -> "Berkeley"
        // Simply using the full name is fine too, or a shortened version.
        ucCampuses[key] = rank;
      }
    }
    return Object.keys(ucCampuses).length > 0 ? ucCampuses : null;
  }

  // Normal Logic
  // Try exact match first
  if (rankings[name]) return rankings[name];

  // Try normalized match
  for (const [key, rank] of Object.entries(rankings)) {
    if (normalizeName(key) === target) return rank;
  }
  
  // Try partial match
  // 1. QS key is inside Website name
  for (const [key, rank] of Object.entries(rankings)) {
     if (target.includes(normalizeName(key))) return rank;
  }

  // 2. Website name is inside QS key
  if (target.length > 5) {
      for (const [key, rank] of Object.entries(rankings)) {
        if (normalizeName(key).includes(target)) return rank;
      }
  }

  return null;
}

function showMap(name, clientX, clientY) {
  if (!name) return;

  if (!popup) createPopup();

  // Position lightly offset from cursor
  const offsetX = 15;
  const offsetY = 15;

  popup.style.left = clientX + offsetX + window.scrollX + "px";
  popup.style.top = clientY + offsetY + window.scrollY + "px";

  // Construct Map URL
  const encodedName = encodeURIComponent(name);
  const embedUrl = `https://maps.google.com/maps?q=${encodedName}&output=embed&z=4`;
  const externalMapUrl = `https://www.google.com/maps/search/?api=1&query=${encodedName}`;
  
  const rankData = getRankings(name);
  
  let rankHtml = '';
  if (rankData) {
    if (typeof rankData === 'string') {
      // Single specific rank
      rankHtml = `<div class="qs-rank-badge">🏆 QS Rank: ${rankData}</div>`;
    } else if (typeof rankData === 'object') {
      // Multiple rankings (e.g. UC system)
      const listItems = Object.entries(rankData)
        .map(([campus, rank]) => {
            // Simplify name: "University of California, Berkeley (UCB)" -> "Berkeley (UCB)"
            // Logic: remove "University of California, "
            const shortName = campus.replace(/University of California,?\s*/i, "");
            return `<li><span>${shortName}</span> <strong>#${rank}</strong></li>`;
        })
        .join('');
      
      rankHtml = `
        <div class="qs-rank-list">
          <div class="qs-rank-title">🏆 QS Rankings (Campuses)</div>
          <ul>${listItems}</ul>
        </div>
      `;
    }
  }

  popup.innerHTML = `
    ${rankHtml}
    <iframe src="${embedUrl}" loading="lazy"></iframe>
    <a href="${externalMapUrl}" target="_blank" class="open-map-btn" title="Open in Google Maps">
      Open in Google Maps ↗
    </a>
  `;
  popup.style.display = "flex";
}

function hideMap() {
  if (popup) {
    popup.style.display = "none";
    popup.innerHTML = ""; // Clear iframe to stop loading/playing
  }
}

// Event delegation or direct attachment?
// Since elements are loaded async, delegation on document body with a check or MutationObserver is best.
// However, 'mouseenter' doesn't bubble efficiently for delegation in all cases,
// using MutationObserver to attach listeners to new nodes is safer for specific behavior.

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1) {
        // Element
        // Check if the node itself is a card or contains cards
        if (node.classList && node.classList.contains("university-card")) {
          attachListener(node);
        } else if (node.querySelectorAll) {
          const cards = node.querySelectorAll(".university-card");
          cards.forEach(attachListener);
        }
      }
    }
  }
});

function attachListener(card) {
  const nameEl = card.querySelector(".university-name");
  if (nameEl && !nameEl.dataset.hasMapListener) {
    nameEl.dataset.hasMapListener = "true";
    nameEl.style.cursor = "help"; // Indicate interactability

    nameEl.addEventListener("mouseenter", (e) => {
      // Get exact text, excluding children (like the "Update" badge)
      const clone = nameEl.cloneNode(true);
      Array.from(clone.children).forEach((child) => child.remove());
      const cleanName = clone.textContent.trim();

      showMap(cleanName, e.clientX, e.clientY);
    });
    
    // REMOVED: mousemove and mouseleave listeners to keep map static
  }
}

// Global click listener to close popup when clicking outside
document.addEventListener('mousedown', (e) => {
  if (popup && popup.style.display !== 'none') {
    // Check if click is inside the popup
    if (popup.contains(e.target)) {
      return; // Do nothing, let the click happen (e.g. on the button)
    }
    // Check if click is on a university name (which is creating a new map anyway)
    // Actually, if we click on another name, the mouseenter event handles showing the new map.
    // But if we click anywhere else, we should hide it.
    hideMap();
  }
});

// Initial check in case of re-injection or fast load
const existingCards = document.querySelectorAll(".university-card");
existingCards.forEach(attachListener);

// Start observing
observer.observe(document.body, { childList: true, subtree: true });

console.log("Yonsei Exchange Map Extension Loaded");

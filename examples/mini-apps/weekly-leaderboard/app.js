const ANALYTICS_URL = (window.LINKORA_ANALYTICS_URL || "http://localhost:4000").replace(/\/$/, "");

function avatarFor(address) {
  return `https://effigy.im/a/${address}.svg`;
}

function shortAddress(address) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

async function fetchWeeklyTopTippers() {
  const res = await fetch(`${ANALYTICS_URL}/analytics/leaderboard/weekly`);
  if (!res.ok) throw new Error(`Analytics request failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.tippers) ? data.tippers : [];
}

function render(items) {
  const list = document.getElementById("list");
  if (!items.length) {
    list.innerHTML = '<div class="empty">No tips yet this week</div>';
    return;
  }
  list.innerHTML = items
    .map((item, index) => {
      const address = item.address || item.tipper || "unknown";
      const handle = item.handle || item.username || shortAddress(address);
      const total = item.total_xlm ?? item.totalAmount ?? item.amount ?? "0";
      return `
        <div class="row">
          <div>#${index + 1}</div>
          <img class="avatar" src="${avatarFor(address)}" alt="${handle} avatar" />
          <div><div>${handle}</div><div class="muted">${shortAddress(address)}</div></div>
          <div>${total} XLM</div>
        </div>
      `;
    })
    .join("");
}

async function refresh() {
  const status = document.getElementById("status");
  status.className = "muted";
  status.textContent = "Refreshing...";
  try {
    const items = await fetchWeeklyTopTippers();
    render(items);
    status.textContent = `Last updated ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    status.className = "error";
    status.textContent = error instanceof Error ? error.message : String(error);
    render([]);
  }
}

refresh();
setInterval(refresh, 60000);

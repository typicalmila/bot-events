const CATEGORY_LABELS = {
  ai: "🤖 ИИ", marketing: "📈 Маркетинг",
  sales: "💼 Продажи", analytics: "📊 Аналитика",
  culture: "🎭 Культура", other: "Другое",
};
const CATEGORY_PLACEHOLDERS = {
  ai: "🤖", marketing: "📈", sales: "💼",
  analytics: "📊", culture: "🎭", other: "📅",
};
const FORMAT_LABELS = { online: "Онлайн", offline: "Офлайн", hybrid: "Гибрид" };

export function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString("ru-RU", {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Moscow"
  });
}

export function renderCard(event, isSaved) {
  const priceLabel = event.price_type === "free"
    ? "Бесплатно"
    : `${event.price_amount?.toLocaleString("ru") ?? "?"} ₽`;
  const priceBadgeClass = event.price_type === "free" ? "badge-price-free" : "badge-price-paid";

  const coverHtml = event.cover_image_url
    ? `<img src="${event.cover_image_url}" loading="lazy" alt="">`
    : `<div class="card-cover-placeholder">${CATEGORY_PLACEHOLDERS[event.category] ?? "📅"}</div>`;

  const speakersHtml = event.speakers?.length
    ? `<div class="card-speakers">${event.speakers.slice(0, 3).join(", ")}</div>`
    : "";

  return `
    <div class="card" data-id="${event.id}">
      <div class="card-cover">
        ${coverHtml}
        <div class="card-cover-gradient"></div>
        <span class="badge badge-category">${CATEGORY_LABELS[event.category] ?? event.category}</span>
        <span class="badge ${priceBadgeClass}">${priceLabel}</span>
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(event.title)}</div>
        ${event.description ? `<div class="card-desc">${escHtml(event.description)}</div>` : ""}
        ${speakersHtml}
        <div class="card-meta">
          <span class="date">${formatDate(event.event_date)}</span>
          · ${FORMAT_LABELS[event.format] ?? event.format}
        </div>
        <div class="card-actions">
          <button class="btn-save ${isSaved ? "saved" : ""}" data-event-id="${event.id}">🔖</button>
          <button class="btn-go" data-url="${escHtml(event.url)}">Перейти</button>
        </div>
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

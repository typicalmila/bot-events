import { formatDate } from "./card.js";
import { saveEvent, unsaveEvent } from "./api.js";

const FORMAT_LABELS = { online: "Онлайн", offline: "Офлайн", hybrid: "Гибрид" };

export class DetailSheet {
  constructor(sheetEl, overlayEl, contentEl, savedIds) {
    this.sheet = sheetEl;
    this.overlay = overlayEl;
    this.content = contentEl;
    this.savedIds = savedIds;
    this.overlay.addEventListener("click", () => this.close());
  }

  open(event) {
    this._render(event);
    this.sheet.hidden = false;
    this.overlay.hidden = false;
  }

  close() {
    this.sheet.hidden = true;
    this.overlay.hidden = true;
  }

  _render(event) {
    const isSaved = this.savedIds.has(event.id);
    const priceText = event.price_type === "free"
      ? "Бесплатно"
      : `${event.price_amount?.toLocaleString("ru") ?? "?"} ₽`;

    this.content.innerHTML = `
      ${event.cover_image_url
        ? `<img class="detail-cover" src="${event.cover_image_url}" alt="">`
        : ""}
      <div class="detail-title">${escHtml(event.title)}</div>
      <div class="detail-meta">
        📅 ${formatDate(event.event_date)}<br>
        🎯 ${FORMAT_LABELS[event.format] ?? event.format} · ${priceText}
        ${event.speakers?.length ? `<br>🎤 ${escHtml(event.speakers.join(", "))}` : ""}
      </div>
      ${event.description ? `<div class="detail-desc">${escHtml(event.description)}</div>` : ""}
      <button id="detail-save" data-event-id="${event.id}"
        style="margin-bottom:10px;width:100%;background:var(--bg);border:1.5px solid var(--accent);color:var(--accent);padding:10px;border-radius:10px;font-size:14px;cursor:pointer">
        ${isSaved ? "🔖 Сохранено" : "🔖 Сохранить"}
      </button>
      <a href="${escHtml(event.url)}" target="_blank" style="text-decoration:none">
        <button class="btn-register">Зарегистрироваться</button>
      </a>`;

    this.content.querySelector("#detail-save").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (this.savedIds.has(event.id)) {
        await unsaveEvent(event.id);
        this.savedIds.delete(event.id);
        btn.textContent = "🔖 Сохранить";
      } else {
        await saveEvent(event.id);
        this.savedIds.add(event.id);
        btn.textContent = "🔖 Сохранено";
      }
    });
  }
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

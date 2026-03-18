import { countEvents } from "./api.js";

const WEEK_MS = 7 * 24 * 3600 * 1000;
const MONTH_MS = 30 * 24 * 3600 * 1000;

const CATEGORY_NAMES = {
  ai: "🤖 ИИ", marketing: "📈 Маркетинг", sales: "💼 Продажи",
  analytics: "📊 Аналитика", culture: "🎭 Культура", other: "Другое",
};

export class FiltersSheet {
  constructor(sheetEl, overlayEl, contentEl, onApply) {
    this.sheet = sheetEl;
    this.overlay = overlayEl;
    this.content = contentEl;
    this.onApply = onApply;
    this.state = { categories: [], format: null, priceType: null, dateFrom: null, dateTo: null };
    this.overlay.addEventListener("click", () => this.close());
  }

  open(currentState) {
    this.state = { ...currentState };
    this._render();
    this.sheet.hidden = false;
    this.overlay.hidden = false;
  }

  close() {
    this.sheet.hidden = true;
    this.overlay.hidden = true;
  }

  _render() {
    this.content.innerHTML = `
      <h3 style="font-size:16px;font-weight:700;margin-bottom:16px">Фильтры</h3>

      <div class="filter-section">
        <div class="filter-label">Категория</div>
        <div class="filter-chips">
          ${Object.entries(CATEGORY_NAMES).map(([v, l]) => `
            <button class="filter-chip ${this.state.categories.includes(v) ? "active" : ""}"
              data-filter="category" data-value="${v}">${l}</button>`).join("")}
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-label">Формат</div>
        <div class="filter-chips">
          ${[["online","Онлайн"],["offline","Офлайн"],["hybrid","Гибрид"]].map(([v,l]) => `
            <button class="filter-chip ${this.state.format === v ? "active" : ""}"
              data-filter="format" data-value="${v}">${l}</button>`).join("")}
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-label">Цена</div>
        <div class="filter-chips">
          ${[["free","Бесплатно"],["paid","Платно"]].map(([v,l]) => `
            <button class="filter-chip ${this.state.priceType === v ? "active" : ""}"
              data-filter="price" data-value="${v}">${l}</button>`).join("")}
        </div>
      </div>

      <div class="filter-section">
        <div class="filter-label">Дата</div>
        <div class="filter-chips">
          <button class="filter-chip" data-filter="date" data-value="week">Эта неделя</button>
          <button class="filter-chip" data-filter="date" data-value="month">Этот месяц</button>
        </div>
      </div>

      <div class="sheet-actions">
        <button class="btn-reset" id="btn-reset">Сбросить</button>
        <button class="btn-apply" id="btn-apply">Показать события</button>
      </div>`;

    this.content.querySelectorAll(".filter-chip").forEach(btn => {
      btn.addEventListener("click", () => this._toggle(btn));
    });
    this.content.querySelector("#btn-reset").addEventListener("click", () => this._reset());
    this.content.querySelector("#btn-apply").addEventListener("click", () => this._apply());
    this._updateCount();
  }

  _toggle(btn) {
    const { filter, value } = btn.dataset;
    if (filter === "category") {
      this.state.categories = this.state.categories.includes(value)
        ? this.state.categories.filter(c => c !== value)
        : [...this.state.categories, value];
    } else if (filter === "format") {
      this.state.format = this.state.format === value ? null : value;
    } else if (filter === "price") {
      this.state.priceType = this.state.priceType === value ? null : value;
    } else if (filter === "date") {
      const now = new Date();
      const ms = value === "week" ? WEEK_MS : MONTH_MS;
      this.state.dateFrom = now.toISOString();
      this.state.dateTo = new Date(now.getTime() + ms).toISOString();
    }
    this._render();
  }

  _reset() {
    this.state = { categories: [], format: null, priceType: null, dateFrom: null, dateTo: null };
    this._render();
  }

  _apply() {
    this.onApply(this.state);
    this.close();
  }

  async _updateCount() {
    const count = await countEvents(this.state);
    const btn = this.content.querySelector("#btn-apply");
    if (btn) btn.textContent = `Показать ${count} событий`;
  }
}

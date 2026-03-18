import { authenticate, fetchEvents, fetchSavedIds, fetchSavedEvents, saveEvent, unsaveEvent } from "./api.js";
import { renderCard } from "./card.js";
import { FiltersSheet } from "./filters.js";
import { DetailSheet } from "./detail.js";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const state = {
  tab: "feed",
  category: "all",
  filters: { categories: [], format: null, priceType: null, dateFrom: null, dateTo: null },
  cursor: null,
  loading: false,
  hasMore: true,
  events: [],
  savedIds: new Set(),
};

const feed = document.getElementById("feed");
const loader = document.getElementById("loader");
const emptyState = document.getElementById("empty-state");
const emptyText = document.getElementById("empty-text");

const filtersSheet = new FiltersSheet(
  document.getElementById("filters-sheet"),
  document.getElementById("filters-overlay"),
  document.getElementById("filters-content"),
  (newFilters) => {
    state.filters = newFilters;
    state.category = "all";
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    document.querySelector('.chip[data-category="all"]').classList.add("active");
    resetFeed();
  }
);

let detailSheet;

async function init() {
  await authenticate();
  state.savedIds = await fetchSavedIds();
  detailSheet = new DetailSheet(
    document.getElementById("detail-sheet"),
    document.getElementById("detail-overlay"),
    document.getElementById("detail-content"),
    state.savedIds
  );
  bindEvents();
  await loadMore();
}

function bindEvents() {
  document.getElementById("chips-container").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    state.category = chip.dataset.category;
    state.filters.categories = state.category === "all" ? [] : [state.category];
    resetFeed();
  });

  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      state.tab = tab.dataset.tab;
      resetFeed();
    });
  });

  document.getElementById("btn-filters").addEventListener("click", () => {
    filtersSheet.open(state.filters);
  });

  window.addEventListener("scroll", () => {
    const scrolled = window.scrollY + window.innerHeight;
    const total = document.documentElement.scrollHeight;
    if (scrolled / total > 0.8 && !state.loading && state.hasMore && state.tab === "feed") {
      loadMore();
    }
  });

  feed.addEventListener("click", (e) => {
    const saveBtn = e.target.closest(".btn-save");
    const goBtn = e.target.closest(".btn-go");
    const card = e.target.closest(".card");

    if (saveBtn) {
      e.stopPropagation();
      toggleSave(saveBtn.dataset.eventId, saveBtn);
      return;
    }
    if (goBtn) {
      e.stopPropagation();
      const url = goBtn.dataset.url;
      if (tg) tg.openLink(url); else window.open(url);
      return;
    }
    if (card) {
      const event = state.events.find(ev => ev.id === card.dataset.id);
      if (event) detailSheet?.open(event);
    }
  });
}

function resetFeed() {
  state.cursor = null;
  state.hasMore = true;
  state.events = [];
  feed.innerHTML = "";
  emptyState.hidden = true;
  loadMore();
}

async function loadMore() {
  if (state.loading) return;
  state.loading = true;
  loader.hidden = false;

  try {
    let events;
    if (state.tab === "saved") {
      events = await fetchSavedEvents();
      state.hasMore = false;
    } else {
      events = await fetchEvents({ ...state.filters, cursor: state.cursor, limit: 20 });
      if (events.length > 0) {
        const last = events[events.length - 1];
        state.cursor = { event_date: last.event_date, id: last.id };
      }
      state.hasMore = events.length === 20;
    }

    state.events = [...state.events, ...events];
    events.forEach(event => {
      feed.insertAdjacentHTML("beforeend", renderCard(event, state.savedIds.has(event.id)));
    });

    if (state.events.length === 0) {
      emptyState.hidden = false;
      emptyText.textContent = state.tab === "saved"
        ? "Ещё ничего не сохранено — найди что-то интересное 👆"
        : "Пока нет событий по этим фильтрам — попробуй изменить параметры";
    }
  } finally {
    state.loading = false;
    loader.hidden = true;
  }
}

async function toggleSave(eventId, btn) {
  if (state.savedIds.has(eventId)) {
    await unsaveEvent(eventId);
    state.savedIds.delete(eventId);
    btn.classList.remove("saved");
  } else {
    await saveEvent(eventId);
    state.savedIds.add(eventId);
    btn.classList.add("saved");
  }
}

init();

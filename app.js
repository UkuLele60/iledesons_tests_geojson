import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

window.onerror = (msg, url, line, col, err) => {
  alert(`Erreur JS: ${msg}\n${url}:${line}:${col}`);
};

window.onunhandledrejection = (e) => {
  alert(`Promise rejetée: ${e.reason?.message || e.reason}`);
};

const debug = document.createElement("div");
debug.style.position = "absolute";
debug.style.zIndex = 9999;
debug.style.left = "10px";
debug.style.bottom = "10px";
debug.style.padding = "8px 10px";
debug.style.background = "rgba(255,255,255,0.9)";
debug.style.border = "1px solid #ddd";
debug.style.borderRadius = "10px";
debug.style.font = "12px/1.3 system-ui";
debug.textContent = "Debug: chargement…";
document.body.appendChild(debug);

// =====================
// 1) CONFIG
// =====================
const SUPABASE_URL = "https://votckpjacugwoqowjcow.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kzB2e_oa8VfzGCYlyELKng_YYV8_zJd";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Tes 2 fichiers GeoJSON dans le repo
const SOURCES = [
  { key: "dep",     url: "./data/dep_4326.geojson" },
  { key: "fleuves", url: "./data/fleuves_4326.geojson" }
];

// Supabase
const TABLE = "chansons";
const JOIN_COL = "anciens_id";     // côté Supabase
const GEO_ID_PROP = "ID";          // côté GeoJSON: properties.ID

// Pagination
const PAGE_SIZE = 8;

// Colonnes à afficher dans la popup (ajuste selon ta table)
const DISPLAY_COLS = ["titre", "artiste"]; // adapte si besoin

// =====================
// 2) OUTILS
// =====================
function normalizeId(v) {
  if (v === null || v === undefined) return null;
  return String(v).trim();
}

async function fetchGeojson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GeoJSON introuvable: ${url} (${r.status})`);
  return r.json();
}

// =====================
// 3) CARTE
// =====================
const map = new maplibregl.Map({
  container: "map",
  style: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
        ],
        tileSize: 256,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
      }
    },
    layers: [
      {
        id: "osm",
        type: "raster",
        source: "osm"
      }
    ]
  },
  center: [2.35, 48.86],
  zoom: 6
});

// Permet de sélectionner / clic droit sans que la carte “vole” la souris
map.dragPan.disable();

// (Optionnel) réactiver si tu veux avec Shift + drag seulement
map.dragPan.enable({ linearity: 0.3 }); // si tu veux, sinon laisse désactivé

// =====================
// 4) POPUP PAGINÉE
// =====================
function makePopupDOM() {
  const el = document.createElement("div");
  el.className = "popup";
  el.innerHTML = `
    <div class="row">
      <div><b>ID</b>: <span data-id></span></div>
      <div class="muted" data-kind></div>
    </div>
    <div class="muted" data-status>Chargement…</div>
    <hr />
    <div class="items" data-items></div>
    <hr />
    <div class="row" style="align-items:center;">
      <button data-prev>◀ Précédent</button>
      <div class="muted" data-page>Page —</div>
      <button data-next>Suivant ▶</button>
    </div>
  `;
  return el;
}

function rowToDisplay(row) {
  // Affichage simple : titre + artiste (modifiable)
  const titre = row?.[DISPLAY_COLS[0]] ?? "(sans titre)";
  const artiste = row?.[DISPLAY_COLS[1]] ?? "";
  return { titre, artiste };
}

async function fetchPageForId(id, pageIndex) {
  const from = pageIndex * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // IMPORTANT:
  // - count:"exact" => on récupère le total pour calculer nb de pages
  // - range(from,to) => pagination
  const { data, error, count } = await supabase
    .from(TABLE)
    .select("*", { count: "exact" })
    .eq(JOIN_COL, id)
    .range(from, to);

  if (error) throw error;
  return { data: data || [], count: count ?? 0 };
}

function renderItems(itemsEl, rows) {
  itemsEl.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Aucune donnée associée.";
    itemsEl.appendChild(empty);
    return;
  }

  for (const r of rows) {
    const { titre, artiste } = rowToDisplay(r);
    const card = document.createElement("div");
    card.className = "item";
    card.innerHTML = `
      <div class="title">${escapeHtml(titre)}</div>
      ${artiste ? `<div class="sub">${escapeHtml(artiste)}</div>` : ""}
    `;
    itemsEl.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function openPaginatedPopup({ lngLat, id, kind }) {
  const dom = makePopupDOM();

  const idEl = dom.querySelector("[data-id]");
  const kindEl = dom.querySelector("[data-kind]");
  const statusEl = dom.querySelector("[data-status]");
  const itemsEl = dom.querySelector("[data-items]");
  const pageEl = dom.querySelector("[data-page]");
  const prevBtn = dom.querySelector("[data-prev]");
  const nextBtn = dom.querySelector("[data-next]");

  idEl.textContent = id ?? "—";
  kindEl.textContent = kind ? `(${kind})` : "";

  let pageIndex = 0;
  let totalCount = 0;
  let totalPages = 0;
  let isLoading = false;

  const popup = new maplibregl.Popup({ maxWidth: "380px" })
    .setLngLat(lngLat)
    .setDOMContent(dom)
    .addTo(map);

  async function loadPage(newPageIndex) {
    if (!id) return;
    if (isLoading) return;

    isLoading = true;
    statusEl.textContent = "Chargement…";
    prevBtn.disabled = true;
    nextBtn.disabled = true;

    try {
      pageIndex = newPageIndex;

      const { data, count } = await fetchPageForId(id, pageIndex);
      totalCount = count;
      totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

      renderItems(itemsEl, data);

      pageEl.textContent = `Page ${pageIndex + 1} / ${totalPages}`;
      statusEl.textContent = `${totalCount} élément(s) lié(s)`;

      prevBtn.disabled = pageIndex <= 0;
      nextBtn.disabled = pageIndex >= totalPages - 1;

    } catch (err) {
      console.error(err);
      statusEl.textContent = "Erreur de chargement";
      itemsEl.innerHTML = `<div class="muted">${escapeHtml(err?.message || String(err))}</div>`;
      pageEl.textContent = "Page —";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    } finally {
      isLoading = false;
    }
  }

  prevBtn.addEventListener("click", () => {
    if (pageIndex > 0) loadPage(pageIndex - 1);
  });

  nextBtn.addEventListener("click", () => {
    if (pageIndex < totalPages - 1) loadPage(pageIndex + 1);
  });

  // Charger la première page
  loadPage(0);

  return popup;
}

// =====================
// 5) CHARGER LES 2 GEOJSON + LAYERS
// =====================
function addLayerForSource(key, geojson) {
  const sourceId = `${key}-source`;
  const layerId = `${key}-layer`;

  map.addSource(sourceId, {
    type: "geojson",
    data: geojson
  });

  map.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    paint: {
      "line-width": 4
      // (Tu peux différencier dep / fleuves ici si tu veux)
    }
  });

  // clic => popup paginée (requête Supabase à ce moment-là)
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;

    const rawId = f.properties?.[GEO_ID_PROP];
    const id = normalizeId(rawId);

    openPaginatedPopup({
      lngLat: e.lngLat,
      id,
      kind: key
    });
  });

  map.on("mouseenter", layerId, () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", layerId, () => map.getCanvas().style.cursor = "");
}

map.on("load", async () => {
  try {
    for (const s of SOURCES) {
      const geojson = await fetchGeojson(s.url);
      addLayerForSource(s.key, geojson);
    }
  } catch (err) {
    console.error(err);
    alert("Erreur: " + (err?.message || err));
  }
});






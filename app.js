import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 🔑 Supabase
const SUPABASE_URL = "https://XXXX.supabase.co";
const SUPABASE_ANON_KEY = "XXXX";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 📄 GeoJSON dans le repo GitHub
const GEOJSON_URL = "./data/lignes.geojson";

// 🗺️ Carte
const map = new maplibregl.Map({
  container: "map",
  style: "https://demotiles.maplibre.org/style.json",
  center: [2.35, 48.86],
  zoom: 11
});

// 🔁 Chargement + jointure
async function loadAndJoin() {
  // 1️⃣ Charger le GeoJSON
  const geojson = await fetch(GEOJSON_URL).then(r => r.json());

  // 2️⃣ Récupérer tous les ID du GeoJSON
  const ids = [
    ...new Set(
      geojson.features
        .map(f => f?.properties?.ID)
        .filter(v => v !== null && v !== undefined)
    )
  ];

  // 3️⃣ Charger les données Supabase correspondantes
  const { data, error } = await supabase
    .from("chansons")            // 👈 ta table
    .select("*")
    .in("anciens_id", ids);      // 👈 clé de jointure

  if (error) throw error;

  // 4️⃣ Index Supabase par anciens_id
  const byId = new Map(
    data.map(row => [row.anciens_id, row])
  );

  // 5️⃣ Enrichir les features GeoJSON
  geojson.features.forEach(f => {
    const id = f.properties.ID;
    const supaRow = byId.get(id);

    f.properties = {
      ...f.properties,
      supabase: supaRow || null
    };
  });

  return geojson;
}

// 🚀 Initialisation carte
map.on("load", async () => {
  const joinedGeojson = await loadAndJoin();

  map.addSource("lines", {
    type: "geojson",
    data: joinedGeojson
  });

  map.addLayer({
    id: "lines-layer",
    type: "line",
    source: "lines",
    paint: {
      "line-width": 4,
      "line-color": "#2563eb"
    }
  });

  // 🖱️ Popup
  map.on("click", "lines-layer", (e) => {
    const props = e.features[0].properties;
    const supa = props.supabase
      ? JSON.parse(props.supabase)
      : null;

    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(`
        <b>ID GeoJSON :</b> ${props.ID}<br/>
        <b>Données Supabase :</b>
        <pre>${JSON.stringify(supa, null, 2)}</pre>
      `)
      .addTo(map);
  });

  map.on("mouseenter", "lines-layer", () => map.getCanvas().style.cursor = "pointer");
  map.on("mouseleave", "lines-layer", () => map.getCanvas().style.cursor = "");
});

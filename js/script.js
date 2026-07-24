// ============================================================
// DATOS REALES: la posición de la ISS viene de una API pública en
// vivo (wheretheiss.at), no está inventada. Cada tanto le preguntamos
// "¿dónde estás ahora?" y dibujamos la respuesta sobre el globo.
// ============================================================
const API_BASE = "https://api.wheretheiss.at/v1/satellites/25544";
const POLL_MS = 5000; // cada cuánto preguntamos la posición actual
const TRACK_POINTS = 8; // cuántos puntos pasados pedimos para el trazo
const TRACK_SPAN_SEC = 180; // separados por 3 minutos entre sí

// Textura real de la Tierra (proyección equirectangular, basada en
// datos de la NASA), de Solar System Scope, con licencia CC BY 4.0:
// https://commons.wikimedia.org/wiki/File:Solarsystemscope_texture_2k_earth_daymap.jpg
// La usamos para "leer" el color real de cada punto del planeta, en vez
// de dibujar manchas de un solo color donde creemos que hay tierra.
const EARTH_TEXTURE_URL = "https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg";

// manchas suaves que sugieren continentes: se usan SOLO como respaldo,
// por si la textura de arriba no llega a cargar (sin internet, el CDN
// caído, etc.). Así el globo nunca se queda vacío.
const CONTINENTS = [
  { latC: 45,  lonC: -100, latR: 25, lonR: 35 }, // Norteamérica
  { latC: -18, lonC: -60,  latR: 30, lonR: 20 }, // Sudamérica
  { latC: 50,  lonC: 15,   latR: 18, lonR: 22 }, // Europa
  { latC: 3,   lonC: 20,   latR: 30, lonR: 22 }, // África
  { latC: 45,  lonC: 90,   latR: 30, lonR: 45 }, // Asia
  { latC: -25, lonC: 135,  latR: 15, lonR: 18 }, // Oceanía
];

function nowClock() {
  return new Date().toISOString().substring(11, 19) + "Z";
}

// ============================================================
// TEXTURA -> PUNTOS
// No hacemos un mapeo de textura "de verdad" (eso pide WebGL). En vez
// de eso, muestreamos el color real de la imagen en un montón de
// puntos de latitud/longitud, UNA sola vez cuando carga la imagen, y
// guardamos esos puntos con su color ya calculado. Después, en cada
// fotograma, solo hace falta proyectarlos y dibujar un puntito de ese
// color: es la misma idea del "globo de puntos" que ya teníamos, nada
// más que ahora el color de cada punto es el de la Tierra de verdad.
// ============================================================
let texturePoints = null; // null hasta que la imagen termine de cargar (o falle)

function loadEarthTexture() {
  const img = new Image();
  img.crossOrigin = "anonymous"; // necesario para poder leer los colores del canvas después
  img.onload = () => {
    const off = document.createElement("canvas");
    off.width = img.width;
    off.height = img.height;
    const octx = off.getContext("2d");
    octx.drawImage(img, 0, 0);

    let sampled;
    try {
      sampled = octx.getImageData(0, 0, off.width, off.height);
    } catch (e) {
      // si por lo que sea el navegador no nos deja leer los colores (el
      // canvas queda "manchado"), no rompemos nada: seguimos con el
      // globo de respaldo, sin textura real
      return;
    }
    texturePoints = buildTexturePoints(sampled, off.width, off.height);
  };
  img.onerror = () => {
    // sin internet o el archivo no cargó: el globo de respaldo se queda
    // como está, la página sigue funcionando igual
  };
  img.src = EARTH_TEXTURE_URL;
}

function buildTexturePoints(imgData, iw, ih) {
  const points = [];
  const step = 2.5; // grados entre cada punto muestreado: más chico = más detalle, pero más lento
  for (let lat = -88; lat <= 88; lat += step) {
    for (let lon = -180; lon < 180; lon += step) {
      // de latitud/longitud a coordenadas de píxel dentro de la imagen
      const u = Math.min(iw - 1, Math.max(0, Math.floor(((lon + 180) / 360) * iw)));
      const v = Math.min(ih - 1, Math.max(0, Math.floor(((90 - lat) / 180) * ih)));
      const idx = (v * iw + u) * 4;
      const r = imgData.data[idx], g = imgData.data[idx + 1], b = imgData.data[idx + 2];

      // el océano es azul bien dominante en esta textura: lo salteamos,
      // así el globo no queda cubierto de puntos y los continentes
      // resaltan más (el fondo del globo ya sugiere el océano por sí solo)
      const isOcean = b > r + 20 && b > g + 5;
      if (isOcean) continue;

      points.push({ lat, lon, color: `${r},${g},${b}` });
    }
  }
  return points;
}

// ============================================================
// ESTADO GLOBAL
// ============================================================
const state = {
  iss: null,   // { lat, lon, alt, vel, visibility, ts } — null hasta el primer dato real
  feed: [],
};
let track = [];          // historial de posiciones, para el trazo de la órbita
let lastVisibility = null;
let pollCount = 0;
let connectionLost = false;

function pushFeed(text, sev = "info") {
  state.feed.unshift({ ts: nowClock(), text, sev });
  if (state.feed.length > 60) state.feed.pop();
  renderFeed();
}
function renderFeed() {
  const wrap = document.getElementById("feedList");
  wrap.innerHTML = state.feed.map((e) => `
    <div class="ev">
      <span class="ts">${e.ts}</span>
      <span class="tx">${e.text}</span>
      <span class="sev ${e.sev}">${e.sev}</span>
    </div>`).join("");
  document.getElementById("feedN").textContent = state.feed.length;
}

// ============================================================
// EL GLOBO: proyección 3D hecha a mano
// Convertimos latitud/longitud a un punto sobre una esfera de radio 1
// (coordenadas x,y,z), lo giramos según hacia dónde estamos "mirando"
// (rotY = eje vertical, tiltX = inclinación de la vista), y el resultado
// ya sirve para dibujar en 2D: x,y son la posición en pantalla, y z nos
// dice si el punto queda de frente (z>0, se ve) o del otro lado del
// globo (z<0, no se dibuja). Así es como cualquier motor 3D básico
// "aplana" una esfera para mostrarla en una pantalla plana.
// ============================================================
function project(lat, lon, rotYdeg, tiltXdeg) {
  const latR = (lat * Math.PI) / 180;
  const lonR = (lon * Math.PI) / 180;
  const x0 = Math.cos(latR) * Math.sin(lonR);
  const y0 = Math.sin(latR);
  const z0 = Math.cos(latR) * Math.cos(lonR);

  // giro alrededor del eje vertical (Y): "hacia qué longitud estamos mirando"
  const ry = (rotYdeg * Math.PI) / 180;
  const x1 = x0 * Math.cos(ry) + z0 * Math.sin(ry);
  const z1 = -x0 * Math.sin(ry) + z0 * Math.cos(ry);

  // inclinación alrededor del eje horizontal (X): mirar desde más arriba o más abajo
  const rx = (tiltXdeg * Math.PI) / 180;
  const y1 = y0 * Math.cos(rx) - z1 * Math.sin(rx);
  const z2 = y0 * Math.sin(rx) + z1 * Math.cos(rx);

  return { x: x1, y: y1, z: z2 };
}

// diferencia angular más corta entre dos ángulos (para que el globo
// siempre gire por el camino más corto, no siempre "hacia la derecha")
function lerpAngle(current, target, t) {
  const diff = ((target - current + 540) % 360) - 180;
  return current + diff * t;
}

// ============================================================
// CANVAS: bgcv dibuja las estrellas de fondo una sola vez (no rotan,
// son el "espacio" detrás de todo). fgcv es el globo entero: como acá
// TODO gira junto (continentes, líneas, la ISS), se redibuja completo
// en cada fotograma, a diferencia de los otros proyectos donde el
// fondo sí podía quedarse fijo.
// ============================================================
const stage = document.getElementById("stage");
const bgcv = document.getElementById("bgcv");
const fgcv = document.getElementById("fgcv");
const bgx = bgcv.getContext("2d");
const fgx = fgcv.getContext("2d");
let W = 0, H = 0, CX = 0, CY = 0, R = 0;

function resize() {
  const r = stage.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return;
  W = bgcv.width = fgcv.width = r.width;
  H = bgcv.height = fgcv.height = r.height;
  CX = W / 2;
  CY = H / 2;
  R = Math.min(W, H) * 0.38;
  drawStars();
}
new ResizeObserver(resize).observe(stage);

let starField = null;
function drawStars() {
  bgx.clearRect(0, 0, W, H);
  if (!starField || starField.w !== W || starField.h !== H) {
    const stars = [];
    const count = Math.floor((W * H) / 6000);
    for (let i = 0; i < count; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.3 + 0.2, a: Math.random() * 0.6 + 0.2 });
    }
    starField = { w: W, h: H, stars };
  }
  for (const st of starField.stars) {
    bgx.beginPath();
    bgx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    bgx.fillStyle = `rgba(230,225,255,${st.a})`;
    bgx.fill();
  }
}

// ---------- rotación: sigue a la ISS sola, salvo que la estés arrastrando ----------
let rotY = 0;       // ángulo actual del globo
let targetRotY = 0; // hacia dónde lo lleva el seguimiento automático
let tiltX = -15;    // inclinación de la vista (un poco "desde arriba", como de costumbre)
let dragging = false;
let lastDragX = 0, lastDragY = 0;
let userOverrideUntil = 0; // mientras estemos dentro de esta ventana, no auto-seguimos

fgcv.addEventListener("mousedown", (e) => {
  dragging = true;
  lastDragX = e.clientX;
  lastDragY = e.clientY;
  document.body.style.userSelect = "none";
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastDragX, dy = e.clientY - lastDragY;
  rotY += dx * 0.3;
  tiltX = Math.max(-60, Math.min(60, tiltX - dy * 0.3));
  lastDragX = e.clientX;
  lastDragY = e.clientY;
  userOverrideUntil = performance.now() + 4000; // pausa el seguimiento 4s después de soltar
});
window.addEventListener("mouseup", () => {
  dragging = false;
  document.body.style.userSelect = "";
});
fgcv.addEventListener("touchstart", (e) => {
  dragging = true;
  lastDragX = e.touches[0].clientX;
  lastDragY = e.touches[0].clientY;
}, { passive: true });
window.addEventListener("touchmove", (e) => {
  if (!dragging) return;
  const t = e.touches[0];
  const dx = t.clientX - lastDragX, dy = t.clientY - lastDragY;
  rotY += dx * 0.3;
  tiltX = Math.max(-60, Math.min(60, tiltX - dy * 0.3));
  lastDragX = t.clientX;
  lastDragY = t.clientY;
  userOverrideUntil = performance.now() + 4000;
}, { passive: true });
window.addEventListener("touchend", () => { dragging = false; });

document.getElementById("recenterBtn").addEventListener("click", () => {
  userOverrideUntil = 0; // el próximo fotograma retoma el seguimiento automático
});

// ---------- dibujo del globo, fotograma a fotograma ----------
function drawGlobeBase() {
  const grad = fgx.createRadialGradient(CX - R * 0.3, CY - R * 0.3, R * 0.1, CX, CY, R);
  grad.addColorStop(0, "rgba(70,55,130,0.55)");
  grad.addColorStop(1, "rgba(10,8,30,0.15)");
  fgx.beginPath();
  fgx.arc(CX, CY, R, 0, Math.PI * 2);
  fgx.fillStyle = grad;
  fgx.fill();
  fgx.strokeStyle = "rgba(167,139,250,0.35)";
  fgx.lineWidth = 1.2;
  fgx.stroke();
}

// dibuja una línea (meridiano o paralelo) recorriendo una serie de
// puntos, cortando el trazo cada vez que pasa a la cara oculta del globo
function drawGraticuleLine(points) {
  let prev = null;
  for (const [lat, lon] of points) {
    const p = project(lat, lon, rotY, tiltX);
    const visible = p.z > 0.02;
    const sx = CX + p.x * R, sy = CY - p.y * R;
    if (visible && prev && prev.visible) {
      fgx.beginPath();
      fgx.moveTo(prev.sx, prev.sy);
      fgx.lineTo(sx, sy);
      fgx.stroke();
    }
    prev = { sx, sy, visible };
  }
}
function drawGraticule() {
  fgx.strokeStyle = "rgba(103,232,249,0.14)";
  fgx.lineWidth = 1;
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 5) pts.push([lat, lon]);
    drawGraticuleLine(pts);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 5) pts.push([lat, lon]);
    drawGraticuleLine(pts);
  }
}

function drawContinents() {
  if (texturePoints) drawTexturedContinents();
  else drawFallbackContinents();
}

// el globo "de verdad": un puntito por cada lugar de tierra firme, con
// su color real tomado de la textura (ver buildTexturePoints)
function drawTexturedContinents() {
  for (const pt of texturePoints) {
    const p = project(pt.lat, pt.lon, rotY, tiltX);
    if (p.z < 0.03) continue;
    const sx = CX + p.x * R, sy = CY - p.y * R;
    fgx.globalAlpha = 0.55 + p.z * 0.4; // más cerca del centro del globo, más opaco
    fgx.fillStyle = `rgb(${pt.color})`;
    fgx.beginPath();
    fgx.arc(sx, sy, 1.4, 0, Math.PI * 2);
    fgx.fill();
  }
  fgx.globalAlpha = 1;
}

// respaldo: las manchas estilizadas de siempre, mientras la textura real
// no haya terminado de cargar (o si no llegó a cargar nunca)
function drawFallbackContinents() {
  fgx.fillStyle = "rgba(180,170,230,0.55)";
  for (const c of CONTINENTS) {
    for (let dlat = -c.latR; dlat <= c.latR; dlat += 5) {
      for (let dlon = -c.lonR; dlon <= c.lonR; dlon += 5) {
        // solo puntos dentro de una elipse, para que la mancha no sea un rectángulo
        if ((dlat * dlat) / (c.latR * c.latR) + (dlon * dlon) / (c.lonR * c.lonR) > 1) continue;
        const p = project(c.latC + dlat, c.lonC + dlon, rotY, tiltX);
        if (p.z < 0.05) continue;
        const sx = CX + p.x * R, sy = CY - p.y * R;
        fgx.globalAlpha = 0.3 + p.z * 0.45;
        fgx.beginPath();
        fgx.arc(sx, sy, 1.3, 0, Math.PI * 2);
        fgx.fill();
      }
    }
  }
  fgx.globalAlpha = 1;
}

function drawGroundTrack() {
  if (track.length < 2) return;
  fgx.lineWidth = 1.5;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    const pa = project(a.lat, a.lon, rotY, tiltX);
    const pb = project(b.lat, b.lon, rotY, tiltX);
    if (pa.z < 0.02 || pb.z < 0.02) continue;
    const alpha = 0.12 + (i / track.length) * 0.5; // el tramo más viejo, más transparente
    fgx.strokeStyle = `rgba(103,232,249,${alpha})`;
    fgx.beginPath();
    fgx.moveTo(CX + pa.x * R, CY - pa.y * R);
    fgx.lineTo(CX + pb.x * R, CY - pb.y * R);
    fgx.stroke();
  }
}

function drawIssMarker() {
  if (!state.iss) return;
  const p = project(state.iss.lat, state.iss.lon, rotY, tiltX);
  if (p.z < 0) return; // está del otro lado del globo ahora mismo, no se dibuja
  const sx = CX + p.x * R, sy = CY - p.y * R;

  const pulseR = 8 + 4 * Math.sin(performance.now() / 220);
  fgx.beginPath();
  fgx.arc(sx, sy, pulseR, 0, Math.PI * 2);
  fgx.strokeStyle = "rgba(103,232,249,0.55)";
  fgx.lineWidth = 1.2;
  fgx.stroke();

  fgx.beginPath();
  fgx.arc(sx, sy, 4.5, 0, Math.PI * 2);
  fgx.fillStyle = "#67e8f9";
  fgx.shadowColor = "#67e8f9";
  fgx.shadowBlur = 14;
  fgx.fill();
  fgx.shadowBlur = 0;

  fgx.font = "600 11px JetBrains Mono, monospace";
  fgx.fillStyle = "rgba(236,233,251,0.9)";
  fgx.fillText("ISS", sx + 9, sy - 6);
  fgx.font = "9px JetBrains Mono, monospace";
  fgx.fillStyle = "rgba(139,132,184,0.85)";
  fgx.fillText(`${Math.round(state.iss.alt)} km`, sx + 9, sy + 7);
}

function drawFrame() {
  fgx.clearRect(0, 0, W, H);

  if (!dragging && performance.now() > userOverrideUntil) {
    rotY = lerpAngle(rotY, targetRotY, 0.02);
  }

  drawGlobeBase();
  drawGraticule();
  drawContinents();
  drawGroundTrack();
  drawIssMarker();

  requestAnimationFrame(drawFrame);
}

// ============================================================
// DATOS EN VIVO: pedirle la posición a la API real cada pocos segundos
// ============================================================
async function fetchCurrent() {
  try {
    const res = await fetch(API_BASE);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    onNewPosition(data);
    if (connectionLost) {
      connectionLost = false;
      setLiveStatus(true);
      pushFeed("Connection to tracking API restored", "info");
    }
  } catch (err) {
    if (!connectionLost) {
      connectionLost = true;
      setLiveStatus(false);
      pushFeed("Lost connection to tracking API — retrying…", "crit");
    }
  }
}

async function fetchTrackHistory() {
  try {
    const now = Math.floor(Date.now() / 1000);
    const stamps = [];
    for (let i = TRACK_POINTS; i >= 1; i--) stamps.push(now - i * TRACK_SPAN_SEC);
    const res = await fetch(`${API_BASE}/positions?timestamps=${stamps.join(",")}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    track = data.map((p) => ({ lat: p.latitude, lon: p.longitude, ts: p.timestamp }));
  } catch (err) {
    // si esto falla no es grave: el trazo simplemente arranca vacío y se va llenando solo
  }
}

function onNewPosition(data) {
  state.iss = {
    lat: data.latitude, lon: data.longitude, alt: data.altitude,
    vel: data.velocity, visibility: data.visibility, ts: data.timestamp,
  };
  track.push({ lat: data.latitude, lon: data.longitude, ts: data.timestamp });
  if (track.length > TRACK_POINTS + 4) track.shift();

  // el globo gira de a poco hasta dejar la longitud actual de la ISS de frente
  targetRotY = ((-data.longitude % 360) + 360) % 360;

  renderKpis();
  document.getElementById("updatedTag").textContent = "UPDATED " + nowClock();

  if (lastVisibility && lastVisibility !== data.visibility) {
    const text = data.visibility === "daylight" ? "ISS entered sunlight" : "ISS entered Earth's shadow (eclipsed)";
    pushFeed(text, "warn");
  }
  lastVisibility = data.visibility;

  // no hace falta anunciar cada actualización (cada 5s sería demasiado
  // ruido); una de cada tres alcanza para que la bitácora se sienta viva
  pollCount++;
  if (pollCount % 3 === 0) {
    pushFeed(`Position update — lat ${data.latitude.toFixed(2)}°, lon ${data.longitude.toFixed(2)}°, alt ${Math.round(data.altitude)} km`, "info");
  }
}

function setLiveStatus(ok) {
  document.getElementById("liveTag").classList.toggle("lost", !ok);
  document.getElementById("liveText").textContent = ok ? "LIVE" : "OFFLINE";
}

// ============================================================
// INTERFAZ
// ============================================================
function renderKpis() {
  const s = state.iss;
  if (!s) return;
  document.getElementById("kpiAlt").textContent = `${Math.round(s.alt)} km`;
  document.getElementById("kpiSpeed").textContent = `${Math.round(s.vel).toLocaleString("en-US")} km/h`;
  document.getElementById("kpiLat").textContent = `${Math.abs(s.lat).toFixed(2)}°${s.lat >= 0 ? "N" : "S"}`;
  document.getElementById("kpiLon").textContent = `${Math.abs(s.lon).toFixed(2)}°${s.lon >= 0 ? "E" : "W"}`;

  const visEl = document.getElementById("visBadge");
  visEl.classList.remove("daylight", "eclipsed");
  visEl.classList.add(s.visibility === "daylight" ? "daylight" : "eclipsed");
  document.getElementById("visText").textContent = s.visibility === "daylight" ? "In sunlight" : "In Earth's shadow";
}

// ---------- reloj ----------
function tickClock() {
  document.getElementById("utcClock").textContent = nowClock();
}
setInterval(tickClock, 1000);

// ---------- arrastrar para agrandar la barra lateral y la bitácora ----------
// mismo mecanismo que en los otros dos proyectos: el ancho/alto vive en
// variables CSS, y arrastrar una "tirita" las va cambiando dentro de un
// mínimo y un máximo, recordando el tamaño elegido en localStorage
const MIN_SIDE_W = 220, MAX_SIDE_W = 460;
const MIN_FEED_H = 90, MAX_FEED_H = 360;

function setupResizer({ handle, cssVar, min, max, getValue, storageKey }) {
  let draggingPanel = false;

  function apply(value) {
    const clamped = Math.min(max, Math.max(min, value));
    document.documentElement.style.setProperty(cssVar, `${clamped}px`);
    resize(); // el globo no siempre se entera solo de un cambio de tamaño "de grid"
  }
  function start(e) {
    draggingPanel = true;
    handle.classList.add("dragging");
    document.body.style.userSelect = "none";
    e.preventDefault();
  }
  function stop() {
    if (!draggingPanel) return;
    draggingPanel = false;
    handle.classList.remove("dragging");
    document.body.style.userSelect = "";
    try {
      localStorage.setItem(storageKey, document.documentElement.style.getPropertyValue(cssVar));
    } catch (e) {
      // si el navegador bloquea localStorage no pasa nada grave
    }
  }

  handle.addEventListener("mousedown", start);
  window.addEventListener("mousemove", (e) => { if (draggingPanel) apply(getValue(e.clientX, e.clientY)); });
  window.addEventListener("mouseup", stop);
  handle.addEventListener("touchstart", start, { passive: false });
  window.addEventListener("touchmove", (e) => {
    if (!draggingPanel) return;
    const t = e.touches[0];
    apply(getValue(t.clientX, t.clientY));
    e.preventDefault();
  }, { passive: false });
  window.addEventListener("touchend", stop);

  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) document.documentElement.style.setProperty(cssVar, saved);
  } catch (e) {
    // si falla, se usa el tamaño por defecto
  }
}

setupResizer({
  handle: document.getElementById("vsizer"), cssVar: "--side-w",
  min: MIN_SIDE_W, max: MAX_SIDE_W,
  getValue: (clientX) => clientX,
  storageKey: "iss-side-w",
});
setupResizer({
  handle: document.getElementById("hsizer"), cssVar: "--feed-h",
  min: MIN_FEED_H, max: MAX_FEED_H,
  getValue: (clientX, clientY) => window.innerHeight - clientY,
  storageKey: "iss-feed-h",
});

// ============================================================
// ARRANQUE
// ============================================================
resize();
tickClock();
loadEarthTexture();
pushFeed("Connecting to live ISS telemetry feed…", "info");
fetchTrackHistory().then(fetchCurrent);
setInterval(fetchCurrent, POLL_MS);

requestAnimationFrame(drawFrame);

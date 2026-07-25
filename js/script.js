// ============================================================
// TEXTOS (ES / EN)
// Los textos fijos (etiquetas, títulos) son simples strings. Los
// mensajes de la bitácora son funciones porque necesitan "rellenarse"
// con datos reales (la latitud, la altitud) cada vez que se usan.
// ============================================================
const I18N = {
  en: {
    title: "ISS Tracker — Live Orbital Position",
    subTitle: "LIVE ORBITAL POSITION",
    live: "LIVE",
    offline: "OFFLINE",
    recenter: "RE-CENTER ON ISS",
    lblAlt: "Altitude",
    lblSpeed: "Velocity",
    lblLat: "Latitude",
    lblLon: "Longitude",
    dirE: "E", dirW: "W", // letras de longitud: en español el oeste es "O", no "W"
    acquiring: "Acquiring signal…",
    sunlight: "In sunlight",
    eclipsed: "In Earth's shadow",
    missionFacts: "Mission Facts",
    factLaunched: "Launched",
    factPeriod: "Orbital period",
    factIncl: "Inclination",
    factCrew: "Crew capacity",
    factOrbits: "Orbits / day",
    aboutTitle: "About this project",
    aboutText: "The station's position updates every few seconds from a public, real-time tracking API — this isn't simulated data. Drag the globe to look around; it re-centers on the ISS automatically after a moment.",
    creditText: 'Earth texture by <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a>, CC BY 4.0.',
    hint: "drag to look around",
    telemetryLog: "Telemetry Log",
    updated: "UPDATED",
    feed: {
      connecting: () => "Connecting to live ISS telemetry feed…",
      positionUpdate: (lat, lon, alt) => `Position update — lat ${lat}°, lon ${lon}°, alt ${alt} km`,
      enteredSunlight: () => "ISS entered sunlight",
      enteredShadow: () => "ISS entered Earth's shadow (eclipsed)",
      connectionLost: () => "Lost connection to tracking API — retrying…",
      connectionRestored: () => "Connection to tracking API restored",
    },
  },
  es: {
    title: "ISS Tracker — Posición Orbital en Vivo",
    subTitle: "POSICIÓN ORBITAL EN VIVO",
    live: "EN VIVO",
    offline: "SIN CONEXIÓN",
    recenter: "RECENTRAR EN LA ISS",
    lblAlt: "Altitud",
    lblSpeed: "Velocidad",
    lblLat: "Latitud",
    lblLon: "Longitud",
    dirE: "E", dirW: "O",
    acquiring: "Adquiriendo señal…",
    sunlight: "Iluminada por el sol",
    eclipsed: "En la sombra de la Tierra",
    missionFacts: "Datos de la Misión",
    factLaunched: "Lanzamiento",
    factPeriod: "Período orbital",
    factIncl: "Inclinación",
    factCrew: "Capacidad de tripulación",
    factOrbits: "Órbitas / día",
    aboutTitle: "Sobre este proyecto",
    aboutText: "La posición de la estación se actualiza cada pocos segundos desde una API pública en vivo: no son datos simulados. Arrastra el globo para mirar alrededor; vuelve a centrarse en la ISS solo, después de un momento.",
    creditText: 'Textura de la Tierra de <a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope</a>, CC BY 4.0.',
    hint: "arrastra para mirar alrededor",
    telemetryLog: "Bitácora de Telemetría",
    updated: "ACTUALIZADO",
    feed: {
      connecting: () => "Conectando a la telemetría en vivo de la ISS…",
      positionUpdate: (lat, lon, alt) => `Actualización de posición — lat ${lat}°, lon ${lon}°, alt ${alt} km`,
      enteredSunlight: () => "La ISS entró a la luz del sol",
      enteredShadow: () => "La ISS entró a la sombra de la Tierra (eclipsada)",
      connectionLost: () => "Se perdió la conexión con la API — reintentando…",
      connectionRestored: () => "Conexión con la API restablecida",
    },
  },
};

function getSavedLang() {
  try {
    const saved = localStorage.getItem("iss-tracker-lang");
    if (saved === "es" || saved === "en") return saved;
  } catch (e) {
    // localStorage puede fallar en navegación privada; usamos el default
  }
  return "en";
}

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

      // guardamos también el vector 3D de este punto (calculado una sola
      // vez acá) para no tener que recalcularlo cada fotograma cuando
      // más adelante haga falta saber si está de día o de noche
      points.push({ lat, lon, color: `${r},${g},${b}`, vec: toVec3(lat, lon) });
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
  lang: getSavedLang(),
};
let track = [];          // historial de posiciones, para el trazo de la órbita
let lastVisibility = null;
let pollCount = 0;
let connectionLost = false;

// Guardamos el "tipo" de evento (kind) y sus datos (args), no el texto
// final: así, si el usuario cambia de idioma después, podemos volver a
// armar cada línea de la bitácora en el otro idioma sin perder el historial.
function pushFeed(kind, args, sev = "info") {
  state.feed.unshift({ ts: nowClock(), kind, args, sev });
  if (state.feed.length > 60) state.feed.pop();
  renderFeed();
}
function feedText(entry) {
  return I18N[state.lang].feed[entry.kind](...entry.args);
}
function renderFeed() {
  const wrap = document.getElementById("feedList");
  wrap.innerHTML = state.feed.map((e) => `
    <div class="ev">
      <span class="ts">${e.ts}</span>
      <span class="tx">${feedText(e)}</span>
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
// TERMINADOR DÍA/NOCHE
// La API nos da "solar_lat/solar_lon": el punto de la Tierra que en
// este momento tiene al sol justo encima (el "mediodía solar"). A
// partir de ahí se puede calcular tanto la línea que separa el día de
// la noche, como saber si un punto cualquiera del globo está de día o
// de noche, con matemática de vectores bastante simple.
// ============================================================
function toVec3(lat, lon) {
  const latR = (lat * Math.PI) / 180, lonR = (lon * Math.PI) / 180;
  return { x: Math.cos(latR) * Math.sin(lonR), y: Math.sin(latR), z: Math.cos(latR) * Math.cos(lonR) };
}
function dot3(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function normalize3(v) {
  const m = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

let subSolarVec = null;      // el punto que tiene al sol justo encima, ahora mismo
let terminatorPoints = [];   // la línea día/noche, ya calculada como lista de lat/lon

// El terminador es, ni más ni menos, el círculo máximo formado por
// todos los puntos que quedan exactamente a 90° del punto subsolar (el
// horizonte del sol, visto desde cualquier lugar de ese círculo). Para
// dibujarlo, buscamos dos direcciones perpendiculares al punto
// subsolar (U y V) y recorremos el círculo que forman.
function computeTerminator(solarLat, solarLon) {
  const S = toVec3(solarLat, solarLon);
  const arbitrary = Math.abs(S.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const U = normalize3(cross3(S, arbitrary));
  const V = cross3(S, U); // ya sale unitario: S y U ya son perpendiculares y unitarios

  const pts = [];
  for (let t = 0; t < 360; t += 2) {
    const rad = (t * Math.PI) / 180;
    const x = U.x * Math.cos(rad) + V.x * Math.sin(rad);
    const y = U.y * Math.cos(rad) + V.y * Math.sin(rad);
    const z = U.z * Math.cos(rad) + V.z * Math.sin(rad);
    pts.push({ lat: (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI, lon: (Math.atan2(x, z) * 180) / Math.PI });
  }
  return pts;
}

function drawTerminator() {
  if (!terminatorPoints.length) return;
  fgx.strokeStyle = "rgba(251,191,36,0.55)"; // dorado, como el sol
  fgx.lineWidth = 1.3;
  let prev = null;
  for (const { lat, lon } of terminatorPoints) {
    const p = project(lat, lon, rotY, tiltX);
    const visible = p.z > 0.01;
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
  // Antes esto era bastante transparente (para dar sensación de "vidrio"),
  // pero dejaba ver el fondo de estrellas a través del planeta, lo cual
  // no ayuda a leer los continentes. Ahora es casi opaco de punta a
  // punta: el degradé solo se usa para dar sensación de volumen (más
  // claro donde "pega la luz", más oscuro en el borde), no para
  // transparentar el globo.
  const grad = fgx.createRadialGradient(CX - R * 0.3, CY - R * 0.3, R * 0.1, CX, CY, R);
  grad.addColorStop(0, "rgba(95,75,175,0.98)");
  grad.addColorStop(0.65, "rgba(48,38,100,0.97)");
  grad.addColorStop(1, "rgba(22,17,58,0.95)");
  fgx.beginPath();
  fgx.arc(CX, CY, R, 0, Math.PI * 2);
  fgx.fillStyle = grad;
  fgx.fill();
  fgx.strokeStyle = "rgba(167,139,250,0.45)";
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
// su color real tomado de la textura (ver buildTexturePoints), y más
// oscuro en el lado que ahora mismo está de noche
function drawTexturedContinents() {
  for (const pt of texturePoints) {
    const p = project(pt.lat, pt.lon, rotY, tiltX);
    if (p.z < 0.03) continue;
    const sx = CX + p.x * R, sy = CY - p.y * R;

    // el producto punto entre este punto y el punto subsolar nos dice
    // si nos está dando el sol (positivo) o no (negativo); usamos ese
    // valor para oscurecer de a poco, no de golpe, como en un atardecer
    let brightness = 1;
    if (subSolarVec) {
      const d = dot3(pt.vec, subSolarVec);
      brightness = d > 0.08 ? 1 : d < -0.08 ? 0.32 : 0.32 + ((d + 0.08) / 0.16) * 0.68;
    }

    // antes esto arrancaba en 0.55 de opacidad (bastante transparente);
    // ahora arranca mucho más alto, para que los países se lean claros
    // en vez de verse como puntos sueltos con el fondo asomando entre medio
    fgx.globalAlpha = 0.88 + p.z * 0.12;
    if (brightness >= 1) {
      fgx.fillStyle = `rgb(${pt.color})`;
    } else {
      const [r, g, b] = pt.color.split(",");
      fgx.fillStyle = `rgb(${Math.round(r * brightness)},${Math.round(g * brightness)},${Math.round(b * brightness)})`;
    }
    fgx.beginPath();
    fgx.arc(sx, sy, 1.4, 0, Math.PI * 2);
    fgx.fill();
  }
  fgx.globalAlpha = 1;
}

// respaldo: las manchas estilizadas de siempre, mientras la textura real
// no haya terminado de cargar (o si no llegó a cargar nunca)
function drawFallbackContinents() {
  fgx.fillStyle = "rgba(190,180,235,0.95)";
  for (const c of CONTINENTS) {
    for (let dlat = -c.latR; dlat <= c.latR; dlat += 5) {
      for (let dlon = -c.lonR; dlon <= c.lonR; dlon += 5) {
        // solo puntos dentro de una elipse, para que la mancha no sea un rectángulo
        if ((dlat * dlat) / (c.latR * c.latR) + (dlon * dlon) / (c.lonR * c.lonR) > 1) continue;
        const p = project(c.latC + dlat, c.lonC + dlon, rotY, tiltX);
        if (p.z < 0.05) continue;
        const sx = CX + p.x * R, sy = CY - p.y * R;
        fgx.globalAlpha = 0.8 + p.z * 0.2;
        fgx.beginPath();
        fgx.arc(sx, sy, 1.4, 0, Math.PI * 2);
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
  drawTerminator();
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
      pushFeed("connectionRestored", [], "info");
    }
  } catch (err) {
    if (!connectionLost) {
      connectionLost = true;
      setLiveStatus(false);
      pushFeed("connectionLost", [], "crit");
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
  const isFirstFix = !state.iss;

  state.iss = {
    lat: data.latitude, lon: data.longitude, alt: data.altitude,
    vel: data.velocity, visibility: data.visibility, ts: data.timestamp,
  };
  track.push({ lat: data.latitude, lon: data.longitude, ts: data.timestamp });
  if (track.length > TRACK_POINTS + 4) track.shift();

  // el globo gira de a poco hasta dejar la longitud actual de la ISS de frente
  targetRotY = ((-data.longitude % 360) + 360) % 360;

  // dónde está el sol ahora mismo, para el terminador y para saber qué
  // parte del globo está de noche (ver drawTerminator / drawTexturedContinents)
  if (typeof data.solar_lat === "number" && typeof data.solar_lon === "number") {
    subSolarVec = toVec3(data.solar_lat, data.solar_lon);
    terminatorPoints = computeTerminator(data.solar_lat, data.solar_lon);
  }

  if (isFirstFix) {
    document.getElementById("stageLoading").classList.add("hidden");
  }

  renderKpis();
  document.getElementById("updatedTag").textContent = `${I18N[state.lang].updated} ${nowClock()}`;

  if (lastVisibility && lastVisibility !== data.visibility) {
    pushFeed(data.visibility === "daylight" ? "enteredSunlight" : "enteredShadow", [], "warn");
  }
  lastVisibility = data.visibility;

  // no hace falta anunciar cada actualización (cada 5s sería demasiado
  // ruido); una de cada tres alcanza para que la bitácora se sienta viva
  pollCount++;
  if (pollCount % 3 === 0) {
    pushFeed("positionUpdate", [data.latitude.toFixed(2), data.longitude.toFixed(2), Math.round(data.altitude)], "info");
  }
}

function setLiveStatus(ok) {
  document.getElementById("liveTag").classList.toggle("lost", !ok);
  document.getElementById("liveText").textContent = ok ? I18N[state.lang].live : I18N[state.lang].offline;
}

// ============================================================
// INTERFAZ
// ============================================================
// Los números de telemetría cambian cada 5 segundos; si los reemplazamos
// de golpe, la interfaz se siente "a los saltos". Estas dos funciones
// animan el valor mostrado desde el número anterior hasta el nuevo, en
// vez de reemplazarlo de una.
const kpiAnimState = {}; // último valor mostrado (no el real) de cada KPI, para poder animar desde ahí
function animateValue(id, newValue, formatFn, duration = 700) {
  const el = document.getElementById(id);
  const from = kpiAnimState[id] !== undefined ? kpiAnimState[id] : newValue;
  runTween(from, newValue, duration, (v) => { el.textContent = formatFn(v); });
  kpiAnimState[id] = newValue;
}
// igual que animateValue, pero para ángulos que pueden "dar la vuelta"
// (la longitud pasa de +179° a -179° al cruzar el antimeridiano; sin
// este ajuste, se animaría dando toda la vuelta larga por el medio)
function animateAngle(id, newValue, formatFn, duration = 700) {
  const el = document.getElementById(id);
  let from = kpiAnimState[id] !== undefined ? kpiAnimState[id] : newValue;
  const diff = newValue - from;
  if (diff > 180) from += 360;
  else if (diff < -180) from -= 360;
  runTween(from, newValue, duration, (v) => { el.textContent = formatFn(v); });
  kpiAnimState[id] = newValue;
}
function runTween(from, to, duration, onFrame) {
  // primer pantallazo inmediato y SIN esperar a requestAnimationFrame:
  // si la pestaña está en segundo plano, el navegador puede pausar rAF
  // por completo, y no queremos que el número se quede pegado en el
  // placeholder ("—") por eso
  onFrame(from);
  if (from === to) return; // nada que animar

  const start = performance.now();
  let done = false;
  function step(now) {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // ease-out: rápido al principio, suave al llegar
    onFrame(from + (to - from) * eased);
    if (t < 1) requestAnimationFrame(step);
    else done = true;
  }
  requestAnimationFrame(step);

  // red de seguridad: si rAF nunca llega a correr, igual queremos que el
  // valor termine siendo el correcto, aunque sin la animación
  setTimeout(() => {
    if (!done) { done = true; onFrame(to); }
  }, duration + 60);
}

function renderKpis() {
  const s = state.iss;
  if (!s) return;
  const t = I18N[state.lang];
  animateValue("kpiAlt", s.alt, (v) => `${Math.round(v)} km`);
  animateValue("kpiSpeed", s.vel, (v) => `${Math.round(v).toLocaleString("en-US")} km/h`);
  animateValue("kpiLat", s.lat, (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`);
  animateAngle("kpiLon", s.lon, (v) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? t.dirE : t.dirW}`);

  const visEl = document.getElementById("visBadge");
  visEl.classList.remove("daylight", "eclipsed");
  visEl.classList.add(s.visibility === "daylight" ? "daylight" : "eclipsed");
  document.getElementById("visText").textContent = t[s.visibility === "daylight" ? "sunlight" : "eclipsed"];
}

// ---------- reloj ----------
function tickClock() {
  document.getElementById("utcClock").textContent = nowClock();
}
setInterval(tickClock, 1000);

// ---------- botón de idioma ----------
// Cambia el idioma activo y vuelve a pintar todo lo que tiene texto: las
// etiquetas fijas del HTML (marcadas con data-i18n), el crédito de la
// textura (que lleva un link adentro, por eso se maneja aparte), la
// bitácora completa (incluido lo que ya estaba escrito antes de cambiar
// de idioma) y el resto de los textos que arma JavaScript.
function applyLanguage(lang) {
  state.lang = lang;
  document.documentElement.lang = lang;
  document.title = I18N[lang].title;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = I18N[lang][el.dataset.i18n];
  });
  document.querySelectorAll("#langSeg button").forEach((b) => {
    b.classList.toggle("on", b.dataset.lang === lang);
  });
  document.getElementById("creditText").innerHTML = I18N[lang].creditText;

  setLiveStatus(!connectionLost);
  renderKpis();
  renderFeed();
  if (state.iss) {
    document.getElementById("updatedTag").textContent = `${I18N[lang].updated} ${nowClock()}`;
  }

  try {
    localStorage.setItem("iss-tracker-lang", lang);
  } catch (e) {
    // si el navegador bloquea localStorage no pasa nada grave
  }
}

document.getElementById("langSeg").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  applyLanguage(btn.dataset.lang);
});

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
applyLanguage(state.lang);
loadEarthTexture();
pushFeed("connecting", [], "info");
fetchTrackHistory().then(fetchCurrent);
setInterval(fetchCurrent, POLL_MS);

requestAnimationFrame(drawFrame);

# ISS Tracker — Live Orbital Position

Rastreador en vivo de la Estación Espacial Internacional (ISS), sobre un globo 3D dibujado a mano en `<canvas>`. A diferencia de mis otros dos proyectos de este estilo (que son simulaciones), acá la posición es real: viene de una API pública en vivo, no está inventada.

## Ver la demo

Es una sola página, sin dependencias ni instalación. Basta con abrir `index.html` en el navegador, o servirla con cualquier servidor estático:

```bash
npx serve .
```

## Qué tiene

- Globo 3D estilizado, hecho a mano con proyección esférica (latitud/longitud → x,y,z → pantalla), sin ninguna librería de gráficos ni WebGL: solo trigonometría y `<canvas>`.
- Posición real de la ISS, actualizada cada 5 segundos desde [wheretheiss.at](https://wheretheiss.at/), con altitud, velocidad y si está iluminada por el sol o en la sombra de la Tierra.
- El globo sigue a la ISS solo (gira de a poco para mantenerla de frente); se puede arrastrar para mirar alrededor, y vuelve a seguirla sola a los pocos segundos, o al tocar "Re-center on ISS".
- Trazo de la órbita reciente (últimos ~24 minutos), pedido a la misma API.
- Bitácora en vivo: actualizaciones de posición y avisos reales cuando la estación entra o sale de la sombra de la Tierra.
- Si se pierde la conexión con la API, lo avisa (no se rompe en silencio) y reintenta solo.
- Responsive, con los mismos paneles ajustables de mis otros proyectos.

## Stack

HTML, CSS y JavaScript puro (sin frameworks ni build). Tipografías Rajdhani y JetBrains Mono desde Google Fonts. Datos en vivo de la API pública y gratuita de [wheretheiss.at](https://wheretheiss.at/w/developer).

## Estructura del proyecto

```
iss-tracker/
├── index.html      estructura de la página
├── css/
│   └── styles.css  todos los estilos
└── js/
    └── script.js   proyección 3D del globo, conexión a la API y la interfaz
```

## Despliegue

Al ser un archivo estático, se puede publicar gratis con GitHub Pages: Settings → Pages → Deploy from branch → rama `main`, carpeta raíz.

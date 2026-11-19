// FROZEN COPY — do not edit. The software factory's frame-geometry measure (design-system/assets/geometria.mjs),
// copied verbatim from the factory repo at commit db243003^ (git show db243003^:design-system/assets/geometria.mjs),
// its last version: the factory retired it in db243003, after its marketplace 1.47.0 (this copy also carries the two
// changes it got after that release, 205400fc and 1d03780c: MAR-15 and MAR-08). It imports nothing. The portal keeps
// measuring its own frame with it (tests/browser/run-checks.mjs, portalGeometryChecks), the same precedent as
// tests/fixtures/legacy-flow.html. Its rules are the visual manual's; the comments below are the factory's, in Spanish.

// geometria.mjs — el marco de página medido a cada ancho y entre pantallas (manual visual 2.2 a 2.5, marco.md;
// specs 2026-09-30, 2026-10-01, 2026-10-02, 2026-10-05 y 2026-10-06). MEDIR_GEOMETRIA corre en la página y solo mide;
// el resto decide en Node, para poder probarlo sin navegador (evals/marco-conjunto/test-geometria.mjs). Lo usan
// recorre-demo.mjs (guion-demo/4) y mide-pantallas.mjs (bucle de construcción).

// Corre en la página (page.evaluate(MEDIR_GEOMETRIA, { selectorMarco })): no puede usar nada de fuera de esta función.
// `selectorMarco` solo para un lienzo anterior al manual 2.1 (guion `marco.selector`); por defecto, [data-rol="marco"].
export const MEDIR_GEOMETRIA = (opts) => {
  const selMarco = (opts && opts.selectorMarco) || '[data-rol="marco"]';
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const contenido = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { x: Math.round(r.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)),
      der: Math.round(r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)) };
  };
  const borde = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), der: Math.round(r.right), arriba: Math.round(r.top + scrollY) }; };
  const texto = (el) => (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
  const aplanar = (el) => [...el.children].flatMap((c) => {
    const cs = getComputedStyle(c), r = c.getBoundingClientRect();
    if (cs.display === "contents" || ((r.width === 0 || r.height === 0) && c.children.length)) return aplanar(c);
    return [c];
  });
  const main = document.querySelector("main");
  if (!main) return { vw, sinMain: true };
  // Presente: se pinta (ni él ni un ancestro con display:none) y no está oculto. A diferencia de visible(), vale vacío
  // (una zona de avisos sin avisos). Una pantalla que la app deja en el DOM con `hidden` no aporta su h1 ni sus zonas.
  const presente = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const primero = (sel) => [...main.querySelectorAll(sel)].find(presente) || null;
  const h1 = primero("h1");
  const cab = h1 ? h1.closest('[data-rol="cabecera"]') : null;
  const zonaAvisos = primero('[data-rol="avisos"]');
  const esAvisoEl = (el) => el.matches('[role="alert"],[role="status"]');
  const avisoTop = (el) => !el.closest("section") && !el.closest("form,fieldset,label") && !el.closest("aside");
  // Avisos de la pagina
  let avisosEls;
  if (zonaAvisos) avisosEls = aplanar(zonaAvisos).filter(visible);
  else avisosEls = [...main.querySelectorAll('[role="alert"],[role="status"]')].filter((a) => visible(a) && texto(a) && avisoTop(a)
    && !(cab && cab.contains(a)));
  const avisos = avisosEls.map((a) => ({ texto: texto(a), ...borde(a) }));
  // Marco
  const marcos = [...main.querySelectorAll(selMarco)].filter(visible);
  const marco = marcos[0] || null;
  // Columna efectiva (sin marco). Fuera de ella: el h1, la franja del título, los avisos, la zona de avisos y lo lateral.
  const fuera = (c) => (h1 && (c === h1 || h1.contains(c))) || (cab && (c === cab || cab.contains(c))) || esAvisoEl(c)
    || avisosEls.some((a) => c === a || a.contains(c)) || (zonaAvisos && (c === zonaAvisos || zonaAvisos.contains(c)))
    || c.closest("aside");
  // Un bloque que envuelve el h1, la franja o la zona de avisos junto con el resto (un contenedor de página propio) no
  // se descarta: se abre, y entra en la cadena de nivel de página (MAR-08 ve su ancho).
  const envuelve = (c) => (h1 && c.contains(h1)) || (cab && c.contains(cab)) || (zonaAvisos && c.contains(zonaAvisos));
  const cadena = [main];
  const nivel = (el) => aplanar(el).filter((c) => visible(c) && !fuera(c))
    .flatMap((c) => (envuelve(c) ? (cadena.push(c), nivel(c)) : [c]));
  let bloques = nivel(main);
  while (bloques.length === 1) {
    cadena.push(bloques[0]);
    const hijos = nivel(bloques[0]);
    if (hijos.length !== 1) break;
    bloques = hijos;
  }
  const union = (els) => {
    const cs = els.map(contenido);
    return cs.length ? { x: Math.min(...cs.map((c) => c.x)), der: Math.max(...cs.map((c) => c.der)) } : null;
  };
  const columna = bloques.length === 1 ? contenido(bloques[0]) : union(bloques);
  const zonaCuerpo = primero('[data-rol="cuerpo"]');
  const contenedor = marco ? contenido(marco) : columna;
  const cuerpo = zonaCuerpo ? contenido(zonaCuerpo) : marco ? contenido(marco) : columna;
  // Destino activo y franja
  const activo = [...document.querySelectorAll('[aria-current="page"]')].find((e) => !main.contains(e) && visible(e));
  const NO_DATO = "h1,button,a,[role=button],nav,[role=navigation]";
  let franjaExtra = false;
  if (cab) {
    const w = document.createTreeWalker(cab, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const p = n.parentElement;
      if (p.closest(NO_DATO) || !visible(p)) continue;
      franjaExtra = true; break;
    }
  }
  // Accion principal
  const ap = [...document.querySelectorAll('[data-rol="accion-principal"]')].find(visible);
  let accion = null;
  if (ap) {
    const b = borde(ap);
    let zona = "otra", caja = null;
    let fila = null;
    if (cab && cab.contains(ap)) { zona = "cabecera"; caja = contenido(cab); }
    else {
      const f = ap.closest("form");
      if (f) {
        const ctrls = [...f.querySelectorAll("button,input,select,textarea,a[href]")].filter(visible);
        if (ctrls[ctrls.length - 1] === ap || ap.contains(ctrls[ctrls.length - 1])) { zona = "formulario"; caja = contenido(f); }
      }
      // MAR-06 en un estado vacío (manual 2.8, EST-01): la vía directa va al final del bloque data-rol="vacio", después de
      // su mensaje y su pista: ningún texto visible del bloque fuera de un control viene después de ella en el orden de
      // lectura, y después de su fila (su padre dentro del bloque; sin él, la acción sola) no viene nada visible del
      // bloque: ni texto ni otro grupo de controles (Ruling 26). Los controles de su misma fila sí (la convención
      // `.actions` de la base: la principal primero, las demás a su lado). Su alineación es la de su fila frente al
      // bloque; centrada con el vacío, «centro». Sin la marca (una medida anterior al 2.8), nada cambia: «otra».
      const v = f ? null : ap.closest('[data-rol="vacio"]');
      if (v) {
        const CONTROL = "button,a[href],input,select,textarea,[role=button],[role=link]";
        const contenedorFila = ap.parentElement && ap.parentElement !== v && v.contains(ap.parentElement) ? ap.parentElement : null;
        const suFila = contenedorFila || ap;
        const trasLaFila = (n) => !suFila.contains(n) && Boolean(suFila.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING);
        let antes = false, luego = false;
        const tw = document.createTreeWalker(v, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          const p = n.parentElement;
          if (!n.textContent.trim() || ap.contains(n) || !visible(p)) continue;
          if (trasLaFila(n)) { luego = true; continue; }
          if (p.closest(CONTROL)) continue;
          if (ap.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) luego = true; else antes = true;
        }
        // Un control sin texto (un botón de solo icono) después de la fila también cuenta.
        if (!luego) luego = [...v.querySelectorAll(CONTROL)].some((c) => visible(c) && trasLaFila(c));
        if (antes && !luego) {
          zona = "vacio"; caja = contenido(v);
          const enFila = contenedorFila ? [...contenedorFila.children].filter(visible).map(borde) : [b];
          fila = { x: Math.min(...enFila.map((c) => c.x)), der: Math.max(...enFila.map((c) => c.der)) };
        }
      }
    }
    const centrada = (c) => Math.abs((c.x + c.der) / 2 - (caja.x + caja.der) / 2) <= 1;
    // Una fila que llena el bloque también está centrada: «centro» se mira primero.
    const alineacion = !caja ? null : fila ? (centrada(fila) ? "centro" : Math.abs(fila.x - caja.x) <= 1 ? "inicio"
      : Math.abs(fila.der - caja.der) <= 1 ? "fin" : "medio")
      : Math.abs(b.der - caja.der) <= 1 ? "fin" : Math.abs(b.x - caja.x) <= 1 ? "inicio" : "medio";
    // MAR-06 en el celular (manual 2.4): los textos visibles de la franja (el h1 incluido; fuera los de la acción y los de
    // otros botones o enlaces) que empiezan más abajo que el borde superior de la acción (+1). Sin franja, ninguno. Un
    // texto fuera de la acción con el centro en su caja (±1) es su rótulo puesto encima: tampoco cuenta. Uno de su fila a
    // su izquierda (termina antes de su borde izquierdo +1 y empieza antes de su borde inferior) va antes: tampoco.
    const despues = [];
    if (zona === "cabecera") {
      const ra = ap.getBoundingClientRect();
      const deLaAccion = (r) => Math.abs((r.left + r.right) / 2 - (ra.left + ra.right) / 2) <= ra.width / 2 + 1
        && Math.abs((r.top + r.bottom) / 2 - (ra.top + ra.bottom) / 2) <= ra.height / 2 + 1;
      const antesEnSuFila = (r) => r.right <= ra.left + 1 && r.top < ra.bottom;
      const w = document.createTreeWalker(cab, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n && despues.length < 10; n = w.nextNode()) {
        const t = n.textContent.replace(/\s+/g, " ").trim(), p = n.parentElement;
        if (!t || ap.contains(n) || p.closest("button,a,[role=button]") || !visible(p)) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        if (r.height > 0 && !deLaAccion(r) && !antesEnSuFila(r) && Math.round(r.top + scrollY) > b.arriba + 1) despues.push(t.slice(0, 40));
      }
    }
    accion = { zona, alineacion, ...b, despues };
  }
  // Desborde
  const de = document.documentElement;
  const clipa = (el) => { for (let a = el.parentElement; a && a !== document.body && a !== de; a = a.parentElement) {
    const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
  const fueraDeVentana = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!visible(el) || el.children.length) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && !clipa(el) && getComputedStyle(el).position !== "fixed") fueraDeVentana.push({ texto: texto(el) || el.tagName.toLowerCase(), der: Math.round(r.right) });
  }
  const cajasConScroll = [...main.querySelectorAll("*")].filter((el) => visible(el)
    && ["auto", "scroll"].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
    .map((el) => ({ texto: texto(el), rol: el.getAttribute("role") || el.tagName.toLowerCase() }));
  // Anchos propios (MAR-08, parte en la pagina)
  const PERMITIDO = (v) => !v || ["none", "auto", "100%", "initial", "unset"].includes(v.trim()) || v.includes("var(--marco-") || v.includes("var(--medida-");
  const reglasDe = (el) => {
    const out = [];
    for (const hoja of document.styleSheets) {
      let rs; try { rs = hoja.cssRules; } catch { continue; }
      for (const r of rs) { if (!r.selectorText || !r.style) continue; let m = false; try { m = el.matches(r.selectorText); } catch {} if (m) out.push(r.style); }
    }
    return out;
  };
  const nivelPagina = marco ? (() => { const c = []; for (let a = marco; a && a !== main.parentElement; a = a.parentElement) c.push(a); return c; })() : cadena;
  const anchosPropios = [];
  for (const el of nivelPagina) for (const st of [el.style, ...reglasDe(el)]) for (const prop of ["width", "max-width"]) {
    const v = st.getPropertyValue(prop);
    if (!PERMITIDO(v)) anchosPropios.push({ elemento: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""), prop, valor: v.trim() });
  }
  // FUN-12
  const lineasLargas = [];
  for (const el of main.querySelectorAll("p,li")) {
    if (!visible(el) || el.closest("table,dl,[role=grid],[role=table],nav,button")) continue;
    const t = el.textContent.replace(/\s+/g, " ").trim();
    if (t.length < 40) continue;
    const rg = document.createRange(); rg.selectNodeContents(el);
    const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 1).map((r) => Math.round(r.top)));
    const lineas = tops.size;
    if (lineas >= 2 && t.length / lineas > 80) lineasLargas.push({ texto: t.slice(0, 50), cpl: Math.round(t.length / lineas) });
  }
  // FUN-14
  const truncados = [];
  for (const el of main.querySelectorAll("h1,h2,h3,h4,h5,h6,label,legend,button,[role=alert],[role=status]")) {
    for (const x of [el, ...el.querySelectorAll("*")]) {
      if (!visible(x)) continue;
      const cs = getComputedStyle(x);
      const corta = (cs.textOverflow === "ellipsis" || ["hidden", "clip"].includes(cs.overflowX)) && x.scrollWidth > x.clientWidth + 1;
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none" && x.scrollHeight > x.clientHeight + 1;
      if (corta || clamp) { truncados.push({ texto: texto(x) }); break; }
    }
  }
  // AJU-05 (manual 2.5, spec 2026-10-06 §6.1): la sub-navegación entre secciones (su borde y sus pestañas; null si la
  // pantalla no la marca). Una pestaña es un a, button o [role=tab] visible que no está dentro de otro («Más» también).
  const caja4 = (r) => ({ x: Math.round(r.left), der: Math.round(r.right), arriba: Math.round(r.top + scrollY), abajo: Math.round(r.bottom + scrollY) });
  const PESTANA = 'a,button,[role="tab"]';
  const subnavEl = [...main.querySelectorAll('[data-rol="subnavegacion"]')].find(visible) || null;
  const subnavegacion = subnavEl ? { ...caja4(subnavEl.getBoundingClientRect()),
    items: [...subnavEl.querySelectorAll(PESTANA)].filter((el) => { const p = el.parentElement && el.parentElement.closest(PESTANA);
      return visible(el) && !(p && subnavEl.contains(p)); }).slice(0, 40)
      .map((el) => ({ texto: texto(el), ...caja4(el.getBoundingClientRect()) })) } : null;
  // MAR-09: los bloques de formulario del cuerpo y la medida que trae el sistema (manual 2.2). La sección lado a lado que
  // contiene a cada uno (`base`, manual 2.5) se le suma más abajo, con ladoALado.
  const formEls = [...main.querySelectorAll('[data-medida="formulario"]')].filter(visible);
  const formularios = formEls.map((el) => ({ ...borde(el) }));
  // Un token de ancho del sistema, medido con una sonda (null si :root no lo define): la medida de formulario (MAR-09) y
  // el margen de página (MAR-11, manual 2.5).
  const anchoDeToken = (nombre) => {
    if (!getComputedStyle(de).getPropertyValue(nombre).trim()) return null;
    const sonda = document.createElement("div");
    sonda.style.cssText = `position:absolute;visibility:hidden;height:0;width:var(${nombre})`;
    document.body.appendChild(sonda);
    const v = Math.round(sonda.getBoundingClientRect().width);
    sonda.remove();
    return v;
  };
  const medidaFormulario = anchoDeToken("--medida-formulario");
  const margenPagina = anchoDeToken("--marco-margen-pagina");
  // NAV-07: lo que muestra la navegación global (fuera de <main> y del menú de situaciones de la demo).
  const navs = [...document.querySelectorAll('nav,[role="navigation"],header,[role="banner"]')]
    .filter((n) => !main.contains(n) && !n.closest('aside[aria-label="Situaciones de la demo"]') && presente(n));
  // MAR-11 (manual 2.5, spec 2026-10-06 §5.1): el área de contenido va del borde derecho de la navegación global lateral
  // al ancho de la ventana. Es lateral la primera de `navs` que empieza en el borde izquierdo, termina antes del marco y
  // se superpone con él en vertical; la de arriba no cuenta, ni una escondida fuera de la ventana (termina en x ≤ 1).
  // Sin marco, desde 0.
  const rMarco = marco ? marco.getBoundingClientRect() : null;
  const lateral = rMarco ? navs.map((n) => n.getBoundingClientRect()).find((r) => r.width > 2 && r.height > 2 && r.left <= 1
    && r.right > 1 && r.right <= rMarco.left + 1 && r.top < rMarco.bottom && rMarco.top < r.bottom) : null;
  const area = { x: lateral ? Math.round(lateral.right) : 0, der: vw };
  const nombreImg = (el) => (el.getAttribute("alt") || el.getAttribute("aria-label")
    || ((el.querySelector && el.querySelector("title")) ? el.querySelector("title").textContent : "") || "").trim();
  const navegacion = navs.length ? {
    imagenes: navs.flatMap((n) => [...n.querySelectorAll('img,svg[role="img"],[role="img"]')]).filter(visible)
      .map((el) => ({ alt: nombreImg(el) })),
    textos: navs.flatMap((n) => {
      const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT), t = [];
      for (let x = w.nextNode(); x; x = w.nextNode()) {
        const s = x.textContent.replace(/\s+/g, " ").trim();
        if (s && x.parentElement && visible(x.parentElement)) t.push(s.slice(0, 60));
      }
      return t;
    }).slice(0, 40),
  } : null;
  // ---- Manual 2.3 (spec 2026-10-02 §5 a §7): lo que miden las reglas nuevas; decide evaluaAncho. ----
  // Colores calculados: «rgb(…)», «rgba(…)» o «color(srgb …)» → [r, g, b, alfa] (0–255); otro formato → null.
  const rgba = (c) => {
    const s = String(c || "").trim();
    let mm = s.match(/^rgba?\(([^)]*)\)$/);
    if (mm) { const n = mm[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat); return n.length >= 3 ? [n[0], n[1], n[2], n.length > 3 ? n[3] : 1] : null; }
    mm = s.match(/^color\(srgb ([^)]*)\)$/);
    if (mm) { const n = mm[1].split(/[\s/]+/).filter(Boolean).map(parseFloat); return n.length >= 3 ? [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1] : null; }
    return null;
  };
  const transparente = (c) => { if (!c || c === "transparent" || c === "none") return true; const x = rgba(c); return x ? x[3] === 0 : false; };
  // Fondo efectivo: el color de fondo no transparente del ancestro más cercano (body y html incluidos), o blanco.
  const fondoEfectivo = (el) => {
    for (let x = el; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; if (!transparente(b)) return b; }
    return "rgb(255, 255, 255)";
  };
  // Superficie: fondo propio distinto del de detrás, o bordes izquierdo Y derecho visibles, o sombra. Un borde solo
  // inferior o superior (un divisor) no hace fondo.
  const memoFondo = new Map();
  const conFondo = (el) => {
    if (memoFondo.has(el)) return memoFondo.get(el);
    const cs = getComputedStyle(el);
    const lado = (w, c) => parseFloat(w) > 0 && !transparente(c);
    const si = (!transparente(cs.backgroundColor) && cs.backgroundColor !== fondoEfectivo(el.parentElement))
      || (lado(cs.borderLeftWidth, cs.borderLeftColor) && lado(cs.borderRightWidth, cs.borderRightColor))
      || (cs.boxShadow && cs.boxShadow !== "none");
    memoFondo.set(el, Boolean(si));
    return Boolean(si);
  };
  // Los cuatro radios en px, en el orden de CSS: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda.
  const radiosDe = (el) => {
    const cs = getComputedStyle(el), w = el.getBoundingClientRect().width;
    return ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].map((p) => {
      const v = String(cs[p] || "0").split(" ")[0];
      return Math.round(v.endsWith("%") ? (parseFloat(v) * w) / 100 : parseFloat(v) || 0);
    });
  };
  const exterior = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), der: Math.round(r.right), arriba: Math.round(r.top + scrollY), abajo: Math.round(r.bottom + scrollY) }; };
  const nombreEl = (el) => el.getAttribute("data-rol") || el.tagName.toLowerCase()
    + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/)[0] : "");
  const pistas = (v) => (!v || v === "none" ? 1 : v.replace(/\[[^\]]*\]/g, " ").trim().split(/\s+/).filter(Boolean).length);
  const posicionada = (el) => ["absolute", "fixed"].includes(getComputedStyle(el).position);
  // Los hijos que cuentan para la línea de inicio y los bloques: visibles, sin lo lateral, el formulario (MAR-09) ni lo
  // posicionado, y nunca la franja del título ni la zona de avisos (un envoltorio que los contiene se abre).
  const deLaFranja = (c) => [h1, cab, zonaAvisos, ...avisosEls].some((x) => x && (c === x || x.contains(c)));
  const hijosV = (el) => aplanar(el).filter((c) => visible(c) && !posicionada(c) && !deLaFranja(c)
    && !c.matches('aside,[data-rol="lateral"],[data-medida="formulario"]')).flatMap((c) => (envuelve(c) ? hijosV(c) : [c]));
  // Vertical: bloque o flow-root sin hijos en línea, flex en columna o grid de una sola pista.
  const esVertical = (el) => {
    const cs = getComputedStyle(el), d = cs.display;
    if (d === "flex" || d === "inline-flex") return cs.flexDirection.startsWith("column");
    if (d === "grid" || d === "inline-grid") return pistas(cs.gridTemplateColumns) <= 1;
    if (!["block", "flow-root", "list-item"].includes(d)) return false;
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return false;
      if (n.nodeType === 1 && getComputedStyle(n).display.startsWith("inline") && visible(n)) return false;
    }
    return true;
  };
  const esHorizontal = (el) => {
    const cs = getComputedStyle(el), d = cs.display;
    return ((d === "flex" || d === "inline-flex") && cs.flexDirection.startsWith("row"))
      || ((d === "grid" || d === "inline-grid") && pistas(cs.gridTemplateColumns) >= 2);
  };
  // Columna (Rulings 3 y 6): hija de un contenedor horizontal, sin fondo, vertical y con 2 o más hijos visibles apilados.
  const esColumna = (el) => !conFondo(el) && esVertical(el) && hijosV(el).length >= 2;
  // Una fila de tabla (tr, role=row, table-row, o con 2 o más hermanos de la misma etiqueta y la misma clase, no vacía)
  // es UNA sola fila, aunque una celda apile dos líneas (Ruling 8). Hermanos sin clase no bastan, y por repetición no es
  // fila de tabla si alguna hija es una superficie con fondo o tiene un encabezado: el criterio de celda de COM-08
  // (Ruling 12).
  const ENCABEZADO = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  const esCelda = (c) => !conFondo(c) && !c.matches(ENCABEZADO) && !c.querySelector(ENCABEZADO);
  const filaDeTabla = (el) => {
    if (el.matches('tr,[role="row"]') || getComputedStyle(el).display === "table-row") return true;
    const clase = (el.getAttribute("class") || "").trim();
    return Boolean(clase) && Boolean(el.parentElement) && [...el.parentElement.children].filter((h) => h !== el
      && h.tagName === el.tagName && (h.getAttribute("class") || "").trim() === clase).length >= 2
      && [...el.children].filter(visible).every(esCelda);
  };
  const conColumnas = (el) => esHorizontal(el) && !filaDeTabla(el) && hijosV(el).some(esColumna);
  // MAR-10: las filas del cuerpo. x0 = el mínimo entre el x de sus textos que no están sobre una superficie dentro de la
  // fila y el x de sus superficies más externas; una fila con fondo empieza en su x. base = el borde de su sección.
  const filas = [];
  // Ruling 14: una fila cuyo contenido va al centro o al final (text-align center/right/end en lo que lleva su texto, o
  // un flex/grid con justify-content/justify-items center/end) no se mide: su x no dice nada de la sangría. Ruling 28:
  // tenga los hijos que tenga (una barra de dos botones al final, una paginación o unas pestañas centradas);
  // space-between no cuenta, porque su primer hijo sí va al inicio.
  const alCentroOFinal = (v) => /center|right|end/.test(String(v || ""));
  const filaCentrada = (row) => {
    const cs = getComputedStyle(row);
    if (!/flex|grid/.test(cs.display)) return false;
    return alCentroOFinal(cs.justifyContent) || (/grid/.test(cs.display) && alCentroOFinal(cs.justifyItems));
  };
  // Ruling 16: el inicio de una fila también lo marcan sus gráficos (un icono antes del texto). Ruling 24 (b): un control
  // (botón, pestaña, enlace) con fondo o borde visibles (conFondo: fondo propio, bordes a los dos lados o sombra) empieza
  // en su caja; sin ellos (un botón fantasma, una pestaña sin fondo, aunque lleve una raya abajo), en su texto o su icono:
  // la caja invisible puede salirse con un margen negativo, el texto va en la línea.
  const GRAFICO = 'svg,img,canvas,[role="img"],i,[aria-hidden="true"]';
  const esControl = (el) => el.matches('button,[role="tab"],[role="button"],a');
  // Ruling 25: una raya de acento a la izquierda (border-left visible) también es caja visible de un control (una
  // navegación lateral con raya): empieza en su caja.
  const conCaja = (el) => conFondo(el) || (esControl(el) && (() => { const cs = getComputedStyle(el);
    return parseFloat(cs.borderLeftWidth) > 0 && cs.borderLeftStyle !== "none" && !transparente(cs.borderLeftColor); })());
  // Recorre `n` y llama aporta(x, alineado) por cada texto, gráfico, superficie o control que marca el inicio. Cada aporte
  // dice si su línea va al centro o al final (Ruling 14).
  const recorre = (n, aporta) => {
    for (const h of n.childNodes) {
      if (h.nodeType === 3) {
        if (!h.textContent.trim() || getComputedStyle(h.parentElement).visibility === "hidden") continue;
        const rg = document.createRange(); rg.selectNodeContents(h);
        const al = alCentroOFinal(getComputedStyle(h.parentElement).textAlign);
        for (const r of rg.getClientRects()) if (r.width > 0) aporta(r.left, al);
      } else if (h.nodeType === 1) {
        const cs = getComputedStyle(h);
        if (cs.display === "none" || posicionada(h)) continue;
        const enLinea = cs.display.startsWith("inline") && alCentroOFinal(getComputedStyle(h.parentElement).textAlign);
        if (h.matches(GRAFICO) || conCaja(h)) {
          if (visible(h)) aporta(h.getBoundingClientRect().left, enLinea);
          continue;
        }
        if (esControl(h)) {
          const x = inicioDeControl(h);
          if (x !== Infinity) aporta(x, enLinea || corrido(h, x));
          continue;
        }
        recorre(h, aporta);
      }
    }
  };
  // El inicio de un control sin fondo ni borde: lo primero que se ve dentro (texto, icono, superficie). Su text-align por
  // dentro no cuenta, salvo que corra el texto (corrido).
  const inicioDeControl = (el) => { let x = Infinity; recorre(el, (xi) => { x = Math.min(x, xi); }); return x; };
  // Un control más ancho que su texto, centrado o al final por dentro (un botón a todo el ancho con el texto al centro):
  // el texto queda corrido de su borde interior y su x no dice nada de la sangría. Un botón que se ajusta a su texto, no.
  const corrido = (el, x) => {
    const cs = getComputedStyle(el), d = cs.display;
    // En flex el eje horizontal es justify-content en fila y align-items en columna; en grid, justify-items o -content.
    const porCaja = /flex/.test(d) ? alCentroOFinal(cs.flexDirection.startsWith("column") ? cs.alignItems : cs.justifyContent)
      : /grid/.test(d) ? alCentroOFinal(cs.justifyItems) || alCentroOFinal(cs.justifyContent) : false;
    return (alCentroOFinal(cs.textAlign) || porCaja) && x > contenido(el).x + 1;
  };
  const fila = (row, base) => {
    let x0 = Infinity;
    // Una fila con fondo (o un control con fondo, borde o raya a la izquierda visibles) empieza en su caja exterior.
    if (conCaja(row)) x0 = row.getBoundingClientRect().left;
    else if (esControl(row)) {
      // Una fila que es ella misma un control sin fondo ni borde (una pestaña vertical) empieza en su texto (Ruling 24 b).
      const x = inicioDeControl(row);
      if (x === Infinity || corrido(row, x)) return;
      x0 = x;
    } else {
      if (filaCentrada(row)) return;
      // Si todos los aportes van al centro o al final, la fila no se mide (Ruling 14).
      let aportes = 0, alineados = 0;
      recorre(row, (x, alineado) => { x0 = Math.min(x0, x); aportes += 1; if (alineado) alineados += 1; });
      if (aportes && alineados === aportes) return;
    }
    if (x0 !== Infinity && filas.length < 200) filas.push({ x0: Math.round(x0), base: Math.round(base), texto: texto(row) });
  };
  // Ruling 19: un contenedor vertical con todo su contenido centrado (text-align center, o flex en columna con
  // align-items center) no tiene línea de inicio: no aporta filas, tenga los hijos que tenga.
  const centrado = (el) => {
    const cs = getComputedStyle(el);
    return /center/.test(cs.textAlign) || (/flex/.test(cs.display) && cs.flexDirection.startsWith("column") && /center/.test(cs.alignItems));
  };
  const baja = (el, base) => {
    for (const c of hijosV(el)) {
      // Con fondo, o un control con caja visible (Ruling 25: también con raya a la izquierda), es una fila por su caja
      // aunque por dentro apile su contenido.
      if (conCaja(c)) fila(c, base);
      else if (esVertical(c) && centrado(c)) continue;
      else if (conColumnas(c)) columnas(c, base);
      else if (esVertical(c) && hijosV(c).length) baja(c, base);
      else fila(c, base);
    }
  };
  // Un contenedor horizontal con columnas (Ruling 6) da su propia fila (empieza donde empieza su primera hija: su relleno
  // o su margen se ven), baja por cada hija que es columna con base = su borde exterior, y cada hija que no lo es es una
  // fila: con la base heredada si es la primera, con su propio borde exterior si no.
  const columnas = (el, base) => {
    const hs = hijosV(el);
    const primerTexto = (() => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim()) return n.textContent.replace(/\s+/g, " ").trim().slice(0, 60); return ""; })();
    if (filas.length < 200) filas.push({ x0: exterior(hs[0]).x, base: Math.round(base), texto: primerTexto });
    hs.forEach((h, i) => {
      if (esColumna(h)) baja(h, exterior(h).x);
      else if (i === 0) fila(h, base);
      // Con su borde exterior solo si el texto empieza al inicio (justificado cuenta, Ruling 20): una cifra a la derecha o
      // un texto centrado no se mide.
      else if (["start", "left", "justify"].includes(getComputedStyle(h).textAlign)) fila(h, exterior(h).x);
    });
  };
  const raizCuerpo = zonaCuerpo || marco || main;
  if (cuerpo) (conColumnas(raizCuerpo) ? columnas : baja)(raizCuerpo, cuerpo.x);
  // FUN-37: los bloques apilados. La franja (caja exterior), la zona de avisos si muestra un aviso y los bloques de primer
  // nivel del cuerpo; se baja mientras el cuerpo tenga un solo hijo y ese hijo sea un envoltorio (Rulings 6 a 8): un
  // contenedor vertical de bloques, sin fondo y sin encabezado propio, de cualquier etiqueta salvo una lista, una tabla o
  // un formulario. Una sola sección con nombre es un bloque, y entonces se mide solo el salto franja → cuerpo.
  const nombreBloque = (el) => { const h = [...el.querySelectorAll("h2,h3,h4,h5,h6")].find(presente); return h ? texto(h) : texto(el).slice(0, 40); };
  // Una lista, una tabla o un formulario (<form> o [data-medida="formulario"], Ruling 21) no son envoltorio (Ruling 7): un
  // cuerpo hecho de uno solo es un bloque.
  const NO_ENVOLTORIO = 'ul,ol,dl,table,form,[data-medida="formulario"],[role="list"],[role="table"],[role="grid"],[role="rowgroup"]';
  // Encabezado propio: su primera hija visible es un encabezado, o un header/hgroup/div cuyo primer elemento lo es.
  const esEncabezado = (el) => /^H[1-6]$/.test(el.tagName);
  const encabezadoPropio = (el) => {
    const p = [...el.children].find(visible);
    return Boolean(p) && (esEncabezado(p)
      || (["HEADER", "HGROUP", "DIV"].includes(p.tagName) && Boolean(p.firstElementChild) && esEncabezado(p.firstElementChild)));
  };
  const envoltorio = (el) => !conFondo(el) && !el.matches(NO_ENVOLTORIO) && esVertical(el) && !encabezadoPropio(el);
  // Ruling 18: un formulario de primer nivel cuenta como bloque (las filas de MAR-10 lo saltan; los bloques, no).
  const hijosB = (el) => aplanar(el).filter((c) => visible(c) && !posicionada(c) && !deLaFranja(c)
    && !c.matches('aside,[data-rol="lateral"]')).flatMap((c) => (envuelve(c) ? hijosB(c) : [c]));
  let primeros = hijosB(raizCuerpo);
  while (primeros.length === 1 && envoltorio(primeros[0]) && hijosB(primeros[0]).length) primeros = hijosB(primeros[0]);
  // FUN-42 (manual 2.4): el primer texto visible de cada bloque, el de más arriba (no el primero del DOM): la primera
  // línea de su nodo de texto (el rect más alto del Range), en coordenadas de documento; null si el bloque no tiene.
  const primerTextoVisible = (el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let mejor = null;
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim() || !visible(n.parentElement)) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const r = [...rg.getClientRects()].filter((x) => x.height > 0).sort((p, q) => p.top - q.top)[0];
      if (r && (!mejor || r.top < mejor.top)) mejor = r;
    }
    return mejor ? { arriba: Math.round(mejor.top + scrollY), abajo: Math.round(mejor.bottom + scrollY) } : null;
  };
  const bloquesV = [];
  const elDeBloque = new Map(); // bloque medido → su elemento: FUN-43 le suma `contenido` con extension(), más abajo
  const anotaBloque = (el, nombre) => { const e = exterior(el), b = { nombre, arriba: e.arriba, abajo: e.abajo, texto: primerTextoVisible(el) };
    bloquesV.push(b); elDeBloque.set(b, el); };
  if (cab) anotaBloque(cab, "franja");
  if (zonaAvisos && avisosEls.length) anotaBloque(zonaAvisos, "avisos");
  for (const c of primeros) anotaBloque(c, nombreBloque(c));
  bloquesV.sort((p, q) => p.arriba - q.arriba);
  const sondaPx = (valor, prop) => {
    const s = document.createElement("div");
    s.style.cssText = `position:absolute;visibility:hidden;width:0;height:0;${prop}:${valor}`;
    document.body.appendChild(s);
    const r = s.getBoundingClientRect(); s.remove();
    return prop === "width" ? r.width : r.height;
  };
  const entreBloques = getComputedStyle(de).getPropertyValue("--espacio-entre-bloques").trim()
    ? Math.round(sondaPx("var(--espacio-entre-bloques)", "height")) : null;
  // FUN-38 y FUN-39: las superficies de la navegación global y de <main>, más lo fijo fuera de <main> (spec §5.5; tope 80).
  const zonas = new Set();
  for (const z of [...navs, main]) { zonas.add(z); for (const e of z.querySelectorAll("*")) zonas.add(e); }
  const fijos = [...document.body.querySelectorAll("*")].filter((el) => !zonas.has(el) && !main.contains(el)
    && getComputedStyle(el).position === "fixed" && !el.closest('aside[aria-label="Situaciones de la demo"]'));
  const INTERACTIVO = "button,a,input,select,textarea,label,summary,[role=button],[role=tab],[role=menuitem]";
  // Ruling 27: la extensión del contenido de una superficie es lo que se ve: los textos, los gráficos, los campos y las
  // cajas con fondo o con borde visibles (en cualquier lado: un divisor de borde a borde llega a los dos bordes). Se baja
  // por los contenedores sin fondo ni borde, también por un control sin caja visible (Ruling 24 b): una caja invisible de
  // 0 a 160 (la «marca» de la navegación lateral de Radar) no dice dónde queda el contenido. Lo que recorta (overflow
  // distinto de visible) limita lo de dentro a su caja: un texto cortado con puntos suspensivos no pasa del borde.
  const conBorde = (el) => { const cs = getComputedStyle(el);
    return ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none"
      && !transparente(cs[`border${s}Color`])); };
  const CAMPO = "input,select,textarea,video,iframe,progress,meter";
  const TOLERANCIA = 1; // la de geometria.mjs (TOLERANCIA_PX): esta función corre en la página y no la ve
  // Ruling 24 (a): hacia dónde va el contenido de una caja. En flex y grid lo dice la caja (en fila, justify-content; en
  // columna, align-items; en grid, justify-items o justify-content); si no, text-align.
  const lado = (v) => (/center/.test(v) ? "centro" : /right|end/.test(v) ? "final" : null);
  const alineadoDe = (el) => { const cs = getComputedStyle(el);
    return (/flex/.test(cs.display) ? lado(cs.flexDirection.startsWith("column") ? cs.alignItems : cs.justifyContent)
      : /grid/.test(cs.display) ? lado(cs.justifyItems) || lado(cs.justifyContent) : lado(cs.textAlign)) || "inicio"; };
  // Ruling 36: un envoltorio (sin fondo ni borde) que lleva lo suyo al centro o al final: text-align center/right/end (si
  // no es en línea), o flex en fila con justify-content center/end/flex-end/right. Solo cuenta si de verdad lo corre (lo
  // que se ve dentro empieza después de su borde interior: un botón sin fondo ajustado a su texto, centrado por dentro
  // como todo botón, no corre nada) y si lleva TODO lo que se ve en la superficie: su inicio y su fin visibles coinciden
  // con los de la superficie (±1 px). Un logo o un icono centrado en su caja, delante o encima del texto, o unos <th>
  // centrados no dicen hacia dónde va el contenido; una cifra a la derecha o un estado vacío centrado, sí.
  const alineaDentro = (el) => { const cs = getComputedStyle(el);
    return (cs.display !== "inline" && lado(cs.textAlign))
      || (/flex/.test(cs.display) && cs.flexDirection.startsWith("row") && lado(cs.justifyContent)) || null; };
  // Devuelve {hx, hd, interior}: `interior` es «centro» o «final» si un envoltorio de dentro corre el contenido (Ruling 36).
  const extension = (el) => {
    let hx = Infinity, hd = -Infinity;
    const corridos = []; // [inicio, fin, lado] de lo que se ve dentro de cada envoltorio que corre lo suyo
    const suma = (l, r, lim) => { const a = Math.max(l, lim[0]), b = Math.min(r, lim[1]);
      if (b > a) { hx = Math.min(hx, a); hd = Math.max(hd, b); return [a, b]; } return [Infinity, -Infinity]; };
    const junta = (p, q) => [Math.min(p[0], q[0]), Math.max(p[1], q[1])];
    const recorta = (n, lim) => { if (getComputedStyle(n).overflowX === "visible") return lim; const q = n.getBoundingClientRect();
      return [Math.max(lim[0], q.left), Math.min(lim[1], q.right)]; };
    // Devuelve [inicio, fin] de lo que sumó dentro de `n` ([Infinity, -Infinity] si nada).
    const rec = (n, lim) => {
      let ext = [Infinity, -Infinity];
      for (const h of n.childNodes) {
        if (h.nodeType === 3) {
          if (!h.textContent.trim() || getComputedStyle(h.parentElement).visibility === "hidden") continue;
          const rg = document.createRange(); rg.selectNodeContents(h);
          for (const q of rg.getClientRects()) if (q.width > 0) ext = junta(ext, suma(q.left, q.right, lim));
        } else if (h.nodeType === 1) {
          const cs = getComputedStyle(h);
          if (cs.display === "none" || posicionada(h)) continue;
          if (h.matches(GRAFICO) || h.matches(CAMPO) || conFondo(h) || conBorde(h)) {
            if (visible(h)) { const q = h.getBoundingClientRect(); ext = junta(ext, suma(q.left, q.right, lim)); }
            continue;
          }
          const dentro = rec(h, recorta(h, lim));
          ext = junta(ext, dentro);
          const al = dentro[0] !== Infinity ? alineaDentro(h) : null;
          if (al && dentro[0] > contenido(h).x + TOLERANCIA) corridos.push([...dentro, al]);
        }
      }
      return ext;
    };
    rec(el, recorta(el, [-Infinity, Infinity]));
    const lleva = corridos.find(([a, b]) => Math.abs(a - hx) <= TOLERANCIA && Math.abs(b - hd) <= TOLERANCIA);
    return { hx, hd, interior: lleva ? lleva[2] : null };
  };
  // FUN-43 (manual 2.4, §17.5): lo que se ve dentro de cada bloque, con la extensión de FUN-38 (textos por sus letras,
  // gráficos, campos, cajas con fondo y divisores: una lista con raya entre filas se ve llena). Un bloque que es él mismo
  // una de esas cajas se ve entero; uno en el que no se ve nada, null.
  for (const [b, el] of elDeBloque) {
    if (el.matches(GRAFICO) || el.matches(CAMPO) || conFondo(el) || conBorde(el)) { const e = exterior(el); b.contenido = { x: e.x, der: e.der }; continue; }
    const { hx, hd } = extension(el);
    b.contenido = hx === Infinity ? null : { x: Math.round(hx), der: Math.round(hd) };
  }
  const superficies = [];
  for (const el of [...fijos, ...zonas]) { // lo fijo primero: el tope no lo deja afuera
    if (superficies.length >= 80) break;
    if (!visible(el) || !conFondo(el)) continue;
    const cs = getComputedStyle(el), e = exterior(el);
    const { hx, hd, interior } = extension(el);
    const r = el.getBoundingClientRect();
    // Ruling 24 (a) y Ruling 36: hacia dónde va su contenido, por la superficie o por un envoltorio de dentro.
    const propio = alineadoDe(el), alineado = propio !== "inicio" ? propio : interior || "inicio";
    superficies.push({ nombre: nombreEl(el), x: e.x, der: e.der, alineado,
      // Ruling 17: el relleno se mide desde el borde interior del borde (solo padding); bordeIzq/bordeDer dan ese borde.
      pl: Math.round(parseFloat(cs.paddingLeft)), pr: Math.round(parseFloat(cs.paddingRight)),
      bordeIzq: Math.round(parseFloat(cs.borderLeftWidth) || 0), bordeDer: Math.round(parseFloat(cs.borderRightWidth) || 0),
      hijosX: hx === Infinity ? null : Math.round(hx), hijosDer: hd === -Infinity ? null : Math.round(hd),
      radios: radiosDe(el), fondo: true, interactiva: Boolean(el.closest(INTERACTIVO)),
      desplaza: ["auto", "scroll"].includes(cs.overflowX), area: Math.round(r.width * r.height) });
  }
  // FUN-05: los valores de espaciado (relleno, margen en valor absoluto y sin auto, separación de flex y grid), con el
  // primer lugar donde aparece cada uno, y la escala del sistema (--espacio-* de :root, sin el espacio entre bloques).
  const espacios = new Map();
  const anota = (v, el, prop) => {
    if (!(v > 0)) return;
    const k = Math.round(v * 2) / 2;
    if (!espacios.has(k)) espacios.set(k, `\`${nombreEl(el)}\`, ${prop}`);
  };
  for (const el of zonas) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const tipado = el.computedStyleMap ? el.computedStyleMap() : null;
    for (const p of ["padding-top", "padding-right", "padding-bottom", "padding-left"]) anota(parseFloat(cs.getPropertyValue(p)), el, p);
    for (const p of ["margin-top", "margin-right", "margin-bottom", "margin-left"]) {
      const t = tipado && tipado.get(p);
      if (t && String(t) === "auto") continue;
      anota(Math.abs(parseFloat(cs.getPropertyValue(p))), el, p);
    }
    if (/flex|grid/.test(cs.display)) for (const p of ["row-gap", "column-gap"]) anota(parseFloat(cs.getPropertyValue(p)), el, p);
  }
  const espaciados = [...espacios].map(([valor, donde]) => ({ valor, donde }));
  const nombresEspacio = new Set();
  const leeRaiz = (reglas) => {
    for (const r of reglas) {
      if (r.selectorText && /(^|,)\s*(:root|html)\s*(,|$)/.test(r.selectorText)) {
        for (const n of r.style) if (n.startsWith("--espacio-") && n !== "--espacio-entre-bloques") nombresEspacio.add(n);
      } else if (r.cssRules) leeRaiz(r.cssRules);
    }
  };
  for (const hoja of document.styleSheets) { let rs; try { rs = hoja.cssRules; } catch { continue; } leeRaiz(rs); }
  const escala = [...new Set([...nombresEspacio].map((n) => Math.round(sondaPx(`var(${n})`, "width") * 2) / 2).filter((v) => v > 0))].sort((p, q) => p - q);
  // NAV-08: el nombre del producto en la navegación global y los estilos de los demás textos (familia, peso y tracking,
  // en px: «normal» es 0).
  const familia = (f) => String(f || "").split(",")[0].trim().replace(/^["']|["']$/g, "");
  const tracking = (cs) => (cs.letterSpacing === "normal" ? 0 : Math.round(parseFloat(cs.letterSpacing) * 100) / 100 || 0);
  const textoPropio = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const marcaEl = navs.flatMap((n) => [n, ...n.querySelectorAll('[data-rol="marca-producto"]')])
    .find((x) => x.matches('[data-rol="marca-producto"]') && visible(x)) || null;
  const logoEl = navs.flatMap((n) => [...n.querySelectorAll('img,svg[role="img"],[role="img"]')]).find(visible) || null;
  const otros = [], vistosEstilo = new Set();
  for (const el of zonas) {
    if (!visible(el) || !textoPropio(el) || (marcaEl && (el === marcaEl || marcaEl.contains(el)))) continue;
    const cs = getComputedStyle(el);
    const k = `${familia(cs.fontFamily)}|${cs.fontWeight}|${parseFloat(cs.fontSize)}|${tracking(cs)}`;
    if (vistosEstilo.has(k) || otros.length >= 40) continue;
    vistosEstilo.add(k);
    otros.push({ familia: familia(cs.fontFamily), peso: Number(cs.fontWeight) || 400, letterSpacing: tracking(cs), tamano: parseFloat(cs.fontSize), texto: texto(el) });
  }
  const estilos = {
    marca: marcaEl ? (() => { const cs = getComputedStyle(marcaEl), e = exterior(marcaEl);
      return { familia: familia(cs.fontFamily), peso: Number(cs.fontWeight) || 400, letterSpacing: tracking(cs), texto: texto(marcaEl),
        x: e.x, arriba: e.arriba, abajo: e.abajo }; })() : null,
    logo: logoEl ? (() => { const e = exterior(logoEl); return { x: e.x, arriba: e.arriba, abajo: e.abajo }; })() : null,
    otros,
  };
  // FUN-38, Ruling 37: el bloque de marca, el hijo de la navegación que lleva marca-producto (sin contar los display:
  // contents). La navegación es, de las que contienen la marca fuera de <main>, la más externa con [data-rol="navegacion"];
  // si no hay, la más externa nav o role=navigation; si no, la más externa header o banner: en <nav><header
  // class="marca">…</header>…</nav> el bloque es el header, no el nombre. Se mide aunque no tenga fondo ni borde: su
  // contenido visible no puede quedar más cerca del borde derecho que del izquierdo. Sin marca-producto, null.
  const bloqueMarca = (() => {
    if (!marcaEl) return null;
    const ancestros = [];
    for (let x = marcaEl.parentElement; x && x !== document.body; x = x.parentElement) if (!main.contains(x)) ancestros.push(x);
    const externa = (sel) => ancestros.filter((x) => x.matches(sel)).pop() || null;
    const navM = externa('[data-rol="navegacion"]') || externa('nav,[role="navigation"]') || externa('header,[role="banner"]');
    if (!navM) return null;
    let b = marcaEl;
    for (let x = marcaEl; x.parentElement && x.parentElement !== navM; x = x.parentElement)
      if (getComputedStyle(x.parentElement).display !== "contents") b = x.parentElement;
    if (!visible(b)) return null;
    const cs = getComputedStyle(b), e = exterior(b), { hx, hd, interior } = extension(b);
    const propio = alineadoDe(b);
    return { nombre: nombreEl(b), x: e.x, der: e.der, alineado: propio !== "inicio" ? propio : interior || "inicio",
      bordeIzq: Math.round(parseFloat(cs.borderLeftWidth) || 0), bordeDer: Math.round(parseFloat(cs.borderRightWidth) || 0),
      hijosX: hx === Infinity ? null : Math.round(hx), hijosDer: hd === -Infinity ? null : Math.round(hd), fondo: conFondo(b) };
  })();
  // COM-08: las tablas de <main>. (a) table y role=table|grid; (b) 3 o más hermanos seguidos de la misma etiqueta, en
  // fila, cuyos hijos coinciden en x en al menos 2 posiciones. Una tabla apilada (sus celdas ya no forman columnas) no
  // cuenta a ese ancho.
  const SEL_TABLA = 'table,[role="table"],[role="grid"]';
  const encabezadoAnterior = (el) => {
    let ult = null;
    for (const h of main.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      if (h.contains(el) || !(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
      if (presente(h)) ult = h;
    }
    return ult ? texto(ult) : "";
  };
  const conEncabezado = (raiz) => [...raiz.querySelectorAll('th,[role="columnheader"]')].some(visible);
  const textosDe = (el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), out = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.textContent.trim()) out.push(n); return out; };
  const tabular = (el) => getComputedStyle(el).fontVariantNumeric.includes("tabular-nums");
  const CIFRA = /^[\s$€%+−\-\d.,]+$/;
  const sinTabular = (celdas) => {
    const out = [];
    for (const c of celdas) {
      const t = (c.innerText || c.textContent || "").replace(/\s+/g, " ").trim();
      if (!t || !CIFRA.test(t) || !/\d/.test(t)) continue;
      const ns = textosDe(c);
      if (!(ns.length && ns.every((n) => tabular(n.parentElement)))) out.push(t);
      if (out.length >= 5) break;
    }
    return out;
  };
  const columnasEn = (xs) => xs.filter((x, i) => xs.findIndex((y) => Math.abs(y - x) <= 1) === i).length;
  // Ruling 29: una rejilla de exactamente 2 columnas cuya primera columna son etiquetas (th[scope=row], role=rowheader,
  // dt, data-rol="dato-clave", o un texto que termina en «:») son datos clave «Etiqueta: valor», no una tabla de trabajo.
  const ETIQUETA = 'th[scope="row"],[role="rowheader"],dt,[data-rol="dato-clave"]';
  const esEtiqueta = (c) => c.matches(ETIQUETA) || /:\s*$/.test((c.innerText || c.textContent || "").trim());
  const datosClave = (filas, celdasDe) => filas.length > 0 && filas.every((f) => { const cs = celdasDe(f); return cs.length === 2 && esEtiqueta(cs[0]); });
  // MAR-12 (manual 2.5, spec 2026-10-06 §8.1): cada tabla suma su caja exterior y `columnasX`, el inicio del contenido de
  // cada columna (la caja de contenido de cada celda del encabezado visible o, sin él, de la primera fila), de menor a
  // mayor y sin repetir (±1); y `bordesX`, el borde izquierdo de la caja de esas mismas celdas. Desde el manual 2.6
  // (spec 2026-10-07 partes-iguales §3.2) se siguen capturando, pero ninguna regla las lee.
  const CABECERA = 'th,[role="columnheader"]';
  const unicosX = (xs) => xs.sort((p, q) => p - q).filter((x, i, ys) => i === 0 || x - ys[i - 1] > 1);
  const columnasXDe = (celdas) => unicosX(celdas.map((c) => contenido(c).x));
  const bordesXDe = (celdas) => unicosX(celdas.map((c) => exterior(c).x));
  const tablas = [];
  for (const t of main.querySelectorAll(SEL_TABLA)) {
    if (!visible(t)) continue;
    const esTable = t.tagName === "TABLE";
    const todasT = (esTable ? [...t.querySelectorAll("tr")].filter((tr) => tr.closest("table") === t)
      : [...t.querySelectorAll('[role="row"]')].filter((r) => r.closest(SEL_TABLA) === t)).filter(visible);
    const filasT = todasT.filter((f) => (esTable ? [...f.children].some((c) => c.tagName === "TD") : f.querySelector('[role="cell"],[role="gridcell"]')));
    const celdasDe = (f) => [...f.children].filter((c) => visible(c) && c.matches('td,th,[role="cell"],[role="gridcell"],[role="rowheader"],[role="columnheader"]'));
    const primera = filasT.length ? celdasDe(filasT[0]) : [];
    if (columnasEn(primera.map((c) => Math.round(c.getBoundingClientRect().left))) < 2 || datosClave(filasT, celdasDe)) continue;
    // La fila de encabezado: la primera con celdas de encabezado y sin celdas de datos (una con th[scope=row] es de datos).
    const filaEnc = todasT.find((f) => { const cs = celdasDe(f);
      return cs.some((c) => c.matches(CABECERA)) && !cs.some((c) => c.matches('td,[role="cell"],[role="gridcell"]')); });
    const e = exterior(t), cols = filaEnc ? celdasDe(filaEnc) : primera;
    tablas.push({ nombre: t.getAttribute("aria-label") || encabezadoAnterior(t) || nombreEl(t), filas: filasT.length, columnas: primera.length,
      encabezado: conEncabezado(t), cifrasSinTabular: sinTabular(filasT.flatMap(celdasDe)),
      x: e.x, der: e.der, arriba: e.arriba, abajo: e.abajo, columnasX: columnasXDe(cols), bordesX: bordesXDe(cols) });
  }
  const enFila = (el) => {
    const cs = getComputedStyle(el), d = cs.display;
    return ((d === "flex" || d === "inline-flex") && cs.flexDirection.startsWith("row"))
      || ((d === "grid" || d === "inline-grid") && pistas(cs.gridTemplateColumns) >= 2) || d === "table-row";
  };
  const hijosFila = (el) => [...el.children].filter(visible);
  // Una celda (esCelda, arriba) no es una superficie con fondo ni contiene encabezados: una rejilla de tarjetas o de
  // secciones armada en filas no es una tabla (Ruling 10).
  for (const padre of [main, ...main.querySelectorAll("*")]) {
    if (padre.closest(SEL_TABLA) || (padre !== main && !visible(padre))) continue;
    const hs = [...padre.children].filter(visible);
    for (let i = 0; i < hs.length;) {
      const cand = (el) => el.tagName === hs[i].tagName && enFila(el) && hijosFila(el).length >= 2
        && hijosFila(el).every(esCelda);
      if (!cand(hs[i])) { i += 1; continue; }
      let j = i + 1;
      while (j < hs.length && cand(hs[j])) j += 1;
      const grupo = hs.slice(i, j), anterior = hs[i - 1] || null;
      i = j;
      if (grupo.length < 3) continue;
      const xs = grupo.map((g) => hijosFila(g).map((c) => Math.round(c.getBoundingClientRect().left)));
      const comunes = xs[0].filter((x, k) => xs[0].findIndex((y) => Math.abs(y - x) <= 1) === k
        && xs.every((fx) => fx.some((y) => Math.abs(y - x) <= 1)));
      if (comunes.length < 2 || datosClave(grupo, hijosFila)) continue;
      let encabezado = conEncabezado(padre);
      for (let s = padre.previousElementSibling; s && !encabezado; s = s.previousElementSibling)
        encabezado = (s.matches('th,[role="columnheader"]') && visible(s)) || conEncabezado(s);
      // MAR-12: la caja es la unión de las filas del grupo. Las celdas de encabezado (visibles, fuera de una tabla) se buscan
      // en la primera fila del grupo, en la fila de antes y en el hermano inmediato anterior del padre (spec 2026-10-07 §5:
      // un encabezado de más atrás puede ser de otra cosa); sin ellas, las columnas salen de la primera fila. COM-08 (el
      // `encabezado` de arriba) sigue buscando en todos los hermanos anteriores.
      const celdasCab = (raiz) => [...(raiz.matches(CABECERA) ? [raiz] : []), ...raiz.querySelectorAll(CABECERA)]
        .filter((c) => visible(c) && !c.closest(SEL_TABLA));
      let cab = celdasCab(grupo[0]);
      if (!cab.length && anterior) cab = celdasCab(anterior);
      if (!cab.length && padre.previousElementSibling) cab = celdasCab(padre.previousElementSibling);
      const u = grupo.map(exterior), cols = cab.length ? cab : hijosFila(grupo[0]);
      tablas.push({ nombre: padre.getAttribute("aria-label") || encabezadoAnterior(grupo[0]) || nombreEl(grupo[0]), filas: grupo.length,
        columnas: hijosFila(grupo[0]).length, encabezado, cifrasSinTabular: sinTabular(grupo.flatMap(hijosFila)),
        x: Math.min(...u.map((c) => c.x)), der: Math.max(...u.map((c) => c.der)), arriba: Math.min(...u.map((c) => c.arriba)),
        abajo: Math.max(...u.map((c) => c.abajo)), columnasX: columnasXDe(cols), bordesX: bordesXDe(cols) });
    }
  }
  // LIS-02: las tablas de trabajo marcadas, en orden del documento.
  const tablasTrabajo = [...main.querySelectorAll('[data-rol="tabla-de-trabajo"]')].filter(visible).map((t) => {
    const vis = (sel) => [...t.querySelectorAll(sel)].filter(visible);
    let filtrar = vis('[data-rol="filtrar"]').length > 0;
    for (let s = t.previousElementSibling; s && !filtrar; s = s.previousElementSibling)
      filtrar = (s.matches('[data-rol="filtrar"]') && visible(s)) || [...s.querySelectorAll('[data-rol="filtrar"]')].some(visible);
    return { nombre: t.getAttribute("aria-label") || encabezadoAnterior(t) || nombreEl(t),
      encabezadoVisible: vis('th,[role="columnheader"]').length > 0, filtros: vis('[data-rol="filtro-columna"]').length, filtrar };
  });
  // MAR-12 (manual 2.5, spec 2026-10-06 §8.1; 2.6, spec 2026-10-07 partes-iguales §3.1): las secciones lado a lado del
  // cuerpo. Un contenedor horizontal (flex en fila o grid de dos pistas o más) que no es una fila de tabla ni está dentro de
  // una tabla, con dos hijos o más de los que al menos dos son secciones: una columna (Ruling 6), un formulario, un
  // fieldset o section, o un bloque con encabezado propio. Con hijosB, que cuenta los formularios (hijosV los salta). El x
  // de cada sección es su borde exterior. Hasta 20 grupos. Del 2.6: cada grupo con su `columna` (el contenido de la
  // sección lado a lado más interna que lo contiene, o el cuerpo) y cada sección con su `der` exterior, su `dentro` (el
  // borde derecho de su contenido) y sus `controles`: cada campo que va solo en su línea (entre él y su sección no hay un
  // contenedor horizontal ni una fila de tabla, y no está en una tabla), sin entrar dentro de otro control; hasta 8.
  // «Lado a lado» es una sola fila (spec 2026-10-07 partes-iguales §3.1): los hijos del contenedor se parten por filas (dos
  // están en la misma si sus cajas exteriores se solapan en vertical más de 1 px) y una fila de una rejilla que salta de
  // línea es su propio grupo si tiene 2 hijos o más y al menos 2 son secciones; un hijo solo en su fila no entra. Cada
  // grupo de fila lleva la `columna` del contenedor y el `arriba`/`abajo` de sus hijos; el tope de 20 cuenta grupos de
  // fila: al llegar a 20 se dejan de emitir grupos, pero los contenedores siguientes siguen sumando sus hijos. Todos los
  // hijos de un contenedor que califica entero siguen contando como secciones para la `base` de MAR-09 y para la
  // `columna` de una fila anidada (como en el 2.5). Un contenedor horizontal estrictamente dentro de un formulario
  // ([data-medida="formulario"], no el propio contenedor) es una fila de campos («desde | hasta»), no de secciones: no
  // da grupo (la mira el juez; spec 2026-10-07 partes-iguales §3.1 y §7), aunque sus hijos sigan sumándose.
  const esSeccion = (h) => esColumna(h) || h.matches('[data-medida="formulario"],fieldset,section') || encabezadoPropio(h);
  const CONTROL = 'select,textarea,[role="combobox"],input:not([type="checkbox"],[type="radio"],[type="hidden"],[type="button"],'
    + '[type="submit"],[type="reset"],[type="range"],[type="color"],[type="file"])';
  const enSuLinea = (c, s) => { for (let x = c.parentElement; x && x !== s.parentElement; x = x.parentElement)
    if (esHorizontal(x) || filaDeTabla(x)) return false; return true; };
  const controlesDe = (s) => {
    const cs = [...s.querySelectorAll(CONTROL)].filter((c) => visible(c) && !c.closest(SEL_TABLA) && enSuLinea(c, s));
    return cs.filter((c) => !cs.some((o) => o !== c && o.contains(c))).slice(0, 8).map((c) => (({ x, der }) => ({ x, der }))(exterior(c)));
  };
  const filasDe = (hs) => {
    const filas = [];
    for (const h of [...hs].sort((p, q) => exterior(p).arriba - exterior(q).arriba)) {
      const e = exterior(h), f = filas.find((ys) => ys.some((y) => Math.min(e.abajo, exterior(y).abajo) - Math.max(e.arriba, exterior(y).arriba) > 1));
      if (f) f.push(h); else filas.push([h]);
    }
    return filas.map((f) => hs.filter((h) => f.includes(h)));
  };
  const ladoALado = [], seccionesEls = [];
  for (const el of [raizCuerpo, ...raizCuerpo.querySelectorAll("*")]) {
    if (!visible(el) || !esHorizontal(el) || filaDeTabla(el) || el.closest(SEL_TABLA)) continue;
    const hs = hijosB(el);
    if (hs.length < 2 || hs.filter(esSeccion).length < 2) continue;
    const madres = seccionesEls.filter((s) => s.contains(el));
    const col = madres.length ? contenido(madres.reduce((p, q) => (p.contains(q) ? q : p))) : cuerpo;
    const deCampos = formEls.some((f) => f !== el && f.contains(el));
    for (const fila of deCampos ? [] : filasDe(hs)) {
      if (ladoALado.length >= 20) break;
      if (fila.length < 2 || fila.filter(esSeccion).length < 2) continue;
      const es = fila.map(exterior);
      // Sin cuerpo medible (sin marco, sin zona de cuerpo y sin bloques) la columna va null: MAR-12 sale «no medida».
      ladoALado.push({ arriba: Math.min(...es.map((e) => e.arriba)), abajo: Math.max(...es.map((e) => e.abajo)),
        columna: col ? { x: col.x, der: col.der } : null,
        secciones: fila.map((h, i) => ({ nombre: nombreBloque(h), x: es[i].x, der: es[i].der, dentro: contenido(h).der, controles: controlesDe(h) })) });
    }
    seccionesEls.push(...hs);
  }
  // MAR-09 (manual 2.5, §8.2): `base` es el borde exterior de la sección lado a lado más interna que contiene al
  // formulario (o que es el formulario); si ninguna, la clave no va y se compara con el cuerpo.
  formEls.forEach((f, i) => {
    const dentro = seccionesEls.filter((s) => s === f || s.contains(f));
    if (dentro.length) formularios[i].base = exterior(dentro.reduce((p, q) => (p.contains(q) ? q : p))).x;
  });
  // Colores por papel (§6.2): cada color no neutro (croma C* > 10 en CIE LCh) con los textos que lo acompañan.
  const croma = (r, g, b) => {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
    const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
    return Math.hypot(500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z)));
  };
  const hexNoNeutro = (c) => {
    const x = rgba(c);
    if (!x || x[3] === 0 || croma(x[0], x[1], x[2]) <= 10) return null;
    return "#" + x.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  };
  const dondeColor = (el) => {
    for (let x = el; x && x !== document.body && x !== de; x = x.parentElement) {
      if (x.getAttribute("data-rol")) return x.getAttribute("data-rol");
      const k = (x.getAttribute("class") || "").trim().split(/\s+/)[0];
      if (k) return k;
    }
    return el.tagName.toLowerCase();
  };
  const porColor = new Map();
  const anotaColor = (hex, t, el) => {
    if (!hex) return;
    const e = porColor.get(hex) || new Map();
    const d = dondeColor(el), k = `${t}\u0000${d}`;
    if (!e.has(k) && e.size < 8) e.set(k, { texto: t, donde: d });
    porColor.set(hex, e);
  };
  for (const el of zonas) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (textoPropio(el)) { anotaColor(hexNoNeutro(cs.color), texto(el), el); continue; }
    const r = el.getBoundingClientRect();
    if (r.width > 32 || r.height > 32) continue;
    const bordes = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0).map((s) => cs[`border${s}Color`]);
    const hex = hexNoNeutro(cs.backgroundColor) || (el instanceof SVGGeometryElement ? hexNoNeutro(cs.fill) : null)
      || bordes.map(hexNoNeutro).find(Boolean) || null;
    if (!hex) continue;
    let p = el.parentElement;
    while (p && p !== de && !texto(p)) p = p.parentElement;
    anotaColor(hex, p && p !== de ? texto(p) : "", el);
  }
  const colores = [...porColor].map(([color, e]) => ({ color, textos: [...e.values()] }));
  // COM-17 (manual 2.7, spec 2026-10-15 confirmaciones §3.1): los mensajes de estado que flotan sobre el contenido. Se
  // buscan en todo el documento (una librería los pega al final de <body>), el más externo si hay anidados. texto()
  // ya recorta a 60 caracteres. Un absoluto que contiene al cuerpo no lo tapa: lo envuelve. No cuentan los que van
  // dentro de un diálogo modal (`[role="dialog"]`, `[role="alertdialog"]`, `[aria-modal="true"]` o `<dialog>`: el
  // Dialog de Radar es un `alertdialog` en un contenedor fijo) ni en el panel de situaciones de la demo.
  const cuerpoEl = primero('[data-rol="cuerpo"]');
  const fijo = (el) => { for (let x = el; x && x !== document.documentElement; x = x.parentElement)
    if (getComputedStyle(x).position === "fixed") return true; return false; };
  const tapaCuerpo = (el) => {
    if (!cuerpoEl || cuerpoEl.contains(el) || el.contains(cuerpoEl) || getComputedStyle(el).position !== "absolute") return false;
    const a = el.getBoundingClientRect(), b = cuerpoEl.getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  };
  const mensajes = [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live]:not([aria-live="off"]),output')]
    .filter((el) => visible(el) && texto(el) && !el.closest('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog,aside[aria-label="Situaciones de la demo"]'));
  // Primero qué flota y después el más externo entre los que flotan: una región aria-live que no flota no esconde el
  // toast fijo que lleva dentro («falla si alguno», §3.1).
  const flotan = mensajes.map((el) => ({ el, como: fijo(el) ? "fixed" : tapaCuerpo(el) ? "absolute" : null }))
    .filter((x) => x.como);
  const flotantes = flotan.filter((x) => !flotan.some((o) => o !== x && o.el.contains(x.el)))
    .map(({ el, como }) => ({ texto: texto(el), como }));
  // MAR-14 (manual 2.9): el marco en el celular. Solo a menos de 672 (ANGOSTO_HASTA; aquí no se ve de fuera): a más, null.
  // Se mide desde arriba (scrollY en 0) y la posición vuelve a como estaba al terminar, pase lo que pase (también la de
  // las cajas que desplace traer el control a la vista). No enfoca nada: un manejador de foco de la app cambiaría lo que
  // se captura después. No depende del alto de la ventana (los arneses miden a 900 de alto): se desplaza una pantalla de
  // referencia (640, PANTALLA_REF) y solo se mira lo que cae en ella, como FUN-42.
  // h1Fondo: el borde inferior del h1 de la franja, en reposo. volverLineas: el primer enlace o botón del marco antes de
  // ese h1 (contexto: «volver» o migas; un <button> con history.back() también), en líneas de su texto (los tops de sus
  // renglones, agrupados por medio alto de línea: un relleno de blanco táctil no suma una línea). desplazablesPropios:
  // las cajas de main, sus ancestros (un armazón de app de alto fijo) o su contenido que se desplazan en vertical por su
  // cuenta, fuera de un componente de dos dimensiones (la parte «componente» de MAR-05: tabla, tabla de trabajo, canvas,
  // svg, iframe de mapa) o envolviéndolo solo a él. fijoDesplazado: tras desplazar una pantalla (si la página es más
  // alta que ella), lo que cubren arriba los elementos fijos o pegados (el más externo; pegado, solo si está pegado),
  // encadenados desde 0: entra el que empieza a 64 + 1 px o menos del borde de lo ya cubierto, así una segunda barra
  // apilada cuenta aunque deje un hueco; la medida es la unión de sus tramos verticales (dos lado a lado no suman).
  // tapaFoco: el primer control enfocable del cuerpo, traído a la vista (scrollIntoView nearest), ¿lo cubre entero uno
  // de ellos? No cuentan los diálogos modales ni el panel de situaciones de la demo, como en COM-17.
  let marcoCelular = null;
  if (vw < 672) {
    const REF = 640, TOPE = 64;
    const x0 = scrollX, y0 = scrollY, cajasMovidas = [];
    const ir = (x, y) => window.scrollTo({ left: x, top: y, behavior: "instant" });
    const NO_CUENTA = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog,aside[aria-label="Situaciones de la demo"]';
    try {
      ir(0, 0);
      const h1Cab = cab ? h1 : primero('[data-rol="cabecera"] h1');
      const h1Fondo = h1Cab && visible(h1Cab) ? Math.round(h1Cab.getBoundingClientRect().bottom + scrollY) : null;
      let volverLineas = null;
      const raizMarco = marco || main;
      const volver = h1Cab ? [...raizMarco.querySelectorAll('a[href],[role="link"],button')].find((a) => visible(a) && !a.contains(h1Cab)
        && Boolean(a.compareDocumentPosition(h1Cab) & Node.DOCUMENT_POSITION_FOLLOWING)) || null : null;
      if (volver) {
        const cs = getComputedStyle(volver);
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        const tops = [];
        const tw = document.createTreeWalker(volver, NodeFilter.SHOW_TEXT);
        for (let n = tw.nextNode(); n; n = tw.nextNode()) {
          if (!n.textContent.trim() || !visible(n.parentElement)) continue;
          const rg = document.createRange(); rg.selectNodeContents(n);
          for (const r of rg.getClientRects()) if (r.width > 1) tops.push(r.top);
        }
        tops.sort((a, b) => a - b);
        volverLineas = tops.length ? tops.filter((t, i) => i === 0 || t - tops[i - 1] > lh / 2).length : 1;
      }
      const DOS_D = 'table,[data-rol="tabla-de-trabajo"],canvas,svg,iframe[src*="map" i],iframe[title*="map" i]';
      const solo2D = (el) => { const hs = aplanar(el).filter(visible); return hs.length > 0 && hs.every((h) => h.matches(DOS_D) || h.querySelector(DOS_D)); };
      const ancestros = []; for (let a = main.parentElement; a && a !== de; a = a.parentElement) ancestros.push(a);
      // El overflow de body pasa a la ventana si el de html es visible: entonces body no es una caja propia.
      const candidatos = [...ancestros.filter((a) => a !== document.body || getComputedStyle(de).overflowY !== "visible"), main, ...main.querySelectorAll("*")];
      const desplazablesPropios = candidatos.filter((el) => visible(el) && !el.matches("textarea,select") && !el.closest(NO_CUENTA)
        && ["auto", "scroll"].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1
        && !el.closest(DOS_D) && !solo2D(el)).length;
      if (de.scrollHeight > REF) ir(0, REF);
      // Los fijos y pegados que se ven en la pantalla de referencia, su tramo vertical recortado a [0, 640].
      const fijos = () => {
        const fs = [...document.body.querySelectorAll("*")].filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") return false;
          if (!visible(el) || parseFloat(cs.opacity) === 0 || el.closest(NO_CUENTA)) return false;
          const r = el.getBoundingClientRect();
          if (r.bottom <= 0 || r.top >= REF) return false;
          return cs.position === "fixed" || (cs.top !== "auto" && Math.abs(r.top - parseFloat(cs.top)) <= 1);
        });
        return fs.filter((el) => !fs.some((o) => o !== el && o.contains(el)));
      };
      const tramos = fijos().map((el) => el.getBoundingClientRect()).map((r) => [Math.max(0, r.top), Math.min(REF, r.bottom)])
        .sort((a, b) => a[0] - b[0]);
      let fijoDesplazado = 0, hasta = 0;
      for (const [a, b] of tramos) {
        if (a > hasta + TOPE + 1) break;
        const desde = Math.max(a, hasta);
        if (b > desde) { fijoDesplazado += b - desde; hasta = b; }
      }
      fijoDesplazado = Math.round(fijoDesplazado);
      const ENFOCABLE = 'a[href],button,input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
      const control = [...(zonaCuerpo || main).querySelectorAll(ENFOCABLE)].find((el) => visible(el) && !el.disabled && !el.closest(NO_CUENTA)) || null;
      let tapaFoco = false;
      if (control) {
        for (let a = control.parentElement; a && a !== document.body && a !== de; a = a.parentElement)
          if (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth) cajasMovidas.push([a, a.scrollLeft, a.scrollTop]);
        control.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        const c = control.getBoundingClientRect();
        tapaFoco = fijos().some((el) => {
          if (el.contains(control)) return false;
          const o = el.getBoundingClientRect();
          return o.left <= c.left + 1 && o.right >= c.right - 1 && o.top <= c.top + 1 && o.bottom >= c.bottom - 1;
        });
      }
      marcoCelular = { h1Fondo, volverLineas, desplazablesPropios, fijoDesplazado, tapaFoco };
    } finally {
      for (const [a, l, t] of cajasMovidas) { a.scrollLeft = l; a.scrollTop = t; }
      ir(x0, y0);
    }
  }
  return { vw, doc: { sw: de.scrollWidth, cw: de.clientWidth }, marcos: marcos.length,
    marcoAncho: marco ? marco.getAttribute("data-ancho") : null, contenedor, cuerpo,
    franja: cab ? { ...contenido(cab), arriba: borde(cab).arriba, borde: (({ x, der, abajo }) => ({ x, der, abajo }))(exterior(cab)),
      alto: (({ arriba, abajo }) => Math.round(abajo - arriba))(exterior(cab)),
      fondo: conFondo(cab), radios: radiosDe(cab) } : null,
    h1: h1 ? { texto: texto(h1), x: borde(h1).x } : null, activo: activo ? texto(activo) : null, franjaExtra,
    avisos, enZona: !!zonaAvisos, accion, fueraDeVentana: fueraDeVentana.slice(0, 5), cajasConScroll, anchosPropios, lineasLargas, truncados,
    formularios, medidaFormulario, navegacion, subnavegacion, area, margenPagina, ladoALado,
    filas, bloques: bloquesV, entreBloques, superficies, bloqueMarca, espaciados, escala, estilos, tablas, tablasTrabajo, colores, flotantes, marcoCelular };
};

// ---- Parte de Node: decide con las medidas ----
export const TOLERANCIA_PX = 1;
export const CPL_MAX = 80;
// Manual 2.4 (spec 2026-10-05 §5): el tramo angosto (< 672), la pantalla de referencia del celular (640 de alto), el
// tope de la cabecera de un detalle en el celular y cuánto asoma un bloque sin texto.
export const ANGOSTO_HASTA = 672;
export const PANTALLA_REF = 640;
export const TOPE_CABECERA_ANGOSTA = 320;
export const ASOMA_SIN_TEXTO = 32;
// Manual 2.4, pantalla ancha (spec 2026-10-05 §17): desde qué ancho el cuerpo reparte el peso, el alto de la primera
// pantalla en ancho (900 de una pantalla de 1440 × 900 menos el navegador) y el alcance mínimo del contenido de esa
// primera pantalla (60 % del ancho del cuerpo).
export const ANCHO_DESDE = 1056;
export const PANTALLA_REF_ANCHA = 800;
export const PESO_MINIMO = 0.6;
// Manual 2.9 (MAR-14): en el celular, en reposo, el h1 de la franja termina como mucho a un cuarto de la pantalla de
// referencia (160 de 640); al desplazar, lo fijo o pegado arriba mide como mucho una barra de 64 px.
export const TOPE_MARCO_REPOSO = 160;
export const TOPE_FIJO_DESPLAZADO = 64;
// Las reglas que se aplican a un estado de una pantalla (spec §7.4): un estado de error puede llevar un aviso que la
// modelo no lleva, y la comparación entre pantallas es de las modelo.
export const REGLAS_DE_ESTADO = ["sin-truncar", "sin-desborde", "lo-siguiente-asoma", "sin-flotante", "marco-celular"];
export const CODIGOS = {
  "usa-marco": ["MAR-01"], "marco-comun": ["MAR-02"], "titulo-alineado": ["MAR-03"], "avisos-en-marco": ["MAR-04"],
  "sin-desborde": ["MAR-05", "NAV-04"], "accion-en-su-sitio": ["MAR-06"], "titulo-aporta": ["MAR-07"],
  "css-del-marco": ["MAR-08"], "medida-lectura": ["FUN-12"], "sin-truncar": ["FUN-14"],
  "angosto-al-borde": ["MAR-09"], "logo-en-navegacion": ["NAV-07"],
  // Manual 2.3 (spec 2026-10-02 §9.5).
  "linea-de-inicio": ["MAR-10"], "espacio-entre-bloques": ["FUN-37"], "relleno-simetrico": ["FUN-38"],
  "borde-sin-radio": ["FUN-39"], "escala-de-espaciado": ["FUN-05"], "marca-producto": ["NAV-08"],
  "tabla-con-encabezado": ["COM-08"], "filtro-por-columna": ["LIS-02"],
  // Manual 2.4 (spec 2026-10-05 §5).
  "cabecera-compacta": ["DET-12"], "lo-siguiente-asoma": ["FUN-42"],
  // Manual 2.4, pantalla ancha (spec 2026-10-05 §17).
  "peso-repartido": ["FUN-43"],
  // Manual 2.5 (spec 2026-10-06 §5, §6 y §8): AJU-05 cambia de medida (la sub-navegación, arriba) y sale «al lado».
  "margen-unico": ["MAR-11"], "subnavegacion-arriba": ["AJU-05"],
  // Manual 2.6 (spec 2026-10-07 partes-iguales §3): MAR-12 deja de medir columnas y mide partes iguales.
  "partes-iguales": ["MAR-12"],
  // Manual 2.7 (spec 2026-10-15 confirmaciones §3.1): ningún mensaje de estado flota sobre el contenido.
  "sin-flotante": ["COM-17"],
  // Manual 2.9: en el celular, el marco deja la pantalla al contenido.
  "marco-celular": ["MAR-14"],
};
// Reglas cuyo incumplimiento nunca se exceptúa (spec §6.3). La parte «documento» de MAR-05 tampoco.
// FUN-05 y FUN-38 admiten excepción con motivo; las demás del manual 2.3, no (spec 2026-10-02 §9.5).
// Del manual 2.4, FUN-42 y FUN-43 la admiten; DET-12 y AJU-05 no (spec 2026-10-05 §5 y §17).
// Del manual 2.5, MAR-11 no la admite y MAR-12 sí, con motivo (spec 2026-10-06 §5.1 y §8.1).
// Del manual 2.6, MAR-12 (partes iguales) la sigue admitiendo, con motivo.
// Del manual 2.7, COM-17 no la admite (spec 2026-10-15 confirmaciones §3.1).
// Del manual 2.9, MAR-14 la admite, con motivo (una pantalla de mapa a pantalla completa).
export const SIN_EXCEPCION = new Set(["MAR-01", "MAR-02", "MAR-03", "MAR-06", "MAR-07", "MAR-08", "MAR-09", "NAV-07",
  "MAR-10", "FUN-37", "FUN-39", "NAV-08", "COM-08", "LIS-02", "DET-12", "AJU-05", "MAR-11", "COM-17"]);

export const normaliza = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
const cerca = (a, b) => Math.abs(a - b) <= TOLERANCIA_PX;
const ancho = (c) => c.der - c.x;
// MAR-12 (manual 2.6, spec 2026-10-07 partes-iguales §3.1): un grupo lado a lado medido con el 2.6 trae la columna que
// llena y, en cada sección, su borde derecho, el de su contenido y sus controles. Sin eso es una medida anterior.
const xDerV = (c) => c !== null && typeof c === "object" && Number.isFinite(c.x) && Number.isFinite(c.der);
export const grupo26 = (g) => Boolean(g) && xDerV(g.columna) && Array.isArray(g.secciones) && g.secciones.every((s) =>
  Boolean(s) && Number.isFinite(s.x) && Number.isFinite(s.der) && Number.isFinite(s.dentro) && Array.isArray(s.controles) && s.controles.every(xDerV));
const caja = (c) => (c ? `x=${c.x}, ancho ${ancho(c)}` : "sin medida");

// Reglas que se deciden con la medida de UNA pantalla a UN ancho.
// ctx: { admiteCompleto: bool, declaraCompleto: bool (el encargo dice «Marco: completo»), patron: string | null,
//        angosto: bool, marca: {archivo, alt} | null, excepciones: {codigo: motivo},
//        tablasTrabajo: [{nombre, columnas: [..]}] (las del encargo para esta pantalla; manual 2.3),
//        reglas: [id de regla] (opcional: si viene, solo esas; las de un estado son REGLAS_DE_ESTADO, manual 2.4) }
export function evaluaAncho(m, ctx = {}) {
  const exc = ctx.excepciones || {};
  const out = [];
  const di = (regla, ok, detalle, extra = {}) => out.push({ regla, codigos: CODIGOS[regla], ok, detalle, ...extra });
  if (m.sinMain) {
    for (const r of ["usa-marco", "titulo-alineado", "sin-desborde", "titulo-aporta", "css-del-marco", "medida-lectura", "sin-truncar", "angosto-al-borde", "logo-en-navegacion",
      "linea-de-inicio", "espacio-entre-bloques", "relleno-simetrico", "borde-sin-radio", "escala-de-espaciado", "marca-producto", "tabla-con-encabezado", "filtro-por-columna",
      "cabecera-compacta", "lo-siguiente-asoma", "peso-repartido", "margen-unico", "subnavegacion-arriba", "partes-iguales", "sin-flotante", "marco-celular"])
      di(r, false, "la pantalla no tiene <main>");
    return ctx.reglas ? out.filter((r) => ctx.reglas.includes(r.regla)) : out;
  }
  // MAR-01: un solo marco para todo el producto (manual 2.2); «completo» solo si el patrón lo admite, lo declare el DOM
  // (data-ancho) o el encargo (`Marco: completo`, spec 2026-10-01 §5.6).
  const suPatron = ctx.patron ? `el patrón «${ctx.patron}»` : "su patrón";
  if (m.marcos !== 1) di("usa-marco", false, m.marcos === 0 ? "no usa el marco del sistema" : `${m.marcos} marcos en la misma pantalla`);
  else if (m.marcoAncho === "completo" && !ctx.admiteCompleto)
    di("usa-marco", false, `el marco declara data-ancho="completo" y ${suPatron} no admite marco completo`);
  else if (ctx.declaraCompleto && !ctx.admiteCompleto)
    di("usa-marco", false, `el encargo declara marco completo y ${suPatron} no admite marco completo`);
  else if (m.marcoAncho && m.marcoAncho !== "completo")
    di("usa-marco", false, `el marco declara data-ancho="${m.marcoAncho}"; el marco es uno para todo el producto (manual 2.2)`);
  else di("usa-marco", true, m.marcoAncho ? "marco completo, admitido por su patrón" : "usa el marco del producto");
  // MAR-03 (manual 2.3): con fondo, el cuerpo va al borde exterior de la franja; de borde a borde, a la línea del h1;
  // sin fondo, h1 y cuerpo comparten borde. Una medida sin franja.borde es anterior al 2.3: se compara el h1, como antes.
  if (!m.h1 || !m.franja || !m.cuerpo) di("titulo-alineado", false, "falta el h1, la franja del título o el cuerpo");
  else {
    const f = m.franja, fallas = [];
    if (f.borde && f.fondo) {
      const deBordeABorde = f.borde.x <= TOLERANCIA_PX && f.borde.der >= m.vw - TOLERANCIA_PX;
      if (deBordeABorde) {
        if (!cerca(m.cuerpo.x, m.h1.x) || !cerca(m.cuerpo.der, f.der))
          fallas.push(`la franja va de borde a borde: el cuerpo empieza donde empieza el h1 (x=${m.h1.x}) y termina en x=${f.der}; empieza en x=${m.cuerpo.x} y termina en x=${m.cuerpo.der}`);
      } else {
        if (!cerca(m.cuerpo.x, f.borde.x)) fallas.push(`el cuerpo empieza en x=${m.cuerpo.x}; la franja, en x=${f.borde.x}: el cuerpo va al borde exterior de la franja`);
        if (!cerca(m.cuerpo.der, f.borde.der)) fallas.push(`el cuerpo termina en x=${m.cuerpo.der}; la franja, en x=${f.borde.der}`);
      }
      di("titulo-alineado", fallas.length === 0, fallas.join("; ") || `cuerpo al borde de la franja (x=${m.cuerpo.x})`);
    } else {
      if (!cerca(m.h1.x, m.cuerpo.x)) fallas.push(`el h1 empieza en x=${m.h1.x} y el cuerpo en x=${m.cuerpo.x}`);
      if (!cerca(f.der, m.cuerpo.der)) fallas.push(`la franja del título termina en x=${f.der} y el cuerpo en x=${m.cuerpo.der}`);
      const previa = f.borde ? "" : " (medida anterior al manual 2.3: se compara el h1)";
      di("titulo-alineado", fallas.length === 0, (fallas.join("; ") || `h1 y cuerpo en x=${m.cuerpo.x}`) + previa);
    }
  }
  // MAR-11 (manual 2.5, spec 2026-10-06 §5.1): desde 672, el marco queda al margen de página de los dos bordes del área de
  // contenido (tras la navegación lateral). Se compara con el token, no entre pantallas: si todas tienen el mismo margen
  // equivocado, MAR-02 pasa y esta no.
  const w = m.vw;
  const completo = ctx.declaraCompleto || m.marcoAncho === "completo";
  if (!(w >= ANGOSTO_HASTA)) di("margen-unico", true, `no aplica a ${w} px (solo desde ${ANGOSTO_HASTA})`, { noMedida: true });
  else if (completo) di("margen-unico", true, "no aplica: la pantalla declara marco completo", { noMedida: true });
  else if (m.area == null) di("margen-unico", true, "no medida (medida anterior al manual 2.5)", { noMedida: true });
  // Un área presente sin sus dos bordes numéricos (spec 2026-10-07 §5): «no medida», nunca «NaN px».
  else if (![m.area.x, m.area.der].every(Number.isFinite)) di("margen-unico", true, "no medida (medida sin el área de contenido)", { noMedida: true });
  else if (m.margenPagina == null) di("margen-unico", false, m.anchosPropios === null
    ? "sin marco.margen.pagina en tokens.json: el sistema no trae el margen de página; deriva de nuevo el esqueleto (manual 2.5)"
    : "sin --marco-margen-pagina: el sistema no trae el margen de página; deriva de nuevo el esqueleto (manual 2.5)");
  else if (!m.contenedor) di("margen-unico", false, "falta el marco para medir su margen");
  else {
    const izq = Math.round(m.contenedor.x - m.area.x), der = Math.round(m.area.der - m.contenedor.der), M = m.margenPagina;
    const pasa = cerca(izq, M) && cerca(der, M);
    di("margen-unico", pasa, pasa ? `margen de ${M} px a los dos lados`
      : `a ${w} px el marco queda a ${izq} px del borde del área por la izquierda y a ${der} por la derecha; `
        + `el margen de página es ${M} (marco.margen.pagina), igual a los dos lados`, { sinExcepcion: true });
  }
  // MAR-05 / NAV-04: el documento nunca se exceptúa; las cajas con desplazamiento propio, sí.
  const doc = m.doc.sw > m.doc.cw + TOLERANCIA_PX || m.fueraDeVentana.length > 0;
  if (doc) di("sin-desborde", false, (m.doc.sw > m.doc.cw + TOLERANCIA_PX ? `el documento se desborda: mide ${m.doc.sw} px en una ventana de ${m.doc.cw}` : "algo se sale de su caja")
    + (m.fueraDeVentana.length ? ` (se sale: ${m.fueraDeVentana.map((f) => `«${f.texto}» hasta x=${f.der}`).join(", ")})` : ""),
    { sinExcepcion: true });
  else if (m.cajasConScroll.length) {
    const motivo = exc["MAR-05"];
    di("sin-desborde", Boolean(motivo), `${m.cajasConScroll.length} caja(s) con desplazamiento horizontal propio: `
      + m.cajasConScroll.map((c) => `${c.rol} «${c.texto}»`).join(", "), motivo ? { exceptuada: motivo } : {});
  } else di("sin-desborde", true, `documento de ${m.doc.sw} px en ${m.doc.cw}`);
  // MAR-07
  if (!m.activo) di("titulo-aporta", true, "no medida a este ancho: no hay destino activo visible", { noMedida: true });
  else if (!m.h1) di("titulo-aporta", false, `falta el h1 para compararlo con el destino activo «${m.activo}»`);
  else if (normaliza(m.h1.texto) !== normaliza(m.activo)) di("titulo-aporta", true, `«${m.h1.texto}» distinto del destino «${m.activo}»`);
  else di("titulo-aporta", m.franjaExtra, m.franjaExtra ? `igual al destino «${m.activo}», con un dato en la franja`
    : `el título «${m.h1.texto}» repite el destino activo y la franja no trae otro dato`);
  // MAR-08 (parte en la página). En Figma no hay CSS: no aplica.
  if (m.anchosPropios === null) di("css-del-marco", true, "no aplica (Figma): no hay CSS", { noMedida: true });
  else di("css-del-marco", m.anchosPropios.length === 0, m.anchosPropios.length
    ? m.anchosPropios.map((a) => `${a.elemento} fija ${a.prop}: ${a.valor}`).join("; ") : "sin anchos de página propios");
  // FUN-12 y FUN-14. En Figma el largo de línea no se lee del volcado.
  if (m.lineasLargas === null) di("medida-lectura", true, "no medida (Figma)", { noMedida: true });
  else di("medida-lectura", m.lineasLargas.length === 0, m.lineasLargas.length
    ? m.lineasLargas.map((l) => `«${l.texto}…» ${l.cpl} caracteres por línea (tope ${CPL_MAX})`).join("; ") : "texto corrido dentro del tope");
  // COM-17 (manual 2.7, spec 2026-10-15 confirmaciones §3.1): ningún mensaje de estado flota sobre el contenido. En
  // Figma no aplica (lo mide verifica-prototipo-figma.py con el tipo de navegación); una medida anterior no lo trae.
  if (m.flotantes === null) di("sin-flotante", true, "no aplica (Figma): lo mide el verificador del prototipo", { noMedida: true });
  else if (!Array.isArray(m.flotantes)) di("sin-flotante", true, "no medida: medida anterior al manual 2.7", { noMedida: true });
  else di("sin-flotante", m.flotantes.length === 0, m.flotantes.length
    ? m.flotantes.map((f) => `mensaje de estado flotante: «${f.texto}» (${f.como}) — va en su sección o en la zona de avisos`).join("; ")
    : "ningún mensaje de estado flota sobre el contenido");
  // MAR-14 (manual 2.9): en el celular, en reposo, el h1 de la franja termina a 160 px o menos y el contexto («volver» o
  // migas) va en una línea; el contenido se desplaza con la página (ninguna caja con desplazamiento vertical propio fuera
  // de un componente de dos dimensiones); al desplazar una pantalla, lo fijo o pegado arriba mide 64 px o menos y no tapa
  // el control con el foco. Sin tolerancia: 160 pasa, 161 falla; 64 pasa, 65 falla. En Figma (README del manual) solo se
  // mide el reposo: lo del desplazamiento llega en null y se juzga, y así lo dice el detalle.
  const mc = m.marcoCelular;
  const figma = m.anchosPropios === null;
  if (!(w < ANGOSTO_HASTA)) di("marco-celular", true, `no aplica a ${w} px (solo a menos de ${ANGOSTO_HASTA})`, { noMedida: true });
  else if (mc == null) di("marco-celular", true, figma ? "no medida (volcado de Figma anterior al manual 2.9)" : "no medida (medida anterior al manual 2.9)", { noMedida: true });
  else {
    const num = (v) => typeof v === "number" && Number.isFinite(v);
    const fallas = [], bien = [];
    if (!num(mc.h1Fondo)) bien.push("la franja no tiene h1: el reposo no se mide");
    else if (mc.h1Fondo > TOPE_MARCO_REPOSO)
      fallas.push(`en reposo, el h1 de la franja termina a ${mc.h1Fondo} px; en el celular, el marco llega como mucho a ${TOPE_MARCO_REPOSO} (un cuarto de una pantalla de ${PANTALLA_REF})`);
    else bien.push(`en reposo, el h1 termina a ${mc.h1Fondo} px`);
    if (num(mc.volverLineas) && mc.volverLineas > 1)
      fallas.push(`el contexto («volver» o migas) ocupa ${mc.volverLineas} líneas; va en una sola, con un texto corto («← Volver») y el destino en su nombre accesible`);
    else if (num(mc.volverLineas)) bien.push("el contexto en una línea");
    const desplaza = num(mc.desplazablesPropios) || num(mc.fijoDesplazado) || typeof mc.tapaFoco === "boolean";
    if (num(mc.desplazablesPropios) && mc.desplazablesPropios > 0)
      fallas.push(`${mc.desplazablesPropios} caja(s) con desplazamiento vertical propio: el contenido se desplaza con la página, no dentro de una caja`);
    else if (num(mc.desplazablesPropios)) bien.push("el contenido se desplaza con la página");
    if (num(mc.fijoDesplazado) && mc.fijoDesplazado > TOPE_FIJO_DESPLAZADO)
      fallas.push(`al desplazar, lo fijo o pegado arriba mide ${mc.fijoDesplazado} px; como mucho una barra de ${TOPE_FIJO_DESPLAZADO}`);
    else if (num(mc.fijoDesplazado)) bien.push(`lo fijo al desplazar mide ${mc.fijoDesplazado} px`);
    if (mc.tapaFoco === true) fallas.push("al desplazar, algo fijo o pegado tapa el control con el foco");
    let juzga = "";
    if (!desplaza) juzga = figma ? "; lo del desplazamiento no se mide en Figma: se juzga" : "; lo del desplazamiento no se midió";
    const medido = num(mc.h1Fondo) || num(mc.volverLineas) || desplaza;
    if (fallas.length) di("marco-celular", false, fallas.join("; ") + juzga);
    else di("marco-celular", true, bien.join("; ") + juzga, medido ? {} : { noMedida: true });
  }
  di("sin-truncar", m.truncados.length === 0, m.truncados.length
    ? `recortado: ${m.truncados.map((t) => `«${t.texto}»`).join(", ")}` : "nada recortado");
  // MAR-09: lo angosto, al borde de su columna (la sección lado a lado que lo contiene, `base`, o el cuerpo; manual 2.5,
  // spec 2026-10-06 §8.2) y en la medida de formulario.
  const forms = m.formularios;
  if (forms === undefined) di("angosto-al-borde", true, "no medida (medida anterior al manual 2.2)", { noMedida: true });
  // La medida de Figma no trae CSS (anchosPropios === null): allí la marca es la capa «formulario», no un atributo.
  else if (!forms.length) di("angosto-al-borde", !ctx.angosto, ctx.angosto
    ? `el encargo pide contenido angosto y la pantalla no lo marca (${m.anchosPropios === null ? "la capa «formulario»" : "data-medida=\"formulario\""})`
    : "sin contenido angosto");
  else if (!m.medidaFormulario) di("angosto-al-borde", false, "sin --medida-formulario: el sistema no trae la medida");
  else if (!m.cuerpo) di("angosto-al-borde", false, "falta el cuerpo para comparar el formulario");
  else {
    const fallas = [], bordes = [];
    for (const f of forms) {
      const b = f.base != null ? f.base : m.cuerpo.x;
      bordes.push(b);
      if (!cerca(f.x, b)) fallas.push(f.base != null ? `tu formulario empieza en x=${f.x}; su sección, en x=${b}: no se centra, va al borde`
        : `tu formulario empieza en x=${f.x}; el cuerpo, en x=${b}: no se centra, va al borde`);
      if (ancho(f) > m.medidaFormulario + TOLERANCIA_PX) fallas.push(`tu formulario mide ${ancho(f)}; la medida de formulario es ${m.medidaFormulario}`);
    }
    const enColumna = bordes.some((b) => b !== m.cuerpo.x);
    di("angosto-al-borde", fallas.length === 0, fallas.join("; ")
      || (enColumna ? `formulario al borde de su sección (x=${[...new Set(bordes)].join(", ")}) y dentro de la medida`
        : `formulario al borde (x=${m.cuerpo.x}) y dentro de la medida`));
  }
  // NAV-07: el logotipo del cliente en la navegación global, como imagen con su texto alternativo.
  const marca = ctx.marca;
  if (!marca) di("logo-en-navegacion", true, "no aplica: el proyecto no declara logotipo para la navegación", { noMedida: true });
  else if (!m.navegacion) di("logo-en-navegacion", true, "no medida: no hay navegación global en esta medida", { noMedida: true });
  else if (m.navegacion.logo !== undefined) {
    const t = m.navegacion.logo && m.navegacion.logo.tipo;
    di("logo-en-navegacion", t === "imagen" || t === "vector", t === "texto"
      ? `la marca está redibujada como texto en la navegación; va el logo del cliente (${marca.archivo})`
      : t ? `logo del cliente en la navegación (${t})` : `la navegación no tiene la capa «logo» con el logo del cliente (${marca.archivo})`);
  } else {
    const hay = m.navegacion.imagenes.some((i) => normaliza(i.alt) === normaliza(marca.alt));
    const comoTexto = !hay && m.navegacion.textos.some((t) => normaliza(t) === normaliza(marca.alt));
    di("logo-en-navegacion", hay, hay ? `logo «${marca.alt}» en la navegación`
      : comoTexto ? `la marca «${marca.alt}» está redibujada como texto en la navegación; va la imagen del logo con ese texto alternativo`
        : `la navegación global no muestra el logo «${marca.alt}» (una imagen con ese texto alternativo)`);
  }
  // ---- Manual 2.3 (spec 2026-10-02 §5 a §7). Cada regla empieza con su «no medida» si la medida no trae su campo
  // (una medida anterior al 2.3): nunca pasa ni falla en silencio.
  const noMedidaPrevia = (regla) => di(regla, true, "no medida: medida anterior al manual 2.3", { noMedida: true });
  // MAR-10: cada fila empieza en el borde de su sección (`base`: la columna de un contenedor horizontal); sin `base`,
  // en el del cuerpo.
  if (m.filas === undefined) noMedidaPrevia("linea-de-inicio");
  else if (!m.cuerpo) di("linea-de-inicio", false, "falta el cuerpo para comparar las filas");
  else {
    const baseDe = (f) => f.base ?? m.cuerpo.x;
    const deSeccion = (f) => f.base != null && !cerca(f.base, m.cuerpo.x);
    const malas = m.filas.filter((f) => !cerca(f.x0, baseDe(f)));
    di("linea-de-inicio", malas.length === 0, malas.length
      ? malas.slice(0, 5).map((f) => `la fila «${f.texto}» empieza en x=${f.x0}; `
        + (deSeccion(f) ? `su sección, en x=${f.base}` : `el cuerpo, en x=${m.cuerpo.x}`) + ": sin sangría propia").join("; ")
      : !m.filas.length ? "sin filas en el cuerpo"
        : m.filas.some(deSeccion) ? `${m.filas.length} filas en el borde de su sección` : `${m.filas.length} filas en x=${m.cuerpo.x}`);
  }
  // FUN-37: un solo espacio entre bloques apilados.
  if (m.bloques === undefined) noMedidaPrevia("espacio-entre-bloques");
  else if (!m.entreBloques) di("espacio-entre-bloques", false, m.anchosPropios === null
    ? "sin espacio.entre-bloques en tokens.json: el sistema no trae el espacio entre bloques"
    : "sin --espacio-entre-bloques: el sistema no trae el espacio entre bloques");
  else {
    const fallas = [];
    // Cada bloque se compara con el borde inferior más bajo de los anteriores (`p`), no con el último: dos bloques lado a
    // lado de alto distinto y uno debajo miden el salto desde el más alto de los dos.
    let p = null;
    for (const s of m.bloques) {
      if (p && s.arriba >= p.abajo - TOLERANCIA_PX) { // si empieza antes, va lado a lado: no es un salto vertical
        const salto = Math.round(s.arriba - p.abajo);
        if (!cerca(salto, m.entreBloques)) fallas.push(`entre «${p.nombre}» y «${s.nombre}» hay ${salto} px; entre bloques van ${m.entreBloques} (espacio.entre-bloques)`);
      }
      if (!p || s.abajo > p.abajo) p = s;
    }
    di("espacio-entre-bloques", fallas.length === 0, fallas.join("; ") || `saltos de ${m.entreBloques} px`);
  }
  // FUN-38 y FUN-39 sobre las superficies.
  if (m.superficies === undefined) { noMedidaPrevia("relleno-simetrico"); noMedidaPrevia("borde-sin-radio"); }
  else {
    const fallas = [];
    const medidas = m.superficies.filter((x) => x.fondo && !x.interactiva && !x.desplaza && x.area >= 5000 && x.hijosX != null);
    // Ruling 37: el bloque de marca (sin fondo, o con fondo pero fuera de las superficies medidas: chico o un enlace) solo
    // compara su contenido con sus bordes, salvo que vaya al centro o al final. Va primero: es el defecto de Radar.
    const bm = m.bloqueMarca;
    if (bm && bm.hijosX != null && bm.hijosDer != null
      && !(bm.fondo && medidas.some((s) => s.nombre === bm.nombre && s.x === bm.x && s.der === bm.der))) {
      const izq = bm.hijosX - (bm.x + (bm.bordeIzq || 0)), der = (bm.der - (bm.bordeDer || 0)) - bm.hijosDer;
      if (bm.alineado !== "centro" && bm.alineado !== "final" && der < izq - TOLERANCIA_PX)
        fallas.push(`bloque de marca: el contenido queda a ${izq} px del borde izquierdo y a ${der} del derecho`);
    }
    for (const s of medidas) {
      // Desde el borde interior del borde (Ruling 17): un borde de acento no cuenta como relleno. Sin bordeIzq/bordeDer
      // (una medida anterior), 0.
      const izq = s.hijosX - (s.x + (s.bordeIzq || 0)), der = (s.der - (s.bordeDer || 0)) - s.hijosDer;
      // Ruling 24 (a): con el contenido al centro o al final (una cifra a la derecha), su extensión no dice nada del
      // relleno: solo se comparan los rellenos. Sin `alineado` (una medida anterior), se compara como antes.
      const alFinal = s.alineado === "centro" || s.alineado === "final";
      if (Math.abs(s.pl - s.pr) > TOLERANCIA_PX) fallas.push(`${s.nombre}: relleno ${s.pl} px a la izquierda y ${s.pr} a la derecha`);
      else if (!alFinal && der < izq - TOLERANCIA_PX) fallas.push(`${s.nombre}: el contenido queda a ${izq} px del borde izquierdo y a ${der} del derecho`);
    }
    // Una medida anterior al bloque de marca (sin el campo) con navegación: se decide como antes, pero no en silencio.
    const sinBloque = m.bloqueMarca === undefined && m.navegacion
      ? " (el bloque de marca no se midió: la medida es anterior; vuelve a tomarla con el script de hoy)" : "";
    di("relleno-simetrico", fallas.length === 0, (fallas.slice(0, 5).join("; ") || "relleno simétrico") + sinBloque);
    const esquinas = [];
    for (const s of m.superficies.filter((x) => x.fondo)) {
      const izq = s.x <= TOLERANCIA_PX, der = s.der >= m.vw - TOLERANCIA_PX;
      const rIzq = Math.max(s.radios[0], s.radios[3]), rDer = Math.max(s.radios[1], s.radios[2]);
      if (izq && der && (rIzq > 0 || rDer > 0)) esquinas.push(`${s.nombre} toca los dos bordes y tiene radio ${Math.max(rIzq, rDer)}`);
      else if (izq && rIzq > 0) esquinas.push(`${s.nombre} toca el borde izquierdo y tiene radio ${rIzq}`);
      else if (der && rDer > 0) esquinas.push(`${s.nombre} toca el borde derecho y tiene radio ${rDer}`);
    }
    di("borde-sin-radio", esquinas.length === 0, esquinas.slice(0, 5).join("; ") || "sin esquinas redondeadas contra el borde");
  }
  // FUN-05: valores de espaciado de la escala.
  if (m.espaciados === undefined) noMedidaPrevia("escala-de-espaciado");
  else if (!m.escala || !m.escala.length) di("escala-de-espaciado", true, "no medida: sin escala de espaciado en el sistema", { noMedida: true });
  else {
    const fuera = m.espaciados.filter((e) => e.valor > 0 && !m.escala.some((v) => Math.abs(v - e.valor) <= 0.5));
    di("escala-de-espaciado", fuera.length === 0, fuera.length
      ? `valores fuera de la escala: ${fuera.slice(0, 5).map((e) => `${String(e.valor).replace(".", ",")} px (${e.donde})`).join(", ")}`
      : "espaciado de la escala");
  }
  // NAV-08: el nombre del producto con estilo propio (familia, peso y tracking). Una medida anterior sin letterSpacing (en
  // la marca o en el otro texto) se compara como antes, por familia y peso.
  const fam = (s) => normaliza(String(s).split(",")[0].replace(/["']/g, ""));
  const mismoTracking = (a, b) => !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) <= 0.05;
  if (m.estilos === undefined) noMedidaPrevia("marca-producto");
  else if (!m.navegacion) di("marca-producto", true, "no medida: no hay navegación global en esta medida", { noMedida: true });
  else if (!m.estilos.marca) di("marca-producto", false, "la navegación global no marca el nombre del producto (marca-producto)");
  else {
    const mk = m.estilos.marca, fallas = [];
    const igual = (m.estilos.otros || []).find((o) => fam(o.familia) === fam(mk.familia) && Number(o.peso) === Number(mk.peso)
      && mismoTracking(o.letterSpacing, mk.letterSpacing));
    const ls = Number.isFinite(mk.letterSpacing) && mk.letterSpacing ? `, tracking ${mk.letterSpacing} px` : "";
    if (igual) fallas.push(`el nombre del producto (${mk.familia} ${mk.peso}${ls}) comparte estilo con «${igual.texto}»`);
    const lg = m.estilos.logo;
    if (lg && mk.arriba >= lg.abajo - TOLERANCIA_PX && !cerca(mk.x, lg.x))
      fallas.push(`logo y nombre uno sobre otro sin borde inicial común: logo en x=${lg.x}, nombre en x=${mk.x}`);
    di("marca-producto", fallas.length === 0, fallas.join("; ") || `«${mk.texto}» con estilo propio (${mk.familia} ${mk.peso}${ls})`);
  }
  // COM-08: toda tabla con encabezado; cifras tabulares (solo navegador).
  if (m.tablas === undefined) noMedidaPrevia("tabla-con-encabezado");
  else {
    const fallas = [];
    for (const t of m.tablas) {
      if (!t.encabezado) fallas.push(`${t.filas} filas de ${t.nombre} forman ${t.columnas} columnas y no tienen encabezado`);
      if (t.cifrasSinTabular && t.cifrasSinTabular.length) fallas.push(`${t.nombre}: cifras sin tabular-nums (${t.cifrasSinTabular.slice(0, 3).map((x) => `«${x}»`).join(", ")})`);
    }
    di("tabla-con-encabezado", fallas.length === 0, fallas.join("; ") || (m.tablas.length ? `${m.tablas.length} tabla(s) con encabezado` : "sin tablas"));
  }
  // LIS-02: cada tabla de trabajo declarada filtra por columna (o con «Filtrar» si está apilada). La «no medida» va
  // primero: una medida anterior al 2.3 no pasa en silencio aunque el encargo no declare tablas.
  const decl = ctx.tablasTrabajo || [];
  if (m.tablasTrabajo === undefined) noMedidaPrevia("filtro-por-columna");
  else if (!decl.length) di("filtro-por-columna", true, "sin tablas de trabajo declaradas en el encargo");
  else {
    const fallas = [];
    if (m.tablasTrabajo.length < decl.length)
      fallas.push(`el encargo pide ${decl.length} tabla(s) de trabajo y la pantalla marca ${m.tablasTrabajo.length} (tabla-de-trabajo)`);
    decl.forEach((d, i) => {
      const t = m.tablasTrabajo[i]; if (!t) return;
      if (t.encabezadoVisible && t.filtros < d.columnas.length) fallas.push(`la tabla «${d.nombre}» filtra por ${d.columnas.length} columnas y trae ${t.filtros} control(es)`);
      if (!t.encabezadoVisible && !t.filtrar) fallas.push(`a ${m.vw} px la tabla «${d.nombre}» se apila y no trae el botón «Filtrar»`);
    });
    di("filtro-por-columna", fallas.length === 0, fallas.join("; ") || "tablas de trabajo con filtro por columna");
  }
  // DET-12 (manual 2.4): en el celular, la cabecera de un detalle mide 320 px o menos (su caja exterior).
  const angosto = m.vw < ANGOSTO_HASTA;
  if (ctx.patron === "detalle") {
    if (!angosto) di("cabecera-compacta", true, `no aplica a ${m.vw} px (solo a menos de ${ANGOSTO_HASTA})`, { noMedida: true });
    else if (!m.franja) di("cabecera-compacta", true, "no medida (sin cabecera)", { noMedida: true });
    else if (!Number.isFinite(m.franja.alto)) di("cabecera-compacta", true, "no medida (medida sin el alto de la cabecera)", { noMedida: true });
    else di("cabecera-compacta", m.franja.alto <= TOPE_CABECERA_ANGOSTA + TOLERANCIA_PX, m.franja.alto <= TOPE_CABECERA_ANGOSTA + TOLERANCIA_PX
      ? `cabecera de ${m.franja.alto} px` : `la cabecera mide ${m.franja.alto} px; en el celular, ${TOPE_CABECERA_ANGOSTA} como mucho`);
  }
  // FUN-42 (manual 2.4): en el celular, el primer texto del segundo bloque del cuerpo (o del único) se ve entero en 640.
  const delCuerpo = (m.bloques || []).filter((b) => b.nombre !== "franja" && b.nombre !== "avisos");
  if (!angosto) di("lo-siguiente-asoma", true, `no aplica a ${m.vw} px (solo a menos de ${ANGOSTO_HASTA})`, { noMedida: true });
  else if (!Array.isArray(m.bloques) || m.bloques.some((b) => !("texto" in b)))
    di("lo-siguiente-asoma", true, "no medida (medida anterior al manual 2.4: los bloques no traen su primer texto)", { noMedida: true });
  else if (!delCuerpo.length) di("lo-siguiente-asoma", true, "no aplica: el cuerpo no tiene bloques", { noMedida: true });
  else {
    const b = delCuerpo[Math.min(1, delCuerpo.length - 1)];
    const fin = b.texto ? b.texto.abajo : b.arriba + ASOMA_SIN_TEXTO;
    const que = b.texto ? `su primer texto termina a ${fin} px` : `sus primeros ${ASOMA_SIN_TEXTO} px llegan a ${fin}`;
    // Sin tolerancia: el borde es «termina en 640 pasa, en 641 falla» (DET-12 sí la suma: 321 pasa, 322 falla).
    di("lo-siguiente-asoma", fin <= PANTALLA_REF, fin <= PANTALLA_REF
      ? `«${b.nombre}» asoma (${que})` : `«${b.nombre}» empieza a ${b.arriba} px y ${que}; en el celular, lo siguiente asoma dentro de ${PANTALLA_REF}`);
  }
  // AJU-05 (manual 2.5, spec 2026-10-06 §6.1): desde 672, la sub-navegación va horizontal arriba del contenido, en una
  // sola fila y de borde a borde del cuerpo; ninguna pestaña se sale de ella (las que no caben pasan a «Más»). Las filas
  // se agrupan por superposición vertical: un contador más bajo que su pestaña queda en la misma fila.
  const filasDe = (items) => { const fs = [];
    for (const it of [...items].sort((p, q) => p.arriba - q.arriba)) {
      const f = fs.find((g) => g.some((o) => it.arriba < o.abajo && o.arriba < it.abajo));
      if (f) f.push(it); else fs.push([it]); }
    return fs; };
  const previa25 = "no medida (medida anterior al manual 2.5)";
  const noAngosto = `no aplica a ${w} px (solo desde ${ANGOSTO_HASTA})`;
  if (!(w >= ANGOSTO_HASTA)) di("subnavegacion-arriba", true, noAngosto, { noMedida: true });
  else if (m.subnavegacion === null) di("subnavegacion-arriba", true, "no aplica: la pantalla no marca sub-navegación", { noMedida: true });
  else if (m.subnavegacion === undefined || !Array.isArray(m.subnavegacion.items)) di("subnavegacion-arriba", true, previa25, { noMedida: true });
  else if (!m.subnavegacion.items.length) di("subnavegacion-arriba", true, "no medida: la sub-navegación no muestra pestañas", { noMedida: true });
  else if (!m.cuerpo) di("subnavegacion-arriba", false, "falta el cuerpo para comparar la sub-navegación");
  else {
    const sn = m.subnavegacion, items = sn.items, fallas = [];
    if (filasDe(items).length > 1) fallas.push(items.every((it) => cerca(it.x, items[0].x))
      ? `a ${w} px la sub-navegación va en vertical; va horizontal arriba del contenido`
      : `a ${w} px la sub-navegación va en dos filas; las que no caben pasan a «Más»`);
    if (!cerca(sn.x, m.cuerpo.x) || !cerca(sn.der, m.cuerpo.der))
      fallas.push(`a ${w} px la sub-navegación va de x=${sn.x} a ${sn.der}; su línea inferior va a todo el ancho del cuerpo (x=${m.cuerpo.x} a ${m.cuerpo.der})`);
    for (const it of items.filter((x) => x.der > sn.der + TOLERANCIA_PX).slice(0, 3))
      fallas.push(`a ${w} px la pestaña «${it.texto}» se sale de la sub-navegación (termina en x=${it.der}); pasa las que no caben a «Más»`);
    di("subnavegacion-arriba", fallas.length === 0, fallas.join("; ")
      || `sub-navegación horizontal arriba, de x=${sn.x} a ${sn.der} (${items.length} pestañas)`);
  }
  // MAR-12 (manual 2.6, spec 2026-10-07 partes-iguales §3.2): desde 672, las secciones de cada grupo lado a lado (dos o
  // más, por x) llenan su columna (la primera empieza en su borde y la última termina en el otro), miden lo mismo con el
  // mismo espacio entre ellas, y cada control que va solo en su línea termina en el interior de su sección o en la
  // medida de formulario, lo que llegue antes; ±1. Haya o no tabla debajo. El valor del espacio lo mira el juez
  // (`marco-comun`). Un grupo sin los campos del 2.6 deja la regla «no medida»; sin la medida de formulario, también,
  // salvo que las secciones ya fallen.
  const previa26 = "no medida (medida anterior al manual 2.6)";
  const grupos12 = Array.isArray(m.ladoALado) ? m.ladoALado.filter((g) => (g.secciones || []).length >= 2) : [];
  if (!(w >= ANGOSTO_HASTA)) di("partes-iguales", true, noAngosto, { noMedida: true });
  else if (m.ladoALado === undefined) di("partes-iguales", true, previa25, { noMedida: true });
  else if (!grupos12.length) di("partes-iguales", true, "no aplica: sin secciones lado a lado", { noMedida: true });
  else if (!grupos12.every(grupo26)) di("partes-iguales", true, previa26, { noMedida: true });
  else {
    const fallas = [], medidos = [];
    let sinMedida = false;
    const nombres = (ss) => ss.map((s) => `«${s.nombre}»`).join(", ").replace(/, (?=[^,]*$)/, " y ");
    for (const g of grupos12) {
      const ss = [...g.secciones].sort((p, q) => p.x - q.x), n = ss.length, ult = ss[n - 1], col = g.columna;
      medidos.push(nombres(ss));
      if (!cerca(ss[0].x, col.x))
        fallas.push(`a ${w} px «${ss[0].nombre}» empieza en x=${ss[0].x} y su columna en x=${col.x}: la primera sección empieza en el borde de su columna`);
      if (!cerca(ult.der, col.der))
        fallas.push(`a ${w} px «${ult.nombre}» termina en x=${ult.der} y su columna en x=${col.der}: la última sección termina en el borde de su columna`);
      const anchos = ss.map(ancho), espacios = ss.slice(1).map((s, i) => s.x - ss[i].der);
      if (anchos.some((a) => !cerca(a, anchos[0]))) {
        const parte = Math.round(((col.der - col.x - (n - 1) * espacios[0]) / n) * 10) / 10;
        fallas.push(`a ${w} px ${ss.map((s, i) => `«${s.nombre}» mide ${anchos[i]}`).join(", ")}: a partes iguales, cada una ${parte}`);
      }
      if (espacios.some((e) => !cerca(e, espacios[0])))
        fallas.push(`a ${w} px el espacio entre las secciones de ${nombres(ss)} es ${espacios.join(", ")}: el mismo entre todas`);
      for (const s of ss) for (const c of s.controles) {
        if (!m.medidaFormulario) { sinMedida = true; continue; }
        const fin = Math.min(s.dentro, c.x + m.medidaFormulario);
        if (!cerca(c.der, fin)) fallas.push(`a ${w} px el control de «${s.nombre}» termina en x=${c.der}; `
          + (fin === s.dentro ? `su sección, en x=${s.dentro}` : `la medida de formulario, en x=${fin}`) + ": llénala hasta ahí");
      }
    }
    if (fallas.length) di("partes-iguales", false, fallas.join("; "));
    else if (sinMedida) di("partes-iguales", true, "no medida: sin la medida de formulario para medir los controles", { noMedida: true });
    else di("partes-iguales", true, `a partes iguales: ${medidos.join("; ")}`);
  }
  // FUN-43 se sigue midiendo desde el ancho del 2.4.
  const noAncho = `no aplica a ${w} px (solo desde ${ANCHO_DESDE})`;
  // FUN-43 (manual 2.4, §17.5): desde 1056, el bloque del cuerpo que domina la primera pantalla (el que más alto ocupa
  // antes de 800: min(abajo, 800) − arriba; en empate, el primero) llega al menos al 60 % del ancho del cuerpo con lo
  // que se ve dentro. El más ancho no basta: una barra baja de borde a borde no salva un formulario alto y angosto.
  // Sin tolerancia en el porcentaje.
  const delCuerpoAncho = (m.bloques || []).filter((b) => b.nombre !== "franja" && b.nombre !== "avisos");
  if (!(w >= ANCHO_DESDE)) di("peso-repartido", true, noAncho, { noMedida: true });
  else if (ctx.declaraCompleto) di("peso-repartido", true, "no aplica: la pantalla declara marco completo", { noMedida: true });
  else if (!Array.isArray(m.bloques) || delCuerpoAncho.some((b) => !("contenido" in b)))
    di("peso-repartido", true, "no medida (medida anterior al manual 2.4: los bloques no traen lo que se ve dentro)", { noMedida: true });
  else if (!m.cuerpo) di("peso-repartido", false, "falta el cuerpo para medir hasta dónde llega el contenido");
  else {
    const vistos = delCuerpoAncho.filter((b) => b.arriba < PANTALLA_REF_ANCHA && b.contenido);
    if (!vistos.length) di("peso-repartido", true, `no aplica: ningún bloque del cuerpo muestra contenido antes de ${PANTALLA_REF_ANCHA} px`, { noMedida: true });
    else {
      const total = m.cuerpo.der - m.cuerpo.x;
      const alto = (b) => Math.min(b.abajo, PANTALLA_REF_ANCHA) - b.arriba;
      const domina = vistos.reduce((p, q) => (alto(q) > alto(p) ? q : p)); // estricto: en empate se queda el primero
      const alcance = domina.contenido.der - m.cuerpo.x;
      // El margen de 1e-9 solo absorbe el error de coma flotante de 0,6 × total (600 de 1000 pasa; 599, no).
      const pasa = alcance >= PESO_MINIMO * total - 1e-9;
      const crudo = total > 0 ? (alcance / total) * 100 : 0;
      // Redondeado; si falla y el redondeo diría que llega (59,9 → 60), con un decimal.
      const pct = !pasa && Math.round(crudo) >= PESO_MINIMO * 100 ? String(Math.floor(crudo * 10) / 10).replace(".", ",") : String(Math.round(crudo));
      const lleva = `a ${w} px: «${domina.nombre}», lo que domina la primera pantalla, llega a ${alcance} de los ${total} px del cuerpo (${pct} %)`;
      di("peso-repartido", pasa, pasa ? lleva : `${lleva}; hace falta al menos el ${PESO_MINIMO * 100} %: `
        + "reparte el ancho con lo que ya existe (el grupo tabular como tabla, las secciones cortas lado a lado), sin inventar contenido");
    }
  }
  // Excepciones del encargo: solo donde se admiten.
  for (const r of out) {
    if (r.ok || r.exceptuada) continue;
    const cod = r.codigos.find((c) => exc[c]);
    if (!cod) continue;
    if (r.sinExcepcion || SIN_EXCEPCION.has(cod)) r.excepcionNoAdmitida = exc[cod];
    else r.exceptuada = exc[cod];
  }
  return ctx.reglas ? out.filter((r) => ctx.reglas.includes(r.regla)) : out;
}

// Referencia de cada grupo y ancho: el contenedor de su modelo (o de la primera pantalla del grupo que usa el marco).
// registros: [{pantalla, w, m}] · grupoDe(pantalla) -> nombre · modelos: {grupo: "P-0X"}
export function referencias(registros, grupoDe, modelos = {}) {
  const ref = {};
  const grupos = new Set(registros.map((r) => grupoDe(r.pantalla)));
  for (const g of grupos) {
    const delGrupo = registros.filter((r) => grupoDe(r.pantalla) === g && !r.m.sinMain);
    // El grupo «completo» (páginas de ancho completo) no hereda la modelo del marco del producto.
    const declarada = modelos[g] || (g !== "completo" ? modelos["*"] : null) || null;
    const modelo = declarada || (delGrupo.find((r) => r.m.marcos === 1) || {}).pantalla || null;
    // Una corrida parcial (--solo) puede no pasar por la modelo declarada: entonces no hay contra qué medir.
    ref[g] = { modelo, porAncho: {}, sinVisitar: Boolean(declarada) && !registros.some((r) => r.pantalla === declarada) };
    if (!modelo) continue;
    // Solo cuenta el primer registro sano de la modelo (con su marco y su contenedor medidos), no uno a medio cargar.
    for (const r of delGrupo) if (r.pantalla === modelo && r.m.marcos === 1 && r.m.contenedor && !(r.w in ref[g].porAncho)) ref[g].porAncho[r.w] = r.m.contenedor;
  }
  return ref;
}

// La modelo de referencia del marco (spec 2026-10-01 §5.5): de las pantallas modelo, la de id más bajo. Vale para
// guion-demo/5 ({patrón: pantalla}) y para guion-demo/4 ({ancho: pantalla}), leída como lista. `completo` son las
// pantallas de marco completo del encargo cuyo patrón lo admite ({P: motivo}; quien llama filtra las que su patrón no
// admite: esas siguen en el grupo del marco del producto): no cuentan, porque una página de ancho completo no fija el
// marco del producto (con ella, el grupo «*» se quedaría sin referencia y toda pantalla normal fallaría MAR-02).
export function modeloDeReferencia(modelos, completo = {}) {
  const ps = [...new Set(Object.values(modelos || {}).filter((p) => typeof p === "string" && /^P-\d+$/.test(p) && !completo[p]))];
  return ps.sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))[0] || null;
}

// Reglas que comparan pantallas entre sí: MAR-02, MAR-04 y MAR-06.
// opts: { grupoDe, modelos, patronDe, excepcionesDe(pantalla) -> {codigo: motivo} }
export function evaluaConjunto(registros, opts) {
  const { grupoDe, modelos = {}, patronDe = () => null, excepcionesDe = () => ({}) } = opts;
  const ref = referencias(registros, grupoDe, modelos);
  const out = [];
  const di = (r, regla, ok, detalle, extra = {}) => out.push({ pantalla: r.pantalla, recorrido: r.recorrido, paso: r.paso, w: r.w,
    regla, codigos: CODIGOS[regla], ok, detalle, ...extra });
  for (const r of registros) {
    if (r.m.sinMain) continue;
    const g = ref[grupoDe(r.pantalla)];
    const base = g.porAncho[r.w];
    // Sin la modelo en esta corrida, MAR-02 y MAR-04 no se miden (no fallan): decide la corrida completa.
    const sinModelo = `no medida (la modelo ${g.modelo} no se visitó en esta corrida)`;
    // MAR-02
    if (!base && g.sinVisitar) di(r, "marco-comun", true, sinModelo, { noMedida: true });
    else if (!base) di(r, "marco-comun", false, `sin referencia a ${r.w} px: ninguna pantalla usa el marco del producto`);
    else {
      const c = r.m.contenedor;
      const ok = Boolean(c) && cerca(c.x, base.x) && cerca(ancho(c), ancho(base));
      di(r, "marco-comun", ok, ok ? `igual a ${g.modelo}: ${caja(base)}`
        : `a ${r.w} px tu contenedor empieza en ${c ? `x=${c.x} y mide ${ancho(c)}` : "—"}; el de la modelo ${g.modelo} empieza en x=${base.x} y mide ${ancho(base)}`);
    }
    // MAR-04
    const exc = excepcionesDe(r.pantalla);
    const avisos = r.m.avisos || [];
    if (!avisos.length) di(r, "avisos-en-marco", true, "sin avisos de la página");
    else if (!base && g.sinVisitar && avisos.length === 1) di(r, "avisos-en-marco", true, sinModelo, { noMedida: true });
    else if (!base && g.sinVisitar) di(r, "avisos-en-marco", false, `${avisos.length} avisos a la vez (uno como máximo)`);
    else if (!base) di(r, "avisos-en-marco", false, `sin referencia a ${r.w} px para comparar ${avisos.length} aviso(s)`);
    else {
      const fallas = [];
      if (avisos.length > 1) fallas.push(`${avisos.length} avisos a la vez (uno como máximo)`);
      for (const a of avisos) {
        const global = exc["MAR-04"] && a.x <= TOLERANCIA_PX && a.der >= r.m.vw - TOLERANCIA_PX
          && r.m.franja && a.arriba !== undefined && a.arriba < r.m.franja.arriba;
        if (global) continue;
        if (!cerca(a.x, base.x) || !cerca(a.der, base.der))
          fallas.push(`el aviso «${a.texto.slice(0, 40)}» va de x=${a.x} a ${a.der}; el marco, de ${base.x} a ${base.der}`);
      }
      di(r, "avisos-en-marco", fallas.length === 0, fallas.join("; ") || "avisos dentro del marco");
    }
    // MAR-06 (por pantalla: la zona)
    const a = r.m.accion;
    if (a && a.zona === "otra") di(r, "accion-en-su-sitio", false, "la acción principal no está en la franja del título ni al final de su formulario ni al final de su estado vacío");
    else if (a && a.alineacion === "medio") di(r, "accion-en-su-sitio", false, "la acción principal no está al inicio ni al fin de su zona");
    // MAR-06 en el celular (manual 2.4): la acción de la franja va al final, después del título, el estado y los datos.
    if (a && a.zona === "cabecera" && r.w < ANGOSTO_HASTA && Array.isArray(a.despues) && a.despues.length)
      di(r, "accion-en-su-sitio", false, `${a.despues.map((t) => `«${t}»`).join(", ")} va después de la acción principal; `
        + "en el celular la acción va al final de la franja");
    // Sin `despues` (un volcado de Figma anterior al manual 2.4) el orden no se mide: el veredicto de MAR-06 no puede
    // salir «pasa» (spec 2026-10-05 §9.2); `parteSinMedir` lo deja «no medida» si lo demás pasa (veredictos).
    else if (a && a.zona === "cabecera" && r.w < ANGOSTO_HASTA && !Array.isArray(a.despues))
      di(r, "accion-en-su-sitio", true, "no medido el orden en el celular: la medida no trae lo que va después de la acción "
        + "(anterior al manual 2.4)", { noMedida: true, parteSinMedir: true });
  }
  // MAR-06 (entre pantallas del mismo patrón y la misma zona: la misma alineación). Sin patrón conocido no se compara:
  // pantallas de patrones distintos pueden poner la acción en otro lado.
  const vistos = {};
  for (const r of registros) {
    const a = r.m.accion; if (!a || a.zona === "otra" || a.alineacion === "medio" || !patronDe(r.pantalla)) continue;
    const k = `${patronDe(r.pantalla)}|${a.zona}|${r.w}`;
    (vistos[k] ||= []).push({ r, a });
  }
  for (const lista of Object.values(vistos)) {
    const primera = lista[0];
    for (const { r, a } of lista) {
      const ok = a.alineacion === primera.a.alineacion;
      di(r, "accion-en-su-sitio", ok, ok ? `acción en ${a.zona}, al ${a.alineacion}`
        : `acción en ${a.zona} al ${a.alineacion}; en ${primera.r.pantalla} (mismo patrón) va al ${primera.a.alineacion}`);
    }
  }
  for (const x of out) {
    if (x.ok) continue;
    const exc = excepcionesDe(x.pantalla);
    const cod = x.codigos.find((c) => exc[c]);
    if (!cod) continue;
    if (SIN_EXCEPCION.has(cod)) x.excepcionNoAdmitida = exc[cod];
    else if (cod !== "MAR-04") x.exceptuada = exc[cod]; // MAR-04 ya usó su excepción (aviso global) arriba
  }
  return out;
}

// MAR-08, parte estática: los @media y los @container (manual 2.11) de cada pantalla usan cortes de la rejilla (o el
// corte − 0,02 px). En un @container, una consulta de estilo (`style(...)`) o de estado de desplazamiento
// (`scroll-state(...)`) no es un corte y no se mira; las unidades de contenedor (cqw, cqi…) tampoco son cortes. Los
// comentarios /* … */ del CSS no se leen (un comentario que nombra «@media» no es una regla): en un archivo HTML, solo
// los de dentro de cada <style>; fuera (un script, un atributo como accept="image/*") un «/*» no es un comentario. Las
// cadenas entre comillas del CSS (content: "/*") se copian tal cual, sin abrir un comentario.
// fuentes: {archivo: texto} · cortesPx: [320, 672, ...] · devuelve [{ archivo, tipo: "@media"|"@container", condicion, ok, detalle }]
const sinFunciones = (cond, nombres) => {
  let out = "";
  for (let i = 0; i < cond.length;) {
    const f = nombres.find((n) => cond.slice(i).toLowerCase().startsWith(`${n}(`) && !/[\w-]/.test(cond[i - 1] || ""));
    if (!f) { out += cond[i++]; continue; }
    let nivel = 0, j = i + f.length;
    for (; j < cond.length; j++) { if (cond[j] === "(") nivel++; else if (cond[j] === ")" && --nivel === 0) break; }
    out += " ";
    i = j + 1;
  }
  return out;
};
const sinComentariosCss = (css) => {
  let out = "";
  for (let i = 0; i < css.length;) {
    const c = css[i];
    if (c === '"' || c === "'") {
      // Una cadena termina en su comilla sin escapar o en un salto de línea (CSS no admite uno sin escapar).
      let j = i + 1;
      for (; j < css.length && css[j] !== c && css[j] !== "\n"; j++) if (css[j] === "\\") j++;
      out += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === "/" && css[i + 1] === "*") {
      const fin = css.indexOf("*/", i + 2);
      out += " ";
      i = fin < 0 ? css.length : fin + 2;
    } else { out += c; i++; }
  }
  return out;
};
const esHtml = (texto) => /<(style|script|html|head|body|!doctype)\b/i.test(texto);
const cssLegible = (texto) => esHtml(texto)
  ? texto.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, abre, css, cierra) => abre + sinComentariosCss(css) + cierra)
  : sinComentariosCss(texto);
export function revisaMedia(fuentes, cortesPx) {
  const out = [];
  for (const [archivo, texto] of Object.entries(fuentes)) {
    for (const mm of cssLegible(String(texto)).matchAll(/@(media|container)\b([^{]*)\{/g)) {
      const tipo = `@${mm[1]}`, cond = mm[2].trim();
      const medida = tipo === "@container" ? sinFunciones(cond, ["style", "scroll-state"]) : cond;
      const malos = [];
      for (const n of medida.matchAll(/(-?\d*\.?\d+)\s*(px|rem|em)\b/g)) {
        const px = n[2] === "px" ? parseFloat(n[1]) : parseFloat(n[1]) * 16;
        if (!cortesPx.some((c) => Math.abs(px - c) < 0.01 || Math.abs(px - (c - 0.02)) < 0.01)) malos.push(`${n[1]}${n[2]}`);
      }
      out.push({ archivo, tipo, condicion: cond, ok: malos.length === 0, detalle: malos.length ? `corte fuera de la rejilla: ${malos.join(", ")}` : "corte de la rejilla" });
    }
  }
  return out;
}

// Veredicto por pantalla (y estado, si lo hay; manual 2.4) y regla: falla si falla a algún ancho (sin excepción válida).
// Una parte de la regla que no se pudo medir (`parteSinMedir`, el orden de MAR-06 sin `despues`) la deja «no medida»
// si lo demás pasa: nunca «pasa» sin haberla medido entera.
export function veredictos(resultados) {
  const v = {}, sinMedir = new Set();
  for (const x of resultados) {
    const k = `${x.pantalla}|${x.estado || ""}|${x.regla}`;
    const prev = v[k] || { pantalla: x.pantalla, ...(x.estado ? { estado: x.estado } : {}), regla: x.regla, codigos: x.codigos, ok: true, noMedida: true, fallas: [] };
    if (!x.noMedida) prev.noMedida = false;
    if (x.parteSinMedir) sinMedir.add(k);
    if (!x.ok && !x.exceptuada) { prev.ok = false; prev.fallas.push(`${x.w} px: ${x.detalle}`); }
    v[k] = prev;
  }
  for (const k of sinMedir) if (v[k].ok) v[k].noMedida = true;
  return Object.values(v);
}

// Informe legible para el bucle y para la revisión: una sección por pantalla con lo que falla, en números.
export function informe(vered, media = []) {
  const lineas = ["# Informe de geometría", "",
    "Medido: el marco, la franja del título, los avisos, la acción principal, los formularios, el logo de la navegación y el desborde de cada pantalla a cada ancho; "
      + "el cuerpo frente a la franja, las filas, el espacio entre bloques, los rellenos, las esquinas, la escala de espaciado, el nombre del producto y las tablas; "
      + "la cabecera del detalle y lo que asoma en el celular, y los estados de cada pantalla.",
    "No medido aquí: lo que solo se ve en la imagen (lo juzgan los jueces y el juez de conjunto).", ""];
  const porPantalla = {};
  for (const x of vered) (porPantalla[x.estado ? `${x.pantalla} · ${x.estado}` : x.pantalla] ||= []).push(x);
  for (const p of Object.keys(porPantalla).sort()) {
    lineas.push(`## ${p}`, "");
    for (const x of porPantalla[p].sort((a, b) => a.codigos[0].localeCompare(b.codigos[0]))) {
      const resultado = x.noMedida ? "no medida" : x.ok ? "pasa" : "FALLA";
      lineas.push(`- **${x.codigos.join(", ")} (${x.regla}):** ${resultado}`);
      for (const f of x.fallas) lineas.push(`  - ${f}`);
    }
    lineas.push("");
  }
  const malos = media.filter((m) => !m.ok);
  if (malos.length) {
    lineas.push("## Cortes @media y @container fuera de la rejilla (MAR-08)", "");
    for (const m of malos) lineas.push(`- ${m.archivo}: \`${m.tipo || "@media"} ${m.condicion}\` — ${m.detalle}`);
    lineas.push("");
  }
  return lineas.join("\n");
}

// Colores por papel (spec 2026-10-02 §6.2): insumo del juez `color-con-un-significado`, no veredicto. Junta por color
// los textos que lo acompañan en todas las pantallas y anchos; arriba, los colores con textos de dos o más familias
// (familia = `donde`: componente, conjunto o selector). registros: [{pantalla, w, m}] · devuelve Markdown.
export function informeColores(registros) {
  const lineas = ["# Colores por papel", "",
    "Insumo del juez `color-con-un-significado` (spec 2026-10-02 §6.2): cada color no neutro con los textos que lo",
    "acompañan. No es un veredicto: un mismo color en un botón y en un enlace no es un defecto.", ""];
  const porColor = new Map();
  let medidas = 0;
  // Hallazgo 10: un marco de Figma cuyo volcado recortó los colores (coloresRecortados) no se midió; uno al que un tope
  // le dejó colores fuera (coloresIncompletos) se midió a medias. Los dos se dicen, nunca un «- ninguno» en silencio.
  const recortados = [], incompletos = [];
  for (const r of registros || []) {
    if (r.m && r.m.coloresRecortados) { recortados.push(`${r.pantalla} a ${r.w} px`); continue; }
    const cs = r.m && r.m.colores;
    if (!Array.isArray(cs)) continue;
    medidas += 1;
    if (r.m.coloresIncompletos) incompletos.push(`${r.pantalla} a ${r.w} px (${r.m.coloresIncompletos})`);
    for (const c of cs) {
      const k = String(c.color || "").toLowerCase();
      if (!k) continue;
      const e = porColor.get(k) || { textos: new Map(), familias: new Set(), pantallas: new Set() };
      for (const t of c.textos || []) {
        e.textos.set(`${t.texto}\u0000${t.donde}`, t);
        e.familias.add(t.donde);
      }
      e.pantallas.add(r.pantalla);
      porColor.set(k, e);
    }
  }
  const notas = [
    ...(recortados.length ? [`No medido: los colores de ${recortados.join(", ")}: el volcado de Figma los recortó para caber en la respuesta `
      + "de use_figma (recortado: colores); vuelve a tomar ese marco solo (PANTALLAS y ANCHOS) con volcado-geometria-figma.js."] : []),
    ...(incompletos.length ? [`Incompleto: ${incompletos.join("; ")}: faltan los colores que pasaron el tope del volcado.`] : [])];
  if (!medidas) return [...lineas, ...(notas.length ? notas : ["No medido: medidas anteriores al manual 2.3."]), ""].join("\n");
  if (notas.length) lineas.push(...notas, "");
  const linea = ([color, e]) => `- \`${color}\`: ${[...e.textos.values()].map((t) => `«${t.texto}» (${t.donde})`).join(" · ") || "(sin texto)"}`
    + ` — ${[...e.pantallas].sort().join(", ")}`;
  const todos = [...porColor.entries()].sort(([a], [b]) => a.localeCompare(b));
  const varias = todos.filter(([, e]) => e.familias.size >= 2);
  lineas.push("## Colores con textos de dos o más familias", "", ...(varias.length ? varias.map(linea) : ["- ninguno"]), "",
    "## Todos", "", ...(todos.length ? todos.map(linea) : ["- ninguno"]), "");
  return lineas.join("\n");
}

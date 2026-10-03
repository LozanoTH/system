/* =========================================================
   POS de facturación
   Catálogo y facturas en Firebase Realtime Database.
   ========================================================= */

/* ---------- Estado ---------- */
let iniciado = false;         // evita arrancar dos veces
let selResultado = -1;         // fila elegida con las flechas (-1 = ninguna)
let resultadosVisibles = [];   // ids que se están mostrando
let filaActiva = -1;           // fila elegida del carrito
let productosCatalogo = [];   // [{ id, codigo, nombre, precio, unidad }]
let buscablesCatalogo = [];   // nombre+código ya normalizados, para filtrar sin repetir el trabajo
let carrito = [];             // [{ id, codigo, nombre, precio, unidad, cantidad }]
let ultimaFactura = null;
let procesando = false;         // evita cobrar dos veces la misma venta
let ultimaVenta = "";          // firma de lo ya facturado
let clientes = [];              // directorio de clientes

const IVA = () => Number(CONFIG.impuestoDefecto) || 0;
const $ = id => document.getElementById(id);
const dinero = v => UI.dinero(v);

const BORRADOR = "pos-borrador";

/* =========================================================
   Borrador: la venta no se pierde al recargar el navegador
   ========================================================= */

function guardarBorrador() {
  try {
    localStorage.setItem(BORRADOR, JSON.stringify({
      carrito,
      descuento: $("discountInput").value,
      cliente: $("clientName").value,
      tema: document.documentElement.classList.contains("dark") ? "dark" : "light"
    }));
  } catch (e) { /* modo privado o cuota llena: el POS sigue igual */ }
}

function restaurarBorrador() {
  let guardado = null;
  try { guardado = JSON.parse(localStorage.getItem(BORRADOR) || "null"); } catch (e) { return; }
  if (!guardado || !Array.isArray(guardado.carrito)) return;

  carrito = guardado.carrito
    .filter(l => l && l.id && l.nombre)
    .map(l => ({
      id: String(l.id),
      codigo: String(l.codigo || l.id).toUpperCase(),
      nombre: String(l.nombre),
      unidad: l.unidad || "pieza",
      precio: Number(l.precio) || 0,
      cantidad: Math.max(1, parseInt(l.cantidad, 10) || 1)
    }));
  if (!carrito.length) return;

  $("discountInput").value = guardado.descuento || 0;
  if (guardado.cliente) $("clientName").value = guardado.cliente;
  renderizarTablaCarrito();
  calcularTotales();
  if (guardado.tema === "dark" && !document.documentElement.classList.contains("dark")) toggleDarkMode();
  mostrarToast("Venta en curso recuperada (" + carrito.length + " productos)");
}

/** Los precios del borrador se ajustan a los del catálogo vigente */
function sincronizarPrecios() {
  let cambio = false;
  const faltantes = [];

  for (const item of carrito) {
    const actual = productosCatalogo.find(p => p.id === item.id);
    if (!actual) { faltantes.push(item.nombre); continue; }
    if (actual.precio !== item.precio) { item.precio = actual.precio; cambio = true; }
    if (actual.nombre !== item.nombre) item.nombre = actual.nombre;
    if (actual.unidad !== item.unidad) item.unidad = actual.unidad;
  }

  if (cambio) { renderizarTablaCarrito(); calcularTotales(); }

  /* Un producto que ya no está en el catálogo no se borra solo:
     se avisa para que el cajero decida, en vez de cobrarlo sin que nadie lo note. */
  if (faltantes.length) {
    mostrarToast(
      faltantes.length === 1
        ? "Ya no está en el catálogo: " + faltantes[0]
        : faltantes.length + " productos ya no están en el catálogo",
      "warn"
    );
  }
  guardarBorrador();
}

/** Huella de la venta: si no cambia, ya se facturó */
function firmaVenta() {
  return JSON.stringify({
    items: carrito.map(i => [i.id, i.cantidad]),
    descuento: $("discountInput").value,
    cliente: $("clientName").value.trim(),
  });
}

/* =========================================================
   Catálogo
   ========================================================= */

async function cargarCatalogo() {
  try {
    const datos = await DB.leer(CONFIG.rutas.productos);
    productosCatalogo = DB.aLista(datos)
      .filter(p => p && p.nombre)
      .map(p => ({
        id: p.id,
        codigo: p.id.toUpperCase(),     // la clave de Firebase es el código: p001
        nombre: p.nombre,
        precio: Number(p.precio) || 0,
        unidad: p.unidad || "pieza"
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    prepararBusqueda();
    renderizarBuscadorResultados(productosCatalogo);
    sincronizarPrecios();
    estadoCatalogo(productosCatalogo.length);
  } catch (e) {
    console.error(e);
    if (estadoConexion !== "err") pintarLed("err", "catálogo no disponible");
    renderizarBuscadorResultados([]);
  }
}

/** Directorio de clientes: alimenta el autocompletado del campo Cliente */
async function cargarClientes() {
  try {
    const datos = await DB.leer(CONFIG.rutas.clientes);
    clientes = DB.aLista(datos)
      .filter(c => c && (c.nombre || c.razonSocial))
      .map(c => ({
        id: c.id,
        nombre: String(c.nombre || c.razonSocial).trim(),
        identificacion: c.identificacion || c.nit || "",
        telefono: c.telefono || ""
      }))
      .filter(c => c.nombre)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    if (clientes.length) {
      $("listaClientes").innerHTML = clientes
        .map(c => '<option value="' + UI.esc(c.nombre) + '">' + UI.esc(c.identificacion || "") + "</option>")
        .join("");
    }
  } catch (e) {
    clientes = [];                    // sin directorio el POS sigue vendiendo
  }
}

/* ---------- LED de la base en la cabecera ----------
   El LED es de la conexión, no del catálogo: antes ambos escribían en el
   mismo texto y el contador de productos tapaba el «sin conexión», que es
   justo lo que hay que ver cuando se está vendiendo. */
let estadoConexion = null;          /* "ok" | "err" */

function pintarLed(clase, texto) {
  const icono = $("dbLedIcon");
  const colores = { ok: "text-emerald-500", err: "text-red-500", warn: "text-amber-400" };
  icono.className = "fa-solid fa-circle text-[6px] " + (colores[clase] || "text-slate-300");
  $("dbLedTexto").textContent = texto;
}

function estadoBd(clase, texto) {
  estadoConexion = clase === "err" ? "err" : "ok";
  pintarLed(clase, texto);
}

/** El catálogo informa sin pisar el estado de conexión */
function estadoCatalogo(cantidad) {
  if (estadoConexion === "err") return;
  pintarLed("ok", cantidad + (cantidad === 1 ? " producto" : " productos"));
}

function vigilarBase() {
  try {
    DB.init();
    DB.raw().child(".info/connected").on("value", snap => {
      if (snap.val() === true) estadoBd("ok", "en línea");
      else estadoBd("err", "sin conexión");
    });
  } catch (e) {
    estadoBd("err", "sin conexión");
  }
}

/* =========================================================
   Buscador
   ========================================================= */

/* Normalizar 3.719 productos en cada tecla era lo que trababa el buscador,
   así que el texto buscable se calcula una vez al cargar el catálogo.
   Se incluye la unidad para que "pieza", "botella" o "paquete" encontre
   lo que se busca por cómo se vende y no solo por nombre o código. */
function prepararBusqueda() {
  buscablesCatalogo = productosCatalogo.map(p =>
    UI.normalizar(p.nombre + " " + p.codigo + " " + (p.unidad || "pieza")));
}

function filtrarProductos() {
  const query = UI.normalizar($("searchInput").value);   /* normalizar ya recorta */
  $("btnClearSearch").classList.toggle("hidden", !$("searchInput").value);

  if (!query) return renderizarBuscadorResultados(productosCatalogo);

  if (buscablesCatalogo.length !== productosCatalogo.length) prepararBusqueda();
  const filtrados = [];
  for (let i = 0; i < productosCatalogo.length; i++) {
    if (buscablesCatalogo[i].includes(query)) filtrados.push(productosCatalogo[i]);
  }
  renderizarBuscadorResultados(filtrados);
}

function limpiarBusqueda() {
  $("searchInput").value = "";
  $("btnClearSearch").classList.add("hidden");
  renderizarBuscadorResultados(productosCatalogo);
}

/** Enter: agrega lo que marcaron las flechas; si no marcaron nada,
    exige coincidencia 100 % exacta como antes. */
function handleSearchKeyDown(event) {
  if (event.key === "ArrowDown") { event.preventDefault(); moverSeleccion(1); return; }
  if (event.key === "ArrowUp")   { event.preventDefault(); moverSeleccion(-1); return; }
  if (event.key === "Escape")    { event.preventDefault(); limpiarBusqueda(); event.target.blur(); return; }
  if (event.key !== "Enter") return;

  event.preventDefault();

  if (selResultado >= 0) {
    const elegido = productosCatalogo.find(p => p.id === resultadosVisibles[selResultado]);
    if (elegido) { agregarAlCarrito(elegido); limpiarBusqueda(); }
    return;
  }

  const escrito = $("searchInput").value.trim();
  if (!escrito) return;

  const plano = UI.normalizar(escrito);
  const coincidencia = productosCatalogo.find(p =>
    UI.normalizar(p.codigo) === plano || UI.normalizar(p.nombre) === plano
  );

  if (coincidencia) {
    agregarAlCarrito(coincidencia);
    limpiarBusqueda();
  } else {
    mostrarToast("Sin coincidencia 100% exacta", "info");
  }
}

/* ---------- Moverse por los resultados con las flechas ---------- */
function moverSeleccion(delta) {
  if (!resultadosVisibles.length) return;
  selResultado = selResultado < 0
    ? (delta > 0 ? 0 : resultadosVisibles.length - 1)
    : (selResultado + delta + resultadosVisibles.length) % resultadosVisibles.length;

  /* el teclado no espera al siguiente lote: si pide una fila que aun no
     esta pintada, se terminan de pintar todas las que falten */
  if (selResultado >= $("searchResultsGrid").querySelectorAll("[data-agregar]").length) pintarPendientes();
  const nodos = $("searchResultsGrid").querySelectorAll("[data-agregar]");
  nodos.forEach((n, i) => n.classList.toggle("pos-sel", i === selResultado));
  if (selResultado >= 0 && nodos[selResultado]) nodos[selResultado].scrollIntoView({ block: "nearest" });
}

/* ---------- Moverse por el carrito con las flechas ---------- */
function moverFila(delta) {
  const total = carrito.length;
  if (!total) return;
  filaActiva = filaActiva < 0
    ? (delta > 0 ? 0 : total - 1)
    : Math.min(total - 1, Math.max(0, filaActiva + delta));
  marcarFila();
}

function marcarFila(enfocar = false) {
  const filas = $("cartTableBody").querySelectorAll("tr");
  filas.forEach((f, i) => f.classList.toggle("pos-fila", i === filaActiva));
  const activa = filas[filaActiva];
  if (activa) {
    activa.tabIndex = 0;
    if (enfocar) activa.focus();
  }
}

/* Un buscador como "a" puede dar 3.681 tarjetas. Pintarlas de una sola vez
   congelaba el navegador medio segundo, asi que entran por lotes: el scroll
   lo lleva el CSS y el usuario ya ve resultados mientras llega el resto. */
const TARJETA = p => `
    <button type="button" data-agregar="${UI.esc(p.id)}" title="${UI.esc(p.codigo + " \u00b7 " + p.nombre + " \u00b7 " + (p.unidad || "pieza") + " \u00b7 " + dinero(p.precio))}" class="w-full min-w-0 text-left bg-slate-50 hover:bg-slate-200/60 dark:bg-surface-950 dark:hover:bg-surface-800 border border-slate-200 dark:border-slate-800 px-2.5 py-2 sm:py-1.5 rounded text-xs transition-colors cursor-pointer flex items-center justify-between gap-2 sm:gap-3 group">
      <span class="flex items-center gap-2 min-w-0 flex-1">
        <span class="text-[10px] text-slate-400 font-mono flex-shrink-0">${UI.esc(p.codigo)}</span>
        <span class="font-medium text-slate-700 dark:text-slate-200 truncate group-hover:text-slate-900 dark:group-hover:text-white">${UI.esc(p.nombre)}</span>
        <span class="text-[10px] text-slate-400 bg-slate-200/70 dark:bg-slate-800 rounded px-1 flex-shrink-0 hidden md:inline">${UI.esc(p.unidad || "pieza")}</span>
      </span>
      <span class="font-mono font-semibold text-slate-900 dark:text-slate-100 flex-shrink-0">${UI.esc(dinero(p.precio))}</span>
    </button>`;

const TAMANO_LOTE = 300;
let loteEnCurso = 0;     // invalida los lotes de una busqueda anterior
let porPintar = null;    // productos que todavia no estan en el DOM

function pintarPendientes() {
  const grid = $("searchResultsGrid");
  if (!porPintar) return;
  const pintados = grid.querySelectorAll("[data-agregar]").length;
  const faltan = porPintar.slice(pintados);
  porPintar = null;
  if (faltan.length) grid.insertAdjacentHTML("beforeend", faltan.map(TARJETA).join(""));
}

function renderizarBuscadorResultados(productos) {
  const grid = $("searchResultsGrid");
  selResultado = -1;
  const cuenta = productos.length + " encontrados";
  $("resultsCount").textContent = cuenta;
  const movil = $("resultsCountMovil");
  if (movil) movil.textContent = cuenta;

  loteEnCurso++;
  const miLote = loteEnCurso;
  porPintar = null;

  if (!productos.length) {
    grid.innerHTML = '<span class="text-[11px] text-slate-400 py-1">No se encontraron productos</span>';
    return;
  }

  resultadosVisibles = productos.map(p => p.id);
  grid.innerHTML = "";
  porPintar = productos;

  const lote = pintados => {
    if (miLote !== loteEnCurso || !porPintar) return;   // el usuario siguio escribiendo
    const trozo = porPintar.slice(pintados, pintados + TAMANO_LOTE);
    if (!trozo.length) { porPintar = null; return; }
    grid.insertAdjacentHTML("beforeend", trozo.map(TARJETA).join(""));
    const siguiente = pintados + TAMANO_LOTE;
    if (siguiente < porPintar.length) setTimeout(() => lote(siguiente), 0);
    else porPintar = null;
  };
  lote(0);
}

/* =========================================================
   Carrito
   ========================================================= */

function agregarAlCarrito(producto) {
  const existe = carrito.find(item => item.id === producto.id);
  if (existe) existe.cantidad += 1;
  else carrito.push({ ...producto, cantidad: 1 });

  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
  mostrarToast("Agregado: " + producto.nombre);
}

function cambiarCantidad(id, cambio) {
  const item = carrito.find(i => i.id === id);
  if (!item) return;

  item.cantidad += cambio;
  if (item.cantidad <= 0) return eliminarDelCarrito(id);

  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
}

function actualizarCantidadManual(id, nuevaCantidad) {
  const item = carrito.find(i => i.id === id);
  if (!item) return;

  const val = parseInt(nuevaCantidad, 10);
  if (isNaN(val) || val <= 0) eliminarDelCarrito(id);
  else { item.cantidad = val; renderizarTablaCarrito(); calcularTotales(); guardarBorrador(); }
}

function eliminarDelCarrito(id) {
  carrito = carrito.filter(item => item.id !== id);
  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
}

function reiniciarFactura(silencioso = false) {
  carrito = [];
  $("discountInput").value = 0;
  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
  if (!silencioso) mostrarToast("Lista reiniciada");
}

function renderizarTablaCarrito() {
  const tbody = $("cartTableBody");
  const totalItems = carrito.reduce((acc, c) => acc + c.cantidad, 0);
  $("cartBadge").textContent = totalItems + " items";
  $("emptyCartMessage").classList.toggle("hidden", carrito.length > 0);

  tbody.innerHTML = carrito.map(item => `
    <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
      <td class="celda-codigo py-1.5 pl-1 pr-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">${UI.esc(item.codigo)}</td>
      <td class="celda-nombre py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-200 truncate max-w-0" title="${UI.esc(item.nombre)}">${UI.esc(item.nombre)}</td>
      <td class="py-1.5 text-center font-mono text-slate-600 dark:text-slate-400 hidden sm:table-cell">${UI.esc(dinero(item.precio))}</td>
      <td class="py-1.5 text-center whitespace-nowrap">
        <span class="inline-flex items-center border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-surface-950 rounded">
          <button type="button" data-accion="menos" data-id="${UI.esc(item.id)}" class="w-9 h-9 sm:w-7 sm:h-7 -ml-1 sm:ml-0 flex items-center justify-center text-slate-400 hover:text-slate-700 active:text-slate-900">
            <i class="fa-solid fa-minus text-[8px]"></i>
          </button>
          <input type="number" min="1" value="${item.cantidad}" data-cant="${UI.esc(item.id)}" inputmode="numeric"
                 class="w-9 sm:w-8 text-center bg-transparent text-[11px] font-mono font-medium text-slate-800 dark:text-slate-200 focus:outline-none">
          <button type="button" data-accion="mas" data-id="${UI.esc(item.id)}" class="w-9 h-9 sm:w-7 sm:h-7 -mr-1 sm:mr-0 flex items-center justify-center text-slate-400 hover:text-slate-700 active:text-slate-900">
            <i class="fa-solid fa-plus text-[8px]"></i>
          </button>
        </span>
      </td>
      <td class="py-1.5 text-right pr-1 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">${UI.esc(dinero(item.precio * item.cantidad))}</td>
      <td class="py-1.5 text-center">
        <button type="button" data-accion="quitar" data-id="${UI.esc(item.id)}" aria-label="Quitar ${UI.esc(item.nombre)}" class="px-1 sm:px-0 py-1 sm:py-0 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400">
          <i class="fa-regular fa-trash-can text-xs"></i>
        </button>
      </td>
    </tr>`).join("");

  if (!carrito.length) filaActiva = -1;
  else if (filaActiva >= carrito.length) filaActiva = carrito.length - 1;
  else if (filaActiva < 0) filaActiva = -1;
  marcarFila();
}

/* =========================================================
   Totales
   ========================================================= */

/** Números de la venta: un solo cálculo para pantalla, factura y borrador */
function calcularVenta() {
  const subtotal = carrito.reduce((suma, i) => suma + i.precio * i.cantidad, 0);
  const tasa = IVA();
  const impuesto = subtotal * (tasa / 100);

  const campo = $("discountInput");
  let descuento = parseFloat(campo.value) || 0;
  /* Un descuento mayor que la venta dejaría el total en negativo:
     se recorta al total y se avisa, en vez de cobrar de menos. */
  if (descuento > subtotal + impuesto) {
    descuento = subtotal + impuesto;
    campo.value = descuento;
  }

  const total = Math.max(0, subtotal + impuesto - descuento);
  return { subtotal, impuesto, tasa, descuento, total };
}

function calcularTotales() {
  const v = calcularVenta();
  guardarBorrador();

  $("summarySubtotal").textContent = dinero(v.subtotal);
  $("summaryTax").textContent = dinero(v.impuesto);
  /* El descuento solo aparece cuando hay: si no, ocupa espacio y confunde */
  $("filaDescuento").classList.toggle("hidden", v.descuento <= 0);
  $("summaryDiscount").textContent = "−" + dinero(v.descuento);
  $("discountPct").textContent = v.descuento > 0 && v.subtotal > 0
    ? "(" + Math.round((v.descuento / v.subtotal) * 100) + "%)"
    : "";

  /* Los dos sitios donde se ve el total (resumen y barra fija del móvil) */
  for (const id of ["summaryTotal", "totalMovil"]) {
    const nodo = $(id);
    if (nodo) nodo.textContent = dinero(v.total);
  }
}

/* =========================================================
   Facturación: cobrar es imprimir
   Un solo botón. Guardar la venta y mandar la factura a la
   impresora son el mismo gesto, así que no hay pantalla de
   confirmación en el medio: se cobra, se imprime y el POS
   queda listo para la siguiente venta.
   ========================================================= */

async function procesarPago() {
  if (procesando) return;                       // doble clic o doble Enter
  if (!carrito.length) return mostrarToast("Agregue productos antes de procesar", "info");

  /* Si el carrito es idéntico al ya facturado, es el mismo cobro:
     se avisa en vez de emitir una segunda factura con otro folio. */
  const firma = firmaVenta();
  if (firma === ultimaVenta) {
    return mostrarToast("Esta venta ya se facturó. Use «Nueva venta»", "warn");
  }

  procesando = true;
  botonProcesar(true);

  const { subtotal, impuesto, tasa, descuento, total } = calcularVenta();
  const cliente = $("clientName").value.trim() || "Consumidor Final";

  /* Sin folio no hay factura que imprimir: mejor no cobrar que
     sacar un papel sin número y dejar la venta a medias. */
  let folio = "";
  try {
    const r = await DB.facturas.siguienteFolio();
    folio = "FV-" + String(Number(r && r.snapshot ? r.snapshot.val() : 0) || 0).padStart(4, "0");
  } catch (e) {
    console.warn("No se pudo leer el contador de folio:", e.message);
  }
  if (!folio) {
    procesando = false;
    botonProcesar(false);
    return mostrarToast("Sin conexión con la base: no se pudo asignar folio", "err");
  }

  const factura = {
    folio,
    fecha: new Date().toISOString(),
    cliente,
    items: carrito.map(i => ({
      id: i.id, codigo: i.codigo, descripcion: i.nombre,
      unidad: i.unidad, cantidad: i.cantidad, precio: i.precio,
      base: i.precio * i.cantidad
    })),
    subtotal,
    impuesto,
    tasaImpuesto: tasa,
    descuento,
    total,
    estado: "pagada"
  };

  try {
    await DB.facturas.guardar(null, factura);   // id=null → genera la clave
  } catch (e) {
    console.error(e);
    procesando = false;
    botonProcesar(false);
    /* La venta sigue en pantalla: si se perdiera el papel
       el cajero todavía tiene los productos para volver a cobrar. */
    return mostrarToast("No se pudo guardar la factura. Revise la conexión", "err");
  }

  ultimaFactura = factura;
  ultimaVenta = firma;
  procesando = false;
  botonProcesar(false);
  imprimirFactura(factura);
}

/** El botón se apaga mientras se guarda: evita facturar dos veces */
function botonProcesar(ocupado) {
  for (const id of ["btnProcesar", "btnProcesarMovil"]) {
    const b = $(id);
    if (!b) continue;
    b.disabled = !!ocupado;
    b.classList.toggle("opacity-60", !!ocupado);
    b.classList.toggle("cursor-not-allowed", !!ocupado);
    b.textContent = ocupado ? "Guardando…" : "Cobrar e imprimir";
  }
}

/** Mantiene el foco dentro del modal mientras esté abierto */
function atraparFoco(event) {
  if (event.key !== "Tab") return;
  const modal = [...document.querySelectorAll('[role="dialog"]')].find(m => !m.classList.contains("hidden"));
  if (!modal) return;

  const focusables = modal.querySelectorAll("button:not([disabled]), [href], input, [tabindex]:not([tabindex='-1'])");
  if (!focusables.length) return;
  const primero = focusables[0];
  const ultimo = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === primero) { event.preventDefault(); ultimo.focus(); }
  else if (!event.shiftKey && document.activeElement === ultimo) { event.preventDefault(); primero.focus(); }
  else if (!modal.contains(document.activeElement)) { event.preventDefault(); primero.focus(); }
}

/** Arma el papel de la factura dentro del modal. */
function pintarFactura(f) {
  const contacto = [CONFIG.empresa.rfc, CONFIG.empresa.direccion].filter(Boolean).map(UI.esc).join(" · ");
  const contacto2 = [CONFIG.empresa.telefono, CONFIG.empresa.correo].filter(Boolean).map(UI.esc).join(" · ");
  const fecha = UI.fechaHora(f.fecha);

  const filas = f.items.map(i =>
    '<tr class="border-b border-slate-200">' +
      '<td class="px-2 py-1 font-mono text-[11px]">' + UI.esc(i.codigo) + "</td>" +
      '<td class="px-2 py-1">' + UI.esc(i.descripcion) + "</td>" +
      '<td class="px-2 py-1 text-slate-600 hidden sm:table-cell print:table-cell">' + UI.esc(i.unidad || "pieza") + "</td>" +
      '<td class="px-2 py-1 text-right">' + i.cantidad + "</td>" +
      '<td class="px-2 py-1 text-right font-mono">' + UI.esc(dinero(i.precio)) + "</td>" +
      '<td class="px-2 py-1 text-right font-mono">' + UI.esc(dinero(i.precio * i.cantidad)) + "</td>" +
    "</tr>").join("");

  $("previewPapel").innerHTML =
    '<div class="flex items-start justify-between gap-4 pb-3 border-b-2 border-slate-900">' +
      '<div class="flex items-start gap-3">' +
        (CONFIG.empresa.logo ? '<img src="' + UI.esc(CONFIG.empresa.logo) + '" alt="" class="w-12 h-12 object-contain">' : "") +
        "<div>" +
          '<h4 class="font-bold text-sm leading-tight">' + UI.esc(CONFIG.empresa.nombre) + "</h4>" +
          (contacto ? '<p class="text-[11px] text-slate-600">' + contacto + "</p>" : "") +
          (contacto2 ? '<p class="text-[11px] text-slate-600">' + contacto2 + "</p>" : "") +
        "</div>" +
      "</div>" +
      '<div class="text-right shrink-0">' +
        '<p class="text-[10px] uppercase tracking-wider text-slate-500">Factura de venta</p>' +
        '<p class="text-sm font-bold font-mono">' + UI.esc(f.folio) + "</p>" +
        '<p class="text-[11px] text-slate-600">' + fecha + "</p>" +
        '<p class="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">' +
          (f.estado === "pagada" ? "Pagada" : UI.esc(f.estado || "")) +
        "</p>" +
      "</div>" +
    "</div>" +
    '<div class="mt-3 pb-2 border-b border-slate-200">' +
      '<span class="text-[10px] uppercase tracking-wider text-slate-500">Cliente</span>' +
      '<p class="font-medium">' + UI.esc(f.cliente) + "</p>" +
    "</div>" +
    '<table class="w-full border-collapse mt-3">' +
      '<thead><tr class="bg-slate-100 text-[10px] uppercase tracking-wider text-slate-600">' +
        '<th class="px-2 py-1 text-left border border-slate-300">Código</th>' +
        '<th class="px-2 py-1 text-left border border-slate-300">Producto</th>' +
        '<th class="px-2 py-1 text-left border border-slate-300 hidden sm:table-cell print:table-cell">Unidad</th>' +
        '<th class="px-2 py-1 text-right border border-slate-300">Cant.</th>' +
        '<th class="px-2 py-1 text-right border border-slate-300">Precio</th>' +
        '<th class="px-2 py-1 text-right border border-slate-300">Subtotal</th>' +
      "</tr></thead>" +
      "<tbody>" + filas + "</tbody>" +
    "</table>" +
    '<div class="mt-3 ml-auto w-full sm:w-64 text-[12px]">' +
      '<div class="flex justify-between py-0.5"><span class="text-slate-600">Subtotal</span><span class="font-mono">' + UI.esc(dinero(f.subtotal)) + "</span></div>" +
      '<div class="flex justify-between py-0.5"><span class="text-slate-600">IVA (' + f.tasaImpuesto + "%)</span><span class=\"font-mono\">" + UI.esc(dinero(f.impuesto)) + "</span></div>" +
      (f.descuento ? '<div class="flex justify-between py-0.5"><span class="text-slate-600">Descuento</span><span class="font-mono">-' + UI.esc(dinero(f.descuento)) + "</span></div>" : "") +
      '<div class="flex justify-between items-baseline mt-1 pt-1.5 border-t-2 border-slate-900">' +
        '<span class="font-bold">TOTAL</span><span class="text-base font-bold font-mono">' + UI.esc(dinero(f.total)) + "</span>" +
      "</div>" +
    "</div>" +
    '<p class="mt-6 text-center text-[11px] text-slate-500">Gracias por su compra</p>';

  $("previewTitulo").textContent = "Factura " + f.folio;
}

/** Muestra la factura y manda a imprimir sin pedir nada más. */
function imprimirFactura(f) {
  pintarFactura(f);
  const modal = $("previewModal");
  modal.classList.remove("hidden");
  modal.scrollTop = 0;
  /* setTimeout y no requestAnimationFrame: si la ventana del POS está
     en segundo plano, rAF no se dispara y la venta se quedaría colgada
     con la factura abierta sin llegar a imprimirse. */
  setTimeout(() => window.print(), 50);
}

/** Al terminar de imprimir, la venta queda cerrada y el POS listo. */
function terminarVenta() {
  cerrarFactura();
  reiniciarFactura(true);
  ultimaVenta = "";                        // la próxima venta ya es otra
  $("clientName").value = "Consumidor Final";
  guardarBorrador();
  $("searchInput").focus();
  $("searchInput").select();
  mostrarToast("Factura " + ultimaFactura.folio + " impresa");
}

function cerrarFactura() {
  const modal = $("previewModal");
  if (modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  $("previewPapel").innerHTML = "";
  $("previewTitulo").textContent = "Factura";
}

/* =========================================================
   Notificaciones y tema
   ========================================================= */

function toggleDarkMode() {
  const oscuro = document.documentElement.classList.toggle("dark");
  document.documentElement.classList.toggle("light", !oscuro);
  $("themeIcon").className = "fa-solid " + (oscuro ? "fa-sun" : "fa-moon") + " text-xs";
  try { localStorage.setItem("pos-tema", oscuro ? "dark" : "light"); } catch (e) { /* noop */ }
}

/* =========================================================
   Arranque
   ========================================================= */

window.onload = function () {
  if (iniciado) return;
  iniciado = true;

  try {
    const guardado = localStorage.getItem("pos-tema");
    if (guardado === "dark" && !document.documentElement.classList.contains("dark")) toggleDarkMode();
  } catch (e) { /* noop */ }

  Ajustes.iniciar();             // logo, datos de factura e IVA (aplicados al vuelo)
  $("taxRate").textContent = IVA();
  vigilarBase();
  restaurarBorrador();          // antes de dibujar: pintar el carrito vacío
  renderizarTablaCarrito();     // pisaría el borrador recién leído
  calcularTotales();
  cargarClientes();
  cargarCatalogo();

  /* Un solo manejador para los clics de resultados y carrito */
  /* Eventos con addEventListener, no con atributos on* en el HTML */
  $("searchInput").addEventListener("input", filtrarProductos);
  $("searchInput").addEventListener("keydown", handleSearchKeyDown);
  $("btnClearSearch").addEventListener("click", limpiarBusqueda);
  $("discountInput").addEventListener("input", calcularTotales);
  $("clientName").addEventListener("input", guardarBorrador);
  $("btnTema").addEventListener("click", toggleDarkMode);
  $("btnLimpiar").addEventListener("click", async () => {
    if (carrito.length) {
      const ok = await UI.confirmar({
        titulo: "Vaciar la lista",
        mensaje: "Se quitan " + carrito.length + " producto(s) de la venta en curso.",
        detalle: "La venta todavía no se ha facturado: si la quieres guardar, cobra primero.",
        ok: "Vaciar",
        cancelar: "Seguir cobrando",
        peligro: true
      });
      if (!ok) return;
    }
    reiniciarFactura();
  });
  $("btnProcesar").addEventListener("click", () => procesarPago());
  $("btnProcesarMovil").addEventListener("click", () => procesarPago());

  /* La factura se imprime sola al cobrar; cuando el diálogo se cierra
     la venta termina y el POS queda apuntando al buscador. */
  window.addEventListener("afterprint", () => {
    if (!$("previewModal").classList.contains("hidden")) terminarVenta();
  });

  $("searchResultsGrid").addEventListener("click", e => {
    const boton = e.target.closest("[data-agregar]");
    if (!boton) return;
    const producto = productosCatalogo.find(p => p.id === boton.dataset.agregar);
    if (producto) agregarAlCarrito(producto);
  });

  $("cartTableBody").addEventListener("click", e => {
    const boton = e.target.closest("[data-accion]");
    if (!boton) return;
    const { accion, id } = boton.dataset;
    if (accion === "mas") cambiarCantidad(id, 1);
    else if (accion === "menos") cambiarCantidad(id, -1);
    else eliminarDelCarrito(id);
  });

  $("cartTableBody").addEventListener("change", e => {
    const campo = e.target.closest("[data-cant]");
    if (campo) actualizarCantidadManual(campo.dataset.cant, campo.value);
  });

  /* Flechas dentro del carrito: arriba/abajo mueven de fila,
     izquierda/derecha cambian la cantidad, Supr borra, Enter vuelve al buscador. */
  $("cartTableBody").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); moverFila(1); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); moverFila(-1); return; }
    if (e.key === "Enter")     { e.preventDefault(); $("searchInput").focus(); $("searchInput").select(); return; }
    if (filaActiva < 0 || !carrito[filaActiva]) return;

    const item = carrito[filaActiva];
    if (e.key === "ArrowRight")      { e.preventDefault(); cambiarCantidad(item.id, 1); }
    else if (e.key === "ArrowLeft")  { e.preventDefault(); cambiarCantidad(item.id, -1); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); eliminarDelCarrito(item.id); }
  });

  /* Al recibir el foco, la primera fila queda lista para moverse */
  $("cartTableBody").addEventListener("focusin", () => {
    if (filaActiva < 0 && carrito.length) { filaActiva = 0; marcarFila(); }
  });

  /* Factura abierta: imprimir otra vez o dar la venta por terminada */
  $("btnPreviewImprimir").addEventListener("click", () => window.print());
  $("btnPreviewCerrar").addEventListener("click", terminarVenta);
  $("previewModal").addEventListener("click", e => {
    if (e.target === $("previewModal")) terminarVenta();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("previewModal").classList.contains("hidden")) return terminarVenta();
    if (e.key === "F2") { e.preventDefault(); $("searchInput").focus(); $("searchInput").select(); return; }
    if (e.key === "F4") { e.preventDefault(); procesarPago(); return; }
    if (e.key === "F3") {
      e.preventDefault();
      $("cartTableBody").focus();
      filaActiva = e.shiftKey ? carrito.length - 1 : 0;
      marcarFila();
      return;
    }

    atraparFoco(e);

    const fueraDelTeclado = !e.target.closest("#searchInput, #cartTableBody, input, select, textarea");

    /* ↑ ↓ también funcionan con el carrito enfocado sin tocar el input.
       El carrito ya se mueve en su propio keydown: aquí solo el resto de la página. */
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && fueraDelTeclado) {
      if (!carrito.length) return;
      e.preventDefault();
      moverFila(e.key === "ArrowDown" ? 1 : -1);
      return;
    }

    /* ← → ajustan la fila marcada aunque el foco esté en otro lado */
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && fueraDelTeclado) {
      if (filaActiva < 0 || !carrito[filaActiva]) return;
      e.preventDefault();
      cambiarCantidad(carrito[filaActiva].id, e.key === "ArrowRight" ? 1 : -1);
    }
  });
};
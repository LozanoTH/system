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
let carrito = [];             // [{ id, codigo, nombre, precio, unidad, cantidad, editadoLocal }]
window.facturaEnEdicion = window.facturaEnEdicion || null;
let ultimaFactura = null;
let procesando = false;         // evita cobrar dos veces la misma venta
let ultimaVenta = "";          // firma de lo ya facturado
window.viendoFacturaBusqueda = window.viendoFacturaBusqueda || false;
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
      recibido: $("recibidoInput") ? $("recibidoInput").value : "",
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
      cantidad: Math.max(1, parseInt(l.cantidad, 10) || 1),
      editadoLocal: !!l.editadoLocal
    }));
  if (!carrito.length) return;

  $("discountInput").value = guardado.descuento || 0;
  if ($("recibidoInput")) $("recibidoInput").value = guardado.recibido || "";
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
    /* El precio y la unidad pueden haberse editado solo para esta venta:
       se conservan y no se fijan de nuevo al precio del catálogo. */
    if (!item.editadoLocal) {
      if (actual.precio !== item.precio) { item.precio = actual.precio; cambio = true; }
      if (actual.unidad !== item.unidad) item.unidad = actual.unidad;
    }
    if (actual.nombre !== item.nombre) item.nombre = actual.nombre;
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

/** Identificación del cliente para la factura: se busca por nombre en el
    directorio; si es un cliente ocasional se deja vacío. */
function identificacionCliente(nombre) {
  if (!nombre || UI.normalizar(nombre) === UI.normalizar("Consumidor Final")) return "";
  const c = clientes.find(x => UI.normalizar(x.nombre) === UI.normalizar(nombre));
  return c ? (c.identificacion || "") : "";
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
    <button type="button" data-agregar="${UI.esc(p.id)}" title="${UI.esc(p.codigo + " \u00b7 " + p.nombre + " \u00b7 " + (p.unidad || "pieza") + " \u00b7 " + dinero(p.precio))}" class="w-full min-w-0 text-left bg-slate-50 hover:bg-slate-200/60 dark:bg-surface-950 dark:hover:bg-surface-800 border border-slate-200 dark:border-white/10 px-2.5 py-2 sm:py-1.5 rounded text-xs transition-colors cursor-pointer flex items-center justify-between gap-2 sm:gap-3 group">
      <span class="flex items-center gap-2 min-w-0 flex-1">
        <span class="text-[10px] text-slate-400 font-mono flex-shrink-0">${UI.esc(p.codigo)}</span>
        <span class="font-medium text-slate-700 dark:text-slate-200 truncate group-hover:text-slate-900 dark:group-hover:text-white">${UI.esc(p.nombre)}</span>
        <span class="text-[10px] text-slate-400 bg-slate-200/70 dark:bg-white/10 rounded px-1 flex-shrink-0 hidden md:inline">${UI.esc(p.unidad || "pieza")}</span>
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

/** Precio escrito en el carrito: solo existe para esta venta en curso y
    nunca se guarda en el catálogo, así que no llega a Firebase. */
function aplicarPrecioLocal(id, texto) {
  const item = carrito.find(i => i.id === id);
  if (!item) return;

  const limpio = String(texto || "").replace(/[^\d]/g, "");
  const valor = parseInt(limpio, 10);
  /* Sin dígitos no hay nada que aplicar: el campo quedó vacío. */
  if (!limpio || isNaN(valor) || valor === item.precio) return;

  item.precio = valor;
  item.editadoLocal = true;      /* sincronizarPrecios no lo sobreescribirá */
  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
}

/** El precio se formatea al salir del campo, cuando el cajero ya terminó. */
function formatearPrecioAlSalir(campo) {
  const limpio = String(campo.value || "").replace(/[^\d]/g, "");
  /* Si se borró todo, el campo vuelve al precio que ya tiene el carrito. */
  if (!limpio) {
    const item = carrito.find(i => i.id === campo.dataset.pri);
    campo.value = item ? precioVisible(item) : "";
    return;
  }
  campo.value = Number(limpio).toLocaleString("es-CO", { maximumFractionDigits: 0 });
  aplicarPrecioLocal(campo.dataset.pri, campo.value);
}

/** Pone los puntos de miles mientras se escribe y deja el cursor donde iba:
    se cuentan los dígitos que había antes del cursor y se vuelve a colocar
    tras esos mismos dígitos en el texto ya formateado. */
function formatearMilesEnCampo(campo) {
  const antes = String(campo.value.slice(0, campo.selectionStart || 0)).replace(/[^\d]/g, "").length;
  const limpio = String(campo.value || "").replace(/[^\d]/g, "");
  if (!limpio) { campo.value = ""; return; }

  campo.value = Number(limpio).toLocaleString("es-CO", { maximumFractionDigits: 0 });

  let vistas = 0, posicion = campo.value.length;
  for (let i = 0; i < campo.value.length; i++) {
    if (/\d/.test(campo.value[i])) vistas++;
    if (vistas === antes) { posicion = i + 1; break; }
  }
  campo.setSelectionRange(posicion, posicion);
}

function eliminarDelCarrito(id) {
  carrito = carrito.filter(item => item.id !== id);
  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
}

function reiniciarFactura(silencioso = false) {
  window.facturaEnEdicion = null;
  carrito = [];
  $("discountInput").value = 0;
  if ($("recibidoInput")) $("recibidoInput").value = "";
  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
  actualizarBotonAccion();
  if (!silencioso) mostrarToast("Lista reiniciada");
}

/** El precio del carrito se escribe sin símbolo: se formatea al salir. */
function precioVisible(item) {
  return Number(item.precio || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

function renderizarTablaCarrito() {
  const tbody = $("cartTableBody");
  const totalItems = carrito.reduce((acc, c) => acc + c.cantidad, 0);
  $("cartBadge").textContent = totalItems + " items";
  $("emptyCartMessage").classList.toggle("hidden", carrito.length > 0);

  tbody.innerHTML = carrito.map(item => `
    <tr class="hover:bg-slate-50 dark:hover:bg-white/5/40 transition-colors">
      <td class="celda-codigo py-1.5 pl-1 pr-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">${UI.esc(item.codigo)}</td>
      <td class="celda-nombre py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-200 truncate max-w-0" title="${UI.esc(item.nombre)}">${UI.esc(item.nombre)}</td>
      <td class="py-1.5 text-center font-mono text-slate-600 dark:text-neutral-400 hidden sm:table-cell">
        <input type="text" inputmode="numeric" autocomplete="off" spellcheck="false"
               aria-label="Precio de ${UI.esc(item.nombre)}"
               title="Precio solo de esta venta: no cambia el catálogo"
               value="${precioVisible(item)}" data-pri="${UI.esc(item.id)}"
               class="w-full max-w-[7rem] bg-transparent text-right text-[11px] font-mono font-medium text-slate-800 dark:text-slate-200 focus:outline-none"></td>
      <td class="py-1.5 text-center whitespace-nowrap">
        <span class="inline-flex items-center border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-surface-950 rounded">
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

  /* Impuestos adicionales (impoconsumo, I.C.O., I.N.C.): en 0 no cambian nada.
     Se calculan sobre el valor bruto, como el IVA. */
  const oi = CONFIG.otrosImpuestos || {};
  const detalleOtros = {
    impoconsumo: subtotal * ((Number(oi.impoconsumo) || 0) / 100),
    ico: subtotal * ((Number(oi.ico) || 0) / 100),
    inc: subtotal * ((Number(oi.inc) || 0) / 100)
  };
  const otros = detalleOtros.impoconsumo + detalleOtros.ico + detalleOtros.inc;

  const campo = $("discountInput");
  let descuento = Number(String(campo.value || "0").replace(/[^\d]/g, "")) || 0;
  /* Un descuento mayor que la venta dejaría el total en negativo:
     se recorta al total y se avisa, en vez de cobrar de menos. */
  if (descuento > subtotal + impuesto + otros) {
    descuento = subtotal + impuesto + otros;
    campo.value = Number(descuento).toLocaleString("es-CO", { maximumFractionDigits: 0 });
  }

  const total = Math.max(0, subtotal + impuesto + otros - descuento);

  /* Efectivo recibido y cambio: si el cajero no anota nada se asume
     pago exacto (recibe = total, cambio = 0), como en un cobro justo. */
  const campoRecibido = $("recibidoInput");
  const tecleado = campoRecibido
    ? Number(String(campoRecibido.value || "").replace(/[^\d]/g, "")) || 0
    : 0;
  const recibido = tecleado > 0 ? tecleado : total;
  const cambio = Math.max(0, recibido - total);

  return { subtotal, impuesto, tasa, otros, detalleOtros, descuento, total, recibido, cambio };
}

function formatearDescuentoAlTeclear() {
  const campo = $("discountInput");
  if (!campo) return;
  const limpio = String(campo.value || "").replace(/[^\d]/g, "");
  if (!limpio) { campo.value = ""; return; }
  campo.value = Number(limpio).toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

function calcularTotales() {
  const v = calcularVenta();
  guardarBorrador();

  $("summarySubtotal").textContent = dinero(v.subtotal);
  $("summaryTax").textContent = dinero(v.impuesto);
  /* Los impuestos adicionales solo aparecen cuando hay: si no, sobran */
  if ($("filaOtros")) {
    $("filaOtros").classList.toggle("hidden", v.otros <= 0);
    $("summaryOtros").textContent = dinero(v.otros);
  }
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

  /* El cambio solo aparece cuando el efectivo recibido supera el total */
  if ($("filaCambio")) {
    $("filaCambio").classList.toggle("hidden", v.cambio <= 0);
    $("summaryCambio").textContent = dinero(v.cambio);
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
  if (window.facturaEnEdicion) { guardarCambiosFactura(); return; }
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

  const oi = CONFIG.otrosImpuestos || {};
  const impoconsumo = Number(oi.impoconsumo) || 0;
  const ico = Number(oi.ico) || 0;
  const inc = Number(oi.inc) || 0;

  const { subtotal, impuesto, tasa, otros, descuento, total, recibido, cambio } = calcularVenta();
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
    clienteIdentificacion: identificacionCliente(cliente),
    items: carrito.map(i => ({
      id: i.id, codigo: i.codigo, descripcion: i.nombre,
      unidad: i.unidad, cantidad: i.cantidad, precio: i.precio,
      base: i.precio * i.cantidad
    })),
    subtotal,
    impuesto,
    tasaImpuesto: tasa,
    impoconsumo,
    ico,
    inc,
    totalOtros: otros,
    descuento,
    total,
    recibido,
    cambio,
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

/** Arma el papel de la factura dentro del modal.
    Sigue el formato de example.txt: encabezado, datos del punto de venta,
    artículos, detalle de valores, información tributaria, formas de pago
    y, si está configurado, el pie de autorización DIAN. */
function pintarFactura(f) {
  const fecha = new Date(f.fecha);
  const MESES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const p2 = n => String(n).padStart(2, "0");
  const fechaTxt = p2(fecha.getDate()) + "-" + MESES[fecha.getMonth()] + "-" + fecha.getFullYear();
  const horaTxt = p2(fecha.getHours()) + ":" + p2(fecha.getMinutes()) + ":" + p2(fecha.getSeconds());

  const linea = "----------------------------------------";
  const doble = "========================================";

  const emp = CONFIG.empresa || {};
  const doc = CONFIG.documento || {};
  const dian = CONFIG.dian || {};
  const pie = CONFIG.pie || {};

  const bruto = Number(f.subtotal) || 0;
  const descuento = Number(f.descuento) || 0;
  const impuesto = Number(f.impuesto) || 0;
  const subTotal = bruto - descuento;
  const total = Number(f.total) || 0;
  const tasa = Number(f.tasaImpuesto) || 0;

  /* Recibe y cambio: si la factura no los guardó, se asume pago exacto */
  const recibido = f.recibido !== undefined ? Number(f.recibido) || 0 : total;
  const cambio = f.cambio !== undefined ? Number(f.cambio) || 0 : Math.max(0, recibido - total);

  /* Impuestos adicionales: los que quedaron guardados con la factura */
  const mImpo = bruto * (Number(f.impoconsumo) || 0) / 100;
  const mIco = bruto * (Number(f.ico) || 0) / 100;
  const mInc = bruto * (Number(f.inc) || 0) / 100;

  const p = (txt, clase) => '<p class="text-[10px] font-mono leading-tight' + (clase ? " " + clase : "") + '">' + txt + "</p>";
  /* fila de dinero: etiqueta a la izquierda, valor a la derecha */
  const filaDinero = (etiqueta, valor, negrita) =>
    p(UI.esc(etiqueta.padEnd(17)) + UI.esc(dinero(valor).padStart(11)), negrita ? "font-bold" : "");

  /* La unidad y el valor de la línea viajan con cada artículo */
  const filas = f.items.map(i => {
    const cant = Number(i.cantidad).toFixed(4).padEnd(8);
    const iva = "/".padEnd(4);
    const desc = UI.esc(String(i.descripcion || "")).slice(0, 23).padEnd(23);
    const valor = UI.esc(dinero((Number(i.precio) || 0) * (Number(i.cantidad) || 0))).padStart(11);
    return p(cant + iva + desc + valor, "mt-0.5");
  }).join("");

  /* Cliente e identificación: se resuelve por el directorio de clientes */
  const esOcasional = !f.cliente || UI.normalizar(f.cliente) === UI.normalizar("Consumidor Final");
  const clienteNombre = esOcasional ? "OCASIONAL" : f.cliente;
  const ident = f.clienteIdentificacion !== undefined ? String(f.clienteIdentificacion || "") : identificacionCliente(f.cliente);
  const identTxt = ident || (esOcasional ? "1" : "");

  /* ---- encabezado (centrado) ---- */
  let cabecera = '<div class="text-center">';
  if (emp.logo) cabecera += '<img src="' + UI.esc(emp.logo) + '" alt="" class="mx-auto w-28 h-28 max-w-full object-contain">';
  cabecera += p("Bienvenido a");
  if (emp.sucursal) cabecera += p(UI.esc(emp.sucursal), "text-[11px] font-bold");
  if (emp.nombre) cabecera += p(UI.esc(emp.nombre), "text-[11px] font-bold");
  if (emp.rfc) cabecera += p("NIT: " + UI.esc(emp.rfc));
  if (emp.direccion) cabecera += p(UI.esc(emp.direccion));
  if (emp.telefono) cabecera += p("Telefono: " + UI.esc(emp.telefono));
  if (emp.correo) cabecera += p(UI.esc(emp.correo), "text-[9px]");
  cabecera += p(doble);
  if (emp.ciudad) cabecera += p(UI.esc(emp.ciudad));
  if (emp.regimen) cabecera += p(UI.esc(emp.regimen));
  if (doc.titulo) cabecera += p(UI.esc(doc.titulo));
  if (doc.pos) cabecera += p("POS " + UI.esc(doc.pos));
  cabecera += p(doble);
  cabecera += p("Fecha: " + fechaTxt + " Hora: " + horaTxt);
  if (doc.cajero) cabecera += p("Vendedor: " + UI.esc(doc.cajero));
  cabecera += p("Cliente: " + UI.esc(clienteNombre));
  if (identTxt) cabecera += p("Identificacion: " + UI.esc(identTxt));
  cabecera += p(doble);
  cabecera += "</div>";

  /* ---- cuerpo (izquierda) ---- */
  let cuerpo = "";
  cuerpo += p("CANT.   I.V.A.  DESCRIPCION".padEnd(35) + "VALOR".padStart(11));
  cuerpo += p(linea);
  cuerpo += filas;
  cuerpo += p(linea);

  cuerpo += p("Detalle de Valores");
  cuerpo += filaDinero("Valor Bruto:", bruto);
  cuerpo += filaDinero("Valor Descuento:", descuento);
  cuerpo += filaDinero("Sub Total:", subTotal);
  cuerpo += filaDinero("I.V.A. (" + tasa + "%):", impuesto);
  cuerpo += filaDinero("Impoconsumo:", mImpo);
  cuerpo += filaDinero("I.C.O.:", mIco);
  cuerpo += filaDinero("I.N.C.:", mInc);
  cuerpo += p(doble);
  cuerpo += filaDinero("TOTAL A PAGAR:", total, true);
  cuerpo += p(doble);

  cuerpo += p("Informacion Tributaria");
  cuerpo += p("%".padEnd(11) + "Vr. Base".padStart(12) + "Impuesto".padStart(11));
  cuerpo += p((tasa > 0 ? tasa + "%" : "EXENTO").padEnd(11) + UI.esc(dinero(bruto)).padStart(12) + UI.esc(dinero(impuesto)).padStart(11));
  cuerpo += p(linea);

  cuerpo += filaDinero("RECIBE:", recibido);
  cuerpo += filaDinero("CAMBIO:", cambio);
  cuerpo += p(linea);

  cuerpo += p("Detalle de las Formas de Pago");
  cuerpo += p("--- EFECTIVO: " + UI.esc(dinero(total)));
  cuerpo += p(linea);

  /* Pie DIAN: solo se imprime si hay autorización configurada */
  if (dian.autorizacion) {
    cuerpo += p("FACTURACION P.O.S AUTORIZACION DIAN");
    cuerpo += p("Nro. " + UI.esc(dian.autorizacion) + (dian.fecha ? " Fecha " + UI.esc(dian.fecha) : "") + " Fact. Impresa el " + fechaTxt + " " + horaTxt);
    const rango = (dian.desde || dian.hasta) ? ("Autoriza POS " + UI.esc(dian.desde || "1") + " - POS " + UI.esc(dian.hasta || "0")) : "";
    const pref = dian.prefijo || doc.prefijo || "POS";
    const vig = (dian.vigenciaMeses || dian.vigenciaHasta)
      ? "Vigencia" + (dian.vigenciaMeses ? " de " + UI.esc(dian.vigenciaMeses) + " meses" : "") + (dian.vigenciaHasta ? " a " + UI.esc(dian.vigenciaHasta) : "")
      : "";
    cuerpo += p((rango + (rango ? " " : "") + "Prefijo: " + UI.esc(pref) + (vig ? " " + vig : "")).trim());
  }

  if (pie.mensaje) cuerpo += p(UI.esc(pie.mensaje));
  if (pie.software) cuerpo += p("Software: " + UI.esc(pie.software), "text-[9px]");
  cuerpo += p(doble);

  $("previewPapel").innerHTML =
    '<div class="recibo mx-auto w-full max-w-[72mm] bg-white text-slate-900 text-[11px] leading-none px-1 py-2 shadow-sm print:shadow-none print:px-0 print:py-0">' +
      '<div class="font-mono">' + cabecera + cuerpo + '</div>' +
    '</div>';

  $("previewTitulo").textContent = "Factura " + f.folio;
}

/** Carga una factura guardada en la venta en curso para editarla
    sumando o quitando productos desde la pantalla principal. */
function cargarFacturaEnVenta(factura) {
  if (!factura) return;
  // Si ya se está editando otra factura, se pierde el contexto anterior.
  carrito = (factura.items || []).map(i => ({
    id: i.id,
    codigo: i.codigo,
    nombre: i.descripcion || i.nombre || "",
    unidad: i.unidad || "pieza",
    cantidad: Number(i.cantidad) || 1,
    precio: Number(i.precio) || 0
  }));
  window.facturaEnEdicion = factura;
  $("clientName").value = factura.cliente || "Consumidor Final";
  if ($("discountInput")) $("discountInput").value = factura.descuento || 0;
  if ($("recibidoInput")) {
    /* Solo se muestra lo recibido si fue distinto del total (si no, es pago exacto) */
    const recibido = Number(factura.recibido) || 0;
    $("recibidoInput").value = recibido > 0 && recibido !== Number(factura.total)
      ? recibido.toLocaleString("es-CO", { maximumFractionDigits: 0 })
      : "";
  }

  filaActiva = carrito.length ? 0 : -1;
  renderizarTablaCarrito();
  calcularTotales();
  guardarBorrador();
  actualizarBotonAccion();
  mostrarToast("Editando " + (factura.folio || "factura") + ": agrega o quita productos y guarda");
  $("searchInput").focus();
  $("searchInput").select();
}

/** Guarda los cambios de una factura editada en pantalla (misma folio). */
async function guardarCambiosFactura() {
  if (!window.facturaEnEdicion || procesando) return;
  if (!carrito.length) return mostrarToast("Agregue productos antes de guardar", "info");

  procesando = true;
  for (const id of ["btnProcesar", "btnProcesarMovil"]) {
    const b = $(id);
    if (!b) continue;
    b.disabled = true;
    b.classList.add("opacity-60", "cursor-not-allowed");
    b.textContent = "Guardando…";
  }

  const oi = CONFIG.otrosImpuestos || {};
  const impoconsumo = Number(oi.impoconsumo) || 0;
  const ico = Number(oi.ico) || 0;
  const inc = Number(oi.inc) || 0;

  const { subtotal, impuesto, tasa, otros, descuento, total, recibido, cambio } = calcularVenta();
  const factura = window.facturaEnEdicion;
  const cliente = $("clientName").value.trim() || "Consumidor Final";
  const items = carrito.map(i => ({
    id: i.id, codigo: i.codigo, descripcion: i.nombre,
    unidad: i.unidad, cantidad: i.cantidad, precio: i.precio,
    base: i.precio * i.cantidad
  }));

  const editada = {
    ...factura,
    cliente,
    clienteIdentificacion: identificacionCliente(cliente),
    items,
    subtotal,
    impuesto,
    tasaImpuesto: tasa,
    impoconsumo,
    ico,
    inc,
    totalOtros: otros,
    descuento,
    total,
    recibido,
    cambio,
    estado: factura.estado || "pagada",
    actualizado: new Date().toISOString()
  };

  try {
    await DB.actualizar(CONFIG.rutas.facturas, factura.id, {
      cliente: editada.cliente,
      clienteIdentificacion: editada.clienteIdentificacion,
      items: editada.items,
      subtotal: editada.subtotal,
      impuesto: editada.impuesto,
      tasaImpuesto: editada.tasaImpuesto,
      impoconsumo: editada.impoconsumo,
      ico: editada.ico,
      inc: editada.inc,
      totalOtros: editada.totalOtros,
      descuento: editada.descuento,
      total: editada.total,
      recibido: editada.recibido,
      cambio: editada.cambio,
      estado: editada.estado,
      actualizado: editada.actualizado
    });
    window.facturaEnEdicion = null;
    actualizarBotonAccion();
    ultimaFactura = editada;
    // vuelve a imprimir la factura actualizada y, al terminar, reinicia la venta
    imprimirFactura(editada);
  } catch (e) {
    console.error(e);
    mostrarToast("No se pudo guardar la factura. Revise la conexión", "err");
  } finally {
    procesando = false;
    for (const id of ["btnProcesar", "btnProcesarMovil"]) {
      const b = $(id);
      if (!b) continue;
      b.disabled = false;
      b.classList.remove("opacity-60", "cursor-not-allowed");
    }
    actualizarBotonAccion();
  }
}

function actualizarBotonAccion() {
  const texto = window.facturaEnEdicion ? "Guardar cambios" : "Cobrar e imprimir";
  for (const id of ["btnProcesar", "btnProcesarMovil"]) {
    const b = $(id);
    if (b && !b.disabled) b.textContent = texto;
  }
}

window.cargarFacturaEnVenta = cargarFacturaEnVenta;

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
  $("discountInput").addEventListener("input", () => {
    formatearDescuentoAlTeclear();
    calcularTotales();
    guardarBorrador();
  });
  $("clientName").addEventListener("input", guardarBorrador);
  if ($("recibidoInput")) {
    /* Mientras se escribe, los miles se ponen solos y el cambio se recalcula */
    $("recibidoInput").addEventListener("input", () => {
      formatearMilesEnCampo($("recibidoInput"));
      calcularTotales();
      guardarBorrador();
    });
  }
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
    if ($("previewModal").classList.contains("hidden")) return;
    if (window.viendoFacturaBusqueda) {
      window.viendoFacturaBusqueda = false;
      cerrarFactura();
    } else {
      terminarVenta();
    }
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
    if (campo) { actualizarCantidadManual(campo.dataset.cant, campo.value); return; }
    const precio = e.target.closest("[data-pri]");
    if (precio) formatearPrecioAlSalir(precio);
  });

  /* Mientras se escribe, los puntos de miles se ponen solos y se descartan
     los caracteres que no son dígitos: el campo responde al instante. */
  $("cartTableBody").addEventListener("input", e => {
    const precio = e.target.closest("[data-pri]");
    if (!precio) return;
    formatearMilesEnCampo(precio);
  });

  /* Flechas dentro del carrito: arriba/abajo mueven de fila,
     izquierda/derecha cambian la cantidad, Supr borra, Enter vuelve al buscador. */
  $("cartTableBody").addEventListener("keydown", e => {
    /* Escribiendo en el precio o la cantidad, las teclas son del campo:
       si no, Retroceso/Supr borraría el producto y las flechas moverían
       de fila mientras se teclea el precio. */
    if (e.target.closest("input, select, textarea")) return;
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
  $("btnPreviewCerrar").addEventListener("click", () => {
    if (window.viendoFacturaBusqueda) {
      window.viendoFacturaBusqueda = false;
      cerrarFactura();
    } else {
      terminarVenta();
    }
  });
  $("previewModal").addEventListener("click", e => {
    if (e.target !== $("previewModal")) return;
    if (window.viendoFacturaBusqueda) {
      window.viendoFacturaBusqueda = false;
      cerrarFactura();
    } else {
      terminarVenta();
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("previewModal").classList.contains("hidden")) {
      if (window.viendoFacturaBusqueda) {
        window.viendoFacturaBusqueda = false;
        cerrarFactura();
        return;
      }
      return terminarVenta();
    }
    if (e.key === "F2") { e.preventDefault(); $("searchInput").focus(); $("searchInput").select(); return; }
    if (e.key === "F4") { e.preventDefault(); if (window.facturaEnEdicion) guardarCambiosFactura(); else procesarPago(); return; }
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
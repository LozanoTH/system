let editando = false; // Declarada globalmente

// ... el resto de tus funciones (como guardarProducto, iRa, etc.)



/* =========================================================
   Ajustes — datos de la factura y catálogo de productos
   Se guarda en /config/ajustes y se aplica sobre CONFIG,
   de modo que la factura, la impression y los totales usan
   siempre los mismos datos.
   ========================================================= */

const Ajustes = (() => {
  const RUTA = CONFIG.rutas.config + "/ajustes";
  const $ = id => document.getElementById(id);
  const dinero = v => UI.dinero(v);

  let ajustes = null;      // copia en memoria de /config/ajustes
  let productos = [];      // catálogo que se está editando
  let buscables = [];      // id+nombre normalizados, para filtrar sin repetir el trabajo
  let facturasHistorial = [];   // facturas leídas de la BD
  let facturaEditando = null;   // factura abierta en el editor
  let editItems = [];            // productos editables de esa factura
  let ocupado = false;     // hay un guardado en curso

  /** Lo guardado sobre lo que hay en CONFIG: el formulario nunca sale vacío. */
  function actuales() {
    const guardado = ajustes || {};
    return {
      empresa: { ...CONFIG.empresa, ...(guardado.empresa || {}) },
      impuesto: guardado.impuesto !== undefined ? guardado.impuesto : CONFIG.impuestoDefecto,
      documento: { ...CONFIG.documento, ...(guardado.documento || {}) },
      dian: { ...CONFIG.dian, ...(guardado.dian || {}) },
      otrosImpuestos: { ...CONFIG.otrosImpuestos, ...(guardado.otrosImpuestos || {}) },
      pie: { ...CONFIG.pie, ...(guardado.pie || {}) }
    };
  }

  /* ---------- aplicar los ajustes guardados ---------- */

  function aplicar() {
    if (!ajustes) return;
    if (ajustes.empresa) CONFIG.empresa = { ...CONFIG.empresa, ...ajustes.empresa };
    if (ajustes.impuesto !== undefined) CONFIG.impuestoDefecto = Number(ajustes.impuesto) || 0;
    if (ajustes.documento) CONFIG.documento = { ...CONFIG.documento, ...ajustes.documento };
    if (ajustes.dian) CONFIG.dian = { ...CONFIG.dian, ...ajustes.dian };
    if (ajustes.otrosImpuestos) CONFIG.otrosImpuestos = { ...CONFIG.otrosImpuestos, ...ajustes.otrosImpuestos };
    if (ajustes.pie) CONFIG.pie = { ...CONFIG.pie, ...ajustes.pie };
    pintarLogo();
    refrescarImpuesto();
  }

  function refrescarImpuesto() {
    if ($("taxRate")) $("taxRate").textContent = CONFIG.impuestoDefecto;
    if (typeof calcularTotales === "function") calcularTotales();
  }

  function pintarLogo() {
    const img = $("marcaLogo");
    const inicial = $("marcaInicial");
    if (!img) return;

    const logo = CONFIG.empresa.logo;
    img.classList.toggle("hidden", !logo);
    if (inicial) inicial.classList.toggle("hidden", !!logo);

    if (logo && img.dataset.src !== logo) {
      img.dataset.src = logo;
      img.src = logo;
    }
  }

  /* ---------- lectura y guardado ---------- */

  async function cargar() {
    try {
      ajustes = await DB.leer(RUTA);
    } catch (e) {
      console.warn("No se pudieron leer los ajustes:", e.message);
      ajustes = null;
    }
    aplicar();
  }

  /* ---------- pestañas ---------- */

  /* Cada opción tiene su propia pestaña: se edita y se guarda sola,
     sin mezclarse con los demás datos. El formulario de producto va aparte
     del catálogo, para no mezclar la lista con el formulario abierto. */
  const PESTANAS = [
    { id: "empresa",    icono: "fa-building",       etiqueta: "Empresa" },
    { id: "logo",       icono: "fa-image",          etiqueta: "Logo" },
    { id: "impuestos",  icono: "fa-percent",        etiqueta: "Impuestos" },
    { id: "documento",  icono: "fa-file-invoice",   etiqueta: "Documento" },
    { id: "productos",  icono: "fa-boxes-stacked",  etiqueta: "Productos" },
    { id: "facturas",   icono: "fa-receipt",        etiqueta: "Facturas" },
    { id: "nuevo",      icono: "fa-circle-plus",    etiqueta: "Nuevo producto" }
  ];

  function verPestana(nombre, moverFoco = false) {
    for (const p of PESTANAS) {
      const activa = p.id === nombre;
      $("panelAjustes" + p.id).classList.toggle("hidden", !activa);
      const boton = $("pestana" + p.id[0].toUpperCase() + p.id.slice(1));
      boton.setAttribute("aria-selected", String(activa));
      boton.tabIndex = activa ? 0 : -1;
    }
    if (nombre === "productos") cargarProductos();
    if (nombre === "facturas") cargarFacturas();
    if (moverFoco) $("pestana" + nombre[0].toUpperCase() + nombre.slice(1)).focus();
  }

  /** Ir a una pestaña; la del formulario llega vacía si no se está editando */
  function irA(nombre, moverFoco = false) {
    verPestana(nombre, moverFoco);
    if (nombre === "nuevo" && !editando) abrirFormulario(null);
  }

  /** Con las flechas se recorre la barra de pestañas, como manda el patrón */
  function moverPestana(evento) {
    const i = PESTANAS.findIndex(p => $("pestana" + p.id[0].toUpperCase() + p.id.slice(1)) === evento.currentTarget);
    const salto = evento.key === "ArrowRight" ? 1 : evento.key === "ArrowLeft" ? -1 : 0;
    if (!salto) return;
    evento.preventDefault();
    verPestana(PESTANAS[(i + salto + PESTANAS.length) % PESTANAS.length].id, true);
  }

  /* ---------- leer lo guardado para llenar el formulario ---------- */

  function llenarFormulario() {
    const e = actuales().empresa;
    $("cfgNombre").value = e.nombre || "";
    $("cfgRfc").value = e.rfc || "";
    $("cfgDireccion").value = e.direccion || "";
    $("cfgTelefono").value = e.telefono || "";
    $("cfgCorreo").value = e.correo || "";
    $("cfgSucursal").value = e.sucursal || "";
    $("cfgCiudad").value = e.ciudad || "";
    $("cfgRegimen").value = e.regimen || "";
    $("cfgLogo").value = e.logo || "";
    $("cfgImpuesto").value = actuales().impuesto;

    const d = actuales().documento;
    $("cfgTituloDocumento").value = d.titulo || "";
    $("cfgCajero").value = d.cajero || "";
    $("cfgPosNumero").value = d.pos || "";
    $("cfgPosPrefijo").value = d.prefijo || "";

    const di = actuales().dian;
    $("cfgDianAutorizacion").value = di.autorizacion || "";
    $("cfgDianFecha").value = di.fecha || "";
    $("cfgDianDesde").value = di.desde || "";
    $("cfgDianHasta").value = di.hasta || "";
    $("cfgDianVigenciaMeses").value = di.vigenciaMeses || "";
    $("cfgDianVigenciaHasta").value = di.vigenciaHasta || "";

    const o = actuales().otrosImpuestos;
    $("cfgImpoconsumo").value = o.impoconsumo || 0;
    $("cfgIco").value = o.ico || 0;
    $("cfgInc").value = o.inc || 0;

    const pie = actuales().pie;
    $("cfgPieMensaje").value = pie.mensaje || "";
    $("cfgPieSoftware").value = pie.software || "";

    verLogo();
  }

  function verLogo() {
    const url = $("cfgLogo").value.trim();
    const previa = $("cfgLogoPrevia");
    $("cfgLogoVacio").classList.toggle("hidden", !!url);
    if (!url) {
      previa.classList.add("hidden");
      previa.removeAttribute("src");
      return;
    }
    previa.classList.remove("hidden");
    previa.src = url;
  }

  /** Si la imagen no carga, se vuelve al cuadro en blanco */
  function logoNoCarga(mensaje) {
    $("cfgLogoPrevia").classList.add("hidden");
    $("cfgLogoVacio").classList.remove("hidden");
    if (mensaje) mostrarToast(mensaje, "warn");
  }

  /* ---------- guardar cada pestaña por separado ---------- */

  /** Escribe en /config/ajustes lo que ya había más lo que se cambió */
  async function persistir(cambios, boton, mensaje, textoNormal) {
    if (ocupado) return false;
    ocupado = true;
    boton.disabled = true;
    const texto = boton.textContent;
    boton.textContent = "Guardando…";

    try {
      const nuevos = { ...ajustes, ...cambios, actualizado: new Date().toISOString() };
      await DB.guardar(RUTA, nuevos);
      ajustes = nuevos;
      aplicar();
      mostrarToast(mensaje);
      return true;
    } catch (e) {
      console.error(e);
      mostrarToast("No se pudo guardar: revisa la conexión", "err");
      return false;
    } finally {
      ocupado = false;
      boton.disabled = false;
      boton.textContent = textoNormal;
    }
  }

  async function guardarEmpresa() {
    const boton = $("btnGuardarEmpresa");
    const empresa = {
      nombre: $("cfgNombre").value.trim(),
      rfc: $("cfgRfc").value.trim(),
      direccion: $("cfgDireccion").value.trim(),
      telefono: $("cfgTelefono").value.trim(),
      correo: $("cfgCorreo").value.trim(),
      sucursal: $("cfgSucursal").value.trim(),
      ciudad: $("cfgCiudad").value.trim(),
      regimen: $("cfgRegimen").value.trim()
    };

    if (!empresa.nombre) return mostrarToast("El nombre de la empresa es obligatorio", "warn");
    if (empresa.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empresa.correo))
      return mostrarToast("El correo no parece válido", "warn");

    await persistir(
      { empresa: { ...actuales().empresa, ...empresa } },
      boton, "Empresa guardada", "Guardar empresa"
    );
  }

  async function guardarDocumento() {
    const boton = $("btnGuardarDocumento");
    const num = id => { const v = Number($(id).value); return Number.isFinite(v) ? v : 0; };

    const otrosImpuestos = {
      impoconsumo: num("cfgImpoconsumo"),
      ico: num("cfgIco"),
      inc: num("cfgInc")
    };
    for (const v of Object.values(otrosImpuestos)) {
      if (!(v >= 0 && v <= 100)) return mostrarToast("Los impuestos deben estar entre 0 y 100", "warn");
    }

    const documento = {
      titulo: $("cfgTituloDocumento").value.trim(),
      cajero: $("cfgCajero").value.trim(),
      pos: $("cfgPosNumero").value.trim(),
      prefijo: $("cfgPosPrefijo").value.trim()
    };

    const dian = {
      autorizacion: $("cfgDianAutorizacion").value.trim(),
      fecha: $("cfgDianFecha").value.trim(),
      desde: $("cfgDianDesde").value.trim(),
      hasta: $("cfgDianHasta").value.trim(),
      vigenciaMeses: $("cfgDianVigenciaMeses").value.trim(),
      vigenciaHasta: $("cfgDianVigenciaHasta").value.trim()
    };

    const pie = {
      mensaje: $("cfgPieMensaje").value.trim(),
      software: $("cfgPieSoftware").value.trim()
    };

    await persistir(
      { documento, dian, otrosImpuestos, pie },
      boton, "Documento guardado", "Guardar documento"
    );
  }

  async function guardarLogo() {
    const boton = $("btnGuardarLogo");
    const logo = $("cfgLogo").value.trim();

    if (logo && !/^(https?:\/\/|data:image\/)/i.test(logo))
      return mostrarToast("La dirección del logo debe empezar por https://", "warn");

    await persistir(
      { empresa: { ...actuales().empresa, logo } },
      boton, logo ? "Logo guardado" : "Logo quitado", "Guardar logo"
    );
  }

  async function guardarImpuesto() {
    const boton = $("btnGuardarImpuesto");
    const impuesto = Number($("cfgImpuesto").value);

    if (!($("cfgImpuesto").value.trim() !== "" && impuesto >= 0 && impuesto <= 100))
      return mostrarToast("El IVA debe estar entre 0 y 100", "warn");

    await persistir({ impuesto }, boton, "Impuesto guardado", "Guardar impuesto");
  }

  /* ---------- catálogo ---------- */

  async function cargarProductos() {
    try {
      productos = (await DB.productos.todos())
        .filter(p => p && p.nombre)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
      buscables = productos.map(p => UI.normalizar(p.id + " " + p.nombre + " " + (p.unidad || "pieza")));
    } catch (e) {
      console.error(e);
      productos = [];
      mostrarToast("No se pudo leer el catálogo", "warn");
    }
    pintarProductos();
  }

  /* Igual que en el panel principal: con miles de productos la lista entra
     por lotes para que abrirla o filtrarla no congele el navegador. */
  const FILA_CFG = p => `
        <li class="flex items-center gap-2 px-2 py-1.5 border-b border-slate-100 dark:border-white/10 last:border-0">
          <span class="text-[10px] font-mono text-slate-400 flex-shrink-0">${UI.esc(String(p.id).toUpperCase())}</span>
          <span class="flex-1 min-w-0 truncate text-xs text-slate-700 dark:text-slate-200" title="${UI.esc(p.nombre)}">${UI.esc(p.nombre)}</span>
          <span class="text-[10px] text-slate-400 flex-shrink-0 hidden sm:inline">${UI.esc(p.unidad || "pieza")}</span>
          <span class="font-mono text-xs text-slate-900 dark:text-white flex-shrink-0">${UI.esc(dinero(p.precio))}</span>
          <button type="button" data-editar="${UI.esc(p.id)}" class="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100" aria-label="Editar ${UI.esc(p.nombre)}">
            <i class="fa-solid fa-pen text-[11px]"></i>
          </button>
          <button type="button" data-borrar="${UI.esc(p.id)}" class="p-1.5 text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400" aria-label="Borrar ${UI.esc(p.nombre)}">
            <i class="fa-regular fa-trash-can text-xs"></i>
          </button>
        </li>`;

  let cfgLote = 0;

  function pintarProductos() {
    const filtro = UI.normalizar($("cfgBuscar").value);
    if (buscables.length !== productos.length) {
      buscables = productos.map(p => UI.normalizar(p.id + " " + p.nombre + " " + (p.unidad || "pieza")));
    }
    const lista = productos.filter((p, i) => !filtro || buscables[i].includes(filtro));

    $("cfgTotal").textContent = productos.length + " productos · " + lista.length + " visibles";

    const listaEl = $("cfgLista");
    cfgLote++;
    const miLote = cfgLote;
    if (!productos.length) {
      listaEl.innerHTML = '<li class="px-3 py-8 text-center text-[11px] text-slate-400">El catálogo está vacío. Crea el primero en la pestaña <button type="button" class="underline decoration-dotted hover:text-slate-600 dark:hover:text-slate-200" data-ir-pestana="nuevo">Nuevo producto</button></li>';
      return;
    }
    listaEl.innerHTML = lista.length ? "" : '<li class="px-2 py-6 text-center text-[11px] text-slate-400">Sin resultados</li>';
    if (!lista.length) return;

    const TAMANO = 400;
    const lote = desde => {
      if (miLote !== cfgLote) return;              // el usuario siguió escribiendo
      const trozo = lista.slice(desde, desde + TAMANO);
      if (!trozo.length) return;
      listaEl.insertAdjacentHTML("beforeend", trozo.map(FILA_CFG).join(""));
      if (desde + TAMANO < lista.length) setTimeout(() => lote(desde + TAMANO), 0);
    };
    lote(0);
  }

  /** Siguiente código libre con el mismo formato del catálogo: p001 → p101 */
  function siguienteCodigo() {
    const hallados = productos
      .map(x => String(x.id).match(/^([A-Za-z]*)(\d+)$/))
      .filter(m => m)
      .map(m => ({ letras: m[1], numero: Number(m[2]), largo: m[2].length }));

    if (!hallados.length) return "p001";

    /* Con varias series (p001…, r001…) se sigue la del número más alto:
       si no, la letra saldría de un producto cualquiera y el código quedaría raro. */
    hallados.sort((a, b) => b.numero - a.numero || b.letras.localeCompare(a.letras));
    const ultimo = hallados[0];
    const siguiente = ultimo.numero + 1;
    const letras = ultimo.letras || "p";
    const largo = Math.max.apply(null, hallados.map(x => x.largo));
    return letras + String(siguiente).padStart(largo, "0");
  }

  /* ---------- dinero con puntos de miles While typing ---------- */

  const soloDigitos = texto => texto.replace(/[^\d]/g, "");

  /** 34500 → "34.500" con el separador de Colombia */
  function milesColombia(digitos) {
    if (!digitos) return "";
    return Number(digitos).toLocaleString(CONFIG.moneda.locale, { maximumFractionDigits: 0 });
  }

  /**
   * Escribe los puntos mientras se teclea y deja el cursor donde
   * corresponde: si no, al borrar un dígito el cursor salta y
   * "34.500" se vuelve "3.450" sin querer.
   */
  function formatearPrecioAlTeclear(evento) {
    const campo = evento.target;
    const antes = soloDigitos(campo.value.slice(0, campo.selectionStart || 0)).length;
    const digitos = soloDigitos(campo.value);

    if (!digitos) { campo.value = ""; return; }

    const nuevo = milesColombia(digitos);
    campo.value = nuevo;

    if (antes > 0) {
      let vistas = 0, posicion = nuevo.length;
      for (let i = 0; i < nuevo.length; i++) {
        if (/\d/.test(nuevo[i])) vistas++;
        if (vistas === antes) { posicion = i + 1; break; }
      }
      campo.setSelectionRange(posicion, posicion);
    }
  }

  /** El formulario siempre vive en su pestaña: se abre vacío o con el producto. */
  function abrirFormulario(id) {
    editando = id || null;
    const p = id ? productos.find(x => x.id === id) : null;
    const titulo = p ? "Editar producto" : "Nuevo producto";

    $("cfgFormTitulo").textContent = titulo;
    $("pestanaNuevoTexto").textContent = titulo;
    /* al agregar, el código llega puesto */
    $("cfgCodigo").value = p ? p.id.toUpperCase() : siguienteCodigo().toUpperCase();
    $("cfgCodigo").disabled = !!p;          /* el código es la clave: no se renombra */
    $("cfgCodigo").title = p ? "El código identifica el producto y no se puede cambiar" : "";
    $("cfgProductoNombre").value = p ? p.nombre : "";
    $("cfgUnidad").value = p ? p.unidad || "pieza" : "pieza";
    $("cfgPrecio").value = p ? milesColombia(soloDigitos(String(p.precio))) : "";
    $("cfgProductoImpuesto").value = p && p.impuesto !== undefined ? p.impuesto : 0;

    verPestana("nuevo");
    $("cfgProductoNombre").focus();
  }

  /** Al cerrar el formulario se vuelve al catálogo, que es donde se ve el resultado. */
  function cerrarFormulario() {
    editando = null;
    /* Se limpia para no dejar un producto «a medio guardar» que al
       reenviar salte con «ya existe ese código». */
    for (const id of ["cfgCodigo", "cfgProductoNombre", "cfgPrecio", "cfgProductoImpuesto"]) $(id).value = "";
    $("cfgUnidad").value = "pieza";
    $("cfgFormTitulo").textContent = "Nuevo producto";
    $("pestanaNuevoTexto").textContent = "Nuevo producto";
    verPestana("productos");
  }

  async function guardarProducto() {
    if (ocupado) return;
    ocupado = true;
    const boton = $("btnGuardarProducto");
    boton.disabled = true;
    boton.textContent = "Guardando…";

    const nombre = $("cfgProductoNombre").value.trim();
    const digitosPrecio = soloDigitos($("cfgPrecio").value);
    const precio = Number(digitosPrecio);
    const digitado = $("cfgProductoImpuesto").value.trim();
    const impuesto = digitado === "" ? 0 : Number(digitado);

    if (!nombre) return terminarProducto("El nombre del producto es obligatorio", boton);
    if (!digitosPrecio) return terminarProducto("El precio es obligatorio", boton);
    if (!(precio >= 0)) return terminarProducto("El precio no es válido", boton);
    if (!(impuesto >= 0 && impuesto <= 100)) return terminarProducto("El impuesto debe estar entre 0 y 100", boton);

    /* El código es la clave de Firebase: p042. Si no se escribe, se pone el siguiente. */
    const escrito = $("cfgCodigo").value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const id = editando || escrito || siguienteCodigo();
    if (!editando && productos.some(p => p.id === id)) {
      return terminarProducto("Ya existe un producto con el código " + id.toUpperCase(), boton);
    }

    const registro = {
      nombre,
      precio,
      unidad: $("cfgUnidad").value.trim() || "pieza",
      impuesto
    };

    try {
      await DB.productos.guardar(editando || id, registro);   /* el código es la clave */
      await cargarProductos();
      if (typeof cargarCatalogo === "function") await cargarCatalogo();   // el POS ya lo ve
      cerrarFormulario();
      mostrarToast((editando ? "Producto actualizado" : "Producto agregado") + ": " + nombre);
      terminarProducto("", boton, true);
    } catch (e) {
      console.error(e);
      terminarProducto("No se pudo guardar el producto", boton);
    }
  }

  function terminarProducto(mensaje, boton, ok = false) {
    ocupado = false;
    boton.disabled = false;
    boton.textContent = "Guardar producto";
    if (mensaje) mostrarToast(mensaje, ok ? "ok" : "warn");
  }

  async function borrarProducto(id) {
    const p = productos.find(x => x.id === id);
    if (!p) return;

    const ok = await UI.confirmar({
      titulo: "Borrar producto",
      mensaje: "Se quita del catálogo y deja de estar disponible en el POS.",
      detalle: p.id.toUpperCase() + " · " + p.nombre,
      ok: "Borrar",
      peligro: true
    });
    if (!ok) return;

    try {
      await DB.productos.borrar(id);
      if (editando === id) cerrarFormulario();
      await cargarProductos();
      if (typeof cargarCatalogo === "function") await cargarCatalogo();
      mostrarToast("Producto borrado: " + p.nombre, "warn");
    } catch (e) {
      console.error(e);
      mostrarToast("No se pudo borrar el producto", "err");
    }
  }

  /* ---------- logo desde el equipo ---------- */

  function subirLogo(archivo) {
    if (!archivo) return;
    if (!/^image\//.test(archivo.type)) return mostrarToast("Ese archivo no es una imagen", "warn");
    /* Un logo enorme se leería en cada arranque: se limita el tamaño */
    if (archivo.size > 120 * 1024) return mostrarToast("El logo debe pesar menos de 120 KB", "warn");

    const lector = new FileReader();
    lector.onload = () => { $("cfgLogo").value = lector.result; verLogo(); };
    lector.onerror = () => mostrarToast("No se pudo leer la imagen", "warn");
    lector.readAsDataURL(archivo);
  }

  /* ---------- abrir y cerrar ---------- */

  let botonOrigen = null;

  function abrir() {
    botonOrigen = document.activeElement;
    llenarFormulario();
    verPestana("empresa");
    const modal = $("ajustesModal");
    modal.classList.remove("hidden");
    requestAnimationFrame(() => modal.classList.remove("opacity-0"));
    setTimeout(() => $("cfgNombre").focus(), 60);
    $("btnAjustes").setAttribute("aria-expanded", "true");
  }

  function cerrar() {
    const modal = $("ajustesModal");
    if (modal.classList.contains("hidden")) return;
    modal.classList.add("opacity-0");
    setTimeout(() => modal.classList.add("hidden"), 200);
    $("btnAjustes").setAttribute("aria-expanded", "false");
    if (botonOrigen && botonOrigen.focus) botonOrigen.focus();
  }

  /* ---------- Facturas antiguas (consulta sin vender) ---------- */

  async function cargarFacturas() {
    try {
      facturasHistorial = (await DB.facturas.todos())
        .filter(f => f && f.folio)
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    } catch (e) {
      console.error(e);
      facturasHistorial = [];
      mostrarToast("No se pudieron leer las facturas", "warn");
    }
    filtrarFacturas();
  }

  function filtrarFacturas() {
    const filtro = UI.normalizar($("cfgBuscarFactura").value);
    const lista = !filtro
      ? facturasHistorial
      : facturasHistorial.filter(f => {
        const texto = UI.normalizar(
          (f.folio || "") + " " + (f.cliente || "") + " " +
          (f.items || []).map(i => i.descripcion || "").join(" ")
        );
        return texto.includes(filtro);
      });

    $("cfgTotalFacturas").textContent =
      facturasHistorial.length + " facturas · " + lista.length + " visibles";

    const listaEl = $("cfgListaFacturas");
    if (!facturasHistorial.length) {
      listaEl.innerHTML = '<li class="px-3 py-8 text-center text-[11px] text-slate-400">No hay facturas emitidas todavía</li>';
      return;
    }
    if (!lista.length) {
      listaEl.innerHTML = '<li class="px-2 py-6 text-center text-[11px] text-slate-400">Sin resultados</li>';
      return;
    }

    listaEl.innerHTML = lista.map(f => `
      <li class="flex items-center gap-2 px-2 py-1.5 border-b border-slate-100 dark:border-white/10 last:border-0">
        <span class="text-[10px] font-mono text-slate-400 flex-shrink-0">${UI.esc(f.folio)}</span>
        <span class="text-[10px] text-slate-400 flex-shrink-0 hidden sm:inline">${UI.esc(UI.fechaHora(f.fecha))}</span>
        <span class="flex-1 min-w-0 truncate text-xs text-slate-700 dark:text-slate-200" title="${UI.esc(f.cliente)}">${UI.esc(f.cliente)}</span>
        <span class="font-mono text-xs text-slate-900 dark:text-white flex-shrink-0">${UI.esc(dinero(f.total))}</span>
        <button type="button" data-ver-factura="${UI.esc(f.id)}" class="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100" aria-label="Ver factura ${UI.esc(f.folio)}">
          <i class="fa-solid fa-eye text-[11px]"></i>
        </button>
        <button type="button" data-editar-factura="${UI.esc(f.id)}" class="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-slate-100" aria-label="Editar factura ${UI.esc(f.folio)}">
          <i class="fa-solid fa-pen text-[11px]"></i>
        </button>
        <button type="button" data-eliminar-factura="${UI.esc(f.id)}" class="p-1.5 text-slate-300 hover:text-rose-500 dark:text-neutral-500 dark:hover:text-rose-400" aria-label="Eliminar factura ${UI.esc(f.folio)}">
          <i class="fa-regular fa-trash-can text-xs"></i>
        </button>
      </li>`).join("");
  }

  function verFacturaAntigua(id) {
    const f = facturasHistorial.find(x => x.id === id);
    if (!f) return mostrarToast("No se encontró la factura", "warn");
    window.viendoFacturaBusqueda = true;
    if (typeof pintarFactura === "function") pintarFactura(f);
    const modal = $("previewModal");
    modal.classList.remove("hidden");
    if (modal.scrollTop !== undefined) modal.scrollTop = 0;
  }

  /* ---------- Editor y eliminación de facturas ---------- */

  function abrirEditorFactura(id) {
    const f = facturasHistorial.find(x => x.id === id);
    if (!f) return mostrarToast("No se encontró la factura", "warn");
    facturaEditando = f;
    editItems = (f.items || []).map(i => ({ ...i }));
    $("editFacturaFolio").textContent = f.folio || "—";
    $("editFacturaFecha").textContent = UI.fechaHora(f.fecha);
    $("editFacturaCliente").value = f.cliente || "";
    $("editFacturaEstado").value = f.estado || "pagada";
    pintarEditItems();
    $("facturaEditModal").classList.remove("hidden");
    $("facturaEditModal").classList.add("flex");
    $("editFacturaCliente").focus();
  }

  function pintarEditItems() {
    const ul = $("editFacturaItems");
    if (!editItems.length) {
      ul.innerHTML = '<li class="px-3 py-8 text-center text-[11px] text-slate-400">Sin productos</li>';
      $("editFacturaTotales").textContent = "Total $0";
      return;
    }

    ul.innerHTML = editItems.map((item, idx) => `
      <li class="flex items-center gap-2 px-2 py-1.5 border-b border-slate-100 dark:border-white/10 last:border-0">
        <span class="flex-1 min-w-0 truncate text-xs text-slate-700 dark:text-slate-200" title="${UI.esc(item.descripcion)}">${UI.esc(item.descripcion)}</span>
        <input type="number" min="1" step="1" data-edit-qty="${idx}" value="${Number(item.cantidad) || 1}"
               class="w-12 bg-slate-50 dark:bg-surface-950 border border-slate-200 dark:border-white/10 rounded px-1 py-0.5 text-[11px] text-center font-mono focus:outline-none">
        <span class="text-[10px] text-slate-400 hidden sm:inline">${UI.esc(item.unidad || "pieza")}</span>
        <span class="font-mono text-[10px] text-slate-500">${UI.esc(dinero(item.precio))}</span>
        <span class="font-mono text-xs font-semibold text-slate-900 dark:text-white">${UI.esc(dinero((Number(item.precio) || 0) * (Number(item.cantidad) || 0)))}</span>
        <button type="button" data-remove-item="${idx}" class="p-1 text-slate-300 hover:text-rose-500 dark:text-neutral-500 dark:hover:text-rose-400" aria-label="Quitar ${UI.esc(item.descripcion)}">
          <i class="fa-solid fa-xmark text-[11px]"></i>
        </button>
      </li>`).join("");

    const tasa = Number(facturaEditando.tasaImpuesto || 0);
    const subtotal = editItems.reduce((s, i) => s + (Number(i.precio) || 0) * (Number(i.cantidad) || 0), 0);
    const impuesto = subtotal * tasa / 100;
    const otros = otrosDeFactura(facturaEditando, subtotal);
    const descuento = Number(facturaEditando.descuento) || 0;
    const total = subtotal + impuesto + otros - descuento;
    $("editFacturaTotales").textContent =
      "Subtotal " + dinero(subtotal) + " · IVA " + dinero(impuesto) + " · Total " + dinero(total);
  }

  /** Impuestos adicionales (impoconsumo, I.C.O., I.N.C.) de una factura */
  function otrosDeFactura(f, subtotal) {
    const pct = (Number(f.impoconsumo) || 0) + (Number(f.ico) || 0) + (Number(f.inc) || 0);
    return subtotal * pct / 100;
  }

  function recalcEditFactura() {
    const tasa = Number(facturaEditando.tasaImpuesto || 0);
    const subtotal = editItems.reduce((s, i) => s + (Number(i.precio) || 0) * (Number(i.cantidad) || 0), 0);
    const impuesto = subtotal * tasa / 100;
    const otros = otrosDeFactura(facturaEditando, subtotal);
    const descuento = Number(facturaEditando.descuento) || 0;
    const total = subtotal + impuesto + otros - descuento;
    /* Se conserva el efectivo recibido y el cambio se recalcula con el total nuevo */
    const recibido = facturaEditando.recibido !== undefined ? Number(facturaEditando.recibido) || 0 : total;
    const cambio = Math.max(0, recibido - total);
    return { subtotal, impuesto, tasa, otros, descuento, total, recibido, cambio };
  }

  function cerrarEditorFactura() {
    facturaEditando = null;
    editItems = [];
    $("facturaEditModal").classList.add("hidden");
    $("facturaEditModal").classList.remove("flex");
  }

  async function guardarEdicionFactura() {
    if (!facturaEditando) return;
    const boton = $("btnGuardarEdicionFactura");
    const cliente = $("editFacturaCliente").value.trim() || "Consumidor Final";
    const estado = $("editFacturaEstado").value;
    const id = facturaEditando.id;

    if (ocupado) return;
    ocupado = true;
    boton.disabled = true;
    const texto = boton.textContent;
    boton.textContent = "Guardando…";

    const items = editItems
      .map(i => ({
        ...i,
        cantidad: Number(i.cantidad) || 0,
        precio: Number(i.precio) || 0
      }))
      .filter(i => i.cantidad > 0);

    if (!items.length) {
      mostrarToast("La factura debe tener al menos un producto", "warn");
      ocupado = false;
      boton.disabled = false;
      boton.textContent = texto;
      return;
    }

    const { subtotal, impuesto, tasa, otros, descuento, total, recibido, cambio } = recalcEditFactura();

    try {
      await DB.actualizar(CONFIG.rutas.facturas, id, {
        cliente,
        estado,
        items,
        subtotal,
        impuesto,
        tasaImpuesto: tasa,
        totalOtros: otros,
        descuento,
        total,
        recibido,
        cambio,
        actualizado: new Date().toISOString()
      });
      Object.assign(facturaEditando, { cliente, estado, items, subtotal, impuesto, tasaImpuesto: tasa, totalOtros: otros, descuento, total, recibido, cambio });
      filtrarFacturas();
      cerrarEditorFactura();
      mostrarToast("Factura actualizada");
    } catch (e) {
      console.error(e);
      mostrarToast("No se pudo guardar: revisa la conexión", "err");
    } finally {
      ocupado = false;
      boton.disabled = false;
      boton.textContent = texto;
    }
  }

  async function eliminarFactura(id) {
    const f = facturasHistorial.find(x => x.id === id);
    if (!f) return mostrarToast("No se encontró la factura", "warn");

    const ok = await UI.confirmar({
      titulo: "Eliminar factura",
      mensaje: "Se borrará " + (f.folio || "esta factura") + " de la base de datos.",
      detalle: "Esta acción no se puede deshacer.",
      ok: "Eliminar",
      cancelar: "Cancelar",
      peligro: true
    });
    if (!ok) return;

    try {
      await DB.facturas.borrar(id);
      facturasHistorial = facturasHistorial.filter(x => x.id !== id);
      filtrarFacturas();
      mostrarToast("Factura eliminada");
    } catch (e) {
      console.error(e);
      mostrarToast("No se pudo eliminar: revisa la conexión", "err");
    }
  }

  /* alias usado por la delegación del clic: edita en la pantalla principal */
  function editarFactura(id) {
    const f = facturasHistorial.find(x => x.id === id);
    if (!f) return mostrarToast("No se encontró la factura", "warn");
    if (typeof cerrar === "function") cerrar();
    if (typeof window.cargarFacturaEnVenta === "function") {
      // Ajustes se cierra antes de cargar para no dejar dos modales
      setTimeout(() => window.cargarFacturaEnVenta(f), 0);
    } else {
      abrirEditorFactura(id);
    }
  }

  function iniciar() {
    $("btnAjustes").addEventListener("click", abrir);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        if (!$("facturaEditModal").classList.contains("hidden")) { cerrarEditorFactura(); return; }
        if (!$("ajustesModal").classList.contains("hidden")) cerrar();
      }
    });
    $("btnCerrarAjustes").addEventListener("click", cerrar);
    $("ajustesModal").addEventListener("click", e => { if (e.target === $("ajustesModal")) cerrar(); });

    for (const p of PESTANAS) {
      const boton = $("pestana" + p.id[0].toUpperCase() + p.id.slice(1));
      boton.addEventListener("click", () => irA(p.id));
      boton.addEventListener("keydown", moverPestana);
    }
    /* Enlaces dentro de un texto que llevan a otra pestaña.
       Ojo: el atributo va en kebab-case porque el DOM guarda los
       atributos en minúsculas (dataset.irPestana → data-ir-pestana). */
    $("ajustesModal").addEventListener("click", e => {
      const salto = e.target.closest("[data-ir-pestana]");
      if (salto) irA(salto.dataset.irPestana);
    });

    $("btnGuardarEmpresa").addEventListener("click", guardarEmpresa);
    $("btnGuardarLogo").addEventListener("click", guardarLogo);
    $("btnGuardarImpuesto").addEventListener("click", guardarImpuesto);
    $("btnGuardarDocumento").addEventListener("click", guardarDocumento);

    $("cfgLogo").addEventListener("input", verLogo);
    $("cfgLogoPrevia").addEventListener("error", () => logoNoCarga("La dirección del logo no carga"));
    /* el logo de la cabecera tampoco puede quedar como imagen rota */
    $("marcaLogo").addEventListener("error", () => {
      $("marcaLogo").classList.add("hidden");
      $("marcaInicial").classList.remove("hidden");
      $("marcaLogo").dataset.src = "";
    });
    $("cfgLogoArchivo").addEventListener("change", e => subirLogo(e.target.files[0]));
    $("btnQuitarLogo").addEventListener("click", () => { $("cfgLogo").value = ""; verLogo(); });

    $("cfgPrecio").addEventListener("input", formatearPrecioAlTeclear);
    $("cfgBuscar").addEventListener("input", pintarProductos);
    $("cfgBuscarFactura").addEventListener("input", filtrarFacturas);
    $("cfgListaFacturas").addEventListener("click", e => {
      const ver = e.target.closest("[data-ver-factura]");
      if (ver) verFacturaAntigua(ver.dataset.verFactura);
      const ed = e.target.closest("[data-editar-factura]");
      if (ed) editarFactura(ed.dataset.editarFactura);
      const bo = e.target.closest("[data-eliminar-factura]");
      if (bo) eliminarFactura(bo.dataset.eliminarFactura);
    });
    $("editFacturaItems").addEventListener("change", e => {
      const q = e.target.closest("[data-edit-qty]");
      if (q) {
        editItems[Number(q.dataset.editQty)].cantidad = Number(q.value) || 0;
        pintarEditItems();
      }
    });
    $("editFacturaItems").addEventListener("click", e => {
      const b = e.target.closest("[data-remove-item]");
      if (b) {
        editItems.splice(Number(b.dataset.removeItem), 1);
        pintarEditItems();
      }
    });

    $("btnCerrarEdicionFactura").addEventListener("click", cerrarEditorFactura);
    $("btnCerrarEdicionFactura2").addEventListener("click", cerrarEditorFactura);
    $("btnGuardarEdicionFactura").addEventListener("click", guardarEdicionFactura);
    $("facturaEditModal").addEventListener("click", e => { if (e.target === $("facturaEditModal")) cerrarEditorFactura(); });
    $("btnCancelarProducto").addEventListener("click", cerrarFormulario);
    $("btnGuardarProducto").addEventListener("click", guardarProducto);
    $("cfgLista").addEventListener("click", e => {
      const ed = e.target.closest("[data-editar]");
      const bo = e.target.closest("[data-borrar]");
      if (ed) abrirFormulario(ed.dataset.editar);
      if (bo) borrarProducto(bo.dataset.borrar);
    });

    cargar();     // los ajustes se aplican antes de que el usuario cobre

    /* Atajo de la PWA: ?vista=ajustes abre directo en esta pantalla */
    if (new URLSearchParams(location.search).get("vista") === "ajustes") abrir();
  }

  return { iniciar, abrir, cerrar, cargar, aplicar };
})();

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
  let editando = null;     // id del producto en edición
  let ocupado = false;     // hay un guardado en curso

  /** Lo guardado sobre lo que hay en CONFIG: el formulario nunca sale vacío. */
  function actuales() {
    const guardado = ajustes || {};
    return {
      empresa: { ...CONFIG.empresa, ...(guardado.empresa || {}) },
      impuesto: guardado.impuesto !== undefined ? guardado.impuesto : CONFIG.impuestoDefecto
    };
  }

  /* ---------- aplicar los ajustes guardados ---------- */

  function aplicar() {
    if (!ajustes) return;
    if (ajustes.empresa) CONFIG.empresa = { ...CONFIG.empresa, ...ajustes.empresa };
    if (ajustes.impuesto !== undefined) CONFIG.impuestoDefecto = Number(ajustes.impuesto) || 0;
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

  async function guardarAjustes() {
    if (ocupado) return;
    ocupado = true;
    const boton = $("btnGuardarAjustes");
    boton.disabled = true;
    boton.textContent = "Guardando…";

    const empresa = {
      nombre: $("cfgNombre").value.trim(),
      rfc: $("cfgRfc").value.trim(),
      direccion: $("cfgDireccion").value.trim(),
      telefono: $("cfgTelefono").value.trim(),
      correo: $("cfgCorreo").value.trim(),
      logo: $("cfgLogo").value.trim()
    };
    if (!empresa.nombre) {
      return terminar("El nombre de la empresa es obligatorio", boton);
    }
    if (empresa.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(empresa.correo)) {
      return terminar("El correo no parece válido", boton);
    }

    const impuesto = Number($("cfgImpuesto").value);
    if (!(impuesto >= 0 && impuesto <= 100)) {
      return terminar("El IVA debe estar entre 0 y 100", boton);
    }

    const nuevos = { empresa, impuesto, actualizado: new Date().toISOString() };
    try {
      await DB.guardar(RUTA, nuevos);
      ajustes = nuevos;
      aplicar();
      mostrarToast("Datos de la factura guardados");
      terminar("", boton, true);
    } catch (e) {
      console.error(e);
      terminar("No se pudieron guardar los cambios", boton);
    }
  }

  function terminar(mensaje, boton, ok = false) {
    ocupado = false;
    boton.disabled = false;
    boton.textContent = "Guardar cambios";
    if (mensaje) mostrarToast(mensaje, ok ? "ok" : "warn");
  }

  /* ---------- pestañas ---------- */

  function verPestana(nombre) {
    for (const t of ["datos", "productos"]) {
      $("panelAjustes" + t).classList.toggle("hidden", t !== nombre);
      $("pestana" + t[0].toUpperCase() + t.slice(1)).setAttribute("aria-selected", String(t === nombre));
    }
    if (nombre === "productos") cargarProductos();
    else llenarFormulario();
  }

  /* ---------- datos de la factura ---------- */

  function llenarFormulario() {
    const e = actuales().empresa;
    $("cfgNombre").value = e.nombre || "";
    $("cfgRfc").value = e.rfc || "";
    $("cfgDireccion").value = e.direccion || "";
    $("cfgTelefono").value = e.telefono || "";
    $("cfgCorreo").value = e.correo || "";
    $("cfgLogo").value = e.logo || "";
    $("cfgImpuesto").value = actuales().impuesto;
    pintarLogo();
    verLogo();
  }

  function verLogo() {
    const url = $("cfgLogo").value.trim();
    const previa = $("cfgLogoPrevia");
    if (!url) {
      previa.classList.add("hidden");
      previa.removeAttribute("src");
      return;
    }
    previa.classList.remove("hidden");
    previa.src = url;
  }

  /* ---------- catálogo ---------- */

  async function cargarProductos() {
    try {
      productos = (await DB.productos.todos())
        .filter(p => p && p.nombre)
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
      buscables = productos.map(p => UI.normalizar(p.id + " " + p.nombre));
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
        <li class="flex items-center gap-2 px-2 py-1.5 border-b border-slate-100 dark:border-slate-800/60 last:border-0">
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
      buscables = productos.map(p => UI.normalizar(p.id + " " + p.nombre));
    }
    const lista = productos.filter((p, i) => !filtro || buscables[i].includes(filtro));

    $("cfgTotal").textContent = productos.length + " productos · " + lista.length + " visibles";

    const listaEl = $("cfgLista");
    cfgLote++;
    const miLote = cfgLote;
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

  function abrirFormulario(id) {
    editando = id || null;
    const p = id ? productos.find(x => x.id === id) : null;

    $("cfgFormTitulo").textContent = p ? "Editar producto" : "Nuevo producto";
    /* al agregar, el código llega puesto */
    $("cfgCodigo").value = p ? p.id.toUpperCase() : siguienteCodigo().toUpperCase();
    $("cfgCodigo").disabled = !!p;          /* el código es la clave: no se renombra */
    $("cfgCodigo").title = p ? "El código identifica el producto y no se puede cambiar" : "";
    $("cfgProductoNombre").value = p ? p.nombre : "";
    $("cfgUnidad").value = p ? p.unidad || "pieza" : "pieza";
    $("cfgPrecio").value = p ? milesColombia(soloDigitos(String(p.precio))) : "";
    $("cfgProductoImpuesto").value = p && p.impuesto !== undefined ? p.impuesto : 0;

    $("cfgForm").classList.remove("hidden");
    $("cfgProductoNombre").focus();
  }

  function cerrarFormulario() {
    editando = null;
    $("cfgForm").classList.add("hidden");
    /* Se limpia para no dejar un producto «a medio guardar» que al
       reenviar salte con «ya existe ese código». */
    for (const id of ["cfgCodigo", "cfgProductoNombre", "cfgPrecio", "cfgProductoImpuesto"]) $(id).value = "";
    $("cfgUnidad").value = "pieza";
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
    if (!UI.confirm("¿Borrar el producto " + p.id.toUpperCase() + " · " + p.nombre + "?")) return;

    try {
      await DB.productos.borrar(id);
      if (editando === id) cerrarFormulario();
      await cargarProductos();
      if (typeof cargarCatalogo === "function") await cargarCatalogo();
      mostrarToast("Producto borrado: " + p.nombre, "warn");
    } catch (e) {
      console.error(e);
      mostrarToast("No se pudo borrar el producto", "warn");
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
    verPestana("datos");
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

  function iniciar() {
    $("btnAjustes").addEventListener("click", abrir);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !$("ajustesModal").classList.contains("hidden")) cerrar();
    });
    $("btnCerrarAjustes").addEventListener("click", cerrar);
    $("ajustesModal").addEventListener("click", e => { if (e.target === $("ajustesModal")) cerrar(); });

    $("pestanaDatos").addEventListener("click", () => verPestana("datos"));
    $("pestanaProductos").addEventListener("click", () => verPestana("productos"));
    $("btnGuardarAjustes").addEventListener("click", guardarAjustes);

    $("cfgLogo").addEventListener("input", verLogo);
    $("cfgLogoPrevia").addEventListener("error", () => {
      $("cfgLogoPrevia").classList.add("hidden");
      mostrarToast("La dirección del logo no carga", "warn");
    });
    $("cfgLogoArchivo").addEventListener("change", e => subirLogo(e.target.files[0]));
    $("btnQuitarLogo").addEventListener("click", () => { $("cfgLogo").value = ""; verLogo(); pintarLogo(); });

    $("cfgPrecio").addEventListener("input", formatearPrecioAlTeclear);
    $("cfgBuscar").addEventListener("input", pintarProductos);
    $("btnNuevoProducto").addEventListener("click", () => abrirFormulario(null));
    $("btnCancelarProducto").addEventListener("click", cerrarFormulario);
    $("btnGuardarProducto").addEventListener("click", guardarProducto);
    $("cfgLista").addEventListener("click", e => {
      const ed = e.target.closest("[data-editar]");
      const bo = e.target.closest("[data-borrar]");
      if (ed) abrirFormulario(ed.dataset.editar);
      if (bo) borrarProducto(bo.dataset.borrar);
    });

    cargar();     // los ajustes se aplican antes de que el usuario cobre
  }

  return { iniciar, abrir, cerrar, cargar, aplicar };
})();
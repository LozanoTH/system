/* =========================================================
   Capa de datos — Firebase Realtime Database
   Lee y escribe en:
     /productos   → catálogo con precios
     /clientes    → directorio de clientes
     /facturas    → facturas emitidas
     /config      → ajustes (folio consecutivo)
   ========================================================= */

const DB = (() => {
  let ref = null;

  function init() {
    if (typeof firebase === "undefined") {
      throw new Error("No se cargó el SDK de Firebase. Revisa la conexión a internet.");
    }
    if (!firebase.apps.length) {
      firebase.initializeApp({ databaseURL: CONFIG.firebase.databaseURL });
    }
    ref = firebase.database().ref();
    return ref;
  }

  function nodo(ruta) {
    if (!ref) init();
    return ref.child(ruta);
  }

  /** Genera una clave segura (RTDB no admite . # $ [ ] /) */
  function nuevaClave() {
    return nodo("_tmp").push().key;
  }

  function leer(ruta) {
    return nodo(ruta).once("value").then(s => s.val());
  }

  /** Escucha cambios en tiempo real. Devuelve la función para cancelar. */
  function escuchar(ruta, callback, onError) {
    const manejar = snap => callback(snap.val());
    nodo(ruta).on("value", manejar, onError);
    return () => nodo(ruta).off("value", manejar);
  }

  function guardar(ruta, valor) {
    return nodo(ruta).set(valor);
  }

  function guardarUno(ruta, clave, valor) {
    if (valor === undefined) throw new Error("guardarUno necesita un valor (falta el argumento).");
    return nodo(ruta).child(clave).set(valor);
  }

  function actualizar(ruta, clave, cambios) {
    return nodo(ruta).child(clave).update(cambios);
  }

  function borrar(ruta, clave) {
    return nodo(ruta).child(clave).remove();
  }

  /* ---------- Colecciones ---------- */

  /** Convierte el objeto de RTDB en arreglo ordenado */
  function aLista(valor, campoOrden = "creado") {
    if (!valor) return [];
    return Object.keys(valor).map(k => ({ id: k, ...valor[k] }));
  }

  const productos = {
    todos: () => leer(CONFIG.rutas.productos).then(v => DB.aLista(v, "nombre")),
    guardar(id, producto) {
      const clave = id || nuevaClave();
      return guardarUno(CONFIG.rutas.productos, clave, { ...producto, actualizado: new Date().toISOString() })
        .then(() => clave);
    },
    borrar: (id) => borrar(CONFIG.rutas.productos, id),
    escuchar: (cb, err) => escuchar(CONFIG.rutas.productos, v => cb(DB.aLista(v)), err)
  };

  const clientes = {
    todos: () => leer(CONFIG.rutas.clientes).then(v => DB.aLista(v)),
    guardar(id, cliente) {
      const clave = id || nuevaClave();
      return guardarUno(CONFIG.rutas.clientes, clave, { ...cliente, actualizado: new Date().toISOString() })
        .then(() => clave);
    },
    borrar: (id) => borrar(CONFIG.rutas.clientes, id),
    escuchar: (cb, err) => escuchar(CONFIG.rutas.clientes, v => cb(DB.aLista(v)), err)
  };

  const facturas = {
    todos: () => leer(CONFIG.rutas.facturas).then(v => DB.aLista(v, "fecha")),
    guardar(id, factura) {
      const clave = id || nuevaClave();
      return guardarUno(CONFIG.rutas.facturas, clave, factura).then(() => clave);
    },
    borrar: (id) => borrar(CONFIG.rutas.facturas, id),
    escuchar: (cb, err) => escuchar(CONFIG.rutas.facturas, v => cb(DB.aLista(v)), err),

    /** Siguiente folio consecutivo usando /config/contador */
    siguienteFolio() {
      const ruta = CONFIG.rutas.config + "/contadorFactura";
      return nodo(ruta).transaction(actual => (Number(actual) || 0) + 1);
    }
  };

  return {
    init, leer, guardar, guardarUno, actualizar, borrar, escuchar, aLista, nuevaClave,
    productos, clientes, facturas,
    raw: () => ref
  };
})();
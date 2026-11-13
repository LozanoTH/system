/* =========================================================
   Capa de datos — Firebase Realtime Database
   Lee y escribe en:
     /productos   → catálogo con precios
     /clientes    → directorio de clientes
     /facturas    → facturas emitidas
     /config      → ajustes (folio consecutivo)

   Además guarda una copia local de lo que se lee para que la
   app siga abriendo sin internet: Firebase habla por WebSocket
   y un service worker no puede cachear eso, así que la copia
   vive en localStorage (la primera carga con red la deja lista).
   ========================================================= */

const DB = (() => {
  let ref = null;
  let enLinea = null;        /* null = todavía no se sabe */

  const COPIA = "pos-copia-v1";
  const MAX_COPIAS = 12;          /* rutas guardadas, no bytes */

  function init() {
    if (typeof firebase === "undefined") {
      throw new Error("No se cargó el SDK de Firebase. Revisa la conexión a internet.");
    }
    if (!firebase.apps.length) {
      firebase.initializeApp({ databaseURL: CONFIG.firebase.databaseURL });
    }
    ref = firebase.database().ref();
    vigilarConexion();
    return ref;
  }

  /* Firebase avisa por .info/connected: con eso se sabe si una lectura va a
     responder o si conviene mostrar de una vez la copia local. */
  let vigilandoConexion = false;
  function vigilarConexion() {
    if (vigilandoConexion) return;
    vigilandoConexion = true;
    try {
      ref.child(".info/connected").on("value", s => {
        enLinea = s.val() === true;
        if (enLinea) avisadoSinRed = false;
      });
    } catch (e) { /* el aviso de conexión es opcional */ }
  }

  function nodo(ruta) {
    if (!ref) init();
    return ref.child(ruta);
  }

  /** Genera una clave segura (RTDB no admite . # $ [ ] /) */
  function nuevaClave() {
    return nodo("_tmp").push().key;
  }

  /* ---------- copia local para trabajar sin conexión ---------- */

  /* Solo lo que se consulta seguido y no cambia en cada venta.
     Las facturas no se copian: son las más pesadas y, sin red, no se
     puede emitir una de todos modos. */
  /* Las rutas llegan como "productos" o "config/ajustes": se comparan
     sin barras para no depender de cómo se escribieron. */
  const valeCachear = ruta => /^(productos|clientes|config(\/|$))/.test(String(ruta).replace(/^\/+|\/+$/g, ""));
  const clave = ruta => COPIA + ":" + ruta;

  let avisadoSinRed = false;

  function guardarCopia(ruta, valor) {
    try {
      localStorage.setItem(clave(ruta), JSON.stringify({ t: Date.now(), v: valor }));
    } catch (e) {
      /* Cuota llena: se sueltan las copias más viejas y se reintenta una vez */
      soltarCopias(2);
      try { localStorage.setItem(clave(ruta), JSON.stringify({ t: Date.now(), v: valor })); } catch (e2) { /* ya no cabe */ }
    }
    ordenarCopias();
  }

  function leerCopia(ruta) {
    try {
      const crudo = localStorage.getItem(clave(ruta));
      return crudo ? JSON.parse(crudo).v : undefined;
    } catch (e) {
      return undefined;
    }
  }

  function todasLasCopias() {
    return Object.keys(localStorage)
      .filter(k => k.startsWith(COPIA + ":"))
      .map(k => ({ k, t: +(JSON.parse(localStorage.getItem(k) || "{}").t || 0) }))
      .sort((a, b) => a.t - b.t);
  }

  function soltarCopias(cuantas) {
    for (const c of todasLasCopias().slice(0, cuantas)) localStorage.removeItem(c.k);
  }

  /** Se queda con las MAX_COPIAS más recientes */
  function ordenarCopias() {
    const sobrantes = todasLasCopias().slice(0, Math.max(0, todasLasCopias().length - MAX_COPIAS));
    for (const c of sobrantes) localStorage.removeItem(c.k);
  }

  /* «Sin conexión» y «la base no respondió» son cosas distintas: con internet
     pero Firebase caído, el aviso equivocado manda a revisar el WiFi. */
  function avisarCopia(motivo) {
    if (avisadoSinRed || typeof mostrarToast !== "function") return;
    avisadoSinRed = true;
    mostrarToast(
      motivo === "red"
        ? "Sin conexión: se muestran los últimos datos guardados en este equipo"
        : "La base no respondió: se muestran los últimos datos guardados",
      "warn"
    );
  }

  /* Con la conexión caída Firebase no siempre rechaza: la promesa se queda
     esperando. Sin este tope, «Cobrar» quedaría cargando eternamente y los
     botones de guardar, en «Guardando…». Aquí cada operación falla pronto y
     el flujo ya sabe qué aviso poner. */
  function conTiempo(promesa, ms, mensaje) {
    return new Promise((resolve, reject) => {
      const reloj = setTimeout(() => reject(new Error(mensaje)), ms);
      promesa.then(
        valor => { clearTimeout(reloj); resolve(valor); },
        error => { clearTimeout(reloj); reject(error); }
      );
    });
  }

  const TIEMPO_LECTURA = 9000;
  const TIEMPO_ESCRITURA = 12000;

  /* La lectura normal va a Firebase y, si responde, deja copia.
     Si no hay red se sirve la copia del equipo, sin esperar en balde. */
  function leer(ruta) {
    const copia = valeCachear(ruta) ? leerCopia(ruta) : undefined;

    const red = conTiempo(nodo(ruta).once("value"), TIEMPO_LECTURA, "la base no respondió")
      .then(s => {
        if (valeCachear(ruta)) guardarCopia(ruta, s.val());
        return s.val();
      })
      .catch(e => {
        if (copia === undefined) throw e;
        avisarCopia(e.message === "la base no respondió" && navigator.onLine !== false ? "base" : "red");
        return copia;
      });

    /* Sin red confirmada se responde de una vez con la copia. Si hay internet,
       el socket de Firebase puede tardar unos segundos: mejor esperar los
       datos frescos que mostrar un catálogo viejo diciendo que no hay red. */
    if (copia !== undefined && enLinea === false && navigator.onLine === false) {
      avisarCopia("red");
      return Promise.resolve(copia);
    }
    return red;
  }

  /** Escucha cambios en tiempo real. Devuelve la función para cancelar. */
  function escuchar(ruta, callback, onError) {
    const manejar = snap => callback(snap.val());
    nodo(ruta).on("value", manejar, onError);
    return () => nodo(ruta).off("value", manejar);
  }

  function guardar(ruta, valor) {
    return conTiempo(nodo(ruta).set(valor), TIEMPO_ESCRITURA, "no se pudo escribir en la base");
  }

  function guardarUno(ruta, clave, valor) {
    if (valor === undefined) throw new Error("guardarUno necesita un valor (falta el argumento).");
    return conTiempo(nodo(ruta).child(clave).set(valor), TIEMPO_ESCRITURA, "no se pudo escribir en la base");
  }

  function actualizar(ruta, clave, cambios) {
    return conTiempo(nodo(ruta).child(clave).update(cambios), TIEMPO_ESCRITURA, "no se pudo escribir en la base");
  }

  function borrar(ruta, clave) {
    return conTiempo(nodo(ruta).child(clave).remove(), TIEMPO_ESCRITURA, "no se pudo borrar de la base");
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
      return conTiempo(nodo(ruta).transaction(actual => (Number(actual) || 0) + 1), 8000, "sin respuesta al pedir el folio");
    }
  };

  return {
    init, leer, guardar, guardarUno, actualizar, borrar, escuchar, aLista, nuevaClave,
    productos, clientes, facturas,
    raw: () => ref
  };
})();
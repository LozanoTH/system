/* =========================================================
   LED — indica si la Realtime Database está activa
   ========================================================= */

const LED = (() => {
  const $ = id => document.getElementById(id);
  const INTERVALO = 15000;      // cada cuánto se verifica la base

  let activo = false;           // hay un latido en curso
  let enlace = null;            // valor de .info/connected (socket de Firebase)
  let pendiente = null;         // temporizador del próximo latido
  let ultimoOK = 0;             // marca de tiempo del último acierto

  /* ---------- Pintado ---------- */
  function estado(clase, titulo, mensaje) {
    $("led").className = "led led-" + clase;      // .led-activa, .led-inactiva, …
    $("led-titulo").textContent = titulo;
    $("led-mensaje").textContent = mensaje;
  }

  function sellar(ms) {
    ultimoOK = Date.now();
    $("led-latencia").textContent = ms + " ms";
    $("led-hora").textContent = new Date().toLocaleTimeString("es-CO");
  }

  function programar() {
    clearTimeout(pendiente);
    pendiente = setTimeout(latido, INTERVALO);
  }

  /* ---------- Latido: una lectura real a la base ---------- */
  async function latido() {
    if (activo) return;
    if (enlace === false) { desconectado(); return; }   // el socket está caído: no disimular
    activo = true;
    if (!ultimoOK) estado("conectando", "Conectando con la base de datos…", "Verificando la conexión…");

    try {
      const t0 = Date.now();
      await DB.leer(CONFIG.rutas.config);      // lectura ligera: prueba de vida
      const ms = Date.now() - t0;
      enlace = true;

      if (!navigator.onLine) {
        estado("apagada", "Sin internet", "El navegador no tiene red. Enciéndala para volver a sincronizar.");
        return;
      }

      sellar(ms);
      estado("activa", "Base de datos activa", "Firebase Realtime Database respondió correctamente.");
      programar();
    } catch (e) {
      estado("inactiva", "Base de datos inactiva", e.message || "No hubo respuesta de Firebase.");
      programar();
    } finally {
      activo = false;
    }
  }

  /* ---------- Desconexión y falta de internet ---------- */
  function desconectado() {
    enlace = false;
    if (navigator.onLine) {
      estado("inactiva", "Base de datos inactiva", "Firebase cerró la conexión. Reintentando…");
    } else {
      estado("apagada", "Sin internet", "Sin red no hay base de datos. El LED se enciende solo al volver.");
    }
    ultimoOK = 0;
    $("led-latencia").textContent = "—";
    $("led-hora").textContent = "—";
    programar();
  }

  /* ---------- Arranque ---------- */
  function iniciar() {
    $("led-url").textContent = CONFIG.firebase.databaseURL;
    $("led-online").textContent = navigator.onLine ? "Sí" : "No";

    /* Solo el evento «online» (volvió la red) autoriza reintentar a ciegas.
       .info/connected manda: si el socket está caído, no se disimula. */
    window.addEventListener("online", () => {
      $("led-online").textContent = "Sí";
      enlace = null;          // ya no vale el «caído» anterior: probar de verdad
      ultimoOK = 0;
      latido();
    });
    window.addEventListener("offline", () => {
      $("led-online").textContent = "No";
      desconectado();
    });
    $("btn-led").addEventListener("click", () => { ultimoOK = 0; enlace = null; latido(); });

    try {
      DB.init();
    } catch (e) {
      estado("inactiva", "Base de datos inactiva", e.message);
      return;
    }

    /* .info/connected avisa al instante si se corta el enlace */
    DB.raw().child(".info/connected").on("value",
      snap => { snap.val() === true ? (enlace = true, latido()) : desconectado(); },
      err => { estado("inactiva", "Base de datos inactiva", err.message); programar(); });

    /* Primer intento, solo si hay internet */
    if (navigator.onLine) latido(); else desconectado();
  }

  return { iniciar, comprobar: latido };
})();

document.addEventListener("DOMContentLoaded", LED.iniciar);
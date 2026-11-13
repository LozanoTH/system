/* =========================================================
   Utilidades de interfaz
   Escapado de HTML, formato de dinero y fechas, avisos
   en pantalla y el diálogo de confirmación que sustituye
   a window.confirm.
   ========================================================= */

/* Estado del diálogo: qué botón lo abrió y si hay una pregunta pendiente. */
const confirmacion = { origen: null, pendiente: null };

const UI = {
  /** Escapa HTML para evitar inyección en las tablas */
  esc(valor) {
    if (valor === null || valor === undefined) return "";
    return String(valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  /** $1.234.56 — usa los decimales definidos en CONFIG.moneda */
  dinero(valor) {
    const n = Number(valor) || 0;
    const dec = CONFIG.moneda.decimales ?? 2;
    return CONFIG.moneda.simbolo + n.toLocaleString(CONFIG.moneda.locale, {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec
    });
  },

  /** "2 oct 2026" */
  fecha(iso) {
    if (!iso) return "—";
    const [a, m, d] = String(iso).split("-");
    if (!a || !m || !d) return iso;
    const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `${Number(d)} ${meses[Number(m) - 1]} ${a}`;
  },

  /** Fecha y hora legible desde un timestamp ISO */
  fechaHora(iso) {
    if (!iso) return "—";
    const base = UI.fecha(String(iso).slice(0, 10));
    const hora = String(iso).slice(11, 16);
    return hora ? `${base} · ${hora}` : base;
  },

  /** Normaliza texto para búsquedas: sin mayúsculas ni tildes */
  /* Para comparar: sin mayúsculas, sin tildes y con los espacios
     de siempre. Si no, buscar "cafe  molido" (dos espacios, muy fácil
     deTeclear) no encontraría "café molido". */
  normalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  },

  /* ---------- diálogo de confirmación ----------
     Reemplaza a window.confirm: se ve como el resto de la
     aplicación, admite dos botones y devuelve una promesa. */

  confirmar(opciones = {}) {
    const {
      titulo = "¿Está seguro?",
      mensaje = "",
      detalle = "",
      ok = "Confirmar",
      cancelar = "Cancelar",
      peligro = false
    } = opciones;

    const modal = document.getElementById("confirmModal");
    const icono = document.getElementById("confirmIcono");
    const textoDetalle = document.getElementById("confirmDetalle");
    const aceptar = document.getElementById("confirmAceptar");
    const cancelarBtn = document.getElementById("confirmCancelar");

    document.getElementById("confirmTitulo").textContent = titulo;
    document.getElementById("confirmMensaje").textContent = mensaje;
    textoDetalle.textContent = detalle;
    textoDetalle.classList.toggle("hidden", !detalle);

    /* el color del botón y del icono avisan de lo que se está a punto de pasar */
    aceptar.textContent = ok;
    aceptar.className = "px-3 py-1.5 text-[11px] font-medium rounded text-white " +
      (peligro
        ? "bg-rose-600 hover:bg-rose-700"
        : "bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 dark:text-slate-900");
    cancelarBtn.textContent = cancelar;
    icono.className = "shrink-0 w-8 h-8 rounded-full flex items-center justify-center " +
      (peligro
        ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
        : "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400");
    icono.firstElementChild.className = "fa-solid text-sm " + (peligro ? "fa-trash-can" : "fa-circle-question");

    /* si se pide otro diálogo mientras este sigue abierto, el primero
       se da por cancelado: nunca quedan dos diálogos encima */
    if (confirmacion.pendiente) confirmacion.pendiente(false);

    return new Promise(resolve => {
      confirmacion.pendiente = resolve;

      const cerrar = respuesta => {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
        document.removeEventListener("keydown", teclas, true);
        confirmacion.pendiente = null;
        if (confirmacion.origen && confirmacion.origen.focus) confirmacion.origen.focus();
        resolve(respuesta);
      };

      const teclas = e => {
        if (e.key === "Escape") { e.stopPropagation(); cerrar(false); return; }
        /* el foco no se sale del diálogo: solo hay dos botones */
        if (e.key === "Tab") {
          e.preventDefault();
          (document.activeElement === aceptar ? cancelarBtn : aceptar).focus();
        }
      };

      confirmacion.origen = document.activeElement;
      modal.onclick = e => { if (e.target === modal) cerrar(false); };
      document.addEventListener("keydown", teclas, true);
      aceptar.onclick = () => cerrar(true);
      cancelarBtn.onclick = () => cerrar(false);

      modal.classList.remove("hidden");
      modal.classList.add("flex");
      /* en una acción de riesgo el foco arranca en Cancelar:
         Enter no debe borrar nada por descuido */
      (peligro ? cancelarBtn : aceptar).focus();
    });
  }
};

/* =========================================================
   Avisos en pantalla
   Los usa toda la aplicación; reemplazan a alert().
   ========================================================= */

/** Aviso corto. Los graves se quedan más tiempo y se pueden cerrar a mano. */
function mostrarToast(mensaje, tipo = "ok") {
  const contenedor = document.getElementById("toastContainer");
  if (!contenedor) return;

  const icono = { ok: "fa-circle-check", info: "fa-circle-info", warn: "fa-triangle-exclamation", err: "fa-circle-exclamation" };
  const estilo = { ok: "toast-ok", info: "toast-info", warn: "toast-warn", err: "toast-err" };

  const t = document.createElement("div");
  t.className = "toast " + (estilo[tipo] || estilo.ok);
  t.innerHTML = '<i class="fa-solid ' + (icono[tipo] || icono.ok) + '" aria-hidden="true"></i>' +
                '<span class="toast-texto"></span>' +
                '<button type="button" class="toast-x" aria-label="Cerrar aviso"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>';
  t.querySelector(".toast-texto").textContent = mensaje;
  contenedor.appendChild(t);

  let tiempo = null;
  const cerrar = () => {
    clearTimeout(tiempo);
    t.classList.add("toast-saliente");
    t.addEventListener("transitionend", () => t.remove(), { once: true });
    /* si el navegador no dispara la transición, no se queda pegado */
    setTimeout(() => t.remove(), 400);
  };

  t.querySelector(".toast-x").addEventListener("click", cerrar);
  t.addEventListener("click", cerrar);
  tiempo = setTimeout(cerrar, tipo === "ok" || tipo === "info" ? 2600 : 5000);

  /* si se acumulan, no se apilan sin límite */
  while (contenedor.children.length > 4) contenedor.firstElementChild.remove();
  return t;
}
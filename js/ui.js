/* =========================================================
   Utilidades de interfaz
   ========================================================= */

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

  /** 1234.56 (sin símbolo) */
  numero(valor, decimales = 2) {
    const n = Number(valor) || 0;
    return n.toLocaleString(CONFIG.moneda.locale, {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales
    });
  },

  /** yyyy-mm-dd */
  hoy() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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

  toast(mensaje, tipo = "ok") {
    const cont = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = "toast " + tipo;
    el.textContent = mensaje;
    cont.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity .25s";
      setTimeout(() => el.remove(), 250);
    }, 2600);
  },

  vacio(tbody, mensaje, sub) {
    tbody.innerHTML = `
      <tr><td colspan="99" style="text-align:center;color:var(--muted);padding:28px">
        ${UI.esc(mensaje)}${sub ? `<br><small>${UI.esc(sub)}</small>` : ""}
      </td></tr>`;
  },

  /** Normaliza texto para búsquedas */
  normalizar(texto) {
    return String(texto || "").toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  },

  /** Puntúa qué tanto coincide un texto con la consulta. 0 = no coincide. */
  puntuar(texto, consulta) {
    const t = UI.normalizar(texto).trim();
    const c = UI.normalizar(consulta).trim();
    if (!t || !c) return 0;
    if (t === c) return 100;
    if (t.startsWith(c)) return 80;

    const palabras = t.split(/[^a-z0-9]+/).filter(Boolean);
    const partes = c.split(/\s+/).filter(Boolean);
    if (!palabras.length) return 0;

    // Varias palabras: se exige que todas aparezcan (por inicio de palabra).
    // El crédito parcial solo satura la lista de resultados, así que no se da.
    if (partes.length > 1) {
      return partes.every(p => palabras.some(w => w.startsWith(p))) ? 55 : 0;
    }

    const i = t.indexOf(c);
    return i > 0 ? 65 - Math.min(i, 20) : 0;
  },

  /** Resalta en el texto la parte que coincide con la consulta */
  resaltar(texto, consulta) {
    const original = String(texto || "");
    const c = UI.normalizar(consulta).trim();
    if (!c) return UI.esc(original);
    const sinAcento = original.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const i = sinAcento.indexOf(c);
    if (i === -1) return UI.esc(original);
    return UI.esc(original.slice(0, i)) + "<mark>" + UI.esc(original.slice(i, i + c.length)) + "</mark>" + UI.esc(original.slice(i + c.length));
  },

  /** A, B, … Z, AA, AB… para los encabezados de columna */
  letraColumna(indice) {
    let n = indice + 1;
    let texto = "";
    while (n > 0) {
      const resto = (n - 1) % 26;
      texto = String.fromCharCode(65 + resto) + texto;
      n = Math.floor((n - 1) / 26);
    }
    return texto;
  },

  /** Pone letras de columna y números de fila, estilo hoja de cálculo */
  decorarTabla(tabla) {
    const thead = tabla.querySelector("thead tr");
    if (!thead) return;

    if (tabla.dataset.decorada !== "1") {
      const esquina = document.createElement("th");
      esquina.className = "col-esquina";
      thead.prepend(esquina);
      [...thead.querySelectorAll("th:not(.col-esquina)")].forEach((th, i) => {
        const letra = document.createElement("th");
        letra.className = "col-letras";
        letra.textContent = UI.letraColumna(i);
        th.before(letra);
      });
      tabla.dataset.decorada = "1";
    }

    tabla.querySelectorAll("tbody tr").forEach((fila, i) => {
      if (fila.dataset.numFila === "1") return;
      if (fila.children.length < 2) return;   // fila de mensaje
      const celda = document.createElement("td");
      celda.className = "num-fila";
      celda.textContent = String(i + 1);
      fila.prepend(celda);
      fila.dataset.numFila = "1";
    });
  },

  /** Vigila las tablas y las decora cada vez que se redibujan */
  observarTablas() {
    if (!("MutationObserver" in window)) {
      document.querySelectorAll("table.excel").forEach(t => UI.decorarTabla(t));
      return;
    }
    const obs = new MutationObserver(cambios => {
      if (!cambios.some(c => c.type === "childList" && c.addedNodes.length)) return;
      const tabla = cambios[0].target.closest("table");
      if (tabla) UI.decorarTabla(tabla);
    });
    document.querySelectorAll("table.excel").forEach(tabla => {
      UI.decorarTabla(tabla);
      obs.observe(tabla.querySelector("tbody"), { childList: true });
    });
  },

  /** Marca una fila por unos segundos para localizar el registro */
  resaltarFila(tbody, texto) {
    if (!tbody) return;
    const fila = [...tbody.querySelectorAll("tr")]
      .find(tr => UI.normalizar(tr.textContent).includes(UI.normalizar(texto)));
    if (!fila) return;
    fila.classList.add("resaltado");
    try { fila.scrollIntoView({ block: "nearest" }); } catch (e) { /* noop */ }
    setTimeout(() => fila.classList.remove("resaltado"), 2800);
  },

  confirm(mensaje) {
    return window.confirm(mensaje);
  }
};
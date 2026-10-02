/* =========================================================
   Configuración global
   Cambia aquí la moneda, el impuesto por defecto y la URL
   de tu Realtime Database.
   ========================================================= */

const CONFIG = {
  firebase: {
    databaseURL: "https://systena-de-fact-default-rtdb.firebaseio.com/"
    // Si tu proyecto usa autenticación, agrega aquí apiKey y authDomain.
  },

  moneda: {
    locale: "es-CO",
    codigo: "COP",
    simbolo: "$",
    decimales: 0
  },

  impuestoDefecto: 0,        /* cámbialo aquí si necesitas otro valor por defecto */

  empresa: {
    nombre: "Mi Empresa S.A.S.",
    rfc: "900.123.456-7",
    direccion: "Calle 100 #45-30, Bogotá",
    correo: "facturacion@miempresa.co",
    telefono: "+57 601 000 0000"
  },

  /* Rutas dentro de la base de datos */
  rutas: {
    productos: "productos",
    clientes: "clientes",
    facturas: "facturas",
    config: "config"
  }
};
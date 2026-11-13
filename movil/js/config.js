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
    telefono: "+57 601 000 0000",
    sucursal: "Oficina Principal",   /* el nombre que va tras «Bienvenido a» */
    ciudad: "",                      /* BUENAVENTURA, Medellín… */
    regimen: "Común"                 /* Común, Simplificado… */
  },

  /* Documento que se imprime y datos del punto de venta */
  documento: {
    titulo: "Factura de Venta P.O.S.",
    cajero: "",
    pos: "",
    prefijo: "POS"
  },

  /* Autorización DIAN para facturación P.O.S. (opcional) */
  dian: {
    autorizacion: "",
    fecha: "",
    desde: "",
    hasta: "",
    vigenciaMeses: "",
    vigenciaHasta: ""
  },

  /* Impuestos adicionales en porcentaje sobre el valor bruto (0 = no aplican) */
  otrosImpuestos: {
    impoconsumo: 0,
    ico: 0,
    inc: 0
  },

  /* Pie del ticket */
  pie: {
    mensaje: "¡Gracias por su compra!",
    software: "www.conexionpos.com"
  },

  /* Rutas dentro de la base de datos */
  rutas: {
    productos: "productos",
    clientes: "clientes",
    facturas: "facturas",
    config: "config"
  }
};
# Sistema de Facturación (HTML + CSS + JS + Firebase)

Sistema básico de facturación en el navegador. No requiere servidor ni build: abre `index.html` y funciona.

Los precios (catálogo), los clientes y las facturas se **guardan y se cargan desde Firebase Realtime Database**, de modo que los datos se comparten entre dispositivos y sobreviven al cerrar el navegador.

## Estructura

```
index.html
css/styles.css        Estilos, tema de hoja de cálculo y hoja de impresión
js/config.js          URL de Firebase, moneda, impuesto por defecto y datos de la empresa
js/ui.js              Helpers: escape, dinero/fechas, toasts, puntaje de búsqueda, decoración de tablas
js/db.js              Capa de datos (productos, clientes, facturas, folio consecutivo)
js/productos.js       CRUD de productos y precios
js/clientes.js        CRUD de clientes
js/facturas.js        Conceptos, cálculos, emisión y documento imprimible
js/buscador.js        Buscador global de la barra superior
js/app.js             Navegación y arranque
```

## Barra de búsqueda

Está fija arriba (`position: sticky`), visible en todas las pestañas.

- **Busca mientras escribes**, sobre productos, clientes y facturas (folio, cliente y conceptos).
- Los resultados van agrupados por tipo y la parte que coincide se resalta.
- **Enter completa** el input con lo encontrado, cambia a la pantalla correspondiente, deja el texto en el filtro de esa tabla y resalta la fila.
- **Flechas** mueven la selección, **Enter** acepta, **Esc** cierra.
- **Ctrl+K** o **/** enfoca el buscador sin soltar el ratón.
- Si no hay coincidencias, Enter filtra la lista de la pantalla actual.

## Estilo hoja de cálculo

La app usa el tema de Excel de punta a punta:

- Fondo blanco, rejilla gris y el verde `#217346` de Excel como color de marca.
- Productos, clientes y facturas son hojas de cálculo: encabezado verde fijo al hacer scroll, letras de columna (A, B, C…), número de fila, cuadrícula en todas las celdas y filas alternas.
- La tabla de conceptos de la factura conserva su formato normal porque es editable.
- Todos los contrastes cumplen mínimo 4.5:1 (texto 15.8:1, encabezado 6.5:1).

Para volver al tema oscuro, reemplaza el bloque `:root` de `css/styles.css`.

## Cómo usarlo

1. Abre `index.html` en el navegador (doble clic) o sírvelo con cualquier servidor estático:
   `python3 -m http.server 8000` y abre `http://localhost:8000`.
2. Pestaña **Productos y precios** → agrega el catálogo. Se guarda cada precio.
3. Pestaña **Clientes** → registra a quién le facturas.
4. Pestaña **Facturas** → elige cliente, agrega conceptos desde el catálogo, ajusta cantidad/descuento/impuesto y emite.
5. El botón **Ver** abre el documento; **Imprimir / PDF** genera el PDF con el diálogo del navegador.

## Cálculo de totales

Por cada concepto:

```
base      = cantidad × precio
base      = base − (base × descuento%)
impuesto  = base × impuesto%
importe   = base + impuesto
```

La factura suma los importes: subtotal (bases), descuentos, impuestos y total.

## Datos en Firebase

```
/productos/{clave}   { nombre, precio, impuesto, unidad, creado }
/clientes/{clave}    { nombre, rfc, email, direccion, creado }
/facturas/{clave}    { folio, fecha, vencimiento, cliente*, items[], base, descuento, impuestos, total }
/config/contadorFactura  Número consecutivo del folio
```

Se escuchan con `on('value')`, así que si otro dispositivo (u otra pestaña) cambia un precio, la tabla se actualiza sola.

## Configuración

Todo lo editable está en `js/config.js`:

| Clave | Qué hace |
|---|---|
| `firebase.databaseURL` | URL de tu Realtime Database |
| `moneda` | `locale`, `codigo`, `simbolo` y `decimales` del importe (por defecto COP sin decimales: `$32.000`) |
| `impuestoDefecto` | Porcentaje que se aplica a los conceptos nuevos (19 % = IVA Colombia) |
| `empresa` | Nombre, NIT/RFC, dirección, correo y teléfono del emisor (aparece en la factura impresa) |
| `rutas` | Nombres de las colecciones dentro de la base |

Para volver a MXN: `locale: "es-MX"`, `codigo: "MXN"`, `decimales: 2`.

### Notas sobre la base de datos

- Tu base actualmente responde con reglas públicas de lectura/escritura. Antes de usarla con datos reales, configura las reglas en Firebase Console, por ejemplo:

```json
{
  "rules": {
    "productos": { ".read": true, ".write": true },
    "clientes":  { ".read": true, ".write": true },
    "facturas":  { ".read": true, ".write": true },
    "config":    { ".read": true, ".write": true }
  }
}
```

- Si tu proyecto requiere autenticación, agrega `apiKey` y `authDomain` en `CONFIG.firebase` y llama a `firebase.auth().signIn…` antes de `DB.init()`.

## Límites de esta versión

Sin login ni roles, sin inventario, sin pagos ni notas de crédito, y los folios se numeran de forma consecutiva pero no tienen validity fiscal. Es una base funcional para crecer.
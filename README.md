# POS de Facturación (HTML + CSS + JS + Firebase)

## demo

https://lozanoth.github.io/system/

Punto de venta que funciona en el navegador: **cobrar es imprimir**. No hay build ni servidor; abre `index.html` y vende.

El catálogo, los clientes y las facturas se **guardan en Firebase Realtime Database**, así que los datos se comparten entre dispositivos y sobreviven al cerrar el navegador.

## Estructura

```
index.html            Pantalla del POS (Tailwind por CDN) y hoja de impresión
manifest.webmanifest  Datos de instalación: nombre, iconos, colores y acceso directo a Ajustes
sw.js                 Service worker: qué se guarda para abrir la app sin internet
icons/                Iconos de la app (192, 512, maskable y el de Apple)
js/config.js          Moneda, impuesto por defecto, datos de la empresa, rutas de Firebase
js/db.js              Capa de datos: productos, clientes, facturas y folio consecutivo
js/ui.js              Helpers: escapado de HTML, dinero, fechas, normalizar para buscar
js/ajustes.js         Logo, datos del emisor, IVA y CRUD del catálogo
js/pos.js             Buscador, carrito, totales, cobro e impresión
```

## Cobrar

Un solo botón, **Cobrar e imprimir** (también `F4`). No hay pantalla de confirmación en el medio:

1. Asigna el folio consecutivo (`/config/contadorFactura`).
2. Guarda la factura con `estado: "pagada"`.
3. Muestra la factura ya emitida —con folio, fecha, cliente y la unidad de cada producto— y lanza el diálogo de impresión.
4. Al cerrarse la impresión la venta termina sola: el carrito se vacía, el cliente vuelve a "Consumidor Final" y el foco regresa al buscador.

Si no hay folio o no se puede guardar, **no se imprime nada** y la venta se queda en pantalla para poder cobrarla de nuevo: es preferible un aviso a entregar un papel sin número o perder la venta.

La factura impresa lleva una columna **Unidad** (`pieza`, `botella`, `libro`…) para que quede claro qué se vendió y en qué presentación. En pantalla esa columna se ve desde 640px; en móvil, donde la tabla es más ancha que el papel, se oculta y el papel se desplaza en horizontal para no cortar nada. Al imprimir siempre sale, sin importar el tamaño de la pantalla desde la que se imprima.

**Atajos**

| Tecla | Qué hace |
|---|---|
| `F2` | Ir al buscador |
| `↑` `↓` | Mover la fila del carrito |
| `←` `→` | Cambiar la cantidad de la fila marcada |
| `Supr` | Quitar la fila marcada |
| `Enter` | Agregar el producto resaltado / volver al buscador |
| `Esc` | Cerrar el buscador o terminar la venta |
| `F3` | Enfocar el carrito (`Shift+F3` va a la última fila) |
| `F4` | Cobrar e imprimir |

La venta en curso se guarda en `localStorage`: recargar el navegador no la pierde, y los precios se ajustan a los del catálogo vigente al recuperar el borrador.

## La pantalla manda: tamaño y adaptación

Todo el texto sale de una sola variable, al principio del segundo bloque `<style>` de `index.html`:

```css
:root { --texto: clamp(14px, 0.55vw + 7px, 18px); }
```

El `clamp` hace que la letra siga a la pantalla: 14px en un celular, unos 15px en un monitor de mostrador y hasta 18px en pantallas grandes, sin que haya que tocar nada ni forzar el zoom. Para dejar una letra fija, reemplaza la expresión por un valor (`15px`, `17px`): los botones de cantidad, la columna de cantidad y los alto de lista ya están dimensionados para crecer con ella.

Además, cada parte se acomoda a lo que hay:

- **El buscador también busca por unidad**: el texto de búsqueda es nombre + código + unidad, así que `pieza`, `botella`, `libro` o `paquete` encuentran lo que se busca por cómo se vende. Ignora mayúsculas, tildes y acentos (`BOTELLA` y `botella` dan lo mismo). En pantalla la tarjeta muestra la unidad en una etiqueta al lado del nombre y en el `title`; en el catálogo de Ajustes el filtro funciona igual. Los espacios también sobran: `UI.normalizar()` deja un solo espacio entre palabras y quita los de los bordes, así que `cafe  molido` (dos espacios, tecleado sin querer) encuentra lo mismo que `café molido`, y un campo con nada más espacios se lee como búsqueda vacía en vez de «no encontré nada».
- **Resultados del buscador**: 1 columna en móvil, 2 desde 640px, 3 desde 1280px y 4 desde 1536px; su alto cede espacio al carrito (`max-h` con `dvh` y más tope en pantallas bajas) para que la lista de la venta nunca quede sin espacio.
- **Panel de la venta**: estira la caja de la tabla y el encabezado queda fijo al desplazar, así que con 50 productos se sigue viendo en qué artículo se está.
- **Panel de totales**: los totales se centran en el espacio sobrante y el botón **Cobrar e imprimir** queda siempre pegado abajo; en pantallas muy bajas el panel se desplaza solo en vez de cortar el botón.
- **En pantallas táctiles** (`@media (pointer: coarse)`) los botones de cantidad llegan a 44px, que es lo que un dedo encuentra bien; con ratón se mantienen compacto para que la tabla no se convierta en renglones de un metro.
- **En móvil** el código del producto se oculta para dejarle el ancho al nombre, y el nombre se parte en dos líneas con puntos suspensivos: sin cursor no hay `title` que consultar.

Comprobado con Chrome, sin scroll de página ni desbordes horizontales, en 390×844, 500×900, 768×1024, 1024×700, 1280×800, 1366×768, 1440×900, 1600×900, 1920×1080 y 2560×1440.

## Datos en Firebase

```
/productos/{clave}   { nombre, precio, impuesto, unidad, creado }
/clientes/{clave}    { nombre, rfc, email, direccion, creado }
/facturas/{clave}    { folio, fecha, cliente, items[], subtotal, impuesto, descuento, total, estado }
/config/contadorFactura  Número consecutivo del folio
```

El catálogo y el LED de la cabecera se escuchan con `on('value')`: si otro dispositivo o pestaña cambia un precio, la tabla se actualiza sola.

## Configuración

Todo lo editable está en `js/config.js`:

| Clave | Qué hace |
|---|---|
| `firebase.databaseURL` | URL de tu Realtime Database |
| `moneda` | `locale`, `codigo`, `simbolo` y `decimales` del importe (por defecto COP sin decimales: `$32.000`) |
| `impuestoDefecto` | Porcentaje que se aplica a la venta (19 % = IVA Colombia) |
| `empresa` | Nombre, NIT/RFC, dirección, correo y teléfono del emisor (aparecen en la factura) |
| `rutas` | Nombres de las colecciones dentro de la base |

El logo, los datos de la empresa y el IVA se editan también desde **Ajustes** en la app y se aplican al vuelo.

### Ajustes: una pestaña por opción

Cinco pestañas: **Empresa**, **Logo**, **Impuestos**, **Productos** y **Nuevo producto** (esta última también edita). Cada sección de datos tiene su propio botón de guardar, así que no hay que mandar datos de una junto con los de otra. Los ajustes se escriben en el mismo nodo `/config/ajustes`, pero cada guardado solo toca su parte y deja lo demás como estaba. La barra responde a las flechas del teclado, envuelve en dos filas en pantallas pequeñas para que ninguna pestaña quede oculta, y cada panel es un `tabpanel` de verdad (`aria-selected`, `aria-controls`).

El catálogo y el formulario están separados: la lista nunca queda debajo de un formulario abierto.

- Al entrar a **Nuevo producto** el formulario llega vacío con el siguiente código sugerido (`p003`, `p004`…) y el foco en el nombre.
- El pencil de la lista salta a esa pestaña con el producto cargado, el título cambia a «Editar producto» y el código queda bloqueado: es la clave del producto y cambiarlo rompería las ventas ya feitas.
- Al guardar o cancelar se vuelve a **Productos**, que es donde se ve de inmediato el resultado.

Ojo con los atributos `data-*` en HTML: el DOM los guarda en minúsculas, así que un enlace entre pestañas se escribe `data-ir-pestana` y se lee con `dataset.irPestana` (con `data-irPestana` nunca casaría).

El logo se puede pegar por dirección o subir desde el equipo (se guarda en la base como imagen incrustada, hasta 120 KB); si la imagen no carga, se avisa y el marco vuelve a su estado vacío en vez de quedar roto.

### Avisos y confirmación dentro de la app

No hay ni un `alert()` ni un `window.confirm`: todo se muestra en la misma interfaz.

- **Avisos** (`mostrarToast(mensaje, tipo)`): en la esquina, con icono según `ok`, `info`, `warn` o `err`, se pueden cerrar a mano, duran más los graves y no se apilan más de cuatro.
- **Confirmación** (`await UI.confirmar({ titulo, mensaje, detalle, ok, cancelar, peligro })`): devuelve una promesa en vez de bloquear el hilo. `Escape` o el fondo equivalen a *Cancelar*, el foco queda atrapado entre los dos botones y en una acción de riesgo (`peligro: true`) el botón se pone rojo y el foco arranca en *Cancelar*, para que `Enter` no borre nada por descuido.

Se usa para vaciar la lista de la venta en curso y para borrar un producto del catálogo.

Para volver a MXN: `locale: "es-MX"`, `codigo: "MXN"`, `decimales: 2`.

### Notas sobre la base de datos

- Tu base responde con reglas públicas de lectura/escritura. Antes de usarla con datos reales, configura las reglas en Firebase Console, por ejemplo:

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

## Instalable y sin conexión (PWA)

`manifest.webmanifest`, `sw.js` e `icons/` convierten la app en una PWA instalable (Chrome y Edge en escritorio, «Añadir a la pantalla de inicio» en Android) que además abre sin internet.

**Hay que servirla por HTTP o HTTPS**: con `file://` el service worker no se registra, así que la app funciona pero sin caché ni instalación. En el equipo basta con `python3 -m http.server 8899` y abrir `http://127.0.0.1:8899/`; la demo de GitHub Pages ya va por HTTPS.

### Qué se guarda

| Caché | Qué lleva | Cómo responde |
|---|---|---|
| `pos-app-v1` | La pantalla: `index.html` y los `js/` | Service worker primero: contesta de la caché al instante y trae la versión nueva en segundo plano |
| `pos-cdn-v1` | Tailwind, Inter, Font Awesome y el SDK de Firebase | Caché primero: mientras estén guardados no se vuelven a pedir |
| `pos-datos-v1` | Las lecturas HTTP de la base (por ejemplo `productos.json`) | Red primero y, si no hay respuesta, la última copia guardada |

Los datos se duplican además en el propio equipo: cada lectura de `/productos`, `/clientes` y `/config` deja una copia en `localStorage` (`pos-copia-v1:...`, hasta 12 rutas). Sin red, catálogo, clientes y ajustes salen de ahí al instante y se avisa con «Sin conexión: se muestran los últimos datos guardados en este equipo». Esa copia local es necesaria porque Firebase transmite por WebSocket, y un service worker no puede cachear un WebSocket: sin ella, la app abriría sin conexión pero con el catálogo vacío.

Nada de esto permite cobrar sin base. Sin conexión, **Cobrar e imprimir** avisa que no se pudo asignar folio, no saca un papel sin número y deja la venta en pantalla para cobrarla cuando vuelva la red. Las lecturas y escrituras tienen tope de espera (9 s y 12 s) para que ningún botón se quede cargando para siempre.

### Publicar cambios

Al subir una versión nueva, cambia la `VERSION` de `sw.js` (de `v1` a `v2`): al activarse borra las cachés viejas y toma el control. No recarga la página a la fuerza, para no interrumpir una venta en curso; la versión nueva entra en la siguiente carga. Los cambios en los datos sí se ven al instante, porque la app escucha `on('value')`.

## Límites de esta versión

Sin login ni roles, sin inventario, sin pagos ni notas de crédito, y los folios se numeran de forma consecutiva pero no tienen validez fiscal. No hay historial de facturas en pantalla: quedan guardadas en Firebase. Es una base funcional para crecer.

Sin conexión se puede **consultar** (catálogo, clientes y ajustes salen de la copia local) pero no **vender**: sin base no hay folio ni factura guardada. Las copias del equipo son de lectura, no una cola de ventas pendientes.
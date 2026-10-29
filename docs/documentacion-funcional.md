# Documentación funcional

Estado de **Capstone** al 29 de octubre de 2026. Describe lo que la aplicación hace hoy para una persona que la usa. El contrato de rutas sigue en [`FUENTE-DE-LA-VERDAD.md`](../FUENTE-DE-LA-VERDAD.md). Cómo levantarla está en [`README.md`](../README.md).

## Para qué sirve

Cada persona lleva sus comprobantes de **servicios**, **expensas** y **alquiler**. Carga una foto o un PDF, revisa lo que el sistema leyó, lo confirma y después pregunta por sus gastos.

Hasta que confirma, el monto no entra al libro ni a los gráficos. Otra persona no ve esos comprobantes, esos totales ni esas conversaciones.

Hay dos recuerdos y no se mezclan:

- El **libro** guarda los montos confirmados. De ahí salen el tablero y las preguntas del tipo «¿cuánto pagué?».
- El **índice** guarda el texto del comprobante. De ahí salen las preguntas del tipo «¿qué dice la factura?».

## Qué puede hacer una persona

1. Crear una cuenta e ingresar con email y contraseña.
2. Subir un comprobante (jpeg, png, webp o pdf) o sacar una foto.
3. Ver los datos leídos, corregirlos y confirmarlos, o eliminar el comprobante.
4. Ver el tablero del año en curso: total gastado, gráficos por mes y por categoría, y la lista de confirmados.
5. Abrir un confirmado para corregirlo, anularlo o eliminarlo.
6. Preguntar en el chat y seguir en la misma conversación.
7. Aprobar o rechazar una acción del chat antes de que tenga efecto.

## Pantallas

Quien no tiene sesión solo ve **Ingresar** (`/ingreso`) y **Crear cuenta** (`/registro`). El resto pide sesión. Si el token no sirve, vuelve al ingreso.

Con sesión, la barra superior tiene el interruptor de tema oscuro al lado de las notificaciones. La barra lateral lista **Tablero** (`/`), **Registros**, **Categorías**, **Cargar** y **Chat** (`/chat`). Abajo, el nombre —o el email, si no hay nombre— queda al lado de un menú de **Opciones** con Cuenta, Apariencia, Modelo y Sesión (`/opciones`). **Salir** cierra la sesión de esa pestaña.

| Pantalla | Qué muestra |
| --- | --- |
| Ingresar / Crear cuenta | Email y contraseña. Si ya hay sesión, va al tablero. |
| Tablero | Período, gráficos, carga, borradores y confirmados. |
| Revisión (`/documentos/:id`) | Vista previa, texto leído y formulario. |
| Chat | Conversaciones, ejemplos, mensajes y, si hace falta, aprobar o rechazar. |
| Opciones (`/opciones`) | Nombre que se muestra en lugar del email, cambio de email y de contraseña, tema oscuro, proveedor y modelo en uso, duración de la sesión y eliminar la cuenta. No pide ni muestra claves. |

Si no hay borradores ni confirmados en el período, el tablero muestra tres pasos: cargar, revisar y confirmar, preguntar en el chat.

## Cuenta y sesión

El registro pide email y contraseña. El texto de la pantalla pide una frase larga; el sistema exige que ambos campos vengan completos. Si el email ya existe, lo dice. Si el ingreso falla, responde que el email o la contraseña no sirven, sin indicar cuál.

Al entrar, la pestaña guarda el token. Dura 15 minutos. Cerrar la pestaña o salir lo borra, junto con el chat guardado en esa pestaña. Otra pestaña no comparte esa sesión.

Con la sesión abierta se puede guardar un nombre. No pide contraseña y no sirve para entrar: si está vacío, la barra, el saludo y «Cargado por» siguen mostrando el email. También se pueden cambiar el email y la contraseña. Para eso hace falta la contraseña actual. Si no coincide, lo dice y no cambia nada. Si el email es de otra cuenta, lo dice.

Eliminar la cuenta pide la contraseña y escribir el email, y borra comprobantes, borradores, categorías, conversaciones y archivos de esa persona. No es recuperación de contraseña olvidada.

## Cargar un comprobante

Se acepta un archivo por vez: jpeg, png, webp o pdf, de hasta 10 MB. El tipo se mira en el contenido, no solo en el nombre. Se puede arrastrar el archivo, elegirlo o usar **Sacar foto**.

El sistema lee el archivo y abre la revisión con un **borrador**:

- Un PDF con texto seleccionable se lee como texto y el modelo completa los campos.
- Una foto, o un PDF con poco o ningún texto, se manda como imagen. De un PDF se miran como máximo las dos primeras páginas.
- Si falta proveedor, categoría, período o monto, o si un dato no tiene el formato esperado, el borrador igual se guarda y la revisión muestra una advertencia. La persona lo completa a mano.

El borrador aparece en el tablero con estado **Borrador**. Todavía no suma en los gráficos ni responde en el chat como gasto confirmado.

Hay un tope de 30 cargas por persona y por día UTC. Al pasarlo, la carga se rechaza con «Llegaste al tope de cargas de hoy.»

## Revisar y confirmar

La revisión muestra la vista previa del archivo y, si sigue en borrador, el texto extraído. Los campos son:

| Campo | Regla |
| --- | --- |
| Proveedor | Obligatorio. |
| Categoría | Servicios, expensas o alquiler. |
| Período | `AAAA-MM`. |
| Monto | Número con dos decimales. `18500` pasa a `18500.00`. Una coma decimal se acepta. |
| Moneda | Si queda vacía, se usa `ARS`. |
| Número de comprobante | Opcional. |

**Confirmar** exige proveedor, categoría, período y monto. Si faltan, no entra al libro. Al confirmar:

1. El monto pasa al libro y el borrador deja de existir.
2. El texto se indexa con la persona, la categoría, el período y el proveedor.
3. Si la persona cambió un dato respecto de lo leído, la ficha guarda el antes y el después.

Si el índice no puede guardar el texto, el comprobante igual queda confirmado. La pantalla avisa: el monto ya quedó guardado. El texto de la factura todavía no se puede buscar. Confirmar de nuevo el mismo comprobante no pisa los datos; vuelve a intentar el índice.

**Eliminar** borra el comprobante y el archivo, sea borrador o confirmado, incluso si ya estaba anulado. Pide confirmación y no se puede deshacer. En el tablero, un borrador también se puede descartar.

## Tablero

El período es enero del año en curso hasta el mes actual. La pantalla lo muestra como texto. Los gráficos, el total gastado y la lista de confirmados usan ese rango. Los totales los calcula el servidor. La pantalla solo los muestra, en pesos argentinos cuando la moneda es `ARS` (`18500.50` se ve como `$ 18.500,50`).

- Arriba están el total gastado, los comprobantes, los borradores y las categorías. Una barra fina compara confirmados y borradores.
- **Total por mes:** barras. Si no hay montos en el rango, lo dice.
- **Total por categoría:** anillo de servicios, expensas y alquiler, con el total al centro.
- Los borradores por revisar aparecen solo cuando hay alguno.

La lista de abajo son los confirmados de ese período.

## Corregir y anular

Un confirmado se abre desde la lista. Al principio los campos están bloqueados.

- **Corregir** los habilita, guarda los datos nuevos en el libro y suma el cambio al historial visible (campo, antes y después). **Cancelar** vuelve a los valores guardados. El texto indexado no se vuelve a leer: una pregunta sobre el texto puede seguir citando la versión anterior.
- **Anular** lo saca del tablero, del CSV y de las respuestas de montos del chat. El comprobante no se borra: si se abre por su enlace, se ve como **Anulado**, sin poder editarlo. El tablero no lo lista.
- **Eliminar** borra la ficha, el archivo y el texto indexado. Sale del libro, del CSV y de las consultas. El enlace deja de abrir el comprobante. También se puede eliminar uno que ya estaba anulado.

## Chat

El chat pregunta sobre los gastos de quien está conectado. La pregunta no espera al modelo: se encola y la pantalla consulta el estado hasta que termina, falla o pide una decisión. Mientras tanto dice «Consultando…».

Hay tres ejemplos listos:

- «¿Cuánto pagué de expensas en marzo?» Usa el libro de montos.
- «Compará la luz de enero contra febrero.» Usa el libro y una calculadora. La luz se trata como servicio.
- «¿Qué dice la factura de alquiler sobre el ajuste?» Usa el texto indexado, no el libro.

Una pregunta de montos no se responde con el índice. Una pregunta sobre el texto de una factura no se responde solo con el libro. Si la pregunta mezcla las dos cosas, primero se busca el texto y después el monto. Si la pregunta no cae en ninguno de esos grupos, el supervisor elige. Cada especialista tiene como máximo dos intentos y el recorrido tiene un tope de pasos.

La respuesta cita un comprobante como `[comprobante {id} | proveedor | categoría | período]`. En el chat, esa marca y `Borrador: {id}` son enlaces a la revisión.

La misma conversación se sigue con el hilo en curso. **Nueva** empieza otra en esta pestaña. A la izquierda aparecen hasta 30 conversaciones de esa persona, con la primera frase como título. Al abrir una que esta pestaña no tiene guardada, se trae el historial del servidor. Salir borra la copia local; el historial del servidor queda.

Cada conversación se puede **archivar** o **eliminar**. Archivar la saca de la lista activa y la deja en **Archivadas**, desde donde se restaura. Eliminar borra el historial y no se puede deshacer. Mientras hay una consulta o una decisión pendiente, esas acciones quedan bloqueadas. Si se sigue escribiendo en una conversación archivada, vuelve a la lista activa.

Hay un tope de 50 consultas por persona y por día UTC. Al pasarlo, el envío se rechaza con «Llegaste al tope de consultas de hoy.» Si la consulta falla, el mensaje es una frase corta. No muestra el error interno.

Mientras hay una decisión pendiente, no se puede enviar otra pregunta ni cambiar de conversación.

## Cuando el chat pide aprobación

Una pregunta de lectura termina sola. El sistema se detiene si el pedido quiere producir un efecto, por ejemplo asentar o registrar un pago, avisar, enviar, transferir o aplicar un ajuste. También se detiene si pide pagar un monto de 1000 o más en dólares o en una moneda nombrada.

La pantalla muestra una ficha con la acción, el motivo y el pedido. Si reconoció categoría, período y monto, los incluye. Hay dos botones: **Aprobar** y **Rechazar**.

| Decisión | Qué pasa |
| --- | --- |
| Aprobar un asiento de pago | Crea un **borrador** para revisar. No entra al libro hasta que la persona lo confirma en la revisión. El proveedor queda como «Asiento». Hace falta categoría (expensas, alquiler, o un servicio como luz, gas, agua o internet), período y monto con dos decimales. Si falta alguno, no se crea nada y la respuesta lo dice. |
| Rechazar un asiento | No se crea el borrador. La respuesta empieza con «Rechazado». |
| Aprobar otro efecto | Queda anotado como aviso. No entra al libro. La ficha dice que la acción queda registrada. |
| Rechazar otro efecto | No se anota. La respuesta empieza con «Rechazado». |

El borrador creado desde el chat aparece en el tablero, con el aviso de que salió del chat y hay que revisarlo antes de confirmar.

## Aislamiento

Todo lo que se lee o se escribe es de la persona del token. Un comprobante, un archivo, un total, un job o una conversación de otra persona responden como si no existieran. El resumen de una no incluye montos ni ids de la otra. Una pregunta por el texto del alquiler de otra persona no devuelve ese comprobante.

## Qué no hace

No hay recuperación de contraseña olvidada, ingreso con un proveedor externo, roles, hogar compartido ni un panel para administrar a otras personas. No se sube más de un archivo por comprobante. No hay un OCR aparte del modelo. El navegador no calcula totales.

## Límites que se notan al usarla

- La sesión de la pestaña vence a los 15 minutos. Hay que volver a ingresar.
- Corregir un confirmado actualiza el libro al momento. El texto que el chat puede citar no se reindexa con esa corrección.
- Anular lo saca de los números. El enlace directo sigue abriendo la ficha en solo lectura.
- Eliminar borra el comprobante. El enlace deja de existir.
- Si al confirmar el índice falla, los gráficos y las preguntas de montos ya cuentan ese comprobante. Las preguntas sobre el texto, no.
- Los cupos diarios se reinician a la medianoche UTC: 30 cargas y 50 consultas.

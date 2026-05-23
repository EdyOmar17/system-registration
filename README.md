# Servicio de Predicación y Seguimiento

Aplicación web para registrar horas de predicación, horas de crédito, revisitas y estudios bíblicos. Los datos se guardan en el navegador (`localStorage`).

Este proyecto permite a los usuarios llevar un control personal de su actividad ministerial, generar informes en PDF y gestionar respaldos mediante exportación e importación de datos en formato JSON. Está diseñado como un sitio estático que se despliega fácilmente en Render usando Vite.

## Qué hace el sistema

- Registra actividades de predicación y seguimiento.
- Guarda la información localmente en el navegador sin servidor.
- Genera reportes en PDF por mes.
- Permite exportar los datos completos a un archivo JSON.
- Permite importar un JSON para restaurar los datos.
- Es ideal para uso personal o en pequeños grupos sin necesidad de base de datos.

## Cómo funciona

1. El usuario agrega registros desde la interfaz web.
2. El sistema guarda los datos directamente en `localStorage`.
3. La aplicación lee los datos al cargar la página y muestra el historial.
4. Los botones de exportación generan archivos PDF o JSON.
5. El botón de importación restaura datos desde un JSON válido.

## Diagrama de flujo

```text
[Usuario] --> [Interfaz web]
      |             |
      v             v
 [Agregar registro]  [Cargar app]
      |             |
      v             v
[Guardar en localStorage]
      |
      v
[Mostrar historial]
      |
      +--> [Exportar PDF]
      |
      +--> [Exportar JSON]
      |
      +--> [Importar JSON]
```

## Estructura del proyecto

- `index.html`
  - Contiene la estructura HTML de la página.
  - Incluye la interfaz de usuario y los elementos para ingresar datos.
- `app.js`
  - Controla la lógica principal del sistema.
  - Maneja el guardado y lectura en `localStorage`.
  - Genera las exportaciones e importaciones.
  - Actualiza la interfaz con los registros actuales.
- `styles.css`
  - Define los estilos visuales de la app.
  - Hace la interfaz más clara y usable.
- `vite.config.js`
  - Configuración del bundler Vite.
  - Permite el desarrollo local y la construcción de la app.
- `public/`
  - Contiene archivos estáticos como `sw.js` y otros recursos.
- `icons/`
  - Guarda íconos que usa la aplicación.
- `dist/`
  - Carpeta generada al construir la app con Vite.
  - No se debe subir a GitHub.

## Requisitos

- [Node.js](https://nodejs.org/) 18 o superior

## Desarrollo local

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite (por ejemplo `http://localhost:5173`).

## Cómo usar la aplicación

1. Abre la app en tu navegador.
2. Ingresa tu nombre, fecha y el tipo de actividad (predicación, crédito, revisita o estudio bíblico).
3. Guarda el registro y revisa el historial en la misma página.
4. Usa el botón de exportar PDF para generar un reporte del mes.
5. Usa el botón de exportar JSON para hacer una copia de seguridad de todos los datos.
6. Para restaurar datos, importa un archivo JSON válido desde el botón de importación.

## Despliegue en Render (sitio estático)

1. Sube el proyecto a GitHub.
2. En [Render](https://render.com), crea un **Static Site** conectado al repositorio.
3. Configuración:
   - **Build command:** `npm install && npm run build`
   - **Publish directory:** `dist`
4. Render te dará una URL pública (por ejemplo `https://tu-app.onrender.com`).

No hace falta base de datos ni variables de entorno.

## Scripts

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compila a `dist/` |
| `npm run preview` | Previsualiza el build local |

## Datos y respaldo

- Los registros viven en el navegador de cada dispositivo.
- **Exportar PDF del mes:** informe con el nombre del mes.
- **Exportar JSON:** copia completa de todos los datos.
- **Importar JSON:** restaura una copia de seguridad.

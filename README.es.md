<p align="center">
  <img src="docs/images/logo.svg" alt="Logotipo de MobSimLab" width="120" height="120">
</p>

<h1 align="center">MobSimLab</h1>

<p align="center">Mobility Simulator Lab: planificar, simular y probar el transporte público.</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <b>Español</b> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.pt.md">Português</a> ·
  <a href="README.zh.md">中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ar.md">العربية</a> ·
  <a href="README.hi.md">हिन्दी</a>
</p>

> Esta es una traducción. Si hay diferencias, prevalece el [README en inglés](README.md). La documentación enlazada está en inglés.

MobSimLab es una aplicación web de código abierto y autoalojada para planificar el transporte público, hacer análisis SIG y simular la operación. Dibuje líneas de autobús, tranvía, metro y ferrocarril sobre datos reales de calles y relieve, compruebe si cumplen el horario y caben sus pasajeros, y vea cuánto cuestan, qué aportan y si el proyecto merece la pena.

![La herramienta de líneas de calle: una línea BRT trazada sobre las calles, con su longitud, paradas, tiempo de ciclo, vehículos necesarios y fiabilidad en el panel lateral](docs/images/street-line-editor.png)

## Qué hace

**Dibujar la red**

- **Líneas de calle**: líneas de autobús, BRT, trolebús y autobús interurbano trazadas sobre las calles de OpenStreetMap. [Guía](docs/user/street-line-tool.md)
- **Ferrocarriles**: tranvía, metro ligero, metro, cercanías, regional, larga distancia y alta velocidad, con estaciones, vías, desvíos y cruces, todo a escala. [Guía](docs/user/railway-tool.md)
- **Vehículos y flota**: un catálogo de vehículos con fuentes, más los vehículos propios del proyecto y su lista de vehículos individuales. [Guía](docs/user/vehicles-and-fleet.md)

**Probarla**

- **Simulador**: ¿caben las líneas ferroviarias en las vías, cumplen el horario trenes y autobuses, se disipan los pequeños retrasos y caben todos en los vehículos? [Guía](docs/user/simulator.md)
- **Simulación vial**: las líneas de calle circulan en el tráfico con Eclipse SUMO, desde sus cocheras y de vuelta, con reproducción. [Guía](docs/user/road-simulation.md)
- **Simulaciones plurianuales**: cada año de simulación (10 por defecto, hasta 60) se ejecuta por tipo de día (laborable, sábado, domingo, festivo) con el calendario y el clima del proyecto. [ADR-0020](docs/adr/0020-multi-year-day-types.md)
- **Planificador de viajes**: tiempos puerta a puerta de A a B a lo largo del día. [Guía](docs/user/journey-planner.md)

**Analizarla**

- **Esquema**: las líneas como plano de red y como diagramas de línea, exportables a SVG, PNG o PDF. [Guía](docs/user/schematic.md)
- **SIG**: reparto de las calles, cobertura a pie y espaciado de paradas, población, regiones y el mapa de ruido. [Calles](docs/user/gis-streets.md), [a pie](docs/user/gis-walk.md), [población](docs/user/gis-population.md), [regiones](docs/user/gis-regions.md)
- **Tablas**: cifras de red y flota, horarios con turnos de vehículos (descargas CSV, PDF y GTFS), costes, beneficios, ingresos por tarifas y comparación de escenarios. [Red](docs/user/network-tables.md), [costes](docs/user/cost-tables.md), [beneficios](docs/user/benefit-tables.md), [tarifas](docs/user/fare-revenue.md)
- **Modelo de demanda**: una previsión de día laborable en cuatro etapas (generación, distribución, reparto modal y asignación) con AequilibraE. [Guía](docs/user/demand-model.md)
- **Evaluación**: valor actual neto económico y financiero, tasas de rentabilidad, relación beneficio-coste, análisis multicriterio, sensibilidad y rangos de Monte Carlo. [Guía](docs/user/appraisal.md)

**Compartirla y ampliarla**

- **Proyectos**: comparta un proyecto con otras personas, hágalo público para todos los usuarios de la instancia o guárdelo como archivo `.mslab`. [Archivos de proyecto](docs/user/project-files.md)
- **Visor estático**: un sitio web sin servidor que muestra proyectos guardados en solo lectura, listo para Cloudflare Pages. [Guía](docs/user/static-viewer.md)
- **Plugins**: los plugins incluidos añaden teleféricos, ferris, autobuses a demanda, bicicletas de carga, energía y emisiones, importación y exportación GTFS y el mapa de ruido; los administradores pueden instalar más, que se ejecutan en un entorno aislado. [Plugins incluidos](plugins/README.md), [escribir plugins](docs/plugins/README.md)
- **Agentes de IA**: conecte Claude u otra aplicación MCP para crear escenarios y comprobarlos con la regla de 15 minutos a pie. [Guía](docs/user/ai-agents.md)
- **32 idiomas** en la aplicación.

## Capturas de pantalla

| | |
|---|---|
| ![Plano esquemático con líneas de metro, regional y autobús, zonas tarifarias y símbolos de estación](docs/images/schematic-network-map.png) | ![Horarios con los turnos de vehículos por línea y las salidas de una línea de autobús en domingo](docs/images/timetables.png) |
| **Esquema**: el plano de red, con diagramas de línea y exportación a SVG, PNG y PDF | **Horarios**: turnos de vehículos y salidas por tipo de día |
| ![Resumen de la evaluación con valor actual neto, relación beneficio-coste, tasa de rentabilidad, beneficios frente a costes y la dispersión de Monte Carlo](docs/images/appraisal.png) | ![Mapa SIG de cobertura a pie: a qué distancia de una parada viven los residentes, de verde a rojo](docs/images/walk-coverage.png) |
| **Evaluación**: ¿merece la pena el proyecto y cuán seguro es el resultado? | **Cobertura a pie**: quién vive a poca distancia a pie de una parada |
| ![Mapa de ruido con niveles L_den a lo largo de una línea y los edificios junto a ella](docs/images/noise-map.png) | |
| **Mapa de ruido**: L_den y L_night del servicio previsto, apantallados por edificios y relieve | |

## Inicio rápido

```bash
deploy/scripts/init-secrets          # random secrets in deploy/secrets (never committed)
cp .env.example .env                 # set MOBSIMLAB_VERSION, MOBSIMLAB_PUBLIC_URL and the OIDC provider
docker compose pull                  # ready-made image from ghcr.io, nothing to build
docker compose up -d                 # two containers: mobsimlab and postgres
open http://localhost:8080
```

Cada versión publica una imagen lista para servidores Intel/AMD y ARM en `ghcr.io/homlo-bike/mobsimlab`, etiquetada solo con su número de versión (por ejemplo `2026.11.1-alpha`; no hay etiqueta `latest`). Ponga esa versión como `MOBSIMLAB_VERSION` en `.env` antes de descargarla; para actualizar, cámbiela por la versión más reciente y ejecute `docker compose pull && docker compose up -d`. Para construir la imagen usted mismo desde este repositorio, ejecute `docker compose up -d --build`.

Las versiones se crean al subir una etiqueta de versión (`git tag -s v2026.11.1-alpha -m "MobSimLab 2026.11.1-alpha" && git push origin v2026.11.1-alpha`); el flujo de trabajo **Release image** construye la imagen, la prueba y la publica.

### Inicio de sesión y primera configuración

MobSimLab no tiene contraseñas locales; las personas inician sesión con un proveedor OpenID Connect (Keycloak, Authentik, Entra ID, Google y otros).

1. Registre MobSimLab en su proveedor como aplicación web. URI de redirección: `<MOBSIMLAB_PUBLIC_URL>/api/auth/callback`. URI de redirección tras cerrar sesión: `<MOBSIMLAB_PUBLIC_URL>/`.
2. Ponga la URL del emisor y el ID de cliente en `.env` (`MOBSIMLAB_OIDC_ISSUER`, `MOBSIMLAB_OIDC_CLIENT_ID`). Si el proveedor le dio un secreto de cliente, péguelo en `deploy/secrets/oidc_client_secret`.
3. Inicie los contenedores. La instancia arranca en **modo de configuración**: la primera persona que inicia sesión pasa a ser **Owner**, y todas las demás quedan rechazadas hasta que el Owner pulsa **Finish setup**. Para decidir quién es esa primera persona, defina `MOBSIMLAB_BOOTSTRAP_OWNER_EMAIL` (un correo verificado por el proveedor) o `MOBSIMLAB_BOOTSTRAP_OWNER_SUBJECT`.
4. Tras la configuración, los usuarios nuevos esperan aprobación (el registro automático está desactivado por defecto). Los Owners y Admins lo gestionan en **Administration**, en el menú de la cuenta: aprobar o rechazar personas, cambiar roles (Restricted suspende una cuenta sin borrarla), fijar reglas de alta (registro automático, dominios de correo y grupos del IdP permitidos) y asignar grupos del IdP a roles. Solo un Owner puede crear Owners o Admins, y el último Owner no se puede eliminar.
5. Detrás de un proxy inverso TLS, defina `MOBSIMLAB_TRUSTED_PROXIES` con la dirección del proxy para que los límites de inicio de sesión (10 por minuto y cliente por defecto) y los registros de auditoría vean la dirección real del cliente.

**Agentes de IA:** los Owners, Admins y Editores pueden conectar Claude u otra aplicación MCP en `<MOBSIMLAB_PUBLIC_URL>/mcp`. La instancia debe ser accesible por HTTPS desde la aplicación de IA, y `MOBSIMLAB_PUBLIC_URL` debe ser la dirección que usa la aplicación. Consulte [docs/user/ai-agents.md](docs/user/ai-agents.md).

**Visor estático:** `pnpm build:static` construye el sitio web de solo lectura. Consulte [docs/user/static-viewer.md](docs/user/static-viewer.md).

¿Ha perdido la cuenta de Owner? Ejecute `docker compose exec mobsimlab /app/bin/mobsimlab admin reset-owner`. Esto degrada al Owner actual a Admin, cierra su sesión, devuelve la instancia al modo de configuración y registra la acción en el registro de auditoría.

## Documentación

- [Arquitectura](docs/architecture/README.md), [supuestos cuestionados](docs/architecture/00-challenged-assumptions.md) y [registros de decisiones de arquitectura](docs/adr/README.md)
- Informes de prueba de concepto: [S1 cosimulación](docs/spikes/s1-cosimulation.md), [S2 rendimiento del núcleo ferroviario](docs/spikes/s2-rail-kernel-performance.md), [S3 importación de OSM](docs/spikes/s3-osm-import.md)

## Contribuir

Lea primero [CONTRIBUTING.md](CONTRIBUTING.md) y siga el [código de conducta](CODE_OF_CONDUCT.md). Informe de problemas de seguridad como se describe en [SECURITY.md](SECURITY.md). [ACCESSIBILITY.md](ACCESSIBILITY.md) recoge el objetivo de accesibilidad y las limitaciones conocidas.

## Licencia

El código se publica bajo la [GNU Affero General Public License v3.0 o posterior](LICENSE). El catálogo de vehículos, la biblioteca de supuestos y la documentación se publican bajo CC BY 4.0.

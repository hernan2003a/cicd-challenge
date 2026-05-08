# Dev CI/CD + AI Incident Resolution Challenge

Este challenge busca evaluar habilidades de **CI/CD, automatización, observabilidad y pensamiento operativo moderno**, incorporando un componente de **resolución de incidentes asistida por IA**.

El objetivo no es solo construir un pipeline que funcione, sino demostrar cómo la **IA puede ayudar a diagnosticar y acelerar la resolución de fallas en pipelines o despliegues**.

---

## Contexto

Este repositorio contiene una **API Node.js simple** que expone un endpoint:

```http
GET /health
```

El proyecto incluye:

- una aplicación básica
- un test que falla intencionalmente
- una configuración mínima de CI/CD
- un placeholder para un AI resolver
- logs de ejemplo para análisis

Tu tarea es:

1. Construir un pipeline CI/CD completo
2. Resolver los problemas actuales del proyecto
3. Desplegar la aplicación
4. Implementar un **mecanismo de diagnóstico automático asistido por IA cuando algo falla**

---

## Objetivos del challenge

Queremos ver cómo diseñás sistemas que:

- automaticen el ciclo de desarrollo
- detecten fallas rápidamente
- ayuden a resolver incidentes
- minimicen impacto en producción
- utilicen **IA para acelerar el diagnóstico**

---

## Requerimientos

### 1. CI Pipeline

Implementar un pipeline que ejecute al hacer **push o pull request**.

El pipeline debe incluir:

- instalación de dependencias
- ejecución de tests
- build del proyecto
- generación de artefactos

Herramienta sugerida:

- GitHub Actions (preferido)

Pero podés usar cualquier enfoque razonable.

---

### 2. Tests

El repositorio contiene un test que actualmente **falla**.

Esperamos que:

- identifiques el problema
- lo soluciones
- agregues al menos **un test adicional**

---

### 3. Dockerización

Crear o corregir un `Dockerfile` que permita ejecutar la aplicación.

El contenedor debe:

- iniciar correctamente
- exponer el puerto correcto
- permitir correr el healthcheck

Implementación actual del repo:

- la app escucha por defecto en `3001`
- `Dockerfile` expone `3001`
- la imagen publica `APP_VERSION` para trazabilidad del deploy
- la imagen define `HEALTHCHECK` sobre `GET /health`

Opcional pero valorado:

- imagen liviana
- multi-stage build

---

### 4. Deploy a Staging

Implementar un deploy automático a **staging** cuando el pipeline pasa.

Puede ser en:

- Railway
- Render
- Fly.io
- Kubernetes
- ECS
- Docker Compose
- cualquier alternativa razonable

Debe existir un **health check automático**:

```http
GET /health
```

Implementación actual del repo:

- namespace `stage` para staging
- namespace `prod` para producción
- un servicio `LoadBalancer` activo por ambiente para acceso externo

---

### 5. End-to-End / Smoke Test

Luego del deploy a staging se debe ejecutar al menos un test de smoke.

Ejemplo:

```bash
curl /health
```

Si falla, el pipeline debe marcar error.

---

### 6. Deploy a Producción

Si staging pasa correctamente:

- generar un MR de promoción a producción
- desplegar a producción cuando ese MR se mergea

Para mantener el flujo prolijo y separar responsabilidades, el GitOps del repo usa tres ramas dedicadas:

- `build`: rama CI-only donde se publica la metadata de la imagen generada (`artifacts/latest-build.json`)
- `stage`: rama que ArgoCD sigue para desplegar `staging`
- `prod`: rama que ArgoCD sigue para desplegar `producción`

Además del flujo blue/green dentro de cada rollout, los ambientes reales viven en namespaces separados:

- `stage`: despliegue previo a promoción
- `prod`: despliegue de producción

Implementación actual del repo:

- el pipeline builda la imagen y publica la metadata de release en la rama `build`
- luego actualiza automáticamente `k8s/stage-rollout.yaml` sobre la rama `stage`
- si `stage` completa tests + smoke sin fallas, genera una rama `promote-prod-<sha>` y un MR automático hacia `prod`
- cuando ese MR se mergea, `ArgoCD` sincroniza `k8s/rollout.yaml` desde la rama `prod` y el pipeline valida `prod` con `smoke_test_prod`

Podés simular producción con otro environment.

---

### 7. Rollback automático

Si el deploy de producción falla el health check:

- ejecutar rollback automático
- restaurar la versión anterior

La implementación usa `postPromotionAnalysis` de Argo Rollouts para que, si falla el health check del servicio activo, el rollout entre en estado abortado y vuelva al ReplicaSet estable anterior.

---

### 8. AI Incident Resolver

Además del pipeline CI/CD, queremos que implementes un **componente que utilice IA para analizar fallas del pipeline o del deploy**.

Este componente debe:

1. Leer logs de fallas del pipeline
2. Analizar posibles causas
3. Generar un diagnóstico automático

El objetivo es simular un **AI-assisted incident response system**.

Para una implementación más útil en CI, el resolver puede además:

- usar `GEMINI_API_KEY` para enviar los logs a Gemini
- usar el modelo estable `gemini-2.5-flash`
- usar `GITLAB_API_KEY` para crear un issue automáticamente en GitLab
- clasificar la criticidad del incidente (`critical`, `high`, `medium`, `low`)
- etiquetar el issue con labels como `severity::high` o `rollback-required`

---

## Qué debería hacer el AI Resolver

Cuando el pipeline falla:

- recolectar logs
- enviarlos a un modelo de IA
- generar un resumen estructurado del incidente

### Output esperado

El sistema debe generar un archivo como:

```text
artifacts/incident_report.md
```

o

```text
artifacts/incident_report.json
```

Opcionalmente, también puede registrar el incidente en GitLab Issues con el resumen generado por IA y el nivel de severidad detectado.

### Variables esperadas para el AI Resolver

- `GEMINI_API_KEY`: clave para consultar Gemini
- `GEMINI_MODEL`: modelo a usar, recomendado `gemini-2.5-flash`
- `GITLAB_API_KEY`: token con permisos `api` para leer jobs fallidos, crear issues y abrir el MR automático de promoción a `prod`
- `BUILD_METADATA_BRANCH`: rama GitOps para publicar metadata de la imagen, recomendada `build`
- `STAGE_GITOPS_BRANCH`: rama GitOps seguida por ArgoCD para `stage`, recomendada `stage`
- `PROD_GITOPS_BRANCH`: rama GitOps seguida por ArgoCD para `prod`, recomendada `prod`

Podés tomar como base el archivo versionado `.env.example` y copiarlo a `.env` para pruebas locales.

Ejemplo:

```text
Incident Summary

Step failed:
Unit Tests

Probable root cause:
The test expects the Express app to be exported but the server file starts the listener directly.

Confidence:
Medium

Suggested fix:
Export the Express app instance and move the listen() call to a separate file.

Recommended action:
Fix test setup and rerun pipeline.

Rollback required:
No
```

---

## Archivos incluidos

Este kit ya trae:

- `src/app.js`
- `server.js`
- `__tests__/app.test.js`
- `logs/pipeline_failure.log`
- `scripts/ai-resolver.js`
- `.github/workflows/ci.yml`
- `Dockerfile`

**Importante:** algunos archivos están intencionalmente incompletos o mal configurados para que el candidato los resuelva.

---

## Evaluación

Vamos a evaluar:

### CI/CD
- calidad del pipeline
- claridad de la automatización
- manejo de errores

### Infraestructura
- dockerización
- deploy strategy
- rollback

### Observabilidad
- logs
- health checks
- diagnóstico

### Uso de IA
- cómo usaste IA para analizar incidentes
- claridad del reporte generado
- utilidad real del diagnóstico

### Calidad general
- estructura del repo
- claridad del código
- documentación

---

## Bonus

Suma puntos si implementás:

- comentario automático en PR con el diagnóstico del incidente
- clasificación de severidad
- detección automática de rollback necesario
- análisis de logs de Docker
- análisis de logs del deploy
- detección de errores comunes como puertos, env vars o tests

---

## Registry local en k3s

La referencia canónica de imagen para despliegue dentro del clúster es:

```text
registry.infra-tools.svc.cluster.local:5000/cicd-challenge:<tag>
```

Ejemplo real de tag:

```text
registry.infra-tools.svc.cluster.local:5000/cicd-challenge:abc123
```

### Reglas operativas

- `DEPLOY_REGISTRY_IMAGE` debe apuntar al registry interno del clúster: `registry.infra-tools.svc.cluster.local:5000/cicd-challenge`
- El manifiesto GitOps activo es `k8s/rollout.yaml` y debe mantener esa misma base de imagen
- Si el runner de GitLab corre fuera del clúster y no puede resolver `*.svc.cluster.local`, el pipeline debe usar `PUSH_REGISTRY_IMAGE` como alias reachable desde el runner, siempre apuntando al mismo backend del registry
- Variables útiles de CI para ese caso: `PUSH_REGISTRY_IMAGE`, `PUSH_REGISTRY_HOST`, `PUSH_REGISTRY_HOST_IP`, `PUSH_REGISTRY_USERNAME`, `PUSH_REGISTRY_PASSWORD` y `PUSH_REGISTRY_INSECURE`

### Patrón recomendado

- **Push desde CI:** usar `PUSH_REGISTRY_IMAGE` cuando el runner no esté dentro de k3s
- **Deploy en Kubernetes/ArgoCD:** usar siempre `DEPLOY_REGISTRY_IMAGE=registry.infra-tools.svc.cluster.local:5000/cicd-challenge`
- **Resultado esperado:** Kaniko publica en un endpoint alcanzable por el runner y k3s descarga desde el alias interno del clúster

### Dominio estable del proyecto en Kubernetes

Los hostnames internos canónicos del proyecto para smoke tests y validaciones son:

```text
cicd-challenge.stage.svc.cluster.local:8081
cicd-challenge.prod.svc.cluster.local:8082
```

Regla práctica:

- el smoke de stage consulta `http://cicd-challenge.stage.svc.cluster.local:8081/health`
- el smoke de prod consulta `http://cicd-challenge.prod.svc.cluster.local:8082/health`
- los servicios activos de `stage` y `prod` son `LoadBalancer`; en k3s usan puertos externos dedicados `8081` y `8082` para evitar colisión con Traefik en `80/443`
- los nombres de preview o auxiliares pueden variar, pero el endpoint estable del proyecto debe mantenerse fijo

### Blue-green limpio con Argo Rollouts

Para que el despliegue sea blue-green de verdad, el path sincronizado por ArgoCD debe contener un solo dueño para `challenge-app` y `cicd-challenge`.

- `k8s/stage-rollout.yaml` es la fuente canónica de staging
- `k8s/rollout.yaml` es la fuente canónica de producción
- `k8s/bootstrap` contiene los recursos compartidos (namespaces + `ClusterAnalysisTemplate`)
- `k8s/stage` expone un `kustomization.yaml` para que ArgoCD siga la rama `stage`
- `k8s/prod` expone un `kustomization.yaml` para que ArgoCD siga la rama `prod`
- el `Deployment` clásico duplicado fue removido del path GitOps para evitar `RepeatedResourceWarning`, ReplicaSets duplicados y selectores ambiguos

En CI el flujo quedó más didáctico con dos jobs de smoke separados por ambiente:

- `smoke_test_stage`: valida staging por `http://cicd-challenge.stage.svc.cluster.local:8081/health`
- `publish_build_metadata`: deja trazabilidad de la imagen lista para promover en la rama `build`
- `create_prod_promotion_mr`: abre el MR de promoción a `prod` después de que `stage` queda verde
- `smoke_test_prod`: valida producción por `http://cicd-challenge.prod.svc.cluster.local:8082/health` cuando el MR de promoción ya fue mergeado sobre la rama `prod`

De esa manera el pipeline refleja mejor el modelo mental `build -> stage -> prod`: primero se publica la imagen en una rama CI-only, luego se valida `stage`, y recién después se crea un gate manual vía MR hacia `prod`. Argo Rollouts mantiene el blue/green y el rollback automático dentro de cada namespace.

Además, el `Rollout` ahora define:

- `prePromotionAnalysis` contra el servicio preview del namespace correspondiente
- `postPromotionAnalysis` contra el servicio activo del namespace correspondiente

Eso cubre el requisito de validar staging antes de la promoción y de ejecutar rollback automático si la versión promovida falla en producción.

### Acceso de ArgoCD al repo privado

`ARGOCD_TOKEN` en GitLab CI **no alcanza por sí solo** para que ArgoCD lea el repositorio. ArgoCD necesita una credencial propia dentro del namespace `argocd`.

Este repo incluye el helper:

```text
scripts/configure-argocd-repo-creds.sh
```

Uso desde una terminal con `kubectl` apuntando al clúster y permisos sobre `argocd`:

```bash
export ARGOCD_TOKEN=<token-con-read_repository>
./scripts/configure-argocd-repo-creds.sh
```

Si `ARGOCD_TOKEN` no está exportado, el helper lo pide en forma interactiva y luego crea o actualiza el secret `repository` de ArgoCD.

Opcionales:

- `ARGOCD_USERNAME` (por defecto `oauth2`)
- `ARGOCD_NAMESPACE` (por defecto `argocd`)
- `ARGOCD_APP_NAME` (por defecto `dev-cicd-challenge`)
- `ARGOCD_REPO_URL` para cambiar la URL del repo

Después de aplicar la credencial, ArgoCD debería poder sincronizar el `Application` y recién ahí existirán los recursos como `Rollout` y `Service` que usa el smoke test.

Esto evita depender del registry de GitLab para despliegue y mantiene el tráfico de imágenes dentro de la red del clúster.

---

## Mejoras que se pueden implementar

Las siguientes mejoras están fuera del alcance mínimo del challenge pero representan evoluciones naturales del sistema.

### Observabilidad avanzada

- **Métricas con Prometheus + Grafana**: instrumentar la app con `prom-client` para exponer métricas de latencia, tasa de errores y throughput. Dashboards en Grafana para visualizar el estado del pipeline y del deploy en tiempo real.
- **Tracing distribuido (OpenTelemetry)**: agregar trazas al endpoint `/health` y a cualquier llamada interna para correlacionar errores entre servicios.
- **Centralización de logs (Loki / EFK)**: enviar los logs de la app y del pipeline a un stack de logs centralizado para facilitar el análisis post-mortem.

### Seguridad en el pipeline

- **Escaneo de imágenes (Trivy / Grype)**: ejecutar un análisis de vulnerabilidades sobre la imagen Docker antes del push al registry. Fallar el pipeline si se detectan CVEs críticos.
- **SAST (Static Application Security Testing)**: incorporar una herramienta como `semgrep` o `eslint-plugin-security` al job de CI para detectar patrones inseguros en el código.
- **Firma de imágenes con Cosign**: firmar cada imagen publicada y verificar la firma antes del deploy para garantizar la integridad de los artefactos.
- **Secret scanning**: habilitar `gitleaks` o el scanner nativo de GitLab/GitHub para evitar que credenciales lleguen al repositorio.

### Calidad y cobertura

- **Cobertura de tests (Jest `--coverage`)**: generar reporte de cobertura en cada pipeline y publicarlo como artefacto. Definir un umbral mínimo (ej: 80 %) que falle el job si no se alcanza.
- **Pruebas de carga (k6 / Artillery)**: agregar un job de carga ligero en staging antes de la promoción a producción para detectar regresiones de performance.
- **Lint y format automático**: integrar `eslint` y `prettier` al pipeline con auto-fix en PRs para mantener consistencia del código.

### Pipeline y despliegue

- **Cache de dependencias en CI**: cachear `node_modules` entre runs de CI para reducir el tiempo de build.
- **Multi-stage environments**: agregar un ambiente `qa` entre `stage` y `prod` con sus propios smoke tests para validaciones más exhaustivas.
- **Feature flags (Unleash / LaunchDarkly)**: desacoplar el deploy del release usando feature flags, permitiendo activar funcionalidad nueva sin volver a hacer deploy.
- **Canary release sobre Argo Rollouts**: extender la estrategia actual blue/green con un canary que derive un porcentaje del tráfico a la nueva versión antes de la promoción completa.
- **Policy enforcement (Kyverno / OPA Gatekeeper)**: definir políticas de seguridad y configuración en el clúster que rechacen manifests que no cumplan estándares (ej: imágenes sin digest, contenedores privilegiados).

### AI Incident Resolver

- **Análisis histórico de incidentes**: almacenar los reportes generados por el AI resolver en una base de datos ligera (SQLite o un bucket S3-compatible) para detectar patrones recurrentes y priorizar fixes estructurales.
- **Auto-fix suggestions con diff aplicable**: en lugar de solo describir el fix, que el resolver genere un patch o snippet listo para aplicar sobre el archivo afectado.
- **Integración con múltiples modelos**: permitir seleccionar el proveedor de IA (Gemini, OpenAI, Anthropic) mediante una variable de entorno, con un adaptador común, para no quedar atado a un único vendor.
- **Comentario automático en MR/PR**: publicar el resumen del incidente como comentario en el MR que disparó la falla, facilitando el contexto para el reviewer.
- **SLO tracking y error budget**: calcular automáticamente el impacto del incidente sobre el error budget del servicio e incluirlo en el reporte generado.

### Experiencia de desarrollo

- **Dev container (`.devcontainer`)**: proveer un entorno de desarrollo reproducible con VS Code Dev Containers para que cualquier colaborador pueda levantar el proyecto con un solo clic.
- **Pre-commit hooks (Husky + lint-staged)**: ejecutar lint, tests unitarios y secret scanning antes de cada commit local para reducir fallas en CI.
- **Renovate / Dependabot**: automatizar la actualización de dependencias con PRs generados automáticamente y validados por el pipeline.

---

## Entrega

1. Forkear este repositorio
2. Implementar la solución
3. Enviar el link del repo

---

## Tiempo estimado

Entre **2 y 4 horas**.

No es necesario completar todo si el tiempo no alcanza.

Valoramos mucho **explicar decisiones técnicas** en el README.


## Decisiones Tecnicas

Se implemento todo el codigo en gitlab ya que ofrece un entorno donde estan todas las herramientas integradas en un solo ambiente sin depender de herramienntas pagas por ejemplo incorpora de forma nativa DevSecOps , tambien incluye agente IA que se puede integrar a lo pipelines.

Se implemento y se probo todo en arquitectura ARM64 para imagenes Graviton de Bajo costo en AWs.

Se Implemento el Blue Green en ARGOCD , para evitar inventar la rueda.

Se Implemento un registry interno en el cluster que puede ser externo , para el manejo de imagenes con ARGOCD.

Se Implemennto la generacion de Issues de forma automatica en caso de fallo con reporte , se usa Gemini API KEY , no se usa agentes IA nativas porque la cuenta es gratuita.

Se Implemento La promocion automatica en caso de que una branch stage no tenga fallo se puede promocionar a prod.

Se Implemento implement Ramas Stage , Prod,  Build , Stage y Prod solo existen para probar la promocion de codigo de Stage a Prod , pudo haber sido Dev a Prod , para simplificar se dejo 2 solo , y build la usa ARGOCD para hacer el rollout del codigo en caso de error se vuelve a la imagen anterior.

## Mejoras a Futuro 

Se puede implementa un registry externo como amazon ECR.

Se puede implementa un loopback en caso de error de codigo se puede delegar un agente de IA para que lo resuelve lo comitee de forma automatica para reducir el dolor de cabeza de los dessarrolladores. 


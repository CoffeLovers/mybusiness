# 📱 MyBusiness — Aplicación Móvil Android

Cliente oficial de la plataforma **MyBusiness**, desarrollado en **Kotlin** con **Jetpack Compose** y **Material 3**, siguiendo los principios de Clean Architecture y diseño modular multi-módulo.

---

## 🏗️ Arquitectura Modular

```text
apps/mobile-android/
├── app/                  # Orquestación, MyBusinessApp (@HiltAndroidApp), MainActivity y NavHost raíz
├── core/
│   ├── common/           # Result<T>, Constantes, Extensiones de formato y Utils
│   ├── designsystem/     # Tema Material 3 (Colores, Tipografía, Formas) y Componentes reutilizables
│   ├── model/            # Modelos de dominio puros (User, BankAccount, Transaction, DashboardSummary)
│   ├── datastore/        # Persistencia reactiva de sesión y tokens con DataStore Preferences
│   ├── network/          # Retrofit, OkHttp, AuthInterceptor (Bearer + 401 handling) y DTOs
│   ├── di/               # Módulos Hilt compartidos y Coroutine Dispatchers
│   └── navigation/       # Destinos tipados para Navigation Compose
└── feature/
    ├── auth/             # Login (UI + ViewModel + UseCases + AuthRepository + FakeAuthRepository)
    └── dashboard/        # Dashboard Financiero (UI + ViewModel + UseCases + FakeDashboardRepository)
```

---

## ⚡ Guía de Ejecución Local

### Prerrequisitos

- **Android Studio** (Koala / Ladybug o superior)
- **JDK 17+** (incluido por defecto en Android Studio `jbr/`)
- **Android SDK** API 35 (mínimo soportado: Android 8.0, API 26)

### 1. Conexión con el API Gateway

La aplicación se comunica exclusivamente a través del **API Gateway** (`/api/v1`).

- **Emulador Android Oficial:** El alias estándar para acceder al localhost de la máquina host es `http://10.0.2.2:3000/api/v1/` (configurado por defecto en `core:network`).
- **Dispositivo Físico:** Configura la IP local de tu máquina en `core/network/build.gradle.kts` o mediante `local.properties`:
  ```properties
  api.base.url=http://192.168.1.X:3000/api/v1/
  ```

### 2. Modo MOCK (Desarrollo sin Backend)

Para permitir el desarrollo y pruebas de UI independientes antes del despliegue completo del backend:

- `feature:auth` incluye `FakeAuthRepository`, activado por defecto con `USE_MOCK_AUTH = true`.
- Permite iniciar sesión inmediatamente con las credenciales demo:
  - **Correo:** `admin@mybusiness.demo`
  - **Contraseña:** `Demo1234!`
- Simula la latencia de red y persiste la sesión en `DataStore Preferences`.

### 3. Compilación e Instalación

```bash
cd apps/mobile-android

# Compilar variante de depuración
./gradlew assembleDebug

# Ejecutar pruebas unitarias
./gradlew testDebugUnitTest

# Verificación de linter
./gradlew lintDebug
```

---

## 🔐 Seguridad y Manejo de Sesión

- Los tokens JWT (`accessToken` y `refreshToken`) se almacenan de forma segura y aislada en `DataStore Preferences`.
- `AuthInterceptor` inyecta automáticamente la cabecera `Authorization: Bearer <token>` en todas las peticiones autenticadas.
- En caso de recibir un `HTTP 401 Unauthorized`, `AuthInterceptor` ejecuta la limpieza automática de credenciales para forzar el retorno a la pantalla de inicio de sesión.

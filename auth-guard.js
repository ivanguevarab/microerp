// ============================================
// GUARDIÁN DE AUTENTICACIÓN (Auth Guard)
// ============================================

const SUPABASE_URL = 'https://snyfzenjapyybbfqrnku.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNueWZ6ZW5qYXB5eWJiZnFybmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwOTAzNTQsImV4cCI6MjA3ODY2NjM1NH0.JyuhgrbYjCt7XJiWhptI6Q2MM9JDKK49fnQdMlHxjlQ';

// Inicialización Inmediata (Global)
window.supabaseClient = null;
window.currentUser = null;

if (typeof supabase !== 'undefined') {
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log("⚡ Supabase Client Initialized Immediately");
} else {
    console.error("❌ CRÍTICO: Librería Supabase no cargada antes de auth-guard.js");
}

// --------------------------------------------
// PROTECCIÓN VISUAL INMEDIATA (Síncrona)
// Ejecuta apenas el script es leído por el navegador (antes de armar el DOM)
// --------------------------------------------
const currentPath = window.location.pathname;

// Todas las rutas están protegidas globalmente vía CSS, excepto las de entrada pública
const isPublicRoute = currentPath.endsWith('index.html') || currentPath.endsWith('bienvenida.html') || currentPath.endsWith('/');

if (!isPublicRoute) {
    const style = document.createElement('style');
    style.id = 'auth-guard-hide-style';
    style.innerHTML = 'body { display: none !important; }';
    (document.head || document.documentElement).appendChild(style);
    console.log("🛡️ AuthGuard: Escudo visual perimetral activado.");
}

// Variables específicas para validación extra de rutas con restricciones de módulo
const protectedRoutes = ['gestion_produccion_y_servicios.html', 'codigos_cup.html'];
const isProtectedRoute = protectedRoutes.some(route => currentPath.endsWith(route));

// ============================================
// Verificación de Sesión (Asíncrona)
// ============================================
async function checkAuth() {
    if (!window.supabaseClient) return;

    console.log("🛡️ AuthGuard: Verificando identidad...");

    try {
        // Obtener sesión actual
        const { data: { session }, error } = await window.supabaseClient.auth.getSession();

        if (error || !session) {
            console.warn("⛔ Acceso Denegado: No se encontró sesión activa.");
            if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
                if(!window.location.pathname.endsWith('despedida_usuarios.html')){
                    window.location.replace('index.html');
                }
            }
            return;
        }

        // --- PARCHE DE ADMISIÓN Y SEGURIDAD ---
        let profileData = null;
        
        // 1. Verificación de Admisión (Usuarios Nuevos vs Vinculados)
        if (!window.location.pathname.endsWith('index.html') && window.location.pathname !== '/') {
            const { data: profile, error: profileError } = await window.supabaseClient
                .from('perfiles_usuario')
                .select(`
                    id,
                    rol,
                    estado,
                    accesos_rutas,
                    empresas (
                        es_comercializadora,
                        es_servicios,
                        es_industrial
                    )
                `)
                .eq('id', session.user.id)
                .single();

            const isBienvenida = window.location.pathname.endsWith('bienvenida.html');

            if (profileError || !profile) {
                if (!isBienvenida) {
                    console.warn("🛡️ AuthGuard: Usuario sin perfil asignado. Redirigiendo a bienvenida.");
                    window.location.replace('bienvenida.html');
                }
                return; // Detiene la ejecución, el usuario se queda en (o va a) bienvenida
            } else {
                profileData = profile;
                if (isBienvenida) {
                    window.location.replace('dashboard.html');
                    return;
                }
            }
        }

        // Una vez superada la admisión, ahora sí activamos al usuario para desencadenar otras acciones UI (como initDashboard)
        window.currentUser = session.user;
        console.log("✅ Acceso Autorizado y Perfil Validado para:", window.currentUser.email);
        updateUserHeader(window.currentUser);
        
        // --- PARCHE DE ESTADO DE CUENTA (SOFT DELETE) ---
        if (profileData && profileData.estado === 'REVOCADO') {
            console.error("⛔ [Seguridad] Perfil REVOCADO por el administrador.");
            await window.supabaseClient.auth.signOut();
            window.location.replace('despedida_usuarios.html');
            return; // Detiene la carga
        }

        // 1.5. Renderizar el Sidebar y filtrar menús
        if (typeof window.renderErpSidebar === 'function') {
            window.renderErpSidebar(profileData);
        }

        // 1.6. Parche Duro: Expulsión si intenta navegar a un html bloqueado
        if (profileData && profileData.rol !== 'ADMIN') {
            const currentRoute = window.location.pathname.split('/').pop();
            // Evitar chequear dashboard.html (siempre accesible)
            if (currentRoute && currentRoute !== 'dashboard.html' && window.location.pathname.endsWith('.html')) {
                const isBienvenida = window.location.pathname.endsWith('bienvenida.html');
                const isMacroRoute = ['ventas_y_facturacion.html', 'gestion_inventarios.html', 'gestion_crm.html', 'gestion_produccion_y_servicios.html', 'gestion_de_personal.html', 'finanzas.html'].includes(currentRoute);
                
                if (!isBienvenida && !isMacroRoute) {
                    const rutasPermitidas = profileData.accesos_rutas || [];
                    if (!rutasPermitidas.includes(currentRoute)) {
                        console.error("⛔ [Seguridad] Acceso a ruta no autorizada:", currentRoute);
                        window.location.replace('dashboard.html');
                        return; // Expulsado
                    }
                }
            }
        }

        // 2. Validación restrictiva para Módulos Específicos
        if (isProtectedRoute && profileData) {
            console.log("🛡️ Validando permisos de módulo mediante banderas de empresa...");

            const profile = profileData; // Mantenemos compatibilidad con el código inferior

            if (profile && profile.empresas) {
                const isOnlyCommercial = (
                    profile.empresas.es_comercializadora === true &&
                    profile.empresas.es_servicios === false &&
                    profile.empresas.es_industrial === false
                );

                if (isOnlyCommercial) {
                    console.error("⛔ Bypass Detectado: Empresa exclusivamente comercial intentando acceder a Producción.");
                    window.location.replace('dashboard.html');
                    return; // Detener ejecución, el navegador redirigirá
                }
            }
        } // Fin de if (isProtectedRoute)

        // Si el código llega aquí libre de redirecciones, levantamos el escudo de toda la app
        const hideStyle = document.getElementById('auth-guard-hide-style');
        if (hideStyle) hideStyle.remove();

    } catch (err) {
        console.error("❌ Error Crítico en AuthGuard:", err);
        if (typeof isPublicRoute !== 'undefined' && !isPublicRoute) {
            window.location.replace('dashboard.html');
        }
    }
}

function updateUserHeader(user) {
    const userDisplay = document.getElementById('userDisplay');
    if (userDisplay && user.user_metadata) {
        userDisplay.textContent = user.user_metadata.full_name || user.email;
    }
}

// Ejecutar verificación cuando carga el DOM
document.addEventListener('DOMContentLoaded', checkAuth);

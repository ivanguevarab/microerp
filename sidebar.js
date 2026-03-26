/**
 * sidebar.js
 * Inyecta dinámicamente la barra de navegación vertical.
 * Estilo: Premium (Slate/Blue Pill).
 * Estructura: Estrictamente definida por el usuario.
 */

(function () {
    // 1. Verificar exclusiones (Login y Dashboard NO llevan sidebar)
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html'; // Fallback a index si vacio

    // La validación de inyección visual se hará después de exportar la configuración del menú.

    // 2. Configuración del Menú (ESTRICTA - No alterar orden)
    // Título 1: Dashboard
    // Título 2: Gestión de Inventarios
    const menuConfig = [
        {
            type: 'link',
            label: 'Dashboard',
            icon: 'fas fa-home',
            url: 'dashboard.html'
        },
        {
            type: 'accordion',
            label: 'Ventas y Facturación',
            icon: 'fas fa-sack-dollar',
            id: 'menu-facturacion',
            url: 'ventas_y_facturacion.html',
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Operaciones',
                    items: [
                        { label: 'Punto de Venta (POS)', url: 'emitir_ticket.html' }
                    ]
                },
                {
                    subtitle: 'Consultas',
                    items: [
                        { label: 'Histórico de Ventas', url: 'registros_historicos_ventas.html' },
                        { label: 'Inteligencia de Negocio', url: 'metricas_ventas.html' }
                    ]
                },
                {
                    subtitle: 'Configuración',
                    items: [
                        { label: 'Precios de Venta', url: 'precios_de_venta.html' }
                    ]
                }
            ]
        },
        {
            type: 'accordion',
            label: 'Control de Inventarios',
            icon: 'fas fa-boxes',
            id: 'menu-inventarios',
            url: 'gestion_inventarios.html', // URL para navegación directa
            defaultOpen: false, // Por defecto cerrado según solicitud
            groups: [
                {
                    subtitle: 'Operaciones Transaccionales',
                    items: [
                        { label: 'Items', url: 'items.html' },
                        { label: 'Ingresos', url: 'ingresos.html' },
                        { label: 'Egresos', url: 'egresos.html' },
                        { label: 'Transferencias', url: 'traslados.html' }
                    ]
                },
                {
                    subtitle: 'Consultas',
                    items: [
                        { label: 'Kardex', url: 'kardex.html' },
                        { label: 'Inteligencia de Negocio', url: 'metricas_gestion_inventarios.html' }
                    ]
                },
                {
                    subtitle: 'Correcciones',
                    hiddenInSidebar: true,
                    items: [
                        { label: 'Corregir Ingresos', url: 'corregir_ingresos_inventarios.html' },
                        { label: 'Corregir Egresos', url: 'corregir_egresos_inventarios.html' }
                    ]
                },
                {
                    subtitle: 'Configuración',
                    items: [
                        { label: 'Categorías', url: 'categorias.html' },
                        { label: 'Unidades de Medida', url: 'unidadesmedida.html' },
                        { label: 'Proveedores', url: 'proveedores.html' },
                        { label: 'Almacenes', url: 'almacenes.html' },
                        { label: 'Tipos de Ingreso', url: 'tiposdeingresos.html' },
                        { label: 'Tipos de Egreso', url: 'tiposdeegresos.html' }
                    ]
                }
            ]
        },
        {
            type: 'accordion',
            label: 'Gestión de Relaciones con Clientes (CRM)',
            icon: 'fas fa-handshake',
            id: 'menu-crm',
            url: 'gestion_crm.html',
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Gestión',
                    items: [
                        { label: 'Clientes', url: 'clientes.html' }
                    ]
                }
            ]
        },
        {
            type: 'accordion',
            label: 'Gestión de Producción y Servicios',
            icon: 'fas fa-industry', // Icono de fábrica
            id: 'menu-produccion',
            url: 'gestion_produccion_y_servicios.html',
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Operaciones',
                    items: [
                        { label: 'Órdenes de Producción (CUP)', url: 'codigos_cup.html' },
                        { label: 'Órdenes de Servicio (CUS)', url: 'codigos_cus.html' }
                    ]
                }
            ]
        },
        {
            type: 'accordion',
            label: 'Gestión de Personal',
            icon: 'fas fa-user-clock', // Ícono de empleado/reloj
            id: 'menu-personal',
            url: 'gestion_de_personal.html',
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Control',
                    items: [
                        { label: 'Asistencia y Reloj', url: 'asistencia_reloj.html' },
                        { label: 'Banco de Horas', url: 'banco_de_horas.html' },
                        { label: 'Planillas y Liquidaciones', url: 'liquidaciones.html' }
                    ]
                },
                {
                    subtitle: 'Configuración',
                    items: [
                        { label: 'Calendario Esperado', url: 'calendario_esperado_de_trabajadores.html' },
                        { label: 'Padrón de Personal', url: 'padron_personal.html' },
                        { label: 'Políticas de Empresa', url: 'politicas_empresa.html' }
                    ]
                }
            ]
        },
        {
            type: 'accordion',
            label: 'Análisis Financiero',
            icon: 'fas fa-chart-line',
            id: 'menu-finanzas',
            url: 'finanzas.html',
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Operaciones y Liquidez',
                    items: [
                        { label: 'Flujo de Caja', url: 'flujo_caja.html' },
                        { label: 'Cuentas por Cobrar', url: 'cuentas_cobrar.html' },
                        { label: 'Deudas por Pagar', url: 'deudas_pagar.html' }
                    ]
                },
                {
                    subtitle: 'Análisis Gerencial',
                    items: [
                        { label: 'Estado de Resultados', url: 'estado_resultados.html' }
                    ]
                }
            ]
        }
    ];

    window.MicroErpMenuConfig = menuConfig;

    // Lista negra explícita: admin.html y login index usan el menú pero NO inyectan sidebar visual
    if (page === 'index.html' || page === 'admin.html') {
        return;
    }

    console.log('Sidebar: Iniciando inyección para:', page);

    window.renderErpSidebar = (profileData = null) => {
        // --- 0. PREVENCIÓN DE DUPLICADOS EN DOM (DOBLE INYECCIÓN) ---
        if (document.querySelector('.layout-wrapper')) {
            console.warn('Sidebar ya fue inyectado. Previniendo duplicación visual.');
            return;
        }

        // PERMISOS GRANULARES: Filtrar menuConfig
        let finalMenu = menuConfig;
        if (profileData && profileData.rol !== 'ADMIN') {
            const routes = profileData.accesos_rutas || [];
            finalMenu = menuConfig.map(module => {
                if (module.type === 'link') {
                    // Si el link base es el propio dashboard, lo dejamos siempre
                    if (module.url === 'dashboard.html') return module;
                    return routes.includes(module.url) ? module : null;
                }
                if (module.type === 'accordion') {
                    const newGroups = module.groups.map(group => {
                        const newItems = group.items.filter(item => routes.includes(item.url));
                        return newItems.length > 0 ? { ...group, items: newItems } : null;
                    }).filter(g => g !== null);

                    return newGroups.length > 0 ? { ...module, groups: newGroups } : null;
                }
            }).filter(m => m !== null);
        }

        // --- 0. Inyectar Dependencias (FontAwesome) si faltan ---
        if (!document.querySelector('link[href*="font-awesome"]')) {
            const faLink = document.createElement('link');
            faLink.rel = 'stylesheet';
            faLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(faLink);
        }

        // --- 1. Preparar Layout ---
        const body = document.body;

        // Crear wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'layout-wrapper';

        // Crear content area
        const contentArea = document.createElement('main');
        contentArea.className = 'content-area';
        // Mover contenido existente
        while (body.firstChild) {
            contentArea.appendChild(body.firstChild);
        }

        // --- 2. Crear Sidebar ---
        const sidebar = document.createElement('aside');
        sidebar.className = 'sidebar';
        
        // Recuperar memoria de sidebar contraída
        if (localStorage.getItem('sidebar_is_collapsed') === 'true') {
            sidebar.classList.add('collapsed');
        }

        // Header del Sidebar (Logo SVG Original) - AHORA CLICKABLE
        sidebar.innerHTML = `
            <div class="sidebar-header" onclick="toggleSidebar()" style="cursor: pointer;" title="Clic para contraer/expandir">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 flex items-center justify-center">
                        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="w-full h-full drop-shadow-lg">
                          <defs>
                            <linearGradient id="cubeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" style="stop-color:#0070f2;stop-opacity:1" />
                              <stop offset="100%" style="stop-color:#00a8ff;stop-opacity:1" />
                            </linearGradient>
                          </defs>
                          <path d="M50 30 L80 45 L80 70 L50 85 L20 70 L20 45 Z" fill="url(#cubeGradient)" opacity="0.9" />
                          <path d="M50 10 L80 25 L80 45 L50 30 L20 45 L20 25 Z" fill="url(#cubeGradient)" opacity="1" />
                          <path d="M50 30 L50 85 L80 70 L80 45 Z" fill="#ffffff" opacity="0.3" />
                        </svg>
                    </div>
                    <span class="font-bold text-lg tracking-tight text-white">MicroERP</span>
                </div>
            </div>
            <nav class="sidebar-scroll">
                <ul class="sidebar-nav">
                    <!-- Dinámico -->
                </ul>
            </nav>
            <div class="sidebar-footer">
                <div class="flex items-center gap-3 mb-2">
                    <div class="w-2 h-2 rounded-full status-breathing transition-all"></div>
                    <span class="text-xs text-slate-400">Sistema Conectado</span>
                </div>
            </div>
        `;

        // --- 3. Renderizar Menú ---
        const navList = sidebar.querySelector('.sidebar-nav');
        let moduleCounter = 0;

        finalMenu.forEach(itemConfig => {
            if (itemConfig.type === 'link') {
                const li = document.createElement('li');
                li.className = 'mb-1 px-3'; // Padding para el efecto Pill
                const isActive = page === itemConfig.url;

                li.innerHTML = `
                    <a href="${itemConfig.url}" class="sidebar-link ${isActive ? 'active' : ''}">
                        <i class="${itemConfig.icon} w-5 text-center mr-3 ${isActive ? 'text-white' : 'text-slate-400'}"></i>
                        <span class="font-medium">${itemConfig.label}</span>
                    </a>
                `;
                navList.appendChild(li);
            }
            else if (itemConfig.type === 'accordion') {
                moduleCounter++;
                const li = document.createElement('li');
                li.className = 'nav-section mt-2';

                // Verificar si algún hijo o el módulo padre está activo para forzar apertura del acordeón
                let hasActiveChild = false;
                if (page === itemConfig.url) hasActiveChild = true;
                itemConfig.groups.forEach(g => {
                    if (g.items.some(i => i.url === page)) hasActiveChild = true;
                });

                const isOpen = (function () {
                    // Prioridad 1: Si estoy dentro del módulo, forzar abierto y actualizar memoria
                    if (hasActiveChild) {
                        localStorage.setItem(`sidebar_state_v2_${itemConfig.id}`, 'true');
                        return true;
                    }

                    // Prioridad 2: Respetar la memoria del usuario guardada previamente
                    const storedState = localStorage.getItem(`sidebar_state_v2_${itemConfig.id}`);
                    if (storedState !== null) {
                        return storedState === 'true';
                    }

                    // Prioridad 3: Configuración por defecto
                    return itemConfig.defaultOpen || false;
                })();

                // Estructura Dual: Link (Izq) + Toggle (Der)
                // Usamos clases de Tailwind para alinear y dar estilos
                const linkUrl = itemConfig.url ? itemConfig.url : '#';

                // Determinamos si es un link o un div basado en si hay URL
                const isLink = !!itemConfig.url;
                const tag = isLink ? 'a' : 'div';
                const hrefAttr = isLink ? `href="${itemConfig.url}"` : '';
                const cursorClass = isLink ? 'cursor-pointer' : 'cursor-default';

                li.innerHTML = `
                    <div class="flex items-center justify-between px-4 py-3 hover:bg-slate-800 transition-colors rounded-lg mx-2 mb-1 group">
                        <!-- ZONA IZQUIERDA: NAVEGACIÓN (Título e icono) -->
                        <${tag} ${hrefAttr} class="flex items-center gap-3 flex-grow ${cursorClass} no-underline">
                             <div class="w-8 h-8 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 border border-slate-700 group-hover:border-blue-500 group-hover:text-blue-400 transition-all">
                                <i class="${itemConfig.icon} text-xs"></i>
                             </div>
                             <div class="flex flex-col items-start leading-tight">
                                <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">MÓDULO ${moduleCounter}</span>
                                <span class="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">${itemConfig.label}</span>
                             </div>
                        </${tag}>

                        <!-- ZONA DERECHA: COLAPSO (Solo area del icono) -->
                        <div class="p-2 -mr-2 cursor-pointer text-slate-500 hover:text-white transition-colors" onclick="toggleAccordion('${itemConfig.id}')" title="Expandir/Contraer">
                            <i class="fas fa-chevron-down text-xs transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}" id="icon-${itemConfig.id}"></i>
                        </div>
                    </div>

                    <div id="${itemConfig.id}" class="sidebar-accordion-content ${isOpen ? 'expanded' : ''}">
                        <div class="py-2">
                             <!-- Grupos se insertan aquí -->
                        </div>
                    </div>
                `;

                // Container interno
                const innerContainer = li.querySelector('.sidebar-accordion-content > div');

                itemConfig.groups.forEach(group => {
                    if (group.hiddenInSidebar) return;

                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'mb-4'; // Espaciado entre grupos

                    // Subtítulo (Color Azul Premium para destacar secciones)
                    groupDiv.innerHTML = `<div class="px-6 py-2 text-xs font-bold text-blue-400 uppercase tracking-widest">${group.subtitle}</div>`;

                    // Items del grupo
                    const ul = document.createElement('ul');
                    ul.className = 'space-y-1 px-3'; // Espaciado vertical y padding lateral para efectos

                    group.items.forEach(subItem => {
                        const subLi = document.createElement('li');
                        const isSubActive = page === subItem.url;

                        subLi.innerHTML = `
                            <a href="${subItem.url}" class="sidebar-sublink ${isSubActive ? 'active' : ''}">
                                ${subItem.label}
                            </a>
                        `;
                        ul.appendChild(subLi);
                    });

                    groupDiv.appendChild(ul);
                    innerContainer.appendChild(groupDiv);
                });

                navList.appendChild(li);
            }
        });

        // --- 4. Ensamblaje ---
        // Insertar en orden
        wrapper.appendChild(sidebar);
        wrapper.appendChild(contentArea);
        body.appendChild(wrapper);

        // --- 5. Funciones Globales ---
        window.toggleAccordion = function (id) {
            const content = document.getElementById(id);
            const icon = document.getElementById('icon-' + id);

            if (content.style.maxHeight || content.classList.contains('expanded')) {
                content.style.maxHeight = null;
                content.classList.remove('expanded');
                icon.classList.remove('rotate-180');
                localStorage.setItem(`sidebar_state_v2_${id}`, 'false'); // Guardar estado cerrado
            } else {
                content.classList.add('expanded');
                content.style.maxHeight = content.scrollHeight + "px"; // Animación smooth
                icon.classList.add('rotate-180');
                localStorage.setItem(`sidebar_state_v2_${id}`, 'true'); // Guardar estado abierto
            }
        };

        // Función Global para Colapsar Sidebar
        window.toggleSidebar = function () {
            const sidebar = document.querySelector('.sidebar');
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar_is_collapsed', sidebar.classList.contains('collapsed'));
        };

        // Recalcular height si comienza expandido (solo si es visible)
        setTimeout(() => {
            document.querySelectorAll('.sidebar-accordion-content.expanded').forEach(el => {
                if (el.scrollHeight > 0) {
                    el.style.maxHeight = el.scrollHeight + "px";
                }
            });
        }, 100);
    };
})();

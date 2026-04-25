/**
 * sidebar.js
 * Inyecta dinámicamente la barra de navegación vertical.
 * Estilo: Premium (Slate/Amber Pill) - 0078.
 * Estructura: Estrictamente definida por el usuario.
 */

(function () {
    // 1. Verificar exclusiones (Login y Dashboard NO llevan sidebar)
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html'; // Fallback a index si vacio

    // La validación de inyección visual se hará después de exportar la configuración del menú.

    // 2. Configuración del Menú (ESTRICTA - No alterar orden)
    const menuConfig = [
        {
            type: 'link',
            label: 'Dashboard',
            icon: 'fas fa-home',
            url: 'dashboard.html'
        },
        {
            type: 'accordion',
            label: 'Ventas',
            icon: 'fas fa-sack-dollar',
            id: 'menu-facturacion',
            url: 'ventas_y_facturacion.html',
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Operaciones',
                    items: [
                        { label: 'Punto de Venta (POS)', url: 'emitir_ticket.html' },
                        { label: 'Arqueo de Caja Diario', url: 'arqueo_caja.html' }
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
                        { label: 'Lista de Precios', url: 'precios_de_venta.html' }
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
            label: 'Relaciones con Clientes',
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
            label: 'Producción y Servicios',
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
                        { label: 'Flujo de Caja', url: 'flujo_de_caja.html' },
                        { label: 'Cuentas por Cobrar', url: 'cuentas_por_cobrar.html' },
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
        },
        {
            type: 'accordion',
            label: 'Especialidades',
            icon: 'fas fa-star',
            id: 'menu-especialidades',
            url: '', 
            defaultOpen: false,
            groups: [
                {
                    subtitle: 'Desarrollos a Medida',
                    items: [
                        { label: 'Hub de Páginas Web', url: 'gestion_paginas_web.html', required_specialty: 'landing_page' }
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

        // Inyectar Estilos Estructurales Nativos para esta nueva versión dark
        if (!document.getElementById('sidebar-amber-styles')) {
            const style = document.createElement('style');
            style.id = 'sidebar-amber-styles';
            style.innerHTML = `
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
                
                .sidebar.collapsed { width: 80px; }
                .sidebar.collapsed ~ .content-area { margin-left: 80px !important; }
                .sidebar.collapsed .sidebar-header span,
                .sidebar.collapsed .nav-text,
                .sidebar.collapsed .text-\\[10px\\],
                .sidebar.collapsed .text-\\[9px\\],
                .sidebar.collapsed .sidebar-accordion-content,
                .sidebar.collapsed .fa-chevron-down,
                .sidebar.collapsed .sidebar-footer span {
                    display: none !important;
                }
                .sidebar.collapsed .sidebar-header { padding: 1rem 0; justify-content: center; }
                .sidebar.collapsed .flex-grow { justify-content: center; margin: 0; }
                
                .sidebar {
                    width: 280px;
                    height: 100vh;
                    position: fixed;
                    left: 0;
                    top: 0;
                    background-color: #020617; 
                    border-right: 1px solid rgba(255, 255, 255, 0.05); 
                    display: flex;
                    flex-direction: column;
                    z-index: 50;
                    transition: width 0.3s ease;
                    box-shadow: 5px 0 25px -5px rgba(0, 0, 0, 0.5);
                }
                .sidebar-accordion-content { max-height: 0; overflow: hidden; transition: max-height 0.4s ease-in-out; }
                .sidebar-sublink {
                    display: block;
                    padding: 0.5rem 1rem 0.5rem 2.5rem;
                    font-size: 0.85rem;
                    color: #64748b; 
                    border-radius: 0.5rem;
                    transition: all 0.2s ease;
                    text-decoration: none;
                }
                .sidebar-sublink:hover {
                    color: #f59e0b; 
                    background-color: rgba(30, 41, 59, 0.5); 
                    padding-left: 2.75rem; 
                }
                .sidebar-sublink.active {
                    color: #f8fafc;
                    font-weight: 600;
                    background-color: rgba(245, 158, 11, 0.15); 
                    border-left: 2px solid #f59e0b;
                }
            `;
            document.head.appendChild(style);
        }

        // --- 1. Preparar Layout ---
        const body = document.body;

        // Crear wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'layout-wrapper relative';

        // Crear content area
        const contentArea = document.createElement('main');
        // Aseguramos que retenga la clase original pero con margin reajustable
        contentArea.className = 'content-area h-full'; 
        contentArea.style.marginLeft = '280px';
        contentArea.style.transition = 'margin-left 0.3s ease';

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
            contentArea.style.marginLeft = '80px'; // Forzar resincronización layout
        }

        // Header del Sidebar (Logo SVG Amber) - AHORA CLICKABLE
        sidebar.innerHTML = `
            <div class="sidebar-header flex p-5 border-b border-white/5 transition-all" onclick="toggleSidebar()" style="cursor: pointer;" title="Clic para contraer/expandir">
                <div class="flex items-center gap-4 w-full">
                    <div class="w-10 h-10 flex shrink-0 items-center justify-center">
                        <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="w-full h-full drop-shadow-[0_0_10px_rgba(245,158,11,0.3)]">
                          <defs>
                            <linearGradient id="cubeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1" />
                              <stop offset="100%" style="stop-color:#b45309;stop-opacity:1" />
                            </linearGradient>
                          </defs>
                          <path d="M50 30 L80 45 L80 70 L50 85 L20 70 L20 45 Z" fill="url(#cubeGradient)" opacity="0.9" />
                          <path d="M50 10 L80 25 L80 45 L50 30 L20 45 L20 25 Z" fill="url(#cubeGradient)" opacity="1" />
                          <path d="M50 30 L50 85 L80 70 L80 45 Z" fill="#ffffff" opacity="0.2" />
                        </svg>
                    </div>
                    <span class="font-bold text-xl tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400">MicroERP</span>
                </div>
            </div>
            <nav class="sidebar-scroll py-6 flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
                <ul class="sidebar-nav px-2">
                    <!-- Dinámico -->
                </ul>
            </nav>
            <div class="sidebar-footer p-4 border-t border-white/5 bg-slate-950/80 mt-auto">
                <div class="flex items-center gap-3 pl-1">
                    <div class="w-2.5 h-2.5 shrink-0 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)] animate-pulse transition-all"></div>
                    <span class="text-[11px] font-bold text-slate-500 tracking-[0.2em]">SISTEMA CONECTADO</span>
                </div>
            </div>
        `;

        // --- 3. Renderizar Menú ---
        const navList = sidebar.querySelector('.sidebar-nav');
        let moduleCounter = 0;

        finalMenu.forEach(itemConfig => {
            if (itemConfig.type === 'link') {
                const li = document.createElement('li');
                li.className = 'mb-2'; 
                const isActive = page === itemConfig.url;

                li.innerHTML = `
                    <a href="${itemConfig.url}" class="flex items-center gap-3 px-3 py-2 mx-1 rounded-lg transition-all group no-underline text-slate-400 hover:text-white ${isActive ? 'bg-slate-900 border border-slate-800' : 'hover:bg-slate-900'}">
                        <div class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-all ${isActive ? 'bg-slate-950 border-amber-500/50 border text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]' : 'bg-transparent text-slate-500 group-hover:text-amber-500'}">
                            <i class="${itemConfig.icon}"></i>
                        </div>
                        <span class="nav-text font-semibold text-sm whitespace-nowrap transition-colors ${isActive ? 'text-white' : ''}">${itemConfig.label}</span>
                    </a>
                `;
                navList.appendChild(li);
            }
            else if (itemConfig.type === 'accordion') {
                moduleCounter++;
                const li = document.createElement('li');
                li.className = 'nav-section mt-1';

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
                // Determinamos si es un link o un div basado en si hay URL
                const isLink = !!itemConfig.url;
                const tag = isLink ? 'a' : 'div';
                const hrefAttr = isLink ? `href="${itemConfig.url}"` : '';
                const cursorClass = isLink ? 'cursor-pointer' : 'cursor-default';

                li.innerHTML = `
                    <div class="flex items-center justify-between px-3 py-2 rounded-lg mx-1 mb-1 group transition-colors hover:bg-slate-800/40 ${isOpen ? 'bg-slate-900/40' : ''}">
                        <!-- ZONA IZQUIERDA: NAVEGACIÓN (Título e icono) -->
                        <${tag} ${hrefAttr} class="flex items-center gap-3 flex-grow ${cursorClass} no-underline origin-left" ${!isLink ? `onclick="toggleAccordion('${itemConfig.id}')"` : ''}>
                             <div class="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center transition-all bg-slate-900/80 border border-slate-800/80 text-slate-500 group-hover:border-amber-500/50 group-hover:text-amber-500 group-hover:shadow-[0_0_10px_rgba(245,158,11,0.1)] ${isOpen ? 'border-amber-500/50 text-amber-500' : ''}">
                                <i class="${itemConfig.icon} text-[13px]"></i>
                             </div>
                             <div class="flex flex-col items-start leading-tight min-w-0 pr-2">
                                <span class="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] mb-0.5">MÓDULO ${moduleCounter}</span>
                                <span class="nav-text text-[13px] font-bold text-slate-300 group-hover:text-white transition-colors truncate w-full">${itemConfig.label}</span>
                             </div>
                        </${tag}>

                        <!-- ZONA DERECHA: COLAPSO (Solo area del icono) -->
                        <div class="p-1 -mr-1 pr-2 cursor-pointer text-slate-500 group-hover:text-amber-500 transition-colors shrink-0" onclick="toggleAccordion('${itemConfig.id}')" title="Expandir/Contraer">
                            <i class="fas fa-chevron-down text-[10px] transition-transform duration-300 ${isOpen ? 'rotate-180 text-amber-500' : ''}" id="icon-${itemConfig.id}"></i>
                        </div>
                    </div>

                    <div id="${itemConfig.id}" class="sidebar-accordion-content ${isOpen ? 'expanded' : ''}">
                        <div class="py-1">
                             <!-- Grupos se insertan aquí -->
                        </div>
                    </div>
                `;

                // Container interno
                const innerContainer = li.querySelector('.sidebar-accordion-content > div');

                itemConfig.groups.forEach(group => {
                    if (group.hiddenInSidebar) return;

                    const groupDiv = document.createElement('div');
                    groupDiv.className = 'mb-3 mt-1'; // Espaciado entre grupos

                    // Subtítulo (Color Amber corporativo)
                    groupDiv.innerHTML = `<div class="px-5 py-1 text-[10px] font-bold text-slate-600 uppercase tracking-[0.15em] pl-7 mb-1.5">${group.subtitle}</div>`;

                    // Items del grupo
                    const ul = document.createElement('ul');
                    ul.className = 'space-y-[2px] mx-2'; 

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
            const parentDiv = content.previousElementSibling;

            if (content.style.maxHeight || content.classList.contains('expanded')) {
                content.style.maxHeight = null;
                content.classList.remove('expanded');
                icon.classList.remove('rotate-180', 'text-amber-500');
                parentDiv.classList.remove('bg-slate-900/40');
                const iconDiv = parentDiv.querySelector('.w-8');
                iconDiv.classList.remove('border-amber-500/50', 'text-amber-500');
                localStorage.setItem(`sidebar_state_v2_${id}`, 'false'); // Guardar estado cerrado
            } else {
                content.classList.add('expanded');
                content.style.maxHeight = content.scrollHeight + "px"; // Animación smooth
                icon.classList.add('rotate-180', 'text-amber-500');
                parentDiv.classList.add('bg-slate-900/40');
                const iconDiv = parentDiv.querySelector('.w-8');
                iconDiv.classList.add('border-amber-500/50', 'text-amber-500');
                localStorage.setItem(`sidebar_state_v2_${id}`, 'true'); // Guardar estado abierto
            }
        };

        // Función Global para Colapsar Sidebar
        window.toggleSidebar = function () {
            const sidebar = document.querySelector('.sidebar');
            const contentArea = document.querySelector('.content-area');
            sidebar.classList.toggle('collapsed');
            if (sidebar.classList.contains('collapsed')) {
                contentArea.style.marginLeft = '80px';
            } else {
                contentArea.style.marginLeft = '280px';
            }
            localStorage.setItem('sidebar_is_collapsed', sidebar.classList.contains('collapsed'));
        };

        // Recalcular height si comienza expandido (solo si es visible)
        setTimeout(() => {
            document.querySelectorAll('.sidebar-accordion-content.expanded').forEach(el => {
                if (el.scrollHeight > 0) {
                    el.style.maxHeight = el.scrollHeight + "px";
                    const parentDiv = el.previousElementSibling;
                    const iconDiv = parentDiv.querySelector('.w-8');
                    iconDiv.classList.add('border-amber-500/50', 'text-amber-500');
                }
            });
        }, 100);
    };
})();

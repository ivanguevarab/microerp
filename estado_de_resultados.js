// estado_de_resultados.js

let currentEmpresaId = null;
let dataOraculo = null;
let sortableInstances = [];
let variablesState = [];

const EXCLUSIONES = {
    'VENTAS_NETAS': ['Ventas al Contado', 'Ventas al Crédito'],
    'COGS': ['Compras al Contado', 'Pago a Proveedores (Amortización de Créditos)']
};

document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    const { data: perfil } = await window.supabaseClient.from('perfiles_usuario').select('empresa_id').eq('id', window.currentUser.id).single();
    currentEmpresaId = perfil.empresa_id;

    initFechas();
    initSortables();
});

function initFechas() {
    const hoy = new Date();
    const cm = hoy.getMonth() + 1;
    const cy = hoy.getFullYear();

    document.getElementById('mesSelect').value = cm;
    
    const selAnio = document.getElementById('anioSelect');
    for(let i = cy; i >= cy - 2; i--) {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = i;
        selAnio.appendChild(opt);
    }

    const primerDia = new Date(cy, cm - 1, 1).toLocaleDateString('en-CA');
    const ultimoDia = new Date(cy, cm, 0).toLocaleDateString('en-CA');
    
    document.getElementById('fechaDesde').value = primerDia;
    document.getElementById('fechaHasta').value = ultimoDia;
}

function toggleFiltroRango() {
    const isRango = document.getElementById('toggleRango').checked;
    if(isRango) {
        document.getElementById('contenedorMesAnio').classList.add('hidden');
        document.getElementById('contenedorFechas').classList.remove('hidden');
        document.getElementById('contenedorFechas').classList.add('flex');
    } else {
        document.getElementById('contenedorFechas').classList.add('hidden');
        document.getElementById('contenedorFechas').classList.remove('flex');
        document.getElementById('contenedorMesAnio').classList.remove('hidden');
    }
}

function getFiltrosActuales() {
    const isRango = document.getElementById('toggleRango').checked;
    let desde, hasta, texto;
    
    if(isRango) {
        desde = document.getElementById('fechaDesde').value;
        hasta = document.getElementById('fechaHasta').value;
        texto = `RANGO: ${desde} AL ${hasta}`;
    } else {
        const mes = parseInt(document.getElementById('mesSelect').value);
        const anio = parseInt(document.getElementById('anioSelect').value);
        desde = new Date(anio, mes - 1, 1).toLocaleDateString('en-CA');
        hasta = new Date(anio, mes, 0).toLocaleDateString('en-CA');
        texto = `PERIODO: ${document.getElementById('mesSelect').options[mes-1].text.toUpperCase()} ${anio}`;
    }
    return { desde, hasta, texto };
}

function initSortables() {
    const commonOptions = {
        group: 'pnl-blocks',
        animation: 150,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        filter: '.disabled-item', 
        onEnd: function (evt) {
            evaluarRedundanciasModal();
            sincronizarEstadoDesdeDOM();
            calcularPnlModal();
        }
    };

    sortableInstances.push(new Sortable(document.getElementById('catalogo-disponibles'), {
        ...commonOptions,
        sort: false 
    }));

    document.querySelectorAll('.pnl-container').forEach(el => {
        sortableInstances.push(new Sortable(el, { ...commonOptions }));
    });
}

async function cargarOraculoFinanciero() {
    const f = getFiltrosActuales();
    if(!f.desde || !f.hasta) return;
    
    document.getElementById('fechaActualDisplay').textContent = f.texto;
    Swal.fire({ title: 'Oráculo Financiero', text: 'Consolidando devengado y flujo de caja...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); }});

    try {
        const { data, error } = await window.supabaseClient.rpc('rpc_oraculo_estado_resultados', {
            p_empresa_id: currentEmpresaId,
            p_fecha_desde: f.desde,
            p_fecha_hasta: f.hasta
        });

        if (error) throw error;
        dataOraculo = data;
        
        const { data: saldoData } = await window.supabaseClient
            .from('fc_saldos_diarios')
            .select('saldo_inicial')
            .eq('empresa_id', currentEmpresaId)
            .eq('fecha', f.desde)
            .single();
            
        dataOraculo.saldo_inicial_caja = saldoData ? parseFloat(saldoData.saldo_inicial) : 0;

        construirEstadoInicial();
        
        document.getElementById('welcome-placeholder').classList.add('hidden');
        document.getElementById('main-report-container').classList.remove('hidden');
        document.getElementById('btnConfigurar').classList.remove('hidden');

        renderizarDashboardPrincipal();
        
        Swal.close();
    } catch (e) {
        console.error("Error oráculo:", e);
        Swal.fire('Error', 'Fallo al procesar el oráculo financiero.', 'error');
    }
}

function construirEstadoInicial() {
    variablesState = [];
    if(dataOraculo.rentabilidad) {
        variablesState.push({origen: 'SISTEMA', id: 'VENTAS_NETAS', nombre: 'Ventas Netas Totales', monto: parseFloat(dataOraculo.rentabilidad.ventas_netas), tipo: 'INGRESO', etiqueta: 'Devengado', container: null});
        variablesState.push({origen: 'SISTEMA', id: 'COGS', nombre: 'Costo de Ventas (COGS)', monto: parseFloat(dataOraculo.rentabilidad.costo_ventas), tipo: 'EGRESO', etiqueta: 'Devengado', container: null});
    }
    if(dataOraculo.flujo_caja && dataOraculo.flujo_caja.length > 0) {
        dataOraculo.flujo_caja.forEach(c => {
            variablesState.push({origen: 'FC_CATEGORIA', id: c.categoria_id, nombre: c.nombre, monto: parseFloat(c.monto), tipo: c.tipo_movimiento, etiqueta: 'Caja Real', container: null});
        });
    }
    
    // Plantilla Tradicional (Hardcoded v1)
    const setContainer = (nombre, dest) => {
        const item = variablesState.find(v => v.nombre.includes(nombre));
        if(item) item.container = dest;
    };
    
    setContainer('Ventas Netas Totales', 'INGRESOS_OPERATIVOS');
    setContainer('Costo de Ventas (COGS)', 'COSTOS_DIRECTOS');
    
    // Mapeo correcto de las categorías actuales de la BD
    setContainer('Pago Remuneraciones', 'GASTOS_OPERATIVOS');
    setContainer('Gasto Administrativo', 'GASTOS_OPERATIVOS');
    setContainer('Gasto Operativo', 'GASTOS_OPERATIVOS');
    setContainer('Gasto de Ventas', 'GASTOS_OPERATIVOS');
    setContainer('Beneficio a los Trabajadores', 'GASTOS_OPERATIVOS');
    setContainer('Beneficio a Trabajadores', 'GASTOS_OPERATIVOS'); // Contingencia
    setContainer('Pago Servicios Básicos', 'GASTOS_OPERATIVOS'); // Por si acaso existiera aún
    
    setContainer('Pago Impuestos', 'IMPUESTOS');
    setContainer('Otros Ingresos', 'OTROS_INGRESOS_EGRESOS');
    setContainer('Otros Egresos', 'OTROS_INGRESOS_EGRESOS');
}

// ============================================================================
// LOGICA DE RENDERIZADO DEL REPORTE PRINCIPAL (SOLO LECTURA)
// ============================================================================

function renderizarDashboardPrincipal() {
    const contenedoresMap = {
        'INGRESOS_OPERATIVOS': { titulo: '(+) Ingresos Operativos', items: [], signo: '+', collapse: false },
        'COSTOS_DIRECTOS': { titulo: '(-) Costos Directos / COGS', items: [], signo: '-', collapse: false },
        'GASTOS_OPERATIVOS': { titulo: '(-) Gastos Operativos Totales', items: [], signo: '-', collapse: true },
        'OTROS_INGRESOS_EGRESOS': { titulo: 'Otros Ingresos / Egresos', items: [], signo: 'auto', collapse: false },
        'IMPUESTOS': { titulo: '(-) Impuestos (IGV, Renta)', items: [], signo: '-', collapse: false }
    };

    // Distribuir estado actual
    variablesState.forEach(v => {
        if(v.container && contenedoresMap[v.container]) {
            contenedoresMap[v.container].items.push(v);
        }
    });

    let uBruta = 0, uOperativa = 0, uNeta = 0;
    const domEl = document.getElementById('reporte-gerencial-content');
    
    let html = `<div class="w-full flex flex-col text-[14px] text-slate-300 font-medium tracking-wide">`;

    const formatMonto = (num) => num < 0 
        ? `(${Math.abs(num).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})})` 
        : num.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});

    const renderFila = (nombre, monto, isBold = false, isIndented = false, isSubtotal = false, customClasses = '') => {
        let classes = "flex justify-between py-2.5 px-2 hover:bg-slate-800/30 transition-colors rounded ";
        if (isBold) classes += " font-bold text-white ";
        if (isIndented) classes += " pl-8 text-[13px] text-slate-400 ";
        if (isSubtotal) classes += " border-t border-b border-slate-700/50 my-2 py-3 font-bold text-white ";
        classes += customClasses;
        
        return `<div class="${classes}">
            <span>${nombre}</span>
            <span>${formatMonto(monto)}</span>
        </div>`;
    };

    // 1. INGRESOS
    let totalIngresos = 0;
    contenedoresMap['INGRESOS_OPERATIVOS'].items.forEach(item => {
        totalIngresos += item.monto;
        html += renderFila(item.nombre, item.monto);
    });
    uBruta += totalIngresos;

    // 2. COSTOS
    let totalCostos = 0;
    contenedoresMap['COSTOS_DIRECTOS'].items.forEach(item => {
        totalCostos += item.monto;
        html += renderFila(`(-) ${item.nombre}`, -item.monto); 
    });
    uBruta -= totalCostos;

    // SUBTOTAL BRUTA
    html += renderFila('(=) Utilidad Bruta', uBruta, false, false, true);

    // 3. GASTOS OPERATIVOS (Agrupados)
    let totalGastos = 0;
    contenedoresMap['GASTOS_OPERATIVOS'].items.forEach(item => totalGastos += item.monto);
    
    if (contenedoresMap['GASTOS_OPERATIVOS'].items.length > 0) {
        html += renderFila(contenedoresMap['GASTOS_OPERATIVOS'].titulo, -totalGastos, true);
        contenedoresMap['GASTOS_OPERATIVOS'].items.forEach(item => {
            html += renderFila(item.nombre, -item.monto, false, true);
        });
    }
    uOperativa = uBruta - totalGastos;

    // SUBTOTAL OPERATIVA
    html += `<div class="mt-4"></div>`; // spacer
    html += renderFila('(=) Utilidad Operativa', uOperativa, false, false, true);

    // 4. OTROS INGRESOS/EGRESOS
    let totalOtros = 0;
    contenedoresMap['OTROS_INGRESOS_EGRESOS'].items.forEach(item => {
        const val = item.tipo === 'INGRESO' ? item.monto : -item.monto;
        totalOtros += val;
        html += renderFila(item.nombre, val);
    });
    uNeta = uOperativa + totalOtros;

    // 5. IMPUESTOS
    let totalImpuestos = 0;
    contenedoresMap['IMPUESTOS'].items.forEach(item => {
        totalImpuestos += item.monto;
        html += renderFila(`(-) ${item.nombre}`, -item.monto);
    });
    uNeta -= totalImpuestos;

    // SUBTOTAL NETA
    html += `<div class="mt-6"></div>`; // spacer
    const colorNeta = uNeta >= 0 ? 'text-emerald-400 border-emerald-500/30' : 'text-rose-400 border-rose-500/30';
    html += renderFila('(=) Utilidad Neta Generada', uNeta, false, false, true, colorNeta + ' text-lg bg-slate-900/50 shadow-inner');

    html += `</div>`;
    domEl.innerHTML = html;

    // Ejecutar Conciliación Principal
    ejecutarConciliacionGlobal(uNeta, 'main');
}

// ============================================================================
// LOGICA DEL MODAL CONSTRUCTOR
// ============================================================================

function abrirModalConstructor() {
    document.getElementById('modal-constructor-pnl').classList.remove('hidden');
    
    // Limpiar DOM del Modal
    document.getElementById('catalogo-disponibles').innerHTML = '';
    document.querySelectorAll('.pnl-container').forEach(el => el.innerHTML = '');

    // Inyectar State al DOM del Modal
    variablesState.forEach(v => {
        const bloqueHTML = crearBloqueHTML(v);
        if (v.container) {
            const dest = document.querySelector(`.pnl-container[data-container="${v.container}"]`);
            if(dest) dest.insertAdjacentHTML('beforeend', bloqueHTML);
        } else {
            document.getElementById('catalogo-disponibles').insertAdjacentHTML('beforeend', bloqueHTML);
        }
    });

    evaluarRedundanciasModal();
    calcularPnlModal();
}

function cerrarModalConstructor() {
    document.getElementById('modal-constructor-pnl').classList.add('hidden');
    // Al cancelar, no sincronizamos desde el DOM, se mantiene el variablesState original.
}

function guardarDisenoYRenderizar() {
    sincronizarEstadoDesdeDOM(); // Guardar lo modificado
    cerrarModalConstructor();
    renderizarDashboardPrincipal();
    Swal.fire({
        icon: 'success',
        title: 'Diseño Aplicado',
        text: 'La plantilla ha sido aplicada al reporte principal.',
        background: '#1e293b', color: '#f8fafc',
        confirmButtonColor: '#10b981',
        timer: 1500, showConfirmButton: false
    });
}

function crearBloqueHTML(v) {
    let icon = v.tipo === 'INGRESO' ? '<i class="fas fa-arrow-up text-emerald-500"></i>' : '<i class="fas fa-arrow-down text-rose-500"></i>';
    if(v.origen === 'SISTEMA') icon = '<i class="fas fa-laptop-code text-blue-400"></i>';

    return `
        <div class="drag-item bg-slate-800 text-sm font-semibold text-slate-200" 
             data-origen="${v.origen}" data-id="${v.id}" data-nombre="${v.nombre}" data-monto="${v.monto}" data-tipo="${v.tipo}">
            <div class="flex items-center gap-3">
                <i class="fas fa-grip-vertical text-slate-500 opacity-50"></i>
                <div class="flex flex-col">
                    <span>${v.nombre}</span>
                    <span class="text-[9px] text-slate-400 uppercase tracking-widest">${v.etiqueta}</span>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <span class="font-bold ${v.tipo === 'INGRESO' ? 'text-emerald-400' : 'text-rose-400'}">S/ ${v.monto.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                ${icon}
            </div>
        </div>
    `;
}

function sincronizarEstadoDesdeDOM() {
    // Limpiar containers en el State
    variablesState.forEach(v => v.container = null);
    
    // Asignar desde los drop-zones
    document.querySelectorAll('.pnl-container').forEach(containerEl => {
        const cName = containerEl.dataset.container;
        containerEl.querySelectorAll('.drag-item').forEach(itemEl => {
            const v = variablesState.find(st => st.id === itemEl.dataset.id);
            if(v) v.container = cName;
        });
    });
}

function evaluarRedundanciasModal() {
    const disponibles = document.querySelectorAll('#catalogo-disponibles .drag-item');
    disponibles.forEach(el => el.classList.remove('disabled-item'));

    const enUso = Array.from(document.querySelectorAll('.pnl-container .drag-item')).map(el => el.dataset.id);
    
    if (enUso.includes('VENTAS_NETAS')) {
        EXCLUSIONES['VENTAS_NETAS'].forEach(nombreExcluir => {
            const el = Array.from(disponibles).find(b => b.dataset.nombre === nombreExcluir);
            if (el) el.classList.add('disabled-item');
        });
    }

    if (enUso.includes('COGS')) {
        EXCLUSIONES['COGS'].forEach(nombreExcluir => {
            const el = Array.from(disponibles).find(b => b.dataset.nombre.includes(nombreExcluir));
            if (el) el.classList.add('disabled-item');
        });
    }
}

function calcularPnlModal() {
    const sumarContenedor = (id, sign_mode) => {
        let total = 0;
        document.querySelectorAll(`#${id} .drag-item`).forEach(el => {
            const monto = parseFloat(el.dataset.monto);
            const tipo = el.dataset.tipo; 
            if (sign_mode === '+') total += monto;
            else if (sign_mode === '-') total += monto;
            else if (sign_mode === 'auto') {
                if (tipo === 'INGRESO') total += monto; else total -= monto;
            }
        });
        return total;
    };

    const ingresos = sumarContenedor('c-ingresos', '+');
    const costos = sumarContenedor('c-costos', '-');
    const uBruta = ingresos - costos;

    const gastos = sumarContenedor('c-gastos', '-');
    const uOperativa = uBruta - gastos;

    const otros = sumarContenedor('c-otros', 'auto');
    const impuestos = sumarContenedor('c-impuestos', '-');
    const uNeta = uOperativa + otros - impuestos;

    document.getElementById('sub-bruta').textContent = `S/ ${uBruta.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    document.getElementById('sub-operativa').textContent = `S/ ${uOperativa.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    document.getElementById('sub-neta').textContent = `S/ ${uNeta.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;

    ejecutarConciliacionGlobal(uNeta, 'modal');
}

// ============================================================================
// MOTOR DE CONCILIACION UNIVERSAL
// ============================================================================

function ejecutarConciliacionGlobal(utilidadNeta, target) {
    // Utiliza variablesState (para main) o el DOM (para modal)
    // Pero como sincronizamos antes, podemos usar variablesState directamente.
    
    let enUsoIds = [];
    let disponiblesVars = [];

    if (target === 'modal') {
        enUsoIds = Array.from(document.querySelectorAll('.pnl-container .drag-item')).map(el => el.dataset.id);
        const dispNodes = Array.from(document.querySelectorAll('#catalogo-disponibles .drag-item'));
        disponiblesVars = dispNodes.map(el => ({
            nombre: el.dataset.nombre,
            monto: parseFloat(el.dataset.monto),
            origen: el.dataset.origen,
            tipo: el.dataset.tipo,
            disabled: el.classList.contains('disabled-item')
        }));
    } else {
        enUsoIds = variablesState.filter(v => v.container !== null).map(v => v.id);
        disponiblesVars = variablesState.filter(v => v.container === null).map(v => ({
            nombre: v.nombre,
            monto: parseFloat(v.monto),
            origen: v.origen,
            tipo: v.tipo,
            // Simulamos redundancia en RAM
            disabled: (enUsoIds.includes('VENTAS_NETAS') && EXCLUSIONES['VENTAS_NETAS'].includes(v.nombre)) ||
                      (enUsoIds.includes('COGS') && EXCLUSIONES['COGS'].some(ex => v.nombre.includes(ex)))
        }));
    }

    let dineroEnLaCalle = 0;
    let inversionAlmacen = 0;
    let movimientosPatrimoniales = 0;

    // 1. Dinero en la calle (Puente Ventas)
    if (enUsoIds.includes('VENTAS_NETAS')) {
        const vnetas = (target==='modal') 
            ? parseFloat(document.querySelector('.pnl-container .drag-item[data-id="VENTAS_NETAS"]').dataset.monto) 
            : variablesState.find(v => v.id === 'VENTAS_NETAS').monto;
        
        let cobros = 0;
        EXCLUSIONES['VENTAS_NETAS'].forEach(nom => {
            const el = disponiblesVars.find(b => b.nombre.includes(nom));
            if(el) cobros += el.monto;
        });
        dineroEnLaCalle = cobros - vnetas;
    }

    // 2. Inversión Almacén (Puente COGS)
    let desgloseAlmacen = [];
    if (enUsoIds.includes('COGS')) {
        const cogs = (target==='modal') 
            ? parseFloat(document.querySelector('.pnl-container .drag-item[data-id="COGS"]').dataset.monto) 
            : variablesState.find(v => v.id === 'COGS').monto;
        
        let pagos = 0;
        EXCLUSIONES['COGS'].forEach(nom => {
            const el = disponiblesVars.find(b => b.nombre.includes(nom));
            if(el && el.monto !== 0) {
                pagos += el.monto;
                let displayName = el.nombre;
                if(displayName.includes('Compras al Contado')) {
                    displayName = 'Compras al Contado (Kardex)';
                }
                desgloseAlmacen.push({ nombre: displayName, monto: el.monto, tipo: 'EGRESO' });
            }
        });
        inversionAlmacen = cogs - pagos;
        if(cogs !== 0) {
            desgloseAlmacen.push({ nombre: 'Costo de Ventas (COGS) [Devengado]', monto: cogs, tipo: 'INGRESO' });
        }
    }

    // 3. Movimientos Patrimoniales
    let desglosePatrimonial = [];
    disponiblesVars.filter(el => !el.disabled && el.origen !== 'SISTEMA').forEach(el => {
        if (el.tipo === 'INGRESO') {
            movimientosPatrimoniales += el.monto;
            if (el.monto !== 0) desglosePatrimonial.push({ nombre: el.nombre, monto: el.monto, tipo: 'INGRESO' });
        } else {
            movimientosPatrimoniales -= el.monto;
            if (el.monto !== 0) desglosePatrimonial.push({ nombre: el.nombre, monto: el.monto, tipo: 'EGRESO' });
        }
    });

    const variacionCaja = utilidadNeta + dineroEnLaCalle + inversionAlmacen + movimientosPatrimoniales;
    const saldoInicial = dataOraculo.saldo_inicial_caja || 0;
    const saldoFinal = saldoInicial + variacionCaja;

    const formatMonto = (num) => num < 0 
        ? `(S/ ${Math.abs(num).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})})` 
        : `S/ ${num.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`;

    // Renderizar según target
    const prefix = target === 'main' ? 'main-' : 'modal-';
    
    document.getElementById(`${prefix}concil-neta`).textContent = target === 'main' ? formatMonto(utilidadNeta) : `Utilidad: ${formatMonto(utilidadNeta)}`;
    
    document.getElementById(`${prefix}concil-creditos`).textContent = formatMonto(dineroEnLaCalle);
    
    document.getElementById(`${prefix}concil-almacen`).textContent = formatMonto(inversionAlmacen);
    
    document.getElementById(`${prefix}concil-patrimonial`).textContent = formatMonto(movimientosPatrimoniales);
    
    if(target === 'main') {
        const nestedAlmacen = document.getElementById('nested-concil-almacen');
        if(nestedAlmacen) {
            nestedAlmacen.innerHTML = desgloseAlmacen.map(item => `
                <div class="flex justify-between">
                    <span>${item.nombre}</span>
                    <span>${item.tipo === 'EGRESO' ? `(S/ ${Math.abs(item.monto).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})})` : `S/ ${Math.abs(item.monto).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`}</span>
                </div>
            `).join('');
            nestedAlmacen.classList.remove('hidden');
        }

        const nestedPatrimonial = document.getElementById('nested-concil-patrimonial');
        if(nestedPatrimonial) {
            nestedPatrimonial.innerHTML = desglosePatrimonial.map(item => `
                <div class="flex justify-between">
                    <span>${item.nombre}</span>
                    <span>${item.tipo === 'EGRESO' ? `(S/ ${Math.abs(item.monto).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})})` : `S/ ${Math.abs(item.monto).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`}</span>
                </div>
            `).join('');
            nestedPatrimonial.classList.remove('hidden');
        }

        document.getElementById(`main-concil-variacion`).textContent = formatMonto(variacionCaja);
        document.getElementById(`main-concil-variacion-2`).textContent = formatMonto(variacionCaja);
        document.getElementById(`main-concil-inicial`).textContent = formatMonto(saldoInicial);
    }
    
    document.getElementById(`${prefix}concil-final`).textContent = formatMonto(saldoFinal);
}

function filtrarCatologo() {
    const term = document.getElementById('buscadorVariables').value.toLowerCase();
    document.querySelectorAll('#catalogo-disponibles .drag-item').forEach(el => {
        const text = el.dataset.nombre.toLowerCase();
        el.style.display = text.includes(term) ? 'flex' : 'none';
    });
}

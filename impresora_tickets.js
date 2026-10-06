// Motor Centralizado de Impresión de Tickets (MicroERP) - Formato CSS @media print estilo CUS
// =======================================================================================
function asegurarEstilosImpresion() {
    if (!document.getElementById('microerp-print-css')) {
        const style = document.createElement('style');
        style.id = 'microerp-print-css';
        style.innerHTML = `
            #microerp-print-container {
                display: none; /* Oculto en la interfaz normal */
                width: 100mm;  /* Ancho 100mm = 10cm */
                font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                font-weight: 700;
                letter-spacing: 0.15px;
                color: #000;
                background: #fff;
                padding: 5px 3mm;
                box-sizing: border-box;
                margin: 0 auto;
                line-height: 1.15;
            }
            #microerp-print-container * {
                font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
                font-variant-numeric: tabular-nums;
                font-feature-settings: "tnum";
                font-weight: 700 !important;
                color: #000 !important;
                box-sizing: border-box;
            }
            .ticket-header { font-size: 15px; margin: 1px 0; text-align: center; text-transform: uppercase; font-weight: 700; line-height: 1.15; }
            .ticket-text { margin: 1px 0; font-size: 11.5px; text-align: center; line-height: 1.15; }
            .ticket-divisor { border-top: 1px dashed #000; margin: 3px 0; width: 100%; }
            .print-ticket-table { width: 100%; border-collapse: collapse; font-size: 11.5px; margin: 2px 0; table-layout: fixed; }
            .print-ticket-table th { border-bottom: 1px solid #000; padding-bottom: 2px; }
            .print-ticket-table td { padding: 0; }
            .print-ticket-table tr.item-row td { padding: 0 0 1px 0; }
            .print-ticket-table .col-desc { width: 38%; text-align: left; }
            .print-ticket-table .col-cant { width: 20%; text-align: right; padding-right: 5px; white-space: nowrap; }
            .print-ticket-table .col-punit { width: 21%; text-align: right; }
            .print-ticket-table .col-ptot { width: 21%; text-align: right; }
            .ticket-totales { display: grid; grid-template-columns: 1fr 1fr; font-size: 12px; margin-top: 2px; line-height: 1.15; }
            .ticket-totales div:nth-child(even) { text-align: right; }
            .ticket-gran-total { font-size: 15px; font-weight: 700; margin-top: 3px; border-top: 1.5px solid #000; padding-top: 2px; }
            
            /* REGLAS MÁGICAS DE IMPRESIÓN (Para Ticketeras de 80mm) */
            @media print {
                @page { margin: 0; size: 80mm auto; }
                body { margin: 0; padding: 0; background: #fff; }
                
                body.printing-ticket > *:not(#microerp-print-container) {
                    display: none !important;
                }
                body.printing-ticket #print-report-container {
                    display: none !important;
                }
                body.printing-ticket #microerp-print-container,
                body.printing-ticket #microerp-print-container * {
                    visibility: visible;
                }
                body.printing-ticket #microerp-print-container {
                    display: block !important;
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 76mm; /* Ajuste interno para la bobina de 80mm dejando pequeño margen */
                    margin: 0;
                    padding: 1.5mm;
                }
            }
        `;
        if (document.head) {
            document.head.appendChild(style);
        } else if (document.body) {
            document.body.appendChild(style);
        }
    }
}

function asegurarContenedorImpresion() {
    asegurarEstilosImpresion();
    let container = document.getElementById('microerp-print-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'microerp-print-container';
    }
    if (document.body && container.parentElement !== document.body) {
        document.body.appendChild(container); // Garantizar que sea hijo directo de body (Bypassing sidebar.js wrapper)
    }
    return container;
}

(function () {
    asegurarEstilosImpresion();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', asegurarContenedorImpresion);
    } else {
        asegurarContenedorImpresion();
    }
})();

function formatMoney(amount, maxDigits = 2) {
    return Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxDigits });
}

async function imprimirTicketCerrado(ventaId, montoRecibido = 0, vuelto = 0, datosEnMemoria = null) {
    try {
        Swal.fire({ title: 'Preparando Impresión...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });

        let v, det, emp, direccionTicket, dicc = {}, diccUM = {};

        if (datosEnMemoria) {
            // MODO ULTRARRÁPIDO EN MEMORIA (0 peticiones a la BD)
            v = datosEnMemoria.venta;
            det = datosEnMemoria.detalles || [];
            emp = datosEnMemoria.empresa || {};
            direccionTicket = datosEnMemoria.almacenNombre || emp?.direccion || 'Sede Principal';
            dicc = datosEnMemoria.dicc || {};
            diccUM = datosEnMemoria.diccUM || {};
            if (datosEnMemoria.cliente) {
                v.clientes = datosEnMemoria.cliente;
            }
        } else {
            // 1. Obtener Datos de la Venta (con Fallback Offline a IndexedDB)
            let vBD = null;
            let detBD = null;

            if (navigator.onLine && !window.isOfflineState && window.supabaseClient) {
                try {
                    const queryV = window.supabaseClient.from('ventas')
                        .select('*, clientes(*)')
                        .eq('id', ventaId).maybeSingle();
                    const { data: vData } = await (window.fetchConTimeout ? window.fetchConTimeout(queryV, 1200) : queryV);
                    if (vData) {
                        vBD = vData;
                        const queryD = window.supabaseClient.from('ventas_detalle').select('*').eq('venta_id', ventaId);
                        const { data: dData } = await (window.fetchConTimeout ? window.fetchConTimeout(queryD, 1200) : queryD);
                        detBD = dData || [];
                    }
                } catch (eNet) {
                    console.warn("Fallo de red al consultar ticket en Supabase:", eNet);
                }
            }

            let esVentaLocal = false;

            // Fallback a histórico local y cola offline en IndexedDB
            if (!vBD && window.MicroERPOffline) {
                const vOff = await window.MicroERPOffline.obtenerVentaPorIdLocal(ventaId);
                if (vOff) {
                    vBD = vOff;
                    detBD = vOff.detalles || [];
                    const snap = await window.MicroERPOffline.obtenerSnapshotCatalogo(vOff.empresa_id);
                    emp = snap?.empresa || { nombre_comercial: 'MicroERP', razon_social: 'MicroERP', ruc: '---' };

                    // Rescatar punto de venta / almacén con fidelidad exacta
                    let dirLocal = vOff.almacen_nombre || vOff.almacen_direccion || vOff.direccion_ticket;
                    if (!dirLocal && snap?.almacenes && snap.almacenes.length > 0) {
                        const targetAlmId = vOff.almacen_origen_id || localStorage.getItem('microerp_pos_almacen');
                        const matchedAlm = snap.almacenes.find(a => String(a.id) === String(targetAlmId)) || snap.almacenes[0];
                        if (matchedAlm) {
                            dirLocal = matchedAlm.nombre || '';
                            if (matchedAlm.descripcion) {
                                dirLocal = dirLocal ? `${dirLocal} - ${matchedAlm.descripcion}` : matchedAlm.descripcion;
                            }
                        }
                    }
                    if (!dirLocal) {
                        dirLocal = localStorage.getItem('microerp_pos_almacen_nombre') || '';
                    }
                    direccionTicket = dirLocal || emp.direccion || 'Sede Principal';

                    vBD.clientes = vOff.clientes || (snap?.clientes || []).find(c => c.id === vOff.cliente_id) || { razon_social: 'Cliente NN', numero_documento: '---' };
                    (snap?.items || []).forEach(it => {
                        dicc[it.id] = it.descripcion;
                        diccUM[it.id] = it.unidad_medida || 'NIU';
                    });
                    // Si el detalle ya traía descripción, usarlo como diccionario directo
                    (detBD || []).forEach(d => {
                        if (d.referencia_id && d.descripcion && !dicc[d.referencia_id]) {
                            dicc[d.referencia_id] = d.descripcion;
                        }
                    });
                    esVentaLocal = true;
                }
            }

            if (!vBD) throw new Error("No se encontró la cabecera del ticket ni en servidor ni en terminal local.");
            v = vBD;
            det = detBD || [];

            // Si es venta de la nube y estamos online, consultar complementos con seguridad y timeout
            if (!esVentaLocal && navigator.onLine && !window.isOfflineState && window.supabaseClient) {
                // 1.2 Recuperar pago inicial si es crédito y estamos reimprimiendo
                if (v.condicion_pago === 'CREDITO' && montoRecibido === 0) {
                    try {
                        const qIni = window.supabaseClient.from('ventas_credito_pagos')
                            .select('monto')
                            .eq('venta_id', ventaId)
                            .eq('tipo_pago', 'INICIAL')
                            .maybeSingle();
                        const { data: pIni } = await (window.fetchConTimeout ? window.fetchConTimeout(qIni, 1000) : qIni);
                        if (pIni) montoRecibido = Number(pIni.monto);
                    } catch (_) {}
                }

                // 1.5 Obtener datos de la empresa por separado
                try {
                    const qEmp = window.supabaseClient.from('empresas')
                        .select('*').eq('id', v.empresa_id).single();
                    const { data: empBD } = await (window.fetchConTimeout ? window.fetchConTimeout(qEmp, 1000) : qEmp);
                    if (empBD) emp = empBD;
                } catch (_) {}

                // Obtener dirección del almacén a través del egreso
                try {
                    direccionTicket = emp?.direccion || 'Sede Principal';
                    const qEgr = window.supabaseClient.from('egresos')
                        .select('almacen_origen_id')
                        .eq('observaciones', 'VENTA_REF:' + v.numero_ticket)
                        .limit(1);
                    const { data: egr } = await (window.fetchConTimeout ? window.fetchConTimeout(qEgr, 1000) : qEgr);

                    if (egr && egr.length > 0 && egr[0].almacen_origen_id) {
                        const qAlm = window.supabaseClient.from('almacenes')
                            .select('nombre, descripcion')
                            .eq('id', egr[0].almacen_origen_id)
                            .single();
                        const { data: alm } = await (window.fetchConTimeout ? window.fetchConTimeout(qAlm, 1000) : qAlm);
                        if (alm) {
                            direccionTicket = alm.nombre;
                            if (alm.descripcion) direccionTicket += ' - ' + alm.descripcion;
                            try { localStorage.setItem('microerp_pos_almacen_nombre', direccionTicket); } catch (_) {}
                        }
                    }
                } catch (_) {}

                // Mapeo Diccionario Elementos
                try {
                    const tItems = det.filter(d => d.tipo_item_vendido === 'ITEMS').map(d => d.referencia_id);
                    const tCods = det.filter(d => d.tipo_item_vendido === 'CUS' || d.tipo_item_vendido === 'CUP').map(d => d.referencia_id);
                    if(tItems.length > 0) {
                        const qItems = window.supabaseClient.from('items')
                            .select('id, descripcion, unidad_medida, unidades_medida(codigo)')
                            .in('id', tItems);
                        const { data: iBD } = await (window.fetchConTimeout ? window.fetchConTimeout(qItems, 1000) : qItems);
                        (iBD||[]).forEach(x => {
                            dicc[x.id] = x.descripcion;
                            const uCod = (Array.isArray(x.unidades_medida) ? x.unidades_medida[0]?.codigo : x.unidades_medida?.codigo) || x.unidad_medida || 'NIU';
                            diccUM[x.id] = uCod;
                        });
                    }
                    if(tCods.length > 0) {
                        const qCods = window.supabaseClient.from('codigos_unicos').select('id, descripcion').in('id', tCods);
                        const { data: cBD } = await (window.fetchConTimeout ? window.fetchConTimeout(qCods, 1000) : qCods);
                        (cBD||[]).forEach(x => {
                            dicc[x.id] = x.descripcion;
                            diccUM[x.id] = 'NIU';
                        });
                    }
                } catch (_) {}
            }
        }

        // 2. Construir Datos de Impresión (Empresa, Cliente y Fechas)
        const empresaNombre = emp?.nombre_comercial || emp?.razon_social || emp?.nombre || 'MI EMPRESA';
        const empresaRuc = emp?.ruc || '00000000000';
        const empresaDir = direccionTicket;
        const empresaTel = emp?.telefono || '';

        const clienteNombre = v.clientes?.razon_social || 'Cliente No Identificado (NN)';
        const clienteDoc = v.clientes?.numero_documento || '---';

        let tc = v.created_at || new Date().toISOString();
        if (tc && !tc.includes('Z') && !tc.includes('+') && !tc.match(/-\d\d:?\d\d$/)) {
            tc += 'Z'; // Forzar UTC internamente antes de que JS asuma local
        }
        const dateObj = new Date(tc);
        
        let fechaStr = dateObj.toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
        if (v.fecha_venta) {
            const [y, m, d] = v.fecha_venta.split('T')[0].split('-');
            fechaStr = new Date(y, m - 1, d).toLocaleDateString('es-PE');
        }
        
        const horaStr = dateObj.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' });

        let opInafecta = 0;

        const UMBRAL_CARACTERES_MISMA_LINEA = 13;
        let detallesHTML = '';
        det.forEach((d, index) => {
            const itemPrecioTotal = (d.precio_total !== undefined && d.precio_total !== null)
                ? Number(d.precio_total)
                : ((d.subtotal !== undefined && d.subtotal !== null)
                    ? Number(d.subtotal)
                    : (Number(d.cantidad || 0) * Number(d.precio_unitario || 0)));

            if (v.genera_igv && Number(d.igv_unitario) === 0) {
                opInafecta += itemPrecioTotal;
            }

            const desc = dicc[d.referencia_id] || d.descripcion || 'Servicio Varios';
            const um = diccUM[d.referencia_id] || d.unidad_medida || 'NIU';
            const esCorto = desc.length <= UMBRAL_CARACTERES_MISMA_LINEA;

            if (esCorto) {
                detallesHTML += `
                    <tr class="item-row">
                        <td class="col-desc" style="padding-top: ${index === 0 ? '1px' : '2px'}; font-size: 11.5px; text-align: left; overflow: hidden; white-space: nowrap;">
                            ${desc}
                        </td>
                        <td class="col-cant" style="padding-top: ${index === 0 ? '1px' : '2px'};">${d.cantidad} ${um}</td>
                        <td class="col-punit" style="padding-top: ${index === 0 ? '1px' : '2px'};">${formatMoney(d.precio_unitario, 6)}</td>
                        <td class="col-ptot" style="padding-top: ${index === 0 ? '1px' : '2px'};">${formatMoney(itemPrecioTotal)}</td>
                    </tr>
                `;
            } else {
                detallesHTML += `
                    <tr>
                        <td colspan="4" style="padding-top: ${index === 0 ? '1px' : '2px'}; font-size: 12px; text-align: left;">
                            ${desc}
                        </td>
                    </tr>
                    <tr class="item-row">
                        <td class="col-desc"></td>
                        <td class="col-cant">${d.cantidad} ${um}</td>
                        <td class="col-punit">${formatMoney(d.precio_unitario, 6)}</td>
                        <td class="col-ptot">${formatMoney(itemPrecioTotal)}</td>
                    </tr>
                `;
            }
        });

        const opGravada = Number(v.precio_venta_total) - Number(v.igv_debito_total) - opInafecta;

        const esAnulado = v.estado === 'ANULADO';
        const anuladoWatermark = esAnulado ? `<div style="text-align:center; font-size:24px; font-weight:bold; color:black; margin: 10px 0; border: 2px solid black; padding: 5px;">ANULADO</div>` : '';

        const cajeroCrudo = v.created_by ? (v.created_by.includes('@') ? v.created_by.split('@')[0] : v.created_by) : 'Cajero';
        let lineaCajeroHTML = `<b>CAJERO:</b> ${cajeroCrudo}`;
        if (cajeroCrudo.includes('(') && cajeroCrudo.includes(')')) {
            const matchCaja = cajeroCrudo.match(/^(.*?)\s*\((.*?)\)$/);
            if (matchCaja) {
                const nom = matchCaja[1].trim();
                const term = matchCaja[2].trim();
                lineaCajeroHTML = `<b>CAJERO:</b> ${nom} &nbsp;|&nbsp; <b>TERMINAL:</b> ${term}`;
            }
        } else if (!cajeroCrudo.toLowerCase().includes('admin') && !cajeroCrudo.toLowerCase().includes('operador')) {
            lineaCajeroHTML = `<b>CAJERO:</b> ${cajeroCrudo} - Operador en Turno`;
        }

        // Inyectar HTML en el DOM global
        const container = asegurarContenedorImpresion();
        container.innerHTML = `
            ${anuladoWatermark}
            <div class="ticket-header">${empresaNombre}</div>
            <p class="ticket-text">RUC: ${empresaRuc}</p>
            <p class="ticket-text">${empresaDir}</p>
            ${empresaTel ? `<p class="ticket-text">Telf: ${empresaTel}</p>` : ''}
            
            <div class="ticket-divisor"></div>
            
            <p style="font-size: 15px; font-weight: bold; margin: 3px 0; text-align: center;">${v.tipo_comprobante} - ${v.numero_ticket}</p>
            <p style="text-align: left; margin-top: 2px;" class="ticket-text"><b>F. EMISIÓN:</b> ${fechaStr} ${horaStr}</p>
            <p style="text-align: left;" class="ticket-text"><b>F. RECEPCIÓN PAGO:</b> ${v.fecha_recepcion_pago ? new Date(v.fecha_recepcion_pago + 'T00:00:00-05:00').toLocaleDateString('es-PE', { timeZone: 'America/Lima' }) : (v.condicion_pago === 'CREDITO' ? 'PENDIENTE' : fechaStr)}</p>
            <p style="text-align: left;" class="ticket-text"><b>CLIENTE:</b> ${clienteNombre}</p>
            <p style="text-align: left;" class="ticket-text"><b>DOC:</b> ${clienteDoc}</p>
            <p style="text-align: left;" class="ticket-text">${lineaCajeroHTML}</p>

            <div class="ticket-divisor"></div>

            <table class="print-ticket-table">
                <thead>
                    <tr>
                        <th class="col-desc">DESC</th>
                        <th class="col-cant">CANT</th>
                        <th class="col-punit">P.UNIT</th>
                        <th class="col-ptot">P.TOT</th>
                    </tr>
                </thead>
                <tbody>
                    ${detallesHTML}
                </tbody>
            </table>

            <div class="ticket-totales">
                ${v.genera_igv ? `
                    ${opGravada > 0 ? `
                    <div>OP. GRAVADA:</div>
                    <div>S/ ${formatMoney(opGravada)}</div>
                    <div>IGV (18%):</div>
                    <div>S/ ${formatMoney(v.igv_debito_total)}</div>
                    ` : ''}
                    ${opInafecta > 0 ? `
                    <div>OP. INAFECTA:</div>
                    <div>S/ ${formatMoney(opInafecta)}</div>
                    ` : ''}
                ` : ''}
            </div>
            <div class="ticket-totales ticket-gran-total">
                <div>${v.condicion_pago === 'CREDITO' ? 'IMPORTE TOTAL:' : 'TOTAL A PAGAR:'}</div>
                <div>S/ ${formatMoney(v.precio_venta_total)}</div>
            </div>
            
            ${v.condicion_pago === 'CREDITO' ? `
            <div class="ticket-divisor"></div>
            <p style="text-align:center; font-weight:bold; font-size:12px; margin:2px 0;">*** VENTA AL CRÉDITO ***</p>
            <div class="ticket-totales" style="margin-top: 2px;">
                <div>PAGO INICIAL:</div>
                <div>S/ ${formatMoney(montoRecibido)}</div>
                <div style="font-weight:bold; margin-top:2px;">SALDO FINANCIAR:</div>
                <div style="font-weight:bold; margin-top:2px;">S/ ${formatMoney(v.precio_venta_total - montoRecibido)}</div>
            </div>
            ` : `
            ${montoRecibido > 0 ? `
            <div class="ticket-totales" style="margin-top: 2px; font-weight: bold;">
                <div>EFECTIVO RECIB.:</div>
                <div>S/ ${formatMoney(montoRecibido)}</div>
                <div>VUELTO:</div>
                <div>S/ ${formatMoney(vuelto)}</div>
            </div>
            ` : ''}
            `}

            <div class="ticket-divisor"></div>
            <p style="margin-top: 4px;" class="ticket-text">¡Gracias por su compra!</p>
            <p style="font-size: 9.5px; margin: 1px 0;" class="ticket-text">Desarrollado con MicroERP</p>
            <p style="margin-bottom: 6px; font-size: 8px;" class="ticket-text">-</p>
        `;

        Swal.close();

        // 3. Renderizar y luego Imprimir (Timeout para dar tiempo a render de DOM)
        return new Promise((resolve) => {
            document.body.classList.add('printing-ticket');
            
            setTimeout(() => {
                window.print();
                
                // Limpieza después de que cierra el diálogo nativo (la mayoría lo bloquean asíncronamente)
                setTimeout(() => {
                    document.body.classList.remove('printing-ticket');
                    container.innerHTML = '';
                    resolve();
                }, 500);
            }, 300);
        });

    } catch (e) {
        console.error(e);
        Swal.fire('Error de Impresión', e.message, 'error');
        throw e;
    }
}

async function imprimirTicketCierreCaja(cierre) {
    try {
        Swal.fire({ title: 'Generando Ticket de Cierre...', allowOutsideClick: false, didOpen: () => { Swal.showLoading(); } });

        const container = asegurarContenedorImpresion();

        const empNombre = cierre.empresa_nombre || 'MICRO ERP';
        const empRuc = cierre.empresa_ruc || '';
        const empDir = cierre.empresa_direccion || '';

        const fApertura = cierre.hora_apertura ? new Date(cierre.hora_apertura).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: true }) : '---';
        const fCierre = cierre.hora_cierre ? new Date(cierre.hora_cierre).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: true }) : new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: true });

        const saldoIni = Number(cierre.saldo_inicial || 0);
        const vtaContado = Number(cierre.total_ventas_contado !== undefined ? cierre.total_ventas_contado : (cierre.ventas_sistema || 0));
        const cuotasCredito = Number(cierre.total_cuotas_credito || 0);
        const otrosIng = Number(cierre.otros_movimientos_ingreso !== undefined ? cierre.otros_movimientos_ingreso : (cierre.otros_ingresos || 0));
        const otrosEg = Number(cierre.otros_movimientos_egreso !== undefined ? cierre.otros_movimientos_egreso : (cierre.otros_egresos || 0));
        const espGaveta = Number(cierre.total_esperado_gaveta !== undefined ? cierre.total_esperado_gaveta : (cierre.saldo_teorico || 0));
        const realConteo = Number(cierre.total_real_conteo !== undefined ? cierre.total_real_conteo : (cierre.dinero_fisico || 0));
        const dif = Number(cierre.diferencia !== undefined ? cierre.diferencia : (cierre.descuadre !== undefined ? cierre.descuadre : 0));
        const operadorDisplay = cierre.nombre_operador || (cierre.cajero_nombre ? (cierre.cajero_nombre.includes('Operador') ? cierre.cajero_nombre : `${cierre.cajero_nombre} - Operador en Turno`) : 'Operador en Turno');

        let difBadge = 'CAJA CUADRADA (S/ 0.00)';
        if (dif > 0.009) difBadge = `SOBRANTE: +S/ ${formatMoney(dif)}`;
        else if (dif < -0.009) difBadge = `FALTANTE: -S/ ${formatMoney(Math.abs(dif))}`;

        let desgloseHTML = '';
        if (cierre.desglose_billetes_monedas && typeof cierre.desglose_billetes_monedas === 'object') {
            const keys = Object.keys(cierre.desglose_billetes_monedas).sort((a,b) => parseFloat(b) - parseFloat(a));
            const itemsConteo = [];
            keys.forEach(k => {
                const cant = parseInt(cierre.desglose_billetes_monedas[k], 10);
                if (cant > 0) {
                    const subVal = cant * parseFloat(k);
                    itemsConteo.push(`<tr><td style="padding:1px 0;">S/ ${k} x ${cant}</td><td style="text-align:right; padding:1px 0;">S/ ${formatMoney(subVal)}</td></tr>`);
                }
            });
            if (itemsConteo.length > 0) {
                desgloseHTML = `
                    <div class="ticket-divisor"></div>
                    <p style="text-align:center; font-size:11px; margin:2px 0;"><b>DETALLE ARQUEO FÍSICO</b></p>
                    <table style="width:100%; font-size:11px; border-collapse:collapse;">
                        ${itemsConteo.join('')}
                    </table>
                `;
            }
        }

        const esCorteX = (cierre.tipo_cierre === 'CORTE_X');
        const tituloPrincipal = esCorteX ? 'REPORTE PARCIAL DE CAJA' : 'REPORTE FINAL DE CIERRE';
        const subtituloCierre = esCorteX ? '*** CORTE X (TURNO ACTIVO) ***' : '*** CORTE Z (CIERRE DEFINITIVO) ***';
        const labelFechaFinal = esCorteX ? 'LECTURA:' : 'CIERRE:';

        container.innerHTML = `
            <div class="ticket-header">${empNombre}</div>
            ${empRuc ? `<p class="ticket-text">RUC: ${empRuc}</p>` : ''}
            ${empDir ? `<p class="ticket-text">${empDir}</p>` : ''}
            
            <div class="ticket-divisor"></div>
            
            <p style="font-size: 14px; font-weight: bold; margin: 3px 0; text-align: center;">${tituloPrincipal}</p>
            <p style="font-size: 11px; font-weight: bold; margin: 1px 0; text-align: center;">${subtituloCierre}</p>
            
            <div class="ticket-divisor"></div>
            
            <p style="text-align: left;" class="ticket-text"><b>OPERADOR:</b> ${operadorDisplay}</p>
            <p style="text-align: left;" class="ticket-text"><b>APERTURA:</b> ${fApertura}</p>
            <p style="text-align: left;" class="ticket-text"><b>${labelFechaFinal}</b> ${fCierre}</p>
            <p style="text-align: left;" class="ticket-text"><b>TICKETS:</b> ${cierre.primer_ticket || '---'} al ${cierre.ultimo_ticket || '---'} (${cierre.total_tickets || 0})</p>
            
            <div class="ticket-divisor"></div>
            
            <div class="ticket-totales" style="font-size:12px;">
                <div>SALDO INICIAL:</div>
                <div>S/ ${formatMoney(saldoIni)}</div>
                <div>VENTAS CONTADO:</div>
                <div>S/ ${formatMoney(vtaContado)}</div>
                ${cuotasCredito > 0 ? `
                <div>CUOTAS EFECTIVO:</div>
                <div>S/ ${formatMoney(cuotasCredito)}</div>
                ` : ''}
                ${otrosIng > 0 ? `
                <div>OTROS INGRESOS:</div>
                <div>S/ ${formatMoney(otrosIng)}</div>
                ` : ''}
                ${otrosEg > 0 ? `
                <div>RETIROS / GASTOS:</div>
                <div>-S/ ${formatMoney(otrosEg)}</div>
                ` : ''}
            </div>

            <div class="ticket-totales ticket-gran-total" style="font-size:13px; margin-top:3px;">
                <div>TOTAL ESPERADO:</div>
                <div>S/ ${formatMoney(espGaveta)}</div>
            </div>

            <div class="ticket-totales" style="font-size:13px; margin-top:3px; font-weight:bold;">
                <div>EFECTIVO CONTADO:</div>
                <div>S/ ${formatMoney(realConteo)}</div>
            </div>

            <div class="ticket-divisor"></div>

            <p style="text-align:center; font-size:13px; font-weight:bold; margin:4px 0; padding:2px; border:1px solid #000;">
                ${difBadge}
            </p>

            ${Number(cierre.total_ventas_credito || 0) > 0 ? `
            <p style="text-align:left; font-size:10.5px; margin-top:3px;" class="ticket-text"><b>Ventas Crédito (Por Cobrar):</b> S/ ${formatMoney(cierre.total_ventas_credito)}</p>
            ` : ''}

            ${desgloseHTML}

            ${cierre.observaciones ? `
            <div class="ticket-divisor"></div>
            <p style="text-align:left; font-size:10px; margin:2px 0;"><b>Obs:</b> ${cierre.observaciones}</p>
            ` : ''}

            ${esCorteX ? `
            <div class="ticket-divisor" style="margin-top:15px;"></div>
            <p style="margin-top: 6px; font-size: 8.5px; text-align: center;" class="ticket-text"><b>* CORTE PARCIAL DE CONTROL *</b></p>
            <p style="margin-top: 2px; font-size: 8px; text-align: center;" class="ticket-text">Este reporte es informativo y NO cierra el turno contable en curso.</p>
            ` : `
            <div class="ticket-divisor" style="margin-top:15px;"></div>
            <div style="margin-top: 35px; text-align: center; font-size:10px;">
                <div style="border-top: 1px solid #000; width: 80%; margin: 0 auto; padding-top: 2px;">Firma Cajero(a) en Turno</div>
                <div style="border-top: 1px solid #000; width: 80%; margin: 35px auto 5px auto; padding-top: 2px;">Firma Administrador(a)</div>
            </div>
            `}

            <p style="margin-top: 8px; font-size: 8px; text-align: center;" class="ticket-text">${esCorteX ? 'MicroERP POS - Control de Turno' : 'MicroERP POS - Arqueo Oficial'}</p>
            <p style="margin-bottom: 6px; font-size: 8px;" class="ticket-text">-</p>
        `;

        Swal.close();

        return new Promise((resolve) => {
            document.body.classList.add('printing-ticket');
            setTimeout(() => {
                window.print();
                setTimeout(() => {
                    document.body.classList.remove('printing-ticket');
                    container.innerHTML = '';
                    resolve();
                }, 500);
            }, 300);
        });

    } catch (e) {
        console.error(e);
        Swal.fire('Error de Impresión', e.message, 'error');
        throw e;
    }
}

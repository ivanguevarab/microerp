// Motor Centralizado de Impresión de Tickets (MicroERP) - Formato CSS @media print estilo CUS
// =======================================================================================
(function () {
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
            .print-ticket-table .col-desc { width: 40%; text-align: left; }
            .print-ticket-table .col-cant { width: 18%; text-align: center; }
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
        document.head.appendChild(style);
    }

    if (!document.getElementById('microerp-print-container')) {
        const container = document.createElement('div');
        container.id = 'microerp-print-container';
        document.body.appendChild(container);
    }
})();

function formatMoney(amount, maxDigits = 2) {
    return Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxDigits });
}

async function imprimirTicketCerrado(ventaId, montoRecibido = 0, vuelto = 0, datosEnMemoria = null) {
    try {
        Swal.fire({ title: 'Preparando Impresión...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });

        let v, det, emp, direccionTicket, dicc = {};

        if (datosEnMemoria) {
            // MODO ULTRARRÁPIDO EN MEMORIA (0 peticiones a la BD)
            v = datosEnMemoria.venta;
            det = datosEnMemoria.detalles || [];
            emp = datosEnMemoria.empresa || {};
            direccionTicket = datosEnMemoria.almacenNombre || emp?.direccion || 'Sede Principal';
            dicc = datosEnMemoria.dicc || {};
            if (datosEnMemoria.cliente) {
                v.clientes = datosEnMemoria.cliente;
            }
        } else {
            // 1. Obtener Datos de la Venta (Safe Fallback para reimpresión histórica)
            const { data: vBD, error: eV } = await window.supabaseClient.from('ventas')
                .select('*, clientes(*)')
                .eq('id', ventaId).single();
            if (eV || !vBD) throw new Error("No se encontró la cabecera de la venta: " + (eV ? eV.message : ''));
            v = vBD;

            const { data: detBD, error: eD } = await window.supabaseClient.from('ventas_detalle').select('*').eq('venta_id', ventaId);
            if (eD) throw new Error("No se encontraron detalles de la venta: " + eD.message);
            det = detBD;

            // 1.2 Recuperar pago inicial si es crédito y estamos reimprimiendo
            if (v.condicion_pago === 'CREDITO' && montoRecibido === 0) {
                const { data: pIni } = await window.supabaseClient.from('ventas_credito_pagos')
                    .select('monto')
                    .eq('venta_id', ventaId)
                    .eq('tipo_pago', 'INICIAL')
                    .maybeSingle();
                if (pIni) montoRecibido = Number(pIni.monto);
            }

            // 1.5 Obtener datos de la empresa por separado para evitar el error de cache de PostgREST
            const { data: empBD } = await window.supabaseClient.from('empresas')
                .select('*').eq('id', v.empresa_id).single();
            emp = empBD;

            // Obtener dirección del almacén a través del egreso (si existe impacto físico)
            direccionTicket = emp?.direccion || 'Sede Principal';
            const { data: egr } = await window.supabaseClient.from('egresos')
                .select('almacen_origen_id')
                .eq('observaciones', 'VENTA_REF:' + v.numero_ticket)
                .limit(1);

            if (egr && egr.length > 0 && egr[0].almacen_origen_id) {
                const { data: alm } = await window.supabaseClient.from('almacenes')
                    .select('nombre, descripcion')
                    .eq('id', egr[0].almacen_origen_id)
                    .single();
                if (alm) {
                    direccionTicket = alm.nombre;
                    if (alm.descripcion) direccionTicket += ' - ' + alm.descripcion;
                }
            }

            // Mapeo Diccionario Elementos
            const tItems = det.filter(d => d.tipo_item_vendido === 'ITEMS').map(d => d.referencia_id);
            const tCods = det.filter(d => d.tipo_item_vendido === 'CUS' || d.tipo_item_vendido === 'CUP').map(d => d.referencia_id);
            if(tItems.length > 0) {
                const { data: iBD } = await window.supabaseClient.from('items').select('id, descripcion').in('id', tItems);
                (iBD||[]).forEach(x => dicc[x.id] = x.descripcion);
            }
            if(tCods.length > 0) {
                const { data: cBD } = await window.supabaseClient.from('codigos_unicos').select('id, descripcion').in('id', tCods);
                (cBD||[]).forEach(x => dicc[x.id] = x.descripcion);
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
            if (v.genera_igv && Number(d.igv_unitario) === 0) {
                opInafecta += Number(d.precio_total);
            }

            const desc = dicc[d.referencia_id] || 'Servicio Varios';
            const esCorto = desc.length <= UMBRAL_CARACTERES_MISMA_LINEA;

            if (esCorto) {
                detallesHTML += `
                    <tr class="item-row">
                        <td class="col-desc" style="padding-top: ${index === 0 ? '1px' : '2px'}; font-size: 11.5px; text-align: left; overflow: hidden; white-space: nowrap;">
                            ${desc}
                        </td>
                        <td class="col-cant" style="padding-top: ${index === 0 ? '1px' : '2px'};">${d.cantidad} x</td>
                        <td class="col-punit" style="padding-top: ${index === 0 ? '1px' : '2px'};">${formatMoney(d.precio_unitario, 6)}</td>
                        <td class="col-ptot" style="padding-top: ${index === 0 ? '1px' : '2px'};">${formatMoney(d.precio_total)}</td>
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
                        <td class="col-cant">${d.cantidad} x</td>
                        <td class="col-punit">${formatMoney(d.precio_unitario, 6)}</td>
                        <td class="col-ptot">${formatMoney(d.precio_total)}</td>
                    </tr>
                `;
            }
        });

        const opGravada = Number(v.precio_venta_total) - Number(v.igv_debito_total) - opInafecta;

        const esAnulado = v.estado === 'ANULADO';
        const anuladoWatermark = esAnulado ? `<div style="text-align:center; font-size:24px; font-weight:bold; color:black; margin: 10px 0; border: 2px solid black; padding: 5px;">ANULADO</div>` : '';

        // Inyectar HTML en el DOM global
        const container = document.getElementById('microerp-print-container');
        document.body.appendChild(container); // Garantizar que sea hijo directo de body (Bypassing sidebar.js wrapper)
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
            <p style="text-align: left;" class="ticket-text"><b>CAJERO:</b> ${v.created_by ? (v.created_by.includes('@') ? v.created_by.split('@')[0] : v.created_by) : 'Sistema'}</p>

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

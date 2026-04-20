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
                font-family: 'Courier New', Courier, monospace;
                color: #000;
                background: #fff;
                padding: 10px 5mm;
                box-sizing: border-box;
                margin: 0 auto;
            }
            .ticket-header { font-size: 18px; margin: 5px 0; text-align: center; text-transform: uppercase; font-weight: bold; }
            .ticket-text { margin: 2px 0; font-size: 12px; text-align: center; }
            .ticket-divisor { border-top: 1px dashed #000; margin: 10px 0; width: 100%; }
            .ticket-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 5px 0; }
            .ticket-table th { border-bottom: 1px solid #000; padding-bottom: 4px; text-align: right; }
            .ticket-table th:first-child { text-align: left; }
            .ticket-totales { display: grid; grid-template-columns: 1fr 1fr; font-size: 14px; margin-top: 5px; }
            .ticket-totales div:nth-child(even) { text-align: right; }
            .ticket-gran-total { font-size: 18px; font-weight: bold; margin-top: 10px; border-top: 2px solid #000; padding-top: 5px; }
            
            /* REGLAS MÁGICAS DE IMPRESIÓN (Para Ticketeras de 80mm) */
            @media print {
                @page { margin: 0; size: 80mm auto; }
                body { margin: 0; padding: 0; background: #fff; }
                
                body.printing-ticket * {
                    visibility: hidden;
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
                    padding: 2mm;
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

function formatMoney(amount) {
    return Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function imprimirTicketCerrado(ventaId, montoRecibido = 0, vuelto = 0) {
    try {
        Swal.fire({ title: 'Preparando Impresión...', allowOutsideClick: false, didOpen: () => { Swal.showLoading() } });

        // 1. Obtener Datos de la Venta (Safe)
        const { data: v, error: eV } = await window.supabaseClient.from('ventas')
            .select('*, clientes(*)')
            .eq('id', ventaId).single();
        if (eV || !v) throw new Error("No se encontró la cabecera de la venta: " + (eV ? eV.message : ''));

        const { data: det, error: eD } = await window.supabaseClient.from('ventas_detalle').select('*').eq('venta_id', ventaId);
        if (eD) throw new Error("No se encontraron detalles de la venta: " + eD.message);

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
        const { data: emp } = await window.supabaseClient.from('empresas')
            .select('*').eq('id', v.empresa_id).single();

        // Obtener dirección del almacén a través del egreso (si existe impacto físico)
        let direccionTicket = emp?.direccion || 'Sede Principal';
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

        // 2. Construir Datos
        const empresaNombre = emp?.nombre_comercial || emp?.razon_social || emp?.nombre || 'MI EMPRESA';
        const empresaRuc = emp?.ruc || '00000000000';
        const empresaDir = direccionTicket;
        const empresaTel = emp?.telefono || '';

        const clienteNombre = v.clientes?.razon_social || 'Cliente No Identificado (NN)';
        const clienteDoc = v.clientes?.numero_documento || '---';

        let tc = v.created_at;
        if (tc && !tc.includes('Z') && !tc.includes('+') && !tc.match(/-\d\d:?\d\d$/)) {
            tc += 'Z'; // Forzar UTC internamente antes de que JS asuma local
        }
        const dateObj = new Date(tc);
        const fechaStr = dateObj.toLocaleDateString('es-PE', { timeZone: 'America/Lima' });
        const horaStr = dateObj.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' });

        // Mapeo Diccionario Elementos
        const tItems = det.filter(d => d.tipo_item_vendido === 'ITEMS').map(d => d.referencia_id);
        const tCods = det.filter(d => d.tipo_item_vendido === 'CUS' || d.tipo_item_vendido === 'CUP').map(d => d.referencia_id);
        let dicc = {};
        if(tItems.length > 0) {
            const { data: iBD } = await window.supabaseClient.from('items').select('id, descripcion').in('id', tItems);
            (iBD||[]).forEach(x => dicc[x.id] = x.descripcion);
        }
        if(tCods.length > 0) {
            const { data: cBD } = await window.supabaseClient.from('codigos_unicos').select('id, descripcion').in('id', tCods);
            (cBD||[]).forEach(x => dicc[x.id] = x.descripcion);
        }

        let detallesHTML = '';
        det.forEach(d => {
            const desc = dicc[d.referencia_id] || 'Servicio Varios';
            detallesHTML += `
                <tr>
                    <td colspan="4" style="padding-top: 5px; font-weight: bold; font-size: 13px; text-align: left;">
                        ${desc}
                    </td>
                </tr>
                <tr>
                    <td style="padding-bottom: 5px; border-bottom: 1px dashed #000; text-align: left;"></td>
                    <td style="padding-bottom: 5px; border-bottom: 1px dashed #000; text-align: center;">${d.cantidad} x</td>
                    <td style="padding-bottom: 5px; border-bottom: 1px dashed #000; text-align: right;">${formatMoney(d.precio_unitario)}</td>
                    <td style="padding-bottom: 5px; border-bottom: 1px dashed #000; text-align: right; font-weight: bold;">${formatMoney(d.precio_total)}</td>
                </tr>
            `;
        });

        const esAnulado = v.estado === 'ANULADO';
        const anuladoWatermark = esAnulado ? `<div style="text-align:center; font-size:24px; font-weight:bold; color:black; margin: 10px 0; border: 2px solid black; padding: 5px;">ANULADO</div>` : '';

        // Inyectar HTML en el DOM global
        const container = document.getElementById('microerp-print-container');
        container.innerHTML = `
            ${anuladoWatermark}
            <div class="ticket-header">${empresaNombre}</div>
            <p class="ticket-text">RUC: ${empresaRuc}</p>
            <p class="ticket-text">${empresaDir}</p>
            ${empresaTel ? `<p class="ticket-text">Telf: ${empresaTel}</p>` : ''}
            
            <div class="ticket-divisor"></div>
            
            <p style="font-size: 16px; font-weight: bold; margin: 5px 0; text-align: center;">${v.tipo_comprobante} - ${v.numero_ticket}</p>
            <p style="text-align: left; margin-top: 10px;" class="ticket-text"><b>FECHA:</b> ${fechaStr} ${horaStr}</p>
            <p style="text-align: left;" class="ticket-text"><b>CLIENTE:</b> ${clienteNombre}</p>
            <p style="text-align: left;" class="ticket-text"><b>DOC:</b> ${clienteDoc}</p>
            <p style="text-align: left;" class="ticket-text"><b>CAJERO:</b> ${v.created_by ? (v.created_by.includes('@') ? v.created_by.split('@')[0] : v.created_by) : 'Sistema'}</p>

            <div class="ticket-divisor"></div>

            <table class="ticket-table">
                <thead>
                    <tr>
                        <th>DESC</th>
                        <th style="text-align: center;">CANT</th>
                        <th>P.UNIT</th>
                        <th>P.TOT</th>
                    </tr>
                </thead>
                <tbody>
                    ${detallesHTML}
                </tbody>
            </table>

            <div class="ticket-divisor"></div>

            <div class="ticket-totales">
                ${v.genera_igv ? `
                    <div>OP. GRAVADA:</div>
                    <div>S/ ${formatMoney(v.precio_venta_total - v.igv_debito_total)}</div>
                    <div>IGV (18%):</div>
                    <div>S/ ${formatMoney(v.igv_debito_total)}</div>
                ` : ''}
            </div>
            </div>
            <div class="ticket-totales ticket-gran-total">
                <div>${v.condicion_pago === 'CREDITO' ? 'IMPORTE TOTAL:' : 'TOTAL A PAGAR:'}</div>
                <div>S/ ${formatMoney(v.precio_venta_total)}</div>
            </div>
            
            ${v.condicion_pago === 'CREDITO' ? `
            <div class="ticket-divisor"></div>
            <p style="text-align:center; font-weight:bold; font-size:14px; margin:5px 0;">*** VENTA AL CRÉDITO ***</p>
            <div class="ticket-totales" style="margin-top: 5px;">
                <div>PAGO INICIAL:</div>
                <div>S/ ${formatMoney(montoRecibido)}</div>
                <div style="font-weight:bold; margin-top:3px;">SALDO FINANCIAR:</div>
                <div style="font-weight:bold; margin-top:3px;">S/ ${formatMoney(v.precio_venta_total - montoRecibido)}</div>
            </div>
            ` : `
            ${montoRecibido > 0 ? `
            <div class="ticket-totales" style="margin-top: 5px; font-weight: bold;">
                <div>EFECTIVO RECIB.:</div>
                <div>S/ ${formatMoney(montoRecibido)}</div>
                <div>VUELTO:</div>
                <div>S/ ${formatMoney(vuelto)}</div>
            </div>
            ` : ''}
            `}

            <div class="ticket-divisor"></div>
            <p style="margin-top: 15px;" class="ticket-text">¡Gracias por su compra!</p>
            <p style="font-size: 10px;" class="ticket-text">Desarrollado con MicroERP</p>
            <p style="margin-bottom: 30px;" class="ticket-text">-</p>
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

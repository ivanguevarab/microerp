// ============================================================================
// MICRO ERP - Motor Matemático de Recursos Humanos (Banco de Horas)
// ============================================================================
// Este motor centraliza la lógica de cálculo de excedentes, deudas, descuentos 
// de almuerzo, tolerancias y penalidades por tardanza.
// Es consumido por asistencia_reloj.html, banco_de_horas.html y liquidaciones.html
// para garantizar una única fuente de verdad.

function rrhhParseLocalTime(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/**
 * Calcula el delta diario (excedente o deuda) basado en la política y el calendario.
 * Retorna un objeto con las horas efectivas, el estado y el delta en minutos.
 */
function calcularMatematicaDiariaRRHH(minE, minS, minIniAlm, minFinAlm, metaEntradaMins, metaSalidaMins, pol, cal) {
    // 1. Calculo Tiempo Efectivo Bruto
    let tiempoPlantaMins = minS - minE;
    let minsAlmuerzoReal = 0;
    
    if (minIniAlm !== null && minFinAlm !== null) {
        minsAlmuerzoReal = minFinAlm - minIniAlm;
    }

    // 2. Definimos Meta Neta (DOBLE VALIDACIÓN)
    let minAlmuerzoEsperado = 0;
    let difMeta = metaSalidaMins - metaEntradaMins;
    
    // Deducción Inteligente: Solo si la Meta Bruta es mayor a 6 horas (360 mins)
    if (difMeta > 360) {
        if (pol.aplicar_descuento_almuerzo === true) {
            if (cal && cal.aplica_almuerzo === true) {
                if (cal.hora_inicio_almuerzo_esperado && cal.hora_fin_almuerzo_esperado) {
                    let almIn = rrhhParseLocalTime(cal.hora_inicio_almuerzo_esperado.substring(0, 5));
                    let almOut = rrhhParseLocalTime(cal.hora_fin_almuerzo_esperado.substring(0, 5));
                    let overlapStart = Math.max(metaEntradaMins, almIn);
                    let overlapEnd = Math.min(metaSalidaMins, almOut);
                    if (overlapStart < overlapEnd) minAlmuerzoEsperado = overlapEnd - overlapStart;
                } else {
                    minAlmuerzoEsperado = pol.minutos_almuerzo_esperado ?? 60;
                }
            } else if (!cal) {
                minAlmuerzoEsperado = pol.minutos_almuerzo_esperado ?? 60;
            }
        }
    }
    
    let metaNetaTarget = difMeta - minAlmuerzoEsperado;

    // 3. Penalizaciones por Tardanza
    let penalizacionAAplicarMins = 0;
    let tardanzaDiff = minE - metaEntradaMins;

    if (tardanzaDiff > (pol.minutos_gracia_tardanza ?? 15) && pol.aplicar_penalizaciones_tardanza !== false) {
        if (pol.penalizacion_tipo === 'DESCUENTO_TIEMPO_DOBLE') {
            penalizacionAAplicarMins = tardanzaDiff * 1; 
        } else if (pol.penalizacion_tipo === 'ESCALONADA_DURA') {
            let escalas = pol.escalas_penalizacion || [];
            for (let esc of escalas) {
                if (tardanzaDiff >= esc.de && tardanzaDiff <= esc.hasta) {
                    penalizacionAAplicarMins = esc.penalizacion_minutos - tardanzaDiff;
                    break;
                }
            }
            if (penalizacionAAplicarMins === 0 && escalas.length > 0) {
                let lastEscala = escalas[escalas.length - 1];
                if (tardanzaDiff > lastEscala.hasta) penalizacionAAplicarMins = lastEscala.penalizacion_minutos - tardanzaDiff;
            }
        }
    }

    // 4. Calculo Final de Horas Efectivas para Asistencia
    let minutosEfectivosCalculados = tiempoPlantaMins - minsAlmuerzoReal - penalizacionAAplicarMins;
    if (minutosEfectivosCalculados < 0) minutosEfectivosCalculados = 0;

    let hrsDbl = (minutosEfectivosCalculados / 60).toFixed(2);
    let deltaMins = minutosEfectivosCalculados - metaNetaTarget;
    let deltaHoras = parseFloat((deltaMins / 60).toFixed(2));

    // Estados
    let esTardanzaFinal = tardanzaDiff > (pol.minutos_gracia_tardanza ?? 15);
    let esSalidaAnticipadaFinal = minS < metaSalidaMins;
    let finalEstado = 'ASISTIO';

    if (esTardanzaFinal && esSalidaAnticipadaFinal) {
         finalEstado = 'TARDANZA y SALIDA ANTICIPADA';
    } else if (esTardanzaFinal) {
         finalEstado = 'TARDANZA';
    } else if (esSalidaAnticipadaFinal) {
         finalEstado = 'SALIDA ANTICIPADA';
    }

    return {
        horasEfectivas: hrsDbl,
        estadoFinal: finalEstado,
        deltaMins: deltaMins,
        deltaHoras: deltaHoras,
        metaNetaTarget: metaNetaTarget,
        minutosEfectivosCalculados: minutosEfectivosCalculados,
        penalizacionMins: penalizacionAAplicarMins
    };
}

/**
 * Función Principal Pública: Recalcula y cuadra TODO EL MES de un trabajador específico.
 * Borra los registros transaccionales automáticos del mes y los re-inyecta en orden secuencial.
 */
async function recalcularMesCompletoPorLotes(personalId, mesStr, anioStr, supabase, empresaId, pol) {
    // 1. Rango de fechas del mes
    const mesNum = parseInt(mesStr, 10);
    const anioNum = parseInt(anioStr, 10);
    const startDate = `${anioNum}-${String(mesNum).padStart(2, '0')}-01`;
    const lastDay = new Date(anioNum, mesNum, 0).getDate();
    const endDate = `${anioNum}-${String(mesNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // 2. Extraer TODAS las asistencias de este empleado en este mes
    const { data: asistencias, error: errA } = await supabase.from('asistencia_diaria')
        .select('*')
        .eq('personal_id', personalId)
        .gte('fecha', startDate)
        .lte('fecha', endDate)
        .order('fecha', { ascending: true });
        
    if (errA) throw errA;

    // 3. Extraer TODOS los calendarios del empleado en el mes
    const { data: calendarios, error: errC } = await supabase.from('calendario_personal')
        .select('*')
        .eq('personal_id', personalId)
        .gte('fecha', startDate)
        .lte('fecha', endDate);
        
    if (errC) throw errC;

    // 4. Extraer TODO el Banco de Horas del mes
    const { data: bancoHistorico, error: errB } = await supabase.from('banco_horas')
        .select('*')
        .eq('personal_id', personalId)
        .gte('fecha_movimiento', startDate)
        .lte('fecha_movimiento', endDate)
        .order('fecha_movimiento', { ascending: true })
        .order('created_at', { ascending: true });
        
    if (errB) throw errB;

    // Obtener saldo arrastrado del último movimiento anterior a este mes
    const { data: bancoPrevio } = await supabase.from('banco_horas')
        .select('saldo_acumulado')
        .eq('personal_id', personalId)
        .lt('fecha_movimiento', startDate)
        .order('fecha_movimiento', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);

    let saldoArrastre = 0;
    if (bancoPrevio && bancoPrevio.length > 0) {
        saldoArrastre = parseFloat(bancoPrevio[0].saldo_acumulado);
    }

    // 5. Borrar transacciones generadas automáticamente en el mes (dejando intactas las manuales: CANJES o PAGOS)
    const bancoIdsToDelete = bancoHistorico
        .filter(b => b.tipo_movimiento === 'EXCEDENTE_GENERADO' || b.tipo_movimiento === 'DEUDA_GENERADA')
        .map(b => b.id);

    if (bancoIdsToDelete.length > 0) {
        // En supabase el .in() tiene límite de elementos, pero como máximo son ~31 (1 al día), es seguro
        const { error: delErr } = await supabase.from('banco_horas').delete().in('id', bancoIdsToDelete);
        if (delErr) throw delErr;
    }

    // Retenemos en memoria las transacciones MANUALES para entrelazarlas en el cálculo de saldo arrastrado
    let transaccionesManuales = bancoHistorico.filter(b => b.tipo_movimiento !== 'EXCEDENTE_GENERADO' && b.tipo_movimiento !== 'DEUDA_GENERADA');

    // 6. Procesar día por día
    // Creamos un arreglo con todas las operaciones a insertar y actualizar
    let payloadBancoInserts = [];
    let payloadAsistenciasUpdates = [];
    
    let saldoRunningTotal = saldoArrastre;

    for (let dia = 1; dia <= lastDay; dia++) {
        let fechaActual = `${anioNum}-${String(mesNum).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        
        // Ver si en este día hubo un movimiento manual, actualizar su saldo_acumulado al vuelo
        let manualTrxsHoy = transaccionesManuales.filter(t => t.fecha_movimiento === fechaActual);
        for(let mt of manualTrxsHoy) {
            saldoRunningTotal = parseFloat((saldoRunningTotal + parseFloat(mt.cantidad_horas)).toFixed(2));
            // Actualizar el saldo acumulado del movimiento manual (sin cambiar su monto)
            await supabase.from('banco_horas').update({ saldo_acumulado: saldoRunningTotal }).eq('id', mt.id);
        }

        let asis = asistencias.find(a => a.fecha === fechaActual);
        if (!asis) continue; // Si no hay asistencia, no hay cálculo para este día

        let cal = calendarios.find(c => c.fecha === fechaActual);
        
        let metaEntradaMins = rrhhParseLocalTime(cal ? cal.hora_entrada_esperada : "08:00:00");
        let metaSalidaMins = rrhhParseLocalTime(cal ? cal.hora_salida_esperada : "17:00:00");

        // SI ES UNA FALTA EXPLÍCITA (Registrada como 'FALTA')
        if (asis.estado === 'FALTA') {
            let minAlmuerzoEsperado = 0;
            let difMeta = metaSalidaMins - metaEntradaMins;
            if (difMeta > 360 && pol.aplicar_descuento_almuerzo === true) {
                if (cal && cal.aplica_almuerzo === true) {
                    if (cal.hora_inicio_almuerzo_esperado && cal.hora_fin_almuerzo_esperado) {
                        let almIn = rrhhParseLocalTime(cal.hora_inicio_almuerzo_esperado.substring(0, 5));
                        let almOut = rrhhParseLocalTime(cal.hora_fin_almuerzo_esperado.substring(0, 5));
                        let overlapStart = Math.max(metaEntradaMins, almIn);
                        let overlapEnd = Math.min(metaSalidaMins, almOut);
                        if (overlapStart < overlapEnd) minAlmuerzoEsperado = overlapEnd - overlapStart;
                    } else {
                        minAlmuerzoEsperado = pol.minutos_almuerzo_esperado ?? 60;
                    }
                } else if (!cal) {
                    minAlmuerzoEsperado = pol.minutos_almuerzo_esperado ?? 60;
                }
            }

            let metaNetaTargetMins = difMeta - minAlmuerzoEsperado;
            if (metaNetaTargetMins < 0) metaNetaTargetMins = 0;
            let deudaHoras = parseFloat((metaNetaTargetMins / 60).toFixed(2));

            if (deudaHoras > 0) {
                saldoRunningTotal = parseFloat((saldoRunningTotal - deudaHoras).toFixed(2));
                
                payloadBancoInserts.push({
                    empresa_id: empresaId,
                    personal_id: personalId,
                    fecha_movimiento: fechaActual,
                    tipo_movimiento: 'DEUDA_GENERADA',
                    cantidad_horas: -deudaHoras,
                    saldo_acumulado: saldoRunningTotal,
                    documento_referencia: `INASIST-${asis.id.split('-')[0]}`,
                    observacion: `FALTA registrada. Deducción total de meta (${deudaHoras.toFixed(2)}h)`
                });
            }
            continue; // Saltamos al siguiente día
        }

        // SI HAY ENTRADA Y SALIDA VÁLIDA
        if (asis.hora_entrada && asis.hora_salida) {
            let minE = rrhhParseLocalTime(asis.hora_entrada);
            let minS = rrhhParseLocalTime(asis.hora_salida);
            let minIniAlm = asis.hora_inicio_almuerzo ? rrhhParseLocalTime(asis.hora_inicio_almuerzo) : null;
            let minFinAlm = asis.hora_fin_almuerzo ? rrhhParseLocalTime(asis.hora_fin_almuerzo) : null;

            let calc = calcularMatematicaDiariaRRHH(minE, minS, minIniAlm, minFinAlm, metaEntradaMins, metaSalidaMins, pol, cal);
            
            // Si el estado o las horas calculadas difieren, guardamos el update de asistencia
            if (calc.horasEfectivas != asis.horas_efectivas_calculadas || calc.estadoFinal != asis.estado) {
                payloadAsistenciasUpdates.push({
                    id: asis.id,
                    update: {
                        horas_efectivas_calculadas: calc.horasEfectivas,
                        estado: calc.estadoFinal
                    }
                });
            }

            // Inyectar al banco de horas si hay delta material
            if (Math.abs(calc.deltaMins) > 0) {
                saldoRunningTotal = parseFloat((saldoRunningTotal + calc.deltaHoras).toFixed(2));
                
                let tipoTrx = calc.deltaHoras > 0 ? 'EXCEDENTE_GENERADO' : 'DEUDA_GENERADA';
                let obs = `Cierre Asistencia auto. Meta:${(calc.metaNetaTarget / 60).toFixed(1)}h | EfvoReal:${(calc.minutosEfectivosCalculados / 60).toFixed(1)}h`;
                if (calc.penalizacionMins > 0) obs += ` (Castigo de -${calc.penalizacionMins}m aplicado)`;

                payloadBancoInserts.push({
                    empresa_id: empresaId,
                    personal_id: personalId,
                    fecha_movimiento: fechaActual,
                    tipo_movimiento: tipoTrx,
                    cantidad_horas: calc.deltaHoras,
                    saldo_acumulado: saldoRunningTotal,
                    documento_referencia: `ASIS-${asis.id.split('-')[0]}`,
                    observacion: obs
                });
            }
        }
    }

    // 7. Ejecutar inserciones al Banco de Horas
    if (payloadBancoInserts.length > 0) {
        const { error: insbErr } = await supabase.from('banco_horas').insert(payloadBancoInserts);
        if (insbErr) throw insbErr;
    }

    // 8. Actualizar Asistencias (Supabase JS no soporta bulk update con diferentes valores, así que lo hacemos secuencial o en paralelo)
    if (payloadAsistenciasUpdates.length > 0) {
        let updatePromises = payloadAsistenciasUpdates.map(upd => 
            supabase.from('asistencia_diaria').update(upd.update).eq('id', upd.id)
        );
        await Promise.all(updatePromises);
    }
}

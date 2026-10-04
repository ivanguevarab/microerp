// =====================================================================================
// MÓDULO CENTRALIZADO DE PERSISTENCIA Y OPERATIVIDAD OFFLINE (MicroERP POS)
// Archivo: HTML/js_offline_pos.js
// Objetivo: Orquestación integral de IndexedDB, Motor de Reloj Maestro UTC-5, Validación
//           Criptográfica de PIN, Series Soberanas por Terminal y Sincronización Batch.
// =====================================================================================

(function (window) {
    'use strict';

    const DB_NAME = 'MicroERP_POS_Offline';
    const DB_VERSION = 1;
    const CORPORATE_PIN_SALT = 'microerp_pos_pin_salt_2026';

    let dbInstance = null;
    let isSyncInProgress = false;

    // Estado del Motor de Reloj Maestro de Cero Confianza (UTC-5)
    let clockCalibration = {
        offsetMs: 0,                   // Delta: (Hora Oficial Servidor - Hora Local PC)
        lastKnownServerTime: null,     // Última hora oficial calibrada
        calibrationMonotonic: performance.now(), // Marca monotónica en el instante de calibración
        lastIssuedTicketTime: null     // Anclaje al último ticket emitido (anti-saltos al pasado)
    };

    // =========================================================================
    // 1. INICIALIZACIÓN Y GESTIÓN DE INDEXEDDB
    // =========================================================================
    function openDatabase() {
        return new Promise((resolve, reject) => {
            if (dbInstance) {
                return resolve(dbInstance);
            }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                console.log('📦 [IndexedDB] Configurando almacenes de objetos (V1)...');

                // 1. Catálogo de productos
                if (!db.objectStoreNames.contains('catalogo_items')) {
                    const storeItems = db.createObjectStore('catalogo_items', { keyPath: 'id' });
                    storeItems.createIndex('busqueda_vector', 'busqueda_vector', { unique: false });
                    storeItems.createIndex('codigo', 'codigo', { unique: false });
                }

                // 2. Lotes FIFO
                if (!db.objectStoreNames.contains('lotes_fifo')) {
                    const storeLotes = db.createObjectStore('lotes_fifo', { keyPath: 'id' });
                    storeLotes.createIndex('item_id', 'item_id', { unique: false });
                }

                // 3. Padrón de clientes
                if (!db.objectStoreNames.contains('clientes')) {
                    const storeClientes = db.createObjectStore('clientes', { keyPath: 'id' });
                    storeClientes.createIndex('numero_documento', 'numero_documento', { unique: false });
                    storeClientes.createIndex('razon_social', 'razon_social', { unique: false });
                }

                // 4. Turnos locales de la terminal
                if (!db.objectStoreNames.contains('turnos_locales')) {
                    const storeTurnos = db.createObjectStore('turnos_locales', { keyPath: 'id' });
                    storeTurnos.createIndex('estado', 'estado', { unique: false });
                }

                // 5. Correlativo soberano de la terminal física
                if (!db.objectStoreNames.contains('correlativos_terminal')) {
                    db.createObjectStore('correlativos_terminal', { keyPath: 'serie' });
                }

                // 6. Cola de comprobantes de venta pendientes de sincronizar
                if (!db.objectStoreNames.contains('cola_ventas_sync')) {
                    const storeVentas = db.createObjectStore('cola_ventas_sync', { keyPath: 'id' });
                    storeVentas.createIndex('estado', 'estado', { unique: false });
                    storeVentas.createIndex('hora_emision', 'hora_emision', { unique: false });
                }

                // 7. Cola de cierres Z de turno pendientes de sincronizar
                if (!db.objectStoreNames.contains('cola_cierres_sync')) {
                    const storeCierres = db.createObjectStore('cola_cierres_sync', { keyPath: 'id' });
                    storeCierres.createIndex('estado', 'estado', { unique: false });
                }

                // 8. Parámetros de seguridad corporativa (Hash PIN Supervisor)
                if (!db.objectStoreNames.contains('seguridad_empresa')) {
                    db.createObjectStore('seguridad_empresa', { keyPath: 'empresa_id' });
                }

                // 9. Respaldo de sesión inmutable para auth-guard.js
                if (!db.objectStoreNames.contains('pos_session_backup')) {
                    db.createObjectStore('pos_session_backup', { keyPath: 'user_id' });
                }

                // 10. Canasta reactiva en progreso (anti-F5 durante escaneo)
                if (!db.objectStoreNames.contains('pos_draft_cart')) {
                    db.createObjectStore('pos_draft_cart', { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                dbInstance = e.target.result;
                resolve(dbInstance);
            };

            request.onerror = (e) => {
                console.error('❌ [IndexedDB] Error al abrir base de datos local:', e.target.error);
                reject(e.target.error);
            };
        });
    }

    // Helper genérico para operaciones en IndexedDB
    async function dbTransaction(storeName, mode, callback) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            let result;

            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);

            result = callback(store);
        });
    }

    // Solicitar almacenamiento persistente en el navegador (anti-purga SO)
    async function solicitarAlmacenamientoPersistente() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                const esPersistente = await navigator.storage.persist();
                console.log(`🛡️ [Storage] Almacenamiento persistente garantizado: ${esPersistente}`);
            } catch (err) {
                console.warn('[Storage] No se pudo solicitar persistencia:', err);
            }
        }
    }


    // =========================================================================
    // 2. MOTOR DE RELOJ MAESTRO DE CERO CONFIANZA (UTC-5 LIMA)
    // =========================================================================
    function calibrarRelojConServidor(timestampServidorIso) {
        if (!timestampServidorIso) return;
        try {
            const serverMs = new Date(timestampServidorIso).getTime();
            const localNowMs = Date.now();
            clockCalibration.offsetMs = serverMs - localNowMs;
            clockCalibration.lastKnownServerTime = serverMs;
            clockCalibration.calibrationMonotonic = performance.now();
            
            localStorage.setItem('microerp_clock_offset_ms', clockCalibration.offsetMs.toString());
            console.log(`⏱️ [Reloj Maestro] Calibrado con Supabase. Delta: ${clockCalibration.offsetMs} ms`);
        } catch (e) {
            console.warn('[Reloj Maestro] Error al calibrar reloj:', e);
        }
    }

    // Inicializar offset guardado previamente
    try {
        const savedOffset = localStorage.getItem('microerp_clock_offset_ms');
        if (savedOffset !== null) {
            clockCalibration.offsetMs = parseInt(savedOffset, 10) || 0;
        }
    } catch (_) {}

    function obtenerHoraOficialLima() {
        // Cálculo monotónico inalterable
        const elapsedMonotonicMs = performance.now() - clockCalibration.calibrationMonotonic;
        let officialMs = (Date.now() + clockCalibration.offsetMs);

        // Veto a saltos al pasado por fallos de pila CMOS:
        // Si la PC marca una fecha menor al último ticket emitido, anclamos al último ticket + monotonic
        if (clockCalibration.lastIssuedTicketTime && officialMs <= clockCalibration.lastIssuedTicketTime) {
            officialMs = clockCalibration.lastIssuedTicketTime + Math.max(1000, elapsedMonotonicMs);
        }

        // Proyección forzada a zona horaria UTC-5 (America/Lima)
        const d = new Date(officialMs);
        const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
        const limaTime = new Date(utc - (5 * 3600000));

        const y = limaTime.getFullYear();
        const m = String(limaTime.getMonth() + 1).padStart(2, '0');
        const dia = String(limaTime.getDate()).padStart(2, '0');
        const H = String(limaTime.getHours()).padStart(2, '0');
        const M = String(limaTime.getMinutes()).padStart(2, '0');
        const S = String(limaTime.getSeconds()).padStart(2, '0');

        return {
            fecha: `${y}-${m}-${dia}`,
            hora: `${H}:${M}:${S}`,
            iso: `${y}-${m}-${dia}T${H}:${M}:${S}-05:00`,
            timestampMs: officialMs
        };
    }

    function registrarUltimoTicketEmitido(timestampIso) {
        if (!timestampIso) return;
        const ms = new Date(timestampIso).getTime();
        if (!isNaN(ms)) {
            clockCalibration.lastIssuedTicketTime = Math.max(clockCalibration.lastIssuedTicketTime || 0, ms);
        }
    }


    // =========================================================================
    // 3. VALIDACIÓN CRIPTOGRÁFICA DE PIN DE SUPERVISOR (WEB CRYPTO API)
    // =========================================================================
    async function sha256Hex(cadena) {
        const encoder = new TextEncoder();
        const data = encoder.encode(cadena);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function validarPinSupervisorOffline(empresaId, pinIngresado) {
        if (!empresaId || !pinIngresado) {
            return { valido: false, codigo: 'DATOS_INVALIDOS', mensaje: 'Empresa o PIN no especificado.' };
        }

        // 1. Obtener parámetros de seguridad de IndexedDB
        let segData = null;
        try {
            await dbTransaction('seguridad_empresa', 'readonly', (store) => {
                const req = store.get(empresaId);
                req.onsuccess = () => { segData = req.result; };
            });
        } catch (_) {}

        if (!segData || !segData.pin_hash) {
            return {
                valido: false,
                codigo: 'SIN_CONFIGURAR',
                mensaje: 'No hay PIN de Supervisor registrado localmente. Requiere configuración previa online.'
            };
        }

        // 2. Verificar estado de bloqueo temporal por intentos fallidos
        const ahora = Date.now();
        if (segData.bloqueado_hasta && segData.bloqueado_hasta > ahora) {
            const minRestantes = Math.ceil((segData.bloqueado_hasta - ahora) / 60000);
            return {
                valido: false,
                codigo: 'BLOQUEADO',
                mensaje: `PIN bloqueado por seguridad tras 5 intentos fallidos. Espere ${minRestantes} minuto(s).`
            };
        }

        // 3. Calcular Hash SHA-256 idéntico a PostgreSQL
        const inputStr = `${empresaId}:${pinIngresado}:${CORPORATE_PIN_SALT}`;
        const inputHash = await sha256Hex(inputStr);

        // 4. Comparación segura
        if (inputHash === segData.pin_hash) {
            // Reiniciar intentos fallidos
            segData.intentos_fallidos = 0;
            segData.bloqueado_hasta = null;
            await dbTransaction('seguridad_empresa', 'readwrite', (store) => store.put(segData));
            return { valido: true, codigo: 'OK', mensaje: 'Autorización concedida.' };
        } else {
            // Incrementar fallos
            const fallos = (segData.intentos_fallidos || 0) + 1;
            segData.intentos_fallidos = fallos;
            if (fallos >= 5) {
                segData.bloqueado_hasta = ahora + (10 * 60 * 1000); // Bloqueo de 10 min
            }
            await dbTransaction('seguridad_empresa', 'readwrite', (store) => store.put(segData));

            return {
                valido: false,
                codigo: 'PIN_INCORRECTO',
                mensaje: fallos >= 5 ? 'PIN bloqueado por 10 minutos.' : `PIN incorrecto. Intentos restantes: ${5 - fallos}`,
                intentos_restantes: Math.max(0, 5 - fallos)
            };
        }
    }


    // =========================================================================
    // 4. SERIES SOBERANAS POR TERMINAL FÍSICA (ESTÁNDAR SUNAT)
    // =========================================================================
    function obtenerTerminalHardwareId() {
        let tid = localStorage.getItem('microerp_terminal_hardware_uuid');
        if (!tid) {
            tid = crypto.randomUUID();
            localStorage.setItem('microerp_terminal_hardware_uuid', tid);
        }
        return tid;
    }

    function calcularSeriePorCaja(cajaIdentificador) {
        // 'Caja 1' -> 'TCK-2026-01', 'Caja 2' -> 'TCK-2026-02', etc.
        const matches = (cajaIdentificador || 'Caja 1').match(/\d+/);
        const numCaja = matches ? parseInt(matches[0], 10) : 1;
        const year = obtenerHoraOficialLima().fecha.substring(0, 4);
        const prefixCaja = String(numCaja).padStart(2, '0');
        return `TCK-${year}-${prefixCaja}`;
    }

    async function obtenerSiguienteCorrelativoSoberano(cajaIdentificador) {
        const serie = calcularSeriePorCaja(cajaIdentificador);
        let siguienteNumero = 1;

        await dbTransaction('correlativos_terminal', 'readwrite', (store) => {
            const req = store.get(serie);
            req.onsuccess = () => {
                const reg = req.result;
                if (reg && reg.ultimo_numero) {
                    siguienteNumero = reg.ultimo_numero + 1;
                }
                store.put({
                    serie: serie,
                    ultimo_numero: siguienteNumero,
                    updated_at: new Date().toISOString()
                });
            };
        });

        const correlativoStr = String(siguienteNumero).padStart(6, '0');
        return {
            serie: serie,
            numero: siguienteNumero,
            numero_ticket: `${serie}-${correlativoStr}`
        };
    }

    async function forzarPunteroCorrelativoSiMayor(serie, numero) {
        if (!serie || !numero) return;
        await dbTransaction('correlativos_terminal', 'readwrite', (store) => {
            const req = store.get(serie);
            req.onsuccess = () => {
                const reg = req.result;
                const actual = reg ? reg.ultimo_numero : 0;
                if (numero > actual) {
                    store.put({ serie: serie, ultimo_numero: numero, updated_at: new Date().toISOString() });
                }
            };
        });
    }


    // =========================================================================
    // 5. RESILIENCIA DE CANASTA EN PROGRESO (ANTI-F5 DURANTE ESCANEO)
    // =========================================================================
    async function respaldarCanastaProgreso(empresaId, itemsCarrito) {
        try {
            await dbTransaction('pos_draft_cart', 'readwrite', (store) => {
                store.put({
                    key: 'draft_' + empresaId,
                    items: itemsCarrito || [],
                    updated_at: Date.now()
                });
            });
        } catch (_) {}
    }

    async function recuperarCanastaProgreso(empresaId) {
        try {
            let draft = null;
            await dbTransaction('pos_draft_cart', 'readonly', (store) => {
                const req = store.get('draft_' + empresaId);
                req.onsuccess = () => { draft = req.result; };
            });
            return (draft && draft.items) ? draft.items : [];
        } catch (_) {
            return [];
        }
    }

    async function limpiarCanastaProgreso(empresaId) {
        try {
            await dbTransaction('pos_draft_cart', 'readwrite', (store) => {
                store.delete('draft_' + empresaId);
            });
        } catch (_) {}
    }


    // =========================================================================
    // 6. SNAPSHOT DE CATÁLOGO MAESTRO (DESCARGA Y ALMACENAMIENTO LOCAL)
    // =========================================================================
    async function guardarSnapshotCatalogo(empresaId, dataCatalogo) {
        if (!dataCatalogo) return;
        const db = await openDatabase();

        // 1. Guardar items
        if (dataCatalogo.items && dataCatalogo.items.length > 0) {
            const tx = db.transaction('catalogo_items', 'readwrite');
            const store = tx.objectStore('catalogo_items');
            dataCatalogo.items.forEach(it => store.put(it));
        }

        // 2. Guardar lotes
        if (dataCatalogo.lotes && dataCatalogo.lotes.length > 0) {
            const tx = db.transaction('lotes_fifo', 'readwrite');
            const store = tx.objectStore('lotes_fifo');
            dataCatalogo.lotes.forEach(l => store.put(l));
        }

        // 3. Guardar clientes
        if (dataCatalogo.clientes && dataCatalogo.clientes.length > 0) {
            const tx = db.transaction('clientes', 'readwrite');
            const store = tx.objectStore('clientes');
            dataCatalogo.clientes.forEach(c => store.put(c));
        }

        // 4. Guardar seguridad de empresa (Hash PIN y perfil empresa)
        if (dataCatalogo.seguridad || dataCatalogo.empresa) {
            const tx = db.transaction('seguridad_empresa', 'readwrite');
            const regSeg = dataCatalogo.seguridad || { empresa_id: empresaId };
            if (dataCatalogo.empresa) regSeg.empresa = dataCatalogo.empresa;
            if (dataCatalogo.almacenes) regSeg.almacenes = dataCatalogo.almacenes;
            tx.objectStore('seguridad_empresa').put(regSeg);
        }

        console.log('✅ [Snapshot Local] Catálogo maestro persistido exitosamente en IndexedDB.');
    }

    async function obtenerSnapshotCatalogo(empresaId) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const resultado = { items: [], almacenes: [], clientes: [], empresa: null };
            try {
                const tx = db.transaction(['catalogo_items', 'clientes', 'seguridad_empresa'], 'readonly');
                const itemsReq = tx.objectStore('catalogo_items').getAll();
                const clientesReq = tx.objectStore('clientes').getAll();
                const segReq = tx.objectStore('seguridad_empresa').get(empresaId);

                itemsReq.onsuccess = () => { resultado.items = itemsReq.result || []; };
                clientesReq.onsuccess = () => { resultado.clientes = clientesReq.result || []; };
                segReq.onsuccess = () => {
                    if (segReq.result) {
                        resultado.empresa = segReq.result.empresa || null;
                        resultado.almacenes = segReq.result.almacenes || [];
                    }
                };

                tx.oncomplete = () => resolve(resultado);
                tx.onerror = () => resolve(resultado);
            } catch (_) {
                resolve(resultado);
            }
        });
    }

    // Búsqueda local de productos en IndexedDB (< 3 ms)
    async function buscarItemsLocal(terminoNormalizado, limite = 10) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction('catalogo_items', 'readonly');
            const store = tx.objectStore('catalogo_items');
            const resultados = [];
            const cursorReq = store.openCursor();

            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const item = cursor.value;
                    const vector = (item.busqueda_vector || (item.descripcion + ' ' + (item.codigo || ''))).toLowerCase();
                    if (vector.includes(terminoNormalizado)) {
                        resultados.push(item);
                        if (resultados.length >= limite) {
                            return resolve(resultados);
                        }
                    }
                    cursor.continue();
                } else {
                    resolve(resultados);
                }
            };

            cursorReq.onerror = () => resolve([]);
        });
    }


    // =========================================================================
    // 7. EMISIÓN Y SELLADO DE TICKETS OFFLINE
    // =========================================================================
    async function emitirTicketOffline(payloadVenta) {
        payloadVenta.id = payloadVenta.id || crypto.randomUUID();
        payloadVenta.estado_sync = 'PENDIENTE_SYNC';
        payloadVenta.hora_emision = payloadVenta.hora_emision || obtenerHoraOficialLima().iso;

        // 1. Guardar comprobante en cola_ventas_sync
        await dbTransaction('cola_ventas_sync', 'readwrite', (store) => {
            store.put(payloadVenta);
        });

        // 2. Deducción local optimista en stock de catalogo_items
        if (payloadVenta.detalles && payloadVenta.detalles.length > 0) {
            try {
                const db = await openDatabase();
                const tx = db.transaction('catalogo_items', 'readwrite');
                const store = tx.objectStore('catalogo_items');

                for (const det of payloadVenta.detalles) {
                    const itemId = det.referencia_id;
                    const cant = Number(det.cantidad || 0);
                    const getReq = store.get(itemId);
                    getReq.onsuccess = () => {
                        const item = getReq.result;
                        if (item) {
                            item.stock_total = Math.max(0, (Number(item.stock_total || 0) - cant));
                            store.put(item);
                        }
                    };
                }
            } catch (errStock) {
                console.warn('[Deducción Local] Error al descontar stock optimista:', errStock);
            }
        }

        // 3. Registrar marca temporal del último ticket
        registrarUltimoTicketEmitido(payloadVenta.hora_emision);

        return payloadVenta;
    }


    // =========================================================================
    // 8. ARQUEO Y CIERRE Z OFFLINE
    // =========================================================================
    async function calcularResumenTurnoOffline(cajaIdentificador, horaAperturaIso) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction('cola_ventas_sync', 'readonly');
            const store = tx.objectStore('cola_ventas_sync');
            let totalContado = 0;
            let totalCredito = 0;
            let cantidadTickets = 0;
            let primerTicket = null;
            let ultimoTicket = null;

            const cursorReq = store.openCursor();
            cursorReq.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const v = cursor.value;
                    // Filtrar por terminal y fecha posterior a apertura
                    if (v.caja_identificador === cajaIdentificador && (!horaAperturaIso || v.hora_emision >= horaAperturaIso)) {
                        cantidadTickets++;
                        if (!primerTicket) primerTicket = v.numero_ticket;
                        ultimoTicket = v.numero_ticket;

                        const total = Number(v.precio_venta_total || 0);
                        if (v.condicion_pago === 'CONTADO') {
                            totalContado += total;
                        } else {
                            totalCredito += total;
                        }
                    }
                    cursor.continue();
                } else {
                    resolve({
                        total_ventas_contado: totalContado,
                        total_ventas_credito: totalCredito,
                        total_sistema: totalContado,
                        cantidad_tickets: cantidadTickets,
                        primer_ticket: primerTicket,
                        ultimo_ticket: ultimoTicket,
                        hora_apertura: horaAperturaIso
                    });
                }
            };
            cursorReq.onerror = () => resolve({ total_ventas_contado: 0, total_sistema: 0, cantidad_tickets: 0 });
        });
    }

    async function guardarCierreZOffline(payloadCierre) {
        payloadCierre.id = payloadCierre.id || crypto.randomUUID();
        payloadCierre.estado_sync = 'PENDIENTE_SYNC';
        payloadCierre.hora_cierre = payloadCierre.hora_cierre || obtenerHoraOficialLima().iso;

        await dbTransaction('cola_cierres_sync', 'readwrite', (store) => {
            store.put(payloadCierre);
        });

        // Marcar turno local como cerrado
        if (payloadCierre.turno_id) {
            await dbTransaction('turnos_locales', 'readwrite', (store) => {
                const req = store.get(payloadCierre.turno_id);
                req.onsuccess = () => {
                    const t = req.result;
                    if (t) {
                        t.estado = 'CERRADO';
                        t.hora_cierre = payloadCierre.hora_cierre;
                        store.put(t);
                    }
                };
            });
        }

        return payloadCierre;
    }

    async function abrirTurnoOffline(payload) {
        const turno = {
            id: payload.id || crypto.randomUUID(),
            empresa_id: payload.empresa_id,
            usuario_id: payload.usuario_id,
            caja_identificador: payload.caja_identificador || 'Caja 1',
            cajero_nombre: payload.cajero_nombre,
            fondo_inicial: Number(payload.fondo_inicial || 0),
            hora_apertura: obtenerHoraOficialLima().iso,
            estado: 'ABIERTO',
            estado_sync: 'PENDIENTE_SYNC'
        };
        await dbTransaction('turnos_locales', 'readwrite', (store) => {
            store.put(turno);
        });
        return {
            success: true,
            turno_id: turno.id,
            id: turno.id,
            cajero_nombre: turno.cajero_nombre,
            caja_identificador: turno.caja_identificador,
            fondo_inicial: turno.fondo_inicial,
            hora_apertura: turno.hora_apertura,
            offline: true
        };
    }

    async function obtenerTurnoActivoOffline(empresaId, usuarioId) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction('turnos_locales', 'readonly');
            const store = tx.objectStore('turnos_locales');
            const req = store.getAll();
            req.onsuccess = () => {
                const turnos = req.result || [];
                const activo = turnos
                    .filter(t => t.empresa_id === empresaId && t.usuario_id === usuarioId && t.estado === 'ABIERTO')
                    .sort((a, b) => (b.hora_apertura || '').localeCompare(a.hora_apertura || ''))[0];
                resolve(activo || null);
            };
            req.onerror = () => resolve(null);
        });
    }

    async function obtenerVentasLocales(empresaId) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction('cola_ventas_sync', 'readonly');
            const store = tx.objectStore('cola_ventas_sync');
            const req = store.getAll();
            req.onsuccess = () => {
                const ventas = (req.result || []).filter(v => !empresaId || v.empresa_id === empresaId);
                // Ordenar por hora_emision o fecha_venta descendente
                ventas.sort((a, b) => (b.hora_emision || b.fecha_venta || '').localeCompare(a.hora_emision || a.fecha_venta || ''));
                resolve(ventas);
            };
            req.onerror = () => resolve([]);
        });
    }

    async function obtenerVentaPorIdLocal(ventaId) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            const tx = db.transaction('cola_ventas_sync', 'readonly');
            const store = tx.objectStore('cola_ventas_sync');
            const req = store.get(ventaId);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    async function contarPendientesSync() {
        try {
            const db = await openDatabase();
            return new Promise((resolve) => {
                const tx = db.transaction(['cola_ventas_sync', 'cola_cierres_sync'], 'readonly');
                const reqV = tx.objectStore('cola_ventas_sync').count();
                const reqC = tx.objectStore('cola_cierres_sync').count();
                let vCount = 0;
                let cCount = 0;
                reqV.onsuccess = () => { vCount = reqV.result || 0; };
                reqC.onsuccess = () => { cCount = reqC.result || 0; };
                tx.oncomplete = () => resolve({ ventas: vCount, cierres: cCount, total: vCount + cCount });
                tx.onerror = () => resolve({ ventas: 0, cierres: 0, total: 0 });
            });
        } catch (_) {
            return { ventas: 0, cierres: 0, total: 0 };
        }
    }


    // =========================================================================
    // 9. ORQUESTADOR DE SINCRONIZACIÓN BATCH (CON JITTER DE 10S)
    // =========================================================================
    async function sincronizarColaOfflineConNube(supabaseClient, empresaId, cajaIdentificador) {
        if (isSyncInProgress || !navigator.onLine || !supabaseClient) {
            return { enProgreso: true };
        }

        isSyncInProgress = true;
        console.log('🔄 [Sync POS] Iniciando proceso de sincronización con la nube...');

        // 1. Escalonamiento Anti-Estampida (10s entre cajas)
        const matches = (cajaIdentificador || 'Caja 1').match(/\d+/);
        const numCaja = matches ? parseInt(matches[0], 10) : 1;
        const delayMs = ((numCaja - 1) * 10000) + Math.floor(Math.random() * 2500);

        if (delayMs > 0) {
            console.log(`⏳ [Sync POS] Aplicando retardo Jitter para ${cajaIdentificador}: ${delayMs} ms...`);
            window.dispatchEvent(new CustomEvent('pos-sync-status', {
                detail: { estado: 'ESPERANDO_JITTER', mensaje: `Turno de sincronización en ${Math.round(delayMs/1000)}s...` }
            }));
            await new Promise(r => setTimeout(r, delayMs));
        }

        try {
            const db = await openDatabase();

            // 2. Extraer turnos pendientes
            const turnosLocales = await new Promise(res => {
                const tx = db.transaction('turnos_locales', 'readonly');
                const req = tx.objectStore('turnos_locales').getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => res([]);
            });

            // 3. Extraer cierres Z pendientes
            const cierresPendientes = await new Promise(res => {
                const tx = db.transaction('cola_cierres_sync', 'readonly');
                const req = tx.objectStore('cola_cierres_sync').getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => res([]);
            });

            // 4. Extraer ventas pendientes
            const ventasPendientes = await new Promise(res => {
                const tx = db.transaction('cola_ventas_sync', 'readonly');
                const req = tx.objectStore('cola_ventas_sync').getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => res([]);
            });

            if (ventasPendientes.length === 0 && cierresPendientes.length === 0) {
                console.log('✅ [Sync POS] No hay registros pendientes de sincronización.');
                isSyncInProgress = false;
                window.dispatchEvent(new CustomEvent('pos-sync-status', { detail: { estado: 'SINCRONIZADO', pendientes: 0 } }));
                return { sincronizado: true, total: 0 };
            }

            // 5. Chunking fino por densidad de líneas de detalle (máx. 60 líneas por paquete)
            const paquetesVentas = [];
            let paqueteActual = [];
            let lineasEnPaquete = 0;

            for (const v of ventasPendientes) {
                const cantDetalles = (v.detalles && v.detalles.length) ? v.detalles.length : 1;
                if (lineasEnPaquete > 0 && (lineasEnPaquete + cantDetalles) > 60) {
                    paquetesVentas.push(paqueteActual);
                    paqueteActual = [];
                    lineasEnPaquete = 0;
                }
                paqueteActual.push(v);
                lineasEnPaquete += cantDetalles;
            }
            if (paqueteActual.length > 0) {
                paquetesVentas.push(paqueteActual);
            }

            console.log(`📦 [Sync POS] ${ventasPendientes.length} ventas divididas en ${paquetesVentas.length} paquete(s) de subida.`);

            let paquetesCompletados = 0;

            // 6. Subir paquetes secuencialmente
            for (const pVentas of paquetesVentas) {
                const payloadBatch = {
                    empresa_id: empresaId,
                    terminal_id: obtenerTerminalHardwareId(),
                    caja_identificador: cajaIdentificador,
                    turnos: turnosLocales,
                    ventas: pVentas,
                    cierres: (paquetesCompletados === paquetesVentas.length - 1) ? cierresPendientes : [] // Cierres viajan al final
                };

                window.dispatchEvent(new CustomEvent('pos-sync-status', {
                    detail: { estado: 'SUBIENDO', mensaje: `Sincronizando lote ${paquetesCompletados + 1}/${paquetesVentas.length}...` }
                }));

                const { data: respRpc, error: errRpc } = await supabaseClient.rpc('rpc_sincronizar_ventas_offline', {
                    p_payload: payloadBatch
                });

                if (errRpc) {
                    console.error('❌ [Sync POS] Error en RPC de sincronización:', errRpc);
                    throw errRpc;
                }

                // 7. Purgar ventas confirmadas de IndexedDB
                if (respRpc && respRpc.success) {
                    const idsConfirmados = (respRpc.ventas_procesadas || []).map(x => x.id).concat(
                        (respRpc.ventas_omitidas || []).map(x => x.id)
                    );

                    if (idsConfirmados.length > 0) {
                        await dbTransaction('cola_ventas_sync', 'readwrite', (store) => {
                            idsConfirmados.forEach(id => store.delete(id));
                        });
                    }

                    // Purgar cierres si fue el último paquete
                    if (respRpc.cierres_procesados && respRpc.cierres_procesados.length > 0) {
                        const idsCierres = respRpc.cierres_procesados.map(c => c.id);
                        await dbTransaction('cola_cierres_sync', 'readwrite', (store) => {
                            idsCierres.forEach(id => store.delete(id));
                        });
                    }

                    // Re-calibrar reloj con la marca oficial del servidor retornada
                    if (respRpc.timestamp_servidor) {
                        calibrarRelojConServidor(respRpc.timestamp_servidor);
                    }
                }

                paquetesCompletados++;
            }

            console.log('🎉 [Sync POS] Sincronización batch completada al 100%.');
            window.dispatchEvent(new CustomEvent('pos-sync-status', { detail: { estado: 'COMPLETO', mensaje: 'Todas las ventas están sincronizadas.' } }));

            return { sincronizado: true, total: ventasPendientes.length };

        } catch (err) {
            console.error('⚠️ [Sync POS] La sincronización falló, reintentará en el siguiente ciclo:', err);
            window.dispatchEvent(new CustomEvent('pos-sync-status', { detail: { estado: 'ERROR', mensaje: 'Sincronización en espera de conexión estable.' } }));
            return { error: err.message };
        } finally {
            isSyncInProgress = false;
        }
    }


    // =========================================================================
    // EXPORTACIÓN GLOBAL DE API
    // =========================================================================
    window.MicroERPOffline = {
        openDatabase,
        solicitarAlmacenamientoPersistente,
        calibrarRelojConServidor,
        obtenerHoraOficialLima,
        registrarUltimoTicketEmitido,
        validarPinSupervisorOffline,
        obtenerTerminalHardwareId,
        calcularSeriePorCaja,
        obtenerSiguienteCorrelativoSoberano,
        forzarPunteroCorrelativoSiMayor,
        respaldarCanastaProgreso,
        recuperarCanastaProgreso,
        limpiarCanastaProgreso,
        guardarSnapshotCatalogo,
        obtenerSnapshotCatalogo,
        buscarItemsLocal,
        emitirTicketOffline,
        abrirTurnoOffline,
        obtenerTurnoActivoOffline,
        calcularResumenTurnoOffline,
        guardarCierreZOffline,
        obtenerVentasLocales,
        obtenerVentaPorIdLocal,
        contarPendientesSync,
        sincronizarColaOfflineConNube
    };

    // Auto-solicitar persistencia al cargar script
    solicitarAlmacenamientoPersistente();

})(window);

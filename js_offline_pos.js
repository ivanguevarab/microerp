// =====================================================================================
// MÓDULO CENTRALIZADO DE PERSISTENCIA Y OPERATIVIDAD OFFLINE (MicroERP POS)
// Archivo: HTML/js_offline_pos.js
// Objetivo: Orquestación integral de IndexedDB, Motor de Reloj Maestro UTC-5, Validación
//           Criptográfica de PIN, Series Soberanas por Terminal y Sincronización Batch.
// =====================================================================================

(function (window) {
    'use strict';

    const DB_NAME = 'MicroERP_POS_Offline';
    const DB_VERSION = 2;
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
                console.log('📦 [IndexedDB] Configurando almacenes de objetos (V' + (e.newVersion || DB_VERSION) + ')...');

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

                // 11. Historial permanente de ventas locales (anti-purgado para consulta y reimpresión offline)
                if (!db.objectStoreNames.contains('historico_ventas_local')) {
                    const storeHist = db.createObjectStore('historico_ventas_local', { keyPath: 'id' });
                    storeHist.createIndex('empresa_id', 'empresa_id', { unique: false });
                    storeHist.createIndex('hora_emision', 'hora_emision', { unique: false });
                    storeHist.createIndex('numero_ticket', 'numero_ticket', { unique: false });
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
        if (typeof cajaIdentificador === 'string' && cajaIdentificador.startsWith('TCK-')) {
            return cajaIdentificador;
        }
        // 'Caja 1' -> 'TCK-2026-01', 'Caja 2' -> 'TCK-2026-02', etc.
        const matches = (cajaIdentificador || 'Caja 1').match(/\d+/);
        const numCaja = matches ? parseInt(matches[0], 10) : 1;
        const year = obtenerHoraOficialLima().fecha.substring(0, 4);
        const prefixCaja = String(numCaja).padStart(2, '0');
        return `TCK-${year}-${prefixCaja}`;
    }

    async function previsualizarSiguienteCorrelativoSoberano(arg1, arg2) {
        let serie;
        if (typeof arg1 === 'string' && arg1.startsWith('TCK-')) {
            serie = arg1;
        } else {
            serie = calcularSeriePorCaja(arg2 || arg1);
        }
        let siguienteNumero = 1;

        try {
            const db = await openDatabase();
            await new Promise((resolve) => {
                const tx = db.transaction('correlativos_terminal', 'readonly');
                const store = tx.objectStore('correlativos_terminal');
                const req = store.get(serie);
                req.onsuccess = () => {
                    const reg = req.result;
                    if (reg && reg.ultimo_numero) {
                        siguienteNumero = reg.ultimo_numero + 1;
                    }
                    resolve();
                };
                req.onerror = () => resolve();
            });
        } catch (_) {}

        const correlativoStr = String(siguienteNumero).padStart(6, '0');
        return {
            serie: serie,
            numero: siguienteNumero,
            numero_ticket: `${serie}-${correlativoStr}`
        };
    }

    async function consumirSiguienteCorrelativoSoberano(arg1, arg2) {
        let serie;
        if (typeof arg1 === 'string' && arg1.startsWith('TCK-')) {
            serie = arg1;
        } else {
            serie = calcularSeriePorCaja(arg2 || arg1);
        }
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

    async function obtenerSiguienteCorrelativoSoberano(arg1, arg2) {
        return consumirSiguienteCorrelativoSoberano(arg1, arg2);
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
            if (dataCatalogo.empresa) {
                regSeg.empresa = dataCatalogo.empresa;
                if (!regSeg.pin_hash && dataCatalogo.empresa.pin_pos_supervisor) {
                    regSeg.pin_hash = dataCatalogo.empresa.pin_pos_supervisor;
                }
            }
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
                const segStore = tx.objectStore('seguridad_empresa');

                itemsReq.onsuccess = () => { resultado.items = itemsReq.result || []; };
                clientesReq.onsuccess = () => { resultado.clientes = clientesReq.result || []; };

                if (empresaId) {
                    const segReq = segStore.get(empresaId);
                    segReq.onsuccess = () => {
                        if (segReq.result) {
                            resultado.empresa = segReq.result.empresa || null;
                            resultado.almacenes = segReq.result.almacenes || [];
                        }
                    };
                } else {
                    const segAll = segStore.getAll();
                    segAll.onsuccess = () => {
                        if (segAll.result && segAll.result.length > 0) {
                            const first = segAll.result[0];
                            resultado.empresa = first.empresa || null;
                            resultado.almacenes = first.almacenes || [];
                        }
                    };
                }

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


    async function registrarVentaEnHistoricoLocal(venta) {
        if (!venta || !venta.id) return;
        try {
            const vClon = JSON.parse(JSON.stringify(venta));
            await dbTransaction('historico_ventas_local', 'readwrite', (store) => {
                store.put(vClon);
            });
        } catch (e) {
            console.warn('[Histórico Local] Error al guardar en histórico persistente:', e);
        }
    }

    // =========================================================================
    // 7. EMISIÓN Y SELLADO DE TICKETS OFFLINE
    // =========================================================================
    async function emitirTicketOffline(payloadVenta) {
        payloadVenta.id = payloadVenta.id || crypto.randomUUID();
        payloadVenta.caja_identificador = payloadVenta.caja_identificador || window.cajaIdentificador || 'Caja 1';
        payloadVenta.estado_sync = 'PENDIENTE_SYNC';
        payloadVenta.hora_emision = payloadVenta.hora_emision || obtenerHoraOficialLima().iso;

        // 1. Guardar comprobante en cola_ventas_sync y en historico_ventas_local
        await dbTransaction('cola_ventas_sync', 'readwrite', (store) => {
            store.put(payloadVenta);
        });
        await registrarVentaEnHistoricoLocal(payloadVenta);

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
    function actualizarSnapshotVentaOnlineEnTurno(empresaId, venta) {
        if (!empresaId || !venta) return;
        try {
            const keyTurno = 'pos_turno_activo_' + empresaId;
            const strTurno = localStorage.getItem(keyTurno);
            if (!strTurno) return;
            const t = JSON.parse(strTurno);
            const total = Number(venta.precio_venta_total || 0);
            if (venta.condicion_pago === 'CONTADO' || !venta.condicion_pago) {
                t.ventas_online_contado = Number((Number(t.ventas_online_contado || 0) + total).toFixed(2));
            } else {
                t.ventas_online_credito = Number((Number(t.ventas_online_credito || 0) + total).toFixed(2));
            }
            t.cantidad_tickets_online = (Number(t.cantidad_tickets_online || 0) + 1);
            if (!t.primer_ticket_online && venta.numero_ticket) t.primer_ticket_online = venta.numero_ticket;
            if (venta.numero_ticket) t.ultimo_ticket_online = venta.numero_ticket;
            localStorage.setItem(keyTurno, JSON.stringify(t));
        } catch (e) {
            console.warn('[Turno Snapshot] Error actualizando acumulador:', e);
        }
    }

    function registrarSnapshotTurnoOnline(empresaId, datosTurno) {
        if (!empresaId || !datosTurno) return;
        try {
            const keyTurno = 'pos_turno_activo_' + empresaId;
            let t = {};
            const str = localStorage.getItem(keyTurno);
            if (str) {
                try { t = JSON.parse(str); } catch (_) {}
            }
            const idNormalizado = datosTurno.id || datosTurno.turno_id || t.id || crypto.randomUUID();
            t.id = idNormalizado;
            t.turno_id = idNormalizado;
            t.empresa_id = empresaId;
            if (datosTurno.usuario_id) t.usuario_id = datosTurno.usuario_id;
            if (datosTurno.cajero_nombre) t.cajero_nombre = datosTurno.cajero_nombre;
            if (datosTurno.caja_identificador) t.caja_identificador = datosTurno.caja_identificador;
            if (datosTurno.fondo_inicial !== undefined) t.fondo_inicial = Number(datosTurno.fondo_inicial || 0);
            if (datosTurno.hora_apertura) t.hora_apertura = datosTurno.hora_apertura;
            if (datosTurno.estado) t.estado = datosTurno.estado;
            if (datosTurno.ventas_online_contado !== undefined) {
                t.ventas_online_contado = Number(Number(datosTurno.ventas_online_contado || 0).toFixed(2));
            }
            if (datosTurno.ventas_online_credito !== undefined) {
                t.ventas_online_credito = Number(Number(datosTurno.ventas_online_credito || 0).toFixed(2));
            }
            if (datosTurno.cantidad_tickets_online !== undefined) {
                t.cantidad_tickets_online = Number(datosTurno.cantidad_tickets_online || 0);
            }
            if (datosTurno.primer_ticket_online) t.primer_ticket_online = datosTurno.primer_ticket_online;
            if (datosTurno.ultimo_ticket_online) t.ultimo_ticket_online = datosTurno.ultimo_ticket_online;

            localStorage.setItem(keyTurno, JSON.stringify(t));
            if (t.caja_identificador) localStorage.setItem('microerp_pos_caja_id', t.caja_identificador);

            // Persistir simétricamente en IndexedDB turnos_locales para blindaje offline
            dbTransaction('turnos_locales', 'readwrite', (store) => {
                store.put(t);
            }).catch(eIdb => console.warn('[Turno Snapshot IDB] Advertencia guardando en turnos_locales:', eIdb));
        } catch (e) {
            console.warn('[Turno Snapshot] Error registrando turno:', e);
        }
    }

    async function calcularResumenTurnoOffline(arg1, arg2, arg3) {
        let empresaId = null;
        let cajaIdentificador = null;
        let horaAperturaIso = null;

        if (arg3 !== undefined) {
            // Firma de 3 argumentos: (empresaId, cajaIdentificador, horaAperturaIso)
            empresaId = arg1;
            cajaIdentificador = arg2;
            horaAperturaIso = arg3;
        } else if (typeof arg1 === 'string' && arg1.length > 20 && arg1.includes('-')) {
            // Posible llamado como (empresaId, horaAperturaIso)
            empresaId = arg1;
            cajaIdentificador = null;
            horaAperturaIso = arg2;
        } else {
            // Firma de 2 argumentos: (cajaIdentificador, horaAperturaIso)
            cajaIdentificador = arg1;
            horaAperturaIso = arg2;
        }

        // 1. Recuperar snapshot acumulativo del turno activo si existe
        let turnoSnapshot = null;
        try {
            const keyTurno = 'pos_turno_activo_' + (empresaId || '');
            const strTurno = localStorage.getItem(keyTurno);
            if (strTurno) {
                turnoSnapshot = JSON.parse(strTurno);
            }
        } catch (_) {}

        const fondoInicialSnapshot = Number(turnoSnapshot?.fondo_inicial || 0);
        const cajeroNombreSnapshot = turnoSnapshot?.cajero_nombre || null;
        const horaAperturaSnapshot = turnoSnapshot?.hora_apertura || horaAperturaIso;
        const onlineContado = Number(turnoSnapshot?.ventas_online_contado || 0);
        const onlineCredito = Number(turnoSnapshot?.ventas_online_credito || 0);
        const onlineCantTickets = Number(turnoSnapshot?.cantidad_tickets_online || 0);
        const onlinePrimerTicket = turnoSnapshot?.primer_ticket_online || null;
        const onlineUltimoTicket = turnoSnapshot?.ultimo_ticket_online || null;

        const db = await openDatabase();
        return new Promise((resolve) => {
            try {
                const stores = [];
                if (db.objectStoreNames.contains('historico_ventas_local')) stores.push('historico_ventas_local');
                if (db.objectStoreNames.contains('cola_ventas_sync')) stores.push('cola_ventas_sync');

                if (stores.length === 0) {
                    return resolve({
                        total_ventas_contado: onlineContado,
                        total_ventas_credito: onlineCredito,
                        total_cobros_credito: 0,
                        total_sistema: onlineContado,
                        cantidad_tickets: onlineCantTickets,
                        primer_ticket: onlinePrimerTicket || '---',
                        ultimo_ticket: onlineUltimoTicket || '---',
                        hora_apertura: horaAperturaSnapshot,
                        fondo_inicial: fondoInicialSnapshot,
                        cajero_nombre: cajeroNombreSnapshot,
                        caja_identificador: turnoSnapshot?.caja_identificador || cajaIdentificador || 'Caja 1',
                        ventas_offline_contado: 0,
                        cantidad_tickets_offline: 0
                    });
                }

                const tx = db.transaction(stores, 'readonly');
                let ventasH = [];
                let ventasC = [];

                if (stores.includes('historico_ventas_local')) {
                    const reqH = tx.objectStore('historico_ventas_local').getAll();
                    reqH.onsuccess = () => { ventasH = reqH.result || []; };
                }

                if (stores.includes('cola_ventas_sync')) {
                    const reqC = tx.objectStore('cola_ventas_sync').getAll();
                    reqC.onsuccess = () => { ventasC = reqC.result || []; };
                }

                tx.oncomplete = () => {
                    const mapaVentas = new Map();
                    ventasH.forEach(v => { if (v && v.id) mapaVentas.set(v.id, v); });
                    ventasC.forEach(v => { if (v && v.id) mapaVentas.set(v.id, v); });
                    const todasLasVentas = Array.from(mapaVentas.values());

                    // Ordenar cronológicamente ascendente para determinar primer y último ticket
                    todasLasVentas.sort((a, b) => (a.hora_emision || a.fecha_venta || '').localeCompare(b.hora_emision || b.fecha_venta || ''));

                    let offlineContado = 0;
                    let offlineCredito = 0;
                    let offlineCantidadTickets = 0;
                    let offlinePrimerTicket = null;
                    let offlineUltimoTicket = null;
                    let pendientesSyncCount = 0;

                    for (const v of todasLasVentas) {
                        // Excluir ventas cacheadas desde la nube (evitar contaminar el cómputo offline con ventas históricas remotas)
                        if (v.origen === 'NUBE_CACHE') continue;

                        // 1. Coincidencia por empresa
                        const matchEmpresa = !empresaId || !v.empresa_id || v.empresa_id === empresaId;

                        // 2. Coincidencia por terminal/caja
                        const cajaObjetivo = (cajaIdentificador || '').toLowerCase().trim();
                        const cajaTicket = (v.caja_identificador || '').toLowerCase().trim();
                        const matchCaja = !cajaObjetivo || !cajaTicket || cajaTicket === cajaObjetivo || cajaObjetivo.includes(cajaTicket) || cajaTicket.includes(cajaObjetivo);

                        // 3. Coincidencia por marca temporal de apertura (estricto en UTC-5)
                        const horaVenta = v.hora_emision || v.created_at || (v.fecha_venta ? v.fecha_venta + 'T00:00:00-05:00' : '');
                        const matchHora = !horaAperturaSnapshot || (horaVenta && horaVenta >= horaAperturaSnapshot);

                        if (matchEmpresa && matchCaja && matchHora) {
                            offlineCantidadTickets++;
                            if (!offlinePrimerTicket) offlinePrimerTicket = v.numero_ticket;
                            offlineUltimoTicket = v.numero_ticket;

                            const total = Number(v.precio_venta_total || 0);
                            if (v.condicion_pago === 'CONTADO' || !v.condicion_pago) {
                                offlineContado += total;
                            } else {
                                offlineCredito += total;
                            }
                            if (v.estado_sync === 'PENDIENTE_SYNC') {
                                pendientesSyncCount++;
                            }
                        }
                    }

                    const totalContado = Number(Math.max(onlineContado, offlineContado).toFixed(2));
                    const totalCredito = Number(Math.max(onlineCredito, offlineCredito).toFixed(2));
                    const totalCantidad = Math.max(onlineCantTickets, offlineCantidadTickets);
                    const primerTicket = offlinePrimerTicket || onlinePrimerTicket || '---';
                    const ultimoTicket = offlineUltimoTicket || onlineUltimoTicket || '---';

                    resolve({
                        total_ventas_contado: totalContado,
                        total_ventas_credito: totalCredito,
                        total_cobros_credito: 0,
                        total_sistema: totalContado,
                        cantidad_tickets: totalCantidad,
                        primer_ticket: primerTicket,
                        ultimo_ticket: ultimoTicket,
                        hora_apertura: horaAperturaSnapshot,
                        fondo_inicial: fondoInicialSnapshot,
                        cajero_nombre: cajeroNombreSnapshot,
                        caja_identificador: turnoSnapshot?.caja_identificador || cajaIdentificador || 'Caja 1',
                        ventas_offline_contado: Number(offlineContado.toFixed(2)),
                        cantidad_tickets_offline: pendientesSyncCount
                    });
                };

                tx.onerror = () => resolve({
                    total_ventas_contado: onlineContado,
                    total_ventas_credito: onlineCredito,
                    total_cobros_credito: 0,
                    total_sistema: onlineContado,
                    cantidad_tickets: onlineCantTickets,
                    primer_ticket: onlinePrimerTicket || '---',
                    ultimo_ticket: onlineUltimoTicket || '---',
                    hora_apertura: horaAperturaSnapshot,
                    fondo_inicial: fondoInicialSnapshot,
                    cajero_nombre: cajeroNombreSnapshot,
                    caja_identificador: turnoSnapshot?.caja_identificador || cajaIdentificador || 'Caja 1',
                    ventas_offline_contado: 0,
                    cantidad_tickets_offline: 0
                });
            } catch (_) {
                resolve({
                    total_ventas_contado: onlineContado,
                    total_ventas_credito: onlineCredito,
                    total_cobros_credito: 0,
                    total_sistema: onlineContado,
                    cantidad_tickets: onlineCantTickets,
                    primer_ticket: onlinePrimerTicket || '---',
                    ultimo_ticket: onlineUltimoTicket || '---',
                    hora_apertura: horaAperturaSnapshot,
                    fondo_inicial: fondoInicialSnapshot,
                    cajero_nombre: cajeroNombreSnapshot,
                    caja_identificador: turnoSnapshot?.caja_identificador || cajaIdentificador || 'Caja 1',
                    ventas_offline_contado: 0,
                    cantidad_tickets_offline: 0
                });
            }
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
            try {
                const stores = [];
                if (db.objectStoreNames.contains('historico_ventas_local')) stores.push('historico_ventas_local');
                if (db.objectStoreNames.contains('cola_ventas_sync')) stores.push('cola_ventas_sync');

                if (stores.length === 0) return resolve([]);

                const tx = db.transaction(stores, 'readonly');
                let ventasH = [];
                let ventasC = [];

                if (stores.includes('historico_ventas_local')) {
                    const reqH = tx.objectStore('historico_ventas_local').getAll();
                    reqH.onsuccess = () => { ventasH = reqH.result || []; };
                }

                if (stores.includes('cola_ventas_sync')) {
                    const reqC = tx.objectStore('cola_ventas_sync').getAll();
                    reqC.onsuccess = () => { ventasC = reqC.result || []; };
                }

                tx.oncomplete = () => {
                    const mapaVentas = new Map();
                    ventasH.forEach(v => { if (v && (!empresaId || v.empresa_id === empresaId)) mapaVentas.set(v.id, v); });
                    ventasC.forEach(v => { if (v && (!empresaId || v.empresa_id === empresaId)) mapaVentas.set(v.id, v); });
                    const ventas = Array.from(mapaVentas.values());
                    ventas.sort((a, b) => (b.hora_emision || b.fecha_venta || '').localeCompare(a.hora_emision || a.fecha_venta || ''));
                    resolve(ventas);
                };
                tx.onerror = () => resolve([]);
            } catch (_) {
                resolve([]);
            }
        });
    }

    async function obtenerVentaPorIdLocal(ventaId) {
        const db = await openDatabase();
        return new Promise((resolve) => {
            try {
                const stores = [];
                if (db.objectStoreNames.contains('historico_ventas_local')) stores.push('historico_ventas_local');
                if (db.objectStoreNames.contains('cola_ventas_sync')) stores.push('cola_ventas_sync');

                if (stores.length === 0) return resolve(null);

                const tx = db.transaction(stores, 'readonly');
                let encontrada = null;

                if (stores.includes('historico_ventas_local')) {
                    const reqH = tx.objectStore('historico_ventas_local').get(ventaId);
                    reqH.onsuccess = () => { if (reqH.result) encontrada = reqH.result; };
                }

                if (stores.includes('cola_ventas_sync')) {
                    const reqC = tx.objectStore('cola_ventas_sync').get(ventaId);
                    reqC.onsuccess = () => { if (!encontrada && reqC.result) encontrada = reqC.result; };
                }

                tx.oncomplete = () => resolve(encontrada);
                tx.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
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
                marcarConectividadOnline();
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

            // Si no hay ventas pendientes pero sí hay cierres Z en cola, crear un paquete dedicado a los cierres
            if (paquetesVentas.length === 0 && cierresPendientes.length > 0) {
                paquetesVentas.push([]);
            }

            console.log(`📦 [Sync POS] ${ventasPendientes.length} ventas y ${cierresPendientes.length} cierres en ${paquetesVentas.length} paquete(s) de subida.`);

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

                // 7. Purgar ventas confirmadas de cola_ventas_sync y marcar como SINCRONIZADO en historico_ventas_local
                if (respRpc && respRpc.success) {
                    const idsConfirmados = (respRpc.ventas_procesadas || []).map(x => x.id).concat(
                        (respRpc.ventas_omitidas || []).map(x => x.id)
                    );

                    if (idsConfirmados.length > 0) {
                        await dbTransaction('cola_ventas_sync', 'readwrite', (store) => {
                            idsConfirmados.forEach(id => store.delete(id));
                        });

                        // Actualizar estado en historico_ventas_local y acumular en snapshot del turno activo
                        try {
                            const db = await openDatabase();
                            const txH = db.transaction('historico_ventas_local', 'readwrite');
                            const storeH = txH.objectStore('historico_ventas_local');
                            idsConfirmados.forEach(id => {
                                const reqH = storeH.get(id);
                                reqH.onsuccess = () => {
                                    if (reqH.result) {
                                        const reg = reqH.result;
                                        reg.estado_sync = 'SINCRONIZADO';
                                        reg.estado = 'EMITIDO';
                                        storeH.put(reg);
                                        // Acumular venta sincronizada en el snapshot del turno activo local
                                        if (empresaId) {
                                            actualizarSnapshotVentaOnlineEnTurno(empresaId, reg);
                                        }
                                    }
                                };
                            });
                        } catch (eH) {
                            console.warn('[Sync POS] Error actualizando historico_ventas_local tras sync:', eH);
                        }
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
            marcarConectividadOnline();
            window.dispatchEvent(new CustomEvent('pos-sync-status', { detail: { estado: 'COMPLETO', mensaje: 'Todas las ventas están sincronizadas.' } }));

            return { sincronizado: true, total: ventasPendientes.length + cierresPendientes.length, ventas: ventasPendientes.length, cierres: cierresPendientes.length };

        } catch (err) {
            console.error('⚠️ [Sync POS] La sincronización falló, reintentará en el siguiente ciclo:', err);
            marcarConectividadOffline();
            window.dispatchEvent(new CustomEvent('pos-sync-status', { detail: { estado: 'ERROR', mensaje: 'Sincronización en espera de conexión estable.' } }));
            return { error: err.message };
        } finally {
            isSyncInProgress = false;
        }
    }


    // =========================================================================
    // GESTOR DE CONECTIVIDAD REACTIVA Y CIRCUIT BREAKER (MicroERP POS)
    // =========================================================================
    window.isOfflineState = !navigator.onLine;

    function marcarConectividadOffline() {
        if (!window.isOfflineState) {
            console.warn("📴 [POS Conectividad] Conmutado a MODO OFFLINE (Circuit Breaker Activado).");
            window.isOfflineState = true;
            window.dispatchEvent(new CustomEvent('pos-connectivity-changed', { detail: { online: false } }));
            if (typeof window.actualizarBadgeSyncUI === 'function') {
                window.actualizarBadgeSyncUI('OFFLINE');
            }
        }
    }

    function marcarConectividadOnline() {
        if (window.isOfflineState) {
            console.log("🌐 [POS Conectividad] Conmutado a MODO ONLINE (Red Reestablecida).");
            window.isOfflineState = false;
            window.dispatchEvent(new CustomEvent('pos-connectivity-changed', { detail: { online: true } }));
            if (typeof window.actualizarBadgeSyncUI === 'function') {
                window.actualizarBadgeSyncUI('ONLINE');
            }
        }
    }

    async function fetchConTimeout(promesaOrFn, ms = 1200) {
        if (window.isOfflineState) {
            throw new Error('CIRCUIT_OPEN_OFFLINE');
        }

        const promesa = typeof promesaOrFn === 'function' ? promesaOrFn() : promesaOrFn;
        let timeoutId;
        const timeoutPromesa = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                marcarConectividadOffline();
                reject(new Error('TIMEOUT_RED_POS'));
            }, ms);
        });

        try {
            const res = await Promise.race([promesa, timeoutPromesa]);
            clearTimeout(timeoutId);
            return res;
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.message === 'TIMEOUT_RED_POS' || err.name === 'TypeError' || (err.message && err.message.includes('fetch'))) {
                marcarConectividadOffline();
            }
            throw err;
        }
    }

    window.marcarConectividadOffline = marcarConectividadOffline;
    window.marcarConectividadOnline = marcarConectividadOnline;
    window.fetchConTimeout = fetchConTimeout;

    // =========================================================================
    // PROBADOR ACTIVO DE CONECTIVIDAD WAN DIRECTA A SUPABASE (Bypass Cache/OS)
    // =========================================================================
    async function probarConectividadActiva(timeoutMs = 2500) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            return false;
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let timeoutId = null;
        if (controller) {
            timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        }

        try {
            let targetUrl = 'https://snyfzenjapyybbfqrnku.supabase.co/auth/v1/health';
            if (window.supabaseClient && window.supabaseClient.supabaseUrl) {
                targetUrl = window.supabaseClient.supabaseUrl.replace(/\/+$/, '') + '/auth/v1/health';
            }

            const fetchHeaders = {};
            if (window.supabaseClient && window.supabaseClient.supabaseKey) {
                fetchHeaders['apikey'] = window.supabaseClient.supabaseKey;
            }

            const fetchOptions = {
                method: 'GET',
                cache: 'no-store',
                headers: fetchHeaders
            };
            if (controller) {
                fetchOptions.signal = controller.signal;
            }

            const resp = await fetch(targetUrl, fetchOptions);
            if (timeoutId) clearTimeout(timeoutId);
            return !!resp;
        } catch (_) {
            if (timeoutId) clearTimeout(timeoutId);
            return false;
        }
    }

    async function probarYAutoSincronizar() {
        if (isSyncInProgress) {
            return;
        }

        const onlineReal = await probarConectividadActiva(2500);
        if (onlineReal) {
            marcarConectividadOnline();
            try {
                const conteo = await contarPendientesSync();
                if (conteo.total > 0) {
                    const client = window.supabaseClient;
                    const empresaId = window.currentEmpresaId || (window.currentUserProfile && window.currentUserProfile.empresa_id);
                    const cajaId = window.cajaIdentificador || localStorage.getItem('microerp_pos_caja_id') || 'Caja 1';
                    if (client && empresaId) {
                        console.log(`🚀 [AutoSync POS] Red confirmada. Sincronizando ${conteo.total} registro(s) pendiente(s)...`);
                        await sincronizarColaOfflineConNube(client, empresaId, cajaId);
                    }
                }
            } catch (err) {
                console.warn('⚠️ [AutoSync POS] Error en ciclo de auto-sincronización:', err);
            }
        } else {
            marcarConectividadOffline();
        }
    }

    // =========================================================================
    // WATCHDOG ACTIVO EN SEGUNDO PLANO (HEARTBEAT POS)
    // =========================================================================
    let watchdogTimer = null;
    function iniciarWatchdogAutoSync(intervaloMs = 12000) {
        if (watchdogTimer) {
            clearInterval(watchdogTimer);
        }
        watchdogTimer = setInterval(async () => {
            if (window.isOfflineState) {
                await probarYAutoSincronizar();
            } else {
                try {
                    const conteo = await contarPendientesSync();
                    if (conteo.total > 0) {
                        await probarYAutoSincronizar();
                    }
                } catch (_) {}
            }
        }, intervaloMs);
    }

    // =========================================================================
    // GATILLOS REACTIVOS DE ENTORNO
    // =========================================================================
    window.addEventListener('offline', () => {
        marcarConectividadOffline();
    });

    window.addEventListener('online', async () => {
        console.log("🌐 [POS Conectividad] Evento de red del navegador detectado. Comprobando salida real...");
        await probarYAutoSincronizar();
    });

    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                probarYAutoSincronizar();
            }
        });
    }

    window.addEventListener('focus', () => {
        probarYAutoSincronizar();
    });

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
        previsualizarSiguienteCorrelativoSoberano,
        consumirSiguienteCorrelativoSoberano,
        obtenerSiguienteCorrelativoSoberano,
        forzarPunteroCorrelativoSiMayor,
        respaldarCanastaProgreso,
        recuperarCanastaProgreso,
        limpiarCanastaProgreso,
        guardarSnapshotCatalogo,
        obtenerSnapshotCatalogo,
        buscarItemsLocal,
        emitirTicketOffline,
        registrarVentaEnHistoricoLocal,
        abrirTurnoOffline,
        obtenerTurnoActivoOffline,
        actualizarSnapshotVentaOnlineEnTurno,
        registrarSnapshotTurnoOnline,
        calcularResumenTurnoOffline,
        guardarCierreZOffline,
        obtenerVentasLocales,
        obtenerVentaPorIdLocal,
        contarPendientesSync,
        sincronizarColaOfflineConNube,
        marcarConectividadOffline,
        marcarConectividadOnline,
        fetchConTimeout,
        probarConectividadActiva,
        probarYAutoSincronizar,
        iniciarWatchdogAutoSync
    };

    // Auto-solicitar persistencia e iniciar watchdog de auto-sincronización
    solicitarAlmacenamientoPersistente();
    iniciarWatchdogAutoSync(12000);

})(window);

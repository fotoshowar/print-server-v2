/**
 * FotoShow Print Agent - Agente de impresión para Raspberry Pi
 *
 * Este agente se ejecuta en la Raspberry Pi y:
 * - Se conecta al Print Server (VPS) vía WebSocket
 * - Se autentifica con client_id único
 * - Mantiene conexión con heartbeat
 * - Recibe trabajos de impresión
 * - Descarga fotos
 * - Imprime con CUPS
 * - Confirma estado al servidor
 *
 * Se ejecuta automáticamente al arrancar (systemd)
 */

require('dotenv').config();
const io = require('socket.io-client');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuración
const CONFIG = {
    SERVER_URL: process.env.SERVER_URL || 'https://fotoshow.online',
    SERVER_PORT: process.env.SERVER_PORT || 3002,
    PRINTER_NAME: process.env.PRINTER_NAME || 'Impresora Principal',
    PRINTER_LOCATION: process.env.PRINTER_LOCATION || 'Desconocido',
    CLIENT_ID: process.env.CLIENT_ID || `printer-${os.hostname()}`,
    PRINTER_MODEL: process.env.PRINTER_MODEL || 'Desconocido',
    CUPS_PRINTER_NAME: process.env.CUPS_PRINTER_NAME || '',
    HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 30,
    WORK_DIR: process.env.WORK_DIR || '/tmp/fotoshow-print-agent',
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// Crear directorio de trabajo
if (!fs.existsSync(CONFIG.WORK_DIR)) {
    fs.mkdirSync(CONFIG.WORK_DIR, { recursive: true });
}

// Logging
function log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = {
        info: 'ℹ️',
        error: '❌',
        warn: '⚠️',
        debug: '🔍'
    }[level] || 'ℹ️';

    console.log(`[${timestamp}] ${prefix} ${message}`);
}

// Variables globales
let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;

// =================== CONEXIÓN AL SERVIDOR ===================

function connectToServer() {
    const wsUrl = CONFIG.SERVER_URL.replace('https://', 'wss://').replace('http://', 'ws://');

    log(`Conectando a: ${wsUrl} (path: /print/socket.io/)`, 'info');
    log(`Client ID: ${CONFIG.CLIENT_ID}`, 'info');
    log(`Impresora: ${CONFIG.PRINTER_NAME}`, 'info');

    socket = io(wsUrl, {
        path: '/print/socket.io/',
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        reconnectionAttempts: Infinity
    });

    // Conexión exitosa
    socket.on('connect', () => {
        log('✅ Conectado al Print Server', 'info');
        reconnectAttempts = 0;

        // Registrar impresora
        socket.emit('register_printer', {
            client_id: CONFIG.CLIENT_ID,
            name: CONFIG.PRINTER_NAME,
            location: CONFIG.PRINTER_LOCATION,
            printer_model: CONFIG.PRINTER_MODEL
        });

        // Iniciar heartbeat
        startHeartbeat();
    });

    // Registro exitoso
    socket.on('printer_registered', (data) => {
        if (data.success) {
            log(`✅ Impresora registrada exitosamente (ID: ${data.printer_id})`, 'info');
            log(`Hora del servidor: ${data.server_time}`, 'info');
        } else {
            log('❌ Error al registrar impresora', 'error');
        }
    });

    // Recibir trabajo de impresión
    socket.on('print_job', async (data) => {
        log(`📥 Trabajo de impresión recibido: Job #${data.job_id}`, 'info');
        await handlePrintJob(data);
    });

    // Error del servidor
    socket.on('error', (data) => {
        log(`❌ Error del servidor: ${data.message}`, 'error');
    });

    // Desconexión
    socket.on('disconnect', (reason) => {
        log(`🔌 Desconectado del servidor: ${reason}`, 'warn');
        stopHeartbeat();

        if (reason === 'io server disconnect') {
            // El servidor desconectó intencionalmente, reconectar
            socket.connect();
        }
    });

    // Reconexión
    socket.on('reconnect', (attemptNumber) => {
        log(`✅ Reconectado (intento ${attemptNumber})`, 'info');
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
        log(`⏳ Intentando reconectar (${attemptNumber}/${MAX_RECONNECT_ATTEMPTS})`, 'warn');
        reconnectAttempts = attemptNumber;

        if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
            log('❌ Máximo de intentos de reconexión alcanzado', 'error');
            socket.disconnect();
        }
    });

    socket.on('reconnect_failed', () => {
        log('❌ Fallo en reconexión', 'error');
    });
}

// =================== HEARTBEAT ===================

let heartbeatInterval = null;

function startHeartbeat() {
    stopHeartbeat();

    heartbeatInterval = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit('heartbeat');
            log('💓 Heartbeat enviado', 'debug');
        }
    }, CONFIG.HEARTBEAT_INTERVAL * 1000);

    log(`💓 Heartbeat iniciado (cada ${CONFIG.HEARTBEAT_INTERVAL}s)`, 'info');
}

function stopHeartbeat() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        log('💓 Heartbeat detenido', 'debug');
    }
}

// =================== MANEJO DE TRABAJOS DE IMPRESIÓN ===================

async function handlePrintJob(job) {
    const { job_id, photo_url, print_options = {} } = job;

    try {
        log(`📥 Procesando Job #${job_id}`, 'info');
        log(`   URL: ${photo_url}`, 'debug');

        // 1. Descargar foto
        const imagePath = await downloadPhoto(photo_url, job_id);
        log(`   ✅ Foto descargada: ${imagePath}`, 'info');

        // 2. Imprimir
        await printImage(imagePath, print_options);
        log(`   ✅ Foto enviada a impresión`, 'info');

        // 3. Confirmar al servidor
        socket.emit('print_completed', {
            job_id: job_id,
            status: 'completed'
        });
        log(`   ✅ Job #${job_id} completado`, 'info');

        // 4. Limpiar archivo temporal
        try {
            fs.unlinkSync(imagePath);
            log(`   🗑️ Archivo temporal eliminado`, 'debug');
        } catch (e) {
            log(`   ⚠️ No se pudo eliminar archivo temporal: ${e.message}`, 'warn');
        }

    } catch (error) {
        log(`❌ Error procesando Job #${job_id}: ${error.message}`, 'error');

        // Notificar fallo al servidor
        socket.emit('print_completed', {
            job_id: job_id,
            status: 'failed',
            error: error.message
        });
    }
}

// Descargar foto
async function downloadPhoto(url, jobId) {
    const filename = `job_${jobId}_${Date.now()}.jpg`;
    const imagePath = path.join(CONFIG.WORK_DIR, filename);

    log(`   📥 Descargando: ${url}`, 'info');

    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000 // 30 segundos
    });

    fs.writeFileSync(imagePath, response.data);

    return imagePath;
}

// Imprimir con CUPS
function printImage(imagePath, options) {
    return new Promise((resolve, reject) => {
        const printerName = CONFIG.CUPS_PRINTER_NAME;

        if (!printerName) {
            reject(new Error('No se configuró CUPS_PRINTER_NAME'));
            return;
        }

        log(`   🖨️ Imprimiendo en: ${printerName}`, 'info');

        // Comando lp para imprimir con CUPS
        const command = `lp -d "${printerName}" "${imagePath}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                log(`   ❌ Error de CUPS: ${error.message}`, 'error');
                if (stderr) {
                    log(`   stderr: ${stderr}`, 'error');
                }
                reject(new Error(`Error de impresión: ${error.message}`));
                return;
            }

            log(`   ✅ CUPS: ${stdout || 'Impresión en cola'}`, 'info');
            resolve();
        });
    });
}

// =================== SISTEMA ===================

// Manejar señales de terminación
process.on('SIGINT', () => {
    log('\n🛑 Recibida señal SIGINT, cerrando...', 'info');
    stopHeartbeat();
    if (socket) {
        socket.disconnect();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('\n🛑 Recibida señal SIGTERM, cerrando...', 'info');
    stopHeartbeat();
    if (socket) {
        socket.disconnect();
    }
    process.exit(0);
});

// Manejar errores no capturados
process.on('uncaughtException', (error) => {
    log(`❌ Excepción no capturada: ${error.message}`, 'error');
    console.error(error);
});

process.on('unhandledRejection', (reason, promise) => {
    log(`❌ Promesa rechazada: ${reason}`, 'error');
});

// =================== INICIAR ===================

function main() {
    log('='.repeat(60), 'info');
    log('🖨️ FOTOSHOW PRINT AGENTE', 'info');
    log('='.repeat(60), 'info');
    log(`Nombre: ${CONFIG.PRINTER_NAME}`, 'info');
    log(`Ubicación: ${CONFIG.PRINTER_LOCATION}`, 'info');
    log(`Client ID: ${CONFIG.CLIENT_ID}`, 'info');
    log(`Modelo: ${CONFIG.PRINTER_MODEL}`, 'info');
    log(`Impresora CUPS: ${CONFIG.CUPS_PRINTER_NAME || 'No configurado'}`, 'info');
    log(`Servidor: ${CONFIG.SERVER_URL}:${CONFIG.SERVER_PORT}`, 'info');
    log(`Directorio: ${CONFIG.WORK_DIR}`, 'info');
    log('='.repeat(60), 'info');
    log('\nIniciando...\n');

    // Conectar al servidor
    connectToServer();
}

// Iniciar
main();

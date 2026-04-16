#!/bin/bash

# FotoShow Print Agent - Script de Instalación Automática
# Este script instala todo lo necesario en la Raspberry Pi

set -e  # Detener si hay error

echo "=============================================="
echo "  FotoShow Print Agent - Instalación"
echo "=============================================="
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detectar usuario actual (quien ejecutó sudo)
APP_USER="${SUDO_USER:-$(whoami)}"
if [ "$APP_USER" = "root" ] && [ -n "$SUDO_USER" ]; then
    APP_USER="$SUDO_USER"
fi

# Función para imprimir mensajes
print_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# 1. Verificar que somos root o usar sudo
if [ "$EUID" -ne 0 ]; then
    print_warning "Este script debe ejecutarse con sudo"
    print_info "Ejecutando: sudo $0 $*"
    exec sudo "$0" "$@"
fi

# 2. Actualizar el sistema
print_info "Actualizando el sistema..."
apt update && apt upgrade -y
print_success "Sistema actualizado"

# 3. Instalar dependencias básicas
print_info "Instalando dependencias básicas..."
apt install -y curl wget git build-essential python3 python3-pip
print_success "Dependencias básicas instaladas"

# 4. Instalar Node.js 22
print_info "Instalando Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
print_success "Node.js instalado: $NODE_VERSION"
print_success "npm instalado: $NPM_VERSION"

# 5. Instalar CUPS (sin cups-pdf, está obsoleto)
print_info "Instalando CUPS..."
apt install -y cups printer-driver-escpr

# Habilitar CUPS
systemctl enable cups
systemctl start cups

# Agregar usuario actual al grupo lpadmin
usermod -a -G lpadmin "$APP_USER" 2>/dev/null || true

print_success "CUPS instalado y configurado"

# 6. Crear directorio del agente
print_info "Creando directorio del agente..."
mkdir -p /opt/fotoshow-print-agent
cd /opt/fotoshow-print-agent

# 7. Descargar archivos del agente
print_info "Descargando archivos del agente..."

# Crear package.json
cat > package.json << 'EOF'
{
  "name": "fotoshow-print-agent",
  "version": "1.0.0",
  "description": "FotoShow Print Agent - Agente de impresión para Raspberry Pi",
  "main": "agent.js",
  "scripts": {
    "start": "node agent.js",
    "dev": "nodemon agent.js"
  },
  "dependencies": {
    "socket.io-client": "^4.7.2",
    "axios": "^1.6.0",
    "dotenv": "^16.3.1",
    "sharp": "^0.33.0",
    "fs-extra": "^11.2.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "author": "FotoShow",
  "license": "MIT"
}
EOF

# Crear .env
print_info "Creando archivo de configuración..."

# Obtener nombre de host para CLIENT_ID único
HOSTNAME=$(hostname)

cat > .env << EOF
# Configuración del servidor
SERVER_URL=https://fotoshow.online
SERVER_PORT=3002

# Identificación de esta impresora
PRINTER_NAME=Impresora Principal
PRINTER_LOCATION=Estadio
CLIENT_ID=printer-${HOSTNAME}

# Impresora
PRINTER_MODEL=EPSON L805
CUPS_PRINTER_NAME=EPSON_L805

# Tiempo de heartbeat (segundos)
HEARTBEAT_INTERVAL=30

# Directorio de trabajo
WORK_DIR=/tmp/fotoshow-print-agent

# Logging
LOG_LEVEL=info
EOF

print_success "Configuración creada"

# 8. Descargar agent.js desde el servidor
print_info "Descargando agent.js..."

# Intentar descargar desde el servidor
if curl -fsSL https://fotoshow.online/print/agent.js -o agent.js 2>/dev/null; then
    print_success "agent.js descargado del servidor"
elif curl -fsSL https://raw.githubusercontent.com/fotoshowar/print-server-v2/main/agent.js -o agent.js 2>/dev/null; then
    print_success "agent.js descargado de GitHub"
else
    print_error "No se pudo descargar agent.js"
    print_info "Debes copiar el archivo agent.js manualmente:"
    print_info "  scp root@<TU-VPS>:/root/fotoshow-print-agent/agent.js pi@$(hostname):/opt/fotoshow-print-agent/"
    exit 1
fi

# 9. Instalar dependencias de Node.js
print_info "Instalando dependencias de Node.js..."
npm install --production
print_success "Dependencias instaladas"

# 10. Crear servicio systemd
print_info "Creando servicio systemd..."

cat > /etc/systemd/system/fotoshow-print-agent.service << EOF
[Unit]
Description=FotoShow Print Agent
Documentation=https://github.com/fotoshowar/print-server-v2
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=/opt/fotoshow-print-agent
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fotoshow-print-agent

# Environment
Environment="NODE_ENV=production"

# Resource limits
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

print_success "Servicio systemd creado"

# 11. Habilitar servicio
print_info "Habilitando servicio..."
systemctl daemon-reload
systemctl enable fotoshow-print-agent
print_success "Servicio habilitado"

# 12. Configurar permisos
print_info "Configurando permisos..."
chown -R "$APP_USER:$APP_USER" /opt/fotoshow-print-agent
print_success "Permisos configurados"

# 13. Preguntar por el nombre de la impresora CUPS
echo ""
print_warning "CONFIGURACIÓN DE LA IMPRESORA"
print_info "Listando impresoras disponibles en CUPS..."

if command -v lpstat &> /dev/null; then
    lpstat -p 2>/dev/null || print_warning "No se encontraron impresoras configuradas en CUPS"
    echo ""
fi

print_info "Ingresa el nombre de la impresora en CUPS (ej: EPSON_L805):"
print_info "Deja vacío para usar el valor por defecto (EPSON_L805)"
read -p "> " PRINTER_NAME_INPUT

if [ ! -z "$PRINTER_NAME_INPUT" ]; then
    sed -i "s/CUPS_PRINTER_NAME=.*/CUPS_PRINTER_NAME=${PRINTER_NAME_INPUT}/" /opt/fotoshow-print-agent/.env
    print_success "Impresora configurada: $PRINTER_NAME_INPUT"
else
    print_success "Usando impresora por defecto: EPSON_L805"
fi

# 14. Preguntar por el nombre de la impresora
echo ""
print_info "Ingresa un nombre descriptivo para esta impresora (ej: Impresora Campo):"
read -p "> " PRINTER_DISPLAY_NAME_INPUT

if [ ! -z "$PRINTER_DISPLAY_NAME_INPUT" ]; then
    sed -i "s/PRINTER_NAME=.*/PRINTER_NAME=${PRINTER_DISPLAY_NAME_INPUT}/" /opt/fotoshow-print-agent/.env
    print_success "Nombre descriptivo: $PRINTER_DISPLAY_NAME_INPUT"
fi

# 15. Iniciar servicio
print_info "Iniciando servicio..."
systemctl start fotoshow-print-agent
sleep 3

# 16. Verificar estado
if systemctl is-active --quiet fotoshow-print-agent; then
    print_success "Servicio iniciado correctamente"
else
    print_error "El servicio no pudo iniciarse"
    print_info "Verifica los logs con: journalctl -u fotoshow-print-agent -f"
    exit 1
fi

# 17. Mostrar estado
echo ""
print_info "Estado del servicio:"
systemctl status fotoshow-print-agent --no-pager | head -15

# 18. Instrucciones finales
echo ""
echo "=============================================="
print_success "¡Instalación completada!"
echo "=============================================="
echo ""
print_info "Siguientes pasos:"
echo ""
echo "1. Verificar que la impresora esté configurada en CUPS:"
echo "   - Abre http://localhost:631 en tu navegador"
echo "   - O usa: lpstat -p"
echo ""
echo "2. Si la impresora no está configurada, agrégala en CUPS:"
echo "   - Ve a http://localhost:631"
echo "   - Administration → Add Printer"
echo "   - Sigue los pasos"
echo ""
echo "3. Verificar que el agente esté conectado:"
echo "   - Ver los logs: journalctl -u fotoshow-print-agent -f"
echo "   - Deberías ver: '✅ Conectado al Print Server'"
echo ""
echo "4. Verificar en el Print Server:"
echo "   - Ve a: https://fotoshow.online/print"
echo "   - Deberías ver tu impresora en la lista"
echo ""
echo "5. Si algo no funciona:"
echo "   - Reiniciar el servicio: sudo systemctl restart fotoshow-print-agent"
echo "   - Ver logs: sudo journalctl -u fotoshow-print-agent -n 50"
echo ""
print_info "Comandos útiles:"
echo "  - Ver estado: sudo systemctl status fotoshow-print-agent"
echo "  - Reiniciar: sudo systemctl restart fotoshow-print-agent"
echo "  - Ver logs: sudo journalctl -u fotoshow-print-agent -f"
echo "  - Detener: sudo systemctl stop fotoshow-print-agent"
echo ""
print_success "¡Listo! Tu Raspberry Pi ya está conectada al Print Server."
echo ""

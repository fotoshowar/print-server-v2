# 🖨️ Instalación del Print Agent en Raspberry Pi

## Método Rápido (Script Automático)

### 1. Copiar el script de instalación a la Raspberry Pi

Desde tu computadora:

```bash
scp root@<TU-VPS>:/root/fotoshow-print-agent/install.sh pi@<IP-DE-LA-PI>:~
```

### 2. Ejecutar el script en la Raspberry Pi

```bash
# Entrar a la Raspberry Pi
ssh pi@<IP-DE-LA-PI>

# Dar permisos de ejecución
chmod +x install.sh

# Ejecutar el script (responde las preguntas)
sudo ./install.sh
```

El script hace todo automáticamente:
- ✅ Actualiza el sistema
- ✅ Instala Node.js 22
- ✅ Instala CUPS
- ✅ Descarga los archivos del agente
- ✅ Instala dependencias
- ✅ Configura el servicio systemd
- ✅ Inicia el servicio

---

## Configuración de la Impresora en CUPS

### Método Web (Recomendado)

1. Abrir http://localhost:631 en el navegador
2. Ir a "Administration" → "Add Printer"
3. Seleccionar la impresora y configurar
4. Marcar "Share This Printer"

### Método Línea de Comandos

```bash
# Listar impresoras disponibles
lpstat -p

# Agregar impresora (ejemplo: EPSON L805)
sudo lpadmin -p EPSON_L805 -E -v usb://EPSON/L805 -m everywhere

# Establecer como default
sudo lpoptions -d EPSON_L805
```

---

## Verificar Funcionamiento

### 1. Verificar que el servicio está corriendo

```bash
sudo systemctl status fotoshow-print-agent
```

Debería ver: `Active: active (running)`

### 2. Ver logs en tiempo real

```bash
sudo journalctl -u fotoshow-print-agent -f
```

Deberías ver:
```
✅ Conectado al Print Server
✅ Impresora registrada exitosamente (ID: X)
💓 Heartbeat iniciado (cada 30s)
```

### 3. Verificar en el Print Server

Ir a: https://fotoshow.online/print

Deberías ver tu impresora en la lista "Impresoras Conectadas".

---

## Comandos Útiles

```bash
# Ver estado
sudo systemctl status fotoshow-print-agent

# Reiniciar servicio
sudo systemctl restart fotoshow-print-agent

# Ver logs (últimas 50 líneas)
sudo journalctl -u fotoshow-print-agent -n 50

# Ver logs en tiempo real
sudo journalctl -u fotoshow-print-agent -f

# Detener servicio
sudo systemctl stop fotoshow-print-agent

# Iniciar servicio
sudo systemctl start fotoshow-print-agent

# Deshabilitar arranque automático
sudo systemctl disable fotoshow-print-agent

# Habilitar arranque automático
sudo systemctl enable fotoshow-print-agent
```

---

## Configuración Manual

Si el script automático no funciona, instala manualmente:

### 1. Instalar Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Debe mostrar v22.x.x
npm --version   # Debe mostrar 10.x.x
```

### 2. Instalar CUPS

```bash
sudo apt install -y cups cups-pdf printer-driver-escpr
sudo systemctl enable cups
sudo systemctl start cups
sudo usermod -a -G lpadmin pi
```

### 3. Crear directorio y copiar archivos

```bash
sudo mkdir -p /opt/fotoshow-print-agent
cd /opt/fotoshow-print-agent

# Copiar archivos desde el VPS
# (reemplaza <TU-VPS> con la IP de tu VPS)
scp root@<TU-VPS>:/root/fotoshow-print-agent/* .
```

### 4. Instalar dependencias

```bash
sudo npm install
```

### 5. Configurar

Editar `.env`:

```bash
nano .env
```

Configurar:
- `CUPS_PRINTER_NAME` = Nombre de tu impresora en CUPS
- `CLIENT_ID` = ID único (ej: printer-001)
- `PRINTER_NAME` = Nombre descriptivo (ej: Impresora Campo)

### 6. Crear servicio systemd

```bash
sudo nano /etc/systemd/system/fotoshow-print-agent.service
```

Contenido:

```ini
[Unit]
Description=FotoShow Print Agent
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/fotoshow-print-agent
ExecStart=/usr/bin/node agent.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=fotoshow-print-agent
Environment="NODE_ENV=production"
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 7. Habilitar e iniciar

```bash
sudo systemctl daemon-reload
sudo systemctl enable fotoshow-print-agent
sudo systemctl start fotoshow-print-agent
```

---

## Troubleshooting

### El agente no se conecta

1. Verificar acceso a internet:
   ```bash
   ping fotoshow.online
   ```

2. Verificar que el Print Server esté funcionando:
   ```bash
   curl https://fotoshow.online/print/api/stats
   ```

3. Revisar logs:
   ```bash
   sudo journalctl -u fotoshow-print-agent -n 50
   ```

### La impresora no imprime

1. Verificar CUPS:
   ```bash
   sudo systemctl status cups
   lpstat -p
   ```

2. Probar imprimir manualmente:
   ```bash
   echo "Test" | lp -d EPSON_L805
   ```

3. Verificar `CUPS_PRINTER_NAME` en `.env`

### El servicio no inicia

1. Verificar Node.js:
   ```bash
   node --version
   npm --version
   ```

2. Verificar dependencias:
   ```bash
   cd /opt/fotoshow-print-agent
   npm list
   ```

3. Verificar permisos:
   ```bash
   ls -la /opt/fotoshow-print-agent
   sudo chown -R pi:pi /opt/fotoshow-print-agent
   ```

---

## Múltiples Raspberry Pis

Si tienes múltiples Raspberry Pis, cambia en cada una:

**En `.env`:**
- `CLIENT_ID` = ID único (printer-001, printer-002, etc.)
- `PRINTER_NAME` = Nombre descriptivo diferente
- `PRINTER_LOCATION` = Ubicación diferente

---

## Soporte

- **Print Server:** https://fotoshow.online/print
- **Documentación completa:** `/root/fotoshow-print-agent/README.md`
- **Script de instalación:** `/root/fotoshow-print-agent/install.sh`
- **Logs:** `sudo journalctl -u fotoshow-print-agent -f`

---

_Última actualización: 2026-04-16_

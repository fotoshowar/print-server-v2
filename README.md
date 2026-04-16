# FotoShow Print Agent

Agente de impresión para Raspberry Pi que se conecta al FotoShow Print Server.

## Características

- 🔌 Conexión automática al Print Server (WebSocket)
- 💓 Heartbeat para mantener conexión activa
- 🖨️ Integración con CUPS para impresión
- 🔄 Reconexión automática
- 📊 Logs detallados

## Instalación Rápida

```bash
# Descargar script de instalación
wget https://raw.githubusercontent.com/fotoshowar/print-agent/main/install.sh

# Ejecutar
chmod +x install.sh
sudo ./install.sh
```

Para más información, ver [INSTALL.md](INSTALL.md).

## Configuración

Edita `.env`:

```env
SERVER_URL=https://fotoshow.online
CLIENT_ID=printer-001
CUPS_PRINTER_NAME=EPSON_L805
```

## Uso

```bash
# Iniciar servicio
sudo systemctl start fotoshow-print-agent

# Ver estado
sudo systemctl status fotoshow-print-agent

# Ver logs
sudo journalctl -u fotoshow-print-agent -f
```

## Documentación

- [Instrucciones de instalación](INSTALL.md)
- [README completo](README.md)

## Soporte

- Print Server: https://fotoshow.online/print
- Issues: https://github.com/fotoshowar/print-agent/issues

## Licencia

MIT

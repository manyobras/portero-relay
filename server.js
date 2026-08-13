const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let esp32Socket = null;
let appClients = new Set();
let lastFrame = null; // Guardar el último frame JPEG recibido

// 1. Ruta de verificación básica
app.get('/', (req, res) => {
  res.send('Servidor Puente de Video activo.');
});

// 2. Ruta para ver el Stream MJPEG directamente en el navegador de tu celular/PC
app.get('/video', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=--frame',
    'Cache-Control': 'no-cache',
    'Connection': 'close',
    'Pragma': 'no-cache'
  });

  const timer = setInterval(() => {
    if (lastFrame) {
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${lastFrame.length}\r\n\r\n`);
      res.write(lastFrame);
      res.write('\r\n');
    }
  }, 150);

  req.on('close', () => {
    clearInterval(timer);
  });
});

// 3. Manejo de conexiones WebSocket
wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/?', ''));
  const role = urlParams.get('role');

  // Si la URL trae ?role=esp32
  if (role === 'esp32') {
    console.log('[SISTEMA] ESP32-S3 identificada por parámetro URL.');
    esp32Socket = ws;
  } else {
    // Por defecto se asume cliente hasta que envíe datos
    appClients.add(ws);
    console.log('[SISTEMA] 📱 Nuevo cliente enlazado al puente.');

    // Enviar inmediatamente el último cuadro guardado al conectar
    if (lastFrame && ws.readyState === WebSocket.OPEN) {
      ws.send(lastFrame);
    }
  }

  ws.on('message', (data, isBinary) => {
    // Si la conexión envía datos binarios (Buffer JPEG de la cámara)
    if (isBinary || Buffer.isBuffer(data)) {
      // Si aún no habíamos marcado este socket como la ESP32, lo ascendemos
      if (esp32Socket !== ws) {
        console.log('[SISTEMA] 📹 ESP32-S3 detectada transmitiendo flujo de video.');
        esp32Socket = ws;
        appClients.delete(ws); // Retirar de la lista de apps
      }

      lastFrame = data; // Guardar último frame en memoria

      // Retransmitir a todas las apps en Flutter
      for (let client of appClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    }
  });

  ws.on('close', () => {
    if (ws === esp32Socket) {
      console.log('[SISTEMA] ❌ ESP32-S3 desconectada.');
      esp32Socket = null;
    } else {
      console.log('[SISTEMA] ❌ App Flutter desconectada.');
      appClients.delete(ws);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});

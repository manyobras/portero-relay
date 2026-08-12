const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Ruta básica para verificar que el servidor está vivo desde el navegador
app.get('/', (req, res) => {
  res.send(' Servidor Puente de Video para Portero Inteligente activo.');
});

// Guardamos la conexión de la ESP32 y la lista de celulares conectados
let esp32Socket = null;
let appClients = new Set();

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/?', ''));
  const role = urlParams.get('role');

  if (role === 'esp32') {
    console.log('[SISTEMA]  ESP32-S3 de la portería conectada al puente.');
    esp32Socket = ws;

    // Cuando la ESP32 envía una imagen (buffer binario JPEG)
    ws.on('message', (data) => {
      // Retransmitir la imagen inmediatamente a todos los celulares conectados
      for (let client of appClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    });

    ws.on('close', () => {
      console.log('[SISTEMA] ❌ ESP32-S3 desconectada del puente.');
      esp32Socket = null;
    });

  } else {
    // Si no es la ESP32, es una App en un celular
    console.log('[SISTEMA] 📱 App Flutter conectada al puente.');
    appClients.add(ws);

    ws.on('close', () => {
      console.log('[SISTEMA] ❌ App Flutter desconectada.');
      appClients.delete(ws);
    });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});
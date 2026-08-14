const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json()); // Permite recibir JSON en los webhooks

// ---------------------------------------------------------
// 1. INICIALIZACIÓN DE SERVICIOS (Firebase y Supabase)
// ---------------------------------------------------------

// Inicialización de Firebase con el Project ID (sin archivo JSON local)
admin.initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID || 'porterointeligente-1523c'
});

// Inicialización del cliente de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
let supabase = null;

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
  console.log('[SISTEMA] Supabase cliente inicializado.');
} else {
  console.warn('[ADVERTENCIA] SUPABASE_URL o SUPABASE_KEY no configuradas en las variables de entorno.');
}

// ---------------------------------------------------------
// 2. RUTAS HTTP (Servidor Express)
// ---------------------------------------------------------

// Ruta básica de verificación
app.get('/', (req, res) => {
  res.send('Servidor Puente de Video y Notificaciones activo.');
});

// Ruta para ver el Stream MJPEG directamente en navegador
let lastFrame = null; // Guardar el último frame JPEG recibido

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

// Endpoint del Webhook para Notificaciones Push (Timbre)
app.post('/webhook-timbre', async (req, res) => {
  try {
    const { record } = req.body;
    console.log('[WEBHOOK] Datos recibidos de Supabase:', record);

    if (record && (record.estado === 'LLAMANDO' || record.id_evento === 1)) {
      const aptoDestino = record.apto_destino || record.apto_id;

      if (!supabase) {
        throw new Error('Supabase no está configurado');
      }

      // Buscar el FCM token del apartamento que está siendo llamado
      const { data, error } = await supabase
        .from('user_tokens')
        .select('fcm_token')
        .eq('apto_id', aptoDestino)
        .single();

      if (error) {
        console.error('[SUPABASE] Error buscando token:', error.message);
      }

      if (data && data.fcm_token) {
        const message = {
          token: data.fcm_token,
          data: {
            title: "🔔 CITÓFONO ENTRANTE",
            body: `Están llamando al apartamento ${aptoDestino}`,
            apto: String(aptoDestino)
          },
          android: {
            priority: "high",
            notification: {
              channelId: "canal_portero_timbre",
              sound: "timbre_citofono",
              priority: "max"
            }
          }
        };

        await admin.messaging().send(message);
        console.log(`[FCM] Notificación enviada con éxito al apto ${aptoDestino}`);
      } else {
        console.log(`[FCM] No se encontró FCM token registrado para el apto ${aptoDestino}`);
      }
    }
    res.status(200).send({ status: 'ok' });
  } catch (err) {
    console.error('[FCM Error]', err);
    res.status(500).send({ error: err.message });
  }
});

// ---------------------------------------------------------
// 3. MANEJO DE WEBSOCKETS (Cámara ESP32-S3 y Flutter)
// ---------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let esp32Socket = null;
let appClients = new Set();

wss.on('connection', (ws, req) => {
  const urlParams = new URLSearchParams(req.url.replace('/?', ''));
  const role = urlParams.get('role');

  if (role === 'esp32') {
    console.log('[SISTEMA] ESP32-S3 identificada por parámetro URL.');
    esp32Socket = ws;
  } else {
    appClients.add(ws);
    console.log('[SISTEMA] 📱 Nuevo cliente enlazado al puente.');

    if (lastFrame && ws.readyState === WebSocket.OPEN) {
      ws.send(lastFrame);
    }
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary || Buffer.isBuffer(data)) {
      if (esp32Socket !== ws) {
        console.log('[SISTEMA] 📹 ESP32-S3 detectada transmitiendo flujo de video.');
        esp32Socket = ws;
        appClients.delete(ws);
      }

      lastFrame = data;

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

// ---------------------------------------------------------
// 4. INICIO DEL SERVIDOR
// ---------------------------------------------------------

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});

/**
 * server.js - Render-ready with Supabase + WebSocket
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

// -------- Environment --------
const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate required environment variables
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  if (!SUPABASE_URL) console.error('   - SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) console.error('   - SUPABASE_SERVICE_ROLE_KEY');
  console.error('Please set these in your Render dashboard or .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
console.log('✅ Connected to Supabase:', SUPABASE_URL);

const app = express();
const server = http.createServer(app);

// -------- WebSocket Clients Set (declared early for health check) --------
let clients = new Set();

// -------- Middlewares --------
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------- JSON parse error handler (returns 400 instead of HTML stack) --------
app.use((err, req, res, next) => {
  // body-parser sets err.type === 'entity.parse.failed' for invalid JSON
  if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400 && 'body' in err))) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next(err);
});

// -------- Health Check (Required for Render) --------
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    websocketClients: clients.size
  });
});

// -------- Email Config --------
let emailConfig = { email: '', password: '' };

// Fetch email config from Supabase
(async () => {
  const { data, error } = await supabase
    .from('email_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (!error && data) {
    emailConfig.email = data.email;
    emailConfig.password = data.password;
  }
})();

// -------- Email Helper --------
async function sendEmail(subject, text) {
  if (!emailConfig.email || !emailConfig.password) return;
  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: emailConfig.email, pass: emailConfig.password }
    });
    await transporter.sendMail({
      from: emailConfig.email,
      to: emailConfig.email,
      subject,
      text
    });
    console.log("Email sent:", subject);
  } catch (err) {
    console.log("Email error:", err);
  }
}

// -------- REST API --------

// Medicines CRUD
app.get('/api/medicines', async (req, res) => {
  const { data, error } = await supabase.from('medicines').select('*').order('name');
  error ? res.status(500).json({ error }) : res.json(data);
});

app.post('/api/medicines', async (req, res) => {
  const { name, count, expiry_date } = req.body;
  const { data, error } = await supabase.from('medicines').insert([{ name, count, expiry_date }]).select().single();
  error ? res.status(500).json({ error }) : res.json(data);
});

app.delete('/api/medicines/:id', async (req, res) => {
  const { data, error } = await supabase.from('medicines').delete().eq('id', req.params.id);
  error ? res.status(500).json({ error }) : res.json({ deleted: data.length });
});

// Consume medicine
app.post('/api/medicines/:id/consume', async (req, res) => {
  const id = req.params.id;
  const { data: medData, error: medError } = await supabase.from('medicines').select('*').eq('id', id).single();
  if (medError || !medData) return res.status(404).json({ error: 'Medicine not found' });
  if (medData.count <= 0) return res.status(400).json({ error: 'Out of stock' });

  const newCount = medData.count - 1;

  await supabase.from('medicines').update({ count: newCount }).eq('id', id);
  await supabase.from('consumption_logs').insert([{ medicine_id: id, medicine_name: medData.name }]);

  if (newCount === 0) sendEmail(`🚨 ${medData.name} is OUT`, `Stock empty for ${medData.name}`);

  res.json({ success: true, newCount });
});

// Reminders
app.get('/api/reminders', async (req, res) => {
  const { data, error } = await supabase.from('reminders').select('*').order('id', { ascending: false });
  error ? res.status(500).json({ error }) : res.json(data);
});

app.get('/api/reminders/:id', async (req, res) => {
  const id = req.params.id;
  const { data, error } = await supabase.from('reminders').select('*').eq('id', id).single();
  if (error) return res.status(500).json({ error });
  if (!data) return res.status(404).json({ error: 'Reminder not found', id });
  res.json(data);
});

app.post('/api/reminders', async (req, res) => {
  const { title, details, iso_date, repeats, medicine_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const insertRow = { title, details: details || null, iso_date: iso_date || null, repeats: repeats || null, medicine_id: medicine_id || null };
  const { data, error } = await supabase.from('reminders').insert([insertRow]).select().single();
  if (error) return res.status(500).json({ error });
  res.status(201).json(data);
});

app.patch('/api/reminders/:id', async (req, res) => {
  const id = req.params.id;
  const allowed = ['title','details','iso_date','repeats','medicine_id'];
  const updates = {};
  for (const k of allowed) if (k in req.body) updates[k] = req.body[k];
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  const { data, error } = await supabase.from('reminders').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error });
  if (!data) return res.status(404).json({ error: 'Reminder not found', id });
  res.json(data);
});

app.delete('/api/reminders/:id', async (req, res) => {
  const id = req.params.id;
  console.log(`Deleting reminder id=${id}`);
  // Use .select() so Supabase returns deleted rows; otherwise data can be null
  const { data, error } = await supabase.from('reminders').delete().eq('id', id).select();
  if (error) {
    console.error('Error deleting reminder:', error);
    return res.status(500).json({ error });
  }
  if (!data || data.length === 0) return res.status(404).json({ error: 'Reminder not found', id });
  // Return deleted rows for clarity
  res.json({ deleted: data.length, id, rows: data });
});

// Consumption logs
app.get('/api/consumption-logs', async (req, res) => {
  const { data, error } = await supabase.from('consumption_logs').select('*').order('consumed_at', { ascending: false });
  error ? res.status(500).json({ error }) : res.json(data);
});

// -------- Emergency --------
function broadcast(msg) { for (const ws of clients) if (ws.readyState === 1) ws.send(msg); }

app.post('/api/emergency', async (req, res) => {
  const payload = { type: 'emergency', time: new Date().toISOString() };
  broadcast(JSON.stringify(payload));
  await sendEmail("🚨 EMERGENCY ALERT", "Button pressed!");
  res.json({ ok: true });
});

const mqtt = require('mqtt');

/* ================= MQTT ================= */
const MQTT_BROKER = 'mqtt://broker.hivemq.com';
const MQTT_TOPIC = 'project123/device/data';

const mqttClient = mqtt.connect(MQTT_BROKER);

mqttClient.on('connect', () => {
  console.log('✅ Connected to MQTT broker');
  mqttClient.subscribe(MQTT_TOPIC);
});

mqttClient.on('message', (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    latestDeviceData = data;
    broadcast(JSON.stringify({ type: 'device-data', data }));
  } catch (e) {
    console.error('MQTT parse error');
  }
});


// -------- WebSocket Server --------
const wss = new WebSocketServer({ server, path: "/ws" });
let latestDeviceData = null;

wss.on("connection", (ws) => {
  clients.add(ws);

  // Send latest device data immediately
  if (latestDeviceData) ws.send(JSON.stringify({ type: 'device-data', data: latestDeviceData }));

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      latestDeviceData = data;
      broadcast(JSON.stringify({ type: 'device-data', data }));
    } catch (_) {}
  });

  ws.on("close", () => clients.delete(ws));
});

// -------- Serve SPA --------
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

// -------- Start Server --------
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

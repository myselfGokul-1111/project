#include <WiFi.h>
#include <WebSocketsClient.h>
#include <Wire.h>
#include <MPU6050.h>

// WiFi
const char* ssid = "AndroidAP";
const char* password = "123456789";

// Render WebSocket Server
const char* serverHost = "project123-0xep.onrender.com";
const uint16_t serverPort = 443;
const char* serverPath = "/ws";

WebSocketsClient webSocket;
MPU6050 mpu;

// ECG input pin (your original working pin)
const int ecgPin = 2;

// sending rate
unsigned long lastSend = 0;
const unsigned long sendInterval = 100; // 10Hz

// WebSocket event handler
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      Serial.println("[WSS] Disconnected");
      break;

    case WStype_CONNECTED:
      Serial.println("[WSS] Connected to Render!");
      webSocket.sendTXT("{\"type\":\"auth\",\"role\":\"device\"}");
      break;

    case WStype_TEXT:
      Serial.printf("[WSS] Received: %s\n", payload);
      break;
  }
}

void initWebSocket() {
  Serial.printf("[WSS] Connecting to %s:%u%s\n", serverHost, serverPort, serverPath);
  webSocket.beginSSL(serverHost, serverPort, serverPath, "");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void setup() {
  Serial.begin(115200);

  // ECG input
  pinMode(ecgPin, INPUT);

  // WiFi
  WiFi.begin(ssid, password);
  Serial.print("[WIFI] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(50);
  }
  Serial.println("\n[WIFI] Connected!");

  // MPU6050 – default ESP32 I2C pins 21/22 automatically
  Wire.begin();
  mpu.initialize();
  if (!mpu.testConnection()) {
    Serial.println("MPU6050 NOT FOUND!");
  } else {
    Serial.println("MPU6050 Connected!");
  }

  initWebSocket();
}

void sendSensorData() {
  if (!webSocket.isConnected()) return;

  int ecgValue = analogRead(ecgPin);

  int16_t ax, ay, az, gx, gy, gz;
  mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  String msg = "{";
  msg += "\"type\":\"device-data\",";
  msg += "\"ecg\":" + String(ecgValue);
  msg += ",\"ax\":" + String(ax);
  msg += ",\"ay\":" + String(ay);
  msg += ",\"az\":" + String(az);
  msg += ",\"gx\":" + String(gx);
  msg += ",\"gy\":" + String(gy);
  msg += ",\"gz\":" + String(gz);
  msg += "}";

  webSocket.sendTXT(msg);
  Serial.println(msg);
}

void loop() {
  webSocket.loop();

  if (millis() - lastSend > sendInterval) {
    lastSend = millis();
    sendSensorData();
  }
}

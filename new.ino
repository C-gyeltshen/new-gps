#include <TinyGPS++.h>
#include <SoftwareSerial.h>

// =====================================================
// SIM800C
// =====================================================

#define SIM800_TX 9
#define SIM800_RX 8

SoftwareSerial sim800(SIM800_TX, SIM800_RX);

// =====================================================
// GPS MODULE
// =====================================================

#define GPS_TX 11
#define GPS_RX 10

SoftwareSerial gpsSerial(GPS_TX, GPS_RX);

TinyGPSPlus gps;

// =====================================================
// CONFIGURATION
// =====================================================

// ⚠️ IMPORTANT: Change this to your carrier's APN
const char APN[] = "ticlnet";  // Change if needed

// ngrok URL - Use the FULL URL without http:// prefix
// Example: "0eb8-2405-d000-a11c-8c22-8cd3-7df3-f9a5-b1ec.ngrok-free.app"
const char SERVER_HOST[] = "9550-2405-d000-a11c-8c22-8cd3-7df3-f9a5-b1ec.ngrok-free.app";
const char SERVER_PATH[] = "/api/vehicle/location";
const char VEHICLE_ID[] = "VEHICLE_003";

// How often to POST a location (milliseconds)
const unsigned long SEND_INTERVAL = 10000UL;  // 10 seconds

// =====================================================

unsigned long lastSendTime = 0;
bool gprsConnected = false;

// =====================================================
// READ RESPONSE
// =====================================================

String readResponse(unsigned long timeout = 5000) {
  String response = "";
  unsigned long start = millis();
  
  while (millis() - start < timeout) {
    while (sim800.available()) {
      char c = sim800.read();
      response += c;
      Serial.write(c);
    }
  }
  
  if (response.length() > 0) {
    Serial.println();
  }
  Serial.println(F("[---]"));
  
  return response;
}

// =====================================================
// SEND COMMAND
// =====================================================

String sendCommand(String cmd, unsigned long timeout = 5000, bool echo = true) {
  sim800.listen();
  delay(200);
  
  if (echo) {
    Serial.print(F("[CMD] "));
    Serial.println(cmd);
  }
  
  sim800.println(cmd);
  return readResponse(timeout);
}

// =====================================================
// CHECK BEARER STATUS
// =====================================================

bool isBearerActive() {
  String response = sendCommand("AT+SAPBR=2,1", 5000, false);
  
  Serial.println(F("[BEARER CHECK]"));
  Serial.println(response);
  
  // Check if IP is assigned (response contains "+SAPBR: 1,1")
  if (response.indexOf("1,1") >= 0) {
    // Extract and show IP address if present
    int ipStart = response.indexOf('"');
    if (ipStart > 0) {
      int ipEnd = response.indexOf('"', ipStart + 1);
      if (ipEnd > ipStart) {
        Serial.print(F("[IP ADDRESS] "));
        Serial.println(response.substring(ipStart + 1, ipEnd));
      }
    }
    return true;
  }
  
  return false;
}

// =====================================================
// RECONNECT GPRS
// =====================================================

bool reconnectGPRS() {
  Serial.println(F("[RECONNECTING GPRS]"));
  
  // Close existing bearer
  sendCommand("AT+SAPBR=0,1", 5000, true);
  delay(2000);
  
  // Attach to GPRS
  sendCommand("AT+CGATT=1", 10000, true);
  delay(5000);
  
  // Configure bearer
  sendCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", 5000, true);
  
  String apnCmd = "AT+SAPBR=3,1,\"APN\",\"";
  apnCmd += APN;
  apnCmd += "\"";
  sendCommand(apnCmd, 5000, true);
  
  // Open bearer
  Serial.println(F("[OPENING BEARER - WAITING 45 SECONDS FOR IP]"));
  sendCommand("AT+SAPBR=1,1", 30000, true);
  delay(45000);  // Critical: Wait for IP assignment
  
  return isBearerActive();
}

// =====================================================
// INIT SIM800
// =====================================================

bool initializeSIM800() {
  sim800.listen();
  delay(1000);
  
  Serial.println(F("[INIT] Initializing SIM800..."));
  
  for (int i = 0; i < 3; i++) {
    Serial.print(F("[AT TEST "));
    Serial.print(i + 1);
    Serial.println(F("]"));
    
    sim800.println("AT");
    String resp = readResponse(3000);
    
    if (resp.indexOf("OK") >= 0) {
      Serial.println(F("[SIM800 READY]"));
      
      // Disable echo
      sendCommand("ATE0", 3000, true);
      
      // Check SIM
      sendCommand("AT+CPIN?", 3000, true);
      
      // Check network registration
      sendCommand("AT+CREG?", 3000, true);
      
      // Check signal quality
      sendCommand("AT+CSQ", 3000, true);
      
      // Close any existing bearer
      sendCommand("AT+SAPBR=0,1", 5000, true);
      delay(2000);
      
      // Attach to GPRS
      String cgattResp = sendCommand("AT+CGATT=1", 10000, true);
      delay(5000);
      
      if (cgattResp.indexOf("ERROR") >= 0) {
        Serial.println(F("[WARNING] CGATT failed, but continuing..."));
      }
      
      // Configure bearer
      sendCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", 5000, true);
      
      String apnCmd = "AT+SAPBR=3,1,\"APN\",\"";
      apnCmd += APN;
      apnCmd += "\"";
      sendCommand(apnCmd, 5000, true);
      
      // Open bearer
      Serial.println(F("[OPENING BEARER - WAITING 45 SECONDS FOR IP]"));
      String bearerResp = sendCommand("AT+SAPBR=1,1", 30000, true);
      delay(45000);  // Critical: Wait for IP assignment
      
      // Verify bearer is active
      if (isBearerActive()) {
        Serial.println(F("[GPRS CONNECTED]"));
        return true;
      } else {
        Serial.println(F("[BEARER FAILED] - No IP address assigned"));
        Serial.println(F("[TIP] Check APN configuration and SIM data plan"));
        Serial.print(F("[CURRENT APN] "));
        Serial.println(APN);
        return false;
      }
    }
  }
  
  Serial.println(F("[SIM800 FAILED] - No response to AT commands"));
  return false;
}

// =====================================================
// URL ENCODE STRING (for JSON in HTTP)
// =====================================================

String urlEncode(String str) {
  String encoded = "";
  char c;
  char code0;
  char code1;
  for (int i = 0; i < str.length(); i++) {
    c = str.charAt(i);
    if (c == ' ') {
      encoded += "+";
    } else if (isalnum(c)) {
      encoded += c;
    } else {
      code1 = (c & 0xF) + '0';
      if ((c & 0xF) > 9) {
        code1 = (c & 0xF) - 10 + 'A';
      }
      c = (c >> 4) & 0xF;
      code0 = c + '0';
      if (c > 9) {
        code0 = c - 10 + 'A';
      }
      encoded += '%';
      encoded += code0;
      encoded += code1;
    }
  }
  return encoded;
}

// =====================================================
// SEND LOCATION TO SERVER (ngrok optimized)
// =====================================================

bool sendLocation(float lat, float lng, float speed, float altitude, int satellites) {
  sim800.listen();
  delay(1000);
  
  // Check if GPRS is still connected
  if (!isBearerActive()) {
    Serial.println(F("[GPRS LOST] Attempting to reconnect..."));
    if (!reconnectGPRS()) {
      Serial.println(F("[GPRS RECONNECT FAILED]"));
      return false;
    }
  }
  
  Serial.println();
  Serial.println(F("================================="));
  Serial.println(F("[SENDING LOCATION]"));
  Serial.println(F("================================="));
  
  // Build JSON payload
  String payload = "{";
  payload += "\"vehicleId\":\"";
  payload += VEHICLE_ID;
  payload += "\",";
  payload += "\"lat\":";
  payload += String(lat, 6);
  payload += ",";
  payload += "\"lng\":";
  payload += String(lng, 6);
  payload += ",";
  payload += "\"speed\":";
  payload += String(speed, 1);
  payload += ",";
  payload += "\"altitude\":";
  payload += String(altitude, 1);
  payload += ",";
  payload += "\"satellites\":";
  payload += String(satellites);
  payload += "}";
  
  Serial.println(F("[PAYLOAD]"));
  Serial.println(payload);
  
  // Terminate any existing HTTP session (ignore errors)
  sim800.println("AT+HTTPTERM");
  readResponse(3000);
  delay(2000);
  
  // Initialize HTTP
  String response = sendCommand("AT+HTTPINIT", 5000, true);
  if (response.indexOf("OK") < 0) {
    Serial.println(F("[HTTPINIT FAILED]"));
    return false;
  }
  delay(1000);
  
  // Set bearer ID
  sendCommand("AT+HTTPPARA=\"CID\",1", 5000, true);
  delay(500);
  
  // Disable SSL (ngrok uses HTTP unless you pay for HTTPS)
  sendCommand("AT+HTTPSSL=0", 5000, true);
  delay(500);
  
  // Build URL - ngrok handles the port forwarding automatically
  // Just use the ngrok URL without specifying port
  String url = "http://";
  url += SERVER_HOST;
  url += SERVER_PATH;
  
  Serial.print(F("[URL] "));
  Serial.println(url);
  
  String urlCmd = "AT+HTTPPARA=\"URL\",\"";
  urlCmd += url;
  urlCmd += "\"";
  sendCommand(urlCmd, 10000, true);
  delay(1000);
  
  // Set content type
  sendCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 5000, true);
  delay(500);
  
  // CRITICAL for ngrok free tier: Skip the browser warning page
  // This header tells ngrok to forward directly to your backend
  sendCommand("AT+HTTPPARA=\"USERDATA\",\"ngrok-skip-browser-warning: 1\\r\\n\"", 5000, true);
  delay(1000);
  
  // Optional: Add custom User-Agent
  sendCommand("AT+HTTPPARA=\"USERDATA\",\"User-Agent: SIM800C-Tracker\\r\\n\"", 5000, true);
  delay(500);
  
  // Send data
  String dataCmd = "AT+HTTPDATA=";
  dataCmd += String(payload.length());
  dataCmd += ",30000";
  
  Serial.println(F("[SENDING DATA]"));
  sim800.println(dataCmd);
  String dataResp = readResponse(10000);
  
  if (dataResp.indexOf("DOWNLOAD") >= 0) {
    Serial.println(F("[UPLOADING PAYLOAD]"));
    sim800.print(payload);
    delay(5000);
    String uploadResp = readResponse(10000);
    if (uploadResp.indexOf("OK") < 0) {
      Serial.println(F("[UPLOAD FAILED]"));
      sendCommand("AT+HTTPTERM", 5000, true);
      return false;
    }
  } else {
    Serial.println(F("[HTTPDATA FAILED]"));
    Serial.println(dataResp);
    sendCommand("AT+HTTPTERM", 5000, true);
    return false;
  }
  
  delay(2000);
  
  // Execute POST request
  Serial.println(F("[EXECUTING HTTP POST]"));
  sim800.println("AT+HTTPACTION=1");
  String actionResp = readResponse(60000);  // 60 second timeout for ngrok
  
  Serial.println(F("[HTTP RESPONSE]"));
  Serial.println(actionResp);
  
  bool success = false;
  
  // Check for successful HTTP 200
  if (actionResp.indexOf(",200,") >= 0) {
    Serial.println(F("[✓ SUCCESS] Location sent to server via ngrok"));
    success = true;
    
    // Read response body
    String readResp = sendCommand("AT+HTTPREAD", 10000, true);
    if (readResp.indexOf("OK") >= 0) {
      Serial.println(F("[SERVER RESPONSE] Received"));
    }
  } 
  // Handle specific error codes
  else if (actionResp.indexOf(",606,") >= 0) {
    Serial.println(F("[✗ ERROR 606] GPRS service not active - Reconnecting..."));
    gprsConnected = false;
  } 
  else if (actionResp.indexOf(",601,") >= 0) {
    Serial.println(F("[✗ ERROR 601] Network error - Check connection/signal"));
  } 
  else if (actionResp.indexOf(",602,") >= 0) {
    Serial.println(F("[✗ ERROR 602] DNS error - Check ngrok hostname"));
    Serial.println(F("[TIP] Make sure ngrok is running: ngrok http 3000"));
  } 
  else if (actionResp.indexOf(",603,") >= 0) {
    Serial.println(F("[✗ ERROR 603] Server timeout - ngrok may be slow"));
  }
  else if (actionResp.indexOf(",604,") >= 0) {
    Serial.println(F("[✗ ERROR 604] Server disconnected"));
  }
  else {
    Serial.println(F("[✗ HTTP FAILED] Unknown error"));
    Serial.println(F("[TIP] Check if ngrok is running: https://dashboard.ngrok.com/tunnels"));
  }
  
  // Terminate HTTP session
  sendCommand("AT+HTTPTERM", 5000, true);
  
  return success;
}

// =====================================================
// SETUP
// =====================================================

void setup() {
  Serial.begin(9600);
  sim800.begin(9600);
  gpsSerial.begin(9600);
  
  delay(5000);
  
  Serial.println();
  Serial.println(F("================================="));
  Serial.println(F("GPS + SIM800 TRACKER (ngrok)"));
  Serial.println(F("================================="));
  
  // Initialize SIM800 and GPRS
  gprsConnected = initializeSIM800();
  
  if (gprsConnected) {
    Serial.println(F("[SYSTEM READY] Waiting for GPS fix..."));
    Serial.println(F("[NGROK URL] "));
    Serial.print(F("http://"));
    Serial.println(SERVER_HOST);
  } else {
    Serial.println(F("[SIM800 FAILED]"));
    Serial.println(F("[TROUBLESHOOTING]"));
    Serial.println(F("1. Check SIM card and data plan"));
    Serial.println(F("2. Verify APN: "));
    Serial.println(APN);
    Serial.println(F("3. Check signal strength (CSQ should be > 10)"));
    Serial.println(F("4. Ensure SIM800 has external antenna"));
  }
}

// =====================================================
// LOOP
// =====================================================

void loop() {
  // Read GPS data
  gpsSerial.listen();
  
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
  
  // Send location at intervals
  if (gps.location.isValid() && millis() - lastSendTime >= SEND_INTERVAL) {
    
    // Reconnect GPRS if needed
    if (!gprsConnected) {
      Serial.println(F("[GPRS NOT CONNECTED] Attempting to reconnect..."));
      gprsConnected = reconnectGPRS();
      
      if (!gprsConnected) {
        Serial.println(F("[SKIP] Cannot send location - GPRS offline"));
        lastSendTime = millis();
        return;
      }
    }
    
    float lat = gps.location.lat();
    float lng = gps.location.lng();
    float speed = gps.speed.isValid() ? gps.speed.kmph() : 0.0;
    float altitude = gps.altitude.isValid() ? gps.altitude.meters() : 0.0;
    int satellites = gps.satellites.isValid() ? gps.satellites.value() : 0;
    
    Serial.println();
    Serial.println(F("================================="));
    Serial.println(F("[GPS FIX ACQUIRED]"));
    Serial.println(F("================================="));
    Serial.print(F("LAT: "));
    Serial.println(lat, 6);
    Serial.print(F("LNG: "));
    Serial.println(lng, 6);
    Serial.print(F("SPEED: "));
    Serial.print(speed, 1);
    Serial.println(F(" km/h"));
    Serial.print(F("ALTITUDE: "));
    Serial.print(altitude, 1);
    Serial.println(F(" m"));
    Serial.print(F("SATELLITES: "));
    Serial.println(satellites);
    
    // Send location
    bool success = sendLocation(lat, lng, speed, altitude, satellites);
    
    if (success) {
      Serial.println(F("[✓ LOCATION SENT SUCCESSFULLY]"));
    } else {
      Serial.println(F("[✗ LOCATION FAILED]"));
      gprsConnected = false;  // Force reconnect next time
    }
    
    lastSendTime = millis();
  } 
  else if (!gps.location.isValid()) {
    // Print status every 5 seconds if no GPS fix
    static unsigned long lastGpsStatus = 0;
    if (millis() - lastGpsStatus > 5000) {
      Serial.print(F("[WAITING FOR GPS FIX] Satellites: "));
      Serial.println(gps.satellites.value());
      Serial.println(F("[TIP] Ensure GPS module has clear sky view"));
      lastGpsStatus = millis();
    }
  }
}
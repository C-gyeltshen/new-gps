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
const char APN[] = "ticlnet";
const char SERVER_HOST[] = "new-gps-1.onrender.com";
const char SERVER_PATH[] = "/api/vehicle/location";
const char VEHICLE_ID[] = "VEHICLE_003";

const unsigned long SEND_INTERVAL = 10000UL;
const int MIN_SATELLITES = 4;   // require at least 4 sats for reliable fix

// =====================================================
unsigned long lastSendAttempt = 0;
bool gprsReady = false;

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
  Serial.println();
  Serial.println(F("[---]"));
  return response;
}

// =====================================================
// SEND COMMAND
// =====================================================
String sendCommand(String cmd, unsigned long timeout = 5000) {
  sim800.listen();
  delay(200);
  Serial.print(F("[CMD] "));
  Serial.println(cmd);
  sim800.println(cmd);
  return readResponse(timeout);
}

// =====================================================
// INIT SIM800 + GPRS
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
      sendCommand("ATE0", 3000);
      sendCommand("AT+CPIN?", 3000);
      sendCommand("AT+CREG?", 3000);
      sendCommand("AT+CSQ", 3000);

      sendCommand("AT+SAPBR=0,1", 5000);
      delay(2000);
      sendCommand("AT+CGATT=1", 10000);
      delay(5000);

      sendCommand("AT+SAPBR=3,1,\"CONTYPE\",\"GPRS\"", 5000);

      String apnCmd = "AT+SAPBR=3,1,\"APN\",\"";
      apnCmd += APN;
      apnCmd += "\"";
      sendCommand(apnCmd, 5000);

      sendCommand("AT+SAPBR=1,1", 30000);
      delay(10000);

      String bearer = sendCommand("AT+SAPBR=2,1", 10000);
      if (bearer.indexOf("+SAPBR: 1,1") >= 0) {
        Serial.println(F("[GPRS CONNECTED]"));
        return true;
      }
    }
  }
  return false;
}

// =====================================================
// SEND LOCATION (HTTPS POST with JSON body)
// =====================================================
bool sendLocation(float lat,
                  float lng,
                  float speed,
                  float altitude,
                  int satellites) {
  sim800.listen();
  delay(500);

  Serial.println();
  Serial.println(F("================================="));
  Serial.println(F("[SENDING LOCATION]"));
  Serial.println(F("================================="));

  String payload = "{";
  payload += "\"vehicleId\":\"";   payload += VEHICLE_ID;           payload += "\",";
  payload += "\"lat\":";           payload += String(lat, 6);       payload += ",";
  payload += "\"lng\":";           payload += String(lng, 6);       payload += ",";
  payload += "\"speed\":";         payload += String(speed, 1);     payload += ",";
  payload += "\"altitude\":";      payload += String(altitude, 1);  payload += ",";
  payload += "\"satellites\":";    payload += String(satellites);
  payload += "}";

  Serial.print(F("[PAYLOAD] "));  
  Serial.println(payload);
  Serial.print(F("[PAYLOAD LEN] "));
  Serial.println(payload.length());

  sendCommand("AT+HTTPTERM", 3000);
  delay(1000);

  sendCommand("AT+HTTPINIT", 5000);
  delay(1000);

  sendCommand("AT+HTTPPARA=\"CID\",1", 3000);
  delay(500);

  // Enable SSL — required for Render
  String sslResp = sendCommand("AT+HTTPSSL=1", 3000);
  if (sslResp.indexOf("OK") < 0) {
    Serial.println(F("[WARN] HTTPSSL=1 not supported by firmware"));
  }
  delay(500);

  String url = "https://";
  url += SERVER_HOST;
  url += SERVER_PATH;

  String urlCmd = "AT+HTTPPARA=\"URL\",\"";
  urlCmd += url;
  urlCmd += "\"";
  sendCommand(urlCmd, 5000);
  delay(500);

  sendCommand("AT+HTTPPARA=\"CONTENT\",\"application/json\"", 3000);
  delay(500);

  String dataCmd = "AT+HTTPDATA=";
  dataCmd += String(payload.length());
  dataCmd += ",30000";
  sim800.println(dataCmd);
  String dataResp = readResponse(8000);

  if (dataResp.indexOf("DOWNLOAD") < 0) {
    Serial.println(F("[HTTPDATA FAILED]"));
    sendCommand("AT+HTTPTERM", 3000);
    return false;
  }

  sim800.print(payload);
  delay(3000);
  readResponse(5000);

  sim800.println("AT+HTTPACTION=1");
  String actionResp = readResponse(60000);

  Serial.println(F("[HTTP RESPONSE]"));
  Serial.println(actionResp);

  bool success = false;
  if (actionResp.indexOf(",200,") >= 0 ||
      actionResp.indexOf(",201,") >= 0) {
    Serial.println(F("[SUCCESS] LOCATION SENT"));
    sendCommand("AT+HTTPREAD", 10000);
    success = true;
  } else {
    Serial.println(F("[HTTP FAILED]"));
    int idx = actionResp.indexOf("+HTTPACTION:");
    if (idx >= 0) {
      Serial.print(F("[CODE] "));
      Serial.println(actionResp.substring(idx, idx + 30));
    }
  }

  sendCommand("AT+HTTPTERM", 3000);
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
  Serial.println(F("GPS + SIM800 TRACKER"));
  Serial.print(F("Target: https://"));
  Serial.print(SERVER_HOST);
  Serial.println(SERVER_PATH);
  Serial.println(F("================================="));

  gprsReady = initializeSIM800();
  if (gprsReady) {
    Serial.println(F("[SYSTEM READY]"));
  } else {
    Serial.println(F("[SIM800 FAILED - will retry]"));
  }
}

// =====================================================
// LOOP
// =====================================================
void loop() {
  gpsSerial.listen();
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  if (!gprsReady) {
    if (millis() - lastSendAttempt > SEND_INTERVAL) {
      lastSendAttempt = millis();
      Serial.println(F("[RETRY] Re-initializing SIM800..."));
      gprsReady = initializeSIM800();
    }
    return;
  }

  if (millis() - lastSendAttempt >= SEND_INTERVAL) {
    int sats = gps.satellites.value();

    if (!gps.location.isValid() || sats < MIN_SATELLITES) {
      lastSendAttempt = millis();
      Serial.print(F("[WAITING] valid="));
      Serial.print(gps.location.isValid() ? "yes" : "no");
      Serial.print(F(" sats="));
      Serial.println(sats);
      return;
    }

    lastSendAttempt = millis();

    float lat = gps.location.lat();
    float lng = gps.location.lng();
    float speed = gps.speed.kmph();
    float altitude = gps.altitude.meters();

    Serial.println();
    Serial.println(F("[GPS FIX]"));
    Serial.print(F("LAT: "));  Serial.println(lat, 6);
    Serial.print(F("LNG: "));  Serial.println(lng, 6);
    Serial.print(F("SATS: ")); Serial.println(sats);

    bool ok = sendLocation(lat, lng, speed, altitude, sats);
    if (!ok) {
      Serial.println(F("[WARN] Send failed, will reinit GPRS"));
      gprsReady = false;
    }
  }
}

#include <TinyGPS++.h>
#include <SoftwareSerial.h>

// =====================================================
// PIN DEFINITIONS
// =====================================================

#define SIM800_TX 9
#define SIM800_RX 8
#define GPS_TX    11
#define GPS_RX    10

SoftwareSerial sim800(SIM800_TX, SIM800_RX);
SoftwareSerial gpsSerial(GPS_TX, GPS_RX);
TinyGPSPlus gps;

// =====================================================
// CONFIGURATION
// =====================================================

const char APN[]         = "ticlnet";
const char SERVER_HOST[] = "260c-103-133-216-195.ngrok-free.app";
const char SERVER_PATH[] = "/api/vehicle/location";
const char VEHICLE_ID[]  = "VEHICLE_003";

const unsigned long SEND_INTERVAL = 10000UL;  // ms between sends

// =====================================================
// TEST MODE — flip to false when GPS is available
// =====================================================

#define TEST_MODE false

const float TEST_LAT        = 27.471200;
const float TEST_LNG        = 89.639900;
const float TEST_SPEED      = 35.5;
const float TEST_ALTITUDE   = 2334.0;
const int   TEST_SATELLITES = 9;

// =====================================================

unsigned long lastSendTime = 0;
bool networkReady = false;

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

  if (response.length() > 0) Serial.println();
  Serial.println(F("[---]"));
  return response;
}

// Exit as soon as token is seen — critical for time-sensitive AT commands
// (e.g. CIPSTART / CIPSEND where we must act immediately after the prompt)
String waitForToken(const char* token, unsigned long timeout) {
  String response = "";
  unsigned long start = millis();

  while (millis() - start < timeout) {
    while (sim800.available()) {
      char c = sim800.read();
      response += c;
      Serial.write(c);
    }
    if (response.indexOf(token) >= 0) {
      delay(50);  // drain any trailing bytes
      while (sim800.available()) {
        char c = sim800.read();
        response += c;
        Serial.write(c);
      }
      break;
    }
  }

  if (response.length() > 0) Serial.println();
  Serial.println(F("[---]"));
  return response;
}

// =====================================================
// SEND AT COMMAND
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
// INIT NETWORK  (CSTT / CIICR / CIFSR)
// Uses the CIP TCP stack — no SAPBR / AT+HTTP needed
// =====================================================

bool initNetwork() {
  Serial.println(F("[NET] Setting up GPRS..."));

  // Close any existing TCP context
  sendCommand("AT+CIPSHUT", 5000);
  delay(2000);

  // Attach to GPRS
  sendCommand("AT+CGATT=1", 10000);
  delay(3000);

  // Set APN
  String cstt = "AT+CSTT=\"";
  cstt += APN;
  cstt += "\"";
  String r = sendCommand(cstt, 5000);
  if (r.indexOf("OK") < 0) {
    Serial.println(F("[CSTT FAILED]"));
    return false;
  }

  // Bring up wireless connection
  Serial.println(F("[NET] Bringing up connection (wait ~30s)..."));
  sendCommand("AT+CIICR", 30000);
  delay(5000);

  // Get local IP — confirms GPRS is up
  String ip = sendCommand("AT+CIFSR", 5000);
  ip.trim();
  if (ip.indexOf("ERROR") >= 0 || ip.length() < 7) {
    Serial.println(F("[NO IP] GPRS failed"));
    return false;
  }
  Serial.print(F("[IP ASSIGNED] "));
  Serial.println(ip);
  return true;
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
      sendCommand("ATE0",     3000);
      sendCommand("AT+CPIN?", 3000);
      sendCommand("AT+CREG?", 3000);
      sendCommand("AT+CSQ",   3000);
      return initNetwork();
    }
  }

  Serial.println(F("[SIM800 FAILED]"));
  return false;
}

// =====================================================
// SEND LOCATION — raw TCP POST, body in JSON
// AT+HTTPDATA is broken on old firmware so we build
// the HTTP request manually over a plain TCP socket.
// =====================================================

bool sendLocation(float lat, float lng, float speed,
                  float altitude, int satellites) {
  sim800.listen();
  delay(500);

  // --- Build JSON body ---
  String body = "{";
  body += "\"vehicleId\":\""; body += VEHICLE_ID; body += "\",";
  body += "\"lat\":";         body += String(lat, 6);     body += ",";
  body += "\"lng\":";         body += String(lng, 6);     body += ",";
  body += "\"speed\":";       body += String(speed, 1);   body += ",";
  body += "\"altitude\":";    body += String(altitude, 1);body += ",";
  body += "\"satellites\":";  body += String(satellites);
  body += "}";

  Serial.println(F("[PAYLOAD]"));
  Serial.println(body);

  // --- Build HTTP headers (send in pieces to save RAM) ---
  // We need total byte count for AT+CIPSEND upfront.
  // Header template lengths are fixed; only body length varies.
  //
  //  "POST <PATH> HTTP/1.0\r\n"              = varies
  //  "Host: <HOST>\r\n"                      = varies
  //  "Content-Type: application/json\r\n"    = 32
  //  "Content-Length: <N>\r\n"               = varies
  //  "ngrok-skip-browser-warning: 1\r\n"     = 31
  //  "Connection: close\r\n"                 = 19
  //  "\r\n"                                  = 2
  //  <body>

  String line1    = "POST ";  line1 += SERVER_PATH; line1 += " HTTP/1.0\r\n";
  String lineHost = "Host: "; lineHost += SERVER_HOST; lineHost += "\r\n";
  String lineCL   = "Content-Length: "; lineCL += String(body.length()); lineCL += "\r\n";

  int totalLen = line1.length()
               + lineHost.length()
               + 32  // Content-Type: application/json\r\n
               + lineCL.length()
               + 31  // ngrok-skip-browser-warning: 1\r\n
               + 19  // Connection: close\r\n
               + 2   // \r\n  (blank line)
               + body.length();

  Serial.print(F("[TOTAL BYTES] "));
  Serial.println(totalLen);

  // --- Open TCP connection ---
  Serial.println(F("[TCP] Connecting..."));
  sendCommand("AT+CIPCLOSE", 2000);  // close stale connection
  delay(500);

  String cipStart = "AT+CIPSTART=\"TCP\",\"";
  cipStart += SERVER_HOST;
  cipStart += "\",80";

  sim800.listen();
  delay(200);
  Serial.print(F("[CMD] ")); Serial.println(cipStart);
  sim800.println(cipStart);
  String connResp = waitForToken("CONNECT OK", 30000);
  if (connResp.indexOf("CONNECT OK") < 0 && connResp.indexOf("ALREADY CONNECT") < 0) {
    Serial.println(F("[CONNECT FAILED]"));
    return false;
  }
  delay(200);

  // --- AT+CIPSEND=N → wait for ">" prompt ---
  String cipsend = "AT+CIPSEND=";
  cipsend += String(totalLen);

  sim800.listen();
  delay(200);
  Serial.print(F("[CMD] ")); Serial.println(cipsend);
  sim800.println(cipsend);

  String promptResp = waitForToken(">", 8000);
  if (promptResp.indexOf(">") < 0) {
    Serial.println(F("[CIPSEND PROMPT FAILED]"));
    sendCommand("AT+CIPCLOSE", 3000);
    return false;
  }

  // --- Send raw HTTP request in pieces (saves RAM vs one big String) ---
  Serial.println(F("[SENDING HTTP REQUEST]"));

  sim800.print(line1);
  sim800.print(lineHost);
  sim800.print(F("Content-Type: application/json\r\n"));
  sim800.print(lineCL);
  sim800.print(F("ngrok-skip-browser-warning: 1\r\n"));
  sim800.print(F("Connection: close\r\n"));
  sim800.print(F("\r\n"));
  sim800.print(body);

  // Free intermediate Strings to recover SRAM before accumulating the response
  line1 = ""; lineHost = ""; lineCL = "";
  cipsend = ""; cipStart = ""; connResp = ""; promptResp = "";

  // Wait until the server closes the connection (Connection: close header).
  // Exits immediately when "CLOSED" arrives instead of blocking 30 s flat.
  String result = waitForToken("CLOSED", 30000);

  Serial.println(F("[SERVER RESPONSE]"));
  Serial.println(result);

  sendCommand("AT+CIPCLOSE", 2000);  // no-op if already closed by server

  if (result.indexOf("200") >= 0 || result.indexOf("\"ok\":true") >= 0) {
    Serial.println(F("[SUCCESS] Location saved to database!"));
    return true;
  }

  if (result.indexOf("307") >= 0 || result.indexOf("301") >= 0) {
    Serial.println(F("[REDIRECT] Restart ngrok with: ngrok http --scheme http 3001"));
  } else if (result.indexOf("SEND FAIL") >= 0) {
    Serial.println(F("[TCP SEND FAILED] Connection dropped"));
  } else {
    Serial.println(F("[FAILED] No 200 in response"));
  }

  return false;
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
  Serial.println(F(" GPS + SIM800 TRACKER"));
  Serial.println(F("================================="));

#if TEST_MODE
  Serial.println(F("[MODE] TEST (dummy coords)"));
#else
  Serial.println(F("[MODE] LIVE GPS"));
#endif

  networkReady = initializeSIM800();

  if (networkReady) {
    Serial.println(F("[SYSTEM READY]"));
  } else {
    Serial.println(F("[INIT FAILED] Check SIM / APN / signal"));
  }
}

// =====================================================
// LOOP
// =====================================================

void loop() {

#if TEST_MODE

  if (millis() - lastSendTime >= SEND_INTERVAL) {
    Serial.println();
    Serial.println(F("[TEST MODE — DUMMY DATA]"));

    if (!networkReady) {
      Serial.println(F("[RECONNECTING...]"));
      networkReady = initNetwork();
    }

    if (networkReady) {
      bool ok = sendLocation(TEST_LAT, TEST_LNG, TEST_SPEED,
                             TEST_ALTITUDE, TEST_SATELLITES);
      if (!ok) networkReady = false;
    }

    lastSendTime = millis();
  }

#else

  gpsSerial.listen();
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }

  if (gps.location.isValid() && millis() - lastSendTime >= SEND_INTERVAL) {

    if (!networkReady) {
      networkReady = initNetwork();
      if (!networkReady) { lastSendTime = millis(); return; }
    }

    float lat      = gps.location.lat();
    float lng      = gps.location.lng();
    float speed    = gps.speed.isValid()      ? gps.speed.kmph()      : 0.0;
    float altitude = gps.altitude.isValid()   ? gps.altitude.meters() : 0.0;
    int   sats     = gps.satellites.isValid() ? gps.satellites.value(): 0;

    Serial.println();
    Serial.println(F("[GPS FIX ACQUIRED]"));
    Serial.print(F("LAT: ")); Serial.println(lat, 6);
    Serial.print(F("LNG: ")); Serial.println(lng, 6);

    bool ok = sendLocation(lat, lng, speed, altitude, sats);
    if (!ok) networkReady = false;
    lastSendTime = millis();

  } else if (!gps.location.isValid()) {
    static unsigned long lastStatus = 0;
    if (millis() - lastStatus > 5000) {
      Serial.print(F("[WAITING GPS] Sats: "));
      Serial.println(gps.satellites.value());
      lastStatus = millis();
    }
  }

#endif

}

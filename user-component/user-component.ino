#include <Arduino_LSM6DS3.h>
#include <ArduinoBLE.h>
#include <WiFiNINA_Generic.h>

const int BUFSIZE = 1000;
const int FREQUENCY = 200;

float ax, ay, az;
float av[BUFSIZE];
int t[BUFSIZE];
int ind;

// Network info
char ssid[] = "ARDUINO_NET";
char pass[] = "ARDUINO_PASS";

// Wifi locals
int status = WL_IDLE_STATUS;
WiFiServer server(80);

void setup() {
  Serial.begin(9600);
  while (!Serial);

  // Create Arduino Access point
  while (status != WL_AP_LISTENING) {
    Serial.print("Attempting to create network: ");
    Serial.println(ssid);
    status = WiFi.beginAP(ssid, pass);
    delay(10000);
  }

  // Print network info after connecting
  Serial.println("Connected to the network");
  Serial.println("---------------------------------------");
  IPAddress ip = WiFi.localIP();
  Serial.print("IP Address: ");
  Serial.println(ip);

  server.begin();
  IMU.begin();
}

void loop() {

  WiFiClient client = server.available();
  if (client) {                             // if you get a client,
    Serial.println("New client");           // print a message out the serial port
    while (client.connected()) {            // loop while the client's connected
      if (client.available()) {             // if there's bytes to read from the client,
        client.println("HTTP/1.1 200 OK");
        client.println("Content-type:application/json");
        client.println();
        client.println("{");
        client.print("\"t\":[");
        for (int i = 0; i < ind - 1; i++) {
          client.print(t[i]);
          client.print(",");
        }
        client.print(t[ind-1]);
        client.println("],");
        client.print("\"av\":[");
        for (int i = 0; i < ind - 1; i++) {
          client.print(av[i]);
          client.print(",");
        }
        client.print(av[ind-1]);
        client.println("]");
        client.println("}");
        client.println();
        ind = 0;
        break;
      } 
    }
    // close the connection:
    delay(50);
    client.stop();
  }

  if (IMU.accelerationAvailable()) {
    IMU.readAcceleration(ax, ay, az);
    t[ind] = millis();
    av[ind] = sqrt(ax*ax+ay*ay+az*az);
    ind = (ind + 1) % BUFSIZE;
  }

  delay(1500 / FREQUENCY);
}

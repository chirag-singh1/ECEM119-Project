#include <Arduino_LSM6DS3.h>
#include <WiFiNINA_Generic.h>

float ax, ay, az;
int t;

void setup() {
  Serial.begin(9600);
  while (!Serial);

  IMU.begin();
}

void loop() {
  if (IMU.accelerationAvailable()) {
    IMU.readAcceleration(ax, ay, az);
    t = millis();
  }

  Serial.print(ax);
  Serial.print(",");
  Serial.print(ay);
  Serial.print(",");
  Serial.print(az);
  Serial.print(",");
  Serial.println(t);
}

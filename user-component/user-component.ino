#include <Arduino_LSM6DS3.h>
#include <ArduinoBLE.h>

float ax, ay, az;
int t;

// Bluetooth variables
BLEService calibrationServiceService("180B"); // BLE authentication Service
BLEByteCharacteristic switchCharacteristic("2A58", BLERead | BLEWrite); // BLE authentication characteristic

void setup() {
  Serial.begin(9600);
  while (!Serial);

  IMU.begin();

  // Initialize BLE
  if (!BLE.begin()) {
    Serial.println("BLE Init Failed");
    while (1);
  }
  BLE.setLocalName("KnowTouch - User Component");
  BLE.setAdvertisedService(calibrationServiceService);
  calibrationServiceService.addCharacteristic(switchCharacteristic);
  BLE.addService(calibrationServiceService);
  switchCharacteristic.writeValue(1);
  BLE.advertise();
  Serial.println("BLE Init complete");
}

void loop() {
  // Listen for user component
  BLEDevice central = BLE.central();

  // User component connected, perform basic logic
  while (central && central.connected()) {

  }

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

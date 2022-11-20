#include <Servo.h>
#include <ArduinoBLE.h>

// Pins for ultrasonic sensor and servomotor
const int ECHO_PIN = 4;
const int TRIG_PIN = 2;
const int SERVO_PIN = 3;

// Constants for servo/sensor
const int SERVO_LOCKED = 90;
const int SERVO_UNLOCKED = 0;
const int threshold = 15;

// Local variables
Servo servo;
int dist;
long time;

// Bluetooth variables
BLEService authenticationService("180A"); // BLE authentication Service
BLEByteCharacteristic switchCharacteristic("2A57", BLERead | BLEWrite); // BLE authentication characteristic

// State variables
bool authenticated;
bool open;

void setup() {

  // Initialize GPIO pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  servo.attach(3);

  Serial.begin(9600);

  // Initialize BLE
  if (!BLE.begin()) {
    Serial.println("BLE Init Failed");
    while (1);
  }
  BLE.setLocalName("KnowTouch - Door Component");
  BLE.setAdvertisedService(authenticationService);
  authenticationService.addCharacteristic(switchCharacteristic);
  BLE.addService(authenticationService);
  switchCharacteristic.writeValue(0);
  BLE.advertise();
  Serial.println("BLE Init complete");

  authenticated = false;
  closeLock();
}


// Read most recent ultrasonic sensor data
void readDist() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  time = pulseIn(ECHO_PIN, HIGH);
  dist = time * 0.017;

}

void openLock() {
  if (!authenticated) {
    Serial.println("Not opening lock, no authentication");
    return;
  }

  Serial.println("Opening lock");

  servo.write(SERVO_UNLOCKED);
  open = true;
  delay(5000);
}

void closeLock() {
  Serial.println("Closing lock");

  servo.write(SERVO_LOCKED);
  open = false;
  delay(5000);
}

void loop() {

  // Listen for user component
  BLEDevice central = BLE.central();

  // User component connected, perform basic logic
  while (central && central.connected()) {

    // Update authentication data based on BLE info
    if (switchCharacteristic.written()) {
      if (switchCharacteristic.value() == 1) {
        authenticated = true;
      }
      else {
        authenticated = false;
      }
    }

    readDist(); // Update dist with most recent value of ultrasonic data

    // Update (or at least attempt) to update lock status
    // Based on most recent changes
    if ((dist == 0 || dist > threshold) && open) {
      closeLock();
    }
    else if (dist <= threshold && dist != 0 && !open) {
      openLock();
    }
  }

}

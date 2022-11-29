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

// Constants for Bluetooth
const int VALID_TIME = 15000;

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
bool pendingAuthentication;
bool lastWrittenAuthentication;
int activeBluetoothOverride;
int lastAuthenticationReceived;

void setup() {

  // Initialize GPIO pins
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  servo.attach(3);

  Serial.begin(9600);
  while(!Serial);

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
  Serial.flush();

  authenticated = false;
  pendingAuthentication = false;
  lastWrittenAuthentication = false;
  activeBluetoothOverride = -1;
  lastAuthenticationReceived = -15000;
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
    Serial.flush();
    return;    int ret = switchCharacteristic.writeValue(authenticated);
    Serial.println(ret);

    if (switchCharacteristic.canWrite()) {
      int ret = switchCharacteristic.writeValue(authenticated);
    }
  }

  Serial.println("Opening lock");
  Serial.flush();

  servo.write(SERVO_UNLOCKED);
  open = true;
  delay(5000);
}

void closeLock() {
  Serial.println("Closing lock");
  Serial.flush();

  servo.write(SERVO_LOCKED);
  open = false;
  delay(5000);
}

void checkSerial() {
  if (Serial.available() > 0) {
    pendingAuthentication = (Serial.parseInt() == 1);
    if (pendingAuthentication) {
      lastAuthenticationReceived = millis();
    }
    Serial.readString();

    Serial.print("Read processed authentication: ");
    Serial.println(pendingAuthentication);
    Serial.flush();
  }
}

void loop() {

  // Listen for user component
  BLEDevice central = BLE.central();

  checkSerial();

  // User component connected, perform basic logic
  if (central && central.connected()) {
    // Update authentication data based on BLE info
    if (switchCharacteristic.written()) {
      if (((switchCharacteristic.value() == 1) == lastWrittenAuthentication) && (authenticated != lastWrittenAuthentication)) {
        // Bluetooth is consistent with last written value, but our authentication is not
        // This means the serial port has received new authentication that is not yet
        // reflected over bluetooth
        Serial.println("Inconsistent authentication, updating Bluetooth");
        Serial.flush();
        lastWrittenAuthentication = authenticated;
        switchCharacteristic.writeValue(authenticated);
      }
      else if (((switchCharacteristic.value() == 1) != lastWrittenAuthentication) && (authenticated == lastWrittenAuthentication)){
        // Bluetooth is inconsistent with last written value, but our authentication is
        // This means the Bluetooth value has some value written to it that we have not yet
        // handled, meaning that we have a Bluetooth override
        Serial.println("Inconsistent authentication, Bluetooth override received");
        Serial.flush();
        activeBluetoothOverride = millis();
        authenticated = switchCharacteristic.value();
        lastWrittenAuthentication = authenticated;
      }
    }
    else {
      switchCharacteristic.writeValue(authenticated);
      lastWrittenAuthentication = authenticated;
    }
  }

  if (activeBluetoothOverride == -1 || millis() - activeBluetoothOverride >= VALID_TIME) {
    if (authenticated && millis() - lastAuthenticationReceived > VALID_TIME) {
      Serial.println("Authentication expired");
      authenticated = false;
    }
    if (!authenticated && millis() - lastAuthenticationReceived <= VALID_TIME) {
      Serial.println("Authentication activated");
      authenticated = true;
    }
    activeBluetoothOverride = -1;
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

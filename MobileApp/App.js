import React, { Component } from 'react';
import {
  StyleSheet,
  Text,
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  Platform,
  View,
  Alert,
  Button,
  TextInput,
} from 'react-native';

import BleManager from 'react-native-ble-manager';
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

var RNFS = require('react-native-fs');
var path = RNFS.DocumentDirectoryPath + '/data.txt';

export default class App extends Component {

  constructor() {
    super();

    this.state = {
      doorConnected: false,
      readyToReadDoor: false,
      readDoor: "No data read yet",
      calibrated: false,
      authenticated: false,
      passwordSet: false,
    };

    this.writeValue = this.writeValue.bind(this);
    this.setPassword = this.setPassword.bind(this);
    this.updateDoorService = this.updateDoorService.bind(this);
    this.updateDoorCharacteristic = this.updateDoorCharacteristic.bind(this);
    this.updateStatePassword = this.updateStatePassword.bind(this);
    this.checkPassword = this.checkPassword.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
  }

  checkUpdate() {
    setTimeout(() => {
      if (this.state.readyToReadDoor) {
        BleManager.read(
          this.state.doorId,
          this.state.doorService,
          this.state.doorCharacteristic
        )
          .then((readData) => {
            this.setState({ readDoor: readData });
          })
          .catch((error) => {
            // Failure code
            console.log(error);
          });
      }

      this.checkUpdate();
    }, 250);
  }

  async getPermission() {
    if (Platform.OS === 'android' && Platform.Version >= 23) {
      let granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (!granted) {
        granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }
      let granted2 = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      if (!granted2) {
        granted2 = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
      }
      return granted && granted2;
    }
    return true;
  }

  searchForCharacteristic(arr, characteristic, service) {
    let retval = false;
    arr.forEach((elem) => {
      if (elem.service.toLowerCase() == service.toLowerCase()
        && elem.characteristic.toLowerCase() == characteristic.toLowerCase()) {
        retval = true;
      }
    });
    return retval;
  }

  async componentDidMount() {

    const permissions = await this.getPermission();
    if (!permissions) {
      console.log("NO PERMISSIONS");
    }
    else {
      console.log("Permission OK");
    }

    BleManager.start({ showAlert: false, forceLegacy: true })
      .then(() => {
        console.log('Module initialized');
      });

    BleManager.scan([], 8, true).then((results) => {
      console.log('Scanning...');
    });

    this.discoverHandler = bleManagerEmitter.addListener(
      'BleManagerDiscoverPeripheral',
      async (args) => {
        if ('localName' in args.advertising && args.advertising.localName == 'KnowTouch - Door Component') {
          if (!this.state.doorConnected) {
            BleManager.connect(args.id)
              .then(() => {
                console.log("Connected to door, checking characteristic");
                this.setState({
                  doorConnected: true,
                  doorId: args.id,
                  readyToReadDoor: true,
                });

                /*
                BleManager.retrieveServices(args.id).then(
                  (peripheralInfo) => {
                    if (this.searchForCharacteristic(peripheralInfo.characteristics, this.state.doorCharacteristic, this.state.doorService)) {
                      this.setState({ readyToReadDoor: true });
                      console.log("Door characteristic found");
                    }
                  }
                );*/
              })
              .catch((error) => {
                console.log(error);
              });
          }
        }
      }

    );

    this.disconnectHandler = bleManagerEmitter.addListener(
      'BleManagerDisconnectPeripheral',
      async () => {
        console.log("Disconnected, continuing to scan");
        this.setState({ doorConnected: false, readyToReadDoor: false });
        BleManager.scan([], 8, true).then((results) => {
          console.log('Scanning...');
        });
      }
    );

    this.scanStopHandler = bleManagerEmitter.addListener('BleManagerStopScan',
      () => {
        console.log('Scanning stopped');
        if (!this.state.doorConnected) {
          BleManager.scan([], 8).then((results) => {
            console.log('Scanning...');
          });
        }
      }
    );

    this.setState({doorConnected: false });

    this.checkUpdate();

    RNFS.readFile(path, 'utf8')
      .then((data) => {
        let dataArr = data.split('\n');
        this.setState({
          doorService: dataArr[0],
          doorCharacteristic: dataArr[1],
          password: dataArr[2],
          passwordSet: true
        });
      })
      .catch((err) => {
        console.log('No file found');
      });
  }

  componentWillUnmount() {
    this.scanStopHandler.remove();
    this.discoverHandler.remove();
    this.disconnectHandler.remove();

    if (this.state.doorConnected) {
      BleManager.disconnect(this.state.doorId).then(() => { console.log("Disconnected"); });
    }
  }

  writeValue(val) {
    let id = this.state.doorId;
    let service = this.state.doorService;
    let characteristic = this.state.doorCharacteristic;
    if (this.state.readyToReadDoor) {
      BleManager.write(
        id,
        service,
        characteristic,
        [val]
      )
        .then(() => {
          console.log("Successfully written");
        })
        .catch((error) => {
          console.log(error);
        });
    }
    else {
      Alert.alert(
        "Error: Disconnected",
        "Cannot set component value without connecting to component first",
        [
          { text: "OK", }
        ]
      );
    }
  }

  setPassword() {
    RNFS.unlink(path)
      .then(() => {
        console.log('Data file deleted');
      })
      .catch((err) => {
        console.log('Data file did not exist');
      });


    let data = this.state.doorService + '\n' + this.state.doorCharacteristic + '\n' + this.state.potentialPassword;
    RNFS.writeFile(path, data, 'utf8')
      .then(() => {
        console.log('Data file written: ');
      })
      .catch((err) => {
        console.log(err.message);
      });

    this.setState({
      authenticated: true,
      passwordSet: true,
    });
  }

  updateDoorService(val) {
    this.setState({ doorService: val });
  }
  updateDoorCharacteristic(val) {
    this.setState({ doorCharacteristic: val });
  }
  updateStatePassword(val) {
    this.setState({
      potentialPassword: val
    });
  }

  checkPassword() {
    if (this.state.password == this.state.potentialPassword) {
      this.setState({ authenticated: true });
      console.log("Authenticated");
    }
    else {
      Alert.alert(
        "Incorrect Password",
        "Password not recognized",
        [
          { text: "OK", }
        ]
      );
    }
  }
  resetPassword() {
    console.log("Reset password");
    this.setState({
      passwordSet: false,
      authenticated: false,
    });
  }

  startCalibration() {
    fetch('http://192.168.4.2:8888/calibrate')
    .then((response) => {
      Alert.alert(
        "Calibration Started",
        "Calibration has been toggled",
        [
          { text: "OK", }
        ]
      );
      this.setState({calibrated: !this.state.calibrated});
    })
    .catch((error) => {
      console.error(error);
    });
  }

  render() {
    if (this.state.authenticated && this.state.passwordSet) {
      return (
        <View>
          <Text>{this.state.doorConnected ? "Connected to door component" : "Scanning for door component..."}</Text>
          <Text>{this.state.readDoor == 0 ? "Unauthentiated" : (this.state.readDoor == 1 ? "Authenticated" : "Unknown")}</Text>
          <Button onPress={() => this.writeValue(1)} title="Unauthenticate"></Button>
          <Button onPress={() => this.writeValue(0)} title="Authenticate"></Button>
          <Button onPress={this.resetPassword} title="Reset Password"></Button>
          <Button onPress={() => this.startCalibration()} title={this.state.calibrated ? "Stop calibrating" : "Start Calibrating"}></Button>
        </View>
      );
    }
    else if (this.state.passwordSet) {
      return (
        <View>
          <Text>{"Not yet authenticated, enter password"}</Text>
          <TextInput onChangeText={this.updateStatePassword} placeholder="Password" />
          <Button onPress={this.checkPassword} title="Login">Login</Button>
        </View>
      );
    }
    else {
      return (
        <View>
          <Text>{"Not yet authenticated"}</Text>
          <TextInput onChangeText={this.updateDoorService} placeholder="Door Component Service" />
          <TextInput onChangeText={this.updateDoorCharacteristic} placeholder="Door Component Characteristic" />
          <TextInput onChangeText={this.updateStatePassword} placeholder="Password" />
          <Button onPress={this.setPassword} title="Set Password">Set Password</Button>
        </View>
      );
    }

  }
}

const styles = StyleSheet.create({

});


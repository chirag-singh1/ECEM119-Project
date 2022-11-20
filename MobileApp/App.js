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
      userConnected: false,
      doorConnected: false,
      readyToReadDoor: false,
      readyToReadUser: false,
      readDoor: "No data read yet",
      readUser: "No data read yet",
      calibrated: false,
      authenticated: false,
      passwordSet: false,
    };

    this.writeValue = this.writeValue.bind(this);
    this.setPassword = this.setPassword.bind(this);
    this.updateDoorService = this.updateDoorService.bind(this);
    this.updateUserService = this.updateUserService.bind(this);
    this.updateDoorCharacteristic = this.updateDoorCharacteristic.bind(this);
    this.updateUserCharacteristic = this.updateUserCharacteristic.bind(this);
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

      if (this.state.readyToReadUser) {
        BleManager.read(
          this.state.userId,
          this.state.userService,
          this.state.userCharacteristic
        )
          .then((readData) => {
            this.setState({ readUser: readData });
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
                  doorId: args.id
                });

                BleManager.retrieveServices(args.id).then(
                  (peripheralInfo) => {
                    if (this.searchForCharacteristic(peripheralInfo.characteristics, this.state.doorCharacteristic, this.state.doorService)) {
                      this.setState({ readyToReadDoor: true });
                      console.log("Door characteristic found");
                    }
                  }
                );
              })
              .catch((error) => {
                console.log(error);
              });
          }
        }
        if ('localName' in args.advertising && args.advertising.localName == 'KnowTouch - User Component') {
          if (!this.state.userConnected) {
            BleManager.connect(args.id)
              .then(() => {
                console.log("Connected to user, checking characteristic");
                this.setState({
                  userConnected: true,
                  userId: args.id
                });

                BleManager.retrieveServices(args.id).then(
                  (peripheralInfo) => {
                    if (this.searchForCharacteristic(peripheralInfo.characteristics, this.state.userCharacteristic, this.state.userService)) {
                      this.setState({ readyToReadUser: true });
                      console.log("User characteristic found");
                    }
                  }
                );
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
        this.setState({ doorConnected: false, userConnected: false, readyToRead: false });
        BleManager.scan([], 8, true).then((results) => {
          console.log('Scanning...');
        });
      }
    );

    this.scanStopHandler = bleManagerEmitter.addListener('BleManagerStopScan',
      () => {
        console.log('Scanning stopped');
        if (!this.state.doorConnected || !this.state.userConnected) {
          BleManager.scan([], 8).then((results) => {
            console.log('Scanning...');
          });
        }
      }
    );

    this.setState({ userConnected: false, doorConnected: false });

    this.checkUpdate();

    RNFS.readFile(path, 'utf8')
      .then((data) => {
        let dataArr = data.split('\n');
        this.setState({
          doorService: dataArr[0],
          doorCharacteristic: dataArr[1],
          userService: dataArr[2],
          userCharacteristic: dataArr[3],
          password: dataArr[4],
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

    if (this.state.userConnected) {
      BleManager.disconnect(this.state.userId).then(() => { console.log("Disconnected"); });
    }
    if (this.state.doorConnected) {
      BleManager.disconnect(this.state.doorId).then(() => { console.log("Disconnected"); });
    }
  }

  writeValue(val, door) {
    let id = door ? this.state.doorId : this.state.userId;
    let service = door  ? this.state.doorService : this.state.userService;
    let characteristic = door ? this.state.doorCharacteristic : this.state.userCharacteristic;
    if (this.state.readyToReadDoor && door  || this.state.readyToReadUser && !door) {
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


    let data = this.state.doorService + '\n' + this.state.doorCharacteristic + '\n' +
      this.state.userService + '\n' + this.state.userCharacteristic + '\n' + this.state.potentialPassword;
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
  updateUserService(val) {
    this.setState({ userService: val });
  }
  updateUserCharacteristic(val) {
    this.setState({ userCharacteristic: val });
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

  render() {
    if (this.state.authenticated && this.state.passwordSet) {
      return (
        <View>
          <Text>{this.state.doorConnected ? "Connected to door component" : "Scanning for door component..."}</Text>
          <Text>{this.state.userConnected ? "Connected to user component" : "Scanning for user component..."}</Text>
          <Text>{this.state.readDoor == 0 ? "Unauthentiated" : (this.state.readDoor == 1 ? "Authenticated" : "Unknown")}</Text>
          <Text>{this.state.readUser == 0 ? "Uncalibrated" : (this.state.readUser == 1 ? "Calibrated" : "Unknown")}</Text>
          <Button onPress={() => this.writeValue(1, true)} title="Unauthenticate"></Button>
          <Button onPress={() => this.writeValue(0, true)} title="Authenticate"></Button>
          <Button onPress={this.resetPassword} title="Reset Password"></Button>
          <Button onPress={() => this.writeValue(0, false)} title="Start Calibrating"></Button>
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
          <TextInput onChangeText={this.updateUserService} placeholder="User Component Service" />
          <TextInput onChangeText={this.updateUserCharacteristic} placeholder="User Component Characteristic" />
          <TextInput onChangeText={this.updateStatePassword} placeholder="Password" />
          <Button onPress={this.setPassword} title="Set Password">Set Password</Button>
        </View>
      );
    }

  }
}

const styles = StyleSheet.create({

});


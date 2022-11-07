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
      connected: false,
      service: "180A",
      characteristic: "2A57",
      readyToRead: false,
      readValue: "No data read yet",
      authenticated: false,
      passwordSet: false,
    };

    this.writeValue = this.writeValue.bind(this);
    this.setPassword = this.setPassword.bind(this);
    this.updateService = this.updateService.bind(this);
    this.updateCharacteristic = this.updateCharacteristic.bind(this);
    this.updateStatePassword = this.updateStatePassword.bind(this);
    this.checkPassword = this.checkPassword.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
  }

  checkUpdate() {
    setTimeout(() => {
      if (this.state.readyToRead) {
        BleManager.read(
          this.state.peripheralId,
          this.state.service,
          this.state.characteristic
        )
          .then((readData) => {
            this.setState({ readValue: readData });
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

  searchForCharacteristic(arr) {
    let retval = false;
    arr.forEach((elem) => {
      if (elem.service.toLowerCase() == this.state.service.toLowerCase()
        && elem.characteristic.toLowerCase() == this.state.characteristic.toLowerCase()) {
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
        if ('localName' in args.advertising && args.advertising.localName == 'Nano 33 IoT - Chirag') {
          if (!this.state.connected) {
            BleManager.connect(args.id)
              .then(() => {
                console.log("Connected, checking characteristic");
                this.setState({
                  connected: true,
                  peripheralId: args.id
                });

                BleManager.retrieveServices(args.id).then(
                  (peripheralInfo) => {
                    if (this.searchForCharacteristic(peripheralInfo.characteristics)) {
                      this.setState({ readyToRead: true });
                      console.log("Characterstic found");
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
        this.setState({ connected: false, readyToRead: false });
        BleManager.scan([], 8, true).then((results) => {
          console.log('Scanning...');
        });
      }
    );

    this.scanStopHandler = bleManagerEmitter.addListener('BleManagerStopScan',
      () => {
        console.log('Scanning stopped');
        if (!this.state.connected) {
          BleManager.scan([], 8).then((results) => {
            console.log('Scanning...');
          });
        }
      }
    );

    this.setState({ connected: false });

    this.checkUpdate();

    RNFS.readFile(path, 'utf8')
      .then((data) => {
        let dataArr = data.split('\n');
        console.log('Loaded service: ' + dataArr[0]);
        console.log('Loaded characteristic: ' + dataArr[1]);
        console.log('Loaded password: ' + dataArr[2]);

        this.setState({
          service: dataArr[0],
          characteristic: dataArr[1],
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

    if (this.state.connected) {
      BleManager.disconnect(this.state.peripheralId).then(() => { console.log("Disconnected"); });
    }

  }

  writeValue(val) {
    if (this.state.readyToRead) {
      BleManager.write(
        this.state.peripheralId,
        this.state.service,
        this.state.characteristic,
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
        "Cannot lock/unlock door without connecting to door component",
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


    let data = this.state.service + '\n' + this.state.characteristic + '\n' + this.state.potentialPassword;
    RNFS.writeFile(path, data, 'utf8')
      .then(() => {
        console.log('Data file written');
      })
      .catch((err) => {
        console.log(err.message);
      });

    this.setState({
      authenticated: true,
      passwordSet: true,
    });
  }

  updateService(val) {
    this.setState({ service: val });
  }
  updateCharacteristic(val) {
    this.setState({ characteristic: val });
  }
  updateStatePassword(val) {
    this.setState({
      potentialPassword: val
    });
  }
  checkPassword(val) {
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
          <Text>{this.state.connected ? "Connected" : "Scanning..."}</Text>
          <Text>{this.state.readValue == 0 ? "Locked" : (this.state.readValue == 1 ? "Unlocked" : "Unknown")}</Text>
          <Button onPress={() => this.writeValue(1)} title="Unlock"></Button>
          <Button onPress={() => this.writeValue(0)} title="Lock">Lock</Button>
          <Button onPress={this.resetPassword} title="Reset Password">Lock</Button>
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
          <TextInput onChangeText={this.updateService} placeholder="Service" />
          <TextInput onChangeText={this.updateCharacteristic} placeholder="Characteristic" />
          <TextInput onChangeText={this.updateStatePassword} placeholder="Password" />
          <Button onPress={this.setPassword} title="Set Password">Set Password</Button>
        </View>
      );
    }

  }
}

const styles = StyleSheet.create({

});


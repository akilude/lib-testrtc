'use strict';

import MicTest from '../unit/mic.js';
import RunConnectivityTest from '../unit/conn.js';
import CamResolutionsTest from '../unit/camresolutions.js';
import NetworkTest from '../unit/net.js';
import DataChannelThroughputTest from '../unit/dataBandwidth.js';
import VideoBandwidthTest from '../unit/videoBandwidth.js';
import WiFiPeriodicScanTest from '../unit/wifiPeriodicScan.js';
import Call from '../util/call.js';

import Suite from './suite.js';
import TestCase from './testCase.js';

export const TESTS = {
  AUDIOCAPTURE: 'Audio capture',
  CHECKRESOLUTION240: 'Check resolution 320x240',
  CHECKRESOLUTION480: 'Check resolution 640x480',
  CHECKRESOLUTION720: 'Check resolution 1280x720',
  CHECKSUPPORTEDRESOLUTIONS: 'Check supported resolutions',
  DATATHROUGHPUT: 'Data throughput',
  IPV6ENABLED: 'Ipv6 enabled',
  NETWORKLATENCY: 'Network latency',
  NETWORKLATENCYRELAY: 'Network latency - Relay',
  UDPENABLED: 'Udp enabled',
  TCPENABLED: 'Tcp enabled',
  VIDEOBANDWIDTH: 'Video bandwidth',
  RELAYCONNECTIVITY: 'Relay connectivity',
  REFLEXIVECONNECTIVITY: 'Reflexive connectivity',
  HOSTCONNECTIVITY: 'Host connectivity'
};

export const SUITES = {
  CAMERA: 'Camera',
  MICROPHONE: 'Microphone',
  NETWORK: 'Network',
  CONNECTIVITY: 'Connectivity',
  THROUGHPUT: 'Throughput'
};

export function buildMicroSuite(config, filter) {
  const micSuite = new Suite(SUITES.MICROPHONE, config);

  if (!filter.includes(TESTS.AUDIOCAPTURE)) {
    micSuite.add(
      new TestCase(micSuite, TESTS.AUDIOCAPTURE, test => {
        var micTest = new MicTest(test);
        micTest.run();
      })
    );
  }

  return micSuite;
}

export function buildCameraSuite(config, filter) {
  const cameraSuite = new Suite(SUITES.CAMERA, config);

  if (!filter.includes(TESTS.CHECKRESOLUTION240)) {
    cameraSuite.add(
      new TestCase(cameraSuite, TESTS.CHECKRESOLUTION240, test => {
        var camResolutionsTest = new CamResolutionsTest(test, [[320, 240]]);
        camResolutionsTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.CHECKRESOLUTION480)) {
    cameraSuite.add(
      new TestCase(cameraSuite, TESTS.CHECKRESOLUTION480, test => {
        var camResolutionsTest = new CamResolutionsTest(test, [[640, 480]]);
        camResolutionsTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.CHECKRESOLUTION720)) {
    cameraSuite.add(
      new TestCase(cameraSuite, TESTS.CHECKRESOLUTION720, test => {
        var camResolutionsTest = new CamResolutionsTest(test, [[1280, 720]]);
        camResolutionsTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.CHECKSUPPORTEDRESOLUTIONS)) {
    cameraSuite.add(
      new TestCase(cameraSuite, TESTS.CHECKSUPPORTEDRESOLUTIONS, test => {
        var resolutionArray = [
          [160, 120],
          [320, 180],
          [320, 240],
          [640, 360],
          [640, 480],
          [768, 576],
          [1024, 576],
          [1280, 720],
          [1280, 768],
          [1280, 800],
          [1920, 1080],
          [1920, 1200],
          [3840, 2160],
          [4096, 2160]
        ];
        var camResolutionsTest = new CamResolutionsTest(test, resolutionArray);
        camResolutionsTest.run();
      })
    );
  }

  return cameraSuite;
}

export function buildNetworkSuite(config, filter) {
  const networkSuite = new Suite(SUITES.NETWORK, config);

  if (!filter.includes(TESTS.UDPENABLED)) {
    // Test whether it can connect via UDP to a TURN server
    // Get a TURN config, and try to get a relay candidate using UDP.
    networkSuite.add(
      new TestCase(networkSuite, TESTS.UDPENABLED, test => {
        var networkTest = new NetworkTest(test, 'udp', null, Call.isRelay);
        networkTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.TCPENABLED)) {
    // Test whether it can connect via TCP to a TURN server
    // Get a TURN config, and try to get a relay candidate using TCP.
    networkSuite.add(
      new TestCase(networkSuite, TESTS.TCPENABLED, test => {
        var networkTest = new NetworkTest(test, 'tcp', null, Call.isRelay);
        networkTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.IPV6ENABLED)) {
    // Test whether it is IPv6 enabled (TODO: test IPv6 to a destination).
    // Turn on IPv6, and try to get an IPv6 host candidate.
    networkSuite.add(
      new TestCase(networkSuite, TESTS.IPV6ENABLED, test => {
        var params = {optional: [{googIPv6: true}]};
        var networkTest = new NetworkTest(test, null, params, Call.isIpv6);
        networkTest.run();
      })
    );
  }

  return networkSuite;
}

export function buildConnectivitySuite(config, filter) {
  const connectivitySuite = new Suite(SUITES.CONNECTIVITY, config);

  if (!filter.includes(TESTS.RELAYCONNECTIVITY)) {
    // Set up a datachannel between two peers through a relay
    // and verify data can be transmitted and received
    // (packets travel through the public internet)
    connectivitySuite.add(
      new TestCase(connectivitySuite, TESTS.RELAYCONNECTIVITY, test => {
        var runConnectivityTest = new RunConnectivityTest(test, Call.isRelay);
        runConnectivityTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.REFLEXIVECONNECTIVITY)) {
    // Set up a datachannel between two peers through a public IP address
    // and verify data can be transmitted and received
    // (packets should stay on the link if behind a router doing NAT)
    connectivitySuite.add(
      new TestCase(connectivitySuite, TESTS.REFLEXIVECONNECTIVITY, test => {
        var runConnectivityTest = new RunConnectivityTest(
          test,
          Call.isReflexive
        );
        runConnectivityTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.HOSTCONNECTIVITY)) {
    // Set up a datachannel between two peers through a local IP address
    // and verify data can be transmitted and received
    // (packets should not leave the machine running the test)
    connectivitySuite.add(
      new TestCase(connectivitySuite, TESTS.HOSTCONNECTIVITY, test => {
        var runConnectivityTest = new RunConnectivityTest(test, Call.isHost);
        runConnectivityTest.start();
      })
    );
  }

  return connectivitySuite;
}

export function buildThroughputSuite(config, filter) {
  const throughputSuite = new Suite(SUITES.THROUGHPUT, config);

  if (!filter.includes(TESTS.DATATHROUGHPUT)) {
    // Creates a loopback via relay candidates and tries to send as many packets
    // with 1024 chars as possible while keeping dataChannel bufferedAmmount above
    // zero.
    throughputSuite.add(
      new TestCase(throughputSuite, TESTS.DATATHROUGHPUT, test => {
        var dataChannelThroughputTest = new DataChannelThroughputTest(test);
        dataChannelThroughputTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.VIDEOBANDWIDTH)) {
    // Measures video bandwidth estimation performance by doing a loopback call via
    // relay candidates for 40 seconds. Computes rtt and bandwidth estimation
    // average and maximum as well as time to ramp up (defined as reaching 75% of
    // the max bitrate. It reports infinite time to ramp up if never reaches it.
    throughputSuite.add(
      new TestCase(throughputSuite, TESTS.VIDEOBANDWIDTH, test => {
        var videoBandwidthTest = new VideoBandwidthTest(test);
        videoBandwidthTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.NETWORKLATENCY)) {
    throughputSuite.add(
      new TestCase(throughputSuite, TESTS.NETWORKLATENCY, test => {
        var wiFiPeriodicScanTest = new WiFiPeriodicScanTest(
          test,
          Call.isNotHostCandidate
        );
        wiFiPeriodicScanTest.run();
      })
    );
  }

  if (!filter.includes(TESTS.NETWORKLATENCYRELAY)) {
    throughputSuite.add(
      new TestCase(throughputSuite, TESTS.NETWORKLATENCYRELAY, test => {
        var wiFiPeriodicScanTest = new WiFiPeriodicScanTest(test, Call.isRelay);
        wiFiPeriodicScanTest.run();
      })
    );
  }

  return throughputSuite;
}

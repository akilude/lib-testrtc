(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var SDPUtils = require('sdp');

function fixStatsType(stat) {
  return {
    inboundrtp: 'inbound-rtp',
    outboundrtp: 'outbound-rtp',
    candidatepair: 'candidate-pair',
    localcandidate: 'local-candidate',
    remotecandidate: 'remote-candidate'
  }[stat.type] || stat.type;
}

function writeMediaSection(transceiver, caps, type, stream, dtlsRole) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
      transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
      transceiver.dtlsTransport.getLocalParameters(),
      type === 'offer' ? 'actpass' : dtlsRole || 'active');

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    var trackId = transceiver.rtpSender._initialTrackId ||
        transceiver.rtpSender.track.id;
    transceiver.rtpSender._initialTrackId = trackId;
    // spec.
    var msid = 'msid:' + (stream ? stream.id : '-') + ' ' +
        trackId + '\r\n';
    sdp += 'a=' + msid;
    // for Chrome. Legacy should no longer be required.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;

    // RTX
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
}

// Edge does not like
// 1) stun: filtered after 14393 unless ?transport=udp is present
// 2) turn: that does not have all of turn:host:port?transport=udp
// 3) turn: with ipv6 addresses
// 4) turn: occurring muliple times
function filterIceServers(iceServers, edgeVersion) {
  var hasTurn = false;
  iceServers = JSON.parse(JSON.stringify(iceServers));
  return iceServers.filter(function(server) {
    if (server && (server.urls || server.url)) {
      var urls = server.urls || server.url;
      if (server.url && !server.urls) {
        console.warn('RTCIceServer.url is deprecated! Use urls instead.');
      }
      var isString = typeof urls === 'string';
      if (isString) {
        urls = [urls];
      }
      urls = urls.filter(function(url) {
        var validTurn = url.indexOf('turn:') === 0 &&
            url.indexOf('transport=udp') !== -1 &&
            url.indexOf('turn:[') === -1 &&
            !hasTurn;

        if (validTurn) {
          hasTurn = true;
          return true;
        }
        return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
            url.indexOf('?transport=udp') === -1;
      });

      delete server.url;
      server.urls = isString ? urls[0] : urls;
      return !!urls.length;
    }
  });
}

// Determines the intersection of local and remote capabilities.
function getCommonCapabilities(localCapabilities, remoteCapabilities) {
  var commonCapabilities = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: []
  };

  var findCodecByPayloadType = function(pt, codecs) {
    pt = parseInt(pt, 10);
    for (var i = 0; i < codecs.length; i++) {
      if (codecs[i].payloadType === pt ||
          codecs[i].preferredPayloadType === pt) {
        return codecs[i];
      }
    }
  };

  var rtxCapabilityMatches = function(lRtx, rRtx, lCodecs, rCodecs) {
    var lCodec = findCodecByPayloadType(lRtx.parameters.apt, lCodecs);
    var rCodec = findCodecByPayloadType(rRtx.parameters.apt, rCodecs);
    return lCodec && rCodec &&
        lCodec.name.toLowerCase() === rCodec.name.toLowerCase();
  };

  localCapabilities.codecs.forEach(function(lCodec) {
    for (var i = 0; i < remoteCapabilities.codecs.length; i++) {
      var rCodec = remoteCapabilities.codecs[i];
      if (lCodec.name.toLowerCase() === rCodec.name.toLowerCase() &&
          lCodec.clockRate === rCodec.clockRate) {
        if (lCodec.name.toLowerCase() === 'rtx' &&
            lCodec.parameters && rCodec.parameters.apt) {
          // for RTX we need to find the local rtx that has a apt
          // which points to the same local codec as the remote one.
          if (!rtxCapabilityMatches(lCodec, rCodec,
              localCapabilities.codecs, remoteCapabilities.codecs)) {
            continue;
          }
        }
        rCodec = JSON.parse(JSON.stringify(rCodec)); // deepcopy
        // number of channels is the highest common number of channels
        rCodec.numChannels = Math.min(lCodec.numChannels,
            rCodec.numChannels);
        // push rCodec so we reply with offerer payload type
        commonCapabilities.codecs.push(rCodec);

        // determine common feedback mechanisms
        rCodec.rtcpFeedback = rCodec.rtcpFeedback.filter(function(fb) {
          for (var j = 0; j < lCodec.rtcpFeedback.length; j++) {
            if (lCodec.rtcpFeedback[j].type === fb.type &&
                lCodec.rtcpFeedback[j].parameter === fb.parameter) {
              return true;
            }
          }
          return false;
        });
        // FIXME: also need to determine .parameters
        //  see https://github.com/openpeer/ortc/issues/569
        break;
      }
    }
  });

  localCapabilities.headerExtensions.forEach(function(lHeaderExtension) {
    for (var i = 0; i < remoteCapabilities.headerExtensions.length;
         i++) {
      var rHeaderExtension = remoteCapabilities.headerExtensions[i];
      if (lHeaderExtension.uri === rHeaderExtension.uri) {
        commonCapabilities.headerExtensions.push(rHeaderExtension);
        break;
      }
    }
  });

  // FIXME: fecMechanisms
  return commonCapabilities;
}

// is action=setLocalDescription with type allowed in signalingState
function isActionAllowedInSignalingState(action, type, signalingState) {
  return {
    offer: {
      setLocalDescription: ['stable', 'have-local-offer'],
      setRemoteDescription: ['stable', 'have-remote-offer']
    },
    answer: {
      setLocalDescription: ['have-remote-offer', 'have-local-pranswer'],
      setRemoteDescription: ['have-local-offer', 'have-remote-pranswer']
    }
  }[type][action].indexOf(signalingState) !== -1;
}

function maybeAddCandidate(iceTransport, candidate) {
  // Edge's internal representation adds some fields therefore
  // not all fieldѕ are taken into account.
  var alreadyAdded = iceTransport.getRemoteCandidates()
      .find(function(remoteCandidate) {
        return candidate.foundation === remoteCandidate.foundation &&
            candidate.ip === remoteCandidate.ip &&
            candidate.port === remoteCandidate.port &&
            candidate.priority === remoteCandidate.priority &&
            candidate.protocol === remoteCandidate.protocol &&
            candidate.type === remoteCandidate.type;
      });
  if (!alreadyAdded) {
    iceTransport.addRemoteCandidate(candidate);
  }
  return !alreadyAdded;
}


function makeError(name, description) {
  var e = new Error(description);
  e.name = name;
  // legacy error codes from https://heycam.github.io/webidl/#idl-DOMException-error-names
  e.code = {
    NotSupportedError: 9,
    InvalidStateError: 11,
    InvalidAccessError: 15,
    TypeError: undefined,
    OperationError: undefined
  }[name];
  return e;
}

module.exports = function(window, edgeVersion) {
  // https://w3c.github.io/mediacapture-main/#mediastream
  // Helper function to add the track to the stream and
  // dispatch the event ourselves.
  function addTrackToStreamAndFireEvent(track, stream) {
    stream.addTrack(track);
    stream.dispatchEvent(new window.MediaStreamTrackEvent('addtrack',
        {track: track}));
  }

  function removeTrackFromStreamAndFireEvent(track, stream) {
    stream.removeTrack(track);
    stream.dispatchEvent(new window.MediaStreamTrackEvent('removetrack',
        {track: track}));
  }

  function fireAddTrack(pc, track, receiver, streams) {
    var trackEvent = new Event('track');
    trackEvent.track = track;
    trackEvent.receiver = receiver;
    trackEvent.transceiver = {receiver: receiver};
    trackEvent.streams = streams;
    window.setTimeout(function() {
      pc._dispatchEvent('track', trackEvent);
    });
  }

  var RTCPeerConnection = function(config) {
    var pc = this;

    var _eventTarget = document.createDocumentFragment();
    ['addEventListener', 'removeEventListener', 'dispatchEvent']
        .forEach(function(method) {
          pc[method] = _eventTarget[method].bind(_eventTarget);
        });

    this.canTrickleIceCandidates = null;

    this.needNegotiation = false;

    this.localStreams = [];
    this.remoteStreams = [];

    this._localDescription = null;
    this._remoteDescription = null;

    this.signalingState = 'stable';
    this.iceConnectionState = 'new';
    this.connectionState = 'new';
    this.iceGatheringState = 'new';

    config = JSON.parse(JSON.stringify(config || {}));

    this.usingBundle = config.bundlePolicy === 'max-bundle';
    if (config.rtcpMuxPolicy === 'negotiate') {
      throw(makeError('NotSupportedError',
          'rtcpMuxPolicy \'negotiate\' is not supported'));
    } else if (!config.rtcpMuxPolicy) {
      config.rtcpMuxPolicy = 'require';
    }

    switch (config.iceTransportPolicy) {
      case 'all':
      case 'relay':
        break;
      default:
        config.iceTransportPolicy = 'all';
        break;
    }

    switch (config.bundlePolicy) {
      case 'balanced':
      case 'max-compat':
      case 'max-bundle':
        break;
      default:
        config.bundlePolicy = 'balanced';
        break;
    }

    config.iceServers = filterIceServers(config.iceServers || [], edgeVersion);

    this._iceGatherers = [];
    if (config.iceCandidatePoolSize) {
      for (var i = config.iceCandidatePoolSize; i > 0; i--) {
        this._iceGatherers.push(new window.RTCIceGatherer({
          iceServers: config.iceServers,
          gatherPolicy: config.iceTransportPolicy
        }));
      }
    } else {
      config.iceCandidatePoolSize = 0;
    }

    this._config = config;

    // per-track iceGathers, iceTransports, dtlsTransports, rtpSenders, ...
    // everything that is needed to describe a SDP m-line.
    this.transceivers = [];

    this._sdpSessionId = SDPUtils.generateSessionId();
    this._sdpSessionVersion = 0;

    this._dtlsRole = undefined; // role for a=setup to use in answers.

    this._isClosed = false;
  };

  Object.defineProperty(RTCPeerConnection.prototype, 'localDescription', {
    configurable: true,
    get: function() {
      return this._localDescription;
    }
  });
  Object.defineProperty(RTCPeerConnection.prototype, 'remoteDescription', {
    configurable: true,
    get: function() {
      return this._remoteDescription;
    }
  });

  // set up event handlers on prototype
  RTCPeerConnection.prototype.onicecandidate = null;
  RTCPeerConnection.prototype.onaddstream = null;
  RTCPeerConnection.prototype.ontrack = null;
  RTCPeerConnection.prototype.onremovestream = null;
  RTCPeerConnection.prototype.onsignalingstatechange = null;
  RTCPeerConnection.prototype.oniceconnectionstatechange = null;
  RTCPeerConnection.prototype.onconnectionstatechange = null;
  RTCPeerConnection.prototype.onicegatheringstatechange = null;
  RTCPeerConnection.prototype.onnegotiationneeded = null;
  RTCPeerConnection.prototype.ondatachannel = null;

  RTCPeerConnection.prototype._dispatchEvent = function(name, event) {
    if (this._isClosed) {
      return;
    }
    this.dispatchEvent(event);
    if (typeof this['on' + name] === 'function') {
      this['on' + name](event);
    }
  };

  RTCPeerConnection.prototype._emitGatheringStateChange = function() {
    var event = new Event('icegatheringstatechange');
    this._dispatchEvent('icegatheringstatechange', event);
  };

  RTCPeerConnection.prototype.getConfiguration = function() {
    return this._config;
  };

  RTCPeerConnection.prototype.getLocalStreams = function() {
    return this.localStreams;
  };

  RTCPeerConnection.prototype.getRemoteStreams = function() {
    return this.remoteStreams;
  };

  // internal helper to create a transceiver object.
  // (which is not yet the same as the WebRTC 1.0 transceiver)
  RTCPeerConnection.prototype._createTransceiver = function(kind, doNotAdd) {
    var hasBundleTransport = this.transceivers.length > 0;
    var transceiver = {
      track: null,
      iceGatherer: null,
      iceTransport: null,
      dtlsTransport: null,
      localCapabilities: null,
      remoteCapabilities: null,
      rtpSender: null,
      rtpReceiver: null,
      kind: kind,
      mid: null,
      sendEncodingParameters: null,
      recvEncodingParameters: null,
      stream: null,
      associatedRemoteMediaStreams: [],
      wantReceive: true
    };
    if (this.usingBundle && hasBundleTransport) {
      transceiver.iceTransport = this.transceivers[0].iceTransport;
      transceiver.dtlsTransport = this.transceivers[0].dtlsTransport;
    } else {
      var transports = this._createIceAndDtlsTransports();
      transceiver.iceTransport = transports.iceTransport;
      transceiver.dtlsTransport = transports.dtlsTransport;
    }
    if (!doNotAdd) {
      this.transceivers.push(transceiver);
    }
    return transceiver;
  };

  RTCPeerConnection.prototype.addTrack = function(track, stream) {
    if (this._isClosed) {
      throw makeError('InvalidStateError',
          'Attempted to call addTrack on a closed peerconnection.');
    }

    var alreadyExists = this.transceivers.find(function(s) {
      return s.track === track;
    });

    if (alreadyExists) {
      throw makeError('InvalidAccessError', 'Track already exists.');
    }

    var transceiver;
    for (var i = 0; i < this.transceivers.length; i++) {
      if (!this.transceivers[i].track &&
          this.transceivers[i].kind === track.kind) {
        transceiver = this.transceivers[i];
      }
    }
    if (!transceiver) {
      transceiver = this._createTransceiver(track.kind);
    }

    this._maybeFireNegotiationNeeded();

    if (this.localStreams.indexOf(stream) === -1) {
      this.localStreams.push(stream);
    }

    transceiver.track = track;
    transceiver.stream = stream;
    transceiver.rtpSender = new window.RTCRtpSender(track,
        transceiver.dtlsTransport);
    return transceiver.rtpSender;
  };

  RTCPeerConnection.prototype.addStream = function(stream) {
    var pc = this;
    if (edgeVersion >= 15025) {
      stream.getTracks().forEach(function(track) {
        pc.addTrack(track, stream);
      });
    } else {
      // Clone is necessary for local demos mostly, attaching directly
      // to two different senders does not work (build 10547).
      // Fixed in 15025 (or earlier)
      var clonedStream = stream.clone();
      stream.getTracks().forEach(function(track, idx) {
        var clonedTrack = clonedStream.getTracks()[idx];
        track.addEventListener('enabled', function(event) {
          clonedTrack.enabled = event.enabled;
        });
      });
      clonedStream.getTracks().forEach(function(track) {
        pc.addTrack(track, clonedStream);
      });
    }
  };

  RTCPeerConnection.prototype.removeTrack = function(sender) {
    if (this._isClosed) {
      throw makeError('InvalidStateError',
          'Attempted to call removeTrack on a closed peerconnection.');
    }

    if (!(sender instanceof window.RTCRtpSender)) {
      throw new TypeError('Argument 1 of RTCPeerConnection.removeTrack ' +
          'does not implement interface RTCRtpSender.');
    }

    var transceiver = this.transceivers.find(function(t) {
      return t.rtpSender === sender;
    });

    if (!transceiver) {
      throw makeError('InvalidAccessError',
          'Sender was not created by this connection.');
    }
    var stream = transceiver.stream;

    transceiver.rtpSender.stop();
    transceiver.rtpSender = null;
    transceiver.track = null;
    transceiver.stream = null;

    // remove the stream from the set of local streams
    var localStreams = this.transceivers.map(function(t) {
      return t.stream;
    });
    if (localStreams.indexOf(stream) === -1 &&
        this.localStreams.indexOf(stream) > -1) {
      this.localStreams.splice(this.localStreams.indexOf(stream), 1);
    }

    this._maybeFireNegotiationNeeded();
  };

  RTCPeerConnection.prototype.removeStream = function(stream) {
    var pc = this;
    stream.getTracks().forEach(function(track) {
      var sender = pc.getSenders().find(function(s) {
        return s.track === track;
      });
      if (sender) {
        pc.removeTrack(sender);
      }
    });
  };

  RTCPeerConnection.prototype.getSenders = function() {
    return this.transceivers.filter(function(transceiver) {
      return !!transceiver.rtpSender;
    })
    .map(function(transceiver) {
      return transceiver.rtpSender;
    });
  };

  RTCPeerConnection.prototype.getReceivers = function() {
    return this.transceivers.filter(function(transceiver) {
      return !!transceiver.rtpReceiver;
    })
    .map(function(transceiver) {
      return transceiver.rtpReceiver;
    });
  };


  RTCPeerConnection.prototype._createIceGatherer = function(sdpMLineIndex,
      usingBundle) {
    var pc = this;
    if (usingBundle && sdpMLineIndex > 0) {
      return this.transceivers[0].iceGatherer;
    } else if (this._iceGatherers.length) {
      return this._iceGatherers.shift();
    }
    var iceGatherer = new window.RTCIceGatherer({
      iceServers: this._config.iceServers,
      gatherPolicy: this._config.iceTransportPolicy
    });
    Object.defineProperty(iceGatherer, 'state',
        {value: 'new', writable: true}
    );

    this.transceivers[sdpMLineIndex].bufferedCandidateEvents = [];
    this.transceivers[sdpMLineIndex].bufferCandidates = function(event) {
      var end = !event.candidate || Object.keys(event.candidate).length === 0;
      // polyfill since RTCIceGatherer.state is not implemented in
      // Edge 10547 yet.
      iceGatherer.state = end ? 'completed' : 'gathering';
      if (pc.transceivers[sdpMLineIndex].bufferedCandidateEvents !== null) {
        pc.transceivers[sdpMLineIndex].bufferedCandidateEvents.push(event);
      }
    };
    iceGatherer.addEventListener('localcandidate',
      this.transceivers[sdpMLineIndex].bufferCandidates);
    return iceGatherer;
  };

  // start gathering from an RTCIceGatherer.
  RTCPeerConnection.prototype._gather = function(mid, sdpMLineIndex) {
    var pc = this;
    var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
    if (iceGatherer.onlocalcandidate) {
      return;
    }
    var bufferedCandidateEvents =
      this.transceivers[sdpMLineIndex].bufferedCandidateEvents;
    this.transceivers[sdpMLineIndex].bufferedCandidateEvents = null;
    iceGatherer.removeEventListener('localcandidate',
      this.transceivers[sdpMLineIndex].bufferCandidates);
    iceGatherer.onlocalcandidate = function(evt) {
      if (pc.usingBundle && sdpMLineIndex > 0) {
        // if we know that we use bundle we can drop candidates with
        // ѕdpMLineIndex > 0. If we don't do this then our state gets
        // confused since we dispose the extra ice gatherer.
        return;
      }
      var event = new Event('icecandidate');
      event.candidate = {sdpMid: mid, sdpMLineIndex: sdpMLineIndex};

      var cand = evt.candidate;
      // Edge emits an empty object for RTCIceCandidateComplete‥
      var end = !cand || Object.keys(cand).length === 0;
      if (end) {
        // polyfill since RTCIceGatherer.state is not implemented in
        // Edge 10547 yet.
        if (iceGatherer.state === 'new' || iceGatherer.state === 'gathering') {
          iceGatherer.state = 'completed';
        }
      } else {
        if (iceGatherer.state === 'new') {
          iceGatherer.state = 'gathering';
        }
        // RTCIceCandidate doesn't have a component, needs to be added
        cand.component = 1;
        // also the usernameFragment. TODO: update SDP to take both variants.
        cand.ufrag = iceGatherer.getLocalParameters().usernameFragment;

        var serializedCandidate = SDPUtils.writeCandidate(cand);
        event.candidate = Object.assign(event.candidate,
            SDPUtils.parseCandidate(serializedCandidate));

        event.candidate.candidate = serializedCandidate;
        event.candidate.toJSON = function() {
          return {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            usernameFragment: event.candidate.usernameFragment
          };
        };
      }

      // update local description.
      var sections = SDPUtils.getMediaSections(pc._localDescription.sdp);
      if (!end) {
        sections[event.candidate.sdpMLineIndex] +=
            'a=' + event.candidate.candidate + '\r\n';
      } else {
        sections[event.candidate.sdpMLineIndex] +=
            'a=end-of-candidates\r\n';
      }
      pc._localDescription.sdp =
          SDPUtils.getDescription(pc._localDescription.sdp) +
          sections.join('');
      var complete = pc.transceivers.every(function(transceiver) {
        return transceiver.iceGatherer &&
            transceiver.iceGatherer.state === 'completed';
      });

      if (pc.iceGatheringState !== 'gathering') {
        pc.iceGatheringState = 'gathering';
        pc._emitGatheringStateChange();
      }

      // Emit candidate. Also emit null candidate when all gatherers are
      // complete.
      if (!end) {
        pc._dispatchEvent('icecandidate', event);
      }
      if (complete) {
        pc._dispatchEvent('icecandidate', new Event('icecandidate'));
        pc.iceGatheringState = 'complete';
        pc._emitGatheringStateChange();
      }
    };

    // emit already gathered candidates.
    window.setTimeout(function() {
      bufferedCandidateEvents.forEach(function(e) {
        iceGatherer.onlocalcandidate(e);
      });
    }, 0);
  };

  // Create ICE transport and DTLS transport.
  RTCPeerConnection.prototype._createIceAndDtlsTransports = function() {
    var pc = this;
    var iceTransport = new window.RTCIceTransport(null);
    iceTransport.onicestatechange = function() {
      pc._updateIceConnectionState();
      pc._updateConnectionState();
    };

    var dtlsTransport = new window.RTCDtlsTransport(iceTransport);
    dtlsTransport.ondtlsstatechange = function() {
      pc._updateConnectionState();
    };
    dtlsTransport.onerror = function() {
      // onerror does not set state to failed by itself.
      Object.defineProperty(dtlsTransport, 'state',
          {value: 'failed', writable: true});
      pc._updateConnectionState();
    };

    return {
      iceTransport: iceTransport,
      dtlsTransport: dtlsTransport
    };
  };

  // Destroy ICE gatherer, ICE transport and DTLS transport.
  // Without triggering the callbacks.
  RTCPeerConnection.prototype._disposeIceAndDtlsTransports = function(
      sdpMLineIndex) {
    var iceGatherer = this.transceivers[sdpMLineIndex].iceGatherer;
    if (iceGatherer) {
      delete iceGatherer.onlocalcandidate;
      delete this.transceivers[sdpMLineIndex].iceGatherer;
    }
    var iceTransport = this.transceivers[sdpMLineIndex].iceTransport;
    if (iceTransport) {
      delete iceTransport.onicestatechange;
      delete this.transceivers[sdpMLineIndex].iceTransport;
    }
    var dtlsTransport = this.transceivers[sdpMLineIndex].dtlsTransport;
    if (dtlsTransport) {
      delete dtlsTransport.ondtlsstatechange;
      delete dtlsTransport.onerror;
      delete this.transceivers[sdpMLineIndex].dtlsTransport;
    }
  };

  // Start the RTP Sender and Receiver for a transceiver.
  RTCPeerConnection.prototype._transceive = function(transceiver,
      send, recv) {
    var params = getCommonCapabilities(transceiver.localCapabilities,
        transceiver.remoteCapabilities);
    if (send && transceiver.rtpSender) {
      params.encodings = transceiver.sendEncodingParameters;
      params.rtcp = {
        cname: SDPUtils.localCName,
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.recvEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.recvEncodingParameters[0].ssrc;
      }
      transceiver.rtpSender.send(params);
    }
    if (recv && transceiver.rtpReceiver && params.codecs.length > 0) {
      // remove RTX field in Edge 14942
      if (transceiver.kind === 'video'
          && transceiver.recvEncodingParameters
          && edgeVersion < 15019) {
        transceiver.recvEncodingParameters.forEach(function(p) {
          delete p.rtx;
        });
      }
      if (transceiver.recvEncodingParameters.length) {
        params.encodings = transceiver.recvEncodingParameters;
      } else {
        params.encodings = [{}];
      }
      params.rtcp = {
        compound: transceiver.rtcpParameters.compound
      };
      if (transceiver.rtcpParameters.cname) {
        params.rtcp.cname = transceiver.rtcpParameters.cname;
      }
      if (transceiver.sendEncodingParameters.length) {
        params.rtcp.ssrc = transceiver.sendEncodingParameters[0].ssrc;
      }
      transceiver.rtpReceiver.receive(params);
    }
  };

  RTCPeerConnection.prototype.setLocalDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(makeError('TypeError',
          'Unsupported type "' + description.type + '"'));
    }

    if (!isActionAllowedInSignalingState('setLocalDescription',
        description.type, pc.signalingState) || pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not set local ' + description.type +
          ' in state ' + pc.signalingState));
    }

    var sections;
    var sessionpart;
    if (description.type === 'offer') {
      // VERY limited support for SDP munging. Limited to:
      // * changing the order of codecs
      sections = SDPUtils.splitSections(description.sdp);
      sessionpart = sections.shift();
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var caps = SDPUtils.parseRtpParameters(mediaSection);
        pc.transceivers[sdpMLineIndex].localCapabilities = caps;
      });

      pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
        pc._gather(transceiver.mid, sdpMLineIndex);
      });
    } else if (description.type === 'answer') {
      sections = SDPUtils.splitSections(pc._remoteDescription.sdp);
      sessionpart = sections.shift();
      var isIceLite = SDPUtils.matchPrefix(sessionpart,
          'a=ice-lite').length > 0;
      sections.forEach(function(mediaSection, sdpMLineIndex) {
        var transceiver = pc.transceivers[sdpMLineIndex];
        var iceGatherer = transceiver.iceGatherer;
        var iceTransport = transceiver.iceTransport;
        var dtlsTransport = transceiver.dtlsTransport;
        var localCapabilities = transceiver.localCapabilities;
        var remoteCapabilities = transceiver.remoteCapabilities;

        // treat bundle-only as not-rejected.
        var rejected = SDPUtils.isRejected(mediaSection) &&
            SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;

        if (!rejected && !transceiver.rejected) {
          var remoteIceParameters = SDPUtils.getIceParameters(
              mediaSection, sessionpart);
          var remoteDtlsParameters = SDPUtils.getDtlsParameters(
              mediaSection, sessionpart);
          if (isIceLite) {
            remoteDtlsParameters.role = 'server';
          }

          if (!pc.usingBundle || sdpMLineIndex === 0) {
            pc._gather(transceiver.mid, sdpMLineIndex);
            if (iceTransport.state === 'new') {
              iceTransport.start(iceGatherer, remoteIceParameters,
                  isIceLite ? 'controlling' : 'controlled');
            }
            if (dtlsTransport.state === 'new') {
              dtlsTransport.start(remoteDtlsParameters);
            }
          }

          // Calculate intersection of capabilities.
          var params = getCommonCapabilities(localCapabilities,
              remoteCapabilities);

          // Start the RTCRtpSender. The RTCRtpReceiver for this
          // transceiver has already been started in setRemoteDescription.
          pc._transceive(transceiver,
              params.codecs.length > 0,
              false);
        }
      });
    }

    pc._localDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-local-offer');
    } else {
      pc._updateSignalingState('stable');
    }

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.setRemoteDescription = function(description) {
    var pc = this;

    // Note: pranswer is not supported.
    if (['offer', 'answer'].indexOf(description.type) === -1) {
      return Promise.reject(makeError('TypeError',
          'Unsupported type "' + description.type + '"'));
    }

    if (!isActionAllowedInSignalingState('setRemoteDescription',
        description.type, pc.signalingState) || pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not set remote ' + description.type +
          ' in state ' + pc.signalingState));
    }

    var streams = {};
    pc.remoteStreams.forEach(function(stream) {
      streams[stream.id] = stream;
    });
    var receiverList = [];
    var sections = SDPUtils.splitSections(description.sdp);
    var sessionpart = sections.shift();
    var isIceLite = SDPUtils.matchPrefix(sessionpart,
        'a=ice-lite').length > 0;
    var usingBundle = SDPUtils.matchPrefix(sessionpart,
        'a=group:BUNDLE ').length > 0;
    pc.usingBundle = usingBundle;
    var iceOptions = SDPUtils.matchPrefix(sessionpart,
        'a=ice-options:')[0];
    if (iceOptions) {
      pc.canTrickleIceCandidates = iceOptions.substr(14).split(' ')
          .indexOf('trickle') >= 0;
    } else {
      pc.canTrickleIceCandidates = false;
    }

    sections.forEach(function(mediaSection, sdpMLineIndex) {
      var lines = SDPUtils.splitLines(mediaSection);
      var kind = SDPUtils.getKind(mediaSection);
      // treat bundle-only as not-rejected.
      var rejected = SDPUtils.isRejected(mediaSection) &&
          SDPUtils.matchPrefix(mediaSection, 'a=bundle-only').length === 0;
      var protocol = lines[0].substr(2).split(' ')[2];

      var direction = SDPUtils.getDirection(mediaSection, sessionpart);
      var remoteMsid = SDPUtils.parseMsid(mediaSection);

      var mid = SDPUtils.getMid(mediaSection) || SDPUtils.generateIdentifier();

      // Reject datachannels which are not implemented yet.
      if ((kind === 'application' && protocol === 'DTLS/SCTP') || rejected) {
        // TODO: this is dangerous in the case where a non-rejected m-line
        //     becomes rejected.
        pc.transceivers[sdpMLineIndex] = {
          mid: mid,
          kind: kind,
          rejected: true
        };
        return;
      }

      if (!rejected && pc.transceivers[sdpMLineIndex] &&
          pc.transceivers[sdpMLineIndex].rejected) {
        // recycle a rejected transceiver.
        pc.transceivers[sdpMLineIndex] = pc._createTransceiver(kind, true);
      }

      var transceiver;
      var iceGatherer;
      var iceTransport;
      var dtlsTransport;
      var rtpReceiver;
      var sendEncodingParameters;
      var recvEncodingParameters;
      var localCapabilities;

      var track;
      // FIXME: ensure the mediaSection has rtcp-mux set.
      var remoteCapabilities = SDPUtils.parseRtpParameters(mediaSection);
      var remoteIceParameters;
      var remoteDtlsParameters;
      if (!rejected) {
        remoteIceParameters = SDPUtils.getIceParameters(mediaSection,
            sessionpart);
        remoteDtlsParameters = SDPUtils.getDtlsParameters(mediaSection,
            sessionpart);
        remoteDtlsParameters.role = 'client';
      }
      recvEncodingParameters =
          SDPUtils.parseRtpEncodingParameters(mediaSection);

      var rtcpParameters = SDPUtils.parseRtcpParameters(mediaSection);

      var isComplete = SDPUtils.matchPrefix(mediaSection,
          'a=end-of-candidates', sessionpart).length > 0;
      var cands = SDPUtils.matchPrefix(mediaSection, 'a=candidate:')
          .map(function(cand) {
            return SDPUtils.parseCandidate(cand);
          })
          .filter(function(cand) {
            return cand.component === 1;
          });

      // Check if we can use BUNDLE and dispose transports.
      if ((description.type === 'offer' || description.type === 'answer') &&
          !rejected && usingBundle && sdpMLineIndex > 0 &&
          pc.transceivers[sdpMLineIndex]) {
        pc._disposeIceAndDtlsTransports(sdpMLineIndex);
        pc.transceivers[sdpMLineIndex].iceGatherer =
            pc.transceivers[0].iceGatherer;
        pc.transceivers[sdpMLineIndex].iceTransport =
            pc.transceivers[0].iceTransport;
        pc.transceivers[sdpMLineIndex].dtlsTransport =
            pc.transceivers[0].dtlsTransport;
        if (pc.transceivers[sdpMLineIndex].rtpSender) {
          pc.transceivers[sdpMLineIndex].rtpSender.setTransport(
              pc.transceivers[0].dtlsTransport);
        }
        if (pc.transceivers[sdpMLineIndex].rtpReceiver) {
          pc.transceivers[sdpMLineIndex].rtpReceiver.setTransport(
              pc.transceivers[0].dtlsTransport);
        }
      }
      if (description.type === 'offer' && !rejected) {
        transceiver = pc.transceivers[sdpMLineIndex] ||
            pc._createTransceiver(kind);
        transceiver.mid = mid;

        if (!transceiver.iceGatherer) {
          transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
              usingBundle);
        }

        if (cands.length && transceiver.iceTransport.state === 'new') {
          if (isComplete && (!usingBundle || sdpMLineIndex === 0)) {
            transceiver.iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        localCapabilities = window.RTCRtpReceiver.getCapabilities(kind);

        // filter RTX until additional stuff needed for RTX is implemented
        // in adapter.js
        if (edgeVersion < 15019) {
          localCapabilities.codecs = localCapabilities.codecs.filter(
              function(codec) {
                return codec.name !== 'rtx';
              });
        }

        sendEncodingParameters = transceiver.sendEncodingParameters || [{
          ssrc: (2 * sdpMLineIndex + 2) * 1001
        }];

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        var isNewTrack = false;
        if (direction === 'sendrecv' || direction === 'sendonly') {
          isNewTrack = !transceiver.rtpReceiver;
          rtpReceiver = transceiver.rtpReceiver ||
              new window.RTCRtpReceiver(transceiver.dtlsTransport, kind);

          if (isNewTrack) {
            var stream;
            track = rtpReceiver.track;
            // FIXME: does not work with Plan B.
            if (remoteMsid && remoteMsid.stream === '-') {
              // no-op. a stream id of '-' means: no associated stream.
            } else if (remoteMsid) {
              if (!streams[remoteMsid.stream]) {
                streams[remoteMsid.stream] = new window.MediaStream();
                Object.defineProperty(streams[remoteMsid.stream], 'id', {
                  get: function() {
                    return remoteMsid.stream;
                  }
                });
              }
              Object.defineProperty(track, 'id', {
                get: function() {
                  return remoteMsid.track;
                }
              });
              stream = streams[remoteMsid.stream];
            } else {
              if (!streams.default) {
                streams.default = new window.MediaStream();
              }
              stream = streams.default;
            }
            if (stream) {
              addTrackToStreamAndFireEvent(track, stream);
              transceiver.associatedRemoteMediaStreams.push(stream);
            }
            receiverList.push([track, rtpReceiver, stream]);
          }
        } else if (transceiver.rtpReceiver && transceiver.rtpReceiver.track) {
          transceiver.associatedRemoteMediaStreams.forEach(function(s) {
            var nativeTrack = s.getTracks().find(function(t) {
              return t.id === transceiver.rtpReceiver.track.id;
            });
            if (nativeTrack) {
              removeTrackFromStreamAndFireEvent(nativeTrack, s);
            }
          });
          transceiver.associatedRemoteMediaStreams = [];
        }

        transceiver.localCapabilities = localCapabilities;
        transceiver.remoteCapabilities = remoteCapabilities;
        transceiver.rtpReceiver = rtpReceiver;
        transceiver.rtcpParameters = rtcpParameters;
        transceiver.sendEncodingParameters = sendEncodingParameters;
        transceiver.recvEncodingParameters = recvEncodingParameters;

        // Start the RTCRtpReceiver now. The RTPSender is started in
        // setLocalDescription.
        pc._transceive(pc.transceivers[sdpMLineIndex],
            false,
            isNewTrack);
      } else if (description.type === 'answer' && !rejected) {
        transceiver = pc.transceivers[sdpMLineIndex];
        iceGatherer = transceiver.iceGatherer;
        iceTransport = transceiver.iceTransport;
        dtlsTransport = transceiver.dtlsTransport;
        rtpReceiver = transceiver.rtpReceiver;
        sendEncodingParameters = transceiver.sendEncodingParameters;
        localCapabilities = transceiver.localCapabilities;

        pc.transceivers[sdpMLineIndex].recvEncodingParameters =
            recvEncodingParameters;
        pc.transceivers[sdpMLineIndex].remoteCapabilities =
            remoteCapabilities;
        pc.transceivers[sdpMLineIndex].rtcpParameters = rtcpParameters;

        if (cands.length && iceTransport.state === 'new') {
          if ((isIceLite || isComplete) &&
              (!usingBundle || sdpMLineIndex === 0)) {
            iceTransport.setRemoteCandidates(cands);
          } else {
            cands.forEach(function(candidate) {
              maybeAddCandidate(transceiver.iceTransport, candidate);
            });
          }
        }

        if (!usingBundle || sdpMLineIndex === 0) {
          if (iceTransport.state === 'new') {
            iceTransport.start(iceGatherer, remoteIceParameters,
                'controlling');
          }
          if (dtlsTransport.state === 'new') {
            dtlsTransport.start(remoteDtlsParameters);
          }
        }

        pc._transceive(transceiver,
            direction === 'sendrecv' || direction === 'recvonly',
            direction === 'sendrecv' || direction === 'sendonly');

        // TODO: rewrite to use http://w3c.github.io/webrtc-pc/#set-associated-remote-streams
        if (rtpReceiver &&
            (direction === 'sendrecv' || direction === 'sendonly')) {
          track = rtpReceiver.track;
          if (remoteMsid) {
            if (!streams[remoteMsid.stream]) {
              streams[remoteMsid.stream] = new window.MediaStream();
            }
            addTrackToStreamAndFireEvent(track, streams[remoteMsid.stream]);
            receiverList.push([track, rtpReceiver, streams[remoteMsid.stream]]);
          } else {
            if (!streams.default) {
              streams.default = new window.MediaStream();
            }
            addTrackToStreamAndFireEvent(track, streams.default);
            receiverList.push([track, rtpReceiver, streams.default]);
          }
        } else {
          // FIXME: actually the receiver should be created later.
          delete transceiver.rtpReceiver;
        }
      }
    });

    if (pc._dtlsRole === undefined) {
      pc._dtlsRole = description.type === 'offer' ? 'active' : 'passive';
    }

    pc._remoteDescription = {
      type: description.type,
      sdp: description.sdp
    };
    if (description.type === 'offer') {
      pc._updateSignalingState('have-remote-offer');
    } else {
      pc._updateSignalingState('stable');
    }
    Object.keys(streams).forEach(function(sid) {
      var stream = streams[sid];
      if (stream.getTracks().length) {
        if (pc.remoteStreams.indexOf(stream) === -1) {
          pc.remoteStreams.push(stream);
          var event = new Event('addstream');
          event.stream = stream;
          window.setTimeout(function() {
            pc._dispatchEvent('addstream', event);
          });
        }

        receiverList.forEach(function(item) {
          var track = item[0];
          var receiver = item[1];
          if (stream.id !== item[2].id) {
            return;
          }
          fireAddTrack(pc, track, receiver, [stream]);
        });
      }
    });
    receiverList.forEach(function(item) {
      if (item[2]) {
        return;
      }
      fireAddTrack(pc, item[0], item[1], []);
    });

    // check whether addIceCandidate({}) was called within four seconds after
    // setRemoteDescription.
    window.setTimeout(function() {
      if (!(pc && pc.transceivers)) {
        return;
      }
      pc.transceivers.forEach(function(transceiver) {
        if (transceiver.iceTransport &&
            transceiver.iceTransport.state === 'new' &&
            transceiver.iceTransport.getRemoteCandidates().length > 0) {
          console.warn('Timeout for addRemoteCandidate. Consider sending ' +
              'an end-of-candidates notification');
          transceiver.iceTransport.addRemoteCandidate({});
        }
      });
    }, 4000);

    return Promise.resolve();
  };

  RTCPeerConnection.prototype.close = function() {
    this.transceivers.forEach(function(transceiver) {
      /* not yet
      if (transceiver.iceGatherer) {
        transceiver.iceGatherer.close();
      }
      */
      if (transceiver.iceTransport) {
        transceiver.iceTransport.stop();
      }
      if (transceiver.dtlsTransport) {
        transceiver.dtlsTransport.stop();
      }
      if (transceiver.rtpSender) {
        transceiver.rtpSender.stop();
      }
      if (transceiver.rtpReceiver) {
        transceiver.rtpReceiver.stop();
      }
    });
    // FIXME: clean up tracks, local streams, remote streams, etc
    this._isClosed = true;
    this._updateSignalingState('closed');
  };

  // Update the signaling state.
  RTCPeerConnection.prototype._updateSignalingState = function(newState) {
    this.signalingState = newState;
    var event = new Event('signalingstatechange');
    this._dispatchEvent('signalingstatechange', event);
  };

  // Determine whether to fire the negotiationneeded event.
  RTCPeerConnection.prototype._maybeFireNegotiationNeeded = function() {
    var pc = this;
    if (this.signalingState !== 'stable' || this.needNegotiation === true) {
      return;
    }
    this.needNegotiation = true;
    window.setTimeout(function() {
      if (pc.needNegotiation) {
        pc.needNegotiation = false;
        var event = new Event('negotiationneeded');
        pc._dispatchEvent('negotiationneeded', event);
      }
    }, 0);
  };

  // Update the ice connection state.
  RTCPeerConnection.prototype._updateIceConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      checking: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this.transceivers.forEach(function(transceiver) {
      states[transceiver.iceTransport.state]++;
    });

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.checking > 0) {
      newState = 'checking';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    } else if (states.completed > 0) {
      newState = 'completed';
    }

    if (newState !== this.iceConnectionState) {
      this.iceConnectionState = newState;
      var event = new Event('iceconnectionstatechange');
      this._dispatchEvent('iceconnectionstatechange', event);
    }
  };

  // Update the connection state.
  RTCPeerConnection.prototype._updateConnectionState = function() {
    var newState;
    var states = {
      'new': 0,
      closed: 0,
      connecting: 0,
      connected: 0,
      completed: 0,
      disconnected: 0,
      failed: 0
    };
    this.transceivers.forEach(function(transceiver) {
      states[transceiver.iceTransport.state]++;
      states[transceiver.dtlsTransport.state]++;
    });
    // ICETransport.completed and connected are the same for this purpose.
    states.connected += states.completed;

    newState = 'new';
    if (states.failed > 0) {
      newState = 'failed';
    } else if (states.connecting > 0) {
      newState = 'connecting';
    } else if (states.disconnected > 0) {
      newState = 'disconnected';
    } else if (states.new > 0) {
      newState = 'new';
    } else if (states.connected > 0) {
      newState = 'connected';
    }

    if (newState !== this.connectionState) {
      this.connectionState = newState;
      var event = new Event('connectionstatechange');
      this._dispatchEvent('connectionstatechange', event);
    }
  };

  RTCPeerConnection.prototype.createOffer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createOffer after close'));
    }

    var numAudioTracks = pc.transceivers.filter(function(t) {
      return t.kind === 'audio';
    }).length;
    var numVideoTracks = pc.transceivers.filter(function(t) {
      return t.kind === 'video';
    }).length;

    // Determine number of audio and video tracks we need to send/recv.
    var offerOptions = arguments[0];
    if (offerOptions) {
      // Reject Chrome legacy constraints.
      if (offerOptions.mandatory || offerOptions.optional) {
        throw new TypeError(
            'Legacy mandatory/optional constraints not supported.');
      }
      if (offerOptions.offerToReceiveAudio !== undefined) {
        if (offerOptions.offerToReceiveAudio === true) {
          numAudioTracks = 1;
        } else if (offerOptions.offerToReceiveAudio === false) {
          numAudioTracks = 0;
        } else {
          numAudioTracks = offerOptions.offerToReceiveAudio;
        }
      }
      if (offerOptions.offerToReceiveVideo !== undefined) {
        if (offerOptions.offerToReceiveVideo === true) {
          numVideoTracks = 1;
        } else if (offerOptions.offerToReceiveVideo === false) {
          numVideoTracks = 0;
        } else {
          numVideoTracks = offerOptions.offerToReceiveVideo;
        }
      }
    }

    pc.transceivers.forEach(function(transceiver) {
      if (transceiver.kind === 'audio') {
        numAudioTracks--;
        if (numAudioTracks < 0) {
          transceiver.wantReceive = false;
        }
      } else if (transceiver.kind === 'video') {
        numVideoTracks--;
        if (numVideoTracks < 0) {
          transceiver.wantReceive = false;
        }
      }
    });

    // Create M-lines for recvonly streams.
    while (numAudioTracks > 0 || numVideoTracks > 0) {
      if (numAudioTracks > 0) {
        pc._createTransceiver('audio');
        numAudioTracks--;
      }
      if (numVideoTracks > 0) {
        pc._createTransceiver('video');
        numVideoTracks--;
      }
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
        pc._sdpSessionVersion++);
    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      // For each track, create an ice gatherer, ice transport,
      // dtls transport, potentially rtpsender and rtpreceiver.
      var track = transceiver.track;
      var kind = transceiver.kind;
      var mid = transceiver.mid || SDPUtils.generateIdentifier();
      transceiver.mid = mid;

      if (!transceiver.iceGatherer) {
        transceiver.iceGatherer = pc._createIceGatherer(sdpMLineIndex,
            pc.usingBundle);
      }

      var localCapabilities = window.RTCRtpSender.getCapabilities(kind);
      // filter RTX until additional stuff needed for RTX is implemented
      // in adapter.js
      if (edgeVersion < 15019) {
        localCapabilities.codecs = localCapabilities.codecs.filter(
            function(codec) {
              return codec.name !== 'rtx';
            });
      }
      localCapabilities.codecs.forEach(function(codec) {
        // work around https://bugs.chromium.org/p/webrtc/issues/detail?id=6552
        // by adding level-asymmetry-allowed=1
        if (codec.name === 'H264' &&
            codec.parameters['level-asymmetry-allowed'] === undefined) {
          codec.parameters['level-asymmetry-allowed'] = '1';
        }

        // for subsequent offers, we might have to re-use the payload
        // type of the last offer.
        if (transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.codecs) {
          transceiver.remoteCapabilities.codecs.forEach(function(remoteCodec) {
            if (codec.name.toLowerCase() === remoteCodec.name.toLowerCase() &&
                codec.clockRate === remoteCodec.clockRate) {
              codec.preferredPayloadType = remoteCodec.payloadType;
            }
          });
        }
      });
      localCapabilities.headerExtensions.forEach(function(hdrExt) {
        var remoteExtensions = transceiver.remoteCapabilities &&
            transceiver.remoteCapabilities.headerExtensions || [];
        remoteExtensions.forEach(function(rHdrExt) {
          if (hdrExt.uri === rHdrExt.uri) {
            hdrExt.id = rHdrExt.id;
          }
        });
      });

      // generate an ssrc now, to be used later in rtpSender.send
      var sendEncodingParameters = transceiver.sendEncodingParameters || [{
        ssrc: (2 * sdpMLineIndex + 1) * 1001
      }];
      if (track) {
        // add RTX
        if (edgeVersion >= 15019 && kind === 'video' &&
            !sendEncodingParameters[0].rtx) {
          sendEncodingParameters[0].rtx = {
            ssrc: sendEncodingParameters[0].ssrc + 1
          };
        }
      }

      if (transceiver.wantReceive) {
        transceiver.rtpReceiver = new window.RTCRtpReceiver(
            transceiver.dtlsTransport, kind);
      }

      transceiver.localCapabilities = localCapabilities;
      transceiver.sendEncodingParameters = sendEncodingParameters;
    });

    // always offer BUNDLE and dispose on return if not supported.
    if (pc._config.bundlePolicy !== 'max-compat') {
      sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    sdp += 'a=ice-options:trickle\r\n';

    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      sdp += writeMediaSection(transceiver, transceiver.localCapabilities,
          'offer', transceiver.stream, pc._dtlsRole);
      sdp += 'a=rtcp-rsize\r\n';

      if (transceiver.iceGatherer && pc.iceGatheringState !== 'new' &&
          (sdpMLineIndex === 0 || !pc.usingBundle)) {
        transceiver.iceGatherer.getLocalCandidates().forEach(function(cand) {
          cand.component = 1;
          sdp += 'a=' + SDPUtils.writeCandidate(cand) + '\r\n';
        });

        if (transceiver.iceGatherer.state === 'completed') {
          sdp += 'a=end-of-candidates\r\n';
        }
      }
    });

    var desc = new window.RTCSessionDescription({
      type: 'offer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.createAnswer = function() {
    var pc = this;

    if (pc._isClosed) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createAnswer after close'));
    }

    if (!(pc.signalingState === 'have-remote-offer' ||
        pc.signalingState === 'have-local-pranswer')) {
      return Promise.reject(makeError('InvalidStateError',
          'Can not call createAnswer in signalingState ' + pc.signalingState));
    }

    var sdp = SDPUtils.writeSessionBoilerplate(pc._sdpSessionId,
        pc._sdpSessionVersion++);
    if (pc.usingBundle) {
      sdp += 'a=group:BUNDLE ' + pc.transceivers.map(function(t) {
        return t.mid;
      }).join(' ') + '\r\n';
    }
    var mediaSectionsInOffer = SDPUtils.getMediaSections(
        pc._remoteDescription.sdp).length;
    pc.transceivers.forEach(function(transceiver, sdpMLineIndex) {
      if (sdpMLineIndex + 1 > mediaSectionsInOffer) {
        return;
      }
      if (transceiver.rejected) {
        if (transceiver.kind === 'application') {
          sdp += 'm=application 0 DTLS/SCTP 5000\r\n';
        } else if (transceiver.kind === 'audio') {
          sdp += 'm=audio 0 UDP/TLS/RTP/SAVPF 0\r\n' +
              'a=rtpmap:0 PCMU/8000\r\n';
        } else if (transceiver.kind === 'video') {
          sdp += 'm=video 0 UDP/TLS/RTP/SAVPF 120\r\n' +
              'a=rtpmap:120 VP8/90000\r\n';
        }
        sdp += 'c=IN IP4 0.0.0.0\r\n' +
            'a=inactive\r\n' +
            'a=mid:' + transceiver.mid + '\r\n';
        return;
      }

      // FIXME: look at direction.
      if (transceiver.stream) {
        var localTrack;
        if (transceiver.kind === 'audio') {
          localTrack = transceiver.stream.getAudioTracks()[0];
        } else if (transceiver.kind === 'video') {
          localTrack = transceiver.stream.getVideoTracks()[0];
        }
        if (localTrack) {
          // add RTX
          if (edgeVersion >= 15019 && transceiver.kind === 'video' &&
              !transceiver.sendEncodingParameters[0].rtx) {
            transceiver.sendEncodingParameters[0].rtx = {
              ssrc: transceiver.sendEncodingParameters[0].ssrc + 1
            };
          }
        }
      }

      // Calculate intersection of capabilities.
      var commonCapabilities = getCommonCapabilities(
          transceiver.localCapabilities,
          transceiver.remoteCapabilities);

      var hasRtx = commonCapabilities.codecs.filter(function(c) {
        return c.name.toLowerCase() === 'rtx';
      }).length;
      if (!hasRtx && transceiver.sendEncodingParameters[0].rtx) {
        delete transceiver.sendEncodingParameters[0].rtx;
      }

      sdp += writeMediaSection(transceiver, commonCapabilities,
          'answer', transceiver.stream, pc._dtlsRole);
      if (transceiver.rtcpParameters &&
          transceiver.rtcpParameters.reducedSize) {
        sdp += 'a=rtcp-rsize\r\n';
      }
    });

    var desc = new window.RTCSessionDescription({
      type: 'answer',
      sdp: sdp
    });
    return Promise.resolve(desc);
  };

  RTCPeerConnection.prototype.addIceCandidate = function(candidate) {
    var pc = this;
    var sections;
    if (candidate && !(candidate.sdpMLineIndex !== undefined ||
        candidate.sdpMid)) {
      return Promise.reject(new TypeError('sdpMLineIndex or sdpMid required'));
    }

    // TODO: needs to go into ops queue.
    return new Promise(function(resolve, reject) {
      if (!pc._remoteDescription) {
        return reject(makeError('InvalidStateError',
            'Can not add ICE candidate without a remote description'));
      } else if (!candidate || candidate.candidate === '') {
        for (var j = 0; j < pc.transceivers.length; j++) {
          if (pc.transceivers[j].rejected) {
            continue;
          }
          pc.transceivers[j].iceTransport.addRemoteCandidate({});
          sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
          sections[j] += 'a=end-of-candidates\r\n';
          pc._remoteDescription.sdp =
              SDPUtils.getDescription(pc._remoteDescription.sdp) +
              sections.join('');
          if (pc.usingBundle) {
            break;
          }
        }
      } else {
        var sdpMLineIndex = candidate.sdpMLineIndex;
        if (candidate.sdpMid) {
          for (var i = 0; i < pc.transceivers.length; i++) {
            if (pc.transceivers[i].mid === candidate.sdpMid) {
              sdpMLineIndex = i;
              break;
            }
          }
        }
        var transceiver = pc.transceivers[sdpMLineIndex];
        if (transceiver) {
          if (transceiver.rejected) {
            return resolve();
          }
          var cand = Object.keys(candidate.candidate).length > 0 ?
              SDPUtils.parseCandidate(candidate.candidate) : {};
          // Ignore Chrome's invalid candidates since Edge does not like them.
          if (cand.protocol === 'tcp' && (cand.port === 0 || cand.port === 9)) {
            return resolve();
          }
          // Ignore RTCP candidates, we assume RTCP-MUX.
          if (cand.component && cand.component !== 1) {
            return resolve();
          }
          // when using bundle, avoid adding candidates to the wrong
          // ice transport. And avoid adding candidates added in the SDP.
          if (sdpMLineIndex === 0 || (sdpMLineIndex > 0 &&
              transceiver.iceTransport !== pc.transceivers[0].iceTransport)) {
            if (!maybeAddCandidate(transceiver.iceTransport, cand)) {
              return reject(makeError('OperationError',
                  'Can not add ICE candidate'));
            }
          }

          // update the remoteDescription.
          var candidateString = candidate.candidate.trim();
          if (candidateString.indexOf('a=') === 0) {
            candidateString = candidateString.substr(2);
          }
          sections = SDPUtils.getMediaSections(pc._remoteDescription.sdp);
          sections[sdpMLineIndex] += 'a=' +
              (cand.type ? candidateString : 'end-of-candidates')
              + '\r\n';
          pc._remoteDescription.sdp =
              SDPUtils.getDescription(pc._remoteDescription.sdp) +
              sections.join('');
        } else {
          return reject(makeError('OperationError',
              'Can not add ICE candidate'));
        }
      }
      resolve();
    });
  };

  RTCPeerConnection.prototype.getStats = function(selector) {
    if (selector && selector instanceof window.MediaStreamTrack) {
      var senderOrReceiver = null;
      this.transceivers.forEach(function(transceiver) {
        if (transceiver.rtpSender &&
            transceiver.rtpSender.track === selector) {
          senderOrReceiver = transceiver.rtpSender;
        } else if (transceiver.rtpReceiver &&
            transceiver.rtpReceiver.track === selector) {
          senderOrReceiver = transceiver.rtpReceiver;
        }
      });
      if (!senderOrReceiver) {
        throw makeError('InvalidAccessError', 'Invalid selector.');
      }
      return senderOrReceiver.getStats();
    }

    var promises = [];
    this.transceivers.forEach(function(transceiver) {
      ['rtpSender', 'rtpReceiver', 'iceGatherer', 'iceTransport',
          'dtlsTransport'].forEach(function(method) {
            if (transceiver[method]) {
              promises.push(transceiver[method].getStats());
            }
          });
    });
    return Promise.all(promises).then(function(allStats) {
      var results = new Map();
      allStats.forEach(function(stats) {
        stats.forEach(function(stat) {
          results.set(stat.id, stat);
        });
      });
      return results;
    });
  };

  // fix low-level stat names and return Map instead of object.
  var ortcObjects = ['RTCRtpSender', 'RTCRtpReceiver', 'RTCIceGatherer',
    'RTCIceTransport', 'RTCDtlsTransport'];
  ortcObjects.forEach(function(ortcObjectName) {
    var obj = window[ortcObjectName];
    if (obj && obj.prototype && obj.prototype.getStats) {
      var nativeGetstats = obj.prototype.getStats;
      obj.prototype.getStats = function() {
        return nativeGetstats.apply(this)
        .then(function(nativeStats) {
          var mapStats = new Map();
          Object.keys(nativeStats).forEach(function(id) {
            nativeStats[id].type = fixStatsType(nativeStats[id]);
            mapStats.set(id, nativeStats[id]);
          });
          return mapStats;
        });
      };
    }
  });

  // legacy callback shims. Should be moved to adapter.js some days.
  var methods = ['createOffer', 'createAnswer'];
  methods.forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[0] === 'function' ||
          typeof args[1] === 'function') { // legacy
        return nativeMethod.apply(this, [arguments[2]])
        .then(function(description) {
          if (typeof args[0] === 'function') {
            args[0].apply(null, [description]);
          }
        }, function(error) {
          if (typeof args[1] === 'function') {
            args[1].apply(null, [error]);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  methods = ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate'];
  methods.forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[1] === 'function' ||
          typeof args[2] === 'function') { // legacy
        return nativeMethod.apply(this, arguments)
        .then(function() {
          if (typeof args[1] === 'function') {
            args[1].apply(null);
          }
        }, function(error) {
          if (typeof args[2] === 'function') {
            args[2].apply(null, [error]);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  // getStats is special. It doesn't have a spec legacy method yet we support
  // getStats(something, cb) without error callbacks.
  ['getStats'].forEach(function(method) {
    var nativeMethod = RTCPeerConnection.prototype[method];
    RTCPeerConnection.prototype[method] = function() {
      var args = arguments;
      if (typeof args[1] === 'function') {
        return nativeMethod.apply(this, arguments)
        .then(function() {
          if (typeof args[1] === 'function') {
            args[1].apply(null);
          }
        });
      }
      return nativeMethod.apply(this, arguments);
    };
  });

  return RTCPeerConnection;
};

},{"sdp":2}],2:[function(require,module,exports){
 /* eslint-env node */
'use strict';

// SDP helpers.
var SDPUtils = {};

// Generate an alphanumeric identifier for cname or mids.
// TODO: use UUIDs instead? https://gist.github.com/jed/982883
SDPUtils.generateIdentifier = function() {
  return Math.random().toString(36).substr(2, 10);
};

// The RTCP CNAME used by all peerconnections from the same JS.
SDPUtils.localCName = SDPUtils.generateIdentifier();

// Splits SDP into lines, dealing with both CRLF and LF.
SDPUtils.splitLines = function(blob) {
  return blob.trim().split('\n').map(function(line) {
    return line.trim();
  });
};
// Splits SDP into sessionpart and mediasections. Ensures CRLF.
SDPUtils.splitSections = function(blob) {
  var parts = blob.split('\nm=');
  return parts.map(function(part, index) {
    return (index > 0 ? 'm=' + part : part).trim() + '\r\n';
  });
};

// returns the session description.
SDPUtils.getDescription = function(blob) {
  var sections = SDPUtils.splitSections(blob);
  return sections && sections[0];
};

// returns the individual media sections.
SDPUtils.getMediaSections = function(blob) {
  var sections = SDPUtils.splitSections(blob);
  sections.shift();
  return sections;
};

// Returns lines that start with a certain prefix.
SDPUtils.matchPrefix = function(blob, prefix) {
  return SDPUtils.splitLines(blob).filter(function(line) {
    return line.indexOf(prefix) === 0;
  });
};

// Parses an ICE candidate line. Sample input:
// candidate:702786350 2 udp 41819902 8.8.8.8 60769 typ relay raddr 8.8.8.8
// rport 55996"
SDPUtils.parseCandidate = function(line) {
  var parts;
  // Parse both variants.
  if (line.indexOf('a=candidate:') === 0) {
    parts = line.substring(12).split(' ');
  } else {
    parts = line.substring(10).split(' ');
  }

  var candidate = {
    foundation: parts[0],
    component: parseInt(parts[1], 10),
    protocol: parts[2].toLowerCase(),
    priority: parseInt(parts[3], 10),
    ip: parts[4],
    port: parseInt(parts[5], 10),
    // skip parts[6] == 'typ'
    type: parts[7]
  };

  for (var i = 8; i < parts.length; i += 2) {
    switch (parts[i]) {
      case 'raddr':
        candidate.relatedAddress = parts[i + 1];
        break;
      case 'rport':
        candidate.relatedPort = parseInt(parts[i + 1], 10);
        break;
      case 'tcptype':
        candidate.tcpType = parts[i + 1];
        break;
      case 'ufrag':
        candidate.ufrag = parts[i + 1]; // for backward compability.
        candidate.usernameFragment = parts[i + 1];
        break;
      default: // extension handling, in particular ufrag
        candidate[parts[i]] = parts[i + 1];
        break;
    }
  }
  return candidate;
};

// Translates a candidate object into SDP candidate attribute.
SDPUtils.writeCandidate = function(candidate) {
  var sdp = [];
  sdp.push(candidate.foundation);
  sdp.push(candidate.component);
  sdp.push(candidate.protocol.toUpperCase());
  sdp.push(candidate.priority);
  sdp.push(candidate.ip);
  sdp.push(candidate.port);

  var type = candidate.type;
  sdp.push('typ');
  sdp.push(type);
  if (type !== 'host' && candidate.relatedAddress &&
      candidate.relatedPort) {
    sdp.push('raddr');
    sdp.push(candidate.relatedAddress);
    sdp.push('rport');
    sdp.push(candidate.relatedPort);
  }
  if (candidate.tcpType && candidate.protocol.toLowerCase() === 'tcp') {
    sdp.push('tcptype');
    sdp.push(candidate.tcpType);
  }
  if (candidate.usernameFragment || candidate.ufrag) {
    sdp.push('ufrag');
    sdp.push(candidate.usernameFragment || candidate.ufrag);
  }
  return 'candidate:' + sdp.join(' ');
};

// Parses an ice-options line, returns an array of option tags.
// a=ice-options:foo bar
SDPUtils.parseIceOptions = function(line) {
  return line.substr(14).split(' ');
}

// Parses an rtpmap line, returns RTCRtpCoddecParameters. Sample input:
// a=rtpmap:111 opus/48000/2
SDPUtils.parseRtpMap = function(line) {
  var parts = line.substr(9).split(' ');
  var parsed = {
    payloadType: parseInt(parts.shift(), 10) // was: id
  };

  parts = parts[0].split('/');

  parsed.name = parts[0];
  parsed.clockRate = parseInt(parts[1], 10); // was: clockrate
  parsed.channels = parts.length === 3 ? parseInt(parts[2], 10) : 1;
  // legacy alias, got renamed back to channels in ORTC.
  parsed.numChannels = parsed.channels;
  return parsed;
};

// Generate an a=rtpmap line from RTCRtpCodecCapability or
// RTCRtpCodecParameters.
SDPUtils.writeRtpMap = function(codec) {
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  var channels = codec.channels || codec.numChannels || 1;
  return 'a=rtpmap:' + pt + ' ' + codec.name + '/' + codec.clockRate +
      (channels !== 1 ? '/' + channels : '') + '\r\n';
};

// Parses an a=extmap line (headerextension from RFC 5285). Sample input:
// a=extmap:2 urn:ietf:params:rtp-hdrext:toffset
// a=extmap:2/sendonly urn:ietf:params:rtp-hdrext:toffset
SDPUtils.parseExtmap = function(line) {
  var parts = line.substr(9).split(' ');
  return {
    id: parseInt(parts[0], 10),
    direction: parts[0].indexOf('/') > 0 ? parts[0].split('/')[1] : 'sendrecv',
    uri: parts[1]
  };
};

// Generates a=extmap line from RTCRtpHeaderExtensionParameters or
// RTCRtpHeaderExtension.
SDPUtils.writeExtmap = function(headerExtension) {
  return 'a=extmap:' + (headerExtension.id || headerExtension.preferredId) +
      (headerExtension.direction && headerExtension.direction !== 'sendrecv'
          ? '/' + headerExtension.direction
          : '') +
      ' ' + headerExtension.uri + '\r\n';
};

// Parses an ftmp line, returns dictionary. Sample input:
// a=fmtp:96 vbr=on;cng=on
// Also deals with vbr=on; cng=on
SDPUtils.parseFmtp = function(line) {
  var parsed = {};
  var kv;
  var parts = line.substr(line.indexOf(' ') + 1).split(';');
  for (var j = 0; j < parts.length; j++) {
    kv = parts[j].trim().split('=');
    parsed[kv[0].trim()] = kv[1];
  }
  return parsed;
};

// Generates an a=ftmp line from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeFmtp = function(codec) {
  var line = '';
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.parameters && Object.keys(codec.parameters).length) {
    var params = [];
    Object.keys(codec.parameters).forEach(function(param) {
      if (codec.parameters[param]) {
        params.push(param + '=' + codec.parameters[param]);
      } else {
        params.push(param);
      }
    });
    line += 'a=fmtp:' + pt + ' ' + params.join(';') + '\r\n';
  }
  return line;
};

// Parses an rtcp-fb line, returns RTCPRtcpFeedback object. Sample input:
// a=rtcp-fb:98 nack rpsi
SDPUtils.parseRtcpFb = function(line) {
  var parts = line.substr(line.indexOf(' ') + 1).split(' ');
  return {
    type: parts.shift(),
    parameter: parts.join(' ')
  };
};
// Generate a=rtcp-fb lines from RTCRtpCodecCapability or RTCRtpCodecParameters.
SDPUtils.writeRtcpFb = function(codec) {
  var lines = '';
  var pt = codec.payloadType;
  if (codec.preferredPayloadType !== undefined) {
    pt = codec.preferredPayloadType;
  }
  if (codec.rtcpFeedback && codec.rtcpFeedback.length) {
    // FIXME: special handling for trr-int?
    codec.rtcpFeedback.forEach(function(fb) {
      lines += 'a=rtcp-fb:' + pt + ' ' + fb.type +
      (fb.parameter && fb.parameter.length ? ' ' + fb.parameter : '') +
          '\r\n';
    });
  }
  return lines;
};

// Parses an RFC 5576 ssrc media attribute. Sample input:
// a=ssrc:3735928559 cname:something
SDPUtils.parseSsrcMedia = function(line) {
  var sp = line.indexOf(' ');
  var parts = {
    ssrc: parseInt(line.substr(7, sp - 7), 10)
  };
  var colon = line.indexOf(':', sp);
  if (colon > -1) {
    parts.attribute = line.substr(sp + 1, colon - sp - 1);
    parts.value = line.substr(colon + 1);
  } else {
    parts.attribute = line.substr(sp + 1);
  }
  return parts;
};

// Extracts the MID (RFC 5888) from a media section.
// returns the MID or undefined if no mid line was found.
SDPUtils.getMid = function(mediaSection) {
  var mid = SDPUtils.matchPrefix(mediaSection, 'a=mid:')[0];
  if (mid) {
    return mid.substr(6);
  }
}

SDPUtils.parseFingerprint = function(line) {
  var parts = line.substr(14).split(' ');
  return {
    algorithm: parts[0].toLowerCase(), // algorithm is case-sensitive in Edge.
    value: parts[1]
  };
};

// Extracts DTLS parameters from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the fingerprint line as input. See also getIceParameters.
SDPUtils.getDtlsParameters = function(mediaSection, sessionpart) {
  var lines = SDPUtils.matchPrefix(mediaSection + sessionpart,
      'a=fingerprint:');
  // Note: a=setup line is ignored since we use the 'auto' role.
  // Note2: 'algorithm' is not case sensitive except in Edge.
  return {
    role: 'auto',
    fingerprints: lines.map(SDPUtils.parseFingerprint)
  };
};

// Serializes DTLS parameters to SDP.
SDPUtils.writeDtlsParameters = function(params, setupType) {
  var sdp = 'a=setup:' + setupType + '\r\n';
  params.fingerprints.forEach(function(fp) {
    sdp += 'a=fingerprint:' + fp.algorithm + ' ' + fp.value + '\r\n';
  });
  return sdp;
};
// Parses ICE information from SDP media section or sessionpart.
// FIXME: for consistency with other functions this should only
//   get the ice-ufrag and ice-pwd lines as input.
SDPUtils.getIceParameters = function(mediaSection, sessionpart) {
  var lines = SDPUtils.splitLines(mediaSection);
  // Search in session part, too.
  lines = lines.concat(SDPUtils.splitLines(sessionpart));
  var iceParameters = {
    usernameFragment: lines.filter(function(line) {
      return line.indexOf('a=ice-ufrag:') === 0;
    })[0].substr(12),
    password: lines.filter(function(line) {
      return line.indexOf('a=ice-pwd:') === 0;
    })[0].substr(10)
  };
  return iceParameters;
};

// Serializes ICE parameters to SDP.
SDPUtils.writeIceParameters = function(params) {
  return 'a=ice-ufrag:' + params.usernameFragment + '\r\n' +
      'a=ice-pwd:' + params.password + '\r\n';
};

// Parses the SDP media section and returns RTCRtpParameters.
SDPUtils.parseRtpParameters = function(mediaSection) {
  var description = {
    codecs: [],
    headerExtensions: [],
    fecMechanisms: [],
    rtcp: []
  };
  var lines = SDPUtils.splitLines(mediaSection);
  var mline = lines[0].split(' ');
  for (var i = 3; i < mline.length; i++) { // find all codecs from mline[3..]
    var pt = mline[i];
    var rtpmapline = SDPUtils.matchPrefix(
        mediaSection, 'a=rtpmap:' + pt + ' ')[0];
    if (rtpmapline) {
      var codec = SDPUtils.parseRtpMap(rtpmapline);
      var fmtps = SDPUtils.matchPrefix(
          mediaSection, 'a=fmtp:' + pt + ' ');
      // Only the first a=fmtp:<pt> is considered.
      codec.parameters = fmtps.length ? SDPUtils.parseFmtp(fmtps[0]) : {};
      codec.rtcpFeedback = SDPUtils.matchPrefix(
          mediaSection, 'a=rtcp-fb:' + pt + ' ')
        .map(SDPUtils.parseRtcpFb);
      description.codecs.push(codec);
      // parse FEC mechanisms from rtpmap lines.
      switch (codec.name.toUpperCase()) {
        case 'RED':
        case 'ULPFEC':
          description.fecMechanisms.push(codec.name.toUpperCase());
          break;
        default: // only RED and ULPFEC are recognized as FEC mechanisms.
          break;
      }
    }
  }
  SDPUtils.matchPrefix(mediaSection, 'a=extmap:').forEach(function(line) {
    description.headerExtensions.push(SDPUtils.parseExtmap(line));
  });
  // FIXME: parse rtcp.
  return description;
};

// Generates parts of the SDP media section describing the capabilities /
// parameters.
SDPUtils.writeRtpDescription = function(kind, caps) {
  var sdp = '';

  // Build the mline.
  sdp += 'm=' + kind + ' ';
  sdp += caps.codecs.length > 0 ? '9' : '0'; // reject if no codecs.
  sdp += ' UDP/TLS/RTP/SAVPF ';
  sdp += caps.codecs.map(function(codec) {
    if (codec.preferredPayloadType !== undefined) {
      return codec.preferredPayloadType;
    }
    return codec.payloadType;
  }).join(' ') + '\r\n';

  sdp += 'c=IN IP4 0.0.0.0\r\n';
  sdp += 'a=rtcp:9 IN IP4 0.0.0.0\r\n';

  // Add a=rtpmap lines for each codec. Also fmtp and rtcp-fb.
  caps.codecs.forEach(function(codec) {
    sdp += SDPUtils.writeRtpMap(codec);
    sdp += SDPUtils.writeFmtp(codec);
    sdp += SDPUtils.writeRtcpFb(codec);
  });
  var maxptime = 0;
  caps.codecs.forEach(function(codec) {
    if (codec.maxptime > maxptime) {
      maxptime = codec.maxptime;
    }
  });
  if (maxptime > 0) {
    sdp += 'a=maxptime:' + maxptime + '\r\n';
  }
  sdp += 'a=rtcp-mux\r\n';

  if (caps.headerExtensions) {
    caps.headerExtensions.forEach(function(extension) {
      sdp += SDPUtils.writeExtmap(extension);
    });
  }
  // FIXME: write fecMechanisms.
  return sdp;
};

// Parses the SDP media section and returns an array of
// RTCRtpEncodingParameters.
SDPUtils.parseRtpEncodingParameters = function(mediaSection) {
  var encodingParameters = [];
  var description = SDPUtils.parseRtpParameters(mediaSection);
  var hasRed = description.fecMechanisms.indexOf('RED') !== -1;
  var hasUlpfec = description.fecMechanisms.indexOf('ULPFEC') !== -1;

  // filter a=ssrc:... cname:, ignore PlanB-msid
  var ssrcs = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
  .map(function(line) {
    return SDPUtils.parseSsrcMedia(line);
  })
  .filter(function(parts) {
    return parts.attribute === 'cname';
  });
  var primarySsrc = ssrcs.length > 0 && ssrcs[0].ssrc;
  var secondarySsrc;

  var flows = SDPUtils.matchPrefix(mediaSection, 'a=ssrc-group:FID')
  .map(function(line) {
    var parts = line.substr(17).split(' ');
    return parts.map(function(part) {
      return parseInt(part, 10);
    });
  });
  if (flows.length > 0 && flows[0].length > 1 && flows[0][0] === primarySsrc) {
    secondarySsrc = flows[0][1];
  }

  description.codecs.forEach(function(codec) {
    if (codec.name.toUpperCase() === 'RTX' && codec.parameters.apt) {
      var encParam = {
        ssrc: primarySsrc,
        codecPayloadType: parseInt(codec.parameters.apt, 10),
      };
      if (primarySsrc && secondarySsrc) {
        encParam.rtx = {ssrc: secondarySsrc};
      }
      encodingParameters.push(encParam);
      if (hasRed) {
        encParam = JSON.parse(JSON.stringify(encParam));
        encParam.fec = {
          ssrc: secondarySsrc,
          mechanism: hasUlpfec ? 'red+ulpfec' : 'red'
        };
        encodingParameters.push(encParam);
      }
    }
  });
  if (encodingParameters.length === 0 && primarySsrc) {
    encodingParameters.push({
      ssrc: primarySsrc
    });
  }

  // we support both b=AS and b=TIAS but interpret AS as TIAS.
  var bandwidth = SDPUtils.matchPrefix(mediaSection, 'b=');
  if (bandwidth.length) {
    if (bandwidth[0].indexOf('b=TIAS:') === 0) {
      bandwidth = parseInt(bandwidth[0].substr(7), 10);
    } else if (bandwidth[0].indexOf('b=AS:') === 0) {
      // use formula from JSEP to convert b=AS to TIAS value.
      bandwidth = parseInt(bandwidth[0].substr(5), 10) * 1000 * 0.95
          - (50 * 40 * 8);
    } else {
      bandwidth = undefined;
    }
    encodingParameters.forEach(function(params) {
      params.maxBitrate = bandwidth;
    });
  }
  return encodingParameters;
};

// parses http://draft.ortc.org/#rtcrtcpparameters*
SDPUtils.parseRtcpParameters = function(mediaSection) {
  var rtcpParameters = {};

  var cname;
  // Gets the first SSRC. Note that with RTX there might be multiple
  // SSRCs.
  var remoteSsrc = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
      .map(function(line) {
        return SDPUtils.parseSsrcMedia(line);
      })
      .filter(function(obj) {
        return obj.attribute === 'cname';
      })[0];
  if (remoteSsrc) {
    rtcpParameters.cname = remoteSsrc.value;
    rtcpParameters.ssrc = remoteSsrc.ssrc;
  }

  // Edge uses the compound attribute instead of reducedSize
  // compound is !reducedSize
  var rsize = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-rsize');
  rtcpParameters.reducedSize = rsize.length > 0;
  rtcpParameters.compound = rsize.length === 0;

  // parses the rtcp-mux attrіbute.
  // Note that Edge does not support unmuxed RTCP.
  var mux = SDPUtils.matchPrefix(mediaSection, 'a=rtcp-mux');
  rtcpParameters.mux = mux.length > 0;

  return rtcpParameters;
};

// parses either a=msid: or a=ssrc:... msid lines and returns
// the id of the MediaStream and MediaStreamTrack.
SDPUtils.parseMsid = function(mediaSection) {
  var parts;
  var spec = SDPUtils.matchPrefix(mediaSection, 'a=msid:');
  if (spec.length === 1) {
    parts = spec[0].substr(7).split(' ');
    return {stream: parts[0], track: parts[1]};
  }
  var planB = SDPUtils.matchPrefix(mediaSection, 'a=ssrc:')
  .map(function(line) {
    return SDPUtils.parseSsrcMedia(line);
  })
  .filter(function(parts) {
    return parts.attribute === 'msid';
  });
  if (planB.length > 0) {
    parts = planB[0].value.split(' ');
    return {stream: parts[0], track: parts[1]};
  }
};

// Generate a session ID for SDP.
// https://tools.ietf.org/html/draft-ietf-rtcweb-jsep-20#section-5.2.1
// recommends using a cryptographically random +ve 64-bit value
// but right now this should be acceptable and within the right range
SDPUtils.generateSessionId = function() {
  return Math.random().toString().substr(2, 21);
};

// Write boilder plate for start of SDP
// sessId argument is optional - if not supplied it will
// be generated randomly
// sessVersion is optional and defaults to 2
SDPUtils.writeSessionBoilerplate = function(sessId, sessVer) {
  var sessionId;
  var version = sessVer !== undefined ? sessVer : 2;
  if (sessId) {
    sessionId = sessId;
  } else {
    sessionId = SDPUtils.generateSessionId();
  }
  // FIXME: sess-id should be an NTP timestamp.
  return 'v=0\r\n' +
      'o=thisisadapterortc ' + sessionId + ' ' + version + ' IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n';
};

SDPUtils.writeMediaSection = function(transceiver, caps, type, stream) {
  var sdp = SDPUtils.writeRtpDescription(transceiver.kind, caps);

  // Map ICE parameters (ufrag, pwd) to SDP.
  sdp += SDPUtils.writeIceParameters(
      transceiver.iceGatherer.getLocalParameters());

  // Map DTLS parameters to SDP.
  sdp += SDPUtils.writeDtlsParameters(
      transceiver.dtlsTransport.getLocalParameters(),
      type === 'offer' ? 'actpass' : 'active');

  sdp += 'a=mid:' + transceiver.mid + '\r\n';

  if (transceiver.direction) {
    sdp += 'a=' + transceiver.direction + '\r\n';
  } else if (transceiver.rtpSender && transceiver.rtpReceiver) {
    sdp += 'a=sendrecv\r\n';
  } else if (transceiver.rtpSender) {
    sdp += 'a=sendonly\r\n';
  } else if (transceiver.rtpReceiver) {
    sdp += 'a=recvonly\r\n';
  } else {
    sdp += 'a=inactive\r\n';
  }

  if (transceiver.rtpSender) {
    // spec.
    var msid = 'msid:' + stream.id + ' ' +
        transceiver.rtpSender.track.id + '\r\n';
    sdp += 'a=' + msid;

    // for Chrome.
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
        ' ' + msid;
    if (transceiver.sendEncodingParameters[0].rtx) {
      sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
          ' ' + msid;
      sdp += 'a=ssrc-group:FID ' +
          transceiver.sendEncodingParameters[0].ssrc + ' ' +
          transceiver.sendEncodingParameters[0].rtx.ssrc +
          '\r\n';
    }
  }
  // FIXME: this should be written by writeRtpDescription.
  sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].ssrc +
      ' cname:' + SDPUtils.localCName + '\r\n';
  if (transceiver.rtpSender && transceiver.sendEncodingParameters[0].rtx) {
    sdp += 'a=ssrc:' + transceiver.sendEncodingParameters[0].rtx.ssrc +
        ' cname:' + SDPUtils.localCName + '\r\n';
  }
  return sdp;
};

// Gets the direction from the mediaSection or the sessionpart.
SDPUtils.getDirection = function(mediaSection, sessionpart) {
  // Look for sendrecv, sendonly, recvonly, inactive, default to sendrecv.
  var lines = SDPUtils.splitLines(mediaSection);
  for (var i = 0; i < lines.length; i++) {
    switch (lines[i]) {
      case 'a=sendrecv':
      case 'a=sendonly':
      case 'a=recvonly':
      case 'a=inactive':
        return lines[i].substr(2);
      default:
        // FIXME: What should happen here?
    }
  }
  if (sessionpart) {
    return SDPUtils.getDirection(sessionpart);
  }
  return 'sendrecv';
};

SDPUtils.getKind = function(mediaSection) {
  var lines = SDPUtils.splitLines(mediaSection);
  var mline = lines[0].split(' ');
  return mline[0].substr(2);
};

SDPUtils.isRejected = function(mediaSection) {
  return mediaSection.split(' ', 2)[1] === '0';
};

SDPUtils.parseMLine = function(mediaSection) {
  var lines = SDPUtils.splitLines(mediaSection);
  var parts = lines[0].substr(2).split(' ');
  return {
    kind: parts[0],
    port: parseInt(parts[1], 10),
    protocol: parts[2],
    fmt: parts.slice(3).join(' ')
  };
};

SDPUtils.parseOLine = function(mediaSection) {
  var line = SDPUtils.matchPrefix(mediaSection, 'o=')[0];
  var parts = line.substr(2).split(' ');
  return {
    username: parts[0],
    sessionId: parts[1],
    sessionVersion: parseInt(parts[2], 10),
    netType: parts[3],
    addressType: parts[4],
    address: parts[5],
  };
}

// Expose public methods.
if (typeof module === 'object') {
  module.exports = SDPUtils;
}

},{}],3:[function(require,module,exports){
(function (global){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */

'use strict';

var adapterFactory = require('./adapter_factory.js');
module.exports = adapterFactory({window: global.window});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./adapter_factory.js":4}],4:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */

'use strict';

var utils = require('./utils');
// Shimming starts here.
module.exports = function(dependencies, opts) {
  var window = dependencies && dependencies.window;

  var options = {
    shimChrome: true,
    shimFirefox: true,
    shimEdge: true,
    shimSafari: true,
  };

  for (var key in opts) {
    if (hasOwnProperty.call(opts, key)) {
      options[key] = opts[key];
    }
  }

  // Utils.
  var logging = utils.log;
  var browserDetails = utils.detectBrowser(window);

  // Uncomment the line below if you want logging to occur, including logging
  // for the switch statement below. Can also be turned on in the browser via
  // adapter.disableLog(false), but then logging from the switch statement below
  // will not appear.
  // require('./utils').disableLog(false);

  // Browser shims.
  var chromeShim = require('./chrome/chrome_shim') || null;
  var edgeShim = require('./edge/edge_shim') || null;
  var firefoxShim = require('./firefox/firefox_shim') || null;
  var safariShim = require('./safari/safari_shim') || null;
  var commonShim = require('./common_shim') || null;

  // Export to the adapter global object visible in the browser.
  var adapter = {
    browserDetails: browserDetails,
    commonShim: commonShim,
    extractVersion: utils.extractVersion,
    disableLog: utils.disableLog,
    disableWarnings: utils.disableWarnings
  };

  // Shim browser if found.
  switch (browserDetails.browser) {
    case 'chrome':
      if (!chromeShim || !chromeShim.shimPeerConnection ||
          !options.shimChrome) {
        logging('Chrome shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming chrome.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = chromeShim;
      commonShim.shimCreateObjectURL(window);

      chromeShim.shimGetUserMedia(window);
      chromeShim.shimMediaStream(window);
      chromeShim.shimSourceObject(window);
      chromeShim.shimPeerConnection(window);
      chromeShim.shimOnTrack(window);
      chromeShim.shimAddTrackRemoveTrack(window);
      chromeShim.shimGetSendersWithDtmf(window);
      chromeShim.shimSenderReceiverGetStats(window);

      commonShim.shimRTCIceCandidate(window);
      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    case 'firefox':
      if (!firefoxShim || !firefoxShim.shimPeerConnection ||
          !options.shimFirefox) {
        logging('Firefox shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming firefox.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = firefoxShim;
      commonShim.shimCreateObjectURL(window);

      firefoxShim.shimGetUserMedia(window);
      firefoxShim.shimSourceObject(window);
      firefoxShim.shimPeerConnection(window);
      firefoxShim.shimOnTrack(window);
      firefoxShim.shimRemoveStream(window);
      firefoxShim.shimSenderGetStats(window);
      firefoxShim.shimReceiverGetStats(window);
      firefoxShim.shimRTCDataChannel(window);

      commonShim.shimRTCIceCandidate(window);
      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    case 'edge':
      if (!edgeShim || !edgeShim.shimPeerConnection || !options.shimEdge) {
        logging('MS edge shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming edge.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = edgeShim;
      commonShim.shimCreateObjectURL(window);

      edgeShim.shimGetUserMedia(window);
      edgeShim.shimPeerConnection(window);
      edgeShim.shimReplaceTrack(window);

      // the edge shim implements the full RTCIceCandidate object.

      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    case 'safari':
      if (!safariShim || !options.shimSafari) {
        logging('Safari shim is not included in this adapter release.');
        return adapter;
      }
      logging('adapter.js shimming safari.');
      // Export to the adapter global object visible in the browser.
      adapter.browserShim = safariShim;
      commonShim.shimCreateObjectURL(window);

      safariShim.shimRTCIceServerUrls(window);
      safariShim.shimCallbacksAPI(window);
      safariShim.shimLocalStreamsAPI(window);
      safariShim.shimRemoteStreamsAPI(window);
      safariShim.shimTrackEventTransceiver(window);
      safariShim.shimGetUserMedia(window);
      safariShim.shimCreateOfferLegacy(window);

      commonShim.shimRTCIceCandidate(window);
      commonShim.shimMaxMessageSize(window);
      commonShim.shimSendThrowTypeError(window);
      break;
    default:
      logging('Unsupported browser!');
      break;
  }

  return adapter;
};

},{"./chrome/chrome_shim":5,"./common_shim":7,"./edge/edge_shim":8,"./firefox/firefox_shim":11,"./safari/safari_shim":13,"./utils":14}],5:[function(require,module,exports){

/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';
var utils = require('../utils.js');
var logging = utils.log;

/* iterates the stats graph recursively. */
function walkStats(stats, base, resultSet) {
  if (!base || resultSet.has(base.id)) {
    return;
  }
  resultSet.set(base.id, base);
  Object.keys(base).forEach(function(name) {
    if (name.endsWith('Id')) {
      walkStats(stats, stats.get(base[name]), resultSet);
    } else if (name.endsWith('Ids')) {
      base[name].forEach(function(id) {
        walkStats(stats, stats.get(id), resultSet);
      });
    }
  });
}

/* filter getStats for a sender/receiver track. */
function filterStats(result, track, outbound) {
  var streamStatsType = outbound ? 'outbound-rtp' : 'inbound-rtp';
  var filteredResult = new Map();
  if (track === null) {
    return filteredResult;
  }
  var trackStats = [];
  result.forEach(function(value) {
    if (value.type === 'track' &&
        value.trackIdentifier === track.id) {
      trackStats.push(value);
    }
  });
  trackStats.forEach(function(trackStat) {
    result.forEach(function(stats) {
      if (stats.type === streamStatsType && stats.trackId === trackStat.id) {
        walkStats(result, stats, filteredResult);
      }
    });
  });
  return filteredResult;
}

module.exports = {
  shimGetUserMedia: require('./getusermedia'),
  shimMediaStream: function(window) {
    window.MediaStream = window.MediaStream || window.webkitMediaStream;
  },

  shimOnTrack: function(window) {
    if (typeof window === 'object' && window.RTCPeerConnection && !('ontrack' in
        window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'ontrack', {
        get: function() {
          return this._ontrack;
        },
        set: function(f) {
          if (this._ontrack) {
            this.removeEventListener('track', this._ontrack);
          }
          this.addEventListener('track', this._ontrack = f);
        }
      });
      var origSetRemoteDescription =
          window.RTCPeerConnection.prototype.setRemoteDescription;
      window.RTCPeerConnection.prototype.setRemoteDescription = function() {
        var pc = this;
        if (!pc._ontrackpoly) {
          pc._ontrackpoly = function(e) {
            // onaddstream does not fire when a track is added to an existing
            // stream. But stream.onaddtrack is implemented so we use that.
            e.stream.addEventListener('addtrack', function(te) {
              var receiver;
              if (window.RTCPeerConnection.prototype.getReceivers) {
                receiver = pc.getReceivers().find(function(r) {
                  return r.track && r.track.id === te.track.id;
                });
              } else {
                receiver = {track: te.track};
              }

              var event = new Event('track');
              event.track = te.track;
              event.receiver = receiver;
              event.transceiver = {receiver: receiver};
              event.streams = [e.stream];
              pc.dispatchEvent(event);
            });
            e.stream.getTracks().forEach(function(track) {
              var receiver;
              if (window.RTCPeerConnection.prototype.getReceivers) {
                receiver = pc.getReceivers().find(function(r) {
                  return r.track && r.track.id === track.id;
                });
              } else {
                receiver = {track: track};
              }
              var event = new Event('track');
              event.track = track;
              event.receiver = receiver;
              event.transceiver = {receiver: receiver};
              event.streams = [e.stream];
              pc.dispatchEvent(event);
            });
          };
          pc.addEventListener('addstream', pc._ontrackpoly);
        }
        return origSetRemoteDescription.apply(pc, arguments);
      };
    } else if (!('RTCRtpTransceiver' in window)) {
      utils.wrapPeerConnectionEvent(window, 'track', function(e) {
        if (!e.transceiver) {
          e.transceiver = {receiver: e.receiver};
        }
        return e;
      });
    }
  },

  shimGetSendersWithDtmf: function(window) {
    // Overrides addTrack/removeTrack, depends on shimAddTrackRemoveTrack.
    if (typeof window === 'object' && window.RTCPeerConnection &&
        !('getSenders' in window.RTCPeerConnection.prototype) &&
        'createDTMFSender' in window.RTCPeerConnection.prototype) {
      var shimSenderWithDtmf = function(pc, track) {
        return {
          track: track,
          get dtmf() {
            if (this._dtmf === undefined) {
              if (track.kind === 'audio') {
                this._dtmf = pc.createDTMFSender(track);
              } else {
                this._dtmf = null;
              }
            }
            return this._dtmf;
          },
          _pc: pc
        };
      };

      // augment addTrack when getSenders is not available.
      if (!window.RTCPeerConnection.prototype.getSenders) {
        window.RTCPeerConnection.prototype.getSenders = function() {
          this._senders = this._senders || [];
          return this._senders.slice(); // return a copy of the internal state.
        };
        var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
        window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
          var pc = this;
          var sender = origAddTrack.apply(pc, arguments);
          if (!sender) {
            sender = shimSenderWithDtmf(pc, track);
            pc._senders.push(sender);
          }
          return sender;
        };

        var origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
        window.RTCPeerConnection.prototype.removeTrack = function(sender) {
          var pc = this;
          origRemoveTrack.apply(pc, arguments);
          var idx = pc._senders.indexOf(sender);
          if (idx !== -1) {
            pc._senders.splice(idx, 1);
          }
        };
      }
      var origAddStream = window.RTCPeerConnection.prototype.addStream;
      window.RTCPeerConnection.prototype.addStream = function(stream) {
        var pc = this;
        pc._senders = pc._senders || [];
        origAddStream.apply(pc, [stream]);
        stream.getTracks().forEach(function(track) {
          pc._senders.push(shimSenderWithDtmf(pc, track));
        });
      };

      var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
      window.RTCPeerConnection.prototype.removeStream = function(stream) {
        var pc = this;
        pc._senders = pc._senders || [];
        origRemoveStream.apply(pc, [stream]);

        stream.getTracks().forEach(function(track) {
          var sender = pc._senders.find(function(s) {
            return s.track === track;
          });
          if (sender) {
            pc._senders.splice(pc._senders.indexOf(sender), 1); // remove sender
          }
        });
      };
    } else if (typeof window === 'object' && window.RTCPeerConnection &&
               'getSenders' in window.RTCPeerConnection.prototype &&
               'createDTMFSender' in window.RTCPeerConnection.prototype &&
               window.RTCRtpSender &&
               !('dtmf' in window.RTCRtpSender.prototype)) {
      var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
      window.RTCPeerConnection.prototype.getSenders = function() {
        var pc = this;
        var senders = origGetSenders.apply(pc, []);
        senders.forEach(function(sender) {
          sender._pc = pc;
        });
        return senders;
      };

      Object.defineProperty(window.RTCRtpSender.prototype, 'dtmf', {
        get: function() {
          if (this._dtmf === undefined) {
            if (this.track.kind === 'audio') {
              this._dtmf = this._pc.createDTMFSender(this.track);
            } else {
              this._dtmf = null;
            }
          }
          return this._dtmf;
        }
      });
    }
  },

  shimSenderReceiverGetStats: function(window) {
    if (!(typeof window === 'object' && window.RTCPeerConnection &&
        window.RTCRtpSender && window.RTCRtpReceiver)) {
      return;
    }

    // shim sender stats.
    if (!('getStats' in window.RTCRtpSender.prototype)) {
      var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
      if (origGetSenders) {
        window.RTCPeerConnection.prototype.getSenders = function() {
          var pc = this;
          var senders = origGetSenders.apply(pc, []);
          senders.forEach(function(sender) {
            sender._pc = pc;
          });
          return senders;
        };
      }

      var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
      if (origAddTrack) {
        window.RTCPeerConnection.prototype.addTrack = function() {
          var sender = origAddTrack.apply(this, arguments);
          sender._pc = this;
          return sender;
        };
      }
      window.RTCRtpSender.prototype.getStats = function() {
        var sender = this;
        return this._pc.getStats().then(function(result) {
          /* Note: this will include stats of all senders that
           *   send a track with the same id as sender.track as
           *   it is not possible to identify the RTCRtpSender.
           */
          return filterStats(result, sender.track, true);
        });
      };
    }

    // shim receiver stats.
    if (!('getStats' in window.RTCRtpReceiver.prototype)) {
      var origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
      if (origGetReceivers) {
        window.RTCPeerConnection.prototype.getReceivers = function() {
          var pc = this;
          var receivers = origGetReceivers.apply(pc, []);
          receivers.forEach(function(receiver) {
            receiver._pc = pc;
          });
          return receivers;
        };
      }
      utils.wrapPeerConnectionEvent(window, 'track', function(e) {
        e.receiver._pc = e.srcElement;
        return e;
      });
      window.RTCRtpReceiver.prototype.getStats = function() {
        var receiver = this;
        return this._pc.getStats().then(function(result) {
          return filterStats(result, receiver.track, false);
        });
      };
    }

    if (!('getStats' in window.RTCRtpSender.prototype &&
        'getStats' in window.RTCRtpReceiver.prototype)) {
      return;
    }

    // shim RTCPeerConnection.getStats(track).
    var origGetStats = window.RTCPeerConnection.prototype.getStats;
    window.RTCPeerConnection.prototype.getStats = function() {
      var pc = this;
      if (arguments.length > 0 &&
          arguments[0] instanceof window.MediaStreamTrack) {
        var track = arguments[0];
        var sender;
        var receiver;
        var err;
        pc.getSenders().forEach(function(s) {
          if (s.track === track) {
            if (sender) {
              err = true;
            } else {
              sender = s;
            }
          }
        });
        pc.getReceivers().forEach(function(r) {
          if (r.track === track) {
            if (receiver) {
              err = true;
            } else {
              receiver = r;
            }
          }
          return r.track === track;
        });
        if (err || (sender && receiver)) {
          return Promise.reject(new DOMException(
            'There are more than one sender or receiver for the track.',
            'InvalidAccessError'));
        } else if (sender) {
          return sender.getStats();
        } else if (receiver) {
          return receiver.getStats();
        }
        return Promise.reject(new DOMException(
          'There is no sender or receiver for the track.',
          'InvalidAccessError'));
      }
      return origGetStats.apply(pc, arguments);
    };
  },

  shimSourceObject: function(window) {
    var URL = window && window.URL;

    if (typeof window === 'object') {
      if (window.HTMLMediaElement &&
        !('srcObject' in window.HTMLMediaElement.prototype)) {
        // Shim the srcObject property, once, when HTMLMediaElement is found.
        Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
          get: function() {
            return this._srcObject;
          },
          set: function(stream) {
            var self = this;
            // Use _srcObject as a private property for this shim
            this._srcObject = stream;
            if (this.src) {
              URL.revokeObjectURL(this.src);
            }

            if (!stream) {
              this.src = '';
              return undefined;
            }
            this.src = URL.createObjectURL(stream);
            // We need to recreate the blob url when a track is added or
            // removed. Doing it manually since we want to avoid a recursion.
            stream.addEventListener('addtrack', function() {
              if (self.src) {
                URL.revokeObjectURL(self.src);
              }
              self.src = URL.createObjectURL(stream);
            });
            stream.addEventListener('removetrack', function() {
              if (self.src) {
                URL.revokeObjectURL(self.src);
              }
              self.src = URL.createObjectURL(stream);
            });
          }
        });
      }
    }
  },

  shimAddTrackRemoveTrackWithNative: function(window) {
    // shim addTrack/removeTrack with native variants in order to make
    // the interactions with legacy getLocalStreams behave as in other browsers.
    // Keeps a mapping stream.id => [stream, rtpsenders...]
    window.RTCPeerConnection.prototype.getLocalStreams = function() {
      var pc = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      return Object.keys(this._shimmedLocalStreams).map(function(streamId) {
        return pc._shimmedLocalStreams[streamId][0];
      });
    };

    var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
    window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
      if (!stream) {
        return origAddTrack.apply(this, arguments);
      }
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};

      var sender = origAddTrack.apply(this, arguments);
      if (!this._shimmedLocalStreams[stream.id]) {
        this._shimmedLocalStreams[stream.id] = [stream, sender];
      } else if (this._shimmedLocalStreams[stream.id].indexOf(sender) === -1) {
        this._shimmedLocalStreams[stream.id].push(sender);
      }
      return sender;
    };

    var origAddStream = window.RTCPeerConnection.prototype.addStream;
    window.RTCPeerConnection.prototype.addStream = function(stream) {
      var pc = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};

      stream.getTracks().forEach(function(track) {
        var alreadyExists = pc.getSenders().find(function(s) {
          return s.track === track;
        });
        if (alreadyExists) {
          throw new DOMException('Track already exists.',
              'InvalidAccessError');
        }
      });
      var existingSenders = pc.getSenders();
      origAddStream.apply(this, arguments);
      var newSenders = pc.getSenders().filter(function(newSender) {
        return existingSenders.indexOf(newSender) === -1;
      });
      this._shimmedLocalStreams[stream.id] = [stream].concat(newSenders);
    };

    var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
    window.RTCPeerConnection.prototype.removeStream = function(stream) {
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      delete this._shimmedLocalStreams[stream.id];
      return origRemoveStream.apply(this, arguments);
    };

    var origRemoveTrack = window.RTCPeerConnection.prototype.removeTrack;
    window.RTCPeerConnection.prototype.removeTrack = function(sender) {
      var pc = this;
      this._shimmedLocalStreams = this._shimmedLocalStreams || {};
      if (sender) {
        Object.keys(this._shimmedLocalStreams).forEach(function(streamId) {
          var idx = pc._shimmedLocalStreams[streamId].indexOf(sender);
          if (idx !== -1) {
            pc._shimmedLocalStreams[streamId].splice(idx, 1);
          }
          if (pc._shimmedLocalStreams[streamId].length === 1) {
            delete pc._shimmedLocalStreams[streamId];
          }
        });
      }
      return origRemoveTrack.apply(this, arguments);
    };
  },

  shimAddTrackRemoveTrack: function(window) {
    var browserDetails = utils.detectBrowser(window);
    // shim addTrack and removeTrack.
    if (window.RTCPeerConnection.prototype.addTrack &&
        browserDetails.version >= 65) {
      return this.shimAddTrackRemoveTrackWithNative(window);
    }

    // also shim pc.getLocalStreams when addTrack is shimmed
    // to return the original streams.
    var origGetLocalStreams = window.RTCPeerConnection.prototype
        .getLocalStreams;
    window.RTCPeerConnection.prototype.getLocalStreams = function() {
      var pc = this;
      var nativeStreams = origGetLocalStreams.apply(this);
      pc._reverseStreams = pc._reverseStreams || {};
      return nativeStreams.map(function(stream) {
        return pc._reverseStreams[stream.id];
      });
    };

    var origAddStream = window.RTCPeerConnection.prototype.addStream;
    window.RTCPeerConnection.prototype.addStream = function(stream) {
      var pc = this;
      pc._streams = pc._streams || {};
      pc._reverseStreams = pc._reverseStreams || {};

      stream.getTracks().forEach(function(track) {
        var alreadyExists = pc.getSenders().find(function(s) {
          return s.track === track;
        });
        if (alreadyExists) {
          throw new DOMException('Track already exists.',
              'InvalidAccessError');
        }
      });
      // Add identity mapping for consistency with addTrack.
      // Unless this is being used with a stream from addTrack.
      if (!pc._reverseStreams[stream.id]) {
        var newStream = new window.MediaStream(stream.getTracks());
        pc._streams[stream.id] = newStream;
        pc._reverseStreams[newStream.id] = stream;
        stream = newStream;
      }
      origAddStream.apply(pc, [stream]);
    };

    var origRemoveStream = window.RTCPeerConnection.prototype.removeStream;
    window.RTCPeerConnection.prototype.removeStream = function(stream) {
      var pc = this;
      pc._streams = pc._streams || {};
      pc._reverseStreams = pc._reverseStreams || {};

      origRemoveStream.apply(pc, [(pc._streams[stream.id] || stream)]);
      delete pc._reverseStreams[(pc._streams[stream.id] ?
          pc._streams[stream.id].id : stream.id)];
      delete pc._streams[stream.id];
    };

    window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
      var pc = this;
      if (pc.signalingState === 'closed') {
        throw new DOMException(
          'The RTCPeerConnection\'s signalingState is \'closed\'.',
          'InvalidStateError');
      }
      var streams = [].slice.call(arguments, 1);
      if (streams.length !== 1 ||
          !streams[0].getTracks().find(function(t) {
            return t === track;
          })) {
        // this is not fully correct but all we can manage without
        // [[associated MediaStreams]] internal slot.
        throw new DOMException(
          'The adapter.js addTrack polyfill only supports a single ' +
          ' stream which is associated with the specified track.',
          'NotSupportedError');
      }

      var alreadyExists = pc.getSenders().find(function(s) {
        return s.track === track;
      });
      if (alreadyExists) {
        throw new DOMException('Track already exists.',
            'InvalidAccessError');
      }

      pc._streams = pc._streams || {};
      pc._reverseStreams = pc._reverseStreams || {};
      var oldStream = pc._streams[stream.id];
      if (oldStream) {
        // this is using odd Chrome behaviour, use with caution:
        // https://bugs.chromium.org/p/webrtc/issues/detail?id=7815
        // Note: we rely on the high-level addTrack/dtmf shim to
        // create the sender with a dtmf sender.
        oldStream.addTrack(track);

        // Trigger ONN async.
        Promise.resolve().then(function() {
          pc.dispatchEvent(new Event('negotiationneeded'));
        });
      } else {
        var newStream = new window.MediaStream([track]);
        pc._streams[stream.id] = newStream;
        pc._reverseStreams[newStream.id] = stream;
        pc.addStream(newStream);
      }
      return pc.getSenders().find(function(s) {
        return s.track === track;
      });
    };

    // replace the internal stream id with the external one and
    // vice versa.
    function replaceInternalStreamId(pc, description) {
      var sdp = description.sdp;
      Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
        var externalStream = pc._reverseStreams[internalId];
        var internalStream = pc._streams[externalStream.id];
        sdp = sdp.replace(new RegExp(internalStream.id, 'g'),
            externalStream.id);
      });
      return new RTCSessionDescription({
        type: description.type,
        sdp: sdp
      });
    }
    function replaceExternalStreamId(pc, description) {
      var sdp = description.sdp;
      Object.keys(pc._reverseStreams || []).forEach(function(internalId) {
        var externalStream = pc._reverseStreams[internalId];
        var internalStream = pc._streams[externalStream.id];
        sdp = sdp.replace(new RegExp(externalStream.id, 'g'),
            internalStream.id);
      });
      return new RTCSessionDescription({
        type: description.type,
        sdp: sdp
      });
    }
    ['createOffer', 'createAnswer'].forEach(function(method) {
      var nativeMethod = window.RTCPeerConnection.prototype[method];
      window.RTCPeerConnection.prototype[method] = function() {
        var pc = this;
        var args = arguments;
        var isLegacyCall = arguments.length &&
            typeof arguments[0] === 'function';
        if (isLegacyCall) {
          return nativeMethod.apply(pc, [
            function(description) {
              var desc = replaceInternalStreamId(pc, description);
              args[0].apply(null, [desc]);
            },
            function(err) {
              if (args[1]) {
                args[1].apply(null, err);
              }
            }, arguments[2]
          ]);
        }
        return nativeMethod.apply(pc, arguments)
        .then(function(description) {
          return replaceInternalStreamId(pc, description);
        });
      };
    });

    var origSetLocalDescription =
        window.RTCPeerConnection.prototype.setLocalDescription;
    window.RTCPeerConnection.prototype.setLocalDescription = function() {
      var pc = this;
      if (!arguments.length || !arguments[0].type) {
        return origSetLocalDescription.apply(pc, arguments);
      }
      arguments[0] = replaceExternalStreamId(pc, arguments[0]);
      return origSetLocalDescription.apply(pc, arguments);
    };

    // TODO: mangle getStats: https://w3c.github.io/webrtc-stats/#dom-rtcmediastreamstats-streamidentifier

    var origLocalDescription = Object.getOwnPropertyDescriptor(
        window.RTCPeerConnection.prototype, 'localDescription');
    Object.defineProperty(window.RTCPeerConnection.prototype,
        'localDescription', {
          get: function() {
            var pc = this;
            var description = origLocalDescription.get.apply(this);
            if (description.type === '') {
              return description;
            }
            return replaceInternalStreamId(pc, description);
          }
        });

    window.RTCPeerConnection.prototype.removeTrack = function(sender) {
      var pc = this;
      if (pc.signalingState === 'closed') {
        throw new DOMException(
          'The RTCPeerConnection\'s signalingState is \'closed\'.',
          'InvalidStateError');
      }
      // We can not yet check for sender instanceof RTCRtpSender
      // since we shim RTPSender. So we check if sender._pc is set.
      if (!sender._pc) {
        throw new DOMException('Argument 1 of RTCPeerConnection.removeTrack ' +
            'does not implement interface RTCRtpSender.', 'TypeError');
      }
      var isLocal = sender._pc === pc;
      if (!isLocal) {
        throw new DOMException('Sender was not created by this connection.',
            'InvalidAccessError');
      }

      // Search for the native stream the senders track belongs to.
      pc._streams = pc._streams || {};
      var stream;
      Object.keys(pc._streams).forEach(function(streamid) {
        var hasTrack = pc._streams[streamid].getTracks().find(function(track) {
          return sender.track === track;
        });
        if (hasTrack) {
          stream = pc._streams[streamid];
        }
      });

      if (stream) {
        if (stream.getTracks().length === 1) {
          // if this is the last track of the stream, remove the stream. This
          // takes care of any shimmed _senders.
          pc.removeStream(pc._reverseStreams[stream.id]);
        } else {
          // relying on the same odd chrome behaviour as above.
          stream.removeTrack(sender.track);
        }
        pc.dispatchEvent(new Event('negotiationneeded'));
      }
    };
  },

  shimPeerConnection: function(window) {
    var browserDetails = utils.detectBrowser(window);

    // The RTCPeerConnection object.
    if (!window.RTCPeerConnection && window.webkitRTCPeerConnection) {
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        // Translate iceTransportPolicy to iceTransports,
        // see https://code.google.com/p/webrtc/issues/detail?id=4869
        // this was fixed in M56 along with unprefixing RTCPeerConnection.
        logging('PeerConnection');
        if (pcConfig && pcConfig.iceTransportPolicy) {
          pcConfig.iceTransports = pcConfig.iceTransportPolicy;
        }

        return new window.webkitRTCPeerConnection(pcConfig, pcConstraints);
      };
      window.RTCPeerConnection.prototype =
          window.webkitRTCPeerConnection.prototype;
      // wrap static methods. Currently just generateCertificate.
      if (window.webkitRTCPeerConnection.generateCertificate) {
        Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
          get: function() {
            return window.webkitRTCPeerConnection.generateCertificate;
          }
        });
      }
    } else {
      // migrate from non-spec RTCIceServer.url to RTCIceServer.urls
      var OrigPeerConnection = window.RTCPeerConnection;
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        if (pcConfig && pcConfig.iceServers) {
          var newIceServers = [];
          for (var i = 0; i < pcConfig.iceServers.length; i++) {
            var server = pcConfig.iceServers[i];
            if (!server.hasOwnProperty('urls') &&
                server.hasOwnProperty('url')) {
              utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
              server = JSON.parse(JSON.stringify(server));
              server.urls = server.url;
              newIceServers.push(server);
            } else {
              newIceServers.push(pcConfig.iceServers[i]);
            }
          }
          pcConfig.iceServers = newIceServers;
        }
        return new OrigPeerConnection(pcConfig, pcConstraints);
      };
      window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
      // wrap static methods. Currently just generateCertificate.
      Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
        get: function() {
          return OrigPeerConnection.generateCertificate;
        }
      });
    }

    var origGetStats = window.RTCPeerConnection.prototype.getStats;
    window.RTCPeerConnection.prototype.getStats = function(selector,
        successCallback, errorCallback) {
      var pc = this;
      var args = arguments;

      // If selector is a function then we are in the old style stats so just
      // pass back the original getStats format to avoid breaking old users.
      if (arguments.length > 0 && typeof selector === 'function') {
        return origGetStats.apply(this, arguments);
      }

      // When spec-style getStats is supported, return those when called with
      // either no arguments or the selector argument is null.
      if (origGetStats.length === 0 && (arguments.length === 0 ||
          typeof arguments[0] !== 'function')) {
        return origGetStats.apply(this, []);
      }

      var fixChromeStats_ = function(response) {
        var standardReport = {};
        var reports = response.result();
        reports.forEach(function(report) {
          var standardStats = {
            id: report.id,
            timestamp: report.timestamp,
            type: {
              localcandidate: 'local-candidate',
              remotecandidate: 'remote-candidate'
            }[report.type] || report.type
          };
          report.names().forEach(function(name) {
            standardStats[name] = report.stat(name);
          });
          standardReport[standardStats.id] = standardStats;
        });

        return standardReport;
      };

      // shim getStats with maplike support
      var makeMapStats = function(stats) {
        return new Map(Object.keys(stats).map(function(key) {
          return [key, stats[key]];
        }));
      };

      if (arguments.length >= 2) {
        var successCallbackWrapper_ = function(response) {
          args[1](makeMapStats(fixChromeStats_(response)));
        };

        return origGetStats.apply(this, [successCallbackWrapper_,
          arguments[0]]);
      }

      // promise-support
      return new Promise(function(resolve, reject) {
        origGetStats.apply(pc, [
          function(response) {
            resolve(makeMapStats(fixChromeStats_(response)));
          }, reject]);
      }).then(successCallback, errorCallback);
    };

    // add promise support -- natively available in Chrome 51
    if (browserDetails.version < 51) {
      ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
          .forEach(function(method) {
            var nativeMethod = window.RTCPeerConnection.prototype[method];
            window.RTCPeerConnection.prototype[method] = function() {
              var args = arguments;
              var pc = this;
              var promise = new Promise(function(resolve, reject) {
                nativeMethod.apply(pc, [args[0], resolve, reject]);
              });
              if (args.length < 2) {
                return promise;
              }
              return promise.then(function() {
                args[1].apply(null, []);
              },
              function(err) {
                if (args.length >= 3) {
                  args[2].apply(null, [err]);
                }
              });
            };
          });
    }

    // promise support for createOffer and createAnswer. Available (without
    // bugs) since M52: crbug/619289
    if (browserDetails.version < 52) {
      ['createOffer', 'createAnswer'].forEach(function(method) {
        var nativeMethod = window.RTCPeerConnection.prototype[method];
        window.RTCPeerConnection.prototype[method] = function() {
          var pc = this;
          if (arguments.length < 1 || (arguments.length === 1 &&
              typeof arguments[0] === 'object')) {
            var opts = arguments.length === 1 ? arguments[0] : undefined;
            return new Promise(function(resolve, reject) {
              nativeMethod.apply(pc, [resolve, reject, opts]);
            });
          }
          return nativeMethod.apply(this, arguments);
        };
      });
    }

    // shim implicit creation of RTCSessionDescription/RTCIceCandidate
    ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
        .forEach(function(method) {
          var nativeMethod = window.RTCPeerConnection.prototype[method];
          window.RTCPeerConnection.prototype[method] = function() {
            arguments[0] = new ((method === 'addIceCandidate') ?
                window.RTCIceCandidate :
                window.RTCSessionDescription)(arguments[0]);
            return nativeMethod.apply(this, arguments);
          };
        });

    // support for addIceCandidate(null or undefined)
    var nativeAddIceCandidate =
        window.RTCPeerConnection.prototype.addIceCandidate;
    window.RTCPeerConnection.prototype.addIceCandidate = function() {
      if (!arguments[0]) {
        if (arguments[1]) {
          arguments[1].apply(null);
        }
        return Promise.resolve();
      }
      return nativeAddIceCandidate.apply(this, arguments);
    };
  }
};

},{"../utils.js":14,"./getusermedia":6}],6:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';
var utils = require('../utils.js');
var logging = utils.log;

// Expose public methods.
module.exports = function(window) {
  var browserDetails = utils.detectBrowser(window);
  var navigator = window && window.navigator;

  var constraintsToChrome_ = function(c) {
    if (typeof c !== 'object' || c.mandatory || c.optional) {
      return c;
    }
    var cc = {};
    Object.keys(c).forEach(function(key) {
      if (key === 'require' || key === 'advanced' || key === 'mediaSource') {
        return;
      }
      var r = (typeof c[key] === 'object') ? c[key] : {ideal: c[key]};
      if (r.exact !== undefined && typeof r.exact === 'number') {
        r.min = r.max = r.exact;
      }
      var oldname_ = function(prefix, name) {
        if (prefix) {
          return prefix + name.charAt(0).toUpperCase() + name.slice(1);
        }
        return (name === 'deviceId') ? 'sourceId' : name;
      };
      if (r.ideal !== undefined) {
        cc.optional = cc.optional || [];
        var oc = {};
        if (typeof r.ideal === 'number') {
          oc[oldname_('min', key)] = r.ideal;
          cc.optional.push(oc);
          oc = {};
          oc[oldname_('max', key)] = r.ideal;
          cc.optional.push(oc);
        } else {
          oc[oldname_('', key)] = r.ideal;
          cc.optional.push(oc);
        }
      }
      if (r.exact !== undefined && typeof r.exact !== 'number') {
        cc.mandatory = cc.mandatory || {};
        cc.mandatory[oldname_('', key)] = r.exact;
      } else {
        ['min', 'max'].forEach(function(mix) {
          if (r[mix] !== undefined) {
            cc.mandatory = cc.mandatory || {};
            cc.mandatory[oldname_(mix, key)] = r[mix];
          }
        });
      }
    });
    if (c.advanced) {
      cc.optional = (cc.optional || []).concat(c.advanced);
    }
    return cc;
  };

  var shimConstraints_ = function(constraints, func) {
    if (browserDetails.version >= 61) {
      return func(constraints);
    }
    constraints = JSON.parse(JSON.stringify(constraints));
    if (constraints && typeof constraints.audio === 'object') {
      var remap = function(obj, a, b) {
        if (a in obj && !(b in obj)) {
          obj[b] = obj[a];
          delete obj[a];
        }
      };
      constraints = JSON.parse(JSON.stringify(constraints));
      remap(constraints.audio, 'autoGainControl', 'googAutoGainControl');
      remap(constraints.audio, 'noiseSuppression', 'googNoiseSuppression');
      constraints.audio = constraintsToChrome_(constraints.audio);
    }
    if (constraints && typeof constraints.video === 'object') {
      // Shim facingMode for mobile & surface pro.
      var face = constraints.video.facingMode;
      face = face && ((typeof face === 'object') ? face : {ideal: face});
      var getSupportedFacingModeLies = browserDetails.version < 66;

      if ((face && (face.exact === 'user' || face.exact === 'environment' ||
                    face.ideal === 'user' || face.ideal === 'environment')) &&
          !(navigator.mediaDevices.getSupportedConstraints &&
            navigator.mediaDevices.getSupportedConstraints().facingMode &&
            !getSupportedFacingModeLies)) {
        delete constraints.video.facingMode;
        var matches;
        if (face.exact === 'environment' || face.ideal === 'environment') {
          matches = ['back', 'rear'];
        } else if (face.exact === 'user' || face.ideal === 'user') {
          matches = ['front'];
        }
        if (matches) {
          // Look for matches in label, or use last cam for back (typical).
          return navigator.mediaDevices.enumerateDevices()
          .then(function(devices) {
            devices = devices.filter(function(d) {
              return d.kind === 'videoinput';
            });
            var dev = devices.find(function(d) {
              return matches.some(function(match) {
                return d.label.toLowerCase().indexOf(match) !== -1;
              });
            });
            if (!dev && devices.length && matches.indexOf('back') !== -1) {
              dev = devices[devices.length - 1]; // more likely the back cam
            }
            if (dev) {
              constraints.video.deviceId = face.exact ? {exact: dev.deviceId} :
                                                        {ideal: dev.deviceId};
            }
            constraints.video = constraintsToChrome_(constraints.video);
            logging('chrome: ' + JSON.stringify(constraints));
            return func(constraints);
          });
        }
      }
      constraints.video = constraintsToChrome_(constraints.video);
    }
    logging('chrome: ' + JSON.stringify(constraints));
    return func(constraints);
  };

  var shimError_ = function(e) {
    return {
      name: {
        PermissionDeniedError: 'NotAllowedError',
        PermissionDismissedError: 'NotAllowedError',
        InvalidStateError: 'NotAllowedError',
        DevicesNotFoundError: 'NotFoundError',
        ConstraintNotSatisfiedError: 'OverconstrainedError',
        TrackStartError: 'NotReadableError',
        MediaDeviceFailedDueToShutdown: 'NotAllowedError',
        MediaDeviceKillSwitchOn: 'NotAllowedError',
        TabCaptureError: 'AbortError',
        ScreenCaptureError: 'AbortError',
        DeviceCaptureError: 'AbortError'
      }[e.name] || e.name,
      message: e.message,
      constraint: e.constraintName,
      toString: function() {
        return this.name + (this.message && ': ') + this.message;
      }
    };
  };

  var getUserMedia_ = function(constraints, onSuccess, onError) {
    shimConstraints_(constraints, function(c) {
      navigator.webkitGetUserMedia(c, onSuccess, function(e) {
        if (onError) {
          onError(shimError_(e));
        }
      });
    });
  };

  navigator.getUserMedia = getUserMedia_;

  // Returns the result of getUserMedia as a Promise.
  var getUserMediaPromise_ = function(constraints) {
    return new Promise(function(resolve, reject) {
      navigator.getUserMedia(constraints, resolve, reject);
    });
  };

  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {
      getUserMedia: getUserMediaPromise_,
      enumerateDevices: function() {
        return new Promise(function(resolve) {
          var kinds = {audio: 'audioinput', video: 'videoinput'};
          return window.MediaStreamTrack.getSources(function(devices) {
            resolve(devices.map(function(device) {
              return {label: device.label,
                kind: kinds[device.kind],
                deviceId: device.id,
                groupId: ''};
            }));
          });
        });
      },
      getSupportedConstraints: function() {
        return {
          deviceId: true, echoCancellation: true, facingMode: true,
          frameRate: true, height: true, width: true
        };
      }
    };
  }

  // A shim for getUserMedia method on the mediaDevices object.
  // TODO(KaptenJansson) remove once implemented in Chrome stable.
  if (!navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia = function(constraints) {
      return getUserMediaPromise_(constraints);
    };
  } else {
    // Even though Chrome 45 has navigator.mediaDevices and a getUserMedia
    // function which returns a Promise, it does not accept spec-style
    // constraints.
    var origGetUserMedia = navigator.mediaDevices.getUserMedia.
        bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(cs) {
      return shimConstraints_(cs, function(c) {
        return origGetUserMedia(c).then(function(stream) {
          if (c.audio && !stream.getAudioTracks().length ||
              c.video && !stream.getVideoTracks().length) {
            stream.getTracks().forEach(function(track) {
              track.stop();
            });
            throw new DOMException('', 'NotFoundError');
          }
          return stream;
        }, function(e) {
          return Promise.reject(shimError_(e));
        });
      });
    };
  }

  // Dummy devicechange event methods.
  // TODO(KaptenJansson) remove once implemented in Chrome stable.
  if (typeof navigator.mediaDevices.addEventListener === 'undefined') {
    navigator.mediaDevices.addEventListener = function() {
      logging('Dummy mediaDevices.addEventListener called.');
    };
  }
  if (typeof navigator.mediaDevices.removeEventListener === 'undefined') {
    navigator.mediaDevices.removeEventListener = function() {
      logging('Dummy mediaDevices.removeEventListener called.');
    };
  }
};

},{"../utils.js":14}],7:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var SDPUtils = require('sdp');
var utils = require('./utils');

module.exports = {
  shimRTCIceCandidate: function(window) {
    // foundation is arbitrarily chosen as an indicator for full support for
    // https://w3c.github.io/webrtc-pc/#rtcicecandidate-interface
    if (!window.RTCIceCandidate || (window.RTCIceCandidate && 'foundation' in
        window.RTCIceCandidate.prototype)) {
      return;
    }

    var NativeRTCIceCandidate = window.RTCIceCandidate;
    window.RTCIceCandidate = function(args) {
      // Remove the a= which shouldn't be part of the candidate string.
      if (typeof args === 'object' && args.candidate &&
          args.candidate.indexOf('a=') === 0) {
        args = JSON.parse(JSON.stringify(args));
        args.candidate = args.candidate.substr(2);
      }

      if (args.candidate && args.candidate.length) {
        // Augment the native candidate with the parsed fields.
        var nativeCandidate = new NativeRTCIceCandidate(args);
        var parsedCandidate = SDPUtils.parseCandidate(args.candidate);
        var augmentedCandidate = Object.assign(nativeCandidate,
            parsedCandidate);

        // Add a serializer that does not serialize the extra attributes.
        augmentedCandidate.toJSON = function() {
          return {
            candidate: augmentedCandidate.candidate,
            sdpMid: augmentedCandidate.sdpMid,
            sdpMLineIndex: augmentedCandidate.sdpMLineIndex,
            usernameFragment: augmentedCandidate.usernameFragment,
          };
        };
        return augmentedCandidate;
      }
      return new NativeRTCIceCandidate(args);
    };
    window.RTCIceCandidate.prototype = NativeRTCIceCandidate.prototype;

    // Hook up the augmented candidate in onicecandidate and
    // addEventListener('icecandidate', ...)
    utils.wrapPeerConnectionEvent(window, 'icecandidate', function(e) {
      if (e.candidate) {
        Object.defineProperty(e, 'candidate', {
          value: new window.RTCIceCandidate(e.candidate),
          writable: 'false'
        });
      }
      return e;
    });
  },

  // shimCreateObjectURL must be called before shimSourceObject to avoid loop.

  shimCreateObjectURL: function(window) {
    var URL = window && window.URL;

    if (!(typeof window === 'object' && window.HTMLMediaElement &&
          'srcObject' in window.HTMLMediaElement.prototype &&
        URL.createObjectURL && URL.revokeObjectURL)) {
      // Only shim CreateObjectURL using srcObject if srcObject exists.
      return undefined;
    }

    var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
    var nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    var streams = new Map(), newId = 0;

    URL.createObjectURL = function(stream) {
      if ('getTracks' in stream) {
        var url = 'polyblob:' + (++newId);
        streams.set(url, stream);
        utils.deprecated('URL.createObjectURL(stream)',
            'elem.srcObject = stream');
        return url;
      }
      return nativeCreateObjectURL(stream);
    };
    URL.revokeObjectURL = function(url) {
      nativeRevokeObjectURL(url);
      streams.delete(url);
    };

    var dsc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype,
                                              'src');
    Object.defineProperty(window.HTMLMediaElement.prototype, 'src', {
      get: function() {
        return dsc.get.apply(this);
      },
      set: function(url) {
        this.srcObject = streams.get(url) || null;
        return dsc.set.apply(this, [url]);
      }
    });

    var nativeSetAttribute = window.HTMLMediaElement.prototype.setAttribute;
    window.HTMLMediaElement.prototype.setAttribute = function() {
      if (arguments.length === 2 &&
          ('' + arguments[0]).toLowerCase() === 'src') {
        this.srcObject = streams.get(arguments[1]) || null;
      }
      return nativeSetAttribute.apply(this, arguments);
    };
  },

  shimMaxMessageSize: function(window) {
    if (window.RTCSctpTransport || !window.RTCPeerConnection) {
      return;
    }
    var browserDetails = utils.detectBrowser(window);

    if (!('sctp' in window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'sctp', {
        get: function() {
          return typeof this._sctp === 'undefined' ? null : this._sctp;
        }
      });
    }

    var sctpInDescription = function(description) {
      var sections = SDPUtils.splitSections(description.sdp);
      sections.shift();
      return sections.some(function(mediaSection) {
        var mLine = SDPUtils.parseMLine(mediaSection);
        return mLine && mLine.kind === 'application'
            && mLine.protocol.indexOf('SCTP') !== -1;
      });
    };

    var getRemoteFirefoxVersion = function(description) {
      // TODO: Is there a better solution for detecting Firefox?
      var match = description.sdp.match(/mozilla...THIS_IS_SDPARTA-(\d+)/);
      if (match === null || match.length < 2) {
        return -1;
      }
      var version = parseInt(match[1], 10);
      // Test for NaN (yes, this is ugly)
      return version !== version ? -1 : version;
    };

    var getCanSendMaxMessageSize = function(remoteIsFirefox) {
      // Every implementation we know can send at least 64 KiB.
      // Note: Although Chrome is technically able to send up to 256 KiB, the
      //       data does not reach the other peer reliably.
      //       See: https://bugs.chromium.org/p/webrtc/issues/detail?id=8419
      var canSendMaxMessageSize = 65536;
      if (browserDetails.browser === 'firefox') {
        if (browserDetails.version < 57) {
          if (remoteIsFirefox === -1) {
            // FF < 57 will send in 16 KiB chunks using the deprecated PPID
            // fragmentation.
            canSendMaxMessageSize = 16384;
          } else {
            // However, other FF (and RAWRTC) can reassemble PPID-fragmented
            // messages. Thus, supporting ~2 GiB when sending.
            canSendMaxMessageSize = 2147483637;
          }
        } else if (browserDetails.version < 60) {
          // Currently, all FF >= 57 will reset the remote maximum message size
          // to the default value when a data channel is created at a later
          // stage. :(
          // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1426831
          canSendMaxMessageSize =
            browserDetails.version === 57 ? 65535 : 65536;
        } else {
          // FF >= 60 supports sending ~2 GiB
          canSendMaxMessageSize = 2147483637;
        }
      }
      return canSendMaxMessageSize;
    };

    var getMaxMessageSize = function(description, remoteIsFirefox) {
      // Note: 65536 bytes is the default value from the SDP spec. Also,
      //       every implementation we know supports receiving 65536 bytes.
      var maxMessageSize = 65536;

      // FF 57 has a slightly incorrect default remote max message size, so
      // we need to adjust it here to avoid a failure when sending.
      // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1425697
      if (browserDetails.browser === 'firefox'
           && browserDetails.version === 57) {
        maxMessageSize = 65535;
      }

      var match = SDPUtils.matchPrefix(description.sdp, 'a=max-message-size:');
      if (match.length > 0) {
        maxMessageSize = parseInt(match[0].substr(19), 10);
      } else if (browserDetails.browser === 'firefox' &&
                  remoteIsFirefox !== -1) {
        // If the maximum message size is not present in the remote SDP and
        // both local and remote are Firefox, the remote peer can receive
        // ~2 GiB.
        maxMessageSize = 2147483637;
      }
      return maxMessageSize;
    };

    var origSetRemoteDescription =
        window.RTCPeerConnection.prototype.setRemoteDescription;
    window.RTCPeerConnection.prototype.setRemoteDescription = function() {
      var pc = this;
      pc._sctp = null;

      if (sctpInDescription(arguments[0])) {
        // Check if the remote is FF.
        var isFirefox = getRemoteFirefoxVersion(arguments[0]);

        // Get the maximum message size the local peer is capable of sending
        var canSendMMS = getCanSendMaxMessageSize(isFirefox);

        // Get the maximum message size of the remote peer.
        var remoteMMS = getMaxMessageSize(arguments[0], isFirefox);

        // Determine final maximum message size
        var maxMessageSize;
        if (canSendMMS === 0 && remoteMMS === 0) {
          maxMessageSize = Number.POSITIVE_INFINITY;
        } else if (canSendMMS === 0 || remoteMMS === 0) {
          maxMessageSize = Math.max(canSendMMS, remoteMMS);
        } else {
          maxMessageSize = Math.min(canSendMMS, remoteMMS);
        }

        // Create a dummy RTCSctpTransport object and the 'maxMessageSize'
        // attribute.
        var sctp = {};
        Object.defineProperty(sctp, 'maxMessageSize', {
          get: function() {
            return maxMessageSize;
          }
        });
        pc._sctp = sctp;
      }

      return origSetRemoteDescription.apply(pc, arguments);
    };
  },

  shimSendThrowTypeError: function(window) {
    if (!(window.RTCPeerConnection &&
        'createDataChannel' in window.RTCPeerConnection.prototype)) {
      return;
    }

    // Note: Although Firefox >= 57 has a native implementation, the maximum
    //       message size can be reset for all data channels at a later stage.
    //       See: https://bugzilla.mozilla.org/show_bug.cgi?id=1426831

    function wrapDcSend(dc, pc) {
      var origDataChannelSend = dc.send;
      dc.send = function() {
        var data = arguments[0];
        var length = data.length || data.size || data.byteLength;
        if (dc.readyState === 'open' &&
            pc.sctp && length > pc.sctp.maxMessageSize) {
          throw new TypeError('Message too large (can send a maximum of ' +
            pc.sctp.maxMessageSize + ' bytes)');
        }
        return origDataChannelSend.apply(dc, arguments);
      };
    }
    var origCreateDataChannel =
      window.RTCPeerConnection.prototype.createDataChannel;
    window.RTCPeerConnection.prototype.createDataChannel = function() {
      var pc = this;
      var dataChannel = origCreateDataChannel.apply(pc, arguments);
      wrapDcSend(dataChannel, pc);
      return dataChannel;
    };
    utils.wrapPeerConnectionEvent(window, 'datachannel', function(e) {
      wrapDcSend(e.channel, e.target);
      return e;
    });
  }
};

},{"./utils":14,"sdp":2}],8:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');
var filterIceServers = require('./filtericeservers');
var shimRTCPeerConnection = require('rtcpeerconnection-shim');

module.exports = {
  shimGetUserMedia: require('./getusermedia'),
  shimPeerConnection: function(window) {
    var browserDetails = utils.detectBrowser(window);

    if (window.RTCIceGatherer) {
      if (!window.RTCIceCandidate) {
        window.RTCIceCandidate = function(args) {
          return args;
        };
      }
      if (!window.RTCSessionDescription) {
        window.RTCSessionDescription = function(args) {
          return args;
        };
      }
      // this adds an additional event listener to MediaStrackTrack that signals
      // when a tracks enabled property was changed. Workaround for a bug in
      // addStream, see below. No longer required in 15025+
      if (browserDetails.version < 15025) {
        var origMSTEnabled = Object.getOwnPropertyDescriptor(
            window.MediaStreamTrack.prototype, 'enabled');
        Object.defineProperty(window.MediaStreamTrack.prototype, 'enabled', {
          set: function(value) {
            origMSTEnabled.set.call(this, value);
            var ev = new Event('enabled');
            ev.enabled = value;
            this.dispatchEvent(ev);
          }
        });
      }
    }

    // ORTC defines the DTMF sender a bit different.
    // https://github.com/w3c/ortc/issues/714
    if (window.RTCRtpSender && !('dtmf' in window.RTCRtpSender.prototype)) {
      Object.defineProperty(window.RTCRtpSender.prototype, 'dtmf', {
        get: function() {
          if (this._dtmf === undefined) {
            if (this.track.kind === 'audio') {
              this._dtmf = new window.RTCDtmfSender(this);
            } else if (this.track.kind === 'video') {
              this._dtmf = null;
            }
          }
          return this._dtmf;
        }
      });
    }
    // Edge currently only implements the RTCDtmfSender, not the
    // RTCDTMFSender alias. See http://draft.ortc.org/#rtcdtmfsender2*
    if (window.RTCDtmfSender && !window.RTCDTMFSender) {
      window.RTCDTMFSender = window.RTCDtmfSender;
    }

    var RTCPeerConnectionShim = shimRTCPeerConnection(window,
        browserDetails.version);
    window.RTCPeerConnection = function(config) {
      if (config && config.iceServers) {
        config.iceServers = filterIceServers(config.iceServers);
      }
      return new RTCPeerConnectionShim(config);
    };
    window.RTCPeerConnection.prototype = RTCPeerConnectionShim.prototype;
  },
  shimReplaceTrack: function(window) {
    // ORTC has replaceTrack -- https://github.com/w3c/ortc/issues/614
    if (window.RTCRtpSender &&
        !('replaceTrack' in window.RTCRtpSender.prototype)) {
      window.RTCRtpSender.prototype.replaceTrack =
          window.RTCRtpSender.prototype.setTrack;
    }
  }
};

},{"../utils":14,"./filtericeservers":9,"./getusermedia":10,"rtcpeerconnection-shim":1}],9:[function(require,module,exports){
/*
 *  Copyright (c) 2018 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');
// Edge does not like
// 1) stun: filtered after 14393 unless ?transport=udp is present
// 2) turn: that does not have all of turn:host:port?transport=udp
// 3) turn: with ipv6 addresses
// 4) turn: occurring muliple times
module.exports = function(iceServers, edgeVersion) {
  var hasTurn = false;
  iceServers = JSON.parse(JSON.stringify(iceServers));
  return iceServers.filter(function(server) {
    if (server && (server.urls || server.url)) {
      var urls = server.urls || server.url;
      if (server.url && !server.urls) {
        utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
      }
      var isString = typeof urls === 'string';
      if (isString) {
        urls = [urls];
      }
      urls = urls.filter(function(url) {
        var validTurn = url.indexOf('turn:') === 0 &&
            url.indexOf('transport=udp') !== -1 &&
            url.indexOf('turn:[') === -1 &&
            !hasTurn;

        if (validTurn) {
          hasTurn = true;
          return true;
        }
        return url.indexOf('stun:') === 0 && edgeVersion >= 14393 &&
            url.indexOf('?transport=udp') === -1;
      });

      delete server.url;
      server.urls = isString ? urls[0] : urls;
      return !!urls.length;
    }
  });
};

},{"../utils":14}],10:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

// Expose public methods.
module.exports = function(window) {
  var navigator = window && window.navigator;

  var shimError_ = function(e) {
    return {
      name: {PermissionDeniedError: 'NotAllowedError'}[e.name] || e.name,
      message: e.message,
      constraint: e.constraint,
      toString: function() {
        return this.name;
      }
    };
  };

  // getUserMedia error shim.
  var origGetUserMedia = navigator.mediaDevices.getUserMedia.
      bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = function(c) {
    return origGetUserMedia(c).catch(function(e) {
      return Promise.reject(shimError_(e));
    });
  };
};

},{}],11:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');

module.exports = {
  shimGetUserMedia: require('./getusermedia'),
  shimOnTrack: function(window) {
    if (typeof window === 'object' && window.RTCPeerConnection && !('ontrack' in
        window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'ontrack', {
        get: function() {
          return this._ontrack;
        },
        set: function(f) {
          if (this._ontrack) {
            this.removeEventListener('track', this._ontrack);
            this.removeEventListener('addstream', this._ontrackpoly);
          }
          this.addEventListener('track', this._ontrack = f);
          this.addEventListener('addstream', this._ontrackpoly = function(e) {
            e.stream.getTracks().forEach(function(track) {
              var event = new Event('track');
              event.track = track;
              event.receiver = {track: track};
              event.transceiver = {receiver: event.receiver};
              event.streams = [e.stream];
              this.dispatchEvent(event);
            }.bind(this));
          }.bind(this));
        }
      });
    }
    if (typeof window === 'object' && window.RTCTrackEvent &&
        ('receiver' in window.RTCTrackEvent.prototype) &&
        !('transceiver' in window.RTCTrackEvent.prototype)) {
      Object.defineProperty(window.RTCTrackEvent.prototype, 'transceiver', {
        get: function() {
          return {receiver: this.receiver};
        }
      });
    }
  },

  shimSourceObject: function(window) {
    // Firefox has supported mozSrcObject since FF22, unprefixed in 42.
    if (typeof window === 'object') {
      if (window.HTMLMediaElement &&
        !('srcObject' in window.HTMLMediaElement.prototype)) {
        // Shim the srcObject property, once, when HTMLMediaElement is found.
        Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
          get: function() {
            return this.mozSrcObject;
          },
          set: function(stream) {
            this.mozSrcObject = stream;
          }
        });
      }
    }
  },

  shimPeerConnection: function(window) {
    var browserDetails = utils.detectBrowser(window);

    if (typeof window !== 'object' || !(window.RTCPeerConnection ||
        window.mozRTCPeerConnection)) {
      return; // probably media.peerconnection.enabled=false in about:config
    }
    // The RTCPeerConnection object.
    if (!window.RTCPeerConnection) {
      window.RTCPeerConnection = function(pcConfig, pcConstraints) {
        if (browserDetails.version < 38) {
          // .urls is not supported in FF < 38.
          // create RTCIceServers with a single url.
          if (pcConfig && pcConfig.iceServers) {
            var newIceServers = [];
            for (var i = 0; i < pcConfig.iceServers.length; i++) {
              var server = pcConfig.iceServers[i];
              if (server.hasOwnProperty('urls')) {
                for (var j = 0; j < server.urls.length; j++) {
                  var newServer = {
                    url: server.urls[j]
                  };
                  if (server.urls[j].indexOf('turn') === 0) {
                    newServer.username = server.username;
                    newServer.credential = server.credential;
                  }
                  newIceServers.push(newServer);
                }
              } else {
                newIceServers.push(pcConfig.iceServers[i]);
              }
            }
            pcConfig.iceServers = newIceServers;
          }
        }
        return new window.mozRTCPeerConnection(pcConfig, pcConstraints);
      };
      window.RTCPeerConnection.prototype =
          window.mozRTCPeerConnection.prototype;

      // wrap static methods. Currently just generateCertificate.
      if (window.mozRTCPeerConnection.generateCertificate) {
        Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
          get: function() {
            return window.mozRTCPeerConnection.generateCertificate;
          }
        });
      }

      window.RTCSessionDescription = window.mozRTCSessionDescription;
      window.RTCIceCandidate = window.mozRTCIceCandidate;
    }

    // shim away need for obsolete RTCIceCandidate/RTCSessionDescription.
    ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']
        .forEach(function(method) {
          var nativeMethod = window.RTCPeerConnection.prototype[method];
          window.RTCPeerConnection.prototype[method] = function() {
            arguments[0] = new ((method === 'addIceCandidate') ?
                window.RTCIceCandidate :
                window.RTCSessionDescription)(arguments[0]);
            return nativeMethod.apply(this, arguments);
          };
        });

    // support for addIceCandidate(null or undefined)
    var nativeAddIceCandidate =
        window.RTCPeerConnection.prototype.addIceCandidate;
    window.RTCPeerConnection.prototype.addIceCandidate = function() {
      if (!arguments[0]) {
        if (arguments[1]) {
          arguments[1].apply(null);
        }
        return Promise.resolve();
      }
      return nativeAddIceCandidate.apply(this, arguments);
    };

    // shim getStats with maplike support
    var makeMapStats = function(stats) {
      var map = new Map();
      Object.keys(stats).forEach(function(key) {
        map.set(key, stats[key]);
        map[key] = stats[key];
      });
      return map;
    };

    var modernStatsTypes = {
      inboundrtp: 'inbound-rtp',
      outboundrtp: 'outbound-rtp',
      candidatepair: 'candidate-pair',
      localcandidate: 'local-candidate',
      remotecandidate: 'remote-candidate'
    };

    var nativeGetStats = window.RTCPeerConnection.prototype.getStats;
    window.RTCPeerConnection.prototype.getStats = function(
      selector,
      onSucc,
      onErr
    ) {
      return nativeGetStats.apply(this, [selector || null])
        .then(function(stats) {
          if (browserDetails.version < 48) {
            stats = makeMapStats(stats);
          }
          if (browserDetails.version < 53 && !onSucc) {
            // Shim only promise getStats with spec-hyphens in type names
            // Leave callback version alone; misc old uses of forEach before Map
            try {
              stats.forEach(function(stat) {
                stat.type = modernStatsTypes[stat.type] || stat.type;
              });
            } catch (e) {
              if (e.name !== 'TypeError') {
                throw e;
              }
              // Avoid TypeError: "type" is read-only, in old versions. 34-43ish
              stats.forEach(function(stat, i) {
                stats.set(i, Object.assign({}, stat, {
                  type: modernStatsTypes[stat.type] || stat.type
                }));
              });
            }
          }
          return stats;
        })
        .then(onSucc, onErr);
    };
  },

  shimSenderGetStats: function(window) {
    if (!(typeof window === 'object' && window.RTCPeerConnection &&
        window.RTCRtpSender)) {
      return;
    }
    if (window.RTCRtpSender && 'getStats' in window.RTCRtpSender.prototype) {
      return;
    }
    var origGetSenders = window.RTCPeerConnection.prototype.getSenders;
    if (origGetSenders) {
      window.RTCPeerConnection.prototype.getSenders = function() {
        var pc = this;
        var senders = origGetSenders.apply(pc, []);
        senders.forEach(function(sender) {
          sender._pc = pc;
        });
        return senders;
      };
    }

    var origAddTrack = window.RTCPeerConnection.prototype.addTrack;
    if (origAddTrack) {
      window.RTCPeerConnection.prototype.addTrack = function() {
        var sender = origAddTrack.apply(this, arguments);
        sender._pc = this;
        return sender;
      };
    }
    window.RTCRtpSender.prototype.getStats = function() {
      return this.track ? this._pc.getStats(this.track) :
          Promise.resolve(new Map());
    };
  },

  shimReceiverGetStats: function(window) {
    if (!(typeof window === 'object' && window.RTCPeerConnection &&
        window.RTCRtpSender)) {
      return;
    }
    if (window.RTCRtpSender && 'getStats' in window.RTCRtpReceiver.prototype) {
      return;
    }
    var origGetReceivers = window.RTCPeerConnection.prototype.getReceivers;
    if (origGetReceivers) {
      window.RTCPeerConnection.prototype.getReceivers = function() {
        var pc = this;
        var receivers = origGetReceivers.apply(pc, []);
        receivers.forEach(function(receiver) {
          receiver._pc = pc;
        });
        return receivers;
      };
    }
    utils.wrapPeerConnectionEvent(window, 'track', function(e) {
      e.receiver._pc = e.srcElement;
      return e;
    });
    window.RTCRtpReceiver.prototype.getStats = function() {
      return this._pc.getStats(this.track);
    };
  },

  shimRemoveStream: function(window) {
    if (!window.RTCPeerConnection ||
        'removeStream' in window.RTCPeerConnection.prototype) {
      return;
    }
    window.RTCPeerConnection.prototype.removeStream = function(stream) {
      var pc = this;
      utils.deprecated('removeStream', 'removeTrack');
      this.getSenders().forEach(function(sender) {
        if (sender.track && stream.getTracks().indexOf(sender.track) !== -1) {
          pc.removeTrack(sender);
        }
      });
    };
  },

  shimRTCDataChannel: function(window) {
    // rename DataChannel to RTCDataChannel (native fix in FF60):
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1173851
    if (window.DataChannel && !window.RTCDataChannel) {
      window.RTCDataChannel = window.DataChannel;
    }
  },
};

},{"../utils":14,"./getusermedia":12}],12:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var utils = require('../utils');
var logging = utils.log;

// Expose public methods.
module.exports = function(window) {
  var browserDetails = utils.detectBrowser(window);
  var navigator = window && window.navigator;
  var MediaStreamTrack = window && window.MediaStreamTrack;

  var shimError_ = function(e) {
    return {
      name: {
        InternalError: 'NotReadableError',
        NotSupportedError: 'TypeError',
        PermissionDeniedError: 'NotAllowedError',
        SecurityError: 'NotAllowedError'
      }[e.name] || e.name,
      message: {
        'The operation is insecure.': 'The request is not allowed by the ' +
        'user agent or the platform in the current context.'
      }[e.message] || e.message,
      constraint: e.constraint,
      toString: function() {
        return this.name + (this.message && ': ') + this.message;
      }
    };
  };

  // getUserMedia constraints shim.
  var getUserMedia_ = function(constraints, onSuccess, onError) {
    var constraintsToFF37_ = function(c) {
      if (typeof c !== 'object' || c.require) {
        return c;
      }
      var require = [];
      Object.keys(c).forEach(function(key) {
        if (key === 'require' || key === 'advanced' || key === 'mediaSource') {
          return;
        }
        var r = c[key] = (typeof c[key] === 'object') ?
            c[key] : {ideal: c[key]};
        if (r.min !== undefined ||
            r.max !== undefined || r.exact !== undefined) {
          require.push(key);
        }
        if (r.exact !== undefined) {
          if (typeof r.exact === 'number') {
            r. min = r.max = r.exact;
          } else {
            c[key] = r.exact;
          }
          delete r.exact;
        }
        if (r.ideal !== undefined) {
          c.advanced = c.advanced || [];
          var oc = {};
          if (typeof r.ideal === 'number') {
            oc[key] = {min: r.ideal, max: r.ideal};
          } else {
            oc[key] = r.ideal;
          }
          c.advanced.push(oc);
          delete r.ideal;
          if (!Object.keys(r).length) {
            delete c[key];
          }
        }
      });
      if (require.length) {
        c.require = require;
      }
      return c;
    };
    constraints = JSON.parse(JSON.stringify(constraints));
    if (browserDetails.version < 38) {
      logging('spec: ' + JSON.stringify(constraints));
      if (constraints.audio) {
        constraints.audio = constraintsToFF37_(constraints.audio);
      }
      if (constraints.video) {
        constraints.video = constraintsToFF37_(constraints.video);
      }
      logging('ff37: ' + JSON.stringify(constraints));
    }
    return navigator.mozGetUserMedia(constraints, onSuccess, function(e) {
      onError(shimError_(e));
    });
  };

  // Returns the result of getUserMedia as a Promise.
  var getUserMediaPromise_ = function(constraints) {
    return new Promise(function(resolve, reject) {
      getUserMedia_(constraints, resolve, reject);
    });
  };

  // Shim for mediaDevices on older versions.
  if (!navigator.mediaDevices) {
    navigator.mediaDevices = {getUserMedia: getUserMediaPromise_,
      addEventListener: function() { },
      removeEventListener: function() { }
    };
  }
  navigator.mediaDevices.enumerateDevices =
      navigator.mediaDevices.enumerateDevices || function() {
        return new Promise(function(resolve) {
          var infos = [
            {kind: 'audioinput', deviceId: 'default', label: '', groupId: ''},
            {kind: 'videoinput', deviceId: 'default', label: '', groupId: ''}
          ];
          resolve(infos);
        });
      };

  if (browserDetails.version < 41) {
    // Work around http://bugzil.la/1169665
    var orgEnumerateDevices =
        navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = function() {
      return orgEnumerateDevices().then(undefined, function(e) {
        if (e.name === 'NotFoundError') {
          return [];
        }
        throw e;
      });
    };
  }
  if (browserDetails.version < 49) {
    var origGetUserMedia = navigator.mediaDevices.getUserMedia.
        bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(c) {
      return origGetUserMedia(c).then(function(stream) {
        // Work around https://bugzil.la/802326
        if (c.audio && !stream.getAudioTracks().length ||
            c.video && !stream.getVideoTracks().length) {
          stream.getTracks().forEach(function(track) {
            track.stop();
          });
          throw new DOMException('The object can not be found here.',
                                 'NotFoundError');
        }
        return stream;
      }, function(e) {
        return Promise.reject(shimError_(e));
      });
    };
  }
  if (!(browserDetails.version > 55 &&
      'autoGainControl' in navigator.mediaDevices.getSupportedConstraints())) {
    var remap = function(obj, a, b) {
      if (a in obj && !(b in obj)) {
        obj[b] = obj[a];
        delete obj[a];
      }
    };

    var nativeGetUserMedia = navigator.mediaDevices.getUserMedia.
        bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(c) {
      if (typeof c === 'object' && typeof c.audio === 'object') {
        c = JSON.parse(JSON.stringify(c));
        remap(c.audio, 'autoGainControl', 'mozAutoGainControl');
        remap(c.audio, 'noiseSuppression', 'mozNoiseSuppression');
      }
      return nativeGetUserMedia(c);
    };

    if (MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
      var nativeGetSettings = MediaStreamTrack.prototype.getSettings;
      MediaStreamTrack.prototype.getSettings = function() {
        var obj = nativeGetSettings.apply(this, arguments);
        remap(obj, 'mozAutoGainControl', 'autoGainControl');
        remap(obj, 'mozNoiseSuppression', 'noiseSuppression');
        return obj;
      };
    }

    if (MediaStreamTrack && MediaStreamTrack.prototype.applyConstraints) {
      var nativeApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
      MediaStreamTrack.prototype.applyConstraints = function(c) {
        if (this.kind === 'audio' && typeof c === 'object') {
          c = JSON.parse(JSON.stringify(c));
          remap(c, 'autoGainControl', 'mozAutoGainControl');
          remap(c, 'noiseSuppression', 'mozNoiseSuppression');
        }
        return nativeApplyConstraints.apply(this, [c]);
      };
    }
  }
  navigator.getUserMedia = function(constraints, onSuccess, onError) {
    if (browserDetails.version < 44) {
      return getUserMedia_(constraints, onSuccess, onError);
    }
    // Replace Firefox 44+'s deprecation warning with unprefixed version.
    utils.deprecated('navigator.getUserMedia',
        'navigator.mediaDevices.getUserMedia');
    navigator.mediaDevices.getUserMedia(constraints).then(onSuccess, onError);
  };
};

},{"../utils":14}],13:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
var utils = require('../utils');

module.exports = {
  shimLocalStreamsAPI: function(window) {
    if (typeof window !== 'object' || !window.RTCPeerConnection) {
      return;
    }
    if (!('getLocalStreams' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.getLocalStreams = function() {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        return this._localStreams;
      };
    }
    if (!('getStreamById' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.getStreamById = function(id) {
        var result = null;
        if (this._localStreams) {
          this._localStreams.forEach(function(stream) {
            if (stream.id === id) {
              result = stream;
            }
          });
        }
        if (this._remoteStreams) {
          this._remoteStreams.forEach(function(stream) {
            if (stream.id === id) {
              result = stream;
            }
          });
        }
        return result;
      };
    }
    if (!('addStream' in window.RTCPeerConnection.prototype)) {
      var _addTrack = window.RTCPeerConnection.prototype.addTrack;
      window.RTCPeerConnection.prototype.addStream = function(stream) {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        if (this._localStreams.indexOf(stream) === -1) {
          this._localStreams.push(stream);
        }
        var pc = this;
        stream.getTracks().forEach(function(track) {
          _addTrack.call(pc, track, stream);
        });
      };

      window.RTCPeerConnection.prototype.addTrack = function(track, stream) {
        if (stream) {
          if (!this._localStreams) {
            this._localStreams = [stream];
          } else if (this._localStreams.indexOf(stream) === -1) {
            this._localStreams.push(stream);
          }
        }
        return _addTrack.call(this, track, stream);
      };
    }
    if (!('removeStream' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.removeStream = function(stream) {
        if (!this._localStreams) {
          this._localStreams = [];
        }
        var index = this._localStreams.indexOf(stream);
        if (index === -1) {
          return;
        }
        this._localStreams.splice(index, 1);
        var pc = this;
        var tracks = stream.getTracks();
        this.getSenders().forEach(function(sender) {
          if (tracks.indexOf(sender.track) !== -1) {
            pc.removeTrack(sender);
          }
        });
      };
    }
  },
  shimRemoteStreamsAPI: function(window) {
    if (typeof window !== 'object' || !window.RTCPeerConnection) {
      return;
    }
    if (!('getRemoteStreams' in window.RTCPeerConnection.prototype)) {
      window.RTCPeerConnection.prototype.getRemoteStreams = function() {
        return this._remoteStreams ? this._remoteStreams : [];
      };
    }
    if (!('onaddstream' in window.RTCPeerConnection.prototype)) {
      Object.defineProperty(window.RTCPeerConnection.prototype, 'onaddstream', {
        get: function() {
          return this._onaddstream;
        },
        set: function(f) {
          var pc = this;
          if (this._onaddstream) {
            this.removeEventListener('addstream', this._onaddstream);
            this.removeEventListener('track', this._onaddstreampoly);
          }
          this.addEventListener('addstream', this._onaddstream = f);
          this.addEventListener('track', this._onaddstreampoly = function(e) {
            e.streams.forEach(function(stream) {
              if (!pc._remoteStreams) {
                pc._remoteStreams = [];
              }
              if (pc._remoteStreams.indexOf(stream) >= 0) {
                return;
              }
              pc._remoteStreams.push(stream);
              var event = new Event('addstream');
              event.stream = stream;
              pc.dispatchEvent(event);
            });
          });
        }
      });
    }
  },
  shimCallbacksAPI: function(window) {
    if (typeof window !== 'object' || !window.RTCPeerConnection) {
      return;
    }
    var prototype = window.RTCPeerConnection.prototype;
    var createOffer = prototype.createOffer;
    var createAnswer = prototype.createAnswer;
    var setLocalDescription = prototype.setLocalDescription;
    var setRemoteDescription = prototype.setRemoteDescription;
    var addIceCandidate = prototype.addIceCandidate;

    prototype.createOffer = function(successCallback, failureCallback) {
      var options = (arguments.length >= 2) ? arguments[2] : arguments[0];
      var promise = createOffer.apply(this, [options]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };

    prototype.createAnswer = function(successCallback, failureCallback) {
      var options = (arguments.length >= 2) ? arguments[2] : arguments[0];
      var promise = createAnswer.apply(this, [options]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };

    var withCallback = function(description, successCallback, failureCallback) {
      var promise = setLocalDescription.apply(this, [description]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.setLocalDescription = withCallback;

    withCallback = function(description, successCallback, failureCallback) {
      var promise = setRemoteDescription.apply(this, [description]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.setRemoteDescription = withCallback;

    withCallback = function(candidate, successCallback, failureCallback) {
      var promise = addIceCandidate.apply(this, [candidate]);
      if (!failureCallback) {
        return promise;
      }
      promise.then(successCallback, failureCallback);
      return Promise.resolve();
    };
    prototype.addIceCandidate = withCallback;
  },
  shimGetUserMedia: function(window) {
    var navigator = window && window.navigator;

    if (!navigator.getUserMedia) {
      if (navigator.webkitGetUserMedia) {
        navigator.getUserMedia = navigator.webkitGetUserMedia.bind(navigator);
      } else if (navigator.mediaDevices &&
          navigator.mediaDevices.getUserMedia) {
        navigator.getUserMedia = function(constraints, cb, errcb) {
          navigator.mediaDevices.getUserMedia(constraints)
          .then(cb, errcb);
        }.bind(navigator);
      }
    }
  },
  shimRTCIceServerUrls: function(window) {
    // migrate from non-spec RTCIceServer.url to RTCIceServer.urls
    var OrigPeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = function(pcConfig, pcConstraints) {
      if (pcConfig && pcConfig.iceServers) {
        var newIceServers = [];
        for (var i = 0; i < pcConfig.iceServers.length; i++) {
          var server = pcConfig.iceServers[i];
          if (!server.hasOwnProperty('urls') &&
              server.hasOwnProperty('url')) {
            utils.deprecated('RTCIceServer.url', 'RTCIceServer.urls');
            server = JSON.parse(JSON.stringify(server));
            server.urls = server.url;
            delete server.url;
            newIceServers.push(server);
          } else {
            newIceServers.push(pcConfig.iceServers[i]);
          }
        }
        pcConfig.iceServers = newIceServers;
      }
      return new OrigPeerConnection(pcConfig, pcConstraints);
    };
    window.RTCPeerConnection.prototype = OrigPeerConnection.prototype;
    // wrap static methods. Currently just generateCertificate.
    if ('generateCertificate' in window.RTCPeerConnection) {
      Object.defineProperty(window.RTCPeerConnection, 'generateCertificate', {
        get: function() {
          return OrigPeerConnection.generateCertificate;
        }
      });
    }
  },
  shimTrackEventTransceiver: function(window) {
    // Add event.transceiver member over deprecated event.receiver
    if (typeof window === 'object' && window.RTCPeerConnection &&
        ('receiver' in window.RTCTrackEvent.prototype) &&
        // can't check 'transceiver' in window.RTCTrackEvent.prototype, as it is
        // defined for some reason even when window.RTCTransceiver is not.
        !window.RTCTransceiver) {
      Object.defineProperty(window.RTCTrackEvent.prototype, 'transceiver', {
        get: function() {
          return {receiver: this.receiver};
        }
      });
    }
  },

  shimCreateOfferLegacy: function(window) {
    var origCreateOffer = window.RTCPeerConnection.prototype.createOffer;
    window.RTCPeerConnection.prototype.createOffer = function(offerOptions) {
      var pc = this;
      if (offerOptions) {
        if (typeof offerOptions.offerToReceiveAudio !== 'undefined') {
          // support bit values
          offerOptions.offerToReceiveAudio = !!offerOptions.offerToReceiveAudio;
        }
        var audioTransceiver = pc.getTransceivers().find(function(transceiver) {
          return transceiver.sender.track &&
              transceiver.sender.track.kind === 'audio';
        });
        if (offerOptions.offerToReceiveAudio === false && audioTransceiver) {
          if (audioTransceiver.direction === 'sendrecv') {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection('sendonly');
            } else {
              audioTransceiver.direction = 'sendonly';
            }
          } else if (audioTransceiver.direction === 'recvonly') {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection('inactive');
            } else {
              audioTransceiver.direction = 'inactive';
            }
          }
        } else if (offerOptions.offerToReceiveAudio === true &&
            !audioTransceiver) {
          pc.addTransceiver('audio');
        }


        if (typeof offerOptions.offerToReceiveAudio !== 'undefined') {
          // support bit values
          offerOptions.offerToReceiveVideo = !!offerOptions.offerToReceiveVideo;
        }
        var videoTransceiver = pc.getTransceivers().find(function(transceiver) {
          return transceiver.sender.track &&
              transceiver.sender.track.kind === 'video';
        });
        if (offerOptions.offerToReceiveVideo === false && videoTransceiver) {
          if (videoTransceiver.direction === 'sendrecv') {
            videoTransceiver.setDirection('sendonly');
          } else if (videoTransceiver.direction === 'recvonly') {
            videoTransceiver.setDirection('inactive');
          }
        } else if (offerOptions.offerToReceiveVideo === true &&
            !videoTransceiver) {
          pc.addTransceiver('video');
        }
      }
      return origCreateOffer.apply(pc, arguments);
    };
  }
};

},{"../utils":14}],14:[function(require,module,exports){
/*
 *  Copyright (c) 2016 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
 /* eslint-env node */
'use strict';

var logDisabled_ = true;
var deprecationWarnings_ = true;

/**
 * Extract browser version out of the provided user agent string.
 *
 * @param {!string} uastring userAgent string.
 * @param {!string} expr Regular expression used as match criteria.
 * @param {!number} pos position in the version string to be returned.
 * @return {!number} browser version.
 */
function extractVersion(uastring, expr, pos) {
  var match = uastring.match(expr);
  return match && match.length >= pos && parseInt(match[pos], 10);
}

// Wraps the peerconnection event eventNameToWrap in a function
// which returns the modified event object.
function wrapPeerConnectionEvent(window, eventNameToWrap, wrapper) {
  if (!window.RTCPeerConnection) {
    return;
  }
  var proto = window.RTCPeerConnection.prototype;
  var nativeAddEventListener = proto.addEventListener;
  proto.addEventListener = function(nativeEventName, cb) {
    if (nativeEventName !== eventNameToWrap) {
      return nativeAddEventListener.apply(this, arguments);
    }
    var wrappedCallback = function(e) {
      cb(wrapper(e));
    };
    this._eventMap = this._eventMap || {};
    this._eventMap[cb] = wrappedCallback;
    return nativeAddEventListener.apply(this, [nativeEventName,
      wrappedCallback]);
  };

  var nativeRemoveEventListener = proto.removeEventListener;
  proto.removeEventListener = function(nativeEventName, cb) {
    if (nativeEventName !== eventNameToWrap || !this._eventMap
        || !this._eventMap[cb]) {
      return nativeRemoveEventListener.apply(this, arguments);
    }
    var unwrappedCb = this._eventMap[cb];
    delete this._eventMap[cb];
    return nativeRemoveEventListener.apply(this, [nativeEventName,
      unwrappedCb]);
  };

  Object.defineProperty(proto, 'on' + eventNameToWrap, {
    get: function() {
      return this['_on' + eventNameToWrap];
    },
    set: function(cb) {
      if (this['_on' + eventNameToWrap]) {
        this.removeEventListener(eventNameToWrap,
            this['_on' + eventNameToWrap]);
        delete this['_on' + eventNameToWrap];
      }
      if (cb) {
        this.addEventListener(eventNameToWrap,
            this['_on' + eventNameToWrap] = cb);
      }
    },
    enumerable: true,
    configurable: true
  });
}

// Utility methods.
module.exports = {
  extractVersion: extractVersion,
  wrapPeerConnectionEvent: wrapPeerConnectionEvent,
  disableLog: function(bool) {
    if (typeof bool !== 'boolean') {
      return new Error('Argument type: ' + typeof bool +
          '. Please use a boolean.');
    }
    logDisabled_ = bool;
    return (bool) ? 'adapter.js logging disabled' :
        'adapter.js logging enabled';
  },

  /**
   * Disable or enable deprecation warnings
   * @param {!boolean} bool set to true to disable warnings.
   */
  disableWarnings: function(bool) {
    if (typeof bool !== 'boolean') {
      return new Error('Argument type: ' + typeof bool +
          '. Please use a boolean.');
    }
    deprecationWarnings_ = !bool;
    return 'adapter.js deprecation warnings ' + (bool ? 'disabled' : 'enabled');
  },

  log: function() {
    if (typeof window === 'object') {
      if (logDisabled_) {
        return;
      }
      if (typeof console !== 'undefined' && typeof console.log === 'function') {
        console.log.apply(console, arguments);
      }
    }
  },

  /**
   * Shows a deprecation warning suggesting the modern and spec-compatible API.
   */
  deprecated: function(oldMethod, newMethod) {
    if (!deprecationWarnings_) {
      return;
    }
    console.warn(oldMethod + ' is deprecated, please use ' + newMethod +
        ' instead.');
  },

  /**
   * Browser detector.
   *
   * @return {object} result containing browser and version
   *     properties.
   */
  detectBrowser: function(window) {
    var navigator = window && window.navigator;

    // Returned result object.
    var result = {};
    result.browser = null;
    result.version = null;

    // Fail early if it's not a browser
    if (typeof window === 'undefined' || !window.navigator) {
      result.browser = 'Not a browser.';
      return result;
    }

    if (navigator.mozGetUserMedia) { // Firefox.
      result.browser = 'firefox';
      result.version = extractVersion(navigator.userAgent,
          /Firefox\/(\d+)\./, 1);
    } else if (navigator.webkitGetUserMedia) {
      // Chrome, Chromium, Webview, Opera.
      // Version matches Chrome/WebRTC version.
      result.browser = 'chrome';
      result.version = extractVersion(navigator.userAgent,
          /Chrom(e|ium)\/(\d+)\./, 2);
    } else if (navigator.mediaDevices &&
        navigator.userAgent.match(/Edge\/(\d+).(\d+)$/)) { // Edge.
      result.browser = 'edge';
      result.version = extractVersion(navigator.userAgent,
          /Edge\/(\d+).(\d+)$/, 2);
    } else if (window.RTCPeerConnection &&
        navigator.userAgent.match(/AppleWebKit\/(\d+)\./)) { // Safari.
      result.browser = 'safari';
      result.version = extractVersion(navigator.userAgent,
          /AppleWebKit\/(\d+)\./, 1);
    } else { // Default fallthrough: not supported.
      result.browser = 'Not a supported browser.';
      return result;
    }

    return result;
  }
};

},{}],15:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SUITES = exports.TESTS = undefined;
exports.buildMicroSuite = buildMicroSuite;
exports.buildCameraSuite = buildCameraSuite;
exports.buildNetworkSuite = buildNetworkSuite;
exports.buildConnectivitySuite = buildConnectivitySuite;
exports.buildThroughputSuite = buildThroughputSuite;

var _mic = require('../unit/mic.js');

var _mic2 = _interopRequireDefault(_mic);

var _conn = require('../unit/conn.js');

var _conn2 = _interopRequireDefault(_conn);

var _camresolutions = require('../unit/camresolutions.js');

var _camresolutions2 = _interopRequireDefault(_camresolutions);

var _net = require('../unit/net.js');

var _net2 = _interopRequireDefault(_net);

var _dataBandwidth = require('../unit/dataBandwidth.js');

var _dataBandwidth2 = _interopRequireDefault(_dataBandwidth);

var _videoBandwidth = require('../unit/videoBandwidth.js');

var _videoBandwidth2 = _interopRequireDefault(_videoBandwidth);

var _wifiPeriodicScan = require('../unit/wifiPeriodicScan.js');

var _wifiPeriodicScan2 = _interopRequireDefault(_wifiPeriodicScan);

var _call = require('../util/call.js');

var _call2 = _interopRequireDefault(_call);

var _suite = require('./suite.js');

var _suite2 = _interopRequireDefault(_suite);

var _testCase = require('./testCase.js');

var _testCase2 = _interopRequireDefault(_testCase);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var TESTS = exports.TESTS = {
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

var SUITES = exports.SUITES = {
  CAMERA: 'Camera',
  MICROPHONE: 'Microphone',
  NETWORK: 'Network',
  CONNECTIVITY: 'Connectivity',
  THROUGHPUT: 'Throughput'
};

function buildMicroSuite(config, filter) {
  var micSuite = new _suite2.default(SUITES.MICROPHONE, config);

  if (!filter.includes(TESTS.AUDIOCAPTURE)) {
    micSuite.add(new _testCase2.default(micSuite, TESTS.AUDIOCAPTURE, function (test) {
      var micTest = new _mic2.default(test);
      micTest.run();
    }));
  }

  return micSuite;
}

function buildCameraSuite(config) {
  var cameraSuite = new _suite2.default(SUITES.CAMERA, config);

  if (!filter.includes(TESTS.CHECKRESOLUTION240)) {
    cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKRESOLUTION240, function (test) {
      var camResolutionsTest = new _camresolutions2.default(test, [[320, 240]]);
      camResolutionsTest.run();
    }));
  }

  if (!filter.includes(TESTS.CHECKRESOLUTION480)) {
    cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKRESOLUTION480, function (test) {
      var camResolutionsTest = new _camresolutions2.default(test, [[640, 480]]);
      camResolutionsTest.run();
    }));
  }

  if (!filter.includes(TESTS.CHECKRESOLUTION720)) {
    cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKRESOLUTION720, function (test) {
      var camResolutionsTest = new _camresolutions2.default(test, [[1280, 720]]);
      camResolutionsTest.run();
    }));
  }

  if (!filter.includes(TESTS.CHECKSUPPORTEDRESOLUTIONS)) {
    cameraSuite.add(new _testCase2.default(cameraSuite, TESTS.CHECKSUPPORTEDRESOLUTIONS, function (test) {
      var resolutionArray = [[160, 120], [320, 180], [320, 240], [640, 360], [640, 480], [768, 576], [1024, 576], [1280, 720], [1280, 768], [1280, 800], [1920, 1080], [1920, 1200], [3840, 2160], [4096, 2160]];
      var camResolutionsTest = new _camresolutions2.default(test, resolutionArray);
      camResolutionsTest.run();
    }));
  }

  return cameraSuite;
}

function buildNetworkSuite(config) {
  var networkSuite = new _suite2.default(SUITES.NETWORK, config);

  if (!filter.includes(TESTS.UDPENABLED)) {
    // Test whether it can connect via UDP to a TURN server
    // Get a TURN config, and try to get a relay candidate using UDP.
    networkSuite.add(new _testCase2.default(networkSuite, TESTS.UDPENABLED, function (test) {
      var networkTest = new _net2.default(test, 'udp', null, _call2.default.isRelay);
      networkTest.run();
    }));
  }

  if (!filter.includes(TESTS.TCPENABLED)) {
    // Test whether it can connect via TCP to a TURN server
    // Get a TURN config, and try to get a relay candidate using TCP.
    networkSuite.add(new _testCase2.default(networkSuite, TESTS.TCPENABLED, function (test) {
      var networkTest = new _net2.default(test, 'tcp', null, _call2.default.isRelay);
      networkTest.run();
    }));
  }

  if (!filter.includes(TESTS.IPV6ENABLED)) {
    // Test whether it is IPv6 enabled (TODO: test IPv6 to a destination).
    // Turn on IPv6, and try to get an IPv6 host candidate.
    networkSuite.add(new _testCase2.default(networkSuite, TESTS.IPV6ENABLED, function (test) {
      var params = { optional: [{ googIPv6: true }] };
      var networkTest = new _net2.default(test, null, params, _call2.default.isIpv6);
      networkTest.run();
    }));
  }

  return networkSuite;
}

function buildConnectivitySuite(config) {
  var connectivitySuite = new _suite2.default(SUITES.CONNECTIVITY, config);

  if (!filter.includes(TESTS.RELAYCONNECTIVITY)) {
    // Set up a datachannel between two peers through a relay
    // and verify data can be transmitted and received
    // (packets travel through the public internet)
    connectivitySuite.add(new _testCase2.default(connectivitySuite, TESTS.RELAYCONNECTIVITY, function (test) {
      var runConnectivityTest = new _conn2.default(test, _call2.default.isRelay);
      runConnectivityTest.run();
    }));
  }

  if (!filter.includes(TESTS.REFLEXIVECONNECTIVITY)) {
    // Set up a datachannel between two peers through a public IP address
    // and verify data can be transmitted and received
    // (packets should stay on the link if behind a router doing NAT)
    connectivitySuite.add(new _testCase2.default(connectivitySuite, TESTS.REFLEXIVECONNECTIVITY, function (test) {
      var runConnectivityTest = new _conn2.default(test, _call2.default.isReflexive);
      runConnectivityTest.run();
    }));
  }

  if (!filter.includes(TESTS.HOSTCONNECTIVITY)) {
    // Set up a datachannel between two peers through a local IP address
    // and verify data can be transmitted and received
    // (packets should not leave the machine running the test)
    connectivitySuite.add(new _testCase2.default(connectivitySuite, TESTS.HOSTCONNECTIVITY, function (test) {
      var runConnectivityTest = new _conn2.default(test, _call2.default.isHost);
      runConnectivityTest.start();
    }));
  }

  return connectivitySuite;
}

function buildThroughputSuite(config) {
  var throughputSuite = new _suite2.default(SUITES.THROUGHPUT, config);

  if (!filter.includes(TESTS.DATATHROUGHPUT)) {
    // Creates a loopback via relay candidates and tries to send as many packets
    // with 1024 chars as possible while keeping dataChannel bufferedAmmount above
    // zero.
    throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.DATATHROUGHPUT, function (test) {
      var dataChannelThroughputTest = new _dataBandwidth2.default(test);
      dataChannelThroughputTest.run();
    }));
  }

  if (!filter.includes(TESTS.VIDEOBANDWIDTH)) {
    // Measures video bandwidth estimation performance by doing a loopback call via
    // relay candidates for 40 seconds. Computes rtt and bandwidth estimation
    // average and maximum as well as time to ramp up (defined as reaching 75% of
    // the max bitrate. It reports infinite time to ramp up if never reaches it.
    throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.VIDEOBANDWIDTH, function (test) {
      var videoBandwidthTest = new _videoBandwidth2.default(test);
      videoBandwidthTest.run();
    }));
  }

  if (!filter.includes(TESTS.NETWORKLATENCY)) {
    throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.NETWORKLATENCY, function (test) {
      var wiFiPeriodicScanTest = new _wifiPeriodicScan2.default(test, _call2.default.isNotHostCandidate);
      wiFiPeriodicScanTest.run();
    }));
  }

  if (!filter.includes(TESTS.NETWORKLATENCYRELAY)) {
    throughputSuite.add(new _testCase2.default(throughputSuite, TESTS.NETWORKLATENCYRELAY, function (test) {
      var wiFiPeriodicScanTest = new _wifiPeriodicScan2.default(test, _call2.default.isRelay);
      wiFiPeriodicScanTest.run();
    }));
  }

  return throughputSuite;
}

},{"../unit/camresolutions.js":20,"../unit/conn.js":21,"../unit/dataBandwidth.js":22,"../unit/mic.js":23,"../unit/net.js":24,"../unit/videoBandwidth.js":25,"../unit/wifiPeriodicScan.js":26,"../util/call.js":29,"./suite.js":16,"./testCase.js":17}],16:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var Suite = function () {
  function Suite(name, config) {
    _classCallCheck(this, Suite);

    this.name = name;
    this.settings = config;
    this.tests = [];
  }

  _createClass(Suite, [{
    key: "getTests",
    value: function getTests() {
      return this.tests;
    }
  }, {
    key: "add",
    value: function add(test) {
      this.tests.push(test);
    }
  }]);

  return Suite;
}();

exports.default = Suite;

},{}],17:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var TestCase = function () {
  function TestCase(suite, name, fn) {
    _classCallCheck(this, TestCase);

    this.suite = suite;
    this.settings = this.suite.settings;
    this.name = name;
    this.fn = fn;
    this.progress = 0;
    this.status = 'waiting';
  }

  _createClass(TestCase, [{
    key: 'setProgress',
    value: function setProgress(value) {
      this.progress = value;
      this.callbacks.onTestProgress(this.suite.name, this.name, value);
    }
  }, {
    key: 'run',
    value: function run(callbacks, doneCallback) {
      this.fn(this);
      this.callbacks = callbacks;
      this.doneCallback = doneCallback;
      this.setProgress(0);
    }
  }, {
    key: 'reportInfo',
    value: function reportInfo(m) {
      this.callbacks.onTestReport(this.suite.name, this.name, 'info', m);
    }
  }, {
    key: 'reportSuccess',
    value: function reportSuccess(m) {
      this.callbacks.onTestReport(this.suite.name, this.name, 'success', m);
      this.status = 'success';
    }
  }, {
    key: 'reportError',
    value: function reportError(m) {
      this.callbacks.onTestReport(this.suite.name, this.name, 'error', m);
      this.status = 'error';
    }
  }, {
    key: 'reportWarning',
    value: function reportWarning(m) {
      this.callbacks.onTestReport(this.suite.name, this.name, 'warning', m);
      this.status = 'warning';
    }
  }, {
    key: 'reportFatal',
    value: function reportFatal(m) {
      this.callbacks.onTestReport(this.suite.name, this.name, 'error', m);
      this.status = 'error';
    }
  }, {
    key: 'done',
    value: function done() {
      if (this.progress < 100) this.setProgress(100);
      this.callbacks.onTestResult(this.suite.name, this.name, this.status);
      this.doneCallback();
    }
  }, {
    key: 'doGetUserMedia',
    value: function doGetUserMedia(constraints, onSuccess, onFail) {
      var self = this;
      try {
        // Call into getUserMedia via the polyfill (adapter.js).
        navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
          var cam = self.getDeviceName_(stream.getVideoTracks());
          var mic = self.getDeviceName_(stream.getAudioTracks());
          onSuccess.apply(this, arguments);
        }).catch(function (error) {
          if (onFail) {
            onFail.apply(this, arguments);
          } else {
            self.reportFatal('Failed to get access to local media due to ' + 'error: ' + error.name);
          }
        });
      } catch (e) {
        return this.reportFatal('getUserMedia failed with exception: ' + e.message);
      }
    }
  }, {
    key: 'setTimeoutWithProgressBar',
    value: function setTimeoutWithProgressBar(timeoutCallback, timeoutMs) {
      var start = window.performance.now();
      var self = this;
      var updateProgressBar = setInterval(function () {
        var now = window.performance.now();
        self.setProgress((now - start) * 100 / timeoutMs);
      }, 100);
      var timeoutTask = function timeoutTask() {
        clearInterval(updateProgressBar);
        self.setProgress(100);
        timeoutCallback();
      };
      var timer = setTimeout(timeoutTask, timeoutMs);
      var finishProgressBar = function finishProgressBar() {
        clearTimeout(timer);
        timeoutTask();
      };
      return finishProgressBar;
    }
  }, {
    key: 'getDeviceName_',
    value: function getDeviceName_(tracks) {
      if (tracks.length === 0) {
        return null;
      }
      return tracks[0].label;
    }
  }]);

  return TestCase;
}();

exports.default = TestCase;

},{}],18:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _config = require('./config');

var Config = _interopRequireWildcard(_config);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function runAllSequentially(tasks, callbacks) {
  var current = -1;
  var runNextAsync = setTimeout.bind(null, runNext);
  runNextAsync();
  function runNext() {
    current++;
    if (current === tasks.length) {
      callbacks.onComplete();
      return;
    }
    tasks[current].run(callbacks, runNextAsync);
  }
}

var TestRTC = function () {
  function TestRTC() {
    var config = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};
    var filter = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : [];

    _classCallCheck(this, TestRTC);

    this.SUITES = Config.SUITES;
    this.TESTS = Config.TESTS;
    this.config = config;
    this.callbacks = {
      onTestProgress: function onTestProgress() {},
      onTestResult: function onTestResult() {},
      onTestReport: function onTestReport() {},
      onComplete: function onComplete() {}
    };

    this.suites = [];

    if (!filter.includes(this.SUITES.MICROPHONE)) {
      var micSuite = Config.buildMicroSuite(this.config, filter);
      this.suites.push(micSuite);
    }

    if (!filter.includes(this.SUITES.CAMERA)) {
      var cameraSuite = Config.buildCameraSuite(this.config, filter);
      this.suites.push(cameraSuite);
    }

    if (!filter.includes(this.SUITES.NETWORK)) {
      var networkSuite = Config.buildNetworkSuite(this.config, filter);
      this.suites.push(networkSuite);
    }

    if (!filter.includes(this.SUITES.CONNECTIVITY)) {
      var connectivitySuite = Config.buildConnectivitySuite(this.config, filter);
      this.suites.push(connectivitySuite);
    }

    if (!filter.includes(this.SUITES.THROUGHPUT)) {
      var throughputSuite = Config.buildThroughputSuite(this.config, filter);
      this.suites.push(throughputSuite);
    }
  }

  _createClass(TestRTC, [{
    key: 'getSuites',
    value: function getSuites() {
      return this.suites;
    }
  }, {
    key: 'getTests',
    value: function getTests() {
      return this.suites.reduce(function (all, suite) {
        return all.concat(suite.getTests());
      }, []);
    }
  }, {
    key: 'onTestProgress',
    value: function onTestProgress() {
      var callback = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function () {};

      this.callbacks.onTestProgress = callback;
    }
  }, {
    key: 'onTestResult',
    value: function onTestResult() {
      var callback = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function () {};

      this.callbacks.onTestResult = callback;
    }
  }, {
    key: 'onTestReport',
    value: function onTestReport() {
      var callback = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function () {};

      this.callbacks.onTestReport = callback;
    }
  }, {
    key: 'onComplete',
    value: function onComplete() {
      var callback = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function () {};

      this.callbacks.onComplete = callback;
    }
  }, {
    key: 'start',
    value: function start() {
      var allTests = this.getTests();
      runAllSequentially(allTests, this.callbacks);
    }
  }, {
    key: 'stop',
    value: function stop() {}
  }]);

  return TestRTC;
}();

TestRTC.SUITES = Config.SUITES;
TestRTC.TESTS = Config.TESTS;
window.TestRTC = TestRTC;
exports.default = TestRTC;

},{"./config":15}],19:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _VideoFrameChecker = require('../util/VideoFrameChecker.js');

var _VideoFrameChecker2 = _interopRequireDefault(_VideoFrameChecker);

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

var _report = require('../util/report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('../util/util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();
/*
 * In generic cameras using Chrome rescaler, all resolutions should be supported
 * up to a given one and none beyond there. Special cameras, such as digitizers,
 * might support only one resolution.
 */

/*
 * "Analyze performance for "resolution"" test uses getStats, canvas and the
 * video element to analyze the video frames from a capture device. It will
 * report number of black frames, frozen frames, tested frames and various stats
 * like average encode time and FPS. A test case will be created per mandatory
 * resolution found in the "resolutions" array.
 */

function CamResolutionsTest(test, resolutions) {
  this.test = test;
  this.resolutions = resolutions;
  this.currentResolution = 0;
  this.isMuted = false;
  this.isShuttingDown = false;
}

CamResolutionsTest.prototype = {
  run: function run() {
    this.startGetUserMedia(this.resolutions[this.currentResolution]);
  },

  startGetUserMedia: function startGetUserMedia(resolution) {
    var constraints = {
      audio: false,
      video: {
        width: { exact: resolution[0] },
        height: { exact: resolution[1] }
      }
    };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      // Do not check actual video frames when more than one resolution is
      // provided.
      if (this.resolutions.length > 1) {
        this.test.reportSuccess('Supported: ' + resolution[0] + 'x' + resolution[1]);
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        this.maybeContinueGetUserMedia();
      } else {
        this.collectAndAnalyzeStats_(stream, resolution);
      }
    }.bind(this)).catch(function (error) {
      if (this.resolutions.length > 1) {
        this.test.reportInfo(resolution[0] + 'x' + resolution[1] + ' not supported');
      } else {
        console.error(error);
        console.dir(constraints);
        this.test.reportError('getUserMedia failed with error: ' + error.name);
      }
      this.maybeContinueGetUserMedia();
    }.bind(this));
  },

  maybeContinueGetUserMedia: function maybeContinueGetUserMedia() {
    if (this.currentResolution === this.resolutions.length) {
      this.test.done();
      return;
    }
    this.startGetUserMedia(this.resolutions[this.currentResolution++]);
  },

  collectAndAnalyzeStats_: function collectAndAnalyzeStats_(stream, resolution) {
    var tracks = stream.getVideoTracks();
    if (tracks.length < 1) {
      this.test.reportError('No video track in returned stream.');
      this.maybeContinueGetUserMedia();
      return;
    }

    // Firefox does not support event handlers on mediaStreamTrack yet.
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack
    // TODO: remove if (...) when event handlers are supported by Firefox.
    var videoTrack = tracks[0];
    if (typeof videoTrack.addEventListener === 'function') {
      // Register events.
      videoTrack.addEventListener('ended', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportError('Video track ended, camera stopped working');
      }.bind(this));
      videoTrack.addEventListener('mute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportWarning('Your camera reported itself as muted.');
        // MediaStreamTrack.muted property is not wired up in Chrome yet,
        // checking isMuted local state.
        this.isMuted = true;
      }.bind(this));
      videoTrack.addEventListener('unmute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportInfo('Your camera reported itself as unmuted.');
        this.isMuted = false;
      }.bind(this));
    }

    var video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.width = resolution[0];
    video.height = resolution[1];
    video.srcObject = stream;
    var frameChecker = new _VideoFrameChecker2.default(video);
    var call = new _Call2.default(null, this.test);
    call.pc1.addStream(stream);
    call.establishConnection();
    call.gatherStats(call.pc1, null, stream, this.onCallEnded_.bind(this, resolution, video, stream, frameChecker), 100);

    this.test.setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
  },

  onCallEnded_: function onCallEnded_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    this.analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime);

    frameChecker.stop();

    this.test.done();
  },

  analyzeStats_: function analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    var googAvgEncodeTime = [];
    var googAvgFrameRateInput = [];
    var googAvgFrameRateSent = [];
    var statsReport = {};
    var frameStats = frameChecker.frameStats;

    for (var index in stats) {
      if (stats[index].type === 'ssrc') {
        // Make sure to only capture stats after the encoder is setup.
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          googAvgEncodeTime.push(parseInt(stats[index].googAvgEncodeMs));
          googAvgFrameRateInput.push(parseInt(stats[index].googFrameRateInput));
          googAvgFrameRateSent.push(parseInt(stats[index].googFrameRateSent));
        }
      }
    }

    statsReport.cameraName = stream.getVideoTracks()[0].label || NaN;
    statsReport.actualVideoWidth = videoElement.videoWidth;
    statsReport.actualVideoHeight = videoElement.videoHeight;
    statsReport.mandatoryWidth = resolution[0];
    statsReport.mandatoryHeight = resolution[1];
    statsReport.encodeSetupTimeMs = this.extractEncoderSetupTime_(stats, statsTime);
    statsReport.avgEncodeTimeMs = (0, _util.arrayAverage)(googAvgEncodeTime);
    statsReport.minEncodeTimeMs = (0, _util.arrayMin)(googAvgEncodeTime);
    statsReport.maxEncodeTimeMs = (0, _util.arrayMax)(googAvgEncodeTime);
    statsReport.avgInputFps = (0, _util.arrayAverage)(googAvgFrameRateInput);
    statsReport.minInputFps = (0, _util.arrayMin)(googAvgFrameRateInput);
    statsReport.maxInputFps = (0, _util.arrayMax)(googAvgFrameRateInput);
    statsReport.avgSentFps = (0, _util.arrayAverage)(googAvgFrameRateSent);
    statsReport.minSentFps = (0, _util.arrayMin)(googAvgFrameRateSent);
    statsReport.maxSentFps = (0, _util.arrayMax)(googAvgFrameRateSent);
    statsReport.isMuted = this.isMuted;
    statsReport.testedFrames = frameStats.numFrames;
    statsReport.blackFrames = frameStats.numBlackFrames;
    statsReport.frozenFrames = frameStats.numFrozenFrames;

    // TODO: Add a reportInfo() function with a table format to display
    // values clearer.
    report.traceEventInstant('video-stats', statsReport);

    this.testExpectations_(statsReport);
  },

  endCall_: function endCall_(callObject, stream) {
    this.isShuttingDown = true;
    stream.getTracks().forEach(function (track) {
      track.stop();
    });
    callObject.close();
  },

  extractEncoderSetupTime_: function extractEncoderSetupTime_(stats, statsTime) {
    for (var index = 0; index !== stats.length; index++) {
      if (stats[index].type === 'ssrc') {
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          return JSON.stringify(statsTime[index] - statsTime[0]);
        }
      }
    }
    return NaN;
  },

  resolutionMatchesIndependentOfRotationOrCrop_: function resolutionMatchesIndependentOfRotationOrCrop_(aWidth, aHeight, bWidth, bHeight) {
    var minRes = Math.min(bWidth, bHeight);
    return aWidth === bWidth && aHeight === bHeight || aWidth === bHeight && aHeight === bWidth || aWidth === minRes && bHeight === minRes;
  },

  testExpectations_: function testExpectations_(info) {
    var notAvailableStats = [];
    for (var key in info) {
      if (info.hasOwnProperty(key)) {
        if (typeof info[key] === 'number' && isNaN(info[key])) {
          notAvailableStats.push(key);
        } else {
          this.test.reportInfo(key + ': ' + info[key]);
        }
      }
    }
    if (notAvailableStats.length !== 0) {
      this.test.reportInfo('Not available: ' + notAvailableStats.join(', '));
    }

    if (isNaN(info.avgSentFps)) {
      this.test.reportInfo('Cannot verify sent FPS.');
    } else if (info.avgSentFps < 5) {
      this.test.reportError('Low average sent FPS: ' + info.avgSentFps);
    } else {
      this.test.reportSuccess('Average FPS above threshold');
    }
    if (!this.resolutionMatchesIndependentOfRotationOrCrop_(info.actualVideoWidth, info.actualVideoHeight, info.mandatoryWidth, info.mandatoryHeight)) {
      this.test.reportError('Incorrect captured resolution.');
    } else {
      this.test.reportSuccess('Captured video using expected resolution.');
    }
    if (info.testedFrames === 0) {
      this.test.reportError('Could not analyze any video frame.');
    } else {
      if (info.blackFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of black frames.');
      }
      if (info.frozenFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of frozen frames.');
      }
    }
  }
};

exports.default = CamResolutionsTest;

},{"../util/Call.js":27,"../util/VideoFrameChecker.js":28,"../util/report.js":30,"../util/util.js":33}],20:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _VideoFrameChecker = require('../util/VideoFrameChecker.js');

var _VideoFrameChecker2 = _interopRequireDefault(_VideoFrameChecker);

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

var _report = require('../util/report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('../util/util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();
/*
 * In generic cameras using Chrome rescaler, all resolutions should be supported
 * up to a given one and none beyond there. Special cameras, such as digitizers,
 * might support only one resolution.
 */

/*
 * "Analyze performance for "resolution"" test uses getStats, canvas and the
 * video element to analyze the video frames from a capture device. It will
 * report number of black frames, frozen frames, tested frames and various stats
 * like average encode time and FPS. A test case will be created per mandatory
 * resolution found in the "resolutions" array.
 */

function CamResolutionsTest(test, resolutions) {
  this.test = test;
  this.resolutions = resolutions;
  this.currentResolution = 0;
  this.isMuted = false;
  this.isShuttingDown = false;
}

CamResolutionsTest.prototype = {
  run: function run() {
    this.startGetUserMedia(this.resolutions[this.currentResolution]);
  },

  startGetUserMedia: function startGetUserMedia(resolution) {
    var constraints = {
      audio: false,
      video: {
        width: { exact: resolution[0] },
        height: { exact: resolution[1] }
      }
    };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      // Do not check actual video frames when more than one resolution is
      // provided.
      if (this.resolutions.length > 1) {
        this.test.reportSuccess('Supported: ' + resolution[0] + 'x' + resolution[1]);
        stream.getTracks().forEach(function (track) {
          track.stop();
        });
        this.maybeContinueGetUserMedia();
      } else {
        this.collectAndAnalyzeStats_(stream, resolution);
      }
    }.bind(this)).catch(function (error) {
      if (this.resolutions.length > 1) {
        this.test.reportInfo(resolution[0] + 'x' + resolution[1] + ' not supported');
      } else {
        console.error(error);
        console.dir(constraints);
        this.test.reportError('getUserMedia failed with error: ' + error.name);
      }
      this.maybeContinueGetUserMedia();
    }.bind(this));
  },

  maybeContinueGetUserMedia: function maybeContinueGetUserMedia() {
    if (this.currentResolution === this.resolutions.length) {
      this.test.done();
      return;
    }
    this.startGetUserMedia(this.resolutions[this.currentResolution++]);
  },

  collectAndAnalyzeStats_: function collectAndAnalyzeStats_(stream, resolution) {
    var tracks = stream.getVideoTracks();
    if (tracks.length < 1) {
      this.test.reportError('No video track in returned stream.');
      this.maybeContinueGetUserMedia();
      return;
    }

    // Firefox does not support event handlers on mediaStreamTrack yet.
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack
    // TODO: remove if (...) when event handlers are supported by Firefox.
    var videoTrack = tracks[0];
    if (typeof videoTrack.addEventListener === 'function') {
      // Register events.
      videoTrack.addEventListener('ended', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportError('Video track ended, camera stopped working');
      }.bind(this));
      videoTrack.addEventListener('mute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportWarning('Your camera reported itself as muted.');
        // MediaStreamTrack.muted property is not wired up in Chrome yet,
        // checking isMuted local state.
        this.isMuted = true;
      }.bind(this));
      videoTrack.addEventListener('unmute', function () {
        // Ignore events when shutting down the test.
        if (this.isShuttingDown) {
          return;
        }
        this.test.reportInfo('Your camera reported itself as unmuted.');
        this.isMuted = false;
      }.bind(this));
    }

    var video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.width = resolution[0];
    video.height = resolution[1];
    video.srcObject = stream;
    var frameChecker = new _VideoFrameChecker2.default(video);
    var call = new _Call2.default(null, this.test);
    call.pc1.addStream(stream);
    call.establishConnection();
    call.gatherStats(call.pc1, null, stream, this.onCallEnded_.bind(this, resolution, video, stream, frameChecker), 100);

    this.test.setTimeoutWithProgressBar(this.endCall_.bind(this, call, stream), 8000);
  },

  onCallEnded_: function onCallEnded_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    this.analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime);

    frameChecker.stop();

    this.test.done();
  },

  analyzeStats_: function analyzeStats_(resolution, videoElement, stream, frameChecker, stats, statsTime) {
    var googAvgEncodeTime = [];
    var googAvgFrameRateInput = [];
    var googAvgFrameRateSent = [];
    var statsReport = {};
    var frameStats = frameChecker.frameStats;

    for (var index in stats) {
      if (stats[index].type === 'ssrc') {
        // Make sure to only capture stats after the encoder is setup.
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          googAvgEncodeTime.push(parseInt(stats[index].googAvgEncodeMs));
          googAvgFrameRateInput.push(parseInt(stats[index].googFrameRateInput));
          googAvgFrameRateSent.push(parseInt(stats[index].googFrameRateSent));
        }
      }
    }

    statsReport.cameraName = stream.getVideoTracks()[0].label || NaN;
    statsReport.actualVideoWidth = videoElement.videoWidth;
    statsReport.actualVideoHeight = videoElement.videoHeight;
    statsReport.mandatoryWidth = resolution[0];
    statsReport.mandatoryHeight = resolution[1];
    statsReport.encodeSetupTimeMs = this.extractEncoderSetupTime_(stats, statsTime);
    statsReport.avgEncodeTimeMs = (0, _util.arrayAverage)(googAvgEncodeTime);
    statsReport.minEncodeTimeMs = (0, _util.arrayMin)(googAvgEncodeTime);
    statsReport.maxEncodeTimeMs = (0, _util.arrayMax)(googAvgEncodeTime);
    statsReport.avgInputFps = (0, _util.arrayAverage)(googAvgFrameRateInput);
    statsReport.minInputFps = (0, _util.arrayMin)(googAvgFrameRateInput);
    statsReport.maxInputFps = (0, _util.arrayMax)(googAvgFrameRateInput);
    statsReport.avgSentFps = (0, _util.arrayAverage)(googAvgFrameRateSent);
    statsReport.minSentFps = (0, _util.arrayMin)(googAvgFrameRateSent);
    statsReport.maxSentFps = (0, _util.arrayMax)(googAvgFrameRateSent);
    statsReport.isMuted = this.isMuted;
    statsReport.testedFrames = frameStats.numFrames;
    statsReport.blackFrames = frameStats.numBlackFrames;
    statsReport.frozenFrames = frameStats.numFrozenFrames;

    // TODO: Add a reportInfo() function with a table format to display
    // values clearer.
    report.traceEventInstant('video-stats', statsReport);

    this.testExpectations_(statsReport);
  },

  endCall_: function endCall_(callObject, stream) {
    this.isShuttingDown = true;
    stream.getTracks().forEach(function (track) {
      track.stop();
    });
    callObject.close();
  },

  extractEncoderSetupTime_: function extractEncoderSetupTime_(stats, statsTime) {
    for (var index = 0; index !== stats.length; index++) {
      if (stats[index].type === 'ssrc') {
        if (parseInt(stats[index].googFrameRateInput) > 0) {
          return JSON.stringify(statsTime[index] - statsTime[0]);
        }
      }
    }
    return NaN;
  },

  resolutionMatchesIndependentOfRotationOrCrop_: function resolutionMatchesIndependentOfRotationOrCrop_(aWidth, aHeight, bWidth, bHeight) {
    var minRes = Math.min(bWidth, bHeight);
    return aWidth === bWidth && aHeight === bHeight || aWidth === bHeight && aHeight === bWidth || aWidth === minRes && bHeight === minRes;
  },

  testExpectations_: function testExpectations_(info) {
    var notAvailableStats = [];
    for (var key in info) {
      if (info.hasOwnProperty(key)) {
        if (typeof info[key] === 'number' && isNaN(info[key])) {
          notAvailableStats.push(key);
        } else {
          this.test.reportInfo(key + ': ' + info[key]);
        }
      }
    }
    if (notAvailableStats.length !== 0) {
      this.test.reportInfo('Not available: ' + notAvailableStats.join(', '));
    }

    if (isNaN(info.avgSentFps)) {
      this.test.reportInfo('Cannot verify sent FPS.');
    } else if (info.avgSentFps < 5) {
      this.test.reportError('Low average sent FPS: ' + info.avgSentFps);
    } else {
      this.test.reportSuccess('Average FPS above threshold');
    }
    if (!this.resolutionMatchesIndependentOfRotationOrCrop_(info.actualVideoWidth, info.actualVideoHeight, info.mandatoryWidth, info.mandatoryHeight)) {
      this.test.reportError('Incorrect captured resolution.');
    } else {
      this.test.reportSuccess('Captured video using expected resolution.');
    }
    if (info.testedFrames === 0) {
      this.test.reportError('Could not analyze any video frame.');
    } else {
      if (info.blackFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of black frames.');
      }
      if (info.frozenFrames > info.testedFrames / 3) {
        this.test.reportError('Camera delivering lots of frozen frames.');
      }
    }
  }
};

exports.default = CamResolutionsTest;

},{"../util/Call.js":27,"../util/VideoFrameChecker.js":28,"../util/report.js":30,"../util/util.js":33}],21:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function RunConnectivityTest(test, iceCandidateFilter) {
  this.test = test;
  this.iceCandidateFilter = iceCandidateFilter;
  this.timeout = null;
  this.parsedCandidates = [];
  this.call = null;
}

RunConnectivityTest.prototype = {
  run: function run() {
    _Call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.call = new _Call2.default(config, this.test);
    this.call.setIceCandidateFilter(this.iceCandidateFilter);

    // Collect all candidates for validation.
    this.call.pc1.addEventListener('icecandidate', function (event) {
      if (event.candidate) {
        var parsedCandidate = _Call2.default.parseCandidate(event.candidate.candidate);
        this.parsedCandidates.push(parsedCandidate);

        // Report candidate info based on iceCandidateFilter.
        if (this.iceCandidateFilter(parsedCandidate)) {
          this.test.reportInfo('Gathered candidate of Type: ' + parsedCandidate.type + ' Protocol: ' + parsedCandidate.protocol + ' Address: ' + parsedCandidate.address);
        }
      }
    }.bind(this));

    var ch1 = this.call.pc1.createDataChannel(null);
    ch1.addEventListener('open', function () {
      ch1.send('hello');
    });
    ch1.addEventListener('message', function (event) {
      if (event.data !== 'world') {
        this.test.reportError('Invalid data transmitted.');
      } else {
        this.test.reportSuccess('Data successfully transmitted between peers.');
      }
      this.hangup();
    }.bind(this));
    this.call.pc2.addEventListener('datachannel', function (event) {
      var ch2 = event.channel;
      ch2.addEventListener('message', function (event) {
        if (event.data !== 'hello') {
          this.hangup('Invalid data transmitted.');
        } else {
          ch2.send('world');
        }
      }.bind(this));
    }.bind(this));
    this.call.establishConnection();
    this.timeout = setTimeout(this.hangup.bind(this, 'Timed out'), 5000);
  },

  findParsedCandidateOfSpecifiedType: function findParsedCandidateOfSpecifiedType(candidateTypeMethod) {
    for (var candidate in this.parsedCandidates) {
      if (candidateTypeMethod(this.parsedCandidates[candidate])) {
        return candidateTypeMethod(this.parsedCandidates[candidate]);
      }
    }
  },

  hangup: function hangup(errorMessage) {
    if (errorMessage) {
      // Report warning for server reflexive test if it times out.
      if (errorMessage === 'Timed out' && this.iceCandidateFilter.toString() === _Call2.default.isReflexive.toString() && this.findParsedCandidateOfSpecifiedType(_Call2.default.isReflexive)) {
        this.test.reportWarning('Could not connect using reflexive ' + 'candidates, likely due to the network environment/configuration.');
      } else {
        this.test.reportError(errorMessage);
      }
    }
    clearTimeout(this.timeout);
    this.call.close();
    this.test.done();
  }
};

exports.default = RunConnectivityTest;

},{"../util/Call.js":27}],22:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function DataChannelThroughputTest(test) {
  this.test = test;
  this.testDurationSeconds = 5.0;
  this.startTime = null;
  this.sentPayloadBytes = 0;
  this.receivedPayloadBytes = 0;
  this.stopSending = false;
  this.samplePacket = '';

  for (var i = 0; i !== 1024; ++i) {
    this.samplePacket += 'h';
  }

  this.maxNumberOfPacketsToSend = 1;
  this.bytesToKeepBuffered = 1024 * this.maxNumberOfPacketsToSend;
  this.lastBitrateMeasureTime = null;
  this.lastReceivedPayloadBytes = 0;

  this.call = null;
  this.senderChannel = null;
  this.receiveChannel = null;
}

DataChannelThroughputTest.prototype = {
  run: function run() {
    _Call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.call = new _Call2.default(config, this.test);
    this.call.setIceCandidateFilter(_Call2.default.isRelay);
    this.senderChannel = this.call.pc1.createDataChannel(null);
    this.senderChannel.addEventListener('open', this.sendingStep.bind(this));

    this.call.pc2.addEventListener('datachannel', this.onReceiverChannel.bind(this));

    this.call.establishConnection();
  },

  onReceiverChannel: function onReceiverChannel(event) {
    this.receiveChannel = event.channel;
    this.receiveChannel.addEventListener('message', this.onMessageReceived.bind(this));
  },

  sendingStep: function sendingStep() {
    var now = new Date();
    if (!this.startTime) {
      this.startTime = now;
      this.lastBitrateMeasureTime = now;
    }

    for (var i = 0; i !== this.maxNumberOfPacketsToSend; ++i) {
      if (this.senderChannel.bufferedAmount >= this.bytesToKeepBuffered) {
        break;
      }
      this.sentPayloadBytes += this.samplePacket.length;
      this.senderChannel.send(this.samplePacket);
    }

    if (now - this.startTime >= 1000 * this.testDurationSeconds) {
      this.test.setProgress(100);
      this.stopSending = true;
    } else {
      this.test.setProgress((now - this.startTime) / (10 * this.testDurationSeconds));
      setTimeout(this.sendingStep.bind(this), 1);
    }
  },

  onMessageReceived: function onMessageReceived(event) {
    this.receivedPayloadBytes += event.data.length;
    var now = new Date();
    if (now - this.lastBitrateMeasureTime >= 1000) {
      var bitrate = (this.receivedPayloadBytes - this.lastReceivedPayloadBytes) / (now - this.lastBitrateMeasureTime);
      bitrate = Math.round(bitrate * 1000 * 8) / 1000;
      this.test.reportSuccess('Transmitting at ' + bitrate + ' kbps.');
      this.lastReceivedPayloadBytes = this.receivedPayloadBytes;
      this.lastBitrateMeasureTime = now;
    }
    if (this.stopSending && this.sentPayloadBytes === this.receivedPayloadBytes) {
      this.call.close();
      this.call = null;

      var elapsedTime = Math.round((now - this.startTime) * 10) / 10000.0;
      var receivedKBits = this.receivedPayloadBytes * 8 / 1000;
      this.test.reportSuccess('Total transmitted: ' + receivedKBits + ' kilo-bits in ' + elapsedTime + ' seconds.');
      this.test.done();
    }
  }
};

exports.default = DataChannelThroughputTest;

},{"../util/Call.js":27}],23:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function MicTest(test) {
  this.test = test;
  this.inputChannelCount = 6;
  this.outputChannelCount = 2;
  // Buffer size set to 0 to let Chrome choose based on the platform.
  this.bufferSize = 0;
  // Turning off echoCancellation constraint enables stereo input.
  this.constraints = {
    audio: {
      optional: [{ echoCancellation: false }]
    }
  };

  this.collectSeconds = 2.0;
  // At least one LSB 16-bit data (compare is on absolute value).
  this.silentThreshold = 1.0 / 32767;
  this.lowVolumeThreshold = -60;
  // Data must be identical within one LSB 16-bit to be identified as mono.
  this.monoDetectThreshold = 1.0 / 65536;
  // Number of consequtive clipThreshold level samples that indicate clipping.
  this.clipCountThreshold = 6;
  this.clipThreshold = 1.0;

  // Populated with audio as a 3-dimensional array:
  //   collectedAudio[channels][buffers][samples]
  this.collectedAudio = [];
  this.collectedSampleCount = 0;
  for (var i = 0; i < this.inputChannelCount; ++i) {
    this.collectedAudio[i] = [];
  }
  try {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContext();
  } catch (e) {
    console.error('Failed to instantiate an audio context, error: ' + e);
  }
}

MicTest.prototype = {
  run: function run() {
    if (typeof this.audioContext === 'undefined') {
      this.test.reportError('WebAudio is not supported, test cannot run.');
      this.test.done();
    } else {
      this.test.doGetUserMedia(this.constraints, this.gotStream.bind(this));
    }
  },

  gotStream: function gotStream(stream) {
    if (!this.checkAudioTracks(stream)) {
      this.test.done();
      return;
    }
    this.createAudioBuffer(stream);
  },

  checkAudioTracks: function checkAudioTracks(stream) {
    this.stream = stream;
    var audioTracks = stream.getAudioTracks();
    if (audioTracks.length < 1) {
      this.test.reportError('No audio track in returned stream.');
      return false;
    }
    this.test.reportSuccess('Audio track created using device=' + audioTracks[0].label);
    return true;
  },

  createAudioBuffer: function createAudioBuffer() {
    this.audioSource = this.audioContext.createMediaStreamSource(this.stream);
    this.scriptNode = this.audioContext.createScriptProcessor(this.bufferSize, this.inputChannelCount, this.outputChannelCount);
    this.audioSource.connect(this.scriptNode);
    this.scriptNode.connect(this.audioContext.destination);
    this.scriptNode.onaudioprocess = this.collectAudio.bind(this);
    this.stopCollectingAudio = this.test.setTimeoutWithProgressBar(this.onStopCollectingAudio.bind(this), 5000);
  },

  collectAudio: function collectAudio(event) {
    // Simple silence detection: check first and last sample of each channel in
    // the buffer. If both are below a threshold, the buffer is considered
    // silent.
    var sampleCount = event.inputBuffer.length;
    var allSilent = true;
    for (var c = 0; c < event.inputBuffer.numberOfChannels; c++) {
      var data = event.inputBuffer.getChannelData(c);
      var first = Math.abs(data[0]);
      var last = Math.abs(data[sampleCount - 1]);
      var newBuffer;
      if (first > this.silentThreshold || last > this.silentThreshold) {
        // Non-silent buffers are copied for analysis. Note that the silent
        // detection will likely cause the stored stream to contain discontinu-
        // ities, but that is ok for our needs here (just looking at levels).
        newBuffer = new Float32Array(sampleCount);
        newBuffer.set(data);
        allSilent = false;
      } else {
        // Silent buffers are not copied, but we store empty buffers so that the
        // analysis doesn't have to care.
        newBuffer = new Float32Array();
      }
      this.collectedAudio[c].push(newBuffer);
    }
    if (!allSilent) {
      this.collectedSampleCount += sampleCount;
      if (this.collectedSampleCount / event.inputBuffer.sampleRate >= this.collectSeconds) {
        this.stopCollectingAudio();
      }
    }
  },

  onStopCollectingAudio: function onStopCollectingAudio() {
    this.stream.getAudioTracks()[0].stop();
    this.audioSource.disconnect(this.scriptNode);
    this.scriptNode.disconnect(this.audioContext.destination);
    this.analyzeAudio(this.collectedAudio);
    this.test.done();
  },

  analyzeAudio: function analyzeAudio(channels) {
    var activeChannels = [];
    for (var c = 0; c < channels.length; c++) {
      if (this.channelStats(c, channels[c])) {
        activeChannels.push(c);
      }
    }
    if (activeChannels.length === 0) {
      this.test.reportError('No active input channels detected. Microphone ' + 'is most likely muted or broken, please check if muted in the ' + 'sound settings or physically on the device. Then rerun the test.');
    } else {
      this.test.reportSuccess('Active audio input channels: ' + activeChannels.length);
    }
    if (activeChannels.length === 2) {
      this.detectMono(channels[activeChannels[0]], channels[activeChannels[1]]);
    }
  },

  channelStats: function channelStats(channelNumber, buffers) {
    var maxPeak = 0.0;
    var maxRms = 0.0;
    var clipCount = 0;
    var maxClipCount = 0;
    for (var j = 0; j < buffers.length; j++) {
      var samples = buffers[j];
      if (samples.length > 0) {
        var s = 0;
        var rms = 0.0;
        for (var i = 0; i < samples.length; i++) {
          s = Math.abs(samples[i]);
          maxPeak = Math.max(maxPeak, s);
          rms += s * s;
          if (maxPeak >= this.clipThreshold) {
            clipCount++;
            maxClipCount = Math.max(maxClipCount, clipCount);
          } else {
            clipCount = 0;
          }
        }
        // RMS is calculated over each buffer, meaning the integration time will
        // be different depending on sample rate and buffer size. In practise
        // this should be a small problem.
        rms = Math.sqrt(rms / samples.length);
        maxRms = Math.max(maxRms, rms);
      }
    }

    if (maxPeak > this.silentThreshold) {
      var dBPeak = this.dBFS(maxPeak);
      var dBRms = this.dBFS(maxRms);
      this.test.reportInfo('Channel ' + channelNumber + ' levels: ' + dBPeak.toFixed(1) + ' dB (peak), ' + dBRms.toFixed(1) + ' dB (RMS)');
      if (dBRms < this.lowVolumeThreshold) {
        this.test.reportError('Microphone input level is low, increase input ' + 'volume or move closer to the microphone.');
      }
      if (maxClipCount > this.clipCountThreshold) {
        this.test.reportWarning('Clipping detected! Microphone input level ' + 'is high. Decrease input volume or move away from the microphone.');
      }
      return true;
    }
    return false;
  },

  detectMono: function detectMono(buffersL, buffersR) {
    var diffSamples = 0;
    for (var j = 0; j < buffersL.length; j++) {
      var l = buffersL[j];
      var r = buffersR[j];
      if (l.length === r.length) {
        var d = 0.0;
        for (var i = 0; i < l.length; i++) {
          d = Math.abs(l[i] - r[i]);
          if (d > this.monoDetectThreshold) {
            diffSamples++;
          }
        }
      } else {
        diffSamples++;
      }
    }
    if (diffSamples > 0) {
      this.test.reportInfo('Stereo microphone detected.');
    } else {
      this.test.reportInfo('Mono microphone detected.');
    }
  },

  dBFS: function dBFS(gain) {
    var dB = 20 * Math.log(gain) / Math.log(10);
    // Use Math.round to display up to one decimal place.
    return Math.round(dB * 10) / 10;
  }
};

exports.default = MicTest;

},{}],24:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Call = require('../util/Call.js');

var _Call2 = _interopRequireDefault(_Call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var NetworkTest = function NetworkTest(test, protocol, params, iceCandidateFilter) {
  this.test = test;
  this.protocol = protocol;
  this.params = params;
  this.iceCandidateFilter = iceCandidateFilter;
};

NetworkTest.prototype = {
  run: function run() {
    // Do not create turn config for IPV6 test.
    if (this.iceCandidateFilter.toString() === _Call2.default.isIpv6.toString()) {
      this.gatherCandidates(null, this.params, this.iceCandidateFilter);
    } else {
      _Call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
    }
  },

  start: function start(config) {
    this.filterConfig(config, this.protocol);
    this.gatherCandidates(config, this.params, this.iceCandidateFilter);
  },

  // Filter the RTCConfiguration |config| to only contain URLs with the
  // specified transport protocol |protocol|. If no turn transport is
  // specified it is added with the requested protocol.
  filterConfig: function filterConfig(config, protocol) {
    var transport = 'transport=' + protocol;
    var newIceServers = [];
    for (var i = 0; i < config.iceServers.length; ++i) {
      var iceServer = config.iceServers[i];
      var newUrls = [];
      for (var j = 0; j < iceServer.urls.length; ++j) {
        var uri = iceServer.urls[j];
        if (uri.indexOf(transport) !== -1) {
          newUrls.push(uri);
        } else if (uri.indexOf('?transport=') === -1 && uri.startsWith('turn')) {
          newUrls.push(uri + '?' + transport);
        }
      }
      if (newUrls.length !== 0) {
        iceServer.urls = newUrls;
        newIceServers.push(iceServer);
      }
    }
    config.iceServers = newIceServers;
  },

  // Create a PeerConnection, and gather candidates using RTCConfig |config|
  // and ctor params |params|. Succeed if any candidates pass the |isGood|
  // check, fail if we complete gathering without any passing.
  gatherCandidates: function gatherCandidates(config, params, isGood) {
    var pc;
    try {
      pc = new RTCPeerConnection(config, params);
    } catch (error) {
      if (params !== null && params.optional[0].googIPv6) {
        this.test.reportWarning('Failed to create peer connection, IPv6 ' + 'might not be setup/supported on the network.');
      } else {
        this.test.reportError('Failed to create peer connection: ' + error);
      }
      this.test.done();
      return;
    }

    // In our candidate callback, stop if we get a candidate that passes
    // |isGood|.
    pc.addEventListener('icecandidate', function (e) {
      // Once we've decided, ignore future callbacks.
      if (e.currentTarget.signalingState === 'closed') {
        return;
      }

      if (e.candidate) {
        var parsed = _Call2.default.parseCandidate(e.candidate.candidate);
        if (isGood(parsed)) {
          this.test.reportSuccess('Gathered candidate of Type: ' + parsed.type + ' Protocol: ' + parsed.protocol + ' Address: ' + parsed.address);
          pc.close();
          pc = null;
          this.test.done();
        }
      } else {
        pc.close();
        pc = null;
        if (params !== null && params.optional[0].googIPv6) {
          this.test.reportWarning('Failed to gather IPv6 candidates, it ' + 'might not be setup/supported on the network.');
        } else {
          this.test.reportError('Failed to gather specified candidates');
        }
        this.test.done();
      }
    }.bind(this));

    this.createAudioOnlyReceiveOffer(pc);
  },

  // Create an audio-only, recvonly offer, and setLD with it.
  // This will trigger candidate gathering.
  createAudioOnlyReceiveOffer: function createAudioOnlyReceiveOffer(pc) {
    var createOfferParams = { offerToReceiveAudio: 1 };
    pc.createOffer(createOfferParams).then(function (offer) {
      pc.setLocalDescription(offer).then(noop, noop);
    }, noop);

    // Empty function for callbacks requiring a function.
    function noop() {}
  }
};

exports.default = NetworkTest;

},{"../util/Call.js":27}],25:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _webrtcAdapter = require('webrtc-adapter');

var _webrtcAdapter2 = _interopRequireDefault(_webrtcAdapter);

var _stats = require('../util/stats.js');

var _stats2 = _interopRequireDefault(_stats);

var _call = require('../util/call.js');

var _call2 = _interopRequireDefault(_call);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function VideoBandwidthTest(test) {
  this.test = test;
  this.maxVideoBitrateKbps = 2000;
  this.durationMs = 40000;
  this.statStepMs = 100;
  this.bweStats = new _stats2.default(0.75 * this.maxVideoBitrateKbps * 1000);
  this.rttStats = new _stats2.default();
  this.packetsLost = -1;
  this.nackCount = -1;
  this.pliCount = -1;
  this.qpSum = -1;
  this.packetsSent = -1;
  this.packetsReceived = -1;
  this.framesEncoded = -1;
  this.framesDecoded = -1;
  this.framesSent = -1;
  this.bytesSent = -1;
  this.videoStats = [];
  this.startTime = null;
  this.call = null;
  // Open the camera in 720p to get a correct measurement of ramp-up time.
  this.constraints = {
    audio: false,
    video: {
      optional: [{ minWidth: 1280 }, { minHeight: 720 }]
    }
  };
}

VideoBandwidthTest.prototype = {
  run: function run() {
    _call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.call = new _call2.default(config, this.test);
    this.call.setIceCandidateFilter(_call2.default.isRelay);
    // FEC makes it hard to study bandwidth estimation since there seems to be
    // a spike when it is enabled and disabled. Disable it for now. FEC issue
    // tracked on: https://code.google.com/p/webrtc/issues/detail?id=3050
    this.call.disableVideoFec();
    this.call.constrainVideoBitrate(this.maxVideoBitrateKbps);
    this.test.doGetUserMedia(this.constraints, this.gotStream.bind(this));
  },

  gotStream: function gotStream(stream) {
    this.call.pc1.addStream(stream);
    this.call.establishConnection();
    this.startTime = new Date();
    this.localStream = stream.getVideoTracks()[0];
    setTimeout(this.gatherStats.bind(this), this.statStepMs);
  },

  gatherStats: function gatherStats() {
    var now = new Date();
    if (now - this.startTime > this.durationMs) {
      this.test.setProgress(100);
      this.hangup();
      return;
    } else if (!this.call.statsGatheringRunning) {
      this.call.gatherStats(this.call.pc1, this.call.pc2, this.localStream, this.gotStats.bind(this));
    }
    this.test.setProgress((now - this.startTime) * 100 / this.durationMs);
    setTimeout(this.gatherStats.bind(this), this.statStepMs);
  },

  gotStats: function gotStats(response, time, response2, time2) {
    // TODO: Remove browser specific stats gathering hack once adapter.js or
    // browsers converge on a standard.
    if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
      for (var i in response) {
        if (typeof response[i].connection !== 'undefined') {
          this.bweStats.add(response[i].connection.timestamp, parseInt(response[i].connection.availableOutgoingBitrate));
          this.rttStats.add(response[i].connection.timestamp, parseInt(response[i].connection.currentRoundTripTime * 1000));
          // Grab the last stats.
          this.videoStats[0] = response[i].video.local.frameWidth;
          this.videoStats[1] = response[i].video.local.frameHeight;
          this.nackCount = response[i].video.local.nackCount;
          this.packetsLost = response2[i].video.remote.packetsLost;
          this.qpSum = response2[i].video.remote.qpSum;
          this.pliCount = response[i].video.local.pliCount;
          this.packetsSent = response[i].video.local.packetsSent;
          this.packetsReceived = response2[i].video.remote.packetsReceived;
          this.framesEncoded = response[i].video.local.framesEncoded;
          this.framesDecoded = response2[i].video.remote.framesDecoded;
        }
      }
    } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
      for (var j in response) {
        if (response[j].id === 'outbound_rtcp_video_0') {
          this.rttStats.add(Date.parse(response[j].timestamp), parseInt(response[j].mozRtt));
          // Grab the last stats.
          this.jitter = response[j].jitter;
          this.packetsLost = response[j].packetsLost;
        } else if (response[j].id === 'outbound_rtp_video_0') {
          // TODO: Get dimensions from getStats when supported in FF.
          this.videoStats[0] = 'Not supported on Firefox';
          this.videoStats[1] = 'Not supported on Firefox';
          this.bitrateMean = response[j].bitrateMean;
          this.bitrateStdDev = response[j].bitrateStdDev;
          this.framerateMean = response[j].framerateMean;
        }
      }
    } else {
      this.test.reportError('Only Firefox and Chrome getStats implementations' + ' are supported.');
    }
    this.completed();
  },

  hangup: function hangup() {
    this.call.pc1.getLocalStreams()[0].getTracks().forEach(function (track) {
      track.stop();
    });
    this.call.close();
    this.call = null;
  },

  completed: function completed() {
    // TODO: Remove browser specific stats gathering hack once adapter.js or
    // browsers converge on a standard.
    if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
      // Checking if greater than 2 because Chrome sometimes reports 2x2 when
      // a camera starts but fails to deliver frames.
      if (this.videoStats[0] < 2 && this.videoStats[1] < 2) {
        this.test.reportError('Camera failure: ' + this.videoStats[0] + 'x' + this.videoStats[1] + '. Cannot test bandwidth without a working ' + ' camera.');
      } else {
        this.test.reportSuccess('Video resolution: ' + this.videoStats[0] + 'x' + this.videoStats[1]);
        this.test.reportInfo('Send bandwidth estimate average: ' + Math.round(this.bweStats.getAverage() / 1000) + ' kbps');
        this.test.reportInfo('Send bandwidth estimate max: ' + this.bweStats.getMax() / 1000 + ' kbps');
        this.test.reportInfo('Send bandwidth ramp-up time: ' + this.bweStats.getRampUpTime() + ' ms');
        this.test.reportInfo('Packets sent: ' + this.packetsSent);
        this.test.reportInfo('Packets received: ' + this.packetsReceived);
        this.test.reportInfo('NACK count: ' + this.nackCount);
        this.test.reportInfo('Picture loss indications: ' + this.pliCount);
        this.test.reportInfo('Quality predictor sum: ' + this.qpSum);
        this.test.reportInfo('Frames encoded: ' + this.framesEncoded);
        this.test.reportInfo('Frames decoded: ' + this.framesDecoded);
      }
    } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
      if (parseInt(this.framerateMean) > 0) {
        this.test.reportSuccess('Frame rate mean: ' + parseInt(this.framerateMean));
      } else {
        this.test.reportError('Frame rate mean is 0, cannot test bandwidth ' + 'without a working camera.');
      }
      this.test.reportInfo('Send bitrate mean: ' + parseInt(this.bitrateMean) / 1000 + ' kbps');
      this.test.reportInfo('Send bitrate standard deviation: ' + parseInt(this.bitrateStdDev) / 1000 + ' kbps');
    }
    this.test.reportInfo('RTT average: ' + this.rttStats.getAverage() + ' ms');
    this.test.reportInfo('RTT max: ' + this.rttStats.getMax() + ' ms');
    this.test.reportInfo('Packets lost: ' + this.packetsLost);
    this.test.done();
  }
};

exports.default = VideoBandwidthTest;

},{"../util/call.js":29,"../util/stats.js":32,"webrtc-adapter":3}],26:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _call = require('../util/call.js');

var _call2 = _interopRequireDefault(_call);

var _report = require('../util/report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('../util/util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();

function WiFiPeriodicScanTest(test, candidateFilter) {
  this.test = test;
  this.candidateFilter = candidateFilter;
  this.testDurationMs = 5 * 60 * 1000;
  this.sendIntervalMs = 100;
  this.delays = [];
  this.recvTimeStamps = [];
  this.running = false;
  this.call = null;
  this.senderChannel = null;
  this.receiveChannel = null;
}

WiFiPeriodicScanTest.prototype = {
  run: function run() {
    _call2.default.asyncCreateTurnConfig(this.start.bind(this), this.test.reportFatal.bind(this.test), this.test);
  },

  start: function start(config) {
    this.running = true;
    this.call = new _call2.default(config, this.test);
    this.call.setIceCandidateFilter(this.candidateFilter);

    this.senderChannel = this.call.pc1.createDataChannel({ ordered: false,
      maxRetransmits: 0 });
    this.senderChannel.addEventListener('open', this.send.bind(this));
    this.call.pc2.addEventListener('datachannel', this.onReceiverChannel.bind(this));
    this.call.establishConnection();

    this.test.setTimeoutWithProgressBar(this.finishTest.bind(this), this.testDurationMs);
  },

  onReceiverChannel: function onReceiverChannel(event) {
    this.receiveChannel = event.channel;
    this.receiveChannel.addEventListener('message', this.receive.bind(this));
  },

  send: function send() {
    if (!this.running) {
      return;
    }
    this.senderChannel.send('' + Date.now());
    setTimeout(this.send.bind(this), this.sendIntervalMs);
  },

  receive: function receive(event) {
    if (!this.running) {
      return;
    }
    var sendTime = parseInt(event.data);
    var delay = Date.now() - sendTime;
    this.recvTimeStamps.push(sendTime);
    this.delays.push(delay);
  },

  finishTest: function finishTest() {
    report.traceEventInstant('periodic-delay', { delays: this.delays,
      recvTimeStamps: this.recvTimeStamps });
    this.running = false;
    this.call.close();
    this.call = null;

    var avg = (0, _util.arrayAverage)(this.delays);
    var max = (0, _util.arrayMax)(this.delays);
    var min = (0, _util.arrayMin)(this.delays);
    this.test.reportInfo('Average delay: ' + avg + ' ms.');
    this.test.reportInfo('Min delay: ' + min + ' ms.');
    this.test.reportInfo('Max delay: ' + max + ' ms.');

    if (this.delays.length < 0.8 * this.testDurationMs / this.sendIntervalMs) {
      this.test.reportError('Not enough samples gathered. Keep the page on ' + ' the foreground while the test is running.');
    } else {
      this.test.reportSuccess('Collected ' + this.delays.length + ' delay samples.');
    }

    if (max > (min + 100) * 2) {
      this.test.reportError('There is a big difference between the min and ' + 'max delay of packets. Your network appears unstable.');
    }
    this.test.done();
  }
};

exports.default = WiFiPeriodicScanTest;

},{"../util/call.js":29,"../util/report.js":30,"../util/util.js":33}],27:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _webrtcAdapter = require('webrtc-adapter');

var _webrtcAdapter2 = _interopRequireDefault(_webrtcAdapter);

var _report = require('./report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('./util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();

function Call(config, test) {
  this.test = test;
  this.traceEvent = report.traceEventAsync('call');
  this.traceEvent({ config: config });
  this.statsGatheringRunning = false;

  this.pc1 = new RTCPeerConnection(config);
  this.pc2 = new RTCPeerConnection(config);

  this.pc1.addEventListener('icecandidate', this.onIceCandidate_.bind(this, this.pc2));
  this.pc2.addEventListener('icecandidate', this.onIceCandidate_.bind(this, this.pc1));

  this.iceCandidateFilter_ = Call.noFilter;
}

Call.prototype = {
  establishConnection: function establishConnection() {
    this.traceEvent({ state: 'start' });
    this.pc1.createOffer().then(this.gotOffer_.bind(this), this.test.reportFatal.bind(this.test));
  },

  close: function close() {
    this.traceEvent({ state: 'end' });
    this.pc1.close();
    this.pc2.close();
  },

  setIceCandidateFilter: function setIceCandidateFilter(filter) {
    this.iceCandidateFilter_ = filter;
  },

  // Constraint max video bitrate by modifying the SDP when creating an answer.
  constrainVideoBitrate: function constrainVideoBitrate(maxVideoBitrateKbps) {
    this.constrainVideoBitrateKbps_ = maxVideoBitrateKbps;
  },

  // Remove video FEC if available on the offer.
  disableVideoFec: function disableVideoFec() {
    this.constrainOfferToRemoveVideoFec_ = true;
  },

  // When the peerConnection is closed the statsCb is called once with an array
  // of gathered stats.
  gatherStats: function gatherStats(peerConnection, peerConnection2, localStream, statsCb) {
    var stats = [];
    var stats2 = [];
    var statsCollectTime = [];
    var statsCollectTime2 = [];
    var self = this;
    var statStepMs = 100;
    self.localTrackIds = {
      audio: '',
      video: ''
    };
    self.remoteTrackIds = {
      audio: '',
      video: ''
    };

    peerConnection.getSenders().forEach(function (sender) {
      if (sender.track.kind === 'audio') {
        self.localTrackIds.audio = sender.track.id;
      } else if (sender.track.kind === 'video') {
        self.localTrackIds.video = sender.track.id;
      }
    }.bind(self));

    if (peerConnection2) {
      peerConnection2.getReceivers().forEach(function (receiver) {
        if (receiver.track.kind === 'audio') {
          self.remoteTrackIds.audio = receiver.track.id;
        } else if (receiver.track.kind === 'video') {
          self.remoteTrackIds.video = receiver.track.id;
        }
      }.bind(self));
    }

    this.statsGatheringRunning = true;
    getStats_();

    function getStats_() {
      if (peerConnection.signalingState === 'closed') {
        self.statsGatheringRunning = false;
        statsCb(stats, statsCollectTime, stats2, statsCollectTime2);
        return;
      }
      peerConnection.getStats().then(gotStats_).catch(function (error) {
        self.test.reportError('Could not gather stats: ' + error);
        self.statsGatheringRunning = false;
        statsCb(stats, statsCollectTime);
      }.bind(self));
      if (peerConnection2) {
        peerConnection2.getStats().then(gotStats2_);
      }
    }
    // Stats for pc2, some stats are only available on the receiving end of a
    // peerconnection.
    function gotStats2_(response) {
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats2.push(enumeratedStats);
        statsCollectTime2.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
        for (var h in response) {
          var stat = response[h];
          stats2.push(stat);
          statsCollectTime2.push(Date.now());
        }
      } else {
        self.test.reportError('Only Firefox and Chrome getStats ' + 'implementations are supported.');
      }
    }

    function gotStats_(response) {
      // TODO: Remove browser specific stats gathering hack once adapter.js or
      // browsers converge on a standard.
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats.push(enumeratedStats);
        statsCollectTime.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
        for (var j in response) {
          var stat = response[j];
          stats.push(stat);
          statsCollectTime.push(Date.now());
        }
      } else {
        self.test.reportError('Only Firefox and Chrome getStats ' + 'implementations are supported.');
      }
      setTimeout(getStats_, statStepMs);
    }
  },

  gotOffer_: function gotOffer_(offer) {
    if (this.constrainOfferToRemoveVideoFec_) {
      offer.sdp = offer.sdp.replace(/(m=video 1 [^\r]+)(116 117)(\r\n)/g, '$1\r\n');
      offer.sdp = offer.sdp.replace(/a=rtpmap:116 red\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=rtpmap:117 ulpfec\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=rtpmap:98 rtx\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=fmtp:98 apt=116\r\n/g, '');
    }
    this.pc1.setLocalDescription(offer);
    this.pc2.setRemoteDescription(offer);
    this.pc2.createAnswer().then(this.gotAnswer_.bind(this), this.test.reportFatal.bind(this.test));
  },

  gotAnswer_: function gotAnswer_(answer) {
    if (this.constrainVideoBitrateKbps_) {
      answer.sdp = answer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:' + this.constrainVideoBitrateKbps_ + '\r\n');
    }
    this.pc2.setLocalDescription(answer);
    this.pc1.setRemoteDescription(answer);
  },

  onIceCandidate_: function onIceCandidate_(otherPeer, event) {
    if (event.candidate) {
      var parsed = Call.parseCandidate(event.candidate.candidate);
      if (this.iceCandidateFilter_(parsed)) {
        otherPeer.addIceCandidate(event.candidate);
      }
    }
  }
};

Call.noFilter = function () {
  return true;
};

Call.isRelay = function (candidate) {
  return candidate.type === 'relay';
};

Call.isNotHostCandidate = function (candidate) {
  return candidate.type !== 'host';
};

Call.isReflexive = function (candidate) {
  return candidate.type === 'srflx';
};

Call.isHost = function (candidate) {
  return candidate.type === 'host';
};

Call.isIpv6 = function (candidate) {
  return candidate.address.indexOf(':') !== -1;
};

// Parse a 'candidate:' line into a JSON object.
Call.parseCandidate = function (text) {
  var candidateStr = 'candidate:';
  var pos = text.indexOf(candidateStr) + candidateStr.length;
  var fields = text.substr(pos).split(' ');
  return {
    'type': fields[7],
    'protocol': fields[2],
    'address': fields[4]
  };
};

// Store the ICE server response from the network traversal server.
Call.cachedIceServers_ = null;
// Keep track of when the request was made.
Call.cachedIceConfigFetchTime_ = null;

// Get a TURN config, either from settings or from network traversal server.
Call.asyncCreateTurnConfig = function (onSuccess, onError, currentTest) {
  var settings = currentTest.settings;
  var iceServer = {
    'username': settings.turnUsername || '',
    'credential': settings.turnCredential || '',
    'urls': settings.turnURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('turn-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

// Get a STUN config, either from settings or from network traversal server.
Call.asyncCreateStunConfig = function (onSuccess, onError) {
  var settings = currentTest.settings;
  var iceServer = {
    'urls': settings.stunURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('stun-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

exports.default = Call;

},{"./report.js":30,"./util.js":33,"webrtc-adapter":3}],28:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _ssim = require('./ssim.js');

var _ssim2 = _interopRequireDefault(_ssim);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function VideoFrameChecker(videoElement) {
  this.frameStats = {
    numFrozenFrames: 0,
    numBlackFrames: 0,
    numFrames: 0
  };

  this.running_ = true;

  this.nonBlackPixelLumaThreshold = 20;
  this.previousFrame_ = [];
  this.identicalFrameSsimThreshold = 0.985;
  this.frameComparator = new _ssim2.default();

  this.canvas_ = document.createElement('canvas');
  this.videoElement_ = videoElement;
  this.listener_ = this.checkVideoFrame_.bind(this);
  this.videoElement_.addEventListener('play', this.listener_, false);
}

VideoFrameChecker.prototype = {
  stop: function stop() {
    this.videoElement_.removeEventListener('play', this.listener_);
    this.running_ = false;
  },

  getCurrentImageData_: function getCurrentImageData_() {
    this.canvas_.width = this.videoElement_.width;
    this.canvas_.height = this.videoElement_.height;

    var context = this.canvas_.getContext('2d');
    context.drawImage(this.videoElement_, 0, 0, this.canvas_.width, this.canvas_.height);
    return context.getImageData(0, 0, this.canvas_.width, this.canvas_.height);
  },

  checkVideoFrame_: function checkVideoFrame_() {
    if (!this.running_) {
      return;
    }
    if (this.videoElement_.ended) {
      return;
    }

    var imageData = this.getCurrentImageData_();

    if (this.isBlackFrame_(imageData.data, imageData.data.length)) {
      this.frameStats.numBlackFrames++;
    }

    if (this.frameComparator.calculate(this.previousFrame_, imageData.data) > this.identicalFrameSsimThreshold) {
      this.frameStats.numFrozenFrames++;
    }
    this.previousFrame_ = imageData.data;

    this.frameStats.numFrames++;
    setTimeout(this.checkVideoFrame_.bind(this), 20);
  },

  isBlackFrame_: function isBlackFrame_(data, length) {
    // TODO: Use a statistical, histogram-based detection.
    var thresh = this.nonBlackPixelLumaThreshold;
    var accuLuma = 0;
    for (var i = 4; i < length; i += 4) {
      // Use Luma as in Rec. 709: Y′709 = 0.21R + 0.72G + 0.07B;
      accuLuma += 0.21 * data[i] + 0.72 * data[i + 1] + 0.07 * data[i + 2];
      // Early termination if the average Luma so far is bright enough.
      if (accuLuma > thresh * i / 4) {
        return false;
      }
    }
    return true;
  }
};

if ((typeof exports === 'undefined' ? 'undefined' : _typeof(exports)) === 'object') {
  module.exports = VideoFrameChecker;
}

},{"./ssim.js":31}],29:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _webrtcAdapter = require('webrtc-adapter');

var _webrtcAdapter2 = _interopRequireDefault(_webrtcAdapter);

var _report = require('./report.js');

var _report2 = _interopRequireDefault(_report);

var _util = require('./util.js');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var report = new _report2.default();

function Call(config, test) {
  this.test = test;
  this.traceEvent = report.traceEventAsync('call');
  this.traceEvent({ config: config });
  this.statsGatheringRunning = false;

  this.pc1 = new RTCPeerConnection(config);
  this.pc2 = new RTCPeerConnection(config);

  this.pc1.addEventListener('icecandidate', this.onIceCandidate_.bind(this, this.pc2));
  this.pc2.addEventListener('icecandidate', this.onIceCandidate_.bind(this, this.pc1));

  this.iceCandidateFilter_ = Call.noFilter;
}

Call.prototype = {
  establishConnection: function establishConnection() {
    this.traceEvent({ state: 'start' });
    this.pc1.createOffer().then(this.gotOffer_.bind(this), this.test.reportFatal.bind(this.test));
  },

  close: function close() {
    this.traceEvent({ state: 'end' });
    this.pc1.close();
    this.pc2.close();
  },

  setIceCandidateFilter: function setIceCandidateFilter(filter) {
    this.iceCandidateFilter_ = filter;
  },

  // Constraint max video bitrate by modifying the SDP when creating an answer.
  constrainVideoBitrate: function constrainVideoBitrate(maxVideoBitrateKbps) {
    this.constrainVideoBitrateKbps_ = maxVideoBitrateKbps;
  },

  // Remove video FEC if available on the offer.
  disableVideoFec: function disableVideoFec() {
    this.constrainOfferToRemoveVideoFec_ = true;
  },

  // When the peerConnection is closed the statsCb is called once with an array
  // of gathered stats.
  gatherStats: function gatherStats(peerConnection, peerConnection2, localStream, statsCb) {
    var stats = [];
    var stats2 = [];
    var statsCollectTime = [];
    var statsCollectTime2 = [];
    var self = this;
    var statStepMs = 100;
    self.localTrackIds = {
      audio: '',
      video: ''
    };
    self.remoteTrackIds = {
      audio: '',
      video: ''
    };

    peerConnection.getSenders().forEach(function (sender) {
      if (sender.track.kind === 'audio') {
        self.localTrackIds.audio = sender.track.id;
      } else if (sender.track.kind === 'video') {
        self.localTrackIds.video = sender.track.id;
      }
    }.bind(self));

    if (peerConnection2) {
      peerConnection2.getReceivers().forEach(function (receiver) {
        if (receiver.track.kind === 'audio') {
          self.remoteTrackIds.audio = receiver.track.id;
        } else if (receiver.track.kind === 'video') {
          self.remoteTrackIds.video = receiver.track.id;
        }
      }.bind(self));
    }

    this.statsGatheringRunning = true;
    getStats_();

    function getStats_() {
      if (peerConnection.signalingState === 'closed') {
        self.statsGatheringRunning = false;
        statsCb(stats, statsCollectTime, stats2, statsCollectTime2);
        return;
      }
      peerConnection.getStats().then(gotStats_).catch(function (error) {
        self.test.reportError('Could not gather stats: ' + error);
        self.statsGatheringRunning = false;
        statsCb(stats, statsCollectTime);
      }.bind(self));
      if (peerConnection2) {
        peerConnection2.getStats().then(gotStats2_);
      }
    }
    // Stats for pc2, some stats are only available on the receiving end of a
    // peerconnection.
    function gotStats2_(response) {
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats2.push(enumeratedStats);
        statsCollectTime2.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
        for (var h in response) {
          var stat = response[h];
          stats2.push(stat);
          statsCollectTime2.push(Date.now());
        }
      } else {
        self.test.reportError('Only Firefox and Chrome getStats ' + 'implementations are supported.');
      }
    }

    function gotStats_(response) {
      // TODO: Remove browser specific stats gathering hack once adapter.js or
      // browsers converge on a standard.
      if (_webrtcAdapter2.default.browserDetails.browser === 'chrome') {
        var enumeratedStats = (0, _util.enumerateStats)(response, self.localTrackIds, self.remoteTrackIds);
        stats.push(enumeratedStats);
        statsCollectTime.push(Date.now());
      } else if (_webrtcAdapter2.default.browserDetails.browser === 'firefox') {
        for (var j in response) {
          var stat = response[j];
          stats.push(stat);
          statsCollectTime.push(Date.now());
        }
      } else {
        self.test.reportError('Only Firefox and Chrome getStats ' + 'implementations are supported.');
      }
      setTimeout(getStats_, statStepMs);
    }
  },

  gotOffer_: function gotOffer_(offer) {
    if (this.constrainOfferToRemoveVideoFec_) {
      offer.sdp = offer.sdp.replace(/(m=video 1 [^\r]+)(116 117)(\r\n)/g, '$1\r\n');
      offer.sdp = offer.sdp.replace(/a=rtpmap:116 red\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=rtpmap:117 ulpfec\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=rtpmap:98 rtx\/90000\r\n/g, '');
      offer.sdp = offer.sdp.replace(/a=fmtp:98 apt=116\r\n/g, '');
    }
    this.pc1.setLocalDescription(offer);
    this.pc2.setRemoteDescription(offer);
    this.pc2.createAnswer().then(this.gotAnswer_.bind(this), this.test.reportFatal.bind(this.test));
  },

  gotAnswer_: function gotAnswer_(answer) {
    if (this.constrainVideoBitrateKbps_) {
      answer.sdp = answer.sdp.replace(/a=mid:video\r\n/g, 'a=mid:video\r\nb=AS:' + this.constrainVideoBitrateKbps_ + '\r\n');
    }
    this.pc2.setLocalDescription(answer);
    this.pc1.setRemoteDescription(answer);
  },

  onIceCandidate_: function onIceCandidate_(otherPeer, event) {
    if (event.candidate) {
      var parsed = Call.parseCandidate(event.candidate.candidate);
      if (this.iceCandidateFilter_(parsed)) {
        otherPeer.addIceCandidate(event.candidate);
      }
    }
  }
};

Call.noFilter = function () {
  return true;
};

Call.isRelay = function (candidate) {
  return candidate.type === 'relay';
};

Call.isNotHostCandidate = function (candidate) {
  return candidate.type !== 'host';
};

Call.isReflexive = function (candidate) {
  return candidate.type === 'srflx';
};

Call.isHost = function (candidate) {
  return candidate.type === 'host';
};

Call.isIpv6 = function (candidate) {
  return candidate.address.indexOf(':') !== -1;
};

// Parse a 'candidate:' line into a JSON object.
Call.parseCandidate = function (text) {
  var candidateStr = 'candidate:';
  var pos = text.indexOf(candidateStr) + candidateStr.length;
  var fields = text.substr(pos).split(' ');
  return {
    'type': fields[7],
    'protocol': fields[2],
    'address': fields[4]
  };
};

// Store the ICE server response from the network traversal server.
Call.cachedIceServers_ = null;
// Keep track of when the request was made.
Call.cachedIceConfigFetchTime_ = null;

// Get a TURN config, either from settings or from network traversal server.
Call.asyncCreateTurnConfig = function (onSuccess, onError, currentTest) {
  var settings = currentTest.settings;
  var iceServer = {
    'username': settings.turnUsername || '',
    'credential': settings.turnCredential || '',
    'urls': settings.turnURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('turn-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

// Get a STUN config, either from settings or from network traversal server.
Call.asyncCreateStunConfig = function (onSuccess, onError) {
  var settings = currentTest.settings;
  var iceServer = {
    'urls': settings.stunURI.split(',')
  };
  var config = { 'iceServers': [iceServer] };
  report.traceEventInstant('stun-config', config);
  setTimeout(onSuccess.bind(null, config), 0);
};

exports.default = Call;

},{"./report.js":30,"./util.js":33,"webrtc-adapter":3}],30:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
/* exported report */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function Report() {
  this.output_ = [];
  this.nextAsyncId_ = 0;

  // Hook console.log into the report, since that is the most common debug tool.
  this.nativeLog_ = console.log.bind(console);
  console.log = this.logHook_.bind(this);

  // Hook up window.onerror logs into the report.
  window.addEventListener('error', this.onWindowError_.bind(this));

  this.traceEventInstant('system-info', Report.getSystemInfo());
}

Report.prototype = {
  traceEventInstant: function traceEventInstant(name, args) {
    this.output_.push({ 'ts': Date.now(),
      'name': name,
      'args': args });
  },

  traceEventWithId: function traceEventWithId(name, id, args) {
    this.output_.push({ 'ts': Date.now(),
      'name': name,
      'id': id,
      'args': args });
  },

  traceEventAsync: function traceEventAsync(name) {
    return this.traceEventWithId.bind(this, name, this.nextAsyncId_++);
  },

  logTestRunResult: function logTestRunResult(testName, status) {
    // Google Analytics event for the test result to allow to track how the
    // test is doing in the wild.
    ga('send', {
      'hitType': 'event',
      'eventCategory': 'Test',
      'eventAction': status,
      'eventLabel': testName,
      'nonInteraction': 1
    });
  },

  generate: function generate(bugDescription) {
    var header = { 'title': 'WebRTC Troubleshooter bug report',
      'description': bugDescription || null };
    return this.getContent_(header);
  },

  // Returns the logs into a JSON formated string that is a list of events
  // similar to the way chrome devtools format uses. The final string is
  // manually composed to have newlines between the entries is being easier
  // to parse by human eyes. If a contentHead object argument is provided it
  // will be added at the top of the log file.
  getContent_: function getContent_(contentHead) {
    var stringArray = [];
    this.appendEventsAsString_([contentHead] || [], stringArray);
    this.appendEventsAsString_(this.output_, stringArray);
    return '[' + stringArray.join(',\n') + ']';
  },

  appendEventsAsString_: function appendEventsAsString_(events, output) {
    for (var i = 0; i !== events.length; ++i) {
      output.push(JSON.stringify(events[i]));
    }
  },

  onWindowError_: function onWindowError_(error) {
    this.traceEventInstant('error', { 'message': error.message,
      'filename': error.filename + ':' + error.lineno });
  },

  logHook_: function logHook_() {
    this.traceEventInstant('log', arguments);
    this.nativeLog_.apply(null, arguments);
  }
};

/*
 * Detects the running browser name, version and platform.
 */
Report.getSystemInfo = function () {
  // Code inspired by http://goo.gl/9dZZqE with
  // added support of modern Internet Explorer versions (Trident).
  var agent = navigator.userAgent;
  var browserName = navigator.appName;
  var version = '' + parseFloat(navigator.appVersion);
  var offsetName;
  var offsetVersion;
  var ix;

  if ((offsetVersion = agent.indexOf('Chrome')) !== -1) {
    browserName = 'Chrome';
    version = agent.substring(offsetVersion + 7);
  } else if ((offsetVersion = agent.indexOf('MSIE')) !== -1) {
    browserName = 'Microsoft Internet Explorer'; // Older IE versions.
    version = agent.substring(offsetVersion + 5);
  } else if ((offsetVersion = agent.indexOf('Trident')) !== -1) {
    browserName = 'Microsoft Internet Explorer'; // Newer IE versions.
    version = agent.substring(offsetVersion + 8);
  } else if ((offsetVersion = agent.indexOf('Firefox')) !== -1) {
    browserName = 'Firefox';
  } else if ((offsetVersion = agent.indexOf('Safari')) !== -1) {
    browserName = 'Safari';
    version = agent.substring(offsetVersion + 7);
    if ((offsetVersion = agent.indexOf('Version')) !== -1) {
      version = agent.substring(offsetVersion + 8);
    }
  } else if ((offsetName = agent.lastIndexOf(' ') + 1) < (offsetVersion = agent.lastIndexOf('/'))) {
    // For other browsers 'name/version' is at the end of userAgent
    browserName = agent.substring(offsetName, offsetVersion);
    version = agent.substring(offsetVersion + 1);
    if (browserName.toLowerCase() === browserName.toUpperCase()) {
      browserName = navigator.appName;
    }
  } // Trim the version string at semicolon/space if present.
  if ((ix = version.indexOf(';')) !== -1) {
    version = version.substring(0, ix);
  }
  if ((ix = version.indexOf(' ')) !== -1) {
    version = version.substring(0, ix);
  }
  return { 'browserName': browserName,
    'browserVersion': version,
    'platform': navigator.platform };
};

exports.default = Report;

},{}],31:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

/* This is an implementation of the algorithm for calculating the Structural
 * SIMilarity (SSIM) index between two images. Please refer to the article [1],
 * the website [2] and/or the Wikipedia article [3]. This code takes the value
 * of the constants C1 and C2 from the Matlab implementation in [4].
 *
 * [1] Z. Wang, A. C. Bovik, H. R. Sheikh, and E. P. Simoncelli, "Image quality
 * assessment: From error measurement to structural similarity",
 * IEEE Transactions on Image Processing, vol. 13, no. 1, Jan. 2004.
 * [2] http://www.cns.nyu.edu/~lcv/ssim/
 * [3] http://en.wikipedia.org/wiki/Structural_similarity
 * [4] http://www.cns.nyu.edu/~lcv/ssim/ssim_index.m
 */

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

function Ssim() {}

Ssim.prototype = {
  // Implementation of Eq.2, a simple average of a vector and Eq.4., except the
  // square root. The latter is actually an unbiased estimate of the variance,
  // not the exact variance.
  statistics: function statistics(a) {
    var accu = 0;
    var i;
    for (i = 0; i < a.length; ++i) {
      accu += a[i];
    }
    var meanA = accu / (a.length - 1);
    var diff = 0;
    for (i = 1; i < a.length; ++i) {
      diff = a[i - 1] - meanA;
      accu += a[i] + diff * diff;
    }
    return { mean: meanA, variance: accu / a.length };
  },

  // Implementation of Eq.11., cov(Y, Z) = E((Y - uY), (Z - uZ)).
  covariance: function covariance(a, b, meanA, meanB) {
    var accu = 0;
    for (var i = 0; i < a.length; i += 1) {
      accu += (a[i] - meanA) * (b[i] - meanB);
    }
    return accu / a.length;
  },

  calculate: function calculate(x, y) {
    if (x.length !== y.length) {
      return 0;
    }

    // Values of the constants come from the Matlab code referred before.
    var K1 = 0.01;
    var K2 = 0.03;
    var L = 255;
    var C1 = K1 * L * (K1 * L);
    var C2 = K2 * L * (K2 * L);
    var C3 = C2 / 2;

    var statsX = this.statistics(x);
    var muX = statsX.mean;
    var sigmaX2 = statsX.variance;
    var sigmaX = Math.sqrt(sigmaX2);
    var statsY = this.statistics(y);
    var muY = statsY.mean;
    var sigmaY2 = statsY.variance;
    var sigmaY = Math.sqrt(sigmaY2);
    var sigmaXy = this.covariance(x, y, muX, muY);

    // Implementation of Eq.6.
    var luminance = (2 * muX * muY + C1) / (muX * muX + muY * muY + C1);
    // Implementation of Eq.10.
    var structure = (sigmaXy + C3) / (sigmaX * sigmaY + C3);
    // Implementation of Eq.9.
    var contrast = (2 * sigmaX * sigmaY + C2) / (sigmaX2 + sigmaY2 + C2);

    // Implementation of Eq.12.
    return luminance * contrast * structure;
  }
};

if ((typeof exports === 'undefined' ? 'undefined' : _typeof(exports)) === 'object') {
  module.exports = Ssim;
}

},{}],32:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
function StatisticsAggregate(rampUpThreshold) {
  this.startTime_ = 0;
  this.sum_ = 0;
  this.count_ = 0;
  this.max_ = 0;
  this.rampUpThreshold_ = rampUpThreshold;
  this.rampUpTime_ = Infinity;
}

StatisticsAggregate.prototype = {
  add: function add(time, datapoint) {
    if (this.startTime_ === 0) {
      this.startTime_ = time;
    }
    this.sum_ += datapoint;
    this.max_ = Math.max(this.max_, datapoint);
    if (this.rampUpTime_ === Infinity && datapoint > this.rampUpThreshold_) {
      this.rampUpTime_ = time;
    }
    this.count_++;
  },

  getAverage: function getAverage() {
    if (this.count_ === 0) {
      return 0;
    }
    return Math.round(this.sum_ / this.count_);
  },

  getMax: function getMax() {
    return this.max_;
  },

  getRampUpTime: function getRampUpTime() {
    return Math.round(this.rampUpTime_ - this.startTime_);
  }
};

exports.default = StatisticsAggregate;

},{}],33:[function(require,module,exports){
/*
 *  Copyright (c) 2014 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';
/* exported arrayAverage, arrayMax, arrayMin, enumerateStats */

// array<function> returns the average (down to nearest int), max and min of
// an int array.

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.arrayAverage = arrayAverage;
exports.arrayMax = arrayMax;
exports.arrayMin = arrayMin;
exports.enumerateStats = enumerateStats;
function arrayAverage(array) {
  var cnt = array.length;
  var tot = 0;
  for (var i = 0; i < cnt; i++) {
    tot += array[i];
  }
  return Math.floor(tot / cnt);
}

function arrayMax(array) {
  if (array.length === 0) {
    return NaN;
  }
  return Math.max.apply(Math, array);
}

function arrayMin(array) {
  if (array.length === 0) {
    return NaN;
  }
  return Math.min.apply(Math, array);
}

// Enumerates the new standard compliant stats using local and remote track ids.
function enumerateStats(stats, localTrackIds, remoteTrackIds) {
  // Create an object structure with all the needed stats and types that we care
  // about. This allows to map the getStats stats to other stats names.
  var statsObject = {
    audio: {
      local: {
        audioLevel: 0.0,
        bytesSent: 0,
        clockRate: 0,
        codecId: '',
        mimeType: '',
        packetsSent: 0,
        payloadType: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      },
      remote: {
        audioLevel: 0.0,
        bytesReceived: 0,
        clockRate: 0,
        codecId: '',
        fractionLost: 0,
        jitter: 0,
        mimeType: '',
        packetsLost: -1,
        packetsReceived: 0,
        payloadType: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      }
    },
    video: {
      local: {
        bytesSent: 0,
        clockRate: 0,
        codecId: '',
        firCount: 0,
        framesEncoded: 0,
        frameHeight: 0,
        framesSent: -1,
        frameWidth: 0,
        nackCount: 0,
        packetsSent: -1,
        payloadType: 0,
        pliCount: 0,
        qpSum: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      },
      remote: {
        bytesReceived: -1,
        clockRate: 0,
        codecId: '',
        firCount: -1,
        fractionLost: 0,
        frameHeight: 0,
        framesDecoded: 0,
        framesDropped: 0,
        framesReceived: 0,
        frameWidth: 0,
        nackCount: -1,
        packetsLost: -1,
        packetsReceived: 0,
        payloadType: 0,
        pliCount: -1,
        qpSum: 0,
        timestamp: 0.0,
        trackId: '',
        transportId: ''
      }
    },
    connection: {
      availableOutgoingBitrate: 0,
      bytesReceived: 0,
      bytesSent: 0,
      consentRequestsSent: 0,
      currentRoundTripTime: 0.0,
      localCandidateId: '',
      localCandidateType: '',
      localIp: '',
      localPort: 0,
      localPriority: 0,
      localProtocol: '',
      remoteCandidateId: '',
      remoteCandidateType: '',
      remoteIp: '',
      remotePort: 0,
      remotePriority: 0,
      remoteProtocol: '',
      requestsReceived: 0,
      requestsSent: 0,
      responsesReceived: 0,
      responsesSent: 0,
      timestamp: 0.0,
      totalRoundTripTime: 0.0
    }
  };

  // Need to find the codec, local and remote ID's first.
  if (stats) {
    stats.forEach(function (report, stat) {
      switch (report.type) {
        case 'outbound-rtp':
          if (report.hasOwnProperty('trackId')) {
            if (report.trackId.indexOf(localTrackIds.audio) !== 1 & localTrackIds.audio !== '') {
              statsObject.audio.local.bytesSent = report.bytesSent;
              statsObject.audio.local.codecId = report.codecId;
              statsObject.audio.local.packetsSent = report.packetsSent;
              statsObject.audio.local.timestamp = report.timestamp;
              statsObject.audio.local.trackId = report.trackId;
              statsObject.audio.local.transportId = report.transportId;
            } else if (report.trackId.indexOf(localTrackIds.video) !== 1 & localTrackIds.video !== '') {
              statsObject.video.local.bytesSent = report.bytesSent;
              statsObject.video.local.codecId = report.codecId;
              statsObject.video.local.firCount = report.firCount;
              statsObject.video.local.framesEncoded = report.framesEncoded;
              statsObject.video.local.framesSent = report.framesSent;
              statsObject.video.local.packetsSent = report.packetsSent;
              statsObject.video.local.pliCount = report.pliCount;
              statsObject.video.local.qpSum = report.qpSum;
              statsObject.video.local.timestamp = report.timestamp;
              statsObject.video.local.trackId = report.trackId;
              statsObject.video.local.transportId = report.transportId;
            }
          }
          break;
        case 'inbound-rtp':
          if (report.hasOwnProperty('trackId')) {
            if (report.trackId.indexOf(remoteTrackIds.audio) !== 1 & remoteTrackIds.audio !== '') {
              statsObject.audio.remote.bytesReceived = report.bytesReceived;
              statsObject.audio.remote.codecId = report.codecId;
              statsObject.audio.remote.fractionLost = report.fractionLost;
              statsObject.audio.remote.jitter = report.jitter;
              statsObject.audio.remote.packetsLost = report.packetsLost;
              statsObject.audio.remote.packetsReceived = report.packetsReceived;
              statsObject.audio.remote.timestamp = report.timestamp;
              statsObject.audio.remote.trackId = report.trackId;
              statsObject.audio.remote.transportId = report.transportId;
            }
            if (report.trackId.indexOf(remoteTrackIds.video) !== 1 & remoteTrackIds.video !== '') {
              statsObject.video.remote.bytesReceived = report.bytesReceived;
              statsObject.video.remote.codecId = report.codecId;
              statsObject.video.remote.firCount = report.firCount;
              statsObject.video.remote.fractionLost = report.fractionLost;
              statsObject.video.remote.nackCount = report.nackCount;
              statsObject.video.remote.packetsLost = report.packetsLost;
              statsObject.video.remote.packetsReceived = report.packetsReceived;
              statsObject.video.remote.pliCount = report.pliCount;
              statsObject.video.remote.qpSum = report.qpSum;
              statsObject.video.remote.timestamp = report.timestamp;
              statsObject.video.remote.trackId = report.trackId;
              statsObject.video.remote.transportId = report.transportId;
            }
          }
          break;
        case 'candidate-pair':
          if (report.hasOwnProperty('availableOutgoingBitrate')) {
            statsObject.connection.availableOutgoingBitrate = report.availableOutgoingBitrate;
            statsObject.connection.bytesReceived = report.bytesReceived;
            statsObject.connection.bytesSent = report.bytesSent;
            statsObject.connection.consentRequestsSent = report.consentRequestsSent;
            statsObject.connection.currentRoundTripTime = report.currentRoundTripTime;
            statsObject.connection.localCandidateId = report.localCandidateId;
            statsObject.connection.remoteCandidateId = report.remoteCandidateId;
            statsObject.connection.requestsReceived = report.requestsReceived;
            statsObject.connection.requestsSent = report.requestsSent;
            statsObject.connection.responsesReceived = report.responsesReceived;
            statsObject.connection.responsesSent = report.responsesSent;
            statsObject.connection.timestamp = report.timestamp;
            statsObject.connection.totalRoundTripTime = report.totalRoundTripTime;
          }
          break;
        default:
          return;
      }
    }.bind());

    // Using the codec, local and remote candidate ID's to find the rest of the
    // relevant stats.
    stats.forEach(function (report) {
      switch (report.type) {
        case 'track':
          if (report.hasOwnProperty('trackIdentifier')) {
            if (report.trackIdentifier.indexOf(localTrackIds.video) !== 1 & localTrackIds.video !== '') {
              statsObject.video.local.frameHeight = report.frameHeight;
              statsObject.video.local.framesSent = report.framesSent;
              statsObject.video.local.frameWidth = report.frameWidth;
            }
            if (report.trackIdentifier.indexOf(remoteTrackIds.video) !== 1 & remoteTrackIds.video !== '') {
              statsObject.video.remote.frameHeight = report.frameHeight;
              statsObject.video.remote.framesDecoded = report.framesDecoded;
              statsObject.video.remote.framesDropped = report.framesDropped;
              statsObject.video.remote.framesReceived = report.framesReceived;
              statsObject.video.remote.frameWidth = report.frameWidth;
            }
            if (report.trackIdentifier.indexOf(localTrackIds.audio) !== 1 & localTrackIds.audio !== '') {
              statsObject.audio.local.audioLevel = report.audioLevel;
            }
            if (report.trackIdentifier.indexOf(remoteTrackIds.audio) !== 1 & remoteTrackIds.audio !== '') {
              statsObject.audio.remote.audioLevel = report.audioLevel;
            }
          }
          break;
        case 'codec':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.audio.local.codecId) !== 1 & localTrackIds.audio !== '') {
              statsObject.audio.local.clockRate = report.clockRate;
              statsObject.audio.local.mimeType = report.mimeType;
              statsObject.audio.local.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.audio.remote.codecId) !== 1 & remoteTrackIds.audio !== '') {
              statsObject.audio.remote.clockRate = report.clockRate;
              statsObject.audio.remote.mimeType = report.mimeType;
              statsObject.audio.remote.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.video.local.codecId) !== 1 & localTrackIds.video !== '') {
              statsObject.video.local.clockRate = report.clockRate;
              statsObject.video.local.mimeType = report.mimeType;
              statsObject.video.local.payloadType = report.payloadType;
            }
            if (report.id.indexOf(statsObject.video.remote.codecId) !== 1 & remoteTrackIds.video !== '') {
              statsObject.video.remote.clockRate = report.clockRate;
              statsObject.video.remote.mimeType = report.mimeType;
              statsObject.video.remote.payloadType = report.payloadType;
            }
          }
          break;
        case 'local-candidate':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.connection.localCandidateId) !== -1) {
              statsObject.connection.localIp = report.ip;
              statsObject.connection.localPort = report.port;
              statsObject.connection.localPriority = report.priority;
              statsObject.connection.localProtocol = report.protocol;
              statsObject.connection.localType = report.candidateType;
            }
          }
          break;
        case 'remote-candidate':
          if (report.hasOwnProperty('id')) {
            if (report.id.indexOf(statsObject.connection.remoteCandidateId) !== -1) {
              statsObject.connection.remoteIp = report.ip;
              statsObject.connection.remotePort = report.port;
              statsObject.connection.remotePriority = report.priority;
              statsObject.connection.remoteProtocol = report.protocol;
              statsObject.connection.remoteType = report.candidateType;
            }
          }
          break;
        default:
          return;
      }
    }.bind());
  }
  return statsObject;
}

},{}],34:[function(require,module,exports){
/*
 *  Copyright (c) 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree.
 */
'use strict';

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _ssim = require('./ssim.js');

var _ssim2 = _interopRequireDefault(_ssim);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function VideoFrameChecker(videoElement) {
  this.frameStats = {
    numFrozenFrames: 0,
    numBlackFrames: 0,
    numFrames: 0
  };

  this.running_ = true;

  this.nonBlackPixelLumaThreshold = 20;
  this.previousFrame_ = [];
  this.identicalFrameSsimThreshold = 0.985;
  this.frameComparator = new _ssim2.default();

  this.canvas_ = document.createElement('canvas');
  this.videoElement_ = videoElement;
  this.listener_ = this.checkVideoFrame_.bind(this);
  this.videoElement_.addEventListener('play', this.listener_, false);
}

VideoFrameChecker.prototype = {
  stop: function stop() {
    this.videoElement_.removeEventListener('play', this.listener_);
    this.running_ = false;
  },

  getCurrentImageData_: function getCurrentImageData_() {
    this.canvas_.width = this.videoElement_.width;
    this.canvas_.height = this.videoElement_.height;

    var context = this.canvas_.getContext('2d');
    context.drawImage(this.videoElement_, 0, 0, this.canvas_.width, this.canvas_.height);
    return context.getImageData(0, 0, this.canvas_.width, this.canvas_.height);
  },

  checkVideoFrame_: function checkVideoFrame_() {
    if (!this.running_) {
      return;
    }
    if (this.videoElement_.ended) {
      return;
    }

    var imageData = this.getCurrentImageData_();

    if (this.isBlackFrame_(imageData.data, imageData.data.length)) {
      this.frameStats.numBlackFrames++;
    }

    if (this.frameComparator.calculate(this.previousFrame_, imageData.data) > this.identicalFrameSsimThreshold) {
      this.frameStats.numFrozenFrames++;
    }
    this.previousFrame_ = imageData.data;

    this.frameStats.numFrames++;
    setTimeout(this.checkVideoFrame_.bind(this), 20);
  },

  isBlackFrame_: function isBlackFrame_(data, length) {
    // TODO: Use a statistical, histogram-based detection.
    var thresh = this.nonBlackPixelLumaThreshold;
    var accuLuma = 0;
    for (var i = 4; i < length; i += 4) {
      // Use Luma as in Rec. 709: Y′709 = 0.21R + 0.72G + 0.07B;
      accuLuma += 0.21 * data[i] + 0.72 * data[i + 1] + 0.07 * data[i + 2];
      // Early termination if the average Luma so far is bright enough.
      if (accuLuma > thresh * i / 4) {
        return false;
      }
    }
    return true;
  }
};

if ((typeof exports === 'undefined' ? 'undefined' : _typeof(exports)) === 'object') {
  module.exports = VideoFrameChecker;
}

},{"./ssim.js":31}]},{},[15,16,17,18,19,21,22,23,24,25,26,29,30,31,32,33,34])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvcnRjcGVlcmNvbm5lY3Rpb24tc2hpbS9ydGNwZWVyY29ubmVjdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9zZHAvc2RwLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9hZGFwdGVyX2NvcmUuanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2FkYXB0ZXJfZmFjdG9yeS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvY2hyb21lL2Nocm9tZV9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9jaHJvbWUvZ2V0dXNlcm1lZGlhLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9jb21tb25fc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvZWRnZS9lZGdlX3NoaW0uanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2VkZ2UvZmlsdGVyaWNlc2VydmVycy5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvZWRnZS9nZXR1c2VybWVkaWEuanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2ZpcmVmb3gvZmlyZWZveF9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9maXJlZm94L2dldHVzZXJtZWRpYS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvc2FmYXJpL3NhZmFyaV9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy91dGlscy5qcyIsInNyYy9jb25maWcvaW5kZXguanMiLCJzcmMvY29uZmlnL3N1aXRlLmpzIiwic3JjL2NvbmZpZy90ZXN0Q2FzZS5qcyIsInNyYy9pbmRleC5qcyIsInNyYy91bml0L2NhbVJlc29sdXRpb25zLmpzIiwic3JjL3VuaXQvY2FtcmVzb2x1dGlvbnMuanMiLCJzcmMvdW5pdC9jb25uLmpzIiwic3JjL3VuaXQvZGF0YUJhbmR3aWR0aC5qcyIsInNyYy91bml0L21pYy5qcyIsInNyYy91bml0L25ldC5qcyIsInNyYy91bml0L3ZpZGVvQmFuZHdpZHRoLmpzIiwic3JjL3VuaXQvd2lmaVBlcmlvZGljU2Nhbi5qcyIsInNyYy91dGlsL0NhbGwuanMiLCJzcmMvdXRpbC9WaWRlb0ZyYW1lQ2hlY2tlci5qcyIsInNyYy91dGlsL2NhbGwuanMiLCJzcmMvdXRpbC9yZXBvcnQuanMiLCJzcmMvdXRpbC9zc2ltLmpzIiwic3JjL3V0aWwvc3RhdHMuanMiLCJzcmMvdXRpbC91dGlsLmpzIiwic3JjL3V0aWwvdmlkZW9mcmFtZWNoZWNrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0eURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDM3FCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0NEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9SQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDak5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hMQTs7Ozs7O1FBd0NnQixlLEdBQUEsZTtRQWFBLGdCLEdBQUEsZ0I7UUF1Q0EsaUIsR0FBQSxpQjtRQWtDQSxzQixHQUFBLHNCO1FBb0NBLG9CLEdBQUEsb0I7O0FBaEtoQjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7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LGdCQUFMLENBQXNCLElBQXRCLENBQTJCLElBQTNCLENBQVgsRUFBNkMsRUFBN0M7QUFDRCxHQXRDMkI7O0FBd0M1QixpQkFBZSx1QkFBUyxJQUFULEVBQWUsTUFBZixFQUF1QjtBQUNwQztBQUNBLFFBQUksU0FBUyxLQUFLLDBCQUFsQjtBQUNBLFFBQUksV0FBVyxDQUFmO0FBQ0EsU0FBSyxJQUFJLElBQUksQ0FBYixFQUFnQixJQUFJLE1BQXBCLEVBQTRCLEtBQUssQ0FBakMsRUFBb0M7QUFDbEM7QUFDQSxrQkFBWSxPQUFPLEtBQUssQ0FBTCxDQUFQLEdBQWlCLE9BQU8sS0FBSyxJQUFJLENBQVQsQ0FBeEIsR0FBc0MsT0FBTyxLQUFLLElBQUksQ0FBVCxDQUF6RDtBQUNBO0FBQ0EsVUFBSSxXQUFZLFNBQVMsQ0FBVCxHQUFhLENBQTdCLEVBQWlDO0FBQy9CLGVBQU8sS0FBUDtBQUNEO0FBQ0Y7QUFDRCxXQUFPLElBQVA7QUFDRDtBQXJEMkIsQ0FBOUI7O0FBd0RBLElBQUksUUFBTyxPQUFQLHlDQUFPLE9BQVAsT0FBbUIsUUFBdkIsRUFBaUM7QUFDL0IsU0FBTyxPQUFQLEdBQWlCLGlCQUFqQjtBQUNEIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTcgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciBTRFBVdGlscyA9IHJlcXVpcmUoJ3NkcCcpO1xuXG5mdW5jdGlvbiBmaXhTdGF0c1R5cGUoc3RhdCkge1xuICByZXR1cm4ge1xuICAgIGluYm91bmRydHA6ICdpbmJvdW5kLXJ0cCcsXG4gICAgb3V0Ym91bmRydHA6ICdvdXRib3VuZC1ydHAnLFxuICAgIGNhbmRpZGF0ZXBhaXI6ICdjYW5kaWRhdGUtcGFpcicsXG4gICAgbG9jYWxjYW5kaWRhdGU6ICdsb2NhbC1jYW5kaWRhdGUnLFxuICAgIHJlbW90ZWNhbmRpZGF0ZTogJ3JlbW90ZS1jYW5kaWRhdGUnXG4gIH1bc3RhdC50eXBlXSB8fCBzdGF0LnR5cGU7XG59XG5cbmZ1bmN0aW9uIHdyaXRlTWVkaWFTZWN0aW9uKHRyYW5zY2VpdmVyLCBjYXBzLCB0eXBlLCBzdHJlYW0sIGR0bHNSb2xlKSB7XG4gIHZhciBzZHAgPSBTRFBVdGlscy53cml0ZVJ0cERlc2NyaXB0aW9uKHRyYW5zY2VpdmVyLmtpbmQsIGNhcHMpO1xuXG4gIC8vIE1hcCBJQ0UgcGFyYW1ldGVycyAodWZyYWcsIHB3ZCkgdG8gU0RQLlxuICBzZHAgKz0gU0RQVXRpbHMud3JpdGVJY2VQYXJhbWV0ZXJzKFxuICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIuZ2V0TG9jYWxQYXJhbWV0ZXJzKCkpO1xuXG4gIC8vIE1hcCBEVExTIHBhcmFtZXRlcnMgdG8gU0RQLlxuICBzZHAgKz0gU0RQVXRpbHMud3JpdGVEdGxzUGFyYW1ldGVycyhcbiAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQuZ2V0TG9jYWxQYXJhbWV0ZXJzKCksXG4gICAgICB0eXBlID09PSAnb2ZmZXInID8gJ2FjdHBhc3MnIDogZHRsc1JvbGUgfHwgJ2FjdGl2ZScpO1xuXG4gIHNkcCArPSAnYT1taWQ6JyArIHRyYW5zY2VpdmVyLm1pZCArICdcXHJcXG4nO1xuXG4gIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIgJiYgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIpIHtcbiAgICBzZHAgKz0gJ2E9c2VuZHJlY3ZcXHJcXG4nO1xuICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlcikge1xuICAgIHNkcCArPSAnYT1zZW5kb25seVxcclxcbic7XG4gIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIpIHtcbiAgICBzZHAgKz0gJ2E9cmVjdm9ubHlcXHJcXG4nO1xuICB9IGVsc2Uge1xuICAgIHNkcCArPSAnYT1pbmFjdGl2ZVxcclxcbic7XG4gIH1cblxuICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyKSB7XG4gICAgdmFyIHRyYWNrSWQgPSB0cmFuc2NlaXZlci5ydHBTZW5kZXIuX2luaXRpYWxUcmFja0lkIHx8XG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci50cmFjay5pZDtcbiAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIuX2luaXRpYWxUcmFja0lkID0gdHJhY2tJZDtcbiAgICAvLyBzcGVjLlxuICAgIHZhciBtc2lkID0gJ21zaWQ6JyArIChzdHJlYW0gPyBzdHJlYW0uaWQgOiAnLScpICsgJyAnICtcbiAgICAgICAgdHJhY2tJZCArICdcXHJcXG4nO1xuICAgIHNkcCArPSAnYT0nICsgbXNpZDtcbiAgICAvLyBmb3IgQ2hyb21lLiBMZWdhY3kgc2hvdWxkIG5vIGxvbmdlciBiZSByZXF1aXJlZC5cbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICtcbiAgICAgICAgJyAnICsgbXNpZDtcblxuICAgIC8vIFJUWFxuICAgIGlmICh0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgICAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4LnNzcmMgK1xuICAgICAgICAgICcgJyArIG1zaWQ7XG4gICAgICBzZHAgKz0gJ2E9c3NyYy1ncm91cDpGSUQgJyArXG4gICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICsgJyAnICtcbiAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eC5zc3JjICtcbiAgICAgICAgICAnXFxyXFxuJztcbiAgICB9XG4gIH1cbiAgLy8gRklYTUU6IHRoaXMgc2hvdWxkIGJlIHdyaXR0ZW4gYnkgd3JpdGVSdHBEZXNjcmlwdGlvbi5cbiAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArXG4gICAgICAnIGNuYW1lOicgKyBTRFBVdGlscy5sb2NhbENOYW1lICsgJ1xcclxcbic7XG4gIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIgJiYgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHguc3NyYyArXG4gICAgICAgICcgY25hbWU6JyArIFNEUFV0aWxzLmxvY2FsQ05hbWUgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufVxuXG4vLyBFZGdlIGRvZXMgbm90IGxpa2Vcbi8vIDEpIHN0dW46IGZpbHRlcmVkIGFmdGVyIDE0MzkzIHVubGVzcyA/dHJhbnNwb3J0PXVkcCBpcyBwcmVzZW50XG4vLyAyKSB0dXJuOiB0aGF0IGRvZXMgbm90IGhhdmUgYWxsIG9mIHR1cm46aG9zdDpwb3J0P3RyYW5zcG9ydD11ZHBcbi8vIDMpIHR1cm46IHdpdGggaXB2NiBhZGRyZXNzZXNcbi8vIDQpIHR1cm46IG9jY3VycmluZyBtdWxpcGxlIHRpbWVzXG5mdW5jdGlvbiBmaWx0ZXJJY2VTZXJ2ZXJzKGljZVNlcnZlcnMsIGVkZ2VWZXJzaW9uKSB7XG4gIHZhciBoYXNUdXJuID0gZmFsc2U7XG4gIGljZVNlcnZlcnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGljZVNlcnZlcnMpKTtcbiAgcmV0dXJuIGljZVNlcnZlcnMuZmlsdGVyKGZ1bmN0aW9uKHNlcnZlcikge1xuICAgIGlmIChzZXJ2ZXIgJiYgKHNlcnZlci51cmxzIHx8IHNlcnZlci51cmwpKSB7XG4gICAgICB2YXIgdXJscyA9IHNlcnZlci51cmxzIHx8IHNlcnZlci51cmw7XG4gICAgICBpZiAoc2VydmVyLnVybCAmJiAhc2VydmVyLnVybHMpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdSVENJY2VTZXJ2ZXIudXJsIGlzIGRlcHJlY2F0ZWQhIFVzZSB1cmxzIGluc3RlYWQuJyk7XG4gICAgICB9XG4gICAgICB2YXIgaXNTdHJpbmcgPSB0eXBlb2YgdXJscyA9PT0gJ3N0cmluZyc7XG4gICAgICBpZiAoaXNTdHJpbmcpIHtcbiAgICAgICAgdXJscyA9IFt1cmxzXTtcbiAgICAgIH1cbiAgICAgIHVybHMgPSB1cmxzLmZpbHRlcihmdW5jdGlvbih1cmwpIHtcbiAgICAgICAgdmFyIHZhbGlkVHVybiA9IHVybC5pbmRleE9mKCd0dXJuOicpID09PSAwICYmXG4gICAgICAgICAgICB1cmwuaW5kZXhPZigndHJhbnNwb3J0PXVkcCcpICE9PSAtMSAmJlxuICAgICAgICAgICAgdXJsLmluZGV4T2YoJ3R1cm46WycpID09PSAtMSAmJlxuICAgICAgICAgICAgIWhhc1R1cm47XG5cbiAgICAgICAgaWYgKHZhbGlkVHVybikge1xuICAgICAgICAgIGhhc1R1cm4gPSB0cnVlO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1cmwuaW5kZXhPZignc3R1bjonKSA9PT0gMCAmJiBlZGdlVmVyc2lvbiA+PSAxNDM5MyAmJlxuICAgICAgICAgICAgdXJsLmluZGV4T2YoJz90cmFuc3BvcnQ9dWRwJykgPT09IC0xO1xuICAgICAgfSk7XG5cbiAgICAgIGRlbGV0ZSBzZXJ2ZXIudXJsO1xuICAgICAgc2VydmVyLnVybHMgPSBpc1N0cmluZyA/IHVybHNbMF0gOiB1cmxzO1xuICAgICAgcmV0dXJuICEhdXJscy5sZW5ndGg7XG4gICAgfVxuICB9KTtcbn1cblxuLy8gRGV0ZXJtaW5lcyB0aGUgaW50ZXJzZWN0aW9uIG9mIGxvY2FsIGFuZCByZW1vdGUgY2FwYWJpbGl0aWVzLlxuZnVuY3Rpb24gZ2V0Q29tbW9uQ2FwYWJpbGl0aWVzKGxvY2FsQ2FwYWJpbGl0aWVzLCByZW1vdGVDYXBhYmlsaXRpZXMpIHtcbiAgdmFyIGNvbW1vbkNhcGFiaWxpdGllcyA9IHtcbiAgICBjb2RlY3M6IFtdLFxuICAgIGhlYWRlckV4dGVuc2lvbnM6IFtdLFxuICAgIGZlY01lY2hhbmlzbXM6IFtdXG4gIH07XG5cbiAgdmFyIGZpbmRDb2RlY0J5UGF5bG9hZFR5cGUgPSBmdW5jdGlvbihwdCwgY29kZWNzKSB7XG4gICAgcHQgPSBwYXJzZUludChwdCwgMTApO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgY29kZWNzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoY29kZWNzW2ldLnBheWxvYWRUeXBlID09PSBwdCB8fFxuICAgICAgICAgIGNvZGVjc1tpXS5wcmVmZXJyZWRQYXlsb2FkVHlwZSA9PT0gcHQpIHtcbiAgICAgICAgcmV0dXJuIGNvZGVjc1tpXTtcbiAgICAgIH1cbiAgICB9XG4gIH07XG5cbiAgdmFyIHJ0eENhcGFiaWxpdHlNYXRjaGVzID0gZnVuY3Rpb24obFJ0eCwgclJ0eCwgbENvZGVjcywgckNvZGVjcykge1xuICAgIHZhciBsQ29kZWMgPSBmaW5kQ29kZWNCeVBheWxvYWRUeXBlKGxSdHgucGFyYW1ldGVycy5hcHQsIGxDb2RlY3MpO1xuICAgIHZhciByQ29kZWMgPSBmaW5kQ29kZWNCeVBheWxvYWRUeXBlKHJSdHgucGFyYW1ldGVycy5hcHQsIHJDb2RlY3MpO1xuICAgIHJldHVybiBsQ29kZWMgJiYgckNvZGVjICYmXG4gICAgICAgIGxDb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCkgPT09IHJDb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCk7XG4gIH07XG5cbiAgbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzLmZvckVhY2goZnVuY3Rpb24obENvZGVjKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZW1vdGVDYXBhYmlsaXRpZXMuY29kZWNzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgckNvZGVjID0gcmVtb3RlQ2FwYWJpbGl0aWVzLmNvZGVjc1tpXTtcbiAgICAgIGlmIChsQ29kZWMubmFtZS50b0xvd2VyQ2FzZSgpID09PSByQ29kZWMubmFtZS50b0xvd2VyQ2FzZSgpICYmXG4gICAgICAgICAgbENvZGVjLmNsb2NrUmF0ZSA9PT0gckNvZGVjLmNsb2NrUmF0ZSkge1xuICAgICAgICBpZiAobENvZGVjLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gJ3J0eCcgJiZcbiAgICAgICAgICAgIGxDb2RlYy5wYXJhbWV0ZXJzICYmIHJDb2RlYy5wYXJhbWV0ZXJzLmFwdCkge1xuICAgICAgICAgIC8vIGZvciBSVFggd2UgbmVlZCB0byBmaW5kIHRoZSBsb2NhbCBydHggdGhhdCBoYXMgYSBhcHRcbiAgICAgICAgICAvLyB3aGljaCBwb2ludHMgdG8gdGhlIHNhbWUgbG9jYWwgY29kZWMgYXMgdGhlIHJlbW90ZSBvbmUuXG4gICAgICAgICAgaWYgKCFydHhDYXBhYmlsaXR5TWF0Y2hlcyhsQ29kZWMsIHJDb2RlYyxcbiAgICAgICAgICAgICAgbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzLCByZW1vdGVDYXBhYmlsaXRpZXMuY29kZWNzKSkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJDb2RlYyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkockNvZGVjKSk7IC8vIGRlZXBjb3B5XG4gICAgICAgIC8vIG51bWJlciBvZiBjaGFubmVscyBpcyB0aGUgaGlnaGVzdCBjb21tb24gbnVtYmVyIG9mIGNoYW5uZWxzXG4gICAgICAgIHJDb2RlYy5udW1DaGFubmVscyA9IE1hdGgubWluKGxDb2RlYy5udW1DaGFubmVscyxcbiAgICAgICAgICAgIHJDb2RlYy5udW1DaGFubmVscyk7XG4gICAgICAgIC8vIHB1c2ggckNvZGVjIHNvIHdlIHJlcGx5IHdpdGggb2ZmZXJlciBwYXlsb2FkIHR5cGVcbiAgICAgICAgY29tbW9uQ2FwYWJpbGl0aWVzLmNvZGVjcy5wdXNoKHJDb2RlYyk7XG5cbiAgICAgICAgLy8gZGV0ZXJtaW5lIGNvbW1vbiBmZWVkYmFjayBtZWNoYW5pc21zXG4gICAgICAgIHJDb2RlYy5ydGNwRmVlZGJhY2sgPSByQ29kZWMucnRjcEZlZWRiYWNrLmZpbHRlcihmdW5jdGlvbihmYikge1xuICAgICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgbENvZGVjLnJ0Y3BGZWVkYmFjay5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgaWYgKGxDb2RlYy5ydGNwRmVlZGJhY2tbal0udHlwZSA9PT0gZmIudHlwZSAmJlxuICAgICAgICAgICAgICAgIGxDb2RlYy5ydGNwRmVlZGJhY2tbal0ucGFyYW1ldGVyID09PSBmYi5wYXJhbWV0ZXIpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIEZJWE1FOiBhbHNvIG5lZWQgdG8gZGV0ZXJtaW5lIC5wYXJhbWV0ZXJzXG4gICAgICAgIC8vICBzZWUgaHR0cHM6Ly9naXRodWIuY29tL29wZW5wZWVyL29ydGMvaXNzdWVzLzU2OVxuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIGxvY2FsQ2FwYWJpbGl0aWVzLmhlYWRlckV4dGVuc2lvbnMuZm9yRWFjaChmdW5jdGlvbihsSGVhZGVyRXh0ZW5zaW9uKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCByZW1vdGVDYXBhYmlsaXRpZXMuaGVhZGVyRXh0ZW5zaW9ucy5sZW5ndGg7XG4gICAgICAgICBpKyspIHtcbiAgICAgIHZhciBySGVhZGVyRXh0ZW5zaW9uID0gcmVtb3RlQ2FwYWJpbGl0aWVzLmhlYWRlckV4dGVuc2lvbnNbaV07XG4gICAgICBpZiAobEhlYWRlckV4dGVuc2lvbi51cmkgPT09IHJIZWFkZXJFeHRlbnNpb24udXJpKSB7XG4gICAgICAgIGNvbW1vbkNhcGFiaWxpdGllcy5oZWFkZXJFeHRlbnNpb25zLnB1c2gockhlYWRlckV4dGVuc2lvbik7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLy8gRklYTUU6IGZlY01lY2hhbmlzbXNcbiAgcmV0dXJuIGNvbW1vbkNhcGFiaWxpdGllcztcbn1cblxuLy8gaXMgYWN0aW9uPXNldExvY2FsRGVzY3JpcHRpb24gd2l0aCB0eXBlIGFsbG93ZWQgaW4gc2lnbmFsaW5nU3RhdGVcbmZ1bmN0aW9uIGlzQWN0aW9uQWxsb3dlZEluU2lnbmFsaW5nU3RhdGUoYWN0aW9uLCB0eXBlLCBzaWduYWxpbmdTdGF0ZSkge1xuICByZXR1cm4ge1xuICAgIG9mZmVyOiB7XG4gICAgICBzZXRMb2NhbERlc2NyaXB0aW9uOiBbJ3N0YWJsZScsICdoYXZlLWxvY2FsLW9mZmVyJ10sXG4gICAgICBzZXRSZW1vdGVEZXNjcmlwdGlvbjogWydzdGFibGUnLCAnaGF2ZS1yZW1vdGUtb2ZmZXInXVxuICAgIH0sXG4gICAgYW5zd2VyOiB7XG4gICAgICBzZXRMb2NhbERlc2NyaXB0aW9uOiBbJ2hhdmUtcmVtb3RlLW9mZmVyJywgJ2hhdmUtbG9jYWwtcHJhbnN3ZXInXSxcbiAgICAgIHNldFJlbW90ZURlc2NyaXB0aW9uOiBbJ2hhdmUtbG9jYWwtb2ZmZXInLCAnaGF2ZS1yZW1vdGUtcHJhbnN3ZXInXVxuICAgIH1cbiAgfVt0eXBlXVthY3Rpb25dLmluZGV4T2Yoc2lnbmFsaW5nU3RhdGUpICE9PSAtMTtcbn1cblxuZnVuY3Rpb24gbWF5YmVBZGRDYW5kaWRhdGUoaWNlVHJhbnNwb3J0LCBjYW5kaWRhdGUpIHtcbiAgLy8gRWRnZSdzIGludGVybmFsIHJlcHJlc2VudGF0aW9uIGFkZHMgc29tZSBmaWVsZHMgdGhlcmVmb3JlXG4gIC8vIG5vdCBhbGwgZmllbGTRlSBhcmUgdGFrZW4gaW50byBhY2NvdW50LlxuICB2YXIgYWxyZWFkeUFkZGVkID0gaWNlVHJhbnNwb3J0LmdldFJlbW90ZUNhbmRpZGF0ZXMoKVxuICAgICAgLmZpbmQoZnVuY3Rpb24ocmVtb3RlQ2FuZGlkYXRlKSB7XG4gICAgICAgIHJldHVybiBjYW5kaWRhdGUuZm91bmRhdGlvbiA9PT0gcmVtb3RlQ2FuZGlkYXRlLmZvdW5kYXRpb24gJiZcbiAgICAgICAgICAgIGNhbmRpZGF0ZS5pcCA9PT0gcmVtb3RlQ2FuZGlkYXRlLmlwICYmXG4gICAgICAgICAgICBjYW5kaWRhdGUucG9ydCA9PT0gcmVtb3RlQ2FuZGlkYXRlLnBvcnQgJiZcbiAgICAgICAgICAgIGNhbmRpZGF0ZS5wcmlvcml0eSA9PT0gcmVtb3RlQ2FuZGlkYXRlLnByaW9yaXR5ICYmXG4gICAgICAgICAgICBjYW5kaWRhdGUucHJvdG9jb2wgPT09IHJlbW90ZUNhbmRpZGF0ZS5wcm90b2NvbCAmJlxuICAgICAgICAgICAgY2FuZGlkYXRlLnR5cGUgPT09IHJlbW90ZUNhbmRpZGF0ZS50eXBlO1xuICAgICAgfSk7XG4gIGlmICghYWxyZWFkeUFkZGVkKSB7XG4gICAgaWNlVHJhbnNwb3J0LmFkZFJlbW90ZUNhbmRpZGF0ZShjYW5kaWRhdGUpO1xuICB9XG4gIHJldHVybiAhYWxyZWFkeUFkZGVkO1xufVxuXG5cbmZ1bmN0aW9uIG1ha2VFcnJvcihuYW1lLCBkZXNjcmlwdGlvbikge1xuICB2YXIgZSA9IG5ldyBFcnJvcihkZXNjcmlwdGlvbik7XG4gIGUubmFtZSA9IG5hbWU7XG4gIC8vIGxlZ2FjeSBlcnJvciBjb2RlcyBmcm9tIGh0dHBzOi8vaGV5Y2FtLmdpdGh1Yi5pby93ZWJpZGwvI2lkbC1ET01FeGNlcHRpb24tZXJyb3ItbmFtZXNcbiAgZS5jb2RlID0ge1xuICAgIE5vdFN1cHBvcnRlZEVycm9yOiA5LFxuICAgIEludmFsaWRTdGF0ZUVycm9yOiAxMSxcbiAgICBJbnZhbGlkQWNjZXNzRXJyb3I6IDE1LFxuICAgIFR5cGVFcnJvcjogdW5kZWZpbmVkLFxuICAgIE9wZXJhdGlvbkVycm9yOiB1bmRlZmluZWRcbiAgfVtuYW1lXTtcbiAgcmV0dXJuIGU7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24od2luZG93LCBlZGdlVmVyc2lvbikge1xuICAvLyBodHRwczovL3czYy5naXRodWIuaW8vbWVkaWFjYXB0dXJlLW1haW4vI21lZGlhc3RyZWFtXG4gIC8vIEhlbHBlciBmdW5jdGlvbiB0byBhZGQgdGhlIHRyYWNrIHRvIHRoZSBzdHJlYW0gYW5kXG4gIC8vIGRpc3BhdGNoIHRoZSBldmVudCBvdXJzZWx2ZXMuXG4gIGZ1bmN0aW9uIGFkZFRyYWNrVG9TdHJlYW1BbmRGaXJlRXZlbnQodHJhY2ssIHN0cmVhbSkge1xuICAgIHN0cmVhbS5hZGRUcmFjayh0cmFjayk7XG4gICAgc3RyZWFtLmRpc3BhdGNoRXZlbnQobmV3IHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrRXZlbnQoJ2FkZHRyYWNrJyxcbiAgICAgICAge3RyYWNrOiB0cmFja30pKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHJlbW92ZVRyYWNrRnJvbVN0cmVhbUFuZEZpcmVFdmVudCh0cmFjaywgc3RyZWFtKSB7XG4gICAgc3RyZWFtLnJlbW92ZVRyYWNrKHRyYWNrKTtcbiAgICBzdHJlYW0uZGlzcGF0Y2hFdmVudChuZXcgd2luZG93Lk1lZGlhU3RyZWFtVHJhY2tFdmVudCgncmVtb3ZldHJhY2snLFxuICAgICAgICB7dHJhY2s6IHRyYWNrfSkpO1xuICB9XG5cbiAgZnVuY3Rpb24gZmlyZUFkZFRyYWNrKHBjLCB0cmFjaywgcmVjZWl2ZXIsIHN0cmVhbXMpIHtcbiAgICB2YXIgdHJhY2tFdmVudCA9IG5ldyBFdmVudCgndHJhY2snKTtcbiAgICB0cmFja0V2ZW50LnRyYWNrID0gdHJhY2s7XG4gICAgdHJhY2tFdmVudC5yZWNlaXZlciA9IHJlY2VpdmVyO1xuICAgIHRyYWNrRXZlbnQudHJhbnNjZWl2ZXIgPSB7cmVjZWl2ZXI6IHJlY2VpdmVyfTtcbiAgICB0cmFja0V2ZW50LnN0cmVhbXMgPSBzdHJlYW1zO1xuICAgIHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgcGMuX2Rpc3BhdGNoRXZlbnQoJ3RyYWNrJywgdHJhY2tFdmVudCk7XG4gICAgfSk7XG4gIH1cblxuICB2YXIgUlRDUGVlckNvbm5lY3Rpb24gPSBmdW5jdGlvbihjb25maWcpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuXG4gICAgdmFyIF9ldmVudFRhcmdldCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBbJ2FkZEV2ZW50TGlzdGVuZXInLCAncmVtb3ZlRXZlbnRMaXN0ZW5lcicsICdkaXNwYXRjaEV2ZW50J11cbiAgICAgICAgLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICAgICAgcGNbbWV0aG9kXSA9IF9ldmVudFRhcmdldFttZXRob2RdLmJpbmQoX2V2ZW50VGFyZ2V0KTtcbiAgICAgICAgfSk7XG5cbiAgICB0aGlzLmNhblRyaWNrbGVJY2VDYW5kaWRhdGVzID0gbnVsbDtcblxuICAgIHRoaXMubmVlZE5lZ290aWF0aW9uID0gZmFsc2U7XG5cbiAgICB0aGlzLmxvY2FsU3RyZWFtcyA9IFtdO1xuICAgIHRoaXMucmVtb3RlU3RyZWFtcyA9IFtdO1xuXG4gICAgdGhpcy5fbG9jYWxEZXNjcmlwdGlvbiA9IG51bGw7XG4gICAgdGhpcy5fcmVtb3RlRGVzY3JpcHRpb24gPSBudWxsO1xuXG4gICAgdGhpcy5zaWduYWxpbmdTdGF0ZSA9ICdzdGFibGUnO1xuICAgIHRoaXMuaWNlQ29ubmVjdGlvblN0YXRlID0gJ25ldyc7XG4gICAgdGhpcy5jb25uZWN0aW9uU3RhdGUgPSAnbmV3JztcbiAgICB0aGlzLmljZUdhdGhlcmluZ1N0YXRlID0gJ25ldyc7XG5cbiAgICBjb25maWcgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGNvbmZpZyB8fCB7fSkpO1xuXG4gICAgdGhpcy51c2luZ0J1bmRsZSA9IGNvbmZpZy5idW5kbGVQb2xpY3kgPT09ICdtYXgtYnVuZGxlJztcbiAgICBpZiAoY29uZmlnLnJ0Y3BNdXhQb2xpY3kgPT09ICduZWdvdGlhdGUnKSB7XG4gICAgICB0aHJvdyhtYWtlRXJyb3IoJ05vdFN1cHBvcnRlZEVycm9yJyxcbiAgICAgICAgICAncnRjcE11eFBvbGljeSBcXCduZWdvdGlhdGVcXCcgaXMgbm90IHN1cHBvcnRlZCcpKTtcbiAgICB9IGVsc2UgaWYgKCFjb25maWcucnRjcE11eFBvbGljeSkge1xuICAgICAgY29uZmlnLnJ0Y3BNdXhQb2xpY3kgPSAncmVxdWlyZSc7XG4gICAgfVxuXG4gICAgc3dpdGNoIChjb25maWcuaWNlVHJhbnNwb3J0UG9saWN5KSB7XG4gICAgICBjYXNlICdhbGwnOlxuICAgICAgY2FzZSAncmVsYXknOlxuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGNvbmZpZy5pY2VUcmFuc3BvcnRQb2xpY3kgPSAnYWxsJztcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgc3dpdGNoIChjb25maWcuYnVuZGxlUG9saWN5KSB7XG4gICAgICBjYXNlICdiYWxhbmNlZCc6XG4gICAgICBjYXNlICdtYXgtY29tcGF0JzpcbiAgICAgIGNhc2UgJ21heC1idW5kbGUnOlxuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGNvbmZpZy5idW5kbGVQb2xpY3kgPSAnYmFsYW5jZWQnO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBjb25maWcuaWNlU2VydmVycyA9IGZpbHRlckljZVNlcnZlcnMoY29uZmlnLmljZVNlcnZlcnMgfHwgW10sIGVkZ2VWZXJzaW9uKTtcblxuICAgIHRoaXMuX2ljZUdhdGhlcmVycyA9IFtdO1xuICAgIGlmIChjb25maWcuaWNlQ2FuZGlkYXRlUG9vbFNpemUpIHtcbiAgICAgIGZvciAodmFyIGkgPSBjb25maWcuaWNlQ2FuZGlkYXRlUG9vbFNpemU7IGkgPiAwOyBpLS0pIHtcbiAgICAgICAgdGhpcy5faWNlR2F0aGVyZXJzLnB1c2gobmV3IHdpbmRvdy5SVENJY2VHYXRoZXJlcih7XG4gICAgICAgICAgaWNlU2VydmVyczogY29uZmlnLmljZVNlcnZlcnMsXG4gICAgICAgICAgZ2F0aGVyUG9saWN5OiBjb25maWcuaWNlVHJhbnNwb3J0UG9saWN5XG4gICAgICAgIH0pKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uZmlnLmljZUNhbmRpZGF0ZVBvb2xTaXplID0gMDtcbiAgICB9XG5cbiAgICB0aGlzLl9jb25maWcgPSBjb25maWc7XG5cbiAgICAvLyBwZXItdHJhY2sgaWNlR2F0aGVycywgaWNlVHJhbnNwb3J0cywgZHRsc1RyYW5zcG9ydHMsIHJ0cFNlbmRlcnMsIC4uLlxuICAgIC8vIGV2ZXJ5dGhpbmcgdGhhdCBpcyBuZWVkZWQgdG8gZGVzY3JpYmUgYSBTRFAgbS1saW5lLlxuICAgIHRoaXMudHJhbnNjZWl2ZXJzID0gW107XG5cbiAgICB0aGlzLl9zZHBTZXNzaW9uSWQgPSBTRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCgpO1xuICAgIHRoaXMuX3NkcFNlc3Npb25WZXJzaW9uID0gMDtcblxuICAgIHRoaXMuX2R0bHNSb2xlID0gdW5kZWZpbmVkOyAvLyByb2xlIGZvciBhPXNldHVwIHRvIHVzZSBpbiBhbnN3ZXJzLlxuXG4gICAgdGhpcy5faXNDbG9zZWQgPSBmYWxzZTtcbiAgfTtcblxuICBPYmplY3QuZGVmaW5lUHJvcGVydHkoUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAnbG9jYWxEZXNjcmlwdGlvbicsIHtcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLl9sb2NhbERlc2NyaXB0aW9uO1xuICAgIH1cbiAgfSk7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdyZW1vdGVEZXNjcmlwdGlvbicsIHtcbiAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLl9yZW1vdGVEZXNjcmlwdGlvbjtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIHNldCB1cCBldmVudCBoYW5kbGVycyBvbiBwcm90b3R5cGVcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uaWNlY2FuZGlkYXRlID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uYWRkc3RyZWFtID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9udHJhY2sgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25yZW1vdmVzdHJlYW0gPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25zaWduYWxpbmdzdGF0ZWNoYW5nZSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbmljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbmNvbm5lY3Rpb25zdGF0ZWNoYW5nZSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbmljZWdhdGhlcmluZ3N0YXRlY2hhbmdlID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9ubmVnb3RpYXRpb25uZWVkZWQgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25kYXRhY2hhbm5lbCA9IG51bGw7XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9kaXNwYXRjaEV2ZW50ID0gZnVuY3Rpb24obmFtZSwgZXZlbnQpIHtcbiAgICBpZiAodGhpcy5faXNDbG9zZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgICBpZiAodHlwZW9mIHRoaXNbJ29uJyArIG5hbWVdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB0aGlzWydvbicgKyBuYW1lXShldmVudCk7XG4gICAgfVxuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fZW1pdEdhdGhlcmluZ1N0YXRlQ2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdpY2VnYXRoZXJpbmdzdGF0ZWNoYW5nZScpO1xuICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnQoJ2ljZWdhdGhlcmluZ3N0YXRlY2hhbmdlJywgZXZlbnQpO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRDb25maWd1cmF0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZztcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0TG9jYWxTdHJlYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubG9jYWxTdHJlYW1zO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZW1vdGVTdHJlYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMucmVtb3RlU3RyZWFtcztcbiAgfTtcblxuICAvLyBpbnRlcm5hbCBoZWxwZXIgdG8gY3JlYXRlIGEgdHJhbnNjZWl2ZXIgb2JqZWN0LlxuICAvLyAod2hpY2ggaXMgbm90IHlldCB0aGUgc2FtZSBhcyB0aGUgV2ViUlRDIDEuMCB0cmFuc2NlaXZlcilcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9jcmVhdGVUcmFuc2NlaXZlciA9IGZ1bmN0aW9uKGtpbmQsIGRvTm90QWRkKSB7XG4gICAgdmFyIGhhc0J1bmRsZVRyYW5zcG9ydCA9IHRoaXMudHJhbnNjZWl2ZXJzLmxlbmd0aCA+IDA7XG4gICAgdmFyIHRyYW5zY2VpdmVyID0ge1xuICAgICAgdHJhY2s6IG51bGwsXG4gICAgICBpY2VHYXRoZXJlcjogbnVsbCxcbiAgICAgIGljZVRyYW5zcG9ydDogbnVsbCxcbiAgICAgIGR0bHNUcmFuc3BvcnQ6IG51bGwsXG4gICAgICBsb2NhbENhcGFiaWxpdGllczogbnVsbCxcbiAgICAgIHJlbW90ZUNhcGFiaWxpdGllczogbnVsbCxcbiAgICAgIHJ0cFNlbmRlcjogbnVsbCxcbiAgICAgIHJ0cFJlY2VpdmVyOiBudWxsLFxuICAgICAga2luZDoga2luZCxcbiAgICAgIG1pZDogbnVsbCxcbiAgICAgIHNlbmRFbmNvZGluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICByZWN2RW5jb2RpbmdQYXJhbWV0ZXJzOiBudWxsLFxuICAgICAgc3RyZWFtOiBudWxsLFxuICAgICAgYXNzb2NpYXRlZFJlbW90ZU1lZGlhU3RyZWFtczogW10sXG4gICAgICB3YW50UmVjZWl2ZTogdHJ1ZVxuICAgIH07XG4gICAgaWYgKHRoaXMudXNpbmdCdW5kbGUgJiYgaGFzQnVuZGxlVHJhbnNwb3J0KSB7XG4gICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQgPSB0aGlzLnRyYW5zY2VpdmVyc1swXS5pY2VUcmFuc3BvcnQ7XG4gICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0ID0gdGhpcy50cmFuc2NlaXZlcnNbMF0uZHRsc1RyYW5zcG9ydDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHRyYW5zcG9ydHMgPSB0aGlzLl9jcmVhdGVJY2VBbmREdGxzVHJhbnNwb3J0cygpO1xuICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0ID0gdHJhbnNwb3J0cy5pY2VUcmFuc3BvcnQ7XG4gICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0ID0gdHJhbnNwb3J0cy5kdGxzVHJhbnNwb3J0O1xuICAgIH1cbiAgICBpZiAoIWRvTm90QWRkKSB7XG4gICAgICB0aGlzLnRyYW5zY2VpdmVycy5wdXNoKHRyYW5zY2VpdmVyKTtcbiAgICB9XG4gICAgcmV0dXJuIHRyYW5zY2VpdmVyO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKHRyYWNrLCBzdHJlYW0pIHtcbiAgICBpZiAodGhpcy5faXNDbG9zZWQpIHtcbiAgICAgIHRocm93IG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdBdHRlbXB0ZWQgdG8gY2FsbCBhZGRUcmFjayBvbiBhIGNsb3NlZCBwZWVyY29ubmVjdGlvbi4nKTtcbiAgICB9XG5cbiAgICB2YXIgYWxyZWFkeUV4aXN0cyA9IHRoaXMudHJhbnNjZWl2ZXJzLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgIH0pO1xuXG4gICAgaWYgKGFscmVhZHlFeGlzdHMpIHtcbiAgICAgIHRocm93IG1ha2VFcnJvcignSW52YWxpZEFjY2Vzc0Vycm9yJywgJ1RyYWNrIGFscmVhZHkgZXhpc3RzLicpO1xuICAgIH1cblxuICAgIHZhciB0cmFuc2NlaXZlcjtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMudHJhbnNjZWl2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoIXRoaXMudHJhbnNjZWl2ZXJzW2ldLnRyYWNrICYmXG4gICAgICAgICAgdGhpcy50cmFuc2NlaXZlcnNbaV0ua2luZCA9PT0gdHJhY2sua2luZCkge1xuICAgICAgICB0cmFuc2NlaXZlciA9IHRoaXMudHJhbnNjZWl2ZXJzW2ldO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIXRyYW5zY2VpdmVyKSB7XG4gICAgICB0cmFuc2NlaXZlciA9IHRoaXMuX2NyZWF0ZVRyYW5zY2VpdmVyKHRyYWNrLmtpbmQpO1xuICAgIH1cblxuICAgIHRoaXMuX21heWJlRmlyZU5lZ290aWF0aW9uTmVlZGVkKCk7XG5cbiAgICBpZiAodGhpcy5sb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID09PSAtMSkge1xuICAgICAgdGhpcy5sb2NhbFN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgIH1cblxuICAgIHRyYW5zY2VpdmVyLnRyYWNrID0gdHJhY2s7XG4gICAgdHJhbnNjZWl2ZXIuc3RyZWFtID0gc3RyZWFtO1xuICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlciA9IG5ldyB3aW5kb3cuUlRDUnRwU2VuZGVyKHRyYWNrLFxuICAgICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0KTtcbiAgICByZXR1cm4gdHJhbnNjZWl2ZXIucnRwU2VuZGVyO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIGlmIChlZGdlVmVyc2lvbiA+PSAxNTAyNSkge1xuICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgcGMuYWRkVHJhY2sodHJhY2ssIHN0cmVhbSk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQ2xvbmUgaXMgbmVjZXNzYXJ5IGZvciBsb2NhbCBkZW1vcyBtb3N0bHksIGF0dGFjaGluZyBkaXJlY3RseVxuICAgICAgLy8gdG8gdHdvIGRpZmZlcmVudCBzZW5kZXJzIGRvZXMgbm90IHdvcmsgKGJ1aWxkIDEwNTQ3KS5cbiAgICAgIC8vIEZpeGVkIGluIDE1MDI1IChvciBlYXJsaWVyKVxuICAgICAgdmFyIGNsb25lZFN0cmVhbSA9IHN0cmVhbS5jbG9uZSgpO1xuICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2ssIGlkeCkge1xuICAgICAgICB2YXIgY2xvbmVkVHJhY2sgPSBjbG9uZWRTdHJlYW0uZ2V0VHJhY2tzKClbaWR4XTtcbiAgICAgICAgdHJhY2suYWRkRXZlbnRMaXN0ZW5lcignZW5hYmxlZCcsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgY2xvbmVkVHJhY2suZW5hYmxlZCA9IGV2ZW50LmVuYWJsZWQ7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBjbG9uZWRTdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICBwYy5hZGRUcmFjayh0cmFjaywgY2xvbmVkU3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlVHJhY2sgPSBmdW5jdGlvbihzZW5kZXIpIHtcbiAgICBpZiAodGhpcy5faXNDbG9zZWQpIHtcbiAgICAgIHRocm93IG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdBdHRlbXB0ZWQgdG8gY2FsbCByZW1vdmVUcmFjayBvbiBhIGNsb3NlZCBwZWVyY29ubmVjdGlvbi4nKTtcbiAgICB9XG5cbiAgICBpZiAoIShzZW5kZXIgaW5zdGFuY2VvZiB3aW5kb3cuUlRDUnRwU2VuZGVyKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgMSBvZiBSVENQZWVyQ29ubmVjdGlvbi5yZW1vdmVUcmFjayAnICtcbiAgICAgICAgICAnZG9lcyBub3QgaW1wbGVtZW50IGludGVyZmFjZSBSVENSdHBTZW5kZXIuJyk7XG4gICAgfVxuXG4gICAgdmFyIHRyYW5zY2VpdmVyID0gdGhpcy50cmFuc2NlaXZlcnMuZmluZChmdW5jdGlvbih0KSB7XG4gICAgICByZXR1cm4gdC5ydHBTZW5kZXIgPT09IHNlbmRlcjtcbiAgICB9KTtcblxuICAgIGlmICghdHJhbnNjZWl2ZXIpIHtcbiAgICAgIHRocm93IG1ha2VFcnJvcignSW52YWxpZEFjY2Vzc0Vycm9yJyxcbiAgICAgICAgICAnU2VuZGVyIHdhcyBub3QgY3JlYXRlZCBieSB0aGlzIGNvbm5lY3Rpb24uJyk7XG4gICAgfVxuICAgIHZhciBzdHJlYW0gPSB0cmFuc2NlaXZlci5zdHJlYW07XG5cbiAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIuc3RvcCgpO1xuICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlciA9IG51bGw7XG4gICAgdHJhbnNjZWl2ZXIudHJhY2sgPSBudWxsO1xuICAgIHRyYW5zY2VpdmVyLnN0cmVhbSA9IG51bGw7XG5cbiAgICAvLyByZW1vdmUgdGhlIHN0cmVhbSBmcm9tIHRoZSBzZXQgb2YgbG9jYWwgc3RyZWFtc1xuICAgIHZhciBsb2NhbFN0cmVhbXMgPSB0aGlzLnRyYW5zY2VpdmVycy5tYXAoZnVuY3Rpb24odCkge1xuICAgICAgcmV0dXJuIHQuc3RyZWFtO1xuICAgIH0pO1xuICAgIGlmIChsb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID09PSAtMSAmJlxuICAgICAgICB0aGlzLmxvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPiAtMSkge1xuICAgICAgdGhpcy5sb2NhbFN0cmVhbXMuc3BsaWNlKHRoaXMubG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSwgMSk7XG4gICAgfVxuXG4gICAgdGhpcy5fbWF5YmVGaXJlTmVnb3RpYXRpb25OZWVkZWQoKTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdmFyIHNlbmRlciA9IHBjLmdldFNlbmRlcnMoKS5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgICAgfSk7XG4gICAgICBpZiAoc2VuZGVyKSB7XG4gICAgICAgIHBjLnJlbW92ZVRyYWNrKHNlbmRlcik7XG4gICAgICB9XG4gICAgfSk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnMgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy50cmFuc2NlaXZlcnMuZmlsdGVyKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICByZXR1cm4gISF0cmFuc2NlaXZlci5ydHBTZW5kZXI7XG4gICAgfSlcbiAgICAubWFwKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICByZXR1cm4gdHJhbnNjZWl2ZXIucnRwU2VuZGVyO1xuICAgIH0pO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnMgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy50cmFuc2NlaXZlcnMuZmlsdGVyKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICByZXR1cm4gISF0cmFuc2NlaXZlci5ydHBSZWNlaXZlcjtcbiAgICB9KVxuICAgIC5tYXAoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIHJldHVybiB0cmFuc2NlaXZlci5ydHBSZWNlaXZlcjtcbiAgICB9KTtcbiAgfTtcblxuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fY3JlYXRlSWNlR2F0aGVyZXIgPSBmdW5jdGlvbihzZHBNTGluZUluZGV4LFxuICAgICAgdXNpbmdCdW5kbGUpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIGlmICh1c2luZ0J1bmRsZSAmJiBzZHBNTGluZUluZGV4ID4gMCkge1xuICAgICAgcmV0dXJuIHRoaXMudHJhbnNjZWl2ZXJzWzBdLmljZUdhdGhlcmVyO1xuICAgIH0gZWxzZSBpZiAodGhpcy5faWNlR2F0aGVyZXJzLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIHRoaXMuX2ljZUdhdGhlcmVycy5zaGlmdCgpO1xuICAgIH1cbiAgICB2YXIgaWNlR2F0aGVyZXIgPSBuZXcgd2luZG93LlJUQ0ljZUdhdGhlcmVyKHtcbiAgICAgIGljZVNlcnZlcnM6IHRoaXMuX2NvbmZpZy5pY2VTZXJ2ZXJzLFxuICAgICAgZ2F0aGVyUG9saWN5OiB0aGlzLl9jb25maWcuaWNlVHJhbnNwb3J0UG9saWN5XG4gICAgfSk7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGljZUdhdGhlcmVyLCAnc3RhdGUnLFxuICAgICAgICB7dmFsdWU6ICduZXcnLCB3cml0YWJsZTogdHJ1ZX1cbiAgICApO1xuXG4gICAgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyZWRDYW5kaWRhdGVFdmVudHMgPSBbXTtcbiAgICB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJDYW5kaWRhdGVzID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIHZhciBlbmQgPSAhZXZlbnQuY2FuZGlkYXRlIHx8IE9iamVjdC5rZXlzKGV2ZW50LmNhbmRpZGF0ZSkubGVuZ3RoID09PSAwO1xuICAgICAgLy8gcG9seWZpbGwgc2luY2UgUlRDSWNlR2F0aGVyZXIuc3RhdGUgaXMgbm90IGltcGxlbWVudGVkIGluXG4gICAgICAvLyBFZGdlIDEwNTQ3IHlldC5cbiAgICAgIGljZUdhdGhlcmVyLnN0YXRlID0gZW5kID8gJ2NvbXBsZXRlZCcgOiAnZ2F0aGVyaW5nJztcbiAgICAgIGlmIChwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyZWRDYW5kaWRhdGVFdmVudHMgIT09IG51bGwpIHtcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzLnB1c2goZXZlbnQpO1xuICAgICAgfVxuICAgIH07XG4gICAgaWNlR2F0aGVyZXIuYWRkRXZlbnRMaXN0ZW5lcignbG9jYWxjYW5kaWRhdGUnLFxuICAgICAgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyQ2FuZGlkYXRlcyk7XG4gICAgcmV0dXJuIGljZUdhdGhlcmVyO1xuICB9O1xuXG4gIC8vIHN0YXJ0IGdhdGhlcmluZyBmcm9tIGFuIFJUQ0ljZUdhdGhlcmVyLlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2dhdGhlciA9IGZ1bmN0aW9uKG1pZCwgc2RwTUxpbmVJbmRleCkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgdmFyIGljZUdhdGhlcmVyID0gdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlR2F0aGVyZXI7XG4gICAgaWYgKGljZUdhdGhlcmVyLm9ubG9jYWxjYW5kaWRhdGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzID1cbiAgICAgIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzO1xuICAgIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlcmVkQ2FuZGlkYXRlRXZlbnRzID0gbnVsbDtcbiAgICBpY2VHYXRoZXJlci5yZW1vdmVFdmVudExpc3RlbmVyKCdsb2NhbGNhbmRpZGF0ZScsXG4gICAgICB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJDYW5kaWRhdGVzKTtcbiAgICBpY2VHYXRoZXJlci5vbmxvY2FsY2FuZGlkYXRlID0gZnVuY3Rpb24oZXZ0KSB7XG4gICAgICBpZiAocGMudXNpbmdCdW5kbGUgJiYgc2RwTUxpbmVJbmRleCA+IDApIHtcbiAgICAgICAgLy8gaWYgd2Uga25vdyB0aGF0IHdlIHVzZSBidW5kbGUgd2UgY2FuIGRyb3AgY2FuZGlkYXRlcyB3aXRoXG4gICAgICAgIC8vINGVZHBNTGluZUluZGV4ID4gMC4gSWYgd2UgZG9uJ3QgZG8gdGhpcyB0aGVuIG91ciBzdGF0ZSBnZXRzXG4gICAgICAgIC8vIGNvbmZ1c2VkIHNpbmNlIHdlIGRpc3Bvc2UgdGhlIGV4dHJhIGljZSBnYXRoZXJlci5cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdpY2VjYW5kaWRhdGUnKTtcbiAgICAgIGV2ZW50LmNhbmRpZGF0ZSA9IHtzZHBNaWQ6IG1pZCwgc2RwTUxpbmVJbmRleDogc2RwTUxpbmVJbmRleH07XG5cbiAgICAgIHZhciBjYW5kID0gZXZ0LmNhbmRpZGF0ZTtcbiAgICAgIC8vIEVkZ2UgZW1pdHMgYW4gZW1wdHkgb2JqZWN0IGZvciBSVENJY2VDYW5kaWRhdGVDb21wbGV0ZeKApVxuICAgICAgdmFyIGVuZCA9ICFjYW5kIHx8IE9iamVjdC5rZXlzKGNhbmQpLmxlbmd0aCA9PT0gMDtcbiAgICAgIGlmIChlbmQpIHtcbiAgICAgICAgLy8gcG9seWZpbGwgc2luY2UgUlRDSWNlR2F0aGVyZXIuc3RhdGUgaXMgbm90IGltcGxlbWVudGVkIGluXG4gICAgICAgIC8vIEVkZ2UgMTA1NDcgeWV0LlxuICAgICAgICBpZiAoaWNlR2F0aGVyZXIuc3RhdGUgPT09ICduZXcnIHx8IGljZUdhdGhlcmVyLnN0YXRlID09PSAnZ2F0aGVyaW5nJykge1xuICAgICAgICAgIGljZUdhdGhlcmVyLnN0YXRlID0gJ2NvbXBsZXRlZCc7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChpY2VHYXRoZXJlci5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICBpY2VHYXRoZXJlci5zdGF0ZSA9ICdnYXRoZXJpbmcnO1xuICAgICAgICB9XG4gICAgICAgIC8vIFJUQ0ljZUNhbmRpZGF0ZSBkb2Vzbid0IGhhdmUgYSBjb21wb25lbnQsIG5lZWRzIHRvIGJlIGFkZGVkXG4gICAgICAgIGNhbmQuY29tcG9uZW50ID0gMTtcbiAgICAgICAgLy8gYWxzbyB0aGUgdXNlcm5hbWVGcmFnbWVudC4gVE9ETzogdXBkYXRlIFNEUCB0byB0YWtlIGJvdGggdmFyaWFudHMuXG4gICAgICAgIGNhbmQudWZyYWcgPSBpY2VHYXRoZXJlci5nZXRMb2NhbFBhcmFtZXRlcnMoKS51c2VybmFtZUZyYWdtZW50O1xuXG4gICAgICAgIHZhciBzZXJpYWxpemVkQ2FuZGlkYXRlID0gU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUoY2FuZCk7XG4gICAgICAgIGV2ZW50LmNhbmRpZGF0ZSA9IE9iamVjdC5hc3NpZ24oZXZlbnQuY2FuZGlkYXRlLFxuICAgICAgICAgICAgU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUoc2VyaWFsaXplZENhbmRpZGF0ZSkpO1xuXG4gICAgICAgIGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUgPSBzZXJpYWxpemVkQ2FuZGlkYXRlO1xuICAgICAgICBldmVudC5jYW5kaWRhdGUudG9KU09OID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGNhbmRpZGF0ZTogZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSxcbiAgICAgICAgICAgIHNkcE1pZDogZXZlbnQuY2FuZGlkYXRlLnNkcE1pZCxcbiAgICAgICAgICAgIHNkcE1MaW5lSW5kZXg6IGV2ZW50LmNhbmRpZGF0ZS5zZHBNTGluZUluZGV4LFxuICAgICAgICAgICAgdXNlcm5hbWVGcmFnbWVudDogZXZlbnQuY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnRcbiAgICAgICAgICB9O1xuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyB1cGRhdGUgbG9jYWwgZGVzY3JpcHRpb24uXG4gICAgICB2YXIgc2VjdGlvbnMgPSBTRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zKHBjLl9sb2NhbERlc2NyaXB0aW9uLnNkcCk7XG4gICAgICBpZiAoIWVuZCkge1xuICAgICAgICBzZWN0aW9uc1tldmVudC5jYW5kaWRhdGUuc2RwTUxpbmVJbmRleF0gKz1cbiAgICAgICAgICAgICdhPScgKyBldmVudC5jYW5kaWRhdGUuY2FuZGlkYXRlICsgJ1xcclxcbic7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWN0aW9uc1tldmVudC5jYW5kaWRhdGUuc2RwTUxpbmVJbmRleF0gKz1cbiAgICAgICAgICAgICdhPWVuZC1vZi1jYW5kaWRhdGVzXFxyXFxuJztcbiAgICAgIH1cbiAgICAgIHBjLl9sb2NhbERlc2NyaXB0aW9uLnNkcCA9XG4gICAgICAgICAgU0RQVXRpbHMuZ2V0RGVzY3JpcHRpb24ocGMuX2xvY2FsRGVzY3JpcHRpb24uc2RwKSArXG4gICAgICAgICAgc2VjdGlvbnMuam9pbignJyk7XG4gICAgICB2YXIgY29tcGxldGUgPSBwYy50cmFuc2NlaXZlcnMuZXZlcnkoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgcmV0dXJuIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlci5zdGF0ZSA9PT0gJ2NvbXBsZXRlZCc7XG4gICAgICB9KTtcblxuICAgICAgaWYgKHBjLmljZUdhdGhlcmluZ1N0YXRlICE9PSAnZ2F0aGVyaW5nJykge1xuICAgICAgICBwYy5pY2VHYXRoZXJpbmdTdGF0ZSA9ICdnYXRoZXJpbmcnO1xuICAgICAgICBwYy5fZW1pdEdhdGhlcmluZ1N0YXRlQ2hhbmdlKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEVtaXQgY2FuZGlkYXRlLiBBbHNvIGVtaXQgbnVsbCBjYW5kaWRhdGUgd2hlbiBhbGwgZ2F0aGVyZXJzIGFyZVxuICAgICAgLy8gY29tcGxldGUuXG4gICAgICBpZiAoIWVuZCkge1xuICAgICAgICBwYy5fZGlzcGF0Y2hFdmVudCgnaWNlY2FuZGlkYXRlJywgZXZlbnQpO1xuICAgICAgfVxuICAgICAgaWYgKGNvbXBsZXRlKSB7XG4gICAgICAgIHBjLl9kaXNwYXRjaEV2ZW50KCdpY2VjYW5kaWRhdGUnLCBuZXcgRXZlbnQoJ2ljZWNhbmRpZGF0ZScpKTtcbiAgICAgICAgcGMuaWNlR2F0aGVyaW5nU3RhdGUgPSAnY29tcGxldGUnO1xuICAgICAgICBwYy5fZW1pdEdhdGhlcmluZ1N0YXRlQ2hhbmdlKCk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIC8vIGVtaXQgYWxyZWFkeSBnYXRoZXJlZCBjYW5kaWRhdGVzLlxuICAgIHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgYnVmZmVyZWRDYW5kaWRhdGVFdmVudHMuZm9yRWFjaChmdW5jdGlvbihlKSB7XG4gICAgICAgIGljZUdhdGhlcmVyLm9ubG9jYWxjYW5kaWRhdGUoZSk7XG4gICAgICB9KTtcbiAgICB9LCAwKTtcbiAgfTtcblxuICAvLyBDcmVhdGUgSUNFIHRyYW5zcG9ydCBhbmQgRFRMUyB0cmFuc3BvcnQuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fY3JlYXRlSWNlQW5kRHRsc1RyYW5zcG9ydHMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIHZhciBpY2VUcmFuc3BvcnQgPSBuZXcgd2luZG93LlJUQ0ljZVRyYW5zcG9ydChudWxsKTtcbiAgICBpY2VUcmFuc3BvcnQub25pY2VzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcGMuX3VwZGF0ZUljZUNvbm5lY3Rpb25TdGF0ZSgpO1xuICAgICAgcGMuX3VwZGF0ZUNvbm5lY3Rpb25TdGF0ZSgpO1xuICAgIH07XG5cbiAgICB2YXIgZHRsc1RyYW5zcG9ydCA9IG5ldyB3aW5kb3cuUlRDRHRsc1RyYW5zcG9ydChpY2VUcmFuc3BvcnQpO1xuICAgIGR0bHNUcmFuc3BvcnQub25kdGxzc3RhdGVjaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgICAgIHBjLl91cGRhdGVDb25uZWN0aW9uU3RhdGUoKTtcbiAgICB9O1xuICAgIGR0bHNUcmFuc3BvcnQub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgLy8gb25lcnJvciBkb2VzIG5vdCBzZXQgc3RhdGUgdG8gZmFpbGVkIGJ5IGl0c2VsZi5cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShkdGxzVHJhbnNwb3J0LCAnc3RhdGUnLFxuICAgICAgICAgIHt2YWx1ZTogJ2ZhaWxlZCcsIHdyaXRhYmxlOiB0cnVlfSk7XG4gICAgICBwYy5fdXBkYXRlQ29ubmVjdGlvblN0YXRlKCk7XG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICBpY2VUcmFuc3BvcnQ6IGljZVRyYW5zcG9ydCxcbiAgICAgIGR0bHNUcmFuc3BvcnQ6IGR0bHNUcmFuc3BvcnRcbiAgICB9O1xuICB9O1xuXG4gIC8vIERlc3Ryb3kgSUNFIGdhdGhlcmVyLCBJQ0UgdHJhbnNwb3J0IGFuZCBEVExTIHRyYW5zcG9ydC5cbiAgLy8gV2l0aG91dCB0cmlnZ2VyaW5nIHRoZSBjYWxsYmFja3MuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fZGlzcG9zZUljZUFuZER0bHNUcmFuc3BvcnRzID0gZnVuY3Rpb24oXG4gICAgICBzZHBNTGluZUluZGV4KSB7XG4gICAgdmFyIGljZUdhdGhlcmVyID0gdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlR2F0aGVyZXI7XG4gICAgaWYgKGljZUdhdGhlcmVyKSB7XG4gICAgICBkZWxldGUgaWNlR2F0aGVyZXIub25sb2NhbGNhbmRpZGF0ZTtcbiAgICAgIGRlbGV0ZSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VHYXRoZXJlcjtcbiAgICB9XG4gICAgdmFyIGljZVRyYW5zcG9ydCA9IHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZVRyYW5zcG9ydDtcbiAgICBpZiAoaWNlVHJhbnNwb3J0KSB7XG4gICAgICBkZWxldGUgaWNlVHJhbnNwb3J0Lm9uaWNlc3RhdGVjaGFuZ2U7XG4gICAgICBkZWxldGUgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlVHJhbnNwb3J0O1xuICAgIH1cbiAgICB2YXIgZHRsc1RyYW5zcG9ydCA9IHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmR0bHNUcmFuc3BvcnQ7XG4gICAgaWYgKGR0bHNUcmFuc3BvcnQpIHtcbiAgICAgIGRlbGV0ZSBkdGxzVHJhbnNwb3J0Lm9uZHRsc3N0YXRlY2hhbmdlO1xuICAgICAgZGVsZXRlIGR0bHNUcmFuc3BvcnQub25lcnJvcjtcbiAgICAgIGRlbGV0ZSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5kdGxzVHJhbnNwb3J0O1xuICAgIH1cbiAgfTtcblxuICAvLyBTdGFydCB0aGUgUlRQIFNlbmRlciBhbmQgUmVjZWl2ZXIgZm9yIGEgdHJhbnNjZWl2ZXIuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fdHJhbnNjZWl2ZSA9IGZ1bmN0aW9uKHRyYW5zY2VpdmVyLFxuICAgICAgc2VuZCwgcmVjdikge1xuICAgIHZhciBwYXJhbXMgPSBnZXRDb21tb25DYXBhYmlsaXRpZXModHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXMsXG4gICAgICAgIHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcyk7XG4gICAgaWYgKHNlbmQgJiYgdHJhbnNjZWl2ZXIucnRwU2VuZGVyKSB7XG4gICAgICBwYXJhbXMuZW5jb2RpbmdzID0gdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgIHBhcmFtcy5ydGNwID0ge1xuICAgICAgICBjbmFtZTogU0RQVXRpbHMubG9jYWxDTmFtZSxcbiAgICAgICAgY29tcG91bmQ6IHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzLmNvbXBvdW5kXG4gICAgICB9O1xuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnMubGVuZ3RoKSB7XG4gICAgICAgIHBhcmFtcy5ydGNwLnNzcmMgPSB0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmM7XG4gICAgICB9XG4gICAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIuc2VuZChwYXJhbXMpO1xuICAgIH1cbiAgICBpZiAocmVjdiAmJiB0cmFuc2NlaXZlci5ydHBSZWNlaXZlciAmJiBwYXJhbXMuY29kZWNzLmxlbmd0aCA+IDApIHtcbiAgICAgIC8vIHJlbW92ZSBSVFggZmllbGQgaW4gRWRnZSAxNDk0MlxuICAgICAgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICd2aWRlbydcbiAgICAgICAgICAmJiB0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzXG4gICAgICAgICAgJiYgZWRnZVZlcnNpb24gPCAxNTAxOSkge1xuICAgICAgICB0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzLmZvckVhY2goZnVuY3Rpb24ocCkge1xuICAgICAgICAgIGRlbGV0ZSBwLnJ0eDtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGgpIHtcbiAgICAgICAgcGFyYW1zLmVuY29kaW5ncyA9IHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXMuZW5jb2RpbmdzID0gW3t9XTtcbiAgICAgIH1cbiAgICAgIHBhcmFtcy5ydGNwID0ge1xuICAgICAgICBjb21wb3VuZDogdHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMuY29tcG91bmRcbiAgICAgIH07XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMuY25hbWUpIHtcbiAgICAgICAgcGFyYW1zLnJ0Y3AuY25hbWUgPSB0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycy5jbmFtZTtcbiAgICAgIH1cbiAgICAgIGlmICh0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCkge1xuICAgICAgICBwYXJhbXMucnRjcC5zc3JjID0gdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjO1xuICAgICAgfVxuICAgICAgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIucmVjZWl2ZShwYXJhbXMpO1xuICAgIH1cbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0TG9jYWxEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgdmFyIHBjID0gdGhpcztcblxuICAgIC8vIE5vdGU6IHByYW5zd2VyIGlzIG5vdCBzdXBwb3J0ZWQuXG4gICAgaWYgKFsnb2ZmZXInLCAnYW5zd2VyJ10uaW5kZXhPZihkZXNjcmlwdGlvbi50eXBlKSA9PT0gLTEpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ1R5cGVFcnJvcicsXG4gICAgICAgICAgJ1Vuc3VwcG9ydGVkIHR5cGUgXCInICsgZGVzY3JpcHRpb24udHlwZSArICdcIicpKTtcbiAgICB9XG5cbiAgICBpZiAoIWlzQWN0aW9uQWxsb3dlZEluU2lnbmFsaW5nU3RhdGUoJ3NldExvY2FsRGVzY3JpcHRpb24nLFxuICAgICAgICBkZXNjcmlwdGlvbi50eXBlLCBwYy5zaWduYWxpbmdTdGF0ZSkgfHwgcGMuX2lzQ2xvc2VkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0NhbiBub3Qgc2V0IGxvY2FsICcgKyBkZXNjcmlwdGlvbi50eXBlICtcbiAgICAgICAgICAnIGluIHN0YXRlICcgKyBwYy5zaWduYWxpbmdTdGF0ZSkpO1xuICAgIH1cblxuICAgIHZhciBzZWN0aW9ucztcbiAgICB2YXIgc2Vzc2lvbnBhcnQ7XG4gICAgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdvZmZlcicpIHtcbiAgICAgIC8vIFZFUlkgbGltaXRlZCBzdXBwb3J0IGZvciBTRFAgbXVuZ2luZy4gTGltaXRlZCB0bzpcbiAgICAgIC8vICogY2hhbmdpbmcgdGhlIG9yZGVyIG9mIGNvZGVjc1xuICAgICAgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGRlc2NyaXB0aW9uLnNkcCk7XG4gICAgICBzZXNzaW9ucGFydCA9IHNlY3Rpb25zLnNoaWZ0KCk7XG4gICAgICBzZWN0aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgICB2YXIgY2FwcyA9IFNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ubG9jYWxDYXBhYmlsaXRpZXMgPSBjYXBzO1xuICAgICAgfSk7XG5cbiAgICAgIHBjLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICAgIHBjLl9nYXRoZXIodHJhbnNjZWl2ZXIubWlkLCBzZHBNTGluZUluZGV4KTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJ2Fuc3dlcicpIHtcbiAgICAgIHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwKTtcbiAgICAgIHNlc3Npb25wYXJ0ID0gc2VjdGlvbnMuc2hpZnQoKTtcbiAgICAgIHZhciBpc0ljZUxpdGUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChzZXNzaW9ucGFydCxcbiAgICAgICAgICAnYT1pY2UtbGl0ZScpLmxlbmd0aCA+IDA7XG4gICAgICBzZWN0aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgICB2YXIgdHJhbnNjZWl2ZXIgPSBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF07XG4gICAgICAgIHZhciBpY2VHYXRoZXJlciA9IHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyO1xuICAgICAgICB2YXIgaWNlVHJhbnNwb3J0ID0gdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0O1xuICAgICAgICB2YXIgZHRsc1RyYW5zcG9ydCA9IHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQ7XG4gICAgICAgIHZhciBsb2NhbENhcGFiaWxpdGllcyA9IHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzO1xuICAgICAgICB2YXIgcmVtb3RlQ2FwYWJpbGl0aWVzID0gdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzO1xuXG4gICAgICAgIC8vIHRyZWF0IGJ1bmRsZS1vbmx5IGFzIG5vdC1yZWplY3RlZC5cbiAgICAgICAgdmFyIHJlamVjdGVkID0gU0RQVXRpbHMuaXNSZWplY3RlZChtZWRpYVNlY3Rpb24pICYmXG4gICAgICAgICAgICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWJ1bmRsZS1vbmx5JykubGVuZ3RoID09PSAwO1xuXG4gICAgICAgIGlmICghcmVqZWN0ZWQgJiYgIXRyYW5zY2VpdmVyLnJlamVjdGVkKSB7XG4gICAgICAgICAgdmFyIHJlbW90ZUljZVBhcmFtZXRlcnMgPSBTRFBVdGlscy5nZXRJY2VQYXJhbWV0ZXJzKFxuICAgICAgICAgICAgICBtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KTtcbiAgICAgICAgICB2YXIgcmVtb3RlRHRsc1BhcmFtZXRlcnMgPSBTRFBVdGlscy5nZXREdGxzUGFyYW1ldGVycyhcbiAgICAgICAgICAgICAgbWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCk7XG4gICAgICAgICAgaWYgKGlzSWNlTGl0ZSkge1xuICAgICAgICAgICAgcmVtb3RlRHRsc1BhcmFtZXRlcnMucm9sZSA9ICdzZXJ2ZXInO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICghcGMudXNpbmdCdW5kbGUgfHwgc2RwTUxpbmVJbmRleCA9PT0gMCkge1xuICAgICAgICAgICAgcGMuX2dhdGhlcih0cmFuc2NlaXZlci5taWQsIHNkcE1MaW5lSW5kZXgpO1xuICAgICAgICAgICAgaWYgKGljZVRyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICAgICAgaWNlVHJhbnNwb3J0LnN0YXJ0KGljZUdhdGhlcmVyLCByZW1vdGVJY2VQYXJhbWV0ZXJzLFxuICAgICAgICAgICAgICAgICAgaXNJY2VMaXRlID8gJ2NvbnRyb2xsaW5nJyA6ICdjb250cm9sbGVkJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZHRsc1RyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICAgICAgZHRsc1RyYW5zcG9ydC5zdGFydChyZW1vdGVEdGxzUGFyYW1ldGVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQ2FsY3VsYXRlIGludGVyc2VjdGlvbiBvZiBjYXBhYmlsaXRpZXMuXG4gICAgICAgICAgdmFyIHBhcmFtcyA9IGdldENvbW1vbkNhcGFiaWxpdGllcyhsb2NhbENhcGFiaWxpdGllcyxcbiAgICAgICAgICAgICAgcmVtb3RlQ2FwYWJpbGl0aWVzKTtcblxuICAgICAgICAgIC8vIFN0YXJ0IHRoZSBSVENSdHBTZW5kZXIuIFRoZSBSVENSdHBSZWNlaXZlciBmb3IgdGhpc1xuICAgICAgICAgIC8vIHRyYW5zY2VpdmVyIGhhcyBhbHJlYWR5IGJlZW4gc3RhcnRlZCBpbiBzZXRSZW1vdGVEZXNjcmlwdGlvbi5cbiAgICAgICAgICBwYy5fdHJhbnNjZWl2ZSh0cmFuc2NlaXZlcixcbiAgICAgICAgICAgICAgcGFyYW1zLmNvZGVjcy5sZW5ndGggPiAwLFxuICAgICAgICAgICAgICBmYWxzZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHBjLl9sb2NhbERlc2NyaXB0aW9uID0ge1xuICAgICAgdHlwZTogZGVzY3JpcHRpb24udHlwZSxcbiAgICAgIHNkcDogZGVzY3JpcHRpb24uc2RwXG4gICAgfTtcbiAgICBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJ29mZmVyJykge1xuICAgICAgcGMuX3VwZGF0ZVNpZ25hbGluZ1N0YXRlKCdoYXZlLWxvY2FsLW9mZmVyJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBjLl91cGRhdGVTaWduYWxpbmdTdGF0ZSgnc3RhYmxlJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgdmFyIHBjID0gdGhpcztcblxuICAgIC8vIE5vdGU6IHByYW5zd2VyIGlzIG5vdCBzdXBwb3J0ZWQuXG4gICAgaWYgKFsnb2ZmZXInLCAnYW5zd2VyJ10uaW5kZXhPZihkZXNjcmlwdGlvbi50eXBlKSA9PT0gLTEpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ1R5cGVFcnJvcicsXG4gICAgICAgICAgJ1Vuc3VwcG9ydGVkIHR5cGUgXCInICsgZGVzY3JpcHRpb24udHlwZSArICdcIicpKTtcbiAgICB9XG5cbiAgICBpZiAoIWlzQWN0aW9uQWxsb3dlZEluU2lnbmFsaW5nU3RhdGUoJ3NldFJlbW90ZURlc2NyaXB0aW9uJyxcbiAgICAgICAgZGVzY3JpcHRpb24udHlwZSwgcGMuc2lnbmFsaW5nU3RhdGUpIHx8IHBjLl9pc0Nsb3NlZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdDYW4gbm90IHNldCByZW1vdGUgJyArIGRlc2NyaXB0aW9uLnR5cGUgK1xuICAgICAgICAgICcgaW4gc3RhdGUgJyArIHBjLnNpZ25hbGluZ1N0YXRlKSk7XG4gICAgfVxuXG4gICAgdmFyIHN0cmVhbXMgPSB7fTtcbiAgICBwYy5yZW1vdGVTdHJlYW1zLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICBzdHJlYW1zW3N0cmVhbS5pZF0gPSBzdHJlYW07XG4gICAgfSk7XG4gICAgdmFyIHJlY2VpdmVyTGlzdCA9IFtdO1xuICAgIHZhciBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoZGVzY3JpcHRpb24uc2RwKTtcbiAgICB2YXIgc2Vzc2lvbnBhcnQgPSBzZWN0aW9ucy5zaGlmdCgpO1xuICAgIHZhciBpc0ljZUxpdGUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChzZXNzaW9ucGFydCxcbiAgICAgICAgJ2E9aWNlLWxpdGUnKS5sZW5ndGggPiAwO1xuICAgIHZhciB1c2luZ0J1bmRsZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KHNlc3Npb25wYXJ0LFxuICAgICAgICAnYT1ncm91cDpCVU5ETEUgJykubGVuZ3RoID4gMDtcbiAgICBwYy51c2luZ0J1bmRsZSA9IHVzaW5nQnVuZGxlO1xuICAgIHZhciBpY2VPcHRpb25zID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoc2Vzc2lvbnBhcnQsXG4gICAgICAgICdhPWljZS1vcHRpb25zOicpWzBdO1xuICAgIGlmIChpY2VPcHRpb25zKSB7XG4gICAgICBwYy5jYW5Ucmlja2xlSWNlQ2FuZGlkYXRlcyA9IGljZU9wdGlvbnMuc3Vic3RyKDE0KS5zcGxpdCgnICcpXG4gICAgICAgICAgLmluZGV4T2YoJ3RyaWNrbGUnKSA+PSAwO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYy5jYW5Ucmlja2xlSWNlQ2FuZGlkYXRlcyA9IGZhbHNlO1xuICAgIH1cblxuICAgIHNlY3Rpb25zLmZvckVhY2goZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICB2YXIgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gICAgICB2YXIga2luZCA9IFNEUFV0aWxzLmdldEtpbmQobWVkaWFTZWN0aW9uKTtcbiAgICAgIC8vIHRyZWF0IGJ1bmRsZS1vbmx5IGFzIG5vdC1yZWplY3RlZC5cbiAgICAgIHZhciByZWplY3RlZCA9IFNEUFV0aWxzLmlzUmVqZWN0ZWQobWVkaWFTZWN0aW9uKSAmJlxuICAgICAgICAgIFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9YnVuZGxlLW9ubHknKS5sZW5ndGggPT09IDA7XG4gICAgICB2YXIgcHJvdG9jb2wgPSBsaW5lc1swXS5zdWJzdHIoMikuc3BsaXQoJyAnKVsyXTtcblxuICAgICAgdmFyIGRpcmVjdGlvbiA9IFNEUFV0aWxzLmdldERpcmVjdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KTtcbiAgICAgIHZhciByZW1vdGVNc2lkID0gU0RQVXRpbHMucGFyc2VNc2lkKG1lZGlhU2VjdGlvbik7XG5cbiAgICAgIHZhciBtaWQgPSBTRFBVdGlscy5nZXRNaWQobWVkaWFTZWN0aW9uKSB8fCBTRFBVdGlscy5nZW5lcmF0ZUlkZW50aWZpZXIoKTtcblxuICAgICAgLy8gUmVqZWN0IGRhdGFjaGFubmVscyB3aGljaCBhcmUgbm90IGltcGxlbWVudGVkIHlldC5cbiAgICAgIGlmICgoa2luZCA9PT0gJ2FwcGxpY2F0aW9uJyAmJiBwcm90b2NvbCA9PT0gJ0RUTFMvU0NUUCcpIHx8IHJlamVjdGVkKSB7XG4gICAgICAgIC8vIFRPRE86IHRoaXMgaXMgZGFuZ2Vyb3VzIGluIHRoZSBjYXNlIHdoZXJlIGEgbm9uLXJlamVjdGVkIG0tbGluZVxuICAgICAgICAvLyAgICAgYmVjb21lcyByZWplY3RlZC5cbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdID0ge1xuICAgICAgICAgIG1pZDogbWlkLFxuICAgICAgICAgIGtpbmQ6IGtpbmQsXG4gICAgICAgICAgcmVqZWN0ZWQ6IHRydWVcbiAgICAgICAgfTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXJlamVjdGVkICYmIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XSAmJlxuICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5yZWplY3RlZCkge1xuICAgICAgICAvLyByZWN5Y2xlIGEgcmVqZWN0ZWQgdHJhbnNjZWl2ZXIuXG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XSA9IHBjLl9jcmVhdGVUcmFuc2NlaXZlcihraW5kLCB0cnVlKTtcbiAgICAgIH1cblxuICAgICAgdmFyIHRyYW5zY2VpdmVyO1xuICAgICAgdmFyIGljZUdhdGhlcmVyO1xuICAgICAgdmFyIGljZVRyYW5zcG9ydDtcbiAgICAgIHZhciBkdGxzVHJhbnNwb3J0O1xuICAgICAgdmFyIHJ0cFJlY2VpdmVyO1xuICAgICAgdmFyIHNlbmRFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICB2YXIgcmVjdkVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgIHZhciBsb2NhbENhcGFiaWxpdGllcztcblxuICAgICAgdmFyIHRyYWNrO1xuICAgICAgLy8gRklYTUU6IGVuc3VyZSB0aGUgbWVkaWFTZWN0aW9uIGhhcyBydGNwLW11eCBzZXQuXG4gICAgICB2YXIgcmVtb3RlQ2FwYWJpbGl0aWVzID0gU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG4gICAgICB2YXIgcmVtb3RlSWNlUGFyYW1ldGVycztcbiAgICAgIHZhciByZW1vdGVEdGxzUGFyYW1ldGVycztcbiAgICAgIGlmICghcmVqZWN0ZWQpIHtcbiAgICAgICAgcmVtb3RlSWNlUGFyYW1ldGVycyA9IFNEUFV0aWxzLmdldEljZVBhcmFtZXRlcnMobWVkaWFTZWN0aW9uLFxuICAgICAgICAgICAgc2Vzc2lvbnBhcnQpO1xuICAgICAgICByZW1vdGVEdGxzUGFyYW1ldGVycyA9IFNEUFV0aWxzLmdldER0bHNQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbixcbiAgICAgICAgICAgIHNlc3Npb25wYXJ0KTtcbiAgICAgICAgcmVtb3RlRHRsc1BhcmFtZXRlcnMucm9sZSA9ICdjbGllbnQnO1xuICAgICAgfVxuICAgICAgcmVjdkVuY29kaW5nUGFyYW1ldGVycyA9XG4gICAgICAgICAgU0RQVXRpbHMucGFyc2VSdHBFbmNvZGluZ1BhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcblxuICAgICAgdmFyIHJ0Y3BQYXJhbWV0ZXJzID0gU0RQVXRpbHMucGFyc2VSdGNwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuXG4gICAgICB2YXIgaXNDb21wbGV0ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbixcbiAgICAgICAgICAnYT1lbmQtb2YtY2FuZGlkYXRlcycsIHNlc3Npb25wYXJ0KS5sZW5ndGggPiAwO1xuICAgICAgdmFyIGNhbmRzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1jYW5kaWRhdGU6JylcbiAgICAgICAgICAubWFwKGZ1bmN0aW9uKGNhbmQpIHtcbiAgICAgICAgICAgIHJldHVybiBTRFBVdGlscy5wYXJzZUNhbmRpZGF0ZShjYW5kKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5maWx0ZXIoZnVuY3Rpb24oY2FuZCkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbmQuY29tcG9uZW50ID09PSAxO1xuICAgICAgICAgIH0pO1xuXG4gICAgICAvLyBDaGVjayBpZiB3ZSBjYW4gdXNlIEJVTkRMRSBhbmQgZGlzcG9zZSB0cmFuc3BvcnRzLlxuICAgICAgaWYgKChkZXNjcmlwdGlvbi50eXBlID09PSAnb2ZmZXInIHx8IGRlc2NyaXB0aW9uLnR5cGUgPT09ICdhbnN3ZXInKSAmJlxuICAgICAgICAgICFyZWplY3RlZCAmJiB1c2luZ0J1bmRsZSAmJiBzZHBNTGluZUluZGV4ID4gMCAmJlxuICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XSkge1xuICAgICAgICBwYy5fZGlzcG9zZUljZUFuZER0bHNUcmFuc3BvcnRzKHNkcE1MaW5lSW5kZXgpO1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlR2F0aGVyZXIgPVxuICAgICAgICAgICAgcGMudHJhbnNjZWl2ZXJzWzBdLmljZUdhdGhlcmVyO1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlVHJhbnNwb3J0ID1cbiAgICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1swXS5pY2VUcmFuc3BvcnQ7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5kdGxzVHJhbnNwb3J0ID1cbiAgICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1swXS5kdGxzVHJhbnNwb3J0O1xuICAgICAgICBpZiAocGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJ0cFNlbmRlcikge1xuICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5ydHBTZW5kZXIuc2V0VHJhbnNwb3J0KFxuICAgICAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbMF0uZHRsc1RyYW5zcG9ydCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5ydHBSZWNlaXZlcikge1xuICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5ydHBSZWNlaXZlci5zZXRUcmFuc3BvcnQoXG4gICAgICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1swXS5kdGxzVHJhbnNwb3J0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdvZmZlcicgJiYgIXJlamVjdGVkKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyID0gcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdIHx8XG4gICAgICAgICAgICBwYy5fY3JlYXRlVHJhbnNjZWl2ZXIoa2luZCk7XG4gICAgICAgIHRyYW5zY2VpdmVyLm1pZCA9IG1pZDtcblxuICAgICAgICBpZiAoIXRyYW5zY2VpdmVyLmljZUdhdGhlcmVyKSB7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIgPSBwYy5fY3JlYXRlSWNlR2F0aGVyZXIoc2RwTUxpbmVJbmRleCxcbiAgICAgICAgICAgICAgdXNpbmdCdW5kbGUpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNhbmRzLmxlbmd0aCAmJiB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgaWYgKGlzQ29tcGxldGUgJiYgKCF1c2luZ0J1bmRsZSB8fCBzZHBNTGluZUluZGV4ID09PSAwKSkge1xuICAgICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LnNldFJlbW90ZUNhbmRpZGF0ZXMoY2FuZHMpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYW5kcy5mb3JFYWNoKGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICAgICAgICAgICAgICBtYXliZUFkZENhbmRpZGF0ZSh0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQsIGNhbmRpZGF0ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBsb2NhbENhcGFiaWxpdGllcyA9IHdpbmRvdy5SVENSdHBSZWNlaXZlci5nZXRDYXBhYmlsaXRpZXMoa2luZCk7XG5cbiAgICAgICAgLy8gZmlsdGVyIFJUWCB1bnRpbCBhZGRpdGlvbmFsIHN0dWZmIG5lZWRlZCBmb3IgUlRYIGlzIGltcGxlbWVudGVkXG4gICAgICAgIC8vIGluIGFkYXB0ZXIuanNcbiAgICAgICAgaWYgKGVkZ2VWZXJzaW9uIDwgMTUwMTkpIHtcbiAgICAgICAgICBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MgPSBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MuZmlsdGVyKFxuICAgICAgICAgICAgICBmdW5jdGlvbihjb2RlYykge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb2RlYy5uYW1lICE9PSAncnR4JztcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzID0gdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycyB8fCBbe1xuICAgICAgICAgIHNzcmM6ICgyICogc2RwTUxpbmVJbmRleCArIDIpICogMTAwMVxuICAgICAgICB9XTtcblxuICAgICAgICAvLyBUT0RPOiByZXdyaXRlIHRvIHVzZSBodHRwOi8vdzNjLmdpdGh1Yi5pby93ZWJydGMtcGMvI3NldC1hc3NvY2lhdGVkLXJlbW90ZS1zdHJlYW1zXG4gICAgICAgIHZhciBpc05ld1RyYWNrID0gZmFsc2U7XG4gICAgICAgIGlmIChkaXJlY3Rpb24gPT09ICdzZW5kcmVjdicgfHwgZGlyZWN0aW9uID09PSAnc2VuZG9ubHknKSB7XG4gICAgICAgICAgaXNOZXdUcmFjayA9ICF0cmFuc2NlaXZlci5ydHBSZWNlaXZlcjtcbiAgICAgICAgICBydHBSZWNlaXZlciA9IHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyIHx8XG4gICAgICAgICAgICAgIG5ldyB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIodHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydCwga2luZCk7XG5cbiAgICAgICAgICBpZiAoaXNOZXdUcmFjaykge1xuICAgICAgICAgICAgdmFyIHN0cmVhbTtcbiAgICAgICAgICAgIHRyYWNrID0gcnRwUmVjZWl2ZXIudHJhY2s7XG4gICAgICAgICAgICAvLyBGSVhNRTogZG9lcyBub3Qgd29yayB3aXRoIFBsYW4gQi5cbiAgICAgICAgICAgIGlmIChyZW1vdGVNc2lkICYmIHJlbW90ZU1zaWQuc3RyZWFtID09PSAnLScpIHtcbiAgICAgICAgICAgICAgLy8gbm8tb3AuIGEgc3RyZWFtIGlkIG9mICctJyBtZWFuczogbm8gYXNzb2NpYXRlZCBzdHJlYW0uXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJlbW90ZU1zaWQpIHtcbiAgICAgICAgICAgICAgaWYgKCFzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXSkge1xuICAgICAgICAgICAgICAgIHN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dID0gbmV3IHdpbmRvdy5NZWRpYVN0cmVhbSgpO1xuICAgICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXSwgJ2lkJywge1xuICAgICAgICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJlbW90ZU1zaWQuc3RyZWFtO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0cmFjaywgJ2lkJywge1xuICAgICAgICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gcmVtb3RlTXNpZC50cmFjaztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICBzdHJlYW0gPSBzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGlmICghc3RyZWFtcy5kZWZhdWx0KSB7XG4gICAgICAgICAgICAgICAgc3RyZWFtcy5kZWZhdWx0ID0gbmV3IHdpbmRvdy5NZWRpYVN0cmVhbSgpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHN0cmVhbSA9IHN0cmVhbXMuZGVmYXVsdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChzdHJlYW0pIHtcbiAgICAgICAgICAgICAgYWRkVHJhY2tUb1N0cmVhbUFuZEZpcmVFdmVudCh0cmFjaywgc3RyZWFtKTtcbiAgICAgICAgICAgICAgdHJhbnNjZWl2ZXIuYXNzb2NpYXRlZFJlbW90ZU1lZGlhU3RyZWFtcy5wdXNoKHN0cmVhbSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZWNlaXZlckxpc3QucHVzaChbdHJhY2ssIHJ0cFJlY2VpdmVyLCBzdHJlYW1dKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIgJiYgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIudHJhY2spIHtcbiAgICAgICAgICB0cmFuc2NlaXZlci5hc3NvY2lhdGVkUmVtb3RlTWVkaWFTdHJlYW1zLmZvckVhY2goZnVuY3Rpb24ocykge1xuICAgICAgICAgICAgdmFyIG5hdGl2ZVRyYWNrID0gcy5nZXRUcmFja3MoKS5maW5kKGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHQuaWQgPT09IHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyLnRyYWNrLmlkO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAobmF0aXZlVHJhY2spIHtcbiAgICAgICAgICAgICAgcmVtb3ZlVHJhY2tGcm9tU3RyZWFtQW5kRmlyZUV2ZW50KG5hdGl2ZVRyYWNrLCBzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICB0cmFuc2NlaXZlci5hc3NvY2lhdGVkUmVtb3RlTWVkaWFTdHJlYW1zID0gW107XG4gICAgICAgIH1cblxuICAgICAgICB0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcyA9IGxvY2FsQ2FwYWJpbGl0aWVzO1xuICAgICAgICB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMgPSByZW1vdGVDYXBhYmlsaXRpZXM7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyID0gcnRwUmVjZWl2ZXI7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzID0gcnRjcFBhcmFtZXRlcnM7XG4gICAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgPSBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgICB0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzID0gcmVjdkVuY29kaW5nUGFyYW1ldGVycztcblxuICAgICAgICAvLyBTdGFydCB0aGUgUlRDUnRwUmVjZWl2ZXIgbm93LiBUaGUgUlRQU2VuZGVyIGlzIHN0YXJ0ZWQgaW5cbiAgICAgICAgLy8gc2V0TG9jYWxEZXNjcmlwdGlvbi5cbiAgICAgICAgcGMuX3RyYW5zY2VpdmUocGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLFxuICAgICAgICAgICAgZmFsc2UsXG4gICAgICAgICAgICBpc05ld1RyYWNrKTtcbiAgICAgIH0gZWxzZSBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJ2Fuc3dlcicgJiYgIXJlamVjdGVkKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyID0gcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdO1xuICAgICAgICBpY2VHYXRoZXJlciA9IHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyO1xuICAgICAgICBpY2VUcmFuc3BvcnQgPSB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQ7XG4gICAgICAgIGR0bHNUcmFuc3BvcnQgPSB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0O1xuICAgICAgICBydHBSZWNlaXZlciA9IHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyO1xuICAgICAgICBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzID0gdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgICAgbG9jYWxDYXBhYmlsaXRpZXMgPSB0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcztcblxuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucmVjdkVuY29kaW5nUGFyYW1ldGVycyA9XG4gICAgICAgICAgICByZWN2RW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucmVtb3RlQ2FwYWJpbGl0aWVzID1cbiAgICAgICAgICAgIHJlbW90ZUNhcGFiaWxpdGllcztcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJ0Y3BQYXJhbWV0ZXJzID0gcnRjcFBhcmFtZXRlcnM7XG5cbiAgICAgICAgaWYgKGNhbmRzLmxlbmd0aCAmJiBpY2VUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgaWYgKChpc0ljZUxpdGUgfHwgaXNDb21wbGV0ZSkgJiZcbiAgICAgICAgICAgICAgKCF1c2luZ0J1bmRsZSB8fCBzZHBNTGluZUluZGV4ID09PSAwKSkge1xuICAgICAgICAgICAgaWNlVHJhbnNwb3J0LnNldFJlbW90ZUNhbmRpZGF0ZXMoY2FuZHMpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYW5kcy5mb3JFYWNoKGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICAgICAgICAgICAgICBtYXliZUFkZENhbmRpZGF0ZSh0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQsIGNhbmRpZGF0ZSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXVzaW5nQnVuZGxlIHx8IHNkcE1MaW5lSW5kZXggPT09IDApIHtcbiAgICAgICAgICBpZiAoaWNlVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgICAgaWNlVHJhbnNwb3J0LnN0YXJ0KGljZUdhdGhlcmVyLCByZW1vdGVJY2VQYXJhbWV0ZXJzLFxuICAgICAgICAgICAgICAgICdjb250cm9sbGluZycpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZHRsc1RyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICAgIGR0bHNUcmFuc3BvcnQuc3RhcnQocmVtb3RlRHRsc1BhcmFtZXRlcnMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHBjLl90cmFuc2NlaXZlKHRyYW5zY2VpdmVyLFxuICAgICAgICAgICAgZGlyZWN0aW9uID09PSAnc2VuZHJlY3YnIHx8IGRpcmVjdGlvbiA9PT0gJ3JlY3Zvbmx5JyxcbiAgICAgICAgICAgIGRpcmVjdGlvbiA9PT0gJ3NlbmRyZWN2JyB8fCBkaXJlY3Rpb24gPT09ICdzZW5kb25seScpO1xuXG4gICAgICAgIC8vIFRPRE86IHJld3JpdGUgdG8gdXNlIGh0dHA6Ly93M2MuZ2l0aHViLmlvL3dlYnJ0Yy1wYy8jc2V0LWFzc29jaWF0ZWQtcmVtb3RlLXN0cmVhbXNcbiAgICAgICAgaWYgKHJ0cFJlY2VpdmVyICYmXG4gICAgICAgICAgICAoZGlyZWN0aW9uID09PSAnc2VuZHJlY3YnIHx8IGRpcmVjdGlvbiA9PT0gJ3NlbmRvbmx5JykpIHtcbiAgICAgICAgICB0cmFjayA9IHJ0cFJlY2VpdmVyLnRyYWNrO1xuICAgICAgICAgIGlmIChyZW1vdGVNc2lkKSB7XG4gICAgICAgICAgICBpZiAoIXN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dKSB7XG4gICAgICAgICAgICAgIHN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dID0gbmV3IHdpbmRvdy5NZWRpYVN0cmVhbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYWRkVHJhY2tUb1N0cmVhbUFuZEZpcmVFdmVudCh0cmFjaywgc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV0pO1xuICAgICAgICAgICAgcmVjZWl2ZXJMaXN0LnB1c2goW3RyYWNrLCBydHBSZWNlaXZlciwgc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV1dKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKCFzdHJlYW1zLmRlZmF1bHQpIHtcbiAgICAgICAgICAgICAgc3RyZWFtcy5kZWZhdWx0ID0gbmV3IHdpbmRvdy5NZWRpYVN0cmVhbSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYWRkVHJhY2tUb1N0cmVhbUFuZEZpcmVFdmVudCh0cmFjaywgc3RyZWFtcy5kZWZhdWx0KTtcbiAgICAgICAgICAgIHJlY2VpdmVyTGlzdC5wdXNoKFt0cmFjaywgcnRwUmVjZWl2ZXIsIHN0cmVhbXMuZGVmYXVsdF0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBGSVhNRTogYWN0dWFsbHkgdGhlIHJlY2VpdmVyIHNob3VsZCBiZSBjcmVhdGVkIGxhdGVyLlxuICAgICAgICAgIGRlbGV0ZSB0cmFuc2NlaXZlci5ydHBSZWNlaXZlcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKHBjLl9kdGxzUm9sZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYy5fZHRsc1JvbGUgPSBkZXNjcmlwdGlvbi50eXBlID09PSAnb2ZmZXInID8gJ2FjdGl2ZScgOiAncGFzc2l2ZSc7XG4gICAgfVxuXG4gICAgcGMuX3JlbW90ZURlc2NyaXB0aW9uID0ge1xuICAgICAgdHlwZTogZGVzY3JpcHRpb24udHlwZSxcbiAgICAgIHNkcDogZGVzY3JpcHRpb24uc2RwXG4gICAgfTtcbiAgICBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJ29mZmVyJykge1xuICAgICAgcGMuX3VwZGF0ZVNpZ25hbGluZ1N0YXRlKCdoYXZlLXJlbW90ZS1vZmZlcicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwYy5fdXBkYXRlU2lnbmFsaW5nU3RhdGUoJ3N0YWJsZScpO1xuICAgIH1cbiAgICBPYmplY3Qua2V5cyhzdHJlYW1zKS5mb3JFYWNoKGZ1bmN0aW9uKHNpZCkge1xuICAgICAgdmFyIHN0cmVhbSA9IHN0cmVhbXNbc2lkXTtcbiAgICAgIGlmIChzdHJlYW0uZ2V0VHJhY2tzKCkubGVuZ3RoKSB7XG4gICAgICAgIGlmIChwYy5yZW1vdGVTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA9PT0gLTEpIHtcbiAgICAgICAgICBwYy5yZW1vdGVTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICAgICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ2FkZHN0cmVhbScpO1xuICAgICAgICAgIGV2ZW50LnN0cmVhbSA9IHN0cmVhbTtcbiAgICAgICAgICB3aW5kb3cuc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHBjLl9kaXNwYXRjaEV2ZW50KCdhZGRzdHJlYW0nLCBldmVudCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICByZWNlaXZlckxpc3QuZm9yRWFjaChmdW5jdGlvbihpdGVtKSB7XG4gICAgICAgICAgdmFyIHRyYWNrID0gaXRlbVswXTtcbiAgICAgICAgICB2YXIgcmVjZWl2ZXIgPSBpdGVtWzFdO1xuICAgICAgICAgIGlmIChzdHJlYW0uaWQgIT09IGl0ZW1bMl0uaWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgZmlyZUFkZFRyYWNrKHBjLCB0cmFjaywgcmVjZWl2ZXIsIFtzdHJlYW1dKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmVjZWl2ZXJMaXN0LmZvckVhY2goZnVuY3Rpb24oaXRlbSkge1xuICAgICAgaWYgKGl0ZW1bMl0pIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgZmlyZUFkZFRyYWNrKHBjLCBpdGVtWzBdLCBpdGVtWzFdLCBbXSk7XG4gICAgfSk7XG5cbiAgICAvLyBjaGVjayB3aGV0aGVyIGFkZEljZUNhbmRpZGF0ZSh7fSkgd2FzIGNhbGxlZCB3aXRoaW4gZm91ciBzZWNvbmRzIGFmdGVyXG4gICAgLy8gc2V0UmVtb3RlRGVzY3JpcHRpb24uXG4gICAgd2luZG93LnNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIShwYyAmJiBwYy50cmFuc2NlaXZlcnMpKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHBjLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICAgIGlmICh0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5nZXRSZW1vdGVDYW5kaWRhdGVzKCkubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvbnNvbGUud2FybignVGltZW91dCBmb3IgYWRkUmVtb3RlQ2FuZGlkYXRlLiBDb25zaWRlciBzZW5kaW5nICcgK1xuICAgICAgICAgICAgICAnYW4gZW5kLW9mLWNhbmRpZGF0ZXMgbm90aWZpY2F0aW9uJyk7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LmFkZFJlbW90ZUNhbmRpZGF0ZSh7fSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0sIDQwMDApO1xuXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jbG9zZSA9IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIC8qIG5vdCB5ZXRcbiAgICAgIGlmICh0cmFuc2NlaXZlci5pY2VHYXRoZXJlcikge1xuICAgICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlci5jbG9zZSgpO1xuICAgICAgfVxuICAgICAgKi9cbiAgICAgIGlmICh0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LnN0b3AoKTtcbiAgICAgIH1cbiAgICAgIGlmICh0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0KSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQuc3RvcCgpO1xuICAgICAgfVxuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlcikge1xuICAgICAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIuc3RvcCgpO1xuICAgICAgfVxuICAgICAgaWYgKHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyLnN0b3AoKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICAvLyBGSVhNRTogY2xlYW4gdXAgdHJhY2tzLCBsb2NhbCBzdHJlYW1zLCByZW1vdGUgc3RyZWFtcywgZXRjXG4gICAgdGhpcy5faXNDbG9zZWQgPSB0cnVlO1xuICAgIHRoaXMuX3VwZGF0ZVNpZ25hbGluZ1N0YXRlKCdjbG9zZWQnKTtcbiAgfTtcblxuICAvLyBVcGRhdGUgdGhlIHNpZ25hbGluZyBzdGF0ZS5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl91cGRhdGVTaWduYWxpbmdTdGF0ZSA9IGZ1bmN0aW9uKG5ld1N0YXRlKSB7XG4gICAgdGhpcy5zaWduYWxpbmdTdGF0ZSA9IG5ld1N0YXRlO1xuICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnc2lnbmFsaW5nc3RhdGVjaGFuZ2UnKTtcbiAgICB0aGlzLl9kaXNwYXRjaEV2ZW50KCdzaWduYWxpbmdzdGF0ZWNoYW5nZScsIGV2ZW50KTtcbiAgfTtcblxuICAvLyBEZXRlcm1pbmUgd2hldGhlciB0byBmaXJlIHRoZSBuZWdvdGlhdGlvbm5lZWRlZCBldmVudC5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9tYXliZUZpcmVOZWdvdGlhdGlvbk5lZWRlZCA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgaWYgKHRoaXMuc2lnbmFsaW5nU3RhdGUgIT09ICdzdGFibGUnIHx8IHRoaXMubmVlZE5lZ290aWF0aW9uID09PSB0cnVlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMubmVlZE5lZ290aWF0aW9uID0gdHJ1ZTtcbiAgICB3aW5kb3cuc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIGlmIChwYy5uZWVkTmVnb3RpYXRpb24pIHtcbiAgICAgICAgcGMubmVlZE5lZ290aWF0aW9uID0gZmFsc2U7XG4gICAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnbmVnb3RpYXRpb25uZWVkZWQnKTtcbiAgICAgICAgcGMuX2Rpc3BhdGNoRXZlbnQoJ25lZ290aWF0aW9ubmVlZGVkJywgZXZlbnQpO1xuICAgICAgfVxuICAgIH0sIDApO1xuICB9O1xuXG4gIC8vIFVwZGF0ZSB0aGUgaWNlIGNvbm5lY3Rpb24gc3RhdGUuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fdXBkYXRlSWNlQ29ubmVjdGlvblN0YXRlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5ld1N0YXRlO1xuICAgIHZhciBzdGF0ZXMgPSB7XG4gICAgICAnbmV3JzogMCxcbiAgICAgIGNsb3NlZDogMCxcbiAgICAgIGNoZWNraW5nOiAwLFxuICAgICAgY29ubmVjdGVkOiAwLFxuICAgICAgY29tcGxldGVkOiAwLFxuICAgICAgZGlzY29ubmVjdGVkOiAwLFxuICAgICAgZmFpbGVkOiAwXG4gICAgfTtcbiAgICB0aGlzLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICBzdGF0ZXNbdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LnN0YXRlXSsrO1xuICAgIH0pO1xuXG4gICAgbmV3U3RhdGUgPSAnbmV3JztcbiAgICBpZiAoc3RhdGVzLmZhaWxlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2ZhaWxlZCc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuY2hlY2tpbmcgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdjaGVja2luZyc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuZGlzY29ubmVjdGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnZGlzY29ubmVjdGVkJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5uZXcgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICduZXcnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmNvbm5lY3RlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2Nvbm5lY3RlZCc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuY29tcGxldGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnY29tcGxldGVkJztcbiAgICB9XG5cbiAgICBpZiAobmV3U3RhdGUgIT09IHRoaXMuaWNlQ29ubmVjdGlvblN0YXRlKSB7XG4gICAgICB0aGlzLmljZUNvbm5lY3Rpb25TdGF0ZSA9IG5ld1N0YXRlO1xuICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdpY2Vjb25uZWN0aW9uc3RhdGVjaGFuZ2UnKTtcbiAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnQoJ2ljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZScsIGV2ZW50KTtcbiAgICB9XG4gIH07XG5cbiAgLy8gVXBkYXRlIHRoZSBjb25uZWN0aW9uIHN0YXRlLlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX3VwZGF0ZUNvbm5lY3Rpb25TdGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBuZXdTdGF0ZTtcbiAgICB2YXIgc3RhdGVzID0ge1xuICAgICAgJ25ldyc6IDAsXG4gICAgICBjbG9zZWQ6IDAsXG4gICAgICBjb25uZWN0aW5nOiAwLFxuICAgICAgY29ubmVjdGVkOiAwLFxuICAgICAgY29tcGxldGVkOiAwLFxuICAgICAgZGlzY29ubmVjdGVkOiAwLFxuICAgICAgZmFpbGVkOiAwXG4gICAgfTtcbiAgICB0aGlzLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICBzdGF0ZXNbdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LnN0YXRlXSsrO1xuICAgICAgc3RhdGVzW3RyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQuc3RhdGVdKys7XG4gICAgfSk7XG4gICAgLy8gSUNFVHJhbnNwb3J0LmNvbXBsZXRlZCBhbmQgY29ubmVjdGVkIGFyZSB0aGUgc2FtZSBmb3IgdGhpcyBwdXJwb3NlLlxuICAgIHN0YXRlcy5jb25uZWN0ZWQgKz0gc3RhdGVzLmNvbXBsZXRlZDtcblxuICAgIG5ld1N0YXRlID0gJ25ldyc7XG4gICAgaWYgKHN0YXRlcy5mYWlsZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdmYWlsZWQnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmNvbm5lY3RpbmcgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdjb25uZWN0aW5nJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5kaXNjb25uZWN0ZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdkaXNjb25uZWN0ZWQnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLm5ldyA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ25ldyc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuY29ubmVjdGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnY29ubmVjdGVkJztcbiAgICB9XG5cbiAgICBpZiAobmV3U3RhdGUgIT09IHRoaXMuY29ubmVjdGlvblN0YXRlKSB7XG4gICAgICB0aGlzLmNvbm5lY3Rpb25TdGF0ZSA9IG5ld1N0YXRlO1xuICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdjb25uZWN0aW9uc3RhdGVjaGFuZ2UnKTtcbiAgICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnQoJ2Nvbm5lY3Rpb25zdGF0ZWNoYW5nZScsIGV2ZW50KTtcbiAgICB9XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNyZWF0ZU9mZmVyID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBjID0gdGhpcztcblxuICAgIGlmIChwYy5faXNDbG9zZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQ2FuIG5vdCBjYWxsIGNyZWF0ZU9mZmVyIGFmdGVyIGNsb3NlJykpO1xuICAgIH1cblxuICAgIHZhciBudW1BdWRpb1RyYWNrcyA9IHBjLnRyYW5zY2VpdmVycy5maWx0ZXIoZnVuY3Rpb24odCkge1xuICAgICAgcmV0dXJuIHQua2luZCA9PT0gJ2F1ZGlvJztcbiAgICB9KS5sZW5ndGg7XG4gICAgdmFyIG51bVZpZGVvVHJhY2tzID0gcGMudHJhbnNjZWl2ZXJzLmZpbHRlcihmdW5jdGlvbih0KSB7XG4gICAgICByZXR1cm4gdC5raW5kID09PSAndmlkZW8nO1xuICAgIH0pLmxlbmd0aDtcblxuICAgIC8vIERldGVybWluZSBudW1iZXIgb2YgYXVkaW8gYW5kIHZpZGVvIHRyYWNrcyB3ZSBuZWVkIHRvIHNlbmQvcmVjdi5cbiAgICB2YXIgb2ZmZXJPcHRpb25zID0gYXJndW1lbnRzWzBdO1xuICAgIGlmIChvZmZlck9wdGlvbnMpIHtcbiAgICAgIC8vIFJlamVjdCBDaHJvbWUgbGVnYWN5IGNvbnN0cmFpbnRzLlxuICAgICAgaWYgKG9mZmVyT3B0aW9ucy5tYW5kYXRvcnkgfHwgb2ZmZXJPcHRpb25zLm9wdGlvbmFsKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoXG4gICAgICAgICAgICAnTGVnYWN5IG1hbmRhdG9yeS9vcHRpb25hbCBjb25zdHJhaW50cyBub3Qgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgICAgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvID09PSB0cnVlKSB7XG4gICAgICAgICAgbnVtQXVkaW9UcmFja3MgPSAxO1xuICAgICAgICB9IGVsc2UgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvID09PSBmYWxzZSkge1xuICAgICAgICAgIG51bUF1ZGlvVHJhY2tzID0gMDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBudW1BdWRpb1RyYWNrcyA9IG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW8gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW8gPT09IHRydWUpIHtcbiAgICAgICAgICBudW1WaWRlb1RyYWNrcyA9IDE7XG4gICAgICAgIH0gZWxzZSBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW8gPT09IGZhbHNlKSB7XG4gICAgICAgICAgbnVtVmlkZW9UcmFja3MgPSAwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG51bVZpZGVvVHJhY2tzID0gb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW87XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBwYy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgbnVtQXVkaW9UcmFja3MtLTtcbiAgICAgICAgaWYgKG51bUF1ZGlvVHJhY2tzIDwgMCkge1xuICAgICAgICAgIHRyYW5zY2VpdmVyLndhbnRSZWNlaXZlID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICBudW1WaWRlb1RyYWNrcy0tO1xuICAgICAgICBpZiAobnVtVmlkZW9UcmFja3MgPCAwKSB7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIud2FudFJlY2VpdmUgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIE0tbGluZXMgZm9yIHJlY3Zvbmx5IHN0cmVhbXMuXG4gICAgd2hpbGUgKG51bUF1ZGlvVHJhY2tzID4gMCB8fCBudW1WaWRlb1RyYWNrcyA+IDApIHtcbiAgICAgIGlmIChudW1BdWRpb1RyYWNrcyA+IDApIHtcbiAgICAgICAgcGMuX2NyZWF0ZVRyYW5zY2VpdmVyKCdhdWRpbycpO1xuICAgICAgICBudW1BdWRpb1RyYWNrcy0tO1xuICAgICAgfVxuICAgICAgaWYgKG51bVZpZGVvVHJhY2tzID4gMCkge1xuICAgICAgICBwYy5fY3JlYXRlVHJhbnNjZWl2ZXIoJ3ZpZGVvJyk7XG4gICAgICAgIG51bVZpZGVvVHJhY2tzLS07XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIHNkcCA9IFNEUFV0aWxzLndyaXRlU2Vzc2lvbkJvaWxlcnBsYXRlKHBjLl9zZHBTZXNzaW9uSWQsXG4gICAgICAgIHBjLl9zZHBTZXNzaW9uVmVyc2lvbisrKTtcbiAgICBwYy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlciwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgLy8gRm9yIGVhY2ggdHJhY2ssIGNyZWF0ZSBhbiBpY2UgZ2F0aGVyZXIsIGljZSB0cmFuc3BvcnQsXG4gICAgICAvLyBkdGxzIHRyYW5zcG9ydCwgcG90ZW50aWFsbHkgcnRwc2VuZGVyIGFuZCBydHByZWNlaXZlci5cbiAgICAgIHZhciB0cmFjayA9IHRyYW5zY2VpdmVyLnRyYWNrO1xuICAgICAgdmFyIGtpbmQgPSB0cmFuc2NlaXZlci5raW5kO1xuICAgICAgdmFyIG1pZCA9IHRyYW5zY2VpdmVyLm1pZCB8fCBTRFBVdGlscy5nZW5lcmF0ZUlkZW50aWZpZXIoKTtcbiAgICAgIHRyYW5zY2VpdmVyLm1pZCA9IG1pZDtcblxuICAgICAgaWYgKCF0cmFuc2NlaXZlci5pY2VHYXRoZXJlcikge1xuICAgICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlciA9IHBjLl9jcmVhdGVJY2VHYXRoZXJlcihzZHBNTGluZUluZGV4LFxuICAgICAgICAgICAgcGMudXNpbmdCdW5kbGUpO1xuICAgICAgfVxuXG4gICAgICB2YXIgbG9jYWxDYXBhYmlsaXRpZXMgPSB3aW5kb3cuUlRDUnRwU2VuZGVyLmdldENhcGFiaWxpdGllcyhraW5kKTtcbiAgICAgIC8vIGZpbHRlciBSVFggdW50aWwgYWRkaXRpb25hbCBzdHVmZiBuZWVkZWQgZm9yIFJUWCBpcyBpbXBsZW1lbnRlZFxuICAgICAgLy8gaW4gYWRhcHRlci5qc1xuICAgICAgaWYgKGVkZ2VWZXJzaW9uIDwgMTUwMTkpIHtcbiAgICAgICAgbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzID0gbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzLmZpbHRlcihcbiAgICAgICAgICAgIGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgICAgICAgICAgIHJldHVybiBjb2RlYy5uYW1lICE9PSAncnR4JztcbiAgICAgICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgbG9jYWxDYXBhYmlsaXRpZXMuY29kZWNzLmZvckVhY2goZnVuY3Rpb24oY29kZWMpIHtcbiAgICAgICAgLy8gd29yayBhcm91bmQgaHR0cHM6Ly9idWdzLmNocm9taXVtLm9yZy9wL3dlYnJ0Yy9pc3N1ZXMvZGV0YWlsP2lkPTY1NTJcbiAgICAgICAgLy8gYnkgYWRkaW5nIGxldmVsLWFzeW1tZXRyeS1hbGxvd2VkPTFcbiAgICAgICAgaWYgKGNvZGVjLm5hbWUgPT09ICdIMjY0JyAmJlxuICAgICAgICAgICAgY29kZWMucGFyYW1ldGVyc1snbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQnXSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgY29kZWMucGFyYW1ldGVyc1snbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQnXSA9ICcxJztcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZvciBzdWJzZXF1ZW50IG9mZmVycywgd2UgbWlnaHQgaGF2ZSB0byByZS11c2UgdGhlIHBheWxvYWRcbiAgICAgICAgLy8gdHlwZSBvZiB0aGUgbGFzdCBvZmZlci5cbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcyAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzLmNvZGVjcykge1xuICAgICAgICAgIHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcy5jb2RlY3MuZm9yRWFjaChmdW5jdGlvbihyZW1vdGVDb2RlYykge1xuICAgICAgICAgICAgaWYgKGNvZGVjLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gcmVtb3RlQ29kZWMubmFtZS50b0xvd2VyQ2FzZSgpICYmXG4gICAgICAgICAgICAgICAgY29kZWMuY2xvY2tSYXRlID09PSByZW1vdGVDb2RlYy5jbG9ja1JhdGUpIHtcbiAgICAgICAgICAgICAgY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgPSByZW1vdGVDb2RlYy5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBsb2NhbENhcGFiaWxpdGllcy5oZWFkZXJFeHRlbnNpb25zLmZvckVhY2goZnVuY3Rpb24oaGRyRXh0KSB7XG4gICAgICAgIHZhciByZW1vdGVFeHRlbnNpb25zID0gdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMuaGVhZGVyRXh0ZW5zaW9ucyB8fCBbXTtcbiAgICAgICAgcmVtb3RlRXh0ZW5zaW9ucy5mb3JFYWNoKGZ1bmN0aW9uKHJIZHJFeHQpIHtcbiAgICAgICAgICBpZiAoaGRyRXh0LnVyaSA9PT0gckhkckV4dC51cmkpIHtcbiAgICAgICAgICAgIGhkckV4dC5pZCA9IHJIZHJFeHQuaWQ7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBnZW5lcmF0ZSBhbiBzc3JjIG5vdywgdG8gYmUgdXNlZCBsYXRlciBpbiBydHBTZW5kZXIuc2VuZFxuICAgICAgdmFyIHNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgPSB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzIHx8IFt7XG4gICAgICAgIHNzcmM6ICgyICogc2RwTUxpbmVJbmRleCArIDEpICogMTAwMVxuICAgICAgfV07XG4gICAgICBpZiAodHJhY2spIHtcbiAgICAgICAgLy8gYWRkIFJUWFxuICAgICAgICBpZiAoZWRnZVZlcnNpb24gPj0gMTUwMTkgJiYga2luZCA9PT0gJ3ZpZGVvJyAmJlxuICAgICAgICAgICAgIXNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgICAgICAgc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHggPSB7XG4gICAgICAgICAgICBzc3JjOiBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgKyAxXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAodHJhbnNjZWl2ZXIud2FudFJlY2VpdmUpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIgPSBuZXcgd2luZG93LlJUQ1J0cFJlY2VpdmVyKFxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydCwga2luZCk7XG4gICAgICB9XG5cbiAgICAgIHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzID0gbG9jYWxDYXBhYmlsaXRpZXM7XG4gICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzID0gc2VuZEVuY29kaW5nUGFyYW1ldGVycztcbiAgICB9KTtcblxuICAgIC8vIGFsd2F5cyBvZmZlciBCVU5ETEUgYW5kIGRpc3Bvc2Ugb24gcmV0dXJuIGlmIG5vdCBzdXBwb3J0ZWQuXG4gICAgaWYgKHBjLl9jb25maWcuYnVuZGxlUG9saWN5ICE9PSAnbWF4LWNvbXBhdCcpIHtcbiAgICAgIHNkcCArPSAnYT1ncm91cDpCVU5ETEUgJyArIHBjLnRyYW5zY2VpdmVycy5tYXAoZnVuY3Rpb24odCkge1xuICAgICAgICByZXR1cm4gdC5taWQ7XG4gICAgICB9KS5qb2luKCcgJykgKyAnXFxyXFxuJztcbiAgICB9XG4gICAgc2RwICs9ICdhPWljZS1vcHRpb25zOnRyaWNrbGVcXHJcXG4nO1xuXG4gICAgcGMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIsIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgIHNkcCArPSB3cml0ZU1lZGlhU2VjdGlvbih0cmFuc2NlaXZlciwgdHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXMsXG4gICAgICAgICAgJ29mZmVyJywgdHJhbnNjZWl2ZXIuc3RyZWFtLCBwYy5fZHRsc1JvbGUpO1xuICAgICAgc2RwICs9ICdhPXJ0Y3AtcnNpemVcXHJcXG4nO1xuXG4gICAgICBpZiAodHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIgJiYgcGMuaWNlR2F0aGVyaW5nU3RhdGUgIT09ICduZXcnICYmXG4gICAgICAgICAgKHNkcE1MaW5lSW5kZXggPT09IDAgfHwgIXBjLnVzaW5nQnVuZGxlKSkge1xuICAgICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlci5nZXRMb2NhbENhbmRpZGF0ZXMoKS5mb3JFYWNoKGZ1bmN0aW9uKGNhbmQpIHtcbiAgICAgICAgICBjYW5kLmNvbXBvbmVudCA9IDE7XG4gICAgICAgICAgc2RwICs9ICdhPScgKyBTRFBVdGlscy53cml0ZUNhbmRpZGF0ZShjYW5kKSArICdcXHJcXG4nO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAodHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIuc3RhdGUgPT09ICdjb21wbGV0ZWQnKSB7XG4gICAgICAgICAgc2RwICs9ICdhPWVuZC1vZi1jYW5kaWRhdGVzXFxyXFxuJztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdmFyIGRlc2MgPSBuZXcgd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbih7XG4gICAgICB0eXBlOiAnb2ZmZXInLFxuICAgICAgc2RwOiBzZHBcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGRlc2MpO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jcmVhdGVBbnN3ZXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuXG4gICAgaWYgKHBjLl9pc0Nsb3NlZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdDYW4gbm90IGNhbGwgY3JlYXRlQW5zd2VyIGFmdGVyIGNsb3NlJykpO1xuICAgIH1cblxuICAgIGlmICghKHBjLnNpZ25hbGluZ1N0YXRlID09PSAnaGF2ZS1yZW1vdGUtb2ZmZXInIHx8XG4gICAgICAgIHBjLnNpZ25hbGluZ1N0YXRlID09PSAnaGF2ZS1sb2NhbC1wcmFuc3dlcicpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0NhbiBub3QgY2FsbCBjcmVhdGVBbnN3ZXIgaW4gc2lnbmFsaW5nU3RhdGUgJyArIHBjLnNpZ25hbGluZ1N0YXRlKSk7XG4gICAgfVxuXG4gICAgdmFyIHNkcCA9IFNEUFV0aWxzLndyaXRlU2Vzc2lvbkJvaWxlcnBsYXRlKHBjLl9zZHBTZXNzaW9uSWQsXG4gICAgICAgIHBjLl9zZHBTZXNzaW9uVmVyc2lvbisrKTtcbiAgICBpZiAocGMudXNpbmdCdW5kbGUpIHtcbiAgICAgIHNkcCArPSAnYT1ncm91cDpCVU5ETEUgJyArIHBjLnRyYW5zY2VpdmVycy5tYXAoZnVuY3Rpb24odCkge1xuICAgICAgICByZXR1cm4gdC5taWQ7XG4gICAgICB9KS5qb2luKCcgJykgKyAnXFxyXFxuJztcbiAgICB9XG4gICAgdmFyIG1lZGlhU2VjdGlvbnNJbk9mZmVyID0gU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyhcbiAgICAgICAgcGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCkubGVuZ3RoO1xuICAgIHBjLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICBpZiAoc2RwTUxpbmVJbmRleCArIDEgPiBtZWRpYVNlY3Rpb25zSW5PZmZlcikge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucmVqZWN0ZWQpIHtcbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICdhcHBsaWNhdGlvbicpIHtcbiAgICAgICAgICBzZHAgKz0gJ209YXBwbGljYXRpb24gMCBEVExTL1NDVFAgNTAwMFxcclxcbic7XG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICAgIHNkcCArPSAnbT1hdWRpbyAwIFVEUC9UTFMvUlRQL1NBVlBGIDBcXHJcXG4nICtcbiAgICAgICAgICAgICAgJ2E9cnRwbWFwOjAgUENNVS84MDAwXFxyXFxuJztcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgICAgc2RwICs9ICdtPXZpZGVvIDAgVURQL1RMUy9SVFAvU0FWUEYgMTIwXFxyXFxuJyArXG4gICAgICAgICAgICAgICdhPXJ0cG1hcDoxMjAgVlA4LzkwMDAwXFxyXFxuJztcbiAgICAgICAgfVxuICAgICAgICBzZHAgKz0gJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nICtcbiAgICAgICAgICAgICdhPWluYWN0aXZlXFxyXFxuJyArXG4gICAgICAgICAgICAnYT1taWQ6JyArIHRyYW5zY2VpdmVyLm1pZCArICdcXHJcXG4nO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIEZJWE1FOiBsb29rIGF0IGRpcmVjdGlvbi5cbiAgICAgIGlmICh0cmFuc2NlaXZlci5zdHJlYW0pIHtcbiAgICAgICAgdmFyIGxvY2FsVHJhY2s7XG4gICAgICAgIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgbG9jYWxUcmFjayA9IHRyYW5zY2VpdmVyLnN0cmVhbS5nZXRBdWRpb1RyYWNrcygpWzBdO1xuICAgICAgICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgICBsb2NhbFRyYWNrID0gdHJhbnNjZWl2ZXIuc3RyZWFtLmdldFZpZGVvVHJhY2tzKClbMF07XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGxvY2FsVHJhY2spIHtcbiAgICAgICAgICAvLyBhZGQgUlRYXG4gICAgICAgICAgaWYgKGVkZ2VWZXJzaW9uID49IDE1MDE5ICYmIHRyYW5zY2VpdmVyLmtpbmQgPT09ICd2aWRlbycgJiZcbiAgICAgICAgICAgICAgIXRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCA9IHtcbiAgICAgICAgICAgICAgc3NyYzogdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICsgMVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gQ2FsY3VsYXRlIGludGVyc2VjdGlvbiBvZiBjYXBhYmlsaXRpZXMuXG4gICAgICB2YXIgY29tbW9uQ2FwYWJpbGl0aWVzID0gZ2V0Q29tbW9uQ2FwYWJpbGl0aWVzKFxuICAgICAgICAgIHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzLFxuICAgICAgICAgIHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcyk7XG5cbiAgICAgIHZhciBoYXNSdHggPSBjb21tb25DYXBhYmlsaXRpZXMuY29kZWNzLmZpbHRlcihmdW5jdGlvbihjKSB7XG4gICAgICAgIHJldHVybiBjLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gJ3J0eCc7XG4gICAgICB9KS5sZW5ndGg7XG4gICAgICBpZiAoIWhhc1J0eCAmJiB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgICAgICBkZWxldGUgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHg7XG4gICAgICB9XG5cbiAgICAgIHNkcCArPSB3cml0ZU1lZGlhU2VjdGlvbih0cmFuc2NlaXZlciwgY29tbW9uQ2FwYWJpbGl0aWVzLFxuICAgICAgICAgICdhbnN3ZXInLCB0cmFuc2NlaXZlci5zdHJlYW0sIHBjLl9kdGxzUm9sZSk7XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMgJiZcbiAgICAgICAgICB0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSkge1xuICAgICAgICBzZHAgKz0gJ2E9cnRjcC1yc2l6ZVxcclxcbic7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB2YXIgZGVzYyA9IG5ldyB3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKHtcbiAgICAgIHR5cGU6ICdhbnN3ZXInLFxuICAgICAgc2RwOiBzZHBcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGRlc2MpO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIHZhciBzZWN0aW9ucztcbiAgICBpZiAoY2FuZGlkYXRlICYmICEoY2FuZGlkYXRlLnNkcE1MaW5lSW5kZXggIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICBjYW5kaWRhdGUuc2RwTWlkKSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBUeXBlRXJyb3IoJ3NkcE1MaW5lSW5kZXggb3Igc2RwTWlkIHJlcXVpcmVkJykpO1xuICAgIH1cblxuICAgIC8vIFRPRE86IG5lZWRzIHRvIGdvIGludG8gb3BzIHF1ZXVlLlxuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGlmICghcGMuX3JlbW90ZURlc2NyaXB0aW9uKSB7XG4gICAgICAgIHJldHVybiByZWplY3QobWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgICAnQ2FuIG5vdCBhZGQgSUNFIGNhbmRpZGF0ZSB3aXRob3V0IGEgcmVtb3RlIGRlc2NyaXB0aW9uJykpO1xuICAgICAgfSBlbHNlIGlmICghY2FuZGlkYXRlIHx8IGNhbmRpZGF0ZS5jYW5kaWRhdGUgPT09ICcnKSB7XG4gICAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgcGMudHJhbnNjZWl2ZXJzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgaWYgKHBjLnRyYW5zY2VpdmVyc1tqXS5yZWplY3RlZCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1tqXS5pY2VUcmFuc3BvcnQuYWRkUmVtb3RlQ2FuZGlkYXRlKHt9KTtcbiAgICAgICAgICBzZWN0aW9ucyA9IFNEUFV0aWxzLmdldE1lZGlhU2VjdGlvbnMocGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCk7XG4gICAgICAgICAgc2VjdGlvbnNbal0gKz0gJ2E9ZW5kLW9mLWNhbmRpZGF0ZXNcXHJcXG4nO1xuICAgICAgICAgIHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHAgPVxuICAgICAgICAgICAgICBTRFBVdGlscy5nZXREZXNjcmlwdGlvbihwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwKSArXG4gICAgICAgICAgICAgIHNlY3Rpb25zLmpvaW4oJycpO1xuICAgICAgICAgIGlmIChwYy51c2luZ0J1bmRsZSkge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgc2RwTUxpbmVJbmRleCA9IGNhbmRpZGF0ZS5zZHBNTGluZUluZGV4O1xuICAgICAgICBpZiAoY2FuZGlkYXRlLnNkcE1pZCkge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGMudHJhbnNjZWl2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBpZiAocGMudHJhbnNjZWl2ZXJzW2ldLm1pZCA9PT0gY2FuZGlkYXRlLnNkcE1pZCkge1xuICAgICAgICAgICAgICBzZHBNTGluZUluZGV4ID0gaTtcbiAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHZhciB0cmFuc2NlaXZlciA9IHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XTtcbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgaWYgKHRyYW5zY2VpdmVyLnJlamVjdGVkKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzb2x2ZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB2YXIgY2FuZCA9IE9iamVjdC5rZXlzKGNhbmRpZGF0ZS5jYW5kaWRhdGUpLmxlbmd0aCA+IDAgP1xuICAgICAgICAgICAgICBTRFBVdGlscy5wYXJzZUNhbmRpZGF0ZShjYW5kaWRhdGUuY2FuZGlkYXRlKSA6IHt9O1xuICAgICAgICAgIC8vIElnbm9yZSBDaHJvbWUncyBpbnZhbGlkIGNhbmRpZGF0ZXMgc2luY2UgRWRnZSBkb2VzIG5vdCBsaWtlIHRoZW0uXG4gICAgICAgICAgaWYgKGNhbmQucHJvdG9jb2wgPT09ICd0Y3AnICYmIChjYW5kLnBvcnQgPT09IDAgfHwgY2FuZC5wb3J0ID09PSA5KSkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc29sdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gSWdub3JlIFJUQ1AgY2FuZGlkYXRlcywgd2UgYXNzdW1lIFJUQ1AtTVVYLlxuICAgICAgICAgIGlmIChjYW5kLmNvbXBvbmVudCAmJiBjYW5kLmNvbXBvbmVudCAhPT0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIHJlc29sdmUoKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gd2hlbiB1c2luZyBidW5kbGUsIGF2b2lkIGFkZGluZyBjYW5kaWRhdGVzIHRvIHRoZSB3cm9uZ1xuICAgICAgICAgIC8vIGljZSB0cmFuc3BvcnQuIEFuZCBhdm9pZCBhZGRpbmcgY2FuZGlkYXRlcyBhZGRlZCBpbiB0aGUgU0RQLlxuICAgICAgICAgIGlmIChzZHBNTGluZUluZGV4ID09PSAwIHx8IChzZHBNTGluZUluZGV4ID4gMCAmJlxuICAgICAgICAgICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQgIT09IHBjLnRyYW5zY2VpdmVyc1swXS5pY2VUcmFuc3BvcnQpKSB7XG4gICAgICAgICAgICBpZiAoIW1heWJlQWRkQ2FuZGlkYXRlKHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCwgY2FuZCkpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlamVjdChtYWtlRXJyb3IoJ09wZXJhdGlvbkVycm9yJyxcbiAgICAgICAgICAgICAgICAgICdDYW4gbm90IGFkZCBJQ0UgY2FuZGlkYXRlJykpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIC8vIHVwZGF0ZSB0aGUgcmVtb3RlRGVzY3JpcHRpb24uXG4gICAgICAgICAgdmFyIGNhbmRpZGF0ZVN0cmluZyA9IGNhbmRpZGF0ZS5jYW5kaWRhdGUudHJpbSgpO1xuICAgICAgICAgIGlmIChjYW5kaWRhdGVTdHJpbmcuaW5kZXhPZignYT0nKSA9PT0gMCkge1xuICAgICAgICAgICAgY2FuZGlkYXRlU3RyaW5nID0gY2FuZGlkYXRlU3RyaW5nLnN1YnN0cigyKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgc2VjdGlvbnMgPSBTRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zKHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHApO1xuICAgICAgICAgIHNlY3Rpb25zW3NkcE1MaW5lSW5kZXhdICs9ICdhPScgK1xuICAgICAgICAgICAgICAoY2FuZC50eXBlID8gY2FuZGlkYXRlU3RyaW5nIDogJ2VuZC1vZi1jYW5kaWRhdGVzJylcbiAgICAgICAgICAgICAgKyAnXFxyXFxuJztcbiAgICAgICAgICBwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwID1cbiAgICAgICAgICAgICAgU0RQVXRpbHMuZ2V0RGVzY3JpcHRpb24ocGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCkgK1xuICAgICAgICAgICAgICBzZWN0aW9ucy5qb2luKCcnKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KG1ha2VFcnJvcignT3BlcmF0aW9uRXJyb3InLFxuICAgICAgICAgICAgICAnQ2FuIG5vdCBhZGQgSUNFIGNhbmRpZGF0ZScpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmVzb2x2ZSgpO1xuICAgIH0pO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKHNlbGVjdG9yKSB7XG4gICAgaWYgKHNlbGVjdG9yICYmIHNlbGVjdG9yIGluc3RhbmNlb2Ygd2luZG93Lk1lZGlhU3RyZWFtVHJhY2spIHtcbiAgICAgIHZhciBzZW5kZXJPclJlY2VpdmVyID0gbnVsbDtcbiAgICAgIHRoaXMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlciAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLnRyYWNrID09PSBzZWxlY3Rvcikge1xuICAgICAgICAgIHNlbmRlck9yUmVjZWl2ZXIgPSB0cmFuc2NlaXZlci5ydHBTZW5kZXI7XG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyLnRyYWNrID09PSBzZWxlY3Rvcikge1xuICAgICAgICAgIHNlbmRlck9yUmVjZWl2ZXIgPSB0cmFuc2NlaXZlci5ydHBSZWNlaXZlcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoIXNlbmRlck9yUmVjZWl2ZXIpIHtcbiAgICAgICAgdGhyb3cgbWFrZUVycm9yKCdJbnZhbGlkQWNjZXNzRXJyb3InLCAnSW52YWxpZCBzZWxlY3Rvci4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZW5kZXJPclJlY2VpdmVyLmdldFN0YXRzKCk7XG4gICAgfVxuXG4gICAgdmFyIHByb21pc2VzID0gW107XG4gICAgdGhpcy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgWydydHBTZW5kZXInLCAncnRwUmVjZWl2ZXInLCAnaWNlR2F0aGVyZXInLCAnaWNlVHJhbnNwb3J0JyxcbiAgICAgICAgICAnZHRsc1RyYW5zcG9ydCddLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICAgICAgICBpZiAodHJhbnNjZWl2ZXJbbWV0aG9kXSkge1xuICAgICAgICAgICAgICBwcm9taXNlcy5wdXNoKHRyYW5zY2VpdmVyW21ldGhvZF0uZ2V0U3RhdHMoKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKGZ1bmN0aW9uKGFsbFN0YXRzKSB7XG4gICAgICB2YXIgcmVzdWx0cyA9IG5ldyBNYXAoKTtcbiAgICAgIGFsbFN0YXRzLmZvckVhY2goZnVuY3Rpb24oc3RhdHMpIHtcbiAgICAgICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihzdGF0KSB7XG4gICAgICAgICAgcmVzdWx0cy5zZXQoc3RhdC5pZCwgc3RhdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gcmVzdWx0cztcbiAgICB9KTtcbiAgfTtcblxuICAvLyBmaXggbG93LWxldmVsIHN0YXQgbmFtZXMgYW5kIHJldHVybiBNYXAgaW5zdGVhZCBvZiBvYmplY3QuXG4gIHZhciBvcnRjT2JqZWN0cyA9IFsnUlRDUnRwU2VuZGVyJywgJ1JUQ1J0cFJlY2VpdmVyJywgJ1JUQ0ljZUdhdGhlcmVyJyxcbiAgICAnUlRDSWNlVHJhbnNwb3J0JywgJ1JUQ0R0bHNUcmFuc3BvcnQnXTtcbiAgb3J0Y09iamVjdHMuZm9yRWFjaChmdW5jdGlvbihvcnRjT2JqZWN0TmFtZSkge1xuICAgIHZhciBvYmogPSB3aW5kb3dbb3J0Y09iamVjdE5hbWVdO1xuICAgIGlmIChvYmogJiYgb2JqLnByb3RvdHlwZSAmJiBvYmoucHJvdG90eXBlLmdldFN0YXRzKSB7XG4gICAgICB2YXIgbmF0aXZlR2V0c3RhdHMgPSBvYmoucHJvdG90eXBlLmdldFN0YXRzO1xuICAgICAgb2JqLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbmF0aXZlR2V0c3RhdHMuYXBwbHkodGhpcylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24obmF0aXZlU3RhdHMpIHtcbiAgICAgICAgICB2YXIgbWFwU3RhdHMgPSBuZXcgTWFwKCk7XG4gICAgICAgICAgT2JqZWN0LmtleXMobmF0aXZlU3RhdHMpLmZvckVhY2goZnVuY3Rpb24oaWQpIHtcbiAgICAgICAgICAgIG5hdGl2ZVN0YXRzW2lkXS50eXBlID0gZml4U3RhdHNUeXBlKG5hdGl2ZVN0YXRzW2lkXSk7XG4gICAgICAgICAgICBtYXBTdGF0cy5zZXQoaWQsIG5hdGl2ZVN0YXRzW2lkXSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIG1hcFN0YXRzO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfVxuICB9KTtcblxuICAvLyBsZWdhY3kgY2FsbGJhY2sgc2hpbXMuIFNob3VsZCBiZSBtb3ZlZCB0byBhZGFwdGVyLmpzIHNvbWUgZGF5cy5cbiAgdmFyIG1ldGhvZHMgPSBbJ2NyZWF0ZU9mZmVyJywgJ2NyZWF0ZUFuc3dlciddO1xuICBtZXRob2RzLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgdmFyIG5hdGl2ZU1ldGhvZCA9IFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIGlmICh0eXBlb2YgYXJnc1swXSA9PT0gJ2Z1bmN0aW9uJyB8fFxuICAgICAgICAgIHR5cGVvZiBhcmdzWzFdID09PSAnZnVuY3Rpb24nKSB7IC8vIGxlZ2FjeVxuICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIFthcmd1bWVudHNbMl1dKVxuICAgICAgICAudGhlbihmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgICAgICAgIGlmICh0eXBlb2YgYXJnc1swXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgYXJnc1swXS5hcHBseShudWxsLCBbZGVzY3JpcHRpb25dKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sIGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBhcmdzWzFdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBhcmdzWzFdLmFwcGx5KG51bGwsIFtlcnJvcl0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSk7XG5cbiAgbWV0aG9kcyA9IFsnc2V0TG9jYWxEZXNjcmlwdGlvbicsICdzZXRSZW1vdGVEZXNjcmlwdGlvbicsICdhZGRJY2VDYW5kaWRhdGUnXTtcbiAgbWV0aG9kcy5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgIHZhciBuYXRpdmVNZXRob2QgPSBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICBpZiAodHlwZW9mIGFyZ3NbMV0gPT09ICdmdW5jdGlvbicgfHxcbiAgICAgICAgICB0eXBlb2YgYXJnc1syXSA9PT0gJ2Z1bmN0aW9uJykgeyAvLyBsZWdhY3lcbiAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmICh0eXBlb2YgYXJnc1sxXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgYXJnc1sxXS5hcHBseShudWxsKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sIGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBhcmdzWzJdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBhcmdzWzJdLmFwcGx5KG51bGwsIFtlcnJvcl0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSk7XG5cbiAgLy8gZ2V0U3RhdHMgaXMgc3BlY2lhbC4gSXQgZG9lc24ndCBoYXZlIGEgc3BlYyBsZWdhY3kgbWV0aG9kIHlldCB3ZSBzdXBwb3J0XG4gIC8vIGdldFN0YXRzKHNvbWV0aGluZywgY2IpIHdpdGhvdXQgZXJyb3IgY2FsbGJhY2tzLlxuICBbJ2dldFN0YXRzJ10uZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICB2YXIgbmF0aXZlTWV0aG9kID0gUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgaWYgKHR5cGVvZiBhcmdzWzFdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKVxuICAgICAgICAudGhlbihmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGFyZ3NbMV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGFyZ3NbMV0uYXBwbHkobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9KTtcblxuICByZXR1cm4gUlRDUGVlckNvbm5lY3Rpb247XG59O1xuIiwiIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG4vLyBTRFAgaGVscGVycy5cbnZhciBTRFBVdGlscyA9IHt9O1xuXG4vLyBHZW5lcmF0ZSBhbiBhbHBoYW51bWVyaWMgaWRlbnRpZmllciBmb3IgY25hbWUgb3IgbWlkcy5cbi8vIFRPRE86IHVzZSBVVUlEcyBpbnN0ZWFkPyBodHRwczovL2dpc3QuZ2l0aHViLmNvbS9qZWQvOTgyODgzXG5TRFBVdGlscy5nZW5lcmF0ZUlkZW50aWZpZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCAxMCk7XG59O1xuXG4vLyBUaGUgUlRDUCBDTkFNRSB1c2VkIGJ5IGFsbCBwZWVyY29ubmVjdGlvbnMgZnJvbSB0aGUgc2FtZSBKUy5cblNEUFV0aWxzLmxvY2FsQ05hbWUgPSBTRFBVdGlscy5nZW5lcmF0ZUlkZW50aWZpZXIoKTtcblxuLy8gU3BsaXRzIFNEUCBpbnRvIGxpbmVzLCBkZWFsaW5nIHdpdGggYm90aCBDUkxGIGFuZCBMRi5cblNEUFV0aWxzLnNwbGl0TGluZXMgPSBmdW5jdGlvbihibG9iKSB7XG4gIHJldHVybiBibG9iLnRyaW0oKS5zcGxpdCgnXFxuJykubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICByZXR1cm4gbGluZS50cmltKCk7XG4gIH0pO1xufTtcbi8vIFNwbGl0cyBTRFAgaW50byBzZXNzaW9ucGFydCBhbmQgbWVkaWFzZWN0aW9ucy4gRW5zdXJlcyBDUkxGLlxuU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgdmFyIHBhcnRzID0gYmxvYi5zcGxpdCgnXFxubT0nKTtcbiAgcmV0dXJuIHBhcnRzLm1hcChmdW5jdGlvbihwYXJ0LCBpbmRleCkge1xuICAgIHJldHVybiAoaW5kZXggPiAwID8gJ209JyArIHBhcnQgOiBwYXJ0KS50cmltKCkgKyAnXFxyXFxuJztcbiAgfSk7XG59O1xuXG4vLyByZXR1cm5zIHRoZSBzZXNzaW9uIGRlc2NyaXB0aW9uLlxuU0RQVXRpbHMuZ2V0RGVzY3JpcHRpb24gPSBmdW5jdGlvbihibG9iKSB7XG4gIHZhciBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHJldHVybiBzZWN0aW9ucyAmJiBzZWN0aW9uc1swXTtcbn07XG5cbi8vIHJldHVybnMgdGhlIGluZGl2aWR1YWwgbWVkaWEgc2VjdGlvbnMuXG5TRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICB2YXIgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKGJsb2IpO1xuICBzZWN0aW9ucy5zaGlmdCgpO1xuICByZXR1cm4gc2VjdGlvbnM7XG59O1xuXG4vLyBSZXR1cm5zIGxpbmVzIHRoYXQgc3RhcnQgd2l0aCBhIGNlcnRhaW4gcHJlZml4LlxuU0RQVXRpbHMubWF0Y2hQcmVmaXggPSBmdW5jdGlvbihibG9iLCBwcmVmaXgpIHtcbiAgcmV0dXJuIFNEUFV0aWxzLnNwbGl0TGluZXMoYmxvYikuZmlsdGVyKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICByZXR1cm4gbGluZS5pbmRleE9mKHByZWZpeCkgPT09IDA7XG4gIH0pO1xufTtcblxuLy8gUGFyc2VzIGFuIElDRSBjYW5kaWRhdGUgbGluZS4gU2FtcGxlIGlucHV0OlxuLy8gY2FuZGlkYXRlOjcwMjc4NjM1MCAyIHVkcCA0MTgxOTkwMiA4LjguOC44IDYwNzY5IHR5cCByZWxheSByYWRkciA4LjguOC44XG4vLyBycG9ydCA1NTk5NlwiXG5TRFBVdGlscy5wYXJzZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHBhcnRzO1xuICAvLyBQYXJzZSBib3RoIHZhcmlhbnRzLlxuICBpZiAobGluZS5pbmRleE9mKCdhPWNhbmRpZGF0ZTonKSA9PT0gMCkge1xuICAgIHBhcnRzID0gbGluZS5zdWJzdHJpbmcoMTIpLnNwbGl0KCcgJyk7XG4gIH0gZWxzZSB7XG4gICAgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMCkuc3BsaXQoJyAnKTtcbiAgfVxuXG4gIHZhciBjYW5kaWRhdGUgPSB7XG4gICAgZm91bmRhdGlvbjogcGFydHNbMF0sXG4gICAgY29tcG9uZW50OiBwYXJzZUludChwYXJ0c1sxXSwgMTApLFxuICAgIHByb3RvY29sOiBwYXJ0c1syXS50b0xvd2VyQ2FzZSgpLFxuICAgIHByaW9yaXR5OiBwYXJzZUludChwYXJ0c1szXSwgMTApLFxuICAgIGlwOiBwYXJ0c1s0XSxcbiAgICBwb3J0OiBwYXJzZUludChwYXJ0c1s1XSwgMTApLFxuICAgIC8vIHNraXAgcGFydHNbNl0gPT0gJ3R5cCdcbiAgICB0eXBlOiBwYXJ0c1s3XVxuICB9O1xuXG4gIGZvciAodmFyIGkgPSA4OyBpIDwgcGFydHMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICBzd2l0Y2ggKHBhcnRzW2ldKSB7XG4gICAgICBjYXNlICdyYWRkcic6XG4gICAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdycG9ydCc6XG4gICAgICAgIGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCA9IHBhcnNlSW50KHBhcnRzW2kgKyAxXSwgMTApO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3RjcHR5cGUnOlxuICAgICAgICBjYW5kaWRhdGUudGNwVHlwZSA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1ZnJhZyc6XG4gICAgICAgIGNhbmRpZGF0ZS51ZnJhZyA9IHBhcnRzW2kgKyAxXTsgLy8gZm9yIGJhY2t3YXJkIGNvbXBhYmlsaXR5LlxuICAgICAgICBjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OiAvLyBleHRlbnNpb24gaGFuZGxpbmcsIGluIHBhcnRpY3VsYXIgdWZyYWdcbiAgICAgICAgY2FuZGlkYXRlW3BhcnRzW2ldXSA9IHBhcnRzW2kgKyAxXTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiBjYW5kaWRhdGU7XG59O1xuXG4vLyBUcmFuc2xhdGVzIGEgY2FuZGlkYXRlIG9iamVjdCBpbnRvIFNEUCBjYW5kaWRhdGUgYXR0cmlidXRlLlxuU0RQVXRpbHMud3JpdGVDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgdmFyIHNkcCA9IFtdO1xuICBzZHAucHVzaChjYW5kaWRhdGUuZm91bmRhdGlvbik7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5jb21wb25lbnQpO1xuICBzZHAucHVzaChjYW5kaWRhdGUucHJvdG9jb2wudG9VcHBlckNhc2UoKSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcmlvcml0eSk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5pcCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wb3J0KTtcblxuICB2YXIgdHlwZSA9IGNhbmRpZGF0ZS50eXBlO1xuICBzZHAucHVzaCgndHlwJyk7XG4gIHNkcC5wdXNoKHR5cGUpO1xuICBpZiAodHlwZSAhPT0gJ2hvc3QnICYmIGNhbmRpZGF0ZS5yZWxhdGVkQWRkcmVzcyAmJlxuICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0KSB7XG4gICAgc2RwLnB1c2goJ3JhZGRyJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzKTtcbiAgICBzZHAucHVzaCgncnBvcnQnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZFBvcnQpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudGNwVHlwZSAmJiBjYW5kaWRhdGUucHJvdG9jb2wudG9Mb3dlckNhc2UoKSA9PT0gJ3RjcCcpIHtcbiAgICBzZHAucHVzaCgndGNwdHlwZScpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS50Y3BUeXBlKTtcbiAgfVxuICBpZiAoY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgfHwgY2FuZGlkYXRlLnVmcmFnKSB7XG4gICAgc2RwLnB1c2goJ3VmcmFnJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnVzZXJuYW1lRnJhZ21lbnQgfHwgY2FuZGlkYXRlLnVmcmFnKTtcbiAgfVxuICByZXR1cm4gJ2NhbmRpZGF0ZTonICsgc2RwLmpvaW4oJyAnKTtcbn07XG5cbi8vIFBhcnNlcyBhbiBpY2Utb3B0aW9ucyBsaW5lLCByZXR1cm5zIGFuIGFycmF5IG9mIG9wdGlvbiB0YWdzLlxuLy8gYT1pY2Utb3B0aW9uczpmb28gYmFyXG5TRFBVdGlscy5wYXJzZUljZU9wdGlvbnMgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHJldHVybiBsaW5lLnN1YnN0cigxNCkuc3BsaXQoJyAnKTtcbn1cblxuLy8gUGFyc2VzIGFuIHJ0cG1hcCBsaW5lLCByZXR1cm5zIFJUQ1J0cENvZGRlY1BhcmFtZXRlcnMuIFNhbXBsZSBpbnB1dDpcbi8vIGE9cnRwbWFwOjExMSBvcHVzLzQ4MDAwLzJcblNEUFV0aWxzLnBhcnNlUnRwTWFwID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cig5KS5zcGxpdCgnICcpO1xuICB2YXIgcGFyc2VkID0ge1xuICAgIHBheWxvYWRUeXBlOiBwYXJzZUludChwYXJ0cy5zaGlmdCgpLCAxMCkgLy8gd2FzOiBpZFxuICB9O1xuXG4gIHBhcnRzID0gcGFydHNbMF0uc3BsaXQoJy8nKTtcblxuICBwYXJzZWQubmFtZSA9IHBhcnRzWzBdO1xuICBwYXJzZWQuY2xvY2tSYXRlID0gcGFyc2VJbnQocGFydHNbMV0sIDEwKTsgLy8gd2FzOiBjbG9ja3JhdGVcbiAgcGFyc2VkLmNoYW5uZWxzID0gcGFydHMubGVuZ3RoID09PSAzID8gcGFyc2VJbnQocGFydHNbMl0sIDEwKSA6IDE7XG4gIC8vIGxlZ2FjeSBhbGlhcywgZ290IHJlbmFtZWQgYmFjayB0byBjaGFubmVscyBpbiBPUlRDLlxuICBwYXJzZWQubnVtQ2hhbm5lbHMgPSBwYXJzZWQuY2hhbm5lbHM7XG4gIHJldHVybiBwYXJzZWQ7XG59O1xuXG4vLyBHZW5lcmF0ZSBhbiBhPXJ0cG1hcCBsaW5lIGZyb20gUlRDUnRwQ29kZWNDYXBhYmlsaXR5IG9yXG4vLyBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cE1hcCA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIHZhciBwdCA9IGNvZGVjLnBheWxvYWRUeXBlO1xuICBpZiAoY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGUgIT09IHVuZGVmaW5lZCkge1xuICAgIHB0ID0gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gIH1cbiAgdmFyIGNoYW5uZWxzID0gY29kZWMuY2hhbm5lbHMgfHwgY29kZWMubnVtQ2hhbm5lbHMgfHwgMTtcbiAgcmV0dXJuICdhPXJ0cG1hcDonICsgcHQgKyAnICcgKyBjb2RlYy5uYW1lICsgJy8nICsgY29kZWMuY2xvY2tSYXRlICtcbiAgICAgIChjaGFubmVscyAhPT0gMSA/ICcvJyArIGNoYW5uZWxzIDogJycpICsgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgYW4gYT1leHRtYXAgbGluZSAoaGVhZGVyZXh0ZW5zaW9uIGZyb20gUkZDIDUyODUpLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPWV4dG1hcDoyIHVybjppZXRmOnBhcmFtczpydHAtaGRyZXh0OnRvZmZzZXRcbi8vIGE9ZXh0bWFwOjIvc2VuZG9ubHkgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuU0RQVXRpbHMucGFyc2VFeHRtYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKDkpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgaWQ6IHBhcnNlSW50KHBhcnRzWzBdLCAxMCksXG4gICAgZGlyZWN0aW9uOiBwYXJ0c1swXS5pbmRleE9mKCcvJykgPiAwID8gcGFydHNbMF0uc3BsaXQoJy8nKVsxXSA6ICdzZW5kcmVjdicsXG4gICAgdXJpOiBwYXJ0c1sxXVxuICB9O1xufTtcblxuLy8gR2VuZXJhdGVzIGE9ZXh0bWFwIGxpbmUgZnJvbSBSVENSdHBIZWFkZXJFeHRlbnNpb25QYXJhbWV0ZXJzIG9yXG4vLyBSVENSdHBIZWFkZXJFeHRlbnNpb24uXG5TRFBVdGlscy53cml0ZUV4dG1hcCA9IGZ1bmN0aW9uKGhlYWRlckV4dGVuc2lvbikge1xuICByZXR1cm4gJ2E9ZXh0bWFwOicgKyAoaGVhZGVyRXh0ZW5zaW9uLmlkIHx8IGhlYWRlckV4dGVuc2lvbi5wcmVmZXJyZWRJZCkgK1xuICAgICAgKGhlYWRlckV4dGVuc2lvbi5kaXJlY3Rpb24gJiYgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAhPT0gJ3NlbmRyZWN2J1xuICAgICAgICAgID8gJy8nICsgaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvblxuICAgICAgICAgIDogJycpICtcbiAgICAgICcgJyArIGhlYWRlckV4dGVuc2lvbi51cmkgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhbiBmdG1wIGxpbmUsIHJldHVybnMgZGljdGlvbmFyeS4gU2FtcGxlIGlucHV0OlxuLy8gYT1mbXRwOjk2IHZicj1vbjtjbmc9b25cbi8vIEFsc28gZGVhbHMgd2l0aCB2YnI9b247IGNuZz1vblxuU0RQVXRpbHMucGFyc2VGbXRwID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgcGFyc2VkID0ge307XG4gIHZhciBrdjtcbiAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnOycpO1xuICBmb3IgKHZhciBqID0gMDsgaiA8IHBhcnRzLmxlbmd0aDsgaisrKSB7XG4gICAga3YgPSBwYXJ0c1tqXS50cmltKCkuc3BsaXQoJz0nKTtcbiAgICBwYXJzZWRba3ZbMF0udHJpbSgpXSA9IGt2WzFdO1xuICB9XG4gIHJldHVybiBwYXJzZWQ7XG59O1xuXG4vLyBHZW5lcmF0ZXMgYW4gYT1mdG1wIGxpbmUgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVGbXRwID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgdmFyIGxpbmUgPSAnJztcbiAgdmFyIHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucGFyYW1ldGVycyAmJiBPYmplY3Qua2V5cyhjb2RlYy5wYXJhbWV0ZXJzKS5sZW5ndGgpIHtcbiAgICB2YXIgcGFyYW1zID0gW107XG4gICAgT2JqZWN0LmtleXMoY29kZWMucGFyYW1ldGVycykuZm9yRWFjaChmdW5jdGlvbihwYXJhbSkge1xuICAgICAgaWYgKGNvZGVjLnBhcmFtZXRlcnNbcGFyYW1dKSB7XG4gICAgICAgIHBhcmFtcy5wdXNoKHBhcmFtICsgJz0nICsgY29kZWMucGFyYW1ldGVyc1twYXJhbV0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGxpbmUgKz0gJ2E9Zm10cDonICsgcHQgKyAnICcgKyBwYXJhbXMuam9pbignOycpICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIGxpbmU7XG59O1xuXG4vLyBQYXJzZXMgYW4gcnRjcC1mYiBsaW5lLCByZXR1cm5zIFJUQ1BSdGNwRmVlZGJhY2sgb2JqZWN0LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXJ0Y3AtZmI6OTggbmFjayBycHNpXG5TRFBVdGlscy5wYXJzZVJ0Y3BGYiA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIobGluZS5pbmRleE9mKCcgJykgKyAxKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHR5cGU6IHBhcnRzLnNoaWZ0KCksXG4gICAgcGFyYW1ldGVyOiBwYXJ0cy5qb2luKCcgJylcbiAgfTtcbn07XG4vLyBHZW5lcmF0ZSBhPXJ0Y3AtZmIgbGluZXMgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3IgUlRDUnRwQ29kZWNQYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdGNwRmIgPSBmdW5jdGlvbihjb2RlYykge1xuICB2YXIgbGluZXMgPSAnJztcbiAgdmFyIHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICBpZiAoY29kZWMucnRjcEZlZWRiYWNrICYmIGNvZGVjLnJ0Y3BGZWVkYmFjay5sZW5ndGgpIHtcbiAgICAvLyBGSVhNRTogc3BlY2lhbCBoYW5kbGluZyBmb3IgdHJyLWludD9cbiAgICBjb2RlYy5ydGNwRmVlZGJhY2suZm9yRWFjaChmdW5jdGlvbihmYikge1xuICAgICAgbGluZXMgKz0gJ2E9cnRjcC1mYjonICsgcHQgKyAnICcgKyBmYi50eXBlICtcbiAgICAgIChmYi5wYXJhbWV0ZXIgJiYgZmIucGFyYW1ldGVyLmxlbmd0aCA/ICcgJyArIGZiLnBhcmFtZXRlciA6ICcnKSArXG4gICAgICAgICAgJ1xcclxcbic7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIGxpbmVzO1xufTtcblxuLy8gUGFyc2VzIGFuIFJGQyA1NTc2IHNzcmMgbWVkaWEgYXR0cmlidXRlLiBTYW1wbGUgaW5wdXQ6XG4vLyBhPXNzcmM6MzczNTkyODU1OSBjbmFtZTpzb21ldGhpbmdcblNEUFV0aWxzLnBhcnNlU3NyY01lZGlhID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgc3AgPSBsaW5lLmluZGV4T2YoJyAnKTtcbiAgdmFyIHBhcnRzID0ge1xuICAgIHNzcmM6IHBhcnNlSW50KGxpbmUuc3Vic3RyKDcsIHNwIC0gNyksIDEwKVxuICB9O1xuICB2YXIgY29sb24gPSBsaW5lLmluZGV4T2YoJzonLCBzcCk7XG4gIGlmIChjb2xvbiA+IC0xKSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHIoc3AgKyAxLCBjb2xvbiAtIHNwIC0gMSk7XG4gICAgcGFydHMudmFsdWUgPSBsaW5lLnN1YnN0cihjb2xvbiArIDEpO1xuICB9IGVsc2Uge1xuICAgIHBhcnRzLmF0dHJpYnV0ZSA9IGxpbmUuc3Vic3RyKHNwICsgMSk7XG4gIH1cbiAgcmV0dXJuIHBhcnRzO1xufTtcblxuLy8gRXh0cmFjdHMgdGhlIE1JRCAoUkZDIDU4ODgpIGZyb20gYSBtZWRpYSBzZWN0aW9uLlxuLy8gcmV0dXJucyB0aGUgTUlEIG9yIHVuZGVmaW5lZCBpZiBubyBtaWQgbGluZSB3YXMgZm91bmQuXG5TRFBVdGlscy5nZXRNaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIG1pZCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bWlkOicpWzBdO1xuICBpZiAobWlkKSB7XG4gICAgcmV0dXJuIG1pZC5zdWJzdHIoNik7XG4gIH1cbn1cblxuU0RQVXRpbHMucGFyc2VGaW5nZXJwcmludCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIoMTQpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgYWxnb3JpdGhtOiBwYXJ0c1swXS50b0xvd2VyQ2FzZSgpLCAvLyBhbGdvcml0aG0gaXMgY2FzZS1zZW5zaXRpdmUgaW4gRWRnZS5cbiAgICB2YWx1ZTogcGFydHNbMV1cbiAgfTtcbn07XG5cbi8vIEV4dHJhY3RzIERUTFMgcGFyYW1ldGVycyBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgZmluZ2VycHJpbnQgbGluZSBhcyBpbnB1dC4gU2VlIGFsc28gZ2V0SWNlUGFyYW1ldGVycy5cblNEUFV0aWxzLmdldER0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICB2YXIgbGluZXMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24gKyBzZXNzaW9ucGFydCxcbiAgICAgICdhPWZpbmdlcnByaW50OicpO1xuICAvLyBOb3RlOiBhPXNldHVwIGxpbmUgaXMgaWdub3JlZCBzaW5jZSB3ZSB1c2UgdGhlICdhdXRvJyByb2xlLlxuICAvLyBOb3RlMjogJ2FsZ29yaXRobScgaXMgbm90IGNhc2Ugc2Vuc2l0aXZlIGV4Y2VwdCBpbiBFZGdlLlxuICByZXR1cm4ge1xuICAgIHJvbGU6ICdhdXRvJyxcbiAgICBmaW5nZXJwcmludHM6IGxpbmVzLm1hcChTRFBVdGlscy5wYXJzZUZpbmdlcnByaW50KVxuICB9O1xufTtcblxuLy8gU2VyaWFsaXplcyBEVExTIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVEdGxzUGFyYW1ldGVycyA9IGZ1bmN0aW9uKHBhcmFtcywgc2V0dXBUeXBlKSB7XG4gIHZhciBzZHAgPSAnYT1zZXR1cDonICsgc2V0dXBUeXBlICsgJ1xcclxcbic7XG4gIHBhcmFtcy5maW5nZXJwcmludHMuZm9yRWFjaChmdW5jdGlvbihmcCkge1xuICAgIHNkcCArPSAnYT1maW5nZXJwcmludDonICsgZnAuYWxnb3JpdGhtICsgJyAnICsgZnAudmFsdWUgKyAnXFxyXFxuJztcbiAgfSk7XG4gIHJldHVybiBzZHA7XG59O1xuLy8gUGFyc2VzIElDRSBpbmZvcm1hdGlvbiBmcm9tIFNEUCBtZWRpYSBzZWN0aW9uIG9yIHNlc3Npb25wYXJ0LlxuLy8gRklYTUU6IGZvciBjb25zaXN0ZW5jeSB3aXRoIG90aGVyIGZ1bmN0aW9ucyB0aGlzIHNob3VsZCBvbmx5XG4vLyAgIGdldCB0aGUgaWNlLXVmcmFnIGFuZCBpY2UtcHdkIGxpbmVzIGFzIGlucHV0LlxuU0RQVXRpbHMuZ2V0SWNlUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpIHtcbiAgdmFyIGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICAvLyBTZWFyY2ggaW4gc2Vzc2lvbiBwYXJ0LCB0b28uXG4gIGxpbmVzID0gbGluZXMuY29uY2F0KFNEUFV0aWxzLnNwbGl0TGluZXMoc2Vzc2lvbnBhcnQpKTtcbiAgdmFyIGljZVBhcmFtZXRlcnMgPSB7XG4gICAgdXNlcm5hbWVGcmFnbWVudDogbGluZXMuZmlsdGVyKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHJldHVybiBsaW5lLmluZGV4T2YoJ2E9aWNlLXVmcmFnOicpID09PSAwO1xuICAgIH0pWzBdLnN1YnN0cigxMiksXG4gICAgcGFzc3dvcmQ6IGxpbmVzLmZpbHRlcihmdW5jdGlvbihsaW5lKSB7XG4gICAgICByZXR1cm4gbGluZS5pbmRleE9mKCdhPWljZS1wd2Q6JykgPT09IDA7XG4gICAgfSlbMF0uc3Vic3RyKDEwKVxuICB9O1xuICByZXR1cm4gaWNlUGFyYW1ldGVycztcbn07XG5cbi8vIFNlcmlhbGl6ZXMgSUNFIHBhcmFtZXRlcnMgdG8gU0RQLlxuU0RQVXRpbHMud3JpdGVJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zKSB7XG4gIHJldHVybiAnYT1pY2UtdWZyYWc6JyArIHBhcmFtcy51c2VybmFtZUZyYWdtZW50ICsgJ1xcclxcbicgK1xuICAgICAgJ2E9aWNlLXB3ZDonICsgcGFyYW1zLnBhc3N3b3JkICsgJ1xcclxcbic7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIFJUQ1J0cFBhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIGRlc2NyaXB0aW9uID0ge1xuICAgIGNvZGVjczogW10sXG4gICAgaGVhZGVyRXh0ZW5zaW9uczogW10sXG4gICAgZmVjTWVjaGFuaXNtczogW10sXG4gICAgcnRjcDogW11cbiAgfTtcbiAgdmFyIGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICB2YXIgbWxpbmUgPSBsaW5lc1swXS5zcGxpdCgnICcpO1xuICBmb3IgKHZhciBpID0gMzsgaSA8IG1saW5lLmxlbmd0aDsgaSsrKSB7IC8vIGZpbmQgYWxsIGNvZGVjcyBmcm9tIG1saW5lWzMuLl1cbiAgICB2YXIgcHQgPSBtbGluZVtpXTtcbiAgICB2YXIgcnRwbWFwbGluZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICBtZWRpYVNlY3Rpb24sICdhPXJ0cG1hcDonICsgcHQgKyAnICcpWzBdO1xuICAgIGlmIChydHBtYXBsaW5lKSB7XG4gICAgICB2YXIgY29kZWMgPSBTRFBVdGlscy5wYXJzZVJ0cE1hcChydHBtYXBsaW5lKTtcbiAgICAgIHZhciBmbXRwcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9Zm10cDonICsgcHQgKyAnICcpO1xuICAgICAgLy8gT25seSB0aGUgZmlyc3QgYT1mbXRwOjxwdD4gaXMgY29uc2lkZXJlZC5cbiAgICAgIGNvZGVjLnBhcmFtZXRlcnMgPSBmbXRwcy5sZW5ndGggPyBTRFBVdGlscy5wYXJzZUZtdHAoZm10cHNbMF0pIDoge307XG4gICAgICBjb2RlYy5ydGNwRmVlZGJhY2sgPSBTRFBVdGlscy5tYXRjaFByZWZpeChcbiAgICAgICAgICBtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtZmI6JyArIHB0ICsgJyAnKVxuICAgICAgICAubWFwKFNEUFV0aWxzLnBhcnNlUnRjcEZiKTtcbiAgICAgIGRlc2NyaXB0aW9uLmNvZGVjcy5wdXNoKGNvZGVjKTtcbiAgICAgIC8vIHBhcnNlIEZFQyBtZWNoYW5pc21zIGZyb20gcnRwbWFwIGxpbmVzLlxuICAgICAgc3dpdGNoIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpIHtcbiAgICAgICAgY2FzZSAnUkVEJzpcbiAgICAgICAgY2FzZSAnVUxQRkVDJzpcbiAgICAgICAgICBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLnB1c2goY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpKTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDogLy8gb25seSBSRUQgYW5kIFVMUEZFQyBhcmUgcmVjb2duaXplZCBhcyBGRUMgbWVjaGFuaXNtcy5cbiAgICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1leHRtYXA6JykuZm9yRWFjaChmdW5jdGlvbihsaW5lKSB7XG4gICAgZGVzY3JpcHRpb24uaGVhZGVyRXh0ZW5zaW9ucy5wdXNoKFNEUFV0aWxzLnBhcnNlRXh0bWFwKGxpbmUpKTtcbiAgfSk7XG4gIC8vIEZJWE1FOiBwYXJzZSBydGNwLlxuICByZXR1cm4gZGVzY3JpcHRpb247XG59O1xuXG4vLyBHZW5lcmF0ZXMgcGFydHMgb2YgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGRlc2NyaWJpbmcgdGhlIGNhcGFiaWxpdGllcyAvXG4vLyBwYXJhbWV0ZXJzLlxuU0RQVXRpbHMud3JpdGVSdHBEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGtpbmQsIGNhcHMpIHtcbiAgdmFyIHNkcCA9ICcnO1xuXG4gIC8vIEJ1aWxkIHRoZSBtbGluZS5cbiAgc2RwICs9ICdtPScgKyBraW5kICsgJyAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubGVuZ3RoID4gMCA/ICc5JyA6ICcwJzsgLy8gcmVqZWN0IGlmIG5vIGNvZGVjcy5cbiAgc2RwICs9ICcgVURQL1RMUy9SVFAvU0FWUEYgJztcbiAgc2RwICs9IGNhcHMuY29kZWNzLm1hcChmdW5jdGlvbihjb2RlYykge1xuICAgIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gY29kZWMucHJlZmVycmVkUGF5bG9hZFR5cGU7XG4gICAgfVxuICAgIHJldHVybiBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgfSkuam9pbignICcpICsgJ1xcclxcbic7XG5cbiAgc2RwICs9ICdjPUlOIElQNCAwLjAuMC4wXFxyXFxuJztcbiAgc2RwICs9ICdhPXJ0Y3A6OSBJTiBJUDQgMC4wLjAuMFxcclxcbic7XG5cbiAgLy8gQWRkIGE9cnRwbWFwIGxpbmVzIGZvciBlYWNoIGNvZGVjLiBBbHNvIGZtdHAgYW5kIHJ0Y3AtZmIuXG4gIGNhcHMuY29kZWNzLmZvckVhY2goZnVuY3Rpb24oY29kZWMpIHtcbiAgICBzZHAgKz0gU0RQVXRpbHMud3JpdGVSdHBNYXAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUZtdHAoY29kZWMpO1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0Y3BGYihjb2RlYyk7XG4gIH0pO1xuICB2YXIgbWF4cHRpbWUgPSAwO1xuICBjYXBzLmNvZGVjcy5mb3JFYWNoKGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgaWYgKGNvZGVjLm1heHB0aW1lID4gbWF4cHRpbWUpIHtcbiAgICAgIG1heHB0aW1lID0gY29kZWMubWF4cHRpbWU7XG4gICAgfVxuICB9KTtcbiAgaWYgKG1heHB0aW1lID4gMCkge1xuICAgIHNkcCArPSAnYT1tYXhwdGltZTonICsgbWF4cHRpbWUgKyAnXFxyXFxuJztcbiAgfVxuICBzZHAgKz0gJ2E9cnRjcC1tdXhcXHJcXG4nO1xuXG4gIGlmIChjYXBzLmhlYWRlckV4dGVuc2lvbnMpIHtcbiAgICBjYXBzLmhlYWRlckV4dGVuc2lvbnMuZm9yRWFjaChmdW5jdGlvbihleHRlbnNpb24pIHtcbiAgICAgIHNkcCArPSBTRFBVdGlscy53cml0ZUV4dG1hcChleHRlbnNpb24pO1xuICAgIH0pO1xuICB9XG4gIC8vIEZJWE1FOiB3cml0ZSBmZWNNZWNoYW5pc21zLlxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gUGFyc2VzIHRoZSBTRFAgbWVkaWEgc2VjdGlvbiBhbmQgcmV0dXJucyBhbiBhcnJheSBvZlxuLy8gUlRDUnRwRW5jb2RpbmdQYXJhbWV0ZXJzLlxuU0RQVXRpbHMucGFyc2VSdHBFbmNvZGluZ1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIGVuY29kaW5nUGFyYW1ldGVycyA9IFtdO1xuICB2YXIgZGVzY3JpcHRpb24gPSBTRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcbiAgdmFyIGhhc1JlZCA9IGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMuaW5kZXhPZignUkVEJykgIT09IC0xO1xuICB2YXIgaGFzVWxwZmVjID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdVTFBGRUMnKSAhPT0gLTE7XG5cbiAgLy8gZmlsdGVyIGE9c3NyYzouLi4gY25hbWU6LCBpZ25vcmUgUGxhbkItbXNpZFxuICB2YXIgc3NyY3MgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgcmV0dXJuIFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpO1xuICB9KVxuICAuZmlsdGVyKGZ1bmN0aW9uKHBhcnRzKSB7XG4gICAgcmV0dXJuIHBhcnRzLmF0dHJpYnV0ZSA9PT0gJ2NuYW1lJztcbiAgfSk7XG4gIHZhciBwcmltYXJ5U3NyYyA9IHNzcmNzLmxlbmd0aCA+IDAgJiYgc3NyY3NbMF0uc3NyYztcbiAgdmFyIHNlY29uZGFyeVNzcmM7XG5cbiAgdmFyIGZsb3dzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjLWdyb3VwOkZJRCcpXG4gIC5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKDE3KS5zcGxpdCgnICcpO1xuICAgIHJldHVybiBwYXJ0cy5tYXAoZnVuY3Rpb24ocGFydCkge1xuICAgICAgcmV0dXJuIHBhcnNlSW50KHBhcnQsIDEwKTtcbiAgICB9KTtcbiAgfSk7XG4gIGlmIChmbG93cy5sZW5ndGggPiAwICYmIGZsb3dzWzBdLmxlbmd0aCA+IDEgJiYgZmxvd3NbMF1bMF0gPT09IHByaW1hcnlTc3JjKSB7XG4gICAgc2Vjb25kYXJ5U3NyYyA9IGZsb3dzWzBdWzFdO1xuICB9XG5cbiAgZGVzY3JpcHRpb24uY29kZWNzLmZvckVhY2goZnVuY3Rpb24oY29kZWMpIHtcbiAgICBpZiAoY29kZWMubmFtZS50b1VwcGVyQ2FzZSgpID09PSAnUlRYJyAmJiBjb2RlYy5wYXJhbWV0ZXJzLmFwdCkge1xuICAgICAgdmFyIGVuY1BhcmFtID0ge1xuICAgICAgICBzc3JjOiBwcmltYXJ5U3NyYyxcbiAgICAgICAgY29kZWNQYXlsb2FkVHlwZTogcGFyc2VJbnQoY29kZWMucGFyYW1ldGVycy5hcHQsIDEwKSxcbiAgICAgIH07XG4gICAgICBpZiAocHJpbWFyeVNzcmMgJiYgc2Vjb25kYXJ5U3NyYykge1xuICAgICAgICBlbmNQYXJhbS5ydHggPSB7c3NyYzogc2Vjb25kYXJ5U3NyY307XG4gICAgICB9XG4gICAgICBlbmNvZGluZ1BhcmFtZXRlcnMucHVzaChlbmNQYXJhbSk7XG4gICAgICBpZiAoaGFzUmVkKSB7XG4gICAgICAgIGVuY1BhcmFtID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShlbmNQYXJhbSkpO1xuICAgICAgICBlbmNQYXJhbS5mZWMgPSB7XG4gICAgICAgICAgc3NyYzogc2Vjb25kYXJ5U3NyYyxcbiAgICAgICAgICBtZWNoYW5pc206IGhhc1VscGZlYyA/ICdyZWQrdWxwZmVjJyA6ICdyZWQnXG4gICAgICAgIH07XG4gICAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICBpZiAoZW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCA9PT0gMCAmJiBwcmltYXJ5U3NyYykge1xuICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKHtcbiAgICAgIHNzcmM6IHByaW1hcnlTc3JjXG4gICAgfSk7XG4gIH1cblxuICAvLyB3ZSBzdXBwb3J0IGJvdGggYj1BUyBhbmQgYj1USUFTIGJ1dCBpbnRlcnByZXQgQVMgYXMgVElBUy5cbiAgdmFyIGJhbmR3aWR0aCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2I9Jyk7XG4gIGlmIChiYW5kd2lkdGgubGVuZ3RoKSB7XG4gICAgaWYgKGJhbmR3aWR0aFswXS5pbmRleE9mKCdiPVRJQVM6JykgPT09IDApIHtcbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHIoNyksIDEwKTtcbiAgICB9IGVsc2UgaWYgKGJhbmR3aWR0aFswXS5pbmRleE9mKCdiPUFTOicpID09PSAwKSB7XG4gICAgICAvLyB1c2UgZm9ybXVsYSBmcm9tIEpTRVAgdG8gY29udmVydCBiPUFTIHRvIFRJQVMgdmFsdWUuXG4gICAgICBiYW5kd2lkdGggPSBwYXJzZUludChiYW5kd2lkdGhbMF0uc3Vic3RyKDUpLCAxMCkgKiAxMDAwICogMC45NVxuICAgICAgICAgIC0gKDUwICogNDAgKiA4KTtcbiAgICB9IGVsc2Uge1xuICAgICAgYmFuZHdpZHRoID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBlbmNvZGluZ1BhcmFtZXRlcnMuZm9yRWFjaChmdW5jdGlvbihwYXJhbXMpIHtcbiAgICAgIHBhcmFtcy5tYXhCaXRyYXRlID0gYmFuZHdpZHRoO1xuICAgIH0pO1xuICB9XG4gIHJldHVybiBlbmNvZGluZ1BhcmFtZXRlcnM7XG59O1xuXG4vLyBwYXJzZXMgaHR0cDovL2RyYWZ0Lm9ydGMub3JnLyNydGNydGNwcGFyYW1ldGVycypcblNEUFV0aWxzLnBhcnNlUnRjcFBhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIHJ0Y3BQYXJhbWV0ZXJzID0ge307XG5cbiAgdmFyIGNuYW1lO1xuICAvLyBHZXRzIHRoZSBmaXJzdCBTU1JDLiBOb3RlIHRoYXQgd2l0aCBSVFggdGhlcmUgbWlnaHQgYmUgbXVsdGlwbGVcbiAgLy8gU1NSQ3MuXG4gIHZhciByZW1vdGVTc3JjID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gICAgICAubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgICAgcmV0dXJuIFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpO1xuICAgICAgfSlcbiAgICAgIC5maWx0ZXIoZnVuY3Rpb24ob2JqKSB7XG4gICAgICAgIHJldHVybiBvYmouYXR0cmlidXRlID09PSAnY25hbWUnO1xuICAgICAgfSlbMF07XG4gIGlmIChyZW1vdGVTc3JjKSB7XG4gICAgcnRjcFBhcmFtZXRlcnMuY25hbWUgPSByZW1vdGVTc3JjLnZhbHVlO1xuICAgIHJ0Y3BQYXJhbWV0ZXJzLnNzcmMgPSByZW1vdGVTc3JjLnNzcmM7XG4gIH1cblxuICAvLyBFZGdlIHVzZXMgdGhlIGNvbXBvdW5kIGF0dHJpYnV0ZSBpbnN0ZWFkIG9mIHJlZHVjZWRTaXplXG4gIC8vIGNvbXBvdW5kIGlzICFyZWR1Y2VkU2l6ZVxuICB2YXIgcnNpemUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtcnNpemUnKTtcbiAgcnRjcFBhcmFtZXRlcnMucmVkdWNlZFNpemUgPSByc2l6ZS5sZW5ndGggPiAwO1xuICBydGNwUGFyYW1ldGVycy5jb21wb3VuZCA9IHJzaXplLmxlbmd0aCA9PT0gMDtcblxuICAvLyBwYXJzZXMgdGhlIHJ0Y3AtbXV4IGF0dHLRlmJ1dGUuXG4gIC8vIE5vdGUgdGhhdCBFZGdlIGRvZXMgbm90IHN1cHBvcnQgdW5tdXhlZCBSVENQLlxuICB2YXIgbXV4ID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1ydGNwLW11eCcpO1xuICBydGNwUGFyYW1ldGVycy5tdXggPSBtdXgubGVuZ3RoID4gMDtcblxuICByZXR1cm4gcnRjcFBhcmFtZXRlcnM7XG59O1xuXG4vLyBwYXJzZXMgZWl0aGVyIGE9bXNpZDogb3IgYT1zc3JjOi4uLiBtc2lkIGxpbmVzIGFuZCByZXR1cm5zXG4vLyB0aGUgaWQgb2YgdGhlIE1lZGlhU3RyZWFtIGFuZCBNZWRpYVN0cmVhbVRyYWNrLlxuU0RQVXRpbHMucGFyc2VNc2lkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBwYXJ0cztcbiAgdmFyIHNwZWMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPW1zaWQ6Jyk7XG4gIGlmIChzcGVjLmxlbmd0aCA9PT0gMSkge1xuICAgIHBhcnRzID0gc3BlY1swXS5zdWJzdHIoNykuc3BsaXQoJyAnKTtcbiAgICByZXR1cm4ge3N0cmVhbTogcGFydHNbMF0sIHRyYWNrOiBwYXJ0c1sxXX07XG4gIH1cbiAgdmFyIHBsYW5CID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1zc3JjOicpXG4gIC5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgIHJldHVybiBTRFBVdGlscy5wYXJzZVNzcmNNZWRpYShsaW5lKTtcbiAgfSlcbiAgLmZpbHRlcihmdW5jdGlvbihwYXJ0cykge1xuICAgIHJldHVybiBwYXJ0cy5hdHRyaWJ1dGUgPT09ICdtc2lkJztcbiAgfSk7XG4gIGlmIChwbGFuQi5sZW5ndGggPiAwKSB7XG4gICAgcGFydHMgPSBwbGFuQlswXS52YWx1ZS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxufTtcblxuLy8gR2VuZXJhdGUgYSBzZXNzaW9uIElEIGZvciBTRFAuXG4vLyBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvZHJhZnQtaWV0Zi1ydGN3ZWItanNlcC0yMCNzZWN0aW9uLTUuMi4xXG4vLyByZWNvbW1lbmRzIHVzaW5nIGEgY3J5cHRvZ3JhcGhpY2FsbHkgcmFuZG9tICt2ZSA2NC1iaXQgdmFsdWVcbi8vIGJ1dCByaWdodCBub3cgdGhpcyBzaG91bGQgYmUgYWNjZXB0YWJsZSBhbmQgd2l0aGluIHRoZSByaWdodCByYW5nZVxuU0RQVXRpbHMuZ2VuZXJhdGVTZXNzaW9uSWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIE1hdGgucmFuZG9tKCkudG9TdHJpbmcoKS5zdWJzdHIoMiwgMjEpO1xufTtcblxuLy8gV3JpdGUgYm9pbGRlciBwbGF0ZSBmb3Igc3RhcnQgb2YgU0RQXG4vLyBzZXNzSWQgYXJndW1lbnQgaXMgb3B0aW9uYWwgLSBpZiBub3Qgc3VwcGxpZWQgaXQgd2lsbFxuLy8gYmUgZ2VuZXJhdGVkIHJhbmRvbWx5XG4vLyBzZXNzVmVyc2lvbiBpcyBvcHRpb25hbCBhbmQgZGVmYXVsdHMgdG8gMlxuU0RQVXRpbHMud3JpdGVTZXNzaW9uQm9pbGVycGxhdGUgPSBmdW5jdGlvbihzZXNzSWQsIHNlc3NWZXIpIHtcbiAgdmFyIHNlc3Npb25JZDtcbiAgdmFyIHZlcnNpb24gPSBzZXNzVmVyICE9PSB1bmRlZmluZWQgPyBzZXNzVmVyIDogMjtcbiAgaWYgKHNlc3NJZCkge1xuICAgIHNlc3Npb25JZCA9IHNlc3NJZDtcbiAgfSBlbHNlIHtcbiAgICBzZXNzaW9uSWQgPSBTRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCgpO1xuICB9XG4gIC8vIEZJWE1FOiBzZXNzLWlkIHNob3VsZCBiZSBhbiBOVFAgdGltZXN0YW1wLlxuICByZXR1cm4gJ3Y9MFxcclxcbicgK1xuICAgICAgJ289dGhpc2lzYWRhcHRlcm9ydGMgJyArIHNlc3Npb25JZCArICcgJyArIHZlcnNpb24gKyAnIElOIElQNCAxMjcuMC4wLjFcXHJcXG4nICtcbiAgICAgICdzPS1cXHJcXG4nICtcbiAgICAgICd0PTAgMFxcclxcbic7XG59O1xuXG5TRFBVdGlscy53cml0ZU1lZGlhU2VjdGlvbiA9IGZ1bmN0aW9uKHRyYW5zY2VpdmVyLCBjYXBzLCB0eXBlLCBzdHJlYW0pIHtcbiAgdmFyIHNkcCA9IFNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24odHJhbnNjZWl2ZXIua2luZCwgY2Fwcyk7XG5cbiAgLy8gTWFwIElDRSBwYXJhbWV0ZXJzICh1ZnJhZywgcHdkKSB0byBTRFAuXG4gIHNkcCArPSBTRFBVdGlscy53cml0ZUljZVBhcmFtZXRlcnMoXG4gICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlci5nZXRMb2NhbFBhcmFtZXRlcnMoKSk7XG5cbiAgLy8gTWFwIERUTFMgcGFyYW1ldGVycyB0byBTRFAuXG4gIHNkcCArPSBTRFBVdGlscy53cml0ZUR0bHNQYXJhbWV0ZXJzKFxuICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydC5nZXRMb2NhbFBhcmFtZXRlcnMoKSxcbiAgICAgIHR5cGUgPT09ICdvZmZlcicgPyAnYWN0cGFzcycgOiAnYWN0aXZlJyk7XG5cbiAgc2RwICs9ICdhPW1pZDonICsgdHJhbnNjZWl2ZXIubWlkICsgJ1xcclxcbic7XG5cbiAgaWYgKHRyYW5zY2VpdmVyLmRpcmVjdGlvbikge1xuICAgIHNkcCArPSAnYT0nICsgdHJhbnNjZWl2ZXIuZGlyZWN0aW9uICsgJ1xcclxcbic7XG4gIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyICYmIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyKSB7XG4gICAgc2RwICs9ICdhPXNlbmRyZWN2XFxyXFxuJztcbiAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIpIHtcbiAgICBzZHAgKz0gJ2E9c2VuZG9ubHlcXHJcXG4nO1xuICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyKSB7XG4gICAgc2RwICs9ICdhPXJlY3Zvbmx5XFxyXFxuJztcbiAgfSBlbHNlIHtcbiAgICBzZHAgKz0gJ2E9aW5hY3RpdmVcXHJcXG4nO1xuICB9XG5cbiAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlcikge1xuICAgIC8vIHNwZWMuXG4gICAgdmFyIG1zaWQgPSAnbXNpZDonICsgc3RyZWFtLmlkICsgJyAnICtcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLnRyYWNrLmlkICsgJ1xcclxcbic7XG4gICAgc2RwICs9ICdhPScgKyBtc2lkO1xuXG4gICAgLy8gZm9yIENocm9tZS5cbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICtcbiAgICAgICAgJyAnICsgbXNpZDtcbiAgICBpZiAodHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICAgIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eC5zc3JjICtcbiAgICAgICAgICAnICcgKyBtc2lkO1xuICAgICAgc2RwICs9ICdhPXNzcmMtZ3JvdXA6RklEICcgK1xuICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArICcgJyArXG4gICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHguc3NyYyArXG4gICAgICAgICAgJ1xcclxcbic7XG4gICAgfVxuICB9XG4gIC8vIEZJWE1FOiB0aGlzIHNob3VsZCBiZSB3cml0dGVuIGJ5IHdyaXRlUnRwRGVzY3JpcHRpb24uXG4gIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgK1xuICAgICAgJyBjbmFtZTonICsgU0RQVXRpbHMubG9jYWxDTmFtZSArICdcXHJcXG4nO1xuICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyICYmIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4LnNzcmMgK1xuICAgICAgICAnIGNuYW1lOicgKyBTRFBVdGlscy5sb2NhbENOYW1lICsgJ1xcclxcbic7XG4gIH1cbiAgcmV0dXJuIHNkcDtcbn07XG5cbi8vIEdldHMgdGhlIGRpcmVjdGlvbiBmcm9tIHRoZSBtZWRpYVNlY3Rpb24gb3IgdGhlIHNlc3Npb25wYXJ0LlxuU0RQVXRpbHMuZ2V0RGlyZWN0aW9uID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICAvLyBMb29rIGZvciBzZW5kcmVjdiwgc2VuZG9ubHksIHJlY3Zvbmx5LCBpbmFjdGl2ZSwgZGVmYXVsdCB0byBzZW5kcmVjdi5cbiAgdmFyIGxpbmVzID0gU0RQVXRpbHMuc3BsaXRMaW5lcyhtZWRpYVNlY3Rpb24pO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxpbmVzLmxlbmd0aDsgaSsrKSB7XG4gICAgc3dpdGNoIChsaW5lc1tpXSkge1xuICAgICAgY2FzZSAnYT1zZW5kcmVjdic6XG4gICAgICBjYXNlICdhPXNlbmRvbmx5JzpcbiAgICAgIGNhc2UgJ2E9cmVjdm9ubHknOlxuICAgICAgY2FzZSAnYT1pbmFjdGl2ZSc6XG4gICAgICAgIHJldHVybiBsaW5lc1tpXS5zdWJzdHIoMik7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICAvLyBGSVhNRTogV2hhdCBzaG91bGQgaGFwcGVuIGhlcmU/XG4gICAgfVxuICB9XG4gIGlmIChzZXNzaW9ucGFydCkge1xuICAgIHJldHVybiBTRFBVdGlscy5nZXREaXJlY3Rpb24oc2Vzc2lvbnBhcnQpO1xuICB9XG4gIHJldHVybiAnc2VuZHJlY3YnO1xufTtcblxuU0RQVXRpbHMuZ2V0S2luZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIHZhciBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIHJldHVybiBtbGluZVswXS5zdWJzdHIoMik7XG59O1xuXG5TRFBVdGlscy5pc1JlamVjdGVkID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHJldHVybiBtZWRpYVNlY3Rpb24uc3BsaXQoJyAnLCAyKVsxXSA9PT0gJzAnO1xufTtcblxuU0RQVXRpbHMucGFyc2VNTGluZSA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIHZhciBwYXJ0cyA9IGxpbmVzWzBdLnN1YnN0cigyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIGtpbmQ6IHBhcnRzWzBdLFxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzFdLCAxMCksXG4gICAgcHJvdG9jb2w6IHBhcnRzWzJdLFxuICAgIGZtdDogcGFydHMuc2xpY2UoMykuam9pbignICcpXG4gIH07XG59O1xuXG5TRFBVdGlscy5wYXJzZU9MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnbz0nKVswXTtcbiAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIoMikuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICB1c2VybmFtZTogcGFydHNbMF0sXG4gICAgc2Vzc2lvbklkOiBwYXJ0c1sxXSxcbiAgICBzZXNzaW9uVmVyc2lvbjogcGFyc2VJbnQocGFydHNbMl0sIDEwKSxcbiAgICBuZXRUeXBlOiBwYXJ0c1szXSxcbiAgICBhZGRyZXNzVHlwZTogcGFydHNbNF0sXG4gICAgYWRkcmVzczogcGFydHNbNV0sXG4gIH07XG59XG5cbi8vIEV4cG9zZSBwdWJsaWMgbWV0aG9kcy5cbmlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFNEUFV0aWxzO1xufVxuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIGFkYXB0ZXJGYWN0b3J5ID0gcmVxdWlyZSgnLi9hZGFwdGVyX2ZhY3RvcnkuanMnKTtcbm1vZHVsZS5leHBvcnRzID0gYWRhcHRlckZhY3Rvcnkoe3dpbmRvdzogZ2xvYmFsLndpbmRvd30pO1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xuLy8gU2hpbW1pbmcgc3RhcnRzIGhlcmUuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGRlcGVuZGVuY2llcywgb3B0cykge1xuICB2YXIgd2luZG93ID0gZGVwZW5kZW5jaWVzICYmIGRlcGVuZGVuY2llcy53aW5kb3c7XG5cbiAgdmFyIG9wdGlvbnMgPSB7XG4gICAgc2hpbUNocm9tZTogdHJ1ZSxcbiAgICBzaGltRmlyZWZveDogdHJ1ZSxcbiAgICBzaGltRWRnZTogdHJ1ZSxcbiAgICBzaGltU2FmYXJpOiB0cnVlLFxuICB9O1xuXG4gIGZvciAodmFyIGtleSBpbiBvcHRzKSB7XG4gICAgaWYgKGhhc093blByb3BlcnR5LmNhbGwob3B0cywga2V5KSkge1xuICAgICAgb3B0aW9uc1trZXldID0gb3B0c1trZXldO1xuICAgIH1cbiAgfVxuXG4gIC8vIFV0aWxzLlxuICB2YXIgbG9nZ2luZyA9IHV0aWxzLmxvZztcbiAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuXG4gIC8vIFVuY29tbWVudCB0aGUgbGluZSBiZWxvdyBpZiB5b3Ugd2FudCBsb2dnaW5nIHRvIG9jY3VyLCBpbmNsdWRpbmcgbG9nZ2luZ1xuICAvLyBmb3IgdGhlIHN3aXRjaCBzdGF0ZW1lbnQgYmVsb3cuIENhbiBhbHNvIGJlIHR1cm5lZCBvbiBpbiB0aGUgYnJvd3NlciB2aWFcbiAgLy8gYWRhcHRlci5kaXNhYmxlTG9nKGZhbHNlKSwgYnV0IHRoZW4gbG9nZ2luZyBmcm9tIHRoZSBzd2l0Y2ggc3RhdGVtZW50IGJlbG93XG4gIC8vIHdpbGwgbm90IGFwcGVhci5cbiAgLy8gcmVxdWlyZSgnLi91dGlscycpLmRpc2FibGVMb2coZmFsc2UpO1xuXG4gIC8vIEJyb3dzZXIgc2hpbXMuXG4gIHZhciBjaHJvbWVTaGltID0gcmVxdWlyZSgnLi9jaHJvbWUvY2hyb21lX3NoaW0nKSB8fCBudWxsO1xuICB2YXIgZWRnZVNoaW0gPSByZXF1aXJlKCcuL2VkZ2UvZWRnZV9zaGltJykgfHwgbnVsbDtcbiAgdmFyIGZpcmVmb3hTaGltID0gcmVxdWlyZSgnLi9maXJlZm94L2ZpcmVmb3hfc2hpbScpIHx8IG51bGw7XG4gIHZhciBzYWZhcmlTaGltID0gcmVxdWlyZSgnLi9zYWZhcmkvc2FmYXJpX3NoaW0nKSB8fCBudWxsO1xuICB2YXIgY29tbW9uU2hpbSA9IHJlcXVpcmUoJy4vY29tbW9uX3NoaW0nKSB8fCBudWxsO1xuXG4gIC8vIEV4cG9ydCB0byB0aGUgYWRhcHRlciBnbG9iYWwgb2JqZWN0IHZpc2libGUgaW4gdGhlIGJyb3dzZXIuXG4gIHZhciBhZGFwdGVyID0ge1xuICAgIGJyb3dzZXJEZXRhaWxzOiBicm93c2VyRGV0YWlscyxcbiAgICBjb21tb25TaGltOiBjb21tb25TaGltLFxuICAgIGV4dHJhY3RWZXJzaW9uOiB1dGlscy5leHRyYWN0VmVyc2lvbixcbiAgICBkaXNhYmxlTG9nOiB1dGlscy5kaXNhYmxlTG9nLFxuICAgIGRpc2FibGVXYXJuaW5nczogdXRpbHMuZGlzYWJsZVdhcm5pbmdzXG4gIH07XG5cbiAgLy8gU2hpbSBicm93c2VyIGlmIGZvdW5kLlxuICBzd2l0Y2ggKGJyb3dzZXJEZXRhaWxzLmJyb3dzZXIpIHtcbiAgICBjYXNlICdjaHJvbWUnOlxuICAgICAgaWYgKCFjaHJvbWVTaGltIHx8ICFjaHJvbWVTaGltLnNoaW1QZWVyQ29ubmVjdGlvbiB8fFxuICAgICAgICAgICFvcHRpb25zLnNoaW1DaHJvbWUpIHtcbiAgICAgICAgbG9nZ2luZygnQ2hyb21lIHNoaW0gaXMgbm90IGluY2x1ZGVkIGluIHRoaXMgYWRhcHRlciByZWxlYXNlLicpO1xuICAgICAgICByZXR1cm4gYWRhcHRlcjtcbiAgICAgIH1cbiAgICAgIGxvZ2dpbmcoJ2FkYXB0ZXIuanMgc2hpbW1pbmcgY2hyb21lLicpO1xuICAgICAgLy8gRXhwb3J0IHRvIHRoZSBhZGFwdGVyIGdsb2JhbCBvYmplY3QgdmlzaWJsZSBpbiB0aGUgYnJvd3Nlci5cbiAgICAgIGFkYXB0ZXIuYnJvd3NlclNoaW0gPSBjaHJvbWVTaGltO1xuICAgICAgY29tbW9uU2hpbS5zaGltQ3JlYXRlT2JqZWN0VVJMKHdpbmRvdyk7XG5cbiAgICAgIGNocm9tZVNoaW0uc2hpbUdldFVzZXJNZWRpYSh3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltTWVkaWFTdHJlYW0od2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbVNvdXJjZU9iamVjdCh3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltUGVlckNvbm5lY3Rpb24od2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbU9uVHJhY2sod2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbUFkZFRyYWNrUmVtb3ZlVHJhY2sod2luZG93KTtcbiAgICAgIGNocm9tZVNoaW0uc2hpbUdldFNlbmRlcnNXaXRoRHRtZih3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltU2VuZGVyUmVjZWl2ZXJHZXRTdGF0cyh3aW5kb3cpO1xuXG4gICAgICBjb21tb25TaGltLnNoaW1SVENJY2VDYW5kaWRhdGUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbU1heE1lc3NhZ2VTaXplKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1TZW5kVGhyb3dUeXBlRXJyb3Iod2luZG93KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2ZpcmVmb3gnOlxuICAgICAgaWYgKCFmaXJlZm94U2hpbSB8fCAhZmlyZWZveFNoaW0uc2hpbVBlZXJDb25uZWN0aW9uIHx8XG4gICAgICAgICAgIW9wdGlvbnMuc2hpbUZpcmVmb3gpIHtcbiAgICAgICAgbG9nZ2luZygnRmlyZWZveCBzaGltIGlzIG5vdCBpbmNsdWRlZCBpbiB0aGlzIGFkYXB0ZXIgcmVsZWFzZS4nKTtcbiAgICAgICAgcmV0dXJuIGFkYXB0ZXI7XG4gICAgICB9XG4gICAgICBsb2dnaW5nKCdhZGFwdGVyLmpzIHNoaW1taW5nIGZpcmVmb3guJyk7XG4gICAgICAvLyBFeHBvcnQgdG8gdGhlIGFkYXB0ZXIgZ2xvYmFsIG9iamVjdCB2aXNpYmxlIGluIHRoZSBicm93c2VyLlxuICAgICAgYWRhcHRlci5icm93c2VyU2hpbSA9IGZpcmVmb3hTaGltO1xuICAgICAgY29tbW9uU2hpbS5zaGltQ3JlYXRlT2JqZWN0VVJMKHdpbmRvdyk7XG5cbiAgICAgIGZpcmVmb3hTaGltLnNoaW1HZXRVc2VyTWVkaWEod2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1Tb3VyY2VPYmplY3Qod2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1QZWVyQ29ubmVjdGlvbih3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbU9uVHJhY2sod2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1SZW1vdmVTdHJlYW0od2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1TZW5kZXJHZXRTdGF0cyh3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbVJlY2VpdmVyR2V0U3RhdHMod2luZG93KTtcbiAgICAgIGZpcmVmb3hTaGltLnNoaW1SVENEYXRhQ2hhbm5lbCh3aW5kb3cpO1xuXG4gICAgICBjb21tb25TaGltLnNoaW1SVENJY2VDYW5kaWRhdGUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbU1heE1lc3NhZ2VTaXplKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1TZW5kVGhyb3dUeXBlRXJyb3Iod2luZG93KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2VkZ2UnOlxuICAgICAgaWYgKCFlZGdlU2hpbSB8fCAhZWRnZVNoaW0uc2hpbVBlZXJDb25uZWN0aW9uIHx8ICFvcHRpb25zLnNoaW1FZGdlKSB7XG4gICAgICAgIGxvZ2dpbmcoJ01TIGVkZ2Ugc2hpbSBpcyBub3QgaW5jbHVkZWQgaW4gdGhpcyBhZGFwdGVyIHJlbGVhc2UuJyk7XG4gICAgICAgIHJldHVybiBhZGFwdGVyO1xuICAgICAgfVxuICAgICAgbG9nZ2luZygnYWRhcHRlci5qcyBzaGltbWluZyBlZGdlLicpO1xuICAgICAgLy8gRXhwb3J0IHRvIHRoZSBhZGFwdGVyIGdsb2JhbCBvYmplY3QgdmlzaWJsZSBpbiB0aGUgYnJvd3Nlci5cbiAgICAgIGFkYXB0ZXIuYnJvd3NlclNoaW0gPSBlZGdlU2hpbTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbUNyZWF0ZU9iamVjdFVSTCh3aW5kb3cpO1xuXG4gICAgICBlZGdlU2hpbS5zaGltR2V0VXNlck1lZGlhKHdpbmRvdyk7XG4gICAgICBlZGdlU2hpbS5zaGltUGVlckNvbm5lY3Rpb24od2luZG93KTtcbiAgICAgIGVkZ2VTaGltLnNoaW1SZXBsYWNlVHJhY2sod2luZG93KTtcblxuICAgICAgLy8gdGhlIGVkZ2Ugc2hpbSBpbXBsZW1lbnRzIHRoZSBmdWxsIFJUQ0ljZUNhbmRpZGF0ZSBvYmplY3QuXG5cbiAgICAgIGNvbW1vblNoaW0uc2hpbU1heE1lc3NhZ2VTaXplKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1TZW5kVGhyb3dUeXBlRXJyb3Iod2luZG93KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3NhZmFyaSc6XG4gICAgICBpZiAoIXNhZmFyaVNoaW0gfHwgIW9wdGlvbnMuc2hpbVNhZmFyaSkge1xuICAgICAgICBsb2dnaW5nKCdTYWZhcmkgc2hpbSBpcyBub3QgaW5jbHVkZWQgaW4gdGhpcyBhZGFwdGVyIHJlbGVhc2UuJyk7XG4gICAgICAgIHJldHVybiBhZGFwdGVyO1xuICAgICAgfVxuICAgICAgbG9nZ2luZygnYWRhcHRlci5qcyBzaGltbWluZyBzYWZhcmkuJyk7XG4gICAgICAvLyBFeHBvcnQgdG8gdGhlIGFkYXB0ZXIgZ2xvYmFsIG9iamVjdCB2aXNpYmxlIGluIHRoZSBicm93c2VyLlxuICAgICAgYWRhcHRlci5icm93c2VyU2hpbSA9IHNhZmFyaVNoaW07XG4gICAgICBjb21tb25TaGltLnNoaW1DcmVhdGVPYmplY3RVUkwod2luZG93KTtcblxuICAgICAgc2FmYXJpU2hpbS5zaGltUlRDSWNlU2VydmVyVXJscyh3aW5kb3cpO1xuICAgICAgc2FmYXJpU2hpbS5zaGltQ2FsbGJhY2tzQVBJKHdpbmRvdyk7XG4gICAgICBzYWZhcmlTaGltLnNoaW1Mb2NhbFN0cmVhbXNBUEkod2luZG93KTtcbiAgICAgIHNhZmFyaVNoaW0uc2hpbVJlbW90ZVN0cmVhbXNBUEkod2luZG93KTtcbiAgICAgIHNhZmFyaVNoaW0uc2hpbVRyYWNrRXZlbnRUcmFuc2NlaXZlcih3aW5kb3cpO1xuICAgICAgc2FmYXJpU2hpbS5zaGltR2V0VXNlck1lZGlhKHdpbmRvdyk7XG4gICAgICBzYWZhcmlTaGltLnNoaW1DcmVhdGVPZmZlckxlZ2FjeSh3aW5kb3cpO1xuXG4gICAgICBjb21tb25TaGltLnNoaW1SVENJY2VDYW5kaWRhdGUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbU1heE1lc3NhZ2VTaXplKHdpbmRvdyk7XG4gICAgICBjb21tb25TaGltLnNoaW1TZW5kVGhyb3dUeXBlRXJyb3Iod2luZG93KTtcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICBsb2dnaW5nKCdVbnN1cHBvcnRlZCBicm93c2VyIScpO1xuICAgICAgYnJlYWs7XG4gIH1cblxuICByZXR1cm4gYWRhcHRlcjtcbn07XG4iLCJcbi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbHMuanMnKTtcbnZhciBsb2dnaW5nID0gdXRpbHMubG9nO1xuXG4vKiBpdGVyYXRlcyB0aGUgc3RhdHMgZ3JhcGggcmVjdXJzaXZlbHkuICovXG5mdW5jdGlvbiB3YWxrU3RhdHMoc3RhdHMsIGJhc2UsIHJlc3VsdFNldCkge1xuICBpZiAoIWJhc2UgfHwgcmVzdWx0U2V0LmhhcyhiYXNlLmlkKSkge1xuICAgIHJldHVybjtcbiAgfVxuICByZXN1bHRTZXQuc2V0KGJhc2UuaWQsIGJhc2UpO1xuICBPYmplY3Qua2V5cyhiYXNlKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBpZiAobmFtZS5lbmRzV2l0aCgnSWQnKSkge1xuICAgICAgd2Fsa1N0YXRzKHN0YXRzLCBzdGF0cy5nZXQoYmFzZVtuYW1lXSksIHJlc3VsdFNldCk7XG4gICAgfSBlbHNlIGlmIChuYW1lLmVuZHNXaXRoKCdJZHMnKSkge1xuICAgICAgYmFzZVtuYW1lXS5mb3JFYWNoKGZ1bmN0aW9uKGlkKSB7XG4gICAgICAgIHdhbGtTdGF0cyhzdGF0cywgc3RhdHMuZ2V0KGlkKSwgcmVzdWx0U2V0KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG59XG5cbi8qIGZpbHRlciBnZXRTdGF0cyBmb3IgYSBzZW5kZXIvcmVjZWl2ZXIgdHJhY2suICovXG5mdW5jdGlvbiBmaWx0ZXJTdGF0cyhyZXN1bHQsIHRyYWNrLCBvdXRib3VuZCkge1xuICB2YXIgc3RyZWFtU3RhdHNUeXBlID0gb3V0Ym91bmQgPyAnb3V0Ym91bmQtcnRwJyA6ICdpbmJvdW5kLXJ0cCc7XG4gIHZhciBmaWx0ZXJlZFJlc3VsdCA9IG5ldyBNYXAoKTtcbiAgaWYgKHRyYWNrID09PSBudWxsKSB7XG4gICAgcmV0dXJuIGZpbHRlcmVkUmVzdWx0O1xuICB9XG4gIHZhciB0cmFja1N0YXRzID0gW107XG4gIHJlc3VsdC5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlLnR5cGUgPT09ICd0cmFjaycgJiZcbiAgICAgICAgdmFsdWUudHJhY2tJZGVudGlmaWVyID09PSB0cmFjay5pZCkge1xuICAgICAgdHJhY2tTdGF0cy5wdXNoKHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuICB0cmFja1N0YXRzLmZvckVhY2goZnVuY3Rpb24odHJhY2tTdGF0KSB7XG4gICAgcmVzdWx0LmZvckVhY2goZnVuY3Rpb24oc3RhdHMpIHtcbiAgICAgIGlmIChzdGF0cy50eXBlID09PSBzdHJlYW1TdGF0c1R5cGUgJiYgc3RhdHMudHJhY2tJZCA9PT0gdHJhY2tTdGF0LmlkKSB7XG4gICAgICAgIHdhbGtTdGF0cyhyZXN1bHQsIHN0YXRzLCBmaWx0ZXJlZFJlc3VsdCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gZmlsdGVyZWRSZXN1bHQ7XG59XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzaGltR2V0VXNlck1lZGlhOiByZXF1aXJlKCcuL2dldHVzZXJtZWRpYScpLFxuICBzaGltTWVkaWFTdHJlYW06IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHdpbmRvdy5NZWRpYVN0cmVhbSA9IHdpbmRvdy5NZWRpYVN0cmVhbSB8fCB3aW5kb3cud2Via2l0TWVkaWFTdHJlYW07XG4gIH0sXG5cbiAgc2hpbU9uVHJhY2s6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiYgISgnb250cmFjaycgaW5cbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAnb250cmFjaycsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fb250cmFjaztcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX29udHJhY2spIHtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcigndHJhY2snLCB0aGlzLl9vbnRyYWNrKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKCd0cmFjaycsIHRoaXMuX29udHJhY2sgPSBmKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB2YXIgb3JpZ1NldFJlbW90ZURlc2NyaXB0aW9uID1cbiAgICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICBpZiAoIXBjLl9vbnRyYWNrcG9seSkge1xuICAgICAgICAgIHBjLl9vbnRyYWNrcG9seSA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICAgIC8vIG9uYWRkc3RyZWFtIGRvZXMgbm90IGZpcmUgd2hlbiBhIHRyYWNrIGlzIGFkZGVkIHRvIGFuIGV4aXN0aW5nXG4gICAgICAgICAgICAvLyBzdHJlYW0uIEJ1dCBzdHJlYW0ub25hZGR0cmFjayBpcyBpbXBsZW1lbnRlZCBzbyB3ZSB1c2UgdGhhdC5cbiAgICAgICAgICAgIGUuc3RyZWFtLmFkZEV2ZW50TGlzdGVuZXIoJ2FkZHRyYWNrJywgZnVuY3Rpb24odGUpIHtcbiAgICAgICAgICAgICAgdmFyIHJlY2VpdmVyO1xuICAgICAgICAgICAgICBpZiAod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnMpIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlciA9IHBjLmdldFJlY2VpdmVycygpLmZpbmQoZnVuY3Rpb24ocikge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHIudHJhY2sgJiYgci50cmFjay5pZCA9PT0gdGUudHJhY2suaWQ7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVjZWl2ZXIgPSB7dHJhY2s6IHRlLnRyYWNrfTtcbiAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgndHJhY2snKTtcbiAgICAgICAgICAgICAgZXZlbnQudHJhY2sgPSB0ZS50cmFjaztcbiAgICAgICAgICAgICAgZXZlbnQucmVjZWl2ZXIgPSByZWNlaXZlcjtcbiAgICAgICAgICAgICAgZXZlbnQudHJhbnNjZWl2ZXIgPSB7cmVjZWl2ZXI6IHJlY2VpdmVyfTtcbiAgICAgICAgICAgICAgZXZlbnQuc3RyZWFtcyA9IFtlLnN0cmVhbV07XG4gICAgICAgICAgICAgIHBjLmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBlLnN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgICAgIHZhciByZWNlaXZlcjtcbiAgICAgICAgICAgICAgaWYgKHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzKSB7XG4gICAgICAgICAgICAgICAgcmVjZWl2ZXIgPSBwYy5nZXRSZWNlaXZlcnMoKS5maW5kKGZ1bmN0aW9uKHIpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiByLnRyYWNrICYmIHIudHJhY2suaWQgPT09IHRyYWNrLmlkO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJlY2VpdmVyID0ge3RyYWNrOiB0cmFja307XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCd0cmFjaycpO1xuICAgICAgICAgICAgICBldmVudC50cmFjayA9IHRyYWNrO1xuICAgICAgICAgICAgICBldmVudC5yZWNlaXZlciA9IHJlY2VpdmVyO1xuICAgICAgICAgICAgICBldmVudC50cmFuc2NlaXZlciA9IHtyZWNlaXZlcjogcmVjZWl2ZXJ9O1xuICAgICAgICAgICAgICBldmVudC5zdHJlYW1zID0gW2Uuc3RyZWFtXTtcbiAgICAgICAgICAgICAgcGMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9O1xuICAgICAgICAgIHBjLmFkZEV2ZW50TGlzdGVuZXIoJ2FkZHN0cmVhbScsIHBjLl9vbnRyYWNrcG9seSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9yaWdTZXRSZW1vdGVEZXNjcmlwdGlvbi5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICghKCdSVENSdHBUcmFuc2NlaXZlcicgaW4gd2luZG93KSkge1xuICAgICAgdXRpbHMud3JhcFBlZXJDb25uZWN0aW9uRXZlbnQod2luZG93LCAndHJhY2snLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIGlmICghZS50cmFuc2NlaXZlcikge1xuICAgICAgICAgIGUudHJhbnNjZWl2ZXIgPSB7cmVjZWl2ZXI6IGUucmVjZWl2ZXJ9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBlO1xuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNoaW1HZXRTZW5kZXJzV2l0aER0bWY6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIE92ZXJyaWRlcyBhZGRUcmFjay9yZW1vdmVUcmFjaywgZGVwZW5kcyBvbiBzaGltQWRkVHJhY2tSZW1vdmVUcmFjay5cbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgICEoJ2dldFNlbmRlcnMnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpICYmXG4gICAgICAgICdjcmVhdGVEVE1GU2VuZGVyJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSB7XG4gICAgICB2YXIgc2hpbVNlbmRlcldpdGhEdG1mID0gZnVuY3Rpb24ocGMsIHRyYWNrKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHJhY2s6IHRyYWNrLFxuICAgICAgICAgIGdldCBkdG1mKCkge1xuICAgICAgICAgICAgaWYgKHRoaXMuX2R0bWYgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICBpZiAodHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICAgICAgICAgIHRoaXMuX2R0bWYgPSBwYy5jcmVhdGVEVE1GU2VuZGVyKHRyYWNrKTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9kdG1mID0gbnVsbDtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2R0bWY7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBfcGM6IHBjXG4gICAgICAgIH07XG4gICAgICB9O1xuXG4gICAgICAvLyBhdWdtZW50IGFkZFRyYWNrIHdoZW4gZ2V0U2VuZGVycyBpcyBub3QgYXZhaWxhYmxlLlxuICAgICAgaWYgKCF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnMpIHtcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5fc2VuZGVycyA9IHRoaXMuX3NlbmRlcnMgfHwgW107XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NlbmRlcnMuc2xpY2UoKTsgLy8gcmV0dXJuIGEgY29weSBvZiB0aGUgaW50ZXJuYWwgc3RhdGUuXG4gICAgICAgIH07XG4gICAgICAgIHZhciBvcmlnQWRkVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrO1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24odHJhY2ssIHN0cmVhbSkge1xuICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgdmFyIHNlbmRlciA9IG9yaWdBZGRUcmFjay5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICAgICAgICBpZiAoIXNlbmRlcikge1xuICAgICAgICAgICAgc2VuZGVyID0gc2hpbVNlbmRlcldpdGhEdG1mKHBjLCB0cmFjayk7XG4gICAgICAgICAgICBwYy5fc2VuZGVycy5wdXNoKHNlbmRlcik7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBzZW5kZXI7XG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIG9yaWdSZW1vdmVUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlVHJhY2s7XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlVHJhY2sgPSBmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgIG9yaWdSZW1vdmVUcmFjay5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICAgICAgICB2YXIgaWR4ID0gcGMuX3NlbmRlcnMuaW5kZXhPZihzZW5kZXIpO1xuICAgICAgICAgIGlmIChpZHggIT09IC0xKSB7XG4gICAgICAgICAgICBwYy5fc2VuZGVycy5zcGxpY2UoaWR4LCAxKTtcbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICB2YXIgb3JpZ0FkZFN0cmVhbSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgcGMuX3NlbmRlcnMgPSBwYy5fc2VuZGVycyB8fCBbXTtcbiAgICAgICAgb3JpZ0FkZFN0cmVhbS5hcHBseShwYywgW3N0cmVhbV0pO1xuICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgIHBjLl9zZW5kZXJzLnB1c2goc2hpbVNlbmRlcldpdGhEdG1mKHBjLCB0cmFjaykpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgICAgIHZhciBvcmlnUmVtb3ZlU3RyZWFtID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW07XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICBwYy5fc2VuZGVycyA9IHBjLl9zZW5kZXJzIHx8IFtdO1xuICAgICAgICBvcmlnUmVtb3ZlU3RyZWFtLmFwcGx5KHBjLCBbc3RyZWFtXSk7XG5cbiAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICB2YXIgc2VuZGVyID0gcGMuX3NlbmRlcnMuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICAgICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKHNlbmRlcikge1xuICAgICAgICAgICAgcGMuX3NlbmRlcnMuc3BsaWNlKHBjLl9zZW5kZXJzLmluZGV4T2Yoc2VuZGVyKSwgMSk7IC8vIHJlbW92ZSBzZW5kZXJcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICAgICAgICAgJ2dldFNlbmRlcnMnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgJiZcbiAgICAgICAgICAgICAgICdjcmVhdGVEVE1GU2VuZGVyJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlICYmXG4gICAgICAgICAgICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyICYmXG4gICAgICAgICAgICAgICAhKCdkdG1mJyBpbiB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSkpIHtcbiAgICAgIHZhciBvcmlnR2V0U2VuZGVycyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycztcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICB2YXIgc2VuZGVycyA9IG9yaWdHZXRTZW5kZXJzLmFwcGx5KHBjLCBbXSk7XG4gICAgICAgIHNlbmRlcnMuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgICAgICBzZW5kZXIuX3BjID0gcGM7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gc2VuZGVycztcbiAgICAgIH07XG5cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSwgJ2R0bWYnLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2R0bWYgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKHRoaXMudHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICAgICAgICB0aGlzLl9kdG1mID0gdGhpcy5fcGMuY3JlYXRlRFRNRlNlbmRlcih0aGlzLnRyYWNrKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHRoaXMuX2R0bWYgPSBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gdGhpcy5fZHRtZjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuXG4gIHNoaW1TZW5kZXJSZWNlaXZlckdldFN0YXRzOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAoISh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgd2luZG93LlJUQ1J0cFNlbmRlciAmJiB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gc2hpbSBzZW5kZXIgc3RhdHMuXG4gICAgaWYgKCEoJ2dldFN0YXRzJyBpbiB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSkpIHtcbiAgICAgIHZhciBvcmlnR2V0U2VuZGVycyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycztcbiAgICAgIGlmIChvcmlnR2V0U2VuZGVycykge1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgIHZhciBzZW5kZXJzID0gb3JpZ0dldFNlbmRlcnMuYXBwbHkocGMsIFtdKTtcbiAgICAgICAgICBzZW5kZXJzLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICAgICAgICBzZW5kZXIuX3BjID0gcGM7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIHNlbmRlcnM7XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIHZhciBvcmlnQWRkVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrO1xuICAgICAgaWYgKG9yaWdBZGRUcmFjaykge1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHNlbmRlciA9IG9yaWdBZGRUcmFjay5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIHNlbmRlci5fcGMgPSB0aGlzO1xuICAgICAgICAgIHJldHVybiBzZW5kZXI7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgc2VuZGVyID0gdGhpcztcbiAgICAgICAgcmV0dXJuIHRoaXMuX3BjLmdldFN0YXRzKCkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcbiAgICAgICAgICAvKiBOb3RlOiB0aGlzIHdpbGwgaW5jbHVkZSBzdGF0cyBvZiBhbGwgc2VuZGVycyB0aGF0XG4gICAgICAgICAgICogICBzZW5kIGEgdHJhY2sgd2l0aCB0aGUgc2FtZSBpZCBhcyBzZW5kZXIudHJhY2sgYXNcbiAgICAgICAgICAgKiAgIGl0IGlzIG5vdCBwb3NzaWJsZSB0byBpZGVudGlmeSB0aGUgUlRDUnRwU2VuZGVyLlxuICAgICAgICAgICAqL1xuICAgICAgICAgIHJldHVybiBmaWx0ZXJTdGF0cyhyZXN1bHQsIHNlbmRlci50cmFjaywgdHJ1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBzaGltIHJlY2VpdmVyIHN0YXRzLlxuICAgIGlmICghKCdnZXRTdGF0cycgaW4gd2luZG93LlJUQ1J0cFJlY2VpdmVyLnByb3RvdHlwZSkpIHtcbiAgICAgIHZhciBvcmlnR2V0UmVjZWl2ZXJzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnM7XG4gICAgICBpZiAob3JpZ0dldFJlY2VpdmVycykge1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgdmFyIHJlY2VpdmVycyA9IG9yaWdHZXRSZWNlaXZlcnMuYXBwbHkocGMsIFtdKTtcbiAgICAgICAgICByZWNlaXZlcnMuZm9yRWFjaChmdW5jdGlvbihyZWNlaXZlcikge1xuICAgICAgICAgICAgcmVjZWl2ZXIuX3BjID0gcGM7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgcmV0dXJuIHJlY2VpdmVycztcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHV0aWxzLndyYXBQZWVyQ29ubmVjdGlvbkV2ZW50KHdpbmRvdywgJ3RyYWNrJywgZnVuY3Rpb24oZSkge1xuICAgICAgICBlLnJlY2VpdmVyLl9wYyA9IGUuc3JjRWxlbWVudDtcbiAgICAgICAgcmV0dXJuIGU7XG4gICAgICB9KTtcbiAgICAgIHdpbmRvdy5SVENSdHBSZWNlaXZlci5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHJlY2VpdmVyID0gdGhpcztcbiAgICAgICAgcmV0dXJuIHRoaXMuX3BjLmdldFN0YXRzKCkudGhlbihmdW5jdGlvbihyZXN1bHQpIHtcbiAgICAgICAgICByZXR1cm4gZmlsdGVyU3RhdHMocmVzdWx0LCByZWNlaXZlci50cmFjaywgZmFsc2UpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfVxuXG4gICAgaWYgKCEoJ2dldFN0YXRzJyBpbiB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSAmJlxuICAgICAgICAnZ2V0U3RhdHMnIGluIHdpbmRvdy5SVENSdHBSZWNlaXZlci5wcm90b3R5cGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gc2hpbSBSVENQZWVyQ29ubmVjdGlvbi5nZXRTdGF0cyh0cmFjaykuXG4gICAgdmFyIG9yaWdHZXRTdGF0cyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHM7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMCAmJlxuICAgICAgICAgIGFyZ3VtZW50c1swXSBpbnN0YW5jZW9mIHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrKSB7XG4gICAgICAgIHZhciB0cmFjayA9IGFyZ3VtZW50c1swXTtcbiAgICAgICAgdmFyIHNlbmRlcjtcbiAgICAgICAgdmFyIHJlY2VpdmVyO1xuICAgICAgICB2YXIgZXJyO1xuICAgICAgICBwYy5nZXRTZW5kZXJzKCkuZm9yRWFjaChmdW5jdGlvbihzKSB7XG4gICAgICAgICAgaWYgKHMudHJhY2sgPT09IHRyYWNrKSB7XG4gICAgICAgICAgICBpZiAoc2VuZGVyKSB7XG4gICAgICAgICAgICAgIGVyciA9IHRydWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBzZW5kZXIgPSBzO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHBjLmdldFJlY2VpdmVycygpLmZvckVhY2goZnVuY3Rpb24ocikge1xuICAgICAgICAgIGlmIChyLnRyYWNrID09PSB0cmFjaykge1xuICAgICAgICAgICAgaWYgKHJlY2VpdmVyKSB7XG4gICAgICAgICAgICAgIGVyciA9IHRydWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZWNlaXZlciA9IHI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiByLnRyYWNrID09PSB0cmFjaztcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChlcnIgfHwgKHNlbmRlciAmJiByZWNlaXZlcikpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IERPTUV4Y2VwdGlvbihcbiAgICAgICAgICAgICdUaGVyZSBhcmUgbW9yZSB0aGFuIG9uZSBzZW5kZXIgb3IgcmVjZWl2ZXIgZm9yIHRoZSB0cmFjay4nLFxuICAgICAgICAgICAgJ0ludmFsaWRBY2Nlc3NFcnJvcicpKTtcbiAgICAgICAgfSBlbHNlIGlmIChzZW5kZXIpIHtcbiAgICAgICAgICByZXR1cm4gc2VuZGVyLmdldFN0YXRzKCk7XG4gICAgICAgIH0gZWxzZSBpZiAocmVjZWl2ZXIpIHtcbiAgICAgICAgICByZXR1cm4gcmVjZWl2ZXIuZ2V0U3RhdHMoKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IERPTUV4Y2VwdGlvbihcbiAgICAgICAgICAnVGhlcmUgaXMgbm8gc2VuZGVyIG9yIHJlY2VpdmVyIGZvciB0aGUgdHJhY2suJyxcbiAgICAgICAgICAnSW52YWxpZEFjY2Vzc0Vycm9yJykpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG9yaWdHZXRTdGF0cy5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1Tb3VyY2VPYmplY3Q6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBVUkwgPSB3aW5kb3cgJiYgd2luZG93LlVSTDtcblxuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0Jykge1xuICAgICAgaWYgKHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50ICYmXG4gICAgICAgICEoJ3NyY09iamVjdCcgaW4gd2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlKSkge1xuICAgICAgICAvLyBTaGltIHRoZSBzcmNPYmplY3QgcHJvcGVydHksIG9uY2UsIHdoZW4gSFRNTE1lZGlhRWxlbWVudCBpcyBmb3VuZC5cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSwgJ3NyY09iamVjdCcsIHtcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3NyY09iamVjdDtcbiAgICAgICAgICB9LFxuICAgICAgICAgIHNldDogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgICAgICAvLyBVc2UgX3NyY09iamVjdCBhcyBhIHByaXZhdGUgcHJvcGVydHkgZm9yIHRoaXMgc2hpbVxuICAgICAgICAgICAgdGhpcy5fc3JjT2JqZWN0ID0gc3RyZWFtO1xuICAgICAgICAgICAgaWYgKHRoaXMuc3JjKSB7XG4gICAgICAgICAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwodGhpcy5zcmMpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIXN0cmVhbSkge1xuICAgICAgICAgICAgICB0aGlzLnNyYyA9ICcnO1xuICAgICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5zcmMgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKHN0cmVhbSk7XG4gICAgICAgICAgICAvLyBXZSBuZWVkIHRvIHJlY3JlYXRlIHRoZSBibG9iIHVybCB3aGVuIGEgdHJhY2sgaXMgYWRkZWQgb3JcbiAgICAgICAgICAgIC8vIHJlbW92ZWQuIERvaW5nIGl0IG1hbnVhbGx5IHNpbmNlIHdlIHdhbnQgdG8gYXZvaWQgYSByZWN1cnNpb24uXG4gICAgICAgICAgICBzdHJlYW0uYWRkRXZlbnRMaXN0ZW5lcignYWRkdHJhY2snLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgaWYgKHNlbGYuc3JjKSB7XG4gICAgICAgICAgICAgICAgVVJMLnJldm9rZU9iamVjdFVSTChzZWxmLnNyYyk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc2VsZi5zcmMgPSBVUkwuY3JlYXRlT2JqZWN0VVJMKHN0cmVhbSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHN0cmVhbS5hZGRFdmVudExpc3RlbmVyKCdyZW1vdmV0cmFjaycsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICBpZiAoc2VsZi5zcmMpIHtcbiAgICAgICAgICAgICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHNlbGYuc3JjKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBzZWxmLnNyYyA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc3RyZWFtKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHNoaW1BZGRUcmFja1JlbW92ZVRyYWNrV2l0aE5hdGl2ZTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gc2hpbSBhZGRUcmFjay9yZW1vdmVUcmFjayB3aXRoIG5hdGl2ZSB2YXJpYW50cyBpbiBvcmRlciB0byBtYWtlXG4gICAgLy8gdGhlIGludGVyYWN0aW9ucyB3aXRoIGxlZ2FjeSBnZXRMb2NhbFN0cmVhbXMgYmVoYXZlIGFzIGluIG90aGVyIGJyb3dzZXJzLlxuICAgIC8vIEtlZXBzIGEgbWFwcGluZyBzdHJlYW0uaWQgPT4gW3N0cmVhbSwgcnRwc2VuZGVycy4uLl1cbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldExvY2FsU3RyZWFtcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgPSB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zIHx8IHt9O1xuICAgICAgcmV0dXJuIE9iamVjdC5rZXlzKHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMpLm1hcChmdW5jdGlvbihzdHJlYW1JZCkge1xuICAgICAgICByZXR1cm4gcGMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtSWRdWzBdO1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIHZhciBvcmlnQWRkVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbih0cmFjaywgc3RyZWFtKSB7XG4gICAgICBpZiAoIXN0cmVhbSkge1xuICAgICAgICByZXR1cm4gb3JpZ0FkZFRyYWNrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB9XG4gICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zID0gdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyB8fCB7fTtcblxuICAgICAgdmFyIHNlbmRlciA9IG9yaWdBZGRUcmFjay5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgaWYgKCF0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbS5pZF0pIHtcbiAgICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW0uaWRdID0gW3N0cmVhbSwgc2VuZGVyXTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW0uaWRdLmluZGV4T2Yoc2VuZGVyKSA9PT0gLTEpIHtcbiAgICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW0uaWRdLnB1c2goc2VuZGVyKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBzZW5kZXI7XG4gICAgfTtcblxuICAgIHZhciBvcmlnQWRkU3RyZWFtID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW07XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zID0gdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyB8fCB7fTtcblxuICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgdmFyIGFscmVhZHlFeGlzdHMgPSBwYy5nZXRTZW5kZXJzKCkuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGFscmVhZHlFeGlzdHMpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCdUcmFjayBhbHJlYWR5IGV4aXN0cy4nLFxuICAgICAgICAgICAgICAnSW52YWxpZEFjY2Vzc0Vycm9yJyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdmFyIGV4aXN0aW5nU2VuZGVycyA9IHBjLmdldFNlbmRlcnMoKTtcbiAgICAgIG9yaWdBZGRTdHJlYW0uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIHZhciBuZXdTZW5kZXJzID0gcGMuZ2V0U2VuZGVycygpLmZpbHRlcihmdW5jdGlvbihuZXdTZW5kZXIpIHtcbiAgICAgICAgcmV0dXJuIGV4aXN0aW5nU2VuZGVycy5pbmRleE9mKG5ld1NlbmRlcikgPT09IC0xO1xuICAgICAgfSk7XG4gICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbS5pZF0gPSBbc3RyZWFtXS5jb25jYXQobmV3U2VuZGVycyk7XG4gICAgfTtcblxuICAgIHZhciBvcmlnUmVtb3ZlU3RyZWFtID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW07XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgPSB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zIHx8IHt9O1xuICAgICAgZGVsZXRlIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtLmlkXTtcbiAgICAgIHJldHVybiBvcmlnUmVtb3ZlU3RyZWFtLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcblxuICAgIHZhciBvcmlnUmVtb3ZlVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVRyYWNrO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlVHJhY2sgPSBmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zID0gdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyB8fCB7fTtcbiAgICAgIGlmIChzZW5kZXIpIHtcbiAgICAgICAgT2JqZWN0LmtleXModGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcykuZm9yRWFjaChmdW5jdGlvbihzdHJlYW1JZCkge1xuICAgICAgICAgIHZhciBpZHggPSBwYy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW1JZF0uaW5kZXhPZihzZW5kZXIpO1xuICAgICAgICAgIGlmIChpZHggIT09IC0xKSB7XG4gICAgICAgICAgICBwYy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW1JZF0uc3BsaWNlKGlkeCwgMSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChwYy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW1JZF0ubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICBkZWxldGUgcGMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtSWRdO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gb3JpZ1JlbW92ZVRyYWNrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltQWRkVHJhY2tSZW1vdmVUcmFjazogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuICAgIC8vIHNoaW0gYWRkVHJhY2sgYW5kIHJlbW92ZVRyYWNrLlxuICAgIGlmICh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrICYmXG4gICAgICAgIGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPj0gNjUpIHtcbiAgICAgIHJldHVybiB0aGlzLnNoaW1BZGRUcmFja1JlbW92ZVRyYWNrV2l0aE5hdGl2ZSh3aW5kb3cpO1xuICAgIH1cblxuICAgIC8vIGFsc28gc2hpbSBwYy5nZXRMb2NhbFN0cmVhbXMgd2hlbiBhZGRUcmFjayBpcyBzaGltbWVkXG4gICAgLy8gdG8gcmV0dXJuIHRoZSBvcmlnaW5hbCBzdHJlYW1zLlxuICAgIHZhciBvcmlnR2V0TG9jYWxTdHJlYW1zID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVxuICAgICAgICAuZ2V0TG9jYWxTdHJlYW1zO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0TG9jYWxTdHJlYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdmFyIG5hdGl2ZVN0cmVhbXMgPSBvcmlnR2V0TG9jYWxTdHJlYW1zLmFwcGx5KHRoaXMpO1xuICAgICAgcGMuX3JldmVyc2VTdHJlYW1zID0gcGMuX3JldmVyc2VTdHJlYW1zIHx8IHt9O1xuICAgICAgcmV0dXJuIG5hdGl2ZVN0cmVhbXMubWFwKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICByZXR1cm4gcGMuX3JldmVyc2VTdHJlYW1zW3N0cmVhbS5pZF07XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdBZGRTdHJlYW0gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHBjLl9zdHJlYW1zID0gcGMuX3N0cmVhbXMgfHwge307XG4gICAgICBwYy5fcmV2ZXJzZVN0cmVhbXMgPSBwYy5fcmV2ZXJzZVN0cmVhbXMgfHwge307XG5cbiAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgIHZhciBhbHJlYWR5RXhpc3RzID0gcGMuZ2V0U2VuZGVycygpLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChhbHJlYWR5RXhpc3RzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignVHJhY2sgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgICAgICAgICAgJ0ludmFsaWRBY2Nlc3NFcnJvcicpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIC8vIEFkZCBpZGVudGl0eSBtYXBwaW5nIGZvciBjb25zaXN0ZW5jeSB3aXRoIGFkZFRyYWNrLlxuICAgICAgLy8gVW5sZXNzIHRoaXMgaXMgYmVpbmcgdXNlZCB3aXRoIGEgc3RyZWFtIGZyb20gYWRkVHJhY2suXG4gICAgICBpZiAoIXBjLl9yZXZlcnNlU3RyZWFtc1tzdHJlYW0uaWRdKSB7XG4gICAgICAgIHZhciBuZXdTdHJlYW0gPSBuZXcgd2luZG93Lk1lZGlhU3RyZWFtKHN0cmVhbS5nZXRUcmFja3MoKSk7XG4gICAgICAgIHBjLl9zdHJlYW1zW3N0cmVhbS5pZF0gPSBuZXdTdHJlYW07XG4gICAgICAgIHBjLl9yZXZlcnNlU3RyZWFtc1tuZXdTdHJlYW0uaWRdID0gc3RyZWFtO1xuICAgICAgICBzdHJlYW0gPSBuZXdTdHJlYW07XG4gICAgICB9XG4gICAgICBvcmlnQWRkU3RyZWFtLmFwcGx5KHBjLCBbc3RyZWFtXSk7XG4gICAgfTtcblxuICAgIHZhciBvcmlnUmVtb3ZlU3RyZWFtID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW07XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBwYy5fc3RyZWFtcyA9IHBjLl9zdHJlYW1zIHx8IHt9O1xuICAgICAgcGMuX3JldmVyc2VTdHJlYW1zID0gcGMuX3JldmVyc2VTdHJlYW1zIHx8IHt9O1xuXG4gICAgICBvcmlnUmVtb3ZlU3RyZWFtLmFwcGx5KHBjLCBbKHBjLl9zdHJlYW1zW3N0cmVhbS5pZF0gfHwgc3RyZWFtKV0pO1xuICAgICAgZGVsZXRlIHBjLl9yZXZlcnNlU3RyZWFtc1socGMuX3N0cmVhbXNbc3RyZWFtLmlkXSA/XG4gICAgICAgICAgcGMuX3N0cmVhbXNbc3RyZWFtLmlkXS5pZCA6IHN0cmVhbS5pZCldO1xuICAgICAgZGVsZXRlIHBjLl9zdHJlYW1zW3N0cmVhbS5pZF07XG4gICAgfTtcblxuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbih0cmFjaywgc3RyZWFtKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgaWYgKHBjLnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKFxuICAgICAgICAgICdUaGUgUlRDUGVlckNvbm5lY3Rpb25cXCdzIHNpZ25hbGluZ1N0YXRlIGlzIFxcJ2Nsb3NlZFxcJy4nLFxuICAgICAgICAgICdJbnZhbGlkU3RhdGVFcnJvcicpO1xuICAgICAgfVxuICAgICAgdmFyIHN0cmVhbXMgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgICBpZiAoc3RyZWFtcy5sZW5ndGggIT09IDEgfHxcbiAgICAgICAgICAhc3RyZWFtc1swXS5nZXRUcmFja3MoKS5maW5kKGZ1bmN0aW9uKHQpIHtcbiAgICAgICAgICAgIHJldHVybiB0ID09PSB0cmFjaztcbiAgICAgICAgICB9KSkge1xuICAgICAgICAvLyB0aGlzIGlzIG5vdCBmdWxseSBjb3JyZWN0IGJ1dCBhbGwgd2UgY2FuIG1hbmFnZSB3aXRob3V0XG4gICAgICAgIC8vIFtbYXNzb2NpYXRlZCBNZWRpYVN0cmVhbXNdXSBpbnRlcm5hbCBzbG90LlxuICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKFxuICAgICAgICAgICdUaGUgYWRhcHRlci5qcyBhZGRUcmFjayBwb2x5ZmlsbCBvbmx5IHN1cHBvcnRzIGEgc2luZ2xlICcgK1xuICAgICAgICAgICcgc3RyZWFtIHdoaWNoIGlzIGFzc29jaWF0ZWQgd2l0aCB0aGUgc3BlY2lmaWVkIHRyYWNrLicsXG4gICAgICAgICAgJ05vdFN1cHBvcnRlZEVycm9yJyk7XG4gICAgICB9XG5cbiAgICAgIHZhciBhbHJlYWR5RXhpc3RzID0gcGMuZ2V0U2VuZGVycygpLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgICB9KTtcbiAgICAgIGlmIChhbHJlYWR5RXhpc3RzKSB7XG4gICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJ1RyYWNrIGFscmVhZHkgZXhpc3RzLicsXG4gICAgICAgICAgICAnSW52YWxpZEFjY2Vzc0Vycm9yJyk7XG4gICAgICB9XG5cbiAgICAgIHBjLl9zdHJlYW1zID0gcGMuX3N0cmVhbXMgfHwge307XG4gICAgICBwYy5fcmV2ZXJzZVN0cmVhbXMgPSBwYy5fcmV2ZXJzZVN0cmVhbXMgfHwge307XG4gICAgICB2YXIgb2xkU3RyZWFtID0gcGMuX3N0cmVhbXNbc3RyZWFtLmlkXTtcbiAgICAgIGlmIChvbGRTdHJlYW0pIHtcbiAgICAgICAgLy8gdGhpcyBpcyB1c2luZyBvZGQgQ2hyb21lIGJlaGF2aW91ciwgdXNlIHdpdGggY2F1dGlvbjpcbiAgICAgICAgLy8gaHR0cHM6Ly9idWdzLmNocm9taXVtLm9yZy9wL3dlYnJ0Yy9pc3N1ZXMvZGV0YWlsP2lkPTc4MTVcbiAgICAgICAgLy8gTm90ZTogd2UgcmVseSBvbiB0aGUgaGlnaC1sZXZlbCBhZGRUcmFjay9kdG1mIHNoaW0gdG9cbiAgICAgICAgLy8gY3JlYXRlIHRoZSBzZW5kZXIgd2l0aCBhIGR0bWYgc2VuZGVyLlxuICAgICAgICBvbGRTdHJlYW0uYWRkVHJhY2sodHJhY2spO1xuXG4gICAgICAgIC8vIFRyaWdnZXIgT05OIGFzeW5jLlxuICAgICAgICBQcm9taXNlLnJlc29sdmUoKS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHBjLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCduZWdvdGlhdGlvbm5lZWRlZCcpKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgbmV3U3RyZWFtID0gbmV3IHdpbmRvdy5NZWRpYVN0cmVhbShbdHJhY2tdKTtcbiAgICAgICAgcGMuX3N0cmVhbXNbc3RyZWFtLmlkXSA9IG5ld1N0cmVhbTtcbiAgICAgICAgcGMuX3JldmVyc2VTdHJlYW1zW25ld1N0cmVhbS5pZF0gPSBzdHJlYW07XG4gICAgICAgIHBjLmFkZFN0cmVhbShuZXdTdHJlYW0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHBjLmdldFNlbmRlcnMoKS5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8vIHJlcGxhY2UgdGhlIGludGVybmFsIHN0cmVhbSBpZCB3aXRoIHRoZSBleHRlcm5hbCBvbmUgYW5kXG4gICAgLy8gdmljZSB2ZXJzYS5cbiAgICBmdW5jdGlvbiByZXBsYWNlSW50ZXJuYWxTdHJlYW1JZChwYywgZGVzY3JpcHRpb24pIHtcbiAgICAgIHZhciBzZHAgPSBkZXNjcmlwdGlvbi5zZHA7XG4gICAgICBPYmplY3Qua2V5cyhwYy5fcmV2ZXJzZVN0cmVhbXMgfHwgW10pLmZvckVhY2goZnVuY3Rpb24oaW50ZXJuYWxJZCkge1xuICAgICAgICB2YXIgZXh0ZXJuYWxTdHJlYW0gPSBwYy5fcmV2ZXJzZVN0cmVhbXNbaW50ZXJuYWxJZF07XG4gICAgICAgIHZhciBpbnRlcm5hbFN0cmVhbSA9IHBjLl9zdHJlYW1zW2V4dGVybmFsU3RyZWFtLmlkXTtcbiAgICAgICAgc2RwID0gc2RwLnJlcGxhY2UobmV3IFJlZ0V4cChpbnRlcm5hbFN0cmVhbS5pZCwgJ2cnKSxcbiAgICAgICAgICAgIGV4dGVybmFsU3RyZWFtLmlkKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIG5ldyBSVENTZXNzaW9uRGVzY3JpcHRpb24oe1xuICAgICAgICB0eXBlOiBkZXNjcmlwdGlvbi50eXBlLFxuICAgICAgICBzZHA6IHNkcFxuICAgICAgfSk7XG4gICAgfVxuICAgIGZ1bmN0aW9uIHJlcGxhY2VFeHRlcm5hbFN0cmVhbUlkKHBjLCBkZXNjcmlwdGlvbikge1xuICAgICAgdmFyIHNkcCA9IGRlc2NyaXB0aW9uLnNkcDtcbiAgICAgIE9iamVjdC5rZXlzKHBjLl9yZXZlcnNlU3RyZWFtcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbihpbnRlcm5hbElkKSB7XG4gICAgICAgIHZhciBleHRlcm5hbFN0cmVhbSA9IHBjLl9yZXZlcnNlU3RyZWFtc1tpbnRlcm5hbElkXTtcbiAgICAgICAgdmFyIGludGVybmFsU3RyZWFtID0gcGMuX3N0cmVhbXNbZXh0ZXJuYWxTdHJlYW0uaWRdO1xuICAgICAgICBzZHAgPSBzZHAucmVwbGFjZShuZXcgUmVnRXhwKGV4dGVybmFsU3RyZWFtLmlkLCAnZycpLFxuICAgICAgICAgICAgaW50ZXJuYWxTdHJlYW0uaWQpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gbmV3IFJUQ1Nlc3Npb25EZXNjcmlwdGlvbih7XG4gICAgICAgIHR5cGU6IGRlc2NyaXB0aW9uLnR5cGUsXG4gICAgICAgIHNkcDogc2RwXG4gICAgICB9KTtcbiAgICB9XG4gICAgWydjcmVhdGVPZmZlcicsICdjcmVhdGVBbnN3ZXInXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgdmFyIG5hdGl2ZU1ldGhvZCA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgICAgdmFyIGlzTGVnYWN5Q2FsbCA9IGFyZ3VtZW50cy5sZW5ndGggJiZcbiAgICAgICAgICAgIHR5cGVvZiBhcmd1bWVudHNbMF0gPT09ICdmdW5jdGlvbic7XG4gICAgICAgIGlmIChpc0xlZ2FjeUNhbGwpIHtcbiAgICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHBjLCBbXG4gICAgICAgICAgICBmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgICAgICAgICAgICB2YXIgZGVzYyA9IHJlcGxhY2VJbnRlcm5hbFN0cmVhbUlkKHBjLCBkZXNjcmlwdGlvbik7XG4gICAgICAgICAgICAgIGFyZ3NbMF0uYXBwbHkobnVsbCwgW2Rlc2NdKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBmdW5jdGlvbihlcnIpIHtcbiAgICAgICAgICAgICAgaWYgKGFyZ3NbMV0pIHtcbiAgICAgICAgICAgICAgICBhcmdzWzFdLmFwcGx5KG51bGwsIGVycik7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sIGFyZ3VtZW50c1syXVxuICAgICAgICAgIF0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkocGMsIGFyZ3VtZW50cylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICAgICAgICByZXR1cm4gcmVwbGFjZUludGVybmFsU3RyZWFtSWQocGMsIGRlc2NyaXB0aW9uKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH0pO1xuXG4gICAgdmFyIG9yaWdTZXRMb2NhbERlc2NyaXB0aW9uID1cbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRMb2NhbERlc2NyaXB0aW9uO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0TG9jYWxEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIGlmICghYXJndW1lbnRzLmxlbmd0aCB8fCAhYXJndW1lbnRzWzBdLnR5cGUpIHtcbiAgICAgICAgcmV0dXJuIG9yaWdTZXRMb2NhbERlc2NyaXB0aW9uLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgICAgfVxuICAgICAgYXJndW1lbnRzWzBdID0gcmVwbGFjZUV4dGVybmFsU3RyZWFtSWQocGMsIGFyZ3VtZW50c1swXSk7XG4gICAgICByZXR1cm4gb3JpZ1NldExvY2FsRGVzY3JpcHRpb24uYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgfTtcblxuICAgIC8vIFRPRE86IG1hbmdsZSBnZXRTdGF0czogaHR0cHM6Ly93M2MuZ2l0aHViLmlvL3dlYnJ0Yy1zdGF0cy8jZG9tLXJ0Y21lZGlhc3RyZWFtc3RhdHMtc3RyZWFtaWRlbnRpZmllclxuXG4gICAgdmFyIG9yaWdMb2NhbERlc2NyaXB0aW9uID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ2xvY2FsRGVzY3JpcHRpb24nKTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSxcbiAgICAgICAgJ2xvY2FsRGVzY3JpcHRpb24nLCB7XG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgICB2YXIgZGVzY3JpcHRpb24gPSBvcmlnTG9jYWxEZXNjcmlwdGlvbi5nZXQuYXBwbHkodGhpcyk7XG4gICAgICAgICAgICBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJycpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGRlc2NyaXB0aW9uO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlcGxhY2VJbnRlcm5hbFN0cmVhbUlkKHBjLCBkZXNjcmlwdGlvbik7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcblxuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlVHJhY2sgPSBmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBpZiAocGMuc2lnbmFsaW5nU3RhdGUgPT09ICdjbG9zZWQnKSB7XG4gICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oXG4gICAgICAgICAgJ1RoZSBSVENQZWVyQ29ubmVjdGlvblxcJ3Mgc2lnbmFsaW5nU3RhdGUgaXMgXFwnY2xvc2VkXFwnLicsXG4gICAgICAgICAgJ0ludmFsaWRTdGF0ZUVycm9yJyk7XG4gICAgICB9XG4gICAgICAvLyBXZSBjYW4gbm90IHlldCBjaGVjayBmb3Igc2VuZGVyIGluc3RhbmNlb2YgUlRDUnRwU2VuZGVyXG4gICAgICAvLyBzaW5jZSB3ZSBzaGltIFJUUFNlbmRlci4gU28gd2UgY2hlY2sgaWYgc2VuZGVyLl9wYyBpcyBzZXQuXG4gICAgICBpZiAoIXNlbmRlci5fcGMpIHtcbiAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignQXJndW1lbnQgMSBvZiBSVENQZWVyQ29ubmVjdGlvbi5yZW1vdmVUcmFjayAnICtcbiAgICAgICAgICAgICdkb2VzIG5vdCBpbXBsZW1lbnQgaW50ZXJmYWNlIFJUQ1J0cFNlbmRlci4nLCAnVHlwZUVycm9yJyk7XG4gICAgICB9XG4gICAgICB2YXIgaXNMb2NhbCA9IHNlbmRlci5fcGMgPT09IHBjO1xuICAgICAgaWYgKCFpc0xvY2FsKSB7XG4gICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJ1NlbmRlciB3YXMgbm90IGNyZWF0ZWQgYnkgdGhpcyBjb25uZWN0aW9uLicsXG4gICAgICAgICAgICAnSW52YWxpZEFjY2Vzc0Vycm9yJyk7XG4gICAgICB9XG5cbiAgICAgIC8vIFNlYXJjaCBmb3IgdGhlIG5hdGl2ZSBzdHJlYW0gdGhlIHNlbmRlcnMgdHJhY2sgYmVsb25ncyB0by5cbiAgICAgIHBjLl9zdHJlYW1zID0gcGMuX3N0cmVhbXMgfHwge307XG4gICAgICB2YXIgc3RyZWFtO1xuICAgICAgT2JqZWN0LmtleXMocGMuX3N0cmVhbXMpLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtaWQpIHtcbiAgICAgICAgdmFyIGhhc1RyYWNrID0gcGMuX3N0cmVhbXNbc3RyZWFtaWRdLmdldFRyYWNrcygpLmZpbmQoZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICByZXR1cm4gc2VuZGVyLnRyYWNrID09PSB0cmFjaztcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChoYXNUcmFjaykge1xuICAgICAgICAgIHN0cmVhbSA9IHBjLl9zdHJlYW1zW3N0cmVhbWlkXTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIGlmIChzdHJlYW0pIHtcbiAgICAgICAgaWYgKHN0cmVhbS5nZXRUcmFja3MoKS5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAvLyBpZiB0aGlzIGlzIHRoZSBsYXN0IHRyYWNrIG9mIHRoZSBzdHJlYW0sIHJlbW92ZSB0aGUgc3RyZWFtLiBUaGlzXG4gICAgICAgICAgLy8gdGFrZXMgY2FyZSBvZiBhbnkgc2hpbW1lZCBfc2VuZGVycy5cbiAgICAgICAgICBwYy5yZW1vdmVTdHJlYW0ocGMuX3JldmVyc2VTdHJlYW1zW3N0cmVhbS5pZF0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHJlbHlpbmcgb24gdGhlIHNhbWUgb2RkIGNocm9tZSBiZWhhdmlvdXIgYXMgYWJvdmUuXG4gICAgICAgICAgc3RyZWFtLnJlbW92ZVRyYWNrKHNlbmRlci50cmFjayk7XG4gICAgICAgIH1cbiAgICAgICAgcGMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lZ290aWF0aW9ubmVlZGVkJykpO1xuICAgICAgfVxuICAgIH07XG4gIH0sXG5cbiAgc2hpbVBlZXJDb25uZWN0aW9uOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG5cbiAgICAvLyBUaGUgUlRDUGVlckNvbm5lY3Rpb24gb2JqZWN0LlxuICAgIGlmICghd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmIHdpbmRvdy53ZWJraXRSVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uID0gZnVuY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpIHtcbiAgICAgICAgLy8gVHJhbnNsYXRlIGljZVRyYW5zcG9ydFBvbGljeSB0byBpY2VUcmFuc3BvcnRzLFxuICAgICAgICAvLyBzZWUgaHR0cHM6Ly9jb2RlLmdvb2dsZS5jb20vcC93ZWJydGMvaXNzdWVzL2RldGFpbD9pZD00ODY5XG4gICAgICAgIC8vIHRoaXMgd2FzIGZpeGVkIGluIE01NiBhbG9uZyB3aXRoIHVucHJlZml4aW5nIFJUQ1BlZXJDb25uZWN0aW9uLlxuICAgICAgICBsb2dnaW5nKCdQZWVyQ29ubmVjdGlvbicpO1xuICAgICAgICBpZiAocGNDb25maWcgJiYgcGNDb25maWcuaWNlVHJhbnNwb3J0UG9saWN5KSB7XG4gICAgICAgICAgcGNDb25maWcuaWNlVHJhbnNwb3J0cyA9IHBjQ29uZmlnLmljZVRyYW5zcG9ydFBvbGljeTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBuZXcgd2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKTtcbiAgICAgIH07XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlID1cbiAgICAgICAgICB3aW5kb3cud2Via2l0UlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlO1xuICAgICAgLy8gd3JhcCBzdGF0aWMgbWV0aG9kcy4gQ3VycmVudGx5IGp1c3QgZ2VuZXJhdGVDZXJ0aWZpY2F0ZS5cbiAgICAgIGlmICh3aW5kb3cud2Via2l0UlRDUGVlckNvbm5lY3Rpb24uZ2VuZXJhdGVDZXJ0aWZpY2F0ZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLCAnZ2VuZXJhdGVDZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHdpbmRvdy53ZWJraXRSVENQZWVyQ29ubmVjdGlvbi5nZW5lcmF0ZUNlcnRpZmljYXRlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIG1pZ3JhdGUgZnJvbSBub24tc3BlYyBSVENJY2VTZXJ2ZXIudXJsIHRvIFJUQ0ljZVNlcnZlci51cmxzXG4gICAgICB2YXIgT3JpZ1BlZXJDb25uZWN0aW9uID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uID0gZnVuY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpIHtcbiAgICAgICAgaWYgKHBjQ29uZmlnICYmIHBjQ29uZmlnLmljZVNlcnZlcnMpIHtcbiAgICAgICAgICB2YXIgbmV3SWNlU2VydmVycyA9IFtdO1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGNDb25maWcuaWNlU2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgdmFyIHNlcnZlciA9IHBjQ29uZmlnLmljZVNlcnZlcnNbaV07XG4gICAgICAgICAgICBpZiAoIXNlcnZlci5oYXNPd25Qcm9wZXJ0eSgndXJscycpICYmXG4gICAgICAgICAgICAgICAgc2VydmVyLmhhc093blByb3BlcnR5KCd1cmwnKSkge1xuICAgICAgICAgICAgICB1dGlscy5kZXByZWNhdGVkKCdSVENJY2VTZXJ2ZXIudXJsJywgJ1JUQ0ljZVNlcnZlci51cmxzJyk7XG4gICAgICAgICAgICAgIHNlcnZlciA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoc2VydmVyKSk7XG4gICAgICAgICAgICAgIHNlcnZlci51cmxzID0gc2VydmVyLnVybDtcbiAgICAgICAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKHNlcnZlcik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2gocGNDb25maWcuaWNlU2VydmVyc1tpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHBjQ29uZmlnLmljZVNlcnZlcnMgPSBuZXdJY2VTZXJ2ZXJzO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgT3JpZ1BlZXJDb25uZWN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKTtcbiAgICAgIH07XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlID0gT3JpZ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZTtcbiAgICAgIC8vIHdyYXAgc3RhdGljIG1ldGhvZHMuIEN1cnJlbnRseSBqdXN0IGdlbmVyYXRlQ2VydGlmaWNhdGUuXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLCAnZ2VuZXJhdGVDZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gT3JpZ1BlZXJDb25uZWN0aW9uLmdlbmVyYXRlQ2VydGlmaWNhdGU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHZhciBvcmlnR2V0U3RhdHMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbihzZWxlY3RvcixcbiAgICAgICAgc3VjY2Vzc0NhbGxiYWNrLCBlcnJvckNhbGxiYWNrKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG5cbiAgICAgIC8vIElmIHNlbGVjdG9yIGlzIGEgZnVuY3Rpb24gdGhlbiB3ZSBhcmUgaW4gdGhlIG9sZCBzdHlsZSBzdGF0cyBzbyBqdXN0XG4gICAgICAvLyBwYXNzIGJhY2sgdGhlIG9yaWdpbmFsIGdldFN0YXRzIGZvcm1hdCB0byBhdm9pZCBicmVha2luZyBvbGQgdXNlcnMuXG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDAgJiYgdHlwZW9mIHNlbGVjdG9yID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHJldHVybiBvcmlnR2V0U3RhdHMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIH1cblxuICAgICAgLy8gV2hlbiBzcGVjLXN0eWxlIGdldFN0YXRzIGlzIHN1cHBvcnRlZCwgcmV0dXJuIHRob3NlIHdoZW4gY2FsbGVkIHdpdGhcbiAgICAgIC8vIGVpdGhlciBubyBhcmd1bWVudHMgb3IgdGhlIHNlbGVjdG9yIGFyZ3VtZW50IGlzIG51bGwuXG4gICAgICBpZiAob3JpZ0dldFN0YXRzLmxlbmd0aCA9PT0gMCAmJiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCB8fFxuICAgICAgICAgIHR5cGVvZiBhcmd1bWVudHNbMF0gIT09ICdmdW5jdGlvbicpKSB7XG4gICAgICAgIHJldHVybiBvcmlnR2V0U3RhdHMuYXBwbHkodGhpcywgW10pO1xuICAgICAgfVxuXG4gICAgICB2YXIgZml4Q2hyb21lU3RhdHNfID0gZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgdmFyIHN0YW5kYXJkUmVwb3J0ID0ge307XG4gICAgICAgIHZhciByZXBvcnRzID0gcmVzcG9uc2UucmVzdWx0KCk7XG4gICAgICAgIHJlcG9ydHMuZm9yRWFjaChmdW5jdGlvbihyZXBvcnQpIHtcbiAgICAgICAgICB2YXIgc3RhbmRhcmRTdGF0cyA9IHtcbiAgICAgICAgICAgIGlkOiByZXBvcnQuaWQsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IHJlcG9ydC50aW1lc3RhbXAsXG4gICAgICAgICAgICB0eXBlOiB7XG4gICAgICAgICAgICAgIGxvY2FsY2FuZGlkYXRlOiAnbG9jYWwtY2FuZGlkYXRlJyxcbiAgICAgICAgICAgICAgcmVtb3RlY2FuZGlkYXRlOiAncmVtb3RlLWNhbmRpZGF0ZSdcbiAgICAgICAgICAgIH1bcmVwb3J0LnR5cGVdIHx8IHJlcG9ydC50eXBlXG4gICAgICAgICAgfTtcbiAgICAgICAgICByZXBvcnQubmFtZXMoKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgICAgICAgIHN0YW5kYXJkU3RhdHNbbmFtZV0gPSByZXBvcnQuc3RhdChuYW1lKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdGFuZGFyZFJlcG9ydFtzdGFuZGFyZFN0YXRzLmlkXSA9IHN0YW5kYXJkU3RhdHM7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBzdGFuZGFyZFJlcG9ydDtcbiAgICAgIH07XG5cbiAgICAgIC8vIHNoaW0gZ2V0U3RhdHMgd2l0aCBtYXBsaWtlIHN1cHBvcnRcbiAgICAgIHZhciBtYWtlTWFwU3RhdHMgPSBmdW5jdGlvbihzdGF0cykge1xuICAgICAgICByZXR1cm4gbmV3IE1hcChPYmplY3Qua2V5cyhzdGF0cykubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICAgIHJldHVybiBba2V5LCBzdGF0c1trZXldXTtcbiAgICAgICAgfSkpO1xuICAgICAgfTtcblxuICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPj0gMikge1xuICAgICAgICB2YXIgc3VjY2Vzc0NhbGxiYWNrV3JhcHBlcl8gPSBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICAgIGFyZ3NbMV0obWFrZU1hcFN0YXRzKGZpeENocm9tZVN0YXRzXyhyZXNwb25zZSkpKTtcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gb3JpZ0dldFN0YXRzLmFwcGx5KHRoaXMsIFtzdWNjZXNzQ2FsbGJhY2tXcmFwcGVyXyxcbiAgICAgICAgICBhcmd1bWVudHNbMF1dKTtcbiAgICAgIH1cblxuICAgICAgLy8gcHJvbWlzZS1zdXBwb3J0XG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgIG9yaWdHZXRTdGF0cy5hcHBseShwYywgW1xuICAgICAgICAgIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICByZXNvbHZlKG1ha2VNYXBTdGF0cyhmaXhDaHJvbWVTdGF0c18ocmVzcG9uc2UpKSk7XG4gICAgICAgICAgfSwgcmVqZWN0XSk7XG4gICAgICB9KS50aGVuKHN1Y2Nlc3NDYWxsYmFjaywgZXJyb3JDYWxsYmFjayk7XG4gICAgfTtcblxuICAgIC8vIGFkZCBwcm9taXNlIHN1cHBvcnQgLS0gbmF0aXZlbHkgYXZhaWxhYmxlIGluIENocm9tZSA1MVxuICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNTEpIHtcbiAgICAgIFsnc2V0TG9jYWxEZXNjcmlwdGlvbicsICdzZXRSZW1vdGVEZXNjcmlwdGlvbicsICdhZGRJY2VDYW5kaWRhdGUnXVxuICAgICAgICAgIC5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgICAgICAgdmFyIG5hdGl2ZU1ldGhvZCA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICAgICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICAgICAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgICAgICAgICBuYXRpdmVNZXRob2QuYXBwbHkocGMsIFthcmdzWzBdLCByZXNvbHZlLCByZWplY3RdKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIGlmIChhcmdzLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICByZXR1cm4gcHJvbWlzZS50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGFyZ3NbMV0uYXBwbHkobnVsbCwgW10pO1xuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBmdW5jdGlvbihlcnIpIHtcbiAgICAgICAgICAgICAgICBpZiAoYXJncy5sZW5ndGggPj0gMykge1xuICAgICAgICAgICAgICAgICAgYXJnc1syXS5hcHBseShudWxsLCBbZXJyXSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gcHJvbWlzZSBzdXBwb3J0IGZvciBjcmVhdGVPZmZlciBhbmQgY3JlYXRlQW5zd2VyLiBBdmFpbGFibGUgKHdpdGhvdXRcbiAgICAvLyBidWdzKSBzaW5jZSBNNTI6IGNyYnVnLzYxOTI4OVxuICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNTIpIHtcbiAgICAgIFsnY3JlYXRlT2ZmZXInLCAnY3JlYXRlQW5zd2VyJ10uZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgICAgdmFyIG5hdGl2ZU1ldGhvZCA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA8IDEgfHwgKGFyZ3VtZW50cy5sZW5ndGggPT09IDEgJiZcbiAgICAgICAgICAgICAgdHlwZW9mIGFyZ3VtZW50c1swXSA9PT0gJ29iamVjdCcpKSB7XG4gICAgICAgICAgICB2YXIgb3B0cyA9IGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyBhcmd1bWVudHNbMF0gOiB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgICAgICAgIG5hdGl2ZU1ldGhvZC5hcHBseShwYywgW3Jlc29sdmUsIHJlamVjdCwgb3B0c10pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIHNoaW0gaW1wbGljaXQgY3JlYXRpb24gb2YgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uL1JUQ0ljZUNhbmRpZGF0ZVxuICAgIFsnc2V0TG9jYWxEZXNjcmlwdGlvbicsICdzZXRSZW1vdGVEZXNjcmlwdGlvbicsICdhZGRJY2VDYW5kaWRhdGUnXVxuICAgICAgICAuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgICAgICB2YXIgbmF0aXZlTWV0aG9kID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgYXJndW1lbnRzWzBdID0gbmV3ICgobWV0aG9kID09PSAnYWRkSWNlQ2FuZGlkYXRlJykgP1xuICAgICAgICAgICAgICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUgOlxuICAgICAgICAgICAgICAgIHdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24pKGFyZ3VtZW50c1swXSk7XG4gICAgICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG5cbiAgICAvLyBzdXBwb3J0IGZvciBhZGRJY2VDYW5kaWRhdGUobnVsbCBvciB1bmRlZmluZWQpXG4gICAgdmFyIG5hdGl2ZUFkZEljZUNhbmRpZGF0ZSA9XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIWFyZ3VtZW50c1swXSkge1xuICAgICAgICBpZiAoYXJndW1lbnRzWzFdKSB7XG4gICAgICAgICAgYXJndW1lbnRzWzFdLmFwcGx5KG51bGwpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVBZGRJY2VDYW5kaWRhdGUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscy5qcycpO1xudmFyIGxvZ2dpbmcgPSB1dGlscy5sb2c7XG5cbi8vIEV4cG9zZSBwdWJsaWMgbWV0aG9kcy5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24od2luZG93KSB7XG4gIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcbiAgdmFyIG5hdmlnYXRvciA9IHdpbmRvdyAmJiB3aW5kb3cubmF2aWdhdG9yO1xuXG4gIHZhciBjb25zdHJhaW50c1RvQ2hyb21lXyA9IGZ1bmN0aW9uKGMpIHtcbiAgICBpZiAodHlwZW9mIGMgIT09ICdvYmplY3QnIHx8IGMubWFuZGF0b3J5IHx8IGMub3B0aW9uYWwpIHtcbiAgICAgIHJldHVybiBjO1xuICAgIH1cbiAgICB2YXIgY2MgPSB7fTtcbiAgICBPYmplY3Qua2V5cyhjKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgaWYgKGtleSA9PT0gJ3JlcXVpcmUnIHx8IGtleSA9PT0gJ2FkdmFuY2VkJyB8fCBrZXkgPT09ICdtZWRpYVNvdXJjZScpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIHIgPSAodHlwZW9mIGNba2V5XSA9PT0gJ29iamVjdCcpID8gY1trZXldIDoge2lkZWFsOiBjW2tleV19O1xuICAgICAgaWYgKHIuZXhhY3QgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygci5leGFjdCA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgci5taW4gPSByLm1heCA9IHIuZXhhY3Q7XG4gICAgICB9XG4gICAgICB2YXIgb2xkbmFtZV8gPSBmdW5jdGlvbihwcmVmaXgsIG5hbWUpIHtcbiAgICAgICAgaWYgKHByZWZpeCkge1xuICAgICAgICAgIHJldHVybiBwcmVmaXggKyBuYW1lLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgbmFtZS5zbGljZSgxKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gKG5hbWUgPT09ICdkZXZpY2VJZCcpID8gJ3NvdXJjZUlkJyA6IG5hbWU7XG4gICAgICB9O1xuICAgICAgaWYgKHIuaWRlYWwgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjYy5vcHRpb25hbCA9IGNjLm9wdGlvbmFsIHx8IFtdO1xuICAgICAgICB2YXIgb2MgPSB7fTtcbiAgICAgICAgaWYgKHR5cGVvZiByLmlkZWFsID09PSAnbnVtYmVyJykge1xuICAgICAgICAgIG9jW29sZG5hbWVfKCdtaW4nLCBrZXkpXSA9IHIuaWRlYWw7XG4gICAgICAgICAgY2Mub3B0aW9uYWwucHVzaChvYyk7XG4gICAgICAgICAgb2MgPSB7fTtcbiAgICAgICAgICBvY1tvbGRuYW1lXygnbWF4Jywga2V5KV0gPSByLmlkZWFsO1xuICAgICAgICAgIGNjLm9wdGlvbmFsLnB1c2gob2MpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG9jW29sZG5hbWVfKCcnLCBrZXkpXSA9IHIuaWRlYWw7XG4gICAgICAgICAgY2Mub3B0aW9uYWwucHVzaChvYyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChyLmV4YWN0ICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHIuZXhhY3QgIT09ICdudW1iZXInKSB7XG4gICAgICAgIGNjLm1hbmRhdG9yeSA9IGNjLm1hbmRhdG9yeSB8fCB7fTtcbiAgICAgICAgY2MubWFuZGF0b3J5W29sZG5hbWVfKCcnLCBrZXkpXSA9IHIuZXhhY3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBbJ21pbicsICdtYXgnXS5mb3JFYWNoKGZ1bmN0aW9uKG1peCkge1xuICAgICAgICAgIGlmIChyW21peF0gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY2MubWFuZGF0b3J5ID0gY2MubWFuZGF0b3J5IHx8IHt9O1xuICAgICAgICAgICAgY2MubWFuZGF0b3J5W29sZG5hbWVfKG1peCwga2V5KV0gPSByW21peF07XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICBpZiAoYy5hZHZhbmNlZCkge1xuICAgICAgY2Mub3B0aW9uYWwgPSAoY2Mub3B0aW9uYWwgfHwgW10pLmNvbmNhdChjLmFkdmFuY2VkKTtcbiAgICB9XG4gICAgcmV0dXJuIGNjO1xuICB9O1xuXG4gIHZhciBzaGltQ29uc3RyYWludHNfID0gZnVuY3Rpb24oY29uc3RyYWludHMsIGZ1bmMpIHtcbiAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA+PSA2MSkge1xuICAgICAgcmV0dXJuIGZ1bmMoY29uc3RyYWludHMpO1xuICAgIH1cbiAgICBjb25zdHJhaW50cyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICBpZiAoY29uc3RyYWludHMgJiYgdHlwZW9mIGNvbnN0cmFpbnRzLmF1ZGlvID09PSAnb2JqZWN0Jykge1xuICAgICAgdmFyIHJlbWFwID0gZnVuY3Rpb24ob2JqLCBhLCBiKSB7XG4gICAgICAgIGlmIChhIGluIG9iaiAmJiAhKGIgaW4gb2JqKSkge1xuICAgICAgICAgIG9ialtiXSA9IG9ialthXTtcbiAgICAgICAgICBkZWxldGUgb2JqW2FdO1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY29uc3RyYWludHMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgICByZW1hcChjb25zdHJhaW50cy5hdWRpbywgJ2F1dG9HYWluQ29udHJvbCcsICdnb29nQXV0b0dhaW5Db250cm9sJyk7XG4gICAgICByZW1hcChjb25zdHJhaW50cy5hdWRpbywgJ25vaXNlU3VwcHJlc3Npb24nLCAnZ29vZ05vaXNlU3VwcHJlc3Npb24nKTtcbiAgICAgIGNvbnN0cmFpbnRzLmF1ZGlvID0gY29uc3RyYWludHNUb0Nocm9tZV8oY29uc3RyYWludHMuYXVkaW8pO1xuICAgIH1cbiAgICBpZiAoY29uc3RyYWludHMgJiYgdHlwZW9mIGNvbnN0cmFpbnRzLnZpZGVvID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gU2hpbSBmYWNpbmdNb2RlIGZvciBtb2JpbGUgJiBzdXJmYWNlIHByby5cbiAgICAgIHZhciBmYWNlID0gY29uc3RyYWludHMudmlkZW8uZmFjaW5nTW9kZTtcbiAgICAgIGZhY2UgPSBmYWNlICYmICgodHlwZW9mIGZhY2UgPT09ICdvYmplY3QnKSA/IGZhY2UgOiB7aWRlYWw6IGZhY2V9KTtcbiAgICAgIHZhciBnZXRTdXBwb3J0ZWRGYWNpbmdNb2RlTGllcyA9IGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA2NjtcblxuICAgICAgaWYgKChmYWNlICYmIChmYWNlLmV4YWN0ID09PSAndXNlcicgfHwgZmFjZS5leGFjdCA9PT0gJ2Vudmlyb25tZW50JyB8fFxuICAgICAgICAgICAgICAgICAgICBmYWNlLmlkZWFsID09PSAndXNlcicgfHwgZmFjZS5pZGVhbCA9PT0gJ2Vudmlyb25tZW50JykpICYmXG4gICAgICAgICAgIShuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFN1cHBvcnRlZENvbnN0cmFpbnRzICYmXG4gICAgICAgICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFN1cHBvcnRlZENvbnN0cmFpbnRzKCkuZmFjaW5nTW9kZSAmJlxuICAgICAgICAgICAgIWdldFN1cHBvcnRlZEZhY2luZ01vZGVMaWVzKSkge1xuICAgICAgICBkZWxldGUgY29uc3RyYWludHMudmlkZW8uZmFjaW5nTW9kZTtcbiAgICAgICAgdmFyIG1hdGNoZXM7XG4gICAgICAgIGlmIChmYWNlLmV4YWN0ID09PSAnZW52aXJvbm1lbnQnIHx8IGZhY2UuaWRlYWwgPT09ICdlbnZpcm9ubWVudCcpIHtcbiAgICAgICAgICBtYXRjaGVzID0gWydiYWNrJywgJ3JlYXInXTtcbiAgICAgICAgfSBlbHNlIGlmIChmYWNlLmV4YWN0ID09PSAndXNlcicgfHwgZmFjZS5pZGVhbCA9PT0gJ3VzZXInKSB7XG4gICAgICAgICAgbWF0Y2hlcyA9IFsnZnJvbnQnXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobWF0Y2hlcykge1xuICAgICAgICAgIC8vIExvb2sgZm9yIG1hdGNoZXMgaW4gbGFiZWwsIG9yIHVzZSBsYXN0IGNhbSBmb3IgYmFjayAodHlwaWNhbCkuXG4gICAgICAgICAgcmV0dXJuIG5hdmlnYXRvci5tZWRpYURldmljZXMuZW51bWVyYXRlRGV2aWNlcygpXG4gICAgICAgICAgLnRoZW4oZnVuY3Rpb24oZGV2aWNlcykge1xuICAgICAgICAgICAgZGV2aWNlcyA9IGRldmljZXMuZmlsdGVyKGZ1bmN0aW9uKGQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGQua2luZCA9PT0gJ3ZpZGVvaW5wdXQnO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB2YXIgZGV2ID0gZGV2aWNlcy5maW5kKGZ1bmN0aW9uKGQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG1hdGNoZXMuc29tZShmdW5jdGlvbihtYXRjaCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBkLmxhYmVsLnRvTG93ZXJDYXNlKCkuaW5kZXhPZihtYXRjaCkgIT09IC0xO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYgKCFkZXYgJiYgZGV2aWNlcy5sZW5ndGggJiYgbWF0Y2hlcy5pbmRleE9mKCdiYWNrJykgIT09IC0xKSB7XG4gICAgICAgICAgICAgIGRldiA9IGRldmljZXNbZGV2aWNlcy5sZW5ndGggLSAxXTsgLy8gbW9yZSBsaWtlbHkgdGhlIGJhY2sgY2FtXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoZGV2KSB7XG4gICAgICAgICAgICAgIGNvbnN0cmFpbnRzLnZpZGVvLmRldmljZUlkID0gZmFjZS5leGFjdCA/IHtleGFjdDogZGV2LmRldmljZUlkfSA6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtpZGVhbDogZGV2LmRldmljZUlkfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0cmFpbnRzLnZpZGVvID0gY29uc3RyYWludHNUb0Nocm9tZV8oY29uc3RyYWludHMudmlkZW8pO1xuICAgICAgICAgICAgbG9nZ2luZygnY2hyb21lOiAnICsgSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICAgICAgICAgIHJldHVybiBmdW5jKGNvbnN0cmFpbnRzKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3RyYWludHMudmlkZW8gPSBjb25zdHJhaW50c1RvQ2hyb21lXyhjb25zdHJhaW50cy52aWRlbyk7XG4gICAgfVxuICAgIGxvZ2dpbmcoJ2Nocm9tZTogJyArIEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgcmV0dXJuIGZ1bmMoY29uc3RyYWludHMpO1xuICB9O1xuXG4gIHZhciBzaGltRXJyb3JfID0gZnVuY3Rpb24oZSkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB7XG4gICAgICAgIFBlcm1pc3Npb25EZW5pZWRFcnJvcjogJ05vdEFsbG93ZWRFcnJvcicsXG4gICAgICAgIFBlcm1pc3Npb25EaXNtaXNzZWRFcnJvcjogJ05vdEFsbG93ZWRFcnJvcicsXG4gICAgICAgIEludmFsaWRTdGF0ZUVycm9yOiAnTm90QWxsb3dlZEVycm9yJyxcbiAgICAgICAgRGV2aWNlc05vdEZvdW5kRXJyb3I6ICdOb3RGb3VuZEVycm9yJyxcbiAgICAgICAgQ29uc3RyYWludE5vdFNhdGlzZmllZEVycm9yOiAnT3ZlcmNvbnN0cmFpbmVkRXJyb3InLFxuICAgICAgICBUcmFja1N0YXJ0RXJyb3I6ICdOb3RSZWFkYWJsZUVycm9yJyxcbiAgICAgICAgTWVkaWFEZXZpY2VGYWlsZWREdWVUb1NodXRkb3duOiAnTm90QWxsb3dlZEVycm9yJyxcbiAgICAgICAgTWVkaWFEZXZpY2VLaWxsU3dpdGNoT246ICdOb3RBbGxvd2VkRXJyb3InLFxuICAgICAgICBUYWJDYXB0dXJlRXJyb3I6ICdBYm9ydEVycm9yJyxcbiAgICAgICAgU2NyZWVuQ2FwdHVyZUVycm9yOiAnQWJvcnRFcnJvcicsXG4gICAgICAgIERldmljZUNhcHR1cmVFcnJvcjogJ0Fib3J0RXJyb3InXG4gICAgICB9W2UubmFtZV0gfHwgZS5uYW1lLFxuICAgICAgbWVzc2FnZTogZS5tZXNzYWdlLFxuICAgICAgY29uc3RyYWludDogZS5jb25zdHJhaW50TmFtZSxcbiAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubmFtZSArICh0aGlzLm1lc3NhZ2UgJiYgJzogJykgKyB0aGlzLm1lc3NhZ2U7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcblxuICB2YXIgZ2V0VXNlck1lZGlhXyA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzLCBvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgICBzaGltQ29uc3RyYWludHNfKGNvbnN0cmFpbnRzLCBmdW5jdGlvbihjKSB7XG4gICAgICBuYXZpZ2F0b3Iud2Via2l0R2V0VXNlck1lZGlhKGMsIG9uU3VjY2VzcywgZnVuY3Rpb24oZSkge1xuICAgICAgICBpZiAob25FcnJvcikge1xuICAgICAgICAgIG9uRXJyb3Ioc2hpbUVycm9yXyhlKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuICB9O1xuXG4gIG5hdmlnYXRvci5nZXRVc2VyTWVkaWEgPSBnZXRVc2VyTWVkaWFfO1xuXG4gIC8vIFJldHVybnMgdGhlIHJlc3VsdCBvZiBnZXRVc2VyTWVkaWEgYXMgYSBQcm9taXNlLlxuICB2YXIgZ2V0VXNlck1lZGlhUHJvbWlzZV8gPSBmdW5jdGlvbihjb25zdHJhaW50cykge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIG5hdmlnYXRvci5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMsIHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG4gIH07XG5cbiAgaWYgKCFuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKSB7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcyA9IHtcbiAgICAgIGdldFVzZXJNZWRpYTogZ2V0VXNlck1lZGlhUHJvbWlzZV8sXG4gICAgICBlbnVtZXJhdGVEZXZpY2VzOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUpIHtcbiAgICAgICAgICB2YXIga2luZHMgPSB7YXVkaW86ICdhdWRpb2lucHV0JywgdmlkZW86ICd2aWRlb2lucHV0J307XG4gICAgICAgICAgcmV0dXJuIHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrLmdldFNvdXJjZXMoZnVuY3Rpb24oZGV2aWNlcykge1xuICAgICAgICAgICAgcmVzb2x2ZShkZXZpY2VzLm1hcChmdW5jdGlvbihkZXZpY2UpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIHtsYWJlbDogZGV2aWNlLmxhYmVsLFxuICAgICAgICAgICAgICAgIGtpbmQ6IGtpbmRzW2RldmljZS5raW5kXSxcbiAgICAgICAgICAgICAgICBkZXZpY2VJZDogZGV2aWNlLmlkLFxuICAgICAgICAgICAgICAgIGdyb3VwSWQ6ICcnfTtcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICB9LFxuICAgICAgZ2V0U3VwcG9ydGVkQ29uc3RyYWludHM6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGRldmljZUlkOiB0cnVlLCBlY2hvQ2FuY2VsbGF0aW9uOiB0cnVlLCBmYWNpbmdNb2RlOiB0cnVlLFxuICAgICAgICAgIGZyYW1lUmF0ZTogdHJ1ZSwgaGVpZ2h0OiB0cnVlLCB3aWR0aDogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvLyBBIHNoaW0gZm9yIGdldFVzZXJNZWRpYSBtZXRob2Qgb24gdGhlIG1lZGlhRGV2aWNlcyBvYmplY3QuXG4gIC8vIFRPRE8oS2FwdGVuSmFuc3NvbikgcmVtb3ZlIG9uY2UgaW1wbGVtZW50ZWQgaW4gQ2hyb21lIHN0YWJsZS5cbiAgaWYgKCFuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSkge1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oY29uc3RyYWludHMpIHtcbiAgICAgIHJldHVybiBnZXRVc2VyTWVkaWFQcm9taXNlXyhjb25zdHJhaW50cyk7XG4gICAgfTtcbiAgfSBlbHNlIHtcbiAgICAvLyBFdmVuIHRob3VnaCBDaHJvbWUgNDUgaGFzIG5hdmlnYXRvci5tZWRpYURldmljZXMgYW5kIGEgZ2V0VXNlck1lZGlhXG4gICAgLy8gZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhIFByb21pc2UsIGl0IGRvZXMgbm90IGFjY2VwdCBzcGVjLXN0eWxlXG4gICAgLy8gY29uc3RyYWludHMuXG4gICAgdmFyIG9yaWdHZXRVc2VyTWVkaWEgPSBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYS5cbiAgICAgICAgYmluZChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGNzKSB7XG4gICAgICByZXR1cm4gc2hpbUNvbnN0cmFpbnRzXyhjcywgZnVuY3Rpb24oYykge1xuICAgICAgICByZXR1cm4gb3JpZ0dldFVzZXJNZWRpYShjKS50aGVuKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIGlmIChjLmF1ZGlvICYmICFzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKS5sZW5ndGggfHxcbiAgICAgICAgICAgICAgYy52aWRlbyAmJiAhc3RyZWFtLmdldFZpZGVvVHJhY2tzKCkubGVuZ3RoKSB7XG4gICAgICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB0cmFjay5zdG9wKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJycsICdOb3RGb3VuZEVycm9yJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBzdHJlYW07XG4gICAgICAgIH0sIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3Qoc2hpbUVycm9yXyhlKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfVxuXG4gIC8vIER1bW15IGRldmljZWNoYW5nZSBldmVudCBtZXRob2RzLlxuICAvLyBUT0RPKEthcHRlbkphbnNzb24pIHJlbW92ZSBvbmNlIGltcGxlbWVudGVkIGluIENocm9tZSBzdGFibGUuXG4gIGlmICh0eXBlb2YgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5hZGRFdmVudExpc3RlbmVyID09PSAndW5kZWZpbmVkJykge1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuYWRkRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKCkge1xuICAgICAgbG9nZ2luZygnRHVtbXkgbWVkaWFEZXZpY2VzLmFkZEV2ZW50TGlzdGVuZXIgY2FsbGVkLicpO1xuICAgIH07XG4gIH1cbiAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLnJlbW92ZUV2ZW50TGlzdGVuZXIgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5yZW1vdmVFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oKSB7XG4gICAgICBsb2dnaW5nKCdEdW1teSBtZWRpYURldmljZXMucmVtb3ZlRXZlbnRMaXN0ZW5lciBjYWxsZWQuJyk7XG4gICAgfTtcbiAgfVxufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE3IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgU0RQVXRpbHMgPSByZXF1aXJlKCdzZHAnKTtcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vdXRpbHMnKTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNoaW1SVENJY2VDYW5kaWRhdGU6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIGZvdW5kYXRpb24gaXMgYXJiaXRyYXJpbHkgY2hvc2VuIGFzIGFuIGluZGljYXRvciBmb3IgZnVsbCBzdXBwb3J0IGZvclxuICAgIC8vIGh0dHBzOi8vdzNjLmdpdGh1Yi5pby93ZWJydGMtcGMvI3J0Y2ljZWNhbmRpZGF0ZS1pbnRlcmZhY2VcbiAgICBpZiAoIXdpbmRvdy5SVENJY2VDYW5kaWRhdGUgfHwgKHdpbmRvdy5SVENJY2VDYW5kaWRhdGUgJiYgJ2ZvdW5kYXRpb24nIGluXG4gICAgICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUucHJvdG90eXBlKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBOYXRpdmVSVENJY2VDYW5kaWRhdGUgPSB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlO1xuICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUgPSBmdW5jdGlvbihhcmdzKSB7XG4gICAgICAvLyBSZW1vdmUgdGhlIGE9IHdoaWNoIHNob3VsZG4ndCBiZSBwYXJ0IG9mIHRoZSBjYW5kaWRhdGUgc3RyaW5nLlxuICAgICAgaWYgKHR5cGVvZiBhcmdzID09PSAnb2JqZWN0JyAmJiBhcmdzLmNhbmRpZGF0ZSAmJlxuICAgICAgICAgIGFyZ3MuY2FuZGlkYXRlLmluZGV4T2YoJ2E9JykgPT09IDApIHtcbiAgICAgICAgYXJncyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoYXJncykpO1xuICAgICAgICBhcmdzLmNhbmRpZGF0ZSA9IGFyZ3MuY2FuZGlkYXRlLnN1YnN0cigyKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGFyZ3MuY2FuZGlkYXRlICYmIGFyZ3MuY2FuZGlkYXRlLmxlbmd0aCkge1xuICAgICAgICAvLyBBdWdtZW50IHRoZSBuYXRpdmUgY2FuZGlkYXRlIHdpdGggdGhlIHBhcnNlZCBmaWVsZHMuXG4gICAgICAgIHZhciBuYXRpdmVDYW5kaWRhdGUgPSBuZXcgTmF0aXZlUlRDSWNlQ2FuZGlkYXRlKGFyZ3MpO1xuICAgICAgICB2YXIgcGFyc2VkQ2FuZGlkYXRlID0gU0RQVXRpbHMucGFyc2VDYW5kaWRhdGUoYXJncy5jYW5kaWRhdGUpO1xuICAgICAgICB2YXIgYXVnbWVudGVkQ2FuZGlkYXRlID0gT2JqZWN0LmFzc2lnbihuYXRpdmVDYW5kaWRhdGUsXG4gICAgICAgICAgICBwYXJzZWRDYW5kaWRhdGUpO1xuXG4gICAgICAgIC8vIEFkZCBhIHNlcmlhbGl6ZXIgdGhhdCBkb2VzIG5vdCBzZXJpYWxpemUgdGhlIGV4dHJhIGF0dHJpYnV0ZXMuXG4gICAgICAgIGF1Z21lbnRlZENhbmRpZGF0ZS50b0pTT04gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY2FuZGlkYXRlOiBhdWdtZW50ZWRDYW5kaWRhdGUuY2FuZGlkYXRlLFxuICAgICAgICAgICAgc2RwTWlkOiBhdWdtZW50ZWRDYW5kaWRhdGUuc2RwTWlkLFxuICAgICAgICAgICAgc2RwTUxpbmVJbmRleDogYXVnbWVudGVkQ2FuZGlkYXRlLnNkcE1MaW5lSW5kZXgsXG4gICAgICAgICAgICB1c2VybmFtZUZyYWdtZW50OiBhdWdtZW50ZWRDYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCxcbiAgICAgICAgICB9O1xuICAgICAgICB9O1xuICAgICAgICByZXR1cm4gYXVnbWVudGVkQ2FuZGlkYXRlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBOYXRpdmVSVENJY2VDYW5kaWRhdGUoYXJncyk7XG4gICAgfTtcbiAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlLnByb3RvdHlwZSA9IE5hdGl2ZVJUQ0ljZUNhbmRpZGF0ZS5wcm90b3R5cGU7XG5cbiAgICAvLyBIb29rIHVwIHRoZSBhdWdtZW50ZWQgY2FuZGlkYXRlIGluIG9uaWNlY2FuZGlkYXRlIGFuZFxuICAgIC8vIGFkZEV2ZW50TGlzdGVuZXIoJ2ljZWNhbmRpZGF0ZScsIC4uLilcbiAgICB1dGlscy53cmFwUGVlckNvbm5lY3Rpb25FdmVudCh3aW5kb3csICdpY2VjYW5kaWRhdGUnLCBmdW5jdGlvbihlKSB7XG4gICAgICBpZiAoZS5jYW5kaWRhdGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGUsICdjYW5kaWRhdGUnLCB7XG4gICAgICAgICAgdmFsdWU6IG5ldyB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlKGUuY2FuZGlkYXRlKSxcbiAgICAgICAgICB3cml0YWJsZTogJ2ZhbHNlJ1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBlO1xuICAgIH0pO1xuICB9LFxuXG4gIC8vIHNoaW1DcmVhdGVPYmplY3RVUkwgbXVzdCBiZSBjYWxsZWQgYmVmb3JlIHNoaW1Tb3VyY2VPYmplY3QgdG8gYXZvaWQgbG9vcC5cblxuICBzaGltQ3JlYXRlT2JqZWN0VVJMOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgVVJMID0gd2luZG93ICYmIHdpbmRvdy5VUkw7XG5cbiAgICBpZiAoISh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuSFRNTE1lZGlhRWxlbWVudCAmJlxuICAgICAgICAgICdzcmNPYmplY3QnIGluIHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSAmJlxuICAgICAgICBVUkwuY3JlYXRlT2JqZWN0VVJMICYmIFVSTC5yZXZva2VPYmplY3RVUkwpKSB7XG4gICAgICAvLyBPbmx5IHNoaW0gQ3JlYXRlT2JqZWN0VVJMIHVzaW5nIHNyY09iamVjdCBpZiBzcmNPYmplY3QgZXhpc3RzLlxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICB2YXIgbmF0aXZlQ3JlYXRlT2JqZWN0VVJMID0gVVJMLmNyZWF0ZU9iamVjdFVSTC5iaW5kKFVSTCk7XG4gICAgdmFyIG5hdGl2ZVJldm9rZU9iamVjdFVSTCA9IFVSTC5yZXZva2VPYmplY3RVUkwuYmluZChVUkwpO1xuICAgIHZhciBzdHJlYW1zID0gbmV3IE1hcCgpLCBuZXdJZCA9IDA7XG5cbiAgICBVUkwuY3JlYXRlT2JqZWN0VVJMID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICBpZiAoJ2dldFRyYWNrcycgaW4gc3RyZWFtKSB7XG4gICAgICAgIHZhciB1cmwgPSAncG9seWJsb2I6JyArICgrK25ld0lkKTtcbiAgICAgICAgc3RyZWFtcy5zZXQodXJsLCBzdHJlYW0pO1xuICAgICAgICB1dGlscy5kZXByZWNhdGVkKCdVUkwuY3JlYXRlT2JqZWN0VVJMKHN0cmVhbSknLFxuICAgICAgICAgICAgJ2VsZW0uc3JjT2JqZWN0ID0gc3RyZWFtJyk7XG4gICAgICAgIHJldHVybiB1cmw7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlQ3JlYXRlT2JqZWN0VVJMKHN0cmVhbSk7XG4gICAgfTtcbiAgICBVUkwucmV2b2tlT2JqZWN0VVJMID0gZnVuY3Rpb24odXJsKSB7XG4gICAgICBuYXRpdmVSZXZva2VPYmplY3RVUkwodXJsKTtcbiAgICAgIHN0cmVhbXMuZGVsZXRlKHVybCk7XG4gICAgfTtcblxuICAgIHZhciBkc2MgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnc3JjJyk7XG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSwgJ3NyYycsIHtcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBkc2MuZ2V0LmFwcGx5KHRoaXMpO1xuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odXJsKSB7XG4gICAgICAgIHRoaXMuc3JjT2JqZWN0ID0gc3RyZWFtcy5nZXQodXJsKSB8fCBudWxsO1xuICAgICAgICByZXR1cm4gZHNjLnNldC5hcHBseSh0aGlzLCBbdXJsXSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB2YXIgbmF0aXZlU2V0QXR0cmlidXRlID0gd2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLnNldEF0dHJpYnV0ZTtcbiAgICB3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUuc2V0QXR0cmlidXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMiAmJlxuICAgICAgICAgICgnJyArIGFyZ3VtZW50c1swXSkudG9Mb3dlckNhc2UoKSA9PT0gJ3NyYycpIHtcbiAgICAgICAgdGhpcy5zcmNPYmplY3QgPSBzdHJlYW1zLmdldChhcmd1bWVudHNbMV0pIHx8IG51bGw7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlU2V0QXR0cmlidXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltTWF4TWVzc2FnZVNpemU6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICh3aW5kb3cuUlRDU2N0cFRyYW5zcG9ydCB8fCAhd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcblxuICAgIGlmICghKCdzY3RwJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdzY3RwJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0eXBlb2YgdGhpcy5fc2N0cCA9PT0gJ3VuZGVmaW5lZCcgPyBudWxsIDogdGhpcy5fc2N0cDtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdmFyIHNjdHBJbkRlc2NyaXB0aW9uID0gZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICAgIHZhciBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoZGVzY3JpcHRpb24uc2RwKTtcbiAgICAgIHNlY3Rpb25zLnNoaWZ0KCk7XG4gICAgICByZXR1cm4gc2VjdGlvbnMuc29tZShmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgICAgICAgdmFyIG1MaW5lID0gU0RQVXRpbHMucGFyc2VNTGluZShtZWRpYVNlY3Rpb24pO1xuICAgICAgICByZXR1cm4gbUxpbmUgJiYgbUxpbmUua2luZCA9PT0gJ2FwcGxpY2F0aW9uJ1xuICAgICAgICAgICAgJiYgbUxpbmUucHJvdG9jb2wuaW5kZXhPZignU0NUUCcpICE9PSAtMTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICB2YXIgZ2V0UmVtb3RlRmlyZWZveFZlcnNpb24gPSBmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgICAgLy8gVE9ETzogSXMgdGhlcmUgYSBiZXR0ZXIgc29sdXRpb24gZm9yIGRldGVjdGluZyBGaXJlZm94P1xuICAgICAgdmFyIG1hdGNoID0gZGVzY3JpcHRpb24uc2RwLm1hdGNoKC9tb3ppbGxhLi4uVEhJU19JU19TRFBBUlRBLShcXGQrKS8pO1xuICAgICAgaWYgKG1hdGNoID09PSBudWxsIHx8IG1hdGNoLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgcmV0dXJuIC0xO1xuICAgICAgfVxuICAgICAgdmFyIHZlcnNpb24gPSBwYXJzZUludChtYXRjaFsxXSwgMTApO1xuICAgICAgLy8gVGVzdCBmb3IgTmFOICh5ZXMsIHRoaXMgaXMgdWdseSlcbiAgICAgIHJldHVybiB2ZXJzaW9uICE9PSB2ZXJzaW9uID8gLTEgOiB2ZXJzaW9uO1xuICAgIH07XG5cbiAgICB2YXIgZ2V0Q2FuU2VuZE1heE1lc3NhZ2VTaXplID0gZnVuY3Rpb24ocmVtb3RlSXNGaXJlZm94KSB7XG4gICAgICAvLyBFdmVyeSBpbXBsZW1lbnRhdGlvbiB3ZSBrbm93IGNhbiBzZW5kIGF0IGxlYXN0IDY0IEtpQi5cbiAgICAgIC8vIE5vdGU6IEFsdGhvdWdoIENocm9tZSBpcyB0ZWNobmljYWxseSBhYmxlIHRvIHNlbmQgdXAgdG8gMjU2IEtpQiwgdGhlXG4gICAgICAvLyAgICAgICBkYXRhIGRvZXMgbm90IHJlYWNoIHRoZSBvdGhlciBwZWVyIHJlbGlhYmx5LlxuICAgICAgLy8gICAgICAgU2VlOiBodHRwczovL2J1Z3MuY2hyb21pdW0ub3JnL3Avd2VicnRjL2lzc3Vlcy9kZXRhaWw/aWQ9ODQxOVxuICAgICAgdmFyIGNhblNlbmRNYXhNZXNzYWdlU2l6ZSA9IDY1NTM2O1xuICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDU3KSB7XG4gICAgICAgICAgaWYgKHJlbW90ZUlzRmlyZWZveCA9PT0gLTEpIHtcbiAgICAgICAgICAgIC8vIEZGIDwgNTcgd2lsbCBzZW5kIGluIDE2IEtpQiBjaHVua3MgdXNpbmcgdGhlIGRlcHJlY2F0ZWQgUFBJRFxuICAgICAgICAgICAgLy8gZnJhZ21lbnRhdGlvbi5cbiAgICAgICAgICAgIGNhblNlbmRNYXhNZXNzYWdlU2l6ZSA9IDE2Mzg0O1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBIb3dldmVyLCBvdGhlciBGRiAoYW5kIFJBV1JUQykgY2FuIHJlYXNzZW1ibGUgUFBJRC1mcmFnbWVudGVkXG4gICAgICAgICAgICAvLyBtZXNzYWdlcy4gVGh1cywgc3VwcG9ydGluZyB+MiBHaUIgd2hlbiBzZW5kaW5nLlxuICAgICAgICAgICAgY2FuU2VuZE1heE1lc3NhZ2VTaXplID0gMjE0NzQ4MzYzNztcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDYwKSB7XG4gICAgICAgICAgLy8gQ3VycmVudGx5LCBhbGwgRkYgPj0gNTcgd2lsbCByZXNldCB0aGUgcmVtb3RlIG1heGltdW0gbWVzc2FnZSBzaXplXG4gICAgICAgICAgLy8gdG8gdGhlIGRlZmF1bHQgdmFsdWUgd2hlbiBhIGRhdGEgY2hhbm5lbCBpcyBjcmVhdGVkIGF0IGEgbGF0ZXJcbiAgICAgICAgICAvLyBzdGFnZS4gOihcbiAgICAgICAgICAvLyBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTE0MjY4MzFcbiAgICAgICAgICBjYW5TZW5kTWF4TWVzc2FnZVNpemUgPVxuICAgICAgICAgICAgYnJvd3NlckRldGFpbHMudmVyc2lvbiA9PT0gNTcgPyA2NTUzNSA6IDY1NTM2O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEZGID49IDYwIHN1cHBvcnRzIHNlbmRpbmcgfjIgR2lCXG4gICAgICAgICAgY2FuU2VuZE1heE1lc3NhZ2VTaXplID0gMjE0NzQ4MzYzNztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGNhblNlbmRNYXhNZXNzYWdlU2l6ZTtcbiAgICB9O1xuXG4gICAgdmFyIGdldE1heE1lc3NhZ2VTaXplID0gZnVuY3Rpb24oZGVzY3JpcHRpb24sIHJlbW90ZUlzRmlyZWZveCkge1xuICAgICAgLy8gTm90ZTogNjU1MzYgYnl0ZXMgaXMgdGhlIGRlZmF1bHQgdmFsdWUgZnJvbSB0aGUgU0RQIHNwZWMuIEFsc28sXG4gICAgICAvLyAgICAgICBldmVyeSBpbXBsZW1lbnRhdGlvbiB3ZSBrbm93IHN1cHBvcnRzIHJlY2VpdmluZyA2NTUzNiBieXRlcy5cbiAgICAgIHZhciBtYXhNZXNzYWdlU2l6ZSA9IDY1NTM2O1xuXG4gICAgICAvLyBGRiA1NyBoYXMgYSBzbGlnaHRseSBpbmNvcnJlY3QgZGVmYXVsdCByZW1vdGUgbWF4IG1lc3NhZ2Ugc2l6ZSwgc29cbiAgICAgIC8vIHdlIG5lZWQgdG8gYWRqdXN0IGl0IGhlcmUgdG8gYXZvaWQgYSBmYWlsdXJlIHdoZW4gc2VuZGluZy5cbiAgICAgIC8vIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTQyNTY5N1xuICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94J1xuICAgICAgICAgICAmJiBicm93c2VyRGV0YWlscy52ZXJzaW9uID09PSA1Nykge1xuICAgICAgICBtYXhNZXNzYWdlU2l6ZSA9IDY1NTM1O1xuICAgICAgfVxuXG4gICAgICB2YXIgbWF0Y2ggPSBTRFBVdGlscy5tYXRjaFByZWZpeChkZXNjcmlwdGlvbi5zZHAsICdhPW1heC1tZXNzYWdlLXNpemU6Jyk7XG4gICAgICBpZiAobWF0Y2gubGVuZ3RoID4gMCkge1xuICAgICAgICBtYXhNZXNzYWdlU2l6ZSA9IHBhcnNlSW50KG1hdGNoWzBdLnN1YnN0cigxOSksIDEwKTtcbiAgICAgIH0gZWxzZSBpZiAoYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnICYmXG4gICAgICAgICAgICAgICAgICByZW1vdGVJc0ZpcmVmb3ggIT09IC0xKSB7XG4gICAgICAgIC8vIElmIHRoZSBtYXhpbXVtIG1lc3NhZ2Ugc2l6ZSBpcyBub3QgcHJlc2VudCBpbiB0aGUgcmVtb3RlIFNEUCBhbmRcbiAgICAgICAgLy8gYm90aCBsb2NhbCBhbmQgcmVtb3RlIGFyZSBGaXJlZm94LCB0aGUgcmVtb3RlIHBlZXIgY2FuIHJlY2VpdmVcbiAgICAgICAgLy8gfjIgR2lCLlxuICAgICAgICBtYXhNZXNzYWdlU2l6ZSA9IDIxNDc0ODM2Mzc7XG4gICAgICB9XG4gICAgICByZXR1cm4gbWF4TWVzc2FnZVNpemU7XG4gICAgfTtcblxuICAgIHZhciBvcmlnU2V0UmVtb3RlRGVzY3JpcHRpb24gPVxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb24gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBwYy5fc2N0cCA9IG51bGw7XG5cbiAgICAgIGlmIChzY3RwSW5EZXNjcmlwdGlvbihhcmd1bWVudHNbMF0pKSB7XG4gICAgICAgIC8vIENoZWNrIGlmIHRoZSByZW1vdGUgaXMgRkYuXG4gICAgICAgIHZhciBpc0ZpcmVmb3ggPSBnZXRSZW1vdGVGaXJlZm94VmVyc2lvbihhcmd1bWVudHNbMF0pO1xuXG4gICAgICAgIC8vIEdldCB0aGUgbWF4aW11bSBtZXNzYWdlIHNpemUgdGhlIGxvY2FsIHBlZXIgaXMgY2FwYWJsZSBvZiBzZW5kaW5nXG4gICAgICAgIHZhciBjYW5TZW5kTU1TID0gZ2V0Q2FuU2VuZE1heE1lc3NhZ2VTaXplKGlzRmlyZWZveCk7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBtYXhpbXVtIG1lc3NhZ2Ugc2l6ZSBvZiB0aGUgcmVtb3RlIHBlZXIuXG4gICAgICAgIHZhciByZW1vdGVNTVMgPSBnZXRNYXhNZXNzYWdlU2l6ZShhcmd1bWVudHNbMF0sIGlzRmlyZWZveCk7XG5cbiAgICAgICAgLy8gRGV0ZXJtaW5lIGZpbmFsIG1heGltdW0gbWVzc2FnZSBzaXplXG4gICAgICAgIHZhciBtYXhNZXNzYWdlU2l6ZTtcbiAgICAgICAgaWYgKGNhblNlbmRNTVMgPT09IDAgJiYgcmVtb3RlTU1TID09PSAwKSB7XG4gICAgICAgICAgbWF4TWVzc2FnZVNpemUgPSBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFk7XG4gICAgICAgIH0gZWxzZSBpZiAoY2FuU2VuZE1NUyA9PT0gMCB8fCByZW1vdGVNTVMgPT09IDApIHtcbiAgICAgICAgICBtYXhNZXNzYWdlU2l6ZSA9IE1hdGgubWF4KGNhblNlbmRNTVMsIHJlbW90ZU1NUyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbWF4TWVzc2FnZVNpemUgPSBNYXRoLm1pbihjYW5TZW5kTU1TLCByZW1vdGVNTVMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgZHVtbXkgUlRDU2N0cFRyYW5zcG9ydCBvYmplY3QgYW5kIHRoZSAnbWF4TWVzc2FnZVNpemUnXG4gICAgICAgIC8vIGF0dHJpYnV0ZS5cbiAgICAgICAgdmFyIHNjdHAgPSB7fTtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHNjdHAsICdtYXhNZXNzYWdlU2l6ZScsIHtcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIG1heE1lc3NhZ2VTaXplO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHBjLl9zY3RwID0gc2N0cDtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIG9yaWdTZXRSZW1vdGVEZXNjcmlwdGlvbi5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1TZW5kVGhyb3dUeXBlRXJyb3I6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghKHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICAnY3JlYXRlRGF0YUNoYW5uZWwnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gTm90ZTogQWx0aG91Z2ggRmlyZWZveCA+PSA1NyBoYXMgYSBuYXRpdmUgaW1wbGVtZW50YXRpb24sIHRoZSBtYXhpbXVtXG4gICAgLy8gICAgICAgbWVzc2FnZSBzaXplIGNhbiBiZSByZXNldCBmb3IgYWxsIGRhdGEgY2hhbm5lbHMgYXQgYSBsYXRlciBzdGFnZS5cbiAgICAvLyAgICAgICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTE0MjY4MzFcblxuICAgIGZ1bmN0aW9uIHdyYXBEY1NlbmQoZGMsIHBjKSB7XG4gICAgICB2YXIgb3JpZ0RhdGFDaGFubmVsU2VuZCA9IGRjLnNlbmQ7XG4gICAgICBkYy5zZW5kID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBkYXRhID0gYXJndW1lbnRzWzBdO1xuICAgICAgICB2YXIgbGVuZ3RoID0gZGF0YS5sZW5ndGggfHwgZGF0YS5zaXplIHx8IGRhdGEuYnl0ZUxlbmd0aDtcbiAgICAgICAgaWYgKGRjLnJlYWR5U3RhdGUgPT09ICdvcGVuJyAmJlxuICAgICAgICAgICAgcGMuc2N0cCAmJiBsZW5ndGggPiBwYy5zY3RwLm1heE1lc3NhZ2VTaXplKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTWVzc2FnZSB0b28gbGFyZ2UgKGNhbiBzZW5kIGEgbWF4aW11bSBvZiAnICtcbiAgICAgICAgICAgIHBjLnNjdHAubWF4TWVzc2FnZVNpemUgKyAnIGJ5dGVzKScpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvcmlnRGF0YUNoYW5uZWxTZW5kLmFwcGx5KGRjLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9XG4gICAgdmFyIG9yaWdDcmVhdGVEYXRhQ2hhbm5lbCA9XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNyZWF0ZURhdGFDaGFubmVsO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlRGF0YUNoYW5uZWwgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB2YXIgZGF0YUNoYW5uZWwgPSBvcmlnQ3JlYXRlRGF0YUNoYW5uZWwuYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgICB3cmFwRGNTZW5kKGRhdGFDaGFubmVsLCBwYyk7XG4gICAgICByZXR1cm4gZGF0YUNoYW5uZWw7XG4gICAgfTtcbiAgICB1dGlscy53cmFwUGVlckNvbm5lY3Rpb25FdmVudCh3aW5kb3csICdkYXRhY2hhbm5lbCcsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIHdyYXBEY1NlbmQoZS5jaGFubmVsLCBlLnRhcmdldCk7XG4gICAgICByZXR1cm4gZTtcbiAgICB9KTtcbiAgfVxufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xudmFyIGZpbHRlckljZVNlcnZlcnMgPSByZXF1aXJlKCcuL2ZpbHRlcmljZXNlcnZlcnMnKTtcbnZhciBzaGltUlRDUGVlckNvbm5lY3Rpb24gPSByZXF1aXJlKCdydGNwZWVyY29ubmVjdGlvbi1zaGltJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzaGltR2V0VXNlck1lZGlhOiByZXF1aXJlKCcuL2dldHVzZXJtZWRpYScpLFxuICBzaGltUGVlckNvbm5lY3Rpb246IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcblxuICAgIGlmICh3aW5kb3cuUlRDSWNlR2F0aGVyZXIpIHtcbiAgICAgIGlmICghd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSkge1xuICAgICAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlID0gZnVuY3Rpb24oYXJncykge1xuICAgICAgICAgIHJldHVybiBhcmdzO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgaWYgKCF3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKSB7XG4gICAgICAgIHdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24gPSBmdW5jdGlvbihhcmdzKSB7XG4gICAgICAgICAgcmV0dXJuIGFyZ3M7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICAvLyB0aGlzIGFkZHMgYW4gYWRkaXRpb25hbCBldmVudCBsaXN0ZW5lciB0byBNZWRpYVN0cmFja1RyYWNrIHRoYXQgc2lnbmFsc1xuICAgICAgLy8gd2hlbiBhIHRyYWNrcyBlbmFibGVkIHByb3BlcnR5IHdhcyBjaGFuZ2VkLiBXb3JrYXJvdW5kIGZvciBhIGJ1ZyBpblxuICAgICAgLy8gYWRkU3RyZWFtLCBzZWUgYmVsb3cuIE5vIGxvbmdlciByZXF1aXJlZCBpbiAxNTAyNStcbiAgICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgMTUwMjUpIHtcbiAgICAgICAgdmFyIG9yaWdNU1RFbmFibGVkID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihcbiAgICAgICAgICAgIHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZSwgJ2VuYWJsZWQnKTtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZSwgJ2VuYWJsZWQnLCB7XG4gICAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgICAgb3JpZ01TVEVuYWJsZWQuc2V0LmNhbGwodGhpcywgdmFsdWUpO1xuICAgICAgICAgICAgdmFyIGV2ID0gbmV3IEV2ZW50KCdlbmFibGVkJyk7XG4gICAgICAgICAgICBldi5lbmFibGVkID0gdmFsdWU7XG4gICAgICAgICAgICB0aGlzLmRpc3BhdGNoRXZlbnQoZXYpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gT1JUQyBkZWZpbmVzIHRoZSBEVE1GIHNlbmRlciBhIGJpdCBkaWZmZXJlbnQuXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3czYy9vcnRjL2lzc3Vlcy83MTRcbiAgICBpZiAod2luZG93LlJUQ1J0cFNlbmRlciAmJiAhKCdkdG1mJyBpbiB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSkpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSwgJ2R0bWYnLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX2R0bWYgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgaWYgKHRoaXMudHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICAgICAgICB0aGlzLl9kdG1mID0gbmV3IHdpbmRvdy5SVENEdG1mU2VuZGVyKHRoaXMpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICh0aGlzLnRyYWNrLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgICAgICAgdGhpcy5fZHRtZiA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLl9kdG1mO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgLy8gRWRnZSBjdXJyZW50bHkgb25seSBpbXBsZW1lbnRzIHRoZSBSVENEdG1mU2VuZGVyLCBub3QgdGhlXG4gICAgLy8gUlRDRFRNRlNlbmRlciBhbGlhcy4gU2VlIGh0dHA6Ly9kcmFmdC5vcnRjLm9yZy8jcnRjZHRtZnNlbmRlcjIqXG4gICAgaWYgKHdpbmRvdy5SVENEdG1mU2VuZGVyICYmICF3aW5kb3cuUlRDRFRNRlNlbmRlcikge1xuICAgICAgd2luZG93LlJUQ0RUTUZTZW5kZXIgPSB3aW5kb3cuUlRDRHRtZlNlbmRlcjtcbiAgICB9XG5cbiAgICB2YXIgUlRDUGVlckNvbm5lY3Rpb25TaGltID0gc2hpbVJUQ1BlZXJDb25uZWN0aW9uKHdpbmRvdyxcbiAgICAgICAgYnJvd3NlckRldGFpbHMudmVyc2lvbik7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uID0gZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgICBpZiAoY29uZmlnICYmIGNvbmZpZy5pY2VTZXJ2ZXJzKSB7XG4gICAgICAgIGNvbmZpZy5pY2VTZXJ2ZXJzID0gZmlsdGVySWNlU2VydmVycyhjb25maWcuaWNlU2VydmVycyk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IFJUQ1BlZXJDb25uZWN0aW9uU2hpbShjb25maWcpO1xuICAgIH07XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSA9IFJUQ1BlZXJDb25uZWN0aW9uU2hpbS5wcm90b3R5cGU7XG4gIH0sXG4gIHNoaW1SZXBsYWNlVHJhY2s6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIE9SVEMgaGFzIHJlcGxhY2VUcmFjayAtLSBodHRwczovL2dpdGh1Yi5jb20vdzNjL29ydGMvaXNzdWVzLzYxNFxuICAgIGlmICh3aW5kb3cuUlRDUnRwU2VuZGVyICYmXG4gICAgICAgICEoJ3JlcGxhY2VUcmFjaycgaW4gd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUpKSB7XG4gICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZS5yZXBsYWNlVHJhY2sgPVxuICAgICAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlLnNldFRyYWNrO1xuICAgIH1cbiAgfVxufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE4IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xuLy8gRWRnZSBkb2VzIG5vdCBsaWtlXG4vLyAxKSBzdHVuOiBmaWx0ZXJlZCBhZnRlciAxNDM5MyB1bmxlc3MgP3RyYW5zcG9ydD11ZHAgaXMgcHJlc2VudFxuLy8gMikgdHVybjogdGhhdCBkb2VzIG5vdCBoYXZlIGFsbCBvZiB0dXJuOmhvc3Q6cG9ydD90cmFuc3BvcnQ9dWRwXG4vLyAzKSB0dXJuOiB3aXRoIGlwdjYgYWRkcmVzc2VzXG4vLyA0KSB0dXJuOiBvY2N1cnJpbmcgbXVsaXBsZSB0aW1lc1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihpY2VTZXJ2ZXJzLCBlZGdlVmVyc2lvbikge1xuICB2YXIgaGFzVHVybiA9IGZhbHNlO1xuICBpY2VTZXJ2ZXJzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShpY2VTZXJ2ZXJzKSk7XG4gIHJldHVybiBpY2VTZXJ2ZXJzLmZpbHRlcihmdW5jdGlvbihzZXJ2ZXIpIHtcbiAgICBpZiAoc2VydmVyICYmIChzZXJ2ZXIudXJscyB8fCBzZXJ2ZXIudXJsKSkge1xuICAgICAgdmFyIHVybHMgPSBzZXJ2ZXIudXJscyB8fCBzZXJ2ZXIudXJsO1xuICAgICAgaWYgKHNlcnZlci51cmwgJiYgIXNlcnZlci51cmxzKSB7XG4gICAgICAgIHV0aWxzLmRlcHJlY2F0ZWQoJ1JUQ0ljZVNlcnZlci51cmwnLCAnUlRDSWNlU2VydmVyLnVybHMnKTtcbiAgICAgIH1cbiAgICAgIHZhciBpc1N0cmluZyA9IHR5cGVvZiB1cmxzID09PSAnc3RyaW5nJztcbiAgICAgIGlmIChpc1N0cmluZykge1xuICAgICAgICB1cmxzID0gW3VybHNdO1xuICAgICAgfVxuICAgICAgdXJscyA9IHVybHMuZmlsdGVyKGZ1bmN0aW9uKHVybCkge1xuICAgICAgICB2YXIgdmFsaWRUdXJuID0gdXJsLmluZGV4T2YoJ3R1cm46JykgPT09IDAgJiZcbiAgICAgICAgICAgIHVybC5pbmRleE9mKCd0cmFuc3BvcnQ9dWRwJykgIT09IC0xICYmXG4gICAgICAgICAgICB1cmwuaW5kZXhPZigndHVybjpbJykgPT09IC0xICYmXG4gICAgICAgICAgICAhaGFzVHVybjtcblxuICAgICAgICBpZiAodmFsaWRUdXJuKSB7XG4gICAgICAgICAgaGFzVHVybiA9IHRydWU7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVybC5pbmRleE9mKCdzdHVuOicpID09PSAwICYmIGVkZ2VWZXJzaW9uID49IDE0MzkzICYmXG4gICAgICAgICAgICB1cmwuaW5kZXhPZignP3RyYW5zcG9ydD11ZHAnKSA9PT0gLTE7XG4gICAgICB9KTtcblxuICAgICAgZGVsZXRlIHNlcnZlci51cmw7XG4gICAgICBzZXJ2ZXIudXJscyA9IGlzU3RyaW5nID8gdXJsc1swXSA6IHVybHM7XG4gICAgICByZXR1cm4gISF1cmxzLmxlbmd0aDtcbiAgICB9XG4gIH0pO1xufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG4vLyBFeHBvc2UgcHVibGljIG1ldGhvZHMuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHdpbmRvdykge1xuICB2YXIgbmF2aWdhdG9yID0gd2luZG93ICYmIHdpbmRvdy5uYXZpZ2F0b3I7XG5cbiAgdmFyIHNoaW1FcnJvcl8gPSBmdW5jdGlvbihlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IHtQZXJtaXNzaW9uRGVuaWVkRXJyb3I6ICdOb3RBbGxvd2VkRXJyb3InfVtlLm5hbWVdIHx8IGUubmFtZSxcbiAgICAgIG1lc3NhZ2U6IGUubWVzc2FnZSxcbiAgICAgIGNvbnN0cmFpbnQ6IGUuY29uc3RyYWludCxcbiAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubmFtZTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIC8vIGdldFVzZXJNZWRpYSBlcnJvciBzaGltLlxuICB2YXIgb3JpZ0dldFVzZXJNZWRpYSA9IG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhLlxuICAgICAgYmluZChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKTtcbiAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjKSB7XG4gICAgcmV0dXJuIG9yaWdHZXRVc2VyTWVkaWEoYykuY2F0Y2goZnVuY3Rpb24oZSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHNoaW1FcnJvcl8oZSkpO1xuICAgIH0pO1xuICB9O1xufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc2hpbUdldFVzZXJNZWRpYTogcmVxdWlyZSgnLi9nZXR1c2VybWVkaWEnKSxcbiAgc2hpbU9uVHJhY2s6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiYgISgnb250cmFjaycgaW5cbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAnb250cmFjaycsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fb250cmFjaztcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgaWYgKHRoaXMuX29udHJhY2spIHtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcigndHJhY2snLCB0aGlzLl9vbnRyYWNrKTtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcignYWRkc3RyZWFtJywgdGhpcy5fb250cmFja3BvbHkpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoJ3RyYWNrJywgdGhpcy5fb250cmFjayA9IGYpO1xuICAgICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcignYWRkc3RyZWFtJywgdGhpcy5fb250cmFja3BvbHkgPSBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICBlLnN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgndHJhY2snKTtcbiAgICAgICAgICAgICAgZXZlbnQudHJhY2sgPSB0cmFjaztcbiAgICAgICAgICAgICAgZXZlbnQucmVjZWl2ZXIgPSB7dHJhY2s6IHRyYWNrfTtcbiAgICAgICAgICAgICAgZXZlbnQudHJhbnNjZWl2ZXIgPSB7cmVjZWl2ZXI6IGV2ZW50LnJlY2VpdmVyfTtcbiAgICAgICAgICAgICAgZXZlbnQuc3RyZWFtcyA9IFtlLnN0cmVhbV07XG4gICAgICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgICAgICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1RyYWNrRXZlbnQgJiZcbiAgICAgICAgKCdyZWNlaXZlcicgaW4gd2luZG93LlJUQ1RyYWNrRXZlbnQucHJvdG90eXBlKSAmJlxuICAgICAgICAhKCd0cmFuc2NlaXZlcicgaW4gd2luZG93LlJUQ1RyYWNrRXZlbnQucHJvdG90eXBlKSkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENUcmFja0V2ZW50LnByb3RvdHlwZSwgJ3RyYW5zY2VpdmVyJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB7cmVjZWl2ZXI6IHRoaXMucmVjZWl2ZXJ9O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgc2hpbVNvdXJjZU9iamVjdDogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gRmlyZWZveCBoYXMgc3VwcG9ydGVkIG1velNyY09iamVjdCBzaW5jZSBGRjIyLCB1bnByZWZpeGVkIGluIDQyLlxuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0Jykge1xuICAgICAgaWYgKHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50ICYmXG4gICAgICAgICEoJ3NyY09iamVjdCcgaW4gd2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlKSkge1xuICAgICAgICAvLyBTaGltIHRoZSBzcmNPYmplY3QgcHJvcGVydHksIG9uY2UsIHdoZW4gSFRNTE1lZGlhRWxlbWVudCBpcyBmb3VuZC5cbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZSwgJ3NyY09iamVjdCcsIHtcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMubW96U3JjT2JqZWN0O1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgIHRoaXMubW96U3JjT2JqZWN0ID0gc3RyZWFtO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHNoaW1QZWVyQ29ubmVjdGlvbjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICdvYmplY3QnIHx8ICEod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uIHx8XG4gICAgICAgIHdpbmRvdy5tb3pSVENQZWVyQ29ubmVjdGlvbikpIHtcbiAgICAgIHJldHVybjsgLy8gcHJvYmFibHkgbWVkaWEucGVlcmNvbm5lY3Rpb24uZW5hYmxlZD1mYWxzZSBpbiBhYm91dDpjb25maWdcbiAgICB9XG4gICAgLy8gVGhlIFJUQ1BlZXJDb25uZWN0aW9uIG9iamVjdC5cbiAgICBpZiAoIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uID0gZnVuY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpIHtcbiAgICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCAzOCkge1xuICAgICAgICAgIC8vIC51cmxzIGlzIG5vdCBzdXBwb3J0ZWQgaW4gRkYgPCAzOC5cbiAgICAgICAgICAvLyBjcmVhdGUgUlRDSWNlU2VydmVycyB3aXRoIGEgc2luZ2xlIHVybC5cbiAgICAgICAgICBpZiAocGNDb25maWcgJiYgcGNDb25maWcuaWNlU2VydmVycykge1xuICAgICAgICAgICAgdmFyIG5ld0ljZVNlcnZlcnMgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGNDb25maWcuaWNlU2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICB2YXIgc2VydmVyID0gcGNDb25maWcuaWNlU2VydmVyc1tpXTtcbiAgICAgICAgICAgICAgaWYgKHNlcnZlci5oYXNPd25Qcm9wZXJ0eSgndXJscycpKSB7XG4gICAgICAgICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBzZXJ2ZXIudXJscy5sZW5ndGg7IGorKykge1xuICAgICAgICAgICAgICAgICAgdmFyIG5ld1NlcnZlciA9IHtcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBzZXJ2ZXIudXJsc1tqXVxuICAgICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAgIGlmIChzZXJ2ZXIudXJsc1tqXS5pbmRleE9mKCd0dXJuJykgPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgbmV3U2VydmVyLnVzZXJuYW1lID0gc2VydmVyLnVzZXJuYW1lO1xuICAgICAgICAgICAgICAgICAgICBuZXdTZXJ2ZXIuY3JlZGVudGlhbCA9IHNlcnZlci5jcmVkZW50aWFsO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKG5ld1NlcnZlcik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChwY0NvbmZpZy5pY2VTZXJ2ZXJzW2ldKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcGNDb25maWcuaWNlU2VydmVycyA9IG5ld0ljZVNlcnZlcnM7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXcgd2luZG93Lm1velJUQ1BlZXJDb25uZWN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKTtcbiAgICAgIH07XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlID1cbiAgICAgICAgICB3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlO1xuXG4gICAgICAvLyB3cmFwIHN0YXRpYyBtZXRob2RzLiBDdXJyZW50bHkganVzdCBnZW5lcmF0ZUNlcnRpZmljYXRlLlxuICAgICAgaWYgKHdpbmRvdy5tb3pSVENQZWVyQ29ubmVjdGlvbi5nZW5lcmF0ZUNlcnRpZmljYXRlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24sICdnZW5lcmF0ZUNlcnRpZmljYXRlJywge1xuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gd2luZG93Lm1velJUQ1BlZXJDb25uZWN0aW9uLmdlbmVyYXRlQ2VydGlmaWNhdGU7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbiA9IHdpbmRvdy5tb3pSVENTZXNzaW9uRGVzY3JpcHRpb247XG4gICAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlID0gd2luZG93Lm1velJUQ0ljZUNhbmRpZGF0ZTtcbiAgICB9XG5cbiAgICAvLyBzaGltIGF3YXkgbmVlZCBmb3Igb2Jzb2xldGUgUlRDSWNlQ2FuZGlkYXRlL1JUQ1Nlc3Npb25EZXNjcmlwdGlvbi5cbiAgICBbJ3NldExvY2FsRGVzY3JpcHRpb24nLCAnc2V0UmVtb3RlRGVzY3JpcHRpb24nLCAnYWRkSWNlQ2FuZGlkYXRlJ11cbiAgICAgICAgLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICAgICAgdmFyIG5hdGl2ZU1ldGhvZCA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGFyZ3VtZW50c1swXSA9IG5ldyAoKG1ldGhvZCA9PT0gJ2FkZEljZUNhbmRpZGF0ZScpID9cbiAgICAgICAgICAgICAgICB3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlIDpcbiAgICAgICAgICAgICAgICB3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKShhcmd1bWVudHNbMF0pO1xuICAgICAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIH07XG4gICAgICAgIH0pO1xuXG4gICAgLy8gc3VwcG9ydCBmb3IgYWRkSWNlQ2FuZGlkYXRlKG51bGwgb3IgdW5kZWZpbmVkKVxuICAgIHZhciBuYXRpdmVBZGRJY2VDYW5kaWRhdGUgPVxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCFhcmd1bWVudHNbMF0pIHtcbiAgICAgICAgaWYgKGFyZ3VtZW50c1sxXSkge1xuICAgICAgICAgIGFyZ3VtZW50c1sxXS5hcHBseShudWxsKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmF0aXZlQWRkSWNlQ2FuZGlkYXRlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcblxuICAgIC8vIHNoaW0gZ2V0U3RhdHMgd2l0aCBtYXBsaWtlIHN1cHBvcnRcbiAgICB2YXIgbWFrZU1hcFN0YXRzID0gZnVuY3Rpb24oc3RhdHMpIHtcbiAgICAgIHZhciBtYXAgPSBuZXcgTWFwKCk7XG4gICAgICBPYmplY3Qua2V5cyhzdGF0cykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgICAgbWFwLnNldChrZXksIHN0YXRzW2tleV0pO1xuICAgICAgICBtYXBba2V5XSA9IHN0YXRzW2tleV07XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBtYXA7XG4gICAgfTtcblxuICAgIHZhciBtb2Rlcm5TdGF0c1R5cGVzID0ge1xuICAgICAgaW5ib3VuZHJ0cDogJ2luYm91bmQtcnRwJyxcbiAgICAgIG91dGJvdW5kcnRwOiAnb3V0Ym91bmQtcnRwJyxcbiAgICAgIGNhbmRpZGF0ZXBhaXI6ICdjYW5kaWRhdGUtcGFpcicsXG4gICAgICBsb2NhbGNhbmRpZGF0ZTogJ2xvY2FsLWNhbmRpZGF0ZScsXG4gICAgICByZW1vdGVjYW5kaWRhdGU6ICdyZW1vdGUtY2FuZGlkYXRlJ1xuICAgIH07XG5cbiAgICB2YXIgbmF0aXZlR2V0U3RhdHMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbihcbiAgICAgIHNlbGVjdG9yLFxuICAgICAgb25TdWNjLFxuICAgICAgb25FcnJcbiAgICApIHtcbiAgICAgIHJldHVybiBuYXRpdmVHZXRTdGF0cy5hcHBseSh0aGlzLCBbc2VsZWN0b3IgfHwgbnVsbF0pXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKHN0YXRzKSB7XG4gICAgICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA0OCkge1xuICAgICAgICAgICAgc3RhdHMgPSBtYWtlTWFwU3RhdHMoc3RhdHMpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDUzICYmICFvblN1Y2MpIHtcbiAgICAgICAgICAgIC8vIFNoaW0gb25seSBwcm9taXNlIGdldFN0YXRzIHdpdGggc3BlYy1oeXBoZW5zIGluIHR5cGUgbmFtZXNcbiAgICAgICAgICAgIC8vIExlYXZlIGNhbGxiYWNrIHZlcnNpb24gYWxvbmU7IG1pc2Mgb2xkIHVzZXMgb2YgZm9yRWFjaCBiZWZvcmUgTWFwXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBzdGF0cy5mb3JFYWNoKGZ1bmN0aW9uKHN0YXQpIHtcbiAgICAgICAgICAgICAgICBzdGF0LnR5cGUgPSBtb2Rlcm5TdGF0c1R5cGVzW3N0YXQudHlwZV0gfHwgc3RhdC50eXBlO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgaWYgKGUubmFtZSAhPT0gJ1R5cGVFcnJvcicpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIC8vIEF2b2lkIFR5cGVFcnJvcjogXCJ0eXBlXCIgaXMgcmVhZC1vbmx5LCBpbiBvbGQgdmVyc2lvbnMuIDM0LTQzaXNoXG4gICAgICAgICAgICAgIHN0YXRzLmZvckVhY2goZnVuY3Rpb24oc3RhdCwgaSkge1xuICAgICAgICAgICAgICAgIHN0YXRzLnNldChpLCBPYmplY3QuYXNzaWduKHt9LCBzdGF0LCB7XG4gICAgICAgICAgICAgICAgICB0eXBlOiBtb2Rlcm5TdGF0c1R5cGVzW3N0YXQudHlwZV0gfHwgc3RhdC50eXBlXG4gICAgICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHN0YXRzO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihvblN1Y2MsIG9uRXJyKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1TZW5kZXJHZXRTdGF0czogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKCEodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh3aW5kb3cuUlRDUnRwU2VuZGVyICYmICdnZXRTdGF0cycgaW4gd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIG9yaWdHZXRTZW5kZXJzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzO1xuICAgIGlmIChvcmlnR2V0U2VuZGVycykge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHZhciBzZW5kZXJzID0gb3JpZ0dldFNlbmRlcnMuYXBwbHkocGMsIFtdKTtcbiAgICAgICAgc2VuZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgICAgIHNlbmRlci5fcGMgPSBwYztcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBzZW5kZXJzO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZ0FkZFRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjaztcbiAgICBpZiAob3JpZ0FkZFRyYWNrKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBzZW5kZXIgPSBvcmlnQWRkVHJhY2suYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgc2VuZGVyLl9wYyA9IHRoaXM7XG4gICAgICAgIHJldHVybiBzZW5kZXI7XG4gICAgICB9O1xuICAgIH1cbiAgICB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMudHJhY2sgPyB0aGlzLl9wYy5nZXRTdGF0cyh0aGlzLnRyYWNrKSA6XG4gICAgICAgICAgUHJvbWlzZS5yZXNvbHZlKG5ldyBNYXAoKSk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltUmVjZWl2ZXJHZXRTdGF0czogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKCEodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh3aW5kb3cuUlRDUnRwU2VuZGVyICYmICdnZXRTdGF0cycgaW4gd2luZG93LlJUQ1J0cFJlY2VpdmVyLnByb3RvdHlwZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgb3JpZ0dldFJlY2VpdmVycyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzO1xuICAgIGlmIChvcmlnR2V0UmVjZWl2ZXJzKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICB2YXIgcmVjZWl2ZXJzID0gb3JpZ0dldFJlY2VpdmVycy5hcHBseShwYywgW10pO1xuICAgICAgICByZWNlaXZlcnMuZm9yRWFjaChmdW5jdGlvbihyZWNlaXZlcikge1xuICAgICAgICAgIHJlY2VpdmVyLl9wYyA9IHBjO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHJlY2VpdmVycztcbiAgICAgIH07XG4gICAgfVxuICAgIHV0aWxzLndyYXBQZWVyQ29ubmVjdGlvbkV2ZW50KHdpbmRvdywgJ3RyYWNrJywgZnVuY3Rpb24oZSkge1xuICAgICAgZS5yZWNlaXZlci5fcGMgPSBlLnNyY0VsZW1lbnQ7XG4gICAgICByZXR1cm4gZTtcbiAgICB9KTtcbiAgICB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcGMuZ2V0U3RhdHModGhpcy50cmFjayk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltUmVtb3ZlU3RyZWFtOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAoIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiB8fFxuICAgICAgICAncmVtb3ZlU3RyZWFtJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdXRpbHMuZGVwcmVjYXRlZCgncmVtb3ZlU3RyZWFtJywgJ3JlbW92ZVRyYWNrJyk7XG4gICAgICB0aGlzLmdldFNlbmRlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgICBpZiAoc2VuZGVyLnRyYWNrICYmIHN0cmVhbS5nZXRUcmFja3MoKS5pbmRleE9mKHNlbmRlci50cmFjaykgIT09IC0xKSB7XG4gICAgICAgICAgcGMucmVtb3ZlVHJhY2soc2VuZGVyKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfTtcbiAgfSxcblxuICBzaGltUlRDRGF0YUNoYW5uZWw6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIHJlbmFtZSBEYXRhQ2hhbm5lbCB0byBSVENEYXRhQ2hhbm5lbCAobmF0aXZlIGZpeCBpbiBGRjYwKTpcbiAgICAvLyBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xMTczODUxXG4gICAgaWYgKHdpbmRvdy5EYXRhQ2hhbm5lbCAmJiAhd2luZG93LlJUQ0RhdGFDaGFubmVsKSB7XG4gICAgICB3aW5kb3cuUlRDRGF0YUNoYW5uZWwgPSB3aW5kb3cuRGF0YUNoYW5uZWw7XG4gICAgfVxuICB9LFxufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xudmFyIGxvZ2dpbmcgPSB1dGlscy5sb2c7XG5cbi8vIEV4cG9zZSBwdWJsaWMgbWV0aG9kcy5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24od2luZG93KSB7XG4gIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcbiAgdmFyIG5hdmlnYXRvciA9IHdpbmRvdyAmJiB3aW5kb3cubmF2aWdhdG9yO1xuICB2YXIgTWVkaWFTdHJlYW1UcmFjayA9IHdpbmRvdyAmJiB3aW5kb3cuTWVkaWFTdHJlYW1UcmFjaztcblxuICB2YXIgc2hpbUVycm9yXyA9IGZ1bmN0aW9uKGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZToge1xuICAgICAgICBJbnRlcm5hbEVycm9yOiAnTm90UmVhZGFibGVFcnJvcicsXG4gICAgICAgIE5vdFN1cHBvcnRlZEVycm9yOiAnVHlwZUVycm9yJyxcbiAgICAgICAgUGVybWlzc2lvbkRlbmllZEVycm9yOiAnTm90QWxsb3dlZEVycm9yJyxcbiAgICAgICAgU2VjdXJpdHlFcnJvcjogJ05vdEFsbG93ZWRFcnJvcidcbiAgICAgIH1bZS5uYW1lXSB8fCBlLm5hbWUsXG4gICAgICBtZXNzYWdlOiB7XG4gICAgICAgICdUaGUgb3BlcmF0aW9uIGlzIGluc2VjdXJlLic6ICdUaGUgcmVxdWVzdCBpcyBub3QgYWxsb3dlZCBieSB0aGUgJyArXG4gICAgICAgICd1c2VyIGFnZW50IG9yIHRoZSBwbGF0Zm9ybSBpbiB0aGUgY3VycmVudCBjb250ZXh0LidcbiAgICAgIH1bZS5tZXNzYWdlXSB8fCBlLm1lc3NhZ2UsXG4gICAgICBjb25zdHJhaW50OiBlLmNvbnN0cmFpbnQsXG4gICAgICB0b1N0cmluZzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm5hbWUgKyAodGhpcy5tZXNzYWdlICYmICc6ICcpICsgdGhpcy5tZXNzYWdlO1xuICAgICAgfVxuICAgIH07XG4gIH07XG5cbiAgLy8gZ2V0VXNlck1lZGlhIGNvbnN0cmFpbnRzIHNoaW0uXG4gIHZhciBnZXRVc2VyTWVkaWFfID0gZnVuY3Rpb24oY29uc3RyYWludHMsIG9uU3VjY2Vzcywgb25FcnJvcikge1xuICAgIHZhciBjb25zdHJhaW50c1RvRkYzN18gPSBmdW5jdGlvbihjKSB7XG4gICAgICBpZiAodHlwZW9mIGMgIT09ICdvYmplY3QnIHx8IGMucmVxdWlyZSkge1xuICAgICAgICByZXR1cm4gYztcbiAgICAgIH1cbiAgICAgIHZhciByZXF1aXJlID0gW107XG4gICAgICBPYmplY3Qua2V5cyhjKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICBpZiAoa2V5ID09PSAncmVxdWlyZScgfHwga2V5ID09PSAnYWR2YW5jZWQnIHx8IGtleSA9PT0gJ21lZGlhU291cmNlJykge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgciA9IGNba2V5XSA9ICh0eXBlb2YgY1trZXldID09PSAnb2JqZWN0JykgP1xuICAgICAgICAgICAgY1trZXldIDoge2lkZWFsOiBjW2tleV19O1xuICAgICAgICBpZiAoci5taW4gIT09IHVuZGVmaW5lZCB8fFxuICAgICAgICAgICAgci5tYXggIT09IHVuZGVmaW5lZCB8fCByLmV4YWN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICByZXF1aXJlLnB1c2goa2V5KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoci5leGFjdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiByLmV4YWN0ID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgci4gbWluID0gci5tYXggPSByLmV4YWN0O1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjW2tleV0gPSByLmV4YWN0O1xuICAgICAgICAgIH1cbiAgICAgICAgICBkZWxldGUgci5leGFjdDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoci5pZGVhbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgYy5hZHZhbmNlZCA9IGMuYWR2YW5jZWQgfHwgW107XG4gICAgICAgICAgdmFyIG9jID0ge307XG4gICAgICAgICAgaWYgKHR5cGVvZiByLmlkZWFsID09PSAnbnVtYmVyJykge1xuICAgICAgICAgICAgb2Nba2V5XSA9IHttaW46IHIuaWRlYWwsIG1heDogci5pZGVhbH07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9jW2tleV0gPSByLmlkZWFsO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjLmFkdmFuY2VkLnB1c2gob2MpO1xuICAgICAgICAgIGRlbGV0ZSByLmlkZWFsO1xuICAgICAgICAgIGlmICghT2JqZWN0LmtleXMocikubGVuZ3RoKSB7XG4gICAgICAgICAgICBkZWxldGUgY1trZXldO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAocmVxdWlyZS5sZW5ndGgpIHtcbiAgICAgICAgYy5yZXF1aXJlID0gcmVxdWlyZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBjO1xuICAgIH07XG4gICAgY29uc3RyYWludHMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCAzOCkge1xuICAgICAgbG9nZ2luZygnc3BlYzogJyArIEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgICBpZiAoY29uc3RyYWludHMuYXVkaW8pIHtcbiAgICAgICAgY29uc3RyYWludHMuYXVkaW8gPSBjb25zdHJhaW50c1RvRkYzN18oY29uc3RyYWludHMuYXVkaW8pO1xuICAgICAgfVxuICAgICAgaWYgKGNvbnN0cmFpbnRzLnZpZGVvKSB7XG4gICAgICAgIGNvbnN0cmFpbnRzLnZpZGVvID0gY29uc3RyYWludHNUb0ZGMzdfKGNvbnN0cmFpbnRzLnZpZGVvKTtcbiAgICAgIH1cbiAgICAgIGxvZ2dpbmcoJ2ZmMzc6ICcgKyBKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgIH1cbiAgICByZXR1cm4gbmF2aWdhdG9yLm1vekdldFVzZXJNZWRpYShjb25zdHJhaW50cywgb25TdWNjZXNzLCBmdW5jdGlvbihlKSB7XG4gICAgICBvbkVycm9yKHNoaW1FcnJvcl8oZSkpO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIFJldHVybnMgdGhlIHJlc3VsdCBvZiBnZXRVc2VyTWVkaWEgYXMgYSBQcm9taXNlLlxuICB2YXIgZ2V0VXNlck1lZGlhUHJvbWlzZV8gPSBmdW5jdGlvbihjb25zdHJhaW50cykge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgIGdldFVzZXJNZWRpYV8oY29uc3RyYWludHMsIHJlc29sdmUsIHJlamVjdCk7XG4gICAgfSk7XG4gIH07XG5cbiAgLy8gU2hpbSBmb3IgbWVkaWFEZXZpY2VzIG9uIG9sZGVyIHZlcnNpb25zLlxuICBpZiAoIW5hdmlnYXRvci5tZWRpYURldmljZXMpIHtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzID0ge2dldFVzZXJNZWRpYTogZ2V0VXNlck1lZGlhUHJvbWlzZV8sXG4gICAgICBhZGRFdmVudExpc3RlbmVyOiBmdW5jdGlvbigpIHsgfSxcbiAgICAgIHJlbW92ZUV2ZW50TGlzdGVuZXI6IGZ1bmN0aW9uKCkgeyB9XG4gICAgfTtcbiAgfVxuICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmVudW1lcmF0ZURldmljZXMgPVxuICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5lbnVtZXJhdGVEZXZpY2VzIHx8IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICAgIHZhciBpbmZvcyA9IFtcbiAgICAgICAgICAgIHtraW5kOiAnYXVkaW9pbnB1dCcsIGRldmljZUlkOiAnZGVmYXVsdCcsIGxhYmVsOiAnJywgZ3JvdXBJZDogJyd9LFxuICAgICAgICAgICAge2tpbmQ6ICd2aWRlb2lucHV0JywgZGV2aWNlSWQ6ICdkZWZhdWx0JywgbGFiZWw6ICcnLCBncm91cElkOiAnJ31cbiAgICAgICAgICBdO1xuICAgICAgICAgIHJlc29sdmUoaW5mb3MpO1xuICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA0MSkge1xuICAgIC8vIFdvcmsgYXJvdW5kIGh0dHA6Ly9idWd6aWwubGEvMTE2OTY2NVxuICAgIHZhciBvcmdFbnVtZXJhdGVEZXZpY2VzID1cbiAgICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5lbnVtZXJhdGVEZXZpY2VzLmJpbmQobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyk7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5lbnVtZXJhdGVEZXZpY2VzID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gb3JnRW51bWVyYXRlRGV2aWNlcygpLnRoZW4odW5kZWZpbmVkLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIGlmIChlLm5hbWUgPT09ICdOb3RGb3VuZEVycm9yJykge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfVxuICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDQ5KSB7XG4gICAgdmFyIG9yaWdHZXRVc2VyTWVkaWEgPSBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYS5cbiAgICAgICAgYmluZChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGMpIHtcbiAgICAgIHJldHVybiBvcmlnR2V0VXNlck1lZGlhKGMpLnRoZW4oZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgIC8vIFdvcmsgYXJvdW5kIGh0dHBzOi8vYnVnemlsLmxhLzgwMjMyNlxuICAgICAgICBpZiAoYy5hdWRpbyAmJiAhc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCkubGVuZ3RoIHx8XG4gICAgICAgICAgICBjLnZpZGVvICYmICFzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5sZW5ndGgpIHtcbiAgICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgdHJhY2suc3RvcCgpO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJ1RoZSBvYmplY3QgY2FuIG5vdCBiZSBmb3VuZCBoZXJlLicsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnTm90Rm91bmRFcnJvcicpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzdHJlYW07XG4gICAgICB9LCBmdW5jdGlvbihlKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChzaGltRXJyb3JfKGUpKTtcbiAgICAgIH0pO1xuICAgIH07XG4gIH1cbiAgaWYgKCEoYnJvd3NlckRldGFpbHMudmVyc2lvbiA+IDU1ICYmXG4gICAgICAnYXV0b0dhaW5Db250cm9sJyBpbiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFN1cHBvcnRlZENvbnN0cmFpbnRzKCkpKSB7XG4gICAgdmFyIHJlbWFwID0gZnVuY3Rpb24ob2JqLCBhLCBiKSB7XG4gICAgICBpZiAoYSBpbiBvYmogJiYgIShiIGluIG9iaikpIHtcbiAgICAgICAgb2JqW2JdID0gb2JqW2FdO1xuICAgICAgICBkZWxldGUgb2JqW2FdO1xuICAgICAgfVxuICAgIH07XG5cbiAgICB2YXIgbmF0aXZlR2V0VXNlck1lZGlhID0gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEuXG4gICAgICAgIGJpbmQobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyk7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjKSB7XG4gICAgICBpZiAodHlwZW9mIGMgPT09ICdvYmplY3QnICYmIHR5cGVvZiBjLmF1ZGlvID09PSAnb2JqZWN0Jykge1xuICAgICAgICBjID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjKSk7XG4gICAgICAgIHJlbWFwKGMuYXVkaW8sICdhdXRvR2FpbkNvbnRyb2wnLCAnbW96QXV0b0dhaW5Db250cm9sJyk7XG4gICAgICAgIHJlbWFwKGMuYXVkaW8sICdub2lzZVN1cHByZXNzaW9uJywgJ21vek5vaXNlU3VwcHJlc3Npb24nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVHZXRVc2VyTWVkaWEoYyk7XG4gICAgfTtcblxuICAgIGlmIChNZWRpYVN0cmVhbVRyYWNrICYmIE1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLmdldFNldHRpbmdzKSB7XG4gICAgICB2YXIgbmF0aXZlR2V0U2V0dGluZ3MgPSBNZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZS5nZXRTZXR0aW5ncztcbiAgICAgIE1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLmdldFNldHRpbmdzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBvYmogPSBuYXRpdmVHZXRTZXR0aW5ncy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICByZW1hcChvYmosICdtb3pBdXRvR2FpbkNvbnRyb2wnLCAnYXV0b0dhaW5Db250cm9sJyk7XG4gICAgICAgIHJlbWFwKG9iaiwgJ21vek5vaXNlU3VwcHJlc3Npb24nLCAnbm9pc2VTdXBwcmVzc2lvbicpO1xuICAgICAgICByZXR1cm4gb2JqO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICBpZiAoTWVkaWFTdHJlYW1UcmFjayAmJiBNZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZS5hcHBseUNvbnN0cmFpbnRzKSB7XG4gICAgICB2YXIgbmF0aXZlQXBwbHlDb25zdHJhaW50cyA9IE1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLmFwcGx5Q29uc3RyYWludHM7XG4gICAgICBNZWRpYVN0cmVhbVRyYWNrLnByb3RvdHlwZS5hcHBseUNvbnN0cmFpbnRzID0gZnVuY3Rpb24oYykge1xuICAgICAgICBpZiAodGhpcy5raW5kID09PSAnYXVkaW8nICYmIHR5cGVvZiBjID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIGMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGMpKTtcbiAgICAgICAgICByZW1hcChjLCAnYXV0b0dhaW5Db250cm9sJywgJ21vekF1dG9HYWluQ29udHJvbCcpO1xuICAgICAgICAgIHJlbWFwKGMsICdub2lzZVN1cHByZXNzaW9uJywgJ21vek5vaXNlU3VwcHJlc3Npb24nKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gbmF0aXZlQXBwbHlDb25zdHJhaW50cy5hcHBseSh0aGlzLCBbY10pO1xuICAgICAgfTtcbiAgICB9XG4gIH1cbiAgbmF2aWdhdG9yLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzLCBvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDQ0KSB7XG4gICAgICByZXR1cm4gZ2V0VXNlck1lZGlhXyhjb25zdHJhaW50cywgb25TdWNjZXNzLCBvbkVycm9yKTtcbiAgICB9XG4gICAgLy8gUmVwbGFjZSBGaXJlZm94IDQ0KydzIGRlcHJlY2F0aW9uIHdhcm5pbmcgd2l0aCB1bnByZWZpeGVkIHZlcnNpb24uXG4gICAgdXRpbHMuZGVwcmVjYXRlZCgnbmF2aWdhdG9yLmdldFVzZXJNZWRpYScsXG4gICAgICAgICduYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYScpO1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhKGNvbnN0cmFpbnRzKS50aGVuKG9uU3VjY2Vzcywgb25FcnJvcik7XG4gIH07XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc2hpbUxvY2FsU3RyZWFtc0FQSTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICdvYmplY3QnIHx8ICF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCEoJ2dldExvY2FsU3RyZWFtcycgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0TG9jYWxTdHJlYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghdGhpcy5fbG9jYWxTdHJlYW1zKSB7XG4gICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zID0gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2xvY2FsU3RyZWFtcztcbiAgICAgIH07XG4gICAgfVxuICAgIGlmICghKCdnZXRTdHJlYW1CeUlkJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdHJlYW1CeUlkID0gZnVuY3Rpb24oaWQpIHtcbiAgICAgICAgdmFyIHJlc3VsdCA9IG51bGw7XG4gICAgICAgIGlmICh0aGlzLl9sb2NhbFN0cmVhbXMpIHtcbiAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgIGlmIChzdHJlYW0uaWQgPT09IGlkKSB7XG4gICAgICAgICAgICAgIHJlc3VsdCA9IHN0cmVhbTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5fcmVtb3RlU3RyZWFtcykge1xuICAgICAgICAgIHRoaXMuX3JlbW90ZVN0cmVhbXMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgIGlmIChzdHJlYW0uaWQgPT09IGlkKSB7XG4gICAgICAgICAgICAgIHJlc3VsdCA9IHN0cmVhbTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKCEoJ2FkZFN0cmVhbScgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIHZhciBfYWRkVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgaWYgKCF0aGlzLl9sb2NhbFN0cmVhbXMpIHtcbiAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMgPSBbXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5fbG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA9PT0gLTEpIHtcbiAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgX2FkZFRyYWNrLmNhbGwocGMsIHRyYWNrLCBzdHJlYW0pO1xuICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbih0cmFjaywgc3RyZWFtKSB7XG4gICAgICAgIGlmIChzdHJlYW0pIHtcbiAgICAgICAgICBpZiAoIXRoaXMuX2xvY2FsU3RyZWFtcykge1xuICAgICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zID0gW3N0cmVhbV07XG4gICAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9sb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID09PSAtMSkge1xuICAgICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIF9hZGRUcmFjay5jYWxsKHRoaXMsIHRyYWNrLCBzdHJlYW0pO1xuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKCEoJ3JlbW92ZVN0cmVhbScgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgIGlmICghdGhpcy5fbG9jYWxTdHJlYW1zKSB7XG4gICAgICAgICAgdGhpcy5fbG9jYWxTdHJlYW1zID0gW107XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGluZGV4ID0gdGhpcy5fbG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKTtcbiAgICAgICAgaWYgKGluZGV4ID09PSAtMSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgdmFyIHRyYWNrcyA9IHN0cmVhbS5nZXRUcmFja3MoKTtcbiAgICAgICAgdGhpcy5nZXRTZW5kZXJzKCkuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgICAgICBpZiAodHJhY2tzLmluZGV4T2Yoc2VuZGVyLnRyYWNrKSAhPT0gLTEpIHtcbiAgICAgICAgICAgIHBjLnJlbW92ZVRyYWNrKHNlbmRlcik7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfVxuICB9LFxuICBzaGltUmVtb3RlU3RyZWFtc0FQSTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgIT09ICdvYmplY3QnIHx8ICF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKCEoJ2dldFJlbW90ZVN0cmVhbXMnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlbW90ZVN0cmVhbXMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlbW90ZVN0cmVhbXMgPyB0aGlzLl9yZW1vdGVTdHJlYW1zIDogW107XG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoISgnb25hZGRzdHJlYW0nIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ29uYWRkc3RyZWFtJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9vbmFkZHN0cmVhbTtcbiAgICAgICAgfSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICBpZiAodGhpcy5fb25hZGRzdHJlYW0pIHtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcignYWRkc3RyZWFtJywgdGhpcy5fb25hZGRzdHJlYW0pO1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKCd0cmFjaycsIHRoaXMuX29uYWRkc3RyZWFtcG9seSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcignYWRkc3RyZWFtJywgdGhpcy5fb25hZGRzdHJlYW0gPSBmKTtcbiAgICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoJ3RyYWNrJywgdGhpcy5fb25hZGRzdHJlYW1wb2x5ID0gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgZS5zdHJlYW1zLmZvckVhY2goZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgICAgIGlmICghcGMuX3JlbW90ZVN0cmVhbXMpIHtcbiAgICAgICAgICAgICAgICBwYy5fcmVtb3RlU3RyZWFtcyA9IFtdO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIGlmIChwYy5fcmVtb3RlU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPj0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBwYy5fcmVtb3RlU3RyZWFtcy5wdXNoKHN0cmVhbSk7XG4gICAgICAgICAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnYWRkc3RyZWFtJyk7XG4gICAgICAgICAgICAgIGV2ZW50LnN0cmVhbSA9IHN0cmVhbTtcbiAgICAgICAgICAgICAgcGMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9LFxuICBzaGltQ2FsbGJhY2tzQVBJOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ29iamVjdCcgfHwgIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgcHJvdG90eXBlID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZTtcbiAgICB2YXIgY3JlYXRlT2ZmZXIgPSBwcm90b3R5cGUuY3JlYXRlT2ZmZXI7XG4gICAgdmFyIGNyZWF0ZUFuc3dlciA9IHByb3RvdHlwZS5jcmVhdGVBbnN3ZXI7XG4gICAgdmFyIHNldExvY2FsRGVzY3JpcHRpb24gPSBwcm90b3R5cGUuc2V0TG9jYWxEZXNjcmlwdGlvbjtcbiAgICB2YXIgc2V0UmVtb3RlRGVzY3JpcHRpb24gPSBwcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb247XG4gICAgdmFyIGFkZEljZUNhbmRpZGF0ZSA9IHByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGU7XG5cbiAgICBwcm90b3R5cGUuY3JlYXRlT2ZmZXIgPSBmdW5jdGlvbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgdmFyIG9wdGlvbnMgPSAoYXJndW1lbnRzLmxlbmd0aCA+PSAyKSA/IGFyZ3VtZW50c1syXSA6IGFyZ3VtZW50c1swXTtcbiAgICAgIHZhciBwcm9taXNlID0gY3JlYXRlT2ZmZXIuYXBwbHkodGhpcywgW29wdGlvbnNdKTtcbiAgICAgIGlmICghZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgICAgfVxuICAgICAgcHJvbWlzZS50aGVuKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9O1xuXG4gICAgcHJvdG90eXBlLmNyZWF0ZUFuc3dlciA9IGZ1bmN0aW9uKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgb3B0aW9ucyA9IChhcmd1bWVudHMubGVuZ3RoID49IDIpID8gYXJndW1lbnRzWzJdIDogYXJndW1lbnRzWzBdO1xuICAgICAgdmFyIHByb21pc2UgPSBjcmVhdGVBbnN3ZXIuYXBwbHkodGhpcywgW29wdGlvbnNdKTtcbiAgICAgIGlmICghZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgICAgfVxuICAgICAgcHJvbWlzZS50aGVuKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9O1xuXG4gICAgdmFyIHdpdGhDYWxsYmFjayA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uLCBzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgdmFyIHByb21pc2UgPSBzZXRMb2NhbERlc2NyaXB0aW9uLmFwcGx5KHRoaXMsIFtkZXNjcmlwdGlvbl0pO1xuICAgICAgaWYgKCFmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICB9XG4gICAgICBwcm9taXNlLnRoZW4oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH07XG4gICAgcHJvdG90eXBlLnNldExvY2FsRGVzY3JpcHRpb24gPSB3aXRoQ2FsbGJhY2s7XG5cbiAgICB3aXRoQ2FsbGJhY2sgPSBmdW5jdGlvbihkZXNjcmlwdGlvbiwgc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwcm9taXNlID0gc2V0UmVtb3RlRGVzY3JpcHRpb24uYXBwbHkodGhpcywgW2Rlc2NyaXB0aW9uXSk7XG4gICAgICBpZiAoIWZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgIH1cbiAgICAgIHByb21pc2UudGhlbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjayk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfTtcbiAgICBwcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb24gPSB3aXRoQ2FsbGJhY2s7XG5cbiAgICB3aXRoQ2FsbGJhY2sgPSBmdW5jdGlvbihjYW5kaWRhdGUsIHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcHJvbWlzZSA9IGFkZEljZUNhbmRpZGF0ZS5hcHBseSh0aGlzLCBbY2FuZGlkYXRlXSk7XG4gICAgICBpZiAoIWZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgIH1cbiAgICAgIHByb21pc2UudGhlbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjayk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfTtcbiAgICBwcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlID0gd2l0aENhbGxiYWNrO1xuICB9LFxuICBzaGltR2V0VXNlck1lZGlhOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgbmF2aWdhdG9yID0gd2luZG93ICYmIHdpbmRvdy5uYXZpZ2F0b3I7XG5cbiAgICBpZiAoIW5hdmlnYXRvci5nZXRVc2VyTWVkaWEpIHtcbiAgICAgIGlmIChuYXZpZ2F0b3Iud2Via2l0R2V0VXNlck1lZGlhKSB7XG4gICAgICAgIG5hdmlnYXRvci5nZXRVc2VyTWVkaWEgPSBuYXZpZ2F0b3Iud2Via2l0R2V0VXNlck1lZGlhLmJpbmQobmF2aWdhdG9yKTtcbiAgICAgIH0gZWxzZSBpZiAobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyAmJlxuICAgICAgICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhKSB7XG4gICAgICAgIG5hdmlnYXRvci5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjb25zdHJhaW50cywgY2IsIGVycmNiKSB7XG4gICAgICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAgICAgLnRoZW4oY2IsIGVycmNiKTtcbiAgICAgICAgfS5iaW5kKG5hdmlnYXRvcik7XG4gICAgICB9XG4gICAgfVxuICB9LFxuICBzaGltUlRDSWNlU2VydmVyVXJsczogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gbWlncmF0ZSBmcm9tIG5vbi1zcGVjIFJUQ0ljZVNlcnZlci51cmwgdG8gUlRDSWNlU2VydmVyLnVybHNcbiAgICB2YXIgT3JpZ1BlZXJDb25uZWN0aW9uID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiA9IGZ1bmN0aW9uKHBjQ29uZmlnLCBwY0NvbnN0cmFpbnRzKSB7XG4gICAgICBpZiAocGNDb25maWcgJiYgcGNDb25maWcuaWNlU2VydmVycykge1xuICAgICAgICB2YXIgbmV3SWNlU2VydmVycyA9IFtdO1xuICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHBjQ29uZmlnLmljZVNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICB2YXIgc2VydmVyID0gcGNDb25maWcuaWNlU2VydmVyc1tpXTtcbiAgICAgICAgICBpZiAoIXNlcnZlci5oYXNPd25Qcm9wZXJ0eSgndXJscycpICYmXG4gICAgICAgICAgICAgIHNlcnZlci5oYXNPd25Qcm9wZXJ0eSgndXJsJykpIHtcbiAgICAgICAgICAgIHV0aWxzLmRlcHJlY2F0ZWQoJ1JUQ0ljZVNlcnZlci51cmwnLCAnUlRDSWNlU2VydmVyLnVybHMnKTtcbiAgICAgICAgICAgIHNlcnZlciA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoc2VydmVyKSk7XG4gICAgICAgICAgICBzZXJ2ZXIudXJscyA9IHNlcnZlci51cmw7XG4gICAgICAgICAgICBkZWxldGUgc2VydmVyLnVybDtcbiAgICAgICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChzZXJ2ZXIpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2gocGNDb25maWcuaWNlU2VydmVyc1tpXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHBjQ29uZmlnLmljZVNlcnZlcnMgPSBuZXdJY2VTZXJ2ZXJzO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5ldyBPcmlnUGVlckNvbm5lY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpO1xuICAgIH07XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSA9IE9yaWdQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGU7XG4gICAgLy8gd3JhcCBzdGF0aWMgbWV0aG9kcy4gQ3VycmVudGx5IGp1c3QgZ2VuZXJhdGVDZXJ0aWZpY2F0ZS5cbiAgICBpZiAoJ2dlbmVyYXRlQ2VydGlmaWNhdGUnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiwgJ2dlbmVyYXRlQ2VydGlmaWNhdGUnLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIE9yaWdQZWVyQ29ubmVjdGlvbi5nZW5lcmF0ZUNlcnRpZmljYXRlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIHNoaW1UcmFja0V2ZW50VHJhbnNjZWl2ZXI6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIC8vIEFkZCBldmVudC50cmFuc2NlaXZlciBtZW1iZXIgb3ZlciBkZXByZWNhdGVkIGV2ZW50LnJlY2VpdmVyXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICAoJ3JlY2VpdmVyJyBpbiB3aW5kb3cuUlRDVHJhY2tFdmVudC5wcm90b3R5cGUpICYmXG4gICAgICAgIC8vIGNhbid0IGNoZWNrICd0cmFuc2NlaXZlcicgaW4gd2luZG93LlJUQ1RyYWNrRXZlbnQucHJvdG90eXBlLCBhcyBpdCBpc1xuICAgICAgICAvLyBkZWZpbmVkIGZvciBzb21lIHJlYXNvbiBldmVuIHdoZW4gd2luZG93LlJUQ1RyYW5zY2VpdmVyIGlzIG5vdC5cbiAgICAgICAgIXdpbmRvdy5SVENUcmFuc2NlaXZlcikge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENUcmFja0V2ZW50LnByb3RvdHlwZSwgJ3RyYW5zY2VpdmVyJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB7cmVjZWl2ZXI6IHRoaXMucmVjZWl2ZXJ9O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgc2hpbUNyZWF0ZU9mZmVyTGVnYWN5OiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgb3JpZ0NyZWF0ZU9mZmVyID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jcmVhdGVPZmZlcjtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNyZWF0ZU9mZmVyID0gZnVuY3Rpb24ob2ZmZXJPcHRpb25zKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgaWYgKG9mZmVyT3B0aW9ucykge1xuICAgICAgICBpZiAodHlwZW9mIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIC8vIHN1cHBvcnQgYml0IHZhbHVlc1xuICAgICAgICAgIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvID0gISFvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbztcbiAgICAgICAgfVxuICAgICAgICB2YXIgYXVkaW9UcmFuc2NlaXZlciA9IHBjLmdldFRyYW5zY2VpdmVycygpLmZpbmQoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICByZXR1cm4gdHJhbnNjZWl2ZXIuc2VuZGVyLnRyYWNrICYmXG4gICAgICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRlci50cmFjay5raW5kID09PSAnYXVkaW8nO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvID09PSBmYWxzZSAmJiBhdWRpb1RyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgaWYgKGF1ZGlvVHJhbnNjZWl2ZXIuZGlyZWN0aW9uID09PSAnc2VuZHJlY3YnKSB7XG4gICAgICAgICAgICBpZiAoYXVkaW9UcmFuc2NlaXZlci5zZXREaXJlY3Rpb24pIHtcbiAgICAgICAgICAgICAgYXVkaW9UcmFuc2NlaXZlci5zZXREaXJlY3Rpb24oJ3NlbmRvbmx5Jyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBhdWRpb1RyYW5zY2VpdmVyLmRpcmVjdGlvbiA9ICdzZW5kb25seSc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIGlmIChhdWRpb1RyYW5zY2VpdmVyLmRpcmVjdGlvbiA9PT0gJ3JlY3Zvbmx5Jykge1xuICAgICAgICAgICAgaWYgKGF1ZGlvVHJhbnNjZWl2ZXIuc2V0RGlyZWN0aW9uKSB7XG4gICAgICAgICAgICAgIGF1ZGlvVHJhbnNjZWl2ZXIuc2V0RGlyZWN0aW9uKCdpbmFjdGl2ZScpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgYXVkaW9UcmFuc2NlaXZlci5kaXJlY3Rpb24gPSAnaW5hY3RpdmUnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyA9PT0gdHJ1ZSAmJlxuICAgICAgICAgICAgIWF1ZGlvVHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICBwYy5hZGRUcmFuc2NlaXZlcignYXVkaW8nKTtcbiAgICAgICAgfVxuXG5cbiAgICAgICAgaWYgKHR5cGVvZiBvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVBdWRpbyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAvLyBzdXBwb3J0IGJpdCB2YWx1ZXNcbiAgICAgICAgICBvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbyA9ICEhb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW87XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHZpZGVvVHJhbnNjZWl2ZXIgPSBwYy5nZXRUcmFuc2NlaXZlcnMoKS5maW5kKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgcmV0dXJuIHRyYW5zY2VpdmVyLnNlbmRlci50cmFjayAmJlxuICAgICAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJztcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbyA9PT0gZmFsc2UgJiYgdmlkZW9UcmFuc2NlaXZlcikge1xuICAgICAgICAgIGlmICh2aWRlb1RyYW5zY2VpdmVyLmRpcmVjdGlvbiA9PT0gJ3NlbmRyZWN2Jykge1xuICAgICAgICAgICAgdmlkZW9UcmFuc2NlaXZlci5zZXREaXJlY3Rpb24oJ3NlbmRvbmx5Jyk7XG4gICAgICAgICAgfSBlbHNlIGlmICh2aWRlb1RyYW5zY2VpdmVyLmRpcmVjdGlvbiA9PT0gJ3JlY3Zvbmx5Jykge1xuICAgICAgICAgICAgdmlkZW9UcmFuc2NlaXZlci5zZXREaXJlY3Rpb24oJ2luYWN0aXZlJyk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID09PSB0cnVlICYmXG4gICAgICAgICAgICAhdmlkZW9UcmFuc2NlaXZlcikge1xuICAgICAgICAgIHBjLmFkZFRyYW5zY2VpdmVyKCd2aWRlbycpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gb3JpZ0NyZWF0ZU9mZmVyLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIGxvZ0Rpc2FibGVkXyA9IHRydWU7XG52YXIgZGVwcmVjYXRpb25XYXJuaW5nc18gPSB0cnVlO1xuXG4vKipcbiAqIEV4dHJhY3QgYnJvd3NlciB2ZXJzaW9uIG91dCBvZiB0aGUgcHJvdmlkZWQgdXNlciBhZ2VudCBzdHJpbmcuXG4gKlxuICogQHBhcmFtIHshc3RyaW5nfSB1YXN0cmluZyB1c2VyQWdlbnQgc3RyaW5nLlxuICogQHBhcmFtIHshc3RyaW5nfSBleHByIFJlZ3VsYXIgZXhwcmVzc2lvbiB1c2VkIGFzIG1hdGNoIGNyaXRlcmlhLlxuICogQHBhcmFtIHshbnVtYmVyfSBwb3MgcG9zaXRpb24gaW4gdGhlIHZlcnNpb24gc3RyaW5nIHRvIGJlIHJldHVybmVkLlxuICogQHJldHVybiB7IW51bWJlcn0gYnJvd3NlciB2ZXJzaW9uLlxuICovXG5mdW5jdGlvbiBleHRyYWN0VmVyc2lvbih1YXN0cmluZywgZXhwciwgcG9zKSB7XG4gIHZhciBtYXRjaCA9IHVhc3RyaW5nLm1hdGNoKGV4cHIpO1xuICByZXR1cm4gbWF0Y2ggJiYgbWF0Y2gubGVuZ3RoID49IHBvcyAmJiBwYXJzZUludChtYXRjaFtwb3NdLCAxMCk7XG59XG5cbi8vIFdyYXBzIHRoZSBwZWVyY29ubmVjdGlvbiBldmVudCBldmVudE5hbWVUb1dyYXAgaW4gYSBmdW5jdGlvblxuLy8gd2hpY2ggcmV0dXJucyB0aGUgbW9kaWZpZWQgZXZlbnQgb2JqZWN0LlxuZnVuY3Rpb24gd3JhcFBlZXJDb25uZWN0aW9uRXZlbnQod2luZG93LCBldmVudE5hbWVUb1dyYXAsIHdyYXBwZXIpIHtcbiAgaWYgKCF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIHByb3RvID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZTtcbiAgdmFyIG5hdGl2ZUFkZEV2ZW50TGlzdGVuZXIgPSBwcm90by5hZGRFdmVudExpc3RlbmVyO1xuICBwcm90by5hZGRFdmVudExpc3RlbmVyID0gZnVuY3Rpb24obmF0aXZlRXZlbnROYW1lLCBjYikge1xuICAgIGlmIChuYXRpdmVFdmVudE5hbWUgIT09IGV2ZW50TmFtZVRvV3JhcCkge1xuICAgICAgcmV0dXJuIG5hdGl2ZUFkZEV2ZW50TGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gICAgdmFyIHdyYXBwZWRDYWxsYmFjayA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgIGNiKHdyYXBwZXIoZSkpO1xuICAgIH07XG4gICAgdGhpcy5fZXZlbnRNYXAgPSB0aGlzLl9ldmVudE1hcCB8fCB7fTtcbiAgICB0aGlzLl9ldmVudE1hcFtjYl0gPSB3cmFwcGVkQ2FsbGJhY2s7XG4gICAgcmV0dXJuIG5hdGl2ZUFkZEV2ZW50TGlzdGVuZXIuYXBwbHkodGhpcywgW25hdGl2ZUV2ZW50TmFtZSxcbiAgICAgIHdyYXBwZWRDYWxsYmFja10pO1xuICB9O1xuXG4gIHZhciBuYXRpdmVSZW1vdmVFdmVudExpc3RlbmVyID0gcHJvdG8ucmVtb3ZlRXZlbnRMaXN0ZW5lcjtcbiAgcHJvdG8ucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IGZ1bmN0aW9uKG5hdGl2ZUV2ZW50TmFtZSwgY2IpIHtcbiAgICBpZiAobmF0aXZlRXZlbnROYW1lICE9PSBldmVudE5hbWVUb1dyYXAgfHwgIXRoaXMuX2V2ZW50TWFwXG4gICAgICAgIHx8ICF0aGlzLl9ldmVudE1hcFtjYl0pIHtcbiAgICAgIHJldHVybiBuYXRpdmVSZW1vdmVFdmVudExpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICAgIHZhciB1bndyYXBwZWRDYiA9IHRoaXMuX2V2ZW50TWFwW2NiXTtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRNYXBbY2JdO1xuICAgIHJldHVybiBuYXRpdmVSZW1vdmVFdmVudExpc3RlbmVyLmFwcGx5KHRoaXMsIFtuYXRpdmVFdmVudE5hbWUsXG4gICAgICB1bndyYXBwZWRDYl0pO1xuICB9O1xuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShwcm90bywgJ29uJyArIGV2ZW50TmFtZVRvV3JhcCwge1xuICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpc1snX29uJyArIGV2ZW50TmFtZVRvV3JhcF07XG4gICAgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uKGNiKSB7XG4gICAgICBpZiAodGhpc1snX29uJyArIGV2ZW50TmFtZVRvV3JhcF0pIHtcbiAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZVRvV3JhcCxcbiAgICAgICAgICAgIHRoaXNbJ19vbicgKyBldmVudE5hbWVUb1dyYXBdKTtcbiAgICAgICAgZGVsZXRlIHRoaXNbJ19vbicgKyBldmVudE5hbWVUb1dyYXBdO1xuICAgICAgfVxuICAgICAgaWYgKGNiKSB7XG4gICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWVUb1dyYXAsXG4gICAgICAgICAgICB0aGlzWydfb24nICsgZXZlbnROYW1lVG9XcmFwXSA9IGNiKTtcbiAgICAgIH1cbiAgICB9LFxuICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgY29uZmlndXJhYmxlOiB0cnVlXG4gIH0pO1xufVxuXG4vLyBVdGlsaXR5IG1ldGhvZHMuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgZXh0cmFjdFZlcnNpb246IGV4dHJhY3RWZXJzaW9uLFxuICB3cmFwUGVlckNvbm5lY3Rpb25FdmVudDogd3JhcFBlZXJDb25uZWN0aW9uRXZlbnQsXG4gIGRpc2FibGVMb2c6IGZ1bmN0aW9uKGJvb2wpIHtcbiAgICBpZiAodHlwZW9mIGJvb2wgIT09ICdib29sZWFuJykge1xuICAgICAgcmV0dXJuIG5ldyBFcnJvcignQXJndW1lbnQgdHlwZTogJyArIHR5cGVvZiBib29sICtcbiAgICAgICAgICAnLiBQbGVhc2UgdXNlIGEgYm9vbGVhbi4nKTtcbiAgICB9XG4gICAgbG9nRGlzYWJsZWRfID0gYm9vbDtcbiAgICByZXR1cm4gKGJvb2wpID8gJ2FkYXB0ZXIuanMgbG9nZ2luZyBkaXNhYmxlZCcgOlxuICAgICAgICAnYWRhcHRlci5qcyBsb2dnaW5nIGVuYWJsZWQnO1xuICB9LFxuXG4gIC8qKlxuICAgKiBEaXNhYmxlIG9yIGVuYWJsZSBkZXByZWNhdGlvbiB3YXJuaW5nc1xuICAgKiBAcGFyYW0geyFib29sZWFufSBib29sIHNldCB0byB0cnVlIHRvIGRpc2FibGUgd2FybmluZ3MuXG4gICAqL1xuICBkaXNhYmxlV2FybmluZ3M6IGZ1bmN0aW9uKGJvb2wpIHtcbiAgICBpZiAodHlwZW9mIGJvb2wgIT09ICdib29sZWFuJykge1xuICAgICAgcmV0dXJuIG5ldyBFcnJvcignQXJndW1lbnQgdHlwZTogJyArIHR5cGVvZiBib29sICtcbiAgICAgICAgICAnLiBQbGVhc2UgdXNlIGEgYm9vbGVhbi4nKTtcbiAgICB9XG4gICAgZGVwcmVjYXRpb25XYXJuaW5nc18gPSAhYm9vbDtcbiAgICByZXR1cm4gJ2FkYXB0ZXIuanMgZGVwcmVjYXRpb24gd2FybmluZ3MgJyArIChib29sID8gJ2Rpc2FibGVkJyA6ICdlbmFibGVkJyk7XG4gIH0sXG5cbiAgbG9nOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmIChsb2dEaXNhYmxlZF8pIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgY29uc29sZS5sb2cgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY29uc29sZS5sb2cuYXBwbHkoY29uc29sZSwgYXJndW1lbnRzKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIFNob3dzIGEgZGVwcmVjYXRpb24gd2FybmluZyBzdWdnZXN0aW5nIHRoZSBtb2Rlcm4gYW5kIHNwZWMtY29tcGF0aWJsZSBBUEkuXG4gICAqL1xuICBkZXByZWNhdGVkOiBmdW5jdGlvbihvbGRNZXRob2QsIG5ld01ldGhvZCkge1xuICAgIGlmICghZGVwcmVjYXRpb25XYXJuaW5nc18pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc29sZS53YXJuKG9sZE1ldGhvZCArICcgaXMgZGVwcmVjYXRlZCwgcGxlYXNlIHVzZSAnICsgbmV3TWV0aG9kICtcbiAgICAgICAgJyBpbnN0ZWFkLicpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBCcm93c2VyIGRldGVjdG9yLlxuICAgKlxuICAgKiBAcmV0dXJuIHtvYmplY3R9IHJlc3VsdCBjb250YWluaW5nIGJyb3dzZXIgYW5kIHZlcnNpb25cbiAgICogICAgIHByb3BlcnRpZXMuXG4gICAqL1xuICBkZXRlY3RCcm93c2VyOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgbmF2aWdhdG9yID0gd2luZG93ICYmIHdpbmRvdy5uYXZpZ2F0b3I7XG5cbiAgICAvLyBSZXR1cm5lZCByZXN1bHQgb2JqZWN0LlxuICAgIHZhciByZXN1bHQgPSB7fTtcbiAgICByZXN1bHQuYnJvd3NlciA9IG51bGw7XG4gICAgcmVzdWx0LnZlcnNpb24gPSBudWxsO1xuXG4gICAgLy8gRmFpbCBlYXJseSBpZiBpdCdzIG5vdCBhIGJyb3dzZXJcbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcgfHwgIXdpbmRvdy5uYXZpZ2F0b3IpIHtcbiAgICAgIHJlc3VsdC5icm93c2VyID0gJ05vdCBhIGJyb3dzZXIuJztcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgaWYgKG5hdmlnYXRvci5tb3pHZXRVc2VyTWVkaWEpIHsgLy8gRmlyZWZveC5cbiAgICAgIHJlc3VsdC5icm93c2VyID0gJ2ZpcmVmb3gnO1xuICAgICAgcmVzdWx0LnZlcnNpb24gPSBleHRyYWN0VmVyc2lvbihuYXZpZ2F0b3IudXNlckFnZW50LFxuICAgICAgICAgIC9GaXJlZm94XFwvKFxcZCspXFwuLywgMSk7XG4gICAgfSBlbHNlIGlmIChuYXZpZ2F0b3Iud2Via2l0R2V0VXNlck1lZGlhKSB7XG4gICAgICAvLyBDaHJvbWUsIENocm9taXVtLCBXZWJ2aWV3LCBPcGVyYS5cbiAgICAgIC8vIFZlcnNpb24gbWF0Y2hlcyBDaHJvbWUvV2ViUlRDIHZlcnNpb24uXG4gICAgICByZXN1bHQuYnJvd3NlciA9ICdjaHJvbWUnO1xuICAgICAgcmVzdWx0LnZlcnNpb24gPSBleHRyYWN0VmVyc2lvbihuYXZpZ2F0b3IudXNlckFnZW50LFxuICAgICAgICAgIC9DaHJvbShlfGl1bSlcXC8oXFxkKylcXC4vLCAyKTtcbiAgICB9IGVsc2UgaWYgKG5hdmlnYXRvci5tZWRpYURldmljZXMgJiZcbiAgICAgICAgbmF2aWdhdG9yLnVzZXJBZ2VudC5tYXRjaCgvRWRnZVxcLyhcXGQrKS4oXFxkKykkLykpIHsgLy8gRWRnZS5cbiAgICAgIHJlc3VsdC5icm93c2VyID0gJ2VkZ2UnO1xuICAgICAgcmVzdWx0LnZlcnNpb24gPSBleHRyYWN0VmVyc2lvbihuYXZpZ2F0b3IudXNlckFnZW50LFxuICAgICAgICAgIC9FZGdlXFwvKFxcZCspLihcXGQrKSQvLCAyKTtcbiAgICB9IGVsc2UgaWYgKHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICBuYXZpZ2F0b3IudXNlckFnZW50Lm1hdGNoKC9BcHBsZVdlYktpdFxcLyhcXGQrKVxcLi8pKSB7IC8vIFNhZmFyaS5cbiAgICAgIHJlc3VsdC5icm93c2VyID0gJ3NhZmFyaSc7XG4gICAgICByZXN1bHQudmVyc2lvbiA9IGV4dHJhY3RWZXJzaW9uKG5hdmlnYXRvci51c2VyQWdlbnQsXG4gICAgICAgICAgL0FwcGxlV2ViS2l0XFwvKFxcZCspXFwuLywgMSk7XG4gICAgfSBlbHNlIHsgLy8gRGVmYXVsdCBmYWxsdGhyb3VnaDogbm90IHN1cHBvcnRlZC5cbiAgICAgIHJlc3VsdC5icm93c2VyID0gJ05vdCBhIHN1cHBvcnRlZCBicm93c2VyLic7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbmltcG9ydCBNaWNUZXN0IGZyb20gJy4uL3VuaXQvbWljLmpzJztcbmltcG9ydCBSdW5Db25uZWN0aXZpdHlUZXN0IGZyb20gJy4uL3VuaXQvY29ubi5qcyc7XG5pbXBvcnQgQ2FtUmVzb2x1dGlvbnNUZXN0IGZyb20gJy4uL3VuaXQvY2FtcmVzb2x1dGlvbnMuanMnO1xuaW1wb3J0IE5ldHdvcmtUZXN0IGZyb20gJy4uL3VuaXQvbmV0LmpzJztcbmltcG9ydCBEYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0IGZyb20gJy4uL3VuaXQvZGF0YUJhbmR3aWR0aC5qcyc7XG5pbXBvcnQgVmlkZW9CYW5kd2lkdGhUZXN0IGZyb20gJy4uL3VuaXQvdmlkZW9CYW5kd2lkdGguanMnO1xuaW1wb3J0IFdpRmlQZXJpb2RpY1NjYW5UZXN0IGZyb20gJy4uL3VuaXQvd2lmaVBlcmlvZGljU2Nhbi5qcyc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL2NhbGwuanMnO1xuXG5pbXBvcnQgU3VpdGUgZnJvbSAnLi9zdWl0ZS5qcyc7XG5pbXBvcnQgVGVzdENhc2UgZnJvbSAnLi90ZXN0Q2FzZS5qcyc7XG5cbmV4cG9ydCBjb25zdCBURVNUUyA9IHtcbiAgQVVESU9DQVBUVVJFOiAnQXVkaW8gY2FwdHVyZScsXG4gIENIRUNLUkVTT0xVVElPTjI0MDogJ0NoZWNrIHJlc29sdXRpb24gMzIweDI0MCcsXG4gIENIRUNLUkVTT0xVVElPTjQ4MDogJ0NoZWNrIHJlc29sdXRpb24gNjQweDQ4MCcsXG4gIENIRUNLUkVTT0xVVElPTjcyMDogJ0NoZWNrIHJlc29sdXRpb24gMTI4MHg3MjAnLFxuICBDSEVDS1NVUFBPUlRFRFJFU09MVVRJT05TOiAnQ2hlY2sgc3VwcG9ydGVkIHJlc29sdXRpb25zJyxcbiAgREFUQVRIUk9VR0hQVVQ6ICdEYXRhIHRocm91Z2hwdXQnLFxuICBJUFY2RU5BQkxFRDogJ0lwdjYgZW5hYmxlZCcsXG4gIE5FVFdPUktMQVRFTkNZOiAnTmV0d29yayBsYXRlbmN5JyxcbiAgTkVUV09SS0xBVEVOQ1lSRUxBWTogJ05ldHdvcmsgbGF0ZW5jeSAtIFJlbGF5JyxcbiAgVURQRU5BQkxFRDogJ1VkcCBlbmFibGVkJyxcbiAgVENQRU5BQkxFRDogJ1RjcCBlbmFibGVkJyxcbiAgVklERU9CQU5EV0lEVEg6ICdWaWRlbyBiYW5kd2lkdGgnLFxuICBSRUxBWUNPTk5FQ1RJVklUWTogJ1JlbGF5IGNvbm5lY3Rpdml0eScsXG4gIFJFRkxFWElWRUNPTk5FQ1RJVklUWTogJ1JlZmxleGl2ZSBjb25uZWN0aXZpdHknLFxuICBIT1NUQ09OTkVDVElWSVRZOiAnSG9zdCBjb25uZWN0aXZpdHknXG59O1xuXG5leHBvcnQgY29uc3QgU1VJVEVTID0ge1xuICAgIENBTUVSQTogJ0NhbWVyYScsXG4gICAgTUlDUk9QSE9ORTogJ01pY3JvcGhvbmUnLFxuICAgIE5FVFdPUks6ICdOZXR3b3JrJyxcbiAgICBDT05ORUNUSVZJVFk6ICdDb25uZWN0aXZpdHknLFxuICAgIFRIUk9VR0hQVVQ6ICdUaHJvdWdocHV0J1xuICB9O1xuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRNaWNyb1N1aXRlKGNvbmZpZywgZmlsdGVyKSB7XG4gIGNvbnN0IG1pY1N1aXRlID0gbmV3IFN1aXRlKFNVSVRFUy5NSUNST1BIT05FLCBjb25maWcpO1xuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLkFVRElPQ0FQVFVSRSkpIHtcbiAgICBtaWNTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKG1pY1N1aXRlLCBURVNUUy5BVURJT0NBUFRVUkUsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgbWljVGVzdCA9IG5ldyBNaWNUZXN0KHRlc3QpO1xuICAgICAgbWljVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICByZXR1cm4gbWljU3VpdGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENhbWVyYVN1aXRlKGNvbmZpZykge1xuICBjb25zdCBjYW1lcmFTdWl0ZSA9IG5ldyBTdWl0ZShTVUlURVMuQ0FNRVJBLCBjb25maWcpO1xuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLkNIRUNLUkVTT0xVVElPTjI0MCkpIHtcbiAgICBjYW1lcmFTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNhbWVyYVN1aXRlLCBURVNUUy5DSEVDS1JFU09MVVRJT04yNDAsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgY2FtUmVzb2x1dGlvbnNUZXN0ID0gbmV3IENhbVJlc29sdXRpb25zVGVzdCh0ZXN0ICwgW1szMjAsIDI0MF1dKTtcbiAgICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5DSEVDS1JFU09MVVRJT040ODApKSB7XG4gICAgY2FtZXJhU3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShjYW1lcmFTdWl0ZSwgVEVTVFMuQ0hFQ0tSRVNPTFVUSU9ONDgwLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIGNhbVJlc29sdXRpb25zVGVzdCA9IG5ldyBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgW1s2NDAsIDQ4MF1dKTtcbiAgICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5DSEVDS1JFU09MVVRJT043MjApKSB7XG4gICAgY2FtZXJhU3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShjYW1lcmFTdWl0ZSwgVEVTVFMuQ0hFQ0tSRVNPTFVUSU9ONzIwLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIGNhbVJlc29sdXRpb25zVGVzdCA9IG5ldyBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgW1sxMjgwLCA3MjBdXSk7XG4gICAgICBjYW1SZXNvbHV0aW9uc1Rlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuQ0hFQ0tTVVBQT1JURURSRVNPTFVUSU9OUykpIHtcbiAgICBjYW1lcmFTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNhbWVyYVN1aXRlLCBURVNUUy5DSEVDS1NVUFBPUlRFRFJFU09MVVRJT05TLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHJlc29sdXRpb25BcnJheSA9IFtcbiAgICAgICAgWzE2MCwgMTIwXSwgWzMyMCwgMTgwXSwgWzMyMCwgMjQwXSwgWzY0MCwgMzYwXSwgWzY0MCwgNDgwXSwgWzc2OCwgNTc2XSxcbiAgICAgICAgWzEwMjQsIDU3Nl0sIFsxMjgwLCA3MjBdLCBbMTI4MCwgNzY4XSwgWzEyODAsIDgwMF0sIFsxOTIwLCAxMDgwXSxcbiAgICAgICAgWzE5MjAsIDEyMDBdLCBbMzg0MCwgMjE2MF0sIFs0MDk2LCAyMTYwXVxuICAgICAgXTtcbiAgICAgIHZhciBjYW1SZXNvbHV0aW9uc1Rlc3QgPSBuZXcgQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QsIHJlc29sdXRpb25BcnJheSk7XG4gICAgICBjYW1SZXNvbHV0aW9uc1Rlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgcmV0dXJuIGNhbWVyYVN1aXRlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGROZXR3b3JrU3VpdGUoY29uZmlnKSB7XG4gIGNvbnN0IG5ldHdvcmtTdWl0ZSA9IG5ldyBTdWl0ZShTVUlURVMuTkVUV09SSywgY29uZmlnKTtcblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5VRFBFTkFCTEVEKSkge1xuICAgIC8vIFRlc3Qgd2hldGhlciBpdCBjYW4gY29ubmVjdCB2aWEgVURQIHRvIGEgVFVSTiBzZXJ2ZXJcbiAgICAvLyBHZXQgYSBUVVJOIGNvbmZpZywgYW5kIHRyeSB0byBnZXQgYSByZWxheSBjYW5kaWRhdGUgdXNpbmcgVURQLlxuICAgIG5ldHdvcmtTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKG5ldHdvcmtTdWl0ZSwgVEVTVFMuVURQRU5BQkxFRCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBuZXR3b3JrVGVzdCA9IG5ldyBOZXR3b3JrVGVzdCh0ZXN0LCAndWRwJywgbnVsbCwgQ2FsbC5pc1JlbGF5KTtcbiAgICAgIG5ldHdvcmtUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLlRDUEVOQUJMRUQpKSB7XG4gICAgLy8gVGVzdCB3aGV0aGVyIGl0IGNhbiBjb25uZWN0IHZpYSBUQ1AgdG8gYSBUVVJOIHNlcnZlclxuICAgIC8vIEdldCBhIFRVUk4gY29uZmlnLCBhbmQgdHJ5IHRvIGdldCBhIHJlbGF5IGNhbmRpZGF0ZSB1c2luZyBUQ1AuXG4gICAgbmV0d29ya1N1aXRlLmFkZChuZXcgVGVzdENhc2UobmV0d29ya1N1aXRlLCBURVNUUy5UQ1BFTkFCTEVELCAodGVzdCkgPT4ge1xuICAgICAgdmFyIG5ldHdvcmtUZXN0ID0gbmV3IE5ldHdvcmtUZXN0KHRlc3QsICd0Y3AnLCBudWxsLCBDYWxsLmlzUmVsYXkpO1xuICAgICAgbmV0d29ya1Rlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuSVBWNkVOQUJMRUQpKSB7XG4gICAgLy8gVGVzdCB3aGV0aGVyIGl0IGlzIElQdjYgZW5hYmxlZCAoVE9ETzogdGVzdCBJUHY2IHRvIGEgZGVzdGluYXRpb24pLlxuICAgIC8vIFR1cm4gb24gSVB2NiwgYW5kIHRyeSB0byBnZXQgYW4gSVB2NiBob3N0IGNhbmRpZGF0ZS5cbiAgICBuZXR3b3JrU3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShuZXR3b3JrU3VpdGUsIFRFU1RTLklQVjZFTkFCTEVELCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHBhcmFtcyA9IHtvcHRpb25hbDogW3tnb29nSVB2NjogdHJ1ZX1dfTtcbiAgICAgIHZhciBuZXR3b3JrVGVzdCA9IG5ldyBOZXR3b3JrVGVzdCh0ZXN0LCBudWxsLCBwYXJhbXMsIENhbGwuaXNJcHY2KTtcbiAgICAgIG5ldHdvcmtUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIHJldHVybiBuZXR3b3JrU3VpdGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZENvbm5lY3Rpdml0eVN1aXRlKGNvbmZpZykge1xuICBjb25zdCBjb25uZWN0aXZpdHlTdWl0ZSA9IG5ldyBTdWl0ZShTVUlURVMuQ09OTkVDVElWSVRZLCBjb25maWcpO1xuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLlJFTEFZQ09OTkVDVElWSVRZKSkge1xuICAgIC8vIFNldCB1cCBhIGRhdGFjaGFubmVsIGJldHdlZW4gdHdvIHBlZXJzIHRocm91Z2ggYSByZWxheVxuICAgIC8vIGFuZCB2ZXJpZnkgZGF0YSBjYW4gYmUgdHJhbnNtaXR0ZWQgYW5kIHJlY2VpdmVkXG4gICAgLy8gKHBhY2tldHMgdHJhdmVsIHRocm91Z2ggdGhlIHB1YmxpYyBpbnRlcm5ldClcbiAgICBjb25uZWN0aXZpdHlTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNvbm5lY3Rpdml0eVN1aXRlLCBURVNUUy5SRUxBWUNPTk5FQ1RJVklUWSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBydW5Db25uZWN0aXZpdHlUZXN0ID0gbmV3IFJ1bkNvbm5lY3Rpdml0eVRlc3QodGVzdCwgQ2FsbC5pc1JlbGF5KTtcbiAgICAgIHJ1bkNvbm5lY3Rpdml0eVRlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuUkVGTEVYSVZFQ09OTkVDVElWSVRZKSkge1xuICAgIC8vIFNldCB1cCBhIGRhdGFjaGFubmVsIGJldHdlZW4gdHdvIHBlZXJzIHRocm91Z2ggYSBwdWJsaWMgSVAgYWRkcmVzc1xuICAgIC8vIGFuZCB2ZXJpZnkgZGF0YSBjYW4gYmUgdHJhbnNtaXR0ZWQgYW5kIHJlY2VpdmVkXG4gICAgLy8gKHBhY2tldHMgc2hvdWxkIHN0YXkgb24gdGhlIGxpbmsgaWYgYmVoaW5kIGEgcm91dGVyIGRvaW5nIE5BVClcbiAgICBjb25uZWN0aXZpdHlTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNvbm5lY3Rpdml0eVN1aXRlLCBURVNUUy5SRUZMRVhJVkVDT05ORUNUSVZJVFksICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgcnVuQ29ubmVjdGl2aXR5VGVzdCA9IG5ldyBSdW5Db25uZWN0aXZpdHlUZXN0KHRlc3QsIENhbGwuaXNSZWZsZXhpdmUpO1xuICAgICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5IT1NUQ09OTkVDVElWSVRZKSkge1xuICAgIC8vIFNldCB1cCBhIGRhdGFjaGFubmVsIGJldHdlZW4gdHdvIHBlZXJzIHRocm91Z2ggYSBsb2NhbCBJUCBhZGRyZXNzXG4gICAgLy8gYW5kIHZlcmlmeSBkYXRhIGNhbiBiZSB0cmFuc21pdHRlZCBhbmQgcmVjZWl2ZWRcbiAgICAvLyAocGFja2V0cyBzaG91bGQgbm90IGxlYXZlIHRoZSBtYWNoaW5lIHJ1bm5pbmcgdGhlIHRlc3QpXG4gICAgY29ubmVjdGl2aXR5U3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShjb25uZWN0aXZpdHlTdWl0ZSwgVEVTVFMuSE9TVENPTk5FQ1RJVklUWSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBydW5Db25uZWN0aXZpdHlUZXN0ID0gbmV3IFJ1bkNvbm5lY3Rpdml0eVRlc3QodGVzdCwgQ2FsbC5pc0hvc3QpO1xuICAgICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5zdGFydCgpO1xuICAgIH0pKTtcbiAgfVxuXG4gIHJldHVybiBjb25uZWN0aXZpdHlTdWl0ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkVGhyb3VnaHB1dFN1aXRlKGNvbmZpZykge1xuICBjb25zdCB0aHJvdWdocHV0U3VpdGUgPSBuZXcgU3VpdGUoU1VJVEVTLlRIUk9VR0hQVVQsIGNvbmZpZyk7XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuREFUQVRIUk9VR0hQVVQpKSB7XG4gICAgLy8gQ3JlYXRlcyBhIGxvb3BiYWNrIHZpYSByZWxheSBjYW5kaWRhdGVzIGFuZCB0cmllcyB0byBzZW5kIGFzIG1hbnkgcGFja2V0c1xuICAgIC8vIHdpdGggMTAyNCBjaGFycyBhcyBwb3NzaWJsZSB3aGlsZSBrZWVwaW5nIGRhdGFDaGFubmVsIGJ1ZmZlcmVkQW1tb3VudCBhYm92ZVxuICAgIC8vIHplcm8uXG4gICAgdGhyb3VnaHB1dFN1aXRlLmFkZChuZXcgVGVzdENhc2UodGhyb3VnaHB1dFN1aXRlLCBURVNUUy5EQVRBVEhST1VHSFBVVCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBkYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0ID0gbmV3IERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QodGVzdCk7XG4gICAgICBkYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLlZJREVPQkFORFdJRFRIKSkge1xuICAgIC8vIE1lYXN1cmVzIHZpZGVvIGJhbmR3aWR0aCBlc3RpbWF0aW9uIHBlcmZvcm1hbmNlIGJ5IGRvaW5nIGEgbG9vcGJhY2sgY2FsbCB2aWFcbiAgICAvLyByZWxheSBjYW5kaWRhdGVzIGZvciA0MCBzZWNvbmRzLiBDb21wdXRlcyBydHQgYW5kIGJhbmR3aWR0aCBlc3RpbWF0aW9uXG4gICAgLy8gYXZlcmFnZSBhbmQgbWF4aW11bSBhcyB3ZWxsIGFzIHRpbWUgdG8gcmFtcCB1cCAoZGVmaW5lZCBhcyByZWFjaGluZyA3NSUgb2ZcbiAgICAvLyB0aGUgbWF4IGJpdHJhdGUuIEl0IHJlcG9ydHMgaW5maW5pdGUgdGltZSB0byByYW1wIHVwIGlmIG5ldmVyIHJlYWNoZXMgaXQuXG4gICAgdGhyb3VnaHB1dFN1aXRlLmFkZChuZXcgVGVzdENhc2UodGhyb3VnaHB1dFN1aXRlLCBURVNUUy5WSURFT0JBTkRXSURUSCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciB2aWRlb0JhbmR3aWR0aFRlc3QgPSBuZXcgVmlkZW9CYW5kd2lkdGhUZXN0KHRlc3QpO1xuICAgICAgdmlkZW9CYW5kd2lkdGhUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLk5FVFdPUktMQVRFTkNZKSkge1xuICAgIHRocm91Z2hwdXRTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKHRocm91Z2hwdXRTdWl0ZSwgVEVTVFMuTkVUV09SS0xBVEVOQ1ksICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgd2lGaVBlcmlvZGljU2NhblRlc3QgPSBuZXcgV2lGaVBlcmlvZGljU2NhblRlc3QodGVzdCxcbiAgICAgICAgICBDYWxsLmlzTm90SG9zdENhbmRpZGF0ZSk7XG4gICAgICB3aUZpUGVyaW9kaWNTY2FuVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5ORVRXT1JLTEFURU5DWVJFTEFZKSkge1xuICAgIHRocm91Z2hwdXRTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKHRocm91Z2hwdXRTdWl0ZSwgVEVTVFMuTkVUV09SS0xBVEVOQ1lSRUxBWSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciB3aUZpUGVyaW9kaWNTY2FuVGVzdCA9IG5ldyBXaUZpUGVyaW9kaWNTY2FuVGVzdCh0ZXN0LCBDYWxsLmlzUmVsYXkpO1xuICAgICAgd2lGaVBlcmlvZGljU2NhblRlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgcmV0dXJuIHRocm91Z2hwdXRTdWl0ZTtcbn1cbiIsImNsYXNzIFN1aXRlIHtcbiAgY29uc3RydWN0b3IobmFtZSwgY29uZmlnKSB7XG4gICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB0aGlzLnNldHRpbmdzID0gY29uZmlnO1xuICAgIHRoaXMudGVzdHMgPSBbXTtcbiAgfVxuXG4gIGdldFRlc3RzKCkge1xuICAgIHJldHVybiB0aGlzLnRlc3RzO1xuICB9XG5cbiAgYWRkKHRlc3QpIHtcbiAgICB0aGlzLnRlc3RzLnB1c2godGVzdCk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU3VpdGU7XG4iLCJjbGFzcyBUZXN0Q2FzZSB7XG4gIGNvbnN0cnVjdG9yKHN1aXRlLCBuYW1lLCBmbikge1xuICAgIHRoaXMuc3VpdGUgPSBzdWl0ZTtcbiAgICB0aGlzLnNldHRpbmdzID0gdGhpcy5zdWl0ZS5zZXR0aW5ncztcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMuZm4gPSBmbjtcbiAgICB0aGlzLnByb2dyZXNzID0gMDtcbiAgICB0aGlzLnN0YXR1cyA9ICd3YWl0aW5nJztcbiAgfVxuXG4gIHNldFByb2dyZXNzKHZhbHVlKSB7XG4gICAgdGhpcy5wcm9ncmVzcyA9IHZhbHVlO1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFByb2dyZXNzKHRoaXMuc3VpdGUubmFtZSwgdGhpcy5uYW1lLCB2YWx1ZSk7XG4gIH1cblxuICBydW4oY2FsbGJhY2tzLCBkb25lQ2FsbGJhY2spIHtcbiAgICB0aGlzLmZuKHRoaXMpO1xuICAgIHRoaXMuY2FsbGJhY2tzID0gY2FsbGJhY2tzO1xuICAgIHRoaXMuZG9uZUNhbGxiYWNrID0gZG9uZUNhbGxiYWNrO1xuICAgIHRoaXMuc2V0UHJvZ3Jlc3MoMCk7XG4gIH1cblxuICByZXBvcnRJbmZvKG0pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXBvcnQodGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsICdpbmZvJywgbSk7XG4gIH1cbiAgcmVwb3J0U3VjY2VzcyhtKSB7XG4gICAgdGhpcy5jYWxsYmFja3Mub25UZXN0UmVwb3J0KHRoaXMuc3VpdGUubmFtZSwgdGhpcy5uYW1lLCAnc3VjY2VzcycsIG0pO1xuICAgIHRoaXMuc3RhdHVzID0gJ3N1Y2Nlc3MnO1xuICB9XG4gIHJlcG9ydEVycm9yKG0pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXBvcnQodGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsICdlcnJvcicsIG0pO1xuICAgIHRoaXMuc3RhdHVzID0gJ2Vycm9yJztcbiAgfVxuICByZXBvcnRXYXJuaW5nKG0pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXBvcnQodGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsICd3YXJuaW5nJywgbSk7XG4gICAgdGhpcy5zdGF0dXMgPSAnd2FybmluZyc7XG4gIH1cbiAgcmVwb3J0RmF0YWwobSkge1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFJlcG9ydCh0aGlzLnN1aXRlLm5hbWUsIHRoaXMubmFtZSwgJ2Vycm9yJywgbSk7XG4gICAgdGhpcy5zdGF0dXMgPSAnZXJyb3InO1xuICB9XG4gIGRvbmUoKSB7XG4gICAgaWYgKHRoaXMucHJvZ3Jlc3MgPCAxMDApIHRoaXMuc2V0UHJvZ3Jlc3MoMTAwKTtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXN1bHQodGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsIHRoaXMuc3RhdHVzKTtcbiAgICB0aGlzLmRvbmVDYWxsYmFjaygpO1xuICB9XG5cbiAgZG9HZXRVc2VyTWVkaWEoY29uc3RyYWludHMsIG9uU3VjY2Vzcywgb25GYWlsKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRyeSB7XG4gICAgICAvLyBDYWxsIGludG8gZ2V0VXNlck1lZGlhIHZpYSB0aGUgcG9seWZpbGwgKGFkYXB0ZXIuanMpLlxuICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAgICAgLnRoZW4oZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgICB2YXIgY2FtID0gc2VsZi5nZXREZXZpY2VOYW1lXyhzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKSk7XG4gICAgICAgICAgICB2YXIgbWljID0gc2VsZi5nZXREZXZpY2VOYW1lXyhzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKSk7XG4gICAgICAgICAgICBvblN1Y2Nlc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgaWYgKG9uRmFpbCkge1xuICAgICAgICAgICAgICBvbkZhaWwuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHNlbGYucmVwb3J0RmF0YWwoJ0ZhaWxlZCB0byBnZXQgYWNjZXNzIHRvIGxvY2FsIG1lZGlhIGR1ZSB0byAnICtcbiAgICAgICAgICAgICAgICAgICdlcnJvcjogJyArIGVycm9yLm5hbWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJldHVybiB0aGlzLnJlcG9ydEZhdGFsKCdnZXRVc2VyTWVkaWEgZmFpbGVkIHdpdGggZXhjZXB0aW9uOiAnICtcbiAgICAgICAgICBlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHNldFRpbWVvdXRXaXRoUHJvZ3Jlc3NCYXIodGltZW91dENhbGxiYWNrLCB0aW1lb3V0TXMpIHtcbiAgICB2YXIgc3RhcnQgPSB3aW5kb3cucGVyZm9ybWFuY2Uubm93KCk7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciB1cGRhdGVQcm9ncmVzc0JhciA9IHNldEludGVydmFsKGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG5vdyA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKTtcbiAgICAgIHNlbGYuc2V0UHJvZ3Jlc3MoKG5vdyAtIHN0YXJ0KSAqIDEwMCAvIHRpbWVvdXRNcyk7XG4gICAgfSwgMTAwKTtcbiAgICB2YXIgdGltZW91dFRhc2sgPSBmdW5jdGlvbigpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodXBkYXRlUHJvZ3Jlc3NCYXIpO1xuICAgICAgc2VsZi5zZXRQcm9ncmVzcygxMDApO1xuICAgICAgdGltZW91dENhbGxiYWNrKCk7XG4gICAgfTtcbiAgICB2YXIgdGltZXIgPSBzZXRUaW1lb3V0KHRpbWVvdXRUYXNrLCB0aW1lb3V0TXMpO1xuICAgIHZhciBmaW5pc2hQcm9ncmVzc0JhciA9IGZ1bmN0aW9uKCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgIHRpbWVvdXRUYXNrKCk7XG4gICAgfTtcbiAgICByZXR1cm4gZmluaXNoUHJvZ3Jlc3NCYXI7XG4gIH1cblxuICBnZXREZXZpY2VOYW1lXyh0cmFja3MpIHtcbiAgICBpZiAodHJhY2tzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIHJldHVybiB0cmFja3NbMF0ubGFiZWw7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgVGVzdENhc2U7XG4iLCJpbXBvcnQgKiBhcyBDb25maWcgZnJvbSAnLi9jb25maWcnO1xuXG5mdW5jdGlvbiBydW5BbGxTZXF1ZW50aWFsbHkodGFza3MsIGNhbGxiYWNrcykge1xuICB2YXIgY3VycmVudCA9IC0xO1xuICB2YXIgcnVuTmV4dEFzeW5jID0gc2V0VGltZW91dC5iaW5kKG51bGwsIHJ1bk5leHQpO1xuICBydW5OZXh0QXN5bmMoKTtcbiAgZnVuY3Rpb24gcnVuTmV4dCgpIHtcbiAgICBjdXJyZW50Kys7XG4gICAgaWYgKGN1cnJlbnQgPT09IHRhc2tzLmxlbmd0aCkge1xuICAgICAgY2FsbGJhY2tzLm9uQ29tcGxldGUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGFza3NbY3VycmVudF0ucnVuKGNhbGxiYWNrcywgcnVuTmV4dEFzeW5jKTtcbiAgfVxufVxuXG5jbGFzcyBUZXN0UlRDIHtcblxuICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSwgZmlsdGVyID0gW10pIHtcbiAgICB0aGlzLlNVSVRFUyA9IENvbmZpZy5TVUlURVM7XG4gICAgdGhpcy5URVNUUyA9IENvbmZpZy5URVNUUztcbiAgICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgICB0aGlzLmNhbGxiYWNrcyA9IHtcbiAgICAgIG9uVGVzdFByb2dyZXNzOiAoKSA9PiB7fSxcbiAgICAgIG9uVGVzdFJlc3VsdDogKCkgPT4ge30sXG4gICAgICBvblRlc3RSZXBvcnQ6ICgpID0+IHt9LFxuICAgICAgb25Db21wbGV0ZTogKCkgPT4ge30sXG4gICAgfTtcblxuICAgIHRoaXMuc3VpdGVzID0gW107XG5cbiAgICBpZiAoIWZpbHRlci5pbmNsdWRlcyh0aGlzLlNVSVRFUy5NSUNST1BIT05FKSkge1xuICAgICAgY29uc3QgbWljU3VpdGUgPSBDb25maWcuYnVpbGRNaWNyb1N1aXRlKHRoaXMuY29uZmlnLCBmaWx0ZXIpO1xuICAgICAgdGhpcy5zdWl0ZXMucHVzaChtaWNTdWl0ZSk7XG4gICAgfVxuXG4gICAgaWYgKCFmaWx0ZXIuaW5jbHVkZXModGhpcy5TVUlURVMuQ0FNRVJBKSkge1xuICAgICAgY29uc3QgY2FtZXJhU3VpdGUgPSBDb25maWcuYnVpbGRDYW1lcmFTdWl0ZSh0aGlzLmNvbmZpZywgZmlsdGVyKTtcbiAgICAgIHRoaXMuc3VpdGVzLnB1c2goY2FtZXJhU3VpdGUpO1xuICAgIH1cblxuICAgIGlmICghZmlsdGVyLmluY2x1ZGVzKHRoaXMuU1VJVEVTLk5FVFdPUkspKSB7XG4gICAgICBjb25zdCBuZXR3b3JrU3VpdGUgPSBDb25maWcuYnVpbGROZXR3b3JrU3VpdGUodGhpcy5jb25maWcsIGZpbHRlcik7XG4gICAgICB0aGlzLnN1aXRlcy5wdXNoKG5ldHdvcmtTdWl0ZSk7XG4gICAgfVxuXG4gICAgaWYgKCFmaWx0ZXIuaW5jbHVkZXModGhpcy5TVUlURVMuQ09OTkVDVElWSVRZKSkge1xuICAgICAgY29uc3QgY29ubmVjdGl2aXR5U3VpdGUgPSBDb25maWcuYnVpbGRDb25uZWN0aXZpdHlTdWl0ZSh0aGlzLmNvbmZpZywgZmlsdGVyKTtcbiAgICAgIHRoaXMuc3VpdGVzLnB1c2goY29ubmVjdGl2aXR5U3VpdGUpO1xuICAgIH1cblxuICAgIGlmICghZmlsdGVyLmluY2x1ZGVzKHRoaXMuU1VJVEVTLlRIUk9VR0hQVVQpKSB7XG4gICAgICBjb25zdCB0aHJvdWdocHV0U3VpdGUgPSBDb25maWcuYnVpbGRUaHJvdWdocHV0U3VpdGUodGhpcy5jb25maWcsIGZpbHRlcik7XG4gICAgICB0aGlzLnN1aXRlcy5wdXNoKHRocm91Z2hwdXRTdWl0ZSk7XG4gICAgfVxuICB9XG5cbiAgZ2V0U3VpdGVzKCkge1xuICAgIHJldHVybiB0aGlzLnN1aXRlcztcbiAgfVxuXG4gIGdldFRlc3RzKCkge1xuICAgIHJldHVybiB0aGlzLnN1aXRlcy5yZWR1Y2UoKGFsbCwgc3VpdGUpID0+IGFsbC5jb25jYXQoc3VpdGUuZ2V0VGVzdHMoKSksIFtdKTtcbiAgfVxuXG4gIG9uVGVzdFByb2dyZXNzKGNhbGxiYWNrID0gKCkgPT4ge30pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RQcm9ncmVzcyA9IGNhbGxiYWNrO1xuICB9XG5cbiAgb25UZXN0UmVzdWx0KGNhbGxiYWNrID0gKCkgPT4ge30pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXN1bHQgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uVGVzdFJlcG9ydChjYWxsYmFjayA9ICgpID0+IHt9KSB7XG4gICAgdGhpcy5jYWxsYmFja3Mub25UZXN0UmVwb3J0ID0gY2FsbGJhY2s7XG4gIH1cblxuICBvbkNvbXBsZXRlKGNhbGxiYWNrID0gKCkgPT4ge30pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vbkNvbXBsZXRlID0gY2FsbGJhY2s7XG4gIH1cblxuICBzdGFydCgpIHtcbiAgICBjb25zdCBhbGxUZXN0cyA9IHRoaXMuZ2V0VGVzdHMoKTtcbiAgICBydW5BbGxTZXF1ZW50aWFsbHkoYWxsVGVzdHMsIHRoaXMuY2FsbGJhY2tzKTtcbiAgfVxuXG4gIHN0b3AoKSB7XG5cbiAgfVxuXG59XG5cblRlc3RSVEMuU1VJVEVTID0gQ29uZmlnLlNVSVRFUztcblRlc3RSVEMuVEVTVFMgPSBDb25maWcuVEVTVFM7XG53aW5kb3cuVGVzdFJUQyA9IFRlc3RSVEM7XG5leHBvcnQgZGVmYXVsdCBUZXN0UlRDO1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IFZpZGVvRnJhbWVDaGVja2VyIGZyb20gJy4uL3V0aWwvVmlkZW9GcmFtZUNoZWNrZXIuanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi4vdXRpbC9yZXBvcnQuanMnO1xuaW1wb3J0IHsgYXJyYXlBdmVyYWdlLCBhcnJheU1pbiwgYXJyYXlNYXggfSBmcm9tICcuLi91dGlsL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG4vKlxuICogSW4gZ2VuZXJpYyBjYW1lcmFzIHVzaW5nIENocm9tZSByZXNjYWxlciwgYWxsIHJlc29sdXRpb25zIHNob3VsZCBiZSBzdXBwb3J0ZWRcbiAqIHVwIHRvIGEgZ2l2ZW4gb25lIGFuZCBub25lIGJleW9uZCB0aGVyZS4gU3BlY2lhbCBjYW1lcmFzLCBzdWNoIGFzIGRpZ2l0aXplcnMsXG4gKiBtaWdodCBzdXBwb3J0IG9ubHkgb25lIHJlc29sdXRpb24uXG4gKi9cblxuLypcbiAqIFwiQW5hbHl6ZSBwZXJmb3JtYW5jZSBmb3IgXCJyZXNvbHV0aW9uXCJcIiB0ZXN0IHVzZXMgZ2V0U3RhdHMsIGNhbnZhcyBhbmQgdGhlXG4gKiB2aWRlbyBlbGVtZW50IHRvIGFuYWx5emUgdGhlIHZpZGVvIGZyYW1lcyBmcm9tIGEgY2FwdHVyZSBkZXZpY2UuIEl0IHdpbGxcbiAqIHJlcG9ydCBudW1iZXIgb2YgYmxhY2sgZnJhbWVzLCBmcm96ZW4gZnJhbWVzLCB0ZXN0ZWQgZnJhbWVzIGFuZCB2YXJpb3VzIHN0YXRzXG4gKiBsaWtlIGF2ZXJhZ2UgZW5jb2RlIHRpbWUgYW5kIEZQUy4gQSB0ZXN0IGNhc2Ugd2lsbCBiZSBjcmVhdGVkIHBlciBtYW5kYXRvcnlcbiAqIHJlc29sdXRpb24gZm91bmQgaW4gdGhlIFwicmVzb2x1dGlvbnNcIiBhcnJheS5cbiAqL1xuXG5mdW5jdGlvbiBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgcmVzb2x1dGlvbnMpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5yZXNvbHV0aW9ucyA9IHJlc29sdXRpb25zO1xuICB0aGlzLmN1cnJlbnRSZXNvbHV0aW9uID0gMDtcbiAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gIHRoaXMuaXNTaHV0dGluZ0Rvd24gPSBmYWxzZTtcbn1cblxuQ2FtUmVzb2x1dGlvbnNUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbl0pO1xuICB9LFxuXG4gIHN0YXJ0R2V0VXNlck1lZGlhOiBmdW5jdGlvbihyZXNvbHV0aW9uKSB7XG4gICAgdmFyIGNvbnN0cmFpbnRzID0ge1xuICAgICAgYXVkaW86IGZhbHNlLFxuICAgICAgdmlkZW86IHtcbiAgICAgICAgd2lkdGg6IHtleGFjdDogcmVzb2x1dGlvblswXX0sXG4gICAgICAgIGhlaWdodDoge2V4YWN0OiByZXNvbHV0aW9uWzFdfVxuICAgICAgfVxuICAgIH07XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIC8vIERvIG5vdCBjaGVjayBhY3R1YWwgdmlkZW8gZnJhbWVzIHdoZW4gbW9yZSB0aGFuIG9uZSByZXNvbHV0aW9uIGlzXG4gICAgICAgICAgLy8gcHJvdmlkZWQuXG4gICAgICAgICAgaWYgKHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1N1cHBvcnRlZDogJyArIHJlc29sdXRpb25bMF0gKyAneCcgK1xuICAgICAgICAgICAgcmVzb2x1dGlvblsxXSk7XG4gICAgICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB0cmFjay5zdG9wKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMubWF5YmVDb250aW51ZUdldFVzZXJNZWRpYSgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNvbGxlY3RBbmRBbmFseXplU3RhdHNfKHN0cmVhbSwgcmVzb2x1dGlvbik7XG4gICAgICAgICAgfVxuICAgICAgICB9LmJpbmQodGhpcykpXG4gICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIGlmICh0aGlzLnJlc29sdXRpb25zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKHJlc29sdXRpb25bMF0gKyAneCcgKyByZXNvbHV0aW9uWzFdICtcbiAgICAgICAgICAgICcgbm90IHN1cHBvcnRlZCcpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZGlyKGNvbnN0cmFpbnRzKTtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignZ2V0VXNlck1lZGlhIGZhaWxlZCB3aXRoIGVycm9yOiAnICtcbiAgICAgICAgICAgICAgICBlcnJvci5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICAgIH0uYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgbWF5YmVDb250aW51ZUdldFVzZXJNZWRpYTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY3VycmVudFJlc29sdXRpb24gPT09IHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbisrXSk7XG4gIH0sXG5cbiAgY29sbGVjdEFuZEFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHN0cmVhbSwgcmVzb2x1dGlvbikge1xuICAgIHZhciB0cmFja3MgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKTtcbiAgICBpZiAodHJhY2tzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm8gdmlkZW8gdHJhY2sgaW4gcmV0dXJuZWQgc3RyZWFtLicpO1xuICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmlyZWZveCBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50IGhhbmRsZXJzIG9uIG1lZGlhU3RyZWFtVHJhY2sgeWV0LlxuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9NZWRpYVN0cmVhbVRyYWNrXG4gICAgLy8gVE9ETzogcmVtb3ZlIGlmICguLi4pIHdoZW4gZXZlbnQgaGFuZGxlcnMgYXJlIHN1cHBvcnRlZCBieSBGaXJlZm94LlxuICAgIHZhciB2aWRlb1RyYWNrID0gdHJhY2tzWzBdO1xuICAgIGlmICh0eXBlb2YgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBSZWdpc3RlciBldmVudHMuXG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ2VuZGVkJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1ZpZGVvIHRyYWNrIGVuZGVkLCBjYW1lcmEgc3RvcHBlZCB3b3JraW5nJyk7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCdtdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIG11dGVkLicpO1xuICAgICAgICAvLyBNZWRpYVN0cmVhbVRyYWNrLm11dGVkIHByb3BlcnR5IGlzIG5vdCB3aXJlZCB1cCBpbiBDaHJvbWUgeWV0LFxuICAgICAgICAvLyBjaGVja2luZyBpc011dGVkIGxvY2FsIHN0YXRlLlxuICAgICAgICB0aGlzLmlzTXV0ZWQgPSB0cnVlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcigndW5tdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIHVubXV0ZWQuJyk7XG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IGZhbHNlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICB9XG5cbiAgICB2YXIgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2aWRlbycpO1xuICAgIHZpZGVvLnNldEF0dHJpYnV0ZSgnYXV0b3BsYXknLCAnJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdtdXRlZCcsICcnKTtcbiAgICB2aWRlby53aWR0aCA9IHJlc29sdXRpb25bMF07XG4gICAgdmlkZW8uaGVpZ2h0ID0gcmVzb2x1dGlvblsxXTtcbiAgICB2aWRlby5zcmNPYmplY3QgPSBzdHJlYW07XG4gICAgdmFyIGZyYW1lQ2hlY2tlciA9IG5ldyBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlbyk7XG4gICAgdmFyIGNhbGwgPSBuZXcgQ2FsbChudWxsLCB0aGlzLnRlc3QpO1xuICAgIGNhbGwucGMxLmFkZFN0cmVhbShzdHJlYW0pO1xuICAgIGNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIGNhbGwuZ2F0aGVyU3RhdHMoY2FsbC5wYzEsIG51bGwsIHN0cmVhbSxcbiAgICAgICAgdGhpcy5vbkNhbGxFbmRlZF8uYmluZCh0aGlzLCByZXNvbHV0aW9uLCB2aWRlbyxcbiAgICAgICAgICAgIHN0cmVhbSwgZnJhbWVDaGVja2VyKSxcbiAgICAgICAgMTAwKTtcblxuICAgIHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKHRoaXMuZW5kQ2FsbF8uYmluZCh0aGlzLCBjYWxsLCBzdHJlYW0pLCA4MDAwKTtcbiAgfSxcblxuICBvbkNhbGxFbmRlZF86IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLCBmcmFtZUNoZWNrZXIsXG4gICAgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHRoaXMuYW5hbHl6ZVN0YXRzXyhyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSwgZnJhbWVDaGVja2VyLFxuICAgICAgICBzdGF0cywgc3RhdHNUaW1lKTtcblxuICAgIGZyYW1lQ2hlY2tlci5zdG9wKCk7XG5cbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9LFxuXG4gIGFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLFxuICAgIGZyYW1lQ2hlY2tlciwgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHZhciBnb29nQXZnRW5jb2RlVGltZSA9IFtdO1xuICAgIHZhciBnb29nQXZnRnJhbWVSYXRlSW5wdXQgPSBbXTtcbiAgICB2YXIgZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQgPSBbXTtcbiAgICB2YXIgc3RhdHNSZXBvcnQgPSB7fTtcbiAgICB2YXIgZnJhbWVTdGF0cyA9IGZyYW1lQ2hlY2tlci5mcmFtZVN0YXRzO1xuXG4gICAgZm9yICh2YXIgaW5kZXggaW4gc3RhdHMpIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB0byBvbmx5IGNhcHR1cmUgc3RhdHMgYWZ0ZXIgdGhlIGVuY29kZXIgaXMgc2V0dXAuXG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICBnb29nQXZnRW5jb2RlVGltZS5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0F2Z0VuY29kZU1zKSk7XG4gICAgICAgICAgZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0LnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpKTtcbiAgICAgICAgICBnb29nQXZnRnJhbWVSYXRlU2VudC5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZVNlbnQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRzUmVwb3J0LmNhbWVyYU5hbWUgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXS5sYWJlbCB8fCBOYU47XG4gICAgc3RhdHNSZXBvcnQuYWN0dWFsVmlkZW9XaWR0aCA9IHZpZGVvRWxlbWVudC52aWRlb1dpZHRoO1xuICAgIHN0YXRzUmVwb3J0LmFjdHVhbFZpZGVvSGVpZ2h0ID0gdmlkZW9FbGVtZW50LnZpZGVvSGVpZ2h0O1xuICAgIHN0YXRzUmVwb3J0Lm1hbmRhdG9yeVdpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICBzdGF0c1JlcG9ydC5tYW5kYXRvcnlIZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHN0YXRzUmVwb3J0LmVuY29kZVNldHVwVGltZU1zID1cbiAgICAgICAgdGhpcy5leHRyYWN0RW5jb2RlclNldHVwVGltZV8oc3RhdHMsIHN0YXRzVGltZSk7XG4gICAgc3RhdHNSZXBvcnQuYXZnRW5jb2RlVGltZU1zID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5taW5FbmNvZGVUaW1lTXMgPSBhcnJheU1pbihnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQubWF4RW5jb2RlVGltZU1zID0gYXJyYXlNYXgoZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z0lucHV0RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQubWluSW5wdXRGcHMgPSBhcnJheU1pbihnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heElucHV0RnBzID0gYXJyYXlNYXgoZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5hdmdTZW50RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5taW5TZW50RnBzID0gYXJyYXlNaW4oZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heFNlbnRGcHMgPSBhcnJheU1heChnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQuaXNNdXRlZCA9IHRoaXMuaXNNdXRlZDtcbiAgICBzdGF0c1JlcG9ydC50ZXN0ZWRGcmFtZXMgPSBmcmFtZVN0YXRzLm51bUZyYW1lcztcbiAgICBzdGF0c1JlcG9ydC5ibGFja0ZyYW1lcyA9IGZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXM7XG4gICAgc3RhdHNSZXBvcnQuZnJvemVuRnJhbWVzID0gZnJhbWVTdGF0cy5udW1Gcm96ZW5GcmFtZXM7XG5cbiAgICAvLyBUT0RPOiBBZGQgYSByZXBvcnRJbmZvKCkgZnVuY3Rpb24gd2l0aCBhIHRhYmxlIGZvcm1hdCB0byBkaXNwbGF5XG4gICAgLy8gdmFsdWVzIGNsZWFyZXIuXG4gICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCd2aWRlby1zdGF0cycsIHN0YXRzUmVwb3J0KTtcblxuICAgIHRoaXMudGVzdEV4cGVjdGF0aW9uc18oc3RhdHNSZXBvcnQpO1xuICB9LFxuXG4gIGVuZENhbGxfOiBmdW5jdGlvbihjYWxsT2JqZWN0LCBzdHJlYW0pIHtcbiAgICB0aGlzLmlzU2h1dHRpbmdEb3duID0gdHJ1ZTtcbiAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdHJhY2suc3RvcCgpO1xuICAgIH0pO1xuICAgIGNhbGxPYmplY3QuY2xvc2UoKTtcbiAgfSxcblxuICBleHRyYWN0RW5jb2RlclNldHVwVGltZV86IGZ1bmN0aW9uKHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICBmb3IgKHZhciBpbmRleCA9IDA7IGluZGV4ICE9PSBzdGF0cy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoc3RhdHNUaW1lW2luZGV4XSAtIHN0YXRzVGltZVswXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIE5hTjtcbiAgfSxcblxuICByZXNvbHV0aW9uTWF0Y2hlc0luZGVwZW5kZW50T2ZSb3RhdGlvbk9yQ3JvcF86IGZ1bmN0aW9uKGFXaWR0aCwgYUhlaWdodCxcbiAgICBiV2lkdGgsIGJIZWlnaHQpIHtcbiAgICB2YXIgbWluUmVzID0gTWF0aC5taW4oYldpZHRoLCBiSGVpZ2h0KTtcbiAgICByZXR1cm4gKGFXaWR0aCA9PT0gYldpZHRoICYmIGFIZWlnaHQgPT09IGJIZWlnaHQpIHx8XG4gICAgICAgICAgIChhV2lkdGggPT09IGJIZWlnaHQgJiYgYUhlaWdodCA9PT0gYldpZHRoKSB8fFxuICAgICAgICAgICAoYVdpZHRoID09PSBtaW5SZXMgJiYgYkhlaWdodCA9PT0gbWluUmVzKTtcbiAgfSxcblxuICB0ZXN0RXhwZWN0YXRpb25zXzogZnVuY3Rpb24oaW5mbykge1xuICAgIHZhciBub3RBdmFpbGFibGVTdGF0cyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBpbmZvKSB7XG4gICAgICBpZiAoaW5mby5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIGlmICh0eXBlb2YgaW5mb1trZXldID09PSAnbnVtYmVyJyAmJiBpc05hTihpbmZvW2tleV0pKSB7XG4gICAgICAgICAgbm90QXZhaWxhYmxlU3RhdHMucHVzaChrZXkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKGtleSArICc6ICcgKyBpbmZvW2tleV0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChub3RBdmFpbGFibGVTdGF0cy5sZW5ndGggIT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdOb3QgYXZhaWxhYmxlOiAnICsgbm90QXZhaWxhYmxlU3RhdHMuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKGlzTmFOKGluZm8uYXZnU2VudEZwcykpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdDYW5ub3QgdmVyaWZ5IHNlbnQgRlBTLicpO1xuICAgIH0gZWxzZSBpZiAoaW5mby5hdmdTZW50RnBzIDwgNSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdMb3cgYXZlcmFnZSBzZW50IEZQUzogJyArIGluZm8uYXZnU2VudEZwcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdBdmVyYWdlIEZQUyBhYm92ZSB0aHJlc2hvbGQnKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLnJlc29sdXRpb25NYXRjaGVzSW5kZXBlbmRlbnRPZlJvdGF0aW9uT3JDcm9wXyhcbiAgICAgICAgaW5mby5hY3R1YWxWaWRlb1dpZHRoLCBpbmZvLmFjdHVhbFZpZGVvSGVpZ2h0LCBpbmZvLm1hbmRhdG9yeVdpZHRoLFxuICAgICAgICBpbmZvLm1hbmRhdG9yeUhlaWdodCkpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignSW5jb3JyZWN0IGNhcHR1cmVkIHJlc29sdXRpb24uJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdDYXB0dXJlZCB2aWRlbyB1c2luZyBleHBlY3RlZCByZXNvbHV0aW9uLicpO1xuICAgIH1cbiAgICBpZiAoaW5mby50ZXN0ZWRGcmFtZXMgPT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGFuYWx5emUgYW55IHZpZGVvIGZyYW1lLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoaW5mby5ibGFja0ZyYW1lcyA+IGluZm8udGVzdGVkRnJhbWVzIC8gMykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBkZWxpdmVyaW5nIGxvdHMgb2YgYmxhY2sgZnJhbWVzLicpO1xuICAgICAgfVxuICAgICAgaWYgKGluZm8uZnJvemVuRnJhbWVzID4gaW5mby50ZXN0ZWRGcmFtZXMgLyAzKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGRlbGl2ZXJpbmcgbG90cyBvZiBmcm96ZW4gZnJhbWVzLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgQ2FtUmVzb2x1dGlvbnNUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IFZpZGVvRnJhbWVDaGVja2VyIGZyb20gJy4uL3V0aWwvVmlkZW9GcmFtZUNoZWNrZXIuanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi4vdXRpbC9yZXBvcnQuanMnO1xuaW1wb3J0IHsgYXJyYXlBdmVyYWdlLCBhcnJheU1pbiwgYXJyYXlNYXggfSBmcm9tICcuLi91dGlsL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG4vKlxuICogSW4gZ2VuZXJpYyBjYW1lcmFzIHVzaW5nIENocm9tZSByZXNjYWxlciwgYWxsIHJlc29sdXRpb25zIHNob3VsZCBiZSBzdXBwb3J0ZWRcbiAqIHVwIHRvIGEgZ2l2ZW4gb25lIGFuZCBub25lIGJleW9uZCB0aGVyZS4gU3BlY2lhbCBjYW1lcmFzLCBzdWNoIGFzIGRpZ2l0aXplcnMsXG4gKiBtaWdodCBzdXBwb3J0IG9ubHkgb25lIHJlc29sdXRpb24uXG4gKi9cblxuLypcbiAqIFwiQW5hbHl6ZSBwZXJmb3JtYW5jZSBmb3IgXCJyZXNvbHV0aW9uXCJcIiB0ZXN0IHVzZXMgZ2V0U3RhdHMsIGNhbnZhcyBhbmQgdGhlXG4gKiB2aWRlbyBlbGVtZW50IHRvIGFuYWx5emUgdGhlIHZpZGVvIGZyYW1lcyBmcm9tIGEgY2FwdHVyZSBkZXZpY2UuIEl0IHdpbGxcbiAqIHJlcG9ydCBudW1iZXIgb2YgYmxhY2sgZnJhbWVzLCBmcm96ZW4gZnJhbWVzLCB0ZXN0ZWQgZnJhbWVzIGFuZCB2YXJpb3VzIHN0YXRzXG4gKiBsaWtlIGF2ZXJhZ2UgZW5jb2RlIHRpbWUgYW5kIEZQUy4gQSB0ZXN0IGNhc2Ugd2lsbCBiZSBjcmVhdGVkIHBlciBtYW5kYXRvcnlcbiAqIHJlc29sdXRpb24gZm91bmQgaW4gdGhlIFwicmVzb2x1dGlvbnNcIiBhcnJheS5cbiAqL1xuXG5mdW5jdGlvbiBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgcmVzb2x1dGlvbnMpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5yZXNvbHV0aW9ucyA9IHJlc29sdXRpb25zO1xuICB0aGlzLmN1cnJlbnRSZXNvbHV0aW9uID0gMDtcbiAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gIHRoaXMuaXNTaHV0dGluZ0Rvd24gPSBmYWxzZTtcbn1cblxuQ2FtUmVzb2x1dGlvbnNUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbl0pO1xuICB9LFxuXG4gIHN0YXJ0R2V0VXNlck1lZGlhOiBmdW5jdGlvbihyZXNvbHV0aW9uKSB7XG4gICAgdmFyIGNvbnN0cmFpbnRzID0ge1xuICAgICAgYXVkaW86IGZhbHNlLFxuICAgICAgdmlkZW86IHtcbiAgICAgICAgd2lkdGg6IHtleGFjdDogcmVzb2x1dGlvblswXX0sXG4gICAgICAgIGhlaWdodDoge2V4YWN0OiByZXNvbHV0aW9uWzFdfVxuICAgICAgfVxuICAgIH07XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgIC8vIERvIG5vdCBjaGVjayBhY3R1YWwgdmlkZW8gZnJhbWVzIHdoZW4gbW9yZSB0aGFuIG9uZSByZXNvbHV0aW9uIGlzXG4gICAgICAgICAgLy8gcHJvdmlkZWQuXG4gICAgICAgICAgaWYgKHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1N1cHBvcnRlZDogJyArIHJlc29sdXRpb25bMF0gKyAneCcgK1xuICAgICAgICAgICAgcmVzb2x1dGlvblsxXSk7XG4gICAgICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgICAgICB0cmFjay5zdG9wKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHRoaXMubWF5YmVDb250aW51ZUdldFVzZXJNZWRpYSgpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmNvbGxlY3RBbmRBbmFseXplU3RhdHNfKHN0cmVhbSwgcmVzb2x1dGlvbik7XG4gICAgICAgICAgfVxuICAgICAgICB9LmJpbmQodGhpcykpXG4gICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgIGlmICh0aGlzLnJlc29sdXRpb25zLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKHJlc29sdXRpb25bMF0gKyAneCcgKyByZXNvbHV0aW9uWzFdICtcbiAgICAgICAgICAgICcgbm90IHN1cHBvcnRlZCcpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgICAgIGNvbnNvbGUuZGlyKGNvbnN0cmFpbnRzKTtcbiAgICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignZ2V0VXNlck1lZGlhIGZhaWxlZCB3aXRoIGVycm9yOiAnICtcbiAgICAgICAgICAgICAgICBlcnJvci5uYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICAgIH0uYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgbWF5YmVDb250aW51ZUdldFVzZXJNZWRpYTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY3VycmVudFJlc29sdXRpb24gPT09IHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoKSB7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN0YXJ0R2V0VXNlck1lZGlhKHRoaXMucmVzb2x1dGlvbnNbdGhpcy5jdXJyZW50UmVzb2x1dGlvbisrXSk7XG4gIH0sXG5cbiAgY29sbGVjdEFuZEFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHN0cmVhbSwgcmVzb2x1dGlvbikge1xuICAgIHZhciB0cmFja3MgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKTtcbiAgICBpZiAodHJhY2tzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm8gdmlkZW8gdHJhY2sgaW4gcmV0dXJuZWQgc3RyZWFtLicpO1xuICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmlyZWZveCBkb2VzIG5vdCBzdXBwb3J0IGV2ZW50IGhhbmRsZXJzIG9uIG1lZGlhU3RyZWFtVHJhY2sgeWV0LlxuICAgIC8vIGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0FQSS9NZWRpYVN0cmVhbVRyYWNrXG4gICAgLy8gVE9ETzogcmVtb3ZlIGlmICguLi4pIHdoZW4gZXZlbnQgaGFuZGxlcnMgYXJlIHN1cHBvcnRlZCBieSBGaXJlZm94LlxuICAgIHZhciB2aWRlb1RyYWNrID0gdHJhY2tzWzBdO1xuICAgIGlmICh0eXBlb2YgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAvLyBSZWdpc3RlciBldmVudHMuXG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ2VuZGVkJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1ZpZGVvIHRyYWNrIGVuZGVkLCBjYW1lcmEgc3RvcHBlZCB3b3JraW5nJyk7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCdtdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIG11dGVkLicpO1xuICAgICAgICAvLyBNZWRpYVN0cmVhbVRyYWNrLm11dGVkIHByb3BlcnR5IGlzIG5vdCB3aXJlZCB1cCBpbiBDaHJvbWUgeWV0LFxuICAgICAgICAvLyBjaGVja2luZyBpc011dGVkIGxvY2FsIHN0YXRlLlxuICAgICAgICB0aGlzLmlzTXV0ZWQgPSB0cnVlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcigndW5tdXRlJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIElnbm9yZSBldmVudHMgd2hlbiBzaHV0dGluZyBkb3duIHRoZSB0ZXN0LlxuICAgICAgICBpZiAodGhpcy5pc1NodXR0aW5nRG93bikge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnWW91ciBjYW1lcmEgcmVwb3J0ZWQgaXRzZWxmIGFzIHVubXV0ZWQuJyk7XG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IGZhbHNlO1xuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICB9XG5cbiAgICB2YXIgdmlkZW8gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd2aWRlbycpO1xuICAgIHZpZGVvLnNldEF0dHJpYnV0ZSgnYXV0b3BsYXknLCAnJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdtdXRlZCcsICcnKTtcbiAgICB2aWRlby53aWR0aCA9IHJlc29sdXRpb25bMF07XG4gICAgdmlkZW8uaGVpZ2h0ID0gcmVzb2x1dGlvblsxXTtcbiAgICB2aWRlby5zcmNPYmplY3QgPSBzdHJlYW07XG4gICAgdmFyIGZyYW1lQ2hlY2tlciA9IG5ldyBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlbyk7XG4gICAgdmFyIGNhbGwgPSBuZXcgQ2FsbChudWxsLCB0aGlzLnRlc3QpO1xuICAgIGNhbGwucGMxLmFkZFN0cmVhbShzdHJlYW0pO1xuICAgIGNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIGNhbGwuZ2F0aGVyU3RhdHMoY2FsbC5wYzEsIG51bGwsIHN0cmVhbSxcbiAgICAgICAgdGhpcy5vbkNhbGxFbmRlZF8uYmluZCh0aGlzLCByZXNvbHV0aW9uLCB2aWRlbyxcbiAgICAgICAgICAgIHN0cmVhbSwgZnJhbWVDaGVja2VyKSxcbiAgICAgICAgMTAwKTtcblxuICAgIHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKHRoaXMuZW5kQ2FsbF8uYmluZCh0aGlzLCBjYWxsLCBzdHJlYW0pLCA4MDAwKTtcbiAgfSxcblxuICBvbkNhbGxFbmRlZF86IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLCBmcmFtZUNoZWNrZXIsXG4gICAgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHRoaXMuYW5hbHl6ZVN0YXRzXyhyZXNvbHV0aW9uLCB2aWRlb0VsZW1lbnQsIHN0cmVhbSwgZnJhbWVDaGVja2VyLFxuICAgICAgICBzdGF0cywgc3RhdHNUaW1lKTtcblxuICAgIGZyYW1lQ2hlY2tlci5zdG9wKCk7XG5cbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9LFxuXG4gIGFuYWx5emVTdGF0c186IGZ1bmN0aW9uKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLFxuICAgIGZyYW1lQ2hlY2tlciwgc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIHZhciBnb29nQXZnRW5jb2RlVGltZSA9IFtdO1xuICAgIHZhciBnb29nQXZnRnJhbWVSYXRlSW5wdXQgPSBbXTtcbiAgICB2YXIgZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQgPSBbXTtcbiAgICB2YXIgc3RhdHNSZXBvcnQgPSB7fTtcbiAgICB2YXIgZnJhbWVTdGF0cyA9IGZyYW1lQ2hlY2tlci5mcmFtZVN0YXRzO1xuXG4gICAgZm9yICh2YXIgaW5kZXggaW4gc3RhdHMpIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIC8vIE1ha2Ugc3VyZSB0byBvbmx5IGNhcHR1cmUgc3RhdHMgYWZ0ZXIgdGhlIGVuY29kZXIgaXMgc2V0dXAuXG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICBnb29nQXZnRW5jb2RlVGltZS5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0F2Z0VuY29kZU1zKSk7XG4gICAgICAgICAgZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0LnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpKTtcbiAgICAgICAgICBnb29nQXZnRnJhbWVSYXRlU2VudC5wdXNoKFxuICAgICAgICAgICAgICBwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZVNlbnQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHN0YXRzUmVwb3J0LmNhbWVyYU5hbWUgPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXS5sYWJlbCB8fCBOYU47XG4gICAgc3RhdHNSZXBvcnQuYWN0dWFsVmlkZW9XaWR0aCA9IHZpZGVvRWxlbWVudC52aWRlb1dpZHRoO1xuICAgIHN0YXRzUmVwb3J0LmFjdHVhbFZpZGVvSGVpZ2h0ID0gdmlkZW9FbGVtZW50LnZpZGVvSGVpZ2h0O1xuICAgIHN0YXRzUmVwb3J0Lm1hbmRhdG9yeVdpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICBzdGF0c1JlcG9ydC5tYW5kYXRvcnlIZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHN0YXRzUmVwb3J0LmVuY29kZVNldHVwVGltZU1zID1cbiAgICAgICAgdGhpcy5leHRyYWN0RW5jb2RlclNldHVwVGltZV8oc3RhdHMsIHN0YXRzVGltZSk7XG4gICAgc3RhdHNSZXBvcnQuYXZnRW5jb2RlVGltZU1zID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5taW5FbmNvZGVUaW1lTXMgPSBhcnJheU1pbihnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQubWF4RW5jb2RlVGltZU1zID0gYXJyYXlNYXgoZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z0lucHV0RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQubWluSW5wdXRGcHMgPSBhcnJheU1pbihnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heElucHV0RnBzID0gYXJyYXlNYXgoZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5hdmdTZW50RnBzID0gYXJyYXlBdmVyYWdlKGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5taW5TZW50RnBzID0gYXJyYXlNaW4oZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0Lm1heFNlbnRGcHMgPSBhcnJheU1heChnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQuaXNNdXRlZCA9IHRoaXMuaXNNdXRlZDtcbiAgICBzdGF0c1JlcG9ydC50ZXN0ZWRGcmFtZXMgPSBmcmFtZVN0YXRzLm51bUZyYW1lcztcbiAgICBzdGF0c1JlcG9ydC5ibGFja0ZyYW1lcyA9IGZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXM7XG4gICAgc3RhdHNSZXBvcnQuZnJvemVuRnJhbWVzID0gZnJhbWVTdGF0cy5udW1Gcm96ZW5GcmFtZXM7XG5cbiAgICAvLyBUT0RPOiBBZGQgYSByZXBvcnRJbmZvKCkgZnVuY3Rpb24gd2l0aCBhIHRhYmxlIGZvcm1hdCB0byBkaXNwbGF5XG4gICAgLy8gdmFsdWVzIGNsZWFyZXIuXG4gICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCd2aWRlby1zdGF0cycsIHN0YXRzUmVwb3J0KTtcblxuICAgIHRoaXMudGVzdEV4cGVjdGF0aW9uc18oc3RhdHNSZXBvcnQpO1xuICB9LFxuXG4gIGVuZENhbGxfOiBmdW5jdGlvbihjYWxsT2JqZWN0LCBzdHJlYW0pIHtcbiAgICB0aGlzLmlzU2h1dHRpbmdEb3duID0gdHJ1ZTtcbiAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdHJhY2suc3RvcCgpO1xuICAgIH0pO1xuICAgIGNhbGxPYmplY3QuY2xvc2UoKTtcbiAgfSxcblxuICBleHRyYWN0RW5jb2RlclNldHVwVGltZV86IGZ1bmN0aW9uKHN0YXRzLCBzdGF0c1RpbWUpIHtcbiAgICBmb3IgKHZhciBpbmRleCA9IDA7IGluZGV4ICE9PSBzdGF0cy5sZW5ndGg7IGluZGV4KyspIHtcbiAgICAgIGlmIChzdGF0c1tpbmRleF0udHlwZSA9PT0gJ3NzcmMnKSB7XG4gICAgICAgIGlmIChwYXJzZUludChzdGF0c1tpbmRleF0uZ29vZ0ZyYW1lUmF0ZUlucHV0KSA+IDApIHtcbiAgICAgICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoc3RhdHNUaW1lW2luZGV4XSAtIHN0YXRzVGltZVswXSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIE5hTjtcbiAgfSxcblxuICByZXNvbHV0aW9uTWF0Y2hlc0luZGVwZW5kZW50T2ZSb3RhdGlvbk9yQ3JvcF86IGZ1bmN0aW9uKGFXaWR0aCwgYUhlaWdodCxcbiAgICBiV2lkdGgsIGJIZWlnaHQpIHtcbiAgICB2YXIgbWluUmVzID0gTWF0aC5taW4oYldpZHRoLCBiSGVpZ2h0KTtcbiAgICByZXR1cm4gKGFXaWR0aCA9PT0gYldpZHRoICYmIGFIZWlnaHQgPT09IGJIZWlnaHQpIHx8XG4gICAgICAgICAgIChhV2lkdGggPT09IGJIZWlnaHQgJiYgYUhlaWdodCA9PT0gYldpZHRoKSB8fFxuICAgICAgICAgICAoYVdpZHRoID09PSBtaW5SZXMgJiYgYkhlaWdodCA9PT0gbWluUmVzKTtcbiAgfSxcblxuICB0ZXN0RXhwZWN0YXRpb25zXzogZnVuY3Rpb24oaW5mbykge1xuICAgIHZhciBub3RBdmFpbGFibGVTdGF0cyA9IFtdO1xuICAgIGZvciAodmFyIGtleSBpbiBpbmZvKSB7XG4gICAgICBpZiAoaW5mby5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIGlmICh0eXBlb2YgaW5mb1trZXldID09PSAnbnVtYmVyJyAmJiBpc05hTihpbmZvW2tleV0pKSB7XG4gICAgICAgICAgbm90QXZhaWxhYmxlU3RhdHMucHVzaChrZXkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKGtleSArICc6ICcgKyBpbmZvW2tleV0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChub3RBdmFpbGFibGVTdGF0cy5sZW5ndGggIT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdOb3QgYXZhaWxhYmxlOiAnICsgbm90QXZhaWxhYmxlU3RhdHMuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKGlzTmFOKGluZm8uYXZnU2VudEZwcykpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdDYW5ub3QgdmVyaWZ5IHNlbnQgRlBTLicpO1xuICAgIH0gZWxzZSBpZiAoaW5mby5hdmdTZW50RnBzIDwgNSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdMb3cgYXZlcmFnZSBzZW50IEZQUzogJyArIGluZm8uYXZnU2VudEZwcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdBdmVyYWdlIEZQUyBhYm92ZSB0aHJlc2hvbGQnKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLnJlc29sdXRpb25NYXRjaGVzSW5kZXBlbmRlbnRPZlJvdGF0aW9uT3JDcm9wXyhcbiAgICAgICAgaW5mby5hY3R1YWxWaWRlb1dpZHRoLCBpbmZvLmFjdHVhbFZpZGVvSGVpZ2h0LCBpbmZvLm1hbmRhdG9yeVdpZHRoLFxuICAgICAgICBpbmZvLm1hbmRhdG9yeUhlaWdodCkpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignSW5jb3JyZWN0IGNhcHR1cmVkIHJlc29sdXRpb24uJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdDYXB0dXJlZCB2aWRlbyB1c2luZyBleHBlY3RlZCByZXNvbHV0aW9uLicpO1xuICAgIH1cbiAgICBpZiAoaW5mby50ZXN0ZWRGcmFtZXMgPT09IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGFuYWx5emUgYW55IHZpZGVvIGZyYW1lLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoaW5mby5ibGFja0ZyYW1lcyA+IGluZm8udGVzdGVkRnJhbWVzIC8gMykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBkZWxpdmVyaW5nIGxvdHMgb2YgYmxhY2sgZnJhbWVzLicpO1xuICAgICAgfVxuICAgICAgaWYgKGluZm8uZnJvemVuRnJhbWVzID4gaW5mby50ZXN0ZWRGcmFtZXMgLyAzKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGRlbGl2ZXJpbmcgbG90cyBvZiBmcm96ZW4gZnJhbWVzLicpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgQ2FtUmVzb2x1dGlvbnNUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcblxuZnVuY3Rpb24gUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBpY2VDYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIgPSBpY2VDYW5kaWRhdGVGaWx0ZXI7XG4gIHRoaXMudGltZW91dCA9IG51bGw7XG4gIHRoaXMucGFyc2VkQ2FuZGlkYXRlcyA9IFtdO1xuICB0aGlzLmNhbGwgPSBudWxsO1xufVxuXG5SdW5Db25uZWN0aXZpdHlUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksXG4gICAgICAgIHRoaXMudGVzdCk7XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMuY2FsbCA9IG5ldyBDYWxsKGNvbmZpZywgdGhpcy50ZXN0KTtcbiAgICB0aGlzLmNhbGwuc2V0SWNlQ2FuZGlkYXRlRmlsdGVyKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKTtcblxuICAgIC8vIENvbGxlY3QgYWxsIGNhbmRpZGF0ZXMgZm9yIHZhbGlkYXRpb24uXG4gICAgdGhpcy5jYWxsLnBjMS5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgaWYgKGV2ZW50LmNhbmRpZGF0ZSkge1xuICAgICAgICB2YXIgcGFyc2VkQ2FuZGlkYXRlID0gQ2FsbC5wYXJzZUNhbmRpZGF0ZShldmVudC5jYW5kaWRhdGUuY2FuZGlkYXRlKTtcbiAgICAgICAgdGhpcy5wYXJzZWRDYW5kaWRhdGVzLnB1c2gocGFyc2VkQ2FuZGlkYXRlKTtcblxuICAgICAgICAvLyBSZXBvcnQgY2FuZGlkYXRlIGluZm8gYmFzZWQgb24gaWNlQ2FuZGlkYXRlRmlsdGVyLlxuICAgICAgICBpZiAodGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIocGFyc2VkQ2FuZGlkYXRlKSkge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKFxuICAgICAgICAgICAgICAnR2F0aGVyZWQgY2FuZGlkYXRlIG9mIFR5cGU6ICcgKyBwYXJzZWRDYW5kaWRhdGUudHlwZSArXG4gICAgICAgICAgICAnIFByb3RvY29sOiAnICsgcGFyc2VkQ2FuZGlkYXRlLnByb3RvY29sICtcbiAgICAgICAgICAgICcgQWRkcmVzczogJyArIHBhcnNlZENhbmRpZGF0ZS5hZGRyZXNzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0uYmluZCh0aGlzKSk7XG5cbiAgICB2YXIgY2gxID0gdGhpcy5jYWxsLnBjMS5jcmVhdGVEYXRhQ2hhbm5lbChudWxsKTtcbiAgICBjaDEuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsIGZ1bmN0aW9uKCkge1xuICAgICAgY2gxLnNlbmQoJ2hlbGxvJyk7XG4gICAgfSk7XG4gICAgY2gxLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgaWYgKGV2ZW50LmRhdGEgIT09ICd3b3JsZCcpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdJbnZhbGlkIGRhdGEgdHJhbnNtaXR0ZWQuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnRGF0YSBzdWNjZXNzZnVsbHkgdHJhbnNtaXR0ZWQgYmV0d2VlbiBwZWVycy4nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuaGFuZ3VwKCk7XG4gICAgfS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLmNhbGwucGMyLmFkZEV2ZW50TGlzdGVuZXIoJ2RhdGFjaGFubmVsJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIHZhciBjaDIgPSBldmVudC5jaGFubmVsO1xuICAgICAgY2gyLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAoZXZlbnQuZGF0YSAhPT0gJ2hlbGxvJykge1xuICAgICAgICAgIHRoaXMuaGFuZ3VwKCdJbnZhbGlkIGRhdGEgdHJhbnNtaXR0ZWQuJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2gyLnNlbmQoJ3dvcmxkJyk7XG4gICAgICAgIH1cbiAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgfS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLmNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICAgIHRoaXMudGltZW91dCA9IHNldFRpbWVvdXQodGhpcy5oYW5ndXAuYmluZCh0aGlzLCAnVGltZWQgb3V0JyksIDUwMDApO1xuICB9LFxuXG4gIGZpbmRQYXJzZWRDYW5kaWRhdGVPZlNwZWNpZmllZFR5cGU6IGZ1bmN0aW9uKGNhbmRpZGF0ZVR5cGVNZXRob2QpIHtcbiAgICBmb3IgKHZhciBjYW5kaWRhdGUgaW4gdGhpcy5wYXJzZWRDYW5kaWRhdGVzKSB7XG4gICAgICBpZiAoY2FuZGlkYXRlVHlwZU1ldGhvZCh0aGlzLnBhcnNlZENhbmRpZGF0ZXNbY2FuZGlkYXRlXSkpIHtcbiAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZVR5cGVNZXRob2QodGhpcy5wYXJzZWRDYW5kaWRhdGVzW2NhbmRpZGF0ZV0pO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICBoYW5ndXA6IGZ1bmN0aW9uKGVycm9yTWVzc2FnZSkge1xuICAgIGlmIChlcnJvck1lc3NhZ2UpIHtcbiAgICAgIC8vIFJlcG9ydCB3YXJuaW5nIGZvciBzZXJ2ZXIgcmVmbGV4aXZlIHRlc3QgaWYgaXQgdGltZXMgb3V0LlxuICAgICAgaWYgKGVycm9yTWVzc2FnZSA9PT0gJ1RpbWVkIG91dCcgJiZcbiAgICAgICAgICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlci50b1N0cmluZygpID09PSBDYWxsLmlzUmVmbGV4aXZlLnRvU3RyaW5nKCkgJiZcbiAgICAgICAgICB0aGlzLmZpbmRQYXJzZWRDYW5kaWRhdGVPZlNwZWNpZmllZFR5cGUoQ2FsbC5pc1JlZmxleGl2ZSkpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0NvdWxkIG5vdCBjb25uZWN0IHVzaW5nIHJlZmxleGl2ZSAnICtcbiAgICAgICAgICAgICdjYW5kaWRhdGVzLCBsaWtlbHkgZHVlIHRvIHRoZSBuZXR3b3JrIGVudmlyb25tZW50L2NvbmZpZ3VyYXRpb24uJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoZXJyb3JNZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY2xlYXJUaW1lb3V0KHRoaXMudGltZW91dCk7XG4gICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgUnVuQ29ubmVjdGl2aXR5VGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBDYWxsIGZyb20gJy4uL3V0aWwvQ2FsbC5qcyc7XG5cbmZ1bmN0aW9uIERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QodGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMgPSA1LjA7XG4gIHRoaXMuc3RhcnRUaW1lID0gbnVsbDtcbiAgdGhpcy5zZW50UGF5bG9hZEJ5dGVzID0gMDtcbiAgdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyA9IDA7XG4gIHRoaXMuc3RvcFNlbmRpbmcgPSBmYWxzZTtcbiAgdGhpcy5zYW1wbGVQYWNrZXQgPSAnJztcblxuICBmb3IgKHZhciBpID0gMDsgaSAhPT0gMTAyNDsgKytpKSB7XG4gICAgdGhpcy5zYW1wbGVQYWNrZXQgKz0gJ2gnO1xuICB9XG5cbiAgdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQgPSAxO1xuICB0aGlzLmJ5dGVzVG9LZWVwQnVmZmVyZWQgPSAxMDI0ICogdGhpcy5tYXhOdW1iZXJPZlBhY2tldHNUb1NlbmQ7XG4gIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSA9IG51bGw7XG4gIHRoaXMubGFzdFJlY2VpdmVkUGF5bG9hZEJ5dGVzID0gMDtcblxuICB0aGlzLmNhbGwgPSBudWxsO1xuICB0aGlzLnNlbmRlckNoYW5uZWwgPSBudWxsO1xuICB0aGlzLnJlY2VpdmVDaGFubmVsID0gbnVsbDtcbn1cblxuRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpLCB0aGlzLnRlc3QpO1xuICB9LFxuXG4gIHN0YXJ0OiBmdW5jdGlvbihjb25maWcpIHtcbiAgICB0aGlzLmNhbGwgPSBuZXcgQ2FsbChjb25maWcsIHRoaXMudGVzdCk7XG4gICAgdGhpcy5jYWxsLnNldEljZUNhbmRpZGF0ZUZpbHRlcihDYWxsLmlzUmVsYXkpO1xuICAgIHRoaXMuc2VuZGVyQ2hhbm5lbCA9IHRoaXMuY2FsbC5wYzEuY3JlYXRlRGF0YUNoYW5uZWwobnVsbCk7XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCB0aGlzLnNlbmRpbmdTdGVwLmJpbmQodGhpcykpO1xuXG4gICAgdGhpcy5jYWxsLnBjMi5hZGRFdmVudExpc3RlbmVyKCdkYXRhY2hhbm5lbCcsXG4gICAgICAgIHRoaXMub25SZWNlaXZlckNoYW5uZWwuYmluZCh0aGlzKSk7XG5cbiAgICB0aGlzLmNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuICB9LFxuXG4gIG9uUmVjZWl2ZXJDaGFubmVsOiBmdW5jdGlvbihldmVudCkge1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwgPSBldmVudC5jaGFubmVsO1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsXG4gICAgICAgIHRoaXMub25NZXNzYWdlUmVjZWl2ZWQuYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgc2VuZGluZ1N0ZXA6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGlmICghdGhpcy5zdGFydFRpbWUpIHtcbiAgICAgIHRoaXMuc3RhcnRUaW1lID0gbm93O1xuICAgICAgdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID0gbm93O1xuICAgIH1cblxuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSB0aGlzLm1heE51bWJlck9mUGFja2V0c1RvU2VuZDsgKytpKSB7XG4gICAgICBpZiAodGhpcy5zZW5kZXJDaGFubmVsLmJ1ZmZlcmVkQW1vdW50ID49IHRoaXMuYnl0ZXNUb0tlZXBCdWZmZXJlZCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIHRoaXMuc2VudFBheWxvYWRCeXRlcyArPSB0aGlzLnNhbXBsZVBhY2tldC5sZW5ndGg7XG4gICAgICB0aGlzLnNlbmRlckNoYW5uZWwuc2VuZCh0aGlzLnNhbXBsZVBhY2tldCk7XG4gICAgfVxuXG4gICAgaWYgKG5vdyAtIHRoaXMuc3RhcnRUaW1lID49IDEwMDAgKiB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMpIHtcbiAgICAgIHRoaXMudGVzdC5zZXRQcm9ncmVzcygxMDApO1xuICAgICAgdGhpcy5zdG9wU2VuZGluZyA9IHRydWU7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5zZXRQcm9ncmVzcygobm93IC0gdGhpcy5zdGFydFRpbWUpIC9cbiAgICAgICAgICAoMTAgKiB0aGlzLnRlc3REdXJhdGlvblNlY29uZHMpKTtcbiAgICAgIHNldFRpbWVvdXQodGhpcy5zZW5kaW5nU3RlcC5iaW5kKHRoaXMpLCAxKTtcbiAgICB9XG4gIH0sXG5cbiAgb25NZXNzYWdlUmVjZWl2ZWQ6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyArPSBldmVudC5kYXRhLmxlbmd0aDtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICBpZiAobm93IC0gdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID49IDEwMDApIHtcbiAgICAgIHZhciBiaXRyYXRlID0gKHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXMgLVxuICAgICAgICAgIHRoaXMubGFzdFJlY2VpdmVkUGF5bG9hZEJ5dGVzKSAvIChub3cgLSB0aGlzLmxhc3RCaXRyYXRlTWVhc3VyZVRpbWUpO1xuICAgICAgYml0cmF0ZSA9IE1hdGgucm91bmQoYml0cmF0ZSAqIDEwMDAgKiA4KSAvIDEwMDA7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnVHJhbnNtaXR0aW5nIGF0ICcgKyBiaXRyYXRlICsgJyBrYnBzLicpO1xuICAgICAgdGhpcy5sYXN0UmVjZWl2ZWRQYXlsb2FkQnl0ZXMgPSB0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzO1xuICAgICAgdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID0gbm93O1xuICAgIH1cbiAgICBpZiAodGhpcy5zdG9wU2VuZGluZyAmJlxuICAgICAgICB0aGlzLnNlbnRQYXlsb2FkQnl0ZXMgPT09IHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXMpIHtcbiAgICAgIHRoaXMuY2FsbC5jbG9zZSgpO1xuICAgICAgdGhpcy5jYWxsID0gbnVsbDtcblxuICAgICAgdmFyIGVsYXBzZWRUaW1lID0gTWF0aC5yb3VuZCgobm93IC0gdGhpcy5zdGFydFRpbWUpICogMTApIC8gMTAwMDAuMDtcbiAgICAgIHZhciByZWNlaXZlZEtCaXRzID0gdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyAqIDggLyAxMDAwO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1RvdGFsIHRyYW5zbWl0dGVkOiAnICsgcmVjZWl2ZWRLQml0cyArXG4gICAgICAgICAgJyBraWxvLWJpdHMgaW4gJyArIGVsYXBzZWRUaW1lICsgJyBzZWNvbmRzLicpO1xuICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICB9XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5cbmZ1bmN0aW9uIE1pY1Rlc3QodGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLmlucHV0Q2hhbm5lbENvdW50ID0gNjtcbiAgdGhpcy5vdXRwdXRDaGFubmVsQ291bnQgPSAyO1xuICAvLyBCdWZmZXIgc2l6ZSBzZXQgdG8gMCB0byBsZXQgQ2hyb21lIGNob29zZSBiYXNlZCBvbiB0aGUgcGxhdGZvcm0uXG4gIHRoaXMuYnVmZmVyU2l6ZSA9IDA7XG4gIC8vIFR1cm5pbmcgb2ZmIGVjaG9DYW5jZWxsYXRpb24gY29uc3RyYWludCBlbmFibGVzIHN0ZXJlbyBpbnB1dC5cbiAgdGhpcy5jb25zdHJhaW50cyA9IHtcbiAgICBhdWRpbzoge1xuICAgICAgb3B0aW9uYWw6IFtcbiAgICAgICAge2VjaG9DYW5jZWxsYXRpb246IGZhbHNlfVxuICAgICAgXVxuICAgIH1cbiAgfTtcblxuICB0aGlzLmNvbGxlY3RTZWNvbmRzID0gMi4wO1xuICAvLyBBdCBsZWFzdCBvbmUgTFNCIDE2LWJpdCBkYXRhIChjb21wYXJlIGlzIG9uIGFic29sdXRlIHZhbHVlKS5cbiAgdGhpcy5zaWxlbnRUaHJlc2hvbGQgPSAxLjAgLyAzMjc2NztcbiAgdGhpcy5sb3dWb2x1bWVUaHJlc2hvbGQgPSAtNjA7XG4gIC8vIERhdGEgbXVzdCBiZSBpZGVudGljYWwgd2l0aGluIG9uZSBMU0IgMTYtYml0IHRvIGJlIGlkZW50aWZpZWQgYXMgbW9uby5cbiAgdGhpcy5tb25vRGV0ZWN0VGhyZXNob2xkID0gMS4wIC8gNjU1MzY7XG4gIC8vIE51bWJlciBvZiBjb25zZXF1dGl2ZSBjbGlwVGhyZXNob2xkIGxldmVsIHNhbXBsZXMgdGhhdCBpbmRpY2F0ZSBjbGlwcGluZy5cbiAgdGhpcy5jbGlwQ291bnRUaHJlc2hvbGQgPSA2O1xuICB0aGlzLmNsaXBUaHJlc2hvbGQgPSAxLjA7XG5cbiAgLy8gUG9wdWxhdGVkIHdpdGggYXVkaW8gYXMgYSAzLWRpbWVuc2lvbmFsIGFycmF5OlxuICAvLyAgIGNvbGxlY3RlZEF1ZGlvW2NoYW5uZWxzXVtidWZmZXJzXVtzYW1wbGVzXVxuICB0aGlzLmNvbGxlY3RlZEF1ZGlvID0gW107XG4gIHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgPSAwO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHRoaXMuaW5wdXRDaGFubmVsQ291bnQ7ICsraSkge1xuICAgIHRoaXMuY29sbGVjdGVkQXVkaW9baV0gPSBbXTtcbiAgfVxuICB0cnkge1xuICAgIHdpbmRvdy5BdWRpb0NvbnRleHQgPSB3aW5kb3cuQXVkaW9Db250ZXh0IHx8IHdpbmRvdy53ZWJraXRBdWRpb0NvbnRleHQ7XG4gICAgdGhpcy5hdWRpb0NvbnRleHQgPSBuZXcgQXVkaW9Db250ZXh0KCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKCdGYWlsZWQgdG8gaW5zdGFudGlhdGUgYW4gYXVkaW8gY29udGV4dCwgZXJyb3I6ICcgKyBlKTtcbiAgfVxufVxuXG5NaWNUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuYXVkaW9Db250ZXh0ID09PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdXZWJBdWRpbyBpcyBub3Qgc3VwcG9ydGVkLCB0ZXN0IGNhbm5vdCBydW4uJyk7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QuZG9HZXRVc2VyTWVkaWEodGhpcy5jb25zdHJhaW50cywgdGhpcy5nb3RTdHJlYW0uYmluZCh0aGlzKSk7XG4gICAgfVxuICB9LFxuXG4gIGdvdFN0cmVhbTogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgaWYgKCF0aGlzLmNoZWNrQXVkaW9UcmFja3Moc3RyZWFtKSkge1xuICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVBdWRpb0J1ZmZlcihzdHJlYW0pO1xuICB9LFxuXG4gIGNoZWNrQXVkaW9UcmFja3M6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIHRoaXMuc3RyZWFtID0gc3RyZWFtO1xuICAgIHZhciBhdWRpb1RyYWNrcyA9IHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpO1xuICAgIGlmIChhdWRpb1RyYWNrcy5sZW5ndGggPCAxKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ05vIGF1ZGlvIHRyYWNrIGluIHJldHVybmVkIHN0cmVhbS4nKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0F1ZGlvIHRyYWNrIGNyZWF0ZWQgdXNpbmcgZGV2aWNlPScgK1xuICAgICAgICBhdWRpb1RyYWNrc1swXS5sYWJlbCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgY3JlYXRlQXVkaW9CdWZmZXI6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYXVkaW9Tb3VyY2UgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVNZWRpYVN0cmVhbVNvdXJjZSh0aGlzLnN0cmVhbSk7XG4gICAgdGhpcy5zY3JpcHROb2RlID0gdGhpcy5hdWRpb0NvbnRleHQuY3JlYXRlU2NyaXB0UHJvY2Vzc29yKHRoaXMuYnVmZmVyU2l6ZSxcbiAgICAgICAgdGhpcy5pbnB1dENoYW5uZWxDb3VudCwgdGhpcy5vdXRwdXRDaGFubmVsQ291bnQpO1xuICAgIHRoaXMuYXVkaW9Tb3VyY2UuY29ubmVjdCh0aGlzLnNjcmlwdE5vZGUpO1xuICAgIHRoaXMuc2NyaXB0Tm9kZS5jb25uZWN0KHRoaXMuYXVkaW9Db250ZXh0LmRlc3RpbmF0aW9uKTtcbiAgICB0aGlzLnNjcmlwdE5vZGUub25hdWRpb3Byb2Nlc3MgPSB0aGlzLmNvbGxlY3RBdWRpby5iaW5kKHRoaXMpO1xuICAgIHRoaXMuc3RvcENvbGxlY3RpbmdBdWRpbyA9IHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKFxuICAgICAgICB0aGlzLm9uU3RvcENvbGxlY3RpbmdBdWRpby5iaW5kKHRoaXMpLCA1MDAwKTtcbiAgfSxcblxuICBjb2xsZWN0QXVkaW86IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgLy8gU2ltcGxlIHNpbGVuY2UgZGV0ZWN0aW9uOiBjaGVjayBmaXJzdCBhbmQgbGFzdCBzYW1wbGUgb2YgZWFjaCBjaGFubmVsIGluXG4gICAgLy8gdGhlIGJ1ZmZlci4gSWYgYm90aCBhcmUgYmVsb3cgYSB0aHJlc2hvbGQsIHRoZSBidWZmZXIgaXMgY29uc2lkZXJlZFxuICAgIC8vIHNpbGVudC5cbiAgICB2YXIgc2FtcGxlQ291bnQgPSBldmVudC5pbnB1dEJ1ZmZlci5sZW5ndGg7XG4gICAgdmFyIGFsbFNpbGVudCA9IHRydWU7XG4gICAgZm9yICh2YXIgYyA9IDA7IGMgPCBldmVudC5pbnB1dEJ1ZmZlci5udW1iZXJPZkNoYW5uZWxzOyBjKyspIHtcbiAgICAgIHZhciBkYXRhID0gZXZlbnQuaW5wdXRCdWZmZXIuZ2V0Q2hhbm5lbERhdGEoYyk7XG4gICAgICB2YXIgZmlyc3QgPSBNYXRoLmFicyhkYXRhWzBdKTtcbiAgICAgIHZhciBsYXN0ID0gTWF0aC5hYnMoZGF0YVtzYW1wbGVDb3VudCAtIDFdKTtcbiAgICAgIHZhciBuZXdCdWZmZXI7XG4gICAgICBpZiAoZmlyc3QgPiB0aGlzLnNpbGVudFRocmVzaG9sZCB8fCBsYXN0ID4gdGhpcy5zaWxlbnRUaHJlc2hvbGQpIHtcbiAgICAgICAgLy8gTm9uLXNpbGVudCBidWZmZXJzIGFyZSBjb3BpZWQgZm9yIGFuYWx5c2lzLiBOb3RlIHRoYXQgdGhlIHNpbGVudFxuICAgICAgICAvLyBkZXRlY3Rpb24gd2lsbCBsaWtlbHkgY2F1c2UgdGhlIHN0b3JlZCBzdHJlYW0gdG8gY29udGFpbiBkaXNjb250aW51LVxuICAgICAgICAvLyBpdGllcywgYnV0IHRoYXQgaXMgb2sgZm9yIG91ciBuZWVkcyBoZXJlIChqdXN0IGxvb2tpbmcgYXQgbGV2ZWxzKS5cbiAgICAgICAgbmV3QnVmZmVyID0gbmV3IEZsb2F0MzJBcnJheShzYW1wbGVDb3VudCk7XG4gICAgICAgIG5ld0J1ZmZlci5zZXQoZGF0YSk7XG4gICAgICAgIGFsbFNpbGVudCA9IGZhbHNlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gU2lsZW50IGJ1ZmZlcnMgYXJlIG5vdCBjb3BpZWQsIGJ1dCB3ZSBzdG9yZSBlbXB0eSBidWZmZXJzIHNvIHRoYXQgdGhlXG4gICAgICAgIC8vIGFuYWx5c2lzIGRvZXNuJ3QgaGF2ZSB0byBjYXJlLlxuICAgICAgICBuZXdCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KCk7XG4gICAgICB9XG4gICAgICB0aGlzLmNvbGxlY3RlZEF1ZGlvW2NdLnB1c2gobmV3QnVmZmVyKTtcbiAgICB9XG4gICAgaWYgKCFhbGxTaWxlbnQpIHtcbiAgICAgIHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgKz0gc2FtcGxlQ291bnQ7XG4gICAgICBpZiAoKHRoaXMuY29sbGVjdGVkU2FtcGxlQ291bnQgLyBldmVudC5pbnB1dEJ1ZmZlci5zYW1wbGVSYXRlKSA+PVxuICAgICAgICAgIHRoaXMuY29sbGVjdFNlY29uZHMpIHtcbiAgICAgICAgdGhpcy5zdG9wQ29sbGVjdGluZ0F1ZGlvKCk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIG9uU3RvcENvbGxlY3RpbmdBdWRpbzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5zdHJlYW0uZ2V0QXVkaW9UcmFja3MoKVswXS5zdG9wKCk7XG4gICAgdGhpcy5hdWRpb1NvdXJjZS5kaXNjb25uZWN0KHRoaXMuc2NyaXB0Tm9kZSk7XG4gICAgdGhpcy5zY3JpcHROb2RlLmRpc2Nvbm5lY3QodGhpcy5hdWRpb0NvbnRleHQuZGVzdGluYXRpb24pO1xuICAgIHRoaXMuYW5hbHl6ZUF1ZGlvKHRoaXMuY29sbGVjdGVkQXVkaW8pO1xuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH0sXG5cbiAgYW5hbHl6ZUF1ZGlvOiBmdW5jdGlvbihjaGFubmVscykge1xuICAgIHZhciBhY3RpdmVDaGFubmVscyA9IFtdO1xuICAgIGZvciAodmFyIGMgPSAwOyBjIDwgY2hhbm5lbHMubGVuZ3RoOyBjKyspIHtcbiAgICAgIGlmICh0aGlzLmNoYW5uZWxTdGF0cyhjLCBjaGFubmVsc1tjXSkpIHtcbiAgICAgICAgYWN0aXZlQ2hhbm5lbHMucHVzaChjKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGFjdGl2ZUNoYW5uZWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyBhY3RpdmUgaW5wdXQgY2hhbm5lbHMgZGV0ZWN0ZWQuIE1pY3JvcGhvbmUgJyArXG4gICAgICAgICAgJ2lzIG1vc3QgbGlrZWx5IG11dGVkIG9yIGJyb2tlbiwgcGxlYXNlIGNoZWNrIGlmIG11dGVkIGluIHRoZSAnICtcbiAgICAgICAgICAnc291bmQgc2V0dGluZ3Mgb3IgcGh5c2ljYWxseSBvbiB0aGUgZGV2aWNlLiBUaGVuIHJlcnVuIHRoZSB0ZXN0LicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQWN0aXZlIGF1ZGlvIGlucHV0IGNoYW5uZWxzOiAnICtcbiAgICAgICAgICBhY3RpdmVDaGFubmVscy5sZW5ndGgpO1xuICAgIH1cbiAgICBpZiAoYWN0aXZlQ2hhbm5lbHMubGVuZ3RoID09PSAyKSB7XG4gICAgICB0aGlzLmRldGVjdE1vbm8oY2hhbm5lbHNbYWN0aXZlQ2hhbm5lbHNbMF1dLCBjaGFubmVsc1thY3RpdmVDaGFubmVsc1sxXV0pO1xuICAgIH1cbiAgfSxcblxuICBjaGFubmVsU3RhdHM6IGZ1bmN0aW9uKGNoYW5uZWxOdW1iZXIsIGJ1ZmZlcnMpIHtcbiAgICB2YXIgbWF4UGVhayA9IDAuMDtcbiAgICB2YXIgbWF4Um1zID0gMC4wO1xuICAgIHZhciBjbGlwQ291bnQgPSAwO1xuICAgIHZhciBtYXhDbGlwQ291bnQgPSAwO1xuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYnVmZmVycy5sZW5ndGg7IGorKykge1xuICAgICAgdmFyIHNhbXBsZXMgPSBidWZmZXJzW2pdO1xuICAgICAgaWYgKHNhbXBsZXMubGVuZ3RoID4gMCkge1xuICAgICAgICB2YXIgcyA9IDA7XG4gICAgICAgIHZhciBybXMgPSAwLjA7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2FtcGxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHMgPSBNYXRoLmFicyhzYW1wbGVzW2ldKTtcbiAgICAgICAgICBtYXhQZWFrID0gTWF0aC5tYXgobWF4UGVhaywgcyk7XG4gICAgICAgICAgcm1zICs9IHMgKiBzO1xuICAgICAgICAgIGlmIChtYXhQZWFrID49IHRoaXMuY2xpcFRocmVzaG9sZCkge1xuICAgICAgICAgICAgY2xpcENvdW50Kys7XG4gICAgICAgICAgICBtYXhDbGlwQ291bnQgPSBNYXRoLm1heChtYXhDbGlwQ291bnQsIGNsaXBDb3VudCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNsaXBDb3VudCA9IDA7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFJNUyBpcyBjYWxjdWxhdGVkIG92ZXIgZWFjaCBidWZmZXIsIG1lYW5pbmcgdGhlIGludGVncmF0aW9uIHRpbWUgd2lsbFxuICAgICAgICAvLyBiZSBkaWZmZXJlbnQgZGVwZW5kaW5nIG9uIHNhbXBsZSByYXRlIGFuZCBidWZmZXIgc2l6ZS4gSW4gcHJhY3Rpc2VcbiAgICAgICAgLy8gdGhpcyBzaG91bGQgYmUgYSBzbWFsbCBwcm9ibGVtLlxuICAgICAgICBybXMgPSBNYXRoLnNxcnQocm1zIC8gc2FtcGxlcy5sZW5ndGgpO1xuICAgICAgICBtYXhSbXMgPSBNYXRoLm1heChtYXhSbXMsIHJtcyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG1heFBlYWsgPiB0aGlzLnNpbGVudFRocmVzaG9sZCkge1xuICAgICAgdmFyIGRCUGVhayA9IHRoaXMuZEJGUyhtYXhQZWFrKTtcbiAgICAgIHZhciBkQlJtcyA9IHRoaXMuZEJGUyhtYXhSbXMpO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0NoYW5uZWwgJyArIGNoYW5uZWxOdW1iZXIgKyAnIGxldmVsczogJyArXG4gICAgICAgICAgZEJQZWFrLnRvRml4ZWQoMSkgKyAnIGRCIChwZWFrKSwgJyArIGRCUm1zLnRvRml4ZWQoMSkgKyAnIGRCIChSTVMpJyk7XG4gICAgICBpZiAoZEJSbXMgPCB0aGlzLmxvd1ZvbHVtZVRocmVzaG9sZCkge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ01pY3JvcGhvbmUgaW5wdXQgbGV2ZWwgaXMgbG93LCBpbmNyZWFzZSBpbnB1dCAnICtcbiAgICAgICAgICAgICd2b2x1bWUgb3IgbW92ZSBjbG9zZXIgdG8gdGhlIG1pY3JvcGhvbmUuJyk7XG4gICAgICB9XG4gICAgICBpZiAobWF4Q2xpcENvdW50ID4gdGhpcy5jbGlwQ291bnRUaHJlc2hvbGQpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0NsaXBwaW5nIGRldGVjdGVkISBNaWNyb3Bob25lIGlucHV0IGxldmVsICcgK1xuICAgICAgICAgICAgJ2lzIGhpZ2guIERlY3JlYXNlIGlucHV0IHZvbHVtZSBvciBtb3ZlIGF3YXkgZnJvbSB0aGUgbWljcm9waG9uZS4nKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH0sXG5cbiAgZGV0ZWN0TW9ubzogZnVuY3Rpb24oYnVmZmVyc0wsIGJ1ZmZlcnNSKSB7XG4gICAgdmFyIGRpZmZTYW1wbGVzID0gMDtcbiAgICBmb3IgKHZhciBqID0gMDsgaiA8IGJ1ZmZlcnNMLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgbCA9IGJ1ZmZlcnNMW2pdO1xuICAgICAgdmFyIHIgPSBidWZmZXJzUltqXTtcbiAgICAgIGlmIChsLmxlbmd0aCA9PT0gci5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGQgPSAwLjA7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbC5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIGQgPSBNYXRoLmFicyhsW2ldIC0gcltpXSk7XG4gICAgICAgICAgaWYgKGQgPiB0aGlzLm1vbm9EZXRlY3RUaHJlc2hvbGQpIHtcbiAgICAgICAgICAgIGRpZmZTYW1wbGVzKys7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkaWZmU2FtcGxlcysrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoZGlmZlNhbXBsZXMgPiAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU3RlcmVvIG1pY3JvcGhvbmUgZGV0ZWN0ZWQuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdNb25vIG1pY3JvcGhvbmUgZGV0ZWN0ZWQuJyk7XG4gICAgfVxuICB9LFxuXG4gIGRCRlM6IGZ1bmN0aW9uKGdhaW4pIHtcbiAgICB2YXIgZEIgPSAyMCAqIE1hdGgubG9nKGdhaW4pIC8gTWF0aC5sb2coMTApO1xuICAgIC8vIFVzZSBNYXRoLnJvdW5kIHRvIGRpc3BsYXkgdXAgdG8gb25lIGRlY2ltYWwgcGxhY2UuXG4gICAgcmV0dXJuIE1hdGgucm91bmQoZEIgKiAxMCkgLyAxMDtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IE1pY1Rlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL0NhbGwuanMnO1xuXG52YXIgTmV0d29ya1Rlc3QgPSBmdW5jdGlvbih0ZXN0LCBwcm90b2NvbCwgcGFyYW1zLCBpY2VDYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5wcm90b2NvbCA9IHByb3RvY29sO1xuICB0aGlzLnBhcmFtcyA9IHBhcmFtcztcbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIgPSBpY2VDYW5kaWRhdGVGaWx0ZXI7XG59O1xuXG5OZXR3b3JrVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgLy8gRG8gbm90IGNyZWF0ZSB0dXJuIGNvbmZpZyBmb3IgSVBWNiB0ZXN0LlxuICAgIGlmICh0aGlzLmljZUNhbmRpZGF0ZUZpbHRlci50b1N0cmluZygpID09PSBDYWxsLmlzSXB2Ni50b1N0cmluZygpKSB7XG4gICAgICB0aGlzLmdhdGhlckNhbmRpZGF0ZXMobnVsbCwgdGhpcy5wYXJhbXMsIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksIHRoaXMudGVzdCk7XG4gICAgfVxuICB9LFxuXG4gIHN0YXJ0OiBmdW5jdGlvbihjb25maWcpIHtcbiAgICB0aGlzLmZpbHRlckNvbmZpZyhjb25maWcsIHRoaXMucHJvdG9jb2wpO1xuICAgIHRoaXMuZ2F0aGVyQ2FuZGlkYXRlcyhjb25maWcsIHRoaXMucGFyYW1zLCB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcik7XG4gIH0sXG5cbiAgLy8gRmlsdGVyIHRoZSBSVENDb25maWd1cmF0aW9uIHxjb25maWd8IHRvIG9ubHkgY29udGFpbiBVUkxzIHdpdGggdGhlXG4gIC8vIHNwZWNpZmllZCB0cmFuc3BvcnQgcHJvdG9jb2wgfHByb3RvY29sfC4gSWYgbm8gdHVybiB0cmFuc3BvcnQgaXNcbiAgLy8gc3BlY2lmaWVkIGl0IGlzIGFkZGVkIHdpdGggdGhlIHJlcXVlc3RlZCBwcm90b2NvbC5cbiAgZmlsdGVyQ29uZmlnOiBmdW5jdGlvbihjb25maWcsIHByb3RvY29sKSB7XG4gICAgdmFyIHRyYW5zcG9ydCA9ICd0cmFuc3BvcnQ9JyArIHByb3RvY29sO1xuICAgIHZhciBuZXdJY2VTZXJ2ZXJzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjb25maWcuaWNlU2VydmVycy5sZW5ndGg7ICsraSkge1xuICAgICAgdmFyIGljZVNlcnZlciA9IGNvbmZpZy5pY2VTZXJ2ZXJzW2ldO1xuICAgICAgdmFyIG5ld1VybHMgPSBbXTtcbiAgICAgIGZvciAodmFyIGogPSAwOyBqIDwgaWNlU2VydmVyLnVybHMubGVuZ3RoOyArK2opIHtcbiAgICAgICAgdmFyIHVyaSA9IGljZVNlcnZlci51cmxzW2pdO1xuICAgICAgICBpZiAodXJpLmluZGV4T2YodHJhbnNwb3J0KSAhPT0gLTEpIHtcbiAgICAgICAgICBuZXdVcmxzLnB1c2godXJpKTtcbiAgICAgICAgfSBlbHNlIGlmICh1cmkuaW5kZXhPZignP3RyYW5zcG9ydD0nKSA9PT0gLTEgJiZcbiAgICAgICAgICAgIHVyaS5zdGFydHNXaXRoKCd0dXJuJykpIHtcbiAgICAgICAgICBuZXdVcmxzLnB1c2godXJpICsgJz8nICsgdHJhbnNwb3J0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG5ld1VybHMubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgIGljZVNlcnZlci51cmxzID0gbmV3VXJscztcbiAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKGljZVNlcnZlcik7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbmZpZy5pY2VTZXJ2ZXJzID0gbmV3SWNlU2VydmVycztcbiAgfSxcblxuICAvLyBDcmVhdGUgYSBQZWVyQ29ubmVjdGlvbiwgYW5kIGdhdGhlciBjYW5kaWRhdGVzIHVzaW5nIFJUQ0NvbmZpZyB8Y29uZmlnfFxuICAvLyBhbmQgY3RvciBwYXJhbXMgfHBhcmFtc3wuIFN1Y2NlZWQgaWYgYW55IGNhbmRpZGF0ZXMgcGFzcyB0aGUgfGlzR29vZHxcbiAgLy8gY2hlY2ssIGZhaWwgaWYgd2UgY29tcGxldGUgZ2F0aGVyaW5nIHdpdGhvdXQgYW55IHBhc3NpbmcuXG4gIGdhdGhlckNhbmRpZGF0ZXM6IGZ1bmN0aW9uKGNvbmZpZywgcGFyYW1zLCBpc0dvb2QpIHtcbiAgICB2YXIgcGM7XG4gICAgdHJ5IHtcbiAgICAgIHBjID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZywgcGFyYW1zKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKHBhcmFtcyAhPT0gbnVsbCAmJiBwYXJhbXMub3B0aW9uYWxbMF0uZ29vZ0lQdjYpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0ZhaWxlZCB0byBjcmVhdGUgcGVlciBjb25uZWN0aW9uLCBJUHY2ICcgK1xuICAgICAgICAgICAgJ21pZ2h0IG5vdCBiZSBzZXR1cC9zdXBwb3J0ZWQgb24gdGhlIG5ldHdvcmsuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0ZhaWxlZCB0byBjcmVhdGUgcGVlciBjb25uZWN0aW9uOiAnICsgZXJyb3IpO1xuICAgICAgfVxuICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBJbiBvdXIgY2FuZGlkYXRlIGNhbGxiYWNrLCBzdG9wIGlmIHdlIGdldCBhIGNhbmRpZGF0ZSB0aGF0IHBhc3Nlc1xuICAgIC8vIHxpc0dvb2R8LlxuICAgIHBjLmFkZEV2ZW50TGlzdGVuZXIoJ2ljZWNhbmRpZGF0ZScsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIC8vIE9uY2Ugd2UndmUgZGVjaWRlZCwgaWdub3JlIGZ1dHVyZSBjYWxsYmFja3MuXG4gICAgICBpZiAoZS5jdXJyZW50VGFyZ2V0LnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChlLmNhbmRpZGF0ZSkge1xuICAgICAgICB2YXIgcGFyc2VkID0gQ2FsbC5wYXJzZUNhbmRpZGF0ZShlLmNhbmRpZGF0ZS5jYW5kaWRhdGUpO1xuICAgICAgICBpZiAoaXNHb29kKHBhcnNlZCkpIHtcbiAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnR2F0aGVyZWQgY2FuZGlkYXRlIG9mIFR5cGU6ICcgKyBwYXJzZWQudHlwZSArXG4gICAgICAgICAgICAgICcgUHJvdG9jb2w6ICcgKyBwYXJzZWQucHJvdG9jb2wgKyAnIEFkZHJlc3M6ICcgKyBwYXJzZWQuYWRkcmVzcyk7XG4gICAgICAgICAgcGMuY2xvc2UoKTtcbiAgICAgICAgICBwYyA9IG51bGw7XG4gICAgICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGMuY2xvc2UoKTtcbiAgICAgICAgcGMgPSBudWxsO1xuICAgICAgICBpZiAocGFyYW1zICE9PSBudWxsICYmIHBhcmFtcy5vcHRpb25hbFswXS5nb29nSVB2Nikge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdGYWlsZWQgdG8gZ2F0aGVyIElQdjYgY2FuZGlkYXRlcywgaXQgJyArXG4gICAgICAgICAgICAgICdtaWdodCBub3QgYmUgc2V0dXAvc3VwcG9ydGVkIG9uIHRoZSBuZXR3b3JrLicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignRmFpbGVkIHRvIGdhdGhlciBzcGVjaWZpZWQgY2FuZGlkYXRlcycpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICB9XG4gICAgfS5iaW5kKHRoaXMpKTtcblxuICAgIHRoaXMuY3JlYXRlQXVkaW9Pbmx5UmVjZWl2ZU9mZmVyKHBjKTtcbiAgfSxcblxuICAvLyBDcmVhdGUgYW4gYXVkaW8tb25seSwgcmVjdm9ubHkgb2ZmZXIsIGFuZCBzZXRMRCB3aXRoIGl0LlxuICAvLyBUaGlzIHdpbGwgdHJpZ2dlciBjYW5kaWRhdGUgZ2F0aGVyaW5nLlxuICBjcmVhdGVBdWRpb09ubHlSZWNlaXZlT2ZmZXI6IGZ1bmN0aW9uKHBjKSB7XG4gICAgdmFyIGNyZWF0ZU9mZmVyUGFyYW1zID0ge29mZmVyVG9SZWNlaXZlQXVkaW86IDF9O1xuICAgIHBjLmNyZWF0ZU9mZmVyKFxuICAgICAgICBjcmVhdGVPZmZlclBhcmFtc1xuICAgICkudGhlbihcbiAgICAgICAgZnVuY3Rpb24ob2ZmZXIpIHtcbiAgICAgICAgICBwYy5zZXRMb2NhbERlc2NyaXB0aW9uKG9mZmVyKS50aGVuKFxuICAgICAgICAgICAgICBub29wLFxuICAgICAgICAgICAgICBub29wXG4gICAgICAgICAgKTtcbiAgICAgICAgfSxcbiAgICAgICAgbm9vcFxuICAgICk7XG5cbiAgICAvLyBFbXB0eSBmdW5jdGlvbiBmb3IgY2FsbGJhY2tzIHJlcXVpcmluZyBhIGZ1bmN0aW9uLlxuICAgIGZ1bmN0aW9uIG5vb3AoKSB7fVxuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBOZXR3b3JrVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBhZGFwdGVyIGZyb20gJ3dlYnJ0Yy1hZGFwdGVyJztcbmltcG9ydCBTdGF0aXN0aWNzQWdncmVnYXRlIGZyb20gJy4uL3V0aWwvc3RhdHMuanMnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9jYWxsLmpzJztcblxuZnVuY3Rpb24gVmlkZW9CYW5kd2lkdGhUZXN0KHRlc3QpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5tYXhWaWRlb0JpdHJhdGVLYnBzID0gMjAwMDtcbiAgdGhpcy5kdXJhdGlvbk1zID0gNDAwMDA7XG4gIHRoaXMuc3RhdFN0ZXBNcyA9IDEwMDtcbiAgdGhpcy5id2VTdGF0cyA9IG5ldyBTdGF0aXN0aWNzQWdncmVnYXRlKDAuNzUgKiB0aGlzLm1heFZpZGVvQml0cmF0ZUticHMgKlxuICAgICAgMTAwMCk7XG4gIHRoaXMucnR0U3RhdHMgPSBuZXcgU3RhdGlzdGljc0FnZ3JlZ2F0ZSgpO1xuICB0aGlzLnBhY2tldHNMb3N0ID0gLTE7XG4gIHRoaXMubmFja0NvdW50ID0gLTE7XG4gIHRoaXMucGxpQ291bnQgPSAtMTtcbiAgdGhpcy5xcFN1bSA9IC0xO1xuICB0aGlzLnBhY2tldHNTZW50ID0gLTE7XG4gIHRoaXMucGFja2V0c1JlY2VpdmVkID0gLTE7XG4gIHRoaXMuZnJhbWVzRW5jb2RlZCA9IC0xO1xuICB0aGlzLmZyYW1lc0RlY29kZWQgPSAtMTtcbiAgdGhpcy5mcmFtZXNTZW50ID0gLTE7XG4gIHRoaXMuYnl0ZXNTZW50ID0gLTE7XG4gIHRoaXMudmlkZW9TdGF0cyA9IFtdO1xuICB0aGlzLnN0YXJ0VGltZSA9IG51bGw7XG4gIHRoaXMuY2FsbCA9IG51bGw7XG4gIC8vIE9wZW4gdGhlIGNhbWVyYSBpbiA3MjBwIHRvIGdldCBhIGNvcnJlY3QgbWVhc3VyZW1lbnQgb2YgcmFtcC11cCB0aW1lLlxuICB0aGlzLmNvbnN0cmFpbnRzID0ge1xuICAgIGF1ZGlvOiBmYWxzZSxcbiAgICB2aWRlbzoge1xuICAgICAgb3B0aW9uYWw6IFtcbiAgICAgICAge21pbldpZHRoOiAxMjgwfSxcbiAgICAgICAge21pbkhlaWdodDogNzIwfVxuICAgICAgXVxuICAgIH1cbiAgfTtcbn1cblxuVmlkZW9CYW5kd2lkdGhUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksIHRoaXMudGVzdCk7XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMuY2FsbCA9IG5ldyBDYWxsKGNvbmZpZywgdGhpcy50ZXN0KTtcbiAgICB0aGlzLmNhbGwuc2V0SWNlQ2FuZGlkYXRlRmlsdGVyKENhbGwuaXNSZWxheSk7XG4gICAgLy8gRkVDIG1ha2VzIGl0IGhhcmQgdG8gc3R1ZHkgYmFuZHdpZHRoIGVzdGltYXRpb24gc2luY2UgdGhlcmUgc2VlbXMgdG8gYmVcbiAgICAvLyBhIHNwaWtlIHdoZW4gaXQgaXMgZW5hYmxlZCBhbmQgZGlzYWJsZWQuIERpc2FibGUgaXQgZm9yIG5vdy4gRkVDIGlzc3VlXG4gICAgLy8gdHJhY2tlZCBvbjogaHR0cHM6Ly9jb2RlLmdvb2dsZS5jb20vcC93ZWJydGMvaXNzdWVzL2RldGFpbD9pZD0zMDUwXG4gICAgdGhpcy5jYWxsLmRpc2FibGVWaWRlb0ZlYygpO1xuICAgIHRoaXMuY2FsbC5jb25zdHJhaW5WaWRlb0JpdHJhdGUodGhpcy5tYXhWaWRlb0JpdHJhdGVLYnBzKTtcbiAgICB0aGlzLnRlc3QuZG9HZXRVc2VyTWVkaWEodGhpcy5jb25zdHJhaW50cywgdGhpcy5nb3RTdHJlYW0uYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgZ290U3RyZWFtOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICB0aGlzLmNhbGwucGMxLmFkZFN0cmVhbShzdHJlYW0pO1xuICAgIHRoaXMuY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgdGhpcy5zdGFydFRpbWUgPSBuZXcgRGF0ZSgpO1xuICAgIHRoaXMubG9jYWxTdHJlYW0gPSBzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXTtcbiAgICBzZXRUaW1lb3V0KHRoaXMuZ2F0aGVyU3RhdHMuYmluZCh0aGlzKSwgdGhpcy5zdGF0U3RlcE1zKTtcbiAgfSxcblxuICBnYXRoZXJTdGF0czogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgaWYgKG5vdyAtIHRoaXMuc3RhcnRUaW1lID4gdGhpcy5kdXJhdGlvbk1zKSB7XG4gICAgICB0aGlzLnRlc3Quc2V0UHJvZ3Jlc3MoMTAwKTtcbiAgICAgIHRoaXMuaGFuZ3VwKCk7XG4gICAgICByZXR1cm47XG4gICAgfSBlbHNlIGlmICghdGhpcy5jYWxsLnN0YXRzR2F0aGVyaW5nUnVubmluZykge1xuICAgICAgdGhpcy5jYWxsLmdhdGhlclN0YXRzKHRoaXMuY2FsbC5wYzEsIHRoaXMuY2FsbC5wYzIsIHRoaXMubG9jYWxTdHJlYW0sXG4gICAgICAgICAgdGhpcy5nb3RTdGF0cy5iaW5kKHRoaXMpKTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LnNldFByb2dyZXNzKChub3cgLSB0aGlzLnN0YXJ0VGltZSkgKiAxMDAgLyB0aGlzLmR1cmF0aW9uTXMpO1xuICAgIHNldFRpbWVvdXQodGhpcy5nYXRoZXJTdGF0cy5iaW5kKHRoaXMpLCB0aGlzLnN0YXRTdGVwTXMpO1xuICB9LFxuXG4gIGdvdFN0YXRzOiBmdW5jdGlvbihyZXNwb25zZSwgdGltZSwgcmVzcG9uc2UyLCB0aW1lMikge1xuICAgIC8vIFRPRE86IFJlbW92ZSBicm93c2VyIHNwZWNpZmljIHN0YXRzIGdhdGhlcmluZyBoYWNrIG9uY2UgYWRhcHRlci5qcyBvclxuICAgIC8vIGJyb3dzZXJzIGNvbnZlcmdlIG9uIGEgc3RhbmRhcmQuXG4gICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgIGZvciAodmFyIGkgaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgaWYgKHR5cGVvZiByZXNwb25zZVtpXS5jb25uZWN0aW9uICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIHRoaXMuYndlU3RhdHMuYWRkKHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24udGltZXN0YW1wLFxuICAgICAgICAgICAgICBwYXJzZUludChyZXNwb25zZVtpXS5jb25uZWN0aW9uLmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZSkpO1xuICAgICAgICAgIHRoaXMucnR0U3RhdHMuYWRkKHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24udGltZXN0YW1wLFxuICAgICAgICAgICAgICBwYXJzZUludChyZXNwb25zZVtpXS5jb25uZWN0aW9uLmN1cnJlbnRSb3VuZFRyaXBUaW1lICogMTAwMCkpO1xuICAgICAgICAgIC8vIEdyYWIgdGhlIGxhc3Qgc3RhdHMuXG4gICAgICAgICAgdGhpcy52aWRlb1N0YXRzWzBdID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwuZnJhbWVXaWR0aDtcbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMV0gPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5mcmFtZUhlaWdodDtcbiAgICAgICAgICB0aGlzLm5hY2tDb3VudCA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLm5hY2tDb3VudDtcbiAgICAgICAgICB0aGlzLnBhY2tldHNMb3N0ID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5wYWNrZXRzTG9zdDtcbiAgICAgICAgICB0aGlzLnFwU3VtID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5xcFN1bTtcbiAgICAgICAgICB0aGlzLnBsaUNvdW50ID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwucGxpQ291bnQ7XG4gICAgICAgICAgdGhpcy5wYWNrZXRzU2VudCA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLnBhY2tldHNTZW50O1xuICAgICAgICAgIHRoaXMucGFja2V0c1JlY2VpdmVkID0gcmVzcG9uc2UyW2ldLnZpZGVvLnJlbW90ZS5wYWNrZXRzUmVjZWl2ZWQ7XG4gICAgICAgICAgdGhpcy5mcmFtZXNFbmNvZGVkID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwuZnJhbWVzRW5jb2RlZDtcbiAgICAgICAgICB0aGlzLmZyYW1lc0RlY29kZWQgPSByZXNwb25zZTJbaV0udmlkZW8ucmVtb3RlLmZyYW1lc0RlY29kZWQ7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICBmb3IgKHZhciBqIGluIHJlc3BvbnNlKSB7XG4gICAgICAgIGlmIChyZXNwb25zZVtqXS5pZCA9PT0gJ291dGJvdW5kX3J0Y3BfdmlkZW9fMCcpIHtcbiAgICAgICAgICB0aGlzLnJ0dFN0YXRzLmFkZChEYXRlLnBhcnNlKHJlc3BvbnNlW2pdLnRpbWVzdGFtcCksXG4gICAgICAgICAgICAgIHBhcnNlSW50KHJlc3BvbnNlW2pdLm1velJ0dCkpO1xuICAgICAgICAgIC8vIEdyYWIgdGhlIGxhc3Qgc3RhdHMuXG4gICAgICAgICAgdGhpcy5qaXR0ZXIgPSByZXNwb25zZVtqXS5qaXR0ZXI7XG4gICAgICAgICAgdGhpcy5wYWNrZXRzTG9zdCA9IHJlc3BvbnNlW2pdLnBhY2tldHNMb3N0O1xuICAgICAgICB9IGVsc2UgaWYgKHJlc3BvbnNlW2pdLmlkID09PSAnb3V0Ym91bmRfcnRwX3ZpZGVvXzAnKSB7XG4gICAgICAgICAgLy8gVE9ETzogR2V0IGRpbWVuc2lvbnMgZnJvbSBnZXRTdGF0cyB3aGVuIHN1cHBvcnRlZCBpbiBGRi5cbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMF0gPSAnTm90IHN1cHBvcnRlZCBvbiBGaXJlZm94JztcbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMV0gPSAnTm90IHN1cHBvcnRlZCBvbiBGaXJlZm94JztcbiAgICAgICAgICB0aGlzLmJpdHJhdGVNZWFuID0gcmVzcG9uc2Vbal0uYml0cmF0ZU1lYW47XG4gICAgICAgICAgdGhpcy5iaXRyYXRlU3RkRGV2ID0gcmVzcG9uc2Vbal0uYml0cmF0ZVN0ZERldjtcbiAgICAgICAgICB0aGlzLmZyYW1lcmF0ZU1lYW4gPSByZXNwb25zZVtqXS5mcmFtZXJhdGVNZWFuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgaW1wbGVtZW50YXRpb25zJyArXG4gICAgICAgICcgYXJlIHN1cHBvcnRlZC4nKTtcbiAgICB9XG4gICAgdGhpcy5jb21wbGV0ZWQoKTtcbiAgfSxcblxuICBoYW5ndXA6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY2FsbC5wYzEuZ2V0TG9jYWxTdHJlYW1zKClbMF0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgdHJhY2suc3RvcCgpO1xuICAgIH0pO1xuICAgIHRoaXMuY2FsbC5jbG9zZSgpO1xuICAgIHRoaXMuY2FsbCA9IG51bGw7XG4gIH0sXG5cbiAgY29tcGxldGVkOiBmdW5jdGlvbigpIHtcbiAgICAvLyBUT0RPOiBSZW1vdmUgYnJvd3NlciBzcGVjaWZpYyBzdGF0cyBnYXRoZXJpbmcgaGFjayBvbmNlIGFkYXB0ZXIuanMgb3JcbiAgICAvLyBicm93c2VycyBjb252ZXJnZSBvbiBhIHN0YW5kYXJkLlxuICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICAvLyBDaGVja2luZyBpZiBncmVhdGVyIHRoYW4gMiBiZWNhdXNlIENocm9tZSBzb21ldGltZXMgcmVwb3J0cyAyeDIgd2hlblxuICAgICAgLy8gYSBjYW1lcmEgc3RhcnRzIGJ1dCBmYWlscyB0byBkZWxpdmVyIGZyYW1lcy5cbiAgICAgIGlmICh0aGlzLnZpZGVvU3RhdHNbMF0gPCAyICYmIHRoaXMudmlkZW9TdGF0c1sxXSA8IDIpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDYW1lcmEgZmFpbHVyZTogJyArIHRoaXMudmlkZW9TdGF0c1swXSArICd4JyArXG4gICAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMV0gKyAnLiBDYW5ub3QgdGVzdCBiYW5kd2lkdGggd2l0aG91dCBhIHdvcmtpbmcgJyArXG4gICAgICAgICAgICAnIGNhbWVyYS4nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdWaWRlbyByZXNvbHV0aW9uOiAnICsgdGhpcy52aWRlb1N0YXRzWzBdICtcbiAgICAgICAgICAgICd4JyArIHRoaXMudmlkZW9TdGF0c1sxXSk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJhbmR3aWR0aCBlc3RpbWF0ZSBhdmVyYWdlOiAnICtcbiAgICAgICAgICAgIE1hdGgucm91bmQodGhpcy5id2VTdGF0cy5nZXRBdmVyYWdlKCkgLyAxMDAwKSArICcga2JwcycpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiYW5kd2lkdGggZXN0aW1hdGUgbWF4OiAnICtcbiAgICAgICAgICAgIHRoaXMuYndlU3RhdHMuZ2V0TWF4KCkgLyAxMDAwICsgJyBrYnBzJyk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJhbmR3aWR0aCByYW1wLXVwIHRpbWU6ICcgK1xuICAgICAgICAgICAgdGhpcy5id2VTdGF0cy5nZXRSYW1wVXBUaW1lKCkgKyAnIG1zJyk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdQYWNrZXRzIHNlbnQ6ICcgKyB0aGlzLnBhY2tldHNTZW50KTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1BhY2tldHMgcmVjZWl2ZWQ6ICcgKyB0aGlzLnBhY2tldHNSZWNlaXZlZCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdOQUNLIGNvdW50OiAnICsgdGhpcy5uYWNrQ291bnQpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUGljdHVyZSBsb3NzIGluZGljYXRpb25zOiAnICsgdGhpcy5wbGlDb3VudCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdRdWFsaXR5IHByZWRpY3RvciBzdW06ICcgKyB0aGlzLnFwU3VtKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0ZyYW1lcyBlbmNvZGVkOiAnICsgdGhpcy5mcmFtZXNFbmNvZGVkKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0ZyYW1lcyBkZWNvZGVkOiAnICsgdGhpcy5mcmFtZXNEZWNvZGVkKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICBpZiAocGFyc2VJbnQodGhpcy5mcmFtZXJhdGVNZWFuKSA+IDApIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0ZyYW1lIHJhdGUgbWVhbjogJyArXG4gICAgICAgICAgICBwYXJzZUludCh0aGlzLmZyYW1lcmF0ZU1lYW4pKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignRnJhbWUgcmF0ZSBtZWFuIGlzIDAsIGNhbm5vdCB0ZXN0IGJhbmR3aWR0aCAnICtcbiAgICAgICAgICAgICd3aXRob3V0IGEgd29ya2luZyBjYW1lcmEuJyk7XG4gICAgICB9XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiaXRyYXRlIG1lYW46ICcgK1xuICAgICAgICAgIHBhcnNlSW50KHRoaXMuYml0cmF0ZU1lYW4pIC8gMTAwMCArICcga2JwcycpO1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1NlbmQgYml0cmF0ZSBzdGFuZGFyZCBkZXZpYXRpb246ICcgK1xuICAgICAgICAgIHBhcnNlSW50KHRoaXMuYml0cmF0ZVN0ZERldikgLyAxMDAwICsgJyBrYnBzJyk7XG4gICAgfVxuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdSVFQgYXZlcmFnZTogJyArIHRoaXMucnR0U3RhdHMuZ2V0QXZlcmFnZSgpICtcbiAgICAgICAgICAgICcgbXMnKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUlRUIG1heDogJyArIHRoaXMucnR0U3RhdHMuZ2V0TWF4KCkgKyAnIG1zJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1BhY2tldHMgbG9zdDogJyArIHRoaXMucGFja2V0c0xvc3QpO1xuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IFZpZGVvQmFuZHdpZHRoVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBDYWxsIGZyb20gJy4uL3V0aWwvY2FsbC5qcyc7XG5pbXBvcnQgUmVwb3J0IGZyb20gJy4uL3V0aWwvcmVwb3J0LmpzJztcbmltcG9ydCB7IGFycmF5QXZlcmFnZSwgYXJyYXlNaW4sIGFycmF5TWF4IH0gZnJvbSAnLi4vdXRpbC91dGlsLmpzJztcblxuY29uc3QgcmVwb3J0ID0gbmV3IFJlcG9ydCgpO1xuXG5mdW5jdGlvbiBXaUZpUGVyaW9kaWNTY2FuVGVzdCh0ZXN0LCBjYW5kaWRhdGVGaWx0ZXIpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy5jYW5kaWRhdGVGaWx0ZXIgPSBjYW5kaWRhdGVGaWx0ZXI7XG4gIHRoaXMudGVzdER1cmF0aW9uTXMgPSA1ICogNjAgKiAxMDAwO1xuICB0aGlzLnNlbmRJbnRlcnZhbE1zID0gMTAwO1xuICB0aGlzLmRlbGF5cyA9IFtdO1xuICB0aGlzLnJlY3ZUaW1lU3RhbXBzID0gW107XG4gIHRoaXMucnVubmluZyA9IGZhbHNlO1xuICB0aGlzLmNhbGwgPSBudWxsO1xuICB0aGlzLnNlbmRlckNoYW5uZWwgPSBudWxsO1xuICB0aGlzLnJlY2VpdmVDaGFubmVsID0gbnVsbDtcbn1cblxuV2lGaVBlcmlvZGljU2NhblRlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIENhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnKHRoaXMuc3RhcnQuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KSwgdGhpcy50ZXN0KTtcbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5ydW5uaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmNhbGwgPSBuZXcgQ2FsbChjb25maWcsIHRoaXMudGVzdCk7XG4gICAgdGhpcy5jYWxsLnNldEljZUNhbmRpZGF0ZUZpbHRlcih0aGlzLmNhbmRpZGF0ZUZpbHRlcik7XG5cbiAgICB0aGlzLnNlbmRlckNoYW5uZWwgPSB0aGlzLmNhbGwucGMxLmNyZWF0ZURhdGFDaGFubmVsKHtvcmRlcmVkOiBmYWxzZSxcbiAgICAgIG1heFJldHJhbnNtaXRzOiAwfSk7XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCB0aGlzLnNlbmQuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLnBjMi5hZGRFdmVudExpc3RlbmVyKCdkYXRhY2hhbm5lbCcsXG4gICAgICAgIHRoaXMub25SZWNlaXZlckNoYW5uZWwuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5jYWxsLmVzdGFibGlzaENvbm5lY3Rpb24oKTtcblxuICAgIHRoaXMudGVzdC5zZXRUaW1lb3V0V2l0aFByb2dyZXNzQmFyKHRoaXMuZmluaXNoVGVzdC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3REdXJhdGlvbk1zKTtcbiAgfSxcblxuICBvblJlY2VpdmVyQ2hhbm5lbDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICB0aGlzLnJlY2VpdmVDaGFubmVsID0gZXZlbnQuY2hhbm5lbDtcbiAgICB0aGlzLnJlY2VpdmVDaGFubmVsLmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCB0aGlzLnJlY2VpdmUuYmluZCh0aGlzKSk7XG4gIH0sXG5cbiAgc2VuZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsLnNlbmQoJycgKyBEYXRlLm5vdygpKTtcbiAgICBzZXRUaW1lb3V0KHRoaXMuc2VuZC5iaW5kKHRoaXMpLCB0aGlzLnNlbmRJbnRlcnZhbE1zKTtcbiAgfSxcblxuICByZWNlaXZlOiBmdW5jdGlvbihldmVudCkge1xuICAgIGlmICghdGhpcy5ydW5uaW5nKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBzZW5kVGltZSA9IHBhcnNlSW50KGV2ZW50LmRhdGEpO1xuICAgIHZhciBkZWxheSA9IERhdGUubm93KCkgLSBzZW5kVGltZTtcbiAgICB0aGlzLnJlY3ZUaW1lU3RhbXBzLnB1c2goc2VuZFRpbWUpO1xuICAgIHRoaXMuZGVsYXlzLnB1c2goZGVsYXkpO1xuICB9LFxuXG4gIGZpbmlzaFRlc3Q6IGZ1bmN0aW9uKCkge1xuICAgIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgncGVyaW9kaWMtZGVsYXknLCB7ZGVsYXlzOiB0aGlzLmRlbGF5cyxcbiAgICAgIHJlY3ZUaW1lU3RhbXBzOiB0aGlzLnJlY3ZUaW1lU3RhbXBzfSk7XG4gICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgdGhpcy5jYWxsID0gbnVsbDtcblxuICAgIHZhciBhdmcgPSBhcnJheUF2ZXJhZ2UodGhpcy5kZWxheXMpO1xuICAgIHZhciBtYXggPSBhcnJheU1heCh0aGlzLmRlbGF5cyk7XG4gICAgdmFyIG1pbiA9IGFycmF5TWluKHRoaXMuZGVsYXlzKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnQXZlcmFnZSBkZWxheTogJyArIGF2ZyArICcgbXMuJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ01pbiBkZWxheTogJyArIG1pbiArICcgbXMuJyk7XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ01heCBkZWxheTogJyArIG1heCArICcgbXMuJyk7XG5cbiAgICBpZiAodGhpcy5kZWxheXMubGVuZ3RoIDwgMC44ICogdGhpcy50ZXN0RHVyYXRpb25NcyAvIHRoaXMuc2VuZEludGVydmFsTXMpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm90IGVub3VnaCBzYW1wbGVzIGdhdGhlcmVkLiBLZWVwIHRoZSBwYWdlIG9uICcgK1xuICAgICAgICAgICcgdGhlIGZvcmVncm91bmQgd2hpbGUgdGhlIHRlc3QgaXMgcnVubmluZy4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0NvbGxlY3RlZCAnICsgdGhpcy5kZWxheXMubGVuZ3RoICtcbiAgICAgICAgICAnIGRlbGF5IHNhbXBsZXMuJyk7XG4gICAgfVxuXG4gICAgaWYgKG1heCA+IChtaW4gKyAxMDApICogMikge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdUaGVyZSBpcyBhIGJpZyBkaWZmZXJlbmNlIGJldHdlZW4gdGhlIG1pbiBhbmQgJyArXG4gICAgICAgICAgJ21heCBkZWxheSBvZiBwYWNrZXRzLiBZb3VyIG5ldHdvcmsgYXBwZWFycyB1bnN0YWJsZS4nKTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgV2lGaVBlcmlvZGljU2NhblRlc3Q7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcbmltcG9ydCBhZGFwdGVyIGZyb20gJ3dlYnJ0Yy1hZGFwdGVyJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi9yZXBvcnQuanMnO1xuaW1wb3J0IHsgZW51bWVyYXRlU3RhdHMgfSBmcm9tICcuL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG5cbmZ1bmN0aW9uIENhbGwoY29uZmlnLCB0ZXN0KSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMudHJhY2VFdmVudCA9IHJlcG9ydC50cmFjZUV2ZW50QXN5bmMoJ2NhbGwnKTtcbiAgdGhpcy50cmFjZUV2ZW50KHtjb25maWc6IGNvbmZpZ30pO1xuICB0aGlzLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuXG4gIHRoaXMucGMxID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZyk7XG4gIHRoaXMucGMyID0gbmV3IFJUQ1BlZXJDb25uZWN0aW9uKGNvbmZpZyk7XG5cbiAgdGhpcy5wYzEuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgdGhpcy5vbkljZUNhbmRpZGF0ZV8uYmluZCh0aGlzLFxuICAgICAgdGhpcy5wYzIpKTtcbiAgdGhpcy5wYzIuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgdGhpcy5vbkljZUNhbmRpZGF0ZV8uYmluZCh0aGlzLFxuICAgICAgdGhpcy5wYzEpKTtcblxuICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8gPSBDYWxsLm5vRmlsdGVyO1xufVxuXG5DYWxsLnByb3RvdHlwZSA9IHtcbiAgZXN0YWJsaXNoQ29ubmVjdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50KHtzdGF0ZTogJ3N0YXJ0J30pO1xuICAgIHRoaXMucGMxLmNyZWF0ZU9mZmVyKCkudGhlbihcbiAgICAgICAgdGhpcy5nb3RPZmZlcl8uYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KVxuICAgICk7XG4gIH0sXG5cbiAgY2xvc2U6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudCh7c3RhdGU6ICdlbmQnfSk7XG4gICAgdGhpcy5wYzEuY2xvc2UoKTtcbiAgICB0aGlzLnBjMi5jbG9zZSgpO1xuICB9LFxuXG4gIHNldEljZUNhbmRpZGF0ZUZpbHRlcjogZnVuY3Rpb24oZmlsdGVyKSB7XG4gICAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfID0gZmlsdGVyO1xuICB9LFxuXG4gIC8vIENvbnN0cmFpbnQgbWF4IHZpZGVvIGJpdHJhdGUgYnkgbW9kaWZ5aW5nIHRoZSBTRFAgd2hlbiBjcmVhdGluZyBhbiBhbnN3ZXIuXG4gIGNvbnN0cmFpblZpZGVvQml0cmF0ZTogZnVuY3Rpb24obWF4VmlkZW9CaXRyYXRlS2Jwcykge1xuICAgIHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18gPSBtYXhWaWRlb0JpdHJhdGVLYnBzO1xuICB9LFxuXG4gIC8vIFJlbW92ZSB2aWRlbyBGRUMgaWYgYXZhaWxhYmxlIG9uIHRoZSBvZmZlci5cbiAgZGlzYWJsZVZpZGVvRmVjOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNvbnN0cmFpbk9mZmVyVG9SZW1vdmVWaWRlb0ZlY18gPSB0cnVlO1xuICB9LFxuXG4gIC8vIFdoZW4gdGhlIHBlZXJDb25uZWN0aW9uIGlzIGNsb3NlZCB0aGUgc3RhdHNDYiBpcyBjYWxsZWQgb25jZSB3aXRoIGFuIGFycmF5XG4gIC8vIG9mIGdhdGhlcmVkIHN0YXRzLlxuICBnYXRoZXJTdGF0czogZnVuY3Rpb24ocGVlckNvbm5lY3Rpb24scGVlckNvbm5lY3Rpb24yLCBsb2NhbFN0cmVhbSwgc3RhdHNDYikge1xuICAgIHZhciBzdGF0cyA9IFtdO1xuICAgIHZhciBzdGF0czIgPSBbXTtcbiAgICB2YXIgc3RhdHNDb2xsZWN0VGltZSA9IFtdO1xuICAgIHZhciBzdGF0c0NvbGxlY3RUaW1lMiA9IFtdO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgc3RhdFN0ZXBNcyA9IDEwMDtcbiAgICBzZWxmLmxvY2FsVHJhY2tJZHMgPSB7XG4gICAgICBhdWRpbzogJycsXG4gICAgICB2aWRlbzogJydcbiAgICB9O1xuICAgIHNlbGYucmVtb3RlVHJhY2tJZHMgPSB7XG4gICAgICBhdWRpbzogJycsXG4gICAgICB2aWRlbzogJydcbiAgICB9O1xuXG4gICAgcGVlckNvbm5lY3Rpb24uZ2V0U2VuZGVycygpLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICBpZiAoc2VuZGVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgc2VsZi5sb2NhbFRyYWNrSWRzLmF1ZGlvID0gc2VuZGVyLnRyYWNrLmlkO1xuICAgICAgfSBlbHNlIGlmIChzZW5kZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICBzZWxmLmxvY2FsVHJhY2tJZHMudmlkZW8gPSBzZW5kZXIudHJhY2suaWQ7XG4gICAgICB9XG4gICAgfS5iaW5kKHNlbGYpKTtcblxuICAgIGlmIChwZWVyQ29ubmVjdGlvbjIpIHtcbiAgICAgIHBlZXJDb25uZWN0aW9uMi5nZXRSZWNlaXZlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHJlY2VpdmVyKSB7XG4gICAgICAgIGlmIChyZWNlaXZlci50cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcy5hdWRpbyA9IHJlY2VpdmVyLnRyYWNrLmlkO1xuICAgICAgICB9IGVsc2UgaWYgKHJlY2VpdmVyLnRyYWNrLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzLnZpZGVvID0gcmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgIH1cbiAgICAgIH0uYmluZChzZWxmKSk7XG4gICAgfVxuXG4gICAgdGhpcy5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSB0cnVlO1xuICAgIGdldFN0YXRzXygpO1xuXG4gICAgZnVuY3Rpb24gZ2V0U3RhdHNfKCkge1xuICAgICAgaWYgKHBlZXJDb25uZWN0aW9uLnNpZ25hbGluZ1N0YXRlID09PSAnY2xvc2VkJykge1xuICAgICAgICBzZWxmLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuICAgICAgICBzdGF0c0NiKHN0YXRzLCBzdGF0c0NvbGxlY3RUaW1lLCBzdGF0czIsIHN0YXRzQ29sbGVjdFRpbWUyKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcGVlckNvbm5lY3Rpb24uZ2V0U3RhdHMoKVxuICAgICAgICAgIC50aGVuKGdvdFN0YXRzXylcbiAgICAgICAgICAuY2F0Y2goZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignQ291bGQgbm90IGdhdGhlciBzdGF0czogJyArIGVycm9yKTtcbiAgICAgICAgICAgIHNlbGYuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgICAgICBzdGF0c0NiKHN0YXRzLCBzdGF0c0NvbGxlY3RUaW1lKTtcbiAgICAgICAgICB9LmJpbmQoc2VsZikpO1xuICAgICAgaWYgKHBlZXJDb25uZWN0aW9uMikge1xuICAgICAgICBwZWVyQ29ubmVjdGlvbjIuZ2V0U3RhdHMoKVxuICAgICAgICAgICAgLnRoZW4oZ290U3RhdHMyXyk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIFN0YXRzIGZvciBwYzIsIHNvbWUgc3RhdHMgYXJlIG9ubHkgYXZhaWxhYmxlIG9uIHRoZSByZWNlaXZpbmcgZW5kIG9mIGFcbiAgICAvLyBwZWVyY29ubmVjdGlvbi5cbiAgICBmdW5jdGlvbiBnb3RTdGF0czJfKHJlc3BvbnNlKSB7XG4gICAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgICB2YXIgZW51bWVyYXRlZFN0YXRzID0gZW51bWVyYXRlU3RhdHMocmVzcG9uc2UsIHNlbGYubG9jYWxUcmFja0lkcyxcbiAgICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMpO1xuICAgICAgICBzdGF0czIucHVzaChlbnVtZXJhdGVkU3RhdHMpO1xuICAgICAgICBzdGF0c0NvbGxlY3RUaW1lMi5wdXNoKERhdGUubm93KCkpO1xuICAgICAgfSBlbHNlIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgICBmb3IgKHZhciBoIGluIHJlc3BvbnNlKSB7XG4gICAgICAgICAgdmFyIHN0YXQgPSByZXNwb25zZVtoXTtcbiAgICAgICAgICBzdGF0czIucHVzaChzdGF0KTtcbiAgICAgICAgICBzdGF0c0NvbGxlY3RUaW1lMi5wdXNoKERhdGUubm93KCkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzICcgK1xuICAgICAgICAgICAgJ2ltcGxlbWVudGF0aW9ucyBhcmUgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGZ1bmN0aW9uIGdvdFN0YXRzXyhyZXNwb25zZSkge1xuICAgICAgLy8gVE9ETzogUmVtb3ZlIGJyb3dzZXIgc3BlY2lmaWMgc3RhdHMgZ2F0aGVyaW5nIGhhY2sgb25jZSBhZGFwdGVyLmpzIG9yXG4gICAgICAvLyBicm93c2VycyBjb252ZXJnZSBvbiBhIHN0YW5kYXJkLlxuICAgICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgICAgdmFyIGVudW1lcmF0ZWRTdGF0cyA9IGVudW1lcmF0ZVN0YXRzKHJlc3BvbnNlLCBzZWxmLmxvY2FsVHJhY2tJZHMsXG4gICAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzKTtcbiAgICAgICAgc3RhdHMucHVzaChlbnVtZXJhdGVkU3RhdHMpO1xuICAgICAgICBzdGF0c0NvbGxlY3RUaW1lLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGZvciAodmFyIGogaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgICB2YXIgc3RhdCA9IHJlc3BvbnNlW2pdO1xuICAgICAgICAgIHN0YXRzLnB1c2goc3RhdCk7XG4gICAgICAgICAgc3RhdHNDb2xsZWN0VGltZS5wdXNoKERhdGUubm93KCkpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ09ubHkgRmlyZWZveCBhbmQgQ2hyb21lIGdldFN0YXRzICcgK1xuICAgICAgICAgICAgJ2ltcGxlbWVudGF0aW9ucyBhcmUgc3VwcG9ydGVkLicpO1xuICAgICAgfVxuICAgICAgc2V0VGltZW91dChnZXRTdGF0c18sIHN0YXRTdGVwTXMpO1xuICAgIH1cbiAgfSxcblxuICBnb3RPZmZlcl86IGZ1bmN0aW9uKG9mZmVyKSB7XG4gICAgaWYgKHRoaXMuY29uc3RyYWluT2ZmZXJUb1JlbW92ZVZpZGVvRmVjXykge1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoLyhtPXZpZGVvIDEgW15cXHJdKykoMTE2IDExNykoXFxyXFxuKS9nLFxuICAgICAgICAgICckMVxcclxcbicpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjExNiByZWRcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6MTE3IHVscGZlY1xcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDo5OCBydHhcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1mbXRwOjk4IGFwdD0xMTZcXHJcXG4vZywgJycpO1xuICAgIH1cbiAgICB0aGlzLnBjMS5zZXRMb2NhbERlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICB0aGlzLnBjMi5zZXRSZW1vdGVEZXNjcmlwdGlvbihvZmZlcik7XG4gICAgdGhpcy5wYzIuY3JlYXRlQW5zd2VyKCkudGhlbihcbiAgICAgICAgdGhpcy5nb3RBbnN3ZXJfLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdClcbiAgICApO1xuICB9LFxuXG4gIGdvdEFuc3dlcl86IGZ1bmN0aW9uKGFuc3dlcikge1xuICAgIGlmICh0aGlzLmNvbnN0cmFpblZpZGVvQml0cmF0ZUticHNfKSB7XG4gICAgICBhbnN3ZXIuc2RwID0gYW5zd2VyLnNkcC5yZXBsYWNlKFxuICAgICAgICAgIC9hPW1pZDp2aWRlb1xcclxcbi9nLFxuICAgICAgICAgICdhPW1pZDp2aWRlb1xcclxcbmI9QVM6JyArIHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18gKyAnXFxyXFxuJyk7XG4gICAgfVxuICAgIHRoaXMucGMyLnNldExvY2FsRGVzY3JpcHRpb24oYW5zd2VyKTtcbiAgICB0aGlzLnBjMS5zZXRSZW1vdGVEZXNjcmlwdGlvbihhbnN3ZXIpO1xuICB9LFxuXG4gIG9uSWNlQ2FuZGlkYXRlXzogZnVuY3Rpb24ob3RoZXJQZWVyLCBldmVudCkge1xuICAgIGlmIChldmVudC5jYW5kaWRhdGUpIHtcbiAgICAgIHZhciBwYXJzZWQgPSBDYWxsLnBhcnNlQ2FuZGlkYXRlKGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUpO1xuICAgICAgaWYgKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyhwYXJzZWQpKSB7XG4gICAgICAgIG90aGVyUGVlci5hZGRJY2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn07XG5cbkNhbGwubm9GaWx0ZXIgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5DYWxsLmlzUmVsYXkgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAncmVsYXknO1xufTtcblxuQ2FsbC5pc05vdEhvc3RDYW5kaWRhdGUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlICE9PSAnaG9zdCc7XG59O1xuXG5DYWxsLmlzUmVmbGV4aXZlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ3NyZmx4Jztcbn07XG5cbkNhbGwuaXNIb3N0ID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ2hvc3QnO1xufTtcblxuQ2FsbC5pc0lwdjYgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS5hZGRyZXNzLmluZGV4T2YoJzonKSAhPT0gLTE7XG59O1xuXG4vLyBQYXJzZSBhICdjYW5kaWRhdGU6JyBsaW5lIGludG8gYSBKU09OIG9iamVjdC5cbkNhbGwucGFyc2VDYW5kaWRhdGUgPSBmdW5jdGlvbih0ZXh0KSB7XG4gIHZhciBjYW5kaWRhdGVTdHIgPSAnY2FuZGlkYXRlOic7XG4gIHZhciBwb3MgPSB0ZXh0LmluZGV4T2YoY2FuZGlkYXRlU3RyKSArIGNhbmRpZGF0ZVN0ci5sZW5ndGg7XG4gIHZhciBmaWVsZHMgPSB0ZXh0LnN1YnN0cihwb3MpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgJ3R5cGUnOiBmaWVsZHNbN10sXG4gICAgJ3Byb3RvY29sJzogZmllbGRzWzJdLFxuICAgICdhZGRyZXNzJzogZmllbGRzWzRdXG4gIH07XG59O1xuXG4vLyBTdG9yZSB0aGUgSUNFIHNlcnZlciByZXNwb25zZSBmcm9tIHRoZSBuZXR3b3JrIHRyYXZlcnNhbCBzZXJ2ZXIuXG5DYWxsLmNhY2hlZEljZVNlcnZlcnNfID0gbnVsbDtcbi8vIEtlZXAgdHJhY2sgb2Ygd2hlbiB0aGUgcmVxdWVzdCB3YXMgbWFkZS5cbkNhbGwuY2FjaGVkSWNlQ29uZmlnRmV0Y2hUaW1lXyA9IG51bGw7XG5cbi8vIEdldCBhIFRVUk4gY29uZmlnLCBlaXRoZXIgZnJvbSBzZXR0aW5ncyBvciBmcm9tIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnID0gZnVuY3Rpb24ob25TdWNjZXNzLCBvbkVycm9yLCBjdXJyZW50VGVzdCkge1xuICB2YXIgc2V0dGluZ3MgPSBjdXJyZW50VGVzdC5zZXR0aW5ncztcbiAgdmFyIGljZVNlcnZlciA9IHtcbiAgICAndXNlcm5hbWUnOiBzZXR0aW5ncy50dXJuVXNlcm5hbWUgfHwgJycsXG4gICAgJ2NyZWRlbnRpYWwnOiBzZXR0aW5ncy50dXJuQ3JlZGVudGlhbCB8fCAnJyxcbiAgICAndXJscyc6IHNldHRpbmdzLnR1cm5VUkkuc3BsaXQoJywnKVxuICB9O1xuICB2YXIgY29uZmlnID0geydpY2VTZXJ2ZXJzJzogW2ljZVNlcnZlcl19O1xuICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3R1cm4tY29uZmlnJywgY29uZmlnKTtcbiAgc2V0VGltZW91dChvblN1Y2Nlc3MuYmluZChudWxsLCBjb25maWcpLCAwKTtcbn07XG5cbi8vIEdldCBhIFNUVU4gY29uZmlnLCBlaXRoZXIgZnJvbSBzZXR0aW5ncyBvciBmcm9tIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuYXN5bmNDcmVhdGVTdHVuQ29uZmlnID0gZnVuY3Rpb24ob25TdWNjZXNzLCBvbkVycm9yKSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICB2YXIgaWNlU2VydmVyID0ge1xuICAgICd1cmxzJzogc2V0dGluZ3Muc3R1blVSSS5zcGxpdCgnLCcpXG4gIH07XG4gIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiBbaWNlU2VydmVyXX07XG4gIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgnc3R1bi1jb25maWcnLCBjb25maWcpO1xuICBzZXRUaW1lb3V0KG9uU3VjY2Vzcy5iaW5kKG51bGwsIGNvbmZpZyksIDApO1xufTtcblxuZXhwb3J0IGRlZmF1bHQgQ2FsbDtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE3IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IFNzaW0gZnJvbSAnLi9zc2ltLmpzJztcblxuZnVuY3Rpb24gVmlkZW9GcmFtZUNoZWNrZXIodmlkZW9FbGVtZW50KSB7XG4gIHRoaXMuZnJhbWVTdGF0cyA9IHtcbiAgICBudW1Gcm96ZW5GcmFtZXM6IDAsXG4gICAgbnVtQmxhY2tGcmFtZXM6IDAsXG4gICAgbnVtRnJhbWVzOiAwXG4gIH07XG5cbiAgdGhpcy5ydW5uaW5nXyA9IHRydWU7XG5cbiAgdGhpcy5ub25CbGFja1BpeGVsTHVtYVRocmVzaG9sZCA9IDIwO1xuICB0aGlzLnByZXZpb3VzRnJhbWVfID0gW107XG4gIHRoaXMuaWRlbnRpY2FsRnJhbWVTc2ltVGhyZXNob2xkID0gMC45ODU7XG4gIHRoaXMuZnJhbWVDb21wYXJhdG9yID0gbmV3IFNzaW0oKTtcblxuICB0aGlzLmNhbnZhc18gPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgdGhpcy52aWRlb0VsZW1lbnRfID0gdmlkZW9FbGVtZW50O1xuICB0aGlzLmxpc3RlbmVyXyA9IHRoaXMuY2hlY2tWaWRlb0ZyYW1lXy5iaW5kKHRoaXMpO1xuICB0aGlzLnZpZGVvRWxlbWVudF8uYWRkRXZlbnRMaXN0ZW5lcigncGxheScsIHRoaXMubGlzdGVuZXJfLCBmYWxzZSk7XG59XG5cblZpZGVvRnJhbWVDaGVja2VyLnByb3RvdHlwZSA9IHtcbiAgc3RvcDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy52aWRlb0VsZW1lbnRfLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3BsYXknICwgdGhpcy5saXN0ZW5lcl8pO1xuICAgIHRoaXMucnVubmluZ18gPSBmYWxzZTtcbiAgfSxcblxuICBnZXRDdXJyZW50SW1hZ2VEYXRhXzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5jYW52YXNfLndpZHRoID0gdGhpcy52aWRlb0VsZW1lbnRfLndpZHRoO1xuICAgIHRoaXMuY2FudmFzXy5oZWlnaHQgPSB0aGlzLnZpZGVvRWxlbWVudF8uaGVpZ2h0O1xuXG4gICAgdmFyIGNvbnRleHQgPSB0aGlzLmNhbnZhc18uZ2V0Q29udGV4dCgnMmQnKTtcbiAgICBjb250ZXh0LmRyYXdJbWFnZSh0aGlzLnZpZGVvRWxlbWVudF8sIDAsIDAsIHRoaXMuY2FudmFzXy53aWR0aCxcbiAgICAgICAgdGhpcy5jYW52YXNfLmhlaWdodCk7XG4gICAgcmV0dXJuIGNvbnRleHQuZ2V0SW1hZ2VEYXRhKDAsIDAsIHRoaXMuY2FudmFzXy53aWR0aCwgdGhpcy5jYW52YXNfLmhlaWdodCk7XG4gIH0sXG5cbiAgY2hlY2tWaWRlb0ZyYW1lXzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmdfKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLnZpZGVvRWxlbWVudF8uZW5kZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgaW1hZ2VEYXRhID0gdGhpcy5nZXRDdXJyZW50SW1hZ2VEYXRhXygpO1xuXG4gICAgaWYgKHRoaXMuaXNCbGFja0ZyYW1lXyhpbWFnZURhdGEuZGF0YSwgaW1hZ2VEYXRhLmRhdGEubGVuZ3RoKSkge1xuICAgICAgdGhpcy5mcmFtZVN0YXRzLm51bUJsYWNrRnJhbWVzKys7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZnJhbWVDb21wYXJhdG9yLmNhbGN1bGF0ZSh0aGlzLnByZXZpb3VzRnJhbWVfLCBpbWFnZURhdGEuZGF0YSkgPlxuICAgICAgICB0aGlzLmlkZW50aWNhbEZyYW1lU3NpbVRocmVzaG9sZCkge1xuICAgICAgdGhpcy5mcmFtZVN0YXRzLm51bUZyb3plbkZyYW1lcysrO1xuICAgIH1cbiAgICB0aGlzLnByZXZpb3VzRnJhbWVfID0gaW1hZ2VEYXRhLmRhdGE7XG5cbiAgICB0aGlzLmZyYW1lU3RhdHMubnVtRnJhbWVzKys7XG4gICAgc2V0VGltZW91dCh0aGlzLmNoZWNrVmlkZW9GcmFtZV8uYmluZCh0aGlzKSwgMjApO1xuICB9LFxuXG4gIGlzQmxhY2tGcmFtZV86IGZ1bmN0aW9uKGRhdGEsIGxlbmd0aCkge1xuICAgIC8vIFRPRE86IFVzZSBhIHN0YXRpc3RpY2FsLCBoaXN0b2dyYW0tYmFzZWQgZGV0ZWN0aW9uLlxuICAgIHZhciB0aHJlc2ggPSB0aGlzLm5vbkJsYWNrUGl4ZWxMdW1hVGhyZXNob2xkO1xuICAgIHZhciBhY2N1THVtYSA9IDA7XG4gICAgZm9yICh2YXIgaSA9IDQ7IGkgPCBsZW5ndGg7IGkgKz0gNCkge1xuICAgICAgLy8gVXNlIEx1bWEgYXMgaW4gUmVjLiA3MDk6IFnigLI3MDkgPSAwLjIxUiArIDAuNzJHICsgMC4wN0I7XG4gICAgICBhY2N1THVtYSArPSAwLjIxICogZGF0YVtpXSArIDAuNzIgKiBkYXRhW2kgKyAxXSArIDAuMDcgKiBkYXRhW2kgKyAyXTtcbiAgICAgIC8vIEVhcmx5IHRlcm1pbmF0aW9uIGlmIHRoZSBhdmVyYWdlIEx1bWEgc28gZmFyIGlzIGJyaWdodCBlbm91Z2guXG4gICAgICBpZiAoYWNjdUx1bWEgPiAodGhyZXNoICogaSAvIDQpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbn07XG5cbmlmICh0eXBlb2YgZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcbiAgbW9kdWxlLmV4cG9ydHMgPSBWaWRlb0ZyYW1lQ2hlY2tlcjtcbn1cbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IGFkYXB0ZXIgZnJvbSAnd2VicnRjLWFkYXB0ZXInO1xuaW1wb3J0IFJlcG9ydCBmcm9tICcuL3JlcG9ydC5qcyc7XG5pbXBvcnQgeyBlbnVtZXJhdGVTdGF0cyB9IGZyb20gJy4vdXRpbC5qcyc7XG5cbmNvbnN0IHJlcG9ydCA9IG5ldyBSZXBvcnQoKTtcblxuZnVuY3Rpb24gQ2FsbChjb25maWcsIHRlc3QpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy50cmFjZUV2ZW50ID0gcmVwb3J0LnRyYWNlRXZlbnRBc3luYygnY2FsbCcpO1xuICB0aGlzLnRyYWNlRXZlbnQoe2NvbmZpZzogY29uZmlnfSk7XG4gIHRoaXMuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG5cbiAgdGhpcy5wYzEgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnKTtcbiAgdGhpcy5wYzIgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnKTtcblxuICB0aGlzLnBjMS5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCB0aGlzLm9uSWNlQ2FuZGlkYXRlXy5iaW5kKHRoaXMsXG4gICAgICB0aGlzLnBjMikpO1xuICB0aGlzLnBjMi5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCB0aGlzLm9uSWNlQ2FuZGlkYXRlXy5iaW5kKHRoaXMsXG4gICAgICB0aGlzLnBjMSkpO1xuXG4gIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyA9IENhbGwubm9GaWx0ZXI7XG59XG5cbkNhbGwucHJvdG90eXBlID0ge1xuICBlc3RhYmxpc2hDb25uZWN0aW9uOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnQoe3N0YXRlOiAnc3RhcnQnfSk7XG4gICAgdGhpcy5wYzEuY3JlYXRlT2ZmZXIoKS50aGVuKFxuICAgICAgICB0aGlzLmdvdE9mZmVyXy5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpXG4gICAgKTtcbiAgfSxcblxuICBjbG9zZTogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50KHtzdGF0ZTogJ2VuZCd9KTtcbiAgICB0aGlzLnBjMS5jbG9zZSgpO1xuICAgIHRoaXMucGMyLmNsb3NlKCk7XG4gIH0sXG5cbiAgc2V0SWNlQ2FuZGlkYXRlRmlsdGVyOiBmdW5jdGlvbihmaWx0ZXIpIHtcbiAgICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8gPSBmaWx0ZXI7XG4gIH0sXG5cbiAgLy8gQ29uc3RyYWludCBtYXggdmlkZW8gYml0cmF0ZSBieSBtb2RpZnlpbmcgdGhlIFNEUCB3aGVuIGNyZWF0aW5nIGFuIGFuc3dlci5cbiAgY29uc3RyYWluVmlkZW9CaXRyYXRlOiBmdW5jdGlvbihtYXhWaWRlb0JpdHJhdGVLYnBzKSB7XG4gICAgdGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXyA9IG1heFZpZGVvQml0cmF0ZUticHM7XG4gIH0sXG5cbiAgLy8gUmVtb3ZlIHZpZGVvIEZFQyBpZiBhdmFpbGFibGUgb24gdGhlIG9mZmVyLlxuICBkaXNhYmxlVmlkZW9GZWM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY29uc3RyYWluT2ZmZXJUb1JlbW92ZVZpZGVvRmVjXyA9IHRydWU7XG4gIH0sXG5cbiAgLy8gV2hlbiB0aGUgcGVlckNvbm5lY3Rpb24gaXMgY2xvc2VkIHRoZSBzdGF0c0NiIGlzIGNhbGxlZCBvbmNlIHdpdGggYW4gYXJyYXlcbiAgLy8gb2YgZ2F0aGVyZWQgc3RhdHMuXG4gIGdhdGhlclN0YXRzOiBmdW5jdGlvbihwZWVyQ29ubmVjdGlvbixwZWVyQ29ubmVjdGlvbjIsIGxvY2FsU3RyZWFtLCBzdGF0c0NiKSB7XG4gICAgdmFyIHN0YXRzID0gW107XG4gICAgdmFyIHN0YXRzMiA9IFtdO1xuICAgIHZhciBzdGF0c0NvbGxlY3RUaW1lID0gW107XG4gICAgdmFyIHN0YXRzQ29sbGVjdFRpbWUyID0gW107XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBzdGF0U3RlcE1zID0gMTAwO1xuICAgIHNlbGYubG9jYWxUcmFja0lkcyA9IHtcbiAgICAgIGF1ZGlvOiAnJyxcbiAgICAgIHZpZGVvOiAnJ1xuICAgIH07XG4gICAgc2VsZi5yZW1vdGVUcmFja0lkcyA9IHtcbiAgICAgIGF1ZGlvOiAnJyxcbiAgICAgIHZpZGVvOiAnJ1xuICAgIH07XG5cbiAgICBwZWVyQ29ubmVjdGlvbi5nZXRTZW5kZXJzKCkuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgIGlmIChzZW5kZXIudHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICBzZWxmLmxvY2FsVHJhY2tJZHMuYXVkaW8gPSBzZW5kZXIudHJhY2suaWQ7XG4gICAgICB9IGVsc2UgaWYgKHNlbmRlci50cmFjay5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgIHNlbGYubG9jYWxUcmFja0lkcy52aWRlbyA9IHNlbmRlci50cmFjay5pZDtcbiAgICAgIH1cbiAgICB9LmJpbmQoc2VsZikpO1xuXG4gICAgaWYgKHBlZXJDb25uZWN0aW9uMikge1xuICAgICAgcGVlckNvbm5lY3Rpb24yLmdldFJlY2VpdmVycygpLmZvckVhY2goZnVuY3Rpb24ocmVjZWl2ZXIpIHtcbiAgICAgICAgaWYgKHJlY2VpdmVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzLmF1ZGlvID0gcmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgIH0gZWxzZSBpZiAocmVjZWl2ZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMudmlkZW8gPSByZWNlaXZlci50cmFjay5pZDtcbiAgICAgICAgfVxuICAgICAgfS5iaW5kKHNlbGYpKTtcbiAgICB9XG5cbiAgICB0aGlzLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IHRydWU7XG4gICAgZ2V0U3RhdHNfKCk7XG5cbiAgICBmdW5jdGlvbiBnZXRTdGF0c18oKSB7XG4gICAgICBpZiAocGVlckNvbm5lY3Rpb24uc2lnbmFsaW5nU3RhdGUgPT09ICdjbG9zZWQnKSB7XG4gICAgICAgIHNlbGYuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgIHN0YXRzQ2Ioc3RhdHMsIHN0YXRzQ29sbGVjdFRpbWUsIHN0YXRzMiwgc3RhdHNDb2xsZWN0VGltZTIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwZWVyQ29ubmVjdGlvbi5nZXRTdGF0cygpXG4gICAgICAgICAgLnRoZW4oZ290U3RhdHNfKVxuICAgICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgc2VsZi50ZXN0LnJlcG9ydEVycm9yKCdDb3VsZCBub3QgZ2F0aGVyIHN0YXRzOiAnICsgZXJyb3IpO1xuICAgICAgICAgICAgc2VsZi5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHN0YXRzQ2Ioc3RhdHMsIHN0YXRzQ29sbGVjdFRpbWUpO1xuICAgICAgICAgIH0uYmluZChzZWxmKSk7XG4gICAgICBpZiAocGVlckNvbm5lY3Rpb24yKSB7XG4gICAgICAgIHBlZXJDb25uZWN0aW9uMi5nZXRTdGF0cygpXG4gICAgICAgICAgICAudGhlbihnb3RTdGF0czJfKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gU3RhdHMgZm9yIHBjMiwgc29tZSBzdGF0cyBhcmUgb25seSBhdmFpbGFibGUgb24gdGhlIHJlY2VpdmluZyBlbmQgb2YgYVxuICAgIC8vIHBlZXJjb25uZWN0aW9uLlxuICAgIGZ1bmN0aW9uIGdvdFN0YXRzMl8ocmVzcG9uc2UpIHtcbiAgICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICAgIHZhciBlbnVtZXJhdGVkU3RhdHMgPSBlbnVtZXJhdGVTdGF0cyhyZXNwb25zZSwgc2VsZi5sb2NhbFRyYWNrSWRzLFxuICAgICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcyk7XG4gICAgICAgIHN0YXRzMi5wdXNoKGVudW1lcmF0ZWRTdGF0cyk7XG4gICAgICAgIHN0YXRzQ29sbGVjdFRpbWUyLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGZvciAodmFyIGggaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgICB2YXIgc3RhdCA9IHJlc3BvbnNlW2hdO1xuICAgICAgICAgIHN0YXRzMi5wdXNoKHN0YXQpO1xuICAgICAgICAgIHN0YXRzQ29sbGVjdFRpbWUyLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgJyArXG4gICAgICAgICAgICAnaW1wbGVtZW50YXRpb25zIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ290U3RhdHNfKHJlc3BvbnNlKSB7XG4gICAgICAvLyBUT0RPOiBSZW1vdmUgYnJvd3NlciBzcGVjaWZpYyBzdGF0cyBnYXRoZXJpbmcgaGFjayBvbmNlIGFkYXB0ZXIuanMgb3JcbiAgICAgIC8vIGJyb3dzZXJzIGNvbnZlcmdlIG9uIGEgc3RhbmRhcmQuXG4gICAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgICB2YXIgZW51bWVyYXRlZFN0YXRzID0gZW51bWVyYXRlU3RhdHMocmVzcG9uc2UsIHNlbGYubG9jYWxUcmFja0lkcyxcbiAgICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMpO1xuICAgICAgICBzdGF0cy5wdXNoKGVudW1lcmF0ZWRTdGF0cyk7XG4gICAgICAgIHN0YXRzQ29sbGVjdFRpbWUucHVzaChEYXRlLm5vdygpKTtcbiAgICAgIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgICAgZm9yICh2YXIgaiBpbiByZXNwb25zZSkge1xuICAgICAgICAgIHZhciBzdGF0ID0gcmVzcG9uc2Vbal07XG4gICAgICAgICAgc3RhdHMucHVzaChzdGF0KTtcbiAgICAgICAgICBzdGF0c0NvbGxlY3RUaW1lLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgJyArXG4gICAgICAgICAgICAnaW1wbGVtZW50YXRpb25zIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgICBzZXRUaW1lb3V0KGdldFN0YXRzXywgc3RhdFN0ZXBNcyk7XG4gICAgfVxuICB9LFxuXG4gIGdvdE9mZmVyXzogZnVuY3Rpb24ob2ZmZXIpIHtcbiAgICBpZiAodGhpcy5jb25zdHJhaW5PZmZlclRvUmVtb3ZlVmlkZW9GZWNfKSB7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvKG09dmlkZW8gMSBbXlxccl0rKSgxMTYgMTE3KShcXHJcXG4pL2csXG4gICAgICAgICAgJyQxXFxyXFxuJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6MTE2IHJlZFxcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDoxMTcgdWxwZmVjXFwvOTAwMDBcXHJcXG4vZywgJycpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjk4IHJ0eFxcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPWZtdHA6OTggYXB0PTExNlxcclxcbi9nLCAnJyk7XG4gICAgfVxuICAgIHRoaXMucGMxLnNldExvY2FsRGVzY3JpcHRpb24ob2ZmZXIpO1xuICAgIHRoaXMucGMyLnNldFJlbW90ZURlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICB0aGlzLnBjMi5jcmVhdGVBbnN3ZXIoKS50aGVuKFxuICAgICAgICB0aGlzLmdvdEFuc3dlcl8uYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KVxuICAgICk7XG4gIH0sXG5cbiAgZ290QW5zd2VyXzogZnVuY3Rpb24oYW5zd2VyKSB7XG4gICAgaWYgKHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18pIHtcbiAgICAgIGFuc3dlci5zZHAgPSBhbnN3ZXIuc2RwLnJlcGxhY2UoXG4gICAgICAgICAgL2E9bWlkOnZpZGVvXFxyXFxuL2csXG4gICAgICAgICAgJ2E9bWlkOnZpZGVvXFxyXFxuYj1BUzonICsgdGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXyArICdcXHJcXG4nKTtcbiAgICB9XG4gICAgdGhpcy5wYzIuc2V0TG9jYWxEZXNjcmlwdGlvbihhbnN3ZXIpO1xuICAgIHRoaXMucGMxLnNldFJlbW90ZURlc2NyaXB0aW9uKGFuc3dlcik7XG4gIH0sXG5cbiAgb25JY2VDYW5kaWRhdGVfOiBmdW5jdGlvbihvdGhlclBlZXIsIGV2ZW50KSB7XG4gICAgaWYgKGV2ZW50LmNhbmRpZGF0ZSkge1xuICAgICAgdmFyIHBhcnNlZCA9IENhbGwucGFyc2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSk7XG4gICAgICBpZiAodGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfKHBhcnNlZCkpIHtcbiAgICAgICAgb3RoZXJQZWVyLmFkZEljZUNhbmRpZGF0ZShldmVudC5jYW5kaWRhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuQ2FsbC5ub0ZpbHRlciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkNhbGwuaXNSZWxheSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgPT09ICdyZWxheSc7XG59O1xuXG5DYWxsLmlzTm90SG9zdENhbmRpZGF0ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgIT09ICdob3N0Jztcbn07XG5cbkNhbGwuaXNSZWZsZXhpdmUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAnc3JmbHgnO1xufTtcblxuQ2FsbC5pc0hvc3QgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAnaG9zdCc7XG59O1xuXG5DYWxsLmlzSXB2NiA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLmFkZHJlc3MuaW5kZXhPZignOicpICE9PSAtMTtcbn07XG5cbi8vIFBhcnNlIGEgJ2NhbmRpZGF0ZTonIGxpbmUgaW50byBhIEpTT04gb2JqZWN0LlxuQ2FsbC5wYXJzZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdmFyIGNhbmRpZGF0ZVN0ciA9ICdjYW5kaWRhdGU6JztcbiAgdmFyIHBvcyA9IHRleHQuaW5kZXhPZihjYW5kaWRhdGVTdHIpICsgY2FuZGlkYXRlU3RyLmxlbmd0aDtcbiAgdmFyIGZpZWxkcyA9IHRleHQuc3Vic3RyKHBvcykuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICAndHlwZSc6IGZpZWxkc1s3XSxcbiAgICAncHJvdG9jb2wnOiBmaWVsZHNbMl0sXG4gICAgJ2FkZHJlc3MnOiBmaWVsZHNbNF1cbiAgfTtcbn07XG5cbi8vIFN0b3JlIHRoZSBJQ0Ugc2VydmVyIHJlc3BvbnNlIGZyb20gdGhlIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuY2FjaGVkSWNlU2VydmVyc18gPSBudWxsO1xuLy8gS2VlcCB0cmFjayBvZiB3aGVuIHRoZSByZXF1ZXN0IHdhcyBtYWRlLlxuQ2FsbC5jYWNoZWRJY2VDb25maWdGZXRjaFRpbWVfID0gbnVsbDtcblxuLy8gR2V0IGEgVFVSTiBjb25maWcsIGVpdGhlciBmcm9tIHNldHRpbmdzIG9yIGZyb20gbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcgPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IsIGN1cnJlbnRUZXN0KSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICB2YXIgaWNlU2VydmVyID0ge1xuICAgICd1c2VybmFtZSc6IHNldHRpbmdzLnR1cm5Vc2VybmFtZSB8fCAnJyxcbiAgICAnY3JlZGVudGlhbCc6IHNldHRpbmdzLnR1cm5DcmVkZW50aWFsIHx8ICcnLFxuICAgICd1cmxzJzogc2V0dGluZ3MudHVyblVSSS5zcGxpdCgnLCcpXG4gIH07XG4gIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiBbaWNlU2VydmVyXX07XG4gIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgndHVybi1jb25maWcnLCBjb25maWcpO1xuICBzZXRUaW1lb3V0KG9uU3VjY2Vzcy5iaW5kKG51bGwsIGNvbmZpZyksIDApO1xufTtcblxuLy8gR2V0IGEgU1RVTiBjb25maWcsIGVpdGhlciBmcm9tIHNldHRpbmdzIG9yIGZyb20gbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5hc3luY0NyZWF0ZVN0dW5Db25maWcgPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgdmFyIHNldHRpbmdzID0gY3VycmVudFRlc3Quc2V0dGluZ3M7XG4gIHZhciBpY2VTZXJ2ZXIgPSB7XG4gICAgJ3VybHMnOiBzZXR0aW5ncy5zdHVuVVJJLnNwbGl0KCcsJylcbiAgfTtcbiAgdmFyIGNvbmZpZyA9IHsnaWNlU2VydmVycyc6IFtpY2VTZXJ2ZXJdfTtcbiAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCdzdHVuLWNvbmZpZycsIGNvbmZpZyk7XG4gIHNldFRpbWVvdXQob25TdWNjZXNzLmJpbmQobnVsbCwgY29uZmlnKSwgMCk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBDYWxsO1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4vKiBleHBvcnRlZCByZXBvcnQgKi9cbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gUmVwb3J0KCkge1xuICB0aGlzLm91dHB1dF8gPSBbXTtcbiAgdGhpcy5uZXh0QXN5bmNJZF8gPSAwO1xuXG4gIC8vIEhvb2sgY29uc29sZS5sb2cgaW50byB0aGUgcmVwb3J0LCBzaW5jZSB0aGF0IGlzIHRoZSBtb3N0IGNvbW1vbiBkZWJ1ZyB0b29sLlxuICB0aGlzLm5hdGl2ZUxvZ18gPSBjb25zb2xlLmxvZy5iaW5kKGNvbnNvbGUpO1xuICBjb25zb2xlLmxvZyA9IHRoaXMubG9nSG9va18uYmluZCh0aGlzKTtcblxuICAvLyBIb29rIHVwIHdpbmRvdy5vbmVycm9yIGxvZ3MgaW50byB0aGUgcmVwb3J0LlxuICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCB0aGlzLm9uV2luZG93RXJyb3JfLmJpbmQodGhpcykpO1xuXG4gIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ3N5c3RlbS1pbmZvJywgUmVwb3J0LmdldFN5c3RlbUluZm8oKSk7XG59XG5cblJlcG9ydC5wcm90b3R5cGUgPSB7XG4gIHRyYWNlRXZlbnRJbnN0YW50OiBmdW5jdGlvbihuYW1lLCBhcmdzKSB7XG4gICAgdGhpcy5vdXRwdXRfLnB1c2goeyd0cyc6IERhdGUubm93KCksXG4gICAgICAnbmFtZSc6IG5hbWUsXG4gICAgICAnYXJncyc6IGFyZ3N9KTtcbiAgfSxcblxuICB0cmFjZUV2ZW50V2l0aElkOiBmdW5jdGlvbihuYW1lLCBpZCwgYXJncykge1xuICAgIHRoaXMub3V0cHV0Xy5wdXNoKHsndHMnOiBEYXRlLm5vdygpLFxuICAgICAgJ25hbWUnOiBuYW1lLFxuICAgICAgJ2lkJzogaWQsXG4gICAgICAnYXJncyc6IGFyZ3N9KTtcbiAgfSxcblxuICB0cmFjZUV2ZW50QXN5bmM6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy50cmFjZUV2ZW50V2l0aElkLmJpbmQodGhpcywgbmFtZSwgdGhpcy5uZXh0QXN5bmNJZF8rKyk7XG4gIH0sXG5cbiAgbG9nVGVzdFJ1blJlc3VsdDogZnVuY3Rpb24odGVzdE5hbWUsIHN0YXR1cykge1xuICAgIC8vIEdvb2dsZSBBbmFseXRpY3MgZXZlbnQgZm9yIHRoZSB0ZXN0IHJlc3VsdCB0byBhbGxvdyB0byB0cmFjayBob3cgdGhlXG4gICAgLy8gdGVzdCBpcyBkb2luZyBpbiB0aGUgd2lsZC5cbiAgICBnYSgnc2VuZCcsIHtcbiAgICAgICdoaXRUeXBlJzogJ2V2ZW50JyxcbiAgICAgICdldmVudENhdGVnb3J5JzogJ1Rlc3QnLFxuICAgICAgJ2V2ZW50QWN0aW9uJzogc3RhdHVzLFxuICAgICAgJ2V2ZW50TGFiZWwnOiB0ZXN0TmFtZSxcbiAgICAgICdub25JbnRlcmFjdGlvbic6IDFcbiAgICB9KTtcbiAgfSxcblxuICBnZW5lcmF0ZTogZnVuY3Rpb24oYnVnRGVzY3JpcHRpb24pIHtcbiAgICB2YXIgaGVhZGVyID0geyd0aXRsZSc6ICdXZWJSVEMgVHJvdWJsZXNob290ZXIgYnVnIHJlcG9ydCcsXG4gICAgICAnZGVzY3JpcHRpb24nOiBidWdEZXNjcmlwdGlvbiB8fCBudWxsfTtcbiAgICByZXR1cm4gdGhpcy5nZXRDb250ZW50XyhoZWFkZXIpO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGxvZ3MgaW50byBhIEpTT04gZm9ybWF0ZWQgc3RyaW5nIHRoYXQgaXMgYSBsaXN0IG9mIGV2ZW50c1xuICAvLyBzaW1pbGFyIHRvIHRoZSB3YXkgY2hyb21lIGRldnRvb2xzIGZvcm1hdCB1c2VzLiBUaGUgZmluYWwgc3RyaW5nIGlzXG4gIC8vIG1hbnVhbGx5IGNvbXBvc2VkIHRvIGhhdmUgbmV3bGluZXMgYmV0d2VlbiB0aGUgZW50cmllcyBpcyBiZWluZyBlYXNpZXJcbiAgLy8gdG8gcGFyc2UgYnkgaHVtYW4gZXllcy4gSWYgYSBjb250ZW50SGVhZCBvYmplY3QgYXJndW1lbnQgaXMgcHJvdmlkZWQgaXRcbiAgLy8gd2lsbCBiZSBhZGRlZCBhdCB0aGUgdG9wIG9mIHRoZSBsb2cgZmlsZS5cbiAgZ2V0Q29udGVudF86IGZ1bmN0aW9uKGNvbnRlbnRIZWFkKSB7XG4gICAgdmFyIHN0cmluZ0FycmF5ID0gW107XG4gICAgdGhpcy5hcHBlbmRFdmVudHNBc1N0cmluZ18oW2NvbnRlbnRIZWFkXSB8fCBbXSwgc3RyaW5nQXJyYXkpO1xuICAgIHRoaXMuYXBwZW5kRXZlbnRzQXNTdHJpbmdfKHRoaXMub3V0cHV0Xywgc3RyaW5nQXJyYXkpO1xuICAgIHJldHVybiAnWycgKyBzdHJpbmdBcnJheS5qb2luKCcsXFxuJykgKyAnXSc7XG4gIH0sXG5cbiAgYXBwZW5kRXZlbnRzQXNTdHJpbmdfOiBmdW5jdGlvbihldmVudHMsIG91dHB1dCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpICE9PSBldmVudHMubGVuZ3RoOyArK2kpIHtcbiAgICAgIG91dHB1dC5wdXNoKEpTT04uc3RyaW5naWZ5KGV2ZW50c1tpXSkpO1xuICAgIH1cbiAgfSxcblxuICBvbldpbmRvd0Vycm9yXzogZnVuY3Rpb24oZXJyb3IpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnRJbnN0YW50KCdlcnJvcicsIHsnbWVzc2FnZSc6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAnZmlsZW5hbWUnOiBlcnJvci5maWxlbmFtZSArICc6JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3IubGluZW5vfSk7XG4gIH0sXG5cbiAgbG9nSG9va186IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ2xvZycsIGFyZ3VtZW50cyk7XG4gICAgdGhpcy5uYXRpdmVMb2dfLmFwcGx5KG51bGwsIGFyZ3VtZW50cyk7XG4gIH1cbn07XG5cbi8qXG4gKiBEZXRlY3RzIHRoZSBydW5uaW5nIGJyb3dzZXIgbmFtZSwgdmVyc2lvbiBhbmQgcGxhdGZvcm0uXG4gKi9cblJlcG9ydC5nZXRTeXN0ZW1JbmZvID0gZnVuY3Rpb24oKSB7XG4gIC8vIENvZGUgaW5zcGlyZWQgYnkgaHR0cDovL2dvby5nbC85ZFpacUUgd2l0aFxuICAvLyBhZGRlZCBzdXBwb3J0IG9mIG1vZGVybiBJbnRlcm5ldCBFeHBsb3JlciB2ZXJzaW9ucyAoVHJpZGVudCkuXG4gIHZhciBhZ2VudCA9IG5hdmlnYXRvci51c2VyQWdlbnQ7XG4gIHZhciBicm93c2VyTmFtZSA9IG5hdmlnYXRvci5hcHBOYW1lO1xuICB2YXIgdmVyc2lvbiA9ICcnICsgcGFyc2VGbG9hdChuYXZpZ2F0b3IuYXBwVmVyc2lvbik7XG4gIHZhciBvZmZzZXROYW1lO1xuICB2YXIgb2Zmc2V0VmVyc2lvbjtcbiAgdmFyIGl4O1xuXG4gIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ0Nocm9tZScpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdDaHJvbWUnO1xuICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDcpO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignTVNJRScpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInOyAvLyBPbGRlciBJRSB2ZXJzaW9ucy5cbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyA1KTtcbiAgfSBlbHNlIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ1RyaWRlbnQnKSkgIT09IC0xKSB7XG4gICAgYnJvd3Nlck5hbWUgPSAnTWljcm9zb2Z0IEludGVybmV0IEV4cGxvcmVyJzsgLy8gTmV3ZXIgSUUgdmVyc2lvbnMuXG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgOCk7XG4gIH0gZWxzZSBpZiAoKG9mZnNldFZlcnNpb24gPSBhZ2VudC5pbmRleE9mKCdGaXJlZm94JykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ0ZpcmVmb3gnO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignU2FmYXJpJykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ1NhZmFyaSc7XG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgNyk7XG4gICAgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignVmVyc2lvbicpKSAhPT0gLTEpIHtcbiAgICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDgpO1xuICAgIH1cbiAgfSBlbHNlIGlmICgob2Zmc2V0TmFtZSA9IGFnZW50Lmxhc3RJbmRleE9mKCcgJykgKyAxKSA8XG4gICAgICAgICAgICAgIChvZmZzZXRWZXJzaW9uID0gYWdlbnQubGFzdEluZGV4T2YoJy8nKSkpIHtcbiAgICAvLyBGb3Igb3RoZXIgYnJvd3NlcnMgJ25hbWUvdmVyc2lvbicgaXMgYXQgdGhlIGVuZCBvZiB1c2VyQWdlbnRcbiAgICBicm93c2VyTmFtZSA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXROYW1lLCBvZmZzZXRWZXJzaW9uKTtcbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyAxKTtcbiAgICBpZiAoYnJvd3Nlck5hbWUudG9Mb3dlckNhc2UoKSA9PT0gYnJvd3Nlck5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgYnJvd3Nlck5hbWUgPSBuYXZpZ2F0b3IuYXBwTmFtZTtcbiAgICB9XG4gIH0gLy8gVHJpbSB0aGUgdmVyc2lvbiBzdHJpbmcgYXQgc2VtaWNvbG9uL3NwYWNlIGlmIHByZXNlbnQuXG4gIGlmICgoaXggPSB2ZXJzaW9uLmluZGV4T2YoJzsnKSkgIT09IC0xKSB7XG4gICAgdmVyc2lvbiA9IHZlcnNpb24uc3Vic3RyaW5nKDAsIGl4KTtcbiAgfVxuICBpZiAoKGl4ID0gdmVyc2lvbi5pbmRleE9mKCcgJykpICE9PSAtMSkge1xuICAgIHZlcnNpb24gPSB2ZXJzaW9uLnN1YnN0cmluZygwLCBpeCk7XG4gIH1cbiAgcmV0dXJuIHsnYnJvd3Nlck5hbWUnOiBicm93c2VyTmFtZSxcbiAgICAnYnJvd3NlclZlcnNpb24nOiB2ZXJzaW9uLFxuICAgICdwbGF0Zm9ybSc6IG5hdmlnYXRvci5wbGF0Zm9ybX07XG59O1xuXG5leHBvcnQgZGVmYXVsdCBSZXBvcnQ7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcblxuLyogVGhpcyBpcyBhbiBpbXBsZW1lbnRhdGlvbiBvZiB0aGUgYWxnb3JpdGhtIGZvciBjYWxjdWxhdGluZyB0aGUgU3RydWN0dXJhbFxuICogU0lNaWxhcml0eSAoU1NJTSkgaW5kZXggYmV0d2VlbiB0d28gaW1hZ2VzLiBQbGVhc2UgcmVmZXIgdG8gdGhlIGFydGljbGUgWzFdLFxuICogdGhlIHdlYnNpdGUgWzJdIGFuZC9vciB0aGUgV2lraXBlZGlhIGFydGljbGUgWzNdLiBUaGlzIGNvZGUgdGFrZXMgdGhlIHZhbHVlXG4gKiBvZiB0aGUgY29uc3RhbnRzIEMxIGFuZCBDMiBmcm9tIHRoZSBNYXRsYWIgaW1wbGVtZW50YXRpb24gaW4gWzRdLlxuICpcbiAqIFsxXSBaLiBXYW5nLCBBLiBDLiBCb3ZpaywgSC4gUi4gU2hlaWtoLCBhbmQgRS4gUC4gU2ltb25jZWxsaSwgXCJJbWFnZSBxdWFsaXR5XG4gKiBhc3Nlc3NtZW50OiBGcm9tIGVycm9yIG1lYXN1cmVtZW50IHRvIHN0cnVjdHVyYWwgc2ltaWxhcml0eVwiLFxuICogSUVFRSBUcmFuc2FjdGlvbnMgb24gSW1hZ2UgUHJvY2Vzc2luZywgdm9sLiAxMywgbm8uIDEsIEphbi4gMjAwNC5cbiAqIFsyXSBodHRwOi8vd3d3LmNucy5ueXUuZWR1L35sY3Yvc3NpbS9cbiAqIFszXSBodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1N0cnVjdHVyYWxfc2ltaWxhcml0eVxuICogWzRdIGh0dHA6Ly93d3cuY25zLm55dS5lZHUvfmxjdi9zc2ltL3NzaW1faW5kZXgubVxuICovXG5cbmZ1bmN0aW9uIFNzaW0oKSB7fVxuXG5Tc2ltLnByb3RvdHlwZSA9IHtcbiAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuMiwgYSBzaW1wbGUgYXZlcmFnZSBvZiBhIHZlY3RvciBhbmQgRXEuNC4sIGV4Y2VwdCB0aGVcbiAgLy8gc3F1YXJlIHJvb3QuIFRoZSBsYXR0ZXIgaXMgYWN0dWFsbHkgYW4gdW5iaWFzZWQgZXN0aW1hdGUgb2YgdGhlIHZhcmlhbmNlLFxuICAvLyBub3QgdGhlIGV4YWN0IHZhcmlhbmNlLlxuICBzdGF0aXN0aWNzOiBmdW5jdGlvbihhKSB7XG4gICAgdmFyIGFjY3UgPSAwO1xuICAgIHZhciBpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBhLmxlbmd0aDsgKytpKSB7XG4gICAgICBhY2N1ICs9IGFbaV07XG4gICAgfVxuICAgIHZhciBtZWFuQSA9IGFjY3UgLyAoYS5sZW5ndGggLSAxKTtcbiAgICB2YXIgZGlmZiA9IDA7XG4gICAgZm9yIChpID0gMTsgaSA8IGEubGVuZ3RoOyArK2kpIHtcbiAgICAgIGRpZmYgPSBhW2kgLSAxXSAtIG1lYW5BO1xuICAgICAgYWNjdSArPSBhW2ldICsgKGRpZmYgKiBkaWZmKTtcbiAgICB9XG4gICAgcmV0dXJuIHttZWFuOiBtZWFuQSwgdmFyaWFuY2U6IGFjY3UgLyBhLmxlbmd0aH07XG4gIH0sXG5cbiAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuMTEuLCBjb3YoWSwgWikgPSBFKChZIC0gdVkpLCAoWiAtIHVaKSkuXG4gIGNvdmFyaWFuY2U6IGZ1bmN0aW9uKGEsIGIsIG1lYW5BLCBtZWFuQikge1xuICAgIHZhciBhY2N1ID0gMDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGEubGVuZ3RoOyBpICs9IDEpIHtcbiAgICAgIGFjY3UgKz0gKGFbaV0gLSBtZWFuQSkgKiAoYltpXSAtIG1lYW5CKTtcbiAgICB9XG4gICAgcmV0dXJuIGFjY3UgLyBhLmxlbmd0aDtcbiAgfSxcblxuICBjYWxjdWxhdGU6IGZ1bmN0aW9uKHgsIHkpIHtcbiAgICBpZiAoeC5sZW5ndGggIT09IHkubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG5cbiAgICAvLyBWYWx1ZXMgb2YgdGhlIGNvbnN0YW50cyBjb21lIGZyb20gdGhlIE1hdGxhYiBjb2RlIHJlZmVycmVkIGJlZm9yZS5cbiAgICB2YXIgSzEgPSAwLjAxO1xuICAgIHZhciBLMiA9IDAuMDM7XG4gICAgdmFyIEwgPSAyNTU7XG4gICAgdmFyIEMxID0gKEsxICogTCkgKiAoSzEgKiBMKTtcbiAgICB2YXIgQzIgPSAoSzIgKiBMKSAqIChLMiAqIEwpO1xuICAgIHZhciBDMyA9IEMyIC8gMjtcblxuICAgIHZhciBzdGF0c1ggPSB0aGlzLnN0YXRpc3RpY3MoeCk7XG4gICAgdmFyIG11WCA9IHN0YXRzWC5tZWFuO1xuICAgIHZhciBzaWdtYVgyID0gc3RhdHNYLnZhcmlhbmNlO1xuICAgIHZhciBzaWdtYVggPSBNYXRoLnNxcnQoc2lnbWFYMik7XG4gICAgdmFyIHN0YXRzWSA9IHRoaXMuc3RhdGlzdGljcyh5KTtcbiAgICB2YXIgbXVZID0gc3RhdHNZLm1lYW47XG4gICAgdmFyIHNpZ21hWTIgPSBzdGF0c1kudmFyaWFuY2U7XG4gICAgdmFyIHNpZ21hWSA9IE1hdGguc3FydChzaWdtYVkyKTtcbiAgICB2YXIgc2lnbWFYeSA9IHRoaXMuY292YXJpYW5jZSh4LCB5LCBtdVgsIG11WSk7XG5cbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS42LlxuICAgIHZhciBsdW1pbmFuY2UgPSAoMiAqIG11WCAqIG11WSArIEMxKSAvXG4gICAgICAgICgobXVYICogbXVYKSArIChtdVkgKiBtdVkpICsgQzEpO1xuICAgIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjEwLlxuICAgIHZhciBzdHJ1Y3R1cmUgPSAoc2lnbWFYeSArIEMzKSAvIChzaWdtYVggKiBzaWdtYVkgKyBDMyk7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuOS5cbiAgICB2YXIgY29udHJhc3QgPSAoMiAqIHNpZ21hWCAqIHNpZ21hWSArIEMyKSAvIChzaWdtYVgyICsgc2lnbWFZMiArIEMyKTtcblxuICAgIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjEyLlxuICAgIHJldHVybiBsdW1pbmFuY2UgKiBjb250cmFzdCAqIHN0cnVjdHVyZTtcbiAgfVxufTtcblxuaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFNzaW07XG59XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gU3RhdGlzdGljc0FnZ3JlZ2F0ZShyYW1wVXBUaHJlc2hvbGQpIHtcbiAgdGhpcy5zdGFydFRpbWVfID0gMDtcbiAgdGhpcy5zdW1fID0gMDtcbiAgdGhpcy5jb3VudF8gPSAwO1xuICB0aGlzLm1heF8gPSAwO1xuICB0aGlzLnJhbXBVcFRocmVzaG9sZF8gPSByYW1wVXBUaHJlc2hvbGQ7XG4gIHRoaXMucmFtcFVwVGltZV8gPSBJbmZpbml0eTtcbn1cblxuU3RhdGlzdGljc0FnZ3JlZ2F0ZS5wcm90b3R5cGUgPSB7XG4gIGFkZDogZnVuY3Rpb24odGltZSwgZGF0YXBvaW50KSB7XG4gICAgaWYgKHRoaXMuc3RhcnRUaW1lXyA9PT0gMCkge1xuICAgICAgdGhpcy5zdGFydFRpbWVfID0gdGltZTtcbiAgICB9XG4gICAgdGhpcy5zdW1fICs9IGRhdGFwb2ludDtcbiAgICB0aGlzLm1heF8gPSBNYXRoLm1heCh0aGlzLm1heF8sIGRhdGFwb2ludCk7XG4gICAgaWYgKHRoaXMucmFtcFVwVGltZV8gPT09IEluZmluaXR5ICYmXG4gICAgICAgIGRhdGFwb2ludCA+IHRoaXMucmFtcFVwVGhyZXNob2xkXykge1xuICAgICAgdGhpcy5yYW1wVXBUaW1lXyA9IHRpbWU7XG4gICAgfVxuICAgIHRoaXMuY291bnRfKys7XG4gIH0sXG5cbiAgZ2V0QXZlcmFnZTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY291bnRfID09PSAwKSB7XG4gICAgICByZXR1cm4gMDtcbiAgICB9XG4gICAgcmV0dXJuIE1hdGgucm91bmQodGhpcy5zdW1fIC8gdGhpcy5jb3VudF8pO1xuICB9LFxuXG4gIGdldE1heDogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMubWF4XztcbiAgfSxcblxuICBnZXRSYW1wVXBUaW1lOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gTWF0aC5yb3VuZCh0aGlzLnJhbXBVcFRpbWVfIC0gdGhpcy5zdGFydFRpbWVfKTtcbiAgfSxcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFN0YXRpc3RpY3NBZ2dyZWdhdGU7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0Jztcbi8qIGV4cG9ydGVkIGFycmF5QXZlcmFnZSwgYXJyYXlNYXgsIGFycmF5TWluLCBlbnVtZXJhdGVTdGF0cyAqL1xuXG4vLyBhcnJheTxmdW5jdGlvbj4gcmV0dXJucyB0aGUgYXZlcmFnZSAoZG93biB0byBuZWFyZXN0IGludCksIG1heCBhbmQgbWluIG9mXG4vLyBhbiBpbnQgYXJyYXkuXG5leHBvcnQgZnVuY3Rpb24gYXJyYXlBdmVyYWdlKGFycmF5KSB7XG4gIHZhciBjbnQgPSBhcnJheS5sZW5ndGg7XG4gIHZhciB0b3QgPSAwO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGNudDsgaSsrKSB7XG4gICAgdG90ICs9IGFycmF5W2ldO1xuICB9XG4gIHJldHVybiBNYXRoLmZsb29yKHRvdCAvIGNudCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcnJheU1heChhcnJheSkge1xuICBpZiAoYXJyYXkubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIE5hTjtcbiAgfVxuICByZXR1cm4gTWF0aC5tYXguYXBwbHkoTWF0aCwgYXJyYXkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXJyYXlNaW4oYXJyYXkpIHtcbiAgaWYgKGFycmF5Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBOYU47XG4gIH1cbiAgcmV0dXJuIE1hdGgubWluLmFwcGx5KE1hdGgsIGFycmF5KTtcbn1cblxuLy8gRW51bWVyYXRlcyB0aGUgbmV3IHN0YW5kYXJkIGNvbXBsaWFudCBzdGF0cyB1c2luZyBsb2NhbCBhbmQgcmVtb3RlIHRyYWNrIGlkcy5cbmV4cG9ydCBmdW5jdGlvbiBlbnVtZXJhdGVTdGF0cyhzdGF0cywgbG9jYWxUcmFja0lkcywgcmVtb3RlVHJhY2tJZHMpIHtcbiAgLy8gQ3JlYXRlIGFuIG9iamVjdCBzdHJ1Y3R1cmUgd2l0aCBhbGwgdGhlIG5lZWRlZCBzdGF0cyBhbmQgdHlwZXMgdGhhdCB3ZSBjYXJlXG4gIC8vIGFib3V0LiBUaGlzIGFsbG93cyB0byBtYXAgdGhlIGdldFN0YXRzIHN0YXRzIHRvIG90aGVyIHN0YXRzIG5hbWVzLlxuICB2YXIgc3RhdHNPYmplY3QgPSB7XG4gICAgYXVkaW86IHtcbiAgICAgIGxvY2FsOiB7XG4gICAgICAgIGF1ZGlvTGV2ZWw6IDAuMCxcbiAgICAgICAgYnl0ZXNTZW50OiAwLFxuICAgICAgICBjbG9ja1JhdGU6IDAsXG4gICAgICAgIGNvZGVjSWQ6ICcnLFxuICAgICAgICBtaW1lVHlwZTogJycsXG4gICAgICAgIHBhY2tldHNTZW50OiAwLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICAgIHRyYWNrSWQ6ICcnLFxuICAgICAgICB0cmFuc3BvcnRJZDogJycsXG4gICAgICB9LFxuICAgICAgcmVtb3RlOiB7XG4gICAgICAgIGF1ZGlvTGV2ZWw6IDAuMCxcbiAgICAgICAgYnl0ZXNSZWNlaXZlZDogMCxcbiAgICAgICAgY2xvY2tSYXRlOiAwLFxuICAgICAgICBjb2RlY0lkOiAnJyxcbiAgICAgICAgZnJhY3Rpb25Mb3N0OiAwLFxuICAgICAgICBqaXR0ZXI6IDAsXG4gICAgICAgIG1pbWVUeXBlOiAnJyxcbiAgICAgICAgcGFja2V0c0xvc3Q6IC0xLFxuICAgICAgICBwYWNrZXRzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIHBheWxvYWRUeXBlOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH1cbiAgICB9LFxuICAgIHZpZGVvOiB7XG4gICAgICBsb2NhbDoge1xuICAgICAgICBieXRlc1NlbnQ6IDAsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIGZpckNvdW50OiAwLFxuICAgICAgICBmcmFtZXNFbmNvZGVkOiAwLFxuICAgICAgICBmcmFtZUhlaWdodDogMCxcbiAgICAgICAgZnJhbWVzU2VudDogLTEsXG4gICAgICAgIGZyYW1lV2lkdGg6IDAsXG4gICAgICAgIG5hY2tDb3VudDogMCxcbiAgICAgICAgcGFja2V0c1NlbnQ6IC0xLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgcGxpQ291bnQ6IDAsXG4gICAgICAgIHFwU3VtOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH0sXG4gICAgICByZW1vdGU6IHtcbiAgICAgICAgYnl0ZXNSZWNlaXZlZDogLTEsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIGZpckNvdW50OiAtMSxcbiAgICAgICAgZnJhY3Rpb25Mb3N0OiAwLFxuICAgICAgICBmcmFtZUhlaWdodDogMCxcbiAgICAgICAgZnJhbWVzRGVjb2RlZDogMCxcbiAgICAgICAgZnJhbWVzRHJvcHBlZDogMCxcbiAgICAgICAgZnJhbWVzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIGZyYW1lV2lkdGg6IDAsXG4gICAgICAgIG5hY2tDb3VudDogLTEsXG4gICAgICAgIHBhY2tldHNMb3N0OiAtMSxcbiAgICAgICAgcGFja2V0c1JlY2VpdmVkOiAwLFxuICAgICAgICBwYXlsb2FkVHlwZTogMCxcbiAgICAgICAgcGxpQ291bnQ6IC0xLFxuICAgICAgICBxcFN1bTogMCxcbiAgICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICAgIHRyYWNrSWQ6ICcnLFxuICAgICAgICB0cmFuc3BvcnRJZDogJycsXG4gICAgICB9XG4gICAgfSxcbiAgICBjb25uZWN0aW9uOiB7XG4gICAgICBhdmFpbGFibGVPdXRnb2luZ0JpdHJhdGU6IDAsXG4gICAgICBieXRlc1JlY2VpdmVkOiAwLFxuICAgICAgYnl0ZXNTZW50OiAwLFxuICAgICAgY29uc2VudFJlcXVlc3RzU2VudDogMCxcbiAgICAgIGN1cnJlbnRSb3VuZFRyaXBUaW1lOiAwLjAsXG4gICAgICBsb2NhbENhbmRpZGF0ZUlkOiAnJyxcbiAgICAgIGxvY2FsQ2FuZGlkYXRlVHlwZTogJycsXG4gICAgICBsb2NhbElwOiAnJyxcbiAgICAgIGxvY2FsUG9ydDogMCxcbiAgICAgIGxvY2FsUHJpb3JpdHk6IDAsXG4gICAgICBsb2NhbFByb3RvY29sOiAnJyxcbiAgICAgIHJlbW90ZUNhbmRpZGF0ZUlkOiAnJyxcbiAgICAgIHJlbW90ZUNhbmRpZGF0ZVR5cGU6ICcnLFxuICAgICAgcmVtb3RlSXA6ICcnLFxuICAgICAgcmVtb3RlUG9ydDogMCxcbiAgICAgIHJlbW90ZVByaW9yaXR5OiAwLFxuICAgICAgcmVtb3RlUHJvdG9jb2w6ICcnLFxuICAgICAgcmVxdWVzdHNSZWNlaXZlZDogMCxcbiAgICAgIHJlcXVlc3RzU2VudDogMCxcbiAgICAgIHJlc3BvbnNlc1JlY2VpdmVkOiAwLFxuICAgICAgcmVzcG9uc2VzU2VudDogMCxcbiAgICAgIHRpbWVzdGFtcDogMC4wLFxuICAgICAgdG90YWxSb3VuZFRyaXBUaW1lOiAwLjAsXG4gICAgfVxuICB9O1xuXG4gIC8vIE5lZWQgdG8gZmluZCB0aGUgY29kZWMsIGxvY2FsIGFuZCByZW1vdGUgSUQncyBmaXJzdC5cbiAgaWYgKHN0YXRzKSB7XG4gICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihyZXBvcnQsIHN0YXQpIHtcbiAgICAgIHN3aXRjaChyZXBvcnQudHlwZSkge1xuICAgICAgICBjYXNlICdvdXRib3VuZC1ydHAnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YobG9jYWxUcmFja0lkcy5hdWRpbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwucGFja2V0c1NlbnQgPSByZXBvcnQucGFja2V0c1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnRpbWVzdGFtcCA9IHJlcG9ydC50aW1lc3RhbXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwudHJhbnNwb3J0SWQgPSByZXBvcnQudHJhbnNwb3J0SWQ7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YobG9jYWxUcmFja0lkcy52aWRlbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZmlyQ291bnQgPSByZXBvcnQuZmlyQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmZyYW1lc0VuY29kZWQgPSByZXBvcnQuZnJhbWVzRW5jb2RlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzU2VudCA9IHJlcG9ydC5mcmFtZXNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wYWNrZXRzU2VudCA9IHJlcG9ydC5wYWNrZXRzU2VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwucGxpQ291bnQgPSByZXBvcnQucGxpQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnFwU3VtID0gcmVwb3J0LnFwU3VtO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC50cmFja0lkID0gcmVwb3J0LnRyYWNrSWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnaW5ib3VuZC1ydHAnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YocmVtb3RlVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmJ5dGVzUmVjZWl2ZWQgPSByZXBvcnQuYnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmZyYWN0aW9uTG9zdCA9IHJlcG9ydC5mcmFjdGlvbkxvc3Q7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5qaXR0ZXIgPSByZXBvcnQuaml0dGVyO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUucGFja2V0c0xvc3QgPSByZXBvcnQucGFja2V0c0xvc3Q7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5wYWNrZXRzUmVjZWl2ZWQgPSByZXBvcnQucGFja2V0c1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkLmluZGV4T2YocmVtb3RlVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy52aWRlbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmJ5dGVzUmVjZWl2ZWQgPSByZXBvcnQuYnl0ZXNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmNvZGVjSWQgPSByZXBvcnQuY29kZWNJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZpckNvdW50ID0gcmVwb3J0LmZpckNvdW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhY3Rpb25Mb3N0ID0gcmVwb3J0LmZyYWN0aW9uTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLm5hY2tDb3VudCA9IHJlcG9ydC5uYWNrQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wYWNrZXRzTG9zdCA9IHJlcG9ydC5wYWNrZXRzTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnBhY2tldHNSZWNlaXZlZCA9IHJlcG9ydC5wYWNrZXRzUmVjZWl2ZWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wbGlDb3VudCA9IHJlcG9ydC5wbGlDb3VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnFwU3VtID0gcmVwb3J0LnFwU3VtO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnRyYW5zcG9ydElkID0gcmVwb3J0LnRyYW5zcG9ydElkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnY2FuZGlkYXRlLXBhaXInOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2F2YWlsYWJsZU91dGdvaW5nQml0cmF0ZScpKSB7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZSA9XG4gICAgICAgICAgICAgICAgcmVwb3J0LmF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZTtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uYnl0ZXNSZWNlaXZlZCA9IHJlcG9ydC5ieXRlc1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5ieXRlc1NlbnQgPSByZXBvcnQuYnl0ZXNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5jb25zZW50UmVxdWVzdHNTZW50ID1cbiAgICAgICAgICAgICAgICByZXBvcnQuY29uc2VudFJlcXVlc3RzU2VudDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uY3VycmVudFJvdW5kVHJpcFRpbWUgPVxuICAgICAgICAgICAgICAgIHJlcG9ydC5jdXJyZW50Um91bmRUcmlwVGltZTtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxDYW5kaWRhdGVJZCA9IHJlcG9ydC5sb2NhbENhbmRpZGF0ZUlkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVDYW5kaWRhdGVJZCA9IHJlcG9ydC5yZW1vdGVDYW5kaWRhdGVJZDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVxdWVzdHNSZWNlaXZlZCA9IHJlcG9ydC5yZXF1ZXN0c1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXF1ZXN0c1NlbnQgPSByZXBvcnQucmVxdWVzdHNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXNwb25zZXNSZWNlaXZlZCA9IHJlcG9ydC5yZXNwb25zZXNSZWNlaXZlZDtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVzcG9uc2VzU2VudCA9IHJlcG9ydC5yZXNwb25zZXNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi50b3RhbFJvdW5kVHJpcFRpbWUgPVxuICAgICAgICAgICAgICAgcmVwb3J0LnRvdGFsUm91bmRUcmlwVGltZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0uYmluZCgpKTtcblxuICAgIC8vIFVzaW5nIHRoZSBjb2RlYywgbG9jYWwgYW5kIHJlbW90ZSBjYW5kaWRhdGUgSUQncyB0byBmaW5kIHRoZSByZXN0IG9mIHRoZVxuICAgIC8vIHJlbGV2YW50IHN0YXRzLlxuICAgIHN0YXRzLmZvckVhY2goZnVuY3Rpb24ocmVwb3J0KSB7XG4gICAgICBzd2l0Y2gocmVwb3J0LnR5cGUpIHtcbiAgICAgICAgY2FzZSAndHJhY2snOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ3RyYWNrSWRlbnRpZmllcicpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKGxvY2FsVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICBsb2NhbFRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZUhlaWdodCA9IHJlcG9ydC5mcmFtZUhlaWdodDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzU2VudCA9IHJlcG9ydC5mcmFtZXNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZVdpZHRoID0gcmVwb3J0LmZyYW1lV2lkdGg7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKHJlbW90ZVRyYWNrSWRzLnZpZGVvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgcmVtb3RlVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5mcmFtZUhlaWdodCA9IHJlcG9ydC5mcmFtZUhlaWdodDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc0RlY29kZWQgPSByZXBvcnQuZnJhbWVzRGVjb2RlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc0Ryb3BwZWQgPSByZXBvcnQuZnJhbWVzRHJvcHBlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lc1JlY2VpdmVkID0gcmVwb3J0LmZyYW1lc1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhbWVXaWR0aCA9IHJlcG9ydC5mcmFtZVdpZHRoO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkZW50aWZpZXIuaW5kZXhPZihsb2NhbFRyYWNrSWRzLmF1ZGlvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuYXVkaW9MZXZlbCA9IHJlcG9ydC5hdWRpb0xldmVsIDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQudHJhY2tJZGVudGlmaWVyLmluZGV4T2YocmVtb3RlVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmF1ZGlvTGV2ZWwgPSByZXBvcnQuYXVkaW9MZXZlbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2NvZGVjJzpcbiAgICAgICAgICBpZiAocmVwb3J0Lmhhc093blByb3BlcnR5KCdpZCcpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2Yoc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLmNsb2NrUmF0ZSA9IHJlcG9ydC5jbG9ja1JhdGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5sb2NhbC5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLmF1ZGlvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUucGF5bG9hZFR5cGUgPSByZXBvcnQucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2Yoc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmNsb2NrUmF0ZSA9IHJlcG9ydC5jbG9ja1JhdGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY29kZWNJZCkgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLm1pbWVUeXBlID0gcmVwb3J0Lm1pbWVUeXBlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUucGF5bG9hZFR5cGUgPSByZXBvcnQucGF5bG9hZFR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdsb2NhbC1jYW5kaWRhdGUnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2lkJykpIHtcbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihcbiAgICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsQ2FuZGlkYXRlSWQpICE9PSAtMSkge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsSXAgPSByZXBvcnQuaXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxQb3J0ID0gcmVwb3J0LnBvcnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxQcmlvcml0eSA9IHJlcG9ydC5wcmlvcml0eTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5sb2NhbFByb3RvY29sID0gcmVwb3J0LnByb3RvY29sO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsVHlwZSA9IHJlcG9ydC5jYW5kaWRhdGVUeXBlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAncmVtb3RlLWNhbmRpZGF0ZSc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgnaWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC5pZC5pbmRleE9mKFxuICAgICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVtb3RlQ2FuZGlkYXRlSWQpICE9PSAtMSkge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZUlwID0gcmVwb3J0LmlwO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZVBvcnQgPSByZXBvcnQucG9ydDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVQcmlvcml0eSA9IHJlcG9ydC5wcmlvcml0eTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVQcm90b2NvbCA9IHJlcG9ydC5wcm90b2NvbDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVUeXBlID0gcmVwb3J0LmNhbmRpZGF0ZVR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9LmJpbmQoKSk7XG4gIH1cbiAgcmV0dXJuIHN0YXRzT2JqZWN0O1xufVxuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTcgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5pbXBvcnQgU3NpbSBmcm9tICcuL3NzaW0uanMnO1xuXG5mdW5jdGlvbiBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlb0VsZW1lbnQpIHtcbiAgdGhpcy5mcmFtZVN0YXRzID0ge1xuICAgIG51bUZyb3plbkZyYW1lczogMCxcbiAgICBudW1CbGFja0ZyYW1lczogMCxcbiAgICBudW1GcmFtZXM6IDBcbiAgfTtcblxuICB0aGlzLnJ1bm5pbmdfID0gdHJ1ZTtcblxuICB0aGlzLm5vbkJsYWNrUGl4ZWxMdW1hVGhyZXNob2xkID0gMjA7XG4gIHRoaXMucHJldmlvdXNGcmFtZV8gPSBbXTtcbiAgdGhpcy5pZGVudGljYWxGcmFtZVNzaW1UaHJlc2hvbGQgPSAwLjk4NTtcbiAgdGhpcy5mcmFtZUNvbXBhcmF0b3IgPSBuZXcgU3NpbSgpO1xuXG4gIHRoaXMuY2FudmFzXyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICB0aGlzLnZpZGVvRWxlbWVudF8gPSB2aWRlb0VsZW1lbnQ7XG4gIHRoaXMubGlzdGVuZXJfID0gdGhpcy5jaGVja1ZpZGVvRnJhbWVfLmJpbmQodGhpcyk7XG4gIHRoaXMudmlkZW9FbGVtZW50Xy5hZGRFdmVudExpc3RlbmVyKCdwbGF5JywgdGhpcy5saXN0ZW5lcl8sIGZhbHNlKTtcbn1cblxuVmlkZW9GcmFtZUNoZWNrZXIucHJvdG90eXBlID0ge1xuICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnZpZGVvRWxlbWVudF8ucmVtb3ZlRXZlbnRMaXN0ZW5lcigncGxheScgLCB0aGlzLmxpc3RlbmVyXyk7XG4gICAgdGhpcy5ydW5uaW5nXyA9IGZhbHNlO1xuICB9LFxuXG4gIGdldEN1cnJlbnRJbWFnZURhdGFfOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNhbnZhc18ud2lkdGggPSB0aGlzLnZpZGVvRWxlbWVudF8ud2lkdGg7XG4gICAgdGhpcy5jYW52YXNfLmhlaWdodCA9IHRoaXMudmlkZW9FbGVtZW50Xy5oZWlnaHQ7XG5cbiAgICB2YXIgY29udGV4dCA9IHRoaXMuY2FudmFzXy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGNvbnRleHQuZHJhd0ltYWdlKHRoaXMudmlkZW9FbGVtZW50XywgMCwgMCwgdGhpcy5jYW52YXNfLndpZHRoLFxuICAgICAgICB0aGlzLmNhbnZhc18uaGVpZ2h0KTtcbiAgICByZXR1cm4gY29udGV4dC5nZXRJbWFnZURhdGEoMCwgMCwgdGhpcy5jYW52YXNfLndpZHRoLCB0aGlzLmNhbnZhc18uaGVpZ2h0KTtcbiAgfSxcblxuICBjaGVja1ZpZGVvRnJhbWVfOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucnVubmluZ18pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMudmlkZW9FbGVtZW50Xy5lbmRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBpbWFnZURhdGEgPSB0aGlzLmdldEN1cnJlbnRJbWFnZURhdGFfKCk7XG5cbiAgICBpZiAodGhpcy5pc0JsYWNrRnJhbWVfKGltYWdlRGF0YS5kYXRhLCBpbWFnZURhdGEuZGF0YS5sZW5ndGgpKSB7XG4gICAgICB0aGlzLmZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXMrKztcbiAgICB9XG5cbiAgICBpZiAodGhpcy5mcmFtZUNvbXBhcmF0b3IuY2FsY3VsYXRlKHRoaXMucHJldmlvdXNGcmFtZV8sIGltYWdlRGF0YS5kYXRhKSA+XG4gICAgICAgIHRoaXMuaWRlbnRpY2FsRnJhbWVTc2ltVGhyZXNob2xkKSB7XG4gICAgICB0aGlzLmZyYW1lU3RhdHMubnVtRnJvemVuRnJhbWVzKys7XG4gICAgfVxuICAgIHRoaXMucHJldmlvdXNGcmFtZV8gPSBpbWFnZURhdGEuZGF0YTtcblxuICAgIHRoaXMuZnJhbWVTdGF0cy5udW1GcmFtZXMrKztcbiAgICBzZXRUaW1lb3V0KHRoaXMuY2hlY2tWaWRlb0ZyYW1lXy5iaW5kKHRoaXMpLCAyMCk7XG4gIH0sXG5cbiAgaXNCbGFja0ZyYW1lXzogZnVuY3Rpb24oZGF0YSwgbGVuZ3RoKSB7XG4gICAgLy8gVE9ETzogVXNlIGEgc3RhdGlzdGljYWwsIGhpc3RvZ3JhbS1iYXNlZCBkZXRlY3Rpb24uXG4gICAgdmFyIHRocmVzaCA9IHRoaXMubm9uQmxhY2tQaXhlbEx1bWFUaHJlc2hvbGQ7XG4gICAgdmFyIGFjY3VMdW1hID0gMDtcbiAgICBmb3IgKHZhciBpID0gNDsgaSA8IGxlbmd0aDsgaSArPSA0KSB7XG4gICAgICAvLyBVc2UgTHVtYSBhcyBpbiBSZWMuIDcwOTogWeKAsjcwOSA9IDAuMjFSICsgMC43MkcgKyAwLjA3QjtcbiAgICAgIGFjY3VMdW1hICs9IDAuMjEgKiBkYXRhW2ldICsgMC43MiAqIGRhdGFbaSArIDFdICsgMC4wNyAqIGRhdGFbaSArIDJdO1xuICAgICAgLy8gRWFybHkgdGVybWluYXRpb24gaWYgdGhlIGF2ZXJhZ2UgTHVtYSBzbyBmYXIgaXMgYnJpZ2h0IGVub3VnaC5cbiAgICAgIGlmIChhY2N1THVtYSA+ICh0aHJlc2ggKiBpIC8gNCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufTtcblxuaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFZpZGVvRnJhbWVDaGVja2VyO1xufVxuIl19

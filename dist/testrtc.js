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

function runAllSequentially(tasks, callbacks, shouldStop) {
  var current = -1;
  var runNextAsync = setTimeout.bind(null, runNext);
  runNextAsync();
  function runNext() {
    if (shouldStop()) {
      callbacks.onStopped();
      return;
    }
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
      onStopped: function onStopped() {},
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
    key: 'onStopped',
    value: function onStopped() {
      var callback = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : function () {};

      this.callbacks.onStopped = callback;
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
      var _this = this;

      var allTests = this.getTests();
      this.shouldStop = false;
      runAllSequentially(allTests, this.callbacks, function () {
        return _this.shouldStop;
      });
    }
  }, {
    key: 'stop',
    value: function stop() {
      this.shouldStop = true;
    }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvcnRjcGVlcmNvbm5lY3Rpb24tc2hpbS9ydGNwZWVyY29ubmVjdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9zZHAvc2RwLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9hZGFwdGVyX2NvcmUuanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2FkYXB0ZXJfZmFjdG9yeS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvY2hyb21lL2Nocm9tZV9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9jaHJvbWUvZ2V0dXNlcm1lZGlhLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9jb21tb25fc2hpbS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvZWRnZS9lZGdlX3NoaW0uanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2VkZ2UvZmlsdGVyaWNlc2VydmVycy5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvZWRnZS9nZXR1c2VybWVkaWEuanMiLCJub2RlX21vZHVsZXMvd2VicnRjLWFkYXB0ZXIvc3JjL2pzL2ZpcmVmb3gvZmlyZWZveF9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy9maXJlZm94L2dldHVzZXJtZWRpYS5qcyIsIm5vZGVfbW9kdWxlcy93ZWJydGMtYWRhcHRlci9zcmMvanMvc2FmYXJpL3NhZmFyaV9zaGltLmpzIiwibm9kZV9tb2R1bGVzL3dlYnJ0Yy1hZGFwdGVyL3NyYy9qcy91dGlscy5qcyIsInNyYy9jb25maWcvaW5kZXguanMiLCJzcmMvY29uZmlnL3N1aXRlLmpzIiwic3JjL2NvbmZpZy90ZXN0Q2FzZS5qcyIsInNyYy9pbmRleC5qcyIsInNyYy91bml0L2NhbVJlc29sdXRpb25zLmpzIiwic3JjL3VuaXQvY2FtcmVzb2x1dGlvbnMuanMiLCJzcmMvdW5pdC9jb25uLmpzIiwic3JjL3VuaXQvZGF0YUJhbmR3aWR0aC5qcyIsInNyYy91bml0L21pYy5qcyIsInNyYy91bml0L25ldC5qcyIsInNyYy91bml0L3ZpZGVvQmFuZHdpZHRoLmpzIiwic3JjL3VuaXQvd2lmaVBlcmlvZGljU2Nhbi5qcyIsInNyYy91dGlsL0NhbGwuanMiLCJzcmMvdXRpbC9WaWRlb0ZyYW1lQ2hlY2tlci5qcyIsInNyYy91dGlsL2NhbGwuanMiLCJzcmMvdXRpbC9yZXBvcnQuanMiLCJzcmMvdXRpbC9zc2ltLmpzIiwic3JjL3V0aWwvc3RhdHMuanMiLCJzcmMvdXRpbC91dGlsLmpzIiwic3JjL3V0aWwvdmlkZW9mcmFtZWNoZWNrZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0eURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDM3FCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDYkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0NEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsU0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9SQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDak5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwVEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hMQTs7Ozs7O1FBd0NnQixlLEdBQUEsZTtRQWFBLGdCLEdBQUEsZ0I7UUF1Q0EsaUIsR0FBQSxpQjtRQWtDQSxzQixHQUFBLHNCO1FBb0NBLG9CLEdBQUEsb0I7O0FBaEtoQjs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7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bUIsVUFBVSxJQUE3QixFQUFtQyxVQUFVLElBQVYsQ0FBZSxNQUFsRCxDQUFKLEVBQStEO0FBQzdELFdBQUssVUFBTCxDQUFnQixjQUFoQjtBQUNEOztBQUVELFFBQUksS0FBSyxlQUFMLENBQXFCLFNBQXJCLENBQStCLEtBQUssY0FBcEMsRUFBb0QsVUFBVSxJQUE5RCxJQUNBLEtBQUssMkJBRFQsRUFDc0M7QUFDcEMsV0FBSyxVQUFMLENBQWdCLGVBQWhCO0FBQ0Q7QUFDRCxTQUFLLGNBQUwsR0FBc0IsVUFBVSxJQUFoQzs7QUFFQSxTQUFLLFVBQUwsQ0FBZ0IsU0FBaEI7QUFDQSxlQUFXLEtBQUssZ0JBQUwsQ0FBc0IsSUFBdEIsQ0FBMkIsSUFBM0IsQ0FBWCxFQUE2QyxFQUE3QztBQUNELEdBdEMyQjs7QUF3QzVCLGlCQUFlLHVCQUFTLElBQVQsRUFBZSxNQUFmLEVBQXVCO0FBQ3BDO0FBQ0EsUUFBSSxTQUFTLEtBQUssMEJBQWxCO0FBQ0EsUUFBSSxXQUFXLENBQWY7QUFDQSxTQUFLLElBQUksSUFBSSxDQUFiLEVBQWdCLElBQUksTUFBcEIsRUFBNEIsS0FBSyxDQUFqQyxFQUFvQztBQUNsQztBQUNBLGtCQUFZLE9BQU8sS0FBSyxDQUFMLENBQVAsR0FBaUIsT0FBTyxLQUFLLElBQUksQ0FBVCxDQUF4QixHQUFzQyxPQUFPLEtBQUssSUFBSSxDQUFULENBQXpEO0FBQ0E7QUFDQSxVQUFJLFdBQVksU0FBUyxDQUFULEdBQWEsQ0FBN0IsRUFBaUM7QUFDL0IsZUFBTyxLQUFQO0FBQ0Q7QUFDRjtBQUNELFdBQU8sSUFBUDtBQUNEO0FBckQyQixDQUE5Qjs7QUF3REEsSUFBSSxRQUFPLE9BQVAseUNBQU8sT0FBUCxPQUFtQixRQUF2QixFQUFpQztBQUMvQixTQUFPLE9BQVAsR0FBaUIsaUJBQWpCO0FBQ0QiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNyBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcblxudmFyIFNEUFV0aWxzID0gcmVxdWlyZSgnc2RwJyk7XG5cbmZ1bmN0aW9uIGZpeFN0YXRzVHlwZShzdGF0KSB7XG4gIHJldHVybiB7XG4gICAgaW5ib3VuZHJ0cDogJ2luYm91bmQtcnRwJyxcbiAgICBvdXRib3VuZHJ0cDogJ291dGJvdW5kLXJ0cCcsXG4gICAgY2FuZGlkYXRlcGFpcjogJ2NhbmRpZGF0ZS1wYWlyJyxcbiAgICBsb2NhbGNhbmRpZGF0ZTogJ2xvY2FsLWNhbmRpZGF0ZScsXG4gICAgcmVtb3RlY2FuZGlkYXRlOiAncmVtb3RlLWNhbmRpZGF0ZSdcbiAgfVtzdGF0LnR5cGVdIHx8IHN0YXQudHlwZTtcbn1cblxuZnVuY3Rpb24gd3JpdGVNZWRpYVNlY3Rpb24odHJhbnNjZWl2ZXIsIGNhcHMsIHR5cGUsIHN0cmVhbSwgZHRsc1JvbGUpIHtcbiAgdmFyIHNkcCA9IFNEUFV0aWxzLndyaXRlUnRwRGVzY3JpcHRpb24odHJhbnNjZWl2ZXIua2luZCwgY2Fwcyk7XG5cbiAgLy8gTWFwIElDRSBwYXJhbWV0ZXJzICh1ZnJhZywgcHdkKSB0byBTRFAuXG4gIHNkcCArPSBTRFBVdGlscy53cml0ZUljZVBhcmFtZXRlcnMoXG4gICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlci5nZXRMb2NhbFBhcmFtZXRlcnMoKSk7XG5cbiAgLy8gTWFwIERUTFMgcGFyYW1ldGVycyB0byBTRFAuXG4gIHNkcCArPSBTRFBVdGlscy53cml0ZUR0bHNQYXJhbWV0ZXJzKFxuICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydC5nZXRMb2NhbFBhcmFtZXRlcnMoKSxcbiAgICAgIHR5cGUgPT09ICdvZmZlcicgPyAnYWN0cGFzcycgOiBkdGxzUm9sZSB8fCAnYWN0aXZlJyk7XG5cbiAgc2RwICs9ICdhPW1pZDonICsgdHJhbnNjZWl2ZXIubWlkICsgJ1xcclxcbic7XG5cbiAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlciAmJiB0cmFuc2NlaXZlci5ydHBSZWNlaXZlcikge1xuICAgIHNkcCArPSAnYT1zZW5kcmVjdlxcclxcbic7XG4gIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyKSB7XG4gICAgc2RwICs9ICdhPXNlbmRvbmx5XFxyXFxuJztcbiAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBSZWNlaXZlcikge1xuICAgIHNkcCArPSAnYT1yZWN2b25seVxcclxcbic7XG4gIH0gZWxzZSB7XG4gICAgc2RwICs9ICdhPWluYWN0aXZlXFxyXFxuJztcbiAgfVxuXG4gIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIpIHtcbiAgICB2YXIgdHJhY2tJZCA9IHRyYW5zY2VpdmVyLnJ0cFNlbmRlci5faW5pdGlhbFRyYWNrSWQgfHxcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyLnRyYWNrLmlkO1xuICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci5faW5pdGlhbFRyYWNrSWQgPSB0cmFja0lkO1xuICAgIC8vIHNwZWMuXG4gICAgdmFyIG1zaWQgPSAnbXNpZDonICsgKHN0cmVhbSA/IHN0cmVhbS5pZCA6ICctJykgKyAnICcgK1xuICAgICAgICB0cmFja0lkICsgJ1xcclxcbic7XG4gICAgc2RwICs9ICdhPScgKyBtc2lkO1xuICAgIC8vIGZvciBDaHJvbWUuIExlZ2FjeSBzaG91bGQgbm8gbG9uZ2VyIGJlIHJlcXVpcmVkLlxuICAgIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgK1xuICAgICAgICAnICcgKyBtc2lkO1xuXG4gICAgLy8gUlRYXG4gICAgaWYgKHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHguc3NyYyArXG4gICAgICAgICAgJyAnICsgbXNpZDtcbiAgICAgIHNkcCArPSAnYT1zc3JjLWdyb3VwOkZJRCAnICtcbiAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgKyAnICcgK1xuICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4LnNzcmMgK1xuICAgICAgICAgICdcXHJcXG4nO1xuICAgIH1cbiAgfVxuICAvLyBGSVhNRTogdGhpcyBzaG91bGQgYmUgd3JpdHRlbiBieSB3cml0ZVJ0cERlc2NyaXB0aW9uLlxuICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICtcbiAgICAgICcgY25hbWU6JyArIFNEUFV0aWxzLmxvY2FsQ05hbWUgKyAnXFxyXFxuJztcbiAgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlciAmJiB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eC5zc3JjICtcbiAgICAgICAgJyBjbmFtZTonICsgU0RQVXRpbHMubG9jYWxDTmFtZSArICdcXHJcXG4nO1xuICB9XG4gIHJldHVybiBzZHA7XG59XG5cbi8vIEVkZ2UgZG9lcyBub3QgbGlrZVxuLy8gMSkgc3R1bjogZmlsdGVyZWQgYWZ0ZXIgMTQzOTMgdW5sZXNzID90cmFuc3BvcnQ9dWRwIGlzIHByZXNlbnRcbi8vIDIpIHR1cm46IHRoYXQgZG9lcyBub3QgaGF2ZSBhbGwgb2YgdHVybjpob3N0OnBvcnQ/dHJhbnNwb3J0PXVkcFxuLy8gMykgdHVybjogd2l0aCBpcHY2IGFkZHJlc3Nlc1xuLy8gNCkgdHVybjogb2NjdXJyaW5nIG11bGlwbGUgdGltZXNcbmZ1bmN0aW9uIGZpbHRlckljZVNlcnZlcnMoaWNlU2VydmVycywgZWRnZVZlcnNpb24pIHtcbiAgdmFyIGhhc1R1cm4gPSBmYWxzZTtcbiAgaWNlU2VydmVycyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoaWNlU2VydmVycykpO1xuICByZXR1cm4gaWNlU2VydmVycy5maWx0ZXIoZnVuY3Rpb24oc2VydmVyKSB7XG4gICAgaWYgKHNlcnZlciAmJiAoc2VydmVyLnVybHMgfHwgc2VydmVyLnVybCkpIHtcbiAgICAgIHZhciB1cmxzID0gc2VydmVyLnVybHMgfHwgc2VydmVyLnVybDtcbiAgICAgIGlmIChzZXJ2ZXIudXJsICYmICFzZXJ2ZXIudXJscykge1xuICAgICAgICBjb25zb2xlLndhcm4oJ1JUQ0ljZVNlcnZlci51cmwgaXMgZGVwcmVjYXRlZCEgVXNlIHVybHMgaW5zdGVhZC4nKTtcbiAgICAgIH1cbiAgICAgIHZhciBpc1N0cmluZyA9IHR5cGVvZiB1cmxzID09PSAnc3RyaW5nJztcbiAgICAgIGlmIChpc1N0cmluZykge1xuICAgICAgICB1cmxzID0gW3VybHNdO1xuICAgICAgfVxuICAgICAgdXJscyA9IHVybHMuZmlsdGVyKGZ1bmN0aW9uKHVybCkge1xuICAgICAgICB2YXIgdmFsaWRUdXJuID0gdXJsLmluZGV4T2YoJ3R1cm46JykgPT09IDAgJiZcbiAgICAgICAgICAgIHVybC5pbmRleE9mKCd0cmFuc3BvcnQ9dWRwJykgIT09IC0xICYmXG4gICAgICAgICAgICB1cmwuaW5kZXhPZigndHVybjpbJykgPT09IC0xICYmXG4gICAgICAgICAgICAhaGFzVHVybjtcblxuICAgICAgICBpZiAodmFsaWRUdXJuKSB7XG4gICAgICAgICAgaGFzVHVybiA9IHRydWU7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVybC5pbmRleE9mKCdzdHVuOicpID09PSAwICYmIGVkZ2VWZXJzaW9uID49IDE0MzkzICYmXG4gICAgICAgICAgICB1cmwuaW5kZXhPZignP3RyYW5zcG9ydD11ZHAnKSA9PT0gLTE7XG4gICAgICB9KTtcblxuICAgICAgZGVsZXRlIHNlcnZlci51cmw7XG4gICAgICBzZXJ2ZXIudXJscyA9IGlzU3RyaW5nID8gdXJsc1swXSA6IHVybHM7XG4gICAgICByZXR1cm4gISF1cmxzLmxlbmd0aDtcbiAgICB9XG4gIH0pO1xufVxuXG4vLyBEZXRlcm1pbmVzIHRoZSBpbnRlcnNlY3Rpb24gb2YgbG9jYWwgYW5kIHJlbW90ZSBjYXBhYmlsaXRpZXMuXG5mdW5jdGlvbiBnZXRDb21tb25DYXBhYmlsaXRpZXMobG9jYWxDYXBhYmlsaXRpZXMsIHJlbW90ZUNhcGFiaWxpdGllcykge1xuICB2YXIgY29tbW9uQ2FwYWJpbGl0aWVzID0ge1xuICAgIGNvZGVjczogW10sXG4gICAgaGVhZGVyRXh0ZW5zaW9uczogW10sXG4gICAgZmVjTWVjaGFuaXNtczogW11cbiAgfTtcblxuICB2YXIgZmluZENvZGVjQnlQYXlsb2FkVHlwZSA9IGZ1bmN0aW9uKHB0LCBjb2RlY3MpIHtcbiAgICBwdCA9IHBhcnNlSW50KHB0LCAxMCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBjb2RlY3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChjb2RlY3NbaV0ucGF5bG9hZFR5cGUgPT09IHB0IHx8XG4gICAgICAgICAgY29kZWNzW2ldLnByZWZlcnJlZFBheWxvYWRUeXBlID09PSBwdCkge1xuICAgICAgICByZXR1cm4gY29kZWNzW2ldO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICB2YXIgcnR4Q2FwYWJpbGl0eU1hdGNoZXMgPSBmdW5jdGlvbihsUnR4LCByUnR4LCBsQ29kZWNzLCByQ29kZWNzKSB7XG4gICAgdmFyIGxDb2RlYyA9IGZpbmRDb2RlY0J5UGF5bG9hZFR5cGUobFJ0eC5wYXJhbWV0ZXJzLmFwdCwgbENvZGVjcyk7XG4gICAgdmFyIHJDb2RlYyA9IGZpbmRDb2RlY0J5UGF5bG9hZFR5cGUoclJ0eC5wYXJhbWV0ZXJzLmFwdCwgckNvZGVjcyk7XG4gICAgcmV0dXJuIGxDb2RlYyAmJiByQ29kZWMgJiZcbiAgICAgICAgbENvZGVjLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gckNvZGVjLm5hbWUudG9Mb3dlckNhc2UoKTtcbiAgfTtcblxuICBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MuZm9yRWFjaChmdW5jdGlvbihsQ29kZWMpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlbW90ZUNhcGFiaWxpdGllcy5jb2RlY3MubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciByQ29kZWMgPSByZW1vdGVDYXBhYmlsaXRpZXMuY29kZWNzW2ldO1xuICAgICAgaWYgKGxDb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCkgPT09IHJDb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCkgJiZcbiAgICAgICAgICBsQ29kZWMuY2xvY2tSYXRlID09PSByQ29kZWMuY2xvY2tSYXRlKSB7XG4gICAgICAgIGlmIChsQ29kZWMubmFtZS50b0xvd2VyQ2FzZSgpID09PSAncnR4JyAmJlxuICAgICAgICAgICAgbENvZGVjLnBhcmFtZXRlcnMgJiYgckNvZGVjLnBhcmFtZXRlcnMuYXB0KSB7XG4gICAgICAgICAgLy8gZm9yIFJUWCB3ZSBuZWVkIHRvIGZpbmQgdGhlIGxvY2FsIHJ0eCB0aGF0IGhhcyBhIGFwdFxuICAgICAgICAgIC8vIHdoaWNoIHBvaW50cyB0byB0aGUgc2FtZSBsb2NhbCBjb2RlYyBhcyB0aGUgcmVtb3RlIG9uZS5cbiAgICAgICAgICBpZiAoIXJ0eENhcGFiaWxpdHlNYXRjaGVzKGxDb2RlYywgckNvZGVjLFxuICAgICAgICAgICAgICBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MsIHJlbW90ZUNhcGFiaWxpdGllcy5jb2RlY3MpKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgckNvZGVjID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShyQ29kZWMpKTsgLy8gZGVlcGNvcHlcbiAgICAgICAgLy8gbnVtYmVyIG9mIGNoYW5uZWxzIGlzIHRoZSBoaWdoZXN0IGNvbW1vbiBudW1iZXIgb2YgY2hhbm5lbHNcbiAgICAgICAgckNvZGVjLm51bUNoYW5uZWxzID0gTWF0aC5taW4obENvZGVjLm51bUNoYW5uZWxzLFxuICAgICAgICAgICAgckNvZGVjLm51bUNoYW5uZWxzKTtcbiAgICAgICAgLy8gcHVzaCByQ29kZWMgc28gd2UgcmVwbHkgd2l0aCBvZmZlcmVyIHBheWxvYWQgdHlwZVxuICAgICAgICBjb21tb25DYXBhYmlsaXRpZXMuY29kZWNzLnB1c2gockNvZGVjKTtcblxuICAgICAgICAvLyBkZXRlcm1pbmUgY29tbW9uIGZlZWRiYWNrIG1lY2hhbmlzbXNcbiAgICAgICAgckNvZGVjLnJ0Y3BGZWVkYmFjayA9IHJDb2RlYy5ydGNwRmVlZGJhY2suZmlsdGVyKGZ1bmN0aW9uKGZiKSB7XG4gICAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBsQ29kZWMucnRjcEZlZWRiYWNrLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICBpZiAobENvZGVjLnJ0Y3BGZWVkYmFja1tqXS50eXBlID09PSBmYi50eXBlICYmXG4gICAgICAgICAgICAgICAgbENvZGVjLnJ0Y3BGZWVkYmFja1tqXS5wYXJhbWV0ZXIgPT09IGZiLnBhcmFtZXRlcikge1xuICAgICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9KTtcbiAgICAgICAgLy8gRklYTUU6IGFsc28gbmVlZCB0byBkZXRlcm1pbmUgLnBhcmFtZXRlcnNcbiAgICAgICAgLy8gIHNlZSBodHRwczovL2dpdGh1Yi5jb20vb3BlbnBlZXIvb3J0Yy9pc3N1ZXMvNTY5XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgbG9jYWxDYXBhYmlsaXRpZXMuaGVhZGVyRXh0ZW5zaW9ucy5mb3JFYWNoKGZ1bmN0aW9uKGxIZWFkZXJFeHRlbnNpb24pIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHJlbW90ZUNhcGFiaWxpdGllcy5oZWFkZXJFeHRlbnNpb25zLmxlbmd0aDtcbiAgICAgICAgIGkrKykge1xuICAgICAgdmFyIHJIZWFkZXJFeHRlbnNpb24gPSByZW1vdGVDYXBhYmlsaXRpZXMuaGVhZGVyRXh0ZW5zaW9uc1tpXTtcbiAgICAgIGlmIChsSGVhZGVyRXh0ZW5zaW9uLnVyaSA9PT0gckhlYWRlckV4dGVuc2lvbi51cmkpIHtcbiAgICAgICAgY29tbW9uQ2FwYWJpbGl0aWVzLmhlYWRlckV4dGVuc2lvbnMucHVzaChySGVhZGVyRXh0ZW5zaW9uKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICAvLyBGSVhNRTogZmVjTWVjaGFuaXNtc1xuICByZXR1cm4gY29tbW9uQ2FwYWJpbGl0aWVzO1xufVxuXG4vLyBpcyBhY3Rpb249c2V0TG9jYWxEZXNjcmlwdGlvbiB3aXRoIHR5cGUgYWxsb3dlZCBpbiBzaWduYWxpbmdTdGF0ZVxuZnVuY3Rpb24gaXNBY3Rpb25BbGxvd2VkSW5TaWduYWxpbmdTdGF0ZShhY3Rpb24sIHR5cGUsIHNpZ25hbGluZ1N0YXRlKSB7XG4gIHJldHVybiB7XG4gICAgb2ZmZXI6IHtcbiAgICAgIHNldExvY2FsRGVzY3JpcHRpb246IFsnc3RhYmxlJywgJ2hhdmUtbG9jYWwtb2ZmZXInXSxcbiAgICAgIHNldFJlbW90ZURlc2NyaXB0aW9uOiBbJ3N0YWJsZScsICdoYXZlLXJlbW90ZS1vZmZlciddXG4gICAgfSxcbiAgICBhbnN3ZXI6IHtcbiAgICAgIHNldExvY2FsRGVzY3JpcHRpb246IFsnaGF2ZS1yZW1vdGUtb2ZmZXInLCAnaGF2ZS1sb2NhbC1wcmFuc3dlciddLFxuICAgICAgc2V0UmVtb3RlRGVzY3JpcHRpb246IFsnaGF2ZS1sb2NhbC1vZmZlcicsICdoYXZlLXJlbW90ZS1wcmFuc3dlciddXG4gICAgfVxuICB9W3R5cGVdW2FjdGlvbl0uaW5kZXhPZihzaWduYWxpbmdTdGF0ZSkgIT09IC0xO1xufVxuXG5mdW5jdGlvbiBtYXliZUFkZENhbmRpZGF0ZShpY2VUcmFuc3BvcnQsIGNhbmRpZGF0ZSkge1xuICAvLyBFZGdlJ3MgaW50ZXJuYWwgcmVwcmVzZW50YXRpb24gYWRkcyBzb21lIGZpZWxkcyB0aGVyZWZvcmVcbiAgLy8gbm90IGFsbCBmaWVsZNGVIGFyZSB0YWtlbiBpbnRvIGFjY291bnQuXG4gIHZhciBhbHJlYWR5QWRkZWQgPSBpY2VUcmFuc3BvcnQuZ2V0UmVtb3RlQ2FuZGlkYXRlcygpXG4gICAgICAuZmluZChmdW5jdGlvbihyZW1vdGVDYW5kaWRhdGUpIHtcbiAgICAgICAgcmV0dXJuIGNhbmRpZGF0ZS5mb3VuZGF0aW9uID09PSByZW1vdGVDYW5kaWRhdGUuZm91bmRhdGlvbiAmJlxuICAgICAgICAgICAgY2FuZGlkYXRlLmlwID09PSByZW1vdGVDYW5kaWRhdGUuaXAgJiZcbiAgICAgICAgICAgIGNhbmRpZGF0ZS5wb3J0ID09PSByZW1vdGVDYW5kaWRhdGUucG9ydCAmJlxuICAgICAgICAgICAgY2FuZGlkYXRlLnByaW9yaXR5ID09PSByZW1vdGVDYW5kaWRhdGUucHJpb3JpdHkgJiZcbiAgICAgICAgICAgIGNhbmRpZGF0ZS5wcm90b2NvbCA9PT0gcmVtb3RlQ2FuZGlkYXRlLnByb3RvY29sICYmXG4gICAgICAgICAgICBjYW5kaWRhdGUudHlwZSA9PT0gcmVtb3RlQ2FuZGlkYXRlLnR5cGU7XG4gICAgICB9KTtcbiAgaWYgKCFhbHJlYWR5QWRkZWQpIHtcbiAgICBpY2VUcmFuc3BvcnQuYWRkUmVtb3RlQ2FuZGlkYXRlKGNhbmRpZGF0ZSk7XG4gIH1cbiAgcmV0dXJuICFhbHJlYWR5QWRkZWQ7XG59XG5cblxuZnVuY3Rpb24gbWFrZUVycm9yKG5hbWUsIGRlc2NyaXB0aW9uKSB7XG4gIHZhciBlID0gbmV3IEVycm9yKGRlc2NyaXB0aW9uKTtcbiAgZS5uYW1lID0gbmFtZTtcbiAgLy8gbGVnYWN5IGVycm9yIGNvZGVzIGZyb20gaHR0cHM6Ly9oZXljYW0uZ2l0aHViLmlvL3dlYmlkbC8jaWRsLURPTUV4Y2VwdGlvbi1lcnJvci1uYW1lc1xuICBlLmNvZGUgPSB7XG4gICAgTm90U3VwcG9ydGVkRXJyb3I6IDksXG4gICAgSW52YWxpZFN0YXRlRXJyb3I6IDExLFxuICAgIEludmFsaWRBY2Nlc3NFcnJvcjogMTUsXG4gICAgVHlwZUVycm9yOiB1bmRlZmluZWQsXG4gICAgT3BlcmF0aW9uRXJyb3I6IHVuZGVmaW5lZFxuICB9W25hbWVdO1xuICByZXR1cm4gZTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih3aW5kb3csIGVkZ2VWZXJzaW9uKSB7XG4gIC8vIGh0dHBzOi8vdzNjLmdpdGh1Yi5pby9tZWRpYWNhcHR1cmUtbWFpbi8jbWVkaWFzdHJlYW1cbiAgLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGFkZCB0aGUgdHJhY2sgdG8gdGhlIHN0cmVhbSBhbmRcbiAgLy8gZGlzcGF0Y2ggdGhlIGV2ZW50IG91cnNlbHZlcy5cbiAgZnVuY3Rpb24gYWRkVHJhY2tUb1N0cmVhbUFuZEZpcmVFdmVudCh0cmFjaywgc3RyZWFtKSB7XG4gICAgc3RyZWFtLmFkZFRyYWNrKHRyYWNrKTtcbiAgICBzdHJlYW0uZGlzcGF0Y2hFdmVudChuZXcgd2luZG93Lk1lZGlhU3RyZWFtVHJhY2tFdmVudCgnYWRkdHJhY2snLFxuICAgICAgICB7dHJhY2s6IHRyYWNrfSkpO1xuICB9XG5cbiAgZnVuY3Rpb24gcmVtb3ZlVHJhY2tGcm9tU3RyZWFtQW5kRmlyZUV2ZW50KHRyYWNrLCBzdHJlYW0pIHtcbiAgICBzdHJlYW0ucmVtb3ZlVHJhY2sodHJhY2spO1xuICAgIHN0cmVhbS5kaXNwYXRjaEV2ZW50KG5ldyB3aW5kb3cuTWVkaWFTdHJlYW1UcmFja0V2ZW50KCdyZW1vdmV0cmFjaycsXG4gICAgICAgIHt0cmFjazogdHJhY2t9KSk7XG4gIH1cblxuICBmdW5jdGlvbiBmaXJlQWRkVHJhY2socGMsIHRyYWNrLCByZWNlaXZlciwgc3RyZWFtcykge1xuICAgIHZhciB0cmFja0V2ZW50ID0gbmV3IEV2ZW50KCd0cmFjaycpO1xuICAgIHRyYWNrRXZlbnQudHJhY2sgPSB0cmFjaztcbiAgICB0cmFja0V2ZW50LnJlY2VpdmVyID0gcmVjZWl2ZXI7XG4gICAgdHJhY2tFdmVudC50cmFuc2NlaXZlciA9IHtyZWNlaXZlcjogcmVjZWl2ZXJ9O1xuICAgIHRyYWNrRXZlbnQuc3RyZWFtcyA9IHN0cmVhbXM7XG4gICAgd2luZG93LnNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBwYy5fZGlzcGF0Y2hFdmVudCgndHJhY2snLCB0cmFja0V2ZW50KTtcbiAgICB9KTtcbiAgfVxuXG4gIHZhciBSVENQZWVyQ29ubmVjdGlvbiA9IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHZhciBwYyA9IHRoaXM7XG5cbiAgICB2YXIgX2V2ZW50VGFyZ2V0ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgIFsnYWRkRXZlbnRMaXN0ZW5lcicsICdyZW1vdmVFdmVudExpc3RlbmVyJywgJ2Rpc3BhdGNoRXZlbnQnXVxuICAgICAgICAuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgICAgICBwY1ttZXRob2RdID0gX2V2ZW50VGFyZ2V0W21ldGhvZF0uYmluZChfZXZlbnRUYXJnZXQpO1xuICAgICAgICB9KTtcblxuICAgIHRoaXMuY2FuVHJpY2tsZUljZUNhbmRpZGF0ZXMgPSBudWxsO1xuXG4gICAgdGhpcy5uZWVkTmVnb3RpYXRpb24gPSBmYWxzZTtcblxuICAgIHRoaXMubG9jYWxTdHJlYW1zID0gW107XG4gICAgdGhpcy5yZW1vdGVTdHJlYW1zID0gW107XG5cbiAgICB0aGlzLl9sb2NhbERlc2NyaXB0aW9uID0gbnVsbDtcbiAgICB0aGlzLl9yZW1vdGVEZXNjcmlwdGlvbiA9IG51bGw7XG5cbiAgICB0aGlzLnNpZ25hbGluZ1N0YXRlID0gJ3N0YWJsZSc7XG4gICAgdGhpcy5pY2VDb25uZWN0aW9uU3RhdGUgPSAnbmV3JztcbiAgICB0aGlzLmNvbm5lY3Rpb25TdGF0ZSA9ICduZXcnO1xuICAgIHRoaXMuaWNlR2F0aGVyaW5nU3RhdGUgPSAnbmV3JztcblxuICAgIGNvbmZpZyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoY29uZmlnIHx8IHt9KSk7XG5cbiAgICB0aGlzLnVzaW5nQnVuZGxlID0gY29uZmlnLmJ1bmRsZVBvbGljeSA9PT0gJ21heC1idW5kbGUnO1xuICAgIGlmIChjb25maWcucnRjcE11eFBvbGljeSA9PT0gJ25lZ290aWF0ZScpIHtcbiAgICAgIHRocm93KG1ha2VFcnJvcignTm90U3VwcG9ydGVkRXJyb3InLFxuICAgICAgICAgICdydGNwTXV4UG9saWN5IFxcJ25lZ290aWF0ZVxcJyBpcyBub3Qgc3VwcG9ydGVkJykpO1xuICAgIH0gZWxzZSBpZiAoIWNvbmZpZy5ydGNwTXV4UG9saWN5KSB7XG4gICAgICBjb25maWcucnRjcE11eFBvbGljeSA9ICdyZXF1aXJlJztcbiAgICB9XG5cbiAgICBzd2l0Y2ggKGNvbmZpZy5pY2VUcmFuc3BvcnRQb2xpY3kpIHtcbiAgICAgIGNhc2UgJ2FsbCc6XG4gICAgICBjYXNlICdyZWxheSc6XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgY29uZmlnLmljZVRyYW5zcG9ydFBvbGljeSA9ICdhbGwnO1xuICAgICAgICBicmVhaztcbiAgICB9XG5cbiAgICBzd2l0Y2ggKGNvbmZpZy5idW5kbGVQb2xpY3kpIHtcbiAgICAgIGNhc2UgJ2JhbGFuY2VkJzpcbiAgICAgIGNhc2UgJ21heC1jb21wYXQnOlxuICAgICAgY2FzZSAnbWF4LWJ1bmRsZSc6XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgY29uZmlnLmJ1bmRsZVBvbGljeSA9ICdiYWxhbmNlZCc7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNvbmZpZy5pY2VTZXJ2ZXJzID0gZmlsdGVySWNlU2VydmVycyhjb25maWcuaWNlU2VydmVycyB8fCBbXSwgZWRnZVZlcnNpb24pO1xuXG4gICAgdGhpcy5faWNlR2F0aGVyZXJzID0gW107XG4gICAgaWYgKGNvbmZpZy5pY2VDYW5kaWRhdGVQb29sU2l6ZSkge1xuICAgICAgZm9yICh2YXIgaSA9IGNvbmZpZy5pY2VDYW5kaWRhdGVQb29sU2l6ZTsgaSA+IDA7IGktLSkge1xuICAgICAgICB0aGlzLl9pY2VHYXRoZXJlcnMucHVzaChuZXcgd2luZG93LlJUQ0ljZUdhdGhlcmVyKHtcbiAgICAgICAgICBpY2VTZXJ2ZXJzOiBjb25maWcuaWNlU2VydmVycyxcbiAgICAgICAgICBnYXRoZXJQb2xpY3k6IGNvbmZpZy5pY2VUcmFuc3BvcnRQb2xpY3lcbiAgICAgICAgfSkpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25maWcuaWNlQ2FuZGlkYXRlUG9vbFNpemUgPSAwO1xuICAgIH1cblxuICAgIHRoaXMuX2NvbmZpZyA9IGNvbmZpZztcblxuICAgIC8vIHBlci10cmFjayBpY2VHYXRoZXJzLCBpY2VUcmFuc3BvcnRzLCBkdGxzVHJhbnNwb3J0cywgcnRwU2VuZGVycywgLi4uXG4gICAgLy8gZXZlcnl0aGluZyB0aGF0IGlzIG5lZWRlZCB0byBkZXNjcmliZSBhIFNEUCBtLWxpbmUuXG4gICAgdGhpcy50cmFuc2NlaXZlcnMgPSBbXTtcblxuICAgIHRoaXMuX3NkcFNlc3Npb25JZCA9IFNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkKCk7XG4gICAgdGhpcy5fc2RwU2Vzc2lvblZlcnNpb24gPSAwO1xuXG4gICAgdGhpcy5fZHRsc1JvbGUgPSB1bmRlZmluZWQ7IC8vIHJvbGUgZm9yIGE9c2V0dXAgdG8gdXNlIGluIGFuc3dlcnMuXG5cbiAgICB0aGlzLl9pc0Nsb3NlZCA9IGZhbHNlO1xuICB9O1xuXG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdsb2NhbERlc2NyaXB0aW9uJywge1xuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuX2xvY2FsRGVzY3JpcHRpb247XG4gICAgfVxuICB9KTtcbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ3JlbW90ZURlc2NyaXB0aW9uJywge1xuICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIHRoaXMuX3JlbW90ZURlc2NyaXB0aW9uO1xuICAgIH1cbiAgfSk7XG5cbiAgLy8gc2V0IHVwIGV2ZW50IGhhbmRsZXJzIG9uIHByb3RvdHlwZVxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25pY2VjYW5kaWRhdGUgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25hZGRzdHJlYW0gPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub250cmFjayA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbnJlbW92ZXN0cmVhbSA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbnNpZ25hbGluZ3N0YXRlY2hhbmdlID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uaWNlY29ubmVjdGlvbnN0YXRlY2hhbmdlID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uY29ubmVjdGlvbnN0YXRlY2hhbmdlID0gbnVsbDtcbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLm9uaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2UgPSBudWxsO1xuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUub25uZWdvdGlhdGlvbm5lZWRlZCA9IG51bGw7XG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5vbmRhdGFjaGFubmVsID0gbnVsbDtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2Rpc3BhdGNoRXZlbnQgPSBmdW5jdGlvbihuYW1lLCBldmVudCkge1xuICAgIGlmICh0aGlzLl9pc0Nsb3NlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmRpc3BhdGNoRXZlbnQoZXZlbnQpO1xuICAgIGlmICh0eXBlb2YgdGhpc1snb24nICsgbmFtZV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXNbJ29uJyArIG5hbWVdKGV2ZW50KTtcbiAgICB9XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9lbWl0R2F0aGVyaW5nU3RhdGVDaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ2ljZWdhdGhlcmluZ3N0YXRlY2hhbmdlJyk7XG4gICAgdGhpcy5fZGlzcGF0Y2hFdmVudCgnaWNlZ2F0aGVyaW5nc3RhdGVjaGFuZ2UnLCBldmVudCk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldENvbmZpZ3VyYXRpb24gPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5fY29uZmlnO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRMb2NhbFN0cmVhbXMgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5sb2NhbFN0cmVhbXM7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlbW90ZVN0cmVhbXMgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5yZW1vdGVTdHJlYW1zO1xuICB9O1xuXG4gIC8vIGludGVybmFsIGhlbHBlciB0byBjcmVhdGUgYSB0cmFuc2NlaXZlciBvYmplY3QuXG4gIC8vICh3aGljaCBpcyBub3QgeWV0IHRoZSBzYW1lIGFzIHRoZSBXZWJSVEMgMS4wIHRyYW5zY2VpdmVyKVxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX2NyZWF0ZVRyYW5zY2VpdmVyID0gZnVuY3Rpb24oa2luZCwgZG9Ob3RBZGQpIHtcbiAgICB2YXIgaGFzQnVuZGxlVHJhbnNwb3J0ID0gdGhpcy50cmFuc2NlaXZlcnMubGVuZ3RoID4gMDtcbiAgICB2YXIgdHJhbnNjZWl2ZXIgPSB7XG4gICAgICB0cmFjazogbnVsbCxcbiAgICAgIGljZUdhdGhlcmVyOiBudWxsLFxuICAgICAgaWNlVHJhbnNwb3J0OiBudWxsLFxuICAgICAgZHRsc1RyYW5zcG9ydDogbnVsbCxcbiAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzOiBudWxsLFxuICAgICAgcmVtb3RlQ2FwYWJpbGl0aWVzOiBudWxsLFxuICAgICAgcnRwU2VuZGVyOiBudWxsLFxuICAgICAgcnRwUmVjZWl2ZXI6IG51bGwsXG4gICAgICBraW5kOiBraW5kLFxuICAgICAgbWlkOiBudWxsLFxuICAgICAgc2VuZEVuY29kaW5nUGFyYW1ldGVyczogbnVsbCxcbiAgICAgIHJlY3ZFbmNvZGluZ1BhcmFtZXRlcnM6IG51bGwsXG4gICAgICBzdHJlYW06IG51bGwsXG4gICAgICBhc3NvY2lhdGVkUmVtb3RlTWVkaWFTdHJlYW1zOiBbXSxcbiAgICAgIHdhbnRSZWNlaXZlOiB0cnVlXG4gICAgfTtcbiAgICBpZiAodGhpcy51c2luZ0J1bmRsZSAmJiBoYXNCdW5kbGVUcmFuc3BvcnQpIHtcbiAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCA9IHRoaXMudHJhbnNjZWl2ZXJzWzBdLmljZVRyYW5zcG9ydDtcbiAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQgPSB0aGlzLnRyYW5zY2VpdmVyc1swXS5kdGxzVHJhbnNwb3J0O1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdHJhbnNwb3J0cyA9IHRoaXMuX2NyZWF0ZUljZUFuZER0bHNUcmFuc3BvcnRzKCk7XG4gICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQgPSB0cmFuc3BvcnRzLmljZVRyYW5zcG9ydDtcbiAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQgPSB0cmFuc3BvcnRzLmR0bHNUcmFuc3BvcnQ7XG4gICAgfVxuICAgIGlmICghZG9Ob3RBZGQpIHtcbiAgICAgIHRoaXMudHJhbnNjZWl2ZXJzLnB1c2godHJhbnNjZWl2ZXIpO1xuICAgIH1cbiAgICByZXR1cm4gdHJhbnNjZWl2ZXI7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrID0gZnVuY3Rpb24odHJhY2ssIHN0cmVhbSkge1xuICAgIGlmICh0aGlzLl9pc0Nsb3NlZCkge1xuICAgICAgdGhyb3cgbWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0F0dGVtcHRlZCB0byBjYWxsIGFkZFRyYWNrIG9uIGEgY2xvc2VkIHBlZXJjb25uZWN0aW9uLicpO1xuICAgIH1cblxuICAgIHZhciBhbHJlYWR5RXhpc3RzID0gdGhpcy50cmFuc2NlaXZlcnMuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgfSk7XG5cbiAgICBpZiAoYWxyZWFkeUV4aXN0cykge1xuICAgICAgdGhyb3cgbWFrZUVycm9yKCdJbnZhbGlkQWNjZXNzRXJyb3InLCAnVHJhY2sgYWxyZWFkeSBleGlzdHMuJyk7XG4gICAgfVxuXG4gICAgdmFyIHRyYW5zY2VpdmVyO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy50cmFuc2NlaXZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmICghdGhpcy50cmFuc2NlaXZlcnNbaV0udHJhY2sgJiZcbiAgICAgICAgICB0aGlzLnRyYW5zY2VpdmVyc1tpXS5raW5kID09PSB0cmFjay5raW5kKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyID0gdGhpcy50cmFuc2NlaXZlcnNbaV07XG4gICAgICB9XG4gICAgfVxuICAgIGlmICghdHJhbnNjZWl2ZXIpIHtcbiAgICAgIHRyYW5zY2VpdmVyID0gdGhpcy5fY3JlYXRlVHJhbnNjZWl2ZXIodHJhY2sua2luZCk7XG4gICAgfVxuXG4gICAgdGhpcy5fbWF5YmVGaXJlTmVnb3RpYXRpb25OZWVkZWQoKTtcblxuICAgIGlmICh0aGlzLmxvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPT09IC0xKSB7XG4gICAgICB0aGlzLmxvY2FsU3RyZWFtcy5wdXNoKHN0cmVhbSk7XG4gICAgfVxuXG4gICAgdHJhbnNjZWl2ZXIudHJhY2sgPSB0cmFjaztcbiAgICB0cmFuc2NlaXZlci5zdHJlYW0gPSBzdHJlYW07XG4gICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyID0gbmV3IHdpbmRvdy5SVENSdHBTZW5kZXIodHJhY2ssXG4gICAgICAgIHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQpO1xuICAgIHJldHVybiB0cmFuc2NlaXZlci5ydHBTZW5kZXI7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgaWYgKGVkZ2VWZXJzaW9uID49IDE1MDI1KSB7XG4gICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICBwYy5hZGRUcmFjayh0cmFjaywgc3RyZWFtKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBDbG9uZSBpcyBuZWNlc3NhcnkgZm9yIGxvY2FsIGRlbW9zIG1vc3RseSwgYXR0YWNoaW5nIGRpcmVjdGx5XG4gICAgICAvLyB0byB0d28gZGlmZmVyZW50IHNlbmRlcnMgZG9lcyBub3Qgd29yayAoYnVpbGQgMTA1NDcpLlxuICAgICAgLy8gRml4ZWQgaW4gMTUwMjUgKG9yIGVhcmxpZXIpXG4gICAgICB2YXIgY2xvbmVkU3RyZWFtID0gc3RyZWFtLmNsb25lKCk7XG4gICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaywgaWR4KSB7XG4gICAgICAgIHZhciBjbG9uZWRUcmFjayA9IGNsb25lZFN0cmVhbS5nZXRUcmFja3MoKVtpZHhdO1xuICAgICAgICB0cmFjay5hZGRFdmVudExpc3RlbmVyKCdlbmFibGVkJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBjbG9uZWRUcmFjay5lbmFibGVkID0gZXZlbnQuZW5hYmxlZDtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIGNsb25lZFN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgIHBjLmFkZFRyYWNrKHRyYWNrLCBjbG9uZWRTdHJlYW0pO1xuICAgICAgfSk7XG4gICAgfVxuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVUcmFjayA9IGZ1bmN0aW9uKHNlbmRlcikge1xuICAgIGlmICh0aGlzLl9pc0Nsb3NlZCkge1xuICAgICAgdGhyb3cgbWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0F0dGVtcHRlZCB0byBjYWxsIHJlbW92ZVRyYWNrIG9uIGEgY2xvc2VkIHBlZXJjb25uZWN0aW9uLicpO1xuICAgIH1cblxuICAgIGlmICghKHNlbmRlciBpbnN0YW5jZW9mIHdpbmRvdy5SVENSdHBTZW5kZXIpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCAxIG9mIFJUQ1BlZXJDb25uZWN0aW9uLnJlbW92ZVRyYWNrICcgK1xuICAgICAgICAgICdkb2VzIG5vdCBpbXBsZW1lbnQgaW50ZXJmYWNlIFJUQ1J0cFNlbmRlci4nKTtcbiAgICB9XG5cbiAgICB2YXIgdHJhbnNjZWl2ZXIgPSB0aGlzLnRyYW5zY2VpdmVycy5maW5kKGZ1bmN0aW9uKHQpIHtcbiAgICAgIHJldHVybiB0LnJ0cFNlbmRlciA9PT0gc2VuZGVyO1xuICAgIH0pO1xuXG4gICAgaWYgKCF0cmFuc2NlaXZlcikge1xuICAgICAgdGhyb3cgbWFrZUVycm9yKCdJbnZhbGlkQWNjZXNzRXJyb3InLFxuICAgICAgICAgICdTZW5kZXIgd2FzIG5vdCBjcmVhdGVkIGJ5IHRoaXMgY29ubmVjdGlvbi4nKTtcbiAgICB9XG4gICAgdmFyIHN0cmVhbSA9IHRyYW5zY2VpdmVyLnN0cmVhbTtcblxuICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci5zdG9wKCk7XG4gICAgdHJhbnNjZWl2ZXIucnRwU2VuZGVyID0gbnVsbDtcbiAgICB0cmFuc2NlaXZlci50cmFjayA9IG51bGw7XG4gICAgdHJhbnNjZWl2ZXIuc3RyZWFtID0gbnVsbDtcblxuICAgIC8vIHJlbW92ZSB0aGUgc3RyZWFtIGZyb20gdGhlIHNldCBvZiBsb2NhbCBzdHJlYW1zXG4gICAgdmFyIGxvY2FsU3RyZWFtcyA9IHRoaXMudHJhbnNjZWl2ZXJzLm1hcChmdW5jdGlvbih0KSB7XG4gICAgICByZXR1cm4gdC5zdHJlYW07XG4gICAgfSk7XG4gICAgaWYgKGxvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPT09IC0xICYmXG4gICAgICAgIHRoaXMubG9jYWxTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA+IC0xKSB7XG4gICAgICB0aGlzLmxvY2FsU3RyZWFtcy5zcGxpY2UodGhpcy5sb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pLCAxKTtcbiAgICB9XG5cbiAgICB0aGlzLl9tYXliZUZpcmVOZWdvdGlhdGlvbk5lZWRlZCgpO1xuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICB2YXIgc2VuZGVyID0gcGMuZ2V0U2VuZGVycygpLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgICB9KTtcbiAgICAgIGlmIChzZW5kZXIpIHtcbiAgICAgICAgcGMucmVtb3ZlVHJhY2soc2VuZGVyKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnRyYW5zY2VpdmVycy5maWx0ZXIoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIHJldHVybiAhIXRyYW5zY2VpdmVyLnJ0cFNlbmRlcjtcbiAgICB9KVxuICAgIC5tYXAoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIHJldHVybiB0cmFuc2NlaXZlci5ydHBTZW5kZXI7XG4gICAgfSk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycyA9IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLnRyYW5zY2VpdmVycy5maWx0ZXIoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIHJldHVybiAhIXRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyO1xuICAgIH0pXG4gICAgLm1hcChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgcmV0dXJuIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyO1xuICAgIH0pO1xuICB9O1xuXG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9jcmVhdGVJY2VHYXRoZXJlciA9IGZ1bmN0aW9uKHNkcE1MaW5lSW5kZXgsXG4gICAgICB1c2luZ0J1bmRsZSkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgaWYgKHVzaW5nQnVuZGxlICYmIHNkcE1MaW5lSW5kZXggPiAwKSB7XG4gICAgICByZXR1cm4gdGhpcy50cmFuc2NlaXZlcnNbMF0uaWNlR2F0aGVyZXI7XG4gICAgfSBlbHNlIGlmICh0aGlzLl9pY2VHYXRoZXJlcnMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gdGhpcy5faWNlR2F0aGVyZXJzLnNoaWZ0KCk7XG4gICAgfVxuICAgIHZhciBpY2VHYXRoZXJlciA9IG5ldyB3aW5kb3cuUlRDSWNlR2F0aGVyZXIoe1xuICAgICAgaWNlU2VydmVyczogdGhpcy5fY29uZmlnLmljZVNlcnZlcnMsXG4gICAgICBnYXRoZXJQb2xpY3k6IHRoaXMuX2NvbmZpZy5pY2VUcmFuc3BvcnRQb2xpY3lcbiAgICB9KTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoaWNlR2F0aGVyZXIsICdzdGF0ZScsXG4gICAgICAgIHt2YWx1ZTogJ25ldycsIHdyaXRhYmxlOiB0cnVlfVxuICAgICk7XG5cbiAgICB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJlZENhbmRpZGF0ZUV2ZW50cyA9IFtdO1xuICAgIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlckNhbmRpZGF0ZXMgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgdmFyIGVuZCA9ICFldmVudC5jYW5kaWRhdGUgfHwgT2JqZWN0LmtleXMoZXZlbnQuY2FuZGlkYXRlKS5sZW5ndGggPT09IDA7XG4gICAgICAvLyBwb2x5ZmlsbCBzaW5jZSBSVENJY2VHYXRoZXJlci5zdGF0ZSBpcyBub3QgaW1wbGVtZW50ZWQgaW5cbiAgICAgIC8vIEVkZ2UgMTA1NDcgeWV0LlxuICAgICAgaWNlR2F0aGVyZXIuc3RhdGUgPSBlbmQgPyAnY29tcGxldGVkJyA6ICdnYXRoZXJpbmcnO1xuICAgICAgaWYgKHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJlZENhbmRpZGF0ZUV2ZW50cyAhPT0gbnVsbCkge1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyZWRDYW5kaWRhdGVFdmVudHMucHVzaChldmVudCk7XG4gICAgICB9XG4gICAgfTtcbiAgICBpY2VHYXRoZXJlci5hZGRFdmVudExpc3RlbmVyKCdsb2NhbGNhbmRpZGF0ZScsXG4gICAgICB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5idWZmZXJDYW5kaWRhdGVzKTtcbiAgICByZXR1cm4gaWNlR2F0aGVyZXI7XG4gIH07XG5cbiAgLy8gc3RhcnQgZ2F0aGVyaW5nIGZyb20gYW4gUlRDSWNlR2F0aGVyZXIuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fZ2F0aGVyID0gZnVuY3Rpb24obWlkLCBzZHBNTGluZUluZGV4KSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICB2YXIgaWNlR2F0aGVyZXIgPSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VHYXRoZXJlcjtcbiAgICBpZiAoaWNlR2F0aGVyZXIub25sb2NhbGNhbmRpZGF0ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgYnVmZmVyZWRDYW5kaWRhdGVFdmVudHMgPVxuICAgICAgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyZWRDYW5kaWRhdGVFdmVudHM7XG4gICAgdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uYnVmZmVyZWRDYW5kaWRhdGVFdmVudHMgPSBudWxsO1xuICAgIGljZUdhdGhlcmVyLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvY2FsY2FuZGlkYXRlJyxcbiAgICAgIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmJ1ZmZlckNhbmRpZGF0ZXMpO1xuICAgIGljZUdhdGhlcmVyLm9ubG9jYWxjYW5kaWRhdGUgPSBmdW5jdGlvbihldnQpIHtcbiAgICAgIGlmIChwYy51c2luZ0J1bmRsZSAmJiBzZHBNTGluZUluZGV4ID4gMCkge1xuICAgICAgICAvLyBpZiB3ZSBrbm93IHRoYXQgd2UgdXNlIGJ1bmRsZSB3ZSBjYW4gZHJvcCBjYW5kaWRhdGVzIHdpdGhcbiAgICAgICAgLy8g0ZVkcE1MaW5lSW5kZXggPiAwLiBJZiB3ZSBkb24ndCBkbyB0aGlzIHRoZW4gb3VyIHN0YXRlIGdldHNcbiAgICAgICAgLy8gY29uZnVzZWQgc2luY2Ugd2UgZGlzcG9zZSB0aGUgZXh0cmEgaWNlIGdhdGhlcmVyLlxuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ2ljZWNhbmRpZGF0ZScpO1xuICAgICAgZXZlbnQuY2FuZGlkYXRlID0ge3NkcE1pZDogbWlkLCBzZHBNTGluZUluZGV4OiBzZHBNTGluZUluZGV4fTtcblxuICAgICAgdmFyIGNhbmQgPSBldnQuY2FuZGlkYXRlO1xuICAgICAgLy8gRWRnZSBlbWl0cyBhbiBlbXB0eSBvYmplY3QgZm9yIFJUQ0ljZUNhbmRpZGF0ZUNvbXBsZXRl4oClXG4gICAgICB2YXIgZW5kID0gIWNhbmQgfHwgT2JqZWN0LmtleXMoY2FuZCkubGVuZ3RoID09PSAwO1xuICAgICAgaWYgKGVuZCkge1xuICAgICAgICAvLyBwb2x5ZmlsbCBzaW5jZSBSVENJY2VHYXRoZXJlci5zdGF0ZSBpcyBub3QgaW1wbGVtZW50ZWQgaW5cbiAgICAgICAgLy8gRWRnZSAxMDU0NyB5ZXQuXG4gICAgICAgIGlmIChpY2VHYXRoZXJlci5zdGF0ZSA9PT0gJ25ldycgfHwgaWNlR2F0aGVyZXIuc3RhdGUgPT09ICdnYXRoZXJpbmcnKSB7XG4gICAgICAgICAgaWNlR2F0aGVyZXIuc3RhdGUgPSAnY29tcGxldGVkJztcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKGljZUdhdGhlcmVyLnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgIGljZUdhdGhlcmVyLnN0YXRlID0gJ2dhdGhlcmluZyc7XG4gICAgICAgIH1cbiAgICAgICAgLy8gUlRDSWNlQ2FuZGlkYXRlIGRvZXNuJ3QgaGF2ZSBhIGNvbXBvbmVudCwgbmVlZHMgdG8gYmUgYWRkZWRcbiAgICAgICAgY2FuZC5jb21wb25lbnQgPSAxO1xuICAgICAgICAvLyBhbHNvIHRoZSB1c2VybmFtZUZyYWdtZW50LiBUT0RPOiB1cGRhdGUgU0RQIHRvIHRha2UgYm90aCB2YXJpYW50cy5cbiAgICAgICAgY2FuZC51ZnJhZyA9IGljZUdhdGhlcmVyLmdldExvY2FsUGFyYW1ldGVycygpLnVzZXJuYW1lRnJhZ21lbnQ7XG5cbiAgICAgICAgdmFyIHNlcmlhbGl6ZWRDYW5kaWRhdGUgPSBTRFBVdGlscy53cml0ZUNhbmRpZGF0ZShjYW5kKTtcbiAgICAgICAgZXZlbnQuY2FuZGlkYXRlID0gT2JqZWN0LmFzc2lnbihldmVudC5jYW5kaWRhdGUsXG4gICAgICAgICAgICBTRFBVdGlscy5wYXJzZUNhbmRpZGF0ZShzZXJpYWxpemVkQ2FuZGlkYXRlKSk7XG5cbiAgICAgICAgZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSA9IHNlcmlhbGl6ZWRDYW5kaWRhdGU7XG4gICAgICAgIGV2ZW50LmNhbmRpZGF0ZS50b0pTT04gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgY2FuZGlkYXRlOiBldmVudC5jYW5kaWRhdGUuY2FuZGlkYXRlLFxuICAgICAgICAgICAgc2RwTWlkOiBldmVudC5jYW5kaWRhdGUuc2RwTWlkLFxuICAgICAgICAgICAgc2RwTUxpbmVJbmRleDogZXZlbnQuY2FuZGlkYXRlLnNkcE1MaW5lSW5kZXgsXG4gICAgICAgICAgICB1c2VybmFtZUZyYWdtZW50OiBldmVudC5jYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudFxuICAgICAgICAgIH07XG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIHVwZGF0ZSBsb2NhbCBkZXNjcmlwdGlvbi5cbiAgICAgIHZhciBzZWN0aW9ucyA9IFNEUFV0aWxzLmdldE1lZGlhU2VjdGlvbnMocGMuX2xvY2FsRGVzY3JpcHRpb24uc2RwKTtcbiAgICAgIGlmICghZW5kKSB7XG4gICAgICAgIHNlY3Rpb25zW2V2ZW50LmNhbmRpZGF0ZS5zZHBNTGluZUluZGV4XSArPVxuICAgICAgICAgICAgJ2E9JyArIGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUgKyAnXFxyXFxuJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlY3Rpb25zW2V2ZW50LmNhbmRpZGF0ZS5zZHBNTGluZUluZGV4XSArPVxuICAgICAgICAgICAgJ2E9ZW5kLW9mLWNhbmRpZGF0ZXNcXHJcXG4nO1xuICAgICAgfVxuICAgICAgcGMuX2xvY2FsRGVzY3JpcHRpb24uc2RwID1cbiAgICAgICAgICBTRFBVdGlscy5nZXREZXNjcmlwdGlvbihwYy5fbG9jYWxEZXNjcmlwdGlvbi5zZHApICtcbiAgICAgICAgICBzZWN0aW9ucy5qb2luKCcnKTtcbiAgICAgIHZhciBjb21wbGV0ZSA9IHBjLnRyYW5zY2VpdmVycy5ldmVyeShmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgICByZXR1cm4gdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyLnN0YXRlID09PSAnY29tcGxldGVkJztcbiAgICAgIH0pO1xuXG4gICAgICBpZiAocGMuaWNlR2F0aGVyaW5nU3RhdGUgIT09ICdnYXRoZXJpbmcnKSB7XG4gICAgICAgIHBjLmljZUdhdGhlcmluZ1N0YXRlID0gJ2dhdGhlcmluZyc7XG4gICAgICAgIHBjLl9lbWl0R2F0aGVyaW5nU3RhdGVDaGFuZ2UoKTtcbiAgICAgIH1cblxuICAgICAgLy8gRW1pdCBjYW5kaWRhdGUuIEFsc28gZW1pdCBudWxsIGNhbmRpZGF0ZSB3aGVuIGFsbCBnYXRoZXJlcnMgYXJlXG4gICAgICAvLyBjb21wbGV0ZS5cbiAgICAgIGlmICghZW5kKSB7XG4gICAgICAgIHBjLl9kaXNwYXRjaEV2ZW50KCdpY2VjYW5kaWRhdGUnLCBldmVudCk7XG4gICAgICB9XG4gICAgICBpZiAoY29tcGxldGUpIHtcbiAgICAgICAgcGMuX2Rpc3BhdGNoRXZlbnQoJ2ljZWNhbmRpZGF0ZScsIG5ldyBFdmVudCgnaWNlY2FuZGlkYXRlJykpO1xuICAgICAgICBwYy5pY2VHYXRoZXJpbmdTdGF0ZSA9ICdjb21wbGV0ZSc7XG4gICAgICAgIHBjLl9lbWl0R2F0aGVyaW5nU3RhdGVDaGFuZ2UoKTtcbiAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gZW1pdCBhbHJlYWR5IGdhdGhlcmVkIGNhbmRpZGF0ZXMuXG4gICAgd2luZG93LnNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBidWZmZXJlZENhbmRpZGF0ZUV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWNlR2F0aGVyZXIub25sb2NhbGNhbmRpZGF0ZShlKTtcbiAgICAgIH0pO1xuICAgIH0sIDApO1xuICB9O1xuXG4gIC8vIENyZWF0ZSBJQ0UgdHJhbnNwb3J0IGFuZCBEVExTIHRyYW5zcG9ydC5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9jcmVhdGVJY2VBbmREdGxzVHJhbnNwb3J0cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgdmFyIGljZVRyYW5zcG9ydCA9IG5ldyB3aW5kb3cuUlRDSWNlVHJhbnNwb3J0KG51bGwpO1xuICAgIGljZVRyYW5zcG9ydC5vbmljZXN0YXRlY2hhbmdlID0gZnVuY3Rpb24oKSB7XG4gICAgICBwYy5fdXBkYXRlSWNlQ29ubmVjdGlvblN0YXRlKCk7XG4gICAgICBwYy5fdXBkYXRlQ29ubmVjdGlvblN0YXRlKCk7XG4gICAgfTtcblxuICAgIHZhciBkdGxzVHJhbnNwb3J0ID0gbmV3IHdpbmRvdy5SVENEdGxzVHJhbnNwb3J0KGljZVRyYW5zcG9ydCk7XG4gICAgZHRsc1RyYW5zcG9ydC5vbmR0bHNzdGF0ZWNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcGMuX3VwZGF0ZUNvbm5lY3Rpb25TdGF0ZSgpO1xuICAgIH07XG4gICAgZHRsc1RyYW5zcG9ydC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICAvLyBvbmVycm9yIGRvZXMgbm90IHNldCBzdGF0ZSB0byBmYWlsZWQgYnkgaXRzZWxmLlxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGR0bHNUcmFuc3BvcnQsICdzdGF0ZScsXG4gICAgICAgICAge3ZhbHVlOiAnZmFpbGVkJywgd3JpdGFibGU6IHRydWV9KTtcbiAgICAgIHBjLl91cGRhdGVDb25uZWN0aW9uU3RhdGUoKTtcbiAgICB9O1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIGljZVRyYW5zcG9ydDogaWNlVHJhbnNwb3J0LFxuICAgICAgZHRsc1RyYW5zcG9ydDogZHRsc1RyYW5zcG9ydFxuICAgIH07XG4gIH07XG5cbiAgLy8gRGVzdHJveSBJQ0UgZ2F0aGVyZXIsIElDRSB0cmFuc3BvcnQgYW5kIERUTFMgdHJhbnNwb3J0LlxuICAvLyBXaXRob3V0IHRyaWdnZXJpbmcgdGhlIGNhbGxiYWNrcy5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl9kaXNwb3NlSWNlQW5kRHRsc1RyYW5zcG9ydHMgPSBmdW5jdGlvbihcbiAgICAgIHNkcE1MaW5lSW5kZXgpIHtcbiAgICB2YXIgaWNlR2F0aGVyZXIgPSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VHYXRoZXJlcjtcbiAgICBpZiAoaWNlR2F0aGVyZXIpIHtcbiAgICAgIGRlbGV0ZSBpY2VHYXRoZXJlci5vbmxvY2FsY2FuZGlkYXRlO1xuICAgICAgZGVsZXRlIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmljZUdhdGhlcmVyO1xuICAgIH1cbiAgICB2YXIgaWNlVHJhbnNwb3J0ID0gdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uaWNlVHJhbnNwb3J0O1xuICAgIGlmIChpY2VUcmFuc3BvcnQpIHtcbiAgICAgIGRlbGV0ZSBpY2VUcmFuc3BvcnQub25pY2VzdGF0ZWNoYW5nZTtcbiAgICAgIGRlbGV0ZSB0aGlzLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VUcmFuc3BvcnQ7XG4gICAgfVxuICAgIHZhciBkdGxzVHJhbnNwb3J0ID0gdGhpcy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0uZHRsc1RyYW5zcG9ydDtcbiAgICBpZiAoZHRsc1RyYW5zcG9ydCkge1xuICAgICAgZGVsZXRlIGR0bHNUcmFuc3BvcnQub25kdGxzc3RhdGVjaGFuZ2U7XG4gICAgICBkZWxldGUgZHRsc1RyYW5zcG9ydC5vbmVycm9yO1xuICAgICAgZGVsZXRlIHRoaXMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmR0bHNUcmFuc3BvcnQ7XG4gICAgfVxuICB9O1xuXG4gIC8vIFN0YXJ0IHRoZSBSVFAgU2VuZGVyIGFuZCBSZWNlaXZlciBmb3IgYSB0cmFuc2NlaXZlci5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl90cmFuc2NlaXZlID0gZnVuY3Rpb24odHJhbnNjZWl2ZXIsXG4gICAgICBzZW5kLCByZWN2KSB7XG4gICAgdmFyIHBhcmFtcyA9IGdldENvbW1vbkNhcGFiaWxpdGllcyh0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcyxcbiAgICAgICAgdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzKTtcbiAgICBpZiAoc2VuZCAmJiB0cmFuc2NlaXZlci5ydHBTZW5kZXIpIHtcbiAgICAgIHBhcmFtcy5lbmNvZGluZ3MgPSB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgcGFyYW1zLnJ0Y3AgPSB7XG4gICAgICAgIGNuYW1lOiBTRFBVdGlscy5sb2NhbENOYW1lLFxuICAgICAgICBjb21wb3VuZDogdHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMuY29tcG91bmRcbiAgICAgIH07XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVycy5sZW5ndGgpIHtcbiAgICAgICAgcGFyYW1zLnJ0Y3Auc3NyYyA9IHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYztcbiAgICAgIH1cbiAgICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci5zZW5kKHBhcmFtcyk7XG4gICAgfVxuICAgIGlmIChyZWN2ICYmIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyICYmIHBhcmFtcy5jb2RlY3MubGVuZ3RoID4gMCkge1xuICAgICAgLy8gcmVtb3ZlIFJUWCBmaWVsZCBpbiBFZGdlIDE0OTQyXG4gICAgICBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ3ZpZGVvJ1xuICAgICAgICAgICYmIHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnNcbiAgICAgICAgICAmJiBlZGdlVmVyc2lvbiA8IDE1MDE5KSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnMuZm9yRWFjaChmdW5jdGlvbihwKSB7XG4gICAgICAgICAgZGVsZXRlIHAucnR4O1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICh0cmFuc2NlaXZlci5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzLmxlbmd0aCkge1xuICAgICAgICBwYXJhbXMuZW5jb2RpbmdzID0gdHJhbnNjZWl2ZXIucmVjdkVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcmFtcy5lbmNvZGluZ3MgPSBbe31dO1xuICAgICAgfVxuICAgICAgcGFyYW1zLnJ0Y3AgPSB7XG4gICAgICAgIGNvbXBvdW5kOiB0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycy5jb21wb3VuZFxuICAgICAgfTtcbiAgICAgIGlmICh0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycy5jbmFtZSkge1xuICAgICAgICBwYXJhbXMucnRjcC5jbmFtZSA9IHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzLmNuYW1lO1xuICAgICAgfVxuICAgICAgaWYgKHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnMubGVuZ3RoKSB7XG4gICAgICAgIHBhcmFtcy5ydGNwLnNzcmMgPSB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmM7XG4gICAgICB9XG4gICAgICB0cmFuc2NlaXZlci5ydHBSZWNlaXZlci5yZWNlaXZlKHBhcmFtcyk7XG4gICAgfVxuICB9O1xuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRMb2NhbERlc2NyaXB0aW9uID0gZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuXG4gICAgLy8gTm90ZTogcHJhbnN3ZXIgaXMgbm90IHN1cHBvcnRlZC5cbiAgICBpZiAoWydvZmZlcicsICdhbnN3ZXInXS5pbmRleE9mKGRlc2NyaXB0aW9uLnR5cGUpID09PSAtMSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignVHlwZUVycm9yJyxcbiAgICAgICAgICAnVW5zdXBwb3J0ZWQgdHlwZSBcIicgKyBkZXNjcmlwdGlvbi50eXBlICsgJ1wiJykpO1xuICAgIH1cblxuICAgIGlmICghaXNBY3Rpb25BbGxvd2VkSW5TaWduYWxpbmdTdGF0ZSgnc2V0TG9jYWxEZXNjcmlwdGlvbicsXG4gICAgICAgIGRlc2NyaXB0aW9uLnR5cGUsIHBjLnNpZ25hbGluZ1N0YXRlKSB8fCBwYy5faXNDbG9zZWQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQ2FuIG5vdCBzZXQgbG9jYWwgJyArIGRlc2NyaXB0aW9uLnR5cGUgK1xuICAgICAgICAgICcgaW4gc3RhdGUgJyArIHBjLnNpZ25hbGluZ1N0YXRlKSk7XG4gICAgfVxuXG4gICAgdmFyIHNlY3Rpb25zO1xuICAgIHZhciBzZXNzaW9ucGFydDtcbiAgICBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJ29mZmVyJykge1xuICAgICAgLy8gVkVSWSBsaW1pdGVkIHN1cHBvcnQgZm9yIFNEUCBtdW5naW5nLiBMaW1pdGVkIHRvOlxuICAgICAgLy8gKiBjaGFuZ2luZyB0aGUgb3JkZXIgb2YgY29kZWNzXG4gICAgICBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoZGVzY3JpcHRpb24uc2RwKTtcbiAgICAgIHNlc3Npb25wYXJ0ID0gc2VjdGlvbnMuc2hpZnQoKTtcbiAgICAgIHNlY3Rpb25zLmZvckVhY2goZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICAgIHZhciBjYXBzID0gU0RQVXRpbHMucGFyc2VSdHBQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5sb2NhbENhcGFiaWxpdGllcyA9IGNhcHM7XG4gICAgICB9KTtcblxuICAgICAgcGMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIsIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgICAgcGMuX2dhdGhlcih0cmFuc2NlaXZlci5taWQsIHNkcE1MaW5lSW5kZXgpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnYW5zd2VyJykge1xuICAgICAgc2VjdGlvbnMgPSBTRFBVdGlscy5zcGxpdFNlY3Rpb25zKHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHApO1xuICAgICAgc2Vzc2lvbnBhcnQgPSBzZWN0aW9ucy5zaGlmdCgpO1xuICAgICAgdmFyIGlzSWNlTGl0ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KHNlc3Npb25wYXJ0LFxuICAgICAgICAgICdhPWljZS1saXRlJykubGVuZ3RoID4gMDtcbiAgICAgIHNlY3Rpb25zLmZvckVhY2goZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICAgIHZhciB0cmFuc2NlaXZlciA9IHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XTtcbiAgICAgICAgdmFyIGljZUdhdGhlcmVyID0gdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXI7XG4gICAgICAgIHZhciBpY2VUcmFuc3BvcnQgPSB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQ7XG4gICAgICAgIHZhciBkdGxzVHJhbnNwb3J0ID0gdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydDtcbiAgICAgICAgdmFyIGxvY2FsQ2FwYWJpbGl0aWVzID0gdHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXM7XG4gICAgICAgIHZhciByZW1vdGVDYXBhYmlsaXRpZXMgPSB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXM7XG5cbiAgICAgICAgLy8gdHJlYXQgYnVuZGxlLW9ubHkgYXMgbm90LXJlamVjdGVkLlxuICAgICAgICB2YXIgcmVqZWN0ZWQgPSBTRFBVdGlscy5pc1JlamVjdGVkKG1lZGlhU2VjdGlvbikgJiZcbiAgICAgICAgICAgIFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9YnVuZGxlLW9ubHknKS5sZW5ndGggPT09IDA7XG5cbiAgICAgICAgaWYgKCFyZWplY3RlZCAmJiAhdHJhbnNjZWl2ZXIucmVqZWN0ZWQpIHtcbiAgICAgICAgICB2YXIgcmVtb3RlSWNlUGFyYW1ldGVycyA9IFNEUFV0aWxzLmdldEljZVBhcmFtZXRlcnMoXG4gICAgICAgICAgICAgIG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpO1xuICAgICAgICAgIHZhciByZW1vdGVEdGxzUGFyYW1ldGVycyA9IFNEUFV0aWxzLmdldER0bHNQYXJhbWV0ZXJzKFxuICAgICAgICAgICAgICBtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KTtcbiAgICAgICAgICBpZiAoaXNJY2VMaXRlKSB7XG4gICAgICAgICAgICByZW1vdGVEdGxzUGFyYW1ldGVycy5yb2xlID0gJ3NlcnZlcic7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKCFwYy51c2luZ0J1bmRsZSB8fCBzZHBNTGluZUluZGV4ID09PSAwKSB7XG4gICAgICAgICAgICBwYy5fZ2F0aGVyKHRyYW5zY2VpdmVyLm1pZCwgc2RwTUxpbmVJbmRleCk7XG4gICAgICAgICAgICBpZiAoaWNlVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgICAgICBpY2VUcmFuc3BvcnQuc3RhcnQoaWNlR2F0aGVyZXIsIHJlbW90ZUljZVBhcmFtZXRlcnMsXG4gICAgICAgICAgICAgICAgICBpc0ljZUxpdGUgPyAnY29udHJvbGxpbmcnIDogJ2NvbnRyb2xsZWQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkdGxzVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgICAgICBkdGxzVHJhbnNwb3J0LnN0YXJ0KHJlbW90ZUR0bHNQYXJhbWV0ZXJzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG5cbiAgICAgICAgICAvLyBDYWxjdWxhdGUgaW50ZXJzZWN0aW9uIG9mIGNhcGFiaWxpdGllcy5cbiAgICAgICAgICB2YXIgcGFyYW1zID0gZ2V0Q29tbW9uQ2FwYWJpbGl0aWVzKGxvY2FsQ2FwYWJpbGl0aWVzLFxuICAgICAgICAgICAgICByZW1vdGVDYXBhYmlsaXRpZXMpO1xuXG4gICAgICAgICAgLy8gU3RhcnQgdGhlIFJUQ1J0cFNlbmRlci4gVGhlIFJUQ1J0cFJlY2VpdmVyIGZvciB0aGlzXG4gICAgICAgICAgLy8gdHJhbnNjZWl2ZXIgaGFzIGFscmVhZHkgYmVlbiBzdGFydGVkIGluIHNldFJlbW90ZURlc2NyaXB0aW9uLlxuICAgICAgICAgIHBjLl90cmFuc2NlaXZlKHRyYW5zY2VpdmVyLFxuICAgICAgICAgICAgICBwYXJhbXMuY29kZWNzLmxlbmd0aCA+IDAsXG4gICAgICAgICAgICAgIGZhbHNlKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcGMuX2xvY2FsRGVzY3JpcHRpb24gPSB7XG4gICAgICB0eXBlOiBkZXNjcmlwdGlvbi50eXBlLFxuICAgICAgc2RwOiBkZXNjcmlwdGlvbi5zZHBcbiAgICB9O1xuICAgIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnb2ZmZXInKSB7XG4gICAgICBwYy5fdXBkYXRlU2lnbmFsaW5nU3RhdGUoJ2hhdmUtbG9jYWwtb2ZmZXInKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcGMuX3VwZGF0ZVNpZ25hbGluZ1N0YXRlKCdzdGFibGUnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uID0gZnVuY3Rpb24oZGVzY3JpcHRpb24pIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuXG4gICAgLy8gTm90ZTogcHJhbnN3ZXIgaXMgbm90IHN1cHBvcnRlZC5cbiAgICBpZiAoWydvZmZlcicsICdhbnN3ZXInXS5pbmRleE9mKGRlc2NyaXB0aW9uLnR5cGUpID09PSAtMSkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignVHlwZUVycm9yJyxcbiAgICAgICAgICAnVW5zdXBwb3J0ZWQgdHlwZSBcIicgKyBkZXNjcmlwdGlvbi50eXBlICsgJ1wiJykpO1xuICAgIH1cblxuICAgIGlmICghaXNBY3Rpb25BbGxvd2VkSW5TaWduYWxpbmdTdGF0ZSgnc2V0UmVtb3RlRGVzY3JpcHRpb24nLFxuICAgICAgICBkZXNjcmlwdGlvbi50eXBlLCBwYy5zaWduYWxpbmdTdGF0ZSkgfHwgcGMuX2lzQ2xvc2VkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0NhbiBub3Qgc2V0IHJlbW90ZSAnICsgZGVzY3JpcHRpb24udHlwZSArXG4gICAgICAgICAgJyBpbiBzdGF0ZSAnICsgcGMuc2lnbmFsaW5nU3RhdGUpKTtcbiAgICB9XG5cbiAgICB2YXIgc3RyZWFtcyA9IHt9O1xuICAgIHBjLnJlbW90ZVN0cmVhbXMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIHN0cmVhbXNbc3RyZWFtLmlkXSA9IHN0cmVhbTtcbiAgICB9KTtcbiAgICB2YXIgcmVjZWl2ZXJMaXN0ID0gW107XG4gICAgdmFyIHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhkZXNjcmlwdGlvbi5zZHApO1xuICAgIHZhciBzZXNzaW9ucGFydCA9IHNlY3Rpb25zLnNoaWZ0KCk7XG4gICAgdmFyIGlzSWNlTGl0ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KHNlc3Npb25wYXJ0LFxuICAgICAgICAnYT1pY2UtbGl0ZScpLmxlbmd0aCA+IDA7XG4gICAgdmFyIHVzaW5nQnVuZGxlID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoc2Vzc2lvbnBhcnQsXG4gICAgICAgICdhPWdyb3VwOkJVTkRMRSAnKS5sZW5ndGggPiAwO1xuICAgIHBjLnVzaW5nQnVuZGxlID0gdXNpbmdCdW5kbGU7XG4gICAgdmFyIGljZU9wdGlvbnMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChzZXNzaW9ucGFydCxcbiAgICAgICAgJ2E9aWNlLW9wdGlvbnM6JylbMF07XG4gICAgaWYgKGljZU9wdGlvbnMpIHtcbiAgICAgIHBjLmNhblRyaWNrbGVJY2VDYW5kaWRhdGVzID0gaWNlT3B0aW9ucy5zdWJzdHIoMTQpLnNwbGl0KCcgJylcbiAgICAgICAgICAuaW5kZXhPZigndHJpY2tsZScpID49IDA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBjLmNhblRyaWNrbGVJY2VDYW5kaWRhdGVzID0gZmFsc2U7XG4gICAgfVxuXG4gICAgc2VjdGlvbnMuZm9yRWFjaChmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgIHZhciBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgICAgIHZhciBraW5kID0gU0RQVXRpbHMuZ2V0S2luZChtZWRpYVNlY3Rpb24pO1xuICAgICAgLy8gdHJlYXQgYnVuZGxlLW9ubHkgYXMgbm90LXJlamVjdGVkLlxuICAgICAgdmFyIHJlamVjdGVkID0gU0RQVXRpbHMuaXNSZWplY3RlZChtZWRpYVNlY3Rpb24pICYmXG4gICAgICAgICAgU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1idW5kbGUtb25seScpLmxlbmd0aCA9PT0gMDtcbiAgICAgIHZhciBwcm90b2NvbCA9IGxpbmVzWzBdLnN1YnN0cigyKS5zcGxpdCgnICcpWzJdO1xuXG4gICAgICB2YXIgZGlyZWN0aW9uID0gU0RQVXRpbHMuZ2V0RGlyZWN0aW9uKG1lZGlhU2VjdGlvbiwgc2Vzc2lvbnBhcnQpO1xuICAgICAgdmFyIHJlbW90ZU1zaWQgPSBTRFBVdGlscy5wYXJzZU1zaWQobWVkaWFTZWN0aW9uKTtcblxuICAgICAgdmFyIG1pZCA9IFNEUFV0aWxzLmdldE1pZChtZWRpYVNlY3Rpb24pIHx8IFNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllcigpO1xuXG4gICAgICAvLyBSZWplY3QgZGF0YWNoYW5uZWxzIHdoaWNoIGFyZSBub3QgaW1wbGVtZW50ZWQgeWV0LlxuICAgICAgaWYgKChraW5kID09PSAnYXBwbGljYXRpb24nICYmIHByb3RvY29sID09PSAnRFRMUy9TQ1RQJykgfHwgcmVqZWN0ZWQpIHtcbiAgICAgICAgLy8gVE9ETzogdGhpcyBpcyBkYW5nZXJvdXMgaW4gdGhlIGNhc2Ugd2hlcmUgYSBub24tcmVqZWN0ZWQgbS1saW5lXG4gICAgICAgIC8vICAgICBiZWNvbWVzIHJlamVjdGVkLlxuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0gPSB7XG4gICAgICAgICAgbWlkOiBtaWQsXG4gICAgICAgICAga2luZDoga2luZCxcbiAgICAgICAgICByZWplY3RlZDogdHJ1ZVxuICAgICAgICB9O1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICghcmVqZWN0ZWQgJiYgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdICYmXG4gICAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJlamVjdGVkKSB7XG4gICAgICAgIC8vIHJlY3ljbGUgYSByZWplY3RlZCB0cmFuc2NlaXZlci5cbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdID0gcGMuX2NyZWF0ZVRyYW5zY2VpdmVyKGtpbmQsIHRydWUpO1xuICAgICAgfVxuXG4gICAgICB2YXIgdHJhbnNjZWl2ZXI7XG4gICAgICB2YXIgaWNlR2F0aGVyZXI7XG4gICAgICB2YXIgaWNlVHJhbnNwb3J0O1xuICAgICAgdmFyIGR0bHNUcmFuc3BvcnQ7XG4gICAgICB2YXIgcnRwUmVjZWl2ZXI7XG4gICAgICB2YXIgc2VuZEVuY29kaW5nUGFyYW1ldGVycztcbiAgICAgIHZhciByZWN2RW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgdmFyIGxvY2FsQ2FwYWJpbGl0aWVzO1xuXG4gICAgICB2YXIgdHJhY2s7XG4gICAgICAvLyBGSVhNRTogZW5zdXJlIHRoZSBtZWRpYVNlY3Rpb24gaGFzIHJ0Y3AtbXV4IHNldC5cbiAgICAgIHZhciByZW1vdGVDYXBhYmlsaXRpZXMgPSBTRFBVdGlscy5wYXJzZVJ0cFBhcmFtZXRlcnMobWVkaWFTZWN0aW9uKTtcbiAgICAgIHZhciByZW1vdGVJY2VQYXJhbWV0ZXJzO1xuICAgICAgdmFyIHJlbW90ZUR0bHNQYXJhbWV0ZXJzO1xuICAgICAgaWYgKCFyZWplY3RlZCkge1xuICAgICAgICByZW1vdGVJY2VQYXJhbWV0ZXJzID0gU0RQVXRpbHMuZ2V0SWNlUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24sXG4gICAgICAgICAgICBzZXNzaW9ucGFydCk7XG4gICAgICAgIHJlbW90ZUR0bHNQYXJhbWV0ZXJzID0gU0RQVXRpbHMuZ2V0RHRsc1BhcmFtZXRlcnMobWVkaWFTZWN0aW9uLFxuICAgICAgICAgICAgc2Vzc2lvbnBhcnQpO1xuICAgICAgICByZW1vdGVEdGxzUGFyYW1ldGVycy5yb2xlID0gJ2NsaWVudCc7XG4gICAgICB9XG4gICAgICByZWN2RW5jb2RpbmdQYXJhbWV0ZXJzID1cbiAgICAgICAgICBTRFBVdGlscy5wYXJzZVJ0cEVuY29kaW5nUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuXG4gICAgICB2YXIgcnRjcFBhcmFtZXRlcnMgPSBTRFBVdGlscy5wYXJzZVJ0Y3BQYXJhbWV0ZXJzKG1lZGlhU2VjdGlvbik7XG5cbiAgICAgIHZhciBpc0NvbXBsZXRlID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLFxuICAgICAgICAgICdhPWVuZC1vZi1jYW5kaWRhdGVzJywgc2Vzc2lvbnBhcnQpLmxlbmd0aCA+IDA7XG4gICAgICB2YXIgY2FuZHMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWNhbmRpZGF0ZTonKVxuICAgICAgICAgIC5tYXAoZnVuY3Rpb24oY2FuZCkge1xuICAgICAgICAgICAgcmV0dXJuIFNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlKGNhbmQpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmZpbHRlcihmdW5jdGlvbihjYW5kKSB7XG4gICAgICAgICAgICByZXR1cm4gY2FuZC5jb21wb25lbnQgPT09IDE7XG4gICAgICAgICAgfSk7XG5cbiAgICAgIC8vIENoZWNrIGlmIHdlIGNhbiB1c2UgQlVORExFIGFuZCBkaXNwb3NlIHRyYW5zcG9ydHMuXG4gICAgICBpZiAoKGRlc2NyaXB0aW9uLnR5cGUgPT09ICdvZmZlcicgfHwgZGVzY3JpcHRpb24udHlwZSA9PT0gJ2Fuc3dlcicpICYmXG4gICAgICAgICAgIXJlamVjdGVkICYmIHVzaW5nQnVuZGxlICYmIHNkcE1MaW5lSW5kZXggPiAwICYmXG4gICAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdKSB7XG4gICAgICAgIHBjLl9kaXNwb3NlSWNlQW5kRHRsc1RyYW5zcG9ydHMoc2RwTUxpbmVJbmRleCk7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VHYXRoZXJlciA9XG4gICAgICAgICAgICBwYy50cmFuc2NlaXZlcnNbMF0uaWNlR2F0aGVyZXI7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5pY2VUcmFuc3BvcnQgPVxuICAgICAgICAgICAgcGMudHJhbnNjZWl2ZXJzWzBdLmljZVRyYW5zcG9ydDtcbiAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLmR0bHNUcmFuc3BvcnQgPVxuICAgICAgICAgICAgcGMudHJhbnNjZWl2ZXJzWzBdLmR0bHNUcmFuc3BvcnQ7XG4gICAgICAgIGlmIChwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucnRwU2VuZGVyKSB7XG4gICAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJ0cFNlbmRlci5zZXRUcmFuc3BvcnQoXG4gICAgICAgICAgICAgIHBjLnRyYW5zY2VpdmVyc1swXS5kdGxzVHJhbnNwb3J0KTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJ0cFJlY2VpdmVyKSB7XG4gICAgICAgICAgcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdLnJ0cFJlY2VpdmVyLnNldFRyYW5zcG9ydChcbiAgICAgICAgICAgICAgcGMudHJhbnNjZWl2ZXJzWzBdLmR0bHNUcmFuc3BvcnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoZGVzY3JpcHRpb24udHlwZSA9PT0gJ29mZmVyJyAmJiAhcmVqZWN0ZWQpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIgPSBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0gfHxcbiAgICAgICAgICAgIHBjLl9jcmVhdGVUcmFuc2NlaXZlcihraW5kKTtcbiAgICAgICAgdHJhbnNjZWl2ZXIubWlkID0gbWlkO1xuXG4gICAgICAgIGlmICghdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXIpIHtcbiAgICAgICAgICB0cmFuc2NlaXZlci5pY2VHYXRoZXJlciA9IHBjLl9jcmVhdGVJY2VHYXRoZXJlcihzZHBNTGluZUluZGV4LFxuICAgICAgICAgICAgICB1c2luZ0J1bmRsZSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoY2FuZHMubGVuZ3RoICYmIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICBpZiAoaXNDb21wbGV0ZSAmJiAoIXVzaW5nQnVuZGxlIHx8IHNkcE1MaW5lSW5kZXggPT09IDApKSB7XG4gICAgICAgICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuc2V0UmVtb3RlQ2FuZGlkYXRlcyhjYW5kcyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbmRzLmZvckVhY2goZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gICAgICAgICAgICAgIG1heWJlQWRkQ2FuZGlkYXRlKHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCwgY2FuZGlkYXRlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzID0gd2luZG93LlJUQ1J0cFJlY2VpdmVyLmdldENhcGFiaWxpdGllcyhraW5kKTtcblxuICAgICAgICAvLyBmaWx0ZXIgUlRYIHVudGlsIGFkZGl0aW9uYWwgc3R1ZmYgbmVlZGVkIGZvciBSVFggaXMgaW1wbGVtZW50ZWRcbiAgICAgICAgLy8gaW4gYWRhcHRlci5qc1xuICAgICAgICBpZiAoZWRnZVZlcnNpb24gPCAxNTAxOSkge1xuICAgICAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcyA9IGxvY2FsQ2FwYWJpbGl0aWVzLmNvZGVjcy5maWx0ZXIoXG4gICAgICAgICAgICAgIGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvZGVjLm5hbWUgIT09ICdydHgnO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgPSB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzIHx8IFt7XG4gICAgICAgICAgc3NyYzogKDIgKiBzZHBNTGluZUluZGV4ICsgMikgKiAxMDAxXG4gICAgICAgIH1dO1xuXG4gICAgICAgIC8vIFRPRE86IHJld3JpdGUgdG8gdXNlIGh0dHA6Ly93M2MuZ2l0aHViLmlvL3dlYnJ0Yy1wYy8jc2V0LWFzc29jaWF0ZWQtcmVtb3RlLXN0cmVhbXNcbiAgICAgICAgdmFyIGlzTmV3VHJhY2sgPSBmYWxzZTtcbiAgICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ3NlbmRyZWN2JyB8fCBkaXJlY3Rpb24gPT09ICdzZW5kb25seScpIHtcbiAgICAgICAgICBpc05ld1RyYWNrID0gIXRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyO1xuICAgICAgICAgIHJ0cFJlY2VpdmVyID0gdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIgfHxcbiAgICAgICAgICAgICAgbmV3IHdpbmRvdy5SVENSdHBSZWNlaXZlcih0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0LCBraW5kKTtcblxuICAgICAgICAgIGlmIChpc05ld1RyYWNrKSB7XG4gICAgICAgICAgICB2YXIgc3RyZWFtO1xuICAgICAgICAgICAgdHJhY2sgPSBydHBSZWNlaXZlci50cmFjaztcbiAgICAgICAgICAgIC8vIEZJWE1FOiBkb2VzIG5vdCB3b3JrIHdpdGggUGxhbiBCLlxuICAgICAgICAgICAgaWYgKHJlbW90ZU1zaWQgJiYgcmVtb3RlTXNpZC5zdHJlYW0gPT09ICctJykge1xuICAgICAgICAgICAgICAvLyBuby1vcC4gYSBzdHJlYW0gaWQgb2YgJy0nIG1lYW5zOiBubyBhc3NvY2lhdGVkIHN0cmVhbS5cbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmVtb3RlTXNpZCkge1xuICAgICAgICAgICAgICBpZiAoIXN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dKSB7XG4gICAgICAgICAgICAgICAgc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV0gPSBuZXcgd2luZG93Lk1lZGlhU3RyZWFtKCk7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dLCAnaWQnLCB7XG4gICAgICAgICAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVtb3RlTXNpZC5zdHJlYW07XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRyYWNrLCAnaWQnLCB7XG4gICAgICAgICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiByZW1vdGVNc2lkLnRyYWNrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIHN0cmVhbSA9IHN0cmVhbXNbcmVtb3RlTXNpZC5zdHJlYW1dO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgaWYgKCFzdHJlYW1zLmRlZmF1bHQpIHtcbiAgICAgICAgICAgICAgICBzdHJlYW1zLmRlZmF1bHQgPSBuZXcgd2luZG93Lk1lZGlhU3RyZWFtKCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgc3RyZWFtID0gc3RyZWFtcy5kZWZhdWx0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHN0cmVhbSkge1xuICAgICAgICAgICAgICBhZGRUcmFja1RvU3RyZWFtQW5kRmlyZUV2ZW50KHRyYWNrLCBzdHJlYW0pO1xuICAgICAgICAgICAgICB0cmFuc2NlaXZlci5hc3NvY2lhdGVkUmVtb3RlTWVkaWFTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlY2VpdmVyTGlzdC5wdXNoKFt0cmFjaywgcnRwUmVjZWl2ZXIsIHN0cmVhbV0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBSZWNlaXZlciAmJiB0cmFuc2NlaXZlci5ydHBSZWNlaXZlci50cmFjaykge1xuICAgICAgICAgIHRyYW5zY2VpdmVyLmFzc29jaWF0ZWRSZW1vdGVNZWRpYVN0cmVhbXMuZm9yRWFjaChmdW5jdGlvbihzKSB7XG4gICAgICAgICAgICB2YXIgbmF0aXZlVHJhY2sgPSBzLmdldFRyYWNrcygpLmZpbmQoZnVuY3Rpb24odCkge1xuICAgICAgICAgICAgICByZXR1cm4gdC5pZCA9PT0gdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGlmIChuYXRpdmVUcmFjaykge1xuICAgICAgICAgICAgICByZW1vdmVUcmFja0Zyb21TdHJlYW1BbmRGaXJlRXZlbnQobmF0aXZlVHJhY2ssIHMpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHRyYW5zY2VpdmVyLmFzc29jaWF0ZWRSZW1vdGVNZWRpYVN0cmVhbXMgPSBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzID0gbG9jYWxDYXBhYmlsaXRpZXM7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcyA9IHJlbW90ZUNhcGFiaWxpdGllcztcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIgPSBydHBSZWNlaXZlcjtcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRjcFBhcmFtZXRlcnMgPSBydGNwUGFyYW1ldGVycztcbiAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVycyA9IHNlbmRFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJlY3ZFbmNvZGluZ1BhcmFtZXRlcnMgPSByZWN2RW5jb2RpbmdQYXJhbWV0ZXJzO1xuXG4gICAgICAgIC8vIFN0YXJ0IHRoZSBSVENSdHBSZWNlaXZlciBub3cuIFRoZSBSVFBTZW5kZXIgaXMgc3RhcnRlZCBpblxuICAgICAgICAvLyBzZXRMb2NhbERlc2NyaXB0aW9uLlxuICAgICAgICBwYy5fdHJhbnNjZWl2ZShwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0sXG4gICAgICAgICAgICBmYWxzZSxcbiAgICAgICAgICAgIGlzTmV3VHJhY2spO1xuICAgICAgfSBlbHNlIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnYW5zd2VyJyAmJiAhcmVqZWN0ZWQpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIgPSBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF07XG4gICAgICAgIGljZUdhdGhlcmVyID0gdHJhbnNjZWl2ZXIuaWNlR2F0aGVyZXI7XG4gICAgICAgIGljZVRyYW5zcG9ydCA9IHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydDtcbiAgICAgICAgZHRsc1RyYW5zcG9ydCA9IHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQ7XG4gICAgICAgIHJ0cFJlY2VpdmVyID0gdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXI7XG4gICAgICAgIHNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgPSB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgICAgICBsb2NhbENhcGFiaWxpdGllcyA9IHRyYW5zY2VpdmVyLmxvY2FsQ2FwYWJpbGl0aWVzO1xuXG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5yZWN2RW5jb2RpbmdQYXJhbWV0ZXJzID1cbiAgICAgICAgICAgIHJlY3ZFbmNvZGluZ1BhcmFtZXRlcnM7XG4gICAgICAgIHBjLnRyYW5zY2VpdmVyc1tzZHBNTGluZUluZGV4XS5yZW1vdGVDYXBhYmlsaXRpZXMgPVxuICAgICAgICAgICAgcmVtb3RlQ2FwYWJpbGl0aWVzO1xuICAgICAgICBwYy50cmFuc2NlaXZlcnNbc2RwTUxpbmVJbmRleF0ucnRjcFBhcmFtZXRlcnMgPSBydGNwUGFyYW1ldGVycztcblxuICAgICAgICBpZiAoY2FuZHMubGVuZ3RoICYmIGljZVRyYW5zcG9ydC5zdGF0ZSA9PT0gJ25ldycpIHtcbiAgICAgICAgICBpZiAoKGlzSWNlTGl0ZSB8fCBpc0NvbXBsZXRlKSAmJlxuICAgICAgICAgICAgICAoIXVzaW5nQnVuZGxlIHx8IHNkcE1MaW5lSW5kZXggPT09IDApKSB7XG4gICAgICAgICAgICBpY2VUcmFuc3BvcnQuc2V0UmVtb3RlQ2FuZGlkYXRlcyhjYW5kcyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhbmRzLmZvckVhY2goZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gICAgICAgICAgICAgIG1heWJlQWRkQ2FuZGlkYXRlKHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCwgY2FuZGlkYXRlKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmICghdXNpbmdCdW5kbGUgfHwgc2RwTUxpbmVJbmRleCA9PT0gMCkge1xuICAgICAgICAgIGlmIChpY2VUcmFuc3BvcnQuc3RhdGUgPT09ICduZXcnKSB7XG4gICAgICAgICAgICBpY2VUcmFuc3BvcnQuc3RhcnQoaWNlR2F0aGVyZXIsIHJlbW90ZUljZVBhcmFtZXRlcnMsXG4gICAgICAgICAgICAgICAgJ2NvbnRyb2xsaW5nJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChkdGxzVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3Jykge1xuICAgICAgICAgICAgZHRsc1RyYW5zcG9ydC5zdGFydChyZW1vdGVEdGxzUGFyYW1ldGVycyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcGMuX3RyYW5zY2VpdmUodHJhbnNjZWl2ZXIsXG4gICAgICAgICAgICBkaXJlY3Rpb24gPT09ICdzZW5kcmVjdicgfHwgZGlyZWN0aW9uID09PSAncmVjdm9ubHknLFxuICAgICAgICAgICAgZGlyZWN0aW9uID09PSAnc2VuZHJlY3YnIHx8IGRpcmVjdGlvbiA9PT0gJ3NlbmRvbmx5Jyk7XG5cbiAgICAgICAgLy8gVE9ETzogcmV3cml0ZSB0byB1c2UgaHR0cDovL3czYy5naXRodWIuaW8vd2VicnRjLXBjLyNzZXQtYXNzb2NpYXRlZC1yZW1vdGUtc3RyZWFtc1xuICAgICAgICBpZiAocnRwUmVjZWl2ZXIgJiZcbiAgICAgICAgICAgIChkaXJlY3Rpb24gPT09ICdzZW5kcmVjdicgfHwgZGlyZWN0aW9uID09PSAnc2VuZG9ubHknKSkge1xuICAgICAgICAgIHRyYWNrID0gcnRwUmVjZWl2ZXIudHJhY2s7XG4gICAgICAgICAgaWYgKHJlbW90ZU1zaWQpIHtcbiAgICAgICAgICAgIGlmICghc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV0pIHtcbiAgICAgICAgICAgICAgc3RyZWFtc1tyZW1vdGVNc2lkLnN0cmVhbV0gPSBuZXcgd2luZG93Lk1lZGlhU3RyZWFtKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhZGRUcmFja1RvU3RyZWFtQW5kRmlyZUV2ZW50KHRyYWNrLCBzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXSk7XG4gICAgICAgICAgICByZWNlaXZlckxpc3QucHVzaChbdHJhY2ssIHJ0cFJlY2VpdmVyLCBzdHJlYW1zW3JlbW90ZU1zaWQuc3RyZWFtXV0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAoIXN0cmVhbXMuZGVmYXVsdCkge1xuICAgICAgICAgICAgICBzdHJlYW1zLmRlZmF1bHQgPSBuZXcgd2luZG93Lk1lZGlhU3RyZWFtKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBhZGRUcmFja1RvU3RyZWFtQW5kRmlyZUV2ZW50KHRyYWNrLCBzdHJlYW1zLmRlZmF1bHQpO1xuICAgICAgICAgICAgcmVjZWl2ZXJMaXN0LnB1c2goW3RyYWNrLCBydHBSZWNlaXZlciwgc3RyZWFtcy5kZWZhdWx0XSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIEZJWE1FOiBhY3R1YWxseSB0aGUgcmVjZWl2ZXIgc2hvdWxkIGJlIGNyZWF0ZWQgbGF0ZXIuXG4gICAgICAgICAgZGVsZXRlIHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAocGMuX2R0bHNSb2xlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHBjLl9kdGxzUm9sZSA9IGRlc2NyaXB0aW9uLnR5cGUgPT09ICdvZmZlcicgPyAnYWN0aXZlJyA6ICdwYXNzaXZlJztcbiAgICB9XG5cbiAgICBwYy5fcmVtb3RlRGVzY3JpcHRpb24gPSB7XG4gICAgICB0eXBlOiBkZXNjcmlwdGlvbi50eXBlLFxuICAgICAgc2RwOiBkZXNjcmlwdGlvbi5zZHBcbiAgICB9O1xuICAgIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnb2ZmZXInKSB7XG4gICAgICBwYy5fdXBkYXRlU2lnbmFsaW5nU3RhdGUoJ2hhdmUtcmVtb3RlLW9mZmVyJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBjLl91cGRhdGVTaWduYWxpbmdTdGF0ZSgnc3RhYmxlJyk7XG4gICAgfVxuICAgIE9iamVjdC5rZXlzKHN0cmVhbXMpLmZvckVhY2goZnVuY3Rpb24oc2lkKSB7XG4gICAgICB2YXIgc3RyZWFtID0gc3RyZWFtc1tzaWRdO1xuICAgICAgaWYgKHN0cmVhbS5nZXRUcmFja3MoKS5sZW5ndGgpIHtcbiAgICAgICAgaWYgKHBjLnJlbW90ZVN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID09PSAtMSkge1xuICAgICAgICAgIHBjLnJlbW90ZVN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgICAgIHZhciBldmVudCA9IG5ldyBFdmVudCgnYWRkc3RyZWFtJyk7XG4gICAgICAgICAgZXZlbnQuc3RyZWFtID0gc3RyZWFtO1xuICAgICAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcGMuX2Rpc3BhdGNoRXZlbnQoJ2FkZHN0cmVhbScsIGV2ZW50KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJlY2VpdmVyTGlzdC5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0pIHtcbiAgICAgICAgICB2YXIgdHJhY2sgPSBpdGVtWzBdO1xuICAgICAgICAgIHZhciByZWNlaXZlciA9IGl0ZW1bMV07XG4gICAgICAgICAgaWYgKHN0cmVhbS5pZCAhPT0gaXRlbVsyXS5pZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgICBmaXJlQWRkVHJhY2socGMsIHRyYWNrLCByZWNlaXZlciwgW3N0cmVhbV0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZWNlaXZlckxpc3QuZm9yRWFjaChmdW5jdGlvbihpdGVtKSB7XG4gICAgICBpZiAoaXRlbVsyXSkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBmaXJlQWRkVHJhY2socGMsIGl0ZW1bMF0sIGl0ZW1bMV0sIFtdKTtcbiAgICB9KTtcblxuICAgIC8vIGNoZWNrIHdoZXRoZXIgYWRkSWNlQ2FuZGlkYXRlKHt9KSB3YXMgY2FsbGVkIHdpdGhpbiBmb3VyIHNlY29uZHMgYWZ0ZXJcbiAgICAvLyBzZXRSZW1vdGVEZXNjcmlwdGlvbi5cbiAgICB3aW5kb3cuc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIGlmICghKHBjICYmIHBjLnRyYW5zY2VpdmVycykpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgcGMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LnN0YXRlID09PSAnbmV3JyAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LmdldFJlbW90ZUNhbmRpZGF0ZXMoKS5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKCdUaW1lb3V0IGZvciBhZGRSZW1vdGVDYW5kaWRhdGUuIENvbnNpZGVyIHNlbmRpbmcgJyArXG4gICAgICAgICAgICAgICdhbiBlbmQtb2YtY2FuZGlkYXRlcyBub3RpZmljYXRpb24nKTtcbiAgICAgICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuYWRkUmVtb3RlQ2FuZGlkYXRlKHt9KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSwgNDAwMCk7XG5cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNsb3NlID0gZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgLyogbm90IHlldFxuICAgICAgaWYgKHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyLmNsb3NlKCk7XG4gICAgICB9XG4gICAgICAqL1xuICAgICAgaWYgKHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCkge1xuICAgICAgICB0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuc3RvcCgpO1xuICAgICAgfVxuICAgICAgaWYgKHRyYW5zY2VpdmVyLmR0bHNUcmFuc3BvcnQpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydC5zdG9wKCk7XG4gICAgICB9XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLnJ0cFNlbmRlci5zdG9wKCk7XG4gICAgICB9XG4gICAgICBpZiAodHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIpIHtcbiAgICAgICAgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIuc3RvcCgpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIEZJWE1FOiBjbGVhbiB1cCB0cmFja3MsIGxvY2FsIHN0cmVhbXMsIHJlbW90ZSBzdHJlYW1zLCBldGNcbiAgICB0aGlzLl9pc0Nsb3NlZCA9IHRydWU7XG4gICAgdGhpcy5fdXBkYXRlU2lnbmFsaW5nU3RhdGUoJ2Nsb3NlZCcpO1xuICB9O1xuXG4gIC8vIFVwZGF0ZSB0aGUgc2lnbmFsaW5nIHN0YXRlLlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX3VwZGF0ZVNpZ25hbGluZ1N0YXRlID0gZnVuY3Rpb24obmV3U3RhdGUpIHtcbiAgICB0aGlzLnNpZ25hbGluZ1N0YXRlID0gbmV3U3RhdGU7XG4gICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdzaWduYWxpbmdzdGF0ZWNoYW5nZScpO1xuICAgIHRoaXMuX2Rpc3BhdGNoRXZlbnQoJ3NpZ25hbGluZ3N0YXRlY2hhbmdlJywgZXZlbnQpO1xuICB9O1xuXG4gIC8vIERldGVybWluZSB3aGV0aGVyIHRvIGZpcmUgdGhlIG5lZ290aWF0aW9ubmVlZGVkIGV2ZW50LlxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuX21heWJlRmlyZU5lZ290aWF0aW9uTmVlZGVkID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHBjID0gdGhpcztcbiAgICBpZiAodGhpcy5zaWduYWxpbmdTdGF0ZSAhPT0gJ3N0YWJsZScgfHwgdGhpcy5uZWVkTmVnb3RpYXRpb24gPT09IHRydWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5uZWVkTmVnb3RpYXRpb24gPSB0cnVlO1xuICAgIHdpbmRvdy5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHBjLm5lZWROZWdvdGlhdGlvbikge1xuICAgICAgICBwYy5uZWVkTmVnb3RpYXRpb24gPSBmYWxzZTtcbiAgICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCduZWdvdGlhdGlvbm5lZWRlZCcpO1xuICAgICAgICBwYy5fZGlzcGF0Y2hFdmVudCgnbmVnb3RpYXRpb25uZWVkZWQnLCBldmVudCk7XG4gICAgICB9XG4gICAgfSwgMCk7XG4gIH07XG5cbiAgLy8gVXBkYXRlIHRoZSBpY2UgY29ubmVjdGlvbiBzdGF0ZS5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLl91cGRhdGVJY2VDb25uZWN0aW9uU3RhdGUgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgbmV3U3RhdGU7XG4gICAgdmFyIHN0YXRlcyA9IHtcbiAgICAgICduZXcnOiAwLFxuICAgICAgY2xvc2VkOiAwLFxuICAgICAgY2hlY2tpbmc6IDAsXG4gICAgICBjb25uZWN0ZWQ6IDAsXG4gICAgICBjb21wbGV0ZWQ6IDAsXG4gICAgICBkaXNjb25uZWN0ZWQ6IDAsXG4gICAgICBmYWlsZWQ6IDBcbiAgICB9O1xuICAgIHRoaXMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIHN0YXRlc1t0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuc3RhdGVdKys7XG4gICAgfSk7XG5cbiAgICBuZXdTdGF0ZSA9ICduZXcnO1xuICAgIGlmIChzdGF0ZXMuZmFpbGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnZmFpbGVkJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5jaGVja2luZyA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2NoZWNraW5nJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5kaXNjb25uZWN0ZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdkaXNjb25uZWN0ZWQnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLm5ldyA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ25ldyc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuY29ubmVjdGVkID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnY29ubmVjdGVkJztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5jb21wbGV0ZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdjb21wbGV0ZWQnO1xuICAgIH1cblxuICAgIGlmIChuZXdTdGF0ZSAhPT0gdGhpcy5pY2VDb25uZWN0aW9uU3RhdGUpIHtcbiAgICAgIHRoaXMuaWNlQ29ubmVjdGlvblN0YXRlID0gbmV3U3RhdGU7XG4gICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ2ljZWNvbm5lY3Rpb25zdGF0ZWNoYW5nZScpO1xuICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudCgnaWNlY29ubmVjdGlvbnN0YXRlY2hhbmdlJywgZXZlbnQpO1xuICAgIH1cbiAgfTtcblxuICAvLyBVcGRhdGUgdGhlIGNvbm5lY3Rpb24gc3RhdGUuXG4gIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5fdXBkYXRlQ29ubmVjdGlvblN0YXRlID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5ld1N0YXRlO1xuICAgIHZhciBzdGF0ZXMgPSB7XG4gICAgICAnbmV3JzogMCxcbiAgICAgIGNsb3NlZDogMCxcbiAgICAgIGNvbm5lY3Rpbmc6IDAsXG4gICAgICBjb25uZWN0ZWQ6IDAsXG4gICAgICBjb21wbGV0ZWQ6IDAsXG4gICAgICBkaXNjb25uZWN0ZWQ6IDAsXG4gICAgICBmYWlsZWQ6IDBcbiAgICB9O1xuICAgIHRoaXMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgIHN0YXRlc1t0cmFuc2NlaXZlci5pY2VUcmFuc3BvcnQuc3RhdGVdKys7XG4gICAgICBzdGF0ZXNbdHJhbnNjZWl2ZXIuZHRsc1RyYW5zcG9ydC5zdGF0ZV0rKztcbiAgICB9KTtcbiAgICAvLyBJQ0VUcmFuc3BvcnQuY29tcGxldGVkIGFuZCBjb25uZWN0ZWQgYXJlIHRoZSBzYW1lIGZvciB0aGlzIHB1cnBvc2UuXG4gICAgc3RhdGVzLmNvbm5lY3RlZCArPSBzdGF0ZXMuY29tcGxldGVkO1xuXG4gICAgbmV3U3RhdGUgPSAnbmV3JztcbiAgICBpZiAoc3RhdGVzLmZhaWxlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2ZhaWxlZCc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMuY29ubmVjdGluZyA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2Nvbm5lY3RpbmcnO1xuICAgIH0gZWxzZSBpZiAoc3RhdGVzLmRpc2Nvbm5lY3RlZCA+IDApIHtcbiAgICAgIG5ld1N0YXRlID0gJ2Rpc2Nvbm5lY3RlZCc7XG4gICAgfSBlbHNlIGlmIChzdGF0ZXMubmV3ID4gMCkge1xuICAgICAgbmV3U3RhdGUgPSAnbmV3JztcbiAgICB9IGVsc2UgaWYgKHN0YXRlcy5jb25uZWN0ZWQgPiAwKSB7XG4gICAgICBuZXdTdGF0ZSA9ICdjb25uZWN0ZWQnO1xuICAgIH1cblxuICAgIGlmIChuZXdTdGF0ZSAhPT0gdGhpcy5jb25uZWN0aW9uU3RhdGUpIHtcbiAgICAgIHRoaXMuY29ubmVjdGlvblN0YXRlID0gbmV3U3RhdGU7XG4gICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ2Nvbm5lY3Rpb25zdGF0ZWNoYW5nZScpO1xuICAgICAgdGhpcy5fZGlzcGF0Y2hFdmVudCgnY29ubmVjdGlvbnN0YXRlY2hhbmdlJywgZXZlbnQpO1xuICAgIH1cbiAgfTtcblxuICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlT2ZmZXIgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgcGMgPSB0aGlzO1xuXG4gICAgaWYgKHBjLl9pc0Nsb3NlZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG1ha2VFcnJvcignSW52YWxpZFN0YXRlRXJyb3InLFxuICAgICAgICAgICdDYW4gbm90IGNhbGwgY3JlYXRlT2ZmZXIgYWZ0ZXIgY2xvc2UnKSk7XG4gICAgfVxuXG4gICAgdmFyIG51bUF1ZGlvVHJhY2tzID0gcGMudHJhbnNjZWl2ZXJzLmZpbHRlcihmdW5jdGlvbih0KSB7XG4gICAgICByZXR1cm4gdC5raW5kID09PSAnYXVkaW8nO1xuICAgIH0pLmxlbmd0aDtcbiAgICB2YXIgbnVtVmlkZW9UcmFja3MgPSBwYy50cmFuc2NlaXZlcnMuZmlsdGVyKGZ1bmN0aW9uKHQpIHtcbiAgICAgIHJldHVybiB0LmtpbmQgPT09ICd2aWRlbyc7XG4gICAgfSkubGVuZ3RoO1xuXG4gICAgLy8gRGV0ZXJtaW5lIG51bWJlciBvZiBhdWRpbyBhbmQgdmlkZW8gdHJhY2tzIHdlIG5lZWQgdG8gc2VuZC9yZWN2LlxuICAgIHZhciBvZmZlck9wdGlvbnMgPSBhcmd1bWVudHNbMF07XG4gICAgaWYgKG9mZmVyT3B0aW9ucykge1xuICAgICAgLy8gUmVqZWN0IENocm9tZSBsZWdhY3kgY29uc3RyYWludHMuXG4gICAgICBpZiAob2ZmZXJPcHRpb25zLm1hbmRhdG9yeSB8fCBvZmZlck9wdGlvbnMub3B0aW9uYWwpIHtcbiAgICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcbiAgICAgICAgICAgICdMZWdhY3kgbWFuZGF0b3J5L29wdGlvbmFsIGNvbnN0cmFpbnRzIG5vdCBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgICBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gPT09IHRydWUpIHtcbiAgICAgICAgICBudW1BdWRpb1RyYWNrcyA9IDE7XG4gICAgICAgIH0gZWxzZSBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gPT09IGZhbHNlKSB7XG4gICAgICAgICAgbnVtQXVkaW9UcmFja3MgPSAwO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIG51bUF1ZGlvVHJhY2tzID0gb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW87XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbyA9PT0gdHJ1ZSkge1xuICAgICAgICAgIG51bVZpZGVvVHJhY2tzID0gMTtcbiAgICAgICAgfSBlbHNlIGlmIChvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbyA9PT0gZmFsc2UpIHtcbiAgICAgICAgICBudW1WaWRlb1RyYWNrcyA9IDA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgbnVtVmlkZW9UcmFja3MgPSBvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbztcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHBjLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICBudW1BdWRpb1RyYWNrcy0tO1xuICAgICAgICBpZiAobnVtQXVkaW9UcmFja3MgPCAwKSB7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIud2FudFJlY2VpdmUgPSBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgIG51bVZpZGVvVHJhY2tzLS07XG4gICAgICAgIGlmIChudW1WaWRlb1RyYWNrcyA8IDApIHtcbiAgICAgICAgICB0cmFuc2NlaXZlci53YW50UmVjZWl2ZSA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgTS1saW5lcyBmb3IgcmVjdm9ubHkgc3RyZWFtcy5cbiAgICB3aGlsZSAobnVtQXVkaW9UcmFja3MgPiAwIHx8IG51bVZpZGVvVHJhY2tzID4gMCkge1xuICAgICAgaWYgKG51bUF1ZGlvVHJhY2tzID4gMCkge1xuICAgICAgICBwYy5fY3JlYXRlVHJhbnNjZWl2ZXIoJ2F1ZGlvJyk7XG4gICAgICAgIG51bUF1ZGlvVHJhY2tzLS07XG4gICAgICB9XG4gICAgICBpZiAobnVtVmlkZW9UcmFja3MgPiAwKSB7XG4gICAgICAgIHBjLl9jcmVhdGVUcmFuc2NlaXZlcigndmlkZW8nKTtcbiAgICAgICAgbnVtVmlkZW9UcmFja3MtLTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgc2RwID0gU0RQVXRpbHMud3JpdGVTZXNzaW9uQm9pbGVycGxhdGUocGMuX3NkcFNlc3Npb25JZCxcbiAgICAgICAgcGMuX3NkcFNlc3Npb25WZXJzaW9uKyspO1xuICAgIHBjLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyLCBzZHBNTGluZUluZGV4KSB7XG4gICAgICAvLyBGb3IgZWFjaCB0cmFjaywgY3JlYXRlIGFuIGljZSBnYXRoZXJlciwgaWNlIHRyYW5zcG9ydCxcbiAgICAgIC8vIGR0bHMgdHJhbnNwb3J0LCBwb3RlbnRpYWxseSBydHBzZW5kZXIgYW5kIHJ0cHJlY2VpdmVyLlxuICAgICAgdmFyIHRyYWNrID0gdHJhbnNjZWl2ZXIudHJhY2s7XG4gICAgICB2YXIga2luZCA9IHRyYW5zY2VpdmVyLmtpbmQ7XG4gICAgICB2YXIgbWlkID0gdHJhbnNjZWl2ZXIubWlkIHx8IFNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllcigpO1xuICAgICAgdHJhbnNjZWl2ZXIubWlkID0gbWlkO1xuXG4gICAgICBpZiAoIXRyYW5zY2VpdmVyLmljZUdhdGhlcmVyKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyID0gcGMuX2NyZWF0ZUljZUdhdGhlcmVyKHNkcE1MaW5lSW5kZXgsXG4gICAgICAgICAgICBwYy51c2luZ0J1bmRsZSk7XG4gICAgICB9XG5cbiAgICAgIHZhciBsb2NhbENhcGFiaWxpdGllcyA9IHdpbmRvdy5SVENSdHBTZW5kZXIuZ2V0Q2FwYWJpbGl0aWVzKGtpbmQpO1xuICAgICAgLy8gZmlsdGVyIFJUWCB1bnRpbCBhZGRpdGlvbmFsIHN0dWZmIG5lZWRlZCBmb3IgUlRYIGlzIGltcGxlbWVudGVkXG4gICAgICAvLyBpbiBhZGFwdGVyLmpzXG4gICAgICBpZiAoZWRnZVZlcnNpb24gPCAxNTAxOSkge1xuICAgICAgICBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MgPSBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MuZmlsdGVyKFxuICAgICAgICAgICAgZnVuY3Rpb24oY29kZWMpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIGNvZGVjLm5hbWUgIT09ICdydHgnO1xuICAgICAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBsb2NhbENhcGFiaWxpdGllcy5jb2RlY3MuZm9yRWFjaChmdW5jdGlvbihjb2RlYykge1xuICAgICAgICAvLyB3b3JrIGFyb3VuZCBodHRwczovL2J1Z3MuY2hyb21pdW0ub3JnL3Avd2VicnRjL2lzc3Vlcy9kZXRhaWw/aWQ9NjU1MlxuICAgICAgICAvLyBieSBhZGRpbmcgbGV2ZWwtYXN5bW1ldHJ5LWFsbG93ZWQ9MVxuICAgICAgICBpZiAoY29kZWMubmFtZSA9PT0gJ0gyNjQnICYmXG4gICAgICAgICAgICBjb2RlYy5wYXJhbWV0ZXJzWydsZXZlbC1hc3ltbWV0cnktYWxsb3dlZCddID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjb2RlYy5wYXJhbWV0ZXJzWydsZXZlbC1hc3ltbWV0cnktYWxsb3dlZCddID0gJzEnO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZm9yIHN1YnNlcXVlbnQgb2ZmZXJzLCB3ZSBtaWdodCBoYXZlIHRvIHJlLXVzZSB0aGUgcGF5bG9hZFxuICAgICAgICAvLyB0eXBlIG9mIHRoZSBsYXN0IG9mZmVyLlxuICAgICAgICBpZiAodHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMuY29kZWNzKSB7XG4gICAgICAgICAgdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzLmNvZGVjcy5mb3JFYWNoKGZ1bmN0aW9uKHJlbW90ZUNvZGVjKSB7XG4gICAgICAgICAgICBpZiAoY29kZWMubmFtZS50b0xvd2VyQ2FzZSgpID09PSByZW1vdGVDb2RlYy5uYW1lLnRvTG93ZXJDYXNlKCkgJiZcbiAgICAgICAgICAgICAgICBjb2RlYy5jbG9ja1JhdGUgPT09IHJlbW90ZUNvZGVjLmNsb2NrUmF0ZSkge1xuICAgICAgICAgICAgICBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSA9IHJlbW90ZUNvZGVjLnBheWxvYWRUeXBlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGxvY2FsQ2FwYWJpbGl0aWVzLmhlYWRlckV4dGVuc2lvbnMuZm9yRWFjaChmdW5jdGlvbihoZHJFeHQpIHtcbiAgICAgICAgdmFyIHJlbW90ZUV4dGVuc2lvbnMgPSB0cmFuc2NlaXZlci5yZW1vdGVDYXBhYmlsaXRpZXMgJiZcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLnJlbW90ZUNhcGFiaWxpdGllcy5oZWFkZXJFeHRlbnNpb25zIHx8IFtdO1xuICAgICAgICByZW1vdGVFeHRlbnNpb25zLmZvckVhY2goZnVuY3Rpb24ockhkckV4dCkge1xuICAgICAgICAgIGlmIChoZHJFeHQudXJpID09PSBySGRyRXh0LnVyaSkge1xuICAgICAgICAgICAgaGRyRXh0LmlkID0gckhkckV4dC5pZDtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIGdlbmVyYXRlIGFuIHNzcmMgbm93LCB0byBiZSB1c2VkIGxhdGVyIGluIHJ0cFNlbmRlci5zZW5kXG4gICAgICB2YXIgc2VuZEVuY29kaW5nUGFyYW1ldGVycyA9IHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgfHwgW3tcbiAgICAgICAgc3NyYzogKDIgKiBzZHBNTGluZUluZGV4ICsgMSkgKiAxMDAxXG4gICAgICB9XTtcbiAgICAgIGlmICh0cmFjaykge1xuICAgICAgICAvLyBhZGQgUlRYXG4gICAgICAgIGlmIChlZGdlVmVyc2lvbiA+PSAxNTAxOSAmJiBraW5kID09PSAndmlkZW8nICYmXG4gICAgICAgICAgICAhc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICAgICAgICBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCA9IHtcbiAgICAgICAgICAgIHNzcmM6IHNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArIDFcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICh0cmFuc2NlaXZlci53YW50UmVjZWl2ZSkge1xuICAgICAgICB0cmFuc2NlaXZlci5ydHBSZWNlaXZlciA9IG5ldyB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIoXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0LCBraW5kKTtcbiAgICAgIH1cblxuICAgICAgdHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXMgPSBsb2NhbENhcGFiaWxpdGllcztcbiAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnMgPSBzZW5kRW5jb2RpbmdQYXJhbWV0ZXJzO1xuICAgIH0pO1xuXG4gICAgLy8gYWx3YXlzIG9mZmVyIEJVTkRMRSBhbmQgZGlzcG9zZSBvbiByZXR1cm4gaWYgbm90IHN1cHBvcnRlZC5cbiAgICBpZiAocGMuX2NvbmZpZy5idW5kbGVQb2xpY3kgIT09ICdtYXgtY29tcGF0Jykge1xuICAgICAgc2RwICs9ICdhPWdyb3VwOkJVTkRMRSAnICsgcGMudHJhbnNjZWl2ZXJzLm1hcChmdW5jdGlvbih0KSB7XG4gICAgICAgIHJldHVybiB0Lm1pZDtcbiAgICAgIH0pLmpvaW4oJyAnKSArICdcXHJcXG4nO1xuICAgIH1cbiAgICBzZHAgKz0gJ2E9aWNlLW9wdGlvbnM6dHJpY2tsZVxcclxcbic7XG5cbiAgICBwYy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlciwgc2RwTUxpbmVJbmRleCkge1xuICAgICAgc2RwICs9IHdyaXRlTWVkaWFTZWN0aW9uKHRyYW5zY2VpdmVyLCB0cmFuc2NlaXZlci5sb2NhbENhcGFiaWxpdGllcyxcbiAgICAgICAgICAnb2ZmZXInLCB0cmFuc2NlaXZlci5zdHJlYW0sIHBjLl9kdGxzUm9sZSk7XG4gICAgICBzZHAgKz0gJ2E9cnRjcC1yc2l6ZVxcclxcbic7XG5cbiAgICAgIGlmICh0cmFuc2NlaXZlci5pY2VHYXRoZXJlciAmJiBwYy5pY2VHYXRoZXJpbmdTdGF0ZSAhPT0gJ25ldycgJiZcbiAgICAgICAgICAoc2RwTUxpbmVJbmRleCA9PT0gMCB8fCAhcGMudXNpbmdCdW5kbGUpKSB7XG4gICAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyLmdldExvY2FsQ2FuZGlkYXRlcygpLmZvckVhY2goZnVuY3Rpb24oY2FuZCkge1xuICAgICAgICAgIGNhbmQuY29tcG9uZW50ID0gMTtcbiAgICAgICAgICBzZHAgKz0gJ2E9JyArIFNEUFV0aWxzLndyaXRlQ2FuZGlkYXRlKGNhbmQpICsgJ1xcclxcbic7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh0cmFuc2NlaXZlci5pY2VHYXRoZXJlci5zdGF0ZSA9PT0gJ2NvbXBsZXRlZCcpIHtcbiAgICAgICAgICBzZHAgKz0gJ2E9ZW5kLW9mLWNhbmRpZGF0ZXNcXHJcXG4nO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB2YXIgZGVzYyA9IG5ldyB3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKHtcbiAgICAgIHR5cGU6ICdvZmZlcicsXG4gICAgICBzZHA6IHNkcFxuICAgIH0pO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZGVzYyk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNyZWF0ZUFuc3dlciA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBwYyA9IHRoaXM7XG5cbiAgICBpZiAocGMuX2lzQ2xvc2VkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobWFrZUVycm9yKCdJbnZhbGlkU3RhdGVFcnJvcicsXG4gICAgICAgICAgJ0NhbiBub3QgY2FsbCBjcmVhdGVBbnN3ZXIgYWZ0ZXIgY2xvc2UnKSk7XG4gICAgfVxuXG4gICAgaWYgKCEocGMuc2lnbmFsaW5nU3RhdGUgPT09ICdoYXZlLXJlbW90ZS1vZmZlcicgfHxcbiAgICAgICAgcGMuc2lnbmFsaW5nU3RhdGUgPT09ICdoYXZlLWxvY2FsLXByYW5zd2VyJykpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAnQ2FuIG5vdCBjYWxsIGNyZWF0ZUFuc3dlciBpbiBzaWduYWxpbmdTdGF0ZSAnICsgcGMuc2lnbmFsaW5nU3RhdGUpKTtcbiAgICB9XG5cbiAgICB2YXIgc2RwID0gU0RQVXRpbHMud3JpdGVTZXNzaW9uQm9pbGVycGxhdGUocGMuX3NkcFNlc3Npb25JZCxcbiAgICAgICAgcGMuX3NkcFNlc3Npb25WZXJzaW9uKyspO1xuICAgIGlmIChwYy51c2luZ0J1bmRsZSkge1xuICAgICAgc2RwICs9ICdhPWdyb3VwOkJVTkRMRSAnICsgcGMudHJhbnNjZWl2ZXJzLm1hcChmdW5jdGlvbih0KSB7XG4gICAgICAgIHJldHVybiB0Lm1pZDtcbiAgICAgIH0pLmpvaW4oJyAnKSArICdcXHJcXG4nO1xuICAgIH1cbiAgICB2YXIgbWVkaWFTZWN0aW9uc0luT2ZmZXIgPSBTRFBVdGlscy5nZXRNZWRpYVNlY3Rpb25zKFxuICAgICAgICBwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwKS5sZW5ndGg7XG4gICAgcGMudHJhbnNjZWl2ZXJzLmZvckVhY2goZnVuY3Rpb24odHJhbnNjZWl2ZXIsIHNkcE1MaW5lSW5kZXgpIHtcbiAgICAgIGlmIChzZHBNTGluZUluZGV4ICsgMSA+IG1lZGlhU2VjdGlvbnNJbk9mZmVyKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmICh0cmFuc2NlaXZlci5yZWplY3RlZCkge1xuICAgICAgICBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ2FwcGxpY2F0aW9uJykge1xuICAgICAgICAgIHNkcCArPSAnbT1hcHBsaWNhdGlvbiAwIERUTFMvU0NUUCA1MDAwXFxyXFxuJztcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgc2RwICs9ICdtPWF1ZGlvIDAgVURQL1RMUy9SVFAvU0FWUEYgMFxcclxcbicgK1xuICAgICAgICAgICAgICAnYT1ydHBtYXA6MCBQQ01VLzgwMDBcXHJcXG4nO1xuICAgICAgICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgICBzZHAgKz0gJ209dmlkZW8gMCBVRFAvVExTL1JUUC9TQVZQRiAxMjBcXHJcXG4nICtcbiAgICAgICAgICAgICAgJ2E9cnRwbWFwOjEyMCBWUDgvOTAwMDBcXHJcXG4nO1xuICAgICAgICB9XG4gICAgICAgIHNkcCArPSAnYz1JTiBJUDQgMC4wLjAuMFxcclxcbicgK1xuICAgICAgICAgICAgJ2E9aW5hY3RpdmVcXHJcXG4nICtcbiAgICAgICAgICAgICdhPW1pZDonICsgdHJhbnNjZWl2ZXIubWlkICsgJ1xcclxcbic7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgLy8gRklYTUU6IGxvb2sgYXQgZGlyZWN0aW9uLlxuICAgICAgaWYgKHRyYW5zY2VpdmVyLnN0cmVhbSkge1xuICAgICAgICB2YXIgbG9jYWxUcmFjaztcbiAgICAgICAgaWYgKHRyYW5zY2VpdmVyLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICBsb2NhbFRyYWNrID0gdHJhbnNjZWl2ZXIuc3RyZWFtLmdldEF1ZGlvVHJhY2tzKClbMF07XG4gICAgICAgIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICAgIGxvY2FsVHJhY2sgPSB0cmFuc2NlaXZlci5zdHJlYW0uZ2V0VmlkZW9UcmFja3MoKVswXTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobG9jYWxUcmFjaykge1xuICAgICAgICAgIC8vIGFkZCBSVFhcbiAgICAgICAgICBpZiAoZWRnZVZlcnNpb24gPj0gMTUwMTkgJiYgdHJhbnNjZWl2ZXIua2luZCA9PT0gJ3ZpZGVvJyAmJlxuICAgICAgICAgICAgICAhdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4ID0ge1xuICAgICAgICAgICAgICBzc3JjOiB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgKyAxXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBDYWxjdWxhdGUgaW50ZXJzZWN0aW9uIG9mIGNhcGFiaWxpdGllcy5cbiAgICAgIHZhciBjb21tb25DYXBhYmlsaXRpZXMgPSBnZXRDb21tb25DYXBhYmlsaXRpZXMoXG4gICAgICAgICAgdHJhbnNjZWl2ZXIubG9jYWxDYXBhYmlsaXRpZXMsXG4gICAgICAgICAgdHJhbnNjZWl2ZXIucmVtb3RlQ2FwYWJpbGl0aWVzKTtcblxuICAgICAgdmFyIGhhc1J0eCA9IGNvbW1vbkNhcGFiaWxpdGllcy5jb2RlY3MuZmlsdGVyKGZ1bmN0aW9uKGMpIHtcbiAgICAgICAgcmV0dXJuIGMubmFtZS50b0xvd2VyQ2FzZSgpID09PSAncnR4JztcbiAgICAgIH0pLmxlbmd0aDtcbiAgICAgIGlmICghaGFzUnR4ICYmIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4KSB7XG4gICAgICAgIGRlbGV0ZSB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eDtcbiAgICAgIH1cblxuICAgICAgc2RwICs9IHdyaXRlTWVkaWFTZWN0aW9uKHRyYW5zY2VpdmVyLCBjb21tb25DYXBhYmlsaXRpZXMsXG4gICAgICAgICAgJ2Fuc3dlcicsIHRyYW5zY2VpdmVyLnN0cmVhbSwgcGMuX2R0bHNSb2xlKTtcbiAgICAgIGlmICh0cmFuc2NlaXZlci5ydGNwUGFyYW1ldGVycyAmJlxuICAgICAgICAgIHRyYW5zY2VpdmVyLnJ0Y3BQYXJhbWV0ZXJzLnJlZHVjZWRTaXplKSB7XG4gICAgICAgIHNkcCArPSAnYT1ydGNwLXJzaXplXFxyXFxuJztcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHZhciBkZXNjID0gbmV3IHdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24oe1xuICAgICAgdHlwZTogJ2Fuc3dlcicsXG4gICAgICBzZHA6IHNkcFxuICAgIH0pO1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoZGVzYyk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICAgIHZhciBwYyA9IHRoaXM7XG4gICAgdmFyIHNlY3Rpb25zO1xuICAgIGlmIChjYW5kaWRhdGUgJiYgIShjYW5kaWRhdGUuc2RwTUxpbmVJbmRleCAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgIGNhbmRpZGF0ZS5zZHBNaWQpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignc2RwTUxpbmVJbmRleCBvciBzZHBNaWQgcmVxdWlyZWQnKSk7XG4gICAgfVxuXG4gICAgLy8gVE9ETzogbmVlZHMgdG8gZ28gaW50byBvcHMgcXVldWUuXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgaWYgKCFwYy5fcmVtb3RlRGVzY3JpcHRpb24pIHtcbiAgICAgICAgcmV0dXJuIHJlamVjdChtYWtlRXJyb3IoJ0ludmFsaWRTdGF0ZUVycm9yJyxcbiAgICAgICAgICAgICdDYW4gbm90IGFkZCBJQ0UgY2FuZGlkYXRlIHdpdGhvdXQgYSByZW1vdGUgZGVzY3JpcHRpb24nKSk7XG4gICAgICB9IGVsc2UgaWYgKCFjYW5kaWRhdGUgfHwgY2FuZGlkYXRlLmNhbmRpZGF0ZSA9PT0gJycpIHtcbiAgICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBwYy50cmFuc2NlaXZlcnMubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgICBpZiAocGMudHJhbnNjZWl2ZXJzW2pdLnJlamVjdGVkKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcGMudHJhbnNjZWl2ZXJzW2pdLmljZVRyYW5zcG9ydC5hZGRSZW1vdGVDYW5kaWRhdGUoe30pO1xuICAgICAgICAgIHNlY3Rpb25zID0gU0RQVXRpbHMuZ2V0TWVkaWFTZWN0aW9ucyhwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwKTtcbiAgICAgICAgICBzZWN0aW9uc1tqXSArPSAnYT1lbmQtb2YtY2FuZGlkYXRlc1xcclxcbic7XG4gICAgICAgICAgcGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCA9XG4gICAgICAgICAgICAgIFNEUFV0aWxzLmdldERlc2NyaXB0aW9uKHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHApICtcbiAgICAgICAgICAgICAgc2VjdGlvbnMuam9pbignJyk7XG4gICAgICAgICAgaWYgKHBjLnVzaW5nQnVuZGxlKSB7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBzZHBNTGluZUluZGV4ID0gY2FuZGlkYXRlLnNkcE1MaW5lSW5kZXg7XG4gICAgICAgIGlmIChjYW5kaWRhdGUuc2RwTWlkKSB7XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYy50cmFuc2NlaXZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGlmIChwYy50cmFuc2NlaXZlcnNbaV0ubWlkID09PSBjYW5kaWRhdGUuc2RwTWlkKSB7XG4gICAgICAgICAgICAgIHNkcE1MaW5lSW5kZXggPSBpO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHRyYW5zY2VpdmVyID0gcGMudHJhbnNjZWl2ZXJzW3NkcE1MaW5lSW5kZXhdO1xuICAgICAgICBpZiAodHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICBpZiAodHJhbnNjZWl2ZXIucmVqZWN0ZWQpIHtcbiAgICAgICAgICAgIHJldHVybiByZXNvbHZlKCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHZhciBjYW5kID0gT2JqZWN0LmtleXMoY2FuZGlkYXRlLmNhbmRpZGF0ZSkubGVuZ3RoID4gMCA/XG4gICAgICAgICAgICAgIFNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlKGNhbmRpZGF0ZS5jYW5kaWRhdGUpIDoge307XG4gICAgICAgICAgLy8gSWdub3JlIENocm9tZSdzIGludmFsaWQgY2FuZGlkYXRlcyBzaW5jZSBFZGdlIGRvZXMgbm90IGxpa2UgdGhlbS5cbiAgICAgICAgICBpZiAoY2FuZC5wcm90b2NvbCA9PT0gJ3RjcCcgJiYgKGNhbmQucG9ydCA9PT0gMCB8fCBjYW5kLnBvcnQgPT09IDkpKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzb2x2ZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyBJZ25vcmUgUlRDUCBjYW5kaWRhdGVzLCB3ZSBhc3N1bWUgUlRDUC1NVVguXG4gICAgICAgICAgaWYgKGNhbmQuY29tcG9uZW50ICYmIGNhbmQuY29tcG9uZW50ICE9PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4gcmVzb2x2ZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICAvLyB3aGVuIHVzaW5nIGJ1bmRsZSwgYXZvaWQgYWRkaW5nIGNhbmRpZGF0ZXMgdG8gdGhlIHdyb25nXG4gICAgICAgICAgLy8gaWNlIHRyYW5zcG9ydC4gQW5kIGF2b2lkIGFkZGluZyBjYW5kaWRhdGVzIGFkZGVkIGluIHRoZSBTRFAuXG4gICAgICAgICAgaWYgKHNkcE1MaW5lSW5kZXggPT09IDAgfHwgKHNkcE1MaW5lSW5kZXggPiAwICYmXG4gICAgICAgICAgICAgIHRyYW5zY2VpdmVyLmljZVRyYW5zcG9ydCAhPT0gcGMudHJhbnNjZWl2ZXJzWzBdLmljZVRyYW5zcG9ydCkpIHtcbiAgICAgICAgICAgIGlmICghbWF5YmVBZGRDYW5kaWRhdGUodHJhbnNjZWl2ZXIuaWNlVHJhbnNwb3J0LCBjYW5kKSkge1xuICAgICAgICAgICAgICByZXR1cm4gcmVqZWN0KG1ha2VFcnJvcignT3BlcmF0aW9uRXJyb3InLFxuICAgICAgICAgICAgICAgICAgJ0NhbiBub3QgYWRkIElDRSBjYW5kaWRhdGUnKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gdXBkYXRlIHRoZSByZW1vdGVEZXNjcmlwdGlvbi5cbiAgICAgICAgICB2YXIgY2FuZGlkYXRlU3RyaW5nID0gY2FuZGlkYXRlLmNhbmRpZGF0ZS50cmltKCk7XG4gICAgICAgICAgaWYgKGNhbmRpZGF0ZVN0cmluZy5pbmRleE9mKCdhPScpID09PSAwKSB7XG4gICAgICAgICAgICBjYW5kaWRhdGVTdHJpbmcgPSBjYW5kaWRhdGVTdHJpbmcuc3Vic3RyKDIpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBzZWN0aW9ucyA9IFNEUFV0aWxzLmdldE1lZGlhU2VjdGlvbnMocGMuX3JlbW90ZURlc2NyaXB0aW9uLnNkcCk7XG4gICAgICAgICAgc2VjdGlvbnNbc2RwTUxpbmVJbmRleF0gKz0gJ2E9JyArXG4gICAgICAgICAgICAgIChjYW5kLnR5cGUgPyBjYW5kaWRhdGVTdHJpbmcgOiAnZW5kLW9mLWNhbmRpZGF0ZXMnKVxuICAgICAgICAgICAgICArICdcXHJcXG4nO1xuICAgICAgICAgIHBjLl9yZW1vdGVEZXNjcmlwdGlvbi5zZHAgPVxuICAgICAgICAgICAgICBTRFBVdGlscy5nZXREZXNjcmlwdGlvbihwYy5fcmVtb3RlRGVzY3JpcHRpb24uc2RwKSArXG4gICAgICAgICAgICAgIHNlY3Rpb25zLmpvaW4oJycpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiByZWplY3QobWFrZUVycm9yKCdPcGVyYXRpb25FcnJvcicsXG4gICAgICAgICAgICAgICdDYW4gbm90IGFkZCBJQ0UgY2FuZGlkYXRlJykpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXNvbHZlKCk7XG4gICAgfSk7XG4gIH07XG5cbiAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oc2VsZWN0b3IpIHtcbiAgICBpZiAoc2VsZWN0b3IgJiYgc2VsZWN0b3IgaW5zdGFuY2VvZiB3aW5kb3cuTWVkaWFTdHJlYW1UcmFjaykge1xuICAgICAgdmFyIHNlbmRlck9yUmVjZWl2ZXIgPSBudWxsO1xuICAgICAgdGhpcy50cmFuc2NlaXZlcnMuZm9yRWFjaChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyICYmXG4gICAgICAgICAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIudHJhY2sgPT09IHNlbGVjdG9yKSB7XG4gICAgICAgICAgc2VuZGVyT3JSZWNlaXZlciA9IHRyYW5zY2VpdmVyLnJ0cFNlbmRlcjtcbiAgICAgICAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBSZWNlaXZlciAmJlxuICAgICAgICAgICAgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIudHJhY2sgPT09IHNlbGVjdG9yKSB7XG4gICAgICAgICAgc2VuZGVyT3JSZWNlaXZlciA9IHRyYW5zY2VpdmVyLnJ0cFJlY2VpdmVyO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmICghc2VuZGVyT3JSZWNlaXZlcikge1xuICAgICAgICB0aHJvdyBtYWtlRXJyb3IoJ0ludmFsaWRBY2Nlc3NFcnJvcicsICdJbnZhbGlkIHNlbGVjdG9yLicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNlbmRlck9yUmVjZWl2ZXIuZ2V0U3RhdHMoKTtcbiAgICB9XG5cbiAgICB2YXIgcHJvbWlzZXMgPSBbXTtcbiAgICB0aGlzLnRyYW5zY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHRyYW5zY2VpdmVyKSB7XG4gICAgICBbJ3J0cFNlbmRlcicsICdydHBSZWNlaXZlcicsICdpY2VHYXRoZXJlcicsICdpY2VUcmFuc3BvcnQnLFxuICAgICAgICAgICdkdGxzVHJhbnNwb3J0J10uZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgICAgICAgIGlmICh0cmFuc2NlaXZlclttZXRob2RdKSB7XG4gICAgICAgICAgICAgIHByb21pc2VzLnB1c2godHJhbnNjZWl2ZXJbbWV0aG9kXS5nZXRTdGF0cygpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oZnVuY3Rpb24oYWxsU3RhdHMpIHtcbiAgICAgIHZhciByZXN1bHRzID0gbmV3IE1hcCgpO1xuICAgICAgYWxsU3RhdHMuZm9yRWFjaChmdW5jdGlvbihzdGF0cykge1xuICAgICAgICBzdGF0cy5mb3JFYWNoKGZ1bmN0aW9uKHN0YXQpIHtcbiAgICAgICAgICByZXN1bHRzLnNldChzdGF0LmlkLCBzdGF0KTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH0pO1xuICB9O1xuXG4gIC8vIGZpeCBsb3ctbGV2ZWwgc3RhdCBuYW1lcyBhbmQgcmV0dXJuIE1hcCBpbnN0ZWFkIG9mIG9iamVjdC5cbiAgdmFyIG9ydGNPYmplY3RzID0gWydSVENSdHBTZW5kZXInLCAnUlRDUnRwUmVjZWl2ZXInLCAnUlRDSWNlR2F0aGVyZXInLFxuICAgICdSVENJY2VUcmFuc3BvcnQnLCAnUlRDRHRsc1RyYW5zcG9ydCddO1xuICBvcnRjT2JqZWN0cy5mb3JFYWNoKGZ1bmN0aW9uKG9ydGNPYmplY3ROYW1lKSB7XG4gICAgdmFyIG9iaiA9IHdpbmRvd1tvcnRjT2JqZWN0TmFtZV07XG4gICAgaWYgKG9iaiAmJiBvYmoucHJvdG90eXBlICYmIG9iai5wcm90b3R5cGUuZ2V0U3RhdHMpIHtcbiAgICAgIHZhciBuYXRpdmVHZXRzdGF0cyA9IG9iai5wcm90b3R5cGUuZ2V0U3RhdHM7XG4gICAgICBvYmoucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuYXRpdmVHZXRzdGF0cy5hcHBseSh0aGlzKVxuICAgICAgICAudGhlbihmdW5jdGlvbihuYXRpdmVTdGF0cykge1xuICAgICAgICAgIHZhciBtYXBTdGF0cyA9IG5ldyBNYXAoKTtcbiAgICAgICAgICBPYmplY3Qua2V5cyhuYXRpdmVTdGF0cykuZm9yRWFjaChmdW5jdGlvbihpZCkge1xuICAgICAgICAgICAgbmF0aXZlU3RhdHNbaWRdLnR5cGUgPSBmaXhTdGF0c1R5cGUobmF0aXZlU3RhdHNbaWRdKTtcbiAgICAgICAgICAgIG1hcFN0YXRzLnNldChpZCwgbmF0aXZlU3RhdHNbaWRdKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gbWFwU3RhdHM7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIGxlZ2FjeSBjYWxsYmFjayBzaGltcy4gU2hvdWxkIGJlIG1vdmVkIHRvIGFkYXB0ZXIuanMgc29tZSBkYXlzLlxuICB2YXIgbWV0aG9kcyA9IFsnY3JlYXRlT2ZmZXInLCAnY3JlYXRlQW5zd2VyJ107XG4gIG1ldGhvZHMuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICB2YXIgbmF0aXZlTWV0aG9kID0gUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgaWYgKHR5cGVvZiBhcmdzWzBdID09PSAnZnVuY3Rpb24nIHx8XG4gICAgICAgICAgdHlwZW9mIGFyZ3NbMV0gPT09ICdmdW5jdGlvbicpIHsgLy8gbGVnYWN5XG4gICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgW2FyZ3VtZW50c1syXV0pXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBhcmdzWzBdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBhcmdzWzBdLmFwcGx5KG51bGwsIFtkZXNjcmlwdGlvbl0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSwgZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGFyZ3NbMV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGFyZ3NbMV0uYXBwbHkobnVsbCwgW2Vycm9yXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9KTtcblxuICBtZXRob2RzID0gWydzZXRMb2NhbERlc2NyaXB0aW9uJywgJ3NldFJlbW90ZURlc2NyaXB0aW9uJywgJ2FkZEljZUNhbmRpZGF0ZSddO1xuICBtZXRob2RzLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgdmFyIG5hdGl2ZU1ldGhvZCA9IFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgIFJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcbiAgICAgIGlmICh0eXBlb2YgYXJnc1sxXSA9PT0gJ2Z1bmN0aW9uJyB8fFxuICAgICAgICAgIHR5cGVvZiBhcmdzWzJdID09PSAnZnVuY3Rpb24nKSB7IC8vIGxlZ2FjeVxuICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKHR5cGVvZiBhcmdzWzFdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBhcmdzWzFdLmFwcGx5KG51bGwpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSwgZnVuY3Rpb24oZXJyb3IpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIGFyZ3NbMl0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGFyZ3NbMl0uYXBwbHkobnVsbCwgW2Vycm9yXSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9KTtcblxuICAvLyBnZXRTdGF0cyBpcyBzcGVjaWFsLiBJdCBkb2Vzbid0IGhhdmUgYSBzcGVjIGxlZ2FjeSBtZXRob2QgeWV0IHdlIHN1cHBvcnRcbiAgLy8gZ2V0U3RhdHMoc29tZXRoaW5nLCBjYikgd2l0aG91dCBlcnJvciBjYWxsYmFja3MuXG4gIFsnZ2V0U3RhdHMnXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgIHZhciBuYXRpdmVNZXRob2QgPSBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXTtcbiAgICBSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGFyZ3MgPSBhcmd1bWVudHM7XG4gICAgICBpZiAodHlwZW9mIGFyZ3NbMV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG4gICAgICAgIC50aGVuKGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmICh0eXBlb2YgYXJnc1sxXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgYXJnc1sxXS5hcHBseShudWxsKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0pO1xuXG4gIHJldHVybiBSVENQZWVyQ29ubmVjdGlvbjtcbn07XG4iLCIgLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIFNEUCBoZWxwZXJzLlxudmFyIFNEUFV0aWxzID0ge307XG5cbi8vIEdlbmVyYXRlIGFuIGFscGhhbnVtZXJpYyBpZGVudGlmaWVyIGZvciBjbmFtZSBvciBtaWRzLlxuLy8gVE9ETzogdXNlIFVVSURzIGluc3RlYWQ/IGh0dHBzOi8vZ2lzdC5naXRodWIuY29tL2plZC85ODI4ODNcblNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDEwKTtcbn07XG5cbi8vIFRoZSBSVENQIENOQU1FIHVzZWQgYnkgYWxsIHBlZXJjb25uZWN0aW9ucyBmcm9tIHRoZSBzYW1lIEpTLlxuU0RQVXRpbHMubG9jYWxDTmFtZSA9IFNEUFV0aWxzLmdlbmVyYXRlSWRlbnRpZmllcigpO1xuXG4vLyBTcGxpdHMgU0RQIGludG8gbGluZXMsIGRlYWxpbmcgd2l0aCBib3RoIENSTEYgYW5kIExGLlxuU0RQVXRpbHMuc3BsaXRMaW5lcyA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgcmV0dXJuIGJsb2IudHJpbSgpLnNwbGl0KCdcXG4nKS5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgIHJldHVybiBsaW5lLnRyaW0oKTtcbiAgfSk7XG59O1xuLy8gU3BsaXRzIFNEUCBpbnRvIHNlc3Npb25wYXJ0IGFuZCBtZWRpYXNlY3Rpb25zLiBFbnN1cmVzIENSTEYuXG5TRFBVdGlscy5zcGxpdFNlY3Rpb25zID0gZnVuY3Rpb24oYmxvYikge1xuICB2YXIgcGFydHMgPSBibG9iLnNwbGl0KCdcXG5tPScpO1xuICByZXR1cm4gcGFydHMubWFwKGZ1bmN0aW9uKHBhcnQsIGluZGV4KSB7XG4gICAgcmV0dXJuIChpbmRleCA+IDAgPyAnbT0nICsgcGFydCA6IHBhcnQpLnRyaW0oKSArICdcXHJcXG4nO1xuICB9KTtcbn07XG5cbi8vIHJldHVybnMgdGhlIHNlc3Npb24gZGVzY3JpcHRpb24uXG5TRFBVdGlscy5nZXREZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGJsb2IpIHtcbiAgdmFyIHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhibG9iKTtcbiAgcmV0dXJuIHNlY3Rpb25zICYmIHNlY3Rpb25zWzBdO1xufTtcblxuLy8gcmV0dXJucyB0aGUgaW5kaXZpZHVhbCBtZWRpYSBzZWN0aW9ucy5cblNEUFV0aWxzLmdldE1lZGlhU2VjdGlvbnMgPSBmdW5jdGlvbihibG9iKSB7XG4gIHZhciBzZWN0aW9ucyA9IFNEUFV0aWxzLnNwbGl0U2VjdGlvbnMoYmxvYik7XG4gIHNlY3Rpb25zLnNoaWZ0KCk7XG4gIHJldHVybiBzZWN0aW9ucztcbn07XG5cbi8vIFJldHVybnMgbGluZXMgdGhhdCBzdGFydCB3aXRoIGEgY2VydGFpbiBwcmVmaXguXG5TRFBVdGlscy5tYXRjaFByZWZpeCA9IGZ1bmN0aW9uKGJsb2IsIHByZWZpeCkge1xuICByZXR1cm4gU0RQVXRpbHMuc3BsaXRMaW5lcyhibG9iKS5maWx0ZXIoZnVuY3Rpb24obGluZSkge1xuICAgIHJldHVybiBsaW5lLmluZGV4T2YocHJlZml4KSA9PT0gMDtcbiAgfSk7XG59O1xuXG4vLyBQYXJzZXMgYW4gSUNFIGNhbmRpZGF0ZSBsaW5lLiBTYW1wbGUgaW5wdXQ6XG4vLyBjYW5kaWRhdGU6NzAyNzg2MzUwIDIgdWRwIDQxODE5OTAyIDguOC44LjggNjA3NjkgdHlwIHJlbGF5IHJhZGRyIDguOC44Ljhcbi8vIHJwb3J0IDU1OTk2XCJcblNEUFV0aWxzLnBhcnNlQ2FuZGlkYXRlID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgcGFydHM7XG4gIC8vIFBhcnNlIGJvdGggdmFyaWFudHMuXG4gIGlmIChsaW5lLmluZGV4T2YoJ2E9Y2FuZGlkYXRlOicpID09PSAwKSB7XG4gICAgcGFydHMgPSBsaW5lLnN1YnN0cmluZygxMikuc3BsaXQoJyAnKTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0cyA9IGxpbmUuc3Vic3RyaW5nKDEwKS5zcGxpdCgnICcpO1xuICB9XG5cbiAgdmFyIGNhbmRpZGF0ZSA9IHtcbiAgICBmb3VuZGF0aW9uOiBwYXJ0c1swXSxcbiAgICBjb21wb25lbnQ6IHBhcnNlSW50KHBhcnRzWzFdLCAxMCksXG4gICAgcHJvdG9jb2w6IHBhcnRzWzJdLnRvTG93ZXJDYXNlKCksXG4gICAgcHJpb3JpdHk6IHBhcnNlSW50KHBhcnRzWzNdLCAxMCksXG4gICAgaXA6IHBhcnRzWzRdLFxuICAgIHBvcnQ6IHBhcnNlSW50KHBhcnRzWzVdLCAxMCksXG4gICAgLy8gc2tpcCBwYXJ0c1s2XSA9PSAndHlwJ1xuICAgIHR5cGU6IHBhcnRzWzddXG4gIH07XG5cbiAgZm9yICh2YXIgaSA9IDg7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHN3aXRjaCAocGFydHNbaV0pIHtcbiAgICAgIGNhc2UgJ3JhZGRyJzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3Jwb3J0JzpcbiAgICAgICAgY2FuZGlkYXRlLnJlbGF0ZWRQb3J0ID0gcGFyc2VJbnQocGFydHNbaSArIDFdLCAxMCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGNwdHlwZSc6XG4gICAgICAgIGNhbmRpZGF0ZS50Y3BUeXBlID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3VmcmFnJzpcbiAgICAgICAgY2FuZGlkYXRlLnVmcmFnID0gcGFydHNbaSArIDFdOyAvLyBmb3IgYmFja3dhcmQgY29tcGFiaWxpdHkuXG4gICAgICAgIGNhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50ID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICAgIGRlZmF1bHQ6IC8vIGV4dGVuc2lvbiBoYW5kbGluZywgaW4gcGFydGljdWxhciB1ZnJhZ1xuICAgICAgICBjYW5kaWRhdGVbcGFydHNbaV1dID0gcGFydHNbaSArIDFdO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNhbmRpZGF0ZTtcbn07XG5cbi8vIFRyYW5zbGF0ZXMgYSBjYW5kaWRhdGUgb2JqZWN0IGludG8gU0RQIGNhbmRpZGF0ZSBhdHRyaWJ1dGUuXG5TRFBVdGlscy53cml0ZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICB2YXIgc2RwID0gW107XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5mb3VuZGF0aW9uKTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLmNvbXBvbmVudCk7XG4gIHNkcC5wdXNoKGNhbmRpZGF0ZS5wcm90b2NvbC50b1VwcGVyQ2FzZSgpKTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLnByaW9yaXR5KTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLmlwKTtcbiAgc2RwLnB1c2goY2FuZGlkYXRlLnBvcnQpO1xuXG4gIHZhciB0eXBlID0gY2FuZGlkYXRlLnR5cGU7XG4gIHNkcC5wdXNoKCd0eXAnKTtcbiAgc2RwLnB1c2godHlwZSk7XG4gIGlmICh0eXBlICE9PSAnaG9zdCcgJiYgY2FuZGlkYXRlLnJlbGF0ZWRBZGRyZXNzICYmXG4gICAgICBjYW5kaWRhdGUucmVsYXRlZFBvcnQpIHtcbiAgICBzZHAucHVzaCgncmFkZHInKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUucmVsYXRlZEFkZHJlc3MpO1xuICAgIHNkcC5wdXNoKCdycG9ydCcpO1xuICAgIHNkcC5wdXNoKGNhbmRpZGF0ZS5yZWxhdGVkUG9ydCk7XG4gIH1cbiAgaWYgKGNhbmRpZGF0ZS50Y3BUeXBlICYmIGNhbmRpZGF0ZS5wcm90b2NvbC50b0xvd2VyQ2FzZSgpID09PSAndGNwJykge1xuICAgIHNkcC5wdXNoKCd0Y3B0eXBlJyk7XG4gICAgc2RwLnB1c2goY2FuZGlkYXRlLnRjcFR5cGUpO1xuICB9XG4gIGlmIChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpIHtcbiAgICBzZHAucHVzaCgndWZyYWcnKTtcbiAgICBzZHAucHVzaChjYW5kaWRhdGUudXNlcm5hbWVGcmFnbWVudCB8fCBjYW5kaWRhdGUudWZyYWcpO1xuICB9XG4gIHJldHVybiAnY2FuZGlkYXRlOicgKyBzZHAuam9pbignICcpO1xufTtcblxuLy8gUGFyc2VzIGFuIGljZS1vcHRpb25zIGxpbmUsIHJldHVybnMgYW4gYXJyYXkgb2Ygb3B0aW9uIHRhZ3MuXG4vLyBhPWljZS1vcHRpb25zOmZvbyBiYXJcblNEUFV0aWxzLnBhcnNlSWNlT3B0aW9ucyA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgcmV0dXJuIGxpbmUuc3Vic3RyKDE0KS5zcGxpdCgnICcpO1xufVxuXG4vLyBQYXJzZXMgYW4gcnRwbWFwIGxpbmUsIHJldHVybnMgUlRDUnRwQ29kZGVjUGFyYW1ldGVycy4gU2FtcGxlIGlucHV0OlxuLy8gYT1ydHBtYXA6MTExIG9wdXMvNDgwMDAvMlxuU0RQVXRpbHMucGFyc2VSdHBNYXAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBwYXJ0cyA9IGxpbmUuc3Vic3RyKDkpLnNwbGl0KCcgJyk7XG4gIHZhciBwYXJzZWQgPSB7XG4gICAgcGF5bG9hZFR5cGU6IHBhcnNlSW50KHBhcnRzLnNoaWZ0KCksIDEwKSAvLyB3YXM6IGlkXG4gIH07XG5cbiAgcGFydHMgPSBwYXJ0c1swXS5zcGxpdCgnLycpO1xuXG4gIHBhcnNlZC5uYW1lID0gcGFydHNbMF07XG4gIHBhcnNlZC5jbG9ja1JhdGUgPSBwYXJzZUludChwYXJ0c1sxXSwgMTApOyAvLyB3YXM6IGNsb2NrcmF0ZVxuICBwYXJzZWQuY2hhbm5lbHMgPSBwYXJ0cy5sZW5ndGggPT09IDMgPyBwYXJzZUludChwYXJ0c1syXSwgMTApIDogMTtcbiAgLy8gbGVnYWN5IGFsaWFzLCBnb3QgcmVuYW1lZCBiYWNrIHRvIGNoYW5uZWxzIGluIE9SVEMuXG4gIHBhcnNlZC5udW1DaGFubmVscyA9IHBhcnNlZC5jaGFubmVscztcbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlIGFuIGE9cnRwbWFwIGxpbmUgZnJvbSBSVENSdHBDb2RlY0NhcGFiaWxpdHkgb3Jcbi8vIFJUQ1J0cENvZGVjUGFyYW1ldGVycy5cblNEUFV0aWxzLndyaXRlUnRwTWFwID0gZnVuY3Rpb24oY29kZWMpIHtcbiAgdmFyIHB0ID0gY29kZWMucGF5bG9hZFR5cGU7XG4gIGlmIChjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcHQgPSBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgfVxuICB2YXIgY2hhbm5lbHMgPSBjb2RlYy5jaGFubmVscyB8fCBjb2RlYy5udW1DaGFubmVscyB8fCAxO1xuICByZXR1cm4gJ2E9cnRwbWFwOicgKyBwdCArICcgJyArIGNvZGVjLm5hbWUgKyAnLycgKyBjb2RlYy5jbG9ja1JhdGUgK1xuICAgICAgKGNoYW5uZWxzICE9PSAxID8gJy8nICsgY2hhbm5lbHMgOiAnJykgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyBhbiBhPWV4dG1hcCBsaW5lIChoZWFkZXJleHRlbnNpb24gZnJvbSBSRkMgNTI4NSkuIFNhbXBsZSBpbnB1dDpcbi8vIGE9ZXh0bWFwOjIgdXJuOmlldGY6cGFyYW1zOnJ0cC1oZHJleHQ6dG9mZnNldFxuLy8gYT1leHRtYXA6Mi9zZW5kb25seSB1cm46aWV0ZjpwYXJhbXM6cnRwLWhkcmV4dDp0b2Zmc2V0XG5TRFBVdGlscy5wYXJzZUV4dG1hcCA9IGZ1bmN0aW9uKGxpbmUpIHtcbiAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIoOSkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBpZDogcGFyc2VJbnQocGFydHNbMF0sIDEwKSxcbiAgICBkaXJlY3Rpb246IHBhcnRzWzBdLmluZGV4T2YoJy8nKSA+IDAgPyBwYXJ0c1swXS5zcGxpdCgnLycpWzFdIDogJ3NlbmRyZWN2JyxcbiAgICB1cmk6IHBhcnRzWzFdXG4gIH07XG59O1xuXG4vLyBHZW5lcmF0ZXMgYT1leHRtYXAgbGluZSBmcm9tIFJUQ1J0cEhlYWRlckV4dGVuc2lvblBhcmFtZXRlcnMgb3Jcbi8vIFJUQ1J0cEhlYWRlckV4dGVuc2lvbi5cblNEUFV0aWxzLndyaXRlRXh0bWFwID0gZnVuY3Rpb24oaGVhZGVyRXh0ZW5zaW9uKSB7XG4gIHJldHVybiAnYT1leHRtYXA6JyArIChoZWFkZXJFeHRlbnNpb24uaWQgfHwgaGVhZGVyRXh0ZW5zaW9uLnByZWZlcnJlZElkKSArXG4gICAgICAoaGVhZGVyRXh0ZW5zaW9uLmRpcmVjdGlvbiAmJiBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uICE9PSAnc2VuZHJlY3YnXG4gICAgICAgICAgPyAnLycgKyBoZWFkZXJFeHRlbnNpb24uZGlyZWN0aW9uXG4gICAgICAgICAgOiAnJykgK1xuICAgICAgJyAnICsgaGVhZGVyRXh0ZW5zaW9uLnVyaSArICdcXHJcXG4nO1xufTtcblxuLy8gUGFyc2VzIGFuIGZ0bXAgbGluZSwgcmV0dXJucyBkaWN0aW9uYXJ5LiBTYW1wbGUgaW5wdXQ6XG4vLyBhPWZtdHA6OTYgdmJyPW9uO2NuZz1vblxuLy8gQWxzbyBkZWFscyB3aXRoIHZicj1vbjsgY25nPW9uXG5TRFBVdGlscy5wYXJzZUZtdHAgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBwYXJzZWQgPSB7fTtcbiAgdmFyIGt2O1xuICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cihsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCc7Jyk7XG4gIGZvciAodmFyIGogPSAwOyBqIDwgcGFydHMubGVuZ3RoOyBqKyspIHtcbiAgICBrdiA9IHBhcnRzW2pdLnRyaW0oKS5zcGxpdCgnPScpO1xuICAgIHBhcnNlZFtrdlswXS50cmltKCldID0ga3ZbMV07XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn07XG5cbi8vIEdlbmVyYXRlcyBhbiBhPWZ0bXAgbGluZSBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZUZtdHAgPSBmdW5jdGlvbihjb2RlYykge1xuICB2YXIgbGluZSA9ICcnO1xuICB2YXIgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5wYXJhbWV0ZXJzICYmIE9iamVjdC5rZXlzKGNvZGVjLnBhcmFtZXRlcnMpLmxlbmd0aCkge1xuICAgIHZhciBwYXJhbXMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhjb2RlYy5wYXJhbWV0ZXJzKS5mb3JFYWNoKGZ1bmN0aW9uKHBhcmFtKSB7XG4gICAgICBpZiAoY29kZWMucGFyYW1ldGVyc1twYXJhbV0pIHtcbiAgICAgICAgcGFyYW1zLnB1c2gocGFyYW0gKyAnPScgKyBjb2RlYy5wYXJhbWV0ZXJzW3BhcmFtXSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJhbXMucHVzaChwYXJhbSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgbGluZSArPSAnYT1mbXRwOicgKyBwdCArICcgJyArIHBhcmFtcy5qb2luKCc7JykgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gbGluZTtcbn07XG5cbi8vIFBhcnNlcyBhbiBydGNwLWZiIGxpbmUsIHJldHVybnMgUlRDUFJ0Y3BGZWVkYmFjayBvYmplY3QuIFNhbXBsZSBpbnB1dDpcbi8vIGE9cnRjcC1mYjo5OCBuYWNrIHJwc2lcblNEUFV0aWxzLnBhcnNlUnRjcEZiID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cihsaW5lLmluZGV4T2YoJyAnKSArIDEpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAgdHlwZTogcGFydHMuc2hpZnQoKSxcbiAgICBwYXJhbWV0ZXI6IHBhcnRzLmpvaW4oJyAnKVxuICB9O1xufTtcbi8vIEdlbmVyYXRlIGE9cnRjcC1mYiBsaW5lcyBmcm9tIFJUQ1J0cENvZGVjQ2FwYWJpbGl0eSBvciBSVENSdHBDb2RlY1BhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0Y3BGYiA9IGZ1bmN0aW9uKGNvZGVjKSB7XG4gIHZhciBsaW5lcyA9ICcnO1xuICB2YXIgcHQgPSBjb2RlYy5wYXlsb2FkVHlwZTtcbiAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICBwdCA9IGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlO1xuICB9XG4gIGlmIChjb2RlYy5ydGNwRmVlZGJhY2sgJiYgY29kZWMucnRjcEZlZWRiYWNrLmxlbmd0aCkge1xuICAgIC8vIEZJWE1FOiBzcGVjaWFsIGhhbmRsaW5nIGZvciB0cnItaW50P1xuICAgIGNvZGVjLnJ0Y3BGZWVkYmFjay5mb3JFYWNoKGZ1bmN0aW9uKGZiKSB7XG4gICAgICBsaW5lcyArPSAnYT1ydGNwLWZiOicgKyBwdCArICcgJyArIGZiLnR5cGUgK1xuICAgICAgKGZiLnBhcmFtZXRlciAmJiBmYi5wYXJhbWV0ZXIubGVuZ3RoID8gJyAnICsgZmIucGFyYW1ldGVyIDogJycpICtcbiAgICAgICAgICAnXFxyXFxuJztcbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGluZXM7XG59O1xuXG4vLyBQYXJzZXMgYW4gUkZDIDU1NzYgc3NyYyBtZWRpYSBhdHRyaWJ1dGUuIFNhbXBsZSBpbnB1dDpcbi8vIGE9c3NyYzozNzM1OTI4NTU5IGNuYW1lOnNvbWV0aGluZ1xuU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEgPSBmdW5jdGlvbihsaW5lKSB7XG4gIHZhciBzcCA9IGxpbmUuaW5kZXhPZignICcpO1xuICB2YXIgcGFydHMgPSB7XG4gICAgc3NyYzogcGFyc2VJbnQobGluZS5zdWJzdHIoNywgc3AgLSA3KSwgMTApXG4gIH07XG4gIHZhciBjb2xvbiA9IGxpbmUuaW5kZXhPZignOicsIHNwKTtcbiAgaWYgKGNvbG9uID4gLTEpIHtcbiAgICBwYXJ0cy5hdHRyaWJ1dGUgPSBsaW5lLnN1YnN0cihzcCArIDEsIGNvbG9uIC0gc3AgLSAxKTtcbiAgICBwYXJ0cy52YWx1ZSA9IGxpbmUuc3Vic3RyKGNvbG9uICsgMSk7XG4gIH0gZWxzZSB7XG4gICAgcGFydHMuYXR0cmlidXRlID0gbGluZS5zdWJzdHIoc3AgKyAxKTtcbiAgfVxuICByZXR1cm4gcGFydHM7XG59O1xuXG4vLyBFeHRyYWN0cyB0aGUgTUlEIChSRkMgNTg4OCkgZnJvbSBhIG1lZGlhIHNlY3Rpb24uXG4vLyByZXR1cm5zIHRoZSBNSUQgb3IgdW5kZWZpbmVkIGlmIG5vIG1pZCBsaW5lIHdhcyBmb3VuZC5cblNEUFV0aWxzLmdldE1pZCA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgbWlkID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYT1taWQ6JylbMF07XG4gIGlmIChtaWQpIHtcbiAgICByZXR1cm4gbWlkLnN1YnN0cig2KTtcbiAgfVxufVxuXG5TRFBVdGlscy5wYXJzZUZpbmdlcnByaW50ID0gZnVuY3Rpb24obGluZSkge1xuICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cigxNCkuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICBhbGdvcml0aG06IHBhcnRzWzBdLnRvTG93ZXJDYXNlKCksIC8vIGFsZ29yaXRobSBpcyBjYXNlLXNlbnNpdGl2ZSBpbiBFZGdlLlxuICAgIHZhbHVlOiBwYXJ0c1sxXVxuICB9O1xufTtcblxuLy8gRXh0cmFjdHMgRFRMUyBwYXJhbWV0ZXJzIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBmaW5nZXJwcmludCBsaW5lIGFzIGlucHV0LiBTZWUgYWxzbyBnZXRJY2VQYXJhbWV0ZXJzLlxuU0RQVXRpbHMuZ2V0RHRsc1BhcmFtZXRlcnMgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIHZhciBsaW5lcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiArIHNlc3Npb25wYXJ0LFxuICAgICAgJ2E9ZmluZ2VycHJpbnQ6Jyk7XG4gIC8vIE5vdGU6IGE9c2V0dXAgbGluZSBpcyBpZ25vcmVkIHNpbmNlIHdlIHVzZSB0aGUgJ2F1dG8nIHJvbGUuXG4gIC8vIE5vdGUyOiAnYWxnb3JpdGhtJyBpcyBub3QgY2FzZSBzZW5zaXRpdmUgZXhjZXB0IGluIEVkZ2UuXG4gIHJldHVybiB7XG4gICAgcm9sZTogJ2F1dG8nLFxuICAgIGZpbmdlcnByaW50czogbGluZXMubWFwKFNEUFV0aWxzLnBhcnNlRmluZ2VycHJpbnQpXG4gIH07XG59O1xuXG4vLyBTZXJpYWxpemVzIERUTFMgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUR0bHNQYXJhbWV0ZXJzID0gZnVuY3Rpb24ocGFyYW1zLCBzZXR1cFR5cGUpIHtcbiAgdmFyIHNkcCA9ICdhPXNldHVwOicgKyBzZXR1cFR5cGUgKyAnXFxyXFxuJztcbiAgcGFyYW1zLmZpbmdlcnByaW50cy5mb3JFYWNoKGZ1bmN0aW9uKGZwKSB7XG4gICAgc2RwICs9ICdhPWZpbmdlcnByaW50OicgKyBmcC5hbGdvcml0aG0gKyAnICcgKyBmcC52YWx1ZSArICdcXHJcXG4nO1xuICB9KTtcbiAgcmV0dXJuIHNkcDtcbn07XG4vLyBQYXJzZXMgSUNFIGluZm9ybWF0aW9uIGZyb20gU0RQIG1lZGlhIHNlY3Rpb24gb3Igc2Vzc2lvbnBhcnQuXG4vLyBGSVhNRTogZm9yIGNvbnNpc3RlbmN5IHdpdGggb3RoZXIgZnVuY3Rpb25zIHRoaXMgc2hvdWxkIG9ubHlcbi8vICAgZ2V0IHRoZSBpY2UtdWZyYWcgYW5kIGljZS1wd2QgbGluZXMgYXMgaW5wdXQuXG5TRFBVdGlscy5nZXRJY2VQYXJhbWV0ZXJzID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uLCBzZXNzaW9ucGFydCkge1xuICB2YXIgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIC8vIFNlYXJjaCBpbiBzZXNzaW9uIHBhcnQsIHRvby5cbiAgbGluZXMgPSBsaW5lcy5jb25jYXQoU0RQVXRpbHMuc3BsaXRMaW5lcyhzZXNzaW9ucGFydCkpO1xuICB2YXIgaWNlUGFyYW1ldGVycyA9IHtcbiAgICB1c2VybmFtZUZyYWdtZW50OiBsaW5lcy5maWx0ZXIoZnVuY3Rpb24obGluZSkge1xuICAgICAgcmV0dXJuIGxpbmUuaW5kZXhPZignYT1pY2UtdWZyYWc6JykgPT09IDA7XG4gICAgfSlbMF0uc3Vic3RyKDEyKSxcbiAgICBwYXNzd29yZDogbGluZXMuZmlsdGVyKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICAgIHJldHVybiBsaW5lLmluZGV4T2YoJ2E9aWNlLXB3ZDonKSA9PT0gMDtcbiAgICB9KVswXS5zdWJzdHIoMTApXG4gIH07XG4gIHJldHVybiBpY2VQYXJhbWV0ZXJzO1xufTtcblxuLy8gU2VyaWFsaXplcyBJQ0UgcGFyYW1ldGVycyB0byBTRFAuXG5TRFBVdGlscy53cml0ZUljZVBhcmFtZXRlcnMgPSBmdW5jdGlvbihwYXJhbXMpIHtcbiAgcmV0dXJuICdhPWljZS11ZnJhZzonICsgcGFyYW1zLnVzZXJuYW1lRnJhZ21lbnQgKyAnXFxyXFxuJyArXG4gICAgICAnYT1pY2UtcHdkOicgKyBwYXJhbXMucGFzc3dvcmQgKyAnXFxyXFxuJztcbn07XG5cbi8vIFBhcnNlcyB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gYW5kIHJldHVybnMgUlRDUnRwUGFyYW1ldGVycy5cblNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgZGVzY3JpcHRpb24gPSB7XG4gICAgY29kZWNzOiBbXSxcbiAgICBoZWFkZXJFeHRlbnNpb25zOiBbXSxcbiAgICBmZWNNZWNoYW5pc21zOiBbXSxcbiAgICBydGNwOiBbXVxuICB9O1xuICB2YXIgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIHZhciBtbGluZSA9IGxpbmVzWzBdLnNwbGl0KCcgJyk7XG4gIGZvciAodmFyIGkgPSAzOyBpIDwgbWxpbmUubGVuZ3RoOyBpKyspIHsgLy8gZmluZCBhbGwgY29kZWNzIGZyb20gbWxpbmVbMy4uXVxuICAgIHZhciBwdCA9IG1saW5lW2ldO1xuICAgIHZhciBydHBtYXBsaW5lID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRwbWFwOicgKyBwdCArICcgJylbMF07XG4gICAgaWYgKHJ0cG1hcGxpbmUpIHtcbiAgICAgIHZhciBjb2RlYyA9IFNEUFV0aWxzLnBhcnNlUnRwTWFwKHJ0cG1hcGxpbmUpO1xuICAgICAgdmFyIGZtdHBzID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgoXG4gICAgICAgICAgbWVkaWFTZWN0aW9uLCAnYT1mbXRwOicgKyBwdCArICcgJyk7XG4gICAgICAvLyBPbmx5IHRoZSBmaXJzdCBhPWZtdHA6PHB0PiBpcyBjb25zaWRlcmVkLlxuICAgICAgY29kZWMucGFyYW1ldGVycyA9IGZtdHBzLmxlbmd0aCA/IFNEUFV0aWxzLnBhcnNlRm10cChmbXRwc1swXSkgOiB7fTtcbiAgICAgIGNvZGVjLnJ0Y3BGZWVkYmFjayA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KFxuICAgICAgICAgIG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1mYjonICsgcHQgKyAnICcpXG4gICAgICAgIC5tYXAoU0RQVXRpbHMucGFyc2VSdGNwRmIpO1xuICAgICAgZGVzY3JpcHRpb24uY29kZWNzLnB1c2goY29kZWMpO1xuICAgICAgLy8gcGFyc2UgRkVDIG1lY2hhbmlzbXMgZnJvbSBydHBtYXAgbGluZXMuXG4gICAgICBzd2l0Y2ggKGNvZGVjLm5hbWUudG9VcHBlckNhc2UoKSkge1xuICAgICAgICBjYXNlICdSRUQnOlxuICAgICAgICBjYXNlICdVTFBGRUMnOlxuICAgICAgICAgIGRlc2NyaXB0aW9uLmZlY01lY2hhbmlzbXMucHVzaChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkpO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBkZWZhdWx0OiAvLyBvbmx5IFJFRCBhbmQgVUxQRkVDIGFyZSByZWNvZ25pemVkIGFzIEZFQyBtZWNoYW5pc21zLlxuICAgICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPWV4dG1hcDonKS5mb3JFYWNoKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICBkZXNjcmlwdGlvbi5oZWFkZXJFeHRlbnNpb25zLnB1c2goU0RQVXRpbHMucGFyc2VFeHRtYXAobGluZSkpO1xuICB9KTtcbiAgLy8gRklYTUU6IHBhcnNlIHJ0Y3AuXG4gIHJldHVybiBkZXNjcmlwdGlvbjtcbn07XG5cbi8vIEdlbmVyYXRlcyBwYXJ0cyBvZiB0aGUgU0RQIG1lZGlhIHNlY3Rpb24gZGVzY3JpYmluZyB0aGUgY2FwYWJpbGl0aWVzIC9cbi8vIHBhcmFtZXRlcnMuXG5TRFBVdGlscy53cml0ZVJ0cERlc2NyaXB0aW9uID0gZnVuY3Rpb24oa2luZCwgY2Fwcykge1xuICB2YXIgc2RwID0gJyc7XG5cbiAgLy8gQnVpbGQgdGhlIG1saW5lLlxuICBzZHAgKz0gJ209JyArIGtpbmQgKyAnICc7XG4gIHNkcCArPSBjYXBzLmNvZGVjcy5sZW5ndGggPiAwID8gJzknIDogJzAnOyAvLyByZWplY3QgaWYgbm8gY29kZWNzLlxuICBzZHAgKz0gJyBVRFAvVExTL1JUUC9TQVZQRiAnO1xuICBzZHAgKz0gY2Fwcy5jb2RlY3MubWFwKGZ1bmN0aW9uKGNvZGVjKSB7XG4gICAgaWYgKGNvZGVjLnByZWZlcnJlZFBheWxvYWRUeXBlICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBjb2RlYy5wcmVmZXJyZWRQYXlsb2FkVHlwZTtcbiAgICB9XG4gICAgcmV0dXJuIGNvZGVjLnBheWxvYWRUeXBlO1xuICB9KS5qb2luKCcgJykgKyAnXFxyXFxuJztcblxuICBzZHAgKz0gJ2M9SU4gSVA0IDAuMC4wLjBcXHJcXG4nO1xuICBzZHAgKz0gJ2E9cnRjcDo5IElOIElQNCAwLjAuMC4wXFxyXFxuJztcblxuICAvLyBBZGQgYT1ydHBtYXAgbGluZXMgZm9yIGVhY2ggY29kZWMuIEFsc28gZm10cCBhbmQgcnRjcC1mYi5cbiAgY2Fwcy5jb2RlY3MuZm9yRWFjaChmdW5jdGlvbihjb2RlYykge1xuICAgIHNkcCArPSBTRFBVdGlscy53cml0ZVJ0cE1hcChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRm10cChjb2RlYyk7XG4gICAgc2RwICs9IFNEUFV0aWxzLndyaXRlUnRjcEZiKGNvZGVjKTtcbiAgfSk7XG4gIHZhciBtYXhwdGltZSA9IDA7XG4gIGNhcHMuY29kZWNzLmZvckVhY2goZnVuY3Rpb24oY29kZWMpIHtcbiAgICBpZiAoY29kZWMubWF4cHRpbWUgPiBtYXhwdGltZSkge1xuICAgICAgbWF4cHRpbWUgPSBjb2RlYy5tYXhwdGltZTtcbiAgICB9XG4gIH0pO1xuICBpZiAobWF4cHRpbWUgPiAwKSB7XG4gICAgc2RwICs9ICdhPW1heHB0aW1lOicgKyBtYXhwdGltZSArICdcXHJcXG4nO1xuICB9XG4gIHNkcCArPSAnYT1ydGNwLW11eFxcclxcbic7XG5cbiAgaWYgKGNhcHMuaGVhZGVyRXh0ZW5zaW9ucykge1xuICAgIGNhcHMuaGVhZGVyRXh0ZW5zaW9ucy5mb3JFYWNoKGZ1bmN0aW9uKGV4dGVuc2lvbikge1xuICAgICAgc2RwICs9IFNEUFV0aWxzLndyaXRlRXh0bWFwKGV4dGVuc2lvbik7XG4gICAgfSk7XG4gIH1cbiAgLy8gRklYTUU6IHdyaXRlIGZlY01lY2hhbmlzbXMuXG4gIHJldHVybiBzZHA7XG59O1xuXG4vLyBQYXJzZXMgdGhlIFNEUCBtZWRpYSBzZWN0aW9uIGFuZCByZXR1cm5zIGFuIGFycmF5IG9mXG4vLyBSVENSdHBFbmNvZGluZ1BhcmFtZXRlcnMuXG5TRFBVdGlscy5wYXJzZVJ0cEVuY29kaW5nUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgZW5jb2RpbmdQYXJhbWV0ZXJzID0gW107XG4gIHZhciBkZXNjcmlwdGlvbiA9IFNEUFV0aWxzLnBhcnNlUnRwUGFyYW1ldGVycyhtZWRpYVNlY3Rpb24pO1xuICB2YXIgaGFzUmVkID0gZGVzY3JpcHRpb24uZmVjTWVjaGFuaXNtcy5pbmRleE9mKCdSRUQnKSAhPT0gLTE7XG4gIHZhciBoYXNVbHBmZWMgPSBkZXNjcmlwdGlvbi5mZWNNZWNoYW5pc21zLmluZGV4T2YoJ1VMUEZFQycpICE9PSAtMTtcblxuICAvLyBmaWx0ZXIgYT1zc3JjOi4uLiBjbmFtZTosIGlnbm9yZSBQbGFuQi1tc2lkXG4gIHZhciBzc3JjcyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9c3NyYzonKVxuICAubWFwKGZ1bmN0aW9uKGxpbmUpIHtcbiAgICByZXR1cm4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSk7XG4gIH0pXG4gIC5maWx0ZXIoZnVuY3Rpb24ocGFydHMpIHtcbiAgICByZXR1cm4gcGFydHMuYXR0cmlidXRlID09PSAnY25hbWUnO1xuICB9KTtcbiAgdmFyIHByaW1hcnlTc3JjID0gc3NyY3MubGVuZ3RoID4gMCAmJiBzc3Jjc1swXS5zc3JjO1xuICB2YXIgc2Vjb25kYXJ5U3NyYztcblxuICB2YXIgZmxvd3MgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmMtZ3JvdXA6RklEJylcbiAgLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgdmFyIHBhcnRzID0gbGluZS5zdWJzdHIoMTcpLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHBhcnRzLm1hcChmdW5jdGlvbihwYXJ0KSB7XG4gICAgICByZXR1cm4gcGFyc2VJbnQocGFydCwgMTApO1xuICAgIH0pO1xuICB9KTtcbiAgaWYgKGZsb3dzLmxlbmd0aCA+IDAgJiYgZmxvd3NbMF0ubGVuZ3RoID4gMSAmJiBmbG93c1swXVswXSA9PT0gcHJpbWFyeVNzcmMpIHtcbiAgICBzZWNvbmRhcnlTc3JjID0gZmxvd3NbMF1bMV07XG4gIH1cblxuICBkZXNjcmlwdGlvbi5jb2RlY3MuZm9yRWFjaChmdW5jdGlvbihjb2RlYykge1xuICAgIGlmIChjb2RlYy5uYW1lLnRvVXBwZXJDYXNlKCkgPT09ICdSVFgnICYmIGNvZGVjLnBhcmFtZXRlcnMuYXB0KSB7XG4gICAgICB2YXIgZW5jUGFyYW0gPSB7XG4gICAgICAgIHNzcmM6IHByaW1hcnlTc3JjLFxuICAgICAgICBjb2RlY1BheWxvYWRUeXBlOiBwYXJzZUludChjb2RlYy5wYXJhbWV0ZXJzLmFwdCwgMTApLFxuICAgICAgfTtcbiAgICAgIGlmIChwcmltYXJ5U3NyYyAmJiBzZWNvbmRhcnlTc3JjKSB7XG4gICAgICAgIGVuY1BhcmFtLnJ0eCA9IHtzc3JjOiBzZWNvbmRhcnlTc3JjfTtcbiAgICAgIH1cbiAgICAgIGVuY29kaW5nUGFyYW1ldGVycy5wdXNoKGVuY1BhcmFtKTtcbiAgICAgIGlmIChoYXNSZWQpIHtcbiAgICAgICAgZW5jUGFyYW0gPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGVuY1BhcmFtKSk7XG4gICAgICAgIGVuY1BhcmFtLmZlYyA9IHtcbiAgICAgICAgICBzc3JjOiBzZWNvbmRhcnlTc3JjLFxuICAgICAgICAgIG1lY2hhbmlzbTogaGFzVWxwZmVjID8gJ3JlZCt1bHBmZWMnIDogJ3JlZCdcbiAgICAgICAgfTtcbiAgICAgICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goZW5jUGFyYW0pO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG4gIGlmIChlbmNvZGluZ1BhcmFtZXRlcnMubGVuZ3RoID09PSAwICYmIHByaW1hcnlTc3JjKSB7XG4gICAgZW5jb2RpbmdQYXJhbWV0ZXJzLnB1c2goe1xuICAgICAgc3NyYzogcHJpbWFyeVNzcmNcbiAgICB9KTtcbiAgfVxuXG4gIC8vIHdlIHN1cHBvcnQgYm90aCBiPUFTIGFuZCBiPVRJQVMgYnV0IGludGVycHJldCBBUyBhcyBUSUFTLlxuICB2YXIgYmFuZHdpZHRoID0gU0RQVXRpbHMubWF0Y2hQcmVmaXgobWVkaWFTZWN0aW9uLCAnYj0nKTtcbiAgaWYgKGJhbmR3aWR0aC5sZW5ndGgpIHtcbiAgICBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9VElBUzonKSA9PT0gMCkge1xuICAgICAgYmFuZHdpZHRoID0gcGFyc2VJbnQoYmFuZHdpZHRoWzBdLnN1YnN0cig3KSwgMTApO1xuICAgIH0gZWxzZSBpZiAoYmFuZHdpZHRoWzBdLmluZGV4T2YoJ2I9QVM6JykgPT09IDApIHtcbiAgICAgIC8vIHVzZSBmb3JtdWxhIGZyb20gSlNFUCB0byBjb252ZXJ0IGI9QVMgdG8gVElBUyB2YWx1ZS5cbiAgICAgIGJhbmR3aWR0aCA9IHBhcnNlSW50KGJhbmR3aWR0aFswXS5zdWJzdHIoNSksIDEwKSAqIDEwMDAgKiAwLjk1XG4gICAgICAgICAgLSAoNTAgKiA0MCAqIDgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBiYW5kd2lkdGggPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGVuY29kaW5nUGFyYW1ldGVycy5mb3JFYWNoKGZ1bmN0aW9uKHBhcmFtcykge1xuICAgICAgcGFyYW1zLm1heEJpdHJhdGUgPSBiYW5kd2lkdGg7XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIGVuY29kaW5nUGFyYW1ldGVycztcbn07XG5cbi8vIHBhcnNlcyBodHRwOi8vZHJhZnQub3J0Yy5vcmcvI3J0Y3J0Y3BwYXJhbWV0ZXJzKlxuU0RQVXRpbHMucGFyc2VSdGNwUGFyYW1ldGVycyA9IGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICB2YXIgcnRjcFBhcmFtZXRlcnMgPSB7fTtcblxuICB2YXIgY25hbWU7XG4gIC8vIEdldHMgdGhlIGZpcnN0IFNTUkMuIE5vdGUgdGhhdCB3aXRoIFJUWCB0aGVyZSBtaWdodCBiZSBtdWx0aXBsZVxuICAvLyBTU1JDcy5cbiAgdmFyIHJlbW90ZVNzcmMgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgICAgIC5tYXAoZnVuY3Rpb24obGluZSkge1xuICAgICAgICByZXR1cm4gU0RQVXRpbHMucGFyc2VTc3JjTWVkaWEobGluZSk7XG4gICAgICB9KVxuICAgICAgLmZpbHRlcihmdW5jdGlvbihvYmopIHtcbiAgICAgICAgcmV0dXJuIG9iai5hdHRyaWJ1dGUgPT09ICdjbmFtZSc7XG4gICAgICB9KVswXTtcbiAgaWYgKHJlbW90ZVNzcmMpIHtcbiAgICBydGNwUGFyYW1ldGVycy5jbmFtZSA9IHJlbW90ZVNzcmMudmFsdWU7XG4gICAgcnRjcFBhcmFtZXRlcnMuc3NyYyA9IHJlbW90ZVNzcmMuc3NyYztcbiAgfVxuXG4gIC8vIEVkZ2UgdXNlcyB0aGUgY29tcG91bmQgYXR0cmlidXRlIGluc3RlYWQgb2YgcmVkdWNlZFNpemVcbiAgLy8gY29tcG91bmQgaXMgIXJlZHVjZWRTaXplXG4gIHZhciByc2l6ZSA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9cnRjcC1yc2l6ZScpO1xuICBydGNwUGFyYW1ldGVycy5yZWR1Y2VkU2l6ZSA9IHJzaXplLmxlbmd0aCA+IDA7XG4gIHJ0Y3BQYXJhbWV0ZXJzLmNvbXBvdW5kID0gcnNpemUubGVuZ3RoID09PSAwO1xuXG4gIC8vIHBhcnNlcyB0aGUgcnRjcC1tdXggYXR0ctGWYnV0ZS5cbiAgLy8gTm90ZSB0aGF0IEVkZ2UgZG9lcyBub3Qgc3VwcG9ydCB1bm11eGVkIFJUQ1AuXG4gIHZhciBtdXggPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXJ0Y3AtbXV4Jyk7XG4gIHJ0Y3BQYXJhbWV0ZXJzLm11eCA9IG11eC5sZW5ndGggPiAwO1xuXG4gIHJldHVybiBydGNwUGFyYW1ldGVycztcbn07XG5cbi8vIHBhcnNlcyBlaXRoZXIgYT1tc2lkOiBvciBhPXNzcmM6Li4uIG1zaWQgbGluZXMgYW5kIHJldHVybnNcbi8vIHRoZSBpZCBvZiB0aGUgTWVkaWFTdHJlYW0gYW5kIE1lZGlhU3RyZWFtVHJhY2suXG5TRFBVdGlscy5wYXJzZU1zaWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIHBhcnRzO1xuICB2YXIgc3BlYyA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KG1lZGlhU2VjdGlvbiwgJ2E9bXNpZDonKTtcbiAgaWYgKHNwZWMubGVuZ3RoID09PSAxKSB7XG4gICAgcGFydHMgPSBzcGVjWzBdLnN1YnN0cig3KS5zcGxpdCgnICcpO1xuICAgIHJldHVybiB7c3RyZWFtOiBwYXJ0c1swXSwgdHJhY2s6IHBhcnRzWzFdfTtcbiAgfVxuICB2YXIgcGxhbkIgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdhPXNzcmM6JylcbiAgLm1hcChmdW5jdGlvbihsaW5lKSB7XG4gICAgcmV0dXJuIFNEUFV0aWxzLnBhcnNlU3NyY01lZGlhKGxpbmUpO1xuICB9KVxuICAuZmlsdGVyKGZ1bmN0aW9uKHBhcnRzKSB7XG4gICAgcmV0dXJuIHBhcnRzLmF0dHJpYnV0ZSA9PT0gJ21zaWQnO1xuICB9KTtcbiAgaWYgKHBsYW5CLmxlbmd0aCA+IDApIHtcbiAgICBwYXJ0cyA9IHBsYW5CWzBdLnZhbHVlLnNwbGl0KCcgJyk7XG4gICAgcmV0dXJuIHtzdHJlYW06IHBhcnRzWzBdLCB0cmFjazogcGFydHNbMV19O1xuICB9XG59O1xuXG4vLyBHZW5lcmF0ZSBhIHNlc3Npb24gSUQgZm9yIFNEUC5cbi8vIGh0dHBzOi8vdG9vbHMuaWV0Zi5vcmcvaHRtbC9kcmFmdC1pZXRmLXJ0Y3dlYi1qc2VwLTIwI3NlY3Rpb24tNS4yLjFcbi8vIHJlY29tbWVuZHMgdXNpbmcgYSBjcnlwdG9ncmFwaGljYWxseSByYW5kb20gK3ZlIDY0LWJpdCB2YWx1ZVxuLy8gYnV0IHJpZ2h0IG5vdyB0aGlzIHNob3VsZCBiZSBhY2NlcHRhYmxlIGFuZCB3aXRoaW4gdGhlIHJpZ2h0IHJhbmdlXG5TRFBVdGlscy5nZW5lcmF0ZVNlc3Npb25JZCA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gTWF0aC5yYW5kb20oKS50b1N0cmluZygpLnN1YnN0cigyLCAyMSk7XG59O1xuXG4vLyBXcml0ZSBib2lsZGVyIHBsYXRlIGZvciBzdGFydCBvZiBTRFBcbi8vIHNlc3NJZCBhcmd1bWVudCBpcyBvcHRpb25hbCAtIGlmIG5vdCBzdXBwbGllZCBpdCB3aWxsXG4vLyBiZSBnZW5lcmF0ZWQgcmFuZG9tbHlcbi8vIHNlc3NWZXJzaW9uIGlzIG9wdGlvbmFsIGFuZCBkZWZhdWx0cyB0byAyXG5TRFBVdGlscy53cml0ZVNlc3Npb25Cb2lsZXJwbGF0ZSA9IGZ1bmN0aW9uKHNlc3NJZCwgc2Vzc1Zlcikge1xuICB2YXIgc2Vzc2lvbklkO1xuICB2YXIgdmVyc2lvbiA9IHNlc3NWZXIgIT09IHVuZGVmaW5lZCA/IHNlc3NWZXIgOiAyO1xuICBpZiAoc2Vzc0lkKSB7XG4gICAgc2Vzc2lvbklkID0gc2Vzc0lkO1xuICB9IGVsc2Uge1xuICAgIHNlc3Npb25JZCA9IFNEUFV0aWxzLmdlbmVyYXRlU2Vzc2lvbklkKCk7XG4gIH1cbiAgLy8gRklYTUU6IHNlc3MtaWQgc2hvdWxkIGJlIGFuIE5UUCB0aW1lc3RhbXAuXG4gIHJldHVybiAndj0wXFxyXFxuJyArXG4gICAgICAnbz10aGlzaXNhZGFwdGVyb3J0YyAnICsgc2Vzc2lvbklkICsgJyAnICsgdmVyc2lvbiArICcgSU4gSVA0IDEyNy4wLjAuMVxcclxcbicgK1xuICAgICAgJ3M9LVxcclxcbicgK1xuICAgICAgJ3Q9MCAwXFxyXFxuJztcbn07XG5cblNEUFV0aWxzLndyaXRlTWVkaWFTZWN0aW9uID0gZnVuY3Rpb24odHJhbnNjZWl2ZXIsIGNhcHMsIHR5cGUsIHN0cmVhbSkge1xuICB2YXIgc2RwID0gU0RQVXRpbHMud3JpdGVSdHBEZXNjcmlwdGlvbih0cmFuc2NlaXZlci5raW5kLCBjYXBzKTtcblxuICAvLyBNYXAgSUNFIHBhcmFtZXRlcnMgKHVmcmFnLCBwd2QpIHRvIFNEUC5cbiAgc2RwICs9IFNEUFV0aWxzLndyaXRlSWNlUGFyYW1ldGVycyhcbiAgICAgIHRyYW5zY2VpdmVyLmljZUdhdGhlcmVyLmdldExvY2FsUGFyYW1ldGVycygpKTtcblxuICAvLyBNYXAgRFRMUyBwYXJhbWV0ZXJzIHRvIFNEUC5cbiAgc2RwICs9IFNEUFV0aWxzLndyaXRlRHRsc1BhcmFtZXRlcnMoXG4gICAgICB0cmFuc2NlaXZlci5kdGxzVHJhbnNwb3J0LmdldExvY2FsUGFyYW1ldGVycygpLFxuICAgICAgdHlwZSA9PT0gJ29mZmVyJyA/ICdhY3RwYXNzJyA6ICdhY3RpdmUnKTtcblxuICBzZHAgKz0gJ2E9bWlkOicgKyB0cmFuc2NlaXZlci5taWQgKyAnXFxyXFxuJztcblxuICBpZiAodHJhbnNjZWl2ZXIuZGlyZWN0aW9uKSB7XG4gICAgc2RwICs9ICdhPScgKyB0cmFuc2NlaXZlci5kaXJlY3Rpb24gKyAnXFxyXFxuJztcbiAgfSBlbHNlIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIgJiYgdHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIpIHtcbiAgICBzZHAgKz0gJ2E9c2VuZHJlY3ZcXHJcXG4nO1xuICB9IGVsc2UgaWYgKHRyYW5zY2VpdmVyLnJ0cFNlbmRlcikge1xuICAgIHNkcCArPSAnYT1zZW5kb25seVxcclxcbic7XG4gIH0gZWxzZSBpZiAodHJhbnNjZWl2ZXIucnRwUmVjZWl2ZXIpIHtcbiAgICBzZHAgKz0gJ2E9cmVjdm9ubHlcXHJcXG4nO1xuICB9IGVsc2Uge1xuICAgIHNkcCArPSAnYT1pbmFjdGl2ZVxcclxcbic7XG4gIH1cblxuICBpZiAodHJhbnNjZWl2ZXIucnRwU2VuZGVyKSB7XG4gICAgLy8gc3BlYy5cbiAgICB2YXIgbXNpZCA9ICdtc2lkOicgKyBzdHJlYW0uaWQgKyAnICcgK1xuICAgICAgICB0cmFuc2NlaXZlci5ydHBTZW5kZXIudHJhY2suaWQgKyAnXFxyXFxuJztcbiAgICBzZHAgKz0gJ2E9JyArIG1zaWQ7XG5cbiAgICAvLyBmb3IgQ2hyb21lLlxuICAgIHNkcCArPSAnYT1zc3JjOicgKyB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnNzcmMgK1xuICAgICAgICAnICcgKyBtc2lkO1xuICAgIGlmICh0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eCkge1xuICAgICAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0ucnR4LnNzcmMgK1xuICAgICAgICAgICcgJyArIG1zaWQ7XG4gICAgICBzZHAgKz0gJ2E9c3NyYy1ncm91cDpGSUQgJyArXG4gICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5zc3JjICsgJyAnICtcbiAgICAgICAgICB0cmFuc2NlaXZlci5zZW5kRW5jb2RpbmdQYXJhbWV0ZXJzWzBdLnJ0eC5zc3JjICtcbiAgICAgICAgICAnXFxyXFxuJztcbiAgICB9XG4gIH1cbiAgLy8gRklYTUU6IHRoaXMgc2hvdWxkIGJlIHdyaXR0ZW4gYnkgd3JpdGVSdHBEZXNjcmlwdGlvbi5cbiAgc2RwICs9ICdhPXNzcmM6JyArIHRyYW5zY2VpdmVyLnNlbmRFbmNvZGluZ1BhcmFtZXRlcnNbMF0uc3NyYyArXG4gICAgICAnIGNuYW1lOicgKyBTRFBVdGlscy5sb2NhbENOYW1lICsgJ1xcclxcbic7XG4gIGlmICh0cmFuc2NlaXZlci5ydHBTZW5kZXIgJiYgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHgpIHtcbiAgICBzZHAgKz0gJ2E9c3NyYzonICsgdHJhbnNjZWl2ZXIuc2VuZEVuY29kaW5nUGFyYW1ldGVyc1swXS5ydHguc3NyYyArXG4gICAgICAgICcgY25hbWU6JyArIFNEUFV0aWxzLmxvY2FsQ05hbWUgKyAnXFxyXFxuJztcbiAgfVxuICByZXR1cm4gc2RwO1xufTtcblxuLy8gR2V0cyB0aGUgZGlyZWN0aW9uIGZyb20gdGhlIG1lZGlhU2VjdGlvbiBvciB0aGUgc2Vzc2lvbnBhcnQuXG5TRFBVdGlscy5nZXREaXJlY3Rpb24gPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24sIHNlc3Npb25wYXJ0KSB7XG4gIC8vIExvb2sgZm9yIHNlbmRyZWN2LCBzZW5kb25seSwgcmVjdm9ubHksIGluYWN0aXZlLCBkZWZhdWx0IHRvIHNlbmRyZWN2LlxuICB2YXIgbGluZXMgPSBTRFBVdGlscy5zcGxpdExpbmVzKG1lZGlhU2VjdGlvbik7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGluZXMubGVuZ3RoOyBpKyspIHtcbiAgICBzd2l0Y2ggKGxpbmVzW2ldKSB7XG4gICAgICBjYXNlICdhPXNlbmRyZWN2JzpcbiAgICAgIGNhc2UgJ2E9c2VuZG9ubHknOlxuICAgICAgY2FzZSAnYT1yZWN2b25seSc6XG4gICAgICBjYXNlICdhPWluYWN0aXZlJzpcbiAgICAgICAgcmV0dXJuIGxpbmVzW2ldLnN1YnN0cigyKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIC8vIEZJWE1FOiBXaGF0IHNob3VsZCBoYXBwZW4gaGVyZT9cbiAgICB9XG4gIH1cbiAgaWYgKHNlc3Npb25wYXJ0KSB7XG4gICAgcmV0dXJuIFNEUFV0aWxzLmdldERpcmVjdGlvbihzZXNzaW9ucGFydCk7XG4gIH1cbiAgcmV0dXJuICdzZW5kcmVjdic7XG59O1xuXG5TRFBVdGlscy5nZXRLaW5kID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgdmFyIG1saW5lID0gbGluZXNbMF0uc3BsaXQoJyAnKTtcbiAgcmV0dXJuIG1saW5lWzBdLnN1YnN0cigyKTtcbn07XG5cblNEUFV0aWxzLmlzUmVqZWN0ZWQgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgcmV0dXJuIG1lZGlhU2VjdGlvbi5zcGxpdCgnICcsIDIpWzFdID09PSAnMCc7XG59O1xuXG5TRFBVdGlscy5wYXJzZU1MaW5lID0gZnVuY3Rpb24obWVkaWFTZWN0aW9uKSB7XG4gIHZhciBsaW5lcyA9IFNEUFV0aWxzLnNwbGl0TGluZXMobWVkaWFTZWN0aW9uKTtcbiAgdmFyIHBhcnRzID0gbGluZXNbMF0uc3Vic3RyKDIpLnNwbGl0KCcgJyk7XG4gIHJldHVybiB7XG4gICAga2luZDogcGFydHNbMF0sXG4gICAgcG9ydDogcGFyc2VJbnQocGFydHNbMV0sIDEwKSxcbiAgICBwcm90b2NvbDogcGFydHNbMl0sXG4gICAgZm10OiBwYXJ0cy5zbGljZSgzKS5qb2luKCcgJylcbiAgfTtcbn07XG5cblNEUFV0aWxzLnBhcnNlT0xpbmUgPSBmdW5jdGlvbihtZWRpYVNlY3Rpb24pIHtcbiAgdmFyIGxpbmUgPSBTRFBVdGlscy5tYXRjaFByZWZpeChtZWRpYVNlY3Rpb24sICdvPScpWzBdO1xuICB2YXIgcGFydHMgPSBsaW5lLnN1YnN0cigyKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lOiBwYXJ0c1swXSxcbiAgICBzZXNzaW9uSWQ6IHBhcnRzWzFdLFxuICAgIHNlc3Npb25WZXJzaW9uOiBwYXJzZUludChwYXJ0c1syXSwgMTApLFxuICAgIG5ldFR5cGU6IHBhcnRzWzNdLFxuICAgIGFkZHJlc3NUeXBlOiBwYXJ0c1s0XSxcbiAgICBhZGRyZXNzOiBwYXJ0c1s1XSxcbiAgfTtcbn1cblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxuaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gU0RQVXRpbHM7XG59XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgYWRhcHRlckZhY3RvcnkgPSByZXF1aXJlKCcuL2FkYXB0ZXJfZmFjdG9yeS5qcycpO1xubW9kdWxlLmV4cG9ydHMgPSBhZGFwdGVyRmFjdG9yeSh7d2luZG93OiBnbG9iYWwud2luZG93fSk7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG4vLyBTaGltbWluZyBzdGFydHMgaGVyZS5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24oZGVwZW5kZW5jaWVzLCBvcHRzKSB7XG4gIHZhciB3aW5kb3cgPSBkZXBlbmRlbmNpZXMgJiYgZGVwZW5kZW5jaWVzLndpbmRvdztcblxuICB2YXIgb3B0aW9ucyA9IHtcbiAgICBzaGltQ2hyb21lOiB0cnVlLFxuICAgIHNoaW1GaXJlZm94OiB0cnVlLFxuICAgIHNoaW1FZGdlOiB0cnVlLFxuICAgIHNoaW1TYWZhcmk6IHRydWUsXG4gIH07XG5cbiAgZm9yICh2YXIga2V5IGluIG9wdHMpIHtcbiAgICBpZiAoaGFzT3duUHJvcGVydHkuY2FsbChvcHRzLCBrZXkpKSB7XG4gICAgICBvcHRpb25zW2tleV0gPSBvcHRzW2tleV07XG4gICAgfVxuICB9XG5cbiAgLy8gVXRpbHMuXG4gIHZhciBsb2dnaW5nID0gdXRpbHMubG9nO1xuICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG5cbiAgLy8gVW5jb21tZW50IHRoZSBsaW5lIGJlbG93IGlmIHlvdSB3YW50IGxvZ2dpbmcgdG8gb2NjdXIsIGluY2x1ZGluZyBsb2dnaW5nXG4gIC8vIGZvciB0aGUgc3dpdGNoIHN0YXRlbWVudCBiZWxvdy4gQ2FuIGFsc28gYmUgdHVybmVkIG9uIGluIHRoZSBicm93c2VyIHZpYVxuICAvLyBhZGFwdGVyLmRpc2FibGVMb2coZmFsc2UpLCBidXQgdGhlbiBsb2dnaW5nIGZyb20gdGhlIHN3aXRjaCBzdGF0ZW1lbnQgYmVsb3dcbiAgLy8gd2lsbCBub3QgYXBwZWFyLlxuICAvLyByZXF1aXJlKCcuL3V0aWxzJykuZGlzYWJsZUxvZyhmYWxzZSk7XG5cbiAgLy8gQnJvd3NlciBzaGltcy5cbiAgdmFyIGNocm9tZVNoaW0gPSByZXF1aXJlKCcuL2Nocm9tZS9jaHJvbWVfc2hpbScpIHx8IG51bGw7XG4gIHZhciBlZGdlU2hpbSA9IHJlcXVpcmUoJy4vZWRnZS9lZGdlX3NoaW0nKSB8fCBudWxsO1xuICB2YXIgZmlyZWZveFNoaW0gPSByZXF1aXJlKCcuL2ZpcmVmb3gvZmlyZWZveF9zaGltJykgfHwgbnVsbDtcbiAgdmFyIHNhZmFyaVNoaW0gPSByZXF1aXJlKCcuL3NhZmFyaS9zYWZhcmlfc2hpbScpIHx8IG51bGw7XG4gIHZhciBjb21tb25TaGltID0gcmVxdWlyZSgnLi9jb21tb25fc2hpbScpIHx8IG51bGw7XG5cbiAgLy8gRXhwb3J0IHRvIHRoZSBhZGFwdGVyIGdsb2JhbCBvYmplY3QgdmlzaWJsZSBpbiB0aGUgYnJvd3Nlci5cbiAgdmFyIGFkYXB0ZXIgPSB7XG4gICAgYnJvd3NlckRldGFpbHM6IGJyb3dzZXJEZXRhaWxzLFxuICAgIGNvbW1vblNoaW06IGNvbW1vblNoaW0sXG4gICAgZXh0cmFjdFZlcnNpb246IHV0aWxzLmV4dHJhY3RWZXJzaW9uLFxuICAgIGRpc2FibGVMb2c6IHV0aWxzLmRpc2FibGVMb2csXG4gICAgZGlzYWJsZVdhcm5pbmdzOiB1dGlscy5kaXNhYmxlV2FybmluZ3NcbiAgfTtcblxuICAvLyBTaGltIGJyb3dzZXIgaWYgZm91bmQuXG4gIHN3aXRjaCAoYnJvd3NlckRldGFpbHMuYnJvd3Nlcikge1xuICAgIGNhc2UgJ2Nocm9tZSc6XG4gICAgICBpZiAoIWNocm9tZVNoaW0gfHwgIWNocm9tZVNoaW0uc2hpbVBlZXJDb25uZWN0aW9uIHx8XG4gICAgICAgICAgIW9wdGlvbnMuc2hpbUNocm9tZSkge1xuICAgICAgICBsb2dnaW5nKCdDaHJvbWUgc2hpbSBpcyBub3QgaW5jbHVkZWQgaW4gdGhpcyBhZGFwdGVyIHJlbGVhc2UuJyk7XG4gICAgICAgIHJldHVybiBhZGFwdGVyO1xuICAgICAgfVxuICAgICAgbG9nZ2luZygnYWRhcHRlci5qcyBzaGltbWluZyBjaHJvbWUuJyk7XG4gICAgICAvLyBFeHBvcnQgdG8gdGhlIGFkYXB0ZXIgZ2xvYmFsIG9iamVjdCB2aXNpYmxlIGluIHRoZSBicm93c2VyLlxuICAgICAgYWRhcHRlci5icm93c2VyU2hpbSA9IGNocm9tZVNoaW07XG4gICAgICBjb21tb25TaGltLnNoaW1DcmVhdGVPYmplY3RVUkwod2luZG93KTtcblxuICAgICAgY2hyb21lU2hpbS5zaGltR2V0VXNlck1lZGlhKHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1NZWRpYVN0cmVhbSh3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltU291cmNlT2JqZWN0KHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1QZWVyQ29ubmVjdGlvbih3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltT25UcmFjayh3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltQWRkVHJhY2tSZW1vdmVUcmFjayh3aW5kb3cpO1xuICAgICAgY2hyb21lU2hpbS5zaGltR2V0U2VuZGVyc1dpdGhEdG1mKHdpbmRvdyk7XG4gICAgICBjaHJvbWVTaGltLnNoaW1TZW5kZXJSZWNlaXZlckdldFN0YXRzKHdpbmRvdyk7XG5cbiAgICAgIGNvbW1vblNoaW0uc2hpbVJUQ0ljZUNhbmRpZGF0ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltTWF4TWVzc2FnZVNpemUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbVNlbmRUaHJvd1R5cGVFcnJvcih3aW5kb3cpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZmlyZWZveCc6XG4gICAgICBpZiAoIWZpcmVmb3hTaGltIHx8ICFmaXJlZm94U2hpbS5zaGltUGVlckNvbm5lY3Rpb24gfHxcbiAgICAgICAgICAhb3B0aW9ucy5zaGltRmlyZWZveCkge1xuICAgICAgICBsb2dnaW5nKCdGaXJlZm94IHNoaW0gaXMgbm90IGluY2x1ZGVkIGluIHRoaXMgYWRhcHRlciByZWxlYXNlLicpO1xuICAgICAgICByZXR1cm4gYWRhcHRlcjtcbiAgICAgIH1cbiAgICAgIGxvZ2dpbmcoJ2FkYXB0ZXIuanMgc2hpbW1pbmcgZmlyZWZveC4nKTtcbiAgICAgIC8vIEV4cG9ydCB0byB0aGUgYWRhcHRlciBnbG9iYWwgb2JqZWN0IHZpc2libGUgaW4gdGhlIGJyb3dzZXIuXG4gICAgICBhZGFwdGVyLmJyb3dzZXJTaGltID0gZmlyZWZveFNoaW07XG4gICAgICBjb21tb25TaGltLnNoaW1DcmVhdGVPYmplY3RVUkwod2luZG93KTtcblxuICAgICAgZmlyZWZveFNoaW0uc2hpbUdldFVzZXJNZWRpYSh3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbVNvdXJjZU9iamVjdCh3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbVBlZXJDb25uZWN0aW9uKHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltT25UcmFjayh3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbVJlbW92ZVN0cmVhbSh3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbVNlbmRlckdldFN0YXRzKHdpbmRvdyk7XG4gICAgICBmaXJlZm94U2hpbS5zaGltUmVjZWl2ZXJHZXRTdGF0cyh3aW5kb3cpO1xuICAgICAgZmlyZWZveFNoaW0uc2hpbVJUQ0RhdGFDaGFubmVsKHdpbmRvdyk7XG5cbiAgICAgIGNvbW1vblNoaW0uc2hpbVJUQ0ljZUNhbmRpZGF0ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltTWF4TWVzc2FnZVNpemUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbVNlbmRUaHJvd1R5cGVFcnJvcih3aW5kb3cpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZWRnZSc6XG4gICAgICBpZiAoIWVkZ2VTaGltIHx8ICFlZGdlU2hpbS5zaGltUGVlckNvbm5lY3Rpb24gfHwgIW9wdGlvbnMuc2hpbUVkZ2UpIHtcbiAgICAgICAgbG9nZ2luZygnTVMgZWRnZSBzaGltIGlzIG5vdCBpbmNsdWRlZCBpbiB0aGlzIGFkYXB0ZXIgcmVsZWFzZS4nKTtcbiAgICAgICAgcmV0dXJuIGFkYXB0ZXI7XG4gICAgICB9XG4gICAgICBsb2dnaW5nKCdhZGFwdGVyLmpzIHNoaW1taW5nIGVkZ2UuJyk7XG4gICAgICAvLyBFeHBvcnQgdG8gdGhlIGFkYXB0ZXIgZ2xvYmFsIG9iamVjdCB2aXNpYmxlIGluIHRoZSBicm93c2VyLlxuICAgICAgYWRhcHRlci5icm93c2VyU2hpbSA9IGVkZ2VTaGltO1xuICAgICAgY29tbW9uU2hpbS5zaGltQ3JlYXRlT2JqZWN0VVJMKHdpbmRvdyk7XG5cbiAgICAgIGVkZ2VTaGltLnNoaW1HZXRVc2VyTWVkaWEod2luZG93KTtcbiAgICAgIGVkZ2VTaGltLnNoaW1QZWVyQ29ubmVjdGlvbih3aW5kb3cpO1xuICAgICAgZWRnZVNoaW0uc2hpbVJlcGxhY2VUcmFjayh3aW5kb3cpO1xuXG4gICAgICAvLyB0aGUgZWRnZSBzaGltIGltcGxlbWVudHMgdGhlIGZ1bGwgUlRDSWNlQ2FuZGlkYXRlIG9iamVjdC5cblxuICAgICAgY29tbW9uU2hpbS5zaGltTWF4TWVzc2FnZVNpemUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbVNlbmRUaHJvd1R5cGVFcnJvcih3aW5kb3cpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnc2FmYXJpJzpcbiAgICAgIGlmICghc2FmYXJpU2hpbSB8fCAhb3B0aW9ucy5zaGltU2FmYXJpKSB7XG4gICAgICAgIGxvZ2dpbmcoJ1NhZmFyaSBzaGltIGlzIG5vdCBpbmNsdWRlZCBpbiB0aGlzIGFkYXB0ZXIgcmVsZWFzZS4nKTtcbiAgICAgICAgcmV0dXJuIGFkYXB0ZXI7XG4gICAgICB9XG4gICAgICBsb2dnaW5nKCdhZGFwdGVyLmpzIHNoaW1taW5nIHNhZmFyaS4nKTtcbiAgICAgIC8vIEV4cG9ydCB0byB0aGUgYWRhcHRlciBnbG9iYWwgb2JqZWN0IHZpc2libGUgaW4gdGhlIGJyb3dzZXIuXG4gICAgICBhZGFwdGVyLmJyb3dzZXJTaGltID0gc2FmYXJpU2hpbTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbUNyZWF0ZU9iamVjdFVSTCh3aW5kb3cpO1xuXG4gICAgICBzYWZhcmlTaGltLnNoaW1SVENJY2VTZXJ2ZXJVcmxzKHdpbmRvdyk7XG4gICAgICBzYWZhcmlTaGltLnNoaW1DYWxsYmFja3NBUEkod2luZG93KTtcbiAgICAgIHNhZmFyaVNoaW0uc2hpbUxvY2FsU3RyZWFtc0FQSSh3aW5kb3cpO1xuICAgICAgc2FmYXJpU2hpbS5zaGltUmVtb3RlU3RyZWFtc0FQSSh3aW5kb3cpO1xuICAgICAgc2FmYXJpU2hpbS5zaGltVHJhY2tFdmVudFRyYW5zY2VpdmVyKHdpbmRvdyk7XG4gICAgICBzYWZhcmlTaGltLnNoaW1HZXRVc2VyTWVkaWEod2luZG93KTtcbiAgICAgIHNhZmFyaVNoaW0uc2hpbUNyZWF0ZU9mZmVyTGVnYWN5KHdpbmRvdyk7XG5cbiAgICAgIGNvbW1vblNoaW0uc2hpbVJUQ0ljZUNhbmRpZGF0ZSh3aW5kb3cpO1xuICAgICAgY29tbW9uU2hpbS5zaGltTWF4TWVzc2FnZVNpemUod2luZG93KTtcbiAgICAgIGNvbW1vblNoaW0uc2hpbVNlbmRUaHJvd1R5cGVFcnJvcih3aW5kb3cpO1xuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIGxvZ2dpbmcoJ1Vuc3VwcG9ydGVkIGJyb3dzZXIhJyk7XG4gICAgICBicmVhaztcbiAgfVxuXG4gIHJldHVybiBhZGFwdGVyO1xufTtcbiIsIlxuLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLi91dGlscy5qcycpO1xudmFyIGxvZ2dpbmcgPSB1dGlscy5sb2c7XG5cbi8qIGl0ZXJhdGVzIHRoZSBzdGF0cyBncmFwaCByZWN1cnNpdmVseS4gKi9cbmZ1bmN0aW9uIHdhbGtTdGF0cyhzdGF0cywgYmFzZSwgcmVzdWx0U2V0KSB7XG4gIGlmICghYmFzZSB8fCByZXN1bHRTZXQuaGFzKGJhc2UuaWQpKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJlc3VsdFNldC5zZXQoYmFzZS5pZCwgYmFzZSk7XG4gIE9iamVjdC5rZXlzKGJhc2UpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIGlmIChuYW1lLmVuZHNXaXRoKCdJZCcpKSB7XG4gICAgICB3YWxrU3RhdHMoc3RhdHMsIHN0YXRzLmdldChiYXNlW25hbWVdKSwgcmVzdWx0U2V0KTtcbiAgICB9IGVsc2UgaWYgKG5hbWUuZW5kc1dpdGgoJ0lkcycpKSB7XG4gICAgICBiYXNlW25hbWVdLmZvckVhY2goZnVuY3Rpb24oaWQpIHtcbiAgICAgICAgd2Fsa1N0YXRzKHN0YXRzLCBzdGF0cy5nZXQoaWQpLCByZXN1bHRTZXQpO1xuICAgICAgfSk7XG4gICAgfVxuICB9KTtcbn1cblxuLyogZmlsdGVyIGdldFN0YXRzIGZvciBhIHNlbmRlci9yZWNlaXZlciB0cmFjay4gKi9cbmZ1bmN0aW9uIGZpbHRlclN0YXRzKHJlc3VsdCwgdHJhY2ssIG91dGJvdW5kKSB7XG4gIHZhciBzdHJlYW1TdGF0c1R5cGUgPSBvdXRib3VuZCA/ICdvdXRib3VuZC1ydHAnIDogJ2luYm91bmQtcnRwJztcbiAgdmFyIGZpbHRlcmVkUmVzdWx0ID0gbmV3IE1hcCgpO1xuICBpZiAodHJhY2sgPT09IG51bGwpIHtcbiAgICByZXR1cm4gZmlsdGVyZWRSZXN1bHQ7XG4gIH1cbiAgdmFyIHRyYWNrU3RhdHMgPSBbXTtcbiAgcmVzdWx0LmZvckVhY2goZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodmFsdWUudHlwZSA9PT0gJ3RyYWNrJyAmJlxuICAgICAgICB2YWx1ZS50cmFja0lkZW50aWZpZXIgPT09IHRyYWNrLmlkKSB7XG4gICAgICB0cmFja1N0YXRzLnB1c2godmFsdWUpO1xuICAgIH1cbiAgfSk7XG4gIHRyYWNrU3RhdHMuZm9yRWFjaChmdW5jdGlvbih0cmFja1N0YXQpIHtcbiAgICByZXN1bHQuZm9yRWFjaChmdW5jdGlvbihzdGF0cykge1xuICAgICAgaWYgKHN0YXRzLnR5cGUgPT09IHN0cmVhbVN0YXRzVHlwZSAmJiBzdGF0cy50cmFja0lkID09PSB0cmFja1N0YXQuaWQpIHtcbiAgICAgICAgd2Fsa1N0YXRzKHJlc3VsdCwgc3RhdHMsIGZpbHRlcmVkUmVzdWx0KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiBmaWx0ZXJlZFJlc3VsdDtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNoaW1HZXRVc2VyTWVkaWE6IHJlcXVpcmUoJy4vZ2V0dXNlcm1lZGlhJyksXG4gIHNoaW1NZWRpYVN0cmVhbTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgd2luZG93Lk1lZGlhU3RyZWFtID0gd2luZG93Lk1lZGlhU3RyZWFtIHx8IHdpbmRvdy53ZWJraXRNZWRpYVN0cmVhbTtcbiAgfSxcblxuICBzaGltT25UcmFjazogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJiAhKCdvbnRyYWNrJyBpblxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdvbnRyYWNrJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9vbnRyYWNrO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKGYpIHtcbiAgICAgICAgICBpZiAodGhpcy5fb250cmFjaykge1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKCd0cmFjaycsIHRoaXMuX29udHJhY2spO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoJ3RyYWNrJywgdGhpcy5fb250cmFjayA9IGYpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHZhciBvcmlnU2V0UmVtb3RlRGVzY3JpcHRpb24gPVxuICAgICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb247XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldFJlbW90ZURlc2NyaXB0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIGlmICghcGMuX29udHJhY2twb2x5KSB7XG4gICAgICAgICAgcGMuX29udHJhY2twb2x5ID0gZnVuY3Rpb24oZSkge1xuICAgICAgICAgICAgLy8gb25hZGRzdHJlYW0gZG9lcyBub3QgZmlyZSB3aGVuIGEgdHJhY2sgaXMgYWRkZWQgdG8gYW4gZXhpc3RpbmdcbiAgICAgICAgICAgIC8vIHN0cmVhbS4gQnV0IHN0cmVhbS5vbmFkZHRyYWNrIGlzIGltcGxlbWVudGVkIHNvIHdlIHVzZSB0aGF0LlxuICAgICAgICAgICAgZS5zdHJlYW0uYWRkRXZlbnRMaXN0ZW5lcignYWRkdHJhY2snLCBmdW5jdGlvbih0ZSkge1xuICAgICAgICAgICAgICB2YXIgcmVjZWl2ZXI7XG4gICAgICAgICAgICAgIGlmICh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycykge1xuICAgICAgICAgICAgICAgIHJlY2VpdmVyID0gcGMuZ2V0UmVjZWl2ZXJzKCkuZmluZChmdW5jdGlvbihyKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4gci50cmFjayAmJiByLnRyYWNrLmlkID09PSB0ZS50cmFjay5pZDtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlciA9IHt0cmFjazogdGUudHJhY2t9O1xuICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCd0cmFjaycpO1xuICAgICAgICAgICAgICBldmVudC50cmFjayA9IHRlLnRyYWNrO1xuICAgICAgICAgICAgICBldmVudC5yZWNlaXZlciA9IHJlY2VpdmVyO1xuICAgICAgICAgICAgICBldmVudC50cmFuc2NlaXZlciA9IHtyZWNlaXZlcjogcmVjZWl2ZXJ9O1xuICAgICAgICAgICAgICBldmVudC5zdHJlYW1zID0gW2Uuc3RyZWFtXTtcbiAgICAgICAgICAgICAgcGMuZGlzcGF0Y2hFdmVudChldmVudCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGUuc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICAgICAgdmFyIHJlY2VpdmVyO1xuICAgICAgICAgICAgICBpZiAod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnMpIHtcbiAgICAgICAgICAgICAgICByZWNlaXZlciA9IHBjLmdldFJlY2VpdmVycygpLmZpbmQoZnVuY3Rpb24ocikge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHIudHJhY2sgJiYgci50cmFjay5pZCA9PT0gdHJhY2suaWQ7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmVjZWl2ZXIgPSB7dHJhY2s6IHRyYWNrfTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB2YXIgZXZlbnQgPSBuZXcgRXZlbnQoJ3RyYWNrJyk7XG4gICAgICAgICAgICAgIGV2ZW50LnRyYWNrID0gdHJhY2s7XG4gICAgICAgICAgICAgIGV2ZW50LnJlY2VpdmVyID0gcmVjZWl2ZXI7XG4gICAgICAgICAgICAgIGV2ZW50LnRyYW5zY2VpdmVyID0ge3JlY2VpdmVyOiByZWNlaXZlcn07XG4gICAgICAgICAgICAgIGV2ZW50LnN0cmVhbXMgPSBbZS5zdHJlYW1dO1xuICAgICAgICAgICAgICBwYy5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH07XG4gICAgICAgICAgcGMuYWRkRXZlbnRMaXN0ZW5lcignYWRkc3RyZWFtJywgcGMuX29udHJhY2twb2x5KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3JpZ1NldFJlbW90ZURlc2NyaXB0aW9uLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKCEoJ1JUQ1J0cFRyYW5zY2VpdmVyJyBpbiB3aW5kb3cpKSB7XG4gICAgICB1dGlscy53cmFwUGVlckNvbm5lY3Rpb25FdmVudCh3aW5kb3csICd0cmFjaycsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWYgKCFlLnRyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgZS50cmFuc2NlaXZlciA9IHtyZWNlaXZlcjogZS5yZWNlaXZlcn07XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGU7XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgc2hpbUdldFNlbmRlcnNXaXRoRHRtZjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gT3ZlcnJpZGVzIGFkZFRyYWNrL3JlbW92ZVRyYWNrLCBkZXBlbmRzIG9uIHNoaW1BZGRUcmFja1JlbW92ZVRyYWNrLlxuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgISgnZ2V0U2VuZGVycycgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkgJiZcbiAgICAgICAgJ2NyZWF0ZURUTUZTZW5kZXInIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpIHtcbiAgICAgIHZhciBzaGltU2VuZGVyV2l0aER0bWYgPSBmdW5jdGlvbihwYywgdHJhY2spIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICB0cmFjazogdHJhY2ssXG4gICAgICAgICAgZ2V0IGR0bWYoKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5fZHRtZiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIGlmICh0cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fZHRtZiA9IHBjLmNyZWF0ZURUTUZTZW5kZXIodHJhY2spO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuX2R0bWYgPSBudWxsO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZHRtZjtcbiAgICAgICAgICB9LFxuICAgICAgICAgIF9wYzogcGNcbiAgICAgICAgfTtcbiAgICAgIH07XG5cbiAgICAgIC8vIGF1Z21lbnQgYWRkVHJhY2sgd2hlbiBnZXRTZW5kZXJzIGlzIG5vdCBhdmFpbGFibGUuXG4gICAgICBpZiAoIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycykge1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLl9zZW5kZXJzID0gdGhpcy5fc2VuZGVycyB8fCBbXTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2VuZGVycy5zbGljZSgpOyAvLyByZXR1cm4gYSBjb3B5IG9mIHRoZSBpbnRlcm5hbCBzdGF0ZS5cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIG9yaWdBZGRUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2s7XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbih0cmFjaywgc3RyZWFtKSB7XG4gICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICB2YXIgc2VuZGVyID0gb3JpZ0FkZFRyYWNrLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgICAgICAgIGlmICghc2VuZGVyKSB7XG4gICAgICAgICAgICBzZW5kZXIgPSBzaGltU2VuZGVyV2l0aER0bWYocGMsIHRyYWNrKTtcbiAgICAgICAgICAgIHBjLl9zZW5kZXJzLnB1c2goc2VuZGVyKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHNlbmRlcjtcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgb3JpZ1JlbW92ZVRyYWNrID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVUcmFjaztcbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVUcmFjayA9IGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgb3JpZ1JlbW92ZVRyYWNrLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgICAgICAgIHZhciBpZHggPSBwYy5fc2VuZGVycy5pbmRleE9mKHNlbmRlcik7XG4gICAgICAgICAgaWYgKGlkeCAhPT0gLTEpIHtcbiAgICAgICAgICAgIHBjLl9zZW5kZXJzLnNwbGljZShpZHgsIDEpO1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHZhciBvcmlnQWRkU3RyZWFtID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRTdHJlYW07XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICBwYy5fc2VuZGVycyA9IHBjLl9zZW5kZXJzIHx8IFtdO1xuICAgICAgICBvcmlnQWRkU3RyZWFtLmFwcGx5KHBjLCBbc3RyZWFtXSk7XG4gICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgcGMuX3NlbmRlcnMucHVzaChzaGltU2VuZGVyV2l0aER0bWYocGMsIHRyYWNrKSk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcblxuICAgICAgdmFyIG9yaWdSZW1vdmVTdHJlYW0gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbTtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHBjLl9zZW5kZXJzID0gcGMuX3NlbmRlcnMgfHwgW107XG4gICAgICAgIG9yaWdSZW1vdmVTdHJlYW0uYXBwbHkocGMsIFtzdHJlYW1dKTtcblxuICAgICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgIHZhciBzZW5kZXIgPSBwYy5fc2VuZGVycy5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAoc2VuZGVyKSB7XG4gICAgICAgICAgICBwYy5fc2VuZGVycy5zcGxpY2UocGMuX3NlbmRlcnMuaW5kZXhPZihzZW5kZXIpLCAxKTsgLy8gcmVtb3ZlIHNlbmRlclxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgICAgICAgICAnZ2V0U2VuZGVycycgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSAmJlxuICAgICAgICAgICAgICAgJ2NyZWF0ZURUTUZTZW5kZXInIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgJiZcbiAgICAgICAgICAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIgJiZcbiAgICAgICAgICAgICAgICEoJ2R0bWYnIGluIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlKSkge1xuICAgICAgdmFyIG9yaWdHZXRTZW5kZXJzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHZhciBzZW5kZXJzID0gb3JpZ0dldFNlbmRlcnMuYXBwbHkocGMsIFtdKTtcbiAgICAgICAgc2VuZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgICAgIHNlbmRlci5fcGMgPSBwYztcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBzZW5kZXJzO1xuICAgICAgfTtcblxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlLCAnZHRtZicsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAodGhpcy5fZHRtZiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBpZiAodGhpcy50cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2R0bWYgPSB0aGlzLl9wYy5jcmVhdGVEVE1GU2VuZGVyKHRoaXMudHJhY2spO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgdGhpcy5fZHRtZiA9IG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB0aGlzLl9kdG1mO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG5cbiAgc2hpbVNlbmRlclJlY2VpdmVyR2V0U3RhdHM6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJlxuICAgICAgICB3aW5kb3cuUlRDUnRwU2VuZGVyICYmIHdpbmRvdy5SVENSdHBSZWNlaXZlcikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBzaGltIHNlbmRlciBzdGF0cy5cbiAgICBpZiAoISgnZ2V0U3RhdHMnIGluIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlKSkge1xuICAgICAgdmFyIG9yaWdHZXRTZW5kZXJzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTZW5kZXJzO1xuICAgICAgaWYgKG9yaWdHZXRTZW5kZXJzKSB7XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U2VuZGVycyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgICAgdmFyIHNlbmRlcnMgPSBvcmlnR2V0U2VuZGVycy5hcHBseShwYywgW10pO1xuICAgICAgICAgIHNlbmRlcnMuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgICAgICAgIHNlbmRlci5fcGMgPSBwYztcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gc2VuZGVycztcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgdmFyIG9yaWdBZGRUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2s7XG4gICAgICBpZiAob3JpZ0FkZFRyYWNrKSB7XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgc2VuZGVyID0gb3JpZ0FkZFRyYWNrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgc2VuZGVyLl9wYyA9IHRoaXM7XG4gICAgICAgICAgcmV0dXJuIHNlbmRlcjtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBzZW5kZXIgPSB0aGlzO1xuICAgICAgICByZXR1cm4gdGhpcy5fcGMuZ2V0U3RhdHMoKS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xuICAgICAgICAgIC8qIE5vdGU6IHRoaXMgd2lsbCBpbmNsdWRlIHN0YXRzIG9mIGFsbCBzZW5kZXJzIHRoYXRcbiAgICAgICAgICAgKiAgIHNlbmQgYSB0cmFjayB3aXRoIHRoZSBzYW1lIGlkIGFzIHNlbmRlci50cmFjayBhc1xuICAgICAgICAgICAqICAgaXQgaXMgbm90IHBvc3NpYmxlIHRvIGlkZW50aWZ5IHRoZSBSVENSdHBTZW5kZXIuXG4gICAgICAgICAgICovXG4gICAgICAgICAgcmV0dXJuIGZpbHRlclN0YXRzKHJlc3VsdCwgc2VuZGVyLnRyYWNrLCB0cnVlKTtcbiAgICAgICAgfSk7XG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIHNoaW0gcmVjZWl2ZXIgc3RhdHMuXG4gICAgaWYgKCEoJ2dldFN0YXRzJyBpbiB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIucHJvdG90eXBlKSkge1xuICAgICAgdmFyIG9yaWdHZXRSZWNlaXZlcnMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFJlY2VpdmVycztcbiAgICAgIGlmIChvcmlnR2V0UmVjZWl2ZXJzKSB7XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICB2YXIgcmVjZWl2ZXJzID0gb3JpZ0dldFJlY2VpdmVycy5hcHBseShwYywgW10pO1xuICAgICAgICAgIHJlY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHJlY2VpdmVyKSB7XG4gICAgICAgICAgICByZWNlaXZlci5fcGMgPSBwYztcbiAgICAgICAgICB9KTtcbiAgICAgICAgICByZXR1cm4gcmVjZWl2ZXJzO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgICAgdXRpbHMud3JhcFBlZXJDb25uZWN0aW9uRXZlbnQod2luZG93LCAndHJhY2snLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIGUucmVjZWl2ZXIuX3BjID0gZS5zcmNFbGVtZW50O1xuICAgICAgICByZXR1cm4gZTtcbiAgICAgIH0pO1xuICAgICAgd2luZG93LlJUQ1J0cFJlY2VpdmVyLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgcmVjZWl2ZXIgPSB0aGlzO1xuICAgICAgICByZXR1cm4gdGhpcy5fcGMuZ2V0U3RhdHMoKS50aGVuKGZ1bmN0aW9uKHJlc3VsdCkge1xuICAgICAgICAgIHJldHVybiBmaWx0ZXJTdGF0cyhyZXN1bHQsIHJlY2VpdmVyLnRyYWNrLCBmYWxzZSk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9XG5cbiAgICBpZiAoISgnZ2V0U3RhdHMnIGluIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlICYmXG4gICAgICAgICdnZXRTdGF0cycgaW4gd2luZG93LlJUQ1J0cFJlY2VpdmVyLnByb3RvdHlwZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBzaGltIFJUQ1BlZXJDb25uZWN0aW9uLmdldFN0YXRzKHRyYWNrKS5cbiAgICB2YXIgb3JpZ0dldFN0YXRzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cztcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAwICYmXG4gICAgICAgICAgYXJndW1lbnRzWzBdIGluc3RhbmNlb2Ygd2luZG93Lk1lZGlhU3RyZWFtVHJhY2spIHtcbiAgICAgICAgdmFyIHRyYWNrID0gYXJndW1lbnRzWzBdO1xuICAgICAgICB2YXIgc2VuZGVyO1xuICAgICAgICB2YXIgcmVjZWl2ZXI7XG4gICAgICAgIHZhciBlcnI7XG4gICAgICAgIHBjLmdldFNlbmRlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgICBpZiAocy50cmFjayA9PT0gdHJhY2spIHtcbiAgICAgICAgICAgIGlmIChzZW5kZXIpIHtcbiAgICAgICAgICAgICAgZXJyID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHNlbmRlciA9IHM7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcGMuZ2V0UmVjZWl2ZXJzKCkuZm9yRWFjaChmdW5jdGlvbihyKSB7XG4gICAgICAgICAgaWYgKHIudHJhY2sgPT09IHRyYWNrKSB7XG4gICAgICAgICAgICBpZiAocmVjZWl2ZXIpIHtcbiAgICAgICAgICAgICAgZXJyID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJlY2VpdmVyID0gcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHIudHJhY2sgPT09IHRyYWNrO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGVyciB8fCAoc2VuZGVyICYmIHJlY2VpdmVyKSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRE9NRXhjZXB0aW9uKFxuICAgICAgICAgICAgJ1RoZXJlIGFyZSBtb3JlIHRoYW4gb25lIHNlbmRlciBvciByZWNlaXZlciBmb3IgdGhlIHRyYWNrLicsXG4gICAgICAgICAgICAnSW52YWxpZEFjY2Vzc0Vycm9yJykpO1xuICAgICAgICB9IGVsc2UgaWYgKHNlbmRlcikge1xuICAgICAgICAgIHJldHVybiBzZW5kZXIuZ2V0U3RhdHMoKTtcbiAgICAgICAgfSBlbHNlIGlmIChyZWNlaXZlcikge1xuICAgICAgICAgIHJldHVybiByZWNlaXZlci5nZXRTdGF0cygpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgRE9NRXhjZXB0aW9uKFxuICAgICAgICAgICdUaGVyZSBpcyBubyBzZW5kZXIgb3IgcmVjZWl2ZXIgZm9yIHRoZSB0cmFjay4nLFxuICAgICAgICAgICdJbnZhbGlkQWNjZXNzRXJyb3InKSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gb3JpZ0dldFN0YXRzLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbVNvdXJjZU9iamVjdDogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIFVSTCA9IHdpbmRvdyAmJiB3aW5kb3cuVVJMO1xuXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAod2luZG93LkhUTUxNZWRpYUVsZW1lbnQgJiZcbiAgICAgICAgISgnc3JjT2JqZWN0JyBpbiB3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUpKSB7XG4gICAgICAgIC8vIFNoaW0gdGhlIHNyY09iamVjdCBwcm9wZXJ0eSwgb25jZSwgd2hlbiBIVE1MTWVkaWFFbGVtZW50IGlzIGZvdW5kLlxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLCAnc3JjT2JqZWN0Jywge1xuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fc3JjT2JqZWN0O1xuICAgICAgICAgIH0sXG4gICAgICAgICAgc2V0OiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgIHZhciBzZWxmID0gdGhpcztcbiAgICAgICAgICAgIC8vIFVzZSBfc3JjT2JqZWN0IGFzIGEgcHJpdmF0ZSBwcm9wZXJ0eSBmb3IgdGhpcyBzaGltXG4gICAgICAgICAgICB0aGlzLl9zcmNPYmplY3QgPSBzdHJlYW07XG4gICAgICAgICAgICBpZiAodGhpcy5zcmMpIHtcbiAgICAgICAgICAgICAgVVJMLnJldm9rZU9iamVjdFVSTCh0aGlzLnNyYyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGlmICghc3RyZWFtKSB7XG4gICAgICAgICAgICAgIHRoaXMuc3JjID0gJyc7XG4gICAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnNyYyA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc3RyZWFtKTtcbiAgICAgICAgICAgIC8vIFdlIG5lZWQgdG8gcmVjcmVhdGUgdGhlIGJsb2IgdXJsIHdoZW4gYSB0cmFjayBpcyBhZGRlZCBvclxuICAgICAgICAgICAgLy8gcmVtb3ZlZC4gRG9pbmcgaXQgbWFudWFsbHkgc2luY2Ugd2Ugd2FudCB0byBhdm9pZCBhIHJlY3Vyc2lvbi5cbiAgICAgICAgICAgIHN0cmVhbS5hZGRFdmVudExpc3RlbmVyKCdhZGR0cmFjaycsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICBpZiAoc2VsZi5zcmMpIHtcbiAgICAgICAgICAgICAgICBVUkwucmV2b2tlT2JqZWN0VVJMKHNlbGYuc3JjKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBzZWxmLnNyYyA9IFVSTC5jcmVhdGVPYmplY3RVUkwoc3RyZWFtKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgc3RyZWFtLmFkZEV2ZW50TGlzdGVuZXIoJ3JlbW92ZXRyYWNrJywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgIGlmIChzZWxmLnNyYykge1xuICAgICAgICAgICAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwoc2VsZi5zcmMpO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHNlbGYuc3JjID0gVVJMLmNyZWF0ZU9iamVjdFVSTChzdHJlYW0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgc2hpbUFkZFRyYWNrUmVtb3ZlVHJhY2tXaXRoTmF0aXZlOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBzaGltIGFkZFRyYWNrL3JlbW92ZVRyYWNrIHdpdGggbmF0aXZlIHZhcmlhbnRzIGluIG9yZGVyIHRvIG1ha2VcbiAgICAvLyB0aGUgaW50ZXJhY3Rpb25zIHdpdGggbGVnYWN5IGdldExvY2FsU3RyZWFtcyBiZWhhdmUgYXMgaW4gb3RoZXIgYnJvd3NlcnMuXG4gICAgLy8gS2VlcHMgYSBtYXBwaW5nIHN0cmVhbS5pZCA9PiBbc3RyZWFtLCBydHBzZW5kZXJzLi4uXVxuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0TG9jYWxTdHJlYW1zID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyA9IHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgfHwge307XG4gICAgICByZXR1cm4gT2JqZWN0LmtleXModGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcykubWFwKGZ1bmN0aW9uKHN0cmVhbUlkKSB7XG4gICAgICAgIHJldHVybiBwYy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW1JZF1bMF07XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdBZGRUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2s7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKHRyYWNrLCBzdHJlYW0pIHtcbiAgICAgIGlmICghc3RyZWFtKSB7XG4gICAgICAgIHJldHVybiBvcmlnQWRkVHJhY2suYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgPSB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zIHx8IHt9O1xuXG4gICAgICB2YXIgc2VuZGVyID0gb3JpZ0FkZFRyYWNrLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICBpZiAoIXRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtLmlkXSkge1xuICAgICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbS5pZF0gPSBbc3RyZWFtLCBzZW5kZXJdO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbS5pZF0uaW5kZXhPZihzZW5kZXIpID09PSAtMSkge1xuICAgICAgICB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbS5pZF0ucHVzaChzZW5kZXIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNlbmRlcjtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdBZGRTdHJlYW0gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgPSB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zIHx8IHt9O1xuXG4gICAgICBzdHJlYW0uZ2V0VHJhY2tzKCkuZm9yRWFjaChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICB2YXIgYWxyZWFkeUV4aXN0cyA9IHBjLmdldFNlbmRlcnMoKS5maW5kKGZ1bmN0aW9uKHMpIHtcbiAgICAgICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAoYWxyZWFkeUV4aXN0cykge1xuICAgICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oJ1RyYWNrIGFscmVhZHkgZXhpc3RzLicsXG4gICAgICAgICAgICAgICdJbnZhbGlkQWNjZXNzRXJyb3InKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB2YXIgZXhpc3RpbmdTZW5kZXJzID0gcGMuZ2V0U2VuZGVycygpO1xuICAgICAgb3JpZ0FkZFN0cmVhbS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgdmFyIG5ld1NlbmRlcnMgPSBwYy5nZXRTZW5kZXJzKCkuZmlsdGVyKGZ1bmN0aW9uKG5ld1NlbmRlcikge1xuICAgICAgICByZXR1cm4gZXhpc3RpbmdTZW5kZXJzLmluZGV4T2YobmV3U2VuZGVyKSA9PT0gLTE7XG4gICAgICB9KTtcbiAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXNbc3RyZWFtLmlkXSA9IFtzdHJlYW1dLmNvbmNhdChuZXdTZW5kZXJzKTtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdSZW1vdmVTdHJlYW0gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtcyA9IHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgfHwge307XG4gICAgICBkZWxldGUgdGhpcy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW0uaWRdO1xuICAgICAgcmV0dXJuIG9yaWdSZW1vdmVTdHJlYW0uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdSZW1vdmVUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUucmVtb3ZlVHJhY2s7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVUcmFjayA9IGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHRoaXMuX3NoaW1tZWRMb2NhbFN0cmVhbXMgPSB0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zIHx8IHt9O1xuICAgICAgaWYgKHNlbmRlcikge1xuICAgICAgICBPYmplY3Qua2V5cyh0aGlzLl9zaGltbWVkTG9jYWxTdHJlYW1zKS5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbUlkKSB7XG4gICAgICAgICAgdmFyIGlkeCA9IHBjLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbUlkXS5pbmRleE9mKHNlbmRlcik7XG4gICAgICAgICAgaWYgKGlkeCAhPT0gLTEpIHtcbiAgICAgICAgICAgIHBjLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbUlkXS5zcGxpY2UoaWR4LCAxKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHBjLl9zaGltbWVkTG9jYWxTdHJlYW1zW3N0cmVhbUlkXS5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBwYy5fc2hpbW1lZExvY2FsU3RyZWFtc1tzdHJlYW1JZF07XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvcmlnUmVtb3ZlVHJhY2suYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1BZGRUcmFja1JlbW92ZVRyYWNrOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG4gICAgLy8gc2hpbSBhZGRUcmFjayBhbmQgcmVtb3ZlVHJhY2suXG4gICAgaWYgKHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgJiZcbiAgICAgICAgYnJvd3NlckRldGFpbHMudmVyc2lvbiA+PSA2NSkge1xuICAgICAgcmV0dXJuIHRoaXMuc2hpbUFkZFRyYWNrUmVtb3ZlVHJhY2tXaXRoTmF0aXZlKHdpbmRvdyk7XG4gICAgfVxuXG4gICAgLy8gYWxzbyBzaGltIHBjLmdldExvY2FsU3RyZWFtcyB3aGVuIGFkZFRyYWNrIGlzIHNoaW1tZWRcbiAgICAvLyB0byByZXR1cm4gdGhlIG9yaWdpbmFsIHN0cmVhbXMuXG4gICAgdmFyIG9yaWdHZXRMb2NhbFN0cmVhbXMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlXG4gICAgICAgIC5nZXRMb2NhbFN0cmVhbXM7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRMb2NhbFN0cmVhbXMgPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB2YXIgbmF0aXZlU3RyZWFtcyA9IG9yaWdHZXRMb2NhbFN0cmVhbXMuYXBwbHkodGhpcyk7XG4gICAgICBwYy5fcmV2ZXJzZVN0cmVhbXMgPSBwYy5fcmV2ZXJzZVN0cmVhbXMgfHwge307XG4gICAgICByZXR1cm4gbmF0aXZlU3RyZWFtcy5tYXAoZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgIHJldHVybiBwYy5fcmV2ZXJzZVN0cmVhbXNbc3RyZWFtLmlkXTtcbiAgICAgIH0pO1xuICAgIH07XG5cbiAgICB2YXIgb3JpZ0FkZFN0cmVhbSA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkU3RyZWFtID0gZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgcGMuX3N0cmVhbXMgPSBwYy5fc3RyZWFtcyB8fCB7fTtcbiAgICAgIHBjLl9yZXZlcnNlU3RyZWFtcyA9IHBjLl9yZXZlcnNlU3RyZWFtcyB8fCB7fTtcblxuICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgdmFyIGFscmVhZHlFeGlzdHMgPSBwYy5nZXRTZW5kZXJzKCkuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICAgICAgcmV0dXJuIHMudHJhY2sgPT09IHRyYWNrO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGFscmVhZHlFeGlzdHMpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCdUcmFjayBhbHJlYWR5IGV4aXN0cy4nLFxuICAgICAgICAgICAgICAnSW52YWxpZEFjY2Vzc0Vycm9yJyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gQWRkIGlkZW50aXR5IG1hcHBpbmcgZm9yIGNvbnNpc3RlbmN5IHdpdGggYWRkVHJhY2suXG4gICAgICAvLyBVbmxlc3MgdGhpcyBpcyBiZWluZyB1c2VkIHdpdGggYSBzdHJlYW0gZnJvbSBhZGRUcmFjay5cbiAgICAgIGlmICghcGMuX3JldmVyc2VTdHJlYW1zW3N0cmVhbS5pZF0pIHtcbiAgICAgICAgdmFyIG5ld1N0cmVhbSA9IG5ldyB3aW5kb3cuTWVkaWFTdHJlYW0oc3RyZWFtLmdldFRyYWNrcygpKTtcbiAgICAgICAgcGMuX3N0cmVhbXNbc3RyZWFtLmlkXSA9IG5ld1N0cmVhbTtcbiAgICAgICAgcGMuX3JldmVyc2VTdHJlYW1zW25ld1N0cmVhbS5pZF0gPSBzdHJlYW07XG4gICAgICAgIHN0cmVhbSA9IG5ld1N0cmVhbTtcbiAgICAgIH1cbiAgICAgIG9yaWdBZGRTdHJlYW0uYXBwbHkocGMsIFtzdHJlYW1dKTtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdSZW1vdmVTdHJlYW0gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnJlbW92ZVN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHBjLl9zdHJlYW1zID0gcGMuX3N0cmVhbXMgfHwge307XG4gICAgICBwYy5fcmV2ZXJzZVN0cmVhbXMgPSBwYy5fcmV2ZXJzZVN0cmVhbXMgfHwge307XG5cbiAgICAgIG9yaWdSZW1vdmVTdHJlYW0uYXBwbHkocGMsIFsocGMuX3N0cmVhbXNbc3RyZWFtLmlkXSB8fCBzdHJlYW0pXSk7XG4gICAgICBkZWxldGUgcGMuX3JldmVyc2VTdHJlYW1zWyhwYy5fc3RyZWFtc1tzdHJlYW0uaWRdID9cbiAgICAgICAgICBwYy5fc3RyZWFtc1tzdHJlYW0uaWRdLmlkIDogc3RyZWFtLmlkKV07XG4gICAgICBkZWxldGUgcGMuX3N0cmVhbXNbc3RyZWFtLmlkXTtcbiAgICB9O1xuXG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKHRyYWNrLCBzdHJlYW0pIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBpZiAocGMuc2lnbmFsaW5nU3RhdGUgPT09ICdjbG9zZWQnKSB7XG4gICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oXG4gICAgICAgICAgJ1RoZSBSVENQZWVyQ29ubmVjdGlvblxcJ3Mgc2lnbmFsaW5nU3RhdGUgaXMgXFwnY2xvc2VkXFwnLicsXG4gICAgICAgICAgJ0ludmFsaWRTdGF0ZUVycm9yJyk7XG4gICAgICB9XG4gICAgICB2YXIgc3RyZWFtcyA9IFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICAgIGlmIChzdHJlYW1zLmxlbmd0aCAhPT0gMSB8fFxuICAgICAgICAgICFzdHJlYW1zWzBdLmdldFRyYWNrcygpLmZpbmQoZnVuY3Rpb24odCkge1xuICAgICAgICAgICAgcmV0dXJuIHQgPT09IHRyYWNrO1xuICAgICAgICAgIH0pKSB7XG4gICAgICAgIC8vIHRoaXMgaXMgbm90IGZ1bGx5IGNvcnJlY3QgYnV0IGFsbCB3ZSBjYW4gbWFuYWdlIHdpdGhvdXRcbiAgICAgICAgLy8gW1thc3NvY2lhdGVkIE1lZGlhU3RyZWFtc11dIGludGVybmFsIHNsb3QuXG4gICAgICAgIHRocm93IG5ldyBET01FeGNlcHRpb24oXG4gICAgICAgICAgJ1RoZSBhZGFwdGVyLmpzIGFkZFRyYWNrIHBvbHlmaWxsIG9ubHkgc3VwcG9ydHMgYSBzaW5nbGUgJyArXG4gICAgICAgICAgJyBzdHJlYW0gd2hpY2ggaXMgYXNzb2NpYXRlZCB3aXRoIHRoZSBzcGVjaWZpZWQgdHJhY2suJyxcbiAgICAgICAgICAnTm90U3VwcG9ydGVkRXJyb3InKTtcbiAgICAgIH1cblxuICAgICAgdmFyIGFscmVhZHlFeGlzdHMgPSBwYy5nZXRTZW5kZXJzKCkuZmluZChmdW5jdGlvbihzKSB7XG4gICAgICAgIHJldHVybiBzLnRyYWNrID09PSB0cmFjaztcbiAgICAgIH0pO1xuICAgICAgaWYgKGFscmVhZHlFeGlzdHMpIHtcbiAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignVHJhY2sgYWxyZWFkeSBleGlzdHMuJyxcbiAgICAgICAgICAgICdJbnZhbGlkQWNjZXNzRXJyb3InKTtcbiAgICAgIH1cblxuICAgICAgcGMuX3N0cmVhbXMgPSBwYy5fc3RyZWFtcyB8fCB7fTtcbiAgICAgIHBjLl9yZXZlcnNlU3RyZWFtcyA9IHBjLl9yZXZlcnNlU3RyZWFtcyB8fCB7fTtcbiAgICAgIHZhciBvbGRTdHJlYW0gPSBwYy5fc3RyZWFtc1tzdHJlYW0uaWRdO1xuICAgICAgaWYgKG9sZFN0cmVhbSkge1xuICAgICAgICAvLyB0aGlzIGlzIHVzaW5nIG9kZCBDaHJvbWUgYmVoYXZpb3VyLCB1c2Ugd2l0aCBjYXV0aW9uOlxuICAgICAgICAvLyBodHRwczovL2J1Z3MuY2hyb21pdW0ub3JnL3Avd2VicnRjL2lzc3Vlcy9kZXRhaWw/aWQ9NzgxNVxuICAgICAgICAvLyBOb3RlOiB3ZSByZWx5IG9uIHRoZSBoaWdoLWxldmVsIGFkZFRyYWNrL2R0bWYgc2hpbSB0b1xuICAgICAgICAvLyBjcmVhdGUgdGhlIHNlbmRlciB3aXRoIGEgZHRtZiBzZW5kZXIuXG4gICAgICAgIG9sZFN0cmVhbS5hZGRUcmFjayh0cmFjayk7XG5cbiAgICAgICAgLy8gVHJpZ2dlciBPTk4gYXN5bmMuXG4gICAgICAgIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcGMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ25lZ290aWF0aW9ubmVlZGVkJykpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBuZXdTdHJlYW0gPSBuZXcgd2luZG93Lk1lZGlhU3RyZWFtKFt0cmFja10pO1xuICAgICAgICBwYy5fc3RyZWFtc1tzdHJlYW0uaWRdID0gbmV3U3RyZWFtO1xuICAgICAgICBwYy5fcmV2ZXJzZVN0cmVhbXNbbmV3U3RyZWFtLmlkXSA9IHN0cmVhbTtcbiAgICAgICAgcGMuYWRkU3RyZWFtKG5ld1N0cmVhbSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcGMuZ2V0U2VuZGVycygpLmZpbmQoZnVuY3Rpb24ocykge1xuICAgICAgICByZXR1cm4gcy50cmFjayA9PT0gdHJhY2s7XG4gICAgICB9KTtcbiAgICB9O1xuXG4gICAgLy8gcmVwbGFjZSB0aGUgaW50ZXJuYWwgc3RyZWFtIGlkIHdpdGggdGhlIGV4dGVybmFsIG9uZSBhbmRcbiAgICAvLyB2aWNlIHZlcnNhLlxuICAgIGZ1bmN0aW9uIHJlcGxhY2VJbnRlcm5hbFN0cmVhbUlkKHBjLCBkZXNjcmlwdGlvbikge1xuICAgICAgdmFyIHNkcCA9IGRlc2NyaXB0aW9uLnNkcDtcbiAgICAgIE9iamVjdC5rZXlzKHBjLl9yZXZlcnNlU3RyZWFtcyB8fCBbXSkuZm9yRWFjaChmdW5jdGlvbihpbnRlcm5hbElkKSB7XG4gICAgICAgIHZhciBleHRlcm5hbFN0cmVhbSA9IHBjLl9yZXZlcnNlU3RyZWFtc1tpbnRlcm5hbElkXTtcbiAgICAgICAgdmFyIGludGVybmFsU3RyZWFtID0gcGMuX3N0cmVhbXNbZXh0ZXJuYWxTdHJlYW0uaWRdO1xuICAgICAgICBzZHAgPSBzZHAucmVwbGFjZShuZXcgUmVnRXhwKGludGVybmFsU3RyZWFtLmlkLCAnZycpLFxuICAgICAgICAgICAgZXh0ZXJuYWxTdHJlYW0uaWQpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gbmV3IFJUQ1Nlc3Npb25EZXNjcmlwdGlvbih7XG4gICAgICAgIHR5cGU6IGRlc2NyaXB0aW9uLnR5cGUsXG4gICAgICAgIHNkcDogc2RwXG4gICAgICB9KTtcbiAgICB9XG4gICAgZnVuY3Rpb24gcmVwbGFjZUV4dGVybmFsU3RyZWFtSWQocGMsIGRlc2NyaXB0aW9uKSB7XG4gICAgICB2YXIgc2RwID0gZGVzY3JpcHRpb24uc2RwO1xuICAgICAgT2JqZWN0LmtleXMocGMuX3JldmVyc2VTdHJlYW1zIHx8IFtdKS5mb3JFYWNoKGZ1bmN0aW9uKGludGVybmFsSWQpIHtcbiAgICAgICAgdmFyIGV4dGVybmFsU3RyZWFtID0gcGMuX3JldmVyc2VTdHJlYW1zW2ludGVybmFsSWRdO1xuICAgICAgICB2YXIgaW50ZXJuYWxTdHJlYW0gPSBwYy5fc3RyZWFtc1tleHRlcm5hbFN0cmVhbS5pZF07XG4gICAgICAgIHNkcCA9IHNkcC5yZXBsYWNlKG5ldyBSZWdFeHAoZXh0ZXJuYWxTdHJlYW0uaWQsICdnJyksXG4gICAgICAgICAgICBpbnRlcm5hbFN0cmVhbS5pZCk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBuZXcgUlRDU2Vzc2lvbkRlc2NyaXB0aW9uKHtcbiAgICAgICAgdHlwZTogZGVzY3JpcHRpb24udHlwZSxcbiAgICAgICAgc2RwOiBzZHBcbiAgICAgIH0pO1xuICAgIH1cbiAgICBbJ2NyZWF0ZU9mZmVyJywgJ2NyZWF0ZUFuc3dlciddLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICB2YXIgbmF0aXZlTWV0aG9kID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgICB2YXIgaXNMZWdhY3lDYWxsID0gYXJndW1lbnRzLmxlbmd0aCAmJlxuICAgICAgICAgICAgdHlwZW9mIGFyZ3VtZW50c1swXSA9PT0gJ2Z1bmN0aW9uJztcbiAgICAgICAgaWYgKGlzTGVnYWN5Q2FsbCkge1xuICAgICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkocGMsIFtcbiAgICAgICAgICAgIGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgICAgICAgICAgIHZhciBkZXNjID0gcmVwbGFjZUludGVybmFsU3RyZWFtSWQocGMsIGRlc2NyaXB0aW9uKTtcbiAgICAgICAgICAgICAgYXJnc1swXS5hcHBseShudWxsLCBbZGVzY10pO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGZ1bmN0aW9uKGVycikge1xuICAgICAgICAgICAgICBpZiAoYXJnc1sxXSkge1xuICAgICAgICAgICAgICAgIGFyZ3NbMV0uYXBwbHkobnVsbCwgZXJyKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgYXJndW1lbnRzWzJdXG4gICAgICAgICAgXSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseShwYywgYXJndW1lbnRzKVxuICAgICAgICAudGhlbihmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgICAgICAgIHJldHVybiByZXBsYWNlSW50ZXJuYWxTdHJlYW1JZChwYywgZGVzY3JpcHRpb24pO1xuICAgICAgICB9KTtcbiAgICAgIH07XG4gICAgfSk7XG5cbiAgICB2YXIgb3JpZ1NldExvY2FsRGVzY3JpcHRpb24gPVxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLnNldExvY2FsRGVzY3JpcHRpb247XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRMb2NhbERlc2NyaXB0aW9uID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoIHx8ICFhcmd1bWVudHNbMF0udHlwZSkge1xuICAgICAgICByZXR1cm4gb3JpZ1NldExvY2FsRGVzY3JpcHRpb24uYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgICB9XG4gICAgICBhcmd1bWVudHNbMF0gPSByZXBsYWNlRXh0ZXJuYWxTdHJlYW1JZChwYywgYXJndW1lbnRzWzBdKTtcbiAgICAgIHJldHVybiBvcmlnU2V0TG9jYWxEZXNjcmlwdGlvbi5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICB9O1xuXG4gICAgLy8gVE9ETzogbWFuZ2xlIGdldFN0YXRzOiBodHRwczovL3czYy5naXRodWIuaW8vd2VicnRjLXN0YXRzLyNkb20tcnRjbWVkaWFzdHJlYW1zdGF0cy1zdHJlYW1pZGVudGlmaWVyXG5cbiAgICB2YXIgb3JpZ0xvY2FsRGVzY3JpcHRpb24gPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKFxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAnbG9jYWxEZXNjcmlwdGlvbicpO1xuICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLFxuICAgICAgICAnbG9jYWxEZXNjcmlwdGlvbicsIHtcbiAgICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgICAgIHZhciBkZXNjcmlwdGlvbiA9IG9yaWdMb2NhbERlc2NyaXB0aW9uLmdldC5hcHBseSh0aGlzKTtcbiAgICAgICAgICAgIGlmIChkZXNjcmlwdGlvbi50eXBlID09PSAnJykge1xuICAgICAgICAgICAgICByZXR1cm4gZGVzY3JpcHRpb247XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcmVwbGFjZUludGVybmFsU3RyZWFtSWQocGMsIGRlc2NyaXB0aW9uKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVUcmFjayA9IGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIGlmIChwYy5zaWduYWxpbmdTdGF0ZSA9PT0gJ2Nsb3NlZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbihcbiAgICAgICAgICAnVGhlIFJUQ1BlZXJDb25uZWN0aW9uXFwncyBzaWduYWxpbmdTdGF0ZSBpcyBcXCdjbG9zZWRcXCcuJyxcbiAgICAgICAgICAnSW52YWxpZFN0YXRlRXJyb3InKTtcbiAgICAgIH1cbiAgICAgIC8vIFdlIGNhbiBub3QgeWV0IGNoZWNrIGZvciBzZW5kZXIgaW5zdGFuY2VvZiBSVENSdHBTZW5kZXJcbiAgICAgIC8vIHNpbmNlIHdlIHNoaW0gUlRQU2VuZGVyLiBTbyB3ZSBjaGVjayBpZiBzZW5kZXIuX3BjIGlzIHNldC5cbiAgICAgIGlmICghc2VuZGVyLl9wYykge1xuICAgICAgICB0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKCdBcmd1bWVudCAxIG9mIFJUQ1BlZXJDb25uZWN0aW9uLnJlbW92ZVRyYWNrICcgK1xuICAgICAgICAgICAgJ2RvZXMgbm90IGltcGxlbWVudCBpbnRlcmZhY2UgUlRDUnRwU2VuZGVyLicsICdUeXBlRXJyb3InKTtcbiAgICAgIH1cbiAgICAgIHZhciBpc0xvY2FsID0gc2VuZGVyLl9wYyA9PT0gcGM7XG4gICAgICBpZiAoIWlzTG9jYWwpIHtcbiAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignU2VuZGVyIHdhcyBub3QgY3JlYXRlZCBieSB0aGlzIGNvbm5lY3Rpb24uJyxcbiAgICAgICAgICAgICdJbnZhbGlkQWNjZXNzRXJyb3InKTtcbiAgICAgIH1cblxuICAgICAgLy8gU2VhcmNoIGZvciB0aGUgbmF0aXZlIHN0cmVhbSB0aGUgc2VuZGVycyB0cmFjayBiZWxvbmdzIHRvLlxuICAgICAgcGMuX3N0cmVhbXMgPSBwYy5fc3RyZWFtcyB8fCB7fTtcbiAgICAgIHZhciBzdHJlYW07XG4gICAgICBPYmplY3Qua2V5cyhwYy5fc3RyZWFtcykuZm9yRWFjaChmdW5jdGlvbihzdHJlYW1pZCkge1xuICAgICAgICB2YXIgaGFzVHJhY2sgPSBwYy5fc3RyZWFtc1tzdHJlYW1pZF0uZ2V0VHJhY2tzKCkuZmluZChmdW5jdGlvbih0cmFjaykge1xuICAgICAgICAgIHJldHVybiBzZW5kZXIudHJhY2sgPT09IHRyYWNrO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGhhc1RyYWNrKSB7XG4gICAgICAgICAgc3RyZWFtID0gcGMuX3N0cmVhbXNbc3RyZWFtaWRdO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgaWYgKHN0cmVhbSkge1xuICAgICAgICBpZiAoc3RyZWFtLmdldFRyYWNrcygpLmxlbmd0aCA9PT0gMSkge1xuICAgICAgICAgIC8vIGlmIHRoaXMgaXMgdGhlIGxhc3QgdHJhY2sgb2YgdGhlIHN0cmVhbSwgcmVtb3ZlIHRoZSBzdHJlYW0uIFRoaXNcbiAgICAgICAgICAvLyB0YWtlcyBjYXJlIG9mIGFueSBzaGltbWVkIF9zZW5kZXJzLlxuICAgICAgICAgIHBjLnJlbW92ZVN0cmVhbShwYy5fcmV2ZXJzZVN0cmVhbXNbc3RyZWFtLmlkXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gcmVseWluZyBvbiB0aGUgc2FtZSBvZGQgY2hyb21lIGJlaGF2aW91ciBhcyBhYm92ZS5cbiAgICAgICAgICBzdHJlYW0ucmVtb3ZlVHJhY2soc2VuZGVyLnRyYWNrKTtcbiAgICAgICAgfVxuICAgICAgICBwYy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgnbmVnb3RpYXRpb25uZWVkZWQnKSk7XG4gICAgICB9XG4gICAgfTtcbiAgfSxcblxuICBzaGltUGVlckNvbm5lY3Rpb246IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBicm93c2VyRGV0YWlscyA9IHV0aWxzLmRldGVjdEJyb3dzZXIod2luZG93KTtcblxuICAgIC8vIFRoZSBSVENQZWVyQ29ubmVjdGlvbiBvYmplY3QuXG4gICAgaWYgKCF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiYgd2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gPSBmdW5jdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cykge1xuICAgICAgICAvLyBUcmFuc2xhdGUgaWNlVHJhbnNwb3J0UG9saWN5IHRvIGljZVRyYW5zcG9ydHMsXG4gICAgICAgIC8vIHNlZSBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL3dlYnJ0Yy9pc3N1ZXMvZGV0YWlsP2lkPTQ4NjlcbiAgICAgICAgLy8gdGhpcyB3YXMgZml4ZWQgaW4gTTU2IGFsb25nIHdpdGggdW5wcmVmaXhpbmcgUlRDUGVlckNvbm5lY3Rpb24uXG4gICAgICAgIGxvZ2dpbmcoJ1BlZXJDb25uZWN0aW9uJyk7XG4gICAgICAgIGlmIChwY0NvbmZpZyAmJiBwY0NvbmZpZy5pY2VUcmFuc3BvcnRQb2xpY3kpIHtcbiAgICAgICAgICBwY0NvbmZpZy5pY2VUcmFuc3BvcnRzID0gcGNDb25maWcuaWNlVHJhbnNwb3J0UG9saWN5O1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5ldyB3aW5kb3cud2Via2l0UlRDUGVlckNvbm5lY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpO1xuICAgICAgfTtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgPVxuICAgICAgICAgIHdpbmRvdy53ZWJraXRSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGU7XG4gICAgICAvLyB3cmFwIHN0YXRpYyBtZXRob2RzLiBDdXJyZW50bHkganVzdCBnZW5lcmF0ZUNlcnRpZmljYXRlLlxuICAgICAgaWYgKHdpbmRvdy53ZWJraXRSVENQZWVyQ29ubmVjdGlvbi5nZW5lcmF0ZUNlcnRpZmljYXRlKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24sICdnZW5lcmF0ZUNlcnRpZmljYXRlJywge1xuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gd2luZG93LndlYmtpdFJUQ1BlZXJDb25uZWN0aW9uLmdlbmVyYXRlQ2VydGlmaWNhdGU7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gbWlncmF0ZSBmcm9tIG5vbi1zcGVjIFJUQ0ljZVNlcnZlci51cmwgdG8gUlRDSWNlU2VydmVyLnVybHNcbiAgICAgIHZhciBPcmlnUGVlckNvbm5lY3Rpb24gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb247XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gPSBmdW5jdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cykge1xuICAgICAgICBpZiAocGNDb25maWcgJiYgcGNDb25maWcuaWNlU2VydmVycykge1xuICAgICAgICAgIHZhciBuZXdJY2VTZXJ2ZXJzID0gW107XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwY0NvbmZpZy5pY2VTZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB2YXIgc2VydmVyID0gcGNDb25maWcuaWNlU2VydmVyc1tpXTtcbiAgICAgICAgICAgIGlmICghc2VydmVyLmhhc093blByb3BlcnR5KCd1cmxzJykgJiZcbiAgICAgICAgICAgICAgICBzZXJ2ZXIuaGFzT3duUHJvcGVydHkoJ3VybCcpKSB7XG4gICAgICAgICAgICAgIHV0aWxzLmRlcHJlY2F0ZWQoJ1JUQ0ljZVNlcnZlci51cmwnLCAnUlRDSWNlU2VydmVyLnVybHMnKTtcbiAgICAgICAgICAgICAgc2VydmVyID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzZXJ2ZXIpKTtcbiAgICAgICAgICAgICAgc2VydmVyLnVybHMgPSBzZXJ2ZXIudXJsO1xuICAgICAgICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2goc2VydmVyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChwY0NvbmZpZy5pY2VTZXJ2ZXJzW2ldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcGNDb25maWcuaWNlU2VydmVycyA9IG5ld0ljZVNlcnZlcnM7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBPcmlnUGVlckNvbm5lY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpO1xuICAgICAgfTtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgPSBPcmlnUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlO1xuICAgICAgLy8gd3JhcCBzdGF0aWMgbWV0aG9kcy4gQ3VycmVudGx5IGp1c3QgZ2VuZXJhdGVDZXJ0aWZpY2F0ZS5cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24sICdnZW5lcmF0ZUNlcnRpZmljYXRlJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBPcmlnUGVlckNvbm5lY3Rpb24uZ2VuZXJhdGVDZXJ0aWZpY2F0ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdmFyIG9yaWdHZXRTdGF0cyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHM7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKHNlbGVjdG9yLFxuICAgICAgICBzdWNjZXNzQ2FsbGJhY2ssIGVycm9yQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB2YXIgYXJncyA9IGFyZ3VtZW50cztcblxuICAgICAgLy8gSWYgc2VsZWN0b3IgaXMgYSBmdW5jdGlvbiB0aGVuIHdlIGFyZSBpbiB0aGUgb2xkIHN0eWxlIHN0YXRzIHNvIGp1c3RcbiAgICAgIC8vIHBhc3MgYmFjayB0aGUgb3JpZ2luYWwgZ2V0U3RhdHMgZm9ybWF0IHRvIGF2b2lkIGJyZWFraW5nIG9sZCB1c2Vycy5cbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMCAmJiB0eXBlb2Ygc2VsZWN0b3IgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIG9yaWdHZXRTdGF0cy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgfVxuXG4gICAgICAvLyBXaGVuIHNwZWMtc3R5bGUgZ2V0U3RhdHMgaXMgc3VwcG9ydGVkLCByZXR1cm4gdGhvc2Ugd2hlbiBjYWxsZWQgd2l0aFxuICAgICAgLy8gZWl0aGVyIG5vIGFyZ3VtZW50cyBvciB0aGUgc2VsZWN0b3IgYXJndW1lbnQgaXMgbnVsbC5cbiAgICAgIGlmIChvcmlnR2V0U3RhdHMubGVuZ3RoID09PSAwICYmIChhcmd1bWVudHMubGVuZ3RoID09PSAwIHx8XG4gICAgICAgICAgdHlwZW9mIGFyZ3VtZW50c1swXSAhPT0gJ2Z1bmN0aW9uJykpIHtcbiAgICAgICAgcmV0dXJuIG9yaWdHZXRTdGF0cy5hcHBseSh0aGlzLCBbXSk7XG4gICAgICB9XG5cbiAgICAgIHZhciBmaXhDaHJvbWVTdGF0c18gPSBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgICB2YXIgc3RhbmRhcmRSZXBvcnQgPSB7fTtcbiAgICAgICAgdmFyIHJlcG9ydHMgPSByZXNwb25zZS5yZXN1bHQoKTtcbiAgICAgICAgcmVwb3J0cy5mb3JFYWNoKGZ1bmN0aW9uKHJlcG9ydCkge1xuICAgICAgICAgIHZhciBzdGFuZGFyZFN0YXRzID0ge1xuICAgICAgICAgICAgaWQ6IHJlcG9ydC5pZCxcbiAgICAgICAgICAgIHRpbWVzdGFtcDogcmVwb3J0LnRpbWVzdGFtcCxcbiAgICAgICAgICAgIHR5cGU6IHtcbiAgICAgICAgICAgICAgbG9jYWxjYW5kaWRhdGU6ICdsb2NhbC1jYW5kaWRhdGUnLFxuICAgICAgICAgICAgICByZW1vdGVjYW5kaWRhdGU6ICdyZW1vdGUtY2FuZGlkYXRlJ1xuICAgICAgICAgICAgfVtyZXBvcnQudHlwZV0gfHwgcmVwb3J0LnR5cGVcbiAgICAgICAgICB9O1xuICAgICAgICAgIHJlcG9ydC5uYW1lcygpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgICAgICAgICAgc3RhbmRhcmRTdGF0c1tuYW1lXSA9IHJlcG9ydC5zdGF0KG5hbWUpO1xuICAgICAgICAgIH0pO1xuICAgICAgICAgIHN0YW5kYXJkUmVwb3J0W3N0YW5kYXJkU3RhdHMuaWRdID0gc3RhbmRhcmRTdGF0cztcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIHN0YW5kYXJkUmVwb3J0O1xuICAgICAgfTtcblxuICAgICAgLy8gc2hpbSBnZXRTdGF0cyB3aXRoIG1hcGxpa2Ugc3VwcG9ydFxuICAgICAgdmFyIG1ha2VNYXBTdGF0cyA9IGZ1bmN0aW9uKHN0YXRzKSB7XG4gICAgICAgIHJldHVybiBuZXcgTWFwKE9iamVjdC5rZXlzKHN0YXRzKS5tYXAoZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgICAgcmV0dXJuIFtrZXksIHN0YXRzW2tleV1dO1xuICAgICAgICB9KSk7XG4gICAgICB9O1xuXG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+PSAyKSB7XG4gICAgICAgIHZhciBzdWNjZXNzQ2FsbGJhY2tXcmFwcGVyXyA9IGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgICAgYXJnc1sxXShtYWtlTWFwU3RhdHMoZml4Q2hyb21lU3RhdHNfKHJlc3BvbnNlKSkpO1xuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBvcmlnR2V0U3RhdHMuYXBwbHkodGhpcywgW3N1Y2Nlc3NDYWxsYmFja1dyYXBwZXJfLFxuICAgICAgICAgIGFyZ3VtZW50c1swXV0pO1xuICAgICAgfVxuXG4gICAgICAvLyBwcm9taXNlLXN1cHBvcnRcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgb3JpZ0dldFN0YXRzLmFwcGx5KHBjLCBbXG4gICAgICAgICAgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHJlc29sdmUobWFrZU1hcFN0YXRzKGZpeENocm9tZVN0YXRzXyhyZXNwb25zZSkpKTtcbiAgICAgICAgICB9LCByZWplY3RdKTtcbiAgICAgIH0pLnRoZW4oc3VjY2Vzc0NhbGxiYWNrLCBlcnJvckNhbGxiYWNrKTtcbiAgICB9O1xuXG4gICAgLy8gYWRkIHByb21pc2Ugc3VwcG9ydCAtLSBuYXRpdmVseSBhdmFpbGFibGUgaW4gQ2hyb21lIDUxXG4gICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA1MSkge1xuICAgICAgWydzZXRMb2NhbERlc2NyaXB0aW9uJywgJ3NldFJlbW90ZURlc2NyaXB0aW9uJywgJ2FkZEljZUNhbmRpZGF0ZSddXG4gICAgICAgICAgLmZvckVhY2goZnVuY3Rpb24obWV0aG9kKSB7XG4gICAgICAgICAgICB2YXIgbmF0aXZlTWV0aG9kID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgICAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgIHZhciBhcmdzID0gYXJndW1lbnRzO1xuICAgICAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgICAgICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgICAgICAgICAgIG5hdGl2ZU1ldGhvZC5hcHBseShwYywgW2FyZ3NbMF0sIHJlc29sdmUsIHJlamVjdF0pO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgaWYgKGFyZ3MubGVuZ3RoIDwgMikge1xuICAgICAgICAgICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgYXJnc1sxXS5hcHBseShudWxsLCBbXSk7XG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGZ1bmN0aW9uKGVycikge1xuICAgICAgICAgICAgICAgIGlmIChhcmdzLmxlbmd0aCA+PSAzKSB7XG4gICAgICAgICAgICAgICAgICBhcmdzWzJdLmFwcGx5KG51bGwsIFtlcnJdKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBwcm9taXNlIHN1cHBvcnQgZm9yIGNyZWF0ZU9mZmVyIGFuZCBjcmVhdGVBbnN3ZXIuIEF2YWlsYWJsZSAod2l0aG91dFxuICAgIC8vIGJ1Z3MpIHNpbmNlIE01MjogY3JidWcvNjE5Mjg5XG4gICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCA1Mikge1xuICAgICAgWydjcmVhdGVPZmZlcicsICdjcmVhdGVBbnN3ZXInXS5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgICB2YXIgbmF0aXZlTWV0aG9kID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoIDwgMSB8fCAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMSAmJlxuICAgICAgICAgICAgICB0eXBlb2YgYXJndW1lbnRzWzBdID09PSAnb2JqZWN0JykpIHtcbiAgICAgICAgICAgIHZhciBvcHRzID0gYXJndW1lbnRzLmxlbmd0aCA9PT0gMSA/IGFyZ3VtZW50c1swXSA6IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgICAgICAgbmF0aXZlTWV0aG9kLmFwcGx5KHBjLCBbcmVzb2x2ZSwgcmVqZWN0LCBvcHRzXSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG5hdGl2ZU1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9O1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gc2hpbSBpbXBsaWNpdCBjcmVhdGlvbiBvZiBSVENTZXNzaW9uRGVzY3JpcHRpb24vUlRDSWNlQ2FuZGlkYXRlXG4gICAgWydzZXRMb2NhbERlc2NyaXB0aW9uJywgJ3NldFJlbW90ZURlc2NyaXB0aW9uJywgJ2FkZEljZUNhbmRpZGF0ZSddXG4gICAgICAgIC5mb3JFYWNoKGZ1bmN0aW9uKG1ldGhvZCkge1xuICAgICAgICAgIHZhciBuYXRpdmVNZXRob2QgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlW21ldGhvZF07XG4gICAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBhcmd1bWVudHNbMF0gPSBuZXcgKChtZXRob2QgPT09ICdhZGRJY2VDYW5kaWRhdGUnKSA/XG4gICAgICAgICAgICAgICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSA6XG4gICAgICAgICAgICAgICAgd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbikoYXJndW1lbnRzWzBdKTtcbiAgICAgICAgICAgIHJldHVybiBuYXRpdmVNZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICB9O1xuICAgICAgICB9KTtcblxuICAgIC8vIHN1cHBvcnQgZm9yIGFkZEljZUNhbmRpZGF0ZShudWxsIG9yIHVuZGVmaW5lZClcbiAgICB2YXIgbmF0aXZlQWRkSWNlQ2FuZGlkYXRlID1cbiAgICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGU7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGUgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghYXJndW1lbnRzWzBdKSB7XG4gICAgICAgIGlmIChhcmd1bWVudHNbMV0pIHtcbiAgICAgICAgICBhcmd1bWVudHNbMV0uYXBwbHkobnVsbCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZUFkZEljZUNhbmRpZGF0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbiAvKiBlc2xpbnQtZW52IG5vZGUgKi9cbid1c2Ugc3RyaWN0JztcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzLmpzJyk7XG52YXIgbG9nZ2luZyA9IHV0aWxzLmxvZztcblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih3aW5kb3cpIHtcbiAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuICB2YXIgbmF2aWdhdG9yID0gd2luZG93ICYmIHdpbmRvdy5uYXZpZ2F0b3I7XG5cbiAgdmFyIGNvbnN0cmFpbnRzVG9DaHJvbWVfID0gZnVuY3Rpb24oYykge1xuICAgIGlmICh0eXBlb2YgYyAhPT0gJ29iamVjdCcgfHwgYy5tYW5kYXRvcnkgfHwgYy5vcHRpb25hbCkge1xuICAgICAgcmV0dXJuIGM7XG4gICAgfVxuICAgIHZhciBjYyA9IHt9O1xuICAgIE9iamVjdC5rZXlzKGMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVxdWlyZScgfHwga2V5ID09PSAnYWR2YW5jZWQnIHx8IGtleSA9PT0gJ21lZGlhU291cmNlJykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgciA9ICh0eXBlb2YgY1trZXldID09PSAnb2JqZWN0JykgPyBjW2tleV0gOiB7aWRlYWw6IGNba2V5XX07XG4gICAgICBpZiAoci5leGFjdCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByLmV4YWN0ID09PSAnbnVtYmVyJykge1xuICAgICAgICByLm1pbiA9IHIubWF4ID0gci5leGFjdDtcbiAgICAgIH1cbiAgICAgIHZhciBvbGRuYW1lXyA9IGZ1bmN0aW9uKHByZWZpeCwgbmFtZSkge1xuICAgICAgICBpZiAocHJlZml4KSB7XG4gICAgICAgICAgcmV0dXJuIHByZWZpeCArIG5hbWUuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBuYW1lLnNsaWNlKDEpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAobmFtZSA9PT0gJ2RldmljZUlkJykgPyAnc291cmNlSWQnIDogbmFtZTtcbiAgICAgIH07XG4gICAgICBpZiAoci5pZGVhbCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNjLm9wdGlvbmFsID0gY2Mub3B0aW9uYWwgfHwgW107XG4gICAgICAgIHZhciBvYyA9IHt9O1xuICAgICAgICBpZiAodHlwZW9mIHIuaWRlYWwgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgb2Nbb2xkbmFtZV8oJ21pbicsIGtleSldID0gci5pZGVhbDtcbiAgICAgICAgICBjYy5vcHRpb25hbC5wdXNoKG9jKTtcbiAgICAgICAgICBvYyA9IHt9O1xuICAgICAgICAgIG9jW29sZG5hbWVfKCdtYXgnLCBrZXkpXSA9IHIuaWRlYWw7XG4gICAgICAgICAgY2Mub3B0aW9uYWwucHVzaChvYyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgb2Nbb2xkbmFtZV8oJycsIGtleSldID0gci5pZGVhbDtcbiAgICAgICAgICBjYy5vcHRpb25hbC5wdXNoKG9jKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHIuZXhhY3QgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygci5leGFjdCAhPT0gJ251bWJlcicpIHtcbiAgICAgICAgY2MubWFuZGF0b3J5ID0gY2MubWFuZGF0b3J5IHx8IHt9O1xuICAgICAgICBjYy5tYW5kYXRvcnlbb2xkbmFtZV8oJycsIGtleSldID0gci5leGFjdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIFsnbWluJywgJ21heCddLmZvckVhY2goZnVuY3Rpb24obWl4KSB7XG4gICAgICAgICAgaWYgKHJbbWl4XSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjYy5tYW5kYXRvcnkgPSBjYy5tYW5kYXRvcnkgfHwge307XG4gICAgICAgICAgICBjYy5tYW5kYXRvcnlbb2xkbmFtZV8obWl4LCBrZXkpXSA9IHJbbWl4XTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGlmIChjLmFkdmFuY2VkKSB7XG4gICAgICBjYy5vcHRpb25hbCA9IChjYy5vcHRpb25hbCB8fCBbXSkuY29uY2F0KGMuYWR2YW5jZWQpO1xuICAgIH1cbiAgICByZXR1cm4gY2M7XG4gIH07XG5cbiAgdmFyIHNoaW1Db25zdHJhaW50c18gPSBmdW5jdGlvbihjb25zdHJhaW50cywgZnVuYykge1xuICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uID49IDYxKSB7XG4gICAgICByZXR1cm4gZnVuYyhjb25zdHJhaW50cyk7XG4gICAgfVxuICAgIGNvbnN0cmFpbnRzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgIGlmIChjb25zdHJhaW50cyAmJiB0eXBlb2YgY29uc3RyYWludHMuYXVkaW8gPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgcmVtYXAgPSBmdW5jdGlvbihvYmosIGEsIGIpIHtcbiAgICAgICAgaWYgKGEgaW4gb2JqICYmICEoYiBpbiBvYmopKSB7XG4gICAgICAgICAgb2JqW2JdID0gb2JqW2FdO1xuICAgICAgICAgIGRlbGV0ZSBvYmpbYV07XG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjb25zdHJhaW50cyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICAgIHJlbWFwKGNvbnN0cmFpbnRzLmF1ZGlvLCAnYXV0b0dhaW5Db250cm9sJywgJ2dvb2dBdXRvR2FpbkNvbnRyb2wnKTtcbiAgICAgIHJlbWFwKGNvbnN0cmFpbnRzLmF1ZGlvLCAnbm9pc2VTdXBwcmVzc2lvbicsICdnb29nTm9pc2VTdXBwcmVzc2lvbicpO1xuICAgICAgY29uc3RyYWludHMuYXVkaW8gPSBjb25zdHJhaW50c1RvQ2hyb21lXyhjb25zdHJhaW50cy5hdWRpbyk7XG4gICAgfVxuICAgIGlmIChjb25zdHJhaW50cyAmJiB0eXBlb2YgY29uc3RyYWludHMudmlkZW8gPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBTaGltIGZhY2luZ01vZGUgZm9yIG1vYmlsZSAmIHN1cmZhY2UgcHJvLlxuICAgICAgdmFyIGZhY2UgPSBjb25zdHJhaW50cy52aWRlby5mYWNpbmdNb2RlO1xuICAgICAgZmFjZSA9IGZhY2UgJiYgKCh0eXBlb2YgZmFjZSA9PT0gJ29iamVjdCcpID8gZmFjZSA6IHtpZGVhbDogZmFjZX0pO1xuICAgICAgdmFyIGdldFN1cHBvcnRlZEZhY2luZ01vZGVMaWVzID0gYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDY2O1xuXG4gICAgICBpZiAoKGZhY2UgJiYgKGZhY2UuZXhhY3QgPT09ICd1c2VyJyB8fCBmYWNlLmV4YWN0ID09PSAnZW52aXJvbm1lbnQnIHx8XG4gICAgICAgICAgICAgICAgICAgIGZhY2UuaWRlYWwgPT09ICd1c2VyJyB8fCBmYWNlLmlkZWFsID09PSAnZW52aXJvbm1lbnQnKSkgJiZcbiAgICAgICAgICAhKG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0U3VwcG9ydGVkQ29uc3RyYWludHMgJiZcbiAgICAgICAgICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0U3VwcG9ydGVkQ29uc3RyYWludHMoKS5mYWNpbmdNb2RlICYmXG4gICAgICAgICAgICAhZ2V0U3VwcG9ydGVkRmFjaW5nTW9kZUxpZXMpKSB7XG4gICAgICAgIGRlbGV0ZSBjb25zdHJhaW50cy52aWRlby5mYWNpbmdNb2RlO1xuICAgICAgICB2YXIgbWF0Y2hlcztcbiAgICAgICAgaWYgKGZhY2UuZXhhY3QgPT09ICdlbnZpcm9ubWVudCcgfHwgZmFjZS5pZGVhbCA9PT0gJ2Vudmlyb25tZW50Jykge1xuICAgICAgICAgIG1hdGNoZXMgPSBbJ2JhY2snLCAncmVhciddO1xuICAgICAgICB9IGVsc2UgaWYgKGZhY2UuZXhhY3QgPT09ICd1c2VyJyB8fCBmYWNlLmlkZWFsID09PSAndXNlcicpIHtcbiAgICAgICAgICBtYXRjaGVzID0gWydmcm9udCddO1xuICAgICAgICB9XG4gICAgICAgIGlmIChtYXRjaGVzKSB7XG4gICAgICAgICAgLy8gTG9vayBmb3IgbWF0Y2hlcyBpbiBsYWJlbCwgb3IgdXNlIGxhc3QgY2FtIGZvciBiYWNrICh0eXBpY2FsKS5cbiAgICAgICAgICByZXR1cm4gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5lbnVtZXJhdGVEZXZpY2VzKClcbiAgICAgICAgICAudGhlbihmdW5jdGlvbihkZXZpY2VzKSB7XG4gICAgICAgICAgICBkZXZpY2VzID0gZGV2aWNlcy5maWx0ZXIoZnVuY3Rpb24oZCkge1xuICAgICAgICAgICAgICByZXR1cm4gZC5raW5kID09PSAndmlkZW9pbnB1dCc7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHZhciBkZXYgPSBkZXZpY2VzLmZpbmQoZnVuY3Rpb24oZCkge1xuICAgICAgICAgICAgICByZXR1cm4gbWF0Y2hlcy5zb21lKGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGQubGFiZWwudG9Mb3dlckNhc2UoKS5pbmRleE9mKG1hdGNoKSAhPT0gLTE7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBpZiAoIWRldiAmJiBkZXZpY2VzLmxlbmd0aCAmJiBtYXRjaGVzLmluZGV4T2YoJ2JhY2snKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgZGV2ID0gZGV2aWNlc1tkZXZpY2VzLmxlbmd0aCAtIDFdOyAvLyBtb3JlIGxpa2VseSB0aGUgYmFjayBjYW1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChkZXYpIHtcbiAgICAgICAgICAgICAgY29uc3RyYWludHMudmlkZW8uZGV2aWNlSWQgPSBmYWNlLmV4YWN0ID8ge2V4YWN0OiBkZXYuZGV2aWNlSWR9IDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAge2lkZWFsOiBkZXYuZGV2aWNlSWR9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3RyYWludHMudmlkZW8gPSBjb25zdHJhaW50c1RvQ2hyb21lXyhjb25zdHJhaW50cy52aWRlbyk7XG4gICAgICAgICAgICBsb2dnaW5nKCdjaHJvbWU6ICcgKyBKU09OLnN0cmluZ2lmeShjb25zdHJhaW50cykpO1xuICAgICAgICAgICAgcmV0dXJuIGZ1bmMoY29uc3RyYWludHMpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdHJhaW50cy52aWRlbyA9IGNvbnN0cmFpbnRzVG9DaHJvbWVfKGNvbnN0cmFpbnRzLnZpZGVvKTtcbiAgICB9XG4gICAgbG9nZ2luZygnY2hyb21lOiAnICsgSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICByZXR1cm4gZnVuYyhjb25zdHJhaW50cyk7XG4gIH07XG5cbiAgdmFyIHNoaW1FcnJvcl8gPSBmdW5jdGlvbihlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG5hbWU6IHtcbiAgICAgICAgUGVybWlzc2lvbkRlbmllZEVycm9yOiAnTm90QWxsb3dlZEVycm9yJyxcbiAgICAgICAgUGVybWlzc2lvbkRpc21pc3NlZEVycm9yOiAnTm90QWxsb3dlZEVycm9yJyxcbiAgICAgICAgSW52YWxpZFN0YXRlRXJyb3I6ICdOb3RBbGxvd2VkRXJyb3InLFxuICAgICAgICBEZXZpY2VzTm90Rm91bmRFcnJvcjogJ05vdEZvdW5kRXJyb3InLFxuICAgICAgICBDb25zdHJhaW50Tm90U2F0aXNmaWVkRXJyb3I6ICdPdmVyY29uc3RyYWluZWRFcnJvcicsXG4gICAgICAgIFRyYWNrU3RhcnRFcnJvcjogJ05vdFJlYWRhYmxlRXJyb3InLFxuICAgICAgICBNZWRpYURldmljZUZhaWxlZER1ZVRvU2h1dGRvd246ICdOb3RBbGxvd2VkRXJyb3InLFxuICAgICAgICBNZWRpYURldmljZUtpbGxTd2l0Y2hPbjogJ05vdEFsbG93ZWRFcnJvcicsXG4gICAgICAgIFRhYkNhcHR1cmVFcnJvcjogJ0Fib3J0RXJyb3InLFxuICAgICAgICBTY3JlZW5DYXB0dXJlRXJyb3I6ICdBYm9ydEVycm9yJyxcbiAgICAgICAgRGV2aWNlQ2FwdHVyZUVycm9yOiAnQWJvcnRFcnJvcidcbiAgICAgIH1bZS5uYW1lXSB8fCBlLm5hbWUsXG4gICAgICBtZXNzYWdlOiBlLm1lc3NhZ2UsXG4gICAgICBjb25zdHJhaW50OiBlLmNvbnN0cmFpbnROYW1lLFxuICAgICAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5uYW1lICsgKHRoaXMubWVzc2FnZSAmJiAnOiAnKSArIHRoaXMubWVzc2FnZTtcbiAgICAgIH1cbiAgICB9O1xuICB9O1xuXG4gIHZhciBnZXRVc2VyTWVkaWFfID0gZnVuY3Rpb24oY29uc3RyYWludHMsIG9uU3VjY2Vzcywgb25FcnJvcikge1xuICAgIHNoaW1Db25zdHJhaW50c18oY29uc3RyYWludHMsIGZ1bmN0aW9uKGMpIHtcbiAgICAgIG5hdmlnYXRvci53ZWJraXRHZXRVc2VyTWVkaWEoYywgb25TdWNjZXNzLCBmdW5jdGlvbihlKSB7XG4gICAgICAgIGlmIChvbkVycm9yKSB7XG4gICAgICAgICAgb25FcnJvcihzaGltRXJyb3JfKGUpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH07XG5cbiAgbmF2aWdhdG9yLmdldFVzZXJNZWRpYSA9IGdldFVzZXJNZWRpYV87XG5cbiAgLy8gUmV0dXJucyB0aGUgcmVzdWx0IG9mIGdldFVzZXJNZWRpYSBhcyBhIFByb21pc2UuXG4gIHZhciBnZXRVc2VyTWVkaWFQcm9taXNlXyA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgbmF2aWdhdG9yLmdldFVzZXJNZWRpYShjb25zdHJhaW50cywgcmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcbiAgfTtcblxuICBpZiAoIW5hdmlnYXRvci5tZWRpYURldmljZXMpIHtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzID0ge1xuICAgICAgZ2V0VXNlck1lZGlhOiBnZXRVc2VyTWVkaWFQcm9taXNlXyxcbiAgICAgIGVudW1lcmF0ZURldmljZXM6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSkge1xuICAgICAgICAgIHZhciBraW5kcyA9IHthdWRpbzogJ2F1ZGlvaW5wdXQnLCB2aWRlbzogJ3ZpZGVvaW5wdXQnfTtcbiAgICAgICAgICByZXR1cm4gd2luZG93Lk1lZGlhU3RyZWFtVHJhY2suZ2V0U291cmNlcyhmdW5jdGlvbihkZXZpY2VzKSB7XG4gICAgICAgICAgICByZXNvbHZlKGRldmljZXMubWFwKGZ1bmN0aW9uKGRldmljZSkge1xuICAgICAgICAgICAgICByZXR1cm4ge2xhYmVsOiBkZXZpY2UubGFiZWwsXG4gICAgICAgICAgICAgICAga2luZDoga2luZHNbZGV2aWNlLmtpbmRdLFxuICAgICAgICAgICAgICAgIGRldmljZUlkOiBkZXZpY2UuaWQsXG4gICAgICAgICAgICAgICAgZ3JvdXBJZDogJyd9O1xuICAgICAgICAgICAgfSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0sXG4gICAgICBnZXRTdXBwb3J0ZWRDb25zdHJhaW50czogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZGV2aWNlSWQ6IHRydWUsIGVjaG9DYW5jZWxsYXRpb246IHRydWUsIGZhY2luZ01vZGU6IHRydWUsXG4gICAgICAgICAgZnJhbWVSYXRlOiB0cnVlLCBoZWlnaHQ6IHRydWUsIHdpZHRoOiB0cnVlXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8vIEEgc2hpbSBmb3IgZ2V0VXNlck1lZGlhIG1ldGhvZCBvbiB0aGUgbWVkaWFEZXZpY2VzIG9iamVjdC5cbiAgLy8gVE9ETyhLYXB0ZW5KYW5zc29uKSByZW1vdmUgb25jZSBpbXBsZW1lbnRlZCBpbiBDaHJvbWUgc3RhYmxlLlxuICBpZiAoIW5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhKSB7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEgPSBmdW5jdGlvbihjb25zdHJhaW50cykge1xuICAgICAgcmV0dXJuIGdldFVzZXJNZWRpYVByb21pc2VfKGNvbnN0cmFpbnRzKTtcbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIC8vIEV2ZW4gdGhvdWdoIENocm9tZSA0NSBoYXMgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcyBhbmQgYSBnZXRVc2VyTWVkaWFcbiAgICAvLyBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGEgUHJvbWlzZSwgaXQgZG9lcyBub3QgYWNjZXB0IHNwZWMtc3R5bGVcbiAgICAvLyBjb25zdHJhaW50cy5cbiAgICB2YXIgb3JpZ0dldFVzZXJNZWRpYSA9IG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhLlxuICAgICAgICBiaW5kKG5hdmlnYXRvci5tZWRpYURldmljZXMpO1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oY3MpIHtcbiAgICAgIHJldHVybiBzaGltQ29uc3RyYWludHNfKGNzLCBmdW5jdGlvbihjKSB7XG4gICAgICAgIHJldHVybiBvcmlnR2V0VXNlck1lZGlhKGMpLnRoZW4oZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgaWYgKGMuYXVkaW8gJiYgIXN0cmVhbS5nZXRBdWRpb1RyYWNrcygpLmxlbmd0aCB8fFxuICAgICAgICAgICAgICBjLnZpZGVvICYmICFzdHJlYW0uZ2V0VmlkZW9UcmFja3MoKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignJywgJ05vdEZvdW5kRXJyb3InKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHN0cmVhbTtcbiAgICAgICAgfSwgZnVuY3Rpb24oZSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChzaGltRXJyb3JfKGUpKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9O1xuICB9XG5cbiAgLy8gRHVtbXkgZGV2aWNlY2hhbmdlIGV2ZW50IG1ldGhvZHMuXG4gIC8vIFRPRE8oS2FwdGVuSmFuc3NvbikgcmVtb3ZlIG9uY2UgaW1wbGVtZW50ZWQgaW4gQ2hyb21lIHN0YWJsZS5cbiAgaWYgKHR5cGVvZiBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmFkZEV2ZW50TGlzdGVuZXIgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5hZGRFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oKSB7XG4gICAgICBsb2dnaW5nKCdEdW1teSBtZWRpYURldmljZXMuYWRkRXZlbnRMaXN0ZW5lciBjYWxsZWQuJyk7XG4gICAgfTtcbiAgfVxuICBpZiAodHlwZW9mIG5hdmlnYXRvci5tZWRpYURldmljZXMucmVtb3ZlRXZlbnRMaXN0ZW5lciA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgIGxvZ2dpbmcoJ0R1bW15IG1lZGlhRGV2aWNlcy5yZW1vdmVFdmVudExpc3RlbmVyIGNhbGxlZC4nKTtcbiAgICB9O1xuICB9XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTcgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciBTRFBVdGlscyA9IHJlcXVpcmUoJ3NkcCcpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgc2hpbVJUQ0ljZUNhbmRpZGF0ZTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gZm91bmRhdGlvbiBpcyBhcmJpdHJhcmlseSBjaG9zZW4gYXMgYW4gaW5kaWNhdG9yIGZvciBmdWxsIHN1cHBvcnQgZm9yXG4gICAgLy8gaHR0cHM6Ly93M2MuZ2l0aHViLmlvL3dlYnJ0Yy1wYy8jcnRjaWNlY2FuZGlkYXRlLWludGVyZmFjZVxuICAgIGlmICghd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSB8fCAod2luZG93LlJUQ0ljZUNhbmRpZGF0ZSAmJiAnZm91bmRhdGlvbicgaW5cbiAgICAgICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZS5wcm90b3R5cGUpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIE5hdGl2ZVJUQ0ljZUNhbmRpZGF0ZSA9IHdpbmRvdy5SVENJY2VDYW5kaWRhdGU7XG4gICAgd2luZG93LlJUQ0ljZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKGFyZ3MpIHtcbiAgICAgIC8vIFJlbW92ZSB0aGUgYT0gd2hpY2ggc2hvdWxkbid0IGJlIHBhcnQgb2YgdGhlIGNhbmRpZGF0ZSBzdHJpbmcuXG4gICAgICBpZiAodHlwZW9mIGFyZ3MgPT09ICdvYmplY3QnICYmIGFyZ3MuY2FuZGlkYXRlICYmXG4gICAgICAgICAgYXJncy5jYW5kaWRhdGUuaW5kZXhPZignYT0nKSA9PT0gMCkge1xuICAgICAgICBhcmdzID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShhcmdzKSk7XG4gICAgICAgIGFyZ3MuY2FuZGlkYXRlID0gYXJncy5jYW5kaWRhdGUuc3Vic3RyKDIpO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXJncy5jYW5kaWRhdGUgJiYgYXJncy5jYW5kaWRhdGUubGVuZ3RoKSB7XG4gICAgICAgIC8vIEF1Z21lbnQgdGhlIG5hdGl2ZSBjYW5kaWRhdGUgd2l0aCB0aGUgcGFyc2VkIGZpZWxkcy5cbiAgICAgICAgdmFyIG5hdGl2ZUNhbmRpZGF0ZSA9IG5ldyBOYXRpdmVSVENJY2VDYW5kaWRhdGUoYXJncyk7XG4gICAgICAgIHZhciBwYXJzZWRDYW5kaWRhdGUgPSBTRFBVdGlscy5wYXJzZUNhbmRpZGF0ZShhcmdzLmNhbmRpZGF0ZSk7XG4gICAgICAgIHZhciBhdWdtZW50ZWRDYW5kaWRhdGUgPSBPYmplY3QuYXNzaWduKG5hdGl2ZUNhbmRpZGF0ZSxcbiAgICAgICAgICAgIHBhcnNlZENhbmRpZGF0ZSk7XG5cbiAgICAgICAgLy8gQWRkIGEgc2VyaWFsaXplciB0aGF0IGRvZXMgbm90IHNlcmlhbGl6ZSB0aGUgZXh0cmEgYXR0cmlidXRlcy5cbiAgICAgICAgYXVnbWVudGVkQ2FuZGlkYXRlLnRvSlNPTiA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBjYW5kaWRhdGU6IGF1Z21lbnRlZENhbmRpZGF0ZS5jYW5kaWRhdGUsXG4gICAgICAgICAgICBzZHBNaWQ6IGF1Z21lbnRlZENhbmRpZGF0ZS5zZHBNaWQsXG4gICAgICAgICAgICBzZHBNTGluZUluZGV4OiBhdWdtZW50ZWRDYW5kaWRhdGUuc2RwTUxpbmVJbmRleCxcbiAgICAgICAgICAgIHVzZXJuYW1lRnJhZ21lbnQ6IGF1Z21lbnRlZENhbmRpZGF0ZS51c2VybmFtZUZyYWdtZW50LFxuICAgICAgICAgIH07XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiBhdWdtZW50ZWRDYW5kaWRhdGU7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IE5hdGl2ZVJUQ0ljZUNhbmRpZGF0ZShhcmdzKTtcbiAgICB9O1xuICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUucHJvdG90eXBlID0gTmF0aXZlUlRDSWNlQ2FuZGlkYXRlLnByb3RvdHlwZTtcblxuICAgIC8vIEhvb2sgdXAgdGhlIGF1Z21lbnRlZCBjYW5kaWRhdGUgaW4gb25pY2VjYW5kaWRhdGUgYW5kXG4gICAgLy8gYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgLi4uKVxuICAgIHV0aWxzLndyYXBQZWVyQ29ubmVjdGlvbkV2ZW50KHdpbmRvdywgJ2ljZWNhbmRpZGF0ZScsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIGlmIChlLmNhbmRpZGF0ZSkge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoZSwgJ2NhbmRpZGF0ZScsIHtcbiAgICAgICAgICB2YWx1ZTogbmV3IHdpbmRvdy5SVENJY2VDYW5kaWRhdGUoZS5jYW5kaWRhdGUpLFxuICAgICAgICAgIHdyaXRhYmxlOiAnZmFsc2UnXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGU7XG4gICAgfSk7XG4gIH0sXG5cbiAgLy8gc2hpbUNyZWF0ZU9iamVjdFVSTCBtdXN0IGJlIGNhbGxlZCBiZWZvcmUgc2hpbVNvdXJjZU9iamVjdCB0byBhdm9pZCBsb29wLlxuXG4gIHNoaW1DcmVhdGVPYmplY3RVUkw6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBVUkwgPSB3aW5kb3cgJiYgd2luZG93LlVSTDtcblxuICAgIGlmICghKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50ICYmXG4gICAgICAgICAgJ3NyY09iamVjdCcgaW4gd2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlICYmXG4gICAgICAgIFVSTC5jcmVhdGVPYmplY3RVUkwgJiYgVVJMLnJldm9rZU9iamVjdFVSTCkpIHtcbiAgICAgIC8vIE9ubHkgc2hpbSBDcmVhdGVPYmplY3RVUkwgdXNpbmcgc3JjT2JqZWN0IGlmIHNyY09iamVjdCBleGlzdHMuXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cblxuICAgIHZhciBuYXRpdmVDcmVhdGVPYmplY3RVUkwgPSBVUkwuY3JlYXRlT2JqZWN0VVJMLmJpbmQoVVJMKTtcbiAgICB2YXIgbmF0aXZlUmV2b2tlT2JqZWN0VVJMID0gVVJMLnJldm9rZU9iamVjdFVSTC5iaW5kKFVSTCk7XG4gICAgdmFyIHN0cmVhbXMgPSBuZXcgTWFwKCksIG5ld0lkID0gMDtcblxuICAgIFVSTC5jcmVhdGVPYmplY3RVUkwgPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIGlmICgnZ2V0VHJhY2tzJyBpbiBzdHJlYW0pIHtcbiAgICAgICAgdmFyIHVybCA9ICdwb2x5YmxvYjonICsgKCsrbmV3SWQpO1xuICAgICAgICBzdHJlYW1zLnNldCh1cmwsIHN0cmVhbSk7XG4gICAgICAgIHV0aWxzLmRlcHJlY2F0ZWQoJ1VSTC5jcmVhdGVPYmplY3RVUkwoc3RyZWFtKScsXG4gICAgICAgICAgICAnZWxlbS5zcmNPYmplY3QgPSBzdHJlYW0nKTtcbiAgICAgICAgcmV0dXJuIHVybDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVDcmVhdGVPYmplY3RVUkwoc3RyZWFtKTtcbiAgICB9O1xuICAgIFVSTC5yZXZva2VPYmplY3RVUkwgPSBmdW5jdGlvbih1cmwpIHtcbiAgICAgIG5hdGl2ZVJldm9rZU9iamVjdFVSTCh1cmwpO1xuICAgICAgc3RyZWFtcy5kZWxldGUodXJsKTtcbiAgICB9O1xuXG4gICAgdmFyIGRzYyA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iod2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdzcmMnKTtcbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLCAnc3JjJywge1xuICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIGRzYy5nZXQuYXBwbHkodGhpcyk7XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih1cmwpIHtcbiAgICAgICAgdGhpcy5zcmNPYmplY3QgPSBzdHJlYW1zLmdldCh1cmwpIHx8IG51bGw7XG4gICAgICAgIHJldHVybiBkc2Muc2V0LmFwcGx5KHRoaXMsIFt1cmxdKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHZhciBuYXRpdmVTZXRBdHRyaWJ1dGUgPSB3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUuc2V0QXR0cmlidXRlO1xuICAgIHdpbmRvdy5IVE1MTWVkaWFFbGVtZW50LnByb3RvdHlwZS5zZXRBdHRyaWJ1dGUgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAyICYmXG4gICAgICAgICAgKCcnICsgYXJndW1lbnRzWzBdKS50b0xvd2VyQ2FzZSgpID09PSAnc3JjJykge1xuICAgICAgICB0aGlzLnNyY09iamVjdCA9IHN0cmVhbXMuZ2V0KGFyZ3VtZW50c1sxXSkgfHwgbnVsbDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVTZXRBdHRyaWJ1dGUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1NYXhNZXNzYWdlU2l6ZTogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKHdpbmRvdy5SVENTY3RwVHJhbnNwb3J0IHx8ICF3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuXG4gICAgaWYgKCEoJ3NjdHAnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSwgJ3NjdHAnLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHR5cGVvZiB0aGlzLl9zY3RwID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiB0aGlzLl9zY3RwO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB2YXIgc2N0cEluRGVzY3JpcHRpb24gPSBmdW5jdGlvbihkZXNjcmlwdGlvbikge1xuICAgICAgdmFyIHNlY3Rpb25zID0gU0RQVXRpbHMuc3BsaXRTZWN0aW9ucyhkZXNjcmlwdGlvbi5zZHApO1xuICAgICAgc2VjdGlvbnMuc2hpZnQoKTtcbiAgICAgIHJldHVybiBzZWN0aW9ucy5zb21lKGZ1bmN0aW9uKG1lZGlhU2VjdGlvbikge1xuICAgICAgICB2YXIgbUxpbmUgPSBTRFBVdGlscy5wYXJzZU1MaW5lKG1lZGlhU2VjdGlvbik7XG4gICAgICAgIHJldHVybiBtTGluZSAmJiBtTGluZS5raW5kID09PSAnYXBwbGljYXRpb24nXG4gICAgICAgICAgICAmJiBtTGluZS5wcm90b2NvbC5pbmRleE9mKCdTQ1RQJykgIT09IC0xO1xuICAgICAgfSk7XG4gICAgfTtcblxuICAgIHZhciBnZXRSZW1vdGVGaXJlZm94VmVyc2lvbiA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uKSB7XG4gICAgICAvLyBUT0RPOiBJcyB0aGVyZSBhIGJldHRlciBzb2x1dGlvbiBmb3IgZGV0ZWN0aW5nIEZpcmVmb3g/XG4gICAgICB2YXIgbWF0Y2ggPSBkZXNjcmlwdGlvbi5zZHAubWF0Y2goL21vemlsbGEuLi5USElTX0lTX1NEUEFSVEEtKFxcZCspLyk7XG4gICAgICBpZiAobWF0Y2ggPT09IG51bGwgfHwgbWF0Y2gubGVuZ3RoIDwgMikge1xuICAgICAgICByZXR1cm4gLTE7XG4gICAgICB9XG4gICAgICB2YXIgdmVyc2lvbiA9IHBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gICAgICAvLyBUZXN0IGZvciBOYU4gKHllcywgdGhpcyBpcyB1Z2x5KVxuICAgICAgcmV0dXJuIHZlcnNpb24gIT09IHZlcnNpb24gPyAtMSA6IHZlcnNpb247XG4gICAgfTtcblxuICAgIHZhciBnZXRDYW5TZW5kTWF4TWVzc2FnZVNpemUgPSBmdW5jdGlvbihyZW1vdGVJc0ZpcmVmb3gpIHtcbiAgICAgIC8vIEV2ZXJ5IGltcGxlbWVudGF0aW9uIHdlIGtub3cgY2FuIHNlbmQgYXQgbGVhc3QgNjQgS2lCLlxuICAgICAgLy8gTm90ZTogQWx0aG91Z2ggQ2hyb21lIGlzIHRlY2huaWNhbGx5IGFibGUgdG8gc2VuZCB1cCB0byAyNTYgS2lCLCB0aGVcbiAgICAgIC8vICAgICAgIGRhdGEgZG9lcyBub3QgcmVhY2ggdGhlIG90aGVyIHBlZXIgcmVsaWFibHkuXG4gICAgICAvLyAgICAgICBTZWU6IGh0dHBzOi8vYnVncy5jaHJvbWl1bS5vcmcvcC93ZWJydGMvaXNzdWVzL2RldGFpbD9pZD04NDE5XG4gICAgICB2YXIgY2FuU2VuZE1heE1lc3NhZ2VTaXplID0gNjU1MzY7XG4gICAgICBpZiAoYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNTcpIHtcbiAgICAgICAgICBpZiAocmVtb3RlSXNGaXJlZm94ID09PSAtMSkge1xuICAgICAgICAgICAgLy8gRkYgPCA1NyB3aWxsIHNlbmQgaW4gMTYgS2lCIGNodW5rcyB1c2luZyB0aGUgZGVwcmVjYXRlZCBQUElEXG4gICAgICAgICAgICAvLyBmcmFnbWVudGF0aW9uLlxuICAgICAgICAgICAgY2FuU2VuZE1heE1lc3NhZ2VTaXplID0gMTYzODQ7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEhvd2V2ZXIsIG90aGVyIEZGIChhbmQgUkFXUlRDKSBjYW4gcmVhc3NlbWJsZSBQUElELWZyYWdtZW50ZWRcbiAgICAgICAgICAgIC8vIG1lc3NhZ2VzLiBUaHVzLCBzdXBwb3J0aW5nIH4yIEdpQiB3aGVuIHNlbmRpbmcuXG4gICAgICAgICAgICBjYW5TZW5kTWF4TWVzc2FnZVNpemUgPSAyMTQ3NDgzNjM3O1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNjApIHtcbiAgICAgICAgICAvLyBDdXJyZW50bHksIGFsbCBGRiA+PSA1NyB3aWxsIHJlc2V0IHRoZSByZW1vdGUgbWF4aW11bSBtZXNzYWdlIHNpemVcbiAgICAgICAgICAvLyB0byB0aGUgZGVmYXVsdCB2YWx1ZSB3aGVuIGEgZGF0YSBjaGFubmVsIGlzIGNyZWF0ZWQgYXQgYSBsYXRlclxuICAgICAgICAgIC8vIHN0YWdlLiA6KFxuICAgICAgICAgIC8vIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTQyNjgzMVxuICAgICAgICAgIGNhblNlbmRNYXhNZXNzYWdlU2l6ZSA9XG4gICAgICAgICAgICBicm93c2VyRGV0YWlscy52ZXJzaW9uID09PSA1NyA/IDY1NTM1IDogNjU1MzY7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gRkYgPj0gNjAgc3VwcG9ydHMgc2VuZGluZyB+MiBHaUJcbiAgICAgICAgICBjYW5TZW5kTWF4TWVzc2FnZVNpemUgPSAyMTQ3NDgzNjM3O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gY2FuU2VuZE1heE1lc3NhZ2VTaXplO1xuICAgIH07XG5cbiAgICB2YXIgZ2V0TWF4TWVzc2FnZVNpemUgPSBmdW5jdGlvbihkZXNjcmlwdGlvbiwgcmVtb3RlSXNGaXJlZm94KSB7XG4gICAgICAvLyBOb3RlOiA2NTUzNiBieXRlcyBpcyB0aGUgZGVmYXVsdCB2YWx1ZSBmcm9tIHRoZSBTRFAgc3BlYy4gQWxzbyxcbiAgICAgIC8vICAgICAgIGV2ZXJ5IGltcGxlbWVudGF0aW9uIHdlIGtub3cgc3VwcG9ydHMgcmVjZWl2aW5nIDY1NTM2IGJ5dGVzLlxuICAgICAgdmFyIG1heE1lc3NhZ2VTaXplID0gNjU1MzY7XG5cbiAgICAgIC8vIEZGIDU3IGhhcyBhIHNsaWdodGx5IGluY29ycmVjdCBkZWZhdWx0IHJlbW90ZSBtYXggbWVzc2FnZSBzaXplLCBzb1xuICAgICAgLy8gd2UgbmVlZCB0byBhZGp1c3QgaXQgaGVyZSB0byBhdm9pZCBhIGZhaWx1cmUgd2hlbiBzZW5kaW5nLlxuICAgICAgLy8gU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD0xNDI1Njk3XG4gICAgICBpZiAoYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnXG4gICAgICAgICAgICYmIGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPT09IDU3KSB7XG4gICAgICAgIG1heE1lc3NhZ2VTaXplID0gNjU1MzU7XG4gICAgICB9XG5cbiAgICAgIHZhciBtYXRjaCA9IFNEUFV0aWxzLm1hdGNoUHJlZml4KGRlc2NyaXB0aW9uLnNkcCwgJ2E9bWF4LW1lc3NhZ2Utc2l6ZTonKTtcbiAgICAgIGlmIChtYXRjaC5sZW5ndGggPiAwKSB7XG4gICAgICAgIG1heE1lc3NhZ2VTaXplID0gcGFyc2VJbnQobWF0Y2hbMF0uc3Vic3RyKDE5KSwgMTApO1xuICAgICAgfSBlbHNlIGlmIChicm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcgJiZcbiAgICAgICAgICAgICAgICAgIHJlbW90ZUlzRmlyZWZveCAhPT0gLTEpIHtcbiAgICAgICAgLy8gSWYgdGhlIG1heGltdW0gbWVzc2FnZSBzaXplIGlzIG5vdCBwcmVzZW50IGluIHRoZSByZW1vdGUgU0RQIGFuZFxuICAgICAgICAvLyBib3RoIGxvY2FsIGFuZCByZW1vdGUgYXJlIEZpcmVmb3gsIHRoZSByZW1vdGUgcGVlciBjYW4gcmVjZWl2ZVxuICAgICAgICAvLyB+MiBHaUIuXG4gICAgICAgIG1heE1lc3NhZ2VTaXplID0gMjE0NzQ4MzYzNztcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXhNZXNzYWdlU2l6ZTtcbiAgICB9O1xuXG4gICAgdmFyIG9yaWdTZXRSZW1vdGVEZXNjcmlwdGlvbiA9XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuc2V0UmVtb3RlRGVzY3JpcHRpb247XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHBjLl9zY3RwID0gbnVsbDtcblxuICAgICAgaWYgKHNjdHBJbkRlc2NyaXB0aW9uKGFyZ3VtZW50c1swXSkpIHtcbiAgICAgICAgLy8gQ2hlY2sgaWYgdGhlIHJlbW90ZSBpcyBGRi5cbiAgICAgICAgdmFyIGlzRmlyZWZveCA9IGdldFJlbW90ZUZpcmVmb3hWZXJzaW9uKGFyZ3VtZW50c1swXSk7XG5cbiAgICAgICAgLy8gR2V0IHRoZSBtYXhpbXVtIG1lc3NhZ2Ugc2l6ZSB0aGUgbG9jYWwgcGVlciBpcyBjYXBhYmxlIG9mIHNlbmRpbmdcbiAgICAgICAgdmFyIGNhblNlbmRNTVMgPSBnZXRDYW5TZW5kTWF4TWVzc2FnZVNpemUoaXNGaXJlZm94KTtcblxuICAgICAgICAvLyBHZXQgdGhlIG1heGltdW0gbWVzc2FnZSBzaXplIG9mIHRoZSByZW1vdGUgcGVlci5cbiAgICAgICAgdmFyIHJlbW90ZU1NUyA9IGdldE1heE1lc3NhZ2VTaXplKGFyZ3VtZW50c1swXSwgaXNGaXJlZm94KTtcblxuICAgICAgICAvLyBEZXRlcm1pbmUgZmluYWwgbWF4aW11bSBtZXNzYWdlIHNpemVcbiAgICAgICAgdmFyIG1heE1lc3NhZ2VTaXplO1xuICAgICAgICBpZiAoY2FuU2VuZE1NUyA9PT0gMCAmJiByZW1vdGVNTVMgPT09IDApIHtcbiAgICAgICAgICBtYXhNZXNzYWdlU2l6ZSA9IE51bWJlci5QT1NJVElWRV9JTkZJTklUWTtcbiAgICAgICAgfSBlbHNlIGlmIChjYW5TZW5kTU1TID09PSAwIHx8IHJlbW90ZU1NUyA9PT0gMCkge1xuICAgICAgICAgIG1heE1lc3NhZ2VTaXplID0gTWF0aC5tYXgoY2FuU2VuZE1NUywgcmVtb3RlTU1TKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBtYXhNZXNzYWdlU2l6ZSA9IE1hdGgubWluKGNhblNlbmRNTVMsIHJlbW90ZU1NUyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBDcmVhdGUgYSBkdW1teSBSVENTY3RwVHJhbnNwb3J0IG9iamVjdCBhbmQgdGhlICdtYXhNZXNzYWdlU2l6ZSdcbiAgICAgICAgLy8gYXR0cmlidXRlLlxuICAgICAgICB2YXIgc2N0cCA9IHt9O1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoc2N0cCwgJ21heE1lc3NhZ2VTaXplJywge1xuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gbWF4TWVzc2FnZVNpemU7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcGMuX3NjdHAgPSBzY3RwO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gb3JpZ1NldFJlbW90ZURlc2NyaXB0aW9uLmFwcGx5KHBjLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbVNlbmRUaHJvd1R5cGVFcnJvcjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKCEod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgICdjcmVhdGVEYXRhQ2hhbm5lbCcgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBOb3RlOiBBbHRob3VnaCBGaXJlZm94ID49IDU3IGhhcyBhIG5hdGl2ZSBpbXBsZW1lbnRhdGlvbiwgdGhlIG1heGltdW1cbiAgICAvLyAgICAgICBtZXNzYWdlIHNpemUgY2FuIGJlIHJlc2V0IGZvciBhbGwgZGF0YSBjaGFubmVscyBhdCBhIGxhdGVyIHN0YWdlLlxuICAgIC8vICAgICAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9MTQyNjgzMVxuXG4gICAgZnVuY3Rpb24gd3JhcERjU2VuZChkYywgcGMpIHtcbiAgICAgIHZhciBvcmlnRGF0YUNoYW5uZWxTZW5kID0gZGMuc2VuZDtcbiAgICAgIGRjLnNlbmQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIGRhdGEgPSBhcmd1bWVudHNbMF07XG4gICAgICAgIHZhciBsZW5ndGggPSBkYXRhLmxlbmd0aCB8fCBkYXRhLnNpemUgfHwgZGF0YS5ieXRlTGVuZ3RoO1xuICAgICAgICBpZiAoZGMucmVhZHlTdGF0ZSA9PT0gJ29wZW4nICYmXG4gICAgICAgICAgICBwYy5zY3RwICYmIGxlbmd0aCA+IHBjLnNjdHAubWF4TWVzc2FnZVNpemUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNZXNzYWdlIHRvbyBsYXJnZSAoY2FuIHNlbmQgYSBtYXhpbXVtIG9mICcgK1xuICAgICAgICAgICAgcGMuc2N0cC5tYXhNZXNzYWdlU2l6ZSArICcgYnl0ZXMpJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9yaWdEYXRhQ2hhbm5lbFNlbmQuYXBwbHkoZGMsIGFyZ3VtZW50cyk7XG4gICAgICB9O1xuICAgIH1cbiAgICB2YXIgb3JpZ0NyZWF0ZURhdGFDaGFubmVsID1cbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlRGF0YUNoYW5uZWw7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5jcmVhdGVEYXRhQ2hhbm5lbCA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgIHZhciBkYXRhQ2hhbm5lbCA9IG9yaWdDcmVhdGVEYXRhQ2hhbm5lbC5hcHBseShwYywgYXJndW1lbnRzKTtcbiAgICAgIHdyYXBEY1NlbmQoZGF0YUNoYW5uZWwsIHBjKTtcbiAgICAgIHJldHVybiBkYXRhQ2hhbm5lbDtcbiAgICB9O1xuICAgIHV0aWxzLndyYXBQZWVyQ29ubmVjdGlvbkV2ZW50KHdpbmRvdywgJ2RhdGFjaGFubmVsJywgZnVuY3Rpb24oZSkge1xuICAgICAgd3JhcERjU2VuZChlLmNoYW5uZWwsIGUudGFyZ2V0KTtcbiAgICAgIHJldHVybiBlO1xuICAgIH0pO1xuICB9XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG52YXIgZmlsdGVySWNlU2VydmVycyA9IHJlcXVpcmUoJy4vZmlsdGVyaWNlc2VydmVycycpO1xudmFyIHNoaW1SVENQZWVyQ29ubmVjdGlvbiA9IHJlcXVpcmUoJ3J0Y3BlZXJjb25uZWN0aW9uLXNoaW0nKTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIHNoaW1HZXRVc2VyTWVkaWE6IHJlcXVpcmUoJy4vZ2V0dXNlcm1lZGlhJyksXG4gIHNoaW1QZWVyQ29ubmVjdGlvbjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuXG4gICAgaWYgKHdpbmRvdy5SVENJY2VHYXRoZXJlcikge1xuICAgICAgaWYgKCF3aW5kb3cuUlRDSWNlQ2FuZGlkYXRlKSB7XG4gICAgICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUgPSBmdW5jdGlvbihhcmdzKSB7XG4gICAgICAgICAgcmV0dXJuIGFyZ3M7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBpZiAoIXdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24pIHtcbiAgICAgICAgd2luZG93LlJUQ1Nlc3Npb25EZXNjcmlwdGlvbiA9IGZ1bmN0aW9uKGFyZ3MpIHtcbiAgICAgICAgICByZXR1cm4gYXJncztcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICAgIC8vIHRoaXMgYWRkcyBhbiBhZGRpdGlvbmFsIGV2ZW50IGxpc3RlbmVyIHRvIE1lZGlhU3RyYWNrVHJhY2sgdGhhdCBzaWduYWxzXG4gICAgICAvLyB3aGVuIGEgdHJhY2tzIGVuYWJsZWQgcHJvcGVydHkgd2FzIGNoYW5nZWQuIFdvcmthcm91bmQgZm9yIGEgYnVnIGluXG4gICAgICAvLyBhZGRTdHJlYW0sIHNlZSBiZWxvdy4gTm8gbG9uZ2VyIHJlcXVpcmVkIGluIDE1MDI1K1xuICAgICAgaWYgKGJyb3dzZXJEZXRhaWxzLnZlcnNpb24gPCAxNTAyNSkge1xuICAgICAgICB2YXIgb3JpZ01TVEVuYWJsZWQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKFxuICAgICAgICAgICAgd2luZG93Lk1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLCAnZW5hYmxlZCcpO1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93Lk1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLCAnZW5hYmxlZCcsIHtcbiAgICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgICBvcmlnTVNURW5hYmxlZC5zZXQuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgICAgICAgICB2YXIgZXYgPSBuZXcgRXZlbnQoJ2VuYWJsZWQnKTtcbiAgICAgICAgICAgIGV2LmVuYWJsZWQgPSB2YWx1ZTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChldik7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBPUlRDIGRlZmluZXMgdGhlIERUTUYgc2VuZGVyIGEgYml0IGRpZmZlcmVudC5cbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vdzNjL29ydGMvaXNzdWVzLzcxNFxuICAgIGlmICh3aW5kb3cuUlRDUnRwU2VuZGVyICYmICEoJ2R0bWYnIGluIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlKSkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlLCAnZHRtZicsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAodGhpcy5fZHRtZiA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBpZiAodGhpcy50cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgICAgICAgIHRoaXMuX2R0bWYgPSBuZXcgd2luZG93LlJUQ0R0bWZTZW5kZXIodGhpcyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICAgICAgICB0aGlzLl9kdG1mID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX2R0bWY7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICAvLyBFZGdlIGN1cnJlbnRseSBvbmx5IGltcGxlbWVudHMgdGhlIFJUQ0R0bWZTZW5kZXIsIG5vdCB0aGVcbiAgICAvLyBSVENEVE1GU2VuZGVyIGFsaWFzLiBTZWUgaHR0cDovL2RyYWZ0Lm9ydGMub3JnLyNydGNkdG1mc2VuZGVyMipcbiAgICBpZiAod2luZG93LlJUQ0R0bWZTZW5kZXIgJiYgIXdpbmRvdy5SVENEVE1GU2VuZGVyKSB7XG4gICAgICB3aW5kb3cuUlRDRFRNRlNlbmRlciA9IHdpbmRvdy5SVENEdG1mU2VuZGVyO1xuICAgIH1cblxuICAgIHZhciBSVENQZWVyQ29ubmVjdGlvblNoaW0gPSBzaGltUlRDUGVlckNvbm5lY3Rpb24od2luZG93LFxuICAgICAgICBicm93c2VyRGV0YWlscy52ZXJzaW9uKTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gPSBmdW5jdGlvbihjb25maWcpIHtcbiAgICAgIGlmIChjb25maWcgJiYgY29uZmlnLmljZVNlcnZlcnMpIHtcbiAgICAgICAgY29uZmlnLmljZVNlcnZlcnMgPSBmaWx0ZXJJY2VTZXJ2ZXJzKGNvbmZpZy5pY2VTZXJ2ZXJzKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuZXcgUlRDUGVlckNvbm5lY3Rpb25TaGltKGNvbmZpZyk7XG4gICAgfTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlID0gUlRDUGVlckNvbm5lY3Rpb25TaGltLnByb3RvdHlwZTtcbiAgfSxcbiAgc2hpbVJlcGxhY2VUcmFjazogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gT1JUQyBoYXMgcmVwbGFjZVRyYWNrIC0tIGh0dHBzOi8vZ2l0aHViLmNvbS93M2Mvb3J0Yy9pc3N1ZXMvNjE0XG4gICAgaWYgKHdpbmRvdy5SVENSdHBTZW5kZXIgJiZcbiAgICAgICAgISgncmVwbGFjZVRyYWNrJyBpbiB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSkpIHtcbiAgICAgIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlLnJlcGxhY2VUcmFjayA9XG4gICAgICAgICAgd2luZG93LlJUQ1J0cFNlbmRlci5wcm90b3R5cGUuc2V0VHJhY2s7XG4gICAgfVxuICB9XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTggVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG4vLyBFZGdlIGRvZXMgbm90IGxpa2Vcbi8vIDEpIHN0dW46IGZpbHRlcmVkIGFmdGVyIDE0MzkzIHVubGVzcyA/dHJhbnNwb3J0PXVkcCBpcyBwcmVzZW50XG4vLyAyKSB0dXJuOiB0aGF0IGRvZXMgbm90IGhhdmUgYWxsIG9mIHR1cm46aG9zdDpwb3J0P3RyYW5zcG9ydD11ZHBcbi8vIDMpIHR1cm46IHdpdGggaXB2NiBhZGRyZXNzZXNcbi8vIDQpIHR1cm46IG9jY3VycmluZyBtdWxpcGxlIHRpbWVzXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGljZVNlcnZlcnMsIGVkZ2VWZXJzaW9uKSB7XG4gIHZhciBoYXNUdXJuID0gZmFsc2U7XG4gIGljZVNlcnZlcnMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGljZVNlcnZlcnMpKTtcbiAgcmV0dXJuIGljZVNlcnZlcnMuZmlsdGVyKGZ1bmN0aW9uKHNlcnZlcikge1xuICAgIGlmIChzZXJ2ZXIgJiYgKHNlcnZlci51cmxzIHx8IHNlcnZlci51cmwpKSB7XG4gICAgICB2YXIgdXJscyA9IHNlcnZlci51cmxzIHx8IHNlcnZlci51cmw7XG4gICAgICBpZiAoc2VydmVyLnVybCAmJiAhc2VydmVyLnVybHMpIHtcbiAgICAgICAgdXRpbHMuZGVwcmVjYXRlZCgnUlRDSWNlU2VydmVyLnVybCcsICdSVENJY2VTZXJ2ZXIudXJscycpO1xuICAgICAgfVxuICAgICAgdmFyIGlzU3RyaW5nID0gdHlwZW9mIHVybHMgPT09ICdzdHJpbmcnO1xuICAgICAgaWYgKGlzU3RyaW5nKSB7XG4gICAgICAgIHVybHMgPSBbdXJsc107XG4gICAgICB9XG4gICAgICB1cmxzID0gdXJscy5maWx0ZXIoZnVuY3Rpb24odXJsKSB7XG4gICAgICAgIHZhciB2YWxpZFR1cm4gPSB1cmwuaW5kZXhPZigndHVybjonKSA9PT0gMCAmJlxuICAgICAgICAgICAgdXJsLmluZGV4T2YoJ3RyYW5zcG9ydD11ZHAnKSAhPT0gLTEgJiZcbiAgICAgICAgICAgIHVybC5pbmRleE9mKCd0dXJuOlsnKSA9PT0gLTEgJiZcbiAgICAgICAgICAgICFoYXNUdXJuO1xuXG4gICAgICAgIGlmICh2YWxpZFR1cm4pIHtcbiAgICAgICAgICBoYXNUdXJuID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXJsLmluZGV4T2YoJ3N0dW46JykgPT09IDAgJiYgZWRnZVZlcnNpb24gPj0gMTQzOTMgJiZcbiAgICAgICAgICAgIHVybC5pbmRleE9mKCc/dHJhbnNwb3J0PXVkcCcpID09PSAtMTtcbiAgICAgIH0pO1xuXG4gICAgICBkZWxldGUgc2VydmVyLnVybDtcbiAgICAgIHNlcnZlci51cmxzID0gaXNTdHJpbmcgPyB1cmxzWzBdIDogdXJscztcbiAgICAgIHJldHVybiAhIXVybHMubGVuZ3RoO1xuICAgIH1cbiAgfSk7XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbi8vIEV4cG9zZSBwdWJsaWMgbWV0aG9kcy5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24od2luZG93KSB7XG4gIHZhciBuYXZpZ2F0b3IgPSB3aW5kb3cgJiYgd2luZG93Lm5hdmlnYXRvcjtcblxuICB2YXIgc2hpbUVycm9yXyA9IGZ1bmN0aW9uKGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZToge1Blcm1pc3Npb25EZW5pZWRFcnJvcjogJ05vdEFsbG93ZWRFcnJvcid9W2UubmFtZV0gfHwgZS5uYW1lLFxuICAgICAgbWVzc2FnZTogZS5tZXNzYWdlLFxuICAgICAgY29uc3RyYWludDogZS5jb25zdHJhaW50LFxuICAgICAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5uYW1lO1xuICAgICAgfVxuICAgIH07XG4gIH07XG5cbiAgLy8gZ2V0VXNlck1lZGlhIGVycm9yIHNoaW0uXG4gIHZhciBvcmlnR2V0VXNlck1lZGlhID0gbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEuXG4gICAgICBiaW5kKG5hdmlnYXRvci5tZWRpYURldmljZXMpO1xuICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGMpIHtcbiAgICByZXR1cm4gb3JpZ0dldFVzZXJNZWRpYShjKS5jYXRjaChmdW5jdGlvbihlKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3Qoc2hpbUVycm9yXyhlKSk7XG4gICAgfSk7XG4gIH07XG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzaGltR2V0VXNlck1lZGlhOiByZXF1aXJlKCcuL2dldHVzZXJtZWRpYScpLFxuICBzaGltT25UcmFjazogZnVuY3Rpb24od2luZG93KSB7XG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnICYmIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiAmJiAhKCdvbnRyYWNrJyBpblxuICAgICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUsICdvbnRyYWNrJywge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLl9vbnRyYWNrO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKGYpIHtcbiAgICAgICAgICBpZiAodGhpcy5fb250cmFjaykge1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKCd0cmFjaycsIHRoaXMuX29udHJhY2spO1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKCdhZGRzdHJlYW0nLCB0aGlzLl9vbnRyYWNrcG9seSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcigndHJhY2snLCB0aGlzLl9vbnRyYWNrID0gZik7XG4gICAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKCdhZGRzdHJlYW0nLCB0aGlzLl9vbnRyYWNrcG9seSA9IGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgICAgIGUuc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCd0cmFjaycpO1xuICAgICAgICAgICAgICBldmVudC50cmFjayA9IHRyYWNrO1xuICAgICAgICAgICAgICBldmVudC5yZWNlaXZlciA9IHt0cmFjazogdHJhY2t9O1xuICAgICAgICAgICAgICBldmVudC50cmFuc2NlaXZlciA9IHtyZWNlaXZlcjogZXZlbnQucmVjZWl2ZXJ9O1xuICAgICAgICAgICAgICBldmVudC5zdHJlYW1zID0gW2Uuc3RyZWFtXTtcbiAgICAgICAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDVHJhY2tFdmVudCAmJlxuICAgICAgICAoJ3JlY2VpdmVyJyBpbiB3aW5kb3cuUlRDVHJhY2tFdmVudC5wcm90b3R5cGUpICYmXG4gICAgICAgICEoJ3RyYW5zY2VpdmVyJyBpbiB3aW5kb3cuUlRDVHJhY2tFdmVudC5wcm90b3R5cGUpKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1RyYWNrRXZlbnQucHJvdG90eXBlLCAndHJhbnNjZWl2ZXInLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHtyZWNlaXZlcjogdGhpcy5yZWNlaXZlcn07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICBzaGltU291cmNlT2JqZWN0OiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBGaXJlZm94IGhhcyBzdXBwb3J0ZWQgbW96U3JjT2JqZWN0IHNpbmNlIEZGMjIsIHVucHJlZml4ZWQgaW4gNDIuXG4gICAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAod2luZG93LkhUTUxNZWRpYUVsZW1lbnQgJiZcbiAgICAgICAgISgnc3JjT2JqZWN0JyBpbiB3aW5kb3cuSFRNTE1lZGlhRWxlbWVudC5wcm90b3R5cGUpKSB7XG4gICAgICAgIC8vIFNoaW0gdGhlIHNyY09iamVjdCBwcm9wZXJ0eSwgb25jZSwgd2hlbiBIVE1MTWVkaWFFbGVtZW50IGlzIGZvdW5kLlxuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LkhUTUxNZWRpYUVsZW1lbnQucHJvdG90eXBlLCAnc3JjT2JqZWN0Jywge1xuICAgICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5tb3pTcmNPYmplY3Q7XG4gICAgICAgICAgfSxcbiAgICAgICAgICBzZXQ6IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgICAgdGhpcy5tb3pTcmNPYmplY3QgPSBzdHJlYW07XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgc2hpbVBlZXJDb25uZWN0aW9uOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICB2YXIgYnJvd3NlckRldGFpbHMgPSB1dGlscy5kZXRlY3RCcm93c2VyKHdpbmRvdyk7XG5cbiAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ29iamVjdCcgfHwgISh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gfHxcbiAgICAgICAgd2luZG93Lm1velJUQ1BlZXJDb25uZWN0aW9uKSkge1xuICAgICAgcmV0dXJuOyAvLyBwcm9iYWJseSBtZWRpYS5wZWVyY29ubmVjdGlvbi5lbmFibGVkPWZhbHNlIGluIGFib3V0OmNvbmZpZ1xuICAgIH1cbiAgICAvLyBUaGUgUlRDUGVlckNvbm5lY3Rpb24gb2JqZWN0LlxuICAgIGlmICghd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gPSBmdW5jdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cykge1xuICAgICAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDM4KSB7XG4gICAgICAgICAgLy8gLnVybHMgaXMgbm90IHN1cHBvcnRlZCBpbiBGRiA8IDM4LlxuICAgICAgICAgIC8vIGNyZWF0ZSBSVENJY2VTZXJ2ZXJzIHdpdGggYSBzaW5nbGUgdXJsLlxuICAgICAgICAgIGlmIChwY0NvbmZpZyAmJiBwY0NvbmZpZy5pY2VTZXJ2ZXJzKSB7XG4gICAgICAgICAgICB2YXIgbmV3SWNlU2VydmVycyA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwY0NvbmZpZy5pY2VTZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgIHZhciBzZXJ2ZXIgPSBwY0NvbmZpZy5pY2VTZXJ2ZXJzW2ldO1xuICAgICAgICAgICAgICBpZiAoc2VydmVyLmhhc093blByb3BlcnR5KCd1cmxzJykpIHtcbiAgICAgICAgICAgICAgICBmb3IgKHZhciBqID0gMDsgaiA8IHNlcnZlci51cmxzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgICAgICAgICAgICB2YXIgbmV3U2VydmVyID0ge1xuICAgICAgICAgICAgICAgICAgICB1cmw6IHNlcnZlci51cmxzW2pdXG4gICAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgICAgaWYgKHNlcnZlci51cmxzW2pdLmluZGV4T2YoJ3R1cm4nKSA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBuZXdTZXJ2ZXIudXNlcm5hbWUgPSBzZXJ2ZXIudXNlcm5hbWU7XG4gICAgICAgICAgICAgICAgICAgIG5ld1NlcnZlci5jcmVkZW50aWFsID0gc2VydmVyLmNyZWRlbnRpYWw7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2gobmV3U2VydmVyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKHBjQ29uZmlnLmljZVNlcnZlcnNbaV0pO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwY0NvbmZpZy5pY2VTZXJ2ZXJzID0gbmV3SWNlU2VydmVycztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyB3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpO1xuICAgICAgfTtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUgPVxuICAgICAgICAgIHdpbmRvdy5tb3pSVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGU7XG5cbiAgICAgIC8vIHdyYXAgc3RhdGljIG1ldGhvZHMuIEN1cnJlbnRseSBqdXN0IGdlbmVyYXRlQ2VydGlmaWNhdGUuXG4gICAgICBpZiAod2luZG93Lm1velJUQ1BlZXJDb25uZWN0aW9uLmdlbmVyYXRlQ2VydGlmaWNhdGUpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbiwgJ2dlbmVyYXRlQ2VydGlmaWNhdGUnLCB7XG4gICAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHJldHVybiB3aW5kb3cubW96UlRDUGVlckNvbm5lY3Rpb24uZ2VuZXJhdGVDZXJ0aWZpY2F0ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB3aW5kb3cuUlRDU2Vzc2lvbkRlc2NyaXB0aW9uID0gd2luZG93Lm1velJUQ1Nlc3Npb25EZXNjcmlwdGlvbjtcbiAgICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUgPSB3aW5kb3cubW96UlRDSWNlQ2FuZGlkYXRlO1xuICAgIH1cblxuICAgIC8vIHNoaW0gYXdheSBuZWVkIGZvciBvYnNvbGV0ZSBSVENJY2VDYW5kaWRhdGUvUlRDU2Vzc2lvbkRlc2NyaXB0aW9uLlxuICAgIFsnc2V0TG9jYWxEZXNjcmlwdGlvbicsICdzZXRSZW1vdGVEZXNjcmlwdGlvbicsICdhZGRJY2VDYW5kaWRhdGUnXVxuICAgICAgICAuZm9yRWFjaChmdW5jdGlvbihtZXRob2QpIHtcbiAgICAgICAgICB2YXIgbmF0aXZlTWV0aG9kID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZVttZXRob2RdO1xuICAgICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGVbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgYXJndW1lbnRzWzBdID0gbmV3ICgobWV0aG9kID09PSAnYWRkSWNlQ2FuZGlkYXRlJykgP1xuICAgICAgICAgICAgICAgIHdpbmRvdy5SVENJY2VDYW5kaWRhdGUgOlxuICAgICAgICAgICAgICAgIHdpbmRvdy5SVENTZXNzaW9uRGVzY3JpcHRpb24pKGFyZ3VtZW50c1swXSk7XG4gICAgICAgICAgICByZXR1cm4gbmF0aXZlTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgfTtcbiAgICAgICAgfSk7XG5cbiAgICAvLyBzdXBwb3J0IGZvciBhZGRJY2VDYW5kaWRhdGUobnVsbCBvciB1bmRlZmluZWQpXG4gICAgdmFyIG5hdGl2ZUFkZEljZUNhbmRpZGF0ZSA9XG4gICAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkSWNlQ2FuZGlkYXRlID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIWFyZ3VtZW50c1swXSkge1xuICAgICAgICBpZiAoYXJndW1lbnRzWzFdKSB7XG4gICAgICAgICAgYXJndW1lbnRzWzFdLmFwcGx5KG51bGwpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBuYXRpdmVBZGRJY2VDYW5kaWRhdGUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuXG4gICAgLy8gc2hpbSBnZXRTdGF0cyB3aXRoIG1hcGxpa2Ugc3VwcG9ydFxuICAgIHZhciBtYWtlTWFwU3RhdHMgPSBmdW5jdGlvbihzdGF0cykge1xuICAgICAgdmFyIG1hcCA9IG5ldyBNYXAoKTtcbiAgICAgIE9iamVjdC5rZXlzKHN0YXRzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICBtYXAuc2V0KGtleSwgc3RhdHNba2V5XSk7XG4gICAgICAgIG1hcFtrZXldID0gc3RhdHNba2V5XTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIG1hcDtcbiAgICB9O1xuXG4gICAgdmFyIG1vZGVyblN0YXRzVHlwZXMgPSB7XG4gICAgICBpbmJvdW5kcnRwOiAnaW5ib3VuZC1ydHAnLFxuICAgICAgb3V0Ym91bmRydHA6ICdvdXRib3VuZC1ydHAnLFxuICAgICAgY2FuZGlkYXRlcGFpcjogJ2NhbmRpZGF0ZS1wYWlyJyxcbiAgICAgIGxvY2FsY2FuZGlkYXRlOiAnbG9jYWwtY2FuZGlkYXRlJyxcbiAgICAgIHJlbW90ZWNhbmRpZGF0ZTogJ3JlbW90ZS1jYW5kaWRhdGUnXG4gICAgfTtcblxuICAgIHZhciBuYXRpdmVHZXRTdGF0cyA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0U3RhdHM7XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRTdGF0cyA9IGZ1bmN0aW9uKFxuICAgICAgc2VsZWN0b3IsXG4gICAgICBvblN1Y2MsXG4gICAgICBvbkVyclxuICAgICkge1xuICAgICAgcmV0dXJuIG5hdGl2ZUdldFN0YXRzLmFwcGx5KHRoaXMsIFtzZWxlY3RvciB8fCBudWxsXSlcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oc3RhdHMpIHtcbiAgICAgICAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDQ4KSB7XG4gICAgICAgICAgICBzdGF0cyA9IG1ha2VNYXBTdGF0cyhzdGF0cyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNTMgJiYgIW9uU3VjYykge1xuICAgICAgICAgICAgLy8gU2hpbSBvbmx5IHByb21pc2UgZ2V0U3RhdHMgd2l0aCBzcGVjLWh5cGhlbnMgaW4gdHlwZSBuYW1lc1xuICAgICAgICAgICAgLy8gTGVhdmUgY2FsbGJhY2sgdmVyc2lvbiBhbG9uZTsgbWlzYyBvbGQgdXNlcyBvZiBmb3JFYWNoIGJlZm9yZSBNYXBcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgIHN0YXRzLmZvckVhY2goZnVuY3Rpb24oc3RhdCkge1xuICAgICAgICAgICAgICAgIHN0YXQudHlwZSA9IG1vZGVyblN0YXRzVHlwZXNbc3RhdC50eXBlXSB8fCBzdGF0LnR5cGU7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICBpZiAoZS5uYW1lICE9PSAnVHlwZUVycm9yJykge1xuICAgICAgICAgICAgICAgIHRocm93IGU7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgLy8gQXZvaWQgVHlwZUVycm9yOiBcInR5cGVcIiBpcyByZWFkLW9ubHksIGluIG9sZCB2ZXJzaW9ucy4gMzQtNDNpc2hcbiAgICAgICAgICAgICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihzdGF0LCBpKSB7XG4gICAgICAgICAgICAgICAgc3RhdHMuc2V0KGksIE9iamVjdC5hc3NpZ24oe30sIHN0YXQsIHtcbiAgICAgICAgICAgICAgICAgIHR5cGU6IG1vZGVyblN0YXRzVHlwZXNbc3RhdC50eXBlXSB8fCBzdGF0LnR5cGVcbiAgICAgICAgICAgICAgICB9KSk7XG4gICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gc3RhdHM7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKG9uU3VjYywgb25FcnIpO1xuICAgIH07XG4gIH0sXG5cbiAgc2hpbVNlbmRlckdldFN0YXRzOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAoISh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgd2luZG93LlJUQ1J0cFNlbmRlcikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHdpbmRvdy5SVENSdHBTZW5kZXIgJiYgJ2dldFN0YXRzJyBpbiB3aW5kb3cuUlRDUnRwU2VuZGVyLnByb3RvdHlwZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgb3JpZ0dldFNlbmRlcnMgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnM7XG4gICAgaWYgKG9yaWdHZXRTZW5kZXJzKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFNlbmRlcnMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgdmFyIHNlbmRlcnMgPSBvcmlnR2V0U2VuZGVycy5hcHBseShwYywgW10pO1xuICAgICAgICBzZW5kZXJzLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICAgICAgc2VuZGVyLl9wYyA9IHBjO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHNlbmRlcnM7XG4gICAgICB9O1xuICAgIH1cblxuICAgIHZhciBvcmlnQWRkVHJhY2sgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFRyYWNrO1xuICAgIGlmIChvcmlnQWRkVHJhY2spIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2sgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHNlbmRlciA9IG9yaWdBZGRUcmFjay5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICBzZW5kZXIuX3BjID0gdGhpcztcbiAgICAgICAgcmV0dXJuIHNlbmRlcjtcbiAgICAgIH07XG4gICAgfVxuICAgIHdpbmRvdy5SVENSdHBTZW5kZXIucHJvdG90eXBlLmdldFN0YXRzID0gZnVuY3Rpb24oKSB7XG4gICAgICByZXR1cm4gdGhpcy50cmFjayA/IHRoaXMuX3BjLmdldFN0YXRzKHRoaXMudHJhY2spIDpcbiAgICAgICAgICBQcm9taXNlLnJlc29sdmUobmV3IE1hcCgpKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1SZWNlaXZlckdldFN0YXRzOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAoISh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0JyAmJiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24gJiZcbiAgICAgICAgd2luZG93LlJUQ1J0cFNlbmRlcikpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHdpbmRvdy5SVENSdHBTZW5kZXIgJiYgJ2dldFN0YXRzJyBpbiB3aW5kb3cuUlRDUnRwUmVjZWl2ZXIucHJvdG90eXBlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBvcmlnR2V0UmVjZWl2ZXJzID0gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRSZWNlaXZlcnM7XG4gICAgaWYgKG9yaWdHZXRSZWNlaXZlcnMpIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVjZWl2ZXJzID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICAgIHZhciByZWNlaXZlcnMgPSBvcmlnR2V0UmVjZWl2ZXJzLmFwcGx5KHBjLCBbXSk7XG4gICAgICAgIHJlY2VpdmVycy5mb3JFYWNoKGZ1bmN0aW9uKHJlY2VpdmVyKSB7XG4gICAgICAgICAgcmVjZWl2ZXIuX3BjID0gcGM7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVjZWl2ZXJzO1xuICAgICAgfTtcbiAgICB9XG4gICAgdXRpbHMud3JhcFBlZXJDb25uZWN0aW9uRXZlbnQod2luZG93LCAndHJhY2snLCBmdW5jdGlvbihlKSB7XG4gICAgICBlLnJlY2VpdmVyLl9wYyA9IGUuc3JjRWxlbWVudDtcbiAgICAgIHJldHVybiBlO1xuICAgIH0pO1xuICAgIHdpbmRvdy5SVENSdHBSZWNlaXZlci5wcm90b3R5cGUuZ2V0U3RhdHMgPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLl9wYy5nZXRTdGF0cyh0aGlzLnRyYWNrKTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1SZW1vdmVTdHJlYW06IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICghd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uIHx8XG4gICAgICAgICdyZW1vdmVTdHJlYW0nIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICB1dGlscy5kZXByZWNhdGVkKCdyZW1vdmVTdHJlYW0nLCAncmVtb3ZlVHJhY2snKTtcbiAgICAgIHRoaXMuZ2V0U2VuZGVycygpLmZvckVhY2goZnVuY3Rpb24oc2VuZGVyKSB7XG4gICAgICAgIGlmIChzZW5kZXIudHJhY2sgJiYgc3RyZWFtLmdldFRyYWNrcygpLmluZGV4T2Yoc2VuZGVyLnRyYWNrKSAhPT0gLTEpIHtcbiAgICAgICAgICBwYy5yZW1vdmVUcmFjayhzZW5kZXIpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9O1xuICB9LFxuXG4gIHNoaW1SVENEYXRhQ2hhbm5lbDogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gcmVuYW1lIERhdGFDaGFubmVsIHRvIFJUQ0RhdGFDaGFubmVsIChuYXRpdmUgZml4IGluIEZGNjApOlxuICAgIC8vIGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTExNzM4NTFcbiAgICBpZiAod2luZG93LkRhdGFDaGFubmVsICYmICF3aW5kb3cuUlRDRGF0YUNoYW5uZWwpIHtcbiAgICAgIHdpbmRvdy5SVENEYXRhQ2hhbm5lbCA9IHdpbmRvdy5EYXRhQ2hhbm5lbDtcbiAgICB9XG4gIH0sXG59O1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTYgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4gLyogZXNsaW50LWVudiBub2RlICovXG4ndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG52YXIgbG9nZ2luZyA9IHV0aWxzLmxvZztcblxuLy8gRXhwb3NlIHB1YmxpYyBtZXRob2RzLlxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih3aW5kb3cpIHtcbiAgdmFyIGJyb3dzZXJEZXRhaWxzID0gdXRpbHMuZGV0ZWN0QnJvd3Nlcih3aW5kb3cpO1xuICB2YXIgbmF2aWdhdG9yID0gd2luZG93ICYmIHdpbmRvdy5uYXZpZ2F0b3I7XG4gIHZhciBNZWRpYVN0cmVhbVRyYWNrID0gd2luZG93ICYmIHdpbmRvdy5NZWRpYVN0cmVhbVRyYWNrO1xuXG4gIHZhciBzaGltRXJyb3JfID0gZnVuY3Rpb24oZSkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB7XG4gICAgICAgIEludGVybmFsRXJyb3I6ICdOb3RSZWFkYWJsZUVycm9yJyxcbiAgICAgICAgTm90U3VwcG9ydGVkRXJyb3I6ICdUeXBlRXJyb3InLFxuICAgICAgICBQZXJtaXNzaW9uRGVuaWVkRXJyb3I6ICdOb3RBbGxvd2VkRXJyb3InLFxuICAgICAgICBTZWN1cml0eUVycm9yOiAnTm90QWxsb3dlZEVycm9yJ1xuICAgICAgfVtlLm5hbWVdIHx8IGUubmFtZSxcbiAgICAgIG1lc3NhZ2U6IHtcbiAgICAgICAgJ1RoZSBvcGVyYXRpb24gaXMgaW5zZWN1cmUuJzogJ1RoZSByZXF1ZXN0IGlzIG5vdCBhbGxvd2VkIGJ5IHRoZSAnICtcbiAgICAgICAgJ3VzZXIgYWdlbnQgb3IgdGhlIHBsYXRmb3JtIGluIHRoZSBjdXJyZW50IGNvbnRleHQuJ1xuICAgICAgfVtlLm1lc3NhZ2VdIHx8IGUubWVzc2FnZSxcbiAgICAgIGNvbnN0cmFpbnQ6IGUuY29uc3RyYWludCxcbiAgICAgIHRvU3RyaW5nOiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMubmFtZSArICh0aGlzLm1lc3NhZ2UgJiYgJzogJykgKyB0aGlzLm1lc3NhZ2U7XG4gICAgICB9XG4gICAgfTtcbiAgfTtcblxuICAvLyBnZXRVc2VyTWVkaWEgY29uc3RyYWludHMgc2hpbS5cbiAgdmFyIGdldFVzZXJNZWRpYV8gPSBmdW5jdGlvbihjb25zdHJhaW50cywgb25TdWNjZXNzLCBvbkVycm9yKSB7XG4gICAgdmFyIGNvbnN0cmFpbnRzVG9GRjM3XyA9IGZ1bmN0aW9uKGMpIHtcbiAgICAgIGlmICh0eXBlb2YgYyAhPT0gJ29iamVjdCcgfHwgYy5yZXF1aXJlKSB7XG4gICAgICAgIHJldHVybiBjO1xuICAgICAgfVxuICAgICAgdmFyIHJlcXVpcmUgPSBbXTtcbiAgICAgIE9iamVjdC5rZXlzKGMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgIGlmIChrZXkgPT09ICdyZXF1aXJlJyB8fCBrZXkgPT09ICdhZHZhbmNlZCcgfHwga2V5ID09PSAnbWVkaWFTb3VyY2UnKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciByID0gY1trZXldID0gKHR5cGVvZiBjW2tleV0gPT09ICdvYmplY3QnKSA/XG4gICAgICAgICAgICBjW2tleV0gOiB7aWRlYWw6IGNba2V5XX07XG4gICAgICAgIGlmIChyLm1pbiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgICAgICAgICByLm1heCAhPT0gdW5kZWZpbmVkIHx8IHIuZXhhY3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHJlcXVpcmUucHVzaChrZXkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyLmV4YWN0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHIuZXhhY3QgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICByLiBtaW4gPSByLm1heCA9IHIuZXhhY3Q7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNba2V5XSA9IHIuZXhhY3Q7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRlbGV0ZSByLmV4YWN0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChyLmlkZWFsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICBjLmFkdmFuY2VkID0gYy5hZHZhbmNlZCB8fCBbXTtcbiAgICAgICAgICB2YXIgb2MgPSB7fTtcbiAgICAgICAgICBpZiAodHlwZW9mIHIuaWRlYWwgPT09ICdudW1iZXInKSB7XG4gICAgICAgICAgICBvY1trZXldID0ge21pbjogci5pZGVhbCwgbWF4OiByLmlkZWFsfTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgb2Nba2V5XSA9IHIuaWRlYWw7XG4gICAgICAgICAgfVxuICAgICAgICAgIGMuYWR2YW5jZWQucHVzaChvYyk7XG4gICAgICAgICAgZGVsZXRlIHIuaWRlYWw7XG4gICAgICAgICAgaWYgKCFPYmplY3Qua2V5cyhyKS5sZW5ndGgpIHtcbiAgICAgICAgICAgIGRlbGV0ZSBjW2tleV07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGlmIChyZXF1aXJlLmxlbmd0aCkge1xuICAgICAgICBjLnJlcXVpcmUgPSByZXF1aXJlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGM7XG4gICAgfTtcbiAgICBjb25zdHJhaW50cyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDM4KSB7XG4gICAgICBsb2dnaW5nKCdzcGVjOiAnICsgSlNPTi5zdHJpbmdpZnkoY29uc3RyYWludHMpKTtcbiAgICAgIGlmIChjb25zdHJhaW50cy5hdWRpbykge1xuICAgICAgICBjb25zdHJhaW50cy5hdWRpbyA9IGNvbnN0cmFpbnRzVG9GRjM3Xyhjb25zdHJhaW50cy5hdWRpbyk7XG4gICAgICB9XG4gICAgICBpZiAoY29uc3RyYWludHMudmlkZW8pIHtcbiAgICAgICAgY29uc3RyYWludHMudmlkZW8gPSBjb25zdHJhaW50c1RvRkYzN18oY29uc3RyYWludHMudmlkZW8pO1xuICAgICAgfVxuICAgICAgbG9nZ2luZygnZmYzNzogJyArIEpTT04uc3RyaW5naWZ5KGNvbnN0cmFpbnRzKSk7XG4gICAgfVxuICAgIHJldHVybiBuYXZpZ2F0b3IubW96R2V0VXNlck1lZGlhKGNvbnN0cmFpbnRzLCBvblN1Y2Nlc3MsIGZ1bmN0aW9uKGUpIHtcbiAgICAgIG9uRXJyb3Ioc2hpbUVycm9yXyhlKSk7XG4gICAgfSk7XG4gIH07XG5cbiAgLy8gUmV0dXJucyB0aGUgcmVzdWx0IG9mIGdldFVzZXJNZWRpYSBhcyBhIFByb21pc2UuXG4gIHZhciBnZXRVc2VyTWVkaWFQcm9taXNlXyA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgZ2V0VXNlck1lZGlhXyhjb25zdHJhaW50cywgcmVzb2x2ZSwgcmVqZWN0KTtcbiAgICB9KTtcbiAgfTtcblxuICAvLyBTaGltIGZvciBtZWRpYURldmljZXMgb24gb2xkZXIgdmVyc2lvbnMuXG4gIGlmICghbmF2aWdhdG9yLm1lZGlhRGV2aWNlcykge1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMgPSB7Z2V0VXNlck1lZGlhOiBnZXRVc2VyTWVkaWFQcm9taXNlXyxcbiAgICAgIGFkZEV2ZW50TGlzdGVuZXI6IGZ1bmN0aW9uKCkgeyB9LFxuICAgICAgcmVtb3ZlRXZlbnRMaXN0ZW5lcjogZnVuY3Rpb24oKSB7IH1cbiAgICB9O1xuICB9XG4gIG5hdmlnYXRvci5tZWRpYURldmljZXMuZW51bWVyYXRlRGV2aWNlcyA9XG4gICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmVudW1lcmF0ZURldmljZXMgfHwgZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICAgICAgdmFyIGluZm9zID0gW1xuICAgICAgICAgICAge2tpbmQ6ICdhdWRpb2lucHV0JywgZGV2aWNlSWQ6ICdkZWZhdWx0JywgbGFiZWw6ICcnLCBncm91cElkOiAnJ30sXG4gICAgICAgICAgICB7a2luZDogJ3ZpZGVvaW5wdXQnLCBkZXZpY2VJZDogJ2RlZmF1bHQnLCBsYWJlbDogJycsIGdyb3VwSWQ6ICcnfVxuICAgICAgICAgIF07XG4gICAgICAgICAgcmVzb2x2ZShpbmZvcyk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcblxuICBpZiAoYnJvd3NlckRldGFpbHMudmVyc2lvbiA8IDQxKSB7XG4gICAgLy8gV29yayBhcm91bmQgaHR0cDovL2J1Z3ppbC5sYS8xMTY5NjY1XG4gICAgdmFyIG9yZ0VudW1lcmF0ZURldmljZXMgPVxuICAgICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmVudW1lcmF0ZURldmljZXMuYmluZChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmVudW1lcmF0ZURldmljZXMgPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBvcmdFbnVtZXJhdGVEZXZpY2VzKCkudGhlbih1bmRlZmluZWQsIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgaWYgKGUubmFtZSA9PT0gJ05vdEZvdW5kRXJyb3InKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9KTtcbiAgICB9O1xuICB9XG4gIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNDkpIHtcbiAgICB2YXIgb3JpZ0dldFVzZXJNZWRpYSA9IG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhLlxuICAgICAgICBiaW5kKG5hdmlnYXRvci5tZWRpYURldmljZXMpO1xuICAgIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oYykge1xuICAgICAgcmV0dXJuIG9yaWdHZXRVc2VyTWVkaWEoYykudGhlbihmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgLy8gV29yayBhcm91bmQgaHR0cHM6Ly9idWd6aWwubGEvODAyMzI2XG4gICAgICAgIGlmIChjLmF1ZGlvICYmICFzdHJlYW0uZ2V0QXVkaW9UcmFja3MoKS5sZW5ndGggfHxcbiAgICAgICAgICAgIGMudmlkZW8gJiYgIXN0cmVhbS5nZXRWaWRlb1RyYWNrcygpLmxlbmd0aCkge1xuICAgICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgICB0cmFjay5zdG9wKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgdGhyb3cgbmV3IERPTUV4Y2VwdGlvbignVGhlIG9iamVjdCBjYW4gbm90IGJlIGZvdW5kIGhlcmUuJyxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdOb3RGb3VuZEVycm9yJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHN0cmVhbTtcbiAgICAgIH0sIGZ1bmN0aW9uKGUpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KHNoaW1FcnJvcl8oZSkpO1xuICAgICAgfSk7XG4gICAgfTtcbiAgfVxuICBpZiAoIShicm93c2VyRGV0YWlscy52ZXJzaW9uID4gNTUgJiZcbiAgICAgICdhdXRvR2FpbkNvbnRyb2wnIGluIG5hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0U3VwcG9ydGVkQ29uc3RyYWludHMoKSkpIHtcbiAgICB2YXIgcmVtYXAgPSBmdW5jdGlvbihvYmosIGEsIGIpIHtcbiAgICAgIGlmIChhIGluIG9iaiAmJiAhKGIgaW4gb2JqKSkge1xuICAgICAgICBvYmpbYl0gPSBvYmpbYV07XG4gICAgICAgIGRlbGV0ZSBvYmpbYV07XG4gICAgICB9XG4gICAgfTtcblxuICAgIHZhciBuYXRpdmVHZXRVc2VyTWVkaWEgPSBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYS5cbiAgICAgICAgYmluZChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzKTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGMpIHtcbiAgICAgIGlmICh0eXBlb2YgYyA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIGMuYXVkaW8gPT09ICdvYmplY3QnKSB7XG4gICAgICAgIGMgPSBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KGMpKTtcbiAgICAgICAgcmVtYXAoYy5hdWRpbywgJ2F1dG9HYWluQ29udHJvbCcsICdtb3pBdXRvR2FpbkNvbnRyb2wnKTtcbiAgICAgICAgcmVtYXAoYy5hdWRpbywgJ25vaXNlU3VwcHJlc3Npb24nLCAnbW96Tm9pc2VTdXBwcmVzc2lvbicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG5hdGl2ZUdldFVzZXJNZWRpYShjKTtcbiAgICB9O1xuXG4gICAgaWYgKE1lZGlhU3RyZWFtVHJhY2sgJiYgTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUuZ2V0U2V0dGluZ3MpIHtcbiAgICAgIHZhciBuYXRpdmVHZXRTZXR0aW5ncyA9IE1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLmdldFNldHRpbmdzO1xuICAgICAgTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUuZ2V0U2V0dGluZ3MgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG9iaiA9IG5hdGl2ZUdldFNldHRpbmdzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgIHJlbWFwKG9iaiwgJ21vekF1dG9HYWluQ29udHJvbCcsICdhdXRvR2FpbkNvbnRyb2wnKTtcbiAgICAgICAgcmVtYXAob2JqLCAnbW96Tm9pc2VTdXBwcmVzc2lvbicsICdub2lzZVN1cHByZXNzaW9uJyk7XG4gICAgICAgIHJldHVybiBvYmo7XG4gICAgICB9O1xuICAgIH1cblxuICAgIGlmIChNZWRpYVN0cmVhbVRyYWNrICYmIE1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLmFwcGx5Q29uc3RyYWludHMpIHtcbiAgICAgIHZhciBuYXRpdmVBcHBseUNvbnN0cmFpbnRzID0gTWVkaWFTdHJlYW1UcmFjay5wcm90b3R5cGUuYXBwbHlDb25zdHJhaW50cztcbiAgICAgIE1lZGlhU3RyZWFtVHJhY2sucHJvdG90eXBlLmFwcGx5Q29uc3RyYWludHMgPSBmdW5jdGlvbihjKSB7XG4gICAgICAgIGlmICh0aGlzLmtpbmQgPT09ICdhdWRpbycgJiYgdHlwZW9mIGMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgYyA9IEpTT04ucGFyc2UoSlNPTi5zdHJpbmdpZnkoYykpO1xuICAgICAgICAgIHJlbWFwKGMsICdhdXRvR2FpbkNvbnRyb2wnLCAnbW96QXV0b0dhaW5Db250cm9sJyk7XG4gICAgICAgICAgcmVtYXAoYywgJ25vaXNlU3VwcHJlc3Npb24nLCAnbW96Tm9pc2VTdXBwcmVzc2lvbicpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuYXRpdmVBcHBseUNvbnN0cmFpbnRzLmFwcGx5KHRoaXMsIFtjXSk7XG4gICAgICB9O1xuICAgIH1cbiAgfVxuICBuYXZpZ2F0b3IuZ2V0VXNlck1lZGlhID0gZnVuY3Rpb24oY29uc3RyYWludHMsIG9uU3VjY2Vzcywgb25FcnJvcikge1xuICAgIGlmIChicm93c2VyRGV0YWlscy52ZXJzaW9uIDwgNDQpIHtcbiAgICAgIHJldHVybiBnZXRVc2VyTWVkaWFfKGNvbnN0cmFpbnRzLCBvblN1Y2Nlc3MsIG9uRXJyb3IpO1xuICAgIH1cbiAgICAvLyBSZXBsYWNlIEZpcmVmb3ggNDQrJ3MgZGVwcmVjYXRpb24gd2FybmluZyB3aXRoIHVucHJlZml4ZWQgdmVyc2lvbi5cbiAgICB1dGlscy5kZXByZWNhdGVkKCduYXZpZ2F0b3IuZ2V0VXNlck1lZGlhJyxcbiAgICAgICAgJ25hdmlnYXRvci5tZWRpYURldmljZXMuZ2V0VXNlck1lZGlhJyk7XG4gICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEoY29uc3RyYWludHMpLnRoZW4ob25TdWNjZXNzLCBvbkVycm9yKTtcbiAgfTtcbn07XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNiBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcbnZhciB1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWxzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBzaGltTG9jYWxTdHJlYW1zQVBJOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ29iamVjdCcgfHwgIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoISgnZ2V0TG9jYWxTdHJlYW1zJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5nZXRMb2NhbFN0cmVhbXMgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCF0aGlzLl9sb2NhbFN0cmVhbXMpIHtcbiAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMgPSBbXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fbG9jYWxTdHJlYW1zO1xuICAgICAgfTtcbiAgICB9XG4gICAgaWYgKCEoJ2dldFN0cmVhbUJ5SWQnIGluIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUpKSB7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmdldFN0cmVhbUJ5SWQgPSBmdW5jdGlvbihpZCkge1xuICAgICAgICB2YXIgcmVzdWx0ID0gbnVsbDtcbiAgICAgICAgaWYgKHRoaXMuX2xvY2FsU3RyZWFtcykge1xuICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgICAgaWYgKHN0cmVhbS5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgICAgcmVzdWx0ID0gc3RyZWFtO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9yZW1vdGVTdHJlYW1zKSB7XG4gICAgICAgICAgdGhpcy5fcmVtb3RlU3RyZWFtcy5mb3JFYWNoKGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICAgICAgaWYgKHN0cmVhbS5pZCA9PT0gaWQpIHtcbiAgICAgICAgICAgICAgcmVzdWx0ID0gc3RyZWFtO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoISgnYWRkU3RyZWFtJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgdmFyIF9hZGRUcmFjayA9IHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuYWRkVHJhY2s7XG4gICAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmFkZFN0cmVhbSA9IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgICAgICBpZiAoIXRoaXMuX2xvY2FsU3RyZWFtcykge1xuICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9sb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pID09PSAtMSkge1xuICAgICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcy5wdXNoKHN0cmVhbSk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHBjID0gdGhpcztcbiAgICAgICAgc3RyZWFtLmdldFRyYWNrcygpLmZvckVhY2goZnVuY3Rpb24odHJhY2spIHtcbiAgICAgICAgICBfYWRkVHJhY2suY2FsbChwYywgdHJhY2ssIHN0cmVhbSk7XG4gICAgICAgIH0pO1xuICAgICAgfTtcblxuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5hZGRUcmFjayA9IGZ1bmN0aW9uKHRyYWNrLCBzdHJlYW0pIHtcbiAgICAgICAgaWYgKHN0cmVhbSkge1xuICAgICAgICAgIGlmICghdGhpcy5fbG9jYWxTdHJlYW1zKSB7XG4gICAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMgPSBbc3RyZWFtXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2xvY2FsU3RyZWFtcy5pbmRleE9mKHN0cmVhbSkgPT09IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMucHVzaChzdHJlYW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gX2FkZFRyYWNrLmNhbGwodGhpcywgdHJhY2ssIHN0cmVhbSk7XG4gICAgICB9O1xuICAgIH1cbiAgICBpZiAoISgncmVtb3ZlU3RyZWFtJyBpbiB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlKSkge1xuICAgICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZS5yZW1vdmVTdHJlYW0gPSBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgaWYgKCF0aGlzLl9sb2NhbFN0cmVhbXMpIHtcbiAgICAgICAgICB0aGlzLl9sb2NhbFN0cmVhbXMgPSBbXTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgaW5kZXggPSB0aGlzLl9sb2NhbFN0cmVhbXMuaW5kZXhPZihzdHJlYW0pO1xuICAgICAgICBpZiAoaW5kZXggPT09IC0xKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2xvY2FsU3RyZWFtcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICB2YXIgdHJhY2tzID0gc3RyZWFtLmdldFRyYWNrcygpO1xuICAgICAgICB0aGlzLmdldFNlbmRlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgICAgIGlmICh0cmFja3MuaW5kZXhPZihzZW5kZXIudHJhY2spICE9PSAtMSkge1xuICAgICAgICAgICAgcGMucmVtb3ZlVHJhY2soc2VuZGVyKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfTtcbiAgICB9XG4gIH0sXG4gIHNoaW1SZW1vdGVTdHJlYW1zQVBJOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICBpZiAodHlwZW9mIHdpbmRvdyAhPT0gJ29iamVjdCcgfHwgIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoISgnZ2V0UmVtb3RlU3RyZWFtcycgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuZ2V0UmVtb3RlU3RyZWFtcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVtb3RlU3RyZWFtcyA/IHRoaXMuX3JlbW90ZVN0cmVhbXMgOiBbXTtcbiAgICAgIH07XG4gICAgfVxuICAgIGlmICghKCdvbmFkZHN0cmVhbScgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZSkpIHtcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLCAnb25hZGRzdHJlYW0nLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX29uYWRkc3RyZWFtO1xuICAgICAgICB9LFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKGYpIHtcbiAgICAgICAgICB2YXIgcGMgPSB0aGlzO1xuICAgICAgICAgIGlmICh0aGlzLl9vbmFkZHN0cmVhbSkge1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKCdhZGRzdHJlYW0nLCB0aGlzLl9vbmFkZHN0cmVhbSk7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3RyYWNrJywgdGhpcy5fb25hZGRzdHJlYW1wb2x5KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKCdhZGRzdHJlYW0nLCB0aGlzLl9vbmFkZHN0cmVhbSA9IGYpO1xuICAgICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcigndHJhY2snLCB0aGlzLl9vbmFkZHN0cmVhbXBvbHkgPSBmdW5jdGlvbihlKSB7XG4gICAgICAgICAgICBlLnN0cmVhbXMuZm9yRWFjaChmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgICAgaWYgKCFwYy5fcmVtb3RlU3RyZWFtcykge1xuICAgICAgICAgICAgICAgIHBjLl9yZW1vdGVTdHJlYW1zID0gW107XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgaWYgKHBjLl9yZW1vdGVTdHJlYW1zLmluZGV4T2Yoc3RyZWFtKSA+PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIHBjLl9yZW1vdGVTdHJlYW1zLnB1c2goc3RyZWFtKTtcbiAgICAgICAgICAgICAgdmFyIGV2ZW50ID0gbmV3IEV2ZW50KCdhZGRzdHJlYW0nKTtcbiAgICAgICAgICAgICAgZXZlbnQuc3RyZWFtID0gc3RyZWFtO1xuICAgICAgICAgICAgICBwYy5kaXNwYXRjaEV2ZW50KGV2ZW50KTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0sXG4gIHNoaW1DYWxsYmFja3NBUEk6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ICE9PSAnb2JqZWN0JyB8fCAhd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBwcm90b3R5cGUgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlO1xuICAgIHZhciBjcmVhdGVPZmZlciA9IHByb3RvdHlwZS5jcmVhdGVPZmZlcjtcbiAgICB2YXIgY3JlYXRlQW5zd2VyID0gcHJvdG90eXBlLmNyZWF0ZUFuc3dlcjtcbiAgICB2YXIgc2V0TG9jYWxEZXNjcmlwdGlvbiA9IHByb3RvdHlwZS5zZXRMb2NhbERlc2NyaXB0aW9uO1xuICAgIHZhciBzZXRSZW1vdGVEZXNjcmlwdGlvbiA9IHByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbjtcbiAgICB2YXIgYWRkSWNlQ2FuZGlkYXRlID0gcHJvdG90eXBlLmFkZEljZUNhbmRpZGF0ZTtcblxuICAgIHByb3RvdHlwZS5jcmVhdGVPZmZlciA9IGZ1bmN0aW9uKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgb3B0aW9ucyA9IChhcmd1bWVudHMubGVuZ3RoID49IDIpID8gYXJndW1lbnRzWzJdIDogYXJndW1lbnRzWzBdO1xuICAgICAgdmFyIHByb21pc2UgPSBjcmVhdGVPZmZlci5hcHBseSh0aGlzLCBbb3B0aW9uc10pO1xuICAgICAgaWYgKCFmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICB9XG4gICAgICBwcm9taXNlLnRoZW4oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH07XG5cbiAgICBwcm90b3R5cGUuY3JlYXRlQW5zd2VyID0gZnVuY3Rpb24oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBvcHRpb25zID0gKGFyZ3VtZW50cy5sZW5ndGggPj0gMikgPyBhcmd1bWVudHNbMl0gOiBhcmd1bWVudHNbMF07XG4gICAgICB2YXIgcHJvbWlzZSA9IGNyZWF0ZUFuc3dlci5hcHBseSh0aGlzLCBbb3B0aW9uc10pO1xuICAgICAgaWYgKCFmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgICB9XG4gICAgICBwcm9taXNlLnRoZW4oc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH07XG5cbiAgICB2YXIgd2l0aENhbGxiYWNrID0gZnVuY3Rpb24oZGVzY3JpcHRpb24sIHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICB2YXIgcHJvbWlzZSA9IHNldExvY2FsRGVzY3JpcHRpb24uYXBwbHkodGhpcywgW2Rlc2NyaXB0aW9uXSk7XG4gICAgICBpZiAoIWZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICAgIH1cbiAgICAgIHByb21pc2UudGhlbihzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjayk7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfTtcbiAgICBwcm90b3R5cGUuc2V0TG9jYWxEZXNjcmlwdGlvbiA9IHdpdGhDYWxsYmFjaztcblxuICAgIHdpdGhDYWxsYmFjayA9IGZ1bmN0aW9uKGRlc2NyaXB0aW9uLCBzdWNjZXNzQ2FsbGJhY2ssIGZhaWx1cmVDYWxsYmFjaykge1xuICAgICAgdmFyIHByb21pc2UgPSBzZXRSZW1vdGVEZXNjcmlwdGlvbi5hcHBseSh0aGlzLCBbZGVzY3JpcHRpb25dKTtcbiAgICAgIGlmICghZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgICAgfVxuICAgICAgcHJvbWlzZS50aGVuKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9O1xuICAgIHByb3RvdHlwZS5zZXRSZW1vdGVEZXNjcmlwdGlvbiA9IHdpdGhDYWxsYmFjaztcblxuICAgIHdpdGhDYWxsYmFjayA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSwgc3VjY2Vzc0NhbGxiYWNrLCBmYWlsdXJlQ2FsbGJhY2spIHtcbiAgICAgIHZhciBwcm9taXNlID0gYWRkSWNlQ2FuZGlkYXRlLmFwcGx5KHRoaXMsIFtjYW5kaWRhdGVdKTtcbiAgICAgIGlmICghZmFpbHVyZUNhbGxiYWNrKSB7XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgICAgfVxuICAgICAgcHJvbWlzZS50aGVuKHN1Y2Nlc3NDYWxsYmFjaywgZmFpbHVyZUNhbGxiYWNrKTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9O1xuICAgIHByb3RvdHlwZS5hZGRJY2VDYW5kaWRhdGUgPSB3aXRoQ2FsbGJhY2s7XG4gIH0sXG4gIHNoaW1HZXRVc2VyTWVkaWE6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBuYXZpZ2F0b3IgPSB3aW5kb3cgJiYgd2luZG93Lm5hdmlnYXRvcjtcblxuICAgIGlmICghbmF2aWdhdG9yLmdldFVzZXJNZWRpYSkge1xuICAgICAgaWYgKG5hdmlnYXRvci53ZWJraXRHZXRVc2VyTWVkaWEpIHtcbiAgICAgICAgbmF2aWdhdG9yLmdldFVzZXJNZWRpYSA9IG5hdmlnYXRvci53ZWJraXRHZXRVc2VyTWVkaWEuYmluZChuYXZpZ2F0b3IpO1xuICAgICAgfSBlbHNlIGlmIChuYXZpZ2F0b3IubWVkaWFEZXZpY2VzICYmXG4gICAgICAgICAgbmF2aWdhdG9yLm1lZGlhRGV2aWNlcy5nZXRVc2VyTWVkaWEpIHtcbiAgICAgICAgbmF2aWdhdG9yLmdldFVzZXJNZWRpYSA9IGZ1bmN0aW9uKGNvbnN0cmFpbnRzLCBjYiwgZXJyY2IpIHtcbiAgICAgICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShjb25zdHJhaW50cylcbiAgICAgICAgICAudGhlbihjYiwgZXJyY2IpO1xuICAgICAgICB9LmJpbmQobmF2aWdhdG9yKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIHNoaW1SVENJY2VTZXJ2ZXJVcmxzOiBmdW5jdGlvbih3aW5kb3cpIHtcbiAgICAvLyBtaWdyYXRlIGZyb20gbm9uLXNwZWMgUlRDSWNlU2VydmVyLnVybCB0byBSVENJY2VTZXJ2ZXIudXJsc1xuICAgIHZhciBPcmlnUGVlckNvbm5lY3Rpb24gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb247XG4gICAgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uID0gZnVuY3Rpb24ocGNDb25maWcsIHBjQ29uc3RyYWludHMpIHtcbiAgICAgIGlmIChwY0NvbmZpZyAmJiBwY0NvbmZpZy5pY2VTZXJ2ZXJzKSB7XG4gICAgICAgIHZhciBuZXdJY2VTZXJ2ZXJzID0gW107XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGNDb25maWcuaWNlU2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgIHZhciBzZXJ2ZXIgPSBwY0NvbmZpZy5pY2VTZXJ2ZXJzW2ldO1xuICAgICAgICAgIGlmICghc2VydmVyLmhhc093blByb3BlcnR5KCd1cmxzJykgJiZcbiAgICAgICAgICAgICAgc2VydmVyLmhhc093blByb3BlcnR5KCd1cmwnKSkge1xuICAgICAgICAgICAgdXRpbHMuZGVwcmVjYXRlZCgnUlRDSWNlU2VydmVyLnVybCcsICdSVENJY2VTZXJ2ZXIudXJscycpO1xuICAgICAgICAgICAgc2VydmVyID0gSlNPTi5wYXJzZShKU09OLnN0cmluZ2lmeShzZXJ2ZXIpKTtcbiAgICAgICAgICAgIHNlcnZlci51cmxzID0gc2VydmVyLnVybDtcbiAgICAgICAgICAgIGRlbGV0ZSBzZXJ2ZXIudXJsO1xuICAgICAgICAgICAgbmV3SWNlU2VydmVycy5wdXNoKHNlcnZlcik7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG5ld0ljZVNlcnZlcnMucHVzaChwY0NvbmZpZy5pY2VTZXJ2ZXJzW2ldKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcGNDb25maWcuaWNlU2VydmVycyA9IG5ld0ljZVNlcnZlcnM7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IE9yaWdQZWVyQ29ubmVjdGlvbihwY0NvbmZpZywgcGNDb25zdHJhaW50cyk7XG4gICAgfTtcbiAgICB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlID0gT3JpZ1BlZXJDb25uZWN0aW9uLnByb3RvdHlwZTtcbiAgICAvLyB3cmFwIHN0YXRpYyBtZXRob2RzLiBDdXJyZW50bHkganVzdCBnZW5lcmF0ZUNlcnRpZmljYXRlLlxuICAgIGlmICgnZ2VuZXJhdGVDZXJ0aWZpY2F0ZScgaW4gd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uLCAnZ2VuZXJhdGVDZXJ0aWZpY2F0ZScsIHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gT3JpZ1BlZXJDb25uZWN0aW9uLmdlbmVyYXRlQ2VydGlmaWNhdGU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcbiAgc2hpbVRyYWNrRXZlbnRUcmFuc2NlaXZlcjogZnVuY3Rpb24od2luZG93KSB7XG4gICAgLy8gQWRkIGV2ZW50LnRyYW5zY2VpdmVyIG1lbWJlciBvdmVyIGRlcHJlY2F0ZWQgZXZlbnQucmVjZWl2ZXJcbiAgICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ29iamVjdCcgJiYgd2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgICgncmVjZWl2ZXInIGluIHdpbmRvdy5SVENUcmFja0V2ZW50LnByb3RvdHlwZSkgJiZcbiAgICAgICAgLy8gY2FuJ3QgY2hlY2sgJ3RyYW5zY2VpdmVyJyBpbiB3aW5kb3cuUlRDVHJhY2tFdmVudC5wcm90b3R5cGUsIGFzIGl0IGlzXG4gICAgICAgIC8vIGRlZmluZWQgZm9yIHNvbWUgcmVhc29uIGV2ZW4gd2hlbiB3aW5kb3cuUlRDVHJhbnNjZWl2ZXIgaXMgbm90LlxuICAgICAgICAhd2luZG93LlJUQ1RyYW5zY2VpdmVyKSB7XG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkod2luZG93LlJUQ1RyYWNrRXZlbnQucHJvdG90eXBlLCAndHJhbnNjZWl2ZXInLCB7XG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIHtyZWNlaXZlcjogdGhpcy5yZWNlaXZlcn07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSxcblxuICBzaGltQ3JlYXRlT2ZmZXJMZWdhY3k6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBvcmlnQ3JlYXRlT2ZmZXIgPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlLmNyZWF0ZU9mZmVyO1xuICAgIHdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbi5wcm90b3R5cGUuY3JlYXRlT2ZmZXIgPSBmdW5jdGlvbihvZmZlck9wdGlvbnMpIHtcbiAgICAgIHZhciBwYyA9IHRoaXM7XG4gICAgICBpZiAob2ZmZXJPcHRpb25zKSB7XG4gICAgICAgIGlmICh0eXBlb2Ygb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgLy8gc3VwcG9ydCBiaXQgdmFsdWVzXG4gICAgICAgICAgb2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gPSAhIW9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvO1xuICAgICAgICB9XG4gICAgICAgIHZhciBhdWRpb1RyYW5zY2VpdmVyID0gcGMuZ2V0VHJhbnNjZWl2ZXJzKCkuZmluZChmdW5jdGlvbih0cmFuc2NlaXZlcikge1xuICAgICAgICAgIHJldHVybiB0cmFuc2NlaXZlci5zZW5kZXIudHJhY2sgJiZcbiAgICAgICAgICAgICAgdHJhbnNjZWl2ZXIuc2VuZGVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbyc7XG4gICAgICAgIH0pO1xuICAgICAgICBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlQXVkaW8gPT09IGZhbHNlICYmIGF1ZGlvVHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICBpZiAoYXVkaW9UcmFuc2NlaXZlci5kaXJlY3Rpb24gPT09ICdzZW5kcmVjdicpIHtcbiAgICAgICAgICAgIGlmIChhdWRpb1RyYW5zY2VpdmVyLnNldERpcmVjdGlvbikge1xuICAgICAgICAgICAgICBhdWRpb1RyYW5zY2VpdmVyLnNldERpcmVjdGlvbignc2VuZG9ubHknKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGF1ZGlvVHJhbnNjZWl2ZXIuZGlyZWN0aW9uID0gJ3NlbmRvbmx5JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9IGVsc2UgaWYgKGF1ZGlvVHJhbnNjZWl2ZXIuZGlyZWN0aW9uID09PSAncmVjdm9ubHknKSB7XG4gICAgICAgICAgICBpZiAoYXVkaW9UcmFuc2NlaXZlci5zZXREaXJlY3Rpb24pIHtcbiAgICAgICAgICAgICAgYXVkaW9UcmFuc2NlaXZlci5zZXREaXJlY3Rpb24oJ2luYWN0aXZlJyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBhdWRpb1RyYW5zY2VpdmVyLmRpcmVjdGlvbiA9ICdpbmFjdGl2ZSc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvID09PSB0cnVlICYmXG4gICAgICAgICAgICAhYXVkaW9UcmFuc2NlaXZlcikge1xuICAgICAgICAgIHBjLmFkZFRyYW5zY2VpdmVyKCdhdWRpbycpO1xuICAgICAgICB9XG5cblxuICAgICAgICBpZiAodHlwZW9mIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZUF1ZGlvICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIC8vIHN1cHBvcnQgYml0IHZhbHVlc1xuICAgICAgICAgIG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID0gISFvZmZlck9wdGlvbnMub2ZmZXJUb1JlY2VpdmVWaWRlbztcbiAgICAgICAgfVxuICAgICAgICB2YXIgdmlkZW9UcmFuc2NlaXZlciA9IHBjLmdldFRyYW5zY2VpdmVycygpLmZpbmQoZnVuY3Rpb24odHJhbnNjZWl2ZXIpIHtcbiAgICAgICAgICByZXR1cm4gdHJhbnNjZWl2ZXIuc2VuZGVyLnRyYWNrICYmXG4gICAgICAgICAgICAgIHRyYW5zY2VpdmVyLnNlbmRlci50cmFjay5raW5kID09PSAndmlkZW8nO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG9mZmVyT3B0aW9ucy5vZmZlclRvUmVjZWl2ZVZpZGVvID09PSBmYWxzZSAmJiB2aWRlb1RyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgaWYgKHZpZGVvVHJhbnNjZWl2ZXIuZGlyZWN0aW9uID09PSAnc2VuZHJlY3YnKSB7XG4gICAgICAgICAgICB2aWRlb1RyYW5zY2VpdmVyLnNldERpcmVjdGlvbignc2VuZG9ubHknKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKHZpZGVvVHJhbnNjZWl2ZXIuZGlyZWN0aW9uID09PSAncmVjdm9ubHknKSB7XG4gICAgICAgICAgICB2aWRlb1RyYW5zY2VpdmVyLnNldERpcmVjdGlvbignaW5hY3RpdmUnKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob2ZmZXJPcHRpb25zLm9mZmVyVG9SZWNlaXZlVmlkZW8gPT09IHRydWUgJiZcbiAgICAgICAgICAgICF2aWRlb1RyYW5zY2VpdmVyKSB7XG4gICAgICAgICAgcGMuYWRkVHJhbnNjZWl2ZXIoJ3ZpZGVvJyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHJldHVybiBvcmlnQ3JlYXRlT2ZmZXIuYXBwbHkocGMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfVxufTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE2IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuIC8qIGVzbGludC1lbnYgbm9kZSAqL1xuJ3VzZSBzdHJpY3QnO1xuXG52YXIgbG9nRGlzYWJsZWRfID0gdHJ1ZTtcbnZhciBkZXByZWNhdGlvbldhcm5pbmdzXyA9IHRydWU7XG5cbi8qKlxuICogRXh0cmFjdCBicm93c2VyIHZlcnNpb24gb3V0IG9mIHRoZSBwcm92aWRlZCB1c2VyIGFnZW50IHN0cmluZy5cbiAqXG4gKiBAcGFyYW0geyFzdHJpbmd9IHVhc3RyaW5nIHVzZXJBZ2VudCBzdHJpbmcuXG4gKiBAcGFyYW0geyFzdHJpbmd9IGV4cHIgUmVndWxhciBleHByZXNzaW9uIHVzZWQgYXMgbWF0Y2ggY3JpdGVyaWEuXG4gKiBAcGFyYW0geyFudW1iZXJ9IHBvcyBwb3NpdGlvbiBpbiB0aGUgdmVyc2lvbiBzdHJpbmcgdG8gYmUgcmV0dXJuZWQuXG4gKiBAcmV0dXJuIHshbnVtYmVyfSBicm93c2VyIHZlcnNpb24uXG4gKi9cbmZ1bmN0aW9uIGV4dHJhY3RWZXJzaW9uKHVhc3RyaW5nLCBleHByLCBwb3MpIHtcbiAgdmFyIG1hdGNoID0gdWFzdHJpbmcubWF0Y2goZXhwcik7XG4gIHJldHVybiBtYXRjaCAmJiBtYXRjaC5sZW5ndGggPj0gcG9zICYmIHBhcnNlSW50KG1hdGNoW3Bvc10sIDEwKTtcbn1cblxuLy8gV3JhcHMgdGhlIHBlZXJjb25uZWN0aW9uIGV2ZW50IGV2ZW50TmFtZVRvV3JhcCBpbiBhIGZ1bmN0aW9uXG4vLyB3aGljaCByZXR1cm5zIHRoZSBtb2RpZmllZCBldmVudCBvYmplY3QuXG5mdW5jdGlvbiB3cmFwUGVlckNvbm5lY3Rpb25FdmVudCh3aW5kb3csIGV2ZW50TmFtZVRvV3JhcCwgd3JhcHBlcikge1xuICBpZiAoIXdpbmRvdy5SVENQZWVyQ29ubmVjdGlvbikge1xuICAgIHJldHVybjtcbiAgfVxuICB2YXIgcHJvdG8gPSB3aW5kb3cuUlRDUGVlckNvbm5lY3Rpb24ucHJvdG90eXBlO1xuICB2YXIgbmF0aXZlQWRkRXZlbnRMaXN0ZW5lciA9IHByb3RvLmFkZEV2ZW50TGlzdGVuZXI7XG4gIHByb3RvLmFkZEV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihuYXRpdmVFdmVudE5hbWUsIGNiKSB7XG4gICAgaWYgKG5hdGl2ZUV2ZW50TmFtZSAhPT0gZXZlbnROYW1lVG9XcmFwKSB7XG4gICAgICByZXR1cm4gbmF0aXZlQWRkRXZlbnRMaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgICB2YXIgd3JhcHBlZENhbGxiYWNrID0gZnVuY3Rpb24oZSkge1xuICAgICAgY2Iod3JhcHBlcihlKSk7XG4gICAgfTtcbiAgICB0aGlzLl9ldmVudE1hcCA9IHRoaXMuX2V2ZW50TWFwIHx8IHt9O1xuICAgIHRoaXMuX2V2ZW50TWFwW2NiXSA9IHdyYXBwZWRDYWxsYmFjaztcbiAgICByZXR1cm4gbmF0aXZlQWRkRXZlbnRMaXN0ZW5lci5hcHBseSh0aGlzLCBbbmF0aXZlRXZlbnROYW1lLFxuICAgICAgd3JhcHBlZENhbGxiYWNrXSk7XG4gIH07XG5cbiAgdmFyIG5hdGl2ZVJlbW92ZUV2ZW50TGlzdGVuZXIgPSBwcm90by5yZW1vdmVFdmVudExpc3RlbmVyO1xuICBwcm90by5yZW1vdmVFdmVudExpc3RlbmVyID0gZnVuY3Rpb24obmF0aXZlRXZlbnROYW1lLCBjYikge1xuICAgIGlmIChuYXRpdmVFdmVudE5hbWUgIT09IGV2ZW50TmFtZVRvV3JhcCB8fCAhdGhpcy5fZXZlbnRNYXBcbiAgICAgICAgfHwgIXRoaXMuX2V2ZW50TWFwW2NiXSkge1xuICAgICAgcmV0dXJuIG5hdGl2ZVJlbW92ZUV2ZW50TGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gICAgdmFyIHVud3JhcHBlZENiID0gdGhpcy5fZXZlbnRNYXBbY2JdO1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudE1hcFtjYl07XG4gICAgcmV0dXJuIG5hdGl2ZVJlbW92ZUV2ZW50TGlzdGVuZXIuYXBwbHkodGhpcywgW25hdGl2ZUV2ZW50TmFtZSxcbiAgICAgIHVud3JhcHBlZENiXSk7XG4gIH07XG5cbiAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHByb3RvLCAnb24nICsgZXZlbnROYW1lVG9XcmFwLCB7XG4gICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzWydfb24nICsgZXZlbnROYW1lVG9XcmFwXTtcbiAgICB9LFxuICAgIHNldDogZnVuY3Rpb24oY2IpIHtcbiAgICAgIGlmICh0aGlzWydfb24nICsgZXZlbnROYW1lVG9XcmFwXSkge1xuICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lVG9XcmFwLFxuICAgICAgICAgICAgdGhpc1snX29uJyArIGV2ZW50TmFtZVRvV3JhcF0pO1xuICAgICAgICBkZWxldGUgdGhpc1snX29uJyArIGV2ZW50TmFtZVRvV3JhcF07XG4gICAgICB9XG4gICAgICBpZiAoY2IpIHtcbiAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZVRvV3JhcCxcbiAgICAgICAgICAgIHRoaXNbJ19vbicgKyBldmVudE5hbWVUb1dyYXBdID0gY2IpO1xuICAgICAgfVxuICAgIH0sXG4gICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICBjb25maWd1cmFibGU6IHRydWVcbiAgfSk7XG59XG5cbi8vIFV0aWxpdHkgbWV0aG9kcy5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBleHRyYWN0VmVyc2lvbjogZXh0cmFjdFZlcnNpb24sXG4gIHdyYXBQZWVyQ29ubmVjdGlvbkV2ZW50OiB3cmFwUGVlckNvbm5lY3Rpb25FdmVudCxcbiAgZGlzYWJsZUxvZzogZnVuY3Rpb24oYm9vbCkge1xuICAgIGlmICh0eXBlb2YgYm9vbCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICByZXR1cm4gbmV3IEVycm9yKCdBcmd1bWVudCB0eXBlOiAnICsgdHlwZW9mIGJvb2wgK1xuICAgICAgICAgICcuIFBsZWFzZSB1c2UgYSBib29sZWFuLicpO1xuICAgIH1cbiAgICBsb2dEaXNhYmxlZF8gPSBib29sO1xuICAgIHJldHVybiAoYm9vbCkgPyAnYWRhcHRlci5qcyBsb2dnaW5nIGRpc2FibGVkJyA6XG4gICAgICAgICdhZGFwdGVyLmpzIGxvZ2dpbmcgZW5hYmxlZCc7XG4gIH0sXG5cbiAgLyoqXG4gICAqIERpc2FibGUgb3IgZW5hYmxlIGRlcHJlY2F0aW9uIHdhcm5pbmdzXG4gICAqIEBwYXJhbSB7IWJvb2xlYW59IGJvb2wgc2V0IHRvIHRydWUgdG8gZGlzYWJsZSB3YXJuaW5ncy5cbiAgICovXG4gIGRpc2FibGVXYXJuaW5nczogZnVuY3Rpb24oYm9vbCkge1xuICAgIGlmICh0eXBlb2YgYm9vbCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICByZXR1cm4gbmV3IEVycm9yKCdBcmd1bWVudCB0eXBlOiAnICsgdHlwZW9mIGJvb2wgK1xuICAgICAgICAgICcuIFBsZWFzZSB1c2UgYSBib29sZWFuLicpO1xuICAgIH1cbiAgICBkZXByZWNhdGlvbldhcm5pbmdzXyA9ICFib29sO1xuICAgIHJldHVybiAnYWRhcHRlci5qcyBkZXByZWNhdGlvbiB3YXJuaW5ncyAnICsgKGJvb2wgPyAnZGlzYWJsZWQnIDogJ2VuYWJsZWQnKTtcbiAgfSxcblxuICBsb2c6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAnb2JqZWN0Jykge1xuICAgICAgaWYgKGxvZ0Rpc2FibGVkXykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAodHlwZW9mIGNvbnNvbGUgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBjb25zb2xlLmxvZyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBjb25zb2xlLmxvZy5hcHBseShjb25zb2xlLCBhcmd1bWVudHMpO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogU2hvd3MgYSBkZXByZWNhdGlvbiB3YXJuaW5nIHN1Z2dlc3RpbmcgdGhlIG1vZGVybiBhbmQgc3BlYy1jb21wYXRpYmxlIEFQSS5cbiAgICovXG4gIGRlcHJlY2F0ZWQ6IGZ1bmN0aW9uKG9sZE1ldGhvZCwgbmV3TWV0aG9kKSB7XG4gICAgaWYgKCFkZXByZWNhdGlvbldhcm5pbmdzXykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLndhcm4ob2xkTWV0aG9kICsgJyBpcyBkZXByZWNhdGVkLCBwbGVhc2UgdXNlICcgKyBuZXdNZXRob2QgK1xuICAgICAgICAnIGluc3RlYWQuJyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEJyb3dzZXIgZGV0ZWN0b3IuXG4gICAqXG4gICAqIEByZXR1cm4ge29iamVjdH0gcmVzdWx0IGNvbnRhaW5pbmcgYnJvd3NlciBhbmQgdmVyc2lvblxuICAgKiAgICAgcHJvcGVydGllcy5cbiAgICovXG4gIGRldGVjdEJyb3dzZXI6IGZ1bmN0aW9uKHdpbmRvdykge1xuICAgIHZhciBuYXZpZ2F0b3IgPSB3aW5kb3cgJiYgd2luZG93Lm5hdmlnYXRvcjtcblxuICAgIC8vIFJldHVybmVkIHJlc3VsdCBvYmplY3QuXG4gICAgdmFyIHJlc3VsdCA9IHt9O1xuICAgIHJlc3VsdC5icm93c2VyID0gbnVsbDtcbiAgICByZXN1bHQudmVyc2lvbiA9IG51bGw7XG5cbiAgICAvLyBGYWlsIGVhcmx5IGlmIGl0J3Mgbm90IGEgYnJvd3NlclxuICAgIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJyB8fCAhd2luZG93Lm5hdmlnYXRvcikge1xuICAgICAgcmVzdWx0LmJyb3dzZXIgPSAnTm90IGEgYnJvd3Nlci4nO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9XG5cbiAgICBpZiAobmF2aWdhdG9yLm1vekdldFVzZXJNZWRpYSkgeyAvLyBGaXJlZm94LlxuICAgICAgcmVzdWx0LmJyb3dzZXIgPSAnZmlyZWZveCc7XG4gICAgICByZXN1bHQudmVyc2lvbiA9IGV4dHJhY3RWZXJzaW9uKG5hdmlnYXRvci51c2VyQWdlbnQsXG4gICAgICAgICAgL0ZpcmVmb3hcXC8oXFxkKylcXC4vLCAxKTtcbiAgICB9IGVsc2UgaWYgKG5hdmlnYXRvci53ZWJraXRHZXRVc2VyTWVkaWEpIHtcbiAgICAgIC8vIENocm9tZSwgQ2hyb21pdW0sIFdlYnZpZXcsIE9wZXJhLlxuICAgICAgLy8gVmVyc2lvbiBtYXRjaGVzIENocm9tZS9XZWJSVEMgdmVyc2lvbi5cbiAgICAgIHJlc3VsdC5icm93c2VyID0gJ2Nocm9tZSc7XG4gICAgICByZXN1bHQudmVyc2lvbiA9IGV4dHJhY3RWZXJzaW9uKG5hdmlnYXRvci51c2VyQWdlbnQsXG4gICAgICAgICAgL0Nocm9tKGV8aXVtKVxcLyhcXGQrKVxcLi8sIDIpO1xuICAgIH0gZWxzZSBpZiAobmF2aWdhdG9yLm1lZGlhRGV2aWNlcyAmJlxuICAgICAgICBuYXZpZ2F0b3IudXNlckFnZW50Lm1hdGNoKC9FZGdlXFwvKFxcZCspLihcXGQrKSQvKSkgeyAvLyBFZGdlLlxuICAgICAgcmVzdWx0LmJyb3dzZXIgPSAnZWRnZSc7XG4gICAgICByZXN1bHQudmVyc2lvbiA9IGV4dHJhY3RWZXJzaW9uKG5hdmlnYXRvci51c2VyQWdlbnQsXG4gICAgICAgICAgL0VkZ2VcXC8oXFxkKykuKFxcZCspJC8sIDIpO1xuICAgIH0gZWxzZSBpZiAod2luZG93LlJUQ1BlZXJDb25uZWN0aW9uICYmXG4gICAgICAgIG5hdmlnYXRvci51c2VyQWdlbnQubWF0Y2goL0FwcGxlV2ViS2l0XFwvKFxcZCspXFwuLykpIHsgLy8gU2FmYXJpLlxuICAgICAgcmVzdWx0LmJyb3dzZXIgPSAnc2FmYXJpJztcbiAgICAgIHJlc3VsdC52ZXJzaW9uID0gZXh0cmFjdFZlcnNpb24obmF2aWdhdG9yLnVzZXJBZ2VudCxcbiAgICAgICAgICAvQXBwbGVXZWJLaXRcXC8oXFxkKylcXC4vLCAxKTtcbiAgICB9IGVsc2UgeyAvLyBEZWZhdWx0IGZhbGx0aHJvdWdoOiBub3Qgc3VwcG9ydGVkLlxuICAgICAgcmVzdWx0LmJyb3dzZXIgPSAnTm90IGEgc3VwcG9ydGVkIGJyb3dzZXIuJztcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuaW1wb3J0IE1pY1Rlc3QgZnJvbSAnLi4vdW5pdC9taWMuanMnO1xuaW1wb3J0IFJ1bkNvbm5lY3Rpdml0eVRlc3QgZnJvbSAnLi4vdW5pdC9jb25uLmpzJztcbmltcG9ydCBDYW1SZXNvbHV0aW9uc1Rlc3QgZnJvbSAnLi4vdW5pdC9jYW1yZXNvbHV0aW9ucy5qcyc7XG5pbXBvcnQgTmV0d29ya1Rlc3QgZnJvbSAnLi4vdW5pdC9uZXQuanMnO1xuaW1wb3J0IERhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QgZnJvbSAnLi4vdW5pdC9kYXRhQmFuZHdpZHRoLmpzJztcbmltcG9ydCBWaWRlb0JhbmR3aWR0aFRlc3QgZnJvbSAnLi4vdW5pdC92aWRlb0JhbmR3aWR0aC5qcyc7XG5pbXBvcnQgV2lGaVBlcmlvZGljU2NhblRlc3QgZnJvbSAnLi4vdW5pdC93aWZpUGVyaW9kaWNTY2FuLmpzJztcbmltcG9ydCBDYWxsIGZyb20gJy4uL3V0aWwvY2FsbC5qcyc7XG5cbmltcG9ydCBTdWl0ZSBmcm9tICcuL3N1aXRlLmpzJztcbmltcG9ydCBUZXN0Q2FzZSBmcm9tICcuL3Rlc3RDYXNlLmpzJztcblxuZXhwb3J0IGNvbnN0IFRFU1RTID0ge1xuICBBVURJT0NBUFRVUkU6ICdBdWRpbyBjYXB0dXJlJyxcbiAgQ0hFQ0tSRVNPTFVUSU9OMjQwOiAnQ2hlY2sgcmVzb2x1dGlvbiAzMjB4MjQwJyxcbiAgQ0hFQ0tSRVNPTFVUSU9ONDgwOiAnQ2hlY2sgcmVzb2x1dGlvbiA2NDB4NDgwJyxcbiAgQ0hFQ0tSRVNPTFVUSU9ONzIwOiAnQ2hlY2sgcmVzb2x1dGlvbiAxMjgweDcyMCcsXG4gIENIRUNLU1VQUE9SVEVEUkVTT0xVVElPTlM6ICdDaGVjayBzdXBwb3J0ZWQgcmVzb2x1dGlvbnMnLFxuICBEQVRBVEhST1VHSFBVVDogJ0RhdGEgdGhyb3VnaHB1dCcsXG4gIElQVjZFTkFCTEVEOiAnSXB2NiBlbmFibGVkJyxcbiAgTkVUV09SS0xBVEVOQ1k6ICdOZXR3b3JrIGxhdGVuY3knLFxuICBORVRXT1JLTEFURU5DWVJFTEFZOiAnTmV0d29yayBsYXRlbmN5IC0gUmVsYXknLFxuICBVRFBFTkFCTEVEOiAnVWRwIGVuYWJsZWQnLFxuICBUQ1BFTkFCTEVEOiAnVGNwIGVuYWJsZWQnLFxuICBWSURFT0JBTkRXSURUSDogJ1ZpZGVvIGJhbmR3aWR0aCcsXG4gIFJFTEFZQ09OTkVDVElWSVRZOiAnUmVsYXkgY29ubmVjdGl2aXR5JyxcbiAgUkVGTEVYSVZFQ09OTkVDVElWSVRZOiAnUmVmbGV4aXZlIGNvbm5lY3Rpdml0eScsXG4gIEhPU1RDT05ORUNUSVZJVFk6ICdIb3N0IGNvbm5lY3Rpdml0eSdcbn07XG5cbmV4cG9ydCBjb25zdCBTVUlURVMgPSB7XG4gICAgQ0FNRVJBOiAnQ2FtZXJhJyxcbiAgICBNSUNST1BIT05FOiAnTWljcm9waG9uZScsXG4gICAgTkVUV09SSzogJ05ldHdvcmsnLFxuICAgIENPTk5FQ1RJVklUWTogJ0Nvbm5lY3Rpdml0eScsXG4gICAgVEhST1VHSFBVVDogJ1Rocm91Z2hwdXQnXG4gIH07XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE1pY3JvU3VpdGUoY29uZmlnLCBmaWx0ZXIpIHtcbiAgY29uc3QgbWljU3VpdGUgPSBuZXcgU3VpdGUoU1VJVEVTLk1JQ1JPUEhPTkUsIGNvbmZpZyk7XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuQVVESU9DQVBUVVJFKSkge1xuICAgIG1pY1N1aXRlLmFkZChuZXcgVGVzdENhc2UobWljU3VpdGUsIFRFU1RTLkFVRElPQ0FQVFVSRSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBtaWNUZXN0ID0gbmV3IE1pY1Rlc3QodGVzdCk7XG4gICAgICBtaWNUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIHJldHVybiBtaWNTdWl0ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ2FtZXJhU3VpdGUoY29uZmlnKSB7XG4gIGNvbnN0IGNhbWVyYVN1aXRlID0gbmV3IFN1aXRlKFNVSVRFUy5DQU1FUkEsIGNvbmZpZyk7XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuQ0hFQ0tSRVNPTFVUSU9OMjQwKSkge1xuICAgIGNhbWVyYVN1aXRlLmFkZChuZXcgVGVzdENhc2UoY2FtZXJhU3VpdGUsIFRFU1RTLkNIRUNLUkVTT0xVVElPTjI0MCwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBjYW1SZXNvbHV0aW9uc1Rlc3QgPSBuZXcgQ2FtUmVzb2x1dGlvbnNUZXN0KHRlc3QgLCBbWzMyMCwgMjQwXV0pO1xuICAgICAgY2FtUmVzb2x1dGlvbnNUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLkNIRUNLUkVTT0xVVElPTjQ4MCkpIHtcbiAgICBjYW1lcmFTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNhbWVyYVN1aXRlLCBURVNUUy5DSEVDS1JFU09MVVRJT040ODAsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgY2FtUmVzb2x1dGlvbnNUZXN0ID0gbmV3IENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCBbWzY0MCwgNDgwXV0pO1xuICAgICAgY2FtUmVzb2x1dGlvbnNUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLkNIRUNLUkVTT0xVVElPTjcyMCkpIHtcbiAgICBjYW1lcmFTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNhbWVyYVN1aXRlLCBURVNUUy5DSEVDS1JFU09MVVRJT043MjAsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgY2FtUmVzb2x1dGlvbnNUZXN0ID0gbmV3IENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCBbWzEyODAsIDcyMF1dKTtcbiAgICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5DSEVDS1NVUFBPUlRFRFJFU09MVVRJT05TKSkge1xuICAgIGNhbWVyYVN1aXRlLmFkZChuZXcgVGVzdENhc2UoY2FtZXJhU3VpdGUsIFRFU1RTLkNIRUNLU1VQUE9SVEVEUkVTT0xVVElPTlMsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgcmVzb2x1dGlvbkFycmF5ID0gW1xuICAgICAgICBbMTYwLCAxMjBdLCBbMzIwLCAxODBdLCBbMzIwLCAyNDBdLCBbNjQwLCAzNjBdLCBbNjQwLCA0ODBdLCBbNzY4LCA1NzZdLFxuICAgICAgICBbMTAyNCwgNTc2XSwgWzEyODAsIDcyMF0sIFsxMjgwLCA3NjhdLCBbMTI4MCwgODAwXSwgWzE5MjAsIDEwODBdLFxuICAgICAgICBbMTkyMCwgMTIwMF0sIFszODQwLCAyMTYwXSwgWzQwOTYsIDIxNjBdXG4gICAgICBdO1xuICAgICAgdmFyIGNhbVJlc29sdXRpb25zVGVzdCA9IG5ldyBDYW1SZXNvbHV0aW9uc1Rlc3QodGVzdCwgcmVzb2x1dGlvbkFycmF5KTtcbiAgICAgIGNhbVJlc29sdXRpb25zVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICByZXR1cm4gY2FtZXJhU3VpdGU7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBidWlsZE5ldHdvcmtTdWl0ZShjb25maWcpIHtcbiAgY29uc3QgbmV0d29ya1N1aXRlID0gbmV3IFN1aXRlKFNVSVRFUy5ORVRXT1JLLCBjb25maWcpO1xuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLlVEUEVOQUJMRUQpKSB7XG4gICAgLy8gVGVzdCB3aGV0aGVyIGl0IGNhbiBjb25uZWN0IHZpYSBVRFAgdG8gYSBUVVJOIHNlcnZlclxuICAgIC8vIEdldCBhIFRVUk4gY29uZmlnLCBhbmQgdHJ5IHRvIGdldCBhIHJlbGF5IGNhbmRpZGF0ZSB1c2luZyBVRFAuXG4gICAgbmV0d29ya1N1aXRlLmFkZChuZXcgVGVzdENhc2UobmV0d29ya1N1aXRlLCBURVNUUy5VRFBFTkFCTEVELCAodGVzdCkgPT4ge1xuICAgICAgdmFyIG5ldHdvcmtUZXN0ID0gbmV3IE5ldHdvcmtUZXN0KHRlc3QsICd1ZHAnLCBudWxsLCBDYWxsLmlzUmVsYXkpO1xuICAgICAgbmV0d29ya1Rlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuVENQRU5BQkxFRCkpIHtcbiAgICAvLyBUZXN0IHdoZXRoZXIgaXQgY2FuIGNvbm5lY3QgdmlhIFRDUCB0byBhIFRVUk4gc2VydmVyXG4gICAgLy8gR2V0IGEgVFVSTiBjb25maWcsIGFuZCB0cnkgdG8gZ2V0IGEgcmVsYXkgY2FuZGlkYXRlIHVzaW5nIFRDUC5cbiAgICBuZXR3b3JrU3VpdGUuYWRkKG5ldyBUZXN0Q2FzZShuZXR3b3JrU3VpdGUsIFRFU1RTLlRDUEVOQUJMRUQsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgbmV0d29ya1Rlc3QgPSBuZXcgTmV0d29ya1Rlc3QodGVzdCwgJ3RjcCcsIG51bGwsIENhbGwuaXNSZWxheSk7XG4gICAgICBuZXR3b3JrVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5JUFY2RU5BQkxFRCkpIHtcbiAgICAvLyBUZXN0IHdoZXRoZXIgaXQgaXMgSVB2NiBlbmFibGVkIChUT0RPOiB0ZXN0IElQdjYgdG8gYSBkZXN0aW5hdGlvbikuXG4gICAgLy8gVHVybiBvbiBJUHY2LCBhbmQgdHJ5IHRvIGdldCBhbiBJUHY2IGhvc3QgY2FuZGlkYXRlLlxuICAgIG5ldHdvcmtTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKG5ldHdvcmtTdWl0ZSwgVEVTVFMuSVBWNkVOQUJMRUQsICh0ZXN0KSA9PiB7XG4gICAgICB2YXIgcGFyYW1zID0ge29wdGlvbmFsOiBbe2dvb2dJUHY2OiB0cnVlfV19O1xuICAgICAgdmFyIG5ldHdvcmtUZXN0ID0gbmV3IE5ldHdvcmtUZXN0KHRlc3QsIG51bGwsIHBhcmFtcywgQ2FsbC5pc0lwdjYpO1xuICAgICAgbmV0d29ya1Rlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgcmV0dXJuIG5ldHdvcmtTdWl0ZTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQ29ubmVjdGl2aXR5U3VpdGUoY29uZmlnKSB7XG4gIGNvbnN0IGNvbm5lY3Rpdml0eVN1aXRlID0gbmV3IFN1aXRlKFNVSVRFUy5DT05ORUNUSVZJVFksIGNvbmZpZyk7XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuUkVMQVlDT05ORUNUSVZJVFkpKSB7XG4gICAgLy8gU2V0IHVwIGEgZGF0YWNoYW5uZWwgYmV0d2VlbiB0d28gcGVlcnMgdGhyb3VnaCBhIHJlbGF5XG4gICAgLy8gYW5kIHZlcmlmeSBkYXRhIGNhbiBiZSB0cmFuc21pdHRlZCBhbmQgcmVjZWl2ZWRcbiAgICAvLyAocGFja2V0cyB0cmF2ZWwgdGhyb3VnaCB0aGUgcHVibGljIGludGVybmV0KVxuICAgIGNvbm5lY3Rpdml0eVN1aXRlLmFkZChuZXcgVGVzdENhc2UoY29ubmVjdGl2aXR5U3VpdGUsIFRFU1RTLlJFTEFZQ09OTkVDVElWSVRZLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHJ1bkNvbm5lY3Rpdml0eVRlc3QgPSBuZXcgUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBDYWxsLmlzUmVsYXkpO1xuICAgICAgcnVuQ29ubmVjdGl2aXR5VGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5SRUZMRVhJVkVDT05ORUNUSVZJVFkpKSB7XG4gICAgLy8gU2V0IHVwIGEgZGF0YWNoYW5uZWwgYmV0d2VlbiB0d28gcGVlcnMgdGhyb3VnaCBhIHB1YmxpYyBJUCBhZGRyZXNzXG4gICAgLy8gYW5kIHZlcmlmeSBkYXRhIGNhbiBiZSB0cmFuc21pdHRlZCBhbmQgcmVjZWl2ZWRcbiAgICAvLyAocGFja2V0cyBzaG91bGQgc3RheSBvbiB0aGUgbGluayBpZiBiZWhpbmQgYSByb3V0ZXIgZG9pbmcgTkFUKVxuICAgIGNvbm5lY3Rpdml0eVN1aXRlLmFkZChuZXcgVGVzdENhc2UoY29ubmVjdGl2aXR5U3VpdGUsIFRFU1RTLlJFRkxFWElWRUNPTk5FQ1RJVklUWSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciBydW5Db25uZWN0aXZpdHlUZXN0ID0gbmV3IFJ1bkNvbm5lY3Rpdml0eVRlc3QodGVzdCwgQ2FsbC5pc1JlZmxleGl2ZSk7XG4gICAgICBydW5Db25uZWN0aXZpdHlUZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLkhPU1RDT05ORUNUSVZJVFkpKSB7XG4gICAgLy8gU2V0IHVwIGEgZGF0YWNoYW5uZWwgYmV0d2VlbiB0d28gcGVlcnMgdGhyb3VnaCBhIGxvY2FsIElQIGFkZHJlc3NcbiAgICAvLyBhbmQgdmVyaWZ5IGRhdGEgY2FuIGJlIHRyYW5zbWl0dGVkIGFuZCByZWNlaXZlZFxuICAgIC8vIChwYWNrZXRzIHNob3VsZCBub3QgbGVhdmUgdGhlIG1hY2hpbmUgcnVubmluZyB0aGUgdGVzdClcbiAgICBjb25uZWN0aXZpdHlTdWl0ZS5hZGQobmV3IFRlc3RDYXNlKGNvbm5lY3Rpdml0eVN1aXRlLCBURVNUUy5IT1NUQ09OTkVDVElWSVRZLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHJ1bkNvbm5lY3Rpdml0eVRlc3QgPSBuZXcgUnVuQ29ubmVjdGl2aXR5VGVzdCh0ZXN0LCBDYWxsLmlzSG9zdCk7XG4gICAgICBydW5Db25uZWN0aXZpdHlUZXN0LnN0YXJ0KCk7XG4gICAgfSkpO1xuICB9XG5cbiAgcmV0dXJuIGNvbm5lY3Rpdml0eVN1aXRlO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRUaHJvdWdocHV0U3VpdGUoY29uZmlnKSB7XG4gIGNvbnN0IHRocm91Z2hwdXRTdWl0ZSA9IG5ldyBTdWl0ZShTVUlURVMuVEhST1VHSFBVVCwgY29uZmlnKTtcblxuICBpZiAoIWZpbHRlci5pbmNsdWRlcyhURVNUUy5EQVRBVEhST1VHSFBVVCkpIHtcbiAgICAvLyBDcmVhdGVzIGEgbG9vcGJhY2sgdmlhIHJlbGF5IGNhbmRpZGF0ZXMgYW5kIHRyaWVzIHRvIHNlbmQgYXMgbWFueSBwYWNrZXRzXG4gICAgLy8gd2l0aCAxMDI0IGNoYXJzIGFzIHBvc3NpYmxlIHdoaWxlIGtlZXBpbmcgZGF0YUNoYW5uZWwgYnVmZmVyZWRBbW1vdW50IGFib3ZlXG4gICAgLy8gemVyby5cbiAgICB0aHJvdWdocHV0U3VpdGUuYWRkKG5ldyBUZXN0Q2FzZSh0aHJvdWdocHV0U3VpdGUsIFRFU1RTLkRBVEFUSFJPVUdIUFVULCAodGVzdCkgPT4ge1xuICAgICAgdmFyIGRhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QgPSBuZXcgRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdCh0ZXN0KTtcbiAgICAgIGRhdGFDaGFubmVsVGhyb3VnaHB1dFRlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuVklERU9CQU5EV0lEVEgpKSB7XG4gICAgLy8gTWVhc3VyZXMgdmlkZW8gYmFuZHdpZHRoIGVzdGltYXRpb24gcGVyZm9ybWFuY2UgYnkgZG9pbmcgYSBsb29wYmFjayBjYWxsIHZpYVxuICAgIC8vIHJlbGF5IGNhbmRpZGF0ZXMgZm9yIDQwIHNlY29uZHMuIENvbXB1dGVzIHJ0dCBhbmQgYmFuZHdpZHRoIGVzdGltYXRpb25cbiAgICAvLyBhdmVyYWdlIGFuZCBtYXhpbXVtIGFzIHdlbGwgYXMgdGltZSB0byByYW1wIHVwIChkZWZpbmVkIGFzIHJlYWNoaW5nIDc1JSBvZlxuICAgIC8vIHRoZSBtYXggYml0cmF0ZS4gSXQgcmVwb3J0cyBpbmZpbml0ZSB0aW1lIHRvIHJhbXAgdXAgaWYgbmV2ZXIgcmVhY2hlcyBpdC5cbiAgICB0aHJvdWdocHV0U3VpdGUuYWRkKG5ldyBUZXN0Q2FzZSh0aHJvdWdocHV0U3VpdGUsIFRFU1RTLlZJREVPQkFORFdJRFRILCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHZpZGVvQmFuZHdpZHRoVGVzdCA9IG5ldyBWaWRlb0JhbmR3aWR0aFRlc3QodGVzdCk7XG4gICAgICB2aWRlb0JhbmR3aWR0aFRlc3QucnVuKCk7XG4gICAgfSkpO1xuICB9XG5cbiAgaWYgKCFmaWx0ZXIuaW5jbHVkZXMoVEVTVFMuTkVUV09SS0xBVEVOQ1kpKSB7XG4gICAgdGhyb3VnaHB1dFN1aXRlLmFkZChuZXcgVGVzdENhc2UodGhyb3VnaHB1dFN1aXRlLCBURVNUUy5ORVRXT1JLTEFURU5DWSwgKHRlc3QpID0+IHtcbiAgICAgIHZhciB3aUZpUGVyaW9kaWNTY2FuVGVzdCA9IG5ldyBXaUZpUGVyaW9kaWNTY2FuVGVzdCh0ZXN0LFxuICAgICAgICAgIENhbGwuaXNOb3RIb3N0Q2FuZGlkYXRlKTtcbiAgICAgIHdpRmlQZXJpb2RpY1NjYW5UZXN0LnJ1bigpO1xuICAgIH0pKTtcbiAgfVxuXG4gIGlmICghZmlsdGVyLmluY2x1ZGVzKFRFU1RTLk5FVFdPUktMQVRFTkNZUkVMQVkpKSB7XG4gICAgdGhyb3VnaHB1dFN1aXRlLmFkZChuZXcgVGVzdENhc2UodGhyb3VnaHB1dFN1aXRlLCBURVNUUy5ORVRXT1JLTEFURU5DWVJFTEFZLCAodGVzdCkgPT4ge1xuICAgICAgdmFyIHdpRmlQZXJpb2RpY1NjYW5UZXN0ID0gbmV3IFdpRmlQZXJpb2RpY1NjYW5UZXN0KHRlc3QsIENhbGwuaXNSZWxheSk7XG4gICAgICB3aUZpUGVyaW9kaWNTY2FuVGVzdC5ydW4oKTtcbiAgICB9KSk7XG4gIH1cblxuICByZXR1cm4gdGhyb3VnaHB1dFN1aXRlO1xufVxuIiwiY2xhc3MgU3VpdGUge1xuICBjb25zdHJ1Y3RvcihuYW1lLCBjb25maWcpIHtcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMuc2V0dGluZ3MgPSBjb25maWc7XG4gICAgdGhpcy50ZXN0cyA9IFtdO1xuICB9XG5cbiAgZ2V0VGVzdHMoKSB7XG4gICAgcmV0dXJuIHRoaXMudGVzdHM7XG4gIH1cblxuICBhZGQodGVzdCkge1xuICAgIHRoaXMudGVzdHMucHVzaCh0ZXN0KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBTdWl0ZTtcbiIsImNsYXNzIFRlc3RDYXNlIHtcbiAgY29uc3RydWN0b3Ioc3VpdGUsIG5hbWUsIGZuKSB7XG4gICAgdGhpcy5zdWl0ZSA9IHN1aXRlO1xuICAgIHRoaXMuc2V0dGluZ3MgPSB0aGlzLnN1aXRlLnNldHRpbmdzO1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5mbiA9IGZuO1xuICAgIHRoaXMucHJvZ3Jlc3MgPSAwO1xuICAgIHRoaXMuc3RhdHVzID0gJ3dhaXRpbmcnO1xuICB9XG5cbiAgc2V0UHJvZ3Jlc3ModmFsdWUpIHtcbiAgICB0aGlzLnByb2dyZXNzID0gdmFsdWU7XG4gICAgdGhpcy5jYWxsYmFja3Mub25UZXN0UHJvZ3Jlc3ModGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsIHZhbHVlKTtcbiAgfVxuXG4gIHJ1bihjYWxsYmFja3MsIGRvbmVDYWxsYmFjaykge1xuICAgIHRoaXMuZm4odGhpcyk7XG4gICAgdGhpcy5jYWxsYmFja3MgPSBjYWxsYmFja3M7XG4gICAgdGhpcy5kb25lQ2FsbGJhY2sgPSBkb25lQ2FsbGJhY2s7XG4gICAgdGhpcy5zZXRQcm9ncmVzcygwKTtcbiAgfVxuXG4gIHJlcG9ydEluZm8obSkge1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFJlcG9ydCh0aGlzLnN1aXRlLm5hbWUsIHRoaXMubmFtZSwgJ2luZm8nLCBtKTtcbiAgfVxuICByZXBvcnRTdWNjZXNzKG0pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXBvcnQodGhpcy5zdWl0ZS5uYW1lLCB0aGlzLm5hbWUsICdzdWNjZXNzJywgbSk7XG4gICAgdGhpcy5zdGF0dXMgPSAnc3VjY2Vzcyc7XG4gIH1cbiAgcmVwb3J0RXJyb3IobSkge1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFJlcG9ydCh0aGlzLnN1aXRlLm5hbWUsIHRoaXMubmFtZSwgJ2Vycm9yJywgbSk7XG4gICAgdGhpcy5zdGF0dXMgPSAnZXJyb3InO1xuICB9XG4gIHJlcG9ydFdhcm5pbmcobSkge1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFJlcG9ydCh0aGlzLnN1aXRlLm5hbWUsIHRoaXMubmFtZSwgJ3dhcm5pbmcnLCBtKTtcbiAgICB0aGlzLnN0YXR1cyA9ICd3YXJuaW5nJztcbiAgfVxuICByZXBvcnRGYXRhbChtKSB7XG4gICAgdGhpcy5jYWxsYmFja3Mub25UZXN0UmVwb3J0KHRoaXMuc3VpdGUubmFtZSwgdGhpcy5uYW1lLCAnZXJyb3InLCBtKTtcbiAgICB0aGlzLnN0YXR1cyA9ICdlcnJvcic7XG4gIH1cbiAgZG9uZSgpIHtcbiAgICBpZiAodGhpcy5wcm9ncmVzcyA8IDEwMCkgdGhpcy5zZXRQcm9ncmVzcygxMDApO1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFJlc3VsdCh0aGlzLnN1aXRlLm5hbWUsIHRoaXMubmFtZSwgdGhpcy5zdGF0dXMpO1xuICAgIHRoaXMuZG9uZUNhbGxiYWNrKCk7XG4gIH1cblxuICBkb0dldFVzZXJNZWRpYShjb25zdHJhaW50cywgb25TdWNjZXNzLCBvbkZhaWwpIHtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdHJ5IHtcbiAgICAgIC8vIENhbGwgaW50byBnZXRVc2VyTWVkaWEgdmlhIHRoZSBwb2x5ZmlsbCAoYWRhcHRlci5qcykuXG4gICAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShjb25zdHJhaW50cylcbiAgICAgICAgICAudGhlbihmdW5jdGlvbihzdHJlYW0pIHtcbiAgICAgICAgICAgIHZhciBjYW0gPSBzZWxmLmdldERldmljZU5hbWVfKHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpKTtcbiAgICAgICAgICAgIHZhciBtaWMgPSBzZWxmLmdldERldmljZU5hbWVfKHN0cmVhbS5nZXRBdWRpb1RyYWNrcygpKTtcbiAgICAgICAgICAgIG9uU3VjY2Vzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLmNhdGNoKGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgICBpZiAob25GYWlsKSB7XG4gICAgICAgICAgICAgIG9uRmFpbC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgc2VsZi5yZXBvcnRGYXRhbCgnRmFpbGVkIHRvIGdldCBhY2Nlc3MgdG8gbG9jYWwgbWVkaWEgZHVlIHRvICcgK1xuICAgICAgICAgICAgICAgICAgJ2Vycm9yOiAnICsgZXJyb3IubmFtZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIHRoaXMucmVwb3J0RmF0YWwoJ2dldFVzZXJNZWRpYSBmYWlsZWQgd2l0aCBleGNlcHRpb246ICcgK1xuICAgICAgICAgIGUubWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgc2V0VGltZW91dFdpdGhQcm9ncmVzc0Jhcih0aW1lb3V0Q2FsbGJhY2ssIHRpbWVvdXRNcykge1xuICAgIHZhciBzdGFydCA9IHdpbmRvdy5wZXJmb3JtYW5jZS5ub3coKTtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHVwZGF0ZVByb2dyZXNzQmFyID0gc2V0SW50ZXJ2YWwoZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgbm93ID0gd2luZG93LnBlcmZvcm1hbmNlLm5vdygpO1xuICAgICAgc2VsZi5zZXRQcm9ncmVzcygobm93IC0gc3RhcnQpICogMTAwIC8gdGltZW91dE1zKTtcbiAgICB9LCAxMDApO1xuICAgIHZhciB0aW1lb3V0VGFzayA9IGZ1bmN0aW9uKCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh1cGRhdGVQcm9ncmVzc0Jhcik7XG4gICAgICBzZWxmLnNldFByb2dyZXNzKDEwMCk7XG4gICAgICB0aW1lb3V0Q2FsbGJhY2soKTtcbiAgICB9O1xuICAgIHZhciB0aW1lciA9IHNldFRpbWVvdXQodGltZW91dFRhc2ssIHRpbWVvdXRNcyk7XG4gICAgdmFyIGZpbmlzaFByb2dyZXNzQmFyID0gZnVuY3Rpb24oKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZXIpO1xuICAgICAgdGltZW91dFRhc2soKTtcbiAgICB9O1xuICAgIHJldHVybiBmaW5pc2hQcm9ncmVzc0JhcjtcbiAgfVxuXG4gIGdldERldmljZU5hbWVfKHRyYWNrcykge1xuICAgIGlmICh0cmFja3MubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgcmV0dXJuIHRyYWNrc1swXS5sYWJlbDtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBUZXN0Q2FzZTtcbiIsImltcG9ydCAqIGFzIENvbmZpZyBmcm9tICcuL2NvbmZpZyc7XG5cbmZ1bmN0aW9uIHJ1bkFsbFNlcXVlbnRpYWxseSh0YXNrcywgY2FsbGJhY2tzLCBzaG91bGRTdG9wKSB7XG4gIHZhciBjdXJyZW50ID0gLTE7XG4gIHZhciBydW5OZXh0QXN5bmMgPSBzZXRUaW1lb3V0LmJpbmQobnVsbCwgcnVuTmV4dCk7XG4gIHJ1bk5leHRBc3luYygpO1xuICBmdW5jdGlvbiBydW5OZXh0KCkge1xuICAgIGlmIChzaG91bGRTdG9wKCkpIHtcbiAgICAgIGNhbGxiYWNrcy5vblN0b3BwZWQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY3VycmVudCsrO1xuICAgIGlmIChjdXJyZW50ID09PSB0YXNrcy5sZW5ndGgpIHtcbiAgICAgIGNhbGxiYWNrcy5vbkNvbXBsZXRlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRhc2tzW2N1cnJlbnRdLnJ1bihjYWxsYmFja3MsIHJ1bk5leHRBc3luYyk7XG4gIH1cbn1cblxuY2xhc3MgVGVzdFJUQyB7XG5cbiAgY29uc3RydWN0b3IoY29uZmlnID0ge30sIGZpbHRlciA9IFtdKSB7XG4gICAgdGhpcy5TVUlURVMgPSBDb25maWcuU1VJVEVTO1xuICAgIHRoaXMuVEVTVFMgPSBDb25maWcuVEVTVFM7XG4gICAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gICAgdGhpcy5jYWxsYmFja3MgPSB7XG4gICAgICBvblRlc3RQcm9ncmVzczogKCkgPT4ge30sXG4gICAgICBvblRlc3RSZXN1bHQ6ICgpID0+IHt9LFxuICAgICAgb25UZXN0UmVwb3J0OiAoKSA9PiB7fSxcbiAgICAgIG9uU3RvcHBlZDogKCkgPT4ge30sXG4gICAgICBvbkNvbXBsZXRlOiAoKSA9PiB7fSxcbiAgICB9O1xuXG4gICAgdGhpcy5zdWl0ZXMgPSBbXTtcblxuICAgIGlmICghZmlsdGVyLmluY2x1ZGVzKHRoaXMuU1VJVEVTLk1JQ1JPUEhPTkUpKSB7XG4gICAgICBjb25zdCBtaWNTdWl0ZSA9IENvbmZpZy5idWlsZE1pY3JvU3VpdGUodGhpcy5jb25maWcsIGZpbHRlcik7XG4gICAgICB0aGlzLnN1aXRlcy5wdXNoKG1pY1N1aXRlKTtcbiAgICB9XG5cbiAgICBpZiAoIWZpbHRlci5pbmNsdWRlcyh0aGlzLlNVSVRFUy5DQU1FUkEpKSB7XG4gICAgICBjb25zdCBjYW1lcmFTdWl0ZSA9IENvbmZpZy5idWlsZENhbWVyYVN1aXRlKHRoaXMuY29uZmlnLCBmaWx0ZXIpO1xuICAgICAgdGhpcy5zdWl0ZXMucHVzaChjYW1lcmFTdWl0ZSk7XG4gICAgfVxuXG4gICAgaWYgKCFmaWx0ZXIuaW5jbHVkZXModGhpcy5TVUlURVMuTkVUV09SSykpIHtcbiAgICAgIGNvbnN0IG5ldHdvcmtTdWl0ZSA9IENvbmZpZy5idWlsZE5ldHdvcmtTdWl0ZSh0aGlzLmNvbmZpZywgZmlsdGVyKTtcbiAgICAgIHRoaXMuc3VpdGVzLnB1c2gobmV0d29ya1N1aXRlKTtcbiAgICB9XG5cbiAgICBpZiAoIWZpbHRlci5pbmNsdWRlcyh0aGlzLlNVSVRFUy5DT05ORUNUSVZJVFkpKSB7XG4gICAgICBjb25zdCBjb25uZWN0aXZpdHlTdWl0ZSA9IENvbmZpZy5idWlsZENvbm5lY3Rpdml0eVN1aXRlKHRoaXMuY29uZmlnLCBmaWx0ZXIpO1xuICAgICAgdGhpcy5zdWl0ZXMucHVzaChjb25uZWN0aXZpdHlTdWl0ZSk7XG4gICAgfVxuXG4gICAgaWYgKCFmaWx0ZXIuaW5jbHVkZXModGhpcy5TVUlURVMuVEhST1VHSFBVVCkpIHtcbiAgICAgIGNvbnN0IHRocm91Z2hwdXRTdWl0ZSA9IENvbmZpZy5idWlsZFRocm91Z2hwdXRTdWl0ZSh0aGlzLmNvbmZpZywgZmlsdGVyKTtcbiAgICAgIHRoaXMuc3VpdGVzLnB1c2godGhyb3VnaHB1dFN1aXRlKTtcbiAgICB9XG4gIH1cblxuICBnZXRTdWl0ZXMoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3VpdGVzO1xuICB9XG5cbiAgZ2V0VGVzdHMoKSB7XG4gICAgcmV0dXJuIHRoaXMuc3VpdGVzLnJlZHVjZSgoYWxsLCBzdWl0ZSkgPT4gYWxsLmNvbmNhdChzdWl0ZS5nZXRUZXN0cygpKSwgW10pO1xuICB9XG5cbiAgb25UZXN0UHJvZ3Jlc3MoY2FsbGJhY2sgPSAoKSA9PiB7fSkge1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFByb2dyZXNzID0gY2FsbGJhY2s7XG4gIH1cblxuICBvblRlc3RSZXN1bHQoY2FsbGJhY2sgPSAoKSA9PiB7fSkge1xuICAgIHRoaXMuY2FsbGJhY2tzLm9uVGVzdFJlc3VsdCA9IGNhbGxiYWNrO1xuICB9XG5cbiAgb25UZXN0UmVwb3J0KGNhbGxiYWNrID0gKCkgPT4ge30pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vblRlc3RSZXBvcnQgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uU3RvcHBlZChjYWxsYmFjayA9ICgpID0+IHt9KSB7XG4gICAgdGhpcy5jYWxsYmFja3Mub25TdG9wcGVkID0gY2FsbGJhY2s7XG4gIH1cblxuICBvbkNvbXBsZXRlKGNhbGxiYWNrID0gKCkgPT4ge30pIHtcbiAgICB0aGlzLmNhbGxiYWNrcy5vbkNvbXBsZXRlID0gY2FsbGJhY2s7XG4gIH1cblxuICBzdGFydCgpIHtcbiAgICBjb25zdCBhbGxUZXN0cyA9IHRoaXMuZ2V0VGVzdHMoKTtcbiAgICB0aGlzLnNob3VsZFN0b3AgPSBmYWxzZTtcbiAgICBydW5BbGxTZXF1ZW50aWFsbHkoYWxsVGVzdHMsIHRoaXMuY2FsbGJhY2tzLCAoKSA9PiB7IHJldHVybiB0aGlzLnNob3VsZFN0b3AgfSk7XG4gIH1cblxuICBzdG9wKCkge1xuICAgIHRoaXMuc2hvdWxkU3RvcCA9IHRydWU7XG4gIH1cbn1cblxuVGVzdFJUQy5TVUlURVMgPSBDb25maWcuU1VJVEVTO1xuVGVzdFJUQy5URVNUUyA9IENvbmZpZy5URVNUUztcbndpbmRvdy5UZXN0UlRDID0gVGVzdFJUQztcbmV4cG9ydCBkZWZhdWx0IFRlc3RSVEM7XG4iLCIndXNlIHN0cmljdCc7XG5pbXBvcnQgVmlkZW9GcmFtZUNoZWNrZXIgZnJvbSAnLi4vdXRpbC9WaWRlb0ZyYW1lQ2hlY2tlci5qcyc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL0NhbGwuanMnO1xuaW1wb3J0IFJlcG9ydCBmcm9tICcuLi91dGlsL3JlcG9ydC5qcyc7XG5pbXBvcnQgeyBhcnJheUF2ZXJhZ2UsIGFycmF5TWluLCBhcnJheU1heCB9IGZyb20gJy4uL3V0aWwvdXRpbC5qcyc7XG5cbmNvbnN0IHJlcG9ydCA9IG5ldyBSZXBvcnQoKTtcbi8qXG4gKiBJbiBnZW5lcmljIGNhbWVyYXMgdXNpbmcgQ2hyb21lIHJlc2NhbGVyLCBhbGwgcmVzb2x1dGlvbnMgc2hvdWxkIGJlIHN1cHBvcnRlZFxuICogdXAgdG8gYSBnaXZlbiBvbmUgYW5kIG5vbmUgYmV5b25kIHRoZXJlLiBTcGVjaWFsIGNhbWVyYXMsIHN1Y2ggYXMgZGlnaXRpemVycyxcbiAqIG1pZ2h0IHN1cHBvcnQgb25seSBvbmUgcmVzb2x1dGlvbi5cbiAqL1xuXG4vKlxuICogXCJBbmFseXplIHBlcmZvcm1hbmNlIGZvciBcInJlc29sdXRpb25cIlwiIHRlc3QgdXNlcyBnZXRTdGF0cywgY2FudmFzIGFuZCB0aGVcbiAqIHZpZGVvIGVsZW1lbnQgdG8gYW5hbHl6ZSB0aGUgdmlkZW8gZnJhbWVzIGZyb20gYSBjYXB0dXJlIGRldmljZS4gSXQgd2lsbFxuICogcmVwb3J0IG51bWJlciBvZiBibGFjayBmcmFtZXMsIGZyb3plbiBmcmFtZXMsIHRlc3RlZCBmcmFtZXMgYW5kIHZhcmlvdXMgc3RhdHNcbiAqIGxpa2UgYXZlcmFnZSBlbmNvZGUgdGltZSBhbmQgRlBTLiBBIHRlc3QgY2FzZSB3aWxsIGJlIGNyZWF0ZWQgcGVyIG1hbmRhdG9yeVxuICogcmVzb2x1dGlvbiBmb3VuZCBpbiB0aGUgXCJyZXNvbHV0aW9uc1wiIGFycmF5LlxuICovXG5cbmZ1bmN0aW9uIENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCByZXNvbHV0aW9ucykge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnJlc29sdXRpb25zID0gcmVzb2x1dGlvbnM7XG4gIHRoaXMuY3VycmVudFJlc29sdXRpb24gPSAwO1xuICB0aGlzLmlzTXV0ZWQgPSBmYWxzZTtcbiAgdGhpcy5pc1NodXR0aW5nRG93biA9IGZhbHNlO1xufVxuXG5DYW1SZXNvbHV0aW9uc1Rlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3RhcnRHZXRVc2VyTWVkaWEodGhpcy5yZXNvbHV0aW9uc1t0aGlzLmN1cnJlbnRSZXNvbHV0aW9uXSk7XG4gIH0sXG5cbiAgc3RhcnRHZXRVc2VyTWVkaWE6IGZ1bmN0aW9uKHJlc29sdXRpb24pIHtcbiAgICB2YXIgY29uc3RyYWludHMgPSB7XG4gICAgICBhdWRpbzogZmFsc2UsXG4gICAgICB2aWRlbzoge1xuICAgICAgICB3aWR0aDoge2V4YWN0OiByZXNvbHV0aW9uWzBdfSxcbiAgICAgICAgaGVpZ2h0OiB7ZXhhY3Q6IHJlc29sdXRpb25bMV19XG4gICAgICB9XG4gICAgfTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShjb25zdHJhaW50cylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgLy8gRG8gbm90IGNoZWNrIGFjdHVhbCB2aWRlbyBmcmFtZXMgd2hlbiBtb3JlIHRoYW4gb25lIHJlc29sdXRpb24gaXNcbiAgICAgICAgICAvLyBwcm92aWRlZC5cbiAgICAgICAgICBpZiAodGhpcy5yZXNvbHV0aW9ucy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnU3VwcG9ydGVkOiAnICsgcmVzb2x1dGlvblswXSArICd4JyArXG4gICAgICAgICAgICByZXNvbHV0aW9uWzFdKTtcbiAgICAgICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY29sbGVjdEFuZEFuYWx5emVTdGF0c18oc3RyZWFtLCByZXNvbHV0aW9uKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0uYmluZCh0aGlzKSlcbiAgICAgICAgLmNhdGNoKGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgaWYgKHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8ocmVzb2x1dGlvblswXSArICd4JyArIHJlc29sdXRpb25bMV0gK1xuICAgICAgICAgICAgJyBub3Qgc3VwcG9ydGVkJyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgY29uc29sZS5kaXIoY29uc3RyYWludHMpO1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdnZXRVc2VyTWVkaWEgZmFpbGVkIHdpdGggZXJyb3I6ICcgK1xuICAgICAgICAgICAgICAgIGVycm9yLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBtYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jdXJyZW50UmVzb2x1dGlvbiA9PT0gdGhpcy5yZXNvbHV0aW9ucy5sZW5ndGgpIHtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3RhcnRHZXRVc2VyTWVkaWEodGhpcy5yZXNvbHV0aW9uc1t0aGlzLmN1cnJlbnRSZXNvbHV0aW9uKytdKTtcbiAgfSxcblxuICBjb2xsZWN0QW5kQW5hbHl6ZVN0YXRzXzogZnVuY3Rpb24oc3RyZWFtLCByZXNvbHV0aW9uKSB7XG4gICAgdmFyIHRyYWNrcyA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpO1xuICAgIGlmICh0cmFja3MubGVuZ3RoIDwgMSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyB2aWRlbyB0cmFjayBpbiByZXR1cm5lZCBzdHJlYW0uJyk7XG4gICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBGaXJlZm94IGRvZXMgbm90IHN1cHBvcnQgZXZlbnQgaGFuZGxlcnMgb24gbWVkaWFTdHJlYW1UcmFjayB5ZXQuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL01lZGlhU3RyZWFtVHJhY2tcbiAgICAvLyBUT0RPOiByZW1vdmUgaWYgKC4uLikgd2hlbiBldmVudCBoYW5kbGVycyBhcmUgc3VwcG9ydGVkIGJ5IEZpcmVmb3guXG4gICAgdmFyIHZpZGVvVHJhY2sgPSB0cmFja3NbMF07XG4gICAgaWYgKHR5cGVvZiB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIFJlZ2lzdGVyIGV2ZW50cy5cbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcignZW5kZWQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignVmlkZW8gdHJhY2sgZW5kZWQsIGNhbWVyYSBzdG9wcGVkIHdvcmtpbmcnKTtcbiAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ211dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgbXV0ZWQuJyk7XG4gICAgICAgIC8vIE1lZGlhU3RyZWFtVHJhY2subXV0ZWQgcHJvcGVydHkgaXMgbm90IHdpcmVkIHVwIGluIENocm9tZSB5ZXQsXG4gICAgICAgIC8vIGNoZWNraW5nIGlzTXV0ZWQgbG9jYWwgc3RhdGUuXG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IHRydWU7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCd1bm11dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgdW5tdXRlZC4nKTtcbiAgICAgICAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIHZhciB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3ZpZGVvJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdhdXRvcGxheScsICcnKTtcbiAgICB2aWRlby5zZXRBdHRyaWJ1dGUoJ211dGVkJywgJycpO1xuICAgIHZpZGVvLndpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICB2aWRlby5oZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHZpZGVvLnNyY09iamVjdCA9IHN0cmVhbTtcbiAgICB2YXIgZnJhbWVDaGVja2VyID0gbmV3IFZpZGVvRnJhbWVDaGVja2VyKHZpZGVvKTtcbiAgICB2YXIgY2FsbCA9IG5ldyBDYWxsKG51bGwsIHRoaXMudGVzdCk7XG4gICAgY2FsbC5wYzEuYWRkU3RyZWFtKHN0cmVhbSk7XG4gICAgY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgY2FsbC5nYXRoZXJTdGF0cyhjYWxsLnBjMSwgbnVsbCwgc3RyZWFtLFxuICAgICAgICB0aGlzLm9uQ2FsbEVuZGVkXy5iaW5kKHRoaXMsIHJlc29sdXRpb24sIHZpZGVvLFxuICAgICAgICAgICAgc3RyZWFtLCBmcmFtZUNoZWNrZXIpLFxuICAgICAgICAxMDApO1xuXG4gICAgdGhpcy50ZXN0LnNldFRpbWVvdXRXaXRoUHJvZ3Jlc3NCYXIodGhpcy5lbmRDYWxsXy5iaW5kKHRoaXMsIGNhbGwsIHN0cmVhbSksIDgwMDApO1xuICB9LFxuXG4gIG9uQ2FsbEVuZGVkXzogZnVuY3Rpb24ocmVzb2x1dGlvbiwgdmlkZW9FbGVtZW50LCBzdHJlYW0sIGZyYW1lQ2hlY2tlcixcbiAgICBzdGF0cywgc3RhdHNUaW1lKSB7XG4gICAgdGhpcy5hbmFseXplU3RhdHNfKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLCBmcmFtZUNoZWNrZXIsXG4gICAgICAgIHN0YXRzLCBzdGF0c1RpbWUpO1xuXG4gICAgZnJhbWVDaGVja2VyLnN0b3AoKTtcblxuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH0sXG5cbiAgYW5hbHl6ZVN0YXRzXzogZnVuY3Rpb24ocmVzb2x1dGlvbiwgdmlkZW9FbGVtZW50LCBzdHJlYW0sXG4gICAgZnJhbWVDaGVja2VyLCBzdGF0cywgc3RhdHNUaW1lKSB7XG4gICAgdmFyIGdvb2dBdmdFbmNvZGVUaW1lID0gW107XG4gICAgdmFyIGdvb2dBdmdGcmFtZVJhdGVJbnB1dCA9IFtdO1xuICAgIHZhciBnb29nQXZnRnJhbWVSYXRlU2VudCA9IFtdO1xuICAgIHZhciBzdGF0c1JlcG9ydCA9IHt9O1xuICAgIHZhciBmcmFtZVN0YXRzID0gZnJhbWVDaGVja2VyLmZyYW1lU3RhdHM7XG5cbiAgICBmb3IgKHZhciBpbmRleCBpbiBzdGF0cykge1xuICAgICAgaWYgKHN0YXRzW2luZGV4XS50eXBlID09PSAnc3NyYycpIHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHRvIG9ubHkgY2FwdHVyZSBzdGF0cyBhZnRlciB0aGUgZW5jb2RlciBpcyBzZXR1cC5cbiAgICAgICAgaWYgKHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpID4gMCkge1xuICAgICAgICAgIGdvb2dBdmdFbmNvZGVUaW1lLnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nQXZnRW5jb2RlTXMpKTtcbiAgICAgICAgICBnb29nQXZnRnJhbWVSYXRlSW5wdXQucHVzaChcbiAgICAgICAgICAgICAgcGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVJbnB1dCkpO1xuICAgICAgICAgIGdvb2dBdmdGcmFtZVJhdGVTZW50LnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlU2VudCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgc3RhdHNSZXBvcnQuY2FtZXJhTmFtZSA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpWzBdLmxhYmVsIHx8IE5hTjtcbiAgICBzdGF0c1JlcG9ydC5hY3R1YWxWaWRlb1dpZHRoID0gdmlkZW9FbGVtZW50LnZpZGVvV2lkdGg7XG4gICAgc3RhdHNSZXBvcnQuYWN0dWFsVmlkZW9IZWlnaHQgPSB2aWRlb0VsZW1lbnQudmlkZW9IZWlnaHQ7XG4gICAgc3RhdHNSZXBvcnQubWFuZGF0b3J5V2lkdGggPSByZXNvbHV0aW9uWzBdO1xuICAgIHN0YXRzUmVwb3J0Lm1hbmRhdG9yeUhlaWdodCA9IHJlc29sdXRpb25bMV07XG4gICAgc3RhdHNSZXBvcnQuZW5jb2RlU2V0dXBUaW1lTXMgPVxuICAgICAgICB0aGlzLmV4dHJhY3RFbmNvZGVyU2V0dXBUaW1lXyhzdGF0cywgc3RhdHNUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5hdmdFbmNvZGVUaW1lTXMgPSBhcnJheUF2ZXJhZ2UoZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0Lm1pbkVuY29kZVRpbWVNcyA9IGFycmF5TWluKGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5tYXhFbmNvZGVUaW1lTXMgPSBhcnJheU1heChnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQuYXZnSW5wdXRGcHMgPSBhcnJheUF2ZXJhZ2UoZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5taW5JbnB1dEZwcyA9IGFycmF5TWluKGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQubWF4SW5wdXRGcHMgPSBhcnJheU1heChnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z1NlbnRGcHMgPSBhcnJheUF2ZXJhZ2UoZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0Lm1pblNlbnRGcHMgPSBhcnJheU1pbihnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQubWF4U2VudEZwcyA9IGFycmF5TWF4KGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5pc011dGVkID0gdGhpcy5pc011dGVkO1xuICAgIHN0YXRzUmVwb3J0LnRlc3RlZEZyYW1lcyA9IGZyYW1lU3RhdHMubnVtRnJhbWVzO1xuICAgIHN0YXRzUmVwb3J0LmJsYWNrRnJhbWVzID0gZnJhbWVTdGF0cy5udW1CbGFja0ZyYW1lcztcbiAgICBzdGF0c1JlcG9ydC5mcm96ZW5GcmFtZXMgPSBmcmFtZVN0YXRzLm51bUZyb3plbkZyYW1lcztcblxuICAgIC8vIFRPRE86IEFkZCBhIHJlcG9ydEluZm8oKSBmdW5jdGlvbiB3aXRoIGEgdGFibGUgZm9ybWF0IHRvIGRpc3BsYXlcbiAgICAvLyB2YWx1ZXMgY2xlYXJlci5cbiAgICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3ZpZGVvLXN0YXRzJywgc3RhdHNSZXBvcnQpO1xuXG4gICAgdGhpcy50ZXN0RXhwZWN0YXRpb25zXyhzdGF0c1JlcG9ydCk7XG4gIH0sXG5cbiAgZW5kQ2FsbF86IGZ1bmN0aW9uKGNhbGxPYmplY3QsIHN0cmVhbSkge1xuICAgIHRoaXMuaXNTaHV0dGluZ0Rvd24gPSB0cnVlO1xuICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICB0cmFjay5zdG9wKCk7XG4gICAgfSk7XG4gICAgY2FsbE9iamVjdC5jbG9zZSgpO1xuICB9LFxuXG4gIGV4dHJhY3RFbmNvZGVyU2V0dXBUaW1lXzogZnVuY3Rpb24oc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggIT09IHN0YXRzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgaWYgKHN0YXRzW2luZGV4XS50eXBlID09PSAnc3NyYycpIHtcbiAgICAgICAgaWYgKHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpID4gMCkge1xuICAgICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShzdGF0c1RpbWVbaW5kZXhdIC0gc3RhdHNUaW1lWzBdKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gTmFOO1xuICB9LFxuXG4gIHJlc29sdXRpb25NYXRjaGVzSW5kZXBlbmRlbnRPZlJvdGF0aW9uT3JDcm9wXzogZnVuY3Rpb24oYVdpZHRoLCBhSGVpZ2h0LFxuICAgIGJXaWR0aCwgYkhlaWdodCkge1xuICAgIHZhciBtaW5SZXMgPSBNYXRoLm1pbihiV2lkdGgsIGJIZWlnaHQpO1xuICAgIHJldHVybiAoYVdpZHRoID09PSBiV2lkdGggJiYgYUhlaWdodCA9PT0gYkhlaWdodCkgfHxcbiAgICAgICAgICAgKGFXaWR0aCA9PT0gYkhlaWdodCAmJiBhSGVpZ2h0ID09PSBiV2lkdGgpIHx8XG4gICAgICAgICAgIChhV2lkdGggPT09IG1pblJlcyAmJiBiSGVpZ2h0ID09PSBtaW5SZXMpO1xuICB9LFxuXG4gIHRlc3RFeHBlY3RhdGlvbnNfOiBmdW5jdGlvbihpbmZvKSB7XG4gICAgdmFyIG5vdEF2YWlsYWJsZVN0YXRzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIGluZm8pIHtcbiAgICAgIGlmIChpbmZvLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBpbmZvW2tleV0gPT09ICdudW1iZXInICYmIGlzTmFOKGluZm9ba2V5XSkpIHtcbiAgICAgICAgICBub3RBdmFpbGFibGVTdGF0cy5wdXNoKGtleSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oa2V5ICsgJzogJyArIGluZm9ba2V5XSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG5vdEF2YWlsYWJsZVN0YXRzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ05vdCBhdmFpbGFibGU6ICcgKyBub3RBdmFpbGFibGVTdGF0cy5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4oaW5mby5hdmdTZW50RnBzKSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0Nhbm5vdCB2ZXJpZnkgc2VudCBGUFMuJyk7XG4gICAgfSBlbHNlIGlmIChpbmZvLmF2Z1NlbnRGcHMgPCA1KSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0xvdyBhdmVyYWdlIHNlbnQgRlBTOiAnICsgaW5mby5hdmdTZW50RnBzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0F2ZXJhZ2UgRlBTIGFib3ZlIHRocmVzaG9sZCcpO1xuICAgIH1cbiAgICBpZiAoIXRoaXMucmVzb2x1dGlvbk1hdGNoZXNJbmRlcGVuZGVudE9mUm90YXRpb25PckNyb3BfKFxuICAgICAgICBpbmZvLmFjdHVhbFZpZGVvV2lkdGgsIGluZm8uYWN0dWFsVmlkZW9IZWlnaHQsIGluZm8ubWFuZGF0b3J5V2lkdGgsXG4gICAgICAgIGluZm8ubWFuZGF0b3J5SGVpZ2h0KSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdJbmNvcnJlY3QgY2FwdHVyZWQgcmVzb2x1dGlvbi4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0NhcHR1cmVkIHZpZGVvIHVzaW5nIGV4cGVjdGVkIHJlc29sdXRpb24uJyk7XG4gICAgfVxuICAgIGlmIChpbmZvLnRlc3RlZEZyYW1lcyA9PT0gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDb3VsZCBub3QgYW5hbHl6ZSBhbnkgdmlkZW8gZnJhbWUuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChpbmZvLmJsYWNrRnJhbWVzID4gaW5mby50ZXN0ZWRGcmFtZXMgLyAzKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGRlbGl2ZXJpbmcgbG90cyBvZiBibGFjayBmcmFtZXMuJyk7XG4gICAgICB9XG4gICAgICBpZiAoaW5mby5mcm96ZW5GcmFtZXMgPiBpbmZvLnRlc3RlZEZyYW1lcyAvIDMpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDYW1lcmEgZGVsaXZlcmluZyBsb3RzIG9mIGZyb3plbiBmcmFtZXMuJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBDYW1SZXNvbHV0aW9uc1Rlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5pbXBvcnQgVmlkZW9GcmFtZUNoZWNrZXIgZnJvbSAnLi4vdXRpbC9WaWRlb0ZyYW1lQ2hlY2tlci5qcyc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL0NhbGwuanMnO1xuaW1wb3J0IFJlcG9ydCBmcm9tICcuLi91dGlsL3JlcG9ydC5qcyc7XG5pbXBvcnQgeyBhcnJheUF2ZXJhZ2UsIGFycmF5TWluLCBhcnJheU1heCB9IGZyb20gJy4uL3V0aWwvdXRpbC5qcyc7XG5cbmNvbnN0IHJlcG9ydCA9IG5ldyBSZXBvcnQoKTtcbi8qXG4gKiBJbiBnZW5lcmljIGNhbWVyYXMgdXNpbmcgQ2hyb21lIHJlc2NhbGVyLCBhbGwgcmVzb2x1dGlvbnMgc2hvdWxkIGJlIHN1cHBvcnRlZFxuICogdXAgdG8gYSBnaXZlbiBvbmUgYW5kIG5vbmUgYmV5b25kIHRoZXJlLiBTcGVjaWFsIGNhbWVyYXMsIHN1Y2ggYXMgZGlnaXRpemVycyxcbiAqIG1pZ2h0IHN1cHBvcnQgb25seSBvbmUgcmVzb2x1dGlvbi5cbiAqL1xuXG4vKlxuICogXCJBbmFseXplIHBlcmZvcm1hbmNlIGZvciBcInJlc29sdXRpb25cIlwiIHRlc3QgdXNlcyBnZXRTdGF0cywgY2FudmFzIGFuZCB0aGVcbiAqIHZpZGVvIGVsZW1lbnQgdG8gYW5hbHl6ZSB0aGUgdmlkZW8gZnJhbWVzIGZyb20gYSBjYXB0dXJlIGRldmljZS4gSXQgd2lsbFxuICogcmVwb3J0IG51bWJlciBvZiBibGFjayBmcmFtZXMsIGZyb3plbiBmcmFtZXMsIHRlc3RlZCBmcmFtZXMgYW5kIHZhcmlvdXMgc3RhdHNcbiAqIGxpa2UgYXZlcmFnZSBlbmNvZGUgdGltZSBhbmQgRlBTLiBBIHRlc3QgY2FzZSB3aWxsIGJlIGNyZWF0ZWQgcGVyIG1hbmRhdG9yeVxuICogcmVzb2x1dGlvbiBmb3VuZCBpbiB0aGUgXCJyZXNvbHV0aW9uc1wiIGFycmF5LlxuICovXG5cbmZ1bmN0aW9uIENhbVJlc29sdXRpb25zVGVzdCh0ZXN0LCByZXNvbHV0aW9ucykge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnJlc29sdXRpb25zID0gcmVzb2x1dGlvbnM7XG4gIHRoaXMuY3VycmVudFJlc29sdXRpb24gPSAwO1xuICB0aGlzLmlzTXV0ZWQgPSBmYWxzZTtcbiAgdGhpcy5pc1NodXR0aW5nRG93biA9IGZhbHNlO1xufVxuXG5DYW1SZXNvbHV0aW9uc1Rlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc3RhcnRHZXRVc2VyTWVkaWEodGhpcy5yZXNvbHV0aW9uc1t0aGlzLmN1cnJlbnRSZXNvbHV0aW9uXSk7XG4gIH0sXG5cbiAgc3RhcnRHZXRVc2VyTWVkaWE6IGZ1bmN0aW9uKHJlc29sdXRpb24pIHtcbiAgICB2YXIgY29uc3RyYWludHMgPSB7XG4gICAgICBhdWRpbzogZmFsc2UsXG4gICAgICB2aWRlbzoge1xuICAgICAgICB3aWR0aDoge2V4YWN0OiByZXNvbHV0aW9uWzBdfSxcbiAgICAgICAgaGVpZ2h0OiB7ZXhhY3Q6IHJlc29sdXRpb25bMV19XG4gICAgICB9XG4gICAgfTtcbiAgICBuYXZpZ2F0b3IubWVkaWFEZXZpY2VzLmdldFVzZXJNZWRpYShjb25zdHJhaW50cylcbiAgICAgICAgLnRoZW4oZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgICAgICAgLy8gRG8gbm90IGNoZWNrIGFjdHVhbCB2aWRlbyBmcmFtZXMgd2hlbiBtb3JlIHRoYW4gb25lIHJlc29sdXRpb24gaXNcbiAgICAgICAgICAvLyBwcm92aWRlZC5cbiAgICAgICAgICBpZiAodGhpcy5yZXNvbHV0aW9ucy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnU3VwcG9ydGVkOiAnICsgcmVzb2x1dGlvblswXSArICd4JyArXG4gICAgICAgICAgICByZXNvbHV0aW9uWzFdKTtcbiAgICAgICAgICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICAgICAgICAgIHRyYWNrLnN0b3AoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgdGhpcy5tYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhKCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuY29sbGVjdEFuZEFuYWx5emVTdGF0c18oc3RyZWFtLCByZXNvbHV0aW9uKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0uYmluZCh0aGlzKSlcbiAgICAgICAgLmNhdGNoKGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgaWYgKHRoaXMucmVzb2x1dGlvbnMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8ocmVzb2x1dGlvblswXSArICd4JyArIHJlc29sdXRpb25bMV0gK1xuICAgICAgICAgICAgJyBub3Qgc3VwcG9ydGVkJyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICAgICAgY29uc29sZS5kaXIoY29uc3RyYWludHMpO1xuICAgICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdnZXRVc2VyTWVkaWEgZmFpbGVkIHdpdGggZXJyb3I6ICcgK1xuICAgICAgICAgICAgICAgIGVycm9yLm5hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBtYXliZUNvbnRpbnVlR2V0VXNlck1lZGlhOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jdXJyZW50UmVzb2x1dGlvbiA9PT0gdGhpcy5yZXNvbHV0aW9ucy5sZW5ndGgpIHtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3RhcnRHZXRVc2VyTWVkaWEodGhpcy5yZXNvbHV0aW9uc1t0aGlzLmN1cnJlbnRSZXNvbHV0aW9uKytdKTtcbiAgfSxcblxuICBjb2xsZWN0QW5kQW5hbHl6ZVN0YXRzXzogZnVuY3Rpb24oc3RyZWFtLCByZXNvbHV0aW9uKSB7XG4gICAgdmFyIHRyYWNrcyA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpO1xuICAgIGlmICh0cmFja3MubGVuZ3RoIDwgMSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdObyB2aWRlbyB0cmFjayBpbiByZXR1cm5lZCBzdHJlYW0uJyk7XG4gICAgICB0aGlzLm1heWJlQ29udGludWVHZXRVc2VyTWVkaWEoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBGaXJlZm94IGRvZXMgbm90IHN1cHBvcnQgZXZlbnQgaGFuZGxlcnMgb24gbWVkaWFTdHJlYW1UcmFjayB5ZXQuXG4gICAgLy8gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL01lZGlhU3RyZWFtVHJhY2tcbiAgICAvLyBUT0RPOiByZW1vdmUgaWYgKC4uLikgd2hlbiBldmVudCBoYW5kbGVycyBhcmUgc3VwcG9ydGVkIGJ5IEZpcmVmb3guXG4gICAgdmFyIHZpZGVvVHJhY2sgPSB0cmFja3NbMF07XG4gICAgaWYgKHR5cGVvZiB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIC8vIFJlZ2lzdGVyIGV2ZW50cy5cbiAgICAgIHZpZGVvVHJhY2suYWRkRXZlbnRMaXN0ZW5lcignZW5kZWQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignVmlkZW8gdHJhY2sgZW5kZWQsIGNhbWVyYSBzdG9wcGVkIHdvcmtpbmcnKTtcbiAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgICB2aWRlb1RyYWNrLmFkZEV2ZW50TGlzdGVuZXIoJ211dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRXYXJuaW5nKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgbXV0ZWQuJyk7XG4gICAgICAgIC8vIE1lZGlhU3RyZWFtVHJhY2subXV0ZWQgcHJvcGVydHkgaXMgbm90IHdpcmVkIHVwIGluIENocm9tZSB5ZXQsXG4gICAgICAgIC8vIGNoZWNraW5nIGlzTXV0ZWQgbG9jYWwgc3RhdGUuXG4gICAgICAgIHRoaXMuaXNNdXRlZCA9IHRydWU7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgICAgdmlkZW9UcmFjay5hZGRFdmVudExpc3RlbmVyKCd1bm11dGUnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gSWdub3JlIGV2ZW50cyB3aGVuIHNodXR0aW5nIGRvd24gdGhlIHRlc3QuXG4gICAgICAgIGlmICh0aGlzLmlzU2h1dHRpbmdEb3duKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdZb3VyIGNhbWVyYSByZXBvcnRlZCBpdHNlbGYgYXMgdW5tdXRlZC4nKTtcbiAgICAgICAgdGhpcy5pc011dGVkID0gZmFsc2U7XG4gICAgICB9LmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIHZhciB2aWRlbyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3ZpZGVvJyk7XG4gICAgdmlkZW8uc2V0QXR0cmlidXRlKCdhdXRvcGxheScsICcnKTtcbiAgICB2aWRlby5zZXRBdHRyaWJ1dGUoJ211dGVkJywgJycpO1xuICAgIHZpZGVvLndpZHRoID0gcmVzb2x1dGlvblswXTtcbiAgICB2aWRlby5oZWlnaHQgPSByZXNvbHV0aW9uWzFdO1xuICAgIHZpZGVvLnNyY09iamVjdCA9IHN0cmVhbTtcbiAgICB2YXIgZnJhbWVDaGVja2VyID0gbmV3IFZpZGVvRnJhbWVDaGVja2VyKHZpZGVvKTtcbiAgICB2YXIgY2FsbCA9IG5ldyBDYWxsKG51bGwsIHRoaXMudGVzdCk7XG4gICAgY2FsbC5wYzEuYWRkU3RyZWFtKHN0cmVhbSk7XG4gICAgY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgY2FsbC5nYXRoZXJTdGF0cyhjYWxsLnBjMSwgbnVsbCwgc3RyZWFtLFxuICAgICAgICB0aGlzLm9uQ2FsbEVuZGVkXy5iaW5kKHRoaXMsIHJlc29sdXRpb24sIHZpZGVvLFxuICAgICAgICAgICAgc3RyZWFtLCBmcmFtZUNoZWNrZXIpLFxuICAgICAgICAxMDApO1xuXG4gICAgdGhpcy50ZXN0LnNldFRpbWVvdXRXaXRoUHJvZ3Jlc3NCYXIodGhpcy5lbmRDYWxsXy5iaW5kKHRoaXMsIGNhbGwsIHN0cmVhbSksIDgwMDApO1xuICB9LFxuXG4gIG9uQ2FsbEVuZGVkXzogZnVuY3Rpb24ocmVzb2x1dGlvbiwgdmlkZW9FbGVtZW50LCBzdHJlYW0sIGZyYW1lQ2hlY2tlcixcbiAgICBzdGF0cywgc3RhdHNUaW1lKSB7XG4gICAgdGhpcy5hbmFseXplU3RhdHNfKHJlc29sdXRpb24sIHZpZGVvRWxlbWVudCwgc3RyZWFtLCBmcmFtZUNoZWNrZXIsXG4gICAgICAgIHN0YXRzLCBzdGF0c1RpbWUpO1xuXG4gICAgZnJhbWVDaGVja2VyLnN0b3AoKTtcblxuICAgIHRoaXMudGVzdC5kb25lKCk7XG4gIH0sXG5cbiAgYW5hbHl6ZVN0YXRzXzogZnVuY3Rpb24ocmVzb2x1dGlvbiwgdmlkZW9FbGVtZW50LCBzdHJlYW0sXG4gICAgZnJhbWVDaGVja2VyLCBzdGF0cywgc3RhdHNUaW1lKSB7XG4gICAgdmFyIGdvb2dBdmdFbmNvZGVUaW1lID0gW107XG4gICAgdmFyIGdvb2dBdmdGcmFtZVJhdGVJbnB1dCA9IFtdO1xuICAgIHZhciBnb29nQXZnRnJhbWVSYXRlU2VudCA9IFtdO1xuICAgIHZhciBzdGF0c1JlcG9ydCA9IHt9O1xuICAgIHZhciBmcmFtZVN0YXRzID0gZnJhbWVDaGVja2VyLmZyYW1lU3RhdHM7XG5cbiAgICBmb3IgKHZhciBpbmRleCBpbiBzdGF0cykge1xuICAgICAgaWYgKHN0YXRzW2luZGV4XS50eXBlID09PSAnc3NyYycpIHtcbiAgICAgICAgLy8gTWFrZSBzdXJlIHRvIG9ubHkgY2FwdHVyZSBzdGF0cyBhZnRlciB0aGUgZW5jb2RlciBpcyBzZXR1cC5cbiAgICAgICAgaWYgKHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpID4gMCkge1xuICAgICAgICAgIGdvb2dBdmdFbmNvZGVUaW1lLnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nQXZnRW5jb2RlTXMpKTtcbiAgICAgICAgICBnb29nQXZnRnJhbWVSYXRlSW5wdXQucHVzaChcbiAgICAgICAgICAgICAgcGFyc2VJbnQoc3RhdHNbaW5kZXhdLmdvb2dGcmFtZVJhdGVJbnB1dCkpO1xuICAgICAgICAgIGdvb2dBdmdGcmFtZVJhdGVTZW50LnB1c2goXG4gICAgICAgICAgICAgIHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlU2VudCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgc3RhdHNSZXBvcnQuY2FtZXJhTmFtZSA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpWzBdLmxhYmVsIHx8IE5hTjtcbiAgICBzdGF0c1JlcG9ydC5hY3R1YWxWaWRlb1dpZHRoID0gdmlkZW9FbGVtZW50LnZpZGVvV2lkdGg7XG4gICAgc3RhdHNSZXBvcnQuYWN0dWFsVmlkZW9IZWlnaHQgPSB2aWRlb0VsZW1lbnQudmlkZW9IZWlnaHQ7XG4gICAgc3RhdHNSZXBvcnQubWFuZGF0b3J5V2lkdGggPSByZXNvbHV0aW9uWzBdO1xuICAgIHN0YXRzUmVwb3J0Lm1hbmRhdG9yeUhlaWdodCA9IHJlc29sdXRpb25bMV07XG4gICAgc3RhdHNSZXBvcnQuZW5jb2RlU2V0dXBUaW1lTXMgPVxuICAgICAgICB0aGlzLmV4dHJhY3RFbmNvZGVyU2V0dXBUaW1lXyhzdGF0cywgc3RhdHNUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5hdmdFbmNvZGVUaW1lTXMgPSBhcnJheUF2ZXJhZ2UoZ29vZ0F2Z0VuY29kZVRpbWUpO1xuICAgIHN0YXRzUmVwb3J0Lm1pbkVuY29kZVRpbWVNcyA9IGFycmF5TWluKGdvb2dBdmdFbmNvZGVUaW1lKTtcbiAgICBzdGF0c1JlcG9ydC5tYXhFbmNvZGVUaW1lTXMgPSBhcnJheU1heChnb29nQXZnRW5jb2RlVGltZSk7XG4gICAgc3RhdHNSZXBvcnQuYXZnSW5wdXRGcHMgPSBhcnJheUF2ZXJhZ2UoZ29vZ0F2Z0ZyYW1lUmF0ZUlucHV0KTtcbiAgICBzdGF0c1JlcG9ydC5taW5JbnB1dEZwcyA9IGFycmF5TWluKGdvb2dBdmdGcmFtZVJhdGVJbnB1dCk7XG4gICAgc3RhdHNSZXBvcnQubWF4SW5wdXRGcHMgPSBhcnJheU1heChnb29nQXZnRnJhbWVSYXRlSW5wdXQpO1xuICAgIHN0YXRzUmVwb3J0LmF2Z1NlbnRGcHMgPSBhcnJheUF2ZXJhZ2UoZ29vZ0F2Z0ZyYW1lUmF0ZVNlbnQpO1xuICAgIHN0YXRzUmVwb3J0Lm1pblNlbnRGcHMgPSBhcnJheU1pbihnb29nQXZnRnJhbWVSYXRlU2VudCk7XG4gICAgc3RhdHNSZXBvcnQubWF4U2VudEZwcyA9IGFycmF5TWF4KGdvb2dBdmdGcmFtZVJhdGVTZW50KTtcbiAgICBzdGF0c1JlcG9ydC5pc011dGVkID0gdGhpcy5pc011dGVkO1xuICAgIHN0YXRzUmVwb3J0LnRlc3RlZEZyYW1lcyA9IGZyYW1lU3RhdHMubnVtRnJhbWVzO1xuICAgIHN0YXRzUmVwb3J0LmJsYWNrRnJhbWVzID0gZnJhbWVTdGF0cy5udW1CbGFja0ZyYW1lcztcbiAgICBzdGF0c1JlcG9ydC5mcm96ZW5GcmFtZXMgPSBmcmFtZVN0YXRzLm51bUZyb3plbkZyYW1lcztcblxuICAgIC8vIFRPRE86IEFkZCBhIHJlcG9ydEluZm8oKSBmdW5jdGlvbiB3aXRoIGEgdGFibGUgZm9ybWF0IHRvIGRpc3BsYXlcbiAgICAvLyB2YWx1ZXMgY2xlYXJlci5cbiAgICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3ZpZGVvLXN0YXRzJywgc3RhdHNSZXBvcnQpO1xuXG4gICAgdGhpcy50ZXN0RXhwZWN0YXRpb25zXyhzdGF0c1JlcG9ydCk7XG4gIH0sXG5cbiAgZW5kQ2FsbF86IGZ1bmN0aW9uKGNhbGxPYmplY3QsIHN0cmVhbSkge1xuICAgIHRoaXMuaXNTaHV0dGluZ0Rvd24gPSB0cnVlO1xuICAgIHN0cmVhbS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICB0cmFjay5zdG9wKCk7XG4gICAgfSk7XG4gICAgY2FsbE9iamVjdC5jbG9zZSgpO1xuICB9LFxuXG4gIGV4dHJhY3RFbmNvZGVyU2V0dXBUaW1lXzogZnVuY3Rpb24oc3RhdHMsIHN0YXRzVGltZSkge1xuICAgIGZvciAodmFyIGluZGV4ID0gMDsgaW5kZXggIT09IHN0YXRzLmxlbmd0aDsgaW5kZXgrKykge1xuICAgICAgaWYgKHN0YXRzW2luZGV4XS50eXBlID09PSAnc3NyYycpIHtcbiAgICAgICAgaWYgKHBhcnNlSW50KHN0YXRzW2luZGV4XS5nb29nRnJhbWVSYXRlSW5wdXQpID4gMCkge1xuICAgICAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShzdGF0c1RpbWVbaW5kZXhdIC0gc3RhdHNUaW1lWzBdKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gTmFOO1xuICB9LFxuXG4gIHJlc29sdXRpb25NYXRjaGVzSW5kZXBlbmRlbnRPZlJvdGF0aW9uT3JDcm9wXzogZnVuY3Rpb24oYVdpZHRoLCBhSGVpZ2h0LFxuICAgIGJXaWR0aCwgYkhlaWdodCkge1xuICAgIHZhciBtaW5SZXMgPSBNYXRoLm1pbihiV2lkdGgsIGJIZWlnaHQpO1xuICAgIHJldHVybiAoYVdpZHRoID09PSBiV2lkdGggJiYgYUhlaWdodCA9PT0gYkhlaWdodCkgfHxcbiAgICAgICAgICAgKGFXaWR0aCA9PT0gYkhlaWdodCAmJiBhSGVpZ2h0ID09PSBiV2lkdGgpIHx8XG4gICAgICAgICAgIChhV2lkdGggPT09IG1pblJlcyAmJiBiSGVpZ2h0ID09PSBtaW5SZXMpO1xuICB9LFxuXG4gIHRlc3RFeHBlY3RhdGlvbnNfOiBmdW5jdGlvbihpbmZvKSB7XG4gICAgdmFyIG5vdEF2YWlsYWJsZVN0YXRzID0gW107XG4gICAgZm9yICh2YXIga2V5IGluIGluZm8pIHtcbiAgICAgIGlmIChpbmZvLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBpbmZvW2tleV0gPT09ICdudW1iZXInICYmIGlzTmFOKGluZm9ba2V5XSkpIHtcbiAgICAgICAgICBub3RBdmFpbGFibGVTdGF0cy5wdXNoKGtleSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oa2V5ICsgJzogJyArIGluZm9ba2V5XSk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKG5vdEF2YWlsYWJsZVN0YXRzLmxlbmd0aCAhPT0gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ05vdCBhdmFpbGFibGU6ICcgKyBub3RBdmFpbGFibGVTdGF0cy5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4oaW5mby5hdmdTZW50RnBzKSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ0Nhbm5vdCB2ZXJpZnkgc2VudCBGUFMuJyk7XG4gICAgfSBlbHNlIGlmIChpbmZvLmF2Z1NlbnRGcHMgPCA1KSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0xvdyBhdmVyYWdlIHNlbnQgRlBTOiAnICsgaW5mby5hdmdTZW50RnBzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0F2ZXJhZ2UgRlBTIGFib3ZlIHRocmVzaG9sZCcpO1xuICAgIH1cbiAgICBpZiAoIXRoaXMucmVzb2x1dGlvbk1hdGNoZXNJbmRlcGVuZGVudE9mUm90YXRpb25PckNyb3BfKFxuICAgICAgICBpbmZvLmFjdHVhbFZpZGVvV2lkdGgsIGluZm8uYWN0dWFsVmlkZW9IZWlnaHQsIGluZm8ubWFuZGF0b3J5V2lkdGgsXG4gICAgICAgIGluZm8ubWFuZGF0b3J5SGVpZ2h0KSkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdJbmNvcnJlY3QgY2FwdHVyZWQgcmVzb2x1dGlvbi4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ0NhcHR1cmVkIHZpZGVvIHVzaW5nIGV4cGVjdGVkIHJlc29sdXRpb24uJyk7XG4gICAgfVxuICAgIGlmIChpbmZvLnRlc3RlZEZyYW1lcyA9PT0gMCkge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDb3VsZCBub3QgYW5hbHl6ZSBhbnkgdmlkZW8gZnJhbWUuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChpbmZvLmJsYWNrRnJhbWVzID4gaW5mby50ZXN0ZWRGcmFtZXMgLyAzKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignQ2FtZXJhIGRlbGl2ZXJpbmcgbG90cyBvZiBibGFjayBmcmFtZXMuJyk7XG4gICAgICB9XG4gICAgICBpZiAoaW5mby5mcm96ZW5GcmFtZXMgPiBpbmZvLnRlc3RlZEZyYW1lcyAvIDMpIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdDYW1lcmEgZGVsaXZlcmluZyBsb3RzIG9mIGZyb3plbiBmcmFtZXMuJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBDYW1SZXNvbHV0aW9uc1Rlc3Q7XG4iLCIndXNlIHN0cmljdCc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL0NhbGwuanMnO1xuXG5mdW5jdGlvbiBSdW5Db25uZWN0aXZpdHlUZXN0KHRlc3QsIGljZUNhbmRpZGF0ZUZpbHRlcikge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlciA9IGljZUNhbmRpZGF0ZUZpbHRlcjtcbiAgdGhpcy50aW1lb3V0ID0gbnVsbDtcbiAgdGhpcy5wYXJzZWRDYW5kaWRhdGVzID0gW107XG4gIHRoaXMuY2FsbCA9IG51bGw7XG59XG5cblJ1bkNvbm5lY3Rpdml0eVRlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIENhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnKHRoaXMuc3RhcnQuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KSxcbiAgICAgICAgdGhpcy50ZXN0KTtcbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5jYWxsID0gbmV3IENhbGwoY29uZmlnLCB0aGlzLnRlc3QpO1xuICAgIHRoaXMuY2FsbC5zZXRJY2VDYW5kaWRhdGVGaWx0ZXIodGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIpO1xuXG4gICAgLy8gQ29sbGVjdCBhbGwgY2FuZGlkYXRlcyBmb3IgdmFsaWRhdGlvbi5cbiAgICB0aGlzLmNhbGwucGMxLmFkZEV2ZW50TGlzdGVuZXIoJ2ljZWNhbmRpZGF0ZScsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICBpZiAoZXZlbnQuY2FuZGlkYXRlKSB7XG4gICAgICAgIHZhciBwYXJzZWRDYW5kaWRhdGUgPSBDYWxsLnBhcnNlQ2FuZGlkYXRlKGV2ZW50LmNhbmRpZGF0ZS5jYW5kaWRhdGUpO1xuICAgICAgICB0aGlzLnBhcnNlZENhbmRpZGF0ZXMucHVzaChwYXJzZWRDYW5kaWRhdGUpO1xuXG4gICAgICAgIC8vIFJlcG9ydCBjYW5kaWRhdGUgaW5mbyBiYXNlZCBvbiBpY2VDYW5kaWRhdGVGaWx0ZXIuXG4gICAgICAgIGlmICh0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcihwYXJzZWRDYW5kaWRhdGUpKSB7XG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oXG4gICAgICAgICAgICAgICdHYXRoZXJlZCBjYW5kaWRhdGUgb2YgVHlwZTogJyArIHBhcnNlZENhbmRpZGF0ZS50eXBlICtcbiAgICAgICAgICAgICcgUHJvdG9jb2w6ICcgKyBwYXJzZWRDYW5kaWRhdGUucHJvdG9jb2wgK1xuICAgICAgICAgICAgJyBBZGRyZXNzOiAnICsgcGFyc2VkQ2FuZGlkYXRlLmFkZHJlc3MpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfS5iaW5kKHRoaXMpKTtcblxuICAgIHZhciBjaDEgPSB0aGlzLmNhbGwucGMxLmNyZWF0ZURhdGFDaGFubmVsKG51bGwpO1xuICAgIGNoMS5hZGRFdmVudExpc3RlbmVyKCdvcGVuJywgZnVuY3Rpb24oKSB7XG4gICAgICBjaDEuc2VuZCgnaGVsbG8nKTtcbiAgICB9KTtcbiAgICBjaDEuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICBpZiAoZXZlbnQuZGF0YSAhPT0gJ3dvcmxkJykge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0ludmFsaWQgZGF0YSB0cmFuc21pdHRlZC4nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdEYXRhIHN1Y2Nlc3NmdWxseSB0cmFuc21pdHRlZCBiZXR3ZWVuIHBlZXJzLicpO1xuICAgICAgfVxuICAgICAgdGhpcy5oYW5ndXAoKTtcbiAgICB9LmJpbmQodGhpcykpO1xuICAgIHRoaXMuY2FsbC5wYzIuYWRkRXZlbnRMaXN0ZW5lcignZGF0YWNoYW5uZWwnLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgdmFyIGNoMiA9IGV2ZW50LmNoYW5uZWw7XG4gICAgICBjaDIuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGlmIChldmVudC5kYXRhICE9PSAnaGVsbG8nKSB7XG4gICAgICAgICAgdGhpcy5oYW5ndXAoJ0ludmFsaWQgZGF0YSB0cmFuc21pdHRlZC4nKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjaDIuc2VuZCgnd29ybGQnKTtcbiAgICAgICAgfVxuICAgICAgfS5iaW5kKHRoaXMpKTtcbiAgICB9LmJpbmQodGhpcykpO1xuICAgIHRoaXMuY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gICAgdGhpcy50aW1lb3V0ID0gc2V0VGltZW91dCh0aGlzLmhhbmd1cC5iaW5kKHRoaXMsICdUaW1lZCBvdXQnKSwgNTAwMCk7XG4gIH0sXG5cbiAgZmluZFBhcnNlZENhbmRpZGF0ZU9mU3BlY2lmaWVkVHlwZTogZnVuY3Rpb24oY2FuZGlkYXRlVHlwZU1ldGhvZCkge1xuICAgIGZvciAodmFyIGNhbmRpZGF0ZSBpbiB0aGlzLnBhcnNlZENhbmRpZGF0ZXMpIHtcbiAgICAgIGlmIChjYW5kaWRhdGVUeXBlTWV0aG9kKHRoaXMucGFyc2VkQ2FuZGlkYXRlc1tjYW5kaWRhdGVdKSkge1xuICAgICAgICByZXR1cm4gY2FuZGlkYXRlVHlwZU1ldGhvZCh0aGlzLnBhcnNlZENhbmRpZGF0ZXNbY2FuZGlkYXRlXSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIGhhbmd1cDogZnVuY3Rpb24oZXJyb3JNZXNzYWdlKSB7XG4gICAgaWYgKGVycm9yTWVzc2FnZSkge1xuICAgICAgLy8gUmVwb3J0IHdhcm5pbmcgZm9yIHNlcnZlciByZWZsZXhpdmUgdGVzdCBpZiBpdCB0aW1lcyBvdXQuXG4gICAgICBpZiAoZXJyb3JNZXNzYWdlID09PSAnVGltZWQgb3V0JyAmJlxuICAgICAgICAgIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyLnRvU3RyaW5nKCkgPT09IENhbGwuaXNSZWZsZXhpdmUudG9TdHJpbmcoKSAmJlxuICAgICAgICAgIHRoaXMuZmluZFBhcnNlZENhbmRpZGF0ZU9mU3BlY2lmaWVkVHlwZShDYWxsLmlzUmVmbGV4aXZlKSkge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnQ291bGQgbm90IGNvbm5lY3QgdXNpbmcgcmVmbGV4aXZlICcgK1xuICAgICAgICAgICAgJ2NhbmRpZGF0ZXMsIGxpa2VseSBkdWUgdG8gdGhlIG5ldHdvcmsgZW52aXJvbm1lbnQvY29uZmlndXJhdGlvbi4nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcihlcnJvck1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH1cbiAgICBjbGVhclRpbWVvdXQodGhpcy50aW1lb3V0KTtcbiAgICB0aGlzLmNhbGwuY2xvc2UoKTtcbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBSdW5Db25uZWN0aXZpdHlUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9DYWxsLmpzJztcblxuZnVuY3Rpb24gRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdCh0ZXN0KSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMudGVzdER1cmF0aW9uU2Vjb25kcyA9IDUuMDtcbiAgdGhpcy5zdGFydFRpbWUgPSBudWxsO1xuICB0aGlzLnNlbnRQYXlsb2FkQnl0ZXMgPSAwO1xuICB0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzID0gMDtcbiAgdGhpcy5zdG9wU2VuZGluZyA9IGZhbHNlO1xuICB0aGlzLnNhbXBsZVBhY2tldCA9ICcnO1xuXG4gIGZvciAodmFyIGkgPSAwOyBpICE9PSAxMDI0OyArK2kpIHtcbiAgICB0aGlzLnNhbXBsZVBhY2tldCArPSAnaCc7XG4gIH1cblxuICB0aGlzLm1heE51bWJlck9mUGFja2V0c1RvU2VuZCA9IDE7XG4gIHRoaXMuYnl0ZXNUb0tlZXBCdWZmZXJlZCA9IDEwMjQgKiB0aGlzLm1heE51bWJlck9mUGFja2V0c1RvU2VuZDtcbiAgdGhpcy5sYXN0Qml0cmF0ZU1lYXN1cmVUaW1lID0gbnVsbDtcbiAgdGhpcy5sYXN0UmVjZWl2ZWRQYXlsb2FkQnl0ZXMgPSAwO1xuXG4gIHRoaXMuY2FsbCA9IG51bGw7XG4gIHRoaXMuc2VuZGVyQ2hhbm5lbCA9IG51bGw7XG4gIHRoaXMucmVjZWl2ZUNoYW5uZWwgPSBudWxsO1xufVxuXG5EYXRhQ2hhbm5lbFRocm91Z2hwdXRUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdCksIHRoaXMudGVzdCk7XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMuY2FsbCA9IG5ldyBDYWxsKGNvbmZpZywgdGhpcy50ZXN0KTtcbiAgICB0aGlzLmNhbGwuc2V0SWNlQ2FuZGlkYXRlRmlsdGVyKENhbGwuaXNSZWxheSk7XG4gICAgdGhpcy5zZW5kZXJDaGFubmVsID0gdGhpcy5jYWxsLnBjMS5jcmVhdGVEYXRhQ2hhbm5lbChudWxsKTtcbiAgICB0aGlzLnNlbmRlckNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsIHRoaXMuc2VuZGluZ1N0ZXAuYmluZCh0aGlzKSk7XG5cbiAgICB0aGlzLmNhbGwucGMyLmFkZEV2ZW50TGlzdGVuZXIoJ2RhdGFjaGFubmVsJyxcbiAgICAgICAgdGhpcy5vblJlY2VpdmVyQ2hhbm5lbC5iaW5kKHRoaXMpKTtcblxuICAgIHRoaXMuY2FsbC5lc3RhYmxpc2hDb25uZWN0aW9uKCk7XG4gIH0sXG5cbiAgb25SZWNlaXZlckNoYW5uZWw6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgdGhpcy5yZWNlaXZlQ2hhbm5lbCA9IGV2ZW50LmNoYW5uZWw7XG4gICAgdGhpcy5yZWNlaXZlQ2hhbm5lbC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJyxcbiAgICAgICAgdGhpcy5vbk1lc3NhZ2VSZWNlaXZlZC5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBzZW5kaW5nU3RlcDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgaWYgKCF0aGlzLnN0YXJ0VGltZSkge1xuICAgICAgdGhpcy5zdGFydFRpbWUgPSBub3c7XG4gICAgICB0aGlzLmxhc3RCaXRyYXRlTWVhc3VyZVRpbWUgPSBub3c7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgIT09IHRoaXMubWF4TnVtYmVyT2ZQYWNrZXRzVG9TZW5kOyArK2kpIHtcbiAgICAgIGlmICh0aGlzLnNlbmRlckNoYW5uZWwuYnVmZmVyZWRBbW91bnQgPj0gdGhpcy5ieXRlc1RvS2VlcEJ1ZmZlcmVkKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgdGhpcy5zZW50UGF5bG9hZEJ5dGVzICs9IHRoaXMuc2FtcGxlUGFja2V0Lmxlbmd0aDtcbiAgICAgIHRoaXMuc2VuZGVyQ2hhbm5lbC5zZW5kKHRoaXMuc2FtcGxlUGFja2V0KTtcbiAgICB9XG5cbiAgICBpZiAobm93IC0gdGhpcy5zdGFydFRpbWUgPj0gMTAwMCAqIHRoaXMudGVzdER1cmF0aW9uU2Vjb25kcykge1xuICAgICAgdGhpcy50ZXN0LnNldFByb2dyZXNzKDEwMCk7XG4gICAgICB0aGlzLnN0b3BTZW5kaW5nID0gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnNldFByb2dyZXNzKChub3cgLSB0aGlzLnN0YXJ0VGltZSkgL1xuICAgICAgICAgICgxMCAqIHRoaXMudGVzdER1cmF0aW9uU2Vjb25kcykpO1xuICAgICAgc2V0VGltZW91dCh0aGlzLnNlbmRpbmdTdGVwLmJpbmQodGhpcyksIDEpO1xuICAgIH1cbiAgfSxcblxuICBvbk1lc3NhZ2VSZWNlaXZlZDogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICB0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzICs9IGV2ZW50LmRhdGEubGVuZ3RoO1xuICAgIHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuICAgIGlmIChub3cgLSB0aGlzLmxhc3RCaXRyYXRlTWVhc3VyZVRpbWUgPj0gMTAwMCkge1xuICAgICAgdmFyIGJpdHJhdGUgPSAodGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcyAtXG4gICAgICAgICAgdGhpcy5sYXN0UmVjZWl2ZWRQYXlsb2FkQnl0ZXMpIC8gKG5vdyAtIHRoaXMubGFzdEJpdHJhdGVNZWFzdXJlVGltZSk7XG4gICAgICBiaXRyYXRlID0gTWF0aC5yb3VuZChiaXRyYXRlICogMTAwMCAqIDgpIC8gMTAwMDtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdUcmFuc21pdHRpbmcgYXQgJyArIGJpdHJhdGUgKyAnIGticHMuJyk7XG4gICAgICB0aGlzLmxhc3RSZWNlaXZlZFBheWxvYWRCeXRlcyA9IHRoaXMucmVjZWl2ZWRQYXlsb2FkQnl0ZXM7XG4gICAgICB0aGlzLmxhc3RCaXRyYXRlTWVhc3VyZVRpbWUgPSBub3c7XG4gICAgfVxuICAgIGlmICh0aGlzLnN0b3BTZW5kaW5nICYmXG4gICAgICAgIHRoaXMuc2VudFBheWxvYWRCeXRlcyA9PT0gdGhpcy5yZWNlaXZlZFBheWxvYWRCeXRlcykge1xuICAgICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgICB0aGlzLmNhbGwgPSBudWxsO1xuXG4gICAgICB2YXIgZWxhcHNlZFRpbWUgPSBNYXRoLnJvdW5kKChub3cgLSB0aGlzLnN0YXJ0VGltZSkgKiAxMCkgLyAxMDAwMC4wO1xuICAgICAgdmFyIHJlY2VpdmVkS0JpdHMgPSB0aGlzLnJlY2VpdmVkUGF5bG9hZEJ5dGVzICogOCAvIDEwMDA7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnVG90YWwgdHJhbnNtaXR0ZWQ6ICcgKyByZWNlaXZlZEtCaXRzICtcbiAgICAgICAgICAnIGtpbG8tYml0cyBpbiAnICsgZWxhcHNlZFRpbWUgKyAnIHNlY29uZHMuJyk7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgIH1cbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgRGF0YUNoYW5uZWxUaHJvdWdocHV0VGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gTWljVGVzdCh0ZXN0KSB7XG4gIHRoaXMudGVzdCA9IHRlc3Q7XG4gIHRoaXMuaW5wdXRDaGFubmVsQ291bnQgPSA2O1xuICB0aGlzLm91dHB1dENoYW5uZWxDb3VudCA9IDI7XG4gIC8vIEJ1ZmZlciBzaXplIHNldCB0byAwIHRvIGxldCBDaHJvbWUgY2hvb3NlIGJhc2VkIG9uIHRoZSBwbGF0Zm9ybS5cbiAgdGhpcy5idWZmZXJTaXplID0gMDtcbiAgLy8gVHVybmluZyBvZmYgZWNob0NhbmNlbGxhdGlvbiBjb25zdHJhaW50IGVuYWJsZXMgc3RlcmVvIGlucHV0LlxuICB0aGlzLmNvbnN0cmFpbnRzID0ge1xuICAgIGF1ZGlvOiB7XG4gICAgICBvcHRpb25hbDogW1xuICAgICAgICB7ZWNob0NhbmNlbGxhdGlvbjogZmFsc2V9XG4gICAgICBdXG4gICAgfVxuICB9O1xuXG4gIHRoaXMuY29sbGVjdFNlY29uZHMgPSAyLjA7XG4gIC8vIEF0IGxlYXN0IG9uZSBMU0IgMTYtYml0IGRhdGEgKGNvbXBhcmUgaXMgb24gYWJzb2x1dGUgdmFsdWUpLlxuICB0aGlzLnNpbGVudFRocmVzaG9sZCA9IDEuMCAvIDMyNzY3O1xuICB0aGlzLmxvd1ZvbHVtZVRocmVzaG9sZCA9IC02MDtcbiAgLy8gRGF0YSBtdXN0IGJlIGlkZW50aWNhbCB3aXRoaW4gb25lIExTQiAxNi1iaXQgdG8gYmUgaWRlbnRpZmllZCBhcyBtb25vLlxuICB0aGlzLm1vbm9EZXRlY3RUaHJlc2hvbGQgPSAxLjAgLyA2NTUzNjtcbiAgLy8gTnVtYmVyIG9mIGNvbnNlcXV0aXZlIGNsaXBUaHJlc2hvbGQgbGV2ZWwgc2FtcGxlcyB0aGF0IGluZGljYXRlIGNsaXBwaW5nLlxuICB0aGlzLmNsaXBDb3VudFRocmVzaG9sZCA9IDY7XG4gIHRoaXMuY2xpcFRocmVzaG9sZCA9IDEuMDtcblxuICAvLyBQb3B1bGF0ZWQgd2l0aCBhdWRpbyBhcyBhIDMtZGltZW5zaW9uYWwgYXJyYXk6XG4gIC8vICAgY29sbGVjdGVkQXVkaW9bY2hhbm5lbHNdW2J1ZmZlcnNdW3NhbXBsZXNdXG4gIHRoaXMuY29sbGVjdGVkQXVkaW8gPSBbXTtcbiAgdGhpcy5jb2xsZWN0ZWRTYW1wbGVDb3VudCA9IDA7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5pbnB1dENoYW5uZWxDb3VudDsgKytpKSB7XG4gICAgdGhpcy5jb2xsZWN0ZWRBdWRpb1tpXSA9IFtdO1xuICB9XG4gIHRyeSB7XG4gICAgd2luZG93LkF1ZGlvQ29udGV4dCA9IHdpbmRvdy5BdWRpb0NvbnRleHQgfHwgd2luZG93LndlYmtpdEF1ZGlvQ29udGV4dDtcbiAgICB0aGlzLmF1ZGlvQ29udGV4dCA9IG5ldyBBdWRpb0NvbnRleHQoKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0ZhaWxlZCB0byBpbnN0YW50aWF0ZSBhbiBhdWRpbyBjb250ZXh0LCBlcnJvcjogJyArIGUpO1xuICB9XG59XG5cbk1pY1Rlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0eXBlb2YgdGhpcy5hdWRpb0NvbnRleHQgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1dlYkF1ZGlvIGlzIG5vdCBzdXBwb3J0ZWQsIHRlc3QgY2Fubm90IHJ1bi4nKTtcbiAgICAgIHRoaXMudGVzdC5kb25lKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5kb0dldFVzZXJNZWRpYSh0aGlzLmNvbnN0cmFpbnRzLCB0aGlzLmdvdFN0cmVhbS5iaW5kKHRoaXMpKTtcbiAgICB9XG4gIH0sXG5cbiAgZ290U3RyZWFtOiBmdW5jdGlvbihzdHJlYW0pIHtcbiAgICBpZiAoIXRoaXMuY2hlY2tBdWRpb1RyYWNrcyhzdHJlYW0pKSB7XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmNyZWF0ZUF1ZGlvQnVmZmVyKHN0cmVhbSk7XG4gIH0sXG5cbiAgY2hlY2tBdWRpb1RyYWNrczogZnVuY3Rpb24oc3RyZWFtKSB7XG4gICAgdGhpcy5zdHJlYW0gPSBzdHJlYW07XG4gICAgdmFyIGF1ZGlvVHJhY2tzID0gc3RyZWFtLmdldEF1ZGlvVHJhY2tzKCk7XG4gICAgaWYgKGF1ZGlvVHJhY2tzLmxlbmd0aCA8IDEpIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTm8gYXVkaW8gdHJhY2sgaW4gcmV0dXJuZWQgc3RyZWFtLicpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQXVkaW8gdHJhY2sgY3JlYXRlZCB1c2luZyBkZXZpY2U9JyArXG4gICAgICAgIGF1ZGlvVHJhY2tzWzBdLmxhYmVsKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBjcmVhdGVBdWRpb0J1ZmZlcjogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5hdWRpb1NvdXJjZSA9IHRoaXMuYXVkaW9Db250ZXh0LmNyZWF0ZU1lZGlhU3RyZWFtU291cmNlKHRoaXMuc3RyZWFtKTtcbiAgICB0aGlzLnNjcmlwdE5vZGUgPSB0aGlzLmF1ZGlvQ29udGV4dC5jcmVhdGVTY3JpcHRQcm9jZXNzb3IodGhpcy5idWZmZXJTaXplLFxuICAgICAgICB0aGlzLmlucHV0Q2hhbm5lbENvdW50LCB0aGlzLm91dHB1dENoYW5uZWxDb3VudCk7XG4gICAgdGhpcy5hdWRpb1NvdXJjZS5jb25uZWN0KHRoaXMuc2NyaXB0Tm9kZSk7XG4gICAgdGhpcy5zY3JpcHROb2RlLmNvbm5lY3QodGhpcy5hdWRpb0NvbnRleHQuZGVzdGluYXRpb24pO1xuICAgIHRoaXMuc2NyaXB0Tm9kZS5vbmF1ZGlvcHJvY2VzcyA9IHRoaXMuY29sbGVjdEF1ZGlvLmJpbmQodGhpcyk7XG4gICAgdGhpcy5zdG9wQ29sbGVjdGluZ0F1ZGlvID0gdGhpcy50ZXN0LnNldFRpbWVvdXRXaXRoUHJvZ3Jlc3NCYXIoXG4gICAgICAgIHRoaXMub25TdG9wQ29sbGVjdGluZ0F1ZGlvLmJpbmQodGhpcyksIDUwMDApO1xuICB9LFxuXG4gIGNvbGxlY3RBdWRpbzogZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAvLyBTaW1wbGUgc2lsZW5jZSBkZXRlY3Rpb246IGNoZWNrIGZpcnN0IGFuZCBsYXN0IHNhbXBsZSBvZiBlYWNoIGNoYW5uZWwgaW5cbiAgICAvLyB0aGUgYnVmZmVyLiBJZiBib3RoIGFyZSBiZWxvdyBhIHRocmVzaG9sZCwgdGhlIGJ1ZmZlciBpcyBjb25zaWRlcmVkXG4gICAgLy8gc2lsZW50LlxuICAgIHZhciBzYW1wbGVDb3VudCA9IGV2ZW50LmlucHV0QnVmZmVyLmxlbmd0aDtcbiAgICB2YXIgYWxsU2lsZW50ID0gdHJ1ZTtcbiAgICBmb3IgKHZhciBjID0gMDsgYyA8IGV2ZW50LmlucHV0QnVmZmVyLm51bWJlck9mQ2hhbm5lbHM7IGMrKykge1xuICAgICAgdmFyIGRhdGEgPSBldmVudC5pbnB1dEJ1ZmZlci5nZXRDaGFubmVsRGF0YShjKTtcbiAgICAgIHZhciBmaXJzdCA9IE1hdGguYWJzKGRhdGFbMF0pO1xuICAgICAgdmFyIGxhc3QgPSBNYXRoLmFicyhkYXRhW3NhbXBsZUNvdW50IC0gMV0pO1xuICAgICAgdmFyIG5ld0J1ZmZlcjtcbiAgICAgIGlmIChmaXJzdCA+IHRoaXMuc2lsZW50VGhyZXNob2xkIHx8IGxhc3QgPiB0aGlzLnNpbGVudFRocmVzaG9sZCkge1xuICAgICAgICAvLyBOb24tc2lsZW50IGJ1ZmZlcnMgYXJlIGNvcGllZCBmb3IgYW5hbHlzaXMuIE5vdGUgdGhhdCB0aGUgc2lsZW50XG4gICAgICAgIC8vIGRldGVjdGlvbiB3aWxsIGxpa2VseSBjYXVzZSB0aGUgc3RvcmVkIHN0cmVhbSB0byBjb250YWluIGRpc2NvbnRpbnUtXG4gICAgICAgIC8vIGl0aWVzLCBidXQgdGhhdCBpcyBvayBmb3Igb3VyIG5lZWRzIGhlcmUgKGp1c3QgbG9va2luZyBhdCBsZXZlbHMpLlxuICAgICAgICBuZXdCdWZmZXIgPSBuZXcgRmxvYXQzMkFycmF5KHNhbXBsZUNvdW50KTtcbiAgICAgICAgbmV3QnVmZmVyLnNldChkYXRhKTtcbiAgICAgICAgYWxsU2lsZW50ID0gZmFsc2U7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBTaWxlbnQgYnVmZmVycyBhcmUgbm90IGNvcGllZCwgYnV0IHdlIHN0b3JlIGVtcHR5IGJ1ZmZlcnMgc28gdGhhdCB0aGVcbiAgICAgICAgLy8gYW5hbHlzaXMgZG9lc24ndCBoYXZlIHRvIGNhcmUuXG4gICAgICAgIG5ld0J1ZmZlciA9IG5ldyBGbG9hdDMyQXJyYXkoKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuY29sbGVjdGVkQXVkaW9bY10ucHVzaChuZXdCdWZmZXIpO1xuICAgIH1cbiAgICBpZiAoIWFsbFNpbGVudCkge1xuICAgICAgdGhpcy5jb2xsZWN0ZWRTYW1wbGVDb3VudCArPSBzYW1wbGVDb3VudDtcbiAgICAgIGlmICgodGhpcy5jb2xsZWN0ZWRTYW1wbGVDb3VudCAvIGV2ZW50LmlucHV0QnVmZmVyLnNhbXBsZVJhdGUpID49XG4gICAgICAgICAgdGhpcy5jb2xsZWN0U2Vjb25kcykge1xuICAgICAgICB0aGlzLnN0b3BDb2xsZWN0aW5nQXVkaW8oKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgb25TdG9wQ29sbGVjdGluZ0F1ZGlvOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN0cmVhbS5nZXRBdWRpb1RyYWNrcygpWzBdLnN0b3AoKTtcbiAgICB0aGlzLmF1ZGlvU291cmNlLmRpc2Nvbm5lY3QodGhpcy5zY3JpcHROb2RlKTtcbiAgICB0aGlzLnNjcmlwdE5vZGUuZGlzY29ubmVjdCh0aGlzLmF1ZGlvQ29udGV4dC5kZXN0aW5hdGlvbik7XG4gICAgdGhpcy5hbmFseXplQXVkaW8odGhpcy5jb2xsZWN0ZWRBdWRpbyk7XG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfSxcblxuICBhbmFseXplQXVkaW86IGZ1bmN0aW9uKGNoYW5uZWxzKSB7XG4gICAgdmFyIGFjdGl2ZUNoYW5uZWxzID0gW107XG4gICAgZm9yICh2YXIgYyA9IDA7IGMgPCBjaGFubmVscy5sZW5ndGg7IGMrKykge1xuICAgICAgaWYgKHRoaXMuY2hhbm5lbFN0YXRzKGMsIGNoYW5uZWxzW2NdKSkge1xuICAgICAgICBhY3RpdmVDaGFubmVscy5wdXNoKGMpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoYWN0aXZlQ2hhbm5lbHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ05vIGFjdGl2ZSBpbnB1dCBjaGFubmVscyBkZXRlY3RlZC4gTWljcm9waG9uZSAnICtcbiAgICAgICAgICAnaXMgbW9zdCBsaWtlbHkgbXV0ZWQgb3IgYnJva2VuLCBwbGVhc2UgY2hlY2sgaWYgbXV0ZWQgaW4gdGhlICcgK1xuICAgICAgICAgICdzb3VuZCBzZXR0aW5ncyBvciBwaHlzaWNhbGx5IG9uIHRoZSBkZXZpY2UuIFRoZW4gcmVydW4gdGhlIHRlc3QuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdBY3RpdmUgYXVkaW8gaW5wdXQgY2hhbm5lbHM6ICcgK1xuICAgICAgICAgIGFjdGl2ZUNoYW5uZWxzLmxlbmd0aCk7XG4gICAgfVxuICAgIGlmIChhY3RpdmVDaGFubmVscy5sZW5ndGggPT09IDIpIHtcbiAgICAgIHRoaXMuZGV0ZWN0TW9ubyhjaGFubmVsc1thY3RpdmVDaGFubmVsc1swXV0sIGNoYW5uZWxzW2FjdGl2ZUNoYW5uZWxzWzFdXSk7XG4gICAgfVxuICB9LFxuXG4gIGNoYW5uZWxTdGF0czogZnVuY3Rpb24oY2hhbm5lbE51bWJlciwgYnVmZmVycykge1xuICAgIHZhciBtYXhQZWFrID0gMC4wO1xuICAgIHZhciBtYXhSbXMgPSAwLjA7XG4gICAgdmFyIGNsaXBDb3VudCA9IDA7XG4gICAgdmFyIG1heENsaXBDb3VudCA9IDA7XG4gICAgZm9yICh2YXIgaiA9IDA7IGogPCBidWZmZXJzLmxlbmd0aDsgaisrKSB7XG4gICAgICB2YXIgc2FtcGxlcyA9IGJ1ZmZlcnNbal07XG4gICAgICBpZiAoc2FtcGxlcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHZhciBzID0gMDtcbiAgICAgICAgdmFyIHJtcyA9IDAuMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzYW1wbGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgcyA9IE1hdGguYWJzKHNhbXBsZXNbaV0pO1xuICAgICAgICAgIG1heFBlYWsgPSBNYXRoLm1heChtYXhQZWFrLCBzKTtcbiAgICAgICAgICBybXMgKz0gcyAqIHM7XG4gICAgICAgICAgaWYgKG1heFBlYWsgPj0gdGhpcy5jbGlwVGhyZXNob2xkKSB7XG4gICAgICAgICAgICBjbGlwQ291bnQrKztcbiAgICAgICAgICAgIG1heENsaXBDb3VudCA9IE1hdGgubWF4KG1heENsaXBDb3VudCwgY2xpcENvdW50KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2xpcENvdW50ID0gMDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gUk1TIGlzIGNhbGN1bGF0ZWQgb3ZlciBlYWNoIGJ1ZmZlciwgbWVhbmluZyB0aGUgaW50ZWdyYXRpb24gdGltZSB3aWxsXG4gICAgICAgIC8vIGJlIGRpZmZlcmVudCBkZXBlbmRpbmcgb24gc2FtcGxlIHJhdGUgYW5kIGJ1ZmZlciBzaXplLiBJbiBwcmFjdGlzZVxuICAgICAgICAvLyB0aGlzIHNob3VsZCBiZSBhIHNtYWxsIHByb2JsZW0uXG4gICAgICAgIHJtcyA9IE1hdGguc3FydChybXMgLyBzYW1wbGVzLmxlbmd0aCk7XG4gICAgICAgIG1heFJtcyA9IE1hdGgubWF4KG1heFJtcywgcm1zKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobWF4UGVhayA+IHRoaXMuc2lsZW50VGhyZXNob2xkKSB7XG4gICAgICB2YXIgZEJQZWFrID0gdGhpcy5kQkZTKG1heFBlYWspO1xuICAgICAgdmFyIGRCUm1zID0gdGhpcy5kQkZTKG1heFJtcyk7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnQ2hhbm5lbCAnICsgY2hhbm5lbE51bWJlciArICcgbGV2ZWxzOiAnICtcbiAgICAgICAgICBkQlBlYWsudG9GaXhlZCgxKSArICcgZEIgKHBlYWspLCAnICsgZEJSbXMudG9GaXhlZCgxKSArICcgZEIgKFJNUyknKTtcbiAgICAgIGlmIChkQlJtcyA8IHRoaXMubG93Vm9sdW1lVGhyZXNob2xkKSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignTWljcm9waG9uZSBpbnB1dCBsZXZlbCBpcyBsb3csIGluY3JlYXNlIGlucHV0ICcgK1xuICAgICAgICAgICAgJ3ZvbHVtZSBvciBtb3ZlIGNsb3NlciB0byB0aGUgbWljcm9waG9uZS4nKTtcbiAgICAgIH1cbiAgICAgIGlmIChtYXhDbGlwQ291bnQgPiB0aGlzLmNsaXBDb3VudFRocmVzaG9sZCkge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnQ2xpcHBpbmcgZGV0ZWN0ZWQhIE1pY3JvcGhvbmUgaW5wdXQgbGV2ZWwgJyArXG4gICAgICAgICAgICAnaXMgaGlnaC4gRGVjcmVhc2UgaW5wdXQgdm9sdW1lIG9yIG1vdmUgYXdheSBmcm9tIHRoZSBtaWNyb3Bob25lLicpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfSxcblxuICBkZXRlY3RNb25vOiBmdW5jdGlvbihidWZmZXJzTCwgYnVmZmVyc1IpIHtcbiAgICB2YXIgZGlmZlNhbXBsZXMgPSAwO1xuICAgIGZvciAodmFyIGogPSAwOyBqIDwgYnVmZmVyc0wubGVuZ3RoOyBqKyspIHtcbiAgICAgIHZhciBsID0gYnVmZmVyc0xbal07XG4gICAgICB2YXIgciA9IGJ1ZmZlcnNSW2pdO1xuICAgICAgaWYgKGwubGVuZ3RoID09PSByLmxlbmd0aCkge1xuICAgICAgICB2YXIgZCA9IDAuMDtcbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgZCA9IE1hdGguYWJzKGxbaV0gLSByW2ldKTtcbiAgICAgICAgICBpZiAoZCA+IHRoaXMubW9ub0RldGVjdFRocmVzaG9sZCkge1xuICAgICAgICAgICAgZGlmZlNhbXBsZXMrKztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRpZmZTYW1wbGVzKys7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChkaWZmU2FtcGxlcyA+IDApIHtcbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTdGVyZW8gbWljcm9waG9uZSBkZXRlY3RlZC4nKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ01vbm8gbWljcm9waG9uZSBkZXRlY3RlZC4nKTtcbiAgICB9XG4gIH0sXG5cbiAgZEJGUzogZnVuY3Rpb24oZ2Fpbikge1xuICAgIHZhciBkQiA9IDIwICogTWF0aC5sb2coZ2FpbikgLyBNYXRoLmxvZygxMCk7XG4gICAgLy8gVXNlIE1hdGgucm91bmQgdG8gZGlzcGxheSB1cCB0byBvbmUgZGVjaW1hbCBwbGFjZS5cbiAgICByZXR1cm4gTWF0aC5yb3VuZChkQiAqIDEwKSAvIDEwO1xuICB9LFxufTtcblxuZXhwb3J0IGRlZmF1bHQgTWljVGVzdDtcbiIsIid1c2Ugc3RyaWN0JztcbmltcG9ydCBDYWxsIGZyb20gJy4uL3V0aWwvQ2FsbC5qcyc7XG5cbnZhciBOZXR3b3JrVGVzdCA9IGZ1bmN0aW9uKHRlc3QsIHByb3RvY29sLCBwYXJhbXMsIGljZUNhbmRpZGF0ZUZpbHRlcikge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnByb3RvY29sID0gcHJvdG9jb2w7XG4gIHRoaXMucGFyYW1zID0gcGFyYW1zO1xuICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlciA9IGljZUNhbmRpZGF0ZUZpbHRlcjtcbn07XG5cbk5ldHdvcmtUZXN0LnByb3RvdHlwZSA9IHtcbiAgcnVuOiBmdW5jdGlvbigpIHtcbiAgICAvLyBEbyBub3QgY3JlYXRlIHR1cm4gY29uZmlnIGZvciBJUFY2IHRlc3QuXG4gICAgaWYgKHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyLnRvU3RyaW5nKCkgPT09IENhbGwuaXNJcHY2LnRvU3RyaW5nKCkpIHtcbiAgICAgIHRoaXMuZ2F0aGVyQ2FuZGlkYXRlcyhudWxsLCB0aGlzLnBhcmFtcywgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICBDYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyh0aGlzLnN0YXJ0LmJpbmQodGhpcyksXG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KSwgdGhpcy50ZXN0KTtcbiAgICB9XG4gIH0sXG5cbiAgc3RhcnQ6IGZ1bmN0aW9uKGNvbmZpZykge1xuICAgIHRoaXMuZmlsdGVyQ29uZmlnKGNvbmZpZywgdGhpcy5wcm90b2NvbCk7XG4gICAgdGhpcy5nYXRoZXJDYW5kaWRhdGVzKGNvbmZpZywgdGhpcy5wYXJhbXMsIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyKTtcbiAgfSxcblxuICAvLyBGaWx0ZXIgdGhlIFJUQ0NvbmZpZ3VyYXRpb24gfGNvbmZpZ3wgdG8gb25seSBjb250YWluIFVSTHMgd2l0aCB0aGVcbiAgLy8gc3BlY2lmaWVkIHRyYW5zcG9ydCBwcm90b2NvbCB8cHJvdG9jb2x8LiBJZiBubyB0dXJuIHRyYW5zcG9ydCBpc1xuICAvLyBzcGVjaWZpZWQgaXQgaXMgYWRkZWQgd2l0aCB0aGUgcmVxdWVzdGVkIHByb3RvY29sLlxuICBmaWx0ZXJDb25maWc6IGZ1bmN0aW9uKGNvbmZpZywgcHJvdG9jb2wpIHtcbiAgICB2YXIgdHJhbnNwb3J0ID0gJ3RyYW5zcG9ydD0nICsgcHJvdG9jb2w7XG4gICAgdmFyIG5ld0ljZVNlcnZlcnMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGNvbmZpZy5pY2VTZXJ2ZXJzLmxlbmd0aDsgKytpKSB7XG4gICAgICB2YXIgaWNlU2VydmVyID0gY29uZmlnLmljZVNlcnZlcnNbaV07XG4gICAgICB2YXIgbmV3VXJscyA9IFtdO1xuICAgICAgZm9yICh2YXIgaiA9IDA7IGogPCBpY2VTZXJ2ZXIudXJscy5sZW5ndGg7ICsraikge1xuICAgICAgICB2YXIgdXJpID0gaWNlU2VydmVyLnVybHNbal07XG4gICAgICAgIGlmICh1cmkuaW5kZXhPZih0cmFuc3BvcnQpICE9PSAtMSkge1xuICAgICAgICAgIG5ld1VybHMucHVzaCh1cmkpO1xuICAgICAgICB9IGVsc2UgaWYgKHVyaS5pbmRleE9mKCc/dHJhbnNwb3J0PScpID09PSAtMSAmJlxuICAgICAgICAgICAgdXJpLnN0YXJ0c1dpdGgoJ3R1cm4nKSkge1xuICAgICAgICAgIG5ld1VybHMucHVzaCh1cmkgKyAnPycgKyB0cmFuc3BvcnQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAobmV3VXJscy5sZW5ndGggIT09IDApIHtcbiAgICAgICAgaWNlU2VydmVyLnVybHMgPSBuZXdVcmxzO1xuICAgICAgICBuZXdJY2VTZXJ2ZXJzLnB1c2goaWNlU2VydmVyKTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uZmlnLmljZVNlcnZlcnMgPSBuZXdJY2VTZXJ2ZXJzO1xuICB9LFxuXG4gIC8vIENyZWF0ZSBhIFBlZXJDb25uZWN0aW9uLCBhbmQgZ2F0aGVyIGNhbmRpZGF0ZXMgdXNpbmcgUlRDQ29uZmlnIHxjb25maWd8XG4gIC8vIGFuZCBjdG9yIHBhcmFtcyB8cGFyYW1zfC4gU3VjY2VlZCBpZiBhbnkgY2FuZGlkYXRlcyBwYXNzIHRoZSB8aXNHb29kfFxuICAvLyBjaGVjaywgZmFpbCBpZiB3ZSBjb21wbGV0ZSBnYXRoZXJpbmcgd2l0aG91dCBhbnkgcGFzc2luZy5cbiAgZ2F0aGVyQ2FuZGlkYXRlczogZnVuY3Rpb24oY29uZmlnLCBwYXJhbXMsIGlzR29vZCkge1xuICAgIHZhciBwYztcbiAgICB0cnkge1xuICAgICAgcGMgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnLCBwYXJhbXMpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAocGFyYW1zICE9PSBudWxsICYmIHBhcmFtcy5vcHRpb25hbFswXS5nb29nSVB2Nikge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0V2FybmluZygnRmFpbGVkIHRvIGNyZWF0ZSBwZWVyIGNvbm5lY3Rpb24sIElQdjYgJyArXG4gICAgICAgICAgICAnbWlnaHQgbm90IGJlIHNldHVwL3N1cHBvcnRlZCBvbiB0aGUgbmV0d29yay4nKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRFcnJvcignRmFpbGVkIHRvIGNyZWF0ZSBwZWVyIGNvbm5lY3Rpb246ICcgKyBlcnJvcik7XG4gICAgICB9XG4gICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEluIG91ciBjYW5kaWRhdGUgY2FsbGJhY2ssIHN0b3AgaWYgd2UgZ2V0IGEgY2FuZGlkYXRlIHRoYXQgcGFzc2VzXG4gICAgLy8gfGlzR29vZHwuXG4gICAgcGMuYWRkRXZlbnRMaXN0ZW5lcignaWNlY2FuZGlkYXRlJywgZnVuY3Rpb24oZSkge1xuICAgICAgLy8gT25jZSB3ZSd2ZSBkZWNpZGVkLCBpZ25vcmUgZnV0dXJlIGNhbGxiYWNrcy5cbiAgICAgIGlmIChlLmN1cnJlbnRUYXJnZXQuc2lnbmFsaW5nU3RhdGUgPT09ICdjbG9zZWQnKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGUuY2FuZGlkYXRlKSB7XG4gICAgICAgIHZhciBwYXJzZWQgPSBDYWxsLnBhcnNlQ2FuZGlkYXRlKGUuY2FuZGlkYXRlLmNhbmRpZGF0ZSk7XG4gICAgICAgIGlmIChpc0dvb2QocGFyc2VkKSkge1xuICAgICAgICAgIHRoaXMudGVzdC5yZXBvcnRTdWNjZXNzKCdHYXRoZXJlZCBjYW5kaWRhdGUgb2YgVHlwZTogJyArIHBhcnNlZC50eXBlICtcbiAgICAgICAgICAgICAgJyBQcm90b2NvbDogJyArIHBhcnNlZC5wcm90b2NvbCArICcgQWRkcmVzczogJyArIHBhcnNlZC5hZGRyZXNzKTtcbiAgICAgICAgICBwYy5jbG9zZSgpO1xuICAgICAgICAgIHBjID0gbnVsbDtcbiAgICAgICAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYy5jbG9zZSgpO1xuICAgICAgICBwYyA9IG51bGw7XG4gICAgICAgIGlmIChwYXJhbXMgIT09IG51bGwgJiYgcGFyYW1zLm9wdGlvbmFsWzBdLmdvb2dJUHY2KSB7XG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFdhcm5pbmcoJ0ZhaWxlZCB0byBnYXRoZXIgSVB2NiBjYW5kaWRhdGVzLCBpdCAnICtcbiAgICAgICAgICAgICAgJ21pZ2h0IG5vdCBiZSBzZXR1cC9zdXBwb3J0ZWQgb24gdGhlIG5ldHdvcmsuJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdGYWlsZWQgdG8gZ2F0aGVyIHNwZWNpZmllZCBjYW5kaWRhdGVzJyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgICAgIH1cbiAgICB9LmJpbmQodGhpcykpO1xuXG4gICAgdGhpcy5jcmVhdGVBdWRpb09ubHlSZWNlaXZlT2ZmZXIocGMpO1xuICB9LFxuXG4gIC8vIENyZWF0ZSBhbiBhdWRpby1vbmx5LCByZWN2b25seSBvZmZlciwgYW5kIHNldExEIHdpdGggaXQuXG4gIC8vIFRoaXMgd2lsbCB0cmlnZ2VyIGNhbmRpZGF0ZSBnYXRoZXJpbmcuXG4gIGNyZWF0ZUF1ZGlvT25seVJlY2VpdmVPZmZlcjogZnVuY3Rpb24ocGMpIHtcbiAgICB2YXIgY3JlYXRlT2ZmZXJQYXJhbXMgPSB7b2ZmZXJUb1JlY2VpdmVBdWRpbzogMX07XG4gICAgcGMuY3JlYXRlT2ZmZXIoXG4gICAgICAgIGNyZWF0ZU9mZmVyUGFyYW1zXG4gICAgKS50aGVuKFxuICAgICAgICBmdW5jdGlvbihvZmZlcikge1xuICAgICAgICAgIHBjLnNldExvY2FsRGVzY3JpcHRpb24ob2ZmZXIpLnRoZW4oXG4gICAgICAgICAgICAgIG5vb3AsXG4gICAgICAgICAgICAgIG5vb3BcbiAgICAgICAgICApO1xuICAgICAgICB9LFxuICAgICAgICBub29wXG4gICAgKTtcblxuICAgIC8vIEVtcHR5IGZ1bmN0aW9uIGZvciBjYWxsYmFja3MgcmVxdWlyaW5nIGEgZnVuY3Rpb24uXG4gICAgZnVuY3Rpb24gbm9vcCgpIHt9XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IE5ldHdvcmtUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IGFkYXB0ZXIgZnJvbSAnd2VicnRjLWFkYXB0ZXInO1xuaW1wb3J0IFN0YXRpc3RpY3NBZ2dyZWdhdGUgZnJvbSAnLi4vdXRpbC9zdGF0cy5qcyc7XG5pbXBvcnQgQ2FsbCBmcm9tICcuLi91dGlsL2NhbGwuanMnO1xuXG5mdW5jdGlvbiBWaWRlb0JhbmR3aWR0aFRlc3QodGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLm1heFZpZGVvQml0cmF0ZUticHMgPSAyMDAwO1xuICB0aGlzLmR1cmF0aW9uTXMgPSA0MDAwMDtcbiAgdGhpcy5zdGF0U3RlcE1zID0gMTAwO1xuICB0aGlzLmJ3ZVN0YXRzID0gbmV3IFN0YXRpc3RpY3NBZ2dyZWdhdGUoMC43NSAqIHRoaXMubWF4VmlkZW9CaXRyYXRlS2JwcyAqXG4gICAgICAxMDAwKTtcbiAgdGhpcy5ydHRTdGF0cyA9IG5ldyBTdGF0aXN0aWNzQWdncmVnYXRlKCk7XG4gIHRoaXMucGFja2V0c0xvc3QgPSAtMTtcbiAgdGhpcy5uYWNrQ291bnQgPSAtMTtcbiAgdGhpcy5wbGlDb3VudCA9IC0xO1xuICB0aGlzLnFwU3VtID0gLTE7XG4gIHRoaXMucGFja2V0c1NlbnQgPSAtMTtcbiAgdGhpcy5wYWNrZXRzUmVjZWl2ZWQgPSAtMTtcbiAgdGhpcy5mcmFtZXNFbmNvZGVkID0gLTE7XG4gIHRoaXMuZnJhbWVzRGVjb2RlZCA9IC0xO1xuICB0aGlzLmZyYW1lc1NlbnQgPSAtMTtcbiAgdGhpcy5ieXRlc1NlbnQgPSAtMTtcbiAgdGhpcy52aWRlb1N0YXRzID0gW107XG4gIHRoaXMuc3RhcnRUaW1lID0gbnVsbDtcbiAgdGhpcy5jYWxsID0gbnVsbDtcbiAgLy8gT3BlbiB0aGUgY2FtZXJhIGluIDcyMHAgdG8gZ2V0IGEgY29ycmVjdCBtZWFzdXJlbWVudCBvZiByYW1wLXVwIHRpbWUuXG4gIHRoaXMuY29uc3RyYWludHMgPSB7XG4gICAgYXVkaW86IGZhbHNlLFxuICAgIHZpZGVvOiB7XG4gICAgICBvcHRpb25hbDogW1xuICAgICAgICB7bWluV2lkdGg6IDEyODB9LFxuICAgICAgICB7bWluSGVpZ2h0OiA3MjB9XG4gICAgICBdXG4gICAgfVxuICB9O1xufVxuXG5WaWRlb0JhbmR3aWR0aFRlc3QucHJvdG90eXBlID0ge1xuICBydW46IGZ1bmN0aW9uKCkge1xuICAgIENhbGwuYXN5bmNDcmVhdGVUdXJuQ29uZmlnKHRoaXMuc3RhcnQuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KSwgdGhpcy50ZXN0KTtcbiAgfSxcblxuICBzdGFydDogZnVuY3Rpb24oY29uZmlnKSB7XG4gICAgdGhpcy5jYWxsID0gbmV3IENhbGwoY29uZmlnLCB0aGlzLnRlc3QpO1xuICAgIHRoaXMuY2FsbC5zZXRJY2VDYW5kaWRhdGVGaWx0ZXIoQ2FsbC5pc1JlbGF5KTtcbiAgICAvLyBGRUMgbWFrZXMgaXQgaGFyZCB0byBzdHVkeSBiYW5kd2lkdGggZXN0aW1hdGlvbiBzaW5jZSB0aGVyZSBzZWVtcyB0byBiZVxuICAgIC8vIGEgc3Bpa2Ugd2hlbiBpdCBpcyBlbmFibGVkIGFuZCBkaXNhYmxlZC4gRGlzYWJsZSBpdCBmb3Igbm93LiBGRUMgaXNzdWVcbiAgICAvLyB0cmFja2VkIG9uOiBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL3dlYnJ0Yy9pc3N1ZXMvZGV0YWlsP2lkPTMwNTBcbiAgICB0aGlzLmNhbGwuZGlzYWJsZVZpZGVvRmVjKCk7XG4gICAgdGhpcy5jYWxsLmNvbnN0cmFpblZpZGVvQml0cmF0ZSh0aGlzLm1heFZpZGVvQml0cmF0ZUticHMpO1xuICAgIHRoaXMudGVzdC5kb0dldFVzZXJNZWRpYSh0aGlzLmNvbnN0cmFpbnRzLCB0aGlzLmdvdFN0cmVhbS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBnb3RTdHJlYW06IGZ1bmN0aW9uKHN0cmVhbSkge1xuICAgIHRoaXMuY2FsbC5wYzEuYWRkU3RyZWFtKHN0cmVhbSk7XG4gICAgdGhpcy5jYWxsLmVzdGFibGlzaENvbm5lY3Rpb24oKTtcbiAgICB0aGlzLnN0YXJ0VGltZSA9IG5ldyBEYXRlKCk7XG4gICAgdGhpcy5sb2NhbFN0cmVhbSA9IHN0cmVhbS5nZXRWaWRlb1RyYWNrcygpWzBdO1xuICAgIHNldFRpbWVvdXQodGhpcy5nYXRoZXJTdGF0cy5iaW5kKHRoaXMpLCB0aGlzLnN0YXRTdGVwTXMpO1xuICB9LFxuXG4gIGdhdGhlclN0YXRzOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm93ID0gbmV3IERhdGUoKTtcbiAgICBpZiAobm93IC0gdGhpcy5zdGFydFRpbWUgPiB0aGlzLmR1cmF0aW9uTXMpIHtcbiAgICAgIHRoaXMudGVzdC5zZXRQcm9ncmVzcygxMDApO1xuICAgICAgdGhpcy5oYW5ndXAoKTtcbiAgICAgIHJldHVybjtcbiAgICB9IGVsc2UgaWYgKCF0aGlzLmNhbGwuc3RhdHNHYXRoZXJpbmdSdW5uaW5nKSB7XG4gICAgICB0aGlzLmNhbGwuZ2F0aGVyU3RhdHModGhpcy5jYWxsLnBjMSwgdGhpcy5jYWxsLnBjMiwgdGhpcy5sb2NhbFN0cmVhbSxcbiAgICAgICAgICB0aGlzLmdvdFN0YXRzLmJpbmQodGhpcykpO1xuICAgIH1cbiAgICB0aGlzLnRlc3Quc2V0UHJvZ3Jlc3MoKG5vdyAtIHRoaXMuc3RhcnRUaW1lKSAqIDEwMCAvIHRoaXMuZHVyYXRpb25Ncyk7XG4gICAgc2V0VGltZW91dCh0aGlzLmdhdGhlclN0YXRzLmJpbmQodGhpcyksIHRoaXMuc3RhdFN0ZXBNcyk7XG4gIH0sXG5cbiAgZ290U3RhdHM6IGZ1bmN0aW9uKHJlc3BvbnNlLCB0aW1lLCByZXNwb25zZTIsIHRpbWUyKSB7XG4gICAgLy8gVE9ETzogUmVtb3ZlIGJyb3dzZXIgc3BlY2lmaWMgc3RhdHMgZ2F0aGVyaW5nIGhhY2sgb25jZSBhZGFwdGVyLmpzIG9yXG4gICAgLy8gYnJvd3NlcnMgY29udmVyZ2Ugb24gYSBzdGFuZGFyZC5cbiAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgZm9yICh2YXIgaSBpbiByZXNwb25zZSkge1xuICAgICAgICBpZiAodHlwZW9mIHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24gIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgICAgdGhpcy5id2VTdGF0cy5hZGQocmVzcG9uc2VbaV0uY29ubmVjdGlvbi50aW1lc3RhbXAsXG4gICAgICAgICAgICAgIHBhcnNlSW50KHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24uYXZhaWxhYmxlT3V0Z29pbmdCaXRyYXRlKSk7XG4gICAgICAgICAgdGhpcy5ydHRTdGF0cy5hZGQocmVzcG9uc2VbaV0uY29ubmVjdGlvbi50aW1lc3RhbXAsXG4gICAgICAgICAgICAgIHBhcnNlSW50KHJlc3BvbnNlW2ldLmNvbm5lY3Rpb24uY3VycmVudFJvdW5kVHJpcFRpbWUgKiAxMDAwKSk7XG4gICAgICAgICAgLy8gR3JhYiB0aGUgbGFzdCBzdGF0cy5cbiAgICAgICAgICB0aGlzLnZpZGVvU3RhdHNbMF0gPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5mcmFtZVdpZHRoO1xuICAgICAgICAgIHRoaXMudmlkZW9TdGF0c1sxXSA9IHJlc3BvbnNlW2ldLnZpZGVvLmxvY2FsLmZyYW1lSGVpZ2h0O1xuICAgICAgICAgIHRoaXMubmFja0NvdW50ID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwubmFja0NvdW50O1xuICAgICAgICAgIHRoaXMucGFja2V0c0xvc3QgPSByZXNwb25zZTJbaV0udmlkZW8ucmVtb3RlLnBhY2tldHNMb3N0O1xuICAgICAgICAgIHRoaXMucXBTdW0gPSByZXNwb25zZTJbaV0udmlkZW8ucmVtb3RlLnFwU3VtO1xuICAgICAgICAgIHRoaXMucGxpQ291bnQgPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5wbGlDb3VudDtcbiAgICAgICAgICB0aGlzLnBhY2tldHNTZW50ID0gcmVzcG9uc2VbaV0udmlkZW8ubG9jYWwucGFja2V0c1NlbnQ7XG4gICAgICAgICAgdGhpcy5wYWNrZXRzUmVjZWl2ZWQgPSByZXNwb25zZTJbaV0udmlkZW8ucmVtb3RlLnBhY2tldHNSZWNlaXZlZDtcbiAgICAgICAgICB0aGlzLmZyYW1lc0VuY29kZWQgPSByZXNwb25zZVtpXS52aWRlby5sb2NhbC5mcmFtZXNFbmNvZGVkO1xuICAgICAgICAgIHRoaXMuZnJhbWVzRGVjb2RlZCA9IHJlc3BvbnNlMltpXS52aWRlby5yZW1vdGUuZnJhbWVzRGVjb2RlZDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgIGZvciAodmFyIGogaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgaWYgKHJlc3BvbnNlW2pdLmlkID09PSAnb3V0Ym91bmRfcnRjcF92aWRlb18wJykge1xuICAgICAgICAgIHRoaXMucnR0U3RhdHMuYWRkKERhdGUucGFyc2UocmVzcG9uc2Vbal0udGltZXN0YW1wKSxcbiAgICAgICAgICAgICAgcGFyc2VJbnQocmVzcG9uc2Vbal0ubW96UnR0KSk7XG4gICAgICAgICAgLy8gR3JhYiB0aGUgbGFzdCBzdGF0cy5cbiAgICAgICAgICB0aGlzLmppdHRlciA9IHJlc3BvbnNlW2pdLmppdHRlcjtcbiAgICAgICAgICB0aGlzLnBhY2tldHNMb3N0ID0gcmVzcG9uc2Vbal0ucGFja2V0c0xvc3Q7XG4gICAgICAgIH0gZWxzZSBpZiAocmVzcG9uc2Vbal0uaWQgPT09ICdvdXRib3VuZF9ydHBfdmlkZW9fMCcpIHtcbiAgICAgICAgICAvLyBUT0RPOiBHZXQgZGltZW5zaW9ucyBmcm9tIGdldFN0YXRzIHdoZW4gc3VwcG9ydGVkIGluIEZGLlxuICAgICAgICAgIHRoaXMudmlkZW9TdGF0c1swXSA9ICdOb3Qgc3VwcG9ydGVkIG9uIEZpcmVmb3gnO1xuICAgICAgICAgIHRoaXMudmlkZW9TdGF0c1sxXSA9ICdOb3Qgc3VwcG9ydGVkIG9uIEZpcmVmb3gnO1xuICAgICAgICAgIHRoaXMuYml0cmF0ZU1lYW4gPSByZXNwb25zZVtqXS5iaXRyYXRlTWVhbjtcbiAgICAgICAgICB0aGlzLmJpdHJhdGVTdGREZXYgPSByZXNwb25zZVtqXS5iaXRyYXRlU3RkRGV2O1xuICAgICAgICAgIHRoaXMuZnJhbWVyYXRlTWVhbiA9IHJlc3BvbnNlW2pdLmZyYW1lcmF0ZU1lYW47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdPbmx5IEZpcmVmb3ggYW5kIENocm9tZSBnZXRTdGF0cyBpbXBsZW1lbnRhdGlvbnMnICtcbiAgICAgICAgJyBhcmUgc3VwcG9ydGVkLicpO1xuICAgIH1cbiAgICB0aGlzLmNvbXBsZXRlZCgpO1xuICB9LFxuXG4gIGhhbmd1cDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5jYWxsLnBjMS5nZXRMb2NhbFN0cmVhbXMoKVswXS5nZXRUcmFja3MoKS5mb3JFYWNoKGZ1bmN0aW9uKHRyYWNrKSB7XG4gICAgICB0cmFjay5zdG9wKCk7XG4gICAgfSk7XG4gICAgdGhpcy5jYWxsLmNsb3NlKCk7XG4gICAgdGhpcy5jYWxsID0gbnVsbDtcbiAgfSxcblxuICBjb21wbGV0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgIC8vIFRPRE86IFJlbW92ZSBicm93c2VyIHNwZWNpZmljIHN0YXRzIGdhdGhlcmluZyBoYWNrIG9uY2UgYWRhcHRlci5qcyBvclxuICAgIC8vIGJyb3dzZXJzIGNvbnZlcmdlIG9uIGEgc3RhbmRhcmQuXG4gICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgIC8vIENoZWNraW5nIGlmIGdyZWF0ZXIgdGhhbiAyIGJlY2F1c2UgQ2hyb21lIHNvbWV0aW1lcyByZXBvcnRzIDJ4MiB3aGVuXG4gICAgICAvLyBhIGNhbWVyYSBzdGFydHMgYnV0IGZhaWxzIHRvIGRlbGl2ZXIgZnJhbWVzLlxuICAgICAgaWYgKHRoaXMudmlkZW9TdGF0c1swXSA8IDIgJiYgdGhpcy52aWRlb1N0YXRzWzFdIDwgMikge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ0NhbWVyYSBmYWlsdXJlOiAnICsgdGhpcy52aWRlb1N0YXRzWzBdICsgJ3gnICtcbiAgICAgICAgICAgIHRoaXMudmlkZW9TdGF0c1sxXSArICcuIENhbm5vdCB0ZXN0IGJhbmR3aWR0aCB3aXRob3V0IGEgd29ya2luZyAnICtcbiAgICAgICAgICAgICcgY2FtZXJhLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydFN1Y2Nlc3MoJ1ZpZGVvIHJlc29sdXRpb246ICcgKyB0aGlzLnZpZGVvU3RhdHNbMF0gK1xuICAgICAgICAgICAgJ3gnICsgdGhpcy52aWRlb1N0YXRzWzFdKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1NlbmQgYmFuZHdpZHRoIGVzdGltYXRlIGF2ZXJhZ2U6ICcgK1xuICAgICAgICAgICAgTWF0aC5yb3VuZCh0aGlzLmJ3ZVN0YXRzLmdldEF2ZXJhZ2UoKSAvIDEwMDApICsgJyBrYnBzJyk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJhbmR3aWR0aCBlc3RpbWF0ZSBtYXg6ICcgK1xuICAgICAgICAgICAgdGhpcy5id2VTdGF0cy5nZXRNYXgoKSAvIDEwMDAgKyAnIGticHMnKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1NlbmQgYmFuZHdpZHRoIHJhbXAtdXAgdGltZTogJyArXG4gICAgICAgICAgICB0aGlzLmJ3ZVN0YXRzLmdldFJhbXBVcFRpbWUoKSArICcgbXMnKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1BhY2tldHMgc2VudDogJyArIHRoaXMucGFja2V0c1NlbnQpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUGFja2V0cyByZWNlaXZlZDogJyArIHRoaXMucGFja2V0c1JlY2VpdmVkKTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ05BQ0sgY291bnQ6ICcgKyB0aGlzLm5hY2tDb3VudCk7XG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdQaWN0dXJlIGxvc3MgaW5kaWNhdGlvbnM6ICcgKyB0aGlzLnBsaUNvdW50KTtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1F1YWxpdHkgcHJlZGljdG9yIHN1bTogJyArIHRoaXMucXBTdW0pO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnRnJhbWVzIGVuY29kZWQ6ICcgKyB0aGlzLmZyYW1lc0VuY29kZWQpO1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnRnJhbWVzIGRlY29kZWQ6ICcgKyB0aGlzLmZyYW1lc0RlY29kZWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgIGlmIChwYXJzZUludCh0aGlzLmZyYW1lcmF0ZU1lYW4pID4gMCkge1xuICAgICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnRnJhbWUgcmF0ZSBtZWFuOiAnICtcbiAgICAgICAgICAgIHBhcnNlSW50KHRoaXMuZnJhbWVyYXRlTWVhbikpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdGcmFtZSByYXRlIG1lYW4gaXMgMCwgY2Fubm90IHRlc3QgYmFuZHdpZHRoICcgK1xuICAgICAgICAgICAgJ3dpdGhvdXQgYSB3b3JraW5nIGNhbWVyYS4nKTtcbiAgICAgIH1cbiAgICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdTZW5kIGJpdHJhdGUgbWVhbjogJyArXG4gICAgICAgICAgcGFyc2VJbnQodGhpcy5iaXRyYXRlTWVhbikgLyAxMDAwICsgJyBrYnBzJyk7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnU2VuZCBiaXRyYXRlIHN0YW5kYXJkIGRldmlhdGlvbjogJyArXG4gICAgICAgICAgcGFyc2VJbnQodGhpcy5iaXRyYXRlU3RkRGV2KSAvIDEwMDAgKyAnIGticHMnKTtcbiAgICB9XG4gICAgdGhpcy50ZXN0LnJlcG9ydEluZm8oJ1JUVCBhdmVyYWdlOiAnICsgdGhpcy5ydHRTdGF0cy5nZXRBdmVyYWdlKCkgK1xuICAgICAgICAgICAgJyBtcycpO1xuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdSVFQgbWF4OiAnICsgdGhpcy5ydHRTdGF0cy5nZXRNYXgoKSArICcgbXMnKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnUGFja2V0cyBsb3N0OiAnICsgdGhpcy5wYWNrZXRzTG9zdCk7XG4gICAgdGhpcy50ZXN0LmRvbmUoKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgVmlkZW9CYW5kd2lkdGhUZXN0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IENhbGwgZnJvbSAnLi4vdXRpbC9jYWxsLmpzJztcbmltcG9ydCBSZXBvcnQgZnJvbSAnLi4vdXRpbC9yZXBvcnQuanMnO1xuaW1wb3J0IHsgYXJyYXlBdmVyYWdlLCBhcnJheU1pbiwgYXJyYXlNYXggfSBmcm9tICcuLi91dGlsL3V0aWwuanMnO1xuXG5jb25zdCByZXBvcnQgPSBuZXcgUmVwb3J0KCk7XG5cbmZ1bmN0aW9uIFdpRmlQZXJpb2RpY1NjYW5UZXN0KHRlc3QsIGNhbmRpZGF0ZUZpbHRlcikge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLmNhbmRpZGF0ZUZpbHRlciA9IGNhbmRpZGF0ZUZpbHRlcjtcbiAgdGhpcy50ZXN0RHVyYXRpb25NcyA9IDUgKiA2MCAqIDEwMDA7XG4gIHRoaXMuc2VuZEludGVydmFsTXMgPSAxMDA7XG4gIHRoaXMuZGVsYXlzID0gW107XG4gIHRoaXMucmVjdlRpbWVTdGFtcHMgPSBbXTtcbiAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gIHRoaXMuY2FsbCA9IG51bGw7XG4gIHRoaXMuc2VuZGVyQ2hhbm5lbCA9IG51bGw7XG4gIHRoaXMucmVjZWl2ZUNoYW5uZWwgPSBudWxsO1xufVxuXG5XaUZpUGVyaW9kaWNTY2FuVGVzdC5wcm90b3R5cGUgPSB7XG4gIHJ1bjogZnVuY3Rpb24oKSB7XG4gICAgQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcodGhpcy5zdGFydC5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpLCB0aGlzLnRlc3QpO1xuICB9LFxuXG4gIHN0YXJ0OiBmdW5jdGlvbihjb25maWcpIHtcbiAgICB0aGlzLnJ1bm5pbmcgPSB0cnVlO1xuICAgIHRoaXMuY2FsbCA9IG5ldyBDYWxsKGNvbmZpZywgdGhpcy50ZXN0KTtcbiAgICB0aGlzLmNhbGwuc2V0SWNlQ2FuZGlkYXRlRmlsdGVyKHRoaXMuY2FuZGlkYXRlRmlsdGVyKTtcblxuICAgIHRoaXMuc2VuZGVyQ2hhbm5lbCA9IHRoaXMuY2FsbC5wYzEuY3JlYXRlRGF0YUNoYW5uZWwoe29yZGVyZWQ6IGZhbHNlLFxuICAgICAgbWF4UmV0cmFuc21pdHM6IDB9KTtcbiAgICB0aGlzLnNlbmRlckNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsIHRoaXMuc2VuZC5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLmNhbGwucGMyLmFkZEV2ZW50TGlzdGVuZXIoJ2RhdGFjaGFubmVsJyxcbiAgICAgICAgdGhpcy5vblJlY2VpdmVyQ2hhbm5lbC5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLmNhbGwuZXN0YWJsaXNoQ29ubmVjdGlvbigpO1xuXG4gICAgdGhpcy50ZXN0LnNldFRpbWVvdXRXaXRoUHJvZ3Jlc3NCYXIodGhpcy5maW5pc2hUZXN0LmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdER1cmF0aW9uTXMpO1xuICB9LFxuXG4gIG9uUmVjZWl2ZXJDaGFubmVsOiBmdW5jdGlvbihldmVudCkge1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwgPSBldmVudC5jaGFubmVsO1xuICAgIHRoaXMucmVjZWl2ZUNoYW5uZWwuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIHRoaXMucmVjZWl2ZS5iaW5kKHRoaXMpKTtcbiAgfSxcblxuICBzZW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucnVubmluZykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnNlbmRlckNoYW5uZWwuc2VuZCgnJyArIERhdGUubm93KCkpO1xuICAgIHNldFRpbWVvdXQodGhpcy5zZW5kLmJpbmQodGhpcyksIHRoaXMuc2VuZEludGVydmFsTXMpO1xuICB9LFxuXG4gIHJlY2VpdmU6IGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmcpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHNlbmRUaW1lID0gcGFyc2VJbnQoZXZlbnQuZGF0YSk7XG4gICAgdmFyIGRlbGF5ID0gRGF0ZS5ub3coKSAtIHNlbmRUaW1lO1xuICAgIHRoaXMucmVjdlRpbWVTdGFtcHMucHVzaChzZW5kVGltZSk7XG4gICAgdGhpcy5kZWxheXMucHVzaChkZWxheSk7XG4gIH0sXG5cbiAgZmluaXNoVGVzdDogZnVuY3Rpb24oKSB7XG4gICAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCdwZXJpb2RpYy1kZWxheScsIHtkZWxheXM6IHRoaXMuZGVsYXlzLFxuICAgICAgcmVjdlRpbWVTdGFtcHM6IHRoaXMucmVjdlRpbWVTdGFtcHN9KTtcbiAgICB0aGlzLnJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLmNhbGwuY2xvc2UoKTtcbiAgICB0aGlzLmNhbGwgPSBudWxsO1xuXG4gICAgdmFyIGF2ZyA9IGFycmF5QXZlcmFnZSh0aGlzLmRlbGF5cyk7XG4gICAgdmFyIG1heCA9IGFycmF5TWF4KHRoaXMuZGVsYXlzKTtcbiAgICB2YXIgbWluID0gYXJyYXlNaW4odGhpcy5kZWxheXMpO1xuICAgIHRoaXMudGVzdC5yZXBvcnRJbmZvKCdBdmVyYWdlIGRlbGF5OiAnICsgYXZnICsgJyBtcy4nKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnTWluIGRlbGF5OiAnICsgbWluICsgJyBtcy4nKTtcbiAgICB0aGlzLnRlc3QucmVwb3J0SW5mbygnTWF4IGRlbGF5OiAnICsgbWF4ICsgJyBtcy4nKTtcblxuICAgIGlmICh0aGlzLmRlbGF5cy5sZW5ndGggPCAwLjggKiB0aGlzLnRlc3REdXJhdGlvbk1zIC8gdGhpcy5zZW5kSW50ZXJ2YWxNcykge1xuICAgICAgdGhpcy50ZXN0LnJlcG9ydEVycm9yKCdOb3QgZW5vdWdoIHNhbXBsZXMgZ2F0aGVyZWQuIEtlZXAgdGhlIHBhZ2Ugb24gJyArXG4gICAgICAgICAgJyB0aGUgZm9yZWdyb3VuZCB3aGlsZSB0aGUgdGVzdCBpcyBydW5uaW5nLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0U3VjY2VzcygnQ29sbGVjdGVkICcgKyB0aGlzLmRlbGF5cy5sZW5ndGggK1xuICAgICAgICAgICcgZGVsYXkgc2FtcGxlcy4nKTtcbiAgICB9XG5cbiAgICBpZiAobWF4ID4gKG1pbiArIDEwMCkgKiAyKSB7XG4gICAgICB0aGlzLnRlc3QucmVwb3J0RXJyb3IoJ1RoZXJlIGlzIGEgYmlnIGRpZmZlcmVuY2UgYmV0d2VlbiB0aGUgbWluIGFuZCAnICtcbiAgICAgICAgICAnbWF4IGRlbGF5IG9mIHBhY2tldHMuIFlvdXIgbmV0d29yayBhcHBlYXJzIHVuc3RhYmxlLicpO1xuICAgIH1cbiAgICB0aGlzLnRlc3QuZG9uZSgpO1xuICB9XG59O1xuXG5leHBvcnQgZGVmYXVsdCBXaUZpUGVyaW9kaWNTY2FuVGVzdDtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuaW1wb3J0IGFkYXB0ZXIgZnJvbSAnd2VicnRjLWFkYXB0ZXInO1xuaW1wb3J0IFJlcG9ydCBmcm9tICcuL3JlcG9ydC5qcyc7XG5pbXBvcnQgeyBlbnVtZXJhdGVTdGF0cyB9IGZyb20gJy4vdXRpbC5qcyc7XG5cbmNvbnN0IHJlcG9ydCA9IG5ldyBSZXBvcnQoKTtcblxuZnVuY3Rpb24gQ2FsbChjb25maWcsIHRlc3QpIHtcbiAgdGhpcy50ZXN0ID0gdGVzdDtcbiAgdGhpcy50cmFjZUV2ZW50ID0gcmVwb3J0LnRyYWNlRXZlbnRBc3luYygnY2FsbCcpO1xuICB0aGlzLnRyYWNlRXZlbnQoe2NvbmZpZzogY29uZmlnfSk7XG4gIHRoaXMuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG5cbiAgdGhpcy5wYzEgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnKTtcbiAgdGhpcy5wYzIgPSBuZXcgUlRDUGVlckNvbm5lY3Rpb24oY29uZmlnKTtcblxuICB0aGlzLnBjMS5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCB0aGlzLm9uSWNlQ2FuZGlkYXRlXy5iaW5kKHRoaXMsXG4gICAgICB0aGlzLnBjMikpO1xuICB0aGlzLnBjMi5hZGRFdmVudExpc3RlbmVyKCdpY2VjYW5kaWRhdGUnLCB0aGlzLm9uSWNlQ2FuZGlkYXRlXy5iaW5kKHRoaXMsXG4gICAgICB0aGlzLnBjMSkpO1xuXG4gIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyA9IENhbGwubm9GaWx0ZXI7XG59XG5cbkNhbGwucHJvdG90eXBlID0ge1xuICBlc3RhYmxpc2hDb25uZWN0aW9uOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnQoe3N0YXRlOiAnc3RhcnQnfSk7XG4gICAgdGhpcy5wYzEuY3JlYXRlT2ZmZXIoKS50aGVuKFxuICAgICAgICB0aGlzLmdvdE9mZmVyXy5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpXG4gICAgKTtcbiAgfSxcblxuICBjbG9zZTogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50KHtzdGF0ZTogJ2VuZCd9KTtcbiAgICB0aGlzLnBjMS5jbG9zZSgpO1xuICAgIHRoaXMucGMyLmNsb3NlKCk7XG4gIH0sXG5cbiAgc2V0SWNlQ2FuZGlkYXRlRmlsdGVyOiBmdW5jdGlvbihmaWx0ZXIpIHtcbiAgICB0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8gPSBmaWx0ZXI7XG4gIH0sXG5cbiAgLy8gQ29uc3RyYWludCBtYXggdmlkZW8gYml0cmF0ZSBieSBtb2RpZnlpbmcgdGhlIFNEUCB3aGVuIGNyZWF0aW5nIGFuIGFuc3dlci5cbiAgY29uc3RyYWluVmlkZW9CaXRyYXRlOiBmdW5jdGlvbihtYXhWaWRlb0JpdHJhdGVLYnBzKSB7XG4gICAgdGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXyA9IG1heFZpZGVvQml0cmF0ZUticHM7XG4gIH0sXG5cbiAgLy8gUmVtb3ZlIHZpZGVvIEZFQyBpZiBhdmFpbGFibGUgb24gdGhlIG9mZmVyLlxuICBkaXNhYmxlVmlkZW9GZWM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY29uc3RyYWluT2ZmZXJUb1JlbW92ZVZpZGVvRmVjXyA9IHRydWU7XG4gIH0sXG5cbiAgLy8gV2hlbiB0aGUgcGVlckNvbm5lY3Rpb24gaXMgY2xvc2VkIHRoZSBzdGF0c0NiIGlzIGNhbGxlZCBvbmNlIHdpdGggYW4gYXJyYXlcbiAgLy8gb2YgZ2F0aGVyZWQgc3RhdHMuXG4gIGdhdGhlclN0YXRzOiBmdW5jdGlvbihwZWVyQ29ubmVjdGlvbixwZWVyQ29ubmVjdGlvbjIsIGxvY2FsU3RyZWFtLCBzdGF0c0NiKSB7XG4gICAgdmFyIHN0YXRzID0gW107XG4gICAgdmFyIHN0YXRzMiA9IFtdO1xuICAgIHZhciBzdGF0c0NvbGxlY3RUaW1lID0gW107XG4gICAgdmFyIHN0YXRzQ29sbGVjdFRpbWUyID0gW107XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBzdGF0U3RlcE1zID0gMTAwO1xuICAgIHNlbGYubG9jYWxUcmFja0lkcyA9IHtcbiAgICAgIGF1ZGlvOiAnJyxcbiAgICAgIHZpZGVvOiAnJ1xuICAgIH07XG4gICAgc2VsZi5yZW1vdGVUcmFja0lkcyA9IHtcbiAgICAgIGF1ZGlvOiAnJyxcbiAgICAgIHZpZGVvOiAnJ1xuICAgIH07XG5cbiAgICBwZWVyQ29ubmVjdGlvbi5nZXRTZW5kZXJzKCkuZm9yRWFjaChmdW5jdGlvbihzZW5kZXIpIHtcbiAgICAgIGlmIChzZW5kZXIudHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICBzZWxmLmxvY2FsVHJhY2tJZHMuYXVkaW8gPSBzZW5kZXIudHJhY2suaWQ7XG4gICAgICB9IGVsc2UgaWYgKHNlbmRlci50cmFjay5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgIHNlbGYubG9jYWxUcmFja0lkcy52aWRlbyA9IHNlbmRlci50cmFjay5pZDtcbiAgICAgIH1cbiAgICB9LmJpbmQoc2VsZikpO1xuXG4gICAgaWYgKHBlZXJDb25uZWN0aW9uMikge1xuICAgICAgcGVlckNvbm5lY3Rpb24yLmdldFJlY2VpdmVycygpLmZvckVhY2goZnVuY3Rpb24ocmVjZWl2ZXIpIHtcbiAgICAgICAgaWYgKHJlY2VpdmVyLnRyYWNrLmtpbmQgPT09ICdhdWRpbycpIHtcbiAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzLmF1ZGlvID0gcmVjZWl2ZXIudHJhY2suaWQ7XG4gICAgICAgIH0gZWxzZSBpZiAocmVjZWl2ZXIudHJhY2sua2luZCA9PT0gJ3ZpZGVvJykge1xuICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMudmlkZW8gPSByZWNlaXZlci50cmFjay5pZDtcbiAgICAgICAgfVxuICAgICAgfS5iaW5kKHNlbGYpKTtcbiAgICB9XG5cbiAgICB0aGlzLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IHRydWU7XG4gICAgZ2V0U3RhdHNfKCk7XG5cbiAgICBmdW5jdGlvbiBnZXRTdGF0c18oKSB7XG4gICAgICBpZiAocGVlckNvbm5lY3Rpb24uc2lnbmFsaW5nU3RhdGUgPT09ICdjbG9zZWQnKSB7XG4gICAgICAgIHNlbGYuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gZmFsc2U7XG4gICAgICAgIHN0YXRzQ2Ioc3RhdHMsIHN0YXRzQ29sbGVjdFRpbWUsIHN0YXRzMiwgc3RhdHNDb2xsZWN0VGltZTIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBwZWVyQ29ubmVjdGlvbi5nZXRTdGF0cygpXG4gICAgICAgICAgLnRoZW4oZ290U3RhdHNfKVxuICAgICAgICAgIC5jYXRjaChmdW5jdGlvbihlcnJvcikge1xuICAgICAgICAgICAgc2VsZi50ZXN0LnJlcG9ydEVycm9yKCdDb3VsZCBub3QgZ2F0aGVyIHN0YXRzOiAnICsgZXJyb3IpO1xuICAgICAgICAgICAgc2VsZi5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHN0YXRzQ2Ioc3RhdHMsIHN0YXRzQ29sbGVjdFRpbWUpO1xuICAgICAgICAgIH0uYmluZChzZWxmKSk7XG4gICAgICBpZiAocGVlckNvbm5lY3Rpb24yKSB7XG4gICAgICAgIHBlZXJDb25uZWN0aW9uMi5nZXRTdGF0cygpXG4gICAgICAgICAgICAudGhlbihnb3RTdGF0czJfKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gU3RhdHMgZm9yIHBjMiwgc29tZSBzdGF0cyBhcmUgb25seSBhdmFpbGFibGUgb24gdGhlIHJlY2VpdmluZyBlbmQgb2YgYVxuICAgIC8vIHBlZXJjb25uZWN0aW9uLlxuICAgIGZ1bmN0aW9uIGdvdFN0YXRzMl8ocmVzcG9uc2UpIHtcbiAgICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICAgIHZhciBlbnVtZXJhdGVkU3RhdHMgPSBlbnVtZXJhdGVTdGF0cyhyZXNwb25zZSwgc2VsZi5sb2NhbFRyYWNrSWRzLFxuICAgICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcyk7XG4gICAgICAgIHN0YXRzMi5wdXNoKGVudW1lcmF0ZWRTdGF0cyk7XG4gICAgICAgIHN0YXRzQ29sbGVjdFRpbWUyLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICB9IGVsc2UgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2ZpcmVmb3gnKSB7XG4gICAgICAgIGZvciAodmFyIGggaW4gcmVzcG9uc2UpIHtcbiAgICAgICAgICB2YXIgc3RhdCA9IHJlc3BvbnNlW2hdO1xuICAgICAgICAgIHN0YXRzMi5wdXNoKHN0YXQpO1xuICAgICAgICAgIHN0YXRzQ29sbGVjdFRpbWUyLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgJyArXG4gICAgICAgICAgICAnaW1wbGVtZW50YXRpb25zIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZ290U3RhdHNfKHJlc3BvbnNlKSB7XG4gICAgICAvLyBUT0RPOiBSZW1vdmUgYnJvd3NlciBzcGVjaWZpYyBzdGF0cyBnYXRoZXJpbmcgaGFjayBvbmNlIGFkYXB0ZXIuanMgb3JcbiAgICAgIC8vIGJyb3dzZXJzIGNvbnZlcmdlIG9uIGEgc3RhbmRhcmQuXG4gICAgICBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnY2hyb21lJykge1xuICAgICAgICB2YXIgZW51bWVyYXRlZFN0YXRzID0gZW51bWVyYXRlU3RhdHMocmVzcG9uc2UsIHNlbGYubG9jYWxUcmFja0lkcyxcbiAgICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMpO1xuICAgICAgICBzdGF0cy5wdXNoKGVudW1lcmF0ZWRTdGF0cyk7XG4gICAgICAgIHN0YXRzQ29sbGVjdFRpbWUucHVzaChEYXRlLm5vdygpKTtcbiAgICAgIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgICAgZm9yICh2YXIgaiBpbiByZXNwb25zZSkge1xuICAgICAgICAgIHZhciBzdGF0ID0gcmVzcG9uc2Vbal07XG4gICAgICAgICAgc3RhdHMucHVzaChzdGF0KTtcbiAgICAgICAgICBzdGF0c0NvbGxlY3RUaW1lLnB1c2goRGF0ZS5ub3coKSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNlbGYudGVzdC5yZXBvcnRFcnJvcignT25seSBGaXJlZm94IGFuZCBDaHJvbWUgZ2V0U3RhdHMgJyArXG4gICAgICAgICAgICAnaW1wbGVtZW50YXRpb25zIGFyZSBzdXBwb3J0ZWQuJyk7XG4gICAgICB9XG4gICAgICBzZXRUaW1lb3V0KGdldFN0YXRzXywgc3RhdFN0ZXBNcyk7XG4gICAgfVxuICB9LFxuXG4gIGdvdE9mZmVyXzogZnVuY3Rpb24ob2ZmZXIpIHtcbiAgICBpZiAodGhpcy5jb25zdHJhaW5PZmZlclRvUmVtb3ZlVmlkZW9GZWNfKSB7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvKG09dmlkZW8gMSBbXlxccl0rKSgxMTYgMTE3KShcXHJcXG4pL2csXG4gICAgICAgICAgJyQxXFxyXFxuJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6MTE2IHJlZFxcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDoxMTcgdWxwZmVjXFwvOTAwMDBcXHJcXG4vZywgJycpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjk4IHJ0eFxcLzkwMDAwXFxyXFxuL2csICcnKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPWZtdHA6OTggYXB0PTExNlxcclxcbi9nLCAnJyk7XG4gICAgfVxuICAgIHRoaXMucGMxLnNldExvY2FsRGVzY3JpcHRpb24ob2ZmZXIpO1xuICAgIHRoaXMucGMyLnNldFJlbW90ZURlc2NyaXB0aW9uKG9mZmVyKTtcbiAgICB0aGlzLnBjMi5jcmVhdGVBbnN3ZXIoKS50aGVuKFxuICAgICAgICB0aGlzLmdvdEFuc3dlcl8uYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy50ZXN0LnJlcG9ydEZhdGFsLmJpbmQodGhpcy50ZXN0KVxuICAgICk7XG4gIH0sXG5cbiAgZ290QW5zd2VyXzogZnVuY3Rpb24oYW5zd2VyKSB7XG4gICAgaWYgKHRoaXMuY29uc3RyYWluVmlkZW9CaXRyYXRlS2Jwc18pIHtcbiAgICAgIGFuc3dlci5zZHAgPSBhbnN3ZXIuc2RwLnJlcGxhY2UoXG4gICAgICAgICAgL2E9bWlkOnZpZGVvXFxyXFxuL2csXG4gICAgICAgICAgJ2E9bWlkOnZpZGVvXFxyXFxuYj1BUzonICsgdGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXyArICdcXHJcXG4nKTtcbiAgICB9XG4gICAgdGhpcy5wYzIuc2V0TG9jYWxEZXNjcmlwdGlvbihhbnN3ZXIpO1xuICAgIHRoaXMucGMxLnNldFJlbW90ZURlc2NyaXB0aW9uKGFuc3dlcik7XG4gIH0sXG5cbiAgb25JY2VDYW5kaWRhdGVfOiBmdW5jdGlvbihvdGhlclBlZXIsIGV2ZW50KSB7XG4gICAgaWYgKGV2ZW50LmNhbmRpZGF0ZSkge1xuICAgICAgdmFyIHBhcnNlZCA9IENhbGwucGFyc2VDYW5kaWRhdGUoZXZlbnQuY2FuZGlkYXRlLmNhbmRpZGF0ZSk7XG4gICAgICBpZiAodGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfKHBhcnNlZCkpIHtcbiAgICAgICAgb3RoZXJQZWVyLmFkZEljZUNhbmRpZGF0ZShldmVudC5jYW5kaWRhdGUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuQ2FsbC5ub0ZpbHRlciA9IGZ1bmN0aW9uKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbkNhbGwuaXNSZWxheSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgPT09ICdyZWxheSc7XG59O1xuXG5DYWxsLmlzTm90SG9zdENhbmRpZGF0ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgIT09ICdob3N0Jztcbn07XG5cbkNhbGwuaXNSZWZsZXhpdmUgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAnc3JmbHgnO1xufTtcblxuQ2FsbC5pc0hvc3QgPSBmdW5jdGlvbihjYW5kaWRhdGUpIHtcbiAgcmV0dXJuIGNhbmRpZGF0ZS50eXBlID09PSAnaG9zdCc7XG59O1xuXG5DYWxsLmlzSXB2NiA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLmFkZHJlc3MuaW5kZXhPZignOicpICE9PSAtMTtcbn07XG5cbi8vIFBhcnNlIGEgJ2NhbmRpZGF0ZTonIGxpbmUgaW50byBhIEpTT04gb2JqZWN0LlxuQ2FsbC5wYXJzZUNhbmRpZGF0ZSA9IGZ1bmN0aW9uKHRleHQpIHtcbiAgdmFyIGNhbmRpZGF0ZVN0ciA9ICdjYW5kaWRhdGU6JztcbiAgdmFyIHBvcyA9IHRleHQuaW5kZXhPZihjYW5kaWRhdGVTdHIpICsgY2FuZGlkYXRlU3RyLmxlbmd0aDtcbiAgdmFyIGZpZWxkcyA9IHRleHQuc3Vic3RyKHBvcykuc3BsaXQoJyAnKTtcbiAgcmV0dXJuIHtcbiAgICAndHlwZSc6IGZpZWxkc1s3XSxcbiAgICAncHJvdG9jb2wnOiBmaWVsZHNbMl0sXG4gICAgJ2FkZHJlc3MnOiBmaWVsZHNbNF1cbiAgfTtcbn07XG5cbi8vIFN0b3JlIHRoZSBJQ0Ugc2VydmVyIHJlc3BvbnNlIGZyb20gdGhlIG5ldHdvcmsgdHJhdmVyc2FsIHNlcnZlci5cbkNhbGwuY2FjaGVkSWNlU2VydmVyc18gPSBudWxsO1xuLy8gS2VlcCB0cmFjayBvZiB3aGVuIHRoZSByZXF1ZXN0IHdhcyBtYWRlLlxuQ2FsbC5jYWNoZWRJY2VDb25maWdGZXRjaFRpbWVfID0gbnVsbDtcblxuLy8gR2V0IGEgVFVSTiBjb25maWcsIGVpdGhlciBmcm9tIHNldHRpbmdzIG9yIGZyb20gbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5hc3luY0NyZWF0ZVR1cm5Db25maWcgPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IsIGN1cnJlbnRUZXN0KSB7XG4gIHZhciBzZXR0aW5ncyA9IGN1cnJlbnRUZXN0LnNldHRpbmdzO1xuICB2YXIgaWNlU2VydmVyID0ge1xuICAgICd1c2VybmFtZSc6IHNldHRpbmdzLnR1cm5Vc2VybmFtZSB8fCAnJyxcbiAgICAnY3JlZGVudGlhbCc6IHNldHRpbmdzLnR1cm5DcmVkZW50aWFsIHx8ICcnLFxuICAgICd1cmxzJzogc2V0dGluZ3MudHVyblVSSS5zcGxpdCgnLCcpXG4gIH07XG4gIHZhciBjb25maWcgPSB7J2ljZVNlcnZlcnMnOiBbaWNlU2VydmVyXX07XG4gIHJlcG9ydC50cmFjZUV2ZW50SW5zdGFudCgndHVybi1jb25maWcnLCBjb25maWcpO1xuICBzZXRUaW1lb3V0KG9uU3VjY2Vzcy5iaW5kKG51bGwsIGNvbmZpZyksIDApO1xufTtcblxuLy8gR2V0IGEgU1RVTiBjb25maWcsIGVpdGhlciBmcm9tIHNldHRpbmdzIG9yIGZyb20gbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5hc3luY0NyZWF0ZVN0dW5Db25maWcgPSBmdW5jdGlvbihvblN1Y2Nlc3MsIG9uRXJyb3IpIHtcbiAgdmFyIHNldHRpbmdzID0gY3VycmVudFRlc3Quc2V0dGluZ3M7XG4gIHZhciBpY2VTZXJ2ZXIgPSB7XG4gICAgJ3VybHMnOiBzZXR0aW5ncy5zdHVuVVJJLnNwbGl0KCcsJylcbiAgfTtcbiAgdmFyIGNvbmZpZyA9IHsnaWNlU2VydmVycyc6IFtpY2VTZXJ2ZXJdfTtcbiAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCdzdHVuLWNvbmZpZycsIGNvbmZpZyk7XG4gIHNldFRpbWVvdXQob25TdWNjZXNzLmJpbmQobnVsbCwgY29uZmlnKSwgMCk7XG59O1xuXG5leHBvcnQgZGVmYXVsdCBDYWxsO1xuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTcgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5pbXBvcnQgU3NpbSBmcm9tICcuL3NzaW0uanMnO1xuXG5mdW5jdGlvbiBWaWRlb0ZyYW1lQ2hlY2tlcih2aWRlb0VsZW1lbnQpIHtcbiAgdGhpcy5mcmFtZVN0YXRzID0ge1xuICAgIG51bUZyb3plbkZyYW1lczogMCxcbiAgICBudW1CbGFja0ZyYW1lczogMCxcbiAgICBudW1GcmFtZXM6IDBcbiAgfTtcblxuICB0aGlzLnJ1bm5pbmdfID0gdHJ1ZTtcblxuICB0aGlzLm5vbkJsYWNrUGl4ZWxMdW1hVGhyZXNob2xkID0gMjA7XG4gIHRoaXMucHJldmlvdXNGcmFtZV8gPSBbXTtcbiAgdGhpcy5pZGVudGljYWxGcmFtZVNzaW1UaHJlc2hvbGQgPSAwLjk4NTtcbiAgdGhpcy5mcmFtZUNvbXBhcmF0b3IgPSBuZXcgU3NpbSgpO1xuXG4gIHRoaXMuY2FudmFzXyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICB0aGlzLnZpZGVvRWxlbWVudF8gPSB2aWRlb0VsZW1lbnQ7XG4gIHRoaXMubGlzdGVuZXJfID0gdGhpcy5jaGVja1ZpZGVvRnJhbWVfLmJpbmQodGhpcyk7XG4gIHRoaXMudmlkZW9FbGVtZW50Xy5hZGRFdmVudExpc3RlbmVyKCdwbGF5JywgdGhpcy5saXN0ZW5lcl8sIGZhbHNlKTtcbn1cblxuVmlkZW9GcmFtZUNoZWNrZXIucHJvdG90eXBlID0ge1xuICBzdG9wOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnZpZGVvRWxlbWVudF8ucmVtb3ZlRXZlbnRMaXN0ZW5lcigncGxheScgLCB0aGlzLmxpc3RlbmVyXyk7XG4gICAgdGhpcy5ydW5uaW5nXyA9IGZhbHNlO1xuICB9LFxuXG4gIGdldEN1cnJlbnRJbWFnZURhdGFfOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmNhbnZhc18ud2lkdGggPSB0aGlzLnZpZGVvRWxlbWVudF8ud2lkdGg7XG4gICAgdGhpcy5jYW52YXNfLmhlaWdodCA9IHRoaXMudmlkZW9FbGVtZW50Xy5oZWlnaHQ7XG5cbiAgICB2YXIgY29udGV4dCA9IHRoaXMuY2FudmFzXy5nZXRDb250ZXh0KCcyZCcpO1xuICAgIGNvbnRleHQuZHJhd0ltYWdlKHRoaXMudmlkZW9FbGVtZW50XywgMCwgMCwgdGhpcy5jYW52YXNfLndpZHRoLFxuICAgICAgICB0aGlzLmNhbnZhc18uaGVpZ2h0KTtcbiAgICByZXR1cm4gY29udGV4dC5nZXRJbWFnZURhdGEoMCwgMCwgdGhpcy5jYW52YXNfLndpZHRoLCB0aGlzLmNhbnZhc18uaGVpZ2h0KTtcbiAgfSxcblxuICBjaGVja1ZpZGVvRnJhbWVfOiBmdW5jdGlvbigpIHtcbiAgICBpZiAoIXRoaXMucnVubmluZ18pIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHRoaXMudmlkZW9FbGVtZW50Xy5lbmRlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBpbWFnZURhdGEgPSB0aGlzLmdldEN1cnJlbnRJbWFnZURhdGFfKCk7XG5cbiAgICBpZiAodGhpcy5pc0JsYWNrRnJhbWVfKGltYWdlRGF0YS5kYXRhLCBpbWFnZURhdGEuZGF0YS5sZW5ndGgpKSB7XG4gICAgICB0aGlzLmZyYW1lU3RhdHMubnVtQmxhY2tGcmFtZXMrKztcbiAgICB9XG5cbiAgICBpZiAodGhpcy5mcmFtZUNvbXBhcmF0b3IuY2FsY3VsYXRlKHRoaXMucHJldmlvdXNGcmFtZV8sIGltYWdlRGF0YS5kYXRhKSA+XG4gICAgICAgIHRoaXMuaWRlbnRpY2FsRnJhbWVTc2ltVGhyZXNob2xkKSB7XG4gICAgICB0aGlzLmZyYW1lU3RhdHMubnVtRnJvemVuRnJhbWVzKys7XG4gICAgfVxuICAgIHRoaXMucHJldmlvdXNGcmFtZV8gPSBpbWFnZURhdGEuZGF0YTtcblxuICAgIHRoaXMuZnJhbWVTdGF0cy5udW1GcmFtZXMrKztcbiAgICBzZXRUaW1lb3V0KHRoaXMuY2hlY2tWaWRlb0ZyYW1lXy5iaW5kKHRoaXMpLCAyMCk7XG4gIH0sXG5cbiAgaXNCbGFja0ZyYW1lXzogZnVuY3Rpb24oZGF0YSwgbGVuZ3RoKSB7XG4gICAgLy8gVE9ETzogVXNlIGEgc3RhdGlzdGljYWwsIGhpc3RvZ3JhbS1iYXNlZCBkZXRlY3Rpb24uXG4gICAgdmFyIHRocmVzaCA9IHRoaXMubm9uQmxhY2tQaXhlbEx1bWFUaHJlc2hvbGQ7XG4gICAgdmFyIGFjY3VMdW1hID0gMDtcbiAgICBmb3IgKHZhciBpID0gNDsgaSA8IGxlbmd0aDsgaSArPSA0KSB7XG4gICAgICAvLyBVc2UgTHVtYSBhcyBpbiBSZWMuIDcwOTogWeKAsjcwOSA9IDAuMjFSICsgMC43MkcgKyAwLjA3QjtcbiAgICAgIGFjY3VMdW1hICs9IDAuMjEgKiBkYXRhW2ldICsgMC43MiAqIGRhdGFbaSArIDFdICsgMC4wNyAqIGRhdGFbaSArIDJdO1xuICAgICAgLy8gRWFybHkgdGVybWluYXRpb24gaWYgdGhlIGF2ZXJhZ2UgTHVtYSBzbyBmYXIgaXMgYnJpZ2h0IGVub3VnaC5cbiAgICAgIGlmIChhY2N1THVtYSA+ICh0aHJlc2ggKiBpIC8gNCkpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxufTtcblxuaWYgKHR5cGVvZiBleHBvcnRzID09PSAnb2JqZWN0Jykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFZpZGVvRnJhbWVDaGVja2VyO1xufVxuIiwiLypcbiAqICBDb3B5cmlnaHQgKGMpIDIwMTQgVGhlIFdlYlJUQyBwcm9qZWN0IGF1dGhvcnMuIEFsbCBSaWdodHMgUmVzZXJ2ZWQuXG4gKlxuICogIFVzZSBvZiB0aGlzIHNvdXJjZSBjb2RlIGlzIGdvdmVybmVkIGJ5IGEgQlNELXN0eWxlIGxpY2Vuc2VcbiAqICB0aGF0IGNhbiBiZSBmb3VuZCBpbiB0aGUgTElDRU5TRSBmaWxlIGluIHRoZSByb290IG9mIHRoZSBzb3VyY2VcbiAqICB0cmVlLlxuICovXG4ndXNlIHN0cmljdCc7XG5pbXBvcnQgYWRhcHRlciBmcm9tICd3ZWJydGMtYWRhcHRlcic7XG5pbXBvcnQgUmVwb3J0IGZyb20gJy4vcmVwb3J0LmpzJztcbmltcG9ydCB7IGVudW1lcmF0ZVN0YXRzIH0gZnJvbSAnLi91dGlsLmpzJztcblxuY29uc3QgcmVwb3J0ID0gbmV3IFJlcG9ydCgpO1xuXG5mdW5jdGlvbiBDYWxsKGNvbmZpZywgdGVzdCkge1xuICB0aGlzLnRlc3QgPSB0ZXN0O1xuICB0aGlzLnRyYWNlRXZlbnQgPSByZXBvcnQudHJhY2VFdmVudEFzeW5jKCdjYWxsJyk7XG4gIHRoaXMudHJhY2VFdmVudCh7Y29uZmlnOiBjb25maWd9KTtcbiAgdGhpcy5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSBmYWxzZTtcblxuICB0aGlzLnBjMSA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbihjb25maWcpO1xuICB0aGlzLnBjMiA9IG5ldyBSVENQZWVyQ29ubmVjdGlvbihjb25maWcpO1xuXG4gIHRoaXMucGMxLmFkZEV2ZW50TGlzdGVuZXIoJ2ljZWNhbmRpZGF0ZScsIHRoaXMub25JY2VDYW5kaWRhdGVfLmJpbmQodGhpcyxcbiAgICAgIHRoaXMucGMyKSk7XG4gIHRoaXMucGMyLmFkZEV2ZW50TGlzdGVuZXIoJ2ljZWNhbmRpZGF0ZScsIHRoaXMub25JY2VDYW5kaWRhdGVfLmJpbmQodGhpcyxcbiAgICAgIHRoaXMucGMxKSk7XG5cbiAgdGhpcy5pY2VDYW5kaWRhdGVGaWx0ZXJfID0gQ2FsbC5ub0ZpbHRlcjtcbn1cblxuQ2FsbC5wcm90b3R5cGUgPSB7XG4gIGVzdGFibGlzaENvbm5lY3Rpb246IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudHJhY2VFdmVudCh7c3RhdGU6ICdzdGFydCd9KTtcbiAgICB0aGlzLnBjMS5jcmVhdGVPZmZlcigpLnRoZW4oXG4gICAgICAgIHRoaXMuZ290T2ZmZXJfLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMudGVzdC5yZXBvcnRGYXRhbC5iaW5kKHRoaXMudGVzdClcbiAgICApO1xuICB9LFxuXG4gIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnRyYWNlRXZlbnQoe3N0YXRlOiAnZW5kJ30pO1xuICAgIHRoaXMucGMxLmNsb3NlKCk7XG4gICAgdGhpcy5wYzIuY2xvc2UoKTtcbiAgfSxcblxuICBzZXRJY2VDYW5kaWRhdGVGaWx0ZXI6IGZ1bmN0aW9uKGZpbHRlcikge1xuICAgIHRoaXMuaWNlQ2FuZGlkYXRlRmlsdGVyXyA9IGZpbHRlcjtcbiAgfSxcblxuICAvLyBDb25zdHJhaW50IG1heCB2aWRlbyBiaXRyYXRlIGJ5IG1vZGlmeWluZyB0aGUgU0RQIHdoZW4gY3JlYXRpbmcgYW4gYW5zd2VyLlxuICBjb25zdHJhaW5WaWRlb0JpdHJhdGU6IGZ1bmN0aW9uKG1heFZpZGVvQml0cmF0ZUticHMpIHtcbiAgICB0aGlzLmNvbnN0cmFpblZpZGVvQml0cmF0ZUticHNfID0gbWF4VmlkZW9CaXRyYXRlS2JwcztcbiAgfSxcblxuICAvLyBSZW1vdmUgdmlkZW8gRkVDIGlmIGF2YWlsYWJsZSBvbiB0aGUgb2ZmZXIuXG4gIGRpc2FibGVWaWRlb0ZlYzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5jb25zdHJhaW5PZmZlclRvUmVtb3ZlVmlkZW9GZWNfID0gdHJ1ZTtcbiAgfSxcblxuICAvLyBXaGVuIHRoZSBwZWVyQ29ubmVjdGlvbiBpcyBjbG9zZWQgdGhlIHN0YXRzQ2IgaXMgY2FsbGVkIG9uY2Ugd2l0aCBhbiBhcnJheVxuICAvLyBvZiBnYXRoZXJlZCBzdGF0cy5cbiAgZ2F0aGVyU3RhdHM6IGZ1bmN0aW9uKHBlZXJDb25uZWN0aW9uLHBlZXJDb25uZWN0aW9uMiwgbG9jYWxTdHJlYW0sIHN0YXRzQ2IpIHtcbiAgICB2YXIgc3RhdHMgPSBbXTtcbiAgICB2YXIgc3RhdHMyID0gW107XG4gICAgdmFyIHN0YXRzQ29sbGVjdFRpbWUgPSBbXTtcbiAgICB2YXIgc3RhdHNDb2xsZWN0VGltZTIgPSBbXTtcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgdmFyIHN0YXRTdGVwTXMgPSAxMDA7XG4gICAgc2VsZi5sb2NhbFRyYWNrSWRzID0ge1xuICAgICAgYXVkaW86ICcnLFxuICAgICAgdmlkZW86ICcnXG4gICAgfTtcbiAgICBzZWxmLnJlbW90ZVRyYWNrSWRzID0ge1xuICAgICAgYXVkaW86ICcnLFxuICAgICAgdmlkZW86ICcnXG4gICAgfTtcblxuICAgIHBlZXJDb25uZWN0aW9uLmdldFNlbmRlcnMoKS5mb3JFYWNoKGZ1bmN0aW9uKHNlbmRlcikge1xuICAgICAgaWYgKHNlbmRlci50cmFjay5raW5kID09PSAnYXVkaW8nKSB7XG4gICAgICAgIHNlbGYubG9jYWxUcmFja0lkcy5hdWRpbyA9IHNlbmRlci50cmFjay5pZDtcbiAgICAgIH0gZWxzZSBpZiAoc2VuZGVyLnRyYWNrLmtpbmQgPT09ICd2aWRlbycpIHtcbiAgICAgICAgc2VsZi5sb2NhbFRyYWNrSWRzLnZpZGVvID0gc2VuZGVyLnRyYWNrLmlkO1xuICAgICAgfVxuICAgIH0uYmluZChzZWxmKSk7XG5cbiAgICBpZiAocGVlckNvbm5lY3Rpb24yKSB7XG4gICAgICBwZWVyQ29ubmVjdGlvbjIuZ2V0UmVjZWl2ZXJzKCkuZm9yRWFjaChmdW5jdGlvbihyZWNlaXZlcikge1xuICAgICAgICBpZiAocmVjZWl2ZXIudHJhY2sua2luZCA9PT0gJ2F1ZGlvJykge1xuICAgICAgICAgIHNlbGYucmVtb3RlVHJhY2tJZHMuYXVkaW8gPSByZWNlaXZlci50cmFjay5pZDtcbiAgICAgICAgfSBlbHNlIGlmIChyZWNlaXZlci50cmFjay5raW5kID09PSAndmlkZW8nKSB7XG4gICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcy52aWRlbyA9IHJlY2VpdmVyLnRyYWNrLmlkO1xuICAgICAgICB9XG4gICAgICB9LmJpbmQoc2VsZikpO1xuICAgIH1cblxuICAgIHRoaXMuc3RhdHNHYXRoZXJpbmdSdW5uaW5nID0gdHJ1ZTtcbiAgICBnZXRTdGF0c18oKTtcblxuICAgIGZ1bmN0aW9uIGdldFN0YXRzXygpIHtcbiAgICAgIGlmIChwZWVyQ29ubmVjdGlvbi5zaWduYWxpbmdTdGF0ZSA9PT0gJ2Nsb3NlZCcpIHtcbiAgICAgICAgc2VsZi5zdGF0c0dhdGhlcmluZ1J1bm5pbmcgPSBmYWxzZTtcbiAgICAgICAgc3RhdHNDYihzdGF0cywgc3RhdHNDb2xsZWN0VGltZSwgc3RhdHMyLCBzdGF0c0NvbGxlY3RUaW1lMik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHBlZXJDb25uZWN0aW9uLmdldFN0YXRzKClcbiAgICAgICAgICAudGhlbihnb3RTdGF0c18pXG4gICAgICAgICAgLmNhdGNoKGZ1bmN0aW9uKGVycm9yKSB7XG4gICAgICAgICAgICBzZWxmLnRlc3QucmVwb3J0RXJyb3IoJ0NvdWxkIG5vdCBnYXRoZXIgc3RhdHM6ICcgKyBlcnJvcik7XG4gICAgICAgICAgICBzZWxmLnN0YXRzR2F0aGVyaW5nUnVubmluZyA9IGZhbHNlO1xuICAgICAgICAgICAgc3RhdHNDYihzdGF0cywgc3RhdHNDb2xsZWN0VGltZSk7XG4gICAgICAgICAgfS5iaW5kKHNlbGYpKTtcbiAgICAgIGlmIChwZWVyQ29ubmVjdGlvbjIpIHtcbiAgICAgICAgcGVlckNvbm5lY3Rpb24yLmdldFN0YXRzKClcbiAgICAgICAgICAgIC50aGVuKGdvdFN0YXRzMl8pO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBTdGF0cyBmb3IgcGMyLCBzb21lIHN0YXRzIGFyZSBvbmx5IGF2YWlsYWJsZSBvbiB0aGUgcmVjZWl2aW5nIGVuZCBvZiBhXG4gICAgLy8gcGVlcmNvbm5lY3Rpb24uXG4gICAgZnVuY3Rpb24gZ290U3RhdHMyXyhyZXNwb25zZSkge1xuICAgICAgaWYgKGFkYXB0ZXIuYnJvd3NlckRldGFpbHMuYnJvd3NlciA9PT0gJ2Nocm9tZScpIHtcbiAgICAgICAgdmFyIGVudW1lcmF0ZWRTdGF0cyA9IGVudW1lcmF0ZVN0YXRzKHJlc3BvbnNlLCBzZWxmLmxvY2FsVHJhY2tJZHMsXG4gICAgICAgICAgICBzZWxmLnJlbW90ZVRyYWNrSWRzKTtcbiAgICAgICAgc3RhdHMyLnB1c2goZW51bWVyYXRlZFN0YXRzKTtcbiAgICAgICAgc3RhdHNDb2xsZWN0VGltZTIucHVzaChEYXRlLm5vdygpKTtcbiAgICAgIH0gZWxzZSBpZiAoYWRhcHRlci5icm93c2VyRGV0YWlscy5icm93c2VyID09PSAnZmlyZWZveCcpIHtcbiAgICAgICAgZm9yICh2YXIgaCBpbiByZXNwb25zZSkge1xuICAgICAgICAgIHZhciBzdGF0ID0gcmVzcG9uc2VbaF07XG4gICAgICAgICAgc3RhdHMyLnB1c2goc3RhdCk7XG4gICAgICAgICAgc3RhdHNDb2xsZWN0VGltZTIucHVzaChEYXRlLm5vdygpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi50ZXN0LnJlcG9ydEVycm9yKCdPbmx5IEZpcmVmb3ggYW5kIENocm9tZSBnZXRTdGF0cyAnICtcbiAgICAgICAgICAgICdpbXBsZW1lbnRhdGlvbnMgYXJlIHN1cHBvcnRlZC4nKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmdW5jdGlvbiBnb3RTdGF0c18ocmVzcG9uc2UpIHtcbiAgICAgIC8vIFRPRE86IFJlbW92ZSBicm93c2VyIHNwZWNpZmljIHN0YXRzIGdhdGhlcmluZyBoYWNrIG9uY2UgYWRhcHRlci5qcyBvclxuICAgICAgLy8gYnJvd3NlcnMgY29udmVyZ2Ugb24gYSBzdGFuZGFyZC5cbiAgICAgIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdjaHJvbWUnKSB7XG4gICAgICAgIHZhciBlbnVtZXJhdGVkU3RhdHMgPSBlbnVtZXJhdGVTdGF0cyhyZXNwb25zZSwgc2VsZi5sb2NhbFRyYWNrSWRzLFxuICAgICAgICAgICAgc2VsZi5yZW1vdGVUcmFja0lkcyk7XG4gICAgICAgIHN0YXRzLnB1c2goZW51bWVyYXRlZFN0YXRzKTtcbiAgICAgICAgc3RhdHNDb2xsZWN0VGltZS5wdXNoKERhdGUubm93KCkpO1xuICAgICAgfSBlbHNlIGlmIChhZGFwdGVyLmJyb3dzZXJEZXRhaWxzLmJyb3dzZXIgPT09ICdmaXJlZm94Jykge1xuICAgICAgICBmb3IgKHZhciBqIGluIHJlc3BvbnNlKSB7XG4gICAgICAgICAgdmFyIHN0YXQgPSByZXNwb25zZVtqXTtcbiAgICAgICAgICBzdGF0cy5wdXNoKHN0YXQpO1xuICAgICAgICAgIHN0YXRzQ29sbGVjdFRpbWUucHVzaChEYXRlLm5vdygpKTtcbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi50ZXN0LnJlcG9ydEVycm9yKCdPbmx5IEZpcmVmb3ggYW5kIENocm9tZSBnZXRTdGF0cyAnICtcbiAgICAgICAgICAgICdpbXBsZW1lbnRhdGlvbnMgYXJlIHN1cHBvcnRlZC4nKTtcbiAgICAgIH1cbiAgICAgIHNldFRpbWVvdXQoZ2V0U3RhdHNfLCBzdGF0U3RlcE1zKTtcbiAgICB9XG4gIH0sXG5cbiAgZ290T2ZmZXJfOiBmdW5jdGlvbihvZmZlcikge1xuICAgIGlmICh0aGlzLmNvbnN0cmFpbk9mZmVyVG9SZW1vdmVWaWRlb0ZlY18pIHtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC8obT12aWRlbyAxIFteXFxyXSspKDExNiAxMTcpKFxcclxcbikvZyxcbiAgICAgICAgICAnJDFcXHJcXG4nKTtcbiAgICAgIG9mZmVyLnNkcCA9IG9mZmVyLnNkcC5yZXBsYWNlKC9hPXJ0cG1hcDoxMTYgcmVkXFwvOTAwMDBcXHJcXG4vZywgJycpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9cnRwbWFwOjExNyB1bHBmZWNcXC85MDAwMFxcclxcbi9nLCAnJyk7XG4gICAgICBvZmZlci5zZHAgPSBvZmZlci5zZHAucmVwbGFjZSgvYT1ydHBtYXA6OTggcnR4XFwvOTAwMDBcXHJcXG4vZywgJycpO1xuICAgICAgb2ZmZXIuc2RwID0gb2ZmZXIuc2RwLnJlcGxhY2UoL2E9Zm10cDo5OCBhcHQ9MTE2XFxyXFxuL2csICcnKTtcbiAgICB9XG4gICAgdGhpcy5wYzEuc2V0TG9jYWxEZXNjcmlwdGlvbihvZmZlcik7XG4gICAgdGhpcy5wYzIuc2V0UmVtb3RlRGVzY3JpcHRpb24ob2ZmZXIpO1xuICAgIHRoaXMucGMyLmNyZWF0ZUFuc3dlcigpLnRoZW4oXG4gICAgICAgIHRoaXMuZ290QW5zd2VyXy5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLnRlc3QucmVwb3J0RmF0YWwuYmluZCh0aGlzLnRlc3QpXG4gICAgKTtcbiAgfSxcblxuICBnb3RBbnN3ZXJfOiBmdW5jdGlvbihhbnN3ZXIpIHtcbiAgICBpZiAodGhpcy5jb25zdHJhaW5WaWRlb0JpdHJhdGVLYnBzXykge1xuICAgICAgYW5zd2VyLnNkcCA9IGFuc3dlci5zZHAucmVwbGFjZShcbiAgICAgICAgICAvYT1taWQ6dmlkZW9cXHJcXG4vZyxcbiAgICAgICAgICAnYT1taWQ6dmlkZW9cXHJcXG5iPUFTOicgKyB0aGlzLmNvbnN0cmFpblZpZGVvQml0cmF0ZUticHNfICsgJ1xcclxcbicpO1xuICAgIH1cbiAgICB0aGlzLnBjMi5zZXRMb2NhbERlc2NyaXB0aW9uKGFuc3dlcik7XG4gICAgdGhpcy5wYzEuc2V0UmVtb3RlRGVzY3JpcHRpb24oYW5zd2VyKTtcbiAgfSxcblxuICBvbkljZUNhbmRpZGF0ZV86IGZ1bmN0aW9uKG90aGVyUGVlciwgZXZlbnQpIHtcbiAgICBpZiAoZXZlbnQuY2FuZGlkYXRlKSB7XG4gICAgICB2YXIgcGFyc2VkID0gQ2FsbC5wYXJzZUNhbmRpZGF0ZShldmVudC5jYW5kaWRhdGUuY2FuZGlkYXRlKTtcbiAgICAgIGlmICh0aGlzLmljZUNhbmRpZGF0ZUZpbHRlcl8ocGFyc2VkKSkge1xuICAgICAgICBvdGhlclBlZXIuYWRkSWNlQ2FuZGlkYXRlKGV2ZW50LmNhbmRpZGF0ZSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59O1xuXG5DYWxsLm5vRmlsdGVyID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0cnVlO1xufTtcblxuQ2FsbC5pc1JlbGF5ID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSA9PT0gJ3JlbGF5Jztcbn07XG5cbkNhbGwuaXNOb3RIb3N0Q2FuZGlkYXRlID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUudHlwZSAhPT0gJ2hvc3QnO1xufTtcblxuQ2FsbC5pc1JlZmxleGl2ZSA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgPT09ICdzcmZseCc7XG59O1xuXG5DYWxsLmlzSG9zdCA9IGZ1bmN0aW9uKGNhbmRpZGF0ZSkge1xuICByZXR1cm4gY2FuZGlkYXRlLnR5cGUgPT09ICdob3N0Jztcbn07XG5cbkNhbGwuaXNJcHY2ID0gZnVuY3Rpb24oY2FuZGlkYXRlKSB7XG4gIHJldHVybiBjYW5kaWRhdGUuYWRkcmVzcy5pbmRleE9mKCc6JykgIT09IC0xO1xufTtcblxuLy8gUGFyc2UgYSAnY2FuZGlkYXRlOicgbGluZSBpbnRvIGEgSlNPTiBvYmplY3QuXG5DYWxsLnBhcnNlQ2FuZGlkYXRlID0gZnVuY3Rpb24odGV4dCkge1xuICB2YXIgY2FuZGlkYXRlU3RyID0gJ2NhbmRpZGF0ZTonO1xuICB2YXIgcG9zID0gdGV4dC5pbmRleE9mKGNhbmRpZGF0ZVN0cikgKyBjYW5kaWRhdGVTdHIubGVuZ3RoO1xuICB2YXIgZmllbGRzID0gdGV4dC5zdWJzdHIocG9zKS5zcGxpdCgnICcpO1xuICByZXR1cm4ge1xuICAgICd0eXBlJzogZmllbGRzWzddLFxuICAgICdwcm90b2NvbCc6IGZpZWxkc1syXSxcbiAgICAnYWRkcmVzcyc6IGZpZWxkc1s0XVxuICB9O1xufTtcblxuLy8gU3RvcmUgdGhlIElDRSBzZXJ2ZXIgcmVzcG9uc2UgZnJvbSB0aGUgbmV0d29yayB0cmF2ZXJzYWwgc2VydmVyLlxuQ2FsbC5jYWNoZWRJY2VTZXJ2ZXJzXyA9IG51bGw7XG4vLyBLZWVwIHRyYWNrIG9mIHdoZW4gdGhlIHJlcXVlc3Qgd2FzIG1hZGUuXG5DYWxsLmNhY2hlZEljZUNvbmZpZ0ZldGNoVGltZV8gPSBudWxsO1xuXG4vLyBHZXQgYSBUVVJOIGNvbmZpZywgZWl0aGVyIGZyb20gc2V0dGluZ3Mgb3IgZnJvbSBuZXR3b3JrIHRyYXZlcnNhbCBzZXJ2ZXIuXG5DYWxsLmFzeW5jQ3JlYXRlVHVybkNvbmZpZyA9IGZ1bmN0aW9uKG9uU3VjY2Vzcywgb25FcnJvciwgY3VycmVudFRlc3QpIHtcbiAgdmFyIHNldHRpbmdzID0gY3VycmVudFRlc3Quc2V0dGluZ3M7XG4gIHZhciBpY2VTZXJ2ZXIgPSB7XG4gICAgJ3VzZXJuYW1lJzogc2V0dGluZ3MudHVyblVzZXJuYW1lIHx8ICcnLFxuICAgICdjcmVkZW50aWFsJzogc2V0dGluZ3MudHVybkNyZWRlbnRpYWwgfHwgJycsXG4gICAgJ3VybHMnOiBzZXR0aW5ncy50dXJuVVJJLnNwbGl0KCcsJylcbiAgfTtcbiAgdmFyIGNvbmZpZyA9IHsnaWNlU2VydmVycyc6IFtpY2VTZXJ2ZXJdfTtcbiAgcmVwb3J0LnRyYWNlRXZlbnRJbnN0YW50KCd0dXJuLWNvbmZpZycsIGNvbmZpZyk7XG4gIHNldFRpbWVvdXQob25TdWNjZXNzLmJpbmQobnVsbCwgY29uZmlnKSwgMCk7XG59O1xuXG4vLyBHZXQgYSBTVFVOIGNvbmZpZywgZWl0aGVyIGZyb20gc2V0dGluZ3Mgb3IgZnJvbSBuZXR3b3JrIHRyYXZlcnNhbCBzZXJ2ZXIuXG5DYWxsLmFzeW5jQ3JlYXRlU3R1bkNvbmZpZyA9IGZ1bmN0aW9uKG9uU3VjY2Vzcywgb25FcnJvcikge1xuICB2YXIgc2V0dGluZ3MgPSBjdXJyZW50VGVzdC5zZXR0aW5ncztcbiAgdmFyIGljZVNlcnZlciA9IHtcbiAgICAndXJscyc6IHNldHRpbmdzLnN0dW5VUkkuc3BsaXQoJywnKVxuICB9O1xuICB2YXIgY29uZmlnID0geydpY2VTZXJ2ZXJzJzogW2ljZVNlcnZlcl19O1xuICByZXBvcnQudHJhY2VFdmVudEluc3RhbnQoJ3N0dW4tY29uZmlnJywgY29uZmlnKTtcbiAgc2V0VGltZW91dChvblN1Y2Nlc3MuYmluZChudWxsLCBjb25maWcpLCAwKTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IENhbGw7XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNCBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbi8qIGV4cG9ydGVkIHJlcG9ydCAqL1xuJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBSZXBvcnQoKSB7XG4gIHRoaXMub3V0cHV0XyA9IFtdO1xuICB0aGlzLm5leHRBc3luY0lkXyA9IDA7XG5cbiAgLy8gSG9vayBjb25zb2xlLmxvZyBpbnRvIHRoZSByZXBvcnQsIHNpbmNlIHRoYXQgaXMgdGhlIG1vc3QgY29tbW9uIGRlYnVnIHRvb2wuXG4gIHRoaXMubmF0aXZlTG9nXyA9IGNvbnNvbGUubG9nLmJpbmQoY29uc29sZSk7XG4gIGNvbnNvbGUubG9nID0gdGhpcy5sb2dIb29rXy5iaW5kKHRoaXMpO1xuXG4gIC8vIEhvb2sgdXAgd2luZG93Lm9uZXJyb3IgbG9ncyBpbnRvIHRoZSByZXBvcnQuXG4gIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIHRoaXMub25XaW5kb3dFcnJvcl8uYmluZCh0aGlzKSk7XG5cbiAgdGhpcy50cmFjZUV2ZW50SW5zdGFudCgnc3lzdGVtLWluZm8nLCBSZXBvcnQuZ2V0U3lzdGVtSW5mbygpKTtcbn1cblxuUmVwb3J0LnByb3RvdHlwZSA9IHtcbiAgdHJhY2VFdmVudEluc3RhbnQ6IGZ1bmN0aW9uKG5hbWUsIGFyZ3MpIHtcbiAgICB0aGlzLm91dHB1dF8ucHVzaCh7J3RzJzogRGF0ZS5ub3coKSxcbiAgICAgICduYW1lJzogbmFtZSxcbiAgICAgICdhcmdzJzogYXJnc30pO1xuICB9LFxuXG4gIHRyYWNlRXZlbnRXaXRoSWQ6IGZ1bmN0aW9uKG5hbWUsIGlkLCBhcmdzKSB7XG4gICAgdGhpcy5vdXRwdXRfLnB1c2goeyd0cyc6IERhdGUubm93KCksXG4gICAgICAnbmFtZSc6IG5hbWUsXG4gICAgICAnaWQnOiBpZCxcbiAgICAgICdhcmdzJzogYXJnc30pO1xuICB9LFxuXG4gIHRyYWNlRXZlbnRBc3luYzogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnRyYWNlRXZlbnRXaXRoSWQuYmluZCh0aGlzLCBuYW1lLCB0aGlzLm5leHRBc3luY0lkXysrKTtcbiAgfSxcblxuICBsb2dUZXN0UnVuUmVzdWx0OiBmdW5jdGlvbih0ZXN0TmFtZSwgc3RhdHVzKSB7XG4gICAgLy8gR29vZ2xlIEFuYWx5dGljcyBldmVudCBmb3IgdGhlIHRlc3QgcmVzdWx0IHRvIGFsbG93IHRvIHRyYWNrIGhvdyB0aGVcbiAgICAvLyB0ZXN0IGlzIGRvaW5nIGluIHRoZSB3aWxkLlxuICAgIGdhKCdzZW5kJywge1xuICAgICAgJ2hpdFR5cGUnOiAnZXZlbnQnLFxuICAgICAgJ2V2ZW50Q2F0ZWdvcnknOiAnVGVzdCcsXG4gICAgICAnZXZlbnRBY3Rpb24nOiBzdGF0dXMsXG4gICAgICAnZXZlbnRMYWJlbCc6IHRlc3ROYW1lLFxuICAgICAgJ25vbkludGVyYWN0aW9uJzogMVxuICAgIH0pO1xuICB9LFxuXG4gIGdlbmVyYXRlOiBmdW5jdGlvbihidWdEZXNjcmlwdGlvbikge1xuICAgIHZhciBoZWFkZXIgPSB7J3RpdGxlJzogJ1dlYlJUQyBUcm91Ymxlc2hvb3RlciBidWcgcmVwb3J0JyxcbiAgICAgICdkZXNjcmlwdGlvbic6IGJ1Z0Rlc2NyaXB0aW9uIHx8IG51bGx9O1xuICAgIHJldHVybiB0aGlzLmdldENvbnRlbnRfKGhlYWRlcik7XG4gIH0sXG5cbiAgLy8gUmV0dXJucyB0aGUgbG9ncyBpbnRvIGEgSlNPTiBmb3JtYXRlZCBzdHJpbmcgdGhhdCBpcyBhIGxpc3Qgb2YgZXZlbnRzXG4gIC8vIHNpbWlsYXIgdG8gdGhlIHdheSBjaHJvbWUgZGV2dG9vbHMgZm9ybWF0IHVzZXMuIFRoZSBmaW5hbCBzdHJpbmcgaXNcbiAgLy8gbWFudWFsbHkgY29tcG9zZWQgdG8gaGF2ZSBuZXdsaW5lcyBiZXR3ZWVuIHRoZSBlbnRyaWVzIGlzIGJlaW5nIGVhc2llclxuICAvLyB0byBwYXJzZSBieSBodW1hbiBleWVzLiBJZiBhIGNvbnRlbnRIZWFkIG9iamVjdCBhcmd1bWVudCBpcyBwcm92aWRlZCBpdFxuICAvLyB3aWxsIGJlIGFkZGVkIGF0IHRoZSB0b3Agb2YgdGhlIGxvZyBmaWxlLlxuICBnZXRDb250ZW50XzogZnVuY3Rpb24oY29udGVudEhlYWQpIHtcbiAgICB2YXIgc3RyaW5nQXJyYXkgPSBbXTtcbiAgICB0aGlzLmFwcGVuZEV2ZW50c0FzU3RyaW5nXyhbY29udGVudEhlYWRdIHx8IFtdLCBzdHJpbmdBcnJheSk7XG4gICAgdGhpcy5hcHBlbmRFdmVudHNBc1N0cmluZ18odGhpcy5vdXRwdXRfLCBzdHJpbmdBcnJheSk7XG4gICAgcmV0dXJuICdbJyArIHN0cmluZ0FycmF5LmpvaW4oJyxcXG4nKSArICddJztcbiAgfSxcblxuICBhcHBlbmRFdmVudHNBc1N0cmluZ186IGZ1bmN0aW9uKGV2ZW50cywgb3V0cHV0KSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgIT09IGV2ZW50cy5sZW5ndGg7ICsraSkge1xuICAgICAgb3V0cHV0LnB1c2goSlNPTi5zdHJpbmdpZnkoZXZlbnRzW2ldKSk7XG4gICAgfVxuICB9LFxuXG4gIG9uV2luZG93RXJyb3JfOiBmdW5jdGlvbihlcnJvcikge1xuICAgIHRoaXMudHJhY2VFdmVudEluc3RhbnQoJ2Vycm9yJywgeydtZXNzYWdlJzogZXJyb3IubWVzc2FnZSxcbiAgICAgICdmaWxlbmFtZSc6IGVycm9yLmZpbGVuYW1lICsgJzonICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBlcnJvci5saW5lbm99KTtcbiAgfSxcblxuICBsb2dIb29rXzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy50cmFjZUV2ZW50SW5zdGFudCgnbG9nJywgYXJndW1lbnRzKTtcbiAgICB0aGlzLm5hdGl2ZUxvZ18uYXBwbHkobnVsbCwgYXJndW1lbnRzKTtcbiAgfVxufTtcblxuLypcbiAqIERldGVjdHMgdGhlIHJ1bm5pbmcgYnJvd3NlciBuYW1lLCB2ZXJzaW9uIGFuZCBwbGF0Zm9ybS5cbiAqL1xuUmVwb3J0LmdldFN5c3RlbUluZm8gPSBmdW5jdGlvbigpIHtcbiAgLy8gQ29kZSBpbnNwaXJlZCBieSBodHRwOi8vZ29vLmdsLzlkWlpxRSB3aXRoXG4gIC8vIGFkZGVkIHN1cHBvcnQgb2YgbW9kZXJuIEludGVybmV0IEV4cGxvcmVyIHZlcnNpb25zIChUcmlkZW50KS5cbiAgdmFyIGFnZW50ID0gbmF2aWdhdG9yLnVzZXJBZ2VudDtcbiAgdmFyIGJyb3dzZXJOYW1lID0gbmF2aWdhdG9yLmFwcE5hbWU7XG4gIHZhciB2ZXJzaW9uID0gJycgKyBwYXJzZUZsb2F0KG5hdmlnYXRvci5hcHBWZXJzaW9uKTtcbiAgdmFyIG9mZnNldE5hbWU7XG4gIHZhciBvZmZzZXRWZXJzaW9uO1xuICB2YXIgaXg7XG5cbiAgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignQ2hyb21lJykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ0Nocm9tZSc7XG4gICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgNyk7XG4gIH0gZWxzZSBpZiAoKG9mZnNldFZlcnNpb24gPSBhZ2VudC5pbmRleE9mKCdNU0lFJykpICE9PSAtMSkge1xuICAgIGJyb3dzZXJOYW1lID0gJ01pY3Jvc29mdCBJbnRlcm5ldCBFeHBsb3Jlcic7IC8vIE9sZGVyIElFIHZlcnNpb25zLlxuICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDUpO1xuICB9IGVsc2UgaWYgKChvZmZzZXRWZXJzaW9uID0gYWdlbnQuaW5kZXhPZignVHJpZGVudCcpKSAhPT0gLTEpIHtcbiAgICBicm93c2VyTmFtZSA9ICdNaWNyb3NvZnQgSW50ZXJuZXQgRXhwbG9yZXInOyAvLyBOZXdlciBJRSB2ZXJzaW9ucy5cbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyA4KTtcbiAgfSBlbHNlIGlmICgob2Zmc2V0VmVyc2lvbiA9IGFnZW50LmluZGV4T2YoJ0ZpcmVmb3gnKSkgIT09IC0xKSB7XG4gICAgYnJvd3Nlck5hbWUgPSAnRmlyZWZveCc7XG4gIH0gZWxzZSBpZiAoKG9mZnNldFZlcnNpb24gPSBhZ2VudC5pbmRleE9mKCdTYWZhcmknKSkgIT09IC0xKSB7XG4gICAgYnJvd3Nlck5hbWUgPSAnU2FmYXJpJztcbiAgICB2ZXJzaW9uID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldFZlcnNpb24gKyA3KTtcbiAgICBpZiAoKG9mZnNldFZlcnNpb24gPSBhZ2VudC5pbmRleE9mKCdWZXJzaW9uJykpICE9PSAtMSkge1xuICAgICAgdmVyc2lvbiA9IGFnZW50LnN1YnN0cmluZyhvZmZzZXRWZXJzaW9uICsgOCk7XG4gICAgfVxuICB9IGVsc2UgaWYgKChvZmZzZXROYW1lID0gYWdlbnQubGFzdEluZGV4T2YoJyAnKSArIDEpIDxcbiAgICAgICAgICAgICAgKG9mZnNldFZlcnNpb24gPSBhZ2VudC5sYXN0SW5kZXhPZignLycpKSkge1xuICAgIC8vIEZvciBvdGhlciBicm93c2VycyAnbmFtZS92ZXJzaW9uJyBpcyBhdCB0aGUgZW5kIG9mIHVzZXJBZ2VudFxuICAgIGJyb3dzZXJOYW1lID0gYWdlbnQuc3Vic3RyaW5nKG9mZnNldE5hbWUsIG9mZnNldFZlcnNpb24pO1xuICAgIHZlcnNpb24gPSBhZ2VudC5zdWJzdHJpbmcob2Zmc2V0VmVyc2lvbiArIDEpO1xuICAgIGlmIChicm93c2VyTmFtZS50b0xvd2VyQ2FzZSgpID09PSBicm93c2VyTmFtZS50b1VwcGVyQ2FzZSgpKSB7XG4gICAgICBicm93c2VyTmFtZSA9IG5hdmlnYXRvci5hcHBOYW1lO1xuICAgIH1cbiAgfSAvLyBUcmltIHRoZSB2ZXJzaW9uIHN0cmluZyBhdCBzZW1pY29sb24vc3BhY2UgaWYgcHJlc2VudC5cbiAgaWYgKChpeCA9IHZlcnNpb24uaW5kZXhPZignOycpKSAhPT0gLTEpIHtcbiAgICB2ZXJzaW9uID0gdmVyc2lvbi5zdWJzdHJpbmcoMCwgaXgpO1xuICB9XG4gIGlmICgoaXggPSB2ZXJzaW9uLmluZGV4T2YoJyAnKSkgIT09IC0xKSB7XG4gICAgdmVyc2lvbiA9IHZlcnNpb24uc3Vic3RyaW5nKDAsIGl4KTtcbiAgfVxuICByZXR1cm4geydicm93c2VyTmFtZSc6IGJyb3dzZXJOYW1lLFxuICAgICdicm93c2VyVmVyc2lvbic6IHZlcnNpb24sXG4gICAgJ3BsYXRmb3JtJzogbmF2aWdhdG9yLnBsYXRmb3JtfTtcbn07XG5cbmV4cG9ydCBkZWZhdWx0IFJlcG9ydDtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuXG4vKiBUaGlzIGlzIGFuIGltcGxlbWVudGF0aW9uIG9mIHRoZSBhbGdvcml0aG0gZm9yIGNhbGN1bGF0aW5nIHRoZSBTdHJ1Y3R1cmFsXG4gKiBTSU1pbGFyaXR5IChTU0lNKSBpbmRleCBiZXR3ZWVuIHR3byBpbWFnZXMuIFBsZWFzZSByZWZlciB0byB0aGUgYXJ0aWNsZSBbMV0sXG4gKiB0aGUgd2Vic2l0ZSBbMl0gYW5kL29yIHRoZSBXaWtpcGVkaWEgYXJ0aWNsZSBbM10uIFRoaXMgY29kZSB0YWtlcyB0aGUgdmFsdWVcbiAqIG9mIHRoZSBjb25zdGFudHMgQzEgYW5kIEMyIGZyb20gdGhlIE1hdGxhYiBpbXBsZW1lbnRhdGlvbiBpbiBbNF0uXG4gKlxuICogWzFdIFouIFdhbmcsIEEuIEMuIEJvdmlrLCBILiBSLiBTaGVpa2gsIGFuZCBFLiBQLiBTaW1vbmNlbGxpLCBcIkltYWdlIHF1YWxpdHlcbiAqIGFzc2Vzc21lbnQ6IEZyb20gZXJyb3IgbWVhc3VyZW1lbnQgdG8gc3RydWN0dXJhbCBzaW1pbGFyaXR5XCIsXG4gKiBJRUVFIFRyYW5zYWN0aW9ucyBvbiBJbWFnZSBQcm9jZXNzaW5nLCB2b2wuIDEzLCBuby4gMSwgSmFuLiAyMDA0LlxuICogWzJdIGh0dHA6Ly93d3cuY25zLm55dS5lZHUvfmxjdi9zc2ltL1xuICogWzNdIGh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvU3RydWN0dXJhbF9zaW1pbGFyaXR5XG4gKiBbNF0gaHR0cDovL3d3dy5jbnMubnl1LmVkdS9+bGN2L3NzaW0vc3NpbV9pbmRleC5tXG4gKi9cblxuZnVuY3Rpb24gU3NpbSgpIHt9XG5cblNzaW0ucHJvdG90eXBlID0ge1xuICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS4yLCBhIHNpbXBsZSBhdmVyYWdlIG9mIGEgdmVjdG9yIGFuZCBFcS40LiwgZXhjZXB0IHRoZVxuICAvLyBzcXVhcmUgcm9vdC4gVGhlIGxhdHRlciBpcyBhY3R1YWxseSBhbiB1bmJpYXNlZCBlc3RpbWF0ZSBvZiB0aGUgdmFyaWFuY2UsXG4gIC8vIG5vdCB0aGUgZXhhY3QgdmFyaWFuY2UuXG4gIHN0YXRpc3RpY3M6IGZ1bmN0aW9uKGEpIHtcbiAgICB2YXIgYWNjdSA9IDA7XG4gICAgdmFyIGk7XG4gICAgZm9yIChpID0gMDsgaSA8IGEubGVuZ3RoOyArK2kpIHtcbiAgICAgIGFjY3UgKz0gYVtpXTtcbiAgICB9XG4gICAgdmFyIG1lYW5BID0gYWNjdSAvIChhLmxlbmd0aCAtIDEpO1xuICAgIHZhciBkaWZmID0gMDtcbiAgICBmb3IgKGkgPSAxOyBpIDwgYS5sZW5ndGg7ICsraSkge1xuICAgICAgZGlmZiA9IGFbaSAtIDFdIC0gbWVhbkE7XG4gICAgICBhY2N1ICs9IGFbaV0gKyAoZGlmZiAqIGRpZmYpO1xuICAgIH1cbiAgICByZXR1cm4ge21lYW46IG1lYW5BLCB2YXJpYW5jZTogYWNjdSAvIGEubGVuZ3RofTtcbiAgfSxcblxuICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS4xMS4sIGNvdihZLCBaKSA9IEUoKFkgLSB1WSksIChaIC0gdVopKS5cbiAgY292YXJpYW5jZTogZnVuY3Rpb24oYSwgYiwgbWVhbkEsIG1lYW5CKSB7XG4gICAgdmFyIGFjY3UgPSAwO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYS5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgYWNjdSArPSAoYVtpXSAtIG1lYW5BKSAqIChiW2ldIC0gbWVhbkIpO1xuICAgIH1cbiAgICByZXR1cm4gYWNjdSAvIGEubGVuZ3RoO1xuICB9LFxuXG4gIGNhbGN1bGF0ZTogZnVuY3Rpb24oeCwgeSkge1xuICAgIGlmICh4Lmxlbmd0aCAhPT0geS5sZW5ndGgpIHtcbiAgICAgIHJldHVybiAwO1xuICAgIH1cblxuICAgIC8vIFZhbHVlcyBvZiB0aGUgY29uc3RhbnRzIGNvbWUgZnJvbSB0aGUgTWF0bGFiIGNvZGUgcmVmZXJyZWQgYmVmb3JlLlxuICAgIHZhciBLMSA9IDAuMDE7XG4gICAgdmFyIEsyID0gMC4wMztcbiAgICB2YXIgTCA9IDI1NTtcbiAgICB2YXIgQzEgPSAoSzEgKiBMKSAqIChLMSAqIEwpO1xuICAgIHZhciBDMiA9IChLMiAqIEwpICogKEsyICogTCk7XG4gICAgdmFyIEMzID0gQzIgLyAyO1xuXG4gICAgdmFyIHN0YXRzWCA9IHRoaXMuc3RhdGlzdGljcyh4KTtcbiAgICB2YXIgbXVYID0gc3RhdHNYLm1lYW47XG4gICAgdmFyIHNpZ21hWDIgPSBzdGF0c1gudmFyaWFuY2U7XG4gICAgdmFyIHNpZ21hWCA9IE1hdGguc3FydChzaWdtYVgyKTtcbiAgICB2YXIgc3RhdHNZID0gdGhpcy5zdGF0aXN0aWNzKHkpO1xuICAgIHZhciBtdVkgPSBzdGF0c1kubWVhbjtcbiAgICB2YXIgc2lnbWFZMiA9IHN0YXRzWS52YXJpYW5jZTtcbiAgICB2YXIgc2lnbWFZID0gTWF0aC5zcXJ0KHNpZ21hWTIpO1xuICAgIHZhciBzaWdtYVh5ID0gdGhpcy5jb3ZhcmlhbmNlKHgsIHksIG11WCwgbXVZKTtcblxuICAgIC8vIEltcGxlbWVudGF0aW9uIG9mIEVxLjYuXG4gICAgdmFyIGx1bWluYW5jZSA9ICgyICogbXVYICogbXVZICsgQzEpIC9cbiAgICAgICAgKChtdVggKiBtdVgpICsgKG11WSAqIG11WSkgKyBDMSk7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuMTAuXG4gICAgdmFyIHN0cnVjdHVyZSA9IChzaWdtYVh5ICsgQzMpIC8gKHNpZ21hWCAqIHNpZ21hWSArIEMzKTtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBvZiBFcS45LlxuICAgIHZhciBjb250cmFzdCA9ICgyICogc2lnbWFYICogc2lnbWFZICsgQzIpIC8gKHNpZ21hWDIgKyBzaWdtYVkyICsgQzIpO1xuXG4gICAgLy8gSW1wbGVtZW50YXRpb24gb2YgRXEuMTIuXG4gICAgcmV0dXJuIGx1bWluYW5jZSAqIGNvbnRyYXN0ICogc3RydWN0dXJlO1xuICB9XG59O1xuXG5pZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gU3NpbTtcbn1cbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBTdGF0aXN0aWNzQWdncmVnYXRlKHJhbXBVcFRocmVzaG9sZCkge1xuICB0aGlzLnN0YXJ0VGltZV8gPSAwO1xuICB0aGlzLnN1bV8gPSAwO1xuICB0aGlzLmNvdW50XyA9IDA7XG4gIHRoaXMubWF4XyA9IDA7XG4gIHRoaXMucmFtcFVwVGhyZXNob2xkXyA9IHJhbXBVcFRocmVzaG9sZDtcbiAgdGhpcy5yYW1wVXBUaW1lXyA9IEluZmluaXR5O1xufVxuXG5TdGF0aXN0aWNzQWdncmVnYXRlLnByb3RvdHlwZSA9IHtcbiAgYWRkOiBmdW5jdGlvbih0aW1lLCBkYXRhcG9pbnQpIHtcbiAgICBpZiAodGhpcy5zdGFydFRpbWVfID09PSAwKSB7XG4gICAgICB0aGlzLnN0YXJ0VGltZV8gPSB0aW1lO1xuICAgIH1cbiAgICB0aGlzLnN1bV8gKz0gZGF0YXBvaW50O1xuICAgIHRoaXMubWF4XyA9IE1hdGgubWF4KHRoaXMubWF4XywgZGF0YXBvaW50KTtcbiAgICBpZiAodGhpcy5yYW1wVXBUaW1lXyA9PT0gSW5maW5pdHkgJiZcbiAgICAgICAgZGF0YXBvaW50ID4gdGhpcy5yYW1wVXBUaHJlc2hvbGRfKSB7XG4gICAgICB0aGlzLnJhbXBVcFRpbWVfID0gdGltZTtcbiAgICB9XG4gICAgdGhpcy5jb3VudF8rKztcbiAgfSxcblxuICBnZXRBdmVyYWdlOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb3VudF8gPT09IDApIHtcbiAgICAgIHJldHVybiAwO1xuICAgIH1cbiAgICByZXR1cm4gTWF0aC5yb3VuZCh0aGlzLnN1bV8gLyB0aGlzLmNvdW50Xyk7XG4gIH0sXG5cbiAgZ2V0TWF4OiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5tYXhfO1xuICB9LFxuXG4gIGdldFJhbXBVcFRpbWU6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBNYXRoLnJvdW5kKHRoaXMucmFtcFVwVGltZV8gLSB0aGlzLnN0YXJ0VGltZV8pO1xuICB9LFxufTtcblxuZXhwb3J0IGRlZmF1bHQgU3RhdGlzdGljc0FnZ3JlZ2F0ZTtcbiIsIi8qXG4gKiAgQ29weXJpZ2h0IChjKSAyMDE0IFRoZSBXZWJSVEMgcHJvamVjdCBhdXRob3JzLiBBbGwgUmlnaHRzIFJlc2VydmVkLlxuICpcbiAqICBVc2Ugb2YgdGhpcyBzb3VyY2UgY29kZSBpcyBnb3Zlcm5lZCBieSBhIEJTRC1zdHlsZSBsaWNlbnNlXG4gKiAgdGhhdCBjYW4gYmUgZm91bmQgaW4gdGhlIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBvZiB0aGUgc291cmNlXG4gKiAgdHJlZS5cbiAqL1xuJ3VzZSBzdHJpY3QnO1xuLyogZXhwb3J0ZWQgYXJyYXlBdmVyYWdlLCBhcnJheU1heCwgYXJyYXlNaW4sIGVudW1lcmF0ZVN0YXRzICovXG5cbi8vIGFycmF5PGZ1bmN0aW9uPiByZXR1cm5zIHRoZSBhdmVyYWdlIChkb3duIHRvIG5lYXJlc3QgaW50KSwgbWF4IGFuZCBtaW4gb2Zcbi8vIGFuIGludCBhcnJheS5cbmV4cG9ydCBmdW5jdGlvbiBhcnJheUF2ZXJhZ2UoYXJyYXkpIHtcbiAgdmFyIGNudCA9IGFycmF5Lmxlbmd0aDtcbiAgdmFyIHRvdCA9IDA7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY250OyBpKyspIHtcbiAgICB0b3QgKz0gYXJyYXlbaV07XG4gIH1cbiAgcmV0dXJuIE1hdGguZmxvb3IodG90IC8gY250KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFycmF5TWF4KGFycmF5KSB7XG4gIGlmIChhcnJheS5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gTmFOO1xuICB9XG4gIHJldHVybiBNYXRoLm1heC5hcHBseShNYXRoLCBhcnJheSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhcnJheU1pbihhcnJheSkge1xuICBpZiAoYXJyYXkubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIE5hTjtcbiAgfVxuICByZXR1cm4gTWF0aC5taW4uYXBwbHkoTWF0aCwgYXJyYXkpO1xufVxuXG4vLyBFbnVtZXJhdGVzIHRoZSBuZXcgc3RhbmRhcmQgY29tcGxpYW50IHN0YXRzIHVzaW5nIGxvY2FsIGFuZCByZW1vdGUgdHJhY2sgaWRzLlxuZXhwb3J0IGZ1bmN0aW9uIGVudW1lcmF0ZVN0YXRzKHN0YXRzLCBsb2NhbFRyYWNrSWRzLCByZW1vdGVUcmFja0lkcykge1xuICAvLyBDcmVhdGUgYW4gb2JqZWN0IHN0cnVjdHVyZSB3aXRoIGFsbCB0aGUgbmVlZGVkIHN0YXRzIGFuZCB0eXBlcyB0aGF0IHdlIGNhcmVcbiAgLy8gYWJvdXQuIFRoaXMgYWxsb3dzIHRvIG1hcCB0aGUgZ2V0U3RhdHMgc3RhdHMgdG8gb3RoZXIgc3RhdHMgbmFtZXMuXG4gIHZhciBzdGF0c09iamVjdCA9IHtcbiAgICBhdWRpbzoge1xuICAgICAgbG9jYWw6IHtcbiAgICAgICAgYXVkaW9MZXZlbDogMC4wLFxuICAgICAgICBieXRlc1NlbnQ6IDAsXG4gICAgICAgIGNsb2NrUmF0ZTogMCxcbiAgICAgICAgY29kZWNJZDogJycsXG4gICAgICAgIG1pbWVUeXBlOiAnJyxcbiAgICAgICAgcGFja2V0c1NlbnQ6IDAsXG4gICAgICAgIHBheWxvYWRUeXBlOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH0sXG4gICAgICByZW1vdGU6IHtcbiAgICAgICAgYXVkaW9MZXZlbDogMC4wLFxuICAgICAgICBieXRlc1JlY2VpdmVkOiAwLFxuICAgICAgICBjbG9ja1JhdGU6IDAsXG4gICAgICAgIGNvZGVjSWQ6ICcnLFxuICAgICAgICBmcmFjdGlvbkxvc3Q6IDAsXG4gICAgICAgIGppdHRlcjogMCxcbiAgICAgICAgbWltZVR5cGU6ICcnLFxuICAgICAgICBwYWNrZXRzTG9zdDogLTEsXG4gICAgICAgIHBhY2tldHNSZWNlaXZlZDogMCxcbiAgICAgICAgcGF5bG9hZFR5cGU6IDAsXG4gICAgICAgIHRpbWVzdGFtcDogMC4wLFxuICAgICAgICB0cmFja0lkOiAnJyxcbiAgICAgICAgdHJhbnNwb3J0SWQ6ICcnLFxuICAgICAgfVxuICAgIH0sXG4gICAgdmlkZW86IHtcbiAgICAgIGxvY2FsOiB7XG4gICAgICAgIGJ5dGVzU2VudDogMCxcbiAgICAgICAgY2xvY2tSYXRlOiAwLFxuICAgICAgICBjb2RlY0lkOiAnJyxcbiAgICAgICAgZmlyQ291bnQ6IDAsXG4gICAgICAgIGZyYW1lc0VuY29kZWQ6IDAsXG4gICAgICAgIGZyYW1lSGVpZ2h0OiAwLFxuICAgICAgICBmcmFtZXNTZW50OiAtMSxcbiAgICAgICAgZnJhbWVXaWR0aDogMCxcbiAgICAgICAgbmFja0NvdW50OiAwLFxuICAgICAgICBwYWNrZXRzU2VudDogLTEsXG4gICAgICAgIHBheWxvYWRUeXBlOiAwLFxuICAgICAgICBwbGlDb3VudDogMCxcbiAgICAgICAgcXBTdW06IDAsXG4gICAgICAgIHRpbWVzdGFtcDogMC4wLFxuICAgICAgICB0cmFja0lkOiAnJyxcbiAgICAgICAgdHJhbnNwb3J0SWQ6ICcnLFxuICAgICAgfSxcbiAgICAgIHJlbW90ZToge1xuICAgICAgICBieXRlc1JlY2VpdmVkOiAtMSxcbiAgICAgICAgY2xvY2tSYXRlOiAwLFxuICAgICAgICBjb2RlY0lkOiAnJyxcbiAgICAgICAgZmlyQ291bnQ6IC0xLFxuICAgICAgICBmcmFjdGlvbkxvc3Q6IDAsXG4gICAgICAgIGZyYW1lSGVpZ2h0OiAwLFxuICAgICAgICBmcmFtZXNEZWNvZGVkOiAwLFxuICAgICAgICBmcmFtZXNEcm9wcGVkOiAwLFxuICAgICAgICBmcmFtZXNSZWNlaXZlZDogMCxcbiAgICAgICAgZnJhbWVXaWR0aDogMCxcbiAgICAgICAgbmFja0NvdW50OiAtMSxcbiAgICAgICAgcGFja2V0c0xvc3Q6IC0xLFxuICAgICAgICBwYWNrZXRzUmVjZWl2ZWQ6IDAsXG4gICAgICAgIHBheWxvYWRUeXBlOiAwLFxuICAgICAgICBwbGlDb3VudDogLTEsXG4gICAgICAgIHFwU3VtOiAwLFxuICAgICAgICB0aW1lc3RhbXA6IDAuMCxcbiAgICAgICAgdHJhY2tJZDogJycsXG4gICAgICAgIHRyYW5zcG9ydElkOiAnJyxcbiAgICAgIH1cbiAgICB9LFxuICAgIGNvbm5lY3Rpb246IHtcbiAgICAgIGF2YWlsYWJsZU91dGdvaW5nQml0cmF0ZTogMCxcbiAgICAgIGJ5dGVzUmVjZWl2ZWQ6IDAsXG4gICAgICBieXRlc1NlbnQ6IDAsXG4gICAgICBjb25zZW50UmVxdWVzdHNTZW50OiAwLFxuICAgICAgY3VycmVudFJvdW5kVHJpcFRpbWU6IDAuMCxcbiAgICAgIGxvY2FsQ2FuZGlkYXRlSWQ6ICcnLFxuICAgICAgbG9jYWxDYW5kaWRhdGVUeXBlOiAnJyxcbiAgICAgIGxvY2FsSXA6ICcnLFxuICAgICAgbG9jYWxQb3J0OiAwLFxuICAgICAgbG9jYWxQcmlvcml0eTogMCxcbiAgICAgIGxvY2FsUHJvdG9jb2w6ICcnLFxuICAgICAgcmVtb3RlQ2FuZGlkYXRlSWQ6ICcnLFxuICAgICAgcmVtb3RlQ2FuZGlkYXRlVHlwZTogJycsXG4gICAgICByZW1vdGVJcDogJycsXG4gICAgICByZW1vdGVQb3J0OiAwLFxuICAgICAgcmVtb3RlUHJpb3JpdHk6IDAsXG4gICAgICByZW1vdGVQcm90b2NvbDogJycsXG4gICAgICByZXF1ZXN0c1JlY2VpdmVkOiAwLFxuICAgICAgcmVxdWVzdHNTZW50OiAwLFxuICAgICAgcmVzcG9uc2VzUmVjZWl2ZWQ6IDAsXG4gICAgICByZXNwb25zZXNTZW50OiAwLFxuICAgICAgdGltZXN0YW1wOiAwLjAsXG4gICAgICB0b3RhbFJvdW5kVHJpcFRpbWU6IDAuMCxcbiAgICB9XG4gIH07XG5cbiAgLy8gTmVlZCB0byBmaW5kIHRoZSBjb2RlYywgbG9jYWwgYW5kIHJlbW90ZSBJRCdzIGZpcnN0LlxuICBpZiAoc3RhdHMpIHtcbiAgICBzdGF0cy5mb3JFYWNoKGZ1bmN0aW9uKHJlcG9ydCwgc3RhdCkge1xuICAgICAgc3dpdGNoKHJlcG9ydC50eXBlKSB7XG4gICAgICAgIGNhc2UgJ291dGJvdW5kLXJ0cCc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgndHJhY2tJZCcpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWQuaW5kZXhPZihsb2NhbFRyYWNrSWRzLmF1ZGlvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuYnl0ZXNTZW50ID0gcmVwb3J0LmJ5dGVzU2VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuY29kZWNJZCA9IHJlcG9ydC5jb2RlY0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5sb2NhbC5wYWNrZXRzU2VudCA9IHJlcG9ydC5wYWNrZXRzU2VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwudGltZXN0YW1wID0gcmVwb3J0LnRpbWVzdGFtcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwudHJhY2tJZCA9IHJlcG9ydC50cmFja0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5sb2NhbC50cmFuc3BvcnRJZCA9IHJlcG9ydC50cmFuc3BvcnRJZDtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmVwb3J0LnRyYWNrSWQuaW5kZXhPZihsb2NhbFRyYWNrSWRzLnZpZGVvKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy52aWRlbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuYnl0ZXNTZW50ID0gcmVwb3J0LmJ5dGVzU2VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuY29kZWNJZCA9IHJlcG9ydC5jb2RlY0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5maXJDb3VudCA9IHJlcG9ydC5maXJDb3VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuZnJhbWVzRW5jb2RlZCA9IHJlcG9ydC5mcmFtZXNFbmNvZGVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZXNTZW50ID0gcmVwb3J0LmZyYW1lc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnBhY2tldHNTZW50ID0gcmVwb3J0LnBhY2tldHNTZW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5wbGlDb3VudCA9IHJlcG9ydC5wbGlDb3VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwucXBTdW0gPSByZXBvcnQucXBTdW07XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnRpbWVzdGFtcCA9IHJlcG9ydC50aW1lc3RhbXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnRyYWNrSWQgPSByZXBvcnQudHJhY2tJZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwudHJhbnNwb3J0SWQgPSByZXBvcnQudHJhbnNwb3J0SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdpbmJvdW5kLXJ0cCc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgndHJhY2tJZCcpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWQuaW5kZXhPZihyZW1vdGVUcmFja0lkcy5hdWRpbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLmF1ZGlvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuYnl0ZXNSZWNlaXZlZCA9IHJlcG9ydC5ieXRlc1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuY29kZWNJZCA9IHJlcG9ydC5jb2RlY0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuZnJhY3Rpb25Mb3N0ID0gcmVwb3J0LmZyYWN0aW9uTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLmppdHRlciA9IHJlcG9ydC5qaXR0ZXI7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5wYWNrZXRzTG9zdCA9IHJlcG9ydC5wYWNrZXRzTG9zdDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ucmVtb3RlLnBhY2tldHNSZWNlaXZlZCA9IHJlcG9ydC5wYWNrZXRzUmVjZWl2ZWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUudHJhY2tJZCA9IHJlcG9ydC50cmFja0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUudHJhbnNwb3J0SWQgPSByZXBvcnQudHJhbnNwb3J0SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWQuaW5kZXhPZihyZW1vdGVUcmFja0lkcy52aWRlbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLnZpZGVvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuYnl0ZXNSZWNlaXZlZCA9IHJlcG9ydC5ieXRlc1JlY2VpdmVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuY29kZWNJZCA9IHJlcG9ydC5jb2RlY0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZmlyQ291bnQgPSByZXBvcnQuZmlyQ291bnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5mcmFjdGlvbkxvc3QgPSByZXBvcnQuZnJhY3Rpb25Mb3N0O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUubmFja0NvdW50ID0gcmVwb3J0Lm5hY2tDb3VudDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnBhY2tldHNMb3N0ID0gcmVwb3J0LnBhY2tldHNMb3N0O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUucGFja2V0c1JlY2VpdmVkID0gcmVwb3J0LnBhY2tldHNSZWNlaXZlZDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLnBsaUNvdW50ID0gcmVwb3J0LnBsaUNvdW50O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUucXBTdW0gPSByZXBvcnQucXBTdW07XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS50aW1lc3RhbXAgPSByZXBvcnQudGltZXN0YW1wO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUudHJhY2tJZCA9IHJlcG9ydC50cmFja0lkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUudHJhbnNwb3J0SWQgPSByZXBvcnQudHJhbnNwb3J0SWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdjYW5kaWRhdGUtcGFpcic6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgnYXZhaWxhYmxlT3V0Z29pbmdCaXRyYXRlJykpIHtcbiAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24uYXZhaWxhYmxlT3V0Z29pbmdCaXRyYXRlID1cbiAgICAgICAgICAgICAgICByZXBvcnQuYXZhaWxhYmxlT3V0Z29pbmdCaXRyYXRlO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5ieXRlc1JlY2VpdmVkID0gcmVwb3J0LmJ5dGVzUmVjZWl2ZWQ7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmJ5dGVzU2VudCA9IHJlcG9ydC5ieXRlc1NlbnQ7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmNvbnNlbnRSZXF1ZXN0c1NlbnQgPVxuICAgICAgICAgICAgICAgIHJlcG9ydC5jb25zZW50UmVxdWVzdHNTZW50O1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5jdXJyZW50Um91bmRUcmlwVGltZSA9XG4gICAgICAgICAgICAgICAgcmVwb3J0LmN1cnJlbnRSb3VuZFRyaXBUaW1lO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5sb2NhbENhbmRpZGF0ZUlkID0gcmVwb3J0LmxvY2FsQ2FuZGlkYXRlSWQ7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZUNhbmRpZGF0ZUlkID0gcmVwb3J0LnJlbW90ZUNhbmRpZGF0ZUlkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXF1ZXN0c1JlY2VpdmVkID0gcmVwb3J0LnJlcXVlc3RzUmVjZWl2ZWQ7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlcXVlc3RzU2VudCA9IHJlcG9ydC5yZXF1ZXN0c1NlbnQ7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlc3BvbnNlc1JlY2VpdmVkID0gcmVwb3J0LnJlc3BvbnNlc1JlY2VpdmVkO1xuICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZXNwb25zZXNTZW50ID0gcmVwb3J0LnJlc3BvbnNlc1NlbnQ7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnRpbWVzdGFtcCA9IHJlcG9ydC50aW1lc3RhbXA7XG4gICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnRvdGFsUm91bmRUcmlwVGltZSA9XG4gICAgICAgICAgICAgICByZXBvcnQudG90YWxSb3VuZFRyaXBUaW1lO1xuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgZGVmYXVsdDpcbiAgICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfS5iaW5kKCkpO1xuXG4gICAgLy8gVXNpbmcgdGhlIGNvZGVjLCBsb2NhbCBhbmQgcmVtb3RlIGNhbmRpZGF0ZSBJRCdzIHRvIGZpbmQgdGhlIHJlc3Qgb2YgdGhlXG4gICAgLy8gcmVsZXZhbnQgc3RhdHMuXG4gICAgc3RhdHMuZm9yRWFjaChmdW5jdGlvbihyZXBvcnQpIHtcbiAgICAgIHN3aXRjaChyZXBvcnQudHlwZSkge1xuICAgICAgICBjYXNlICd0cmFjayc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgndHJhY2tJZGVudGlmaWVyJykpIHtcbiAgICAgICAgICAgIGlmIChyZXBvcnQudHJhY2tJZGVudGlmaWVyLmluZGV4T2YobG9jYWxUcmFja0lkcy52aWRlbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIGxvY2FsVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmZyYW1lSGVpZ2h0ID0gcmVwb3J0LmZyYW1lSGVpZ2h0O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5sb2NhbC5mcmFtZXNTZW50ID0gcmVwb3J0LmZyYW1lc1NlbnQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLmZyYW1lV2lkdGggPSByZXBvcnQuZnJhbWVXaWR0aDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQudHJhY2tJZGVudGlmaWVyLmluZGV4T2YocmVtb3RlVHJhY2tJZHMudmlkZW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICByZW1vdGVUcmFja0lkcy52aWRlbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ucmVtb3RlLmZyYW1lSGVpZ2h0ID0gcmVwb3J0LmZyYW1lSGVpZ2h0O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhbWVzRGVjb2RlZCA9IHJlcG9ydC5mcmFtZXNEZWNvZGVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhbWVzRHJvcHBlZCA9IHJlcG9ydC5mcmFtZXNEcm9wcGVkO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUuZnJhbWVzUmVjZWl2ZWQgPSByZXBvcnQuZnJhbWVzUmVjZWl2ZWQ7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5mcmFtZVdpZHRoID0gcmVwb3J0LmZyYW1lV2lkdGg7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVwb3J0LnRyYWNrSWRlbnRpZmllci5pbmRleE9mKGxvY2FsVHJhY2tJZHMuYXVkaW8pICE9PSAxICZcbiAgICAgICAgICAgICAgICBsb2NhbFRyYWNrSWRzLmF1ZGlvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5sb2NhbC5hdWRpb0xldmVsID0gcmVwb3J0LmF1ZGlvTGV2ZWwgO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC50cmFja0lkZW50aWZpZXIuaW5kZXhPZihyZW1vdGVUcmFja0lkcy5hdWRpbykgIT09IDEgJlxuICAgICAgICAgICAgICAgIHJlbW90ZVRyYWNrSWRzLmF1ZGlvICE9PSAnJykge1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUuYXVkaW9MZXZlbCA9IHJlcG9ydC5hdWRpb0xldmVsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVhaztcbiAgICAgICAgY2FzZSAnY29kZWMnOlxuICAgICAgICAgIGlmIChyZXBvcnQuaGFzT3duUHJvcGVydHkoJ2lkJykpIHtcbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC5hdWRpby5sb2NhbC5jb2RlY0lkKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy5hdWRpbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuYXVkaW8ubG9jYWwubWltZVR5cGUgPSByZXBvcnQubWltZVR5cGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLmxvY2FsLnBheWxvYWRUeXBlID0gcmVwb3J0LnBheWxvYWRUeXBlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC5pZC5pbmRleE9mKHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5jb2RlY0lkKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgcmVtb3RlVHJhY2tJZHMuYXVkaW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5jbG9ja1JhdGUgPSByZXBvcnQuY2xvY2tSYXRlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5hdWRpby5yZW1vdGUubWltZVR5cGUgPSByZXBvcnQubWltZVR5cGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmF1ZGlvLnJlbW90ZS5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChyZXBvcnQuaWQuaW5kZXhPZihzdGF0c09iamVjdC52aWRlby5sb2NhbC5jb2RlY0lkKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgbG9jYWxUcmFja0lkcy52aWRlbyAhPT0gJycpIHtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwuY2xvY2tSYXRlID0gcmVwb3J0LmNsb2NrUmF0ZTtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QudmlkZW8ubG9jYWwubWltZVR5cGUgPSByZXBvcnQubWltZVR5cGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLmxvY2FsLnBheWxvYWRUeXBlID0gcmVwb3J0LnBheWxvYWRUeXBlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHJlcG9ydC5pZC5pbmRleE9mKHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5jb2RlY0lkKSAhPT0gMSAmXG4gICAgICAgICAgICAgICAgcmVtb3RlVHJhY2tJZHMudmlkZW8gIT09ICcnKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5jbG9ja1JhdGUgPSByZXBvcnQuY2xvY2tSYXRlO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC52aWRlby5yZW1vdGUubWltZVR5cGUgPSByZXBvcnQubWltZVR5cGU7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LnZpZGVvLnJlbW90ZS5wYXlsb2FkVHlwZSA9IHJlcG9ydC5wYXlsb2FkVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGNhc2UgJ2xvY2FsLWNhbmRpZGF0ZSc6XG4gICAgICAgICAgaWYgKHJlcG9ydC5oYXNPd25Qcm9wZXJ0eSgnaWQnKSkge1xuICAgICAgICAgICAgaWYgKHJlcG9ydC5pZC5pbmRleE9mKFxuICAgICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxDYW5kaWRhdGVJZCkgIT09IC0xKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxJcCA9IHJlcG9ydC5pcDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5sb2NhbFBvcnQgPSByZXBvcnQucG9ydDtcbiAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5sb2NhbFByaW9yaXR5ID0gcmVwb3J0LnByaW9yaXR5O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLmxvY2FsUHJvdG9jb2wgPSByZXBvcnQucHJvdG9jb2w7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ubG9jYWxUeXBlID0gcmVwb3J0LmNhbmRpZGF0ZVR5cGU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlICdyZW1vdGUtY2FuZGlkYXRlJzpcbiAgICAgICAgICBpZiAocmVwb3J0Lmhhc093blByb3BlcnR5KCdpZCcpKSB7XG4gICAgICAgICAgICBpZiAocmVwb3J0LmlkLmluZGV4T2YoXG4gICAgICAgICAgICAgICAgc3RhdHNPYmplY3QuY29ubmVjdGlvbi5yZW1vdGVDYW5kaWRhdGVJZCkgIT09IC0xKSB7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVtb3RlSXAgPSByZXBvcnQuaXA7XG4gICAgICAgICAgICAgIHN0YXRzT2JqZWN0LmNvbm5lY3Rpb24ucmVtb3RlUG9ydCA9IHJlcG9ydC5wb3J0O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZVByaW9yaXR5ID0gcmVwb3J0LnByaW9yaXR5O1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZVByb3RvY29sID0gcmVwb3J0LnByb3RvY29sO1xuICAgICAgICAgICAgICBzdGF0c09iamVjdC5jb25uZWN0aW9uLnJlbW90ZVR5cGUgPSByZXBvcnQuY2FuZGlkYXRlVHlwZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIGRlZmF1bHQ6XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH0uYmluZCgpKTtcbiAgfVxuICByZXR1cm4gc3RhdHNPYmplY3Q7XG59XG4iLCIvKlxuICogIENvcHlyaWdodCAoYykgMjAxNyBUaGUgV2ViUlRDIHByb2plY3QgYXV0aG9ycy4gQWxsIFJpZ2h0cyBSZXNlcnZlZC5cbiAqXG4gKiAgVXNlIG9mIHRoaXMgc291cmNlIGNvZGUgaXMgZ292ZXJuZWQgYnkgYSBCU0Qtc3R5bGUgbGljZW5zZVxuICogIHRoYXQgY2FuIGJlIGZvdW5kIGluIHRoZSBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3Qgb2YgdGhlIHNvdXJjZVxuICogIHRyZWUuXG4gKi9cbid1c2Ugc3RyaWN0JztcbmltcG9ydCBTc2ltIGZyb20gJy4vc3NpbS5qcyc7XG5cbmZ1bmN0aW9uIFZpZGVvRnJhbWVDaGVja2VyKHZpZGVvRWxlbWVudCkge1xuICB0aGlzLmZyYW1lU3RhdHMgPSB7XG4gICAgbnVtRnJvemVuRnJhbWVzOiAwLFxuICAgIG51bUJsYWNrRnJhbWVzOiAwLFxuICAgIG51bUZyYW1lczogMFxuICB9O1xuXG4gIHRoaXMucnVubmluZ18gPSB0cnVlO1xuXG4gIHRoaXMubm9uQmxhY2tQaXhlbEx1bWFUaHJlc2hvbGQgPSAyMDtcbiAgdGhpcy5wcmV2aW91c0ZyYW1lXyA9IFtdO1xuICB0aGlzLmlkZW50aWNhbEZyYW1lU3NpbVRocmVzaG9sZCA9IDAuOTg1O1xuICB0aGlzLmZyYW1lQ29tcGFyYXRvciA9IG5ldyBTc2ltKCk7XG5cbiAgdGhpcy5jYW52YXNfID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJyk7XG4gIHRoaXMudmlkZW9FbGVtZW50XyA9IHZpZGVvRWxlbWVudDtcbiAgdGhpcy5saXN0ZW5lcl8gPSB0aGlzLmNoZWNrVmlkZW9GcmFtZV8uYmluZCh0aGlzKTtcbiAgdGhpcy52aWRlb0VsZW1lbnRfLmFkZEV2ZW50TGlzdGVuZXIoJ3BsYXknLCB0aGlzLmxpc3RlbmVyXywgZmFsc2UpO1xufVxuXG5WaWRlb0ZyYW1lQ2hlY2tlci5wcm90b3R5cGUgPSB7XG4gIHN0b3A6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudmlkZW9FbGVtZW50Xy5yZW1vdmVFdmVudExpc3RlbmVyKCdwbGF5JyAsIHRoaXMubGlzdGVuZXJfKTtcbiAgICB0aGlzLnJ1bm5pbmdfID0gZmFsc2U7XG4gIH0sXG5cbiAgZ2V0Q3VycmVudEltYWdlRGF0YV86IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY2FudmFzXy53aWR0aCA9IHRoaXMudmlkZW9FbGVtZW50Xy53aWR0aDtcbiAgICB0aGlzLmNhbnZhc18uaGVpZ2h0ID0gdGhpcy52aWRlb0VsZW1lbnRfLmhlaWdodDtcblxuICAgIHZhciBjb250ZXh0ID0gdGhpcy5jYW52YXNfLmdldENvbnRleHQoJzJkJyk7XG4gICAgY29udGV4dC5kcmF3SW1hZ2UodGhpcy52aWRlb0VsZW1lbnRfLCAwLCAwLCB0aGlzLmNhbnZhc18ud2lkdGgsXG4gICAgICAgIHRoaXMuY2FudmFzXy5oZWlnaHQpO1xuICAgIHJldHVybiBjb250ZXh0LmdldEltYWdlRGF0YSgwLCAwLCB0aGlzLmNhbnZhc18ud2lkdGgsIHRoaXMuY2FudmFzXy5oZWlnaHQpO1xuICB9LFxuXG4gIGNoZWNrVmlkZW9GcmFtZV86IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5ydW5uaW5nXykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy52aWRlb0VsZW1lbnRfLmVuZGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdmFyIGltYWdlRGF0YSA9IHRoaXMuZ2V0Q3VycmVudEltYWdlRGF0YV8oKTtcblxuICAgIGlmICh0aGlzLmlzQmxhY2tGcmFtZV8oaW1hZ2VEYXRhLmRhdGEsIGltYWdlRGF0YS5kYXRhLmxlbmd0aCkpIHtcbiAgICAgIHRoaXMuZnJhbWVTdGF0cy5udW1CbGFja0ZyYW1lcysrO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmZyYW1lQ29tcGFyYXRvci5jYWxjdWxhdGUodGhpcy5wcmV2aW91c0ZyYW1lXywgaW1hZ2VEYXRhLmRhdGEpID5cbiAgICAgICAgdGhpcy5pZGVudGljYWxGcmFtZVNzaW1UaHJlc2hvbGQpIHtcbiAgICAgIHRoaXMuZnJhbWVTdGF0cy5udW1Gcm96ZW5GcmFtZXMrKztcbiAgICB9XG4gICAgdGhpcy5wcmV2aW91c0ZyYW1lXyA9IGltYWdlRGF0YS5kYXRhO1xuXG4gICAgdGhpcy5mcmFtZVN0YXRzLm51bUZyYW1lcysrO1xuICAgIHNldFRpbWVvdXQodGhpcy5jaGVja1ZpZGVvRnJhbWVfLmJpbmQodGhpcyksIDIwKTtcbiAgfSxcblxuICBpc0JsYWNrRnJhbWVfOiBmdW5jdGlvbihkYXRhLCBsZW5ndGgpIHtcbiAgICAvLyBUT0RPOiBVc2UgYSBzdGF0aXN0aWNhbCwgaGlzdG9ncmFtLWJhc2VkIGRldGVjdGlvbi5cbiAgICB2YXIgdGhyZXNoID0gdGhpcy5ub25CbGFja1BpeGVsTHVtYVRocmVzaG9sZDtcbiAgICB2YXIgYWNjdUx1bWEgPSAwO1xuICAgIGZvciAodmFyIGkgPSA0OyBpIDwgbGVuZ3RoOyBpICs9IDQpIHtcbiAgICAgIC8vIFVzZSBMdW1hIGFzIGluIFJlYy4gNzA5OiBZ4oCyNzA5ID0gMC4yMVIgKyAwLjcyRyArIDAuMDdCO1xuICAgICAgYWNjdUx1bWEgKz0gMC4yMSAqIGRhdGFbaV0gKyAwLjcyICogZGF0YVtpICsgMV0gKyAwLjA3ICogZGF0YVtpICsgMl07XG4gICAgICAvLyBFYXJseSB0ZXJtaW5hdGlvbiBpZiB0aGUgYXZlcmFnZSBMdW1hIHNvIGZhciBpcyBicmlnaHQgZW5vdWdoLlxuICAgICAgaWYgKGFjY3VMdW1hID4gKHRocmVzaCAqIGkgLyA0KSkge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9XG59O1xuXG5pZiAodHlwZW9mIGV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gVmlkZW9GcmFtZUNoZWNrZXI7XG59XG4iXX0=
